package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.StatementService;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sends the monthly statements each organization subscribed to (Settings, Statements): every morning at 7, any
 * subscription whose day of the month has come and whose previous month has not gone out yet. A day missed (the server
 * was off) is caught up the next morning; a failure (no e-mail set up) is retried the next day and shown in Settings.
 */
@Component
public class StatementJob {

    private static final Logger log = LoggerFactory.getLogger(StatementJob.class);

    private final OrganizationRepository tenants;
    private final StatementService statements;
    private final TsvDataStore store;

    public StatementJob(OrganizationRepository tenants, StatementService statements, TsvDataStore store) {
        this.tenants = tenants;
        this.statements = statements;
        this.store = store;
    }

    @Scheduled(cron = "${budget.statements.cron:0 0 7 * * *}")
    public void morning() {
        try {
            sendAll();
        } finally {
            store.endRequest();
        }
    }

    void sendAll() {
        for (Organization tenant : tenants.findAll()) {
            if (!Boolean.TRUE.equals(tenant.getActive())) {
                continue;
            }
            UserContext.set(new CurrentUser(null, "system", "Monthly statements", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int sent = statements.sendDue();
                if (sent > 0) log.info("Organization {}: sent {} monthly statement(s)", tenant.getCode(), sent);
            } catch (RuntimeException e) {
                log.warn("Organization {}: monthly statements failed: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
                store.endRequest();
            }
        }
    }
}
