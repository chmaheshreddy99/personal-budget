package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Gift;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class GiftRepository extends TenantScopedRepository<Gift> {

    public GiftRepository(TsvDataStore store) {
        super(store, Gift.class);
    }
}
