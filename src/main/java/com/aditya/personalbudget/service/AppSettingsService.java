package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.storage.StorageException;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;

/**
 * Settings of the whole installation, kept in {@code data/app-settings.properties} and read from the file
 * every time (nothing is held in memory, so a change is seen at once):
 * <ul>
 *   <li>{@code mobile.path}: the address of the mobile version, e.g. {@code m} for {@code https://host/m}.</li>
 *   <li>{@code approval.enabled}: maker-checker anywhere on the installation ({@code true} when missing); when
 *       {@code false} nothing waits for approval, whatever the households, users or links say.</li>
 * </ul>
 */
@Service
public class AppSettingsService {

    public static final String DEFAULT_MOBILE_PATH = "m";

    /** First path segments the app already uses: the mobile version cannot live there. */
    private static final Set<String> RESERVED = Set.of("api", "css", "js", "img", "fonts", "assets", "static",
            "index.html", "mobile.html", "favicon.ico", "error", "actuator");

    public record AppSettings(String mobilePath) {
    }

    private final Path file;

    public AppSettingsService(BudgetProperties properties) {
        this.file = Path.of(properties.dataDir()).resolve("app-settings.properties");
    }

    public AppSettings get() {
        Properties p = read();
        String path = p.getProperty("mobile.path", DEFAULT_MOBILE_PATH);
        return new AppSettings(valid(path) ? path : DEFAULT_MOBILE_PATH);
    }

    public synchronized AppSettings update(AppSettings settings) {
        String path = settings.mobilePath() == null ? "" : settings.mobilePath().trim().replaceAll("^/+|/+$", "").toLowerCase(Locale.ROOT);
        if (!valid(path)) {
            throw new BusinessException("Use 1-30 lowercase letters, digits or hyphens for the mobile address, and not one the app already uses ("
                    + String.join(", ", RESERVED.stream().filter(r -> !r.contains(".")).sorted().toList()) + ")");
        }
        Properties p = read();
        p.setProperty("mobile.path", path);
        write(p);
        return get();
    }

    /** Maker-checker is allowed on this installation (households then decide for themselves). */
    public boolean approvalEnabled() {
        return !"false".equalsIgnoreCase(read().getProperty("approval.enabled", "true").trim());
    }

    public synchronized boolean setApprovalEnabled(boolean enabled) {
        Properties p = read();
        p.setProperty("approval.enabled", String.valueOf(enabled));
        write(p);
        return approvalEnabled();
    }

    public static boolean valid(String path) {
        return path != null && path.matches("[a-z0-9][a-z0-9-]{0,29}") && !RESERVED.contains(path);
    }

    private Properties read() {
        Properties p = new Properties();
        if (Files.exists(file)) {
            try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                p.load(in);
            } catch (IOException e) {
                throw new StorageException("Cannot read " + file, e);
            }
        }
        return p;
    }

    private void write(Properties p) {
        try {
            Files.createDirectories(file.getParent());
            Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            try (Writer out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                p.store(out, "Personal Budget settings");
            }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new StorageException("Cannot write " + file, e);
        }
    }
}
