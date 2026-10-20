package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.type.UserRole;

import java.util.EnumSet;
import java.util.Set;

import static com.aditya.personalbudget.security.BrickPermission.*;

/**
 * A user's role in Brick Management (maker-checker): the makers record the day's work, the checker (a manager)
 * approves what needs it and is the only one who sees the money. Kept on the user; a user without one gets the role
 * their app role points to ({@link #defaultFor}).
 */
public enum BrickRole {

    MANAGER("Manager", "Everything, approves what waits for a checker, sees the money", EnumSet.allOf(BrickPermission.class)),
    ACCOUNTANT("Accountant", "Records purchases, expenses, batches and orders, and runs deliveries; no profit, totals or balances",
            EnumSet.of(STOCK, PRODUCTION, PURCHASES, BrickPermission.SALES)),
    SUPERVISOR("Production supervisor", "Records batches, raw material purchases and expenses; sees the stock", EnumSet.of(STOCK, PRODUCTION, PURCHASES)),
    SALES("Sales & dispatch", "Takes orders and runs their delivery; sees the stock", EnumSet.of(STOCK, BrickPermission.SALES)),
    STOREKEEPER("Store keeper", "Sees the stock of bricks and raw material, records purchases", EnumSet.of(STOCK, PURCHASES)),
    VIEWER("Stock viewer", "Sees the stock only", EnumSet.of(STOCK)),
    NONE("No access", "Brick Management is closed to them", EnumSet.noneOf(BrickPermission.class));

    private final String label;
    private final String description;
    private final Set<BrickPermission> permissions;

    BrickRole(String label, String description, Set<BrickPermission> permissions) {
        this.label = label;
        this.description = description;
        this.permissions = permissions;
    }

    public String getLabel() {
        return label;
    }

    public String getDescription() {
        return description;
    }

    public Set<BrickPermission> getPermissions() {
        return EnumSet.copyOf(permissions.isEmpty() ? EnumSet.noneOf(BrickPermission.class) : permissions);
    }

    public boolean allows(BrickPermission p) {
        return permissions.contains(p);
    }

    /** The role a user has when none was given: admins and managers run it all, an accountant is the maker, the rest see the stock. */
    public static BrickRole defaultFor(UserRole role) {
        if (role == null) return VIEWER;
        return switch (role) {
            case SUPER_ADMIN, ADMIN, MANAGER -> MANAGER;
            case ACCOUNTANT -> ACCOUNTANT;
            case MEMBER, VIEWER -> VIEWER;
        };
    }

    /**
     * Staff of the business (every role but the manager's): a role like this, once chosen for someone, limits them in
     * the whole application to Brick Management (its screens and its API); the household's money is not theirs to see.
     */
    public boolean isStaff() {
        return this != MANAGER && this != NONE;
    }

    /** The staff role chosen for this user, or null (no role chosen, or one that does not limit the application). */
    public static BrickRole staffOf(String chosen) {
        BrickRole r = parse(chosen);
        return r != null && r.isStaff() ? r : null;
    }

    public static BrickRole parse(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
