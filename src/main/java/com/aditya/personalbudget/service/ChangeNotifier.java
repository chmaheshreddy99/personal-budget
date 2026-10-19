package com.aditya.personalbudget.service;

import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Live updates: every signed-in browser keeps a Server-Sent Events stream open ({@code /api/events}).
 * When a change is committed, the other browsers of the same household are told which tables changed
 * and by whom, so they refresh at once. A heartbeat keeps proxies from closing idle streams.
 */
@Component
public class ChangeNotifier {

    private static final Logger log = LoggerFactory.getLogger(ChangeNotifier.class);
    /** Sign-ins and sign-outs change these; nobody's screen needs to refresh for that. */
    private static final Set<String> QUIET = Set.of("user_sessions", "app_users", "activity_log", "access_links");

    private record Subscriber(SseEmitter emitter, Long tenantId, Long userId) {
    }

    private final List<Subscriber> subscribers = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService heartbeat = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "sse-heartbeat");
        t.setDaemon(true);
        return t;
    });

    public ChangeNotifier(TsvDataStore store) {
        store.addCommitListener(this::onCommit);
        heartbeat.scheduleAtFixedRate(this::ping, 25, 25, TimeUnit.SECONDS);
    }

    public SseEmitter subscribe(CurrentUser user) {
        SseEmitter emitter = new SseEmitter(0L);   // no timeout: the browser reconnects if it drops
        Subscriber subscriber = new Subscriber(emitter, user.tenantId(), user.userId());
        subscribers.add(subscriber);
        Runnable remove = () -> subscribers.remove(subscriber);
        emitter.onCompletion(remove);
        emitter.onTimeout(remove);
        emitter.onError(e -> remove.run());
        send(subscriber, "hello", Map.of("at", LocalDateTime.now().toString()));
        return emitter;
    }

    /** How many browsers are listening (shown in the footer). */
    public long listeners(Long tenantId) {
        return subscribers.stream().filter(s -> s.tenantId().equals(tenantId)).count();
    }

    private void onCommit(Set<String> tables) {
        if (QUIET.containsAll(tables)) {
            return;
        }
        CurrentUser by = UserContext.current().orElse(null);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("tables", tables);
        payload.put("userId", by == null ? null : by.userId());
        payload.put("by", by == null ? "system" : by.fullName());
        payload.put("at", LocalDateTime.now().toString());
        for (Subscriber s : subscribers) {
            if (by == null || s.tenantId().equals(by.tenantId())) {
                send(s, "change", payload);
            }
        }
    }

    private void ping() {
        subscribers.forEach(s -> send(s, "ping", Map.of()));
    }

    private void send(Subscriber s, String name, Object data) {
        try {
            s.emitter().send(SseEmitter.event().name(name).data(data));
        } catch (IOException | IllegalStateException e) {
            subscribers.remove(s);
            log.debug("Dropped a live-update stream: {}", e.getMessage());
        }
    }
}
