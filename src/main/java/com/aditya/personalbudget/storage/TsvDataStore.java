package com.aditya.personalbudget.storage;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.IdentityHashMap;
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
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * The "database": a set of {@link TsvTable}s living in the data directory.
 * <p>
 * <b>No data is kept in memory between requests.</b> Every read goes to the {@code .tbl} files:
 * <ul>
 *   <li>Within one request a table is parsed once and reused; it is parsed again as soon as the file
 *       changes on disk (another request committed, another server process, or a manual edit).
 *       {@link #endRequest()} drops these views when the request ends.</li>
 *   <li>A read-only request ({@link #beginReadOnly()}) holds the shared lock, so it sees every table as of
 *       one moment and can never write (an attempt fails).</li>
 *   <li>A transaction takes the exclusive lock (in this JVM) plus an OS file lock on {@code data/.lock}
 *       (across processes), loads the tables it touches fresh from disk, and writes the changed tables on
 *       commit. Rollback simply forgets the changes: nothing reached the disk.</li>
 * </ul>
 * Constraints are enforced on every write: NOT NULL, LENGTH, UNIQUE, FOREIGN KEY, bean validation, and
 * optimistic locking for entities with a {@code @Version} column (a save carrying an older version than the
 * one on disk is rejected with {@link ConcurrentUpdateException}). Ids come from a persisted sequence, so a
 * deleted id is never handed out again.
 */
@Component
public class TsvDataStore {

    private static final Logger log = LoggerFactory.getLogger(TsvDataStore.class);
    private static final String SEQUENCE_FILE = "sequences.properties";

    private final Path dataDir;
    private final Validator validator;
    private final Map<Class<?>, TsvTable<?>> tables = new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock(true);
    private final ThreadLocal<UnitOfWork> currentWork = new ThreadLocal<>();
    private final ThreadLocal<Map<TsvTable<?>, View<?>>> views = ThreadLocal.withInitial(IdentityHashMap::new);
    /** Bumped on every commit in this process, so a request never reuses a view older than a local write. */
    private final AtomicLong generation = new AtomicLong();
    private final List<Consumer<Set<String>>> commitListeners = new CopyOnWriteArrayList<>();

    public TsvDataStore(@Value("${budget.data-dir:data}") String dataDir, Validator validator) {
        this.dataDir = Path.of(dataDir).toAbsolutePath().normalize();
        this.validator = validator;
        try {
            Files.createDirectories(this.dataDir);
        } catch (IOException e) {
            throw new StorageException("Cannot create data directory " + this.dataDir, e);
        }
        log.info("Tab-separated data store at {} (read from disk on demand)", this.dataDir);
    }

    public Path dataDir() {
        return dataDir;
    }

    /** Creates (or opens) the {@code .tbl} file for an entity type. Called by each repository. */
    public <T extends Identifiable> void register(Class<T> type) {
        tables.computeIfAbsent(type, t -> new TsvTable<>(EntityMetadata.of(type), dataDir));
    }

    /** Called after every successful commit with the names of the tables that changed. */
    public void addCommitListener(Consumer<Set<String>> listener) {
        commitListeners.add(listener);
    }

    // ================================================================== request scope

    /** Marks the current request read-only: a consistent view of all tables, and no writes. */
    public void beginReadOnly() {
        lock.readLock().lock();
    }

    /** Ends the request: releases a read-only lock if held and forgets every table read. */
    public void endRequest() {
        views.remove();
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
        return write(() -> saveRow(table(type), entity));
    }

    public <T extends Identifiable> List<T> saveAll(Class<T> type, Collection<? extends T> entities) {
        return write(() -> {
            TsvTable<T> table = table(type);
            List<T> saved = new ArrayList<>(entities.size());
            for (T e : entities) {
                saved.add(saveRow(table, e));
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
            currentWork.set(new UnitOfWork(lockFile()));
        } catch (RuntimeException e) {
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
                for (TsvTable<?> table : work.dirty) {
                    writeTable(table, work);
                    changed.add(table.name());
                }
                if (work.sequencesChanged) {
                    writeSequences(work.sequences);
                }
            }
        } finally {
            end(work);
        }
        if (!changed.isEmpty()) {
            generation.incrementAndGet();
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
        views.remove();
        try {
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
            return (TreeMap<Long, T>) rows.computeIfAbsent(table, t -> table.read());
        }

        long nextId(TsvTable<?> table, TreeMap<Long, ?> current) {
            if (sequences == null) {
                sequences = readSequences();
            }
            long stored = Long.parseLong(sequences.getProperty(table.name(), "0"));
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

    /** A table as read during the current request. */
    private record View<T>(TsvTable.Stamp stamp, long generation, TreeMap<Long, T> rows) {
    }

    @SuppressWarnings("unchecked")
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
            TsvTable.Stamp stamp = table.stamp();
            long gen = generation.get();
            View<T> view = (View<T>) views.get().get(table);
            if (view != null && Objects.equals(view.stamp(), stamp) && view.generation() == gen) {
                return view.rows();
            }
            TreeMap<Long, T> rows = table.read();
            views.get().put(table, new View<>(stamp, gen, rows));
            return rows;
        } finally {
            if (locked) {
                lock.readLock().unlock();
            }
        }
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
    private <T extends Identifiable> void writeTable(TsvTable<T> table, UnitOfWork work) {
        table.write(((TreeMap<Long, T>) work.rows.get(table)).values());
    }

    @SuppressWarnings("unchecked")
    private <T extends Identifiable> TsvTable<T> table(Class<T> type) {
        TsvTable<T> table = (TsvTable<T>) tables.get(type);
        if (table == null) {
            throw new IllegalStateException("No table registered for " + type.getName());
        }
        return table;
    }

    private <T extends Identifiable> T saveRow(TsvTable<T> table, T entity) {
        UnitOfWork work = work();
        TreeMap<Long, T> rows = work.rows(table);
        EntityMetadata<T> meta = table.meta();
        T row = meta.copy(entity);

        validateBean(meta, row);
        validateColumns(meta, row);
        if (row.getId() == null) {
            row.setId(work.nextId(table, rows));
        }
        checkVersion(meta, rows.get(row.getId()), row);
        validateUniqueKeys(rows.values(), meta, row);
        validateForeignKeys(meta, row);

        work.dirty.add(table);
        rows.put(row.getId(), row);
        entity.setId(row.getId()); // like JPA, the caller's instance receives the generated id
        meta.versionColumn().ifPresent(v -> v.write(entity, v.read(row)));
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
        rows.remove(id);
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
                String shown = key.stream().filter(c -> !c.name().equals("tenantId"))
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

    // ------------------------------------------------------------------ lock file and sequences

    private Path lockFile() {
        return dataDir.resolve(".lock");
    }

    private Properties readSequences() {
        Properties p = new Properties();
        Path file = dataDir.resolve(SEQUENCE_FILE);
        if (Files.exists(file)) {
            try (InputStream in = Files.newInputStream(file)) {
                p.load(in);
            } catch (IOException e) {
                throw new StorageException("Cannot read " + file, e);
            }
        }
        return p;
    }

    private void writeSequences(Properties sequences) {
        Path file = dataDir.resolve(SEQUENCE_FILE);
        Path temp = dataDir.resolve(SEQUENCE_FILE + ".tmp");
        try (OutputStream out = Files.newOutputStream(temp)) {
            sequences.store(out, "Last id handed out per table; ids are never reused");
        } catch (IOException e) {
            throw new StorageException("Cannot write " + temp, e);
        }
        try {
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new StorageException("Cannot replace " + file, e);
        }
    }
}
