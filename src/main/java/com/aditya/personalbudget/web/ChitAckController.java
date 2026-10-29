package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ChitAckService;
import com.aditya.personalbudget.service.ChitAckService.AcceptRequest;
import com.aditya.personalbudget.service.ChitAckService.AckView;
import com.aditya.personalbudget.service.ChitAckService.CreatedLink;
import com.aditya.personalbudget.service.ChitAckService.LinkRequest;
import com.aditya.personalbudget.service.ChitAckService.OpenRequest;
import com.aditya.personalbudget.service.ChitAckService.PaperRequest;
import com.aditya.personalbudget.service.ChitAckService.PaperSignedRequest;
import com.aditya.personalbudget.service.ChitAckService.PublicAck;
import com.aditya.personalbudget.service.ChitAckService.ReceiptRequest;
import com.aditya.personalbudget.service.ChitAckService.SettlementRequest;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Payment receipts and the payout settlement of a chit the household is a member of ({@code /api/chits/{id}/acks}),
 * and the organizer's side ({@code /api/public/chit-receipts/{token}}), which needs no sign-in: only the link's token
 * (and the organizer's mobile number, when one is on record).
 */
@RestController
public class ChitAckController {

    private final ChitAckService acks;

    public ChitAckController(ChitAckService acks) {
        this.acks = acks;
    }

    @GetMapping("/api/chits/{id}/acks")
    @RequiresPermission(Permission.VIEW)
    public List<AckView> list(@PathVariable Long id) {
        return acks.list(id);
    }

    @GetMapping("/api/chits/{id}/acks/{ackId}")
    @RequiresPermission(Permission.VIEW)
    public AckView get(@PathVariable Long id, @PathVariable Long ackId) {
        return acks.get(id, ackId);
    }

    /** A receipt for the chosen paid installments (with a link when hours are given). */
    @PostMapping("/api/chits/{id}/acks/receipt")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink receipt(@PathVariable Long id, @Valid @RequestBody ReceiptRequest request) {
        return acks.createReceipt(id, request);
    }

    /** The full and final settlement once the payout is in. */
    @PostMapping("/api/chits/{id}/acks/settlement")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink settlement(@PathVariable Long id, @Valid @RequestBody SettlementRequest request) {
        return acks.createSettlement(id, request);
    }

    /** A new link; a signed one is asked for again. */
    @PostMapping("/api/chits/{id}/acks/{ackId}/resend")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedLink resend(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody LinkRequest request) {
        return acks.resend(id, ackId, request);
    }

    @PostMapping("/api/chits/{id}/acks/{ackId}/revoke")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView revoke(@PathVariable Long id, @PathVariable Long ackId) {
        return acks.revokeLink(id, ackId);
    }

    @PutMapping("/api/chits/{id}/acks/{ackId}/paper")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView paper(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody PaperRequest request) {
        return acks.paper(id, ackId, request);
    }

    @PostMapping("/api/chits/{id}/acks/{ackId}/signed")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public AckView signed(@PathVariable Long id, @PathVariable Long ackId, @Valid @RequestBody PaperSignedRequest request) {
        return acks.signedOnPaper(id, ackId, request);
    }

    @DeleteMapping("/api/chits/{id}/acks/{ackId}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> delete(@PathVariable Long id, @PathVariable Long ackId) {
        acks.delete(id, ackId);
        return ResponseEntity.noContent().build();
    }

    // ---------------------------------------------------------------- the organizer (no sign-in)

    @PostMapping("/api/public/chit-receipts/{token}")
    public ResponseEntity<PublicAck> open(@PathVariable String token, @Valid @RequestBody(required = false) OpenRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(acks.open(token, request));
    }

    @PostMapping("/api/public/chit-receipts/{token}/accept")
    public ResponseEntity<PublicAck> accept(@PathVariable String token, @Valid @RequestBody AcceptRequest request, HttpServletRequest http) {
        String forwarded = http.getHeader("X-Forwarded-For");
        String ip = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(acks.accept(token, request, ip, http.getHeader("User-Agent")));
    }
}
