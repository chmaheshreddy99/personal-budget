package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionUnit;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionUnitRepository extends TenantScopedRepository<ConstructionUnit> {

    public ConstructionUnitRepository(TsvDataStore store) {
        super(store, ConstructionUnit.class);
    }

    public List<ConstructionUnit> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
