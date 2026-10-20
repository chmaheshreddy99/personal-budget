package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickNotice;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickNoticeRepository extends TenantScopedRepository<BrickNotice> {

    public BrickNoticeRepository(TsvDataStore store) {
        super(store, BrickNotice.class);
    }
}
