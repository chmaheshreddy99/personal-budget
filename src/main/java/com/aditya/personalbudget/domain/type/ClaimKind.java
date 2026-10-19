package com.aditya.personalbudget.domain.type;

/**
 * Why money is owed. LENT and PAID_FOR are owed to you and sit in a receivable account;
 * BORROWED and BILL_DUE are owed by you and sit in a payable (liability) account.
 */
public enum ClaimKind {

    /** You lent cash to someone (may carry interest). */
    LENT("Money lent", false),
    /** You paid a bill on someone else's behalf. */
    PAID_FOR("Paid on behalf", false),
    /** Someone lent you cash (may carry interest). */
    BORROWED("Money borrowed", true),
    /** A bill or purchase you will pay later (credit from a shop, a pending invoice). */
    BILL_DUE("Bill to pay", true);

    private final String label;
    private final boolean payable;

    ClaimKind(String label, boolean payable) {
        this.label = label;
        this.payable = payable;
    }

    public String getLabel() {
        return label;
    }

    /** True when you owe the money (tracked under a liability account). */
    public boolean isPayable() {
        return payable;
    }
}
