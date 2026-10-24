package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.HostedChitBookService;
import com.aditya.personalbudget.service.HostedChitBookService.AccountInput;
import com.aditya.personalbudget.service.HostedChitBookService.BookAccount;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import com.aditya.personalbudget.domain.type.VoucherType;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Optimistic locking of accounts: every way an account is edited from a form carries the version the form was
 * loaded with, a stale one is refused, and one edit moves the version by exactly one.
 */
@SpringBootTest
class AccountVersionTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-account-version-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accountService;
    @Autowired AccountRepository accounts;
    @Autowired HostedChitBookService book;
    @Autowired LedgerService ledger;

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
    void aStaleEditOfAnAccountIsRefused() {
        AccountView bank = accountService.create(request("Version Bank", 0L));
        AccountView first = accountService.update(bank.id(), request("Version Bank A", bank.version()));
        assertThat(first.version()).isEqualTo(bank.version() + 1);

        assertThatThrownBy(() -> accountService.update(bank.id(), request("Version Bank B", bank.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(accounts.findById(bank.id()).orElseThrow().getName()).isEqualTo("Version Bank A");
    }

    @Test
    void anEditWithoutAVersionIsRefused() {
        AccountView bank = accountService.create(request("Versionless Bank", 0L));
        assertThatThrownBy(() -> accountService.update(bank.id(), request("Versionless Bank B", null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(accounts.findById(bank.id()).orElseThrow().getName()).isEqualTo("Versionless Bank");
    }

    @Test
    void aBalanceChangeIsNotAnEditAndDoesNotMakeAnOpenFormStale() {
        AccountView bank = accountService.create(request("Busy Bank", 0L));
        Long cash = accountService.systemAccount(DefaultChartOfAccounts.CASH).getId();
        ledger.post(JournalDraft.of(LocalDate.of(2026, 2, 1), VoucherType.TRANSFER, "Deposit")
                .debit(bank.id(), new BigDecimal("500")).credit(cash, new BigDecimal("500")));
        assertThat(accounts.findById(bank.id()).orElseThrow().getVersion()).isEqualTo(bank.version());

        AccountView renamed = accountService.update(bank.id(), request("Busy Bank Renamed", bank.version()));
        assertThat(renamed.name()).isEqualTo("Busy Bank Renamed");
        assertThat(renamed.balance()).isEqualByComparingTo("500");
    }

    @Test
    void aStaleEditOfTheBankDetailsIsRefused() {
        AccountView bank = accountService.create(request("Details Bank", 0L));
        accountService.updateBankDetails(bank.id(), new BankDetailsRequest("HDFC Bank", "1234", "Anna", null, "anna@okhdfc", bank.version()));
        assertThatThrownBy(() -> accountService.updateBankDetails(bank.id(),
                new BankDetailsRequest("HDFC Bank", "9999", "Bala", null, "bala@okhdfc", bank.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThatThrownBy(() -> accountService.updateBankDetails(bank.id(),
                new BankDetailsRequest("HDFC Bank", "9999", "Bala", null, "bala@okhdfc", null)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(accounts.findById(bank.id()).orElseThrow().getUpiId()).isEqualTo("anna@okhdfc");
    }

    @Test
    void aChitAccountEditMovesTheVersionByOneAndAStaleOneIsRefused() {
        BookAccount created = book.createAccount(input("Chit Collection", null));
        BookAccount edited = book.updateAccount(created.id(), input("Chit Collection A", created.version()));
        assertThat(edited.version()).isEqualTo(created.version() + 1);

        assertThatThrownBy(() -> book.updateAccount(created.id(), input("Chit Collection B", created.version())))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(accounts.findById(created.id()).orElseThrow().getName()).isEqualTo("Chit Collection A");
    }

    private static AccountRequest request(String name, Long version) {
        return new AccountRequest(null, name, AccountType.BANK, "HDFC Bank", null, null, null,
                null, null, null, null, null, true, version);
    }

    private static AccountInput input(String name, Long version) {
        return new AccountInput(name, AccountType.BANK, null, null, "HDFC Bank", null, null, null, null, true, version,
                null, null, null);
    }
}
