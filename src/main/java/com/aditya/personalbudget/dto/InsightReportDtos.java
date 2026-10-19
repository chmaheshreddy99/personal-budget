package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.dto.ReportDtos.MonthPoint;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * The Insights report: one period compared with the period of the same length just before it,
 * looked at by category, account, chit and payee, with plain-language highlights.
 */
public final class InsightReportDtos {

    private InsightReportDtos() {
    }

    public record Period(LocalDate from, LocalDate to, LocalDate previousFrom, LocalDate previousTo, int days) {
    }

    public record Summary(BigDecimal income, BigDecimal expense, BigDecimal net, BigDecimal savingsRate,
                          BigDecimal previousIncome, BigDecimal previousExpense, BigDecimal previousNet,
                          BigDecimal incomeChangePercent, BigDecimal expenseChangePercent,
                          BigDecimal averageDailySpend, BigDecimal netWorth, BigDecimal netWorthChange,
                          long entries, BigDecimal fixedShare) {
    }

    /** previous: same category in the previous period; budget: monthly limit scaled to the period. */
    public record CategoryInsight(Long categoryId, String code, String name, BigDecimal amount, BigDecimal previous,
                                  BigDecimal change, BigDecimal changePercent, BigDecimal share, int entries,
                                  BigDecimal averagePerEntry, BigDecimal largest, BigDecimal budget,
                                  BigDecimal budgetUsedPercent, List<BigDecimal> byMonth) {
    }

    public record AccountInsight(Long accountId, String code, String name, String accountType, String typeLabel,
                                 String accountClass, String bucket, BigDecimal opening, BigDecimal inflow,
                                 BigDecimal outflow, BigDecimal closing, BigDecimal change, BigDecimal changePercent,
                                 int entries, LocalDate lastActivity, Long daysIdle, BigDecimal utilization) {
    }

    public record ChitInsight(Long chitId, String name, String organizer, ChitStatus status,
                              BigDecimal paidInPeriod, BigDecimal dividendsInPeriod, BigDecimal paidIn,
                              BigDecimal stillToPay, BigDecimal currentValue, BigDecimal interestEarned,
                              BigDecimal projectedNetGain, BigDecimal annualRate, BigDecimal progressPercent,
                              int overdueCount, LocalDate nextDueDate, BigDecimal nextDueAmount,
                              LocalDate maturityDate) {
    }

    public record ChitTotals(int active, BigDecimal paidInPeriod, BigDecimal dividendsInPeriod, BigDecimal paidIn,
                             BigDecimal stillToPay, BigDecimal currentValue, BigDecimal interestEarned,
                             BigDecimal projectedNetGain, BigDecimal averageRate) {
    }

    /** tone: good, warn or info. */
    public record Highlight(String tone, String area, String title, String detail) {
    }

    public record InsightReport(Period period, Summary summary, List<MonthPoint> monthly,
                                List<CategoryInsight> expenseCategories, List<CategoryInsight> incomeCategories,
                                List<AccountInsight> accounts, List<ChitInsight> chits, ChitTotals chitTotals,
                                List<ValuePoint> topPayees, List<ValuePoint> weekdaySpend,
                                List<ValuePoint> largestExpenses, List<Highlight> highlights) {
    }
}
