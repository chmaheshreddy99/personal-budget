package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickPaySlip;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickPaySlipRepository extends TenantScopedRepository<BrickPaySlip> {

    public BrickPaySlipRepository(TsvDataStore store) {
        super(store, BrickPaySlip.class);
    }

    public List<BrickPaySlip> findByResourceId(Long resourceId) {
        return findWhere(x -> resourceId.equals(x.getResourceId()));
    }
}
