package com.aditya.personalbudget.service;

import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.LineRequest;
import com.aditya.personalbudget.dto.JournalDtos.ManualJournalRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;

/**
 * Day-to-day bookkeeping: quick income / expense / transfer postings and manual journal vouchers.
 * Every transaction becomes a balanced journal entry through {@link LedgerService}.
 */
@Service
public class TransactionService {

    private final LedgerService ledger;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final CategoryRepository categories;

    public TransactionService(LedgerService ledger, AccountRepository accounts, JournalEntryRepository entries,
                              CategoryRepository categories) {
        this.ledger = ledger;
        this.accounts = accounts;
        this.entries = entries;
        this.categories = categories;
    }

    // ================================================================== queries

    /**
     * Searches the journal register.
     *
     * @param search free text matched against entry number or id, narration, reference and party
     */
    public List<EntryView> search(LocalDate from, LocalDate to, VoucherType voucherType, Long accountId,
                                  String search, int limit) {
        LocalDate start = from != null ? from : LocalDate.of(1900, 1, 1);
        LocalDate end = to != null ? to : LocalDate.of(9999, 12, 31);
        Set<Long> touching = accountId != null ? ledger.entryIdsTouchingAccount(accountId) : null;
        String text = search == null ? "" : search.trim().toLowerCase(Locale.ROOT);

        Stream<JournalEntry> stream = ledger.entriesBetween(start, end).stream()
                .filter(e -> voucherType == null || e.getVoucherType() == voucherType)
                .filter(e -> touching == null || touching.contains(e.getId()))
                .filter(e -> text.isEmpty() || matches(e, text))
                .sorted(JournalEntryRepository.NEWEST_FIRST)
                .limit(limit > 0 ? limit : 500);
        return ledger.toViews(stream.toList());
    }

    public EntryView get(Long id) {
        return ledger.toViews(List.of(ledger.get(id))).getFirst();
    }

    // ================================================================== quick transactions

    @Transactional
    public EntryView postQuick(QuickTransactionRequest request) {
        // an expense lands on Expenses and an income comes from Income: the category says what it was
        Long fromId = request.kind() == QuickKind.INCOME ? ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId() : request.fromAccountId();
        Long toId = request.kind() == QuickKind.EXPENSE ? ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId() : request.toAccountId();
        require(fromId != null && toId != null, request.kind() == QuickKind.EXPENSE ? "Pick the account you paid from"
                : request.kind() == QuickKind.INCOME ? "Pick the account the money came into" : "Pick both accounts");
        Account from = account(fromId);
        Account to = account(toId);
        Category category = null;
        if (request.kind() != QuickKind.TRANSFER) {
            require(request.categoryId() != null, "Pick a category");
            category = categories.findByIdAndTenantId(request.categoryId(), UserContext.tenantId())
                    .orElseThrow(() -> new NotFoundException("Category", request.categoryId()));
        }

        VoucherType voucherType = switch (request.kind()) {
            case EXPENSE -> {
                require(to.getAccountClass() == AccountClass.EXPENSE, "Expense must be booked to an expense account");
                require(isBalanceSheet(from), "Pay the expense from a bank, cash, card, wallet or payable account");
                yield VoucherType.EXPENSE;
            }
            case INCOME -> {
                require(from.getAccountClass() == AccountClass.INCOME, "Income must come from an income account");
                require(isBalanceSheet(to), "Receive income into a bank, cash, wallet or receivable account");
                yield VoucherType.INCOME;
            }
            case TRANSFER -> {
                require(isBalanceSheet(from) && isBalanceSheet(to),
                        "Transfers move money between asset and liability accounts");
                yield VoucherType.TRANSFER;
            }
        };

        String narration = request.narration();
        if (narration == null || narration.isBlank()) {
            narration = switch (request.kind()) {
                case EXPENSE, INCOME -> category.getName();
                case TRANSFER -> from.getName() + " to " + to.getName();
            };
        }
        JournalDraft draft = JournalDraft.of(request.entryDate(), voucherType, narration)
                .debit(to.getId(), request.amount()).category(request.kind() == QuickKind.EXPENSE ? category.getId() : null)
                .credit(from.getId(), request.amount()).category(request.kind() == QuickKind.INCOME ? category.getId() : null)
                .reference(request.reference())
                .party(request.party())
                .source(request.kind() == QuickKind.EXPENSE ? LedgerService.SOURCE_EXPENSE : LedgerService.SOURCE_QUICK, null);
        return get(ledger.post(draft).getId());
    }

    // ================================================================== manual journals

    @Transactional
    public EntryView createJournal(ManualJournalRequest request) {
        JournalDraft draft = toDraft(request, VoucherType.JOURNAL, null);
        return get(ledger.post(draft).getId());
    }

    /**
     * Edits a manual journal voucher, keeping its voucher type and number. Entries posted automatically
     * (expenses, transfers, chits, lending ...) are locked here; see {@link LedgerService#isManual}.
     */
    @Transactional
    public EntryView updateEntry(Long id, ManualJournalRequest request) {
        JournalEntry existing = requireEditable(id);
        JournalDraft draft = toDraft(request, existing.getVoucherType(), existing.getSourceType());
        draft.source(existing.getSourceType(), existing.getSourceId());
        return get(ledger.repost(id, draft, request.version()).getId());
    }

    @Transactional
    public void deleteEntry(Long id) {
        requireEditable(id);
        ledger.delete(id);
    }

    /** Corrects a locked transfer / income / recurring posting with a mirror-image entry. */
    @Transactional
    public EntryView reverse(Long id, LocalDate date) {
        return get(ledger.reverse(id, date).getId());
    }

    // ================================================================== helpers

    private JournalDraft toDraft(ManualJournalRequest request, VoucherType type, String sourceType) {
        JournalDraft draft = JournalDraft.of(request.entryDate(), type, request.narration())
                .reference(request.reference())
                .party(request.party());
        for (LineRequest line : request.lines()) {
            draft.line(new JournalDraft.Line(line.accountId(), line.categoryId(), line.chitId(),
                    Money.nz(line.debit()), Money.nz(line.credit()), line.memo()));
        }
        return draft;
    }

    private JournalEntry requireEditable(Long id) {
        JournalEntry entry = entries.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Journal entry", id));
        if (!LedgerService.isManual(entry)) {
            String reason = ledger.toViews(List.of(entry)).getFirst().lockReason();
            throw new BusinessException(entry.getEntryNo() + " is locked. " + reason);
        }
        return entry;
    }

    private Account account(Long id) {
        return accounts.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Account", id));
    }

    private static boolean isBalanceSheet(Account account) {
        return account.getAccountClass() == AccountClass.ASSET || account.getAccountClass() == AccountClass.LIABILITY;
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new BusinessException(message);
        }
    }

    /** Free text: entry number (EX-000123), internal id (123 or #123), narration, reference or party. */
    private static boolean matches(JournalEntry e, String text) {
        String id = text.startsWith("#") ? text.substring(1) : text;
        if (id.equals(String.valueOf(e.getId()))) return true;
        return Stream.of(e.getEntryNo(), e.getNarration(), e.getReference(), e.getParty())
                .anyMatch(v -> v != null && v.toLowerCase(Locale.ROOT).contains(text));
    }
}
