package com.aditya.personalbudget.service;

import com.aditya.personalbudget.exception.BusinessException;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Refuses the same thing sent twice in a few seconds (a double tap, a form sent from two tabs): the first one
 * runs, an identical one within {@link #WINDOW_MILLIS} is refused with a clear message. If the first one fails,
 * the next try is let through. The fingerprint is built by the caller (who, and what exactly).
 */
@Component
public class DuplicateGuard {

    public static final long WINDOW_MILLIS = 30_000;

    private final Map<String, Long> recent = new ConcurrentHashMap<>();

    /** Runs the action once per fingerprint within the window; a repeat throws {@code message}. */
    public <T> T once(String fingerprint, String message, Supplier<T> action) {
        long now = System.currentTimeMillis();
        if (recent.size() > 2000) {
            recent.values().removeIf(at -> now - at > WINDOW_MILLIS);
        }
        Long before = recent.putIfAbsent(fingerprint, now);
        if (before != null) {
            if (now - before < WINDOW_MILLIS) {
                throw new BusinessException(message);
            }
            recent.put(fingerprint, now);
        }
        try {
            return action.get();
        } catch (RuntimeException e) {
            recent.remove(fingerprint, now);   // it did not happen: it may be tried again
            throw e;
        }
    }
}
