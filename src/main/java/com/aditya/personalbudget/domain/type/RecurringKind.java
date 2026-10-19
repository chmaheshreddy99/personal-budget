package com.aditya.personalbudget.domain.type;

/**
 * What a recurring transaction represents. Determines the voucher type when it is posted.
 */
public enum RecurringKind {

    INCOME(VoucherType.INCOME),
    EXPENSE(VoucherType.EXPENSE),
    TRANSFER(VoucherType.TRANSFER);

    private final VoucherType voucherType;

    RecurringKind(VoucherType voucherType) {
        this.voucherType = voucherType;
    }

    public VoucherType getVoucherType() {
        return voucherType;
    }
}
