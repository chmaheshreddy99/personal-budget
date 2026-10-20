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
 * A raw material's stock counted at the end of a batch (what is left in the yard).
 * Table file: {@code data/brick_batch_materials.tbl}
 */
@Entity
@Table(name = "brick_batch_materials")
@Getter
@Setter
@NoArgsConstructor
public class BrickBatchMaterial implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickBatch.class)
    @Column(nullable = false)
    private Long batchId;

    @References(BrickMaterial.class)
    @Column(nullable = false)
    private Long materialId;

    @Column(nullable = false)
    private BigDecimal closing;
}
