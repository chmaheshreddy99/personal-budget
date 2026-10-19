package com.aditya.personalbudget.service;

import com.aditya.personalbudget.service.HostedChitShareService.PublicReceipt;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A one-page A5 PDF of a hosted chit payment receipt, written by hand (no PDF library): the figures, the organiser's
 * drawn signature as vector strokes, and the receipt's seal. Uses the standard Helvetica fonts, so the rupee sign is
 * written "Rs.".
 */
final class ReceiptPdf {

    private static final float W = 420, H = 595;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final Pattern POINT = Pattern.compile("([MLml])\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)");

    private final StringBuilder page = new StringBuilder();

    private ReceiptPdf() {
    }

    static byte[] render(String household, String chitName, PublicReceipt r) {
        ReceiptPdf pdf = new ReceiptPdf();
        pdf.draw(household, chitName, r);
        return pdf.document();
    }

    private void draw(String household, String chitName, PublicReceipt r) {
        float m = 32;
        // header band
        fill(0.16f, 0.36f, 0.62f);
        rect(0, H - 92, W, 92);
        fill(1, 1, 1);
        text("F2", 9, m, H - 30, cut(household, 60).toUpperCase(Locale.ROOT) + "  -  PAYMENT RECEIPT");
        text("F2", 17, m, H - 54, cut(chitName, 40));
        text("F1", 10, m, H - 74, "Receipt " + r.receiptNo() + "   |   " + day(r.paidDate()));

        // amount
        float y = H - 128;
        fill(0.35f, 0.38f, 0.42f);
        text("F1", 9, m, y, "RECEIVED FROM");
        fill(0.07f, 0.09f, 0.12f);
        text("F2", 14, m, y - 18, cut(r.memberName(), 40));
        fill(0.35f, 0.38f, 0.42f);
        textRight("F1", 9, W - m, y, "AMOUNT");
        fill(0.05f, 0.45f, 0.25f);
        textRight("F2", 18, W - m, y - 20, rs(r.total()));
        fill(0.35f, 0.38f, 0.42f);
        text("F1", 8.5f, m, y - 36, cut(HostedChitService.inWords(r.total()), 80));

        // lines
        y -= 62;
        List<String[]> lines = new ArrayList<>();
        lines.add(new String[]{"Towards", "Month " + r.monthNo() + " installment (due " + day(r.monthDueDate()) + ")"});
        lines.add(new String[]{"Installment paid", rs(r.amount())});
        if (r.lateFee().signum() > 0) lines.add(new String[]{"Late payment interest", rs(r.lateFee())});
        if (r.lateFeeWaived().signum() > 0) lines.add(new String[]{"Late interest let off", rs(r.lateFeeWaived())});
        lines.add(new String[]{"Paid by", r.mode() + (r.reference() != null ? "  -  ref " + cut(r.reference(), 40) : "")});
        lines.add(new String[]{"Month " + r.monthNo() + " so far", rs(r.paidForMonth()) + " of " + rs(r.dueForMonth())
                + (r.balanceForMonth().signum() > 0 ? "  -  " + rs(r.balanceForMonth()) + " still due" : "  -  fully paid")});
        for (String[] line : lines) {
            stroke(0.88f, 0.9f, 0.92f);
            line(m, y - 7, W - m, y - 7, 0.6f);
            fill(0.35f, 0.38f, 0.42f);
            text("F1", 9.5f, m, y, line[0]);
            fill(0.07f, 0.09f, 0.12f);
            textRight("F2", 9.5f, W - m, y, line[1]);
            y -= 24;
        }

        // signature
        y -= 14;
        float boxW = 170, boxH = 51, boxX = W - m - boxW, boxY = y - boxH;
        if (r.signature() != null) {
            signature(r.signature(), boxX, boxY, boxW, boxH);
        }
        stroke(0.6f, 0.62f, 0.66f);
        line(boxX, boxY - 4, W - m, boxY - 4, 0.7f);
        fill(0.07f, 0.09f, 0.12f);
        textRight("F2", 9.5f, W - m, boxY - 17, cut(r.signer() != null ? r.signer() : "Organiser", 40));
        fill(0.35f, 0.38f, 0.42f);
        textRight("F1", 8, W - m, boxY - 29, r.signature() != null ? "Digitally signed - organiser" : "Organiser");

        // seal
        float sy = boxY - 62;
        fill(0.94f, 0.97f, 0.95f);
        rect(m, sy - 34, W - 2 * m, 46);
        fill(0.05f, 0.45f, 0.25f);
        text("F2", 8.5f, m + 10, sy, "DIGITAL SEAL (HMAC-SHA256)");
        fill(0.2f, 0.25f, 0.3f);
        text("F3", 7.2f, m + 10, sy - 13, r.seal().substring(0, 32));
        text("F3", 7.2f, m + 10, sy - 24, r.seal().substring(32));
        fill(0.45f, 0.48f, 0.52f);
        text("F1", 7.5f, m, 40, "The seal is computed by the organiser's records over every figure on this receipt.");
        text("F1", 7.5f, m, 29, "Open the receipt link to check it: any changed figure gives a different seal.");
    }

    /** Draws an SVG path (M/L commands in a 1000 x 300 box) fitted into the given box. */
    private void signature(String path, float x, float y, float w, float h) {
        float sx = w / 1000f, sy = h / 300f;
        StringBuilder out = new StringBuilder();
        Matcher matcher = POINT.matcher(path);
        float cx = 0, cy = 0;
        while (matcher.find()) {
            boolean relative = Character.isLowerCase(matcher.group(1).charAt(0));
            float px = Float.parseFloat(matcher.group(2)), py = Float.parseFloat(matcher.group(3));
            cx = relative ? cx + px : px;
            cy = relative ? cy + py : py;
            out.append(n(x + cx * sx)).append(' ').append(n(y + h - cy * sy))
                    .append(Character.toUpperCase(matcher.group(1).charAt(0)) == 'M' ? " m\n" : " l\n");
        }
        if (out.isEmpty()) return;
        page.append("q 0.04 0.18 0.31 RG 1.3 w 1 J 1 j\n").append(out).append("S Q\n");
    }

