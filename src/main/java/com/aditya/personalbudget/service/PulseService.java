package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimSummary;
import com.aditya.personalbudget.dto.PlanningDtos.BudgetSummary;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.TableStorage;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.Map;

/**
 * The live numbers shown in the application footer: today's spending, month to date, budget use,
 * money to collect, the next scheduled payment and the health of the data store.
 */
@Service
public class PulseService {

    public record Pulse(BigDecimal netWorth, BigDecimal liquid, BigDecimal cardAndPayables,
                        BigDecimal spentToday, BigDecimal spentThisMonth, BigDecimal incomeThisMonth,
                        BigDecimal budgetUsedPercent, BigDecimal toCollect, int overdueToCollect,
                        String nextDueName, LocalDate nextDueDate, BigDecimal nextDueAmount,
                        long entryCount, LocalDateTime lastPostedAt, String lastPostedBy,
                        int dataFiles, long dataBytes, LocalDateTime serverTime) {
    }

    private final LedgerService ledger;
    private final BudgetService budgets;
    private final ClaimService claims;
    private final RecurringService recurring;
    private final JournalEntryRepository entries;
    private final TsvDataStore store;

    public PulseService(LedgerService ledger, BudgetService budgets, ClaimService claims, RecurringService recurring,
                        JournalEntryRepository entries, TsvDataStore store) {
        this.ledger = ledger;
        this.budgets = budgets;
        this.claims = claims;
        this.recurring = recurring;
        this.entries = entries;
        this.store = store;
    }

    public Pulse pulse() {
        LocalDate today = LocalDate.now();
        LedgerSnapshot snapshot = ledger.snapshot();
        Map<Long, BigDecimal> balances = snapshot.balancesAsOf(today);
        Map<Long, BigDecimal> month = snapshot.movementsBetween(today.withDayOfMonth(1), today);
        Map<Long, BigDecimal> day = snapshot.movementsBetween(today, today);

        BigDecimal liquid = sum(snapshot, balances, Account::isLiquid);
        BigDecimal dues = sum(snapshot, balances,
                a -> a.getAccountType() == AccountType.CREDIT_CARD || a.getAccountType() == AccountType.PAYABLE);
        BigDecimal spentToday = sum(snapshot, day, a -> a.getAccountClass() == AccountClass.EXPENSE);
        BigDecimal spentMonth = sum(snapshot, month, a -> a.getAccountClass() == AccountClass.EXPENSE);
        BigDecimal incomeMonth = sum(snapshot, month, a -> a.getAccountClass() == AccountClass.INCOME);

        BudgetSummary budget = budgets.summary(YearMonth.from(today));
        ClaimSummary collect = claims.summary(claims.list());
        RecurringTransaction next = recurring.active().stream()
                .filter(r -> r.getNextDueDate() != null)
                .min(Comparator.comparing(RecurringTransaction::getNextDueDate)).orElse(null);
        JournalEntry last = entries.findByTenantId(UserContext.tenantId()).stream()
                .max(Comparator.comparing(JournalEntry::getCreatedAt)).orElse(null);

        TableStorage.Footprint storage = store.footprint();

        return new Pulse(snapshot.netWorthAsOf(today), liquid, dues, spentToday, spentMonth, incomeMonth,
                budget.totalLimit().signum() > 0 ? budget.usedPercent() : null,
                collect.outstanding(), collect.overdueCount(),
                next == null ? null : next.getName(), next == null ? null : next.getNextDueDate(),
                next == null ? null : next.getAmount(),
                entries.countByTenantId(UserContext.tenantId()),
                last == null ? null : last.getCreatedAt(), last == null ? null : last.getCreatedBy(),
                storage.tables(), storage.bytes(), LocalDateTime.now());
    }

    /** Total of the (natural-sign) amounts of the accounts matching {@code filter}. */
    private static BigDecimal sum(LedgerSnapshot snapshot, Map<Long, BigDecimal> amounts,
                                  java.util.function.Predicate<Account> filter) {
        return snapshot.accounts().values().stream()
                .filter(filter)
                .map(a -> amounts.getOrDefault(a.getId(), BigDecimal.ZERO))
                .reduce(Money.ZERO, BigDecimal::add);
    }
}
