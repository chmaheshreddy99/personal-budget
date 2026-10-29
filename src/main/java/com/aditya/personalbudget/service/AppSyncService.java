package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.ConstructionProjectRepository;
import com.aditya.personalbudget.repository.HostedChitRepository;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The phone app ({@code mobile-app/}): one snapshot with everything it keeps for working offline (every account
 * with its balance, grouped as my own, construction, hosted chits and EMIs; the expense and income categories; the
 * latest expenses), account statements, and the expenses it recorded offline synced in a batch. Each synced expense
 * carries the id the app gave it; the id is remembered for good, so an expense sent twice is booked once.
 */
@Service
public class AppSyncService {

    /** An account as the app shows it. group: OWN, CONSTRUCTION, HOSTED_CHIT or EMI; groupName: the project or chit. */
    public record AppAccount(Long id, String name, String type, String typeLabel, String accountClass, String group, String groupName,
                             String institution, String last4, BigDecimal balance, BigDecimal creditLimit, BigDecimal availableCredit,
                             BigDecimal monthIn, BigDecimal monthOut, LocalDate lastActivity, boolean payFrom, boolean system) {
    }

    /** kind: EXPENSE or INCOME. */
    public record AppCategory(Long id, String kind, String code, String name, String description, boolean system, long uses) {
    }

    public record AppExpense(Long entryId, String entryNo, LocalDate date, String narration, String party, String reference,
                             Long categoryId, String categoryName, BigDecimal amount, Long paidFromId, String paidFrom, String status) {
    }

    public record AppInstallment(Long id, int no, LocalDate dueDate, BigDecimal dueAmount, BigDecimal dividend, BigDecimal paidAmount,
                                 LocalDate paidDate, String status, boolean overdue, String paidFrom, Long entryId) {
    }

    /** A chit the user is a member of (Chits), with its instalments. */
    public record AppChit(Long id, String name, String organizer, String ticketNo, String status, BigDecimal monthlyInstallment, int months,
                          int paidCount, int pendingCount, int overdueCount, BigDecimal overdueAmount, LocalDate nextDueDate,
                          BigDecimal nextDueAmount, BigDecimal paidIn, BigDecimal dividends, BigDecimal stillToPay, BigDecimal currentValue,
                          BigDecimal maturityAmount, LocalDate maturityDate, Long defaultPaymentAccountId, BigDecimal progressPercent,
                          List<AppInstallment> installments, String organizerUpi, String upiNote) {
    }

    public record Snapshot(LocalDateTime serverTime, String user, String household, String currency, List<AppAccount> accounts,
                           List<AppCategory> categories, List<AppExpense> expenses, LocalDate expensesFrom, List<AppChit> chits,
                           boolean canPayChits,
                           /* the sections shared with the user (EXPENSES, INCOME, GIFTS ...) and whether they may record */
                           Set<String> features, boolean canRecord,
                           /* money owed to me (paid for someone, lent) and by me, with what came back */
                           List<AppClaim> claims,
                           /* EMIs running, with their instalments */
                           List<AppEmi> emis,
                           /* income received in the period */
                           List<AppIncome> incomes,
                           /* gifts given and received */
                           List<AppGift> gifts,
                           /* what this household allows the app to do and show (Settings > Mobile app on the web) */
                           AppSettingsService.MobileConfig mobile) {
    }

    /** Money coming back on a claim (or written off). */
    public record AppRepayment(LocalDate date, BigDecimal principal, BigDecimal interest, String accountName, boolean writeOff) {
    }

    /** Paid for someone, lent, borrowed or a bill to pay: kind LENT, PAID_FOR (owed to me), BORROWED, BILL_DUE (owed by me). */
    public record AppClaim(Long id, String kind, String kindLabel, String party, String narration, BigDecimal amount, LocalDate date,
                           LocalDate dueDate, String status, String statusLabel, boolean overdue, BigDecimal outstanding, BigDecimal repaid,
                           BigDecimal interestRate, BigDecimal interestDue, String accountName, String entryNo, String reference, String notes,
                           LocalDate lastPaymentDate, List<AppRepayment> repayments,
                           /* what the money could have earned in the bank while it was out (items without interest), at benchmarkRate a year */
                           BigDecimal forgoneInterest, BigDecimal benchmarkRate) {
    }

