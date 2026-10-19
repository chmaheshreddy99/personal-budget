package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.entity.HostedChitLeg;
import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.domain.entity.HostedChitTransfer;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.entity.JournalLine;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.AccountDtos.AccountRequest;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.HostedChitLegRepository;
import com.aditya.personalbudget.repository.HostedChitRepository;
import com.aditya.personalbudget.repository.HostedChitTransferRepository;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The hosted-chit book (Host a Chit, Chit accounts): the accounts that hold the money of the chits the user runs as
 * organiser, kept apart from the personal accounts.
 * <p>
 * <b>Accounts.</b> Each chit has its own accounts ({@link Account#getHostedChitId()}: collections, commission, late
 * interest) and there can be common chit accounts shared by every chit; the Hosted Chit Funds liability (what is owed
 * to the members) is part of the book too.
 * <p>
 * <b>Sub-ledger per chit.</b> Every journal line that moves a chit's money carries the chit
 * ({@link JournalLine#getHostedChitId()}), whichever account it is on. So the chit's money can be followed even when
 * members paid into the organiser's personal bank accounts, and a payout can be paid from several accounts:
 * <ul>
 *   <li>a line on a chit-book account always carries its chit;</li>
 *   <li>a line on a personal account carries the chit only when it is the chit's (the members') money; the
 *       organiser's own money (an advance, the commission taken out, late interest) is left untagged.</li>
 * </ul>
 * For a chit, the tagged balances of the asset accounts say where its money is; the tagged Hosted Chit Funds balance
 * is what is owed to the members, and the difference is the organiser's own money in the chit (commission and late
 * interest kept, advances). A positive tagged balance on a personal account is chit money parked there (to
 * consolidate); a negative one is money the organiser advanced from it (to recover).
 * <p>
 * <b>Transfers</b> ({@link HostedChitTransfer}) move money from one or more accounts into one, as one transfer
 * journal (Dr the account it goes to, Cr each account it comes from).
 */
@Service
public class HostedChitBookService {

    public static final String SOURCE_TRANSFER = "HOSTED_CHIT_TRANSFER";
    static final String FUNDS_ACCOUNT = "Hosted Chit Funds";
    static final String DIRECT_ACCOUNT = "Paid directly to winners";
    private static final String AREA = "Host a Chit";
    private static final Set<String> MODES = Set.of("Cash", "UPI", "Bank");
    private static final Set<String> CHIT_ROLES = Set.of(Account.ROLE_COLLECTION, Account.ROLE_COMMISSION, Account.ROLE_LATE_FEE);

    // ================================================================== requests

    /**
     * One account's part of a payout or transfer. paymentIds: the members' payments this part carries (they came into
     * that account, or were moved there), so a payment can be followed from its receipt to the payout; note: the
     * narrative ("Suresh Reddy RC-000969, UTR77 ...").
     */
    public record LegInput(@NotNull Long accountId, @NotNull @Positive BigDecimal amount, String mode,
                           @Size(max = 60) String reference, List<Long> paymentIds, @Size(max = 2000) String note) {

        public LegInput(Long accountId, BigDecimal amount, String mode, String reference) {
            this(accountId, amount, mode, reference, null, null);
        }
    }

    /**
     * Moves money into {@code toAccountId} from one or more accounts. {@code chitMoney}: it is the chit's money (the
     * members'), not the organiser's own.
     */
    public record TransferRequest(Long chitId, LocalDate date, @NotNull Long toAccountId, @NotEmpty List<@Valid LegInput> from,
                                  Boolean chitMoney, String mode, @Size(max = 60) String reference,
                                  @Size(max = 255) String note, Long version,
                                  /* gathered into the collections account for this month's payout */
                                  Integer payoutMonthNo) {

        public TransferRequest(Long chitId, LocalDate date, Long toAccountId, List<LegInput> from, Boolean chitMoney, String mode,
                               String reference, String note, Long version) {
            this(chitId, date, toAccountId, from, chitMoney, mode, reference, note, version, null);
        }
    }

    /** A chit-book account: hostedChitId empty for a common account (any chit); role for a chit's own account. */
    public record AccountInput(@NotBlank @Size(max = 100) String name, @NotNull AccountType accountType, Long hostedChitId,
                               String role, @Size(max = 100) String institution, @Size(max = 40) String accountNumber,
                               @PositiveOrZero BigDecimal openingBalance, LocalDate openingDate,
                               @Size(max = 255) String description, Boolean active, Long version,
                               /* bank details members pay into: the holder's name, IFSC and UPI ID */
                               @Size(max = 100) String holderName, @Size(max = 11) String ifsc, @Size(max = 60) String upiId) {

        public AccountInput(String name, AccountType accountType, Long hostedChitId, String role, String institution,
                            String accountNumber, BigDecimal openingBalance, LocalDate openingDate, String description,
                            Boolean active, Long version) {
            this(name, accountType, hostedChitId, role, institution, accountNumber, openingBalance, openingDate, description,
                    active, version, null, null, null);
        }
    }

    /** Moves an account between the personal accounts and the chit book (optionally to one chit). */
    public record MoveRequest(boolean chitBook, Long hostedChitId) {
    }

    // ================================================================== views

    /** How much of a chit's money one account holds (can be negative: advanced from it). */
    public record Spot(Long accountId, String accountName, String accountType, String institution, boolean chitBook,
                       boolean own, String role, BigDecimal amount) {
    }

    /**
     * Where a chit's money is. held: across all accounts (personal ones included); owedToMembers: the Hosted Chit
     * Funds balance; mine: held − owed (the organiser's commission, late interest and advances in the chit);
     * inPersonal: chit money in personal accounts (negative: advanced from them); earned: commission and late interest.
     */
    public record ChitMoney(Long chitId, String chitName, BigDecimal held, BigDecimal inChitAccounts, BigDecimal inPersonal,
                            BigDecimal owedToMembers, BigDecimal mine, BigDecimal earned, List<Spot> spots) {
    }

    public record ChitShare(Long chitId, String chitName, BigDecimal amount) {
    }

    public record BookAccount(Long id, String code, String name, String accountClass, String accountType, String typeLabel,
                              String institution, String accountNumber, String description, Long hostedChitId,
                              String chitName, String role, boolean systemAccount, boolean active, boolean chitBook,
                              BigDecimal balance, BigDecimal monthIn, BigDecimal monthOut, BigDecimal change30Days,
                              LocalDate lastActivity, long transactionCount, List<BigDecimal> trend,
                              List<ChitShare> byChit, BigDecimal untagged, List<String> usedBy, Long version,
                              String holderName, String ifsc, String upiId) {
    }

    public record BookChit(Long id, String name, String chitType, String status, Long collectionAccountId,
                           Long commissionAccountId, Long lateFeeAccountId, ChitMoney money) {
    }

    /**
     * Something to act on. kind: CONSOLIDATE (chit money parked in a personal account), RECOVER (money advanced from
     * a personal account), OVERDRAWN (a chit-book account below zero), UNUSED (an empty account of a deleted chit).
     */
    public record Suggestion(String kind, String tone, Long chitId, String chitName, Long accountId, String accountName,
                             Long toAccountId, BigDecimal amount, String text) {
    }

    public record LegView(Long id, Long accountId, String accountName, boolean chitBook, BigDecimal amount, String mode,
                          String reference, List<Long> paymentIds, String note) {
    }

    public record TransferView(Long id, Long chitId, String chitName, LocalDate date, boolean chitMoney, String kind,
                               Long toAccountId, String toAccountName, List<LegView> from, BigDecimal amount, String mode,
                               String reference, String note, String entryNo, Long journalEntryId, String createdBy,
                               LocalDateTime createdAt, Long version,
                               /* gathered for this month's payout */
                               Integer payoutMonthNo,
                               /* the move's type and, for money gathered for a payout, the payout once it is made */
                               ChitTrailService.Trail chitTrail) {
    }

    /** A personal account holding (or having advanced) chit money. */
    public record PersonalHolding(Long accountId, String accountName, String accountType, String institution,
                                  BigDecimal balance, List<ChitShare> byChit) {
    }

    /**
     * The whole book. held: the chit-book accounts' balances; owedToMembers: Hosted Chit Funds; inPersonal: chit money
     * parked in personal accounts; advanced: money advanced from personal accounts; mine: the organiser's money.
     */
    public record Overview(BigDecimal held, BigDecimal owedToMembers, BigDecimal inPersonal, BigDecimal advanced,
                           BigDecimal mine, BigDecimal earned, BigDecimal earnedThisMonth, BigDecimal movedThisMonth,
                           List<BookAccount> accounts, List<BookChit> chits, List<PersonalHolding> personal,
                           List<Suggestion> suggestions, List<TransferView> transfers) {
    }

    public record StatementLine(Long entryId, String entryNo, LocalDate date, String voucherLabel, String narration,
                                String party, String reference, String memo, String counterpart, BigDecimal moneyIn,
                                BigDecimal moneyOut, BigDecimal balance, Long hostedChitId, String chitName,
                                String sourceType, Long sourceId,
                                /* a hosted chit's money: where it stands */
                                ChitTrailService.Trail chitTrail) {
    }

    public record Statement(Long accountId, String accountName, LocalDate from, LocalDate to, BigDecimal opening,
                            BigDecimal closing, BigDecimal totalIn, BigDecimal totalOut, List<StatementLine> lines) {
    }

    private final AccountRepository accounts;
    private final JournalEntryRepository entries;
    private final JournalLineRepository lines;
    private final HostedChitRepository chits;
    private final HostedChitTransferRepository transfers;
    private final HostedChitLegRepository legs;
    private final com.aditya.personalbudget.repository.HostedChitPaymentRepository payments;
    private final com.aditya.personalbudget.repository.HostedChitMonthRepository months;
    private final ChitTrailService trails;
    private final AccountService accountService;
    private final LedgerService ledger;
    private final ActivityService activity;

    public HostedChitBookService(AccountRepository accounts, JournalEntryRepository entries, JournalLineRepository lines,
                                 HostedChitRepository chits, HostedChitTransferRepository transfers, HostedChitLegRepository legs,
                                 AccountService accountService, LedgerService ledger, ActivityService activity,
                                 com.aditya.personalbudget.repository.HostedChitPaymentRepository payments,
                                 com.aditya.personalbudget.repository.HostedChitMonthRepository months, ChitTrailService trails) {
        this.trails = trails;
        this.months = months;
        this.payments = payments;
        this.accounts = accounts;
        this.entries = entries;
        this.lines = lines;
        this.chits = chits;
        this.transfers = transfers;
        this.legs = legs;
        this.accountService = accountService;
        this.ledger = ledger;
        this.activity = activity;
    }

    // ================================================================== accounts used by the chits

    /** The liability that holds the members' money between collection and payout (created on first use). */
    public Account fundsAccount() {
        Long tenantId = UserContext.tenantId();
        Account funds = accounts.findByTenantId(tenantId).stream()
                .filter(a -> Boolean.TRUE.equals(a.getSystemAccount()) && a.getAccountClass() == AccountClass.LIABILITY
                        && (Account.ROLE_FUNDS.equals(a.getChitRole()) || FUNDS_ACCOUNT.equals(a.getName())))
                .findFirst()
                .orElseGet(() -> accountService.createInternal(FUNDS_ACCOUNT, AccountType.OTHER_LIABILITY,
                        "Members' money collected in chits you run, until it is paid out", true));
        if (!funds.isChitBook() || !Account.ROLE_FUNDS.equals(funds.getChitRole())) {
            funds.setChitBook(true);
            funds.setChitRole(Account.ROLE_FUNDS);
            funds = accounts.save(funds);
        }
        return funds;
    }

    /**
     * The clearing account for installments members paid straight to the month's winner (created on first use): the
     * payment puts the money here, the payout takes it out, so it is back to zero once the winner is paid. Each line
     * carries its chit, so what is waiting for a chit's payout can be seen.
     */
    public Account directAccount() {
        Account direct = accounts.findByTenantId(UserContext.tenantId()).stream()
                .filter(a -> Account.ROLE_DIRECT.equals(a.getChitRole())).findFirst().orElse(null);
        if (direct == null) {
            direct = accountService.createInternal(uniqueName(DIRECT_ACCOUNT), AccountType.OTHER_ASSET,
                    "Installments members paid straight to the month's winner, until the payout is recorded (Host a Chit)", true);
            direct.setChitBook(true);
            direct.setChitRole(Account.ROLE_DIRECT);
            direct = accounts.save(direct);
        }
        return direct;
    }

    /**
     * A new account of a chit ("Family Chit - collections"), in the chit book. The chit may not be saved yet
     * ({@code chitId} empty): {@link #claimAccounts} links it once it is.
     */
    public Account newChitAccount(String chitName, Long chitId, String role) {
        String suffix = switch (role) {
            case Account.ROLE_COMMISSION -> "commission";
            case Account.ROLE_LATE_FEE -> "late interest";
            default -> "collections";
        };
        String what = switch (role) {
            case Account.ROLE_COMMISSION -> "My commission from the chit ";
            case Account.ROLE_LATE_FEE -> "Late payment interest from the chit ";
            default -> "Members' installments for the chit ";
        };
        Account a = accountService.createInternal(uniqueName(ActivityService.cut(chitName + " - " + suffix, 100)), AccountType.CASH,
                what + chitName + " (Host a Chit)", false);
        a.setChitBook(true);
        a.setHostedChitId(chitId);
        a.setChitRole(role);
        return accounts.save(a);
    }

    /** Links the chit's new accounts (made before the chit had an id) to it. */
    public void claimAccounts(HostedChit c) {
        for (Long id : new Long[] {c.getAccountId(), c.getCommissionAccountId(), c.getLateFeeAccountId()}) {
            if (id == null) continue;
            accounts.findById(id).filter(a -> a.isChitBook() && a.getHostedChitId() == null && CHIT_ROLES.contains(a.getChitRole())
                    && Boolean.FALSE.equals(a.getSystemAccount()) && !hasLines(a.getId())).ifPresent(a -> {
                a.setHostedChitId(c.getId());
                accounts.save(a);
            });
        }
    }

    /**
     * An account money of a chit can go into or come out of: cash, bank or wallet, active, and not another chit's
     * own account.
     */
    public Account requireMoneyAccount(Long accountId, Long chitId, String what) {
        Account a = accountService.require(accountId);
        if (a.getAccountClass() != AccountClass.ASSET || !a.getAccountType().isLiquid()) {
            throw new BusinessException(what + ": pick a cash, bank or wallet account (" + a.getName() + " is a " + a.getAccountType().getLabel() + ")");
        }
        if (!Boolean.TRUE.equals(a.getActive())) {
            throw new BusinessException(a.getName() + " is inactive");
        }
        if (a.getHostedChitId() != null && !a.getHostedChitId().equals(chitId)) {
            String owner = chits.findById(a.getHostedChitId()).map(HostedChit::getName).orElse("another chit");
            throw new BusinessException(a.getName() + " holds the money of " + owner + "; use this chit's own or a common chit account");
        }
        return a;
    }

    /**
     * The chit to put on a line on {@code accountId}: always on chit-book accounts and on the liability and income
     * lines, on a personal account only when it is the chit's (the members') money.
     */
    public Long tag(Long accountId, Long chitId, boolean chitMoney) {
        if (chitId == null) return null;
        Account a = accounts.findById(accountId).orElse(null);
        if (a == null) return chitId;
        if (a.isChitBook() || a.getAccountClass() != AccountClass.ASSET) return chitId;
        return chitMoney ? chitId : null;
    }

    /** After a chit is deleted: its empty accounts go, the others stay in the book without a chit. */
    @Transactional
    public void releaseAccounts(Long chitId) {
        for (Account a : accounts.findByTenantId(UserContext.tenantId())) {
            if (!chitId.equals(a.getHostedChitId())) continue;
            a.setHostedChitId(null);
            a = accounts.save(a);
            if (!hasLines(a.getId()) && !Money.isPositive(a.getOpeningBalance())) {
                accounts.deleteById(a.getId());
            }
        }
    }

    /**
     * Puts the accounts made for hosted chits before the chit book existed into it (idempotent, run at startup): the
     * Hosted Chit Funds liability, and every "… - collections / commission / late interest" account the app made for a
     * chit, linked to that chit (or, when the chit was deleted, kept in the book without one). Accounts of the user's
     * own that a chit collects into stay personal. Returns how many accounts moved.
     */
    @Transactional
    public int adoptAccounts() {
        fundsAccount();
        int moved = 0;
        Map<Long, Account> all = accountMap();
        for (HostedChit c : chits.findByTenantId(UserContext.tenantId())) {
            Object[][] uses = {{c.getAccountId(), Account.ROLE_COLLECTION}, {c.getCommissionAccountId(), Account.ROLE_COMMISSION},
                    {c.getLateFeeAccountId(), Account.ROLE_LATE_FEE}};
            for (Object[] use : uses) {
                Account a = use[0] == null ? null : all.get((Long) use[0]);
                if (a == null || a.isChitBook() || !madeForChit(a)) continue;
                a.setChitBook(true);
                a.setHostedChitId(c.getId());
                a.setChitRole((String) use[1]);
                accounts.save(a);
                moved++;
            }
        }
        for (Account a : accountMap().values()) {
            if (a.isChitBook() || !madeForChit(a)) continue;
            a.setChitBook(true);
            a.setChitRole(a.getName().endsWith("- commission") ? Account.ROLE_COMMISSION
                    : a.getName().endsWith("- late interest") ? Account.ROLE_LATE_FEE : Account.ROLE_COLLECTION);
            accounts.save(a);
            moved++;
        }
        return moved;
    }

    /** An account the app made for a hosted chit (its description says so). */
    private static boolean madeForChit(Account a) {
        return !Boolean.TRUE.equals(a.getSystemAccount()) && a.getDescription() != null && a.getDescription().endsWith("(Host a Chit)");
    }

    /** Deletes the transfers of a chit (and their journal entries), when the chit is deleted. */
    @Transactional
    public int removeTransfers(Long chitId) {
        List<HostedChitTransfer> list = transfers.findByChitId(chitId);
        for (HostedChitTransfer t : list) {
            dropTransfer(t);
        }
        return list.size();
    }

    // ================================================================== queries

    public Overview overview() {
        Books b = new Books();
        Account funds = fundsAccount();
        List<HostedChit> chitList = chits.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing((HostedChit c) -> HostedChit.COMPLETED.equals(c.getStatus()))
                        .thenComparing(HostedChit::getStartMonth, Comparator.reverseOrder()))
                .toList();
        Map<Long, String> chitNames = chitList.stream().collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        Map<Long, List<String>> usedBy = new HashMap<>();
        for (HostedChit c : chitList) {
            if (c.getAccountId() != null) usedBy.computeIfAbsent(c.getAccountId(), k -> new ArrayList<>()).add(c.getName() + " · collections");
            if (c.getCommissionAccountId() != null) usedBy.computeIfAbsent(c.getCommissionAccountId(), k -> new ArrayList<>()).add(c.getName() + " · commission");
            if (c.getLateFeeAccountId() != null) usedBy.computeIfAbsent(c.getLateFeeAccountId(), k -> new ArrayList<>()).add(c.getName() + " · late interest");
        }

        List<BookAccount> bookAccounts = b.accountById.values().stream()
                .filter(Account::isChitBook)
                .sorted(Comparator.comparing((Account a) -> a.getAccountClass() == AccountClass.LIABILITY)
                        .thenComparing(a -> a.getHostedChitId() == null ? 0 : 1)
                        .thenComparing(Account::getCode))
                .map(a -> b.bookAccount(a, chitNames, usedBy.getOrDefault(a.getId(), List.of())))
                .toList();

        List<BookChit> bookChits = chitList.stream().map(c -> new BookChit(c.getId(), c.getName(),
                HostedChitService.typeOf(c), c.getStatus(),
                c.getAccountId(), c.getCommissionAccountId(), c.getLateFeeAccountId(), b.money(c, funds))).toList();

        // personal accounts holding chit money, and what to do about it
        List<PersonalHolding> personal = new ArrayList<>();
        List<Suggestion> suggestions = new ArrayList<>();
        for (Account a : b.accountById.values().stream().sorted(Comparator.comparing(Account::getCode)).toList()) {
            if (a.isChitBook() || a.getAccountClass() != AccountClass.ASSET) continue;
            Map<Long, BigDecimal> byChit = b.tagged.getOrDefault(a.getId(), Map.of());
            List<ChitShare> shares = byChit.entrySet().stream().filter(e -> e.getValue().signum() != 0)
                    .map(e -> new ChitShare(e.getKey(), chitNames.getOrDefault(e.getKey(), "Chit #" + e.getKey()), e.getValue())).toList();
            if (shares.isEmpty()) continue;
            personal.add(new PersonalHolding(a.getId(), a.getName(), a.getAccountType().name(), a.getInstitution(),
                    b.balance(a.getId()), shares));
            for (ChitShare s : shares) {
                HostedChit c = chitList.stream().filter(x -> x.getId().equals(s.chitId())).findFirst().orElse(null);
                Long target = c == null ? null : c.getAccountId();
                if (s.amount().signum() > 0) {
                    suggestions.add(new Suggestion("CONSOLIDATE", "warn", s.chitId(), s.chitName(), a.getId(), a.getName(), target, s.amount(),
                            ActivityService.money(s.amount()) + " of " + s.chitName() + "'s money is in " + a.getName()
                                    + ". Move it to the chit's account, or pay the next winner from it."));
                } else {
                    suggestions.add(new Suggestion("RECOVER", "note", s.chitId(), s.chitName(), a.getId(), a.getName(), target, s.amount().negate(),
                            "You paid " + ActivityService.money(s.amount().negate()) + " for " + s.chitName() + " from " + a.getName()
                                    + ". Take it back from the chit's money when it is collected."));
                }
            }
        }
        for (BookAccount a : bookAccounts) {
            if ("ASSET".equals(a.accountClass()) && a.balance().signum() < 0) {
                suggestions.add(new Suggestion("OVERDRAWN", "bad", a.hostedChitId(), a.chitName(), a.id(), a.name(), a.id(), a.balance().negate(),
                        a.name() + " is " + ActivityService.money(a.balance().negate()) + " below zero: more was paid from it than came in. Move money in."));
            }
            if (a.hostedChitId() == null && !Account.ROLE_COMMON.equals(a.role()) && !Account.ROLE_FUNDS.equals(a.role())
                    && a.transactionCount() == 0 && a.balance().signum() == 0 && a.usedBy().isEmpty()) {
                suggestions.add(new Suggestion("UNUSED", "muted", null, null, a.id(), a.name(), null, Money.ZERO,
                        a.name() + " belonged to a chit that was deleted and was never used. Delete it to tidy up."));
            }
        }

        List<TransferView> transferViews = transferViews(transfers.findByTenantId(UserContext.tenantId()), chitNames, b);
        BigDecimal held = bookAccounts.stream().filter(a -> "ASSET".equals(a.accountClass())).map(BookAccount::balance)
                .reduce(Money.ZERO, BigDecimal::add);
        BigDecimal owed = b.balance(funds.getId());
        BigDecimal inPersonal = personal.stream().flatMap(p -> p.byChit().stream()).map(ChitShare::amount)
                .filter(x -> x.signum() > 0).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal advanced = personal.stream().flatMap(p -> p.byChit().stream()).map(ChitShare::amount)
                .filter(x -> x.signum() < 0).reduce(Money.ZERO, BigDecimal::add).negate();
        BigDecimal earned = bookChits.stream().map(c -> c.money().earned()).reduce(Money.ZERO, BigDecimal::add);
        YearMonth now = YearMonth.now();
        BigDecimal earnedThisMonth = b.earnedBetween(now.atDay(1), now.atEndOfMonth());
        BigDecimal moved = transferViews.stream().filter(t -> YearMonth.from(t.date()).equals(now)).map(TransferView::amount)
                .reduce(Money.ZERO, BigDecimal::add);
        return new Overview(held, owed, inPersonal, advanced, held.add(inPersonal).subtract(advanced).subtract(owed), earned,
                earnedThisMonth, moved, bookAccounts, bookChits, personal, suggestions, transferViews);
    }

    /** Where one chit's money is (for the chit's Money tab). */
    public ChitMoney money(HostedChit c) {
        return new Books().money(c, fundsAccount());
    }

    /** An account's balance now (all its postings, whoever's money). */
    public BigDecimal balanceOf(Long accountId) {
        boolean debitNormal = accounts.findById(accountId).map(a -> a.getAccountClass().isDebitNormal()).orElse(true);
        return lines.findByAccountId(accountId).stream()
                .map(l -> debitNormal ? l.getDebit().subtract(l.getCredit()) : l.getCredit().subtract(l.getDebit()))
                .reduce(Money.ZERO, BigDecimal::add);
    }

    /** The postings on a chit-book (or any) account between two dates, with the running balance. */
    public Statement statement(Long accountId, LocalDate from, LocalDate to) {
        Account account = accountService.require(accountId);
        LocalDate end = to != null ? to : LocalDate.now();
        LocalDate start = from != null ? from : end.minusMonths(3).withDayOfMonth(1);
        Books b = new Books();
        Map<Long, String> chitNames = chits.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        boolean debitNormal = account.getAccountClass().isDebitNormal();
        BigDecimal opening = Money.ZERO;
        List<StatementLine> rows = new ArrayList<>();
        BigDecimal in = Money.ZERO;
        BigDecimal out = Money.ZERO;
        List<JournalLine> mine = b.linesByAccount.getOrDefault(accountId, List.of()).stream()
                .sorted(Comparator.comparing((JournalLine l) -> b.entryById.get(l.getJournalEntryId()).getEntryDate())
                        .thenComparing(JournalLine::getJournalEntryId).thenComparing(JournalLine::getLineNo))
                .toList();
        BigDecimal running = Money.ZERO;
        Map<Long, ChitTrailService.Trail> chitTrails = trails.forEntryIds(mine.stream().map(JournalLine::getJournalEntryId).toList());
        for (JournalLine l : mine) {
            JournalEntry e = b.entryById.get(l.getJournalEntryId());
            BigDecimal change = debitNormal ? l.getDebit().subtract(l.getCredit()) : l.getCredit().subtract(l.getDebit());
            if (e.getEntryDate().isBefore(start)) {
                opening = opening.add(change);
                running = opening;
                continue;
            }
            if (e.getEntryDate().isAfter(end)) continue;
            running = running.add(change);
            if (change.signum() >= 0) in = in.add(change);
            else out = out.add(change.negate());
            boolean debit = l.getDebit().signum() > 0;
            String counterpart = b.linesByEntry.getOrDefault(e.getId(), List.of()).stream()
                    .filter(x -> !x.getId().equals(l.getId()) && (x.getDebit().signum() > 0) != debit)
                    .map(x -> b.accountById.containsKey(x.getAccountId()) ? b.accountById.get(x.getAccountId()).getName() : "?")
                    .distinct().collect(Collectors.joining(", "));
            rows.add(new StatementLine(e.getId(), e.getEntryNo(), e.getEntryDate(), e.getVoucherType().getLabel(), e.getNarration(),
                    e.getParty(), e.getReference(), l.getMemo(), counterpart, change.signum() >= 0 ? change : Money.ZERO,
                    change.signum() < 0 ? change.negate() : Money.ZERO, running, l.getHostedChitId(),
                    l.getHostedChitId() == null ? null : chitNames.getOrDefault(l.getHostedChitId(), "Chit #" + l.getHostedChitId()),
                    e.getSourceType(), e.getSourceId(), chitTrails.get(e.getId())));
        }
        return new Statement(accountId, account.getName(), start, end, opening, running, in, out, rows);
    }

    public List<LegView> legsOfMonth(Long monthId) {
        Map<Long, Account> byId = accountMap();
        return legs.findByMonthId(monthId).stream().sorted(Comparator.comparing(HostedChitLeg::getPosition))
                .map(l -> legView(l, byId)).toList();
    }

    /** Payout legs of every month of a chit, by month id. */
    public Map<Long, List<LegView>> legsByMonth(Long chitId) {
        Map<Long, Account> byId = accountMap();
        return legs.findByChitId(chitId).stream().filter(l -> l.getMonthId() != null)
                .sorted(Comparator.comparing(HostedChitLeg::getPosition))
                .collect(Collectors.groupingBy(HostedChitLeg::getMonthId, Collectors.mapping(l -> legView(l, byId), Collectors.toList())));
    }

    /** The transfers of one chit, newest first. */
    public List<TransferView> transfersOf(Long chitId) {
        Map<Long, String> names = chits.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        return transferViews(transfers.findByChitId(chitId), names, null);
    }

    // ================================================================== chit-book accounts

    @Transactional
    public BookAccount createAccount(AccountInput r) {
        requireLiquidType(r.accountType());
        HostedChit chit = r.hostedChitId() == null ? null : requireChit(r.hostedChitId());
        var view = accountService.create(new AccountRequest(null, r.name(), r.accountType(), blank(r.institution()),
                blank(r.accountNumber()), r.openingBalance(), r.openingDate(), null, null, null, null,
                blank(r.description()), r.active(), null, r.holderName(), r.ifsc(), r.upiId()));
        Account a = accountService.require(view.id());
        a.setChitBook(true);
        a.setHostedChitId(chit == null ? null : chit.getId());
        a.setChitRole(chit == null ? Account.ROLE_COMMON : role(r.role()));
        accounts.save(a);
        activity.record("ADDED", AREA, "Added a chit account · " + a.getName() + (chit == null ? " · common" : " · " + chit.getName()));
        return accountView(a.getId());
    }

    @Transactional
    public BookAccount updateAccount(Long id, AccountInput r) {
        Account a = requireBookAccount(id);
        if (Account.ROLE_FUNDS.equals(a.getChitRole())) {
            throw new BusinessException(a.getName() + " is kept by the app (what is owed to the members) and cannot be changed");
        }
        requireLiquidType(r.accountType());
        HostedChit chit = r.hostedChitId() == null ? null : requireChit(r.hostedChitId());
        if (r.active() != null && !r.active() && !usedBy(a).isEmpty()) {
            throw new BusinessException(a.getName() + " is used by " + String.join(", ", usedBy(a)) + "; pick another account in the chit's settings first");
        }
        String before = a.getName();
        accountService.update(id, new AccountRequest(a.getCode(), r.name(), r.accountType(), blank(r.institution()),
                blank(r.accountNumber()), r.openingBalance(), r.openingDate(), null, null, null, null,
                blank(r.description()), r.active(), r.version(), r.holderName(), r.ifsc(), r.upiId()));
        Account saved = accountService.require(id);
        saved.setHostedChitId(chit == null ? null : chit.getId());
        saved.setChitRole(chit == null ? Account.ROLE_COMMON : role(r.role() != null ? r.role() : a.getChitRole()));
        accounts.save(saved);
        activity.record("CHANGED", AREA, "Edited a chit account · " + before + (before.equals(saved.getName()) ? "" : " → " + saved.getName()));
        return accountView(id);
    }

    @Transactional
    public void deleteAccount(Long id) {
        Account a = requireBookAccount(id);
        if (Account.ROLE_FUNDS.equals(a.getChitRole())) {
            throw new BusinessException(a.getName() + " is kept by the app and cannot be deleted");
        }
        List<String> used = usedBy(a);
        if (!used.isEmpty()) {
            throw new BusinessException(a.getName() + " is used by " + String.join(", ", used) + "; pick another account in the chit's settings first");
        }
        if (!legs.findByAccountId(id).isEmpty()) {
            throw new BusinessException(a.getName() + " has payouts or transfers. Deactivate it instead");
        }
        accountService.delete(id);
        activity.record("DELETED", AREA, "Deleted a chit account · " + a.getName());
    }

    /** Puts a personal account into the chit book (e.g. a bank account opened only for the chits) or takes one out. */
    @Transactional
    public BookAccount move(Long id, MoveRequest r) {
        Account a = accountService.require(id);
        if (Boolean.TRUE.equals(a.getSystemAccount()) || Account.ROLE_FUNDS.equals(a.getChitRole())) {
            throw new BusinessException(a.getName() + " is kept by the app and cannot be moved");
        }
        if (r.chitBook()) {
            requireLiquidType(a.getAccountType());
            HostedChit chit = r.hostedChitId() == null ? null : requireChit(r.hostedChitId());
            a.setChitBook(true);
            a.setHostedChitId(chit == null ? null : chit.getId());
            a.setChitRole(chit == null ? Account.ROLE_COMMON : Account.ROLE_COLLECTION);
            activity.record("CHANGED", AREA, "Moved to the chit accounts · " + a.getName() + (chit == null ? " · common" : " · " + chit.getName()));
        } else {
            List<String> used = usedBy(a);
            if (!used.isEmpty()) {
                throw new BusinessException(a.getName() + " is used by " + String.join(", ", used) + "; pick another account in the chit's settings first");
            }
            a.setChitBook(false);
            a.setHostedChitId(null);
            a.setChitRole(null);
            activity.record("CHANGED", AREA, "Moved to my accounts · " + a.getName());
        }
        accounts.save(a);
        return accountView(id);
    }

    private BookAccount accountView(Long id) {
        Books b = new Books();
        Map<Long, String> chitNames = chits.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        Account a = b.accountById.get(id);
        return b.bookAccount(a, chitNames, usedBy(a));
    }

    // ================================================================== transfers

    @Transactional
    public TransferView transfer(TransferRequest r) {
        HostedChitTransfer t = new HostedChitTransfer();
        t.setTenantId(UserContext.tenantId());
        t.setCreatedBy(UserContext.username());
        t.setCreatedAt(LocalDateTime.now());
        Draft d = check(r, null);
        fill(t, r, d);
        t = transfers.save(t);
        saveLegs(t, d.legs);
        t.setJournalEntryId(ledger.post(transferDraft(t, d)).getId());
        transfers.save(t);
        activity.record("POSTED", AREA, kindLabel(t, d) + " · " + ActivityService.money(t.getAmount()) + " · "
                + d.legs.stream().map(l -> d.account(l.accountId()).getName()).collect(Collectors.joining(" + ")) + " → "
                + d.to.getName() + (d.chit != null ? " · " + d.chit.getName() : ""));
        return transferView(t.getId());
    }

    @Transactional
    public TransferView updateTransfer(Long id, TransferRequest r) {
        HostedChitTransfer t = requireTransfer(id);
        if (r.version() != null && !Objects.equals(r.version(), t.getVersion())) {
            throw new ConcurrentUpdateException("hosted_chit_transfers", id);
        }
        requireOpenChit(t.getChitId());
        requireGatherOpen(t);
        Draft d = check(r, id);
        BigDecimal before = t.getAmount();
        fill(t, r, d);
        legs.deleteAll(legs.findByTransferId(id));
        saveLegs(t, d.legs);
        if (t.getJournalEntryId() != null) {
            ledger.repost(t.getJournalEntryId(), transferDraft(t, d));
        } else {
            t.setJournalEntryId(ledger.post(transferDraft(t, d)).getId());
        }
        transfers.save(t);
        activity.record("CHANGED", AREA, "Edited a chit transfer · " + ActivityService.money(before) + " → " + ActivityService.money(t.getAmount())
                + " · " + d.to.getName());
        return transferView(id);
    }

    @Transactional
    public void deleteTransfer(Long id) {
        HostedChitTransfer t = requireTransfer(id);
        requireOpenChit(t.getChitId());
        requireGatherOpen(t);
        String to = accounts.findById(t.getToAccountId()).map(Account::getName).orElse("?");
        dropTransfer(t);
        activity.record("DELETED", AREA, "Undid a chit transfer · " + ActivityService.money(t.getAmount()) + " → " + to);
    }

    private void dropTransfer(HostedChitTransfer t) {
        Long entryId = t.getJournalEntryId();
        legs.deleteAll(legs.findByTransferId(t.getId()));
        transfers.deleteById(t.getId());
        if (entryId != null) ledger.delete(entryId);
    }

    /** The checked request: the chit, the account it goes to and the parts it comes from. */
    private final class Draft {
        HostedChit chit;
        Account to;
        boolean chitMoney;
        LocalDate date;
        List<LegInput> legs;
        final Map<Long, Account> byId = new HashMap<>();

        Account account(Long id) {
            return byId.get(id);
        }
    }

    private Draft check(TransferRequest r, Long transferId) {
        Draft d = new Draft();
        d.date = r.date() != null ? r.date() : LocalDate.now();
        if (d.date.isAfter(LocalDate.now())) {
            throw new BusinessException("The transfer date cannot be in the future");
        }
        d.chit = r.chitId() == null ? null : requireChit(r.chitId());
        if (d.chit != null) HostedChitService.requireOpen(d.chit);
        // a chit's own account says whose money it is
        Set<Long> ids = new HashSet<>();
        ids.add(r.toAccountId());
        r.from().forEach(l -> ids.add(l.accountId()));
        for (Long id : ids) {
            Account a = accountService.require(id);
            if (a.getHostedChitId() != null) {
                if (d.chit == null) d.chit = requireChit(a.getHostedChitId());
                HostedChitService.requireOpen(d.chit);
            }
        }
        Long chitId = d.chit == null ? null : d.chit.getId();
        d.to = requireMoneyAccount(r.toAccountId(), chitId, "Move into");
        d.byId.put(d.to.getId(), d.to);
        Map<Long, BigDecimal> merged = new LinkedHashMap<>();
        Map<Long, LegInput> firstLeg = new HashMap<>();
        for (LegInput l : r.from()) {
            if (l.accountId().equals(r.toAccountId())) {
                throw new BusinessException("Money cannot move from " + d.to.getName() + " into itself");
            }
            Account a = requireMoneyAccount(l.accountId(), chitId, "Move from");
            d.byId.put(a.getId(), a);
            if (merged.containsKey(a.getId())) {
                throw new BusinessException(a.getName() + " is listed twice; put the whole amount on one line");
            }
            merged.put(a.getId(), Money.round(l.amount()));
            firstLeg.put(a.getId(), l);
        }
        d.legs = merged.entrySet().stream().map(e -> {
            LegInput l = firstLeg.get(e.getKey());
            return new LegInput(e.getKey(), e.getValue(), l.mode() == null ? null : mode(l.mode()), blank(l.reference()),
                    linkedPayments(chitId, l.paymentIds(), transferId, null), blank(l.note()));
        }).toList();
        boolean anyBook = d.byId.values().stream().anyMatch(Account::isChitBook);
        boolean anyPersonal = d.byId.values().stream().anyMatch(a -> !a.isChitBook());
        d.chitMoney = Boolean.TRUE.equals(r.chitMoney()) && d.chit != null;
        if (Boolean.TRUE.equals(r.chitMoney()) && d.chit == null) {
            throw new BusinessException("Pick the chit whose money this is");
        }
        if (!anyBook && !d.chitMoney) {
            throw new BusinessException("Between your own accounts, use a normal transfer (Accounts). Here, money moves in or out of the chit accounts, or a chit's money moves");
        }
        if (anyBook && anyPersonal && d.chit == null && d.byId.values().stream().filter(Account::isChitBook).anyMatch(a -> a.getHostedChitId() != null)) {
            throw new BusinessException("Pick the chit this money belongs to");
        }
        return d;
    }

    private void fill(HostedChitTransfer t, TransferRequest r, Draft d) {
        t.setChitId(d.chit == null ? null : d.chit.getId());
        t.setTransferDate(d.date);
        t.setToAccountId(d.to.getId());
        t.setAmount(d.legs.stream().map(LegInput::amount).reduce(Money.ZERO, BigDecimal::add));
        t.setChitMoney(d.chitMoney);
        t.setMode(mode(r.mode()));
        t.setReference(blank(r.reference()));
        t.setNote(blank(r.note()));
        if (r.payoutMonthNo() != null && d.chit != null) {
            if (r.payoutMonthNo() < 1 || r.payoutMonthNo() > d.chit.getMonths()) {
                throw new BusinessException("Month must be between 1 and " + d.chit.getMonths());
            }
            if (!Boolean.TRUE.equals(t.getChitMoney()) || !d.to.getId().equals(d.chit.getAccountId())) {
                throw new BusinessException("Money gathered for a payout is the chit's money, moved into its collections account");
            }
        }
        t.setPayoutMonthNo(d.chit == null ? null : r.payoutMonthNo());
    }

    private void saveLegs(HostedChitTransfer t, List<LegInput> list) {
        List<HostedChitLeg> rows = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            LegInput l = list.get(i);
            HostedChitLeg leg = new HostedChitLeg();
            leg.setTenantId(t.getTenantId());
            leg.setChitId(t.getChitId());
            leg.setTransferId(t.getId());
            leg.setAccountId(l.accountId());
            leg.setAmount(l.amount());
            leg.setMode(l.mode() != null ? l.mode() : t.getMode());
            leg.setReference(l.reference());
            leg.setPaymentIds(csv(l.paymentIds()));
            leg.setNote(l.note());
            leg.setPosition(i + 1);
            rows.add(leg);
        }
        legs.saveAll(rows);
    }

    /**
     * Checks the members' payments a part says it carries: they are the chit's, and none is already carried by another
     * transfer (consolidated twice) or, for a payout, by another payout. Returns them in order, without repeats.
     */
    List<Long> linkedPayments(Long chitId, List<Long> ids, Long transferId, Long monthId) {
        if (ids == null || ids.isEmpty()) return List.of();
        if (chitId == null) {
            throw new BusinessException("Pick the chit whose payments these are");
        }
        List<Long> out = ids.stream().filter(Objects::nonNull).distinct().toList();
        Set<Long> known = payments.findByChitId(chitId).stream().map(HostedChitPayment::getId).collect(Collectors.toSet());
        for (Long id : out) {
            if (!known.contains(id)) throw new NotFoundException("Payment", id);
        }
        for (HostedChitLeg other : legs.findByChitId(chitId)) {
            boolean sameKind = monthId == null ? other.getTransferId() != null && !other.getTransferId().equals(transferId)
                    : other.getMonthId() != null && !other.getMonthId().equals(monthId);
            if (!sameKind) continue;
            for (Long id : ids(other.getPaymentIds())) {
                if (out.contains(id)) {
                    String no = payments.findById(id).map(HostedChitPayment::getReceiptNo).orElse("#" + id);
                    throw new BusinessException(no + " is already " + (monthId == null ? "moved by another transfer" : "part of another payout"));
                }
            }
        }
        return out;
    }

    static String csv(List<Long> ids) {
        return ids == null || ids.isEmpty() ? null : ids.stream().map(String::valueOf).collect(Collectors.joining(","));
    }

    static List<Long> ids(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return java.util.Arrays.stream(csv.split(",")).map(String::trim).filter(s -> s.matches("\\d+")).map(Long::valueOf).toList();
    }

    /** Dr the account the money goes to, Cr each account it comes from; lines carry the chit per {@link #tag}. */
    private JournalDraft transferDraft(HostedChitTransfer t, Draft d) {
        Long chitId = t.getChitId();
        boolean chitMoney = Boolean.TRUE.equals(t.getChitMoney());
        String from = d.legs.stream().map(l -> d.account(l.accountId()).getName()).collect(Collectors.joining(" + "));
        String narration = kindLabel(t, d) + ": " + from + " → " + d.to.getName() + (d.chit != null ? " (" + d.chit.getName()
                + (t.getPayoutMonthNo() != null ? ", for the " + HostedChitService.payCode(HostedChitService.shortCodeOf(d.chit), t.getPayoutMonthNo()) + " payout" : "") + ")" : "");
        JournalDraft draft = JournalDraft.of(t.getTransferDate(), VoucherType.TRANSFER, ActivityService.cut(narration, 255))
                .debit(d.to.getId(), t.getAmount(), legMemo(t.getMode(), t.getReference())).hostedChit(tag(d.to.getId(), chitId, chitMoney));
        for (LegInput l : d.legs) {
            draft.credit(l.accountId(), l.amount(), legMemo(l.mode() != null ? l.mode() : t.getMode(), l.reference(), l.note()))
                    .hostedChit(tag(l.accountId(), chitId, chitMoney));
        }
        String ref = t.getReference() != null ? t.getReference()
                : d.legs.stream().map(LegInput::reference).filter(Objects::nonNull).collect(Collectors.joining(", "));
        return draft.reference(ref == null || ref.isBlank() ? null : ActivityService.cut(ref, 60))
                .party(d.chit != null ? d.chit.getName() : "Chit accounts")
                .source(SOURCE_TRANSFER, t.getId());
    }

    /** What kind of move it is, in words. */
    private static String kindLabel(HostedChitTransfer t, Draft d) {
        boolean toPersonal = !d.to.isChitBook();
        boolean fromPersonal = d.legs.stream().anyMatch(l -> !d.account(l.accountId()).isChitBook());
        if (Boolean.TRUE.equals(t.getChitMoney())) {
            return d.legs.size() > 1 ? "Chit money consolidated" : "Chit money moved";
        }
        if (fromPersonal && !toPersonal) return "My money put into the chit accounts";
        if (toPersonal) return "Taken out to my account";
        return "Moved between chit accounts";
    }

    private static String kind(HostedChitTransfer t, Map<Long, Account> byId, List<HostedChitLeg> from) {
        Account to = byId.get(t.getToAccountId());
        boolean toPersonal = to != null && !to.isChitBook();
        boolean fromPersonal = from.stream().map(l -> byId.get(l.getAccountId())).anyMatch(a -> a != null && !a.isChitBook());
        if (Boolean.TRUE.equals(t.getChitMoney())) return from.size() > 1 ? "CONSOLIDATE" : "MOVE";
        if (fromPersonal && !toPersonal) return "ADVANCE";
        if (toPersonal) return "WITHDRAW";
        return "MOVE";
    }

    static String legMemo(String mode, String reference) {
        return legMemo(mode, reference, null);
    }

    /** "Bank · ref UTR1 · Suresh Reddy RC-000969 ...": the line's mode, reference and the payments it carries. */
    static String legMemo(String mode, String reference, String note) {
        String memo = (mode == null ? "" : mode) + (reference == null ? "" : (mode == null ? "" : " · ") + "ref " + reference)
                + (note == null || note.isBlank() ? "" : (mode == null && reference == null ? "" : " · ") + note.trim());
        return memo.isBlank() ? null : ActivityService.cut(memo, 2000);
    }

    private TransferView transferView(Long id) {
        Map<Long, String> names = chits.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(HostedChit::getId, HostedChit::getName));
        return transferViews(List.of(requireTransfer(id)), names, null).getFirst();
    }

    private List<TransferView> transferViews(List<HostedChitTransfer> list, Map<Long, String> chitNames, Books b) {
        Map<Long, Account> byId = b != null ? b.accountById : accountMap();
        Map<Long, String> entryNos = new HashMap<>();
        entries.findAllById(list.stream().map(HostedChitTransfer::getJournalEntryId).filter(Objects::nonNull).toList())
                .forEach(e -> entryNos.put(e.getId(), e.getEntryNo()));
        Map<Long, ChitTrailService.Trail> chitTrails = trails.forEntryIds(list.stream().map(HostedChitTransfer::getJournalEntryId).toList());
        Map<Long, List<HostedChitLeg>> legsByTransfer = legs.findByTenantId(UserContext.tenantId()).stream()
                .filter(l -> l.getTransferId() != null).collect(Collectors.groupingBy(HostedChitLeg::getTransferId));
        return list.stream()
                .sorted(Comparator.comparing(HostedChitTransfer::getTransferDate).thenComparing(HostedChitTransfer::getId).reversed())
                .map(t -> {
                    List<HostedChitLeg> from = legsByTransfer.getOrDefault(t.getId(), List.of()).stream()
                            .sorted(Comparator.comparing(HostedChitLeg::getPosition)).toList();
                    Account to = byId.get(t.getToAccountId());
                    return new TransferView(t.getId(), t.getChitId(), t.getChitId() == null ? null : chitNames.get(t.getChitId()),
                            t.getTransferDate(), Boolean.TRUE.equals(t.getChitMoney()), kind(t, byId, from), t.getToAccountId(),
                            to == null ? "?" : to.getName(), from.stream().map(l -> legView(l, byId)).toList(), t.getAmount(),
                            t.getMode(), t.getReference(), t.getNote(), entryNos.get(t.getJournalEntryId()), t.getJournalEntryId(),
                            t.getCreatedBy(), t.getCreatedAt(), t.getVersion(), t.getPayoutMonthNo(), chitTrails.get(t.getJournalEntryId()));
                }).toList();
    }

    private static LegView legView(HostedChitLeg l, Map<Long, Account> byId) {
        Account a = byId.get(l.getAccountId());
        return new LegView(l.getId(), l.getAccountId(), a == null ? "?" : a.getName(), a != null && a.isChitBook(),
                l.getAmount(), l.getMode(), l.getReference(), ids(l.getPaymentIds()), l.getNote());
    }

    // ================================================================== helpers

    private Map<Long, Account> accountMap() {
        return accounts.findByTenantId(UserContext.tenantId()).stream().collect(Collectors.toMap(Account::getId, Function.identity()));
    }

    private boolean hasLines(Long accountId) {
        return lines.existsByAccountId(accountId);
    }

    private HostedChit requireChit(Long id) {
        return chits.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Hosted chit", id));
    }

    /** A closed chit's money stays as it is: its transfers cannot change until it is re-opened. */
    private void requireOpenChit(Long chitId) {
        if (chitId != null) chits.findById(chitId).ifPresent(HostedChitService::requireOpen);
    }

    /** Money gathered for a payout that is made stays where the payout took it from. */
    private void requireGatherOpen(HostedChitTransfer t) {
        if (t.getChitId() == null || t.getPayoutMonthNo() == null) return;
        months.findByChitId(t.getChitId()).stream().filter(m -> m.getMonthNo().equals(t.getPayoutMonthNo()) && m.getPayoutDate() != null)
                .findFirst().ifPresent(m -> {
                    throw new BusinessException("This money was gathered for the month " + m.getMonthNo() + " payout, which is made. Undo that payout first to change the movement");
                });
    }

    private HostedChitTransfer requireTransfer(Long id) {
        return transfers.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Chit transfer", id));
    }

    private Account requireBookAccount(Long id) {
        Account a = accountService.require(id);
        if (!a.isChitBook()) {
            throw new BusinessException(a.getName() + " is one of your own accounts; change it on the Accounts page");
        }
        return a;
    }

    private static void requireLiquidType(AccountType type) {
        if (type == null || !type.isLiquid()) {
            throw new BusinessException("Chit accounts are cash, bank or wallet accounts");
        }
    }

    private static String role(String role) {
        String r = role == null ? Account.ROLE_COLLECTION : role.trim().toUpperCase();
        if (!CHIT_ROLES.contains(r)) {
            throw new BusinessException("A chit's account is for collections, commission or late interest");
        }
        return r;
    }

    /** The chits that use the account by default (for collections, the commission or late interest). */
    private List<String> usedBy(Account a) {
        List<String> out = new ArrayList<>();
        for (HostedChit c : chits.findByTenantId(UserContext.tenantId())) {
            if (a.getId().equals(c.getAccountId())) out.add(c.getName() + " (collections)");
            if (a.getId().equals(c.getCommissionAccountId())) out.add(c.getName() + " (commission)");
            if (a.getId().equals(c.getLateFeeAccountId())) out.add(c.getName() + " (late interest)");
        }
        return out;
    }

    /** "Family Chit - collections", or "… (2)" when a deleted chit's account still has the name. */
    private String uniqueName(String name) {
        Set<String> taken = accounts.findByTenantId(UserContext.tenantId()).stream().map(a -> a.getName().toLowerCase())
                .collect(Collectors.toSet());
        if (!taken.contains(name.toLowerCase())) return name;
        for (int i = 2; ; i++) {
            String next = ActivityService.cut(name, 95) + " (" + i + ")";
            if (!taken.contains(next.toLowerCase())) return next;
        }
    }

    static String mode(String mode) {
        if (mode == null || mode.isBlank()) return "Bank";
        return MODES.stream().filter(m -> m.equalsIgnoreCase(mode.trim())).findFirst()
                .orElseThrow(() -> new BusinessException("Mode must be Cash, UPI or Bank"));
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    // ================================================================== figures

    /** The tenant's ledger, read once: balances per account, and per account and chit (the tagged lines). */
    private final class Books {

        final Map<Long, Account> accountById = accountMap();
        final Map<Long, JournalEntry> entryById = entries.findByTenantId(UserContext.tenantId()).stream()
                .collect(Collectors.toMap(JournalEntry::getId, Function.identity()));
        final List<JournalLine> all = lines.findByTenantId(UserContext.tenantId()).stream()
                .filter(l -> entryById.containsKey(l.getJournalEntryId())).toList();
        final Map<Long, List<JournalLine>> linesByAccount = all.stream().collect(Collectors.groupingBy(JournalLine::getAccountId));
        final Map<Long, List<JournalLine>> linesByEntry = all.stream().collect(Collectors.groupingBy(JournalLine::getJournalEntryId));
        /** account -> chit -> balance of the lines carrying that chit (natural sign). */
        final Map<Long, Map<Long, BigDecimal>> tagged = new HashMap<>();
        final Map<Long, BigDecimal> balances = new HashMap<>();

        Books() {
            for (JournalLine l : all) {
                BigDecimal change = natural(l);
                balances.merge(l.getAccountId(), change, BigDecimal::add);
                if (l.getHostedChitId() != null) {
                    tagged.computeIfAbsent(l.getAccountId(), k -> new HashMap<>()).merge(l.getHostedChitId(), change, BigDecimal::add);
                }
            }
        }

        BigDecimal natural(JournalLine l) {
            Account a = accountById.get(l.getAccountId());
            boolean debitNormal = a == null || a.getAccountClass().isDebitNormal();
            return debitNormal ? l.getDebit().subtract(l.getCredit()) : l.getCredit().subtract(l.getDebit());
        }

        BigDecimal balance(Long accountId) {
            return balances.getOrDefault(accountId, Money.ZERO);
        }

        BigDecimal balanceAsOf(Long accountId, LocalDate date) {
            return linesByAccount.getOrDefault(accountId, List.of()).stream()
                    .filter(l -> !entryById.get(l.getJournalEntryId()).getEntryDate().isAfter(date))
                    .map(this::natural).reduce(Money.ZERO, BigDecimal::add);
        }

        /** Commission and late interest booked (income lines carrying a chit) between two dates. */
        BigDecimal earnedBetween(LocalDate from, LocalDate to) {
            return all.stream().filter(l -> l.getHostedChitId() != null)
                    .filter(l -> accountById.containsKey(l.getAccountId()) && accountById.get(l.getAccountId()).getAccountClass() == AccountClass.INCOME)
                    .filter(l -> {
                        LocalDate d = entryById.get(l.getJournalEntryId()).getEntryDate();
                        return !d.isBefore(from) && !d.isAfter(to);
                    })
                    .map(this::natural).reduce(Money.ZERO, BigDecimal::add);
        }

        ChitMoney money(HostedChit c, Account funds) {
            List<Spot> spots = new ArrayList<>();
            BigDecimal earned = Money.ZERO;
            for (Map.Entry<Long, Map<Long, BigDecimal>> e : tagged.entrySet()) {
                BigDecimal amount = e.getValue().getOrDefault(c.getId(), Money.ZERO);
                Account a = accountById.get(e.getKey());
                if (a == null) continue;
                if (a.getAccountClass() == AccountClass.INCOME) {
                    earned = earned.add(amount);
                    continue;
                }
                if (a.getAccountClass() != AccountClass.ASSET || amount.signum() == 0) continue;
                spots.add(new Spot(a.getId(), a.getName(), a.getAccountType().name(), a.getInstitution(), a.isChitBook(),
                        c.getId().equals(a.getHostedChitId()), a.getChitRole(), amount));
            }
            spots.sort(Comparator.comparing((Spot s) -> !s.own()).thenComparing(s -> !s.chitBook())
                    .thenComparing(Spot::amount, Comparator.reverseOrder()));
            BigDecimal held = spots.stream().map(Spot::amount).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal inBook = spots.stream().filter(Spot::chitBook).map(Spot::amount).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal owed = tagged.getOrDefault(funds.getId(), Map.of()).getOrDefault(c.getId(), Money.ZERO);
            return new ChitMoney(c.getId(), c.getName(), held, inBook, held.subtract(inBook), owed, held.subtract(owed), earned, spots);
        }

        BookAccount bookAccount(Account a, Map<Long, String> chitNames, List<String> used) {
            LocalDate today = LocalDate.now();
            YearMonth month = YearMonth.from(today);
            BigDecimal in = Money.ZERO, out = Money.ZERO;
            LocalDate last = null;
            List<JournalLine> own = linesByAccount.getOrDefault(a.getId(), List.of());
            for (JournalLine l : own) {
                LocalDate d = entryById.get(l.getJournalEntryId()).getEntryDate();
                if (last == null || d.isAfter(last)) last = d;
                if (YearMonth.from(d).equals(month)) {
                    BigDecimal change = natural(l);
                    if (change.signum() > 0) in = in.add(change);
                    else out = out.add(change.negate());
                }
            }
            List<BigDecimal> trend = new ArrayList<>();
            for (int i = 5; i >= 1; i--) trend.add(balanceAsOf(a.getId(), month.minusMonths(i).atEndOfMonth()));
            BigDecimal balance = balance(a.getId());
            trend.add(balance);
            Map<Long, BigDecimal> byChit = tagged.getOrDefault(a.getId(), Map.of());
            List<ChitShare> shares = byChit.entrySet().stream().filter(e -> e.getValue().signum() != 0)
                    .map(e -> new ChitShare(e.getKey(), chitNames.getOrDefault(e.getKey(), "Chit #" + e.getKey()), e.getValue()))
                    .sorted(Comparator.comparing(ChitShare::amount).reversed()).toList();
            BigDecimal untagged = balance.subtract(shares.stream().map(ChitShare::amount).reduce(Money.ZERO, BigDecimal::add));
            return new BookAccount(a.getId(), a.getCode(), a.getName(), a.getAccountClass().name(), a.getAccountType().name(),
                    a.getAccountType().getLabel(), a.getInstitution(), a.getAccountNumber(), a.getDescription(), a.getHostedChitId(),
                    a.getHostedChitId() == null ? null : chitNames.get(a.getHostedChitId()),
                    a.getChitRole() != null ? a.getChitRole() : a.getHostedChitId() == null ? Account.ROLE_COMMON : Account.ROLE_COLLECTION,
                    Boolean.TRUE.equals(a.getSystemAccount()), Boolean.TRUE.equals(a.getActive()), a.isChitBook(),
                    balance, in, out, balance.subtract(balanceAsOf(a.getId(), today.minusDays(30))), last,
                    own.size(), trend, shares, untagged, used, a.getVersion(), a.getHolderName(), a.getIfsc(), a.getUpiId());
        }
    }
}
