package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Chart of accounts management. An account's current balance is stored on it and kept by the ledger
 * ({@link AccountLedgerSync}); balances as of other dates are worked out from the journal lines.
 */
@Service
public class AccountService {

    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final BudgetRepository budgets;
    private final LedgerService ledger;

    public AccountService(AccountRepository accounts, JournalEntryRepository entries, BudgetRepository budgets,
                          LedgerService ledger) {
        this.accounts = accounts;
        this.entries = entries;
        this.budgets = budgets;
        this.ledger = ledger;
    }

    // ================================================================== queries

    public List<AccountView> list() {
        LedgerSnapshot books = ledger.snapshot();
        LocalDate today = LocalDate.now();
        YearMonth month = YearMonth.from(today);
        Map<Long, BigDecimal> balances = books.balancesAsOf(LocalDate.MAX);
        Map<Long, BigDecimal> monthMoves = books.movementsBetween(month.atDay(1), month.atEndOfMonth());
        Map<Long, BigDecimal> thirtyDaysAgo = books.balancesAsOf(today.minusDays(30));

        // month-end balances for the sparkline: five past month ends + today
        List<Map<Long, BigDecimal>> trendPoints = new ArrayList<>();
        for (int i = 5; i >= 1; i--) {
            trendPoints.add(books.balancesAsOf(month.minusMonths(i).atEndOfMonth()));
        }
        trendPoints.add(books.balancesAsOf(today));

        Map<Long, Long> counts = new HashMap<>();
        Map<Long, LocalDate> lastActivity = new HashMap<>();
        Map<Long, BigDecimal> monthIn = new HashMap<>();
        Map<Long, BigDecimal> monthOut = new HashMap<>();
        for (LedgerSnapshot.PostedLine line : books.lines()) {
            counts.merge(line.accountId(), 1L, Long::sum);
            lastActivity.merge(line.accountId(), line.date(), (a, b) -> a.isAfter(b) ? a : b);
            if (YearMonth.from(line.date()).equals(month)) {
                BigDecimal change = books.natural(line.accountId(), line.net());
                if (change.signum() > 0) {
                    monthIn.merge(line.accountId(), change, BigDecimal::add);
                } else {
                    monthOut.merge(line.accountId(), change.negate(), BigDecimal::add);
                }
            }
        }

        return books.accounts().values().stream()
                .sorted(Comparator.comparing(Account::getCode))
                .map(a -> {
                    // the stored balance, kept by the ledger on every debit and credit
                    BigDecimal balance = a.getBalance() != null ? a.getBalance() : balances.getOrDefault(a.getId(), Money.ZERO);
                    List<BigDecimal> trend = trendPoints.stream().map(m -> m.getOrDefault(a.getId(), Money.ZERO)).toList();
                    return toView(a, balance, monthMoves.getOrDefault(a.getId(), Money.ZERO),
                            monthIn.getOrDefault(a.getId(), Money.ZERO), monthOut.getOrDefault(a.getId(), Money.ZERO),
                            balance.subtract(thirtyDaysAgo.getOrDefault(a.getId(), Money.ZERO)),
                            lastActivity.get(a.getId()), counts.getOrDefault(a.getId(), 0L), trend, today);
                })
                .toList();
    }

    public AccountView get(Long id) {
        return list().stream().filter(v -> v.id().equals(id)).findFirst()
                .orElseThrow(() -> new NotFoundException("Account", id));
    }

    public Account require(Long id) {
        return accounts.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Account", id));
    }

    /** A well-known system account (see {@link DefaultChartOfAccounts}). */
    public Account systemAccount(String code) {
        return accounts.findByTenantIdAndCode(UserContext.tenantId(), code)
                .orElseThrow(() -> new BusinessException("System account " + code + " is missing"));
    }

    /**
     * The account holder's name, account / card number, IFSC and UPI ID are sensitive: only an admin or super admin
     * sees them (and changes them on an existing account). Work the system does by itself (no one signed in) sees them.
     */
    public static boolean canSeeBankDetails() {
        return UserContext.current().map(u -> u.role() == UserRole.ADMIN || u.role() == UserRole.SUPER_ADMIN).orElse(true);
    }

