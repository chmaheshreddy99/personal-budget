package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.VoucherType;
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
import java.time.LocalDateTime;

/**
 * Header of a double-entry journal. Its {@link JournalLine}s always balance (total debit = total credit).
 * Table file: {@code data/journal_entries.tbl}
 */
@Entity
@Table(name = "journal_entries", uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "entryNo"}))
@Getter
@Setter
@NoArgsConstructor
public class JournalEntry implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** Human readable number, e.g. EX-000042. */
    @Column(nullable = false, length = 20)
    private String entryNo;

    @Column(nullable = false)
    private LocalDate entryDate;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private VoucherType voucherType;

    @Column(nullable = false, length = 255)
    private String narration;

    /** Bill number, cheque number, UPI reference ... */
    @Column(length = 60)
    private String reference;

    /** Optional payee / payer name. */
    @Column(length = 100)
    private String party;

    /** Total of the debit side (= total of the credit side). */
    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    /** Business object that generated the entry, e.g. "CHIT_INSTALLMENT" + its id. */
    @Column(length = 30)
    private String sourceType;

    private Long sourceId;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
