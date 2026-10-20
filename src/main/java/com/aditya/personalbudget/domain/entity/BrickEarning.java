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
 * What a resource earned and is still to be paid (or was paid on {@code slipId}): bricks made in a batch,
 * bricks loaded or unloaded, a delivery trip, a wage or salary, a bonus. Each batch or trip earns a resource once.
 * Table file: {@code data/brick_earnings.tbl}
 */
@Entity
@Table(name = "brick_earnings")
@Getter
@Setter
@NoArgsConstructor
public class BrickEarning implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickResource.class)
    @Column(nullable = false)
    private Long resourceId;

    @Column(nullable = false, length = 12)
    private String kind;

    @Column(length = 10)
    private String sourceType;

    private Long sourceId;

    @Column(nullable = false)
    private LocalDate earnedOn;

    private Integer quantity;

    private BigDecimal rate;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(length = 200)
    private String narrative;

    @References(BrickPaySlip.class)
    private Long slipId;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
