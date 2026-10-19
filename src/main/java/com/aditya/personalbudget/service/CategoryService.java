package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryRequest;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.BudgetRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.RecurringTransactionRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Expense and income categories: list with this month's figures, add, rename, switch off, delete.
 * A category in use (journal lines, budgets, recurring items, bills) can only be switched off.
 */
@Service
public class CategoryService {

    private final CategoryRepository categories;
    private final BudgetRepository budgets;
    private final RecurringTransactionRepository recurring;
    private final ClaimRepository claims;
    private final LedgerService ledger;

    public CategoryService(CategoryRepository categories, BudgetRepository budgets, RecurringTransactionRepository recurring,
                           ClaimRepository claims, LedgerService ledger) {
        this.categories = categories;
        this.budgets = budgets;
        this.recurring = recurring;
        this.claims = claims;
        this.ledger = ledger;
    }

    // ================================================================== queries

    public List<CategoryView> list() {
        Long tenantId = UserContext.tenantId();
        LedgerSnapshot books = ledger.snapshot();
        YearMonth month = YearMonth.now();
        // as the budget sees them: Chit Payments shows the cash paid into chits
        Map<Long, BigDecimal> thisMonth = books.budgetMovements(month.atDay(1), month.atEndOfMonth());
        Map<Long, BigDecimal> lastMonth = books.budgetMovements(month.minusMonths(1).atDay(1), month.minusMonths(1).atEndOfMonth());
        Map<Long, BigDecimal> last3 = books.budgetMovements(month.minusMonths(3).atDay(1), month.minusMonths(1).atEndOfMonth());
        Map<Long, Long> counts = new HashMap<>();
        Map<Long, LocalDate> lastUsed = new HashMap<>();
        books.budgetLines().stream().filter(l -> l.categoryId() != null).forEach(l -> {
            counts.merge(l.categoryId(), 1L, Long::sum);
            lastUsed.merge(l.categoryId(), l.date(), (a, b) -> a.isAfter(b) ? a : b);
        });
        Map<Long, Budget> budgetByCategory = budgets.findByMonth(tenantId, month.toString()).stream()
                .collect(Collectors.toMap(Budget::getCategoryId, Function.identity(), (a, b) -> a));
        return categories.findByTenantId(tenantId).stream()
                .sorted(Comparator.comparing(Category::getKind).thenComparing(Category::getCode))
                .map(c -> new CategoryView(c.getId(), c.getKind(), c.getCode(), c.getName(), c.getDescription(),
                        c.getSystemKey(), c.getSystemKey() != null, Boolean.TRUE.equals(c.getActive()), c.getVersion(),
                        thisMonth.getOrDefault(c.getId(), Money.ZERO), lastMonth.getOrDefault(c.getId(), Money.ZERO),
                        last3.getOrDefault(c.getId(), Money.ZERO).divide(BigDecimal.valueOf(3), 2, RoundingMode.HALF_UP),
                        counts.getOrDefault(c.getId(), 0L), lastUsed.get(c.getId()),
                        budgetByCategory.containsKey(c.getId()) ? budgetByCategory.get(c.getId()).getMonthlyLimit() : null))
                .toList();
    }

    public Category require(Long id) {
        return categories.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Category", id));
    }

    /** A category of the given kind, or a clear error when it is of the other kind. */
    public Category require(Long id, CategoryKind kind) {
        Category category = require(id);
        if (category.getKind() != kind) {
            throw new BusinessException("'" + category.getName() + "' is an " + category.getKind().getLabel().toLowerCase()
                    + " category; pick an " + kind.getLabel().toLowerCase() + " category");
        }
        return category;
    }

    /** One of the categories the application posts to by itself (see {@link DefaultChartOfAccounts}). */
    public Category system(String systemKey) {
        return categories.findBySystemKey(UserContext.tenantId(), systemKey)
                .orElseThrow(() -> new BusinessException("System category " + systemKey + " is missing"));
    }

    // ================================================================== commands

    @Transactional
    public CategoryView create(CategoryRequest request) {
        Long tenantId = UserContext.tenantId();
        String name = request.name().trim();
        if (categories.findByName(tenantId, request.kind(), name).isPresent()) {
            throw new BusinessException("'" + name + "' already exists");
        }
        Category c = new Category();
        c.setTenantId(tenantId);
        c.setKind(request.kind());
        c.setName(name);
        c.setDescription(blankToNull(request.description()));
        c.setCode(request.code() != null && !request.code().isBlank() ? request.code().trim() : nextCode(tenantId, request.kind()));
        c.setActive(request.active() == null || request.active());
        c.setCreatedAt(LocalDateTime.now());
        c = categories.save(c);
        return view(c.getId());
    }

    @Transactional
    public CategoryView update(Long id, CategoryRequest request) {
        Category c = require(id);
        if (request.kind() != null && request.kind() != c.getKind()) {
            throw new BusinessException("A category cannot switch between expense and income");
        }
        String name = request.name().trim();
        categories.findByName(c.getTenantId(), c.getKind(), name).filter(o -> !o.getId().equals(id)).ifPresent(o -> {
            throw new BusinessException("'" + name + "' already exists");
        });
        if (c.getSystemKey() != null && Boolean.FALSE.equals(request.active())) {
            throw new BusinessException("'" + c.getName() + "' is used by the application and cannot be switched off");
        }
        c.setName(name);
        c.setDescription(blankToNull(request.description()));
        if (request.code() != null && !request.code().isBlank()) {
            c.setCode(request.code().trim());
        }
        c.setActive(request.active() == null || request.active());
        c.setVersion(request.version());   // a stale form is refused (optimistic locking)
        categories.save(c);
        return view(id);
    }

    @Transactional
    public void delete(Long id) {
        Category c = require(id);
        if (c.getSystemKey() != null) {
            throw new BusinessException("'" + c.getName() + "' is used by the application and cannot be deleted");
        }
        boolean used = ledger.snapshot().lines().stream().anyMatch(l -> id.equals(l.categoryId()))
                || budgets.findByTenantId(c.getTenantId()).stream().anyMatch(b -> id.equals(b.getCategoryId()))
                || recurring.findByTenantId(c.getTenantId()).stream().anyMatch(r -> id.equals(r.getCategoryId()))
                || claims.findByTenantId(c.getTenantId()).stream().anyMatch(r -> id.equals(r.getCategoryId()));
        if (used) {
            throw new BusinessException("'" + c.getName() + "' is in use. Switch it off instead, so it stops appearing in pickers");
        }
        categories.delete(c);
    }

    // ================================================================== helpers

    private CategoryView view(Long id) {
        return list().stream().filter(v -> v.id().equals(id)).findFirst().orElseThrow();
    }

    /** Next code in the kind's range, stepping by 10 (4010, 4020 ... / 5010, 5020 ...), below the x990 catch-all. */
    private String nextCode(Long tenantId, CategoryKind kind) {
        int base = kind == CategoryKind.INCOME ? 4000 : 5000;
        int max = categories.findByTenantIdAndKind(tenantId, kind).stream()
                .map(Category::getCode).filter(code -> code.matches("\\d+")).mapToInt(Integer::parseInt)
                .filter(code -> code >= base && code < base + 990).max().orElse(base);
        int next = (max / 10 + 1) * 10;
        return String.valueOf(next < base + 990 ? next : base + 995);
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.trim();
    }
}
