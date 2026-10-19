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

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A scanned document of someone in the family: passport, Aadhaar, PAN, voter ID, driving licence, certificates,
 * bank passbooks and so on. The scans are attachments; the row holds what is on it (number, issued, valid until)
 * so expiries can be reminded. Table file: {@code data/documents.tbl}
 */
@Entity
@Table(name = "documents")
@Getter
@Setter
@NoArgsConstructor
public class PersonalDocument implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 120)
    private String title;

    /** PASSPORT, AADHAAR, PAN, VOTER_ID, DRIVING_LICENCE, EDUCATION, BANK_PASSBOOK, ... OTHER. */
    @Column(nullable = false, length = 30)
    private String docType;

    /** Whose it is: "Self", "Lakshmi", "Arjun" ... */
    @Column(nullable = false, length = 60)
    private String owner;

    /** Self, Spouse, Son, Daughter, Father, Mother ... */
    @Column(length = 30)
    private String relation;

    @Column(length = 60)
    private String docNumber;

    @Column(length = 100)
    private String issuer;

    private LocalDate issuedOn;

    private LocalDate expiresOn;

    @Column(length = 255)
    private String notes;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
