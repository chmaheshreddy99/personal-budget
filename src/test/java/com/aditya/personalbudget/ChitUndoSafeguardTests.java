package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.ChitService;
import com.aditya.personalbudget.service.JournalDraft;
import com.aditya.personalbudget.service.LedgerIntegrityService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Undoing a chit installment takes every journal entry of it out of the books, also one the installment had lost
 * track of; paying it again never leaves two; and the integrity check finds and removes what an undo left behind.
 */
@SpringBootTest
class ChitUndoSafeguardTests {

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-chit-undo-test-");
        registry.add("budget.data-dir", dir::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountService accounts;
    @Autowired ChitService chits;
    @Autowired LedgerService ledger;
    @Autowired JournalEntryRepository entries;
    @Autowired LedgerIntegrityService integrity;

    private Long bank;
    private ChitDetail chit;

    @BeforeEach
    void setUp() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
        bank = accounts.create(new AccountRequest(null, "Chit undo bank " + System.nanoTime(), AccountType.BANK, "SBI", null, bd(50000),
                LocalDate.now().minusMonths(3), null, null, null, null, null, true, null)).id();
        chit = chits.create(new ChitRequest("Undo chit " + System.nanoTime(), "Sri Ram", "T1", bd(110000), bd(5000), 20,
                LocalDate.now().minusMonths(2), null, null, null, null, null, null, bank, null, null));
    }

    @AfterEach
    void signOut() {
        UserContext.clear();
    }

    @Test
    void undoTakesTheInstallmentsEntryOutOfTheBooks() {
        Long installment = firstInstallment();
        chits.payInstallment(chit.chit().id(), installment, new PayInstallmentRequest(null, bank, null));
        assertThat(postedFor(installment)).isEqualTo(1);
        assertThat(bankBalance()).isEqualByComparingTo("45000");

        chits.undoInstallment(chit.chit().id(), installment);
        assertThat(postedFor(installment)).isZero();
        assertThat(bankBalance()).isEqualByComparingTo("50000");
    }

    @Test
    void undoAlsoTakesOutAnEntryTheInstallmentLostTrackOf() {
        Long installment = firstInstallment();
        chits.payInstallment(chit.chit().id(), installment, new PayInstallmentRequest(null, bank, null));
        strayEntryFor(installment);   // e.g. a second submit whose link was lost
        assertThat(postedFor(installment)).isEqualTo(2);

        chits.undoInstallment(chit.chit().id(), installment);
        assertThat(postedFor(installment)).isZero();
        assertThat(bankBalance()).isEqualByComparingTo("50000");
    }

    @Test
    void payingOverALeftBehindEntryIsRefusedAndNothingIsDeleted() {
        Long installment = firstInstallment();
        strayEntryFor(installment);   // left behind by an earlier payment
        assertThatThrownBy(() -> chits.payInstallment(chit.chit().id(), installment, new PayInstallmentRequest(null, bank, null)))
                .isInstanceOf(BusinessException.class).hasMessageContaining("Data integrity");
        assertThat(postedFor(installment)).isEqualTo(1);
        assertThat(bankBalance()).isEqualByComparingTo("45000");
    }

    @Test
    void theIntegrityCheckReportsALeftBehindEntryAndOnlyAnAdminRemovesIt() {
        Long installment = firstInstallment();
        Long stray = strayEntryFor(installment);
        assertThat(integrity.check()).anySatisfy(o -> {
            assertThat(o.entryId()).isEqualTo(stray);
            assertThat(o.kind()).isEqualTo(LedgerIntegrityService.LEFT_BEHIND);
            assertThat(o.removable()).isTrue();
            assertThat(o.reason()).contains("not paid");
        });
        assertThat(postedFor(installment)).isEqualTo(1);   // reported, still there

        assertThat(integrity.remove(stray).entryId()).isEqualTo(stray);
        assertThat(postedFor(installment)).isZero();
        assertThat(integrity.check()).noneMatch(o -> stray.equals(o.entryId()));
        assertThat(bankBalance()).isEqualByComparingTo("50000");

        // an entry that belongs in the books cannot go this way
        chits.payInstallment(chit.chit().id(), installment, new PayInstallmentRequest(null, bank, null));
        Long paid = entries.findBySource(UserContext.tenantId(), LedgerService.SOURCE_CHIT_INSTALLMENT, installment).getFirst().getId();
        assertThatThrownBy(() -> integrity.remove(paid)).isInstanceOf(BusinessException.class);
    }

    // ------------------------------------------------------------------ helpers

    private Long firstInstallment() {
        return chits.detail(chit.chit().id()).installments().getFirst().id();
    }

    /** A chit-installment entry for the installment that the installment itself does not point to. */
    private Long strayEntryFor(Long installment) {
        return ledger.post(JournalDraft.of(LocalDate.now().minusMonths(2), VoucherType.CHIT_INSTALLMENT, "Stray installment entry")
                .debit(chit.chit().accountId(), bd(5000)).chit(chit.chit().id())
                .credit(bank, bd(5000))
                .source(LedgerService.SOURCE_CHIT_INSTALLMENT, installment)).getId();
    }

    private int postedFor(Long installment) {
        return entries.findBySource(UserContext.tenantId(), LedgerService.SOURCE_CHIT_INSTALLMENT, installment).size();
    }

    private BigDecimal bankBalance() {
        return accounts.require(bank).getBalance();
    }

    private static BigDecimal bd(long v) {
        return BigDecimal.valueOf(v);
    }
}
