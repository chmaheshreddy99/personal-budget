package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.domain.entity.Attachment;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.repository.PersonalDocumentRepository;
import com.aditya.personalbudget.repository.GiftRepository;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.repository.PendingEntryRepository;
import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Evidence for entries: photos from the camera, uploaded images and PDFs.
 * <ul>
 *   <li>The type is decided from the file's first bytes, never from its name or the browser's claim:
 *       JPEG, PNG, WebP, GIF and PDF are accepted.</li>
 *   <li>Files are stored under a random name; images get a 360 px JPEG thumbnail for compact lists.</li>
 *   <li>The same file attached twice to one entry is kept once.</li>
 *   <li>Deleting an entry deletes its evidence; the files go once the deletion is committed. Files left
 *       behind by a crash are swept at startup.</li>
 * </ul>
 */
@Service
public class AttachmentService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);
    private static final int THUMB = 360;
    private static final Set<String> SOURCES = Set.of("CAMERA", "UPLOAD", "PASTE");

    public record AttachmentView(Long id, Long journalEntryId, String fileName, String contentType, long sizeBytes,
                                 Integer width, Integer height, boolean image, boolean pdf, boolean hasThumbnail,
                                 String source, String caption, String createdBy, LocalDateTime createdAt) {
    }

    /** Bytes to send back, with their type and a download name. */
    public record FileContent(byte[] bytes, String contentType, String fileName) {
    }

    private final AttachmentRepository attachments;
    private final PendingEntryRepository pendingEntries;
    private final GiftRepository gifts;
    private final PersonalDocumentRepository documents;
    private final JournalEntryRepository entries;
    private final Path root;
    private final long maxBytes;
    private final int maxPerEntry;

    public AttachmentService(AttachmentRepository attachments, JournalEntryRepository entries, TsvDataStore store,
                             BudgetProperties properties, PendingEntryRepository pendingEntries,
                             GiftRepository gifts, PersonalDocumentRepository documents) {
        this.gifts = gifts;
        this.documents = documents;
        this.pendingEntries = pendingEntries;
        this.attachments = attachments;
        this.entries = entries;
        this.root = store.dataDir().resolve("attachments");
        this.maxBytes = properties.attachments().maxFileMb() * 1024L * 1024L;
        this.maxPerEntry = properties.attachments().maxPerEntry();
    }

    // ================================================================== queries

    public List<AttachmentView> list(Long entryId) {
        if (UserContext.get().viaLink()) {
            throw new ForbiddenException("Not available with this link");
        }
        entry(entryId);
        return attachments.findByJournalEntryId(entryId).stream().map(AttachmentService::view).toList();
    }

    /** Photos of a gift ("gift") or scans of a document ("document"). */
    public List<AttachmentView> listForOwner(String owner, Long id) {
        owner(owner, id);
        return attachments.findByOwner(owner, id).stream().map(AttachmentService::view).toList();
    }

    @Transactional
    public AttachmentView addToOwner(String owner, Long id, String originalName, byte[] bytes, String source, String caption) {
        Long tenantId = owner(owner, id);
        AttachmentView v = store(tenantId, null, null, "gift".equals(owner) ? "This gift" : "This document",
                attachments.findByOwner(owner, id), originalName, bytes, source, caption);
        Attachment a = attachments.findById(v.id()).orElseThrow();
        if ("gift".equals(owner)) a.setGiftId(id); else a.setDocumentId(id);
        return view(attachments.save(a));
    }

    /** When a gift or a document is deleted, its files go too. */
    public void deleteForOwner(String owner, Long id) {
        List<Attachment> list = attachments.findByOwner(owner, id);
        if (!list.isEmpty()) {
            attachments.deleteAllById(list.stream().map(Attachment::getId).toList());
            afterCommitDelete(list);
        }
    }

    /** The bytes of a document scan for a share link (no signed-in user). */
    public FileContent sharedFile(Long tenantId, Long documentId, Long attachmentId, boolean thumbnail) {
        Attachment a = attachments.findById(attachmentId)
                .filter(x -> tenantId.equals(x.getTenantId()) && documentId.equals(x.getDocumentId()))
                .orElseThrow(() -> new NotFoundException("File", attachmentId));
        return fileOf(a, thumbnail);
    }

    public List<AttachmentView> sharedFiles(Long documentId) {
        return attachments.findByOwner("document", documentId).stream().map(AttachmentService::view).toList();
    }

    /** A gift or document of this household, and the section shared with the user; returns the tenant. */
    private Long owner(String owner, Long id) {
        Long tenantId = UserContext.tenantId();
        CurrentUser me = UserContext.get();
        if ("gift".equals(owner)) {
            if (!me.features().contains(Feature.GIFTS)) throw new ForbiddenException("Gifts are not shared with you");
            gifts.findByIdAndTenantId(id, tenantId).orElseThrow(() -> new NotFoundException("Gift", id));
        } else if ("document".equals(owner)) {
            if (!me.features().contains(Feature.DOCUMENTS)) throw new ForbiddenException("Documents are not shared with you");
            documents.findByIdAndTenantId(id, tenantId).orElseThrow(() -> new NotFoundException("Document", id));
        } else {
            throw new BusinessException("Unknown owner");
        }
        return tenantId;
    }

    /** Evidence sent with an entry waiting for approval. */
    public List<AttachmentView> listForPending(Long pendingId) {
        pending(pendingId, false);
        return attachments.findByPendingEntryId(pendingId).stream().map(AttachmentService::view).toList();
    }

    /** On approval the evidence moves to the posted entry (and still remembers where it came from). */
    public void moveToEntry(Long pendingId, Long entryId) {
        for (Attachment a : attachments.findByPendingEntryId(pendingId)) {
            a.setJournalEntryId(entryId);
            attachments.save(a);
        }
    }

    /** Attaches to an entry waiting for approval (the access link that sent it, or a checker). */
    @Transactional
    public AttachmentView addToPending(Long pendingId, String originalName, byte[] bytes, String source, String caption) {
        PendingEntry p = pending(pendingId, true);
        return store(p.getTenantId(), null, pendingId, "This entry", attachments.findByPendingEntryId(pendingId),
                originalName, bytes, source, caption);
    }

    public Map<Long, Integer> countsByEntry() {
        return attachments.countsByEntry(UserContext.tenantId());
    }

    public FileContent file(Long id, boolean thumbnail) {
        Attachment a = require(id);
        CurrentUser me = UserContext.get();
        if (me.viaLink() && a.getDocumentId() == null) {
            throw new ForbiddenException("This file is not shared with you");
        }
        if ((a.getGiftId() != null && !me.features().contains(Feature.GIFTS))
                || (a.getDocumentId() != null && !me.features().contains(Feature.DOCUMENTS))) {
            throw new ForbiddenException("This file is not shared with you");
        }
        return fileOf(a, thumbnail);
    }

    private FileContent fileOf(Attachment a, boolean thumbnail) {
        boolean thumb = thumbnail && Boolean.TRUE.equals(a.getHasThumbnail());
        Path path = thumb ? thumbPath(a) : path(a);
        try {
            return new FileContent(Files.readAllBytes(path), thumb ? "image/jpeg" : a.getContentType(), a.getFileName());
        } catch (IOException e) {
            throw new NotFoundException("Evidence file", a.getId());
        }
    }

    // ================================================================== changes

    @Transactional
    public AttachmentView add(Long entryId, String originalName, byte[] bytes, String source, String caption) {
        JournalEntry entry = entry(entryId);
        CurrentUser me = UserContext.get();
        if (me.viaLink() && !me.username().equals(entry.getCreatedBy())) {
            throw new ForbiddenException("This link can only attach evidence to what it recorded");
        }
        return store(entry.getTenantId(), entryId, null, entry.getEntryNo(), attachments.findByJournalEntryId(entryId),
                originalName, bytes, source, caption);
    }

    private AttachmentView store(Long tenantId, Long entryId, Long pendingId, String label, List<Attachment> existing,
                                 String originalName, byte[] bytes, String source, String caption) {
        if (bytes == null || bytes.length == 0) {
            throw new BusinessException("The file is empty");
        }
        if (bytes.length > maxBytes) {
            throw new BusinessException("The file is larger than " + (maxBytes / 1024 / 1024) + " MB");
        }
        String type = sniff(bytes);
        if (type == null) {
            throw new BusinessException("Attach a photo (JPEG, PNG, WebP, GIF) or a PDF");
        }
        String sha = sha256(bytes);
        for (Attachment a : existing) {
            if (a.getSha256().equals(sha)) {
                return view(a);   // already attached
            }
        }
        if (existing.size() >= maxPerEntry) {
            throw new BusinessException(label + " already has " + maxPerEntry + " attachments");
        }

        Attachment a = new Attachment();
        a.setTenantId(tenantId);
        a.setJournalEntryId(entryId);
        a.setPendingEntryId(pendingId);
        a.setFileName(cleanName(originalName, type));
        a.setStoredName(UUID.randomUUID().toString().replace("-", "") + extension(type));
        a.setContentType(type);
        a.setSizeBytes((long) bytes.length);
        a.setSha256(sha);
        a.setSource(source != null && SOURCES.contains(source.toUpperCase()) ? source.toUpperCase() : "UPLOAD");
        a.setCaption(blankToNull(caption, 200));
        a.setCreatedBy(UserContext.username());
        a.setCreatedAt(LocalDateTime.now());

        BufferedImage image = type.startsWith("image/") ? decode(bytes) : null;
        a.setWidth(image == null ? null : image.getWidth());
        a.setHeight(image == null ? null : image.getHeight());
        try {
            Files.createDirectories(path(a).getParent());
            write(path(a), bytes);
            a.setHasThumbnail(image != null && writeThumbnail(image, thumbPath(a)));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not store the file", e);
        }
        afterRollback(a);   // a failed save must not leave the file behind
        return view(attachments.save(a));
    }

    @Transactional
    public AttachmentView caption(Long id, String caption) {
        Attachment a = require(id);
        a.setCaption(blankToNull(caption, 200));
        return view(attachments.save(a));
    }

    @Transactional
    public void delete(Long id) {
        Attachment a = require(id);
        attachments.deleteById(id);
        afterCommitDelete(List.of(a));
    }

    /** Called when an entry is deleted. */
    public void deleteForEntry(Long entryId) {
        List<Attachment> list = attachments.findByJournalEntryId(entryId);
        if (!list.isEmpty()) {
            attachments.deleteAllById(list.stream().map(Attachment::getId).toList());
            afterCommitDelete(list);
        }
    }

    // ================================================================== startup sweep

    /** Removes files that no row points to (left by a crash between writing the file and saving the row). */
    @Override
    public void run(ApplicationArguments args) {
        if (!Files.isDirectory(root)) {
            return;
        }
        Set<String> known = attachments.findAll().stream()
                .flatMap(a -> Stream.of(a.getStoredName(), thumbName(a)))
                .collect(Collectors.toSet());
        Instant cutoff = Instant.now().minus(Duration.ofHours(1));
        try (Stream<Path> files = Files.walk(root)) {
            List<Path> orphans = files.filter(Files::isRegularFile)
                    .filter(p -> !known.contains(p.getFileName().toString()))
                    .filter(p -> {
                        try {
                            return Files.getLastModifiedTime(p).toInstant().isBefore(cutoff);
                        } catch (IOException e) {
                            return false;
                        }
                    }).toList();
            for (Path p : orphans) {
                Files.deleteIfExists(p);
            }
            if (!orphans.isEmpty()) {
                log.info("Removed {} evidence file(s) no entry refers to", orphans.size());
            }
        } catch (IOException e) {
            log.warn("Could not sweep the attachments folder: {}", e.getMessage());
        }
    }

    // ================================================================== helpers

    private static AttachmentView view(Attachment a) {
        return new AttachmentView(a.getId(), a.getJournalEntryId() != null ? a.getJournalEntryId() : a.getPendingEntryId() != null ? a.getPendingEntryId()
                : a.getGiftId() != null ? a.getGiftId() : a.getDocumentId(), a.getFileName(), a.getContentType(), a.getSizeBytes(),
                a.getWidth(), a.getHeight(), a.getContentType().startsWith("image/"), a.getContentType().equals("application/pdf"),
                Boolean.TRUE.equals(a.getHasThumbnail()), a.getSource(), a.getCaption(), a.getCreatedBy(), a.getCreatedAt());
    }

    private JournalEntry entry(Long entryId) {
        return entries.findByIdAndTenantId(entryId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Journal entry", entryId));
    }

    /** A waiting entry of this household; a link session only reaches its own (and only to add while it waits). */
    private PendingEntry pending(Long pendingId, boolean adding) {
        PendingEntry p = pendingEntries.findByIdAndTenantId(pendingId, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Entry awaiting approval", pendingId));
        CurrentUser me = UserContext.get();
        if (me.viaLink() && !me.linkId().equals(p.getLinkId())) {
            throw new ForbiddenException("This link can only attach evidence to what it recorded");
        }
        if (adding && !PendingEntry.PENDING.equals(p.getStatus()) && !PendingEntry.REJECTED.equals(p.getStatus())) {   // rejected: the maker may add proof before sending it again
            throw new BusinessException("Already " + p.getStatus().toLowerCase());
        }
        return p;
    }

    private Attachment require(Long id) {
        return attachments.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Evidence", id));
    }

    private Path path(Attachment a) {
        return root.resolve(String.valueOf(a.getTenantId())).resolve(a.getStoredName());
    }

    private Path thumbPath(Attachment a) {
        return root.resolve(String.valueOf(a.getTenantId())).resolve(thumbName(a));
    }

    private static String thumbName(Attachment a) {
        return a.getStoredName() + ".thumb.jpg";
    }

    /** The real type from the first bytes. */
    static String sniff(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return "image/png";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') {
            return "image/gif";
        }
        if (b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') {
            return "application/pdf";
        }
        return null;
    }

    private static String extension(String type) {
        return switch (type) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            case "image/gif" -> ".gif";
            default -> ".pdf";
        };
    }

    private static String cleanName(String name, String type) {
        String base = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (base.isEmpty()) {
            base = "evidence";
        }
        if (base.length() > 150) {
            base = base.substring(0, 150);
        }
        String ext = extension(type);
        return base.toLowerCase().endsWith(ext) || (ext.equals(".jpg") && base.toLowerCase().endsWith(".jpeg")) ? base : base + ext;
    }

    private static BufferedImage decode(byte[] bytes) {
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));   // null for WebP (no reader): stored without thumbnail
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static boolean writeThumbnail(BufferedImage image, Path target) throws IOException {
        double scale = Math.min(1.0, (double) THUMB / Math.max(image.getWidth(), image.getHeight()));
        int w = Math.max(1, (int) Math.round(image.getWidth() * scale));
        int h = Math.max(1, (int) Math.round(image.getHeight() * scale));
        BufferedImage thumb = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = thumb.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setColor(java.awt.Color.WHITE);   // transparent PNGs on white
            g.fillRect(0, 0, w, h);
            g.drawImage(image, 0, 0, w, h, null);
        } finally {
            g.dispose();
        }
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        boolean ok = ImageIO.write(thumb, "jpg", tmp.toFile());
        if (ok) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } else {
            Files.deleteIfExists(tmp);
        }
        return ok;
    }

    private static void write(Path target, byte[] bytes) throws IOException {
        Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
        Files.write(tmp, bytes);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private void afterCommitDelete(List<Attachment> list) {
        Runnable remove = () -> list.forEach(this::deleteFiles);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    remove.run();
                }
            });
        } else {
            remove.run();
        }
    }

    private void afterRollback(Attachment a) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        deleteFiles(a);
                    }
                }
            });
        }
    }

    private void deleteFiles(Attachment a) {
        try {
            Files.deleteIfExists(path(a));
            Files.deleteIfExists(thumbPath(a));
        } catch (IOException e) {
            log.warn("Could not delete evidence file {}: {}", a.getStoredName(), e.getMessage());
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String blankToNull(String text, int max) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String t = text.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }
}
