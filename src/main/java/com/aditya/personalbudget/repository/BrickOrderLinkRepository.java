package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickOrderLink;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public class BrickOrderLinkRepository extends TenantScopedRepository<BrickOrderLink> {

    public BrickOrderLinkRepository(TsvDataStore store) {
        super(store, BrickOrderLink.class);
    }

    public List<BrickOrderLink> findByOrderId(Long orderId) {
        return findWhere(x -> orderId.equals(x.getOrderId()));
    }

    public Optional<BrickOrderLink> findByTokenHash(String tokenHash) {
        return findFirstWhere(x -> tokenHash.equals(x.getTokenHash()));
    }
}
