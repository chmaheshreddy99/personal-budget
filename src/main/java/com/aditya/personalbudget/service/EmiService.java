package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.EmiInstallment;
import com.aditya.personalbudget.domain.entity.EmiPlan;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.EmiInstallmentRepository;
import com.aditya.personalbudget.repository.EmiPlanRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Things bought on EMI (Expenses › EMIs): on a credit card or through a loan / finance company.
 * <p>
 * <b>Card EMI.</b> The purchase is paid with the card: {@code Dr Expenses [category] / Cr the card} for the whole
 * price, so the card's balance (its used limit) goes up at once and stays blocked. Each month the EMI is
 * <i>billed</i> on the card: its interest and GST are charged ({@code Dr Expenses [Loan Interest] / Cr the card});
 * the principal part was charged with the purchase. When the bill is paid into the card ({@code Dr the card / Cr the
 * bank}) that part of the limit is free again. Paying off early pays what is still blocked (and any charge) into the
 * card at once.
 * <p>
 * <b>Loan EMI.</b> A loan / finance company pays the shop: {@code Dr Expenses [category] / Cr EMI · <what>}, a
 * liability account made for the plan (kept off the Accounts list unless asked for). Each EMI pays part of it off:
 * {@code Dr EMI · <what>} (principal) and {@code Dr Expenses [Loan Interest]} (interest and GST), {@code Cr} the bank.
 * <p>
 * A processing fee is {@code Dr Expenses [Loan Interest] / Cr the card or bank} with the purchase.
 * <p>
 * <b>Schedule.</b> Reducing balance: EMI = P·r·(1+r)ⁿ / ((1+r)ⁿ − 1), r the monthly rate (P / n for a no-cost EMI);
 * each month's interest is the balance × r and the rest of the instalment is principal; the last one clears what is
 * left. The first EMI falls a month after the purchase unless set, the last n − 1 months after the first. Plans that
 * ask for it ({@code autoPost}, on by default for cards) are billed (a card) or paid (a loan) by themselves on each due
 * date, at startup and every night.
 * <p>
 * A finished plan can be <i>closed</i>: it is put away and its account hidden, until it is re-opened (to correct
 * something: a plan with nothing billed or paid can be changed in full, otherwise its description, category and
 * lender).
 */
@Service
public class EmiService {

    public static final String SOURCE_PURCHASE = "EMI_PURCHASE";
    public static final String SOURCE_PAYMENT = "EMI_PAYMENT";
    public static final String SOURCE_BILL = "EMI_BILL";
    public static final String SOURCE_CARD_PAYMENT = "EMI_CARD_PAYMENT";
    public static final String SOURCE_FORECLOSE = "EMI_FORECLOSE";
    static final String AREA = "Expenses";
    public static final String CARD = "CARD";
    public static final String LOAN = "LOAN";
    /** A card bill is due about this long after it is billed; later than that it is overdue. */
    static final int CARD_GRACE_DAYS = 20;

    public record EmiRequest(@NotBlank @Size(max = 8) String kind, @NotBlank @Size(max = 255) String narration,
                             @Size(max = 100) String party, @Size(max = 100) String lender, @Size(max = 60) String reference,
                             @Size(max = 255) String notes, @NotNull Long categoryId, @NotNull @Positive BigDecimal principal,
                             @PositiveOrZero @DecimalMax("60") BigDecimal ratePercent, @NotNull @Min(1) @Max(360) Integer months,
                             @PositiveOrZero BigDecimal processingFee, @PositiveOrZero @DecimalMax("50") BigDecimal gstPercent,
                             @NotNull LocalDate purchaseDate, LocalDate firstDueDate, @NotNull Long payAccountId, Boolean autoPost) {
    }

    /**
     * The next {@code count} EMIs (1 by default), on {@code date} (each on its own due date when empty). A card EMI is
     * billed on the card and, unless {@code billOnly}, paid into the card from {@code accountId} (a bank, cash or wallet).
     */
    public record PayRequest(@Min(1) @Max(360) Integer count, LocalDate date, Long accountId, Boolean billOnly) {
    }

    /** accountId: where the payoff comes from (a card EMI: the bank paying into the card; the card itself: billed only). */
    public record ForecloseRequest(@NotNull LocalDate date, Long accountId, @PositiveOrZero BigDecimal charges) {
    }

    public record AutoRequest(@NotNull Boolean autoPost) {
    }

    public record InstallmentView(Long id, int seq, LocalDate dueDate, BigDecimal emi, BigDecimal principal, BigDecimal interest,
                                  BigDecimal gst, BigDecimal balanceAfter, String status, boolean overdue, LocalDate billedOn,
                                  LocalDate paidOn, Long journalEntryId, String entryNo, Long paymentEntryId, String paymentEntryNo) {
    }

    /**
     * A plan with where it stands. Card: blocked is the principal still charged on the card and not yet billed,
     * billedToPay what is billed and not yet paid into the card; toBill / toPay how many EMIs wait for that.
     */
    public record PlanView(Long id, String kind, String narration, String party, String lender, String reference, String notes,
                           Long categoryId, String categoryName, BigDecimal principal, BigDecimal ratePercent, int months,
                           BigDecimal emiAmount, BigDecimal processingFee, BigDecimal gstPercent, LocalDate purchaseDate,
                           LocalDate firstDueDate, LocalDate endDate, Long payAccountId, String payAccountName, String payAccountType,
                           Long liabilityAccountId, String liabilityAccountName, Long purchaseEntryId, String purchaseEntryNo,
                           boolean autoPost, String status, LocalDate closedOn, boolean archived, LocalDate archivedOn, boolean editable,
                           // ---- figures
                           int paidCount, int dueNow, int left, int toBill, int toPay, BigDecimal outstanding, BigDecimal blocked,
                           BigDecimal billedToPay, BigDecimal principalPaid, BigDecimal interestTotal, BigDecimal interestPaid,
                           BigDecimal interestLeft, BigDecimal gstTotal, BigDecimal totalPayable, BigDecimal paidSoFar,
                           BigDecimal stillToPay, BigDecimal overdueAmount, InstallmentView next, int progressPercent, Long monthsLeft,
                           Long version, List<InstallmentView> installments) {
    }

