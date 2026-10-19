package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.domain.type.InterestCollection;
import com.aditya.personalbudget.domain.type.InterestType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Money lent / paid on behalf of others, its repayments, lifecycle and interest forecast.
 */
public final class ClaimDtos {

    private ClaimDtos() {
    }

    /** Lend money or pay for someone: posted as Dr receivable, Cr the paying account. */
    public record ClaimRequest(
            @NotNull ClaimKind kind,
            @NotBlank @Size(max = 100) String party,
            @Size(max = 255) String narration,
            @NotNull @Positive BigDecimal amount,
            @NotNull LocalDate startDate,
            LocalDate dueDate,
            @PositiveOrZero @DecimalMax("60") BigDecimal interestRate,
            /* SIMPLE when empty */
            InterestType interestType,
            /* where the money went from / came into; not used for a bill to pay later */
            Long paidFromAccountId,
            Long receivableAccountId,
            @Size(max = 60) String reference,
            @Size(max = 500) String notes,
            /* a bill to pay later: its expense category */
            Long categoryId,
            /* the version the form was loaded with; a stale edit is refused */
            Long version,
            /* book each month's interest as it is earned / owed */
            Boolean postInterestMonthly,
            /* where monthly interest is posted (default: the Receivables / Payables account the item sits in) */
            Long interestAccountId,
            /* when interest is expected to be paid: MONTHLY (default), YEARLY or ON_PAYMENT */
            InterestCollection interestCollection) {

        public ClaimRequest(ClaimKind kind, String party, String narration, BigDecimal amount, LocalDate startDate,
                            LocalDate dueDate, BigDecimal interestRate, InterestType interestType, Long paidFromAccountId,
                            Long receivableAccountId, String reference, String notes, Long categoryId, Long version,
                            Boolean postInterestMonthly, Long interestAccountId) {
            this(kind, party, narration, amount, startDate, dueDate, interestRate, interestType, paidFromAccountId,
                    receivableAccountId, reference, notes, categoryId, version, postInterestMonthly, interestAccountId, null);
        }
    }

    /** Money received back. {@code principal} reduces the claim, {@code interest} goes to interest income. */
    public record RepaymentRequest(
            @NotNull LocalDate paidDate,
            @NotNull @PositiveOrZero BigDecimal principal,
            @PositiveOrZero BigDecimal interest,
            @NotNull Long accountId,
            @Size(max = 255) String notes) {
    }

    /** Forgive what is still owed: Dr expense account, Cr receivable. */
    /** Forgive what is still owed: booked to an expense category (owed to you) or an income category (you owe). */
    public record WriteOffRequest(
            @NotNull LocalDate paidDate,
            @NotNull Long categoryId,
            @Size(max = 255) String notes) {
    }

    public record RepaymentView(Long id, LocalDate paidDate, BigDecimal principal, BigDecimal interest,
                                BigDecimal total, Long accountId, String accountName, boolean writeOff,
                                Long journalEntryId, String entryNo, BigDecimal outstandingAfter, String notes,
                                /* settled the item (or the principal) in full */
                                boolean finalPayment) {
    }

    /** A step in the claim's life, oldest first (CREATED, REPAID, WRITTEN_OFF, SETTLED, DUE, OVERDUE). */
    public record TimelineEvent(String type, LocalDate date, String title, String detail, BigDecimal amount,
                                Long journalEntryId) {
    }

    /**
     * One month of the interest schedule (from the start date's day to the same day next month), with
     * simple and compound interest side by side. status: EARNED, ACCRUING (the running month) or PROJECTED.
     */
    public record InterestPeriod(int period, LocalDate from, LocalDate to, BigDecimal openingPrincipal,
                                 BigDecimal principalRepaid, BigDecimal interestPaid, BigDecimal closingPrincipal,
                                 BigDecimal simpleInterest, BigDecimal compoundInterest,
                                 BigDecimal cumulativeSimple, BigDecimal cumulativeCompound,
                                 BigDecimal compoundExtra, String status,
                                 /* interest booked for this month (null when not posted) and its entry */
                                 BigDecimal posted, Long postedEntryId) {
    }

    public record ClaimView(
            Long id, ClaimKind kind, String kindLabel, String party, String narration,
            BigDecimal amount, LocalDate startDate, LocalDate dueDate, BigDecimal interestRate,
            InterestType interestType, String interestTypeLabel,
            Long receivableAccountId, String receivableAccount, Long paidFromAccountId, String paidFromAccount,
            String paidFromType, Long journalEntryId, String entryNo, String reference,
            ClaimStatus status, String statusLabel, boolean overdue, long daysOutstanding, Long daysToDue,
            BigDecimal repaid, BigDecimal writtenOff, BigDecimal outstanding, BigDecimal repaidPercent,
            BigDecimal interestReceived, BigDecimal accruedInterest, BigDecimal interestDue,
            BigDecimal monthlyInterest, BigDecimal projectedInterestAtDue, BigDecimal settlementAmount,
            LocalDate lastPaymentDate, String notes,
            BigDecimal simpleInterestToDate, BigDecimal compoundInterestToDate, BigDecimal payableAtDue,
            List<RepaymentView> repayments, List<TimelineEvent> timeline, List<InterestPeriod> schedule,
            Long categoryId, Long version,
            // ---- interest posted month by month
            boolean postInterestMonthly, String dayCount, BigDecimal interestPosted, BigDecimal interestPostedUnpaid,
            int monthsToPost, BigDecimal interestToPost, List<PostingView> postings,
            Long interestAccountId, String interestAccountName,
            /* photos / PDFs on the original entry */
            int attachmentCount,
            // ---- when interest is collected, what is due by that plan now, and the next collection
            InterestCollection interestCollection, String interestCollectionLabel, BigDecimal interestDueNow,
            LocalDate nextInterestDate, BigDecimal nextInterestAmount,
            /* statement links that still work */
            int activeShares) {
    }

    public record PostingView(Long id, int periodNo, LocalDate from, LocalDate to, BigDecimal amount,
                              Long journalEntryId, String entryNo, boolean automatic, Long accountId, String accountName,
                              /* received / paid on the spot (posted to a bank, cash, wallet or card) */
                              boolean settled,
                              /* first month it covers: a year (or several months) can be booked as one entry */
                              int firstPeriod) {
    }

    /** Post finished months of interest: all of them, or up to (and including) one month; to an account. */
    public record PostInterestRequest(Integer upToPeriod, Long accountId, Boolean makeDefault,
                                      /* book all the months as one entry (e.g. a year's interest) */
                                      Boolean combine) {
    }

    /** When interest is collected and whether it is booked automatically as each period ends. */
    public record InterestPlanRequest(@NotNull InterestCollection collection, Boolean autoPost) {
    }

    /** The account interest is posted to by default. */
    public record InterestAccountRequest(Long accountId) {
    }

    /** Totals across claims for the "to collect" summary. */
    public record ClaimSummary(BigDecimal outstanding, BigDecimal lentOutstanding, BigDecimal paidForOutstanding,
                               BigDecimal interestDue, BigDecimal overdueAmount, int openCount, int overdueCount,
                               BigDecimal collectedThisMonth) {
    }
}
