package com.aditya.personalbudget.domain;

import com.aditya.personalbudget.storage.Identifiable;

/**
 * Marker for rows that belong to one tenant (household / family / organisation).
 * Every query for tenant data is filtered by {@code tenantId}, which isolates tenants from each other.
 */
public interface TenantOwned extends Identifiable {

    Long getTenantId();

    void setTenantId(Long tenantId);
}