    public record Summary(int active, BigDecimal outstanding, BigDecimal blocked, BigDecimal thisMonth, BigDecimal interestLeft, int dueNow,
                          BigDecimal overdue, LocalDate nextDue, BigDecimal nextAmount, int closed) {
    }

    public record Book(Summary summary, List<PlanView> plans) {
    }

    private final EmiPlanRepository plans;
    private final EmiInstallmentRepository installments;
    private final AccountRepository accounts;
    private final AccountService accountService;
    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;
    private final LedgerService ledger;
    private final CategoryService categories;
    private final CategoryRepository categoryRows;
    private final ActivityService activity;

    public EmiService(EmiPlanRepository plans, EmiInstallmentRepository installments, AccountRepository accounts,
                      AccountService accountService, JournalEntryRepository entries, JournalLineRepository lines, LedgerService ledger,
                      CategoryService categories, CategoryRepository categoryRows, ActivityService activity) {
        this.plans = plans;
        this.installments = installments;
        this.accounts = accounts;
        this.accountService = accountService;
        this.entries = entries;
        this.lines = lines;
        this.ledger = ledger;
        this.categories = categories;
        this.categoryRows = categoryRows;
        this.activity = activity;
    }

    // ================================================================== the schedule

    /** A row of a schedule before it is saved. */
    public record Row(int seq, LocalDate dueDate, BigDecimal emi, BigDecimal principal, BigDecimal interest, BigDecimal gst,
                      BigDecimal balanceAfter) {
    }

    /** The monthly instalment on the reducing balance (P / n with no interest), to the paisa. */
    public static BigDecimal emi(BigDecimal principal, BigDecimal ratePercent, int months) {
        if (Money.nz(ratePercent).signum() == 0) return principal.divide(BigDecimal.valueOf(months), 2, RoundingMode.HALF_UP);
        MathContext mc = MathContext.DECIMAL64;
        BigDecimal r = ratePercent.divide(BigDecimal.valueOf(1200), mc);
        BigDecimal f = BigDecimal.ONE.add(r).pow(months, mc);
        return principal.multiply(r, mc).multiply(f, mc).divide(f.subtract(BigDecimal.ONE), mc).setScale(2, RoundingMode.HALF_UP);
    }

    /** Every instalment: interest on the balance, the rest principal, the last one clearing what is left. */
    public static List<Row> schedule(BigDecimal principal, BigDecimal ratePercent, int months, BigDecimal gstPercent, LocalDate firstDue) {
        BigDecimal emi = emi(principal, ratePercent, months);
        BigDecimal r = Money.nz(ratePercent).divide(BigDecimal.valueOf(1200), MathContext.DECIMAL64);
        BigDecimal gstRate = Money.nz(gstPercent).divide(Money.HUNDRED, MathContext.DECIMAL64);
        BigDecimal balance = Money.round(principal);
        List<Row> rows = new ArrayList<>();
        for (int k = 1; k <= months; k++) {
            BigDecimal interest = balance.multiply(r).setScale(2, RoundingMode.HALF_UP);
            BigDecimal part = k == months ? balance : emi.subtract(interest).min(balance).max(Money.ZERO);
            balance = balance.subtract(part);
            BigDecimal gst = interest.multiply(gstRate).setScale(2, RoundingMode.HALF_UP);
            rows.add(new Row(k, firstDue.plusMonths(k - 1), part.add(interest), part, interest, gst, balance));
        }
        return rows;
    }

    // ================================================================== reading

    /** The plans (closed ones too when asked), with the figures of those not closed. */
    public Book book(boolean withClosed) {
        Long tenant = UserContext.tenantId();
        Map<Long, Account> accountById = accounts.findByTenantId(tenant).stream().collect(Collectors.toMap(Account::getId, Function.identity()));
        Map<Long, String> categoryName = categoryRows.findByTenantId(tenant).stream().collect(Collectors.toMap(Category::getId, Category::getName, (a, b) -> a));
        Map<Long, String> numbers = entries.findByTenantId(tenant).stream().collect(Collectors.toMap(JournalEntry::getId, JournalEntry::getEntryNo));
        Map<Long, List<EmiInstallment>> byPlan = installments.findByTenantId(tenant).stream()
                .collect(Collectors.groupingBy(EmiInstallment::getPlanId));
        LocalDate today = LocalDate.now();
        List<EmiPlan> all = plans.findByTenantId(tenant);
        List<PlanView> list = all.stream().filter(p -> withClosed || !Boolean.TRUE.equals(p.getArchived()))
                .map(p -> view(p, byPlan.getOrDefault(p.getId(), List.of()).stream().sorted(Comparator.comparing(EmiInstallment::getSeq)).toList(),
                        accountById, categoryName, numbers, today))
                .sorted(Comparator.comparing(PlanView::archived)
                        .thenComparing((PlanView v) -> !"ACTIVE".equals(v.status()))
                        .thenComparing(v -> v.next() == null ? LocalDate.MAX : v.next().dueDate())
                        .thenComparing(PlanView::id, Comparator.reverseOrder()))
                .toList();
        List<PlanView> active = list.stream().filter(v -> "ACTIVE".equals(v.status()) && !v.archived()).toList();
        BigDecimal thisMonth = active.stream().flatMap(v -> v.installments().stream())
                .filter(i -> i.dueDate().getYear() == today.getYear() && i.dueDate().getMonth() == today.getMonth() && !"WAIVED".equals(i.status()))
                .map(i -> i.emi().add(Money.nz(i.gst()))).reduce(Money.ZERO, BigDecimal::add);
        InstallmentView next = active.stream().map(PlanView::next).filter(Objects::nonNull).min(Comparator.comparing(InstallmentView::dueDate)).orElse(null);
        Summary s = new Summary(active.size(), sum(active, PlanView::outstanding), sum(active, PlanView::blocked), thisMonth,
                sum(active, PlanView::interestLeft), active.stream().mapToInt(PlanView::dueNow).sum(), sum(active, PlanView::overdueAmount),
                next == null ? null : next.dueDate(), next == null ? null : next.emi().add(Money.nz(next.gst())),
                (int) all.stream().filter(p -> Boolean.TRUE.equals(p.getArchived())).count());
        return new Book(s, list);
    }

