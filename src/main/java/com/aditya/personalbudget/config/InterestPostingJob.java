package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.ClaimService;
import com.aditya.personalbudget.service.EmiService;
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
 * and the EMIs that fell due on plans that book themselves, at startup and every night shortly after midnight. Entries are created by "system".
 */
@Component
@EnableScheduling
@Order(20)
public class InterestPostingJob implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(InterestPostingJob.class);

    private final OrganizationRepository tenants;
    private final ClaimService claims;
    private final EmiService emis;

    public InterestPostingJob(OrganizationRepository tenants, ClaimService claims, EmiService emis) {
        this.tenants = tenants;
        this.claims = claims;
        this.emis = emis;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (Organization tenant : tenants.findAll()) {
            UserContext.set(new CurrentUser(null, "system", "EMI upgrade", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int moved = emis.moveCardPlansToTheCard();
                if (moved > 0) log.info("Organization {}: {} card EMI plan(s) now charged on the card", tenant.getCode(), moved);
            } catch (RuntimeException e) {
                log.warn("Organization {}: could not move the card EMIs to their cards: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
            }
        }
        postAll();
    }

    @Scheduled(cron = "0 15 0 * * *")
    public void nightly() {
        postAll();
    }

    void postAll() {
        for (Organization tenant : tenants.findAll()) {
            if (!Boolean.TRUE.equals(tenant.getActive())) {
                continue;
            }
            UserContext.set(new CurrentUser(null, "system", "Monthly interest", UserRole.ADMIN,
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                int months = claims.postDueInterestForAll();
                if (months > 0) {
                    log.info("Organization {}: posted {} month(s) of interest", tenant.getCode(), months);
                }
            } catch (RuntimeException e) {
                log.warn("Organization {}: could not post monthly interest: {}", tenant.getCode(), e.getMessage());
            }
            try {
                int emiCount = emis.postDueForAll();
                if (emiCount > 0) {
                    log.info("Organization {}: booked {} EMI(s) that fell due", tenant.getCode(), emiCount);
                }
            } catch (RuntimeException e) {
                log.warn("Organization {}: could not book the EMIs due: {}", tenant.getCode(), e.getMessage());
            } finally {
                UserContext.clear();
            }
        }
    }
}
