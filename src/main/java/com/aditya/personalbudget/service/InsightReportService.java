package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.InsightReportDtos.AccountInsight;
import com.aditya.personalbudget.dto.InsightReportDtos.CategoryInsight;
import com.aditya.personalbudget.dto.InsightReportDtos.ChitInsight;
import com.aditya.personalbudget.dto.InsightReportDtos.ChitTotals;
import com.aditya.personalbudget.dto.InsightReportDtos.Highlight;
import com.aditya.personalbudget.dto.InsightReportDtos.InsightReport;
import com.aditya.personalbudget.dto.InsightReportDtos.Period;
import com.aditya.personalbudget.dto.InsightReportDtos.Summary;
import com.aditya.personalbudget.dto.ReportDtos.MonthPoint;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The Insights report: what changed in a period compared with the period just before it, by category,
 * account, chit and payee, and the few things worth acting on.
 */
@Service
public class InsightReportService {

    private static final long IDLE_DAYS = 90;

    private final LedgerService ledger;
    private final ChitService chits;
    private final BudgetService budgets;
    private final JournalEntryRepository entries;

    public InsightReportService(LedgerService ledger, ChitService chits, BudgetService budgets,
                                JournalEntryRepository entries) {
        this.ledger = ledger;
        this.chits = chits;
        this.budgets = budgets;
        this.entries = entries;
    }

    public InsightReport build(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        int days = (int) ChronoUnit.DAYS.between(from, to) + 1;
        LocalDate prevTo = from.minusDays(1);
        LocalDate prevFrom = prevTo.minusDays(days - 1L);
        Period period = new Period(from, to, prevFrom, prevTo, days);
        Map<Long, JournalEntry> entryById = entries.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        List<YearMonth> months = ReportService.monthsBetween(from, to);

        List<CategoryInsight> expense = categories(books, CategoryKind.EXPENSE, from, to, prevFrom, prevTo, months, days);
        List<CategoryInsight> income = categories(books, CategoryKind.INCOME, from, to, prevFrom, prevTo, months, days);
        Summary summary = summary(books, entryById, from, to, prevFrom, prevTo, days);
        List<AccountInsight> accounts = accounts(books, from, to);
        List<ChitView> chitViews = chits.list();
        List<ChitInsight> chitRows = chits(books, chitViews, from, to);
        ChitTotals chitTotals = chitTotals(chitRows);

        List<MonthPoint> monthly = months.stream().map(m -> {
            LocalDate start = m.atDay(1).isBefore(from) ? from : m.atDay(1);
            LocalDate end = m.atEndOfMonth().isAfter(to) ? to : m.atEndOfMonth();
            Map<Long, BigDecimal> moves = books.movementsBetween(start, end);
            BigDecimal in = books.totalOfClass(moves, AccountClass.INCOME);
            BigDecimal out = books.totalOfClass(moves, AccountClass.EXPENSE);
            return new MonthPoint(m.toString(), in, out, in.subtract(out));
        }).toList();

        List<PostedLine> spending = books.lines().stream()
                .filter(l -> inRange(l.date(), from, to) && isExpense(books, l) && l.debit().signum() > 0)
                .toList();
        List<ValuePoint> payees = topPayees(books, spending, entryById);
        List<ValuePoint> weekdays = weekdaySpend(books, spending);
        List<ValuePoint> largest = spending.stream()
                .sorted(Comparator.comparing(PostedLine::debit).reversed())
                .limit(8)
                .map(l -> new ValuePoint(l.date() + "  " + l.narration() + "  ·  " + books.displayName(l), l.debit()))
                .toList();

        return new InsightReport(period, summary, monthly, expense, income, accounts, chitRows, chitTotals,
                payees, weekdays, largest,
                highlights(summary, expense, income, accounts, chitRows, chitViews, weekdays, days));
    }

    // ================================================================== summary

