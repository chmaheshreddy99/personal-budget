package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.UserDtos.LoginRequest;
import com.aditya.personalbudget.dto.UserDtos.MeView;
import com.aditya.personalbudget.dto.UserDtos.PasswordChangeRequest;
import com.aditya.personalbudget.dto.UserDtos.RegisterRequest;
import com.aditya.personalbudget.dto.UserDtos.SessionView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.UnauthorizedException;
import com.aditya.personalbudget.repository.AccessLinkRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.FeaturePolicy;
import com.aditya.personalbudget.security.RolePolicy;
import com.aditya.personalbudget.security.ApprovalPolicy;
import com.aditya.personalbudget.security.SessionRegistry;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * Sign-in, sign-up, sign-out and password changes.
 */
@Service
public class AuthService {

    private final AppSettingsService appSettings;
    private final AccessLinkService accessLinks;
    private final AccessLinkRepository accessLinkRepository;
    private final ActivityService activity;
    private final ApprovalPolicy approvals;

    private final AppUserRepository users;
    private final TenantRepository tenants;
    private final SessionRegistry sessions;
    private final PasswordEncoder passwordEncoder;
    private final TenantProvisioningService provisioning;
    private final int maxFailedLogins;
    private final int lockMinutes;
    private final String defaultPassword;

    public AuthService(AppUserRepository users, TenantRepository tenants, SessionRegistry sessions,
                       PasswordEncoder passwordEncoder, TenantProvisioningService provisioning,
                       BudgetProperties properties, AppSettingsService appSettings,
                       AccessLinkService accessLinks, AccessLinkRepository accessLinkRepository, ActivityService activity,
                       ApprovalPolicy approvals) {
        this.approvals = approvals;
        this.accessLinks = accessLinks;
        this.accessLinkRepository = accessLinkRepository;
        this.activity = activity;
        this.appSettings = appSettings;
        this.users = users;
        this.tenants = tenants;
        this.sessions = sessions;
        this.passwordEncoder = passwordEncoder;
        this.provisioning = provisioning;
        this.maxFailedLogins = properties.security().maxFailedLogins() > 0 ? properties.security().maxFailedLogins() : 5;
        this.lockMinutes = properties.security().lockMinutes() > 0 ? properties.security().lockMinutes() : 10;
        this.defaultPassword = properties.seed() == null ? null : properties.seed().adminPassword();
    }

