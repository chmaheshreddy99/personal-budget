package com.aditya.personalbudget.domain.type;

/**
 * The business event that produced a journal entry. Every voucher posts a balanced journal.
 */
public enum VoucherType {

    OPENING("Opening Balance", "OB"),
    EXPENSE("Expense", "EX"),
    INCOME("Income", "IN"),
    TRANSFER("Transfer", "TR"),
    CHIT_INSTALLMENT("Chit Installment", "CI"),
    CHIT_PAYOUT("Chit Payout", "CP"),
    HOSTED_CHIT_COLLECTION("Chit Collection", "HC"),
    HOSTED_CHIT_PAYOUT("Hosted Chit Payout", "HP"),
    PROJECT_RECEIPT("Project Receipt", "PR"),
    PROJECT_COST("Project Cost", "PC"),
    PROJECT_CAPITAL("Partner Capital", "PK"),
    PROJECT_LOAN("Project Loan", "PL"),
    LENDING("Money Lent", "LN"),
    PAID_FOR("Paid for Others", "PO"),
    REPAYMENT("Repayment Received", "RR"),
    BORROWING("Money Borrowed", "BR"),
    BILL_DUE("Bill to Pay", "BD"),
    REPAYMENT_MADE("Repayment Paid", "RP"),
    EMI_PAYMENT("EMI Payment", "EM"),
    WRITE_OFF("Write-off", "WO"),
    INTEREST_ACCRUAL("Interest Posted", "IP"),
    REFUND("Refund", "RF"),
    REVERSAL("Reversal", "RV"),
    JOURNAL("Journal", "JV");

    private final String label;
    private final String prefix;

    VoucherType(String label, String prefix) {
        this.label = label;
        this.prefix = prefix;
    }

    public String getLabel() {
        return label;
    }

    /** Prefix of the human-readable entry number, e.g. EX-000123. */
    public String getPrefix() {
        return prefix;
    }
}
