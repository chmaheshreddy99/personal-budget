package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.InsightDtos.AccountTile;
import com.aditya.personalbudget.dto.InsightDtos.Dashboard;
import com.aditya.personalbudget.dto.InsightDtos.Kpis;
import com.aditya.personalbudget.dto.InsightDtos.UpcomingItem;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetLine;
import com.aditya.personalbudget.dto.ReportDtos.ValuePoint;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Everything the home dashboard shows, in one call.
 */
@Service
public class DashboardService {

    private static final int UPCOMING_DAYS = 45;

    private final LedgerService ledger;
    private final ReportService reports;
    private final BudgetService budgets;
    private final ChitService chits;
    private final RecurringService recurring;
    private final JournalEntryRepository entries;

    public DashboardService(LedgerService ledger, ReportService reports, BudgetService budgets, ChitService chits,
                            RecurringService recurring, JournalEntryRepository entries) {
        this.ledger = ledger;
        this.reports = reports;
        this.budgets = budgets;
        this.chits = chits;
        this.recurring = recurring;
        this.entries = entries;
    }

    public Dashboard build() {
        LocalDate today = LocalDate.now();
        YearMonth month = YearMonth.from(today);
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, BigDecimal> balances = books.balancesAsOf(today);
        Map<Long, BigDecimal> thisMonth = books.movementsBetween(month.atDay(1), month.atEndOfMonth());
        YearMonth prev = month.minusMonths(1);
        Map<Long, BigDecimal> lastMonth = books.movementsBetween(prev.atDay(1), prev.atEndOfMonth());

        return new Dashboard(today,
                kpis(books, balances, thisMonth, lastMonth, prev),
                reports.monthlyTrend(books, month, 12),
                reports.netWorthTrend(books, month, 12),
                expenseBreakdown(books, books.categoryMovements(month.atDay(1), month.atEndOfMonth())),
                breakdownByType(books, balances, AccountClass.ASSET),
                breakdownByType(books, balances, AccountClass.LIABILITY),
                topBudgets(month),
                upcoming(today, books),
                accountTiles(books, balances),
                ledger.toViews(entries.findByTenantId(UserContext.tenantId()).stream()
                        .sorted(JournalEntryRepository.NEWEST_FIRST).limit(8).toList()));
    }

    private Kpis kpis(LedgerSnapshot books, Map<Long, BigDecimal> balances, Map<Long, BigDecimal> thisMonth,
                      Map<Long, BigDecimal> lastMonth, YearMonth prev) {
        // Same presentation as the balance sheet: dues on prized chits count as liabilities
        BigDecimal chitDues = books.chitBalancesAsOf(LocalDate.now()).values().stream()
                .filter(v -> v.signum() < 0)
                .map(BigDecimal::negate)
                .reduce(Money.ZERO, BigDecimal::add);
        BigDecimal assets = books.totalOfClass(balances, AccountClass.ASSET).add(chitDues);
        BigDecimal liabilities = books.totalOfClass(balances, AccountClass.LIABILITY).add(chitDues);
        BigDecimal netWorth = assets.subtract(liabilities);
        BigDecimal income = books.totalOfClass(thisMonth, AccountClass.INCOME);
        BigDecimal expense = books.totalOfClass(thisMonth, AccountClass.EXPENSE);
        BigDecimal prevExpense = books.totalOfClass(lastMonth, AccountClass.EXPENSE);
        BigDecimal expenseChange = prevExpense.signum() == 0 ? BigDecimal.ZERO
                : Money.percent(expense.subtract(prevExpense), prevExpense);

        List<ChitView> chitViews = chits.list();
        BigDecimal chitInvested = chitViews.stream().filter(c -> c.status() == ChitStatus.ACTIVE)
                .map(ChitView::paidIn).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal chitAccrued = chitViews.stream().filter(c -> c.status() == ChitStatus.ACTIVE)
                .map(ChitView::compoundInterestEarned).reduce(Money.ZERO, BigDecimal::add);
        int activeChits = (int) chitViews.stream()
                .filter(c -> c.status() == ChitStatus.ACTIVE || c.status() == ChitStatus.PRIZED).count();

        return new Kpis(netWorth, netWorth.subtract(books.netWorthAsOf(prev.atEndOfMonth())), assets, liabilities,
                sumOfTypes(books, balances, true, null), income, expense, income.subtract(expense),
                Money.percent(income.subtract(expense), income), expenseChange,
                sumOfTypes(books, balances, false, AccountType.RECEIVABLE),
                sumOfTypes(books, balances, false, AccountType.PAYABLE),
                chitInvested, chitAccrued, activeChits);
    }

    private BigDecimal sumOfTypes(LedgerSnapshot books, Map<Long, BigDecimal> balances, boolean liquid, AccountType type) {
        return balances.entrySet().stream()
                .filter(e -> {
                    Account a = books.account(e.getKey());
                    return a != null && (liquid ? a.getAccountType().isLiquid() : a.getAccountType() == type);
                })
                .map(Map.Entry::getValue)
                .reduce(Money.ZERO, BigDecimal::add);
    }

