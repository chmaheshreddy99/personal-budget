package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.HostedChitMailService;
import com.aditya.personalbudget.service.HostedChitService;
import com.aditya.personalbudget.service.HostedChitService.SignatureRequest;
import com.aditya.personalbudget.service.HostedChitShareService;
import com.aditya.personalbudget.service.HostedChitService.AgreementRequest;
import com.aditya.personalbudget.service.HostedChitShareService.AcceptRequest;
import com.aditya.personalbudget.service.HostedChitShareService.BatchLink;
import com.aditya.personalbudget.service.HostedChitShareService.BatchRequest;
import com.aditya.personalbudget.service.HostedChitShareService.CreatedShare;
import com.aditya.personalbudget.service.HostedChitShareService.PublicChit;
import com.aditya.personalbudget.service.HostedChitShareService.ShareRequest;
import com.aditya.personalbudget.service.HostedChitShareService.ShareView;
import com.aditya.personalbudget.service.HostedChitService.ChitRequest;
import com.aditya.personalbudget.service.HostedChitService.ChitView;
import com.aditya.personalbudget.service.HostedChitService.CollectAllRequest;
import com.aditya.personalbudget.service.HostedChitService.Detail;
import com.aditya.personalbudget.service.HostedChitService.MemberInput;
import com.aditya.personalbudget.service.HostedChitService.PaymentRequest;
import com.aditya.personalbudget.service.HostedChitService.PayoutRequest;
import com.aditya.personalbudget.service.HostedChitService.Summary;
import com.aditya.personalbudget.service.HostedChitService.WinnerRequest;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Host a Chit: chits the user runs as the organiser (see {@link HostedChitService}), their share links
 * ({@link HostedChitShareService}) and the public side of a link ({@code /api/public/hosted-chits/…}), which needs
 * no sign-in, only the link's token.
 */
@RestController
@RequestMapping("/api")
public class HostedChitController {

    private final HostedChitService service;
    private final HostedChitShareService shares;
    private final HostedChitMailService mail;

    public HostedChitController(HostedChitService service, HostedChitShareService shares, HostedChitMailService mail) {
        this.service = service;
        this.shares = shares;
        this.mail = mail;
    }

    @GetMapping("/hosted-chits")
    @RequiresPermission(Permission.VIEW)
    public List<ChitView> list() {
        return service.list();
    }

    /** Dues still to collect across the running hosted chits (dashboard). */
    @GetMapping("/hosted-chits/summary")
    @RequiresPermission(Permission.VIEW)
    public Summary summary() {
        return service.summary();
    }

    /** The household's chit-funds company name, for naming new chits (set by an admin in Settings). */
    @GetMapping("/hosted-chits/settings")
    @RequiresPermission(Permission.VIEW)
    public HostedChitService.ChitSettings chitSettings() {
        var s = service.chitSettings();
        return new HostedChitService.ChitSettings(s.companyName(), s.householdName(), shares.keyFingerprint());
    }

    @GetMapping("/hosted-chits/{id}")
    @RequiresPermission(Permission.VIEW)
    public Detail detail(@PathVariable Long id) {
        return service.detail(id);
    }

    @PostMapping("/hosted-chits")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail create(@Valid @RequestBody ChitRequest request) {
        return service.create(request);
    }

    @PutMapping("/hosted-chits/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail update(@PathVariable Long id, @Valid @RequestBody ChitRequest request) {
        return service.update(id, request);
    }

    @DeleteMapping("/hosted-chits/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> delete(@PathVariable Long id, @RequestParam(defaultValue = "false") boolean revert,
                                       @RequestParam(required = false) String confirm) {
        service.delete(id, revert, confirm);
        return ResponseEntity.noContent().build();
    }

    /** Hosted chits for the Reports page. */
    @GetMapping("/hosted-chits/report")
    @RequiresPermission(Permission.VIEW)
    public HostedChitService.Report report(@RequestParam(required = false) java.time.LocalDate from,
                                           @RequestParam(required = false) java.time.LocalDate to) {
        return service.report(from, to);
    }

    @PutMapping("/hosted-chits/{id}/members/{memberId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail updateMember(@PathVariable Long id, @PathVariable Long memberId, @Valid @RequestBody MemberInput request) {
        return service.updateMember(id, memberId, request);
    }

    // ---------------------------------------------------------------- collections

    @PostMapping("/hosted-chits/{id}/payments")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail addPayment(@PathVariable Long id, @Valid @RequestBody PaymentRequest request) {
        return service.addPayment(id, request);
    }

    @PutMapping("/hosted-chits/{id}/payments/{paymentId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail updatePayment(@PathVariable Long id, @PathVariable Long paymentId, @Valid @RequestBody PaymentRequest request) {
        return service.updatePayment(id, paymentId, request);
    }

    @DeleteMapping("/hosted-chits/{id}/payments/{paymentId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail deletePayment(@PathVariable Long id, @PathVariable Long paymentId) {
        return service.deletePayment(id, paymentId);
    }

    @PostMapping("/hosted-chits/{id}/months/{monthNo}/collect-all")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail collectAll(@PathVariable Long id, @PathVariable int monthNo, @RequestBody(required = false) CollectAllRequest request) {
        return service.collectAll(id, monthNo, request);
    }

