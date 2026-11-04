package com.aditya.personalbudget.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** A credit card's billing cycles: dates, what each bill comes to, and where it stands as payments arrive. */
class CardBillingTests {

    private static CardBilling.Line spend(String date, int amount) {
        return new CardBilling.Line(LocalDate.parse(date), BigDecimal.valueOf(amount), BigDecimal.ZERO);
    }

    private static CardBilling.Line pay(String date, int amount) {
        return new CardBilling.Line(LocalDate.parse(date), BigDecimal.ZERO, BigDecimal.valueOf(amount));
    }

    private static void same(BigDecimal actual, int expected) {
        assertThat(actual).isEqualByComparingTo(BigDecimal.valueOf(expected));
    }

    @Test
    void aStatementDayPastTheMonthEndFallsOnItsLastDayAndCyclesJoinUp() {
        assertThat(CardBilling.statementDateIn(YearMonth.of(2026, 2), 31)).isEqualTo("2026-02-28");
        assertThat(CardBilling.statementDateIn(YearMonth.of(2028, 2), 31)).isEqualTo("2028-02-29");
        assertThat(CardBilling.cycleEnd(LocalDate.parse("2026-03-01"), 31)).isEqualTo("2026-03-31");

        var bills = CardBilling.bills(31, 20, List.of(spend("2026-01-15", 100)), LocalDate.parse("2026-03-10"), 6);
        assertThat(bills.statements().get(0).cycleFrom()).isEqualTo("2026-02-01");
        assertThat(bills.statements().get(0).statementDate()).isEqualTo("2026-02-28");
        assertThat(bills.statements().get(0).dueDate()).isEqualTo("2026-03-20");
        assertThat(bills.running().cycleFrom()).isEqualTo("2026-03-01");
    }

    @Test
    void theBillIsTheBalanceOnTheStatementDateAndTheDueDateFollowsIt() {
        // statement on the 15th, 20 days to pay; today is 20 Nov
        var lines = List.of(spend("2026-10-20", 8000), spend("2026-11-15", 2000), spend("2026-11-16", 500));
        var bills = CardBilling.bills(15, 20, lines, LocalDate.parse("2026-11-20"), 6);

        var bill = bills.statements().get(0);
        assertThat(bill.statementDate()).isEqualTo("2026-11-15");
        assertThat(bill.dueDate()).isEqualTo("2026-12-05");
        assertThat(bill.payableMonth()).isEqualTo("2026-12");
        same(bill.previousBalance(), 0);
        same(bill.charges(), 10000);   // a charge on the statement date itself is in this bill
        same(bill.totalDue(), 10000);
        same(bill.minimumDue(), 500);
        assertThat(bill.status()).isEqualTo("DUE");

        var open = bills.running();
        assertThat(open.statementDate()).isEqualTo("2026-12-15");
        same(open.previousBalance(), 10000);
        same(open.charges(), 500);
        same(open.totalDue(), 10500);
        assertThat(open.status()).isEqualTo("RUNNING");
    }

    @Test
    void statusFollowsThePaymentsAndTheDates() {
        var lines = List.of(spend("2026-10-20", 10000));
        // the bill of 15 Nov, due 5 Dec, past due beyond 8 Dec
        assertThat(status(lines, "2026-11-20")).isEqualTo("DUE");
        assertThat(status(lines, "2026-12-02")).isEqualTo("DUE_SOON");
        assertThat(status(lines, "2026-12-06")).isEqualTo("GRACE");
        assertThat(status(lines, "2026-12-09")).isEqualTo("OVERDUE");

        var part = List.of(spend("2026-10-20", 10000), pay("2026-11-20", 3000));
        assertThat(status(part, "2026-11-22")).isEqualTo("PARTLY_PAID");
        assertThat(status(part, "2026-12-09")).isEqualTo("MINIMUM_PAID");
        same(CardBilling.bills(15, 20, part, LocalDate.parse("2026-11-22"), 3).statements().get(0).outstanding(), 7000);

        assertThat(status(List.of(spend("2026-10-20", 10000), pay("2026-12-01", 10000)), "2026-12-09")).isEqualTo("PAID");
        // within the three days past due it still counts as in time; after them it does not
        assertThat(status(List.of(spend("2026-10-20", 10000), pay("2026-12-08", 10000)), "2026-12-14")).isEqualTo("PAID");
        assertThat(status(List.of(spend("2026-10-20", 10000), pay("2026-12-09", 10000)), "2026-12-14")).isEqualTo("PAID_LATE");
    }

    @Test
    void anUnpaidBillIsCarriedIntoTheNextAndAnOverpaymentIsNotDue() {
        var bills = CardBilling.bills(15, 20, List.of(spend("2026-09-20", 4000), spend("2026-10-20", 1000)), LocalDate.parse("2026-11-20"), 6);
        assertThat(bills.statements().get(0).statementDate()).isEqualTo("2026-11-15");
        same(bills.statements().get(0).totalDue(), 1000 + 4000);
        assertThat(bills.statements().get(1).status()).isEqualTo("CARRIED");

        var credit = CardBilling.bills(15, 20, List.of(spend("2026-09-20", 1000), pay("2026-09-25", 1500)), LocalDate.parse("2026-10-20"), 6);
        same(credit.statements().get(0).closing(), -500);
        same(credit.statements().get(0).totalDue(), 0);
        assertThat(credit.statements().get(0).status()).isEqualTo("NO_DUES");
    }

    @Test
    void aSmallBillHasAFlooredMinimumThatNeverPassesTheBill() {
        same(CardBilling.bills(15, 20, List.of(spend("2026-10-20", 1000)), LocalDate.parse("2026-11-20"), 1).statements().get(0).minimumDue(), 200);
        same(CardBilling.bills(15, 20, List.of(spend("2026-10-20", 150)), LocalDate.parse("2026-11-20"), 1).statements().get(0).minimumDue(), 150);
    }

    private static String status(List<CardBilling.Line> lines, String today) {
        return CardBilling.bills(15, 20, lines, LocalDate.parse(today), 3).statements().get(0).status();
    }
}
