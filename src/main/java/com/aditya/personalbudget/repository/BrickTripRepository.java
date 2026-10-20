package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickTrip;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickTripRepository extends TenantScopedRepository<BrickTrip> {

    public BrickTripRepository(TsvDataStore store) {
        super(store, BrickTrip.class);
    }

    public List<BrickTrip> findByOrderId(Long orderId) {
        return findWhere(x -> orderId.equals(x.getOrderId()));
    }
}
