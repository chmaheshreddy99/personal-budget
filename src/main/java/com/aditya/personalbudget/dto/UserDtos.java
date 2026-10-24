package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.security.Permission;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.Set;

/**
 * Authentication, users and tenants.
 */
public final class UserDtos {

    private UserDtos() {
    }

    /** {@code client} is "mobile" when the mobile version signs in. */
    public record LoginRequest(@NotBlank String username, @NotBlank String password, String client) {
        public LoginRequest(String username, String password) {
            this(username, password, null);
        }

    }

    /** Self sign-up: creates a new tenant with the caller as its admin. */
    public record RegisterRequest(
            @NotBlank @Size(max = 100) String tenantName,
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,29}", message = "use 2-30 lowercase letters, digits or hyphens")
            String tenantCode,
            @Pattern(regexp = "[A-Z]{3}", message = "must be a 3-letter currency code") String currency,
            @NotBlank @Size(max = 100) String fullName,
            @NotBlank @Size(min = 3, max = 50) String username,
            @Email @Size(max = 120) String email,
            @NotBlank @Size(min = 6, max = 100) String password,
            /* the new organization's time zone (the browser's, "Asia/Kolkata"); empty: the server's */
            @Size(max = 40) String timeZone) {
    }

    public record MeView(Long userId, String username, String fullName, String email, UserRole role, String roleLabel,
                         Long tenantId, String tenantCode, String tenantName, String currency,
                         Set<Permission> permissions, boolean rolesEnforced,
                         /* sections shared with the user in this session, the session kind, the mobile settings */
                         Set<Feature> features, boolean mobile, boolean mobileAccess, Set<Feature> mobileFeatures,
                         String mobilePath,
                         /* opened with an access link: its id, VIEW or RECORD, maker-checker, and when it ends */
                         Long linkId, String linkMode, boolean approval, LocalDateTime linkExpiresAt,
                         /* still on the default password: the app asks for a new one before anything else */
                         boolean mustChangePassword,
                         /* the organization's time zone (its own, else the server's): "today" and times are in it */
                         String timeZone) {
    }

    public record SessionView(String token, MeView user) {
    }

    public record PasswordChangeRequest(@NotBlank String currentPassword, @NotBlank @Size(min = 6, max = 100) String newPassword) {
    }

    public record UserRequest(
            @NotBlank @Size(min = 3, max = 50) String username,
            @NotBlank @Size(max = 100) String fullName,
            @Email @Size(max = 120) String email,
            @Size(min = 6, max = 100) String password,
            UserRole role,
            Boolean active,
            /* null = every section */
            Set<Feature> features,
            Boolean mobileAccess,
            /* null = every mobile section of features */
            Set<Feature> mobileFeatures,
            /* maker-checker: TENANT (follow the household), REQUIRED or EXEMPT; null keeps what is set */
            String approval,
            /* the version the form was loaded with: an edit made on another one (or on none) is refused */
            Long version) {

        /** Without a version: to create one (an edit must carry the version it was made on). */
        public UserRequest(String username, String fullName, String email, String password, UserRole role,
                Boolean active, Set<Feature> features, Boolean mobileAccess, Set<Feature> mobileFeatures,
                String approval) {
            this(username, fullName, email, password, role, active, features, mobileAccess, mobileFeatures, approval,
                    null);
        }
    }

    public record UserView(Long id, String username, String fullName, String email, UserRole role, String roleLabel,
                           boolean active, LocalDateTime createdAt, LocalDateTime lastLoginAt,
                           Set<Feature> features, boolean limited, boolean mobileAccess, Set<Feature> mobileFeatures,
                           /* TENANT, REQUIRED or EXEMPT; and whether what the user records waits for approval now */
                           String approval, boolean needsApproval,
                           /* what an edit sends back: a save made on another version is refused */
                           Long version) {
    }

    public record TenantRequest(
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,29}") String code,
            @NotBlank @Size(max = 100) String name,
            @Pattern(regexp = "[A-Z]{3}") String currency,
            Boolean active,
            /* Admin user created together with a new tenant */
            @Size(min = 3, max = 50) String adminUsername,
            @Size(max = 100) String adminFullName,
            @Size(min = 6, max = 100) String adminPassword,
            /* the sections (menu items) the organization has; null = every section */
            Set<Feature> features,
            /* the time zone its times are shown in ("Asia/Kolkata"); empty: the server's; null (an update): unchanged */
            @Size(max = 40) String timeZone,
            /* the version the form was loaded with: an edit made on another one (or on none) is refused */
            Long version) {

        /** Without a version: to create one (an edit must carry the version it was made on). */
        public TenantRequest(String code, String name, String currency, Boolean active, String adminUsername,
                String adminFullName, String adminPassword, Set<Feature> features, String timeZone) {
            this(code, name, currency, active, adminUsername, adminFullName, adminPassword, features, timeZone, null);
        }
    }

    public record TenantView(Long id, String code, String name, String currency, boolean active,
                             LocalDateTime createdAt, long userCount, long accountCount,
                             /* the sections the organization has, and whether that is fewer than all */
                             Set<Feature> features, boolean limited,
                             /* its own time zone (null: the server's applies) */
                             String timeZone,
                             /* what an edit sends back: a save made on another version is refused */
                             Long version) {
    }
}
