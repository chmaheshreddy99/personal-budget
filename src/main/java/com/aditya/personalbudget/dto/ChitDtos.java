package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public final class ChitDtos {

    private ChitDtos() {
    }

    /**
     * Create / update a chit. When the end date is empty it is start date + (installments - 1) months.
     * When the interest rate is empty the rate implied by installments and maturity amount is used.
     */
    public record ChitRequest(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 100) String organizer,
            @Size(max = 40) String ticketNo,
            @NotNull @Positive BigDecimal maturityAmount,
            @NotNull @Positive BigDecimal monthlyInstallment,
            @NotNull @Min(2) @Max(600) Integer numberOfInstallments,
            @NotNull LocalDate startDate,
            LocalDate endDate,
            @PositiveOrZero @DecimalMax("60") BigDecimal interestRate,
            @PositiveOrZero @DecimalMax("20") BigDecimal commissionPercent,
            @Size(max = 255) String notes,
            @Size(max = 60) @Pattern(regexp = "^$|^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$", message = "must be a UPI ID like name@bank") String organizerUpi,
            @Size(max = 40) String upiNote,
            Long defaultPaymentAccountId,
            /* Installments already paid before you started tracking (posted against opening equity). */
            @PositiveOrZero Integer alreadyPaidInstallments,
            /* the version the form was loaded with; a stale edit is refused */
            Long version,
            @Size(max = 20) String organizerPhone,
            /* a copy of each installment paid goes here (empty clears it, null keeps it) */
            @Size(max = 120) @Pattern(regexp = "^$|^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", message = "must be an e-mail address") String organizerEmail) {

        /** Without the organizer's e-mail (callers that do not know it). */
        public ChitRequest(String name, String organizer, String ticketNo, BigDecimal maturityAmount, BigDecimal monthlyInstallment,
                           Integer numberOfInstallments, LocalDate startDate, LocalDate endDate, BigDecimal interestRate,
                           BigDecimal commissionPercent, String notes, String organizerUpi, String upiNote, Long defaultPaymentAccountId,
                           Integer alreadyPaidInstallments, Long version, String organizerPhone) {
            this(name, organizer, ticketNo, maturityAmount, monthlyInstallment, numberOfInstallments, startDate, endDate, interestRate,
                    commissionPercent, notes, organizerUpi, upiNote, defaultPaymentAccountId, alreadyPaidInstallments, version, organizerPhone, null);
        }

        /** Without the organizer's mobile number (callers that do not know it). */
        public ChitRequest(String name, String organizer, String ticketNo, BigDecimal maturityAmount, BigDecimal monthlyInstallment,
                           Integer numberOfInstallments, LocalDate startDate, LocalDate endDate, BigDecimal interestRate,
                           BigDecimal commissionPercent, String notes, String organizerUpi, String upiNote, Long defaultPaymentAccountId,
                           Integer alreadyPaidInstallments, Long version) {
            this(name, organizer, ticketNo, maturityAmount, monthlyInstallment, numberOfInstallments, startDate, endDate, interestRate,
                    commissionPercent, notes, organizerUpi, upiNote, defaultPaymentAccountId, alreadyPaidInstallments, version, null, null);
        }
    }

    /**
     * The journal is always dated on the installment's due date, so the books and the interest schedule
     * follow the chit's calendar. {@code paidDate} is the day the money actually left (due date when empty).
     */
    public record PayInstallmentRequest(
            LocalDate paidDate,
            @NotNull Long fromAccountId,
            @PositiveOrZero BigDecimal dividend,
            /* the bank's reference for the payment (UTR, cheque no.): kept on the entry, shown to the organizer */
            @Size(max = 60) String reference) {

        public PayInstallmentRequest(LocalDate paidDate, Long fromAccountId, BigDecimal dividend) {
            this(paidDate, fromAccountId, dividend, null);
        }
    }

    /**
     * The payout: {@code amount} is what the organizer pays in all, {@code receivedNow} what came in on
     * {@code payoutDate} (the whole amount when empty). The rest is recorded later with {@link PayoutReceiptRequest}s.
     */
    public record PayoutRequest(
            @NotNull LocalDate payoutDate,
            @NotNull @Positive BigDecimal amount,
            @NotNull Long depositAccountId,
            @Positive BigDecimal receivedNow) {

        public PayoutRequest(LocalDate payoutDate, BigDecimal amount, Long depositAccountId) {
            this(payoutDate, amount, depositAccountId, null);
        }
    }

    /** A later part of a payout the organizer pays in instalments. */
    public record PayoutReceiptRequest(
            @NotNull LocalDate date,
            @NotNull @Positive BigDecimal amount,
            @NotNull Long depositAccountId,
            @Size(max = 255) String notes) {
    }

    /** One part of the payout as it came in; {@code first} is the entry that settled the chit (undoing it undoes the payout). */
    public record PayoutReceiptView(Long entryId, String entryNo, LocalDate date, BigDecimal amount, Long accountId,
                                    String accountName, String notes, boolean first, int attachmentCount) {
    }

    /** Chit with all computed figures. */
    public record ChitView(
            Long id,
            String name,
            String organizer,
            String ticketNo,
            BigDecimal maturityAmount,
            BigDecimal monthlyInstallment,
            int numberOfInstallments,
            LocalDate startDate,
            LocalDate endDate,
            LocalDate maturityDate,
            long daysToMaturity,
            BigDecimal commissionPercent,
            BigDecimal interestRate,
            ChitStatus status,
            Long accountId,
            String accountName,
            BigDecimal payoutAmount,
            LocalDate payoutDate,
            /* of the payout: received so far and still to come from the organizer (0 once in full) */
            BigDecimal payoutReceived,
            BigDecimal payoutPending,
            String notes,
            String organizerUpi,
            String upiNote,
            String organizerPhone,
            Long defaultPaymentAccountId,
            String defaultPaymentAccountName,
            // ---- progress
            int installmentsPaid,
            int installmentsPending,
            int overdueCount,
            BigDecimal overdueAmount,
            BigDecimal progressPercent,
            LocalDate nextDueDate,
            BigDecimal nextDueAmount,
            // ---- money in / still to pay
            BigDecimal totalContribution,
            BigDecimal paidIn,
            BigDecimal cashPaid,
            BigDecimal dividendsEarned,
            BigDecimal stillToPay,
            BigDecimal accountBalance,
            // ---- returns
            BigDecimal projectedInterest,
            BigDecimal projectedNetGain,
            BigDecimal impliedAnnualRate,
            BigDecimal rateUsed,
            String rateBasis,
            BigDecimal compoundInterestEarned,
            BigDecimal simpleInterestEarned,
            BigDecimal projectedCompoundInterest,
            BigDecimal projectedSimpleInterest,
            BigDecimal currentValue,
            BigDecimal realizedGain,
            Long version,
            /* the payout journal, once the chit is paid out */
            Long payoutEntryId,
            /* closed by the user (null while open), and whether it can be closed now */
            LocalDateTime closedAt,
            boolean closable,
            String organizerEmail,
            /* what a payout not received by its due date costs; empty before it is due */
            PayoutDelay payoutDelay) {
    }

    /**
     * What waiting for a payout costs: from the day it was due, simple interest (rate / 365) on what was still to come,
     * the maturity amount until a payout is recorded and what is left of it after each part. Two measures of the same
     * money, each from the user's own accounts: {@code bank} what it would have earned in the best-paying bank account,
     * {@code loan} what it would have saved against the costliest loan still owed. Either is empty when no such account
     * has a rate. {@code onTime}: paid in full by the due date, nothing lost. {@code running}: still growing, on
     * {@code outstanding}.
     */
    public record PayoutDelay(LocalDate dueDate, boolean onTime, boolean running, long daysLate, BigDecimal outstanding,
                              DelayMeasure bank, DelayMeasure loan, List<DelayPeriod> periods) {
    }

    /** One measure of the loss: the account the rate comes from, what has been lost, and what each further day costs. */
    public record DelayMeasure(Long accountId, String accountName, BigDecimal ratePercent, BigDecimal interestLost, BigDecimal perDay) {
    }

    /** A stretch at one outstanding amount; {@code received}: what came in on its last day and ended it (0 for the one still running). */
    public record DelayPeriod(LocalDate from, LocalDate to, long days, BigDecimal outstanding, BigDecimal received,
                              BigDecimal bankInterest, BigDecimal loanInterest) {
    }

    public record InstallmentView(
            Long id,
            int installmentNo,
            LocalDate dueDate,
            BigDecimal dueAmount,
            BigDecimal dividend,
            BigDecimal paidAmount,
            LocalDate paidDate,
            Long paidFromAccountId,
            String paidFromAccountName,
            Long journalEntryId,
            InstallmentStatus status,
            boolean overdue) {
    }

    /** Status of one month of the interest schedule. */
    public enum InterestStatus { EARNED, ACCRUING, PROJECTED, AFTER_PAYOUT }

    /**
     * One month of the interest schedule.
     * The installment joins the balance on {@code installmentDate}; exactly one month later
     * ({@code interestDate}) interest is computed and, for compound interest, added to the balance.
     */
    public record InterestRow(
            int period,
            LocalDate installmentDate,
            LocalDate interestDate,
            BigDecimal installment,
            boolean installmentPaid,
            BigDecimal principal,
            BigDecimal openingBalance,
            BigDecimal compoundInterest,
            BigDecimal closingBalance,
            BigDecimal cumulativeCompound,
            BigDecimal simpleInterest,
            BigDecimal cumulativeSimple,
            BigDecimal compoundAdvantage,
            InterestStatus status) {
    }

    /** {@code payoutReceipts}: the payout as it came in, oldest first (one when it was paid in one go). */
    /**
     * What lifting a chit gets and costs with its organizer: the monthly amount after lifting, the cut off the maturity
     * amount if lifted in the first month allowed and in the last (straight line between), a one-time fee, the first
     * month lifting is allowed, and the lift table: the payout by month, with what is paid after lifting in that month
     * ("month=payout" or "month=payout@installment", comma separated).
     */
    public record LiftTerms(Long chitId, BigDecimal afterLiftInstallment, BigDecimal liftDiscountFirst, BigDecimal liftDiscountLast,
                            BigDecimal liftFeePercent, Integer liftFromMonth, String liftChart) {
    }

    public record LiftTermsRequest(@PositiveOrZero BigDecimal afterLiftInstallment,
                                   @PositiveOrZero @DecimalMax("90") BigDecimal liftDiscountFirst,
                                   @PositiveOrZero @DecimalMax("90") BigDecimal liftDiscountLast,
                                   @PositiveOrZero @DecimalMax("20") BigDecimal liftFeePercent,
                                   @Min(1) @Max(600) Integer liftFromMonth,
                                   @Size(max = 6000) @Pattern(regexp = "^\\s*$|^\\s*\\d{1,3}\\s*=\\s*\\d+(\\.\\d{1,2})?(\\s*@\\s*\\d+(\\.\\d{1,2})?)?\\s*(,\\s*\\d{1,3}\\s*=\\s*\\d+(\\.\\d{1,2})?(\\s*@\\s*\\d+(\\.\\d{1,2})?)?\\s*)*,?\\s*$",
                                           message = "must be month=payout pairs (optionally @installment after lifting), like 3=82000@5000, 4=84500@5000") String liftChart) {
    }

    public record ChitDetail(ChitView chit, List<InstallmentView> installments, List<InterestRow> interestSchedule,
                             List<PayoutReceiptView> payoutReceipts) {
    }
}
