package com.aditya.personalbudget.storage;

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

/** The files of {@link Vaulted} fields: one small properties file a record, written atomically, read on demand and never cached. */
final class VaultFiles {

    private final Path root;

    VaultFiles(Path root) {
        this.root = root;
    }

    Map<String, String> read(String table, Long id) {
        Path file = path(table, id);
        Map<String, String> out = new LinkedHashMap<>();
        if (!Files.isRegularFile(file)) return out;
        Properties p = new Properties();
        try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            p.load(in);
        } catch (IOException e) {
            throw new StorageException("Cannot read " + file, e);
        }
        p.stringPropertyNames().forEach(k -> out.put(k, p.getProperty(k)));
        return out;
    }

    void write(String table, Long id, Map<String, String> fields) {
        if (fields.isEmpty()) {
            delete(table, id);
            return;
        }
        Path file = path(table, id);
        Properties p = new Properties();
        p.putAll(fields);
        try {
            Files.createDirectories(file.getParent());
            Path temp = file.resolveSibling(file.getFileName() + ".tmp");
            try (Writer out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
                p.store(out, table + " " + id);
            }
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new StorageException("Cannot write " + file, e);
        }
    }

    void delete(String table, Long id) {
        try {
            Files.deleteIfExists(path(table, id));
        } catch (IOException e) {
            throw new StorageException("Cannot delete the vault file of " + table + " " + id, e);
        }
    }

    private Path path(String table, Long id) {
        if (!table.matches("[A-Za-z0-9_]+")) throw new IllegalArgumentException("Not a table: " + table);
        return root.resolve(table).resolve(id + ".properties");
    }
}
