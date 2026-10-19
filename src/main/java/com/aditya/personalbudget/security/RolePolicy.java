package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.type.UserRole;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static com.aditya.personalbudget.security.Permission.*;

/**
 * The role / permission matrix. Change this one table to change who may do what.
 */
public final class RolePolicy {

    private static final Map<UserRole, Set<Permission>> MATRIX = new EnumMap<>(UserRole.class);

    static {
        MATRIX.put(UserRole.SUPER_ADMIN, EnumSet.allOf(Permission.class));
        MATRIX.put(UserRole.ADMIN, EnumSet.complementOf(EnumSet.of(MANAGE_TENANTS)));
        MATRIX.put(UserRole.MANAGER, EnumSet.of(VIEW, POST_TRANSACTIONS, MANAGE_JOURNALS,
                MANAGE_ACCOUNTS, MANAGE_CHITS, MANAGE_BUDGETS, APPROVE_ENTRIES));
        MATRIX.put(UserRole.ACCOUNTANT, EnumSet.of(VIEW, POST_TRANSACTIONS, MANAGE_JOURNALS));
        MATRIX.put(UserRole.MEMBER, EnumSet.of(VIEW, POST_TRANSACTIONS));
        MATRIX.put(UserRole.VIEWER, EnumSet.of(VIEW));
    }

    private RolePolicy() {
    }

    public static boolean allows(UserRole role, Permission permission) {
        return MATRIX.getOrDefault(role, Set.of()).contains(permission);
    }

    public static Set<Permission> permissionsOf(UserRole role) {
        return EnumSet.copyOf(MATRIX.getOrDefault(role, EnumSet.noneOf(Permission.class)));
    }

    public static Map<UserRole, Set<Permission>> matrix() {
        return Map.copyOf(MATRIX);
    }
}