    public PlanView get(Long id) {
        return book(true).plans().stream().filter(v -> v.id().equals(id)).findFirst().orElseThrow(() -> new NotFoundException("EMI", id));
    }

    private PlanView view(EmiPlan p, List<EmiInstallment> rows, Map<Long, Account> accountById, Map<Long, String> categoryName,
                          Map<Long, String> numbers, LocalDate today) {
        boolean card = CARD.equals(p.getKind());
        List<InstallmentView> iv = rows.stream().map(i -> {
            boolean open = "DUE".equals(i.getStatus()) || "BILLED".equals(i.getStatus());
            boolean overdue = open && i.getDueDate().plusDays(card ? CARD_GRACE_DAYS : 0).isBefore(today);
            return new InstallmentView(i.getId(), i.getSeq(), i.getDueDate(), i.getPrincipal().add(i.getInterest()), i.getPrincipal(), i.getInterest(),
                    Money.nz(i.getGst()), i.getBalanceAfter(), i.getStatus(), overdue, i.getBilledOn(), i.getPaidOn(), i.getJournalEntryId(),
                    i.getJournalEntryId() == null ? null : numbers.get(i.getJournalEntryId()), i.getPaymentEntryId(),
                    i.getPaymentEntryId() == null ? null : numbers.get(i.getPaymentEntryId()));
        }).toList();
        List<InstallmentView> paid = iv.stream().filter(i -> "PAID".equals(i.status())).toList();
        List<InstallmentView> billed = iv.stream().filter(i -> "BILLED".equals(i.status())).toList();
        List<InstallmentView> due = iv.stream().filter(i -> "DUE".equals(i.status())).toList();
        List<InstallmentView> open = iv.stream().filter(i -> "DUE".equals(i.status()) || "BILLED".equals(i.status())).toList();
        boolean foreclosed = "FORECLOSED".equals(p.getStatus());
        BigDecimal principalPaid = sumI(paid, InstallmentView::principal);
        BigDecimal outstanding = foreclosed ? Money.ZERO : p.getPrincipal().subtract(principalPaid).max(Money.ZERO);
        BigDecimal blocked = !card || foreclosed ? Money.ZERO : p.getPrincipal().subtract(principalPaid).subtract(sumI(billed, InstallmentView::principal)).max(Money.ZERO);
        BigDecimal billedToPay = billed.stream().map(i -> i.emi().add(i.gst())).reduce(Money.ZERO, BigDecimal::add);
        List<InstallmentView> counted = iv.stream().filter(i -> !"WAIVED".equals(i.status())).toList();
        BigDecimal interestTotal = sumI(counted, InstallmentView::interest);
        BigDecimal interestPaid = sumI(iv.stream().filter(i -> "PAID".equals(i.status()) || "BILLED".equals(i.status())).toList(), InstallmentView::interest);
        BigDecimal gstTotal = sumI(counted, InstallmentView::gst);
        BigDecimal paidSoFar = paid.stream().map(i -> i.emi().add(i.gst())).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal stillToPay = open.stream().map(i -> i.emi().add(i.gst())).reduce(Money.ZERO, BigDecimal::add);
        int toBill = card ? (int) due.stream().filter(i -> !i.dueDate().isAfter(today)).count() : 0;
        int toPay = card ? billed.size() : (int) due.stream().filter(i -> !i.dueDate().isAfter(today)).count();
        BigDecimal overdue = open.stream().filter(InstallmentView::overdue).map(i -> i.emi().add(i.gst())).reduce(Money.ZERO, BigDecimal::add);
        InstallmentView next = open.isEmpty() ? null : open.getFirst();
        Account pay = accountById.get(p.getPayAccountId());
        Account liability = p.getLiabilityAccountId() == null ? null : accountById.get(p.getLiabilityAccountId());
        int progress = p.getMonths() == 0 ? 0 : (int) Math.round(paid.size() * 100.0 / p.getMonths());
        Long monthsLeft = next == null ? null : ChronoUnit.MONTHS.between(today.withDayOfMonth(1), p.getEndDate().withDayOfMonth(1)) + 1;
        boolean editable = iv.stream().allMatch(i -> "DUE".equals(i.status())) && "ACTIVE".equals(p.getStatus());
        return new PlanView(p.getId(), p.getKind(), p.getNarration(), p.getParty(), p.getLender(), p.getReference(), p.getNotes(),
                p.getCategoryId(), categoryName.getOrDefault(p.getCategoryId(), "Uncategorised"), p.getPrincipal(), p.getRatePercent(), p.getMonths(),
                p.getEmiAmount(), Money.nz(p.getProcessingFee()), Money.nz(p.getGstPercent()), p.getPurchaseDate(), p.getFirstDueDate(), p.getEndDate(),
                p.getPayAccountId(), pay == null ? null : pay.getName(), pay == null ? null : pay.getAccountType().name(),
                p.getLiabilityAccountId(), liability == null ? null : liability.getName(), p.getPurchaseEntryId(),
                p.getPurchaseEntryId() == null ? null : numbers.get(p.getPurchaseEntryId()), Boolean.TRUE.equals(p.getAutoPost()), p.getStatus(),
                p.getClosedOn(), Boolean.TRUE.equals(p.getArchived()), p.getArchivedOn(), editable,
                paid.size(), toBill + toPay, open.size(), toBill, toPay, outstanding, blocked, billedToPay, principalPaid, interestTotal, interestPaid,
                interestTotal.subtract(interestPaid), gstTotal, p.getPrincipal().add(interestTotal).add(gstTotal).add(Money.nz(p.getProcessingFee())),
                paidSoFar, stillToPay, overdue, next, foreclosed ? 100 : progress, monthsLeft, p.getVersion(), iv);
    }

