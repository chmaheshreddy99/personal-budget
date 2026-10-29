package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.DeviceKey;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class DeviceKeyRepository extends TenantScopedRepository<DeviceKey> {

    public DeviceKeyRepository(TsvDataStore store) {
        super(store, DeviceKey.class);
    }

    public List<DeviceKey> findByUserId(Long userId) {
        return findWhere(k -> k.getUserId().equals(userId));
    }
}
