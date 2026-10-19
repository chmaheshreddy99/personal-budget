package com.aditya.personalbudget.service;

import com.aditya.personalbudget.dto.ClaimDtos.PostingView;
import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.repository.ClaimInterestPostingRepository;
import com.aditya.personalbudget.domain.type.DayCount;
import com.aditya.personalbudget.domain.entity.ClaimInterestPosting;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.domain.type.InterestType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimSummary;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentView;
import com.aditya.personalbudget.dto.ClaimDtos.TimelineEvent;
import com.aditya.personalbudget.dto.ClaimDtos.WriteOffRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ClaimRepaymentRepository;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.ClaimShareRepository;
import com.aditya.personalbudget.domain.entity.ClaimShare;
import com.aditya.personalbudget.domain.type.InterestCollection;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Money owed to you (cash lent, bills paid on someone's behalf) and money you owe (cash borrowed,
 * bills to pay later). Both run the same lifecycle; only the direction of the journals differs.
 * <p>
 * Owed to you (receivable):
 * <ul>
 *   <li>Lend / pay for: Dr Receivables, Cr bank (the original transaction)</li>
 *   <li>Repayment: Dr bank (principal + interest), Cr Receivables (principal), Cr Interest Income (interest)</li>
 *   <li>Write-off: Dr an expense account, Cr Receivables (whatever is still owed)</li>
 * </ul>
 * Owed by you (payable):
 * <ul>
 *   <li>Borrow: Dr bank (money received), Cr Payables. Bill to pay: Dr the expense category, Cr Payables</li>
 *   <li>Repayment: Dr Payables (principal), Dr Loan Interest (interest), Cr the bank it is paid from</li>
 *   <li>Waived: Dr Payables, Cr an income account (whatever is no longer owed)</li>
 * </ul>
 * Every repayment is linked to the original claim, so the claim knows its status
 * (open, partly repaid, settled, written off) and its whole lifecycle.
 * Interest accrues on the outstanding principal, by default a full month's rate per month (30-day months),
 * simple or compounded monthly (see {@link ClaimInterest}).
 * <p>
 * Interest can also be <b>posted month by month</b>, as it is earned or owed, instead of only when it is paid:
 * <ul>
 *   <li>Owed to you: Dr Receivables, Cr Income [Interest]</li>
 *   <li>You owe: Dr Expenses [Loan interest], Cr Payables</li>
 * </ul>
 * A later repayment's interest settles the posted interest first (it then reduces Receivables / Payables
 * instead of being booked as income / expense again). A claim stays open while posted interest is unpaid.
 */
@Service
public class ClaimService {


    private final ClaimRepository claims;
    private final ClaimRepaymentRepository repayments;
    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final LedgerService ledger;
    private final CategoryService categories;
    private final ClaimInterestPostingRepository postings;
    private final DayCount dayCount;
    private final com.aditya.personalbudget.repository.AttachmentRepository attachments;
    private final ClaimShareRepository shares;

    public ClaimService(ClaimRepository claims, ClaimRepaymentRepository repayments, AccountRepository accounts,
                        JournalEntryRepository entries, LedgerService ledger, CategoryService categories,
                        ClaimInterestPostingRepository postings, BudgetProperties properties,
                        com.aditya.personalbudget.repository.AttachmentRepository attachments, ClaimShareRepository shares) {
        this.shares = shares;
        this.attachments = attachments;
        this.categories = categories;
        this.postings = postings;
        this.dayCount = properties.interest().dayCount();
        this.claims = claims;
        this.repayments = repayments;
        this.accounts = accounts;
        this.entries = entries;
        this.ledger = ledger;
    }

    // ================================================================== queries

