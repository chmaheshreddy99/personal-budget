package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitShare;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class HostedChitShareRepository extends TenantScopedRepository<HostedChitShare> {

    public HostedChitShareRepository(TsvDataStore store) {
        super(store, HostedChitShare.class);
    }

    public List<HostedChitShare> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }

    public Optional<HostedChitShare> findByTokenHash(String tokenHash) {
        return findFirstWhere(row -> tokenHash.equals(row.getTokenHash()));
    }
}
