package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetAlert;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetHealth;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetLine;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetSummary;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Monthly budgets per expense category, compared with actual spending.
 * <ul>
 *   <li>Budgets belong to a month; "copy" carries a month's budgets into another.</li>
 *   <li><b>Committed</b> budgets are payments that must be made (rent, fees, EMI), by a due day: they are
 *       paid, partly paid, due, due soon or overdue.</li>
 *   <li>Ordinary budgets are judged by <b>pace</b>: the month's spending is projected from this month's daily
 *       rate blended with the 3-month history (early in the month the history counts more), and compared
 *       with where the limit says you should be today.</li>
 *   <li>Alerts turn that into a few plain sentences, most urgent first, each with what to do about it.</li>
 * </ul>
 */
@Service
public class BudgetService {

    private static final BigDecimal PAID_SHARE = new BigDecimal("0.98");

    private final BudgetRepository budgets;
    private final CategoryService categories;
    private final LedgerService ledger;

    public BudgetService(BudgetRepository budgets, CategoryService categories, LedgerService ledger) {
        this.budgets = budgets;
        this.categories = categories;
        this.ledger = ledger;
    }

    // ================================================================== summary

    /** Budget vs actual for a month, including categories that have spending but no budget. */
    public BudgetSummary summary(YearMonth month) {
        LocalDate today = LocalDate.now();
        Clock clock = new Clock(month, today);
        LedgerSnapshot books = ledger.snapshot();
        // chit installments count under Chit Payments (budget only; in the books they are savings)
        Map<Long, BigDecimal> spent = books.budgetMovements(month.atDay(1), month.atEndOfMonth());
        Map<Long, BigDecimal> last3 = books.budgetMovements(month.minusMonths(3).atDay(1), month.minusMonths(1).atEndOfMonth());
        Map<Long, Budget> byCategory = forMonth(month).stream()
                .collect(Collectors.toMap(Budget::getCategoryId, Function.identity(), (a, b) -> a));
        // what each category usually costs in the rest of the month: the last 3 months, from tomorrow's day on
        Map<Long, BigDecimal> usualRest = new java.util.HashMap<>();
        Map<Long, Boolean> hasHistory = new java.util.HashMap<>();
        Map<Long, java.util.Set<Long>> historyEntries = new java.util.HashMap<>();   // to tell bills from everyday spending
        for (PostedLine l : books.budgetLines()) {
            if (l.categoryId() == null) {
                continue;
            }
            YearMonth ym = YearMonth.from(l.date());
            if (!ym.isBefore(month.minusMonths(3)) && ym.isBefore(month)) {
                hasHistory.put(l.categoryId(), true);
                historyEntries.computeIfAbsent(l.categoryId(), k -> new java.util.HashSet<>()).add(l.entryId());
                if (l.date().getDayOfMonth() > clock.elapsed()) {
                    usualRest.merge(l.categoryId(), l.net().divide(BigDecimal.valueOf(3), 6, RoundingMode.HALF_UP), BigDecimal::add);
                }
            }
        }
        Map<Long, List<PostedLine>> monthLines = books.budgetLines().stream()
                .filter(l -> l.categoryId() != null && YearMonth.from(l.date()).equals(month))
                .sorted(Comparator.comparing(PostedLine::date))
                .collect(Collectors.groupingBy(PostedLine::categoryId));

        List<BudgetLine> lines = new ArrayList<>();
        for (Category c : books.categoriesOf(CategoryKind.EXPENSE)) {
            Budget b = byCategory.get(c.getId());
            BigDecimal actual = spent.getOrDefault(c.getId(), Money.ZERO);
            BigDecimal avg = last3.getOrDefault(c.getId(), Money.ZERO).divide(BigDecimal.valueOf(3), 2, RoundingMode.HALF_UP);
            if (b == null && actual.signum() == 0) {
                continue;
            }
            lines.add(b == null ? unbudgeted(c, actual, avg)
                    : line(c, b, actual, avg, clock, monthLines.getOrDefault(c.getId(), List.of()),
                            hasHistory.containsKey(c.getId()) ? usualRest.getOrDefault(c.getId(), Money.ZERO).max(Money.ZERO) : null,
                            historyEntries.getOrDefault(c.getId(), java.util.Set.of()).size() <= 6 && hasHistory.containsKey(c.getId())));
        }
        lines.sort(Comparator.comparing((BudgetLine l) -> l.budgetId() == null).thenComparing(BudgetLine::categoryCode));

        List<BudgetLine> set = lines.stream().filter(l -> l.budgetId() != null).toList();
        BigDecimal totalLimit = sum(set, BudgetLine::monthlyLimit);
        BigDecimal totalSpent = sum(set, BudgetLine::spent);
        BigDecimal unbudgeted = sum(lines.stream().filter(l -> l.budgetId() == null).toList(), BudgetLine::spent);
        List<BudgetLine> committed = set.stream().filter(BudgetLine::committed).toList();
        BigDecimal committedTotal = sum(committed, BudgetLine::monthlyLimit);
        BigDecimal committedPaid = committed.stream().map(l -> l.spent().min(l.monthlyLimit())).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal projectedTotal = sum(set, BudgetLine::projected);
        List<Budget> previous = forMonth(month.minusMonths(1));

        return new BudgetSummary(month.toString(), totalLimit, totalSpent, totalLimit.subtract(totalSpent),
                Money.percent(totalSpent, totalLimit), unbudgeted, lines,
                clock.days, clock.elapsed, clock.left, projectedTotal, committedTotal, committedPaid,
                committedTotal.subtract(committedPaid).max(Money.ZERO), previous.size(),
                previous.stream().map(Budget::getMonthlyLimit).reduce(Money.ZERO, BigDecimal::add),
                alerts(lines, clock, totalLimit, projectedTotal, committedTotal.subtract(committedPaid).max(Money.ZERO), unbudgeted));
    }

