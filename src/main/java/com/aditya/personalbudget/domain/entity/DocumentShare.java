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
 * A temporary link to one document's scans, for someone who asked for it (a bank, an office, a relative). Anyone
 * with the link can see the scans until it expires or is revoked; downloading can be switched off. Only a hash of the
 * token is kept. Table file: {@code data/document_shares.tbl}
 */
@Entity
@Table(name = "document_shares")
@Getter
@Setter
@NoArgsConstructor
public class DocumentShare implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @References(PersonalDocument.class)
    @Column(nullable = false)
    private Long documentId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    /** Who it was sent to: "HDFC home loan desk", "Ravi". */
    @Column(length = 80)
    private String sharedWith;

    @Column(nullable = false)
    private Boolean allowDownload;

    @Column(nullable = false, length = 100)
    private String createdByName;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    private LocalDateTime revokedAt;

    private Integer views;

    private LocalDateTime lastViewedAt;

    public boolean isActive(LocalDateTime now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }
}
