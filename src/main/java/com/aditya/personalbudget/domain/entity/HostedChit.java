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
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A chit the user runs as the organiser (foreman): every month each member pays the installment and one member
 * (who has not won before) takes the pot. The pot grows by {@code monthlyIncrement} each month and the organiser
 * keeps {@code commission} from it:
 * <pre>
 *   chit value(m) = baseValue + (m - 1) * monthlyIncrement
 *   payout(m)     = chit value(m) - commission
 *   member due(m) = installment, plus the winner extra in every month after the member won
 * </pre>
 * An {@code AUCTION} chit keeps the chit value fixed; each month the members who have not won bid the discount
 * they will give up (between the commission and {@code maxBidPercent} of the chit value). The highest bidder
 * takes chit value - bid, the organiser keeps the commission and the rest of the bid is the dividend, shared
 * equally, so everyone pays installment - dividend that month.
 * <p>
 * Unlike {@link Chit} (a chit the user is a member of), the money collected is not the user's: when
 * {@code postToBooks} is on it is held in the "Hosted Chit Funds" liability until it is paid out, and only the
 * commission is income. Table file: {@code data/hosted_chits.tbl}
 */
@Entity
@Table(name = "hosted_chits")
@Getter
@Setter
@NoArgsConstructor
public class HostedChit implements TenantOwned {

    public static final String ACTIVE = "ACTIVE";
    public static final String COMPLETED = "COMPLETED";
    /**
     * Closed by the organiser once every month is paid out: the chit's books are final, nothing in it changes
     * (payments, payouts, winners, settings, transfers) until it is re-opened.
     */
    public static final String CLOSED = "CLOSED";
    /** The chit value grows by a fixed step each month and the winner is picked (or drawn). */
    public static final String TYPE_FIXED = "FIXED";
    /** Auction (bidding) chit, Margadarsi style: members bid a discount, the discount less commission is shared. */
    public static final String TYPE_AUCTION = "AUCTION";
    /**
     * Planned chit: the organiser sets, month by month, what the winner gets (and what members pay, the same every
     * month unless edited or set to rise). The commission is what is collected less the payout; in later months it can
     * be negative, paid out of the commission kept from earlier months.
     */
    public static final String TYPE_PLANNED = "PLANNED";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 100)
    private String name;

    /** FIXED or AUCTION; missing (older chits) means FIXED. */
    @Column(length = 10)
    private String chitType;

    /** Auction chits: the highest discount a member may bid, as a percent of the chit value. */
    @PositiveOrZero
    private BigDecimal maxBidPercent;

    /** First day of the month the chit starts (month 1). */
    @Column(nullable = false)
    private LocalDate startMonth;

    /** Day of the month installments are due (1-28). */
    @Positive
    @Column(nullable = false)
    private Integer dueDay;

    @Positive
    @Column(nullable = false)
    private Integer memberCount;

    @Positive
    @Column(nullable = false)
    private Integer months;

    @Positive
    @Column(nullable = false)
    private BigDecimal installment;

    @Positive
    @Column(nullable = false)
    private BigDecimal baseValue;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal monthlyIncrement;

    @PositiveOrZero
    @Column(nullable = false)
    private BigDecimal commission;

    /** Planned chits: how much the monthly installment rises each month when the table was made (0: the same). */
    @PositiveOrZero
    private BigDecimal installmentIncrement;

    /**
     * What a member pays on top of the installment in every month after the month they won: NONE, PERCENT (of the
     * chit value, the whole amount) or FIXED (rupees). Missing (older chits) means NONE.
     */
    @Column(length = 10)
    private String winnerExtraType;

    /** The percent or the rupee amount, per {@link #winnerExtraType}. */
    @PositiveOrZero
    private BigDecimal winnerExtraValue;

    /** Interest on a late installment, % a month (simple, by the day), on what is still unpaid. Empty: none. */
    @PositiveOrZero
    private BigDecimal lateFeePercent;

    /** Days after the due date before late interest starts. */
    @PositiveOrZero
    private Integer lateGraceDays;

    /** The organiser's UPI ID, for payment links and QR codes sent to members. */
    @Column(length = 60)
    private String upiId;

    /** Up to 4 letters or digits naming the chit in payment notes (AC5L in AC5L-M03); empty: made from the name. */
    @Column(length = 4)
    private String shortCode;

    /** The account members pay into by default: its UPI ID, or its bank details, go on their payment links. */
    @References(Account.class)
    private Long payToAccountId;

    /** The name members see when they pay by UPI. */
    @Column(length = 100)
    private String payeeName;

    /** The organiser's drawn signature for receipts: an SVG path in a 1000 x 300 box. */
    @Column(length = 20000)
    private String receiptSignature;

    /** The name printed under that signature. */
    @Column(length = 100)
    private String receiptSigner;

    /** Post collections, payouts and commission to the books (journal, income, balance sheet). */
    private Boolean postToBooks;

    /** The cash / bank account collections go into and payouts come from (when posting). */
    @References(Account.class)
    private Long accountId;

    /** Where the organiser's commission is moved to (when posting); empty means it stays in {@link #accountId}. */
    @References(Account.class)
    private Long commissionAccountId;

    /**
     * One of the organiser's own bank accounts the commission goes on to, out of the chit's commission account (after
     * each payout, when the organiser moves it). Empty: it stays in the commission account.
     */
    @References(Account.class)
    private Long commissionBankAccountId;

    /** The income category the commission is booked under (one of the existing categories). */
    @References(Category.class)
    private Long commissionCategoryId;

    /** Where late payment interest is kept (when posting); empty means the commission (or collection) account. */
    @References(Account.class)
    private Long lateFeeAccountId;

    /** ACTIVE, COMPLETED or CLOSED. */
    @Column(nullable = false, length = 10)
    private String status;

    /** When the chit was closed, and by whom (empty while it is open). */
    private LocalDateTime closedAt;

    @Column(length = 100)
    private String closedBy;

    /** Why it was closed, or what was settled (shown on the closed chit). */
    @Column(length = 255)
    private String closeNote;

    /** Sample data, removable with "Clear demo data". */
    private Boolean demo;

    @Column(length = 255)
    private String notes;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
