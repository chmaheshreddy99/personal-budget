package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.AppSettingsService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Phones get the mobile version only: a phone asking for the full site ({@code /} or {@code /index.html}) is sent to
 * the mobile address set in Settings (default {@code /m/}) before any of the full site is loaded. Tablets and
 * computers get the full site.
 * <ul>
 *   <li>{@code /?ui=full} opens the full site on a phone anyway and remembers it (a cookie, for a year);</li>
 *   <li>{@code /?ui=mobile} forgets that and goes to the mobile version again;</li>
 *   <li>a full-site access link ({@code /?link=...}) is left alone: it opens what it was made for.</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class DeviceRedirectFilter extends OncePerRequestFilter {

    static final String COOKIE = "pb_ui";
    /** "Mobi" is in the user agent of phones (not of Android tablets); iPads are tablets even when they say Mobile. */
    private static final Pattern PHONE = Pattern.compile("Mobi|Opera Mini|Windows Phone|BlackBerry|BB10");
    private static final Pattern TABLET = Pattern.compile("iPad|Tablet|Kindle|Silk/");

    private final AppSettingsService settings;

    public DeviceRedirectFilter(AppSettingsService settings) {
        this.settings = settings;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !"GET".equals(request.getMethod()) || !(uri.equals("/") || uri.equals("/index.html"));
    }

    /** A phone, judged by its user agent. */
    static boolean isPhone(String userAgent) {
        return userAgent != null && PHONE.matcher(userAgent).find() && !TABLET.matcher(userAgent).find();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.addHeader("Vary", "User-Agent");
        response.addHeader("Vary", "Cookie");
        String ui = request.getParameter("ui");
        if ("full".equals(ui)) {
            response.addCookie(cookie("full", 365 * 24 * 3600));
            chain.doFilter(request, response);
            return;
        }
        boolean wantsMobile = "mobile".equals(ui);
        if (wantsMobile) {
            response.addCookie(cookie("", 0));
        }
        boolean full = !wantsMobile && request.getCookies() != null
                && Arrays.stream(request.getCookies()).anyMatch(c -> COOKIE.equals(c.getName()) && "full".equals(c.getValue()));
        if (full || request.getParameter("link") != null || !(wantsMobile || isPhone(request.getHeader("User-Agent")))) {
            chain.doFilter(request, response);
            return;
        }
        String query = request.getQueryString() == null ? "" : Arrays.stream(request.getQueryString().split("&"))
                .filter(p -> !p.isEmpty() && !p.startsWith("ui="))
                .collect(Collectors.joining("&"));
        response.setHeader("Cache-Control", "no-cache, private");
        response.sendRedirect("/" + settings.get().mobilePath() + "/" + (query.isEmpty() ? "" : "?" + query));
    }

    private static Cookie cookie(String value, int maxAge) {
        Cookie c = new Cookie(COOKIE, value);
        c.setPath("/");
        c.setMaxAge(maxAge);
        c.setHttpOnly(true);
        c.setAttribute("SameSite", "Lax");
        return c;
    }
}
