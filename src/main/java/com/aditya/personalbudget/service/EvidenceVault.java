package com.aditya.personalbudget.service;

import com.aditya.personalbudget.storage.StorageException;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

/**
 * The big parts of a signed record (its wording, signatures, the exact signed text, the signer's device), kept as one
 * small file per record under {@code data/evidence/<kind>/<household>/<id>.properties}, read when a record is opened and
 * never held in memory or in the tables. The tables keep only what lists and checks need (names, amounts, dates, state, the
 * SHA-256 fingerprint and seal), so listing a hundred records reads none of these files and the tables stay small however
 * many signatures are drawn. The seal and fingerprints in the row vouch for the document: one edited on disk no longer
 * matches them.
 */
@Service
public class EvidenceVault {

    private final Path root;

    public EvidenceVault(TsvDataStore store) {
        this.root = store.dataDir().resolve("evidence");
    }

    /** Adds (or replaces) the given fields of a record's document; fields not given stay as they are, null values are left out. */
    public synchronized void merge(String kind, Long tenantId, Long id, Map<String, String> fields) {
        Properties doc = new Properties();
        doc.putAll(read(kind, tenantId, id));
        fields.forEach((k, v) -> { if (v != null) doc.setProperty(k, v); });
        Path target = path(kind, tenantId, id);
        try {
            Files.createDirectories(target.getParent());
            Path temp = target.resolveSibling(target.getFileName() + ".tmp");
            try (Writer out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                doc.store(out, "Evidence of " + kind + " " + id + ": read on demand, never kept in memory");
            }
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new StorageException("Cannot write " + target, e);
        }
    }

    /** A record's document, read from disk now (empty when it has none). */
    public Map<String, String> read(String kind, Long tenantId, Long id) {
        Path file = path(kind, tenantId, id);
        Map<String, String> out = new LinkedHashMap<>();
        if (!Files.isRegularFile(file)) return out;
        Properties doc = new Properties();
        try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            doc.load(in);
        } catch (IOException e) {
            throw new StorageException("Cannot read " + file, e);
        }
        doc.stringPropertyNames().forEach(k -> out.put(k, doc.getProperty(k)));
        return out;
    }

    public void delete(String kind, Long tenantId, Long id) {
        try {
            Files.deleteIfExists(path(kind, tenantId, id));
        } catch (IOException e) {
            throw new StorageException("Cannot delete the evidence of " + kind + " " + id, e);
        }
    }

    private Path path(String kind, Long tenantId, Long id) {
        if (!kind.matches("[a-z0-9-]+")) throw new IllegalArgumentException("Not an evidence kind: " + kind);
        return root.resolve(kind).resolve(String.valueOf(tenantId)).resolve(id + ".properties");
    }
}
