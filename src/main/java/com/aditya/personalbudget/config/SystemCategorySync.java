package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.service.TenantProvisioningService;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Gives every tenant the system categories added in later versions (e.g. Chit Payments), at startup.
 * A category the user already made with the same name and kind is adopted (it gets the system key) instead
 * of a second one being created.
 */
@Component
@Order(6)
public class SystemCategorySync implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SystemCategorySync.class);

    private final TsvDataStore store;
    private final TenantProvisioningService provisioning;

    public SystemCategorySync(TsvDataStore store, TenantProvisioningService provisioning) {
        this.store = store;
        this.provisioning = provisioning;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<DefaultChartOfAccounts.CategoryTemplate> system = DefaultChartOfAccounts.CATEGORIES.stream()
                .filter(t -> t.systemKey() != null).toList();
        int added = 0;
        for (Tenant tenant : store.findAll(Tenant.class, t -> true)) {
            List<Category> own = store.findAll(Category.class, c -> c.getTenantId().equals(tenant.getId()));
            if (own.isEmpty()) {
                continue;   // not set up yet: provisioning seeds everything
            }
            boolean missing = false;
            for (DefaultChartOfAccounts.CategoryTemplate t : system) {
                if (own.stream().anyMatch(c -> t.systemKey().equals(c.getSystemKey()))) {
                    continue;
                }
                Category sameName = own.stream()
                        .filter(c -> c.getKind() == t.kind() && c.getName().equalsIgnoreCase(t.name()))
                        .findFirst().orElse(null);
                if (sameName != null) {
                    sameName.setSystemKey(t.systemKey());
                    sameName.setActive(true);
                    store.save(Category.class, sameName);
                } else {
                    missing = true;
                }
                added++;
            }
            if (missing) {
                provisioning.seedCategories(tenant.getId(), true);
            }
        }
        if (added > 0) {
            log.info("Added {} system categor{} to existing tenants", added, added == 1 ? "y" : "ies");
        }
    }
}