    /** Planned chits: changes the chit table (what members pay and what the winner gets, month by month). */
    @PutMapping("/hosted-chits/{id}/plan")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail updatePlan(@PathVariable Long id, @Valid @RequestBody HostedChitService.PlanRequest request) {
        return service.updatePlan(id, request);
    }

    /** Undoes the payments recorded together by "Everyone has paid". */
    @DeleteMapping("/hosted-chits/{id}/months/{monthNo}/batches/{batchId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail revertBatch(@PathVariable Long id, @PathVariable int monthNo, @PathVariable String batchId) {
        return service.revertBatch(id, monthNo, batchId);
    }

    // ---------------------------------------------------------------- winner and payout

    @PostMapping("/hosted-chits/{id}/months/{monthNo}/winner")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail setWinner(@PathVariable Long id, @PathVariable int monthNo, @Valid @RequestBody WinnerRequest request) {
        return service.setWinner(id, monthNo, request);
    }

    @DeleteMapping("/hosted-chits/{id}/months/{monthNo}/winner")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail clearWinner(@PathVariable Long id, @PathVariable int monthNo) {
        return service.clearWinner(id, monthNo);
    }

    @PostMapping("/hosted-chits/{id}/months/{monthNo}/payout")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail payout(@PathVariable Long id, @PathVariable int monthNo, @RequestBody PayoutRequest request) {
        return service.payout(id, monthNo, request);
    }

    @DeleteMapping("/hosted-chits/{id}/months/{monthNo}/payout")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail undoPayout(@PathVariable Long id, @PathVariable int monthNo) {
        return service.undoPayout(id, monthNo);
    }

    /** Changes a payout already made (date, accounts it was paid from, references, where the commission came from). */
    @PutMapping("/hosted-chits/{id}/months/{monthNo}/payout")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail updatePayout(@PathVariable Long id, @PathVariable int monthNo, @RequestBody PayoutRequest request) {
        return service.updatePayout(id, monthNo, request);
    }

    /** After the payout: the month's commission into the chit's commission account, and optionally on to my bank. */
    @PostMapping("/hosted-chits/{id}/months/{monthNo}/commission-move")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail moveCommission(@PathVariable Long id, @PathVariable int monthNo, @Valid @RequestBody HostedChitService.CommissionMoveRequest request) {
        return service.moveCommission(id, monthNo, request);
    }

    @DeleteMapping("/hosted-chits/{id}/months/{monthNo}/commission-move")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail undoCommissionMove(@PathVariable Long id, @PathVariable int monthNo) {
        return service.undoCommissionMove(id, monthNo);
    }

    // ---------------------------------------------------------------- closing

    /** Closes a finished chit: nothing in it changes until it is re-opened. */
    @PostMapping("/hosted-chits/{id}/close")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail close(@PathVariable Long id, @Valid @RequestBody(required = false) HostedChitService.CloseRequest request) {
        return service.close(id, request);
    }

    @PostMapping("/hosted-chits/{id}/reopen")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail reopen(@PathVariable Long id) {
        return service.reopen(id);
    }

    // ---------------------------------------------------------------- share links

    @GetMapping("/hosted-chits/{id}/shares")
    @RequiresPermission(Permission.VIEW)
    public List<ShareView> shares(@PathVariable Long id) {
        return shares.list(id);
    }

    @PostMapping("/hosted-chits/{id}/shares")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedShare share(@PathVariable Long id, @Valid @RequestBody ShareRequest request) {
        return shares.create(id, request);
    }

    @PostMapping("/hosted-chits/{id}/shares/{shareId}/revoke")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ShareView revokeShare(@PathVariable Long id, @PathVariable Long shareId) {
        return shares.revoke(id, shareId);
    }

    /** Statement links with the UPI pay button for several members (reminders). */
    @PostMapping("/hosted-chits/{id}/shares/batch")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public List<BatchLink> shareBatch(@PathVariable Long id, @Valid @RequestBody BatchRequest request) {
        return shares.batch(id, request);
    }

    // ---------------------------------------------------------------- signed receipts and sending

    @PutMapping("/hosted-chits/{id}/receipt-signature")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail receiptSignature(@PathVariable Long id, @Valid @RequestBody SignatureRequest request) {
        return service.setReceiptSignature(id, request);
    }

    /** The signed receipt (organiser's signature and seal). */
    @GetMapping("/hosted-chits/{id}/payments/{paymentId}/receipt")
    @RequiresPermission(Permission.VIEW)
    public HostedChitShareService.PublicReceipt receipt(@PathVariable Long id, @PathVariable Long paymentId) {
        return shares.receipt(service.detail(id), paymentId);
    }

    @GetMapping("/hosted-chits/{id}/payments/{paymentId}/receipt.pdf")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> receiptPdf(@PathVariable Long id, @PathVariable Long paymentId) {
        return pdf(shares.receiptPdf(id, paymentId), "receipt-" + paymentId + ".pdf");
    }

