package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.InsightDtos.ExpenseLine;
import com.aditya.personalbudget.dto.InsightDtos.ForecastMonth;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BudgetService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.ForecastService;
import com.aditya.personalbudget.service.NotificationService;
import com.aditya.personalbudget.service.NotificationService.SettingsRequest;
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
import java.time.YearMonth;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** The projection's expenses come from the budgets; alerts by e-mail are queued for the events switched on. */
@SpringBootTest
class ForecastBudgetsAndAlertsTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-forecast-alerts-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired BudgetService budgets;
    @Autowired ForecastService forecast;
    @Autowired TransactionService transactions;
    @Autowired NotificationService notifications;

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

    @Test
    void aMonthTakesItsOwnBudgetElseTheAverageOfTheMonthsBudgeted() {
        Long cat = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active() && !c.name().toLowerCase().contains("chit"))
                .map(c -> c.id()).findFirst().orElseThrow();
        YearMonth now = YearMonth.now();
        budgets.save(new BudgetRequest(cat, BigDecimal.valueOf(3000), 80, null, null, now.minusMonths(2).toString(), null, null));
        budgets.save(new BudgetRequest(cat, BigDecimal.valueOf(5000), 80, null, null, now.minusMonths(1).toString(), null, null));
        budgets.save(new BudgetRequest(cat, BigDecimal.valueOf(9000), 80, null, null, now.plusMonths(2).toString(), null, null));

        var f = forecast.forecast(4, null, null, null);
        assertThat(f.expenseBasis()).isEqualTo("BUDGET");
        ExpenseLine next = line(f.rows().get(1), cat);
        assertThat(next.amount()).isEqualByComparingTo("5666.67");   // (3000 + 5000 + 9000) / 3
        assertThat(next.basis()).isEqualTo("BUDGET_AVG");
        ExpenseLine own = line(f.rows().get(2), cat);
        assertThat(own.amount()).isEqualByComparingTo("9000");
        assertThat(own.basis()).isEqualTo("BUDGET");
    }

    @Test
    void aTransferSwitchedOnIsQueuedAndASmallExpenseIsNot() {
        Long from = account("Alert bank", AccountType.BANK);
        Long to = account("Alert wallet", AccountType.WALLET);
        notifications.save(new SettingsRequest(true, "family@example.com", Map.of("TRANSFER", true, "LARGE_EXPENSE", true), true,
                BigDecimal.valueOf(10000), true));
        int before = notifications.overview().waiting();

        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.now(), BigDecimal.valueOf(2500), from, to, null,
                "Top up", null, null));
        assertThat(notifications.overview().waiting()).isEqualTo(before + 1);

        Long food = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active()).map(c -> c.id()).findFirst().orElseThrow();
        transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, LocalDate.now(), BigDecimal.valueOf(120), from, null, food,
                "Tea", null, null));
        assertThat(notifications.overview().waiting()).isEqualTo(before + 1);   // under the amount set: no alert
    }

    @Test
    void aCategoryNotWantingABudgetLeavesTheSuggestionsInEveryMonthUntilOneIsSet() {
        Long bank = account("Ignore bank", AccountType.BANK);
        Long cat = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active() && c.systemKey() == null).map(c -> c.id()).toList().get(4);
        YearMonth now = YearMonth.now();
        transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, LocalDate.now(), BigDecimal.valueOf(1500), bank, null, cat, "This month", null, null));
        transactions.postQuick(new QuickTransactionRequest(QuickKind.EXPENSE, LocalDate.now().minusMonths(1), BigDecimal.valueOf(900), bank, null, cat, "Last month", null, null));
        BigDecimal outsideBefore = budgets.summary(now).unbudgetedSpent();
        assertThat(lineOf(now, cat).budgetIgnored()).isFalse();

        categories.setBudgetIgnored(cat, true);
        var summary = budgets.summary(now);
        assertThat(lineOf(now, cat).budgetIgnored()).isTrue();
        assertThat(lineOf(now.minusMonths(1), cat).budgetIgnored()).isTrue();
        // the money still shows: it is apart, not gone
        assertThat(summary.unbudgetedSpent()).isEqualByComparingTo(outsideBefore);
        assertThat(summary.ignoredSpent()).isGreaterThanOrEqualTo(BigDecimal.valueOf(1500));

        // setting a budget by hand ends the choice
        budgets.save(new com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest(cat, BigDecimal.valueOf(2000), 80, null, null, now.toString(), null, null));
        assertThat(lineOf(now, cat).budgetId()).isNotNull();
        assertThat(lineOf(now.minusMonths(1), cat).budgetIgnored()).isFalse();
    }

    private com.aditya.personalbudget.dto.PlanningDtos.BudgetLine lineOf(YearMonth month, Long categoryId) {
        return budgets.summary(month).lines().stream().filter(l -> categoryId.equals(l.categoryId())).findFirst().orElseThrow();
    }

    private static ExpenseLine line(ForecastMonth row, Long categoryId) {
        return row.expenseLines().stream().filter(l -> categoryId.equals(l.categoryId())).findFirst().orElseThrow();
    }

    private Long account(String name, AccountType type) {
        return accounts.create(new AccountRequest(null, name + " " + System.nanoTime(), type, null, null, BigDecimal.valueOf(50000),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
    }
}
