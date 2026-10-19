package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * An agreement of a construction project, on stamp paper and online: the construction contract, a supplementary
 * agreement for extra work, the plot purchase, the joint development agreement, a flat's agreement for sale, the
 * tripartite agreement with the buyer's bank, the sale deed for registration, the possession letter, or a partner's
 * agreement. Its wording, recitals and particulars are made from the project when it is made and fixed by a SHA-256
 * fingerprint; the other party accepts it online (a secret link opened with their mobile number, with their Aadhaar,
 * a live selfie and their signature, sealed and digitally signed) or signs it on paper.
 * Table file: {@code data/construction_agreements.tbl}
 */
@Entity
@Table(name = "construction_agreements")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionAgreement implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The project it belongs to. */
    @References(ConstructionProject.class)
    @Column(nullable = false)
    private Long projectId;

    /** CONTRACT, EXTRA, PLOT_PURCHASE, JDA, FLAT_SALE, TRIPARTITE, SALE_DEED, POSSESSION or PARTNERSHIP. */
    @Column(nullable = false, length = 14)
    private String kind;

    /** The extra work, land party, sale or partner it is about. */
    private Long refId;

    @Column(nullable = false, length = 20)
    private String agreementNo;

    @Column(nullable = false, length = 120)
    private String title;

    /** How the company is called in it: Builder, Developer, Promoter, Purchaser, Vendor... */
    @Column(length = 40)
    private String firstRole;

    @Column(length = 40)
    private String secondRole;

    /** The other party. */
    @Column(nullable = false, length = 100)
    private String partyName;

    @Column(length = 100)
    private String partyRelation;

    @Column(length = 15)
    private String partyPhone;

    @Column(length = 200)
    private String partyAddress;

    /** The tripartite agreement: the buyer's bank. */
    @Column(length = 100)
    private String thirdName;

    @Column(length = 200)
    private String thirdAddress;

    @Column(length = 60)
    private String place;

    private LocalDate agreementDate;

    /** The WHEREAS clauses, one a line. */
    @Column(length = 3000)
    private String recitals;

    /** Label and value, a pair a line (label<TAB>value). */
    @Column(length = 4000)
    private String particulars;

    @Column(nullable = false, length = 16000)
    private String terms;

    @Column(length = 2000)
    private String extraTerms;

    @Column(nullable = false, length = 64)
    private String contentHash;

    @PositiveOrZero
    private BigDecimal stampDuty;

    @Column(length = 40)
    private String stampSerial;

    @Column(length = 20000)
    private String companySignature;

    @Column(length = 100)
    private String witnessName;

    @Column(length = 15)
    private String witnessPhone;

    @Column(length = 150)
    private String witnessAddress;

    @Column(length = 20000)
    private String witnessSignature;

    @Column(length = 100)
    private String witness2Name;

    @Column(length = 150)
    private String witness2Address;

    @Column(length = 20000)
    private String witness2Signature;

    /** Print boxes for both parties' thumb impressions. */
    private Boolean thumbBoxes;

    /** The other party's signature drawn in person on the builder's device. */
    @Column(length = 20000)
    private String partyInkSignature;

    private Boolean requireAadhaar;

    private Boolean requireSelfie;

    private Boolean requireLocation;

    /** DRAFT, ACCEPTED (online) or SIGNED (on paper). */
    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 64)
    private String tokenHash;

    private LocalDateTime linkExpiresAt;

    private LocalDateTime linkRevokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;

    private Integer failedAttempts;

    private LocalDateTime lockedAt;

    @Column(length = 100)
    private String acceptedName;

    private LocalDateTime acceptedAt;

    @Column(length = 15)
    private String acceptedPhone;

    @Column(length = 64)
    private String acceptedIp;

    @Column(length = 255)
    private String acceptedUserAgent;

    @Column(length = 2000)
    private String acceptedDevice;

    @Column(length = 64)
    private String deviceHash;

    @Column(length = 100)
    private String acceptedLocation;

    @Column(length = 20000)
    private String signature;

    @Column(length = 4)
    private String aadhaarLast4;

    @Column(length = 64)
    private String aadhaarHash;

    @Column(length = 64)
    private String acceptanceSeal;

    @Column(length = 4000)
    private String evidencePayload;

    @Column(length = 200)
    private String digitalSignature;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
