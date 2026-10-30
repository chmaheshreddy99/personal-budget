package com.aditya.personalbudget.service;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A statement laid out like a bank's: a coloured header with the organization, the statement and its period; a row of
 * summary tiles; sections with tables whose header repeats on every page they run onto; and a footer with the page
 * number, when it was made and a "confidential" line. A4 portrait, the standard Helvetica fonts (the rupee is written
 * "Rs."), optionally locked with a password (AES-256: the reader needs it to open the file; printing and copying stay
 * allowed once it is open).
 * <p>
 * Built top to bottom: {@link #header}, then any of {@link #tiles}, {@link #section}, {@link #table}, {@link #facts},
 * {@link #note}; {@link #finish} returns the PDF.
 */
final class StatementPdf {

    /** A table column: its title, a share of the width, and whether it is a figure (right aligned). */
    record Col(String title, float weight, boolean right, boolean wrap) {
        static Col text(String title, float weight) {
            return new Col(title, weight, false, false);
        }

        static Col wrap(String title, float weight) {
            return new Col(title, weight, false, true);
        }

        static Col num(String title, float weight) {
            return new Col(title, weight, true, false);
        }
    }

    /** A summary tile: a label, the figure, a line under it and a tone (null, "good", "bad", "warn"). */
    record Tile(String label, String value, String sub, String tone) {
    }

    /** A table row; {@code style}: null, "bold" (totals, openings), "muted" or "mark" (highlighted). */
    record Row(String[] cells, String style) {
        static Row of(String... cells) {
            return new Row(cells, null);
        }

        static Row bold(String... cells) {
            return new Row(cells, "bold");
        }

        static Row mark(String... cells) {
            return new Row(cells, "mark");
        }

        static Row muted(String... cells) {
            return new Row(cells, "muted");
        }
    }

    private static final float W = PDRectangle.A4.getWidth(), H = PDRectangle.A4.getHeight();
    private static final float M = 36;                    // page margin
    private static final float BOTTOM = 54;               // the footer lives below this
    private static final float[] NAVY = {0.05f, 0.18f, 0.33f}, OCEAN = {0.04f, 0.45f, 0.71f}, INK = {0.07f, 0.1f, 0.14f},
            MUTED = {0.38f, 0.43f, 0.49f}, LINE = {0.85f, 0.89f, 0.93f}, ZEBRA = {0.965f, 0.975f, 0.985f}, HEAD = {0.91f, 0.94f, 0.97f},
            GOOD = {0.05f, 0.48f, 0.23f}, BAD = {0.7f, 0.14f, 0.09f}, WARN = {0.66f, 0.37f, 0.02f}, MARK = {1f, 0.97f, 0.88f};
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH);

    private final PDDocument doc = new PDDocument();
    private final PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
    private final PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
    private final Map<Character, Character> safe = new HashMap<>();
    private PDPageContentStream out;
    private float y;
    private String org = "", title = "", period = "";

    // ================================================================== the parts

    /** The first page's header band; later pages carry a slim one with the same names. */
    StatementPdf header(String organization, String statementTitle, String periodLabel, List<String[]> details) {
        this.org = organization;
        this.title = statementTitle;
        this.period = periodLabel;
        newPage(false);
        float band = 96 + Math.max(0, details.size() - 2) * 13;
        fill(NAVY);
        rect(0, H - band, W, band);
        fill(OCEAN);
        rect(0, H - band, W, 4);
        fill(new float[]{0.72f, 0.82f, 0.92f});
        text(bold, 8.5f, M, H - 28, cut(organization.toUpperCase(Locale.ROOT), bold, 8.5f, W / 2));
        fill(new float[]{1, 1, 1});
        text(bold, 19, M, H - 52, cut(statementTitle, bold, 19, W - 2 * M - 170));
        fill(new float[]{0.8f, 0.87f, 0.94f});
        text(regular, 10, M, H - 70, periodLabel);
        // the details (statement for, generated, currency ...) on the right
        float ry = H - 28;
        for (String[] d : details) {
            fill(new float[]{0.65f, 0.75f, 0.86f});
            textRight(regular, 7.5f, W - M - 112, ry, d[0].toUpperCase(Locale.ROOT));
            fill(new float[]{1, 1, 1});
            textRight(bold, 8.5f, W - M, ry, cut(d[1], bold, 8.5f, 108));
            ry -= 13;
        }
        y = H - band - 22;
        return this;
    }

    /** A row of summary tiles (up to four a row). */
    StatementPdf tiles(List<Tile> tiles) {
        int perRow = Math.min(4, Math.max(1, tiles.size()));
        float gap = 8, w = (W - 2 * M - gap * (perRow - 1)) / perRow, h = 52;
        for (int i = 0; i < tiles.size(); i += perRow) {
            ensure(h + 8);
            for (int k = 0; k < perRow && i + k < tiles.size(); k++) {
                Tile t = tiles.get(i + k);
                float x = M + k * (w + gap);
                fill(new float[]{0.975f, 0.983f, 0.992f});
                rect(x, y - h, w, h);
                fill(t.tone() == null ? OCEAN : tone(t.tone()));
                rect(x, y - h, 3, h);
                fill(MUTED);
                text(regular, 7.5f, x + 10, y - 14, cut(t.label().toUpperCase(Locale.ROOT), regular, 7.5f, w - 16));
                fill(t.tone() == null ? INK : tone(t.tone()));
                text(bold, 13.5f, x + 10, y - 31, cut(t.value(), bold, 13.5f, w - 16));
                if (t.sub() != null) {
                    fill(MUTED);
                    text(regular, 7.5f, x + 10, y - 44, cut(t.sub(), regular, 7.5f, w - 16));
                }
            }
            y -= h + 10;
        }
        return this;
    }

    /** A section heading with a rule under it and a line of explanation. */
    StatementPdf section(String heading, String sub) {
        ensure(60);
        y -= 6;
        fill(NAVY);
        text(bold, 12, M, y, heading);
        if (sub != null && !sub.isBlank()) {
            fill(MUTED);
            textRight(regular, 8, W - M, y, cut(sub, regular, 8, W - 2 * M - width(bold, 12, heading) - 20));
        }
        y -= 6;
        stroke(OCEAN, 1.2f);
        line(M, y, W - M, y);
        y -= 12;
        return this;
    }

    /** Label and value pairs in two columns (a chit's details, an account's particulars). */
    StatementPdf facts(List<String[]> pairs) {
        float colW = (W - 2 * M) / 2, lh = 14;
        for (int i = 0; i < pairs.size(); i += 2) {
            ensure(lh + 2);
            for (int k = 0; k < 2 && i + k < pairs.size(); k++) {
                String[] p = pairs.get(i + k);
                float x = M + k * colW;
                fill(MUTED);
                text(regular, 8, x, y, p[0]);
                fill(INK);
                text(bold, 8.5f, x + 92, y, cut(p[1], bold, 8.5f, colW - 100));
            }
            y -= lh;
        }
        y -= 6;
        return this;
    }

    /** A wrapped paragraph in small grey type. */
    StatementPdf note(String text) {
        for (String line : wrap(text, regular, 8, W - 2 * M)) {
            ensure(12);
            fill(MUTED);
            text(regular, 8, M, y, line);
            y -= 11;
        }
        y -= 6;
        return this;
    }

    /** A table: the header repeats on every page it runs onto; {@code footer} (may be null) is a bold totals row. */
    StatementPdf table(List<Col> cols, List<Row> rows, Row footer) {
        float total = 0;
        for (Col c : cols) total += c.weight();
        float[] xs = new float[cols.size() + 1];
        xs[0] = M;
        for (int i = 0; i < cols.size(); i++) xs[i + 1] = xs[i] + (W - 2 * M) * cols.get(i).weight() / total;
        float fs = 8, pad = 4, lh = 10.5f;
        Runnable head = () -> {
            fill(HEAD);
            rect(M, y - 16, W - 2 * M, 18);
            fill(NAVY);
            for (int i = 0; i < cols.size(); i++) {
                Col c = cols.get(i);
                String t = cut(c.title().toUpperCase(Locale.ROOT), bold, 7, xs[i + 1] - xs[i] - 2 * pad);
                if (c.right()) textRight(bold, 7, xs[i + 1] - pad, y - 10, t);
                else text(bold, 7, xs[i] + pad, y - 10, t);
            }
            y -= 20;
        };
        ensure(40);
        head.run();
        int n = 0;
        List<Row> all = new ArrayList<>(rows);
        if (footer != null) all.add(new Row(footer.cells(), "total"));
        for (Row r : all) {
            boolean strong = "bold".equals(r.style()) || "total".equals(r.style());
            PDType1Font f = strong ? bold : regular;
            // the wrapped column decides the row's height
            List<List<String>> cells = new ArrayList<>();
            int lines = 1;
            for (int i = 0; i < cols.size(); i++) {
                String v = i < r.cells().length && r.cells()[i] != null ? r.cells()[i] : "";
                float cw = xs[i + 1] - xs[i] - 2 * pad;
                List<String> ls = cols.get(i).wrap() ? wrap(v, f, fs, cw) : List.of(cut(v, f, fs, cw));
                if (ls.size() > 3) ls = List.of(ls.get(0), ls.get(1), cut(ls.get(2) + " ...", f, fs, cw));
                cells.add(ls);
                lines = Math.max(lines, ls.size());
            }
            float rh = 6 + lines * lh;
            if (y - rh < BOTTOM) {
                newPage(true);
                head.run();
            }
            if ("total".equals(r.style())) {
                fill(HEAD);
                rect(M, y - rh + 2, W - 2 * M, rh);
                stroke(NAVY, 0.8f);
                line(M, y + 2, W - M, y + 2);
            } else if ("mark".equals(r.style())) {
                fill(MARK);
                rect(M, y - rh + 2, W - 2 * M, rh);
            } else if (n++ % 2 == 1) {
                fill(ZEBRA);
                rect(M, y - rh + 2, W - 2 * M, rh);
            }
            for (int i = 0; i < cols.size(); i++) {
                Col c = cols.get(i);
                List<String> ls = cells.get(i);
                for (int k = 0; k < ls.size(); k++) {
                    String v = ls.get(k);
                    fill("muted".equals(r.style()) ? MUTED : v.startsWith("-") && c.right() ? BAD : INK);
                    float ty = y - 8 - k * lh;
                    if (c.right()) textRight(f, fs, xs[i + 1] - pad, ty, v);
                    else text(f, fs, xs[i] + pad, ty, v);
                }
            }
            y -= rh;
            stroke(LINE, 0.4f);
            line(M, y + 2, W - M, y + 2);
        }
        y -= 14;
        return this;
    }

    /** Space before the next part. */
    StatementPdf gap(float points) {
        y -= points;
        return this;
    }

    /** Starts a new page unless {@code space} points are left (a part that should not begin at the foot of a page). */
    StatementPdf keep(float space) {
        ensure(space);
        return this;
    }

    /** A new page for the next part. */
    StatementPdf pageBreak() {
        newPage(true);
        return this;
    }

    /** The PDF, locked with {@code password} when one is given. */
    byte[] finish(String password) {
        try {
            out.close();
            int pages = doc.getNumberOfPages();
            String made = STAMP.format(LocalDateTime.now());
            for (int i = 0; i < pages; i++) {
                PDPage page = doc.getPage(i);
                try (PDPageContentStream s = new PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true)) {
                    out = s;
                    stroke(LINE, 0.6f);
                    line(M, BOTTOM - 14, W - M, BOTTOM - 14);
                    fill(MUTED);
                    text(regular, 7, M, BOTTOM - 26, cut(org + "  |  " + title + "  |  " + period, regular, 7, W - 2 * M - 120));
                    textRight(regular, 7, W - M, BOTTOM - 26, "Page " + (i + 1) + " of " + pages);
                    text(regular, 6.5f, M, BOTTOM - 36, "Generated " + made + " from your Personal Budget books. Confidential: meant only for its recipients.");
                }
            }
            if (password != null && !password.isBlank()) {
                AccessPermission permission = new AccessPermission();
                byte[] owner = new byte[16];
                new SecureRandom().nextBytes(owner);
                StandardProtectionPolicy policy = new StandardProtectionPolicy(HexFormat.of().formatHex(owner), password, permission);
                policy.setEncryptionKeyLength(256);
                doc.protect(policy);
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            doc.save(bytes);
            doc.close();
            return bytes.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ================================================================== figures, as a bank prints them

    /** Rs. 1,23,456.00 (Indian grouping); negative with a leading minus. */
    static String rs(BigDecimal v) {
        return v == null ? "-" : "Rs. " + amount(v);
    }

    /** 1,23,456.00 */
    static String amount(BigDecimal v) {
        if (v == null) return "-";
        BigDecimal x = v.setScale(2, RoundingMode.HALF_UP);
        boolean neg = x.signum() < 0;
        String plain = x.abs().toPlainString();
        String whole = plain.substring(0, plain.indexOf('.')), frac = plain.substring(plain.indexOf('.'));
        StringBuilder sb = new StringBuilder();
        int len = whole.length();
        for (int i = 0; i < len; i++) {
            sb.append(whole.charAt(i));
            int left = len - 1 - i;
            if (left > 0 && (left == 3 || (left > 3 && (left - 3) % 2 == 0))) sb.append(',');
        }
        return (neg ? "-" : "") + sb + frac;
    }

    /** An amount or empty when it is zero (debit / credit columns). */
    static String amountOrBlank(BigDecimal v) {
        return v == null || v.signum() == 0 ? "" : amount(v);
    }

    static String percent(BigDecimal v) {
        return v == null ? "-" : v.setScale(1, RoundingMode.HALF_UP).toPlainString() + "%";
    }

    // ================================================================== drawing

    private void newPage(boolean slimHeader) {
        try {
            if (out != null) out.close();
            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);
            out = new PDPageContentStream(doc, page);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        y = H - M;
        if (slimHeader) {
            fill(NAVY);
            rect(0, H - 30, W, 30);
            fill(new float[]{1, 1, 1});
            text(bold, 9, M, H - 19, cut(title, bold, 9, W / 2));
            fill(new float[]{0.75f, 0.83f, 0.92f});
            textRight(regular, 8, W - M, H - 19, cut(org + "  |  " + period, regular, 8, W / 2 - M));
            y = H - 50;
        }
    }

    private void ensure(float space) {
        if (y - space < BOTTOM) newPage(true);
    }

    private float[] tone(String t) {
        return switch (t) {
            case "good" -> GOOD;
            case "bad" -> BAD;
            case "warn" -> WARN;
            default -> INK;
        };
    }

    private void fill(float[] c) {
        try {
            out.setNonStrokingColor(c[0], c[1], c[2]);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void stroke(float[] c, float width) {
        try {
            out.setStrokingColor(c[0], c[1], c[2]);
            out.setLineWidth(width);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void rect(float x, float y0, float w, float h) {
        try {
            out.addRect(x, y0, w, h);
            out.fill();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void line(float x1, float y1, float x2, float y2) {
        try {
            out.moveTo(x1, y1);
            out.lineTo(x2, y2);
            out.stroke();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void text(PDType1Font font, float size, float x, float y0, String s) {
        try {
            out.beginText();
            out.setFont(font, size);
            out.newLineAtOffset(x, y0);
            out.showText(clean(s, font));
            out.endText();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void textRight(PDType1Font font, float size, float right, float y0, String s) {
        text(font, size, right - width(font, size, s), y0, s);
    }

    private float width(PDType1Font font, float size, String s) {
        try {
            return font.getStringWidth(clean(s, font)) / 1000 * size;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Shortened with "..." to fit {@code max} points. */
    private String cut(String s, PDType1Font font, float size, float max) {
        if (s == null) return "";
        String t = clean(s, font);
        if (width(font, size, t) <= max) return t;
        while (!t.isEmpty() && width(font, size, t + "...") > max) t = t.substring(0, t.length() - 1);
        return t.isEmpty() ? "" : t.stripTrailing() + "...";
    }

    /** Lines of at most {@code max} points, broken at spaces (a word longer than a line is cut). */
    private List<String> wrap(String s, PDType1Font font, float size, float max) {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : clean(s == null ? "" : s, font).split("\\s+")) {
            String next = line.isEmpty() ? word : line + " " + word;
            if (width(font, size, next) <= max) {
                line.setLength(0);
                line.append(next);
            } else {
                if (!line.isEmpty()) lines.add(line.toString());
                line.setLength(0);
                line.append(cut(word, font, size, max));
            }
        }
        if (!line.isEmpty() || lines.isEmpty()) lines.add(line.toString());
        return lines;
    }

    /** Only what the standard fonts can show: the rupee becomes "Rs.", a few marks their plain forms, the rest "?". */
    private String clean(String s, PDType1Font font) {
        String t = s.replace("₹", "Rs. ").replace('−', '-').replace('–', '-').replace('—', '-').replace('•', '-')
                .replace('’', '\'').replace('‘', '\'').replace('“', '"').replace('”', '"').replace("…", "...")
                .replace('\n', ' ').replace('\r', ' ').replace('\t', ' ');
        StringBuilder sb = new StringBuilder(t.length());
        for (char c : t.toCharArray()) {
            sb.append(safe.computeIfAbsent(c, ch -> {
                try {
                    font.encode(String.valueOf(ch));
                    return ch;
                } catch (IOException | IllegalArgumentException e) {
                    return '?';
                }
            }));
        }
        return sb.toString();
    }
}
