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
            @NotBlank @Size(min = 6, max = 100) String password) {
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
                         boolean mustChangePassword) {
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
            String approval) {
    }

    public record UserView(Long id, String username, String fullName, String email, UserRole role, String roleLabel,
                           boolean active, LocalDateTime createdAt, LocalDateTime lastLoginAt,
                           Set<Feature> features, boolean limited, boolean mobileAccess, Set<Feature> mobileFeatures,
                           /* TENANT, REQUIRED or EXEMPT; and whether what the user records waits for approval now */
                           String approval, boolean needsApproval) {
    }

    public record TenantRequest(
            @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,29}") String code,
            @NotBlank @Size(max = 100) String name,
            @Pattern(regexp = "[A-Z]{3}") String currency,
            Boolean active,
            /* Admin user created together with a new tenant */
            @Size(min = 3, max = 50) String adminUsername,
            @Size(max = 100) String adminFullName,
            @Size(min = 6, max = 100) String adminPassword) {
    }

    public record TenantView(Long id, String code, String name, String currency, boolean active,
                             LocalDateTime createdAt, long userCount, long accountCount) {
    }
}
