package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.storage.Identifiable;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * A tenant is an isolated book of accounts: a household, a family, or a small organisation.
 * Table file: {@code data/tenants.tbl}
 */
@Entity
@Table(name = "tenants")
@Getter
@Setter
@NoArgsConstructor
public class Tenant implements Identifiable {

    @Id
    @GeneratedValue
    private Long id;

    /** Short unique code used at login, e.g. "aditya-home". */
    @Column(nullable = false, unique = true, length = 30)
    @Pattern(regexp = "[a-z0-9][a-z0-9-]{1,29}", message = "must be 2-30 lowercase letters, digits or hyphens")
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    /** ISO 4217 currency code used for display. */
    @Column(nullable = false, length = 3)
    @Pattern(regexp = "[A-Z]{3}", message = "must be a 3-letter currency code")
    private String currency;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    /**
     * Maker-checker for the whole household: {@code OFF} (nothing waits for approval, not even access links),
     * {@code LINKS} (only access links made with approval; the default when empty) or {@code ALL} (also every
     * user who cannot approve, unless the user is exempted).
     */
    @Column(length = 10)
    private String approvalMode;

    /** Optimistic locking: a save based on an older version is rejected. */
    @jakarta.persistence.Version
    private Long version;
}
