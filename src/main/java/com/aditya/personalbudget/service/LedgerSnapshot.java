package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.VoucherType;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

/**
 * A read-only picture of one tenant's books for the current request: accounts, categories, chits and
 * every posted line, each line already joined with its entry date. All reports and dashboards compute from this.
 * <p>
 * Balances are returned in the natural sign: a positive asset is money you own, a positive liability is
 * money you owe, positive income is money earned, a positive expense is money spent.
 */
public final class LedgerSnapshot {

    /** A journal line flattened with its header fields. */
    public record PostedLine(Long entryId, String entryNo, LocalDate date, VoucherType voucherType,
                             String narration, Long accountId, Long categoryId, Long chitId,
                             BigDecimal debit, BigDecimal credit) {

        /** Debit minus credit. */
        public BigDecimal net() {
            return debit.subtract(credit);
        }
    }

    private final Map<Long, Account> accounts;
    private final Map<Long, Category> categories;
    private final Map<Long, Chit> chits;
    private final List<PostedLine> lines;
    /** {@link #lines} plus the cash paid into chits, as Chit Payments lines (built on first use). */
    private List<PostedLine> budgetLines;

    public LedgerSnapshot(Collection<Account> accounts, Collection<JournalEntry> entries, Collection<JournalLine> lines,
                          Collection<Category> categories, Collection<Chit> chits) {
        this.accounts = accounts.stream().collect(Collectors.toMap(Account::getId, Function.identity()));
        this.categories = categories.stream().collect(Collectors.toMap(Category::getId, Function.identity()));
        this.chits = chits.stream().collect(Collectors.toMap(Chit::getId, Function.identity()));
        Map<Long, JournalEntry> entryById = entries.stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        this.lines = lines.stream()
                .filter(l -> entryById.containsKey(l.getJournalEntryId()))
                .map(l -> {
                    JournalEntry e = entryById.get(l.getJournalEntryId());
                    return new PostedLine(e.getId(), e.getEntryNo(), e.getEntryDate(), e.getVoucherType(),
                            e.getNarration(), l.getAccountId(), l.getCategoryId(), l.getChitId(), l.getDebit(), l.getCredit());
                })
                .toList();
    }

    public Map<Long, Account> accounts() {
        return accounts;
    }

    public Account account(Long id) {
        return accounts.get(id);
    }

    public Map<Long, Category> categories() {
        return categories;
    }

    public Category category(Long id) {
        return id == null ? null : categories.get(id);
    }

    public List<Category> categoriesOf(CategoryKind kind) {
        return categories.values().stream().filter(c -> c.getKind() == kind)
                .sorted(java.util.Comparator.comparing(Category::getCode)).toList();
    }

    public Chit chit(Long id) {
        return id == null ? null : chits.get(id);
    }

    public List<PostedLine> lines() {
        return lines;
    }

    public List<Account> accountsOfClass(AccountClass accountClass) {
        return accounts.values().stream().filter(a -> a.getAccountClass() == accountClass).toList();
    }

    /** What a line is about: its category or chit when it has one, else its account. */
    public String displayName(PostedLine line) {
        Category category = category(line.categoryId());
        if (category != null) {
            return category.getName();
        }
        Chit chit = chit(line.chitId());
        if (chit != null) {
            return chit.getName();
        }
        Account account = account(line.accountId());
        return account == null ? "?" : account.getName();
    }

    // ------------------------------------------------------------------ balances

    /** Natural-sign balance of every account, counting entries dated on or before {@code asOf}. */
    public Map<Long, BigDecimal> balancesAsOf(LocalDate asOf) {
        return sumBy(l -> !l.date().isAfter(asOf));
    }

    /** Natural-sign movement of every account between two dates (inclusive). */
    public Map<Long, BigDecimal> movementsBetween(LocalDate from, LocalDate to) {
        return sumBy(l -> !l.date().isBefore(from) && !l.date().isAfter(to));
    }

    public BigDecimal balanceAsOf(Long accountId, LocalDate asOf) {
        return balancesAsOf(asOf).getOrDefault(accountId, Money.ZERO);
    }

    /** Sum of natural-sign balances for all accounts of a class. */
    public BigDecimal totalOfClass(Map<Long, BigDecimal> balances, AccountClass accountClass) {
        return balances.entrySet().stream()
                .filter(e -> accounts.containsKey(e.getKey())
                        && accounts.get(e.getKey()).getAccountClass() == accountClass)
                .map(Map.Entry::getValue)
                .reduce(Money.ZERO, BigDecimal::add);
    }

    /** Assets minus liabilities as of a date. */
    public BigDecimal netWorthAsOf(LocalDate asOf) {
        Map<Long, BigDecimal> balances = balancesAsOf(asOf);
        return totalOfClass(balances, AccountClass.ASSET).subtract(totalOfClass(balances, AccountClass.LIABILITY));
    }

    /** Converts a raw debit-minus-credit figure into the account's natural sign. */
    public BigDecimal natural(Long accountId, BigDecimal debitMinusCredit) {
        Account account = accounts.get(accountId);
        boolean debitNormal = account == null || account.getAccountClass().isDebitNormal();
        return debitNormal ? debitMinusCredit : debitMinusCredit.negate();
    }

