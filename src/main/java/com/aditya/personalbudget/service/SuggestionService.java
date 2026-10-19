package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.repository.RecurringTransactionRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Autocomplete data built from the tenant's own history: narrations, payees, references, memos,
 * institutions, organizers and notes. Values are ranked by how often and how recently they were used.
 * <p>
 * A narration suggestion also carries a <i>template</i> (amount and accounts of the last entry with that
 * narration), so picking "Groceries" can pre-fill the category, the paying account and the usual amount.
 * Values from the journal also list the voucher types they were used with ({@code kinds}), so a form only
 * offers what fits it: the expense form shows expense descriptions, never chit installments or repayments.
 */
@Service
public class SuggestionService {

    private static final int LIMIT = 600;

    /**
     * One suggested value. The template fields are filled for narrations only; {@code kinds} holds the voucher
     * types the value was used with (empty for values that do not come from the journal).
     */
    public record Suggestion(String value, int count, LocalDate lastUsed, String voucherType, BigDecimal amount,
                             Long debitAccountId, Long creditAccountId, Long categoryId, Set<String> kinds) {

        static Suggestion of(String value, int count, LocalDate lastUsed, Set<String> kinds) {
            return new Suggestion(value, count, lastUsed, null, null, null, null, null, kinds);
        }
    }

    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;
    private final AccountRepository accounts;
    private final ChitRepository chits;
    private final BudgetRepository budgets;
    private final RecurringTransactionRepository recurring;

    public SuggestionService(JournalEntryRepository entries, JournalLineRepository lines, AccountRepository accounts,
                             ChitRepository chits, BudgetRepository budgets, RecurringTransactionRepository recurring) {
        this.entries = entries;
        this.lines = lines;
        this.accounts = accounts;
        this.chits = chits;
        this.budgets = budgets;
        this.recurring = recurring;
    }

    /** All suggestion lists keyed by field name: narration, party, reference, memo, institution, organizer, notes, name. */
    public Map<String, List<Suggestion>> all() {
        Long tenantId = UserContext.tenantId();
        List<JournalEntry> journal = entries.findByTenantId(tenantId);
        List<JournalLine> journalLines = lines.findByTenantId(tenantId);
        List<Account> accountList = accounts.findByTenantId(tenantId);
        List<Chit> chitList = chits.findByTenantId(tenantId);

        Map<String, List<Suggestion>> result = new LinkedHashMap<>();
        result.put("narration", narrations(journal, journalLines));
        result.put("party", rank(journal.stream().map(e -> new Use(e.getParty(), e.getEntryDate(), e.getVoucherType().name()))));
        result.put("reference", rank(journal.stream().map(e -> new Use(e.getReference(), e.getEntryDate(), e.getVoucherType().name()))));

        Map<Long, JournalEntry> entryById = journal.stream().collect(Collectors.toMap(JournalEntry::getId, e -> e));
        result.put("memo", rank(journalLines.stream().map(l -> {
            JournalEntry e = entryById.get(l.getJournalEntryId());
            return new Use(l.getMemo(), e == null ? null : e.getEntryDate(), e == null ? null : e.getVoucherType().name());
        })));

        result.put("institution", rank(Stream.concat(
                accountList.stream().map(a -> new Use(a.getInstitution(), a.getCreatedAt().toLocalDate(), null)),
                chitList.stream().map(c -> new Use(c.getOrganizer(), c.getStartDate(), null)))));
        result.put("organizer", rank(chitList.stream().map(c -> new Use(c.getOrganizer(), c.getStartDate(), null))));
        result.put("name", rank(Stream.of(
                accountList.stream().map(a -> new Use(a.getName(), a.getCreatedAt().toLocalDate(), null)),
                chitList.stream().map(c -> new Use(c.getName(), c.getStartDate(), null)),
                recurring.findByTenantId(tenantId).stream().map(r -> new Use(r.getName(), r.getStartDate(), null)))
                .flatMap(Function.identity())));
        result.put("notes", rank(Stream.of(
                accountList.stream().map(a -> new Use(a.getDescription(), a.getCreatedAt().toLocalDate(), null)),
                chitList.stream().map(c -> new Use(c.getNotes(), c.getStartDate(), null)),
                budgets.findByTenantId(tenantId).stream().map(b -> new Use(b.getNotes(), null, null)),
                recurring.findByTenantId(tenantId).stream().map(r -> new Use(r.getNotes(), r.getStartDate(), null)))
                .flatMap(Function.identity())));
        return result;
    }

