package com.aditya.personalbudget.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * What is due on a payment schedule (a contract's stages and extra works, or a buyer's payment plan), what was paid
 * against each part, and the late payment interest.
 * <p>
 * Payments go to the parts in the order they fall due (the oldest first; parts not yet dated last), as they come in:
 * money paid early stands against the next part. Interest is simple, by the day, at {@code ratePerMonth}% a month on
 * what is still unpaid of a part, from {@code graceDays} after its due date until it is paid (or today).
 */
final class ConstructionDues {

    private ConstructionDues() {
    }

    /** A part of the schedule. dueDate empty: not due yet (a stage not done yet). */
    record Item(String key, String label, LocalDate dueDate, BigDecimal amount) {
    }

    /** Money received, without its interest part. */
    record Payment(LocalDate date, BigDecimal amount) {
    }

    /** status: PAID, UPCOMING (not due yet), DUE (due, within the grace days) or OVERDUE. */
    record Row(String key, String label, LocalDate dueDate, BigDecimal amount, BigDecimal paid, BigDecimal balance,
               BigDecimal interest, String status, LocalDate paidOn, long daysLate) {
    }

    /** due: what is due by today and unpaid; overdue: of it, past the grace days; advance: paid beyond the whole schedule. */
    record Result(List<Row> rows, BigDecimal total, BigDecimal paid, BigDecimal due, BigDecimal overdue, BigDecimal upcoming,
                  BigDecimal interest, BigDecimal advance) {
    }

    static Result compute(List<Item> items, List<Payment> payments, BigDecimal ratePerMonth, int graceDays, LocalDate today) {
        List<Item> order = new ArrayList<>(items);
        order.sort(Comparator.comparing((Item i) -> i.dueDate() == null ? LocalDate.MAX : i.dueDate()));
        int n = order.size();
        BigDecimal[] left = new BigDecimal[n];
        List<List<Object[]>> allocations = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            left[i] = Money.round(order.get(i).amount() == null ? Money.ZERO : order.get(i).amount());
            allocations.add(new ArrayList<>());
        }
        BigDecimal advance = Money.ZERO;
        List<Payment> paid = new ArrayList<>(payments);
        paid.sort(Comparator.comparing(Payment::date));
        for (Payment p : paid) {
            BigDecimal rest = Money.round(p.amount());
            for (int i = 0; i < n && rest.signum() > 0; i++) {
                if (left[i].signum() <= 0) continue;
                BigDecimal take = rest.min(left[i]);
                left[i] = left[i].subtract(take);
                rest = rest.subtract(take);
                allocations.get(i).add(new Object[]{p.date(), take});
            }
            advance = advance.add(rest);
        }
        BigDecimal rate = ratePerMonth == null ? Money.ZERO : ratePerMonth;
        List<Row> rows = new ArrayList<>();
        BigDecimal total = Money.ZERO, paidTotal = Money.ZERO, due = Money.ZERO, overdue = Money.ZERO, upcoming = Money.ZERO, interest = Money.ZERO;
        for (int i = 0; i < n; i++) {
            Item it = order.get(i);
            BigDecimal amount = Money.round(it.amount() == null ? Money.ZERO : it.amount());
            BigDecimal balance = left[i];
            BigDecimal got = amount.subtract(balance);
            LocalDate start = it.dueDate() == null ? null : it.dueDate().plusDays(graceDays);
            // interest: on what was unpaid, day by day, from the end of the grace days until each payment (or today)
            BigDecimal accrued = Money.ZERO;
            if (start != null && rate.signum() > 0) {
                BigDecimal unpaid = amount;
                LocalDate from = start;
                for (Object[] a : allocations.get(i)) {
                    LocalDate on = (LocalDate) a[0];
                    if (on.isAfter(from)) {
                        accrued = accrued.add(interest(unpaid, rate, from, on.isAfter(today) ? today : on));
                        from = on.isAfter(today) ? today : on;
                    }
                    unpaid = unpaid.subtract((BigDecimal) a[1]);
                }
                if (unpaid.signum() > 0 && today.isAfter(from)) accrued = accrued.add(interest(unpaid, rate, from, today));
            }
            accrued = Money.round(accrued);
            String status;
            if (balance.signum() <= 0) status = "PAID";
            else if (it.dueDate() == null || today.isBefore(it.dueDate())) status = "UPCOMING";
            else if (!today.isAfter(start)) status = "DUE";
            else status = "OVERDUE";
            LocalDate paidOn = balance.signum() <= 0 && !allocations.get(i).isEmpty()
                    ? (LocalDate) allocations.get(i).getLast()[0] : null;
            long late = "OVERDUE".equals(status) ? ChronoUnit.DAYS.between(it.dueDate(), today) : 0;
            rows.add(new Row(it.key(), it.label(), it.dueDate(), amount, got, balance, accrued, status, paidOn, late));
            total = total.add(amount);
            paidTotal = paidTotal.add(got);
            interest = interest.add(accrued);
            switch (status) {
                case "DUE" -> due = due.add(balance);
                case "OVERDUE" -> { due = due.add(balance); overdue = overdue.add(balance); }
                case "UPCOMING" -> upcoming = upcoming.add(balance);
                default -> { }
            }
        }
        return new Result(rows, total, paidTotal, due, overdue, upcoming, interest, advance);
    }

    private static BigDecimal interest(BigDecimal unpaid, BigDecimal ratePerMonth, LocalDate from, LocalDate to) {
        long days = ChronoUnit.DAYS.between(from, to);
        if (days <= 0 || unpaid.signum() <= 0) return Money.ZERO;
        return unpaid.multiply(ratePerMonth).multiply(BigDecimal.valueOf(days))
                .divide(BigDecimal.valueOf(3000), 4, RoundingMode.HALF_UP);
    }
}
