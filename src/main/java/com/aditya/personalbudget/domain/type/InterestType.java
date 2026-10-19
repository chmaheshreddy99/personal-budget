package com.aditya.personalbudget.domain.type;

/** How interest on money lent grows. */
public enum InterestType {
    /** On the principal still owed only; interest never earns interest. */
    SIMPLE("Simple"),
    /** Unpaid interest is added to the balance every month and earns interest too. */
    COMPOUND("Compound (monthly)");

    private final String label;

    InterestType(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
