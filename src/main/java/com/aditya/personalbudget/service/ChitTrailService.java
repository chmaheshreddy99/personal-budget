package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.entity.HostedChitLeg;
import com.aditya.personalbudget.domain.entity.HostedChitMember;
import com.aditya.personalbudget.domain.entity.HostedChitMonth;
import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.domain.entity.HostedChitTransfer;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.HostedChitLegRepository;
import com.aditya.personalbudget.repository.HostedChitMemberRepository;
import com.aditya.personalbudget.repository.HostedChitMonthRepository;
import com.aditya.personalbudget.repository.HostedChitPaymentRepository;
import com.aditya.personalbudget.repository.HostedChitRepository;
import com.aditya.personalbudget.repository.HostedChitTransferRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Where a hosted chit's money stands, told against the journal entries that moved it (Journal, account ledgers, Chit
 * accounts statements, transfers, a chit's payments):
 * <ul>
 *   <li><b>a member's payment</b> (COLLECTION): awaiting a move into the collections account (it came into another
 *       account), moved (by which transfer, when), in the collections from the start, or paid to the winner directly;
 *       and, once the month is paid out, the payout that paid it out;</li>
 *   <li><b>a transfer</b> (MOVE): what kind of move it is (gathered into the collections for a payout, chit money
 *       moved, my money put in, taken out, the commission to my bank) and, for money gathered for a payout, the
 *       payout's details, filled in only once that payout is made (until then it waits for it);</li>
 *   <li><b>a payout</b> (PAYOUT) and <b>the commission</b> (COMMISSION): the month, the winner, what was gathered for
 *       it; whether the commission still waits in the collections or has been moved.</li>
 * </ul>
 * Read-only, from the chit tables; depends on repositories only.
 */
@Service
public class ChitTrailService {

    /**
     * kind: COLLECTION, MOVE, PAYOUT or COMMISSION. status: COLLECTION: TO_MOVE, MOVED, IN_COLLECTIONS or DIRECT; MOVE:
     * AWAITING_PAYOUT, PAID_OUT or DONE; PAYOUT: PAID; COMMISSION: PENDING or MOVED. tone: warn, good, teal or muted.
     * moveType: the kind of move, in words (transfers). movedBy / movedOn: the transfer that moved a payment. The payout
     * fields are set only when that payout is made. payments / paymentsTotal: the members' payments it carries.
     */
    public record Trail(String kind, String status, String label, String tone, String moveType, String detail,
                        Long chitId, String chitName, Integer monthNo, String payCode,
                        String movedBy, LocalDate movedOn,
                        String payoutEntryNo, LocalDate payoutDate, String winner, BigDecimal payoutAmount,
                        Integer payments, BigDecimal paymentsTotal) {
    }

    private final HostedChitRepository chits;
    private final HostedChitPaymentRepository payments;
    private final HostedChitMonthRepository months;
    private final HostedChitTransferRepository transfers;
    private final HostedChitLegRepository legs;
    private final HostedChitMemberRepository members;
    private final JournalEntryRepository entries;
    private final AccountRepository accounts;

    public ChitTrailService(HostedChitRepository chits, HostedChitPaymentRepository payments, HostedChitMonthRepository months,
                            HostedChitTransferRepository transfers, HostedChitLegRepository legs, HostedChitMemberRepository members,
                            JournalEntryRepository entries, AccountRepository accounts) {
        this.chits = chits;
        this.payments = payments;
        this.months = months;
        this.transfers = transfers;
        this.legs = legs;
        this.members = members;
        this.entries = entries;
        this.accounts = accounts;
    }