    /** Where we are in the month: days in it, days gone (today included) and days still to come. */
    private record Clock(YearMonth month, LocalDate today, int days, int elapsed, int left, boolean current, boolean past) {
        Clock(YearMonth month, LocalDate today) {
            this(month, today, month.lengthOfMonth(),
                    month.isBefore(YearMonth.from(today)) ? month.lengthOfMonth() : month.isAfter(YearMonth.from(today)) ? 0 : today.getDayOfMonth(),
                    month.isBefore(YearMonth.from(today)) ? 0 : month.isAfter(YearMonth.from(today)) ? month.lengthOfMonth()
                            : month.lengthOfMonth() - today.getDayOfMonth(),
                    month.equals(YearMonth.from(today)), month.isBefore(YearMonth.from(today)));
        }
    }

    private static BudgetLine unbudgeted(Category c, BigDecimal actual, BigDecimal avg) {
        return new BudgetLine(null, c.getId(), c.getCode(), c.getName(), null, null, actual, null, null,
                avg, BudgetHealth.UNBUDGETED, null, null, false, null, null, null, null, null, null, actual,
                null, null, null, null);
    }

    /**
     * @param usualRest what the category usually costs from tomorrow to month end (3-month history), or null without
     *                  history. It keeps a bill paid early in the month (power, broadband) from being projected again.
     * @param billLike  one or two payments a month in the last 3 months (a bill): once the usual amount is paid the
     *                  month is done, and paying it early is not "spending ahead of pace"
     */
    private BudgetLine line(Category c, Budget b, BigDecimal actual, BigDecimal avg, Clock clock, List<PostedLine> spending,
                            BigDecimal usualRest, boolean billLike) {
        BigDecimal limit = b.getMonthlyLimit();
        BigDecimal used = Money.percent(actual, limit);
        BudgetHealth health = used.compareTo(Money.HUNDRED) > 0 ? BudgetHealth.OVER
                : used.compareTo(BigDecimal.valueOf(b.getAlertPercent())) >= 0 ? BudgetHealth.WARNING : BudgetHealth.OK;
        boolean committed = Boolean.TRUE.equals(b.getCommitted());

        if (committed) {
            // paid on the day the month's payments reached the amount
            LocalDate paidOn = null;
            BigDecimal running = BigDecimal.ZERO;
            for (PostedLine l : spending) {
                running = running.add(l.net());
                if (paidOn == null && running.compareTo(limit.multiply(PAID_SHARE)) >= 0) {
                    paidOn = l.date();
                }
            }
            LocalDate due = b.getDueDay() == null ? clock.month().atEndOfMonth()
                    : clock.month().atDay(Math.min(b.getDueDay(), clock.days()));
            String status;
            if (paidOn != null) {
                status = "PAID";
            } else if (!clock.today().isBefore(due.plusDays(1)) || clock.past()) {
                status = "OVERDUE";
            } else if (ChronoUnit.DAYS.between(clock.today(), due) <= 3 && !clock.month().isAfter(YearMonth.from(clock.today()))) {
                status = actual.signum() > 0 ? "PARTLY_PAID" : "DUE_SOON";
            } else {
                status = actual.signum() > 0 ? "PARTLY_PAID" : "DUE";
            }
            health = status.equals("OVERDUE") ? BudgetHealth.OVER : status.equals("DUE_SOON") ? BudgetHealth.WARNING
                    : actual.compareTo(limit.multiply(new BigDecimal("1.02"))) > 0 ? BudgetHealth.WARNING : BudgetHealth.OK;
            String insight = switch (status) {
                case "PAID" -> "Paid on " + day(paidOn) + (actual.compareTo(limit) > 0 ? ", " + money(actual.subtract(limit)) + " more than planned" : "");
                case "OVERDUE" -> money(limit.subtract(actual).max(BigDecimal.ZERO)) + " overdue since " + day(due);
                case "DUE_SOON" -> "Due " + relative(clock.today(), due);
                case "PARTLY_PAID" -> money(limit.subtract(actual)) + " still to pay by " + day(due);
                default -> "Due on " + day(due);
            };
            return new BudgetLine(b.getId(), c.getId(), c.getCode(), c.getName(), limit, b.getAlertPercent(), actual,
                    limit.subtract(actual), used, avg, health, b.getNotes(), b.getVersion(),
                    true, b.getDueDay(), due, status, paidOn, null, null, actual.max(limit), null, null, null, insight);
        }

        // ---- pace: the rest of the month is projected from what usually happens in it (history), and only
        //      without history from this month's daily rate
        BigDecimal expected = Money.round(limit.multiply(BigDecimal.valueOf(clock.elapsed()))
                .divide(BigDecimal.valueOf(clock.days()), 6, RoundingMode.HALF_UP));
        BigDecimal daily = clock.elapsed() == 0 ? Money.ZERO
                : actual.divide(BigDecimal.valueOf(clock.elapsed()), 2, RoundingMode.HALF_UP);
        BigDecimal projected;
        if (clock.past()) {
            projected = actual;
        } else if (clock.elapsed() == 0) {
            projected = avg.signum() > 0 ? avg : Money.ZERO;
        } else if (billLike && actual.compareTo(avg.multiply(new BigDecimal("0.8"))) >= 0) {
            projected = actual;   // this month's bill is paid
        } else if (billLike) {
            projected = Money.round(actual.add(usualRest.min(avg.subtract(actual).max(BigDecimal.ZERO))));
        } else if (usualRest != null) {
            // this month running hotter than usual so far? scale the usual rest by how much hotter (at most 1.5x)
            BigDecimal usualSoFar = avg.subtract(usualRest).max(BigDecimal.ONE);
            BigDecimal heat = actual.divide(usualSoFar, 6, RoundingMode.HALF_UP).max(BigDecimal.ONE).min(new BigDecimal("1.5"));
            projected = Money.round(actual.add(usualRest.multiply(heat)));
        } else {
            projected = Money.round(actual.add(daily.multiply(BigDecimal.valueOf(clock.left()))));
        }
        BigDecimal safe = clock.left() > 0 ? limit.subtract(actual).max(BigDecimal.ZERO)
                .divide(BigDecimal.valueOf(clock.left()), 2, RoundingMode.HALF_UP) : Money.ZERO;
        String pace;
        if (clock.month().isAfter(YearMonth.from(clock.today()))) {
            pace = "NOT_STARTED";
        } else if (actual.compareTo(limit) > 0) {
            pace = "OVER";
        } else if (clock.past()) {
            pace = "UNDER";
        } else if (projected.compareTo(limit.multiply(new BigDecimal("1.03"))) > 0) {
            pace = "HEADING_OVER";
        } else if (!billLike && actual.compareTo(expected.multiply(new BigDecimal("1.2"))) > 0 && actual.compareTo(limit.multiply(new BigDecimal("0.25"))) > 0) {
            pace = "AHEAD_OF_PACE";
        } else {
            pace = "ON_TRACK";
        }
        LocalDate reached = null;
        if (pace.equals("HEADING_OVER") && clock.left() > 0) {
            BigDecimal perDay = projected.subtract(actual).divide(BigDecimal.valueOf(clock.left()), 6, RoundingMode.HALF_UP);
            if (perDay.signum() > 0) {
                long days = limit.subtract(actual).divide(perDay, 0, RoundingMode.CEILING).longValue();
                reached = clock.today().plusDays(Math.max(1, days));
            }
        }
        String insight = switch (pace) {
            case "OVER" -> money(actual.subtract(limit)) + " over the limit" + (clock.left() > 0 ? ", " + clock.left() + " days to go" : "");
            case "HEADING_OVER" -> "Heading for " + money(projected) + "; keep to " + money(safe) + "/day";
            case "AHEAD_OF_PACE" -> "Spending faster than planned: " + money(actual) + " vs " + money(expected) + " by today";
            case "UNDER" -> money(limit.subtract(actual)) + " under the limit";
            case "NOT_STARTED" -> "Starts " + day(clock.month().atDay(1));
            default -> billLike && actual.signum() > 0 && projected.compareTo(actual) == 0
                    ? "This month's bill is paid; " + money(limit.subtract(actual)) + " spare"
                    : clock.left() > 0 ? money(safe) + "/day keeps it on track" : "Within the limit";
        };
        return new BudgetLine(b.getId(), c.getId(), c.getCode(), c.getName(), limit, b.getAlertPercent(), actual,
                limit.subtract(actual), used, avg, health, b.getNotes(), b.getVersion(),
                false, null, null, null, null, pace, expected, projected, daily, safe, reached, insight);
    }

