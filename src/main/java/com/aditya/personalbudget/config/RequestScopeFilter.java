package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.OrgClock;
import com.aditya.personalbudget.storage.TsvDataStore;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Brackets every API request for the data store:
 * <ul>
 *   <li>a request starts on a clean thread: whatever an earlier use of the pooled thread read is forgotten first, so
 *       it can never be served a copy of the data from before the latest save;</li>
 *   <li>GET / HEAD requests are read-only: they see all tables as of one moment and cannot write;</li>
 *   <li>at the end of every request the tables it read (and the organization's time zone) are forgotten, so
 *       nothing stays in memory.</li>
 * </ul>
 * The live-update stream is long-lived: it is not made read-only (it would hold the lock for hours), but what its
 * sign-in check read is forgotten like any other request's (it once stayed pinned on the thread, and the next request
 * that thread served showed the data as it was before the latest save).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestScopeFilter extends OncePerRequestFilter {

    private final TsvDataStore store;

    public RequestScopeFilter(TsvDataStore store) {
        this.store = store;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !uri.startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        store.endRequest();   // a clean start, whatever this pooled thread did before
        OrgClock.endRequest();
        boolean read = ("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod())) && !request.getRequestURI().equals("/api/events");
        if (read) {
            store.beginReadOnly();
        }
        try {
            chain.doFilter(request, response);
        } finally {
            store.endRequest();
            OrgClock.endRequest();
        }
    }
}
