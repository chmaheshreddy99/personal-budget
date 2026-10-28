package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutReceiptRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.dto.JournalDtos.IncomeRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.dto.JournalDtos.TransferRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.ExpenseService;
import com.aditya.personalbudget.service.ExpenseService.ConvertToPaidForRequest;
import com.aditya.personalbudget.service.ExpenseService.ExpenseRow;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A chit payout the organizer pays in parts; charges linked to an expense; an expense turned into money paid for
 * someone; and editing a transfer.
 */
@SpringBootTest
class PayoutPartsAndLinkedExpenseTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-payout-parts-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired CategoryService categories;
    @Autowired ChitService chits;
    @Autowired ExpenseService expenses;
    @Autowired TransactionService transactions;
    @Autowired com.aditya.personalbudget.service.ClaimService claims;
    @Autowired JournalEntryRepository entries;

    private Long bank;
    private Long wallet;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = account("Payout bank", AccountType.BANK, 50000);
        wallet = account("Payout wallet", AccountType.WALLET, 1000);
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    // ------------------------------------------------------------------ chit payout in parts

    @Test
    void aPayoutPaidInPartsComesInPartByPartAndTheChitClosesOnlyOnceItIsAllIn() {
        Long chitId = chits.create(new ChitRequest("Parts chit " + System.nanoTime(), "Sri Ram", "T1", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(2), null, null, null, null, null, null, bank, null, null)).chit().id();
        ChitDetail d = chits.detail(chitId);
        for (int k = 0; k < 2; k++) {
            d = chits.payInstallment(chitId, d.installments().get(k).id(), new PayInstallmentRequest(null, bank, null));
        }
        assertThat(balance(bank)).isEqualByComparingTo("40000");

        // prize of 95,000 agreed; 60,000 paid now, the rest later
        d = chits.payout(chitId, new PayoutRequest(LocalDate.now(), bd(95000), bank, bd(60000)));
        assertThat(balance(bank)).isEqualByComparingTo("100000");
        assertThat(d.chit().payoutAmount()).isEqualByComparingTo("95000");
        assertThat(d.chit().payoutReceived()).isEqualByComparingTo("60000");
        assertThat(d.chit().payoutPending()).isEqualByComparingTo("35000");
        assertThat(d.chit().closable()).isFalse();
        assertThat(d.payoutReceipts()).hasSize(1);
        assertThat(d.payoutReceipts().getFirst().first()).isTrue();
        assertThatThrownBy(() -> chits.close(chitId)).isInstanceOf(BusinessException.class).hasMessageContaining("still to come");

        assertThatThrownBy(() -> chits.receivePayoutPart(chitId, new PayoutReceiptRequest(LocalDate.now(), bd(40000), bank, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("35000");
        d = chits.receivePayoutPart(chitId, new PayoutReceiptRequest(LocalDate.now(), bd(20000), wallet, "Cheque 1"));
        assertThat(balance(wallet)).isEqualByComparingTo("21000");
        assertThat(d.chit().payoutPending()).isEqualByComparingTo("15000");
        Long secondPart = d.payoutReceipts().get(1).entryId();
        assertThat(d.payoutReceipts().get(1).amount()).isEqualByComparingTo("20000");
        assertThat(d.payoutReceipts().get(1).notes()).isEqualTo("Cheque 1");

        // the first part is the payout itself: it is undone with the payout, not on its own
        Long firstPart = d.payoutReceipts().getFirst().entryId();
        assertThatThrownBy(() -> chits.undoPayoutPart(chitId, firstPart)).isInstanceOf(BusinessException.class);
        d = chits.undoPayoutPart(chitId, secondPart);
        assertThat(d.chit().payoutPending()).isEqualByComparingTo("35000");
        assertThat(balance(wallet)).isEqualByComparingTo("1000");

        d = chits.receivePayoutPart(chitId, new PayoutReceiptRequest(LocalDate.now(), bd(35000), bank, null));
        assertThat(d.chit().payoutPending()).isEqualByComparingTo("0");
        assertThat(d.chit().closable()).isTrue();
        assertThat(balance(bank)).isEqualByComparingTo("135000");

        // undoing the payout takes every part out
        d = chits.undoPayout(chitId);
        assertThat(d.payoutReceipts()).isEmpty();
        assertThat(d.chit().payoutReceived()).isNull();
        assertThat(balance(bank)).isEqualByComparingTo("40000");
    }

    @Test
    void aPayoutReceivedInOneGoNeedsNoParts() {
        Long chitId = chits.create(new ChitRequest("Whole chit " + System.nanoTime(), "Sri Ram", "T2", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(1), null, null, null, null, null, null, bank, null, null)).chit().id();
        ChitDetail d = chits.payout(chitId, new PayoutRequest(LocalDate.now(), bd(90000), bank));
        assertThat(d.chit().payoutPending()).isEqualByComparingTo("0");
        assertThat(d.chit().closable()).isTrue();
        assertThatThrownBy(() -> chits.receivePayoutPart(chitId, new PayoutReceiptRequest(LocalDate.now(), bd(1), bank, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("in full");
    }

    // ------------------------------------------------------------------ linked charges

    @Test
    void aChargeLinkedToAnExpenseIsItsOwnExpenseShownWithIt() {
        Long category = expenseCategory();
        EntryView ticket = expenses.create(expense(category, bank, "1200", "Train ticket"));
        EntryView fee = expenses.addLinked(ticket.id(), expense(category, bank, "35", "Convenience fee"));
        assertThat(balance(bank)).isEqualByComparingTo("48765");

        ExpenseRow parent = row(ticket.id());
        ExpenseRow child = row(fee.id());
        assertThat(parent.linked()).extracting(ExpenseService.LinkedView::entryId).containsExactly(fee.id());
        assertThat(child.parentEntryId()).isEqualTo(ticket.id());
        assertThat(child.parentEntryNo()).isEqualTo(ticket.entryNo());

        // a charge has no charges of its own, and an edit keeps it linked
        assertThatThrownBy(() -> expenses.addLinked(fee.id(), expense(category, bank, "5", "GST")))
                .isInstanceOf(BusinessException.class).hasMessageContaining(ticket.entryNo());
        Long version = entries.findById(fee.id()).orElseThrow().getVersion();
        expenses.update(fee.id(), new ExpenseRequest(LocalDate.now(), bd(40), category, bank, "Convenience fee", null, null, null, version));
        assertThat(row(fee.id()).parentEntryId()).isEqualTo(ticket.id());

        // the expense goes only after its charges
        assertThatThrownBy(() -> expenses.delete(ticket.id())).isInstanceOf(BusinessException.class).hasMessageContaining(fee.entryNo());
        expenses.delete(fee.id());
        expenses.delete(ticket.id());
    }

    // ------------------------------------------------------------------ expense to paid for

    @Test
    void anExpenseTurnedIntoPaidForBecomesAnOpenItemAndLeavesTheExpenses() {
        Long category = expenseCategory();
        EntryView dinner = expenses.create(expense(category, bank, "2400", "Dinner"));
        ClaimView item = expenses.convertToPaidFor(dinner.id(), new ConvertToPaidForRequest("Ravi", null, LocalDate.now().plusDays(10), null, null));

        assertThat(item.kind()).isEqualTo(ClaimKind.PAID_FOR);
        assertThat(item.amount()).isEqualByComparingTo("2400");
        assertThat(item.paidFromAccountId()).isEqualTo(bank);
        assertThat(item.narration()).isEqualTo("Dinner");
        assertThat(item.outstanding()).isEqualByComparingTo("2400");
        assertThat(entries.findById(dinner.id())).isEmpty();
        assertThat(entries.findById(item.journalEntryId()).orElseThrow().getVoucherType()).isEqualTo(VoucherType.PAID_FOR);
        assertThat(balance(bank)).isEqualByComparingTo("47600");   // the money left the bank once, as before
        claims.delete(item.id());
    }

    @Test
    void anExpenseWithLinkedChargesOrARefundIsNotTurnedIntoPaidFor() {
        Long category = expenseCategory();
        EntryView order = expenses.create(expense(category, bank, "800", "Order"));
        EntryView fee = expenses.addLinked(order.id(), expense(category, bank, "20", "Delivery"));
        assertThatThrownBy(() -> expenses.convertToPaidFor(order.id(), new ConvertToPaidForRequest("Ravi", null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("linked charges");
        expenses.delete(fee.id());
        expenses.refund(order.id(), new ExpenseService.RefundRequest(LocalDate.now(), bd(100), null, null));
        assertThatThrownBy(() -> expenses.convertToPaidFor(order.id(), new ConvertToPaidForRequest("Ravi", null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("refund");
    }

    // ------------------------------------------------------------------ transfers

    @Test
    void aTransferIsEditedInPlaceAndAReversedOneIsNot() {
        EntryView moved = transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, LocalDate.now(), bd(5000), bank, wallet,
                null, null, null, null));
        Long version = entries.findById(moved.id()).orElseThrow().getVersion();
        EntryView edited = transactions.updateTransfer(moved.id(), new TransferRequest(LocalDate.now(), bd(3000), wallet, bank,
                "Back to the bank", "UPI 1", null, version));
        assertThat(edited.entryNo()).isEqualTo(moved.entryNo());
        assertThat(edited.amount()).isEqualByComparingTo("3000");
        assertThat(balance(bank)).isEqualByComparingTo("53000");
        assertThat(balance(wallet)).isEqualByComparingTo("-2000");

        assertThatThrownBy(() -> transactions.updateTransfer(moved.id(), new TransferRequest(LocalDate.now(), bd(1), bank, bank,
                null, null, null, edited.version()))).isInstanceOf(BusinessException.class).hasMessageContaining("different");

        transactions.reverse(moved.id(), LocalDate.now());
        assertThatThrownBy(() -> transactions.updateTransfer(moved.id(), new TransferRequest(LocalDate.now(), bd(10), bank, wallet,
                null, null, null, edited.version()))).isInstanceOf(BusinessException.class).hasMessageContaining("reversed");
        assertThatThrownBy(() -> transactions.deleteTransfer(moved.id())).isInstanceOf(BusinessException.class);
    }

    @Test
    void onlyTransfersAreEditedAsTransfers() {
        EntryView lunch = expenses.create(expense(expenseCategory(), bank, "300", "Lunch"));
        assertThatThrownBy(() -> transactions.updateTransfer(lunch.id(), new TransferRequest(LocalDate.now(), bd(300), bank, wallet,
                null, null, null, lunch.version()))).isInstanceOf(BusinessException.class).hasMessageContaining("not a transfer");
    }

    // ------------------------------------------------------------------ income

    @Test
    void anIncomeIsEditedInPlaceAndAReversedOneIsNot() {
        Long[] sources = categories.list().stream().filter(c -> c.kind() == CategoryKind.INCOME && c.active())
                .map(c -> c.id()).limit(2).toArray(Long[]::new);
        EntryView salary = transactions.postQuick(new QuickTransactionRequest(QuickKind.INCOME, LocalDate.now(), bd(40000), null, bank,
                sources[0], "Salary", null, "Acme"));
        Long version = entries.findById(salary.id()).orElseThrow().getVersion();
        EntryView edited = transactions.updateIncome(salary.id(), new IncomeRequest(LocalDate.now(), bd(42000), sources[1], wallet,
                "Salary + bonus", "PAY-1", "Acme", version));
        assertThat(edited.entryNo()).isEqualTo(salary.entryNo());
        assertThat(edited.amount()).isEqualByComparingTo("42000");
        assertThat(balance(bank)).isEqualByComparingTo("50000");
        assertThat(balance(wallet)).isEqualByComparingTo("43000");
        assertThat(edited.lines()).anyMatch(l -> sources[1].equals(l.categoryId()));

        // an expense category is not an income source, and an expense is not an income
        Long expenseCat = expenseCategory();
        assertThatThrownBy(() -> transactions.updateIncome(salary.id(), new IncomeRequest(LocalDate.now(), bd(1), expenseCat, bank,
                null, null, null, edited.version()))).isInstanceOf(BusinessException.class).hasMessageContaining("not an income");
        EntryView lunch = expenses.create(expense(expenseCat, bank, "300", "Lunch"));
        assertThatThrownBy(() -> transactions.updateIncome(lunch.id(), new IncomeRequest(LocalDate.now(), bd(300), sources[0], bank,
                null, null, null, lunch.version()))).isInstanceOf(BusinessException.class).hasMessageContaining("not an income");

        transactions.reverse(salary.id(), LocalDate.now());
        assertThatThrownBy(() -> transactions.deleteIncome(salary.id())).isInstanceOf(BusinessException.class).hasMessageContaining("reversed");
    }

    // ------------------------------------------------------------------ helpers

    private Long account(String name, AccountType type, long opening) {
        return accounts.create(new AccountRequest(null, name + " " + System.nanoTime(), type, null, null, bd(opening),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
    }

    private ExpenseRow row(Long entryId) {
        return expenses.list(LocalDate.now().minusDays(1), LocalDate.now()).stream()
                .filter(r -> r.entryId().equals(entryId)).findFirst().orElseThrow();
    }

    private Long expenseCategory() {
        return categories.list().stream().filter(c -> c.kind() == CategoryKind.EXPENSE && c.active()).findFirst().orElseThrow().id();
    }

    private static ExpenseRequest expense(Long category, Long paidFrom, String amount, String what) {
        return new ExpenseRequest(LocalDate.now(), new BigDecimal(amount), category, paidFrom, what, null, null, null, null);
    }

    private BigDecimal balance(Long id) {
        return accounts.require(id).getBalance();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
