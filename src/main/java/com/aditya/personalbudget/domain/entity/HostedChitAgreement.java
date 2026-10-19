package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A digital agreement with the winner of a month of a {@link HostedChit}: that they received the payout, and that
 * they will keep paying the remaining installments. The figures and the wording are fixed when it is made (with a
 * SHA-256 hash of the content), the member reads it through a link and accepts it by typing their name; when, from
 * where and as whom is recorded. Table file: {@code data/hosted_chit_agreements.tbl}
 */
@Entity
@Table(name = "hosted_chit_agreements", uniqueConstraints = @UniqueConstraint(columnNames = {"chitId", "monthNo"}))
@Getter
@Setter
@NoArgsConstructor
public class HostedChitAgreement implements TenantOwned {

    public static final String DRAFT = "DRAFT";
    public static final String ACCEPTED = "ACCEPTED";
    /** Signed on paper, recorded by the organiser. */
    public static final String SIGNED = "SIGNED";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(HostedChit.class)
    @Column(nullable = false)
    private Long chitId;

    @References(HostedChitMember.class)
    @Column(nullable = false)
    private Long memberId;

    @Column(nullable = false)
    private Integer monthNo;

    /** AG-000012 */
    @Column(nullable = false, length = 20)
    private String agreementNo;

    @Column(nullable = false)
    private BigDecimal chitValue;

    /** Auction chits: the winning bid; fixed chits: the commission kept. */
    private BigDecimal deduction;

    @Column(nullable = false)
    private BigDecimal payoutAmount;

    private LocalDate payoutDate;

    @Column(length = 10)
    private String payoutMode;

    @Column(length = 60)
    private String payoutReference;

    /** Installments the member still has to pay after this month, and roughly how much. */
    private Integer remainingInstallments;

    private BigDecimal remainingAmount;

    @Column(length = 100)
    private String guarantorName;

    @Column(length = 20)
    private String guarantorPhone;

    /** The full wording the member accepts. */
    @Column(nullable = false, length = 6000)
    private String terms;

    /** SHA-256 of the wording and figures, shown on the agreement so any change is evident. */
    @Column(nullable = false, length = 64)
    private String contentHash;

    /** DRAFT, ACCEPTED or SIGNED. */
    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 100)
    private String acceptedName;

    private LocalDateTime acceptedAt;

    /** IP address and browser of the acceptance, or "In person" for a paper signature. */
    @Column(length = 255)
    private String acceptedFrom;

    // ---- evidence of an online acceptance

    /** The mobile number the member typed when accepting, and whether it is the one on the member's record. */
    @Column(length = 20)
    private String acceptedPhone;

    private Boolean phoneMatches;

    @Column(length = 64)
    private String acceptedIp;

    /** What the member's device reported (browser, platform, screen, time zone, language ...), as JSON. */
    @Column(length = 2000)
    private String acceptedDevice;

    /** SHA-256 of {@link #acceptedDevice}: the same device gives the same fingerprint. */
    @Column(length = 64)
    private String deviceHash;

    /** "lat,lng,accuracy-in-metres" when the member chose to share their location. */
    @Column(length = 100)
    private String acceptedLocation;

    /** The drawn signature: an SVG path in a 1000 x 300 box. */
    @Column(length = 20000)
    private String signature;

    /** SHA-256 over the content hash and every piece of evidence: seals the acceptance record. */
    @Column(length = 64)
    private String acceptanceSeal;

    // ---- the stamp-paper copy: stamp, the organiser's and the witness's signatures, and the member's ID proof

    /** The value of the non-judicial stamp paper it is printed on (e.g. 100), and the stamp paper's serial number. */
    private BigDecimal stampDuty;

    @Column(length = 40)
    private String stampSerial;

    /** The organiser's drawn signature (an SVG path in a 1000 x 300 box), frozen on the agreement, and the name under it. */
    @Column(length = 20000)
    private String organiserSignature;

    @Column(length = 100)
    private String organiserName;

    @Column(length = 100)
    private String witnessName;

    @Column(length = 20)
    private String witnessPhone;

    @Column(length = 150)
    private String witnessAddress;

    @Column(length = 20000)
    private String witnessSignature;

    /** Aadhaar: only the last 4 digits and a salted SHA-256 of the number are kept, never the number. */
    @Column(length = 4)
    private String aadhaarLast4;

    @Column(length = 64)
    private String aadhaarHash;

    /** PAN, masked (ABCDE••••F) and its SHA-256. */
    @Column(length = 10)
    private String panMasked;

    @Column(length = 64)
    private String panHash;

    /** The member is asked to add their Aadhaar and PAN (and a selfie) through the link before accepting. */
    private Boolean kycFromMember;

    /**
     * The evidence of the acceptance as exact JSON (figures, wording hash, who, when, where, device, file hashes) and
     * this installation's ECDSA P-256 signature over it: anyone can check it in a browser with the public key.
     */
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
