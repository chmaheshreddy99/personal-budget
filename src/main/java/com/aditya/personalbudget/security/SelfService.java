package com.aditya.personalbudget.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a write endpoint that any signed-in user may call for themselves (sign out, change their own
 * password), whatever their role. Every other write endpoint must declare a {@link RequiresPermission};
 * one that declares neither is refused.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface SelfService {
}
