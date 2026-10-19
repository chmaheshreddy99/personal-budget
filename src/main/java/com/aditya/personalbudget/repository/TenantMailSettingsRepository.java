package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.TenantMailSettings;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class TenantMailSettingsRepository extends TenantScopedRepository<TenantMailSettings> {

    public TenantMailSettingsRepository(TsvDataStore store) {
        super(store, TenantMailSettings.class);
    }

    public Optional<TenantMailSettings> findForTenant(Long tenantId) {
        return findFirstWhere(row -> tenantId.equals(row.getTenantId()));
    }
}
