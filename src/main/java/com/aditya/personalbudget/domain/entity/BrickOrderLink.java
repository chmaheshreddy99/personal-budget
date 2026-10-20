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
import java.time.LocalDateTime;

/**
 * A temporary link to an order for the customer: its progress, the bill, how to pay and the receipt to sign.
 * Opened without an account; only a hash of the token is kept.
 * Table file: {@code data/brick_order_links.tbl}
 */
@Entity
@Table(name = "brick_order_links")
@Getter
@Setter
@NoArgsConstructor
public class BrickOrderLink implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickOrder.class)
    @Column(nullable = false)
    private Long orderId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(nullable = false, length = 100)
    private String createdByName;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime revokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;
}