    // ================================================================== a new plan, and changing one

    @Transactional
    public PlanView create(EmiRequest r) {
        EmiPlan p = new EmiPlan();
        p.setTenantId(UserContext.tenantId());
        p.setStatus("ACTIVE");
        p.setCreatedBy(UserContext.username());
        p.setCreatedAt(LocalDateTime.now());
        Account pay = terms(p, r);
        p = plans.save(p);
        if (LOAN.equals(p.getKind())) p.setLiabilityAccountId(newLoanAccount(p).getId());
        makeSchedule(p);
        p.setPurchaseEntryId(ledger.post(purchaseDraft(p)).getId());
        plans.save(p);
        activity.record("ADDED", AREA, "Bought on EMI · " + p.getNarration() + " · " + ActivityService.money(p.getPrincipal()) + " · "
                + p.getMonths() + " × " + ActivityService.money(p.getEmiAmount()) + " · " + pay.getName());
        return get(p.getId());
    }

    /**
     * Changes a plan. With nothing billed or paid yet everything can change (the schedule is made again and the
     * purchase posted again); otherwise only what it was (description, shop, lender, reference, notes, category) and
     * whether it books itself.
     */
    @Transactional
    public PlanView update(Long id, EmiRequest r) {
        EmiPlan p = require(id);
        List<EmiInstallment> all = installments.findByPlanId(id);
        boolean started = all.stream().anyMatch(i -> !"DUE".equals(i.getStatus())) || !"ACTIVE".equals(p.getStatus());
        if (started) {
            boolean termsChanged = !r.kind().trim().equalsIgnoreCase(p.getKind()) || Money.round(r.principal()).compareTo(p.getPrincipal()) != 0
                    || Money.nz(r.ratePercent()).compareTo(Money.nz(p.getRatePercent())) != 0 || !r.months().equals(p.getMonths())
                    || !r.purchaseDate().equals(p.getPurchaseDate()) || !r.payAccountId().equals(p.getPayAccountId())
                    || (r.firstDueDate() != null && !r.firstDueDate().equals(p.getFirstDueDate()))
                    || Money.nz(r.processingFee()).compareTo(Money.nz(p.getProcessingFee())) != 0
                    || Money.nz(r.gstPercent()).compareTo(Money.nz(p.getGstPercent())) != 0;
            if (termsChanged) {
                throw new BusinessException("EMIs of " + p.getNarration() + " are billed or paid: undo them to change the price, months, interest, dates or account");
            }
            p.setNarration(r.narration().trim());
            p.setParty(blank(r.party()));
            if (blank(r.lender()) != null) p.setLender(r.lender().trim());
            p.setReference(blank(r.reference()));
            p.setNotes(blank(r.notes()));
            p.setCategoryId(categories.require(r.categoryId(), CategoryKind.EXPENSE).getId());
            if (r.autoPost() != null) p.setAutoPost(r.autoPost());
        } else {
            String oldKind = p.getKind();
            terms(p, r);
            all.forEach(i -> installments.deleteById(i.getId()));
            if (LOAN.equals(p.getKind()) && p.getLiabilityAccountId() == null) p.setLiabilityAccountId(newLoanAccount(p).getId());
            makeSchedule(p);
            if (CARD.equals(p.getKind()) && LOAN.equals(oldKind) && p.getLiabilityAccountId() != null) {
                Long acc = p.getLiabilityAccountId();
                p.setLiabilityAccountId(null);
                plans.save(p);
                if (p.getPurchaseEntryId() != null) ledger.repost(p.getPurchaseEntryId(), purchaseDraft(p));
                if (ledger.entryIdsTouchingAccount(acc).isEmpty()) accounts.deleteById(acc);
            }
        }
        plans.save(p);
        if (p.getLiabilityAccountId() != null) {
            accounts.findById(p.getLiabilityAccountId()).ifPresent(a -> {
                a.setInstitution(p.getLender() == null ? null : ActivityService.cut(p.getLender(), 100));
                a.setInterestRate(p.getRatePercent().signum() == 0 ? null : p.getRatePercent());
                a.setCreditLimit(p.getPrincipal());
                accounts.save(a);
            });
        }
        if (p.getPurchaseEntryId() != null) ledger.repost(p.getPurchaseEntryId(), purchaseDraft(p));
        activity.record("CHANGED", AREA, "Changed the EMI plan " + p.getNarration());
        return get(id);
    }

    /** Fills in the plan's terms from the request; the account the EMIs go to. */
    private Account terms(EmiPlan p, EmiRequest r) {
        String kind = r.kind().trim().toUpperCase();
        if (!Set.of(CARD, LOAN).contains(kind)) throw new BusinessException("A credit card EMI or a loan / finance EMI");
        Account pay = accountService.require(r.payAccountId());
        if (CARD.equals(kind) && pay.getAccountType() != AccountType.CREDIT_CARD) {
            throw new BusinessException("A card EMI is paid with a credit card: pick the card");
        }
        if (LOAN.equals(kind) && (pay.getAccountClass() != AccountClass.ASSET || !pay.getAccountType().isLiquid())) {
            throw new BusinessException("Pick the bank, cash or wallet account the EMIs are paid from");
        }
        if (!Boolean.TRUE.equals(pay.getActive())) throw new BusinessException(pay.getName() + " is inactive");
        Category category = categories.require(r.categoryId(), CategoryKind.EXPENSE);
        LocalDate first = r.firstDueDate() != null ? r.firstDueDate() : r.purchaseDate().plusMonths(1);
        if (first.isBefore(r.purchaseDate())) throw new BusinessException("The first EMI cannot be before the purchase");
        if (r.purchaseDate().isAfter(LocalDate.now())) throw new BusinessException("The purchase date is in the future");
        p.setKind(kind);
        p.setNarration(r.narration().trim());
        p.setParty(blank(r.party()));
        p.setLender(blank(r.lender()) != null ? r.lender().trim() : CARD.equals(kind) ? Objects.toString(pay.getInstitution(), pay.getName()) : null);
        p.setReference(blank(r.reference()));
        p.setNotes(blank(r.notes()));
        p.setCategoryId(category.getId());
        p.setPrincipal(Money.round(r.principal()));
        p.setRatePercent(Money.nz(r.ratePercent()));
        p.setMonths(r.months());
        p.setEmiAmount(emi(p.getPrincipal(), p.getRatePercent(), p.getMonths()));
        p.setProcessingFee(Money.nz(r.processingFee()).signum() == 0 ? null : Money.round(r.processingFee()));
        p.setGstPercent(Money.nz(r.gstPercent()).signum() == 0 ? null : r.gstPercent());
        p.setPurchaseDate(r.purchaseDate());
        p.setFirstDueDate(first);
        p.setEndDate(first.plusMonths(p.getMonths() - 1));
        p.setPayAccountId(pay.getId());
        p.setAutoPost(r.autoPost() != null ? r.autoPost() : CARD.equals(kind));
        return pay;
    }

