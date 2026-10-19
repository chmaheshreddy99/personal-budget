package com.aditya.personalbudget.security;

/**
 * Fine-grained actions guarded by {@link RequiresPermission}.
 */
public enum Permission {

    VIEW("View dashboards, accounts and reports"),
    POST_TRANSACTIONS("Post income, expenses and transfers"),
    MANAGE_JOURNALS("Create, edit and delete journal entries"),
    MANAGE_ACCOUNTS("Create, edit and delete accounts"),
    MANAGE_CHITS("Create chits, pay installments, record payouts"),
    MANAGE_BUDGETS("Maintain budgets and recurring transactions"),
    MANAGE_USERS("Invite users and assign roles in the tenant"),
    APPROVE_ENTRIES("Approve entries recorded through access links and see the activity log"),
    MANAGE_TENANTS("Create and manage tenants (platform level)");

    private final String description;

    Permission(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }

    /** Platform permissions are always enforced, even when role enforcement is switched off. */
    public boolean isPlatformLevel() {
        return this == MANAGE_TENANTS;
    }
}
