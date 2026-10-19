package com.aditya.personalbudget.web;

import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ManualJournalRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.TransactionService;
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

/**
 * Journal register, quick transactions and manual journal vouchers.
 */
@RestController
@RequestMapping("/api/transactions")
public class TransactionController {

    private final TransactionService transactions;

    public TransactionController(TransactionService transactions) {
        this.transactions = transactions;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public List<EntryView> search(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) VoucherType voucherType,
            @RequestParam(required = false) Long accountId,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "500") int limit) {
        return transactions.search(from, to, voucherType, accountId, q, limit);
    }

    @GetMapping("/{id}")
    @RequiresPermission(Permission.VIEW)
    public EntryView get(@PathVariable Long id) {
        return transactions.get(id);
    }

    @PostMapping("/quick")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView postQuick(@Valid @RequestBody QuickTransactionRequest request) {
        return transactions.postQuick(request);
    }

    @PostMapping("/journal")
    @RequiresPermission(Permission.MANAGE_JOURNALS)
    public EntryView createJournal(@Valid @RequestBody ManualJournalRequest request) {
        return transactions.createJournal(request);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_JOURNALS)
    public EntryView update(@PathVariable Long id, @Valid @RequestBody ManualJournalRequest request) {
        return transactions.updateEntry(id, request);
    }

    @PostMapping("/{id}/reverse")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public EntryView reverse(@PathVariable Long id,
                             @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return transactions.reverse(id, date);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_JOURNALS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        transactions.deleteEntry(id);
        return ResponseEntity.noContent().build();
    }
}
