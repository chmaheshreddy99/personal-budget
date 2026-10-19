package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitAgreement;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitAgreementRepository extends TenantScopedRepository<HostedChitAgreement> {

    public HostedChitAgreementRepository(TsvDataStore store) {
        super(store, HostedChitAgreement.class);
    }

    public List<HostedChitAgreement> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }
}
