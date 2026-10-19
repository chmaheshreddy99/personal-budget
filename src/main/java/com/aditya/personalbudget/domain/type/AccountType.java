package com.aditya.personalbudget.domain.type;

import java.util.Arrays;
import java.util.List;

/**
 * Concrete kinds of accounts a person can track. Each type belongs to one {@link AccountClass}.
 * {@code liquid} marks money that is immediately spendable (used by cash-flow forecasting).
 */
public enum AccountType {

    // ---------- Assets
    CASH(AccountClass.ASSET, "Cash", true),
    BANK(AccountClass.ASSET, "Bank Account", true),
    WALLET(AccountClass.ASSET, "Digital Wallet", true),
    FIXED_DEPOSIT(AccountClass.ASSET, "Fixed Deposit", false),
    RECURRING_DEPOSIT(AccountClass.ASSET, "Recurring Deposit", false),
    SAVINGS_SCHEME(AccountClass.ASSET, "PPF / EPF / NPS", false),
    MUTUAL_FUND(AccountClass.ASSET, "Mutual Fund", false),
    STOCKS(AccountClass.ASSET, "Stocks & Shares", false),
    BONDS(AccountClass.ASSET, "Bonds", false),
    GOLD(AccountClass.ASSET, "Gold", false),
    SILVER(AccountClass.ASSET, "Silver", false),
    REAL_ESTATE(AccountClass.ASSET, "Real Estate", false),
    VEHICLE(AccountClass.ASSET, "Vehicle", false),
    INSURANCE_POLICY(AccountClass.ASSET, "Insurance Policy", false),
    CHIT_FUND(AccountClass.ASSET, "Chit Fund", false),
    RECEIVABLE(AccountClass.ASSET, "Receivable", false),
    LOAN_GIVEN(AccountClass.ASSET, "Loan Given", false),
    OTHER_ASSET(AccountClass.ASSET, "Other Asset", false),

    // ---------- Liabilities
    CREDIT_CARD(AccountClass.LIABILITY, "Credit Card", false),
    HOME_LOAN(AccountClass.LIABILITY, "Home Loan", false),
    VEHICLE_LOAN(AccountClass.LIABILITY, "Vehicle Loan", false),
    PERSONAL_LOAN(AccountClass.LIABILITY, "Personal Loan", false),
    GOLD_LOAN(AccountClass.LIABILITY, "Gold Loan", false),
    EDUCATION_LOAN(AccountClass.LIABILITY, "Education Loan", false),
    LOAN(AccountClass.LIABILITY, "Other Loan", false),
    PAYABLE(AccountClass.LIABILITY, "Payable", false),
    OTHER_LIABILITY(AccountClass.LIABILITY, "Other Liability", false),

    // ---------- Equity, income and expense
    EQUITY(AccountClass.EQUITY, "Equity", false),
    INCOME(AccountClass.INCOME, "Income", false),
    EXPENSE(AccountClass.EXPENSE, "Expense", false);

    private final AccountClass accountClass;
    private final String label;
    private final boolean liquid;

    AccountType(AccountClass accountClass, String label, boolean liquid) {
        this.accountClass = accountClass;
        this.label = label;
        this.liquid = liquid;
    }

    public AccountClass getAccountClass() {
        return accountClass;
    }

    public String getLabel() {
        return label;
    }

    public boolean isLiquid() {
        return liquid;
    }

    public static List<AccountType> ofClass(AccountClass accountClass) {
        return Arrays.stream(values()).filter(t -> t.accountClass == accountClass).toList();
    }
}
