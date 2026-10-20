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
 * A vehicle that delivers bricks, with how many bricks one trip carries and its usual driver.
 * Table file: {@code data/brick_vehicles.tbl}
 */
@Entity
@Table(name = "brick_vehicles")
@Getter
@Setter
@NoArgsConstructor
public class BrickVehicle implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 30)
    private String number;

    @Column(length = 30)
    private String kind;

    @Column(nullable = false)
    private Integer capacity;

    @References(BrickResource.class)
    private Long driverId;

    @Column(nullable = false)
    private Boolean active;

    @Column(length = 200)
    private String note;

    /** Owned by the business (else a vehicle hired often enough to be enrolled). */
    private Boolean companyOwned;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
