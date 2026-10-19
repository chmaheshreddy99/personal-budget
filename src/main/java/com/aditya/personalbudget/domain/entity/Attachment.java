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
 * Evidence attached to a journal entry: a receipt photo, a scanned bill, a PDF statement, a UPI screenshot.
 * The bytes live in {@code <data-dir>/attachments/<tenantId>/<storedName>} (plus a small JPEG thumbnail
 * for images); this row describes them. Table file: {@code data/attachments.tbl}
 */
@Entity
@Table(name = "attachments")
@Getter
@Setter
@NoArgsConstructor
public class Attachment implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    /** The entry it belongs to; empty while it belongs to an entry still waiting for approval. */
    @References(JournalEntry.class)
    private Long journalEntryId;

    /** Recorded through an access link for approval: the waiting entry (kept after approval for the record). */
    @References(PendingEntry.class)
    private Long pendingEntryId;

    /** A photo or receipt of a gift (Gifts). */
    @References(Gift.class)
    private Long giftId;

    /** A scan of a personal document (Documents). */
    @References(PersonalDocument.class)
    private Long documentId;

    /** Name of the file as the user had it (or "Photo 2026-10-07 14.32.jpg" for the camera). */
    @Column(nullable = false, length = 200)
    private String fileName;

    /** Random name on disk, so user input never becomes a path. */
    @Column(nullable = false, unique = true, length = 64)
    private String storedName;

    @Column(nullable = false, length = 60)
    private String contentType;

    @Column(nullable = false)
    private Long sizeBytes;

    /** SHA-256 of the content: the same file attached twice to one entry is kept once. */
    @Column(nullable = false, length = 64)
    private String sha256;

    private Integer width;

    private Integer height;

    @Column(nullable = false)
    private Boolean hasThumbnail;

    /** CAMERA, UPLOAD or PASTE. */
    @Column(nullable = false, length = 10)
    private String source;

    @Column(length = 200)
    private String caption;

    @Column(nullable = false, length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
