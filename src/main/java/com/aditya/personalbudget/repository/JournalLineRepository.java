package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;

@Repository
public class JournalLineRepository extends TenantScopedRepository<JournalLine> {

    public JournalLineRepository(TsvDataStore store) {
        super(store, JournalLine.class);
    }

    public List<JournalLine> findByJournalEntryId(Long journalEntryId) {
        return findWhere(l -> l.getJournalEntryId().equals(journalEntryId)).stream()
                .sorted(Comparator.comparing(JournalLine::getLineNo)).toList();
    }

    public List<JournalLine> findByJournalEntryIdIn(Collection<Long> journalEntryIds) {
        return findWhere(l -> journalEntryIds.contains(l.getJournalEntryId()));
    }

    public List<JournalLine> findByAccountId(Long accountId) {
        return findWhere(l -> l.getAccountId().equals(accountId));
    }

    public boolean existsByAccountId(Long accountId) {
        return countWhere(l -> l.getAccountId().equals(accountId)) > 0;
    }
}
