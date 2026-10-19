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
 * A loan agreement for money lent ({@link Claim}): the figures and wording are fixed when it is made (with a SHA-256 of
 * the content). The borrower opens it through a secret link, adds their Aadhaar card and a live selfie, and accepts it
 * with their name, mobile number, Aadhaar number (only the last 4 digits and a hash are kept) and a drawn signature;
 * the time, IP address, device and (if allowed) location are recorded, sealed with a hash and digitally signed by this
 * installation. The same agreement prints as a stamp-paper deed with the lender's, borrower's and witness's
 * signatures and the ID proof attached. Table file: {@code data/claim_agreements.tbl}
 */
@Entity
@Table(name = "claim_agreements")
@Getter
@Setter
@NoArgsConstructor
public class ClaimAgreement implements TenantOwned {

    public static final String DRAFT = "DRAFT";
    /** Accepted by the borrower through the link. */
    public static final String ACCEPTED = "ACCEPTED";
    /** Signed on paper, recorded by the lender. */
    public static final String SIGNED = "SIGNED";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(Claim.class)
    @Column(nullable = false)
    private Long claimId;

    /** LA-000012 */
    @Column(nullable = false, length = 20)
    private String agreementNo;

    // ---- the parties

    @Column(nullable = false, length = 100)
    private String lenderName;

    @Column(length = 150)
    private String lenderAddress;

    @Column(nullable = false, length = 100)
    private String borrowerName;

    /** The borrower's mobile number on record: they must type the same number to accept. */
    @Column(length = 20)
    private String borrowerPhone;

    @Column(length = 150)
    private String borrowerAddress;

    // ---- the loan, as agreed

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate loanDate;

    private LocalDate dueDate;

    private BigDecimal interestRate;

    /** "Simple" or "Compound monthly", and when interest is paid ("every month" ...). */
    @Column(length = 60)
    private String interestTerms;

    /** The place the agreement is made at (printed with the date). */
    @Column(length = 60)
    private String place;

    /** The full wording the borrower accepts. */
    @Column(nullable = false, length = 6000)
    private String terms;

    /** SHA-256 of the wording and figures, shown on the agreement so any change is evident. */
    @Column(nullable = false, length = 64)
    private String contentHash;

    // ---- the stamp-paper copy

    private BigDecimal stampDuty;

    @Column(length = 40)
    private String stampSerial;

    @Column(length = 20000)
    private String lenderSignature;

    @Column(length = 100)
    private String witnessName;

    @Column(length = 20)
    private String witnessPhone;

    @Column(length = 150)
    private String witnessAddress;

    @Column(length = 20000)
    private String witnessSignature;

    // ---- what the borrower must give through the link

    private Boolean requireAadhaar;

    private Boolean requireSelfie;

    private Boolean requireLocation;

    /** DRAFT, ACCEPTED or SIGNED. */
    @Column(nullable = false, length = 10)
    private String status;

    // ---- the secret link (only a hash of the token is kept)

    @Column(length = 64)
    private String tokenHash;

    private LocalDateTime linkExpiresAt;

    private LocalDateTime linkRevokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;

    /** Wrong mobile or Aadhaar numbers typed on the link; after too many the link locks. */
    private Integer failedAttempts;

    private LocalDateTime lockedAt;

    // ---- evidence of the acceptance

    @Column(length = 100)
    private String acceptedName;

    private LocalDateTime acceptedAt;

    @Column(length = 20)
    private String acceptedPhone;

    private Boolean phoneMatches;

    @Column(length = 64)
    private String acceptedIp;

    @Column(length = 255)
    private String acceptedUserAgent;

    /** What the borrower's device reported (browser, platform, screen, time zone, language ...), as JSON. */
    @Column(length = 2000)
    private String acceptedDevice;

    @Column(length = 64)
    private String deviceHash;

    /** "lat,lng,accuracy-in-metres". */
    @Column(length = 100)
    private String acceptedLocation;

    /** The borrower's drawn signature: an SVG path in a 1000 x 300 box. */
    @Column(length = 20000)
    private String signature;

    @Column(length = 4)
    private String aadhaarLast4;

    /** SHA-256 of the Aadhaar number salted with the agreement's content hash. */
    @Column(length = 64)
    private String aadhaarHash;

    /** SHA-256 over the content hash and every piece of evidence, the files included. */
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
}
