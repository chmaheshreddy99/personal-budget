package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.domain.type.RecurringKind;
import com.aditya.personalbudget.dto.InsightDtos.CategoryForecast;
import com.aditya.personalbudget.dto.InsightDtos.ExpenseLine;
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
 * <p>
 * Income: the recurring income items, plus the recorded income of the last three months as the basis says, a month on
 * average, for the sources without a recurring item: REGULAR (the default: income marked as coming every month),
 * UNMARKED (and income not marked either way), ALL (and one-time income) or NONE (no income at all). Chit gains and
 * interest are left out: the projection page adds what the money earns itself.
 * <p>
 * Expenses come from the budgets: a month with its own budget for a category takes it, any other month the average of
 * the months budgeted for that category. Categories never budgeted are left out (BUDGET, the default) or take their
 * 3-month average (BUDGET_HISTORY); with no budgets at all, every category takes its 3-month average.
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
        return forecast(months, incomeAdjust, expenseAdjust, null);
    }

    public Forecast forecast(int months, BigDecimal incomeAdjust, BigDecimal expenseAdjust, String incomeBasis) {
        return forecast(months, incomeAdjust, expenseAdjust, incomeBasis, null);
    }

    public Forecast forecast(int months, BigDecimal incomeAdjust, BigDecimal expenseAdjust, String incomeBasis, String expenseBasis) {
        String spendBasis = "BUDGET_HISTORY".equals(expenseBasis) ? "BUDGET_HISTORY" : "BUDGET";
        String basis = incomeBasis != null && List.of("REGULAR", "UNMARKED", "ALL", "NONE").contains(incomeBasis) ? incomeBasis : "REGULAR";
        int horizon = Math.clamp(months, 1, 60);
        BigDecimal incomeFactor = factor(incomeAdjust);
        BigDecimal expenseFactor = factor(expenseAdjust);

        LocalDate today = OrgClock.today();
        YearMonth current = YearMonth.from(today);
        LedgerSnapshot books = ledger.snapshot();
        Map<Long, BigDecimal> balances = books.balancesAsOf(today);
        Map<Long, BigDecimal> history = books.movementsBetween(current.minusMonths(HISTORY_MONTHS).atDay(1),
                current.minusMonths(1).atEndOfMonth());

        List<RecurringTransaction> items = recurring.active();
        java.util.Set<Long> recurringSources = items.stream().filter(r -> r.getKind() == RecurringKind.INCOME && r.getCategoryId() != null)
                .map(RecurringTransaction::getCategoryId).collect(Collectors.toSet());
        Map<String, BigDecimal> byNature = recordedIncome(books, recurringSources, current.minusMonths(HISTORY_MONTHS).atDay(1), current.minusMonths(1).atEndOfMonth());
        BigDecimal regularAvg = average(byNature.get("REGULAR"));
        BigDecimal unmarkedAvg = average(byNature.get("UNMARKED"));
        BigDecimal oneTimeAvg = average(byNature.get("ONE_TIME"));
        BigDecimal recordedAvg = recordedFor(basis, regularAvg, unmarkedAvg, oneTimeAvg);
        List<String> assumptions = new ArrayList<>();

        // ---- expenses per category: the month's own budget, else the average of the months budgeted (else history)
        Map<Long, Map<String, BigDecimal>> budgetMonths = new HashMap<>();
        for (Budget b : budgets.everyMonth()) {
            if (b.getMonthlyLimit() == null || b.getMonthlyLimit().signum() <= 0) continue;
            budgetMonths.computeIfAbsent(b.getCategoryId(), k -> new HashMap<>())
                    .merge(b.getMonth() != null ? b.getMonth() : current.toString(), b.getMonthlyLimit(), BigDecimal::max);
        }
        boolean anyBudget = !budgetMonths.isEmpty();
        Map<Long, BigDecimal> categoryHistory = books.categoryMovements(current.minusMonths(HISTORY_MONTHS).atDay(1),
                current.minusMonths(1).atEndOfMonth());
        List<CategoryForecast> categories = new ArrayList<>();
        Map<Long, BigDecimal> baseline = new HashMap<>();
        Map<Long, String> categoryName = new HashMap<>();
        BigDecimal unbudgeted = Money.ZERO;
        for (Category c : books.categoriesOf(CategoryKind.EXPENSE)) {
            if (LedgerSnapshot.budgetOnly(c)) {
                continue;   // chit installments are projected from the chits themselves below
            }
            categoryName.put(c.getId(), c.getName());
            Map<String, BigDecimal> set = budgetMonths.getOrDefault(c.getId(), Map.of());
            BigDecimal avg = average(categoryHistory.getOrDefault(c.getId(), Money.ZERO));
            if (!set.isEmpty()) {
                BigDecimal budgetAvg = Money.round(set.values().stream().reduce(Money.ZERO, BigDecimal::add)
                        .divide(BigDecimal.valueOf(set.size()), 2, RoundingMode.HALF_UP));
                baseline.put(c.getId(), budgetAvg);
                categories.add(new CategoryForecast(c.getId(), c.getName(),
                        set.size() == 1 ? "Budget" : "Budget · avg of " + set.size() + " months", budgetAvg, set.size(), avg));
            } else if (avg.signum() > 0 && (!anyBudget || "BUDGET_HISTORY".equals(spendBasis))) {
                baseline.put(c.getId(), avg);
                categories.add(new CategoryForecast(c.getId(), c.getName(), HISTORY_MONTHS + "-month average", avg, 0, avg));
            } else if (avg.signum() > 0) {
                unbudgeted = unbudgeted.add(avg);
                categories.add(new CategoryForecast(c.getId(), c.getName(), "Not budgeted", Money.ZERO, 0, avg));
            }
        }
        categories.sort(Comparator.comparing(CategoryForecast::monthlyAmount).reversed()
                .thenComparing(CategoryForecast::historyAverage, Comparator.reverseOrder()));

        assumptions.add(switch (basis) {
            case "NONE" -> "No income is projected";
            case "ALL" -> "Income: recurring income items, plus all income recorded in the last " + HISTORY_MONTHS + " months (one-time too), a month on average";
            case "UNMARKED" -> "Income: recurring income items, plus income recorded as regular or not marked, a month on average over " + HISTORY_MONTHS + " months";
            default -> "Income: recurring income items, plus income recorded as regular, a month on average over " + HISTORY_MONTHS + " months; one-time and unmarked income is not projected";
        });
        assumptions.add("Recorded income in a source with a recurring income item is left to the item; chit gains and interest are added by what the money earns");
        if (!anyBudget) {
            assumptions.add("No budgets are set: expenses use each category's " + HISTORY_MONTHS + "-month average; a larger recurring expense in the same category wins");
        } else {
            assumptions.add("Expenses come from the budgets: a month's own budget when set, else the average of the months budgeted"
                    + ("BUDGET_HISTORY".equals(spendBasis) ? "; categories without a budget use their " + HISTORY_MONTHS + "-month average"
                    : "; categories without a budget are left out") + "; a larger recurring expense in the same category wins");
        }
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
        Map<String, BigDecimal> toDateByNature = recordedIncome(books, recurringSources, current.atDay(1), today);
        BigDecimal recordedToDate = recordedFor(basis, toDateByNature.get("REGULAR"), toDateByNature.get("UNMARKED"), toDateByNature.get("ONE_TIME"));
        BigDecimal recurringMonthly = Money.ZERO;
        Map<Long, BigDecimal> categoriesToDate = books.categoryMovements(current.atDay(1), today);

        for (int i = 0; i <= horizon; i++) {
            boolean first = i == 0;
            YearMonth m = current.plusMonths(i);
            LocalDate start = first ? today.plusDays(1) : m.atDay(1);
            LocalDate end = m.atEndOfMonth();

            BigDecimal recurringIncome = Money.ZERO;
            Map<Long, BigDecimal> recurringExpense = new HashMap<>();
            BigDecimal transfersOut = Money.ZERO;
            BigDecimal transfersIn = Money.ZERO;
            for (RecurringTransaction r : items) {
                for (LocalDate d : RecurringService.occurrences(r, start, end)) {
                    switch (r.getKind()) {
                        case INCOME -> recurringIncome = recurringIncome.add(r.getAmount());
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
            if (i == 1) {
                recurringMonthly = recurringIncome;
            }
            if ("NONE".equals(basis)) {
                recurringIncome = Money.ZERO;
            }
            BigDecimal recordedIncome = first ? recordedAvg.subtract(recordedToDate).max(Money.ZERO) : recordedAvg;
            recurringIncome = Money.round(recurringIncome.multiply(incomeFactor));
            recordedIncome = Money.round(recordedIncome.multiply(incomeFactor));
            BigDecimal income = recurringIncome.add(recordedIncome);

            Map<Long, BigDecimal> perCategory = new HashMap<>();
            Map<Long, String> lineBasis = new HashMap<>();
            String monthKey = m.toString();
            baseline.forEach((id, amount) -> {
                BigDecimal own = budgetMonths.getOrDefault(id, Map.of()).get(monthKey);
                BigDecimal full = own != null ? own : amount;
                lineBasis.put(id, own != null ? "BUDGET" : budgetMonths.containsKey(id) ? "BUDGET_AVG" : "HISTORY");
                perCategory.put(id, first ? full.subtract(categoriesToDate.getOrDefault(id, Money.ZERO)).max(Money.ZERO) : full);
            });
            recurringExpense.forEach((id, amount) -> {
                if (amount.compareTo(perCategory.getOrDefault(id, Money.ZERO)) > 0) lineBasis.put(id, "RECURRING");
                perCategory.merge(id, amount, BigDecimal::max);
            });
            BigDecimal expenses = Money.round(perCategory.values().stream().reduce(Money.ZERO, BigDecimal::add)
                    .multiply(expenseFactor));
            List<ExpenseLine> expenseLines = perCategory.entrySet().stream().filter(e -> e.getValue().signum() > 0)
                    .map(e -> new ExpenseLine(e.getKey() < 0 ? null : e.getKey(), e.getKey() < 0 ? "Recurring, no category"
                            : categoryName.getOrDefault(e.getKey(), "Other"), Money.round(e.getValue().multiply(expenseFactor)), lineBasis.get(e.getKey())))
                    .sorted(Comparator.comparing(ExpenseLine::amount).reversed()).toList();

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
                    net, Money.round(liquid), Money.round(netWorth), recurringIncome, recordedIncome, expenseLines));

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
                events.stream().limit(40).toList(), assumptions, basis, regularAvg, unmarkedAvg, oneTimeAvg, Money.round(recurringMonthly),
                spendBasis, Money.round(unbudgeted));
    }

    /**
     * Recorded income between two days by what it is: REGULAR, ONE_TIME or UNMARKED (not said), leaving out the sources
     * with a recurring income item, chit gains and interest (the earnings of the money itself).
     */
    private static Map<String, BigDecimal> recordedIncome(LedgerSnapshot books, java.util.Set<Long> skip, LocalDate from, LocalDate to) {
        Map<String, BigDecimal> out = new HashMap<>(Map.of("REGULAR", Money.ZERO, "UNMARKED", Money.ZERO, "ONE_TIME", Money.ZERO));
        for (LedgerSnapshot.PostedLine line : books.lines()) {
            if (line.categoryId() == null || line.date().isBefore(from) || line.date().isAfter(to) || skip.contains(line.categoryId())) {
                continue;
            }
            Category c = books.category(line.categoryId());
            if (c == null || c.getKind() != CategoryKind.INCOME
                    || DefaultChartOfAccounts.CHIT_GAINS.equals(c.getSystemKey()) || DefaultChartOfAccounts.INTEREST_INCOME.equals(c.getSystemKey())) {
                continue;
            }
            var entry = books.entry(line.entryId());
            String nature = entry != null && entry.getIncomeNature() != null ? entry.getIncomeNature() : "UNMARKED";
            out.merge(nature, line.net().negate(), BigDecimal::add);
        }
        return out;
    }

    private static BigDecimal recordedFor(String basis, BigDecimal regular, BigDecimal unmarked, BigDecimal oneTime) {
        BigDecimal total = switch (basis) {
            case "NONE" -> Money.ZERO;
            case "ALL" -> regular.add(unmarked).add(oneTime);
            case "UNMARKED" -> regular.add(unmarked);
            default -> regular;
        };
        return total.max(Money.ZERO);
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
