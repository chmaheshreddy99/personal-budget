package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InterestType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.ClaimDtos.TimelineEvent;
import com.aditya.personalbudget.dto.InsightDtos.Forecast;
import com.aditya.personalbudget.dto.JournalDtos.EntryView;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryRequest;
import com.aditya.personalbudget.dto.ReportDtos.BalanceSheet;
import com.aditya.personalbudget.dto.ReportDtos.TrialBalance;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.CategoryService;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.ForecastService;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.service.LedgerSnapshot;
import com.aditya.personalbudget.service.ReportService;
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
import java.math.RoundingMode;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Boots the whole application on a temporary data directory with demo data,
 * then checks the accounting invariants.
 */
@SpringBootTest
class PersonalBudgetApplicationTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "true");   // the tests need sample books, whatever application.yml says
    }

    @Autowired TenantRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountRepository accounts;
    @Autowired JournalEntryRepository entries;
    @Autowired LedgerService ledger;
    @Autowired ReportService reports;
    @Autowired ForecastService forecast;

    @BeforeEach
    void signInAsSeededAdmin() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        var tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), admin.getUsername(), admin.getFullName(), admin.getRole(),
                tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void seededBooksBalance() {
        TrialBalance tb = reports.trialBalance(LocalDate.now());
        assertThat(tb.balanced()).isTrue();
        assertThat(tb.totalDebit()).isPositive();

        BalanceSheet bs = reports.balanceSheet(LocalDate.now(), null);
        assertThat(bs.balanced()).isTrue();
        assertThat(bs.netWorth()).isEqualByComparingTo(bs.assets().total().subtract(bs.liabilities().total()));
        assertThat(bs.previousNetWorth()).isEqualByComparingTo(bs.assets().previous().subtract(bs.liabilities().previous()));
    }

    @Test
    void unbalancedJournalIsRejectedAndNothingIsWritten() {
        long before = entries.countByTenantId(UserContext.tenantId());
        Long cash = accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.CASH).orElseThrow().getId();
        Long groceries = accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.EXPENSES).orElseThrow().getId();

        assertThatThrownBy(() -> ledger.post(JournalDraft.of(LocalDate.now(), VoucherType.JOURNAL, "Bad")
                .debit(groceries, new BigDecimal("100"))
                .credit(cash, new BigDecimal("90"))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("not balanced");
        assertThat(entries.countByTenantId(UserContext.tenantId())).isEqualTo(before);
    }

    @Test
    void chitImpliedRateMatchesTheMaturityAmount() {
        Chit chit = new Chit();
        chit.setMonthlyInstallment(new BigDecimal("22500"));
        chit.setNumberOfInstallments(20);
        chit.setMaturityAmount(new BigDecimal("500000"));
        double monthly = ChitService.monthlyRate(chit);

        double value = 0;
        for (int k = 0; k < 20; k++) {
            value = (value + 22500) * (1 + monthly);
        }
        assertThat(value).isCloseTo(500000, org.assertj.core.data.Offset.offset(1.0));
        double annual = (Math.pow(1 + monthly, 12) - 1) * 100;
        assertThat(BigDecimal.valueOf(annual).setScale(1, RoundingMode.HALF_UP)).isEqualByComparingTo("12.6");
    }

    @Test
    void forecastCoversTheRequestedHorizonPlusTheRestOfThisMonth() {
        Forecast f = forecast.forecast(12, null, null);
        assertThat(f.rows()).hasSize(13);
        assertThat(f.assumptions()).isNotEmpty();
    }

    @Test
    void tenantsAreIsolated() {
        var other = new com.aditya.personalbudget.domain.entity.Tenant();
        other.setCode("other-" + System.nanoTime() % 100000);
        other.setName("Other");
        other.setCurrency("USD");
        other.setActive(true);
        other.setCreatedAt(LocalDateTime.now());
        other = tenants.save(other);
        assertThat(accounts.findByTenantId(other.getId())).isEmpty();
        assertThat(accounts.findByTenantId(UserContext.tenantId())).isNotEmpty();
    }

    @Autowired TransactionService transactions;
    @Autowired ClaimService claims;

    @Test
    void automaticPostingsAreLockedInTheJournal() {
        JournalEntry expense = entries.findByTenantId(UserContext.tenantId()).stream()
                .filter(LedgerService::isExpense).findFirst().orElseThrow();
        assertThatThrownBy(() -> transactions.deleteEntry(expense.getId()))
                .isInstanceOf(BusinessException.class).hasMessageContaining("locked");

        JournalEntry transfer = entries.findByTenantId(UserContext.tenantId()).stream()
                .filter(e -> e.getVoucherType() == VoucherType.TRANSFER).findFirst().orElseThrow();
        EntryView reversal = transactions.reverse(transfer.getId(), LocalDate.now());
        assertThat(reversal.reversalOf()).isEqualTo(transfer.getEntryNo());
        assertThatThrownBy(() -> transactions.reverse(transfer.getId(), LocalDate.now()))
                .isInstanceOf(BusinessException.class).hasMessageContaining("already reversed");
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void moneyLentIsRepaidInPartsWithInterest() {
        Long bank = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        LocalDate start = LocalDate.now().minusMonths(2);   // 2 months at 1% a month on 36,500 = 730 interest
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Test Friend", null, new BigDecimal("36500"),
                start, null, new BigDecimal("12"), null, bank, null, null, null, null, null, null, null));
        assertThat(claim.status()).isEqualTo(ClaimStatus.OPEN);
        assertThat(claim.interestDue()).isEqualByComparingTo("730.00");

        ClaimView partial = claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("16500"),
                new BigDecimal("730"), bank, null));
        assertThat(partial.status()).isEqualTo(ClaimStatus.PARTIAL);
        assertThat(partial.outstanding()).isEqualByComparingTo("20000");
        assertThat(partial.interestDue()).isEqualByComparingTo("0");
        assertThat(partial.schedule()).isNotEmpty();

        assertThatThrownBy(() -> claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("20001"),
                null, bank, null))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> claims.delete(claim.id())).isInstanceOf(BusinessException.class);

        ClaimView settled = claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("20000"), null, bank, null));
        assertThat(settled.status()).isEqualTo(ClaimStatus.SETTLED);
        assertThat(settled.timeline()).extracting(TimelineEvent::type).contains("CREATED", "REPAID", "SETTLED");
        assertThat(claims.byEntry(settled.repayments().getFirst().journalEntryId())).isPresent();

        ClaimView undone = claims.undoRepayment(claim.id(), settled.repayments().getLast().id());
        assertThat(undone.status()).isEqualTo(ClaimStatus.PARTIAL);
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void compoundInterestEarnsInterestOnUnpaidInterest() {
        Long bank = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        LocalDate start = LocalDate.now().minusMonths(2);
        ClaimView simple = claims.create(new ClaimRequest(ClaimKind.LENT, "Simple Friend", null, new BigDecimal("36500"),
                start, null, new BigDecimal("12"), InterestType.SIMPLE, bank, null, null, null, null, null, null, null));
        ClaimView compound = claims.create(new ClaimRequest(ClaimKind.LENT, "Compound Friend", null, new BigDecimal("36500"),
                start, null, new BigDecimal("12"), InterestType.COMPOUND, bank, null, null, null, null, null, null, null));

        // simple: principal only, 2 months at 12% a year = 730, whatever the length of the months
        assertThat(simple.interestDue()).isEqualByComparingTo("730.00");
        assertThat(simple.simpleInterestToDate()).isEqualByComparingTo("730.00");
        // compound: same accrual, plus interest on the interest added at each monthly anniversary
        assertThat(compound.interestDue()).isGreaterThan(simple.interestDue());
        assertThat(compound.interestDue()).isEqualByComparingTo(compound.compoundInterestToDate());
        assertThat(compound.compoundInterestToDate().subtract(compound.simpleInterestToDate()))
                .isBetween(new BigDecimal("1"), new BigDecimal("15"));
        assertThat(compound.schedule()).allSatisfy(p -> assertThat(p.compoundInterest()).isGreaterThanOrEqualTo(BigDecimal.ZERO));
        assertThat(compound.schedule().getFirst().status()).isEqualTo("EARNED");
    }

    @Test
    void borrowedMoneyIsRepaidWithInterestExpenseAndCanBeWaived() {
        Long bank = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        Long payables = accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.PAYABLES).orElseThrow().getId();
        LocalDate start = LocalDate.now().minusMonths(2);   // 2 months at 1% a month on 36,500 = 730 interest
        ClaimView loan = claims.create(new ClaimRequest(ClaimKind.BORROWED, "Uncle", null, new BigDecimal("36500"),
                start, null, new BigDecimal("12"), null, bank, null, null, null, null, null, null, null));
        assertThat(loan.receivableAccountId()).isEqualTo(payables);
        assertThat(loan.interestDue()).isEqualByComparingTo("730.00");
        assertThat(claims.summary(List.of(loan)).outstanding()).isEqualByComparingTo("0");   // not "to collect"

        ClaimView partial = claims.repay(loan.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("16500"),
                new BigDecimal("730"), bank, null));
        assertThat(partial.status()).isEqualTo(ClaimStatus.PARTIAL);
        assertThat(partial.outstanding()).isEqualByComparingTo("20000");
        EntryView payment = transactions.get(partial.repayments().getFirst().journalEntryId());
        assertThat(payment.voucherType()).isEqualTo(VoucherType.REPAYMENT_MADE);
        assertThat(payment.lines()).anySatisfy(l -> {
            assertThat(l.accountCode()).isEqualTo(DefaultChartOfAccounts.EXPENSES);
            assertThat(l.accountName()).isEqualTo("Loan Interest");
            assertThat(l.debit()).isEqualByComparingTo("730");
        });

        Long gifts = categoryRepository.findByName(UserContext.tenantId(), CategoryKind.INCOME, "Gifts Received").orElseThrow().getId();
        ClaimView waived = claims.writeOff(loan.id(), new com.aditya.personalbudget.dto.ClaimDtos.WriteOffRequest(LocalDate.now(), gifts, null));
        assertThat(waived.status()).isEqualTo(ClaimStatus.WRITTEN_OFF);
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void aPartMonthCountsInThirtyDayMonths() {
        Long bank = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        // one whole month (100 at 1% on 10,000, whatever its length) plus the days since, in 30-day months
        LocalDate start = LocalDate.now().minusMonths(1).minusDays(15);
        LocalDate check = start.plusMonths(1);
        LocalDate today = LocalDate.now();
        long days360 = 360L * (today.getYear() - check.getYear()) + 30L * (today.getMonthValue() - check.getMonthValue())
                + Math.min(today.getDayOfMonth(), 30) - Math.min(check.getDayOfMonth(), 30);
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Half Month", null, new BigDecimal("10000"),
                start, null, new BigDecimal("12"), null, bank, null, null, null, null, null, null, null));
        assertThat(claim.schedule().getFirst().simpleInterest()).isEqualByComparingTo("100.00");
        assertThat(claim.interestDue()).isEqualByComparingTo(new BigDecimal(100 + 100.0 * days360 / 30).setScale(2, RoundingMode.HALF_UP));
        assertThat(check).isBefore(LocalDate.now());
    }

    @Test
    void interestPostedMonthByMonthIsSettledByTheRepaymentNotBookedTwice() {
        Long tenantId = UserContext.tenantId();
        Long bank = accounts.findByTenantId(tenantId).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        Long receivables = accounts.findByTenantIdAndCode(tenantId, DefaultChartOfAccounts.RECEIVABLES).orElseThrow().getId();
        Long interestCategory = categoryRepository.findBySystemKey(tenantId, DefaultChartOfAccounts.INTEREST_INCOME).orElseThrow().getId();
        LocalDate start = LocalDate.now().minusMonths(3).minusDays(5);
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Monthly Friend", null, new BigDecimal("20000"),
                start, null, new BigDecimal("12"), null, bank, null, null, null, null, null, true, null));
        assertThat(claim.postInterestMonthly()).isTrue();
        assertThat(claim.monthsToPost()).isEqualTo(3);
        BigDecimal receivablesBefore = ledger.snapshot().balanceAsOf(receivables, LocalDate.now());
        BigDecimal incomeBefore = interestIncome(interestCategory);

        ClaimView posted = claims.postInterest(claim.id(), false);   // 3 months x 200
        assertThat(posted.interestPosted()).isEqualByComparingTo("600");
        assertThat(posted.monthsToPost()).isZero();
        assertThat(posted.postings()).hasSize(3);
        assertThat(ledger.snapshot().balanceAsOf(receivables, LocalDate.now()).subtract(receivablesBefore))
                .isEqualByComparingTo("600");
        assertThatThrownBy(() -> claims.postInterest(claim.id(), false)).isInstanceOf(BusinessException.class);

        // everything repaid with the interest due: the posted 600 comes out of Receivables, only the rest is new income
        BigDecimal due = posted.interestDue();
        ClaimView settled = claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("20000"), due, bank, null));
        assertThat(settled.status()).isEqualTo(ClaimStatus.SETTLED);
        assertThat(ledger.snapshot().balanceAsOf(receivables, LocalDate.now()))
                .isEqualByComparingTo(receivablesBefore.subtract(new BigDecimal("20000")));
        assertThat(interestIncome(interestCategory).subtract(incomeBefore)).isEqualByComparingTo(due);
        assertThatThrownBy(() -> claims.undoInterestPosting(claim.id(), settled.postings().getLast().id()))
                .isInstanceOf(BusinessException.class).hasMessageContaining("already been paid");
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void interestCanBePostedMonthByMonthToAnotherAccountAndIsSettledFromIt() {
        Long tenantId = UserContext.tenantId();
        Long bank = accounts.findByTenantId(tenantId).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        Long interestReceivable = accountService.create(new com.aditya.personalbudget.dto.AccountDtos.AccountRequest(
                null, "Interest receivable", AccountType.OTHER_ASSET, null, null, null, null, null, null, null, null, null, true, null)).id();
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Ledger Friend", null, new BigDecimal("20000"),
                LocalDate.now().minusMonths(2).minusDays(3), null, new BigDecimal("12"), null, bank, null, null, null, null, null, false, null));

        ClaimView first = claims.postInterest(claim.id(), false, 1, interestReceivable, true);   // month 1 only, new default
        assertThat(first.postings()).hasSize(1);
        assertThat(first.interestAccountId()).isEqualTo(interestReceivable);
        ClaimView second = claims.postInterest(claim.id(), false);                               // month 2, to the default
        assertThat(second.postings()).extracting(p -> p.accountId()).containsOnly(interestReceivable);
        assertThat(ledger.snapshot().balanceAsOf(interestReceivable, LocalDate.now())).isEqualByComparingTo("400");

        ClaimView settled = claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("20000"),
                second.interestDue(), bank, null));
        assertThat(settled.status()).isEqualTo(ClaimStatus.SETTLED);
        assertThat(ledger.snapshot().balanceAsOf(interestReceivable, LocalDate.now())).isEqualByComparingTo("0");
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Autowired com.aditya.personalbudget.service.BudgetService budgetService;

    @Test
    void budgetsBelongToAMonthCanBeCopiedAndCommittedOnesAreTrackedAsDue() {
        java.time.YearMonth now = java.time.YearMonth.now();
        java.time.YearMonth next = now.plusMonths(1);
        Long rent = categoryRepository.findByName(UserContext.tenantId(), CategoryKind.EXPENSE, "Rent").orElseThrow().getId();
        budgetService.save(new com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest(rent, new BigDecimal("18000"), 80,
                null, null, now.toString(), true, 28));
        var summary = budgetService.summary(now);
        var line = summary.lines().stream().filter(l -> rent.equals(l.categoryId())).findFirst().orElseThrow();
        assertThat(line.committed()).isTrue();
        assertThat(line.dueDate()).isEqualTo(now.atDay(28));
        assertThat(line.paymentStatus()).isIn("DUE", "DUE_SOON", "OVERDUE", "PARTLY_PAID");
        assertThat(summary.committedOutstanding()).isPositive();
        assertThat(summary.alerts()).isNotEmpty();
        // pace: every ordinary budget gets a pace and a sentence
        assertThat(summary.lines()).filteredOn(l -> l.budgetId() != null && !l.committed())
                .allSatisfy(l -> { assertThat(l.pace()).isNotNull(); assertThat(l.insight()).isNotBlank(); });

        assertThat(budgetService.forMonth(next)).isEmpty();
        int copied = budgetService.copy(now.toString(), next.toString(), false);
        assertThat(copied).isEqualTo(budgetService.forMonth(now).size());
        assertThat(budgetService.copy(now.toString(), next.toString(), false)).isZero();   // already there
        var copiedRent = budgetService.summary(next).lines().stream().filter(l -> rent.equals(l.categoryId())).findFirst().orElseThrow();
        assertThat(copiedRent.committed()).isTrue();
        assertThat(copiedRent.dueDay()).isEqualTo(28);
        assertThat(budgetService.summary(next).previousMonthBudgets()).isEqualTo(copied);
    }

    @Autowired com.aditya.personalbudget.service.ExpenseService expenseService;

    @Test
    void anExpenseCanBeRefundedInPartsThenReversedAndBothUndone() {
        Long tenantId = UserContext.tenantId();
        Long bank = accounts.findByTenantId(tenantId).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        Long shopping = categoryRepository.findByName(tenantId, CategoryKind.EXPENSE, "Shopping & Clothing").orElseThrow().getId();
        LocalDate day = LocalDate.now().minusDays(2);
        var expense = expenseService.create(new com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest(day, new BigDecimal("3000"),
                shopping, bank, "Shoes", "Store", null, null, null));
        BigDecimal spentBefore = ledger.snapshot().categoryMovements(day, LocalDate.now()).get(shopping);

        expenseService.refund(expense.id(), new com.aditya.personalbudget.service.ExpenseService.RefundRequest(LocalDate.now(), new BigDecimal("1000"), null, "One pair returned"));
        var row = expenseService.list(day, day).stream().filter(r -> r.entryId().equals(expense.id())).findFirst().orElseThrow();
        assertThat(row.status()).isEqualTo("PARTLY_REFUNDED");
        assertThat(row.netAmount()).isEqualByComparingTo("2000");
        assertThat(row.editable()).isFalse();
        assertThatThrownBy(() -> expenseService.delete(expense.id())).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> expenseService.refund(expense.id(), new com.aditya.personalbudget.service.ExpenseService.RefundRequest(LocalDate.now(), new BigDecimal("2500"), null, null)))
                .isInstanceOf(BusinessException.class);

        var reversal = expenseService.reverse(expense.id(), null);   // the remaining 2,000
        assertThat(reversal.amount()).isEqualByComparingTo("2000");
        row = expenseService.list(day, day).stream().filter(r -> r.entryId().equals(expense.id())).findFirst().orElseThrow();
        assertThat(row.status()).isEqualTo("REVERSED");
        assertThat(row.netAmount()).isEqualByComparingTo("0");
        assertThat(ledger.snapshot().categoryMovements(day, LocalDate.now()).get(shopping))
                .isEqualByComparingTo(spentBefore.subtract(new BigDecimal("3000")));
        assertThat(transactions.get(expense.id()).reversedBy()).isEqualTo(reversal.entryNo());

        expenseService.undoRefund(expense.id(), reversal.id());
        row = expenseService.list(day, day).stream().filter(r -> r.entryId().equals(expense.id())).findFirst().orElseThrow();
        assertThat(row.status()).isEqualTo("PARTLY_REFUNDED");
        expenseService.undoRefund(expense.id(), row.refunds().getFirst().entryId());
        assertThat(expenseService.list(day, day).stream().filter(r -> r.entryId().equals(expense.id())).findFirst().orElseThrow().status()).isNull();
        expenseService.delete(expense.id());
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void interestPostedStraightToTheBankCountsAsReceived() {
        Long tenantId = UserContext.tenantId();
        Long bank = accounts.findByTenantId(tenantId).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Monthly Payer", null, new BigDecimal("10000"),
                LocalDate.now().minusMonths(2).minusDays(2), null, new BigDecimal("12"), null, bank, null, null, null, null, null, true, bank));
        assertThat(claim.interestAccountId()).isEqualTo(bank);
        ClaimView posted = claims.postInterest(claim.id(), false);
        assertThat(posted.interestPosted()).isEqualByComparingTo("200");
        assertThat(posted.interestPostedUnpaid()).isEqualByComparingTo("0");
        assertThat(posted.interestReceived()).isEqualByComparingTo("200");
        assertThat(posted.timeline()).anyMatch(e -> e.title().equals("Interest received"));
        ClaimView settled = claims.repay(claim.id(), new RepaymentRequest(LocalDate.now(), new BigDecimal("10000"), posted.interestDue(), bank, null));
        assertThat(settled.status()).isEqualTo(ClaimStatus.SETTLED);
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    private BigDecimal interestIncome(Long categoryId) {
        return ledger.snapshot().categoryMovements(LocalDate.MIN.plusYears(1), LocalDate.now()).getOrDefault(categoryId, BigDecimal.ZERO);
    }

    @Autowired com.aditya.personalbudget.service.AttachmentService attachmentService;

    @Test
    void evidenceIsTypeCheckedKeptOnceAndDeletedWithItsEntry() throws Exception {
        Long cash = accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.CASH).orElseThrow().getId();
        Long bank = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> a.getAccountType() == AccountType.BANK).findFirst().orElseThrow().getId();
        JournalEntry transfer = ledger.post(JournalDraft.of(LocalDate.now(), VoucherType.JOURNAL, "ATM withdrawal")
                .debit(cash, new BigDecimal("500")).credit(bank, new BigDecimal("500")));
        var image = new java.awt.image.BufferedImage(800, 400, java.awt.image.BufferedImage.TYPE_INT_RGB);
        var out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "png", out);
        byte[] png = out.toByteArray();

        var first = attachmentService.add(transfer.getId(), "receipt.png", png, "CAMERA", "Bill");
        assertThat(first.image()).isTrue();
        assertThat(first.width()).isEqualTo(800);
        assertThat(first.hasThumbnail()).isTrue();
        assertThat(attachmentService.add(transfer.getId(), "again.png", png, "UPLOAD", null).id()).isEqualTo(first.id());
        assertThat(attachmentService.file(first.id(), true).contentType()).isEqualTo("image/jpeg");
        assertThatThrownBy(() -> attachmentService.add(transfer.getId(), "evil.png", "<script>".getBytes(), "UPLOAD", null))
                .isInstanceOf(BusinessException.class);
        var pdf = attachmentService.add(transfer.getId(), "statement", "%PDF-1.4 test".getBytes(), "UPLOAD", null);
        assertThat(pdf.pdf()).isTrue();
        assertThat(pdf.fileName()).isEqualTo("statement.pdf");
        assertThat(attachmentService.list(transfer.getId())).hasSize(2);

        attachmentService.delete(pdf.id());
        assertThat(attachmentService.list(transfer.getId())).hasSize(1);

        transactions.deleteEntry(transfer.getId());   // the evidence goes with its entry
        assertThat(attachmentService.countsByEntry()).doesNotContainKey(transfer.getId());
    }

    @Autowired CategoryRepository categoryRepository;
    @Autowired CategoryService categoryService;
    @Autowired AccountService accountService;
    @Autowired ChitService chitService;

    @Test
    void spendingIsSplitByCategoryOnOneExpensesAccount() {
        Long tenantId = UserContext.tenantId();
        assertThat(accounts.findByTenantId(tenantId)).filteredOn(a -> a.getAccountClass() == AccountClass.EXPENSE).hasSize(1);
        assertThat(accounts.findByTenantId(tenantId)).filteredOn(a -> a.getAccountClass() == AccountClass.INCOME).hasSize(1);
        assertThat(accounts.findByTenantId(tenantId)).filteredOn(a -> a.getAccountType() == AccountType.CHIT_FUND).hasSize(1);

        // every expense line carries a category and the categories add up to the Expenses account
        LocalDate from = LocalDate.now().minusYears(1);
        LocalDate to = LocalDate.now();
        var statement = reports.incomeStatement(from, to);
        assertThat(statement.expenses()).isNotEmpty().noneMatch(a -> "Uncategorised".equals(a.name()));
        Long expenses = accounts.findByTenantIdAndCode(tenantId, DefaultChartOfAccounts.EXPENSES).orElseThrow().getId();
        assertThat(statement.totalExpenses()).isEqualByComparingTo(ledger.snapshot().movementsBetween(from, to).get(expenses));

        assertThatThrownBy(() -> accountService.create(new com.aditya.personalbudget.dto.AccountDtos.AccountRequest(
                null, "Pets", AccountType.EXPENSE, null, null, null, null, null, null, null, null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("category");
    }

    @Test
    void chitSubLedgersAddUpToTheChitFundsAccount() {
        LedgerSnapshot books = ledger.snapshot();
        Long fund = accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.CHIT_FUNDS).orElseThrow().getId();
        BigDecimal byChit = books.chitBalancesAsOf(LocalDate.now()).values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        assertThat(byChit).isEqualByComparingTo(books.balanceAsOf(fund, LocalDate.now()));
        assertThat(chitService.list()).allSatisfy(c -> assertThat(c.accountId()).isEqualTo(fund));
    }

    @Test
    void aStaleEditIsRefused() {
        Category groceries = categoryRepository.findByName(UserContext.tenantId(), CategoryKind.EXPENSE, "Groceries").orElseThrow();
        Long loaded = groceries.getVersion();
        categoryService.update(groceries.getId(), new CategoryRequest(CategoryKind.EXPENSE, "Groceries", null,
                "first edit", true, loaded));
        assertThatThrownBy(() -> categoryService.update(groceries.getId(), new CategoryRequest(CategoryKind.EXPENSE,
                "Groceries", null, "edit from a stale screen", true, loaded)))
                .isInstanceOf(ConcurrentUpdateException.class);
        assertThat(categoryRepository.findById(groceries.getId()).orElseThrow().getDescription()).isEqualTo("first edit");
    }
}
