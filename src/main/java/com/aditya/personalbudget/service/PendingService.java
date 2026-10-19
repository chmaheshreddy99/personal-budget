package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.PendingEntryRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Maker-checker: an expense recorded through an access link that needs approval (or by a user who needs approval,
 * see {@code ApprovalPolicy}) is kept here, not posted. A checker (a role with APPROVE_ENTRIES) approves it,
 * optionally correcting amount, date, category, account or description, and only then is it posted; or rejects it
 * with a reason. The maker sees the outcome, and may correct a rejected entry and send it again (or take it back).
 * Every step is kept in the entry's history, so the checker sees what was rejected before and what changed since.
 */
@Service
public class PendingService {

    private static final Set<String> PAYERS = Set.of("BANK", "CASH", "WALLET", "CREDIT_CARD");
    private static final int HISTORY_MAX = 4000;

    public record PendingView(Long id, String kind, String summary, BigDecimal amount, LocalDate entryDate,
                              String submittedBy, LocalDateTime submittedAt, String status, String reviewedBy,
                              LocalDateTime reviewedAt, String reviewNote, Long journalEntryId, Long linkId,
                              Long categoryId, String categoryName, Long paidFromId, String paidFromName,
                              String narration, String party, String notes, boolean pending, int attachmentCount,
                              /* sent again after a rejection, every step so far, and whether the caller may correct it */
                              int resubmits, List<Step> history, boolean editable, String reference) {
    }

    /** One step of an entry: SUBMITTED, REJECTED, RESUBMITTED, APPROVED or WITHDRAWN; note: reason or what changed. */
    public record Step(String action, LocalDateTime at, String by, String note) {
    }

    /** What the checker approves, with any corrections (empty fields keep what was recorded). */
    public record ApproveRequest(@Positive BigDecimal amount, LocalDate entryDate, Long categoryId, Long paidFromId,
                                 @Size(max = 255) String narration, @Size(max = 255) String note) {
    }

    public record RejectRequest(@Size(max = 255) String note) {
    }

    private final PendingEntryRepository pending;
    private final CategoryRepository categories;
    private final AccountRepository accounts;
    private final ExpenseService expenses;
    private final ActivityService activity;
    private final ObjectMapper json;
    private final AttachmentService attachmentService;
    private final AttachmentRepository attachmentRepository;

    public PendingService(PendingEntryRepository pending, CategoryRepository categories, AccountRepository accounts,
                          ExpenseService expenses, ActivityService activity, ObjectMapper json,
                          AttachmentService attachmentService, AttachmentRepository attachmentRepository) {
        this.attachmentService = attachmentService;
        this.attachmentRepository = attachmentRepository;
        this.pending = pending;
        this.categories = categories;
        this.accounts = accounts;
        this.expenses = expenses;
        this.activity = activity;
        this.json = json;
    }

    /** The maker's expense, kept for approval. */
    @Transactional
    public PendingView submit(ExpenseRequest r) {
        CurrentUser me = UserContext.get();
        // the same expense, from the same sender, already waiting since a moment ago: not sent twice
        LocalDateTime recent = LocalDateTime.now().minusMinutes(2);
        boolean twice = pending.findByTenantId(me.tenantId()).stream()
                .filter(x -> PendingEntry.PENDING.equals(x.getStatus()) && x.getSubmittedAt() != null && x.getSubmittedAt().isAfter(recent))
                .filter(x -> me.viaLink() ? me.linkId().equals(x.getLinkId()) : me.userId().equals(x.getSubmittedById()))
                .map(this::request)
                .anyMatch(x -> sameExpense(x, r));
        if (twice) {
            throw new BusinessException("This expense was already sent for approval a moment ago");
        }
        PendingEntry p = new PendingEntry();
        p.setTenantId(me.tenantId());
        p.setKind("EXPENSE");
        String what = fill(p, r);
        p.setLinkId(me.linkId());
        p.setSubmittedById(me.viaLink() ? null : me.userId());
        p.setSubmittedBy(ActivityService.actorOf(me));
        p.setSubmittedAt(LocalDateTime.now());
        p.setStatus(PendingEntry.PENDING);
        p.setResubmits(0);
        addStep(p, "SUBMITTED", null);
        p = pending.save(p);
        activity.record("SUBMITTED", "Approvals", "Sent for approval: " + what + " · " + ActivityService.money(r.amount()));
        return toView(p);
    }

