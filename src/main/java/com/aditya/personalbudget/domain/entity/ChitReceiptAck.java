package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Transient;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * An acknowledgement of receipt for chit installments you paid (see {@link Chit}): one or several paid installments,
 * fixed when it is made (figures, wording and a SHA-256 of both). The organizer opens it through a secret link with a
 * time limit, types the mobile number it was sent to, and either signs it (name, drawn signature, optional selfie and
 * location) or says what is wrong. An acknowledgement is sealed with a hash and digitally signed by this installation,
 * with the time, IP address and device; once acknowledged it is a record that cannot be changed or deleted, and the
 * installments in it cannot be undone. Table file: {@code data/chit_receipt_acks.tbl}
 */
@Entity
@Table(name = "chit_receipt_acks")
@Getter
@Setter
@NoArgsConstructor
public class ChitReceiptAck implements TenantOwned {

    /** Sent, waiting for the organizer. */
    public static final String PENDING = "PENDING";
    /** Signed by the organizer through the link. */
    public static final String ACKNOWLEDGED = "ACKNOWLEDGED";
    /** The organizer said something is wrong instead of signing. */
    public static final String DISPUTED = "DISPUTED";
    /** Stopped by the payer, or replaced by a newer request for the same installments. */
    public static final String REVOKED = "REVOKED";
    /** Signed on paper (a printed copy), recorded by the payer. */
    public static final String SIGNED = "SIGNED";
    /** Withdrawn after it was signed, or replaced by the payout receipt: kept for the record, never deleted. */
    public static final String CANCELLED = "CANCELLED";

    /** The installments paid (the default, also when empty). */
    public static final String KIND_INSTALLMENTS = "INSTALLMENTS";
    /** The same receipt in a few plain lines, for an organizer who wants to sign and be done. */
    public static final String KIND_SIMPLE = "SIMPLE";
    /** The payout received in full: a final settlement that replaces the earlier acknowledgements. */
    public static final String KIND_PAYOUT = "PAYOUT";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(Chit.class)
    @Column(nullable = false)
    private Long chitId;

    /** CR-000012 */
    @Column(nullable = false, length = 20)
    private String ackNo;

    // ---- the parties and the chit, as written

    /** Who paid (the subscriber). */
    @Column(nullable = false, length = 100)
    private String payerName;

    @Column(nullable = false, length = 100)
    private String organizerName;

    /** The organizer's mobile number: they must type the same number to open the link. */
    @Column(nullable = false, length = 20)
    private String organizerPhone;

    @Column(nullable = false, length = 100)
    private String chitName;

    @Column(length = 40)
    private String ticketNo;

    // ---- the payments

    /** The installments, "id,id,id": checked so none is acknowledged twice and none acknowledged is undone. */
    @Column(nullable = false, length = 1400)
    private String installmentIds;

    /** One installment per line: {@code no|dueDate|paidDate|dueAmount|dividend|cashReceived}. */
    @Column(nullable = false, length = 6000)
    private String lines;

    @Column(nullable = false)
    private BigDecimal totalAmount;

    /** INSTALLMENTS (empty = this) or PAYOUT. */
    @Column(length = 14)
    private String kind;

    /**
     * Payout receipts only: the installments the chit received, in the same line format (the payout parts are in
     * {@link #lines}); fixed with the wording.
     */
    @Transient
    private String installLines;

    /** Payout receipts only: the earlier acknowledgements it cancels once signed, "id,id". */
    @Column(length = 200)
    private String supersedes;

    /** Payout receipts only: the payer's own signature (an SVG path), when drawn while sending. */
    @Transient
    private String payerSignature;

    /** How it was paid and any reference (UPI / bank transaction ID), as the payer wrote it. */
    @Column(length = 200)
    private String paymentNote;

    /**
     * The wording the organizer accepts (the payments are listed with it). Like the other {@link Transient} fields below it
     * is not in the table: it lives in the record's evidence document on disk ({@code EvidenceVault}) and is read when the
     * record is opened.
     */
    @Transient
    private String terms;

    /** SHA-256 of the wording and the payments, shown on the page so any change is evident. */
    @Column(nullable = false, length = 64)
    private String contentHash;

    private Boolean requireSelfie;

    private Boolean requireLocation;

    /** PENDING, ACKNOWLEDGED, DISPUTED or REVOKED. */
    @Column(nullable = false, length = 14)
    private String status;

    // ---- withdrawn

    @Column(length = 300)
    private String cancelReason;

    private LocalDateTime cancelledAt;

    @Column(length = 50)
    private String cancelledBy;

    /** The payout receipt that replaced it. */
    private Long supersededBy;

    // ---- the secret link (only a hash of the token is kept)

    @Column(length = 64)
    private String tokenHash;

    private LocalDateTime linkExpiresAt;

    private LocalDateTime linkRevokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;

    /** Wrong mobile numbers typed on the link; after too many the link locks. */
    private Integer failedAttempts;

    private LocalDateTime lockedAt;

    // ---- evidence of the acknowledgement

    @Column(length = 100)
    private String acknowledgedName;

    private LocalDateTime acknowledgedAt;

    @Column(length = 20)
    private String acknowledgedPhone;

    @Column(length = 64)
    private String acknowledgedIp;

    @Column(length = 255)
    private String acknowledgedUserAgent;

    /** What the organizer's device reported (browser, platform, screen, time zone, language ...), as JSON (on disk, see above). */
    @Transient
    private String acknowledgedDevice;

    @Column(length = 64)
    private String deviceHash;

    /** "lat,lng,accuracy-in-metres". */
    @Column(length = 100)
    private String acknowledgedLocation;

    /** The organizer's drawn signature: an SVG path in a 1000 x 300 box (on disk, see above). */
    @Transient
    private String signature;

    /** SHA-256 over the content hash and every piece of evidence, the selfie included. */
    @Column(length = 64)
    private String acknowledgementSeal;

    /** The evidence as exact JSON (on disk, see above); the row keeps this installation's ECDSA P-256 signature over it (Base64). */
    @Transient
    private String evidencePayload;

    @Column(length = 120)
    private String digitalSignature;

    // ---- the organizer said it is wrong

    @Column(length = 500)
    private String disputeReason;

    private LocalDateTime disputedAt;

    @Column(length = 64)
    private String disputeIp;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
