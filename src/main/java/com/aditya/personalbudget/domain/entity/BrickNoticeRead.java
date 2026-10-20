package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * A notice a user has seen (opened what it is about, or cleared it): it no longer shows for them.
 * Table file: {@code data/brick_notice_reads.tbl}
 */
@Entity
@Table(name = "brick_notice_reads")
@Getter
@Setter
@NoArgsConstructor
public class BrickNoticeRead implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private Long noticeId;

    @Column(nullable = false)
    private Long userId;

    private LocalDateTime readAt;
}
