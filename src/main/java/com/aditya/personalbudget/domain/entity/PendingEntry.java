package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Maker-checker: something recorded through an access link (or by a user who needs approval) that waits for a checker.
 * {@code payload} is the original request (JSON); approving posts it (with any corrections the checker made),
 * rejecting keeps it out of the books with a reason, and the maker may correct it and send it again. Table file: {@code data/pending_entries.tbl}
 */
@Entity
@Table(name = "pending_entries")
@Getter
@Setter
@NoArgsConstructor
public class PendingEntry implements TenantOwned {

    public static final String PENDING = "PENDING";
    public static final String APPROVED = "APPROVED";
    public static final String REJECTED = "REJECTED";
    /** The maker took it back (only while it waited or after a rejection). */
    public static final String WITHDRAWN = "WITHDRAWN";

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** What it would post: EXPENSE. */
    @Column(nullable = false, length = 20)
    private String kind;

    @Column(nullable = false, length = 2000)
    private String payload;

    @Column(nullable = false, length = 255)
    private String summary;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate entryDate;

    @References(AccessLink.class)
    private Long linkId;

    @Column(nullable = false, length = 100)
    private String submittedBy;

    @Column(nullable = false)
    private LocalDateTime submittedAt;

    /** The signed-in user who recorded it (empty when it came through an access link, see {@code linkId}). */
    private Long submittedById;

    /** How many times the maker corrected and sent it again after a rejection. */
    private Integer resubmits;

    /** Every step so far, oldest first (JSON: action, at, by, note). */
    @Column(length = 4000)
    private String history;

    /** PENDING, APPROVED, REJECTED or WITHDRAWN. */
    @Column(nullable = false, length = 10)
    private String status;

    @Column(length = 100)
    private String reviewedBy;

    private LocalDateTime reviewedAt;

    @Column(length = 255)
    private String reviewNote;

    /** The journal entry posted on approval. */
    private Long journalEntryId;

    @Version
    private Long version;
}