    private Summary summary(LedgerSnapshot books, Map<Long, JournalEntry> entryById, LocalDate from, LocalDate to,
                            LocalDate prevFrom, LocalDate prevTo, int days) {
        Map<Long, BigDecimal> now = books.movementsBetween(from, to);
        Map<Long, BigDecimal> before = books.movementsBetween(prevFrom, prevTo);
        BigDecimal income = books.totalOfClass(now, AccountClass.INCOME);
        BigDecimal expense = books.totalOfClass(now, AccountClass.EXPENSE);
        BigDecimal prevIncome = books.totalOfClass(before, AccountClass.INCOME);
        BigDecimal prevExpense = books.totalOfClass(before, AccountClass.EXPENSE);
        BigDecimal netWorth = books.netWorthAsOf(to);
        // fixed: spending posted by a recurring schedule (subscriptions, fees, rent ...)
        BigDecimal fixed = books.lines().stream()
                .filter(l -> inRange(l.date(), from, to) && isExpense(books, l))
                .filter(l -> {
                    JournalEntry e = entryById.get(l.entryId());
                    return e != null && LedgerService.SOURCE_RECURRING.equals(e.getSourceType());
                })
                .map(PostedLine::net).reduce(Money.ZERO, BigDecimal::add);
        long count = books.lines().stream().filter(l -> inRange(l.date(), from, to))
                .map(PostedLine::entryId).distinct().count();
        return new Summary(income, expense, income.subtract(expense), Money.percent(income.subtract(expense), income),
                prevIncome, prevExpense, prevIncome.subtract(prevExpense),
                change(income, prevIncome), change(expense, prevExpense),
                expense.divide(BigDecimal.valueOf(days), 2, RoundingMode.HALF_UP),
                netWorth, netWorth.subtract(books.netWorthAsOf(from.minusDays(1))), count,
                Money.percent(fixed, expense));
    }

    // ================================================================== categories

    private List<CategoryInsight> categories(LedgerSnapshot books, CategoryKind kind, LocalDate from, LocalDate to,
                                             LocalDate prevFrom, LocalDate prevTo, List<YearMonth> months, int days) {
        Map<Long, BigDecimal> now = books.categoryMovements(from, to);
        Map<Long, BigDecimal> before = books.categoryMovements(prevFrom, prevTo);
        BigDecimal total = books.categoriesOf(kind).stream().map(c -> now.getOrDefault(c.getId(), Money.ZERO))
                .reduce(Money.ZERO, BigDecimal::add);
        Map<Long, BigDecimal> limits = kind == CategoryKind.EXPENSE
                ? budgets.all().stream().collect(Collectors.toMap(Budget::getCategoryId, Budget::getMonthlyLimit, (a, b) -> a))
                : Map.of();
        BigDecimal monthsInPeriod = BigDecimal.valueOf(days).divide(BigDecimal.valueOf(30.4375), 4, RoundingMode.HALF_UP);

        Map<Long, List<PostedLine>> linesByCategory = books.lines().stream()
                .filter(l -> l.categoryId() != null && inRange(l.date(), from, to))
                .collect(Collectors.groupingBy(PostedLine::categoryId));
        List<CategoryInsight> rows = new ArrayList<>();
        for (Category c : books.categoriesOf(kind)) {
            if (LedgerSnapshot.budgetOnly(c)) {
                continue;   // chit installments are savings, shown in the Chits report
            }
            BigDecimal amount = now.getOrDefault(c.getId(), Money.ZERO);
            BigDecimal previous = before.getOrDefault(c.getId(), Money.ZERO);
            BigDecimal limit = limits.get(c.getId());
            if (amount.signum() == 0 && previous.signum() == 0 && limit == null) {
                continue;
            }
            List<PostedLine> own = linesByCategory.getOrDefault(c.getId(), List.of());
            int count = (int) own.stream().map(PostedLine::entryId).distinct().count();
            BigDecimal largest = own.stream().map(l -> l.net().abs()).max(Comparator.naturalOrder()).orElse(Money.ZERO);
            BigDecimal budget = limit == null ? null : Money.round(limit.multiply(monthsInPeriod));
            List<BigDecimal> byMonth = months.stream().map(m -> own.stream()
                    .filter(l -> YearMonth.from(l.date()).equals(m))
                    .map(l -> kind == CategoryKind.INCOME ? l.net().negate() : l.net())
                    .reduce(Money.ZERO, BigDecimal::add)).toList();
            rows.add(new CategoryInsight(c.getId(), c.getCode(), c.getName(), amount, previous,
                    amount.subtract(previous), change(amount, previous), Money.percent(amount, total), count,
                    count == 0 ? Money.ZERO : amount.divide(BigDecimal.valueOf(count), 2, RoundingMode.HALF_UP),
                    Money.round(largest), budget, budget == null ? null : Money.percent(amount, budget), byMonth));
        }
        rows.sort(Comparator.comparing(CategoryInsight::amount).reversed());
        return rows;
    }

