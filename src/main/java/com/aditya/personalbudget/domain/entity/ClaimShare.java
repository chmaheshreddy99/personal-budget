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
 * A temporary link to the statement of one lent / borrowed item, for the other person: what was given, what was
 * paid back and when, the interest so far and what is payable now (read live, so it is always current). Anyone
 * with the link can see it until it expires or is revoked. Only a hash of the token is kept.
 * Table file: {@code data/claim_shares.tbl}
 */
@Entity
@Table(name = "claim_shares")
@Getter
@Setter
@NoArgsConstructor
public class ClaimShare implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(Claim.class)
    @Column(nullable = false)
    private Long claimId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Who it was sent to, usually the person who owes (or is owed) the money. */
    @Column(length = 80)
    private String sharedWith;

    /** Also show the month-by-month interest table. */
    @Column(nullable = false)
    private Boolean showSchedule;

    /** A line shown on top of the statement, e.g. "Please pay the interest by the 5th". */
    @Column(length = 300)
    private String message;

    @Column(nullable = false, length = 100)
    private String createdByName;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime revokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;

    public boolean isActive(LocalDateTime now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
