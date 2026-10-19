package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccessLinkRepository;
import com.aditya.personalbudget.repository.PendingEntryRepository;
import com.aditya.personalbudget.repository.UserSessionRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.SessionRegistry;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Temporary access links to the mobile version (see {@link AccessLink}). An admin makes one for a person, for a
 * number of hours, with the sections it opens, view-only or recorder, and optionally maker-checker. The link is
 * shown once (only its hash is kept); it stops working when it expires or the moment it is revoked.
 */
@Service
public class AccessLinkService {

    /** The longest a link can live: 30 days. */
    public static final int MAX_HOURS = 24 * 30;

    public record LinkRequest(
            @NotBlank @Size(max = 60) String label,
            @Min(1) @Max(MAX_HOURS) int hours,
            @NotEmpty Set<Feature> features,
            @NotBlank String mode,
            boolean approval,
            @Size(max = 200) String note,
            /* DESKTOP (the full app, any section) or MOBILE (the default) */
            String client) {
    }

    public record LinkView(Long id, String label, Set<Feature> features, String mode, boolean approval,
                           String createdByName, LocalDateTime createdAt, LocalDateTime expiresAt,
                           LocalDateTime revokedAt, String revokedByName, LocalDateTime lastUsedAt, int useCount,
                           String status, long openSessions, long pending, String note, String client) {
    }

    /** A new link: the token is returned this once, to build the address shown to the admin. */
    public record CreatedLink(LinkView link, String token) {
    }

    private final AccessLinkRepository links;
    private final UserSessionRepository sessions;
    private final PendingEntryRepository pending;
    private final SessionRegistry registry;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public AccessLinkService(AccessLinkRepository links, UserSessionRepository sessions, PendingEntryRepository pending,
                             SessionRegistry registry, ActivityService activity) {
        this.links = links;
        this.sessions = sessions;
        this.pending = pending;
        this.registry = registry;
        this.activity = activity;
    }

