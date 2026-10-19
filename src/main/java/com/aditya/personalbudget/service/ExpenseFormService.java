package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.SuggestionService.Suggestion;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Just what the quick "add expense" form of the mobile version needs, and nothing more: expense categories (most used
 * first, system ones last), the accounts one pays from (names and types, no balances) and past expense descriptions.
 * An access link that may record expenses therefore never sees balances or other history.
 */
@Service
public class ExpenseFormService {

    private static final Set<String> PAYERS = Set.of("BANK", "CASH", "WALLET", "CREDIT_CARD");

    public record Option(Long id, String name, String type, String typeLabel, boolean system) {
    }

    public record FormOptions(List<Option> categories, List<Option> payers, List<Suggestion> recent) {
    }

    private final CategoryRepository categories;
    private final AccountRepository accounts;
    private final SuggestionService suggestions;

    public ExpenseFormService(CategoryRepository categories, AccountRepository accounts, SuggestionService suggestions) {
        this.categories = categories;
        this.accounts = accounts;
        this.suggestions = suggestions;
    }

    public FormOptions options() {
        Long tenantId = UserContext.tenantId();
        List<Suggestion> history = suggestions.all().getOrDefault("narration", List.of()).stream()
                .filter(s -> s.kinds() != null && s.kinds().contains("EXPENSE"))
                .toList();
        Map<Long, Integer> categoryUse = new HashMap<>(), payerUse = new HashMap<>();
        history.forEach(s -> {
            if (s.categoryId() != null) categoryUse.merge(s.categoryId(), s.count(), Integer::sum);
            if (s.creditAccountId() != null) payerUse.merge(s.creditAccountId(), s.count(), Integer::sum);
        });
        List<Option> cats = categories.findByTenantIdAndKind(tenantId, CategoryKind.EXPENSE).stream()
                .filter(c -> Boolean.TRUE.equals(c.getActive()))
                .sorted(Comparator.comparing((Category c) -> c.getSystemKey() != null)
                        .thenComparing(c -> -categoryUse.getOrDefault(c.getId(), 0))
                        .thenComparing(Category::getName))
                .map(c -> new Option(c.getId(), c.getName(), null, null, c.getSystemKey() != null))
                .toList();
        List<Option> payers = accounts.findByTenantId(tenantId).stream()
                .filter(a -> Boolean.TRUE.equals(a.getActive()) && PAYERS.contains(a.getAccountType().name()))
                .sorted(Comparator.comparing(a -> -payerUse.getOrDefault(a.getId(), 0)))
                .map(a -> new Option(a.getId(), a.getName(), a.getAccountType().name(), a.getAccountType().getLabel(), false))
                .toList();
        return new FormOptions(cats, payers, history.stream().limit(60).toList());
    }
}
