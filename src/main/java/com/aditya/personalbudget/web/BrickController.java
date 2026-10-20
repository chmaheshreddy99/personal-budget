package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.security.BrickAccess;
import com.aditya.personalbudget.security.BrickGuard;
import com.aditya.personalbudget.security.BrickRole;
import com.aditya.personalbudget.security.RolePolicy;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.BrickApprovalService;
import com.aditya.personalbudget.service.BrickNoticeService;
import com.aditya.personalbudget.security.BrickPermission;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.BrickInsightService;
import com.aditya.personalbudget.service.BrickPayrollService;
import com.aditya.personalbudget.service.BrickProductionService;
import com.aditya.personalbudget.service.BrickSalesService;
import com.aditya.personalbudget.service.BrickService;
import com.aditya.personalbudget.service.BrickService.MaterialFlow;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Brick Management: {@code /api/bricks} (set-up, production, raw material, expenses, the team and their pay, orders and
 * deliveries, the brick book, the dashboard and reports) and the customer's side of an order link
 * ({@code /api/public/brick-orders/{token}}), which needs no sign-in: only the link's token.
 */
@RestController
public class BrickController {

    private static final String B = "/api/bricks";
    private static final String O = B + "/orders/{id}";

    private final BrickService core;
    private final BrickProductionService production;
    private final BrickPayrollService payroll;
    private final BrickSalesService sales;
    private final BrickInsightService insights;
    private final BrickApprovalService approvals;
    private final BrickNoticeService notices;
    private final BrickAccess access;
    private final AppUserRepository users;
    private final com.aditya.personalbudget.repository.AccountRepository accounts;
    private final com.aditya.personalbudget.service.BrickTagService tags;
    private final com.aditya.personalbudget.service.TransactionService transactions;
    private final com.aditya.personalbudget.service.ChangeReplayer replayer;

    public BrickController(BrickService core, BrickProductionService production, BrickPayrollService payroll, BrickSalesService sales,
                           BrickInsightService insights, BrickApprovalService approvals, BrickNoticeService notices, BrickAccess access,
                           AppUserRepository users, com.aditya.personalbudget.repository.AccountRepository accounts,
                           com.aditya.personalbudget.service.BrickTagService tags, com.aditya.personalbudget.service.TransactionService transactions,
                           com.aditya.personalbudget.service.ChangeReplayer replayer) {
        this.replayer = replayer;
        this.accounts = accounts;
        this.tags = tags;
        this.transactions = transactions;
        this.core = core;
        this.production = production;
        this.payroll = payroll;
        this.sales = sales;
        this.insights = insights;
        this.approvals = approvals;
        this.notices = notices;
        this.access = access;
        this.users = users;
    }

    // ---------------------------------------------------------------- access (roles), approvals, notices

    public record RoleView(String key, String label, String description, Set<BrickPermission> permissions) {
    }

    /** The signed-in user's role in Brick Management, what it lets them do, and every role there is. */
    public record AccessView(String role, String label, String description, Set<BrickPermission> permissions, List<RoleView> roles,
                             long pendingApprovals, boolean manageAccess) {
    }

    public record PersonView(Long userId, String fullName, String username, String appRole, String role, String roleLabel, boolean chosen,
                             boolean active) {
    }

    public record RoleRequest(String role) {
    }

    public record NoteRequest(@jakarta.validation.constraints.Size(max = 300) String note) {
    }

    /** An order saved with a word for the checker (when it has to wait for one). */
    public record PlaceRequest(@Valid BrickSalesService.OrderRequest order, @jakarta.validation.constraints.Size(max = 300) String note) {
    }

    @GetMapping(B + "/access")
    @RequiresPermission(Permission.VIEW)
    public AccessView access() {
        BrickRole r = access.current();
        if (r == null) r = BrickRole.MANAGER;
        boolean pending = r.allows(BrickPermission.SALES) || r.allows(BrickPermission.APPROVE);
        return new AccessView(r.name(), r.getLabel(), r.getDescription(), r.getPermissions(), roles(), pending ? approvals.pendingCount() : 0,
                UserContext.current().map(u -> RolePolicy.allows(u.role(), Permission.MANAGE_USERS)).orElse(false));
    }

    private static List<RoleView> roles() {
        return Arrays.stream(BrickRole.values()).map(x -> new RoleView(x.name(), x.getLabel(), x.getDescription(), x.getPermissions())).toList();
    }

