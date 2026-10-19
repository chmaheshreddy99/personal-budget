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
import java.time.LocalDateTime;

/**
 * A flat (or shop, villa) of a development, the builder's to sell or allotted to a landowner.
 * Table file: {@code data/construction_units.tbl}
 */
@Entity
@Table(name = "construction_units")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionUnit implements TenantOwned {

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

    @Column(nullable = false, length = 20)
    private String unitNo;

    @Column(length = 20)
    private String block;

    private Integer floor;

    /** 1BHK, 2BHK, 3BHK, Shop, Villa... */
    @Column(length = 20)
    private String unitType;

    /** Square feet (RERA carpet area). */
    @PositiveOrZero
    private BigDecimal carpetArea;

    @PositiveOrZero
    private BigDecimal builtUpArea;

    /** Saleable (super built-up) area. */
    @PositiveOrZero
    private BigDecimal superArea;

    @Column(length = 12)
    private String facing;

    @Column(length = 40)
    private String parking;

    /** List price. */
    @PositiveOrZero
    private BigDecimal price;

    /** BUILDER or LANDOWNER. */
    @Column(nullable = false, length = 10)
    private String allottedTo;

    /** The landowner it is allotted to. */
    @References(ConstructionParty.class)
    private Long partyId;

    /** AVAILABLE, BOOKED, SOLD, HANDED_OVER (or LANDOWNER). */
    @Column(nullable = false, length = 12)
    private String status;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