    // ================================================================== commands

    @Transactional
    public AccountView create(AccountRequest request) {
        Long tenantId = UserContext.tenantId();
        requireNotCategory(request);
        Account account = new Account();
        account.setTenantId(tenantId);
        account.setSystemAccount(false);
        account.setCreatedAt(LocalDateTime.now());
        apply(account, request);
        if (account.getCode() == null || account.getCode().isBlank()) {
            account.setCode(nextCode(tenantId, account.getAccountClass()));
        }
        account = accounts.save(account);
        syncOpeningBalance(account);
        return get(account.getId());
    }

    @Transactional
    public AccountView update(Long id, AccountRequest request) {
        Account account = require(id);
        AccountClass oldClass = account.getAccountClass();
        String oldCode = account.getCode();
        BigDecimal oldOpening = account.getOpeningBalance();
        LocalDate oldOpeningDate = account.getOpeningDate();
        Account stored = require(id);
        if (!Boolean.TRUE.equals(account.getSystemAccount())) {
            requireNotCategory(request);
        }
        apply(account, request);

        if (Boolean.TRUE.equals(account.getSystemAccount())) {
            if (oldClass != account.getAccountClass() || !oldCode.equals(account.getCode())) {
                throw new BusinessException("The code and class of a system account cannot change");
            }
        }
        if (oldClass != account.getAccountClass() && hasTransactions(account.getId())) {
            throw new BusinessException("Cannot move an account with transactions from "
                    + oldClass.getLabel() + " to " + account.getAccountClass().getLabel());
        }
        if (account.getCode() == null || account.getCode().isBlank()) {
            account.setCode(oldCode);
        }
        // the opening balance is set when the account is created and never edited (left out of a request: unchanged)
        if (request.openingBalance() != null && request.openingBalance().compareTo(Money.nz(oldOpening)) != 0) {
            throw new BusinessException("The opening balance of '" + account.getName()
                    + "' cannot be changed once the account is created. Post an adjustment entry to correct the balance instead");
        }
        account.setOpeningBalance(oldOpening);
        account.setOpeningDate(oldOpeningDate);
        if (!canSeeBankDetails()) {   // they never saw the details, so the form cannot change them
            account.setAccountNumber(stored.getAccountNumber());
            account.setHolderName(stored.getHolderName());
            account.setIfsc(stored.getIfsc());
            account.setUpiId(stored.getUpiId());
        }
        account.setVersion(request.version());   // a stale form is refused
        account = accounts.save(account);
        return get(account.getId());
    }

    @Transactional
    public void delete(Long id) {
        Account account = require(id);
        if (Boolean.TRUE.equals(account.getSystemAccount())) {
            throw new BusinessException("'" + account.getName() + "' is a system account and cannot be deleted");
        }
        if (hasTransactions(id)) {
            throw new BusinessException("'" + account.getName()
                    + "' has transactions. Deactivate it instead, or delete its transactions first");
        }
        openingEntry(account).ifPresent(e -> ledger.delete(e.getId()));
        accounts.deleteById(id);
    }

    /** Creates an account directly (used by other features such as chits). */
    @Transactional
    public Account createInternal(String name, AccountType type, String description, boolean system) {
        Long tenantId = UserContext.tenantId();
        Account account = new Account();
        account.setTenantId(tenantId);
        account.setCode(nextCode(tenantId, type.getAccountClass()));
        account.setName(name);
        account.setAccountType(type);
        account.setAccountClass(type.getAccountClass());
        account.setDescription(description);
        account.setSystemAccount(system);
        account.setActive(true);
        account.setCreatedAt(LocalDateTime.now());
        return accounts.save(account);
    }

    // ================================================================== helpers

    /**
     * Spending and earnings are split by category, not by account: there is one Expenses and one Income
     * account. A new "expense account" is a category instead.
     */
    private static void requireNotCategory(AccountRequest request) {
        AccountClass cls = request.accountType().getAccountClass();
        if (cls == AccountClass.EXPENSE || cls == AccountClass.INCOME) {
            throw new BusinessException("Add '" + request.name() + "' as a " + (cls == AccountClass.EXPENSE ? "expense" : "income")
                    + " category (Settings, Categories). Expenses and income use one account each, split by category");
        }
        if (request.accountType() == com.aditya.personalbudget.domain.type.AccountType.CHIT_FUND) {
            throw new BusinessException("Chits are added on the Chits page; they all post to the Chit Funds account");
        }
    }

