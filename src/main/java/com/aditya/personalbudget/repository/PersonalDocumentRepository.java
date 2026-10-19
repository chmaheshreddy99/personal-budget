package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.PersonalDocument;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class PersonalDocumentRepository extends TenantScopedRepository<PersonalDocument> {

    public PersonalDocumentRepository(TsvDataStore store) {
        super(store, PersonalDocument.class);
    }
}
