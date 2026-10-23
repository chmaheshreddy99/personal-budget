package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AppSyncKey;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.repository.AppSyncKeyRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AppSyncService.SyncExpense;
import com.aditya.personalbudget.service.AppSyncService.SyncResult;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InterestType;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.exception.BusinessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.function.Supplier;

/**
 * Writes one item synced from the phone in a transaction of its own: the item (an expense, a chit instalment, money
 * paid for someone or lent, money received back, income, a gift, EMIs) and the record of its id, together.
 */
@Service
public class AppSyncWriter {

    private final AppSyncKeyRepository keys;
    private final ExpenseService expenses;
    private final PendingService pending;
    private final ActivityService activity;
    private final ChitService chits;
    private final ClaimService claims;
    private final TransactionService transactions;
    private final GiftService gifts;
    private final EmiService emis;

    public AppSyncWriter(AppSyncKeyRepository keys, ExpenseService expenses, PendingService pending, ActivityService activity, ChitService chits,
                         ClaimService claims, TransactionService transactions, GiftService gifts, EmiService emis) {
        this.claims = claims;
        this.transactions = transactions;
        this.gifts = gifts;
        this.emis = emis;
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
        k.setCreatedAt(OrgClock.now());
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
        k.setCreatedAt(OrgClock.now());
        keys.save(k);
        activity.record("POSTED", "Chits", "Paid instalment " + paid.installmentNo() + " from the phone app · " + after.chit().name()
                + " · " + ActivityService.money(paid.paidAmount()));
        return new SyncResult(c.clientId(), "CREATED", paid.journalEntryId(), null, null, null);
    }

    // ================================================================== paid for, lent, income, gifts, EMIs

    /** Paid for someone or lent: owed to me, the money out of the account it was paid from. */
    @Transactional
    public SyncResult writeClaim(AppSyncService.SyncClaim c) {
        return once(c.clientId(), Feature.EXPENSES, "record money paid for someone or lent", () -> {
            ClaimKind kind = switch (c.kind()) {
                case "PAID_FOR" -> ClaimKind.PAID_FOR;
                case "LENT" -> ClaimKind.LENT;
                default -> throw new BusinessException("The phone records money paid for someone or lent, not " + c.kind());
            };
            boolean interest = kind == ClaimKind.LENT && c.interestRate() != null && c.interestRate().signum() > 0;
            ClaimView v = claims.create(new ClaimRequest(kind, c.party().trim(), blank(c.narration()), c.amount(), c.date(), c.dueDate(),
                    interest ? c.interestRate() : null, InterestType.SIMPLE, c.paidFromId(), null, blank(c.reference()), blank(c.notes()),
                    null, null, false, null));
            activity.record("ADDED", "Expenses", "Synced from the phone app · " + v.kindLabel() + " · " + ActivityService.money(v.amount())
                    + " · " + ActivityService.cut(v.party(), 40));
            return new Booked(v.journalEntryId(), v.entryNo());
        });
    }

    /** Money received back on a claim. */
    @Transactional
    public SyncResult writeRepayment(AppSyncService.SyncRepayment r) {
        return once(r.clientId(), Feature.EXPENSES, "record money received back", () -> {
            ClaimView before = claims.get(r.claimId());
            ClaimView after = claims.repay(r.claimId(), new RepaymentRequest(r.date(), r.principal(), r.interest(), r.accountId(), blank(r.notes())));
            var made = after.repayments().stream().filter(x -> before.repayments().stream().noneMatch(y -> y.id().equals(x.id()))).findFirst();
            BigDecimal total = r.principal().add(r.interest() == null ? BigDecimal.ZERO : r.interest());
            activity.record("POSTED", "Expenses", "Synced from the phone app · received " + ActivityService.money(total)
                    + " from " + ActivityService.cut(after.party(), 40));
            return new Booked(made.map(x -> x.journalEntryId()).orElse(null), made.map(x -> x.entryNo()).orElse(null));
        });
    }

