package com.aditya.personalbudget.storage;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Stream;

/**
 * The default storage: one tab-separated file per table ({@code data/<table>.tbl}) and the id sequences in
 * {@code data/sequences.properties}.
 * <p>
 * A table file is the header line with the column names, then one row per line, cells separated by tabs. Every write
 * goes to a temp file that is then swapped in, so a reader never sees a half-written table.
 */
public final class LocalFileStorage implements TableStorage {

    static final String EXTENSION = ".tbl";
    static final String SEQUENCE_FILE = "sequences.properties";
    private static final String SEPARATOR = "\t";

    /** Identifies one version of a file on disk; it changes whenever the file is rewritten. */
    private record Stamp(Instant modified, long size, Object fileKey) {
    }

    private final Path dataDir;

    public LocalFileStorage(Path dataDir) {
        this.dataDir = dataDir.toAbsolutePath().normalize();
        try {
            Files.createDirectories(this.dataDir);
        } catch (IOException e) {
            throw new StorageException("Cannot create data directory " + this.dataDir, e);
        }
        StorageRenames.apply(this.dataDir, SEQUENCE_FILE);   // before any table is opened (and created empty)
    }

    @Override
    public String describe() {
        return "Tab-separated files at " + dataDir + " (a table is read again whenever its file changes)";
    }

    /** The names of the tables that have a file in the data folder. */
    public List<String> tableNames() {
        try (Stream<Path> files = Files.list(dataDir)) {
            return files.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(EXTENSION))
                    .map(n -> n.substring(0, n.length() - EXTENSION.length())).sorted().toList();
        } catch (IOException e) {
            throw new StorageException("Cannot list " + dataDir, e);
        }
    }

    @Override
    public void create(String table, List<String> header) {
        if (Files.notExists(file(table))) {
            writeTable(table, List.of(header));
        }
    }

    @Override
    public Object stamp(String table) {
        try {
            BasicFileAttributes attrs = Files.readAttributes(file(table), BasicFileAttributes.class);
            return new Stamp(attrs.lastModifiedTime().toInstant(), attrs.size(), attrs.fileKey());
        } catch (NoSuchFileException e) {
            return null;
        } catch (IOException e) {
            throw new StorageException("Cannot read attributes of " + file(table), e);
        }
    }

    @Override
    public List<List<String>> read(String table) {
        Path file = file(table);
        try {
            if (Files.notExists(file)) {
                return List.of();
            }
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            List<List<String>> rows = new ArrayList<>(lines.size());
            for (int i = 0; i < lines.size(); i++) {
                String line = lines.get(i);
                if (i == 0 || !line.isBlank()) {
                    rows.add(Arrays.asList(line.split(SEPARATOR, -1)));
                }
            }
            return rows;
        } catch (IOException e) {
            throw new StorageException("Cannot load table file " + file, e);
        }
    }

    @Override
    public void write(Map<String, List<List<String>>> tables, Properties sequences) {
        tables.forEach(this::writeTable);
        if (sequences != null) {
            writeSequences(sequences);
        }
    }

    @Override
    public Properties readSequences() {
        Properties p = new Properties();
        Path file = dataDir.resolve(SEQUENCE_FILE);
        if (Files.exists(file)) {
            try (InputStream in = Files.newInputStream(file)) {
                p.load(in);
            } catch (IOException e) {
                throw new StorageException("Cannot read " + file, e);
            }
        }
        return p;
    }

    @Override
    public Footprint footprint() {
        int files = 0;
        long bytes = 0;
        for (String table : tableNames()) {
            try {
                bytes += Files.size(file(table));
                files++;
            } catch (IOException ignored) {
                // a file removed meanwhile simply does not count
            }
        }
        return new Footprint(files, bytes);
    }

    // ------------------------------------------------------------------ internals

    private Path file(String table) {
        return dataDir.resolve(table + EXTENSION);
    }

    private void writeTable(String table, List<List<String>> rows) {
        Path file = file(table);
        Path temp = file.resolveSibling(file.getFileName() + ".tmp");
        try (BufferedWriter out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8)) {
            for (List<String> row : rows) {
                out.write(String.join(SEPARATOR, row));
                out.newLine();
            }
        } catch (IOException e) {
            throw new StorageException("Cannot write table file " + temp, e);
        }
        try {
            dateAfter(file, temp);
        } catch (IOException e) {
            throw new StorageException("Cannot date table file " + temp, e);
        }
        swap(temp, file);
    }

    /**
     * A rewritten table must never carry the stamp of the version it replaces, or a reader (in this process or
     * another one) would take its parsed copy of the old version for the new one: the clock may not have moved since
     * the old version was written (on Windows it moves in steps of up to 15 ms) and the size may well be the same.
     * So the new file is always dated after the one it replaces.
     */
    private static void dateAfter(Path previous, Path temp) throws IOException {
        FileTime before;
        try {
            before = Files.getLastModifiedTime(previous);
        } catch (NoSuchFileException e) {
            return;
        }
        if (Files.getLastModifiedTime(temp).compareTo(before) <= 0) {
            Files.setLastModifiedTime(temp, FileTime.from(before.toInstant().plusMillis(1)));
            if (Files.getLastModifiedTime(temp).compareTo(before) <= 0) {   // a file system keeping whole seconds only
                Files.setLastModifiedTime(temp, FileTime.from(before.toInstant().plusSeconds(2)));
            }
        }
    }

    private void writeSequences(Properties sequences) {
        Path file = dataDir.resolve(SEQUENCE_FILE);
        Path temp = dataDir.resolve(SEQUENCE_FILE + ".tmp");
        try (OutputStream out = Files.newOutputStream(temp)) {
            sequences.store(out, "Last id handed out per table; ids are never reused");
        } catch (IOException e) {
            throw new StorageException("Cannot write " + temp, e);
        }
        swap(temp, file);
    }

    private static void swap(Path temp, Path file) {
        try {
            try {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new StorageException("Cannot replace " + file, e);
        }
    }
}
