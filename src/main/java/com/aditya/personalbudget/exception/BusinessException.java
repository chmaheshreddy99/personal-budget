package com.aditya.personalbudget.exception;

/** HTTP 422 - the request is well formed but breaks a business or accounting rule. */
public class BusinessException extends RuntimeException {

    public BusinessException(String message) {
        super(message);
    }
}
