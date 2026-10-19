package com.aditya.personalbudget;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Personal Budget - a multi-tenant, double-entry personal finance application.
 * <p>
 * Layers:
 * <ul>
 *   <li>{@code storage}    - tab-separated file database (one .tbl file per table)</li>
 *   <li>{@code domain}     - JPA-annotated entities and enums</li>
 *   <li>{@code repository} - Spring Data style repositories (one per table)</li>
 *   <li>{@code service}    - accounting rules, chits, budgets, reports, forecast</li>
 *   <li>{@code web}        - REST controllers; the UI lives in {@code resources/static}</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class PersonalBudgetApplication {

    public static void main(String[] args) {
        SpringApplication.run(PersonalBudgetApplication.class, args);
    }
}
