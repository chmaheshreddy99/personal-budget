package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * A person who can sign in. Usernames are unique across the whole platform,
 * so a username alone identifies the user and therefore the tenant.
 * Table file: {@code data/app_users.tbl}
 */
@Entity
@Table(name = "app_users")
@Getter
@Setter
@NoArgsConstructor
public class AppUser implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false, unique = true, length = 50)
    @Pattern(regexp = "[a-zA-Z0-9._-]{3,50}", message = "must be 3-50 letters, digits, dot, underscore or hyphen")
    private String username;

    @Column(nullable = false, length = 100)
    private String fullName;

    @Column(unique = true, length = 120)
    @Email
    private String email;

    /** BCrypt hash, never the plain password. */
    @Column(nullable = false, length = 100)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserRole role;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime lastLoginAt;

    /** Wrong passwords in a row; reset by a successful sign-in. */
    private Integer failedLogins;

    /** Sign-in is refused until this moment after too many wrong passwords. */
    private LocalDateTime lockedUntil;

    /** Sections shared with the user, e.g. "EXPENSES,CHITS" ({@code Feature} names); empty = every section. */
    @Column(length = 300)
    private String features;

    /** May sign in to the mobile version; empty counts as yes. */
    private Boolean mobileAccess;

    /** Sections shared on the mobile version; empty = every mobile section of {@link #features}. */
    @Column(length = 300)
    private String mobileFeatures;

    /** Maker-checker for this user: empty follows the household setting, true always, false never (exempt). */
    private Boolean approval;

    /** Signed in with the default (or an admin-given) password: a new one must be set before anything else. */
    private Boolean mustChangePassword;

    @Version
    private Long version;
}
