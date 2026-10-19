package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionInstalment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionInstalmentRepository extends TenantScopedRepository<ConstructionInstalment> {

    public ConstructionInstalmentRepository(TsvDataStore store) {
        super(store, ConstructionInstalment.class);
    }

    public List<ConstructionInstalment> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