    /** Income received, into a bank, cash or wallet account. */
    @Transactional
    public SyncResult writeIncome(AppSyncService.SyncIncome i) {
        return once(i.clientId(), Feature.INCOME, "record income", () -> {
            EntryView v = transactions.postQuick(new QuickTransactionRequest(QuickKind.INCOME, i.date(), i.amount(), null, i.intoId(), i.categoryId(),
                    blank(i.narration()), blank(i.reference()), blank(i.party())));
            activity.record("ADDED", "Income", "Synced from the phone app · " + ActivityService.money(i.amount())
                    + (i.narration() != null ? " · " + ActivityService.cut(i.narration(), 60) : ""));
            return new Booked(v.id(), v.entryNo());
        });
    }

    /** A gift given or received (cash given may be booked as an expense too). */
    @Transactional
    public SyncResult writeGift(AppSyncService.SyncGift g) {
        return once(g.clientId(), Feature.GIFTS, "record gifts", () -> {
            var v = gifts.create(new GiftService.GiftRequest(g.direction(), g.date(), g.person().trim(), blank(g.relation()), null, blank(g.occasion()),
                    g.kind(), blank(g.description()), g.value(), g.quantity(), blank(g.unit()), null, blank(g.mode()), g.donation(), null,
                    blank(g.notes()), g.bookAccountId(), g.bookCategoryId(), null));
            activity.record("ADDED", "Gifts", "Synced from the phone app · " + ("GIVEN".equals(v.direction()) ? "given to " : "received from ")
                    + ActivityService.cut(v.person(), 40) + (v.value() != null ? " · " + ActivityService.money(v.value()) : ""));
            return new Booked(v.journalEntryId(), v.entryNo());
        });
    }

    /** The next EMIs of a plan, paid (a card EMI: paid into the card from the bank). */
    @Transactional
    public SyncResult writeEmiPayment(AppSyncService.SyncEmiPayment e) {
        return once(e.clientId(), Feature.EXPENSES, "pay EMIs", () -> {
            var p = emis.pay(e.planId(), new EmiService.PayRequest(e.count() == null ? 1 : e.count(), e.date(), e.accountId(), false));
            var last = p.installments().stream().filter(i -> i.paymentEntryId() != null || i.journalEntryId() != null).reduce((a, b) -> b);
            activity.record("POSTED", "Expenses", "Synced from the phone app · EMI of " + ActivityService.cut(p.narration(), 50));
            return new Booked(last.map(i -> i.paymentEntryId() != null ? i.paymentEntryId() : i.journalEntryId()).orElse(null),
                    last.map(i -> i.paymentEntryNo() != null ? i.paymentEntryNo() : i.entryNo()).orElse(null));
        });
    }

    private record Booked(Long entryId, String entryNo) {
    }

    /**
     * Books an item once: one synced before is answered DUPLICATE. The user needs the section, and an item that would
     * wait for approval (maker-checker) is refused: only expenses can wait for approval from the phone.
     */
    private SyncResult once(String clientId, Feature section, String what, Supplier<Booked> book) {
        Long tenant = UserContext.tenantId();
        var done = keys.findByClientId(tenant, clientId);
        if (done.isPresent()) {
            return new SyncResult(clientId, "DUPLICATE", done.get().getEntryId(), done.get().getEntryNo(), "Already synced", null);
        }
        var me = UserContext.get();
        if (!me.features().contains(section)) {
            return new SyncResult(clientId, "FAILED", null, null, "You may not " + what + ": " + section.getLabel() + " is not shared with you", null);
        }
        if (me.approval()) {
            return new SyncResult(clientId, "FAILED", null, null, "Your entries wait for approval: " + what + " on the full site", null);
        }
        Booked b = book.get();
        AppSyncKey k = new AppSyncKey();
        k.setTenantId(tenant);
        k.setClientId(clientId);
        k.setEntryId(b.entryId());
        k.setEntryNo(b.entryNo());
        k.setCreatedBy(UserContext.username());
        k.setCreatedAt(OrgClock.now());
        keys.save(k);
        return new SyncResult(clientId, "CREATED", b.entryId(), b.entryNo(), null, null);
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
