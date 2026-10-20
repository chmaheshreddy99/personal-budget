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
 * A customer's order: who and where, the bricks and agreed prices, the vehicle, driver and loading / unloading
 * teams, delivery charges (or waived) and its status (from its trips).
 * Table file: {@code data/brick_orders.tbl}
 */
@Entity
@Table(name = "brick_orders")
@Getter
@Setter
@NoArgsConstructor
public class BrickOrder implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 20)
    private String orderNo;

    @Column(nullable = false)
    private LocalDate orderDate;

    private LocalDate requiredBy;

    @Column(nullable = false, length = 100)
    private String customerName;

    @Column(length = 20)
    private String customerPhone;

    @Column(length = 300)
    private String address;

    @Column(length = 150)
    private String landmark;

    @References(BrickVehicle.class)
    private Long vehicleId;

    @References(BrickResource.class)
    private Long driverId;

    @References(BrickResource.class)
    private Long loadingTeamId;

    @References(BrickResource.class)
    private Long unloadingTeamId;

    private BigDecimal deliveryChargePerTrip;

    private Boolean deliveryWaived;

    @Column(length = 150)
    private String waiveReason;

    private Boolean handlingBilled;

    private BigDecimal loadingRate;

    private BigDecimal unloadingRate;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(length = 500)
    private String note;

    /**
     * Delivered by a vehicle hired from outside (not enrolled): its number, the transporter (name, phone), the bricks a
     * trip carries, its charge a trip and who pays it: CUSTOMER (to the transporter, off the bill) or US (on the bill).
     */
    private Boolean hired;

    @Column(length = 30)
    private String hiredVehicle;

    @Column(length = 100)
    private String hiredContact;

    private Integer hiredCapacity;

    private BigDecimal hiredCharge;

    @Column(length = 10)
    private String hiredPaidBy;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime cancelledAt;

    /** The invoice, made when the order is paid in full: its number (kept), when it was made, its exact text and digital signature. */
    @Column(length = 20)
    private String invoiceNo;

    private LocalDateTime invoicedAt;

    @Column(length = 4000)
    private String invoicePayload;

    @Column(length = 200)
    private String invoiceSignature;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
