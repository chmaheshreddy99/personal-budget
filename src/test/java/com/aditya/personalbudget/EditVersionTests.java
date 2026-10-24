package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.dto.JournalDtos.LineRequest;
import com.aditya.personalbudget.dto.JournalDtos.ManualJournalRequest;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryRequest;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryView;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BudgetService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.TransactionService;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Optimistic locking of what is edited from a form: journal entries (expenses and manual vouchers), categories and
 * budgets. An edit carries the version the form was loaded with; a stale one, or one without a version, is refused
 * and changes nothing.
 */
@SpringBootTest
class EditVersionTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-edit-version-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired BudgetService budgets;
    @Autowired ExpenseService expenses;
    @Autowired TransactionService transactions;
    @Autowired JournalEntryRepository entries;

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
    void aStaleOrVersionlessEditOfAnExpenseIsRefusedAndChangesNothing() {
        Long cash = accounts.systemAccount(DefaultChartOfAccounts.CASH).getId();
        Long category = expenseCategory().id();
        EntryView posted = expenses.create(expense(category, cash, "250", null));

        EntryView edited = expenses.update(posted.id(), expense(category, cash, "300", posted.version()));
        assertThat(edited.version()).isEqualTo(posted.version() + 1);

        assertThatThrownBy(() -> expenses.update(posted.id(), expense(category, cash, "999", posted.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThatThrownBy(() -> expenses.update(posted.id(), expense(category, cash, "999", null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(entries.findById(posted.id()).orElseThrow().getAmount()).isEqualByComparingTo("300");
        assertThat(entries.findById(posted.id()).orElseThrow().getVersion()).isEqualTo(edited.version());
    }

    @Test
    void aStaleOrVersionlessEditOfAManualJournalIsRefused() {
        Long cash = accounts.systemAccount(DefaultChartOfAccounts.CASH).getId();
        Long bank = accounts.create(new AccountRequest(null, "Journal Bank " + System.nanoTime(), AccountType.BANK, "SBI", null,
                null, null, null, null, null, null, null, true, null)).id();
        EntryView posted = transactions.createJournal(journal(bank, cash, "100", null));

        EntryView edited = transactions.updateEntry(posted.id(), journal(bank, cash, "150", posted.version()));
        assertThatThrownBy(() -> transactions.updateEntry(posted.id(), journal(bank, cash, "175", posted.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThatThrownBy(() -> transactions.updateEntry(posted.id(), journal(bank, cash, "175", null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(transactions.get(posted.id()).amount()).isEqualByComparingTo("150");
        assertThat(transactions.get(posted.id()).version()).isEqualTo(edited.version());
    }

    @Test
    void aVersionlessEditOfACategoryIsRefused() {
        CategoryView created = categories.create(new CategoryRequest(CategoryKind.EXPENSE, "Versioned " + System.nanoTime(), null, null, true, null));
        assertThatThrownBy(() -> categories.update(created.id(), new CategoryRequest(CategoryKind.EXPENSE, "Renamed", null, null, true, null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(categories.update(created.id(), new CategoryRequest(CategoryKind.EXPENSE, "Renamed " + created.id(), null, null, true,
                created.version())).name()).isEqualTo("Renamed " + created.id());
    }

    @Test
    void settingABudgetSomeoneElseSetMeanwhileIsRefused() {
        Long category = expenseCategory().id();
        String month = YearMonth.now().plusMonths(3).toString();
        Budget set = budgets.save(new BudgetRequest(category, new BigDecimal("5000"), 80, null, null, month, false, null));
        // a second screen that still shows no budget for that month sets one too: it would overwrite the first
        assertThatThrownBy(() -> budgets.save(new BudgetRequest(category, new BigDecimal("7000"), 80, null, null, month, false, null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(budgets.save(new BudgetRequest(category, new BigDecimal("7000"), 80, null, set.getVersion(), month, false, null))
                .getMonthlyLimit()).isEqualByComparingTo("7000");
    }

    private CategoryView expenseCategory() {
        return categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active()).findFirst().orElseThrow();
    }

    private static ExpenseRequest expense(Long category, Long paidFrom, String amount, Long version) {
        return new ExpenseRequest(LocalDate.now(), new BigDecimal(amount), category, paidFrom, "Groceries", null, null, null, version);
    }

    private static ManualJournalRequest journal(Long debit, Long credit, String amount, Long version) {
        BigDecimal value = new BigDecimal(amount);
        return new ManualJournalRequest(LocalDate.now(), "Moved to the bank", null, null, List.of(
                new LineRequest(debit, null, null, value, null, null), new LineRequest(credit, null, null, null, value, null)), version);
    }
}
