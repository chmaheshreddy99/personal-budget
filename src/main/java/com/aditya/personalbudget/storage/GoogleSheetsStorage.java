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

/**
 * Keeps the tables in a Google spreadsheet: one tab per table (header row first, then one row per entity, exactly
 * like a {@code .tbl} file) and the id sequences in the {@code _sequences} tab. Missing tabs are added on start.
 * <p>
 * The app signs in as a Google Cloud <i>service account</i> (its JSON key file); the spreadsheet must be shared
 * with that account's e-mail address as an Editor.
 * <p>
 * <b>No data is kept in memory.</b> The spreadsheet is read when data is needed: the first read of a request (or of
 * a unit of work) fetches every table tab in one API call, that copy serves the rest of the request on that thread
 * only, and it is dropped when the request ends ({@link #forget()}). A unit of work starts by dropping it too, so a
 * save always works on what the spreadsheet holds at that moment, and its changes are written in one call before it
 * ends. What is kept is only the layout of the spreadsheet (tab names, ids and sizes), which holds no data.
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

    /** What one request (or unit of work) read from the spreadsheet; it lives only on that thread, for that request. */
    private static final class Snapshot {
        /** Header first; trailing empty cells and rows left out. Tabs that do not exist are absent. */
        final Map<String, List<List<String>>> rows;
        long version;

        Snapshot(Map<String, List<List<String>>> rows, long version) {
            this.rows = rows;
            this.version = version;
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
    private final ThreadLocal<Snapshot> current = new ThreadLocal<>();
    private final AtomicLong versions = new AtomicLong();

    /**
     * Signs in with a service account key file and opens the spreadsheet.
     *
     * @param credentialsFile the service account's JSON key (Google Cloud console, IAM, Service accounts, Keys)
     * @param spreadsheetId   the id in the spreadsheet's address: docs.google.com/spreadsheets/d/<b>id</b>/edit
     * @param timeout         connect and read timeout of each call
     */
    public static GoogleSheetsStorage connect(Path credentialsFile, String spreadsheetId, Duration timeout) {
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
            return new GoogleSheetsStorage(sheets, spreadsheetId.trim(), credentials.getClientEmail());
        } catch (IOException | GeneralSecurityException e) {
            throw new StorageException("Google Sheets storage: cannot use the key file " + credentialsFile.toAbsolutePath()
                    + " (" + e.getMessage() + ")", e);
        }
    }

    GoogleSheetsStorage(Sheets sheets, String spreadsheetId, String account) {
        this.sheets = sheets;
        this.spreadsheetId = spreadsheetId;
        this.account = account;
        this.title = loadLayout();
        create(SEQUENCES, List.of("table", "lastId"));
    }

    @Override
    public String describe() {
        return "Google spreadsheet \"" + title + "\" (" + spreadsheetId + ") as " + account + ", read on demand (nothing kept in memory)";
    }

    // ================================================================== TableStorage

    @Override
    public synchronized void create(String table, List<String> header) {
        managed.add(table);
        if (!tabs.containsKey(table)) {
            toCreate.put(table, header);
        }
    }

    @Override
    public Object stamp(String table) {
        Snapshot s = snapshot();
        return s.rows.containsKey(table) ? s.version : null;
    }

    @Override
    public List<List<String>> read(String table) {
        return snapshot().rows.getOrDefault(table, List.of());
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
        // what the tabs hold now (read by this unit of work), so rows and columns no longer used are cleared
        Snapshot before = snapshot();
        synchronized (this) {
            all.forEach((name, rows) -> {
                managed.add(name);
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
        // the rest of this request sees what it wrote, without reading the spreadsheet again
        Map<String, List<List<String>>> after = new HashMap<>(before.rows);
        all.forEach((name, rows) -> after.put(name, normalize(rows)));
        current.set(new Snapshot(after, versions.incrementAndGet()));
    }

    @Override
    public Footprint footprint() {
        Snapshot s = snapshot();
        int tables = 0;
        long bytes = 0;
        for (Map.Entry<String, List<List<String>>> e : s.rows.entrySet()) {
            if (!e.getKey().equals(SEQUENCES)) {
                tables++;
                for (List<String> row : e.getValue()) {
                    bytes += row.stream().mapToLong(String::length).sum() + row.size();
                }
            }
        }
        return new Footprint(tables, bytes);
    }

    // ================================================================== import

    /** True until the app has stored anything here: no id was ever handed out. */
    public boolean isEmpty() {
        forget();
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
        forget();
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

    /** This thread's copy for the current request, read from the spreadsheet on first use. */
    private Snapshot snapshot() {
        Snapshot s = current.get();
        if (s == null) {
            s = new Snapshot(fetch(), versions.incrementAndGet());
            current.set(s);
        }
        return s;
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
            List<List<String>> old = before.rows.getOrDefault(name, List.of());
            // rows and columns the tab holds now but the table no longer has are written empty
            int height = Math.max(rows.size(), old.size());
            int width = Math.max(width(rows), width(old));
            if (height > tab.gridRows || width > tab.gridCols) {
                tab.gridRows = Math.max(tab.gridRows, height + ROW_HEADROOM);
                tab.gridCols = Math.max(tab.gridCols, width);
                resize.add(new Request().setUpdateSheetProperties(new UpdateSheetPropertiesRequest()
                        .setProperties(new SheetProperties().setSheetId(tab.sheetId)
                                .setGridProperties(new GridProperties().setRowCount(tab.gridRows).setColumnCount(tab.gridCols)))
                        .setFields("gridProperties.rowCount,gridProperties.columnCount")));
            }
            data.add(new ValueRange().setRange(range(name) + "!A1").setValues(values(name, rows, height, width)));
            cells.add(height * Math.max(width, 1));
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

    /** The rows padded with empty cells to {@code height} x {@code width}, so whatever was there before is cleared. */
    private static List<List<Object>> values(String table, List<List<String>> rows, int height, int width) {
        List<List<Object>> values = new ArrayList<>(height);
        for (int r = 0; r < height; r++) {
            List<String> row = r < rows.size() ? rows.get(r) : List.of();
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
