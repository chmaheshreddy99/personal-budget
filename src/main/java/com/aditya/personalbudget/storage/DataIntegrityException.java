package com.aditya.personalbudget.storage;

/**
 * Raised when a write would violate a table constraint
 * (NOT NULL, LENGTH, UNIQUE, FOREIGN KEY or a bean-validation CHECK).
 */
public class DataIntegrityException extends RuntimeException {

    public DataIntegrityException(String message) {
        super(message);
    }
}
