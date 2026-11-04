package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseItem;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.dto.JournalDtos.LineView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.InsurancePolicyRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.AppSyncService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.DocumentService;
import com.aditya.personalbudget.service.DocumentService.DocumentRequest;
import com.aditya.personalbudget.service.DocumentService.DocumentView;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.InsuranceService;
import com.aditya.personalbudget.service.InsuranceService.PayRequest;
import com.aditya.personalbudget.service.InsuranceService.PolicyRequest;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.service.ListOrderService;
import com.aditya.personalbudget.service.OrgClock;
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
import java.util.EnumSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Insurance policies in Documents: enrolled with the document, the premium recorded as an expense and moving the policy
 * on, undone, due alerts; the order lists are arranged in; and the running balance of each category on a journal line.
 */
@SpringBootTest
class InsuranceAndListOrderTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-insurance-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired ExpenseService expenses;
    @Autowired DocumentService documents;
    @Autowired InsuranceService insurance;
    @Autowired InsurancePolicyRepository policies;
    @Autowired ListOrderService orders;
    @Autowired AppSyncService sync;
    @Autowired LedgerService ledger;
    @Autowired TsvDataStore store;

    private Long bank;
    private CurrentUser admin;

    @BeforeEach
    void setUp() {
        AppUser user = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(user.getTenantId()).orElseThrow();
        admin = new CurrentUser(user.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false);
        UserContext.set(admin);
        bank = accounts.create(new AccountRequest(null, "Premium bank " + System.nanoTime(), AccountType.BANK, null, null, bd(500000),
                LocalDate.now().minusMonths(1), null, null, null, null, null, true, null)).id();
    }

    @AfterEach
    void tearDown() {
        UserContext.clear();
        store.endRequest();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }

    private static PolicyRequest policy(String frequency, LocalDate due, LocalDate lastPremium) {
        return new PolicyRequest("Family floater", "Self, Lakshmi", null, null, bd(1000000), bd(12000), frequency, due, lastPremium, 15,
                "ONLINE", null, null, "Star Health", "https://pay.example.com/star", "star@okbank", "CUST-1", "Ravi", "9000000000", "1800-000",
                "Have the policy number at hand", true, "30, 7,7, 1", "a@example.com, b@example.com");
    }

    private DocumentView enroll(String type, LocalDate expires, PolicyRequest policy) {
        return documents.create(new DocumentRequest("Policy " + System.nanoTime(), type, "Self", "Self", "P-1", "Star Health", null, expires, null, null, policy));
    }

    private long categoryNamed(String name) {
        return categories.list().stream().filter(c -> c.name().equals(name)).findFirst().orElseThrow().id();
    }

    private PayRequest pay(LocalDate due) {
        return new PayRequest(LocalDate.now(), bd(12000), bank, null, due, "UTR1", null);
    }

    @Test
    void enrolledWithTheDocumentAndCleaned() {
        LocalDate due = LocalDate.now().plusDays(5);
        DocumentView d = enroll("INSURANCE_HEALTH", null, policy("YEARLY", due, null));
        assertThat(d.policy().premium()).isEqualByComparingTo("12000");
        assertThat(d.policy().status()).isEqualTo("DUE_SOON");
        assertThat(d.policy().daysToDue()).isEqualTo(5);
        assertThat(d.policy().reminderDays()).isEqualTo("30,7,1");
        assertThat(d.policy().emailTo()).isEqualTo("a@example.com,b@example.com");
        assertThat(insurance.due()).anyMatch(p -> p.documentId().equals(d.id()));
        assertThat(documents.list()).filteredOn(x -> x.id().equals(d.id())).first().satisfies(x -> assertThat(x.policy()).isNotNull());
    }

    @Test
    void refusesWhatCannotBePaidWith() {
        PolicyRequest badUrl = new PolicyRequest(null, null, null, null, null, bd(100), "YEARLY", LocalDate.now(), null, null, null, null, null, null,
                "javascript:alert(1)", null, null, null, null, null, null, false, null, null);
        assertThatThrownBy(() -> enroll("INSURANCE_LIFE", null, badUrl)).isInstanceOf(BusinessException.class).hasMessageContaining("payment link");
        PolicyRequest noDue = new PolicyRequest(null, null, null, null, null, bd(100), "YEARLY", null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, false, null, null);
        assertThatThrownBy(() -> enroll("INSURANCE_LIFE", null, noDue)).isInstanceOf(BusinessException.class).hasMessageContaining("next premium");
    }

    @Test
    void paymentIsAnExpenseAndMovesThePolicyOn() {
        LocalDate due = LocalDate.now().plusDays(3);
        DocumentView d = enroll("INSURANCE_VEHICLE", due, policy("YEARLY", due, null));
        var paid = insurance.pay(d.id(), pay(due));

        EntryView entry = ledger.toViews(List.of(ledger.get(paid.entryId()))).getFirst();
        assertThat(entry.amount()).isEqualByComparingTo("12000");
        assertThat(entry.party()).isEqualTo("Star Health");
        assertThat(entry.lines()).anyMatch(l -> "Insurance Premiums".equals(l.accountName()));
        assertThat(expenses.list(LocalDate.now(), LocalDate.now())).anyMatch(r -> r.entryId().equals(paid.entryId()));
        assertThat(paid.nextDueDate()).isEqualTo(due.plusYears(1));
        assertThat(paid.expiresOn()).isEqualTo(due.plusYears(1));   // a renewal carries the cover on

        // the same premium again (a second tab, a double tap) is not booked twice
        assertThatThrownBy(() -> insurance.pay(d.id(), pay(due))).isInstanceOf(BusinessException.class).hasMessageContaining("already recorded");

        DocumentView after = documents.list().stream().filter(x -> x.id().equals(d.id())).findFirst().orElseThrow();
        assertThat(after.policy().payments()).hasSize(1);
        assertThat(after.policy().payments().getFirst().entryNo()).isEqualTo(paid.entryNo());
        insurance.undoPayment(d.id(), after.policy().payments().getFirst().id());
        DocumentView undone = documents.list().stream().filter(x -> x.id().equals(d.id())).findFirst().orElseThrow();
        assertThat(undone.policy().nextDueDate()).isEqualTo(due);
        assertThat(undone.expiresOn()).isEqualTo(due);
        assertThat(undone.policy().payments()).isEmpty();
        assertThat(expenses.list(LocalDate.now(), LocalDate.now())).noneMatch(r -> r.entryId().equals(paid.entryId()));
    }

    @Test
    void aLifePolicyStopsAtItsLastPremiumAndKeepsItsMaturity() {
        LocalDate due = LocalDate.now().plusDays(3);
        LocalDate maturity = LocalDate.now().plusYears(20);
        DocumentView d = enroll("INSURANCE_LIFE", maturity, policy("YEARLY", due, due));
        var paid = insurance.pay(d.id(), pay(due));
        assertThat(paid.nextDueDate()).isNull();
        assertThat(paid.expiresOn()).isEqualTo(maturity);
        assertThat(documents.list()).filteredOn(x -> x.id().equals(d.id())).first().satisfies(x -> assertThat(x.policy().status()).isEqualTo("PAID_UP"));
    }

    @Test
    void recordingNeedsExpenses() {
        LocalDate due = LocalDate.now().plusDays(3);
        DocumentView d = enroll("INSURANCE_HEALTH", null, policy("YEARLY", due, null));
        UserContext.set(new CurrentUser(admin.userId(), "admin", "Admin", UserRole.ADMIN, admin.tenantId(), admin.tenantCode(), admin.tenantName(), admin.currency(),
                EnumSet.of(Feature.DOCUMENTS), false, null, false));
        assertThatThrownBy(() -> insurance.pay(d.id(), pay(due))).isInstanceOf(ForbiddenException.class);
    }

    @Test
    void deletingTheDocumentTakesThePolicyButKeepsTheExpense() {
        LocalDate due = LocalDate.now().plusDays(3);
        DocumentView d = enroll("INSURANCE_HEALTH", null, policy("YEARLY", due, null));
        var paid = insurance.pay(d.id(), pay(due));
        documents.delete(d.id());
        assertThat(policies.findByDocumentId(d.id())).isEmpty();
        assertThat(expenses.list(LocalDate.now(), LocalDate.now())).anyMatch(r -> r.entryId().equals(paid.entryId()));
    }

    @Test
    void aReminderIsNotedAndTriedAgainWhenItCouldNotGo() {
        LocalDate due = OrgClock.today().plusDays(5);
        DocumentView d = enroll("INSURANCE_HEALTH", null, policy("YEARLY", due, null));
        insurance.sendDue();   // no e-mail is set up here: nothing goes, and the reason is kept on the policy
        var p = policies.findByDocumentId(d.id()).orElseThrow();
        assertThat(p.getLastReminderResult()).startsWith("Not sent");
        assertThat(p.getLastReminderDue()).isNull();
    }

    @Test
    void listOrderIsSavedAndFollowedByThePhone() {
        Long second = accounts.create(new AccountRequest(null, "Second bank " + System.nanoTime(), AccountType.BANK, null, null, bd(1),
                LocalDate.now().minusMonths(1), null, null, null, null, null, true, null)).id();
        orders.save("accounts", List.of(second, bank));
        assertThat(orders.orders().get("accounts")).containsExactly(second, bank);
        var snapshot = sync.snapshot(30);
        assertThat(snapshot.listOrder().get("accounts")).containsExactly(second, bank);
        assertThat(snapshot.accounts().getFirst().id()).isEqualTo(second);
        assertThat(snapshot.accounts().get(1).id()).isEqualTo(bank);
        orders.save("accounts", List.of());
        assertThat(orders.orders()).doesNotContainKey("accounts");
        assertThatThrownBy(() -> orders.save("nonsense", List.of(1L))).isInstanceOf(BusinessException.class);
    }

    @Test
    void eachLineSaysWhatItsCategoryStandsAtAndThePhoneGetsTheItems() {
        long groceries = categoryNamed("Groceries");
        long stationery = categories.list().stream().filter(c -> c.id() != groceries && c.kind().name().equals("EXPENSE")).findFirst().orElseThrow().id();
        EntryView first = expenses.create(new ExpenseRequest(LocalDate.now(), bd(100), groceries, bank, "First", null, null, null, null));
        EntryView posted = expenses.create(new ExpenseRequest(LocalDate.now(), bd(160), null, bank, "Bill", "Shop", null, null, null,
                List.of(new ExpenseItem(groceries, bd(60), "Rice"), new ExpenseItem(stationery, bd(50), "Pens"), new ExpenseItem(groceries, bd(50), "Dal"))));
        store.endRequest();   // the balances are worked out when the ledger is read afresh
        EntryView bill = ledger.toViews(List.of(ledger.get(posted.id()))).getFirst();
        first = ledger.toViews(List.of(ledger.get(first.id()))).getFirst();
        BigDecimal before = first.lines().stream().filter(l -> l.categoryId() != null).findFirst().orElseThrow().categoryBalanceAfter();
        List<LineView> ofGroceries = bill.lines().stream().filter(l -> Long.valueOf(groceries).equals(l.categoryId())).toList();
        assertThat(ofGroceries).hasSize(2);
        assertThat(ofGroceries.getFirst().categoryBalanceBefore()).isEqualByComparingTo(before);
        assertThat(ofGroceries.getLast().categoryBalanceAfter()).isEqualByComparingTo(before.add(bd(110)));
        // the lines of Expenses run on one after the other, so the first's before and the last's after are the whole change
        List<LineView> ofExpenses = bill.lines().stream().filter(l -> l.categoryId() != null).toList();
        assertThat(ofExpenses.getLast().balanceAfter().subtract(ofExpenses.getFirst().balanceBefore())).isEqualByComparingTo("160");

        var rows = sync.snapshot(30).expenses().stream().filter(x -> x.entryId().equals(bill.id())).toList();
        assertThat(rows).hasSize(3).allMatch(AppSyncService.AppExpense::itemized);
        assertThat(rows).extracting(AppSyncService.AppExpense::memo).containsExactlyInAnyOrder("Rice", "Pens", "Dal");
    }
}
