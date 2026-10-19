package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.type.VoucherType;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * A journal entry waiting to be posted by {@link LedgerService}.
 * Built fluently; {@link #category} and {@link #chit} tag the line added just before:
 * <pre>
 * JournalDraft.of(date, VoucherType.EXPENSE, "Groceries at market")
 *     .debit(expensesAccountId, amount).category(groceriesId)
 *     .credit(bankAccountId, amount);
 * </pre>
 */
public final class JournalDraft {

    /** One line: the account, and the category (Expenses / Income lines) or chit (Chit Funds lines) it is about. */
    public record Line(Long accountId, Long categoryId, Long chitId, BigDecimal debit, BigDecimal credit, String memo) {

        public Line(Long accountId, BigDecimal debit, BigDecimal credit, String memo) {
            this(accountId, null, null, debit, credit, memo);
        }

        Line withCategory(Long id) {
            return new Line(accountId, id, chitId, debit, credit, memo);
        }

        Line withChit(Long id) {
            return new Line(accountId, categoryId, id, debit, credit, memo);
        }
    }

    private final LocalDate date;
    private final VoucherType voucherType;
    private final String narration;
    private final List<Line> lines = new ArrayList<>();
    private boolean lastSkipped;
    private String reference;
    private String party;
    private String sourceType;
    private Long sourceId;

    private JournalDraft(LocalDate date, VoucherType voucherType, String narration) {
        this.date = date;
        this.voucherType = voucherType;
        this.narration = narration;
    }

    public static JournalDraft of(LocalDate date, VoucherType voucherType, String narration) {
        return new JournalDraft(date, voucherType, narration);
    }

    public JournalDraft debit(Long accountId, BigDecimal amount) {
        return debit(accountId, amount, null);
    }

    public JournalDraft debit(Long accountId, BigDecimal amount, String memo) {
        return add(Money.isPositive(amount) ? new Line(accountId, Money.round(amount), Money.ZERO, memo) : null);
    }

    public JournalDraft credit(Long accountId, BigDecimal amount) {
        return credit(accountId, amount, null);
    }

    public JournalDraft credit(Long accountId, BigDecimal amount, String memo) {
        return add(Money.isPositive(amount) ? new Line(accountId, Money.ZERO, Money.round(amount), memo) : null);
    }

    /** Tags the line just added (a zero line was skipped, and so is its tag). */
    public JournalDraft category(Long categoryId) {
        if (!lastSkipped && !lines.isEmpty()) {
            lines.set(lines.size() - 1, lines.getLast().withCategory(categoryId));
        }
        return this;
    }

    /** Tags the line just added with its chit. */
    public JournalDraft chit(Long chitId) {
        if (!lastSkipped && !lines.isEmpty()) {
            lines.set(lines.size() - 1, lines.getLast().withChit(chitId));
        }
        return this;
    }

    public JournalDraft line(Line line) {
        return add(line);
    }

    private JournalDraft add(Line line) {
        lastSkipped = line == null;
        if (line != null) {
            lines.add(line);
        }
        return this;
    }

    public JournalDraft reference(String reference) {
        this.reference = reference;
        return this;
    }

    public JournalDraft party(String party) {
        this.party = party;
        return this;
    }

    public JournalDraft source(String sourceType, Long sourceId) {
        this.sourceType = sourceType;
        this.sourceId = sourceId;
        return this;
    }

    public LocalDate date() {
        return date;
    }

    public VoucherType voucherType() {
        return voucherType;
    }

    public String narration() {
        return narration;
    }

    public List<Line> lines() {
        return lines;
    }

    public String reference() {
        return reference;
    }

    public String party() {
        return party;
    }

    public String sourceType() {
        return sourceType;
    }

    public Long sourceId() {
        return sourceId;
    }
}
