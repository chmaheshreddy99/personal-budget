package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * The sale of a flat to a buyer: the price and payment plan, the buyer's home loan, the agreement, registration,
 * handover and closing.
 * Table file: {@code data/construction_sales.tbl}
 */
@Entity
@Table(name = "construction_sales")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionSale implements TenantOwned {

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

    @References(ConstructionUnit.class)
    @Column(nullable = false)
    private Long unitId;

    @Column(nullable = false, length = 100)
    private String buyerName;

    @Column(length = 100)
    private String buyerRelation;

    @Column(length = 15)
    private String buyerPhone;

    @Column(length = 100)
    private String buyerEmail;

    @Column(length = 200)
    private String buyerAddress;

    /** Masked: ABCPE••••F. */
    @Column(length = 12)
    private String buyerPan;

    @Column(length = 100)
    private String coBuyerName;

    @Column(nullable = false)
    private LocalDate bookedOn;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal basePrice;

    /** Car parking, amenities, corpus fund, GST... */
    @PositiveOrZero
    private BigDecimal otherCharges;

    @Column(length = 200)
    private String otherChargesNote;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal totalPrice;

    /** % a month; empty: the project's. */
    @PositiveOrZero
    private BigDecimal lateInterestPercent;

    /** BOOKED, AGREED, REGISTERED, HANDED_OVER, CLOSED or CANCELLED. */
    @Column(nullable = false, length = 12)
    private String status;

    /** The buyer's home loan. */
    @Column(length = 100)
    private String loanBank;

    @Column(length = 100)
    private String loanBranch;

    @PositiveOrZero
    private BigDecimal loanAmount;

    @Column(length = 40)
    private String loanNo;

    private LocalDate loanSanctionedOn;

    /** NONE, APPLIED, SANCTIONED, DISBURSING or DISBURSED. */
    @Column(length = 12)
    private String loanStatus;

    private LocalDate agreementOn;

    private LocalDate registeredOn;

    /** The registered sale deed's document number. */
    @Column(length = 40)
    private String deedNo;

    @Column(length = 100)
    private String subRegistrar;

    private LocalDate handedOverOn;

    @Column(length = 300)
    private String handoverNote;

    private LocalDateTime closedAt;

    @Column(length = 200)
    private String cancelNote;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