    /** Top 7 expense categories of the month plus "Others". */
    private List<ValuePoint> expenseBreakdown(LedgerSnapshot books, Map<Long, BigDecimal> moves) {
        List<ValuePoint> all = books.categoriesOf(CategoryKind.EXPENSE).stream()
                .map(c -> new ValuePoint(c.getName(), moves.getOrDefault(c.getId(), Money.ZERO)))
                .filter(p -> p.value().signum() > 0)
                .sorted(Comparator.comparing(ValuePoint::value).reversed())
                .toList();
        if (all.size() <= 8) {
            return all;
        }
        List<ValuePoint> top = new ArrayList<>(all.subList(0, 7));
        BigDecimal others = all.subList(7, all.size()).stream().map(ValuePoint::value).reduce(Money.ZERO, BigDecimal::add);
        top.add(new ValuePoint("Others", others));
        return top;
    }

    private List<ValuePoint> breakdownByType(LedgerSnapshot books, Map<Long, BigDecimal> balances, AccountClass cls) {
        Map<AccountType, BigDecimal> byType = new TreeMap<>();
        for (Account a : books.accountsOfClass(cls)) {
            BigDecimal value = balances.getOrDefault(a.getId(), Money.ZERO);
            if (value.signum() > 0) {
                byType.merge(a.getAccountType(), value, BigDecimal::add);
            }
        }
        return byType.entrySet().stream()
                .map(e -> new ValuePoint(e.getKey().getLabel(), e.getValue()))
                .sorted(Comparator.comparing(ValuePoint::value).reversed())
                .toList();
    }

    private List<BudgetLine> topBudgets(YearMonth month) {
        return budgets.summary(month).lines().stream()
                .filter(l -> l.budgetId() != null)
                .sorted(Comparator.comparing(BudgetLine::usedPercent).reversed())
                .limit(6)
                .toList();
    }

    private List<UpcomingItem> upcoming(LocalDate today, LedgerSnapshot books) {
        LocalDate horizon = today.plusDays(UPCOMING_DAYS);
        List<UpcomingItem> items = new ArrayList<>();

        Map<Long, Chit> chitById = chits.all().stream().collect(Collectors.toMap(Chit::getId, Function.identity()));
        for (ChitInstallment i : chits.pendingInstallments()) {
            if (!i.getDueDate().isAfter(horizon)) {
                Chit c = chitById.get(i.getChitId());
                items.add(new UpcomingItem(i.getDueDate(), "CHIT",
                        c.getName() + " #" + i.getInstallmentNo(), i.getDueAmount(), i.getDueDate().isBefore(today)));
            }
        }
        for (RecurringTransaction r : recurring.active()) {
            for (LocalDate d : RecurringService.occurrences(r, LocalDate.MIN, horizon)) {
                items.add(new UpcomingItem(d, r.getKind().name(), r.getName(), r.getAmount(), d.isBefore(today)));
            }
        }
        // committed budgets (rent, fees, EMI) not paid yet this month
        for (BudgetLine l : budgets.summary(YearMonth.from(today)).lines()) {
            if (l.committed() && !"PAID".equals(l.paymentStatus()) && l.dueDate() != null && !l.dueDate().isAfter(horizon)) {
                items.add(new UpcomingItem(l.dueDate(), "COMMITTED", l.categoryName() + " (committed)",
                        l.monthlyLimit().subtract(l.spent()).max(Money.ZERO), l.dueDate().isBefore(today)));
            }
        }
        for (Account a : books.accounts().values()) {
            LocalDate maturity = a.getMaturityDate();
            if (maturity != null && !maturity.isBefore(today) && !maturity.isAfter(horizon)) {
                items.add(new UpcomingItem(maturity, "MATURITY", a.getName() + " matures",
                        books.balanceAsOf(a.getId(), today), false));
            }
        }
        return items.stream().sorted(Comparator.comparing(UpcomingItem::date)).limit(12).toList();
    }

    private List<AccountTile> accountTiles(LedgerSnapshot books, Map<Long, BigDecimal> balances) {
        return books.accounts().values().stream()
                .filter(a -> Boolean.TRUE.equals(a.getActive()))
                .filter(a -> a.getAccountType().isLiquid() || a.getAccountType() == AccountType.CREDIT_CARD)
                .sorted(Comparator.comparing(Account::getCode))
                .map(a -> {
                    BigDecimal balance = balances.getOrDefault(a.getId(), Money.ZERO);
                    BigDecimal utilization = Money.isPositive(a.getCreditLimit())
                            ? Money.percent(balance, a.getCreditLimit()) : null;
                    return new AccountTile(a.getId(), a.getName(), a.getAccountType().getLabel(),
                            a.getAccountType().name(), balance, utilization);
                })
                .toList();
    }
}