    // ================================================================== alerts

    /** The few things worth knowing this month, most urgent first; each says what to do. */
    private List<BudgetAlert> alerts(List<BudgetLine> lines, Clock clock, BigDecimal totalLimit, BigDecimal projectedTotal,
                                     BigDecimal committedOutstanding, BigDecimal unbudgeted) {
        List<BudgetAlert> critical = new ArrayList<>(), warning = new ArrayList<>(), info = new ArrayList<>(), good = new ArrayList<>();
        String monthName = clock.month().getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
        // budgets with room to spare this month, for "move money from" hints
        List<BudgetLine> slack = lines.stream()
                .filter(l -> l.budgetId() != null && !l.committed() && l.projected() != null
                        && l.monthlyLimit().subtract(l.projected()).compareTo(new BigDecimal("500")) > 0)
                .sorted(Comparator.comparing((BudgetLine l) -> l.monthlyLimit().subtract(l.projected())).reversed())
                .toList();

        for (BudgetLine l : lines) {
            if (l.budgetId() == null) {
                continue;
            }
            String name = l.categoryName();
            if (l.committed()) {
                BigDecimal open = l.monthlyLimit().subtract(l.spent()).max(BigDecimal.ZERO);
                switch (l.paymentStatus()) {
                    case "OVERDUE" -> critical.add(new BudgetAlert("critical", l.categoryId(), name + " is overdue",
                            money(open) + " was due on " + day(l.dueDate()) + (l.spent().signum() > 0 ? " (" + money(l.spent()) + " paid so far)" : "")
                                    + (clock.current() ? ", " + ChronoUnit.DAYS.between(l.dueDate(), clock.today()) + " day(s) ago." : "."),
                            clock.past() ? "It was never recorded in " + monthName + ". If it was paid, add the expense; if not, pay it first thing."
                                    : "Pay it today to avoid late fees, then record it as an expense in " + name + "."));
                    case "DUE_SOON", "PARTLY_PAID" -> {
                        if (l.paymentStatus().equals("DUE_SOON") || ChronoUnit.DAYS.between(clock.today(), l.dueDate()) <= 3) {
                            warning.add(new BudgetAlert("warning", l.categoryId(), name + " is due " + relative(clock.today(), l.dueDate()),
                                    money(open) + " to pay by " + day(l.dueDate()) + ".",
                                    "Keep " + money(open) + " in the account you pay it from."));
                        }
                    }
                    default -> { }
                }
                if (l.paymentStatus().equals("PAID") && l.spent().compareTo(l.monthlyLimit().multiply(new BigDecimal("1.02"))) > 0) {
                    info.add(new BudgetAlert("info", l.categoryId(), name + " cost more than planned",
                            "Paid " + money(l.spent()) + " against " + money(l.monthlyLimit()) + ".",
                            "If this is the new normal, raise the committed amount for next month."));
                }
                continue;
            }
            switch (l.pace()) {
                case "OVER" -> {
                    BigDecimal over = l.spent().subtract(l.monthlyLimit());
                    String hint = clock.left() == 0 ? "Set next month's limit nearer " + money(roundUp(l.spent())) + " or plan a cut."
                            : slack.stream().filter(s -> !s.categoryId().equals(l.categoryId())
                                    && s.monthlyLimit().subtract(s.projected()).compareTo(over) >= 0).findFirst()
                            .map(s -> money(s.monthlyLimit().subtract(s.projected())) + " is likely to stay unused in "
                                    + s.categoryName() + ": move " + money(over) + " of it here to stay balanced.")
                            .orElse("Hold further " + name.toLowerCase(Locale.ROOT) + " spending until " + monthName + " ends, "
                                    + clock.left() + " day(s) away.");
                    critical.add(new BudgetAlert("critical", l.categoryId(), name + " is over budget by " + money(over),
                            money(l.spent()) + " spent of " + money(l.monthlyLimit()) + " (" + pct(l.usedPercent()) + ")"
                                    + (clock.left() > 0 ? " with " + clock.left() + " day(s) still to go." : "."), hint));
                }
                case "HEADING_OVER" -> {
                    BigDecimal over = l.projected().subtract(l.monthlyLimit());
                    warning.add(new BudgetAlert("warning", l.categoryId(), name + " is on course to overshoot by " + money(over),
                            "You've been spending about " + money(l.dailyAverage()) + " a day; at this pace it ends near "
                                    + money(l.projected()) + " against " + money(l.monthlyLimit())
                                    + (l.limitReachedOn() != null ? ", crossing the limit around " + day(l.limitReachedOn()) : "") + ".",
                            "Keep to " + money(l.safePerDay()) + " a day for the remaining " + clock.left() + " day(s) to stay within budget."));
                }
                case "AHEAD_OF_PACE" -> info.add(new BudgetAlert("info", l.categoryId(), name + " is running ahead of plan",
                        money(l.spent()) + " spent; by today the plan was " + money(l.expectedByToday()) + " ("
                                + pct(Money.percent(l.spent().subtract(l.expectedByToday()), l.expectedByToday())) + " ahead).",
                        "Still fine if a big purchase is behind it; " + money(l.safePerDay()) + " a day from here keeps it on track."));
                default -> { }
            }
            boolean billPaid = l.projected() != null && l.projected().compareTo(l.spent()) == 0 && l.spent().signum() > 0;
            if (l.health() == BudgetHealth.WARNING && l.pace().equals("ON_TRACK") && !billPaid) {
                info.add(new BudgetAlert("info", l.categoryId(), name + " passed its " + l.alertPercent() + "% alert",
                        money(l.remaining()) + " left for the rest of " + monthName + ".", null));
            }
        }

        // ---- the month as a whole
        if (totalLimit.signum() > 0 && !clock.month().isAfter(YearMonth.from(clock.today()))) {
            BigDecimal gap = projectedTotal.subtract(totalLimit);
            if (gap.compareTo(totalLimit.multiply(new BigDecimal("0.02"))) > 0 && !clock.past()) {
                warning.add(new BudgetAlert("warning", null, "This month is heading " + money(gap) + " over budget",
                        "All budgets together are on course for " + money(projectedTotal) + " against " + money(totalLimit) + ".",
                        critical.isEmpty() && warning.isEmpty() ? null : "Start with the categories flagged above."));
            } else if (clock.current()) {
                good.add(new BudgetAlert("good", null, "On track for " + monthName,
                        "Likely to finish near " + money(projectedTotal) + " of " + money(totalLimit)
                                + (gap.signum() < 0 ? ", leaving about " + money(gap.negate()) + " to save." : "."), null));
            } else if (clock.past()) {
                good.add(new BudgetAlert(gap.signum() > 0 ? "warning" : "good", null,
                        monthName + " closed " + (gap.signum() > 0 ? money(gap) + " over budget" : money(gap.negate()) + " under budget"),
                        money(projectedTotal) + " spent against " + money(totalLimit) + ".", null));
            }
        }
        if (committedOutstanding.signum() > 0 && clock.current()) {
            info.add(new BudgetAlert("info", null, money(committedOutstanding) + " of committed payments still to make",
                    "Set it aside first; only the rest is free to spend this month.", null));
        }
        if (unbudgeted.compareTo(new BigDecimal("1000")) > 0) {
            info.add(new BudgetAlert("info", null, money(unbudgeted) + " spent outside any budget",
                    "Give those categories a budget so nothing slips past the plan.", null));
        }
        List<BudgetAlert> all = new ArrayList<>(critical);
        all.addAll(warning);
        all.addAll(info);
        all.addAll(good);
        return all;
    }

