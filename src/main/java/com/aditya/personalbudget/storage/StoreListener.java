package com.aditya.personalbudget.storage;

/**
 * Hooks into every write of the {@link TsvDataStore}, whichever way it comes (a repository, a migration writing
 * through the store directly ...). All calls run on the writing thread, inside its unit of work, so whatever a
 * listener saves is committed or rolled back together with the change that triggered it.
 */
public interface StoreListener {

    /**
     * A row is about to be saved: {@code existing} is the row on disk (null for an insert), {@code row} the copy
     * that will be stored. The listener may adjust {@code row} or throw to refuse the write.
     */
    default void beforeSave(Class<?> type, Object existing, Object row) {
    }

    /** A row was saved ({@code existing} null for an insert). */
    default void afterSave(Class<?> type, Object existing, Object row) {
    }

    /** A row was deleted. */
    default void afterDelete(Class<?> type, Object existing) {
    }

    /** The unit of work is about to be written; the listener may still save rows (they are written too). */
    default void beforeCommit() {
    }

    /** The unit of work ended, committed or rolled back. */
    default void afterEnd() {
    }
}
