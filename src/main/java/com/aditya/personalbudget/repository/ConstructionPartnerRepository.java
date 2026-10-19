package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionPartner;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionPartnerRepository extends TenantScopedRepository<ConstructionPartner> {

    public ConstructionPartnerRepository(TsvDataStore store) {
        super(store, ConstructionPartner.class);
    }

    public List<ConstructionPartner> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
