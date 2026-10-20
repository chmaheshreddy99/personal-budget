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
 * Part of an advance taken back on a payment slip.
 * Table file: {@code data/brick_advance_recoveries.tbl}
 */
@Entity
@Table(name = "brick_advance_recoveries")
@Getter
@Setter
@NoArgsConstructor
public class BrickAdvanceRecovery implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickPaySlip.class)
    @Column(nullable = false)
    private Long advanceId;

    @References(BrickPaySlip.class)
    @Column(nullable = false)
    private Long slipId;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
