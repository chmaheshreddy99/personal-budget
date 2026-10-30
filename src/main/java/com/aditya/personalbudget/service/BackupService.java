package com.aditya.personalbudget.service;

import com.aditya.personalbudget.PersonalBudgetApplication;
import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.StorageException;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Backups of the whole installation as one JSON file: every table (whichever storage holds it, files or a Google
 * spreadsheet), the id sequences and, when asked, the evidence files. They are written to the backup folder in the
 * app's root ({@code budget.backup.dir}, default {@code backups/} next to {@code config/}), can be downloaded, and
 * a backup (one on the server or one uploaded) restores the data exactly as it was.
 * <p>
 * A restore replaces every table in one unit of work: all or nothing. Before it, the current data is backed up
 * itself ({@code before-restore-...}), so a restore can be undone. Sign-in sessions are never part of a backup:
 * whoever is signed in stays signed in.
 */
@Service
public class BackupService {

    private static final Logger log = LoggerFactory.getLogger(BackupService.class);

    static final String FORMAT = "personal-budget-backup";
    static final int VERSION = 1;
    /** Sessions belong to this server's sign-ins, not to the data: neither backed up nor restored. */
    private static final Set<String> NOT_BACKED_UP = Set.of("user_sessions");
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9._-]{1,120}\\.json");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    /** One backup file as stored: the tables as cell text, header row first (null for an empty cell). */
    public record BackupFile(String format, Integer version, LocalDateTime createdAt, String createdBy, String storage,
                             Map<String, List<List<String>>> tables, Map<String, String> sequences,
                             /* path under the data folder -> Base64 bytes; null when the files were left out */
                             Map<String, String> files) {
    }

    /** A backup on the server, as listed in Settings. */
    public record BackupInfo(String name, long bytes, LocalDateTime createdAt) {
    }

    /** What a restore brought back. */
    public record RestoreResult(String restored, String safetyBackup, int tables, long rows, int files) {
    }

    private final TsvDataStore store;
    private final ObjectMapper json;
    private final BudgetProperties properties;

    public BackupService(TsvDataStore store, ObjectMapper json, BudgetProperties properties) {
        this.store = store;
        this.json = json;
        this.properties = properties;
    }

    /** The folder the backups are written to. */
    public Path folder() {
        return PersonalBudgetApplication.underRoot(properties.backup().dir());
    }

    // ================================================================== backups on the server

    public List<BackupInfo> list() {
        Path dir = folder();
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(dir)) {
            return files.filter(p -> NAME.matcher(p.getFileName().toString()).matches() && Files.isRegularFile(p))
                    .map(this::info)
                    .sorted(Comparator.comparing(BackupInfo::createdAt).reversed())
                    .toList();
        } catch (IOException e) {
            throw new StorageException("Cannot list the backups in " + dir, e);
        }
    }

    /** Writes a backup of the data as it is now. */
    public BackupInfo create(boolean includeFiles) {
        return info(write("backup", includeFiles));
    }

    /** The file of a backup on the server, for a download. */
    public Path file(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new BusinessException("Not a backup name: " + name);
        }
        Path file = folder().resolve(name);
        if (!Files.isRegularFile(file)) {
            throw new NotFoundException("Backup", name);
        }
        return file;
    }

    public void delete(String name) {
        try {
            Files.delete(file(name));
            log.info("Backup {} deleted by {}", name, UserContext.username());
        } catch (IOException e) {
            throw new StorageException("Cannot delete the backup " + name, e);
        }
    }

    // ================================================================== restore

    /** Restores a backup kept on the server. */
    public RestoreResult restore(String name) {
        BackupFile backup = read(file(name));
        return restore(backup, name);
    }

    /** Restores an uploaded backup; the upload is kept in the backup folder too. */
    public RestoreResult restoreUpload(InputStream upload, String originalName) {
        Path dir = ensureFolder();
        Path kept = dir.resolve("uploaded-" + OrgClock.now().format(STAMP) + ".json");
        try {
            Files.copy(upload, kept, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new StorageException("Cannot store the uploaded backup", e);
        }
        BackupFile backup;
        try {
            backup = read(kept);
        } catch (RuntimeException e) {
            deleteQuietly(kept);   // not a backup: do not keep it
            throw e;
        }
        log.info("Backup uploaded by {} ({}), kept as {}", UserContext.username(), originalName, kept.getFileName());
        return restore(backup, kept.getFileName().toString());
    }

    private RestoreResult restore(BackupFile backup, String name) {
        // the data as it is now, first: a restore can always be undone with this one
        Path safety = write("before-restore", backup.files() != null);
        Properties sequences = new Properties();
        backup.sequences().forEach(sequences::setProperty);
        Map<String, List<List<String>>> tables = new TreeMap<>();
        backup.tables().forEach((table, rows) -> tables.put(table, cells(rows)));
        Set<String> written;
        try {
            written = store.replaceAll(new TsvDataStore.Dump(tables, sequences), NOT_BACKED_UP);
        } catch (StorageException e) {
            throw new BusinessException("The backup could not be restored, nothing was changed: " + e.getMessage());
        }
        int files = backup.files() == null ? 0 : restoreFiles(backup.files());
        long rows = tables.entrySet().stream().filter(e -> written.contains(e.getKey()))
                .mapToLong(e -> Math.max(0, e.getValue().size() - 1)).sum();
        log.info("Backup {} restored by {}: {} table(s), {} row(s), {} file(s); the data before it is in {}",
                name, UserContext.username(), written.size(), rows, files, safety.getFileName());
        return new RestoreResult(name, safety.getFileName().toString(), written.size(), rows, files);
    }

    // ================================================================== reading and writing backup files

    private Path write(String prefix, boolean includeFiles) {
        TsvDataStore.Dump dump = store.dump();
        Map<String, List<List<String>>> tables = new TreeMap<>();
        dump.tables().forEach((table, rows) -> {
            if (!NOT_BACKED_UP.contains(table)) {
                tables.put(table, rows.stream().map(row -> row.stream().map(c -> c == null || c.isEmpty() ? null : c).toList()).toList());
            }
        });
        Map<String, String> sequences = new TreeMap<>();
        dump.sequences().forEach((k, v) -> sequences.put(k.toString(), v.toString()));
        BackupFile backup = new BackupFile(FORMAT, VERSION, OrgClock.now(), UserContext.username(),
                properties.storage().type().name().toLowerCase().replace('_', '-'), tables, sequences,
                readFiles(includeFiles));

        Path dir = ensureFolder();
        String stamp = OrgClock.now().format(STAMP);
        Path file = dir.resolve(prefix + "-" + stamp + ".json");
        for (int i = 2; Files.exists(file); i++) {
            file = dir.resolve(prefix + "-" + stamp + "-" + i + ".json");
        }
        Path temp = dir.resolve(file.getFileName() + ".tmp");
        try {
            json.writerWithDefaultPrettyPrinter().writeValue(temp.toFile(), backup);
            Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
        } catch (JacksonException | IOException e) {
            deleteQuietly(temp);
            throw new StorageException("Cannot write the backup " + file, e);
        }
        log.info("Backup written: {} ({} table(s){})", file, tables.size(), includeFiles ? ", with the evidence files" : "");
        prune();
        return file;
    }

    private BackupFile read(Path file) {
        BackupFile backup;
        try {
            backup = json.readValue(file.toFile(), BackupFile.class);
        } catch (JacksonException e) {
            throw new BusinessException("This is not a Personal Budget backup (the file is not valid JSON): " + e.getOriginalMessage());
        }
        if (backup == null || !FORMAT.equals(backup.format()) || backup.tables() == null || backup.sequences() == null) {
            throw new BusinessException("This is not a Personal Budget backup");
        }
        if (backup.version() == null || backup.version() > VERSION) {
            throw new BusinessException("This backup was made by a newer version of the app (format " + backup.version() + ")");
        }
        if (backup.tables().getOrDefault("organizations", List.of()).size() < 2) {
            throw new BusinessException("This backup holds no organization: restoring it would leave nobody able to sign in");
        }
        return backup;
    }

    /** JSON nulls back to empty cells, the way the storage holds them. */
    private static List<List<String>> cells(List<List<String>> rows) {
        List<List<String>> out = new ArrayList<>(rows.size());
        for (List<String> row : rows) {
            out.add(row == null ? List.of() : row.stream().map(c -> c == null ? "" : c).toList());
        }
        return out;
    }

    // ------------------------------------------------------------------ evidence files

    /** Folders under the data folder a backup carries: the signed documents always, the photos and scans when asked. */
    private static final List<String> DOCUMENTS = List.of("vault", "evidence");
    private static final String PHOTOS = "attachments";

    /**
     * The files under the data folder, by path relative to it: the agreements, signatures and evidence kept out of the tables (data/vault,
     * data/evidence) always, since the tables alone are not the whole record; the photos and scans (data/attachments) when asked.
     */
    private Map<String, String> readFiles(boolean includePhotos) {
        Path data = store.dataDir();
        Map<String, String> files = new LinkedHashMap<>();
        List<String> folders = new ArrayList<>(DOCUMENTS);
        if (includePhotos) folders.add(PHOTOS);
        for (String folder : folders) {
            Path dir = data.resolve(folder);
            if (!Files.isDirectory(dir)) continue;
            try (Stream<Path> all = Files.walk(dir)) {
                for (Path p : all.filter(Files::isRegularFile).filter(p -> !p.getFileName().toString().endsWith(".tmp")).sorted().toList()) {
                    files.put(data.relativize(p).toString().replace('\\', '/'), Base64.getEncoder().encodeToString(Files.readAllBytes(p)));
                }
            } catch (IOException e) {
                throw new StorageException("Cannot read the files in " + folder + " for the backup", e);
            }
        }
        return files;
    }

    private int restoreFiles(Map<String, String> files) {
        Path data = store.dataDir();
        int count = 0;
        for (Map.Entry<String, String> f : files.entrySet()) {
            Path target = data.resolve(f.getKey()).normalize();
            boolean allowed = target.startsWith(data.resolve(PHOTOS)) || DOCUMENTS.stream().anyMatch(d -> target.startsWith(data.resolve(d)));
            if (!allowed) {
                log.warn("Backup file {} skipped: not an evidence file", f.getKey());
                continue;
            }
            try {
                Files.createDirectories(target.getParent());
                Files.write(target, Base64.getDecoder().decode(f.getValue()));
                count++;
            } catch (IOException | IllegalArgumentException e) {
                log.warn("Backup file {} could not be restored: {}", f.getKey(), e.getMessage());
            }
        }
        return count;
    }

    // ------------------------------------------------------------------ the folder

    private Path ensureFolder() {
        Path dir = folder();
        try {
            Files.createDirectories(dir);
            return dir;
        } catch (IOException e) {
            throw new StorageException("Cannot create the backup folder " + dir, e);
        }
    }

    /** Keeps the newest {@code budget.backup.keep} backups. */
    private void prune() {
        int keep = properties.backup().keep();
        if (keep <= 0) {
            return;
        }
        List<BackupInfo> all = list();
        for (BackupInfo old : all.subList(Math.min(keep, all.size()), all.size())) {
            deleteQuietly(folder().resolve(old.name()));
        }
    }

    private BackupInfo info(Path file) {
        try {
            return new BackupInfo(file.getFileName().toString(), Files.size(file),
                    LocalDateTime.ofInstant(Files.getLastModifiedTime(file).toInstant(), OrgClock.storageZone()));
        } catch (IOException e) {
            throw new StorageException("Cannot read " + file, e);
        }
    }

    private static void deleteQuietly(Path file) {
        try {
            Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // a leftover file does no harm
        }
    }
}
