package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AppSyncService;
import com.aditya.personalbudget.service.AppSyncService.Snapshot;
import com.aditya.personalbudget.service.AppSyncService.Statement;
import com.aditya.personalbudget.service.AppSyncService.SyncRequest;
import com.aditya.personalbudget.service.AppSyncService.SyncResult;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The phone app ({@code mobile-app/}): the snapshot it keeps offline, account statements, and the expenses it
 * recorded offline synced in one go (each once, by the app's own id). Signing in is {@code POST /api/auth/login};
 * {@code GET /api/meta/app} (no sign-in) tells the app the server is reachable.
 */
@RestController
@RequestMapping("/api/app")
@RequiresPermission(Permission.VIEW)
public class AppController {

    private final AppSyncService app;

    public AppController(AppSyncService app) {
        this.app = app;
    }

    @GetMapping("/snapshot")
    public Snapshot snapshot(@RequestParam(defaultValue = "90") int days) {
        return app.snapshot(days);
    }

    @GetMapping("/accounts/{id}/statement")
    public Statement statement(@PathVariable Long id, @RequestParam(defaultValue = "90") int days) {
        return app.statement(id, days);
    }

    @PostMapping("/expenses/sync")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public List<SyncResult> sync(@Valid @RequestBody SyncRequest request) {
        return app.sync(request);
    }
}
