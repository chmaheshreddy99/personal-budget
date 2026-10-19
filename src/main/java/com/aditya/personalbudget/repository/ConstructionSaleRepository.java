package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionSaleRepository extends TenantScopedRepository<ConstructionSale> {

    public ConstructionSaleRepository(TsvDataStore store) {
        super(store, ConstructionSale.class);
    }

    public List<ConstructionSale> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
