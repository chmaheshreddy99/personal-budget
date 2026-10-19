package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.HostedChitBookService;
import com.aditya.personalbudget.service.HostedChitService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * At startup, brings hosted chits recorded before the chit book (Host a Chit, Chit accounts) into it: the accounts
 * made for the chits move off the personal Accounts page, payments get the account they came into, payouts the
 * account they were paid from, and their journal lines carry the chit. Each step skips what is already done, so it
 * does nothing after the first run. Runs after {@link HostedChitCommissionRepair}.
 */
@Component
@Order(26)
public class HostedChitBookMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(HostedChitBookMigration.class);

    private final OrganizationRepository tenants;
    private final HostedChitBookService book;
    private final HostedChitService chits;

    public HostedChitBookMigration(OrganizationRepository tenants, HostedChitBookService book, HostedChitService chits) {
        this.tenants = tenants;
        this.book = book;
        this.chits = chits;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (Organization tenant : tenants.findAll()) {
            UserContext.set(new CurrentUser(null, "system", "Chit book", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int moved = book.adoptAccounts();
                int changed = 0;
                for (Long chitId : chits.chitIds()) {
                    try {
                        changed += chits.migrateChit(chitId);
                    } catch (RuntimeException e) {
                        log.warn("Organization {}: hosted chit {} could not be brought into the chit book: {}", tenant.getCode(), chitId, e.getMessage());
                    }
                }
                changed += chits.assignShortCodes();   // payment notes: AC5L-M03
                if (moved + changed > 0) {
                    log.info("Organization {}: chit book: {} account(s) moved, {} record(s) updated", tenant.getCode(), moved, changed);
                }
            } catch (RuntimeException e) {
                log.warn("Organization {}: could not set up the chit book: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
            }
        }
    }
}
