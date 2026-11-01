package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ChitShare;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class ChitShareRepository extends TenantScopedRepository<ChitShare> {

    public ChitShareRepository(TsvDataStore store) {
        super(store, ChitShare.class);
    }

    public Optional<ChitShare> findByTokenHash(String tokenHash) {
        return findFirstWhere(s -> s.getTokenHash().equals(tokenHash));
    }

    public List<ChitShare> findByChitId(Long chitId) {
        return findWhere(s -> s.getChitId().equals(chitId));
    }
}
