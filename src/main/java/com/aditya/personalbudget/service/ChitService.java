package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.ChitDtos.InstallmentView;
import com.aditya.personalbudget.dto.ChitDtos.InterestRow;
import com.aditya.personalbudget.dto.ChitDtos.InterestStatus;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ChitInstallmentRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Chit fund tracking.
 * <p>
 * Accounting model (every chit is a sub-ledger of the one Chit Funds asset account: its lines carry the chit id):
 * <ul>
 *   <li><b>Installment</b>: Dr Chit Funds [chit] (full due) / Cr Bank (cash paid) / Cr Income [Chit gains] (dividend)</li>
 *   <li><b>Payout</b> (prize or maturity): Dr Bank (amount received) / Cr Chit Funds [chit] (paid-in balance + future dues)
 *       and the difference goes to Income [Chit gains] (gain) or Expenses [Chit commission &amp; discount] (loss).
 *       If installments remain after an early prize, the chit account carries a credit balance = what you still owe,
 *       which the balance sheet shows as a liability.</li>
 * </ul>
 * Returns: the implied monthly rate is the IRR of paying the installment every month and receiving the maturity
 * amount one month after the last installment. The month-by-month interest schedule uses that rate,
 * or the chit's own annual rate when one is set (see {@link #interestSchedule}).
 */
@Service
public class ChitService {

    private final ChitRepository chits;
    private final ChitInstallmentRepository installments;
    private final AccountRepository accountRepository;
    private final JournalEntryRepository entries;
    private final AccountService accountService;
    private final LedgerService ledger;
    private final CategoryService categories;

    public ChitService(ChitRepository chits, ChitInstallmentRepository installments,
                       AccountRepository accountRepository, JournalEntryRepository entries,
                       AccountService accountService, LedgerService ledger, CategoryService categories) {
        this.categories = categories;
        this.chits = chits;
        this.installments = installments;
        this.accountRepository = accountRepository;
        this.entries = entries;
        this.accountService = accountService;
        this.ledger = ledger;
    }

    // ================================================================== queries

