package com.aditya.personalbudget.storage;

/**
 * Raised when a save is based on an older version of a row than the one on disk: someone else
 * changed it in the meantime (optimistic locking, see {@code @Version}). The caller should reload.
 */
public class ConcurrentUpdateException extends DataIntegrityException {

    public ConcurrentUpdateException(String table, Long id) {
        super("This " + describe(table) + " was changed by someone else a moment ago (#" + id
                + "). It has been reloaded; check it and apply your change again.");
    }

    private static String describe(String table) {
        String name = table.endsWith("ies") ? table.substring(0, table.length() - 3) + "y"
                : table.endsWith("s") ? table.substring(0, table.length() - 1) : table;
        return name.replace('_', ' ');
    }
}
