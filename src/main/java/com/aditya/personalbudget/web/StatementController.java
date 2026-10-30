package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.StatementService;
import com.aditya.personalbudget.service.StatementService.Overview;
import com.aditya.personalbudget.service.StatementService.Rendered;
import com.aditya.personalbudget.service.StatementService.SendResult;
import com.aditya.personalbudget.service.StatementService.SubscriptionRequest;
import com.aditya.personalbudget.service.StatementService.SubscriptionView;
import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.YearMonth;
import java.util.List;

/** Monthly statements by e-mail (Settings, Statements): the organization's subscriptions, a preview PDF, and sending now. */
@RestController
@RequestMapping("/api/statements")
public class StatementController {

    private final StatementService statements;

    public StatementController(StatementService statements) {
        this.statements = statements;
    }

    @GetMapping
    @RequiresPermission(Permission.MANAGE_USERS)
    public Overview overview() {
        return statements.overview();
    }

    @PostMapping("/subscriptions")
    @RequiresPermission(Permission.MANAGE_USERS)
    public SubscriptionView create(@Valid @RequestBody SubscriptionRequest request) {
        return statements.create(request);
    }

    @PutMapping("/subscriptions/{id}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public SubscriptionView update(@PathVariable Long id, @Valid @RequestBody SubscriptionRequest request) {
        return statements.update(id, request);
    }

    @DeleteMapping("/subscriptions/{id}")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        statements.delete(id);
        return ResponseEntity.noContent().build();
    }

    /** Sends it now: the month given (yyyy-MM), or the month before. */
    @PostMapping("/subscriptions/{id}/send")
    @RequiresPermission(Permission.MANAGE_USERS)
    public SendResult send(@PathVariable Long id, @RequestParam(required = false) String month) {
        return statements.sendNow(id, month == null || month.isBlank() ? null : YearMonth.parse(month));
    }

    /** The statement as a PDF to look at (never locked): kind, the month (yyyy-MM) and, for the account statement, which accounts. */
    @GetMapping("/preview")
    @RequiresPermission(Permission.MANAGE_USERS)
    public ResponseEntity<byte[]> preview(@RequestParam String kind, @RequestParam String month, @RequestParam(required = false) List<Long> accounts) {
        Rendered r = statements.render(kind, YearMonth.parse(month), accounts == null ? List.of() : accounts, null);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(r.fileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(r.pdf());
    }
}
