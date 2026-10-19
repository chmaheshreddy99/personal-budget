package com.aditya.personalbudget.dto;

import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.VoucherType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Requests and responses for journal entries and quick transactions.
 */
public final class JournalDtos {

    private JournalDtos() {
    }

    /** One line of a journal as shown to the user. */
    /**
     * One line of a journal as shown to the user. {@code accountName} is what the line is about: the
     * category (Groceries) or chit (Shriram Gold) when there is one, else the account; {@code ledgerAccountName}
     * is always the ledger account (Expenses, Chit Funds, HDFC Savings ...).
     */
    public record LineView(Long id, Integer lineNo, Long accountId, String accountCode, String accountName,
                           AccountClass accountClass, BigDecimal debit, BigDecimal credit, String memo,
                           Long categoryId, Long chitId, String ledgerAccountName) {
    }

    /** A full journal entry with its lines. */
    public record EntryView(Long id, String entryNo, LocalDate entryDate, VoucherType voucherType, String voucherLabel,
                            String narration, String reference, String party, BigDecimal amount,
                            String sourceType, Long sourceId, boolean editable, String createdBy,
                            LocalDateTime createdAt, List<LineView> lines,
                            String lockReason, String manageAt, boolean reversible, String reversedBy,
                            String reversalOf, Long claimId, Long version, int attachmentCount) {
    }

    /** An expense posted from the Expenses screen. {@code notes} is kept as the memo of the expense line. */
    public record ExpenseRequest(
            @NotNull LocalDate entryDate,
            @NotNull @Positive BigDecimal amount,
            @NotNull Long categoryId,
            @NotNull Long paidFromId,
            @Size(max = 255) String narration,
            @Size(max = 100) String party,
            @Size(max = 60) String reference,
            @Size(max = 255) String notes,
            Long version) {
    }

    /** A manual (multi-line) journal voucher. */
    public record ManualJournalRequest(
            @NotNull LocalDate entryDate,
            @NotNull @Size(min = 1, max = 255) String narration,
            @Size(max = 60) String reference,
            @Size(max = 100) String party,
            @NotEmpty @Size(min = 2, max = 50) List<@Valid LineRequest> lines,
            Long version) {
    }

    public record LineRequest(
            @NotNull Long accountId,
            Long categoryId,
            Long chitId,
            @PositiveOrZero BigDecimal debit,
            @PositiveOrZero BigDecimal credit,
            @Size(max = 255) String memo) {
    }

    /** What a quick transaction represents. Money always flows {@code from} one account {@code to} another. */
    public enum QuickKind {
        /** from = bank / card / cash / payable, to = Expenses (with a category) */
        EXPENSE,
        /** from = Income (with a category), to = bank / cash / receivable */
        INCOME,
        /** from and to = asset or liability accounts (incl. lending, borrowing, card bill, loan EMI) */
        TRANSFER
    }

    /**
     * A quick income / expense / transfer. Posted as: debit {@code toAccountId}, credit {@code fromAccountId}.
     * An expense needs only the paying account ({@code fromAccountId}) and the category: it is booked to the
     * Expenses account. An income needs only the receiving account ({@code toAccountId}) and the category.
     */
    public record QuickTransactionRequest(
            @NotNull QuickKind kind,
            @NotNull LocalDate entryDate,
            @NotNull @Positive BigDecimal amount,
            Long fromAccountId,
            Long toAccountId,
            Long categoryId,
            @Size(max = 255) String narration,
            @Size(max = 60) String reference,
            @Size(max = 100) String party) {
    }
}
