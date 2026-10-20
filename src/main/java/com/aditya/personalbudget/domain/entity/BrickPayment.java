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
 * Money received from a customer for an order (posted), or a payment the customer says they made on the order
 * link (CLAIMED, waiting to be confirmed).
 * Table file: {@code data/brick_payments.tbl}
 */
@Entity
@Table(name = "brick_payments")
@Getter
@Setter
@NoArgsConstructor
public class BrickPayment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(BrickOrder.class)
    @Column(nullable = false)
    private Long orderId;

    @Column(length = 20)
    private String receiptNo;

    @Column(nullable = false)
    private LocalDate receivedOn;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(length = 20)
    private String mode;

    @Column(length = 60)
    private String reference;

    @References(Account.class)
    private Long accountId;

    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 200)
    private String note;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 100)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
