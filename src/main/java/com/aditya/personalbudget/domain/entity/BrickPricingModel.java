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
 * How a production team is paid for what it makes: a rate a brick for each brick type. One model is the default.
 * Table file: {@code data/brick_pricing_models.tbl}
 */
@Entity
@Table(name = "brick_pricing_models")
@Getter
@Setter
@NoArgsConstructor
public class BrickPricingModel implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 60)
    private String name;

    private Boolean defaultModel;

    @Column(nullable = false)
    private Boolean active;

    @Column(length = 200)
    private String note;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