    // ================================================================== ranking

    /** A value as used once: when, and with which voucher type (null outside the journal). */
    private record Use(String value, LocalDate date, String kind) {
    }

    /** Distinct non-blank values, most used first, then most recent. Case-insensitive grouping. */
    private static List<Suggestion> rank(Stream<Use> uses) {
        Map<String, Suggestion> byKey = new HashMap<>();
        uses.filter(u -> u.value() != null && !u.value().isBlank()).forEach(u -> {
            String key = u.value().trim().toLowerCase(Locale.ROOT);
            byKey.merge(key, Suggestion.of(u.value().trim(), 1, u.date(), kindsOf(u.kind())), (a, b) ->
                    Suggestion.of(a.value(), a.count() + 1, latest(a.lastUsed(), b.lastUsed()), union(a.kinds(), b.kinds())));
        });
        return byKey.values().stream().sorted(RANKING).limit(LIMIT).toList();
    }

    private static final Comparator<Suggestion> RANKING = Comparator
            .comparing(Suggestion::count).reversed()
            .thenComparing(Suggestion::lastUsed, Comparator.nullsLast(Comparator.reverseOrder()));

    /** Narrations with the template of their most recent two-line entry. */
    private static List<Suggestion> narrations(List<JournalEntry> journal, List<JournalLine> journalLines) {
        Map<Long, List<JournalLine>> linesByEntry = journalLines.stream()
                .collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        Map<String, Suggestion> byKey = new HashMap<>();
        journal.stream()
                .filter(e -> e.getNarration() != null && !e.getNarration().isBlank())
                .sorted(Comparator.comparing(JournalEntry::getEntryDate).thenComparing(JournalEntry::getId))
                .forEach(e -> {
                    String key = e.getNarration().trim().toLowerCase(Locale.ROOT);
                    List<JournalLine> entryLines = linesByEntry.getOrDefault(e.getId(), List.of());
                    Long debit = null;
                    Long credit = null;
                    Long category = null;
                    if (entryLines.size() == 2) {
                        category = entryLines.stream().map(JournalLine::getCategoryId)
                                .filter(Objects::nonNull).findFirst().orElse(null);
                        debit = entryLines.stream().filter(l -> l.getDebit().signum() > 0).map(JournalLine::getAccountId)
                                .filter(Objects::nonNull).findFirst().orElse(null);
                        credit = entryLines.stream().filter(l -> l.getCredit().signum() > 0).map(JournalLine::getAccountId)
                                .filter(Objects::nonNull).findFirst().orElse(null);
                    }
                    Suggestion previous = byKey.get(key);
                    int count = previous == null ? 1 : previous.count() + 1;
                    Set<String> kinds = union(previous == null ? Set.of() : previous.kinds(), kindsOf(e.getVoucherType().name()));
                    // later entries overwrite the template, so it reflects the most recent use
                    byKey.put(key, new Suggestion(e.getNarration().trim(), count, e.getEntryDate(),
                            e.getVoucherType().name(), e.getAmount(), debit, credit, category, kinds));
                });
        return byKey.values().stream().sorted(RANKING).limit(LIMIT).toList();
    }

    private static Set<String> kindsOf(String kind) {
        return kind == null ? Set.of() : Set.of(kind);
    }

    private static Set<String> union(Set<String> a, Set<String> b) {
        if (b.isEmpty() || a.containsAll(b)) {
            return a;
        }
        Set<String> all = new TreeSet<>(a);
        all.addAll(b);
        return all;
    }

    private static LocalDate latest(LocalDate a, LocalDate b) {
        if (a == null) {
            return b;
        }
        return b == null || a.isAfter(b) ? a : b;
    }
}
