package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.StatementSubscription;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class StatementSubscriptionRepository extends TenantScopedRepository<StatementSubscription> {

    public StatementSubscriptionRepository(TsvDataStore store) {
        super(store, StatementSubscription.class);
    }
}
