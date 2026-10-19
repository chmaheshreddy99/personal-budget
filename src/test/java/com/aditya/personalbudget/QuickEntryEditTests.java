package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Incomes and transfers posted with the quick form carry an optional note, and are edited with that form: the
 * entry keeps its number while its amount, accounts, category and note change, and the balances follow.
 */
@SpringBootTest
class QuickEntryEditTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-quick-edit-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accountService;
    @Autowired AccountRepository accounts;
    @Autowired CategoryRepository categories;
    @Autowired TransactionService transactions;

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
    void anIncomeKeepsItsNoteAndIsEditedInPlace() {
        AccountView bank = bank("Quick Bank A");
        AccountView other = bank("Quick Bank B");
        List<Category> sources = categories.findByTenantIdAndKind(UserContext.tenantId(), CategoryKind.INCOME);
        Long salary = sources.getFirst().getId();
        Long another = sources.get(1).getId();

        EntryView posted = transactions.postQuick(income(bank.id(), salary, 50000, "October salary\nincl. arrears", null));
        assertThat(posted.notes()).isEqualTo("October salary\nincl. arrears");
        assertThat(posted.quickEdit()).isEqualTo("INCOME");
        assertThat(posted.reversible()).isTrue();
        assertThat(balance(bank.id())).isEqualByComparingTo("50000");

        EntryView edited = transactions.updateQuick(posted.id(), income(other.id(), another, 52000, "  Corrected  ", posted.version()));
        assertThat(edited.entryNo()).isEqualTo(posted.entryNo());
        assertThat(edited.amount()).isEqualByComparingTo("52000");
        assertThat(edited.notes()).isEqualTo("Corrected");
        assertThat(edited.lines()).anySatisfy(l -> assertThat(l.categoryId()).isEqualTo(another));
        assertThat(balance(bank.id())).isEqualByComparingTo("0");
        assertThat(balance(other.id())).isEqualByComparingTo("52000");

        // a blank note clears it; a stale screen is refused
        EntryView cleared = transactions.updateQuick(posted.id(), income(other.id(), another, 52000, " ", edited.version()));
        assertThat(cleared.notes()).isNull();
        assertThatThrownBy(() -> transactions.updateQuick(posted.id(), income(other.id(), another, 1, null, edited.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(transactions.search(null, null, null, null, "arrears", 10)).isEmpty();
    }

    @Test
    void aCardBillPaymentCarriesANoteAndCanBeEdited() {
        AccountView bank = bank("Bill Bank");
        AccountView card = accountService.create(new AccountRequest(null, "Bill Card", AccountType.CREDIT_CARD, null, null,
                null, null, null, bd(100000), null, null, null, true, null));

        EntryView paid = transactions.postQuick(transfer(bank.id(), card.id(), 8000, "Paid the full Sep statement", null));
        assertThat(paid.notes()).isEqualTo("Paid the full Sep statement");
        assertThat(paid.quickEdit()).isEqualTo("TRANSFER");
        assertThat(transactions.search(null, null, null, null, "sep statement", 10)).extracting(EntryView::id).containsExactly(paid.id());

        EntryView edited = transactions.updateQuick(paid.id(), transfer(bank.id(), card.id(), 7500, "Minimum due only", paid.version()));
        assertThat(edited.amount()).isEqualByComparingTo("7500");
        assertThat(edited.notes()).isEqualTo("Minimum due only");
        assertThat(balance(bank.id())).isEqualByComparingTo("-7500");

        // a transfer stays a transfer
        Long salary = categories.findByTenantIdAndKind(UserContext.tenantId(), CategoryKind.INCOME).getFirst().getId();
        assertThatThrownBy(() -> transactions.updateQuick(paid.id(), income(bank.id(), salary, 7500, null, edited.version())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("stays one");
    }

    @Test
    void aReversedEntryAndOtherPostingsAreNotEditedWithTheQuickForm() {
        AccountView bank = bank("Reverse Bank");
        AccountView second = bank("Reverse Bank 2");
        EntryView moved = transactions.postQuick(transfer(bank.id(), second.id(), 1000, null, null));
        EntryView reversal = transactions.reverse(moved.id(), null);

        assertThat(transactions.get(moved.id()).quickEdit()).isNull();
        assertThatThrownBy(() -> transactions.updateQuick(moved.id(), transfer(bank.id(), second.id(), 900, null, moved.version())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("cannot be edited");
        assertThatThrownBy(() -> transactions.updateQuick(reversal.id(), transfer(bank.id(), second.id(), 900, null, reversal.version())))
                .isInstanceOf(BusinessException.class);
    }

    private AccountView bank(String name) {
        return accountService.create(new AccountRequest(null, name, AccountType.BANK, "HDFC Bank", null, BigDecimal.ZERO,
                LocalDate.of(2026, 1, 1), null, null, null, null, null, true, null));
    }

    private static QuickTransactionRequest income(Long into, Long category, long amount, String notes, Long version) {
        return new QuickTransactionRequest(QuickKind.INCOME, LocalDate.of(2026, 10, 1), bd(amount), null, into, category,
                null, null, null, notes, version);
    }

    private static QuickTransactionRequest transfer(Long from, Long to, long amount, String notes, Long version) {
        return new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.of(2026, 10, 5), bd(amount), from, to, null,
                null, null, null, notes, version);
    }

    private BigDecimal balance(Long accountId) {
        return accounts.findById(accountId).orElseThrow().getBalance();
    }

    private static BigDecimal bd(long value) {
        return BigDecimal.valueOf(value).setScale(2);
    }
}
