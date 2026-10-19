package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ExpenseFormService;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.PendingService;
import com.aditya.personalbudget.service.ExpenseService.ExpenseRow;
import com.aditya.personalbudget.service.PulseService;
import com.aditya.personalbudget.service.PulseService.Pulse;
import com.aditya.personalbudget.service.SuggestionService;
import com.aditya.personalbudget.service.SuggestionService.Suggestion;
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
import java.util.List;
import java.util.Map;

/**
 * Expense register and expense posting ({@code /api/expenses}), autocomplete history
 * ({@code /api/suggestions}) and the footer figures ({@code /api/pulse}).
 */
@RestController
@RequestMapping("/api")
@RequiresPermission(Permission.VIEW)
public class ExpenseController {

    private final ExpenseService expenses;
    private final SuggestionService suggestions;
    private final PulseService pulse;

    private final PendingService pending;
    private final com.aditya.personalbudget.service.DuplicateGuard duplicates;
    private final ExpenseFormService form;

    public ExpenseController(ExpenseService expenses, SuggestionService suggestions, PulseService pulse,
                             PendingService pending, ExpenseFormService form, com.aditya.personalbudget.service.DuplicateGuard duplicates) {
        this.duplicates = duplicates;
        this.pending = pending;
        this.form = form;
        this.expenses = expenses;
        this.suggestions = suggestions;
        this.pulse = pulse;
    }

    @GetMapping("/expenses")
    public List<ExpenseRow> expenses(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        LocalDate end = to != null ? to : LocalDate.now();
        return expenses.list(from != null ? from : end.withDayOfMonth(1), end);
    }

    /**
     * Posts an expense. Recorded through an access link with maker-checker, it is kept for approval instead
     * (202 Accepted with the waiting entry).
     */
    @PostMapping("/expenses")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<?> create(@Valid @RequestBody ExpenseRequest request) {
        var me = UserContext.get();
        // the same expense from the same person a moment ago (a double tap, two tabs) is not recorded twice
        String fingerprint = String.join("|", "expense", String.valueOf(me.tenantId()),
                me.viaLink() ? "link" + me.linkId() : "user" + me.userId(), String.valueOf(request.entryDate()),
                request.amount().stripTrailingZeros().toPlainString(), String.valueOf(request.categoryId()),
                String.valueOf(request.paidFromId()), clean(request.narration()), clean(request.party()));
        return duplicates.once(fingerprint, me.approval()
                        ? "This expense was already sent for approval a moment ago. If it is really a second one, wait a few seconds or change the description"
                        : "This expense was already recorded a moment ago. If it is really a second one, wait a few seconds or change the description",
                () -> me.approval() ? ResponseEntity.accepted().body(pending.submit(request))
                        : ResponseEntity.ok(expenses.create(request)));
    }

    private static String clean(String text) {
        return text == null ? "" : text.trim().toLowerCase(java.util.Locale.ROOT);
    }

    /** Categories, paying accounts and past descriptions for the quick add form (no balances). */
    @GetMapping("/expenses/form-options")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ExpenseFormService.FormOptions formOptions() {
        return form.options();
    }

    @PutMapping("/expenses/{entryId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView update(@PathVariable Long entryId, @Valid @RequestBody ExpenseRequest request) {
        return expenses.update(entryId, request);
    }

    @DeleteMapping("/expenses/{entryId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> delete(@PathVariable Long entryId) {
        expenses.delete(entryId);
        return ResponseEntity.noContent().build();
    }

    /** Money back on an expense, in part or in full. */
    @PostMapping("/expenses/{entryId}/refunds")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView refund(@PathVariable Long entryId, @Valid @RequestBody ExpenseService.RefundRequest request) {
        return expenses.refund(entryId, request);
    }

    /** Reverses an expense recorded by mistake. */
    @PostMapping("/expenses/{entryId}/reverse")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView reverse(@PathVariable Long entryId, @RequestBody(required = false) ExpenseService.ReverseRequest request) {
        return expenses.reverse(entryId, request);
    }

    /** Undoes a refund or a reversal. */
    @DeleteMapping("/expenses/{entryId}/refunds/{refundEntryId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> undoRefund(@PathVariable Long entryId, @PathVariable Long refundEntryId) {
        expenses.undoRefund(entryId, refundEntryId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/suggestions")
    public Map<String, List<Suggestion>> suggestions() {
        return suggestions.all();
    }

    @GetMapping("/pulse")
    public Pulse pulse() {
        return pulse.pulse();
    }
}
