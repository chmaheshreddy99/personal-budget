package com.aditya.personalbudget.service;

import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.domain.type.RecurringKind;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.InstallmentView;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetRequest;
import com.aditya.personalbudget.dto.PlanningDtos.RecurringRequest;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.Random;

/**
 * Generates about six months of realistic household finances so the dashboard, reports and forecast
 * have something to show on first start. Runs once, inside the current user's tenant.
 */
@Service
public class DemoDataGenerator {

    private final AccountService accounts;
    private final AccountRepository accountRepository;
    private final TransactionService transactions;
    private final LedgerService ledger;
    private final ChitService chits;
    private final BudgetService budgets;
    private final RecurringService recurring;
    private final ClaimService claims;
    private final CategoryRepository categories;

    private final Random random = new Random(42);
    private LocalDate today;

    public DemoDataGenerator(AccountService accounts, AccountRepository accountRepository,
                             TransactionService transactions, LedgerService ledger, ChitService chits,
                             BudgetService budgets, RecurringService recurring, ClaimService claims,
                             CategoryRepository categories) {
        this.categories = categories;
        this.accounts = accounts;
        this.accountRepository = accountRepository;
        this.transactions = transactions;
        this.ledger = ledger;
        this.chits = chits;
        this.budgets = budgets;
        this.recurring = recurring;
        this.claims = claims;
    }

