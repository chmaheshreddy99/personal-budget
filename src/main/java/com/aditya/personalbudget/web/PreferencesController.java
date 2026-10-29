package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.OrgPreferencesService;
import com.aditya.personalbudget.service.OrgPreferencesService.Benchmark;
import com.aditya.personalbudget.service.OrgPreferencesService.BenchmarkRequest;
import com.aditya.personalbudget.service.OrgPreferencesService.MobilePolicyRequest;
import com.aditya.personalbudget.service.OrgPreferencesService.MobilePolicyView;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The organization's interest benchmark (what money given without interest could have earned) and the mobile app by
 * role (balances masked, sections, recording).
 */
@RestController
public class PreferencesController {

    private final OrgPreferencesService preferences;

    public PreferencesController(OrgPreferencesService preferences) {
        this.preferences = preferences;
    }

    /** Read by anyone who sees money paid for someone or lent: the rate their lost interest is worked out at. */
    @GetMapping("/api/claims/interest-benchmark")
    @RequiresPermission(Permission.VIEW)
    public Benchmark benchmark() {
        return preferences.benchmark();
    }

    @PutMapping("/api/admin/interest-benchmark")
    @RequiresPermission(Permission.MANAGE_USERS)
    public Benchmark saveBenchmark(@Valid @RequestBody BenchmarkRequest request) {
        return preferences.saveBenchmark(request);
    }

    @GetMapping("/api/admin/mobile-policy")
    @RequiresPermission(Permission.MANAGE_USERS)
    public MobilePolicyView mobilePolicy() {
        return preferences.mobilePolicy();
    }

    @PutMapping("/api/admin/mobile-policy")
    @RequiresPermission(Permission.MANAGE_USERS)
    public MobilePolicyView saveMobilePolicy(@RequestBody MobilePolicyRequest request) {
        return preferences.saveMobilePolicy(request);
    }
}
