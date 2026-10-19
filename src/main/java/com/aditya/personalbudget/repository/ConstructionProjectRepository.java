package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class ConstructionProjectRepository extends TenantScopedRepository<ConstructionProject> {

    public ConstructionProjectRepository(TsvDataStore store) {
        super(store, ConstructionProject.class);
    }
}