    private void apply(Account account, AccountRequest r) {
        AccountType type = r.accountType();
        account.setAccountType(type);
        account.setAccountClass(type.getAccountClass());
        if (r.code() != null && !r.code().isBlank()) {
            account.setCode(r.code().trim());
        }
        account.setName(r.name().trim());
        account.setInstitution(r.institution());
        account.setAccountNumber(r.accountNumber());
        account.setInterestRate(r.interestRate());
        account.setCreditLimit(r.creditLimit());
        account.setMaturityDate(r.maturityDate());
        account.setQuantity(r.quantity());
        account.setDescription(r.description());
        applyBankDetails(account, r);
        account.setActive(r.active() == null || r.active());

        boolean balanceSheet = type.getAccountClass() == AccountClass.ASSET
                || type.getAccountClass() == AccountClass.LIABILITY;
        if (balanceSheet && Money.isPositive(r.openingBalance())) {
            account.setOpeningBalance(Money.round(r.openingBalance()));
            account.setOpeningDate(r.openingDate() != null ? r.openingDate() : LocalDate.now());
        } else {
            account.setOpeningBalance(null);
            account.setOpeningDate(r.openingDate());
        }
    }

    /**
     * Bank and wallet accounts carry the details chit members pay into: the holder's name, IFSC (banks) and UPI ID,
     * checked for their form; other kinds of account have none.
     */
    private static void applyBankDetails(Account account, AccountRequest r) {
        boolean bank = account.getAccountType() == AccountType.BANK;
        boolean wallet = account.getAccountType() == AccountType.WALLET;
        String holder = clean(r.holderName());
        String ifsc = clean(r.ifsc()) == null ? null : r.ifsc().trim().toUpperCase();
        String upi = clean(r.upiId());
        if (ifsc != null && !ifsc.matches("[A-Z]{4}0[A-Z0-9]{6}")) {
            throw new BusinessException("The IFSC should look like ICIC0000598 (4 letters, 0, then 6 letters or digits)");
        }
        if (upi != null && !upi.matches("[\\w.\\-]{2,}@[A-Za-z][\\w.]{1,}")) {
            throw new BusinessException("The UPI ID should look like name@bank");
        }
        if (r.accountNumber() != null && !r.accountNumber().isBlank() && bank && !r.accountNumber().trim().matches("[A-Za-z0-9 \\-]{4,40}")) {
            throw new BusinessException("The account number can have letters, digits, spaces and dashes");
        }
        account.setHolderName(bank || wallet ? holder : null);
        account.setIfsc(bank ? ifsc : null);
        account.setUpiId(bank || wallet ? upi : null);
    }

    /** Updates only the bank details of a bank or wallet account (e.g. when it is picked for chit members to pay into). */
    @Transactional
    public AccountView updateBankDetails(Long id, com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest r) {
        if (!canSeeBankDetails()) {
            throw new ForbiddenException("Only an admin can change an account's bank details");
        }
        Account account = require(id);
        if (account.getAccountType() != AccountType.BANK && account.getAccountType() != AccountType.WALLET) {
            throw new BusinessException(account.getName() + " is not a bank or wallet account");
        }
        if (r.version() != null && !r.version().equals(account.getVersion())) {
            throw new BusinessException(account.getName() + " was changed by someone else; reopen it and try again");
        }
        account.setInstitution(clean(r.institution()));
        account.setAccountNumber(clean(r.accountNumber()));
        applyBankDetails(account, new AccountRequest(account.getCode(), account.getName(), account.getAccountType(), account.getInstitution(),
                account.getAccountNumber(), null, null, null, null, null, null, null, null, null, r.holderName(), r.ifsc(), r.upiId()));
        accounts.save(account);
        return get(id);
    }

