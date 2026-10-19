package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitPaymentRepository extends TenantScopedRepository<HostedChitPayment> {

    public HostedChitPaymentRepository(TsvDataStore store) {
        super(store, HostedChitPayment.class);
    }

    public List<HostedChitPayment> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }
}
