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
 * One delivery trip of an order: what it carries, its vehicle and driver, where it is (planned, loading at the
 * yard, dispatched, on the way, delivered) and the customer's signed acknowledgement of receipt.
 * Table file: {@code data/brick_trips.tbl}
 */
@Entity
@Table(name = "brick_trips")
@Getter
@Setter
@NoArgsConstructor
public class BrickTrip implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickOrder.class)
    @Column(nullable = false)
    private Long orderId;

    @Column(nullable = false)
    private Integer tripNo;

    @References(BrickVehicle.class)
    private Long vehicleId;

    @References(BrickResource.class)
    private Long driverId;

    @References(BrickResource.class)
    private Long loadingTeamId;

    @References(BrickResource.class)
    private Long unloadingTeamId;

    private LocalDate scheduledOn;

    @Column(nullable = false, length = 12)
    private String status;

    private LocalDateTime loadingAt;

    private LocalDateTime dispatchedAt;

    private LocalDateTime inTransitAt;

    private LocalDateTime deliveredAt;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 100)
    private String ackName;

    private LocalDateTime ackAt;

    @Column(length = 20000)
    private String ackSignature;

    @Column(length = 80)
    private String ackLocation;

    @Column(length = 2000)
    private String ackDevice;

    @Column(length = 64)
    private String ackIp;

    @Column(length = 300)
    private String ackRemarks;

    @Column(length = 64)
    private String ackSeal;

    @Column(length = 4000)
    private String ackPayload;

    @Column(length = 200)
    private String ackDigitalSignature;

    @Column(length = 300)
    private String note;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
