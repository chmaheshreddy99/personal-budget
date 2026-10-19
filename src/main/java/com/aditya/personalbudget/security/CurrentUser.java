package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;

import java.util.Set;

/**
 * The signed-in user of the current request.
 */
public record CurrentUser(
        Long userId,
        String username,
        String fullName,
        UserRole role,
        Long tenantId,
        String tenantCode,
        String tenantName,
        String currency,
        /* sections shared with the user in this session (desktop or mobile) */
        Set<Feature> features,
        /* the session was opened by the mobile version */
        boolean mobile,
        /* the session was opened with this access link (null otherwise) */
        Long linkId,
        /* maker-checker: what this session records waits for approval */
        boolean approval,
        /* still on the default password: only setting a new one is allowed */
        boolean mustChangePassword) {

    public CurrentUser(Long userId, String username, String fullName, UserRole role, Long tenantId, String tenantCode,
                       String tenantName, String currency, Set<Feature> features, boolean mobile, Long linkId, boolean approval) {
        this(userId, username, fullName, role, tenantId, tenantCode, tenantName, currency, features, mobile, linkId, approval, false);
    }

    public CurrentUser(Long userId, String username, String fullName, UserRole role, Long tenantId, String tenantCode,
                       String tenantName, String currency, Set<Feature> features, boolean mobile) {
        this(userId, username, fullName, role, tenantId, tenantCode, tenantName, currency, features, mobile, null, false);
    }

    public boolean viaLink() {
        return linkId != null;
    }
}
