package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionLoanTxn;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionLoanTxnRepository extends TenantScopedRepository<ConstructionLoanTxn> {

    public ConstructionLoanTxnRepository(TsvDataStore store) {
        super(store, ConstructionLoanTxn.class);
    }

    public List<ConstructionLoanTxn> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
