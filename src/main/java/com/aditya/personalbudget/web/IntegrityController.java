package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.LedgerIntegrityService;
import com.aditya.personalbudget.service.LedgerIntegrityService.Issue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Data integrity (admins only): the issues found in the books, and taking out a left-behind chit posting once an
 * admin has looked at it. Nothing is ever removed automatically.
 */
@RestController
@RequestMapping("/api/integrity")
public class IntegrityController {

    private final LedgerIntegrityService integrity;

    public IntegrityController(LedgerIntegrityService integrity) {
        this.integrity = integrity;
    }

    @GetMapping
    @RequiresPermission(Permission.DATA_INTEGRITY)
    public List<Issue> issues() {
        return integrity.check();
    }

    @PostMapping("/entries/{entryId}/remove")
    @RequiresPermission(Permission.DATA_INTEGRITY)
    public Issue remove(@PathVariable Long entryId) {
        return integrity.remove(entryId);
    }
}