    public List<ClaimView> list() {
        Context ctx = context();
        return claims.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(Claim::getStartDate).thenComparing(Claim::getId).reversed())
                .map(c -> toView(c, ctx))
                .toList();
    }

    public ClaimView get(Long id) {
        return toView(claim(id), context());
    }

    /** The claim an entry belongs to (original payment, repayment or write-off), if any. */
    public Optional<ClaimView> byEntry(Long entryId) {
        Long tenantId = UserContext.tenantId();
        Optional<Claim> claim = claims.findByJournalEntryId(entryId)
                .or(() -> repayments.findByJournalEntryId(entryId).flatMap(r -> claims.findById(r.getClaimId())))
                .or(() -> postings.findByJournalEntryId(entryId).flatMap(p -> claims.findById(p.getClaimId())))
                .filter(c -> tenantId.equals(c.getTenantId()));
        return claim.map(c -> toView(c, context()));
    }

    public ClaimSummary summary(List<ClaimView> views) {
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        BigDecimal outstanding = Money.ZERO, lent = Money.ZERO, paidFor = Money.ZERO;
        BigDecimal interestDue = Money.ZERO, overdue = Money.ZERO, collected = Money.ZERO;
        int open = 0, overdueCount = 0;
        for (ClaimView v : views) {
            if (v.kind().isPayable()) {
                continue;   // "to collect" counts money owed to you only
            }
            outstanding = outstanding.add(v.outstanding());
            if (v.kind() == ClaimKind.LENT) {
                lent = lent.add(v.outstanding());
            } else {
                paidFor = paidFor.add(v.outstanding());
            }
            interestDue = interestDue.add(v.interestDue());
            if (v.outstanding().signum() > 0) {
                open++;
            }
            if (v.overdue()) {
                overdue = overdue.add(v.outstanding());
                overdueCount++;
            }
            for (RepaymentView r : v.repayments()) {
                if (!r.writeOff() && !r.paidDate().isBefore(monthStart)) {
                    collected = collected.add(r.total());
                }
            }
        }
        return new ClaimSummary(outstanding, lent, paidFor, interestDue, overdue, open, overdueCount, collected);
    }

    // ================================================================== create / edit / delete

    @Transactional
    public ClaimView create(ClaimRequest request) {
        Account payer = counterAccount(request.kind(), request.paidFromAccountId());
        Account receivable = holdingAccount(request.kind(), request.receivableAccountId());
        validateDates(request);

        Claim claim = new Claim();
        claim.setTenantId(UserContext.tenantId());
        claim.setCreatedAt(LocalDateTime.now());
        claim.setStatus(ClaimStatus.OPEN);
        apply(claim, request, payer, receivable);
        claim = claims.save(claim);

        JournalEntry entry = ledger.post(draft(claim, request.reference()));
        claim.setJournalEntryId(entry.getId());
        return toView(claims.save(claim), context());
    }

    @Transactional
    public ClaimView update(Long id, ClaimRequest request) {
        Claim claim = claim(id);
        List<ClaimRepayment> history = repayments.findByClaimId(id);
        BigDecimal settled = history.stream().map(ClaimRepayment::getPrincipal).reduce(Money.ZERO, BigDecimal::add);
        if (request.amount().compareTo(settled) < 0) {
            throw new BusinessException("Amount cannot be less than the " + settled.toPlainString() + " already repaid");
        }
        if (!history.isEmpty() && request.startDate().isAfter(history.getFirst().getPaidDate())) {
            throw new BusinessException("The date cannot be after the first repayment");
        }
        if (claim.getKind() != request.kind() && !history.isEmpty()) {
            throw new BusinessException("Undo the repayments before changing the kind");
        }
        if (claim.getKind().isPayable() != request.kind().isPayable()) {
            throw new BusinessException("Money owed to you cannot become money you owe; create a new item instead");
        }
        validateDates(request);
        if (!postings.findByClaimId(id).isEmpty() && (claim.getAmount().compareTo(Money.round(request.amount())) != 0
                || !claim.getStartDate().equals(request.startDate())
                || Money.nz(claim.getInterestRate()).compareTo(Money.nz(request.interestRate())) != 0
                || claim.getInterestType() != (request.interestType() == null ? InterestType.SIMPLE : request.interestType()))) {
            throw new BusinessException("Interest is already posted on this item. Undo the posted months before changing "
                    + "the amount, date or interest");
        }
        Account payer = counterAccount(request.kind(), request.paidFromAccountId());
        Account receivable = holdingAccount(request.kind(), request.receivableAccountId() != null
                ? request.receivableAccountId() : claim.getReceivableAccountId());
        apply(claim, request, payer, receivable);
        ledger.repost(claim.getJournalEntryId(), draft(claim, request.reference()));
        refreshStatus(claim);
        claim.setVersion(request.version());   // a stale form is refused
        return toView(claims.save(claim), context());
    }

    @Transactional
    public void delete(Long id) {
        Claim claim = claim(id);
        if (!repayments.findByClaimId(id).isEmpty()) {
            throw new BusinessException("Undo the repayments of '" + claim.getNarration() + "' first");
        }
        Long entryId = claim.getJournalEntryId();
        for (ClaimInterestPosting p : postings.findByClaimId(id)) {   // posted interest goes with it
            postings.deleteById(p.getId());
            if (p.getJournalEntryId() != null) {
                ledger.delete(p.getJournalEntryId());
            }
        }
        shares.deleteAll(shares.findByClaimId(id));   // its statement links stop working
        claims.deleteById(id);
        if (entryId != null) {
            ledger.delete(entryId);
        }
    }

    // ================================================================== repayments

    /** Records money received back, fully or in part, with optional interest. */
    @Transactional
    public ClaimView repay(Long id, RepaymentRequest request) {
        Claim claim = claim(id);
        BigDecimal principal = Money.round(Money.nz(request.principal()));
        BigDecimal interest = Money.round(Money.nz(request.interest()));
        BigDecimal outstanding = outstanding(claim);
        BigDecimal unpaidPosted = unpaidPosted(claim);
        BigDecimal fromPosted = interest.min(unpaidPosted);     // settles interest already booked
        BigDecimal newInterest = interest.subtract(fromPosted);  // booked as income / expense now
        // principal comes off the claim's account; posted interest off the account(s) it was booked to, oldest first
        Map<Long, BigDecimal> settle = settlement(claim, principal, fromPosted);
        if (principal.add(interest).signum() <= 0) {
            throw new BusinessException("Enter the amount received");
        }
        if (principal.compareTo(outstanding) > 0) {
            throw new BusinessException("Only " + outstanding.toPlainString() + " is still owed. Book the extra as interest.");
        }
        if (request.paidDate().isBefore(claim.getStartDate())) {
            throw new BusinessException("Repayment date is before the money was given");
        }
        Account into = requirePayer(request.accountId());

        ClaimRepayment repayment = new ClaimRepayment();
        repayment.setTenantId(claim.getTenantId());
        repayment.setClaimId(id);
        repayment.setPaidDate(request.paidDate());
        repayment.setPrincipal(principal);
        repayment.setInterest(interest);
        repayment.setAccountId(into.getId());
        repayment.setWriteOff(false);
        repayment.setAccruedInterest(fromPosted.signum() > 0 ? fromPosted : null);
        repayment.setNotes(blankToNull(request.notes()));
        repayment = repayments.save(repayment);

        boolean finalPayment = principal.compareTo(outstanding) == 0 && fromPosted.compareTo(unpaidPosted) == 0;
        JournalDraft draft;
        if (claim.getKind().isPayable()) {
            draft = JournalDraft.of(request.paidDate(), VoucherType.REPAYMENT_MADE,
                            (finalPayment ? "Final repayment to " : "Partial repayment to ") + claim.getParty()
                                    + " (" + claim.getNarration() + ")")
                    .party(claim.getParty());
            settle.forEach((accountId, amount) -> draft.debit(accountId, amount,
                    accountId.equals(claim.getReceivableAccountId()) ? (fromPosted.signum() > 0 && amount.compareTo(principal) > 0
                            ? "Principal + posted interest" : "Principal") : "Posted interest"));
            draft.debit(ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId(), newInterest, "Interest")
                    .category(categories.system(DefaultChartOfAccounts.LOAN_INTEREST).getId())
                    .credit(into.getId(), principal.add(interest));
        } else {
            draft = JournalDraft.of(request.paidDate(), VoucherType.REPAYMENT,
                            (finalPayment ? "Final repayment from " : "Partial repayment from ") + claim.getParty()
                                    + " (" + claim.getNarration() + ")")
                    .party(claim.getParty())
                    .debit(into.getId(), principal.add(interest));
            settle.forEach((accountId, amount) -> draft.credit(accountId, amount,
                    accountId.equals(claim.getReceivableAccountId()) ? (fromPosted.signum() > 0 && amount.compareTo(principal) > 0
                            ? "Principal + posted interest" : "Principal") : "Posted interest"));
            draft.credit(ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId(), newInterest, "Interest")
                    .category(categories.system(DefaultChartOfAccounts.INTEREST_INCOME).getId());
        }
        draft.source(LedgerService.SOURCE_CLAIM_REPAYMENT, repayment.getId());
        repayment.setJournalEntryId(ledger.post(draft).getId());
        repayments.save(repayment);

        refreshStatus(claim);
        return toView(claims.save(claim), context());
    }

    /** Forgives whatever is still owed, booking it as an expense. */
    @Transactional
    public ClaimView writeOff(Long id, WriteOffRequest request) {
        Claim claim = claim(id);
        BigDecimal principalLeft = outstanding(claim);
        BigDecimal unpaidPosted = unpaidPosted(claim);
        BigDecimal outstanding = principalLeft.add(unpaidPosted);   // posted interest is forgiven as well
        Map<Long, BigDecimal> settle = settlement(claim, principalLeft, unpaidPosted);
        if (outstanding.signum() <= 0) {
            throw new BusinessException("Nothing is owed on this item");
        }
        boolean payable = claim.getKind().isPayable();
        Category category = categories.require(request.categoryId(), payable ? CategoryKind.INCOME : CategoryKind.EXPENSE);
        Account expense = ledger.systemAccount(payable ? DefaultChartOfAccounts.INCOME : DefaultChartOfAccounts.EXPENSES);
        ClaimRepayment repayment = new ClaimRepayment();
        repayment.setTenantId(claim.getTenantId());
        repayment.setClaimId(id);
        repayment.setPaidDate(request.paidDate());
        repayment.setPrincipal(principalLeft);
        repayment.setInterest(unpaidPosted);
        repayment.setAccruedInterest(unpaidPosted.signum() > 0 ? unpaidPosted : null);
        repayment.setAccountId(expense.getId());
        repayment.setCategoryId(category.getId());
        repayment.setWriteOff(true);
        repayment.setNotes(blankToNull(request.notes()));
        repayment = repayments.save(repayment);

        JournalDraft draft = payable
                ? JournalDraft.of(request.paidDate(), VoucherType.WRITE_OFF,
                            "Waived by " + claim.getParty() + " (" + claim.getNarration() + ")")
                    .party(claim.getParty())
                : JournalDraft.of(request.paidDate(), VoucherType.WRITE_OFF,
                            "Write-off: " + claim.getParty() + " (" + claim.getNarration() + ")")
                    .party(claim.getParty())
                    .debit(expense.getId(), outstanding).category(category.getId());
        settle.forEach((accountId, amount) -> {
            if (payable) {
                draft.debit(accountId, amount);
            } else {
                draft.credit(accountId, amount);
            }
        });
        if (payable) {
            draft.credit(expense.getId(), outstanding).category(category.getId());
        }
        draft.source(LedgerService.SOURCE_CLAIM_REPAYMENT, repayment.getId());
        repayment.setJournalEntryId(ledger.post(draft).getId());
        repayments.save(repayment);

        refreshStatus(claim);
        return toView(claims.save(claim), context());
    }

    @Transactional
    public ClaimView undoRepayment(Long id, Long repaymentId) {
        Claim claim = claim(id);
        ClaimRepayment repayment = repayments.findByIdAndTenantId(repaymentId, claim.getTenantId())
                .filter(r -> r.getClaimId().equals(id))
                .orElseThrow(() -> new NotFoundException("Repayment", repaymentId));
        Long entryId = repayment.getJournalEntryId();
        repayments.deleteById(repaymentId);
        if (entryId != null) {
            ledger.delete(entryId);
        }
        refreshStatus(claim);
        return toView(claims.save(claim), context());
    }

    // ================================================================== interest posted month by month

    /**
     * Books every finished month of interest not booked yet (see the class comment). Months whose interest
     * was already received directly are skipped, so nothing is counted twice.
     */
    @Transactional
    public ClaimView postInterest(Long id, boolean automatic) {
        return postInterest(id, automatic, null, null, false, false);
    }

    @Transactional
    public ClaimView postInterest(Long id, boolean automatic, Integer upToPeriod, Long accountId, boolean makeDefault) {
        return postInterest(id, automatic, upToPeriod, accountId, makeDefault, false);
    }

    /**
     * Books finished months of interest: every one waiting, or those up to and including {@code upToPeriod}
     * (months are always posted in order). {@code accountId}: the receivable / payable to book them to,
     * by default the item's interest account; {@code makeDefault} keeps that account for later months.
     * {@code combine} books all those months as one entry (a year's interest for yearly collection).
     */
    @Transactional
    public ClaimView postInterest(Long id, boolean automatic, Integer upToPeriod, Long accountId, boolean makeDefault,
                                  boolean combine) {
        Claim claim = claim(id);
        if (Money.nz(claim.getInterestRate()).signum() <= 0) {
            throw new BusinessException("'" + claim.getNarration() + "' has no interest rate");
        }
        Long target = accountId != null ? interestAccount(claim, accountId).getId() : defaultInterestAccount(claim);
        if (makeDefault && accountId != null) {
            claim.setInterestAccountId(target.equals(claim.getReceivableAccountId()) ? null : target);
        }
        Context ctx = context();
        List<Due> due = dueMonths(claim, ctx).stream()
                .filter(d -> upToPeriod == null || d.period().period() <= upToPeriod).toList();
        if (due.isEmpty() && !automatic) {
            throw new BusinessException(upToPeriod == null ? "No finished month of interest is waiting to be posted"
                    : "Month " + upToPeriod + " is not finished yet or is already posted");
        }
        boolean payable = claim.getKind().isPayable();
        if (combine && due.size() > 1) {
            Due first = due.getFirst(), last = due.getLast();
            var p = last.period();
            due = List.of(new Due(new com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod(p.period(), first.period().from(), p.to(),
                    first.period().openingPrincipal(), p.principalRepaid(), p.interestPaid(), p.closingPrincipal(), p.simpleInterest(),
                    p.compoundInterest(), p.cumulativeSimple(), p.cumulativeCompound(), p.compoundExtra(), p.status(), null, null),
                    due.stream().map(Due::amount).reduce(Money.ZERO, BigDecimal::add), first.period().period()));
        }
        for (Due d : due) {
            ClaimInterestPosting posting = new ClaimInterestPosting();
            posting.setTenantId(claim.getTenantId());
            posting.setClaimId(id);
            posting.setPeriodNo(d.period().period());
            posting.setPeriodFrom(d.period().from());
            posting.setPeriodTo(d.period().to());
            posting.setAmount(d.amount());
            posting.setAutomatic(automatic);
            posting.setAccountId(target.equals(claim.getReceivableAccountId()) ? null : target);
            posting.setCreatedAt(LocalDateTime.now());
            posting = postings.save(posting);
            if (d.amount().signum() > 0) {
                String month = (d.firstPeriod() < d.period().period() ? "months " + d.firstPeriod() + "-" + d.period().period()
                        : "month " + d.period().period()) + " (" + d.period().from() + " to " + d.period().to() + ")";
                JournalDraft draft = JournalDraft.of(d.period().to(), VoucherType.INTEREST_ACCRUAL,
                                "Interest " + (payable ? "owed to " : "from ") + claim.getParty() + ", " + month)
                        .party(claim.getParty());
                if (payable) {
                    draft.debit(ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId(), d.amount(), "Interest " + month)
                            .category(categories.system(DefaultChartOfAccounts.LOAN_INTEREST).getId())
                            .credit(target, d.amount(), (settledOnPosting(claim, target) ? "Interest paid: " : "Interest: ") + claim.getNarration());
                } else {
                    draft.debit(target, d.amount(), (settledOnPosting(claim, target) ? "Interest received: " : "Interest: ") + claim.getNarration())
                            .credit(ledger.systemAccount(DefaultChartOfAccounts.INCOME).getId(), d.amount(), "Interest " + month)
                            .category(categories.system(DefaultChartOfAccounts.INTEREST_INCOME).getId());
                }
                draft.source(LedgerService.SOURCE_CLAIM_INTEREST, posting.getId());
                posting.setJournalEntryId(ledger.post(draft).getId());
                postings.save(posting);
            }
        }
        refreshStatus(claim);
        return toView(claims.save(claim), context());
    }

    /** Posts the due months of every claim that asks for it; used by the monthly job. Returns the months posted. */
    @Transactional
    public int postDueInterestForAll() {
        Context ctx = context();
        int posted = 0;
        for (Claim c : claims.findByTenantId(UserContext.tenantId())) {
            InterestCollection plan = collectionOf(c);
            if (!Boolean.TRUE.equals(c.getPostInterestMonthly()) || Money.nz(c.getInterestRate()).signum() <= 0
                    || plan == InterestCollection.ON_PAYMENT) {
                continue;
            }
            List<Due> due = dueMonths(c, ctx);
            if (plan == InterestCollection.YEARLY) {   // a whole year at a time, as one entry, on each anniversary
                int upTo = completedMonths(c.getStartDate(), ctx.today()) / 12 * 12;
                due = due.stream().filter(d -> d.period().period() <= upTo).toList();
                if (!due.isEmpty()) {
                    postInterest(c.getId(), true, upTo, null, false, true);
                }
            } else if (!due.isEmpty()) {
                postInterest(c.getId(), true);
            }
            if (!due.isEmpty()) {
                posted += due.size();
                ctx = context();
            }
        }
        return posted;
    }

    /** When interest is collected, and whether it is booked automatically as each period ends. */
    @Transactional
    public ClaimView setInterestPlan(Long id, InterestCollection collection, Boolean autoPost) {
        Claim claim = claim(id);
        if (Money.nz(claim.getInterestRate()).signum() <= 0) {
            throw new BusinessException("'" + claim.getNarration() + "' has no interest rate");
        }
        claim.setInterestCollection(collection == null ? InterestCollection.MONTHLY : collection);
        if (autoPost != null) {
            claim.setPostInterestMonthly(autoPost);
        }
        if (claim.getInterestCollection() == InterestCollection.ON_PAYMENT) {
            claim.setPostInterestMonthly(false);   // booked when it is paid
        }
        return toView(claims.save(claim), context());
    }

    static InterestCollection collectionOf(Claim c) {
        return c.getInterestCollection() != null ? c.getInterestCollection() : InterestCollection.MONTHLY;
    }

    /** Whole months from the start up to today (the k-th anniversary is on or before today). */
    static int completedMonths(LocalDate start, LocalDate today) {
        if (today.isBefore(start)) {
            return 0;
        }
        int k = (int) Math.max(0, ChronoUnit.MONTHS.between(start, today));
        while (k > 0 && start.plusMonths(k).isAfter(today)) {
            k--;
        }
        while (!start.plusMonths(k + 1L).isAfter(today)) {
            k++;
        }
        return k;
    }

    /** Removes the last posted month; only while that interest has not been paid. */
    @Transactional
    public ClaimView undoInterestPosting(Long id, Long postingId) {
        Claim claim = claim(id);
        List<ClaimInterestPosting> all = postings.findByClaimId(id);
        ClaimInterestPosting posting = all.stream().filter(p -> p.getId().equals(postingId)).findFirst()
                .orElseThrow(() -> new NotFoundException("Posted interest", postingId));
        if (!posting.equals(all.getLast())) {
            throw new BusinessException("Undo the later months first (month " + all.getLast().getPeriodNo() + ")");
        }
        if (!settledOnPosting(claim, posting.getAccountId()) && unpaidPosted(claim).compareTo(posting.getAmount()) < 0) {
            throw new BusinessException("This interest has already been paid. Undo that repayment first");
        }
        postings.deleteById(postingId);
        if (posting.getJournalEntryId() != null) {
            ledger.delete(posting.getJournalEntryId());
        }
        refreshStatus(claim);
        return toView(claims.save(claim), context());
    }

    private record Due(com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod period, BigDecimal amount, int firstPeriod) {
        Due(com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod period, BigDecimal amount) {
            this(period, amount, period.period());
        }
    }

    /**
     * Finished whole months after the last posted one, each with the interest still to book: the month's interest,
     * less whatever of the interest earned so far was already booked (posted, or received directly).
     */
    private List<Due> dueMonths(Claim c, Context ctx) {
        List<ClaimRepayment> history = ctx.repaymentsByClaim().getOrDefault(c.getId(), List.of());
        List<ClaimInterestPosting> posted = ctx.postingsByClaim().getOrDefault(c.getId(), List.of());
        BigDecimal outstanding = history.stream().map(ClaimRepayment::getPrincipal).reduce(c.getAmount(), BigDecimal::subtract);
        if (outstanding.signum() <= 0 || Money.nz(c.getInterestRate()).signum() <= 0) {
            return List.of();
        }
        boolean compound = c.getInterestType() == InterestType.COMPOUND;
        ClaimInterest.Result interest = ClaimInterest.schedule(c.getAmount(), c.getInterestRate(), c.getStartDate(),
                history, ctx.today(), ctx.today(), dayCount);
        int lastPosted = posted.isEmpty() ? 0 : posted.getLast().getPeriodNo();
        BigDecimal booked = posted.stream().map(ClaimInterestPosting::getAmount).reduce(Money.ZERO, BigDecimal::add)
                .add(history.stream().filter(r -> !Boolean.TRUE.equals(r.getWriteOff()))
                        .map(r -> r.getInterest().subtract(Money.nz(r.getAccruedInterest()))).reduce(Money.ZERO, BigDecimal::add));
        List<Due> due = new ArrayList<>();
        for (var p : interest.periods()) {
            boolean whole = p.to().equals(c.getStartDate().plusMonths(p.period()));
            if (p.period() <= lastPosted || !whole || p.to().isAfter(ctx.today())) {
                continue;
            }
            BigDecimal cumulative = compound ? p.cumulativeCompound() : p.cumulativeSimple();
            BigDecimal amount = Money.round(cumulative.subtract(booked).max(Money.ZERO));
            booked = booked.add(amount);
            due.add(new Due(p, amount));
        }
        return due;
    }

    /** Sets the account interest is posted to by default. */
    @Transactional
    public ClaimView setInterestAccount(Long id, Long accountId) {
        Claim claim = claim(id);
        Long target = accountId == null ? claim.getReceivableAccountId() : interestAccount(claim, accountId).getId();
        claim.setInterestAccountId(target.equals(claim.getReceivableAccountId()) ? null : target);
        return toView(claims.save(claim), context());
    }

    private Long defaultInterestAccount(Claim claim) {
        return claim.getInterestAccountId() != null ? claim.getInterestAccountId() : claim.getReceivableAccountId();
    }

    /**
     * Where interest may be posted. Owed to you: a receivable, loan given or other asset (interest still to collect),
     * or a bank / cash / wallet account (interest received there every month). You owe: a payable or loan (interest
     * still to pay), or a bank / cash / wallet / card account (interest paid from it every month).
     */
    private Account interestAccount(Claim claim, Long accountId) {
        Account a = account(accountId);
        boolean ok = a.getAccountType().isLiquid() || (claim.getKind().isPayable()
                ? a.getAccountClass() == AccountClass.LIABILITY
                : a.getAccountClass() == AccountClass.ASSET && (a.getAccountType() == AccountType.RECEIVABLE
                        || a.getAccountType() == AccountType.LOAN_GIVEN || a.getAccountType() == AccountType.OTHER_ASSET));
        if (!ok) {
            throw new BusinessException(claim.getKind().isPayable()
                    ? "Post interest you owe to a payable or loan, or to the bank, cash or card account it is paid from"
                    : "Post interest owed to you to a receivable, loan given or other asset, or to the bank, cash or wallet it is received in");
        }
        return a;
    }

    /** Interest posted to a bank / cash / wallet (or, for money you owe, a card) is received or paid on the spot. */
    private boolean settledOnPosting(Claim claim, Long accountId) {
        if (accountId == null) {
            return false;
        }
        Account a = accounts.findById(accountId).orElse(null);
        return a != null && (a.getAccountType().isLiquid()
                || (claim.getKind().isPayable() && a.getAccountType() == AccountType.CREDIT_CARD));
    }

    /**
     * What a payment (or write-off) takes off each account: the principal from the claim's account, and the
     * posted interest it settles from the accounts that interest was booked to, oldest month first.
     */
    private Map<Long, BigDecimal> settlement(Claim claim, BigDecimal principal, BigDecimal postedInterest) {
        Map<Long, BigDecimal> result = new java.util.LinkedHashMap<>();
        if (principal.signum() > 0) {
            result.put(claim.getReceivableAccountId(), principal);
        }
        BigDecimal alreadySettled = repayments.findByClaimId(claim.getId()).stream()
                .map(r -> Money.nz(r.getAccruedInterest())).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal left = postedInterest;
        for (ClaimInterestPosting p : postings.findByClaimId(claim.getId())) {
            if (settledOnPosting(claim, p.getAccountId())) {
                continue;   // already received / paid when it was posted
            }
            BigDecimal open = p.getAmount();
            BigDecimal used = alreadySettled.min(open);
            alreadySettled = alreadySettled.subtract(used);
            open = open.subtract(used);
            if (open.signum() <= 0 || left.signum() <= 0) {
                continue;
            }
            BigDecimal take = open.min(left);
            left = left.subtract(take);
            Long account = p.getAccountId() != null ? p.getAccountId() : claim.getReceivableAccountId();
            result.merge(account, take, BigDecimal::add);
        }
        return result;
    }

    /** Interest posted month by month that has not been paid (or written off) yet. */
    private BigDecimal unpaidPosted(Claim claim) {
        BigDecimal posted = postings.findByClaimId(claim.getId()).stream()
                .filter(p -> !settledOnPosting(claim, p.getAccountId()))
                .map(ClaimInterestPosting::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal settled = repayments.findByClaimId(claim.getId()).stream()
                .map(r -> Money.nz(r.getAccruedInterest())).reduce(Money.ZERO, BigDecimal::add);
        return posted.subtract(settled).max(Money.ZERO);
    }

    // ================================================================== view

    /** Everything the views need, loaded once per request. */
    private record Context(Map<Long, Account> accounts, Map<Long, JournalEntry> entries,
                           Map<Long, List<ClaimRepayment>> repaymentsByClaim,
                           Map<Long, List<ClaimInterestPosting>> postingsByClaim, LocalDate today,
                           Map<Long, Integer> evidence, Map<Long, List<ClaimShare>> shares, LocalDateTime now) {
    }

    private Context context() {
        Long tenantId = UserContext.tenantId();
        return new Context(
                accounts.findByTenantId(tenantId).stream().collect(Collectors.toMap(Account::getId, Function.identity())),
                entries.findByTenantId(tenantId).stream().collect(Collectors.toMap(JournalEntry::getId, Function.identity())),
                repayments.findByTenantId(tenantId).stream()
                        .sorted(Comparator.comparing(ClaimRepayment::getPaidDate).thenComparing(ClaimRepayment::getId))
                        .collect(Collectors.groupingBy(ClaimRepayment::getClaimId)),
                postings.findByTenantId(tenantId).stream()
                        .sorted(Comparator.comparing(ClaimInterestPosting::getPeriodNo))
                        .collect(Collectors.groupingBy(ClaimInterestPosting::getClaimId)),
                LocalDate.now(), attachments.countsByEntry(tenantId),
                shares.findByTenantId(tenantId).stream().collect(Collectors.groupingBy(ClaimShare::getClaimId)),
                LocalDateTime.now());
    }

    private ClaimView toView(Claim c, Context ctx) {
        List<ClaimRepayment> history = ctx.repaymentsByClaim().getOrDefault(c.getId(), List.of());
        BigDecimal rate = Money.nz(c.getInterestRate());
        LocalDate today = ctx.today();

        // ---- walk the repayments: outstanding after each, and interest accrued between them
        BigDecimal outstanding = c.getAmount();
        BigDecimal repaid = Money.ZERO, writtenOff = Money.ZERO, interestReceived = Money.ZERO;
        List<RepaymentView> repaymentViews = new ArrayList<>();
        List<TimelineEvent> timeline = new ArrayList<>();
        Account payerAccount = ctx.accounts().get(c.getPaidFromAccountId());
        String payerName = c.getCategoryId() != null
                ? categories.require(c.getCategoryId()).getName() : payerAccount.getName();
        boolean payable = c.getKind().isPayable();
        timeline.add(new TimelineEvent("CREATED", c.getStartDate(), switch (c.getKind()) {
                    case LENT -> "Lent to " + c.getParty();
                    case PAID_FOR -> "Paid on behalf of " + c.getParty();
                    case BORROWED -> "Borrowed from " + c.getParty();
                    case BILL_DUE -> "Bill from " + c.getParty();
                },
                (c.getKind() == ClaimKind.BORROWED ? "Into " : c.getKind() == ClaimKind.BILL_DUE ? "For " : "From ") + payerName,
                c.getAmount(), c.getJournalEntryId()));

        for (ClaimRepayment r : history) {
            outstanding = outstanding.subtract(r.getPrincipal());
            if (Boolean.TRUE.equals(r.getWriteOff())) {
                writtenOff = writtenOff.add(r.getPrincipal());
            } else {
                repaid = repaid.add(r.getPrincipal());
                interestReceived = interestReceived.add(r.getInterest());
            }
            Account account = ctx.accounts().get(r.getAccountId());
            BigDecimal total = r.getPrincipal().add(r.getInterest());
            repaymentViews.add(new RepaymentView(r.getId(), r.getPaidDate(), r.getPrincipal(), r.getInterest(), total,
                    r.getAccountId(), account.getName(), Boolean.TRUE.equals(r.getWriteOff()), r.getJournalEntryId(),
                    entryNo(ctx, r.getJournalEntryId()), outstanding, r.getNotes(), outstanding.signum() == 0));
            timeline.add(Boolean.TRUE.equals(r.getWriteOff())
                    ? new TimelineEvent("WRITTEN_OFF", r.getPaidDate(), payable ? "Waived" : "Written off",
                        "Booked to " + account.getName(), r.getPrincipal(), r.getJournalEntryId())
                    : new TimelineEvent("REPAID", r.getPaidDate(),
                        (outstanding.signum() == 0 ? "Final " : "Partial ") + (payable ? "payment" : "repayment"),
                        (payable ? "From " : "Into ") + account.getName()
                                + (r.getInterest().signum() > 0 ? " · incl. interest " + r.getInterest().toPlainString() : ""),
                        total, r.getJournalEntryId()));
        }
        List<ClaimInterestPosting> posted = ctx.postingsByClaim().getOrDefault(c.getId(), List.of());
        BigDecimal interestPosted = posted.stream().map(ClaimInterestPosting::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal settledOnPost = posted.stream().filter(p -> settledOnPosting(c, p.getAccountId()))
                .map(ClaimInterestPosting::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal postedUnpaid = interestPosted.subtract(settledOnPost).subtract(history.stream().map(r -> Money.nz(r.getAccruedInterest()))
                .reduce(Money.ZERO, BigDecimal::add)).max(Money.ZERO);
        interestReceived = interestReceived.add(settledOnPost);
        Map<Long, Integer> firstPeriod = new java.util.HashMap<>();
        int previous = 0;
        for (ClaimInterestPosting p : posted) {
            firstPeriod.put(p.getId(), previous + 1);
            previous = p.getPeriodNo();
        }
        for (ClaimInterestPosting p : posted) {
            if (p.getAmount().signum() > 0) {
                boolean cash = settledOnPosting(c, p.getAccountId());
                Account into = cash ? ctx.accounts().get(p.getAccountId()) : null;
                int from = firstPeriod.get(p.getId());
                timeline.add(new TimelineEvent("INTEREST_POSTED", p.getPeriodTo(),
                        cash ? (payable ? "Interest paid" : "Interest received") : "Interest posted",
                        (from < p.getPeriodNo() ? "Months " + from + "–" + p.getPeriodNo() : "Month " + p.getPeriodNo())
                                + (cash ? " · " + (payable ? "from " : "into ") + into.getName() : "")
                                + (Boolean.TRUE.equals(p.getAutomatic()) ? " · automatic" : ""),
                        p.getAmount(), p.getJournalEntryId()));
            }
        }
        timeline.sort(Comparator.comparing(TimelineEvent::date));
        boolean principalOpen = outstanding.signum() > 0;
        boolean open = principalOpen || postedUnpaid.signum() > 0;
        LocalDate lastPayment = history.isEmpty() ? null : history.getLast().getPaidDate();

        // ---- interest, month by month: until settled, else until the due date (or three months ahead)
        InterestType type = c.getInterestType() != null ? c.getInterestType() : InterestType.SIMPLE;
        boolean compound = type == InterestType.COMPOUND;
        LocalDate end = !open ? lastPayment
                : c.getDueDate() != null && c.getDueDate().isAfter(today) ? c.getDueDate() : today.plusMonths(3);
        ClaimInterest.Result interest = ClaimInterest.schedule(c.getAmount(), rate, c.getStartDate(), history,
                end == null ? c.getStartDate() : end, today, dayCount);
        Map<Integer, ClaimInterestPosting> postedByPeriod = posted.stream()
                .collect(Collectors.toMap(ClaimInterestPosting::getPeriodNo, Function.identity(), (a, b) -> a));
        List<com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod> periods = interest.periods().stream()
                .map(p -> {
                    ClaimInterestPosting hit = postedByPeriod.get(p.period());
                    return hit == null ? p : new com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod(p.period(), p.from(),
                            p.to(), p.openingPrincipal(), p.principalRepaid(), p.interestPaid(), p.closingPrincipal(),
                            p.simpleInterest(), p.compoundInterest(), p.cumulativeSimple(), p.cumulativeCompound(),
                            p.compoundExtra(), p.status(), hit.getAmount(), hit.getJournalEntryId());
                }).toList();
        List<Due> due = dueMonths(c, ctx);
        BigDecimal accrued = compound ? interest.compoundToDate() : interest.simpleToDate();
        BigDecimal interestDue = open ? accrued.subtract(interestReceived).max(Money.ZERO) : Money.ZERO;

        ClaimStatus status = statusOf(c.getAmount(), outstanding, history, postedUnpaid);
        boolean overdue = open && c.getDueDate() != null && c.getDueDate().isBefore(today);
        if (!open && lastPayment != null) {
            timeline.add(new TimelineEvent("SETTLED", lastPayment,
                    status == ClaimStatus.WRITTEN_OFF ? (payable ? "Closed (waived)" : "Closed (written off)")
                            : payable ? "Paid off in full" : "Settled in full",
                    ChronoUnit.DAYS.between(c.getStartDate(), lastPayment) + " days after it " + (payable ? "started" : "was given"), null, null));
        } else if (c.getDueDate() != null) {
            timeline.add(new TimelineEvent(overdue ? "OVERDUE" : "DUE", c.getDueDate(),
                    overdue ? "Overdue" : "Due",
                    overdue ? ChronoUnit.DAYS.between(c.getDueDate(), today) + " days late"
                            : "in " + ChronoUnit.DAYS.between(today, c.getDueDate()) + " days",
                    outstanding.add(interestDue), null));
        }

        // ---- the collection plan: interest due by the plan now (whole months / years), and the next due date
        InterestCollection plan = collectionOf(c);
        BigDecimal dueNow = interestDue;
        LocalDate nextDate = null;
        BigDecimal nextAmount = null;
        if (open && rate.signum() > 0 && plan != InterestCollection.ON_PAYMENT) {
            int step = plan.months();
            int done = completedMonths(c.getStartDate(), today) / step * step;
            BigDecimal atBoundary = cumulativeAt(interest, c.getStartDate(), done, compound);
            if (atBoundary != null) {
                dueNow = atBoundary.subtract(interestReceived).max(Money.ZERO);
            }
            if (principalOpen) {
                int nextMonth = done + step;
                nextDate = c.getStartDate().plusMonths(nextMonth);
                ClaimInterest.Result ahead = end != null && !nextDate.isAfter(end) ? interest : ClaimInterest.schedule(c.getAmount(),
                        rate, c.getStartDate(), history, nextDate, today, dayCount);
                BigDecimal atNext = cumulativeAt(ahead, c.getStartDate(), nextMonth, compound);
                if (atNext != null) {
                    nextAmount = Money.round(atNext.subtract(atBoundary == null ? Money.ZERO : atBoundary).max(Money.ZERO));
                }
            }
        }
        dueNow = Money.round(dueNow);

        BigDecimal growing = compound ? outstanding.add(interestDue) : outstanding;
        BigDecimal monthly = principalOpen ? Money.round(growing.multiply(rate).divide(BigDecimal.valueOf(1200), 6, RoundingMode.HALF_UP)) : Money.ZERO;
        BigDecimal projectedAtDue = interestDue;
        if (open && c.getDueDate() != null && c.getDueDate().isAfter(today)) {
            BigDecimal total = compound ? interest.compoundTotal() : interest.simpleTotal();
            projectedAtDue = total.subtract(interestReceived).max(Money.ZERO);
        }
        long daysOutstanding = ChronoUnit.DAYS.between(c.getStartDate(), open ? today : lastPayment);
        Long daysToDue = c.getDueDate() == null || !open ? null : ChronoUnit.DAYS.between(today, c.getDueDate());

        Account receivable = ctx.accounts().get(c.getReceivableAccountId());
        return new ClaimView(c.getId(), c.getKind(), c.getKind().getLabel(), c.getParty(), c.getNarration(),
                c.getAmount(), c.getStartDate(), c.getDueDate(), c.getInterestRate(), type, type.getLabel(),
                receivable.getId(), receivable.getName(), payerAccount.getId(), payerName, payerAccount.getAccountType().name(),
                c.getJournalEntryId(), entryNo(ctx, c.getJournalEntryId()),
                Optional.ofNullable(ctx.entries().get(c.getJournalEntryId())).map(JournalEntry::getReference).orElse(null),
                status, status.getLabel(), overdue, Math.max(daysOutstanding, 0), daysToDue,
                repaid, writtenOff, Money.round(outstanding),
                Money.percent(repaid.add(writtenOff), c.getAmount()),
                interestReceived, accrued, interestDue, monthly, projectedAtDue,
                Money.round(outstanding.add(interestDue)), lastPayment, c.getNotes(),
                interest.simpleToDate(), interest.compoundToDate(), Money.round(outstanding.add(projectedAtDue)),
                repaymentViews, timeline, periods, c.getCategoryId(), c.getVersion(),
                Boolean.TRUE.equals(c.getPostInterestMonthly()), dayCount.getLabel(), interestPosted, postedUnpaid,
                due.size(), due.stream().map(Due::amount).reduce(Money.ZERO, BigDecimal::add),
                posted.stream().map(p -> {
                    Account a = ctx.accounts().get(p.getAccountId() != null ? p.getAccountId() : c.getReceivableAccountId());
                    return new PostingView(p.getId(), p.getPeriodNo(), p.getPeriodFrom(), p.getPeriodTo(),
                            p.getAmount(), p.getJournalEntryId(), entryNo(ctx, p.getJournalEntryId()),
                            Boolean.TRUE.equals(p.getAutomatic()), a.getId(), a.getName(), settledOnPosting(c, p.getAccountId()),
                            firstPeriod.get(p.getId()));
                }).toList(),
                defaultInterestAccount(c), ctx.accounts().get(defaultInterestAccount(c)).getName(),
                c.getJournalEntryId() == null ? 0 : ctx.evidence().getOrDefault(c.getJournalEntryId(), 0),
                plan, plan.getLabel(), dueNow, nextDate, nextAmount,
                (int) ctx.shares().getOrDefault(c.getId(), List.of()).stream().filter(s -> s.isActive(ctx.now())).count());
    }

    /**
     * Interest accrued up to the end of a schedule month (0: the start), or null when the schedule does not
     * reach that month as a whole month.
     */
    private static BigDecimal cumulativeAt(ClaimInterest.Result r, LocalDate start, int month, boolean compound) {
        if (month <= 0) {
            return Money.ZERO;
        }
        return r.periods().stream()
                .filter(p -> p.period() == month && p.to().equals(start.plusMonths(month)))
                .findFirst().map(p -> compound ? p.cumulativeCompound() : p.cumulativeSimple()).orElse(null);
    }

    private static ClaimStatus statusOf(BigDecimal amount, BigDecimal outstanding, List<ClaimRepayment> history,
                                        BigDecimal postedUnpaid) {
        if (outstanding.signum() <= 0 && postedUnpaid.signum() <= 0) {
            return !history.isEmpty() && Boolean.TRUE.equals(history.getLast().getWriteOff())
                    ? ClaimStatus.WRITTEN_OFF : ClaimStatus.SETTLED;
        }
        return outstanding.compareTo(amount) < 0 || !history.isEmpty() ? ClaimStatus.PARTIAL : ClaimStatus.OPEN;
    }

    // ================================================================== helpers

    private static String entryNo(Context ctx, Long entryId) {
        JournalEntry entry = entryId == null ? null : ctx.entries().get(entryId);
        return entry == null ? null : entry.getEntryNo();
    }

    private void apply(Claim claim, ClaimRequest request, Account payer, Account receivable) {
        claim.setKind(request.kind());
        claim.setParty(request.party().trim());
        String narration = blankToNull(request.narration());
        claim.setNarration(narration != null ? narration : switch (request.kind()) {
            case LENT -> "Lent to ";
            case PAID_FOR -> "Paid for ";
            case BORROWED -> "Borrowed from ";
            case BILL_DUE -> "Bill from ";
        } + request.party().trim());
        claim.setAmount(Money.round(request.amount()));
        claim.setStartDate(request.startDate());
        claim.setDueDate(request.dueDate());
        claim.setInterestRate(request.interestRate() == null || request.interestRate().signum() == 0
                ? null : request.interestRate());
        claim.setInterestType(claim.getInterestRate() == null || request.interestType() == null
                ? InterestType.SIMPLE : request.interestType());
        claim.setPaidFromAccountId(payer.getId());
        claim.setCategoryId(request.kind() == ClaimKind.BILL_DUE
                ? categories.require(request.categoryId(), CategoryKind.EXPENSE).getId() : null);
        claim.setReceivableAccountId(receivable.getId());
        claim.setNotes(blankToNull(request.notes()));
        claim.setInterestCollection(request.interestCollection() != null ? request.interestCollection()
                : claim.getInterestCollection() != null ? claim.getInterestCollection() : InterestCollection.MONTHLY);
        claim.setPostInterestMonthly(claim.getInterestRate() != null && Boolean.TRUE.equals(request.postInterestMonthly())
                && claim.getInterestCollection() != InterestCollection.ON_PAYMENT);
        Long interestAccount = request.interestAccountId() == null ? null : interestAccount(claim, request.interestAccountId()).getId();
        claim.setInterestAccountId(interestAccount == null || interestAccount.equals(receivable.getId()) ? null : interestAccount);
    }

    private JournalDraft draft(Claim claim, String reference) {
        VoucherType type = switch (claim.getKind()) {
            case LENT -> VoucherType.LENDING;
            case PAID_FOR -> VoucherType.PAID_FOR;
            case BORROWED -> VoucherType.BORROWING;
            case BILL_DUE -> VoucherType.BILL_DUE;
        };
        JournalDraft draft = JournalDraft.of(claim.getStartDate(), type, claim.getNarration())
                .party(claim.getParty())
                .reference(blankToNull(reference));
        if (claim.getKind().isPayable()) {
            draft.debit(claim.getPaidFromAccountId(), claim.getAmount()).category(claim.getCategoryId())
                    .credit(claim.getReceivableAccountId(), claim.getAmount(), claim.getKind().getLabel() + ": " + claim.getParty());
        } else {
            draft.debit(claim.getReceivableAccountId(), claim.getAmount(), claim.getKind().getLabel() + ": " + claim.getParty())
                    .credit(claim.getPaidFromAccountId(), claim.getAmount());
        }
        return draft.source(LedgerService.SOURCE_CLAIM, claim.getId());
    }

    private void refreshStatus(Claim claim) {
        claim.setStatus(statusOf(claim.getAmount(), outstanding(claim), repayments.findByClaimId(claim.getId()),
                unpaidPosted(claim)));
    }

    private BigDecimal outstanding(Claim claim) {
        return repayments.findByClaimId(claim.getId()).stream().map(ClaimRepayment::getPrincipal)
                .reduce(claim.getAmount(), BigDecimal::subtract);
    }

    private static void validateDates(ClaimRequest request) {
        if (request.dueDate() != null && request.dueDate().isBefore(request.startDate())) {
            throw new BusinessException("Due date cannot be before the date the money was given");
        }
    }

    private Claim claim(Long id) {
        return claims.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Lent / paid-for item", id));
    }

    private Account account(Long id) {
        return accounts.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Account", id));
    }

    /** Bank, cash, wallet, card ... the account money goes out of or comes into. */
    private Account requirePayer(Long id) {
        Account account = account(id);
        boolean ok = account.getAccountClass() == AccountClass.ASSET || account.getAccountClass() == AccountClass.LIABILITY;
        if (!ok || account.getAccountType() == AccountType.RECEIVABLE) {
            throw new BusinessException("Use a bank, cash, wallet or card account");
        }
        return account;
    }

    /** The account on the other side: where the money went / came from, or Expenses for a bill to pay. */
    private Account counterAccount(ClaimKind kind, Long id) {
        if (kind == ClaimKind.BILL_DUE) {
            return ledger.systemAccount(DefaultChartOfAccounts.EXPENSES);
        }
        if (id == null) {
            throw new BusinessException(kind.isPayable() ? "Pick the account the money came into" : "Pick the account the money went from");
        }
        return requirePayer(id);
    }

    /** Receivable for money owed to you, payable for money you owe. */
    private Account holdingAccount(ClaimKind kind, Long id) {
        return kind.isPayable() ? payable(id) : receivable(id);
    }

    /** The liability a debt sits in: the given payable / loan account, or the default Payables. */
    private Account payable(Long id) {
        if (id != null) {
            Account account = account(id);
            if (account.getAccountClass() != AccountClass.LIABILITY || account.getAccountType() == AccountType.CREDIT_CARD) {
                throw new BusinessException("Track it under a Payable or loan account");
            }
            return account;
        }
        return accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.PAYABLES)
                .orElseThrow(() -> new BusinessException("The Payables account is missing"));
    }

    /** The receivable the claim sits in: the given asset account, or the default Receivables. */
    private Account receivable(Long id) {
        if (id != null) {
            Account account = account(id);
            if (account.getAccountType() != AccountType.RECEIVABLE && account.getAccountType() != AccountType.LOAN_GIVEN) {
                throw new BusinessException("Track it under a Receivable or Loan Given account");
            }
            return account;
        }
        return accounts.findByTenantIdAndCode(UserContext.tenantId(), DefaultChartOfAccounts.RECEIVABLES)
                .orElseThrow(() -> new BusinessException("The Receivables account is missing"));
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.trim();
    }
}
