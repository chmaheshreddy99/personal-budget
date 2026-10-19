package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ClaimService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Posts each finished month of interest on money lent or owed that asks for it ("post interest every month"),
 * at startup and every night shortly after midnight. Entries are created by "system".
 */
@Component
@EnableScheduling
@Order(20)
public class InterestPostingJob implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(InterestPostingJob.class);

    private final TenantRepository tenants;
    private final ClaimService claims;

    public InterestPostingJob(TenantRepository tenants, ClaimService claims) {
        this.tenants = tenants;
        this.claims = claims;
    }

    @Override
    public void run(ApplicationArguments args) {
        postAll();
    }

    @Scheduled(cron = "0 15 0 * * *")
    public void nightly() {
        postAll();
    }

    void postAll() {
        for (Tenant tenant : tenants.findAll()) {
            if (!Boolean.TRUE.equals(tenant.getActive())) {
                continue;
            }
            UserContext.set(new CurrentUser(null, "system", "Monthly interest", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int months = claims.postDueInterestForAll();
                if (months > 0) {
                    log.info("Tenant {}: posted {} month(s) of interest", tenant.getCode(), months);
                }
            } catch (RuntimeException e) {
                log.warn("Tenant {}: could not post monthly interest: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
            }
        }
    }
}
