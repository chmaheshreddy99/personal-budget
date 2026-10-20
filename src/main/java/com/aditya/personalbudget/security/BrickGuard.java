package com.aditya.personalbudget.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * The Brick Management permissions that open an endpoint: the user's {@link BrickRole} must hold one of them.
 * Checked by {@link AuthInterceptor}, after the app role.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface BrickGuard {
    BrickPermission[] value();
}
