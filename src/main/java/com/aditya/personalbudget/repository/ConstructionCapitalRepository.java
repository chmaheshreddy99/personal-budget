package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionCapitalRepository extends TenantScopedRepository<ConstructionCapital> {

    public ConstructionCapitalRepository(TsvDataStore store) {
        super(store, ConstructionCapital.class);
    }

    public List<ConstructionCapital> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
