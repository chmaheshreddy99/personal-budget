package com.aditya.personalbudget.storage;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One table = one tab-separated file ({@code data/<table>.tbl}).
 * <p>
 * File layout: the first line is the header with column names, then one row per line.
 * The table holds no rows itself: {@link #read()} parses the file each time it is asked, and
 * {@link #write} rewrites the whole file atomically (temp file, then swap), so a reader never sees a
 * half-written table. Columns are matched by header name, so adding a field to an entity is backward compatible.
 */
final class TsvTable<T extends Identifiable> {

    static final String EXTENSION = ".tbl";
    private static final String SEPARATOR = "\t";

    /** Identifies one version of the file on disk; it changes whenever the file is rewritten. */
    record Stamp(Instant modified, long size, Object fileKey) {
    }

    private final EntityMetadata<T> meta;
    private final Path file;

    TsvTable(EntityMetadata<T> meta, Path dataDir) {
        this.meta = meta;
        this.file = dataDir.resolve(meta.tableName() + EXTENSION);
        if (Files.notExists(file)) {
            write(List.of()); // create the file with its header row
        }
    }

    EntityMetadata<T> meta() {
        return meta;
    }

    String name() {
        return meta.tableName();
    }

    /** The current stamp of the file, or null when it does not exist. */
    Stamp stamp() {
        try {
            BasicFileAttributes attrs = Files.readAttributes(file, BasicFileAttributes.class);
            return new Stamp(attrs.lastModifiedTime().toInstant(), attrs.size(), attrs.fileKey());
        } catch (NoSuchFileException e) {
            return null;
        } catch (IOException e) {
            throw new StorageException("Cannot read attributes of " + file, e);
        }
    }

    /** Parses the file into rows ordered by id. */
    TreeMap<Long, T> read() {
        TreeMap<Long, T> rows = new TreeMap<>();
        try {
            if (Files.notExists(file)) {
                return rows;
            }
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            if (lines.isEmpty()) {
                return rows;
            }
            ColumnMeta[] layout = readHeader(lines.getFirst());
            for (int i = 1; i < lines.size(); i++) {
                String line = lines.get(i);
                if (!line.isBlank()) {
                    T row = parseRow(line, layout, i + 1);
                    rows.put(row.getId(), row);
                }
            }
            return rows;
        } catch (IOException e) {
            throw new StorageException("Cannot load table file " + file, e);
        }
    }

    /** Writes header + all rows to a temp file, then swaps it in so a crash never leaves a half-written table. */
    void write(Collection<T> rows) {
        Path temp = file.resolveSibling(file.getFileName() + ".tmp");
        try (BufferedWriter out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            out.write(String.join(SEPARATOR, meta.columns().stream().map(ColumnMeta::name).toList()));
            out.newLine();
            for (T row : rows) {
                out.write(String.join(SEPARATOR,
                        meta.columns().stream().map(c -> TsvCodec.encode(c.read(row))).toList()));
                out.newLine();
            }
        } catch (IOException e) {
            throw new StorageException("Cannot write table file " + temp, e);
        }
        try {
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new StorageException("Cannot replace table file " + file, e);
        }
    }

    private ColumnMeta[] readHeader(String headerLine) {
        Map<String, ColumnMeta> byName = new HashMap<>();
        meta.columns().forEach(c -> byName.put(c.name(), c));
        String[] names = headerLine.split(SEPARATOR, -1);
        ColumnMeta[] layout = new ColumnMeta[names.length];
        for (int i = 0; i < names.length; i++) {
            layout[i] = byName.get(names[i].strip()); // unknown (removed) columns are ignored
        }
        return layout;
    }

    private T parseRow(String line, ColumnMeta[] layout, int lineNo) {
        String[] cells = line.split(SEPARATOR, -1);
        T row = meta.newInstance();
        try {
            for (int i = 0; i < layout.length && i < cells.length; i++) {
                if (layout[i] != null) {
                    layout[i].write(row, TsvCodec.decode(cells[i], layout[i].javaType()));
                }
            }
        } catch (RuntimeException e) {
            throw new StorageException("Bad data in " + file.getFileName() + " line " + lineNo + ": " + e.getMessage(), e);
        }
        if (row.getId() == null) {
            throw new StorageException("Missing id in " + file.getFileName() + " line " + lineNo, null);
        }
        return row;
    }
}
