package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionStage;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionStageRepository extends TenantScopedRepository<ConstructionStage> {

    public ConstructionStageRepository(TsvDataStore store) {
        super(store, ConstructionStage.class);
    }

    public List<ConstructionStage> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
