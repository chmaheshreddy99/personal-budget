package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.BankInterestPosting;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;

@Repository
public class BankInterestPostingRepository extends TenantScopedRepository<BankInterestPosting> {

    public BankInterestPostingRepository(TsvDataStore store) {
        super(store, BankInterestPosting.class);
    }

    /** Oldest first. */
    public List<BankInterestPosting> findByAccountId(Long accountId) {
        return findWhere(p -> p.getAccountId().equals(accountId)).stream()
                .sorted(Comparator.comparing(BankInterestPosting::getPeriodFrom))
                .toList();
    }
}