    public List<LinkView> list() {
        return links.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(AccessLink::getCreatedAt).reversed())
                .map(this::toView)
                .toList();
    }

    @Transactional
    public CreatedLink create(LinkRequest r) {
        CurrentUser me = UserContext.get();
        String mode = r.mode().trim().toUpperCase();
        if (!AccessLink.VIEW.equals(mode) && !AccessLink.RECORD.equals(mode)) {
            throw new BusinessException("Mode is VIEW or RECORD");
        }
        boolean desktop = AccessLink.DESKTOP.equalsIgnoreCase(r.client() == null ? "" : r.client().trim());
        Set<Feature> features = EnumSet.noneOf(Feature.class);
        features.addAll(r.features());
        if (!desktop) {
            features.removeIf(f -> !f.isMobile());   // the mobile version has only its own sections
        }
        if (AccessLink.RECORD.equals(mode)) {
            features.add(Feature.EXPENSES);   // recording expenses needs the Expenses section
        }
        if (features.isEmpty()) {
            throw new BusinessException("Pick at least one section for the link");
        }
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        LocalDateTime now = LocalDateTime.now();
        AccessLink link = new AccessLink();
        link.setTenantId(me.tenantId());
        link.setLabel(r.label().trim());
        link.setTokenHash(hash(token));
        link.setFeatures(features.stream().sorted().map(Enum::name).collect(Collectors.joining(",")));
        link.setMode(mode);
        link.setApproval(AccessLink.RECORD.equals(mode) && r.approval());
        link.setCreatedById(me.userId());
        link.setCreatedByName(me.fullName());
        link.setCreatedAt(now);
        link.setExpiresAt(now.plusHours(r.hours()));
        link.setUseCount(0);
        link.setNote(r.note() == null || r.note().isBlank() ? null : r.note().trim());
        link.setClient(desktop ? AccessLink.DESKTOP : AccessLink.MOBILE);
        link = links.save(link);
        activity.record("ADDED", "Access links", "Made an access link for " + link.getLabel() + " · "
                + (AccessLink.RECORD.equals(mode) ? (link.getApproval() ? "recorder with approval" : "recorder") : "view only")
                + " · " + (desktop ? "full app" : "mobile") + " · " + features.stream().map(Feature::getLabel).collect(Collectors.joining(", ")) + " · " + r.hours() + " h");
        return new CreatedLink(toView(link), token);
    }

    @Transactional
    public LinkView revoke(Long id) {
        AccessLink link = require(id);
        if (link.getRevokedAt() == null) {
            link.setRevokedAt(LocalDateTime.now());
            link.setRevokedByName(UserContext.get().fullName());
            link = links.save(link);
            registry.closeAllForLink(link.getId());
            activity.record("REVOKED", "Access links", "Revoked the access link for " + link.getLabel());
        }
        return toView(link);
    }

    /** Revokes every link that still works. */
    @Transactional
    public int revokeAll() {
        LocalDateTime now = LocalDateTime.now();
        List<AccessLink> active = links.findByTenantId(UserContext.tenantId()).stream().filter(l -> l.isActive(now)).toList();
        active.forEach(l -> {
            l.setRevokedAt(now);
            l.setRevokedByName(UserContext.get().fullName());
            links.save(l);
            registry.closeAllForLink(l.getId());
        });
        if (!active.isEmpty()) {
            activity.record("REVOKED", "Access links", "Revoked all " + active.size() + " working access link" + (active.size() == 1 ? "" : "s"));
        }
        return active.size();
    }

    /** Removes a link that no longer works from the list (what was recorded with it stays). */
    @Transactional
    public void delete(Long id) {
        AccessLink link = require(id);
        if (link.isActive(LocalDateTime.now())) {
            throw new BusinessException("Revoke the link first");
        }
        links.delete(link);
    }

    /** The link behind a token, if it still works. */
    public AccessLink active(String token) {
        if (token == null || token.isBlank()) {
            throw new BusinessException("This link is not valid");
        }
        AccessLink link = links.findByTokenHash(hash(token.trim()))
                .orElseThrow(() -> new BusinessException("This link is not valid"));
        if (link.getRevokedAt() != null) {
            throw new BusinessException("This link was switched off by the administrator");
        }
        if (!link.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BusinessException("This link has expired. Ask for a new one.");
        }
        return link;
    }

    /** Counts a use of the link. */
    @Transactional
    public void touch(AccessLink link) {
        link.setLastUsedAt(LocalDateTime.now());
        link.setUseCount((link.getUseCount() == null ? 0 : link.getUseCount()) + 1);
        links.save(link);
    }

    private AccessLink require(Long id) {
        return links.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Access link", id));
    }

    private LinkView toView(AccessLink l) {
        LocalDateTime now = LocalDateTime.now();
        String status = l.getRevokedAt() != null ? "REVOKED" : l.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        long open = "ACTIVE".equals(status) ? sessions.findByLinkId(l.getId()).stream().filter(s -> s.getExpiresAt().isAfter(now)).count() : 0;
        long waiting = pending.findByTenantId(l.getTenantId()).stream()
                .filter(p -> l.getId().equals(p.getLinkId()) && PendingEntry.PENDING.equals(p.getStatus())).count();
        return new LinkView(l.getId(), l.getLabel(), Feature.parse(l.getFeatures(), EnumSet.noneOf(Feature.class)), l.getMode(),
                Boolean.TRUE.equals(l.getApproval()), l.getCreatedByName(), l.getCreatedAt(), l.getExpiresAt(), l.getRevokedAt(),
                l.getRevokedByName(), l.getLastUsedAt(), l.getUseCount() == null ? 0 : l.getUseCount(), status, open, waiting, l.getNote(),
                l.opensDesktop() ? AccessLink.DESKTOP : AccessLink.MOBILE);
    }

    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
