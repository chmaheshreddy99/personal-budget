package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.EmiCardAllocation;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class EmiCardAllocationRepository extends TenantScopedRepository<EmiCardAllocation> {

    public EmiCardAllocationRepository(TsvDataStore store) {
        super(store, EmiCardAllocation.class);
    }

    public List<EmiCardAllocation> findByInstallmentId(Long installmentId) {
        return findWhere(a -> a.getInstallmentId().equals(installmentId));
    }

    public List<EmiCardAllocation> findByPaymentEntryId(Long paymentEntryId) {
        return findWhere(a -> a.getPaymentEntryId().equals(paymentEntryId));
    }
}
