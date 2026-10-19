package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ConstructionAgreementService;
import com.aditya.personalbudget.service.ConstructionAgreementService.MakeRequest;
import com.aditya.personalbudget.service.ConstructionAgreementService.PublicAgreement;
import com.aditya.personalbudget.service.ConstructionMoneyService;
import com.aditya.personalbudget.service.ConstructionMoneyService.CapitalRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.CostRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.LoanRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.LoanTxnRequest;
import com.aditya.personalbudget.service.ConstructionMoneyService.ReceiptRequest;
import com.aditya.personalbudget.service.ConstructionSalesService;
import com.aditya.personalbudget.service.ConstructionSalesService.LoanInfo;
import com.aditya.personalbudget.service.ConstructionSalesService.PlanRow;
import com.aditya.personalbudget.service.ConstructionSalesService.SaleRequest;
import com.aditya.personalbudget.service.ConstructionSalesService.SaleStep;
import com.aditya.personalbudget.service.ConstructionService;
import com.aditya.personalbudget.service.ConstructionService.CreateRequest;
import com.aditya.personalbudget.service.ConstructionService.Detail;
import com.aditya.personalbudget.service.ConstructionService.ExtraRequest;
import com.aditya.personalbudget.service.ConstructionService.PartnerInput;
import com.aditya.personalbudget.service.ConstructionService.PartyInput;
import com.aditya.personalbudget.service.ConstructionService.ProjectRequest;
import com.aditya.personalbudget.service.ConstructionService.StageInput;
import com.aditya.personalbudget.service.ConstructionService.StageProgress;
import com.aditya.personalbudget.service.ConstructionService.StatusRequest;
import com.aditya.personalbudget.service.ConstructionService.UnitPlan;
import com.aditya.personalbudget.service.LedgerService;
import com.aditya.personalbudget.service.ReportService;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The Construction section: a contract work (its stages and dues, late interest, an extra work agreed by a
 * supplementary agreement, costs, closing with the profit shared by the partners) and a joint development (flats, a
 * buyer's plan linked to a construction stage, the buyer's bank paying, a project loan, the tripartite agreement and
 * the agreement for sale accepted on its link).
 */
