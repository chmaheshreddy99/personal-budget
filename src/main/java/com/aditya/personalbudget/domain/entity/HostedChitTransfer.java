package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Money moved in the hosted-chit book (Host a Chit, Chit accounts): from one or more accounts ({@link HostedChitLeg}s)
 * into one account, posted as one transfer journal. Used to consolidate installments members paid into different bank
 * accounts, to put the organiser's own money into a chit (an advance) or to take the commission out.
 * <p>
 * {@code chitMoney}: the money is the chit's (the members'), so lines on personal accounts are tagged with the chit
 * too; otherwise it is the organiser's own and only the chit-book side carries the chit.
 * Table file: {@code data/hosted_chit_transfers.tbl}
 */
@Entity
@Table(name = "hosted_chit_transfers")
@Getter
@Setter
@NoArgsConstructor
public class HostedChitTransfer implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The chit whose money moves; empty for the organiser's own money between common accounts. */
    @References(HostedChit.class)
    private Long chitId;

    @Column(nullable = false)
    private LocalDate transferDate;

    @References(Account.class)
    @Column(nullable = false)
    private Long toAccountId;

    /** The total moved (the legs add up to it). */
    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private Boolean chitMoney;

    /** Money gathered into the collections account for this month's payout (its payments are then "moved"). */
    private Integer payoutMonthNo;

    /** Cash, UPI or Bank. */
    @Column(nullable = false, length = 10)
    private String mode;

    @Column(length = 60)
    private String reference;

    @Column(length = 255)
    private String note;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
