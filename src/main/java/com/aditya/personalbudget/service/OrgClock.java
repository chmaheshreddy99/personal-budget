package com.aditya.personalbudget.service;

import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.function.Function;

/**
 * "Now" and "today" in the organization's time zone (Settings, Organization), so the times recorded and shown are
 * the household's local times even when the server runs in another zone. Without a zone set, or outside a signed-in
 * request, it is the server's zone.
 * <p>
 * The zone is looked up in the organizations table on first use in a request and remembered for that request only
 * (on that thread): {@link UserContext#set} and {@link UserContext#clear} forget it.
 */
public final class OrgClock {

    /** The stored time zone of an organization (null when none is set); installed by {@link OrgTimeZoneService}. */
    private static volatile Function<Long, String> zoneOf = id -> null;

    private record Cached(Long organizationId, ZoneId zone) {
    }

    private static final ThreadLocal<Cached> CURRENT = new ThreadLocal<>();

    private OrgClock() {
    }

    static void install(Function<Long, String> lookup) {
        zoneOf = lookup;
    }

    /** The zone of the signed-in user's organization, else the server's. */
    public static ZoneId zone() {
        Long organization = UserContext.current().map(CurrentUser::tenantId).orElse(null);
        return organization == null ? ZoneId.systemDefault() : zoneOf(organization);
    }

    /** The zone of an organization (the server's when it has none). */
    public static ZoneId zoneOf(Long organizationId) {
        Cached cached = CURRENT.get();
        if (cached != null && cached.organizationId().equals(organizationId)) {
            return cached.zone();
        }
        ZoneId zone = parse(zoneOf.apply(organizationId));
        CURRENT.set(new Cached(organizationId, zone));
        return zone;
    }

    public static LocalDateTime now() {
        return LocalDateTime.now(zone());
    }

    public static LocalDate today() {
        return LocalDate.now(zone());
    }

    public static YearMonth month() {
        return YearMonth.now(zone());
    }

    /** Now in an organization's zone, for code that runs before anyone is signed in (the sign-in itself). */
    public static LocalDateTime nowIn(Long organizationId) {
        return LocalDateTime.now(organizationId == null ? ZoneId.systemDefault() : zoneOf(organizationId));
    }

    /** Forgets the zone remembered on this thread (a new request, or the zone just changed). */
    public static void forget() {
        CURRENT.remove();
    }

    /** A stored zone id, or the server's zone when it is empty or no longer known. */
    static ZoneId parse(String id) {
        if (id == null || id.isBlank()) {
            return ZoneId.systemDefault();
        }
        try {
            return ZoneId.of(id.trim());
        } catch (DateTimeException e) {
            return ZoneId.systemDefault();
        }
    }
}