@SpringBootTest
class ConstructionTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-construction-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ConstructionService projects;
    @Autowired ConstructionMoneyService money;
    @Autowired ConstructionSalesService sales;
    @Autowired ConstructionAgreementService agreements;
    @Autowired ReportService reports;
    @Autowired LedgerService ledger;
    @Autowired com.aditya.personalbudget.service.ConstructionBookService bookService;

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
    void aContractWorkIsPaidByStagesWithLateInterestGrowsByAnExtraWorkAndClosesWithTheProfitShared() {
        LocalDate today = LocalDate.now();
        Long myBank = bank("My bank " + System.nanoTime());
        Detail d = projects.create(new CreateRequest(project("CONTRACT", null, "Reddy House " + System.nanoTime(), "Suresh Reddy", "9876543210",
                today.minusMonths(3), today.plusMonths(6), bd(2)),
                List.of(new StageInput(null, "Foundation", null, bd(300000), null, null, today.minusDays(40)),
                        new StageInput(null, "Slab", null, bd(500000), null, null, today.plusDays(30)),
                        new StageInput(null, "Finishing", null, bd(200000), null, null, null)),
                List.of(new PartnerInput("Me", null, null, bd(60), true), new PartnerInput("Ravi", "9123456780", null, bd(40), false)),
                null, null, "NEW", null, null, null, null));
        Long id = d.project().getId();
        assertThat(d.figures().contractValue()).isEqualByComparingTo("1000000");
        assertThat(d.accounts()).extracting(ConstructionService.AccountLine::role).contains("BANK", "COST", "ADVANCES", "INTEREST");
        // the construction book stays off the personal accounts
        assertThat(accounts.list().stream().filter(a -> a.projectBook()).count()).isGreaterThanOrEqualTo(4);
        Long projectBank = d.project().getBankAccountId();

        // foundation fell due 40 days ago: 300000 unpaid at 2% a month for 40 days = 8000 of interest
        assertThat(d.figures().overdue()).isEqualByComparingTo("300000");
        assertThat(d.figures().interestDue()).isEqualByComparingTo("8000");
        d = money.addReceipt(id, new ReceiptRequest(null, null, null, bd(308000), bd(8000), today, "Bank", "UTR1", projectBank, "Foundation", null));
        assertThat(d.receipts().getFirst().getReceiptNo()).endsWith("-R0001");
        assertThat(d.figures().overdue()).isEqualByComparingTo("0");
        assertThat(d.figures().received()).isEqualByComparingTo("300000");
        assertThat(d.figures().interestReceived()).isEqualByComparingTo("8000");

        // an extra work: agreed by its supplementary agreement, it adds to the price and the timeline
        d = projects.saveExtra(id, null, new ExtraRequest("Extra bathroom", "On the first floor", bd(150000), 20, today, null));
        Long extraId = d.extras().getFirst().getId();
        assertThat(d.figures().extrasValue()).isEqualByComparingTo("0");
        d = projects.update(id, project("CONTRACT", null, d.project().getName(), "Suresh Reddy", "9876543210", today.minusMonths(3), today.plusMonths(6), bd(2)));
        var contract = agreements.make(id, make("CONTRACT", null));
        assertThat(contract.title()).isEqualTo("Construction Agreement");
        assertThat(contract.terms()).contains("Arbitration and Conciliation Act, 1996").contains("PAYMENT SCHEDULE");
        assertThat(contract.particulars()).anyMatch(r -> r[0].equals("Contract price") && r[1].contains("10,00,000"));
        var extra = agreements.make(id, make("EXTRA", extraId));
        assertThat(extra.recitals().getFirst()).contains(contract.agreementNo());
        assertThat(extra.terms()).contains("20 (twenty) days");
        agreements.signed(id, extra.id(), new ConstructionAgreementService.SignedRequest(null, today));
        d = projects.detail(id);
        assertThat(d.extras().getFirst().getStatus()).isEqualTo("AGREED");
        assertThat(d.figures().extrasValue()).isEqualByComparingTo("150000");
        assertThat(d.figures().revisedEndDate()).isEqualTo(today.plusMonths(6).plusDays(20));
        assertThatThrownBy(() -> projects.saveExtra(id, extraId, new ExtraRequest("Extra bathroom", null, bd(1), 0, today, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("signed");

        // costs: materials from the project's bank (my money put in first), and the rest received
        d = money.addCapital(id, new CapitalRequest(d.partners().getFirst().partner().getId(), "INVEST", bd(100000), today, projectBank, myBank, "Start-up"));
        d = money.addCost(id, new CostRequest("Cement", "OPC 53", "Sri Traders", "B-12", bd(400), "bags", bd(400), bd(160000), today, projectBank, null));
        assertThat(d.costHeads().getFirst().head()).isEqualTo("CEMENT");
        d = money.addCost(id, new CostRequest("labour", null, null, null, null, null, null, bd(540000), today, projectBank, null));
        d = money.addReceipt(id, new ReceiptRequest(null, null, null, bd(850000), null, today, "Bank", null, projectBank, null, null));
        assertThat(d.figures().profit()).isEqualByComparingTo("458000");   // 300000 + 850000 + 8000 interest - 700000

        // closing: the advances set off against the costs; the profit 60:40, Ravi's to his capital account
        d = projects.status(id, new StatusRequest("CLOSED", today));
        assertThat(d.project().getStatus()).isEqualTo("CLOSED");
        var ravi = d.partners().stream().filter(p -> p.partner().getName().equals("Ravi")).findFirst().orElseThrow();
        assertThat(ravi.profit()).isEqualByComparingTo("183200");
        var balances = ledger.snapshot().balancesAsOf(LocalDate.of(9999, 12, 31));
        assertThat(balances.get(ravi.partner().getAccountId())).isEqualByComparingTo("183200");
        assertThat(balances.get(d.project().getProfitAccountId())).isEqualByComparingTo("274800");
        assertThat(balances.get(d.project().getCostAccountId())).isEqualByComparingTo("0");
        assertThatThrownBy(() -> money.addCost(id, new CostRequest("Paint", null, null, null, null, null, null, bd(1), today, projectBank, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("closed");
        // re-opening undoes the closing
        d = projects.status(id, new StatusRequest("COMPLETED", today));
        assertThat(ledger.snapshot().balancesAsOf(LocalDate.of(9999, 12, 31)).get(d.project().getCostAccountId())).isEqualByComparingTo("700000");
        // the balance sheet shows the business as a group of its own
        assertThat(reports.balanceSheet(today, null).assets().groups()).anyMatch(g -> g.label().equals(ReportService.CONSTRUCTION));
    }

    @Test
    void aJointDevelopmentSellsAFlatOnAConstructionLinkedPlanWithTheBuyersBankAndTheAgreementAcceptedOnline() {
        LocalDate today = LocalDate.now();
        ProjectRequest q = project("DEVELOPMENT", "JOINT", "Green Villas " + System.nanoTime(), null, null, today.minusMonths(1), today.plusMonths(18), bd(1.5));
        Detail d = projects.create(new CreateRequest(q,
                List.of(new StageInput(null, "Foundation", null, null, null, null, null), new StageInput(null, "Roof slab", null, null, null, null, null)),
                null, List.of(new PartyInput("LANDOWNER", "Narasimha Rao", "S/o Venkat Rao", "9988776655", "Kukatpally", bd(100), bd(1000000))),
                new UnitPlan("A", 1, 2, 2, "2BHK", bd(1000), bd(1150), bd(1300), bd(5000), 1), "NEW", null, null, null, null));
        Long id = d.project().getId();
        assertThat(d.units()).hasSize(4);
        assertThat(d.units()).filteredOn(u -> "LANDOWNER".equals(u.getAllottedTo())).hasSize(1);
        assertThat(d.figures().unitsAvailable()).isEqualTo(3);
        Long unit = d.units().stream().filter(u -> "AVAILABLE".equals(u.getStatus())).findFirst().orElseThrow().getId();
        Long slab = d.stages().get(1).getId();
        Long bank = d.project().getBankAccountId();

        // 10% on booking, 90% within 15 days of the roof slab
        d = sales.book(id, new SaleRequest(unit, "Prakash Varma", null, "9876501234", null, "Ameerpet", "abcpe1234f", null, today,
                bd(6500000), bd(300000), "Car parking", null,
                List.of(new PlanRow("Booking", bd(10), null, today, null, null), new PlanRow("On roof slab", bd(90), null, null, slab, 15))));
        var sale = d.sales().getFirst();
        assertThat(sale.sale().getTotalPrice()).isEqualByComparingTo("6800000");
        assertThat(sale.sale().getBuyerPan()).isEqualTo("ABCPE••••F");
        assertThat(sale.due()).isEqualByComparingTo("680000");
        assertThatThrownBy(() -> sales.book(id, new SaleRequest(unit, "Someone", null, null, null, null, null, null, today, bd(1), null, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("available");
        Long saleId = sale.sale().getId();
        d = money.addReceipt(id, new ReceiptRequest(saleId, "BUYER", null, bd(680000), null, today, "UPI", null, bank, "Booking", null));
        assertThat(d.sales().getFirst().due()).isEqualByComparingTo("0");
        // the slab is done: the 90% falls due 15 days later
        d = projects.progress(id, slab, new StageProgress("DONE", today.minusDays(20)));
        assertThat(d.sales().getFirst().due()).isEqualByComparingTo("6120000");

        // the buyer's home loan pays it, through the bank
        d = sales.loan(id, saleId, new LoanInfo("SBI", "Ameerpet", bd(6120000), "HL-1", today, "SANCTIONED"));
        var tri = agreements.make(id, make("TRIPARTITE", saleId));
        assertThat(tri.thirdName()).isEqualTo("SBI");
        assertThat(tri.terms()).contains("CHARGE OF THE BANK");
        d = money.addReceipt(id, new ReceiptRequest(saleId, "BANK", null, bd(6120000), null, today, "Bank", "NEFT", bank, "On roof slab", null));
        assertThat(d.sales().getFirst().bankReceived()).isEqualByComparingTo("6120000");
        assertThat(d.sales().getFirst().balance()).isEqualByComparingTo("0");

        // a project loan: its interest is a cost of the project
        d = money.saveLoan(id, null, new LoanRequest("HDFC", "CF-9", bd(5000000), bd(11), 36, today, null));
        Long loan = d.loans().getFirst().loan().getId();
        d = money.addLoanTxn(id, loan, new LoanTxnRequest("DISBURSE", bd(2000000), today, bank, null));
        d = money.addLoanTxn(id, loan, new LoanTxnRequest("INTEREST", bd(18000), today, bank, null));
        assertThat(d.loans().getFirst().outstanding()).isEqualByComparingTo("2000000");
        assertThat(d.figures().costs()).isEqualByComparingTo("18000");

        // the agreement for sale, accepted on its link: the sale moves to "agreement made"
        var fs = agreements.make(id, make("FLAT_SALE", saleId));
        assertThat(fs.terms()).contains("Real Estate (Regulation and Development) Act, 2016");
        assertThat(fs.particulars()).anyMatch(r -> r[0].startsWith("Instalment 2") && r[1].contains("Roof slab"));
        String token = agreements.link(id, fs.id(), new ConstructionAgreementService.LinkRequest(48)).token();
        PublicAgreement gate = agreements.open(token, null);
        assertThat(gate.step()).isEqualTo("VERIFY");
        assertThat(gate.terms()).isNull();
        assertThat(agreements.open(token, new ConstructionAgreementService.OpenRequest("98765 01234")).step()).isEqualTo("OPEN");
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 0};
        agreements.addKyc(token, "9876501234", "AADHAAR_FRONT", "aadhaar.png", png);
        byte[] selfie = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 1};
        agreements.addKyc(token, "9876501234", "SELFIE", "selfie.png", selfie);
        PublicAgreement done = agreements.accept(token, new ConstructionAgreementService.AcceptRequest("9876501234", "Prakash Varma", true, "234123412346",
                "M10 10 L200 120 L400 60 L600 200", null, "{}"), "1.2.3.4", "UA");
        assertThat(done.step()).isEqualTo("DONE");
        assertThat(done.digitalSignature()).isNotBlank();
        assertThat(projects.detail(id).sales().getFirst().sale().getStatus()).isEqualTo("AGREED");

        // registration, handover and closing
        assertThatThrownBy(() -> sales.step(id, saleId, new SaleStep("HANDED_OVER", today, null, null, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Register");
        d = sales.step(id, saleId, new SaleStep("REGISTERED", today, "1234/2026", "SRO Kukatpally", null));
        assertThat(d.units().stream().filter(u -> u.getId().equals(unit)).findFirst().orElseThrow().getStatus()).isEqualTo("SOLD");
        var deed = agreements.make(id, make("SALE_DEED", saleId));
        assertThat(deed.terms()).contains("Registration Act, 1908");
        d = sales.step(id, saleId, new SaleStep("HANDED_OVER", today, null, null, "Keys 2 sets"));
        d = sales.step(id, saleId, new SaleStep("CLOSED", today, null, null, null));
        assertThat(d.sales().getFirst().sale().getStatus()).isEqualTo("CLOSED");
        var jda = agreements.make(id, make("JDA", d.parties().getFirst().getId()));
        assertThat(jda.title()).isEqualTo("Joint Development Agreement");
        assertThat(jda.particulars()).anyMatch(r -> r[0].equals("Flats allotted to the Landowner") && r[1].contains("A-101"));
    }

    @Test
    void moneyMyPartnerPutsInIsTaggedWithTheProjectAndShowsUnderItsAccounts() {
        LocalDate today = LocalDate.now();
        Long myBank = bank("My own bank " + System.nanoTime());
        Detail d = projects.create(new CreateRequest(project("CONTRACT", null, "Tag House " + System.nanoTime(), "Anil", "9876543210", today.minusMonths(1),
                today.plusMonths(6), null), List.of(new StageInput(null, "Foundation", null, bd(100000), null, null, null)),
                List.of(new PartnerInput("Me", null, null, bd(70), true), new PartnerInput("Ravi", "9123456780", null, bd(30), false)),
                null, null, "NEW", null, null, null, null));
        Long id = d.project().getId();
        Long projectBank = d.project().getBankAccountId();
        Long me = d.partners().stream().filter(v -> Boolean.TRUE.equals(v.partner().getMe())).findFirst().orElseThrow().partner().getId();
        Long ravi = d.partners().stream().filter(v -> !Boolean.TRUE.equals(v.partner().getMe())).findFirst().orElseThrow().partner().getId();
        // money put in twice (more after the first), by me from my bank and by the other partner
        money.addCapital(id, new CapitalRequest(me, "INVEST", bd(50000), today, projectBank, myBank, null));
        d = money.addCapital(id, new CapitalRequest(me, "INVEST", bd(25000), today, projectBank, myBank, "More"));
        d = money.addCapital(id, new CapitalRequest(ravi, "INVEST", bd(40000), today, projectBank, null, null));
        assertThat(d.partners().stream().filter(v -> v.partner().getId().equals(me)).findFirst().orElseThrow().invested()).isEqualByComparingTo("75000");
        assertThat(d.figures().moneyBalance()).isEqualByComparingTo("115000");
        // a cost paid from my own bank
        money.addCost(id, new CostRequest("Steel", null, "Tata", null, null, null, null, bd(10000), today, myBank, null));

        // my bank's statement says which project each of those came from
        var rows = reports.accountLedger(myBank, today.minusDays(1), today).rows();
        assertThat(rows).hasSize(3).allSatisfy(r -> {
            assertThat(r.construction()).isNotNull();
            assertThat(r.construction().projectId()).isEqualTo(id);
        });
        assertThat(rows).extracting(r -> r.construction().what()).contains("Capital", "Cost");
        // and the Accounts view lists it as one of my accounts the project's money went through
        var book = bookService.book();
        var mine = book.accounts().stream().filter(a -> a.id().equals(myBank)).findFirst().orElseThrow();
        assertThat(mine.group()).isEqualTo("PERSONAL");
        assertThat(mine.byProject()).singleElement().satisfies(s -> assertThat(s.amount()).isEqualByComparingTo("-85000"));
        assertThat(book.accounts()).anyMatch(a -> a.id().equals(projectBank) && a.group().equals("OWN") && a.balance().compareTo(bd(115000)) == 0);
        // its statement there shows only construction's lines
        assertThat(bookService.statement(myBank, today.minusDays(1), today).rows()).hasSize(3);
    }

    private static MakeRequest make(String kind, Long refId) {
        return new MakeRequest(kind, refId, null, null, bd(100), null, null, null, null, null, "Witness One", null, null, null, null,
                true, true, false, true, null);
    }

    private static ProjectRequest project(String kind, String landMode, String name, String client, String phone, LocalDate start, LocalDate end,
                                          BigDecimal lateRate) {
        return new ProjectRequest(kind, landMode, name, null, "Plot 45, Road 3", "Hyderabad", "123/A", "45", bd(240), "SQ_YD",
                "North: road; South: plot 46", bd(2400), 2, "BP-2026-77", "DEVELOPMENT".equals(kind) ? "P02400001234" : null, start, end,
                client, phone, client == null ? null : "Banjara Hills", null, null, lateRate, 0, 12, bd(800000), null,
                "JOINT".equals(landMode) ? bd(40) : null, "JOINT".equals(landMode) ? bd(1000000) : null, 4, bd(5000),
                "Sri Builders", "Madhapur", "Aditya", "Managing Partner", null);
    }

    private Long bank(String name) {
        return accounts.create(new AccountRequest(null, name, AccountType.BANK, "Bank", null, null, null, null, null, null, null,
                null, true, null)).id();
    }

    private static BigDecimal bd(double v) {
        return BigDecimal.valueOf(v);
    }
}
