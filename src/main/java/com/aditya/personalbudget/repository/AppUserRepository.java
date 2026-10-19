package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public class AppUserRepository extends TenantScopedRepository<AppUser> {

    public AppUserRepository(TsvDataStore store) {
        super(store, AppUser.class);
    }

    public Optional<AppUser> findByUsername(String username) {
        return findFirstWhere(u -> u.getUsername().equalsIgnoreCase(username));
    }
}
