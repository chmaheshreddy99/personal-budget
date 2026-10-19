package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One month of interest booked on a {@link Claim} before it is paid: money lent earns it
 * (Dr Receivables, Cr Income [Interest]); money owed costs it (Dr Expenses [Loan interest], Cr Payables).
 * Repayments then settle this posted interest first. Table file: {@code data/claim_interest_postings.tbl}
 */
@Entity
@Table(name = "claim_interest_postings", uniqueConstraints = @UniqueConstraint(columnNames = {"claimId", "periodNo"}))
@Getter
@Setter
@NoArgsConstructor
public class ClaimInterestPosting implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(Claim.class)
    @Column(nullable = false)
    private Long claimId;

    /** Month of the interest schedule (1 = the first month after the money changed hands). */
    @Column(nullable = false)
    private Integer periodNo;

    @Column(nullable = false)
    private LocalDate periodFrom;

    @Column(nullable = false)
    private LocalDate periodTo;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal amount;

    @References(JournalEntry.class)
    private Long journalEntryId;

    /** The receivable (or payable) the interest was booked to; empty means the claim's own account. */
    @References(Account.class)
    private Long accountId;

    /** True when the monthly job posted it, false when someone pressed "Post interest". */
    @Column(nullable = false)
    private Boolean automatic;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
