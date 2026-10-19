package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ClaimShareService;
import com.aditya.personalbudget.service.ClaimShareService.CreatedShare;
import com.aditya.personalbudget.service.ClaimShareService.ShareRequest;
import com.aditya.personalbudget.service.ClaimShareService.ShareView;
import com.aditya.personalbudget.service.ClaimShareService.Statement;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Statement links of money lent or borrowed ({@code /api/claims/{id}/shares}), and the public side
 * ({@code /api/public/statements/{token}}), which needs no sign-in, only the link's token.
 */
@RestController
public class ClaimShareController {

    private final ClaimShareService shares;

    public ClaimShareController(ClaimShareService shares) {
        this.shares = shares;
    }

    @GetMapping("/api/claims/{id}/shares")
    @RequiresPermission(Permission.VIEW)
    public List<ShareView> list(@PathVariable Long id) {
        return shares.list(id);
    }

    @PostMapping("/api/claims/{id}/shares")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public CreatedShare create(@PathVariable Long id, @Valid @RequestBody ShareRequest request) {
        return shares.create(id, request);
    }

    @PostMapping("/api/claims/{id}/shares/{shareId}/revoke")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ShareView revoke(@PathVariable Long id, @PathVariable Long shareId) {
        return shares.revoke(id, shareId);
    }

    /** The statement behind a link, as of now. POST: the view is counted, and nothing is cached. */
    @PostMapping("/api/public/statements/{token}")
    public ResponseEntity<Statement> open(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(shares.open(token));
    }
}
