package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickBatchMaterial;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickBatchMaterialRepository extends TenantScopedRepository<BrickBatchMaterial> {

    public BrickBatchMaterialRepository(TsvDataStore store) {
        super(store, BrickBatchMaterial.class);
    }

    public List<BrickBatchMaterial> findByBatchId(Long batchId) {
        return findWhere(x -> batchId.equals(x.getBatchId()));
    }
}