    public List<ChitView> list() {
        LedgerSnapshot books = ledger.snapshot();
        return chits.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(Chit::getStartDate).reversed())
                .map(c -> toView(c, installments.findByChitIdOrderByInstallmentNo(c.getId()), books))
                .toList();
    }

    public ChitDetail detail(Long chitId) {
        Chit chit = require(chitId);
        List<ChitInstallment> schedule = installments.findByChitIdOrderByInstallmentNo(chitId);
        LedgerSnapshot books = ledger.snapshot();
        LocalDate today = LocalDate.now();
        List<InstallmentView> rows = schedule.stream().map(i -> {
            Account from = i.getPaidFromAccountId() == null ? null : books.account(i.getPaidFromAccountId());
            return new InstallmentView(i.getId(), i.getInstallmentNo(), i.getDueDate(), i.getDueAmount(),
                    i.getDividend(), i.getPaidAmount(), i.getPaidDate(), i.getPaidFromAccountId(),
                    from == null ? null : from.getName(), i.getJournalEntryId(), i.getStatus(),
                    i.getStatus() == InstallmentStatus.PENDING && i.getDueDate().isBefore(today));
        }).toList();
        return new ChitDetail(toView(chit, schedule, books), rows, interestSchedule(chit, schedule, today));
    }

    /** The one asset account all chits post to. */
    private Account chitFunds() {
        return accountService.systemAccount(DefaultChartOfAccounts.CHIT_FUNDS);
    }

    /** Pending installments due on or before a date, across all chits (for dashboard / forecast). */
    public List<ChitInstallment> pendingInstallments() {
        return installments.findByTenantId(UserContext.tenantId()).stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PENDING)
                .sorted(Comparator.comparing(ChitInstallment::getDueDate))
                .toList();
    }

    public List<Chit> all() {
        return chits.findByTenantId(UserContext.tenantId());
    }

    // ================================================================== create / update / delete

    @Transactional
    public ChitDetail create(ChitRequest request) {
        Long tenantId = UserContext.tenantId();
        Chit chit = new Chit();
        chit.setTenantId(tenantId);
        chit.setStatus(ChitStatus.ACTIVE);
        chit.setCreatedAt(LocalDateTime.now());
        apply(chit, request);

        chit.setAccountId(chitFunds().getId());
        chit = chits.save(chit);

        generateSchedule(chit);
        markAlreadyPaid(chit, request.alreadyPaidInstallments());
        return detail(chit.getId());
    }

    @Transactional
    public ChitDetail update(Long chitId, ChitRequest request) {
        Chit chit = require(chitId);
        boolean anyPaid = installments.findByChitIdOrderByInstallmentNo(chitId).stream()
                .anyMatch(i -> i.getStatus() == InstallmentStatus.PAID);

        BigDecimal oldInstallment = chit.getMonthlyInstallment();
        Integer oldCount = chit.getNumberOfInstallments();
        LocalDate oldStart = chit.getStartDate();
        apply(chit, request);
        boolean scheduleChanged = oldInstallment.compareTo(chit.getMonthlyInstallment()) != 0
                || !oldCount.equals(chit.getNumberOfInstallments()) || !oldStart.equals(chit.getStartDate());
        if (scheduleChanged && anyPaid) {
            throw new BusinessException("Installment amount, count and start date cannot change after payments. "
                    + "Undo the payments first");
        }
        chit.setVersion(request.version());   // a stale form is refused
        chit = chits.save(chit);

        if (scheduleChanged) {
            installments.deleteAll(installments.findByChitIdOrderByInstallmentNo(chitId));
            generateSchedule(chit);
        }
        return detail(chitId);
    }

    @Transactional
    public void delete(Long chitId) {
        Chit chit = require(chitId);
        List<ChitInstallment> schedule = installments.findByChitIdOrderByInstallmentNo(chitId);
        if (chit.getPayoutAmount() != null || schedule.stream().anyMatch(i -> i.getStatus() == InstallmentStatus.PAID)) {
            throw new BusinessException("This chit has payments. Undo the payout and installments before deleting it");
        }
        installments.deleteAll(schedule);
        chits.deleteById(chitId);
    }

    // ================================================================== payments

    @Transactional
    public ChitDetail payInstallment(Long chitId, Long installmentId, PayInstallmentRequest request) {
        Chit chit = require(chitId);
        requireOpen(chit);
        ChitInstallment installment = requireInstallment(chit, installmentId);
        if (installment.getStatus() == InstallmentStatus.PAID) {
            throw new BusinessException("Installment " + installment.getInstallmentNo() + " is already paid");
        }
        Account from = accountService.require(request.fromAccountId());
        if (from.getAccountClass() != AccountClass.ASSET && from.getAccountClass() != AccountClass.LIABILITY
                || from.getId().equals(chit.getAccountId())) {
            throw new BusinessException("Pay installments from a bank, cash, wallet or card account");
        }
        BigDecimal dividend = Money.round(Money.nz(request.dividend()));
        if (dividend.compareTo(installment.getDueAmount()) >= 0) {
            throw new BusinessException("Dividend must be less than the installment amount");
        }
        BigDecimal cash = installment.getDueAmount().subtract(dividend);
        Account income = accountService.systemAccount(DefaultChartOfAccounts.INCOME);
        Long chitGains = categories.system(DefaultChartOfAccounts.CHIT_GAINS).getId();
        LocalDate paidOn = request.paidDate() != null ? request.paidDate() : installment.getDueDate();

        // booked on the installment date, whenever the money actually moved
        JournalEntry entry = ledger.post(JournalDraft.of(installment.getDueDate(), VoucherType.CHIT_INSTALLMENT,
                        chit.getName() + " - installment " + installment.getInstallmentNo() + "/"
                                + chit.getNumberOfInstallments())
                .debit(chit.getAccountId(), installment.getDueAmount()).chit(chit.getId())
                .credit(from.getId(), cash)
                .credit(income.getId(), dividend, "Chit dividend").category(chitGains)
                .party(chit.getOrganizer())
                .source(LedgerService.SOURCE_CHIT_INSTALLMENT, installment.getId()));

        installment.setDividend(dividend);
        installment.setPaidAmount(cash);
        installment.setPaidDate(paidOn);
        installment.setPaidFromAccountId(from.getId());
        installment.setJournalEntryId(entry.getId());
        installment.setStatus(InstallmentStatus.PAID);
        installments.save(installment);
        refreshStatus(chit);
        return detail(chitId);
    }

    @Transactional
    public ChitDetail undoInstallment(Long chitId, Long installmentId) {
        Chit chit = require(chitId);
        requireOpen(chit);
        ChitInstallment installment = requireInstallment(chit, installmentId);
        if (installment.getStatus() != InstallmentStatus.PAID) {
            throw new BusinessException("Installment " + installment.getInstallmentNo() + " is not paid");
        }
        Long entryId = installment.getJournalEntryId();
        installment.setDividend(null);
        installment.setPaidAmount(null);
        installment.setPaidDate(null);
        installment.setPaidFromAccountId(null);
        installment.setJournalEntryId(null);
        installment.setStatus(InstallmentStatus.PENDING);
        installments.save(installment); // release the foreign key before deleting the journal
        if (entryId != null) {
            ledger.delete(entryId);
        }
        refreshStatus(chit);
        return detail(chitId);
    }

    @Transactional
    public ChitDetail payout(Long chitId, PayoutRequest request) {
        Chit chit = require(chitId);
        requireOpen(chit);
        if (chit.getStatus() != ChitStatus.ACTIVE) {
            throw new BusinessException("Payout already recorded for this chit");
        }
        Account deposit = accountService.require(request.depositAccountId());
        if (deposit.getAccountClass() != AccountClass.ASSET || deposit.getId().equals(chit.getAccountId())) {
            throw new BusinessException("Deposit the payout into a bank, cash or wallet account");
        }
        BigDecimal paidIn = ledger.snapshot().chitBalanceAsOf(chit.getId(), LocalDate.MAX);
        BigDecimal stillDue = installments.findByChitIdOrderByInstallmentNo(chitId).stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PENDING)
                .map(ChitInstallment::getDueAmount)
                .reduce(Money.ZERO, BigDecimal::add);
        BigDecimal settled = paidIn.add(stillDue);          // what the chit account is worth in total
        BigDecimal amount = Money.round(request.amount());
        BigDecimal difference = amount.subtract(settled);    // >0 gain, <0 discount / commission

        JournalDraft draft = JournalDraft.of(request.payoutDate(), VoucherType.CHIT_PAYOUT,
                        chit.getName() + (stillDue.signum() > 0 ? " - prize money" : " - maturity payout"))
                .debit(deposit.getId(), amount)
                .credit(chit.getAccountId(), settled, stillDue.signum() > 0
                        ? "Includes future installments of " + stillDue.toPlainString() : null).chit(chit.getId())
                .party(chit.getOrganizer())
                .source(LedgerService.SOURCE_CHIT_PAYOUT, chit.getId());
        if (difference.signum() > 0) {
            draft.credit(accountService.systemAccount(DefaultChartOfAccounts.INCOME).getId(), difference,
                    "Gain on chit").category(categories.system(DefaultChartOfAccounts.CHIT_GAINS).getId());
        } else if (difference.signum() < 0) {
            draft.debit(accountService.systemAccount(DefaultChartOfAccounts.EXPENSES).getId(),
                    difference.negate(), "Auction discount / commission")
                    .category(categories.system(DefaultChartOfAccounts.CHIT_DISCOUNT).getId());
        }
        ledger.post(draft);

        chit.setPayoutAmount(amount);
        chit.setPayoutDate(request.payoutDate());
        chits.save(chit);
        refreshStatus(chit);
        return detail(chitId);
    }

    @Transactional
    public ChitDetail undoPayout(Long chitId) {
        Chit chit = require(chitId);
        requireOpen(chit);
        if (chit.getPayoutAmount() == null) {
            throw new BusinessException("No payout recorded for this chit");
        }
        entries.findBySource(chit.getTenantId(), LedgerService.SOURCE_CHIT_PAYOUT, chit.getId())
                .forEach(e -> ledger.delete(e.getId()));
        chit.setPayoutAmount(null);
        chit.setPayoutDate(null);
        chits.save(chit);
        refreshStatus(chit);
        return detail(chitId);
    }

    // ================================================================== close / reopen

    /** Puts a finished chit away: paid out, or fully paid and past maturity. Nothing in the books changes. */
    @Transactional
    public ChitDetail close(Long chitId) {
        Chit chit = require(chitId);
        if (chit.getStatus() == ChitStatus.CLOSED) {
            throw new BusinessException("This chit is already closed");
        }
        List<ChitInstallment> pending = installments.findByChitIdOrderByInstallmentNo(chitId).stream()
                .filter(i -> i.getStatus() == InstallmentStatus.PENDING).toList();
        if (!closable(chit, pending, LocalDate.now())) {
            throw new BusinessException("A chit can be closed after its payout, or once every installment is paid and it has matured");
        }
        chit.setStatus(ChitStatus.CLOSED);
        chit.setClosedAt(LocalDateTime.now());
        chits.save(chit);
        return detail(chitId);
    }

    /** Opens a closed chit again, back in the state its payments give it (active, prized or matured). */
    @Transactional
    public ChitDetail reopen(Long chitId) {
        Chit chit = require(chitId);
        if (chit.getStatus() != ChitStatus.CLOSED) {
            throw new BusinessException("This chit is not closed");
        }
        chit.setStatus(ChitStatus.ACTIVE);
        chit.setClosedAt(null);
        chit = chits.save(chit);
        refreshStatus(chit);
        return detail(chitId);
    }

    private static void requireOpen(Chit chit) {
        if (chit.getStatus() == ChitStatus.CLOSED) {
            throw new BusinessException("This chit is closed. Reopen it first");
        }
    }

    // ================================================================== math

    /** Implied monthly return: IRR of N monthly installments followed by the maturity amount. */
    public static double monthlyRate(Chit chit) {
        double m = chit.getMonthlyInstallment().doubleValue();
        int n = chit.getNumberOfInstallments();
        double target = chit.getMaturityAmount().doubleValue();
        double lo = -0.5;
        double hi = 1.0;
        for (int iteration = 0; iteration < 200; iteration++) {
            double mid = (lo + hi) / 2;
            if (futureValue(m, n, mid) > target) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        return (lo + hi) / 2;
    }

    /** Monthly rate for the interest schedule: the chit's own annual rate / 12, else the implied rate. */
    public static double scheduleMonthlyRate(Chit chit) {
        return chit.getInterestRate() != null
                ? chit.getInterestRate().doubleValue() / 1200
                : monthlyRate(chit);
    }

    /**
     * Month-by-month interest schedule.
     * <p>
     * Each installment joins the balance on its due date (the date its journal is booked on, whenever it
     * was actually paid), so the schedule follows the chit's calendar. Exactly one month later interest
     * is calculated:
     * <ul>
     *   <li><b>Compound</b>: on the whole balance (installments + interest added so far); the interest is then
     *       added to the balance, and the next installment is added on top.</li>
     *   <li><b>Simple</b>: on the installments paid in so far only; interest is never added to the base.</li>
     * </ul>
     * Months whose interest date is after a payout earn nothing (the money has been received).
     */
    public static List<InterestRow> interestSchedule(Chit chit, List<ChitInstallment> schedule, LocalDate today) {
        double rate = scheduleMonthlyRate(chit);
        double balance = 0;
        double principal = 0;
        double cumulativeCompound = 0;
        double cumulativeSimple = 0;
        List<InterestRow> rows = new ArrayList<>();
        for (ChitInstallment i : schedule) {
            boolean paid = i.getStatus() == InstallmentStatus.PAID;
            LocalDate start = i.getDueDate();
            LocalDate interestDate = start.plusMonths(1);
            double amount = i.getDueAmount().doubleValue();
            principal += amount;
            double opening = balance + amount;

            double compound = 0;
            double simple = 0;
            InterestStatus status;
            if (chit.getPayoutDate() != null && interestDate.isAfter(chit.getPayoutDate())) {
                status = InterestStatus.AFTER_PAYOUT;
            } else {
                compound = opening * rate;
                simple = principal * rate;
                status = !paid ? InterestStatus.PROJECTED
                        : interestDate.isAfter(today) ? InterestStatus.ACCRUING : InterestStatus.EARNED;
            }
            balance = opening + compound;
            cumulativeCompound += compound;
            cumulativeSimple += simple;
            rows.add(new InterestRow(i.getInstallmentNo(), start, interestDate, Money.of(amount), paid,
                    Money.of(principal), Money.of(opening), Money.of(compound), Money.of(balance),
                    Money.of(cumulativeCompound), Money.of(simple), Money.of(cumulativeSimple),
                    Money.of(cumulativeCompound - cumulativeSimple), status));
        }
        return rows;
    }

    /** Value one month after the last of n monthly payments of m at monthly rate r. */
    private static double futureValue(double m, int n, double r) {
        double value = 0;
        for (int k = 0; k < n; k++) {
            value = (value + m) * (1 + r);
        }
        return value;
    }

    private ChitView toView(Chit c, List<ChitInstallment> schedule, LedgerSnapshot books) {
        LocalDate today = LocalDate.now();
        List<ChitInstallment> paid = schedule.stream().filter(i -> i.getStatus() == InstallmentStatus.PAID).toList();
        List<ChitInstallment> pending = schedule.stream().filter(i -> i.getStatus() == InstallmentStatus.PENDING).toList();
        List<ChitInstallment> overdue = pending.stream().filter(i -> i.getDueDate().isBefore(today)).toList();

        BigDecimal totalContribution = c.getMonthlyInstallment().multiply(BigDecimal.valueOf(c.getNumberOfInstallments()));
        BigDecimal paidIn = sum(paid.stream().map(ChitInstallment::getDueAmount).toList());
        BigDecimal cashPaid = sum(paid.stream().map(ChitInstallment::getPaidAmount).toList());
        BigDecimal dividends = sum(paid.stream().map(ChitInstallment::getDividend).toList());
        BigDecimal stillToPay = sum(pending.stream().map(ChitInstallment::getDueAmount).toList());
        BigDecimal overdueAmount = sum(overdue.stream().map(ChitInstallment::getDueAmount).toList());
        BigDecimal projectedInterest = c.getMaturityAmount().subtract(totalContribution);

        double implied = monthlyRate(c);
        double impliedAnnual = (Math.pow(1 + implied, 12) - 1) * 100;
        BigDecimal rateUsed = c.getInterestRate() != null ? c.getInterestRate()
                : BigDecimal.valueOf(implied * 1200).setScale(2, RoundingMode.HALF_UP);
        String rateBasis = c.getInterestRate() != null ? "Your rate" : "Implied by maturity";

        List<InterestRow> rows = interestSchedule(c, schedule, today);
        BigDecimal compoundEarned = sumRows(rows, true, true);
        BigDecimal simpleEarned = sumRows(rows, false, true);
        BigDecimal compoundProjected = sumRows(rows, true, false);
        BigDecimal simpleProjected = sumRows(rows, false, false);

        BigDecimal currentValue = c.getPayoutAmount() == null ? paidIn.add(compoundEarned) : Money.ZERO;
        BigDecimal realizedGain = c.getPayoutAmount() == null ? null
                : Money.round(c.getPayoutAmount().add(dividends).subtract(totalContribution));
        LocalDate maturityDate = c.getEndDate().plusMonths(1);

        ChitInstallment next = pending.isEmpty() ? null : pending.getFirst();
        Account account = books.account(c.getAccountId());
        BigDecimal chitBalance = books.chitBalanceAsOf(c.getId(), LocalDate.MAX);
        return new ChitView(c.getId(), c.getName(), c.getOrganizer(), c.getTicketNo(),
                c.getMaturityAmount(), c.getMonthlyInstallment(), c.getNumberOfInstallments(), c.getStartDate(),
                c.getEndDate(), maturityDate, ChronoUnit.DAYS.between(today, maturityDate),
                c.getCommissionPercent(), c.getInterestRate(), c.getStatus(), c.getAccountId(),
                account == null ? null : account.getName(), c.getPayoutAmount(), c.getPayoutDate(), c.getNotes(),
                c.getOrganizerUpi(), c.getUpiNote(), c.getDefaultPaymentAccountId(),
                c.getDefaultPaymentAccountId() == null || books.account(c.getDefaultPaymentAccountId()) == null
                        ? null : books.account(c.getDefaultPaymentAccountId()).getName(),
                paid.size(), pending.size(), overdue.size(), overdueAmount,
                Money.percent(BigDecimal.valueOf(paid.size()), BigDecimal.valueOf(c.getNumberOfInstallments())),
                next == null ? null : next.getDueDate(), next == null ? null : next.getDueAmount(),
                Money.round(totalContribution), paidIn, cashPaid, dividends, stillToPay,
                chitBalance,
                Money.round(projectedInterest), Money.round(projectedInterest.add(dividends)),
                BigDecimal.valueOf(impliedAnnual).setScale(2, RoundingMode.HALF_UP), rateUsed, rateBasis,
                compoundEarned, simpleEarned, compoundProjected, simpleProjected,
                Money.round(currentValue), realizedGain, c.getVersion(),
                c.getPayoutAmount() == null ? null : entries.findBySource(c.getTenantId(), LedgerService.SOURCE_CHIT_PAYOUT, c.getId())
                        .stream().findFirst().map(com.aditya.personalbudget.domain.entity.JournalEntry::getId).orElse(null),
                c.getClosedAt(), c.getStatus() != ChitStatus.CLOSED && closable(c, pending, today));
    }

    /** A chit can be closed once it is paid out, or once every installment is paid and its maturity date has passed. */
    private static boolean closable(Chit c, List<ChitInstallment> pending, LocalDate today) {
        return c.getPayoutAmount() != null || (pending.isEmpty() && !c.getEndDate().plusMonths(1).isAfter(today));
    }

    /** Sum of compound or simple interest; earnedOnly keeps only completed months. */
    private static BigDecimal sumRows(List<InterestRow> rows, boolean compound, boolean earnedOnly) {
        return rows.stream()
                .filter(r -> earnedOnly ? r.status() == InterestStatus.EARNED : r.status() != InterestStatus.AFTER_PAYOUT)
                .map(r -> compound ? r.compoundInterest() : r.simpleInterest())
                .reduce(Money.ZERO, BigDecimal::add);
    }

    // ================================================================== helpers

    private void apply(Chit chit, ChitRequest r) {
        int n = r.numberOfInstallments();
        chit.setName(r.name().trim());
        chit.setOrganizer(r.organizer());
        chit.setTicketNo(r.ticketNo());
        chit.setMaturityAmount(Money.round(r.maturityAmount()));
        chit.setMonthlyInstallment(Money.round(r.monthlyInstallment()));
        chit.setNumberOfInstallments(n);
        chit.setStartDate(r.startDate());
        chit.setEndDate(r.endDate() != null ? r.endDate() : r.startDate().plusMonths(n - 1L));
        if (chit.getEndDate().isBefore(chit.getStartDate())) {
            throw new BusinessException("End date cannot be before the start date");
        }
        chit.setInterestRate(r.interestRate());
        chit.setCommissionPercent(r.commissionPercent());
        chit.setNotes(r.notes());
        chit.setOrganizerUpi(blankToNull(r.organizerUpi()));
        chit.setUpiNote(blankToNull(r.upiNote()));
        if (r.defaultPaymentAccountId() != null) {
            Account payFrom = accountService.require(r.defaultPaymentAccountId());
            if (payFrom.getAccountClass() != AccountClass.ASSET && payFrom.getAccountClass() != AccountClass.LIABILITY
                    || payFrom.getAccountType() == AccountType.CHIT_FUND) {
                throw new BusinessException("The default payment account must be a bank, cash, wallet or card account");
            }
        }
        chit.setDefaultPaymentAccountId(r.defaultPaymentAccountId());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private void generateSchedule(Chit chit) {
        List<ChitInstallment> rows = new ArrayList<>();
        for (int k = 1; k <= chit.getNumberOfInstallments(); k++) {
            ChitInstallment i = new ChitInstallment();
            i.setTenantId(chit.getTenantId());
            i.setChitId(chit.getId());
            i.setInstallmentNo(k);
            i.setDueDate(chit.getStartDate().plusMonths(k - 1L));
            i.setDueAmount(chit.getMonthlyInstallment());
            i.setStatus(InstallmentStatus.PENDING);
            rows.add(i);
        }
        installments.saveAll(rows);
    }

    /** Records installments paid before tracking started, funded from Opening Balance Equity. */
    private void markAlreadyPaid(Chit chit, Integer count) {
        if (count == null || count <= 0) {
            return;
        }
        if (count > chit.getNumberOfInstallments()) {
            throw new BusinessException("Already-paid installments exceed the number of installments");
        }
        Long equityId = accountService.systemAccount(DefaultChartOfAccounts.OPENING_BALANCE_EQUITY).getId();
        for (ChitInstallment i : installments.findByChitIdOrderByInstallmentNo(chit.getId())) {
            if (i.getInstallmentNo() > count) {
                break;
            }
            JournalEntry entry = ledger.post(JournalDraft.of(i.getDueDate(), VoucherType.OPENING,
                            chit.getName() + " - installment " + i.getInstallmentNo() + " (paid before tracking)")
                    .debit(chit.getAccountId(), i.getDueAmount()).chit(chit.getId())
                    .credit(equityId, i.getDueAmount())
                    .source(LedgerService.SOURCE_CHIT_INSTALLMENT, i.getId()));
            i.setDividend(Money.ZERO);
            i.setPaidAmount(i.getDueAmount());
            i.setPaidDate(i.getDueDate());
            i.setPaidFromAccountId(equityId);
            i.setJournalEntryId(entry.getId());
            i.setStatus(InstallmentStatus.PAID);
            installments.save(i);
        }
    }

    private void refreshStatus(Chit chit) {
        if (require(chit.getId()).getStatus() == ChitStatus.CLOSED) {
            return;   // closed by the user: stays closed until reopened
        }
        boolean pending = installments.findByChitIdOrderByInstallmentNo(chit.getId()).stream()
                .anyMatch(i -> i.getStatus() == InstallmentStatus.PENDING);
        ChitStatus status = chit.getPayoutAmount() == null ? ChitStatus.ACTIVE
                : pending ? ChitStatus.PRIZED : ChitStatus.MATURED;
        if (status != chit.getStatus()) {
            Chit fresh = require(chit.getId());
            fresh.setStatus(status);
            chits.save(fresh);
        }
    }

    private Chit require(Long chitId) {
        return chits.findByIdAndTenantId(chitId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Chit", chitId));
    }

    private ChitInstallment requireInstallment(Chit chit, Long installmentId) {
        return installments.findByIdAndTenantId(installmentId, chit.getTenantId())
                .filter(i -> i.getChitId().equals(chit.getId()))
                .orElseThrow(() -> new NotFoundException("Chit installment", installmentId));
    }

    private static BigDecimal sum(List<BigDecimal> values) {
        return values.stream().map(Money::nz).reduce(Money.ZERO, BigDecimal::add);
    }
}
