package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Attachment;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Repository
public class AttachmentRepository extends TenantScopedRepository<Attachment> {

    public AttachmentRepository(TsvDataStore store) {
        super(store, Attachment.class);
    }

    /** Oldest first, as they were added. */
    public List<Attachment> findByJournalEntryId(Long journalEntryId) {
        return findWhere(a -> journalEntryId.equals(a.getJournalEntryId())).stream()
                .sorted(Comparator.comparing(Attachment::getId))
                .toList();
    }

    /** Photos of a gift or scans of a document: owner "gift" or "document". */
    public List<Attachment> findByOwner(String owner, Long id) {
        return findWhere(a -> id.equals("gift".equals(owner) ? a.getGiftId() : a.getDocumentId())).stream()
                .sorted(Comparator.comparing(Attachment::getId))
                .toList();
    }

    /** Evidence sent with an entry that waits for approval. */
    public List<Attachment> findByPendingEntryId(Long pendingEntryId) {
        return findWhere(a -> pendingEntryId.equals(a.getPendingEntryId())).stream()
                .sorted(Comparator.comparing(Attachment::getId))
                .toList();
    }

    /** How many attachments each entry has (entries without any are left out). */
    public Map<Long, Integer> countsByEntry(Long tenantId) {
        return findByTenantId(tenantId).stream()
                .filter(a -> a.getJournalEntryId() != null)
                .collect(Collectors.groupingBy(Attachment::getJournalEntryId, Collectors.summingInt(a -> 1)));
    }
}
