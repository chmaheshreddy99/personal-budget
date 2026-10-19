package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.AppSyncKey;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class AppSyncKeyRepository extends TenantScopedRepository<AppSyncKey> {

    public AppSyncKeyRepository(TsvDataStore store) {
        super(store, AppSyncKey.class);
    }

    public Optional<AppSyncKey> findByClientId(Long tenantId, String clientId) {
        return findWhere(x -> tenantId.equals(x.getTenantId()) && clientId.equals(x.getClientId())).stream().findFirst();
    }
}
