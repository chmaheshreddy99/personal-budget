package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A loan taken for the project (a construction finance from a bank or a private lender): its own liability account.
 * Table file: {@code data/construction_loans.tbl}
 */
@Entity
@Table(name = "construction_loans")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionLoan implements TenantOwned {

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
    private String lender;

    @Column(length = 40)
    private String loanNo;

    @Positive
    @Column(nullable = false)
    private BigDecimal sanctioned;

    /** % a year. */
    @PositiveOrZero
    private BigDecimal ratePercent;

    @PositiveOrZero
    private Integer tenureMonths;

    private LocalDate sanctionDate;

    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    /** ACTIVE or CLOSED. */
    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 300)
    private String note;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
