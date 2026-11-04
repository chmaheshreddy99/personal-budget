package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.InsuranceService;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Sends the insurance premium reminders every morning (see {@link InsuranceService}). A morning missed (the server was
 * off) is caught up the next one: the step a policy has reached goes out, not every step it passed.
 */
@Component
public class InsuranceReminderJob {

    private static final Logger log = LoggerFactory.getLogger(InsuranceReminderJob.class);

    private final OrganizationRepository tenants;
    private final InsuranceService insurance;
    private final TsvDataStore store;

    public InsuranceReminderJob(OrganizationRepository tenants, InsuranceService insurance, TsvDataStore store) {
        this.tenants = tenants;
        this.insurance = insurance;
        this.store = store;
    }

    @Scheduled(cron = "${budget.insurance.cron:0 5 7 * * *}")
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
            UserContext.set(new CurrentUser(null, "system", "Insurance reminders", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int sent = insurance.sendDue();
                if (sent > 0) log.info("Organization {}: sent {} insurance reminder(s)", tenant.getCode(), sent);
            } catch (RuntimeException e) {
                log.warn("Organization {}: insurance reminders failed: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
                store.endRequest();
            }
        }
    }
}
