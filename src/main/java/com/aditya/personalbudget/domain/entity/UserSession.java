package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * A signed-in browser. Only a SHA-256 hash of the bearer token is stored, so the file never holds a
 * usable credential. Sessions survive restarts and are shared by every server process on the data folder.
 * Table file: {@code data/user_sessions.tbl}
 */
@Entity
@Table(name = "user_sessions")
@Getter
@Setter
@NoArgsConstructor
public class UserSession implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(AppUser.class)
    @Column(nullable = false)
    private Long userId;

    /** Hex SHA-256 of the token. */
    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    @Column(length = 200)
    private String userAgent;

    /** Opened by the mobile version: only the user's mobile sections are available. */
    private Boolean mobile;

    /** Opened with an access link: its sections, mode and expiry apply (the user is the admin who made it). */
    private Long linkId;
}
