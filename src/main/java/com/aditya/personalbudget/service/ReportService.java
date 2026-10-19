package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.dto.ReportDtos.AccountAmount;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.dto.ReportDtos.BalanceSheet;
import com.aditya.personalbudget.dto.ReportDtos.CashFlow;
import com.aditya.personalbudget.dto.ReportDtos.CashFlowMonth;
import com.aditya.personalbudget.dto.ReportDtos.CategoryShare;
import com.aditya.personalbudget.dto.ReportDtos.ExpenseAnalysis;
import com.aditya.personalbudget.dto.ReportDtos.IncomeStatement;
import com.aditya.personalbudget.dto.ReportDtos.LedgerRow;
import com.aditya.personalbudget.dto.ReportDtos.MonthPoint;
import com.aditya.personalbudget.dto.ReportDtos.SheetGroup;
import com.aditya.personalbudget.dto.ReportDtos.SheetSection;
import com.aditya.personalbudget.dto.ReportDtos.TrialBalance;
import com.aditya.personalbudget.dto.ReportDtos.TrialBalanceRow;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import com.aditya.personalbudget.exception.NotFoundException;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Financial statements and analysis, all computed from a {@link LedgerSnapshot}.
 */
@Service
public class ReportService {

    private final LedgerService ledger;

    public ReportService(LedgerService ledger) {
        this.ledger = ledger;
    }

    // ================================================================== trial balance

    public TrialBalance trialBalance(LocalDate asOf) {
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, BigDecimal> raw = new LinkedHashMap<>();
        for (PostedLine l : books.lines()) {
            if (!l.date().isAfter(asOf)) {
                raw.merge(l.accountId(), l.net(), BigDecimal::add);
            }
        }
        List<TrialBalanceRow> rows = books.accounts().values().stream()
                .filter(a -> raw.containsKey(a.getId()) && raw.get(a.getId()).signum() != 0)
                .sorted(Comparator.comparing(Account::getCode))
                .map(a -> {
                    BigDecimal net = Money.round(raw.get(a.getId()));
                    return new TrialBalanceRow(a.getId(), a.getCode(), a.getName(), a.getAccountClass(),
                            net.signum() > 0 ? net : Money.ZERO, net.signum() < 0 ? net.negate() : Money.ZERO);
                })
                .toList();
        BigDecimal debit = rows.stream().map(TrialBalanceRow::debit).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal credit = rows.stream().map(TrialBalanceRow::credit).reduce(Money.ZERO, BigDecimal::add);
        return new TrialBalance(asOf, rows, debit, credit, debit.compareTo(credit) == 0);
    }

    // ================================================================== income statement

    public IncomeStatement incomeStatement(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, BigDecimal> moves = books.movementsBetween(from, to);
        Map<Long, BigDecimal> byCategory = books.categoryMovements(from, to);
        List<AccountAmount> income = amountsOfKind(books, moves, byCategory, CategoryKind.INCOME);
        List<AccountAmount> expenses = amountsOfKind(books, moves, byCategory, CategoryKind.EXPENSE);
        BigDecimal totalIncome = total(income);
        BigDecimal totalExpenses = total(expenses);
        BigDecimal net = totalIncome.subtract(totalExpenses);
        return new IncomeStatement(from, to, income, expenses, totalIncome, totalExpenses, net,
                Money.percent(net, totalIncome));
    }

    // ================================================================== balance sheet

