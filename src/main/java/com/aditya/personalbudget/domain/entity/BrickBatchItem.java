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
 * Bricks of one type made in a batch, the damaged ones, and the labour rate a brick.
 * Table file: {@code data/brick_batch_items.tbl}
 */
@Entity
@Table(name = "brick_batch_items")
@Getter
@Setter
@NoArgsConstructor
public class BrickBatchItem implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickBatch.class)
    @Column(nullable = false)
    private Long batchId;

    @References(BrickType.class)
    @Column(nullable = false)
    private Long brickTypeId;

    @Column(nullable = false)
    private Integer quantity;

    private Integer damaged;

    private BigDecimal rate;
}