    /** The trail of each of these entries that moved a hosted chit's money (others are left out). */
    public Map<Long, Trail> forEntries(Collection<JournalEntry> list) {
        List<JournalEntry> chitEntries = list.stream().filter(e -> e.getSourceType() != null && e.getSourceType().startsWith("HOSTED_CHIT_")).toList();
        if (chitEntries.isEmpty()) return Map.of();
        Context x = new Context();
        Map<Long, Trail> out = new HashMap<>();
        for (JournalEntry e : chitEntries) {
            Trail t = switch (e.getSourceType()) {
                case HostedChitService.SOURCE_COLLECTION -> x.collection(x.paymentById.get(e.getSourceId()));
                case HostedChitBookService.SOURCE_TRANSFER -> x.move(x.transferById.get(e.getSourceId()));
                case HostedChitService.SOURCE_PAYOUT -> x.payout(x.monthById.get(e.getSourceId()));
                case HostedChitService.SOURCE_COMMISSION -> x.commission(x.monthById.get(e.getSourceId()), e.getId());
                default -> null;
            };
            if (t != null) out.put(e.getId(), t);
        }
        return out;
    }

    /** The trail of entries given by id. */
    public Map<Long, Trail> forEntryIds(Collection<Long> ids) {
        List<Long> clean = ids.stream().filter(Objects::nonNull).distinct().toList();
        return clean.isEmpty() ? Map.of() : forEntries(entries.findAllById(clean));
    }

    /** Everything about the household's hosted chits, read once. */
    private final class Context {
        final Long tenantId = UserContext.tenantId();
        final Map<Long, HostedChit> chitById = chits.findByTenantId(tenantId).stream().collect(Collectors.toMap(HostedChit::getId, Function.identity()));
        final Map<Long, HostedChitPayment> paymentById = payments.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(HostedChitPayment::getId, Function.identity()));
        final Map<Long, HostedChitMonth> monthById = months.findByTenantId(tenantId).stream().collect(Collectors.toMap(HostedChitMonth::getId, Function.identity()));
        final Map<Long, HostedChitTransfer> transferById = transfers.findByTenantId(tenantId).stream()
                .collect(Collectors.toMap(HostedChitTransfer::getId, Function.identity()));
        final List<HostedChitLeg> legList = legs.findByTenantId(tenantId);
        final Map<Long, String> memberName = members.findByTenantId(tenantId).stream().collect(Collectors.toMap(HostedChitMember::getId, HostedChitMember::getName));
        final Map<Long, Account> accountById = accounts.findByTenantId(tenantId).stream().collect(Collectors.toMap(Account::getId, Function.identity()));
        final Map<Long, JournalEntry> entryById = new HashMap<>();
        /** payment → the transfer that moved it; payment → the month whose payout carried it. */
        final Map<Long, HostedChitTransfer> movedBy = new HashMap<>();
        final Map<Long, HostedChitMonth> paidOutBy = new HashMap<>();

        Context() {
            Set<Long> ids = new java.util.HashSet<>();
            transferById.values().forEach(t -> { if (t.getJournalEntryId() != null) ids.add(t.getJournalEntryId()); });
            monthById.values().forEach(m -> { if (m.getPayoutEntryId() != null) ids.add(m.getPayoutEntryId()); });
            entries.findAllById(ids).forEach(e -> entryById.put(e.getId(), e));
            for (HostedChitLeg l : legList) {
                for (Long id : HostedChitBookService.ids(l.getPaymentIds())) {
                    if (l.getTransferId() != null && transferById.containsKey(l.getTransferId())) movedBy.put(id, transferById.get(l.getTransferId()));
                    if (l.getMonthId() != null && monthById.containsKey(l.getMonthId())) paidOutBy.put(id, monthById.get(l.getMonthId()));
                }
            }
        }

        HostedChitMonth month(Long chitId, Integer monthNo) {
            if (chitId == null || monthNo == null) return null;
            return monthById.values().stream().filter(m -> m.getChitId().equals(chitId) && m.getMonthNo().equals(monthNo)).findFirst().orElse(null);
        }

        String code(HostedChit c, Integer monthNo) {
            return c == null || monthNo == null ? null : HostedChitService.payCode(HostedChitService.shortCodeOf(c), monthNo);
        }

        String entryNo(Long id) {
            return id == null || !entryById.containsKey(id) ? null : entryById.get(id).getEntryNo();
        }

        String accountName(Long id) {
            return id == null || !accountById.containsKey(id) ? "?" : accountById.get(id).getName();
        }

