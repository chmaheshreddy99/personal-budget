package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One month of an EMI plan: its due date, the instalment split into principal and interest (reducing balance),
 * the GST on the interest and what is still owed after it; and, once paid, when and its journal entry.
 * Table file: {@code data/emi_installments.tbl}
 */
@Entity
@Table(name = "emi_installments")
@Getter
@Setter
@NoArgsConstructor
public class EmiInstallment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(EmiPlan.class)
    @Column(nullable = false)
    private Long planId;

    /** 1, 2, 3 … */
    @Column(nullable = false)
    private Integer seq;

    @Column(nullable = false)
    private LocalDate dueDate;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal principal;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal interest;

    @PositiveOrZero
    private BigDecimal gst;

    /** Principal still owed after this instalment. */
    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal balanceAfter;

    /**
     * DUE, BILLED (a card EMI: billed on the card, waiting to be paid into it), PAID or WAIVED (not needed: the plan
     * was paid off early).
     */
    @Column(nullable = false, length = 8)
    private String status;

    /** A card EMI: when it was billed on the card. */
    private LocalDate billedOn;

    private LocalDate paidOn;

    /** A loan EMI: the payment (principal and interest). A card EMI: the interest billed on the card. */
    @References(JournalEntry.class)
    private Long journalEntryId;

    /** A card EMI: the money paid into the card for it (which frees the blocked limit). */
    @References(JournalEntry.class)
    private Long paymentEntryId;
}
