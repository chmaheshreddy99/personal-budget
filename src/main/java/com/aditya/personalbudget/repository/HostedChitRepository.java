package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;


@Repository
public class HostedChitRepository extends TenantScopedRepository<HostedChit> {

    public HostedChitRepository(TsvDataStore store) {
        super(store, HostedChit.class);
    }
}
