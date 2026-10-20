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
 * A payment slip: a weekly or monthly payment (its earnings, less advances recovered) or an advance given.
 * Signed digitally when made; a cancelled slip stays, with its entry taken off the books.
 * Table file: {@code data/brick_pay_slips.tbl}
 */
@Entity
@Table(name = "brick_pay_slips")
@Getter
@Setter
@NoArgsConstructor
public class BrickPaySlip implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 20)
    private String slipNo;

    @Column(nullable = false, length = 10)
    private String kind;

    @References(BrickResource.class)
    @Column(nullable = false)
    private Long resourceId;

    private LocalDate periodFrom;

    private LocalDate periodTo;

    @Column(nullable = false)
    private BigDecimal gross;

    private BigDecimal deductions;

    @Column(nullable = false)
    private BigDecimal net;

    @Column(nullable = false)
    private LocalDate paidOn;

    @References(Account.class)
    private Long accountId;

    @Column(length = 20)
    private String mode;

    @Column(length = 60)
    private String reference;

    @Column(length = 300)
    private String narrative;

    private BigDecimal recoverPerCycle;

    @Column(nullable = false, length = 10)
    private String status;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 4000)
    private String payload;

    @Column(length = 200)
    private String digitalSignature;

    @Column(length = 100)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    private LocalDateTime cancelledAt;

    @Column(length = 100)
    private String cancelledBy;
}
