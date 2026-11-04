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
 * One period of interest credited to a bank account (Dr the bank, Cr Income [Interest]). Without a journal entry the
 * period was undone while the account posts by itself, and stays out of the automatic posting until posted by hand.
 * Table file: {@code data/bank_interest_postings.tbl}
 */
@Entity
@Table(name = "bank_interest_postings", uniqueConstraints = @UniqueConstraint(columnNames = {"accountId", "periodFrom"}))
@Getter
@Setter
@NoArgsConstructor
public class BankInterestPosting implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @Column(nullable = false)
    private LocalDate periodFrom;

    @Column(nullable = false)
    private LocalDate periodTo;

    /** What was credited: what the balances worked out to, or what the bank really paid. */
    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal amount;

    @References(JournalEntry.class)
    private Long journalEntryId;

    /** True when the nightly job posted it, false when someone did. */
    @Column(nullable = false)
    private Boolean automatic;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