    /**
     * The maker corrects a rejected entry (or one still waiting) and sends it again: it waits for a checker once
     * more, with the rejection and what changed kept in its history.
     */
    @Transactional
    public PendingView resubmit(Long id, ExpenseRequest r) {
        PendingEntry p = requireOwn(id);
        if (!PendingEntry.REJECTED.equals(p.getStatus()) && !PendingEntry.PENDING.equals(p.getStatus())) {
            throw new BusinessException("Already " + p.getStatus().toLowerCase() + (p.getReviewedBy() != null ? " by " + p.getReviewedBy() : ""));
        }
        boolean wasRejected = PendingEntry.REJECTED.equals(p.getStatus());
        String changes = changes(request(p), r);
        String what = fill(p, r);
        p.setStatus(PendingEntry.PENDING);
        p.setSubmittedAt(LocalDateTime.now());
        if (wasRejected) {
            p.setResubmits((p.getResubmits() == null ? 0 : p.getResubmits()) + 1);
            p.setReviewedBy(null);
            p.setReviewedAt(null);
            p.setReviewNote(null);
        }
        addStep(p, wasRejected ? "RESUBMITTED" : "EDITED", changes.isEmpty() ? (wasRejected ? "sent again unchanged" : null) : changes);
        p = pending.save(p);
        activity.record("SUBMITTED", "Approvals", (wasRejected ? "Corrected and sent again: " : "Edited while waiting: ") + what
                + " · " + ActivityService.money(r.amount()) + (changes.isEmpty() ? "" : " · " + changes));
        return toView(p);
    }

    /** The maker takes back an entry that waits or was rejected; it never reaches the books. */
    @Transactional
    public PendingView withdraw(Long id) {
        PendingEntry p = requireOwn(id);
        if (!PendingEntry.REJECTED.equals(p.getStatus()) && !PendingEntry.PENDING.equals(p.getStatus())) {
            throw new BusinessException("Already " + p.getStatus().toLowerCase());
        }
        p.setStatus(PendingEntry.WITHDRAWN);
        addStep(p, "WITHDRAWN", null);
        p = pending.save(p);
        activity.record("DELETED", "Approvals", "Took back " + p.getSummary() + " · " + ActivityService.money(p.getAmount()));
        return toView(p);
    }

    public List<PendingView> list(String status) {
        return pending.findByTenantId(UserContext.tenantId()).stream()
                .filter(p -> status == null || status.isBlank() || "ALL".equalsIgnoreCase(status) || p.getStatus().equalsIgnoreCase(status))
                .sorted(Comparator.comparing(PendingEntry::getSubmittedAt).reversed())
                .map(this::toView)
                .toList();
    }

    public long countPending() {
        return pending.findByTenantId(UserContext.tenantId()).stream().filter(p -> PendingEntry.PENDING.equals(p.getStatus())).count();
    }

    /** What the current access link (or signed-in user) has sent, newest first, rejected ones on top. */
    public List<PendingView> mine() {
        CurrentUser me = UserContext.get();
        return pending.findByTenantId(UserContext.tenantId()).stream()
                .filter(p -> isMine(p, me))
                .filter(p -> !PendingEntry.WITHDRAWN.equals(p.getStatus()))
                .sorted(Comparator.comparing((PendingEntry p) -> !PendingEntry.REJECTED.equals(p.getStatus()))
                        .thenComparing(PendingEntry::getSubmittedAt, Comparator.reverseOrder()))
                .limit(50)
                .map(this::toView)
                .toList();
    }

    @Transactional
    public PendingView approve(Long id, ApproveRequest c) {
        PendingEntry p = requirePending(id);
        ExpenseRequest r = request(p);
        ApproveRequest fix = c == null ? new ApproveRequest(null, null, null, null, null, null) : c;
        String notes = r.notes() == null || r.notes().isBlank() ? "Recorded by " + p.getSubmittedBy() : r.notes() + " · recorded by " + p.getSubmittedBy();
        ExpenseRequest post = new ExpenseRequest(
                fix.entryDate() != null ? fix.entryDate() : r.entryDate(),
                fix.amount() != null ? fix.amount() : r.amount(),
                fix.categoryId() != null ? fix.categoryId() : r.categoryId(),
                fix.paidFromId() != null ? fix.paidFromId() : r.paidFromId(),
                fix.narration() != null && !fix.narration().isBlank() ? fix.narration().trim() : r.narration(),
                r.party(), r.reference(), ActivityService.cut(notes, 255), null);
        EntryView posted = expenses.create(post);
        attachmentService.moveToEntry(p.getId(), posted.id());
        String corrections = changes(r, post);
        p.setStatus(PendingEntry.APPROVED);
        p.setReviewedBy(UserContext.get().fullName());
        p.setReviewedAt(LocalDateTime.now());
        p.setReviewNote(blankToNull(fix.note()));
        p.setJournalEntryId(posted.id());
        addStep(p, "APPROVED", join(corrections.isEmpty() ? null : "corrected " + corrections, p.getReviewNote()));
        p = pending.save(p);
        activity.record("APPROVED", "Approvals", "Approved " + p.getSummary() + " · " + ActivityService.money(post.amount())
                + " from " + p.getSubmittedBy() + " · posted as " + posted.entryNo());
        return toView(p);
    }

