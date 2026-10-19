package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitMonth;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitMonthRepository extends TenantScopedRepository<HostedChitMonth> {

    public HostedChitMonthRepository(TsvDataStore store) {
        super(store, HostedChitMonth.class);
    }

    public List<HostedChitMonth> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }
}
