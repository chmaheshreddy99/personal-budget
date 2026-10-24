package com.aditya.personalbudget.storage;

import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.googleapis.json.GoogleJsonResponseException;
import com.google.api.client.http.HttpRequestInitializer;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.sheets.v4.Sheets;
import com.google.api.services.sheets.v4.SheetsScopes;
import com.google.api.services.sheets.v4.model.AddSheetRequest;
import com.google.api.services.sheets.v4.model.BatchGetValuesResponse;
import com.google.api.services.sheets.v4.model.BatchUpdateSpreadsheetRequest;
import com.google.api.services.sheets.v4.model.BatchUpdateSpreadsheetResponse;
import com.google.api.services.sheets.v4.model.BatchUpdateValuesRequest;
import com.google.api.services.sheets.v4.model.GridProperties;
import com.google.api.services.sheets.v4.model.Request;
import com.google.api.services.sheets.v4.model.Response;
import com.google.api.services.sheets.v4.model.Sheet;
import com.google.api.services.sheets.v4.model.SheetProperties;
import com.google.api.services.sheets.v4.model.Spreadsheet;
import com.google.api.services.sheets.v4.model.UpdateSheetPropertiesRequest;
import com.google.api.services.sheets.v4.model.ValueRange;
import com.google.auth.http.HttpCredentialsAdapter;
import com.google.auth.oauth2.ServiceAccountCredentials;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;

/**
 * Keeps the tables in a Google spreadsheet: one tab per table (header row first, then one row per entity, exactly
 * like a {@code .tbl} file) and the id sequences in the {@code _sequences} tab. Missing tabs are added on start.
 * <p>
 * The app signs in as a Google Cloud <i>service account</i> (its JSON key file); the spreadsheet must be shared
 * with that account's e-mail address as an Editor.
 * <p>
 * Reading: one API call fetches every table tab. What it read is a <i>snapshot</i> that never changes afterwards; a
 * request pins the snapshot it first reads for the rest of the request ({@link #forget()} unpins it), so it sees
 * every table as of one moment. Requests share the latest snapshot while it is younger than {@code maxAge}, or until
 * the next save when maxAge is negative (then only saves read the spreadsheet): a page that sends ten calls at once
 * costs one read at most, not ten, and only one thread reads the spreadsheet at a time while the others wait for its
 * result. Each table in a snapshot carries a version that changes only when its content
 * does, so the store parses again only the tables that changed.
 * <p>
 * Saving: a unit of work always starts on a snapshot read afresh ({@link #refresh()}), never on a shared one, so
 * every check of a save (versions, unique keys, references, ids) runs against what the spreadsheet holds at that
 * moment. Only the rows that differ from that snapshot are written, in one call, and what was written becomes the
 * latest snapshot at once: every request sees a save made through the app right away. An edit made by hand in the
 * spreadsheet shows once the shared snapshot is older than {@code maxAge}, or with the next save, whichever comes first
 * (with a negative maxAge: with the next save, or after a restart).
 * <p>
 * Cell text is stored as is ({@code valueInputOption=RAW}): nothing is parsed as a number, date or formula, and a
 * line break in a note is a real line break in the cell.
 */
public final class GoogleSheetsStorage implements TableStorage {

    private static final Logger log = LoggerFactory.getLogger(GoogleSheetsStorage.class);

    static final String SEQUENCES = "_sequences";
    /** Google Sheets refuses a cell longer than this. */
    private static final int MAX_CELL = 50_000;
    /** Cells per write call: a large import goes in several calls. */
    private static final int MAX_CELLS_PER_CALL = 200_000;
    /** Rows added to a full tab beyond what it needs right now, so it is not resized on every insert. */
    private static final int ROW_HEADROOM = 500;
    private static final int RETRIES = 6;

    /** The layout of a tab (no data). */
    private static final class Tab {
        final int sheetId;
        int gridRows;
        int gridCols;

        Tab(int sheetId, int gridRows, int gridCols) {
            this.sheetId = sheetId;
            this.gridRows = gridRows;
            this.gridCols = gridCols;
        }
    }

