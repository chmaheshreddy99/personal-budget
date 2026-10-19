package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A ledger account in the chart of accounts: bank, card, loan, gold, an expense category, an income source ...
 * The balance is never stored; it is always derived from journal lines.
 * Table file: {@code data/accounts.tbl}
 */
@Entity
@Table(name = "accounts", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"tenantId", "code"}),
        @UniqueConstraint(columnNames = {"tenantId", "name"})
})
@Getter
@Setter
@NoArgsConstructor
public class Account implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** Chart-of-accounts code, e.g. 1100 for a bank account, 5000 for groceries. */
    @Column(nullable = false, length = 20)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AccountClass accountClass;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private AccountType accountType;

    /** Bank, card issuer, lender, jeweller ... */
    @Column(length = 100)
    private String institution;

    /** Masked account / card / policy number. */
    @Column(length = 40)
    private String accountNumber;

    /** Balance on the opening date, in the account's natural sign (posted as an opening journal). */
    @PositiveOrZero
    private BigDecimal openingBalance;

    private LocalDate openingDate;

    /** Annual interest rate in percent (deposits, loans, cards). */
    @PositiveOrZero
    @DecimalMax("100")
    private BigDecimal interestRate;

    /** Credit card limit or sanctioned loan amount. */
    @PositiveOrZero
    private BigDecimal creditLimit;

    /** Maturity date for deposits, loan end date ... */
    private LocalDate maturityDate;

    /** Optional quantity for commodity accounts, e.g. grams of gold. */
    @PositiveOrZero
    private BigDecimal quantity;

    @Column(length = 255)
    private String description;

    /** System accounts are created automatically and cannot be deleted. */
    @Column(nullable = false)
    private Boolean systemAccount;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