    public record AppEmiInstalment(int seq, LocalDate dueDate, BigDecimal emi, String status, boolean overdue, LocalDate paidOn) {
    }

    /** An EMI plan: kind CARD (paid with the card) or LOAN. */
    public record AppEmi(Long id, String kind, String narration, String lender, BigDecimal emiAmount, int months, int paidCount, int left,
                         int dueNow, BigDecimal outstanding, BigDecimal stillToPay, BigDecimal overdueAmount, LocalDate nextDueDate,
                         BigDecimal nextAmount, Long payAccountId, String payAccountName, String payAccountType, int progressPercent,
                         LocalDate endDate, List<AppEmiInstalment> instalments) {
    }

    public record AppIncome(Long entryId, String entryNo, LocalDate date, String narration, String party, String reference,
                            Long categoryId, String categoryName, BigDecimal amount, Long intoId, String into) {
    }

    /** A gift given or received (direction GIVEN / RECEIVED; kind CASH, GOLD, SILVER, ITEM, OTHER). */
    public record AppGift(Long id, String direction, LocalDate date, String person, String relation, String occasion, String kind,
                          String description, BigDecimal value, BigDecimal quantity, String unit, String mode, boolean donation,
                          String notes, String accountName, String entryNo) {
    }

    /** An expense recorded on the phone: clientId is the app's own id for it. */
    public record SyncExpense(@NotBlank @Size(max = 64) String clientId, @NotNull LocalDate date, @NotNull @Positive BigDecimal amount,
                              @NotNull Long categoryId, @NotNull Long paidFromId, @Size(max = 255) String narration,
                              @Size(max = 100) String party, @Size(max = 60) String reference, @Size(max = 255) String notes) {
    }

    /** A chit instalment paid on the phone: clientId is the app's own id for the payment. */
    public record SyncChitPayment(@NotBlank @Size(max = 64) String clientId, @NotNull Long chitId, @NotNull Long installmentId,
                                  LocalDate paidDate, @NotNull Long fromAccountId, BigDecimal dividend) {
    }

    /** Paid for someone (PAID_FOR) or lent (LENT) on the phone: the money left paidFromId. */
    public record SyncClaim(@NotBlank @Size(max = 64) String clientId, @NotBlank String kind, @NotBlank @Size(max = 100) String party,
                            @Size(max = 255) String narration, @NotNull @Positive BigDecimal amount, @NotNull LocalDate date,
                            LocalDate dueDate, @NotNull Long paidFromId, BigDecimal interestRate, @Size(max = 60) String reference,
                            @Size(max = 500) String notes) {
    }

    /** Money received back on a claim (principal, and interest on money lent), into accountId. */
    public record SyncRepayment(@NotBlank @Size(max = 64) String clientId, @NotNull Long claimId, @NotNull LocalDate date,
                                @NotNull BigDecimal principal, BigDecimal interest, @NotNull Long accountId, @Size(max = 255) String notes) {
    }

    /** Income received on the phone, into intoId. */
    public record SyncIncome(@NotBlank @Size(max = 64) String clientId, @NotNull LocalDate date, @NotNull @Positive BigDecimal amount,
                             @NotNull Long categoryId, @NotNull Long intoId, @Size(max = 255) String narration,
                             @Size(max = 100) String party, @Size(max = 60) String reference) {
    }

    /** A gift recorded on the phone; cash given can be booked as an expense from bookAccountId in bookCategoryId. */
    public record SyncGift(@NotBlank @Size(max = 64) String clientId, @NotBlank String direction, @NotNull LocalDate date,
                           @NotBlank @Size(max = 100) String person, @Size(max = 40) String relation, @Size(max = 60) String occasion,
                           @NotBlank String kind, @Size(max = 255) String description, BigDecimal value, BigDecimal quantity,
                           @Size(max = 10) String unit, @Size(max = 20) String mode, Boolean donation, @Size(max = 255) String notes,
                           Long bookAccountId, Long bookCategoryId) {
    }