    /**
     * Assets = Liabilities + Equity, where equity includes the accumulated surplus
     * (all income minus all expenses up to the date). Chit accounts with a credit balance
     * (prize taken, installments still due) are shown as liabilities. Every figure is also given on a
     * comparison date (default: end of the previous month), and health ratios are added.
     */
    public BalanceSheet balanceSheet(LocalDate asOf, LocalDate compareTo) {
        LedgerSnapshot books = ledger.snapshot();
        LocalDate compareDate = compareTo != null ? compareTo : asOf.withDayOfMonth(1).minusDays(1);
        Map<Long, BigDecimal> now = books.balancesAsOf(asOf);
        Map<Long, BigDecimal> before = books.balancesAsOf(compareDate);

        List<AccountAmount> assetRows = new ArrayList<>();
        List<AccountAmount> liabilityRows = new ArrayList<>();
        List<AccountAmount> equityRows = new ArrayList<>();
        Map<Long, BigDecimal> chitsNow = books.chitBalancesAsOf(asOf);
        Map<Long, BigDecimal> chitsBefore = books.chitBalancesAsOf(compareDate);
        for (Account a : sortedAccounts(books)) {
            if (a.getAccountType() == AccountType.CHIT_FUND) {
                chitRows(books, a, now, before, chitsNow, chitsBefore, assetRows, liabilityRows);
                continue;
            }
            BigDecimal value = now.getOrDefault(a.getId(), Money.ZERO);
            BigDecimal previous = before.getOrDefault(a.getId(), Money.ZERO);
            if (value.signum() == 0 && previous.signum() == 0) {
                continue;
            }
            switch (a.getAccountClass()) {
                case ASSET -> assetRows.add(amount(a, value, previous));
                case LIABILITY -> liabilityRows.add(amount(a, value, previous));
                case EQUITY -> equityRows.add(amount(a, value, previous));
                default -> { /* income & expense roll into the surplus below */ }
            }
        }
        equityRows.add(new AccountAmount(null, "", "Accumulated Surplus (Income - Expenses)", AccountType.EQUITY,
                surplus(books, now), surplus(books, before)));

        SheetSection assets = section("Assets", assetRows);
        SheetSection liabilities = section("Liabilities", liabilityRows);
        SheetSection equity = new SheetSection("Equity", total(equityRows), previousTotal(equityRows),
                List.of(new SheetGroup("Owner's Equity", total(equityRows), previousTotal(equityRows), equityRows)));

        BigDecimal netWorth = assets.total().subtract(liabilities.total());
        BigDecimal previousNetWorth = assets.previous().subtract(liabilities.previous());
        BigDecimal liquid = sumBucket(assetRows, "Liquid money");
        BigDecimal investments = sumBucket(assetRows, "Investments");
        BigDecimal shortTerm = sumBucket(liabilityRows, "Short-term dues");
        BigDecimal longTerm = liabilities.total().subtract(shortTerm);

        YearMonth month = YearMonth.from(asOf);
        Map<Long, BigDecimal> lastThreeMonths = books.movementsBetween(month.minusMonths(3).atDay(1),
                month.minusMonths(1).atEndOfMonth());
        BigDecimal avgExpense = books.totalOfClass(lastThreeMonths, AccountClass.EXPENSE)
                .divide(BigDecimal.valueOf(3), 2, RoundingMode.HALF_UP);

        BigDecimal lAndE = liabilities.total().add(equity.total());
        return new BalanceSheet(asOf, compareDate, assets, liabilities, equity,
                netWorth, previousNetWorth, netWorth.subtract(previousNetWorth),
                previousNetWorth.signum() == 0 ? BigDecimal.ZERO : Money.percent(netWorth.subtract(previousNetWorth), previousNetWorth.abs()),
                lAndE, assets.total().compareTo(lAndE) == 0,
                liquid, Money.percent(liabilities.total(), assets.total()), Money.percent(liabilities.total(), netWorth),
                ratio(liquid, shortTerm), ratio(liquid, avgExpense), avgExpense, Money.percent(investments, assets.total()),
                shortTerm, longTerm, mix(assetRows), mix(liabilityRows), netWorthTrend(books, asOf));
    }

