package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimInterestPosting;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.domain.entity.ConstructionCost;
import com.aditya.personalbudget.domain.entity.ConstructionLoanTxn;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionReceipt;
import com.aditya.personalbudget.domain.entity.EmiInstallment;
import com.aditya.personalbudget.domain.entity.EmiPlan;
import com.aditya.personalbudget.domain.entity.HostedChitMonth;
import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.domain.entity.HostedChitTransfer;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.Identifiable;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Checks the books for data integrity issues and reports them; it never changes anything by itself (an admin
 * reviews them in Data integrity, {@code GET /api/integrity}):
 * <ul>
 *   <li><b>Left-behind postings</b>: journal entries a feature posted for a record that no longer stands behind
 *       them (an installment undone while its entry stayed, a deleted collection, a second entry for the same
 *       payment ...). Such an entry is locked in the journal, yet still moves balances. For chit postings (personal
 *       chits and Host a Chit) the record says exactly which entry belongs in the books, so an admin may take the
 *       left-behind one out ({@link #remove}); for other features a person has to look.</li>
 *   <li><b>Unbalanced entries</b>: debits and credits that do not agree, or an entry with fewer than two lines.</li>
 *   <li><b>Balance mismatches</b>: an account whose stored balance is not the sum of its lines.</li>
 * </ul>
 */
@Service
public class LedgerIntegrityService {

    private static final Logger log = LoggerFactory.getLogger(LedgerIntegrityService.class);

    /** Kinds of issue. */
    public static final String LEFT_BEHIND = "LEFT_BEHIND";
    public static final String UNBALANCED = "UNBALANCED";
    public static final String BALANCE_MISMATCH = "BALANCE_MISMATCH";

    /**
     * One issue. {@code removable}: a left-behind chit posting an admin may take out of the books (after looking).
     * Account fields are set for a balance mismatch, entry fields otherwise.
     */
    public record Issue(String kind, Long entryId, String entryNo, LocalDate date, String narration, BigDecimal amount,
                        String sourceType, Long sourceId, Long accountId, String accountName, String reason, boolean removable) {
    }

    /** Postings checked only for their record still existing: source type → the record's class. */
    private static final Map<String, Class<? extends Identifiable>> RECORD_OF = Map.ofEntries(
            Map.entry(LedgerService.SOURCE_ACCOUNT_OPENING, Account.class),
            Map.entry(LedgerService.SOURCE_CLAIM, Claim.class),
            Map.entry(LedgerService.SOURCE_CLAIM_REPAYMENT, ClaimRepayment.class),
            Map.entry(LedgerService.SOURCE_CLAIM_INTEREST, ClaimInterestPosting.class),
            Map.entry(LedgerService.SOURCE_REFUND, JournalEntry.class),
            Map.entry(LedgerService.SOURCE_REVERSAL, JournalEntry.class),
            Map.entry(EmiService.SOURCE_PURCHASE, EmiPlan.class),
            Map.entry(EmiService.SOURCE_FORECLOSE, EmiPlan.class),
            Map.entry(EmiService.SOURCE_PAYMENT, EmiInstallment.class),
            Map.entry(EmiService.SOURCE_BILL, EmiInstallment.class),
            Map.entry(EmiService.SOURCE_CARD_PAYMENT, EmiInstallment.class),
            Map.entry(HostedChitBookService.SOURCE_TRANSFER, HostedChitTransfer.class),
            Map.entry("CONSTRUCTION_RECEIPT", ConstructionReceipt.class),
            Map.entry("CONSTRUCTION_COST", ConstructionCost.class),
            Map.entry("CONSTRUCTION_CAPITAL", ConstructionCapital.class),
            Map.entry("CONSTRUCTION_LOAN", ConstructionLoanTxn.class),
            Map.entry("CONSTRUCTION_TRANSFER", ConstructionProject.class),
            Map.entry("CONSTRUCTION_CLOSE", ConstructionProject.class));

    private final TsvDataStore store;
    private final LedgerService ledger;

    public LedgerIntegrityService(TsvDataStore store, LedgerService ledger) {
        this.store = store;
        this.ledger = ledger;
    }

    /** Every issue in the signed-in tenant's books. */
    public List<Issue> check() {
        return check(UserContext.tenantId());
    }

    public List<Issue> check(Long tenantId) {
        List<Issue> found = new ArrayList<>();
        List<JournalEntry> all = store.findAll(JournalEntry.class, e -> tenantId.equals(e.getTenantId()));
        for (JournalEntry e : all) {
            String reason = e.getSourceType() == null ? null : reasonFor(e);
            if (reason != null) {
                found.add(entryIssue(LEFT_BEHIND, e, reason, removable(e.getSourceType())));
            }
        }
        // debits against credits, per entry
        Map<Long, List<JournalLine>> linesByEntry = store.findAll(JournalLine.class, l -> tenantId.equals(l.getTenantId())).stream()
                .collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        for (JournalEntry e : all) {
            List<JournalLine> lines = linesByEntry.getOrDefault(e.getId(), List.of());
            BigDecimal dr = lines.stream().map(l -> Money.nz(l.getDebit())).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal cr = lines.stream().map(l -> Money.nz(l.getCredit())).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (lines.size() < 2) {
                found.add(entryIssue(UNBALANCED, e, lines.isEmpty() ? "the entry has no lines" : "the entry has a single line", false));
            } else if (dr.compareTo(cr) != 0) {
                found.add(entryIssue(UNBALANCED, e, "debits " + dr.toPlainString() + " and credits " + cr.toPlainString() + " do not agree", false));
            }
        }
        // the stored balance against the sum of the lines
        Map<Long, BigDecimal> sums = new HashMap<>();
        linesByEntry.values().forEach(list -> list.forEach(l ->
                sums.merge(l.getAccountId(), Money.nz(l.getDebit()).subtract(Money.nz(l.getCredit())), BigDecimal::add)));
        for (Account a : store.findAll(Account.class, a -> tenantId.equals(a.getTenantId()))) {
            BigDecimal raw = sums.getOrDefault(a.getId(), BigDecimal.ZERO);
            BigDecimal expected = Money.round(a.getAccountClass().isDebitNormal() ? raw : raw.negate());
            if (a.getBalance() == null || a.getBalance().compareTo(expected) != 0) {
                found.add(new Issue(BALANCE_MISMATCH, null, null, null, null, a.getBalance(), null, null, a.getId(), a.getName(),
                        "stored balance " + (a.getBalance() == null ? "missing" : a.getBalance().toPlainString())
                                + ", its journal lines add up to " + expected.toPlainString(), false));
            }
        }
        return found;
    }

    /**
     * Takes one left-behind chit posting out of the books, at an admin's request. Refused unless the entry is still
     * such a posting (checked again now), so nothing that belongs in the books can go this way.
     */
    @Transactional
    public Issue remove(Long entryId) {
        JournalEntry e = store.findById(JournalEntry.class, entryId).filter(x -> UserContext.tenantId().equals(x.getTenantId()))
                .orElseThrow(() -> new BusinessException("That journal entry is no longer in the books"));
        String reason = e.getSourceType() == null ? null : reasonFor(e);
        if (reason == null || !removable(e.getSourceType())) {
            throw new BusinessException(e.getEntryNo() + " is not a left-behind chit posting; change it from its own screen");
        }
        Issue issue = entryIssue(LEFT_BEHIND, e, reason, true);
        ledger.delete(entryId);
        log.warn("{} removed left-behind journal entry {} ({} #{}): {}", UserContext.username(), e.getEntryNo(),
                e.getSourceType(), e.getSourceId(), reason);
        return issue;
    }

    private static Issue entryIssue(String kind, JournalEntry e, String reason, boolean removable) {
        return new Issue(kind, e.getId(), e.getEntryNo(), e.getEntryDate(), e.getNarration(), e.getAmount(), e.getSourceType(),
                e.getSourceId(), null, null, reason, removable);
    }

    // ------------------------------------------------------------------ the checks

    private static boolean removable(String sourceType) {
        return switch (sourceType) {
            case LedgerService.SOURCE_CHIT_INSTALLMENT, LedgerService.SOURCE_CHIT_PAYOUT,
                 HostedChitService.SOURCE_COLLECTION, HostedChitService.SOURCE_PAYOUT, HostedChitService.SOURCE_COMMISSION -> true;
            default -> false;
        };
    }

    /** Why the entry has no record behind it, or null when it is fine. */
    private String reasonFor(JournalEntry e) {
        Long id = e.getSourceId();
        String source = e.getSourceType();
        switch (source) {
            case LedgerService.SOURCE_CHIT_INSTALLMENT -> {
                ChitInstallment i = id == null ? null : store.findById(ChitInstallment.class, id).orElse(null);
                if (i == null) return "the installment no longer exists";
                if (i.getStatus() != InstallmentStatus.PAID) return "installment " + i.getInstallmentNo() + " is not paid (undone)";
                if (!Objects.equals(i.getJournalEntryId(), e.getId())) return "installment " + i.getInstallmentNo() + " is booked by another entry (a duplicate)";
                return null;
            }
            case LedgerService.SOURCE_CHIT_PAYOUT -> {
                Chit c = id == null ? null : store.findById(Chit.class, id).orElse(null);
                if (c == null) return "the chit no longer exists";
                return c.getPayoutAmount() == null ? "the chit's payout was undone" : null;
            }
            case HostedChitService.SOURCE_COLLECTION -> {
                HostedChitPayment p = id == null ? null : store.findById(HostedChitPayment.class, id).orElse(null);
                if (p == null) return "the collection was deleted";
                return Objects.equals(p.getJournalEntryId(), e.getId()) ? null : "the collection is booked by another entry (a duplicate)";
            }
            case HostedChitService.SOURCE_PAYOUT, HostedChitService.SOURCE_COMMISSION -> {
                HostedChitMonth m = id == null ? null : store.findById(HostedChitMonth.class, id).orElse(null);
                if (m == null) return "the chit month no longer exists";
                if (m.getPayoutDate() == null) return "month " + m.getMonthNo() + "'s payout was undone";
                if (HostedChitService.SOURCE_PAYOUT.equals(source) && !Objects.equals(m.getPayoutEntryId(), e.getId())) {
                    return "month " + m.getMonthNo() + "'s payout is booked by another entry (a duplicate)";
                }
                return null;
            }
            default -> {
                Class<? extends Identifiable> type = RECORD_OF.get(source);
                if (type == null || id == null) return null;   // not tied to one record (quick entries, recurring ...)
                return store.findById(type, id).isPresent() ? null : "its " + type.getSimpleName() + " #" + id + " no longer exists";
            }
        }
    }
}
