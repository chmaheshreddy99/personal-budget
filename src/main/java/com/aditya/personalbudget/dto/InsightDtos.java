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
            BigDecimal netWorth) {
    }

    public record CategoryForecast(Long accountId, String name, String basis, BigDecimal monthlyAmount) {
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
            List<String> assumptions) {
    }
}
