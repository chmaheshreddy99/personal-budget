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
 * One (possibly partial) settlement of a {@link Claim}: money received back, or the part written off.
 * {@code principal} reduces what is owed; {@code interest} is booked as interest income, except the part
 * that settles interest already posted month by month ({@code accruedInterest}), which reduces the receivable.
 * Table file: {@code data/claim_repayments.tbl}
 */
@Entity
@Table(name = "claim_repayments")
@Getter
@Setter
@NoArgsConstructor
public class ClaimRepayment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(Claim.class)
    @Column(nullable = false)
    private Long claimId;

    @Column(nullable = false)
    private LocalDate paidDate;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal principal;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal interest;

    /** Bank / cash the money came into, or the expense account for a write-off. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    /** True when the amount was forgiven instead of received. */
    @Column(nullable = false)
    private Boolean writeOff;

    /** For a write-off: the expense (or, for a waived debt, income) category it was booked to. */
    @References(Category.class)
    private Long categoryId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    /** Part of {@code interest} that settled interest already posted (see ClaimInterestPosting). */
    @PositiveOrZero
    private BigDecimal accruedInterest;

    @Column(length = 255)
    private String notes;
}
