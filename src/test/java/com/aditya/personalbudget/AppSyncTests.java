package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.AppSyncService;
import com.aditya.personalbudget.service.AppSyncService.SyncExpense;
import com.aditya.personalbudget.service.AppSyncService.SyncRequest;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.LedgerService;
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

/** The phone app's API: the snapshot it keeps offline, and expenses recorded offline synced once however often sent. */
@SpringBootTest
class AppSyncTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-app-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired AppSyncService app;
    @Autowired LedgerService ledger;
    @Autowired com.aditya.personalbudget.service.ChitService chits;

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
    void anExpenseRecordedOfflineIsBookedOnceHoweverOftenItIsSynced() {
        Long bank = accounts.create(new AccountRequest(null, "Phone bank " + System.nanoTime(), AccountType.BANK, "HDFC", "50100012344321", BigDecimal.valueOf(10000),
                LocalDate.now().minusDays(10), null, null, null, null, null, true, null)).id();
        Long category = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && !c.system()).findFirst().orElseThrow().id();
        var snap = app.snapshot(30);
        var mine = snap.accounts().stream().filter(a -> a.id().equals(bank)).findFirst().orElseThrow();
        assertThat(mine.group()).isEqualTo("OWN");
        assertThat(mine.payFrom()).isTrue();
        assertThat(mine.last4()).isEqualTo("4321");
        assertThat(snap.categories()).anyMatch(c -> c.id().equals(category));
        assertThat(snap.categories()).anyMatch(c -> "EXPENSE".equals(c.kind()) && "Chit Payments".equals(c.name()));
        assertThat(snap.categories()).anyMatch(c -> "INCOME".equals(c.kind()) && "Chit Commission Income".equals(c.name()));

        SyncExpense e = new SyncExpense("phone-" + System.nanoTime(), LocalDate.now(), BigDecimal.valueOf(750), category, bank, "Lunch", "Cafe", "UPI123", null);
        var first = app.sync(new SyncRequest(List.of(e), null));
        assertThat(first).singleElement().satisfies(r -> {
            assertThat(r.status()).isEqualTo("CREATED");
            assertThat(r.entryNo()).isNotBlank();
        });
        // the app lost the answer and sends it again: recognised, not booked twice
        var again = app.sync(new SyncRequest(List.of(e), null));
        assertThat(again).singleElement().satisfies(r -> {
            assertThat(r.status()).isEqualTo("DUPLICATE");
            assertThat(r.entryNo()).isEqualTo(first.getFirst().entryNo());
        });
        assertThat(ledger.snapshot().balanceAsOf(bank, LocalDate.now())).isEqualByComparingTo("9250");
        assertThat(app.snapshot(30).expenses()).anyMatch(x -> x.entryNo().equals(first.getFirst().entryNo()));

        // one that cannot be booked fails on its own, the others go through
        var mixed = app.sync(new SyncRequest(List.of(
                new SyncExpense("phone-bad-" + System.nanoTime(), LocalDate.now(), BigDecimal.ONE, category, 999999L, null, null, null, null),
                new SyncExpense("phone-ok-" + System.nanoTime(), LocalDate.now(), BigDecimal.TEN, category, bank, null, null, null, null)), null));
        assertThat(mixed).extracting(AppSyncService.SyncResult::status).containsExactly("FAILED", "CREATED");
        assertThat(app.statement(bank, 30).rows()).hasSize(3);   // the opening balance and two expenses
    }

    @Test
    void aChitInstalmentPaidOnThePhoneIsPaidOnce() {
        Long bank = accounts.create(new AccountRequest(null, "Chit bank " + System.nanoTime(), AccountType.BANK, "SBI", null, BigDecimal.valueOf(50000),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
        var chit = chits.create(new com.aditya.personalbudget.dto.ChitDtos.ChitRequest("Phone chit " + System.nanoTime(), "Sri Ram", "T7",
                BigDecimal.valueOf(110000), BigDecimal.valueOf(5000), 20, LocalDate.now().minusMonths(2), null, null, null, null, null, null, bank, null, null));
        var snap = app.snapshot(30);
        var mine = snap.chits().stream().filter(c -> c.id().equals(chit.chit().id())).findFirst().orElseThrow();
        assertThat(snap.canPayChits()).isTrue();
        assertThat(mine.installments()).hasSize(20);
        var first = mine.installments().getFirst();
        var pay = new AppSyncService.SyncChitPayment("chit-" + System.nanoTime(), mine.id(), first.id(), LocalDate.now(), bank, BigDecimal.valueOf(500));
        assertThat(app.sync(new SyncRequest(null, List.of(pay)))).singleElement().satisfies(r -> assertThat(r.status()).isEqualTo("CREATED"));
        assertThat(app.sync(new SyncRequest(null, List.of(pay)))).singleElement().satisfies(r -> assertThat(r.status()).isEqualTo("DUPLICATE"));
        // paid again from another phone (another id): the instalment is already paid, so nothing more is booked
        var other = new AppSyncService.SyncChitPayment("chit-other-" + System.nanoTime(), mine.id(), first.id(), LocalDate.now(), bank, null);
        assertThat(app.sync(new SyncRequest(null, List.of(other)))).singleElement().satisfies(r -> assertThat(r.status()).isEqualTo("DUPLICATE"));
        assertThat(ledger.snapshot().balanceAsOf(bank, LocalDate.now())).isEqualByComparingTo("45500");
        assertThat(app.snapshot(30).chits().stream().filter(c -> c.id().equals(mine.id())).findFirst().orElseThrow().paidCount()).isEqualTo(1);
    }
}
