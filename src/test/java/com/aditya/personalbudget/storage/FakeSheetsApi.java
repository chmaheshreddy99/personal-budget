package com.aditya.personalbudget.storage;

import com.google.api.client.http.LowLevelHttpRequest;
import com.google.api.client.http.LowLevelHttpResponse;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.client.testing.http.MockHttpTransport;
import com.google.api.client.testing.http.MockLowLevelHttpRequest;
import com.google.api.client.testing.http.MockLowLevelHttpResponse;
import com.google.api.services.sheets.v4.Sheets;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * An in-memory Google spreadsheet behind the Sheets API endpoints {@link GoogleSheetsStorage} uses: get (tab
 * metadata), batchUpdate (add a tab, resize a tab), values.batchGet and values.batchUpdate. Like the real API it
 * refuses a write beyond a tab's grid, and leaves trailing empty cells and rows out of what it returns.
 */
final class FakeSheetsApi {

    static final class Tab {
        final int id;
        int rows;
        int cols;
        int frozenRows;
        final List<List<String>> cells = new ArrayList<>();

        Tab(int id, int rows, int cols) {
            this.id = id;
            this.rows = rows;
            this.cols = cols;
        }

        String cell(int row, int col) {
            return row < cells.size() && col < cells.get(row).size() ? cells.get(row).get(col) : "";
        }
    }

    final Map<String, Tab> tabs = new LinkedHashMap<>();
    final List<String> calls = new ArrayList<>();
    private int nextId = 1;

    FakeSheetsApi() {
        tabs.put("Sheet1", new Tab(0, 1000, 26));
    }

    Tab addTab(String title, int rows, int cols) {
        Tab tab = new Tab(nextId++, rows, cols);
        tabs.put(title, tab);
        return tab;
    }

    Sheets client() {
        MockHttpTransport transport = new MockHttpTransport() {
            @Override
            public LowLevelHttpRequest buildRequest(String method, String url) {
                return new MockLowLevelHttpRequest(url) {
                    @Override
                    public LowLevelHttpResponse execute() throws IOException {
                        String body = getStreamingContent() == null ? "" : content(this);
                        String json = handle(method, URI.create(url), body);
                        return new MockLowLevelHttpResponse().setContentType("application/json").setContent(json);
                    }
                };
            }
        };
        return new Sheets.Builder(transport, GsonFactory.getDefaultInstance(), null).setApplicationName("test").build();
    }

