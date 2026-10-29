package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Quick unlock of the mobile app on one phone: after signing in with the password once, the user draws a pattern or
 * types a PIN to sign in again. The phone keeps a random secret (only its hash is here); signing in needs both that
 * secret and the pattern / PIN (kept as a BCrypt hash), so neither alone is enough. Five wrong tries in a row switch
 * it off, as does a new password. Table file: {@code data/device_keys.tbl}
 */
@Entity
@Table(name = "device_keys")
@Getter
@Setter
@NoArgsConstructor
public class DeviceKey implements TenantOwned {

    public static final String PIN = "PIN";
    public static final String PATTERN = "PATTERN";
    public static final int MAX_FAILED = 5;

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(AppUser.class)
    @Column(nullable = false)
    private Long userId;

    /** PIN or PATTERN. */
    @Column(nullable = false, length = 10)
    private String kind;

    /** The phone's name as it reported it ("Pixel 8"). */
    @Column(length = 60)
    private String deviceName;

    @Column(nullable = false, unique = true, length = 64)
    private String secretHash;

    @Column(nullable = false, length = 100)
    private String codeHash;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime lastUsedAt;

    private Integer failedAttempts;

    private LocalDateTime revokedAt;

    @Version
    private Long version;

    public boolean isActive() {
        return revokedAt == null;
    }
}
