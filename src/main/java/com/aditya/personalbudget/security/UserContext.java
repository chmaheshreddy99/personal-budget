package com.aditya.personalbudget.security;

import com.aditya.personalbudget.exception.UnauthorizedException;

/**
 * Holds the {@link CurrentUser} for the request being processed (set by {@link AuthInterceptor}).
 * Services call {@link #tenantId()} to scope every query to the caller's tenant.
 */
public final class UserContext {

    private static final ThreadLocal<CurrentUser> CURRENT = new ThreadLocal<>();
    /** The app the request came from, when not the web app ("BRICKS": the Bricks phone app). */
    private static final ThreadLocal<String> CLIENT = new ThreadLocal<>();

    private UserContext() {
    }

    public static void set(CurrentUser user) {
        CURRENT.set(user);
    }

    public static void clear() {
        CURRENT.remove();
        CLIENT.remove();
    }

    public static void setClient(String client) {
        CLIENT.set(client);
    }

    /** The app the request came from ("BRICKS"), or null for the web app. */
    public static String client() {
        return CLIENT.get();
    }

    public static CurrentUser get() {
        CurrentUser user = CURRENT.get();
        if (user == null) {
            throw new UnauthorizedException("Not signed in");
        }
        return user;
    }

    /** The current user, if the code runs inside a signed-in request. */
    public static java.util.Optional<CurrentUser> current() {
        return java.util.Optional.ofNullable(CURRENT.get());
    }

    public static Long tenantId() {
        return get().tenantId();
    }

    public static String username() {
        CurrentUser user = CURRENT.get();
        return user == null ? "system" : user.username();
    }
}
