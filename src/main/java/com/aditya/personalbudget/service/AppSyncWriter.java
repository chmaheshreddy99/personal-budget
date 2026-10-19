package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AppSyncKey;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.repository.AppSyncKeyRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AppSyncService.SyncExpense;
import com.aditya.personalbudget.service.AppSyncService.SyncResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/** Writes one synced expense in a transaction of its own: the expense and the record of its id, together. */
@Service
public class AppSyncWriter {

    private final AppSyncKeyRepository keys;
    private final ExpenseService expenses;
    private final PendingService pending;
    private final ActivityService activity;
    private final ChitService chits;

    public AppSyncWriter(AppSyncKeyRepository keys, ExpenseService expenses, PendingService pending, ActivityService activity, ChitService chits) {
        this.chits = chits;
        this.keys = keys;
        this.expenses = expenses;
        this.pending = pending;
        this.activity = activity;
    }

    @Transactional
    public SyncResult write(SyncExpense e) {
        Long tenant = UserContext.tenantId();
        var done = keys.findByClientId(tenant, e.clientId());
        if (done.isPresent()) {
            AppSyncKey k = done.get();
            return new SyncResult(e.clientId(), "DUPLICATE", k.getEntryId(), k.getEntryNo(), "Already synced", k.getPendingId());
        }
        ExpenseRequest req = new ExpenseRequest(e.date(), e.amount(), e.categoryId(), e.paidFromId(),
                e.narration() == null || e.narration().isBlank() ? null : e.narration().trim(), blank(e.party()), blank(e.reference()), blank(e.notes()), null);
        AppSyncKey k = new AppSyncKey();
        k.setTenantId(tenant);
        k.setClientId(e.clientId());
        k.setCreatedBy(UserContext.username());
        k.setCreatedAt(LocalDateTime.now());
        SyncResult result;
        if (UserContext.get().approval()) {
            var p = pending.submit(req);
            k.setPendingId(p.id());
            result = new SyncResult(e.clientId(), "PENDING", null, null, "Waiting for approval", p.id());
        } else {
            EntryView v = expenses.create(req);
            k.setEntryId(v.id());
            k.setEntryNo(v.entryNo());
            result = new SyncResult(e.clientId(), "CREATED", v.id(), v.entryNo(), null, null);
        }
        keys.save(k);
        activity.record("ADDED", "Expenses", "Synced from the phone app · " + ActivityService.money(e.amount())
                + (e.narration() != null ? " · " + ActivityService.cut(e.narration(), 60) : ""));
        return result;
    }

    /** A chit instalment paid on the phone; one already paid (here, or on the web) is not paid twice. */
    @Transactional
    public SyncResult writeChit(AppSyncService.SyncChitPayment c) {
        Long tenant = UserContext.tenantId();
        var me = UserContext.get();
        if (!me.features().contains(com.aditya.personalbudget.domain.type.Feature.CHITS)
                || !com.aditya.personalbudget.security.RolePolicy.allows(me.role(), com.aditya.personalbudget.security.Permission.MANAGE_CHITS)) {
            return new SyncResult(c.clientId(), "FAILED", null, null, "You may not pay chit instalments", null);
        }
        var done = keys.findByClientId(tenant, c.clientId());
        if (done.isPresent()) return new SyncResult(c.clientId(), "DUPLICATE", done.get().getEntryId(), done.get().getEntryNo(), "Already synced", null);
        var before = chits.detail(c.chitId()).installments().stream().filter(i -> i.id().equals(c.installmentId())).findFirst()
                .orElseThrow(() -> new com.aditya.personalbudget.exception.NotFoundException("Installment", c.installmentId()));
        if (before.status() == com.aditya.personalbudget.domain.type.InstallmentStatus.PAID) {
            return new SyncResult(c.clientId(), "DUPLICATE", before.journalEntryId(), null, "Instalment " + before.installmentNo() + " was already paid", null);
        }
        var after = chits.payInstallment(c.chitId(), c.installmentId(),
                new com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest(c.paidDate(), c.fromAccountId(), c.dividend()));
        var paid = after.installments().stream().filter(i -> i.id().equals(c.installmentId())).findFirst().orElseThrow();
        AppSyncKey k = new AppSyncKey();
        k.setTenantId(tenant);
        k.setClientId(c.clientId());
        k.setEntryId(paid.journalEntryId());
        k.setCreatedBy(UserContext.username());
        k.setCreatedAt(LocalDateTime.now());
        keys.save(k);
        activity.record("POSTED", "Chits", "Paid instalment " + paid.installmentNo() + " from the phone app · " + after.chit().name()
                + " · " + ActivityService.money(paid.paidAmount()));
        return new SyncResult(c.clientId(), "CREATED", paid.journalEntryId(), null, null, null);
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