    /** The household's users and their role here: who may do what (set by who manages users). */
    @GetMapping(B + "/people")
    @RequiresPermission(Permission.MANAGE_USERS)
    public List<PersonView> people() {
        return users.findByTenantId(UserContext.tenantId()).stream().sorted(java.util.Comparator.comparing(AppUser::getFullName, String.CASE_INSENSITIVE_ORDER))
                .map(this::person).toList();
    }

    @PutMapping(B + "/people/{userId}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public PersonView setRole(@PathVariable Long userId, @RequestBody RoleRequest r) {
        AppUser u = users.findByIdAndTenantId(userId, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("User", userId));
        BrickRole role = r == null ? null : BrickRole.parse(r.role());
        if (r != null && r.role() != null && !r.role().isBlank() && role == null) throw new BusinessException("Unknown role " + r.role());
        if (u.getId().equals(UserContext.current().map(x -> x.userId()).orElse(null)) && role != null && !role.allows(BrickPermission.SETUP)) {
            throw new BusinessException("Keep a role that can set things up for yourself, or ask another admin to change it");
        }
        u.setBrickRole(role == null ? null : role.name());
        AppUser saved = users.save(u);
        core.note("CHANGED", saved.getFullName() + " · role in Brick Management: " + access.roleOf(saved).getLabel());
        return person(saved);
    }

    private PersonView person(AppUser u) {
        BrickRole r = access.roleOf(u);
        return new PersonView(u.getId(), u.getFullName(), u.getUsername(), u.getRole() == null ? null : u.getRole().getLabel(), r.name(), r.getLabel(),
                BrickRole.parse(u.getBrickRole()) != null, !Boolean.FALSE.equals(u.getActive()));
    }

    @GetMapping(B + "/approvals")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickApprovalService.ApprovalView> approvals() {
        return approvals.list();
    }

    @GetMapping(B + "/approvals/{id}")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.ApprovalView approval(@PathVariable Long id) {
        return approvals.get(id);
    }

