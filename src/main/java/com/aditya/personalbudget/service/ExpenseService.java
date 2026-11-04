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
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
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
                             List<RefundView> refunds,
                             // ---- linked charges (a fee, tax or tip that came with an expense)
                             /* the expense this one was charged with, or null */
                             Long parentEntryId, String parentEntryNo, String parentNarration,
                             /* charges that came with this expense, oldest first */
                             List<LinkedView> linked,
                             /* a charge can be linked to it; it can be turned into money paid for someone */
                             boolean linkable, boolean convertible,
                             // ---- an itemized bill: one payment, several things bought (one row per item)
                             /* the expense line of this row */
                             Long lineId, boolean itemized,
                             /* every item of the bill, in the order recorded (empty unless itemized) */
                             List<ItemView> items,
                             /* the whole bill and its notes (null unless itemized) */
                             BigDecimal billAmount, String billNotes) {
    }

    /**
     * One thing bought on an itemized bill: its line, category, what it cost, what it was (the line's memo) and what
     * came back on it. Refunds are matched to items by category, in the order the items were recorded.
     */
    public record ItemView(Long lineId, int lineNo, Long categoryId, String categoryName, String categoryCode,
                           BigDecimal amount, String name, BigDecimal refunded, BigDecimal netAmount, String status) {
    }

    /**
     * A charge that came with an expense (a transaction fee, GST, a tip ...): an expense of its own, linked to it,
     * with the money that came back on it.
     */
    public record LinkedView(Long entryId, String entryNo, LocalDate date, String narration, Long categoryId,
                             String categoryName, BigDecimal amount, BigDecimal netAmount, String status,
                             BigDecimal refunded, List<RefundView> refunds) {
    }

    /** Turns an expense into money paid for someone, who will pay it back. */
    public record ConvertToPaidForRequest(@jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Size(max = 100) String party,
                                          @jakarta.validation.constraints.Size(max = 255) String narration,
                                          LocalDate dueDate,
                                          @jakarta.validation.constraints.Size(max = 500) String notes,
                                          Long receivableAccountId) {
    }

    /** Money that came back on an expense: a refund (part or all) or the reversal of a mistaken expense. */
    public record RefundView(Long entryId, String entryNo, LocalDate date, BigDecimal amount, boolean reversal,
                             Long accountId, String accountName, String note, int attachmentCount,
                             /* the category it came off when that is one (an item of a bill); null for several */
                             Long categoryId) {
    }

    /**
     * A refund: how much came back, when, and into which account (default: the one that paid). On an itemized bill,
     * {@code lineId} is the item it came back on.
     */
    public record RefundRequest(@jakarta.validation.constraints.NotNull LocalDate date,
                                @jakarta.validation.constraints.NotNull @jakarta.validation.constraints.Positive BigDecimal amount,
                                Long accountId, String notes, Long lineId) {

        public RefundRequest(LocalDate date, BigDecimal amount, Long accountId, String notes) {
            this(date, amount, accountId, notes, null);
        }
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
    private final ClaimService claims;
    private final NotificationService notifications;

    public ExpenseService(JournalEntryRepository entries, JournalLineRepository lines, AccountRepository accounts,
                          LedgerService ledger, CategoryService categories,
                          com.aditya.personalbudget.repository.AttachmentRepository attachments, ClaimService claims,
                          NotificationService notifications) {
        this.attachments = attachments;
        this.notifications = notifications;
        this.claims = claims;
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
        // linked charges: expenses whose source points at the expense they came with, whatever their date
        Map<Long, JournalEntry> everyEntry = entries.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        Map<Long, List<JournalEntry>> childrenByParent = everyEntry.values().stream()
                .filter(x -> LedgerService.isExpense(x) && x.getSourceId() != null)
                .collect(Collectors.groupingBy(JournalEntry::getSourceId));
        Set<Long> childIds = childrenByParent.values().stream().flatMap(List::stream).map(JournalEntry::getId)
                .collect(Collectors.toSet());
        Map<Long, List<JournalLine>> childLines = lines.findByJournalEntryIdIn(childIds).stream()
                .collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        Set<Long> withRefunds = new java.util.HashSet<>(ids);
        withRefunds.addAll(childIds);
        Map<Long, List<Back>> backByExpense = backOf(withRefunds);
        Map<Long, List<RefundView>> refundsByExpense = views(backByExpense, accountById, evidence);
        Function<Long, List<LinkedView>> linkedOf = parentId -> childrenByParent.getOrDefault(parentId, List.of()).stream()
                .sorted(Comparator.comparing(JournalEntry::getEntryDate).thenComparing(JournalEntry::getId))
                .map(child -> {
                    JournalLine expenseLine = childLines.getOrDefault(child.getId(), List.of()).stream()
                            .filter(l -> l.getDebit().signum() > 0).findFirst().orElse(null);
                    BigDecimal amount = expenseLine == null ? child.getAmount() : expenseLine.getDebit();
                    List<RefundView> back = refundsByExpense.getOrDefault(child.getId(), List.of());
                    Category category = expenseLine == null ? null : books.category(expenseLine.getCategoryId());
                    return new LinkedView(child.getId(), child.getEntryNo(), child.getEntryDate(), child.getNarration(),
                            category == null ? null : category.getId(), category == null ? "Uncategorised" : category.getName(),
                            amount, amount.subtract(refunded(back)).max(Money.ZERO), status(amount, back), refunded(back), back);
                }).toList();

        return linesByEntry.entrySet().stream()
                .flatMap(e -> {
                    JournalEntry entry = entryById.get(e.getKey());
                    List<JournalLine> entryLines = e.getValue();
                    List<JournalLine> credits = entryLines.stream().filter(l -> l.getCredit().signum() > 0).toList();
                    Account payer = credits.isEmpty() ? null : accountById.get(credits.getFirst().getAccountId());
                    String payerName = credits.stream().map(l -> accountById.get(l.getAccountId()).getName())
                            .distinct().collect(Collectors.joining(", "));
                    boolean simple = entryLines.size() == 2;
                    List<JournalLine> expenseLines = entryLines.stream()
                            .filter(l -> l.getDebit().signum() > 0)
                            .filter(l -> accountById.get(l.getAccountId()).getAccountClass() == AccountClass.EXPENSE)
                            .sorted(Comparator.comparing(JournalLine::getLineNo))
                            .toList();
                    boolean itemized = isItemized(entry, entryLines, expenseLines);
                    List<RefundView> refunds = refundsByExpense.getOrDefault(entry.getId(), List.of());
                    boolean reversed = refunds.stream().anyMatch(RefundView::reversal);
                    boolean editable = LedgerService.isExpense(entry) && (simple || itemized) && refunds.isEmpty();
                    boolean viaJournal = LedgerService.isManual(entry);
                    String lockReason = editable || viaJournal ? null : lockReason(entry);
                    JournalEntry parent = LedgerService.isExpense(entry) && entry.getSourceId() != null
                            ? everyEntry.get(entry.getSourceId()) : null;
                    List<LinkedView> linked = LedgerService.isExpense(entry) ? linkedOf.apply(entry.getId()) : List.of();
                    // an itemized bill: what came back on each item, matched by category
                    Map<Long, BigDecimal> backOnItem = itemized
                            ? allocate(expenseLines, backByExpense.getOrDefault(entry.getId(), List.of())) : Map.of();
                    List<ItemView> items = !itemized ? List.of() : expenseLines.stream().map(l -> {
                        Category c = books.category(l.getCategoryId());
                        BigDecimal back = backOnItem.getOrDefault(l.getId(), Money.ZERO);
                        return new ItemView(l.getId(), l.getLineNo(), c == null ? null : c.getId(),
                                c == null ? "Uncategorised" : c.getName(), c == null ? "" : c.getCode(), l.getDebit(),
                                l.getMemo(), back, l.getDebit().subtract(back).max(Money.ZERO), itemStatus(l.getDebit(), back, reversed));
                    }).toList();
                    boolean billLeft = items.stream().anyMatch(i -> i.netAmount().signum() > 0);
                    return expenseLines.stream()
                            .map(l -> {
                                Category category = books.category(l.getCategoryId());
                                BigDecimal back = itemized ? backOnItem.getOrDefault(l.getId(), Money.ZERO) : refunded(refunds);
                                return new ExpenseRow(entry.getId(), entry.getEntryNo(), entry.getEntryDate(),
                                        entry.getVoucherType().name(), entry.getNarration(), entry.getParty(),
                                        entry.getReference(), l.getMemo(), category == null ? null : category.getId(),
                                        category == null ? "Uncategorised" : category.getName(),
                                        category == null ? "" : category.getCode(), l.getDebit(), payer == null ? null : payer.getId(), payerName,
                                        payer == null ? null : payer.getAccountType().name(), editable, viaJournal,
                                        simple, lockReason, entry.getCreatedBy(), entry.getVersion(),
                                        evidence.getOrDefault(entry.getId(), 0),
                                        itemized ? itemStatus(l.getDebit(), back, reversed) : status(l.getDebit(), refunds), back,
                                        l.getDebit().subtract(back).max(Money.ZERO),
                                        LedgerService.isExpense(entry) && !reversed && (itemized ? billLeft
                                                : simple && l.getDebit().subtract(back).signum() > 0),
                                        refunds,
                                        parent == null ? null : parent.getId(), parent == null ? null : parent.getEntryNo(),
                                        parent == null ? null : parent.getNarration(), linked,
                                        LedgerService.isExpense(entry) && entry.getSourceId() == null && !reversed,
                                        editable && simple && linked.isEmpty(),
                                        l.getId(), itemized, items,
                                        itemized ? entry.getAmount() : null,
                                        itemized ? credits.getFirst().getMemo() : null);
                            });
                })
                .sorted(Comparator.comparing(ExpenseRow::date).thenComparing(ExpenseRow::entryId).reversed())
                .toList();
    }

    // ================================================================== create / edit / delete

    @Transactional
    public EntryView create(ExpenseRequest request) {
        EntryView posted = ledger.toViews(List.of(ledger.post(draft(request)))).getFirst();
        notifications.entryPosted(posted);   // when it is large enough, or the dialog asked
        return posted;
    }

    @Transactional
    public EntryView update(Long entryId, ExpenseRequest request) {
        JournalEntry entry = requireExpense(entryId);
        // a linked charge stays linked to the expense it came with
        return ledger.toViews(List.of(ledger.repost(entryId, draft(request).source(LedgerService.SOURCE_EXPENSE, entry.getSourceId()),
                ConcurrentUpdateException.required(request.version(), "journal_entries", entryId)))).getFirst();
    }

    @Transactional
    public void delete(Long entryId) {
        JournalEntry entry = requireExpense(entryId);
        List<JournalEntry> linked = linkedTo(entryId);
        if (!linked.isEmpty()) {
            throw new BusinessException(entry.getEntryNo() + " has " + linked.size() + " linked charge" + (linked.size() == 1 ? "" : "s")
                    + " (" + linked.stream().map(JournalEntry::getEntryNo).collect(Collectors.joining(", ")) + "). Delete "
                    + (linked.size() == 1 ? "it" : "them") + " first");
        }
        ledger.delete(entryId);
    }

    // ================================================================== linked charges

    /**
     * Records a charge that came with an expense (a transaction fee, GST, a tip, delivery ...): an expense of its own, in
     * its own category, with the expense as its source so the two are shown together. A charge has no charges of its own.
     */
    @Transactional
    public EntryView addLinked(Long parentId, ExpenseRequest request) {
        requireParent(parentId);
        return ledger.toViews(List.of(ledger.post(draft(request).source(LedgerService.SOURCE_EXPENSE, parentId)))).getFirst();
    }

    /**
     * Links an expense recorded on its own to the expense it came with ({@code parentId}), moves a charge to another
     * expense, or (with no parent) makes a charge an expense on its own again. Only the link changes: amount, category,
     * account and date stay as they are.
     */
    @Transactional
    public void relink(Long entryId, Long parentId) {
        JournalEntry entry = entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", entryId));
        if (!LedgerService.isExpense(entry)) {
            throw new BusinessException(entry.getEntryNo() + " was not posted from Expenses, so it cannot be linked");
        }
        if (parentId != null) {
            if (parentId.equals(entryId)) {
                throw new BusinessException("An expense cannot be a charge of itself");
            }
            List<JournalEntry> own = linkedTo(entryId);
            if (!own.isEmpty()) {
                throw new BusinessException(entry.getEntryNo() + " has charges of its own ("
                        + own.stream().map(JournalEntry::getEntryNo).collect(Collectors.joining(", ")) + "), so it cannot become a charge");
            }
            requireParent(parentId);
        }
        if (java.util.Objects.equals(entry.getSourceId(), parentId)) {
            return;
        }
        entry.setSourceId(parentId);
        entries.save(entry);
    }

    /** An expense a charge can be linked to: posted from Expenses, not itself a charge, not reversed. */
    private JournalEntry requireParent(Long parentId) {
        JournalEntry parent = entries.findByIdAndTenantId(parentId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", parentId));
        if (!LedgerService.isExpense(parent)) {
            throw new BusinessException(parent.getEntryNo() + " was not posted from Expenses, so a charge cannot be linked to it");
        }
        if (parent.getSourceId() != null) {
            throw new BusinessException(parent.getEntryNo() + " is itself a charge linked to "
                    + entries.findByIdAndTenantId(parent.getSourceId(), UserContext.tenantId()).map(JournalEntry::getEntryNo).orElse("another expense")
                    + ". Link the new charge to that expense instead");
        }
        if (refundsOf(Set.of(parentId), Map.of(), Map.of()).getOrDefault(parentId, List.of()).stream().anyMatch(RefundView::reversal)) {
            throw new BusinessException(parent.getEntryNo() + " is reversed, so nothing more can be charged with it");
        }
        return parent;
    }

    private List<JournalEntry> linkedTo(Long parentId) {
        return entries.findByTenantId(UserContext.tenantId()).stream()
                .filter(x -> LedgerService.isExpense(x) && parentId.equals(x.getSourceId()))
                .toList();
    }

    // ================================================================== paid for someone

    /**
     * Turns an expense into money paid for someone (they will pay it back): the expense entry goes and a Paid for item
     * takes its place, with the same date, amount, account and evidence. Only a plain expense can be turned: one without
     * refunds, a reversal or linked charges.
     */
    @Transactional
    public com.aditya.personalbudget.dto.ClaimDtos.ClaimView convertToPaidFor(Long entryId, ConvertToPaidForRequest request) {
        JournalEntry entry = requireExpense(entryId);
        List<JournalLine> entryLines = lines.findByJournalEntryId(entryId);
        if (entryLines.size() != 2) {
            throw new BusinessException(entry.getEntryNo() + " is not a single expense; correct it in the journal");
        }
        if (!linkedTo(entryId).isEmpty()) {
            throw new BusinessException(entry.getEntryNo() + " has linked charges. Delete them, or turn them into Paid for one by one, first");
        }
        JournalLine expenseLine = entryLines.stream().filter(l -> l.getDebit().signum() > 0).findFirst().orElseThrow();
        JournalLine payer = entryLines.stream().filter(l -> l.getCredit().signum() > 0).findFirst().orElseThrow();
        if (request.dueDate() != null && request.dueDate().isBefore(entry.getEntryDate())) {
            throw new BusinessException("Due date cannot be before the date it was paid");
        }
        String narration = blankToNull(request.narration()) != null ? request.narration().trim() : entry.getNarration();
        String notes = blankToNull(request.notes()) != null ? request.notes().trim() : expenseLine.getMemo();
        var claim = claims.create(new com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest(
                com.aditya.personalbudget.domain.type.ClaimKind.PAID_FOR, request.party().trim(), narration,
                expenseLine.getDebit(), entry.getEntryDate(), request.dueDate(), null, null, payer.getAccountId(),
                request.receivableAccountId(), entry.getReference(), notes, null, null, false, null));
        // the bill or screenshot belongs to the item now
        for (var a : attachments.findByJournalEntryId(entryId)) {
            a.setJournalEntryId(claim.journalEntryId());
            attachments.save(a);
        }
        ledger.delete(entryId);
        return claims.get(claim.id());
    }

    // ================================================================== refunds and reversal

    /**
     * Money back on an expense: Dr the account it comes into (by default the one that paid; a card refund lowers
     * what you owe on it), Cr Expenses with the same category. Several part refunds are fine, up to the amount.
     */
    @Transactional
    public EntryView refund(Long entryId, RefundRequest request) {
        Expense e = refundable(entryId);
        JournalLine item = e.item(request.lineId());
        BigDecimal left = e.left(item);
        BigDecimal amount = Money.round(request.amount());
        if (amount.compareTo(left) > 0) {
            throw new BusinessException("Only " + left.toPlainString() + " of " + (e.itemized() ? itemLabel(item) : "this expense")
                    + " is left to refund");
        }
        if (request.date().isBefore(e.entry().getEntryDate())) {
            throw new BusinessException("A refund cannot be dated before the expense");
        }
        Account into = request.accountId() != null ? account(request.accountId()) : account(e.payer().getAccountId());
        if (into.getAccountClass() != AccountClass.ASSET && into.getAccountClass() != AccountClass.LIABILITY) {
            throw new BusinessException("Take the refund into a bank, cash, wallet or card account");
        }
        boolean full = amount.compareTo(left) == 0 && e.back(item).signum() == 0;
        JournalDraft draft = JournalDraft.of(request.date(), VoucherType.REFUND,
                        (full ? "Refund: " : "Part refund: ") + (e.itemized() ? itemLabel(item) + " · " : "") + e.entry().getNarration())
                .party(e.entry().getParty())
                .reference(e.entry().getEntryNo())
                .debit(into.getId(), amount, blankToNull(request.notes()))
                .credit(item.getAccountId(), amount, "Refund of " + e.entry().getEntryNo()).category(item.getCategoryId())
                .source(LedgerService.SOURCE_REFUND, entryId);
        return ledger.toViews(List.of(ledger.post(draft))).getFirst();
    }

    /**
     * Reverses an expense: the mirror image of what is left of it (after any refunds), linked to it, so the books
     * show both and the expense counts for nothing. Dated on the expense unless another date is given. An itemized
     * bill is reversed as a whole: what is left of each item comes off its own category.
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
                .debit(e.payer().getAccountId(), e.left(), reason);
        for (JournalLine item : e.items()) {
            draft.credit(item.getAccountId(), e.left(item), "Reversal of " + e.entry().getEntryNo()).category(item.getCategoryId());
        }
        return ledger.toViews(List.of(ledger.post(draft.source(LedgerService.SOURCE_REVERSAL, entryId)))).getFirst();
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

    /**
     * An expense money can come back on: its expense line(s) (one, or the items of a bill), the line of the account
     * that paid, and what already came back on each expense line.
     */
    private record Expense(JournalEntry entry, List<JournalLine> items, JournalLine payer, Map<Long, BigDecimal> taken) {

        boolean itemized() {
            return items.size() > 1;
        }

        /** The item a refund is for: the only one, or the one asked for on a bill. */
        JournalLine item(Long lineId) {
            if (!itemized()) {
                return items.getFirst();
            }
            if (lineId == null) {
                throw new BusinessException("Pick the item of " + entry.getEntryNo() + " the money came back on");
            }
            return items.stream().filter(l -> l.getId().equals(lineId)).findFirst()
                    .orElseThrow(() -> new BusinessException("That item is not on " + entry.getEntryNo()));
        }

        BigDecimal back(JournalLine item) {
            return taken.getOrDefault(item.getId(), Money.ZERO);
        }

        BigDecimal left(JournalLine item) {
            return item.getDebit().subtract(back(item)).max(Money.ZERO);
        }

        BigDecimal left() {
            return items.stream().map(this::left).reduce(Money.ZERO, BigDecimal::add);
        }
    }

    private Expense refundable(Long entryId) {
        JournalEntry entry = entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", entryId));
        List<JournalLine> entryLines = lines.findByJournalEntryId(entryId);
        Long expensesId = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
        List<JournalLine> items = entryLines.stream().filter(l -> l.getDebit().signum() > 0 && expensesId.equals(l.getAccountId()))
                .sorted(Comparator.comparing(JournalLine::getLineNo)).toList();
        List<JournalLine> credits = entryLines.stream().filter(l -> l.getCredit().signum() > 0).toList();
        if (!LedgerService.isExpense(entry) || items.isEmpty() || credits.size() != 1 || items.size() + 1 != entryLines.size()) {
            throw new BusinessException(entry.getEntryNo() + " is not a single expense; correct it in the journal");
        }
        List<Back> backs = backOf(Set.of(entryId)).getOrDefault(entryId, List.of());
        if (backs.stream().anyMatch(Back::reversal)) {
            throw new BusinessException(entry.getEntryNo() + " is already reversed");
        }
        Expense e = new Expense(entry, items, credits.getFirst(), allocate(items, backs));
        if (e.left().signum() <= 0) {
            throw new BusinessException(entry.getEntryNo() + " is already refunded in full");
        }
        return e;
    }

    /** A refund or reversal entry of an expense, with its lines. */
    private record Back(JournalEntry entry, List<JournalLine> lines) {

        boolean reversal() {
            return LedgerService.SOURCE_REVERSAL.equals(entry.getSourceType());
        }
    }

    /** Refund and reversal entries of the given expenses, oldest first. */
    private Map<Long, List<Back>> backOf(Set<Long> expenseIds) {
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
        return found.stream().collect(Collectors.groupingBy(JournalEntry::getSourceId, java.util.LinkedHashMap::new,
                Collectors.mapping(x -> new Back(x, refundLines.getOrDefault(x.getId(), List.of())), Collectors.toList())));
    }

    private Map<Long, List<RefundView>> refundsOf(Set<Long> expenseIds, Map<Long, Account> accountById, Map<Long, Integer> evidence) {
        return views(backOf(expenseIds), accountById, evidence);
    }

    private static Map<Long, List<RefundView>> views(Map<Long, List<Back>> backs, Map<Long, Account> accountById, Map<Long, Integer> evidence) {
        Map<Long, List<RefundView>> out = new java.util.HashMap<>();
        backs.forEach((expenseId, list) -> out.put(expenseId, list.stream().map(b -> {
            JournalLine into = b.lines().stream().filter(l -> l.getDebit().signum() > 0).findFirst().orElse(null);
            Account a = into == null ? null : accountById.get(into.getAccountId());
            List<Long> off = b.lines().stream().filter(l -> l.getCredit().signum() > 0).map(JournalLine::getCategoryId).distinct().toList();
            JournalEntry x = b.entry();
            return new RefundView(x.getId(), x.getEntryNo(), x.getEntryDate(), x.getAmount(), b.reversal(), a == null ? null : a.getId(),
                    a == null ? null : a.getName(), into == null ? null : into.getMemo(), evidence.getOrDefault(x.getId(), 0),
                    off.size() == 1 ? off.getFirst() : null);
        }).toList()));
        return out;
    }

    /**
     * What came back on each expense line ({@code items}, by id): each refunded or reversed amount goes to the lines of
     * its category first, in the order they were recorded, then to any line with room left.
     */
    private static Map<Long, BigDecimal> allocate(List<JournalLine> items, List<Back> backs) {
        Map<Long, BigDecimal> taken = new java.util.HashMap<>();
        for (Back b : backs) {
            for (JournalLine off : b.lines()) {
                if (off.getCredit().signum() <= 0) {
                    continue;
                }
                BigDecimal rest = off.getCredit();
                for (boolean sameCategory : new boolean[] {true, false}) {
                    for (JournalLine item : items) {
                        if (rest.signum() <= 0 || (sameCategory && !java.util.Objects.equals(item.getCategoryId(), off.getCategoryId()))) {
                            continue;
                        }
                        BigDecimal had = taken.getOrDefault(item.getId(), Money.ZERO);
                        BigDecimal take = item.getDebit().subtract(had).min(rest);
                        if (take.signum() > 0) {
                            taken.put(item.getId(), had.add(take));
                            rest = rest.subtract(take);
                        }
                    }
                }
            }
        }
        return taken;
    }

    /** One payment, several things bought: posted from Expenses, one paying line and two or more expense lines. */
    private static boolean isItemized(JournalEntry entry, List<JournalLine> entryLines, List<JournalLine> expenseLines) {
        long credits = entryLines.stream().filter(l -> l.getCredit().signum() > 0).count();
        return LedgerService.isExpense(entry) && credits == 1 && expenseLines.size() > 1 && expenseLines.size() + 1 == entryLines.size();
    }

    private static String itemStatus(BigDecimal amount, BigDecimal back, boolean reversed) {
        if (reversed) {
            return "REVERSED";
        }
        if (back.signum() <= 0) {
            return null;
        }
        return back.compareTo(amount) >= 0 ? "REFUNDED" : "PARTLY_REFUNDED";
    }

    private String itemLabel(JournalLine item) {
        return blankToNull(item.getMemo()) != null ? item.getMemo().trim() : categories.require(item.getCategoryId()).getName();
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

    /**
     * Dr Expenses with the category (memo = notes), Cr the bank / card / cash / payable that paid. An itemized bill:
     * Dr Expenses once per item (its category, memo = what it was), Cr the payer the whole bill (memo = notes).
     */
    private JournalDraft draft(ExpenseRequest request) {
        Account payer = account(request.paidFromId());
        if (payer.getAccountClass() != AccountClass.ASSET && payer.getAccountClass() != AccountClass.LIABILITY) {
            throw new BusinessException("Pay the expense from a bank, cash, card, wallet or payable account");
        }
        String notes = blankToNull(request.notes());
        Long expensesId = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
        if (request.itemized()) {
            List<Category> itemCategories = request.items().stream()
                    .map(i -> categories.require(i.categoryId(), CategoryKind.EXPENSE)).toList();
            BigDecimal total = request.items().stream().map(i -> Money.round(i.amount())).reduce(Money.ZERO, BigDecimal::add);
            if (Money.round(request.amount()).compareTo(total) != 0) {
                throw new BusinessException("The items add up to " + total.toPlainString() + " but the bill is "
                        + Money.round(request.amount()).toPlainString() + ": make them match");
            }
            String narration = blankToNull(request.narration()) != null ? request.narration().trim() : billName(itemCategories);
            JournalDraft draft = JournalDraft.of(request.entryDate(), VoucherType.EXPENSE, narration);
            for (int i = 0; i < itemCategories.size(); i++) {
                var item = request.items().get(i);
                draft.debit(expensesId, item.amount(), blankToNull(item.name())).category(itemCategories.get(i).getId());
            }
            return draft.credit(payer.getId(), total, notes)
                    .reference(blankToNull(request.reference()))
                    .party(blankToNull(request.party()))
                    .source(LedgerService.SOURCE_EXPENSE, null);
        }
        // a bill split down to one item is a plain expense
        var only = request.items() == null || request.items().isEmpty() ? null : request.items().getFirst();
        Long categoryId = only != null ? only.categoryId() : request.categoryId();
        if (categoryId == null) {
            throw new BusinessException("Pick a category");
        }
        Category category = categories.require(categoryId, CategoryKind.EXPENSE);
        String narration = request.narration() == null || request.narration().isBlank()
                ? category.getName() : request.narration().trim();
        String memo = notes != null || only == null ? notes : blankToNull(only.name());
        return JournalDraft.of(request.entryDate(), VoucherType.EXPENSE, narration)
                .debit(expensesId, request.amount(), memo).category(category.getId())
                .credit(payer.getId(), request.amount())
                .reference(blankToNull(request.reference()))
                .party(blankToNull(request.party()))
                .source(LedgerService.SOURCE_EXPENSE, null);
    }

    /** A bill's description when none is given: its categories, "Groceries & Eggs" or "Groceries, Eggs + 2 more". */
    static String billName(List<Category> itemCategories) {
        List<String> names = itemCategories.stream().map(Category::getName).distinct().toList();
        if (names.size() <= 2) {
            return String.join(" & ", names);
        }
        return names.get(0) + ", " + names.get(1) + " + " + (names.size() - 2) + " more";
    }

    private JournalEntry requireExpense(Long entryId) {
        JournalEntry entry = entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Expense", entryId));
        if (!LedgerService.isExpense(entry)) {
            throw new BusinessException(entry.getEntryNo() + " was not posted from Expenses. " + lockReason(entry));
        }
        if (!refundsOf(Set.of(entryId), Map.of(), Map.of()).isEmpty()) {
            throw new BusinessException(entry.getEntryNo() + " has a refund or reversal. Undo that first");
        }
        return entry;
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
