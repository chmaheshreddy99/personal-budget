package com.aditya.personalbudget.web;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetSummary;
import com.aditya.personalbudget.dto.PlanningDtos.PostRecurringRequest;
import com.aditya.personalbudget.dto.PlanningDtos.RecurringRequest;
import com.aditya.personalbudget.dto.PlanningDtos.RecurringView;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.BudgetService;
import com.aditya.personalbudget.service.RecurringService;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * Budgets ({@code /api/budgets}) and recurring transactions ({@code /api/recurring}).
 */
@RestController
@RequestMapping("/api")
public class PlanningController {

    private final BudgetService budgets;
    private final RecurringService recurring;

    public PlanningController(BudgetService budgets, RecurringService recurring) {
        this.budgets = budgets;
        this.recurring = recurring;
    }

    // ------------------------------------------------------------------ budgets

    @GetMapping("/budgets")
    @RequiresPermission(Permission.VIEW)
    public BudgetSummary budgets(@RequestParam(required = false) String month) {
        return budgets.summary(month == null || month.isBlank() ? YearMonth.now() : YearMonth.parse(month));
    }

    /** Chit installments paid between two dates, as the Chit Payments budget counts them. */
    @GetMapping("/budgets/chit-payments")
    @RequiresPermission(Permission.VIEW)
    public List<BudgetService.ChitPaymentRow> chitPayments(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                           @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return budgets.chitPayments(from, to);
    }

    @PostMapping("/budgets")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public Budget saveBudget(@Valid @RequestBody BudgetRequest request) {
        return budgets.save(request);
    }

    /** Carries one month's budgets into another (e.g. last month into this month). */
    @PostMapping("/budgets/copy")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public BudgetSummary copyBudgets(@Valid @RequestBody com.aditya.personalbudget.dto.PlanningDtos.CopyBudgetsRequest request) {
        budgets.copy(request.from(), request.to(), Boolean.TRUE.equals(request.overwrite()));
        return budgets.summary(YearMonth.parse(request.to()));
    }

    @DeleteMapping("/budgets/{id}")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public ResponseEntity<Void> deleteBudget(@PathVariable Long id) {
        budgets.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------------------ recurring transactions

    @GetMapping("/recurring")
    @RequiresPermission(Permission.VIEW)
    public List<RecurringView> recurring() {
        return recurring.list();
    }

    @PostMapping("/recurring")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public RecurringTransaction createRecurring(@Valid @RequestBody RecurringRequest request) {
        return recurring.create(request);
    }

    @PutMapping("/recurring/{id}")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public RecurringTransaction updateRecurring(@PathVariable Long id, @Valid @RequestBody RecurringRequest request) {
        return recurring.update(id, request);
    }

    @DeleteMapping("/recurring/{id}")
    @RequiresPermission(Permission.MANAGE_BUDGETS)
    public ResponseEntity<Void> deleteRecurring(@PathVariable Long id) {
        recurring.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/recurring/{id}/post")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView postRecurring(@PathVariable Long id, @RequestBody(required = false) PostRecurringRequest request) {
        return recurring.post(id, request);
    }

    @PostMapping("/recurring/{id}/skip")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public RecurringTransaction skipRecurring(@PathVariable Long id) {
        return recurring.skip(id);
    }
}
