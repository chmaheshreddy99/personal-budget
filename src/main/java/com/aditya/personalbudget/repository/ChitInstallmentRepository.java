package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ChitInstallment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class ChitInstallmentRepository extends TenantScopedRepository<ChitInstallment> {

    public ChitInstallmentRepository(TsvDataStore store) {
        super(store, ChitInstallment.class);
    }

    public List<ChitInstallment> findByChitIdOrderByInstallmentNo(Long chitId) {
        return findWhere(i -> i.getChitId().equals(chitId)).stream()
                .sorted(Comparator.comparing(ChitInstallment::getInstallmentNo)).toList();
    }

    public Optional<ChitInstallment> findByJournalEntryId(Long journalEntryId) {
        return findFirstWhere(i -> journalEntryId.equals(i.getJournalEntryId()));
    }
}
