package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Money received from the owner (contract works) or a buyer, or a buyer's bank (developments), with its receipt
 * number; part of it can be late payment interest.
 * Table file: {@code data/construction_receipts.tbl}
 */
@Entity
@Table(name = "construction_receipts")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionReceipt implements TenantOwned {

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

    @References(ConstructionSale.class)
    private Long saleId;

    /** OWNER, BUYER or BANK (the buyer's home loan). */
    @Column(nullable = false, length = 12)
    private String payer;

    @Column(length = 100)
    private String payerName;

    /** All of it, interest included. */
    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    /** The part that is late payment interest. */
    @PositiveOrZero
    private BigDecimal interestAmount;

    @Column(nullable = false)
    private LocalDate receivedOn;

    @Column(length = 20)
    private String mode;

    @Column(length = 60)
    private String reference;

    /** The account the money went into. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @Column(length = 30)
    private String receiptNo;

    @Column(length = 200)
    private String towards;

    @Column(length = 300)
    private String note;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
