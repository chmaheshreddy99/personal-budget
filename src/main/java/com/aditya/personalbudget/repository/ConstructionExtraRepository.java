package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionExtra;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionExtraRepository extends TenantScopedRepository<ConstructionExtra> {

    public ConstructionExtraRepository(TsvDataStore store) {
        super(store, ConstructionExtra.class);
    }

    public List<ConstructionExtra> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
