package com.aditya.personalbudget.web;

import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.dto.JournalDtos.ExpenseRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.TenantRepository;
import com.aditya.personalbudget.security.ApprovalPolicy;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RolePolicy;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.AppSettingsService;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AccessLinkService;
import com.aditya.personalbudget.service.AccessLinkService.CreatedLink;
import com.aditya.personalbudget.service.AccessLinkService.LinkRequest;
import com.aditya.personalbudget.service.AccessLinkService.LinkView;
import com.aditya.personalbudget.service.ActivityService;
import com.aditya.personalbudget.service.ActivityService.ActivityView;
import com.aditya.personalbudget.service.PendingService;
import com.aditya.personalbudget.service.PendingService.ApproveRequest;
import com.aditya.personalbudget.service.PendingService.PendingView;
import com.aditya.personalbudget.service.PendingService.RejectRequest;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * The Activity page's data: the activity log, entries waiting for approval (maker-checker) and temporary access links.
 */
@RestController
public class AccessController {

    /** Clear the activity log: entries older than this many days (0 or empty: everything). */
    public record ClearRequest(@Min(0) Integer olderThanDays, boolean dryRun) {
    }

    /** Maker-checker settings: the household's mode, and the installation switch (super admin only). */
    public record ApprovalSettings(String mode, boolean globalEnabled, boolean canChangeGlobal, long pending) {
    }

    public record ApprovalModeRequest(@NotBlank String mode) {
    }

    public record ApprovalGlobalRequest(boolean enabled) {
    }

    private final AccessLinkService links;
    private final PendingService pending;
    private final ActivityService activity;
    private final TenantRepository tenants;
    private final ApprovalPolicy approvalPolicy;
    private final AppSettingsService appSettings;

    public AccessController(AccessLinkService links, PendingService pending, ActivityService activity,
                            TenantRepository tenants, ApprovalPolicy approvalPolicy, AppSettingsService appSettings) {
        this.tenants = tenants;
        this.approvalPolicy = approvalPolicy;
        this.appSettings = appSettings;
        this.links = links;
        this.pending = pending;
        this.activity = activity;
    }

    // ---------------------------------------------------------------- activity log

