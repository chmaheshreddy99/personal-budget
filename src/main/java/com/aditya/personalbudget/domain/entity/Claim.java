package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.domain.type.InterestCollection;
import com.aditya.personalbudget.domain.type.InterestType;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * Money someone owes you: cash you lent, or a bill you paid on their behalf.
 * The original payment is posted as Dr receivable / Cr bank; every repayment is a
 * {@link ClaimRepayment} with its own journal linked back to this claim.
 * Table file: {@code data/claims.tbl}
 */
@Entity
@Table(name = "claims")
@Getter
@Setter
@NoArgsConstructor
public class Claim implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private ClaimKind kind;

    /** Who owes the money. */
    @Column(nullable = false, length = 100)
    private String party;

    @Column(nullable = false, length = 255)
    private String narration;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate startDate;

    /** When you expect the money back (optional). */
    private LocalDate dueDate;

    /** Annual interest in percent (optional, usually for money lent). */
    @PositiveOrZero
    @DecimalMax("60")
    private BigDecimal interestRate;

    /** Simple (default when empty) or monthly compound. */
    @Enumerated(EnumType.STRING)
    @Column(length = 10)
    private InterestType interestType;

    /** Receivable account the claim sits in (Receivables by default). */
    @References(Account.class)
    @Column(nullable = false)
    private Long receivableAccountId;

    /** Bank / cash / card the money went out from. */
    @References(Account.class)
    @Column(nullable = false)
    private Long paidFromAccountId;

    /** For a bill to pay later: the expense category of the bill. */
    @References(Category.class)
    private Long categoryId;

    /** The original journal (set right after posting). */
    @References(JournalEntry.class)
    private Long journalEntryId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private ClaimStatus status;

    @Column(length = 500)
    private String notes;

    /**
     * Book interest automatically as each collection period ends (every month, or every year for yearly
     * collection), instead of only when it is paid. Never for interest collected whenever it is paid.
     */
    private Boolean postInterestMonthly;

    /** When the interest is expected to be paid: monthly (the default when empty), yearly or whenever. */
    @Enumerated(EnumType.STRING)
    @Column(length = 12)
    private InterestCollection interestCollection;

    /** Where posted interest is booked by default (empty: the account the claim sits in). */
    @References(Account.class)
    private Long interestAccountId;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
