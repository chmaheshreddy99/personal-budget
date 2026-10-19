package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One month of a {@link HostedChit}: its winner and, once paid, the payout. A month whose payout is done is
 * locked (its winner and payments stay as they are until the payout is undone).
 * Table file: {@code data/hosted_chit_months.tbl}
 */
@Entity
@Table(name = "hosted_chit_months", uniqueConstraints = @UniqueConstraint(columnNames = {"chitId", "monthNo"}))
@Getter
@Setter
@NoArgsConstructor
public class HostedChitMonth implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(HostedChit.class)
    @Column(nullable = false)
    private Long chitId;

    @Positive
    @Column(nullable = false)
    private Integer monthNo;

    @References(HostedChitMember.class)
    private Long winnerMemberId;

    /** "Picked", "Random draw" or "Auction". */
    @Column(length = 20)
    private String drawMethod;

    /** Auction chits: the winning bid, i.e. the discount the winner gives up. */
    @PositiveOrZero
    private BigDecimal bidAmount;

    /** Paid to the winner (chit value - commission) once the payout is done. */
    @PositiveOrZero
    private BigDecimal payoutAmount;

    /** The organiser's commission of the month: chit value − payout. Planned chits: negative when the payout is more than is collected. */
    private BigDecimal commissionAmount;

    /** Planned chits: what each member pays this month (the chit table, editable until payments are recorded). */
    @PositiveOrZero
    private BigDecimal plannedInstallment;

    /** Planned chits: what this month's winner gets (the chit table, editable until the month is paid out). */
    @PositiveOrZero
    private BigDecimal plannedPayout;

    private LocalDate payoutDate;

    /**
     * When the payout was recorded: the members' payments of the month recorded until then are what it paid out, so
     * they are locked (late payments recorded afterwards stay editable).
     */
    private java.time.LocalDateTime payoutRecordedAt;

    /**
     * The commission stayed in the commission account because members paid into it: no money moved, the journal only
     * marks that much of it as the organiser's own (see {@code HostedChitService#commissionTransferDraft}).
     */
    private Boolean commissionRetained;

    /**
     * The commission was left in the collections account at the payout, to be moved by the organiser afterwards
     * (the commission step of the payout). Cleared once it is moved.
     */
    private Boolean commissionDeferred;

    /** The commission moved on to the organiser's bank account: that {@link HostedChitTransfer} (kept by id only). */
    private Long commissionBankTransferId;

    /** Cash, UPI or Bank. */
    @Column(length = 10)
    private String payoutMode;

    /** UPI reference, cheque or bank transfer number of the payout. */
    @Column(length = 60)
    private String payoutReference;

    /** Where the winner received it: their bank account or UPI ID. The accounts it was paid from are its legs. */
    @Column(length = 120)
    private String payoutTo;

    /** The account the commission was moved out of into the commission account (empty: the collections account). */
    @References(Account.class)
    private Long commissionFromAccountId;

    @References(JournalEntry.class)
    private Long payoutEntryId;

    @References(JournalEntry.class)
    private Long commissionEntryId;

    /** When the commission has its own account: the transfer moving it there out of the collections. */
    @References(JournalEntry.class)
    private Long commissionTransferEntryId;

    @Version
    private Long version;
}
