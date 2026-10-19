package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.domain.type.RecurringKind;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A scheduled income, expense or transfer (salary, rent, EMI, SIP ...).
 * Drives the forecast and can be posted to the ledger with one click when due.
 * Posting debits {@code debitAccountId} and credits {@code creditAccountId}.
 * Table file: {@code data/recurring_transactions.tbl}
 */
@Entity
@Table(name = "recurring_transactions", uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "name"}))
@Getter
@Setter
@NoArgsConstructor
public class RecurringTransaction implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private RecurringKind kind;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @References(Account.class)
    @Column(nullable = false)
    private Long debitAccountId;

    @References(Account.class)
    @Column(nullable = false)
    private Long creditAccountId;

    /** Category of the Expenses (expense) or Income (income) side. */
    @References(Category.class)
    private Long categoryId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 15)
    private Frequency frequency;

    @Column(nullable = false)
    private LocalDate startDate;

    private LocalDate endDate;

    @Column(nullable = false)
    private LocalDate nextDueDate;

    @Column(nullable = false)
    private Boolean active;

    @Column(length = 255)
    private String notes;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
