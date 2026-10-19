package com.aditya.personalbudget.storage;

/**
 * Raised when a {@code .tbl} file cannot be read or written.
 */
public class StorageException extends RuntimeException {

    public StorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
