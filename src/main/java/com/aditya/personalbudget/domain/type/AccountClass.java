package com.aditya.personalbudget.domain.type;

/**
 * The five fundamental account classes of double-entry bookkeeping.
 * <p>
 * Debit-normal classes (assets, expenses) grow with debits; credit-normal classes
 * (liabilities, equity, income) grow with credits.
 */
public enum AccountClass {

    ASSET("Assets", true),
    LIABILITY("Liabilities", false),
    EQUITY("Equity", false),
    INCOME("Income", false),
    EXPENSE("Expenses", true);

    private final String label;
    private final boolean debitNormal;

    AccountClass(String label, boolean debitNormal) {
        this.label = label;
        this.debitNormal = debitNormal;
    }

    public String getLabel() {
        return label;
    }

    public boolean isDebitNormal() {
        return debitNormal;
    }

    /** True for balance sheet classes, false for income statement classes. */
    public boolean isBalanceSheet() {
        return this == ASSET || this == LIABILITY || this == EQUITY;
    }
}
