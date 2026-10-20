package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickBatchItem;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickBatchItemRepository extends TenantScopedRepository<BrickBatchItem> {

    public BrickBatchItemRepository(TsvDataStore store) {
        super(store, BrickBatchItem.class);
    }

    public List<BrickBatchItem> findByBatchId(Long batchId) {
        return findWhere(x -> batchId.equals(x.getBatchId()));
    }
}
