package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.ChitShareRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ChitReceiptService;
import com.aditya.personalbudget.service.ChitReceiptService.CancelRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CreateRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PaperRequest;
import com.aditya.personalbudget.service.ChitReceiptService.Verification;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.ChitShareService;
import com.aditya.personalbudget.service.ChitShareService.ShareRequest;
import com.aditya.personalbudget.service.ChitShareService.Statement;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A chit shared by a link that expires (what is paid, what is left, what it pays out and when, the organizer), and a
 * chit receipt checked from its QR (the number and the code of its signed text).
 */
@SpringBootTest
class ChitShareAndVerifyTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-chit-share-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ChitService chits;
    @Autowired ChitShareService shares;
    @Autowired ChitShareRepository shareRows;
    @Autowired ChitReceiptService receipts;

    private Long bank;
    private Long chitId;

    @BeforeEach
    void setUp() {
        signIn();
        bank = accounts.create(new AccountRequest(null, "Share bank " + System.nanoTime(), AccountType.BANK, "SBI", null, bd(90000),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
        chitId = chits.create(new ChitRequest("Family chit " + System.nanoTime(), "Sri Ram Chits", "T9", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(4), null, null, null, null, null, null, bank, null, null)).chit().id();
    }

    private void signIn() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void aSharedChitShowsWhatIsPaidWhatIsLeftAndWhatItPaysOutUntilTheLinkStops() {
        pay(0);
        pay(1);
        var made = shares.create(chitId, new ShareRequest("Amma", 72, true, "Our chit"));
        assertThat(made.token()).isNotBlank();
        assertThat(made.share().status()).isEqualTo("ACTIVE");

        UserContext.clear();   // opened by someone with only the link
        Statement s = shares.open(made.token());
        assertThat(s.organizer()).isEqualTo("Sri Ram Chits");
        assertThat(s.sharedWith()).isEqualTo("Amma");
        assertThat(s.installmentsPaid()).isEqualTo(2);
        assertThat(s.installmentsPending()).isEqualTo(18);
        assertThat(s.paidIn()).isEqualByComparingTo("10000");
        assertThat(s.receive()).isEqualByComparingTo("110000");   // the chit's value, at the end
        assertThat(s.receiveOn()).isNotNull();
        assertThat(s.stage()).isEqualTo("RUNNING");
        assertThat(s.installments()).hasSize(20);
        assertThat(s.installments().getFirst().status()).isEqualTo("PAID");
        signIn();
        assertThat(shares.list(chitId).getFirst().views()).isEqualTo(1);

        // without the installments: only the totals
        String brief = shares.create(chitId, new ShareRequest(null, 24, false, null)).token();
        UserContext.clear();
        assertThat(shares.open(brief).installments()).isEmpty();
        signIn();

        shares.revoke(chitId, made.share().id());
        UserContext.clear();
        assertThatThrownBy(() -> shares.open(made.token())).isInstanceOf(BusinessException.class).hasMessageContaining("switched off");
        assertThatThrownBy(() -> shares.open("not-a-token")).isInstanceOf(BusinessException.class).hasMessageContaining("not valid");
    }

    @Test
    void theReturnsAreShownOnlyWhenChosenAndExplainTheRates() {
        pay(0);
        pay(1);
        pay(2);
        String plain = shares.create(chitId, new ShareRequest(null, 24, false, null)).token();
        String withReturns = shares.create(chitId, new ShareRequest("Amma", 24, false, null, true)).token();
        assertThat(shares.list(chitId).getFirst().showReturns()).isTrue();
        UserContext.clear();
        assertThat(shares.open(plain).returns()).isNull();

        var s = shares.open(withReturns);
        var r = s.returns();
        assertThat(r).isNotNull();
        // 20 × 5,000 paying 1,10,000: about 0.95% a month, compounding to a little more than 12 × that a year
        assertThat(r.nominalRate()).isPositive();
        assertThat(r.compoundRate()).isGreaterThan(r.nominalRate());
        assertThat(r.simpleRate()).isGreaterThan(r.nominalRate());   // the flat rate on money that sits for less than the term
        assertThat(r.interestAtEnd()).isGreaterThan(r.interestSoFar());
        assertThat(r.valueToday()).isGreaterThanOrEqualTo(s.paidIn());
        assertThat(r.growing()).isTrue();
        assertThat(r.perDay()).isPositive();
        assertThat(r.perMonth()).isGreaterThan(r.perDay());
        assertThat(r.growth()).hasSize(20);
        assertThat(r.growth().getLast().value()).isGreaterThan(r.growth().getLast().paidIn());
        assertThat(r.growth().getLast().simpleValue()).isLessThan(r.growth().getLast().value());
        assertThat(r.vsFd()).isEqualByComparingTo(r.interestAtEnd().subtract(r.fdInterest()));
    }

    @Test
    void theLinksOfADeletedChitGoWithIt() {
        shares.create(chitId, new ShareRequest(null, 24, true, null));
        chits.delete(chitId);
        assertThat(shareRows.findByChitId(chitId)).isEmpty();
    }

    @Test
    void aReceiptIsCheckedFromItsQrAndAWithdrawnOneSaysSo() {
        Long installment = pay(0);
        var made = receipts.create(chitId, new CreateRequest(List.of(installment), null, "98765 43210", true, "Mahesh Reddy", "UPI 4411",
                48, false, false)).receipt();
        assertThat(made.verifyCode()).isNull();   // nothing to check before it is signed
        var signed = receipts.signedOnPaper(chitId, made.id(), new PaperRequest("Ram Kumar", LocalDate.now()));
        String code = signed.verifyCode();
        assertThat(code).isEqualTo(ChitReceiptService.verifyCode(signed.evidencePayload())).hasSize(43);

        UserContext.clear();   // checked by anyone holding the paper
        Verification v = receipts.verify(signed.ackNo(), code);
        assertThat(v.result()).isEqualTo("GENUINE");
        assertThat(v.signatureValid()).isTrue();
        assertThat(v.onPaper()).isTrue();
        assertThat(v.evidencePayload()).isEqualTo(signed.evidencePayload());
        assertThat(v.totalAmount()).isEqualByComparingTo("5000");
        assertThat(v.installmentNos()).containsExactly(1);
        // a wrong code, or a changed text, finds nothing: records cannot be looked up by number alone
        assertThat(receipts.verify(signed.ackNo(), code.substring(1) + "A").result()).isEqualTo("NOT_FOUND");
        assertThat(receipts.verify(signed.ackNo(), null).result()).isEqualTo("NOT_FOUND");
        assertThat(receipts.verify("CR-999999", code).result()).isEqualTo("NOT_FOUND");

        signIn();
        receipts.cancel(chitId, signed.id(), new CancelRequest("Entered twice"));
        UserContext.clear();
        Verification after = receipts.verify(signed.ackNo(), code);
        assertThat(after.result()).isEqualTo("WITHDRAWN");
        assertThat(after.withdrawnReason()).isEqualTo("Entered twice");
    }

    private Long pay(int index) {
        Long id = chits.detail(chitId).installments().get(index).id();
        chits.payInstallment(chitId, id, new PayInstallmentRequest(null, bank, null));
        return id;
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
