package com.aditya.personalbudget.storage;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link Vaulted} fields: kept in the record's own file, never in the table (on disk or in memory), read back on every read, dropped with
 * the record; a rolled-back save leaves no file; and rows written before a field was vaulted are moved out at start-up.
 */
class VaultedFieldsTest {

    @TempDir
    Path dir;

    @Entity
    @Table(name = "vault_notes")
    public static class Note implements Identifiable {
        @Id
        @GeneratedValue
        private Long id;
        @Column(nullable = false, length = 40)
        private String title;
        @Vaulted
        @Column(length = 20000)
        private String signature;

        public Note() {
        }

        public Long getId() { return id; }
        public void setId(Long id) { this.id = id; }
        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getSignature() { return signature; }
        public void setSignature(String signature) { this.signature = signature; }
    }

    /** The same entity before its field was vaulted: same table, plain column. */
    @Entity
    @Table(name = "vault_notes")
    public static class OldNote implements Identifiable {
        @Id
        @GeneratedValue
        private Long id;
        @Column(nullable = false, length = 40)
        private String title;
        @Column(length = 20000)
        private String signature;

        public OldNote() {
        }

        public Long getId() { return id; }
        public void setId(Long id) { this.id = id; }
        public void setTitle(String title) { this.title = title; }
        public void setSignature(String signature) { this.signature = signature; }
    }

    private TsvDataStore open() {
        TsvDataStore store = new TsvDataStore(dir.toString(), Validation.buildDefaultValidatorFactory().getValidator());
        store.register(Note.class);
        return store;
    }

    private static Note note(String title, String signature) {
        Note n = new Note();
        n.setTitle(title);
        n.setSignature(signature);
        return n;
    }

    @Test
    void theSignatureLivesInItsOwnFileNotInTheTable() throws Exception {
        TsvDataStore store = open();
        String sign = "M10 10 L200 120 L400 60 ".repeat(50);
        Note saved = store.save(Note.class, note("Agreement", sign));
        assertThat(saved.getSignature()).isEqualTo(sign);   // the caller gets it back

        String table = Files.readString(dir.resolve("vault_notes.tbl"));
        assertThat(table).contains("Agreement").doesNotContain("L200 120");
        Path file = dir.resolve("vault").resolve("vault_notes").resolve(saved.getId() + ".properties");
        assertThat(Files.readString(file)).contains("L200 120");

        // read on demand, also by a fresh store (nothing cached)
        assertThat(open().findById(Note.class, saved.getId()).orElseThrow().getSignature()).isEqualTo(sign);
        assertThat(open().findAll(Note.class, n -> true)).singleElement().satisfies(n -> assertThat(n.getSignature()).isEqualTo(sign));

        // cleared, then deleted with its record
        saved.setSignature(null);
        store.save(Note.class, saved);
        assertThat(store.findById(Note.class, saved.getId()).orElseThrow().getSignature()).isNull();
        Note again = store.save(Note.class, note("Second", "M1 1 L2 2"));
        store.deleteById(Note.class, again.getId());
        assertThat(dir.resolve("vault").resolve("vault_notes").resolve(again.getId() + ".properties")).doesNotExist();
    }

    @Test
    void aRolledBackSaveWritesNoFile() {
        TsvDataStore store = open();
        store.begin();
        Note n = store.save(Note.class, note("Draft", "M5 5 L6 6"));
        assertThat(store.findById(Note.class, n.getId()).orElseThrow().getSignature()).isEqualTo("M5 5 L6 6");   // seen inside the transaction
        store.rollback();
        assertThat(dir.resolve("vault").resolve("vault_notes").resolve(n.getId() + ".properties")).doesNotExist();
        assertThat(store.findById(Note.class, n.getId())).isEmpty();
    }

    @Test
    void rowsWrittenBeforeTheFieldWasVaultedAreMovedOutWithoutLosingAnything() throws Exception {
        TsvDataStore old = new TsvDataStore(dir.toString(), Validation.buildDefaultValidatorFactory().getValidator());
        old.register(OldNote.class);
        OldNote legacy = new OldNote();
        legacy.setTitle("Old agreement");
        legacy.setSignature("M7 7 L8 8 legacy");
        Long id = old.save(OldNote.class, legacy).getId();
        assertThat(Files.readString(dir.resolve("vault_notes.tbl"))).contains("legacy");

        TsvDataStore store = open();
        assertThat(store.findById(Note.class, id).orElseThrow().getSignature()).isEqualTo("M7 7 L8 8 legacy");   // still read from the column
        assertThat(store.vaultLegacyRows()).isEqualTo(1);
        assertThat(Files.readString(dir.resolve("vault_notes.tbl"))).doesNotContain("legacy");
        assertThat(open().findById(Note.class, id).orElseThrow().getSignature()).isEqualTo("M7 7 L8 8 legacy");   // now from its file
        assertThat(store.vaultLegacyRows()).isZero();
    }
}