    /**
     * Signs in. After {@code maxFailedLogins} wrong passwords in a row the user is locked for
     * {@code lockMinutes}; the message never tells whether the username exists.
     */
    @Transactional(noRollbackFor = UnauthorizedException.class)   // keep the failed-attempt count
    public SessionView login(LoginRequest request, String userAgent) {
        AppUser user = users.findByUsername(request.username().trim())
                .orElseThrow(() -> new UnauthorizedException("Invalid username or password"));
        LocalDateTime now = LocalDateTime.now();
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new UnauthorizedException("Too many wrong passwords. Try again after "
                    + user.getLockedUntil().toLocalTime().withNano(0) + ".");
        }
        if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            int failed = (user.getFailedLogins() == null ? 0 : user.getFailedLogins()) + 1;
            user.setFailedLogins(failed);
            if (failed >= maxFailedLogins) {
                user.setLockedUntil(now.plusMinutes(lockMinutes));
                user.setFailedLogins(0);
            }
            users.save(user);
            throw new UnauthorizedException("Invalid username or password");
        }
        if (!Boolean.TRUE.equals(user.getActive())) {
            throw new UnauthorizedException("This user is deactivated");
        }
        boolean mobile = "mobile".equalsIgnoreCase(request.client());
        if (mobile && FeaturePolicy.granted(user, true).isEmpty()) {
            throw new UnauthorizedException("The mobile version is not shared with you. Ask your admin, or use the full site.");
        }
        Tenant tenant = tenants.findById(user.getTenantId()).orElseThrow();
        if (!Boolean.TRUE.equals(tenant.getActive())) {
            throw new UnauthorizedException("Tenant '" + tenant.getName() + "' is deactivated");
        }
        user.setLastLoginAt(now);
        user.setFailedLogins(0);
        user.setLockedUntil(null);
        if (defaultPassword != null && !defaultPassword.isBlank() && request.password().equals(defaultPassword)) {
            user.setMustChangePassword(true);   // still the well-known default: a new password first
        }
        user = users.save(user);

        String token = sessions.open(user, userAgent, mobile);
        activity.record(SessionRegistry.toCurrent(user, tenant, mobile), "SIGNED_IN", "Sign-in",
                mobile ? "Signed in on the mobile version" : "Signed in", null, null);
        return new SessionView(token, toMe(user, tenant, mobile));
    }

    public SessionView register(RegisterRequest request) {
        provisioning.provision(new TenantProvisioningService.NewTenant(request.tenantCode(), request.tenantName(),
                request.currency(), request.username(), request.fullName(), request.email(), request.password(),
                UserRole.ADMIN));
        return login(new LoginRequest(request.username(), request.password()), null);
    }

    public void logout(String token) {
        sessions.close(token);
    }

    public MeView me() {
        CurrentUser current = UserContext.get();
        if (current.viaLink()) {
            return linkMe(current, accessLinkRepository.findById(current.linkId()).orElseThrow(() -> new UnauthorizedException("Link removed")));
        }
        AppUser user = users.findById(current.userId()).orElseThrow(() -> new UnauthorizedException("User removed"));
        Tenant tenant = tenants.findById(user.getTenantId()).orElseThrow();
        return toMe(user, tenant, current.mobile());
    }

    @Transactional
    public void changePassword(PasswordChangeRequest request) {
        AppUser user = users.findById(UserContext.get().userId()).orElseThrow();
        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw new BusinessException("Current password is incorrect");
        }
        String next = request.newPassword();
        if (next.equals(request.currentPassword())) {
            throw new BusinessException("Choose a password different from the current one");
        }
        if (defaultPassword != null && next.equals(defaultPassword)) {
            throw new BusinessException("The default password cannot be used; choose your own");
        }
        if (next.length() < 8 || !next.matches(".*[A-Za-z].*") || !next.matches(".*\\d.*")) {
            throw new BusinessException("Use at least 8 characters with letters and digits");
        }
        if (next.equalsIgnoreCase(user.getUsername())) {
            throw new BusinessException("The password cannot be your username");
        }
        boolean forced = Boolean.TRUE.equals(user.getMustChangePassword());
        user.setPasswordHash(passwordEncoder.encode(next));
        user.setMustChangePassword(false);
        users.save(user);
        activity.record("CHANGED", "Sign-in", forced ? "Replaced the default password" : "Changed the password");
    }

    private MeView toMe(AppUser user, Tenant tenant, boolean mobile) {
        return new MeView(user.getId(), user.getUsername(), user.getFullName(), user.getEmail(), user.getRole(),
                user.getRole().getLabel(), tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(),
                RolePolicy.permissionsOf(user.getRole()), true,
                FeaturePolicy.granted(user, mobile), mobile, !Boolean.FALSE.equals(user.getMobileAccess()),
                FeaturePolicy.granted(user, true), appSettings.get().mobilePath(), null, null, approvals.forUser(user, tenant), null,
                Boolean.TRUE.equals(user.getMustChangePassword()));
    }

    /** Someone opened an access link: a session with only what the link allows. */
    @Transactional
    public SessionView loginWithLink(String token, String userAgent) {
        AccessLink link = accessLinks.active(token);
        AppUser maker = users.findById(link.getCreatedById()).filter(u -> Boolean.TRUE.equals(u.getActive()))
                .orElseThrow(() -> new UnauthorizedException("This link is no longer valid"));
        Tenant tenant = tenants.findById(maker.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new UnauthorizedException("This link is no longer valid"));
        accessLinks.touch(link);
        String sessionToken = sessions.openForLink(link, userAgent);
        CurrentUser current = SessionRegistry.forLink(link, tenant, approvals.forLink(link, tenant));
        activity.record(current, "OPENED_LINK", "Access links", "Opened the access link", null, null);
        return new SessionView(sessionToken, linkMe(current, link));
    }

    private MeView linkMe(CurrentUser c, AccessLink link) {
        return new MeView(c.userId(), c.username(), c.fullName(), null, c.role(), c.role() == UserRole.VIEWER ? "View only" : "Recorder",
                c.tenantId(), c.tenantCode(), c.tenantName(), c.currency(), RolePolicy.permissionsOf(c.role()), true,
                c.features(), c.mobile(), true, c.features(), appSettings.get().mobilePath(),
                link.getId(), link.getMode(), c.approval(), link.getExpiresAt(), false);
    }
}
