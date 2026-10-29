package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.InstallmentView;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.UnauthorizedException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.FeaturePolicy;
import com.aditya.personalbudget.security.MobilePolicy;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.AppSettingsService;
import com.aditya.personalbudget.service.AuthService;
import com.aditya.personalbudget.service.ChitAckService;
import com.aditya.personalbudget.service.ChitAckService.AcceptRequest;
import com.aditya.personalbudget.service.ChitAckService.LinkRequest;
import com.aditya.personalbudget.service.ChitAckService.OpenRequest;
import com.aditya.personalbudget.service.ChitAckService.ReceiptRequest;
import com.aditya.personalbudget.service.ChitAckService.SettlementRequest;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.OrgPreferencesService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Payment receipts and the payout settlement from a chit's organizer; quick unlock on the phone; the mobile app by
 * role; and the interest lost on money given without interest.
 */
@SpringBootTest
class ChitReceiptAndMobileTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-chit-receipt-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    private static final String SIGN = "M10 10 L200 120 L400 40 L600 200";

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ChitService chits;
    @Autowired ChitAckService acks;
    @Autowired AppSettingsService settings;
    @Autowired AuthService auth;
    @Autowired ClaimService claims;
    @Autowired OrgPreferencesService preferences;

    private Long bank;
    private ChitDetail chit;
    private AppUser admin;
    private Organization tenant;

    @BeforeEach
    void setUp() {
        admin = users.findByUsername("admin").orElseThrow();
        tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        signIn();
        bank = accounts.create(new AccountRequest(null, "Receipt bank " + System.nanoTime(), AccountType.BANK, "SBI", null, bd(100000),
                LocalDate.now().minusMonths(4), null, null, null, null, null, true, null)).id();
        chit = chits.create(new ChitRequest("Receipt chit " + System.nanoTime(), "Sri Ram Chits", "T9", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(3), null, null, null, null, null, null, bank, null, null, "98480 12345"));
    }

    private void signIn() {
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void theOrganizerOpensTheReceiptWithTheirNumberAndSignsIt() {
        assertThat(chit.chit().organizerPhone()).isEqualTo("9848012345");
        List<Long> paid = pay(3);
        var made = acks.createReceipt(id(), new ReceiptRequest(paid, null, null, false, null, "Aditya", null, "Hyderabad", false, 72));
        assertThat(made.ack().ackNo()).startsWith("CR-");
        assertThat(made.ack().amount()).isEqualByComparingTo("15000");
        assertThat(made.ack().schedule()).hasSize(3).allSatisfy(l -> assertThat(l.mode()).isEqualTo("Bank transfer"));
        assertThat(made.ack().terms()).contains("15,000").contains("Chit Funds Act, 1982").contains("Bharatiya Sakshya Adhiniyam");
        String token = made.token();
        UserContext.clear();

        // nothing without the number; a wrong one is counted
        assertThat(acks.open(token, null).step()).isEqualTo("VERIFY");
        var wrong = acks.open(token, new OpenRequest("9000000000"));
        assertThat(wrong.step()).isEqualTo("VERIFY");
        assertThat(wrong.attemptsLeft()).isEqualTo(4);
        var open = acks.open(token, new OpenRequest("+91 98480 12345"));
        assertThat(open.step()).isEqualTo("OPEN");
        assertThat(open.schedule()).hasSize(3);

        var signed = acks.accept(token, new AcceptRequest("9848012345", "Ramesh (Sri Ram Chits)", true, SIGN, null, "{\"ua\":\"test\"}", "by UPI"),
                "10.0.0.7", "JUnit");
        assertThat(signed.step()).isEqualTo("DONE");
        assertThat(signed.status()).isEqualTo("SIGNED");
        assertThat(settings.verifyPayLink(signed.evidencePayload(), signed.digitalSignature())).isTrue();

        signIn();
        assertThat(installments().stream().filter(i -> paid.contains(i.id()))).allSatisfy(i -> {
            assertThat(i.ackNo()).isEqualTo(made.ack().ackNo());
            assertThat(i.ackStatus()).isEqualTo("SIGNED");
        });
        assertThat(chits.detail(id()).chit().receiptsSigned()).isEqualTo(1);
    }

    @Test
    void anInstallmentIsOnOneReceiptAndCannotBeUndoneWhileOnIt() {
        List<Long> paid = pay(2);
        var made = acks.createReceipt(id(), new ReceiptRequest(paid, null, null, false, null, null, null, null, false, null));
        assertThat(made.token()).isNull();   // no link asked for
        assertThatThrownBy(() -> acks.createReceipt(id(), new ReceiptRequest(List.of(paid.getFirst()), null, null, false, null, null, null, null, false, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("already on");
        assertThatThrownBy(() -> chits.undoInstallment(id(), paid.getFirst())).isInstanceOf(BusinessException.class).hasMessageContaining("receipt");
        Long unpaid = installments().stream().filter(i -> !paid.contains(i.id())).findFirst().orElseThrow().id();
        assertThatThrownBy(() -> acks.createReceipt(id(), new ReceiptRequest(List.of(unpaid), null, null, false, null, null, null, null, false, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("not paid");

        acks.delete(id(), made.ack().id());
        chits.undoInstallment(id(), paid.getFirst());   // free again
        assertThat(acks.list(id())).isEmpty();
    }

    @Test
    void aResentSignedReceiptWaitsForANewSignature() {
        List<Long> paid = pay(1);
        var made = acks.createReceipt(id(), new ReceiptRequest(paid, null, null, false, null, null, null, null, false, 24));
        UserContext.clear();
        acks.accept(made.token(), new AcceptRequest("9848012345", "Ramesh", true, SIGN, null, null, null), "1.1.1.1", "JUnit");
        signIn();
        var again = acks.resend(id(), made.ack().id(), new LinkRequest(24, null, false));
        assertThat(again.ack().status()).isEqualTo("PENDING");
        assertThat(again.ack().signature()).isNull();
        assertThat(again.token()).isNotEqualTo(made.token());
        UserContext.clear();
        assertThatThrownBy(() -> acks.open(made.token(), null)).isInstanceOf(BusinessException.class);   // the old link is gone
    }

    @Test
    void theSettlementCancelsTheReceiptsOnceSignedAndDeletingItRestoresThem() {
        List<Long> paid = pay(2);
        var receipt = acks.createReceipt(id(), new ReceiptRequest(paid, null, null, false, null, null, null, null, false, 24));
        UserContext.clear();
        acks.accept(receipt.token(), new AcceptRequest("9848012345", "Ramesh", true, SIGN, null, null, null), "1.1.1.1", "JUnit");
        signIn();

        assertThatThrownBy(() -> acks.createSettlement(id(), new SettlementRequest(null, null, false, null, null, null, null, null, false, 24)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("payout");
        chits.payout(id(), new PayoutRequest(LocalDate.now(), bd(95000), bank));
        var settlement = acks.createSettlement(id(), new SettlementRequest(null, null, false, null, "Aditya", null, "Hyderabad", SIGN, false, 24));
        assertThat(settlement.ack().ackNo()).startsWith("CS-");
        assertThat(settlement.ack().cancels()).extracting(ChitAckService.CancelledReceipt::ackNo).containsExactly(receipt.ack().ackNo());
        assertThat(settlement.ack().terms()).contains("CANCELLATION OF EARLIER RECEIPTS").contains(receipt.ack().ackNo()).contains("95,000");
        assertThatThrownBy(() -> chits.undoPayout(id())).isInstanceOf(BusinessException.class).hasMessageContaining(settlement.ack().ackNo());

        UserContext.clear();
        acks.accept(settlement.token(), new AcceptRequest("9848012345", "Ramesh", true, SIGN, null, null, null), "1.1.1.1", "JUnit");
        signIn();
        assertThat(acks.get(id(), receipt.ack().id()).status()).isEqualTo("CANCELLED");
        assertThat(acks.get(id(), receipt.ack().id()).cancelledByAckNo()).isEqualTo(settlement.ack().ackNo());

        acks.delete(id(), settlement.ack().id());
        assertThat(acks.get(id(), receipt.ack().id()).status()).isEqualTo("SIGNED");
    }

    @Test
    void withoutANumberOnRecordTheNumberTypedIsRecorded() {
        ChitDetail other = chits.create(new ChitRequest("No phone chit " + System.nanoTime(), "Local foreman", null, bd(55000), bd(5000), 10,
                LocalDate.now().minusMonths(1), null, null, null, null, null, null, bank, null, null));
        Long inst = other.installments().getFirst().id();
        chits.payInstallment(other.chit().id(), inst, new PayInstallmentRequest(null, bank, null));
        var made = acks.createReceipt(other.chit().id(), new ReceiptRequest(List.of(inst), null, null, false, null, null, null, null, false, 24));
        UserContext.clear();
        var open = acks.open(made.token(), new OpenRequest("9123456780"));
        assertThat(open.step()).isEqualTo("OPEN");
        assertThat(open.phoneOnRecord()).isFalse();
        acks.accept(made.token(), new AcceptRequest("9123456780", "Local foreman", true, SIGN, null, null, null), "1.1.1.1", "JUnit");
        signIn();
        var ack = acks.get(other.chit().id(), made.ack().id());
        assertThat(ack.acceptedPhone()).isEqualTo("9123456780");
        assertThat(ack.phoneMatches()).isNull();
    }

    @Test
    void quickUnlockSignsInWithTheKeyAndThePatternAndLocksAfterWrongTries() {
        var key = auth.enableQuickUnlock(new AuthService.QuickUnlockRequest("PATTERN", "0-1-2-5-8", "Test phone"));
        UserContext.clear();
        var session = auth.quickLogin(new AuthService.QuickLoginRequest(key.deviceId(), key.secret(), "0-1-2-5-8"), "JUnit");
        assertThat(session.token()).isNotBlank();
        assertThat(session.user().mobile()).isTrue();
        assertThatThrownBy(() -> auth.quickLogin(new AuthService.QuickLoginRequest(key.deviceId(), "wrong-secret", "0-1-2-5-8"), "JUnit"))
                .isInstanceOf(UnauthorizedException.class);
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> auth.quickLogin(new AuthService.QuickLoginRequest(key.deviceId(), key.secret(), "0-3-6-7"), "JUnit"))
                    .isInstanceOf(UnauthorizedException.class);
        }
        assertThatThrownBy(() -> auth.quickLogin(new AuthService.QuickLoginRequest(key.deviceId(), key.secret(), "0-1-2-5-8"), "JUnit"))
                .isInstanceOf(UnauthorizedException.class).hasMessageContaining("password");
        signIn();
        assertThatThrownBy(() -> auth.enableQuickUnlock(new AuthService.QuickUnlockRequest("PIN", "1234", null)))
                .isInstanceOf(BusinessException.class);   // a running number
        assertThatThrownBy(() -> auth.enableQuickUnlock(new AuthService.QuickUnlockRequest("PATTERN", "0-1-2", null)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void theMobilePolicyRoundTripsAndLimitsTheRolesSections() {
        Map<UserRole, MobilePolicy.Rule> rules = new EnumMap<>(MobilePolicy.rules(null));
        rules.put(UserRole.MEMBER, new MobilePolicy.Rule(MobilePolicy.TAP, EnumSet.of(Feature.EXPENSES, Feature.CHITS), true));
        rules.put(UserRole.VIEWER, new MobilePolicy.Rule(MobilePolicy.ALWAYS, EnumSet.noneOf(Feature.class), false));
        String text = MobilePolicy.format(rules);
        Organization org = new Organization();
        org.setMobilePolicy(text);
        assertThat(MobilePolicy.of(org, UserRole.MEMBER).mask()).isEqualTo("TAP");
        assertThat(MobilePolicy.of(org, UserRole.MEMBER).features()).containsExactlyInAnyOrder(Feature.EXPENSES, Feature.CHITS);
        assertThat(MobilePolicy.of(org, UserRole.VIEWER).features()).isEmpty();
        assertThat(MobilePolicy.of(org, UserRole.VIEWER).record()).isFalse();
        assertThat(MobilePolicy.of(org, UserRole.ADMIN)).isEqualTo(MobilePolicy.Rule.open());

        AppUser member = new AppUser();
        member.setRole(UserRole.MEMBER);
        member.setActive(true);
        assertThat(FeaturePolicy.granted(member, org, true)).containsExactlyInAnyOrder(Feature.EXPENSES, Feature.CHITS);
        assertThat(FeaturePolicy.granted(member, org, false)).contains(Feature.ACCOUNTS);   // the desktop is not limited
        assertThat(MobilePolicy.format(MobilePolicy.rules(null))).isNull();
    }

    @Test
    void moneyLentWithoutInterestShowsTheInterestItCostAtTheBenchmark() {
        preferences.saveBenchmark(new OrgPreferencesService.BenchmarkRequest(bd(7.3)));
        var lent = claims.create(new ClaimRequest(ClaimKind.LENT, "Ravi " + System.nanoTime(), "Hand loan", bd(100000),
                LocalDate.now().minusDays(100), null, null, null, bank, null, null, null, null, null, null, null));
        // 1,00,000 × 7.3% × 100 / 365 = 2,000
        assertThat(claims.get(lent.id()).lostInterest()).isEqualByComparingTo("2000");
        assertThat(claims.get(lent.id()).benchmarkBasis()).isEqualTo("set in Settings");
        var withInterest = claims.create(new ClaimRequest(ClaimKind.LENT, "Sita " + System.nanoTime(), "Loan", bd(100000),
                LocalDate.now().minusDays(100), null, bd(12), null, bank, null, null, null, null, null, null, null));
        assertThat(claims.get(withInterest.id()).lostInterest()).isNull();

        preferences.saveBenchmark(new OrgPreferencesService.BenchmarkRequest(null));
        accounts.create(new AccountRequest(null, "Best FD " + System.nanoTime(), AccountType.FIXED_DEPOSIT, "HDFC", null, bd(1000),
                LocalDate.now().minusMonths(1), bd(29.5), null, null, null, null, true, null));
        var b = preferences.benchmark();
        assertThat(b.rate()).isEqualByComparingTo("29.5");
        assertThat(b.basis()).startsWith("best bank rate");
    }

    // ---------------------------------------------------------------- helpers

    private Long id() {
        return chit.chit().id();
    }

    private List<InstallmentView> installments() {
        return chits.detail(id()).installments();
    }

    /** Pays the first n installments; their ids. */
    private List<Long> pay(int n) {
        List<Long> ids = installments().stream().limit(n).map(InstallmentView::id).toList();
        ids.forEach(i -> chits.payInstallment(id(), i, new PayInstallmentRequest(null, bank, null)));
        return ids;
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
