package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickOrderRepository extends TenantScopedRepository<BrickOrder> {

    public BrickOrderRepository(TsvDataStore store) {
        super(store, BrickOrder.class);
    }
}
