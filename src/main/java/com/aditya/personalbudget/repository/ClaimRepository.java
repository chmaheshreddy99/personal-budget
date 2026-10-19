package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class ClaimRepository extends TenantScopedRepository<Claim> {

    public ClaimRepository(TsvDataStore store) {
        super(store, Claim.class);
    }

    public Optional<Claim> findByJournalEntryId(Long journalEntryId) {
        return findFirstWhere(c -> journalEntryId.equals(c.getJournalEntryId()));
    }
}
