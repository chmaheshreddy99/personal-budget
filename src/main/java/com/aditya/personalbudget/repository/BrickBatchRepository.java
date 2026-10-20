package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickBatch;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickBatchRepository extends TenantScopedRepository<BrickBatch> {

    public BrickBatchRepository(TsvDataStore store) {
        super(store, BrickBatch.class);
    }
}
