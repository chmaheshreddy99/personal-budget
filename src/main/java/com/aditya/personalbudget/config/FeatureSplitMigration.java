package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.type.Feature;
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
import java.util.EnumSet;
import java.util.Set;

/**
 * Host a Chit used to come with the Chits section and Activity with the role; both are sections of their own now.
 * Once, users and access links limited to some sections keep what they could open: Host a Chit where Chits was
 * shared, and Activity for users. A marker file in the data folder makes sure it runs only once, so an admin's
 * later choices stand.
 */
@Component
@Order(4)
public class FeatureSplitMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(FeatureSplitMigration.class);
    private static final String MARKER = ".migrated-feature-split";

    private final TsvDataStore store;

    public FeatureSplitMigration(TsvDataStore store) {
        this.store = store;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws IOException {
        Path marker = store.dataDir().resolve(MARKER);
        if (Files.exists(marker)) {
            return;
        }
        int users = 0;
        for (AppUser u : store.findAll(AppUser.class, u -> u.getFeatures() != null)) {
            Set<Feature> set = EnumSet.noneOf(Feature.class);
            set.addAll(Feature.parse(u.getFeatures(), EnumSet.noneOf(Feature.class)));
            if (set.contains(Feature.CHITS)) set.add(Feature.HOST_CHITS);
            set.add(Feature.ACTIVITY);
            u.setFeatures(Feature.format(set, Feature.all()));
            store.save(AppUser.class, u);
            users++;
        }
        int links = 0;
        for (AccessLink l : store.findAll(AccessLink.class, l -> l.getFeatures() != null && l.getFeatures().contains("CHITS"))) {
            Set<Feature> set = EnumSet.noneOf(Feature.class);
            set.addAll(Feature.parse(l.getFeatures(), EnumSet.noneOf(Feature.class)));
            if (set.contains(Feature.CHITS) && set.add(Feature.HOST_CHITS)) {
                l.setFeatures(set.stream().sorted().map(Enum::name).reduce((a, b) -> a + "," + b).orElse(null));
                store.save(AccessLink.class, l);
                links++;
            }
        }
        Files.writeString(marker, "Host a Chit and Activity became sections of their own\n");
        if (users + links > 0) {
            log.info("Host a Chit and Activity are sections of their own now: kept them for {} user(s) and {} access link(s)", users, links);
        }
    }
}
