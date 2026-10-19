package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A part of the work (foundation, a slab, plastering...): its price and when it is paid for (contract works), and
 * when it is planned and done. For developments the stages are the construction milestones buyers' payments follow.
 * Table file: {@code data/construction_stages.tbl}
 */
@Entity
@Table(name = "construction_stages")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionStage implements TenantOwned {

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

    @Column(nullable = false)
    private Integer position;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    /** Contract works: the price of this part. */
    @PositiveOrZero
    private BigDecimal amount;

    private LocalDate plannedStart;

    private LocalDate plannedEnd;

    /** When the owner pays for it; empty: within 7 days of the stage being done. */
    private LocalDate dueDate;

    /** PENDING, IN_PROGRESS or DONE. */
    @Column(nullable = false, length = 12)
    private String status;

    private LocalDate completedOn;
}