        /** The month whose payout paid this payment out: the payout part naming it, else its own month paid out after it came in. */
        HostedChitMonth payoutOf(HostedChitPayment p) {
            HostedChitMonth m = paidOutBy.get(p.getId());
            if (m != null && m.getPayoutDate() != null) return m;
            m = month(p.getChitId(), p.getMonthNo());
            if (m == null || m.getPayoutDate() == null) return null;
            boolean before = m.getPayoutRecordedAt() == null || p.getCreatedAt() == null || !p.getCreatedAt().isAfter(m.getPayoutRecordedAt());
            return before ? m : null;
        }

        Trail collection(HostedChitPayment p) {
            if (p == null) return null;
            HostedChit c = chitById.get(p.getChitId());
            if (c == null) return null;
            HostedChitTransfer t = movedBy.get(p.getId());
            Long into = p.getAccountId() != null ? p.getAccountId() : c.getAccountId();
            String status = p.getPaidToMemberId() != null ? "DIRECT" : t != null ? "MOVED"
                    : c.getAccountId() == null || into.equals(c.getAccountId()) ? "IN_COLLECTIONS" : "TO_MOVE";
            HostedChitMonth paid = payoutOf(p);
            String[] look = switch (status) {
                case "DIRECT" -> new String[] {"Paid to the winner", "muted", "Paid straight to " + memberName.getOrDefault(p.getPaidToMemberId(), "the winner") + ", set off against the payout"};
                case "MOVED" -> new String[] {"Moved to collections", "good", "Moved from " + accountName(into) + " into " + accountName(t.getToAccountId())
                        + (entryNo(t.getJournalEntryId()) != null ? " by " + entryNo(t.getJournalEntryId()) : "") + " on " + t.getTransferDate()};
                case "IN_COLLECTIONS" -> new String[] {"In collections", "teal", "Came straight into " + accountName(c.getAccountId())};
                default -> new String[] {"Awaiting move", "warn", "In " + accountName(into) + ": to be moved into " + accountName(c.getAccountId()) + " before the payout"};
            };
            return trail("COLLECTION", status, look[0], look[1], null, look[2], c, p.getMonthNo(),
                    t == null ? null : entryNo(t.getJournalEntryId()), t == null ? null : t.getTransferDate(), paid, 1, p.getAmount());
        }

        Trail move(HostedChitTransfer t) {
            if (t == null || t.getChitId() == null) return null;
            HostedChit c = chitById.get(t.getChitId());
            if (c == null) return null;
            List<HostedChitLeg> from = legList.stream().filter(l -> t.getId().equals(l.getTransferId())).toList();
            List<HostedChitPayment> carried = from.stream().flatMap(l -> HostedChitBookService.ids(l.getPaymentIds()).stream())
                    .map(paymentById::get).filter(Objects::nonNull).toList();
            BigDecimal total = carried.stream().map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
            // the commission moved on to my bank after a payout
            HostedChitMonth commissionOf = monthById.values().stream().filter(m -> t.getId().equals(m.getCommissionBankTransferId())).findFirst().orElse(null);
            if (commissionOf != null) {
                return trail("MOVE", "DONE", "Commission to my bank", "good", "Commission to my bank",
                        "Month " + commissionOf.getMonthNo() + "'s commission, from " + accountName(c.getCommissionAccountId()) + " to " + accountName(t.getToAccountId()),
                        c, commissionOf.getMonthNo(), null, null, commissionOf, 0, Money.ZERO);
            }
            Account to = accountById.get(t.getToAccountId());
            boolean toCollections = t.getToAccountId().equals(c.getAccountId());
            boolean fromPersonal = from.stream().map(l -> accountById.get(l.getAccountId())).anyMatch(a -> a != null && !a.isChitBook());
            boolean chitMoney = Boolean.TRUE.equals(t.getChitMoney());
            if (chitMoney && toCollections) {
                Integer monthNo = t.getPayoutMonthNo() != null ? t.getPayoutMonthNo()
                        : carried.stream().map(HostedChitPayment::getMonthNo).distinct().count() == 1 ? carried.getFirst().getMonthNo() : null;
                HostedChitMonth m = month(c.getId(), monthNo);
                boolean paid = m != null && m.getPayoutDate() != null;
                String code = code(c, monthNo);
                return trail("MOVE", paid ? "PAID_OUT" : "AWAITING_PAYOUT", paid ? "Gathered · paid out" : "Gathered · awaiting payout",
                        paid ? "good" : "warn", "Gathered into collections",
                        carried.size() + " payment" + (carried.size() == 1 ? "" : "s") + " (" + ActivityService.money(total) + ") moved into "
                                + accountName(c.getAccountId()) + (code != null ? " for the " + code + " payout" : "")
                                + (paid ? "" : m != null ? "; the payout is not made yet" : ""),
                        c, monthNo, null, null, paid ? m : null, carried.size(), total);
            }
            String type = chitMoney ? (from.size() > 1 ? "Chit money consolidated" : "Chit money moved")
                    : fromPersonal && to != null && to.isChitBook() ? "My money put into the chit"
                    : to != null && !to.isChitBook() ? "Taken out to my account" : "Between chit accounts";
            return trail("MOVE", "DONE", type, "muted", type, type + ": " + from.stream().map(l -> accountName(l.getAccountId())).collect(Collectors.joining(" + "))
                    + " → " + accountName(t.getToAccountId()), c, t.getPayoutMonthNo(), null, null, null, carried.size(), total);
        }

