package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * An expense the phone app recorded (offline, with its own id) and has synced: kept for good, so the same expense
 * sent again (the app lost the answer, a retry days later) is recognised and not booked twice.
 * Table file: {@code data/app_sync_keys.tbl}
 */
@Entity
@Table(name = "app_sync_keys", uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId", "clientId"}))
@Getter
@Setter
@NoArgsConstructor
public class AppSyncKey implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The id the app gave the expense when it was recorded on the phone. */
    @Column(nullable = false, length = 64)
    private String clientId;

    /** The journal entry it became (or the entry waiting for approval: pendingId). */
    private Long entryId;

    private Long pendingId;

    @Column(length = 20)
    private String entryNo;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
