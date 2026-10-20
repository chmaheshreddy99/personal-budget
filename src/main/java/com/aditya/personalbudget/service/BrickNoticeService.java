package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.BrickNotice;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.BrickNoticeRepository;
import com.aditya.personalbudget.security.BrickAccess;
import com.aditya.personalbudget.security.BrickPermission;
import com.aditya.personalbudget.security.BrickRole;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Notifications in Brick Management. A notice is kept (for the bell) and, once the change it belongs to is committed,
 * sent live to the browsers of the users it is for: never to the one who did it.
 * Audiences: {@link #ALL} (anyone who takes orders or approves), {@link #CHECKERS} (who approves) or one user.
 */
@Service
public class BrickNoticeService {

    public static final String ALL = "ALL";
    public static final String CHECKERS = "APPROVE";

    /** data: what it is about, for its alert (JSON: a new order's number, customer, bricks …), or null. */
    public record NoticeView(Long id, String kind, String title, String body, String link, String actor, LocalDateTime createdAt, String data) {
    }

    private final BrickNoticeRepository notices;
    private final com.aditya.personalbudget.repository.BrickNoticeReadRepository reads;
    private final ChangeNotifier notifier;
    private final BrickAccess access;
    /** Posted in this thread's transaction, sent when it commits (dropped with it otherwise). */
    private final ThreadLocal<List<BrickNotice>> queued = ThreadLocal.withInitial(ArrayList::new);

    public BrickNoticeService(BrickNoticeRepository notices, ChangeNotifier notifier, BrickAccess access, TsvDataStore store,
                              com.aditya.personalbudget.repository.BrickNoticeReadRepository reads) {
        this.notices = notices;
        this.reads = reads;
        this.notifier = notifier;
        this.access = access;
        store.addCommitListener(tables -> {
            if (tables.contains("brick_notices")) flush();
        });
    }

    /** For one user: the audience that reaches only them. */
    public static String user(Long userId) {
        return "U:" + userId;
    }

    public void post(Long tenantId, String kind, String title, String body, String link, String audience) {
        post(tenantId, kind, title, body, link, audience, null);
    }

    /** With what it is about (JSON), for its alert. */
    public void post(Long tenantId, String kind, String title, String body, String link, String audience, String data) {
        CurrentUser by = UserContext.current().filter(u -> u.userId() != null).orElse(null);
        BrickNotice n = new BrickNotice();
        n.setTenantId(tenantId);
        n.setKind(kind);
        n.setTitle(ActivityService.cut(title, 200));
        n.setBody(body == null ? null : ActivityService.cut(body, 500));
        n.setLink(link);
        n.setAudience(audience);
        n.setActorId(by == null ? null : by.userId());
        n.setActor(by == null ? "The customer" : by.fullName());
        n.setCreatedAt(LocalDateTime.now());
        n.setData(data == null || data.length() > 2000 ? null : data);
        queued.get().add(notices.save(n));
    }

    /** The signed-in user's notices not seen yet (not opened, not cleared), newest first. */
    public List<NoticeView> recent() {
        return unread().stream().limit(40).map(BrickNoticeService::view).toList();
    }

    private List<BrickNotice> unread() {
        CurrentUser me = UserContext.current().orElseThrow();
        BrickRole role = access.roleOf(me.userId(), me.role());
        java.util.Set<Long> seen = reads.findByUser(me.tenantId(), me.userId()).stream().map(com.aditya.personalbudget.domain.entity.BrickNoticeRead::getNoticeId)
                .collect(java.util.stream.Collectors.toSet());
        // older than a month: no longer news
        LocalDateTime since = LocalDateTime.now().minusDays(30);
        return notices.findByTenantId(me.tenantId()).stream().filter(n -> !seen.contains(n.getId()) && reaches(n, me.userId(), role))
                .filter(n -> n.getCreatedAt() == null || n.getCreatedAt().isAfter(since))
                .sorted(Comparator.comparing(BrickNotice::getId).reversed()).toList();
    }

    /** Seen: one notice. */
    @org.springframework.transaction.annotation.Transactional
    public int read(Long id) {
        return markRead(unread().stream().filter(n -> n.getId().equals(id)).toList());
    }

    /** Cleared: every notice of the signed-in user. */
    @org.springframework.transaction.annotation.Transactional
    public int readAll() {
        return markRead(unread());
    }

    /** What a notice is about was opened (an order, a request): its notices are seen ("bricks/sales/12" also covers its payments). */
    @org.springframework.transaction.annotation.Transactional
    public int seen(String link) {
        if (link == null || link.isBlank()) return 0;
        String l = link.replaceFirst("^#?/?", "");
        return markRead(unread().stream().filter(n -> n.getLink() != null && (n.getLink().equals(l) || n.getLink().startsWith(l + "/"))).toList());
    }

    private int markRead(List<BrickNotice> list) {
        CurrentUser me = UserContext.current().orElseThrow();
        for (BrickNotice n : list) {
            com.aditya.personalbudget.domain.entity.BrickNoticeRead r = new com.aditya.personalbudget.domain.entity.BrickNoticeRead();
            r.setTenantId(me.tenantId());
            r.setNoticeId(n.getId());
            r.setUserId(me.userId());
            r.setReadAt(LocalDateTime.now());
            reads.save(r);
        }
        return list.size();
    }

    private void flush() {
        List<BrickNotice> list = new ArrayList<>(queued.get());
        queued.remove();
        for (BrickNotice n : list) {
            if (notices.findById(n.getId()).isEmpty()) continue;   // its transaction rolled back
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("notice", view(n));
            notifier.notice(n.getTenantId(), payload, (userId, appRole) -> userId != null && reaches(n, userId, roleOf(userId, appRole)));
        }
    }

    private BrickRole roleOf(Long userId, UserRole appRole) {
        return access.roleOf(userId, appRole);
    }

    /** Is the notice for this user? Not their own doing; the whole yard, the checkers, or them. */
    static boolean reaches(BrickNotice n, Long userId, BrickRole role) {
        if (userId != null && userId.equals(n.getActorId())) return false;
        String a = n.getAudience() == null ? ALL : n.getAudience();
        if (a.startsWith("U:")) return a.equals(user(userId));
        if (CHECKERS.equals(a)) return role.allows(BrickPermission.APPROVE);
        return role.allows(BrickPermission.SALES) || role.allows(BrickPermission.APPROVE);
    }

    private static NoticeView view(BrickNotice n) {
        return new NoticeView(n.getId(), n.getKind(), n.getTitle(), n.getBody(), n.getLink(), n.getActor(), n.getCreatedAt(), n.getData());
    }
}