    @PostMapping(B + "/approvals/{id}/approve")
    @BrickGuard({BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.ApprovalView approve(@PathVariable Long id, @Valid @RequestBody(required = false) BrickApprovalService.DecideRequest d) {
        // a change to what is recorded is approved by making it, as it was asked
        if (approvals.isChange(id)) {
            replayer.approve(id, d == null ? null : d.note());
            return approvals.get(id);
        }
        return approvals.approve(id, d);
    }

    @PostMapping(B + "/approvals/{id}/reject")
    @BrickGuard({BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.ApprovalView reject(@PathVariable Long id, @Valid @RequestBody(required = false) BrickApprovalService.DecideRequest d) {
        return approvals.reject(id, d);
    }

    /** The maker answers a rejection (a comment, evidence attached to the request) and sends it again. */
    @PostMapping(B + "/approvals/{id}/resubmit")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.ApprovalView resubmit(@PathVariable Long id, @Valid @RequestBody BrickApprovalService.DecideRequest d) {
        return approvals.resubmit(id, d);
    }

    @PostMapping(B + "/approvals/{id}/withdraw")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.ApprovalView withdraw(@PathVariable Long id) {
        return approvals.withdraw(id);
    }

    /** The money accounts brick money moves through, to pick from (no balances: a picker needs none). */
    public record MoneyAccount(Long id, String name, String accountClass, String accountType, boolean active, boolean brickBook,
                               boolean chitBook, boolean projectBook) {
    }

    @GetMapping(B + "/money-accounts")
    @BrickGuard({BrickPermission.PRODUCTION, BrickPermission.PURCHASES, BrickPermission.SALES, BrickPermission.FINANCE, BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public List<MoneyAccount> moneyAccounts() {
        return accounts.findByTenantId(UserContext.tenantId()).stream()
                .map(a -> new MoneyAccount(a.getId(), a.getName(), a.getAccountClass() == null ? null : a.getAccountClass().name(),
                        a.getAccountType() == null ? null : a.getAccountType().name(), Boolean.TRUE.equals(a.getActive()), a.isBrickBook(), a.isChitBook(), a.isProjectBook()))
                .toList();
    }

    public record EntryLine(String accountName, BigDecimal debit, BigDecimal credit, String memo, BigDecimal balanceAfter) {
    }

    /** A journal entry of the brick business (only its own), as its records show it; account balances only for who sees the money. */
    public record BrickEntry(Long id, String entryNo, LocalDate entryDate, String voucherLabel, String narration, String reference,
                             String createdBy, java.time.LocalDateTime createdAt, String reversedBy, String reversalOf, List<EntryLine> lines) {
    }

    @GetMapping(B + "/entries/{id}")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.PRODUCTION, BrickPermission.PURCHASES, BrickPermission.SALES, BrickPermission.FINANCE, BrickPermission.APPROVE, BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickEntry entry(@PathVariable Long id) {
        if (!tags.forEntryIds(List.of(id)).containsKey(id)) throw new NotFoundException("Entry", id);
        var e = transactions.get(id);
        boolean money = access.allows(BrickPermission.FINANCE);
        return new BrickEntry(e.id(), e.entryNo(), e.entryDate(), e.voucherLabel(), e.narration(), e.reference(), e.createdBy(), e.createdAt(),
                e.reversedBy(), e.reversalOf(), e.lines().stream().map(l -> new EntryLine(l.accountName(), l.debit(), l.credit(), l.memo(),
                money ? l.balanceAfter() : null)).toList());
    }

    @GetMapping(B + "/notices")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickNoticeService.NoticeView> notices() {
        return notices.recent();
    }

    public record SeenRequest(String link) {
    }

    /** One notice seen. */
    @PostMapping(B + "/notices/{id}/read")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public Map<String, Integer> readNotice(@PathVariable Long id) {
        return Map.of("read", notices.read(id));
    }

    /** Every notice cleared. */
    @PostMapping(B + "/notices/read-all")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public Map<String, Integer> readAllNotices() {
        return Map.of("read", notices.readAll());
    }

    /** What notices are about was opened (an order, a request): they are seen. */
    @PostMapping(B + "/notices/seen")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public Map<String, Integer> seenNotices(@RequestBody SeenRequest r) {
        return Map.of("read", notices.seen(r == null ? null : r.link()));
    }

    // ---------------------------------------------------------------- set-up

    @GetMapping(B + "/meta")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.PRODUCTION, BrickPermission.PURCHASES, BrickPermission.SALES, BrickPermission.FINANCE, BrickPermission.APPROVE, BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta meta() {
        return core.meta();
    }

    /** Sets the business up the first time the section is opened (brick types, raw materials, a pricing model, the cash). */
    @PostMapping(B + "/start")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta start() {
        return core.start();
    }

    @PutMapping(B + "/settings")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta settings(@Valid @RequestBody BrickService.SettingsRequest r) {
        return core.updateSettings(r);
    }

    @PostMapping(B + "/types")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta addType(@Valid @RequestBody BrickService.TypeRequest r) {
        return core.saveType(null, r);
    }

    @PutMapping(B + "/types/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta saveType(@PathVariable Long id, @Valid @RequestBody BrickService.TypeRequest r) {
        return core.saveType(id, r);
    }

    @DeleteMapping(B + "/types/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta deleteType(@PathVariable Long id) {
        return core.deleteType(id);
    }

    @PostMapping(B + "/materials")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta addMaterial(@Valid @RequestBody BrickService.MaterialRequest r) {
        return core.saveMaterial(null, r);
    }

    @PutMapping(B + "/materials/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta saveMaterial(@PathVariable Long id, @Valid @RequestBody BrickService.MaterialRequest r) {
        return core.saveMaterial(id, r);
    }

    @DeleteMapping(B + "/materials/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta deleteMaterial(@PathVariable Long id) {
        return core.deleteMaterial(id);
    }

    @PostMapping(B + "/pricing-models")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta addModel(@Valid @RequestBody BrickService.ModelRequest r) {
        return core.saveModel(null, r);
    }

    @PutMapping(B + "/pricing-models/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta saveModel(@PathVariable Long id, @Valid @RequestBody BrickService.ModelRequest r) {
        return core.saveModel(id, r);
    }

    @DeleteMapping(B + "/pricing-models/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta deleteModel(@PathVariable Long id) {
        return core.deleteModel(id);
    }

    @PostMapping(B + "/vehicles")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta addVehicle(@Valid @RequestBody BrickService.VehicleRequest r) {
        return core.saveVehicle(null, r);
    }

    @PutMapping(B + "/vehicles/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta saveVehicle(@PathVariable Long id, @Valid @RequestBody BrickService.VehicleRequest r) {
        return core.saveVehicle(id, r);
    }

    @DeleteMapping(B + "/vehicles/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta deleteVehicle(@PathVariable Long id) {
        return core.deleteVehicle(id);
    }

    // ---------------------------------------------------------------- dashboard, reports and the book

    @GetMapping(B + "/dashboard")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickInsightService.Dashboard dashboard() {
        return insights.dashboard();
    }

    @GetMapping(B + "/report")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickInsightService.Report report(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                             @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return insights.report(from, to);
    }

    @GetMapping(B + "/book")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickService.BookAccount> book() {
        return core.book();
    }

    @PostMapping(B + "/book/accounts")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickService.BookAccount> addAccount(@Valid @RequestBody BrickService.BookAccountRequest r) {
        return core.addBookAccount(r);
    }

    @PostMapping(B + "/book/transfers")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickService.BookAccount> transfer(@Valid @RequestBody BrickService.TransferRequest r) {
        return core.transfer(r);
    }

    @GetMapping(B + "/book/accounts/{accountId}/statement")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public AccountLedger statement(@PathVariable Long accountId, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return core.statement(accountId, from, to);
    }

    // ---------------------------------------------------------------- production

    @GetMapping(B + "/production")
    @BrickGuard({BrickPermission.STOCK, BrickPermission.PRODUCTION, BrickPermission.PURCHASES, BrickPermission.SALES, BrickPermission.FINANCE, BrickPermission.APPROVE, BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.Production production() {
        BrickProductionService.Production p = production.production();
        return access.allows(BrickPermission.FINANCE) ? p : p.withoutPay();
    }

    /** Raw material for a batch being entered: opening (the batch before's closing) and received since; closing counts as typed. */
    @PostMapping(B + "/batches/preview")
    @BrickGuard({BrickPermission.PRODUCTION})
    @RequiresPermission(Permission.VIEW)
    public List<MaterialFlow> preview(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                      @RequestParam(required = false) Long batchId, @RequestBody(required = false) Map<Long, BigDecimal> closing) {
        return production.preview(date, batchId, closing);
    }

    @PostMapping(B + "/batches")
    @BrickGuard({BrickPermission.PRODUCTION})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.BatchView addBatch(@Valid @RequestBody BrickProductionService.BatchRequest r) {
        return production.saveBatch(null, r);
    }

    @PutMapping(B + "/batches/{id}")
    @BrickGuard({BrickPermission.PRODUCTION})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.BatchView saveBatch(@PathVariable Long id, @Valid @RequestBody BrickProductionService.BatchRequest r) {
        return production.saveBatch(id, r);
    }

    @DeleteMapping(B + "/batches/{id}")
    @BrickGuard({BrickPermission.PRODUCTION})
    @RequiresPermission(Permission.VIEW)
    public void deleteBatch(@PathVariable Long id) {
        production.deleteBatch(id);
    }

    @PostMapping(B + "/purchases/bill")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public List<BrickProductionService.PurchaseView> addBill(@Valid @RequestBody BrickProductionService.PurchaseBill r) {
        return production.saveBill(r);
    }

    /** Works every raw material's balance out again from its purchases and counts (after a stock mismatch is shown). */
    @PostMapping(B + "/materials/recount")
    @BrickGuard({BrickPermission.PRODUCTION, BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public Map<String, Integer> recount() {
        return Map.of("changed", core.refreshMaterialStock());
    }

    @PostMapping(B + "/expense-heads")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta addHead(@RequestBody Map<String, String> r) {
        return core.addExpenseHead(r.get("name"));
    }

    @PostMapping(B + "/purchases")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.PurchaseView addPurchase(@Valid @RequestBody BrickProductionService.PurchaseRequest r) {
        return production.savePurchase(null, r);
    }

    @PutMapping(B + "/purchases/{id}")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.PurchaseView savePurchase(@PathVariable Long id, @Valid @RequestBody BrickProductionService.PurchaseRequest r) {
        return production.savePurchase(id, r);
    }

    @DeleteMapping(B + "/purchases/{id}")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public void deletePurchase(@PathVariable Long id) {
        production.deletePurchase(id);
    }

    @PostMapping(B + "/expenses")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.ExpenseView addExpense(@Valid @RequestBody BrickProductionService.ExpenseRequest r) {
        return production.saveExpense(null, r);
    }

    @PutMapping(B + "/expenses/{id}")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.ExpenseView saveExpense(@PathVariable Long id, @Valid @RequestBody BrickProductionService.ExpenseRequest r) {
        return production.saveExpense(id, r);
    }

    @DeleteMapping(B + "/expenses/{id}")
    @BrickGuard({BrickPermission.PURCHASES})
    @RequiresPermission(Permission.VIEW)
    public void deleteExpense(@PathVariable Long id) {
        production.deleteExpense(id);
    }

    // ---------------------------------------------------------------- the team and their pay

    @GetMapping(B + "/payroll")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.Payroll payroll() {
        return payroll.payroll();
    }

    @PostMapping(B + "/resources")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.ResourceView addResource(@Valid @RequestBody BrickPayrollService.ResourceRequest r) {
        return payroll.saveResource(null, r);
    }

    @PutMapping(B + "/resources/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.ResourceView saveResource(@PathVariable Long id, @Valid @RequestBody BrickPayrollService.ResourceRequest r) {
        return payroll.saveResource(id, r);
    }

    @GetMapping(B + "/resources/{id}/history")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.History resourceHistory(@PathVariable Long id) {
        return payroll.history(id);
    }

    @GetMapping(B + "/vehicles/{id}/trips")
    @BrickGuard({BrickPermission.SALES, BrickPermission.SETUP, BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.VehicleTrip> vehicleTrips(@PathVariable Long id) {
        return sales.vehicleTrips(id);
    }

    @DeleteMapping(B + "/resources/{id}")
    @BrickGuard({BrickPermission.SETUP})
    @RequiresPermission(Permission.VIEW)
    public void deleteResource(@PathVariable Long id) {
        payroll.deleteResource(id);
    }

    @GetMapping(B + "/payroll/run")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickPayrollService.Preview> run(@RequestParam String cycle, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                 @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return payroll.run(cycle, from, to);
    }

    @GetMapping(B + "/payroll/preview")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.Preview preview(@RequestParam Long resourceId, @RequestParam String cycle,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return payroll.preview(resourceId, cycle, from, to);
    }

    @PostMapping(B + "/payroll/slips")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.SlipView pay(@Valid @RequestBody BrickPayrollService.SlipRequest r) {
        return payroll.pay(r);
    }

    @PostMapping(B + "/payroll/advances")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.SlipView advance(@Valid @RequestBody BrickPayrollService.AdvanceRequest r) {
        return payroll.advance(r);
    }

    @GetMapping(B + "/payroll/slips/{id}")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.SlipView slip(@PathVariable Long id) {
        return payroll.slip(id);
    }

    @PostMapping(B + "/payroll/slips/{id}/cancel")
    @BrickGuard({BrickPermission.FINANCE})
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.SlipView cancel(@PathVariable Long id) {
        return payroll.cancel(id);
    }

    // ---------------------------------------------------------------- orders and deliveries

    @GetMapping(B + "/orders")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.OrderRow> orders() {
        return sales.orders();
    }

    @GetMapping(B + "/customers")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.Customer> customers() {
        return sales.customers();
    }

    @PostMapping(B + "/orders")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.Outcome create(@Valid @RequestBody PlaceRequest r) {
        if (r.order() == null) throw new BusinessException("The order is missing");
        return approvals.place(r.order(), r.note());
    }

    @GetMapping(O)
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView order(@PathVariable Long id) {
        return sales.order(id);
    }

    @PutMapping(O)
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.Outcome update(@PathVariable Long id, @Valid @RequestBody PlaceRequest r) {
        if (r.order() == null) throw new BusinessException("The order is missing");
        return approvals.change(id, r.order(), r.note());
    }

    @PostMapping(O + "/cancel")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.Outcome cancelOrder(@PathVariable Long id, @Valid @RequestBody(required = false) NoteRequest r) {
        return approvals.cancel(id, r == null ? null : r.note());
    }

    @PostMapping(O + "/waive")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickApprovalService.Outcome waive(@PathVariable Long id, @Valid @RequestBody BrickSalesService.WaiveRequest r) {
        return approvals.waive(id, r);
    }

    @PostMapping(O + "/replan")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView replan(@PathVariable Long id) {
        return sales.replanOrder(id);
    }

    @PostMapping(O + "/trips")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView addTrip(@PathVariable Long id) {
        return sales.addTrip(id);
    }

    @PutMapping(O + "/trips/{tripId}")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView editTrip(@PathVariable Long id, @PathVariable Long tripId, @Valid @RequestBody BrickSalesService.TripRequest r) {
        return sales.editTrip(id, tripId, r);
    }

    @PostMapping(O + "/trips/{tripId}/step")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView step(@PathVariable Long id, @PathVariable Long tripId, @Valid @RequestBody BrickSalesService.StepRequest r) {
        return sales.step(id, tripId, r);
    }

    @DeleteMapping(O + "/trips/{tripId}")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView cancelTrip(@PathVariable Long id, @PathVariable Long tripId) {
        return sales.cancelTrip(id, tripId);
    }

    @PostMapping(O + "/payments")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView addPayment(@PathVariable Long id, @Valid @RequestBody BrickSalesService.PaymentRequest r) {
        return sales.addPayment(id, r);
    }

    @PostMapping(O + "/payments/{paymentId}/confirm")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView confirm(@PathVariable Long id, @PathVariable Long paymentId, @RequestBody BrickSalesService.ConfirmRequest r) {
        return sales.confirmPayment(id, paymentId, r);
    }

    @DeleteMapping(O + "/payments/{paymentId}")
    @BrickGuard({BrickPermission.SALES, BrickPermission.FINANCE, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView deletePayment(@PathVariable Long id, @PathVariable Long paymentId) {
        return sales.deletePayment(id, paymentId);
    }

    @PostMapping(O + "/links")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.CreatedLink link(@PathVariable Long id, @Valid @RequestBody BrickSalesService.LinkRequest r) {
        return sales.createLink(id, r);
    }

    @PostMapping(O + "/trips/{tripId}/split")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView split(@PathVariable Long id, @PathVariable Long tripId, @Valid @RequestBody BrickSalesService.SplitRequest r) {
        return sales.splitTrip(id, tripId, r);
    }

    @GetMapping(O + "/bill.pdf")
    @BrickGuard({BrickPermission.SALES, BrickPermission.APPROVE})
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> billPdf(@PathVariable Long id) {
        return pdf(sales.billPdf(id), sales.billFileName(id));
    }

    @DeleteMapping(O + "/links/{linkId}")
    @BrickGuard({BrickPermission.SALES})
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView revoke(@PathVariable Long id, @PathVariable Long linkId) {
        return sales.revokeLink(id, linkId);
    }

    // ---------------------------------------------------------------- the customer (no sign-in)

    @PostMapping("/api/public/brick-orders/{token}")
    public ResponseEntity<BrickSalesService.PublicOrder> open(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sales.open(token));
    }

    @PostMapping("/api/public/brick-orders/{token}/acknowledge")
    public ResponseEntity<BrickSalesService.PublicOrder> acknowledge(@PathVariable String token, @Valid @RequestBody BrickSalesService.AckRequest r,
                                                                     HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sales.acknowledge(token, r, ip, http.getHeader("User-Agent")));
    }

    @GetMapping("/api/public/brick-orders/{token}/bill.pdf")
    public ResponseEntity<byte[]> publicBill(@PathVariable String token) {
        return pdf(sales.publicBillPdf(token), "Bill.pdf");
    }

    @PostMapping("/api/public/brick-orders/{token}/location")
    public ResponseEntity<BrickSalesService.PublicOrder> location(@PathVariable String token, @Valid @RequestBody BrickSalesService.LocationRequest r) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sales.shareLocation(token, r));
    }

    private static ResponseEntity<byte[]> pdf(byte[] bytes, String name) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(org.springframework.http.MediaType.APPLICATION_PDF)
                .header("Content-Disposition", org.springframework.http.ContentDisposition.inline().filename(name).build().toString()).body(bytes);
    }

    @PostMapping("/api/public/brick-orders/{token}/paid")
    public ResponseEntity<BrickSalesService.PublicOrder> paid(@PathVariable String token, @Valid @RequestBody BrickSalesService.PaidRequest r) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sales.reportPaid(token, r));
    }
}