    private static String content(MockLowLevelHttpRequest request) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        request.getStreamingContent().writeTo(out);
        byte[] bytes = out.toByteArray();
        if (bytes.length > 1 && (bytes[0] & 0xff) == 0x1f && (bytes[1] & 0xff) == 0x8b) {
            bytes = new GZIPInputStream(new ByteArrayInputStream(bytes)).readAllBytes();
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private synchronized String handle(String method, URI uri, String body) {
        String path = uri.getRawPath();
        if (method.equals("GET") && path.endsWith("/values:batchGet")) {
            calls.add("batchGet");
            return batchGet(uri.getRawQuery());
        }
        if (method.equals("POST") && path.endsWith("/values:batchUpdate")) {
            calls.add("values.batchUpdate");
            return valuesBatchUpdate(JsonParser.parseString(body).getAsJsonObject());
        }
        if (method.equals("POST") && path.endsWith(":batchUpdate")) {
            calls.add("batchUpdate");
            return batchUpdate(JsonParser.parseString(body).getAsJsonObject());
        }
        if (method.equals("GET")) {
            calls.add("get");
            return metadata();
        }
        throw new IllegalStateException("Unexpected call " + method + " " + uri);
    }

    private String metadata() {
        JsonArray sheets = new JsonArray();
        tabs.forEach((title, tab) -> sheets.add(sheet(title, tab)));
        JsonObject root = new JsonObject();
        JsonObject props = new JsonObject();
        props.addProperty("title", "Budget (test)");
        root.add("properties", props);
        root.add("sheets", sheets);
        return root.toString();
    }

    private static JsonObject sheet(String title, Tab tab) {
        JsonObject grid = new JsonObject();
        grid.addProperty("rowCount", tab.rows);
        grid.addProperty("columnCount", tab.cols);
        JsonObject props = new JsonObject();
        props.addProperty("sheetId", tab.id);
        props.addProperty("title", title);
        props.add("gridProperties", grid);
        JsonObject sheet = new JsonObject();
        sheet.add("properties", props);
        return sheet;
    }

    private String batchUpdate(JsonObject request) {
        JsonArray replies = new JsonArray();
        for (JsonElement r : request.getAsJsonArray("requests")) {
            JsonObject req = r.getAsJsonObject();
            JsonObject reply = new JsonObject();
            if (req.has("addSheet")) {
                JsonObject p = req.getAsJsonObject("addSheet").getAsJsonObject("properties");
                JsonObject g = p.getAsJsonObject("gridProperties");
                String title = p.get("title").getAsString();
                if (tabs.containsKey(title)) {
                    throw new IllegalStateException("A sheet with the name \"" + title + "\" already exists");
                }
                Tab tab = addTab(title, g.get("rowCount").getAsInt(), g.get("columnCount").getAsInt());
                tab.frozenRows = g.has("frozenRowCount") ? g.get("frozenRowCount").getAsInt() : 0;
                JsonObject added = new JsonObject();
                added.add("properties", sheet(title, tab).getAsJsonObject("properties"));
                reply.add("addSheet", added);
            } else if (req.has("updateSheetProperties")) {
                JsonObject p = req.getAsJsonObject("updateSheetProperties").getAsJsonObject("properties");
                int id = p.get("sheetId").getAsInt();
                Tab tab = tabs.values().stream().filter(t -> t.id == id).findFirst().orElseThrow();
                JsonObject g = p.getAsJsonObject("gridProperties");
                tab.rows = g.get("rowCount").getAsInt();
                tab.cols = g.get("columnCount").getAsInt();
            }
            replies.add(reply);
        }
        JsonObject response = new JsonObject();
        response.add("replies", replies);
        return response.toString();
    }

    private String valuesBatchUpdate(JsonObject request) {
        if (!"RAW".equals(request.get("valueInputOption").getAsString())) {
            throw new IllegalStateException("Expected RAW input");
        }
        for (JsonElement d : request.getAsJsonArray("data")) {
            JsonObject data = d.getAsJsonObject();
            String range = data.get("range").getAsString();
            if (!range.endsWith("!A1")) {
                throw new IllegalStateException("Expected a range starting at A1: " + range);
            }
            Tab tab = tabs.get(title(range.substring(0, range.length() - 3)));
            JsonArray rows = data.getAsJsonArray("values");
            for (int r = 0; r < rows.size(); r++) {
                JsonArray row = rows.get(r).getAsJsonArray();
                if (r >= tab.rows || row.size() > tab.cols) {
                    throw new IllegalStateException("Range exceeds grid limits");
                }
                while (tab.cells.size() <= r) {
                    tab.cells.add(new ArrayList<>());
                }
                List<String> target = tab.cells.get(r);
                for (int c = 0; c < row.size(); c++) {
                    while (target.size() <= c) {
                        target.add("");
                    }
                    target.set(c, row.get(c).getAsString());
                }
            }
        }
        return "{}";
    }

    private String batchGet(String query) {
        JsonArray ranges = new JsonArray();
        for (String param : query.split("&")) {
            if (!param.startsWith("ranges=")) {
                continue;
            }
            String range = URLDecoder.decode(param.substring(7), StandardCharsets.UTF_8);
            Tab tab = tabs.get(title(range));
            JsonArray values = new JsonArray();
            int lastRow = -1;
            List<JsonArray> rows = new ArrayList<>();
            for (int r = 0; r < tab.cells.size(); r++) {
                List<String> cells = tab.cells.get(r);
                int end = cells.size();
                while (end > 0 && cells.get(end - 1).isEmpty()) {
                    end--;
                }
                JsonArray row = new JsonArray();
                cells.subList(0, end).forEach(row::add);
                rows.add(row);
                if (end > 0) {
                    lastRow = r;
                }
            }
            rows.subList(0, lastRow + 1).forEach(values::add);
            JsonObject vr = new JsonObject();
            vr.addProperty("range", range);
            if (!values.isEmpty()) {
                vr.add("values", values);
            }
            ranges.add(vr);
        }
        JsonObject response = new JsonObject();
        response.add("valueRanges", ranges);
        return response.toString();
    }

    /** 'journal_entries' -> journal_entries */
    private static String title(String quoted) {
        return quoted.startsWith("'") ? quoted.substring(1, quoted.length() - 1).replace("''", "'") : quoted;
    }
}
