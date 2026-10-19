package com.aditya.personalbudget.service;

import com.aditya.personalbudget.exception.BusinessException;

import java.util.Map;

/**
 * ID proof on agreements, kept to the minimum: an Aadhaar number is checked (12 digits, Verhoeff check digit) and only
 * its last 4 digits and a salted SHA-256 are stored; a PAN is checked (ABCDE1234F) and stored masked with its hash.
 * Also writes the evidence of an acceptance as exact JSON, the text that is hashed and digitally signed.
 */
public final class Kyc {

    private Kyc() {
    }

    private static final int[][] D = {
            {0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 2, 3, 4, 0, 6, 7, 8, 9, 5}, {2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
            {3, 4, 0, 1, 2, 8, 9, 5, 6, 7}, {4, 0, 1, 2, 3, 9, 5, 6, 7, 8}, {5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
            {6, 5, 9, 8, 7, 1, 0, 4, 3, 2}, {7, 6, 5, 9, 8, 2, 1, 0, 4, 3}, {8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
            {9, 8, 7, 6, 5, 4, 3, 2, 1, 0}};
    private static final int[][] P = {
            {0, 1, 2, 3, 4, 5, 6, 7, 8, 9}, {1, 5, 7, 6, 2, 8, 3, 0, 9, 4}, {5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
            {8, 9, 1, 6, 0, 4, 3, 5, 2, 7}, {9, 4, 5, 3, 1, 2, 6, 8, 7, 0}, {4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
            {2, 7, 9, 3, 8, 0, 6, 4, 1, 5}, {7, 0, 4, 6, 9, 1, 3, 2, 5, 8}};

    /** The 12 digits of a valid Aadhaar number (spaces and dashes dropped), or an error that says what is wrong. */
    public static String aadhaar(String typed) {
        String digits = typed == null ? "" : typed.replaceAll("[\\s-]", "");
        if (!digits.matches("\\d{12}")) {
            throw new BusinessException("The Aadhaar number has 12 digits");
        }
        if (digits.charAt(0) == '0' || digits.charAt(0) == '1') {
            throw new BusinessException("An Aadhaar number does not start with 0 or 1; check the number");
        }
        int c = 0;
        for (int i = 0; i < 12; i++) {
            c = D[c][P[i % 8][digits.charAt(11 - i) - '0']];
        }
        if (c != 0) {
            throw new BusinessException("That Aadhaar number is not valid (its check digit does not match); check each digit");
        }
        return digits;
    }

    /** A valid PAN in capitals (ABCDE1234F), or an error. */
    public static String pan(String typed) {
        String v = typed == null ? "" : typed.replaceAll("\\s", "").toUpperCase();
        if (!v.matches("[A-Z]{3}[ABCFGHLJPT][A-Z]\\d{4}[A-Z]")) {
            throw new BusinessException("The PAN looks like ABCDE1234F (5 letters, 4 digits, a letter)");
        }
        return v;
    }

    /** ABCDE1234F → ABCDE••••F */
    public static String maskPan(String pan) {
        return pan.substring(0, 5) + "••••" + pan.substring(9);
    }

    /** SHA-256 of the value salted with something of the agreement, so the hash cannot be looked up elsewhere. */
    public static String hash(String salt, String value) {
        return HostedChitService.sha256(salt + "|" + value);
    }

    /** The map (in its order) as compact JSON: strings, numbers, booleans, nested maps and null. */
    public static String json(Map<String, ?> map) {
        StringBuilder b = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, ?> e : map.entrySet()) {
            if (!first) b.append(',');
            first = false;
            b.append(quote(e.getKey())).append(':').append(value(e.getValue()));
        }
        return b.append('}').toString();
    }

    @SuppressWarnings("unchecked")
    private static String value(Object v) {
        if (v == null) return "null";
        if (v instanceof Map<?, ?> m) return json((Map<String, ?>) m);
        if (v instanceof Iterable<?> list) {
            StringBuilder b = new StringBuilder("[");
            boolean first = true;
            for (Object x : list) {
                if (!first) b.append(',');
                first = false;
                b.append(value(x));
            }
            return b.append(']').toString();
        }
        if (v instanceof Boolean || v instanceof Integer || v instanceof Long) return v.toString();
        if (v instanceof java.math.BigDecimal d) return d.stripTrailingZeros().toPlainString();
        return quote(v.toString());
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder().append('"');
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }
}
