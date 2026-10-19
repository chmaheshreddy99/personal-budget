package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.AccessLink;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class AccessLinkRepository extends TenantScopedRepository<AccessLink> {

    public AccessLinkRepository(TsvDataStore store) {
        super(store, AccessLink.class);
    }

    public java.util.Optional<AccessLink> findByTokenHash(String tokenHash) {
        return findFirstWhere(l -> l.getTokenHash().equals(tokenHash));
    }
}
