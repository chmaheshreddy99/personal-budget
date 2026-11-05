package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.CloseCheck;
import com.aditya.personalbudget.dto.AccountDtos.CloseRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.ChitDtos.DelayPeriod;
import com.aditya.personalbudget.dto.ChitDtos.PayoutDelay;
import com.aditya.personalbudget.dto.ChitDtos.PayoutReceiptRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountClosureService;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.TransactionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Closing an account (and re-opening it), and what a chit payout not received by its due date costs.
 */
@SpringBootTest
class AccountCloseAndPayoutDelayTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-close-delay-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired AccountClosureService closure;
    @Autowired TransactionService transactions;
    @Autowired ChitService chits;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    // ------------------------------------------------------------------ closing an account

    @Test
    void anAccountWithABalanceClosesAtNilByMovingItAndTakesNoMoreEntries() {
        Long old = account("Old bank", AccountType.BANK, 5000, null);
        Long main = account("Main bank", AccountType.BANK, 1000, null);

        assertThatThrownBy(() -> closure.close(old, new CloseRequest(LocalDate.now(), null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("still has a balance");
        assertThatThrownBy(() -> closure.close(old, new CloseRequest(LocalDate.now().plusDays(1), main)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("future");

        closure.close(old, new CloseRequest(LocalDate.now(), main));
        AccountView closed = accounts.get(old);
        assertThat(closed.active()).isFalse();
        assertThat(closed.closedOn()).isEqualTo(LocalDate.now());
        assertThat(closed.balance()).isEqualByComparingTo("0");
        assertThat(accounts.get(main).balance()).isEqualByComparingTo("6000");

        assertThatThrownBy(() -> transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.now(), bd(10), main, old, null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("inactive");
        assertThat(closure.check(old).blockers()).anyMatch(b -> b.contains("closed already"));

        AccountView reopened = closure.reopen(old);
        assertThat(reopened.active()).isTrue();
        assertThat(reopened.closedOn()).isNull();
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.now(), bd(10), main, old, null, null, null, null));
        assertThat(accounts.get(old).balance()).isEqualByComparingTo("10");
    }

    @Test
    void whatIsOwedOnALoanOrCardIsPaidFromTheOtherAccount() {
        Long loan = account("Old loan", AccountType.PERSONAL_LOAN, 3000, null);
        Long main = account("Paying bank", AccountType.BANK, 10000, null);
        closure.close(loan, new CloseRequest(LocalDate.now(), main));
        assertThat(accounts.get(loan).balance()).isEqualByComparingTo("0");
        assertThat(accounts.get(main).balance()).isEqualByComparingTo("7000");
    }

    @Test
    void anOverdrawnAccountIsToppedUpFromTheOtherAccount() {
        Long over = account("Overdrawn bank", AccountType.BANK, 100, null);
        Long main = account("Top up bank", AccountType.BANK, 10000, null);
        Long wallet = account("Spend wallet", AccountType.WALLET, 0, null);
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.now(), bd(600), over, wallet, null, null, null, null));
        assertThat(accounts.get(over).balance()).isEqualByComparingTo("-500");
        closure.close(over, new CloseRequest(LocalDate.now(), main));
        assertThat(accounts.get(over).balance()).isEqualByComparingTo("0");
        assertThat(accounts.get(main).balance()).isEqualByComparingTo("9500");
    }

    @Test
    void aRunningChitKeepsItsAccountOpenAndAnEarlierDateIsRefused() {
        Long main = account("Check bank", AccountType.BANK, 1000, null);
        ChitDetail chit = chits.create(new ChitRequest("Keeps open " + System.nanoTime(), "Org", "T", bd(60000), bd(5000), 12,
                LocalDate.now().minusMonths(1), null, null, null, null, null, null, main, null, null));
        CloseCheck check = closure.check(chit.chit().accountId());
        if (accounts.require(chit.chit().accountId()).getSystemAccount()) {
            assertThat(check.blockers()).anyMatch(b -> b.contains("system account"));
        } else {
            assertThat(check.blockers()).anyMatch(b -> b.contains("kept in it"));
        }
        // the chit only pays from it by default: closing clears that and goes through
        assertThat(closure.check(main).notes()).anyMatch(n -> n.contains("by default"));
        assertThatThrownBy(() -> closure.close(main, new CloseRequest(LocalDate.now().minusYears(3), account("Other", AccountType.BANK, 0, null))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("on or after");
        closure.close(main, new CloseRequest(LocalDate.now(), account("Other too", AccountType.BANK, 0, null)));
        assertThat(chits.detail(chit.chit().id()).chit().defaultPaymentAccountId()).isNull();
    }

    // ------------------------------------------------------------------ chit payout delay

    @Test
    void aLatePayoutLosesInterestOnTheMaturityAmountThenOnWhatIsLeftOfIt() {
        // the rates: the best of each, not the closed bank nor the loan with nothing owed (well above any other test's)
        account("Low bank", AccountType.BANK, 100000, 4);
        Long best = account("Best bank", AccountType.BANK, 100000, 37);
        Long shut = account("Shut bank", AccountType.BANK, 0, 50);
        closure.close(shut, new CloseRequest(LocalDate.now(), null));
        Long loan = account("Costly loan", AccountType.PERSONAL_LOAN, 50000, 45);
        account("Paid off loan", AccountType.HOME_LOAN, 0, 60);

        LocalDate start = LocalDate.now().minusMonths(13);
        Long id = chits.create(new ChitRequest("Late chit " + System.nanoTime(), "Org", "T", bd(120000), bd(9000), 12,
                start, null, null, null, null, null, null, best, null, null)).chit().id();
        LocalDate due = start.plusMonths(12);
        long sinceDue = ChronoUnit.DAYS.between(due, LocalDate.now());

        // nothing recorded yet: the whole maturity amount, up to today
        PayoutDelay d = view(id).payoutDelay();
        assertThat(d.dueDate()).isEqualTo(due);
        assertThat(d.running()).isTrue();
        assertThat(d.onTime()).isFalse();
        assertThat(d.outstanding()).isEqualByComparingTo("120000");
        assertThat(d.daysLate()).isEqualTo(sinceDue);
        assertThat(d.bank().accountId()).isEqualTo(best);
        assertThat(d.bank().ratePercent()).isEqualByComparingTo("37");
        assertThat(d.loan().accountId()).isEqualTo(loan);
        assertThat(d.bank().interestLost()).isEqualByComparingTo(interest(120000, 37, sinceDue));
        assertThat(d.loan().interestLost()).isEqualByComparingTo(interest(120000, 45, sinceDue));
        assertThat(d.bank().perDay()).isEqualByComparingTo(interest(120000, 37, 1));

        // part of it comes ten days late: the maturity amount until then, the rest after
        LocalDate first = due.plusDays(10);
        chits.payout(id, new PayoutRequest(first, bd(120000), best, bd(50000)));
        d = view(id).payoutDelay();
        assertThat(d.outstanding()).isEqualByComparingTo("70000");
        assertThat(d.periods()).hasSize(2);
        DelayPeriod one = d.periods().getFirst();
        assertThat(one.days()).isEqualTo(10);
        assertThat(one.outstanding()).isEqualByComparingTo("120000");
        assertThat(one.received()).isEqualByComparingTo("50000");
        assertThat(one.bankInterest()).isEqualByComparingTo(interest(120000, 37, 10));
        assertThat(d.periods().get(1).outstanding()).isEqualByComparingTo("70000");
        assertThat(d.periods().get(1).to()).isEqualTo(LocalDate.now());

        // the rest comes: it stops growing and stays on record
        LocalDate last = first.plusDays(5);
        chits.receivePayoutPart(id, new PayoutReceiptRequest(last, bd(70000), best, null));
        d = view(id).payoutDelay();
        assertThat(d.running()).isFalse();
        assertThat(d.onTime()).isFalse();
        assertThat(d.outstanding()).isEqualByComparingTo("0");
        assertThat(d.daysLate()).isEqualTo(15);
        assertThat(d.bank().interestLost()).isEqualByComparingTo(interest(120000, 37, 10).add(interest(70000, 37, 5)));
        assertThat(d.loan().interestLost()).isEqualByComparingTo(interest(120000, 45, 10).add(interest(70000, 45, 5)));
    }

    @Test
    void aPayoutByItsDueDateLosesNothingAndAChitNotDueShowsNothing() {
        Long bank = account("On time bank", AccountType.BANK, 100000, 6);
        LocalDate start = LocalDate.now().minusMonths(13);
        Long id = chits.create(new ChitRequest("On time " + System.nanoTime(), "Org", "T", bd(120000), bd(9000), 12,
                start, null, null, null, null, null, null, bank, null, null)).chit().id();
        chits.payout(id, new PayoutRequest(start.plusMonths(12), bd(120000), bank));
        PayoutDelay d = view(id).payoutDelay();
        assertThat(d.onTime()).isTrue();
        assertThat(d.running()).isFalse();
        assertThat(d.periods()).isEmpty();
        assertThat(d.bank().interestLost()).isEqualByComparingTo("0");

        Long running = chits.create(new ChitRequest("Not due " + System.nanoTime(), "Org", "T", bd(120000), bd(9000), 12,
                LocalDate.now().minusMonths(2), null, null, null, null, null, null, bank, null, null)).chit().id();
        assertThat(view(running).payoutDelay()).isNull();
    }

    @Test
    void aPrizeTakenEarlyCountsOnlyWhatDidNotComeThatDay() {
        Long bank = account("Prize bank", AccountType.BANK, 100000, 10);
        Long id = chits.create(new ChitRequest("Prize " + System.nanoTime(), "Org", "T", bd(120000), bd(9000), 12,
                LocalDate.now().minusMonths(3), null, null, null, null, null, null, bank, null, null)).chit().id();
        LocalDate on = LocalDate.now().minusDays(30);
        chits.payout(id, new PayoutRequest(on, bd(100000), bank, bd(60000)));
        PayoutDelay d = view(id).payoutDelay();
        assertThat(d.dueDate()).isEqualTo(on);
        assertThat(d.outstanding()).isEqualByComparingTo("40000");
        assertThat(d.daysLate()).isEqualTo(30);
        assertThat(d.bank().interestLost()).isEqualByComparingTo(interest(40000, d.bank().ratePercent().longValueExact(), 30));
    }

    private ChitView view(Long id) {
        return chits.detail(id).chit();
    }

    private static BigDecimal interest(long owed, long rate, long days) {
        return BigDecimal.valueOf(owed).multiply(BigDecimal.valueOf(rate)).multiply(BigDecimal.valueOf(days))
                .divide(BigDecimal.valueOf(36500), MathContext.DECIMAL64).setScale(2, RoundingMode.HALF_UP);
    }

    private Long account(String name, AccountType type, long opening, Integer rate) {
        return accounts.create(new AccountRequest(null, name + " " + System.nanoTime(), type, null, null, bd(opening),
                LocalDate.now().minusYears(2), rate == null ? null : bd(rate), null, null, null, null, true, null)).id();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
