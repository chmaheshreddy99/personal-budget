package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.LedgerSnapshot.PostedLine;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * What an entry means beyond its lines, for its open row: for each category it touches, where the category stands in
 * that month (against its budget) and how this entry compares with the usual one; whether it repeats (the same shop or
 * description, how often, around which day, when the next one is due, how this one compares); and other entries that
 * look like the same one recorded twice. Worked out from the books when asked, so it is always current.
 */
@Service
public class EntryInsightService {

    /** How far back "usual" and "repeats" look. */
    private static final int HISTORY_MONTHS = 12;
    /** Entries this many days apart (or closer) with the same amount and the same shop / description may be one recorded twice. */
    private static final int DUPLICATE_DAYS = 3;

    public record EntryInsights(Long entryId, List<CategoryInsight> categories, Pattern pattern, List<Duplicate> duplicates) {
    }

    /**
     * A category of the entry: this entry's part, the category's total in the entry's month and its budget then, and the
     * usual size of one entry in it (the average of the entries of the last 12 months, when there are 3 or more).
     */
    public record CategoryInsight(Long categoryId, String name, String kind, BigDecimal amount, String month,
                                  BigDecimal monthTotal, BigDecimal budget, BigDecimal budgetPercent, Integer alertPercent,
                                  BigDecimal usual, int usualCount, BigDecimal ratio) {
    }

    /**
     * The entry repeats: matched by its shop / person ({@code by} PARTY) or its description (DESCRIPTION) among the
     * entries of the same kind in the last 12 months. {@code cadence}: WEEKLY, MONTHLY, QUARTERLY, YEARLY or IRREGULAR
     * (from the typical gap between them); {@code usualDay}: the day of the month it usually falls on (monthly);
     * {@code nextExpected}: when the next one would fall due at that pace; {@code changePercent}: this one against the
     * average of the others.
     */
    public record Pattern(String by, String key, int count, String cadence, Integer usualDay, int gapDays, BigDecimal average,
                          BigDecimal total, LocalDate first, LocalDate last, LocalDate nextExpected, BigDecimal changePercent) {
    }

    /** Another entry that looks like this one recorded twice. */
    public record Duplicate(Long entryId, String entryNo, LocalDate date, String narration, BigDecimal amount, String reason) {
    }

    private final LedgerService ledger;
    private final JournalEntryRepository entries;
    private final BudgetRepository budgets;

    public EntryInsightService(LedgerService ledger, JournalEntryRepository entries, BudgetRepository budgets) {
        this.ledger = ledger;
        this.entries = entries;
        this.budgets = budgets;
    }

    public EntryInsights insights(Long entryId) {
        Long tenantId = UserContext.tenantId();
        JournalEntry e = entries.findByIdAndTenantId(entryId, tenantId).orElseThrow(() -> new NotFoundException("Entry", entryId));
        LedgerSnapshot books = ledger.snapshot();
        List<PostedLine> all = books.lines();
        Map<Long, List<PostedLine>> byEntry = all.stream().collect(Collectors.groupingBy(PostedLine::entryId));
        List<PostedLine> own = byEntry.getOrDefault(entryId, List.of());
        Map<Long, JournalEntry> entryById = entries.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        return new EntryInsights(entryId, categories(e, own, all, books, tenantId), pattern(e, entryById),
                duplicates(e, own, byEntry, entryById));
    }

    // ================================================================== categories: the month and the usual

