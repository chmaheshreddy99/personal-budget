package com.aditya.personalbudget.domain.type;

/**
 * When interest on money lent or borrowed is expected to be paid. It sets what is "due now", when the next
 * interest falls due, and how often automatic posting books it; interest itself always accrues day by day.
 */
public enum InterestCollection {
    /** On every monthly anniversary of the loan. */
    MONTHLY("Every month"),
    /** On every yearly anniversary of the loan. */
    YEARLY("Every year"),
    /** Whenever the other person pays it, usually with the principal: nothing falls due on its own. */
    ON_PAYMENT("Whenever paid");

    private final String label;

    InterestCollection(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    /** Months between two collection dates (0: no fixed dates). */
    public int months() {
        return this == MONTHLY ? 1 : this == YEARLY ? 12 : 0;
    }
}
