package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickPricingRate;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickPricingRateRepository extends TenantScopedRepository<BrickPricingRate> {

    public BrickPricingRateRepository(TsvDataStore store) {
        super(store, BrickPricingRate.class);
    }

    public List<BrickPricingRate> findByModelId(Long modelId) {
        return findWhere(x -> modelId.equals(x.getModelId()));
    }
}