    private Account newLoanAccount(EmiPlan p) {
        Account owed = accountService.createInternal(uniqueName(ActivityService.cut("EMI · " + p.getNarration(), 100)), AccountType.LOAN,
                ActivityService.cut("Still to pay on " + p.getNarration() + " bought on EMI (" + Objects.toString(p.getLender(), "finance") + ")", 255), false);
        owed.setInstitution(p.getLender() == null ? null : ActivityService.cut(p.getLender(), 100));
        owed.setInterestRate(p.getRatePercent().signum() == 0 ? null : p.getRatePercent());
        owed.setCreditLimit(p.getPrincipal());
        owed.setEmiAccount(true);
        return accounts.save(owed);
    }

    private void makeSchedule(EmiPlan p) {
        for (Row row : schedule(p.getPrincipal(), p.getRatePercent(), p.getMonths(), p.getGstPercent(), p.getFirstDueDate())) {
            EmiInstallment i = new EmiInstallment();
            i.setTenantId(p.getTenantId());
            i.setPlanId(p.getId());
            i.setSeq(row.seq());
            i.setDueDate(row.dueDate());
            i.setPrincipal(row.principal());
            i.setInterest(row.interest());
            i.setGst(row.gst().signum() == 0 ? null : row.gst());
            i.setBalanceAfter(row.balanceAfter());
            i.setStatus("DUE");
            installments.save(i);
        }
    }

    /** The purchase: the whole price spent, charged to the card (card EMI) or owed to the lender (loan EMI); the fee. */
    private JournalDraft purchaseDraft(EmiPlan p) {
        boolean card = CARD.equals(p.getKind());
        Long expenses = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
        JournalDraft d = JournalDraft.of(p.getPurchaseDate(), VoucherType.EXPENSE, p.getNarration() + " · on EMI, " + p.getMonths() + " × "
                        + ActivityService.money(p.getEmiAmount()))
                .debit(expenses, p.getPrincipal(), p.getNotes()).category(p.getCategoryId())
                .credit(card ? p.getPayAccountId() : p.getLiabilityAccountId(), p.getPrincipal(),
                        card ? "Card EMI: " + p.getMonths() + " months from " + p.getFirstDueDate() + " (blocks the limit until billed and paid)"
                                : p.getMonths() + " monthly EMIs from " + p.getFirstDueDate())
                .party(p.getParty()).reference(p.getReference()).source(SOURCE_PURCHASE, p.getId());
        if (p.getProcessingFee() != null) {
            d.debit(expenses, p.getProcessingFee(), "EMI processing fee").category(loanInterest())
                    .credit(p.getPayAccountId(), p.getProcessingFee(), "EMI processing fee");
        }
        return d;
    }

    // ================================================================== paying

    @Transactional
    public PlanView pay(Long id, PayRequest r) {
        EmiPlan p = requireActive(id);
        boolean card = CARD.equals(p.getKind());
        boolean billOnly = card && Boolean.TRUE.equals(r.billOnly());
        List<EmiInstallment> open = installments.findByPlanId(id).stream()
                .filter(i -> "DUE".equals(i.getStatus()) || (card && !billOnly && "BILLED".equals(i.getStatus()))).toList();
        int count = r.count() == null ? 1 : r.count();
        if (open.isEmpty()) throw new BusinessException(billOnly ? "Every EMI of " + p.getNarration() + " is billed" : "Every EMI of " + p.getNarration() + " is paid");
        if (count > open.size()) throw new BusinessException("Only " + open.size() + " EMIs are left");
        if (r.date() != null && r.date().isBefore(p.getPurchaseDate())) throw new BusinessException("An EMI cannot be paid before the purchase");
        Account from;
        if (!card) {
            from = r.accountId() != null ? moneyAccount(r.accountId()) : accountService.require(p.getPayAccountId());
        } else if (billOnly) {
            from = accountService.require(p.getPayAccountId());
        } else {
            if (r.accountId() == null || r.accountId().equals(p.getPayAccountId())) throw new BusinessException("Pick the bank account the card is paid from");
            from = moneyAccount(r.accountId());
        }
        for (EmiInstallment i : open.subList(0, count)) {
            LocalDate on = r.date() != null ? r.date() : i.getDueDate();
            if (!card) { postLoan(p, i, on, from.getId()); continue; }
            if ("DUE".equals(i.getStatus())) bill(p, i, r.date() != null && r.date().isBefore(i.getDueDate()) ? r.date() : i.getDueDate());
            if (!billOnly) payCard(p, i, on.isBefore(i.getBilledOn()) ? i.getBilledOn() : on, from.getId());
        }
        closeIfDone(p);
        activity.record("POSTED", AREA, (billOnly ? "Billed " : "Paid ") + (count == 1 ? "EMI " + open.getFirst().getSeq() : count + " EMIs") + " of " + p.getMonths()
                + " · " + p.getNarration() + " · " + from.getName());
        return get(id);
    }

