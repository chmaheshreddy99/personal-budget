package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BrickExpense;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

@Repository
public class BrickExpenseRepository extends TenantScopedRepository<BrickExpense> {

    public BrickExpenseRepository(TsvDataStore store) {
        super(store, BrickExpense.class);
    }
}
