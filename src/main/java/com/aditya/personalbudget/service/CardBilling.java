package com.aditya.personalbudget.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * A credit card's billing cycles, worked out from its entries the way Indian card issuers bill. A statement is made on
 * the same day each month (a shorter month uses its last day) and covers the day after the last statement up to that
 * day. Its total due is the card's balance on the statement date, payable by the due date, a fixed number of days later.
 * A payment still counts as in time for {@value #GRACE_DAYS} days after the due date (RBI: no late charge or bureau report
 * before that, though the days past due count from the due date). The minimum due is an estimate: issuers commonly ask
 * for 5%, with a floor of Rs. 200, and add EMIs and fees that are not known here.
 */
public final class CardBilling {

    public static final int DEFAULT_DAYS_TO_PAY = 20;
    public static final int GRACE_DAYS = 3;
    private static final int DUE_SOON_DAYS = 5;
    private static final BigDecimal MINIMUM_SHARE = new BigDecimal("0.05");
    private static final BigDecimal MINIMUM_FLOOR = new BigDecimal("200");

    private CardBilling() {
    }

    /** An entry on the card: what it charged (added to what is owed) and what it credited (a payment or refund). */
    public record Line(LocalDate date, BigDecimal charge, BigDecimal credit) {
    }

    /**
     * One billing cycle.
     *
     * @param payableMonth the month its due date falls in (yyyy-MM)
     * @param closing      the balance on the statement date (negative: the card is in credit)
     * @param totalDue     what the statement asks for: the closing balance, never below zero
     * @param paid         the part of the total due covered by payments after the statement date
     * @param status       RUNNING, NO_DUES, PAID, PAID_LATE, CARRIED (left unpaid, so part of the next bill), DUE,
     *                     DUE_SOON, PARTLY_PAID, GRACE, MINIMUM_PAID or OVERDUE
     */
    public record Statement(LocalDate cycleFrom, LocalDate statementDate, LocalDate dueDate, LocalDate graceUntil, String payableMonth,
                            BigDecimal previousBalance, BigDecimal charges, BigDecimal credits, BigDecimal closing,
                            BigDecimal totalDue, BigDecimal minimumDue, BigDecimal paid, BigDecimal outstanding,
                            String status, long daysToDue, int entries, boolean running) {
    }

    /**
     * What a card has been billed.
     *
     * @param running        the cycle still open: its total due is the estimate of the next bill so far
     * @param statements     the statements already made, latest first
     * @param averageCharges what a finished cycle usually adds (the last three)
     */
    public record Bills(boolean configured, Integer billingDay, Integer daysToPay, LocalDate today, Statement running,
                        List<Statement> statements, BigDecimal averageCharges) {

        public static Bills notConfigured(LocalDate today) {
            return new Bills(false, null, null, today, null, List.of(), Money.ZERO);
        }
    }

    /** The statement date in a month. */
    public static LocalDate statementDateIn(YearMonth month, int billingDay) {
        return month.atDay(Math.min(billingDay, month.lengthOfMonth()));
    }

    /** The first statement date on or after {@code day}: the end of the cycle {@code day} is in. */
    public static LocalDate cycleEnd(LocalDate day, int billingDay) {
        LocalDate inMonth = statementDateIn(YearMonth.from(day), billingDay);
        return inMonth.isBefore(day) ? statementDateIn(YearMonth.from(day).plusMonths(1), billingDay) : inMonth;
    }

