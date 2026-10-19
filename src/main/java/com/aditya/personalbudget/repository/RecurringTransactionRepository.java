package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.RecurringTransaction;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class RecurringTransactionRepository extends TenantScopedRepository<RecurringTransaction> {

    public RecurringTransactionRepository(TsvDataStore store) {
        super(store, RecurringTransaction.class);
    }

    public List<RecurringTransaction> findByTenantIdAndActiveTrue(Long tenantId) {
        return findWhere(r -> r.getTenantId().equals(tenantId) && Boolean.TRUE.equals(r.getActive()));
    }
}
