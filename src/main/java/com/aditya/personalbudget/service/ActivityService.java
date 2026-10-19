package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ActivityEntry;
import com.aditya.personalbudget.repository.ActivityEntryRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.Currency;
import java.util.List;
import java.util.Locale;

/**
 * The activity log: who changed what, when, and from where. Every successful change through the API is written
 * by {@code ActivityRecorder}; sign-ins, opened access links and approvals are written by their services.
 * Writing the log never fails the change it describes.
 */
@Service
public class ActivityService {

    private static final Logger log = LoggerFactory.getLogger(ActivityService.class);

    public record ActivityView(Long id, LocalDateTime at, String actor, String via, Long userId, Long linkId,
                               String action, String area, String summary) {
    }

    private final ActivityEntryRepository entries;

    public ActivityService(ActivityEntryRepository entries) {
        this.entries = entries;
    }

    /** Records an action of the current user (nothing when there is none). */
    public void record(String action, String area, String summary) {
        UserContext.current().ifPresent(u -> record(u, action, area, summary, null, null));
    }

    public void record(CurrentUser user, String action, String area, String summary, String method, String path) {
        try {
            ActivityEntry e = new ActivityEntry();
            e.setTenantId(user.tenantId());
            e.setAt(LocalDateTime.now());
            e.setUserId(user.userId());
            e.setActor(actorOf(user));
            e.setVia(user.viaLink() ? "LINK" : user.mobile() ? "MOBILE" : "WEB");
            e.setLinkId(user.linkId());
            e.setAction(action);
            e.setArea(cut(area, 30));
            e.setSummary(cut(summary == null || summary.isBlank() ? action : summary, 300));
            e.setMethod(method);
            e.setPath(cut(path, 200));
            entries.save(e);
        } catch (RuntimeException ex) {
            log.warn("Could not write the activity log: {}", ex.getMessage());
        }
    }

    /** Newest first, filtered by period, person, area and free text. */
    public List<ActivityView> list(LocalDate from, LocalDate to, String actor, String area, String q, int limit) {
        Long tenantId = UserContext.tenantId();
        String text = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        return entries.findByTenantId(tenantId).stream()
                .filter(e -> from == null || !e.getAt().toLocalDate().isBefore(from))
                .filter(e -> to == null || !e.getAt().toLocalDate().isAfter(to))
                .filter(e -> actor == null || actor.isBlank() || e.getActor().equals(actor))
                .filter(e -> area == null || area.isBlank() || e.getArea().equals(area))
                .filter(e -> text.isEmpty() || (e.getSummary() + " " + e.getActor() + " " + e.getArea() + " " + e.getAction())
                        .toLowerCase(Locale.ROOT).contains(text))
                .sorted(Comparator.comparing(ActivityEntry::getAt).thenComparing(ActivityEntry::getId).reversed())
                .limit(limit > 0 ? limit : 500)
                .map(e -> new ActivityView(e.getId(), e.getAt(), e.getActor(), e.getVia(), e.getUserId(), e.getLinkId(),
                        e.getAction(), e.getArea(), e.getSummary()))
                .toList();
    }

    /**
     * Deletes the entries of the household from before {@code before} (all of them when it is null); with
     * {@code dryRun} only counts them. The clearing itself is logged afterwards, so the log never goes silent.
     */
    @Transactional
    public long clear(LocalDate before, boolean dryRun) {
        Long tenantId = UserContext.tenantId();
        List<ActivityEntry> old = entries.findByTenantId(tenantId).stream()
                .filter(e -> before == null || e.getAt().toLocalDate().isBefore(before))
                .toList();
        if (!dryRun && !old.isEmpty()) {
            entries.deleteAll(old);
            record("DELETED", "Activity", "Cleared " + old.size() + " activity entr" + (old.size() == 1 ? "y" : "ies")
                    + (before == null ? " (everything)" : " from before " + before));
        }
        return old.size();
    }

    public static String actorOf(CurrentUser user) {
        return user.viaLink() ? cut(user.fullName() + " · link", 100) : cut(user.fullName(), 100);
    }

    /** "₹2,789" in the household's currency. */
    public static String money(BigDecimal amount) {
        if (amount == null) {
            return "";
        }
        String code = UserContext.current().map(CurrentUser::currency).orElse("INR");
        NumberFormat f = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("INR".equals(code) ? "en-IN" : "en-US"));
        try {
            f.setCurrency(Currency.getInstance(code));
        } catch (IllegalArgumentException ignored) {
            // unknown code: keep the locale's currency
        }
        f.setMaximumFractionDigits(amount.stripTrailingZeros().scale() > 0 ? 2 : 0);
        return f.format(amount);
    }

    static String cut(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
