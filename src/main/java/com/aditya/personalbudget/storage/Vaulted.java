package com.aditya.personalbudget.storage;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * A large text field of a record (an agreement's wording, a drawn signature, the exact signed evidence) that is kept out of the
 * tables: the store writes it to the record's own file in {@code data/vault/<table>/<id>.properties} when the record is saved and
 * reads it from there each time the record is read, so it is never part of the tables held in memory. The field stays a column
 * only so that rows written before it was vaulted can still be read; {@link TsvDataStore#vaultLegacyRows()} moves those out.
 * Only String fields can be vaulted.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface Vaulted {
}