    /**
     * One tab's content: header first, trailing empty cells and rows left out. Two tables with the same version have
     * the same rows: a version is reused only for rows equal to the ones it was given to.
     */
    private record Table(List<List<String>> rows, long version) {
    }

    /**
     * The tables as of one moment, never changed once made, so any thread may use it. {@code seq} orders snapshots
     * (a newer one is never replaced by an older one); {@code takenAt} is when its data was read.
     */
    private record Snapshot(Map<String, Table> tables, long seq, long takenAt) {

        List<List<String>> rows(String table) {
            Table t = tables.get(table);
            return t == null ? List.of() : t.rows();
        }
    }

    @FunctionalInterface
    private interface ApiCall<T> {
        T run() throws IOException;
    }

    private final Sheets sheets;
    private final String spreadsheetId;
    private final String account;
    private final String title;
    /** Guarded by {@code this}: the spreadsheet's layout. */
    private final Map<String, Tab> tabs = new LinkedHashMap<>();
    /** Guarded by {@code this}: the tabs that hold tables (others in the spreadsheet are left alone and never read). */
    private final Set<String> managed = new LinkedHashSet<>();
    /** Guarded by {@code this}: tables whose tab is still to be added. */
    private final Map<String, List<String>> toCreate = new LinkedHashMap<>();
    /** A copy of {@link #managed} to read without the lock: a snapshot read before a table was added does not cover it. */
    private volatile Set<String> managedNow = Set.of();
    /** The snapshot this thread's request (or unit of work) works on. */
    private final ThreadLocal<Snapshot> current = new ThreadLocal<>();
    /** Set when a unit of work starts: its first read goes to the spreadsheet, never to a shared snapshot. */
    private final ThreadLocal<Boolean> readAfresh = new ThreadLocal<>();
    /** The newest snapshot, shared by every request while it is younger than {@link #maxAge} (always, when negative). */
    private final AtomicReference<Snapshot> latest = new AtomicReference<>();
    /** Held while reading the spreadsheet, so requests arriving together wait for one read instead of each making one. */
    private final ReentrantLock reading = new ReentrantLock();
    /** Table versions and snapshot sequence numbers. */
    private final AtomicLong versions = new AtomicLong();
    /** Nanoseconds; zero: every request reads the spreadsheet; negative: only saves (and the first read) do. */
    private final long maxAge;
    private final LongSupplier clock;

    /**
     * Signs in with a service account key file and opens the spreadsheet.
     *
     * @param credentialsFile the service account's JSON key (Google Cloud console, IAM, Service accounts, Keys)
     * @param spreadsheetId   the id in the spreadsheet's address: docs.google.com/spreadsheets/d/<b>id</b>/edit
     * @param timeout         connect and read timeout of each call
     * @param maxAge          how long requests share what was read before reading the spreadsheet again (zero: every
     *                        request reads it; negative: only saves read it, and they refresh what is shared)
     *                        request reads it); saves always read it afresh
     */
    public static GoogleSheetsStorage connect(Path credentialsFile, String spreadsheetId, Duration timeout, Duration maxAge) {
        if (spreadsheetId == null || spreadsheetId.isBlank()) {
            throw new StorageException("Google Sheets storage needs budget.storage.google-sheets.spreadsheet-id: the id in the "
                    + "spreadsheet's address, docs.google.com/spreadsheets/d/<id>/edit", null);
        }
        if (!Files.isRegularFile(credentialsFile)) {
            throw new StorageException("Google Sheets storage: no service account key at " + credentialsFile.toAbsolutePath()
                    + ". Create one in the Google Cloud console (IAM, Service accounts, Keys, JSON) and put it there, or set "
                    + "budget.storage.google-sheets.credentials-file", null);
        }
        try (InputStream in = Files.newInputStream(credentialsFile)) {
            ServiceAccountCredentials credentials = (ServiceAccountCredentials) ServiceAccountCredentials.fromStream(in)
                    .createScoped(SheetsScopes.SPREADSHEETS);
            HttpCredentialsAdapter auth = new HttpCredentialsAdapter(credentials);
            int millis = (int) timeout.toMillis();
            HttpRequestInitializer init = request -> {
                auth.initialize(request);
                request.setConnectTimeout(millis);
                request.setReadTimeout(millis);
            };
            Sheets sheets = new Sheets.Builder(GoogleNetHttpTransport.newTrustedTransport(), GsonFactory.getDefaultInstance(), init)
                    .setApplicationName("personal-budget")
                    .build();
            return new GoogleSheetsStorage(sheets, spreadsheetId.trim(), credentials.getClientEmail(), maxAge, System::nanoTime);
        } catch (IOException | GeneralSecurityException e) {
            throw new StorageException("Google Sheets storage: cannot use the key file " + credentialsFile.toAbsolutePath()
                    + " (" + e.getMessage() + ")", e);
        }
    }

