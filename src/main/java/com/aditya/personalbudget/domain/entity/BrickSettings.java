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
 * The Brick Management set-up of an organization: delivery and handling charges, driver incentives, how
 * customers pay (UPI) and who signs the payment slips (stamp, owner and accountant signatures). One row per organization.
 * Table file: {@code data/brick_settings.tbl}
 */
@Entity
@Table(name = "brick_settings")
@Getter
@Setter
@NoArgsConstructor
public class BrickSettings implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    private BigDecimal deliveryChargePerTrip;

    private Integer freeDeliveryMinQty;

    private BigDecimal driverIncentivePerTrip;

    private BigDecimal loadingRate;

    private BigDecimal unloadingRate;

    private Boolean billHandling;

    @Column(length = 60)
    private String upiId;

    @Column(length = 100)
    private String payeeName;

    @Column(length = 100)
    private String companyName;

    @Column(length = 300)
    private String address;

    @Column(length = 20)
    private String phone;

    @Column(length = 100)
    private String ownerName;

    @Column(length = 20000)
    private String ownerSignature;

    @Column(length = 100)
    private String accountantName;

    @Column(length = 20000)
    private String accountantSignature;

    @Column(length = 600)
    private String expenseHeads;

    private Integer payDay;

    @References(Account.class)
    private Long receiptAccountId;

    @References(Account.class)
    private Long payAccountId;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
