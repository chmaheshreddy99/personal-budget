package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.type.Feature;

import java.util.EnumSet;
import java.util.Set;

import static com.aditya.personalbudget.domain.type.Feature.ACCOUNTS;
import static com.aditya.personalbudget.domain.type.Feature.BALANCE_SHEET;
import static com.aditya.personalbudget.domain.type.Feature.BUDGETS;
import static com.aditya.personalbudget.domain.type.Feature.CHITS;
import static com.aditya.personalbudget.domain.type.Feature.DASHBOARD;
import static com.aditya.personalbudget.domain.type.Feature.EXPENSES;
import static com.aditya.personalbudget.domain.type.Feature.DOCUMENTS;
import static com.aditya.personalbudget.domain.type.Feature.FORECAST;
import static com.aditya.personalbudget.domain.type.Feature.GIFTS;
import static com.aditya.personalbudget.domain.type.Feature.INCOME;
import static com.aditya.personalbudget.domain.type.Feature.JOURNAL;
import static com.aditya.personalbudget.domain.type.Feature.REPORTS;

/**
 * Which shared sections ({@link Feature}) an API call needs: at least one of them must be shared with the user.
 * <ul>
 *   <li>a change needs the section that owns it (a chit payment needs Chits, a budget needs Budgets ...);</li>
 *   <li>a read is allowed to every section whose screen shows that data (the expense dialog shows the budget,
 *       the Income page shows chit gains, any expanded row shows its journal entry ...);</li>
 *   <li>accounts, categories, suggestions, attachments, the footer figures and sign-in stay open to every user:
 *       every screen needs them.</li>
 * </ul>
 * The role ({@link RolePolicy}) is checked as well: sharing a section never lets a viewer change anything.
 */
public final class FeaturePolicy {

    private FeaturePolicy() {
    }

    /** The features granted to a user for a desktop or a mobile session. */
    public static Set<Feature> granted(AppUser user, boolean mobile) {
        Set<Feature> desktop = Feature.parse(user.getFeatures(), Feature.all());
        if (!mobile) {
            return desktop;
        }
        if (Boolean.FALSE.equals(user.getMobileAccess())) {
            return EnumSet.noneOf(Feature.class);
        }
        // on the phone: the mobile sections shared with the user, never more than their desktop sections
        Set<Feature> set = EnumSet.noneOf(Feature.class);
        set.addAll(Feature.parse(user.getMobileFeatures(), Feature.allMobile()));
        set.retainAll(desktop);
        set.removeIf(f -> !f.isMobile());
        return set;
    }

    /** May the user (with these features) make this call? */
    public static boolean allows(Set<Feature> granted, String method, String uri) {
        Set<Feature> needed = required(method, uri);
        return needed == null || needed.stream().anyMatch(granted::contains);
    }

    /**
     * Extra limits for a session opened with an access link: it may only record expenses (when the link is a
     * recorder link) and sign out; what every signed-in user may otherwise read (balances, the footer figures,
     * history) needs the matching section on the link.
     */
    public static boolean allowsLink(CurrentUser user, String method, String uri) {
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        String path = uri.startsWith("/api/") ? uri.substring(4) : uri;
        Set<Feature> f = user.features();
        if (!read) {
            boolean recorder = f.contains(EXPENSES) && RolePolicy.allows(user.role(), Permission.POST_TRANSACTIONS);
            return path.equals("/auth/logout") || (recorder && "POST".equals(method)
                    && (path.equals("/expenses") || path.equals("/attachments")   // evidence: only on what it recorded
                        || path.matches("/approvals/\\d+/(resubmit|withdraw)")));   // correct / take back what it recorded
        }
        if (path.startsWith("/admin") || path.startsWith("/activity") || path.equals("/approvals") || path.startsWith("/approvals/count")) return false;
        if (!user.mobile()) {
            // a full-app link: the screens of the shared sections need the same reads as for a signed-in user;
            // allows() below still limits each call to its sections
            return true;
        }
        if (path.startsWith("/pulse")) return f.contains(DASHBOARD);
        if (path.startsWith("/transactions")) return f.contains(DASHBOARD) || f.contains(JOURNAL) || f.contains(INCOME);
        if (path.startsWith("/accounts") || path.startsWith("/reports/ledger")) return f.contains(ACCOUNTS);
        if (path.startsWith("/suggestions") || path.startsWith("/categories")) return f.contains(EXPENSES) || f.contains(BUDGETS) || f.contains(INCOME);
        if (path.startsWith("/admin") || path.startsWith("/activity") || path.equals("/approvals") ) return false;
        if (path.startsWith("/attachments")) return f.contains(DOCUMENTS);   // only document scans (checked again by the service)
        return true;
    }

    /** The features that open this call (any one is enough), or null when the call is open to every user. */
    static Set<Feature> required(String method, String uri) {
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        String path = uri.startsWith("/api/") ? uri.substring(4) : uri;

        if (path.startsWith("/dashboard")) return EnumSet.of(DASHBOARD);
        if (path.startsWith("/forecast")) return EnumSet.of(FORECAST);
        if (path.startsWith("/reports/balance-sheet")) return EnumSet.of(BALANCE_SHEET, REPORTS, DASHBOARD);
        if (path.startsWith("/reports/ledger")) return EnumSet.of(ACCOUNTS, REPORTS);
        if (path.startsWith("/reports")) return EnumSet.of(REPORTS);

        if (path.startsWith("/gifts")) return EnumSet.of(GIFTS);
        if (path.startsWith("/documents")) return EnumSet.of(DOCUMENTS);
        if (path.startsWith("/chits")) {
            return read ? EnumSet.of(CHITS, DASHBOARD, INCOME, FORECAST, REPORTS, JOURNAL) : EnumSet.of(CHITS);
        }
        if (path.startsWith("/budgets") || path.startsWith("/recurring")) {
            return read ? EnumSet.of(BUDGETS, EXPENSES, DASHBOARD) : EnumSet.of(BUDGETS);
        }
        if (path.startsWith("/expenses")) {
            return read ? EnumSet.of(EXPENSES, BUDGETS, DASHBOARD) : EnumSet.of(EXPENSES);
        }
        if (path.startsWith("/claims")) {
            return read ? EnumSet.of(EXPENSES, ACCOUNTS, JOURNAL, INCOME, BUDGETS, DASHBOARD) : EnumSet.of(EXPENSES, ACCOUNTS);
        }
        if (path.startsWith("/accounts") && !read) return EnumSet.of(ACCOUNTS);
        if (path.startsWith("/transactions")) {
            if (read) return EnumSet.of(JOURNAL, EXPENSES, INCOME, ACCOUNTS, BUDGETS, CHITS, DASHBOARD);
            if (path.startsWith("/transactions/quick")) return EnumSet.of(EXPENSES, INCOME, ACCOUNTS, JOURNAL, DASHBOARD);
            if (path.endsWith("/reverse")) return EnumSet.of(JOURNAL, EXPENSES, INCOME, ACCOUNTS);
            return EnumSet.of(JOURNAL);
        }
        return null;
    }
}
