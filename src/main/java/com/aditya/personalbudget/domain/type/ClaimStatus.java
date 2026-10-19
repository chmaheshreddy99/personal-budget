package com.aditya.personalbudget.domain.type;

/**
 * Lifecycle of money owed to you: OPEN -> PARTIAL -> SETTLED (or WRITTEN_OFF).
 */
public enum ClaimStatus {

    OPEN("Open"),
    PARTIAL("Partly repaid"),
    SETTLED("Settled"),
    WRITTEN_OFF("Written off");

    private final String label;

    ClaimStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
