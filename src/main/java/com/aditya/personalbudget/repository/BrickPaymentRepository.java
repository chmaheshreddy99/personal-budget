package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickPayment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickPaymentRepository extends TenantScopedRepository<BrickPayment> {

    public BrickPaymentRepository(TsvDataStore store) {
        super(store, BrickPayment.class);
    }

    public List<BrickPayment> findByOrderId(Long orderId) {
        return findWhere(x -> orderId.equals(x.getOrderId()));
    }
}
