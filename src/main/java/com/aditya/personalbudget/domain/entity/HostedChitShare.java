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
 * A temporary link to the status of a {@link HostedChit}: for one member (their payments, dues, win and what is
 * coming) or for the whole chit (every month, collections and the organiser's earnings). Opened without an
 * account; only a hash of the token is kept. Table file: {@code data/hosted_chit_shares.tbl}
 */
@Entity
@Table(name = "hosted_chit_shares")
@Getter
@Setter
@NoArgsConstructor
public class HostedChitShare implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(HostedChit.class)
    @Column(nullable = false)
    private Long chitId;

    /** MEMBER (a member's statement), CHIT (the whole chit), RECEIPT (one payment) or AGREEMENT. */
    @Column(length = 10)
    private String kind;

    /** The member the link is for; empty means the whole chit. */
    @References(HostedChitMember.class)
    private Long memberId;

    /** RECEIPT links: the payment. */
    @References(HostedChitPayment.class)
    private Long paymentId;

    /** AGREEMENT links: the agreement the member can read and accept. */
    @References(HostedChitAgreement.class)
    private Long agreementId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Who it was sent to. */
    @Column(length = 80)
    private String sharedWith;

    /** Whole-chit links: also show the organiser's commission and money held. */
    private Boolean showEarnings;

    /** A line shown on top, e.g. "Please pay by the 5th". */
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
