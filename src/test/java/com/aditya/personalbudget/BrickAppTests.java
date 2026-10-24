package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.UserDtos.LoginRequest;
import com.aditya.personalbudget.exception.UnauthorizedException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.BrickAppModule;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.SessionRegistry;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AuthService;
import com.aditya.personalbudget.service.BrickAppService;
import com.aditya.personalbudget.service.BrickAppService.PolicyRequest;
import com.aditya.personalbudget.service.BrickAppService.UserRule;
import com.aditya.personalbudget.service.BrickService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The Bricks phone app as the web app sets it up: each role's screens (never more than its permissions open), a user
 * of their own (no app, or screens of their own), the switches for approving and recording on the phone, the calls an
 * app session may make, and signing in to the app.
 */
@SpringBootTest
class BrickAppTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-brick-app-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired BrickService bricks;
    @Autowired BrickAppService app;
    @Autowired AuthService auth;
    @Autowired SessionRegistry sessions;
    @Autowired PasswordEncoder passwords;

    Organization tenant;
    AppUser admin;

    @BeforeEach
    void signIn() {
        admin = users.findByUsername("admin").orElseThrow();
        tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        as(admin, UserRole.ADMIN);
        bricks.start();
        // every test starts from the defaults
        app.save(new PolicyRequest(true, true, true, true, nullRoles(), null));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void aRoleGetsTheScreensItsPermissionsOpenAndNoMore() {
        AppUser acct = staff("acc", "ACCOUNTANT");
        assertThat(app.modulesOf(acct, tenant)).contains(BrickAppModule.ORDERS, BrickAppModule.DELIVERIES, BrickAppModule.PRODUCTION,
                BrickAppModule.PURCHASES, BrickAppModule.STOCK, BrickAppModule.APPROVALS).doesNotContain(BrickAppModule.DASHBOARD, BrickAppModule.TEAM);
        assertThat(app.modulesOf(admin, tenant)).containsAll(List.of(BrickAppModule.values()));

        // the accountant's screens set to orders and the dashboard: the dashboard (the money) is dropped
        app.save(new PolicyRequest(null, null, null, null, Map.of("ACCOUNTANT", List.of("ORDERS", "DASHBOARD")), null));
        assertThat(app.modulesOf(acct, tenant)).containsExactly(BrickAppModule.ORDERS);

        CurrentUser me = as(acct, UserRole.ACCOUNTANT);
        assertThat(app.refusal(me, "GET", "/api/bricks/orders")).isNull();
        assertThat(app.refusal(me, "GET", "/api/bricks/production")).contains("not given");
        assertThat(app.refusal(me, "POST", "/api/bricks/batches")).contains("not given");
        // set-up is done on the web app, for everyone
        assertThat(app.refusal(me, "POST", "/api/bricks/types")).contains("web app");
        assertThat(app.refusal(me, "GET", "/api/bricks/meta")).isNull();
    }

    @Test
    void aUserCanBeLeftOutOrGivenScreensOfTheirOwn() {
        AppUser sales = staff("sal", "SALES");
        app.save(new PolicyRequest(null, null, null, null, null, Map.of(String.valueOf(sales.getId()), new UserRule(null, List.of("DELIVERIES")))));
        assertThat(app.modulesOf(sales, tenant)).containsExactly(BrickAppModule.DELIVERIES);
        app.save(new PolicyRequest(null, null, null, null, null, Map.of(String.valueOf(sales.getId()), new UserRule(false, null))));
        assertThat(app.modulesOf(sales, tenant)).isEmpty();
        assertThat(app.signInRefusal(sales, tenant)).contains("not given to you");
        // back to their role's screens
        app.save(new PolicyRequest(null, null, null, null, null, Map.of(String.valueOf(sales.getId()), new UserRule(null, null))));
        assertThat(app.modulesOf(sales, tenant)).contains(BrickAppModule.ORDERS, BrickAppModule.DELIVERIES, BrickAppModule.PAYMENTS);
        assertThat(app.admin().policy().users()).doesNotContainKey(String.valueOf(sales.getId()));
    }

    @Test
    void theSwitchesLimitWhatThePhoneDoes() {
        CurrentUser me = as(admin, UserRole.ADMIN);
        assertThat(app.refusal(me, "POST", "/api/bricks/approvals/5/approve")).isNull();
        app.save(new PolicyRequest(null, false, false, false, null, null));
        assertThat(app.refusal(me, "POST", "/api/bricks/approvals/5/approve")).contains("Approving on the phone is switched off");
        assertThat(app.refusal(me, "POST", "/api/bricks/orders")).contains("Recording on the phone is switched off");
        assertThat(app.refusal(me, "POST", "/api/attachments")).contains("evidence");
        assertThat(app.refusal(me, "GET", "/api/attachments/3/file")).isNull();
        // a maker still answers what was turned down
        assertThat(app.refusal(me, "POST", "/api/bricks/approvals/5/resubmit")).isNull();
        app.save(new PolicyRequest(false, true, true, true, null, null));
        assertThat(app.refusal(me, "GET", "/api/bricks/orders")).contains("switched off");
        assertThat(app.signInRefusal(admin, tenant)).contains("switched off");
        assertThat(app.profile().modules()).isEmpty();
        assertThat(app.profile().locked()).contains("switched off");
    }

    @Test
    void signingInToTheAppOpensAnAppSession() {
        AppUser sup = staff("sup", "SUPERVISOR");
        sup.setPasswordHash(passwords.encode("Bricks123"));
        users.save(sup);
        UserContext.clear();
        var session = auth.login(new LoginRequest(sup.getUsername(), "Bricks123", "bricks"), "test");
        assertThat(sessions.bricksApp(session.token())).isTrue();
        assertThat(sessions.bricksApp(auth.login(new LoginRequest(sup.getUsername(), "Bricks123"), "test").token())).isFalse();

        as(admin, UserRole.ADMIN);
        app.save(new PolicyRequest(null, null, null, null, null, Map.of(String.valueOf(sup.getId()), new UserRule(false, null))));
        UserContext.clear();
        assertThatThrownBy(() -> auth.login(new LoginRequest(sup.getUsername(), "Bricks123", "bricks"), "test"))
                .isInstanceOf(UnauthorizedException.class).hasMessageContaining("Bricks app");
    }

    @Autowired com.aditya.personalbudget.service.BrickNoticeService notices;

    @Test
    void anOrderTakenOnThePhoneAlertsTheSamePersonOnTheWeb() {
        as(admin, UserRole.ADMIN);
        UserContext.setClient(SessionRegistry.BRICKS_APP);
        notices.post(tenant.getId(), "ORDER", "New order SO-PHONE", "from the phone", "bricks/sales/1", com.aditya.personalbudget.service.BrickNoticeService.ALL);
        UserContext.setClient(null);
        notices.post(tenant.getId(), "ORDER", "New order SO-WEB", "from the web", "bricks/sales/2", com.aditya.personalbudget.service.BrickNoticeService.ALL);
        // on the web: what they did on the phone is news, what they did on the web is not
        assertThat(notices.recent()).extracting(com.aditya.personalbudget.service.BrickNoticeService.NoticeView::title)
                .contains("New order SO-PHONE").doesNotContain("New order SO-WEB");
        // on the phone: neither (they did both themselves)
        UserContext.setClient(SessionRegistry.BRICKS_APP);
        assertThat(notices.recent()).extracting(com.aditya.personalbudget.service.BrickNoticeService.NoticeView::title)
                .doesNotContain("New order SO-PHONE", "New order SO-WEB");
    }

    // ------------------------------------------------------------------ helpers

    private static Map<String, List<String>> nullRoles() {
        Map<String, List<String>> m = new java.util.HashMap<>();
        m.put("ACCOUNTANT", null);
        m.put("SALES", null);
        return m;
    }

    private AppUser staff(String tag, String brickRole) {
        String name = tag + System.nanoTime() % 100000;
        AppUser u = new AppUser();
        u.setTenantId(admin.getTenantId());
        u.setUsername(name);
        u.setFullName("Staff " + name);
        u.setPasswordHash("x");
        u.setRole(UserRole.ACCOUNTANT);
        u.setBrickRole(brickRole);
        u.setActive(true);
        u.setCreatedAt(java.time.LocalDateTime.now());
        return users.save(u);
    }

    private CurrentUser as(AppUser u, UserRole role) {
        CurrentUser c = new CurrentUser(u.getId(), u.getUsername(), u.getFullName(), role, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false);
        UserContext.set(c);
        return c;
    }
}
