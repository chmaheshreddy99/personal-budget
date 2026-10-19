package com.aditya.personalbudget.domain.type;

/** Whether a category classifies money spent or money earned. */
public enum CategoryKind {
    EXPENSE("Expense", AccountClass.EXPENSE),
    INCOME("Income", AccountClass.INCOME);

    private final String label;
    private final AccountClass accountClass;

    CategoryKind(String label, AccountClass accountClass) {
        this.label = label;
        this.accountClass = accountClass;
    }

    public String getLabel() {
        return label;
    }

    /** The class of the single ledger account its postings go to (Expenses or Income). */
    public AccountClass getAccountClass() {
        return accountClass;
    }

    /** The kind matching an account class, or null for balance-sheet classes. */
    public static CategoryKind of(AccountClass accountClass) {
        return accountClass == AccountClass.INCOME ? INCOME : accountClass == AccountClass.EXPENSE ? EXPENSE : null;
    }
}
