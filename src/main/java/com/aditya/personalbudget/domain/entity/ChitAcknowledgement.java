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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A written acknowledgement from the organizer of a {@link Chit} the household is a member of: evidence, for any
 * later dispute, that the money really reached them.
 * <ul>
 *   <li>{@code RECEIPT}: the organizer acknowledges having received one or more installments (the schedule lists each
 *       one: number, due date, the day it was paid, the cash, the dividend and how it was paid).</li>
 *   <li>{@code SETTLEMENT}: when the payout is in, a full and final settlement: the member acknowledges the payout,
 *       the organizer confirms every installment, and the receipts given before are cancelled (listed on it).</li>
 * </ul>
 * The figures and the wording are frozen when it is made (with a SHA-256 of the content). The organizer opens it through
 * a secret link that expires, types their mobile number (the one on record, when there is one), signs with a finger
 * and accepts; the time, IP address, device, location (if allowed) are sealed together and digitally signed by this
 * installation. It also prints: as a stamp-paper deed, for real stamp paper, or as a plain receipt with a box for a
 * revenue stamp, to be signed by hand. Table file: {@code data/chit_acknowledgements.tbl}
 */
@Entity
@Table(name = "chit_acknowledgements")
@Getter
@Setter
@NoArgsConstructor
public class ChitAcknowledgement implements TenantOwned {

    public static final String RECEIPT = "RECEIPT";
    public static final String SETTLEMENT = "SETTLEMENT";

    /** Waiting for the organizer. */
    public static final String PENDING = "PENDING";
    /** Signed by the organizer through the link. */
    public static final String SIGNED = "SIGNED";
    /** Signed on a printed copy, recorded by the member. */
    public static final String PAPER = "PAPER";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(Chit.class)
    @Column(nullable = false)
    private Long chitId;

    /** RECEIPT or SETTLEMENT. */
    @Column(nullable = false, length = 12)
    private String kind;

    /** CR-000012 (a receipt) or CS-000013 (a settlement). */
    @Column(nullable = false, length = 20)
    private String ackNo;

    /** The installments it covers (ids, comma separated); a settlement covers every paid one. */
    @Column(nullable = false, length = 3000)
    private String installmentIds;

    /**
     * The schedule as frozen: one line per installment, "no|dueDate|paidDate|installment|dividend|cash|mode" (a
     * settlement adds the receipts it cancels as "R|ackNo|date|amount|status").
     */
    @Column(nullable = false, length = 8000)
    private String schedule;

    /** The cash the organizer acknowledges (installments less dividends); a settlement: everything paid in. */
    @Column(nullable = false)
    private BigDecimal amount;

    // ---- the parties and the chit

    @Column(nullable = false, length = 100)
    private String memberName;

    @Column(length = 150)
    private String memberAddress;

    @Column(nullable = false, length = 100)
    private String organizerName;

    /** The organizer's mobile on record: they type the same number to open the link (empty: any number is recorded). */
    @Column(length = 20)
    private String organizerPhone;

    @Column(length = 150)
    private String organizerAddress;

    @Column(nullable = false, length = 100)
    private String chitName;

    @Column(length = 40)
    private String ticketNo;

    private BigDecimal chitValue;

    /** Where it is made (printed with the date, and the courts there have jurisdiction). */
    @Column(length = 60)
    private String place;

    // ---- a settlement: the payout

    private BigDecimal payoutAmount;

    private LocalDate payoutDate;

    /** The receipts it cancels (ack numbers, comma separated). */
    @Column(length = 1000)
    private String cancelsAckNos;

    // ---- a receipt cancelled by the settlement (it stays, marked)

    private LocalDateTime cancelledAt;

    @Column(length = 20)
    private String cancelledByAckNo;

    // ---- the wording

    @Column(nullable = false, length = 6000)
    private String terms;

    /** SHA-256 of the wording and figures, printed on it so any change is evident. */
    @Column(nullable = false, length = 64)
    private String contentHash;

    /** PENDING, SIGNED or PAPER. */
    @Column(nullable = false, length = 10)
    private String status;

    // ---- the paper copy

    private BigDecimal stampDuty;

    @Column(length = 40)
    private String stampSerial;

    /** The member's drawn signature (an SVG path in a 1000 x 300 box); a settlement is signed by the member too. */
    @Column(length = 20000)
    private String memberSignature;

    @Column(length = 100)
    private String witnessName;

    @Column(length = 20)
    private String witnessPhone;

    @Column(length = 20000)
    private String witnessSignature;

    private Boolean requireLocation;

    // ---- the secret link (only a hash of the token is kept)

    @Column(length = 64)
    private String tokenHash;

    private LocalDateTime linkExpiresAt;

    private LocalDateTime linkRevokedAt;

    /** When the link was last sent, and how many links were made for it (a resend makes a new one). */
    private LocalDateTime sentAt;

    private Integer sendCount;

    private Integer views;

    private LocalDateTime lastViewedAt;

    /** Wrong mobile numbers typed on the link; after too many the link locks. */
    private Integer failedAttempts;

    private LocalDateTime lockedAt;

    // ---- evidence of the signature

    @Column(length = 100)
    private String acceptedName;

    private LocalDateTime acceptedAt;

    @Column(length = 20)
    private String acceptedPhone;

    /** The number typed is the one on record (null: none was on record). */
    private Boolean phoneMatches;

    @Column(length = 64)
    private String acceptedIp;

    @Column(length = 255)
    private String acceptedUserAgent;

    @Column(length = 2000)
    private String acceptedDevice;

    @Column(length = 64)
    private String deviceHash;

    /** "lat,lng,accuracy-in-metres". */
    @Column(length = 100)
    private String acceptedLocation;

    /** A remark the organizer may add when signing (e.g. "received by UPI"). */
    @Column(length = 300)
    private String acceptedRemarks;

    /** The organizer's drawn signature: an SVG path in a 1000 x 300 box. */
    @Column(length = 20000)
    private String signature;

    /** SHA-256 over the content hash and every piece of evidence. */
    @Column(length = 64)
    private String acceptanceSeal;

    /** The evidence as exact JSON, and this installation's ECDSA P-256 signature over it (Base64). */
    @Column(length = 4000)
    private String evidencePayload;

    @Column(length = 120)
    private String digitalSignature;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;

    public boolean isReceipt() {
        return RECEIPT.equals(kind);
    }

    public boolean isPending() {
        return PENDING.equals(status);
    }

    /** Signed (online or on paper) and not cancelled. */
    public boolean isInForce() {
        return !isPending() && cancelledAt == null;
    }

    /** PENDING, SIGNED, PAPER, or CANCELLED once a settlement cancelled it. */
    public String effectiveStatus() {
        return cancelledAt != null ? "CANCELLED" : status;
    }
}
