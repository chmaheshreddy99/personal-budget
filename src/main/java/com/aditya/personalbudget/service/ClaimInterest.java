package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.type.DayCount;
import com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * Month-by-month interest on money lent or owed, worked out both ways at once:
 * <ul>
 *   <li><b>Simple</b>: principal still owed × rate × time. Interest never earns interest.</li>
 *   <li><b>Compound</b>: the same accrual, but on principal plus unpaid interest; the month's
 *       interest is added to the balance on each monthly anniversary of the loan.</li>
 * </ul>
 * Time is counted per {@link DayCount}: by default every month earns exactly rate / 12 whatever its length,
 * and part of a month is counted in 30-day months; or actual days / 365.
 * A repayment takes effect on its date: its principal part reduces what is owed and its interest part
 * settles accrued interest (the running month's first). Months run from the start date's day to the
 * same day next month. Months after today assume nothing more is repaid.
 */
final class ClaimInterest {

    private static final BigDecimal DAYS_X_100 = BigDecimal.valueOf(36500);
    private static final BigDecimal MONTHS_X_100 = BigDecimal.valueOf(1200);
    private static final int SCALE = 6;

    /** Every month of the schedule plus interest accrued up to today and up to the schedule end. */
    record Result(List<InterestPeriod> periods, BigDecimal simpleToDate, BigDecimal compoundToDate,
                  BigDecimal simpleTotal, BigDecimal compoundTotal) {
    }

    private ClaimInterest() {
    }

    /**
     * @param history repayments sorted by date
     * @param end     last day of the schedule: the settlement date, or the due date / some months ahead
     */
    static Result schedule(BigDecimal amount, BigDecimal rate, LocalDate start, List<ClaimRepayment> history,
                           LocalDate end, LocalDate today, DayCount dayCount) {
        List<InterestPeriod> periods = new ArrayList<>();
        if (rate.signum() <= 0 || !end.isAfter(start)) {
            return new Result(periods, Money.ZERO, Money.ZERO, Money.ZERO, Money.ZERO);
        }
        State s = new State(amount);
        BigDecimal simpleToDate = today.isAfter(start) ? null : BigDecimal.ZERO;
        BigDecimal compoundToDate = simpleToDate;
        int next = 0;   // next repayment to apply

        LocalDate from = start;
        for (int k = 1; from.isBefore(end); k++) {
            LocalDate to = start.plusMonths(k).isAfter(end) ? end : start.plusMonths(k);
            boolean fullMonth = to.equals(start.plusMonths(k));
            LocalDate periodFrom = from;
            BigDecimal opening = s.principal;
            BigDecimal paidPrincipal = BigDecimal.ZERO, paidInterest = BigDecimal.ZERO;
            BigDecimal simple = BigDecimal.ZERO, compound = BigDecimal.ZERO;

            TreeSet<LocalDate> cuts = new TreeSet<>();
            for (ClaimRepayment r : history) {
                if (r.getPaidDate().isAfter(from) && r.getPaidDate().isBefore(to)) {
                    cuts.add(r.getPaidDate());
                }
            }
            if (today.isAfter(from) && today.isBefore(to)) {
                cuts.add(today);
            }
            cuts.add(to);

            LocalDate cursor = from;
            for (LocalDate cut : cuts) {
                while (next < history.size() && !history.get(next).getPaidDate().isAfter(cursor)) {
                    ClaimRepayment r = history.get(next++);
                    paidPrincipal = paidPrincipal.add(r.getPrincipal());
                    paidInterest = paidInterest.add(r.getInterest());
                    s.repay(r.getPrincipal(), r.getInterest());
                }
                BigDecimal time = time(dayCount, cursor, cut, periodFrom, to, fullMonth);
                if (time.signum() > 0 && s.principal.signum() > 0) {
                    BigDecimal si = accrue(s.principal, rate, time, dayCount);
                    BigDecimal ci = accrue(s.principal.add(s.capitalised), rate, time, dayCount);
                    simple = simple.add(si);
                    compound = compound.add(ci);
                    s.pending = s.pending.add(ci);
                    s.cumSimple = s.cumSimple.add(si);
                    s.cumCompound = s.cumCompound.add(ci);
                }
                if (simpleToDate == null && !cut.isBefore(today)) {
                    simpleToDate = s.cumSimple;
                    compoundToDate = s.cumCompound;
                }
                cursor = cut;
            }
            s.capitalised = s.capitalised.add(s.pending);   // monthly compounding
            s.pending = BigDecimal.ZERO;

            String status = !to.isAfter(today) ? "EARNED" : !from.isAfter(today) ? "ACCRUING" : "PROJECTED";
            periods.add(new InterestPeriod(k, from, to, Money.round(opening), Money.round(paidPrincipal),
                    Money.round(paidInterest), Money.round(s.principal), Money.round(simple), Money.round(compound),
                    Money.round(s.cumSimple), Money.round(s.cumCompound),
                    Money.round(s.cumCompound.subtract(s.cumSimple)), status, null, null));
            from = to;
        }
        if (simpleToDate == null) {
            simpleToDate = s.cumSimple;
            compoundToDate = s.cumCompound;
        }
        return new Result(periods, Money.round(simpleToDate), Money.round(compoundToDate),
                Money.round(s.cumSimple), Money.round(s.cumCompound));
    }

    /** Running balances while walking the schedule. */
    private static final class State {
        BigDecimal principal;
        BigDecimal capitalised = BigDecimal.ZERO;   // compound interest already added to the balance
        BigDecimal pending = BigDecimal.ZERO;       // compound interest of the running month
        BigDecimal cumSimple = BigDecimal.ZERO;
        BigDecimal cumCompound = BigDecimal.ZERO;

        State(BigDecimal principal) {
            this.principal = principal;
        }

        void repay(BigDecimal principalPart, BigDecimal interestPart) {
            principal = principal.subtract(principalPart);
            BigDecimal fromPending = interestPart.min(pending);
            pending = pending.subtract(fromPending);
            capitalised = capitalised.subtract(interestPart.subtract(fromPending)).max(BigDecimal.ZERO);
        }
    }

    /**
     * The length of a stretch of time: days for {@link DayCount#ACTUAL}; months for {@link DayCount#MONTHLY},
     * where a whole schedule month is exactly 1 (its stretches share it by 30/360 days) and a part month
     * at the end counts 30/360 days out of 30.
     */
    static BigDecimal time(DayCount dayCount, LocalDate from, LocalDate to, LocalDate periodFrom, LocalDate periodTo,
                           boolean fullMonth) {
        if (!to.isAfter(from)) {
            return BigDecimal.ZERO;
        }
        if (dayCount == DayCount.ACTUAL) {
            return BigDecimal.valueOf(ChronoUnit.DAYS.between(from, to));
        }
        long part = days360(from, to);
        long whole = fullMonth ? days360(periodFrom, periodTo) : 30;
        if (whole <= 0) {   // e.g. 30 Jan -> 28 Feb counted as 28 days: fall back to actual days
            part = ChronoUnit.DAYS.between(from, to);
            whole = ChronoUnit.DAYS.between(periodFrom, periodTo);
        }
        return BigDecimal.valueOf(part).divide(BigDecimal.valueOf(whole), SCALE + 4, RoundingMode.HALF_UP);
    }

    /** Days between two dates counting every month as 30 days (30E/360). */
    static long days360(LocalDate from, LocalDate to) {
        int d1 = Math.min(from.getDayOfMonth(), 30);
        int d2 = Math.min(to.getDayOfMonth(), 30);
        return 360L * (to.getYear() - from.getYear()) + 30L * (to.getMonthValue() - from.getMonthValue()) + (d2 - d1);
    }

    private static BigDecimal accrue(BigDecimal base, BigDecimal rate, BigDecimal time, DayCount dayCount) {
        return base.multiply(rate).multiply(time)
                .divide(dayCount == DayCount.ACTUAL ? DAYS_X_100 : MONTHS_X_100, SCALE, RoundingMode.HALF_UP);
    }
}
