package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionCost;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionCostRepository extends TenantScopedRepository<ConstructionCost> {

    public ConstructionCostRepository(TsvDataStore store) {
        super(store, ConstructionCost.class);
    }

    public List<ConstructionCost> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