    // ================================================================== accounts

    private List<AccountInsight> accounts(LedgerSnapshot books, LocalDate from, LocalDate to) {
        Map<Long, BigDecimal> opening = books.balancesAsOf(from.minusDays(1));
        Map<Long, BigDecimal> closing = books.balancesAsOf(to);
        Map<Long, BigDecimal> in = new HashMap<>();
        Map<Long, BigDecimal> out = new HashMap<>();
        Map<Long, Integer> counts = new HashMap<>();
        Map<Long, LocalDate> last = new HashMap<>();
        for (PostedLine l : books.lines()) {
            if (l.date().isAfter(to)) {
                continue;
            }
            last.merge(l.accountId(), l.date(), (a, b) -> a.isAfter(b) ? a : b);
            if (l.date().isBefore(from)) {
                continue;
            }
            BigDecimal natural = books.natural(l.accountId(), l.net());
            if (natural.signum() > 0) {
                in.merge(l.accountId(), natural, BigDecimal::add);
            } else {
                out.merge(l.accountId(), natural.negate(), BigDecimal::add);
            }
            counts.merge(l.accountId(), 1, Integer::sum);
        }
        return books.accounts().values().stream()
                .filter(a -> a.getAccountClass() == AccountClass.ASSET || a.getAccountClass() == AccountClass.LIABILITY)
                .filter(a -> Boolean.TRUE.equals(a.getActive()) || closing.getOrDefault(a.getId(), Money.ZERO).signum() != 0)
                .sorted(Comparator.comparing(Account::getCode))
                .map(a -> {
                    BigDecimal open = opening.getOrDefault(a.getId(), Money.ZERO);
                    BigDecimal close = closing.getOrDefault(a.getId(), Money.ZERO);
                    LocalDate lastDate = last.get(a.getId());
                    return new AccountInsight(a.getId(), a.getCode(), a.getName(), a.getAccountType().name(),
                            a.getAccountType().getLabel(), a.getAccountClass().name(),
                            ReportService.bucket(a.getAccountType()), open,
                            Money.round(in.getOrDefault(a.getId(), Money.ZERO)),
                            Money.round(out.getOrDefault(a.getId(), Money.ZERO)), close, close.subtract(open),
                            change(close, open), counts.getOrDefault(a.getId(), 0), lastDate,
                            lastDate == null ? null : ChronoUnit.DAYS.between(lastDate, to),
                            a.getAccountType() == AccountType.CREDIT_CARD && Money.isPositive(a.getCreditLimit())
                                    ? Money.percent(close, a.getCreditLimit()) : null);
                })
                .toList();
    }

    // ================================================================== chits

