package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Expense register: every debit to an expense account in a period, whatever voucher posted it
 * (expenses, the interest part of an EMI journal, chit commission ...), plus create / edit / delete
 * of the expenses posted from the Expenses screen. Those are the only place such entries change:
 * the journal shows them locked.
 */
@Service
public class ExpenseService {

    /**
     * One expense line with the account(s) that paid for it.
     * {@code editable}: posted from Expenses, edited with the expense dialog.
     * {@code viaJournal}: part of a manual journal voucher, edited with the journal editor.
     */
    public record ExpenseRow(Long entryId, String entryNo, LocalDate date, String voucherType, String narration,
                             String party, String reference, String memo, Long categoryId, String categoryName,
                             String categoryCode, BigDecimal amount, Long paidFromId, String paidFrom,
                             String paidFromType, boolean editable, boolean viaJournal, boolean simple,
                             String lockReason, String createdBy, Long version, int attachmentCount,
                             // ---- refunds and reversal
                             /* REVERSED, REFUNDED (in full), PARTLY_REFUNDED, or null */
                             String status, BigDecimal refunded, BigDecimal netAmount, boolean refundable,
                             List<RefundView> refunds) {
    }

    /** Money that came back on an expense: a refund (part or all) or the reversal of a mistaken expense. */
    public record RefundView(Long entryId, String entryNo, LocalDate date, BigDecimal amount, boolean reversal,
                             Long accountId, String accountName, String note, int attachmentCount) {
    }

    /** A refund: how much came back, when, and into which account (default: the one that paid). */
    public record RefundRequest(@jakarta.validation.constraints.NotNull LocalDate date,
                                @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.Positive BigDecimal amount,
                                Long accountId, String notes) {
    }

    /** Reverses an expense recorded by mistake (or never charged); dated on the expense by default. */
    public record ReverseRequest(LocalDate date, String reason) {
    }

    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;
    private final AccountRepository accounts;
    private final LedgerService ledger;
    private final CategoryService categories;
    private final com.aditya.personalbudget.repository.AttachmentRepository attachments;

    public ExpenseService(JournalEntryRepository entries, JournalLineRepository lines, AccountRepository accounts,
                          LedgerService ledger, CategoryService categories,
                          com.aditya.personalbudget.repository.AttachmentRepository attachments) {
        this.attachments = attachments;
        this.entries = entries;
        this.lines = lines;
        this.accounts = accounts;
        this.ledger = ledger;
        this.categories = categories;
    }

    // ================================================================== register

    public List<ExpenseRow> list(LocalDate from, LocalDate to) {
        Long tenantId = UserContext.tenantId();
        Map<Long, Account> accountById = accounts.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(Account::getId, Function.identity()));
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, Integer> evidence = attachments.countsByEntry(tenantId);
        Map<Long, JournalEntry> entryById = entries.findByTenantIdAndEntryDateBetween(tenantId, from, to).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        Set<Long> ids = entryById.keySet();
        Map<Long, List<JournalLine>> linesByEntry = lines.findByJournalEntryIdIn(ids).stream()
                .collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        Map<Long, List<RefundView>> refundsByExpense = refundsOf(ids, accountById, evidence);

