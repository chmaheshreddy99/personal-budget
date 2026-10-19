package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.EmiService;
import com.aditya.personalbudget.service.EmiService.AutoRequest;
import com.aditya.personalbudget.service.EmiService.Book;
import com.aditya.personalbudget.service.EmiService.EmiRequest;
import com.aditya.personalbudget.service.EmiService.ForecloseRequest;
import com.aditya.personalbudget.service.EmiService.PayRequest;
import com.aditya.personalbudget.service.EmiService.PlanView;
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

/** Things bought on EMI, card or loan ({@code /api/expenses/emis}): the plans, paying, undoing and paying off early. */
@RestController
@RequestMapping("/api/expenses/emis")
@RequiresPermission(Permission.VIEW)
public class EmiController {

    private final EmiService emis;

    public EmiController(EmiService emis) {
        this.emis = emis;
    }

    /** closed: the plans put away too. */
    @GetMapping
    public Book book(@org.springframework.web.bind.annotation.RequestParam(defaultValue = "false") boolean closed) {
        return emis.book(closed);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView update(@PathVariable Long id, @Valid @RequestBody EmiRequest request) {
        return emis.update(id, request);
    }

    @PostMapping("/{id}/close")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView close(@PathVariable Long id) {
        return emis.close(id);
    }

    @PostMapping("/{id}/reopen")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView reopen(@PathVariable Long id) {
        return emis.reopen(id);
    }

    @PostMapping
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView create(@Valid @RequestBody EmiRequest request) {
        return emis.create(request);
    }

    @PostMapping("/{id}/pay")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView pay(@PathVariable Long id, @Valid @RequestBody PayRequest request) {
        return emis.pay(id, request);
    }

    @PostMapping("/{id}/undo")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView undo(@PathVariable Long id) {
        return emis.undo(id);
    }

    @PostMapping("/{id}/foreclose")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView foreclose(@PathVariable Long id, @Valid @RequestBody ForecloseRequest request) {
        return emis.foreclose(id, request);
    }

    @PutMapping("/{id}/auto")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public PlanView auto(@PathVariable Long id, @Valid @RequestBody AutoRequest request) {
        return emis.auto(id, request);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        emis.delete(id);
        return ResponseEntity.noContent().build();
    }
}