    private List<CategoryInsight> categories(JournalEntry e, List<PostedLine> own, List<PostedLine> all, LedgerSnapshot books, Long tenantId) {
        Map<Long, BigDecimal> mine = new LinkedHashMap<>();
        for (PostedLine l : own) {
            if (l.categoryId() != null) {
                mine.merge(l.categoryId(), books.natural(l.accountId(), l.net()), BigDecimal::add);
            }
        }
        YearMonth month = YearMonth.from(e.getEntryDate());
        LocalDate since = e.getEntryDate().minusMonths(HISTORY_MONTHS);
        List<CategoryInsight> out = new ArrayList<>();
        mine.forEach((categoryId, amount) -> {
            Category c = books.category(categoryId);
            if (c == null || amount.signum() <= 0) {
                return;
            }
            BigDecimal monthTotal = Money.ZERO;
            Map<Long, BigDecimal> perEntry = new LinkedHashMap<>();
            for (PostedLine l : all) {
                if (!categoryId.equals(l.categoryId())) {
                    continue;
                }
                BigDecimal v = books.natural(l.accountId(), l.net());
                if (YearMonth.from(l.date()).equals(month)) {
                    monthTotal = monthTotal.add(v);
                }
                if (!l.entryId().equals(e.getId()) && l.date().isAfter(since) && !l.date().isAfter(e.getEntryDate())) {
                    perEntry.merge(l.entryId(), v, BigDecimal::add);
                }
            }
            List<BigDecimal> past = perEntry.values().stream().filter(v -> v.signum() > 0).toList();
            BigDecimal usual = past.size() >= 3
                    ? past.stream().reduce(Money.ZERO, BigDecimal::add).divide(BigDecimal.valueOf(past.size()), 2, RoundingMode.HALF_UP) : null;
            Budget b = budgets.findOne(tenantId, categoryId, month.toString()).orElse(null);
            BigDecimal limit = b == null ? null : b.getMonthlyLimit();
            out.add(new CategoryInsight(categoryId, c.getName(), c.getKind().name(), Money.round(amount), month.toString(), Money.round(monthTotal),
                    limit, limit == null || limit.signum() <= 0 ? null : Money.percent(monthTotal, limit), b == null ? null : b.getAlertPercent(),
                    usual, past.size(), usual == null || usual.signum() == 0 ? null : amount.divide(usual, 2, RoundingMode.HALF_UP)));
        });
        return out;
    }

    // ================================================================== repeats

    private Pattern pattern(JournalEntry e, Map<Long, JournalEntry> entryById) {
        String party = norm(e.getParty());
        String by = party.isEmpty() ? "DESCRIPTION" : "PARTY";
        String key = party.isEmpty() ? norm(e.getNarration()) : party;
        if (key.length() < 3) {
            return null;
        }
        LocalDate since = e.getEntryDate().minusMonths(HISTORY_MONTHS);
        List<JournalEntry> same = entryById.values().stream()
                .filter(x -> !x.getId().equals(e.getId()) && x.getVoucherType() == e.getVoucherType())
                .filter(x -> x.getEntryDate().isAfter(since) && !x.getEntryDate().isAfter(e.getEntryDate().plusMonths(1)))
                .filter(x -> key.equals(party.isEmpty() ? norm(x.getNarration()) : norm(x.getParty())))
                .filter(x -> !LedgerService.SOURCE_REVERSAL.equals(x.getSourceType()) && !LedgerService.SOURCE_REFUND.equals(x.getSourceType()))
                .toList();
        if (same.size() < 2) {
            return null;
        }
        List<JournalEntry> together = new ArrayList<>(same);
        together.add(e);
        together.sort(Comparator.comparing(JournalEntry::getEntryDate).thenComparing(JournalEntry::getId));
        List<Long> gaps = new ArrayList<>();
        for (int i = 1; i < together.size(); i++) {
            gaps.add(ChronoUnit.DAYS.between(together.get(i - 1).getEntryDate(), together.get(i).getEntryDate()));
        }
        long gap = median(gaps.stream().filter(g -> g > 0).toList());
        String cadence = gap >= 5 && gap <= 9 ? "WEEKLY" : gap >= 25 && gap <= 36 ? "MONTHLY" : gap >= 80 && gap <= 100 ? "QUARTERLY"
                : gap >= 350 && gap <= 380 ? "YEARLY" : "IRREGULAR";
        // regular: most gaps close to the typical one
        long close = gaps.stream().filter(g -> gap > 0 && Math.abs(g - gap) <= Math.max(4, gap / 5)).count();
        if (!"IRREGULAR".equals(cadence) && close * 2 < gaps.size()) {
            cadence = "IRREGULAR";
        }
        Integer usualDay = "MONTHLY".equals(cadence) || "QUARTERLY".equals(cadence)
                ? (int) median(together.stream().map(x -> (long) x.getEntryDate().getDayOfMonth()).toList()) : null;
        BigDecimal average = same.stream().map(JournalEntry::getAmount).reduce(Money.ZERO, BigDecimal::add)
                .divide(BigDecimal.valueOf(same.size()), 2, RoundingMode.HALF_UP);
        LocalDate last = together.getLast().getEntryDate();
        LocalDate next = "IRREGULAR".equals(cadence) || gap <= 0 ? null
                : usualDay != null ? safeDay(YearMonth.from(last).plusMonths("QUARTERLY".equals(cadence) ? 3 : 1), usualDay) : last.plusDays(gap);
        return new Pattern(by, party.isEmpty() ? e.getNarration() : e.getParty(), together.size(), cadence, usualDay, (int) gap, average,
                Money.round(together.stream().map(JournalEntry::getAmount).reduce(Money.ZERO, BigDecimal::add)),
                together.getFirst().getEntryDate(), last, next,
                average.signum() == 0 ? null : Money.percent(e.getAmount().subtract(average), average));
    }

