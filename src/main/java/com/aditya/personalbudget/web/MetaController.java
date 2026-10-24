package com.aditya.personalbudget.web;

import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Frequency;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RolePolicy;
import com.aditya.personalbudget.service.AppSettingsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Static reference data for the UI (drop-down options, role matrix). No sign-in required.
 */
@RestController
@RequestMapping("/api/meta")
public class MetaController {

    private final AppSettingsService appSettings;
    private final com.aditya.personalbudget.service.OrganizationBrandService brand;

    public MetaController(AppSettingsService appSettings, com.aditya.personalbudget.service.OrganizationBrandService brand) {
        this.appSettings = appSettings;
        this.brand = brand;
    }

    /** An organization's logo, at the address the apps were given (its hash in it, so it is kept for good). */
    @GetMapping("/brand-logo/{tenantId}/{hash}")
    public org.springframework.http.ResponseEntity<byte[]> brandLogo(@org.springframework.web.bind.annotation.PathVariable Long tenantId,
                                                                     @org.springframework.web.bind.annotation.PathVariable String hash) {
        com.aditya.personalbudget.service.OrganizationBrandService.Logo logo = brand.logo(tenantId, hash);
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.parseMediaType(logo.contentType()))
                .cacheControl(org.springframework.http.CacheControl.maxAge(java.time.Duration.ofDays(365)).cachePublic().immutable())
                .header("X-Content-Type-Options", "nosniff")
                .body(logo.bytes());
    }

    public record Option(String value, String label, String group, String description) {
    }

    public record Options(List<Option> accountClasses, List<Option> accountTypes, List<Option> voucherTypes,
                          List<Option> frequencies, List<Option> roles, List<Option> permissions,
                          Map<String, List<String>> roleMatrix) {
    }

    /** Installation settings anyone may know before signing in: where the mobile version lives. */
    /**
     * What a phone app asks before signing in (no sign-in needed): where the mobile version lives, and which version of
     * the Bricks app's server side this is, so the app can say when the server needs updating. 2: notices from the app
     * reach their maker's web app, documents (brick-doc.html), the pay run.
     */
    public record AppInfo(String mobilePath, int bricksApp) {
    }

    public static final int BRICKS_APP = 2;

    @GetMapping("/app")
    public AppInfo app() {
        return new AppInfo(appSettings.get().mobilePath(), BRICKS_APP);
    }

    @GetMapping("/options")
    public Options options() {
        List<Option> classes = Arrays.stream(AccountClass.values())
                .map(c -> new Option(c.name(), c.getLabel(), null, null)).toList();
        List<Option> types = Arrays.stream(AccountType.values())
                .map(t -> new Option(t.name(), t.getLabel(), t.getAccountClass().name(), t.isLiquid() ? "liquid" : null))
                .toList();
        List<Option> vouchers = Arrays.stream(VoucherType.values())
                .map(v -> new Option(v.name(), v.getLabel(), v.getPrefix(), null)).toList();
        List<Option> frequencies = Arrays.stream(Frequency.values())
                .map(f -> new Option(f.name(), f.getLabel(), null, null)).toList();
        List<Option> roles = Arrays.stream(UserRole.values())
                .map(r -> new Option(r.name(), r.getLabel(), null, r.getDescription())).toList();
        List<Option> permissions = Arrays.stream(Permission.values())
                .map(p -> new Option(p.name(), p.name().replace('_', ' '), null, p.getDescription())).toList();
        Map<String, List<String>> matrix = new java.util.LinkedHashMap<>();
        for (UserRole role : UserRole.values()) {
            matrix.put(role.name(), RolePolicy.permissionsOf(role).stream().map(Enum::name).toList());
        }
        return new Options(classes, types, vouchers, frequencies, roles, permissions, matrix);
    }
}
