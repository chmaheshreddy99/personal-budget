package com.aditya.personalbudget.domain.type;

import java.util.Arrays;
import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The sections of the app (its menu items) an organization has and an admin can share with a user, on the desktop
 * and, for those marked {@code mobile}, in the mobile version. A user gets the sections shared with them that their
 * organization has; their role still decides what they may change inside a section (and Activity needs a role
 * that approves entries). Users &amp; roles, Data integrity and Settings go by role, not by sharing.
 */
public enum Feature {

    DASHBOARD("Dashboard", true),
    EXPENSES("Expenses", true),
    INCOME("Income", true),
    JOURNAL("Journal", true),
    ACCOUNTS("Accounts", true),
    CHITS("Chits", true),
    /** Host a Chit: chits the organization runs as organiser (desktop only). */
    HOST_CHITS("Host a Chit", false),
    BUDGETS("Budgets", true),
    BALANCE_SHEET("Balance sheet", true),
    REPORTS("Reports", true),
    FORECAST("Forecast", true),
    GIFTS("Gifts", true),
    DOCUMENTS("Documents", true),
    /** The construction business: projects, their money, sales and agreements (desktop only). */
    CONSTRUCTION("Construction", false),
    /** Who changed what, approvals and access links (also needs a role that approves entries). */
    ACTIVITY("Activity", false);

    private final String label;
    private final boolean mobile;

    Feature(String label, boolean mobile) {
        this.label = label;
        this.mobile = mobile;
    }

    public String getLabel() {
        return label;
    }

    /** Available in the mobile version. */
    public boolean isMobile() {
        return mobile;
    }

    public static Set<Feature> all() {
        return Collections.unmodifiableSet(EnumSet.allOf(Feature.class));
    }

    public static Set<Feature> allMobile() {
        return Arrays.stream(values()).filter(Feature::isMobile).collect(Collectors.toCollection(() -> EnumSet.noneOf(Feature.class)));
    }

    /** "EXPENSES,CHITS" -> the set; blank means every feature (nothing was limited). Unknown names are ignored. */
    public static Set<Feature> parse(String stored, Set<Feature> whenBlank) {
        if (stored == null || stored.isBlank()) {
            return whenBlank;
        }
        Set<Feature> set = EnumSet.noneOf(Feature.class);
        for (String name : stored.split(",")) {
            Arrays.stream(values()).filter(f -> f.name().equals(name.trim())).findFirst().ifPresent(set::add);
        }
        return set;
    }

    /** The set as stored: null when it holds every feature of {@code all} (i.e. not limited). */
    public static String format(Set<Feature> features, Set<Feature> all) {
        if (features == null || features.containsAll(all)) {
            return null;
        }
        return features.stream().sorted().map(Enum::name).collect(Collectors.joining(","));
    }
}
