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
 * The land side of a development: a seller of the plot the builder buys, or a landowner under the joint development
 * agreement with their share.
 * Table file: {@code data/construction_parties.tbl}
 */
@Entity
@Table(name = "construction_parties")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionParty implements TenantOwned {

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

    /** SELLER or LANDOWNER. */
    @Column(nullable = false, length = 10)
    private String role;

    @Column(nullable = false, length = 100)
    private String name;

    /** S/o, D/o or W/o. */
    @Column(length = 100)
    private String relation;

    @Column(length = 15)
    private String phone;

    @Column(length = 200)
    private String address;

    /** Of the plot (sellers) or of the landowners' share (landowners). */
    @PositiveOrZero
    private BigDecimal sharePercent;

    /** Sellers: their part of the price. Landowners: their part of the refundable deposit. */
    @PositiveOrZero
    private BigDecimal consideration;

    @Column(length = 300)
    private String note;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