    private static String clean(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /**
     * Keeps the opening-balance journal in line with the account's opening balance.
     * Asset: debit account / credit Opening Balance Equity. Liability: the reverse.
     */
    private void syncOpeningBalance(Account account) {
        Optional<JournalEntry> existing = openingEntry(account);
        if (!Money.isPositive(account.getOpeningBalance())) {
            existing.ifPresent(e -> ledger.delete(e.getId()));
            return;
        }
        Account equity = systemAccount(DefaultChartOfAccounts.OPENING_BALANCE_EQUITY);
        BigDecimal amount = account.getOpeningBalance();
        JournalDraft draft = JournalDraft.of(account.getOpeningDate(), VoucherType.OPENING,
                        "Opening balance - " + account.getName())
                .source(LedgerService.SOURCE_ACCOUNT_OPENING, account.getId());
        if (account.getAccountClass() == AccountClass.ASSET) {
            draft.debit(account.getId(), amount).credit(equity.getId(), amount);
        } else {
            draft.debit(equity.getId(), amount).credit(account.getId(), amount);
        }
        if (existing.isPresent()) {
            ledger.repost(existing.get().getId(), draft);
        } else {
            ledger.post(draft);
        }
    }

    private Optional<JournalEntry> openingEntry(Account account) {
        return entries.findBySource(account.getTenantId(), LedgerService.SOURCE_ACCOUNT_OPENING, account.getId())
                .stream().findFirst();
    }

    /** True when the account has lines other than its own opening balance entry. */
    private boolean hasTransactions(Long accountId) {
        Account account = require(accountId);
        Long openingId = openingEntry(account).map(JournalEntry::getId).orElse(-1L);
        return ledger.entryIdsTouchingAccount(accountId).stream().anyMatch(id -> !id.equals(openingId));
    }

    /** Next free code in the class range, stepping by 10 (1xxx assets ... 5xxx expenses). */
    String nextCode(Long tenantId, AccountClass accountClass) {
        int base = switch (accountClass) {
            case ASSET -> 1000;
            case LIABILITY -> 2000;
            case EQUITY -> 3000;
            case INCOME -> 4000;
            case EXPENSE -> 5000;
        };
        int max = accounts.findByTenantId(tenantId).stream()
                .map(Account::getCode)
                .filter(c -> c.matches("\\d+"))
                .mapToInt(Integer::parseInt)
                .filter(c -> c >= base && c < base + 1000)
                .max().orElse(base);
        int next = (max / 10 + 1) * 10;
        if (next >= base + 1000) {
            throw new BusinessException("No free account code left in the " + accountClass.getLabel() + " range");
        }
        return String.valueOf(next);
    }

    private AccountView toView(Account a, BigDecimal balance, BigDecimal monthMove, BigDecimal in, BigDecimal out,
                               BigDecimal change30, LocalDate last, long count, List<BigDecimal> trend, LocalDate today) {
        boolean details = canSeeBankDetails();   // sensitive: admins only
        BigDecimal utilization = null;
        BigDecimal available = null;
        if (Money.isPositive(a.getCreditLimit())) {
            utilization = Money.percent(balance, a.getCreditLimit());
            available = a.getCreditLimit().subtract(balance);
        }
        Long daysToMaturity = a.getMaturityDate() == null ? null : ChronoUnit.DAYS.between(today, a.getMaturityDate());
        return new AccountView(a.getId(), a.getCode(), a.getName(), a.getAccountClass(), a.getAccountType(),
                a.getAccountType().getLabel(), a.getInstitution(), details ? a.getAccountNumber() : null, a.getOpeningBalance(),
                a.getOpeningDate(), a.getInterestRate(), a.getCreditLimit(), a.getMaturityDate(), a.getQuantity(),
                a.getDescription(), Boolean.TRUE.equals(a.getSystemAccount()), Boolean.TRUE.equals(a.getActive()),
                balance, monthMove, in, out, change30, utilization, available, daysToMaturity,
                ReportService.bucket(a), last, count, trend, a.getVersion(), a.isChitBook(), a.getHostedChitId(), a.getChitRole(),
                details ? a.getHolderName() : null, details ? a.getIfsc() : null, details ? a.getUpiId() : null, a.isProjectBook(), a.getProjectId(), a.getProjectRole(), a.isEmiAccount());
    }
}
