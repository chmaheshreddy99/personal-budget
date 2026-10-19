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
            Long version) {
    }

    /**
     * The journal is always dated on the installment's due date, so the books and the interest schedule
     * follow the chit's calendar. {@code paidDate} is the day the money actually left (due date when empty).
     */
    public record PayInstallmentRequest(
            LocalDate paidDate,
            @NotNull Long fromAccountId,
            @PositiveOrZero BigDecimal dividend) {
    }

    public record PayoutRequest(
            @NotNull LocalDate payoutDate,
            @NotNull @Positive BigDecimal amount,
            @NotNull Long depositAccountId) {
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
            String notes,
            String organizerUpi,
            String upiNote,
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
            boolean closable) {
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

    public record ChitDetail(ChitView chit, List<InstallmentView> installments, List<InterestRow> interestSchedule) {
    }
}
