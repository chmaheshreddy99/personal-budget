package com.aditya.personalbudget.web;

import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AttachmentService;
import com.aditya.personalbudget.service.AttachmentService.AttachmentView;
import com.aditya.personalbudget.service.AttachmentService.FileContent;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

/**
 * Evidence attached to entries ({@code /api/attachments}): photos, scans and PDFs.
 */
@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

    public record CaptionRequest(String caption) {
    }

    private final AttachmentService attachments;

    public AttachmentController(AttachmentService attachments) {
        this.attachments = attachments;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public List<AttachmentView> list(@RequestParam(required = false) Long entryId, @RequestParam(required = false) Long pendingId,
                                     @RequestParam(required = false) Long giftId, @RequestParam(required = false) Long documentId) {
        if (giftId != null) {
            return attachments.listForOwner("gift", giftId);
        }
        if (documentId != null) {
            return attachments.listForOwner("document", documentId);
        }
        if (entryId == null) {
            return attachments.listForPending(pendingId);
        }
        return attachments.list(entryId);
    }

    /** The file itself, or its thumbnail. Served inline, never sniffed, with a download name. */
    @GetMapping("/{id}/file")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> file(@PathVariable Long id, @RequestParam(defaultValue = "false") boolean thumb,
                                       @RequestParam(defaultValue = "false") boolean download) {
        FileContent f = attachments.file(id, thumb);
        ContentDisposition disposition = (download ? ContentDisposition.attachment() : ContentDisposition.inline())
                .filename(f.fileName(), StandardCharsets.UTF_8).build();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePrivate())
                .body(f.bytes());
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AttachmentView upload(@RequestParam(required = false) Long entryId, @RequestParam(required = false) Long pendingId,
                                 @RequestParam(required = false) Long giftId, @RequestParam(required = false) Long documentId,
                                 @RequestPart("file") MultipartFile file,
                                 @RequestParam(required = false) String source,
                                 @RequestParam(required = false) String caption) throws IOException {
        if (giftId != null) {
            return attachments.addToOwner("gift", giftId, file.getOriginalFilename(), file.getBytes(), source, caption);
        }
        if (documentId != null) {
            return attachments.addToOwner("document", documentId, file.getOriginalFilename(), file.getBytes(), source, caption);
        }
        if (entryId == null && pendingId != null) {   // sent with an entry waiting for approval
            return attachments.addToPending(pendingId, file.getOriginalFilename(), file.getBytes(), source, caption);
        }
        if (entryId == null) {
            throw new BusinessException("Say which entry the evidence belongs to");
        }
        return attachments.add(entryId, file.getOriginalFilename(), file.getBytes(), source, caption);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AttachmentView caption(@PathVariable Long id, @RequestBody CaptionRequest request) {
        return attachments.caption(id, request.caption());
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        attachments.delete(id);
        return ResponseEntity.noContent().build();
    }
}
