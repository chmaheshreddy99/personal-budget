package com.aditya.personalbudget.web;

import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.BankDetailsRequest;
import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestOverview;
import com.aditya.personalbudget.dto.BankInterestDtos.InterestSettingsRequest;
import com.aditya.personalbudget.dto.BankInterestDtos.PostInterestRequest;
import com.aditya.personalbudget.service.AccountService;
import com.aditya.personalbudget.service.BankInterestService;
import jakarta.validation.Valid;
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

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final AccountService accounts;
    private final BankInterestService interest;

    public AccountController(AccountService accounts, BankInterestService interest) {
        this.accounts = accounts;
        this.interest = interest;
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

    /** A credit card's billing cycle still open and its statements: what is payable, by when. */
    @GetMapping("/{id}/card-bills")
    @RequiresPermission(Permission.VIEW)
    public com.aditya.personalbudget.service.CardBilling.Bills cardBills(@PathVariable Long id, @RequestParam(defaultValue = "12") int count) {
        return accounts.cardBills(id, count);
    }

    /** A bank account's average balances and its periods of interest. */
    @GetMapping("/{id}/interest")
    @RequiresPermission(Permission.VIEW)
    public InterestOverview interest(@PathVariable Long id, @RequestParam(required = false) LocalDate from,
                                     @RequestParam(required = false) LocalDate to) {
        return interest.overview(id, from, to);
    }

    /** Its rate, how often interest is credited, from when, and whether it posts by itself. */
    @PutMapping("/{id}/interest/settings")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public InterestOverview interestSettings(@PathVariable Long id, @Valid @RequestBody InterestSettingsRequest request) {
        return interest.saveSettings(id, request);
    }

    @PostMapping("/{id}/interest")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public InterestOverview postInterest(@PathVariable Long id, @Valid @RequestBody PostInterestRequest request) {
        return interest.post(id, request);
    }

    @DeleteMapping("/{id}/interest/{postingId}")
    @RequiresPermission(Permission.POST_TRANSACTIONS)
    public InterestOverview undoInterest(@PathVariable Long id, @PathVariable Long postingId) {
        return interest.undo(id, postingId);
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(Permission.MANAGE_ACCOUNTS)
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        accounts.delete(id);
        return ResponseEntity.noContent().build();
    }
}
