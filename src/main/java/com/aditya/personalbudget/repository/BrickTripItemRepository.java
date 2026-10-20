package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickTripItem;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickTripItemRepository extends TenantScopedRepository<BrickTripItem> {

    public BrickTripItemRepository(TsvDataStore store) {
        super(store, BrickTripItem.class);
    }

    public List<BrickTripItem> findByTripId(Long tripId) {
        return findWhere(x -> tripId.equals(x.getTripId()));
    }
}
