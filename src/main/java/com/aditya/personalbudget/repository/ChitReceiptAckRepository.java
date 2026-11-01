package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.ChitReceiptAck;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class ChitReceiptAckRepository extends TenantScopedRepository<ChitReceiptAck> {

    public ChitReceiptAckRepository(TsvDataStore store) {
        super(store, ChitReceiptAck.class);
    }

    public List<ChitReceiptAck> findByChitId(Long chitId) {
        return findWhere(a -> a.getChitId().equals(chitId));
    }

    /** Records with this number, in every organization (numbers repeat across organizations). */
    public List<ChitReceiptAck> findByAckNo(String ackNo) {
        return findWhere(a -> ackNo.equals(a.getAckNo()));
    }

    public Optional<ChitReceiptAck> findByTokenHash(String tokenHash) {
        return findFirstWhere(a -> tokenHash.equals(a.getTokenHash()));
    }
}