    private List<ChitInsight> chits(LedgerSnapshot books, List<ChitView> views, LocalDate from, LocalDate to) {
        Long chitGains = books.categories().values().stream()
                .filter(c -> DefaultChartOfAccounts.CHIT_GAINS.equals(c.getSystemKey()))
                .map(Category::getId).findFirst().orElse(null);
        Map<Long, BigDecimal> paidInPeriod = new HashMap<>();
        Map<Long, BigDecimal> dividendsInPeriod = new HashMap<>();
        Map<Long, Long> chitOfEntry = new HashMap<>();
        for (PostedLine l : books.lines()) {
            if (l.chitId() != null && inRange(l.date(), from, to)) {
                chitOfEntry.put(l.entryId(), l.chitId());
                if (l.debit().signum() > 0) {
                    paidInPeriod.merge(l.chitId(), l.debit(), BigDecimal::add);
                }
            }
        }
        for (PostedLine l : books.lines()) {
            Long chit = chitOfEntry.get(l.entryId());
            if (chit != null && chitGains != null && chitGains.equals(l.categoryId())) {
                dividendsInPeriod.merge(chit, l.net().negate(), BigDecimal::add);
            }
        }
        return views.stream()
                .sorted(Comparator.comparing((ChitView c) -> c.status().ordinal()).thenComparing(ChitView::name))
                .map(c -> new ChitInsight(c.id(), c.name(), c.organizer(), c.status(),
                        Money.round(paidInPeriod.getOrDefault(c.id(), Money.ZERO)),
                        Money.round(dividendsInPeriod.getOrDefault(c.id(), Money.ZERO)),
                        c.paidIn(), c.stillToPay(), c.currentValue(), c.compoundInterestEarned(),
                        c.projectedNetGain(), c.impliedAnnualRate(), c.progressPercent(), c.overdueCount(),
                        c.nextDueDate(), c.nextDueAmount(), c.maturityDate()))
                .toList();
    }

