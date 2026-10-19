package com.aditya.personalbudget;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.boot.system.ApplicationHome;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Personal Budget - a multi-tenant, double-entry personal finance application.
 * <p>
 * Layers:
 * <ul>
 *   <li>{@code storage}    - table database: one .tbl file per table, or one Google spreadsheet tab per table</li>
 *   <li>{@code domain}     - JPA-annotated entities and enums</li>
 *   <li>{@code repository} - Spring Data style repositories (one per table)</li>
 *   <li>{@code service}    - accounting rules, chits, budgets, reports, forecast</li>
 *   <li>{@code web}        - REST controllers; the UI lives in {@code resources/static}</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class PersonalBudgetApplication {

    /** The folder holding the jar (the classes folder when run from the IDE): settings live in its config folder. */
    public static final String HOME_PROPERTY = "budget.home";

    public static void main(String[] args) {
        useConfigNextToJar();
        SpringApplication.run(PersonalBudgetApplication.class, args);
    }

    /**
     * Settings outside the jar: {@code <jar folder>/config/application.yml} (or .properties) is read on top of the
     * built-in ones, as is {@code ./config/} of the working directory (Spring Boot's own rule). A
     * {@code --spring.config.additional-location} given on the command line still wins.
     */
    static void useConfigNextToJar() {
        Path home = home();
        System.setProperty(HOME_PROPERTY, home.toString());
        Path config = home.resolve("config");
        if (System.getProperty("spring.config.additional-location") == null && Files.isDirectory(config)) {
            System.setProperty("spring.config.additional-location",
                    "optional:file:" + config.toString().replace('\\', '/') + "/");
        }
    }

    /** A relative path is looked up in the jar's folder first, then in the working directory. */
    public static Path resolve(String path) {
        Path p = Path.of(path);
        if (p.isAbsolute()) {
            return p;
        }
        Path besideJar = home().resolve(p);
        return Files.exists(besideJar) || !Files.exists(p) ? besideJar : p.toAbsolutePath();
    }

    private static Path home() {
        String set = System.getProperty(HOME_PROPERTY);
        return set != null ? Path.of(set) : new ApplicationHome(PersonalBudgetApplication.class).getDir().toPath().toAbsolutePath();
    }
}
