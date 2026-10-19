package com.aditya.personalbudget.exception;

/** HTTP 404 - the row does not exist (or belongs to another tenant). */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String what, Object id) {
        super(what + " #" + id + " was not found");
    }
}
