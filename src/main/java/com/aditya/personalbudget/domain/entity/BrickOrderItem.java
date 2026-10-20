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
 * Bricks of one type on an order: quantity, the MRP then and the agreed price (a brick).
 * Table file: {@code data/brick_order_items.tbl}
 */
@Entity
@Table(name = "brick_order_items")
@Getter
@Setter
@NoArgsConstructor
public class BrickOrderItem implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickOrder.class)
    @Column(nullable = false)
    private Long orderId;

    @References(BrickType.class)
    @Column(nullable = false)
    private Long brickTypeId;

    @Column(nullable = false)
    private Integer quantity;

    private BigDecimal mrp;

    @Column(nullable = false)
    private BigDecimal price;
}
