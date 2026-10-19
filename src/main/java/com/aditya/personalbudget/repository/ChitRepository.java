package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class ChitRepository extends TenantScopedRepository<Chit> {

    public ChitRepository(TsvDataStore store) {
        super(store, Chit.class);
    }

    public Optional<Chit> findByAccountId(Long accountId) {
        return findFirstWhere(c -> c.getAccountId().equals(accountId));
    }
}
