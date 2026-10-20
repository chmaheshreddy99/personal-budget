package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickPricingModel;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickPricingModelRepository extends TenantScopedRepository<BrickPricingModel> {

    public BrickPricingModelRepository(TsvDataStore store) {
        super(store, BrickPricingModel.class);
    }
}
