package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.type.DayCount;
import com.aditya.personalbudget.domain.type.UserRole;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed view of the {@code budget.*} settings in application.yml.
 */
@ConfigurationProperties(prefix = "budget")
public record BudgetProperties(String dataDir, Security security, Seed seed, Interest interest, Attachments attachments,
                               Storage storage) {

    /** Where the tables live: tab-separated files in the data folder (default) or a Google spreadsheet. */
    public record Storage(StorageType type, GoogleSheets googleSheets) {
        public Storage {
            type = type == null ? StorageType.FILES : type;
            googleSheets = googleSheets == null ? new GoogleSheets(null, null, null, false, null, null) : googleSheets;
        }
    }

    public enum StorageType { FILES, GOOGLE_SHEETS }

    /**
     * A Google spreadsheet, opened with a service account's JSON key. A relative {@code credentialsFile} is looked up
     * next to the jar first, then in the working directory.
     */
    /**
     * refreshSeconds: the shared copy of the spreadsheet older than this is read again in the background (a hand edit
     * shows up then); maxAgeSeconds: older than this it is read again before a request uses it (see GoogleSheetsStorage).
     */
    public record GoogleSheets(String spreadsheetId, String credentialsFile, Integer timeoutSeconds, boolean importLocalData,
                               Integer refreshSeconds, Integer maxAgeSeconds) {
        public GoogleSheets {
            credentialsFile = credentialsFile == null || credentialsFile.isBlank() ? "config/google-credentials.json" : credentialsFile;
            timeoutSeconds = timeoutSeconds == null ? 30 : timeoutSeconds;
            refreshSeconds = refreshSeconds == null ? 10 : Math.max(1, refreshSeconds);
            maxAgeSeconds = maxAgeSeconds == null ? 60 : Math.max(refreshSeconds, maxAgeSeconds);
        }
    }

    public Storage storage() {
        return storage == null ? new Storage(null, null) : storage;
    }

    /** Interest on money lent and owed. */
    public record Interest(DayCount dayCount) {
        public Interest {
            dayCount = dayCount == null ? DayCount.MONTHLY : dayCount;
        }
    }

    /** Evidence (photos, scans, PDFs) attached to entries. */
    public record Attachments(Integer maxFileMb, Integer maxPerEntry) {
        public Attachments {
            maxFileMb = maxFileMb == null ? 10 : maxFileMb;
            maxPerEntry = maxPerEntry == null ? 12 : maxPerEntry;
        }
    }

    public Interest interest() {
        return interest == null ? new Interest(null) : interest;
    }

    public Attachments attachments() {
        return attachments == null ? new Attachments(null, null) : attachments;
    }

    /** Roles are always enforced (see RolePolicy); these settings tune sessions and sign-in. */
    public record Security(int sessionHours, UserRole defaultUserRole, int maxFailedLogins, int lockMinutes) {
    }

    public record Seed(String adminUsername, String adminPassword, String tenantCode,
                       String tenantName, String currency, boolean demoData) {
    }
}
