package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AttachmentService.FileContent;
import com.aditya.personalbudget.service.DocumentService;
import com.aditya.personalbudget.service.DocumentService.CreatedShare;
import com.aditya.personalbudget.service.DocumentService.DocumentRequest;
import com.aditya.personalbudget.service.DocumentService.DocumentView;
import com.aditya.personalbudget.service.DocumentService.PublicDocument;
import com.aditya.personalbudget.service.DocumentService.ShareRequest;
import com.aditya.personalbudget.service.DocumentService.ShareView;
import com.aditya.personalbudget.service.GiftService;
import com.aditya.personalbudget.service.InsuranceService;
import com.aditya.personalbudget.service.GiftService.GiftRequest;
import com.aditya.personalbudget.service.GiftService.GiftView;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Gifts (given and received, donations), personal documents and their share links; plus the public side of a
 * share link ({@code /api/public/shares/…}), which needs no sign-in, only the link's token.
 */
@RestController
public class GiftDocumentController {

    private final GiftService gifts;
    private final DocumentService documents;
    private final InsuranceService insurance;

    public GiftDocumentController(GiftService gifts, DocumentService documents, InsuranceService insurance) {
        this.insurance = insurance;
        this.gifts = gifts;
        this.documents = documents;
    }

    // ---------------------------------------------------------------- gifts

    @GetMapping("/api/gifts")
    @RequiresPermission(Permission.VIEW)
    public List<GiftView> gifts() {
        return gifts.list();
    }

    @PostMapping("/api/gifts")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public GiftView createGift(@Valid @RequestBody GiftRequest request) {
        return gifts.create(request);
    }

    /** A person's relation and family (and optionally a new spelling of the name) on all their gifts at once. */
    public record GiftPersonRequest(@jakarta.validation.constraints.NotBlank String person,
                                    @jakarta.validation.constraints.Size(max = 40) String relation,
                                    @jakarta.validation.constraints.Size(max = 60) String family,
                                    @jakarta.validation.constraints.Size(max = 100) String newName) {
    }

    @PutMapping("/api/gifts/person")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public java.util.Map<String, Integer> updateGiftPerson(@Valid @RequestBody GiftPersonRequest request) {
        return java.util.Map.of("updated", gifts.updatePerson(request.person(), request.relation(), request.family(), request.newName()));
    }

    @PutMapping("/api/gifts/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public GiftView updateGift(@PathVariable Long id, @Valid @RequestBody GiftRequest request) {
        return gifts.update(id, request);
    }

    @DeleteMapping("/api/gifts/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> deleteGift(@PathVariable Long id) {
        gifts.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- documents

    @GetMapping("/api/documents")
    @RequiresPermission(Permission.VIEW)
    public List<DocumentView> documents() {
        return documents.list();
    }

    @PostMapping("/api/documents")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public DocumentView createDocument(@Valid @RequestBody DocumentRequest request) {
        return documents.create(request);
    }

    @PutMapping("/api/documents/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public DocumentView updateDocument(@PathVariable Long id, @Valid @RequestBody DocumentRequest request) {
        return documents.update(id, request);
    }

    @DeleteMapping("/api/documents/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> deleteDocument(@PathVariable Long id) {
        documents.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- insurance policies

    /** Premiums due soon or overdue: the alerts. */
    @GetMapping("/api/documents/premiums/due")
    @RequiresPermission(Permission.VIEW)
    public List<InsuranceService.DuePremium> duePremiums() {
        return insurance.due();
    }

    @PostMapping("/api/documents/{id}/policy/pay")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public InsuranceService.Paid payPremium(@PathVariable Long id, @Valid @RequestBody InsuranceService.PayRequest request) {
        return insurance.pay(id, request);
    }

    @DeleteMapping("/api/documents/{id}/policy/payments/{paymentId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> undoPremium(@PathVariable Long id, @PathVariable Long paymentId) {
        insurance.undoPayment(id, paymentId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/documents/{id}/policy/remind")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public InsuranceService.RemindResult remindPremium(@PathVariable Long id) {
        return insurance.remindNow(id);
    }

    @GetMapping("/api/documents/{id}/shares")
    @RequiresPermission(Permission.VIEW)
    public List<ShareView> shares(@PathVariable Long id) {
        return documents.shares(id);
    }

    @PostMapping("/api/documents/{id}/shares")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public CreatedShare share(@PathVariable Long id, @Valid @RequestBody ShareRequest request) {
        return documents.share(id, request);
    }

    @PostMapping("/api/documents/{id}/shares/{shareId}/revoke")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ShareView revoke(@PathVariable Long id, @PathVariable Long shareId) {
        return documents.revoke(id, shareId);
    }

    // ---------------------------------------------------------------- public: a share link

    /** Opening counts a view, so it is a POST (GET requests are read-only). */
    @PostMapping("/api/public/shares/{token}")
    public PublicDocument open(@PathVariable String token) {
        return documents.open(token);
    }

    @GetMapping("/api/public/shares/{token}/files/{fileId}")
    public ResponseEntity<byte[]> file(@PathVariable String token, @PathVariable Long fileId,
                                       @RequestParam(defaultValue = "false") boolean thumb,
                                       @RequestParam(defaultValue = "false") boolean download) {
        FileContent f = documents.file(token, fileId, thumb);
        boolean attach = download && documents.allowsDownload(token);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(f.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, (attach ? ContentDisposition.attachment() : ContentDisposition.inline())
                        .filename(f.fileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                .header("Referrer-Policy", "no-referrer")
                .cacheControl(CacheControl.noStore())
                .body(f.bytes());
    }
}
