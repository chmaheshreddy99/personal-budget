package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * An organization's subscription to a monthly statement by e-mail: which statement (see StatementService.KINDS), who
 * receives it, on which day of the month the previous month's statement goes out, and whether the PDF is locked with
 * a password (kept encrypted, never sent back to the browser). Table file: {@code data/statement_subscriptions.tbl}
 */
@Entity
@Table(name = "statement_subscriptions")
@Getter
@Setter
@NoArgsConstructor
public class StatementSubscription implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** ACCOUNTS, BALANCE_SHEET, CHITS, INCOME_EXPENSE, MONEY_OWED or EMIS. */
    @Column(nullable = false, length = 20)
    private String kind;

    /** E-mail addresses, comma separated. */
    @Column(nullable = false, length = 600)
    private String recipients;

    /** For the account statement: the accounts it covers, comma separated ids; empty = every account of my own. */
    @Column(length = 600)
    private String accountIds;

    /** The day of the month (1 to 28) the previous month's statement is sent. */
    private Integer dayOfMonth;

    /** Lock the PDF with the password below. */
    private Boolean protect;

    /** Encrypted: base64 of IV + AES-GCM cipher text. */
    @Column(length = 300)
    private String passwordEnc;

    private Boolean active;

    /** The last month sent (yyyy-MM), when, and what happened ("Sent to 2" or the error). */
    @Column(length = 7)
    private String lastPeriod;

    private LocalDateTime lastSentAt;

    @Column(length = 255)
    private String lastResult;

    @Column(length = 50)
    private String createdBy;

    private LocalDateTime createdAt;

    @Version
    private Long version;
}