    // ================================================================== chit payments

    /** One chit installment as the budget counts it: the cash that left the account. */
    public record ChitPaymentRow(Long entryId, String entryNo, LocalDate date, String narration, String party,
                                 Long chitId, String chitName, BigDecimal amount, Long paidFromId, String paidFrom) {
    }

    /** The installments counted under Chit Payments between two dates, oldest first. */
    public List<ChitPaymentRow> chitPayments(LocalDate from, LocalDate to) {
        LedgerSnapshot books = ledger.snapshot();
        Category chitPayments = books.chitPaymentsCategory();
        if (chitPayments == null) {
            return List.of();
        }
        return books.budgetLines().stream()
                .filter(l -> chitPayments.getId().equals(l.categoryId()) && !l.date().isBefore(from) && !l.date().isAfter(to))
                .sorted(Comparator.comparing(PostedLine::date).thenComparing(PostedLine::entryId))
                .map(l -> {
                    var chit = books.chit(l.chitId());
                    var account = books.account(l.accountId());
                    return new ChitPaymentRow(l.entryId(), l.entryNo(), l.date(), l.narration(),
                            chit == null ? null : chit.getOrganizer(), l.chitId(), chit == null ? null : chit.getName(),
                            Money.round(l.net()), l.accountId(), account == null ? null : account.getName());
                })
                .toList();
    }

