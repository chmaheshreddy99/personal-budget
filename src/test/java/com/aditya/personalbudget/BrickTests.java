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
import com.aditya.personalbudget.repository.BrickMaterialRepository;
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
import com.aditya.personalbudget.storage.TsvDataStore;
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
    @Autowired BrickMaterialRepository materialRows;
    @Autowired TsvDataStore store;
    @Autowired com.aditya.personalbudget.service.BrickApprovalService approvals;
    @Autowired com.aditya.personalbudget.service.PendingService pendingEntries;
    @Autowired com.aditya.personalbudget.security.ChangeGate gate;
    @Autowired com.aditya.personalbudget.service.BrickNoticeService notices;
    @Autowired com.aditya.personalbudget.security.BrickAccess access;

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
        meta = bricks.saveType(dies.getId(), new BrickService.TypeRequest(dies.getName(), bd(42), 0, 0, null, true, null));
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
        var batch = production.saveBatch(null, new BatchRequest(today, team, null, null,
                List.of(new ItemInput(dies.getId(), 4000, 100)), List.of(new CountInput(cement.getId(), bd(70)))));
        assertThat(batch.good()).isEqualTo(3900);
        assertThat(batch.labour()).isEqualByComparingTo("5850");   // 3,900 good bricks × 1.50
        assertThat(batch.materials()).filteredOn(f -> f.materialId().equals(cement.getId())).singleElement()
                .satisfies(f -> assertThat(f.consumed()).isEqualByComparingTo("30"));
        // a count above what there was is refused
        assertThatThrownBy(() -> production.saveBatch(batch.batch().getId(), new BatchRequest(today, team, null, null,
                List.of(new ItemInput(dies.getId(), 4000, 100)), List.of(new CountInput(cement.getId(), bd(500))))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("more than there was");
        assertThat(bricks.brickStock()).filteredOn(s -> s.brickTypeId().equals(dies.getId())).singleElement()
                .satisfies(s -> assertThat(s.inYard()).isEqualTo(3900));

        // an order for 3,000 at 40 (MRP 42): two trips of a 2,000-brick tractor, delivery charged 500 a trip
        OrderView o = sales.create(new OrderRequest(today, today.plusDays(1), "Suresh " + tag, "9876543210", "Plot 4, Kondapur", null,
                List.of(new BrickSalesService.ItemInput(dies.getId(), 3000, bd(40))), vehicle, null, loaders, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
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
                List.of(new BrickSalesService.ItemInput(dies.getId(), 2980, bd(40))), vehicle, null, loaders, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
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
        assertThatThrownBy(() -> production.saveBatch(batch.batch().getId(), new BatchRequest(today, team, null, null,
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
        bricks.saveType(type.getId(), new BrickService.TypeRequest(type.getName(), bd(30), 0, 5000, null, true, null));
        OrderView o = sales.create(new OrderRequest(today, null, "Lakshmi " + tag, "9123456789", "Gachibowli", "Near temple",
                List.of(new BrickSalesService.ItemInput(type.getId(), 500, bd(30))), null, null, null, null, true, "Regular customer", null, null, null, null, null, null, null, null, null, null, null));
        assertThat(o.order().getDeliveryWaived()).isTrue();
        Long tripId = o.trips().getFirst().trip().getId();
        // no teams yet (a new order may start with the defaults): it cannot leave, nor without a vehicle
        sales.editTrip(o.order().getId(), tripId, new BrickSalesService.TripRequest(null, null, null, null, today, null, null));
        assertThatThrownBy(() -> sales.step(o.order().getId(), tripId, new StepRequest("DISPATCHED", null, null))).isInstanceOf(BusinessException.class);
        Long vehicle = bricks.saveVehicle(null, new BrickService.VehicleRequest("AP28 " + tag, "Lorry", 3000, null, true, null, true)).vehicles().stream()
                .filter(v -> v.getNumber().equals("AP28 " + tag)).findFirst().orElseThrow().getId();
        sales.editTrip(o.order().getId(), tripId, new BrickSalesService.TripRequest(vehicle, null, null, null, today, null, null));
        // our vehicle is not loaded before its loading and unloading teams are picked
        assertThatThrownBy(() -> sales.step(o.order().getId(), tripId, new StepRequest("LOADING", null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("loading and unloading teams");
        Long crew = payroll.saveResource(null, new ResourceRequest("Crew " + tag, "TEAM", "LOADING_TEAM", "PIECE", null, null, 4, null, null, null, null, true, null, null, null)).resource().getId();
        sales.editTrip(o.order().getId(), tripId, new BrickSalesService.TripRequest(vehicle, null, crew, crew, today, null, null));
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
        bricks.saveType(type.getId(), new BrickService.TypeRequest(type.getName(), bd(30), 0, 5000, null, true, null));
        List<BrickSalesService.ItemInput> items = List.of(new BrickSalesService.ItemInput(type.getId(), 2500, bd(30)));
        // our production team loads the hired vehicle at the yard
        Long yard = payroll.saveResource(null, new ResourceRequest("Yard team " + tag, "TEAM", "PRODUCTION_TEAM", "PIECE", null, null, 5, null, null, null, null, true, null, null, null)).resource().getId();

        // the customer pays the transporter: no delivery on the bill, trips planned from the hired vehicle's load, it can leave the yard
        OrderView o = sales.create(new OrderRequest(today, null, "Ganesh " + tag, null, "Miyapur", null, items, null, null, yard, null, null, null, bd(500), null, null,
                true, "ts 07 xy 99", "Raju transport 9000000001", 1000, bd(1200), "CUSTOMER", null, null));
        assertThat(o.trips()).hasSize(3);
        assertThat(o.totals().delivery()).isEqualByComparingTo("0");
        assertThat(o.vehicle()).isEqualTo("TS 07 XY 99 (hired)");
        sales.step(o.order().getId(), o.trips().getFirst().trip().getId(), new StepRequest("DISPATCHED", null, null));

        // we pay it: its charge a trip goes on the bill
        OrderView ours = sales.create(new OrderRequest(today, null, "Mahesh " + tag, null, "Miyapur", null, items, null, null, null, null, null, null, null, null, null,
                true, "AP 9", null, 2500, bd(1200), "US", null, null));
        assertThat(ours.trips()).hasSize(1);
        assertThat(ours.totals().delivery()).isEqualByComparingTo("1200");
        assertThat(ours.totals().total()).isEqualByComparingTo("76200");

        // a hired vehicle needs its number or the transporter; we pay it: its charge
        assertThatThrownBy(() -> sales.create(new OrderRequest(today, null, "X " + tag, null, null, null, items, null, null, null, null, null, null, null, null, null,
                true, null, null, null, null, "CUSTOMER", null, null))).isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> sales.create(new OrderRequest(today, null, "X " + tag, null, null, null, items, null, null, null, null, null, null, null, null, null,
                true, "AP 1", null, null, null, "US", null, null))).isInstanceOf(BusinessException.class);

        // four trips whatever the vehicle carries; a trip split in two; the bill as a PDF
        OrderView four = sales.create(new OrderRequest(today, null, "Ravi " + tag, null, "Miyapur", null, items, null, null, null, null, null, null, null, null, null,
                true, "AP 2", null, 2500, null, "CUSTOMER", true, 4));
        assertThat(four.trips()).hasSize(4);
        assertThat(four.trips()).extracting(BrickSalesService.TripView::quantity).containsExactly(625, 625, 625, 625);
        OrderView split = sales.splitTrip(four.order().getId(), four.trips().get(1).trip().getId(), new BrickSalesService.SplitRequest(List.of(400, 225)));
        assertThat(split.trips()).hasSize(5);
        assertThat(split.trips()).extracting(t -> t.trip().getTripNo() + ":" + t.quantity()).containsExactly("1:625", "2:400", "3:225", "4:625", "5:625");
        assertThatThrownBy(() -> sales.splitTrip(four.order().getId(), four.trips().get(0).trip().getId(), new BrickSalesService.SplitRequest(List.of(100, 100))))
                .isInstanceOf(BusinessException.class);
        byte[] pdf = sales.billPdf(four.order().getId());
        assertThat(new String(pdf, 0, 5)).isEqualTo("%PDF-");
    }

    @Test
    void theProductionScreenLoadsReadOnlyWhenABalanceWasNeverKept() {
        String tag = String.valueOf(System.nanoTime() % 100000);
        bricks.start();
        bricks.saveMaterial(null, new BrickService.MaterialRequest("Ash " + tag, "Ton", bd(12), null, true));
        BrickMaterial m = bricks.meta().materials().stream().filter(x -> x.getName().equals("Ash " + tag)).findFirst().orElseThrow();
        // a row from before balances were kept
        m.setCurrentStock(null);
        materialRows.save(m);
        // as a GET request: read-only, so loading must not try to write
        store.beginReadOnly();
        try {
            BrickProductionService.Production p = production.production();
            assertThat(p.materials()).anySatisfy(x -> {
                assertThat(x.materialId()).isEqualTo(m.getId());
                assertThat(x.stock()).isEqualByComparingTo("12");
            });
            assertThat(p.stockIssues()).noneMatch(x -> x.materialId().equals(m.getId()));
        } finally {
            store.endRequest();
        }
        // the next change that moves raw material keeps it
        bricks.refreshMaterialStock();
        assertThat(bricks.meta().materials().stream().filter(x -> x.getId().equals(m.getId())).findFirst().orElseThrow().getCurrentStock()).isEqualByComparingTo("12");
    }

    @Test
    void aPurchaseRecordedAfterABatchWasCountedAddsToTheStock() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        bricks.start();
        BrickService.Meta meta = bricks.saveType(null, new BrickService.TypeRequest("Test type " + tag, bd(30), 0, 0, null, true, null));
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("Test type " + tag)).findFirst().orElseThrow();
        meta = bricks.saveMaterial(null, new BrickService.MaterialRequest("Sand " + tag, "Ton", bd(0), null, true));
        Long sand = meta.materials().stream().filter(m -> m.getName().equals("Sand " + tag)).findFirst().orElseThrow().getId();
        java.util.function.Supplier<BigDecimal> stock = () -> production.production().materials().stream()
                .filter(m -> m.materialId().equals(sand)).findFirst().orElseThrow().stock();

        // 50 bought, then a batch the same day counts 20 left: it used 30
        production.savePurchase(null, new PurchaseRequest(sand, today, bd(50), bd(1000), null, null, null, null, null, null));
        var batch = production.saveBatch(null, new BatchRequest(today, null, null, null, List.of(new ItemInput(type.getId(), 1000, 0)),
                List.of(new CountInput(sand, bd(20)))));
        assertThat(stock.get()).isEqualByComparingTo("20");

        // bought later the same day (after the count) and earlier-dated: neither was in the count, both add to the stock
        production.savePurchase(null, new PurchaseRequest(sand, today, bd(30), bd(1000), null, null, null, null, null, null));
        production.savePurchase(null, new PurchaseRequest(sand, today.minusDays(1), bd(5), bd(1000), null, null, null, null, null, null));
        assertThat(stock.get()).isEqualByComparingTo("55");
        var flow = production.batch(batch.batch().getId()).materials().stream().filter(f -> f.materialId().equals(sand)).findFirst().orElseThrow();
        assertThat(flow.received()).isEqualByComparingTo("50");
        assertThat(flow.consumed()).isEqualByComparingTo("30");

        // the next batch's count takes them in: 55 there, 15 left, 40 used
        var next = production.saveBatch(null, new BatchRequest(today, null, null, null, List.of(new ItemInput(type.getId(), 1000, 0)),
                List.of(new CountInput(sand, bd(15)))));
        var f2 = production.batch(next.batch().getId()).materials().stream().filter(f -> f.materialId().equals(sand)).findFirst().orElseThrow();
        assertThat(f2.opening()).isEqualByComparingTo("20");
        assertThat(f2.received()).isEqualByComparingTo("35");
        assertThat(f2.consumed()).isEqualByComparingTo("40");
        assertThat(stock.get()).isEqualByComparingTo("15");
        // the balance is kept as it goes (not worked out on reading) and always matches the records
        assertThat(bricks.meta().materials().stream().filter(m -> m.getId().equals(sand)).findFirst().orElseThrow().getCurrentStock()).isEqualByComparingTo("15");
        assertThat(bricks.stockIssues()).isEmpty();
        production.deleteBatch(next.batch().getId());
        assertThat(bricks.meta().materials().stream().filter(m -> m.getId().equals(sand)).findFirst().orElseThrow().getCurrentStock()).isEqualByComparingTo("55");
        assertThat(bricks.stockIssues()).isEmpty();
    }

    @Test
    void aBatchKeepsTheRawMaterialItUsedAsCountedAndOnlyTheLastBatchCanChange() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        bricks.start();
        BrickService.Meta meta = bricks.saveType(null, new BrickService.TypeRequest("Lock type " + tag, bd(30), 0, 0, null, true, null));
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("Lock type " + tag)).findFirst().orElseThrow();
        meta = bricks.saveMaterial(null, new BrickService.MaterialRequest("Gravel " + tag, "Ton", bd(0), null, true));
        Long gravel = meta.materials().stream().filter(m -> m.getName().equals("Gravel " + tag)).findFirst().orElseThrow().getId();
        java.util.function.Function<Long, BrickService.MaterialFlow> flowOf = batchId -> production.batch(batchId).materials().stream()
                .filter(f -> f.materialId().equals(gravel)).findFirst().orElseThrow();

        // the stock when "left now" is typed is what counts: 50 there, 30 left, 20 used, kept with the batch
        var bought = production.savePurchase(null, new PurchaseRequest(gravel, today, bd(50), bd(900), null, null, null, null, null, null));
        var first = production.saveBatch(null, new BatchRequest(today, null, null, null, List.of(new ItemInput(type.getId(), 1000, 0)),
                List.of(new CountInput(gravel, bd(30)))));
        assertThat(first.open()).isTrue();
        assertThat(flowOf.apply(first.batch().getId()).consumed()).isEqualByComparingTo("20");

        // bought after the count: the stock now, not the batch
        production.savePurchase(null, new PurchaseRequest(gravel, today, bd(40), bd(900), null, null, null, null, null, null));
        assertThat(flowOf.apply(first.batch().getId()).received()).isEqualByComparingTo("50");
        var second = production.saveBatch(null, new BatchRequest(today, null, null, null, List.of(new ItemInput(type.getId(), 1000, 0)),
                List.of(new CountInput(gravel, bd(60)))));
        var f2 = flowOf.apply(second.batch().getId());
        assertThat(f2.opening()).isEqualByComparingTo("30");
        assertThat(f2.received()).isEqualByComparingTo("40");
        assertThat(f2.consumed()).isEqualByComparingTo("10");

        // the first batch is closed now: not changed, not deleted, and the purchase it took in stays as it is
        assertThat(production.batch(first.batch().getId()).open()).isFalse();
        assertThatThrownBy(() -> production.saveBatch(first.batch().getId(), new BatchRequest(today, null, null, null,
                List.of(new ItemInput(type.getId(), 1200, 0)), List.of(new CountInput(gravel, bd(25))))))
                .isInstanceOf(BusinessException.class).hasMessageContaining("is closed");
        assertThatThrownBy(() -> production.deleteBatch(first.batch().getId())).isInstanceOf(BusinessException.class).hasMessageContaining("is closed");
        assertThatThrownBy(() -> production.deletePurchase(bought.purchase().getId())).isInstanceOf(BusinessException.class).hasMessageContaining("is closed");
        assertThat(flowOf.apply(first.batch().getId()).consumed()).isEqualByComparingTo("20");
        // a new batch follows the last one
        assertThatThrownBy(() -> production.saveBatch(null, new BatchRequest(today.minusDays(1), null, null, null,
                List.of(new ItemInput(type.getId(), 100, 0)), List.of())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("cannot be dated before");

        // the last batch can be corrected: against the stock as it stood at its own count (70), not the stock now
        production.savePurchase(null, new PurchaseRequest(gravel, today, bd(5), bd(900), null, null, null, null, null, null));
        production.saveBatch(second.batch().getId(), new BatchRequest(today, null, null, null, List.of(new ItemInput(type.getId(), 1000, 0)),
                List.of(new CountInput(gravel, bd(55)))));
        assertThat(flowOf.apply(second.batch().getId()).consumed()).isEqualByComparingTo("15");
        assertThat(production.production().materials().stream().filter(m -> m.materialId().equals(gravel)).findFirst().orElseThrow().stock())
                .isEqualByComparingTo("60");
        assertThat(bricks.stockIssues()).isEmpty();
    }

    @Test
    void aNewOrderIsLoadedByTheDefaultProductionTeamAndAHiredVehicleUnloadedByTheCustomer() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        BrickService.Meta meta = bricks.start();
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("12X6X8 Bricks")).findFirst().orElseThrow();
        Long crew = payroll.saveResource(null, new ResourceRequest("Default crew " + tag, "TEAM", "LOADING_TEAM", "PIECE", null, null, 4, null, null, null, null, true, null, null, true)).resource().getId();
        Long makers = payroll.saveResource(null, new ResourceRequest("Default makers " + tag, "TEAM", "PRODUCTION_TEAM", "PIECE", null, null, 6, null, null, null, null, true, null, null, true)).resource().getId();
        Long vehicle = bricks.saveVehicle(null, new BrickService.VehicleRequest("KA01 " + tag, "Lorry", 3000, null, true, null, true)).vehicles().stream()
                .filter(v -> v.getNumber().equals("KA01 " + tag)).findFirst().orElseThrow().getId();
        // the default is a production team's: a loading team is not marked
        assertThat(bricks.meta().resources().stream().filter(r -> r.getId().equals(crew)).findFirst().orElseThrow().getDefaultTeam()).isFalse();
        assertThat(bricks.meta().resources().stream().filter(r -> r.getId().equals(makers)).findFirst().orElseThrow().getDefaultTeam()).isTrue();

        OrderView own = sales.create(new OrderRequest(today, null, "Own " + tag, "9123400001", "Kondapur", null,
                List.of(new BrickSalesService.ItemInput(type.getId(), 100, bd(30))), vehicle, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
        // our vehicle: the default production team loads and unloads
        assertThat(own.order().getLoadingTeamId()).isEqualTo(makers);
        assertThat(own.order().getUnloadingTeamId()).isEqualTo(makers);
        assertThat(own.trips().getFirst().trip().getLoadingTeamId()).isEqualTo(makers);

        OrderView hired = sales.create(new OrderRequest(today, null, "Hired " + tag, "9123400002", "Kondapur", null,
                List.of(new BrickSalesService.ItemInput(type.getId(), 100, bd(30))), null, null, null, null, null, null, null, null, null,
                true, "TS07 " + tag, null, null, null, "CUSTOMER", null, null));
        // a hired vehicle: loaded by the production team, unloaded by the customer / transporter
        assertThat(hired.order().getLoadingTeamId()).isEqualTo(makers);
        assertThat(hired.order().getUnloadingTeamId()).isNull();
        assertThat(hired.order().getUnloadingOutside()).isTrue();
        // with both set, its trip can be loaded
        sales.step(hired.order().getId(), hired.trips().getFirst().trip().getId(), new StepRequest("LOADING", null, null));

        // a trip whose teams were taken off is not loaded: it asks for them
        Long tripId = own.trips().getFirst().trip().getId();
        sales.editTrip(own.order().getId(), tripId, new BrickSalesService.TripRequest(vehicle, null, makers, null, today, null, null));
        assertThatThrownBy(() -> sales.step(own.order().getId(), tripId, new StepRequest("LOADING", null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Set the unloading team");
    }

    /** Signs in as an accountant of the same household (made the first time): a maker who cannot approve. */
    private AppUser signInAsAccountant(String tag) {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        AppUser acct = users.findByUsername("acct" + tag).orElseGet(() -> {
            AppUser u = new AppUser();
            u.setTenantId(admin.getTenantId());
            u.setUsername("acct" + tag);
            u.setFullName("Accountant " + tag);
            u.setPasswordHash("x");
            u.setRole(UserRole.ACCOUNTANT);
            u.setActive(true);
            u.setCreatedAt(java.time.LocalDateTime.now());
            return users.save(u);
        });
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(acct.getId(), acct.getUsername(), acct.getFullName(), UserRole.ACCOUNTANT, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        return acct;
    }

    @Test
    void anAccountantRecordsButWhatTouchesTheMoneyWaitsForAChecker() {
        LocalDate today = LocalDate.now();
        String tag = String.valueOf(System.nanoTime() % 100000);
        bricks.start();
        BrickService.Meta meta = bricks.saveType(null, new BrickService.TypeRequest("Gate type " + tag, bd(40), 0, 10000, null, true, bd(35)));
        BrickType type = meta.types().stream().filter(t -> t.getName().equals("Gate type " + tag)).findFirst().orElseThrow();
        java.util.function.BiFunction<Integer, Double, OrderRequest> order = (qty, price) -> new OrderRequest(today, today.plusDays(2), "Gate " + tag, "9123400009",
                "Madhapur", null, List.of(new BrickSalesService.ItemInput(type.getId(), qty, bd(price))), null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null);

        AppUser acct = signInAsAccountant(tag);
        // the maker's role: records and runs deliveries, never sees the money nor approves
        assertThat(access.current()).isEqualTo(com.aditya.personalbudget.security.BrickRole.ACCOUNTANT);
        assertThatThrownBy(() -> access.require(com.aditya.personalbudget.security.BrickPermission.FINANCE)).isInstanceOf(com.aditya.personalbudget.exception.ForbiddenException.class);
        assertThatThrownBy(() -> access.require(com.aditya.personalbudget.security.BrickPermission.APPROVE)).isInstanceOf(com.aditya.personalbudget.exception.ForbiddenException.class);

        // at or above the lowest price: made at once; below it: no order, a request for the checker
        var fine = approvals.place(order.apply(500, 36.0), null);
        assertThat(fine.order()).isNotNull();
        assertThat(fine.pending()).isNull();
        int orders = sales.orders().size();
        var low = approvals.place(order.apply(500, 30.0), "Regular customer, bulk");
        assertThat(low.order()).isNull();
        assertThat(low.pending().status()).isEqualTo("PENDING");
        assertThat(low.pending().reasons()).anyMatch(r -> r.contains("below the lowest"));
        assertThat(sales.orders()).hasSize(orders);

        // what does not touch the money is saved at once; more bricks at a new price waits
        Long id = fine.order().order().getId();
        OrderRequest moved = new OrderRequest(today, today.plusDays(2), "Gate " + tag, "9123400009", "Kondapur, plot 9", null,
                List.of(new BrickSalesService.ItemInput(type.getId(), 500, bd(36))), null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null);
        // a maker changes nothing recorded: even a new address waits for a checker
        var saved = approvals.change(id, moved, "Customer moved the site");
        assertThat(saved.pending()).isNotNull();
        assertThat(saved.pending().reasons()).anyMatch(r -> r.startsWith("Address: Madhapur → Kondapur"));
        assertThat(sales.order(id).order().getAddress()).isEqualTo("Madhapur");
        approvals.withdraw(saved.pending().id());
        OrderRequest more = new OrderRequest(today, today.plusDays(2), "Gate " + tag, "9123400009", "Kondapur, plot 9", null,
                List.of(new BrickSalesService.ItemInput(type.getId(), 600, bd(34))), null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null);
        var asked = approvals.change(id, more, "They want 100 more");
        assertThat(asked.pending()).isNotNull();
        assertThat(asked.pending().reasons()).anyMatch(r -> r.contains("500 → 600")).anyMatch(r -> r.contains("price"));
        assertThat(sales.order(id).items().getFirst().quantity()).isEqualTo(500);
        assertThatThrownBy(() -> approvals.change(id, more, null)).isInstanceOf(BusinessException.class).hasMessageContaining("already asks");
        var cancel = approvals.cancel(id, "Customer called it off");
        assertThat(cancel.pending().kind()).isEqualTo("BRICK_ORDER_CANCEL");
        assertThat(sales.order(id).order().getStatus()).isNotEqualTo("CANCELLED");
        // a maker cannot decide, and sees only what they asked
        assertThatThrownBy(() -> approvals.approve(low.pending().id(), null)).isInstanceOf(com.aditya.personalbudget.exception.ForbiddenException.class);
        assertThat(approvals.list()).allMatch(a -> acct.getId().equals(a.requestedById()));

        // the checker is told; the request is in the application's approval queue, beside every other entry
        signIn();
        assertThat(notices.recent()).anyMatch(n -> "APPROVAL".equals(n.kind()) && n.link().equals("bricks/approvals/" + low.pending().id()));
        assertThat(pendingEntries.list("PENDING")).anyMatch(p -> p.id().equals(low.pending().id()) && p.kind().equals("BRICK_ORDER_NEW"));
        // turned down with a reason (none: refused) ...
        assertThatThrownBy(() -> approvals.reject(low.pending().id(), null)).isInstanceOf(BusinessException.class).hasMessageContaining("why");
        approvals.reject(low.pending().id(), new com.aditya.personalbudget.service.BrickApprovalService.DecideRequest("Show me the customer agreed this"));
        // ... the maker answers it and sends it again; the checker reviews it again and approves (the order is the maker's)
        signInAsAccountant(tag);
        assertThat(approvals.get(low.pending().id()).canResubmit()).isTrue();
        assertThatThrownBy(() -> approvals.resubmit(low.pending().id(), null)).isInstanceOf(BusinessException.class).hasMessageContaining("Answer");
        var again = approvals.resubmit(low.pending().id(), new com.aditya.personalbudget.service.BrickApprovalService.DecideRequest("Owner agreed on the phone, see the message"));
        assertThat(again.status()).isEqualTo("PENDING");
        assertThat(again.resubmits()).isEqualTo(1);
        assertThat(again.history()).extracting(com.aditya.personalbudget.service.PendingService.Step::action).containsExactly("SUBMITTED", "REJECTED", "RESUBMITTED");
        signIn();
        var made = pendingEntries.approve(low.pending().id(), new com.aditya.personalbudget.service.PendingService.ApproveRequest(null, null, null, null, null, "Fine this once"));
        assertThat(made.status()).isEqualTo("APPROVED");
        var madeView = approvals.get(low.pending().id());
        assertThat(sales.orders()).hasSize(orders + 1);
        assertThat(sales.order(madeView.orderId()).order().getCreatedBy()).isEqualTo(acct.getUsername());
        assertThatThrownBy(() -> approvals.reject(asked.pending().id(), null)).isInstanceOf(BusinessException.class).hasMessageContaining("why");
        approvals.reject(asked.pending().id(), new com.aditya.personalbudget.service.BrickApprovalService.DecideRequest("Price stays at 36"));
        approvals.approve(cancel.pending().id(), null);
        assertThat(sales.order(id).order().getStatus()).isEqualTo("CANCELLED");
        // a checker's own low price goes through
        assertThat(approvals.place(order.apply(100, 20.0), null).order()).isNotNull();

        // the maker hears back
        signInAsAccountant(tag);
        assertThat(notices.recent()).anyMatch(n -> "DECISION".equals(n.kind()) && n.title().startsWith("Approved"))
                .anyMatch(n -> "DECISION".equals(n.kind()) && n.title().startsWith("Turned down"));
        // a new order by someone else (the checker made it on approval): a notice with what the alert says; seen once its order is opened, or cleared
        var told = notices.recent().stream().filter(n -> "ORDER".equals(n.kind()) && n.link().equals("bricks/sales/" + madeView.orderId())).findFirst().orElseThrow();
        assertThat(told.data()).contains("\"orderNo\"").contains("Gate " + tag);
        notices.seen("bricks/sales/" + madeView.orderId());
        assertThat(notices.recent()).noneMatch(n -> n.id().equals(told.id()));
        notices.readAll();
        assertThat(notices.recent()).isEmpty();

        signIn();

        // the change gate: a maker's change to what is recorded is held for a checker (not their new records, nor the delivery's life cycle)
        signInAsAccountant(tag);
        CurrentUser maker = UserContext.get();
        assertThat(gate.holds(maker, "PUT", "/api/bricks/batches/12")).isTrue();
        assertThat(gate.holds(maker, "DELETE", "/api/bricks/purchases/3")).isTrue();
        assertThat(gate.holds(maker, "PUT", "/api/bricks/expenses/7")).isTrue();
        assertThat(gate.holds(maker, "POST", "/api/bricks/batches")).isFalse();
        assertThat(gate.holds(maker, "POST", "/api/bricks/orders/4/trips/9/step")).isFalse();
        assertThat(gate.holds(maker, "PUT", "/api/bricks/orders/4/trips/9")).isFalse();
        assertThat(gate.holds(maker, "PUT", "/api/bricks/orders/4")).isFalse();   // asked in Brick Management's own words
        // what is held is a change request in the application's queue; turned down with a reason, answered, approved by making it
        var held = pendingEntries.submitChange("PUT", "/api/bricks/expenses/7", "{\"amount\":450}", "Change the expense 7", List.of("Amount: 450"), bd(450));
        assertThat(approvals.list()).anyMatch(a -> a.id().equals(held.id()) && a.kind().equals("CHANGE"));
        signIn();
        assertThat(gate.holds(UserContext.get(), "PUT", "/api/bricks/batches/12")).isFalse();   // a checker changes directly
        assertThatThrownBy(() -> pendingEntries.reject(held.id(), null)).isInstanceOf(BusinessException.class).hasMessageContaining("why");
        pendingEntries.reject(held.id(), new com.aditya.personalbudget.service.PendingService.RejectRequest("Which bill?"));
        signInAsAccountant(tag);
        var answered = pendingEntries.answerChange(held.id(), "Bill no. 77, attached");
        assertThat(answered.status()).isEqualTo("PENDING");
        assertThat(answered.history()).extracting(com.aditya.personalbudget.service.PendingService.Step::action).containsExactly("SUBMITTED", "REJECTED", "RESUBMITTED");
        signIn();
        assertThat(pendingEntries.changeToMake(held.id()).uri()).isEqualTo("/api/bricks/expenses/7");
        assertThat(pendingEntries.changeMade(held.id(), "ok").status()).isEqualTo("APPROVED");

        // a staff role chosen for them limits the whole application to Brick Management (screens and API)
        Organization tenant = tenants.findById(acct.getTenantId()).orElseThrow();
        assertThat(com.aditya.personalbudget.security.FeaturePolicy.granted(acct, tenant, false)).contains(Feature.DASHBOARD);   // only a default role yet
        acct.setBrickRole("ACCOUNTANT");
        users.save(acct);
        assertThat(com.aditya.personalbudget.security.FeaturePolicy.granted(acct, tenant, false)).containsExactly(Feature.BRICKS);
        assertThat(com.aditya.personalbudget.security.BrickAccess.staffMay("/api/bricks/orders")).isTrue();
        assertThat(com.aditya.personalbudget.security.BrickAccess.staffMay("/api/accounts")).isFalse();
        assertThat(com.aditya.personalbudget.security.BrickAccess.staffMay("/api/pulse")).isFalse();
        assertThat(com.aditya.personalbudget.security.BrickAccess.staffMay("/api/transactions/5")).isFalse();
        acct.setBrickRole(null);
        users.save(acct);
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
