package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.InterestFrequency;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class BankInterestDtos {

    private BankInterestDtos() {
    }

    /** A bank account's interest plan. {@code interestFrom} empty: from the start of the current period. */
    public record InterestSettingsRequest(@PositiveOrZero @DecimalMax("100") BigDecimal interestRate,
                                          @NotNull InterestFrequency frequency, boolean autoPost, LocalDate interestFrom, Long version) {
    }

    /** Credits a finished period. {@code amount} empty: what it worked out to; {@code date} empty: the period's last day. */
    public record PostInterestRequest(@NotNull LocalDate from, @NotNull LocalDate to, @Positive BigDecimal amount, LocalDate date) {
    }

    /** A month of the account: the average of its daily closing balances (so far, for this month). */
    public record MonthBalance(String month, int days, BigDecimal average, BigDecimal lowest, BigDecimal highest, BigDecimal closing,
                               BigDecimal interest, boolean running) {
    }

    /** A period of interest; state: RUNNING (not finished), DUE (finished, not posted), POSTED or SKIPPED (undone, kept off the automatic posting). */
    public record InterestPeriod(String label, LocalDate from, LocalDate to, int days, BigDecimal average, BigDecimal calculated, String state,
                                 Long postingId, BigDecimal amount, Long entryId, String entryNo, LocalDate entryDate, boolean automatic) {
    }

    /** The dates asked for, as far as the account goes: their average of daily closing balances, and interest earned and posted in them. */
    public record InterestRange(LocalDate from, LocalDate to, int days, BigDecimal average, BigDecimal lowest, BigDecimal highest,
                                BigDecimal earned, BigDecimal posted) {
    }

    /**
     * An account's plan and, for the dates asked for, its range, the months and the periods touching it. What waits to be
     * posted ({@code dueCount}, {@code dueAmount}) is of all dates, so no filter hides it. {@code firstEntry} empty: nothing on the account yet.
     */
    public record InterestOverview(Long accountId, BigDecimal interestRate, InterestFrequency frequency, boolean autoPost,
                                   LocalDate interestFrom, Long version, LocalDate firstEntry, InterestRange range,
                                   int dueCount, BigDecimal dueAmount,
                                   List<MonthBalance> months, List<InterestPeriod> periods, int postedNow) {
    }
}
