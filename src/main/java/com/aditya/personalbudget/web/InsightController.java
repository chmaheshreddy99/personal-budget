package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.InsightReportDtos.InsightReport;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.service.InsightReportService;
import com.aditya.personalbudget.dto.InsightDtos.Dashboard;
import com.aditya.personalbudget.dto.InsightDtos.Forecast;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.dto.ReportDtos.BalanceSheet;
import com.aditya.personalbudget.dto.ReportDtos.CashFlow;
import com.aditya.personalbudget.dto.ReportDtos.ExpenseAnalysis;
import com.aditya.personalbudget.dto.ReportDtos.IncomeStatement;
import com.aditya.personalbudget.dto.ReportDtos.TrialBalance;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.DashboardService;
import com.aditya.personalbudget.service.ForecastService;
import com.aditya.personalbudget.service.ReportService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Dashboard, financial statements, analytical reports and forecast. All read-only.
 */
@RestController
@RequestMapping("/api")
@RequiresPermission(Permission.VIEW)
public class InsightController {

    private final DashboardService dashboard;
    private final ReportService reports;
    private final ForecastService forecast;
    private final InsightReportService insightReports;

    public InsightController(DashboardService dashboard, ReportService reports, ForecastService forecast,
                             InsightReportService insightReports) {
        this.insightReports = insightReports;
        this.dashboard = dashboard;
        this.reports = reports;
        this.forecast = forecast;
    }

    @GetMapping("/dashboard")
    public Dashboard dashboard() {
        return dashboard.build();
    }

    @GetMapping("/reports/balance-sheet")
    public BalanceSheet balanceSheet(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate compareTo) {
        return reports.balanceSheet(asOf != null ? asOf : LocalDate.now(), compareTo);
    }

    @GetMapping("/reports/trial-balance")
    public TrialBalance trialBalance(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {
        return reports.trialBalance(asOf != null ? asOf : LocalDate.now());
    }

    @GetMapping("/reports/income-statement")
    public IncomeStatement incomeStatement(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return reports.incomeStatement(from != null ? from : end.withDayOfMonth(1), end);
    }

    @GetMapping("/reports/ledger/{accountId}")
    public AccountLedger ledger(@PathVariable Long accountId,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return reports.accountLedger(accountId, from != null ? from : end.minusMonths(3).withDayOfMonth(1), end);
    }

    @GetMapping("/reports/expense-analysis")
    public ExpenseAnalysis expenseAnalysis(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return reports.expenseAnalysis(from != null ? from : end.minusMonths(5).withDayOfMonth(1), end);
    }

    @GetMapping("/reports/cash-flow")
    public CashFlow cashFlow(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return reports.cashFlow(from != null ? from : end.minusMonths(5).withDayOfMonth(1), end);
    }

    @GetMapping("/reports/insights")
    public InsightReport insights(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        LocalDate start = from != null ? from : end.withDayOfMonth(1);
        if (start.isAfter(end)) {
            throw new BusinessException("The start date is after the end date");
        }
        return insightReports.build(start, end);
    }

    @GetMapping("/forecast")
    public Forecast forecast(@RequestParam(defaultValue = "12") int months,
                             @RequestParam(required = false) BigDecimal incomeAdjust,
                             @RequestParam(required = false) BigDecimal expenseAdjust) {
        return forecast.forecast(months, incomeAdjust, expenseAdjust);
    }
}
