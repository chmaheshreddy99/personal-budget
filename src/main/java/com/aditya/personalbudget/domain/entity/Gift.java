package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A gift given or received, or a donation: to or from whom, on what occasion, what it was (cash, gold, silver, an
 * item...) and what it is worth. Kept as a register beside the books (a gift is not income), so the give-and-take
 * with each family and friend is clear. Cash given can also be booked as an expense ({@code journalEntryId}).
 * Photos and receipts are attachments. Table file: {@code data/gifts.tbl}
 */
@Entity
@Table(name = "gifts")
@Getter
@Setter
@NoArgsConstructor
public class Gift implements TenantOwned {

    public static final String GIVEN = "GIVEN";
    public static final String RECEIVED = "RECEIVED";

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** GIVEN or RECEIVED. */
    @Column(nullable = false, length = 10)
    private String direction;

    @Column(nullable = false)
    private LocalDate giftDate;

    /** The person, family or organisation (a temple, a trust). */
    @Column(nullable = false, length = 100)
    private String person;

    /** Brother, Cousin, Friend, Colleague, Neighbour, Temple / charity ... */
    @Column(length = 40)
    private String relation;

    /** The family or side the person belongs to ("Reddy family", "Mother's side"), to group a large circle. */
    @Column(length = 60)
    private String family;

    /** Wedding, Birthday, Housewarming, Festival, Naming ceremony, Get-together ... */
    @Column(length = 60)
    private String occasion;

    /** CASH, GOLD, SILVER, ITEM or OTHER. */
    @Column(nullable = false, length = 10)
    private String kind;

    @Column(length = 255)
    private String description;

    /** Money value: the amount for cash, an estimate for anything else. */
    private BigDecimal value;

    /** Grams for gold and silver, pieces for items. */
    private BigDecimal quantity;

    @Column(length = 10)
    private String unit;

    /** 22K, 24K, 916, 925 ... */
    @Column(length = 20)
    private String purity;

    /** How cash moved: Cash, UPI, Bank transfer, Cheque. */
    @Column(length = 20)
    private String mode;

    /** A donation (to a temple, charity, trust) rather than a personal gift. */
    private Boolean donation;

    /** Eligible for a tax deduction (80G receipt). */
    private Boolean taxDeductible;

    @Column(length = 255)
    private String notes;

    /** Cash given booked as an expense from this account. */
    @References(Account.class)
    private Long accountId;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
