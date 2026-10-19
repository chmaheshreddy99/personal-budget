package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.DocumentShare;
import com.aditya.personalbudget.domain.entity.PersonalDocument;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.DocumentShareRepository;
import com.aditya.personalbudget.repository.PersonalDocumentRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AttachmentService.FileContent;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Personal documents of the family (see {@link PersonalDocument}) and their share links (see {@link DocumentShare}).
 * A share link lets someone without an account see (and, if allowed, download) one document's scans until it expires
 * or is revoked; every opening is counted.
 */
@Service
public class DocumentService {

    /** Share links live at most 30 days. */
    public static final int MAX_SHARE_HOURS = 24 * 30;

    public record DocumentRequest(
            @NotBlank @Size(max = 120) String title,
            @NotBlank @Size(max = 30) String docType,
            @NotBlank @Size(max = 60) String owner,
            @Size(max = 30) String relation,
            @Size(max = 60) String docNumber,
            @Size(max = 100) String issuer,
            LocalDate issuedOn,
            LocalDate expiresOn,
            @Size(max = 255) String notes,
            Long version) {
    }

    public record DocumentView(Long id, String title, String docType, String owner, String relation, String docNumber,
                               String issuer, LocalDate issuedOn, LocalDate expiresOn, String notes, int fileCount,
                               Long coverId, boolean coverIsImage, long activeShares, String createdBy, LocalDateTime createdAt,
                               Long version) {
    }

    public record ShareRequest(@Size(max = 80) String sharedWith, @Min(1) @Max(MAX_SHARE_HOURS) int hours, boolean allowDownload) {
    }

    public record ShareView(Long id, Long documentId, String sharedWith, boolean allowDownload, String createdByName,
                            LocalDateTime createdAt, LocalDateTime expiresAt, LocalDateTime revokedAt, int views,
                            LocalDateTime lastViewedAt, String status) {
    }

    public record CreatedShare(ShareView share, String token) {
    }

    /** What the person with a share link sees: no ids of the household, only this document. */
    public record PublicDocument(String title, String docType, String owner, String sharedWith, String sharedBy,
                                 LocalDateTime expiresAt, boolean allowDownload, List<PublicFile> files) {
    }

    public record PublicFile(Long id, String fileName, String contentType, boolean image, boolean pdf, boolean hasThumbnail) {
    }

    private final PersonalDocumentRepository documents;
    private final DocumentShareRepository shares;
    private final AttachmentRepository attachments;
    private final AttachmentService attachmentService;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public DocumentService(PersonalDocumentRepository documents, DocumentShareRepository shares, AttachmentRepository attachments,
                           AttachmentService attachmentService, ActivityService activity) {
        this.documents = documents;
        this.shares = shares;
        this.attachments = attachments;
        this.attachmentService = attachmentService;
        this.activity = activity;
    }

    // ================================================================== documents

    public List<DocumentView> list() {
        Long tenantId = UserContext.tenantId();
        Map<Long, List<com.aditya.personalbudget.domain.entity.Attachment>> files = attachments.findByTenantId(tenantId).stream()
                .filter(a -> a.getDocumentId() != null)
                .collect(Collectors.groupingBy(a -> a.getDocumentId()));
        LocalDateTime now = LocalDateTime.now();
        Map<Long, Long> open = shares.findByTenantId(tenantId).stream().filter(s -> s.isActive(now))
                .collect(Collectors.groupingBy(DocumentShare::getDocumentId, Collectors.counting()));
        return documents.findByTenantId(tenantId).stream()
                .sorted(Comparator.comparing(PersonalDocument::getOwner).thenComparing(PersonalDocument::getTitle))
                .map(d -> view(d, files.getOrDefault(d.getId(), List.of()), open.getOrDefault(d.getId(), 0L)))
                .toList();
    }

    @Transactional
    public DocumentView create(DocumentRequest r) {
        PersonalDocument d = new PersonalDocument();
        d.setTenantId(UserContext.tenantId());
        d.setCreatedBy(UserContext.username());
        d.setCreatedAt(LocalDateTime.now());
        apply(d, r);
        d = documents.save(d);
        return view(d, List.of(), 0);
    }

    @Transactional
    public DocumentView update(Long id, DocumentRequest r) {
        PersonalDocument d = require(id);
        if (r.version() != null && !Objects.equals(r.version(), d.getVersion())) {
            throw new ConcurrentUpdateException("documents", id);
        }
        apply(d, r);
        d = documents.save(d);
        return view(d, attachments.findByOwner("document", id), 0);
    }

    @Transactional
    public void delete(Long id) {
        PersonalDocument d = require(id);
        shares.deleteAll(shares.findByDocumentId(id));
        attachmentService.deleteForOwner("document", id);
        documents.delete(d);
    }

    private void apply(PersonalDocument d, DocumentRequest r) {
        if (r.issuedOn() != null && r.expiresOn() != null && r.expiresOn().isBefore(r.issuedOn())) {
            throw new BusinessException("Valid until is before the issue date");
        }
        d.setTitle(r.title().trim());
        d.setDocType(r.docType().trim().toUpperCase());
        d.setOwner(r.owner().trim());
        d.setRelation(blank(r.relation()));
        d.setDocNumber(blank(r.docNumber()));
        d.setIssuer(blank(r.issuer()));
        d.setIssuedOn(r.issuedOn());
        d.setExpiresOn(r.expiresOn());
        d.setNotes(blank(r.notes()));
    }

