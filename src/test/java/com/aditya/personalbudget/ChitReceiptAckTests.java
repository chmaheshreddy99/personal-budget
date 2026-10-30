package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.ChitReceiptAck;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutReceiptRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.ChitReceiptAckRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ChitReceiptService;
import com.aditya.personalbudget.service.ChitReceiptService.AckRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CancelRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PaperRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CreateRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CreatedLink;
import com.aditya.personalbudget.service.ChitReceiptService.DisputeRequest;
import com.aditya.personalbudget.service.ChitReceiptService.OpenRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PublicAck;
import com.aditya.personalbudget.service.ChitReceiptService.RenewRequest;
import com.aditya.personalbudget.service.AppSettingsService;
import com.aditya.personalbudget.service.ChitService;
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
 * The organizer's acknowledgement of chit installments paid: one or several at once, through a secret link that needs
 * their mobile number, is sealed and signed when they sign, and keeps the installments from being undone.
 */
@SpringBootTest
class ChitReceiptAckTests {

    private static final String SIGN = "M10 10 L200 120 L400 60 L600 200";

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-chit-receipt-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ChitService chits;
    @Autowired ChitReceiptService receipts;
    @Autowired ChitReceiptAckRepository acks;

    private Long bank;
    private ChitDetail chit;
    private Long chitId;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = accounts.create(new AccountRequest(null, "Receipt bank " + System.nanoTime(), AccountType.BANK, "SBI", null, bd(90000),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
        chit = chits.create(new ChitRequest("Receipt chit " + System.nanoTime(), "Sri Ram Chits", "T9", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(4), null, null, null, null, null, null, bank, null, null));
        chitId = chit.chit().id();
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    private Long pay(int index) {
        Long id = chits.detail(chitId).installments().get(index).id();
        chits.payInstallment(chitId, id, new PayInstallmentRequest(null, bank, index == 1 ? bd(400) : null));
        return id;
    }

    private CreateRequest ask(List<Long> ids) {
        return new CreateRequest(ids, null, "98765 43210", true, "Mahesh Reddy", "UPI 4411", 48, false, false);
    }

    @Test
    void severalPaymentsAreAcknowledgedAtOnceWithTheOrganizersNumber() {
        Long a = pay(0), b = pay(1), c = pay(2);
        CreatedLink made = receipts.create(chitId, ask(List.of(c, a, b)));
        assertThat(made.receipt().lines()).extracting(l -> l.no()).containsExactly(1, 2, 3);
        assertThat(made.receipt().totalAmount()).isEqualByComparingTo("14600");   // the second installment had a 400 dividend
        // nothing of this app's own books goes into what the organizer signs: no account names, no entry numbers
        assertThat(made.receipt().lines()).allSatisfy(l -> {
            assertThat(l.paidFrom()).isNull();
            assertThat(l.entryNo()).isNull();
        });
        assertThat(made.receipt().terms()).doesNotContain("Receipt bank");
        assertThat(made.receipt().terms()).contains("Sri Ram Chits").contains("T9").contains("UPI 4411").contains("Information Technology Act");
        assertThat(made.receipt().link()).isEqualTo("ACTIVE");
        assertThat(chits.list().stream().filter(x -> x.id().equals(chitId)).findFirst().orElseThrow().organizerPhone()).isEqualTo("9876543210");
        String token = made.token();

        PublicAck gate = receipts.open(token, null);
        assertThat(gate.step()).isEqualTo("VERIFY");
        assertThat(gate.phoneHint()).isEqualTo("••••••3210");
        assertThat(gate.lines()).isEmpty();
        PublicAck wrong = receipts.open(token, new OpenRequest("9123456780"));
        assertThat(wrong.step()).isEqualTo("VERIFY");
        assertThat(wrong.error()).contains("not the number");
        PublicAck open = receipts.open(token, new OpenRequest("+91 98765 43210"));
        assertThat(open.step()).isEqualTo("OPEN");
        assertThat(open.lines()).hasSize(3);
        assertThat(open.contentHash()).isEqualTo(made.receipt().contentHash());

        assertThatThrownBy(() -> receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", false, SIGN, null, "{}"), "1.2.3.4", "UA"))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Tick the box");
        assertThatThrownBy(() -> receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, "not a path", null, "{}"), "1.2.3.4", "UA"))
                .isInstanceOf(BusinessException.class);

        PublicAck done = receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, "17.38,78.48,20", "{\"ua\":\"x\"}"),
                "1.2.3.4", "UA");
        assertThat(done.step()).isEqualTo("DONE");
        assertThat(done.acknowledgementSeal()).hasSize(64);
        assertThat(done.digitalSignature()).isNotBlank();
        assertThat(done.evidencePayload()).contains("CHIT_RECEIPT_ACKNOWLEDGEMENT").contains("\"installments\":\"1,2,3\"").doesNotContain("9876543210");

        var view = receipts.list(chitId).getFirst();
        assertThat(view.status()).isEqualTo(ChitReceiptAck.ACKNOWLEDGED);
        assertThat(view.acknowledgedIp()).isEqualTo("1.2.3.4");
        assertThat(view.acknowledgedLocation()).isEqualTo("17.38,78.48,20");

        // once signed it is a record
        assertThatThrownBy(() -> receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA"))
                .isInstanceOf(BusinessException.class).hasMessageContaining("already acknowledged");
        assertThatThrownBy(() -> receipts.delete(chitId, view.id())).isInstanceOf(BusinessException.class).hasMessageContaining("record");
        assertThatThrownBy(() -> chits.undoInstallment(chitId, b)).isInstanceOf(BusinessException.class).hasMessageContaining("cannot be undone");
        assertThatThrownBy(() -> receipts.create(chitId, ask(List.of(a)))).isInstanceOf(BusinessException.class).hasMessageContaining("already has");
        // an installment not in it can still be undone, and asked for on its own later
        Long d = pay(3);
        chits.undoInstallment(chitId, d);
    }

    @Test
    void aSimpleReceiptIsThreePlainLinesAndSignsLikeTheFullOne() {
        Long a = pay(0), b = pay(1);
        CreatedLink made = receipts.create(chitId, new CreateRequest(List.of(a, b), null, "98765 43210", false, "Mahesh Reddy", "UPI 4411", 48, false, false, true));
        assertThat(made.receipt().kind()).isEqualTo(ChitReceiptAck.KIND_SIMPLE);
        assertThat(made.receipt().terms()).contains("received").contains("installments 1, 2").contains("UPI 4411")
                .contains("Information Technology Act").doesNotContain("PARTIES").hasLineCount(3);

        String token = made.token();
        PublicAck open = receipts.open(token, new OpenRequest("9876543210"));
        assertThat(open.kind()).isEqualTo(ChitReceiptAck.KIND_SIMPLE);
        PublicAck done = receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA");
        assertThat(done.step()).isEqualTo("DONE");
        assertThat(receipts.list(chitId).getFirst().status()).isEqualTo(ChitReceiptAck.ACKNOWLEDGED);
        assertThatThrownBy(() -> receipts.create(chitId, ask(List.of(a)))).isInstanceOf(BusinessException.class).hasMessageContaining("already has");
    }

    @Test
    void fiveWrongNumbersLockTheLinkAndOnlyPaidInstallmentsCanBeSent() {
        Long a = pay(0);
        Long unpaid = chits.detail(chitId).installments().get(5).id();
        assertThatThrownBy(() -> receipts.create(chitId, ask(List.of(unpaid)))).isInstanceOf(BusinessException.class).hasMessageContaining("not paid");
        assertThatThrownBy(() -> receipts.create(chitId, new CreateRequest(List.of(a), null, "12345", null, "Me", null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("10-digit");

        String token = receipts.create(chitId, ask(List.of(a))).token();
        for (int i = 0; i < 5; i++) receipts.open(token, new OpenRequest("9123456780"));
        assertThatThrownBy(() -> receipts.open(token, new OpenRequest("9876543210"))).isInstanceOf(BusinessException.class).hasMessageContaining("locked");
        assertThat(receipts.list(chitId).getFirst().link()).isEqualTo("LOCKED");

        // a fresh link unlocks it
        String again = receipts.renew(chitId, receipts.list(chitId).getFirst().id(), new RenewRequest(24)).token();
        assertThat(receipts.open(again, new OpenRequest("9876543210")).step()).isEqualTo("OPEN");
        assertThatThrownBy(() -> receipts.open(token, null)).isInstanceOf(BusinessException.class).hasMessageContaining("not valid");
    }

    @Test
    void aNewRequestReplacesAnOpenOneAndARevokedLinkStops() {
        Long a = pay(0), b = pay(1);
        String first = receipts.create(chitId, ask(List.of(a))).token();
        String second = receipts.create(chitId, ask(List.of(a, b))).token();
        assertThatThrownBy(() -> receipts.open(first, null)).isInstanceOf(BusinessException.class).hasMessageContaining("switched off");
        assertThat(receipts.open(second, new OpenRequest("9876543210")).step()).isEqualTo("OPEN");
        // undoing an installment of an open request stops it
        chits.undoInstallment(chitId, b);
        assertThatThrownBy(() -> receipts.open(second, null)).isInstanceOf(BusinessException.class).hasMessageContaining("switched off");

        String third = receipts.create(chitId, ask(List.of(a))).token();
        Long id = receipts.list(chitId).getFirst().id();
        receipts.revoke(chitId, id);
        assertThatThrownBy(() -> receipts.open(third, null)).isInstanceOf(BusinessException.class);
        receipts.delete(chitId, id);
        assertThat(receipts.list(chitId).stream().map(x -> x.id())).doesNotContain(id);
    }

    @Test
    void theOrganizerCanSayItIsWrongInsteadOfSigning() {
        Long a = pay(0);
        String token = receipts.create(chitId, ask(List.of(a))).token();
        PublicAck r = receipts.dispute(token, new DisputeRequest("9876543210", "I got 4,000 not 5,000"), "5.6.7.8");
        assertThat(r.step()).isEqualTo("DISPUTED");
        assertThat(r.disputeReason()).contains("4,000");
        assertThat(receipts.list(chitId).getFirst().status()).isEqualTo(ChitReceiptAck.DISPUTED);
        assertThatThrownBy(() -> receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA"))
                .isInstanceOf(BusinessException.class).hasMessageContaining("closed");
        // the installment can be asked about again, and undone, since nothing was acknowledged
        assertThat(receipts.create(chitId, ask(List.of(a))).receipt().status()).isEqualTo(ChitReceiptAck.PENDING);
    }

    @Test
    void aSignedRecordCanBeWithdrawnAndSentAgainAndIsNeverDeleted() {
        Long a = pay(0), b = pay(1);
        String token = receipts.create(chitId, ask(List.of(a, b))).token();
        receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA");
        Long id = receipts.list(chitId).getFirst().id();
        var cancelled = receipts.cancel(chitId, id, new CancelRequest("Wrong amount typed"));
        assertThat(cancelled.status()).isEqualTo(ChitReceiptAck.CANCELLED);
        assertThat(cancelled.cancelReason()).isEqualTo("Wrong amount typed");
        assertThat(cancelled.signature()).isNotBlank();   // the evidence stays
        assertThatThrownBy(() -> receipts.delete(chitId, id)).isInstanceOf(BusinessException.class).hasMessageContaining("kept");
        // its installments can be undone and asked for again
        var again = receipts.create(chitId, ask(List.of(a, b)));
        assertThat(again.receipt().status()).isEqualTo(ChitReceiptAck.PENDING);
        assertThatThrownBy(() -> receipts.open(token, new OpenRequest("9876543210"))).isInstanceOf(BusinessException.class);
    }

    @Test
    void aPrintedCopySignedOnPaperIsRecordedAndLocksTheInstallments() {
        Long a = pay(0);
        var made = receipts.create(chitId, ask(List.of(a))).receipt();
        assertThatThrownBy(() -> receipts.signedOnPaper(chitId, made.id(), new PaperRequest("Ram", LocalDate.now().plusDays(2))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("future");
        receipts.addScan(chitId, made.id(), "scan.png", new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, (byte) 0xc4, (byte) 0x89, 0, 0, 0, 10, 'I', 'D', 'A', 'T', 0x78, (byte) 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, (byte) 0xb4, 0, 0, 0, 0, 'I', 'E', 'N', 'D', (byte) 0xae, 0x42, 0x60, (byte) 0x82});
        var signed = receipts.signedOnPaper(chitId, made.id(), new PaperRequest("Ram Kumar", LocalDate.now()));
        assertThat(signed.status()).isEqualTo(ChitReceiptAck.SIGNED);
        assertThat(signed.acknowledgementSeal()).hasSize(64);
        assertThat(signed.digitalSignature()).isNotBlank();
        assertThat(signed.evidencePayload()).contains("SIGNED_ON_PAPER");
        assertThatThrownBy(() -> chits.undoInstallment(chitId, a)).isInstanceOf(BusinessException.class).hasMessageContaining("cannot be undone");
    }

    @Test
    void thePayoutReceiptRestatesThePaymentsAndCancelsTheEarlierAcknowledgementsOnceSigned() {
        Long a = pay(0), b = pay(1);
        String early = receipts.create(chitId, ask(List.of(a))).token();
        receipts.acknowledge(early, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA");
        String open = receipts.create(chitId, ask(List.of(b))).token();   // still waiting
        var payReq = new ChitReceiptService.PayoutRequest(null, "9876543210", true, "Mahesh Reddy", SIGN, "NEFT", 72, false, false);
        // nothing to receipt before the payout, nor while part of it is still to come
        assertThatThrownBy(() -> receipts.createPayout(chitId, payReq)).isInstanceOf(BusinessException.class).hasMessageContaining("payout first");
        chits.payout(chitId, new com.aditya.personalbudget.dto.ChitDtos.PayoutRequest(LocalDate.now(), bd(95000), bank, bd(60000)));
        assertThatThrownBy(() -> receipts.createPayout(chitId, payReq)).isInstanceOf(BusinessException.class).hasMessageContaining("still to come");
        chits.receivePayoutPart(chitId, new PayoutReceiptRequest(LocalDate.now(), bd(35000), bank, "Cheque"));

        CreatedLink made = receipts.createPayout(chitId, payReq);
        var v = made.receipt();
        assertThat(v.kind()).isEqualTo(ChitReceiptAck.KIND_PAYOUT);
        assertThat(v.totalAmount()).isEqualByComparingTo("95000");
        assertThat(v.lines()).hasSize(2);
        assertThat(v.installLines()).hasSize(2);
        assertThat(v.supersedes()).hasSize(2);
        assertThat(v.terms()).contains("RECEIVED IN FULL").contains("EARLIER ACKNOWLEDGEMENTS CANCELLED").contains("CR-").contains("remaining 18 installments")
                .contains("GOVERNING LAW").contains("STAMP DUTY");
        receipts.acknowledge(made.token(), new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{}"), "1.2.3.4", "UA");
        var all = receipts.list(chitId);
        assertThat(all.stream().filter(x -> x.kind().equals(ChitReceiptAck.KIND_INSTALLMENTS)).map(x -> x.status())).containsOnly(ChitReceiptAck.CANCELLED);
        assertThat(all.stream().filter(x -> x.status().equals(ChitReceiptAck.CANCELLED)).findFirst().orElseThrow().supersededBy()).isEqualTo(v.ackNo());
        assertThatThrownBy(() -> receipts.open(open, null)).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> chits.undoPayout(chitId)).isInstanceOf(BusinessException.class).hasMessageContaining("Withdraw");
        assertThatThrownBy(() -> chits.undoInstallment(chitId, a)).isInstanceOf(BusinessException.class).hasMessageContaining("cannot be undone");
        assertThatThrownBy(() -> receipts.createPayout(chitId, payReq)).isInstanceOf(BusinessException.class).hasMessageContaining("already has");
    }

    @Test
    void theListReadsNoDocumentsAndASignatureVerifiesWithNothingButTheRecordItself() throws Exception {
        Long a = pay(0);
        String token = receipts.create(chitId, ask(List.of(a))).token();
        receipts.acknowledge(token, new AckRequest("9876543210", "Ram Kumar", true, SIGN, null, "{\"ua\":\"x\"}"), "1.2.3.4", "UA");

        // a list carries no wording, signature or signed text: those stay on disk until the record is opened
        var light = receipts.list(chitId).getFirst();
        assertThat(light.status()).isEqualTo(ChitReceiptAck.ACKNOWLEDGED);
        assertThat(light.terms()).isNull();
        assertThat(light.signature()).isNull();
        assertThat(light.evidencePayload()).isNull();
        assertThat(light.installmentNos()).containsExactly(1);
        var full = receipts.get(chitId, light.id());
        assertThat(full.terms()).contains("Sri Ram Chits");
        assertThat(full.signature()).isEqualTo(SIGN);
        assertThat(full.acknowledgedDevice()).contains("ua");

        // anyone can check it with plain JDK code, from the record's own text, signature and public key: no help from this installation
        java.security.Signature check = java.security.Signature.getInstance("SHA256withECDSAinP1363Format");
        check.initVerify(java.security.KeyFactory.getInstance("EC").generatePublic(
                new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(full.publicKey()))));
        check.update(full.evidencePayload().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(check.verify(java.util.Base64.getDecoder().decode(full.digitalSignature()))).isTrue();
        assertThat(full.keyFingerprint()).isEqualTo(AppSettingsService.fingerprintOf(full.publicKey()));
        // one changed character and it no longer verifies
        check.initVerify(java.security.KeyFactory.getInstance("EC").generatePublic(
                new java.security.spec.X509EncodedKeySpec(java.util.Base64.getDecoder().decode(full.publicKey()))));
        check.update(full.evidencePayload().replace("Ram Kumar", "Ram Kumaar").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(check.verify(java.util.Base64.getDecoder().decode(full.digitalSignature()))).isFalse();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