    private static ChitTotals chitTotals(List<ChitInsight> rows) {
        List<ChitInsight> open = rows.stream()
                .filter(c -> c.status() == ChitStatus.ACTIVE || c.status() == ChitStatus.PRIZED).toList();
        BigDecimal paidIn = sum(open, ChitInsight::paidIn);
        BigDecimal weighted = open.stream()
                .filter(c -> c.annualRate() != null)
                .map(c -> c.annualRate().multiply(Money.nz(c.paidIn())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new ChitTotals(open.size(), sum(rows, ChitInsight::paidInPeriod), sum(rows, ChitInsight::dividendsInPeriod),
                paidIn, sum(open, ChitInsight::stillToPay), sum(open, ChitInsight::currentValue),
                sum(open, ChitInsight::interestEarned), sum(open, ChitInsight::projectedNetGain),
                paidIn.signum() == 0 ? null : weighted.divide(paidIn, 2, RoundingMode.HALF_UP));
    }

    // ================================================================== patterns

    private static List<ValuePoint> topPayees(LedgerSnapshot books, List<PostedLine> spending,
                                              Map<Long, JournalEntry> entryById) {
        Map<String, BigDecimal> byPayee = new HashMap<>();
        for (PostedLine l : spending) {
            JournalEntry e = entryById.get(l.entryId());
            String payee = e != null && e.getParty() != null && !e.getParty().isBlank() ? e.getParty().trim()
                    : l.narration() == null || l.narration().isBlank() ? books.displayName(l) : l.narration().trim();
            byPayee.merge(payee, l.debit(), BigDecimal::add);
        }
        return byPayee.entrySet().stream()
                .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                .limit(8)
                .map(e -> new ValuePoint(e.getKey(), Money.round(e.getValue())))
                .toList();
    }

    private static List<ValuePoint> weekdaySpend(LedgerSnapshot books, List<PostedLine> spending) {
        Map<DayOfWeek, BigDecimal> byDay = new LinkedHashMap<>();
        for (DayOfWeek d : DayOfWeek.values()) {
            byDay.put(d, Money.ZERO);
        }
        spending.forEach(l -> byDay.merge(l.date().getDayOfWeek(), l.debit(), BigDecimal::add));
        return byDay.entrySet().stream()
                .map(e -> new ValuePoint(e.getKey().getDisplayName(TextStyle.SHORT, Locale.ENGLISH), Money.round(e.getValue())))
                .toList();
    }

    // ================================================================== highlights

    private static List<Highlight> highlights(Summary s, List<CategoryInsight> expense, List<CategoryInsight> income,
                                              List<AccountInsight> accounts, List<ChitInsight> chitRows,
                                              List<ChitView> chitViews, List<ValuePoint> weekdays, int days) {
        List<Highlight> out = new ArrayList<>();
        // ---- saving
        if (s.income().signum() > 0) {
            BigDecimal rate = s.savingsRate();
            if (rate.compareTo(BigDecimal.valueOf(20)) >= 0) {
                out.add(new Highlight("good", "Savings", "You kept " + rate.setScale(0, RoundingMode.HALF_UP) + "% of your income",
                        "Net surplus of " + money(s.net()) + " in " + days + " days."));
            } else if (rate.signum() < 0) {
                out.add(new Highlight("warn", "Savings", "You spent more than you earned",
                        "Spending exceeded income by " + money(s.net().negate()) + "."));
            } else {
                out.add(new Highlight("info", "Savings", "Savings rate " + rate.setScale(0, RoundingMode.HALF_UP) + "%",
                        "A 20% savings rate would mean spending " + money(s.income().multiply(BigDecimal.valueOf(0.8))
                                .setScale(0, RoundingMode.HALF_UP)) + " or less."));
            }
        }
        if (s.expenseChangePercent() != null && s.previousExpense().signum() > 0
                && s.expenseChangePercent().abs().compareTo(BigDecimal.TEN) >= 0) {
            boolean up = s.expenseChangePercent().signum() > 0;
            out.add(new Highlight(up ? "warn" : "good", "Spending",
                    "Spending " + (up ? "up " : "down ") + s.expenseChangePercent().abs().setScale(0, RoundingMode.HALF_UP)
                            + "% on the previous period",
                    money(s.expense()) + " against " + money(s.previousExpense()) + "."));
        }
        // ---- categories
        expense.stream()
                .filter(c -> c.previous().signum() > 0 && c.change().compareTo(BigDecimal.valueOf(1000)) > 0
                        && c.changePercent() != null && c.changePercent().compareTo(BigDecimal.valueOf(25)) > 0)
                .max(Comparator.comparing(CategoryInsight::change))
                .ifPresent(c -> out.add(new Highlight("warn", "Categories", c.name() + " grew the most",
                        "Up " + money(c.change()) + " (" + c.changePercent().setScale(0, RoundingMode.HALF_UP)
                                + "%) to " + money(c.amount()) + ".")));
        expense.stream()
                .filter(c -> c.budgetUsedPercent() != null && c.budgetUsedPercent().compareTo(Money.HUNDRED) > 0)
                .forEach(c -> out.add(new Highlight("warn", "Budgets", c.name() + " is over budget",
                        money(c.amount()) + " spent against " + money(c.budget()) + " for the period.")));
        if (!expense.isEmpty() && expense.getFirst().share() != null
                && expense.getFirst().share().compareTo(BigDecimal.valueOf(30)) >= 0) {
            CategoryInsight top = expense.getFirst();
            out.add(new Highlight("info", "Categories", top.name() + " is " + top.share().setScale(0, RoundingMode.HALF_UP)
                    + "% of all spending", "The biggest single place your money goes in this period."));
        }
        if (!income.isEmpty() && s.income().signum() > 0) {
            CategoryInsight main = income.getFirst();
            BigDecimal share = Money.percent(main.amount(), s.income());
            if (share.compareTo(BigDecimal.valueOf(85)) >= 0) {
                out.add(new Highlight("info", "Income", share.setScale(0, RoundingMode.HALF_UP) + "% of income is " + main.name(),
                        "One source carries almost everything; a second stream would make the plan sturdier."));
            }
        }
        if (s.fixedShare() != null && s.fixedShare().compareTo(BigDecimal.valueOf(50)) >= 0) {
            out.add(new Highlight("info", "Spending", s.fixedShare().setScale(0, RoundingMode.HALF_UP) + "% of spending is scheduled",
                    "Recurring payments dominate; review subscriptions and fixed costs first."));
        }
        // ---- accounts
        accounts.stream()
                .filter(a -> a.utilization() != null && a.utilization().compareTo(BigDecimal.valueOf(30)) > 0)
                .forEach(a -> out.add(new Highlight("warn", "Accounts", a.name() + " is " + a.utilization().setScale(0, RoundingMode.HALF_UP)
                        + "% used", "Keeping card use under 30% of the limit helps your credit score.")));
        List<AccountInsight> idle = accounts.stream()
                .filter(a -> a.daysIdle() != null && a.daysIdle() > IDLE_DAYS && a.closing().signum() != 0
                        && AccountType.valueOf(a.accountType()).isLiquid())
                .toList();
        if (!idle.isEmpty()) {
            out.add(new Highlight("info", "Accounts", idle.size() + " account" + (idle.size() == 1 ? "" : "s")
                    + " idle for over " + IDLE_DAYS + " days",
                    idle.stream().map(a -> a.name() + " (" + money(a.closing()) + ")").collect(Collectors.joining(", "))
                            + ". Idle cash could earn more in a deposit."));
        }
        accounts.stream()
                .filter(a -> a.accountClass().equals("ASSET") && a.opening().signum() > 0 && a.changePercent() != null)
                .max(Comparator.comparing(AccountInsight::change))
                .filter(a -> a.change().signum() > 0)
                .ifPresent(a -> out.add(new Highlight("good", "Accounts", a.name() + " grew the most",
                        "Up " + money(a.change()) + " to " + money(a.closing()) + ".")));
        // ---- chits
        chitRows.stream().filter(c -> c.overdueCount() > 0)
                .forEach(c -> out.add(new Highlight("warn", "Chits", c.name() + ": " + c.overdueCount() + " installment"
                        + (c.overdueCount() == 1 ? "" : "s") + " overdue", "Pay soon to keep the dividend and avoid penalties.")));
        chitViews.stream()
                .filter(c -> c.status() == ChitStatus.ACTIVE && c.impliedAnnualRate() != null)
                .max(Comparator.comparing(ChitView::impliedAnnualRate))
                .ifPresent(c -> out.add(new Highlight("good", "Chits", c.name() + " returns "
                        + c.impliedAnnualRate().setScale(1, RoundingMode.HALF_UP) + "% a year",
                        "Your best-yielding running chit; " + money(c.compoundInterestEarned()) + " earned so far.")));
        // ---- pattern
        weekdays.stream().max(Comparator.comparing(ValuePoint::value))
                .filter(p -> s.expense().signum() > 0 && Money.percent(p.value(), s.expense()).compareTo(BigDecimal.valueOf(25)) > 0)
                .ifPresent(p -> out.add(new Highlight("info", "Pattern", p.label() + " is your heaviest spending day",
                        money(p.value()) + ", " + Money.percent(p.value(), s.expense()).setScale(0, RoundingMode.HALF_UP)
                                + "% of the period's spending.")));
        return out;
    }

    // ================================================================== helpers

    private static boolean isExpense(LedgerSnapshot books, PostedLine l) {
        Account a = books.account(l.accountId());
        return a != null && a.getAccountClass() == AccountClass.EXPENSE;
    }

    private static boolean inRange(LocalDate d, LocalDate from, LocalDate to) {
        return !d.isBefore(from) && !d.isAfter(to);
    }

    private static BigDecimal change(BigDecimal now, BigDecimal before) {
        return before == null || before.signum() == 0 ? null : Money.percent(now.subtract(before), before.abs());
    }

    private static <T> BigDecimal sum(List<T> rows, Function<T, BigDecimal> value) {
        return rows.stream().map(value).map(Money::nz).reduce(Money.ZERO, BigDecimal::add);
    }

    private static String money(BigDecimal value) {
        return String.format(Locale.ENGLISH, "%,.0f", value);
    }
}
