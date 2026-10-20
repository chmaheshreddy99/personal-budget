package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.domain.entity.BrickType;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.FeaturePolicy;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BrickInsightService;
import com.aditya.personalbudget.service.BrickPayrollService;
import com.aditya.personalbudget.service.BrickPayrollService.AdvanceRequest;
import com.aditya.personalbudget.service.BrickPayrollService.DeductionInput;
import com.aditya.personalbudget.service.BrickPayrollService.ResourceRequest;
import com.aditya.personalbudget.service.BrickPayrollService.SlipRequest;
import com.aditya.personalbudget.service.BrickProductionService;
import com.aditya.personalbudget.service.BrickProductionService.BatchRequest;
import com.aditya.personalbudget.service.BrickProductionService.CountInput;
import com.aditya.personalbudget.service.BrickProductionService.ItemInput;
import com.aditya.personalbudget.service.BrickProductionService.PurchaseRequest;
import com.aditya.personalbudget.service.BrickSalesService;
import com.aditya.personalbudget.service.BrickSalesService.OrderRequest;
import com.aditya.personalbudget.service.BrickSalesService.OrderView;
import com.aditya.personalbudget.service.BrickSalesService.StepRequest;
import com.aditya.personalbudget.service.BrickSalesService.TripItemInput;
import com.aditya.personalbudget.service.BrickService;
import com.aditya.personalbudget.service.LedgerService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Brick Management: a batch made by a team (its pay, the raw material it used, the stock it adds), a customer's order
 * delivered in two trips (the second short of a few broken bricks) and paid by UPI, the team's weekly slip less part of
 * an advance, a batch that cannot be paid twice, and the customer signing for a trip on the order link.
 */
