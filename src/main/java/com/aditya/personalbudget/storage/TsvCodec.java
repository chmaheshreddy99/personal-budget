package com.aditya.personalbudget.storage;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Converts column values to and from their text form in a tab-separated file.
 * <p>
 * An empty cell means NULL. Tabs, line breaks and backslashes inside text are escaped
 * as backslash-t, backslash-n, backslash-r and double backslash, so one row is always one line.
 */
final class TsvCodec {

    private TsvCodec() {
    }

    static String encode(Object value) {
        if (value == null) {
            return "";
        }
        return switch (value) {
            case String s -> escape(s);
            case BigDecimal d -> d.toPlainString();
            case Enum<?> e -> e.name();
            default -> value.toString(); // Long, Integer, Boolean, LocalDate, LocalDateTime (ISO-8601)
        };
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static Object decode(String raw, Class<?> type) {
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        if (type == String.class) {
            return unescape(raw);
        }
        if (type == Long.class) {
            return Long.valueOf(raw);
        }
        if (type == Integer.class) {
            return Integer.valueOf(raw);
        }
        if (type == BigDecimal.class) {
            return new BigDecimal(raw);
        }
        if (type == Boolean.class) {
            return Boolean.valueOf(raw);
        }
        if (type == LocalDate.class) {
            return LocalDate.parse(raw);
        }
        if (type == LocalDateTime.class) {
            return LocalDateTime.parse(raw);
        }
        if (type.isEnum()) {
            return Enum.valueOf((Class<? extends Enum>) type, raw);
        }
        throw new IllegalArgumentException("Unsupported column type " + type.getName());
    }

    private static String escape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '\\' -> out.append("\\\\");
                case '\t' -> out.append("\\t");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                default -> out.append(ch);
            }
        }
        return out.toString();
    }

    private static String unescape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && i + 1 < s.length()) {
                char next = s.charAt(++i);
                switch (next) {
                    case 't' -> out.append('\t');
                    case 'n' -> out.append('\n');
                    case 'r' -> out.append('\r');
                    default -> out.append(next);
                }
            } else {
                out.append(ch);
            }
        }
        return out.toString();
    }
}