    /** Books every EMI that has fallen due on plans that book themselves (a card's is billed, a loan's paid); how many. */
    @Transactional
    public int postDueForAll() {
        LocalDate today = LocalDate.now();
        int posted = 0;
        for (EmiPlan p : plans.findByTenantId(UserContext.tenantId())) {
            if (!"ACTIVE".equals(p.getStatus()) || !Boolean.TRUE.equals(p.getAutoPost()) || Boolean.TRUE.equals(p.getArchived())) continue;
            Account pay = accounts.findById(p.getPayAccountId()).orElse(null);
            if (pay == null || !Boolean.TRUE.equals(pay.getActive())) continue;
            for (EmiInstallment i : installments.findByPlanId(p.getId())) {
                if (!"DUE".equals(i.getStatus()) || i.getDueDate().isAfter(today)) continue;
                if (CARD.equals(p.getKind())) bill(p, i, i.getDueDate()); else postLoan(p, i, i.getDueDate(), pay.getId());
                posted++;
            }
            closeIfDone(p);
        }
        return posted;
    }

    /** A loan EMI paid: principal off the loan, interest and GST as an expense, from the bank. */
    private void postLoan(EmiPlan p, EmiInstallment i, LocalDate on, Long fromId) {
        Long expenses = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
        String label = "EMI " + i.getSeq() + " of " + p.getMonths();
        BigDecimal gst = Money.nz(i.getGst());
        JournalDraft d = JournalDraft.of(on, VoucherType.EMI_PAYMENT, label + " · " + p.getNarration())
                .debit(p.getLiabilityAccountId(), i.getPrincipal(), "Principal · " + ActivityService.money(i.getBalanceAfter()) + " left")
                .debit(expenses, i.getInterest(), "Interest · " + label).category(loanInterest())
                .debit(expenses, gst, "GST on interest · " + label).category(loanInterest())
                .credit(fromId, i.getPrincipal().add(i.getInterest()).add(gst), label)
                .party(p.getLender()).reference(p.getReference()).source(SOURCE_PAYMENT, i.getId());
        i.setJournalEntryId(ledger.post(d).getId());
        i.setStatus("PAID");
        i.setPaidOn(on);
        installments.save(i);
    }

    /** A card EMI billed: its interest and GST charged on the card (the principal was charged with the purchase). */
    private void bill(EmiPlan p, EmiInstallment i, LocalDate on) {
        BigDecimal charge = i.getInterest().add(Money.nz(i.getGst()));
        if (charge.signum() > 0) {
            String label = "EMI " + i.getSeq() + " of " + p.getMonths();
            Long expenses = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
            JournalDraft d = JournalDraft.of(on, VoucherType.EMI_PAYMENT, label + " billed · " + p.getNarration())
                    .debit(expenses, i.getInterest(), "Interest · " + label).category(loanInterest())
                    .debit(expenses, Money.nz(i.getGst()), "GST on interest · " + label).category(loanInterest())
                    .credit(p.getPayAccountId(), charge, label + " · principal " + ActivityService.money(i.getPrincipal()) + " from the blocked amount")
                    .party(p.getLender()).reference(p.getReference()).source(SOURCE_BILL, i.getId());
            i.setJournalEntryId(ledger.post(d).getId());
        }
        i.setStatus("BILLED");
        i.setBilledOn(on);
        installments.save(i);
    }

    /** A billed card EMI paid into the card from the bank: that part of the limit is free again. */
    private void payCard(EmiPlan p, EmiInstallment i, LocalDate on, Long fromId) {
        BigDecimal amount = i.getPrincipal().add(i.getInterest()).add(Money.nz(i.getGst()));
        String label = "EMI " + i.getSeq() + " of " + p.getMonths();
        JournalDraft d = JournalDraft.of(on, VoucherType.EMI_PAYMENT, label + " paid into the card · " + p.getNarration())
                .debit(p.getPayAccountId(), amount, label + " · frees " + ActivityService.money(i.getPrincipal()) + " of the limit")
                .credit(fromId, amount, label)
                .party(p.getLender()).reference(p.getReference()).source(SOURCE_CARD_PAYMENT, i.getId());
        i.setPaymentEntryId(ledger.post(d).getId());
        i.setStatus("PAID");
        i.setPaidOn(on);
        installments.save(i);
    }

    private void closeIfDone(EmiPlan p) {
        List<EmiInstallment> all = installments.findByPlanId(p.getId());
        if (all.stream().allMatch(i -> "PAID".equals(i.getStatus()))) {
            p.setStatus("CLOSED");
            p.setClosedOn(all.getLast().getPaidOn());
            plans.save(p);
        }
    }

