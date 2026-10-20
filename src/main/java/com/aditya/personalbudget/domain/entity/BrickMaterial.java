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
import java.time.LocalDateTime;

/**
 * A raw material used to make bricks (6MM Gravel, Robo Sand, Cement ...) with its unit and the stock it
 * started with; batches count what is left, purchases add to it.
 * Table file: {@code data/brick_materials.tbl}
 */
@Entity
@Table(name = "brick_materials")
@Getter
@Setter
@NoArgsConstructor
public class BrickMaterial implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 60)
    private String name;

    @Column(nullable = false, length = 15)
    private String unit;

    private BigDecimal openingStock;

    private BigDecimal reorderLevel;

    private BigDecimal lastRate;

    private Integer sortOrder;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
