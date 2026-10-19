package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ActivityEntry;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class ActivityEntryRepository extends TenantScopedRepository<ActivityEntry> {

    public ActivityEntryRepository(TsvDataStore store) {
        super(store, ActivityEntry.class);
    }
}
