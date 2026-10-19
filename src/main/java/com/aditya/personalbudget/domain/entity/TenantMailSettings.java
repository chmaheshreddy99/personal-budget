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

import java.time.LocalDateTime;

/**
 * A household's own e-mail (SMTP) account, used to send Host a Chit reminders and receipts from the household's
 * address. The password is kept encrypted (AES-GCM, key in {@code data/app-settings.properties}) and never sent back
 * to the browser. Table file: {@code data/organization_mail_settings.tbl}
 */
@Entity
@Table(name = "organization_mail_settings", uniqueConstraints = @UniqueConstraint(columnNames = {"organizationId"}))
@Getter
@Setter
@NoArgsConstructor
public class TenantMailSettings implements TenantOwned {

    public static final String STARTTLS = "STARTTLS";
    public static final String SSL = "SSL";
    public static final String NONE = "NONE";

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** Off: the installation's e-mail settings (application.yml) are used, if any. */
    private Boolean enabled;

    @Column(nullable = false, length = 120)
    private String host;

    @Column(nullable = false)
    private Integer port;

    /** STARTTLS, SSL or NONE. */
    @Column(nullable = false, length = 10)
    private String security;

    @Column(length = 120)
    private String username;

    /** Encrypted: base64 of IV + AES-GCM cipher text. */
    @Column(length = 500)
    private String passwordEnc;

    @Column(nullable = false, length = 120)
    private String fromAddress;

    @Column(length = 100)
    private String fromName;

    @Column(length = 120)
    private String replyTo;

    @Column(length = 50)
    private String updatedBy;

    private LocalDateTime updatedAt;

    /** When the last test e-mail went out, and whether it worked (the error when not). */
    private LocalDateTime testedAt;

    @Column(length = 255)
    private String testResult;

    @Version
    private Long version;
}
