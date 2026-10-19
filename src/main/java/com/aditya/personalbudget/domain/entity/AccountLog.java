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
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * History of the accounts table: one row for every insert, update and delete of an {@link Account}, holding the
 * whole account as it was after the change (as it was before, for a delete), what changed, when and by whom.
 * Rows are only ever added. {@code accountId} is not a foreign key, so the history outlives a deleted account.
 * Table file: {@code data/account_log.tbl}
 */
@Entity
@Table(name = "account_log")
@Getter
@Setter
@NoArgsConstructor
public class AccountLog implements TenantOwned {

    /** A new account. */
    public static final String INSERT = "INSERT";
    /** The account itself was edited (name, details, active ...). */
    public static final String UPDATE = "UPDATE";
    /** The ledger moved its balance (a debit or credit was posted, changed or deleted). */
    public static final String BALANCE = "BALANCE";
    /** The account was deleted. */
    public static final String DELETE = "DELETE";
    /** The account as it stood when the log was started (accounts created before it existed). */
    public static final String BASELINE = "BASELINE";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long accountId;

    /** {@link #INSERT}, {@link #UPDATE}, {@link #BALANCE}, {@link #DELETE} or {@link #BASELINE}. */
    @Column(nullable = false, length = 10)
    private String action;

    /** The columns that changed, comma separated (empty for an insert, delete or baseline). */
    @Column(length = 500)
    private String changedFields;

    /** For a balance change: the balance before it. */
    private BigDecimal previousBalance;

    @Column(nullable = false)
    private LocalDateTime loggedAt;

    @Column(nullable = false, length = 50)
    private String loggedBy;

    /** The account's version after the change. */
    private Long accountVersion;

    // ------------------------------------------------------------------ the account as it was

    @Column(length = 20)
    private String code;
    @Column(length = 100)
    private String name;
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private AccountClass accountClass;
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private AccountType accountType;
    @Column(length = 100)
    private String institution;
    @Column(length = 40)
    private String accountNumber;
    private BigDecimal openingBalance;
    private LocalDate openingDate;
    private BigDecimal balance;
    private BigDecimal interestRate;
    private BigDecimal creditLimit;
    private LocalDate maturityDate;
    private BigDecimal quantity;
    @Column(length = 255)
    private String description;
    @Column(length = 100)
    private String holderName;
    @Column(length = 11)
    private String ifsc;
    @Column(length = 60)
    private String upiId;
    private Boolean chitBook;
    private Long hostedChitId;
    @Column(length = 12)
    private String chitRole;
    private Boolean projectBook;
    private Long projectId;
    @Column(length = 12)
    private String projectRole;
    private Boolean emiAccount;
    private Boolean systemAccount;
    private Boolean active;
    private LocalDateTime createdAt;
}
