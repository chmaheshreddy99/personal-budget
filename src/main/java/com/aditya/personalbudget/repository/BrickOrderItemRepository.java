package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickOrderItem;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickOrderItemRepository extends TenantScopedRepository<BrickOrderItem> {

    public BrickOrderItemRepository(TsvDataStore store) {
        super(store, BrickOrderItem.class);
    }

    public List<BrickOrderItem> findByOrderId(Long orderId) {
        return findWhere(x -> orderId.equals(x.getOrderId()));
    }
}
