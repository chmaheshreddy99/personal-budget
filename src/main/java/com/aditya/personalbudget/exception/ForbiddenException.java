package com.aditya.personalbudget.exception;

/** HTTP 403 - signed in, but the role does not allow the action. */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
