package com.aditya.personalbudget.storage;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Constraint enforcement, persistence and rollback of the tab-separated file store.
 */
class TsvDataStoreTest {

    @TempDir
    Path dataDir;

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
    private TsvDataStore store;
    private OrganizationRepository tenants;
    private AppUserRepository users;

    @BeforeEach
    void setUp() {
        open();
    }

    private void open() {
        store = new TsvDataStore(dataDir.toString(), validator);
        tenants = new OrganizationRepository(store);
        users = new AppUserRepository(store);
    }

    private static Organization tenant(String code) {
        Organization t = new Organization();
        t.setCode(code);
        t.setName("Organization " + code);
        t.setCurrency("INR");
        t.setActive(true);
        t.setCreatedAt(LocalDateTime.now());
        return t;
    }

    private static AppUser user(Long tenantId, String username) {
        AppUser u = new AppUser();
        u.setTenantId(tenantId);
        u.setUsername(username);
        u.setFullName("User " + username);
        u.setPasswordHash("hash");
        u.setRole(UserRole.ADMIN);
        u.setActive(true);
        u.setCreatedAt(LocalDateTime.now());
        return u;
    }

    @Test
    void savesRowsToATabSeparatedFileWithHeaderAndReloadsThem() throws Exception {
        Organization saved = tenants.save(tenant("home"));
        assertThat(saved.getId()).isEqualTo(1L);

        List<String> lines = Files.readAllLines(dataDir.resolve("organizations.tbl"));
        assertThat(lines.getFirst()).isEqualTo("id\tcode\tname\tcurrency\tactive\tcreatedAt\tapprovalMode\tchitCompanyName\tfeatures\tversion");
        assertThat(lines.get(1)).startsWith("1\thome\tOrganization home\tINR\ttrue\t");

        open(); // a fresh store reads the file back
        assertThat(tenants.findByCode("home")).isPresent();
        assertThat(tenants.save(tenant("next")).getId()).isEqualTo(2L);
    }

    @Test
    void escapesTabsAndNewLinesInsideText() {
        Organization t = tenant("esc");
        t.setName("Line one\tand\nline two");
        tenants.save(t);
        open();
        assertThat(tenants.findByCode("esc").orElseThrow().getName()).isEqualTo("Line one\tand\nline two");
    }

    @Test
    void rejectsNullsInNotNullColumns() {
        Organization t = tenant("nulls");
        t.setName(null);
        assertThatThrownBy(() -> tenants.save(t))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("organizations.name");
    }

    @Test
    void rejectsTextLongerThanTheColumnLength() {
        Organization t = tenant("long");
        t.setName("x".repeat(101));
        assertThatThrownBy(() -> tenants.save(t))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("maximum length 100");
    }

    @Test
    void rejectsDuplicateUniqueKeysIgnoringCase() {
        tenants.save(tenant("home"));
        Organization duplicate = tenant("home");
        duplicate.setCode("home");
        assertThatThrownBy(() -> tenants.save(duplicate))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("unique key (code)");
    }

    @Test
    void enforcesBeanValidationChecks() {
        Organization t = tenant("BAD CODE!");
        assertThatThrownBy(() -> tenants.save(t))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("code");
    }

    @Test
    void enforcesForeignKeysOnInsertAndDelete() {
        assertThatThrownBy(() -> users.save(user(99L, "ghost")))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("refers to missing Organization #99");

        Organization home = tenants.save(tenant("home"));
        users.save(user(home.getId(), "admin"));
        assertThatThrownBy(() -> tenants.deleteById(home.getId()))
                .isInstanceOf(DataIntegrityException.class).hasMessageContaining("still referenced by app_users.organizationId");
    }

    @Test
    void rollsBackEveryTableWhenATransactionFails() {
        Organization home = tenants.save(tenant("home"));

        store.begin();
        try {
            users.save(user(home.getId(), "first"));
            tenants.save(tenant("second"));
            users.save(user(home.getId(), "first")); // duplicate username -> fails
        } catch (DataIntegrityException expected) {
            store.rollback();
        }

        assertThat(users.findAll()).isEmpty();
        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactly("home");
        open(); // nothing reached the files either
        assertThat(users.findAll()).isEmpty();
        assertThat(tenants.count()).isEqualTo(1);
    }

    @Test
    void returnsCopiesSoCallersCannotChangeCachedRows() {
        Organization saved = tenants.save(tenant("home"));
        saved.setName("Changed without saving");
        assertThat(tenants.findById(saved.getId()).orElseThrow().getName()).isEqualTo("Organization home");
    }

    @Test
    void refusesASaveBasedOnAnOlderVersion() {
        Organization saved = tenants.save(tenant("home"));
        assertThat(saved.getVersion()).isZero();
        Organization mine = tenants.findById(saved.getId()).orElseThrow();
        Organization theirs = tenants.findById(saved.getId()).orElseThrow();

        theirs.setName("Changed by someone else");
        assertThat(tenants.save(theirs).getVersion()).isEqualTo(1L);

        mine.setName("Changed from a stale screen");
        assertThatThrownBy(() -> tenants.save(mine)).isInstanceOf(ConcurrentUpdateException.class);
        assertThat(tenants.findById(saved.getId()).orElseThrow().getName()).isEqualTo("Changed by someone else");
    }

    @Test
    void seesChangesWrittenByAnotherStoreOnTheSameFiles() {
        tenants.save(tenant("home"));
        TsvDataStore other = new TsvDataStore(dataDir.toString(), validator);
        OrganizationRepository otherTenants = new OrganizationRepository(other);
        otherTenants.save(tenant("second"));   // e.g. another process writing the same data folder

        assertThat(tenants.findAll()).extracting(Organization::getCode).containsExactlyInAnyOrder("home", "second");
        assertThat(otherTenants.save(tenant("third")).getId()).isEqualTo(3L);   // ids are never handed out twice
    }

    @Test
    void aReadOnlyRequestCannotWrite() {
        store.beginReadOnly();
        try {
            assertThatThrownBy(() -> tenants.save(tenant("home"))).isInstanceOf(RuntimeException.class)
                    .hasMessageContaining("read-only");
        } finally {
            store.endRequest();
        }
        assertThat(tenants.count()).isZero();
    }
}
