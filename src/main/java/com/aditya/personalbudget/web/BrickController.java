package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
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
import java.util.List;
import java.util.Map;

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

    public BrickController(BrickService core, BrickProductionService production, BrickPayrollService payroll, BrickSalesService sales,
                           BrickInsightService insights) {
        this.core = core;
        this.production = production;
        this.payroll = payroll;
        this.sales = sales;
        this.insights = insights;
    }

    // ---------------------------------------------------------------- set-up

    @GetMapping(B + "/meta")
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta meta() {
        return core.meta();
    }

    /** Sets the business up the first time the section is opened (brick types, raw materials, a pricing model, the cash). */
    @PostMapping(B + "/start")
    @RequiresPermission(Permission.VIEW)
    public BrickService.Meta start() {
        return core.start();
    }

    @PutMapping(B + "/settings")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta settings(@Valid @RequestBody BrickService.SettingsRequest r) {
        return core.updateSettings(r);
    }

    @PostMapping(B + "/types")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta addType(@Valid @RequestBody BrickService.TypeRequest r) {
        return core.saveType(null, r);
    }

    @PutMapping(B + "/types/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta saveType(@PathVariable Long id, @Valid @RequestBody BrickService.TypeRequest r) {
        return core.saveType(id, r);
    }

    @DeleteMapping(B + "/types/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta deleteType(@PathVariable Long id) {
        return core.deleteType(id);
    }

    @PostMapping(B + "/materials")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta addMaterial(@Valid @RequestBody BrickService.MaterialRequest r) {
        return core.saveMaterial(null, r);
    }

    @PutMapping(B + "/materials/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta saveMaterial(@PathVariable Long id, @Valid @RequestBody BrickService.MaterialRequest r) {
        return core.saveMaterial(id, r);
    }

    @DeleteMapping(B + "/materials/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta deleteMaterial(@PathVariable Long id) {
        return core.deleteMaterial(id);
    }

    @PostMapping(B + "/pricing-models")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta addModel(@Valid @RequestBody BrickService.ModelRequest r) {
        return core.saveModel(null, r);
    }

    @PutMapping(B + "/pricing-models/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta saveModel(@PathVariable Long id, @Valid @RequestBody BrickService.ModelRequest r) {
        return core.saveModel(id, r);
    }

    @DeleteMapping(B + "/pricing-models/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta deleteModel(@PathVariable Long id) {
        return core.deleteModel(id);
    }

    @PostMapping(B + "/vehicles")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta addVehicle(@Valid @RequestBody BrickService.VehicleRequest r) {
        return core.saveVehicle(null, r);
    }

    @PutMapping(B + "/vehicles/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta saveVehicle(@PathVariable Long id, @Valid @RequestBody BrickService.VehicleRequest r) {
        return core.saveVehicle(id, r);
    }

    @DeleteMapping(B + "/vehicles/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickService.Meta deleteVehicle(@PathVariable Long id) {
        return core.deleteVehicle(id);
    }

    // ---------------------------------------------------------------- dashboard, reports and the book

    @GetMapping(B + "/dashboard")
    @RequiresPermission(Permission.VIEW)
    public BrickInsightService.Dashboard dashboard() {
        return insights.dashboard();
    }

    @GetMapping(B + "/report")
    @RequiresPermission(Permission.VIEW)
    public BrickInsightService.Report report(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                             @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return insights.report(from, to);
    }

    @GetMapping(B + "/book")
    @RequiresPermission(Permission.VIEW)
    public List<BrickService.BookAccount> book() {
        return core.book();
    }

    @PostMapping(B + "/book/accounts")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public List<BrickService.BookAccount> addAccount(@Valid @RequestBody BrickService.BookAccountRequest r) {
        return core.addBookAccount(r);
    }

    @PostMapping(B + "/book/transfers")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public List<BrickService.BookAccount> transfer(@Valid @RequestBody BrickService.TransferRequest r) {
        return core.transfer(r);
    }

    @GetMapping(B + "/book/accounts/{accountId}/statement")
    @RequiresPermission(Permission.VIEW)
    public AccountLedger statement(@PathVariable Long accountId, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                   @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return core.statement(accountId, from, to);
    }

    // ---------------------------------------------------------------- production

    @GetMapping(B + "/production")
    @RequiresPermission(Permission.VIEW)
    public BrickProductionService.Production production() {
        return production.production();
    }

    /** Raw material for a batch being entered: opening (the batch before's closing) and received since; closing counts as typed. */
    @PostMapping(B + "/batches/preview")
    @RequiresPermission(Permission.VIEW)
    public List<MaterialFlow> preview(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
                                      @RequestParam(required = false) Long batchId, @RequestBody(required = false) Map<Long, BigDecimal> closing) {
        return production.preview(date, batchId, closing);
    }

    @PostMapping(B + "/batches")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.BatchView addBatch(@Valid @RequestBody BrickProductionService.BatchRequest r) {
        return production.saveBatch(null, r);
    }

    @PutMapping(B + "/batches/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.BatchView saveBatch(@PathVariable Long id, @Valid @RequestBody BrickProductionService.BatchRequest r) {
        return production.saveBatch(id, r);
    }

    @DeleteMapping(B + "/batches/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public void deleteBatch(@PathVariable Long id) {
        production.deleteBatch(id);
    }

    @PostMapping(B + "/purchases")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.PurchaseView addPurchase(@Valid @RequestBody BrickProductionService.PurchaseRequest r) {
        return production.savePurchase(null, r);
    }

    @PutMapping(B + "/purchases/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.PurchaseView savePurchase(@PathVariable Long id, @Valid @RequestBody BrickProductionService.PurchaseRequest r) {
        return production.savePurchase(id, r);
    }

    @DeleteMapping(B + "/purchases/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public void deletePurchase(@PathVariable Long id) {
        production.deletePurchase(id);
    }

    @PostMapping(B + "/expenses")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.ExpenseView addExpense(@Valid @RequestBody BrickProductionService.ExpenseRequest r) {
        return production.saveExpense(null, r);
    }

    @PutMapping(B + "/expenses/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickProductionService.ExpenseView saveExpense(@PathVariable Long id, @Valid @RequestBody BrickProductionService.ExpenseRequest r) {
        return production.saveExpense(id, r);
    }

    @DeleteMapping(B + "/expenses/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public void deleteExpense(@PathVariable Long id) {
        production.deleteExpense(id);
    }

    // ---------------------------------------------------------------- the team and their pay

    @GetMapping(B + "/payroll")
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.Payroll payroll() {
        return payroll.payroll();
    }

    @PostMapping(B + "/resources")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickPayrollService.ResourceView addResource(@Valid @RequestBody BrickPayrollService.ResourceRequest r) {
        return payroll.saveResource(null, r);
    }

    @PutMapping(B + "/resources/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickPayrollService.ResourceView saveResource(@PathVariable Long id, @Valid @RequestBody BrickPayrollService.ResourceRequest r) {
        return payroll.saveResource(id, r);
    }

    @GetMapping(B + "/resources/{id}/history")
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.History resourceHistory(@PathVariable Long id) {
        return payroll.history(id);
    }

    @GetMapping(B + "/vehicles/{id}/trips")
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.VehicleTrip> vehicleTrips(@PathVariable Long id) {
        return sales.vehicleTrips(id);
    }

    @DeleteMapping(B + "/resources/{id}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public void deleteResource(@PathVariable Long id) {
        payroll.deleteResource(id);
    }

    @GetMapping(B + "/payroll/run")
    @RequiresPermission(Permission.VIEW)
    public List<BrickPayrollService.Preview> run(@RequestParam String cycle, @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                 @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return payroll.run(cycle, from, to);
    }

    @GetMapping(B + "/payroll/preview")
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.Preview preview(@RequestParam Long resourceId, @RequestParam String cycle,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                               @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return payroll.preview(resourceId, cycle, from, to);
    }

    @PostMapping(B + "/payroll/slips")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickPayrollService.SlipView pay(@Valid @RequestBody BrickPayrollService.SlipRequest r) {
        return payroll.pay(r);
    }

    @PostMapping(B + "/payroll/advances")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickPayrollService.SlipView advance(@Valid @RequestBody BrickPayrollService.AdvanceRequest r) {
        return payroll.advance(r);
    }

    @GetMapping(B + "/payroll/slips/{id}")
    @RequiresPermission(Permission.VIEW)
    public BrickPayrollService.SlipView slip(@PathVariable Long id) {
        return payroll.slip(id);
    }

    @PostMapping(B + "/payroll/slips/{id}/cancel")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickPayrollService.SlipView cancel(@PathVariable Long id) {
        return payroll.cancel(id);
    }

    // ---------------------------------------------------------------- orders and deliveries

    @GetMapping(B + "/orders")
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.OrderRow> orders() {
        return sales.orders();
    }

    @GetMapping(B + "/customers")
    @RequiresPermission(Permission.VIEW)
    public List<BrickSalesService.Customer> customers() {
        return sales.customers();
    }

    @PostMapping(B + "/orders")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView create(@Valid @RequestBody BrickSalesService.OrderRequest r) {
        return sales.create(r);
    }

    @GetMapping(O)
    @RequiresPermission(Permission.VIEW)
    public BrickSalesService.OrderView order(@PathVariable Long id) {
        return sales.order(id);
    }

    @PutMapping(O)
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView update(@PathVariable Long id, @Valid @RequestBody BrickSalesService.OrderRequest r) {
        return sales.update(id, r);
    }

    @PostMapping(O + "/cancel")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView cancelOrder(@PathVariable Long id) {
        return sales.cancel(id);
    }

    @PostMapping(O + "/waive")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView waive(@PathVariable Long id, @Valid @RequestBody BrickSalesService.WaiveRequest r) {
        return sales.waive(id, r);
    }

    @PostMapping(O + "/replan")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView replan(@PathVariable Long id) {
        return sales.replanOrder(id);
    }

    @PostMapping(O + "/trips")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView addTrip(@PathVariable Long id) {
        return sales.addTrip(id);
    }

    @PutMapping(O + "/trips/{tripId}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView editTrip(@PathVariable Long id, @PathVariable Long tripId, @Valid @RequestBody BrickSalesService.TripRequest r) {
        return sales.editTrip(id, tripId, r);
    }

    @PostMapping(O + "/trips/{tripId}/step")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView step(@PathVariable Long id, @PathVariable Long tripId, @Valid @RequestBody BrickSalesService.StepRequest r) {
        return sales.step(id, tripId, r);
    }

    @DeleteMapping(O + "/trips/{tripId}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView cancelTrip(@PathVariable Long id, @PathVariable Long tripId) {
        return sales.cancelTrip(id, tripId);
    }

    @PostMapping(O + "/payments")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView addPayment(@PathVariable Long id, @Valid @RequestBody BrickSalesService.PaymentRequest r) {
        return sales.addPayment(id, r);
    }

    @PostMapping(O + "/payments/{paymentId}/confirm")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView confirm(@PathVariable Long id, @PathVariable Long paymentId, @RequestBody BrickSalesService.ConfirmRequest r) {
        return sales.confirmPayment(id, paymentId, r);
    }

    @DeleteMapping(O + "/payments/{paymentId}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.OrderView deletePayment(@PathVariable Long id, @PathVariable Long paymentId) {
        return sales.deletePayment(id, paymentId);
    }

    @PostMapping(O + "/links")
    @RequiresPermission(Permission.MANAGE_BRICKS)
    public BrickSalesService.CreatedLink link(@PathVariable Long id, @Valid @RequestBody BrickSalesService.LinkRequest r) {
        return sales.createLink(id, r);
    }

    @DeleteMapping(O + "/links/{linkId}")
    @RequiresPermission(Permission.MANAGE_BRICKS)
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

    @PostMapping("/api/public/brick-orders/{token}/paid")
    public ResponseEntity<BrickSalesService.PublicOrder> paid(@PathVariable String token, @Valid @RequestBody BrickSalesService.PaidRequest r) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(sales.reportPaid(token, r));
    }
}
