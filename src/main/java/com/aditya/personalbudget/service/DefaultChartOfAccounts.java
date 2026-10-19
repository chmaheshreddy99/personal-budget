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
    /** Commission (and its share of late fees) earned from the chits I run (Host a Chit). */
    public static final String CHIT_COMMISSION = "CHIT_COMMISSION";

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
            new CategoryTemplate("4080", "Savings Income", CategoryKind.INCOME, null, "Savings account interest, RD / FD maturity gains, sweep-in returns"),
            new CategoryTemplate("4090", "Bonus & Incentives", CategoryKind.INCOME, null, "Annual bonus, performance pay, incentives"),
            new CategoryTemplate("4100", "Pension", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4110", "Cashback & Rewards", CategoryKind.INCOME, null, "Card cashback, reward points redeemed, UPI cashback"),
            new CategoryTemplate("4120", "Refunds & Reimbursements", CategoryKind.INCOME, null, "Office reimbursements, tax refunds, order refunds"),
            new CategoryTemplate("4130", "Agricultural Income", CategoryKind.INCOME, null, "Crops, produce, farm lease"),
            new CategoryTemplate("4140", "Commission & Brokerage", CategoryKind.INCOME, null, null),
            new CategoryTemplate("4150", "Tuition & Coaching", CategoryKind.INCOME, null, "Teaching, coaching, training fees"),
            new CategoryTemplate("4160", "Sale of Items", CategoryKind.INCOME, null, "Old items, scrap, second-hand sales"),
            new CategoryTemplate("4170", "Allowances", CategoryKind.INCOME, null, "HRA, travel, meal and other allowances"),
            new CategoryTemplate("4180", "Chit Commission Income", CategoryKind.INCOME, CHIT_COMMISSION,
                    "Commission and late payment interest from the chits I run (Host a Chit)"),
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
            new CategoryTemplate("5100", "Clothing & Footwear", CategoryKind.EXPENSE, null, null),
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
            new CategoryTemplate("5210", "Shopping", CategoryKind.EXPENSE, null, "Online and store shopping: Amazon, Flipkart, malls"),
            new CategoryTemplate("5220", "Electronic Gadgets", CategoryKind.EXPENSE, null, "Phones, laptops, accessories, appliances"),
            new CategoryTemplate("5230", "Gym & Fitness", CategoryKind.EXPENSE, null, "Gym, yoga, sports, supplements"),
            new CategoryTemplate("5240", "Milk & Dairy", CategoryKind.EXPENSE, null, "Milk, curd, paneer, the monthly milk bill"),
            new CategoryTemplate("5250", "Maid & Household Help", CategoryKind.EXPENSE, null, "Maid, cook, driver, watchman"),
            new CategoryTemplate("5260", "Vegetables & Fruits", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5270", "Food Delivery", CategoryKind.EXPENSE, null, "Swiggy, Zomato, takeaway"),
            new CategoryTemplate("5280", "Subscriptions", CategoryKind.EXPENSE, null, "OTT, music, apps, cloud storage"),
            new CategoryTemplate("5290", "Gas Cylinder (LPG)", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5300", "DTH & Cable", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5310", "Vehicle Maintenance", CategoryKind.EXPENSE, null, "Service, repairs, tyres, washing"),
            new CategoryTemplate("5320", "Cab & Auto", CategoryKind.EXPENSE, null, "Uber, Ola, Rapido, auto rickshaw"),
            new CategoryTemplate("5330", "Parking & Tolls", CategoryKind.EXPENSE, null, "Parking, FASTag, tolls"),
            new CategoryTemplate("5340", "Laundry & Ironing", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5350", "Snacks & Beverages", CategoryKind.EXPENSE, null, "Tea, coffee, bakery, snacks"),
            new CategoryTemplate("5360", "Pharmacy & Medicines", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5370", "Furniture & Home Decor", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5380", "Festivals & Pooja", CategoryKind.EXPENSE, null, "Festival shopping, pooja items, temple"),
            new CategoryTemplate("5390", "Pets", CategoryKind.EXPENSE, null, "Pet food, vet, grooming"),
            new CategoryTemplate("5400", "Books & Stationery", CategoryKind.EXPENSE, null, null),
            new CategoryTemplate("5410", "Water Cans", CategoryKind.EXPENSE, null, "Drinking water cans, RO service"),
            new CategoryTemplate("5420", "Newspaper & Magazines", CategoryKind.EXPENSE, null, null),
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