    // ---------------------------------------------------------------- drawing primitives

    private void fill(float r, float g, float b) {
        page.append(n(r)).append(' ').append(n(g)).append(' ').append(n(b)).append(" rg\n");
    }

    private void stroke(float r, float g, float b) {
        page.append(n(r)).append(' ').append(n(g)).append(' ').append(n(b)).append(" RG\n");
    }

    private void rect(float x, float y, float w, float h) {
        page.append(n(x)).append(' ').append(n(y)).append(' ').append(n(w)).append(' ').append(n(h)).append(" re f\n");
    }

    private void line(float x1, float y1, float x2, float y2, float width) {
        page.append(n(width)).append(" w ").append(n(x1)).append(' ').append(n(y1)).append(" m ")
                .append(n(x2)).append(' ').append(n(y2)).append(" l S\n");
    }

    private void text(String font, float size, float x, float y, String s) {
        page.append("BT /").append(font).append(' ').append(n(size)).append(" Tf ").append(n(x)).append(' ').append(n(y))
                .append(" Td (").append(escape(s)).append(") Tj ET\n");
    }

    private void textRight(String font, float size, float right, float y, String s) {
        text(font, size, right - width(font, s) * size / 1000f, y, s);
    }

    /** Approximate Helvetica widths (per 1000 units), enough to right-align figures. */
    private static float width(String font, String s) {
        float total = 0;
        boolean bold = "F2".equals(font);
        for (char ch : s.toCharArray()) {
            if ("F3".equals(font)) { total += 600; continue; }
            if (ch >= '0' && ch <= '9') total += 556;
            else if (ch == ' ') total += 278;
            else if (".,:;|!il'".indexOf(ch) >= 0) total += bold ? 280 : 250;
            else if ("-()fjrt".indexOf(ch) >= 0) total += 333;
            else if ("mwMW".indexOf(ch) >= 0) total += bold ? 900 : 860;
            else if (Character.isUpperCase(ch)) total += bold ? 722 : 680;
            else total += bold ? 590 : 540;
        }
        return total;
    }

    // ---------------------------------------------------------------- document

    private byte[] document() {
        List<String> objects = java.util.Arrays.asList(
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + n(W) + " " + n(H) + "] /Contents 4 0 R"
                        + " /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>",
                null,   // the page content stream
                font("Helvetica"),
                font("Helvetica-Bold"),
                font("Courier"),
                "<< /Producer (Personal Budget) /Title (Payment receipt) >>");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        List<Integer> offsets = new ArrayList<>();
        write(out, "%PDF-1.4\n%âãÏÓ\n");
        byte[] content = page.toString().getBytes(StandardCharsets.ISO_8859_1);
        for (int i = 0; i < objects.size(); i++) {
            offsets.add(out.size());
            write(out, (i + 1) + " 0 obj\n");
            if (objects.get(i) == null) {
                write(out, "<< /Length " + content.length + " >>\nstream\n");
                out.writeBytes(content);
                write(out, "\nendstream");
            } else {
                write(out, objects.get(i));
            }
            write(out, "\nendobj\n");
        }
        int xref = out.size();
        StringBuilder table = new StringBuilder("xref\n0 " + (objects.size() + 1) + "\n0000000000 65535 f \n");
        offsets.forEach(o -> table.append(String.format("%010d 00000 n \n", o)));
        table.append("trailer\n<< /Size ").append(objects.size() + 1).append(" /Root 1 0 R /Info ").append(objects.size())
                .append(" 0 R >>\nstartxref\n").append(xref).append("\n%%EOF\n");
        write(out, table.toString());
        return out.toByteArray();
    }

    private static String font(String name) {
        return "<< /Type /Font /Subtype /Type1 /BaseFont /" + name + " /Encoding /WinAnsiEncoding >>";
    }

    private static void write(ByteArrayOutputStream out, String s) {
        out.writeBytes(s.getBytes(StandardCharsets.ISO_8859_1));
    }

    // ---------------------------------------------------------------- formatting

    private static String escape(String s) {
        StringBuilder b = new StringBuilder();
        for (char ch : s.replace("₹", "Rs.").replace('·', '-').replace('—', '-').replace('–', '-').toCharArray()) {
            if (ch == '(' || ch == ')' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 32) b.append(' ');
            else b.append(ch > 255 ? '?' : ch);
        }
        return b.toString();
    }

    /** Rs. 1,25,000 or Rs. 1,250.50 (Indian grouping). */
    static String rs(BigDecimal amount) {
        String plain = amount.setScale(2, RoundingMode.HALF_UP).abs().toPlainString();
        String whole = plain.substring(0, plain.indexOf('.'));
        String fraction = plain.substring(plain.indexOf('.'));
        StringBuilder grouped = new StringBuilder();
        for (int i = 0; i < whole.length(); i++) {
            grouped.append(whole.charAt(i));
            int left = whole.length() - i - 1;
            if (left == 3 || (left > 3 && left % 2 == 1)) grouped.append(',');
        }
        return (amount.signum() < 0 ? "-Rs. " : "Rs. ") + grouped + (fraction.equals(".00") ? "" : fraction);
    }

    private static String day(LocalDate d) {
        return d == null ? "-" : DAY.format(d);
    }

    private static String cut(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max - 1) + ".";
    }

    private static String n(float v) {
        if (v == Math.rint(v)) return String.valueOf((long) v);
        return BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }
}
