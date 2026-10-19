package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitRequest;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.dto.ChitDtos.PayInstallmentRequest;
import com.aditya.personalbudget.dto.ChitDtos.PayoutRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.ChitService;
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

@RestController
@RequestMapping("/api/chits")
public class ChitController {

    private final ChitService chits;

    public ChitController(ChitService chits) {
        this.chits = chits;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public List<ChitView> list() {
        return chits.list();
    }

    @GetMapping("/{id}")
    @RequiresPermission(Permission.VIEW)
    public ChitDetail detail(@PathVariable Long id) {
        return chits.detail(id);
    }

    @PostMapping
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail create(@Valid @RequestBody ChitRequest request) {
        return chits.create(request);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail update(@PathVariable Long id, @Valid @RequestBody ChitRequest request) {
        return chits.update(id, request);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        chits.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/installments/{installmentId}/pay")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail pay(@PathVariable Long id, @PathVariable Long installmentId,
                          @Valid @RequestBody PayInstallmentRequest request) {
        return chits.payInstallment(id, installmentId, request);
    }

    @PostMapping("/{id}/installments/{installmentId}/undo")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail undo(@PathVariable Long id, @PathVariable Long installmentId) {
        return chits.undoInstallment(id, installmentId);
    }

    @PostMapping("/{id}/payout")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail payout(@PathVariable Long id, @Valid @RequestBody PayoutRequest request) {
        return chits.payout(id, request);
    }

    @PostMapping("/{id}/close")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail close(@PathVariable Long id) {
        return chits.close(id);
    }

    @PostMapping("/{id}/reopen")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail reopen(@PathVariable Long id) {
        return chits.reopen(id);
    }

    @PostMapping("/{id}/payout/undo")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ChitDetail undoPayout(@PathVariable Long id) {
        return chits.undoPayout(id);
    }
}
