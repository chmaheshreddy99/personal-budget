package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickNoticeRead;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class BrickNoticeReadRepository extends TenantScopedRepository<BrickNoticeRead> {

    public BrickNoticeReadRepository(TsvDataStore store) {
        super(store, BrickNoticeRead.class);
    }

    public List<BrickNoticeRead> findByUser(Long tenantId, Long userId) {
        return findWhere(x -> tenantId.equals(x.getTenantId()) && userId.equals(x.getUserId()));
    }
}
