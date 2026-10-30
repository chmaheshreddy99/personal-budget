package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.OrgClock;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Gives organizations set up before them the income and expense categories added to the defaults (Savings Income,
 * Shopping, Milk &amp; Dairy, Maid &amp; Household Help ..., later Tips &amp; Gratuity), once per round. A default is
 * skipped where the organization already has a category of that name or code (so a renamed "Shopping &amp; Clothing"
 * stays as it is), and a record kept with the data makes sure categories someone deletes later do not come back.
 */
@Component
@Order(7)
public class NewDefaultCategories implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NewDefaultCategories.class);
    /** Recorded with the data (see TsvDataStore#isDone); the marker file is how older versions recorded it. */
    private static final String STEP = "default-categories-2026-10";
    private static final String MARKER = ".added-default-categories-2026-10";

    /** Later rounds: each adds only the default categories (by code) it names, once. */
    private static final Map<String, Set<String>> LATER = new LinkedHashMap<>(Map.of(
            "default-categories-2026-10-tips", Set.of("5430"),
            "default-categories-2026-10-classes-travel-power-fuel", Set.of("5440", "5450", "5460", "5470"),
            "default-categories-2026-10-non-veg", Set.of("5480")));

    private final TsvDataStore store;

    public NewDefaultCategories(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws IOException {
        Path marker = store.dataDir().resolve(MARKER);
        boolean done = store.isDone(STEP);
        if (done || Files.exists(marker)) {
            if (!done) {
                store.markDone(STEP);   // ran here before the record moved in with the data: keep it there now
            }
        } else {
            addDefaults(STEP, t -> true);
        }
        for (Map.Entry<String, Set<String>> round : LATER.entrySet()) {
            if (!store.isDone(round.getKey())) {
                addDefaults(round.getKey(), t -> round.getValue().contains(t.code()));
            }
        }
    }

    private void addDefaults(String step, Predicate<DefaultChartOfAccounts.CategoryTemplate> which) {
        int added = 0;
        LocalDateTime now = OrgClock.now();
        for (Organization org : store.findAll(Organization.class, o -> true)) {
            List<Category> own = store.findAll(Category.class, c -> c.getTenantId().equals(org.getId()));
            if (own.isEmpty()) {
                continue;   // not set up yet: provisioning seeds everything
            }
            List<Category> rows = new ArrayList<>();
            for (DefaultChartOfAccounts.CategoryTemplate t : DefaultChartOfAccounts.CATEGORIES) {
                if (!which.test(t)) {
                    continue;
                }
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
        store.markDone(step);
        if (added > 0) {
            log.info("Added {} new default income / expense categor{}", added, added == 1 ? "y" : "ies");
        }
    }
}
