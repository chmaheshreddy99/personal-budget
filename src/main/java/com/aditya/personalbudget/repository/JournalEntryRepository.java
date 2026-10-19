package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

@Repository
public class JournalEntryRepository extends TenantScopedRepository<JournalEntry> {

    /** Newest first, ties broken by id. */
    public static final Comparator<JournalEntry> NEWEST_FIRST = Comparator
            .comparing(JournalEntry::getEntryDate).thenComparing(JournalEntry::getId).reversed();

    public JournalEntryRepository(TsvDataStore store) {
        super(store, JournalEntry.class);
    }

    public List<JournalEntry> findByTenantIdAndEntryDateBetween(Long tenantId, LocalDate from, LocalDate to) {
        return findWhere(e -> e.getTenantId().equals(tenantId)
                && !e.getEntryDate().isBefore(from) && !e.getEntryDate().isAfter(to));
    }

    public List<JournalEntry> findBySource(Long tenantId, String sourceType, Long sourceId) {
        return findWhere(e -> e.getTenantId().equals(tenantId)
                && sourceType.equals(e.getSourceType()) && sourceId.equals(e.getSourceId()));
    }

    public long countByTenantId(Long tenantId) {
        return countWhere(e -> e.getTenantId().equals(tenantId));
    }
}