    /** The open cycle and at most {@code count} statements, as far back as the card has entries. */
    public static Bills bills(int billingDay, Integer daysToPay, List<Line> entries, LocalDate today, int count) {
        int days = daysToPay == null ? DEFAULT_DAYS_TO_PAY : daysToPay;
        List<Line> lines = entries.stream().sorted(Comparator.comparing(Line::date)).toList();
        LocalDate runningEnd = cycleEnd(today, billingDay);
        Statement running = cycle(billingDay, days, runningEnd, lines, today, true, false);
        List<Statement> statements = new ArrayList<>();
        if (!lines.isEmpty()) {
            LocalDate first = lines.get(0).date();
            YearMonth month = YearMonth.from(runningEnd);
            for (int i = 1; i <= count; i++) {
                LocalDate end = statementDateIn(month.minusMonths(i), billingDay);
                if (end.isBefore(first)) {
                    break;
                }
                statements.add(cycle(billingDay, days, end, lines, today, false, i == 1));
            }
        }
        List<Statement> recent = statements.stream().limit(3).toList();
        BigDecimal average = recent.isEmpty() ? Money.ZERO
                : recent.stream().map(Statement::charges).reduce(BigDecimal.ZERO, BigDecimal::add)
                        .divide(BigDecimal.valueOf(recent.size()), 2, RoundingMode.HALF_UP);
        return new Bills(true, billingDay, days, today, running, statements, average);
    }

    private static Statement cycle(int billingDay, int days, LocalDate end, List<Line> lines, LocalDate today, boolean running, boolean latest) {
        LocalDate from = statementDateIn(YearMonth.from(end).minusMonths(1), billingDay).plusDays(1);
        LocalDate due = end.plusDays(days);
        LocalDate grace = due.plusDays(GRACE_DAYS);
        BigDecimal previous = Money.ZERO, charges = Money.ZERO, credits = Money.ZERO, paidSince = Money.ZERO, paidInTime = Money.ZERO;
        int count = 0;
        for (Line l : lines) {
            if (l.date().isBefore(from)) {
                previous = previous.add(l.charge()).subtract(l.credit());
            } else if (!l.date().isAfter(end)) {
                charges = charges.add(l.charge());
                credits = credits.add(l.credit());
                count++;
            } else if (!l.date().isAfter(today)) {
                paidSince = paidSince.add(l.credit());
                if (!l.date().isAfter(grace)) {
                    paidInTime = paidInTime.add(l.credit());
                }
            }
        }
        BigDecimal closing = previous.add(charges).subtract(credits);
        BigDecimal total = closing.max(Money.ZERO);
        BigDecimal paid = running ? Money.ZERO : paidSince.min(total);
        BigDecimal outstanding = total.subtract(paid);
        BigDecimal minimum = total.signum() == 0 ? Money.ZERO
                : total.multiply(MINIMUM_SHARE).setScale(0, RoundingMode.CEILING).max(MINIMUM_FLOOR).min(total);
        long daysToDue = ChronoUnit.DAYS.between(today, due);
        String status = running ? "RUNNING" : status(total, outstanding, paid, paidInTime, minimum, latest, today, due, grace, daysToDue);
        return new Statement(from, end, due, grace, YearMonth.from(due).toString(), Money.round(previous), Money.round(charges), Money.round(credits),
                Money.round(closing), Money.round(total), Money.round(minimum), Money.round(paid), Money.round(outstanding), status, daysToDue, count, running);
    }

    private static String status(BigDecimal total, BigDecimal outstanding, BigDecimal paid, BigDecimal paidInTime, BigDecimal minimum, boolean latest,
                                 LocalDate today, LocalDate due, LocalDate grace, long daysToDue) {
        if (total.signum() == 0) {
            return "NO_DUES";
        }
        if (outstanding.signum() == 0) {
            return paidInTime.compareTo(total) >= 0 ? "PAID" : "PAID_LATE";
        }
        if (!latest) {
            return "CARRIED";
        }
        if (!today.isAfter(due)) {
            return daysToDue <= DUE_SOON_DAYS ? "DUE_SOON" : paid.signum() > 0 ? "PARTLY_PAID" : "DUE";
        }
        if (paid.compareTo(minimum) >= 0) {
            return "MINIMUM_PAID";
        }
        return today.isAfter(grace) ? "OVERDUE" : "GRACE";
    }
}
