package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionLoan;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionLoanRepository extends TenantScopedRepository<ConstructionLoan> {

    public ConstructionLoanRepository(TsvDataStore store) {
        super(store, ConstructionLoan.class);
    }

    public List<ConstructionLoan> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
