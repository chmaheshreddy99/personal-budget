package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.AccountLog;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;

@Repository
public class AccountLogRepository extends TenantScopedRepository<AccountLog> {

    public AccountLogRepository(TsvDataStore store) {
        super(store, AccountLog.class);
    }

    /** One account's history, newest first. */
    public List<AccountLog> findByAccountId(Long tenantId, Long accountId) {
        return findWhere(l -> l.getTenantId().equals(tenantId) && l.getAccountId().equals(accountId)).stream()
                .sorted(Comparator.comparing(AccountLog::getId).reversed()).toList();
    }
}