    /**
     * Undoes the last thing done: the payoff of a plan paid off early, or else the last EMI (a card's: its payment into
     * the card first, then its billing).
     */
    @Transactional
    public PlanView undo(Long id) {
        EmiPlan p = require(id);
        if (Boolean.TRUE.equals(p.getArchived())) throw new BusinessException(p.getNarration() + " is closed: re-open it first");
        List<EmiInstallment> all = installments.findByPlanId(id);
        if ("FORECLOSED".equals(p.getStatus())) {
            Long entry = p.getForecloseEntryId();
            all.stream().filter(i -> "WAIVED".equals(i.getStatus())).forEach(i -> { i.setStatus("DUE"); installments.save(i); });
            p.setForecloseEntryId(null);
            p.setStatus("ACTIVE");
            p.setClosedOn(null);
            plans.save(p);
            if (entry != null) ledger.delete(entry);
            activity.record("DELETED", AREA, "Undid paying off " + p.getNarration() + " early");
            return get(id);
        }
        EmiInstallment last = all.stream().filter(i -> "PAID".equals(i.getStatus()) || "BILLED".equals(i.getStatus()))
                .max(Comparator.comparing(EmiInstallment::getSeq))
                .orElseThrow(() -> new BusinessException("No EMI of " + p.getNarration() + " is billed or paid yet"));
        String what;
        if (CARD.equals(p.getKind()) && "PAID".equals(last.getStatus())) {
            Long entry = last.getPaymentEntryId();
            last.setStatus("BILLED");
            last.setPaidOn(null);
            last.setPaymentEntryId(null);
            installments.save(last);
            if (entry != null) ledger.delete(entry);
            what = "payment into the card of EMI ";
        } else {
            Long entry = last.getJournalEntryId();
            last.setStatus("DUE");
            last.setPaidOn(null);
            last.setBilledOn(null);
            last.setJournalEntryId(null);
            installments.save(last);
            if (entry != null) ledger.delete(entry);
            what = CARD.equals(p.getKind()) ? "billing of EMI " : "EMI ";
            // undone by hand: it is not booked again by itself tonight
            if (Boolean.TRUE.equals(p.getAutoPost()) && !last.getDueDate().isAfter(LocalDate.now())) p.setAutoPost(false);
        }
        if (!"ACTIVE".equals(p.getStatus())) {
            p.setStatus("ACTIVE");
            p.setClosedOn(null);
        }
        plans.save(p);
        activity.record("DELETED", AREA, "Undid the " + what + last.getSeq() + " of " + p.getMonths() + " · " + p.getNarration());
        return get(id);
    }

    /**
     * Pays off what is left at once, with any foreclosure charge; the rest of the EMIs are not needed. A loan EMI pays
     * the principal still owed from the bank. A card EMI pays what is still blocked into the card from the bank (or,
     * with the card itself as the account, only bills it: the charge goes on the card).
     */
    @Transactional
    public PlanView foreclose(Long id, ForecloseRequest r) {
        EmiPlan p = requireActive(id);
        boolean card = CARD.equals(p.getKind());
        List<EmiInstallment> all = installments.findByPlanId(id);
        BigDecimal owed = p.getPrincipal().subtract(all.stream().filter(i -> !"DUE".equals(i.getStatus()) && (card || "PAID".equals(i.getStatus())))
                .map(EmiInstallment::getPrincipal).reduce(Money.ZERO, BigDecimal::add));
        if (owed.signum() <= 0) throw new BusinessException("Nothing is left to pay off");
        BigDecimal charges = Money.nz(r.charges());
        Long expenses = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
        JournalDraft d = JournalDraft.of(r.date(), VoucherType.EMI_PAYMENT, "Paid off early · " + p.getNarration())
                .party(p.getLender()).reference(p.getReference()).source(SOURCE_FORECLOSE, p.getId());
        String from;
        if (!card) {
            Account a = r.accountId() != null ? moneyAccount(r.accountId()) : accountService.require(p.getPayAccountId());
            d.debit(p.getLiabilityAccountId(), owed, "Principal still owed").debit(expenses, charges, "Foreclosure charges").category(loanInterest())
                    .credit(a.getId(), owed.add(charges), "Paid off early");
            from = a.getName();
        } else if (r.accountId() == null || r.accountId().equals(p.getPayAccountId())) {
            d.debit(expenses, charges, "Foreclosure charges").category(loanInterest()).credit(p.getPayAccountId(), charges, "Foreclosure charges");
            from = "billed on the card";
        } else {
            Account a = moneyAccount(r.accountId());
            d.debit(p.getPayAccountId(), owed, "The blocked amount paid off").debit(expenses, charges, "Foreclosure charges").category(loanInterest())
                    .credit(a.getId(), owed.add(charges), "Paid off early into the card");
            from = a.getName();
        }
        p.setForecloseEntryId(d.lines().size() >= 2 ? ledger.post(d).getId() : null);
        all.stream().filter(i -> "DUE".equals(i.getStatus())).forEach(i -> { i.setStatus("WAIVED"); installments.save(i); });
        p.setStatus("FORECLOSED");
        p.setClosedOn(r.date());
        plans.save(p);
        activity.record("POSTED", AREA, "Paid off early · " + p.getNarration() + " · " + ActivityService.money(owed.add(charges)) + " · " + from);
        return get(id);
    }

    @Transactional
    public PlanView auto(Long id, AutoRequest r) {
        EmiPlan p = require(id);
        p.setAutoPost(r.autoPost());
        plans.save(p);
        if (r.autoPost() && "ACTIVE".equals(p.getStatus())) postDueForAll();
        return get(id);
    }

    // ================================================================== closing and re-opening

    /** Puts a finished plan away: it and its account no longer show, until it is re-opened. */
    @Transactional
    public PlanView close(Long id) {
        EmiPlan p = require(id);
        List<EmiInstallment> all = installments.findByPlanId(id);
        long open = all.stream().filter(i -> "DUE".equals(i.getStatus()) || "BILLED".equals(i.getStatus())).count();
        if ("ACTIVE".equals(p.getStatus()) && open > 0) {
            throw new BusinessException(open + " EMI" + (open == 1 ? " is" : "s are") + " still to pay on " + p.getNarration() + ": pay them, or pay it off early, then close it");
        }
        p.setArchived(true);
        p.setArchivedOn(LocalDate.now());
        plans.save(p);
        if (p.getLiabilityAccountId() != null) accounts.findById(p.getLiabilityAccountId()).ifPresent(a -> { a.setActive(false); accounts.save(a); });
        activity.record("CHANGED", AREA, "Closed the EMI plan " + p.getNarration());
        return get(id);
    }

    @Transactional
    public PlanView reopen(Long id) {
        EmiPlan p = require(id);
        p.setArchived(false);
        p.setArchivedOn(null);
        plans.save(p);
        if (p.getLiabilityAccountId() != null) accounts.findById(p.getLiabilityAccountId()).ifPresent(a -> { a.setActive(true); accounts.save(a); });
        activity.record("CHANGED", AREA, "Re-opened the EMI plan " + p.getNarration());
        return get(id);
    }

