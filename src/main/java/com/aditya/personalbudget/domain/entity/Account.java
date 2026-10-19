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
 * {@link #balance} is kept by the ledger itself (see {@code AccountLedgerSync}): every debit and credit posted,
 * changed or deleted updates it when the transaction commits. Every insert and update of an account is also
 * written to {@link AccountLog}.
 * Table file: {@code data/accounts.tbl}
 */
@Entity
@Table(name = "accounts", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"organizationId", "code"}),
        @UniqueConstraint(columnNames = {"organizationId", "name"})
})
@Getter
@Setter
@NoArgsConstructor
public class Account implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
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

    /**
     * Balance on the opening date, in the account's natural sign (posted as an opening journal). Set when the
     * account is created and never changed after that: a correction is a journal entry.
     */
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

    /** Bank and wallet accounts: the name the account is held in (shown to chit members paying into it). */
    @Column(length = 100)
    private String holderName;

    /** Bank accounts: the branch's IFSC, e.g. ICIC0000598. */
    @Column(length = 11)
    private String ifsc;

    /** Bank and wallet accounts: the UPI ID money can be sent to, e.g. name@okicici. */
    @Column(length = 60)
    private String upiId;

    /**
     * Part of the hosted-chit book (Host a Chit, Chit accounts): the money of the chits the user runs as organiser.
     * These accounts are kept off the personal Accounts page, pickers and liquid-money figures.
     */
    private Boolean chitBook;

    /** The hosted chit this account belongs to; empty for a common chit account (shared by every hosted chit). */
    @References(HostedChit.class)
    private Long hostedChitId;

    /** Chit-book accounts: COLLECTION, COMMISSION, LATE_FEE, COMMON or FUNDS (see {@link #ROLE_COLLECTION} ...). */
    @Column(length = 12)
    private String chitRole;

    public static final String ROLE_COLLECTION = "COLLECTION";
    public static final String ROLE_COMMISSION = "COMMISSION";
    public static final String ROLE_LATE_FEE = "LATE_FEE";
    public static final String ROLE_COMMON = "COMMON";
    /** The Hosted Chit Funds liability: the members' money held until it is paid out. */
    public static final String ROLE_FUNDS = "FUNDS";
    /** Clearing account: installments members paid straight to the month's winner, cleared by the payout. */
    public static final String ROLE_DIRECT = "DIRECT";

    /**
     * Part of the construction book (the Construction section): the business's money, kept off the personal Accounts
     * page, pickers and liquid-money figures like the hosted-chit book.
     */
    private Boolean projectBook;

    /** The construction project this account belongs to; empty for a common business account. */
    @References(ConstructionProject.class)
    private Long projectId;

    /** Construction-book accounts: BANK, COST, LAND, ADVANCES, INTEREST, PROFIT, LOAN, CAPITAL or COMMON. */
    @Column(length = 12)
    private String projectRole;

    /** What is still owed on something bought on a loan / finance EMI: kept off the Accounts list unless asked for. */
    private Boolean emiAccount;

    /**
     * The current balance in the account's natural sign (a positive asset is money you own, a positive liability
     * money you owe): the sum of all its journal lines, kept up to date by the ledger on every debit and credit.
     * Saves of the account itself never change it.
     */
    private BigDecimal balance;
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

    public boolean isChitBook() {
        return Boolean.TRUE.equals(chitBook);
    }

    public boolean isEmiAccount() {
        return Boolean.TRUE.equals(emiAccount);
    }

    public boolean isProjectBook() {
        return Boolean.TRUE.equals(projectBook);
    }

    /** Money the user can spend: cash, bank or wallet, and not the chit book's (members' money). */
    public boolean isLiquid() {
        return accountType.isLiquid() && !isChitBook() && !isProjectBook();
    }
}
