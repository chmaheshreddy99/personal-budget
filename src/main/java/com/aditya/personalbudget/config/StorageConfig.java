package com.aditya.personalbudget.config;

import com.aditya.personalbudget.storage.TsvDataStore;
import com.aditya.personalbudget.storage.TsvTransactionManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/**
 * Wires {@code @Transactional} to the tab-separated file store, and provides password hashing.
 */
@Configuration
@EnableTransactionManagement(proxyTargetClass = true)
public class StorageConfig {

    @Bean
    public PlatformTransactionManager transactionManager(TsvDataStore store) {
        return new TsvTransactionManager(store);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