    @Transactional
    public void generate() {
        today = LocalDate.now();
        YearMonth first = YearMonth.from(today).minusMonths(6);
        LocalDate start = first.atDay(1);

        // ---------------------------------------------------------------- accounts with opening balances
        long hdfc = account("HDFC Savings", AccountType.BANK, "HDFC Bank", "XXXX4521", 185000, start, 3.0, null, null, null);
        long sbi = account("SBI Salary Account", AccountType.BANK, "State Bank of India", "XXXX8890", 42000, start, 2.7, null, null, null);
        long wallet = account("Paytm Wallet", AccountType.WALLET, "Paytm", null, 1500, start, null, null, null, null);
        long card = account("HDFC Regalia Card", AccountType.CREDIT_CARD, "HDFC Bank", "XXXX-XXXX-XXXX-1188", 18500, start, 42.0, 300000.0, null, null);
        long homeLoan = account("Home Loan - SBI", AccountType.HOME_LOAN, "State Bank of India", "HL-20931", 2450000, start, 8.5, 3000000.0, start.plusYears(17), null);
        long carLoan = account("Car Loan - ICICI", AccountType.VEHICLE_LOAN, "ICICI Bank", "VL-55120", 320000, start, 9.2, 600000.0, start.plusYears(3), null);
        account("Gold Jewellery", AccountType.GOLD, "Family locker", null, 640000, start, null, null, null, 90.0);
        account("SBI Fixed Deposit", AccountType.FIXED_DEPOSIT, "State Bank of India", "FD-77310", 300000, start, 7.1, null, today.plusDays(40), null);
        long mf = account("Axis Bluechip Fund", AccountType.MUTUAL_FUND, "Axis AMC", "Folio 9912/45", 215000, start, null, null, null, null);
        account("PPF Account", AccountType.SAVINGS_SCHEME, "Post Office", "PPF-11873", 480000, start, 7.1, null, start.plusYears(9), null);
        account("Flat - Hyderabad", AccountType.REAL_ESTATE, null, null, 4500000, start, null, null, null, null);
        account("Car - Hyundai Creta", AccountType.VEHICLE, null, "TS09 AB 1234", 950000, start, null, null, null, null);

        long cash = code(DefaultChartOfAccounts.CASH);
        long payables = code(DefaultChartOfAccounts.PAYABLES);
        long salary = income("Salary");
        long interestIncome = income("Interest");
        long groceries = expense("Groceries");
        long utilities = expense("Utilities");
        long mobile = expense("Mobile & Internet");
        long fuel = expense("Fuel & Transport");
        long dining = expense("Dining Out");
        long medical = expense("Medical & Health");
        long education = expense("Education");
        long entertainment = expense("Entertainment");
        long shopping = expense("Shopping & Clothing");
        long insurance = expense("Insurance Premiums");
        long loanInterest = expense("Loan Interest");
        long maintenance = expense("Home Maintenance");
        long personalCare = expense("Personal Care");
        long kids = expense("Kids & Family");

        // ---------------------------------------------------------------- monthly activity
        for (YearMonth m = first; !m.isAfter(YearMonth.from(today)); m = m.plusMonths(1)) {
            income(m.atDay(1), 140000, salary, sbi, "Salary credit");
            transfer(m.atDay(2), 90000, sbi, hdfc, "Move salary to savings");
            transfer(m.atDay(4), 12000, hdfc, cash, "ATM withdrawal");
            transfer(m.atDay(5), 10000, hdfc, mf, "SIP - Axis Bluechip");
            emi(m.atDay(5), "Home loan EMI", homeLoan, 6800, loanInterest, 17200, hdfc);
            emi(m.atDay(10), "Car loan EMI", carLoan, 8500, loanInterest, 2400, hdfc);
            expense(m.atDay(7), between(2800, 3900), hdfc, utilities, "Electricity & water");
            expense(m.atDay(8), 1499, card, mobile, "Broadband + mobile plan");
            expense(m.atDay(12), 649, card, entertainment, "OTT subscription");

            for (int day : new int[]{3, 11, 18, 25}) {
                expense(m.atDay(day), between(2500, 5500), day % 2 == 1 ? card : cash, groceries, "Groceries");
            }
            for (int day : new int[]{6, 16, 26}) {
                expense(m.atDay(day), between(1800, 3000), card, fuel, "Fuel");
            }
            for (int day : new int[]{9, 21}) {
                expense(m.atDay(day), between(800, 2600), day == 9 ? wallet : card, dining, "Dinner out");
            }
            expense(m.atDay(14), between(2000, 7000), card, shopping, "Shopping");
            expense(m.atDay(19), between(600, 1200), wallet, personalCare, "Salon");
            if (random.nextBoolean()) {
                expense(m.atDay(22), between(500, 3500), cash, medical, "Pharmacy");
            }
            if (m.getMonthValue() % 3 == 0) {
                expense(m.atDay(15), 18000, hdfc, education, "School fees - quarter");
                income(m.atEndOfMonth(), 2150, interestIncome, hdfc, "Savings interest");
            }
            expense(m.atDay(17), between(500, 2500), cash, kids, "Kids activities");
            transfer(m.atDay(20), between(14000, 22000), hdfc, card, "Credit card bill payment");
            transfer(m.atDay(13), 3500, hdfc, wallet, "Wallet top-up");
        }
        expense(start.plusMonths(2).withDayOfMonth(23), 24500, hdfc, insurance, "Health insurance premium");

        // ---------------------------------------------------------------- payables & receivables
        lentAndPaidFor(start, hdfc, card, cash);
        transfer(start.plusDays(40), 30000, payables, hdfc, "Borrowed from brother");
        expense(today.minusDays(12), 4500, payables, maintenance, "Plumbing work - to pay");

        // ---------------------------------------------------------------- chits
        createActiveChit(start, hdfc);
        createPrizedChit(start, hdfc, sbi);

        // ---------------------------------------------------------------- budgets
        budget(groceries, 16000);
        budget(dining, 5000);
        budget(fuel, 8000);
        budget(utilities, 4000);
        budget(shopping, 8000);
        budget(entertainment, 2500);
        budget(medical, 3000);
        budget(personalCare, 1500);
        budget(mobile, 1600);

        // ---------------------------------------------------------------- recurring items (next occurrences)
        recurringItem("Monthly salary", RecurringKind.INCOME, 140000, sbi, null, salary, Frequency.MONTHLY, 1);
        // Recurring loan items carry the principal; the interest part is projected from Loan Interest history
        recurringItem("Home loan EMI (principal)", RecurringKind.TRANSFER, 6800, homeLoan, hdfc, null, Frequency.MONTHLY, 5);
        recurringItem("Car loan EMI (principal)", RecurringKind.TRANSFER, 8500, carLoan, hdfc, null, Frequency.MONTHLY, 10);
        recurringItem("SIP - Axis Bluechip", RecurringKind.TRANSFER, 10000, mf, hdfc, null, Frequency.MONTHLY, 5);
        recurringItem("Broadband + mobile", RecurringKind.EXPENSE, 1499, null, card, mobile, Frequency.MONTHLY, 8);
        recurringItem("OTT subscription", RecurringKind.EXPENSE, 649, null, card, entertainment, Frequency.MONTHLY, 12);
        recurringItem("School fees", RecurringKind.EXPENSE, 18000, null, hdfc, education, Frequency.QUARTERLY, 15);
    }

