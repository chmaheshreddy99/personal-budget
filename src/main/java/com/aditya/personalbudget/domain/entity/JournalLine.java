package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * One debit or credit line of a journal entry. Exactly one of debit / credit is non-zero.
 * Table file: {@code data/journal_lines.tbl}
 */
@Entity
@Table(name = "journal_lines", uniqueConstraints = @UniqueConstraint(columnNames = {"journalEntryId", "lineNo"}))
@Getter
@Setter
@NoArgsConstructor
public class JournalLine implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(JournalEntry.class)
    @Column(nullable = false)
    private Long journalEntryId;

    @Positive
    @Column(nullable = false)
    private Integer lineNo;

    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal debit;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal credit;

    @Column(length = 255)
    private String memo;

    /** Expense or income category, on lines of the Expenses / Income account. */
    @References(Category.class)
    private Long categoryId;

    /** The chit, on lines of the Chit Funds account. */
    @References(Chit.class)
    private Long chitId;
}