    /** EMIs paid on the phone: the next {@code count} of a plan, from accountId (a card EMI: the bank paying into the card). */
    public record SyncEmiPayment(@NotBlank @Size(max = 64) String clientId, @NotNull Long planId, Integer count, LocalDate date,
                                 Long accountId) {
    }

    /** Money moved between two of my accounts (bank to cash, a card bill paid ...). */
    public record SyncTransfer(@NotBlank @Size(max = 64) String clientId, @NotNull LocalDate date, @NotNull @Positive BigDecimal amount,
                               @NotNull Long fromId, @NotNull Long toId, @Size(max = 255) String narration, @Size(max = 60) String reference) {
    }

    public record SyncRequest(List<@Valid SyncExpense> expenses, List<@Valid SyncChitPayment> chitPayments,
                              List<@Valid SyncClaim> claims, List<@Valid SyncRepayment> repayments, List<@Valid SyncIncome> incomes,
                              List<@Valid SyncGift> gifts, List<@Valid SyncEmiPayment> emiPayments, List<@Valid SyncTransfer> transfers) {

        public SyncRequest(List<SyncExpense> expenses, List<SyncChitPayment> chitPayments, List<SyncClaim> claims, List<SyncRepayment> repayments,
                           List<SyncIncome> incomes, List<SyncGift> gifts, List<SyncEmiPayment> emiPayments) {
            this(expenses, chitPayments, claims, repayments, incomes, gifts, emiPayments, null);
        }

        public SyncRequest(List<SyncExpense> expenses, List<SyncChitPayment> chitPayments) {
            this(expenses, chitPayments, null, null, null, null, null, null);
        }
    }

    /**
     * status: CREATED, DUPLICATE (synced before, or the instalment was already paid), PENDING (waits for approval:
     * pendingId, for its evidence) or FAILED (message says why).
     */
    public record SyncResult(String clientId, String status, Long entryId, String entryNo, String message, Long pendingId) {
    }

    public record StatementRow(Long entryId, String entryNo, LocalDate date, String voucher, String narration, String other,
                               BigDecimal debit, BigDecimal credit, BigDecimal balance) {
    }

    public record Statement(Long accountId, String name, String accountClass, LocalDate from, LocalDate to, BigDecimal opening,
                            BigDecimal closing, List<StatementRow> rows) {
    }

    private final AccountService accounts;
    private final CategoryService categories;
    private final ExpenseService expenses;
    private final ReportService reports;
    private final ConstructionProjectRepository projects;
    private final HostedChitRepository chits;
    private final AppSyncWriter writer;
    private final ChitService myChits;
    private final ClaimService claims;
    private final EmiService emis;
    private final GiftService gifts;
    private final TransactionService transactions;
    private final AppSettingsService settings;

    public AppSyncService(AccountService accounts, CategoryService categories, ExpenseService expenses, ReportService reports,
                          ConstructionProjectRepository projects, HostedChitRepository chits, AppSyncWriter writer, ChitService myChits,
                          ClaimService claims, EmiService emis, GiftService gifts, TransactionService transactions, AppSettingsService settings) {
        this.settings = settings;
        this.claims = claims;
        this.emis = emis;
        this.gifts = gifts;
        this.transactions = transactions;
        this.myChits = myChits;
        this.accounts = accounts;
        this.categories = categories;
        this.expenses = expenses;
        this.reports = reports;
        this.projects = projects;
        this.chits = chits;
        this.writer = writer;
    }

