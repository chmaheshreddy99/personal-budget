package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ChitShareService;
import com.aditya.personalbudget.service.ChitShareService.CreatedShare;
import com.aditya.personalbudget.service.ChitShareService.ShareRequest;
import com.aditya.personalbudget.service.ChitShareService.ShareView;
import com.aditya.personalbudget.service.ChitShareService.Statement;
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
 * Links to where a chit stands ({@code /api/chits/{id}/shares}), and the public side
 * ({@code /api/public/chit-statements/{token}}), which needs no sign-in, only the link's token.
 */
@RestController
public class ChitShareController {

    private final ChitShareService shares;

    public ChitShareController(ChitShareService shares) {
        this.shares = shares;
    }

    @GetMapping("/api/chits/{id}/shares")
    @RequiresPermission(Permission.VIEW)
    public List<ShareView> list(@PathVariable Long id) {
        return shares.list(id);
    }

    @PostMapping("/api/chits/{id}/shares")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public CreatedShare create(@PathVariable Long id, @Valid @RequestBody ShareRequest request) {
        return shares.create(id, request);
    }

    @PostMapping("/api/chits/{id}/shares/{shareId}/revoke")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ShareView revoke(@PathVariable Long id, @PathVariable Long shareId) {
        return shares.revoke(id, shareId);
    }

    /** The chit behind a link, as of now. POST: the view is counted, and nothing is cached. */
    @PostMapping("/api/public/chit-statements/{token}")
    public ResponseEntity<Statement> open(@PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(shares.open(token));
    }
}