    /** A plan with nothing billed or paid goes with its purchase entry and its account. */
    @Transactional
    public void delete(Long id) {
        EmiPlan p = require(id);
        List<EmiInstallment> all = installments.findByPlanId(id);
        if (all.stream().anyMatch(i -> !"DUE".equals(i.getStatus()))) {
            throw new BusinessException("EMIs of " + p.getNarration() + " are billed or paid: undo them first");
        }
        all.forEach(i -> installments.deleteById(i.getId()));
        Long entry = p.getPurchaseEntryId();
        Long account = p.getLiabilityAccountId();
        plans.deleteById(id);
        if (entry != null) ledger.delete(entry);
        if (account != null && ledger.entryIdsTouchingAccount(account).isEmpty()) accounts.deleteById(account);
        activity.record("DELETED", AREA, "Deleted the EMI plan " + p.getNarration() + " · " + ActivityService.money(p.getPrincipal()));
    }

    // ================================================================== card EMIs made before the card was charged at once

    /**
     * Card EMIs from the first version kept what was owed in an EMI account and charged each EMI in full on the card.
     * They move to the card: the purchase is charged on the card, each EMI booked becomes billed (its interest on the
     * card), a payoff pays the card; the EMI account goes when nothing is left on it. Every balance taken together
     * stays the same. Returns how many plans moved.
     */
    @Transactional
    public int moveCardPlansToTheCard() {
        int moved = 0;
        for (EmiPlan p : plans.findByTenantId(UserContext.tenantId())) {
            if (!CARD.equals(p.getKind()) || p.getLiabilityAccountId() == null) continue;
            Long old = p.getLiabilityAccountId();
            p.setLiabilityAccountId(null);
            plans.save(p);
            if (p.getPurchaseEntryId() != null) ledger.repost(p.getPurchaseEntryId(), purchaseDraft(p));
            for (EmiInstallment i : installments.findByPlanId(p.getId())) {
                if (!"PAID".equals(i.getStatus())) continue;
                Long entry = i.getJournalEntryId();
                i.setJournalEntryId(null);
                i.setStatus("DUE");
                installments.save(i);
                if (entry != null) ledger.delete(entry);
                bill(p, i, i.getPaidOn() != null ? i.getPaidOn() : i.getDueDate());
            }
            if (p.getForecloseEntryId() != null) {
                List<JournalLine> ls = lines.findByJournalEntryId(p.getForecloseEntryId());
                BigDecimal owed = ls.stream().filter(l -> old.equals(l.getAccountId())).map(JournalLine::getDebit).reduce(Money.ZERO, BigDecimal::add);
                BigDecimal charges = ls.stream().filter(l -> l.getCategoryId() != null).map(JournalLine::getDebit).reduce(Money.ZERO, BigDecimal::add);
                Long from = ls.stream().filter(l -> l.getCredit().signum() > 0).map(JournalLine::getAccountId).findFirst().orElse(p.getPayAccountId());
                Long expenses = ledger.systemAccount(DefaultChartOfAccounts.EXPENSES).getId();
                JournalDraft d = JournalDraft.of(p.getClosedOn() != null ? p.getClosedOn() : LocalDate.now(), VoucherType.EMI_PAYMENT, "Paid off early · " + p.getNarration())
                        .party(p.getLender()).reference(p.getReference()).source(SOURCE_FORECLOSE, p.getId());
                if (from.equals(p.getPayAccountId())) d.debit(expenses, charges, "Foreclosure charges").category(loanInterest()).credit(from, charges, "Foreclosure charges");
                else d.debit(p.getPayAccountId(), owed, "The blocked amount paid off").debit(expenses, charges, "Foreclosure charges").category(loanInterest())
                        .credit(from, owed.add(charges), "Paid off early into the card");
                if (d.lines().size() >= 2) ledger.repost(p.getForecloseEntryId(), d);
                else { ledger.delete(p.getForecloseEntryId()); p.setForecloseEntryId(null); plans.save(p); }
            }
            if (ledger.entryIdsTouchingAccount(old).isEmpty()) accounts.deleteById(old);
            moved++;
        }
        return moved;
    }

    // ================================================================== helpers

    private EmiPlan require(Long id) {
        return plans.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("EMI", id));
    }

    private EmiPlan requireActive(Long id) {
        EmiPlan p = require(id);
        if (Boolean.TRUE.equals(p.getArchived())) throw new BusinessException(p.getNarration() + " is closed: re-open it first");
        if (!"ACTIVE".equals(p.getStatus())) throw new BusinessException(p.getNarration() + " is " + ("CLOSED".equals(p.getStatus()) ? "fully paid" : "paid off"));
        return p;
    }

    /** A bank, cash or wallet account to pay from. */
    private Account moneyAccount(Long accountId) {
        Account a = accountService.require(accountId);
        if (a.getAccountClass() != AccountClass.ASSET || !a.getAccountType().isLiquid()) throw new BusinessException("Pay from a bank, cash or wallet account");
        if (!Boolean.TRUE.equals(a.getActive())) throw new BusinessException(a.getName() + " is inactive");
        return a;
    }

    private Long loanInterest() {
        return categories.system(DefaultChartOfAccounts.LOAN_INTEREST).getId();
    }

    private String uniqueName(String name) {
        Set<String> taken = accounts.findByTenantId(UserContext.tenantId()).stream().map(a -> a.getName().toLowerCase()).collect(Collectors.toSet());
        if (!taken.contains(name.toLowerCase())) return name;
        for (int i = 2; ; i++) {
            String next = ActivityService.cut(name, 95) + " (" + i + ")";
            if (!taken.contains(next.toLowerCase())) return next;
        }
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static BigDecimal sum(List<PlanView> list, Function<PlanView, BigDecimal> f) {
        return list.stream().map(f).reduce(Money.ZERO, BigDecimal::add);
    }

    private static BigDecimal sumI(List<InstallmentView> list, Function<InstallmentView, BigDecimal> f) {
        return list.stream().map(f).reduce(Money.ZERO, BigDecimal::add);
    }
}
