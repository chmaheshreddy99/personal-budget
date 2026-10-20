package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickSettings;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickSettingsRepository extends TenantScopedRepository<BrickSettings> {

    public BrickSettingsRepository(TsvDataStore store) {
        super(store, BrickSettings.class);
    }
}
