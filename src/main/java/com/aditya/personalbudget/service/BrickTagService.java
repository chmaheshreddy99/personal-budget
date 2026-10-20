package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickExpense;
import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.domain.entity.BrickMaterialPurchase;
import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.domain.entity.BrickPaySlip;
import com.aditya.personalbudget.domain.entity.BrickPayment;
import com.aditya.personalbudget.domain.entity.BrickTrip;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.BrickExpenseRepository;
import com.aditya.personalbudget.repository.BrickMaterialPurchaseRepository;
import com.aditya.personalbudget.repository.BrickMaterialRepository;
import com.aditya.personalbudget.repository.BrickOrderRepository;
import com.aditya.personalbudget.repository.BrickPaySlipRepository;
import com.aditya.personalbudget.repository.BrickPaymentRepository;
import com.aditya.personalbudget.repository.BrickTripRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Which entries are the brick business's, so the journal, the dashboard and every account statement (the personal bank
 * account a customer paid into, the cash a wage was paid from) can flag them: posted by Brick Management (a delivery, a
 * customer's payment, raw material, an expense, a payment slip or a transfer) or touching an account of the brick book
 * (an opening balance, a manual voucher, a reversal).
 */
@Service
public class BrickTagService {

    /**
     * what: Sale, Receipt, Raw material, Expense, Wages, Advance, Transfer or Entry; ref: the order, slip or material it was for;
     * link: where it is in Brick Management, exactly (the order, the payment, the purchase …), or null when there is no such place.
     */
    public record BrickTag(String what, String ref, String link) {
    }

    private final BrickTripRepository trips;
    private final BrickOrderRepository orders;
    private final BrickPaymentRepository payments;
    private final BrickMaterialPurchaseRepository purchases;
    private final BrickMaterialRepository materials;
    private final BrickExpenseRepository expenses;
    private final BrickPaySlipRepository slips;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;

    public BrickTagService(BrickTripRepository trips, BrickOrderRepository orders, BrickPaymentRepository payments,
                           BrickMaterialPurchaseRepository purchases, BrickMaterialRepository materials, BrickExpenseRepository expenses,
                           BrickPaySlipRepository slips, AccountRepository accounts, JournalEntryRepository entries, JournalLineRepository lines) {
        this.trips = trips;
        this.orders = orders;
        this.payments = payments;
        this.purchases = purchases;
        this.materials = materials;
        this.expenses = expenses;
        this.slips = slips;
        this.accounts = accounts;
        this.entries = entries;
        this.lines = lines;
    }

    public Map<Long, BrickTag> forEntryIds(Collection<Long> ids) {
        if (ids.isEmpty()) return Map.of();
        Set<Long> wanted = Set.copyOf(ids);
        return forEntries(entries.findByTenantId(UserContext.tenantId()).stream().filter(e -> wanted.contains(e.getId())).toList());
    }

    /** Entry id → what it was in the brick business, for the entries that are its (the others are left out). */
    public Map<Long, BrickTag> forEntries(Collection<JournalEntry> list) {
        if (list.isEmpty()) return Map.of();
        Long tenant = UserContext.tenantId();
        Set<Long> book = accounts.findByTenantId(tenant).stream().filter(Account::isBrickBook).map(Account::getId).collect(Collectors.toSet());
        boolean anySource = list.stream().anyMatch(e -> e.getSourceType() != null && e.getSourceType().startsWith("BRICK_"));
        if (book.isEmpty() && !anySource) return Map.of();
        Map<String, Map<Long, String>> refs = new HashMap<>();
        Function<String, Map<Long, String>> ref = type -> refs.computeIfAbsent(type, t -> switch (t) {
            case BrickService.SOURCE_DELIVERY -> {
                Map<Long, String> no = orders.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickOrder::getId, BrickOrder::getOrderNo));
                yield trips.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickTrip::getId,
                        x -> no.getOrDefault(x.getOrderId(), "Order") + " · trip " + x.getTripNo()));
            }
            case BrickService.SOURCE_RECEIPT -> {
                Map<Long, String> no = orders.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickOrder::getId, BrickOrder::getOrderNo));
                yield payments.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickPayment::getId,
                        x -> no.getOrDefault(x.getOrderId(), "Order") + (x.getReceiptNo() != null ? " · " + x.getReceiptNo() : "")));
            }
            case BrickService.SOURCE_MATERIAL -> {
                Map<Long, String> name = materials.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickMaterial::getId, BrickMaterial::getName));
                yield purchases.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickMaterialPurchase::getId,
                        x -> name.getOrDefault(x.getMaterialId(), "Raw material")));
            }
            case BrickService.SOURCE_EXPENSE -> expenses.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickExpense::getId, BrickExpense::getHead));
            case BrickService.SOURCE_SLIP -> slips.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickPaySlip::getId,
                    x -> x.getSlipNo() + (BrickPayrollService.ADVANCE.equals(x.getKind()) ? "|A" : "")));
            default -> Map.of();
        });
        Map<String, Map<Long, String>> links = new HashMap<>();
        Function<String, Map<Long, String>> link = type -> links.computeIfAbsent(type, t -> switch (t) {
            case BrickService.SOURCE_DELIVERY -> trips.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickTrip::getId, x -> "bricks/sales/" + x.getOrderId()));
            case BrickService.SOURCE_RECEIPT -> payments.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickPayment::getId,
                    x -> "bricks/sales/" + x.getOrderId() + "/payments"));
            case BrickService.SOURCE_MATERIAL -> purchases.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickMaterialPurchase::getId,
                    x -> "bricks/materials/" + x.getMaterialId() + "/p" + x.getId()));
            case BrickService.SOURCE_EXPENSE -> expenses.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickExpense::getId, x -> "bricks/expenses/" + x.getId()));
            case BrickService.SOURCE_SLIP -> slips.findByTenantId(tenant).stream().collect(Collectors.toMap(BrickPaySlip::getId, x -> "bricks/payments/" + x.getId()));
            default -> Map.of();
        });
        Map<Long, List<JournalLine>> linesByEntry = book.isEmpty() ? Map.of() : lines.findByJournalEntryIdIn(list.stream().map(JournalEntry::getId)
                .collect(Collectors.toSet())).stream().collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        Map<Long, BrickTag> out = new HashMap<>();
        for (JournalEntry e : list) {
            String type = e.getSourceType();
            if (type != null && type.startsWith("BRICK_")) {
                String r = e.getSourceId() == null ? null : ref.apply(type).get(e.getSourceId());
                String what = switch (type) {
                    case BrickService.SOURCE_DELIVERY -> "Sale";
                    case BrickService.SOURCE_RECEIPT -> "Receipt";
                    case BrickService.SOURCE_MATERIAL -> "Raw material";
                    case BrickService.SOURCE_EXPENSE -> "Expense";
                    case BrickService.SOURCE_SLIP -> r != null && r.endsWith("|A") ? "Advance" : "Wages";
                    case BrickService.SOURCE_TRANSFER -> "Transfer";
                    default -> "Entry";
                };
                String to = e.getSourceId() == null ? null : link.apply(type).get(e.getSourceId());
                if (to == null) to = bookLink(linesByEntry.get(e.getId()), book);
                out.put(e.getId(), new BrickTag(what, r == null ? null : r.replace("|A", ""), to));
            } else if (linesByEntry.getOrDefault(e.getId(), List.of()).stream().anyMatch(l -> book.contains(l.getAccountId()))) {
                out.put(e.getId(), new BrickTag(LedgerService.SOURCE_ACCOUNT_OPENING.equals(type) ? "Opening" : "Entry", null, bookLink(linesByEntry.get(e.getId()), book)));
            }
        }
        return out;
    }

    /** The statement of the first brick-book account the entry moves (null when it moves none). */
    private static String bookLink(List<JournalLine> lines, Set<Long> book) {
        if (lines == null) return null;
        return lines.stream().map(JournalLine::getAccountId).filter(book::contains).findFirst().map(id -> "bricks/accounts/" + id).orElse(null);
    }
}
