package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.AppSettingsService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Serves the mobile version at the address set in Settings (default {@code /m}): a request for
 * {@code /<path>} or {@code /<path>/} is forwarded to {@code mobile.html}. The setting is read on each such
 * request, so a new address works at once. {@code /m} without a trailing slash is redirected to {@code /m/}.
 */
@Component
public class MobilePathFilter extends OncePerRequestFilter {

    private static final Pattern SINGLE_SEGMENT = Pattern.compile("^/([a-z0-9][a-z0-9-]{0,29})(/?)$");

    private final AppSettingsService settings;

    public MobilePathFilter(AppSettingsService settings) {
        this.settings = settings;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"GET".equals(request.getMethod()) || !SINGLE_SEGMENT.matcher(request.getRequestURI()).matches();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Matcher m = SINGLE_SEGMENT.matcher(request.getRequestURI());
        if (m.matches() && AppSettingsService.valid(m.group(1)) && m.group(1).equals(settings.get().mobilePath())) {
            if (m.group(2).isEmpty()) {
                response.sendRedirect(request.getRequestURI() + "/");
                return;
            }
            response.setHeader("Cache-Control", "no-cache, private");
            request.getRequestDispatcher("/mobile.html").forward(request, response);
            return;
        }
        chain.doFilter(request, response);
    }
}
