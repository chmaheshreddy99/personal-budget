package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.ChitStatus;
import com.aditya.personalbudget.domain.type.ClaimStatus;
import com.aditya.personalbudget.dto.AccountDtos.AccountView;
import com.aditya.personalbudget.dto.AccountDtos.CloseCheck;
import com.aditya.personalbudget.dto.AccountDtos.CloseRequest;
import com.aditya.personalbudget.dto.JournalDtos.QuickKind;
import com.aditya.personalbudget.dto.JournalDtos.QuickTransactionRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.EmiPlanRepository;
import com.aditya.personalbudget.repository.RecurringTransactionRepository;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * Closing an account: it ends at nil, keeps its history and takes no new entries (the ledger refuses an inactive account),
 * and it can be re-opened. What it still holds or owes moves to another account by an ordinary transfer, so a payment into
 * a card still pays its billed EMIs. What would go on using the account (an EMI plan, a running chit, a recurring item,
 * money still owed through it) has to be sorted out first.
 */
@Service
public class AccountClosureService {

    private final AccountRepository accounts;
    private final AccountService accountService;
    private final TransactionService transactions;
    private final BankInterestService interest;
    private final EmiPlanRepository emiPlans;
    private final ChitRepository chits;
    private final ClaimRepository claims;
    private final RecurringTransactionRepository recurring;

    public AccountClosureService(AccountRepository accounts, AccountService accountService, TransactionService transactions,
                                 BankInterestService interest, EmiPlanRepository emiPlans, ChitRepository chits, ClaimRepository claims,
                                 RecurringTransactionRepository recurring) {
        this.accounts = accounts;
        this.accountService = accountService;
        this.transactions = transactions;
        this.interest = interest;
        this.emiPlans = emiPlans;
        this.chits = chits;
        this.claims = claims;
        this.recurring = recurring;
    }

    public CloseCheck check(Long id) {
        Account account = accountService.require(id);
        AccountView view = accountService.get(id);
        return new CloseCheck(id, account.getName(), view.balance(), account.getAccountClass() == AccountClass.LIABILITY,
                view.lastActivity(), blockers(account), notes(account));
    }

    /** The balance follows when this commits (the ledger keeps it): read the account afterwards. */
    @Transactional
    public void close(Long id, CloseRequest request) {
        Account account = accountService.require(id);
        List<String> blockers = blockers(account);
        if (!blockers.isEmpty()) throw new BusinessException(blockers.getFirst());
        AccountView view = accountService.get(id);
        LocalDate on = request.date();
        if (on.isAfter(OrgClock.today())) throw new BusinessException("An account cannot be closed on a future date");
        if (view.lastActivity() != null && on.isBefore(view.lastActivity())) {
            throw new BusinessException(account.getName() + " has entries up to " + view.lastActivity() + ": close it on or after that day");
        }
        BigDecimal balance = view.balance();
        if (balance.signum() != 0) moveBalance(account, balance, on, request.moveToAccountId());

        // only pre-selected when paying: the chit just asks next time
        for (Chit chit : chits.findByTenantId(UserContext.tenantId())) {
            if (id.equals(chit.getDefaultPaymentAccountId())) {
                chit.setDefaultPaymentAccountId(null);
                chits.save(chit);
            }
        }
        Account closing = accountService.require(id);
        closing.setActive(false);
        closing.setClosedOn(on);
        accounts.save(closing);
    }

    @Transactional
    public AccountView reopen(Long id) {
        Account account = accountService.require(id);
        if (Boolean.TRUE.equals(account.getActive())) throw new BusinessException(account.getName() + " is open already");
        if (account.isEmiAccount()) throw new BusinessException("'" + account.getName() + "' re-opens with its EMI plan, in Expenses, EMIs");
        account.setActive(true);
        account.setClosedOn(null);
        accounts.save(account);
        return accountService.get(id);
    }