    /**
     * Each chit is its own row: paid in so far is an asset; a prized chit with dues still to pay (a credit
     * balance) is a liability. Anything on the Chit Funds account without a chit stays as one asset row.
     */
    private static void chitRows(LedgerSnapshot books, Account fund, Map<Long, BigDecimal> now, Map<Long, BigDecimal> before,
                                 Map<Long, BigDecimal> chitsNow, Map<Long, BigDecimal> chitsBefore,
                                 List<AccountAmount> assetRows, List<AccountAmount> liabilityRows) {
        Set<Long> ids = new java.util.TreeSet<>(chitsNow.keySet());
        ids.addAll(chitsBefore.keySet());
        BigDecimal restNow = now.getOrDefault(fund.getId(), Money.ZERO);
        BigDecimal restBefore = before.getOrDefault(fund.getId(), Money.ZERO);
        for (Long id : ids) {
            BigDecimal value = chitsNow.getOrDefault(id, Money.ZERO);
            BigDecimal previous = chitsBefore.getOrDefault(id, Money.ZERO);
            restNow = restNow.subtract(value);
            restBefore = restBefore.subtract(previous);
            if (value.signum() == 0 && previous.signum() == 0) {
                continue;
            }
            String name = books.chit(id) == null ? "Chit #" + id : "Chit - " + books.chit(id).getName();
            if (value.signum() < 0) {
                liabilityRows.add(new AccountAmount(fund.getId(), fund.getCode(), name, AccountType.CHIT_FUND,
                        value.negate(), previous.signum() < 0 ? previous.negate() : Money.ZERO));
            } else {
                assetRows.add(new AccountAmount(fund.getId(), fund.getCode(), name, AccountType.CHIT_FUND,
                        value, previous.max(Money.ZERO)));
            }
        }
        if (restNow.signum() != 0 || restBefore.signum() != 0) {
            assetRows.add(amount(fund, restNow, restBefore));
        }
    }

    /** Net worth at the last 11 month-ends and on {@code asOf}. */
    private static List<ValuePoint> netWorthTrend(LedgerSnapshot books, LocalDate asOf) {
        List<ValuePoint> points = new ArrayList<>();
        YearMonth month = YearMonth.from(asOf);
        for (int i = 11; i >= 1; i--) {
            LocalDate end = month.minusMonths(i).atEndOfMonth();
            points.add(new ValuePoint(end.toString(), books.netWorthAsOf(end)));
        }
        points.add(new ValuePoint(asOf.toString(), books.netWorthAsOf(asOf)));
        return points;
    }

    /** Groups an account type into a broad bucket used for the asset / liability mix. */
    public static String bucket(AccountType type) {
        return switch (type) {
            case CASH, BANK, WALLET -> "Liquid money";
            case FIXED_DEPOSIT, RECURRING_DEPOSIT, SAVINGS_SCHEME, MUTUAL_FUND, STOCKS, BONDS, INSURANCE_POLICY ->
                    "Investments";
            case CHIT_FUND -> "Chits";
            case GOLD, SILVER -> "Gold & silver";
            case REAL_ESTATE, VEHICLE -> "Property & vehicles";
            case RECEIVABLE, LOAN_GIVEN -> "Money owed to you";
            case CREDIT_CARD, PAYABLE, OTHER_LIABILITY -> "Short-term dues";
            case HOME_LOAN, VEHICLE_LOAN, PERSONAL_LOAN, GOLD_LOAN, EDUCATION_LOAN, LOAN -> "Loans";
            default -> "Other";
        };
    }

    private static BigDecimal surplus(LedgerSnapshot books, Map<Long, BigDecimal> balances) {
        return books.totalOfClass(balances, AccountClass.INCOME).subtract(books.totalOfClass(balances, AccountClass.EXPENSE));
    }

    private static BigDecimal sumBucket(List<AccountAmount> rows, String bucket) {
        return rows.stream()
                .filter(r -> bucket.equals(bucket(r.accountType()))
                        || ("Short-term dues".equals(bucket) && r.accountType() == AccountType.CHIT_FUND))
                .map(AccountAmount::amount).reduce(Money.ZERO, BigDecimal::add);
    }

