package com.aditya.personalbudget.web;

import com.aditya.personalbudget.security.Permission;
import com.aditya.personalbudget.security.RequiresPermission;
import com.aditya.personalbudget.service.HostedChitBookService;
import com.aditya.personalbudget.service.HostedChitBookService.AccountInput;
import com.aditya.personalbudget.service.HostedChitBookService.BookAccount;
import com.aditya.personalbudget.service.HostedChitBookService.MoveRequest;
import com.aditya.personalbudget.service.HostedChitBookService.Overview;
import com.aditya.personalbudget.service.HostedChitBookService.Statement;
import com.aditya.personalbudget.service.HostedChitBookService.TransferRequest;
import com.aditya.personalbudget.service.HostedChitBookService.TransferView;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
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

/**
 * Host a Chit, Chit accounts: the accounts holding the money of the chits the user hosts, the transfers between
 * them and the user's own accounts, and where each chit's money is (see {@link HostedChitBookService}).
 */
@RestController
@RequestMapping("/api/hosted-chits/book")
public class HostedChitBookController {

    private final HostedChitBookService book;

    public HostedChitBookController(HostedChitBookService book) {
        this.book = book;
    }

    @GetMapping
    @RequiresPermission(Permission.VIEW)
    public Overview overview() {
        return book.overview();
    }

    @GetMapping("/accounts/{id}/statement")
    @RequiresPermission(Permission.VIEW)
    public Statement statement(@PathVariable Long id,
                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return book.statement(id, from, to);
    }

    @PostMapping("/accounts")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public BookAccount createAccount(@Valid @RequestBody AccountInput request) {
        return book.createAccount(request);
    }

    @PutMapping("/accounts/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public BookAccount updateAccount(@PathVariable Long id, @Valid @RequestBody AccountInput request) {
        return book.updateAccount(id, request);
    }

    @DeleteMapping("/accounts/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> deleteAccount(@PathVariable Long id) {
        book.deleteAccount(id);
        return ResponseEntity.noContent().build();
    }

    /** Moves an account into the chit book (e.g. a bank account kept only for the chits) or back to my accounts. */
    @PostMapping("/accounts/{id}/move")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public BookAccount move(@PathVariable Long id, @RequestBody MoveRequest request) {
        return book.move(id, request);
    }

    @PostMapping("/transfers")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public TransferView transfer(@Valid @RequestBody TransferRequest request) {
        return book.transfer(request);
    }

    @PutMapping("/transfers/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public TransferView updateTransfer(@PathVariable Long id, @Valid @RequestBody TransferRequest request) {
        return book.updateTransfer(id, request);
    }

    @DeleteMapping("/transfers/{id}")
    @RequiresPermission(Permission.MANAGE_CHITS)
    public ResponseEntity<Void> deleteTransfer(@PathVariable Long id) {
        book.deleteTransfer(id);
        return ResponseEntity.noContent().build();
    }
}
