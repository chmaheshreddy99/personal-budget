package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Repository
public class AccountRepository extends TenantScopedRepository<Account> {

    public AccountRepository(TsvDataStore store) {
        super(store, Account.class);
    }

    public List<Account> findByTenantIdOrderByCode(Long tenantId) {
        return findByTenantId(tenantId).stream().sorted(Comparator.comparing(Account::getCode)).toList();
    }

    public List<Account> findByTenantIdAndAccountClass(Long tenantId, AccountClass accountClass) {
        return findWhere(a -> a.getTenantId().equals(tenantId) && a.getAccountClass() == accountClass);
    }

    public Optional<Account> findByTenantIdAndCode(Long tenantId, String code) {
        return findFirstWhere(a -> a.getTenantId().equals(tenantId) && a.getCode().equalsIgnoreCase(code));
    }

    public Optional<Account> findFirstByTenantIdAndAccountType(Long tenantId, AccountType type) {
        return findWhere(a -> a.getTenantId().equals(tenantId) && a.getAccountType() == type).stream()
                .min(Comparator.comparing(Account::getCode));
    }
}
