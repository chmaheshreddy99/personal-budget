package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionAgreement;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionAgreementRepository extends TenantScopedRepository<ConstructionAgreement> {

    public ConstructionAgreementRepository(TsvDataStore store) {
        super(store, ConstructionAgreement.class);
    }

    public List<ConstructionAgreement> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }

    public java.util.Optional<ConstructionAgreement> findByTokenHash(String tokenHash) {
        return findFirstWhere(a -> tokenHash.equals(a.getTokenHash()));
    }
}
