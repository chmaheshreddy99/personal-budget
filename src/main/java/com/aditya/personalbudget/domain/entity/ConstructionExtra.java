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
import java.time.LocalDateTime;

/**
 * Extra work the owner asks for beyond the contract: its price and the days it adds to the timeline, agreed in a
 * supplementary agreement.
 * Table file: {@code data/construction_extras.tbl}
 */
@Entity
@Table(name = "construction_extras")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionExtra implements TenantOwned {

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
    private Integer seq;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(length = 1000)
    private String description;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal amount;

    @PositiveOrZero
    private Integer extraDays;

    private LocalDate requestedOn;

    /** PROPOSED, AGREED, DONE or CANCELLED. Agreed and done extras add to the price and the timeline. */
    @Column(nullable = false, length = 12)
    private String status;

    private LocalDate dueDate;

    private LocalDate completedOn;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
