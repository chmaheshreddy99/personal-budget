package com.aditya.personalbudget.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Renames of tables and columns, applied to the data folder when the store opens, before any table is read or
 * created. Each rename is done once: a table file is moved only while the new one does not exist yet, a column only
 * while the header still has the old name. Files are rewritten through a temp file and swapped in.
 * <ul>
 *   <li>Tenants became organizations: {@code tenants} → {@code organizations}, {@code tenant_mail_settings} →
 *       {@code organization_mail_settings}, and the {@code tenantId} column of every table → {@code organizationId}.</li>
 * </ul>
 */
final class StorageRenames {

    private static final Logger log = LoggerFactory.getLogger(StorageRenames.class);

    private static final Map<String, String> TABLES = Map.of(
            "tenants", "organizations",
            "tenant_mail_settings", "organization_mail_settings");
    private static final Map<String, String> COLUMNS = Map.of("tenantId", "organizationId");

    private StorageRenames() {
    }

    static void apply(Path dataDir, String sequenceFile) {
        try {
            int tables = 0;
            for (Map.Entry<String, String> t : TABLES.entrySet()) {
                Path from = dataDir.resolve(t.getKey() + TsvTable.EXTENSION);
                Path to = dataDir.resolve(t.getValue() + TsvTable.EXTENSION);
                if (Files.exists(from) && Files.notExists(to)) {
                    Files.move(from, to);
                    tables++;
                }
            }
            int files = 0;
            try (DirectoryStream<Path> all = Files.newDirectoryStream(dataDir, "*" + TsvTable.EXTENSION)) {
                for (Path file : all) {
                    if (renameColumns(file)) {
                        files++;
                    }
                }
            }
            renameSequences(dataDir.resolve(sequenceFile));
            if (tables + files > 0) {
                log.info("Tenants are organizations now: renamed {} table(s) and the tenantId column in {} table(s)", tables, files);
            }
        } catch (IOException e) {
            throw new StorageException("Cannot rename tables and columns in " + dataDir, e);
        }
    }

    /** Renames the columns in the header line; the rows are untouched (columns are matched by header name). */
    private static boolean renameColumns(Path file) throws IOException {
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        if (lines.isEmpty()) {
            return false;
        }
        String[] header = lines.getFirst().split("\t", -1);
        boolean changed = false;
        for (int i = 0; i < header.length; i++) {
            String renamed = COLUMNS.get(header[i].strip());
            if (renamed != null && !Arrays.asList(header).contains(renamed)) {
                header[i] = renamed;
                changed = true;
            }
        }
        if (!changed) {
            return false;
        }
        List<String> out = new ArrayList<>(lines);
        out.set(0, String.join("\t", header));
        Path temp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.write(temp, out, StandardCharsets.UTF_8);
        swap(temp, file);
        return true;
    }

    /** The id sequences are kept per table name. */
    private static void renameSequences(Path file) throws IOException {
        if (Files.notExists(file)) {
            return;
        }
        Properties p = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            p.load(in);
        }
        boolean changed = false;
        for (Map.Entry<String, String> t : TABLES.entrySet()) {
            String value = p.getProperty(t.getKey());
            if (value != null && p.getProperty(t.getValue()) == null) {
                p.setProperty(t.getValue(), value);
                p.remove(t.getKey());
                changed = true;
            }
        }
        if (changed) {
            Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            try (OutputStream out = Files.newOutputStream(temp)) {
                p.store(out, "Last id handed out per table; ids are never reused");
            }
            swap(temp, file);
        }
    }

    private static void swap(Path temp, Path file) throws IOException {
        try {
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
