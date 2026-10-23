package com.aditya.personalbudget;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BackupService;
import com.aditya.personalbudget.service.OrgClock;
import com.aditya.personalbudget.service.OrgTimeZoneService;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Backups (a JSON file of every table, restored all or nothing, with a safety backup first) and the organization's
 * time zone (the times recorded are its local times).
 */
@SpringBootTest
class BackupAndTimeZoneTests {

    static Path backups;

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) throws Exception {
        Path dir = Files.createTempDirectory("pb-backup-test-");
        backups = dir.resolve("backups");
        registry.add("budget.data-dir", () -> dir.resolve("data").toString());
        registry.add("budget.backup.dir", backups::toString);
        registry.add("budget.seed.demo-data", () -> "false");
    }

    @Autowired OrganizationRepository tenants;
    @Autowired AppUserRepository users;
    @Autowired AccountRepository accountRows;
    @Autowired AccountService accounts;
    @Autowired BackupService backup;
    @Autowired OrgTimeZoneService timeZones;
    @Autowired TsvDataStore store;

    @BeforeEach
    void signIn() {
        AppUser admin = users.findByUsername("admin").orElseThrow();
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        UserContext.set(new CurrentUser(admin.getId(), "admin", "Admin", UserRole.SUPER_ADMIN, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false, null, false));
    }

    @AfterEach
    void signOut() {
        timeZones.save(new OrgTimeZoneService.TimeZoneRequest(null));
        UserContext.clear();
    }

    @Test
    void aBackupRestoresTheDataAsItWasAndKeepsWhatWasThereBeforeAsABackup() throws Exception {
        String kept = "Kept " + System.nanoTime();
        Long keptId = accounts.create(account(kept)).id();
        BackupService.BackupInfo saved = backup.create(false);
        assertThat(backups.resolve(saved.name())).exists();
        assertThat(Files.readString(backups.resolve(saved.name()))).contains("\"format\" : \"personal-budget-backup\"", kept)
                .doesNotContain("\"user_sessions\"");

        String later = "Later " + System.nanoTime();
        Long laterId = accounts.create(account(later)).id();
        accountRows.deleteById(keptId);

        BackupService.RestoreResult result = backup.restore(saved.name());
        assertThat(accountRows.findById(keptId)).map(a -> a.getName()).hasValue(kept);
        assertThat(accountRows.findById(laterId)).isEmpty();
        assertThat(result.tables()).isGreaterThan(10);
        // what was there before the restore is a backup of its own, and the ids handed out never come back
        assertThat(Files.readString(backups.resolve(result.safetyBackup()))).contains(later);
        Long next = accounts.create(account("After " + System.nanoTime())).id();
        assertThat(next).isGreaterThan(laterId);
    }

    @Test
    void anUploadThatIsNotABackupChangesNothing() {
        long before = accountRows.count();
        assertThatThrownBy(() -> backup.restoreUpload(new ByteArrayInputStream("{\"hello\":1}".getBytes(StandardCharsets.UTF_8)), "x.json"))
                .isInstanceOf(BusinessException.class).hasMessageContaining("not a Personal Budget backup");
        assertThatThrownBy(() -> backup.restoreUpload(new ByteArrayInputStream("not json".getBytes(StandardCharsets.UTF_8)), "y.json"))
                .isInstanceOf(BusinessException.class);
        assertThat(accountRows.count()).isEqualTo(before);
        assertThat(backup.list()).noneMatch(b -> b.name().startsWith("uploaded"));
    }

    @Test
    void timesAreRecordedInTheOrganizationsTimeZone() {
        String far = ZoneId.systemDefault().getId().equals("Pacific/Kiritimati") ? "Pacific/Pago_Pago" : "Pacific/Kiritimati";
        OrgTimeZoneService.TimeZoneView view = timeZones.save(new OrgTimeZoneService.TimeZoneRequest(far));
        assertThat(view.timeZone()).isEqualTo(far);
        assertThat(OrgClock.zone()).isEqualTo(ZoneId.of(far));
        assertThat(Duration.between(LocalDateTime.now(ZoneId.of(far)), OrgClock.now()).abs()).isLessThan(Duration.ofMinutes(1));
        Long id = accounts.create(account("Zoned " + System.nanoTime())).id();
        LocalDateTime created = accountRows.findById(id).orElseThrow().getCreatedAt();
        assertThat(Duration.between(LocalDateTime.now(ZoneId.of(far)), created).abs()).isLessThan(Duration.ofMinutes(1));

        assertThatThrownBy(() -> timeZones.save(new OrgTimeZoneService.TimeZoneRequest("Mars/Olympus"))).isInstanceOf(BusinessException.class);
        assertThat(timeZones.save(new OrgTimeZoneService.TimeZoneRequest("")).timeZone()).isNull();
        assertThat(OrgClock.zone()).isEqualTo(ZoneId.systemDefault());
    }

    @Test
    void aOneOffStepIsRecordedWithTheData() {
        String step = "test-step-" + System.nanoTime();
        assertThat(store.isDone(step)).isFalse();
        store.markDone(step);
        assertThat(store.isDone(step)).isTrue();
        assertThat(store.dump().sequences().getProperty("done." + step)).isNotBlank();
    }

    private static AccountRequest account(String name) {
        return new AccountRequest(null, name, AccountType.BANK, "SBI", null, null, null, null, null, null, null, null, true, null);
    }
}
