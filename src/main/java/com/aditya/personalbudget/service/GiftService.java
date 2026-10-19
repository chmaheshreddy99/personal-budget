package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Gift;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.GiftRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Gifts and donations, given and received (see {@link Gift}). A register beside the books: a gift is not income.
 * Cash given can also be booked as an expense from an account (in the category the user picks, e.g. "Gifts &amp;
 * Donations"); editing or deleting the gift keeps that expense in step.
 */
@Service
public class GiftService {

    private static final Set<String> KINDS = Set.of("CASH", "GOLD", "SILVER", "ITEM", "OTHER");

    public record GiftRequest(
            @NotBlank String direction,
            @NotNull LocalDate giftDate,
            @NotBlank @Size(max = 100) String person,
            @Size(max = 40) String relation,
            @Size(max = 60) String family,
            @Size(max = 60) String occasion,
            @NotBlank String kind,
            @Size(max = 255) String description,
            @PositiveOrZero BigDecimal value,
            @PositiveOrZero BigDecimal quantity,
            @Size(max = 10) String unit,
            @Size(max = 20) String purity,
            @Size(max = 20) String mode,
            Boolean donation,
            Boolean taxDeductible,
            @Size(max = 255) String notes,
            /* book cash given as an expense: from this account, in this category */
            Long bookAccountId,
            Long bookCategoryId,
            Long version) {
    }

    public record GiftView(Long id, String direction, LocalDate giftDate, String person, String relation, String family, String occasion,
                           String kind, String description, BigDecimal value, BigDecimal quantity, String unit, String purity,
                           String mode, boolean donation, boolean taxDeductible, String notes, Long accountId, String accountName,
                           Long journalEntryId, String entryNo, int attachmentCount, String createdBy, LocalDateTime createdAt,
                           Long version) {
    }

    private final GiftRepository gifts;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final AttachmentRepository attachments;
    private final AttachmentService attachmentService;
    private final ExpenseService expenses;

    public GiftService(GiftRepository gifts, AccountRepository accounts, JournalEntryRepository entries,
                       AttachmentRepository attachments, AttachmentService attachmentService, ExpenseService expenses) {
        this.gifts = gifts;
        this.accounts = accounts;
        this.entries = entries;
        this.attachments = attachments;
        this.attachmentService = attachmentService;
        this.expenses = expenses;
    }

    public List<GiftView> list() {
        Long tenantId = UserContext.tenantId();
        Map<Long, Long> files = attachments.findByTenantId(tenantId).stream().filter(a -> a.getGiftId() != null)
                .collect(Collectors.groupingBy(a -> a.getGiftId(), Collectors.counting()));
        Map<Long, String> names = accounts.findByTenantId(tenantId).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        return gifts.findByTenantId(tenantId).stream()
                .sorted(Comparator.comparing(Gift::getGiftDate).thenComparing(Gift::getId).reversed())
                .map(g -> view(g, files.getOrDefault(g.getId(), 0L).intValue(), names))
                .toList();
    }

    @Transactional
    public GiftView create(GiftRequest r) {
        Gift g = new Gift();
        g.setTenantId(UserContext.tenantId());
        g.setCreatedBy(UserContext.username());
        g.setCreatedAt(LocalDateTime.now());
        apply(g, r);
        g = gifts.save(g);
        book(g, r);
        return one(g);
    }

    @Transactional
    public GiftView update(Long id, GiftRequest r) {
        Gift g = require(id);
        if (r.version() != null && !Objects.equals(r.version(), g.getVersion())) {
            throw new ConcurrentUpdateException("gifts", id);
        }
        apply(g, r);
        g = gifts.save(g);
        book(g, r);
        return one(g);
    }

    /**
     * Sets the relation and family of everyone with this name (all their gifts), so a large circle can be
     * grouped once instead of gift by gift. Returns how many gifts changed.
     */
    @Transactional
    public int updatePerson(String person, String relation, String family, String newName) {
        String key = person == null ? "" : person.trim();
        if (key.isEmpty()) {
            throw new BusinessException("Which person?");
        }
        String rename = blank(newName);
        int changed = 0;
        for (Gift g : gifts.findByTenantId(UserContext.tenantId())) {
            if (!g.getPerson().trim().equalsIgnoreCase(key)) {
                continue;
            }
            g.setRelation(blank(relation));
            g.setFamily(blank(family));
            if (rename != null) {
                g.setPerson(ActivityService.cut(rename, 100));
            }
            gifts.save(g);
            changed++;
        }
        return changed;
    }

    @Transactional
    public void delete(Long id) {
        Gift g = require(id);
        if (g.getJournalEntryId() != null && entries.existsById(g.getJournalEntryId())) {
            expenses.delete(g.getJournalEntryId());
        }
        attachmentService.deleteForOwner("gift", id);
        gifts.delete(g);
    }

    private void apply(Gift g, GiftRequest r) {
        String direction = r.direction().trim().toUpperCase();
        if (!Gift.GIVEN.equals(direction) && !Gift.RECEIVED.equals(direction)) {
            throw new BusinessException("A gift is GIVEN or RECEIVED");
        }
        String kind = r.kind().trim().toUpperCase();
        if (!KINDS.contains(kind)) {
            throw new BusinessException("Kind is cash, gold, silver, item or other");
        }
        if ("CASH".equals(kind) && (r.value() == null || r.value().signum() <= 0)) {
            throw new BusinessException("Enter the amount of cash");
        }
        g.setDirection(direction);
        g.setGiftDate(r.giftDate());
        g.setPerson(r.person().trim());
        g.setRelation(blank(r.relation()));
        g.setFamily(blank(r.family()));
        g.setOccasion(blank(r.occasion()));
        g.setKind(kind);
        g.setDescription(blank(r.description()));
        g.setValue(r.value());
        g.setQuantity(r.quantity());
        g.setUnit(blank(r.unit()));
        g.setPurity(blank(r.purity()));
        g.setMode(blank(r.mode()));
        g.setDonation(Boolean.TRUE.equals(r.donation()));
        g.setTaxDeductible(Boolean.TRUE.equals(r.donation()) && Boolean.TRUE.equals(r.taxDeductible()));
        g.setNotes(blank(r.notes()));
    }

    /** Cash given, booked as an expense: (re)posted to match the gift, or removed when no longer asked for. */
    private void book(Gift g, GiftRequest r) {
        boolean wanted = Gift.GIVEN.equals(g.getDirection()) && "CASH".equals(g.getKind())
                && r.bookAccountId() != null && r.bookCategoryId() != null;
        if (g.getJournalEntryId() != null && entries.existsById(g.getJournalEntryId())) {
            expenses.delete(g.getJournalEntryId());
        }
        g.setJournalEntryId(null);
        g.setAccountId(null);
        if (wanted) {
            String what = (Boolean.TRUE.equals(g.getDonation()) ? "Donation to " : "Gift to ") + g.getPerson()
                    + (g.getOccasion() != null ? " · " + g.getOccasion() : "");
            EntryView posted = expenses.create(new ExpenseRequest(g.getGiftDate(), g.getValue(), r.bookCategoryId(), r.bookAccountId(),
                    ActivityService.cut(what, 255), g.getPerson(), null, g.getNotes(), null));
            g.setJournalEntryId(posted.id());
            g.setAccountId(r.bookAccountId());
        }
        gifts.save(g);
    }

    private GiftView one(Gift g) {
        Long tenantId = UserContext.tenantId();
        Map<Long, String> names = accounts.findByTenantId(tenantId).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        return view(gifts.findById(g.getId()).orElse(g), attachments.findByOwner("gift", g.getId()).size(), names);
    }

    private GiftView view(Gift g, int files, Map<Long, String> accountNames) {
        String entryNo = g.getJournalEntryId() == null ? null : entries.findById(g.getJournalEntryId()).map(e -> e.getEntryNo()).orElse(null);
        return new GiftView(g.getId(), g.getDirection(), g.getGiftDate(), g.getPerson(), g.getRelation(), g.getFamily(), g.getOccasion(), g.getKind(),
                g.getDescription(), g.getValue(), g.getQuantity(), g.getUnit(), g.getPurity(), g.getMode(),
                Boolean.TRUE.equals(g.getDonation()), Boolean.TRUE.equals(g.getTaxDeductible()), g.getNotes(), g.getAccountId(),
                g.getAccountId() == null ? null : accountNames.get(g.getAccountId()), g.getJournalEntryId(), entryNo, files,
                g.getCreatedBy(), g.getCreatedAt(), g.getVersion());
    }

    private Gift require(Long id) {
        return gifts.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Gift", id));
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
