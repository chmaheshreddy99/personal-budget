package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.AccountLedgerSync;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Accounts store their balance and journal lines their balance snapshot (see {@link AccountLedgerSync}); data
 * written before that has neither. At startup, after the other migrations, both are worked out from the ledger
 * and the account history is started. Nothing is written when the stored figures already agree.
 */
@Component
@Order(100)
public class AccountLedgerMigration implements ApplicationRunner {

    private final AccountLedgerSync sync;

    public AccountLedgerMigration(AccountLedgerSync sync) {
        this.sync = sync;
    }

    @Override
    public void run(ApplicationArguments args) {
        sync.rebuild();
    }
}
