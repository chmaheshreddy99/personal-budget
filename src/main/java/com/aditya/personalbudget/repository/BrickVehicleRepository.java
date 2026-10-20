package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickVehicle;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickVehicleRepository extends TenantScopedRepository<BrickVehicle> {

    public BrickVehicleRepository(TsvDataStore store) {
        super(store, BrickVehicle.class);
    }
}
