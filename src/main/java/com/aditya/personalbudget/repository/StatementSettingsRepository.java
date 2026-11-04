package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.StatementSettings;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class StatementSettingsRepository extends TenantScopedRepository<StatementSettings> {

    public StatementSettingsRepository(TsvDataStore store) {
        super(store, StatementSettings.class);
    }

    public Optional<StatementSettings> findForTenant(Long tenantId) {
        return findFirstWhere(row -> tenantId.equals(row.getTenantId()));
    }
}