    @Transactional
    public PendingView reject(Long id, RejectRequest r) {
        PendingEntry p = requirePending(id);
        p.setStatus(PendingEntry.REJECTED);
        p.setReviewedBy(UserContext.get().fullName());
        p.setReviewedAt(LocalDateTime.now());
        p.setReviewNote(r == null ? null : blankToNull(r.note()));
        addStep(p, "REJECTED", p.getReviewNote());
        p = pending.save(p);
        activity.record("REJECTED", "Approvals", "Rejected " + p.getSummary() + " · " + ActivityService.money(p.getAmount())
                + " from " + p.getSubmittedBy() + (p.getReviewNote() != null ? " · " + p.getReviewNote() : ""));
        return toView(p);
    }

    // ================================================================== helpers

    /** Stores the request on the entry (summary, amount, date); returns what it was for. */
    private String fill(PendingEntry p, ExpenseRequest r) {
        Category category = category(r.categoryId());
        Account payer = payer(r.paidFromId());
        ExpenseRequest clean = new ExpenseRequest(r.entryDate(), r.amount(), r.categoryId(), r.paidFromId(),
                blankToNull(r.narration()), blankToNull(r.party()), blankToNull(r.reference()), blankToNull(r.notes()), null);
        p.setPayload(json.writeValueAsString(clean));
        String what = clean.narration() == null ? category.getName() : clean.narration();
        p.setSummary(ActivityService.cut(what + " · " + category.getName() + " · from " + payer.getName(), 255));
        p.setAmount(r.amount());
        p.setEntryDate(r.entryDate());
        return what;
    }

    /** "amount ₹500 → ₹450, date 2 Oct → 3 Oct, category Food → Fuel" (empty when nothing changed). */
    private String changes(ExpenseRequest before, ExpenseRequest after) {
        List<String> out = new ArrayList<>();
        if (before.amount().compareTo(after.amount()) != 0) {
            out.add("amount " + ActivityService.money(before.amount()) + " → " + ActivityService.money(after.amount()));
        }
        if (!before.entryDate().equals(after.entryDate())) {
            out.add("date " + before.entryDate() + " → " + after.entryDate());
        }
        if (!before.categoryId().equals(after.categoryId())) {
            out.add("category " + categoryName(before.categoryId()) + " → " + categoryName(after.categoryId()));
        }
        if (!before.paidFromId().equals(after.paidFromId())) {
            out.add("paid from " + accountName(before.paidFromId()) + " → " + accountName(after.paidFromId()));
        }
        if (!Objects.equals(blankToNull(before.narration()), blankToNull(after.narration()))) {
            out.add("description “" + Objects.toString(blankToNull(after.narration()), "") + "”");
        }
        if (!Objects.equals(blankToNull(before.party()), blankToNull(after.party()))) {
            out.add("shop / person “" + Objects.toString(blankToNull(after.party()), "") + "”");
        }
        if (!Objects.equals(blankToNull(before.notes()), blankToNull(after.notes()))) {
            out.add("notes");
        }
        return String.join(", ", out);
    }

    private String categoryName(Long id) {
        return categories.findByIdAndTenantId(id, UserContext.tenantId()).map(Category::getName).orElse("?");
    }

    private String accountName(Long id) {
        return accounts.findByIdAndTenantId(id, UserContext.tenantId()).map(Account::getName).orElse("?");
    }

    private void addStep(PendingEntry p, String action, String note) {
        List<Step> steps = new ArrayList<>(history(p));
        steps.add(new Step(action, LocalDateTime.now(), ActivityService.actorOf(UserContext.get()), note));
        String text = json.writeValueAsString(steps);
        while (text.length() > HISTORY_MAX && steps.size() > 2) {   // keep the first step and the latest ones
            steps.remove(1);
            text = json.writeValueAsString(steps);
        }
        p.setHistory(text.length() > HISTORY_MAX ? null : text);
    }