    // ================================================================== changes

    /** Creates the budget for a category in a month, or updates it if one exists. */
    @Transactional
    public Budget save(BudgetRequest request) {
        Category category = categories.require(request.categoryId(), CategoryKind.EXPENSE);
        Long tenantId = UserContext.tenantId();
        String month = monthOf(request.month());
        Budget budget = budgets.findOne(tenantId, category.getId(), month).orElseGet(Budget::new);
        boolean existing = budget.getId() != null;
        budget.setTenantId(tenantId);
        budget.setCategoryId(category.getId());
        budget.setMonth(month);
        budget.setMonthlyLimit(Money.round(request.monthlyLimit()));
        budget.setAlertPercent(request.alertPercent() != null ? request.alertPercent() : 80);
        budget.setNotes(request.notes());
        budget.setCommitted(Boolean.TRUE.equals(request.committed()));
        budget.setDueDay(Boolean.TRUE.equals(request.committed()) ? request.dueDay() : null);
        if (existing && request.version() != null) {
            budget.setVersion(request.version());   // someone else changed it meanwhile: refused
        }
        return budgets.save(budget);
    }

    /** Copies a month's budgets into another month; returns how many were copied. */
    @Transactional
    public int copy(String from, String to, boolean overwrite) {
        String source = monthOf(from);
        String target = monthOf(to);
        if (source.equals(target)) {
            throw new BusinessException("Pick two different months");
        }
        Long tenantId = UserContext.tenantId();
        List<Budget> sourceBudgets = budgets.findByMonth(tenantId, source);
        if (sourceBudgets.isEmpty()) {
            throw new BusinessException("There are no budgets in " + YearMonth.parse(source).getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH) + " to copy");
        }
        int copied = 0;
        for (Budget s : sourceBudgets) {
            Budget t = budgets.findOne(tenantId, s.getCategoryId(), target).orElse(null);
            if (t != null && !overwrite) {
                continue;
            }
            if (t == null) {
                t = new Budget();
                t.setTenantId(tenantId);
                t.setCategoryId(s.getCategoryId());
                t.setMonth(target);
            }
            t.setMonthlyLimit(s.getMonthlyLimit());
            t.setAlertPercent(s.getAlertPercent());
            t.setNotes(s.getNotes());
            t.setCommitted(s.getCommitted());
            t.setDueDay(s.getDueDay());
            budgets.save(t);
            copied++;
        }
        return copied;
    }

    @Transactional
    public void delete(Long id) {
        Budget budget = budgets.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Budget", id));
        budgets.delete(budget);
    }

    /** The budgets of a month. */
    public List<Budget> forMonth(YearMonth month) {
        return budgets.findByMonth(UserContext.tenantId(), month.toString());
    }

    /** This month's budgets. */
    public List<Budget> all() {
        return forMonth(YearMonth.now());
    }

    // ================================================================== helpers

    private static String monthOf(String month) {
        if (month == null || month.isBlank()) {
            return YearMonth.now().toString();
        }
        try {
            return YearMonth.parse(month.trim()).toString();
        } catch (RuntimeException e) {
            throw new BusinessException("Month must look like 2026-10");
        }
    }

    private static BigDecimal sum(List<BudgetLine> lines, Function<BudgetLine, BigDecimal> value) {
        return lines.stream().map(value).map(Money::nz).reduce(Money.ZERO, BigDecimal::add);
    }

    private static BigDecimal roundUp(BigDecimal v) {
        return v.divide(BigDecimal.valueOf(500), 0, RoundingMode.CEILING).multiply(BigDecimal.valueOf(500));
    }

    private static String pct(BigDecimal v) {
        return v.setScale(0, RoundingMode.HALF_UP).toPlainString() + "%";
    }

    private static String day(LocalDate d) {
        return d.getDayOfMonth() + " " + d.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
    }

    private static String relative(LocalDate today, LocalDate d) {
        long days = ChronoUnit.DAYS.between(today, d);
        return days == 0 ? "today" : days == 1 ? "tomorrow" : days < 0 ? Math.abs(days) + " days ago" : "in " + days + " days (" + day(d) + ")";
    }

    /** Amount in the tenant's currency, Indian digit grouping for INR. */
    static String money(BigDecimal value) {
        String currency = UserContext.current().map(u -> u.currency()).orElse("INR");
        String symbol = switch (currency == null ? "INR" : currency) {
            case "INR" -> "₹";
            case "USD" -> "$";
            case "EUR" -> "€";
            case "GBP" -> "£";
            default -> currency + " ";
        };
        long rounded = Money.nz(value).setScale(0, RoundingMode.HALF_UP).longValue();
        String sign = rounded < 0 ? "-" : "";
        rounded = Math.abs(rounded);
        if (!"INR".equals(currency)) {
            return sign + symbol + new DecimalFormat("#,##0", DecimalFormatSymbols.getInstance(Locale.ENGLISH)).format(rounded);
        }
        String digits = Long.toString(rounded);
        if (digits.length() <= 3) {
            return sign + symbol + digits;
        }
        String last3 = digits.substring(digits.length() - 3);
        StringBuilder rest = new StringBuilder(digits.substring(0, digits.length() - 3));
        for (int i = rest.length() - 2; i > 0; i -= 2) {
            rest.insert(i, ',');
        }
        return sign + symbol + rest + "," + last3;
    }
}
