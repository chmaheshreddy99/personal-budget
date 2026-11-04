package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetLine;
import com.aditya.personalbudget.dto.ReportDtos.MonthPoint;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Dashboard and forecast responses.
 */
public final class InsightDtos {

    private InsightDtos() {
    }

    // ------------------------------------------------------------------ dashboard

    public record Kpis(
            BigDecimal netWorth,
            BigDecimal netWorthChange,
            BigDecimal totalAssets,
            BigDecimal totalLiabilities,
            BigDecimal liquidBalance,
            BigDecimal monthIncome,
            BigDecimal monthExpense,
            BigDecimal monthSavings,
            BigDecimal savingsRate,
            BigDecimal expenseChangePercent,
            BigDecimal receivables,
            BigDecimal payables,
            BigDecimal chitInvested,
            BigDecimal chitAccruedInterest,
            int activeChits) {
    }

    public record UpcomingItem(LocalDate date, String kind, String title, BigDecimal amount, boolean overdue) {
    }

    public record AccountTile(Long accountId, String name, String typeLabel, String accountType, BigDecimal balance,
                              BigDecimal utilizationPercent) {
    }

    public record Dashboard(
            LocalDate asOf,
            Kpis kpis,
            List<MonthPoint> monthlyTrend,
            List<ValuePoint> netWorthTrend,
            List<ValuePoint> expenseBreakdown,
            List<ValuePoint> assetAllocation,
            List<ValuePoint> liabilityBreakdown,
            List<BudgetLine> budgets,
            List<UpcomingItem> upcoming,
            List<AccountTile> accounts,
            List<EntryView> recent) {
    }

    // ------------------------------------------------------------------ forecast

    public record ForecastMonth(
            String month,
            BigDecimal income,
            BigDecimal expenses,
            BigDecimal chitInstallments,
            BigDecimal chitPayouts,
            BigDecimal transfersOut,
            BigDecimal transfersIn,
            BigDecimal netCashFlow,
            BigDecimal liquidClosing,
            BigDecimal netWorth,
            /* the income: from recurring income items, and from the recorded income taken as the basis says */
            BigDecimal incomeRecurring,
            BigDecimal incomeRecorded,
            /* the month's expenses by category, largest first (before the what-if) */
            List<ExpenseLine> expenseLines) {
    }

    /**
     * One category's expense in a month. basis: BUDGET (that month's own budget), BUDGET_AVG (the average of the months
     * budgeted), HISTORY (the 3-month average), RECURRING (a larger recurring expense).
     */
    public record ExpenseLine(Long categoryId, String name, BigDecimal amount, String basis) {
    }

    /**
     * budgetMonths: the months with a budget for the category (their average is the amount a month when a month has
     * none of its own); historyAverage: what was spent a month over the last 3 months, for comparison.
     */
    public record CategoryForecast(Long accountId, String name, String basis, BigDecimal monthlyAmount, int budgetMonths,
                                   BigDecimal historyAverage) {
    }

    public record ForecastEvent(LocalDate date, String kind, String title, BigDecimal amount) {
    }

    public record Forecast(
            int months,
            BigDecimal incomeAdjustPercent,
            BigDecimal expenseAdjustPercent,
            BigDecimal startingLiquid,
            BigDecimal startingNetWorth,
            BigDecimal endingLiquid,
            BigDecimal endingNetWorth,
            BigDecimal averageMonthlyIncome,
            BigDecimal averageMonthlyExpense,
            String lowestLiquidMonth,
            BigDecimal lowestLiquid,
            List<ForecastMonth> rows,
            List<CategoryForecast> categories,
            List<ForecastEvent> events,
            List<String> assumptions,
            /* which recorded income is projected: REGULAR, UNMARKED (and income not marked), ALL (and one-time), NONE */
            String incomeBasis,
            /* recorded income a month (last 3 months, sources without a recurring item; not chit gains or interest) */
            BigDecimal regularIncome,
            BigDecimal unmarkedIncome,
            BigDecimal oneTimeIncome,
            /* recurring income items in a full month */
            BigDecimal recurringIncome,
            /* how expenses are projected: BUDGET (budgets only) or BUDGET_HISTORY (and the 3-month average of the rest) */
            String expenseBasis,
            /* spent a month (3-month average) in categories without a budget: left out under BUDGET */
            BigDecimal unbudgetedSpend) {
    }
}
