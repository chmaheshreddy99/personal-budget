package com.aditya.personalbudget.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares the permission a controller method (or every method of a controller) needs.
 * Checked by {@link AuthInterceptor} on every request against {@link RolePolicy}.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface RequiresPermission {

    Permission value();
}
