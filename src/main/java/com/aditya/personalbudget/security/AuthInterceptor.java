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
    private final BrickAccess brickAccess;
    private final ChangeGate changes;

    /** What a user still on the default password may call: who am I, set the password, sign out. */
    private static final java.util.Set<String> PASSWORD_STEP = java.util.Set.of("/api/auth/me", "/api/auth/password", "/api/auth/logout", "/api/events");

    private final com.aditya.personalbudget.service.BrickAppService brickApp;

    public AuthInterceptor(SessionRegistry sessions, BrickAccess brickAccess, ChangeGate changes,
                           @org.springframework.context.annotation.Lazy com.aditya.personalbudget.service.BrickAppService brickApp) {
        this.sessions = sessions;
        this.brickAccess = brickAccess;
        this.changes = changes;
        this.brickApp = brickApp;
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
            // Brick Management: the role there must hold one of the permissions the endpoint names
            BrickGuard guard = method.getMethodAnnotation(BrickGuard.class);
            if (guard != null) brickAccess.require(guard.value());
        }
        // staff of the brick business: Brick Management only, at the API too (whatever their app role allows)
        BrickRole staff = brickAccess.staffRole(user);
        if (staff != null && !BrickAccess.staffMay(request.getRequestURI())) {
            throw new ForbiddenException("Your role (" + staff.getLabel() + ") opens Brick Management only");
        }
        // the Bricks phone app: Brick Management only, and there the screens the web app gives it
        if (sessions.bricksApp(tokenOf(request))) {
            UserContext.setClient(SessionRegistry.BRICKS_APP);
            if (!BrickAccess.staffMay(request.getRequestURI())) throw new ForbiddenException("The Bricks app opens Brick Management only");
            String refused = brickApp.refusal(user, request.getMethod(), request.getRequestURI());
            if (refused != null) throw new ForbiddenException(refused);
        }
        if (user.viaLink() && !FeaturePolicy.allowsLink(user, request.getMethod(), request.getRequestURI())) {
            throw new ForbiddenException("This link does not give access to that");
        }
        if (!FeaturePolicy.allows(user.features(), request.getMethod(), request.getRequestURI())) {
            throw new ForbiddenException(user.mobile() ? "This section is not shared with you on mobile"
                    : "This section is not shared with you. Ask your admin.");
        }
        // an entry with a request open on it is not changed meanwhile, by anyone
        if (!user.viaLink()) {
            String approving = request.getHeader("X-Approved-Change");
            changes.refuseWhileOpen(request.getMethod(), request.getRequestURI(), approving != null && approving.matches("[0-9]+") ? Long.valueOf(approving) : null);
        }
        // maker-checker: who needs approval does not change what is recorded; the change waits for a checker instead
        if (changes.holds(user, request.getMethod(), request.getRequestURI())) {
            try {
                changes.hold(request, response);
            } catch (java.io.IOException e) {
                throw new com.aditya.personalbudget.exception.BusinessException("The change could not be kept for approval");
            }
            return false;
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        UserContext.clear();
    }
}
