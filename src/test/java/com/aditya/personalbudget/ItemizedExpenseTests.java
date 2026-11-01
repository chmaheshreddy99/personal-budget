package com.aditya.personalbudget;

import com.aditya.personalbudget.config.NewDefaultCategories;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseItem;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.ExpenseService.ExpenseRow;
import com.aditya.personalbudget.service.ExpenseService.ItemView;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * One bill paid at once, split into what was bought: each item in its own category, one payment; edited to add items;
 * refunded item by item; reversed as a whole. And the split default categories (Eggs, Fruits, Dry Fruits).
 */
@SpringBootTest
class ItemizedExpenseTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-itemized-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired ExpenseService expenses;
    @Autowired TsvDataStore store;
    @Autowired NewDefaultCategories newDefaults;

    private Long bank;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = accounts.create(new AccountRequest(null, "Bill bank " + System.nanoTime(), AccountType.BANK, null, null, bd(10000),
                LocalDate.now().minusMonths(1), null, null, null, null, null, true, null)).id();
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void theSplitDefaultsAreThere() {
        List<String> names = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE).map(CategoryView::name).toList();
        assertThat(names).contains("Meat & Fish", "Eggs", "Vegetables", "Fruits", "Dry Fruits", "Fuel", "Transportation",
                        "Refined Oils", "Cold Pressed Oils", "Millets")
                .doesNotContain("Meat, Fish & Eggs", "Vegetables & Fruits", "Fuel & Transport");
        assertThat(names.stream().filter("Fuel"::equals)).hasSize(1);
    }

    /** Books from before: "Fuel & Transport" and a separate "Fuel" become one "Fuel", with all that was under either. */
    @Test
    void fuelAndTransportTakesInTheSeparateFuelCategory() throws Exception {
        Long tenantId = UserContext.tenantId();
        Category old = store.findAll(Category.class, c -> c.getTenantId().equals(tenantId) && c.getName().equals("Fuel")).getFirst();
        old.setName("Fuel & Transport");
        store.save(Category.class, old);
        Category fuel = new Category();
        fuel.setTenantId(tenantId);
        fuel.setKind(CategoryKind.EXPENSE);
        fuel.setCode("5470");
        fuel.setName("Fuel");
        fuel.setActive(true);
        fuel.setCreatedAt(java.time.LocalDateTime.now());
        Long fuelId = store.save(Category.class, fuel).getId();
        EntryView petrol = expenses.create(new ExpenseRequest(LocalDate.now(), bd(1500), fuelId, bank, "Petrol", null, null, null, null));
        EntryView metro = expenses.create(new ExpenseRequest(LocalDate.now(), bd(60), old.getId(), bank, "Metro", null, null, null, null));
        String month = LocalDate.now().toString().substring(0, 7);
        budget(old.getId(), month, 2000);
        budget(fuelId, month, 3000);

        Method merge = NewDefaultCategories.class.getDeclaredMethod("mergeFuel");
        merge.setAccessible(true);
        merge.invoke(org.springframework.test.util.AopTestUtils.getTargetObject(newDefaults));   // the bean itself, not its proxy

        assertThat(store.findAll(Category.class, c -> c.getId().equals(fuelId))).isEmpty();
        assertThat(store.findAll(Category.class, c -> c.getId().equals(old.getId())).getFirst().getName()).isEqualTo("Fuel");
        assertThat(rows(petrol.id()).getFirst().categoryId()).isEqualTo(old.getId());
        assertThat(rows(metro.id()).getFirst().categoryId()).isEqualTo(old.getId());
        List<Budget> budgets = store.findAll(Budget.class, b -> b.getTenantId().equals(tenantId) && b.getMonth().equals(month)
                && (b.getCategoryId().equals(old.getId()) || b.getCategoryId().equals(fuelId)));
        assertThat(budgets).singleElement().satisfies(b -> assertThat(b.getMonthlyLimit()).isEqualByComparingTo("5000"));
    }

    @Test
    void aBillSplitIntoItemsIsOnePaymentWithOneLinePerItem() {
        Long groceries = category("Groceries"), eggs = category("Eggs"), care = category("Personal Care");
        EntryView bill = expenses.create(bill("1240", "DMart", item(groceries, "900", "Rice, dal, oil"), item(eggs, "140", "Tray of 30"),
                item(care, "200", "Shampoo")));
        assertThat(bill.lines()).hasSize(4);
        assertThat(bill.amount()).isEqualByComparingTo("1240");
        assertThat(balance()).isEqualByComparingTo("8760");

        List<ExpenseRow> rows = rows(bill.id());
        assertThat(rows).hasSize(3).allSatisfy(r -> {
            assertThat(r.itemized()).isTrue();
            assertThat(r.editable()).isTrue();
            assertThat(r.billAmount()).isEqualByComparingTo("1240");
            assertThat(r.items()).hasSize(3);
            assertThat(r.narration()).isEqualTo("DMart");
        });
        assertThat(rows).extracting(ExpenseRow::categoryId).containsExactlyInAnyOrder(groceries, eggs, care);
        assertThat(rows.stream().filter(r -> r.categoryId().equals(eggs)).findFirst().orElseThrow().memo()).isEqualTo("Tray of 30");

        // the items must add up to the bill
        assertThatThrownBy(() -> expenses.create(bill("1000", "DMart", item(groceries, "900", null), item(eggs, "140", null))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("add up to 1040");
    }

    @Test
    void itemsAreAddedToAnExpenseAndASplitDownToOneItemIsAPlainExpense() {
        Long groceries = category("Groceries"), fruits = category("Fruits");
        EntryView plain = expenses.create(new ExpenseRequest(LocalDate.now(), bd(500), groceries, bank, "Ratnadeep", null, null, null, null));
        ExpenseRow row = rows(plain.id()).getFirst();
        assertThat(row.itemized()).isFalse();

        // split it: the same 500, now 380 groceries and 120 fruit
        expenses.update(plain.id(), new ExpenseRequest(LocalDate.now(), bd(500), null, bank, "Ratnadeep", null, null, "Weekly", row.version(),
                List.of(item(groceries, "380", null), item(fruits, "120", "Bananas"))));
        List<ExpenseRow> rows = rows(plain.id());
        assertThat(rows).hasSize(2);
        assertThat(rows.getFirst().billNotes()).isEqualTo("Weekly");
        assertThat(balance()).isEqualByComparingTo("9500");

        // back to one item: a plain expense in that category
        expenses.update(plain.id(), new ExpenseRequest(LocalDate.now(), bd(380), null, bank, "Ratnadeep", null, null, null, rows.getFirst().version(),
                List.of(item(groceries, "380", "Just groceries"))));
        rows = rows(plain.id());
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().itemized()).isFalse();
        assertThat(rows.getFirst().categoryId()).isEqualTo(groceries);
        assertThat(rows.getFirst().memo()).isEqualTo("Just groceries");
    }

    @Test
    void anItemIsRefundedOnItsOwnAndTheBillIsReversedAsAWhole() {
        Long groceries = category("Groceries"), dry = category("Dry Fruits");
        EntryView bill = expenses.create(bill("1000", null, item(groceries, "600", null), item(dry, "400", "Cashews")));
        assertThat(bill.narration()).isEqualTo("Groceries & Dry Fruits");
        ItemView cashews = rows(bill.id()).getFirst().items().stream().filter(i -> i.categoryId().equals(dry)).findFirst().orElseThrow();

        assertThatThrownBy(() -> expenses.refund(bill.id(), new ExpenseService.RefundRequest(LocalDate.now(), bd(100), null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Pick the item");
        assertThatThrownBy(() -> expenses.refund(bill.id(), new ExpenseService.RefundRequest(LocalDate.now(), bd(500), null, null, cashews.lineId())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Only 400");
        EntryView back = expenses.refund(bill.id(), new ExpenseService.RefundRequest(LocalDate.now(), bd(150), null, "Half packet back", cashews.lineId()));
        assertThat(back.lines()).anyMatch(l -> dry.equals(l.categoryId()) && l.credit().compareTo(bd(150)) == 0);

        List<ExpenseRow> rows = rows(bill.id());
        ExpenseRow dryRow = rows.stream().filter(r -> r.categoryId().equals(dry)).findFirst().orElseThrow();
        ExpenseRow groceryRow = rows.stream().filter(r -> r.categoryId().equals(groceries)).findFirst().orElseThrow();
        assertThat(dryRow.netAmount()).isEqualByComparingTo("250");
        assertThat(dryRow.status()).isEqualTo("PARTLY_REFUNDED");
        assertThat(groceryRow.netAmount()).isEqualByComparingTo("600");
        assertThat(groceryRow.status()).isNull();
        assertThat(groceryRow.editable()).isFalse();   // a refund is undone before the bill is changed
        assertThat(groceryRow.refundable()).isTrue();

        // reversing takes off what is left of each item, in its own category
        EntryView reversal = expenses.reverse(bill.id(), null);
        assertThat(reversal.amount()).isEqualByComparingTo("850");
        rows = rows(bill.id());
        assertThat(rows).allSatisfy(r -> {
            assertThat(r.status()).isEqualTo("REVERSED");
            assertThat(r.netAmount()).isEqualByComparingTo("0");
            assertThat(r.refundable()).isFalse();
        });
        assertThat(balance()).isEqualByComparingTo("10000");
    }

    // ------------------------------------------------------------------ helpers

    private void budget(Long categoryId, String month, long limit) {
        Budget b = new Budget();
        b.setTenantId(UserContext.tenantId());
        b.setCategoryId(categoryId);
        b.setMonth(month);
        b.setMonthlyLimit(bd(limit));
        b.setAlertPercent(80);
        b.setCommitted(false);
        store.save(Budget.class, b);
    }

    private List<ExpenseRow> rows(Long entryId) {
        return expenses.list(LocalDate.now().minusDays(1), LocalDate.now()).stream().filter(r -> r.entryId().equals(entryId)).toList();
    }

    private Long category(String name) {
        return categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.name().equals(name)).findFirst().orElseThrow().id();
    }

    private ExpenseRequest bill(String total, String narration, ExpenseItem... items) {
        return new ExpenseRequest(LocalDate.now(), new BigDecimal(total), null, bank, narration, null, null, null, null, List.of(items));
    }

    private static ExpenseItem item(Long category, String amount, String name) {
        return new ExpenseItem(category, new BigDecimal(amount), name);
    }

    private BigDecimal balance() {
        return accounts.require(bank).getBalance();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
