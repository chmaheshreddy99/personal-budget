package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A movement of a project loan: a disbursement, interest paid (a cost of the project), a repayment, or charges.
 * Table file: {@code data/construction_loan_txns.tbl}
 */
@Entity
@Table(name = "construction_loan_txns")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionLoanTxn implements TenantOwned {

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

    @References(ConstructionLoan.class)
    @Column(nullable = false)
    private Long loanId;

    /** DISBURSE, INTEREST, REPAY or CHARGES. */
    @Column(nullable = false, length = 10)
    private String kind;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate movedOn;

    /** The bank account it came into or was paid from. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @Column(length = 200)
    private String note;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
