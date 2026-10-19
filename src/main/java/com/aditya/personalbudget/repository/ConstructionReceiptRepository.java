package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionReceipt;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionReceiptRepository extends TenantScopedRepository<ConstructionReceipt> {

    public ConstructionReceiptRepository(TsvDataStore store) {
        super(store, ConstructionReceipt.class);
    }

    public List<ConstructionReceipt> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
