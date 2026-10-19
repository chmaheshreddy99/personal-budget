package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.EmiPlan;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class EmiPlanRepository extends TenantScopedRepository<EmiPlan> {

    public EmiPlanRepository(TsvDataStore store) {
        super(store, EmiPlan.class);
    }
}
