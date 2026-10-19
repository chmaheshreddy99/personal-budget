package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.ClaimDtos.ClaimRequest;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimSummary;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentRequest;
import com.aditya.personalbudget.dto.ClaimDtos.WriteOffRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ClaimService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Money lent and bills paid on behalf of others ({@code /api/claims}), with repayments and write-offs.
 */
@RestController
@RequestMapping("/api/claims")
public class ClaimController {

    public record ClaimList(List<ClaimView> claims, ClaimSummary summary) {
    }

    private final ClaimService claims;

    public ClaimController(ClaimService claims) {
        this.claims = claims;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public ClaimList list() {
        List<ClaimView> all = claims.list();
        return new ClaimList(all, claims.summary(all));
    }

    @GetMapping("/{id}")
    @RequiresPermission(Permission.VIEW)
    public ClaimView get(@PathVariable Long id) {
        return claims.get(id);
    }

    /** The claim behind a journal entry (204 when the entry is not part of one). */
    @GetMapping("/by-entry/{entryId}")
    @RequiresPermission(Permission.VIEW)
    public ResponseEntity<ClaimView> byEntry(@PathVariable Long entryId) {
        return claims.byEntry(entryId).map(ResponseEntity::ok).orElse(ResponseEntity.noContent().build());
    }

    @PostMapping
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView create(@Valid @RequestBody ClaimRequest request) {
        return claims.create(request);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView update(@PathVariable Long id, @Valid @RequestBody ClaimRequest request) {
        return claims.update(id, request);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        claims.delete(id);
        return ResponseEntity.noContent().build();
    }

    /** Books every finished month of interest not posted yet. */
    @PostMapping("/{id}/interest")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView postInterest(@PathVariable Long id,
                                  @RequestBody(required = false) com.aditya.personalbudget.dto.ClaimDtos.PostInterestRequest request) {
        return request == null ? claims.postInterest(id, false)
                : claims.postInterest(id, false, request.upToPeriod(), request.accountId(), Boolean.TRUE.equals(request.makeDefault()),
                        Boolean.TRUE.equals(request.combine()));
    }

    /** When interest is collected (every month, every year, whenever paid) and whether it is booked automatically. */
    @PutMapping("/{id}/interest-plan")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView interestPlan(@PathVariable Long id,
                                  @Valid @RequestBody com.aditya.personalbudget.dto.ClaimDtos.InterestPlanRequest request) {
        return claims.setInterestPlan(id, request.collection(), request.autoPost());
    }

    /** The account interest is posted to by default (null: the account the item sits in). */
    @PutMapping("/{id}/interest-account")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView interestAccount(@PathVariable Long id,
                                     @RequestBody com.aditya.personalbudget.dto.ClaimDtos.InterestAccountRequest request) {
        return claims.setInterestAccount(id, request.accountId());
    }

    @DeleteMapping("/{id}/interest/{postingId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView undoInterest(@PathVariable Long id, @PathVariable Long postingId) {
        return claims.undoInterestPosting(id, postingId);
    }

    @PostMapping("/{id}/repayments")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView repay(@PathVariable Long id, @Valid @RequestBody RepaymentRequest request) {
        return claims.repay(id, request);
    }

    @DeleteMapping("/{id}/repayments/{repaymentId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView undoRepayment(@PathVariable Long id, @PathVariable Long repaymentId) {
        return claims.undoRepayment(id, repaymentId);
    }

    @PostMapping("/{id}/write-off")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ClaimView writeOff(@PathVariable Long id, @Valid @RequestBody WriteOffRequest request) {
        return claims.writeOff(id, request);
    }
}
