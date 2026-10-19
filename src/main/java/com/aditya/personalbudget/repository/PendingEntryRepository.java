package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class PendingEntryRepository extends TenantScopedRepository<PendingEntry> {

    public PendingEntryRepository(TsvDataStore store) {
        super(store, PendingEntry.class);
    }
}
