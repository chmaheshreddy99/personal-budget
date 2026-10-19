package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A chit fund membership (rotating savings scheme).
 * <p>
 * The member pays {@code monthlyInstallment} for {@code numberOfInstallments} months and receives
 * either an early prize (PRIZED) or the {@code maturityAmount} at the end. Money paid in is tracked
 * in a dedicated asset account ({@code accountId}) of type CHIT_FUND.
 * Table file: {@code data/chits.tbl}
 */
@Entity
@Table(name = "chits", uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "name"}))
@Getter
@Setter
@NoArgsConstructor
public class Chit implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 100)
    private String name;

    /** Chit company / foreman. */
    @Column(length = 100)
    private String organizer;

    /** Organizer's UPI ID (VPA) for paying installments by QR code, e.g. shriram@hdfcbank. */
    @Column(length = 60)
    private String organizerUpi;

    /** Optional short text that starts the UPI payment note; the installment number is always appended. */
    @Column(length = 40)
    private String upiNote;

    /** Bank / cash / card installments are normally paid from (pre-selected when paying). */
    @References(Account.class)
    private Long defaultPaymentAccountId;

    /** Group or ticket number. */
    @Column(length = 40)
    private String ticketNo;

    /** Amount expected at maturity (the value of the chit). */
    @Positive
    @Column(nullable = false)
    private BigDecimal maturityAmount;

    @Positive
    @Column(nullable = false)
    private BigDecimal monthlyInstallment;

    @Positive
    @Max(600)
    @Column(nullable = false)
    private Integer numberOfInstallments;

    @Column(nullable = false)
    private LocalDate startDate;

    @Column(nullable = false)
    private LocalDate endDate;

    /**
     * Optional annual interest rate (percent) for the month-by-month interest schedule.
     * When empty, the rate implied by the installments and the maturity amount is used.
     */
    @PositiveOrZero
    @DecimalMax("60")
    private BigDecimal interestRate;

    /** Foreman commission, percent of the maturity amount. */
    @PositiveOrZero
    @DecimalMax("20")
    private BigDecimal commissionPercent;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ChitStatus status;

    /** The CHIT_FUND asset account that accumulates installments. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @PositiveOrZero
    private BigDecimal payoutAmount;

    private LocalDate payoutDate;

    /** When the chit was closed (status CLOSED): it is finished and kept for the record; reopening clears it. */
    private LocalDateTime closedAt;

    @Column(length = 255)
    private String notes;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
