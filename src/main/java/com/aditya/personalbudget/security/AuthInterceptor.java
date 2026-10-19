package com.aditya.personalbudget.security;

import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.exception.UnauthorizedException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Authenticates every {@code /api/**} call from its bearer token and authorizes it against the role
 * matrix ({@link RolePolicy}), always:
 * <ul>
 *   <li>a method or class {@link RequiresPermission} must be granted to the user's role;</li>
 *   <li>a read (GET) without one needs {@link Permission#VIEW};</li>
 *   <li>a write without one is refused unless it is {@link SelfService} (sign out, own password).</li>
 * </ul>
 * So a viewer can read but never change data, and a new endpoint is locked until it declares a permission.
 * On top of the role, the call must belong to a section shared with the user ({@link FeaturePolicy}); a mobile
 * session only reaches the user's mobile sections.
 * The live-update stream ({@code /api/events}) may pass the token as {@code ?token=}, because browsers
 * cannot set headers on an EventSource.
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    private static final String BEARER = "Bearer ";

    private final SessionRegistry sessions;

    /** What a user still on the default password may call: who am I, set the password, sign out. */
    private static final java.util.Set<String> PASSWORD_STEP = java.util.Set.of("/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/events");

    public AuthInterceptor(SessionRegistry sessions) {
        this.sessions = sessions;
    }

    public static String tokenOf(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER)) {
            return header.substring(BEARER.length()).trim();
        }
        return request.getRequestURI().equals("/api/events") ? request.getParameter("token") : null;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        CurrentUser user = sessions.find(tokenOf(request))
                .orElseThrow(() -> new UnauthorizedException("Session expired, please sign in again"));
        UserContext.set(user);
        if (user.mustChangePassword() && !PASSWORD_STEP.contains(request.getRequestURI())) {
            throw new ForbiddenException("Set a new password first");
        }

        if (handler instanceof HandlerMethod method) {
            RequiresPermission required = method.getMethodAnnotation(RequiresPermission.class);
            if (required == null) {
                required = method.getBeanType().getAnnotation(RequiresPermission.class);
            }
            boolean read = "GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod());
            Permission permission = required != null ? required.value() : read ? Permission.VIEW : null;
            if (permission == null) {
                if (!method.hasMethodAnnotation(SelfService.class)) {
                    throw new ForbiddenException("This action is not open to your role");
                }
            } else if (!RolePolicy.allows(user.role(), permission)) {
                throw new ForbiddenException("Your role (" + user.role().getLabel() + ") does not allow: "
                        + permission.getDescription());
            }
        }
        if (user.viaLink() && !FeaturePolicy.allowsLink(user, request.getMethod(), request.getRequestURI())) {
            throw new ForbiddenException("This link does not give access to that");
        }
        if (!FeaturePolicy.allows(user.features(), request.getMethod(), request.getRequestURI())) {
            throw new ForbiddenException(user.mobile() ? "This section is not shared with you on mobile"
                    : "This section is not shared with you. Ask your admin.");
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        UserContext.clear();
    }
}
