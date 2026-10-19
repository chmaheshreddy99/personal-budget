package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.domain.type.RecurringKind;
import com.aditya.personalbudget.dto.InsightDtos.CategoryForecast;
import com.aditya.personalbudget.dto.InsightDtos.Forecast;
import com.aditya.personalbudget.dto.InsightDtos.ForecastEvent;
import com.aditya.personalbudget.dto.InsightDtos.ForecastMonth;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Projects cash and net worth month by month.
 * <p>
 * Inputs: recurring transactions, budgets, the last three months of actual spending, pending chit installments
 * and expected chit maturities. Optional what-if adjustments scale income and expenses by a percentage.
 */
@Service
public class ForecastService {

    private static final int HISTORY_MONTHS = 3;

    private final LedgerService ledger;
    private final RecurringService recurring;
    private final BudgetService budgets;
    private final ChitService chits;

    public ForecastService(LedgerService ledger, RecurringService recurring, BudgetService budgets, ChitService chits) {
        this.ledger = ledger;
        this.recurring = recurring;
        this.budgets = budgets;
        this.chits = chits;
    }

    public Forecast forecast(int months, BigDecimal incomeAdjust, BigDecimal expenseAdjust) {
        int horizon = Math.clamp(months, 1, 60);
        BigDecimal incomeFactor = factor(incomeAdjust);
        BigDecimal expenseFactor = factor(expenseAdjust);

        LocalDate today = LocalDate.now();
        YearMonth current = YearMonth.from(today);
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, BigDecimal> balances = books.balancesAsOf(today);
        Map<Long, BigDecimal> history = books.movementsBetween(current.minusMonths(HISTORY_MONTHS).atDay(1),
                current.minusMonths(1).atEndOfMonth());

        List<RecurringTransaction> items = recurring.active();
        boolean hasRecurringIncome = items.stream().anyMatch(r -> r.getKind() == RecurringKind.INCOME);
        BigDecimal avgIncome = average(books.totalOfClass(history, AccountClass.INCOME));
        List<String> assumptions = new ArrayList<>();

        // ---- expense baseline per category: budget if set, otherwise 3-month average
        Map<Long, Budget> budgetByCategory = budgets.all().stream()
                .collect(Collectors.toMap(Budget::getCategoryId, Function.identity(), (x, y) -> x));
        Map<Long, BigDecimal> categoryHistory = books.categoryMovements(current.minusMonths(HISTORY_MONTHS).atDay(1),
                current.minusMonths(1).atEndOfMonth());
        List<CategoryForecast> categories = new ArrayList<>();
        Map<Long, BigDecimal> baseline = new HashMap<>();
        for (Category c : books.categoriesOf(CategoryKind.EXPENSE)) {
            if (LedgerSnapshot.budgetOnly(c)) {
                continue;   // chit installments are projected from the chits themselves below
            }
            Budget b = budgetByCategory.get(c.getId());
            BigDecimal avg = average(categoryHistory.getOrDefault(c.getId(), Money.ZERO));
            BigDecimal amount = b != null ? b.getMonthlyLimit() : avg;
            if (amount.signum() > 0) {
                baseline.put(c.getId(), amount);
                categories.add(new CategoryForecast(c.getId(), c.getName(),
                        b != null ? "Budget" : HISTORY_MONTHS + "-month average", amount));
            }
        }
        categories.sort(Comparator.comparing(CategoryForecast::monthlyAmount).reversed());

        assumptions.add(hasRecurringIncome ? "Income comes from your recurring income items"
                : "No recurring income defined: using the " + HISTORY_MONTHS + "-month average income");
        assumptions.add("Expenses use the budget of each category, else its " + HISTORY_MONTHS
                + "-month average; a larger recurring expense in the same category wins");
        assumptions.add("The first row is the rest of the current month: budgets minus what is already spent");
        assumptions.add("Chit installments are paid on their due dates without dividends; overdue ones fall in the first row");
        assumptions.add("Active chits pay out their maturity amount one month after the last installment");
        assumptions.add("All expenses are eventually paid from liquid money (cash, bank, wallet)");
        assumptions.add("Loan EMIs: keep the principal as a recurring transfer; the interest part is projected from Loan Interest history");

        // ---- chit inputs
        Map<Long, Chit> chitById = chits.all().stream().collect(Collectors.toMap(Chit::getId, Function.identity()));
        List<ChitInstallment> pending = chits.pendingInstallments();

        BigDecimal liquid = books.accounts().values().stream()
                .filter(Account::isLiquid)
                .map(a -> balances.getOrDefault(a.getId(), Money.ZERO))
                .reduce(Money.ZERO, BigDecimal::add);
        BigDecimal netWorth = books.netWorthAsOf(today);
        BigDecimal startLiquid = liquid;
        BigDecimal startNetWorth = netWorth;

        List<ForecastMonth> rows = new ArrayList<>();
        List<ForecastEvent> events = new ArrayList<>();
        BigDecimal totalIncome = Money.ZERO;
        BigDecimal totalExpense = Money.ZERO;
        String lowestMonth = null;
        BigDecimal lowest = null;

        // Month-to-date actuals: the first row only covers what is still to come this month.
        Map<Long, BigDecimal> monthToDate = books.movementsBetween(current.atDay(1), today);
        BigDecimal incomeToDate = books.totalOfClass(monthToDate, AccountClass.INCOME);
        Map<Long, BigDecimal> categoriesToDate = books.categoryMovements(current.atDay(1), today);

        for (int i = 0; i <= horizon; i++) {
            boolean first = i == 0;
            YearMonth m = current.plusMonths(i);
            LocalDate start = first ? today.plusDays(1) : m.atDay(1);
            LocalDate end = m.atEndOfMonth();

            BigDecimal income = Money.ZERO;
            Map<Long, BigDecimal> recurringExpense = new HashMap<>();
            BigDecimal transfersOut = Money.ZERO;
            BigDecimal transfersIn = Money.ZERO;
            for (RecurringTransaction r : items) {
                for (LocalDate d : RecurringService.occurrences(r, start, end)) {
                    switch (r.getKind()) {
                        case INCOME -> income = income.add(r.getAmount());
                        case EXPENSE -> recurringExpense.merge(r.getCategoryId() != null ? r.getCategoryId() : -1L,
                                r.getAmount(), BigDecimal::add);
                        case TRANSFER -> {
                            boolean fromLiquid = isLiquid(books, r.getCreditAccountId());
                            boolean toLiquid = isLiquid(books, r.getDebitAccountId());
                            if (fromLiquid && !toLiquid) {
                                transfersOut = transfersOut.add(r.getAmount());
                            } else if (!fromLiquid && toLiquid) {
                                transfersIn = transfersIn.add(r.getAmount());
                            }
                        }
                    }
                    if (i <= 12 && r.getAmount().compareTo(BigDecimal.valueOf(5000)) >= 0) {
                        events.add(new ForecastEvent(d, r.getKind().name(), r.getName(), r.getAmount()));
                    }
                }
            }
            if (!hasRecurringIncome) {
                income = first ? avgIncome.subtract(incomeToDate).max(Money.ZERO) : avgIncome;
            }
            income = Money.round(income.multiply(incomeFactor));

            Map<Long, BigDecimal> perCategory = new HashMap<>();
            baseline.forEach((id, amount) -> perCategory.put(id, first
                    ? amount.subtract(categoriesToDate.getOrDefault(id, Money.ZERO)).max(Money.ZERO)
                    : amount));
            recurringExpense.forEach((id, amount) -> perCategory.merge(id, amount, BigDecimal::max));
            BigDecimal expenses = Money.round(perCategory.values().stream().reduce(Money.ZERO, BigDecimal::add)
                    .multiply(expenseFactor));

            // ---- chits
            BigDecimal chitOut = pending.stream()
                    .filter(p -> !p.getDueDate().isAfter(end) && (first || !p.getDueDate().isBefore(start)))
                    .map(ChitInstallment::getDueAmount)
                    .reduce(Money.ZERO, BigDecimal::add);
            BigDecimal chitIn = Money.ZERO;
            BigDecimal chitGain = Money.ZERO;
            for (Chit c : chitById.values()) {
                LocalDate maturity = c.getEndDate().plusMonths(1);
                if (c.getStatus() == ChitStatus.ACTIVE && !maturity.isBefore(start) && !maturity.isAfter(end)) {
                    chitIn = chitIn.add(c.getMaturityAmount());
                    chitGain = chitGain.add(c.getMaturityAmount().subtract(
                            c.getMonthlyInstallment().multiply(BigDecimal.valueOf(c.getNumberOfInstallments()))));
                    events.add(new ForecastEvent(maturity, "CHIT", c.getName() + " maturity", c.getMaturityAmount()));
                }
            }

            BigDecimal net = income.subtract(expenses).subtract(chitOut).add(chitIn).subtract(transfersOut).add(transfersIn);
            liquid = liquid.add(net);
            netWorth = netWorth.add(income).subtract(expenses).add(chitGain);
            rows.add(new ForecastMonth(m.toString(), income, expenses, chitOut, chitIn, transfersOut, transfersIn,
                    net, Money.round(liquid), Money.round(netWorth)));

            totalIncome = totalIncome.add(income);
            totalExpense = totalExpense.add(expenses);
            if (lowest == null || liquid.compareTo(lowest) < 0) {
                lowest = liquid;
                lowestMonth = m.toString();
            }
        }

        events.sort(Comparator.comparing(ForecastEvent::date));
        BigDecimal n = BigDecimal.valueOf(rows.size());
        return new Forecast(horizon, Money.nz(incomeAdjust), Money.nz(expenseAdjust), startLiquid, startNetWorth,
                Money.round(liquid), Money.round(netWorth),
                totalIncome.divide(n, 2, RoundingMode.HALF_UP), totalExpense.divide(n, 2, RoundingMode.HALF_UP),
                lowestMonth, lowest == null ? null : Money.round(lowest), rows, categories,
                events.stream().limit(40).toList(), assumptions);
    }

    private static boolean isLiquid(LedgerSnapshot books, Long accountId) {
        Account a = books.account(accountId);
        return a != null && a.isLiquid();
    }

    private static BigDecimal average(BigDecimal total) {
        return total.divide(BigDecimal.valueOf(HISTORY_MONTHS), 2, RoundingMode.HALF_UP);
    }

    /** 10 (percent) becomes 1.10; null becomes 1. */
    private static BigDecimal factor(BigDecimal percent) {
        return BigDecimal.ONE.add(Money.nz(percent).divide(Money.HUNDRED, 4, RoundingMode.HALF_UP));
    }
}