        Trail payout(HostedChitMonth m) {
            if (m == null || m.getPayoutDate() == null) return null;
            HostedChit c = chitById.get(m.getChitId());
            if (c == null) return null;
            List<HostedChitPayment> carried = legList.stream().filter(l -> m.getId().equals(l.getMonthId()))
                    .flatMap(l -> HostedChitBookService.ids(l.getPaymentIds()).stream()).map(paymentById::get).filter(Objects::nonNull).toList();
            List<String> gathered = transferById.values().stream().filter(t -> c.getId().equals(t.getChitId()) && Objects.equals(t.getPayoutMonthNo(), m.getMonthNo()))
                    .map(t -> entryNo(t.getJournalEntryId())).filter(Objects::nonNull).toList();
            BigDecimal total = carried.stream().map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
            return trail("PAYOUT", "PAID", "Payout " + code(c, m.getMonthNo()), "good", null,
                    "Paid " + ActivityService.money(m.getPayoutAmount()) + " to " + memberName.getOrDefault(m.getWinnerMemberId(), "the winner")
                            + (gathered.isEmpty() ? "" : " from the money gathered by " + String.join(", ", gathered)),
                    c, m.getMonthNo(), gathered.isEmpty() ? null : String.join(", ", gathered), null, m, carried.size(), total);
        }

        Trail commission(HostedChitMonth m, Long entryId) {
            if (m == null) return null;
            HostedChit c = chitById.get(m.getChitId());
            if (c == null) return null;
            boolean pending = HostedChitService.commissionPending(m);
            boolean isMove = entryId.equals(m.getCommissionTransferEntryId());
            String label = isMove ? "Commission moved" : pending ? "Commission awaiting move" : "Commission";
            String detail = isMove ? "Moved into " + accountName(c.getCommissionAccountId())
                    : pending ? "Booked as income; the money waits in " + accountName(c.getAccountId()) + " to be moved"
                    : "Booked as income for month " + m.getMonthNo();
            return trail("COMMISSION", pending ? "PENDING" : "MOVED", label, pending ? "warn" : "good", null, detail,
                    c, m.getMonthNo(), null, null, m, 0, Money.ZERO);
        }

        /** paid: the month whose payout is made (its details go on the trail), or null. */
        Trail trail(String kind, String status, String label, String tone, String moveType, String detail, HostedChit c, Integer monthNo,
                    String movedBy, LocalDate movedOn, HostedChitMonth paid, int count, BigDecimal total) {
            boolean done = paid != null && paid.getPayoutDate() != null;
            return new Trail(kind, status, label, tone, moveType, detail, c.getId(), c.getName(), monthNo, code(c, monthNo), movedBy, movedOn,
                    done ? entryNo(paid.getPayoutEntryId()) : null, done ? paid.getPayoutDate() : null,
                    done ? memberName.get(paid.getWinnerMemberId()) : null, done ? paid.getPayoutAmount() : null,
                    count == 0 ? null : count, count == 0 ? null : total);
        }
    }
}
