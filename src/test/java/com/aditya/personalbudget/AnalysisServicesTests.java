package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.AppSettingsService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.DeepAnalysisService;
import com.aditya.personalbudget.service.InvestmentAdviceService;
import com.aditya.personalbudget.service.TransactionService;
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

import static org.assertj.core.api.Assertions.assertThat;

/** The deep analysis, the investment plan and the interest-loss figure, run on a ledger with several months of history. */
@SpringBootTest
class AnalysisServicesTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-analysis-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired TransactionService transactions;
    @Autowired DeepAnalysisService deep;
    @Autowired InvestmentAdviceService invest;
    @Autowired ClaimService claims;
    @Autowired AppSettingsService settings;

    private static Long savings;
    private static boolean seeded;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        if (seeded) return;   // one shared ledger for the tests of this class
        seeded = true;
        savings = accounts.create(new AccountRequest(null, "Savings " + System.nanoTime(), AccountType.BANK, "HDFC", null, bd(400000),
                LocalDate.now().minusMonths(12), BigDecimal.valueOf(3.5), null, null, null, null, true, null)).id();
        accounts.create(new AccountRequest(null, "FD " + System.nanoTime(), AccountType.FIXED_DEPOSIT, "SBI", null, bd(100000),
                LocalDate.now().minusMonths(12), BigDecimal.valueOf(7.1), null, null, null, null, true, null)).id();
        Long income = categories.list().stream().filter(c -> c.kind() == CategoryKind.INCOME && !c.system()).findFirst().orElseThrow().id();
        var expenseCats = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && !c.system()).toList();
        // eight complete months: a salary, rent that never changes, groceries that creep up, and one month with a big medical bill
        for (int k = 8; k >= 1; k--) {
            LocalDate first = LocalDate.now().minusMonths(k).withDayOfMonth(1);
            transactions.postQuick(new QuickTransactionRequest(QuickKind.INCOME, first, bd(90000), null, savings, income, "Salary", null, null));
            transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, first.plusDays(2), bd(25000), savings, null, expenseCats.get(0).id(), "Rent", null, null));
            for (int d = 0; d < 6; d++) {
                transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, first.plusDays(4 + d * 4), bd(1200 + (8 - k) * 90 + d * 35), savings, null,
                        expenseCats.get(1 % expenseCats.size()).id(), "Groceries " + d, null, null));
            }
            if (k == 5) {
                transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, first.plusDays(9), bd(38000), savings, null, expenseCats.get(2 % expenseCats.size()).id(), "Hospital", null, null));
            }
        }
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void theDeepAnalysisSaysSomethingSensibleAboutEightMonths() {
        var r = deep.analyse(LocalDate.now().minusMonths(8).withDayOfMonth(1), LocalDate.now());
        assertThat(r.enough()).isTrue();
        assertThat(r.unit()).isEqualTo("month");
        assertThat(r.summary().mean()).isBetween(30000.0, 60000.0);
        assertThat(r.trend().direction()).isIn("rising", "flat");
        assertThat(r.trend().tau()).isBetween(-1.0, 1.0);
        assertThat(r.trend().mkP()).isBetween(0.0, 1.0);
        assertThat(r.forecast().low()).isLessThanOrEqualTo(r.forecast().ols());
        assertThat(r.forecast().high()).isGreaterThanOrEqualTo(r.forecast().ols());
        assertThat(r.forecast().p95()).isGreaterThanOrEqualTo(r.forecast().p80());
        assertThat(r.control()).isNotNull();
        assertThat(r.categories()).isNotEmpty();
        assertThat(r.categories().stream().anyMatch(c -> c.committed())).isTrue();   // the rent never changes
        assertThat(r.outliers()).anyMatch(o -> o.when().length() == 7 && o.amount() >= 38000);   // the big bill stands out
        assertThat(r.findings()).hasSizeGreaterThan(5);
        assertThat(r.advice()).isNotEmpty();
        assertThat(r.rhythm().days()).hasSize(7);
        assertThat(r.health()).isNotNull();
        assertThat(r.health().score()).isBetween(0.0, 100.0);
        assertThat(r.health().grade()).isIn("A", "B", "C", "D", "E");
        assertThat(r.health().parts()).hasSizeGreaterThanOrEqualTo(5);
        assertThat(r.opportunities()).isNotEmpty();   // the groceries and the hospital month run above their usual level
        assertThat(r.opportunities().getFirst().excess()).isGreaterThan(0);
        assertThat(r.opportunities().stream().mapToDouble(o -> o.share()).sum()).isBetween(0.5, 1.001);
    }

    @Test
    void aShortHistoryStillGetsAnAnalysisByWeeksAndNeverAnEmptyPage() {
        // about two months of data: not enough months, enough weeks (or at least a description)
        var r = deep.analyse(LocalDate.now().minusDays(70), LocalDate.now());
        assertThat(r.enough()).isTrue();
        assertThat(r.unit()).isIn("week", "none");
        assertThat(r.summary().expenses()).isGreaterThan(0);
        assertThat(r.findings()).isNotEmpty();
        // a month only: described, not modelled
        var tiny = deep.analyse(LocalDate.now().minusDays(40), LocalDate.now());
        assertThat(tiny.enough()).isTrue();
        assertThat(tiny.findings()).isNotEmpty();
        // nothing at all in the period: a clear message
        var none = deep.analyse(LocalDate.now().plusDays(1), LocalDate.now().plusDays(30));
        assertThat(none.enough()).isFalse();
        assertThat(none.message()).isNotBlank();
    }

    @Test
    void theInvestmentPlanLooksAtIncomeIdleBankMoneyAndASimulation() {
        var a = invest.advise(32, "balanced", 15, 5_000_000.0, 7.0);
        assertThat(a.enough()).isTrue();
        assertThat(a.profile().income()).isBetween(85000.0, 95000.0);
        assertThat(a.profile().incomeCv()).isBetween(0.0, 0.05);   // a steady salary
        assertThat(a.profile().emergencyMonths()).isEqualTo(6.0);
        assertThat(a.banks().accounts()).hasSizeGreaterThanOrEqualTo(1);
        assertThat(a.banks().averageYield()).isBetween(3.0, 4.0);
        assertThat(a.banks().idle()).isGreaterThan(0);              // far more than six months sits in savings
        assertThat(a.banks().idleLossPerYear()).isGreaterThan(0);
        assertThat(a.risk().volatility()).isGreaterThan(0);
        assertThat(a.risk().var95()).isLessThan(a.risk().expectedReturn());
        assertThat(a.simulation()).isNotEmpty();
        var s = a.simulation().get(1);   // ten years
        assertThat(s.p10()).isLessThan(s.p50());
        assertThat(s.p50()).isLessThan(s.p90());
        assertThat(s.p50()).isGreaterThan(s.invested());
        assertThat(a.fitness()).isNotNull();
        assertThat(a.fitness().score()).isBetween(0.0, 100.0);
        assertThat(a.fitness().parts()).hasSize(5);
        assertThat(a.fitness().parts().stream().mapToDouble(x -> x.weight()).sum()).isBetween(0.99, 1.01);
        assertThat(a.goal()).isNotNull();
        assertThat(a.goal().requiredSipSafe()).isGreaterThan(a.goal().requiredSip());   // 80% sure costs more than "on average"
        // the same inputs always give the same answer
        assertThat(invest.advise(32, "balanced", 15, 5_000_000.0, 7.0).simulation().get(1).p50()).isEqualTo(s.p50());
    }

    @Test
    void moneyLentWithoutInterestShowsWhatTheBankWouldHavePaid() {
        // the best rate among the bank, FD and RD accounts is the benchmark (7.1% here)
        var plain = claims.create(new ClaimRequest(ClaimKind.LENT, "Kiran " + System.nanoTime(), "Hand loan", bd(50000), LocalDate.now().minusDays(100), null,
                null, null, savings, null, null, null, null, null, null, null));
        assertThat(plain.benchmarkRate()).isEqualByComparingTo("7.1");
        assertThat(plain.forgoneInterest()).isBetween(BigDecimal.valueOf(960), BigDecimal.valueOf(985));   // 50,000 × 7.1% × 100 / 365
        // a rate set in Settings wins over the accounts
        settings.saveClaimBenchmark(UserContext.tenantId(), BigDecimal.valueOf(10));
        try {
            assertThat(claims.get(plain.id()).benchmarkRate()).isEqualByComparingTo("10");
            assertThat(claims.get(plain.id()).forgoneInterest()).isBetween(BigDecimal.valueOf(1360), BigDecimal.valueOf(1385));
        } finally {
            settings.saveClaimBenchmark(UserContext.tenantId(), null);
        }
        // an item that charges interest has no "loss"
        var charged = claims.create(new ClaimRequest(ClaimKind.LENT, "Ravi " + System.nanoTime(), "With interest", bd(50000), LocalDate.now().minusDays(100), null,
                BigDecimal.valueOf(12), null, savings, null, null, null, null, null, null, null));
        assertThat(charged.forgoneInterest()).isNull();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
