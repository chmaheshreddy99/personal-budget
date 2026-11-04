package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.InsurancePolicy;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class InsurancePolicyRepository extends TenantScopedRepository<InsurancePolicy> {

    public InsurancePolicyRepository(TsvDataStore store) {
        super(store, InsurancePolicy.class);
    }

    public Optional<InsurancePolicy> findByDocumentId(Long documentId) {
        return findWhere(p -> p.getDocumentId().equals(documentId)).stream().findFirst();
    }
}
