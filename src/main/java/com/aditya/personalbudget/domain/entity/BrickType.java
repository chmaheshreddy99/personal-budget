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
 * A kind of brick or block made and sold, e.g. "16X4X8 Dies": its MRP (price a brick), the days it cures
 * before it can be sold, and the stock it started with.
 * Table file: {@code data/brick_types.tbl}
 */
@Entity
@Table(name = "brick_types")
@Getter
@Setter
@NoArgsConstructor
public class BrickType implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 60)
    private String name;

    private BigDecimal mrp;

    private Integer curingDays;

    private Integer openingStock;

    @Column(length = 10)
    private String color;

    private Integer sortOrder;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
