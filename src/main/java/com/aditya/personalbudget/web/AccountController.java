package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.AccountService;
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
@RequestMapping("/api/accounts")
public class AccountController {

    private final AccountService accounts;

    public AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public List<AccountView> list() {
        return accounts.list();
    }

    @GetMapping("/{id}")
    @RequiresPermission(Permission.VIEW)
    public AccountView get(@PathVariable Long id) {
        return accounts.get(id);
    }

    @PostMapping
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public AccountView create(@Valid @RequestBody AccountRequest request) {
        return accounts.create(request);
    }

    @PutMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public AccountView update(@PathVariable Long id, @Valid @RequestBody AccountRequest request) {
        return accounts.update(id, request);
    }

    @PutMapping("/{id}/bank-details")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public AccountView bankDetails(@PathVariable Long id, @Valid @RequestBody BankDetailsRequest request) {
        return accounts.updateBankDetails(id, request);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        accounts.delete(id);
        return ResponseEntity.noContent().build();
    }
}
