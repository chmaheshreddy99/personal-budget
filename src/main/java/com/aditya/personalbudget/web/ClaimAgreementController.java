package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ClaimAgreementService;
import com.aditya.personalbudget.service.ClaimAgreementService.AcceptRequest;
import com.aditya.personalbudget.service.ClaimAgreementService.AgreementRequest;
import com.aditya.personalbudget.service.ClaimAgreementService.AgreementView;
import com.aditya.personalbudget.service.ClaimAgreementService.CreatedLink;
import com.aditya.personalbudget.service.ClaimAgreementService.LinkRequest;
import com.aditya.personalbudget.service.ClaimAgreementService.OpenRequest;
import com.aditya.personalbudget.service.ClaimAgreementService.PaperRequest;
import com.aditya.personalbudget.service.ClaimAgreementService.PublicAgreement;
import com.aditya.personalbudget.service.ClaimAgreementService.SignedRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * Loan agreements of money lent ({@code /api/claims/{id}/agreement}) and the borrower's side
 * ({@code /api/public/loan-agreements/{token}}), which needs no sign-in: only the link's token and the borrower's
 * mobile number.
 */
@RestController
public class ClaimAgreementController {

    private final ClaimAgreementService agreements;

    public ClaimAgreementController(ClaimAgreementService agreements) {
        this.agreements = agreements;
    }

    @GetMapping("/api/claims/{id}/agreement")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<AgreementView> get(@PathVariable Long id) {
        AgreementView v = agreements.get(id);
        return v == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(v);
    }

    /** Makes the agreement, or remakes it while it waits for the borrower. */
    @PostMapping("/api/claims/{id}/agreement")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView save(@PathVariable Long id, @Valid @RequestBody AgreementRequest request) {
        return agreements.save(id, request);
    }

    @PutMapping("/api/claims/{id}/agreement/paper")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView paper(@PathVariable Long id, @Valid @RequestBody PaperRequest request) {
        return agreements.paper(id, request);
    }

    @PostMapping("/api/claims/{id}/agreement/link")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public CreatedLink link(@PathVariable Long id, @Valid @RequestBody LinkRequest request) {
        return agreements.link(id, request);
    }

    @PostMapping("/api/claims/{id}/agreement/link/revoke")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView revoke(@PathVariable Long id) {
        return agreements.revokeLink(id);
    }

    @PostMapping("/api/claims/{id}/agreement/signed")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView signed(@PathVariable Long id, @Valid @RequestBody SignedRequest request) {
        return agreements.signedOnPaper(id, request);
    }

    @DeleteMapping("/api/claims/{id}/agreement")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        agreements.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping(value = "/api/claims/{id}/agreement/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView addFile(@PathVariable Long id, @RequestParam String docType, @RequestPart("file") MultipartFile file,
                                 @RequestParam(required = false) String source) throws IOException {
        return agreements.addFile(id, docType, file.getOriginalFilename(), file.getBytes(), source);
    }

    @DeleteMapping("/api/claims/{id}/agreement/files/{fileId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public AgreementView deleteFile(@PathVariable Long id, @PathVariable Long fileId) {
        return agreements.deleteFile(id, fileId);
    }

    @GetMapping("/api/claims/{id}/agreement/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> file(@PathVariable Long id, @PathVariable Long fileId, @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(agreements.file(id, fileId, thumb));
    }

    // ---------------------------------------------------------------- the borrower (no sign-in)

    @PostMapping("/api/public/loan-agreements/{token}")
    public ResponseEntity<PublicAgreement> open(@PathVariable String token, @Valid @RequestBody(required = false) OpenRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(agreements.open(token, request));
    }

    @PostMapping(value = "/api/public/loan-agreements/{token}/kyc", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<PublicAgreement> kyc(@PathVariable String token, @RequestParam String phone, @RequestParam String docType,
                                               @RequestPart("file") MultipartFile file) throws IOException {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(agreements.addKyc(token, phone, docType, file.getOriginalFilename(), file.getBytes()));
    }

    @PostMapping("/api/public/loan-agreements/{token}/accept")
    public ResponseEntity<PublicAgreement> accept(@PathVariable String token, @Valid @RequestBody AcceptRequest request, HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(agreements.accept(token, request, ip, http.getHeader("User-Agent")));
    }
}
