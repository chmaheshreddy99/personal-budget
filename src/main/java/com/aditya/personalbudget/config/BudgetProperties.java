package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.type.DayCount;
import com.aditya.personalbudget.domain.type.UserRole;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed view of the {@code budget.*} settings in application.yml.
 */
@ConfigurationProperties(prefix = "budget")
public record BudgetProperties(String dataDir, Security security, Seed seed, Interest interest, Attachments attachments,
                               Storage storage, Backup backup) {

    /**
     * JSON backups of the whole data (Settings, Backup): the folder they are written to (relative to the app's root,
     * the folder holding {@code config}) and how many of them to keep (older ones are deleted; 0 keeps all).
     */
    public record Backup(String dir, Integer keep) {
        public Backup {
            dir = dir == null || dir.isBlank() ? "backups" : dir;
            keep = keep == null ? 30 : Math.max(0, keep);
        }
    }

    public Backup backup() {
        return backup == null ? new Backup(null, null) : backup;
    }

    /** Where the tables live: tab-separated files in the data folder (default) or a Google spreadsheet. */
    public record Storage(StorageType type, GoogleSheets googleSheets) {
        public Storage {
            type = type == null ? StorageType.FILES : type;
            googleSheets = googleSheets == null ? new GoogleSheets(null, null, null, false) : googleSheets;
        }
    }

    public enum StorageType { FILES, GOOGLE_SHEETS }

    /**
     * A Google spreadsheet, opened with a service account's JSON key. A relative {@code credentialsFile} is looked up
     * next to the jar first, then in the working directory.
     */
    public record GoogleSheets(String spreadsheetId, String credentialsFile, Integer timeoutSeconds, boolean importLocalData) {
        public GoogleSheets {
            credentialsFile = credentialsFile == null || credentialsFile.isBlank() ? "config/google-credentials.json" : credentialsFile;
            timeoutSeconds = timeoutSeconds == null ? 30 : timeoutSeconds;
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
