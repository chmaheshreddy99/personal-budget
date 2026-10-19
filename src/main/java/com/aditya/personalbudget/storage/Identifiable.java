package com.aditya.personalbudget.storage;

/**
 * Every row stored in a {@code .tbl} file has a numeric surrogate primary key.
 */
public interface Identifiable {

    Long getId();

    void setId(Long id);
}
