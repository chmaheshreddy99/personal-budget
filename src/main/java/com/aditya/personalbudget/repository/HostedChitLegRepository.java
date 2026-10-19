package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitLeg;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitLegRepository extends TenantScopedRepository<HostedChitLeg> {

    public HostedChitLegRepository(TsvDataStore store) {
        super(store, HostedChitLeg.class);
    }

    public List<HostedChitLeg> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }

    public List<HostedChitLeg> findByMonthId(Long monthId) {
        return findWhere(row -> monthId.equals(row.getMonthId()));
    }

    public List<HostedChitLeg> findByAccountId(Long accountId) {
        return findWhere(row -> accountId.equals(row.getAccountId()));
    }

    public List<HostedChitLeg> findByTransferId(Long transferId) {
        return findWhere(row -> transferId.equals(row.getTransferId()));
    }
}