    /** Every request reads the spreadsheet (nothing shared between requests). */
    GoogleSheetsStorage(Sheets sheets, String spreadsheetId, String account) {
        this(sheets, spreadsheetId, account, Duration.ZERO, System::nanoTime);
    }

    /** {@code clock} gives the time in nanoseconds, like {@link System#nanoTime()}. */
    GoogleSheetsStorage(Sheets sheets, String spreadsheetId, String account, Duration maxAge, LongSupplier clock) {
        this.sheets = sheets;
        this.spreadsheetId = spreadsheetId;
        this.account = account;
        this.maxAge = maxAge.isNegative() ? -1 : maxAge.toNanos();
        this.clock = clock;
        this.title = loadLayout();
        create(SEQUENCES, List.of("table", "lastId"));
    }

    @Override
    public String describe() {
        return "Google spreadsheet \"" + title + "\" (" + spreadsheetId + ") as " + account + ", "
                + (maxAge == 0 ? "read by every request" : maxAge < 0 ? "read only by saves (and once at the start)"
                : "what was read shared by requests for " + Duration.ofNanos(maxAge).toSeconds() + " s") + ", read afresh by every save";
    }

    // ================================================================== TableStorage

    @Override
    public synchronized void create(String table, List<String> header) {
        manage(table);
        if (!tabs.containsKey(table)) {
            toCreate.put(table, header);
        }
    }

    @Override
    public Object stamp(String table) {
        Table t = snapshot().tables().get(table);
        return t == null ? null : t.version();
    }

    @Override
    public List<List<String>> read(String table) {
        return snapshot().rows(table);
    }

    @Override
    public Properties readSequences() {
        Properties p = new Properties();
        List<List<String>> rows = read(SEQUENCES);
        for (List<String> row : rows.subList(Math.min(1, rows.size()), rows.size())) {
            if (row.size() >= 2 && !row.get(0).isBlank() && !row.get(1).isBlank()) {
                p.setProperty(row.get(0).strip(), row.get(1).strip());
            }
        }
        return p;
    }

    @Override
    public void forget() {
        current.remove();
        readAfresh.remove();
    }

    @Override
    public void refresh() {
        current.remove();
        readAfresh.set(Boolean.TRUE);
    }

    @Override
    public void write(Map<String, List<List<String>>> tables, Properties sequences) {
        Map<String, List<List<String>>> all = new LinkedHashMap<>(tables);
        if (sequences != null) {
            all.put(SEQUENCES, sequenceRows(sequences));
        }
        if (all.isEmpty()) {
            return;
        }
        // what the tabs hold now (read afresh by this unit of work): only rows that differ are written, and rows and
        // columns no longer used are cleared
        Snapshot before = snapshot();
        synchronized (this) {
            all.forEach((name, rows) -> {
                manage(name);
                if (!tabs.containsKey(name)) {
                    toCreate.put(name, rows.isEmpty() ? List.of() : rows.getFirst());
                }
            });
            try {
                writeAll(all, before);
            } catch (StorageException e) {
                if (!(e.getCause() instanceof GoogleJsonResponseException g) || g.getStatusCode() != 400) {
                    throw e;
                }
                // a tab was resized or removed by hand since the app read the layout: read it again and retry once
                log.info("Google Sheets: the spreadsheet's layout changed ({}); reading it again", e.getMessage());
                loadLayout();
                managed.stream().filter(n -> !tabs.containsKey(n) && all.containsKey(n))
                        .forEach(n -> toCreate.put(n, all.get(n).isEmpty() ? List.of() : all.get(n).getFirst()));
                writeAll(all, before);
            }
        }
        // what was written is what the spreadsheet holds now: this request and every later one see it without
        // reading the spreadsheet again. It counts as read when the snapshot it was based on was, so an edit by hand
        // in a tab this save did not touch shows no later than it would have.
        Map<String, Table> after = new HashMap<>(before.tables());
        all.forEach((name, rows) -> {
            List<List<String>> written = normalize(rows);
            Table old = before.tables().get(name);
            after.put(name, old != null && old.rows().equals(written) ? old : new Table(written, versions.incrementAndGet()));
        });
        Snapshot s = new Snapshot(Map.copyOf(after), versions.incrementAndGet(), before.takenAt());
        current.set(s);
        share(s);
    }

