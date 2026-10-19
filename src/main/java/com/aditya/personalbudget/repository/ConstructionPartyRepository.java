package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ConstructionParty;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class ConstructionPartyRepository extends TenantScopedRepository<ConstructionParty> {

    public ConstructionPartyRepository(TsvDataStore store) {
        super(store, ConstructionParty.class);
    }

    public List<ConstructionParty> findByProjectId(Long projectId) {
        return findWhere(x -> projectId.equals(x.getProjectId()));
    }
}
