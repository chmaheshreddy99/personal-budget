package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BankInterestPosting;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.InterestFrequency;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestOverview;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestPeriod;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestRange;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestSettingsRequest;
import com.aditya.personalbudget.dto.BankInterestDtos.MonthBalance;
import com.aditya.personalbudget.dto.BankInterestDtos.PostInterestRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.BankInterestPostingRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * A bank account's average balance and interest, as banks reckon a savings account: every day's closing balance earns
 * rate / 365 (simple, nothing on an overdrawn day), and the interest of a calendar month or quarter is credited as one
 * entry, Dr the bank, Cr Income [Interest], dated the period's last day.
 * <ul>
 *   <li>A credit counts from the day after its date, so it never changes the period it pays for, and later periods earn on it.</li>
 *   <li>Each account says from which date it reckons (earlier interest may be in the books already), how often it
 *       is credited and whether finished periods post by themselves ({@code InterestPostingJob}, or when the plan is saved).</li>
 *   <li>A period posted by hand can carry what the bank really paid. Entries back-dated into a posted period leave
 *       its amount as it is: the period then shows what it would work out to now.</li>
 * </ul>
 */
@Service
public class BankInterestService {

    private static final BigDecimal DAY_BASE = BigDecimal.valueOf(36500);   // rate in percent over 365 days
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("MMM", Locale.ENGLISH);
    private static final DateTimeFormatter MONTH_YEAR = DateTimeFormatter.ofPattern("MMM yyyy", Locale.ENGLISH);

    private final AccountRepository accounts;
    private final BankInterestPostingRepository postings;
    private final LedgerService ledger;
    private final CategoryService categories;

    public BankInterestService(AccountRepository accounts, BankInterestPostingRepository postings, LedgerService ledger,
                               CategoryService categories) {
        this.accounts = accounts;
        this.postings = postings;
        this.ledger = ledger;
        this.categories = categories;
    }

    // ================================================================== what the screen shows

    public InterestOverview overview(Long accountId) {
        return overview(accountId, null, null);
    }

    /** {@code from}, {@code to}: the dates to show, either empty for no limit. */
    public InterestOverview overview(Long accountId, LocalDate from, LocalDate to) {
        return overview(bank(accountId), 0, from, to);
    }

    private InterestOverview overview(Account account, int postedNow) {
        return overview(account, postedNow, null, null);
    }

    private InterestOverview overview(Account account, int postedNow, LocalDate askedFrom, LocalDate askedTo) {
        LocalDate today = OrgClock.today();
        LedgerSnapshot books = ledger.snapshot();
        Balances balances = Balances.of(account.getId(), books);
        BigDecimal rate = Money.nz(account.getInterestRate());
        List<InterestPeriod> every = periods(account, balances, books, today);
        List<InterestPeriod> due = every.stream().filter(p -> "DUE".equals(p.state())).toList();
        BigDecimal dueAmount = due.stream().map(InterestPeriod::calculated).reduce(Money.ZERO, BigDecimal::add);

        LocalDate from = balances.start() == null ? null : askedFrom == null ? balances.start() : max(askedFrom, balances.start());
        LocalDate to = askedTo == null ? today : min(askedTo, today);
        boolean any = from != null && !from.isAfter(to);
        List<InterestPeriod> shown = any ? every.stream().filter(p -> !p.from().isAfter(to) && !p.to().isBefore(from)).toList() : List.of();
        InterestRange range = null;
        if (any) {
            Stats s = balances.stats(from, to);
            BigDecimal posted = every.stream().filter(p -> "POSTED".equals(p.state()) && !p.entryDate().isBefore(from) && !p.entryDate().isAfter(to))
                    .map(InterestPeriod::amount).reduce(Money.ZERO, BigDecimal::add);
            range = new InterestRange(from, to, s.days(), s.average(), s.lowest(), s.highest(), s.interest(rate), posted);
        }
        return new InterestOverview(account.getId(), account.getInterestRate(), frequencyOf(account), Boolean.TRUE.equals(account.getInterestAutoPost()),
                startOf(account, today), account.getVersion(), balances.start(), range, due.size(), dueAmount,
                any ? months(balances, rate, today, from, to) : List.of(), shown, postedNow);
    }

