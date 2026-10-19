package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ClaimAgreement;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class ClaimAgreementRepository extends TenantScopedRepository<ClaimAgreement> {

    public ClaimAgreementRepository(TsvDataStore store) {
        super(store, ClaimAgreement.class);
    }

    public List<ClaimAgreement> findByClaimId(Long claimId) {
        return findWhere(a -> a.getClaimId().equals(claimId));
    }

    public Optional<ClaimAgreement> findByTokenHash(String tokenHash) {
        return findFirstWhere(a -> tokenHash.equals(a.getTokenHash()));
    }
}
