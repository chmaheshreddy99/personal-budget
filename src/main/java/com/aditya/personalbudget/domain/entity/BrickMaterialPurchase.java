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
 * Raw material received (bought), posted to the books as a raw material cost.
 * Table file: {@code data/brick_material_purchases.tbl}
 */
@Entity
@Table(name = "brick_material_purchases")
@Getter
@Setter
@NoArgsConstructor
public class BrickMaterialPurchase implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickMaterial.class)
    @Column(nullable = false)
    private Long materialId;

    @Column(nullable = false)
    private LocalDate receivedOn;

    @Column(nullable = false)
    private BigDecimal quantity;

    private BigDecimal rate;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(length = 100)
    private String vendor;

    @Column(length = 40)
    private String billNo;

    @Column(length = 30)
    private String vehicleNo;

    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 300)
    private String note;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
