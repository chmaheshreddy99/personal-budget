package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.service.DefaultChartOfAccounts;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Gives organizations set up before them the income and expense categories added to the defaults (Savings Income,
 * Shopping, Milk &amp; Dairy, Maid &amp; Household Help ...), once. A default is skipped where the organization already
 * has a category of that name or code (so a renamed "Shopping &amp; Clothing" stays as it is), and a marker file makes
 * sure categories someone deletes later do not come back.
 */
@Component
@Order(7)
public class NewDefaultCategories implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NewDefaultCategories.class);
    private static final String MARKER = ".added-default-categories-2026-10";

    private final TsvDataStore store;

    public NewDefaultCategories(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws IOException {
        Path marker = store.dataDir().resolve(MARKER);
        if (Files.exists(marker)) {
            return;
        }
        int added = 0;
        LocalDateTime now = LocalDateTime.now();
        for (Organization org : store.findAll(Organization.class, o -> true)) {
            List<Category> own = store.findAll(Category.class, c -> c.getTenantId().equals(org.getId()));
            if (own.isEmpty()) {
                continue;   // not set up yet: provisioning seeds everything
            }
            List<Category> rows = new ArrayList<>();
            for (DefaultChartOfAccounts.CategoryTemplate t : DefaultChartOfAccounts.CATEGORIES) {
                boolean has = own.stream().anyMatch(c -> c.getKind() == t.kind()
                        && (c.getName().equalsIgnoreCase(t.name()) || c.getCode().equals(t.code())
                        || (t.systemKey() != null && t.systemKey().equals(c.getSystemKey()))));
                if (has) {
                    continue;
                }
                Category c = new Category();
                c.setTenantId(org.getId());
                c.setKind(t.kind());
                c.setCode(t.code());
                c.setName(t.name());
                c.setDescription(t.description());
                c.setSystemKey(t.systemKey());
                c.setActive(true);
                c.setCreatedAt(now);
                rows.add(c);
            }
            store.saveAll(Category.class, rows);
            added += rows.size();
        }
        Files.writeString(marker, "New default income and expense categories were added\n");
        if (added > 0) {
            log.info("Added {} new default income / expense categor{}", added, added == 1 ? "y" : "ies");
        }
    }
}
