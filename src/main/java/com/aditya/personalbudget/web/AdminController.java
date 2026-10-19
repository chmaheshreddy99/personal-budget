package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.UserDtos.TenantRequest;
import com.aditya.personalbudget.dto.UserDtos.TenantView;
import com.aditya.personalbudget.dto.UserDtos.UserRequest;
import com.aditya.personalbudget.dto.UserDtos.UserView;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AppSettingsService;
import com.aditya.personalbudget.service.UserService;
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
 * Users of the current tenant, and tenants of the platform.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserService users;
    private final AppSettingsService appSettings;
    private final com.aditya.personalbudget.service.TenantMailService mail;

    private final com.aditya.personalbudget.service.HostedChitService chits;

    public AdminController(UserService users, AppSettingsService appSettings, com.aditya.personalbudget.service.TenantMailService mail,
                           com.aditya.personalbudget.service.HostedChitService chits) {
        this.chits = chits;
        this.mail = mail;
        this.users = users;
        this.appSettings = appSettings;
    }

    /** The address of the mobile version (the whole installation). */
    @PutMapping("/app-settings")
    @RequiresPermission(Permission.MANAGE_USERS)
    public AppSettingsService.AppSettings updateAppSettings(@RequestBody AppSettingsService.AppSettings settings) {
        return appSettings.update(settings);
    }

    /** Host a Chit: the household's chit-funds company name, which new chits are named after. */
    @PutMapping("/chit-settings")
    @RequiresPermission(Permission.MANAGE_USERS)
    public com.aditya.personalbudget.service.HostedChitService.ChitSettings saveChitSettings(
            @jakarta.validation.Valid @RequestBody com.aditya.personalbudget.service.HostedChitService.ChitSettingsRequest request) {
        return chits.saveChitSettings(request);
    }

    /** The household's own e-mail account for chit reminders and receipts (password never returned). */
    @GetMapping("/mail-settings")
    @RequiresPermission(Permission.MANAGE_USERS)
    public com.aditya.personalbudget.service.TenantMailService.MailSettingsView mailSettings() {
        return mail.view();
    }

    @PutMapping("/mail-settings")
    @RequiresPermission(Permission.MANAGE_USERS)
    public com.aditya.personalbudget.service.TenantMailService.MailSettingsView saveMailSettings(
            @jakarta.validation.Valid @RequestBody com.aditya.personalbudget.service.TenantMailService.MailSettingsRequest request) {
        return mail.save(request);
    }

    @PostMapping("/mail-settings/test")
    @RequiresPermission(Permission.MANAGE_USERS)
    public com.aditya.personalbudget.service.TenantMailService.MailSettingsView testMailSettings(
            @jakarta.validation.Valid @RequestBody com.aditya.personalbudget.service.TenantMailService.TestRequest request) {
        return mail.test(request);
    }

    /** The sections (menu items) the signed-in user's organization has: what can be shared with its users. */
    @GetMapping("/organization/sections")
    @RequiresPermission(Permission.MANAGE_USERS)
    public java.util.Set<com.aditya.personalbudget.domain.type.Feature> organizationSections() {
        return users.organizationSections();
    }

    @GetMapping("/users")
    @RequiresPermission(Permission.MANAGE_USERS)
    public List<UserView> users() {
        return users.list();
    }

    @PostMapping("/users")
    @RequiresPermission(Permission.MANAGE_USERS)
    public UserView createUser(@Valid @RequestBody UserRequest request) {
        return users.create(request);
    }

    @PutMapping("/users/{id}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public UserView updateUser(@PathVariable Long id, @Valid @RequestBody UserRequest request) {
        return users.update(id, request);
    }

    /** Maker-checker for one user: TENANT (follow the household), REQUIRED or EXEMPT. */
    public record UserApprovalRequest(String approval) {
    }

    @PutMapping("/users/{id}/approval")
    @RequiresPermission(Permission.MANAGE_USERS)
    public UserView userApproval(@PathVariable Long id, @RequestBody UserApprovalRequest request) {
        return users.setApproval(id, request.approval());
    }

    @DeleteMapping("/users/{id}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        users.delete(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/tenants")
    @RequiresPermission(Permission.MANAGE_TENANTS)
    public List<TenantView> tenants() {
        return users.tenants();
    }

    @PostMapping("/tenants")
    @RequiresPermission(Permission.MANAGE_TENANTS)
    public ResponseEntity<Void> createTenant(@Valid @RequestBody TenantRequest request) {
        users.createTenant(request);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/tenants/{id}")
    @RequiresPermission(Permission.MANAGE_TENANTS)
    public ResponseEntity<Void> updateTenant(@PathVariable Long id, @Valid @RequestBody TenantRequest request) {
        users.updateTenant(id, request);
        return ResponseEntity.noContent().build();
    }
}
