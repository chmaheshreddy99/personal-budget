package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimInterestPosting;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.dto.ReportDtos.ClaimBalance;
import com.aditya.personalbudget.dto.ReportDtos.Counterparties;
import com.aditya.personalbudget.dto.ReportDtos.PartyBalance;
import com.aditya.personalbudget.repository.ClaimInterestPostingRepository;
import com.aditya.personalbudget.repository.ClaimRepaymentRepository;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Who makes up the money owed to you and the money you owe, for the balance sheet: each receivable / payable account
 * split into the people on it (money lent, paid for someone, borrowed, bills to pay later), each with the items behind
 * their balance, on the balance sheet's date and on its comparison date.
 * <p>
 * A line on such an account belongs to an item when its entry was posted for it: the item itself, a repayment of it,
 * interest posted on it, or the reversal of one of those. The other entries (an expense paid "later" through Payables,
 * a transfer, a journal) are settled oldest first by the payments; what is still open of them is listed under the shop
 * or person named on the entry, or in one group without a name. What cannot be matched (paid ahead) is left over as
 * {@code unlinked}, so the parts always add up to the account.
 * <p>
 * Card EMIs sit in Payables too (see {@link EmiService}): their entries are told by their source, stay out of that oldest
 * first settling, and are listed together as Credit Card EMI, a plan each.
 */
@Service
public class CounterpartyService {

    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;
    private final ClaimRepository claims;
    private final ClaimRepaymentRepository repayments;
    private final ClaimInterestPostingRepository interest;
    private final com.aditya.personalbudget.repository.EmiPlanRepository emiPlans;
    private final com.aditya.personalbudget.repository.EmiInstallmentRepository emiInstallments;

    public CounterpartyService(JournalEntryRepository entries, JournalLineRepository lines, ClaimRepository claims,
                               ClaimRepaymentRepository repayments, ClaimInterestPostingRepository interest,
                               com.aditya.personalbudget.repository.EmiPlanRepository emiPlans,
                               com.aditya.personalbudget.repository.EmiInstallmentRepository emiInstallments) {
        this.emiPlans = emiPlans;
        this.emiInstallments = emiInstallments;
        this.entries = entries;
        this.lines = lines;
        this.claims = claims;
        this.repayments = repayments;
        this.interest = interest;
    }

