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
 * A temporary link to where one of your chits stands, for someone else (family, a nominee, the person who pays it with
 * you): the organizer, the installments paid and still to pay, what the chit pays out and when it ends (read live, so it
 * is always current). Anyone with the link can see it until it expires or is revoked. Only a hash of the token is kept.
 * Table file: {@code data/chit_shares.tbl}
 */
@Entity
@Table(name = "chit_shares")
@Getter
@Setter
@NoArgsConstructor
public class ChitShare implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(Chit.class)
    @Column(nullable = false)
    private Long chitId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Who it was sent to (shown on the page). */
    @Column(length = 80)
    private String sharedWith;

    /** Also list every installment (paid on, dividend, cash); otherwise only the totals and the next one. */
    @Column(nullable = false)
    private Boolean showInstallments;

    /**
     * Also show the returns: the effective interest rate (compound and simple), the interest so far and at the end, what
     * the chit adds a day now, and how the money grows month by month. Empty on links made before it existed (not shown).
     */
    private Boolean showReturns;

    /** A line shown on top, e.g. "The chit I told you about". */
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
}
