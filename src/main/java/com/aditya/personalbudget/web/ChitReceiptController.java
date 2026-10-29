package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ChitReceiptService;
import com.aditya.personalbudget.service.ChitReceiptService.AckRequest;
import com.aditya.personalbudget.service.ChitReceiptService.AckView;
import com.aditya.personalbudget.service.ChitReceiptService.CancelRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CreateRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PaperRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PayoutRequest;
import com.aditya.personalbudget.service.ChitReceiptService.CreatedLink;
import com.aditya.personalbudget.service.ChitReceiptService.DisputeRequest;
import com.aditya.personalbudget.service.ChitReceiptService.OpenRequest;
import com.aditya.personalbudget.service.ChitReceiptService.PublicAck;
import com.aditya.personalbudget.service.ChitReceiptService.RenewRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Acknowledgements of receipt for chit installments ({@code /api/chits/{id}/receipts}) and the organizer's side
 * ({@code /api/public/chit-receipts/{token}}), which needs no sign-in: only the link's token and the organizer's mobile
 * number.
 */
@RestController
public class ChitReceiptController {

    private final ChitReceiptService receipts;

    public ChitReceiptController(ChitReceiptService receipts) {
        this.receipts = receipts;
    }

    @GetMapping("/api/chits/{id}/receipts")
    @RequiresPermission(Permission.VIEW)
    public List<AckView> list(@PathVariable Long id) {
        return receipts.list(id);
    }

    /** One record in full: its document is read from disk now (the list above does not read them). */
    @GetMapping("/api/chits/{id}/receipts/{ackId}")
    @RequiresPermission(Permission.VIEW)
    public AckView one(@PathVariable Long id, @PathVariable Long ackId) {
        return receipts.get(id, ackId);
    }

    /** Asks the organizer to acknowledge the picked paid installments; the link comes back once. */
    @PostMapping("/api/chits/{id}/receipts")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink create(@PathVariable Long id, @Valid @RequestBody CreateRequest request) {
        return receipts.create(id, request);
    }

    /** Asks the organizer to acknowledge that the payout was received in full (and cancels the earlier acknowledgements). */
    @PostMapping("/api/chits/{id}/receipts/payout")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink payout(@PathVariable Long id, @Valid @RequestBody PayoutRequest request) {
        return receipts.createPayout(id, request);
    }

    /** Withdraws a signed record: kept, marked cancelled. */
    @PostMapping("/api/chits/{id}/receipts/{ackId}/cancel")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView cancel(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody CancelRequest request) {
        return receipts.cancel(id, ackId, request);
    }

    /** The organizer signed a printed copy. */
    @PostMapping("/api/chits/{id}/receipts/{ackId}/signed")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView signed(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody PaperRequest request) {
        return receipts.signedOnPaper(id, ackId, request);
    }

    @PostMapping(value = "/api/chits/{id}/receipts/{ackId}/scan", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView scan(@PathVariable Long id, @PathVariable Long ackId, @RequestPart("file") MultipartFile file) throws IOException {
        return receipts.addScan(id, ackId, file.getOriginalFilename(), file.getBytes());
    }

    @PostMapping("/api/chits/{id}/receipts/{ackId}/link")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink renew(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody RenewRequest request) {
        return receipts.renew(id, ackId, request);
    }

    @PostMapping("/api/chits/{id}/receipts/{ackId}/revoke")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView revoke(@PathVariable Long id, @PathVariable Long ackId) {
        return receipts.revoke(id, ackId);
    }

    @DeleteMapping("/api/chits/{id}/receipts/{ackId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> delete(@PathVariable Long id, @PathVariable Long ackId) {
        receipts.delete(id, ackId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/api/chits/{id}/receipts/{ackId}/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> file(@PathVariable Long id, @PathVariable Long ackId, @PathVariable Long fileId,
                                       @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(receipts.file(id, ackId, fileId, thumb));
    }

    // ---------------------------------------------------------------- the organizer (no sign-in)

    @PostMapping("/api/public/chit-receipts/{token}")
    public ResponseEntity<PublicAck> open(@PathVariable String token, @Valid @RequestBody(required = false) OpenRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(receipts.open(token, request));
    }

    @PostMapping(value = "/api/public/chit-receipts/{token}/selfie", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<PublicAck> selfie(@PathVariable String token, @RequestParam String phone,
                                            @RequestPart("file") MultipartFile file) throws IOException {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(receipts.addSelfie(token, phone, file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping("/api/public/chit-receipts/{token}/acknowledge")
    public ResponseEntity<PublicAck> acknowledge(@PathVariable String token, @Valid @RequestBody AckRequest request, HttpServletRequest http) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(receipts.acknowledge(token, request, ip(http), http.getHeader("User-Agent")));
    }

    @PostMapping("/api/public/chit-receipts/{token}/dispute")
    public ResponseEntity<PublicAck> dispute(@PathVariable String token, @Valid @RequestBody DisputeRequest request, HttpServletRequest http) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(receipts.dispute(token, request, ip(http)));
    }

    private static String ip(HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        return forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
    }
}