        return linesByEntry.entrySet().stream()
                .flatMap(e -> {
                    JournalEntry entry = entryById.get(e.getKey());
                    List<JournalLine> entryLines = e.getValue();
                    List<JournalLine> credits = entryLines.stream().filter(l -> l.getCredit().signum() > 0).toList();
                    Account payer = credits.isEmpty() ? null : accountById.get(credits.getFirst().getAccountId());
                    String payerName = credits.stream().map(l -> accountById.get(l.getAccountId()).getName())
                            .distinct().collect(Collectors.joining(", "));
                    boolean simple = entryLines.size() == 2;
                    List<RefundView> refunds = refundsByExpense.getOrDefault(entry.getId(), List.of());
                    boolean editable = LedgerService.isExpense(entry) && simple && refunds.isEmpty();
                    boolean viaJournal = LedgerService.isManual(entry);
                    String lockReason = editable || viaJournal ? null : lockReason(entry);
                    return entryLines.stream()
                            .filter(l -> l.getDebit().signum() > 0)
                            .filter(l -> accountById.get(l.getAccountId()).getAccountClass() == AccountClass.EXPENSE)
                            .map(l -> {
                                Category category = books.category(l.getCategoryId());
                                return new ExpenseRow(entry.getId(), entry.getEntryNo(), entry.getEntryDate(),
                                        entry.getVoucherType().name(), entry.getNarration(), entry.getParty(),
                                        entry.getReference(), l.getMemo(), category == null ? null : category.getId(),
                                        category == null ? "Uncategorised" : category.getName(),
                                        category == null ? "" : category.getCode(), l.getDebit(), payer == null ? null : payer.getId(), payerName,
                                        payer == null ? null : payer.getAccountType().name(), editable, viaJournal,
                                        simple, lockReason, entry.getCreatedBy(), entry.getVersion(),
                                        evidence.getOrDefault(entry.getId(), 0),
                                        status(l.getDebit(), refunds), refunded(refunds),
                                        l.getDebit().subtract(refunded(refunds)).max(Money.ZERO),
                                        LedgerService.isExpense(entry) && simple
                                                && l.getDebit().subtract(refunded(refunds)).signum() > 0
                                                && refunds.stream().noneMatch(RefundView::reversal),
                                        refunds);
                            });
                })
                .sorted(Comparator.comparing(ExpenseRow::date).thenComparing(ExpenseRow::entryId).reversed())
                .toList();
    }

    // ================================================================== create / edit / delete

    @Transactional
    public EntryView create(ExpenseRequest request) {
        return ledger.toViews(List.of(ledger.post(draft(request)))).getFirst();
    }

    @Transactional
    public EntryView update(Long entryId, ExpenseRequest request) {
        requireExpense(entryId);
        return ledger.toViews(List.of(ledger.repost(entryId, draft(request), request.version()))).getFirst();
    }

    @Transactional
    public void delete(Long entryId) {
        requireExpense(entryId);
        ledger.delete(entryId);
    }

    // ================================================================== refunds and reversal

    /**
     * Money back on an expense: Dr the account it comes into (by default the one that paid; a card refund lowers
     * what you owe on it), Cr Expenses with the same category. Several part refunds are fine, up to the amount.
     */
    @Transactional
    public EntryView refund(Long entryId, RefundRequest request) {
        Expense e = refundable(entryId);
        BigDecimal amount = Money.round(request.amount());
        if (amount.compareTo(e.left()) > 0) {
            throw new BusinessException("Only " + e.left().toPlainString() + " of this expense is left to refund");
        }
        if (request.date().isBefore(e.entry().getEntryDate())) {
            throw new BusinessException("A refund cannot be dated before the expense");
        }
        Account into = request.accountId() != null ? account(request.accountId()) : account(e.payer().getAccountId());
        if (into.getAccountClass() != AccountClass.ASSET && into.getAccountClass() != AccountClass.LIABILITY) {
            throw new BusinessException("Take the refund into a bank, cash, wallet or card account");
        }
        JournalDraft draft = JournalDraft.of(request.date(), VoucherType.REFUND,
                        (amount.compareTo(e.left()) == 0 && e.refunded().signum() == 0 ? "Refund: " : "Part refund: ") + e.entry().getNarration())
                .party(e.entry().getParty())
                .reference(e.entry().getEntryNo())
                .debit(into.getId(), amount, blankToNull(request.notes()))
                .credit(e.expenseLine().getAccountId(), amount, "Refund of " + e.entry().getEntryNo()).category(e.expenseLine().getCategoryId())
                .source(LedgerService.SOURCE_REFUND, entryId);
        return ledger.toViews(List.of(ledger.post(draft))).getFirst();
    }

    /**
     * Reverses an expense: the mirror image of what is left of it (after any refunds), linked to it, so the books
     * show both and the expense counts for nothing. Dated on the expense unless another date is given.
     */
    @Transactional
    public EntryView reverse(Long entryId, ReverseRequest request) {
        Expense e = refundable(entryId);
        LocalDate date = request == null || request.date() == null ? e.entry().getEntryDate() : request.date();
        if (date.isBefore(e.entry().getEntryDate())) {
            throw new BusinessException("A reversal cannot be dated before the expense");
        }
        String reason = request == null ? null : blankToNull(request.reason());
        JournalDraft draft = JournalDraft.of(date, VoucherType.REVERSAL,
                        "Reversal of " + e.entry().getEntryNo() + ": " + e.entry().getNarration())
                .party(e.entry().getParty())
                .reference(e.entry().getEntryNo())
                .debit(e.payer().getAccountId(), e.left(), reason)
                .credit(e.expenseLine().getAccountId(), e.left(), "Reversal of " + e.entry().getEntryNo()).category(e.expenseLine().getCategoryId())
                .source(LedgerService.SOURCE_REVERSAL, entryId);
        return ledger.toViews(List.of(ledger.post(draft))).getFirst();
    }

    /** Undoes a refund or a reversal of an expense: its entry is deleted and the expense counts again. */
    @Transactional
    public void undoRefund(Long entryId, Long refundEntryId) {
        JournalEntry refund = entries.findByIdAndTenantId(refundEntryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Refund", refundEntryId));
        boolean ours = entryId.equals(refund.getSourceId())
                && (LedgerService.SOURCE_REFUND.equals(refund.getSourceType()) || LedgerService.SOURCE_REVERSAL.equals(refund.getSourceType()));
        if (!ours) {
            throw new BusinessException(refund.getEntryNo() + " is not a refund or reversal of this expense");
        }
        ledger.delete(refundEntryId);
    }

    private record Expense(JournalEntry entry, JournalLine expenseLine, JournalLine payer, BigDecimal refunded, BigDecimal left) {
    }

    private Expense refundable(Long entryId) {
        JournalEntry entry = entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", entryId));
        List<JournalLine> entryLines = lines.findByJournalEntryId(entryId);
        if (!LedgerService.isExpense(entry) || entryLines.size() != 2) {
            throw new BusinessException(entry.getEntryNo() + " is not a single expense; correct it in the journal");
        }
        JournalLine expenseLine = entryLines.stream().filter(l -> l.getDebit().signum() > 0).findFirst().orElseThrow();
        JournalLine payer = entryLines.stream().filter(l -> l.getCredit().signum() > 0).findFirst().orElseThrow();
        Map<Long, Account> accountById = accounts.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(Account::getId, Function.identity()));
        List<RefundView> refunds = refundsOf(Set.of(entryId), accountById, Map.of()).getOrDefault(entryId, List.of());
        if (refunds.stream().anyMatch(RefundView::reversal)) {
            throw new BusinessException(entry.getEntryNo() + " is already reversed");
        }
        BigDecimal refunded = refunded(refunds);
        BigDecimal left = expenseLine.getDebit().subtract(refunded);
        if (left.signum() <= 0) {
            throw new BusinessException(entry.getEntryNo() + " is already refunded in full");
        }
        return new Expense(entry, expenseLine, payer, refunded, left);
    }

    /** Refund and reversal entries of the given expenses, oldest first. */
    private Map<Long, List<RefundView>> refundsOf(Set<Long> expenseIds, Map<Long, Account> accountById, Map<Long, Integer> evidence) {
        List<JournalEntry> found = entries.findByTenantId(UserContext.tenantId()).stream()
                .filter(x -> x.getSourceId() != null && expenseIds.contains(x.getSourceId()))
                .filter(x -> LedgerService.SOURCE_REFUND.equals(x.getSourceType()) || LedgerService.SOURCE_REVERSAL.equals(x.getSourceType()))
                .sorted(Comparator.comparing(JournalEntry::getEntryDate).thenComparing(JournalEntry::getId))
                .toList();
        if (found.isEmpty()) {
            return Map.of();
        }
        Map<Long, List<JournalLine>> refundLines = lines.findByJournalEntryIdIn(found.stream().map(JournalEntry::getId)
                .collect(Collectors.toSet())).stream().collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        return found.stream().collect(Collectors.groupingBy(JournalEntry::getSourceId, Collectors.mapping(x -> {
            JournalLine into = refundLines.getOrDefault(x.getId(), List.of()).stream().filter(l -> l.getDebit().signum() > 0)
                    .findFirst().orElse(null);
            Account a = into == null ? null : accountById.get(into.getAccountId());
            return new RefundView(x.getId(), x.getEntryNo(), x.getEntryDate(), x.getAmount(),
                    LedgerService.SOURCE_REVERSAL.equals(x.getSourceType()), a == null ? null : a.getId(),
                    a == null ? null : a.getName(), into == null ? null : into.getMemo(), evidence.getOrDefault(x.getId(), 0));
        }, Collectors.toList())));
    }

    private static BigDecimal refunded(List<RefundView> refunds) {
        return refunds.stream().map(RefundView::amount).reduce(Money.ZERO, BigDecimal::add);
    }

    private static String status(BigDecimal amount, List<RefundView> refunds) {
        if (refunds.isEmpty()) {
            return null;
        }
        if (refunds.stream().anyMatch(RefundView::reversal)) {
            return "REVERSED";
        }
        return refunded(refunds).compareTo(amount) >= 0 ? "REFUNDED" : "PARTLY_REFUNDED";
    }

    // ================================================================== helpers

    /** Dr Expenses with the category (memo = notes), Cr the bank / card / cash / payable that paid. */
    private JournalDraft draft(ExpenseRequest request) {
        Category category = categories.require(request.categoryId(), CategoryKind.EXPENSE);
        Account payer = account(request.paidFromId());
        if (payer.getAccountClass() != AccountClass.ASSET && payer.getAccountClass() != AccountClass.LIABILITY) {
            throw new BusinessException("Pay the expense from a bank, cash, card, wallet or payable account");
        }
        String narration = request.narration() == null || request.narration().isBlank()
                ? category.getName() : request.narration().trim();
        String notes = request.notes() == null || request.notes().isBlank() ? null : request.notes().trim();
        return JournalDraft.of(request.entryDate(), VoucherType.EXPENSE, narration)
                .debit(ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId(), request.amount(), notes).category(category.getId())
                .credit(payer.getId(), request.amount())
                .reference(blankToNull(request.reference()))
                .party(blankToNull(request.party()))
                .source(LedgerService.SOURCE_EXPENSE, null);
    }

    private void requireExpense(Long entryId) {
        JournalEntry entry = entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", entryId));
        if (!LedgerService.isExpense(entry)) {
            throw new BusinessException(entry.getEntryNo() + " was not posted from Expenses. " + lockReason(entry));
        }
        if (!refundsOf(Set.of(entryId), Map.of(), Map.of()).isEmpty()) {
            throw new BusinessException(entry.getEntryNo() + " has a refund or reversal. Undo that first");
        }
    }

    private String lockReason(JournalEntry entry) {
        String reason = ledger.toViews(List.of(entry)).getFirst().lockReason();
        return reason != null ? reason : "Edit it in the journal.";
    }

    private Account account(Long id) {
        return accounts.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Account", id));
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.trim();
    }
}
