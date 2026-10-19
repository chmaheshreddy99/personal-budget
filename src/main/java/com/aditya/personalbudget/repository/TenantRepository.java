package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.storage.TsvDataStore;
import com.aditya.personalbudget.storage.TsvRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class TenantRepository extends TsvRepository<Tenant> {

    public TenantRepository(TsvDataStore store) {
        super(store, Tenant.class);
    }

    public Optional<Tenant> findByCode(String code) {
        return findFirstWhere(t -> t.getCode().equalsIgnoreCase(code));
    }
}
