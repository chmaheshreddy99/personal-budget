package com.aditya.personalbudget.config;

import com.aditya.personalbudget.service.OrgClock;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.domain.entity.EmiPlan;
import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.domain.type.CategoryKind;
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
 * <p>
 * Defaults that were split up are renamed first, once: "Meat, Fish &amp; Eggs" becomes "Meat &amp; Fish" (Eggs is a
 * category of its own) and "Vegetables &amp; Fruits" becomes "Vegetables" (Fruits and Dry Fruits are their own). Only a
 * category still carrying the old default name is renamed, and not where the new name is already taken; everything
 * booked to it stays with it.
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
            "default-categories-2026-10-classes-travel-power-fuel", Set.of("5440", "5450", "5460"),
            "default-categories-2026-10-non-veg", Set.of("5480"),
            "default-categories-2026-10-eggs-fruits-dry-fruits", Set.of("5490", "5500", "5510"),
            "default-categories-2026-11-transport-oils", Set.of("5520", "5530", "5540"),
            "default-categories-2026-11-millets", Set.of("5550")));

    /** Old default name, new name and description; applied once, under {@link #RENAME_STEP}. */
    private static final List<String[]> RENAMES = List.of(
            new String[] {"Meat, Fish & Eggs", "Meat & Fish",
                    "Chicken, mutton, fish, prawns: Licious, FreshToHome, the butcher, the fish market"},
            new String[] {"Vegetables & Fruits", "Vegetables",
                    "Vegetables, greens, onions and potatoes: the sabzi market, the vegetable vendor"});
    private static final String RENAME_STEP = "default-categories-2026-10-split-produce";
    /**
     * "Fuel &amp; Transport" becomes "Fuel" and takes in the separate "Fuel" category (getting around has its own
     * Transportation now); applied once.
     */
    private static final String FUEL_STEP = "default-categories-2026-11-merge-fuel";
    private static final String FUEL_AND_TRANSPORT = "Fuel & Transport";
    private static final String FUEL = "Fuel";
    private static final String FUEL_DESCRIPTION = "Petrol, diesel and CNG for your vehicles";

    private final TsvDataStore store;

    public NewDefaultCategories(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws IOException {
        if (!store.isDone(RENAME_STEP)) {
            renameSplitDefaults();
        }
        if (!store.isDone(FUEL_STEP)) {
            mergeFuel();
        }
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

    private void renameSplitDefaults() {
        int renamed = 0;
        for (Organization org : store.findAll(Organization.class, o -> true)) {
            List<Category> own = store.findAll(Category.class, c -> c.getTenantId().equals(org.getId())
                    && c.getKind() == CategoryKind.EXPENSE);
            List<Category> rows = new ArrayList<>();
            for (String[] r : RENAMES) {
                boolean taken = own.stream().anyMatch(c -> c.getName().equalsIgnoreCase(r[1]));
                Category old = own.stream().filter(c -> c.getName().equalsIgnoreCase(r[0])).findFirst().orElse(null);
                if (old == null || taken) {
                    continue;
                }
                old.setName(r[1]);
                old.setDescription(r[2]);
                rows.add(old);
            }
            store.saveAll(Category.class, rows);
            renamed += rows.size();
        }
        store.markDone(RENAME_STEP);
        if (renamed > 0) {
            log.info("Renamed {} split default categor{} (Meat & Fish, Vegetables)", renamed, renamed == 1 ? "y" : "ies");
        }
    }

    /**
     * Per organization with both "Fuel &amp; Transport" and "Fuel": everything booked or planned under "Fuel" (journal
     * lines, budgets, recurring entries, bills to pay, write-offs, EMIs, entries waiting for approval) moves to
     * "Fuel &amp; Transport", "Fuel" goes, and "Fuel &amp; Transport" is renamed "Fuel". A month budgeted under both
     * keeps one budget with the two limits added up. Amounts and accounts do not change, so no balance moves.
     */
    private void mergeFuel() {
        int merged = 0;
        for (Organization org : store.findAll(Organization.class, o -> true)) {
            Long tenantId = org.getId();
            List<Category> own = store.findAll(Category.class, c -> c.getTenantId().equals(tenantId) && c.getKind() == CategoryKind.EXPENSE);
            Category target = own.stream().filter(c -> c.getName().equalsIgnoreCase(FUEL_AND_TRANSPORT)).findFirst().orElse(null);
            if (target == null) {
                continue;   // renamed by the household, or never there: leave their categories as they are
            }
            Category fuel = own.stream().filter(c -> c.getName().equalsIgnoreCase(FUEL)).findFirst().orElse(null);
            if (fuel != null) {
                if (fuel.getSystemKey() != null) {
                    continue;
                }
                moveCategory(tenantId, fuel.getId(), target.getId());
                store.deleteById(Category.class, fuel.getId());
            }
            target.setName(FUEL);
            if (target.getDescription() == null || target.getDescription().isBlank()) {
                target.setDescription(FUEL_DESCRIPTION);
            }
            store.save(Category.class, target);
            merged++;
        }
        store.markDone(FUEL_STEP);
        if (merged > 0) {
            log.info("Fuel & Transport renamed Fuel (the separate Fuel category merged into it) in {} organization{}", merged, merged == 1 ? "" : "s");
        }
    }

    private void moveCategory(Long tenantId, Long from, Long to) {
        java.util.function.Predicate<Long> isFrom = from::equals;
        List<JournalLine> lines = store.findAll(JournalLine.class, l -> l.getTenantId().equals(tenantId) && isFrom.test(l.getCategoryId()));
        lines.forEach(l -> l.setCategoryId(to));
        store.saveAll(JournalLine.class, lines);
        List<Budget> budgets = store.findAll(Budget.class, b -> b.getTenantId().equals(tenantId));
        for (Budget b : budgets.stream().filter(b -> isFrom.test(b.getCategoryId())).toList()) {
            Budget same = budgets.stream().filter(x -> to.equals(x.getCategoryId()) && x.getMonth().equals(b.getMonth())).findFirst().orElse(null);
            if (same == null) {
                b.setCategoryId(to);
                store.save(Budget.class, b);
                continue;
            }
            if (b.getMonthlyLimit() != null) {
                same.setMonthlyLimit(same.getMonthlyLimit() == null ? b.getMonthlyLimit() : same.getMonthlyLimit().add(b.getMonthlyLimit()));
                store.save(Budget.class, same);
            }
            store.deleteById(Budget.class, b.getId());
        }
        List<RecurringTransaction> recurring = store.findAll(RecurringTransaction.class, r -> r.getTenantId().equals(tenantId) && isFrom.test(r.getCategoryId()));
        recurring.forEach(r -> r.setCategoryId(to));
        store.saveAll(RecurringTransaction.class, recurring);
        List<Claim> claims = store.findAll(Claim.class, c -> c.getTenantId().equals(tenantId) && isFrom.test(c.getCategoryId()));
        claims.forEach(c -> c.setCategoryId(to));
        store.saveAll(Claim.class, claims);
        List<ClaimRepayment> repayments = store.findAll(ClaimRepayment.class, r -> r.getTenantId().equals(tenantId) && isFrom.test(r.getCategoryId()));
        repayments.forEach(r -> r.setCategoryId(to));
        store.saveAll(ClaimRepayment.class, repayments);
        List<EmiPlan> emis = store.findAll(EmiPlan.class, e -> e.getTenantId().equals(tenantId) && isFrom.test(e.getCategoryId()));
        emis.forEach(e -> e.setCategoryId(to));
        store.saveAll(EmiPlan.class, emis);
        List<HostedChit> hosted = store.findAll(HostedChit.class, h -> h.getTenantId().equals(tenantId) && isFrom.test(h.getCommissionCategoryId()));
        hosted.forEach(h -> h.setCommissionCategoryId(to));
        store.saveAll(HostedChit.class, hosted);
        // expenses waiting for approval keep their request as JSON
        java.util.regex.Pattern ref = java.util.regex.Pattern.compile("(\"categoryId\"\\s*:\\s*)" + from + "(?=\\s*[,}])");
        List<PendingEntry> pending = store.findAll(PendingEntry.class, p -> p.getTenantId().equals(tenantId)
                && p.getPayload() != null && ref.matcher(p.getPayload()).find());
        pending.forEach(p -> p.setPayload(ref.matcher(p.getPayload()).replaceAll("$1" + to)));
        store.saveAll(PendingEntry.class, pending);
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