    private static List<ValuePoint> mix(List<AccountAmount> rows) {
        Map<String, BigDecimal> totals = new LinkedHashMap<>();
        rows.forEach(r -> totals.merge(bucket(r.accountType()), r.amount(), BigDecimal::add));
        return totals.entrySet().stream()
                .filter(e -> e.getValue().signum() > 0)
                .map(e -> new ValuePoint(e.getKey(), e.getValue()))
                .sorted(Comparator.comparing(ValuePoint::value).reversed())
                .toList();
    }

    private static BigDecimal ratio(BigDecimal a, BigDecimal b) {
        return b == null || b.signum() == 0 ? null : a.divide(b, 2, RoundingMode.HALF_UP);
    }

    // ================================================================== account ledger

    public AccountLedger accountLedger(Long accountId, LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        Account account = books.account(accountId);
        if (account == null) {
            throw new NotFoundException("Account", accountId);
        }
        BigDecimal opening = books.balanceAsOf(accountId, from.minusDays(1));

        Map<Long, List<PostedLine>> linesByEntry = books.lines().stream()
                .collect(Collectors.groupingBy(PostedLine::entryId));
        List<PostedLine> own = books.lines().stream()
                .filter(l -> l.accountId().equals(accountId) && !l.date().isBefore(from) && !l.date().isAfter(to))
                .sorted(Comparator.comparing(PostedLine::date).thenComparing(PostedLine::entryId))
                .toList();

        BigDecimal running = opening;
        BigDecimal totalDebit = Money.ZERO;
        BigDecimal totalCredit = Money.ZERO;
        List<LedgerRow> rows = new ArrayList<>();
        for (PostedLine l : own) {
            running = running.add(books.natural(accountId, l.net()));
            totalDebit = totalDebit.add(l.debit());
            totalCredit = totalCredit.add(l.credit());
            String counter = linesByEntry.get(l.entryId()).stream()
                    .filter(o -> o != l && (!o.accountId().equals(accountId) || o.categoryId() != null || o.chitId() != null))
                    .map(books::displayName)
                    .distinct()
                    .collect(Collectors.joining(", "));
            rows.add(new LedgerRow(l.entryId(), l.entryNo(), l.date(), l.voucherType(), l.voucherType().getLabel(), l.narration(),
                    counter, l.debit(), l.credit(), running));
        }
        return new AccountLedger(accountId, account.getCode(), account.getName(), account.getAccountClass(), from, to,
                opening, totalDebit, totalCredit, running, rows);
    }

    // ================================================================== expense analysis

