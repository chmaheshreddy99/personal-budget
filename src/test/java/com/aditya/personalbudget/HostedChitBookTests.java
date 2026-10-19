package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.HostedChitBookService;
import com.aditya.personalbudget.service.HostedChitBookService.ChitMoney;
import com.aditya.personalbudget.service.HostedChitBookService.LegInput;
import com.aditya.personalbudget.service.HostedChitBookService.Spot;
import com.aditya.personalbudget.service.HostedChitBookService.TransferRequest;
import com.aditya.personalbudget.service.HostedChitBookService.TransferView;
import com.aditya.personalbudget.service.HostedChitService;
import com.aditya.personalbudget.service.HostedChitService.ChitRequest;
import com.aditya.personalbudget.service.HostedChitService.Detail;
import com.aditya.personalbudget.service.HostedChitService.MemberInput;
import com.aditya.personalbudget.service.HostedChitService.PaymentRequest;
import com.aditya.personalbudget.service.HostedChitService.PayoutRequest;
import com.aditya.personalbudget.service.HostedChitService.WinnerRequest;
import com.aditya.personalbudget.service.HostedChitShareService;
import com.aditya.personalbudget.service.HostedChitShareService.PublicChit;
import com.aditya.personalbudget.service.HostedChitShareService.ShareRequest;
import com.aditya.personalbudget.service.ReportService;
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
 * Host a Chit, Chit accounts: members paying into different (personal) bank accounts, one payout paid from several
 * accounts, consolidating chit money, advancing the organiser's own money and taking the commission out. Checks the
 * journal lines and where each chit's money is after every step, and that the books stay balanced.
 */
