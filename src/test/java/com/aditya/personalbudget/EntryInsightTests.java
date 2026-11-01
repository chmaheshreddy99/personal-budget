package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.EntryInsightService;
import com.aditya.personalbudget.service.EntryInsightService.EntryInsights;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.storage.TsvDataStore;
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

/** The open row of an entry explains it: its category's month and budget, the usual size, whether it repeats, a twin. */
@SpringBootTest
class EntryInsightTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-insight-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired ExpenseService expenses;
    @Autowired EntryInsightService insights;
    @Autowired TsvDataStore store;

    private Long bank;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = accounts.create(new AccountRequest(null, "Insight bank " + System.nanoTime(), AccountType.BANK, null, null, BigDecimal.valueOf(100000),
                LocalDate.now().minusMonths(8), null, null, null, null, null, true, null)).id();
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void aMonthlyBillIsSeenWithItsBudgetItsUsualSizeAndATwin() {
        Long milk = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.name().equals("Milk & Dairy")).findFirst().orElseThrow().id();
        LocalDate thisMonth = LocalDate.now().withDayOfMonth(5);
        for (int m = 4; m >= 1; m--) {
            expenses.create(new ExpenseRequest(thisMonth.minusMonths(m), BigDecimal.valueOf(1000), milk, bank, "Milk bill", "Ramesh Dairy", null, null, null));
        }
        Long current = expenses.create(new ExpenseRequest(thisMonth, BigDecimal.valueOf(1500), milk, bank, "Milk bill", "Ramesh Dairy", null, null, null)).id();
        Budget b = new Budget();
        b.setTenantId(UserContext.tenantId());
        b.setCategoryId(milk);
        b.setMonth(thisMonth.toString().substring(0, 7));
        b.setMonthlyLimit(BigDecimal.valueOf(2000));
        b.setAlertPercent(80);
        b.setCommitted(false);
        store.save(Budget.class, b);
        // the same bill typed in again the next day
        Long twin = expenses.create(new ExpenseRequest(thisMonth.plusDays(1), BigDecimal.valueOf(1500), milk, bank, "Milk", "ramesh dairy", null, null, null)).id();

        EntryInsights in = insights.insights(current);
        var cat = in.categories().getFirst();
        assertThat(cat.name()).isEqualTo("Milk & Dairy");
        assertThat(cat.monthTotal()).isEqualByComparingTo("3000");   // this one and its twin
        assertThat(cat.budget()).isEqualByComparingTo("2000");
        assertThat(cat.budgetPercent()).isEqualByComparingTo("150");
        assertThat(cat.usual()).isEqualByComparingTo("1000");
        assertThat(cat.ratio()).isEqualByComparingTo("1.5");

        var p = in.pattern();
        assertThat(p.by()).isEqualTo("PARTY");
        assertThat(p.count()).isGreaterThanOrEqualTo(5);
        assertThat(p.cadence()).isIn("MONTHLY", "IRREGULAR");   // the twin a day later is an odd gap
        assertThat(p.changePercent()).isPositive();

        assertThat(in.duplicates()).singleElement().satisfies(d -> {
            assertThat(d.entryId()).isEqualTo(twin);
            assertThat(d.reason()).contains("same amount and shop");
        });
    }

    @Test
    void aBillThatRepeatsEveryMonthSaysWhenTheNextOneIsDue() {
        Long rent = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.name().equals("Rent")).findFirst().orElseThrow().id();
        LocalDate day = LocalDate.now().withDayOfMonth(3);
        Long last = null;
        for (int m = 5; m >= 0; m--) {
            last = expenses.create(new ExpenseRequest(day.minusMonths(m), BigDecimal.valueOf(15000), rent, bank, "House rent", "Landlord Rao", null, null, null)).id();
        }
        var p = insights.insights(last).pattern();
        assertThat(p.cadence()).isEqualTo("MONTHLY");
        assertThat(p.usualDay()).isEqualTo(3);
        assertThat(p.nextExpected()).isEqualTo(day.plusMonths(1));
        assertThat(p.changePercent()).isEqualByComparingTo("0");
        assertThat(insights.insights(last).duplicates()).isEmpty();
    }
}