    @Override
    public Footprint footprint() {
        Snapshot s = snapshot();
        int tables = 0;
        long bytes = 0;
        for (Map.Entry<String, Table> e : s.tables().entrySet()) {
            if (!e.getKey().equals(SEQUENCES)) {
                tables++;
                for (List<String> row : e.getValue().rows()) {
                    bytes += row.stream().mapToLong(String::length).sum() + row.size();
                }
            }
        }
        return new Footprint(tables, bytes);
    }

    // ================================================================== import

    /** True until the app has stored anything here: no id was ever handed out. */
    public boolean isEmpty() {
        refresh();
        try {
            return readSequences().isEmpty();
        } finally {
            forget();
        }
    }

    /**
     * Copies every table of a data folder (and its id sequences) into the spreadsheet, replacing what the tabs hold.
     *
     * @return how many tables had rows to copy
     */
    public int importFrom(LocalFileStorage local) {
        Map<String, List<List<String>>> tables = new TreeMap<>();
        for (String name : local.tableNames()) {
            List<List<String>> rows = local.read(name);
            if (rows.size() > 1) {
                tables.put(name, rows);
            }
        }
        refresh();   // the copy goes over what the spreadsheet holds now
        try {
            if (!tables.isEmpty()) {
                write(tables, local.readSequences());
            }
        } finally {
            forget();
        }
        return tables.size();
    }

    // ================================================================== reading

    /**
     * The snapshot of this thread's request (or unit of work), taken on first use: read afresh at the start of a
     * unit of work, else the shared one while it is fresh.
     */
    private Snapshot snapshot() {
        Snapshot s = current.get();
        if (s == null) {
            s = Boolean.TRUE.equals(readAfresh.get()) ? readNow() : shared();
            readAfresh.remove();
            current.set(s);
        }
        return s;
    }

    /** The latest snapshot while it is fresh; else the spreadsheet is read, by one thread while the others wait. */
    private Snapshot shared() {
        Snapshot s = latest.get();
        if (isFresh(s)) {
            return s;
        }
        reading.lock();
        try {
            s = latest.get();   // read by another thread while this one waited
            return isFresh(s) ? s : load();
        } finally {
            reading.unlock();
        }
    }

    private Snapshot readNow() {
        reading.lock();
        try {
            return load();
        } finally {
            reading.unlock();
        }
    }

    /** Younger than maxAge (any age, when it is negative) and holding every table there is (a table may be added after it was read). */
    private boolean isFresh(Snapshot s) {
        return s != null && maxAge != 0 && (maxAge < 0 || clock.getAsLong() - s.takenAt() < maxAge)
                && s.tables().keySet().containsAll(managedNow);
    }

    /** Reads the spreadsheet; a table whose rows did not change keeps its version, so it is not parsed again. */
    private Snapshot load() {
        long seq = versions.incrementAndGet();
        long takenAt = clock.getAsLong();
        Map<String, List<List<String>>> rows = fetch();
        Snapshot previous = latest.get();
        Map<String, Table> tables = new HashMap<>();
        rows.forEach((name, r) -> {
            Table known = previous == null ? null : previous.tables().get(name);
            tables.put(name, known != null && known.rows().equals(r) ? known : new Table(r, versions.incrementAndGet()));
        });
        Snapshot s = new Snapshot(Map.copyOf(tables), seq, takenAt);
        share(s);
        return s;
    }

