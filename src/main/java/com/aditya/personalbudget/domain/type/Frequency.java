package com.aditya.personalbudget.domain.type;

import java.time.LocalDate;

/**
 * How often a recurring transaction repeats.
 */
public enum Frequency {

    WEEKLY("Weekly"),
    MONTHLY("Monthly"),
    QUARTERLY("Quarterly"),
    HALF_YEARLY("Half-yearly"),
    YEARLY("Yearly");

    private final String label;

    Frequency(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public LocalDate next(LocalDate date) {
        return switch (this) {
            case WEEKLY -> date.plusWeeks(1);
            case MONTHLY -> date.plusMonths(1);
            case QUARTERLY -> date.plusMonths(3);
            case HALF_YEARLY -> date.plusMonths(6);
            case YEARLY -> date.plusYears(1);
        };
    }
}