@SpringBootTest
class BrickTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-brick-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired BrickService bricks;
    @Autowired BrickProductionService production;
    @Autowired BrickPayrollService payroll;
    @Autowired BrickSalesService sales;
    @Autowired BrickInsightService insights;
    @Autowired LedgerService ledger;

    @BeforeEach
    void signIn() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void theBusinessIsASectionOfItsOwn() {
        assertThat(Feature.BRICKS.isBusiness()).isTrue();
        assertThat(FeaturePolicy.allows(EnumSet.of(Feature.BRICKS), "POST", "/api/bricks/orders")).isTrue();
        assertThat(FeaturePolicy.allows(EnumSet.of(Feature.EXPENSES), "POST", "/api/bricks/orders")).isFalse();
        // the dashboard and reports show the business only to those who have it
        assertThat(FeaturePolicy.allows(EnumSet.of(Feature.DASHBOARD, Feature.REPORTS), "GET", "/api/bricks/dashboard")).isFalse();
        assertThat(FeaturePolicy.allows(EnumSet.of(Feature.BRICKS), "GET", "/api/bricks/report")).isTrue();
    }

    @Test
    void aBatchIsMadeSoldInTripsPaidForAndTheTeamPaidOnce() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        BrickService.Meta meta = bricks.start();
        BrickType dies = meta.types().stream().filter(t -> t.getName().equals("16X4X8 Dies")).findFirst().orElseThrow();
        BrickMaterial cement = meta.materials().stream().filter(m -> m.getName().equals("Cement")).findFirst().orElseThrow();
        assertThat(meta.materials()).extracting(BrickMaterial::getName).contains("6MM Gravel", "Robo Sand", "M-Sand", "20 MM Gravel", "Cement");
        meta = bricks.saveType(dies.getId(), new BrickService.TypeRequest(dies.getName(), bd(42), 0, 0, null, true));
        Long defaultModel = meta.models().stream().filter(m -> Boolean.TRUE.equals(m.model().getDefaultModel())).findFirst().orElseThrow().model().getId();
        bricks.saveModel(defaultModel, new BrickService.ModelRequest("Standard rates", true, true, null, List.of(new BrickService.RateInput(dies.getId(), bd(1.5)))));
        bricks.updateSettings(new BrickService.SettingsRequest(bd(500), 5000, bd(150), bd(0.25), bd(0.25), false, "bricks@okicici", "Sri Bricks",
                "Sri Bricks", null, null, "Owner", null, "Accountant", null, null, 6, null, null));

        // the people: a production team paid by the brick, a driver, a loading team
        Long team = payroll.saveResource(null, new ResourceRequest("Ramu team " + tag, "TEAM", "PRODUCTION_TEAM", "PIECE", null, null, 6, null, null, null, null, true, null, null, null)).resource().getId();
        Long driver = payroll.saveResource(null, new ResourceRequest("Driver Ravi " + tag, "INDIVIDUAL", "DRIVER", "PIECE", null, null, null, null, "9876500001", null, null, true, null, null, null)).resource().getId();
        // a team is paid by the work it does or a weekly wage, never a monthly salary
        assertThatThrownBy(() -> payroll.saveResource(null, new ResourceRequest("Salaried team " + tag, "TEAM", "PRODUCTION_TEAM", "MONTHLY", bd(20000), null, 3, null, null, null, null, true, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("not a monthly salary");
        Long loaders = payroll.saveResource(null, new ResourceRequest("Loaders " + tag, "TEAM", "LOADING_TEAM", "PIECE", null, null, 4, null, null, null, null, true, null, null, null)).resource().getId();
        meta = bricks.saveVehicle(null, new BrickService.VehicleRequest("TS09 " + tag, "Tractor", 2000, driver, true, null, true));
        Long vehicle = meta.vehicles().stream().filter(v -> v.getNumber().equals("TS09 " + tag)).findFirst().orElseThrow().getId();

        // raw material: 100 bags bought, 70 left after the batch, so 30 used
        production.savePurchase(null, new PurchaseRequest(cement.getId(), today.minusDays(2), bd(100), bd(400), null, "Ultra", null, null, null, null));
        var batch = production.saveBatch(null, new BatchRequest(today.minusDays(1), team, null, null,
                List.of(new ItemInput(dies.getId(), 4000, 100)), List.of(new CountInput(cement.getId(), bd(70)))));
        assertThat(batch.good()).isEqualTo(3900);
        assertThat(batch.labour()).isEqualByComparingTo("5850");   // 3,900 good bricks × 1.50
        assertThat(batch.materials()).filteredOn(f -> f.materialId().equals(cement.getId())).singleElement()
                .satisfies(f -> assertThat(f.consumed()).isEqualByComparingTo("30"));
        // a count above what there was is refused
        assertThatThrownBy(() -> production.saveBatch(batch.batch().getId(), new BatchRequest(today.minusDays(1), team, null, null,
                List.of(new ItemInput(dies.getId(), 4000, 100)), List.of(new CountInput(cement.getId(), bd(500))))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("more than there was");
        assertThat(bricks.brickStock()).filteredOn(s -> s.brickTypeId().equals(dies.getId())).singleElement()
                .satisfies(s -> assertThat(s.inYard()).isEqualTo(3900));

        // an order for 3,000 at 40 (MRP 42): two trips of a 2,000-brick tractor, delivery charged 500 a trip
        OrderView o = sales.create(new OrderRequest(today, today.plusDays(1), "Suresh " + tag, "9876543210", "Plot 4, Kondapur", null,
                List.of(new BrickSalesService.ItemInput(dies.getId(), 3000, bd(40))), vehicle, null, loaders, null, null, null, null, null, null, null, null, null, null, null, null));
        assertThat(o.trips()).hasSize(2);
        assertThat(o.items().getFirst().discountPercent()).isEqualByComparingTo("4.76");
        assertThat(o.totals().discount()).isEqualByComparingTo("6000");
        assertThat(o.totals().total()).isEqualByComparingTo("121000");   // 120,000 + 2 × 500
        assertThat(o.order().getDriverId()).isEqualTo(driver);

        Long first = o.trips().get(0).trip().getId(), second = o.trips().get(1).trip().getId();
        o = sales.step(o.order().getId(), first, new StepRequest("DELIVERED", null, null));
        assertThat(o.order().getStatus()).isEqualTo("PART_DELIVERED");
        assertThat(o.trips().getFirst().billed()).isEqualByComparingTo("80500");
        var entry = ledger.toViews(List.of(ledger.get(o.trips().getFirst().trip().getJournalEntryId()))).getFirst();
        assertThat(entry.brick()).isNotNull();
        assertThat(entry.brick().what()).isEqualTo("Sale");
        assertThat(entry.lockReason()).contains("Brick Management");
        // the business's income and costs stay out of personal categories (spending mix, budgets)
        assertThat(entry.lines()).allMatch(l -> l.categoryId() == null);

        // the second trip: 20 of its 1,000 broke on the way
        o = sales.step(o.order().getId(), second, new StepRequest("DELIVERED", List.of(new TripItemInput(dies.getId(), 980)), null));
        assertThat(o.totals().delivered()).isEqualTo(2980);
        assertThat(o.order().getStatus()).isEqualTo("PART_DELIVERED");
        // the customer takes the 2,980: the order is made smaller and so complete
        o = sales.update(o.order().getId(), new OrderRequest(today, today.plusDays(1), "Suresh " + tag, "9876543210", "Plot 4, Kondapur", null,
                List.of(new BrickSalesService.ItemInput(dies.getId(), 2980, bd(40))), vehicle, null, loaders, null, null, null, null, null, null, null, null, null, null, null, null));
        assertThat(o.order().getStatus()).isEqualTo("DELIVERED");
        assertThat(o.totals().total()).isEqualByComparingTo("120200");   // 2,980 × 40 + 2 × 500

        // paid by UPI, the books agree
        Long myBank = accounts.create(new AccountRequest(null, "Brick test bank " + tag, AccountType.BANK, "Bank", null, null, null, null, null, null, null,
                null, true, null)).id();
        o = sales.addPayment(o.order().getId(), new BrickSalesService.PaymentRequest(bd(120200), today, "UPI", "UTR" + tag, myBank, null));
        assertThat(o.totals().balance()).isEqualByComparingTo("0");
        assertThat(o.payments().getFirst().payment().getReceiptNo()).startsWith("RC-");
        // paid in full: the invoice is made, numbered and digitally signed
        assertThat(o.invoice()).isNotNull();
        assertThat(o.invoice().invoiceNo()).startsWith("INV-");
        assertThat(o.invoice().signature()).isNotBlank();
        assertThat(o.company().name()).isEqualTo("Sri Bricks");

        // the team's weekly slip, less 1,000 of a 3,000 advance
        var adv = payroll.advance(new AdvanceRequest(team, bd(3000), today.minusDays(3), null, "Cash", null, "For a festival", bd(1000)));
        assertThat(adv.slip().getSlipNo()).startsWith("AD-");
        var preview = payroll.preview(team, "WEEKLY", today.minusDays(6), today);
        assertThat(preview.earnings()).hasSize(1);
        assertThat(preview.advances().getFirst().suggested()).isEqualByComparingTo("1000");
        var slip = payroll.pay(new SlipRequest(team, "WEEKLY", today.minusDays(6), today, preview.earnings().stream().map(BrickPayrollService.EarningView::id).toList(),
                null, null, List.of(new DeductionInput(adv.slip().getId(), bd(1000))), today, null, "Cash", null, null));
        assertThat(slip.slip().getNet()).isEqualByComparingTo("4850");
        assertThat(slip.deductions().getFirst().narrative()).isEqualTo("For a festival");
        assertThat(slip.deductions().getFirst().balanceAfter()).isEqualByComparingTo("2000");
        assertThat(slip.slip().getDigitalSignature()).isNotBlank();
        // the batch cannot be paid again, nor changed while paid
        assertThatThrownBy(() -> payroll.pay(new SlipRequest(team, "WEEKLY", today.minusDays(6), today, preview.earnings().stream().map(BrickPayrollService.EarningView::id).toList(),
                null, null, null, today, null, "Cash", null, null))).isInstanceOf(BusinessException.class).hasMessageContaining("cannot be paid twice");
        assertThatThrownBy(() -> production.saveBatch(batch.batch().getId(), new BatchRequest(today.minusDays(1), team, null, null,
                List.of(new ItemInput(dies.getId(), 4500, 100)), null))).isInstanceOf(BusinessException.class).hasMessageContaining("already paid");
        // the driver earned two trips and the loaders loaded 3,000
        var driverDue = payroll.preview(driver, "WEEKLY", today.minusDays(6), today);
        assertThat(driverDue.gross()).isEqualByComparingTo("300");
        assertThat(payroll.preview(loaders, "WEEKLY", today.minusDays(6), today).gross()).isEqualByComparingTo("750");
        // cancelling the slip makes the batch due again
        payroll.cancel(slip.slip().getId());
        assertThat(payroll.preview(team, "WEEKLY", today.minusDays(6), today).earnings()).hasSize(1);

        var dash = insights.dashboard();
        assertThat(dash.kpis().salesMonth()).isPositive();
        var report = insights.report(today.minusDays(30), today);
        assertThat(report.summary().delivered()).isGreaterThanOrEqualTo(2980);
        assertThat(report.summary().revenue()).isPositive();
    }

    @Test
    void theCustomerFollowsTheOrderOnItsLinkAndSignsForATrip() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        BrickService.Meta meta = bricks.start();
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("12X6X8 Bricks")).findFirst().orElseThrow();
        bricks.saveType(type.getId(), new BrickService.TypeRequest(type.getName(), bd(30), 0, 5000, null, true));
        OrderView o = sales.create(new OrderRequest(today, null, "Lakshmi " + tag, "9123456789", "Gachibowli", "Near temple",
                List.of(new BrickSalesService.ItemInput(type.getId(), 500, bd(30))), null, null, null, null, true, "Regular customer", null, null, null, null, null, null, null, null, null));
        assertThat(o.order().getDeliveryWaived()).isTrue();
        Long tripId = o.trips().getFirst().trip().getId();
        // trips without a vehicle cannot leave
        assertThatThrownBy(() -> sales.step(o.order().getId(), tripId, new StepRequest("DISPATCHED", null, null))).isInstanceOf(BusinessException.class);
        Long vehicle = bricks.saveVehicle(null, new BrickService.VehicleRequest("AP28 " + tag, "Lorry", 3000, null, true, null, true)).vehicles().stream()
                .filter(v -> v.getNumber().equals("AP28 " + tag)).findFirst().orElseThrow().getId();
        sales.editTrip(o.order().getId(), tripId, new BrickSalesService.TripRequest(vehicle, null, null, null, today, null, null));
        sales.step(o.order().getId(), tripId, new StepRequest("IN_TRANSIT", null, null));

        var link = sales.createLink(o.order().getId(), new BrickSalesService.LinkRequest(48));
        UserContext.clear();
        var page = sales.open(link.token());
        assertThat(page.status()).isEqualTo("IN_TRANSIT");
        assertThat(page.trips().getFirst().canAcknowledge()).isTrue();
        assertThat(page.totals().delivery()).isEqualByComparingTo("0");
        page = sales.reportPaid(link.token(), new BrickSalesService.PaidRequest(bd(15000), "UPI" + tag, "gpay"));
        assertThat(page.payments()).extracting(BrickSalesService.PublicPayment::status).contains("CLAIMED");
        page = sales.acknowledge(link.token(), new BrickSalesService.AckRequest(1L, "Lakshmi", "M10 10 L200 120 L400 60 L600 200", "17.44,78.35,20", "{}", null),
                "127.0.0.1", "JUnit");
        assertThat(page.status()).isEqualTo("DELIVERED");
        assertThat(page.trips().getFirst().ackName()).isEqualTo("Lakshmi");
        assertThatThrownBy(() -> sales.acknowledge(link.token(), new BrickSalesService.AckRequest(1L, "Lakshmi", "M10 10 L200 120 L400 60 L600 200", null, null, null),
                "127.0.0.1", "JUnit")).isInstanceOf(BusinessException.class).hasMessageContaining("already signed");
        signIn();
        OrderView after = sales.order(o.order().getId());
        Long claimed = after.payments().getFirst().payment().getId();
        after = sales.confirmPayment(o.order().getId(), claimed, new BrickSalesService.ConfirmRequest(null, today));
        assertThat(after.totals().balance()).isEqualByComparingTo("0");
        assertThat(after.invoice()).isNotNull();
        UserContext.clear();
        assertThat(sales.open(link.token()).invoice().invoiceNo()).isEqualTo(after.invoice().invoiceNo());
        signIn();
        assertThat(sales.order(o.order().getId()).trips().getFirst().acknowledged()).isTrue();
    }

    @Test
    void aHiredVehicleIsBilledOnlyWhenWePayIt() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        BrickService.Meta meta = bricks.start();
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("12X6X8 Bricks")).findFirst().orElseThrow();
        bricks.saveType(type.getId(), new BrickService.TypeRequest(type.getName(), bd(30), 0, 5000, null, true));
        List<BrickSalesService.ItemInput> items = List.of(new BrickSalesService.ItemInput(type.getId(), 2500, bd(30)));

        // the customer pays the transporter: no delivery on the bill, trips planned from the hired vehicle's load, it can leave the yard
        OrderView o = sales.create(new OrderRequest(today, null, "Ganesh " + tag, null, "Miyapur", null, items, null, null, null, null, null, null, bd(500), null, null,
                true, "ts 07 xy 99", "Raju transport 9000000001", 1000, bd(1200), "CUSTOMER"));
        assertThat(o.trips()).hasSize(3);
        assertThat(o.totals().delivery()).isEqualByComparingTo("0");
        assertThat(o.vehicle()).isEqualTo("TS 07 XY 99 (hired)");
        sales.step(o.order().getId(), o.trips().getFirst().trip().getId(), new StepRequest("DISPATCHED", null, null));

        // we pay it: its charge a trip goes on the bill
        OrderView ours = sales.create(new OrderRequest(today, null, "Mahesh " + tag, null, "Miyapur", null, items, null, null, null, null, null, null, null, null, null,
                true, null, null, 2500, bd(1200), "US"));
        assertThat(ours.trips()).hasSize(1);
        assertThat(ours.totals().delivery()).isEqualByComparingTo("1200");
        assertThat(ours.totals().total()).isEqualByComparingTo("76200");
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
