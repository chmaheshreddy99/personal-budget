package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ClaimInterestPosting;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class ClaimInterestPostingRepository extends TenantScopedRepository<ClaimInterestPosting> {

    public ClaimInterestPostingRepository(TsvDataStore store) {
        super(store, ClaimInterestPosting.class);
    }

    /** In schedule order. */
    public List<ClaimInterestPosting> findByClaimId(Long claimId) {
        return findWhere(p -> p.getClaimId().equals(claimId)).stream()
                .sorted(Comparator.comparing(ClaimInterestPosting::getPeriodNo))
                .toList();
    }

    public Optional<ClaimInterestPosting> findByJournalEntryId(Long journalEntryId) {
        return findFirstWhere(p -> journalEntryId.equals(p.getJournalEntryId()));
    }
}
