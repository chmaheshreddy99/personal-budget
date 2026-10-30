package com.aditya.personalbudget.config;

import com.aditya.personalbudget.PersonalBudgetApplication;
import com.aditya.personalbudget.storage.GoogleSheetsStorage;
import com.aditya.personalbudget.storage.LocalFileStorage;
import com.aditya.personalbudget.storage.TableStorage;
import com.aditya.personalbudget.storage.TsvDataStore;
import com.aditya.personalbudget.storage.TsvTransactionManager;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Opens the data store on the storage chosen by {@code budget.storage.type} (tab-separated files, or a Google
 * spreadsheet), wires {@code @Transactional} to it, and provides password hashing.
 */
@Configuration
@EnableTransactionManagement(proxyTargetClass = true)
public class StorageConfig {

    private static final Logger log = LoggerFactory.getLogger(StorageConfig.class);

    @Bean
    public TsvDataStore dataStore(BudgetProperties properties, Validator validator) {
        Path dataDir = Path.of(properties.dataDir() == null || properties.dataDir().isBlank() ? "data" : properties.dataDir());
        return new TsvDataStore(dataDir, storage(properties.storage(), dataDir), validator);
    }

    /** The startup steps (seeding, migrations, checks) ran on this thread: it keeps nothing they read. */
    @EventListener(ApplicationReadyEvent.class)
    public void forgetStartupReads(ApplicationReadyEvent event) {
        TsvDataStore store = event.getApplicationContext().getBean(TsvDataStore.class);
        try {
            store.vaultLegacyRows();   // agreements, signatures and evidence written before they were kept in files of their own
        } catch (RuntimeException e) {
            log.error("Could not move the documents out of the tables into data/vault; they stay where they are: {}", e.getMessage());
        }
        store.endRequest();
        // only when configured (several server processes on one spreadsheet): look for their saves on a timer
        BudgetProperties.Storage s = event.getApplicationContext().getBean(BudgetProperties.class).storage();
        store.watchOutsideChanges(Duration.ofSeconds(s.watchSeconds()), Duration.ofSeconds(s.fullCheckSeconds()));
    }

    @Bean
    public PlatformTransactionManager transactionManager(TsvDataStore store) {
        return new TsvTransactionManager(store);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    private static TableStorage storage(BudgetProperties.Storage settings, Path dataDir) {
        if (settings.type() == BudgetProperties.StorageType.FILES) {
            return new LocalFileStorage(dataDir);
        }
        BudgetProperties.GoogleSheets g = settings.googleSheets();
        GoogleSheetsStorage sheets = GoogleSheetsStorage.connect(PersonalBudgetApplication.resolve(g.credentialsFile()),
                g.spreadsheetId(), Duration.ofSeconds(Math.max(5, g.timeoutSeconds())), Duration.ofSeconds(g.readCacheSeconds()));
        if (g.importLocalData() && sheets.isEmpty() && Files.isDirectory(dataDir)) {
            int tables = sheets.importFrom(new LocalFileStorage(dataDir));
            if (tables > 0) {
                log.info("Copied {} table(s) from {} into the spreadsheet (the files are left as they are)", tables, dataDir.toAbsolutePath());
            }
        }
        return sheets;
    }
}
