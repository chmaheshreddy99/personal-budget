package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.InsurancePayment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;

@Repository
public class InsurancePaymentRepository extends TenantScopedRepository<InsurancePayment> {

    public InsurancePaymentRepository(TsvDataStore store) {
        super(store, InsurancePayment.class);
    }

    /** Latest first. */
    public List<InsurancePayment> findByPolicyId(Long policyId) {
        return findWhere(p -> p.getPolicyId().equals(policyId)).stream()
                .sorted(Comparator.comparing(InsurancePayment::getId).reversed())
                .toList();
    }
}
