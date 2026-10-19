package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.domain.type.RecurringKind;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Budgets and recurring transactions.
 */
public final class PlanningDtos {

    private PlanningDtos() {
    }

    /** Add or change the budget of a category; {@code version} guards against overwriting someone else's change. */
    public record BudgetRequest(
            @NotNull Long categoryId,
            @NotNull @Positive BigDecimal monthlyLimit,
            @Min(1) @Max(100) Integer alertPercent,
            @Size(max = 255) String notes,
            Long version,
            /* yyyy-MM; this month when empty */
            String month,
            /* has to be paid without fail */
            Boolean committed,
            @Min(1) @Max(31) Integer dueDay) {
    }

    /** Copy every budget of one month into another; existing budgets of the target month are kept unless overwrite. */
    public record CopyBudgetsRequest(@NotNull String from, @NotNull String to, Boolean overwrite) {
    }

    /** severity: critical, warning, info or good. */
    public record BudgetAlert(String severity, Long categoryId, String title, String message, String hint) {
    }

    // ------------------------------------------------------------------ categories

    public record CategoryRequest(
            CategoryKind kind,
            @NotBlank @Size(max = 100) String name,
            @Size(max = 10) String code,
            @Size(max = 255) String description,
            Boolean active,
            Long version) {
    }

    /** A category with this month's, last month's and the 3-month average amount, and its budget. */
    public record CategoryView(Long id, CategoryKind kind, String code, String name, String description,
                               String systemKey, boolean system, boolean active, Long version,
                               BigDecimal thisMonth, BigDecimal lastMonth, BigDecimal averageLast3Months,
                               long entries, LocalDate lastUsed, BigDecimal budget) {
    }

    public enum BudgetHealth { OK, WARNING, OVER, UNBUDGETED }

    public record BudgetLine(
            Long budgetId,
            Long categoryId,
            String categoryCode,
            String categoryName,
            BigDecimal monthlyLimit,
            Integer alertPercent,
            BigDecimal spent,
            BigDecimal remaining,
            BigDecimal usedPercent,
            BigDecimal averageLast3Months,
            BudgetHealth health,
            String notes,
            Long version,
            // ---- committed payments
            boolean committed,
            Integer dueDay,
            LocalDate dueDate,
            /* PAID, PARTLY_PAID, DUE, DUE_SOON, OVERDUE (null for an ordinary budget) */
            String paymentStatus,
            LocalDate paidOn,
            // ---- pace (ordinary budgets)
            /* ON_TRACK, AHEAD_OF_PACE, HEADING_OVER, OVER, UNDER (month closed within the limit), NOT_STARTED */
            String pace,
            BigDecimal expectedByToday,
            BigDecimal projected,
            BigDecimal dailyAverage,
            BigDecimal safePerDay,
            LocalDate limitReachedOn,
            /* one plain sentence for the card */
            String insight) {
    }

    public record BudgetSummary(
            String month,
            BigDecimal totalLimit,
            BigDecimal totalSpent,
            BigDecimal totalRemaining,
            BigDecimal usedPercent,
            BigDecimal unbudgetedSpent,
            List<BudgetLine> lines,
            int daysInMonth,
            int daysElapsed,
            int daysLeft,
            BigDecimal projectedTotal,
            BigDecimal committedTotal,
            BigDecimal committedPaid,
            BigDecimal committedOutstanding,
            /* budgets in the month before, for "copy last month" */
            int previousMonthBudgets,
            BigDecimal previousMonthTotal,
            List<BudgetAlert> alerts) {
    }

    /**
     * Posting a recurring item debits {@code debitAccountId} and credits {@code creditAccountId}.
     * INCOME: debit = bank, credit = income account. EXPENSE: debit = expense, credit = bank / card.
     * TRANSFER: debit = destination, credit = source.
     */
    public record RecurringRequest(
            @NotBlank @Size(max = 100) String name,
            @NotNull RecurringKind kind,
            @NotNull @Positive BigDecimal amount,
            /* expense: the paying account goes in creditAccountId and the debit side is Expenses + categoryId;
               income: the receiving account goes in debitAccountId and the credit side is Income + categoryId */
            Long debitAccountId,
            Long creditAccountId,
            Long categoryId,
            @NotNull Frequency frequency,
            @NotNull LocalDate startDate,
            LocalDate endDate,
            LocalDate nextDueDate,
            Boolean active,
            @Size(max = 255) String notes,
            Long version) {
    }

    public record RecurringView(
            Long id,
            String name,
            RecurringKind kind,
            BigDecimal amount,
            Long debitAccountId,
            String debitAccountName,
            Long creditAccountId,
            String creditAccountName,
            Long categoryId,
            String categoryName,
            Frequency frequency,
            LocalDate startDate,
            LocalDate endDate,
            LocalDate nextDueDate,
            boolean active,
            boolean due,
            BigDecimal monthlyEquivalent,
            String notes,
            Long version) {
    }

    public record PostRecurringRequest(LocalDate entryDate, @Positive BigDecimal amount) {
    }
}
