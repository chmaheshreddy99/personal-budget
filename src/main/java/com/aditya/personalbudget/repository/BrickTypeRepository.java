package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickType;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickTypeRepository extends TenantScopedRepository<BrickType> {

    public BrickTypeRepository(TsvDataStore store) {
        super(store, BrickType.class);
    }
}
