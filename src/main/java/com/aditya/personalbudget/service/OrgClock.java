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
 * Time, with the organization's time zone (Settings, Organization):
 * <ul>
 *   <li><b>Recorded times</b> ({@link #now()}: when an entry was made, a sign-in ...) are kept in one fixed zone, the
 *       <i>storage zone</i> ({@code budget.storage-time-zone}, else the server's), whatever organization records
 *       them. So a stored time always means the same moment, and changing an organization's zone moves every time
 *       it sees, old ones included.</li>
 *   <li><b>Shown times</b> are in the organization's zone: {@link #toOrg} turns a recorded time into it (the API does
 *       this for every date-time it sends, see {@code OrgTimeJson}) and {@link #fromOrg} turns one typed in back.</li>
 *   <li><b>Today</b> and the current month ({@link #today()}, {@link #month()}) are the organization's.</li>
 * </ul>
 * Without a zone set, or outside a signed-in request, the organization's zone is the storage zone. The zone is looked
 * up in the organizations table on first use in a request and remembered for that request only (on that thread):
 * {@link UserContext#set} and {@link UserContext#clear} forget it.
 */
public final class OrgClock {

    /** The stored time zone of an organization (null when none is set); installed by {@link OrgTimeZoneService}. */
    private static volatile Function<Long, String> zoneOf = id -> null;
    private static volatile ZoneId storageZone = ZoneId.systemDefault();

    private record Cached(Long organizationId, ZoneId zone) {
    }

    private static final ThreadLocal<Cached> CURRENT = new ThreadLocal<>();
    /** The organization a page opened without signing in (a share link) belongs to, for the rest of the request. */
    private static final ThreadLocal<Long> SHOWN_FOR = new ThreadLocal<>();

    private OrgClock() {
    }

    static void install(Function<Long, String> lookup, ZoneId storage) {
        zoneOf = lookup;
        storageZone = storage;
    }

    /** The zone recorded times are kept in. */
    public static ZoneId storageZone() {
        return storageZone;
    }

    /** The zone of the signed-in user's organization (or of the share link's), else the storage zone. */
    public static ZoneId zone() {
        Long organization = UserContext.current().map(CurrentUser::tenantId).orElse(SHOWN_FOR.get());
        return organization == null ? storageZone : zoneOf(organization);
    }

    /** The zone of an organization (the storage zone when it has none). */
    public static ZoneId zoneOf(Long organizationId) {
        Cached cached = CURRENT.get();
        if (cached != null && cached.organizationId().equals(organizationId)) {
            return cached.zone();
        }
        ZoneId zone = parse(zoneOf.apply(organizationId));
        CURRENT.set(new Cached(organizationId, zone));
        return zone;
    }

    /** Now, to record: in the storage zone. */
    public static LocalDateTime now() {
        return LocalDateTime.now(storageZone);
    }

    /** Today in the organization's zone. */
    public static LocalDate today() {
        return LocalDate.now(zone());
    }

    /** This month in the organization's zone. */
    public static YearMonth month() {
        return YearMonth.now(zone());
    }

    /** A recorded time as the organization's clock shows it. */
    public static LocalDateTime toOrg(LocalDateTime recorded) {
        return convert(recorded, storageZone, zone());
    }

    /** A recorded time as an organization's clock shows it (code that runs before anyone is signed in). */
    public static LocalDateTime toOrg(LocalDateTime recorded, Long organizationId) {
        return convert(recorded, storageZone, organizationId == null ? storageZone : zoneOf(organizationId));
    }

    /** A time on the organization's clock (typed in) as it is recorded. */
    public static LocalDateTime fromOrg(LocalDateTime shown) {
        return convert(shown, zone(), storageZone);
    }

    /** Forgets the zone remembered on this thread (a new request, or the zone just changed). */
    public static void forget() {
        CURRENT.remove();
    }

    /**
     * A page opened without signing in (a share or agreement link) shows this organization's times until the request
     * ends, its answer included (written after the link's own work is done).
     */
    public static void showFor(Long organizationId) {
        SHOWN_FOR.set(organizationId);
    }

    /** The request ended: forget everything about it. */
    public static void endRequest() {
        CURRENT.remove();
        SHOWN_FOR.remove();
    }

    private static LocalDateTime convert(LocalDateTime time, ZoneId from, ZoneId to) {
        return time == null || from.equals(to) ? time : time.atZone(from).withZoneSameInstant(to).toLocalDateTime();
    }

    /** A zone id, or the storage zone when it is empty or not a known zone. */
    static ZoneId parse(String id) {
        if (id == null || id.isBlank()) {
            return storageZone;
        }
        try {
            return ZoneId.of(id.trim());
        } catch (DateTimeException e) {
            return storageZone;
        }
    }
}
