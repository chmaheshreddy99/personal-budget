package com.aditya.personalbudget.domain.type;

/**
 * How interest on money lent or borrowed counts time.
 * <ul>
 *   <li>{@link #MONTHLY}: every month is worth exactly one month of interest (rate / 12), whether it has
 *       28, 30 or 31 days; part of a month is counted in 30-day months (30/360).</li>
 *   <li>{@link #ACTUAL}: interest for the actual number of days, rate / 365 a day.</li>
 * </ul>
 */
public enum DayCount {
    MONTHLY("30 days a month"),
    ACTUAL("Actual days / 365");

    private final String label;

    DayCount(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