    @GetMapping("/api/activity")
    @RequiresPermission(Permission.APPROVE_ENTRIES)
    public List<ActivityView> activity(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String area,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "1000") int limit) {
        return activity.list(from, to, actor, area, q, limit);
    }

    /** Deletes older entries of the log (or only counts them, with dryRun). */
    @PostMapping("/api/activity/clear")
    @RequiresPermission(Permission.MANAGE_USERS)
    public Map<String, Object> clearActivity(@Valid @RequestBody ClearRequest request) {
        int days = request.olderThanDays() == null ? 0 : request.olderThanDays();
        LocalDate before = days <= 0 ? null : LocalDate.now().minusDays(days);
        long count = activity.clear(before, request.dryRun());
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("count", count);
        result.put("before", before);
        result.put("dryRun", request.dryRun());
        return result;
    }

    // ---------------------------------------------------------------- approvals (maker-checker)

    @GetMapping("/api/approvals")
    @RequiresPermission(Permission.APPROVE_ENTRIES)
    public List<PendingView> approvals(@RequestParam(defaultValue = "PENDING") String status) {
        return pending.list(status);
    }

    @GetMapping("/api/approvals/count")
    @RequiresPermission(Permission.APPROVE_ENTRIES)
    public Map<String, Long> pendingCount() {
        return Map.of("pending", pending.countPending());
    }

    /** What the current access link sent and what became of it. */
    @GetMapping("/api/approvals/mine")
    @RequiresPermission(Permission.VIEW)
    public List<PendingView> mine() {
        return pending.mine();
    }

    @PostMapping("/api/approvals/{id}/approve")
    @RequiresPermission(Permission.APPROVE_ENTRIES)
    public PendingView approve(@PathVariable Long id, @Valid @RequestBody(required = false) ApproveRequest request) {
        return pending.approve(id, request);
    }

    @PostMapping("/api/approvals/{id}/reject")
    @RequiresPermission(Permission.APPROVE_ENTRIES)
    public PendingView reject(@PathVariable Long id, @Valid @RequestBody(required = false) RejectRequest request) {
        return pending.reject(id, request);
    }

    /** The maker corrects a rejected (or still waiting) entry and sends it again. */
    @PostMapping("/api/approvals/{id}/resubmit")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PendingView resubmit(@PathVariable Long id, @Valid @RequestBody ExpenseRequest request) {
        return pending.resubmit(id, request);
    }

    /** The maker takes back an entry that waits or was rejected. */
    @PostMapping("/api/approvals/{id}/withdraw")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PendingView withdraw(@PathVariable Long id) {
        return pending.withdraw(id);
    }

    // ---------------------------------------------------------------- who needs approval

    @GetMapping("/api/admin/approval")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ApprovalSettings approvalSettings() {
        Tenant t = tenants.findById(UserContext.tenantId()).orElseThrow();
        return new ApprovalSettings(ApprovalPolicy.modeOf(t), approvalPolicy.enabledGlobally(),
                RolePolicy.allows(UserContext.get().role(), Permission.MANAGE_TENANTS), pending.countPending());
    }

    /** The household: OFF (nobody waits), LINKS (access links made with approval) or ALL (also users who cannot approve). */
    @PutMapping("/api/admin/approval")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ApprovalSettings setApprovalMode(@Valid @RequestBody ApprovalModeRequest request) {
        String mode = request.mode().trim().toUpperCase(java.util.Locale.ROOT);
        if (!ApprovalPolicy.MODES.contains(mode)) {
            throw new BusinessException("Approval is OFF, LINKS or ALL");
        }
        Tenant t = tenants.findById(UserContext.tenantId()).orElseThrow();
        String before = ApprovalPolicy.modeOf(t);
        t.setApprovalMode(mode);
        tenants.save(t);
        if (!before.equals(mode)) {
            activity.record("CHANGED", "Approvals", "Approval for the household: " + label(before) + " → " + label(mode));
        }
        return approvalSettings();
    }

    /** The whole installation (super admin): off means nothing waits for approval anywhere. */
    @PutMapping("/api/admin/approval/global")
    @RequiresPermission(Permission.MANAGE_TENANTS)
    public ApprovalSettings setApprovalGlobal(@RequestBody ApprovalGlobalRequest request) {
        boolean before = approvalPolicy.enabledGlobally();
        appSettings.setApprovalEnabled(request.enabled());
        if (before != request.enabled()) {
            activity.record("CHANGED", "Approvals", "Approval on the whole installation switched " + (request.enabled() ? "on" : "off"));
        }
        return approvalSettings();
    }

    private static String label(String mode) {
        return switch (mode) {
            case ApprovalPolicy.OFF -> "off";
            case ApprovalPolicy.ALL -> "links and users";
            default -> "access links only";
        };
    }

    // ---------------------------------------------------------------- access links

    @GetMapping("/api/admin/links")
    @RequiresPermission(Permission.MANAGE_USERS)
    public List<LinkView> links() {
        return links.list();
    }

    @PostMapping("/api/admin/links")
    @RequiresPermission(Permission.MANAGE_USERS)
    public CreatedLink create(@Valid @RequestBody LinkRequest request) {
        return links.create(request);
    }

    @PostMapping("/api/admin/links/{id}/revoke")
    @RequiresPermission(Permission.MANAGE_USERS)
    public LinkView revoke(@PathVariable Long id) {
        return links.revoke(id);
    }

    @PostMapping("/api/admin/links/revoke-all")
    @RequiresPermission(Permission.MANAGE_USERS)
    public Map<String, Integer> revokeAll() {
        return Map.of("revoked", links.revokeAll());
    }

    @DeleteMapping("/api/admin/links/{id}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        links.delete(id);
        return ResponseEntity.noContent().build();
    }
}