    /**
     * Makes a snapshot the shared one, unless a newer one is shared already: a read that started before a save
     * ended never hides that save.
     */
    private void share(Snapshot s) {
        latest.accumulateAndGet(s, (old, next) -> old == null || next.seq() > old.seq() ? next : old);
    }

    /** Guarded by {@code this}. */
    private void manage(String table) {
        if (managed.add(table)) {
            managedNow = Set.copyOf(managed);
        }
    }

    /** Reads every table tab in one call. */
    private Map<String, List<List<String>>> fetch() {
        List<String> names;
        synchronized (this) {
            createPending();
            names = managed.stream().filter(tabs::containsKey).toList();
        }
        Map<String, List<List<String>>> rows = new HashMap<>();
        if (names.isEmpty()) {
            return rows;
        }
        BatchGetValuesResponse response = call("read the spreadsheet", () -> sheets.spreadsheets().values()
                .batchGet(spreadsheetId)
                .setRanges(names.stream().map(GoogleSheetsStorage::range).toList())
                .setMajorDimension("ROWS")
                .setValueRenderOption("FORMATTED_VALUE")
                .execute());
        List<ValueRange> ranges = response.getValueRanges();
        for (int i = 0; i < names.size(); i++) {
            rows.put(names.get(i), cells(i < ranges.size() ? ranges.get(i).getValues() : null));
        }
        return rows;
    }

    // ================================================================== writing (callers hold the lock)

    private void writeAll(Map<String, List<List<String>>> all, Snapshot before) {
        createPending();
        List<Request> resize = new ArrayList<>();
        List<ValueRange> data = new ArrayList<>();
        List<Integer> cells = new ArrayList<>();
        all.forEach((name, rows) -> {
            Tab tab = tabs.get(name);
            List<List<String>> old = before.rows(name);
            // rows and columns the tab holds now but the table no longer has are written empty
            int height = Math.max(rows.size(), old.size());
            int width = Math.max(width(rows), width(old));
            // only the rows from the first to the last that differ are sent: a new row is one row, a change one
            // row, a deletion the rows that move up
            int first = 0;
            while (first < height && sameRow(row(rows, first), row(old, first))) {
                first++;
            }
            if (first == height) {
                return;   // nothing changed in this table
            }
            int last = height - 1;
            while (sameRow(row(rows, last), row(old, last))) {
                last--;
            }
            if (height > tab.gridRows || width > tab.gridCols) {
                tab.gridRows = Math.max(tab.gridRows, height + ROW_HEADROOM);
                tab.gridCols = Math.max(tab.gridCols, width);
                resize.add(new Request().setUpdateSheetProperties(new UpdateSheetPropertiesRequest()
                        .setProperties(new SheetProperties().setSheetId(tab.sheetId)
                                .setGridProperties(new GridProperties().setRowCount(tab.gridRows).setColumnCount(tab.gridCols)))
                        .setFields("gridProperties.rowCount,gridProperties.columnCount")));
            }
            data.add(new ValueRange().setRange(range(name) + "!A" + (first + 1)).setValues(values(name, rows, first, last + 1, width)));
            cells.add((last + 1 - first) * Math.max(width, 1));
        });
        if (!resize.isEmpty()) {
            call("resize tabs", () -> sheets.spreadsheets()
                    .batchUpdate(spreadsheetId, new BatchUpdateSpreadsheetRequest().setRequests(resize)).execute());
        }
        List<ValueRange> chunk = new ArrayList<>();
        int chunkCells = 0;
        for (int i = 0; i < data.size(); i++) {
            if (!chunk.isEmpty() && chunkCells + cells.get(i) > MAX_CELLS_PER_CALL) {
                writeValues(chunk);
                chunk = new ArrayList<>();
                chunkCells = 0;
            }
            chunk.add(data.get(i));
            chunkCells += cells.get(i);
        }
        writeValues(chunk);
    }

