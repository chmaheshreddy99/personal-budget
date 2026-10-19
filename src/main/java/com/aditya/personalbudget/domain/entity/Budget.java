package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * Spending limit for one expense category in one month. A <b>committed</b> budget is a payment that has to be
 * made without fail (rent, school fees, an EMI), optionally by a day of the month; it is tracked as paid,
 * due or overdue rather than by spending pace. "Copy last month" carries budgets into the next month.
 * Table file: {@code data/budgets.tbl}
 */
@Entity
@Table(name = "budgets", uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "categoryId", "month"}))
@Getter
@Setter
@NoArgsConstructor
public class Budget implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** Must be an EXPENSE account. */
    @References(Category.class)
    @Column(nullable = false)
    private Long categoryId;

    @Positive
    @Column(nullable = false)
    private BigDecimal monthlyLimit;

    /** Warn when spending reaches this percent of the limit. */
    @Min(1)
    @Max(100)
    @Column(nullable = false)
    private Integer alertPercent;

    @Column(length = 255)
    private String notes;

    /** The month this budget is for, e.g. 2026-10. */
    @jakarta.validation.constraints.Pattern(regexp = "\\d{4}-\\d{2}")
    @Column(length = 7)
    private String month;

    /** Has to be paid without fail (rent, fees, EMI): tracked as paid / due / overdue. */
    private Boolean committed;

    /** Day of the month a committed payment is due (1-31; the last day for shorter months). */
    @Min(1)
    @Max(31)
    private Integer dueDay;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
