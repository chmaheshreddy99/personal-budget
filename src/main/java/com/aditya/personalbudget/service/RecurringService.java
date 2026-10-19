package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.domain.type.RecurringKind;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.PlanningDtos.PostRecurringRequest;
import com.aditya.personalbudget.dto.PlanningDtos.RecurringRequest;
import com.aditya.personalbudget.dto.PlanningDtos.RecurringView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.RecurringTransactionRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Scheduled income, expenses and transfers (salary, rent, EMIs, SIPs ...).
 */
@Service
public class RecurringService {

    private final RecurringTransactionRepository recurring;
    private final AccountService accounts;
    private final LedgerService ledger;
    private final TransactionService transactions;
    private final CategoryService categories;

    public RecurringService(RecurringTransactionRepository recurring, AccountService accounts, LedgerService ledger,
                            TransactionService transactions, CategoryService categories) {
        this.recurring = recurring;
        this.accounts = accounts;
        this.ledger = ledger;
        this.transactions = transactions;
        this.categories = categories;
    }

    public List<RecurringView> list() {
        LedgerSnapshot books = ledger.snapshot();
        LocalDate today = LocalDate.now();
        return recurring.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(RecurringTransaction::getNextDueDate))
                .map(r -> new RecurringView(r.getId(), r.getName(), r.getKind(), r.getAmount(),
                        r.getDebitAccountId(), sideName(books, r.getDebitAccountId(), r),
                        r.getCreditAccountId(), sideName(books, r.getCreditAccountId(), r),
                        r.getCategoryId(), r.getCategoryId() == null ? null : books.category(r.getCategoryId()).getName(),
                        r.getFrequency(), r.getStartDate(), r.getEndDate(), r.getNextDueDate(),
                        Boolean.TRUE.equals(r.getActive()),
                        Boolean.TRUE.equals(r.getActive()) && !r.getNextDueDate().isAfter(today) && isWithinEnd(r, r.getNextDueDate()),
                        monthlyEquivalent(r.getAmount(), r.getFrequency()), r.getNotes(), r.getVersion()))
                .toList();
    }

    /** The category for the Expenses / Income side, the account name otherwise. */
    private static String sideName(LedgerSnapshot books, Long accountId, RecurringTransaction r) {
        Account a = books.account(accountId);
        boolean categorySide = a.getAccountClass() == AccountClass.EXPENSE || a.getAccountClass() == AccountClass.INCOME;
        return categorySide && r.getCategoryId() != null ? books.category(r.getCategoryId()).getName() : a.getName();
    }

    public List<RecurringTransaction> active() {
        return recurring.findByTenantIdAndActiveTrue(UserContext.tenantId());
    }

    @Transactional
    public RecurringTransaction create(RecurringRequest request) {
        RecurringTransaction r = new RecurringTransaction();
        r.setTenantId(UserContext.tenantId());
        apply(r, request);
        return recurring.save(r);
    }

    @Transactional
    public RecurringTransaction update(Long id, RecurringRequest request) {
        RecurringTransaction r = require(id);
        apply(r, request);
        r.setVersion(request.version());   // a stale form is refused
        return recurring.save(r);
    }

    @Transactional
    public void delete(Long id) {
        recurring.delete(require(id));
    }

    /** Posts the due occurrence to the ledger and moves the schedule forward. */
    @Transactional
    public EntryView post(Long id, PostRecurringRequest request) {
        RecurringTransaction r = require(id);
        LocalDate date = request != null && request.entryDate() != null ? request.entryDate() : r.getNextDueDate();
        BigDecimal amount = request != null && request.amount() != null ? request.amount() : r.getAmount();

        JournalDraft draft = JournalDraft.of(date, r.getKind().getVoucherType(), r.getName())
                .debit(r.getDebitAccountId(), amount).category(r.getKind() == RecurringKind.EXPENSE ? r.getCategoryId() : null)
                .credit(r.getCreditAccountId(), amount).category(r.getKind() == RecurringKind.INCOME ? r.getCategoryId() : null)
                .source(LedgerService.SOURCE_RECURRING, r.getId());
        Long entryId = ledger.post(draft).getId();

        advance(r);
        return transactions.get(entryId);
    }

    /** Skips the due occurrence without posting. */
    @Transactional
    public RecurringTransaction skip(Long id) {
        RecurringTransaction r = require(id);
        advance(r);
        return recurring.findById(id).orElseThrow();
    }

    /** All dates on which the item occurs within [from, to], starting at its next due date. */
    public static List<LocalDate> occurrences(RecurringTransaction r, LocalDate from, LocalDate to) {
        List<LocalDate> dates = new ArrayList<>();
        LocalDate d = r.getNextDueDate();
        int guard = 0;
        while (!d.isAfter(to) && isWithinEnd(r, d) && guard++ < 1000) {
            if (!d.isBefore(from)) {
                dates.add(d);
            }
            d = r.getFrequency().next(d);
        }
        return dates;
    }

    public static BigDecimal monthlyEquivalent(BigDecimal amount, Frequency frequency) {
        BigDecimal perYear = switch (frequency) {
            case WEEKLY -> BigDecimal.valueOf(52);
            case MONTHLY -> BigDecimal.valueOf(12);
            case QUARTERLY -> BigDecimal.valueOf(4);
            case HALF_YEARLY -> BigDecimal.valueOf(2);
            case YEARLY -> BigDecimal.ONE;
        };
        return amount.multiply(perYear).divide(BigDecimal.valueOf(12), 2, RoundingMode.HALF_UP);
    }

    // ================================================================== helpers

    private void advance(RecurringTransaction r) {
        LocalDate next = r.getFrequency().next(r.getNextDueDate());
        r.setNextDueDate(next);
        if (!isWithinEnd(r, next)) {
            r.setActive(false);
        }
        recurring.save(r);
    }

    private static boolean isWithinEnd(RecurringTransaction r, LocalDate date) {
        return r.getEndDate() == null || !date.isAfter(r.getEndDate());
    }

    /**
     * Expense: debit Expenses (category), credit the paying account. Income: debit the receiving account,
     * credit Income (category). Transfer: both accounts given.
     */
    private void apply(RecurringTransaction r, RecurringRequest q) {
        Long categoryId = null;
        if (q.kind() != RecurringKind.TRANSFER) {
            CategoryKind kind = q.kind() == RecurringKind.EXPENSE ? CategoryKind.EXPENSE : CategoryKind.INCOME;
            if (q.categoryId() == null) {
                throw new BusinessException("Pick the " + kind.getLabel().toLowerCase() + " category");
            }
            categoryId = categories.require(q.categoryId(), kind).getId();
        }
        Long debitId = q.kind() == RecurringKind.EXPENSE ? ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId() : q.debitAccountId();
        Long creditId = q.kind() == RecurringKind.INCOME ? ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId() : q.creditAccountId();
        if (debitId == null || creditId == null) {
            throw new BusinessException(q.kind() == RecurringKind.INCOME ? "Pick the account the money comes into"
                    : q.kind() == RecurringKind.EXPENSE ? "Pick the account it is paid from" : "Pick both accounts");
        }
        Account debit = accounts.require(debitId);
        Account credit = accounts.require(creditId);
        if (debit.getId().equals(credit.getId())) {
            throw new BusinessException("Debit and credit accounts must differ");
        }
        validateKind(q.kind(), debit, credit);
        r.setName(q.name().trim());
        r.setKind(q.kind());
        r.setAmount(Money.round(q.amount()));
        r.setDebitAccountId(debit.getId());
        r.setCreditAccountId(credit.getId());
        r.setCategoryId(categoryId);
        r.setFrequency(q.frequency());
        r.setStartDate(q.startDate());
        r.setEndDate(q.endDate());
        LocalDate next = q.nextDueDate() != null ? q.nextDueDate()
                : r.getNextDueDate() != null ? r.getNextDueDate() : q.startDate();
        r.setNextDueDate(next);
        r.setActive(q.active() == null || q.active());
        r.setNotes(q.notes());
        if (q.endDate() != null && q.endDate().isBefore(q.startDate())) {
            throw new BusinessException("End date cannot be before the start date");
        }
    }

    private static void validateKind(RecurringKind kind, Account debit, Account credit) {
        boolean ok = switch (kind) {
            case INCOME -> credit.getAccountClass() == AccountClass.INCOME && isBalanceSheet(debit);
            case EXPENSE -> debit.getAccountClass() == AccountClass.EXPENSE && isBalanceSheet(credit);
            case TRANSFER -> isBalanceSheet(debit) && isBalanceSheet(credit);
        };
        if (!ok) {
            throw new BusinessException(switch (kind) {
                case INCOME -> "Income: deposit into an asset account and credit an income account";
                case EXPENSE -> "Expense: debit an expense account and pay from an asset or liability account";
                case TRANSFER -> "Transfer: both accounts must be asset or liability accounts";
            });
        }
    }

    private static boolean isBalanceSheet(Account a) {
        return a.getAccountClass() == AccountClass.ASSET || a.getAccountClass() == AccountClass.LIABILITY;
    }

    private RecurringTransaction require(Long id) {
        return recurring.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Recurring transaction", id));
    }
}
