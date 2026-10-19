package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.storage.TsvDataStore;
import com.aditya.personalbudget.storage.TsvRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class OrganizationRepository extends TsvRepository<Organization> {

    public OrganizationRepository(TsvDataStore store) {
        super(store, Organization.class);
    }

    public Optional<Organization> findByCode(String code) {
        return findFirstWhere(t -> t.getCode().equalsIgnoreCase(code));
    }
}
