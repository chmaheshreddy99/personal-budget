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
import com.aditya.personalbudget.service.EmiService.BillRequest;
import com.aditya.personalbudget.service.EmiService.EmiRequest;
import com.aditya.personalbudget.service.EmiService.ForecloseRequest;
import com.aditya.personalbudget.service.EmiService.PayRequest;
import com.aditya.personalbudget.service.EmiService.PlanView;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.service.ReportService;
import com.aditya.personalbudget.service.TransactionService;
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
    @Autowired TransactionService transactions;
    @Autowired com.aditya.personalbudget.service.DashboardService dashboard;
    @Autowired com.aditya.personalbudget.service.AppSyncService sync;
    @Autowired com.aditya.personalbudget.service.AppSyncWriter writer;
    @Autowired AccountService accountService;
    @Autowired com.aditya.personalbudget.repository.AccountRepository accountRows;
    @Autowired com.aditya.personalbudget.repository.EmiPlanRepository plans;
    @Autowired com.aditya.personalbudget.repository.JournalLineRepository journalLines;
    @Autowired ReportService reports;

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
        // the price is an expense on the card, converted at once to the plan's payable: only the fee stays on the card
        assertThat(balances().get(card)).isEqualByComparingTo("500");
        assertThat(owedOn(p.id())).isEqualByComparingTo("60000");
        assertThat(p.blocked()).isEqualByComparingTo("60000");
        assertThat(expenses.list(today.minusMonths(8), today).stream().filter(r -> r.entryId().equals(p.purchaseEntryId())))
                .extracting(r -> r.amount().doubleValue()).contains(60000.0, 500.0);

        // a card EMI is paid into the card from the bank
        assertThatThrownBy(() -> emis.pay(p.id(), new PayRequest(1, null, null, false))).isInstanceOf(BusinessException.class).hasMessageContaining("bank");
        // two EMIs billed in full and paid into the card: their principal comes off the payable
        PlanView two = emis.pay(p.id(), new PayRequest(2, null, bank, false));
        assertThat(two.paidCount()).isEqualTo(2);
        assertThat(two.outstanding()).isEqualByComparingTo("40396.67");
        assertThat(two.blocked()).isEqualByComparingTo("40396.67");
        assertThat(balances().get(card)).isEqualByComparingTo("500");
        assertThat(owedOn(p.id())).isEqualByComparingTo("40396.67");
        // the third billed only: waiting to be paid into the card
        PlanView billed = emis.pay(p.id(), new PayRequest(1, null, null, true));
        assertThat(billed.toPay()).isEqualTo(1);
        assertThat(billed.blocked()).isEqualByComparingTo("30447.74");
        assertThat(billed.billedToPay()).isEqualByComparingTo("10425.61");   // 10352.90 + GST 72.71
        assertThat(balances().get(card)).isEqualByComparingTo("10925.61");   // the whole EMI on the card, as on its statement
        assertThat(owedOn(p.id())).isEqualByComparingTo("40396.67");   // still owed until the card is paid
        assertThat(emis.undo(p.id()).installments().get(2).status()).isEqualTo("DUE");

        // paying off early takes the rest off the payable, from the bank
        assertThatThrownBy(() -> emis.close(p.id())).isInstanceOf(BusinessException.class).hasMessageContaining("still to pay");
        PlanView closed = emis.foreclose(p.id(), new ForecloseRequest(today, bank, bd(1000)));
        assertThat(closed.status()).isEqualTo("FORECLOSED");
        assertThat(closed.outstanding()).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("500");
        assertThat(owedOn(p.id())).isEqualByComparingTo("0");
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
                bd(500), bd(18), today.minusMonths(7), null, card, false, emis.get(p.id()).version()))).isInstanceOf(BusinessException.class);
        assertThat(emis.update(p.id(), new EmiRequest("CARD", "Phone 16 Pro", null, null, null, "Gift", category, bd(60000), bd(12), 6,
                bd(500), bd(18), today.minusMonths(7), null, card, false, emis.get(p.id()).version())).narration()).isEqualTo("Phone 16 Pro");
    }

    private Long card(BigDecimal limit) {
        return accounts.create(new AccountRequest(null, "Limit card " + System.nanoTime(), AccountType.CREDIT_CARD, "HDFC", null, null, null, null, limit, null, null,
                null, true, null)).id();
    }

    private Long bank() {
        return accounts.create(new AccountRequest(null, "Limit bank " + System.nanoTime(), AccountType.BANK, "SBI", null, null, null, null, null, null, null,
                null, true, null)).id();
    }

    private Long expenseCategory() {
        return categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE).findFirst().orElseThrow().id();
    }

    private BigDecimal available(Long id) {
        return accounts.list().stream().filter(a -> a.id().equals(id)).findFirst().orElseThrow().availableCredit();
    }

    @Test
    void theConversionsCreditDoesNotFreeTheLimitAndThePayableEndsAtNil() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        Long bank = bank();
        BigDecimal awaitingBefore = awaiting();
        PlanView p = emis.create(new EmiRequest("CARD", "Fridge " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3,
                bd(1000), bd(18), today.minusMonths(4), null, card, false, null, bd(18)));
        // the fee and its GST are charged with the purchase, as Loan Interest, and counted in what it costs
        assertThat(p.feeGst()).isEqualByComparingTo("180");
        assertThat(p.totalPayable()).isEqualByComparingTo("31180");
        assertThat(balances().get(card)).isEqualByComparingTo("1180");
        // the card owes only the fee, but the limit stays held
        assertThat(available(card)).isEqualByComparingTo("68820");
        assertThat(expenses.list(today.minusMonths(5), today).stream().filter(r -> r.entryId().equals(p.purchaseEntryId())))
                .extracting(r -> r.amount().doubleValue()).contains(30000.0, 1000.0, 180.0);
        assertThat(p.conversionEntryNo()).isNotBlank();

        // each EMI: billed in full, its limit moves into the balance; paid, the limit is free and the payable goes down
        emis.pay(p.id(), new PayRequest(1, null, null, true));
        assertThat(balances().get(card)).isEqualByComparingTo("11180");
        assertThat(available(card)).isEqualByComparingTo("68820");
        assertThat(owedOn(p.id())).isEqualByComparingTo("30000");
        emis.pay(p.id(), new PayRequest(2, null, bank, false));
        assertThat(available(card)).isEqualByComparingTo("88820");
        assertThat(owedOn(p.id())).isEqualByComparingTo("10000");
        PlanView done = emis.pay(p.id(), new PayRequest(1, null, bank, false));
        assertThat(done.status()).isEqualTo("CLOSED");
        assertThat(owedOn(p.id())).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("1180");
        assertThat(available(card)).isEqualByComparingTo("98820");
        // nothing is left waiting between the card and the payable
        assertThat(awaiting()).isEqualByComparingTo(awaitingBefore);
    }

    @Test
    void aTransferIntoTheCardPaysItsBilledEmisAndChangingItTakesThatBack() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        Long bank = bank();
        PlanView p = emis.create(new EmiRequest("CARD", "Sofa " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3,
                null, null, today.minusMonths(4), null, card, false));
        emis.pay(p.id(), new PayRequest(2, null, null, true));
        assertThat(balances().get(card)).isEqualByComparingTo("20000");

        // part of the bill: the EMI it covers is paid, and the rest is kept towards the next
        var part = transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(15000), bank, card, null, "Card bill", null, null, null));
        assertThat(emis.get(p.id()).paidCount()).isEqualTo(1);
        assertThat(owedOn(p.id())).isEqualByComparingTo("20000");
        assertThat(emis.get(p.id()).installments().get(1).paidTowards()).isEqualByComparingTo("5000");
        assertThat(emis.get(p.id()).billedToPay()).isEqualByComparingTo("5000");
        // deleted: billed again, and the payable back where it was
        transactions.deleteTransfer(part.id());
        PlanView back = emis.get(p.id());
        assertThat(back.paidCount()).isZero();
        assertThat(back.toPay()).isEqualTo(2);
        assertThat(owedOn(p.id())).isEqualByComparingTo("30000");
        // the whole bill pays both; a later one finds nothing billed
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(20000), bank, card, null, "Card bill", null, null, null));
        assertThat(emis.get(p.id()).paidCount()).isEqualTo(2);
        assertThat(owedOn(p.id())).isEqualByComparingTo("10000");
        assertThat(balances().get(card)).isEqualByComparingTo("0");

        // paid some other way: marked by hand
        emis.pay(p.id(), new PayRequest(1, null, null, true));
        PlanView settled = emis.settleBilled(p.id(), new com.aditya.personalbudget.service.EmiService.SettleRequest(1, today));
        assertThat(settled.status()).isEqualTo("CLOSED");
        assertThat(owedOn(p.id())).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("10000");   // that bill itself is still on the card
    }

    @Test
    void partPaymentsAddUpAndDeletingOneTakesItsShareBack() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        Long bank = bank();
        PlanView p = emis.create(new EmiRequest("CARD", "Desk " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3,
                null, null, today.minusMonths(4), null, card, false));
        emis.pay(p.id(), new PayRequest(1, null, null, true));

        // two small payments: still billed, nothing off Payables yet
        var first = transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(4000), bank, card, null, "Part", null, null, null));
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(3000), bank, card, null, "Part", null, null, null));
        PlanView partly = emis.get(p.id());
        assertThat(partly.paidCount()).isZero();
        assertThat(partly.installments().getFirst().paidTowards()).isEqualByComparingTo("7000");
        assertThat(partly.billedToPay()).isEqualByComparingTo("3000");
        assertThat(partly.stillToPay()).isEqualByComparingTo("23000");
        assertThat(owedOn(p.id())).isEqualByComparingTo("30000");

        // the third covers it: only what was still owed goes to it, and the rest is the card's other spending
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(5000), bank, card, null, "Part", null, null, null));
        assertThat(emis.get(p.id()).paidCount()).isEqualTo(1);
        assertThat(owedOn(p.id())).isEqualByComparingTo("20000");

        // an earlier payment deleted: billed again, with what the others gave still counted
        transactions.deleteTransfer(first.id());
        PlanView back = emis.get(p.id());
        assertThat(back.paidCount()).isZero();
        assertThat(back.installments().getFirst().status()).isEqualTo("BILLED");
        assertThat(back.installments().getFirst().paidTowards()).isEqualByComparingTo("6000");
        assertThat(owedOn(p.id())).isEqualByComparingTo("30000");

        // paying the rest from the plan takes only what is still owed from the bank
        BigDecimal bankNow = balances().get(bank);
        PlanView paid = emis.pay(p.id(), new PayRequest(1, null, bank, false));
        assertThat(paid.paidCount()).isEqualTo(1);
        assertThat(bankNow.subtract(balances().get(bank))).isEqualByComparingTo("4000");
        assertThat(owedOn(p.id())).isEqualByComparingTo("20000");

        // a billed amount cannot go below what is paid towards it
        emis.pay(p.id(), new PayRequest(1, null, null, true));
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(2000), bank, card, null, "Part", null, null, null));
        var next = emis.get(p.id()).installments().get(1);
        assertThatThrownBy(() -> emis.billAs(p.id(), new BillRequest(next.id(), null, bd(1000), bd(0), bd(0)))).isInstanceOf(BusinessException.class).hasMessageContaining("already paid");
    }

    @Test
    void theDashboardsCardUsageCountsTheLimitHeldByEmis() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        emis.create(new EmiRequest("CARD", "Bed " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3,
                null, null, today.minusDays(2), null, card, false));
        assertThat(balances().get(card)).isEqualByComparingTo("0");
        var tile = dashboard.build().accounts().stream().filter(a -> a.accountId().equals(card)).findFirst().orElseThrow();
        assertThat(tile.utilizationPercent()).isEqualByComparingTo("30");

        // an EMI billed ahead of its due date, and a future-dated expense: both pages count them alike
        PlanView ahead = emis.create(new EmiRequest("CARD", "Lamp " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(12000), bd(0), 3,
                null, null, today, today.plusDays(25), card, false));
        emis.pay(ahead.id(), new PayRequest(1, null, null, true));
        expenses.create(new com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest(today.plusDays(5), bd(2500), expenseCategory(), card, "Booked ahead", null, null, null, null));
        BigDecimal onAccounts = accounts.list().stream().filter(a -> a.id().equals(card)).findFirst().orElseThrow().utilizationPercent();
        var again = dashboard.build().accounts().stream().filter(a -> a.accountId().equals(card)).findFirst().orElseThrow();
        assertThat(again.utilizationPercent()).isEqualByComparingTo(onAccounts);
        assertThat(onAccounts).isEqualByComparingTo("44.5");   // 30000 + 12000 held or billed + 2500, of 100000
        assertThat(again.balance()).isEqualByComparingTo(accounts.list().stream().filter(a -> a.id().equals(card)).findFirst().orElseThrow().balance());
    }

    @Test
    void thePhoneCanBillWithTheStatementsFiguresAndIsToldWhatGoesTogether() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        Long bank = bank();
        PlanView p = emis.create(new EmiRequest("CARD", "Chair " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(12), 3,
                bd(100), null, today.minusMonths(4), null, card, false));
        var first = p.installments().getFirst();
        // the snapshot says which entries belong together, and each EMI's figures
        var app = sync.snapshot(180).emis().stream().filter(e -> e.id().equals(p.id())).findFirst().orElseThrow();
        assertThat(app.purchaseEntryId()).isEqualTo(p.purchaseEntryId());
        assertThat(app.conversionEntryNo()).isEqualTo(p.conversionEntryNo());
        assertThat(app.payableAccountName()).isEqualTo("Payables");
        assertThat(app.instalments().getFirst().principal()).isEqualByComparingTo(first.principal());

        // billed only, with a different amount; sent again it is booked once
        var bill = new com.aditya.personalbudget.service.AppSyncService.SyncEmiPayment("c-" + System.nanoTime(), p.id(), 1, today, null,
                first.id(), first.principal(), first.interest().add(bd(2)), bd(0), true);
        assertThat(writer.writeEmiPayment(bill).status()).isEqualTo("CREATED");
        assertThat(writer.writeEmiPayment(bill).status()).isEqualTo("DUPLICATE");
        PlanView billed = emis.get(p.id());
        assertThat(billed.installments().getFirst().status()).isEqualTo("BILLED");
        assertThat(billed.installments().getFirst().scheduledAmount()).isNotNull();
        assertThat(billed.paidCount()).isZero();
        // paying goes on from there: the one billed, then the next
        var pay = new com.aditya.personalbudget.service.AppSyncService.SyncEmiPayment("c-" + System.nanoTime(), p.id(), 2, today, bank);
        assertThat(writer.writeEmiPayment(pay).status()).isEqualTo("CREATED");
        assertThat(emis.get(p.id()).paidCount()).isEqualTo(2);
    }

    @Test
    void payingOffEarlyAndDeletingLeaveNothingBehind() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(100000));
        Long bank = bank();
        Long category = expenseCategory();
        // billed on the card: the rest leaves the payable and joins the card's bill
        PlanView a = emis.create(new EmiRequest("CARD", "TV " + System.nanoTime(), null, null, null, null, category, bd(30000), bd(0), 3, null, null, today.minusMonths(4), null, card, false));
        PlanView early = emis.foreclose(a.id(), new ForecloseRequest(today, card, bd(500)));
        assertThat(early.status()).isEqualTo("FORECLOSED");
        assertThat(owedOn(a.id())).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("30500");
        assertThat(available(card)).isEqualByComparingTo("69500");
        // from the bank, with one EMI billed and waiting: both go, and undoing restores both
        PlanView b = emis.create(new EmiRequest("CARD", "AC " + System.nanoTime(), null, null, null, null, category, bd(30000), bd(0), 3, null, null, today.minusMonths(4), null, card, false));
        emis.pay(b.id(), new PayRequest(1, null, null, true));
        emis.foreclose(b.id(), new ForecloseRequest(today, bank, null));
        assertThat(owedOn(b.id())).isEqualByComparingTo("0");
        assertThat(balances().get(card)).isEqualByComparingTo("30500");
        PlanView undone = emis.undo(b.id());
        assertThat(undone.status()).isEqualTo("ACTIVE");
        assertThat(undone.toPay()).isEqualTo(1);
        assertThat(owedOn(b.id())).isEqualByComparingTo("30000");
        // a plan not started can be edited in full, or deleted with its conversion and payable
        PlanView c = emis.create(new EmiRequest("CARD", "Bike " + System.nanoTime(), null, null, null, null, category, bd(12000), bd(0), 3, null, null, today, null, card, false));
        PlanView edited = emis.update(c.id(), new EmiRequest("CARD", c.narration(), null, null, null, null, category, bd(15000), bd(0), 3, null, null, today, null, card, false, c.version()));
        assertThat(owedOn(c.id())).isEqualByComparingTo("15000");
        assertThat(edited.payableBalance()).isEqualByComparingTo("15000");
        BigDecimal before = balances().get(card);
        BigDecimal payablesBefore = balances().get(payables());
        emis.delete(c.id());
        assertThat(balances().get(card)).isEqualByComparingTo(before);
        assertThat(balances().get(payables())).isEqualByComparingTo(payablesBefore.subtract(bd(15000)));
        // the balance sheet stays in balance through all of it
        assertThat(reports.balanceSheet(today, null).balanced()).isTrue();
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
                null, null, today.minusMonths(2), null, bank, null, emis.get(loan.id()).version()));
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
        // three EMIs billed in full on the card, as on its statement; all of it still owed on the payable until the card is paid
        assertThat(balances().get(card)).isEqualByComparingTo("30000");
        assertThat(owedOn(p.id())).isEqualByComparingTo("90000");
    }

    /** What a plan still owes on the shared Payables. */
    private BigDecimal owedOn(Long planId) {
        return emis.get(planId).payableBalance();
    }

    /** What the household has billed on cards and not yet paid (the contra of Payables, shared by the tests here). */
    private BigDecimal awaiting() {
        return accounts.list().stream().filter(a -> a.name().startsWith("Less: EMI billed")).map(a -> a.balance()).findFirst().orElse(BigDecimal.ZERO);
    }

    private Long payables() {
        return accounts.list().stream().filter(a -> a.code().equals("2000")).findFirst().orElseThrow().id();
    }

    @Test
    void plansShareThePayablesAccountAndTheBalanceSheetCallsThemCreditCardEmi() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(500000));
        Long bank = bank();
        int before = accounts.list().size();
        BigDecimal payablesBefore = balances().getOrDefault(payables(), BigDecimal.ZERO);
        PlanView a = emis.create(new EmiRequest("CARD", "Washer " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3, null, null, today.minusMonths(4), null, card, false));
        PlanView b = emis.create(new EmiRequest("CARD", "Oven " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(12000), bd(0), 3, null, null, today.minusMonths(4), null, card, false));
        // no account of their own: both sit in Payables, which also holds a bill owed to someone
        assertThat(a.payableAccountId()).isEqualTo(payables()).isEqualTo(b.payableAccountId());
        assertThat(accounts.list().size()).isEqualTo(before);
        assertThat(balances().get(payables()).subtract(payablesBefore)).isEqualByComparingTo("42000");

        // a billed EMI is on the card and still on Payables; the contra line keeps the balance sheet honest
        emis.pay(a.id(), new PayRequest(1, null, null, true));
        BigDecimal netWorth = reports.balanceSheet(today, null).netWorth();
        var sheet = reports.balanceSheet(today, null);
        assertThat(sheet.balanced()).isTrue();
        var onPayables = sheet.counterparties().stream().filter(c -> c.accountId().equals(payables())).findFirst().orElseThrow();
        var emi = onPayables.parties().stream().filter(x -> x.party().equals("Credit Card EMI")).findFirst().orElseThrow();
        // each plan by itself (the tests here share one household, so other plans may be there too); what is billed is on the card
        assertThat(emi.items().stream().filter(i -> i.narration().equals(a.narration())).findFirst().orElseThrow().amount()).isEqualByComparingTo("20000");
        assertThat(emi.items().stream().filter(i -> i.narration().equals(b.narration())).findFirst().orElseThrow().amount()).isEqualByComparingTo("12000");
        assertThat(onPayables.parties().getFirst().party()).isEqualTo("Credit Card EMI");
        assertThat(onPayables.unlinked()).isEqualByComparingTo(BigDecimal.ZERO);

        // paying the card moves it off Payables, and net worth only changes by what left the bank against the card
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, today, bd(10000), bank, card, null, "Card bill", null, null, null));
        assertThat(owedOn(a.id())).isEqualByComparingTo("20000");
        assertThat(reports.balanceSheet(today, null).netWorth()).isEqualByComparingTo(netWorth);
        assertThat(balances().get(payables()).subtract(payablesBefore)).isEqualByComparingTo("32000");
        // closing a finished plan leaves the shared account alone
        emis.foreclose(b.id(), new ForecloseRequest(today, bank, null));
        emis.close(b.id());
        assertThat(accounts.list().stream().filter(x -> x.id().equals(payables())).findFirst().orElseThrow().active()).isTrue();
    }

    @Test
    void anEmiCanBeBilledAsTheStatementSaysAndPlanStillRepaysWhatWasFinanced() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(500000));
        Long bank = bank();
        BigDecimal awaitingBefore = awaiting();
        PlanView p = emis.create(new EmiRequest("CARD", "Camera " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(12), 3, null, bd(18), today.minusMonths(4), null, card, false));
        var first = p.installments().getFirst();
        // the statement says a little more interest
        PlanView billed = emis.billAs(p.id(), new BillRequest(null, null, first.principal(), first.interest().add(bd(1.5)), first.gst()));
        var row = billed.installments().getFirst();
        assertThat(row.status()).isEqualTo("BILLED");
        assertThat(row.scheduledAmount()).isEqualByComparingTo(first.emi().add(first.gst()));
        BigDecimal whole = first.emi().add(first.gst()).add(bd(1.5));
        assertThat(balances().get(card)).isEqualByComparingTo(whole);
        // changed again after billing: the same entry, a different principal, and the last EMI takes the difference
        var lastBefore = billed.installments().getLast();
        PlanView changed = emis.billAs(p.id(), new BillRequest(row.id(), null, row.principal().add(bd(10)), row.interest(), row.gst()));
        assertThat(changed.installments().getFirst().journalEntryId()).isEqualTo(row.journalEntryId());
        assertThat(balances().get(card)).isEqualByComparingTo(whole.add(bd(10)));
        assertThat(changed.installments().getLast().principal()).isEqualByComparingTo(lastBefore.principal().subtract(bd(10)));
        assertThat(changed.installments().getLast().balanceAfter()).isEqualByComparingTo("0");
        assertThat(changed.blocked()).isEqualByComparingTo(bd(30000).subtract(first.principal()).subtract(bd(10)));
        // undoing goes back to the schedule, the last EMI too
        PlanView undone = emis.undo(p.id());
        assertThat(undone.installments().getFirst().scheduledAmount()).isNull();
        assertThat(undone.installments().getFirst().principal()).isEqualByComparingTo(first.principal());
        assertThat(undone.installments().getLast().principal()).isEqualByComparingTo(lastBefore.principal());
        assertThat(balances().get(card)).isEqualByComparingTo("0");
        // to the end with a changed principal: exactly what was financed is repaid; the last EMI's principal is fixed
        emis.billAs(p.id(), new BillRequest(null, null, first.principal().add(bd(10)), first.interest(), first.gst()));
        PlanView two = emis.pay(p.id(), new PayRequest(2, null, bank, false));
        var last = two.installments().getLast();
        assertThatThrownBy(() -> emis.billAs(p.id(), new BillRequest(last.id(), null, last.principal().add(bd(1)), last.interest(), last.gst())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("last EMI");
        PlanView done = emis.pay(p.id(), new PayRequest(1, null, bank, false));
        assertThat(done.status()).isEqualTo("CLOSED");
        assertThat(owedOn(p.id())).isEqualByComparingTo("0");
        assertThat(awaiting()).isEqualByComparingTo(awaitingBefore);
        // a paid one is not changed
        assertThatThrownBy(() -> emis.billAs(p.id(), new BillRequest(last.id(), null, last.principal(), last.interest(), last.gst()))).isInstanceOf(BusinessException.class);
    }

    @Test
    void aPlanMadeWithItsOwnPayableMovesToTheSharedOneKeepingItsEntries() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(500000));
        Long bank = bank();
        BigDecimal payablesBefore = balances().getOrDefault(payables(), BigDecimal.ZERO);
        PlanView p = emis.create(new EmiRequest("CARD", "Old " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3, null, null, today.minusMonths(4), null, card, false));
        emis.pay(p.id(), new PayRequest(2, null, null, true));
        emis.pay(p.id(), new PayRequest(1, null, bank, false));
        BigDecimal cardBefore = balances().get(card);
        BigDecimal netWorth = reports.balanceSheet(today, null).netWorth();
        // as it was first made: an account of its own, and the old asset for what is billed
        var own = accountService.createInternal("EMI payable · Old plan " + System.nanoTime(), AccountType.PAYABLE, "old", false);
        own.setEmiAccount(true);
        own = accountRows.save(own);
        var oldAsset = accountService.createInternal("EMI billed, awaiting payment", AccountType.OTHER_ASSET, "old", false);
        oldAsset.setEmiAccount(true);
        oldAsset = accountRows.save(oldAsset);
        swap(payables(), own.getId(), p);
        Long contra = accounts.list().stream().filter(a -> a.name().startsWith("Less: EMI billed")).findFirst().orElseThrow().id();
        swap(contra, oldAsset.getId(), p);
        var row = plans.findById(p.id()).orElseThrow();
        row.setPayableAccountId(own.getId());
        plans.save(row);

        assertThat(emis.moveToSharedPayables()).isEqualTo(1);
        assertThat(emis.moveToSharedPayables()).isZero();
        assertThat(emis.get(p.id()).payableAccountId()).isEqualTo(payables());
        Long ownId = own.getId(), assetId = oldAsset.getId();
        assertThat(accounts.list()).noneMatch(a -> a.id().equals(ownId) || a.id().equals(assetId));
        assertThat(balances().get(payables()).subtract(payablesBefore)).isEqualByComparingTo("20000");
        assertThat(balances().get(card)).isEqualByComparingTo(cardBefore);
        assertThat(reports.balanceSheet(today, null).netWorth()).isEqualByComparingTo(netWorth);
        assertThat(reports.balanceSheet(today, null).balanced()).isTrue();
    }

    /** Puts this plan's lines on one account back on another, as an earlier version would have them. */
    private void swap(Long from, Long to, PlanView plan) {
        var ids = new java.util.LinkedHashSet<Long>();
        ids.add(plan.conversionEntryId());
        plan.installments().forEach(i -> { ids.add(i.journalEntryId()); ids.add(i.paymentEntryId()); });
        emis.get(plan.id()).installments().forEach(i -> { ids.add(i.journalEntryId()); ids.add(i.paymentEntryId()); });
        ids.remove(null);
        for (Long id : ids) {
            var e = ledger.get(id);
            var lines = journalLines.findByJournalEntryId(id);
            if (lines.stream().noneMatch(l -> from.equals(l.getAccountId()))) continue;
            var d = com.aditya.personalbudget.service.JournalDraft.of(e.getEntryDate(), e.getVoucherType(), e.getNarration()).source(e.getSourceType(), e.getSourceId());
            lines.stream().sorted(java.util.Comparator.comparing(l -> l.getLineNo())).forEach(l -> d.line(new com.aditya.personalbudget.service.JournalDraft.Line(
                    from.equals(l.getAccountId()) ? to : l.getAccountId(), l.getCategoryId(), l.getChitId(), l.getDebit(), l.getCredit(), l.getMemo())));
            ledger.repost(id, d);
        }
    }

    private Map<Long, BigDecimal> balances() {
        return ledger.snapshot().balancesAsOf(LocalDate.of(9999, 12, 31));
    }

    /** The contra of Payables keeps its entries, but is told as part of Payables wherever people read it. */
    @Test
    void whatIsBilledAndNotPaidIsNettedIntoPayablesAndTheContraIsNotListed() {
        LocalDate today = LocalDate.now();
        Long card = card(bd(500000));
        PlanView p = emis.create(new EmiRequest("CARD", "Netted " + System.nanoTime(), null, null, null, null, expenseCategory(), bd(30000), bd(0), 3, null, null, today.minusMonths(2), null, card, false));
        emis.pay(p.id(), new PayRequest(1, null, null, true));

        assertThat(awaiting().signum()).isNegative();
        var sheet = reports.balanceSheet(today, null);
        var rows = sheet.liabilities().groups().stream().flatMap(g -> g.accounts().stream()).toList();
        assertThat(rows).noneMatch(r -> r.name().startsWith("Less: EMI billed"));
        var payablesRow = rows.stream().filter(r -> payables().equals(r.accountId())).findFirst().orElseThrow();
        // as of today, as the sheet is (the tests here share one household, some with later entries)
        Map<Long, BigDecimal> asOfToday = ledger.snapshot().balancesAsOf(today);
        Long contraId = accounts.list().stream().filter(a -> a.name().startsWith("Less: EMI billed")).findFirst().orElseThrow().id();
        assertThat(payablesRow.amount()).isEqualByComparingTo(asOfToday.get(payables()).add(asOfToday.get(contraId)));
        // the total, and what makes up the row, add up: nothing is lost or counted twice
        BigDecimal listedTotal = rows.stream().map(r -> r.amount()).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(sheet.liabilities().total()).isEqualByComparingTo(listedTotal);
        assertThat(sheet.balanced()).isTrue();
        var people = sheet.counterparties().stream().filter(c -> payables().equals(c.accountId())).findFirst().orElseThrow();
        BigDecimal listed = people.parties().stream().map(x -> x.amount()).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(listed.add(people.unlinked())).isEqualByComparingTo(payablesRow.amount());

        // the plan's share there is what is not billed yet
        var planItem = people.parties().stream().flatMap(x -> x.items().stream()).filter(i -> p.narration().equals(i.narration())).findFirst().orElseThrow();
        assertThat(planItem.amount()).isEqualByComparingTo(bd(30000).subtract(emis.get(p.id()).installments().getFirst().principal()));

        // still in the books; flagged so the list and the pickers leave it out; not sent to the phone, whose Payables is net too
        var contraView = accounts.list().stream().filter(a -> a.name().startsWith("Less: EMI billed")).findFirst().orElseThrow();
        assertThat(contraView.emiContra()).isTrue();
        var phone = sync.snapshot(30).accounts();
        assertThat(phone).noneMatch(a -> a.name().startsWith("Less: EMI billed"));
        BigDecimal payablesNow = accounts.list().stream().filter(a -> payables().equals(a.id())).findFirst().orElseThrow().balance();
        assertThat(phone.stream().filter(a -> payables().equals(a.id())).findFirst().orElseThrow().balance()).isEqualByComparingTo(payablesNow.add(contraView.balance()));
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