    // ==================================================================== lent / paid for others

    /** Money lent and bills paid for others, in every state: open, partly repaid, settled and overdue. */
    private void lentAndPaidFor(LocalDate start, long bank, long card, long cash) {
        LocalDate lentDate = start.plusDays(20);
        ClaimView ravi = claims.create(new ClaimRequest(ClaimKind.LENT, "Ravi Kumar", "Hand loan for bike repair",
                bd(25000), lentDate, lentDate.plusMonths(5), bd(12), null, bank, null, "UPI 4471",
                "Agreed 1% a month, to be returned in instalments", null, null, null, null));
        claims.repay(ravi.id(), new RepaymentRequest(lentDate.plusDays(60), bd(10000), bd(500), bank, "First instalment"));

        ClaimView kiran = claims.create(new ClaimRequest(ClaimKind.LENT, "Kiran", "Lent for house deposit",
                bd(15000), today.minusDays(25), today.plusDays(35), null, null, bank, null, null, null, null, null, null, null));
        claims.repay(kiran.id(), new RepaymentRequest(today.minusDays(4), bd(4000), null, cash, null));

        ClaimView suresh = claims.create(new ClaimRequest(ClaimKind.PAID_FOR, "Suresh", "Movie tickets for Suresh",
                bd(1800), today.minusDays(40), null, null, null, card, null, null, null, null, null, null, null));
        claims.repay(suresh.id(), new RepaymentRequest(today.minusDays(33), bd(1800), null, cash, "Paid back in cash"));

        ClaimView anil = claims.create(new ClaimRequest(ClaimKind.PAID_FOR, "Anil", "Flight ticket for Anil - Goa trip",
                bd(8600), today.minusDays(60), today.minusDays(15), null, null, card, null, "PNR K7Q2LM", null, null, null, null, null));
        claims.repay(anil.id(), new RepaymentRequest(today.minusDays(20), bd(5000), null, bank, null));

        claims.create(new ClaimRequest(ClaimKind.PAID_FOR, "Mom", "Mom's medicines", bd(3200), today.minusDays(9),
                null, null, null, bank, null, null, "Pharmacy bill, Apollo", null, null, null, null));
    }

    // ==================================================================== chits

    /** A running chit with all due installments paid and small dividends. */
    private void createActiveChit(LocalDate start, long fromAccount) {
        ChitDetail chit = chits.create(new ChitRequest("Shriram Gold 5L", "Shriram Chits", "G-114/07",
                bd(500000), bd(22500), 20, start.plusDays(9), null, null, bd(5), "Monthly auction on the 10th",
                "shriramchits@hdfcbank", null, fromAccount, 0, null));
        payDueInstallments(chit, fromAccount, 800, 2200);
    }

    /** A chit joined earlier, prize taken two months ago, still paying installments. */
    private void createPrizedChit(LocalDate start, long fromAccount, long depositAccount) {
        LocalDate chitStart = start.minusMonths(4).plusDays(14);
        ChitDetail chit = chits.create(new ChitRequest("Margadarsi 2L", "Margadarsi Chit Funds", "M-88/21",
                bd(200000), bd(10000), 20, chitStart, null, bd(9), bd(5), "Bid taken early for home renovation",
                null, null, fromAccount, 4, null));
        payDueInstallments(chit, fromAccount, 300, 900);
        LocalDate payoutDate = today.minusMonths(2);
        chits.payout(chit.chit().id(), new PayoutRequest(payoutDate, bd(172000), depositAccount));
    }

