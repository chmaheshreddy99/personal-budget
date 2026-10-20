package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickEarning;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickEarningRepository extends TenantScopedRepository<BrickEarning> {

    public BrickEarningRepository(TsvDataStore store) {
        super(store, BrickEarning.class);
    }

    public List<BrickEarning> findByResourceId(Long resourceId) {
        return findWhere(x -> resourceId.equals(x.getResourceId()));
    }

    public List<BrickEarning> findBySlipId(Long slipId) {
        return findWhere(x -> slipId.equals(x.getSlipId()));
    }
}
