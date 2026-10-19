package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.AccountLog;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ColumnMeta;
import com.aditya.personalbudget.storage.EntityMetadata;
import com.aditya.personalbudget.storage.StoreListener;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Keeps the ledger's stored figures in step with its journal lines, and the accounts table's history:
 * <ul>
 *   <li>{@link Account#getBalance()}: the sum of the account's lines, natural sign;</li>
 *   <li>{@link JournalLine#getBalanceBefore()} and {@link JournalLine#getBalanceAfter()}: the account's balance
 *       right before and right after each line, in ledger order;</li>
 *   <li>{@link AccountLog}: a row for every insert, update and delete of an account.</li>
 * </ul>
 * It listens to the data store itself, so every write counts whichever way it comes (a feature, the journal,
 * a migration). Lines posted, changed or deleted mark their accounts; when the transaction commits, each marked
 * account is worked out again from all its lines (never adjusted by deltas, so it cannot drift). A save of an
 * account never changes its balance, and its opening balance cannot change once set.
 */
@Component
public class AccountLedgerSync implements StoreListener {

    private static final Logger log = LoggerFactory.getLogger(AccountLedgerSync.class);
    private static final EntityMetadata<Account> ACCOUNT = EntityMetadata.of(Account.class);
    /** Columns whose change is not an edit of the account. */
    private static final Set<String> NOT_COMPARED = Set.of("id", "version");

    private final TsvDataStore store;
    private final ThreadLocal<State> state = ThreadLocal.withInitial(State::new);

    /** Per unit of work: the accounts whose lines moved, and whether the sync itself is writing. */
    private static final class State {
        final Set<Long> dirty = new LinkedHashSet<>();
        boolean syncing;
        /** Rebuilding at startup: a first balance is part of the baseline, not a change to log. */
        boolean quiet;
    }

    public AccountLedgerSync(TsvDataStore store) {
        this.store = store;
        store.addStoreListener(this);
    }

    // ================================================================== store events

    @Override
    public void beforeSave(Class<?> type, Object existing, Object row) {
        State s = state.get();
        if (type == Account.class) {
            Account before = (Account) existing;
            Account after = (Account) row;
            if (before == null) {
                after.setBalance(Money.ZERO);                 // no lines yet: the ledger fills it in
            } else if (!s.syncing) {
                after.setBalance(before.getBalance());        // the balance belongs to the ledger
                requireSameOpening(before, after);
            }
        } else if (type == JournalLine.class && !s.syncing) {
            JournalLine after = (JournalLine) row;
            s.dirty.add(after.getAccountId());
            if (existing != null) {
                s.dirty.add(((JournalLine) existing).getAccountId());
            }
        } else if (type == JournalEntry.class && existing != null && !s.syncing) {
            // a new date moves the entry's lines within each account's history
            JournalEntry before = (JournalEntry) existing;
            JournalEntry after = (JournalEntry) row;
            if (!Objects.equals(before.getEntryDate(), after.getEntryDate())) {
                store.findAll(JournalLine.class, l -> before.getId().equals(l.getJournalEntryId()))
                        .forEach(l -> s.dirty.add(l.getAccountId()));
            }
        }
    }

    @Override
    public void afterSave(Class<?> type, Object existing, Object row) {
        if (type != Account.class) {
            return;
        }
        State s = state.get();
        Account before = (Account) existing;
        Account after = (Account) row;
        if (before == null) {
            write(after, AccountLog.INSERT, null, null);
            return;
        }
        List<String> changed = changedColumns(before, after);
        if (changed.isEmpty()) {
            return;   // saved as it was: nothing to record
        }
        boolean balanceOnly = changed.equals(List.of("balance"));
        if (balanceOnly && s.quiet) {
            return;
        }
        write(after, balanceOnly ? AccountLog.BALANCE : AccountLog.UPDATE, String.join(",", changed),
                changed.contains("balance") ? Money.nz(before.getBalance()) : null);
    }

    @Override
    public void afterDelete(Class<?> type, Object existing) {
        if (type == Account.class) {
            write((Account) existing, AccountLog.DELETE, null, null);
        } else if (type == JournalLine.class && !state.get().syncing) {
            state.get().dirty.add(((JournalLine) existing).getAccountId());
        }
    }

    @Override
    public void beforeCommit() {
        State s = state.get();
        if (s.dirty.isEmpty()) {
            return;
        }
        List<Long> accounts = new ArrayList<>(s.dirty);
        s.dirty.clear();
        s.syncing = true;
        try {
            Map<Long, LocalDate> dates = new HashMap<>();
            accounts.forEach(id -> recompute(id, dates));
        } finally {
            s.syncing = false;
        }
    }

    @Override
    public void afterEnd() {
        state.remove();
    }

    // ================================================================== rebuild

    /**
     * Works out every account's balance and every line's snapshot from the lines, and starts the history of the
     * accounts that have none yet. Run at startup: it fills in data written before these figures were stored and
     * repairs any file edited by hand. Changes nothing when everything already agrees.
     */
    @Transactional
    public void rebuild() {
        State s = state.get();
        Set<Long> logged = store.findAll(AccountLog.class, l -> true).stream().map(AccountLog::getAccountId)
                .collect(Collectors.toSet());
        Map<Long, LocalDate> dates = store.findAll(JournalEntry.class, e -> true).stream()
                .collect(Collectors.toMap(JournalEntry::getId, JournalEntry::getEntryDate));
        int started = 0;
        s.syncing = true;
        try {
            for (Account a : store.findAll(Account.class, a -> true)) {
                boolean first = !logged.contains(a.getId());
                s.quiet = first;
                recompute(a.getId(), dates);
                if (first) {
                    store.findById(Account.class, a.getId()).ifPresent(now -> write(now, AccountLog.BASELINE, null, null));
                    started++;
                }
            }
        } finally {
            s.syncing = false;
            s.quiet = false;
        }
        if (started > 0) {
            log.info("Account history started for {} account(s); balances and line snapshots worked out from the ledger", started);
        }
    }

    // ================================================================== helpers

    /** Balance and line snapshots of one account, from all its lines in ledger order. */
    private void recompute(Long accountId, Map<Long, LocalDate> dates) {
        Account account = store.findById(Account.class, accountId).orElse(null);
        if (account == null) {
            return;   // deleted in this transaction
        }
        boolean debitNormal = account.getAccountClass().isDebitNormal();
        List<JournalLine> lines = store.findAll(JournalLine.class, l -> accountId.equals(l.getAccountId()));
        Comparator<JournalLine> order = Comparator
                .comparing((JournalLine l) -> dates.computeIfAbsent(l.getJournalEntryId(),
                        id -> store.findById(JournalEntry.class, id).map(JournalEntry::getEntryDate).orElse(LocalDate.MIN)))
                .thenComparing(JournalLine::getJournalEntryId)
                .thenComparing(JournalLine::getLineNo);
        lines.sort(order);

        BigDecimal running = Money.ZERO;
        List<JournalLine> moved = new ArrayList<>();
        for (JournalLine l : lines) {
            BigDecimal before = running;
            BigDecimal net = Money.nz(l.getDebit()).subtract(Money.nz(l.getCredit()));
            running = Money.round(running.add(debitNormal ? net : net.negate()));
            if (!same(l.getBalanceBefore(), before) || !same(l.getBalanceAfter(), running)) {
                l.setBalanceBefore(before);
                l.setBalanceAfter(running);
                moved.add(l);
            }
        }
        if (!moved.isEmpty()) {
            store.saveAll(JournalLine.class, moved);
        }
        if (account.getBalance() == null || !same(account.getBalance(), running)) {
            account.setBalance(running);
            store.saveKeepingVersion(Account.class, account);
        }
    }

    /** The opening balance (and its date) is set when the account is created; it is never edited after that. */
    private static void requireSameOpening(Account before, Account after) {
        boolean hadOpening = Money.isPositive(before.getOpeningBalance());
        boolean sameAmount = same(Money.nz(before.getOpeningBalance()), Money.nz(after.getOpeningBalance()));
        boolean sameDate = !hadOpening || Objects.equals(before.getOpeningDate(), after.getOpeningDate());
        if (hadOpening && !(sameAmount && sameDate)) {
            throw new BusinessException("The opening balance of '" + before.getName()
                    + "' cannot be changed. Post an adjustment entry to correct the balance instead");
        }
    }

    private static List<String> changedColumns(Account before, Account after) {
        List<String> changed = new ArrayList<>();
        for (ColumnMeta c : ACCOUNT.columns()) {
            if (NOT_COMPARED.contains(c.name())) {
                continue;
            }
            Object a = c.read(before);
            Object b = c.read(after);
            boolean equal = a instanceof BigDecimal x && b instanceof BigDecimal y ? x.compareTo(y) == 0 : Objects.equals(a, b);
            if (!equal) {
                changed.add(c.name());
            }
        }
        return changed;
    }

    private void write(Account account, String action, String changedFields, BigDecimal previousBalance) {
        AccountLog row = new AccountLog();
        BeanUtils.copyProperties(account, row, "id", "version");
        row.setAccountId(account.getId());
        row.setAccountVersion(account.getVersion());
        row.setAction(action);
        row.setChangedFields(changedFields);
        row.setPreviousBalance(previousBalance);
        row.setLoggedAt(LocalDateTime.now());
        row.setLoggedBy(UserContext.username());
        store.save(AccountLog.class, row);
    }

    private static boolean same(BigDecimal a, BigDecimal b) {
        return a != null && b != null && a.compareTo(b) == 0;
    }
}
