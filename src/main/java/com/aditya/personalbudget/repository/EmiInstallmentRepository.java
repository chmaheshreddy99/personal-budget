package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.EmiInstallment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;

@Repository
public class EmiInstallmentRepository extends TenantScopedRepository<EmiInstallment> {

    public EmiInstallmentRepository(TsvDataStore store) {
        super(store, EmiInstallment.class);
    }

    /** A plan's instalments, first to last. */
    public List<EmiInstallment> findByPlanId(Long planId) {
        return findWhere(x -> planId.equals(x.getPlanId())).stream().sorted(Comparator.comparing(EmiInstallment::getSeq)).toList();
    }
}
