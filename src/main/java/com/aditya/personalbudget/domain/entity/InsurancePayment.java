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
 * A premium recorded from Documents, booked as an expense. The entry is not a reference: the expense stays free to be
 * deleted in Expenses, and the history then says so. Table file: {@code data/insurance_payments.tbl}
 */
@Entity
@Table(name = "insurance_payments")
@Getter
@Setter
@NoArgsConstructor
public class InsurancePayment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(InsurancePolicy.class)
    @Column(nullable = false)
    private Long policyId;

    /** The due date this premium was for: where undoing it puts the policy back. */
    private LocalDate dueDate;

    @Column(nullable = false)
    private LocalDate paidOn;

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false)
    private Long accountId;

    @Column(nullable = false)
    private Long entryId;

    @Column(nullable = false, length = 40)
    private String entryNo;

    /** The document's valid-until before this payment moved it. */
    private LocalDate previousExpiresOn;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
