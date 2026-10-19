package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.DocumentShare;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class DocumentShareRepository extends TenantScopedRepository<DocumentShare> {

    public DocumentShareRepository(TsvDataStore store) {
        super(store, DocumentShare.class);
    }

    public java.util.Optional<DocumentShare> findByTokenHash(String tokenHash) {
        return findFirstWhere(s -> s.getTokenHash().equals(tokenHash));
    }

    public java.util.List<DocumentShare> findByDocumentId(Long documentId) {
        return findWhere(s -> s.getDocumentId().equals(documentId));
    }
}
