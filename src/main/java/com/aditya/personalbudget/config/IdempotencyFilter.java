package com.aditya.personalbudget.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A save is done once, however often it is sent. A form sends the same {@code Idempotency-Key} header with every
 * attempt (a double tap, a retry after a slow network): the first request runs; while it runs, another with the key
 * is refused ("already being saved"); once it is done, the stored answer is replayed instead of saving again.
 * Keys are kept per session for ten minutes. Requests without the header are not affected.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class IdempotencyFilter extends OncePerRequestFilter {

    static final String HEADER = "Idempotency-Key";
    private static final long KEEP_MILLIS = 10 * 60 * 1000L;
    private static final int MAX_ENTRIES = 5000;

    private record Done(int status, String contentType, byte[] body, long at) {
    }

    private static final Object RUNNING = new Object();
    private final Map<String, Object> seen = new ConcurrentHashMap<>();

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        return request.getHeader(HEADER) == null || !request.getRequestURI().startsWith("/api/")
                || !("POST".equals(method) || "PUT".equals(method));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String auth = request.getHeader("Authorization");
        String key = (auth == null ? "anon" : Integer.toHexString(auth.hashCode())) + "|" + request.getMethod() + "|"
                + request.getRequestURI() + "|" + request.getHeader(HEADER).trim();
        prune();
        Object before = seen.putIfAbsent(key, RUNNING);
        if (before instanceof Done done) {
            replay(response, done);
            return;
        }
        if (before == RUNNING) {
            refuse(response);
            return;
        }
        ContentCachingResponseWrapper wrapper = new ContentCachingResponseWrapper(response);
        boolean stored = false;
        try {
            chain.doFilter(request, wrapper);
            int status = wrapper.getStatus();
            if (status < 400) {   // a failed save may be tried again with the same key
                seen.put(key, new Done(status, wrapper.getContentType(), wrapper.getContentAsByteArray(), System.currentTimeMillis()));
                stored = true;
            }
            wrapper.copyBodyToResponse();
        } finally {
            if (!stored) {
                seen.remove(key, RUNNING);
            }
        }
    }

    private static void replay(HttpServletResponse response, Done done) throws IOException {
        response.setStatus(done.status());
        if (done.contentType() != null) {
            response.setContentType(done.contentType());
        }
        response.setHeader("Idempotent-Replay", "true");
        response.getOutputStream().write(done.body());
    }

    private static void refuse(HttpServletResponse response) throws IOException {
        response.setStatus(422);
        response.setContentType("application/json");
        response.getOutputStream().write("{\"status\":422,\"message\":\"Already being saved, one moment\"}".getBytes(StandardCharsets.UTF_8));
    }

    private void prune() {
        if (seen.size() < MAX_ENTRIES / 10) {
            return;
        }
        long cutoff = System.currentTimeMillis() - KEEP_MILLIS;
        seen.entrySet().removeIf(e -> e.getValue() instanceof Done d && d.at() < cutoff);
        if (seen.size() > MAX_ENTRIES) {
            seen.entrySet().removeIf(e -> e.getValue() instanceof Done);
        }
    }
}
