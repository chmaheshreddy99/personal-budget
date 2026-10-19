package com.aditya.personalbudget.domain.type;

/**
 * User roles, from most to least privileged.
 * Which role may do what is defined in {@link com.aditya.personalbudget.security.RolePolicy}.
 */
public enum UserRole {

    SUPER_ADMIN("Super Admin", "Platform owner: manages all tenants and users"),
    ADMIN("Admin", "Full control of one tenant, including users"),
    MANAGER("Manager", "Manages accounts, chits, budgets and transactions"),
    ACCOUNTANT("Accountant", "Posts and edits transactions and journals"),
    MEMBER("Member", "Posts own day-to-day income and expenses"),
    VIEWER("Viewer", "Read-only access to dashboards and reports");

    private final String label;
    private final String description;

    UserRole(String label, String description) {
        this.label = label;
        this.description = description;
    }

    public String getLabel() {
        return label;
    }

    public String getDescription() {
        return description;
    }
}
