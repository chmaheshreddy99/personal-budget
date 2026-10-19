package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.VoucherType;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Response shapes of the financial statements and analytical reports.
 */
public final class ReportDtos {

    private ReportDtos() {
    }

    // ------------------------------------------------------------------ common

    /** previous: the amount on the comparison date (balance sheet only, otherwise null). */
    public record AccountAmount(Long accountId, String code, String name, AccountType accountType, BigDecimal amount,
                                BigDecimal previous) {
    }

    public record MonthPoint(String month, BigDecimal income, BigDecimal expense, BigDecimal net) {
    }

    public record ValuePoint(String label, BigDecimal value) {
    }

    // ------------------------------------------------------------------ trial balance

    public record TrialBalanceRow(Long accountId, String code, String name, AccountClass accountClass,
                                  BigDecimal debit, BigDecimal credit) {
    }

    public record TrialBalance(LocalDate asOf, List<TrialBalanceRow> rows, BigDecimal totalDebit,
                               BigDecimal totalCredit, boolean balanced) {
    }

    // ------------------------------------------------------------------ income statement

    public record IncomeStatement(LocalDate from, LocalDate to, List<AccountAmount> income,
                                  List<AccountAmount> expenses, BigDecimal totalIncome, BigDecimal totalExpenses,
                                  BigDecimal netSurplus, BigDecimal savingsRate) {
    }

    // ------------------------------------------------------------------ balance sheet

    public record SheetGroup(String label, BigDecimal total, BigDecimal previous, List<AccountAmount> accounts) {
    }

    public record SheetSection(String label, BigDecimal total, BigDecimal previous, List<SheetGroup> groups) {
    }

    /**
     * Balance sheet on {@code asOf}, every figure also given on {@code compareDate}, plus health ratios
     * and the mix of assets and liabilities by bucket (liquid, investments, physical ...).
     */
    public record BalanceSheet(LocalDate asOf, LocalDate compareDate,
                               SheetSection assets, SheetSection liabilities, SheetSection equity,
                               BigDecimal netWorth, BigDecimal previousNetWorth, BigDecimal netWorthChange,
                               BigDecimal netWorthChangePercent, BigDecimal liabilitiesAndEquity, boolean balanced,
                               BigDecimal liquidAssets, BigDecimal debtToAssetRatio, BigDecimal debtToNetWorthRatio,
                               BigDecimal liquidityRatio, BigDecimal emergencyFundMonths,
                               BigDecimal averageMonthlyExpense, BigDecimal investmentShare,
                               BigDecimal shortTermLiabilities, BigDecimal longTermLiabilities,
                               List<ValuePoint> assetMix, List<ValuePoint> liabilityMix,
                               List<ValuePoint> netWorthTrend) {
    }

    // ------------------------------------------------------------------ ledger

    public record LedgerRow(Long entryId, String entryNo, LocalDate date, VoucherType voucherType, String voucherLabel, String narration,
                            String counterAccounts, BigDecimal debit, BigDecimal credit, BigDecimal balance) {
    }

    public record AccountLedger(Long accountId, String code, String name, AccountClass accountClass,
                                LocalDate from, LocalDate to, BigDecimal openingBalance, BigDecimal totalDebit,
                                BigDecimal totalCredit, BigDecimal closingBalance, List<LedgerRow> rows) {
    }

    // ------------------------------------------------------------------ expense analysis

    public record CategoryShare(Long accountId, String name, BigDecimal amount, BigDecimal percent,
                                BigDecimal monthlyAverage, List<BigDecimal> byMonth) {
    }

    public record ExpenseAnalysis(LocalDate from, LocalDate to, List<String> months, BigDecimal total,
                                  BigDecimal monthlyAverage, List<CategoryShare> categories,
                                  List<ValuePoint> topTransactions) {
    }

    // ------------------------------------------------------------------ cash flow

    public record CashFlowMonth(String month, BigDecimal opening, BigDecimal inflow, BigDecimal outflow,
                                BigDecimal net, BigDecimal closing) {
    }

    public record CashFlow(LocalDate from, LocalDate to, List<CashFlowMonth> months, BigDecimal totalInflow,
                           BigDecimal totalOutflow) {
    }
}
