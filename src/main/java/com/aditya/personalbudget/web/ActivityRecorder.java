package com.aditya.personalbudget.web;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.repository.AccessLinkRepository;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.GiftRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.PersonalDocumentRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ActivityService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Writes the activity log: after every successful change through the API (any POST, PUT or DELETE that answered
 * 2xx) one line says who did what, in words: "Paid installment 7 · Shriram Gold 5L · ₹21,676". The words come from
 * the call (what kind of change, on which section) and from the saved record the call returned; for a deletion,
 * from the record as it was just before (read in {@link #preHandle}). Registered after the authentication
 * interceptor, so the signed-in user is still known when the request completes.
 */
@Component
@ControllerAdvice
public class ActivityRecorder implements HandlerInterceptor, ResponseBodyAdvice<Object> {

    private static final String BODY = ActivityRecorder.class.getName() + ".body";
    private static final String BEFORE = ActivityRecorder.class.getName() + ".before";
    private static final Pattern ID = Pattern.compile("/(\\d+)");

    private final ActivityService activity;
    private final ObjectMapper json;
    private final JournalEntryRepository entries;
    private final ChitRepository chits;
    private final AccountRepository accounts;
    private final ClaimRepository claims;
    private final BudgetRepository budgets;
    private final CategoryRepository categories;
    private final AppUserRepository users;
    private final AttachmentRepository attachments;
    private final AccessLinkRepository links;
    private final GiftRepository gifts;
    private final PersonalDocumentRepository documents;

    public ActivityRecorder(ActivityService activity, ObjectMapper json, JournalEntryRepository entries, ChitRepository chits,
                            AccountRepository accounts, ClaimRepository claims, BudgetRepository budgets,
                            CategoryRepository categories, AppUserRepository users, AttachmentRepository attachments,
                            AccessLinkRepository links,
                            GiftRepository gifts, PersonalDocumentRepository documents) {
        this.gifts = gifts;
        this.documents = documents;
        this.activity = activity;
        this.json = json;
        this.entries = entries;
        this.chits = chits;
        this.accounts = accounts;
        this.claims = claims;
        this.budgets = budgets;
        this.categories = categories;
        this.users = users;
        this.attachments = attachments;
        this.links = links;
    }

    // ================================================================== capture

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType contentType,
                                  Class<? extends HttpMessageConverter<?>> converterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        if (request instanceof ServletServerHttpRequest servlet && !"GET".equals(servlet.getServletRequest().getMethod())) {
            servlet.getServletRequest().setAttribute(BODY, body);
        }
        return body;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String method = request.getMethod();
        if ("DELETE".equals(method) || request.getRequestURI().endsWith("/undo")) {
            try {
                request.setAttribute(BEFORE, before(path(request)));
            } catch (RuntimeException ignored) {
                // the log is best effort
            }
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        String method = request.getMethod();
        if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method) || ex != null
                || response.getStatus() >= 300 || response.getStatus() == 202) {   // 202: kept for approval, logged as such
            return;
        }
        String path = path(request);
        if (path.startsWith("/auth") || path.startsWith("/events") || path.startsWith("/approvals")
                || path.startsWith("/admin/links") || path.startsWith("/admin/approval") || path.startsWith("/activity")) {
            return;   // sign-in, approvals and links write their own, clearer lines
        }
        Optional<CurrentUser> user = UserContext.current();
        if (user.isEmpty()) {
            return;
        }
        try {
            String[] what = describe(method, path, request.getAttribute(BODY), (String) request.getAttribute(BEFORE));
            activity.record(user.get(), what[0], what[1], what[2], method, request.getRequestURI());
        } catch (RuntimeException ignored) {
            // never let the log break a change that already happened
        }
    }

    // ================================================================== words

    /** {action, area, summary}. */
    private String[] describe(String method, String path, Object body, String before) {
        Map<String, Object> b = map(body);
        String details = before != null ? before : details(b);
        boolean post = "POST".equals(method), put = "PUT".equals(method);
        String verb = post ? "ADDED" : put ? "CHANGED" : "DELETED";
        if (path.matches("/expenses/\\d+/refunds")) return of("POSTED", "Expenses", "Recorded a refund", details);
        if (path.matches("/expenses/\\d+/refunds/\\d+")) return of("DELETED", "Expenses", "Undid a refund or reversal", details);
        if (path.matches("/expenses/\\d+/reverse")) return of("REVERSED", "Expenses", "Reversed an expense", details);
        if (path.startsWith("/expenses")) return of(verb, "Expenses", post ? "Added an expense" : put ? "Edited an expense" : "Deleted an expense", details);

        if (path.matches("/chits/\\d+/installments/\\d+/pay")) return of("POSTED", "Chits", "Paid installment" + installmentNo(body, path), details);
        if (path.matches("/chits/\\d+/installments/\\d+/undo")) return of("DELETED", "Chits", "Undid an installment payment", details);
        if (path.matches("/chits/\\d+/payout")) return of("POSTED", "Chits", "Recorded a payout", details);
        if (path.matches("/chits/\\d+/payout/undo")) return of("DELETED", "Chits", "Undid a payout", details);
        if (path.startsWith("/chits")) return of(verb, "Chits", post ? "Added a chit" : put ? "Edited a chit" : "Deleted a chit", details);

        if (path.matches("/claims/\\d+/repayments")) return of("POSTED", "Money owed", "Recorded a repayment", details);
        if (path.matches("/claims/\\d+/repayments/\\d+")) return of("DELETED", "Money owed", "Removed a repayment", details);
        if (path.matches("/claims/\\d+/interest")) return of("POSTED", "Money owed", "Posted interest", details);
        if (path.matches("/claims/\\d+/interest/\\d+")) return of("REVERSED", "Money owed", "Reversed posted interest", details);
        if (path.matches("/claims/\\d+/write-off")) return of("POSTED", "Money owed", "Wrote off / waived the rest", details);
        if (path.matches("/claims/\\d+/interest-account")) return of("CHANGED", "Money owed", "Changed the interest account", details);
        if (path.matches("/claims/\\d+/shares")) return of("ADDED", "Money owed", "Made a statement link", details);
        if (path.matches("/claims/\\d+/shares/\\d+/revoke")) return of("REVOKED", "Money owed", "Stopped a statement link", details);
        if (path.matches("/claims/\\d+/interest-plan")) return of("CHANGED", "Money owed", "Changed how interest is collected", details);
        if (path.startsWith("/claims")) return of(verb, "Money owed", post ? "Recorded money lent / owed" : put ? "Edited money lent / owed" : "Deleted money lent / owed", details);

        if (path.startsWith("/accounts")) return of(verb, "Accounts", post ? "Added an account" : put ? "Edited an account" : "Deleted an account", details);
        if (path.startsWith("/categories")) return of(verb, "Settings", post ? "Added a category" : put ? "Changed a category" : "Deleted a category", details);
        if (path.startsWith("/budgets/copy")) return of("ADDED", "Budgets", "Copied last month's budgets", details);
        if (path.startsWith("/budgets")) return of(verb, "Budgets", post ? "Set a budget" : "Removed a budget", details);
        if (path.startsWith("/recurring")) return of(verb, "Budgets", post ? "Changed a recurring item" : put ? "Edited a recurring item" : "Deleted a recurring item", details);

        if (path.startsWith("/transactions/quick")) return of("POSTED", "Journal", "Posted a transaction", details);
        if (path.startsWith("/transactions/journal")) return of("ADDED", "Journal", "Added a journal voucher", details);
        if (path.matches("/transactions/\\d+/reverse")) return of("REVERSED", "Journal", "Reversed an entry", details);
        if (path.startsWith("/transactions")) return of(verb, "Journal", put ? "Edited a journal voucher" : "Deleted a journal entry", details);

        if (path.matches("/documents/\\d+/shares")) return of("ADDED", "Documents", "Made a share link", details);
        if (path.matches("/documents/\\d+/shares/\\d+/revoke")) return of("REVOKED", "Documents", "Stopped a share link", details);
        if (path.startsWith("/documents")) return of(verb, "Documents", post ? "Added a document" : put ? "Edited a document" : "Deleted a document", details);
        if (path.equals("/gifts/person")) return of(verb, "Gifts", "Edited a person's relation / family", details);
        if (path.startsWith("/gifts")) return of(verb, "Gifts", post ? "Recorded a gift" : put ? "Edited a gift" : "Deleted a gift", details);
        if (path.startsWith("/attachments")) return of(verb, "Evidence", post ? "Added evidence" : put ? "Changed evidence" : "Deleted evidence", details);
        if (path.startsWith("/admin/users")) return of(verb, "Users", post ? "Added a user" : put ? "Changed a user" : "Deleted a user", details);
        if (path.startsWith("/admin/tenants")) return of(verb, "Users", post ? "Added a tenant" : "Changed a tenant", details);
        if (path.startsWith("/admin/app-settings")) return of("CHANGED", "Settings", "Changed the mobile address", details);
        return of(verb, "Other", method + " " + path, details);
    }

    private static String[] of(String action, String area, String what, String details) {
        return new String[] {action, area, details == null || details.isBlank() ? what : what + " · " + details};
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object body) {
        if (body == null || body instanceof String || body instanceof Number || body instanceof Boolean) {
            return Map.of();
        }
        try {
            Map<String, Object> m = json.convertValue(body, Map.class);
            return m.get("chit") instanceof Map<?, ?> chit ? (Map<String, Object>) chit : m;   // a chit with its schedule
        } catch (RuntimeException e) {
            return Map.of();
        }
    }

    /** "Groceries · ₹2,789 · EX-000012" from the saved record. */
    private static String details(Map<String, Object> b) {
        List<String> parts = new ArrayList<>();
        first(b, "narration", "name", "label", "title", "categoryName", "fullName", "fileName", "mobilePath").ifPresent(parts::add);
        first(b, "person").map(p -> ("GIVEN".equals(b.get("direction")) ? "to " : "from ") + p).ifPresent(parts::add);
        first(b, "owner").ifPresent(o -> parts.add("· " + o));
        first(b, "party").filter(p -> !parts.contains(p)).ifPresent(p -> parts.add("· " + p));
        Object amount = b.getOrDefault("amount", b.getOrDefault("monthlyLimit", b.get("totalLimit")));
        if (amount != null) {
            try {
                parts.add(ActivityService.money(new BigDecimal(amount.toString())));
            } catch (NumberFormatException ignored) {
                // not a number
            }
        }
        first(b, "entryNo").ifPresent(parts::add);
        first(b, "month").ifPresent(parts::add);
        return String.join(" · ", parts).replace(" · · ", " · ");
    }

    private static Optional<String> first(Map<String, Object> b, String... keys) {
        for (String k : keys) {
            Object v = b.get(k);
            if (v != null && !v.toString().isBlank() && !(v instanceof Map) && !(v instanceof List)) {
                return Optional.of(v.toString());
            }
        }
        return Optional.empty();
    }

    /** " #7": the installment's number in its chit, from the chit's schedule the call returned. */
    private String installmentNo(Object body, String path) {
        Matcher m = Pattern.compile("/installments/(\\d+)").matcher(path);
        if (!m.find() || body == null) return "";
        try {
            Map<?, ?> all = json.convertValue(body, Map.class);
            if (all.get("installments") instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Map<?, ?> i && m.group(1).equals(String.valueOf(i.get("id")))) return " #" + i.get("installmentNo");
                }
            }
        } catch (RuntimeException ignored) {
            // no number then
        }
        return "";
    }

    /** What a record was before it is deleted or undone. */
    private String before(String path) {
        Long tenantId = UserContext.tenantId();
        List<Long> ids = new ArrayList<>();
        Matcher m = ID.matcher(path);
        while (m.find()) {
            ids.add(Long.valueOf(m.group(1)));
        }
        if (ids.isEmpty()) return null;
        Long id = ids.get(0), last = ids.get(ids.size() - 1);
        if (path.startsWith("/expenses") || path.startsWith("/transactions")) {
            return own(entries.findById(last), tenantId).map(e -> e.getNarration() + " · " + ActivityService.money(e.getAmount()) + " · " + e.getEntryNo()).orElse(null);
        }
        if (path.startsWith("/chits")) return own(chits.findById(id), tenantId).map(c -> c.getName()).orElse(null);
        if (path.startsWith("/accounts")) return own(accounts.findById(id), tenantId).map(a -> a.getName()).orElse(null);
        if (path.startsWith("/claims")) return own(claims.findById(id), tenantId).map(c -> c.getParty() + " · " + c.getNarration() + " · " + ActivityService.money(c.getAmount())).orElse(null);
        if (path.startsWith("/budgets")) {
            return own(budgets.findById(id), tenantId).map(b -> categories.findById(b.getCategoryId()).map(c -> c.getName()).orElse("") + " · " + b.getMonth()
                    + " · " + ActivityService.money(b.getMonthlyLimit())).orElse(null);
        }
        if (path.startsWith("/categories")) return own(categories.findById(id), tenantId).map(c -> c.getName()).orElse(null);
        if (path.startsWith("/admin/users")) return own(users.findById(id), tenantId).map(u -> u.getFullName() + " (" + u.getUsername() + ")").orElse(null);
        if (path.startsWith("/attachments")) return own(attachments.findById(id), tenantId).map(a -> a.getFileName()).orElse(null);
        if (path.startsWith("/admin/links")) return own(links.findById(id), tenantId).map(l -> l.getLabel()).orElse(null);
        if (path.startsWith("/gifts")) return own(gifts.findById(id), tenantId).map(g -> g.getPerson() + " · " + g.getKind().toLowerCase()
                + (g.getValue() != null ? " · " + ActivityService.money(g.getValue()) : "")).orElse(null);
        if (path.startsWith("/documents")) return own(documents.findById(id), tenantId).map(d -> d.getTitle() + " · " + d.getOwner()).orElse(null);
        return null;
    }

    private static <T extends TenantOwned> Optional<T> own(Optional<T> row, Long tenantId) {
        return row.filter(r -> Objects.equals(r.getTenantId(), tenantId));
    }

    private static String path(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return uri.startsWith("/api") ? uri.substring(4) : uri;
    }
}
