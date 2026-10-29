package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.DeviceKey;
import com.aditya.personalbudget.domain.entity.Organization;
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
import com.aditya.personalbudget.repository.OrganizationRepository;
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
    private final com.aditya.personalbudget.repository.DeviceKeyRepository deviceKeys;
    private final java.security.SecureRandom random = new java.security.SecureRandom();

    private final AppUserRepository users;
    private final OrganizationRepository tenants;
    private final SessionRegistry sessions;
    private final PasswordEncoder passwordEncoder;
    private final TenantProvisioningService provisioning;
    private final int maxFailedLogins;
    private final int lockMinutes;
    private final String defaultPassword;

    public AuthService(AppUserRepository users, OrganizationRepository tenants, SessionRegistry sessions,
                       PasswordEncoder passwordEncoder, TenantProvisioningService provisioning,
                       BudgetProperties properties, AppSettingsService appSettings,
                       AccessLinkService accessLinks, AccessLinkRepository accessLinkRepository, ActivityService activity,
                       ApprovalPolicy approvals, com.aditya.personalbudget.repository.DeviceKeyRepository deviceKeys) {
        this.deviceKeys = deviceKeys;
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
        LocalDateTime now = OrgClock.now();
        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(now)) {
            throw new UnauthorizedException("Too many wrong passwords. Try again after "
                    + OrgClock.toOrg(user.getLockedUntil(), user.getTenantId()).toLocalTime().withSecond(0).withNano(0) + ".");
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
        if (mobile && FeaturePolicy.granted(user, tenants.findById(user.getTenantId()).orElse(null), true).isEmpty()) {
            throw new UnauthorizedException("The mobile version is not shared with you. Ask your admin, or use the full site.");
        }
        Organization tenant = tenants.findById(user.getTenantId()).orElseThrow();
        if (!Boolean.TRUE.equals(tenant.getActive())) {
            throw new UnauthorizedException("Organization '" + tenant.getName() + "' is deactivated");
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
        String timeZone = validTimeZoneOrNone(request.timeZone());
        AppUser admin = provisioning.provision(new TenantProvisioningService.NewTenant(request.tenantCode(), request.tenantName(),
                request.currency(), request.username(), request.fullName(), request.email(), request.password(),
                UserRole.ADMIN));
        if (timeZone != null) {
            Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
            tenant.setTimeZone(timeZone);
            tenants.save(tenant);
        }
        return login(new LoginRequest(request.username(), request.password()), null);
    }

    /** The browser's zone, when the server knows it (an unknown one is simply not used). */
    private static String validTimeZoneOrNone(String timeZone) {
        try {
            return OrgTimeZoneService.valid(timeZone);
        } catch (BusinessException e) {
            return null;
        }
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
        Organization tenant = tenants.findById(user.getTenantId()).orElseThrow();
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
        // a new password: every phone signs in with it once more before its pattern / PIN works again
        deviceKeys.findByUserId(user.getId()).stream().filter(DeviceKey::isActive).forEach(k -> {
            k.setRevokedAt(OrgClock.now());
            deviceKeys.save(k);
        });
        activity.record("CHANGED", "Sign-in", forced ? "Replaced the default password" : "Changed the password");
    }

    // ================================================================== quick unlock on the phone (pattern / PIN)

    /** Turning on quick unlock on this phone: the pattern (dot numbers 0-8, joined by "-") or a 4-6 digit PIN. */
    public record QuickUnlockRequest(@jakarta.validation.constraints.NotBlank String kind, @jakarta.validation.constraints.NotBlank String code,
                                     @jakarta.validation.constraints.Size(max = 60) String deviceName) {
    }

    /** What the phone keeps: the key's id and its secret (shown this once). */
    public record QuickUnlockKey(Long deviceId, String secret, String kind) {
    }

    public record QuickLoginRequest(@jakarta.validation.constraints.NotNull Long deviceId, @jakarta.validation.constraints.NotBlank String secret,
                                    @jakarta.validation.constraints.NotBlank String code) {
    }

    /** Registers this phone's pattern / PIN for the signed-in user. */
    @Transactional
    public QuickUnlockKey enableQuickUnlock(QuickUnlockRequest r) {
        CurrentUser me = UserContext.get();
        if (me.viaLink() || me.userId() == null) {
            throw new BusinessException("Quick unlock needs your own account");
        }
        String kind = r.kind().trim().toUpperCase();
        String code = r.code().trim();
        if (DeviceKey.PIN.equals(kind)) {
            if (!code.matches("\\d{4,6}")) throw new BusinessException("The PIN should have 4 to 6 digits");
            if (code.chars().distinct().count() == 1 || "0123456789".contains(code) || "9876543210".contains(code)) {
                throw new BusinessException("Choose a PIN that is not a repeated or running number");
            }
        } else if (DeviceKey.PATTERN.equals(kind)) {
            String[] dots = code.split("-");
            if (!code.matches("[0-8](-[0-8]){3,8}") || java.util.Arrays.stream(dots).distinct().count() != dots.length) {
                throw new BusinessException("Connect at least 4 dots");
            }
        } else {
            throw new BusinessException("Choose a pattern or a PIN");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String secret = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        DeviceKey k = new DeviceKey();
        k.setTenantId(me.tenantId());
        k.setUserId(me.userId());
        k.setKind(kind);
        k.setDeviceName(r.deviceName() == null || r.deviceName().isBlank() ? null : ActivityService.cut(r.deviceName().trim(), 60));
        k.setSecretHash(AccessLinkService.hash(secret));
        k.setCodeHash(passwordEncoder.encode(code));
        k.setCreatedAt(OrgClock.now());
        k.setFailedAttempts(0);
        k = deviceKeys.save(k);
        activity.record("CHANGED", "Sign-in", "Turned on quick unlock (" + (DeviceKey.PIN.equals(kind) ? "PIN" : "pattern") + ") on "
                + (k.getDeviceName() == null ? "a phone" : k.getDeviceName()));
        return new QuickUnlockKey(k.getId(), secret, kind);
    }

    /** Signs in on the phone with its secret and the pattern / PIN; five wrong tries in a row switch the key off. */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public SessionView quickLogin(QuickLoginRequest r, String userAgent) {
        String off = "Quick unlock is off on this phone. Sign in with your password";
        DeviceKey k = deviceKeys.findById(r.deviceId()).orElseThrow(() -> new UnauthorizedException(off));
        if (!k.isActive() || !AccessLinkService.hash(r.secret().trim()).equals(k.getSecretHash())) {
            throw new UnauthorizedException(off);
        }
        if (!passwordEncoder.matches(r.code().trim(), k.getCodeHash())) {
            int failed = (k.getFailedAttempts() == null ? 0 : k.getFailedAttempts()) + 1;
            k.setFailedAttempts(failed);
            if (failed >= DeviceKey.MAX_FAILED) k.setRevokedAt(OrgClock.now());
            deviceKeys.save(k);
            throw new UnauthorizedException(failed >= DeviceKey.MAX_FAILED ? "Too many wrong tries: quick unlock is off. Sign in with your password"
                    : "Wrong " + (DeviceKey.PIN.equals(k.getKind()) ? "PIN" : "pattern") + " (" + (DeviceKey.MAX_FAILED - failed) + " left)");
        }
        AppUser user = users.findById(k.getUserId()).orElseThrow(() -> new UnauthorizedException("User removed"));
        if (!Boolean.TRUE.equals(user.getActive())) {
            throw new UnauthorizedException("This user is deactivated");
        }
        Organization tenant = tenants.findById(user.getTenantId()).orElseThrow();
        if (!Boolean.TRUE.equals(tenant.getActive())) {
            throw new UnauthorizedException("Organization '" + tenant.getName() + "' is deactivated");
        }
        if (FeaturePolicy.granted(user, tenant, true).isEmpty()) {
            throw new UnauthorizedException("The mobile version is not shared with you. Ask your admin, or use the full site.");
        }
        LocalDateTime now = OrgClock.now();
        k.setFailedAttempts(0);
        k.setLastUsedAt(now);
        deviceKeys.save(k);
        user.setLastLoginAt(now);
        user = users.save(user);
        String token = sessions.open(user, userAgent, true);
        activity.record(SessionRegistry.toCurrent(user, tenant, true), "SIGNED_IN", "Sign-in",
                "Signed in on the mobile app with " + (DeviceKey.PIN.equals(k.getKind()) ? "a PIN" : "a pattern"), null, null);
        return new SessionView(token, toMe(user, tenant, true));
    }

    /** Switches quick unlock off for a phone of the signed-in user. */
    @Transactional
    public void disableQuickUnlock(Long deviceId) {
        CurrentUser me = UserContext.get();
        deviceKeys.findById(deviceId).filter(k -> k.getUserId().equals(me.userId()) && k.isActive()).ifPresent(k -> {
            k.setRevokedAt(OrgClock.now());
            deviceKeys.save(k);
            activity.record("CHANGED", "Sign-in", "Turned off quick unlock on " + (k.getDeviceName() == null ? "a phone" : k.getDeviceName()));
        });
    }


    private MeView toMe(AppUser user, Organization tenant, boolean mobile) {
        return new MeView(user.getId(), user.getUsername(), user.getFullName(), user.getEmail(), user.getRole(),
                user.getRole().getLabel(), tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(),
                RolePolicy.permissionsOf(user.getRole()), true,
                FeaturePolicy.granted(user, tenant, mobile), mobile, !Boolean.FALSE.equals(user.getMobileAccess()),
                FeaturePolicy.granted(user, tenant, true), appSettings.get().mobilePath(), null, null, approvals.forUser(user, tenant), null,
                Boolean.TRUE.equals(user.getMustChangePassword()), OrgClock.zoneOf(tenant.getId()).getId());
    }

    /** Someone opened an access link: a session with only what the link allows. */
    @Transactional
    public SessionView loginWithLink(String token, String userAgent) {
        AccessLink link = accessLinks.active(token);
        AppUser maker = users.findById(link.getCreatedById()).filter(u -> Boolean.TRUE.equals(u.getActive()))
                .orElseThrow(() -> new UnauthorizedException("This link is no longer valid"));
        Organization tenant = tenants.findById(maker.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
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
                link.getId(), link.getMode(), c.approval(), link.getExpiresAt(), false, OrgClock.zoneOf(c.tenantId()).getId());
    }
}