    // ------------------------------------------------------------------ categories and chits

    /** Natural-sign amount per category between two dates: money spent for expense, earned for income. */
    public Map<Long, BigDecimal> categoryMovements(LocalDate from, LocalDate to) {
        return categoryMovements(lines, from, to);
    }

    private Map<Long, BigDecimal> categoryMovements(List<PostedLine> source, LocalDate from, LocalDate to) {
        Map<Long, BigDecimal> raw = new HashMap<>();
        for (PostedLine line : source) {
            if (line.categoryId() != null && !line.date().isBefore(from) && !line.date().isAfter(to)) {
                raw.merge(line.categoryId(), line.net(), BigDecimal::add);
            }
        }
        Map<Long, BigDecimal> result = new HashMap<>();
        raw.forEach((id, value) -> {
            Category c = categories.get(id);
            result.put(id, Money.round(c != null && c.getKind() == CategoryKind.INCOME ? value.negate() : value));
        });
        return result;
    }

    // ------------------------------------------------------------------ budget view

    /** A category only the budget uses (Chit Payments): reports and forecasts of spending leave it out. */
    public static boolean budgetOnly(Category c) {
        return c != null && DefaultChartOfAccounts.CHIT_PAYMENTS.equals(c.getSystemKey());
    }

    /** The Chit Payments category (budget only), or null for books without it. */
    public Category chitPaymentsCategory() {
        return categories.values().stream()
                .filter(c -> DefaultChartOfAccounts.CHIT_PAYMENTS.equals(c.getSystemKey()))
                .findFirst().orElse(null);
    }

    /**
     * What the budget looks at: every categorised line, plus one Chit Payments line per chit installment for the
     * cash it took from the bank (the installment less its dividend). In the books an installment is savings in
     * Chit Funds, so these extra lines never reach the income statement; they only let chits be budgeted.
     */
    public List<PostedLine> budgetLines() {
        if (budgetLines == null) {
            Category chitPayments = chitPaymentsCategory();
            if (chitPayments == null) {
                budgetLines = lines;
            } else {
                Map<Long, List<PostedLine>> installments = lines.stream()
                        .filter(l -> l.voucherType() == VoucherType.CHIT_INSTALLMENT)
                        .collect(Collectors.groupingBy(PostedLine::entryId, java.util.LinkedHashMap::new, Collectors.toList()));
                List<PostedLine> all = new java.util.ArrayList<>(lines);
                installments.values().forEach(entry -> {
                    PostedLine paidFrom = entry.stream()
                            .filter(l -> l.categoryId() == null && l.chitId() == null && l.credit().signum() > 0)
                            .findFirst().orElse(null);
                    if (paidFrom == null) {
                        return;   // all of it covered by the dividend: nothing left the bank
                    }
                    BigDecimal cash = entry.stream()
                            .filter(l -> l.categoryId() == null && l.chitId() == null)
                            .map(l -> l.credit().subtract(l.debit()))
                            .reduce(Money.ZERO, BigDecimal::add);
                    Long chitId = entry.stream().map(PostedLine::chitId).filter(java.util.Objects::nonNull).findFirst().orElse(null);
                    all.add(new PostedLine(paidFrom.entryId(), paidFrom.entryNo(), paidFrom.date(), paidFrom.voucherType(),
                            paidFrom.narration(), paidFrom.accountId(), chitPayments.getId(), chitId, cash, Money.ZERO));
                });
                budgetLines = List.copyOf(all);
            }
        }
        return budgetLines;
    }

    /** Like {@link #categoryMovements}, with the cash paid into chits under Chit Payments. */
    public Map<Long, BigDecimal> budgetMovements(LocalDate from, LocalDate to) {
        return categoryMovements(budgetLines(), from, to);
    }

    /** Balance of each chit's sub-ledger (paid in; negative after a prize with dues still to pay). */
    public Map<Long, BigDecimal> chitBalancesAsOf(LocalDate asOf) {
        Map<Long, BigDecimal> result = new HashMap<>();
        for (PostedLine line : lines) {
            if (line.chitId() != null && !line.date().isAfter(asOf)) {
                result.merge(line.chitId(), line.net(), BigDecimal::add);
            }
        }
        result.replaceAll((id, v) -> Money.round(v));
        return result;
    }

    public BigDecimal chitBalanceAsOf(Long chitId, LocalDate asOf) {
        return chitBalancesAsOf(asOf).getOrDefault(chitId, Money.ZERO);
    }

    private Map<Long, BigDecimal> sumBy(Predicate<PostedLine> filter) {
        Map<Long, BigDecimal> raw = new HashMap<>();
        for (PostedLine line : lines) {
            if (filter.test(line)) {
                raw.merge(line.accountId(), line.net(), BigDecimal::add);
            }
        }
        Map<Long, BigDecimal> result = new HashMap<>();
        raw.forEach((id, value) -> result.put(id, Money.round(natural(id, value))));
        return result;
    }
}
