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

    /**
     * The version an edit form was loaded with. An edit must say which version it was made on: one that does not is
     * refused like a stale one (the store would otherwise take it as an internal save and skip the check).
     */
    public static Long required(Long version, String table, Long id) {
        if (version == null) {
            throw new ConcurrentUpdateException(table, id);
        }
        return version;
    }

    /**
     * Refuses an edit made on another version than {@code current}, the version stored now (or on none). Called in
     * the unit of work that saves the edit, which holds the store's exclusive lock: nothing can change in between.
     */
    public static void check(Long version, Long current, String table, Long id) {
        if (!required(version, table, id).equals(current)) {
            throw new ConcurrentUpdateException(table, id);
        }
    }

    private static String describe(String table) {
        String name = table.endsWith("ies") ? table.substring(0, table.length() - 3) + "y"
                : table.endsWith("s") ? table.substring(0, table.length() - 1) : table;
        return name.replace('_', ' ');
    }
}
