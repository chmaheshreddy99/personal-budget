package com.aditya.personalbudget.config;

import com.aditya.personalbudget.domain.type.DayCount;
import com.aditya.personalbudget.domain.type.UserRole;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed view of the {@code budget.*} settings in application.yml.
 */
@ConfigurationProperties(prefix = "budget")
public record BudgetProperties(String dataDir, Security security, Seed seed, Interest interest, Attachments attachments) {

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
