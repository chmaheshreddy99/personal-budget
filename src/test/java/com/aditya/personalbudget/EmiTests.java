package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.EmiService;
import com.aditya.personalbudget.service.EmiService.EmiRequest;
import com.aditya.personalbudget.service.EmiService.ForecloseRequest;
import com.aditya.personalbudget.service.EmiService.PayRequest;
import com.aditya.personalbudget.service.EmiService.PlanView;
import com.aditya.personalbudget.service.ExpenseService;
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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Bought on EMI: the reducing-balance schedule, the purchase booked as an expense with what is owed as a liability,
 * instalments paying off principal plus interest and GST to the card, undo, paying off early and deleting.
 */
@SpringBootTest
class EmiTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-emi-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired EmiService emis;
    @Autowired ExpenseService expenses;
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
    void theScheduleIsOnTheReducingBalanceAndClearsThePrincipal() {
        assertThat(EmiService.emi(bd(60000), bd(12), 6)).isEqualByComparingTo("10352.90");
        assertThat(EmiService.emi(bd(30000), BigDecimal.ZERO, 3)).isEqualByComparingTo("10000.00");
        var rows = EmiService.schedule(bd(60000), bd(12), 6, bd(18), LocalDate.of(2026, 1, 31));
        assertThat(rows).hasSize(6);
        assertThat(rows.getFirst().interest()).isEqualByComparingTo("600.00");
        assertThat(rows.getFirst().gst()).isEqualByComparingTo("108.00");
        assertThat(rows.getFirst().principal()).isEqualByComparingTo("9752.90");
        assertThat(rows.get(1).dueDate()).isEqualTo(LocalDate.of(2026, 2, 28));
        assertThat(rows.get(2).dueDate()).isEqualTo(LocalDate.of(2026, 3, 31));
        assertThat(rows.stream().map(EmiService.Row::principal).reduce(BigDecimal.ZERO, BigDecimal::add)).isEqualByComparingTo("60000");
        assertThat(rows.getLast().balanceAfter()).isEqualByComparingTo("0");
    }

    @Test
    void aCardEmiBlocksTheCardIsBilledMonthlyAndFreedWhenPaidIntoTheCard() {
        LocalDate today = LocalDate.now();
        Long card = accounts.create(new AccountRequest(null, "Test card " + System.nanoTime(), AccountType.CREDIT_CARD, "HDFC", null, null, null, null, null, null, null,
                null, true, null)).id();
        Long bank = accounts.create(new AccountRequest(null, "Test bank " + System.nanoTime(), AccountType.BANK, "SBI", null, null, null, null, null, null, null,
                null, true, null)).id();
        Long category = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE).findFirst().orElseThrow().id();
        PlanView p = emis.create(new EmiRequest("CARD", "Phone " + System.nanoTime(), "Croma", null, null, null, category, bd(60000), bd(12), 6,
                bd(500), bd(18), today.minusMonths(7), null, card, false));
        assertThat(p.firstDueDate()).isEqualTo(today.minusMonths(6));
        assertThat(p.emiAmount()).isEqualByComparingTo("10352.90");
        assertThat(p.toBill()).isEqualTo(6);
        assertThat(p.liabilityAccountId()).isNull();
        // the whole price (and the fee) is charged on the card at once: it blocks the limit
        assertThat(balances().get(card)).isEqualByComparingTo("60500");
        assertThat(p.blocked()).isEqualByComparingTo("60000");
        assertThat(expenses.list(today.minusMonths(8), today).stream().filter(r -> r.entryId().equals(p.purchaseEntryId())))
                .extracting(r -> r.amount().doubleValue()).contains(60000.0, 500.0);

        // a card EMI is paid into the card from the bank
        assertThatThrownBy(() -> emis.pay(p.id(), new PayRequest(1, null, null, false))).isInstanceOf(BusinessException.class).hasMessageContaining("bank");
        // two EMIs billed (interest and GST on the card) and paid into the card: that part of the limit is free
        PlanView two = emis.pay(p.id(), new PayRequest(2, null, bank, false));
        assertThat(two.paidCount()).isEqualTo(2);
        assertThat(two.outstanding()).isEqualByComparingTo("40396.67");
        assertThat(two.blocked()).isEqualByComparingTo("40396.67");
        assertThat(balances().get(card)).isEqualByComparingTo("40896.67");   // 60500 + interest and GST 1300.91 − paid 20904.24
        // the third billed only: waiting to be paid into the card
        PlanView billed = emis.pay(p.id(), new PayRequest(1, null, null, true));
        assertThat(billed.toPay()).isEqualTo(1);
        assertThat(billed.blocked()).isEqualByComparingTo("30447.74");
        assertThat(billed.billedToPay()).isEqualByComparingTo("10425.61");   // 10352.90 + GST 72.71
        assertThat(emis.undo(p.id()).installments().get(2).status()).isEqualTo("DUE");

        // paying off early pays what is still blocked into the card
        assertThatThrownBy(() -> emis.close(p.id())).isInstanceOf(BusinessException.class).hasMessageContaining("still to pay");
        PlanView closed = emis.foreclose(p.id(), new ForecloseRequest(today, bank, bd(1000)));
        assertThat(closed.status()).isEqualTo("FORECLOSED");
        assertThat(closed.outstanding()).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("500");
        assertThat(emis.undo(p.id()).status()).isEqualTo("ACTIVE");
        assertThatThrownBy(() -> emis.delete(p.id())).isInstanceOf(BusinessException.class).hasMessageContaining("undo");
        // once finished it can be closed (put away) and re-opened
        emis.foreclose(p.id(), new ForecloseRequest(today, bank, null));
        assertThat(emis.close(p.id()).archived()).isTrue();
        assertThat(emis.book(false).plans()).noneMatch(x -> x.id().equals(p.id()));
        assertThat(emis.book(true).plans()).anyMatch(x -> x.id().equals(p.id()));
        assertThatThrownBy(() -> emis.undo(p.id())).isInstanceOf(BusinessException.class).hasMessageContaining("re-open");
        assertThat(emis.reopen(p.id()).archived()).isFalse();
        // with EMIs paid only what it was can change
        assertThatThrownBy(() -> emis.update(p.id(), new EmiRequest("CARD", "Phone", null, null, null, null, category, bd(50000), bd(12), 6,
                bd(500), bd(18), today.minusMonths(7), null, card, false))).isInstanceOf(BusinessException.class);
        assertThat(emis.update(p.id(), new EmiRequest("CARD", "Phone 16 Pro", null, null, null, "Gift", category, bd(60000), bd(12), 6,
                bd(500), bd(18), today.minusMonths(7), null, card, false)).narration()).isEqualTo("Phone 16 Pro");
    }

    @Test
    void aLoanEmiOwesItsOwnHiddenAccountAndCanBeChangedUntilPaid() {
        LocalDate today = LocalDate.now();
        Long bank = accounts.create(new AccountRequest(null, "Loan bank " + System.nanoTime(), AccountType.BANK, "SBI", null, null, null, null, null, null, null,
                null, true, null)).id();
        Long category = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE).findFirst().orElseThrow().id();
        assertThatThrownBy(() -> emis.create(new EmiRequest("CARD", "TV", null, null, null, null, category, bd(30000), bd(0), 3, null, null, today, null, bank, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("card");
        PlanView loan = emis.create(new EmiRequest("LOAN", "Fridge " + System.nanoTime(), null, "Bajaj Finserv", null, null, category, bd(30000), bd(0), 3,
                null, null, today.minusMonths(2), null, bank, null));
        assertThat(loan.autoPost()).isFalse();
        assertThat(loan.emiAmount()).isEqualByComparingTo("10000");
        assertThat(balances().get(loan.liabilityAccountId())).isEqualByComparingTo("30000");
        assertThat(accounts.list().stream().filter(a -> a.id().equals(loan.liabilityAccountId())).findFirst().orElseThrow().emiAccount()).isTrue();
        // nothing paid: everything can change
        PlanView changed = emis.update(loan.id(), new EmiRequest("LOAN", "Fridge", null, "Bajaj Finserv", null, null, category, bd(36000), bd(0), 6,
                null, null, today.minusMonths(2), null, bank, null));
        assertThat(changed.months()).isEqualTo(6);
        assertThat(changed.emiAmount()).isEqualByComparingTo("6000");
        assertThat(balances().get(loan.liabilityAccountId())).isEqualByComparingTo("36000");
        PlanView paid = emis.pay(loan.id(), new PayRequest(1, null, null, null));
        assertThat(balances().get(loan.liabilityAccountId())).isEqualByComparingTo("30000");
        assertThat(paid.paidCount()).isEqualTo(1);
        emis.undo(loan.id());
        emis.delete(loan.id());
        assertThat(emis.book(true).plans()).noneMatch(x -> x.id().equals(loan.id()));
    }

    @Test
    void plansThatBookThemselvesPostWhatHasFallenDue() {
        LocalDate today = LocalDate.now();
        Long card = accounts.create(new AccountRequest(null, "Auto card " + System.nanoTime(), AccountType.CREDIT_CARD, "ICICI", null, null, null, null, null, null, null,
                null, true, null)).id();
        Long category = categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE).findFirst().orElseThrow().id();
        PlanView p = emis.create(new EmiRequest("CARD", "Laptop " + System.nanoTime(), null, null, null, null, category, bd(90000), bd(0), 9,
                null, null, today.minusMonths(3), null, card, true));
        emis.postDueForAll();
        PlanView after = emis.get(p.id());
        // a card EMI books itself as billed: two months ago, last month and today, waiting to be paid into the card
        assertThat(after.toPay()).isEqualTo(3);
        assertThat(after.paidCount()).isEqualTo(0);
        assertThat(after.blocked()).isEqualByComparingTo("60000");
        assertThat(after.installments().getFirst().billedOn()).isEqualTo(after.installments().getFirst().dueDate());
        assertThat(balances().get(card)).isEqualByComparingTo("90000");
    }

    private Map<Long, BigDecimal> balances() {
        return ledger.snapshot().balancesAsOf(LocalDate.of(9999, 12, 31));
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
