package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ClaimShare;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class ClaimShareRepository extends TenantScopedRepository<ClaimShare> {

    public ClaimShareRepository(TsvDataStore store) {
        super(store, ClaimShare.class);
    }

    public Optional<ClaimShare> findByTokenHash(String tokenHash) {
        return findFirstWhere(s -> s.getTokenHash().equals(tokenHash));
    }

    public List<ClaimShare> findByClaimId(Long claimId) {
        return findWhere(s -> s.getClaimId().equals(claimId));
    }
}
