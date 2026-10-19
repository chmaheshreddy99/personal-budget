package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Something bought on EMI: on a credit card (the card converts the purchase into monthly instalments) or through a
 * loan / finance company (consumer durable loan, Bajaj, a shop's own finance). The price is booked as an expense on
 * the day of the purchase; what is still owed is a liability in an account of its own ("EMI · iPhone 16"), and each
 * instalment pays off part of it (principal) plus interest (an expense under Loan Interest).
 * Table file: {@code data/emi_plans.tbl}
 */
@Entity
@Table(name = "emi_plans")
@Getter
@Setter
@NoArgsConstructor
public class EmiPlan implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** CARD (credit card EMI) or LOAN (a loan / finance company). */
    @Column(nullable = false, length = 8)
    private String kind;

    /** What was bought. */
    @Column(nullable = false, length = 255)
    private String narration;

    /** The shop it was bought from. */
    @Column(length = 100)
    private String party;

    /** Who lends: the card's bank, or the finance company. */
    @Column(length = 100)
    private String lender;

    @Column(length = 60)
    private String reference;

    @Column(length = 255)
    private String notes;

    /** The expense category of the purchase. */
    @References(Category.class)
    @Column(nullable = false)
    private Long categoryId;

    /** The amount financed. */
    @Positive
    @Column(nullable = false)
    private BigDecimal principal;

    /** Interest, % a year on the reducing balance; 0 for a no-cost EMI. */
    @PositiveOrZero
    @DecimalMax("60")
    @Column(nullable = false)
    private BigDecimal ratePercent;

    @Positive
    @Column(nullable = false)
    private Integer months;

    /** The monthly instalment (the last one is adjusted to clear the balance). */
    @Positive
    @Column(nullable = false)
    private BigDecimal emiAmount;

    /** Charged once with the purchase (processing fee, with its GST). */
    @PositiveOrZero
    private BigDecimal processingFee;

    /** GST charged on each instalment's interest, % (18 on most card EMIs). */
    @PositiveOrZero
    @DecimalMax("50")
    private BigDecimal gstPercent;

    @Column(nullable = false)
    private LocalDate purchaseDate;

    @Column(nullable = false)
    private LocalDate firstDueDate;

    /** The last instalment's date (worked out from the first and the months). */
    @Column(nullable = false)
    private LocalDate endDate;

    /** The card the instalments are billed to, or the bank account they are paid from. */
    @References(Account.class)
    @Column(nullable = false)
    private Long payAccountId;

    /**
     * A loan EMI: what is still owed, a liability account made for the plan. A card EMI has none: the price is charged
     * to the card at once (it blocks the card's limit) and each month's EMI is billed on the card.
     */
    @References(Account.class)
    private Long liabilityAccountId;

    @References(JournalEntry.class)
    private Long purchaseEntryId;

    /** Each instalment is booked by itself on its due date (a card bills it anyway). */
    @Column(nullable = false)
    private Boolean autoPost;

    /** ACTIVE, CLOSED (every instalment paid) or FORECLOSED (paid off early). */
    @Column(nullable = false, length = 12)
    private String status;

    private LocalDate closedOn;

    /** Paid off early: the entry that settled the rest. */
    @References(JournalEntry.class)
    private Long forecloseEntryId;

    /** Closed: put away (it no longer shows) until it is re-opened. */
    private Boolean archived;

    private LocalDate archivedOn;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @jakarta.persistence.Version
    private Long version;
}
