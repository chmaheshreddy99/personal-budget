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

/**
 * How much of a payment into a card went to a billed EMI. Part payments add up: once they cover the whole EMI it is paid.
 * The payment is not a reference: it stays free to be changed or deleted, which takes its share back.
 * Table file: {@code data/emi_card_allocations.tbl}
 */
@Entity
@Table(name = "emi_card_allocations")
@Getter
@Setter
@NoArgsConstructor
public class EmiCardAllocation implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(EmiInstallment.class)
    @Column(nullable = false)
    private Long installmentId;

    /** The transfer into the card. */
    @Column(nullable = false)
    private Long paymentEntryId;

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate paidOn;
}
