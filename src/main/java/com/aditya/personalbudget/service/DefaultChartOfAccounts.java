package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;

import java.util.List;

/**
 * The accounts and categories every new tenant starts with.
 * <p>
 * The chart of accounts is deliberately short: cash, receivables, chit funds, payables, opening balance
 * equity, one Income and one Expenses account. Your banks, cards, loans and investments are added as you
 * need them. Spending and earnings are split by <b>categories</b> (a column on the journal line), not by
 * accounts, and each chit is a sub-ledger of Chit Funds.
 * <p>
 * Code ranges: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx expenses.
 * System accounts and system categories are used by the application itself and cannot be deleted.
 */
public final class DefaultChartOfAccounts {

    public record Template(String code, String name, AccountType type, boolean system, String description) {
    }

    public record CategoryTemplate(String code, String name, CategoryKind kind, String systemKey, String description) {
    }

    // Well-known account codes the application relies on
    public static final String CASH = "1000";
    public static final String RECEIVABLES = "1200";
    public static final String CHIT_FUNDS = "1300";
    public static final String PAYABLES = "2000";
    public static final String OPENING_BALANCE_EQUITY = "3000";
    public static final String INCOME = "4000";
    public static final String EXPENSES = "5000";

    // Well-known categories the application posts to by itself
    public static final String INTEREST_INCOME = "INTEREST";
    public static final String CHIT_GAINS = "CHIT_GAINS";
    public static final String OTHER_INCOME = "OTHER_INCOME";
    public static final String LOAN_INTEREST = "LOAN_INTEREST";
    public static final String CHIT_DISCOUNT = "CHIT_DISCOUNT";
    public static final String MISC_EXPENSE = "MISC_EXPENSE";
    /**
     * Chit installments as they leave the bank. Budget-only: an installment is savings in the books (Chit Funds),
     * not an expense, so this category never appears on a journal line. The budget counts the cash paid into
     * chits against it, so chits can have a (committed) budget like rent or an EMI.
     */
    public static final String CHIT_PAYMENTS = "CHIT_PAYMENTS";

    public static final List<Template> ACCOUNTS = List.of(
            new Template(CASH, "Cash in Hand", AccountType.CASH, true, "Physical cash / petty cash"),
            new Template(RECEIVABLES, "Receivables", AccountType.RECEIVABLE, true, "Money others owe you"),
            new Template(CHIT_FUNDS, "Chit Funds", AccountType.CHIT_FUND, true, "Installments paid into your chits, chit by chit"),
            new Template(PAYABLES, "Payables", AccountType.PAYABLE, true, "Bills and dues you still have to pay"),
            new Template(OPENING_BALANCE_EQUITY, "Opening Balance Equity", AccountType.EQUITY, true,
                    "Balancing account for opening balances"),
            new Template(INCOME, "Income", AccountType.INCOME, true, "All income, split by category"),
            new Template(EXPENSES, "Expenses", AccountType.EXPENSE, true, "All spending, split by category")
    );

    public static final List<CategoryTemplate> CATEGORIES = List.of(
            // ---- Income
            new CategoryTemplate("4010", "Salary", CategoryKind.INCOME, null, "Salary and wages"),
            new CategoryTemplate("4020", "Business / Freelance", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4030", "Interest", CategoryKind.INCOME, INTEREST_INCOME, "Savings, FD, bond and lending interest"),
            new CategoryTemplate("4040", "Dividends & Capital Gains", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4050", "Chit Gains", CategoryKind.INCOME, CHIT_GAINS, "Chit dividends and gain on chit payout"),
            new CategoryTemplate("4060", "Rental Income", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4070", "Gifts Received", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4990", "Other Income", CategoryKind.INCOME, OTHER_INCOME, null),
            // ---- Expenses
            new CategoryTemplate("5010", "Groceries", CategoryKind.EXPENSE, null, "Food and household supplies"),
            new CategoryTemplate("5020", "Rent", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5030", "Utilities", CategoryKind.EXPENSE, null, "Electricity, water, gas"),
            new CategoryTemplate("5040", "Mobile & Internet", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5050", "Fuel & Transport", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5060", "Dining Out", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5070", "Medical & Health", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5080", "Education", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5090", "Entertainment", CategoryKind.EXPENSE, null, "Movies, OTT, outings"),
            new CategoryTemplate("5100", "Shopping & Clothing", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5110", "Insurance Premiums", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5120", "Loan Interest", CategoryKind.EXPENSE, LOAN_INTEREST, "Interest part of EMIs and borrowing"),
            new CategoryTemplate("5130", "Bank Charges & Fees", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5140", "Chit Commission & Discount", CategoryKind.EXPENSE, CHIT_DISCOUNT,
                    "Foreman commission and auction discount on chit payout"),
            new CategoryTemplate("5145", "Chit Payments", CategoryKind.EXPENSE, CHIT_PAYMENTS,
                    "Chit installments paid (budget only: recorded from the Chits page, kept as savings in the books)"),
            new CategoryTemplate("5150", "Travel & Vacation", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5160", "Home Maintenance", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5170", "Personal Care", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5180", "Gifts & Donations", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5190", "Taxes", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5200", "Kids & Family", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5990", "Miscellaneous", CategoryKind.EXPENSE, MISC_EXPENSE, null)
    );

    /** Old per-category account codes (before categories existed) and the system key they map to. */
    public static String systemKeyOfLegacyCode(String code) {
        return switch (code) {
            case "4200" -> INTEREST_INCOME;
            case "4400" -> CHIT_GAINS;
            case "4900" -> OTHER_INCOME;
            case "5110" -> LOAN_INTEREST;
            case "5130" -> CHIT_DISCOUNT;
            case "5990" -> MISC_EXPENSE;
            default -> null;
        };
    }

    private DefaultChartOfAccounts() {
    }
}
