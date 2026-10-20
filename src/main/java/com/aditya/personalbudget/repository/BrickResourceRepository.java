package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickResourceRepository extends TenantScopedRepository<BrickResource> {

    public BrickResourceRepository(TsvDataStore store) {
        super(store, BrickResource.class);
    }
}
