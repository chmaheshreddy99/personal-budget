package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickMaterialPurchase;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickMaterialPurchaseRepository extends TenantScopedRepository<BrickMaterialPurchase> {

    public BrickMaterialPurchaseRepository(TsvDataStore store) {
        super(store, BrickMaterialPurchase.class);
    }
}