    /** Reads the tab names, ids and sizes. */
    private synchronized String loadLayout() {
        Spreadsheet meta = call("open the spreadsheet", () -> sheets.spreadsheets().get(spreadsheetId)
                .setFields("properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))")
                .execute());
        tabs.clear();
        for (Sheet sheet : meta.getSheets() == null ? List.<Sheet>of() : meta.getSheets()) {
            SheetProperties p = sheet.getProperties();
            GridProperties grid = p.getGridProperties();
            tabs.put(p.getTitle(), new Tab(p.getSheetId(), grid == null ? 0 : nz(grid.getRowCount()), grid == null ? 0 : nz(grid.getColumnCount())));
        }
        return meta.getProperties().getTitle();
    }

    /** Adds the tabs of new tables, frozen header row included, in one call (and their header rows in another). */
    private void createPending() {
        if (toCreate.isEmpty()) {
            return;
        }
        Map<String, List<String>> headers = new LinkedHashMap<>(toCreate);
        List<Request> requests = headers.entrySet().stream().map(e -> new Request().setAddSheet(new AddSheetRequest()
                .setProperties(new SheetProperties().setTitle(e.getKey()).setGridProperties(new GridProperties()
                        .setRowCount(1000).setColumnCount(Math.max(26, e.getValue().size())).setFrozenRowCount(1))))).toList();
        BatchUpdateSpreadsheetResponse response = call("add tabs", () -> sheets.spreadsheets()
                .batchUpdate(spreadsheetId, new BatchUpdateSpreadsheetRequest().setRequests(requests)).execute());
        for (Response reply : response.getReplies()) {
            SheetProperties p = reply.getAddSheet().getProperties();
            GridProperties grid = p.getGridProperties();
            tabs.put(p.getTitle(), new Tab(p.getSheetId(), nz(grid.getRowCount()), nz(grid.getColumnCount())));
        }
        toCreate.clear();
        writeValues(headers.entrySet().stream().filter(e -> !e.getValue().isEmpty())
                .map(e -> new ValueRange().setRange(range(e.getKey()) + "!A1").setValues(List.of(new ArrayList<Object>(e.getValue()))))
                .toList());
        log.info("Added {} tab(s) to the spreadsheet: {}", headers.size(), String.join(", ", headers.keySet()));
    }

    private void writeValues(List<ValueRange> data) {
        if (!data.isEmpty()) {
            call("write to the spreadsheet", () -> sheets.spreadsheets().values().batchUpdate(spreadsheetId,
                    new BatchUpdateValuesRequest().setValueInputOption("RAW").setData(data)).execute());
        }
    }

    // ================================================================== cells

    private static int width(List<List<String>> rows) {
        return rows.stream().mapToInt(List::size).max().orElse(0);
    }

    private static List<String> row(List<List<String>> rows, int r) {
        return r < rows.size() ? rows.get(r) : List.of();
    }

