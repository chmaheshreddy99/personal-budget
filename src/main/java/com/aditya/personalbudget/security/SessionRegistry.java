package com.aditya.personalbudget.security;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.entity.UserSession;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.AccessLinkRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.repository.UserSessionRepository;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;

/**
 * Issues opaque bearer tokens and resolves them to the signed-in user.
 * <p>
 * Sessions are stored in {@code user_sessions.tbl} (token hashed), so they survive restarts. Each request
 * re-reads the user and the tenant, so deactivating someone or changing their role takes effect on their
 * very next request, everywhere.
 */
@Component
public class SessionRegistry {

    private final SecureRandom random = new SecureRandom();
    private final UserSessionRepository sessions;
    private final AppUserRepository users;
    private final TenantRepository tenants;
    private final AccessLinkRepository links;
    private final ApprovalPolicy approvals;
    private final int sessionHours;

    public SessionRegistry(UserSessionRepository sessions, AppUserRepository users, TenantRepository tenants,
                           BudgetProperties properties, AccessLinkRepository links, ApprovalPolicy approvals) {
        this.approvals = approvals;
        this.sessions = sessions;
        this.users = users;
        this.tenants = tenants;
        this.links = links;
        this.sessionHours = properties.security().sessionHours();
    }

    /** Creates a session for the user and returns the token (shown to the client once, never stored). */
    public String open(AppUser user, String userAgent) {
        return open(user, userAgent, false);
    }

    /** As {@link #open(AppUser, String)}; a mobile session only reaches the user's mobile sections. */
    public String open(AppUser user, String userAgent, boolean mobile) {
        LocalDateTime now = LocalDateTime.now();
        sessions.deleteAll(sessions.findExpired(now));   // housekeeping while we are writing anyway
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UserSession session = new UserSession();
        session.setTenantId(user.getTenantId());
        session.setUserId(user.getId());
        session.setTokenHash(hash(token));
        session.setCreatedAt(now);
        session.setExpiresAt(now.plusHours(sessionHours));
        session.setUserAgent(userAgent == null ? null : userAgent.substring(0, Math.min(200, userAgent.length())));
        session.setMobile(mobile ? Boolean.TRUE : null);
        sessions.save(session);
        return token;
    }

    /**
     * A session for someone who opened an access link: tied to the admin who made the link, ending when the link
     * expires (or after the usual session hours, whichever comes first).
     */
    public String openForLink(AccessLink link, String userAgent) {
        LocalDateTime now = LocalDateTime.now();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UserSession session = new UserSession();
        session.setTenantId(link.getTenantId());
        session.setUserId(link.getCreatedById());
        session.setTokenHash(hash(token));
        session.setCreatedAt(now);
        LocalDateTime end = now.plusHours(sessionHours);
        session.setExpiresAt(end.isBefore(link.getExpiresAt()) ? end : link.getExpiresAt());
        session.setUserAgent(userAgent == null ? null : userAgent.substring(0, Math.min(200, userAgent.length())));
        session.setMobile(!link.opensDesktop());
        session.setLinkId(link.getId());
        sessions.save(session);
        return token;
    }

    /** Ends every session opened with the link (it was revoked). */
    public void closeAllForLink(Long linkId) {
        sessions.deleteAll(sessions.findByLinkId(linkId));
    }

    /** The user behind a token, read fresh: empty when the session expired or the user / tenant is inactive. */
    public Optional<CurrentUser> find(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        return sessions.findByTokenHash(hash(token))
                .filter(s -> s.getExpiresAt().isAfter(LocalDateTime.now()))
                .flatMap(s -> s.getLinkId() != null ? findForLink(s) : users.findById(s.getUserId())
                        .filter(u -> Boolean.TRUE.equals(u.getActive()))
                        .flatMap(u -> tenants.findById(u.getTenantId())
                                .filter(t -> Boolean.TRUE.equals(t.getActive()))
                                .map(t -> toCurrent(u, t, Boolean.TRUE.equals(s.getMobile()), approvals.forUser(u, t)))));
    }

    /** A link session lives only while its link is active and its maker is still an active user. */
    private Optional<CurrentUser> findForLink(UserSession s) {
        LocalDateTime now = LocalDateTime.now();
        return links.findById(s.getLinkId())
                .filter(l -> l.isActive(now))
                .flatMap(l -> users.findById(l.getCreatedById())
                        .filter(u -> Boolean.TRUE.equals(u.getActive()))
                        .flatMap(u -> tenants.findById(l.getTenantId())
                                .filter(t -> Boolean.TRUE.equals(t.getActive()))
                                .map(t -> forLink(l, t, approvals.forLink(l, t)))));
    }

    /** {@code approval}: what it records waits for a checker (see {@link ApprovalPolicy#forLink}). */
    public static CurrentUser forLink(AccessLink l, Tenant t, boolean approval) {
        Set<Feature> features = EnumSet.noneOf(Feature.class);
        features.addAll(Feature.parse(l.getFeatures(), EnumSet.noneOf(Feature.class)));
        if (!l.opensDesktop()) {
            features.removeIf(f -> !f.isMobile());
        }
        String name = l.getLabel();
        return new CurrentUser(l.getCreatedById(), ("link:" + name).substring(0, Math.min(50, name.length() + 5)), name,
                AccessLink.RECORD.equals(l.getMode()) ? UserRole.MEMBER : UserRole.VIEWER,
                t.getId(), t.getCode(), t.getName(), t.getCurrency(), features, !l.opensDesktop(), l.getId(), approval);
    }

    public void close(String token) {
        if (token != null) {
            sessions.findByTokenHash(hash(token)).ifPresent(sessions::delete);
        }
    }

    /** Signs a user out everywhere, e.g. after deactivation or before deletion. */
    public void closeAllFor(Long userId) {
        sessions.deleteAll(sessions.findByUserId(userId));
    }

    public static CurrentUser toCurrent(AppUser u, Tenant t, boolean mobile) {
        return toCurrent(u, t, mobile, false);
    }

    /** {@code approval}: what the user records waits for a checker (see {@link ApprovalPolicy#forUser}). */
    public static CurrentUser toCurrent(AppUser u, Tenant t, boolean mobile, boolean approval) {
        return new CurrentUser(u.getId(), u.getUsername(), u.getFullName(), u.getRole(),
                t.getId(), t.getCode(), t.getName(), t.getCurrency(), FeaturePolicy.granted(u, mobile), mobile, null, approval,
                Boolean.TRUE.equals(u.getMustChangePassword()));
    }

    static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
