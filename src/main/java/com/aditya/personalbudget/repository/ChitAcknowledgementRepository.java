package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ChitAcknowledgement;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class ChitAcknowledgementRepository extends TenantScopedRepository<ChitAcknowledgement> {

    public ChitAcknowledgementRepository(TsvDataStore store) {
        super(store, ChitAcknowledgement.class);
    }

    /** The chit's acknowledgements, oldest first. */
    public List<ChitAcknowledgement> findByChitId(Long tenantId, Long chitId) {
        return findWhere(a -> a.getTenantId().equals(tenantId) && a.getChitId().equals(chitId)).stream()
                .sorted(Comparator.comparing(ChitAcknowledgement::getId)).toList();
    }

    public Optional<ChitAcknowledgement> findByTokenHash(String tokenHash) {
        return findFirstWhere(a -> tokenHash.equals(a.getTokenHash()));
    }
}