    // ================================================================== share links

    public List<ShareView> shares(Long documentId) {
        require(documentId);
        return shares.findByDocumentId(documentId).stream()
                .sorted(Comparator.comparing(DocumentShare::getCreatedAt).reversed())
                .map(DocumentService::view)
                .toList();
    }

    @Transactional
    public CreatedShare share(Long documentId, ShareRequest r) {
        PersonalDocument d = require(documentId);
        if (attachments.findByOwner("document", documentId).isEmpty()) {
            throw new BusinessException("Add a scan or photo of the document first");
        }
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        DocumentShare s = new DocumentShare();
        s.setTenantId(d.getTenantId());
        s.setDocumentId(documentId);
        s.setTokenHash(AccessLinkService.hash(token));
        s.setSharedWith(blank(r.sharedWith()));
        s.setAllowDownload(r.allowDownload());
        s.setCreatedByName(UserContext.get().fullName());
        s.setCreatedAt(LocalDateTime.now());
        s.setExpiresAt(LocalDateTime.now().plusHours(r.hours()));
        s.setViews(0);
        s = shares.save(s);
        activity.record("ADDED", "Documents", "Shared " + d.getTitle() + " (" + d.getOwner() + ")"
                + (s.getSharedWith() != null ? " with " + s.getSharedWith() : "") + " · " + r.hours() + " h"
                + (r.allowDownload() ? "" : " · view only"));
        return new CreatedShare(view(s), token);
    }

    @Transactional
    public ShareView revoke(Long documentId, Long shareId) {
        DocumentShare s = shares.findByIdAndTenantId(shareId, UserContext.tenantId())
                .filter(x -> x.getDocumentId().equals(documentId))
                .orElseThrow(() -> new NotFoundException("Share link", shareId));
        if (s.getRevokedAt() == null) {
            s.setRevokedAt(LocalDateTime.now());
            s = shares.save(s);
            activity.record("REVOKED", "Documents", "Stopped sharing " + require(documentId).getTitle()
                    + (s.getSharedWith() != null ? " with " + s.getSharedWith() : ""));
        }
        return view(s);
    }

    /** Someone opened a share link: what they may see (counts the view). */
    @Transactional
    public PublicDocument open(String token) {
        DocumentShare s = active(token);
        PersonalDocument d = documents.findById(s.getDocumentId()).orElseThrow(() -> new BusinessException("This document is no longer shared"));
        s.setViews((s.getViews() == null ? 0 : s.getViews()) + 1);
        s.setLastViewedAt(LocalDateTime.now());
        shares.save(s);
        List<PublicFile> files = attachmentService.sharedFiles(d.getId()).stream()
                .map(a -> new PublicFile(a.id(), a.fileName(), a.contentType(), a.image(), a.pdf(), a.hasThumbnail()))
                .toList();
        return new PublicDocument(d.getTitle(), d.getDocType(), d.getOwner(), s.getSharedWith(), s.getCreatedByName(), s.getExpiresAt(),
                Boolean.TRUE.equals(s.getAllowDownload()), files);
    }

    public FileContent file(String token, Long attachmentId, boolean thumbnail) {
        DocumentShare s = active(token);
        return attachmentService.sharedFile(s.getTenantId(), s.getDocumentId(), attachmentId, thumbnail);
    }

    public boolean allowsDownload(String token) {
        return Boolean.TRUE.equals(active(token).getAllowDownload());
    }

    private DocumentShare active(String token) {
        DocumentShare s = token == null ? null : shares.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (s == null) {
            throw new BusinessException("This link is not valid");
        }
        if (s.getRevokedAt() != null) {
            throw new BusinessException("The owner stopped sharing this document");
        }
        if (!s.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BusinessException("This link has expired. Ask for a new one.");
        }
        return s;
    }

    // ================================================================== helpers

    private PersonalDocument require(Long id) {
        return documents.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Document", id));
    }

    private static DocumentView view(PersonalDocument d, List<com.aditya.personalbudget.domain.entity.Attachment> files, long openShares) {
        var cover = files.stream().filter(a -> a.getContentType().startsWith("image/")).findFirst()
                .or(() -> files.stream().findFirst()).orElse(null);
        return new DocumentView(d.getId(), d.getTitle(), d.getDocType(), d.getOwner(), d.getRelation(), d.getDocNumber(), d.getIssuer(),
                d.getIssuedOn(), d.getExpiresOn(), d.getNotes(), files.size(), cover == null ? null : cover.getId(),
                cover != null && cover.getContentType().startsWith("image/"), openShares, d.getCreatedBy(), d.getCreatedAt(), d.getVersion());
    }

    private static ShareView view(DocumentShare s) {
        LocalDateTime now = LocalDateTime.now();
        String status = s.getRevokedAt() != null ? "REVOKED" : s.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new ShareView(s.getId(), s.getDocumentId(), s.getSharedWith(), Boolean.TRUE.equals(s.getAllowDownload()), s.getCreatedByName(),
                s.getCreatedAt(), s.getExpiresAt(), s.getRevokedAt(), s.getViews() == null ? 0 : s.getViews(), s.getLastViewedAt(), status);
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
