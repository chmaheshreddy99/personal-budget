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

/**
 * One brick type's rate (a brick) in a pricing model.
 * Table file: {@code data/brick_pricing_rates.tbl}
 */
@Entity
@Table(name = "brick_pricing_rates")
@Getter
@Setter
@NoArgsConstructor
public class BrickPricingRate implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickPricingModel.class)
    @Column(nullable = false)
    private Long modelId;

    @References(BrickType.class)
    @Column(nullable = false)
    private Long brickTypeId;

    @Column(nullable = false)
    private BigDecimal rate;
}
