package com.aditya.personalbudget.storage;

import java.lang.reflect.Field;

/**
 * Mapping and constraint information for one column of a table.
 *
 * @param field      the Java field backing the column
 * @param name       column name as written in the file header
 * @param id         true for the primary key column
 * @param nullable   false means NOT NULL
 * @param length     maximum length for text columns
 * @param unique     single-column UNIQUE constraint
 * @param references referenced entity for a foreign key, or null
 * @param version    true for the optimistic-locking version column ({@code @Version})
 */
public record ColumnMeta(
        Field field,
        String name,
        boolean id,
        boolean nullable,
        int length,
        boolean unique,
        Class<? extends Identifiable> references,
        boolean version) {

    public Class<?> javaType() {
        return field.getType();
    }

    public boolean isText() {
        return field.getType() == String.class;
    }

    public Object read(Object entity) {
        try {
            return field.get(entity);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException("Cannot read column " + name, e);
        }
    }

    public void write(Object entity, Object value) {
        try {
            field.set(entity, value);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException("Cannot write column " + name, e);
        }
    }
}
