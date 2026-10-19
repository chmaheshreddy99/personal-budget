package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Money spent on the project: materials, labour, contractors, approvals, the land, loan interest... by head.
 * Table file: {@code data/construction_costs.tbl}
 */
@Entity
@Table(name = "construction_costs")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionCost implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The project it belongs to. */
    @References(ConstructionProject.class)
    @Column(nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 30)
    private String head;

    @Column(length = 200)
    private String description;

    @Column(length = 100)
    private String vendor;

    @Column(length = 40)
    private String billNo;

    @PositiveOrZero
    private BigDecimal quantity;

    @Column(length = 12)
    private String unit;

    @PositiveOrZero
    private BigDecimal rate;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate spentOn;

    /** Paid from. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @References(ConstructionStage.class)
    private Long stageId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