    public ExpenseAnalysis expenseAnalysis(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        List<YearMonth> months = monthsBetween(from, to);
        List<String> labels = months.stream().map(YearMonth::toString).toList();

        List<CategoryShare> categories = new ArrayList<>();
        BigDecimal grandTotal = Money.ZERO;
        Map<Long, Map<YearMonth, BigDecimal>> perAccount = new LinkedHashMap<>();
        for (PostedLine l : books.lines()) {
            Account a = books.account(l.accountId());
            if (a.getAccountClass() == AccountClass.EXPENSE && !l.date().isBefore(from) && !l.date().isAfter(to)) {
                // keyed by category; 0 collects anything posted without one
                perAccount.computeIfAbsent(l.categoryId() == null ? 0L : l.categoryId(), k -> new LinkedHashMap<>())
                        .merge(YearMonth.from(l.date()), l.net(), BigDecimal::add);
            }
        }
        for (Map.Entry<Long, Map<YearMonth, BigDecimal>> e : perAccount.entrySet()) {
            List<BigDecimal> byMonth = months.stream().map(m -> Money.round(e.getValue().getOrDefault(m, Money.ZERO))).toList();
            BigDecimal sum = byMonth.stream().reduce(Money.ZERO, BigDecimal::add);
            if (sum.signum() == 0) {
                continue;
            }
            grandTotal = grandTotal.add(sum);
            String name = books.category(e.getKey()) == null ? "Uncategorised" : books.category(e.getKey()).getName();
            categories.add(new CategoryShare(e.getKey() == 0L ? null : e.getKey(), name, sum, null,
                    sum.divide(BigDecimal.valueOf(months.size()), 2, RoundingMode.HALF_UP), byMonth));
        }
        BigDecimal total = grandTotal;
        List<CategoryShare> withPercent = categories.stream()
                .map(c -> new CategoryShare(c.accountId(), c.name(), c.amount(), Money.percent(c.amount(), total),
                        c.monthlyAverage(), c.byMonth()))
                .sorted(Comparator.comparing(CategoryShare::amount).reversed())
                .toList();

        List<ValuePoint> top = books.lines().stream()
                .filter(l -> books.account(l.accountId()).getAccountClass() == AccountClass.EXPENSE
                        && !l.date().isBefore(from) && !l.date().isAfter(to) && l.debit().signum() > 0)
                .sorted(Comparator.comparing(PostedLine::debit).reversed())
                .limit(10)
                .map(l -> new ValuePoint(l.date() + "  " + l.narration() + "  ·  " + books.displayName(l), l.debit()))
                .toList();

        return new ExpenseAnalysis(from, to, labels, total,
                total.divide(BigDecimal.valueOf(months.size()), 2, RoundingMode.HALF_UP), withPercent, top);
    }

    // ================================================================== cash flow

    /** Month-by-month movement of liquid money (cash, bank, wallet). Transfers between them cancel out. */
    public CashFlow cashFlow(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        Set<Long> liquid = books.accounts().values().stream()
                .filter(a -> a.getAccountType().isLiquid()).map(Account::getId).collect(Collectors.toSet());

        Map<Long, List<PostedLine>> byEntry = books.lines().stream().collect(Collectors.groupingBy(PostedLine::entryId));
        BigDecimal opening = liquid.stream().map(id -> books.balanceAsOf(id, from.minusDays(1)))
                .reduce(Money.ZERO, BigDecimal::add);

        List<CashFlowMonth> rows = new ArrayList<>();
        BigDecimal totalIn = Money.ZERO;
        BigDecimal totalOut = Money.ZERO;
        for (YearMonth m : monthsBetween(from, to)) {
            LocalDate start = m.atDay(1).isBefore(from) ? from : m.atDay(1);
            LocalDate end = m.atEndOfMonth().isAfter(to) ? to : m.atEndOfMonth();
            BigDecimal in = Money.ZERO;
            BigDecimal out = Money.ZERO;
            for (List<PostedLine> entry : byEntry.values()) {
                LocalDate d = entry.getFirst().date();
                if (d.isBefore(start) || d.isAfter(end)) {
                    continue;
                }
                BigDecimal net = entry.stream().filter(l -> liquid.contains(l.accountId()))
                        .map(PostedLine::net).reduce(Money.ZERO, BigDecimal::add);
                if (net.signum() > 0) {
                    in = in.add(net);
                } else {
                    out = out.add(net.negate());
                }
            }
            BigDecimal closing = opening.add(in).subtract(out);
            rows.add(new CashFlowMonth(m.toString(), opening, in, out, in.subtract(out), closing));
            totalIn = totalIn.add(in);
            totalOut = totalOut.add(out);
            opening = closing;
        }
        return new CashFlow(from, to, rows, totalIn, totalOut);
    }

    // ================================================================== trends (dashboard & reports)