    /** Each month touching the dates, whole, newest first. */
    private static List<MonthBalance> months(Balances balances, BigDecimal rate, LocalDate today, LocalDate rangeFrom, LocalDate rangeTo) {
        List<MonthBalance> out = new ArrayList<>();
        YearMonth first = YearMonth.from(rangeFrom);
        YearMonth month = YearMonth.from(rangeTo);
        while (!month.isBefore(first)) {
            LocalDate from = max(month.atDay(1), balances.start());
            LocalDate to = min(month.atEndOfMonth(), today);
            if (!from.isAfter(to)) {
                Stats s = balances.stats(from, to);
                out.add(new MonthBalance(month.toString(), s.days(), s.average(), s.lowest(), s.highest(), balances.closing(to),
                        s.interest(rate), !month.atEndOfMonth().isBefore(today)));
            }
            month = month.minusMonths(1);
        }
        return out;
    }

    /** What was posted or undone, and the periods since the account's start that are not; newest first. */
    private List<InterestPeriod> periods(Account account, Balances balances, LedgerSnapshot books, LocalDate today) {
        BigDecimal rate = Money.nz(account.getInterestRate());
        List<BankInterestPosting> done = postings.findByAccountId(account.getId());
        List<InterestPeriod> out = new ArrayList<>();
        for (BankInterestPosting p : done) {
            Stats s = balances.stats(p.getPeriodFrom(), p.getPeriodTo());
            JournalEntry entry = p.getJournalEntryId() == null ? null : books.entry(p.getJournalEntryId());
            out.add(new InterestPeriod(label(p.getPeriodFrom(), p.getPeriodTo()), p.getPeriodFrom(), p.getPeriodTo(), s.days(), s.average(), s.interest(rate),
                    entry == null ? "SKIPPED" : "POSTED", p.getId(), entry == null ? null : p.getAmount(), p.getJournalEntryId(),
                    entry == null ? null : entry.getEntryNo(), entry == null ? null : entry.getEntryDate(), Boolean.TRUE.equals(p.getAutomatic())));
        }
        if (balances.start() != null) {
            InterestFrequency frequency = frequencyOf(account);
            LocalDate first = max(startOf(account, today), balances.start());
            for (LocalDate start = periodStart(first, frequency); !start.isAfter(today); start = nextPeriod(start, frequency)) {
                LocalDate end = nextPeriod(start, frequency).minusDays(1);
                LocalDate from = max(start, first);
                // whatever part of the period was reckoned already (the frequency may have changed since) is not reckoned again
                for (BankInterestPosting p : done) {
                    if (!p.getPeriodFrom().isAfter(end) && !p.getPeriodTo().isBefore(from)) {
                        from = max(from, p.getPeriodTo().plusDays(1));
                    }
                }
                if (from.isAfter(end) || from.isAfter(today)) {
                    continue;
                }
                boolean running = !end.isBefore(today);
                Stats s = balances.stats(from, min(end, today));
                out.add(new InterestPeriod(label(from, end), from, end, s.days(), s.average(), s.interest(rate), running ? "RUNNING" : "DUE",
                        null, null, null, null, null, false));
            }
        }
        out.sort(Comparator.comparing(InterestPeriod::from).reversed());
        return out;
    }

    // ================================================================== the account's plan

    /** Saves the plan; an account that posts by itself posts what has finished since its start right away. */
    @Transactional
    public InterestOverview saveSettings(Long accountId, InterestSettingsRequest r) {
        Account account = bank(accountId);
        if (r.autoPost() && !Money.isPositive(r.interestRate())) {
            throw new BusinessException("Set the interest rate before posting interest automatically");
        }
        account.setInterestRate(r.interestRate());
        account.setInterestFrequency(r.frequency());
        account.setInterestAutoPost(r.autoPost());
        account.setInterestFrom(r.interestFrom() != null ? r.interestFrom() : periodStart(OrgClock.today(), r.frequency()));
        account.setVersion(ConcurrentUpdateException.required(r.version(), "accounts", accountId));   // a stale form is refused
        Account saved = accounts.save(account);
        return overview(saved, r.autoPost() ? postDue(saved) : 0);
    }

    // ================================================================== posting

