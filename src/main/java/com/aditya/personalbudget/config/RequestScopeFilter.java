package com.aditya.personalbudget.config;

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
 *   <li>GET / HEAD requests are read-only: they see all tables as of one moment and cannot write;</li>
 *   <li>at the end of every request the tables it read are forgotten, so nothing stays in memory.</li>
 * </ul>
 * The live-update stream is long-lived and reads nothing itself, so it is left out.
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
        return !uri.startsWith("/api/") || uri.equals("/api/events");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean read = "GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod());
        if (read) {
            store.beginReadOnly();
        }
        try {
            chain.doFilter(request, response);
        } finally {
            store.endRequest();
        }
    }
}
