package com.aditya.personalbudget.storage;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Foreign key constraint for an id column.
 * <p>
 * On insert/update the referenced row must exist. Deleting the referenced row is rejected
 * while any referencing row exists (ON DELETE RESTRICT).
 *
 * <pre>
 * &#64;References(Account.class)
 * private Long accountId;
 * </pre>
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface References {

    /** The referenced entity type (its {@code @Id} column is the target). */
    Class<? extends Identifiable> value();
}
