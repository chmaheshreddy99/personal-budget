package com.aditya.personalbudget.storage;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * The "database": a set of {@link TsvTable}s kept by a {@link TableStorage}: tab-separated files in the data
 * directory (the default) or the tabs of a Google spreadsheet. Everything below works the same on either.
 * <p>
 * <b>The storage is the truth.</b> A parsed table is kept, shared by every request, only together with the
 * storage's stamp of the version it was parsed from ({@link TableStorage#stamp}); every read asks the storage for
 * the current stamp first, and parses the table again as soon as it differs (another server process, or a manual
 * edit). A commit hands the tables it wrote to the cache as written, so nothing is parsed again for a local change.
 * Cached rows are never changed in place: readers get copies, and a unit of work changes its own copy of the map.
 * <ul>
 *   <li>{@link #endRequest()} unpins what the request read when it ends. Work outside a web request (a nightly
 *       job, the startup steps) calls {@link #endRequest()} when done.</li>
 *   <li>A read-only request ({@link #beginReadOnly()}) holds the shared lock, so it sees every table as of
 *       one moment and can never write (an attempt fails).</li>
 *   <li>A transaction takes the exclusive lock (in this JVM) plus an OS file lock on {@code data/.lock}
 *       (across processes), has the storage {@linkplain TableStorage#refresh() refreshed}, so it works on what the
 *       storage holds at that moment, and writes the changed tables on commit. Rollback simply forgets the changes:
 *       nothing reached the storage, and the shared cache never saw them.</li>
 * </ul>
 * Constraints are enforced on every write: NOT NULL, LENGTH, UNIQUE, FOREIGN KEY, bean validation, and
 * optimistic locking for entities with a {@code @Version} column (a save carrying an older version than the
 * one on disk is rejected with {@link ConcurrentUpdateException}). Ids come from a persisted sequence, so a
 * deleted id is never handed out again.
 */
public class TsvDataStore {

    private static final Logger log = LoggerFactory.getLogger(TsvDataStore.class);
    /** Sequence keys that record a one-off step as done rather than the last id of a table. */
    private static final String DONE_PREFIX = "done.";

    private final Path dataDir;
    private final TableStorage storage;
    private final Validator validator;
    private final Map<Class<?>, TsvTable<?>> tables = new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock(true);
    private final ThreadLocal<UnitOfWork> currentWork = new ThreadLocal<>();
    /** The last parse of each table with the stamp it was parsed at, shared by every thread (see the class notes). */
    private final Map<TsvTable<?>, Parsed<?>> parsed = new ConcurrentHashMap<>();
    private final List<Consumer<Set<String>>> commitListeners = new CopyOnWriteArrayList<>();
    private final List<StoreListener> storeListeners = new CopyOnWriteArrayList<>();

    /** A store on tab-separated files in {@code dataDir}. */
    public TsvDataStore(String dataDir, Validator validator) {
        this(Path.of(dataDir), new LocalFileStorage(Path.of(dataDir)), validator);
    }

    /**
     * A store whose tables live in {@code storage}. The data directory still holds what is not a table: the lock
     * file, evidence attachments and settings files.
     */
    public TsvDataStore(Path dataDir, TableStorage storage, Validator validator) {
        this.dataDir = dataDir.toAbsolutePath().normalize();
        this.storage = storage;
        this.validator = validator;
        try {
            Files.createDirectories(this.dataDir);
        } catch (IOException e) {
            throw new StorageException("Cannot create data directory " + this.dataDir, e);
        }
        log.info("Data store: {}", storage.describe());
    }

    public Path dataDir() {
        return dataDir;
    }

    /** How many tables there are and how much they hold. */
    public TableStorage.Footprint footprint() {
        return storage.footprint();
    }

    /** Creates (or opens) the table for an entity type. Called by each repository. */
    public <T extends Identifiable> void register(Class<T> type) {
        tables.computeIfAbsent(type, t -> new TsvTable<>(EntityMetadata.of(type), storage));
    }

    /** Called after every successful commit with the names of the tables that changed. */
    public void addCommitListener(Consumer<Set<String>> listener) {
        commitListeners.add(listener);
    }

    /** Hooks into every save, delete and commit (see {@link StoreListener}). */
    public void addStoreListener(StoreListener listener) {
        storeListeners.add(listener);
    }

    // ================================================================== request scope

    /** Marks the current request read-only: a consistent view of all tables, and no writes. */
    public void beginReadOnly() {
        lock.readLock().lock();
    }

    /** Ends the request: releases a read-only lock if held and unpins what it read. */
    public void endRequest() {
        storage.forget();
        while (lock.getReadHoldCount() > 0) {
            lock.readLock().unlock();
        }
    }

    // ================================================================== reads

    public <T extends Identifiable> List<T> findAll(Class<T> type, Predicate<? super T> filter) {
        TsvTable<T> table = table(type);
        return rows(table).values().stream().filter(filter).map(table.meta()::copy).collect(Collectors.toList());
    }

    public <T extends Identifiable> Optional<T> findById(Class<T> type, Long id) {
        TsvTable<T> table = table(type);
        return Optional.ofNullable(id == null ? null : rows(table).get(id)).map(table.meta()::copy);
    }

    public <T extends Identifiable> long count(Class<T> type, Predicate<? super T> filter) {
        return rows(table(type)).values().stream().filter(filter).count();
    }

    // ================================================================== writes

    public <T extends Identifiable> T save(Class<T> type, T entity) {
        return write(() -> saveRow(table(type), entity, false));
    }

    /**
     * Saves a row the system keeps up to date by itself (a stored balance ...) without touching its
     * {@code @Version}: an edit form opened before still saves, and a stale copy cannot be written this way.
     */
    public <T extends Identifiable> T saveKeepingVersion(Class<T> type, T entity) {
        return write(() -> saveRow(table(type), entity, true));
    }

    public <T extends Identifiable> List<T> saveAll(Class<T> type, Collection<? extends T> entities) {
        return write(() -> {
            TsvTable<T> table = table(type);
            List<T> saved = new ArrayList<>(entities.size());
            for (T e : entities) {
                saved.add(saveRow(table, e, false));
            }
            return saved;
        });
    }

    public <T extends Identifiable> void deleteById(Class<T> type, Long id) {
        write(() -> {
            deleteRow(table(type), id);
            return null;
        });
    }

    public <T extends Identifiable> void deleteAllById(Class<T> type, Collection<Long> ids) {
        write(() -> {
            TsvTable<T> table = table(type);
            ids.forEach(id -> deleteRow(table, id));
            return null;
        });
    }

    // ================================================================== one-off steps

    /**
     * A one-off step (a data migration) already ran on this data. The record is kept with the id sequences, so it
     * travels with the data: a new server on the same Google spreadsheet does not run the step again.
     */
    public boolean isDone(String step) {
        UnitOfWork work = currentWork.get();
        return (work != null ? work.sequences() : storage.readSequences()).containsKey(DONE_PREFIX + step);
    }

    /** Records a one-off step as done, with the current unit of work (or in one of its own). */
    public void markDone(String step) {
        write(() -> {
            UnitOfWork work = work();
            work.sequences().setProperty(DONE_PREFIX + step, LocalDate.now().toString());
            work.sequencesChanged = true;
            return null;
        });
    }

    // ================================================================== whole-store copy (backup and restore)

    /** Every table (header row first, cells as {@link TsvCodec} text) and the id sequences, as of one moment. */
    public record Dump(Map<String, List<List<String>>> tables, Properties sequences) {
    }

    /** Reads every table and the sequences. Inside a read-only request or a unit of work it sees one moment. */
    public Dump dump() {
        boolean locked = !isInTransaction() && lock.getReadHoldCount() == 0;
        if (locked) {
            lock.readLock().lock();
        }
        try {
            Map<String, List<List<String>>> all = new TreeMap<>();
            for (TsvTable<?> table : tables.values()) {
                all.put(table.name(), encodeRows(table));
            }
            UnitOfWork work = currentWork.get();
            Properties sequences = new Properties();
            sequences.putAll(work != null ? work.sequences() : storage.readSequences());
            return new Dump(all, sequences);
        } finally {
            if (locked) {
                lock.readLock().unlock();
            }
        }
    }

    /**
     * Replaces the tables of a {@link Dump} (a restore) in one unit of work: all or nothing. Every row is parsed
     * first, so a damaged copy changes nothing. Tables the dump does not hold are emptied, except those named in
     * {@code keep}, which stay as they are. Rows go in as they are (ids kept, no validation hooks), and no
     * sequence goes down (neither below what it is now nor below the largest id restored): an id is never handed out twice.
     *
     * @return the names of the tables written
     */
    public Set<String> replaceAll(Dump dump, Set<String> keep) {
        return write(() -> {
            UnitOfWork work = work();
            Set<String> written = new LinkedHashSet<>();
            // the sequences as they are now, raised to the backup's: an id handed out after the backup was made is
            // not handed out again; the steps the backup records as done stay done
            Properties sequences = new Properties();
            sequences.putAll(work.sequences());
            dump.sequences().forEach((k, v) -> {
                String key = k.toString();
                if (key.startsWith(DONE_PREFIX)) {
                    sequences.putIfAbsent(key, v.toString());
                } else if (!keep.contains(key)) {
                    sequences.setProperty(key, Long.toString(Math.max(sequence(sequences, key), parseSequence(v.toString()))));
                }
            });
            for (TsvTable<?> table : tables.values()) {
                if (keep.contains(table.name())) {
                    continue;
                }
                TreeMap<Long, ?> rows = table.parse(dump.tables().getOrDefault(table.name(), List.of()));
                work.rows.put(table, rows);
                work.dirty.add(table);
                written.add(table.name());
                if (!rows.isEmpty()) {
                    sequences.setProperty(table.name(), Long.toString(Math.max(sequence(sequences, table.name()), rows.lastKey())));
                }
            }
            work.sequences = sequences;
            work.sequencesChanged = true;
            return written;
        });
    }

    private static long sequence(Properties sequences, String table) {
        return parseSequence(sequences.getProperty(table, "0"));
    }

    private static long parseSequence(String value) {
        try {
            return Long.parseLong(value.strip());
        } catch (NumberFormatException e) {
            throw new StorageException("Not an id sequence: " + value, e);
        }
    }

    private <T extends Identifiable> List<List<String>> encodeRows(TsvTable<T> table) {
        return table.encode(rows(table).values());
    }

    // ================================================================== transactions

    public boolean isInTransaction() {
        return currentWork.get() != null;
    }

    /** Starts a unit of work; the calling thread holds the exclusive locks until commit or rollback. */
    public void begin() {
        if (isInTransaction()) {
            throw new IllegalStateException("A transaction is already active on this thread");
        }
        if (lock.getReadHoldCount() > 0) {
            throw new IllegalStateException("This request is read-only and cannot change data");
        }
        lock.writeLock().lock();
        try {
            currentWork.set(new UnitOfWork(lockFile()));   // the file lock first: another process may be writing
            storage.refresh();   // the unit of work reads what the storage holds now, never an earlier read
        } catch (RuntimeException e) {
            UnitOfWork work = currentWork.get();
            currentWork.remove();
            if (work != null) {
                work.release();
            }
            lock.writeLock().unlock();
            throw e;
        }
    }

    public void commit() {
        UnitOfWork work = currentWork.get();
        if (work == null) {
            return;
        }
        Set<String> changed = new LinkedHashSet<>();
        try {
            if (!work.rollbackOnly) {
                storeListeners.forEach(StoreListener::beforeCommit);
            }
            if (!work.rollbackOnly && (!work.dirty.isEmpty() || work.sequencesChanged)) {
                Map<String, List<List<String>>> written = new LinkedHashMap<>();
                for (TsvTable<?> table : work.dirty) {
                    written.put(table.name(), encode(table, work));
                    changed.add(table.name());
                }
                try {
                    storage.write(written, work.sequencesChanged ? work.sequences : null);
                } catch (RuntimeException e) {
                    work.dirty.forEach(parsed::remove);   // some of it may have been written: read it all again
                    throw e;
                }
                work.dirty.forEach(table -> remember(table, work.rows.get(table)));   // what was written is the current version
            }
        } finally {
            end(work);
        }
        if (!changed.isEmpty()) {
            commitListeners.forEach(listener -> {
                try {
                    listener.accept(changed);
                } catch (RuntimeException e) {
                    log.warn("Commit listener failed: {}", e.getMessage());
                }
            });
        }
    }

    public void rollback() {
        UnitOfWork work = currentWork.get();
        if (work != null) {
            end(work); // nothing was written: the working copies are simply dropped
        }
    }

    public void setRollbackOnly() {
        UnitOfWork work = currentWork.get();
        if (work != null) {
            work.rollbackOnly = true;
        }
    }

    public boolean isRollbackOnly() {
        UnitOfWork work = currentWork.get();
        return work != null && work.rollbackOnly;
    }

    private void end(UnitOfWork work) {
        currentWork.remove();
        storage.forget();
        try {
            storeListeners.forEach(StoreListener::afterEnd);
            work.release();
        } finally {
            lock.writeLock().unlock();
        }
    }

    /** Rows and sequences of the tables touched by the current transaction, loaded fresh from disk. */
    private final class UnitOfWork {
        private final Map<TsvTable<?>, TreeMap<Long, ?>> rows = new IdentityHashMap<>();
        private final Set<TsvTable<?>> dirty = new LinkedHashSet<>();
        private final FileChannel channel;
        private final FileLock fileLock;
        private Properties sequences;
        private boolean sequencesChanged;
        private boolean rollbackOnly;

        UnitOfWork(Path lockFile) {
            try {
                this.channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                this.fileLock = channel.lock();   // waits while another process is writing
            } catch (IOException e) {
                throw new StorageException("Cannot lock the data folder " + dataDir, e);
            }
        }

        @SuppressWarnings("unchecked")
        <T extends Identifiable> TreeMap<Long, T> rows(TsvTable<T> table) {
            // its own copy of the map: the rows themselves are never changed in place, a save puts a new one
            return (TreeMap<Long, T>) rows.computeIfAbsent(table, t -> new TreeMap<>(current(table)));
        }

        Properties sequences() {
            if (sequences == null) {
                sequences = storage.readSequences();
            }
            return sequences;
        }

        long nextId(TsvTable<?> table, TreeMap<Long, ?> current) {
            long stored = Long.parseLong(sequences().getProperty(table.name(), "0"));
            long next = Math.max(stored, current.isEmpty() ? 0 : current.lastKey()) + 1;
            sequences.setProperty(table.name(), Long.toString(next));
            sequencesChanged = true;
            return next;
        }

        void release() {
            try {
                fileLock.release();
                channel.close();
            } catch (IOException e) {
                log.warn("Could not release the data folder lock: {}", e.getMessage());
            }
        }
    }

    // ================================================================== internals

    /** A table as parsed from the version of the storage that {@code stamp} identifies; never changed afterwards. */
    private record Parsed<T>(Object stamp, TreeMap<Long, T> rows) {
    }

    private <T extends Identifiable> TreeMap<Long, T> rows(TsvTable<T> table) {
        UnitOfWork work = currentWork.get();
        if (work != null) {
            return work.rows(table);
        }
        boolean locked = lock.getReadHoldCount() == 0;
        if (locked) {
            lock.readLock().lock();   // never read a table while this process is half-way through a commit
        }
        try {
            return current(table);
        } finally {
            if (locked) {
                lock.readLock().unlock();
            }
        }
    }

    /**
     * The table as the storage holds it now: the shared parse when the storage still reports the version it was
     * parsed from, else parsed again (and shared). Callers must not change the map or its rows.
     */
    @SuppressWarnings("unchecked")
    private <T extends Identifiable> TreeMap<Long, T> current(TsvTable<T> table) {
        Object stamp = table.stamp();
        Parsed<T> last = (Parsed<T>) parsed.get(table);
        if (last != null && stamp != null && stamp.equals(last.stamp())) {
            return last.rows();
        }
        // the stamp is taken before reading: if the table changes in between, the next read sees a newer stamp
        TreeMap<Long, T> rows = table.read();
        if (stamp != null) {
            parsed.put(table, new Parsed<>(stamp, rows));
        }
        return rows;
    }

    /** A committed table: what was written is the version the storage now reports. */
    private <T extends Identifiable> void remember(TsvTable<T> table, TreeMap<Long, ?> rows) {
        try {
            Object stamp = table.stamp();
            if (stamp != null) {
                parsed.put(table, new Parsed<>(stamp, rows));
                return;
            }
        } catch (RuntimeException e) {
            log.debug("Could not stamp {} after writing it: {}", table.name(), e.getMessage());
        }
        parsed.remove(table);
    }

    /** Joins the current transaction, or wraps the action in its own implicit one. */
    private <R> R write(Supplier<R> action) {
        if (isInTransaction()) {
            return action.get();
        }
        begin();
        try {
            R result = action.get();
            commit();
            return result;
        } catch (RuntimeException e) {
            rollback();
            throw e;
        }
    }

    private UnitOfWork work() {
        UnitOfWork work = currentWork.get();
        if (work == null) {
            throw new IllegalStateException("Writes need a unit of work");
        }
        return work;
    }

    @SuppressWarnings("unchecked")
    private <T extends Identifiable> List<List<String>> encode(TsvTable<T> table, UnitOfWork work) {
        return table.encode(((TreeMap<Long, T>) work.rows.get(table)).values());
    }

    @SuppressWarnings("unchecked")
    private <T extends Identifiable> TsvTable<T> table(Class<T> type) {
        TsvTable<T> table = (TsvTable<T>) tables.get(type);
        if (table == null) {
            throw new IllegalStateException("No table registered for " + type.getName());
        }
        return table;
    }

    private <T extends Identifiable> T saveRow(TsvTable<T> table, T entity, boolean keepVersion) {
        UnitOfWork work = work();
        TreeMap<Long, T> rows = work.rows(table);
        EntityMetadata<T> meta = table.meta();
        T row = meta.copy(entity);
        T existing = row.getId() == null ? null : rows.get(row.getId());
        Class<T> type = meta.type();
        for (StoreListener listener : storeListeners) {
            listener.beforeSave(type, existing == null ? null : meta.copy(existing), row);
        }

        validateBean(meta, row);
        validateColumns(meta, row);
        if (row.getId() == null) {
            row.setId(work.nextId(table, rows));
        }
        if (keepVersion && existing != null) {
            meta.versionColumn().ifPresent(v -> v.write(row, v.read(existing)));
        } else {
            checkVersion(meta, existing, row);
        }
        validateUniqueKeys(rows.values(), meta, row);
        validateForeignKeys(meta, row);

        work.dirty.add(table);
        rows.put(row.getId(), row);
        entity.setId(row.getId()); // like JPA, the caller's instance receives the generated id
        meta.versionColumn().ifPresent(v -> v.write(entity, v.read(row)));
        for (StoreListener listener : storeListeners) {
            listener.afterSave(type, existing == null ? null : meta.copy(existing), meta.copy(row));
        }
        return meta.copy(row);
    }

    /**
     * Optimistic locking: a row carrying a version must match the version on disk; the stored version
     * then goes up by one. A row without a version (an internal update) simply takes the next one.
     */
    private static <T> void checkVersion(EntityMetadata<T> meta, T existing, T row) {
        meta.versionColumn().ifPresent(column -> {
            if (existing == null) {
                column.write(row, 0L);
                return;
            }
            Long current = (Long) column.read(existing);
            Long expected = (Long) column.read(row);
            long base = current == null ? 0 : current;
            if (expected != null && expected != base) {
                throw new ConcurrentUpdateException(meta.tableName(), ((Identifiable) row).getId());
            }
            column.write(row, base + 1);
        });
    }

    private <T extends Identifiable> void deleteRow(TsvTable<T> table, Long id) {
        UnitOfWork work = work();
        TreeMap<Long, T> rows = work.rows(table);
        if (rows.get(id) == null) {
            return;
        }
        Class<?> type = table.meta().type();
        for (TsvTable<?> other : tables.values()) {
            for (ColumnMeta fk : other.meta().foreignKeys()) {
                if (fk.references() != type) {
                    continue;
                }
                boolean referenced = work.rows(other).values().stream().anyMatch(r -> id.equals(fk.read(r)));
                if (referenced) {
                    throw new DataIntegrityException("Cannot delete " + table.meta().tableName() + " #" + id
                            + ": it is still referenced by " + other.meta().tableName() + "." + fk.name());
                }
            }
        }
        work.dirty.add(table);
        T removed = rows.remove(id);
        for (StoreListener listener : storeListeners) {
            listener.afterDelete(type, table.meta().copy(removed));
        }
    }

    private <T> void validateBean(EntityMetadata<T> meta, T row) {
        Set<ConstraintViolation<T>> violations = validator.validate(row);
        if (!violations.isEmpty()) {
            String detail = violations.stream()
                    .map(v -> v.getPropertyPath() + " " + v.getMessage())
                    .sorted()
                    .collect(Collectors.joining("; "));
            throw new DataIntegrityException(meta.tableName() + ": " + detail);
        }
    }

    private <T> void validateColumns(EntityMetadata<T> meta, T row) {
        for (ColumnMeta column : meta.columns()) {
            if (column.id() || column.version()) {
                continue; // generated after validation when missing
            }
            Object value = column.read(row);
            if (value instanceof String s && s.isBlank()) {
                column.write(row, null); // blank text is stored as NULL
                value = null;
            }
            if (value == null && !column.nullable()) {
                throw new DataIntegrityException(meta.tableName() + "." + column.name() + " must not be empty");
            }
            if (value instanceof String s && s.length() > column.length()) {
                throw new DataIntegrityException(meta.tableName() + "." + column.name()
                        + " exceeds maximum length " + column.length());
            }
        }
    }

    private static <T extends Identifiable> void validateUniqueKeys(Collection<T> rows, EntityMetadata<T> meta, T row) {
        for (List<ColumnMeta> key : meta.uniqueKeys()) {
            List<Object> values = key.stream().map(c -> c.read(row)).toList();
            if (values.contains(null)) {
                continue; // SQL semantics: NULLs never collide
            }
            boolean duplicate = rows.stream()
                    .filter(other -> !other.getId().equals(row.getId()))
                    .anyMatch(other -> sameKey(key, values, other));
            if (duplicate) {
                String columns = key.stream().map(ColumnMeta::name).collect(Collectors.joining(", "));
                String shown = key.stream().filter(c -> !c.name().equals("organizationId"))
                        .map(c -> String.valueOf(c.read(row))).collect(Collectors.joining(", "));
                throw new DataIntegrityException("Duplicate value '" + shown + "' for unique key ("
                        + columns + ") in " + meta.tableName());
            }
        }
    }

    private static boolean sameKey(List<ColumnMeta> key, List<Object> values, Object other) {
        for (int i = 0; i < key.size(); i++) {
            Object a = values.get(i);
            Object b = key.get(i).read(other);
            boolean equal = switch (a) {
                case String s when b instanceof String t -> s.equalsIgnoreCase(t);
                case BigDecimal d when b instanceof BigDecimal e -> d.compareTo(e) == 0;
                default -> Objects.equals(a, b);
            };
            if (!equal) {
                return false;
            }
        }
        return true;
    }

    private <T> void validateForeignKeys(EntityMetadata<T> meta, T row) {
        for (ColumnMeta fk : meta.foreignKeys()) {
            Object value = fk.read(row);
            if (value == null) {
                continue;
            }
            TsvTable<?> target = tables.get(fk.references());
            if (target == null || work().rows(target).get((Long) value) == null) {
                throw new DataIntegrityException(meta.tableName() + "." + fk.name() + " refers to missing "
                        + fk.references().getSimpleName() + " #" + value);
            }
        }
    }

    // ------------------------------------------------------------------ lock file

    private Path lockFile() {
        return dataDir.resolve(".lock");
    }
}