    /**
     * The people on each receivable / payable account (and any other account an item sits in) with a balance on
     * either date. {@code now} / {@code before} are the accounts' balances on those dates (natural sign).
     */
    public List<Counterparties> breakdown(LedgerSnapshot books, LocalDate asOf, LocalDate compareDate,
                                          Map<Long, BigDecimal> now, Map<Long, BigDecimal> before) {
        Long tenantId = UserContext.tenantId();
        List<Claim> all = claims.findByTenantId(tenantId);
        Map<Long, Claim> claimById = all.stream().collect(Collectors.toMap(Claim::getId, Function.identity()));
        Set<Long> holding = all.stream().map(Claim::getReceivableAccountId).filter(Objects::nonNull).collect(Collectors.toSet());
        List<Account> accounts = books.accounts().values().stream()
                .filter(a -> !a.isChitBook() && !a.isProjectBook() && !a.isEmiAccount())
                .filter(a -> a.getAccountType() == AccountType.RECEIVABLE || a.getAccountType() == AccountType.PAYABLE
                        || holding.contains(a.getId()))
                .sorted(Comparator.comparing(Account::getCode))
                .toList();
        if (accounts.isEmpty()) {
            return List.of();
        }
        Map<Long, JournalEntry> entryById = entries.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        Map<Long, Long> claimOfRepayment = repayments.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(ClaimRepayment::getId, ClaimRepayment::getClaimId));
        Map<Long, Long> claimOfPosting = interest.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(ClaimInterestPosting::getId, ClaimInterestPosting::getClaimId));
        Function<JournalEntry, Long> claimOf = new Function<>() {
            @Override
            public Long apply(JournalEntry e) {
                if (e == null || e.getSourceType() == null || e.getSourceId() == null) {
                    return null;
                }
                return switch (e.getSourceType()) {
                    case LedgerService.SOURCE_CLAIM -> e.getSourceId();
                    case LedgerService.SOURCE_CLAIM_REPAYMENT -> claimOfRepayment.get(e.getSourceId());
                    case LedgerService.SOURCE_CLAIM_INTEREST -> claimOfPosting.get(e.getSourceId());
                    // a reversed entry: the reversal belongs where the entry did
                    case LedgerService.SOURCE_REVERSAL -> e.getSourceId().equals(e.getId()) ? null : apply(entryById.get(e.getSourceId()));
                    default -> null;
                };
            }
        };

        // the card EMI plan an entry was posted for
        Map<Long, com.aditya.personalbudget.domain.entity.EmiPlan> planById = emiPlans.findByTenantId(tenantId).stream()
                .filter(p -> p.getPayableAccountId() != null)
                .collect(Collectors.toMap(com.aditya.personalbudget.domain.entity.EmiPlan::getId, Function.identity()));
        Map<Long, com.aditya.personalbudget.domain.entity.EmiInstallment> installmentById = emiInstallments.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(com.aditya.personalbudget.domain.entity.EmiInstallment::getId, Function.identity()));
        Function<JournalEntry, Long> planOf = e -> {
            if (e == null || e.getSourceType() == null || e.getSourceId() == null) {
                return null;
            }
            Long planId = switch (e.getSourceType()) {
                case EmiService.SOURCE_CONVERT, EmiService.SOURCE_FORECLOSE -> e.getSourceId();
                case EmiService.SOURCE_CARD_PAYMENT, EmiService.SOURCE_BILL -> {
                    var i = installmentById.get(e.getSourceId());
                    yield i == null ? null : i.getPlanId();
                }
                default -> null;
            };
            return planId != null && planById.containsKey(planId) ? planId : null;
        };

        List<Counterparties> out = new ArrayList<>();
        for (Account account : accounts) {
            boolean payable = account.getAccountClass() == AccountClass.LIABILITY;
            Map<Long, BigDecimal[]> byPlan = new LinkedHashMap<>();
            // natural-sign balance per item on both dates; the moves of the entries not made for an item
            Map<Long, BigDecimal[]> byClaim = new LinkedHashMap<>();
            List<Move> other = new ArrayList<>();
            for (JournalLine l : lines.findByAccountId(account.getId())) {
                JournalEntry e = entryById.get(l.getJournalEntryId());
                if (e == null || e.getEntryDate().isAfter(asOf) && e.getEntryDate().isAfter(compareDate)) {
                    continue;
                }
                BigDecimal value = books.natural(account.getId(), l.getDebit().subtract(l.getCredit()));
                Long planId = planOf.apply(e);
                if (planId != null) {
                    BigDecimal[] v = byPlan.computeIfAbsent(planId, k -> new BigDecimal[] {Money.ZERO, Money.ZERO});
                    if (!e.getEntryDate().isAfter(asOf)) {
                        v[0] = v[0].add(value);
                    }
                    if (!e.getEntryDate().isAfter(compareDate)) {
                        v[1] = v[1].add(value);
                    }
                    continue;
                }
                Long claimId = claimOf.apply(e);
                if (claimId == null || !claimById.containsKey(claimId)) {
                    other.add(new Move(e, value));
                    continue;
                }
                BigDecimal[] v = byClaim.computeIfAbsent(claimId, k -> new BigDecimal[] {Money.ZERO, Money.ZERO});
                if (!e.getEntryDate().isAfter(asOf)) {
                    v[0] = v[0].add(value);
                }
                if (!e.getEntryDate().isAfter(compareDate)) {
                    v[1] = v[1].add(value);
                }
            }
            // people: items grouped by name, however it was typed; open entries under the name on them ("" for none)
            Map<String, List<ClaimBalance>> byParty = new LinkedHashMap<>();
            Map<String, String> partyName = new HashMap<>();
            byClaim.forEach((claimId, v) -> {
                BigDecimal amount = Money.round(v[0]), previous = Money.round(v[1]);
                if (amount.signum() == 0 && previous.signum() == 0) {
                    return;
                }
                Claim c = claimById.get(claimId);
                boolean overdue = amount.signum() > 0 && c.getDueDate() != null && c.getDueDate().isBefore(asOf);
                String key = keyOf(c.getParty());
                partyName.putIfAbsent(key, c.getParty() == null ? "" : c.getParty().trim());
                byParty.computeIfAbsent(key, k -> new ArrayList<>()).add(new ClaimBalance(c.getId(), c.getJournalEntryId(),
                        c.getKind().name(), c.getKind().getLabel(), c.getNarration(), c.getStartDate(), c.getDueDate(), amount, previous, overdue));
            });
            byPlan.forEach((planId, v) -> {
                BigDecimal amount = Money.round(v[0]), previous = Money.round(v[1]);
                if (amount.signum() == 0 && previous.signum() == 0) {
                    return;
                }
                var p = planById.get(planId);
                LocalDate next = installmentById.values().stream()
                        .filter(i -> planId.equals(i.getPlanId()) && ("DUE".equals(i.getStatus()) || "BILLED".equals(i.getStatus())))
                        .map(com.aditya.personalbudget.domain.entity.EmiInstallment::getDueDate).min(LocalDate::compareTo).orElse(null);
                partyName.putIfAbsent(CARD_EMI_KEY, CARD_EMI);
                byParty.computeIfAbsent(CARD_EMI_KEY, k -> new ArrayList<>()).add(new ClaimBalance(null, p.getConversionEntryId(), "EMI", CARD_EMI, p.getNarration(),
                        p.getPurchaseDate(), next, amount, previous, false));
            });
            Map<Long, BigDecimal> openNow = open(other, asOf), openBefore = open(other, compareDate);
            Set<Long> openIds = new java.util.LinkedHashSet<>(openNow.keySet());
            openIds.addAll(openBefore.keySet());
            for (Long entryId : openIds) {
                JournalEntry e = entryById.get(entryId);
                String key = keyOf(e.getParty());
                partyName.putIfAbsent(key, e.getParty() == null ? "" : e.getParty().trim());
                byParty.computeIfAbsent(key, k -> new ArrayList<>()).add(new ClaimBalance(null, entryId, "ENTRY",
                        payable ? "To pay" : "To receive", e.getNarration(), e.getEntryDate(), null,
                        openNow.getOrDefault(entryId, Money.ZERO), openBefore.getOrDefault(entryId, Money.ZERO), false));
            }
            if (byParty.isEmpty()) {
                continue;
            }
            List<PartyBalance> parties = byParty.entrySet().stream().map(p -> {
                List<ClaimBalance> items = p.getValue().stream()
                        .sorted(Comparator.comparing(ClaimBalance::amount).reversed().thenComparing(ClaimBalance::startDate))
                        .toList();
                BigDecimal amount = items.stream().map(ClaimBalance::amount).reduce(Money.ZERO, BigDecimal::add);
                BigDecimal previous = items.stream().map(ClaimBalance::previous).reduce(Money.ZERO, BigDecimal::add);
                LocalDate oldest = items.stream().filter(i -> i.amount().signum() != 0).map(ClaimBalance::startDate)
                        .filter(Objects::nonNull).min(LocalDate::compareTo).orElse(null);
                boolean named = !p.getKey().isEmpty();
                return new PartyBalance(named ? partyName.get(p.getKey()) : "Not linked to a person", named, amount, previous,
                        (int) items.stream().filter(i -> i.amount().signum() != 0).count(),
                        items.stream().anyMatch(ClaimBalance::overdue), oldest, items);
            }).sorted(Comparator.comparing((PartyBalance b) -> !CARD_EMI.equals(b.party()))   // the card EMIs first
                    .thenComparing(Comparator.comparing(PartyBalance::named).reversed())   // the group without a name last
                    .thenComparing(PartyBalance::amount, Comparator.reverseOrder()).thenComparing(PartyBalance::party)).toList();
            BigDecimal listed = parties.stream().map(PartyBalance::amount).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal listedBefore = parties.stream().map(PartyBalance::previous).reduce(Money.ZERO, BigDecimal::add);
            out.add(new Counterparties(account.getId(), account.getName(), payable,
                    parties, Money.round(now.getOrDefault(account.getId(), Money.ZERO).subtract(listed)),
                    Money.round(before.getOrDefault(account.getId(), Money.ZERO).subtract(listedBefore))));
        }
        return out;
    }

    private static final String CARD_EMI = "Credit Card EMI";
    private static final String CARD_EMI_KEY = "\u0000card-emi";

    /** A move on the account by an entry not made for an item (natural sign: up is more owed). */
    private record Move(JournalEntry entry, BigDecimal value) {
    }

    /**
     * Settles the entries that raised the balance with those that lowered it, oldest first (a payment pays the oldest
     * bill still open; a payment made ahead waits for the next bill), and returns what is still open of each entry on
     * a date, in date order.
     */
    private static Map<Long, BigDecimal> open(List<Move> moves, LocalDate on) {
        List<Move> sorted = moves.stream().filter(m -> !m.entry().getEntryDate().isAfter(on))
                .sorted(Comparator.comparing((Move m) -> m.entry().getEntryDate()).thenComparing(m -> m.entry().getId())).toList();
        Map<Long, BigDecimal> openByEntry = new LinkedHashMap<>();
        BigDecimal ahead = Money.ZERO;   // paid before anything was owed
        for (Move m : sorted) {
            if (m.value().signum() > 0) {
                BigDecimal used = m.value().min(ahead);
                ahead = ahead.subtract(used);
                BigDecimal left = m.value().subtract(used);
                if (left.signum() > 0) {
                    openByEntry.merge(m.entry().getId(), left, BigDecimal::add);
                }
            } else {
                BigDecimal pay = m.value().negate();
                for (Map.Entry<Long, BigDecimal> o : openByEntry.entrySet()) {
                    if (pay.signum() <= 0) {
                        break;
                    }
                    BigDecimal take = o.getValue().min(pay);
                    o.setValue(o.getValue().subtract(take));
                    pay = pay.subtract(take);
                }
                ahead = ahead.add(pay);
            }
        }
        Map<Long, BigDecimal> result = new LinkedHashMap<>();
        openByEntry.forEach((id, v) -> {
            if (Money.round(v).signum() != 0) {
                result.put(id, Money.round(v));
            }
        });
        return result;
    }

    private static String keyOf(String party) {
        return party == null ? "" : party.trim().toLowerCase(Locale.ROOT);
    }
}
