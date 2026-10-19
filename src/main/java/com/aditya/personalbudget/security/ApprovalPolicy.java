package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.service.AppSettingsService;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;

/**
 * Who has to wait for a checker (maker-checker), decided at three levels, the broadest first:
 * <ol>
 *   <li>the installation ({@code approval.enabled}, super admin): off means nobody, anywhere;</li>
 *   <li>the household ({@link Tenant#getApprovalMode()}): {@code OFF} nobody, {@code LINKS} only access links made
 *       with approval (the default), {@code ALL} also every user who cannot approve;</li>
 *   <li>the user ({@link AppUser#getApproval()}): always, never (exempt) or as the household says; and the link
 *       (its "approval" tick).</li>
 * </ol>
 * Users who may approve (and users who cannot record anything) never wait for approval themselves.
 */
@Component
public class ApprovalPolicy {

    public static final String OFF = "OFF";
    public static final String LINKS = "LINKS";
    public static final String ALL = "ALL";
    public static final Set<String> MODES = Set.of(OFF, LINKS, ALL);

    private final AppSettingsService settings;

    public ApprovalPolicy(AppSettingsService settings) {
        this.settings = settings;
    }

    public boolean enabledGlobally() {
        return settings.approvalEnabled();
    }

    /** The household's mode, {@code LINKS} when it never chose one. */
    public static String modeOf(Tenant t) {
        String mode = t == null || t.getApprovalMode() == null ? LINKS : t.getApprovalMode().trim().toUpperCase(Locale.ROOT);
        return MODES.contains(mode) ? mode : LINKS;
    }

    public boolean forLink(AccessLink link, Tenant tenant) {
        return Boolean.TRUE.equals(link.getApproval()) && enabledGlobally() && !OFF.equals(modeOf(tenant));
    }

    public boolean forUser(AppUser user, Tenant tenant) {
        if (!RolePolicy.allows(user.getRole(), Permission.POST_TRANSACTIONS)
                || RolePolicy.allows(user.getRole(), Permission.APPROVE_ENTRIES)
                || !enabledGlobally() || OFF.equals(modeOf(tenant))) {
            return false;
        }
        return user.getApproval() != null ? user.getApproval() : ALL.equals(modeOf(tenant));
    }

    /** "TENANT" (follows the household), "REQUIRED" or "EXEMPT", as the user form shows it. */
    public static String userSetting(AppUser user) {
        return user.getApproval() == null ? "TENANT" : user.getApproval() ? "REQUIRED" : "EXEMPT";
    }
}
