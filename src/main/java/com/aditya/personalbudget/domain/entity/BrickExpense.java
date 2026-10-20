package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
 * A production expense other than raw material (diesel, electricity, repairs ...), posted to the books.
 * Table file: {@code data/brick_expenses.tbl}
 */
@Entity
@Table(name = "brick_expenses")
@Getter
@Setter
@NoArgsConstructor
public class BrickExpense implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 40)
    private String head;

    @Column(length = 200)
    private String description;

    @Column(length = 100)
    private String vendor;

    @Column(length = 40)
    private String billNo;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate spentOn;

    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @References(BrickBatch.class)
    private Long batchId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