    /** What the app keeps: every account, the expense and income categories and the expenses of the last {@code days} days. */
    public Snapshot snapshot(int days) {
        Long tenant = UserContext.tenantId();
        Map<Long, String> projectName = projects.findByTenantId(tenant).stream().collect(Collectors.toMap(ConstructionProject::getId, ConstructionProject::getName));
        Map<Long, String> chitName = chits.findByTenantId(tenant).stream().collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        Set<AccountClass> shown = Set.of(AccountClass.ASSET, AccountClass.LIABILITY);
        Set<String> payTypes = Set.of("BANK", "CREDIT_CARD", "CASH", "WALLET", "PAYABLE");
        List<AppAccount> list = new ArrayList<>();
        for (AccountView a : accounts.list()) {
            if (!a.active() || !shown.contains(a.accountClass())) continue;
            String group = a.emiAccount() ? "EMI" : a.projectBook() ? "CONSTRUCTION" : a.chitBook() ? "HOSTED_CHIT" : "OWN";
            String groupName = a.projectBook() ? (a.projectId() == null ? "Common business accounts" : projectName.getOrDefault(a.projectId(), "Construction"))
                    : a.chitBook() ? (a.hostedChitId() == null ? "Common chit accounts" : chitName.getOrDefault(a.hostedChitId(), "Host a Chit")) : null;
            String number = a.accountNumber();
            list.add(new AppAccount(a.id(), a.name(), a.accountType().name(), a.typeLabel(), a.accountClass().name(), group, groupName, a.institution(),
                    number == null || number.length() < 4 ? null : number.substring(number.length() - 4), a.balance(), a.creditLimit(), a.availableCredit(),
                    a.monthIn(), a.monthOut(), a.lastActivity(), "OWN".equals(group) && payTypes.contains(a.accountType().name()), a.systemAccount()));
        }
        // expense categories first (the order the app offers them in), then income
        List<AppCategory> cats = categories.list().stream().filter(c -> c.active() && (c.kind() == CategoryKind.EXPENSE || c.kind() == CategoryKind.INCOME))
                .map(c -> new AppCategory(c.id(), c.kind().name(), c.code(), c.name(), c.description(), c.system(), c.entries()))
                .sorted(Comparator.comparing((AppCategory c) -> !"EXPENSE".equals(c.kind())).thenComparing(AppCategory::system)
                        .thenComparing(AppCategory::uses, Comparator.reverseOrder()).thenComparing(AppCategory::name))
                .toList();
        LocalDate from = OrgClock.today().minusDays(Math.max(1, Math.min(days, 730)));
        List<AppExpense> recent = expenses.list(from, OrgClock.today().plusDays(1)).stream()
                .map(r -> new AppExpense(r.entryId(), r.entryNo(), r.date(), r.narration(), r.party(), r.reference(), r.categoryId(), r.categoryName(),
                        r.netAmount() != null ? r.netAmount() : r.amount(), r.paidFromId(), r.paidFrom(), r.status())).toList();
        var me = UserContext.get();
        boolean seesChits = me.features().contains(com.aditya.personalbudget.domain.type.Feature.CHITS);
        List<AppChit> chitList = !seesChits ? List.of() : myChits.list().stream().filter(c -> c.closedAt() == null).map(c -> {
            var d = myChits.detail(c.id());
            return new AppChit(c.id(), c.name(), c.organizer(), c.ticketNo(), c.status().name(), c.monthlyInstallment(), c.numberOfInstallments(),
                    c.installmentsPaid(), c.installmentsPending(), c.overdueCount(), c.overdueAmount(), c.nextDueDate(), c.nextDueAmount(),
                    c.paidIn(), c.dividendsEarned(), c.stillToPay(), c.currentValue(), c.maturityAmount(), c.maturityDate(),
                    c.defaultPaymentAccountId(), c.progressPercent(),
                    d.installments().stream().map(i -> new AppInstallment(i.id(), i.installmentNo(), i.dueDate(), i.dueAmount(), i.dividend(),
                            i.paidAmount(), i.paidDate(), i.status().name(), i.overdue(), i.paidFromAccountName(), i.journalEntryId())).toList(),
                    c.organizerUpi(), c.upiNote());
        }).toList();
        boolean canPay = seesChits && com.aditya.personalbudget.security.RolePolicy.allows(me.role(), com.aditya.personalbudget.security.Permission.MANAGE_CHITS);
        Set<com.aditya.personalbudget.domain.type.Feature> f = me.features();
        boolean canRecord = com.aditya.personalbudget.security.RolePolicy.allows(me.role(), com.aditya.personalbudget.security.Permission.POST_TRANSACTIONS);
        List<AppClaim> claimList = !f.contains(com.aditya.personalbudget.domain.type.Feature.EXPENSES) ? List.of() : claims.list().stream()
                .filter(c -> c.status() != com.aditya.personalbudget.domain.type.ClaimStatus.SETTLED
                        && c.status() != com.aditya.personalbudget.domain.type.ClaimStatus.WRITTEN_OFF || !c.startDate().isBefore(from))
                .map(c -> new AppClaim(c.id(), c.kind().name(), c.kindLabel(), c.party(), c.narration(), c.amount(), c.startDate(), c.dueDate(),
                        c.status().name(), c.statusLabel(), c.overdue(), c.outstanding(), c.repaid(), c.interestRate(), c.interestDue(),
                        c.paidFromAccount(), c.entryNo(), c.reference(), c.notes(), c.lastPaymentDate(),
                        c.repayments().stream().map(r -> new AppRepayment(r.paidDate(), r.principal(), r.interest(), r.accountName(), r.writeOff())).toList(),
                        c.forgoneInterest(), c.benchmarkRate()))
                .toList();
        List<AppEmi> emiList = !f.contains(com.aditya.personalbudget.domain.type.Feature.EXPENSES) ? List.of() : emis.book(false).plans().stream()
                .map(p -> new AppEmi(p.id(), p.kind(), p.narration(), p.lender(), p.emiAmount(), p.months(), p.paidCount(), p.left(), p.dueNow(),
                        p.outstanding(), p.stillToPay(), p.overdueAmount(), p.next() == null ? null : p.next().dueDate(),
                        p.next() == null ? null : p.next().emi(), p.payAccountId(), p.payAccountName(), p.payAccountType(), p.progressPercent(),
                        p.endDate(), p.installments().stream().map(i -> new AppEmiInstalment(i.seq(), i.dueDate(), i.emi(), i.status(), i.overdue(),
                                i.paidOn())).toList()))
                .toList();
        List<AppIncome> incomeList = !f.contains(com.aditya.personalbudget.domain.type.Feature.INCOME) ? List.of() : incomes(from, cats);
        List<AppGift> giftList = !f.contains(com.aditya.personalbudget.domain.type.Feature.GIFTS) ? List.of() : gifts.list().stream()
                .map(g -> new AppGift(g.id(), g.direction(), g.giftDate(), g.person(), g.relation(), g.occasion(), g.kind(), g.description(),
                        g.value(), g.quantity(), g.unit(), g.mode(), g.donation(), g.notes(), g.accountName(), g.entryNo()))
                .toList();
        return new Snapshot(OrgClock.now(), me.fullName(), me.tenantName(), me.currency(), list, cats, recent, from, chitList, canPay,
                f.stream().map(Enum::name).collect(Collectors.toSet()), canRecord, claimList, emiList, incomeList, giftList, settings.mobileConfig(tenant));
    }

