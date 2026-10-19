package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Budget;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class BudgetRepository extends TenantScopedRepository<Budget> {

    public BudgetRepository(TsvDataStore store) {
        super(store, Budget.class);
    }

    public Optional<Budget> findByTenantIdAndCategoryId(Long tenantId, Long categoryId) {
        return findFirstWhere(b -> b.getTenantId().equals(tenantId) && b.getCategoryId().equals(categoryId));
    }

    public java.util.List<Budget> findByMonth(Long tenantId, String month) {
        return findWhere(b -> b.getTenantId().equals(tenantId) && month.equals(b.getMonth()));
    }

    public Optional<Budget> findOne(Long tenantId, Long categoryId, String month) {
        return findFirstWhere(b -> b.getTenantId().equals(tenantId) && b.getCategoryId().equals(categoryId)
                && month.equals(b.getMonth()));
    }
}
