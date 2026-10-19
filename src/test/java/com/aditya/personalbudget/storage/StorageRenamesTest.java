package com.aditya.personalbudget.storage;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** A data folder written while organizations were tenants opens with its tables and columns renamed, once. */
class StorageRenamesTest {

    @TempDir
    Path dataDir;

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void anOldDataFolderIsRenamedAndReadsAsBefore() throws Exception {
        Files.write(dataDir.resolve("tenants.tbl"), List.of(
                "id\tcode\tname\tcurrency\tactive\tcreatedAt\tversion",
                "1\thome\tMy Household\tINR\ttrue\t2026-01-01T10:00\t0"));
        Files.write(dataDir.resolve("app_users.tbl"), List.of(
                "id\ttenantId\tusername\tfullName\trole\tactive\tcreatedAt\tversion",
                "1\t1\tadmin\tAdmin\tADMIN\ttrue\t2026-01-01T10:00\t0"));
        Files.write(dataDir.resolve("sequences.properties"), List.of("tenants=1", "app_users=1"));

        TsvDataStore store = new TsvDataStore(dataDir.toString(), validator);
        OrganizationRepository organizations = new OrganizationRepository(store);
        AppUserRepository users = new AppUserRepository(store);

        assertThat(dataDir.resolve("tenants.tbl")).doesNotExist();
        assertThat(Files.readAllLines(dataDir.resolve("organizations.tbl")).getFirst()).startsWith("id\tcode\tname");
        assertThat(Files.readAllLines(dataDir.resolve("app_users.tbl")).getFirst()).startsWith("id\torganizationId\tusername");
        assertThat(Files.readString(dataDir.resolve("sequences.properties"))).contains("organizations=1").doesNotContain("tenants=");

        Organization org = organizations.findById(1L).orElseThrow();
        assertThat(org.getName()).isEqualTo("My Household");
        AppUser admin = users.findById(1L).orElseThrow();
        assertThat(admin.getTenantId()).isEqualTo(1L);

        // a new organization takes the next id, and opening again changes nothing
        Organization next = new Organization();
        next.setCode("office");
        next.setName("Office");
        next.setCurrency("INR");
        next.setActive(true);
        next.setCreatedAt(java.time.LocalDateTime.now());
        assertThat(organizations.save(next).getId()).isEqualTo(2L);
        new TsvDataStore(dataDir.toString(), validator);
        assertThat(new OrganizationRepository(store).findAll()).hasSize(2);
    }
}
