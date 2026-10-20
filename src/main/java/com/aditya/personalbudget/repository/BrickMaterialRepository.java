package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickMaterialRepository extends TenantScopedRepository<BrickMaterial> {

    public BrickMaterialRepository(TsvDataStore store) {
        super(store, BrickMaterial.class);
    }
}
