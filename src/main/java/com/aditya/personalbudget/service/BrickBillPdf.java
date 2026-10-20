package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.BrickOrder;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The bill of a brick order (or its invoice, once paid in full) as a PDF, in the classic paper look of the on-screen bill:
 * the company over a double rule, the bill's number in a box, who it is for, the bricks, the totals (delivery shown, and
 * a free delivery taken off it), payments, the amount in words and the signature lines. For sending to the customer.
 * The standard PDF fonts have no rupee sign, so amounts read "Rs."; letters they cannot show become "?".
 */
final class BrickBillPdf {

    private static final PDType1Font REG = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
    private static final PDType1Font BOLD = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
    private static final PDType1Font SERIF = new PDType1Font(Standard14Fonts.FontName.TIMES_BOLD);
    private static final PDType1Font ITALIC = new PDType1Font(Standard14Fonts.FontName.TIMES_ITALIC);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
    private static final float M = 40;   // page margin

    private final PDDocument doc = new PDDocument();
    private PDPageContentStream cs;
    private float y;
    private final float w = PDRectangle.A4.getWidth();
    private final float h = PDRectangle.A4.getHeight();

    private BrickBillPdf() {
    }

    static byte[] render(BrickSalesService.OrderView v) {
        try {
            return new BrickBillPdf().draw(v);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private byte[] draw(BrickSalesService.OrderView v) throws IOException {
        BrickOrder o = v.order();
        BrickSalesService.Totals t = v.totals();
        BrickService.Company c = v.company();
        boolean invoice = v.invoice() != null;
        boolean delivered = BrickSalesService.DELIVERED.equals(o.getStatus());
        newPage();

        // letterhead: the company, its title box, a double rule
        text(SERIF, 20, M, y - 18, up(c.name()));
        float hy = y - 34;
        if (c.address() != null) { text(REG, 9.5f, M, hy, c.address()); hy -= 12; }
        if (c.phone() != null) { text(REG, 9.5f, M, hy, "Phone " + c.phone()); }
        float bw = 150, bx = w - M - bw;
        box(bx, y - 52, bw, 52, 1.2f);
        rightText(SERIF, 10, bx + bw - 8, y - 14, spaced(invoice ? "TAX INVOICE" : "BILL"));
        rightText(BOLD, 13, bx + bw - 8, y - 30, invoice ? v.invoice().invoiceNo() : o.getOrderNo());
        rightText(REG, 8.5f, bx + bw - 8, y - 44, invoice ? "Issued " + day(v.invoice().issuedAt().toLocalDate()) + " · order " + o.getOrderNo()
                : "Order date " + day(o.getOrderDate()));
        y -= 62;
        line(M, y, w - M, y, 1);
        line(M, y - 3, w - M, y - 3, 1);
        y -= 14;

        // who and what: three boxed cells
        float cw = (w - 2 * M) / 3, top = y, ch = 58;
        box(M, top - ch, w - 2 * M, ch, 0.8f);
        line(M + cw * 1.4f, top, M + cw * 1.4f, top - ch, 0.8f);
        line(M + cw * 2.2f, top, M + cw * 2.2f, top - ch, 0.8f);
        cell(M + 8, top, "BILLED TO", o.getCustomerName(), o.getCustomerPhone() == null ? null : "Mobile " + o.getCustomerPhone(),
                o.getAddress() == null ? null : o.getAddress() + (o.getLandmark() == null ? "" : ", near " + o.getLandmark()), cw * 1.4f - 16);
        cell(M + cw * 1.4f + 8, top, "ORDER", o.getOrderNo(), v.statusLabel(), o.getRequiredBy() == null ? null : "needed by " + day(o.getRequiredBy()), cw * 0.8f - 16);
        cell(M + cw * 2.2f + 8, top, "DELIVERY", t.trips() + (t.trips() == 1 ? " trip" : " trips"),
                String.format("%,d of %,d bricks delivered", t.delivered(), t.quantity()), v.vehicle(), cw * 0.8f - 16);
        y = top - ch - 14;

        // the bricks
        float[] cols = {M, M + 24, M + 225, M + 285, M + 355, M + 420, w - M};
        String[] heads = {"#", "DESCRIPTION", "QTY", "MRP", "RATE", "AMOUNT"};
        fill(M, y - 18, w - 2 * M, 18, new Color(241, 241, 241));
        box(M, y - 18, w - 2 * M, 18, 0.8f);
        for (int i = 0; i < heads.length; i++) {
            if (i < 2) text(BOLD, 8, cols[i] + 6, y - 12, heads[i]);
            else rightText(BOLD, 8, cols[i + 1] - 6, y - 12, heads[i]);
        }
        y -= 18;
        int n = 0;
        float tableTop = y;
        // the lines get at most 300 pt: with many of them they are set tighter, so the bill stays on one page
        float wanted = (float) v.items().stream().mapToDouble(i -> i.discount() != null && i.discount().signum() > 0 ? 28 : 18).sum();
        float squeeze = Math.min(1f, 300f / Math.max(1f, wanted));
        for (BrickSalesService.ItemView i : v.items()) {
            int q = delivered ? i.delivered() : i.quantity();
            float rh = (i.discount() != null && i.discount().signum() > 0 ? 28 : 18) * squeeze;
            text(REG, 9.5f, cols[0] + 6, y - 12, String.valueOf(++n));
            text(BOLD, 9.5f, cols[1] + 6, y - 12, i.name());
            if (rh > 18) text(ITALIC, 8.5f, cols[1] + 6, y - 23, i.discountPercent().setScale(1, java.math.RoundingMode.HALF_UP) + "% below MRP");
            rightText(REG, 9.5f, cols[3] - 6, y - 12, String.format("%,d", q));
            rightText(REG, 9.5f, cols[4] - 6, y - 12, i.mrp() == null ? "-" : rs(i.mrp()));
            rightText(REG, 9.5f, cols[5] - 6, y - 12, rs(i.price()));
            for (int k = 2; k < cols.length - 1; k++) line(cols[k], y, cols[k], y - rh, 0.2f);
            rightText(REG, 9.5f, w - M - 6, y - 12, rs(i.price().multiply(BigDecimal.valueOf(q))));
            y -= rh;
            line(M, y, w - M, y, 0.3f);
        }
        line(M, tableTop, M, y, 0.8f);
        line(w - M, tableTop, w - M, y, 0.8f);
        line(M, y, w - M, y, 0.8f);
        y -= 14;

        // totals on the right, words and payments on the left
        List<String[]> rows = new ArrayList<>();
        if (t.discount().signum() > 0) {
            rows.add(new String[]{"At MRP", rs(t.atMrp()), ""});
            rows.add(new String[]{"Discount", "- " + rs(t.discount()), ""});
        }
        BigDecimal bricks = delivered ? t.billed().subtract(t.delivery()).subtract(t.handling()) : t.bricks();
        rows.add(new String[]{"Bricks", rs(bricks), ""});
        boolean toTransporter = BrickSalesService.isHired(o) && !BrickSalesService.US.equals(o.getHiredPaidBy());
        String trips = " (" + t.trips() + (t.trips() == 1 ? " trip)" : " trips)");
        if (toTransporter) {
            rows.add(new String[]{"Delivery" + trips, "paid to transporter", ""});
        } else if (Boolean.TRUE.equals(o.getDeliveryWaived()) && t.deliveryGross().signum() > 0) {
            rows.add(new String[]{"Delivery" + trips, rs(t.deliveryGross()), ""});
            rows.add(new String[]{"Free delivery", "- " + rs(t.deliveryGross()), ""});
        } else if (Boolean.TRUE.equals(o.getDeliveryWaived())) {
            rows.add(new String[]{"Delivery" + trips, "FREE", ""});
        } else {
            rows.add(new String[]{"Delivery" + trips, rs(t.delivery()), ""});
        }
        if (t.handling().signum() > 0) rows.add(new String[]{"Loading & unloading", rs(t.handling()), ""});
        rows.add(new String[]{delivered ? "Total billed" : "Total", rs(t.total()), "grand"});
        rows.add(new String[]{"Paid", rs(t.paid()), ""});
        rows.add(new String[]{t.balance().signum() >= 0 ? "Balance due" : "Advance with us", rs(t.balance().abs()), "due"});
        float tw = 230, tx = w - M - tw, ty = y;
        for (String[] r : rows) {
            boolean grand = "grand".equals(r[2]);
            if (grand) fill(tx, ty - 18, tw, 18, new Color(241, 241, 241));
            text(grand ? BOLD : REG, grand ? 10.5f : 9.5f, tx + 8, ty - 12.5f, r[0]);
            rightText(grand || "due".equals(r[2]) ? BOLD : REG, grand ? 10.5f : 9.5f, tx + tw - 8, ty - 12.5f, r[1]);
            ty -= 18;
            line(tx, ty, tx + tw, ty, grand ? 1 : 0.3f);
        }
        box(tx, ty, tw, y - ty, 0.8f);
        float ly = y - 4;
        text(BOLD, 7.5f, M, ly - 6, "AMOUNT IN WORDS");
        ly = wrap(ITALIC, 10.5f, M, ly - 20, HostedChitService.inWords(t.total()), tx - M - 20);
        if (Boolean.TRUE.equals(o.getDeliveryWaived()) && !toTransporter) {
            ly = wrap(REG, 9, M, ly - 6, "Free delivery" + (o.getWaiveReason() == null ? "" : ": " + o.getWaiveReason()), tx - M - 20);
        }
        if (toTransporter) ly = wrap(REG, 9, M, ly - 6, "Transport by a hired vehicle: its charges are paid to the transporter directly.", tx - M - 20);
        List<BrickSalesService.PaymentView> paid = v.payments().stream().filter(p -> "POSTED".equals(p.payment().getStatus())).toList();
        if (!paid.isEmpty()) {
            text(BOLD, 7.5f, M, ly - 14, "PAYMENTS RECEIVED");
            ly -= 26;
            for (BrickSalesService.PaymentView p : paid) {
                text(REG, 9, M, ly, (p.payment().getReceiptNo() == null ? "" : p.payment().getReceiptNo() + "  ") + day(p.payment().getReceivedOn()) + "  " + p.payment().getMode());
                rightText(BOLD, 9, tx - 20, ly, rs(p.payment().getAmount()));
                ly -= 13;
            }
        }
        y = Math.max(Math.min(ty, ly) - 60, M + 95);

        // signature lines
        float sw = (w - 2 * M - 40) / 3;
        String[][] sigs = {{o.getCustomerName(), "Customer"}, {c.accountantName() == null ? "Accountant" : c.accountantName(), "Accountant"},
                {c.ownerName() == null ? "Authorised signatory" : c.ownerName(), "For " + nz(c.name())}};
        for (int i = 0; i < 3; i++) {
            float sx = M + i * (sw + 20);
            line(sx, y, sx + sw, y, 0.8f);
            centerText(BOLD, 9, sx + sw / 2, y - 12, sigs[i][0]);
            centerText(REG, 7.5f, sx + sw / 2, y - 22, sigs[i][1]);
        }
        y -= 44;
        line(M, y, w - M, y, 0.3f);
        y -= 12;
        text(ITALIC, 8.5f, M, y, invoice ? "Digitally signed invoice " + v.invoice().invoiceNo() + " · key " + nz(v.keyFingerprint())
                : "This is a bill. The digitally signed invoice is issued once the order is paid in full.");
        y -= 10;
        line(M, y, w - M, y, 1);
        line(M, y - 3, w - M, y - 3, 1);
        centerText(ITALIC, 9.5f, w / 2, y - 16, "Thank you for your business" + (c.upiId() == null ? "" : " · Pay by UPI to " + c.upiId()));
        cs.close();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        doc.save(out);
        doc.close();
        return out.toByteArray();
    }

    // ------------------------------------------------------------------ drawing

    private void newPage() throws IOException {
        PDPage page = new PDPage(PDRectangle.A4);
        doc.addPage(page);
        cs = new PDPageContentStream(doc, page);
        box(M - 14, M - 14, w - 2 * M + 28, h - 2 * M + 28, 0.5f);
        y = h - M;
    }

    private void cell(float x, float top, String label, String main, String a, String b, float width) throws IOException {
        text(BOLD, 7, x, top - 12, label);
        text(BOLD, 10.5f, x, top - 25, fit(BOLD, 10.5f, nz(main), width));
        if (a != null) text(REG, 8.5f, x, top - 37, fit(REG, 8.5f, a, width));
        if (b != null) text(REG, 8.5f, x, top - 48, fit(REG, 8.5f, b, width));
    }

    private void text(PDType1Font f, float size, float x, float yy, String s) throws IOException {
        cs.beginText();
        cs.setFont(f, size);
        cs.newLineAtOffset(x, yy);
        cs.showText(safe(f, s));
        cs.endText();
    }

    private void rightText(PDType1Font f, float size, float right, float yy, String s) throws IOException {
        text(f, size, right - width(f, size, s), yy, s);
    }

    private void centerText(PDType1Font f, float size, float cx, float yy, String s) throws IOException {
        text(f, size, cx - width(f, size, s) / 2, yy, s);
    }

    /** Writes s within maxWidth, line by line; returns the y below it. */
    private float wrap(PDType1Font f, float size, float x, float yy, String s, float maxWidth) throws IOException {
        StringBuilder lineText = new StringBuilder();
        for (String word : nz(s).split(" ")) {
            String next = lineText.isEmpty() ? word : lineText + " " + word;
            if (width(f, size, next) > maxWidth && !lineText.isEmpty()) {
                text(f, size, x, yy, lineText.toString());
                yy -= size + 3;
                lineText = new StringBuilder(word);
            } else {
                lineText = new StringBuilder(next);
            }
        }
        if (!lineText.isEmpty()) {
            text(f, size, x, yy, lineText.toString());
            yy -= size + 3;
        }
        return yy;
    }

    private String fit(PDType1Font f, float size, String s, float width) throws IOException {
        String t = s;
        while (t.length() > 3 && width(f, size, t) > width) t = t.substring(0, t.length() - 2);
        return t.equals(s) ? s : t + "…";
    }

    private float width(PDType1Font f, float size, String s) throws IOException {
        return f.getStringWidth(safe(f, s)) / 1000 * size;
    }

    private void line(float x1, float y1, float x2, float y2, float lw) throws IOException {
        cs.setLineWidth(lw);
        cs.moveTo(x1, y1);
        cs.lineTo(x2, y2);
        cs.stroke();
    }

    private void box(float x, float yy, float bw, float bh, float lw) throws IOException {
        cs.setLineWidth(lw);
        cs.addRect(x, yy, bw, bh);
        cs.stroke();
    }

    private void fill(float x, float yy, float bw, float bh, Color color) throws IOException {
        cs.setNonStrokingColor(color);
        cs.addRect(x, yy, bw, bh);
        cs.fill();
        cs.setNonStrokingColor(Color.BLACK);
    }

    /** What the standard fonts cannot show (other scripts, the rupee sign) becomes "?" rather than failing. */
    private static String safe(PDType1Font f, String s) {
        StringBuilder out = new StringBuilder();
        nz(s).codePoints().forEach(cp -> {
            String ch = new String(Character.toChars(cp));
            if (cp == 0x20B9) { out.append("Rs."); return; }
            try {
                f.encode(ch);
                out.append(ch);
            } catch (IOException | IllegalArgumentException e) {
                out.append('?');
            }
        });
        return out.toString();
    }

    private static String rs(BigDecimal v) {
        return "Rs. " + String.format(Locale.ENGLISH, "%,.2f", v == null ? BigDecimal.ZERO : v);
    }

    private static String day(LocalDate d) {
        return d == null ? "" : d.format(DAY);
    }

    private static String up(String s) {
        return nz(s).toUpperCase(Locale.ENGLISH);
    }

    private static String spaced(String s) {
        return String.join(" ", s.split(""));
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
