package com.aditya.personalbudget.storage;

import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Where the tables physically live: tab-separated files in the data folder ({@link LocalFileStorage}) or the tabs of a
 * Google spreadsheet ({@link GoogleSheetsStorage}). The {@link TsvDataStore} and every repository work the same on
 * either: they hand this layer whole tables as rows of cell text (already encoded by {@link TsvCodec}) and read them
 * back the same way. The first row of a table is always its header with the column names.
 */
public interface TableStorage {

    /** One line for the log: where the data is. */
    String describe();

    /** Creates the table with this header row when it does not exist yet (called once per entity type). */
    void create(String table, List<String> header);

    /**
     * Identifies the current version of a table: it changes whenever the table changes, so a reader knows when a
     * table it parsed before is out of date (the store keeps parsed tables, shared by every request, keyed by this).
     * Two equal stamps of a table must mean the same content. Null when the table does not exist.
     */
    Object stamp(String table);

    /** The header and the rows of a table as cell text; empty when the table does not exist. */
    List<List<String>> read(String table);

    /**
     * Writes the given tables (header + rows each, replacing what was there) and, when not null, the id sequences,
     * as one batch at the end of a unit of work.
     */
    void write(Map<String, List<List<String>>> tables, Properties sequences);

    /** The last id handed out per table. */
    Properties readSequences();

    /**
     * Unpins whatever this thread read so far. Called when a request and a unit of work end; the next read may be
     * served from a copy shared by every thread, as long as it still is what the storage holds.
     */
    default void forget() {
    }

    /**
     * A unit of work starts: what this thread reads next must be what the storage holds now, never a copy kept from
     * an earlier read, so every save is checked (versions, unique keys, references, ids) against the real data.
     */
    default void refresh() {
        forget();
    }

    /** How much is stored, for the footer. */
    Footprint footprint();

    record Footprint(int tables, long bytes) {
    }
}
