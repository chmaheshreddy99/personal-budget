package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.BrickSettings;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.entity.UserSession;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.repository.UserSessionRepository;
import com.aditya.personalbudget.security.BrickAccess;
import com.aditya.personalbudget.security.BrickAppModule;
import com.aditya.personalbudget.security.BrickPermission;
import com.aditya.personalbudget.security.BrickRole;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.FeaturePolicy;
import com.aditya.personalbudget.security.SessionRegistry;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * The Bricks phone app ({@code bricks-app/}), as the web app sets it up (Settings → Bricks app):
 * <ul>
 *   <li>on or off for the business, and what may be done on the phone: approve or reject requests, record (orders,
 *       batches, purchases, payments, delivery steps), add evidence (photos of bills, the customer's message …);</li>
 *   <li>the screens ({@link BrickAppModule}) each role gets, never more than its permissions open;</li>
 *   <li>for a user on their own: no app at all, or screens of their own instead of their role's.</li>
 * </ul>
 * The app signs in as {@code client: "bricks"} and shows only the screens it is given ({@link #profile}); every call it
 * makes is checked against them ({@link #refusal}), on top of the user's role in Brick Management. A change made here
 * takes effect at the app's very next call.
 */
@Service
public class BrickAppService {

    /** As kept (JSON in {@link BrickSettings#getMobileApp()}). roles: role → screens (missing: every screen the role opens). */
    public record Policy(boolean enabled, boolean decide, boolean record, boolean evidence, Map<String, List<String>> roles,
                         Map<String, UserRule> users) {
    }

    /** One user: access false = no app; modules = their own screens (null: their role's). */
    public record UserRule(Boolean access, List<String> modules) {
    }

    public record PolicyRequest(Boolean enabled, Boolean decide, Boolean record, Boolean evidence, Map<String, List<String>> roles,
                                Map<String, UserRule> users) {
    }

    public record ModuleView(String key, String label, String description, Set<BrickPermission> opens) {
    }

    /** A role: the screens it could have (its permissions open them) and those it has. */
    public record RoleView(String key, String label, String description, Set<BrickPermission> permissions, List<String> possible,
                           List<String> modules, boolean custom) {
    }

    public record PersonView(Long userId, String fullName, String username, String role, String roleLabel, boolean active,
                             /* Brick Management is shared with them (without it there is no app) */
                             boolean bricks, boolean access, List<String> custom, List<String> modules, LocalDateTime appSignedInAt) {
    }

    /** The set-up screen on the web app. */
    public record Admin(Policy policy, List<ModuleView> modules, List<RoleView> roles, List<PersonView> people) {
    }

    /** What the app shows the signed-in user: their screens, what they may do there, and what waits for them. */
    public record Profile(Long userId, String fullName, String username, String organization, String company, String companyPhone,
                          String currency, String role, String roleLabel, Set<BrickPermission> permissions, List<String> modules,
                          boolean decide, boolean record, boolean evidence, long pendingApprovals, int unreadNotices,
                          /* why there are no screens (switched off, not given), when there are none */
                          String locked, LocalDateTime serverTime,
                          /* the organization's company name and logo (an address on the server), as the web app shows them */
                          String brandName, String brandLogo) {
    }

    private static final Policy DEFAULT = new Policy(true, true, true, true, Map.of(), Map.of());

    private final BrickService core;
    private final BrickAccess access;
    private final AppUserRepository users;
    private final OrganizationRepository tenants;
    private final UserSessionRepository sessions;
    private final BrickApprovalService approvals;
    private final BrickNoticeService notices;
    private final ObjectMapper json;

    public BrickAppService(BrickService core, BrickAccess access, AppUserRepository users, OrganizationRepository tenants,
                           UserSessionRepository sessions, @Lazy BrickApprovalService approvals, @Lazy BrickNoticeService notices, ObjectMapper json) {
        this.core = core;
        this.access = access;
        this.users = users;
        this.tenants = tenants;
        this.sessions = sessions;
        this.approvals = approvals;
        this.notices = notices;
        this.json = json;
    }

    // ================================================================== the policy

    public Policy policy(Long tenantId) {
        String kept = core.settingsRepo().findByTenantId(tenantId).stream().findFirst().map(BrickSettings::getMobileApp).orElse(null);
        if (kept == null || kept.isBlank()) return DEFAULT;
        try {
            Policy p = json.readValue(kept, Policy.class);
            return new Policy(p.enabled(), p.decide(), p.record(), p.evidence(), p.roles() == null ? Map.of() : p.roles(),
                    p.users() == null ? Map.of() : p.users());
        } catch (RuntimeException e) {
            return DEFAULT;
        }
    }

    /** The screens a role gets: as set, else every screen its permissions open; never one they do not. */
    static Set<BrickAppModule> roleModules(Policy p, BrickRole role) {
        List<String> set = p.roles().get(role.name());
        Set<BrickAppModule> out = set == null ? BrickAppModule.openTo(role) : parse(set);
        out.removeIf(m -> !m.opensFor(role));
        return out;
    }

    /** The screens this user has on the app (none: no app for them). */
    public Set<BrickAppModule> modulesOf(AppUser u, Organization tenant) {
        return modulesOf(u, tenant, policy(u.getTenantId()));
    }

    private Set<BrickAppModule> modulesOf(AppUser u, Organization tenant, Policy p) {
        Set<BrickAppModule> none = EnumSet.noneOf(BrickAppModule.class);
        if (!p.enabled() || !Boolean.TRUE.equals(u.getActive())) return none;
        if (!FeaturePolicy.granted(u, tenant, false).contains(Feature.BRICKS)) return none;
        BrickRole role = access.roleOf(u);
        UserRule rule = p.users().get(String.valueOf(u.getId()));
        if (rule != null && Boolean.FALSE.equals(rule.access())) return none;
        Set<BrickAppModule> out = rule != null && rule.modules() != null ? parse(rule.modules()) : roleModules(p, role);
        out.removeIf(m -> !m.opensFor(role));
        return out;
    }

    /** Why this user cannot sign in to the app (null: they can). Read before anyone is signed in, so nothing here uses the request's user. */
    public String signInRefusal(AppUser u, Organization tenant) {
        if (!FeaturePolicy.granted(u, tenant, false).contains(Feature.BRICKS)) {
            return "Brick Management is not shared with you. Ask your admin.";
        }
        Policy p = policy(u.getTenantId());
        if (!p.enabled()) return "The Bricks app is switched off for " + tenant.getName() + ". An admin turns it on in the web app: Settings → Bricks app.";
        if (modulesOf(u, tenant, p).isEmpty()) return "The Bricks app is not given to you. Ask your admin (web app: Settings → Bricks app).";
        return null;
    }

    // ================================================================== what the app may call

    /**
     * Why the Bricks app may not make this call (null: it may). Its session reaches Brick Management only (with sign-in,
     * the live updates and evidence), and in it only the screens granted, and what the policy lets the phone do.
     */
    public String refusal(CurrentUser me, String method, String uri) {
        String path = uri.startsWith("/api/") ? uri.substring(4) : uri;
        if (path.startsWith("/auth/") || path.startsWith("/meta/") || path.equals("/bricks/app/profile")) return null;
        AppUser u = users.findById(me.userId()).orElse(null);
        Organization t = tenants.findById(me.tenantId()).orElse(null);
        if (u == null || t == null) return "Please sign in again";
        Policy p = policy(me.tenantId());
        Set<BrickAppModule> mine = modulesOf(u, t, p);
        if (mine.isEmpty()) return p.enabled() ? "The Bricks app is no longer given to you" : "The Bricks app was switched off";
        if (path.equals("/events")) return null;
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        if (path.startsWith("/attachments")) {
            return read || p.evidence() ? null : "Adding evidence on the phone is switched off: use the web app";
        }
        if (!read && !p.record() && !path.startsWith("/bricks/approvals/") && !path.startsWith("/bricks/notices")) {
            return "Recording on the phone is switched off: use the web app";
        }
        if (path.matches("/bricks/approvals/\\d+/(approve|reject)") && !p.decide()) {
            return "Approving on the phone is switched off: decide on the web app";
        }
        Set<BrickAppModule> needed = needed(read, path);
        if (needed == null) return "This is done on the web app";
        if (!needed.isEmpty() && needed.stream().noneMatch(mine::contains)) return "That screen is not given to you in the Bricks app";
        return null;
    }

    /** The screens (any one) a call belongs to; empty: every screen needs it; null: not on the app (set-up is done on the web). */
    static Set<BrickAppModule> needed(boolean read, String path) {
        if (path.equals("/bricks/access") || path.equals("/bricks/meta") || path.equals("/bricks/money-accounts") || path.startsWith("/bricks/entries/")) {
            return read ? EnumSet.noneOf(BrickAppModule.class) : null;
        }
        if (path.startsWith("/bricks/notices")) return EnumSet.of(BrickAppModule.ALERTS);
        if (path.startsWith("/bricks/approvals")) return EnumSet.of(BrickAppModule.APPROVALS);
        if (path.equals("/bricks/dashboard")) return EnumSet.of(BrickAppModule.DASHBOARD);
        if (path.equals("/bricks/report")) return EnumSet.of(BrickAppModule.REPORTS);
        if (path.startsWith("/bricks/book")) return read ? EnumSet.of(BrickAppModule.CASHBOOK) : null;
        if (path.startsWith("/bricks/payroll") || path.matches("/bricks/resources/\\d+/history")) return EnumSet.of(BrickAppModule.TEAM);
        if (path.equals("/bricks/production")) {
            return EnumSet.of(BrickAppModule.STOCK, BrickAppModule.PRODUCTION, BrickAppModule.PURCHASES, BrickAppModule.DASHBOARD);
        }
        if (path.startsWith("/bricks/batches")) return EnumSet.of(BrickAppModule.PRODUCTION);
        if (path.startsWith("/bricks/purchases") || path.startsWith("/bricks/expenses") || path.equals("/bricks/expense-heads")) {
            return EnumSet.of(BrickAppModule.PURCHASES);
        }
        if (path.equals("/bricks/materials/recount")) return EnumSet.of(BrickAppModule.PRODUCTION, BrickAppModule.PURCHASES);
        if (path.matches("/bricks/vehicles/\\d+/trips")) return EnumSet.of(BrickAppModule.DELIVERIES, BrickAppModule.ORDERS);
        if (path.equals("/bricks/customers")) return EnumSet.of(BrickAppModule.ORDERS, BrickAppModule.PAYMENTS);
        if (path.startsWith("/bricks/orders")) {
            if (read) return EnumSet.of(BrickAppModule.ORDERS, BrickAppModule.DELIVERIES, BrickAppModule.PAYMENTS, BrickAppModule.APPROVALS);
            if (path.matches("/bricks/orders/\\d+/trips(/.*)?")) return EnumSet.of(BrickAppModule.DELIVERIES, BrickAppModule.ORDERS);
            if (path.matches("/bricks/orders/\\d+/payments(/.*)?")) return EnumSet.of(BrickAppModule.PAYMENTS, BrickAppModule.ORDERS);
            return EnumSet.of(BrickAppModule.ORDERS);
        }
        return null;
    }

    // ================================================================== the app's own calls

    public Profile profile() {
        CurrentUser me = UserContext.get();
        AppUser u = users.findById(me.userId()).orElseThrow();
        Organization t = tenants.findById(me.tenantId()).orElseThrow();
        Policy p = policy(me.tenantId());
        Set<BrickAppModule> mine = modulesOf(u, t, p);
        BrickRole role = access.roleOf(u);
        String locked = null;
        if (mine.isEmpty()) locked = signInRefusal(u, t);
        long waiting = mine.contains(BrickAppModule.APPROVALS) && (role.allows(BrickPermission.SALES) || role.allows(BrickPermission.APPROVE))
                ? approvals.pendingCount() : 0;
        int unread = mine.contains(BrickAppModule.ALERTS) ? notices.recent().size() : 0;
        BrickService.Company company = core.company();
        return new Profile(u.getId(), u.getFullName(), u.getUsername(), t.getName(), company.name(), company.phone(), t.getCurrency(),
                role.name(), role.getLabel(), role.getPermissions(), names(mine), p.decide() && role.allows(BrickPermission.APPROVE),
                p.record(), p.evidence(), waiting, unread, locked, LocalDateTime.now(),
                OrganizationBrandService.name(t), OrganizationBrandService.logoUrl(t));
    }

    // ================================================================== the set-up (web app)

    public Admin admin() {
        Long tenantId = UserContext.tenantId();
        Organization t = tenants.findById(tenantId).orElseThrow();
        Policy p = policy(tenantId);
        List<ModuleView> modules = Arrays.stream(BrickAppModule.values()).map(m -> new ModuleView(m.name(), m.getLabel(), m.getDescription(), m.getOpens())).toList();
        List<RoleView> roles = Arrays.stream(BrickRole.values()).filter(r -> r != BrickRole.NONE)
                .map(r -> new RoleView(r.name(), r.getLabel(), r.getDescription(), r.getPermissions(), names(BrickAppModule.openTo(r)),
                        names(roleModules(p, r)), p.roles().containsKey(r.name()))).toList();
        List<PersonView> people = users.findByTenantId(tenantId).stream().sorted(Comparator.comparing(AppUser::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(u -> person(u, t, p)).toList();
        return new Admin(p, modules, roles, people);
    }

    private PersonView person(AppUser u, Organization t, Policy p) {
        BrickRole role = access.roleOf(u);
        UserRule rule = p.users().get(String.valueOf(u.getId()));
        LocalDateTime seen = sessions.findByUserId(u.getId()).stream().filter(s -> SessionRegistry.BRICKS_APP.equals(s.getClient()))
                .map(UserSession::getCreatedAt).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
        return new PersonView(u.getId(), u.getFullName(), u.getUsername(), role.name(), role.getLabel(), Boolean.TRUE.equals(u.getActive()),
                FeaturePolicy.granted(u, t, false).contains(Feature.BRICKS), rule == null || !Boolean.FALSE.equals(rule.access()),
                rule == null || rule.modules() == null ? null : names(parse(rule.modules())), names(modulesOf(u, t, p)), seen);
    }

    /** Saves the set-up: what is left out of the request stays as it was; screens a role cannot open are dropped. */
    @Transactional
    public Admin save(PolicyRequest r) {
        if (r == null) throw new BusinessException("Nothing to save");
        Long tenantId = UserContext.tenantId();
        Policy was = policy(tenantId);
        Map<String, List<String>> roles = new LinkedHashMap<>(was.roles());
        if (r.roles() != null) {
            r.roles().forEach((k, v) -> {
                BrickRole role = BrickRole.parse(k);
                if (role == null || role == BrickRole.NONE) throw new BusinessException("Unknown role " + k);
                if (v == null) roles.remove(role.name());
                else roles.put(role.name(), names(parse(v).stream().filter(m -> m.opensFor(role)).toList()));
            });
        }
        Map<String, UserRule> people = new LinkedHashMap<>(was.users());
        if (r.users() != null) {
            r.users().forEach((k, v) -> {
                Long id;
                try {
                    id = Long.valueOf(k);
                } catch (NumberFormatException e) {
                    throw new BusinessException("Unknown user " + k);
                }
                AppUser u = users.findByIdAndTenantId(id, tenantId).orElseThrow(() -> new BusinessException("Unknown user " + k));
                boolean off = v != null && Boolean.FALSE.equals(v.access());
                List<String> own = v == null || v.modules() == null ? null : names(parse(v.modules()));
                if (!off && own == null) people.remove(String.valueOf(u.getId()));   // as their role: nothing to keep
                else people.put(String.valueOf(u.getId()), new UserRule(off ? Boolean.FALSE : null, own));
            });
        }
        Policy next = new Policy(r.enabled() == null ? was.enabled() : r.enabled(), r.decide() == null ? was.decide() : r.decide(),
                r.record() == null ? was.record() : r.record(), r.evidence() == null ? was.evidence() : r.evidence(), roles, people);
        core.ensureDefaults();
        BrickSettings s = core.settings();
        s.setMobileApp(json.writeValueAsString(next));
        core.settingsRepo().save(s);
        core.note("CHANGED", "Bricks app: " + describe(was, next));
        return admin();
    }

    /** "switched on · approving on the phone off · Accountant's screens" … for the activity log. */
    private static String describe(Policy a, Policy b) {
        List<String> out = new ArrayList<>();
        if (a.enabled() != b.enabled()) out.add(b.enabled() ? "switched on" : "switched off");
        if (a.decide() != b.decide()) out.add("approving on the phone " + (b.decide() ? "on" : "off"));
        if (a.record() != b.record()) out.add("recording on the phone " + (b.record() ? "on" : "off"));
        if (a.evidence() != b.evidence()) out.add("evidence on the phone " + (b.evidence() ? "on" : "off"));
        for (BrickRole r : BrickRole.values()) {
            if (!Objects.equals(a.roles().get(r.name()), b.roles().get(r.name()))) out.add(r.getLabel() + "'s screens");
        }
        if (!a.users().equals(b.users())) out.add("users' access");
        return out.isEmpty() ? "saved, nothing changed" : String.join(" · ", out);
    }

    private static Set<BrickAppModule> parse(List<String> names) {
        Set<BrickAppModule> out = EnumSet.noneOf(BrickAppModule.class);
        if (names != null) names.stream().map(BrickAppModule::parse).filter(Objects::nonNull).forEach(out::add);
        return out;
    }

    private static List<String> names(java.util.Collection<BrickAppModule> modules) {
        return modules.stream().sorted().map(Enum::name).toList();
    }
}
