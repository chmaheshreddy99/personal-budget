package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ClaimRepayment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class ClaimRepaymentRepository extends TenantScopedRepository<ClaimRepayment> {

    public ClaimRepaymentRepository(TsvDataStore store) {
        super(store, ClaimRepayment.class);
    }

    /** Oldest first, ties broken by id. */
    public List<ClaimRepayment> findByClaimId(Long claimId) {
        return findWhere(r -> r.getClaimId().equals(claimId)).stream()
                .sorted(Comparator.comparing(ClaimRepayment::getPaidDate).thenComparing(ClaimRepayment::getId))
                .toList();
    }

    public Optional<ClaimRepayment> findByJournalEntryId(Long journalEntryId) {
        return findFirstWhere(r -> journalEntryId.equals(r.getJournalEntryId()));
    }
}
