package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.HostedChitMember;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class HostedChitMemberRepository extends TenantScopedRepository<HostedChitMember> {

    public HostedChitMemberRepository(TsvDataStore store) {
        super(store, HostedChitMember.class);
    }

    public List<HostedChitMember> findByChitId(Long chitId) {
        return findWhere(row -> chitId.equals(row.getChitId()));
    }
}
