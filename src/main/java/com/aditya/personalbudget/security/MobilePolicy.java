package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;

import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What the mobile app shows each role, set by an admin on the web (kept in {@code Organization.mobilePolicy} as
 * {@code ROLE:mask:FEATURE+FEATURE:record;...}):
 * <ul>
 *   <li>{@code mask}: {@link #NONE} balances are shown, {@link #TAP} hidden until tapped, {@link #ALWAYS} never shown;</li>
 *   <li>{@code features}: the mobile sections the role may use, on top of what is shared with each user
 *       ({@code *}: all of them). Enforced by the server: a section left out is not reachable from the phone;</li>
 *   <li>{@code record}: the role may record (expenses, payments ...) on the phone, as far as the role allows.</li>
 * </ul>
 */
public final class MobilePolicy {

    public static final String NONE = "NONE";
    public static final String TAP = "TAP";
    public static final String ALWAYS = "ALWAYS";

    /** One role's rule. */
    public record Rule(String mask, Set<Feature> features, boolean record) {

        public static Rule open() {
            return new Rule(NONE, Feature.allMobile(), true);
        }
    }

    private MobilePolicy() {
    }

    /** Every role's rule (roles not set: {@link Rule#open()}). */
    public static Map<UserRole, Rule> rules(Organization org) {
        Map<UserRole, Rule> out = new EnumMap<>(UserRole.class);
        for (UserRole r : UserRole.values()) out.put(r, Rule.open());
        String text = org == null ? null : org.getMobilePolicy();
        if (text == null || text.isBlank()) return out;
        for (String entry : text.split(";")) {
            String[] p = entry.trim().split(":", -1);
            if (p.length < 4) continue;
            UserRole role = Arrays.stream(UserRole.values()).filter(r -> r.name().equals(p[0].trim())).findFirst().orElse(null);
            if (role == null) continue;
            String mask = Set.of(NONE, TAP, ALWAYS).contains(p[1].trim()) ? p[1].trim() : NONE;
            Set<Feature> features = "*".equals(p[2].trim()) ? Feature.allMobile()
                    : Feature.parse(p[2].replace('+', ','), Feature.allMobile());
            out.put(role, new Rule(mask, features, !"0".equals(p[3].trim())));
        }
        return out;
    }

    public static Rule of(Organization org, UserRole role) {
        return role == null ? Rule.open() : rules(org).get(role);
    }

    /** As stored; null when every role is open. */
    public static String format(Map<UserRole, Rule> rules) {
        String text = rules.entrySet().stream()
                .filter(e -> !isOpen(e.getValue()))
                .map(e -> String.join(":", e.getKey().name(), e.getValue().mask(),
                        e.getValue().features().containsAll(Feature.allMobile()) ? "*" : e.getValue().features().isEmpty() ? "-"
                                : e.getValue().features().stream().sorted().map(Enum::name).collect(Collectors.joining("+")),
                        e.getValue().record() ? "1" : "0"))
                .collect(Collectors.joining(";"));
        return text.isEmpty() ? null : text;
    }

    private static boolean isOpen(Rule r) {
        return NONE.equals(r.mask()) && r.record() && r.features().containsAll(Feature.allMobile());
    }

    /** The features of a rule, never empty by mistake: an empty set means nothing is shared. */
    public static Set<Feature> features(Rule r) {
        return r.features().isEmpty() ? EnumSet.noneOf(Feature.class) : EnumSet.copyOf(r.features());
    }
}
