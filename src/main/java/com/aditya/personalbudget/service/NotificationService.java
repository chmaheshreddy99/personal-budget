package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Attachment;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.LineView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.TsvDataStore;
import jakarta.mail.internet.MimeMessage;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;

/**
 * Alerts by e-mail (Settings › Alerts): a message when something worth knowing happens in the books, sent through the
 * household's e-mail account (Settings › E-mail).
 * <ul>
 *   <li>Events: a chit is added, a chit installment is paid (with a plain copy to the organizer, when the chit has their
 *       e-mail), money is given to someone, money is paid for someone, money moves between accounts, and an expense of at
 *       least the amount set.</li>
 *   <li>Each event is switched on or off for the household; a save can override that one way or the other with the
 *       {@code X-Notify: on|off} header (the small "E-mail" switch at the foot of a dialog).</li>
 *   <li>The message is written when the event happens, and goes out a little later (after the save is committed and its
 *       evidence has had time to arrive): the photos and PDFs on the entry are attached then.</li>
 * </ul>
 * The queue lives in memory: alerts waiting when the server stops are not sent.
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    /** How long an alert waits for the evidence uploaded right after the save. */
    static final long WAIT_SECONDS = 40;
    private static final long MAX_ATTACH_BYTES = 15L * 1024 * 1024;
    private static final int KEEP_RECENT = 20;
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s,;]+@[^@\\s,;]+\\.[^@\\s,;]+$");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final String AREA = "Alerts";

    public enum Event {
        CHIT_CREATED("Chit added", "A new chit is added, with its terms and schedule", "chit"),
        CHIT_PAYMENT("Chit installment paid", "An installment is paid: the amount, the dividend and the bank reference", "coins"),
        MONEY_GIVEN("Money given", "Money lent to someone", "hand"),
        PAID_FOR("Paid for someone", "A bill paid on someone else's behalf", "receipt"),
        TRANSFER("Transfer between accounts", "Money moved from one account of yours to another", "transfer"),
        LARGE_EXPENSE("Large expense", "An expense of at least the amount set", "wallet");

        private final String label;
        private final String description;
        private final String iconName;

        Event(String label, String description, String iconName) {
            this.label = label;
            this.description = description;
            this.iconName = iconName;
        }
    }

    public record EventInfo(String key, String label, String description, String iconName, boolean on) {
    }

    /** What the household set: recipients empty means the e-mail of the person who records the entry. */
    public record Settings(boolean enabled, List<String> recipients, Map<String, Boolean> events, boolean organizerCopy,
                           BigDecimal expenseThreshold, boolean attachEvidence) {
    }

    public record SettingsRequest(Boolean enabled, @Size(max = 600) String recipients, Map<String, Boolean> events, Boolean organizerCopy,
                                  BigDecimal expenseThreshold, Boolean attachEvidence) {
    }

    public record Sent(LocalDateTime at, String event, String subject, String to, boolean ok, String result, int attachments) {
    }

    /** mailReady: an account to send from; myEmail: where alerts go when no recipient is set. */
    public record Overview(boolean mailReady, String mailFrom, String myEmail, Settings settings, List<EventInfo> events, List<Sent> recent,
                           int waiting) {
    }

    /** What a dialog needs to show its e-mail switch. */
    public record Status(boolean mailReady, boolean enabled, Map<String, Boolean> events, BigDecimal expenseThreshold, List<String> to) {
    }

    /** A line of facts in a message. */
    record Fact(String label, String value) {
    }

    /** A message waiting to go out. */
    private record Pending(Long tenantId, CurrentUser user, Event event, List<String> to, String subject, String html, String text,
                           List<Long> entryIds, boolean attach, Instant due) {
    }

    private final AppSettingsService settings;
    private final TenantMailService mail;
    private final AppUserRepository users;
    private final AttachmentRepository attachmentRows;
    private final AttachmentService attachments;
    private final JournalEntryRepository entries;
    private final CategoryRepository categories;
    private final ActivityService activity;
    private final TsvDataStore store;
    private final List<Pending> queue = new CopyOnWriteArrayList<>();
    private final Map<Long, Deque<Sent>> recent = new ConcurrentHashMap<>();

    public NotificationService(AppSettingsService settings, TenantMailService mail, AppUserRepository users, AttachmentRepository attachmentRows,
                               AttachmentService attachments, JournalEntryRepository entries, CategoryRepository categories,
                               ActivityService activity, TsvDataStore store) {
        this.settings = settings;
        this.mail = mail;
        this.users = users;
        this.attachmentRows = attachmentRows;
        this.attachments = attachments;
        this.entries = entries;
        this.categories = categories;
        this.activity = activity;
        this.store = store;
    }

    // ================================================================== settings

    public Settings settings() {
        return settingsOf(UserContext.tenantId());
    }

    private Settings settingsOf(Long tenantId) {
        Map<String, String> p = settings.readPrefixed(prefix(tenantId));
        Map<String, Boolean> on = new LinkedHashMap<>();
        for (Event e : Event.values()) {
            on.put(e.name(), Boolean.parseBoolean(p.getOrDefault("event." + e.name(), e == Event.LARGE_EXPENSE || e == Event.CHIT_PAYMENT ? "true" : "false")));
        }
        BigDecimal threshold;
        try {
            threshold = new BigDecimal(p.getOrDefault("expense-threshold", "10000").trim());
        } catch (NumberFormatException ex) {
            threshold = BigDecimal.valueOf(10000);
        }
        return new Settings(Boolean.parseBoolean(p.getOrDefault("enabled", "false")), split(p.get("recipients")), on,
                Boolean.parseBoolean(p.getOrDefault("organizer-copy", "true")), threshold, Boolean.parseBoolean(p.getOrDefault("attach", "true")));
    }

    public Overview overview() {
        Long tenantId = UserContext.tenantId();
        var sender = mail.sender().orElse(null);
        Settings s = settingsOf(tenantId);
        List<EventInfo> events = Arrays.stream(Event.values())
                .map(e -> new EventInfo(e.name(), e.label, e.description, e.iconName, s.events().getOrDefault(e.name(), false))).toList();
        List<Sent> log = new ArrayList<>(recent.getOrDefault(tenantId, new ArrayDeque<>()));
        int waiting = (int) queue.stream().filter(q -> q.tenantId().equals(tenantId)).count();
        return new Overview(sender != null, sender == null ? null : sender.from(), myEmail(UserContext.get()), s, events, log, waiting);
    }

    public Status status() {
        Settings s = settings();
        return new Status(mail.sender().isPresent(), s.enabled(), s.events(), s.expenseThreshold(), recipients(s, UserContext.get()));
    }

    public Overview save(SettingsRequest r) {
        List<String> to = split(r.recipients());
        for (String a : to) {
            if (!EMAIL.matcher(a).matches()) throw new BusinessException("Not an e-mail address: " + a);
        }
        if (to.size() > 10) throw new BusinessException("Up to 10 recipients");
        BigDecimal threshold = r.expenseThreshold() == null ? BigDecimal.valueOf(10000) : r.expenseThreshold();
        if (threshold.signum() < 0) throw new BusinessException("The amount for a large expense cannot be negative");
        Map<String, String> v = new LinkedHashMap<>();
        v.put("enabled", String.valueOf(Boolean.TRUE.equals(r.enabled())));
        v.put("recipients", String.join(",", to));
        for (Event e : Event.values()) {
            v.put("event." + e.name(), String.valueOf(r.events() != null && Boolean.TRUE.equals(r.events().get(e.name()))));
        }
        v.put("organizer-copy", String.valueOf(!Boolean.FALSE.equals(r.organizerCopy())));
        v.put("expense-threshold", threshold.stripTrailingZeros().toPlainString());
        v.put("attach", String.valueOf(!Boolean.FALSE.equals(r.attachEvidence())));
        settings.writePrefixed(prefix(UserContext.tenantId()), v);
        activity.record("CHANGED", "Settings", "Alerts by e-mail " + (Boolean.TRUE.equals(r.enabled()) ? "on" : "off"));
        return overview();
    }

    /** Sends a sample alert now, to see how it looks. */
    public Sent test() {
        CurrentUser me = UserContext.get();
        List<String> to = recipients(settings(), me);
        if (to.isEmpty()) throw new BusinessException("Add an address to send alerts to (or an e-mail on your profile)");
        String html = page(me, "Sample", "#0b6aa6", "This is how alerts look", "Sent from Settings › Alerts", ActivityService.money(BigDecimal.valueOf(12500)),
                List.of(new Fact("From", "Savings account"), new Fact("To", "Credit card"), new Fact("Date", DAY.format(OrgClock.today())),
                        new Fact("Reference", "UTR 4122 0981 7731")), null, "Alerts carry the photos and PDFs of the entry as attachments.");
        Pending p = new Pending(me.tenantId(), me, Event.TRANSFER, to, "Sample alert · Personal Budget", html, "This is a sample alert.", List.of(), false, Instant.now());
        return deliver(p);
    }

    // ================================================================== the events

    public void chitCreated(Chit c, List<ChitInstallment> schedule) {
        if (!wanted(Event.CHIT_CREATED, null)) return;
        List<Fact> facts = new ArrayList<>();
        facts.add(new Fact("Organizer", nz(c.getOrganizer())));
        if (c.getTicketNo() != null) facts.add(new Fact("Ticket", c.getTicketNo()));
        facts.add(new Fact("Chit value", ActivityService.money(c.getMaturityAmount())));
        facts.add(new Fact("Installment", ActivityService.money(c.getMonthlyInstallment()) + " × " + c.getNumberOfInstallments()));
        facts.add(new Fact("Runs", DAY.format(c.getStartDate()) + " to " + DAY.format(c.getEndDate())));
        if (c.getCommissionPercent() != null) facts.add(new Fact("Commission", c.getCommissionPercent().stripTrailingZeros().toPlainString() + "%"));
        StringBuilder rows = new StringBuilder();
        schedule.stream().limit(6).forEach(i -> rows.append(tr(false, String.valueOf(i.getInstallmentNo()), DAY.format(i.getDueDate()),
                ActivityService.money(i.getDueAmount()), i.getStatus() == InstallmentStatus.PAID ? "Paid earlier" : "Due")));
        String table = grid(List.of("No", "Due", "Amount", ""), rows.toString(), schedule.size() > 6 ? "and " + (schedule.size() - 6) + " more" : null);
        queue(Event.CHIT_CREATED, "Chit added · " + c.getName(), "Chit added", "#0b6aa6", c.getName(), c.getOrganizer() == null ? "" : "with " + c.getOrganizer(),
                ActivityService.money(c.getMaturityAmount()), facts, table, null, List.of(), null);
    }

    /** schedule: the chit's installments after this payment; entry: the payment's journal entry. */
    public void chitPaid(Chit c, ChitInstallment paid, List<ChitInstallment> schedule, JournalEntry entry, String fromAccount) {
        String ref = entry.getReference();
        boolean owner = wanted(Event.CHIT_PAYMENT, null);
        Settings s = settings();
        String organizerEmail = c.getOrganizerEmail();
        String choice = choice();
        // the organizer's copy goes on its own switch, unless the dialog said not to send anything
        boolean organizer = organizerEmail != null && EMAIL.matcher(organizerEmail.trim()).matches() && !"off".equals(choice)
                && UserContext.current().isPresent() && ("on".equals(choice) || s.enabled() && s.organizerCopy());
        if (!owner && !organizer) return;
        String installment = paid.getInstallmentNo() + " of " + c.getNumberOfInstallments();
        BigDecimal dividend = Money.nz(paid.getDividend());
        List<Fact> facts = new ArrayList<>();
        facts.add(new Fact("Installment", installment + " · due " + DAY.format(paid.getDueDate())));
        facts.add(new Fact("Installment amount", ActivityService.money(paid.getDueAmount())));
        if (dividend.signum() > 0) facts.add(new Fact("Dividend", "− " + ActivityService.money(dividend)));
        facts.add(new Fact("Amount paid", ActivityService.money(paid.getPaidAmount())));
        facts.add(new Fact("Paid on", DAY.format(paid.getPaidDate())));
        if (fromAccount != null) facts.add(new Fact("Paid from", fromAccount));
        facts.add(new Fact("Bank reference", ref == null || ref.isBlank() ? "—" : ref));
        if (c.getTicketNo() != null) facts.add(new Fact("Ticket", c.getTicketNo()));

        // the chit's table: every installment paid, this one marked, then the next one due
        Map<Long, String> refs = new LinkedHashMap<>();
        schedule.stream().filter(i -> i.getJournalEntryId() != null)
                .forEach(i -> entries.findById(i.getJournalEntryId()).map(JournalEntry::getReference).ifPresent(r -> refs.put(i.getId(), r)));
        StringBuilder rows = new StringBuilder();
        BigDecimal paidSoFar = Money.ZERO;
        ChitInstallment next = null;
        for (ChitInstallment i : schedule) {
            if (i.getStatus() == InstallmentStatus.PAID) {
                paidSoFar = paidSoFar.add(Money.nz(i.getPaidAmount()));
                rows.append(tr(i.getId().equals(paid.getId()), String.valueOf(i.getInstallmentNo()), DAY.format(i.getDueDate()),
                        ActivityService.money(i.getDueAmount()), Money.nz(i.getDividend()).signum() > 0 ? ActivityService.money(i.getDividend()) : "—",
                        ActivityService.money(i.getPaidAmount()), i.getPaidDate() == null ? "—" : DAY.format(i.getPaidDate()), nz(refs.get(i.getId()))));
            } else if (next == null) {
                next = i;
            }
        }
        if (next != null) {
            rows.append(tr(false, next.getInstallmentNo() + "", DAY.format(next.getDueDate()), ActivityService.money(next.getDueAmount()), "", "", "next due", ""));
        }
        long paidCount = schedule.stream().filter(i -> i.getStatus() == InstallmentStatus.PAID).count();
        String table = grid(List.of("No", "Due", "Installment", "Dividend", "Paid", "Paid on", "Reference"), rows.toString(),
                paidCount + " of " + c.getNumberOfInstallments() + " paid · " + ActivityService.money(paidSoFar) + " in all");
        List<Long> evidence = List.of(entry.getId());
        if (owner) {
            queue(Event.CHIT_PAYMENT, "Paid " + ActivityService.money(paid.getPaidAmount()) + " · " + c.getName() + " installment " + paid.getInstallmentNo(),
                    "Chit installment paid", "#0b6aa6", c.getName(), "Installment " + installment, ActivityService.money(paid.getPaidAmount()), facts, table,
                    organizer ? "A copy went to the organizer at " + organizerEmail + "." : null, evidence, null);
        }
        if (organizer) {
            CurrentUser me = UserContext.get();
            String html = organizerPage(me, c, paid, installment, dividend, ref, table);
            String text = "Installment " + installment + " of " + c.getName() + (c.getTicketNo() != null ? " (ticket " + c.getTicketNo() + ")" : "")
                    + ": " + ActivityService.money(paid.getPaidAmount()) + " paid on " + DAY.format(paid.getPaidDate())
                    + (ref != null && !ref.isBlank() ? ", bank reference " + ref : "") + ".";
            add(new Pending(me.tenantId(), me, Event.CHIT_PAYMENT, List.of(organizerEmail.trim()),
                    "Installment " + paid.getInstallmentNo() + " paid · " + c.getName() + (c.getTicketNo() != null ? " · " + c.getTicketNo() : ""),
                    html, text, evidence, settings().attachEvidence(), Instant.now().plusSeconds(WAIT_SECONDS)));
        }
    }

    /** Money lent (LENT) or paid on someone's behalf (PAID_FOR). */
    public void claimCreated(ClaimView v) {
        Event event = v.kind() == ClaimKind.LENT ? Event.MONEY_GIVEN : v.kind() == ClaimKind.PAID_FOR ? Event.PAID_FOR : null;
        if (event == null || !wanted(event, null)) return;
        List<Fact> facts = new ArrayList<>();
        facts.add(new Fact(event == Event.MONEY_GIVEN ? "Given to" : "Paid for", v.party()));
        facts.add(new Fact("Date", DAY.format(v.startDate())));
        if (v.paidFromAccount() != null) facts.add(new Fact("Paid from", v.paidFromAccount()));
        if (v.narration() != null && !v.narration().isBlank()) facts.add(new Fact("For", v.narration()));
        if (v.interestRate() != null && v.interestRate().signum() > 0) {
            facts.add(new Fact("Interest", v.interestRate().stripTrailingZeros().toPlainString() + "% a year" + (v.interestTypeLabel() != null ? " · " + v.interestTypeLabel().toLowerCase(Locale.ROOT) : "")));
        }
        if (v.dueDate() != null) facts.add(new Fact("Due back", DAY.format(v.dueDate())));
        if (v.reference() != null && !v.reference().isBlank()) facts.add(new Fact("Reference", v.reference()));
        if (v.entryNo() != null) facts.add(new Fact("Entry", v.entryNo()));
        queue(event, (event == Event.MONEY_GIVEN ? "Money given to " : "Paid for ") + v.party() + " · " + ActivityService.money(v.amount()),
                event.label, event == Event.MONEY_GIVEN ? "#8a5b00" : "#6b3fa0", event == Event.MONEY_GIVEN ? "Money given to " + v.party() : "Paid on behalf of " + v.party(),
                "To be received back", ActivityService.money(v.amount()), facts, null, null,
                v.journalEntryId() == null ? List.of() : List.of(v.journalEntryId()), null);
    }

    /** A transfer (TRANSFER) or an expense (when large enough, or asked for). */
    public void entryPosted(EntryView e) {
        if (e == null) return;
        if (e.voucherType() == com.aditya.personalbudget.domain.type.VoucherType.TRANSFER) {
            if (!wanted(Event.TRANSFER, null)) return;
            LineView from = e.lines().stream().filter(l -> Money.nz(l.credit()).signum() > 0).findFirst().orElse(null);
            LineView to = e.lines().stream().filter(l -> Money.nz(l.debit()).signum() > 0).findFirst().orElse(null);
            List<Fact> facts = new ArrayList<>();
            if (from != null) facts.add(new Fact("From", from.accountName() + balanceAfter(from)));
            if (to != null) facts.add(new Fact("To", to.accountName() + balanceAfter(to)));
            facts.add(new Fact("Date", DAY.format(e.entryDate())));
            common(e, facts);
            queue(Event.TRANSFER, "Transfer " + ActivityService.money(e.amount()) + (from != null && to != null ? " · " + from.accountName() + " → " + to.accountName() : ""),
                    "Transfer", "#0b6aa6", from != null && to != null ? from.accountName() + " → " + to.accountName() : "Between your accounts", e.narration(),
                    ActivityService.money(e.amount()), facts, null, null, List.of(e.id()), null);
            return;
        }
        if (e.voucherType() != com.aditya.personalbudget.domain.type.VoucherType.EXPENSE) return;
        if (!wanted(Event.LARGE_EXPENSE, e.amount())) return;
        List<LineView> items = e.lines().stream().filter(l -> l.categoryId() != null && Money.nz(l.debit()).signum() > 0).toList();
        LineView payer = e.lines().stream().filter(l -> Money.nz(l.credit()).signum() > 0).findFirst().orElse(null);
        List<Fact> facts = new ArrayList<>();
        facts.add(new Fact("Date", DAY.format(e.entryDate())));
        if (payer != null) facts.add(new Fact("Paid from", payer.accountName() + balanceAfter(payer)));
        if (items.size() == 1) facts.add(new Fact("Category", category(items.getFirst().categoryId())));
        common(e, facts);
        String table = null;
        if (items.size() > 1) {
            StringBuilder rows = new StringBuilder();
            items.forEach(l -> rows.append(tr(false, nz(l.memo()), category(l.categoryId()), ActivityService.money(l.debit()))));
            table = grid(List.of("Item", "Category", "Amount"), rows.toString(), items.size() + " items");
        }
        Settings s = settings();
        String note = s.expenseThreshold().signum() > 0 && e.amount().compareTo(s.expenseThreshold()) >= 0
                ? "Sent because it is " + ActivityService.money(s.expenseThreshold()) + " or more." : null;
        queue(Event.LARGE_EXPENSE, "Expense " + ActivityService.money(e.amount()) + " · " + nz(e.narration()),
                "Expense", "#b42318", nz(e.narration()), e.party() == null ? "" : "at " + e.party(), ActivityService.money(e.amount()), facts, table, note, List.of(e.id()), null);
    }

    // ================================================================== sending

    @Scheduled(fixedDelay = 10_000, initialDelay = 30_000)
    public void tick() {
        Instant now = Instant.now();
        for (Pending p : queue) {
            if (p.due().isAfter(now)) continue;
            queue.remove(p);
            CurrentUser previous = UserContext.current().orElse(null);
            UserContext.set(p.user());
            try {
                deliver(p);
            } catch (RuntimeException e) {
                log.warn("Alert {} not sent: {}", p.subject(), e.getMessage());
            } finally {
                if (previous != null) UserContext.set(previous); else UserContext.clear();
                store.endRequest();
            }
        }
    }

    private Sent deliver(Pending p) {
        String result;
        boolean ok = false;
        int attached = 0;
        try {
            TenantMailService.Sender sender = mail.sender().orElseThrow(() -> new BusinessException("E-mail is not set up (Settings › E-mail)"));
            List<Attachment> files = p.attach() ? p.entryIds().stream().flatMap(id -> attachmentRows.findByJournalEntryId(id).stream()).toList() : List.of();
            MimeMessage message = sender.mail().createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(sender.from(), sender.fromName() != null ? sender.fromName() : nz(p.user().tenantName()));
            if (sender.replyTo() != null && !sender.replyTo().isBlank()) helper.setReplyTo(sender.replyTo());
            helper.setTo(p.to().toArray(String[]::new));
            helper.setSubject(p.subject());
            String footer = files.isEmpty() ? "" : files.size() + " file" + (files.size() == 1 ? "" : "s") + " attached";
            helper.setText(p.text() + (footer.isEmpty() ? "" : "\n\n" + footer + "."), p.html().replace("{{files}}", footer.isEmpty() ? ""
                    : "<tr><td style=\"padding:0 24px 16px\"><span style=\"display:inline-block;padding:4px 10px;border-radius:999px;background:#eef4f9;color:#0b4f7d;font-size:12px\">&#128206; " + footer + "</span></td></tr>"));
            long bytes = 0;
            for (Attachment a : files) {
                try {
                    AttachmentService.FileContent f = attachments.file(a.getId(), false);
                    if (bytes + f.bytes().length > MAX_ATTACH_BYTES) break;
                    bytes += f.bytes().length;
                    helper.addAttachment(f.fileName() == null ? "evidence-" + a.getId() : f.fileName(), new ByteArrayResource(f.bytes()),
                            f.contentType() == null ? "application/octet-stream" : f.contentType());
                    attached++;
                } catch (RuntimeException e) {
                    log.warn("Alert {}: evidence {} left out: {}", p.subject(), a.getId(), e.getMessage());
                }
            }
            sender.mail().send(message);
            ok = true;
            result = "Sent to " + String.join(", ", p.to()) + (attached > 0 ? " · " + attached + " file" + (attached == 1 ? "" : "s") : "");
        } catch (Exception e) {
            result = "Not sent: " + ActivityService.cut(TenantMailService.rootMessage(e), 200);
            log.warn("Alert {} not sent: {}", p.subject(), result);
        }
        Sent sent = new Sent(OrgClock.now().withNano(0), p.event().label, p.subject(), String.join(", ", p.to()), ok, result, attached);
        Deque<Sent> list = recent.computeIfAbsent(p.tenantId(), k -> new ArrayDeque<>());
        synchronized (list) {
            list.addFirst(sent);
            while (list.size() > KEEP_RECENT) list.removeLast();
        }
        activity.record("SENT", AREA, ActivityService.cut(p.subject() + " · " + result, 250));
        return sent;
    }

    // ================================================================== helpers

    /** Whether this event is to be sent: the dialog's choice when it made one, else the household's settings. */
    private boolean wanted(Event event, BigDecimal amount) {
        if (UserContext.current().isEmpty()) return false;
        String choice = choice();
        if ("off".equals(choice)) return false;
        if ("on".equals(choice)) return true;
        Settings s = settings();
        if (!s.enabled() || !s.events().getOrDefault(event.name(), false)) return false;
        return amount == null || amount.compareTo(s.expenseThreshold()) >= 0;
    }

    /** The X-Notify header of the request: "on", "off", or null (not said). */
    private static String choice() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes a) {
            String v = a.getRequest().getHeader("X-Notify");
            if (v != null) {
                v = v.trim().toLowerCase(Locale.ROOT);
                return v.equals("on") || v.equals("off") ? v : null;
            }
        }
        return null;
    }

    private void queue(Event event, String subject, String kicker, String tone, String title, String subtitle, String amount, List<Fact> facts,
                       String table, String note, List<Long> entryIds, List<String> to) {
        CurrentUser me = UserContext.get();
        List<String> recipients = to != null ? to : recipients(settings(), me);
        if (recipients.isEmpty()) {
            log.info("Alert {} skipped: no recipient (Settings › Alerts, or an e-mail on the profile)", subject);
            return;
        }
        String html = page(me, kicker, tone, title, subtitle, amount, facts, table, note);
        StringBuilder text = new StringBuilder(kicker).append(": ").append(title).append('\n').append(amount).append("\n\n");
        facts.forEach(f -> text.append(f.label()).append(": ").append(f.value()).append('\n'));
        if (note != null) text.append('\n').append(note).append('\n');
        add(new Pending(me.tenantId(), me, event, recipients, subject, html, text.toString(), entryIds, settings().attachEvidence(),
                Instant.now().plusSeconds(entryIds.isEmpty() ? 2 : WAIT_SECONDS)));
    }

    /** Queued once the save is committed: a save rolled back sends nothing. */
    private void add(Pending p) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    queue.add(p);
                }
            });
        } else {
            queue.add(p);
        }
    }

    private List<String> recipients(Settings s, CurrentUser me) {
        if (!s.recipients().isEmpty()) return s.recipients();
        String mine = myEmail(me);
        return mine == null ? List.of() : List.of(mine);
    }

    private String myEmail(CurrentUser me) {
        if (me == null || me.userId() == null) return null;
        return users.findById(me.userId()).map(AppUser::getEmail).filter(e -> e != null && EMAIL.matcher(e.trim()).matches()).map(String::trim).orElse(null);
    }

    private void common(EntryView e, List<Fact> facts) {
        if (e.party() != null && !e.party().isBlank()) facts.add(new Fact("Party", e.party()));
        if (e.reference() != null && !e.reference().isBlank()) facts.add(new Fact("Reference", e.reference()));
        facts.add(new Fact("Entry", e.entryNo() + (e.createdBy() != null ? " · by " + e.createdBy() : "")));
    }

    private static String balanceAfter(LineView l) {
        return l.balanceAfter() == null ? "" : " · balance " + ActivityService.money(l.balanceAfter());
    }

    private String category(Long id) {
        return id == null ? "—" : categories.findByIdAndTenantId(id, UserContext.tenantId()).map(c -> c.getName()).orElse("—");
    }

    private static String prefix(Long tenantId) {
        return "notify." + tenantId + ".";
    }

    private static List<String> split(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        Set<String> out = new LinkedHashSet<>();
        for (String s : csv.split("[,;\\s]+")) if (!s.isBlank()) out.add(s.trim());
        return List.copyOf(out);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    // ================================================================== the e-mails (inline styles: mail clients drop stylesheets)

    private static final String FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    /** The owner's alert: a coloured kicker, the title, the amount, the facts, and optionally a table and a note. */
    static String page(CurrentUser me, String kicker, String tone, String title, String subtitle, String amount, List<Fact> facts, String table, String note) {
        StringBuilder f = new StringBuilder();
        for (int i = 0; i < facts.size(); i++) {
            Fact x = facts.get(i);
            String border = i == 0 ? "" : "border-top:1px solid #edf1f5;";
            f.append("<tr><td style=\"").append(border).append("padding:8px 0;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top\">").append(esc(x.label()))
                    .append("</td><td style=\"").append(border).append("padding:8px 0;color:#14212e;font-size:14px;font-weight:600;text-align:right\">")
                    .append(esc(x.value())).append("</td></tr>");
        }
        String org = me == null ? "" : nz(me.tenantName());
        return "<!doctype html><html><body style=\"margin:0;background:#f2f5f8\">"
                + "<div style=\"background:#f2f5f8;padding:24px 12px;" + FONT + "\">"
                + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e8ef;border-radius:14px;overflow:hidden\">"
                + "<tr><td style=\"height:4px;background:" + tone + "\"></td></tr>"
                + "<tr><td style=\"padding:20px 24px 6px\">"
                + "<div style=\"font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:" + tone + "\">" + esc(kicker) + "</div>"
                + "<div style=\"margin-top:4px;font-size:19px;font-weight:700;color:#0f1d2b\">" + esc(title) + "</div>"
                + (subtitle == null || subtitle.isBlank() ? "" : "<div style=\"margin-top:2px;font-size:13px;color:#5b6b7b\">" + esc(subtitle) + "</div>")
                + "</td></tr>"
                + "<tr><td style=\"padding:8px 24px 4px\"><div style=\"font-size:30px;font-weight:700;color:#0f1d2b;font-variant-numeric:tabular-nums\">" + esc(amount) + "</div></td></tr>"
                + "<tr><td style=\"padding:6px 24px 14px\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%\">" + f + "</table></td></tr>"
                + (table == null ? "" : "<tr><td style=\"padding:0 24px 16px\">" + table + "</td></tr>")
                + (note == null ? "" : "<tr><td style=\"padding:0 24px 14px;font-size:12.5px;color:#5b6b7b\">" + esc(note) + "</td></tr>")
                + "{{files}}"
                + "<tr><td style=\"padding:12px 24px;background:#f7f9fb;border-top:1px solid #e9eef3;font-size:11.5px;color:#7a8996\">"
                + "Sent by " + esc(org) + "'s Personal Budget. Change what you get in Settings › Alerts.</td></tr>"
                + "</table></div></body></html>";
    }

    /** The organizer's copy: a short letter, the payment, and the chit's table. Nothing about the household's other money. */
    private static String organizerPage(CurrentUser me, Chit c, ChitInstallment paid, String installment, BigDecimal dividend, String ref, String table) {
        String payer = me == null ? "" : nz(me.fullName());
        String row = "padding:7px 0;border-top:1px solid #edf1f5;font-size:13.5px";
        StringBuilder facts = new StringBuilder();
        Map<String, String> m = new LinkedHashMap<>();
        m.put("Chit", c.getName() + (c.getTicketNo() != null ? " · ticket " + c.getTicketNo() : ""));
        m.put("Installment", installment + " · due " + DAY.format(paid.getDueDate()));
        m.put("Installment amount", ActivityService.money(paid.getDueAmount()));
        if (dividend.signum() > 0) m.put("Less dividend", ActivityService.money(dividend));
        m.put("Amount paid", ActivityService.money(paid.getPaidAmount()));
        m.put("Paid on", DAY.format(paid.getPaidDate()));
        m.put("Bank reference", ref == null || ref.isBlank() ? "—" : ref);
        boolean first = true;
        for (var e : m.entrySet()) {
            String b = first ? "padding:7px 0;font-size:13.5px" : row;
            boolean strong = e.getKey().equals("Amount paid") || e.getKey().equals("Bank reference");
            facts.append("<tr><td style=\"").append(b).append(";color:#5b6b7b\">").append(esc(e.getKey())).append("</td><td style=\"").append(b)
                    .append(";text-align:right;color:#14212e;font-weight:").append(strong ? "700" : "500").append("\">").append(esc(e.getValue())).append("</td></tr>");
            first = false;
        }
        return "<!doctype html><html><body style=\"margin:0;background:#ffffff\">"
                + "<div style=\"padding:20px 12px;" + FONT + ";color:#14212e\">"
                + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:560px;margin:0 auto\">"
                + "<tr><td style=\"font-size:14px;line-height:1.55\">Dear " + esc(c.getOrganizer() == null ? "Sir / Madam" : c.getOrganizer()) + ",<br>"
                + "Installment " + esc(installment) + " of <b>" + esc(c.getName()) + "</b> is paid. The details are below.</td></tr>"
                + "<tr><td style=\"padding:14px 0 6px\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border:1px solid #e1e8ef;border-radius:10px;padding:4px 14px\">"
                + facts + "</table></td></tr>"
                + "<tr><td style=\"padding:10px 0 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5b6b7b\">The chit so far</td></tr>"
                + "<tr><td>" + table + "</td></tr>"
                + "{{files}}"
                + "<tr><td style=\"padding:16px 0 0;font-size:13.5px;line-height:1.55\">Regards,<br>" + esc(payer) + "</td></tr>"
                + "</table></div></body></html>";
    }

    /** A compact table: a header row, the rows, and a caption under it. */
    static String grid(List<String> head, String rows, String caption) {
        StringBuilder h = new StringBuilder();
        for (int i = 0; i < head.size(); i++) {
            h.append("<th style=\"padding:6px 8px;background:#f3f6f9;border-bottom:1px solid #e1e8ef;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5b6b7b;text-align:")
                    .append(i == 0 ? "left" : "right").append("\">").append(esc(head.get(i))).append("</th>");
        }
        return "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border:1px solid #e1e8ef;border-radius:8px;border-collapse:separate;overflow:hidden\">"
                + "<tr>" + h + "</tr>" + rows + "</table>"
                + (caption == null ? "" : "<div style=\"padding:6px 2px 0;font-size:11.5px;color:#7a8996\">" + esc(caption) + "</div>");
    }

    /** One row of a {@link #grid}; mark: this payment (highlighted). */
    static String tr(boolean mark, String... cells) {
        StringBuilder r = new StringBuilder("<tr").append(mark ? " style=\"background:#fff7e0\"" : "").append(">");
        for (int i = 0; i < cells.length; i++) {
            r.append("<td style=\"padding:6px 8px;border-top:1px solid #edf1f5;font-size:12.5px;white-space:nowrap;color:#14212e;text-align:")
                    .append(i == 0 ? "left" : "right").append(mark ? ";font-weight:700" : "").append("\">").append(esc(Objects.toString(cells[i], ""))).append("</td>");
        }
        return r.append("</tr>").toString();
    }
}
