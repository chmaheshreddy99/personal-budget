package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.ClaimKind;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InterestCollection;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.ApprovalPolicy;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ActivityService;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.ClaimShareService;
import com.aditya.personalbudget.service.PendingService;
import com.aditya.personalbudget.service.PendingService.PendingView;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Maker-checker (rejected entries corrected and sent again, who needs approval), clearing the activity log,
 * interest collected monthly / yearly / whenever paid, and statement links.
 */
@SpringBootTest
class MakerCheckerAndStatementTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-mc-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "true");
    }

    @Autowired TenantRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountRepository accounts;
    @Autowired CategoryRepository categories;
    @Autowired PendingService pending;
    @Autowired ActivityService activity;
    @Autowired ClaimService claims;
    @Autowired ClaimShareService shares;
    @Autowired ApprovalPolicy approvalPolicy;
    @Autowired ReportService reports;

    private AppUser admin;
    private Tenant tenant;

    @BeforeEach
    void signIn() {
        admin = users.findByUsername("admin").orElseThrow();
        tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        signInAs(admin.getId(), "Admin", UserRole.ADMIN);
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    private void signInAs(Long userId, String name, UserRole role) {
        UserContext.set(new CurrentUser(userId, name.toLowerCase(), name, role, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, role == UserRole.MEMBER));
    }

    private Long bank() {
        return accounts.findByTenantId(tenant.getId()).stream().filter(a -> a.getAccountType() == AccountType.BANK
                && Boolean.TRUE.equals(a.getActive())).findFirst().orElseThrow().getId();
    }

    private Long expenseCategory() {
        return categories.findByTenantIdAndKind(tenant.getId(), CategoryKind.EXPENSE).stream()
                .filter(c -> Boolean.TRUE.equals(c.getActive())).findFirst().orElseThrow().getId();
    }

    @Test
    void aRejectedEntryIsCorrectedByItsMakerSentAgainAndThenApproved() {
        Long maker = 900_001L, other = 900_002L, checker = 900_003L;
        signInAs(maker, "Ravi", UserRole.MEMBER);
        PendingView sent = pending.submit(new ExpenseRequest(LocalDate.now(), new BigDecimal("500"), expenseCategory(), bank(),
                "Diesel", null, null, null, null));
        assertThat(sent.status()).isEqualTo("PENDING");
        assertThat(sent.editable()).isTrue();

        signInAs(checker, "Checker", UserRole.MANAGER);
        PendingView rejected = pending.reject(sent.id(), new PendingService.RejectRequest("Bill says 450"));
        assertThat(rejected.status()).isEqualTo("REJECTED");
        assertThat(rejected.editable()).isFalse();   // only the maker corrects it

        signInAs(other, "Someone else", UserRole.MEMBER);
        assertThatThrownBy(() -> pending.resubmit(sent.id(), new ExpenseRequest(LocalDate.now(), new BigDecimal("1"), expenseCategory(),
                bank(), "x", null, null, null, null))).isInstanceOf(ForbiddenException.class);

        signInAs(maker, "Ravi", UserRole.MEMBER);
        assertThat(pending.mine()).first().satisfies(p -> {
            assertThat(p.status()).isEqualTo("REJECTED");
            assertThat(p.editable()).isTrue();
        });
        PendingView again = pending.resubmit(sent.id(), new ExpenseRequest(LocalDate.now(), new BigDecimal("450"), expenseCategory(),
                bank(), "Diesel", null, null, "Fixed as per bill", null));
        assertThat(again.status()).isEqualTo("PENDING");
        assertThat(again.resubmits()).isEqualTo(1);
        assertThat(again.amount()).isEqualByComparingTo("450");
        assertThat(again.history()).extracting(PendingService.Step::action).containsExactly("SUBMITTED", "REJECTED", "RESUBMITTED");
        assertThat(again.history().getLast().note()).contains("amount");

        signInAs(maker, "Ravi", UserRole.MEMBER);
        assertThatThrownBy(() -> pending.approve(sent.id(), null)).isInstanceOf(ForbiddenException.class);   // not one's own

        signInAs(checker, "Checker", UserRole.MANAGER);
        PendingView approved = pending.approve(sent.id(), null);
        assertThat(approved.status()).isEqualTo("APPROVED");
        assertThat(approved.journalEntryId()).isNotNull();
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();

        signInAs(maker, "Ravi", UserRole.MEMBER);
        assertThatThrownBy(() -> pending.resubmit(sent.id(), new ExpenseRequest(LocalDate.now(), new BigDecimal("400"), expenseCategory(),
                bank(), "Diesel", null, null, null, null))).isInstanceOf(BusinessException.class);
    }

    @Test
    void theMakerCanTakeBackWhatWasSentBack() {
        Long maker = 900_011L;
        signInAs(maker, "Amma", UserRole.MEMBER);
        PendingView sent = pending.submit(new ExpenseRequest(LocalDate.now(), new BigDecimal("80"), expenseCategory(), bank(),
                "Vegetables", null, null, null, null));
        signInAs(900_012L, "Checker", UserRole.MANAGER);
        pending.reject(sent.id(), new PendingService.RejectRequest("Duplicate"));
        signInAs(maker, "Amma", UserRole.MEMBER);
        assertThat(pending.withdraw(sent.id()).status()).isEqualTo("WITHDRAWN");
        assertThat(pending.mine()).noneMatch(p -> p.id().equals(sent.id()));
    }

    @Test
    void approvalCanBeSwitchedOffForTheHouseholdOrForOneUserAndApproversNeverWait() {
        AppUser member = new AppUser();
        member.setRole(UserRole.MEMBER);
        AppUser manager = new AppUser();
        manager.setRole(UserRole.MANAGER);
        Tenant t = new Tenant();

        t.setApprovalMode(null);   // default: access links only
        assertThat(approvalPolicy.forUser(member, t)).isFalse();
        member.setApproval(true);
        assertThat(approvalPolicy.forUser(member, t)).isTrue();

        t.setApprovalMode(ApprovalPolicy.ALL);
        member.setApproval(null);
        assertThat(approvalPolicy.forUser(member, t)).isTrue();
        member.setApproval(false);   // exempted
        assertThat(approvalPolicy.forUser(member, t)).isFalse();
        assertThat(approvalPolicy.forUser(manager, t)).isFalse();

        t.setApprovalMode(ApprovalPolicy.OFF);
        member.setApproval(true);
        assertThat(approvalPolicy.forUser(member, t)).isFalse();
        var link = new com.aditya.personalbudget.domain.entity.AccessLink();
        link.setApproval(true);
        assertThat(approvalPolicy.forLink(link, t)).isFalse();
        t.setApprovalMode(ApprovalPolicy.LINKS);
        assertThat(approvalPolicy.forLink(link, t)).isTrue();
    }

    @Test
    void oldActivityCanBeCleared() {
        activity.record("CHANGED", "Test", "Something happened");
        long all = activity.clear(LocalDate.now().plusDays(1), true);
        assertThat(all).isPositive();
        assertThat(activity.clear(LocalDate.now().minusYears(50), true)).isZero();
        assertThat(activity.clear(LocalDate.now().plusDays(1), false)).isEqualTo(all);
        // only the line saying it was cleared is left
        assertThat(activity.list(null, null, null, null, null, 100)).singleElement()
                .satisfies(a -> assertThat(a.summary()).startsWith("Cleared " + all));
    }

    @Test
    void yearlyInterestFallsDueOnTheAnniversaryAndIsBookedAsOneEntryPerYear() {
        LocalDate start = LocalDate.now().minusMonths(14).minusDays(3);
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Yearly Friend", null, new BigDecimal("12000"), start, null,
                new BigDecimal("12"), null, bank(), null, null, null, null, null, false, null, InterestCollection.YEARLY));
        assertThat(claim.interestCollection()).isEqualTo(InterestCollection.YEARLY);
        assertThat(claim.interestDueNow()).isEqualByComparingTo("1440");          // the first year only
        assertThat(claim.nextInterestDate()).isEqualTo(start.plusMonths(24));
        assertThat(claim.nextInterestAmount()).isEqualByComparingTo("1440");
        assertThat(claim.interestDue()).isGreaterThan(claim.interestDueNow());    // still accruing day by day

        ClaimView auto = claims.setInterestPlan(claim.id(), InterestCollection.YEARLY, true);
        assertThat(auto.postInterestMonthly()).isTrue();
        claims.postDueInterestForAll();
        ClaimView posted = claims.get(claim.id());
        assertThat(posted.postings()).singleElement().satisfies(p -> {
            assertThat(p.firstPeriod()).isEqualTo(1);
            assertThat(p.periodNo()).isEqualTo(12);
            assertThat(p.amount()).isEqualByComparingTo("1440");
        });
        assertThat(posted.monthsToPost()).isEqualTo(2);   // months 13 and 14 wait for the next anniversary

        ClaimView monthly = claims.setInterestPlan(claim.id(), InterestCollection.MONTHLY, false);
        assertThat(monthly.interestDueNow()).isEqualByComparingTo("1680");        // 14 finished months
        ClaimView whenever = claims.setInterestPlan(claim.id(), InterestCollection.ON_PAYMENT, true);
        assertThat(whenever.postInterestMonthly()).isFalse();                     // booked when paid
        assertThat(whenever.nextInterestDate()).isNull();
        assertThat(reports.trialBalance(LocalDate.now()).balanced()).isTrue();
    }

    @Test
    void aStatementLinkShowsTheLoanWithoutSignInUntilItIsRevoked() {
        ClaimView claim = claims.create(new ClaimRequest(ClaimKind.LENT, "Statement Friend", "Bike loan", new BigDecimal("10000"),
                LocalDate.now().minusMonths(2), LocalDate.now().plusMonths(4), new BigDecimal("12"), null, bank(), null, null,
                "private note", null, null, false, null));
        claims.repay(claim.id(), new com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest(LocalDate.now().minusDays(5),
                new BigDecimal("2000"), BigDecimal.ZERO, bank(), null));
        ClaimShareService.CreatedShare made = shares.create(claim.id(), new ClaimShareService.ShareRequest("Statement Friend", 24, true, "Thanks!"));
        assertThat(claims.get(claim.id()).activeShares()).isEqualTo(1);

        UserContext.clear();   // the other person has no account
        ClaimShareService.Statement st = shares.open(made.token());
        assertThat(st.party()).isEqualTo("Statement Friend");
        assertThat(st.owedByViewer()).isTrue();
        assertThat(st.outstanding()).isEqualByComparingTo("8000");
        assertThat(st.payments()).hasSize(1);
        assertThat(st.schedule()).isNotEmpty();
        assertThat(st.message()).isEqualTo("Thanks!");
        assertThat(st.payableToday()).isGreaterThan(new BigDecimal("8000"));
        assertThat(UserContext.current()).isEmpty();
        assertThatThrownBy(() -> shares.open("not-a-token")).isInstanceOf(BusinessException.class);

        signInAs(admin.getId(), "Admin", UserRole.ADMIN);
        shares.revoke(claim.id(), made.share().id());
        UserContext.clear();
        assertThatThrownBy(() -> shares.open(made.token())).isInstanceOf(BusinessException.class).hasMessageContaining("switched off");
    }
}
