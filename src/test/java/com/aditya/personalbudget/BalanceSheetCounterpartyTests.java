package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.ReportDtos.BalanceSheet;
import com.aditya.personalbudget.dto.ReportDtos.Counterparties;
import com.aditya.personalbudget.dto.ReportDtos.PartyBalance;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.ReportService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
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

/** The balance sheet splits Receivables and Payables by person, with the items behind each, on both of its dates. */
@SpringBootTest
class BalanceSheetCounterpartyTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-counterparty-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ClaimService claims;
    @Autowired ReportService reports;
    @Autowired LedgerService ledger;
    @Autowired ExpenseService expenses;
    @Autowired CategoryService categories;

    private Long bank;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = accounts.create(new AccountRequest(null, "Counterparty bank " + System.nanoTime(), AccountType.BANK, null, null, BigDecimal.valueOf(100000),
                LocalDate.now().minusMonths(6), null, null, null, null, null, true, null)).id();
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void receivablesAndPayablesAreSplitByPersonWithTheirItems() {
        LocalDate today = LocalDate.now();
        LocalDate lastMonth = today.minusMonths(1).withDayOfMonth(1);
        Long lent = claim(ClaimKind.LENT, "Ravi Kumar", 10000, lastMonth, lastMonth.plusDays(10)).id();
        claim(ClaimKind.PAID_FOR, " ravi kumar", 2500, today, null);   // the same person, typed differently
        claim(ClaimKind.PAID_FOR, "Kiran", 800, today, null);
        claim(ClaimKind.BORROWED, "Anil", 20000, lastMonth, null);
        claims.repay(lent, new RepaymentRequest(today, BigDecimal.valueOf(4000), null, bank, null));

        BalanceSheet bs = reports.balanceSheet(today, lastMonth.withDayOfMonth(lastMonth.lengthOfMonth()));
        Counterparties receivables = bs.counterparties().stream().filter(c -> !c.payable()).findFirst().orElseThrow();
        assertThat(receivables.parties()).extracting(PartyBalance::party).containsExactly("Ravi Kumar", "Kiran");
        PartyBalance ravi = receivables.parties().getFirst();
        assertThat(ravi.amount()).isEqualByComparingTo("8500");      // 10,000 - 4,000 + 2,500
        assertThat(ravi.previous()).isEqualByComparingTo("10000");   // only the loan, at last month's end
        assertThat(ravi.items()).hasSize(2);
        assertThat(ravi.overdue()).isTrue();                          // the loan was due last month
        assertThat(receivables.unlinked()).isEqualByComparingTo("0");

        Counterparties payables = bs.counterparties().stream().filter(Counterparties::payable).findFirst().orElseThrow();
        assertThat(payables.parties()).filteredOn(p -> p.party().equals("Anil")).singleElement().satisfies(p -> {
            assertThat(p.amount()).isEqualByComparingTo("20000");
            assertThat(p.items().getFirst().kindLabel()).isEqualTo(ClaimKind.BORROWED.getLabel());
        });
    }

    /** Expenses paid later through Payables: a payment settles the oldest bill first; what is open is listed by shop. */
    @Test
    void billsPaidLaterAreMatchedOldestFirstAndListedByShop() {
        LocalDate today = LocalDate.now();
        Long payables = ledger.systemAccount(DefaultChartOfAccounts.PAYABLES).getId();
        Long category = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active()).findFirst().orElseThrow().id();
        expenses.create(new ExpenseRequest(today.minusDays(20), BigDecimal.valueOf(1200), category, payables, "Monthly kirana", "Ramesh Kirana", null, null, null));
        expenses.create(new ExpenseRequest(today.minusDays(5), BigDecimal.valueOf(800), category, payables, "Plumbing work", null, null, null, null));
        ledger.post(JournalDraft.of(today, VoucherType.TRANSFER, "Paid the kirana").debit(payables, BigDecimal.valueOf(1000)).credit(bank, BigDecimal.valueOf(1000)));

        BalanceSheet bs = reports.balanceSheet(today, today.minusMonths(1));
        Counterparties c = bs.counterparties().stream().filter(x -> x.accountId().equals(payables)).findFirst().orElseThrow();
        PartyBalance ramesh = c.parties().stream().filter(p -> p.party().equals("Ramesh Kirana")).findFirst().orElseThrow();
        assertThat(ramesh.named()).isTrue();
        assertThat(ramesh.amount()).isEqualByComparingTo("200");    // 1,200 less the 1,000 paid (the oldest bill first)
        assertThat(ramesh.items().getFirst().entryId()).isNotNull();
        assertThat(c.parties().getLast().named()).isFalse();          // the group without a name comes last
        assertThat(c.parties().getLast().amount()).isEqualByComparingTo("800");
        // the parts add up to the account on the balance sheet
        BigDecimal account = bs.liabilities().groups().stream().flatMap(g -> g.accounts().stream())
                .filter(a -> payables.equals(a.accountId())).findFirst().orElseThrow().amount();
        BigDecimal parts = c.parties().stream().map(PartyBalance::amount).reduce(c.unlinked(), BigDecimal::add);
        assertThat(parts).isEqualByComparingTo(account);
    }

    private com.aditya.personalbudget.dto.ClaimDtos.ClaimView claim(ClaimKind kind, String party, long amount, LocalDate on, LocalDate due) {
        return claims.create(new ClaimRequest(kind, party, kind.getLabel() + " " + party.trim(), BigDecimal.valueOf(amount), on, due,
                null, null, bank, null, null, null, null, null, false, null));
    }
}
