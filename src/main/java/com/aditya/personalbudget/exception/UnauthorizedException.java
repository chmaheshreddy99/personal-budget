package com.aditya.personalbudget.exception;

/** HTTP 401 - missing or expired session. */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
