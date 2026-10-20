package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickAdvanceRecovery;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public class BrickAdvanceRecoveryRepository extends TenantScopedRepository<BrickAdvanceRecovery> {

    public BrickAdvanceRecoveryRepository(TsvDataStore store) {
        super(store, BrickAdvanceRecovery.class);
    }

    public List<BrickAdvanceRecovery> findBySlipId(Long slipId) {
        return findWhere(x -> slipId.equals(x.getSlipId()));
    }

    public List<BrickAdvanceRecovery> findByAdvanceId(Long advanceId) {
        return findWhere(x -> advanceId.equals(x.getAdvanceId()));
    }
}
