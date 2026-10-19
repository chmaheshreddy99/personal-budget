package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * A partner in the project and the share of its profit agreed with them; "me" is the user. Another partner's money
 * is owed to them: their capital account is a liability of the business.
 * Table file: {@code data/construction_partners.tbl}
 */
@Entity
@Table(name = "construction_partners")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionPartner implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The project it belongs to. */
    @References(ConstructionProject.class)
    @Column(nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 15)
    private String phone;

    @Column(length = 200)
    private String address;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal sharePercent;

    private Boolean me;

    /** Another partner's capital account. */
    @References(Account.class)
    private Long accountId;

    @Column(length = 200)
    private String note;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