    public List<MonthPoint> monthlyTrend(LedgerSnapshot books, YearMonth last, int count) {
        List<MonthPoint> points = new ArrayList<>();
        for (int i = count - 1; i >= 0; i--) {
            YearMonth m = last.minusMonths(i);
            Map<Long, BigDecimal> moves = books.movementsBetween(m.atDay(1), m.atEndOfMonth());
            BigDecimal income = books.totalOfClass(moves, AccountClass.INCOME);
            BigDecimal expense = books.totalOfClass(moves, AccountClass.EXPENSE);
            points.add(new MonthPoint(m.toString(), income, expense, income.subtract(expense)));
        }
        return points;
    }

    public List<ValuePoint> netWorthTrend(LedgerSnapshot books, YearMonth last, int count) {
        List<ValuePoint> points = new ArrayList<>();
        for (int i = count - 1; i >= 0; i--) {
            YearMonth m = last.minusMonths(i);
            points.add(new ValuePoint(m.toString(), books.netWorthAsOf(m.atEndOfMonth())));
        }
        return points;
    }

    // ================================================================== helpers

    public static List<YearMonth> monthsBetween(LocalDate from, LocalDate to) {
        List<YearMonth> months = new ArrayList<>();
        for (YearMonth m = YearMonth.from(from); !m.isAfter(YearMonth.from(to)); m = m.plusMonths(1)) {
            months.add(m);
        }
        return months;
    }

    private static List<Account> sortedAccounts(LedgerSnapshot books) {
        return books.accounts().values().stream().sorted(Comparator.comparing(Account::getCode)).toList();
    }

    /**
     * One row per category of the kind, plus an "Uncategorised" row for whatever is on the Expenses / Income
     * account without a category, so the rows always add up to the account total.
     */
    private static List<AccountAmount> amountsOfKind(LedgerSnapshot books, Map<Long, BigDecimal> moves,
                                                     Map<Long, BigDecimal> byCategory, CategoryKind kind) {
        AccountType type = kind == CategoryKind.EXPENSE ? AccountType.EXPENSE : AccountType.INCOME;
        List<AccountAmount> rows = new ArrayList<>(books.categoriesOf(kind).stream()
                .filter(c -> byCategory.getOrDefault(c.getId(), Money.ZERO).signum() != 0)
                .map(c -> new AccountAmount(c.getId(), c.getCode(), c.getName(), type, byCategory.get(c.getId()), null))
                .sorted(Comparator.comparing(AccountAmount::amount).reversed())
                .toList());
        BigDecimal rest = books.totalOfClass(moves, kind.getAccountClass()).subtract(total(rows));
        if (rest.signum() != 0) {
            rows.add(new AccountAmount(null, "", "Uncategorised", type, rest, null));
        }
        return rows;
    }

    private static AccountAmount amount(Account a, BigDecimal value) {
        return amount(a, value, null);
    }

    private static AccountAmount amount(Account a, BigDecimal value, BigDecimal previous) {
        return new AccountAmount(a.getId(), a.getCode(), a.getName(), a.getAccountType(), value, previous);
    }

    private static BigDecimal previousTotal(List<AccountAmount> rows) {
        return rows.stream().map(r -> Money.nz(r.previous())).reduce(Money.ZERO, BigDecimal::add);
    }

    private static BigDecimal total(List<AccountAmount> rows) {
        return rows.stream().map(AccountAmount::amount).reduce(Money.ZERO, BigDecimal::add);
    }

    /** Groups rows by account type label, keeping the enum order of types. */
    private static SheetSection section(String label, List<AccountAmount> rows) {
        Map<AccountType, List<AccountAmount>> byType = rows.stream()
                .collect(Collectors.groupingBy(AccountAmount::accountType, () -> new java.util.TreeMap<>(), Collectors.toList()));
        List<SheetGroup> groups = byType.entrySet().stream()
                .map(e -> new SheetGroup(e.getKey().getLabel(), total(e.getValue()), previousTotal(e.getValue()), e.getValue()))
                .toList();
        return new SheetSection(label, total(rows), previousTotal(rows), groups);
    }
}
