package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.DemoDataGenerator;
import com.aditya.personalbudget.service.TenantProvisioningService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * First start only (no tenants yet): creates the default tenant with a super admin,
 * and optionally fills it with demo data.
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final TenantRepository tenants;
    private final TenantProvisioningService provisioning;
    private final DemoDataGenerator demoData;
    private final BudgetProperties properties;
    private final AppUserRepository users;

    public DataSeeder(TenantRepository tenants, TenantProvisioningService provisioning, DemoDataGenerator demoData,
                      BudgetProperties properties, AppUserRepository users) {
        this.users = users;
        this.tenants = tenants;
        this.provisioning = provisioning;
        this.demoData = demoData;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (tenants.count() > 0) {
            return;
        }
        BudgetProperties.Seed seed = properties.seed();
        AppUser admin = provisioning.provision(new TenantProvisioningService.NewTenant(seed.tenantCode(),
                seed.tenantName(), seed.currency(), seed.adminUsername(), "Administrator", null,
                seed.adminPassword(), UserRole.SUPER_ADMIN));
        admin.setMustChangePassword(true);   // the first sign-in asks for a new password
        admin = users.save(admin);
        log.info("Created default tenant '{}' with login {} and the default password from budget.seed.admin-password; "
                + "a new password is asked at the first sign-in", seed.tenantCode(), seed.adminUsername());

        if (seed.demoData()) {
            Tenant tenant = tenants.findById(admin.getTenantId()).orElseThrow();
            UserContext.set(new CurrentUser(admin.getId(), admin.getUsername(), admin.getFullName(), admin.getRole(),
                    tenant.getId(), tenant.getCode(), tenant.getName(), tenant.getCurrency(), Feature.all(), false));
            try {
                demoData.generate();
                log.info("Demo data generated for tenant '{}'", tenant.getCode());
            } finally {
                UserContext.clear();
            }
        }
    }
}
