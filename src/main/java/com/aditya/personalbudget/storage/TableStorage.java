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
     * table it parsed before is out of date. Null when the table does not exist.
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
     * Drops whatever this thread read so far, so the next read goes to the storage again. Called when a request ends
     * and when a unit of work starts and ends: nothing read is kept between them.
     */
    default void forget() {
    }

    /**
     * A unit of work starts: like {@link #forget()}, and its reads must come from the storage itself, never from a
     * copy kept for reading (a save checks versions and hands out ids against what is really stored).
     */
    default void readFresh() {
        forget();
    }

    /** How much is stored, for the footer. */
    Footprint footprint();

    record Footprint(int tables, long bytes) {
    }
}