    /** Takes the account to nil: money held goes out to the other account, what is owed is paid from it (and the reverse of each when overdrawn or in credit). */
    private void moveBalance(Account account, BigDecimal balance, LocalDate on, Long toId) {
        if (toId == null) {
            throw new BusinessException(account.getName() + " still has a balance of " + ActivityService.money(balance.abs())
                    + ": pick an account to move it to, or clear it first");
        }
        if (toId.equals(account.getId())) throw new BusinessException("Pick another account to move the balance to");
        Account other = accountService.require(toId);
        if (!other.isLiquid() || !Boolean.TRUE.equals(other.getActive())) {
            throw new BusinessException("Move the balance to an open bank, cash or wallet account");
        }
        boolean debt = account.getAccountClass() == AccountClass.LIABILITY;
        boolean outOfAccount = debt == (balance.signum() < 0);   // holds money: Cr this; owes: Dr this (a transfer debits "to")
        Long from = outOfAccount ? account.getId() : other.getId();
        Long to = outOfAccount ? other.getId() : account.getId();
        transactions.postQuick(new QuickTransactionRequest(QuickKind.TRANSFER, on, balance.abs(), from, to, null,
                "Closing " + account.getName() + ": balance moved " + (outOfAccount ? "to " : "from ") + other.getName(), null, null));
    }

    private List<String> blockers(Account a) {
        List<String> out = new ArrayList<>();
        if (!Boolean.TRUE.equals(a.getActive())) out.add(a.getName() + " is closed already");
        if (Boolean.TRUE.equals(a.getSystemAccount())) out.add("'" + a.getName() + "' is a system account and stays open");
        if (a.getAccountClass() != AccountClass.ASSET && a.getAccountClass() != AccountClass.LIABILITY) out.add("Only asset and liability accounts can be closed");
        if (a.isChitBook()) out.add("'" + a.getName() + "' belongs to the hosted chit book: manage it under Chit accounts");
        if (a.isProjectBook()) out.add("'" + a.getName() + "' belongs to the construction book: manage it under Construction");
        if (a.isEmiAccount()) out.add("'" + a.getName() + "' closes with its EMI plan, in Expenses, EMIs");
        if (!out.isEmpty()) return out;

        Long tenant = UserContext.tenantId();
        emiPlans.findByTenantId(tenant).stream()
                .filter(p -> a.getId().equals(p.getPayAccountId()) && "ACTIVE".equals(p.getStatus()) && !Boolean.TRUE.equals(p.getArchived()))
                .forEach(p -> out.add("EMI plan \"" + p.getNarration() + "\" is still running on it: pay it off first"));
        chits.findByTenantId(tenant).stream()
                .filter(c -> a.getId().equals(c.getAccountId()) && c.getStatus() != ChitStatus.CLOSED)
                .forEach(c -> out.add("Chit \"" + c.getName() + "\" is kept in it: close the chit first"));
        recurring.findByTenantIdAndActiveTrue(tenant).stream()
                .filter(r -> a.getId().equals(r.getDebitAccountId()) || a.getId().equals(r.getCreditAccountId()))
                .forEach(r -> out.add("Recurring item \"" + r.getName() + "\" uses it: change or stop it first"));
        claims.findByTenantId(tenant).stream()
                .filter(c -> a.getId().equals(c.getReceivableAccountId()) && (c.getStatus() == ClaimStatus.OPEN || c.getStatus() == ClaimStatus.PARTIAL))
                .forEach(c -> out.add((c.getParty() == null ? "An item" : c.getParty() + "'s item") + " is still open on it: settle it first"));
        return out;
    }

    private List<String> notes(Account a) {
        List<String> out = new ArrayList<>();
        if (a.getAccountType() == AccountType.BANK && Boolean.TRUE.equals(a.getActive()) && Money.isPositive(a.getInterestRate())) {
            BigDecimal due = interest.overview(a.getId()).dueAmount();
            if (Money.isPositive(due)) out.add(ActivityService.money(due) + " of interest is worked out but not posted. Post it first if the bank paid it: a closed account takes no entries");
        }
        long defaults = chits.findByTenantId(UserContext.tenantId()).stream().filter(c -> a.getId().equals(c.getDefaultPaymentAccountId())).count();
        if (defaults > 0) out.add(defaults + (defaults == 1 ? " chit pays" : " chits pay") + " from it by default: paying will ask for an account");
        if (a.getAccountType() == AccountType.CREDIT_CARD) out.add("Its billing stops: bills already made stay on record");
        return out;
    }
}