    /** The income received since {@code from}: entries that credit an income category, into the account they debit. */
    private List<AppIncome> incomes(LocalDate from, List<AppCategory> cats) {
        Map<Long, String> catName = cats.stream().collect(Collectors.toMap(AppCategory::id, AppCategory::name, (a, b) -> a));
        List<AppIncome> out = new ArrayList<>();
        for (var e : transactions.search(from, OrgClock.today().plusDays(1), com.aditya.personalbudget.domain.type.VoucherType.INCOME, null, null, 2000)) {
            if (e.reversedBy() != null) continue;
            var income = e.lines().stream().filter(l -> l.accountClass() == AccountClass.INCOME && l.credit() != null && l.credit().signum() > 0).findFirst();
            var into = e.lines().stream().filter(l -> l.accountClass() != AccountClass.INCOME && l.debit() != null && l.debit().signum() > 0).findFirst();
            if (income.isEmpty()) continue;
            Long cat = income.get().categoryId();
            out.add(new AppIncome(e.id(), e.entryNo(), e.entryDate(), e.narration(), e.party(), e.reference(), cat,
                    cat == null ? income.get().accountName() : catName.getOrDefault(cat, income.get().accountName()), e.amount(),
                    into.map(l -> l.accountId()).orElse(null), into.map(l -> l.accountName()).orElse(null)));
        }
        return out;
    }

