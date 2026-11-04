package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.InsurancePayment;
import com.aditya.personalbudget.domain.entity.InsurancePolicy;
import com.aditya.personalbudget.domain.entity.PersonalDocument;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.InsurancePaymentRepository;
import com.aditya.personalbudget.repository.InsurancePolicyRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.PersonalDocumentRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Insurance policies enrolled in Documents (see {@link InsurancePolicy}): the premium and when it is due, recording it
 * as an expense, and reminding by e-mail.
 * <p>
 * Reminders go out on the mornings when the due date comes within one of the policy's days (30, 15, 7 ...), on the due
 * date itself, and once a week for four weeks after it; each step once per due date. A message that cannot be sent is
 * tried again the next morning.
 */
@Service
public class InsuranceService {

    /** The kinds of document that carry a policy; INSURANCE is the older, general one. */
    public static final Set<String> TYPES = Set.of("INSURANCE_HEALTH", "INSURANCE_VEHICLE", "INSURANCE_LIFE", "INSURANCE");
    private static final Map<String, String> TYPE_LABEL = Map.of("INSURANCE_HEALTH", "Medical insurance", "INSURANCE_VEHICLE", "Vehicle insurance",
            "INSURANCE_LIFE", "Life insurance", "INSURANCE", "Insurance");
    public static final String SINGLE = "SINGLE";
    private static final Set<String> FREQUENCIES = Set.of("MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", SINGLE);
    private static final Map<String, String> FREQUENCY_LABEL = Map.of("MONTHLY", "Monthly", "QUARTERLY", "Quarterly", "HALF_YEARLY", "Half-yearly",
            "YEARLY", "Yearly", SINGLE, "One time");
    private static final Map<String, String> MODE_LABEL = Map.of("ONLINE", "Online", "UPI", "UPI", "AUTO_DEBIT", "Auto debit", "NET_BANKING", "Net banking",
            "AGENT", "Through the agent", "CHEQUE", "Cheque", "CASH", "Cash");
    private static final String DEFAULT_REMINDERS = "30,15,7,3,1";
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s,;]+@[^@\\s,;]+\\.[^@\\s,;]+$");
    private static final Pattern UPI = Pattern.compile("^[\\w.\\-]+@[\\w.\\-]+$");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    /** The default expense category of a premium (DefaultChartOfAccounts). */
    private static final String PREMIUM_CATEGORY = "Insurance Premiums";

    public record PolicyRequest(@Size(max = 100) String planName, @Size(max = 200) String insuredPersons, @Size(max = 100) String nominee,
                                @Size(max = 30) String vehicleNumber, BigDecimal sumInsured, @NotNull @Positive BigDecimal premium,
                                @NotNull @Size(max = 12) String frequency, LocalDate nextDueDate, LocalDate lastPremiumDate, Integer graceDays,
                                @Size(max = 12) String paymentMode, Long payAccountId, Long categoryId, @Size(max = 100) String payeeName,
                                @Size(max = 300) String paymentUrl, @Size(max = 100) String upiId, @Size(max = 100) String paymentReference,
                                @Size(max = 100) String agentName, @Size(max = 30) String agentPhone, @Size(max = 40) String supportPhone,
                                @Size(max = 255) String paymentNotes, Boolean emailReminders, @Size(max = 40) String reminderDays,
                                @Size(max = 300) String emailTo) {
    }

    public record PaymentView(Long id, LocalDate dueDate, LocalDate paidOn, BigDecimal amount, String accountName, Long entryId, String entryNo,
                              boolean entryGone, String createdBy) {
    }

    /** status: OK, DUE_SOON, DUE_TODAY, OVERDUE (within the grace days), LAPSED (past them) or PAID_UP. */
    public record PolicyView(Long id, String planName, String insuredPersons, String nominee, String vehicleNumber, BigDecimal sumInsured,
                             BigDecimal premium, String frequency, String frequencyLabel, LocalDate nextDueDate, LocalDate lastPremiumDate,
                             Integer graceDays, String paymentMode, Long payAccountId, Long categoryId, String payeeName, String paymentUrl,
                             String upiId, String paymentReference, String agentName, String agentPhone, String supportPhone, String paymentNotes,
                             boolean emailReminders, String reminderDays, String emailTo, LocalDateTime lastReminderAt, String lastReminderResult,
                             String status, Long daysToDue, int remindWindow, List<PaymentView> payments, Long version) {
    }

    /** dueDate: the premium this pays, as shown when the dialog opened (null: an extra payment on a policy with none due). */
    public record PayRequest(@NotNull LocalDate paidOn, @NotNull @Positive BigDecimal amount, @NotNull Long accountId, Long categoryId,
                             LocalDate dueDate, @Size(max = 60) String reference, @Size(max = 255) String notes) {
    }

    public record Paid(Long entryId, String entryNo, LocalDate nextDueDate, LocalDate expiresOn) {
    }

    public record DuePremium(Long documentId, String title, String owner, String docType, String insurer, BigDecimal premium, LocalDate dueDate, long days, String status) {
    }

    public record RemindResult(boolean ok, String result) {
    }

    private final InsurancePolicyRepository policies;
    private final InsurancePaymentRepository payments;
    private final PersonalDocumentRepository documents;
    private final AccountRepository accounts;
    private final CategoryRepository categories;
    private final JournalEntryRepository entries;
    private final ExpenseService expenses;
    private final NotificationService notifications;
    private final ActivityService activity;

    public InsuranceService(InsurancePolicyRepository policies, InsurancePaymentRepository payments, PersonalDocumentRepository documents,
                            AccountRepository accounts, CategoryRepository categories, JournalEntryRepository entries, ExpenseService expenses,
                            NotificationService notifications, ActivityService activity) {
        this.policies = policies;
        this.payments = payments;
        this.documents = documents;
        this.accounts = accounts;
        this.categories = categories;
        this.entries = entries;
        this.expenses = expenses;
        this.notifications = notifications;
        this.activity = activity;
    }

    public static boolean isInsurance(String docType) {
        return docType != null && TYPES.contains(docType);
    }

    // ================================================================== reading

    /** By document, every policy of the household. */
    public Map<Long, PolicyView> viewsByDocument() {
        Long tenantId = UserContext.tenantId();
        Map<Long, String> accountName = accounts.findByTenantId(tenantId).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        Set<Long> entryIds = entries.findByTenantId(tenantId).stream().map(e -> e.getId()).collect(Collectors.toSet());
        Map<Long, List<InsurancePayment>> paid = payments.findByTenantId(tenantId).stream()
                .sorted(Comparator.comparing(InsurancePayment::getId).reversed())
                .collect(Collectors.groupingBy(InsurancePayment::getPolicyId));
        return policies.findByTenantId(tenantId).stream().collect(Collectors.toMap(InsurancePolicy::getDocumentId,
                p -> view(p, paid.getOrDefault(p.getId(), List.of()), accountName, entryIds)));
    }

    public PolicyView viewOf(Long documentId) {
        return viewsByDocument().get(documentId);
    }

    /** Premiums falling due within the policy's reminder window, or past due: the alerts. Soonest first. */
    public List<DuePremium> due() {
        Long tenantId = UserContext.tenantId();
        Map<Long, PersonalDocument> docs = documents.findByTenantId(tenantId).stream().collect(Collectors.toMap(PersonalDocument::getId, Function.identity()));
        return policies.findByTenantId(tenantId).stream()
                .filter(p -> p.getNextDueDate() != null && isInsurance(docType(docs.get(p.getDocumentId()))))
                .filter(p -> !"OK".equals(status(p)))
                .map(p -> {
                    PersonalDocument d = docs.get(p.getDocumentId());
                    return new DuePremium(d.getId(), d.getTitle(), d.getOwner(), d.getDocType(), d.getIssuer(), p.getPremium(), p.getNextDueDate(),
                            daysLeft(p), status(p));
                })
                .sorted(Comparator.comparing(DuePremium::dueDate))
                .toList();
    }

    /** Premiums due by this date, for the dashboard's Coming up. */
    public List<DuePremium> dueBy(LocalDate horizon) {
        Long tenantId = UserContext.tenantId();
        Map<Long, PersonalDocument> docs = documents.findByTenantId(tenantId).stream().collect(Collectors.toMap(PersonalDocument::getId, Function.identity()));
        return policies.findByTenantId(tenantId).stream()
                .filter(p -> p.getNextDueDate() != null && !p.getNextDueDate().isAfter(horizon) && isInsurance(docType(docs.get(p.getDocumentId()))))
                .map(p -> {
                    PersonalDocument d = docs.get(p.getDocumentId());
                    return new DuePremium(d.getId(), d.getTitle(), d.getOwner(), d.getDocType(), d.getIssuer(), p.getPremium(), p.getNextDueDate(), daysLeft(p), status(p));
                })
                .toList();
    }

    // ================================================================== enrolling

    /** Adds or changes a document's policy. The reminder history stays, so a change does not send the same reminder twice. */
    @Transactional
    public void save(PersonalDocument d, PolicyRequest r) {
        InsurancePolicy p = policies.findByDocumentId(d.getId()).orElseGet(() -> {
            InsurancePolicy fresh = new InsurancePolicy();
            fresh.setTenantId(d.getTenantId());
            fresh.setDocumentId(d.getId());
            return fresh;
        });
        String frequency = r.frequency().trim().toUpperCase(Locale.ROOT);
        if (!FREQUENCIES.contains(frequency)) throw new BusinessException("How often the premium is paid is not one of the choices");
        if (r.nextDueDate() == null && p.getId() == null && !SINGLE.equals(frequency)) throw new BusinessException("Give the date the next premium is due");
        if (r.sumInsured() != null && r.sumInsured().signum() < 0) throw new BusinessException("The cover cannot be negative");
        if (r.graceDays() != null && (r.graceDays() < 0 || r.graceDays() > 365)) throw new BusinessException("Grace days are between 0 and 365");
        String mode = blank(r.paymentMode());
        if (mode != null && !MODE_LABEL.containsKey(mode)) throw new BusinessException("How it is paid is not one of the choices");
        String url = blank(r.paymentUrl());
        if (url != null && !url.matches("(?i)^https?://\\S+$")) throw new BusinessException("The payment link has to start with http:// or https://");
        String upi = blank(r.upiId());
        if (upi != null && !UPI.matcher(upi).matches()) throw new BusinessException("That is not a UPI ID (name@bank)");
        String to = recipients(r.emailTo());
        p.setPlanName(blank(r.planName()));
        p.setInsuredPersons(blank(r.insuredPersons()));
        p.setNominee(blank(r.nominee()));
        p.setVehicleNumber(blank(r.vehicleNumber()));
        p.setSumInsured(r.sumInsured());
        p.setPremium(r.premium());
        p.setFrequency(frequency);
        p.setNextDueDate(r.nextDueDate());
        p.setLastPremiumDate(r.lastPremiumDate());
        p.setGraceDays(r.graceDays());
        p.setPaymentMode(mode);
        p.setPayAccountId(r.payAccountId());
        p.setCategoryId(r.categoryId());
        p.setPayeeName(blank(r.payeeName()));
        p.setPaymentUrl(url);
        p.setUpiId(upi);
        p.setPaymentReference(blank(r.paymentReference()));
        p.setAgentName(blank(r.agentName()));
        p.setAgentPhone(blank(r.agentPhone()));
        p.setSupportPhone(blank(r.supportPhone()));
        p.setPaymentNotes(blank(r.paymentNotes()));
        p.setEmailReminders(Boolean.TRUE.equals(r.emailReminders()));
        p.setReminderDays(reminderDays(r.reminderDays()));
        p.setEmailTo(to);
        policies.save(p);
    }

    /** Goes with the document. The expenses already booked stay in Expenses. */
    @Transactional
    public void deleteFor(Long documentId) {
        policies.findByDocumentId(documentId).ifPresent(p -> {
            payments.deleteAll(payments.findByPolicyId(p.getId()));
            policies.delete(p);
        });
    }

    // ================================================================== paying

    /** Books the premium as an expense and moves the policy on to the next due date. */
    @Transactional
    public Paid pay(Long documentId, PayRequest r) {
        var me = UserContext.get();
        if (!me.features().contains(Feature.EXPENSES)) throw new ForbiddenException("Expenses are not shared with you, so a premium cannot be recorded here");
        if (me.approval()) throw new BusinessException("A premium cannot wait for approval. Ask someone who can post without approval to record it");
        PersonalDocument d = requireDocument(documentId);
        InsurancePolicy p = requirePolicy(documentId);
        LocalDate due = p.getNextDueDate();
        if (due != null && r.dueDate() != null && !due.equals(r.dueDate())) {
            throw new BusinessException("This premium is already recorded: the next one is due on " + DAY.format(due));
        }
        Long category = r.categoryId() != null ? r.categoryId() : p.getCategoryId() != null ? p.getCategoryId() : defaultCategory();
        if (category == null) throw new BusinessException("Choose the expense category to book the premium in");
        String label = TYPE_LABEL.getOrDefault(d.getDocType(), "Insurance");
        String narration = cut(label + " premium · " + d.getTitle() + " (" + d.getOwner() + ")" + (due != null ? " · due " + DAY.format(due) : ""), 255);
        EntryView entry = expenses.create(new ExpenseRequest(r.paidOn(), r.amount(), category, r.accountId(), narration,
                cut(d.getIssuer(), 100), blank(r.reference()) != null ? blank(r.reference()) : cut(d.getDocNumber(), 60), blank(r.notes()), null));
        InsurancePayment payment = new InsurancePayment();
        payment.setTenantId(d.getTenantId());
        payment.setPolicyId(p.getId());
        payment.setDueDate(due);
        payment.setPaidOn(r.paidOn());
        payment.setAmount(r.amount());
        payment.setAccountId(r.accountId());
        payment.setEntryId(entry.id());
        payment.setEntryNo(entry.entryNo());
        payment.setPreviousExpiresOn(d.getExpiresOn());
        payment.setCreatedBy(UserContext.username());
        payment.setCreatedAt(OrgClock.now());
        payments.save(payment);
        if (due != null) {
            LocalDate next = nextDue(p, d, due);
            p.setNextDueDate(next);
            if (next != null && !"INSURANCE_LIFE".equals(d.getDocType()) && d.getExpiresOn() != null) {
                // a renewable policy: paying the renewal carries the cover on
                LocalDate until = d.getExpiresOn();
                for (int guard = 0; guard < 50 && until.isBefore(next); guard++) until = until.plusYears(1);
                if (!until.equals(d.getExpiresOn())) {
                    d.setExpiresOn(until);
                    documents.save(d);
                }
            }
            policies.save(p);
        }
        activity.record("ADDED", "Documents", "Premium " + ActivityService.money(r.amount()) + " of " + d.getTitle() + " (" + d.getOwner() + ") recorded as " + entry.entryNo());
        return new Paid(entry.id(), entry.entryNo(), p.getNextDueDate(), d.getExpiresOn());
    }

    /** Takes back the latest premium: its expense goes and the policy returns to that due date. */
    @Transactional
    public void undoPayment(Long documentId, Long paymentId) {
        PersonalDocument d = requireDocument(documentId);
        InsurancePolicy p = requirePolicy(documentId);
        List<InsurancePayment> all = payments.findByPolicyId(p.getId());
        if (all.isEmpty() || !all.getFirst().getId().equals(paymentId)) throw new BusinessException("Only the latest premium can be undone");
        InsurancePayment last = all.getFirst();
        if (!UserContext.get().features().contains(Feature.EXPENSES)) throw new ForbiddenException("Expenses are not shared with you");
        if (entries.findByIdAndTenantId(last.getEntryId(), d.getTenantId()).isPresent()) expenses.delete(last.getEntryId());
        if (last.getDueDate() != null) {
            p.setNextDueDate(last.getDueDate());
            policies.save(p);
            if (!Objects.equals(last.getPreviousExpiresOn(), d.getExpiresOn())) {
                d.setExpiresOn(last.getPreviousExpiresOn());
                documents.save(d);
            }
        }
        payments.delete(last);
        activity.record("DELETED", "Documents", "Premium " + ActivityService.money(last.getAmount()) + " of " + d.getTitle() + " undone (" + last.getEntryNo() + ")");
    }

    /** The due date after this one; null when no more premiums are asked for. */
    private static LocalDate nextDue(InsurancePolicy p, PersonalDocument d, LocalDate due) {
        if (SINGLE.equals(p.getFrequency())) return null;
        LocalDate next = Frequency.valueOf(p.getFrequency()).next(due);
        if (p.getLastPremiumDate() != null && next.isAfter(p.getLastPremiumDate())) return null;
        // a life policy ends at maturity: nothing falls due after it
        if ("INSURANCE_LIFE".equals(d.getDocType()) && d.getExpiresOn() != null && next.isAfter(d.getExpiresOn())) return null;
        return next;
    }

    // ================================================================== reminders

    /** The morning's reminders of the current household: how many went out. */
    public int sendDue() {
        Long tenantId = UserContext.tenantId();
        int sent = 0;
        for (InsurancePolicy p : policies.findByTenantId(tenantId)) {
            if (!Boolean.TRUE.equals(p.getEmailReminders()) || p.getNextDueDate() == null) continue;
            PersonalDocument d = documents.findByIdAndTenantId(p.getDocumentId(), tenantId).orElse(null);
            if (d == null || !isInsurance(d.getDocType())) continue;
            Integer stage = stage(p, OrgClock.today());
            if (stage == null || !stageOpen(p, stage)) continue;
            if (mail(p, d, stage).ok()) sent++;
        }
        return sent;
    }

    /** Sends the reminder now, from the policy's page. */
    public RemindResult remindNow(Long documentId) {
        PersonalDocument d = requireDocument(documentId);
        InsurancePolicy p = requirePolicy(documentId);
        if (p.getNextDueDate() == null) throw new BusinessException("No premium is due on this policy");
        Integer stage = stage(p, OrgClock.today());
        return mail(p, d, stage != null && stageOpen(p, stage) ? stage : null);
    }

    /**
     * The step the policy is at today: the smallest of its reminder days not below the days left, 0 on the due date, then
     * -1 to -4 for each week past it; null while it is too early or after the fourth week.
     */
    static Integer stage(InsurancePolicy p, LocalDate today) {
        long left = ChronoUnit.DAYS.between(today, p.getNextDueDate());
        if (left < 0) {
            long week = (-left - 1) / 7 + 1;
            return week > 4 ? null : (int) -week;
        }
        if (left == 0) return 0;
        return days(p.getReminderDays()).stream().filter(s -> s >= left).min(Integer::compare).orElse(null);
    }

    /** Whether this step has not gone out yet for this due date (a later step has a smaller number). */
    private static boolean stageOpen(InsurancePolicy p, int stage) {
        return !p.getNextDueDate().equals(p.getLastReminderDue()) || p.getLastReminderStage() == null || stage < p.getLastReminderStage();
    }

    /** stage null: an extra reminder, which leaves the steps as they are. A failure is only noted, so the step is tried again. */
    private RemindResult mail(InsurancePolicy p, PersonalDocument d, Integer stage) {
        long left = daysLeft(p);
        String when = left < 0 ? Math.abs(left) + " day" + (Math.abs(left) == 1 ? "" : "s") + " overdue"
                : left == 0 ? "due today" : "due in " + left + " day" + (left == 1 ? "" : "s");
        String label = TYPE_LABEL.getOrDefault(d.getDocType(), "Insurance");
        List<NotificationService.Fact> facts = new ArrayList<>();
        fact(facts, "Due date", DAY.format(p.getNextDueDate()) + " (" + when + ")");
        if (p.getGraceDays() != null && p.getGraceDays() > 0) fact(facts, "Grace period", p.getGraceDays() + " days, until " + DAY.format(p.getNextDueDate().plusDays(p.getGraceDays())));
        fact(facts, "Policy", d.getTitle() + (p.getPlanName() != null ? " · " + p.getPlanName() : ""));
        fact(facts, "Policy number", d.getDocNumber());
        fact(facts, "Insurer", d.getIssuer());
        fact(facts, "Policy holder", d.getOwner());
        fact(facts, "Insured", p.getInsuredPersons());
        fact(facts, "Vehicle", p.getVehicleNumber());
        fact(facts, "Cover", p.getSumInsured() == null ? null : ActivityService.money(p.getSumInsured()));
        fact(facts, "Paid", FREQUENCY_LABEL.getOrDefault(p.getFrequency(), p.getFrequency()) + (p.getPaymentMode() != null ? " · " + MODE_LABEL.get(p.getPaymentMode()) : ""));
        fact(facts, "Pay to", p.getPayeeName());
        fact(facts, "UPI ID", p.getUpiId());
        fact(facts, "Customer / biller ID", p.getPaymentReference());
        if (p.getPayAccountId() != null) accounts.findByIdAndTenantId(p.getPayAccountId(), d.getTenantId()).ifPresent(a -> fact(facts, "Usually paid from", a.getName()));
        fact(facts, "Agent", p.getAgentName() == null ? p.getAgentPhone() : p.getAgentName() + (p.getAgentPhone() != null ? " · " + p.getAgentPhone() : ""));
        fact(facts, "Customer care", p.getSupportPhone());
        String button = p.getPaymentUrl() == null ? null : "<a href=\"" + NotificationService.esc(p.getPaymentUrl())
                + "\" style=\"display:inline-block;padding:10px 18px;border-radius:8px;background:#0b6aa6;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none\">Pay online</a>";
        String note = (p.getPaymentNotes() != null ? p.getPaymentNotes() + " " : "") + "After paying, record it from Documents so it shows in Expenses and the policy moves to its next due date.";
        NotificationService.Sent sent = notifications.insuranceDue(
                label + " premium " + when + ": " + d.getTitle() + " (" + d.getOwner() + ")",
                left < 0 ? "Premium overdue" : "Premium due", left < 0 ? "#c2363a" : "#0b6aa6",
                d.getTitle(), label + " · " + when, ActivityService.money(p.getPremium()), facts, button, note, split(p.getEmailTo()), d.getCreatedBy());
        p.setLastReminderAt(OrgClock.now());
        p.setLastReminderResult(cut(sent.result(), 255));
        if (sent.ok() && stage != null) {
            p.setLastReminderDue(p.getNextDueDate());
            p.setLastReminderStage(stage);
        }
        policies.save(p);
        return new RemindResult(sent.ok(), sent.result());
    }

    private static void fact(List<NotificationService.Fact> facts, String label, String value) {
        if (value != null && !value.isBlank()) facts.add(new NotificationService.Fact(label, value));
    }

    // ================================================================== helpers

    private PersonalDocument requireDocument(Long id) {
        return documents.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Document", id));
    }

    private InsurancePolicy requirePolicy(Long documentId) {
        InsurancePolicy p = policies.findByDocumentId(documentId).orElseThrow(() -> new BusinessException("This document has no policy details yet"));
        if (!UserContext.tenantId().equals(p.getTenantId())) throw new NotFoundException("Document", documentId);
        return p;
    }

    private Long defaultCategory() {
        return categories.findByTenantId(UserContext.tenantId()).stream().filter(c -> PREMIUM_CATEGORY.equalsIgnoreCase(c.getName()))
                .map(c -> c.getId()).findFirst().orElse(null);
    }

    private static PolicyView view(InsurancePolicy p, List<InsurancePayment> paid, Map<Long, String> accountName, Set<Long> entryIds) {
        return new PolicyView(p.getId(), p.getPlanName(), p.getInsuredPersons(), p.getNominee(), p.getVehicleNumber(), p.getSumInsured(), p.getPremium(),
                p.getFrequency(), FREQUENCY_LABEL.getOrDefault(p.getFrequency(), p.getFrequency()), p.getNextDueDate(), p.getLastPremiumDate(), p.getGraceDays(),
                p.getPaymentMode(), p.getPayAccountId(), p.getCategoryId(), p.getPayeeName(), p.getPaymentUrl(), p.getUpiId(), p.getPaymentReference(),
                p.getAgentName(), p.getAgentPhone(), p.getSupportPhone(), p.getPaymentNotes(), Boolean.TRUE.equals(p.getEmailReminders()), p.getReminderDays(),
                p.getEmailTo(), p.getLastReminderAt(), p.getLastReminderResult(), status(p), p.getNextDueDate() == null ? null : daysLeft(p), window(p),
                paid.stream().map(x -> new PaymentView(x.getId(), x.getDueDate(), x.getPaidOn(), x.getAmount(), accountName.get(x.getAccountId()), x.getEntryId(),
                        x.getEntryNo(), !entryIds.contains(x.getEntryId()), x.getCreatedBy())).toList(),
                p.getVersion());
    }

    private static long daysLeft(InsurancePolicy p) {
        return ChronoUnit.DAYS.between(OrgClock.today(), p.getNextDueDate());
    }

    /** How many days ahead a premium counts as due soon: the furthest reminder, else two weeks. */
    private static int window(InsurancePolicy p) {
        return days(p.getReminderDays()).stream().max(Integer::compare).orElse(14);
    }

    static String status(InsurancePolicy p) {
        if (p.getNextDueDate() == null) return "PAID_UP";
        long left = daysLeft(p);
        if (left < -(p.getGraceDays() == null ? 0 : p.getGraceDays())) return "LAPSED";
        if (left < 0) return "OVERDUE";
        if (left == 0) return "DUE_TODAY";
        return left <= window(p) ? "DUE_SOON" : "OK";
    }

    private static List<Integer> days(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> s.matches("\\d{1,3}")).map(Integer::valueOf).toList();
    }

    /** Largest first, without repeats; blank is the usual steps. */
    private static String reminderDays(String csv) {
        if (csv == null || csv.isBlank()) return DEFAULT_REMINDERS;
        List<Integer> out = days(csv).stream().filter(n -> n > 0 && n <= 365).distinct().sorted(Comparator.reverseOrder()).toList();
        return out.isEmpty() ? DEFAULT_REMINDERS : out.stream().map(String::valueOf).collect(Collectors.joining(","));
    }

    private static String recipients(String csv) {
        List<String> to = split(csv);
        for (String a : to) {
            if (!EMAIL.matcher(a).matches()) throw new BusinessException("Not an e-mail address: " + a);
        }
        return to.isEmpty() ? null : String.join(",", to);
    }

    private static List<String> split(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split("[,;\\s]+")).filter(s -> !s.isBlank()).distinct().toList();
    }

    private static String docType(PersonalDocument d) {
        return d == null ? null : d.getDocType();
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String cut(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