    private List<Step> history(PendingEntry p) {
        if (p.getHistory() == null || p.getHistory().isBlank()) {
            if (p.getId() == null) {
                return List.of();   // being recorded right now
            }
            // entries from before the history was kept: rebuild what is known
            List<Step> steps = new ArrayList<>();
            steps.add(new Step("SUBMITTED", p.getSubmittedAt(), p.getSubmittedBy(), null));
            if (p.getReviewedAt() != null && !PendingEntry.PENDING.equals(p.getStatus())) {
                steps.add(new Step(p.getStatus(), p.getReviewedAt(), p.getReviewedBy(), p.getReviewNote()));
            }
            return steps;
        }
        try {
            return json.readValue(p.getHistory(), new TypeReference<List<Step>>() { });
        } catch (RuntimeException e) {
            return List.of();
        }
    }

    private static boolean isMine(PendingEntry p, CurrentUser me) {
        return me.viaLink() ? me.linkId().equals(p.getLinkId())
                : p.getLinkId() == null && me.userId() != null && me.userId().equals(p.getSubmittedById());
    }

    /** An entry the caller recorded (the same access link, or the same signed-in user). */
    private PendingEntry requireOwn(Long id) {
        PendingEntry p = pending.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Entry awaiting approval", id));
        if (!isMine(p, UserContext.get())) {
            throw new ForbiddenException("Only whoever recorded it can correct it or take it back");
        }
        return p;
    }

    private PendingEntry requirePending(Long id) {
        PendingEntry p = pending.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Entry awaiting approval", id));
        if (!PendingEntry.PENDING.equals(p.getStatus())) {
            throw new BusinessException("Already " + p.getStatus().toLowerCase() + (p.getReviewedBy() != null ? " by " + p.getReviewedBy() : ""));
        }
        CurrentUser me = UserContext.get();
        if (!me.viaLink() && me.userId() != null && me.userId().equals(p.getSubmittedById())) {
            throw new ForbiddenException("Someone else has to approve what you recorded");
        }
        return p;
    }

    private static boolean sameExpense(ExpenseRequest a, ExpenseRequest b) {
        java.util.function.Function<String, String> n = t -> t == null ? "" : t.trim().toLowerCase(java.util.Locale.ROOT);
        return java.util.Objects.equals(a.entryDate(), b.entryDate()) && a.amount() != null && b.amount() != null
                && a.amount().compareTo(b.amount()) == 0 && java.util.Objects.equals(a.categoryId(), b.categoryId())
                && java.util.Objects.equals(a.paidFromId(), b.paidFromId())
                && n.apply(a.narration()).equals(n.apply(b.narration())) && n.apply(a.party()).equals(n.apply(b.party()));
    }

    private ExpenseRequest request(PendingEntry p) {
        return json.readValue(p.getPayload(), ExpenseRequest.class);
    }

    private Category category(Long id) {
        Category c = id == null ? null : categories.findByIdAndTenantId(id, UserContext.tenantId()).orElse(null);
        if (c == null || c.getKind() != CategoryKind.EXPENSE || !Boolean.TRUE.equals(c.getActive())) {
            throw new BusinessException("Pick an expense category");
        }
        return c;
    }

    private Account payer(Long id) {
        Account a = id == null ? null : accounts.findByIdAndTenantId(id, UserContext.tenantId()).orElse(null);
        if (a == null || !Boolean.TRUE.equals(a.getActive()) || !PAYERS.contains(a.getAccountType().name())) {
            throw new BusinessException("Pick the account it was paid from");
        }
        return a;
    }

    private PendingView toView(PendingEntry p) {
        ExpenseRequest r = request(p);
        Long tenantId = p.getTenantId();
        String category = r.categoryId() == null ? null : categories.findByIdAndTenantId(r.categoryId(), tenantId).map(Category::getName).orElse(null);
        String payer = r.paidFromId() == null ? null : accounts.findByIdAndTenantId(r.paidFromId(), tenantId).map(Account::getName).orElse(null);
        boolean editable = UserContext.current().map(me -> isMine(p, me)).orElse(false)
                && (PendingEntry.PENDING.equals(p.getStatus()) || PendingEntry.REJECTED.equals(p.getStatus()));
        return new PendingView(p.getId(), p.getKind(), p.getSummary(), p.getAmount(), p.getEntryDate(), p.getSubmittedBy(),
                p.getSubmittedAt(), p.getStatus(), p.getReviewedBy(), p.getReviewedAt(), p.getReviewNote(), p.getJournalEntryId(),
                p.getLinkId(), r.categoryId(), category, r.paidFromId(), payer, r.narration(), r.party(), r.notes(),
                PendingEntry.PENDING.equals(p.getStatus()), attachmentRepository.findByPendingEntryId(p.getId()).size(),
                p.getResubmits() == null ? 0 : p.getResubmits(), history(p), editable, r.reference());
    }

    private static String join(String a, String b) {
        return a == null ? b : b == null ? a : a + " · " + b;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
