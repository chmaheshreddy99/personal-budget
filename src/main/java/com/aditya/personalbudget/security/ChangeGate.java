package com.aditya.personalbudget.security;

import com.aditya.personalbudget.service.BrickApprovalService;
import com.aditya.personalbudget.service.BrickNoticeService;
import com.aditya.personalbudget.service.PendingService;
import com.aditya.personalbudget.service.PendingService.PendingView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Maker-checker for changes: a user who needs approval records new entries (they wait for a checker as before, or go
 * through), but never changes or deletes what is already recorded. Such a call is not made: it is kept as a change
 * request in the approval queue ({@link PendingService#submitChange}) and answered {@code 202 Accepted}; a checker
 * approves it (it is made then, as it was asked) or turns it down with a reason, which the maker can answer and send
 * again. Who needs approval: a user the organization's approval setting holds to it ({@link CurrentUser#approval()}),
 * and in Brick Management a maker who cannot approve.
 * <p>
 * Not changes in this sense: signing in and out, the approval steps themselves, evidence, and the delivery life cycle of
 * an order (planning, loading and sending trips, links for the customer); an order's own changes, its cancellation and
 * free delivery are asked in Brick Management's own words ({@link BrickApprovalService}).
 */
@Component
public class ChangeGate {

    /** A POST that changes what is recorded (reverses, cancels, writes off …) rather than records something new. */
    private static final Pattern CHANGING_POST = Pattern.compile(".*/(reverse|cancel|write-off|undo|close|reopen|foreclose)$");
    private static final Pattern EXEMPT = Pattern.compile("^/api/(auth/.*|approvals/.*|attachments(/.*)?|bricks/approvals/.*|bricks/people/.*"
            + "|bricks/orders/\\d+(/cancel|/waive|/replan|/trips(/.*)?|/links(/.*)?)?|admin/.*|events)$");
    private static final int BODY_MAX = 16000;

    private final PendingService pending;
    private final BrickApprovalService bricks;
    private final BrickNoticeService notices;
    private final ObjectMapper json;

    public ChangeGate(@Lazy PendingService pending, @Lazy BrickApprovalService bricks, @Lazy BrickNoticeService notices, ObjectMapper json) {
        this.pending = pending;
        this.bricks = bricks;
        this.notices = notices;
        this.json = json;
    }

    /** Is this call a change that has to wait for a checker? */
    public boolean holds(CurrentUser user, String method, String uri) {
        if (user == null || user.userId() == null || user.viaLink()) return false;
        if (!isChange(method, uri)) return false;
        if (user.approval()) return true;
        return uri.startsWith("/api/bricks/") && bricks.waitsForChanges();
    }

    static boolean isChange(String method, String uri) {
        if (EXEMPT.matcher(uri).matches()) return false;
        return switch (method) {
            case "PUT", "PATCH", "DELETE" -> true;
            case "POST" -> CHANGING_POST.matcher(uri).matches();
            default -> false;
        };
    }

    /**
     * Refuses a change to an entry that has a request open on it (whoever makes it): it is answered first, by approving
     * or turning it down (or the maker withdraws it). Recording new entries and the delivery life cycle are not held up.
     */
    public void refuseWhileOpen(String method, String uri, Long approving) {
        boolean change = switch (method) {
            case "PUT", "PATCH", "DELETE" -> true;
            case "POST" -> CHANGING_POST.matcher(uri).matches() || uri.matches(".*/waive$");
            default -> false;
        };
        if (!change || uri.startsWith("/api/approvals/") || uri.startsWith("/api/bricks/approvals/") || uri.startsWith("/api/auth/")
                || uri.startsWith("/api/attachments") || uri.startsWith("/api/bricks/notices/")) return;
        String target = PendingService.targetOf(uri);
        // the approved change itself, being made by its checker, is the one let through
        pending.openTargets().stream().filter(t -> t.target().equals(target) && !t.id().equals(approving)).findFirst().ifPresent(t -> {
            throw new com.aditya.personalbudget.exception.BusinessException(t.number() + " is open on this (" + (PendingEntry_PENDING.equals(t.status())
                    ? "waiting for approval" : "turned down, waiting for an answer") + "): it is answered first, then it can be changed");
        });
    }

    private static final String PendingEntry_PENDING = "PENDING";

    /** Keeps the call as a change request and answers 202 with it. */
    public void hold(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String body = new String(request.getInputStream().readNBytes(BODY_MAX + 1), StandardCharsets.UTF_8);
        if (body.length() > BODY_MAX) throw new com.aditya.personalbudget.exception.BusinessException("This change is too big to send for approval");
        String uri = request.getRequestURI() + (request.getQueryString() != null ? "?" + request.getQueryString() : "");
        String label = label(request.getMethod(), request.getRequestURI());
        List<String> fields = new ArrayList<>();
        BigDecimal amount = null;
        if (!body.isBlank()) {
            try {
                JsonNode n = json.readTree(body);
                if (n.isObject()) {
                    for (var e : n.properties()) {
                        JsonNode v = e.getValue();
                        if (v == null || v.isNull() || "version".equals(e.getKey())) continue;
                        String shown = v.isValueNode() ? v.asString() : v.isArray() ? v.size() + " item" + (v.size() == 1 ? "" : "s") : "…";
                        if (shown.isBlank()) continue;
                        fields.add(words(e.getKey()) + ": " + (shown.length() > 60 ? shown.substring(0, 60) + "…" : shown));
                        if (amount == null && "amount".equals(e.getKey()) && v.isNumber()) amount = v.decimalValue();
                        if (fields.size() >= 14) break;
                    }
                }
            } catch (RuntimeException e) {
                fields.add("(as sent)");
            }
        }
        PendingView v = pending.submitChange(request.getMethod(), uri, body.isBlank() ? null : body, label, fields, amount);
        if (request.getRequestURI().startsWith("/api/bricks/")) {
            notices.post(UserContext.tenantId(), "APPROVAL", "Waiting for approval: a change", v.reference() + " · " + label + " · asked by " + v.submittedBy(),
                    "bricks/approvals/" + v.id(), BrickNoticeService.CHECKERS);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pendingApproval", true);
        out.put("message", v.reference() + ": sent for approval · a checker makes the change when they approve it");
        out.put("pending", v);
        response.setStatus(HttpServletResponse.SC_ACCEPTED);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(json.writeValueAsString(out));
    }

    /** What the call changes, in words ("Change the production batch 12", "Delete the expense 40"). */
    static String label(String method, String uri) {
        String p = uri.replaceFirst("^/api/", "");
        String verb = switch (method) {
            case "DELETE" -> "Delete";
            case "POST" -> p.endsWith("/reverse") ? "Reverse" : p.endsWith("/cancel") ? "Cancel" : p.endsWith("/write-off") ? "Write off"
                    : p.endsWith("/undo") ? "Undo" : p.endsWith("/close") ? "Close" : p.endsWith("/reopen") ? "Reopen" : "Change";
            default -> "Change";
        };
        String[] parts = p.replaceAll("/(reverse|cancel|write-off|undo|close|reopen|foreclose)$", "").split("/");
        String what = null, id = null;
        for (int i = parts.length - 1; i >= 0; i--) {
            if (parts[i].matches("\\d+")) { if (id == null) id = parts[i]; continue; }
            what = THINGS.getOrDefault(parts[i], parts[i].replace('-', ' '));
            break;
        }
        return verb + " the " + (what == null ? "record" : what) + (id != null ? " " + id : "");
    }

    private static final Map<String, String> THINGS = Map.ofEntries(
            Map.entry("batches", "production batch"), Map.entry("purchases", "raw material purchase"), Map.entry("expenses", "expense"),
            Map.entry("payments", "payment"), Map.entry("orders", "order"), Map.entry("transactions", "journal entry"), Map.entry("quick", "entry"),
            Map.entry("refunds", "refund"), Map.entry("claims", "money lent"), Map.entry("repayments", "repayment"), Map.entry("interest", "interest posting"),
            Map.entry("gifts", "gift"), Map.entry("documents", "document"), Map.entry("accounts", "account"), Map.entry("budgets", "budget"),
            Map.entry("recurring", "recurring entry"), Map.entry("chits", "chit"), Map.entry("hosted-chits", "hosted chit"), Map.entry("types", "brick type"),
            Map.entry("materials", "raw material"), Map.entry("vehicles", "vehicle"), Map.entry("resources", "team member"));

    /** "deliveryChargePerTrip" → "Delivery charge per trip". */
    private static String words(String key) {
        String s = key.replaceAll("([a-z])([A-Z])", "$1 $2").replace('_', ' ').toLowerCase();
        return s.isEmpty() ? key : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