    /** Credits a finished period by hand, with what the bank really paid if that differs. */
    @Transactional
    public InterestOverview post(Long accountId, PostInterestRequest r) {
        Account account = bank(accountId);
        InterestPeriod period = open(account).stream().filter(p -> p.from().equals(r.from()) && p.to().equals(r.to())).findFirst()
                .orElseThrow(() -> new BusinessException("That period is already posted or has not finished yet"));
        BigDecimal amount = r.amount() != null ? r.amount() : period.calculated();
        if (!Money.isPositive(amount)) {
            throw new BusinessException("There is no interest to post for " + period.label() + ": enter what the bank paid");
        }
        LocalDate date = r.date() != null ? r.date() : period.to();
        if (date.isAfter(OrgClock.today())) {
            throw new BusinessException("The interest cannot be dated in the future");
        }
        if (date.isBefore(period.from())) {
            throw new BusinessException("The interest cannot be dated before the period it pays for");
        }
        credit(account, period, amount, date, false);
        return overview(account, 0);
    }

    /**
     * Takes a posted period out of the books. On an account that posts by itself the period stays recorded, without an
     * entry, or the next night would post it again; it can still be posted by hand.
     */
    @Transactional
    public InterestOverview undo(Long accountId, Long postingId) {
        Account account = bank(accountId);
        BankInterestPosting posting = postings.findByIdAndTenantId(postingId, UserContext.tenantId())
                .filter(p -> p.getAccountId().equals(accountId))
                .orElseThrow(() -> new NotFoundException("Posted interest", postingId));
        Long entryId = posting.getJournalEntryId();
        if (Boolean.TRUE.equals(account.getInterestAutoPost())) {
            posting.setJournalEntryId(null);
            posting.setAmount(Money.ZERO);
            postings.save(posting);
        } else {
            postings.deleteById(posting.getId());
        }
        ledger.deleteForSource(LedgerService.SOURCE_BANK_INTEREST, posting.getId(), entryId);
        return overview(account, 0);
    }

    /** Every account that posts by itself: its finished periods, oldest first. Used by the nightly job. */
    @Transactional
    public int postDueForAll() {
        int posted = 0;
        for (Account a : accounts.findByTenantId(UserContext.tenantId())) {
            if (a.getAccountType() == AccountType.BANK && !a.isChitBook() && !a.isProjectBook() && Boolean.TRUE.equals(a.getActive())
                    && Boolean.TRUE.equals(a.getInterestAutoPost()) && Money.isPositive(a.getInterestRate())) {
                posted += postDue(a);
            }
        }
        return posted;
    }

    /** One period at a time: each credit earns in the periods after it. A period that works out to nothing has no entry. */
    private int postDue(Account account) {
        int posted = 0;
        while (true) {
            InterestPeriod next = open(account).stream()
                    .filter(p -> "DUE".equals(p.state()) && Money.isPositive(p.calculated()))
                    .min(Comparator.comparing(InterestPeriod::from)).orElse(null);
            if (next == null) {
                return posted;
            }
            credit(account, next, next.calculated(), next.to(), true);
            posted++;
        }
    }

    /** The finished periods that can be posted: due, or undone before. */
    private List<InterestPeriod> open(Account account) {
        LedgerSnapshot books = ledger.snapshot();
        return periods(account, Balances.of(account.getId(), books), books, OrgClock.today()).stream()
                .filter(p -> "DUE".equals(p.state()) || "SKIPPED".equals(p.state())).toList();
    }

    private void credit(Account account, InterestPeriod period, BigDecimal amount, LocalDate date, boolean automatic) {
        BankInterestPosting posting = period.postingId() == null ? new BankInterestPosting()
                : postings.findByIdAndTenantId(period.postingId(), UserContext.tenantId()).orElseThrow();
        posting.setTenantId(UserContext.tenantId());
        posting.setAccountId(account.getId());
        posting.setPeriodFrom(period.from());
        posting.setPeriodTo(period.to());
        posting.setAmount(Money.round(amount));
        posting.setAutomatic(automatic);
        posting.setCreatedAt(OrgClock.now());
        posting = postings.save(posting);
        JournalEntry entry = ledger.post(JournalDraft.of(date, VoucherType.INTEREST_ACCRUAL, "Interest on " + account.getName() + ", " + period.label())
                .debit(account.getId(), amount, "Interest " + period.label())
                .credit(ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId(), amount, "Interest on " + account.getName())
                .category(categories.system(DefaultChartOfAccounts.INTEREST_INCOME).getId())
                .source(LedgerService.SOURCE_BANK_INTEREST, posting.getId()));
        posting.setJournalEntryId(entry.getId());
        postings.save(posting);
    }

    // ================================================================== helpers

