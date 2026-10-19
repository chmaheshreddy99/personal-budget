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
 * A temporary link to the mobile version made by an admin for someone without an account (a driver, a helper,
 * a family member on the road). Opening it signs in for a limited time to the chosen sections only, either to
 * look ({@code VIEW}) or also to record expenses ({@code RECORD}); with {@code approval} (maker-checker) what is
 * recorded waits for a checker before it reaches the books. Only a hash of the token is kept, so the link itself
 * is shown once. Revoking it ends every session opened with it at once. Table file: {@code data/access_links.tbl}
 */
@Entity
@Table(name = "access_links")
@Getter
@Setter
@NoArgsConstructor
public class AccessLink implements TenantOwned {

    public static final String VIEW = "VIEW";
    public static final String RECORD = "RECORD";
    /** Where the link opens: the full app (every section can be shared) or the mobile version. */
    public static final String DESKTOP = "DESKTOP";
    public static final String MOBILE = "MOBILE";

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** Who or what it is for, e.g. "Ravi (driver)". Shown as the author of what is recorded. */
    @Column(nullable = false, length = 60)
    private String label;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Sections reachable with the link ({@code Feature} names, comma separated). */
    @Column(nullable = false, length = 300)
    private String features;

    /** VIEW or RECORD. */
    @Column(nullable = false, length = 10)
    private String mode;

    /** Maker-checker: what is recorded waits for approval. */
    @Column(nullable = false)
    private Boolean approval;

    @References(AppUser.class)
    @Column(nullable = false)
    private Long createdById;

    @Column(nullable = false, length = 100)
    private String createdByName;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime revokedAt;

    @Column(length = 100)
    private String revokedByName;

    private LocalDateTime lastUsedAt;

    private Integer useCount;

    @Column(length = 200)
    private String note;

    /** DESKTOP or MOBILE; empty (older links) means MOBILE. */
    @Column(length = 10)
    private String client;

    /** Opens the full app rather than the mobile version. */
    public boolean opensDesktop() {
        return DESKTOP.equals(client);
    }

    @Version
    private Long version;

    public boolean isActive(LocalDateTime now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
