package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * What every statement of an organization follows unless it says otherwise: whether the PDFs are locked and the common
 * password that opens them (kept encrypted, never sent back to the browser). Table file: {@code data/statement_settings.tbl}
 */
@Entity
@Table(name = "statement_settings", uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId"}))
@Getter
@Setter
@NoArgsConstructor
public class StatementSettings implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** Lock the PDF of every statement that follows this setting. */
    private Boolean protectionEnabled;

    /** The common password, encrypted: base64 of IV + AES-GCM cipher text. */
    @Column(length = 300)
    private String passwordEnc;

    @Version
    private Long version;
}
