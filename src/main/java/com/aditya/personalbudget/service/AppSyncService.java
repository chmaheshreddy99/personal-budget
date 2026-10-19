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
                           boolean canPayChits) {
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

    public record SyncRequest(List<@Valid SyncExpense> expenses, List<@Valid SyncChitPayment> chitPayments) {
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

    public AppSyncService(AccountService accounts, CategoryService categories, ExpenseService expenses, ReportService reports,
                          ConstructionProjectRepository projects, HostedChitRepository chits, AppSyncWriter writer, ChitService myChits) {
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
        LocalDate from = LocalDate.now().minusDays(Math.max(1, Math.min(days, 730)));
        List<AppExpense> recent = expenses.list(from, LocalDate.now().plusDays(1)).stream()
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
        return new Snapshot(LocalDateTime.now(), me.fullName(), me.tenantName(), me.currency(), list, cats, recent, from, chitList, canPay);
    }

    /** An account's statement for the app (newest last), over the last {@code days} days. */
    public Statement statement(Long accountId, int days) {
        LocalDate from = LocalDate.now().minusDays(Math.max(1, Math.min(days, 1825)));
        AccountLedger l = reports.accountLedger(accountId, from, LocalDate.of(9999, 12, 31));
        return new Statement(l.accountId(), l.name(), l.accountClass().name(), l.from(), LocalDate.now(), l.openingBalance(), l.closingBalance(),
                l.rows().stream().map(r -> new StatementRow(r.entryId(), r.entryNo(), r.date(), r.voucherLabel(), r.narration(), r.counterAccounts(),
                        r.debit(), r.credit(), r.balance())).toList());
    }

    /** The phone's expenses, each on its own: one that fails does not stop the others. */
    public List<SyncResult> sync(SyncRequest r) {
        List<SyncResult> out = new ArrayList<>();
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
        return out;
    }

}