    private Account bank(Long id) {
        Account account = accounts.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Account", id));
        if (account.getAccountType() != AccountType.BANK || account.isChitBook() || account.isProjectBook()) {
            throw new BusinessException(account.getName() + " is not a personal bank account");
        }
        return account;
    }

    private static InterestFrequency frequencyOf(Account account) {
        return account.getInterestFrequency() != null ? account.getInterestFrequency() : InterestFrequency.QUARTERLY;
    }

    private static LocalDate startOf(Account account, LocalDate today) {
        return account.getInterestFrom() != null ? account.getInterestFrom() : periodStart(today, frequencyOf(account));
    }

    private static LocalDate periodStart(LocalDate day, InterestFrequency frequency) {
        int month = frequency == InterestFrequency.MONTHLY ? day.getMonthValue() : (day.getMonthValue() - 1) / 3 * 3 + 1;
        return LocalDate.of(day.getYear(), month, 1);
    }

    private static LocalDate nextPeriod(LocalDate start, InterestFrequency frequency) {
        return start.plusMonths(frequency == InterestFrequency.MONTHLY ? 1 : 3);
    }

    private static String label(LocalDate from, LocalDate to) {
        return YearMonth.from(from).equals(YearMonth.from(to)) ? from.format(MONTH_YEAR) : from.format(MONTH) + "–" + to.format(MONTH_YEAR);
    }

    private static LocalDate max(LocalDate a, LocalDate b) {
        return a.isAfter(b) ? a : b;
    }

    private static LocalDate min(LocalDate a, LocalDate b) {
        return a.isBefore(b) ? a : b;
    }

    /** A range of days: their count, the average, lowest and highest closing balance, and the sum of what earned interest. */
    private record Stats(int days, BigDecimal average, BigDecimal lowest, BigDecimal highest, BigDecimal earning) {
        BigDecimal interest(BigDecimal rate) {
            return Money.round(earning.multiply(rate).divide(DAY_BASE, MathContext.DECIMAL64));
        }
    }

    /**
     * The account's balance day by day. {@code earning}: when each entry counts for the averages and interest (a credit
     * of interest from the next day); {@code booked}: when it was booked, for what the statement shows at a day's close.
     */
    private record Balances(NavigableMap<LocalDate, BigDecimal> earning, NavigableMap<LocalDate, BigDecimal> booked) {

        static Balances of(Long accountId, LedgerSnapshot books) {
            NavigableMap<LocalDate, BigDecimal> earning = new TreeMap<>();
            NavigableMap<LocalDate, BigDecimal> booked = new TreeMap<>();
            for (LedgerSnapshot.PostedLine l : books.lines()) {
                if (accountId.equals(l.accountId())) {
                    boolean interest = LedgerService.SOURCE_BANK_INTEREST.equals(books.entry(l.entryId()).getSourceType());
                    earning.merge(interest ? l.date().plusDays(1) : l.date(), l.net(), BigDecimal::add);
                    booked.merge(l.date(), l.net(), BigDecimal::add);
                }
            }
            return new Balances(earning, booked);
        }

        LocalDate start() {
            return booked.isEmpty() ? null : booked.firstKey();
        }

        BigDecimal closing(LocalDate day) {
            return sum(booked.headMap(day, true));
        }

        Stats stats(LocalDate from, LocalDate to) {
            BigDecimal balance = sum(earning.headMap(from, false));
            BigDecimal total = BigDecimal.ZERO;
            BigDecimal positive = BigDecimal.ZERO;
            BigDecimal lowest = null;
            BigDecimal highest = null;
            int days = 0;
            for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                balance = balance.add(earning.getOrDefault(d, BigDecimal.ZERO));
                total = total.add(balance);
                positive = positive.add(balance.max(BigDecimal.ZERO));
                lowest = lowest == null ? balance : lowest.min(balance);
                highest = highest == null ? balance : highest.max(balance);
                days++;
            }
            BigDecimal average = days == 0 ? Money.ZERO : Money.round(total.divide(BigDecimal.valueOf(days), MathContext.DECIMAL64));
            return new Stats(days, average, lowest == null ? Money.ZERO : Money.round(lowest), highest == null ? Money.ZERO : Money.round(highest), positive);
        }

        private static BigDecimal sum(Map<LocalDate, BigDecimal> amounts) {
            return Money.round(amounts.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add));
        }
    }
}
