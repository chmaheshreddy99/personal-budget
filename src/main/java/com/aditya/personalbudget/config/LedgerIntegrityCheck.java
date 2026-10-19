package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.service.LedgerIntegrityService;
import com.aditya.personalbudget.service.LedgerIntegrityService.Issue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * At startup, checks every tenant's books (see {@link LedgerIntegrityService}) and logs what it finds. It changes
 * nothing: an admin reviews the issues in Data integrity and decides.
 */
@Component
@Order(110)
public class LedgerIntegrityCheck implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(LedgerIntegrityCheck.class);

    private final OrganizationRepository tenants;
    private final LedgerIntegrityService integrity;

    public LedgerIntegrityCheck(OrganizationRepository tenants, LedgerIntegrityService integrity) {
        this.tenants = tenants;
        this.integrity = integrity;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (Organization tenant : tenants.findAll()) {
            try {
                List<Issue> issues = integrity.check(tenant.getId());
                if (!issues.isEmpty()) {
                    log.warn("Organization {}: {} data integrity issue(s); review them in Data integrity", tenant.getCode(), issues.size());
                    issues.forEach(i -> log.warn("  {} {}: {}", i.kind(), i.entryNo() != null ? i.entryNo() : i.accountName(), i.reason()));
                }
            } catch (RuntimeException e) {
                log.warn("Organization {}: could not check the books: {}", tenant.getCode(), e.getMessage());
            }
        }
    }
}