@SpringBootTest
class HostedChitBookTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-chitbook-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountRepository accountRepository;
    @Autowired JournalLineRepository lines;
    @Autowired AccountService accounts;
    @Autowired HostedChitService chits;
    @Autowired HostedChitBookService book;
    @Autowired ReportService reports;
    @Autowired HostedChitShareService shares;

    private Organization tenant;

    @BeforeEach
    void signIn() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void moneyReceivedInSeveralBanksIsTracedThroughPayoutTransfersAndDeletion() {
        Long icici = bank("ICICI Test " + System.nanoTime());
        Long hdfc = bank("HDFC Test " + System.nanoTime());
        Detail d = chits.create(chit("Book Chit " + System.nanoTime()));
        Long chitId = d.chit().id();
        Long collections = d.chit().accountId();
        Long commission = d.chit().commissionAccountId();
        assertThat(accountRepository.findById(collections).orElseThrow().isChitBook()).isTrue();
        assertThat(accountRepository.findById(collections).orElseThrow().getHostedChitId()).isEqualTo(chitId);

        // the personal Accounts page gets the flags to keep chit accounts off it
        List<AccountView> all = accounts.list();
        assertThat(all.stream().filter(a -> a.id().equals(collections)).findFirst().orElseThrow().chitBook()).isTrue();
        assertThat(all.stream().filter(a -> a.id().equals(icici)).findFirst().orElseThrow().chitBook()).isFalse();

        // month 1: three members pay into three different accounts
        Long a = d.members().get(0).id(), b = d.members().get(1).id(), c = d.members().get(2).id();
        pay(chitId, a, 1, icici);
        pay(chitId, b, 1, hdfc);
        d = pay(chitId, c, 1, null);
        assertThat(d.payments().stream().filter(p -> p.memberId().equals(a)).findFirst().orElseThrow().accountId()).isEqualTo(icici);

        ChitMoney m = d.money();
        assertThat(m.held()).isEqualByComparingTo("30000");
        assertThat(m.owedToMembers()).isEqualByComparingTo("30000");
        assertThat(m.inPersonal()).isEqualByComparingTo("20000");
        assertThat(m.mine()).isEqualByComparingTo("0");
        assertThat(spot(m, icici)).isEqualByComparingTo("10000");
        assertThat(spot(m, collections)).isEqualByComparingTo("10000");
        assertThat(book.overview().suggestions()).anyMatch(s -> "CONSOLIDATE".equals(s.kind()) && icici.equals(s.accountId()));

        // the winner is paid 28,500 from all three accounts; the payout must add up exactly
        chits.setWinner(chitId, 1, new WinnerRequest(a, false, null));
        assertThatThrownBy(() -> chits.payout(chitId, 1, payout(List.of(new LegInput(icici, bd(10000), "UPI", "U1")))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("short");
        d = chits.payout(chitId, 1, payout(List.of(new LegInput(icici, bd(10000), "UPI", "U1"),
                new LegInput(hdfc, bd(10000), "Bank", "B1"), new LegInput(collections, bd(8500), "Cash", null))));
        var month = d.schedule().getFirst();
        assertThat(month.legs()).hasSize(3);
        assertThat(month.payoutReference()).isEqualTo("U1, B1");
        assertThat(month.payoutTo()).isEqualTo("SBI 1234");
        List<JournalLine> payoutLines = lines.findByJournalEntryId(month.payoutEntryId());
        assertThat(payoutLines).hasSize(4).allMatch(l -> chitId.equals(l.getHostedChitId()));
        assertThat(payoutLines.stream().filter(l -> l.getAccountId().equals(icici)).findFirst().orElseThrow().getCredit())
                .isEqualByComparingTo("10000");

        m = d.money();
        assertThat(m.owedToMembers()).isEqualByComparingTo("0");
        assertThat(m.inPersonal()).isEqualByComparingTo("0");
        assertThat(spot(m, commission)).isEqualByComparingTo("1500");   // moved out of collections
        assertThat(spot(m, collections)).isEqualByComparingTo("0");
        assertThat(m.mine()).isEqualByComparingTo("1500");
        assertThat(m.earned()).isEqualByComparingTo("1500");

        // my own money into the chit: the personal side carries no chit
        TransferView advance = book.transfer(new TransferRequest(chitId, LocalDate.now(), collections,
                List.of(new LegInput(icici, bd(2000), null, null)), false, "UPI", "ADV1", "cover a late member", null));
        assertThat(advance.kind()).isEqualTo("ADVANCE");
        assertThat(lines.findByJournalEntryId(advance.journalEntryId()))
                .anyMatch(l -> l.getAccountId().equals(icici) && l.getHostedChitId() == null)
                .anyMatch(l -> l.getAccountId().equals(collections) && chitId.equals(l.getHostedChitId()));
        m = chits.detail(chitId).money();
        assertThat(m.inPersonal()).isEqualByComparingTo("0");
        assertThat(m.mine()).isEqualByComparingTo("3500");

        // month 2 paid into the two banks, then consolidated in one entry (chit money: both sides carry the chit)
        pay(chitId, b, 2, icici);
        pay(chitId, c, 2, hdfc);
        assertThat(chits.detail(chitId).money().inPersonal()).isEqualByComparingTo("20000");
        TransferView merged = book.transfer(new TransferRequest(chitId, LocalDate.now(), collections,
                List.of(new LegInput(icici, bd(10000), "UPI", "C1"), new LegInput(hdfc, bd(10000), "Bank", "C2")), true, "Bank", null, null, null));
        assertThat(merged.kind()).isEqualTo("CONSOLIDATE");
        assertThat(lines.findByJournalEntryId(merged.journalEntryId())).hasSize(3).allMatch(l -> chitId.equals(l.getHostedChitId()));
        m = chits.detail(chitId).money();
        assertThat(m.inPersonal()).isEqualByComparingTo("0");
        assertThat(spot(m, collections)).isEqualByComparingTo("22000");
        assertThat(book.overview().suggestions()).noneMatch(s -> "CONSOLIDATE".equals(s.kind()) && chitId.equals(s.chitId()));

        // the commission taken out to a personal account is my money there
        TransferView out = book.transfer(new TransferRequest(chitId, LocalDate.now(), hdfc,
                List.of(new LegInput(commission, bd(1500), null, null)), false, "Bank", null, null, null));
        assertThat(out.kind()).isEqualTo("WITHDRAW");
        assertThat(chits.detail(chitId).money().mine()).isEqualByComparingTo("2000");

        // a transfer between two personal accounts is not a chit transfer unless it is chit money
        assertThatThrownBy(() -> book.transfer(new TransferRequest(null, LocalDate.now(), hdfc,
                List.of(new LegInput(icici, bd(100), null, null)), false, "Bank", null, null, null)))
                .isInstanceOf(BusinessException.class);

        assertThat(reports.balanceSheet(LocalDate.now(), null).balanced()).isTrue();
        assertThat(reports.balanceSheet(LocalDate.now(), null).assets().groups())
                .anyMatch(g -> ReportService.HOSTED_CHITS.equals(g.label()));

        // undoing a transfer takes its entry out; deleting the chit takes its accounts with it
        book.deleteTransfer(out.id());
        chits.delete(chitId, true, chits.detail(chitId).chit().name());
        assertThat(accountRepository.findById(collections)).isEmpty();
        assertThat(accountRepository.findById(commission)).isEmpty();
        assertThat(lines.findByTenantId(tenant.getId())).noneMatch(l -> chitId.equals(l.getHostedChitId()));
        assertThat(reports.balanceSheet(LocalDate.now(), null).balanced()).isTrue();
    }

    @Test
    void membersPayTheWinnerDirectlyAndThePayoutClearsIt() {
        Detail d = chits.create(chit("Direct Chit " + System.nanoTime()));
        Long chitId = d.chit().id();
        Long collections = d.chit().accountId();
        Long a = d.members().get(0).id(), b = d.members().get(1).id(), c = d.members().get(2).id();

        // paying the winner directly needs a winner
        assertThatThrownBy(() -> payDirect(chitId, b, 1, a)).isInstanceOf(BusinessException.class).hasMessageContaining("winner");
        chits.setWinner(chitId, 1, new WinnerRequest(a, false, null));
        payDirect(chitId, b, 1, a);                       // Lakshmi pays Ravi directly
        d = payDirect(chitId, a, 1, a);                   // Ravi's own installment is set off against his payout
        Long direct = book.directAccount().getId();
        assertThat(d.payments()).allMatch(p -> direct.equals(p.accountId()) && a.equals(p.paidToMemberId()));
        assertThat(spot(d.money(), direct)).isEqualByComparingTo("20000");
        // the commission must still reach the organiser: all three paying Ravi directly would be too much
        assertThatThrownBy(() -> payDirect(chitId, c, 1, a)).isInstanceOf(BusinessException.class).hasMessageContaining("commission");
        // the winner cannot change while members have paid him directly
        assertThatThrownBy(() -> chits.setWinner(chitId, 1, new WinnerRequest(b, false, null))).isInstanceOf(BusinessException.class);
        pay(chitId, c, 1, null);                          // Suresh pays the organiser

        // the payout: 20,000 already with Ravi, 8,500 from collections (the rest stays as commission)
        assertThatThrownBy(() -> chits.payout(chitId, 1, payout(List.of(new LegInput(collections, bd(28500), "Bank", null)))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("directly");
        d = chits.payout(chitId, 1, payout(List.of(new LegInput(collections, bd(8500), "Bank", "UTR9"))));
        var month = d.schedule().getFirst();
        assertThat(month.legs()).hasSize(2);
        assertThat(month.legs().getFirst().mode()).isEqualTo("Direct");
        assertThat(lines.findByJournalEntryId(month.payoutEntryId()))
                .anyMatch(l -> l.getAccountId().equals(direct) && l.getCredit().compareTo(bd(20000)) == 0 && chitId.equals(l.getHostedChitId()));
        assertThat(spot(d.money(), direct)).isEqualByComparingTo("0");
        assertThat(d.money().owedToMembers()).isEqualByComparingTo("0");
        // a direct payment is part of the payout now
        Long paidDirectly = d.payments().stream().filter(p -> b.equals(p.memberId())).findFirst().orElseThrow().id();
        assertThatThrownBy(() -> chits.deletePayment(chitId, paidDirectly)).isInstanceOf(BusinessException.class).hasMessageContaining("payout");

        // "everyone has paid" can be reverted in one go
        d = chits.collectAll(chitId, 2, new HostedChitService.CollectAllRequest(LocalDate.now(), "Cash", null, false));
        String batch = d.payments().stream().filter(p -> p.monthNo() == 2).findFirst().orElseThrow().batchId();
        assertThat(d.payments().stream().filter(p -> p.monthNo() == 2)).hasSize(3).allMatch(p -> batch.equals(p.batchId()));
        d = chits.revertBatch(chitId, 2, batch);
        assertThat(d.payments()).noneMatch(p -> p.monthNo() == 2);
        assertThat(reports.balanceSheet(LocalDate.now(), null).balanced()).isTrue();
    }

    @Test
    void plannedChitPaysAShortfallMonthOutOfTheCommission() {
        // 3 members pay 10,000: 30,000 collected a month; the winners get 27,000, 30,000 and 32,000
        ChitRequest planned = new ChitRequest("Planned " + System.nanoTime(), "PLANNED", LocalDate.now().minusMonths(2).withDayOfMonth(1), 5, 3, 3,
                bd(10000), bd(30000), BigDecimal.ZERO, BigDecimal.ZERO, "NONE", null, null, null, 0, null, null, true, null, true, null, true,
                null, null, false, null, List.of(new MemberInput("Ravi", null, null, null), new MemberInput("Lakshmi", null, null, null),
                new MemberInput("Suresh", null, null, null)), null, BigDecimal.ZERO,
                List.of(new HostedChitService.PlanMonth(1, null, bd(27000)), new HostedChitService.PlanMonth(2, null, bd(30000)),
                        new HostedChitService.PlanMonth(3, null, bd(32000))));
        Detail d = chits.create(planned);
        Long chitId = d.chit().id();
        Long commission = d.chit().commissionAccountId();
        assertThat(d.chit().chitType()).isEqualTo("PLANNED");
        assertThat(d.schedule().get(2).commission()).isEqualByComparingTo("-2000");
        List<Long> ids = d.members().stream().map(HostedChitService.MemberView::id).toList();
        for (int month = 1; month <= 3; month++) {
            for (Long m : ids) pay(chitId, m, month, null);
            chits.setWinner(chitId, month, new WinnerRequest(ids.get(month - 1), false, null));
            if (month == 3) {
                // a paid-out month's figures stay; an open one can change
                assertThatThrownBy(() -> chits.updatePlan(chitId, new HostedChitService.PlanRequest(List.of(new HostedChitService.PlanMonth(1, null, bd(26000))))))
                        .isInstanceOf(BusinessException.class);
            }
            d = chits.payout(chitId, month, payout(List.of()));
        }
        var last = d.schedule().get(2);
        assertThat(last.commission()).isEqualByComparingTo("-2000");
        // the 2,000 above the collection came out of the commission account
        assertThat(last.legs()).anyMatch(l -> l.accountId().equals(commission) && l.amount().compareTo(bd(2000)) == 0);
        assertThat(d.money().owedToMembers()).isEqualByComparingTo("0");
        assertThat(d.money().earned()).isEqualByComparingTo("1000");
        assertThat(spot(d.money(), commission)).isEqualByComparingTo("1000");
        assertThat(d.chit().commissionEarned()).isEqualByComparingTo("1000");
        assertThat(reports.balanceSheet(LocalDate.now(), null).balanced()).isTrue();
    }

    @Test
    void aStartedChitKeepsItsTermsButItsNameAndAccountsCanChange() {
        Detail d = chits.create(chit("Started " + System.nanoTime()));   // started two months ago
        var c = d.chit();
        assertThat(c.termsLocked()).isTrue();
        ChitRequest moreCommission = new ChitRequest(c.name(), "FIXED", c.startMonth(), c.dueDay(), 3, 3, bd(10000), bd(30000), BigDecimal.ZERO,
                bd(2000), "NONE", null, null, null, 0, null, null, true, c.accountId(), false, c.commissionAccountId(), false, c.commissionCategoryId(),
                null, false, null, null, c.version(), null, null);
        assertThatThrownBy(() -> chits.update(c.id(), moreCommission)).isInstanceOf(BusinessException.class).hasMessageContaining("commission");
        ChitRequest renamed = new ChitRequest("Renamed " + System.nanoTime(), "FIXED", c.startMonth(), c.dueDay(), 3, 3, bd(10000), bd(30000), BigDecimal.ZERO,
                bd(1500), "NONE", null, null, null, 0, "me@okhdfc", "Me", true, c.accountId(), false, c.commissionAccountId(), false, c.commissionCategoryId(),
                null, false, "a note", null, c.version(), null, null);
        Detail after = chits.update(c.id(), renamed);
        assertThat(after.chit().name()).startsWith("Renamed");
        assertThat(after.chit().upiId()).isEqualTo("me@okhdfc");
        assertThat(after.chit().commission()).isEqualByComparingTo("1500");
    }

    @Test
    void aPaymentIsFollowedFromTheBankThroughTheTransferToThePayout() {
        Long icici = bank("ICICI Link " + System.nanoTime());
        Detail d = chits.create(chit("Linked " + System.nanoTime()));
        Long chitId = d.chit().id();
        Long collections = d.chit().accountId();
        Long a = d.members().get(0).id(), b = d.members().get(1).id(), c = d.members().get(2).id();
        Long intoBank = pay(chitId, b, 1, icici).payments().stream().filter(p -> p.memberId().equals(b)).findFirst().orElseThrow().id();
        pay(chitId, a, 1, null);
        pay(chitId, c, 1, null);

        // consolidated with its payment named: the payment knows the transfer, and cannot be moved twice
        var move = new LegInput(icici, bd(10000), "UPI", "C77", List.of(intoBank), "Lakshmi RC-x");
        TransferView t = book.transfer(new TransferRequest(chitId, LocalDate.now(), collections, List.of(move), true, "Bank", null, null, null));
        assertThat(t.from().getFirst().paymentIds()).containsExactly(intoBank);
        d = chits.detail(chitId);
        var moved = d.payments().stream().filter(p -> p.id().equals(intoBank)).findFirst().orElseThrow();
        assertThat(moved.transferId()).isEqualTo(t.id());
        assertThat(moved.movedTo()).contains(t.entryNo());
        assertThatThrownBy(() -> book.transfer(new TransferRequest(chitId, LocalDate.now(), collections,
                List.of(new LegInput(icici, bd(1), "UPI", null, List.of(intoBank), null)), true, "Bank", null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("another transfer");
        assertThat(lines.findByJournalEntryId(t.journalEntryId())).anyMatch(l -> l.getMemo() != null && l.getMemo().contains("Lakshmi RC-x"));

        // the payout says which payments it pays out
        chits.setWinner(chitId, 1, new WinnerRequest(a, false, null));
        d = chits.payout(chitId, 1, payout(List.of(new LegInput(collections, bd(28500), "Bank", "P1", List.of(intoBank), "incl. Lakshmi's (moved from ICICI)"))));
        assertThat(d.payments().stream().filter(p -> p.id().equals(intoBank)).findFirst().orElseThrow().paidOutMonth()).isEqualTo(1);
        assertThat(d.schedule().getFirst().legs().getFirst().note()).contains("Lakshmi");
    }

    @Test
    void membersPayIntoAnAccountWithBankDetailsAndTheNarrativeIsKeptInFull() {
        Long icici = bank("ICICI PayTo " + System.nanoTime());
        Detail d = chits.create(chit("PayTo " + System.nanoTime()));
        Long chitId = d.chit().id();
        Long collections = d.chit().accountId();
        Long a = d.members().get(0).id(), b = d.members().get(1).id(), c = d.members().get(2).id();

        // an account without a UPI ID or bank details cannot be put on a payment link
        assertThatThrownBy(() -> chits.updateMember(chitId, b, new MemberInput("Lakshmi", null, null, null, icici)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("no UPI ID or bank details");
        assertThatThrownBy(() -> accounts.updateBankDetails(icici, new BankDetailsRequest("ICICI Bank", "123456789012", "Asha", "ICIC123", null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("IFSC");
        accounts.updateBankDetails(icici, new BankDetailsRequest("ICICI Bank", "123456789012", "Asha Organiser", "icic0001234", null, null));
        d = chits.updateMember(chitId, b, new MemberInput("Lakshmi", null, null, null, icici));
        assertThat(d.members().stream().filter(m -> m.id().equals(b)).findFirst().orElseThrow().payToAccountId()).isEqualTo(icici);

        // her link carries the bank details (no UPI ID), sealed; the others have nothing to pay into yet
        PublicChit hers = shares.open(shares.create(chitId, new ShareRequest(b, null, null, "Lakshmi", 24, false, null)).token());
        assertThat(hers.payTo().upiId()).isNull();
        assertThat(hers.payTo().accountNumber()).isEqualTo("123456789012");
        assertThat(hers.payTo().ifsc()).isEqualTo("ICIC0001234");
        assertThat(hers.payTo().holderName()).isEqualTo("Asha Organiser");
        assertThat(hers.payTo().seal()).hasSize(64);
        assertThat(shares.open(shares.create(chitId, new ShareRequest(c, null, null, "Suresh", 24, false, null)).token()).payTo()).isNull();

        // digitally signed (ECDSA): the signature checks, a changed copy does not, and new bank details make the old copy stale
        String herToken = shares.create(chitId, new ShareRequest(b, null, null, "Lakshmi", 24, false, null)).token();
        var signed = shares.open(herToken).payTo();
        assertThat(signed.payload()).contains("\"accountNumber\":\"123456789012\"").contains("\"ifsc\":\"ICIC0001234\"");
        assertThat(signed.keyFingerprint()).matches("[0-9A-F]{4}( [0-9A-F]{4}){4}");
        var check = shares.checkPayTo(herToken, signed.payload(), signed.digitalSignature());
        assertThat(check.signatureValid()).isTrue();
        assertThat(check.current()).isTrue();
        String forged = signed.payload().replace("123456789012", "999999999999");
        assertThat(shares.checkPayTo(herToken, forged, signed.digitalSignature()).signatureValid()).isFalse();
        accounts.updateBankDetails(icici, new BankDetailsRequest("ICICI Bank", "555566667777", "Asha Organiser", "ICIC0001234", null, null));
        var stale = shares.checkPayTo(herToken, signed.payload(), signed.digitalSignature());
        assertThat(stale.signatureValid()).isTrue();
        assertThat(stale.current()).isFalse();

        // a long narrative reaches the payout and its journal line whole
        pay(chitId, a, 1, null);
        pay(chitId, b, 1, null);
        pay(chitId, c, 1, null);
        chits.setWinner(chitId, 1, new WinnerRequest(a, false, null));
        String note = ("[Own a/c ICICI] " + "Lakshmi RC-000968 (UTR265) ₹10,000; ".repeat(20)).trim();
        assertThat(note.length()).isGreaterThan(600);
        d = chits.payout(chitId, 1, payout(List.of(new LegInput(collections, bd(28500), "Bank", "P1", List.of(), note))));
        assertThat(d.schedule().getFirst().legs().getFirst().note()).isEqualTo(note);
        assertThat(lines.findByJournalEntryId(d.schedule().getFirst().payoutEntryId()))
                .anyMatch(l -> l.getMemo() != null && l.getMemo().endsWith(note));
    }

    @Test
    void membersPayTheWinnerOnTheirUpiWithAShortPaymentNote() {
        String name = "Short Code Chit 5L " + System.nanoTime();
        Detail d = chits.create(chit(name));
        Detail twin = chits.create(chit(name + " twin"));
        assertThat(d.chit().shortCode()).isEqualTo("SCC5");
        assertThat(twin.chit().shortCode()).isNotEqualTo(d.chit().shortCode()).hasSize(4);
        assertThat(HostedChitService.payCode("AC5L", 3)).isEqualTo("AC5L-M03").hasSize(8);
        assertThat(HostedChitService.payCode("AC5L", 100)).isEqualTo("AC5-M100").hasSize(8);

        Long chitId = d.chit().id();
        Long a = d.members().get(0).id(), b = d.members().get(1).id(), c = d.members().get(2).id();
        // Ravi gets a UPI ID; a member can pay him only once he is a month's winner
        chits.updateMember(chitId, a, new MemberInput("Ravi", null, null, "SBI 1234", null, "ravi@okaxis", null));
        assertThatThrownBy(() -> chits.updateMember(chitId, b, new MemberInput("Lakshmi", null, null, null, null, null, a)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("not the winner of an open month");
        chits.setWinner(chitId, 1, new WinnerRequest(a, false, null));
        d = chits.updateMember(chitId, b, new MemberInput("Lakshmi", null, null, null, null, null, a));
        assertThat(d.members().stream().filter(m -> m.id().equals(b)).findFirst().orElseThrow().payToMemberName()).isEqualTo("Ravi");

        // her signed link shows Ravi's UPI ID, and the chit's short code for the note
        PublicChit hers = shares.open(shares.create(chitId, new ShareRequest(b, null, null, "Lakshmi", 24, false, null)).token());
        assertThat(hers.shortCode()).isEqualTo("SCC5");
        assertThat(hers.payTo().toMember()).isEqualTo("Ravi");
        assertThat(hers.payTo().upiId()).isEqualTo("ravi@okaxis");
        assertThat(hers.payTo().payload()).contains("\"toMember\":\"Ravi\"");

        // she pays him directly; once month 1 is paid out she pays into the chit again
        payDirect(chitId, b, 1, a);
        pay(chitId, a, 1, null);
        pay(chitId, c, 1, null);
        d = chits.payout(chitId, 1, payout(List.of(new LegInput(d.chit().accountId(), bd(18500), "Bank", null))));
        assertThat(d.members().stream().filter(m -> m.id().equals(b)).findFirst().orElseThrow().payToMemberId()).isNull();
    }

    private Detail pay(Long chitId, Long memberId, int monthNo, Long into) {
        return chits.addPayment(chitId, new PaymentRequest(memberId, monthNo, bd(10000), null, null, "R" + memberId + monthNo,
                LocalDate.now(), "UPI", null, false, null, into, null));
    }

    private Detail payDirect(Long chitId, Long memberId, int monthNo, Long winnerId) {
        return chits.addPayment(chitId, new PaymentRequest(memberId, monthNo, bd(10000), null, null, null,
                LocalDate.now(), "UPI", null, false, null, null, winnerId));
    }

    private static PayoutRequest payout(List<LegInput> legs) {
        return new PayoutRequest(LocalDate.now(), "Bank", null, true, false, null, null, legs, "SBI 1234", null);
    }

    private static BigDecimal spot(ChitMoney m, Long accountId) {
        return m.spots().stream().filter(s -> s.accountId().equals(accountId)).map(Spot::amount).findFirst().orElse(BigDecimal.ZERO);
    }

    private Long bank(String name) {
        return accounts.create(new AccountRequest(null, name, AccountType.BANK, "Bank", null, null, null, null, null, null, null,
                null, true, null)).id();
    }

    private static ChitRequest chit(String name) {
        return new ChitRequest(name, "FIXED", LocalDate.now().minusMonths(2).withDayOfMonth(1), 5, 3, 3, bd(10000), bd(30000),
                BigDecimal.ZERO, bd(1500), "NONE", null, null, null, 0, null, null, true, null, true, null, true, null, null, false,
                null, List.of(new MemberInput("Ravi", null, null, "SBI 1234"), new MemberInput("Lakshmi", null, null, null),
                new MemberInput("Suresh", null, null, null)), null, null, null);
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
