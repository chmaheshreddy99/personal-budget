package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.AccountLog;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountLogRepository;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountLedgerSync;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerService;
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
import java.util.Comparator;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The stored ledger figures: an account's balance follows every debit and credit, each journal line keeps the
 * balance right after it (in date order, also when an earlier entry comes in later), the opening balance never
 * changes, and every insert and update of an account lands in the account log.
 */
@SpringBootTest
class AccountLedgerTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-account-ledger-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accountService;
    @Autowired AccountRepository accounts;
    @Autowired AccountLogRepository logs;
    @Autowired JournalLineRepository lines;
    @Autowired LedgerService ledger;
    @Autowired AccountLedgerSync sync;
    @Autowired TsvDataStore store;

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
    void theBalanceAndLineSnapshotsFollowEveryPostingEditAndDelete() {
        AccountView bank = accountService.create(request("Ledger Bank", bd(1000), LocalDate.of(2026, 1, 1), null));
        Long cash = accountService.systemAccount(DefaultChartOfAccounts.CASH).getId();
        assertThat(balance(bank.id())).isEqualByComparingTo("1000");

        // 500 out on 1 March, then 200 in on 1 February: the later-posted, earlier-dated entry comes first
        JournalEntry march = ledger.post(JournalDraft.of(LocalDate.of(2026, 3, 1), VoucherType.TRANSFER, "To cash")
                .debit(cash, bd(500)).credit(bank.id(), bd(500)));
        JournalEntry feb = ledger.post(JournalDraft.of(LocalDate.of(2026, 2, 1), VoucherType.TRANSFER, "From cash")
                .debit(bank.id(), bd(200)).credit(cash, bd(200)));
        assertThat(balance(bank.id())).isEqualByComparingTo("700");
        assertThat(snapshots(bank.id())).containsExactly(bd(1000), bd(1200), bd(700));
        assertThat(before(bank.id())).containsExactly(bd(0), bd(1000), bd(1200));
        assertThat(accountService.get(bank.id()).balance()).isEqualByComparingTo("700");

        // editing an amount and then moving the entry after March moves the snapshots after it
        ledger.repost(feb.getId(), JournalDraft.of(LocalDate.of(2026, 4, 1), VoucherType.TRANSFER, "From cash")
                .debit(bank.id(), bd(300)).credit(cash, bd(300)));
        assertThat(balance(bank.id())).isEqualByComparingTo("800");
        assertThat(snapshots(bank.id())).containsExactly(bd(1000), bd(500), bd(800));

        ledger.delete(march.getId());
        assertThat(balance(bank.id())).isEqualByComparingTo("1300");
        assertThat(snapshots(bank.id())).containsExactly(bd(1000), bd(1300));

        // the other side moves too
        assertThat(balance(cash)).isEqualByComparingTo(sumOfLines(cash));
    }

    @Test
    void aLiabilityBalanceIsInItsNaturalSign() {
        AccountView card = accountService.create(new AccountRequest(null, "Ledger Card", AccountType.CREDIT_CARD, null, null,
                null, null, null, bd(50000), null, null, null, true, null));
        Long cash = accountService.systemAccount(DefaultChartOfAccounts.CASH).getId();
        ledger.post(JournalDraft.of(LocalDate.of(2026, 5, 1), VoucherType.TRANSFER, "Cash on the card")
                .debit(cash, bd(4000)).credit(card.id(), bd(4000)));
        assertThat(balance(card.id())).isEqualByComparingTo("4000");   // owed, positive
    }

    @Test
    void theOpeningBalanceCannotBeEdited() {
        AccountView bank = accountService.create(request("Opening Bank", bd(2500), LocalDate.of(2026, 1, 1), null));
        assertThatThrownBy(() -> accountService.update(bank.id(), request("Opening Bank", bd(3000), LocalDate.of(2026, 1, 1), bank.version())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("opening balance");

        // left out of a request (forms that do not show it): unchanged
        AccountView same = accountService.update(bank.id(), request("Opening Bank", null, null, bank.version()));
        assertThat(same.openingBalance()).isEqualByComparingTo("2500");
        assertThat(same.openingDate()).isEqualTo(LocalDate.of(2026, 1, 1));

        // other details still change, and the opening balance stays
        AccountView renamed = accountService.update(bank.id(), request("Opening Bank Two", bd(2500), LocalDate.of(2026, 1, 1), same.version()));
        assertThat(renamed.name()).isEqualTo("Opening Bank Two");
        assertThat(renamed.openingBalance()).isEqualByComparingTo("2500");
        assertThat(balance(bank.id())).isEqualByComparingTo("2500");

        // not even a direct save can change it, nor the balance
        Account raw = accounts.findById(bank.id()).orElseThrow();
        raw.setOpeningBalance(bd(1));
        assertThatThrownBy(() -> accounts.save(raw)).isInstanceOf(BusinessException.class);
        Account again = accounts.findById(bank.id()).orElseThrow();
        again.setBalance(bd(999999));
        accounts.save(again);
        assertThat(balance(bank.id())).isEqualByComparingTo("2500");
    }

    @Test
    void everyInsertAndUpdateOfAnAccountIsLogged() {
        AccountView bank = accountService.create(request("Logged Bank", bd(100), LocalDate.of(2026, 1, 1), null));
        Long tenantId = UserContext.tenantId();
        List<AccountLog> history = logs.findByAccountId(tenantId, bank.id()).reversed();
        assertThat(history).extracting(AccountLog::getAction).containsExactly(AccountLog.INSERT, AccountLog.BALANCE);
        assertThat(history.getLast().getBalance()).isEqualByComparingTo("100");
        assertThat(history.getLast().getPreviousBalance()).isEqualByComparingTo("0");
        assertThat(history.getFirst().getLoggedBy()).isEqualTo("admin");

        AccountView renamed = accountService.update(bank.id(), request("Logged Bank 2", bd(100), LocalDate.of(2026, 1, 1), bank.version()));
        AccountLog update = logs.findByAccountId(tenantId, bank.id()).getFirst();
        assertThat(update.getAction()).isEqualTo(AccountLog.UPDATE);
        assertThat(update.getChangedFields()).isEqualTo("name");
        assertThat(update.getName()).isEqualTo("Logged Bank 2");

        // a save that changes nothing adds nothing; a balance move does not stale an open edit form
        int before = logs.findByAccountId(tenantId, bank.id()).size();
        accountService.update(bank.id(), request("Logged Bank 2", bd(100), LocalDate.of(2026, 1, 1), renamed.version()));
        assertThat(logs.findByAccountId(tenantId, bank.id())).hasSize(before);
        AccountView form = accountService.get(bank.id());
        ledger.post(JournalDraft.of(LocalDate.of(2026, 2, 1), VoucherType.TRANSFER, "In")
                .debit(bank.id(), bd(50)).credit(accountService.systemAccount(DefaultChartOfAccounts.CASH).getId(), bd(50)));
        assertThat(logs.findByAccountId(tenantId, bank.id()).getFirst().getAction()).isEqualTo(AccountLog.BALANCE);
        accountService.update(bank.id(), request("Logged Bank 3", bd(100), LocalDate.of(2026, 1, 1), form.version()));
        assertThat(balance(bank.id())).isEqualByComparingTo("150");
    }

    @Test
    void theRebuildRepairsStoredFiguresAndChangesNothingWhenTheyAgree() {
        AccountView bank = accountService.create(request("Rebuilt Bank", bd(700), LocalDate.of(2026, 1, 1), null));
        // as if written before the figures were stored: no balance, no snapshots
        Account raw = accounts.findById(bank.id()).orElseThrow();
        raw.setBalance(null);
        store.saveKeepingVersion(Account.class, raw);
        lines.findByAccountId(bank.id()).forEach(l -> { l.setBalanceAfter(null); store.save(JournalLine.class, l); });
        // the commit puts them back at once (the lines were touched); the rebuild fills in what is left
        sync.rebuild();
        assertThat(balance(bank.id())).isEqualByComparingTo("700");
        assertThat(snapshots(bank.id())).containsExactly(bd(700));

        int logged = logs.findAll().size();
        sync.rebuild();
        assertThat(logs.findAll()).hasSize(logged);
    }

    @Test
    void onlyAnAdminSeesOrChangesAnAccountsBankDetails() {
        AccountView bank = accountService.create(new AccountRequest(null, "Private Bank", AccountType.BANK, "HDFC Bank", "50100012344321",
                null, null, null, null, null, null, null, true, null, "Aditya Kumar", "HDFC0001234", "aditya@okhdfc"));
        assertThat(bank.accountNumber()).isEqualTo("50100012344321");

        CurrentUser admin = UserContext.get();
        UserContext.set(new CurrentUser(admin.userId(), "manager", "Manager", UserRole.MANAGER, admin.tenantId(), admin.tenantCode(),
                admin.tenantName(), admin.currency(), Feature.all(), false, null, false));
        try {
            AccountView seen = accountService.get(bank.id());
            assertThat(seen.accountNumber()).isNull();
            assertThat(seen.holderName()).isNull();
            assertThat(seen.ifsc()).isNull();
            assertThat(seen.upiId()).isNull();
            assertThat(seen.institution()).isEqualTo("HDFC Bank");
            // the manager's form has no details: saving it keeps them
            accountService.update(bank.id(), new AccountRequest(null, "Private Bank 2", AccountType.BANK, "HDFC Bank", null,
                    null, null, null, null, null, null, null, true, seen.version(), null, null, null));
            assertThatThrownBy(() -> accountService.updateBankDetails(bank.id(),
                    new com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest("HDFC Bank", "1", "x", null, "x@ok", null)))
                    .isInstanceOf(com.aditya.personalbudget.exception.ForbiddenException.class);
        } finally {
            UserContext.set(admin);
        }
        Account stored = accounts.findById(bank.id()).orElseThrow();
        assertThat(stored.getName()).isEqualTo("Private Bank 2");
        assertThat(stored.getAccountNumber()).isEqualTo("50100012344321");
        assertThat(stored.getUpiId()).isEqualTo("aditya@okhdfc");
    }

    // ------------------------------------------------------------------ helpers

    private static AccountRequest request(String name, BigDecimal opening, LocalDate openingDate, Long version) {
        return new AccountRequest(null, name, AccountType.BANK, "HDFC Bank", null, opening, openingDate,
                null, null, null, null, null, true, version);
    }

    private BigDecimal balance(Long accountId) {
        return accounts.findById(accountId).orElseThrow().getBalance();
    }

    private List<BigDecimal> snapshots(Long accountId) {
        // ledger order: entry date, entry, line
        return lines.findByAccountId(accountId).stream()
                .sorted(Comparator.comparing((JournalLine l) -> store.findById(JournalEntry.class, l.getJournalEntryId()).orElseThrow().getEntryDate())
                        .thenComparing(JournalLine::getJournalEntryId).thenComparing(JournalLine::getLineNo))
                .map(JournalLine::getBalanceAfter).toList();
    }

    private List<BigDecimal> before(Long accountId) {
        return lines.findByAccountId(accountId).stream()
                .sorted(Comparator.comparing((JournalLine l) -> store.findById(JournalEntry.class, l.getJournalEntryId()).orElseThrow().getEntryDate())
                        .thenComparing(JournalLine::getJournalEntryId).thenComparing(JournalLine::getLineNo))
                .map(JournalLine::getBalanceBefore).toList();
    }

    private BigDecimal sumOfLines(Long accountId) {
        return lines.findByAccountId(accountId).stream().map(l -> l.getDebit().subtract(l.getCredit()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static BigDecimal bd(long value) {
        return BigDecimal.valueOf(value).setScale(2);
    }
}
