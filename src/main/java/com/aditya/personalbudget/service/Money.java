package com.aditya.personalbudget.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Small helpers for money arithmetic. All amounts are {@link BigDecimal} with 2 decimals.
 */
public final class Money {

    public static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2, RoundingMode.HALF_UP);
    public static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private Money() {
    }

    /** Null-safe: null becomes zero. */
    public static BigDecimal nz(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    public static BigDecimal round(BigDecimal value) {
        return nz(value).setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal of(double value) {
        return round(BigDecimal.valueOf(value));
    }

    public static boolean isPositive(BigDecimal value) {
        return value != null && value.signum() > 0;
    }

    /** part / whole * 100, rounded to one decimal; zero when whole is zero. */
    public static BigDecimal percent(BigDecimal part, BigDecimal whole) {
        if (whole == null || whole.signum() == 0) {
            return BigDecimal.ZERO;
        }
        return nz(part).multiply(HUNDRED).divide(whole, 1, RoundingMode.HALF_UP);
    }
}