    private void payDueInstallments(ChitDetail chit, long fromAccount, int minDividend, int maxDividend) {
        for (InstallmentView i : chit.installments()) {
            if (i.status() == InstallmentStatus.PENDING && !i.dueDate().isAfter(today)) {
                chits.payInstallment(chit.chit().id(), i.id(),
                        new PayInstallmentRequest(i.dueDate(), fromAccount, bd(between(minDividend, maxDividend))));
            }
        }
    }

    // ==================================================================== posting helpers

    private long account(String name, AccountType type, String institution, String number, double opening,
                         LocalDate openingDate, Double rate, Double limit, LocalDate maturity, Double quantity) {
        return accounts.create(new AccountRequest(null, name, type, institution, number, bd(opening), openingDate,
                rate == null ? null : bd(rate), limit == null ? null : bd(limit), maturity,
                quantity == null ? null : bd(quantity), null, true, null)).id();
    }

    private long code(String code) {
        return accountRepository.findByTenantIdAndCode(UserContext.tenantId(), code).orElseThrow().getId();
    }

    private long expense(String category) {
        return categories.findByName(UserContext.tenantId(), CategoryKind.EXPENSE, category).orElseThrow().getId();
    }

    private long income(String category) {
        return categories.findByName(UserContext.tenantId(), CategoryKind.INCOME, category).orElseThrow().getId();
    }

    private void expense(LocalDate date, double amount, long from, long category, String narration) {
        quick(QuickKind.EXPENSE, date, amount, from, null, category, narration);
    }

    private void income(LocalDate date, double amount, long category, long to, String narration) {
        quick(QuickKind.INCOME, date, amount, null, to, category, narration);
    }

    private void transfer(LocalDate date, double amount, long from, long to, String narration) {
        quick(QuickKind.TRANSFER, date, amount, from, to, null, narration);
    }

    private void quick(QuickKind kind, LocalDate date, double amount, Long from, Long to, Long category, String narration) {
        if (date.isAfter(today)) {
            return;
        }
        transactions.postQuick(new QuickTransactionRequest(kind, date, bd(amount), from, to, category, narration, null, null));
    }

    /** Loan EMI split into principal (reduces the loan) and interest (an expense). */
    private void emi(LocalDate date, String narration, long loan, double principal, long interestCategory,
                     double interest, long bank) {
        if (date.isAfter(today)) {
            return;
        }
        ledger.post(JournalDraft.of(date, VoucherType.JOURNAL, narration)
                .debit(loan, bd(principal), "Principal")
                .debit(code(DefaultChartOfAccounts.EXPENSES), bd(interest), "Interest").category(interestCategory)
                .credit(bank, bd(principal + interest)));
    }

    private void budget(long categoryId, double limit) {
        budgets.save(new BudgetRequest(categoryId, bd(limit), 80, null, null, null, null, null));
    }

    private void recurringItem(String name, RecurringKind kind, double amount, Long debit, Long credit, Long category,
                               Frequency frequency, int dayOfMonth) {
        LocalDate thisMonth = today.withDayOfMonth(Math.min(dayOfMonth, today.lengthOfMonth()));
        LocalDate next = thisMonth.isAfter(today) ? thisMonth : frequency.next(thisMonth);
        recurring.create(new RecurringRequest(name, kind, bd(amount), debit, credit, category, frequency,
                today.minusMonths(6).withDayOfMonth(1), null, next, true, null, null));
    }

    private double between(int min, int max) {
        return Math.round(min + random.nextDouble() * (max - min));
    }

    private static BigDecimal bd(double value) {
        return Money.of(value);
    }
}
