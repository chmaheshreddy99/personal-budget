package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class CategoryRepository extends TenantScopedRepository<Category> {

    public CategoryRepository(TsvDataStore store) {
        super(store, Category.class);
    }

    public List<Category> findByTenantIdAndKind(Long tenantId, CategoryKind kind) {
        return findWhere(c -> c.getTenantId().equals(tenantId) && c.getKind() == kind).stream()
                .sorted(Comparator.comparing(Category::getCode)).toList();
    }

    public Optional<Category> findBySystemKey(Long tenantId, String systemKey) {
        return findFirstWhere(c -> c.getTenantId().equals(tenantId) && systemKey.equals(c.getSystemKey()));
    }

    public Optional<Category> findByName(Long tenantId, CategoryKind kind, String name) {
        return findFirstWhere(c -> c.getTenantId().equals(tenantId) && c.getKind() == kind && c.getName().equalsIgnoreCase(name));
    }
}
