package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InterestFrequency;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestOverview;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestPeriod;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestSettingsRequest;
import com.aditya.personalbudget.dto.BankInterestDtos.MonthBalance;
import com.aditya.personalbudget.dto.BankInterestDtos.PostInterestRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BankInterestService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerIntegrityService;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.service.OrgClock;
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
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class BankInterestTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("bank-interest-test");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired AccountService accountService;
    @Autowired BankInterestService interest;
    @Autowired LedgerService ledger;
    @Autowired LedgerIntegrityService integrity;
    @Autowired JournalLineRepository lines;
    @Autowired AppUserRepository users;
    @Autowired OrganizationRepository tenants;

    /** Whole past months, so the figures do not depend on today. */
    private final YearMonth lastQuarterEnd = lastFinishedQuarterEnd();
    private final LocalDate quarterStart = lastQuarterEnd.minusMonths(2).atDay(1);
    private final LocalDate quarterEnd = lastQuarterEnd.atEndOfMonth();

    private static YearMonth lastFinishedQuarterEnd() {
        YearMonth m = YearMonth.from(LocalDate.now()).minusMonths(1);
        while (m.getMonthValue() % 3 != 0) m = m.minusMonths(1);
        return m;
    }

    @BeforeEach
    void signIn() {
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
    void theAverageIsOfDailyClosingBalancesAndInterestIsRateOver365() {
        LocalDate first = quarterStart;
        AccountView bank = bank(bd(10000), first);
        // half way through the first month another 10,000 comes in
        int length = YearMonth.from(first).lengthOfMonth();
        LocalDate mid = first.plusDays(length / 2);
        moveIn(bank.id(), bd(10000), mid);
        settings(bank.id(), bd(3.65), InterestFrequency.MONTHLY, false, first);

        InterestOverview o = interest.overview(bank.id());
        MonthBalance month = o.months().stream().filter(m -> m.month().equals(YearMonth.from(first).toString())).findFirst().orElseThrow();
        int before = length / 2, after = length - before;
        BigDecimal expected = bd((10000.0 * before + 20000.0 * after) / length);
        assertThat(month.days()).isEqualTo(length);
        assertThat(month.average()).isEqualByComparingTo(expected.setScale(2, java.math.RoundingMode.HALF_UP));
        assertThat(month.lowest()).isEqualByComparingTo("10000");
        assertThat(month.highest()).isEqualByComparingTo("20000");
        // 3.65% over 365 days is 0.01% a day: one rupee a day on 10,000, two on 20,000
        assertThat(month.interest()).isEqualByComparingTo(bd(before + 2.0 * after));
    }

    @Test
    void aFinishedPeriodIsPostedByHandWithWhatTheBankPaidAndCannotBePostedTwice() {
        AccountView bank = bank(bd(100000), quarterStart);
        settings(bank.id(), bd(3.65), InterestFrequency.QUARTERLY, false, quarterStart);
        InterestPeriod due = period(interest.overview(bank.id()), quarterStart);
        assertThat(due.state()).isEqualTo("DUE");
        long days = quarterStart.until(quarterEnd).toTotalMonths() >= 0 ? java.time.temporal.ChronoUnit.DAYS.between(quarterStart, quarterEnd) + 1 : 0;
        assertThat(due.calculated()).isEqualByComparingTo(bd(10.0 * days));

        InterestOverview posted = interest.post(bank.id(), new PostInterestRequest(due.from(), due.to(), bd(777.5), null));
        InterestPeriod row = period(posted, quarterStart);
        assertThat(row.state()).isEqualTo("POSTED");
        assertThat(row.amount()).isEqualByComparingTo("777.5");
        assertThat(row.automatic()).isFalse();

        JournalEntry entry = ledger.get(row.entryId());
        assertThat(entry.getVoucherType()).isEqualTo(VoucherType.INTEREST_ACCRUAL);
        assertThat(entry.getEntryDate()).isEqualTo(quarterEnd);
        List<JournalLine> posting = lines.findByJournalEntryId(entry.getId());
        assertThat(posting).anyMatch(l -> l.getAccountId().equals(bank.id()) && l.getDebit().compareTo(bd(777.5)) == 0);
        Long income = ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId();
        assertThat(posting).anyMatch(l -> l.getAccountId().equals(income) && l.getCredit().compareTo(bd(777.5)) == 0 && l.getCategoryId() != null);
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo("100777.5");
        assertThat(integrity.check().stream().filter(i -> Long.valueOf(entry.getId()).equals(i.entryId()))).isEmpty();

        // its own credit, dated the last day, does not change what the period worked out to
        assertThat(row.calculated()).isEqualByComparingTo(due.calculated());
        assertThatThrownBy(() -> interest.post(bank.id(), new PostInterestRequest(due.from(), due.to(), null, null)))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void automaticAccountsPostFinishedPeriodsOnceEachCompoundingAndKeepAnUndonePeriodOut() {
        LocalDate twoBack = quarterStart.minusMonths(3);
        AccountView bank = bank(bd(100000), twoBack);
        InterestOverview saved = settings(bank.id(), bd(3.65), InterestFrequency.QUARTERLY, true, twoBack);
        assertThat(saved.postedNow()).isEqualTo(2);

        InterestPeriod earlier = period(saved, twoBack);
        InterestPeriod later = period(saved, quarterStart);
        assertThat(earlier.state()).isEqualTo("POSTED");
        assertThat(earlier.automatic()).isTrue();
        // the later quarter earns on the earlier credit too: more than 10 rupees a day
        long laterDays = java.time.temporal.ChronoUnit.DAYS.between(quarterStart, quarterEnd) + 1;
        assertThat(later.amount()).isGreaterThan(bd(10.0 * laterDays));
        BigDecimal expected = bd(100000).add(earlier.amount()).add(later.amount());
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo(expected);

        // nothing more on the next run
        interest.postDueForAll();
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo(expected);

        // undone: out of the books, and the job leaves it alone
        InterestOverview undone = interest.undo(bank.id(), later.postingId());
        assertThat(period(undone, quarterStart).state()).isEqualTo("SKIPPED");
        interest.postDueForAll();
        assertThat(period(interest.overview(bank.id()), quarterStart).state()).isEqualTo("SKIPPED");
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo(expected.subtract(later.amount()));

        // it can still be posted by hand
        InterestOverview again = interest.post(bank.id(), new PostInterestRequest(later.from(), later.to(), bd(100), null));
        assertThat(period(again, quarterStart).state()).isEqualTo("POSTED");
    }

    @Test
    void undoOnAManualAccountPutsThePeriodBackAsDue() {
        AccountView bank = bank(bd(50000), quarterStart);
        settings(bank.id(), bd(4), InterestFrequency.QUARTERLY, false, quarterStart);
        InterestPeriod posted = period(interest.post(bank.id(), new PostInterestRequest(quarterStart, quarterEnd, null, null)), quarterStart);
        InterestOverview undone = interest.undo(bank.id(), posted.postingId());
        assertThat(period(undone, quarterStart).state()).isEqualTo("DUE");
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo("50000");
    }

    @Test
    void periodsBeforeTheStartAreNotReckonedAndChangingFrequencyNeverReckonsADayTwice() {
        LocalDate twoBack = quarterStart.minusMonths(3);
        AccountView bank = bank(bd(50000), twoBack);
        InterestOverview quarterly = settings(bank.id(), bd(4), InterestFrequency.QUARTERLY, false, quarterStart);
        assertThat(quarterly.periods()).noneMatch(p -> p.from().isBefore(quarterStart));

        interest.post(bank.id(), new PostInterestRequest(quarterStart, quarterEnd, null, null));
        InterestOverview monthly = settings(bank.id(), bd(4), InterestFrequency.MONTHLY, false, quarterStart);
        assertThat(monthly.periods().stream().filter(p -> !"POSTED".equals(p.state()))).allMatch(p -> p.from().isAfter(quarterEnd));
    }

    @Test
    void aRangeIsReckonedOnItsExactDaysShowsWhatTouchesItAndNeverHidesWhatWaitsToBePosted() {
        LocalDate twoBack = quarterStart.minusMonths(3);
        AccountView bank = bank(bd(10000), twoBack);
        settings(bank.id(), bd(3.65), InterestFrequency.QUARTERLY, false, twoBack);
        LocalDate second = quarterStart.plusMonths(1);
        moveIn(bank.id(), bd(10000), second.plusDays(4));   // the 5th of the middle month of the last quarter

        // the first ten days of that month: 4 days on 10,000, then 6 on 20,000
        InterestOverview o = interest.overview(bank.id(), second, second.plusDays(9));
        assertThat(o.range().days()).isEqualTo(10);
        assertThat(o.range().average()).isEqualByComparingTo("16000");
        assertThat(o.range().lowest()).isEqualByComparingTo("10000");
        assertThat(o.range().highest()).isEqualByComparingTo("20000");
        assertThat(o.range().earned()).isEqualByComparingTo(bd(4 + 12));
        assertThat(o.months()).extracting(MonthBalance::month).containsExactly(YearMonth.from(second).toString());
        assertThat(o.periods()).extracting(InterestPeriod::from).containsExactly(quarterStart);
        assertThat(o.dueCount()).isEqualTo(2);   // the earlier quarter waits too, though it is outside the dates

        // dates before the account's first entry are not counted as days of it
        InterestOverview before = interest.overview(bank.id(), twoBack.minusYears(1), twoBack);
        assertThat(before.range().from()).isEqualTo(twoBack);
        assertThat(before.range().days()).isEqualTo(1);
        // and a range wholly before it holds nothing
        InterestOverview none = interest.overview(bank.id(), twoBack.minusYears(1), twoBack.minusDays(1));
        assertThat(none.range()).isNull();
        assertThat(none.months()).isEmpty();
        assertThat(none.dueCount()).isEqualTo(2);
    }

    @Test
    void anAccountCannotPostByItselfWithoutARateAndOnlyBankAccountsHaveAPlan() {
        AccountView bank = bank(bd(1000), quarterStart);
        assertThatThrownBy(() -> settings(bank.id(), null, InterestFrequency.MONTHLY, true, quarterStart))
                .isInstanceOf(BusinessException.class);
        Long cash = accountService.systemAccount(DefaultChartOfAccounts.CASH).getId();
        assertThatThrownBy(() -> interest.overview(cash)).isInstanceOf(BusinessException.class);
    }

    @Test
    void theEntryIsLockedInTheJournalAndNoFutureDateIsTaken() {
        AccountView bank = bank(bd(50000), quarterStart);
        settings(bank.id(), bd(4), InterestFrequency.QUARTERLY, false, quarterStart);
        assertThatThrownBy(() -> interest.post(bank.id(), new PostInterestRequest(quarterStart, quarterEnd, bd(10), OrgClock.today().plusDays(1))))
                .isInstanceOf(BusinessException.class);
        InterestPeriod posted = period(interest.post(bank.id(), new PostInterestRequest(quarterStart, quarterEnd, bd(10), null)), quarterStart);
        JournalEntry entry = ledger.get(posted.entryId());
        var view = ledger.toViews(List.of(entry)).getFirst();
        assertThat(view.reversible()).isFalse();
        assertThat(view.lockReason()).contains("Balance & interest");
    }

    private InterestPeriod period(InterestOverview overview, LocalDate from) {
        return overview.periods().stream().filter(p -> p.from().equals(from)).findFirst().orElseThrow();
    }

    private InterestOverview settings(Long id, BigDecimal rate, InterestFrequency frequency, boolean auto, LocalDate from) {
        return interest.saveSettings(id, new InterestSettingsRequest(rate, frequency, auto, from, accountService.get(id).version()));
    }

    private AccountView bank(BigDecimal opening, LocalDate date) {
        return accountService.create(new AccountRequest(null, "Bank " + UUID.randomUUID().toString().substring(0, 8), AccountType.BANK, null, null,
                opening, date, null, null, null, null, null, true, null));
    }

    private void moveIn(Long bank, BigDecimal amount, LocalDate date) {
        Long cash = accountService.systemAccount(DefaultChartOfAccounts.CASH).getId();
        ledger.post(JournalDraft.of(date, VoucherType.TRANSFER, "In").debit(bank, amount).credit(cash, amount));
    }

    private static BigDecimal bd(double value) {
        return BigDecimal.valueOf(value);
    }
}
