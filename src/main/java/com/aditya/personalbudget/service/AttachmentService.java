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

    // ================================================================== agreements: ID proof and photos

    /** Kinds of files an agreement keeps. */
    public static final Set<String> DOC_TYPES = Set.of("AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE", "OTHER",
            // the documents of a construction project or a flat's sale (several of a kind are kept)
            "SANCTION_LETTER", "DISBURSAL_LETTER", "TITLE_DEED", "LINK_DOCUMENT", "ENCUMBRANCE", "PLAN_APPROVAL", "SALE_DEED",
            "SIGNED_COPY", "NOC", "ALLOTMENT", "PHOTO", "INVOICE");

    /** ID proof and the selfie: one of each (a new one replaces the old); a PDF of them is taken as images. */
    public static final Set<String> KYC_TYPES = Set.of("AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE");

    /**
     * A file of an agreement, with what it is and its SHA-256 (sealed into the acceptance). intact: the bytes on disk
     * still have that SHA-256 (checked every time it is listed). derivedFromSha: an image rendered from a PDF, the PDF's
     * SHA-256; page: which page of it.
     */
    public record AgreementFile(Long id, String docType, String fileName, String contentType, long sizeBytes, boolean image,
                                boolean pdf, boolean hasThumbnail, String sha256, String source, String createdBy,
                                LocalDateTime createdAt, boolean intact, String derivedFromSha, String caption) {
    }

    /** At most this many pages of a PDF are rendered (an ID card is one or two). */
    private static final int PDF_PAGES = 2;

    public List<AgreementFile> listForAgreement(String kind, Long ownerId) {
        return attachments.findByOwnerKind(kind, ownerId).stream().map(this::agreementFile).toList();
    }

    /** The old signature, without a watermark text. */
    public AgreementFile addToAgreement(String kind, Long ownerId, String docType, String originalName, byte[] bytes, String source) {
        return addToAgreement(kind, ownerId, docType, originalName, bytes, source, null);
    }

    /**
     * Adds an ID proof or photo to an agreement ({@code kind} CHIT_AGREEMENT or LOAN_AGREEMENT); the caller has checked
     * the agreement belongs to the household in context. A new file of the same type (other than OTHER) replaces the
     * old one. A PDF is kept as it is (the original) and its first pages are rendered into images for the agreement,
     * each watermarked with {@code mark} (the agreement it is for), the date and the PDF's fingerprint, so a copy
     * cannot be passed off for another purpose and can always be traced back to the original.
     */
    @Transactional
    public AgreementFile addToAgreement(String kind, Long ownerId, String docType, String originalName, byte[] bytes, String source, String mark) {
        String type = docType == null ? "OTHER" : docType.trim().toUpperCase();
        if (!DOC_TYPES.contains(type)) {
            throw new BusinessException("Say what the file is: Aadhaar (front or back), PAN, a selfie, or a document");
        }
        if ("SELFIE".equals(type) && bytes != null && "application/pdf".equals(sniff(bytes))) {
            throw new BusinessException("The selfie is a photo from the camera, not a PDF");
        }
        List<Attachment> existing = attachments.findByOwnerKind(kind, ownerId);
        if (KYC_TYPES.contains(type)) {
            List<Attachment> same = existing.stream().filter(a -> type.equals(a.getDocType())).toList();
            if (!same.isEmpty()) {
                attachments.deleteAllById(same.stream().map(Attachment::getId).toList());
                afterCommitDelete(same);
                existing = existing.stream().filter(a -> !type.equals(a.getDocType())).toList();
            }
        }
        String label = switch (type) {
            case "AADHAAR_FRONT" -> "Aadhaar card (front)";
            case "AADHAAR_BACK" -> "Aadhaar card (back)";
            case "PAN" -> "PAN card";
            case "SELFIE" -> "Selfie";
            default -> KYC_TYPES.contains(type) || "OTHER".equals(type) ? "Document" : MaybeLabel.of(type);
        };
        String name = originalName == null || originalName.isBlank() ? type.toLowerCase().replace('_', '-') : originalName;
        // a PDF is read before anything is stored: a damaged or password-protected one is refused with a clear reason
        List<Rendered> pages = KYC_TYPES.contains(type) && "application/pdf".equals(bytes == null ? null : sniff(bytes)) ? renderPdf(bytes, label, mark) : List.of();
        // the images taken from a PDF do not count towards the limit of files: only what the person gave
        AttachmentView v = store(UserContext.tenantId(), null, null, "This agreement",
                existing.stream().filter(x -> x.getDerivedFromSha() == null).toList(), name, bytes, source, label);
        Attachment a = attachments.findById(v.id()).orElseThrow();
        if (kind.equals(a.getOwnerKind()) && ownerId.equals(a.getOwnerId()) && type.equals(a.getDocType())) {
            return agreementFile(a);   // the very same file was already there
        }
        if (a.getOwnerKind() != null) {
            // store() keeps one copy of the same bytes per agreement: the file is already there as another document
            throw new BusinessException("This file is already attached as the " + a.getCaption() + "; add a separate photo for each side or card");
        }
        a.setOwnerKind(kind);
        a.setOwnerId(ownerId);
        a.setDocType(type);
        a = attachments.save(a);
        String base = name.replaceAll("(?i)\\.pdf$", "");
        for (int i = 0; i < pages.size(); i++) {
            AttachmentView pv = store(UserContext.tenantId(), null, null, "This agreement", List.of(), base + "-" + pages.get(i).suffix()
                    + (pages.get(i).png()[0] == (byte) 0x89 ? ".png" : ".jpg"),
                    pages.get(i).png(), "UPLOAD", pages.get(i).caption());
            Attachment page = attachments.findById(pv.id()).orElseThrow();
            if (page.getOwnerKind() != null) continue;   // the same page already there
            page.setOwnerKind(kind);
            page.setOwnerId(ownerId);
            page.setDocType(type);
            page.setSource("PDF_PAGE");
            page.setDerivedFromSha(a.getSha256());
            attachments.save(page);
        }
        return agreementFile(a);
    }

    /** An image taken from a PDF: its file-name suffix, its caption and the PNG. */
    private record Rendered(String suffix, String caption, byte[] png) {
    }

    /**
     * The first pages of a PDF as PNG images (300 dpi, sharp enough to read the card printed across a page; the blank
     * margins cut away so the content fills the picture).
     * When the first page has the card itself as a separate block (an e-Aadhaar: a letter above, the card to cut out
     * below), that block also comes as a close-up, first. Each image carries the agreement's watermark and, below it, a
     * strip naming the PDF's SHA-256 and when it was taken.
     */
    private List<Rendered> renderPdf(byte[] bytes, String label, String mark) {
        String sha = sha256(bytes);
        try (org.apache.pdfbox.pdmodel.PDDocument pdf = org.apache.pdfbox.Loader.loadPDF(bytes)) {
            if (pdf.isEncrypted()) {
                throw new BusinessException("The PDF is password protected: upload it without the password, or a photo of the card");
            }
            int total = pdf.getNumberOfPages();
            int count = Math.min(PDF_PAGES, total);
            if (count == 0) throw new BusinessException("The PDF has no pages");
            org.apache.pdfbox.rendering.PDFRenderer renderer = new org.apache.pdfbox.rendering.PDFRenderer(pdf);
            List<Rendered> out = new java.util.ArrayList<>();
            for (int i = 0; i < count; i++) {
                BufferedImage page = trim(renderer.renderImageWithDPI(i, 300, org.apache.pdfbox.rendering.ImageType.RGB));
                if (i == 0) {
                    BufferedImage card = cardBlock(page);
                    if (card != null) {
                        out.add(new Rendered("card", label + " · close-up from the PDF", png(stamp(card, mark, label + " · close-up", sha))));
                    }
                }
                String what = label + " · page " + (i + 1) + " of " + total;
                out.add(new Rendered("page-" + (i + 1), label + " · page " + (i + 1) + " of the PDF", png(stamp(page, mark, what, sha))));
            }
            return out;
        } catch (org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException e) {
            throw new BusinessException("The PDF is password protected: upload it without the password, or a photo of the card");
        } catch (IOException e) {
            throw new BusinessException("The PDF could not be read; upload a photo of the card instead");
        }
    }

    /** PNG (sharp text); a very busy page that would come out too large is a fine JPEG instead. */
    private static byte[] png(BufferedImage img) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        if (out.size() <= 7 * 1024 * 1024) return out.toByteArray();
        java.io.ByteArrayOutputStream jpg = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(0.92f);
        try (var stream = ImageIO.createImageOutputStream(jpg)) {
            writer.setOutput(stream);
            writer.write(null, new javax.imageio.IIOImage(img, null, null), param);
        } finally {
            writer.dispose();
        }
        return jpg.toByteArray();
    }

    private static boolean ink(int rgb) {
        return ((rgb >> 16) & 0xff) < 200 || ((rgb >> 8) & 0xff) < 200 || (rgb & 0xff) < 200;
    }

    /**
     * The card on a page that has more than the card: the page split into blocks at wide blank gaps, and the last block
     * holding a long straight line (the card's border or the cut line) that is clearly smaller than the page. Null when
     * the page is just the card (nothing to zoom).
     */
    static BufferedImage cardBlock(BufferedImage img) {
        int w = img.getWidth(), h = img.getHeight();
        boolean[] filled = new boolean[h];
        int[] longest = new int[h];
        for (int y = 0; y < h; y++) {
            int run = 0, best = 0;
            for (int x = 0; x < w; x++) {
                if (ink(img.getRGB(x, y))) {
                    filled[y] = true;
                    best = Math.max(best, ++run);
                } else {
                    run = 0;
                }
            }
            longest[y] = best;
        }
        int gap = Math.max(30, h / 20);
        List<int[]> blocks = new java.util.ArrayList<>();
        int start = -1, blank = 0;
        for (int y = 0; y < h; y++) {
            if (filled[y]) {
                if (start < 0) start = y;
                blank = 0;
            } else if (start >= 0 && ++blank >= gap) {
                blocks.add(new int[]{start, y - blank});
                start = -1;
            }
        }
        if (start >= 0) blocks.add(new int[]{start, h - 1 - blank});
        if (blocks.size() < 2) return null;
        for (int i = blocks.size() - 1; i >= 0; i--) {
            int[] b = blocks.get(i);
            boolean lined = false;
            for (int y = b[0]; y <= b[1] && !lined; y++) lined = longest[y] >= w / 4;
            int height = b[1] - b[0] + 1;
            if (lined && height >= h / 8 && height <= h * 0.7) {
                int pad = Math.max(10, height / 30);
                int top = Math.max(0, b[0] - pad), bottom = Math.min(h - 1, b[1] + pad);
                return trim(img.getSubimage(0, top, w, bottom - top + 1));
            }
        }
        return null;
    }

    /**
     * The page without its blank margins (anything near white), with a little border kept: an ID card printed small on a
     * big page comes out zoomed in. A blank page is returned as it is.
     */
    static BufferedImage trim(BufferedImage img) {
        int w = img.getWidth(), h = img.getHeight(), top = h, left = w, right = -1, bottom = -1;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = img.getRGB(x, y);
                if (((rgb >> 16) & 0xff) < 232 || ((rgb >> 8) & 0xff) < 232 || (rgb & 0xff) < 232) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
        if (right < 0) return img;
        int pad = Math.max(12, Math.min(w, h) / 60);
        left = Math.max(0, left - pad);
        top = Math.max(0, top - pad);
        right = Math.min(w - 1, right + pad);
        bottom = Math.min(h - 1, bottom + pad);
        if (right - left > w * 0.97 && bottom - top > h * 0.97) return img;
        BufferedImage out = new BufferedImage(right - left + 1, bottom - top + 1, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.drawImage(img.getSubimage(left, top, right - left + 1, bottom - top + 1), 0, 0, null);
        g.dispose();
        return out;
    }

    /**
     * The image with the watermark across it (light, so the card stays readable, but every copy says what it is for)
     * and a dark strip added below it (never over the card) naming what it is, the PDF's SHA-256 and when it was taken.
     */
    private static BufferedImage stamp(BufferedImage img, String mark, String what, String sha) {
        int w = img.getWidth(), h = img.getHeight();
        int band = Math.max(28, Math.min(54, w / 48));
        BufferedImage out = new BufferedImage(w, h + band, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.drawImage(img, 0, 0, null);
            String text = (mark == null || mark.isBlank() ? "For this agreement only" : "For " + mark + " only") + " · "
                    + java.time.LocalDate.now();
            java.awt.Font font = new java.awt.Font(java.awt.Font.SANS_SERIF, java.awt.Font.BOLD, Math.max(16, Math.max(Math.min(w, h) / 26, w / 52)));
            g.setFont(font);
            g.setColor(new java.awt.Color(192, 20, 28, 30));
            g.setClip(0, 0, w, h);
            g.rotate(-Math.PI / 7, w / 2.0, h / 2.0);
            int step = font.getSize() * 7;
            int tw = g.getFontMetrics().stringWidth(text) + font.getSize() * 4;
            int row = 0;
            for (int y = -h; y < h * 2; y += step, row++) {
                for (int x = -w; x < w * 2; x += tw) {
                    g.drawString(text, x + (row % 2 == 0 ? 0 : tw / 2), y);
                }
            }
            g.setTransform(new java.awt.geom.AffineTransform());
            g.setClip(null);
            g.setColor(new java.awt.Color(10, 46, 79));
            g.fillRect(0, h, w, band);
            g.setColor(java.awt.Color.WHITE);
            java.awt.Font small = new java.awt.Font(java.awt.Font.SANS_SERIF, java.awt.Font.PLAIN, Math.max(11, band * 2 / 5));
            g.setFont(small);
            String line = what + " · from PDF SHA-256 " + sha.substring(0, 24) + "… · taken " + LocalDateTime.now().withNano(0);
            while (g.getFontMetrics().stringWidth(line) > w - band && small.getSize() > 8) {
                small = small.deriveFont(small.getSize2D() - 1);
                g.setFont(small);
            }
            g.drawString(line, band / 3, h + band * 2 / 3);
        } finally {
            g.dispose();
        }
        return out;
    }

    @Transactional
    public void deleteFromAgreement(String kind, Long ownerId, Long attachmentId) {
        Attachment a = attachments.findById(attachmentId)
                .filter(x -> kind.equals(x.getOwnerKind()) && ownerId.equals(x.getOwnerId()) && UserContext.tenantId().equals(x.getTenantId()))
                .orElseThrow(() -> new NotFoundException("File", attachmentId));
        List<Attachment> gone = new java.util.ArrayList<>(List.of(a));
        attachments.findByOwnerKind(kind, ownerId).stream().filter(x -> a.getSha256().equals(x.getDerivedFromSha())).forEach(gone::add);
        attachments.deleteAllById(gone.stream().map(Attachment::getId).toList());
        afterCommitDelete(gone);
    }

    /** When an agreement is deleted, its files go too. */
    public void deleteAllForAgreement(String kind, Long ownerId) {
        List<Attachment> list = attachments.findByOwnerKind(kind, ownerId);
        if (!list.isEmpty()) {
            attachments.deleteAllById(list.stream().map(Attachment::getId).toList());
            afterCommitDelete(list);
        }
    }

    /** The bytes of an agreement's file (for printing the stamp-paper copy with its annexures). */
    public FileContent agreementFileContent(String kind, Long ownerId, Long attachmentId, boolean thumbnail) {
        Attachment a = attachments.findById(attachmentId)
                .filter(x -> kind.equals(x.getOwnerKind()) && ownerId.equals(x.getOwnerId()) && UserContext.tenantId().equals(x.getTenantId()))
                .orElseThrow(() -> new NotFoundException("File", attachmentId));
        return fileOf(a, thumbnail);
    }

    private AgreementFile agreementFile(Attachment a) {
        return new AgreementFile(a.getId(), a.getDocType(), a.getFileName(), a.getContentType(), a.getSizeBytes(),
                a.getContentType().startsWith("image/"), a.getContentType().equals("application/pdf"),
                Boolean.TRUE.equals(a.getHasThumbnail()), a.getSha256(), a.getSource(), a.getCreatedBy(), a.getCreatedAt(),
                intact(a), a.getDerivedFromSha(), a.getCaption());
    }

    /** The bytes on disk still hash to what was recorded when the file came in (a changed or missing file is not intact). */
    private boolean intact(Attachment a) {
        try {
            return a.getSha256().equals(sha256(Files.readAllBytes(path(a))));
        } catch (IOException e) {
            return false;
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

    /** "SANCTION_LETTER" → "Sanction letter". */
    private static final class MaybeLabel {
        static String of(String type) {
            String t = type.replace('_', ' ').toLowerCase();
            return Character.toUpperCase(t.charAt(0)) + t.substring(1);
        }
    }
}