    /** The same cells, an empty cell being the same as no cell. */
    private static boolean sameRow(List<String> a, List<String> b) {
        for (int c = 0, n = Math.max(a.size(), b.size()); c < n; c++) {
            String x = c < a.size() && a.get(c) != null ? a.get(c) : "";
            String y = c < b.size() && b.get(c) != null ? b.get(c) : "";
            if (!x.equals(y)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Rows {@code from} (inclusive) to {@code to} (exclusive), padded with empty cells to {@code width}, so whatever
     * was there before is cleared.
     */
    private static List<List<Object>> values(String table, List<List<String>> rows, int from, int to, int width) {
        List<List<Object>> values = new ArrayList<>(to - from);
        for (int r = from; r < to; r++) {
            List<String> row = row(rows, r);
            List<Object> out = new ArrayList<>(width);
            for (int c = 0; c < width; c++) {
                String cell = c < row.size() && row.get(c) != null ? TsvCodec.unescape(row.get(c)) : "";
                if (cell.length() > MAX_CELL) {
                    throw new StorageException(table + " row " + (r + 1) + ": a value of " + cell.length()
                            + " characters is more than a Google Sheets cell holds (" + MAX_CELL + ")", null);
                }
                out.add(cell);
            }
            values.add(out);
        }
        return values;
    }

    /** Cells as read from the API, in the codec's escaped form, trailing empty cells and rows left out. */
    private static List<List<String>> cells(List<List<Object>> values) {
        if (values == null) {
            return List.of();
        }
        List<List<String>> rows = new ArrayList<>(values.size());
        for (List<Object> row : values) {
            List<String> cells = new ArrayList<>(row.size());
            for (Object cell : row) {
                cells.add(cell == null ? "" : TsvCodec.escape(cell.toString()));
            }
            rows.add(cells);
        }
        return normalize(rows);
    }

    private static List<List<String>> normalize(List<List<String>> rows) {
        List<List<String>> out = new ArrayList<>(rows.size());
        for (List<String> row : rows) {
            int end = row.size();
            while (end > 0 && (row.get(end - 1) == null || row.get(end - 1).isEmpty())) {
                end--;
            }
            out.add(List.copyOf(row.subList(0, end)));
        }
        int last = out.size();
        while (last > 0 && out.get(last - 1).isEmpty()) {
            last--;
        }
        return Collections.unmodifiableList(out.subList(0, last));
    }

    private static List<List<String>> sequenceRows(Properties sequences) {
        List<List<String>> rows = new ArrayList<>();
        rows.add(List.of("table", "lastId"));
        new TreeMap<>(sequences).forEach((k, v) -> rows.add(List.of(k.toString(), v.toString())));
        return rows;
    }

    /** A tab in A1 notation: 'journal_entries'. */
    private static String range(String tab) {
        return "'" + tab.replace("'", "''") + "'";
    }

    private static int nz(Integer value) {
        return value == null ? 0 : value;
    }

    // ================================================================== API calls

    /** Runs an API call, retrying a few times (with growing pauses) when Google is busy or the network fails. */
    private <T> T call(String what, ApiCall<T> action) {
        long pause = 1000;
        for (int attempt = 1; ; attempt++) {
            try {
                return action.run();
            } catch (GoogleJsonResponseException e) {
                int code = e.getStatusCode();
                boolean transient_ = code == 429 || code == 500 || code == 502 || code == 503 || code == 504;
                if (!transient_ || attempt >= RETRIES) {
                    throw new StorageException(explain(what, e), e);
                }
                log.warn("Google Sheets: could not {} ({}{}), retrying in {} ms", what, code,
                        code == 429 ? ", too many calls a minute" : "", pause);
            } catch (IOException e) {
                if (e.getMessage() != null && e.getMessage().contains("access token")) {   // a wrong or revoked key
                    throw new StorageException("Google Sheets: could not " + what + ": Google refused the service account key of "
                            + account + " (" + e.getMessage().lines().findFirst().orElse("") + "). Check the key file, or create a new key", e);
                }
                if (attempt >= RETRIES) {
                    throw new StorageException("Google Sheets: could not " + what + ": " + e.getMessage(), e);
                }
                log.warn("Google Sheets: could not {} ({}), retrying in {} ms", what, e.getMessage(), pause);
            }
            try {
                Thread.sleep(pause);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new StorageException("Google Sheets: interrupted while trying to " + what, ie);
            }
            pause = Math.min(pause * 2, 32_000);
        }
    }

    private String explain(String what, GoogleJsonResponseException e) {
        String detail = e.getDetails() != null ? e.getDetails().getMessage() : e.getMessage();
        if (e.getStatusCode() == 403 && detail != null && (detail.contains("has not been used") || detail.contains("is disabled"))) {
            return "Google Sheets: could not " + what + ": the Google Sheets API is not enabled for the service account's "
                    + "project. Enable it (Google Cloud console, APIs & Services, Library, Google Sheets API), wait a minute "
                    + "and start again. " + detail;
        }
        return switch (e.getStatusCode()) {
            case 403 -> "Google Sheets: could not " + what + ": " + account + " has no access to spreadsheet " + spreadsheetId
                    + ". Share the spreadsheet with that address as an Editor (and make sure the Google Sheets API is "
                    + "enabled for the service account's project). " + detail;
            case 404 -> "Google Sheets: could not " + what + ": there is no spreadsheet " + spreadsheetId
                    + " (check budget.storage.google-sheets.spreadsheet-id). " + detail;
            default -> "Google Sheets: could not " + what + " (" + e.getStatusCode() + "): " + detail;
        };
    }
}