    /** Whether e-mail is set up (spring.mail.*), so reminders and receipts can go out by e-mail. */
    @GetMapping("/hosted-chits/mail-status")
    @RequiresPermission(Permission.VIEW)
    public HostedChitMailService.MailStatus mailStatus() {
        return mail.status();
    }

    /** E-mails a batch of reminders or receipts (receipts carry the signed PDF). */
    @PostMapping("/hosted-chits/{id}/send-email")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public HostedChitMailService.SendResult sendEmail(@PathVariable Long id, @Valid @RequestBody HostedChitMailService.SendRequest request) {
        return mail.send(id, request);
    }

    private static ResponseEntity<byte[]> pdf(byte[] bytes, String name) {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + name + "\"")
                .body(bytes);
    }

    // ---------------------------------------------------------------- digital agreements

    @PostMapping("/hosted-chits/{id}/months/{monthNo}/agreement")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail createAgreement(@PathVariable Long id, @PathVariable int monthNo, @Valid @RequestBody AgreementRequest request) {
        return service.createAgreement(id, monthNo, request);
    }

    @DeleteMapping("/hosted-chits/{id}/agreements/{agreementId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail deleteAgreement(@PathVariable Long id, @PathVariable Long agreementId) {
        return service.deleteAgreement(id, agreementId);
    }

    public record SignedRequest(@jakarta.validation.constraints.Size(max = 100) String name) {
    }

    @PostMapping("/hosted-chits/{id}/agreements/{agreementId}/signed")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail agreementSigned(@PathVariable Long id, @PathVariable Long agreementId, @RequestBody SignedRequest request) {
        return service.markAgreementSigned(id, agreementId, request.name());
    }

    /** The stamp-paper copy: stamp, signatures, witness and the member's ID numbers. */
    @PutMapping("/hosted-chits/{id}/agreements/{agreementId}/bond")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail agreementBond(@PathVariable Long id, @PathVariable Long agreementId, @Valid @RequestBody HostedChitService.BondRequest request) {
        return service.setBond(id, agreementId, request);
    }

    /** Adds the member's Aadhaar, PAN or photo to the agreement (docType AADHAAR_FRONT, AADHAAR_BACK, PAN, SELFIE or OTHER). */
    @PostMapping(value = "/hosted-chits/{id}/agreements/{agreementId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail agreementFile(@PathVariable Long id, @PathVariable Long agreementId, @RequestParam String docType,
                                @org.springframework.web.bind.annotation.RequestPart("file") org.springframework.web.multipart.MultipartFile file,
                                @RequestParam(required = false) String source) throws java.io.IOException {
        return service.addAgreementFile(id, agreementId, docType, file.getOriginalFilename(), file.getBytes(), source);
    }

    @DeleteMapping("/hosted-chits/{id}/agreements/{agreementId}/files/{fileId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public Detail deleteAgreementFile(@PathVariable Long id, @PathVariable Long agreementId, @PathVariable Long fileId) {
        return service.deleteAgreementFile(id, agreementId, fileId);
    }

    @GetMapping("/hosted-chits/{id}/agreements/{agreementId}/files/{fileId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<byte[]> agreementFileContent(@PathVariable Long id, @PathVariable Long agreementId, @PathVariable Long fileId,
                                                       @RequestParam(defaultValue = "false") boolean thumb) {
        return AgreementFiles.inline(service.agreementFile(id, agreementId, fileId, thumb));
    }

    // ---------------------------------------------------------------- public side (no sign-in)

    /** The page behind a share link. */
    @PostMapping("/public/hosted-chits/{token}")
    public PublicChit openShare(@PathVariable String token) {
        return shares.open(token);
    }

    /** Checks the payment details on a member's link: the organiser's signature, and that they are still current. */
    @PostMapping("/public/hosted-chits/{token}/verify-pay-to")
    public HostedChitShareService.PayToCheck verifyPayTo(@PathVariable String token, @RequestBody java.util.Map<String, String> body) {
        return shares.checkPayTo(token, body.get("payload"), body.get("signature"));
    }

    /** The signed receipt behind a receipt link, as a PDF. */
    @GetMapping("/public/hosted-chits/{token}/receipt.pdf")
    public ResponseEntity<byte[]> publicReceiptPdf(@PathVariable String token) {
        return pdf(shares.publicReceiptPdf(token), "receipt.pdf");
    }

    /** The member adds their Aadhaar or PAN card (or a selfie) on the agreement link. */
    @PostMapping(value = "/public/hosted-chits/{token}/kyc", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public PublicChit addKyc(@PathVariable String token, @RequestParam String docType,
                             @org.springframework.web.bind.annotation.RequestPart("file") org.springframework.web.multipart.MultipartFile file) throws java.io.IOException {
        return shares.addKyc(token, docType, file.getOriginalFilename(), file.getBytes());
    }

    /** The member accepts the agreement behind the link; when, from where and as whom is recorded. */
    @PostMapping("/public/hosted-chits/{token}/accept")
    public PublicChit acceptAgreement(@PathVariable String token, @Valid @RequestBody AcceptRequest request,
                                      jakarta.servlet.http.HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        return shares.accept(token, request, ip, http.getHeader("User-Agent"));
    }
}
