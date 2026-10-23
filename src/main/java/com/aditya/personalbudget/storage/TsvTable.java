package com.aditya.personalbudget.storage;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One table: the rows of one entity type, kept by the {@link TableStorage} (a {@code data/<table>.tbl} file, or a tab
 * of a Google spreadsheet).
 * <p>
 * Layout: the first row is the header with column names, then one row per entity. The table holds no rows itself:
 * {@link #read()} parses what the storage holds each time it is asked, and {@link #encode} turns rows back into cells
 * for the storage to write. Columns are matched by header name, so adding a field to an entity is backward compatible.
 */
final class TsvTable<T extends Identifiable> {

    private final EntityMetadata<T> meta;
    private final TableStorage storage;

    TsvTable(EntityMetadata<T> meta, TableStorage storage) {
        this.meta = meta;
        this.storage = storage;
        storage.create(name(), header()); // the header row of a new table
    }

    EntityMetadata<T> meta() {
        return meta;
    }

    String name() {
        return meta.tableName();
    }

    /** The current version of the table in the storage, or null when it does not exist. */
    Object stamp() {
        return storage.stamp(name());
    }

    /** Parses the table into rows ordered by id. */
    TreeMap<Long, T> read() {
        return parse(storage.read(name()));
    }

    /** Parses cell text (header row first, as the storage holds it) into rows ordered by id. */
    TreeMap<Long, T> parse(List<List<String>> lines) {
        TreeMap<Long, T> rows = new TreeMap<>();
        if (lines.isEmpty()) {
            return rows;
        }
        ColumnMeta[] layout = readHeader(lines.getFirst());
        for (int i = 1; i < lines.size(); i++) {
            List<String> cells = lines.get(i);
            if (!isBlank(cells)) {
                T row = parseRow(cells, layout, i + 1);
                rows.put(row.getId(), row);
            }
        }
        return rows;
    }

    /** Header + all rows as cell text, ready for {@link TableStorage#write}. */
    List<List<String>> encode(Collection<T> rows) {
        List<List<String>> out = new ArrayList<>(rows.size() + 1);
        out.add(header());
        for (T row : rows) {
            out.add(meta.columns().stream().map(c -> TsvCodec.encode(c.read(row))).toList());
        }
        return out;
    }

    private List<String> header() {
        return meta.columns().stream().map(ColumnMeta::name).toList();
    }

    private ColumnMeta[] readHeader(List<String> names) {
        Map<String, ColumnMeta> byName = new HashMap<>();
        meta.columns().forEach(c -> byName.put(c.name(), c));
        ColumnMeta[] layout = new ColumnMeta[names.size()];
        for (int i = 0; i < names.size(); i++) {
            layout[i] = byName.get(names.get(i).strip()); // unknown (removed) columns are ignored
        }
        return layout;
    }

    private T parseRow(List<String> cells, ColumnMeta[] layout, int lineNo) {
        T row = meta.newInstance();
        try {
            for (int i = 0; i < layout.length && i < cells.size(); i++) {
                if (layout[i] != null) {
                    layout[i].write(row, TsvCodec.decode(cells.get(i), layout[i].javaType()));
                }
            }
        } catch (RuntimeException e) {
            throw new StorageException("Bad data in table " + name() + " row " + lineNo + ": " + e.getMessage(), e);
        }
        if (row.getId() == null) {
            throw new StorageException("Missing id in table " + name() + " row " + lineNo, null);
        }
        return row;
    }

    private static boolean isBlank(List<String> cells) {
        return cells.stream().allMatch(c -> c == null || c.isBlank());
    }
}
