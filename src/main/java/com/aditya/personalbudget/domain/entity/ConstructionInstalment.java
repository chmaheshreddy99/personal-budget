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
 * A part of a buyer's payment plan: an amount due on a date, or a set number of days after a construction stage
 * is done (construction-linked plan).
 * Table file: {@code data/construction_instalments.tbl}
 */
@Entity
@Table(name = "construction_instalments")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionInstalment implements TenantOwned {

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

    @References(ConstructionSale.class)
    @Column(nullable = false)
    private Long saleId;

    @Column(nullable = false)
    private Integer position;

    @Column(nullable = false, length = 100)
    private String label;

    @PositiveOrZero
    private BigDecimal percent;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal amount;

    private LocalDate dueDate;

    @References(ConstructionStage.class)
    private Long stageId;

    @PositiveOrZero
    private Integer daysAfterStage;
}
