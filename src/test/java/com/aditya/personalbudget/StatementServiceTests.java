package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.StatementService;
import com.aditya.personalbudget.service.StatementService.SubscriptionRequest;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.imageio.ImageIO;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.YearMonth;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The monthly statements: each renders as a PDF from the sample books, locks with a password, and subscriptions keep their rules. */
@SpringBootTest
class StatementServiceTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-statement-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "true");
    }

    @Autowired StatementService statements;
    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), admin.getUsername(), admin.getFullName(), admin.getRole(), tenant.getId(), tenant.getCode(),
                tenant.getName(), tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void tearDown() {
        UserContext.clear();
    }

    @Test
    void everyStatementRendersAsAPdfWithItsTitleAndFigures() throws Exception {
        YearMonth month = YearMonth.now().minusMonths(1);
        String out = System.getenv("STATEMENT_PREVIEW_OUT");   // set to a folder to look at the pages as images
        for (StatementService.Kind kind : StatementService.KINDS) {
            StatementService.Rendered r = statements.render(kind.key(), month, List.of(), null);
            assertThat(r.fileName()).endsWith(month + ".pdf");
            assertThat(r.highlights()).isNotEmpty();
            try (PDDocument doc = Loader.loadPDF(r.pdf())) {
                assertThat(doc.getNumberOfPages()).isPositive();
                String text = new PDFTextStripper().getText(doc);
                assertThat(text).contains(kind.label()).contains("Page 1 of " + doc.getNumberOfPages());
                if (out != null) {
                    PDFRenderer renderer = new PDFRenderer(doc);
                    for (int p = 0; p < Math.min(3, doc.getNumberOfPages()); p++) {
                        ImageIO.write(renderer.renderImageWithDPI(p, 80), "png", Path.of(out, kind.key() + "-" + (p + 1) + ".png").toFile());
                    }
                }
            }
        }
        String accounts = new PDFTextStripper().getText(Loader.loadPDF(statements.render("ACCOUNTS", month, List.of(), null).pdf()));
        assertThat(accounts).contains("Account summary").contains("Opening balance").contains("Closing balance").contains("Rs.");
    }

    @Test
    void aProtectedStatementOpensOnlyWithItsPassword() throws Exception {
        byte[] pdf = statements.render("BALANCE_SHEET", YearMonth.now().minusMonths(1), List.of(), "Open-Sesame1").pdf();
        assertThatThrownBy(() -> Loader.loadPDF(pdf)).isInstanceOf(InvalidPasswordException.class);
        try (PDDocument doc = Loader.loadPDF(pdf, "Open-Sesame1")) {
            assertThat(doc.isEncrypted()).isTrue();
            assertThat(new PDFTextStripper().getText(doc)).contains("Balance sheet");
        }
    }

    @Test
    void theCommonProtectionLocksFollowersAndAStatementCanSayOtherwise() {
        var follower = statements.create(new SubscriptionRequest("CHITS", "a@example.com", null, 1, null, null, true, "GLOBAL", null));
        assertThat(follower.protect()).isFalse();
        assertThat(statements.protection().enabled()).isFalse();

        assertThatThrownBy(() -> statements.saveProtection(new StatementService.ProtectionRequest(true, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("common password");
        // always-lock without any password anywhere is refused
        assertThatThrownBy(() -> statements.create(new SubscriptionRequest("CHITS", "a@example.com", null, 1, null, null, true, "ON", null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("password");

        var on = statements.saveProtection(new StatementService.ProtectionRequest(true, "Common-1"));
        assertThat(on.enabled()).isTrue();
        assertThat(on.hasPassword()).isTrue();

        var never = statements.create(new SubscriptionRequest("BALANCE_SHEET", "a@example.com", null, 1, null, null, true, "OFF", null));
        var own = statements.create(new SubscriptionRequest("EMIS", "a@example.com", null, 1, null, "Own-pass1", true, "ON", null));
        var always = statements.create(new SubscriptionRequest("MONEY_OWED", "a@example.com", null, 1, null, null, true, "ON", null));
        var views = statements.overview().subscriptions();
        assertThat(view(views, follower.id()).protect()).isTrue();
        assertThat(view(views, follower.id()).hasPassword()).isFalse();
        assertThat(never.protect()).isFalse();
        assertThat(own.protect()).isTrue();
        assertThat(own.hasPassword()).isTrue();
        assertThat(always.protect()).isTrue();

        // going back to the common password drops its own; turning the common lock off leaves the override locked
        var back = statements.update(own.id(), new SubscriptionRequest("EMIS", "a@example.com", null, 1, null, null, true, "ON", true));
        assertThat(back.hasPassword()).isFalse();
        statements.saveProtection(new StatementService.ProtectionRequest(false, null));
        views = statements.overview().subscriptions();
        assertThat(view(views, follower.id()).protect()).isFalse();
        assertThat(view(views, always.id()).protect()).isTrue();
        assertThat(statements.protection().hasPassword()).isTrue();

        List.of(follower.id(), never.id(), own.id(), always.id()).forEach(statements::delete);
    }

    private static StatementService.SubscriptionView view(List<StatementService.SubscriptionView> views, Long id) {
        return views.stream().filter(v -> v.id().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void subscriptionsCheckTheirAddressesKeepThePasswordAndRecordWhatHappened() {
        assertThatThrownBy(() -> statements.create(new SubscriptionRequest("CHITS", "not-an-address", null, 1, false, null, true)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Not an e-mail address");
        assertThatThrownBy(() -> statements.create(new SubscriptionRequest("CHITS", "me@example.com", null, 1, true, null, true)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("password");
        assertThatThrownBy(() -> statements.create(new SubscriptionRequest("NOPE", "me@example.com", null, 1, false, null, true)))
                .isInstanceOf(BusinessException.class);

        var s = statements.create(new SubscriptionRequest("CHITS", "me@example.com; spouse@example.com", null, 3, true, "Chit-2026", true));
        assertThat(s.recipients()).containsExactly("me@example.com", "spouse@example.com");
        assertThat(s.protect()).isTrue();
        assertThat(s.hasPassword()).isTrue();
        assertThat(statements.overview().subscriptions()).extracting(StatementService.SubscriptionView::id).contains(s.id());

        // no e-mail account in the tests: the attempt is recorded, and the month is not marked as sent (it is retried)
        var result = statements.sendNow(s.id(), null);
        assertThat(result.sent()).isZero();
        assertThat(result.result()).contains("E-mail is not set up");
        var after = statements.overview().subscriptions().stream().filter(x -> x.id().equals(s.id())).findFirst().orElseThrow();
        assertThat(after.lastResult()).contains("Not sent");
        assertThat(after.lastPeriod()).isNull();

        // an edit without a new password keeps the old one
        var edited = statements.update(s.id(), new SubscriptionRequest("CHITS", "me@example.com", null, 5, true, null, false));
        assertThat(edited.hasPassword()).isTrue();
        assertThat(edited.active()).isFalse();
        assertThat(edited.dayOfMonth()).isEqualTo(5);
        statements.delete(s.id());
        assertThat(statements.overview().subscriptions()).extracting(StatementService.SubscriptionView::id).doesNotContain(s.id());
    }
}
