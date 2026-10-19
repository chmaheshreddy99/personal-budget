package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitTransfer;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitTransferRepository extends TenantScopedRepository<HostedChitTransfer> {

    public HostedChitTransferRepository(TsvDataStore store) {
        super(store, HostedChitTransfer.class);
    }

    public List<HostedChitTransfer> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }
}