    // ================================================================== recorded twice?

    private List<Duplicate> duplicates(JournalEntry e, List<PostedLine> own, Map<Long, List<PostedLine>> byEntry, Map<Long, JournalEntry> entryById) {
        if (LedgerService.SOURCE_REVERSAL.equals(e.getSourceType()) || e.getAmount() == null) {
            return List.of();
        }
        Set<String> myTargets = targets(own);
        List<Duplicate> out = new ArrayList<>();
        for (JournalEntry x : entryById.values()) {
            if (x.getId().equals(e.getId()) || x.getVoucherType() != e.getVoucherType() || x.getAmount() == null
                    || x.getAmount().subtract(e.getAmount()).abs().compareTo(new BigDecimal("0.5")) > 0
                    || Math.abs(ChronoUnit.DAYS.between(x.getEntryDate(), e.getEntryDate())) > DUPLICATE_DAYS) {
                continue;
            }
            // a reversal of either, or the two sides of one transfer pair, are not duplicates
            if (Objects.equals(x.getSourceId(), e.getId()) || Objects.equals(e.getSourceId(), x.getId())) {
                continue;
            }
            String reason = !norm(e.getParty()).isEmpty() && norm(e.getParty()).equals(norm(x.getParty())) ? "same amount and shop / person"
                    : norm(e.getNarration()).equals(norm(x.getNarration())) ? "same amount and description"
                    : !myTargets.isEmpty() && myTargets.equals(targets(byEntry.getOrDefault(x.getId(), List.of()))) ? "same amount and accounts" : null;
            if (reason != null) {
                long days = Math.abs(ChronoUnit.DAYS.between(x.getEntryDate(), e.getEntryDate()));
                out.add(new Duplicate(x.getId(), x.getEntryNo(), x.getEntryDate(), x.getNarration(), x.getAmount(),
                        reason + (days == 0 ? ", the same day" : ", " + days + " day" + (days == 1 ? "" : "s") + " apart")));
            }
        }
        out.sort(Comparator.comparing(Duplicate::date));
        return out.stream().limit(3).toList();
    }

    /** What the entry is for and paid from: the account (and category / chit) of every line. */
    private static Set<String> targets(List<PostedLine> lines) {
        return lines.stream().map(l -> (l.debit().signum() > 0 ? "D" : "C") + l.accountId() + "/" + l.categoryId() + "/" + l.chitId())
                .collect(Collectors.toSet());
    }

    // ================================================================== helpers

    /** Lower case, digits and punctuation out ("Instalment 11/20 · Margadarsi" and "Instalment 12/20 · Margadarsi" match). */
    private static String norm(String text) {
        return text == null ? "" : text.toLowerCase(Locale.ROOT).replaceAll("[^a-z]+", " ").trim().replaceAll("\\s+", " ");
    }

    private static long median(List<Long> values) {
        if (values.isEmpty()) {
            return 0;
        }
        List<Long> sorted = values.stream().sorted().toList();
        return sorted.get(sorted.size() / 2);
    }

    private static LocalDate safeDay(YearMonth month, int day) {
        return month.atDay(Math.min(day, month.lengthOfMonth()));
    }
}
