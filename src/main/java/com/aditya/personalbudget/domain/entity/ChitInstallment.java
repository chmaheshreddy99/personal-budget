package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One scheduled monthly installment of a chit.
 * {@code dividend} is the member's share of the auction discount; the cash actually paid is
 * {@code dueAmount - dividend}.
 * Table file: {@code data/chit_installments.tbl}
 */
@Entity
@Table(name = "chit_installments", uniqueConstraints = @UniqueConstraint(columnNames = {"chitId", "installmentNo"}))
@Getter
@Setter
@NoArgsConstructor
public class ChitInstallment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(Chit.class)
    @Column(nullable = false)
    private Long chitId;

    @Positive
    @Column(nullable = false)
    private Integer installmentNo;

    @Column(nullable = false)
    private LocalDate dueDate;

    @Positive
    @Column(nullable = false)
    private BigDecimal dueAmount;

    @PositiveOrZero
    private BigDecimal dividend;

    @PositiveOrZero
    private BigDecimal paidAmount;

    private LocalDate paidDate;

    @References(Account.class)
    private Long paidFromAccountId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private InstallmentStatus status;
}
