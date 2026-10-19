package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.TsvDataStore;
import com.aditya.personalbudget.storage.TsvRepository;

import java.util.List;
import java.util.Optional;

/**
 * Repository base for tenant-owned tables. Adds the two finders every service needs
 * to stay inside the current tenant.
 */
public abstract class TenantScopedRepository<T extends TenantOwned> extends TsvRepository<T> {

    protected TenantScopedRepository(TsvDataStore store, Class<T> type) {
        super(store, type);
    }

    public List<T> findByTenantId(Long tenantId) {
        return findWhere(row -> tenantId.equals(row.getTenantId()));
    }

    public Optional<T> findByIdAndTenantId(Long id, Long tenantId) {
        return findById(id).filter(row -> tenantId.equals(row.getTenantId()));
    }
}
