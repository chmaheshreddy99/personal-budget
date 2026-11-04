package com.aditya.personalbudget.service;

import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

/**
 * The order a household arranged its lists in by dragging (accounts, chits, budgets), shared by every browser and
 * the phone app. Kept in {@code data/app-settings.properties} as {@code order.<household>.<list>=3,1,2}; a list never
 * arranged has no row, and what the list holds beyond the saved ids keeps its usual place after them.
 */
@Service
public class ListOrderService {

    public static final Set<String> LISTS = Set.of("accounts", "chits", "budgets");
    private static final int MAX_IDS = 5000;

    private final AppSettingsService settings;

    public ListOrderService(AppSettingsService settings) {
        this.settings = settings;
    }

    /** Every arranged list of the household: its ids, first to last. */
    public Map<String, List<Long>> orders() {
        Map<String, List<Long>> out = new LinkedHashMap<>();
        settings.readPrefixed(prefix()).forEach((list, csv) -> {
            if (LISTS.contains(list)) out.put(list, parse(csv));
        });
        return out;
    }

    /** Saves a list's order; an empty one goes back to the usual order. */
    public synchronized Map<String, List<Long>> save(String list, List<Long> ids) {
        if (!LISTS.contains(list)) throw new BusinessException("There is no list called " + list);
        if (ids != null && ids.size() > MAX_IDS) throw new BusinessException("That list is too long to arrange");
        Map<String, String> values = new HashMap<>(settings.readPrefixed(prefix()));
        if (ids == null || ids.isEmpty()) {
            values.remove(list);
        } else {
            values.put(list, String.join(",", new LinkedHashSet<>(ids).stream().filter(Objects::nonNull).map(String::valueOf).toList()));
        }
        settings.writePrefixed(prefix(), values);
        return orders();
    }

    /** Puts items in the list's saved order: those saved first, the rest after them as they came. */
    public <T> List<T> arrange(String list, List<T> items, Function<T, Long> id) {
        List<Long> saved = orders().get(list);
        if (saved == null) return items;
        Map<Long, Integer> rank = new HashMap<>();
        for (int i = 0; i < saved.size(); i++) rank.put(saved.get(i), i);
        List<T> out = new ArrayList<>(items);
        out.sort(Comparator.comparingInt(x -> rank.getOrDefault(id.apply(x), Integer.MAX_VALUE)));
        return out;
    }

    private static String prefix() {
        return "order." + UserContext.tenantId() + ".";
    }

    private static List<Long> parse(String csv) {
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> s.matches("\\d{1,18}")).map(Long::valueOf).toList();
    }
}
