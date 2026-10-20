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
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A production batch: the bricks a team made on a day (by type), the pricing model they are paid by, and the
 * raw material left in the yard after it (its consumption is worked out from the batch before).
 * Table file: {@code data/brick_batches.tbl}
 */
@Entity
@Table(name = "brick_batches")
@Getter
@Setter
@NoArgsConstructor
public class BrickBatch implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 20)
    private String batchNo;

    @Column(nullable = false)
    private LocalDate producedOn;

    @References(BrickResource.class)
    private Long teamId;

    @References(BrickPricingModel.class)
    private Long pricingModelId;

    @Column(length = 500)
    private String note;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
