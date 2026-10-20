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

/**
 * Bricks of one type on a trip: loaded, and delivered (less any broken on the way).
 * Table file: {@code data/brick_trip_items.tbl}
 */
@Entity
@Table(name = "brick_trip_items")
@Getter
@Setter
@NoArgsConstructor
public class BrickTripItem implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickTrip.class)
    @Column(nullable = false)
    private Long tripId;

    @References(BrickType.class)
    @Column(nullable = false)
    private Long brickTypeId;

    @Column(nullable = false)
    private Integer quantity;

    private Integer delivered;
}