    /** Writes each item on its own (in its own transaction): one that is refused does not stop the others. */
    private static <T> void each(List<SyncResult> out, List<T> items, java.util.function.Function<T, String> id,
                                 java.util.function.Function<T, SyncResult> write) {
        for (T item : items == null ? List.<T>of() : items) {
            try {
                out.add(write.apply(item));
            } catch (BusinessException | jakarta.validation.ValidationException | com.aditya.personalbudget.exception.NotFoundException
                     | com.aditya.personalbudget.exception.ForbiddenException ex) {
                out.add(new SyncResult(id.apply(item), "FAILED", null, null, ex.getMessage(), null));
            }
        }
    }

    /** An account's statement for the app (newest last), over the last {@code days} days. */
    public Statement statement(Long accountId, int days) {
        LocalDate from = OrgClock.today().minusDays(Math.max(1, Math.min(days, 1825)));
        AccountLedger l = reports.accountLedger(accountId, from, LocalDate.of(9999, 12, 31));
        return new Statement(l.accountId(), l.name(), l.accountClass().name(), l.from(), OrgClock.today(), l.openingBalance(), l.closingBalance(),
                l.rows().stream().map(r -> new StatementRow(r.entryId(), r.entryNo(), r.date(), r.voucherLabel(), r.narration(), r.counterAccounts(),
                        r.debit(), r.credit(), r.balance())).toList());
    }

    /** The phone's expenses, each on its own: one that fails does not stop the others. */
    public List<SyncResult> sync(SyncRequest r) {
        List<SyncResult> out = new ArrayList<>();
        // a section switched off in Settings > Mobile app is refused here, whatever an older copy of the app still offers
        var allowed = settings.mobileConfig(UserContext.tenantId()).features();
        r = new SyncRequest(off(out, allowed, "EXPENSES", r.expenses(), SyncExpense::clientId), off(out, allowed, "CHITS", r.chitPayments(), SyncChitPayment::clientId),
                off(out, allowed, "CLAIMS", r.claims(), SyncClaim::clientId), off(out, allowed, "CLAIMS", r.repayments(), SyncRepayment::clientId),
                off(out, allowed, "INCOME", r.incomes(), SyncIncome::clientId), off(out, allowed, "GIFTS", r.gifts(), SyncGift::clientId),
                off(out, allowed, "EMIS", r.emiPayments(), SyncEmiPayment::clientId), off(out, allowed, "TRANSFERS", r.transfers(), SyncTransfer::clientId));
        for (SyncExpense e : r.expenses() == null ? List.<SyncExpense>of() : r.expenses()) {
            try {
                out.add(writer.write(e));
            } catch (BusinessException | jakarta.validation.ValidationException | com.aditya.personalbudget.exception.NotFoundException ex) {
                out.add(new SyncResult(e.clientId(), "FAILED", null, null, ex.getMessage(), null));
            }
        }
        for (SyncChitPayment c : r.chitPayments() == null ? List.<SyncChitPayment>of() : r.chitPayments()) {
            try {
                out.add(writer.writeChit(c));
            } catch (BusinessException | jakarta.validation.ValidationException | com.aditya.personalbudget.exception.NotFoundException ex) {
                out.add(new SyncResult(c.clientId(), "FAILED", null, null, ex.getMessage(), null));
            }
        }
        // claims first: a repayment sent in the same batch may be on a claim recorded on the phone before (synced earlier)
        each(out, r.claims(), SyncClaim::clientId, writer::writeClaim);
        each(out, r.repayments(), SyncRepayment::clientId, writer::writeRepayment);
        each(out, r.incomes(), SyncIncome::clientId, writer::writeIncome);
        each(out, r.gifts(), SyncGift::clientId, writer::writeGift);
        each(out, r.emiPayments(), SyncEmiPayment::clientId, writer::writeEmiPayment);
        each(out, r.transfers(), SyncTransfer::clientId, writer::writeTransfer);
        return out;
    }

    /** The items of a section that is switched off answer FAILED and are dropped; the rest of the list goes on. */
    private static <T> List<T> off(List<SyncResult> out, java.util.Set<String> allowed, String section, List<T> items, java.util.function.Function<T, String> id) {
        if (items == null || allowed.contains(section)) return items;
        for (T item : items) out.add(new SyncResult(id.apply(item), "FAILED", null, null, "This is switched off for the phone app in Settings > Mobile app on the web", null));
        return List.of();
    }

}
