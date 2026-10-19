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
 * A construction project of the builder's business (the Construction section): either a contract work, built for
 * the owner of a site against a stage-wise price, or an apartment development of the builder's own, on a plot it
 * buys or on land given by its owners under a joint development agreement, whose flats are sold to buyers.
 * Each project keeps its own accounts (bank, construction cost, land, advances received, late interest) in the
 * construction book, off the personal accounts.
 * Table file: {@code data/construction_projects.tbl}
 */
@Entity
@Table(name = "construction_projects")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionProject implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** CONTRACT or DEVELOPMENT. */
    @Column(nullable = false, length = 12)
    private String kind;

    /** Developments: OWN_PLOT (the builder buys the plot) or JOINT (joint development with the landowners). */
    @Column(length = 12)
    private String landMode;

    @Column(nullable = false, length = 100)
    private String name;

    /** A short code for receipts and agreements (GV-R0001); made from the name when empty. */
    @Column(length = 6)
    private String code;

    /** PLANNING, ACTIVE, COMPLETED or CLOSED (books final). */
    @Column(nullable = false, length = 12)
    private String status;

    @Column(length = 200)
    private String siteAddress;

    /** Also the place of the agreements and of the courts having jurisdiction. */
    @Column(length = 60)
    private String city;

    @Column(length = 60)
    private String surveyNo;

    @Column(length = 40)
    private String plotNo;

    @PositiveOrZero
    private BigDecimal plotArea;

    /** SQ_YD, SQ_FT, SQ_M, ACRE or GUNTA. */
    @Column(length = 8)
    private String areaUnit;

    /** North, south, east and west of the site, as in its title deed. */
    @Column(length = 300)
    private String boundaries;

    /** Square feet. */
    @PositiveOrZero
    private BigDecimal builtUpArea;

    @PositiveOrZero
    private Integer floors;

    /** Building permission / sanctioned plan number. */
    @Column(length = 60)
    private String permitNo;

    /** Developments: RERA registration number. */
    @Column(length = 60)
    private String reraNo;

    private LocalDate startDate;

    /** Completion as agreed; extra works agreed later add their days to it. */
    private LocalDate plannedEndDate;

    private LocalDate completedOn;

    private LocalDateTime closedAt;

    /** Contract works: the owner of the site. */
    @Column(length = 100)
    private String clientName;

    @Column(length = 15)
    private String clientPhone;

    @Column(length = 200)
    private String clientAddress;

    @Column(length = 100)
    private String clientEmail;

    /** S/o, D/o or W/o, as written in deeds. */
    @Column(length = 100)
    private String clientRelation;

    /** Interest on late payments by the owner or buyers, % a month (simple, by the day). */
    @PositiveOrZero
    private BigDecimal lateInterestPercent;

    @PositiveOrZero
    private Integer lateGraceDays;

    @PositiveOrZero
    private Integer defectLiabilityMonths;

    /** What the builder expects to spend, to compare the costs with. */
    @PositiveOrZero
    private BigDecimal estimatedCost;

    /** Own plot: the price agreed with the seller(s). */
    @PositiveOrZero
    private BigDecimal plotPrice;

    /** Joint development: the landowners' share of the built area / flats. */
    @PositiveOrZero
    private BigDecimal landownerSharePercent;

    /** Joint development: the security deposit paid to the landowners. */
    @PositiveOrZero
    private BigDecimal refundableDeposit;

    @PositiveOrZero
    private Integer flatsPlanned;

    /** Developments: the list rate per square foot. */
    @PositiveOrZero
    private BigDecimal saleRate;

    /** The construction company (on the agreements and its seal). */
    @Column(length = 100)
    private String companyName;

    @Column(length = 200)
    private String companyAddress;

    @Column(length = 100)
    private String signerName;

    @Column(length = 60)
    private String signerDesignation;

    /** Drawn once; used on the agreements and receipts. */
    @Column(length = 20000)
    private String companySignature;

    /** Where the project's money is kept by default (its own bank account, or a common one). */
    @References(Account.class)
    private Long bankAccountId;

    /** Construction cost (work in progress), an asset until the project closes. */
    @References(Account.class)
    private Long costAccountId;

    @References(Account.class)
    private Long landAccountId;

    /** What the owner or the buyers paid, held as advances until the project closes. */
    @References(Account.class)
    private Long advancesAccountId;

    /** Late payment interest received. */
    @References(Account.class)
    private Long interestAccountId;

    /** Made when the project closes: the builder's share of the profit. */
    @References(Account.class)
    private Long profitAccountId;

    @Column(length = 1000)
    private String notes;

    /** The journal entry that closed the books (advances and costs settled, the profit shared); undone on re-opening. */
    @References(JournalEntry.class)
    private Long closingEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
