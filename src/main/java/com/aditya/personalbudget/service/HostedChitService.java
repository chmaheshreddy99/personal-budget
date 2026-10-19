package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.HostedChit;
import com.aditya.personalbudget.domain.entity.HostedChitMember;
import com.aditya.personalbudget.domain.entity.HostedChitMonth;
import com.aditya.personalbudget.domain.entity.HostedChitPayment;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.repository.HostedChitMemberRepository;
import com.aditya.personalbudget.repository.HostedChitMonthRepository;
import com.aditya.personalbudget.repository.HostedChitPaymentRepository;
import com.aditya.personalbudget.repository.HostedChitRepository;
import com.aditya.personalbudget.repository.HostedChitShareRepository;
import com.aditya.personalbudget.repository.HostedChitAgreementRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.domain.entity.HostedChitAgreement;
import com.aditya.personalbudget.domain.entity.HostedChitShare;
import com.aditya.personalbudget.dto.PlanningDtos.CategoryRequest;
import com.aditya.personalbudget.domain.entity.HostedChitLeg;
import com.aditya.personalbudget.repository.HostedChitLegRepository;
import com.aditya.personalbudget.service.HostedChitBookService.ChitMoney;
import com.aditya.personalbudget.service.HostedChitBookService.LegInput;
import com.aditya.personalbudget.service.HostedChitBookService.LegView;
import com.aditya.personalbudget.service.HostedChitBookService.TransferView;
import com.aditya.personalbudget.repository.JournalEntryRepository;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.storage.ConcurrentUpdateException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
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
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Chits the user runs as the organiser (see {@link HostedChit}): members, the monthly schedule, collections,
 * the winner of each month and the payout.
 * <p>
 * Model, for month m (1..months): chit value = base value + (m - 1) x monthly increment, payout = chit value -
 * commission. Months are closed in order: the <i>current</i> month is the first one whose payout is not done; its
 * winner is picked (from members who have not won yet), then the payout is marked done, which locks the winner.
 * <p>
 * Two kinds of chit: FIXED (the chit value grows by a fixed step, the winner is picked or drawn, and winners may
 * pay an extra amount afterwards) and AUCTION (Margadarsi style: the chit value is fixed, members bid a discount,
 * the commission comes out of it and the rest is the dividend, so everyone pays installment - dividend).
 * <p>
 * Books (only when the chit's {@code postToBooks} is on):
 * <ul>
 *   <li><b>Collection</b>: Dr collection account / Cr Hosted Chit Funds (a liability: the members' money, held)</li>
 *   <li><b>Payout</b>: Dr Hosted Chit Funds / Cr collection account ("Chit payout - member")</li>
 *   <li><b>Commission</b>: Dr Hosted Chit Funds / Cr Income [the chosen category] ("Chit commission - chit"), and,
 *       when the commission has its own account, Dr commission account / Cr collection account</li>
 * </ul>
 * The collection and commission accounts can be existing ones or separate accounts made for the chit.
 * so the balance sheet shows what is held (collected and not yet paid out) as a liability, and only the commission
 * is income. Every change writes its own activity line (the generic recorder skips these calls).
 */
@Service
public class HostedChitService {

    public static final String SOURCE_COLLECTION = "HOSTED_CHIT_COLLECTION";
    public static final String SOURCE_PAYOUT = "HOSTED_CHIT_PAYOUT";
    public static final String SOURCE_COMMISSION = "HOSTED_CHIT_COMMISSION";
    static final String COMMISSION_CATEGORY = "Chit Commission Income";
    static final String LATE_FEE_CATEGORY = "Chit Late Payment Interest";
    private static final String AREA = "Host a Chit";
    private static final Set<String> MODES = Set.of("Cash", "UPI", "Bank");
    static final String EXTRA_NONE = "NONE";
    static final String EXTRA_PERCENT = "PERCENT";
    static final String EXTRA_FIXED = "FIXED";

    // ================================================================== requests

    /**
     * payoutAccount: where the member takes the payout (bank, account number and IFSC, or a UPI ID); upiId: the
     * member's own UPI ID (fellow members pay them on it when they win); payToAccountId: the organiser's account this
     * member pays into; payToMemberId: or a fellow member, this month's winner, they pay directly (on their link).
     */
    public record MemberInput(@NotBlank @Size(max = 100) String name, @Size(max = 20) String phone,
                              @jakarta.validation.constraints.Email @Size(max = 120) String email,
                              @Size(max = 120) String payoutAccount, Long payToAccountId,
                              @Size(max = 60) String upiId, Long payToMemberId) {

        public MemberInput(String name, String phone, String email, String payoutAccount) {
            this(name, phone, email, payoutAccount, null, null, null);
        }

        public MemberInput(String name, String phone, String email, String payoutAccount, Long payToAccountId) {
            this(name, phone, email, payoutAccount, payToAccountId, null, null);
        }
    }

    /** The organiser's signature for receipts (an SVG path in a 1000 x 300 box) and the name under it; blank removes it. */
    public record SignatureRequest(@Size(max = 20000) String signature, @Size(max = 100) String signer) {
    }

    public record ChitRequest(
            @NotBlank @Size(max = 100) String name,
            /* FIXED or AUCTION (only when creating) */
            String chitType,
            @NotNull LocalDate startMonth,
            @Min(1) @Max(28) Integer dueDay,
            @NotNull @Min(2) @Max(100) Integer memberCount,
            @NotNull @Min(2) @Max(100) Integer months,
            /* fixed chits; auction chits work it out (chit value / members) */
            @PositiveOrZero BigDecimal installment,
            @NotNull @Positive BigDecimal baseValue,
            @NotNull @PositiveOrZero BigDecimal monthlyIncrement,
            @NotNull @PositiveOrZero BigDecimal commission,
            /* winners pay extra after winning: NONE, PERCENT (of the chit value) or FIXED */
            String winnerExtraType,
            @PositiveOrZero BigDecimal winnerExtraValue,
            /* auction chits: the highest discount a member may bid, % of the chit value */
            @PositiveOrZero BigDecimal maxBidPercent,
            /* late payment interest, % a month, and the days of grace before it starts */
            @PositiveOrZero BigDecimal lateFeePercent,
            @Min(0) @Max(60) Integer lateGraceDays,
            /* the organiser's UPI ID and name, for payment links */
            @Size(max = 60) String upiId,
            @Size(max = 100) String payeeName,
            Boolean postToBooks,
            Long accountId,
            /* make a separate account for this chit's collections (instead of accountId) */
            Boolean separateCollectionAccount,
            Long commissionAccountId,
            /* make a separate account for the commission (instead of commissionAccountId) */
            Boolean separateCommissionAccount,
            Long commissionCategoryId,
            /* late payment interest: an existing account, or a separate one made for the chit */
            Long lateFeeAccountId,
            Boolean separateLateFeeAccount,
            @Size(max = 255) String notes,
            /* only when creating: the members, in order */
            List<@Valid MemberInput> members,
            Long version,
            /* planned chits: how much the installment rises each month (0: the same), and the chit table */
            @PositiveOrZero BigDecimal installmentIncrement,
            List<@Valid PlanMonth> plan,
            /* the account members pay into by default (its UPI ID or bank details go on their payment links) */
            Long payToAccountId,
            /* up to 4 letters or digits: the chit in payment notes, e.g. AC5L in AC5L-M03 (empty: made from the name) */
            @jakarta.validation.constraints.Pattern(regexp = "^$|^[A-Za-z0-9]{1,4}$", message = "The short code is 1 to 4 letters or digits") String shortCode,
            /* one of my own bank accounts the commission goes on to from the chit's commission account (optional) */
            Long commissionBankAccountId) {

        public ChitRequest(String name, String chitType, LocalDate startMonth, Integer dueDay, Integer memberCount, Integer months,
                           BigDecimal installment, BigDecimal baseValue, BigDecimal monthlyIncrement, BigDecimal commission,
                           String winnerExtraType, BigDecimal winnerExtraValue, BigDecimal maxBidPercent, BigDecimal lateFeePercent,
                           Integer lateGraceDays, String upiId, String payeeName, Boolean postToBooks, Long accountId,
                           Boolean separateCollectionAccount, Long commissionAccountId, Boolean separateCommissionAccount,
                           Long commissionCategoryId, Long lateFeeAccountId, Boolean separateLateFeeAccount, String notes,
                           List<MemberInput> members, Long version, BigDecimal installmentIncrement, List<PlanMonth> plan,
                           Long payToAccountId, String shortCode) {
            this(name, chitType, startMonth, dueDay, memberCount, months, installment, baseValue, monthlyIncrement, commission,
                    winnerExtraType, winnerExtraValue, maxBidPercent, lateFeePercent, lateGraceDays, upiId, payeeName, postToBooks,
                    accountId, separateCollectionAccount, commissionAccountId, separateCommissionAccount, commissionCategoryId,
                    lateFeeAccountId, separateLateFeeAccount, notes, members, version, installmentIncrement, plan, payToAccountId, shortCode, null);
        }

        public ChitRequest(String name, String chitType, LocalDate startMonth, Integer dueDay, Integer memberCount, Integer months,
                           BigDecimal installment, BigDecimal baseValue, BigDecimal monthlyIncrement, BigDecimal commission,
                           String winnerExtraType, BigDecimal winnerExtraValue, BigDecimal maxBidPercent, BigDecimal lateFeePercent,
                           Integer lateGraceDays, String upiId, String payeeName, Boolean postToBooks, Long accountId,
                           Boolean separateCollectionAccount, Long commissionAccountId, Boolean separateCommissionAccount,
                           Long commissionCategoryId, Long lateFeeAccountId, Boolean separateLateFeeAccount, String notes,
                           List<MemberInput> members, Long version, BigDecimal installmentIncrement, List<PlanMonth> plan,
                           Long payToAccountId) {
            this(name, chitType, startMonth, dueDay, memberCount, months, installment, baseValue, monthlyIncrement, commission,
                    winnerExtraType, winnerExtraValue, maxBidPercent, lateFeePercent, lateGraceDays, upiId, payeeName, postToBooks,
                    accountId, separateCollectionAccount, commissionAccountId, separateCommissionAccount, commissionCategoryId,
                    lateFeeAccountId, separateLateFeeAccount, notes, members, version, installmentIncrement, plan, payToAccountId, null, null);
        }

        public ChitRequest(String name, String chitType, LocalDate startMonth, Integer dueDay, Integer memberCount, Integer months,
                           BigDecimal installment, BigDecimal baseValue, BigDecimal monthlyIncrement, BigDecimal commission,
                           String winnerExtraType, BigDecimal winnerExtraValue, BigDecimal maxBidPercent, BigDecimal lateFeePercent,
                           Integer lateGraceDays, String upiId, String payeeName, Boolean postToBooks, Long accountId,
                           Boolean separateCollectionAccount, Long commissionAccountId, Boolean separateCommissionAccount,
                           Long commissionCategoryId, Long lateFeeAccountId, Boolean separateLateFeeAccount, String notes,
                           List<MemberInput> members, Long version, BigDecimal installmentIncrement, List<PlanMonth> plan) {
            this(name, chitType, startMonth, dueDay, memberCount, months, installment, baseValue, monthlyIncrement, commission,
                    winnerExtraType, winnerExtraValue, maxBidPercent, lateFeePercent, lateGraceDays, upiId, payeeName, postToBooks,
                    accountId, separateCollectionAccount, commissionAccountId, separateCommissionAccount, commissionCategoryId,
                    lateFeeAccountId, separateLateFeeAccount, notes, members, version, installmentIncrement, plan, null, null, null);
        }
    }

    /** One month of a planned chit's table: what each member pays and what the winner gets. */
    public record PlanMonth(@NotNull @Min(1) Integer monthNo, @PositiveOrZero BigDecimal installment, @NotNull @Positive BigDecimal payout) {
    }

    public record PlanRequest(@NotNull List<@Valid PlanMonth> months) {
    }

    /** amount: towards the installment; lateFee: late interest collected; lateFeeWaived: late interest let off. */
    public record PaymentRequest(@NotNull Long memberId, @NotNull @Min(1) Integer monthNo, @NotNull @PositiveOrZero BigDecimal amount,
                                 @PositiveOrZero BigDecimal lateFee, @PositiveOrZero BigDecimal lateFeeWaived,
                                 @Size(max = 60) String reference,
                                 LocalDate paidDate, String mode, @Size(max = 255) String note,
                                 /* the user confirmed a payment above the installment */
                                 Boolean allowExcess, Long version,
                                 /* the account the money came into (empty: the chit's collections account) */
                                 Long accountId,
                                 /* the member paid this month's winner directly (the winner: set off against the payout) */
                                 Long paidToMemberId) {
    }

    /** direct: everyone left paid the month's winner directly (the winner's own: set off against the payout). */
    public record CollectAllRequest(LocalDate paidDate, String mode, Long accountId, Boolean direct) {
    }

    /** bid: auction chits, the winning bid (the discount the winner gives up). */
    public record WinnerRequest(@NotNull Long memberId, Boolean random, @PositiveOrZero BigDecimal bid) {
    }

    /**
     * legs: the accounts the payout is paid from, each with its amount, mode and reference (they add up to the
     * payout); empty means all of it from the chit's collections account by {@code mode}.
     */
    public record PayoutRequest(LocalDate payoutDate, String mode, @Size(max = 60) String reference,
                                /* the user confirmed closing the month with unpaid dues */
                                Boolean allowDues,
                                /* also make the winner's digital agreement */
                                Boolean createAgreement, @Size(max = 100) String guarantorName, @Size(max = 20) String guarantorPhone,
                                List<@Valid LegInput> legs,
                                /* the winner's bank account or UPI ID it went to */
                                @Size(max = 120) String payoutTo,
                                /* where the commission is moved out of (empty: the collections account) */
                                Long commissionFromAccountId,
                                /* every payment of the month was gathered into the collections account first: it is checked, and the
                                   payout comes out of the collections (other accounts only for what the month pays above them) */
                                Boolean gathered,
                                /* the commission stays in the collections account; the organiser moves it afterwards (moveCommission) */
                                Boolean deferCommissionMove) {

        public PayoutRequest(LocalDate payoutDate, String mode, String reference, Boolean allowDues, Boolean createAgreement,
                             String guarantorName, String guarantorPhone, List<LegInput> legs, String payoutTo, Long commissionFromAccountId) {
            this(payoutDate, mode, reference, allowDues, createAgreement, guarantorName, guarantorPhone, legs, payoutTo, commissionFromAccountId, null, null);
        }
    }

    /**
     * The month's commission, out of the collections account into the chit's commission account and, optionally, on to
     * the organiser's bank account (toBank: all of it, or bankAmount).
     */
    public record CommissionMoveRequest(LocalDate date, String mode, @Size(max = 60) String reference, @Size(max = 255) String note,
                                        Boolean toBank, @PositiveOrZero BigDecimal bankAmount) {
    }

    public record AgreementRequest(@Size(max = 100) String guarantorName, @Size(max = 20) String guarantorPhone,
                                   @Size(max = 6000) String terms) {
    }

    /** allowDues: the organiser confirmed closing with dues or money still held. */
    public record CloseRequest(@Size(max = 255) String note, Boolean allowDues) {
    }

    /**
     * The stamp-paper copy of an agreement: the stamp's value and serial, the organiser's signature (drawn, or the
     * receipt signature when {@code useReceiptSignature}), the witness, and the member's ID numbers (only the last
     * 4 digits of Aadhaar and a masked PAN are kept). kycFromMember: the member adds Aadhaar, PAN and a selfie on the link.
     * A field left empty keeps what is there; clear* fields remove it.
     */
    public record BondRequest(@PositiveOrZero BigDecimal stampDuty, @Size(max = 40) String stampSerial,
                              @Size(max = 100) String organiserName, @Size(max = 20000) String organiserSignature,
                              Boolean useReceiptSignature,
                              @Size(max = 100) String witnessName, @Size(max = 20) String witnessPhone,
                              @Size(max = 150) String witnessAddress, @Size(max = 20000) String witnessSignature,
                              @Size(max = 20) String aadhaarNumber, @Size(max = 12) String pan, Boolean kycFromMember,
                              Boolean clearWitnessSignature, Boolean clearOrganiserSignature) {
    }

    // ================================================================== views

    public record ChitView(Long id, String name, String chitType, LocalDate startMonth, int dueDay, int memberCount, int months,
                           BigDecimal installment, BigDecimal baseValue, BigDecimal monthlyIncrement, BigDecimal commission,
                           String winnerExtraType, BigDecimal winnerExtraValue, BigDecimal winnerExtraAmount,
                           BigDecimal maxBidPercent, BigDecimal minBid, BigDecimal maxBid,
                           BigDecimal lateFeePercent, int lateGraceDays, String upiId, String payeeName,
                           String receiptSignature, String receiptSigner,
                           BigDecimal lateFeesCollected, BigDecimal lateFeesDue,
                           boolean postToBooks, Long accountId, String accountName, Long commissionAccountId,
                           String commissionAccountName, Long commissionCategoryId, String commissionCategoryName,
                           Long lateFeeAccountId, String lateFeeAccountName,
                           String status, boolean demo, String notes,
                           int currentMonth, int completedMonths, BigDecimal currentChitValue,
                           BigDecimal collectedThisMonth, BigDecimal expectedThisMonth, int paidThisMonth,
                           BigDecimal totalCollected, BigDecimal totalPaidOut, BigDecimal commissionEarned,
                           BigDecimal pendingDues, int pendingCount, BigDecimal held, LocalDate nextDueDate,
                           boolean structureLocked, String createdBy, LocalDateTime createdAt, Long version,
                           /* planned chits: the installment's monthly rise when the table was made */
                           BigDecimal installmentIncrement,
                           /* started: amounts, percentages, dates and the chit table no longer change */
                           boolean termsLocked,
                           /* the account members pay into by default (else the UPI ID above) */
                           Long payToAccountId, String payToAccountName,
                           /* the chit in payment notes: AC5L gives AC5L-M03 for month 3 (8 characters, fits bank statements) */
                           String shortCode,
                           /* closed by the organiser: nothing in it changes until it is re-opened */
                           boolean closed, LocalDateTime closedAt, String closedBy, String closeNote,
                           /* my bank account the commission goes on to */
                           Long commissionBankAccountId, String commissionBankAccountName) {
    }

    public record MemberView(Long id, int slot, String name, String phone, String email, String payoutAccount, Long payToAccountId,
                             /* their own UPI ID; the fellow member (a winner) they pay directly, if any */
                             String upiId, Long payToMemberId, String payToMemberName,
                             /* the account they pay into: its name and what is on their link (UPI ID or A/c ••1234) */
                             String payToAccountName, String payToSummary, Integer wonMonth,
                             BigDecimal totalPaid, BigDecimal balanceDue, BigDecimal lateFeeDue, Long version) {
    }

    /**
     * status: COMPLETED (payout done), ONGOING (the current month) or UPCOMING. Auction chits: bid and dividend once
     * the auction is recorded; until then payout is the most the winner could get ({@code estimated}).
     */
    public record MonthView(Long id, int monthNo, LocalDate dueDate, BigDecimal installment, BigDecimal chitValue,
                            BigDecimal payout, boolean estimated, BigDecimal bid, BigDecimal dividend,
                            BigDecimal commission, Long winnerMemberId, String winnerName, String drawMethod,
                            String status, boolean due, BigDecimal collected, BigDecimal expected, int paidCount,
                            LocalDate payoutDate, String payoutMode, String payoutReference, String payoutEntryNo,
                            Long payoutEntryId, String payoutTo, List<LegView> legs, Long version,
                            /* where the commission was moved from; retained: it stayed in the commission account (members paid into it) */
                            Long commissionFromAccountId, boolean commissionRetained,
                            /* paid out, the commission still in the collections account to be moved; the move on to my bank */
                            boolean commissionPending, Long commissionBankTransferId) {
    }

    /** accountId / accountName: where the money came into. */
    public record PaymentView(Long id, Long memberId, String memberName, int monthNo, BigDecimal amount, BigDecimal lateFee,
                              BigDecimal lateFeeWaived, String reference, String receiptNo, LocalDate paidDate,
                              String mode, String note, String entryNo, Long journalEntryId, int attachmentCount,
                              String createdBy, LocalDateTime createdAt, Long version, Long accountId, String accountName,
                              Long paidToMemberId, String paidToName, String batchId,
                              /* where the money went on: moved by a transfer ("to … · TR-000005"), paid out in a month */
                              String movedTo, Long transferId, Integer paidOutMonth,
                              /* part of a payout (or the chit is closed): it cannot change; why, in words */
                              boolean locked, String lockedReason,
                              /* where its money stands for the payout: IN_COLLECTIONS (came straight in), TO_MOVE (in another
                                 account, to be moved into the collections), MOVED (moved there), DIRECT (paid to the winner);
                                 and the month whose payout it was gathered for */
                              String movement, Integer movedForMonth,
                              /* where its money stands, with the payout once it is made */
                              ChitTrailService.Trail chitTrail) {
    }

    /** Late interest on one member's month: accrued so far, collected or let off, still due. */
    public record LateFeeView(Long memberId, int monthNo, int daysLate, BigDecimal accrued, BigDecimal settled, BigDecimal due) {
    }

    /** status: DRAFT (made, not yet accepted), ACCEPTED (by the member through the link) or SIGNED (on paper). */
    public record AgreementView(Long id, int monthNo, Long memberId, String memberName, String agreementNo, BigDecimal chitValue,
                                BigDecimal deduction, BigDecimal payoutAmount, LocalDate payoutDate, String payoutMode,
                                String payoutReference, Integer remainingInstallments, BigDecimal remainingAmount,
                                String guarantorName, String guarantorPhone, String terms, String contentHash, String status,
                                String acceptedName, LocalDateTime acceptedAt, String acceptedFrom, String acceptedPhone,
                                Boolean phoneMatches, String acceptedIp, String acceptedDevice, String deviceHash, String acceptedLocation,
                                String signature, String acceptanceSeal, LocalDateTime createdAt,
                                /* the stamp-paper copy */
                                BigDecimal stampDuty, String stampSerial, String organiserName, String organiserSignature,
                                String witnessName, String witnessPhone, String witnessAddress, String witnessSignature,
                                /* ID proof: numbers masked, the files (Aadhaar, PAN, selfie) */
                                String aadhaarLast4, String panMasked, boolean kycFromMember,
                                List<AttachmentService.AgreementFile> files,
                                /* the evidence as signed JSON, and this installation's digital signature over it */
                                String evidencePayload, String digitalSignature) {
    }

    /**
     * kind: COLLECTION (paymentId set), PAYOUT or COMMISSION; held is the running balance (collected - paid out -
     * commission).
     */
    /** account: the account the money came into or went out of. */
    public record LedgerRow(LocalDate date, String kind, int monthNo, String party, String mode, BigDecimal moneyIn,
                            BigDecimal moneyOut, BigDecimal held, String entryNo, String note, Long paymentId, String account) {
    }

    /** money: where the chit's money is (by account); transfers: money moved in, out of or between its accounts. */
    public record Detail(ChitView chit, List<MemberView> members, List<MonthView> schedule, List<PaymentView> payments,
                         List<LedgerRow> ledger, List<LateFeeView> lateFees, List<AgreementView> agreements,
                         ChitMoney money, List<TransferView> transfers) {
    }

    /** The dashboard line: dues still to collect across the running hosted chits. */
    public record Summary(int chits, int running, BigDecimal pendingDues, int pendingCount, BigDecimal held,
                          BigDecimal collectedThisMonth, BigDecimal expectedThisMonth, BigDecimal commissionEarned,
                          LocalDate nextDueDate) {
    }

    private final HostedChitRepository chits;
    private final HostedChitMemberRepository members;
    private final HostedChitMonthRepository months;
    private final HostedChitPaymentRepository payments;
    private final HostedChitShareRepository shares;
    private final HostedChitAgreementRepository agreements;
    private final AttachmentRepository attachments;
    private final AccountRepository accounts;
    private final CategoryRepository categoryRepository;
    private final JournalEntryRepository entries;
    private final AccountService accountService;
    private final CategoryService categoryService;
    private final LedgerService ledger;
    private final ActivityService activity;
    private final JournalLineRepository lines;
    private final HostedChitBookService book;
    private final HostedChitLegRepository legs;
    private final com.aditya.personalbudget.repository.OrganizationRepository tenants;
    private final AttachmentService files;
    private final AppSettingsService settings;
    private final ChitTrailService trails;

    public HostedChitService(HostedChitRepository chits, HostedChitMemberRepository members, HostedChitMonthRepository months,
                             HostedChitPaymentRepository payments, HostedChitShareRepository shares,
                             HostedChitAgreementRepository agreements, AttachmentRepository attachments,
                             AccountRepository accounts, CategoryRepository categoryRepository,
                             JournalEntryRepository entries, AccountService accountService, CategoryService categoryService,
                             LedgerService ledger, ActivityService activity, JournalLineRepository lines,
                             HostedChitBookService book, HostedChitLegRepository legs,
                             com.aditya.personalbudget.repository.OrganizationRepository tenants, AttachmentService files,
                             AppSettingsService settings, ChitTrailService trails) {
        this.trails = trails;
        this.files = files;
        this.settings = settings;
        this.tenants = tenants;
        this.lines = lines;
        this.book = book;
        this.legs = legs;
        this.chits = chits;
        this.members = members;
        this.months = months;
        this.payments = payments;
        this.shares = shares;
        this.agreements = agreements;
        this.attachments = attachments;
        this.accounts = accounts;
        this.categoryRepository = categoryRepository;
        this.entries = entries;
        this.accountService = accountService;
        this.categoryService = categoryService;
        this.ledger = ledger;
        this.activity = activity;
    }

    // ================================================================== queries

    public List<ChitView> list() {
        return chits.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing((HostedChit c) -> HostedChit.COMPLETED.equals(c.getStatus()))
                        .thenComparing(HostedChit::getStartMonth, Comparator.reverseOrder()))
                .map(c -> new Calc(c).view())
                .toList();
    }

    public Detail detail(Long id) {
        return new Calc(require(id)).detail();
    }

    public Summary summary() {
        List<ChitView> all = list();
        List<ChitView> running = all.stream().filter(c -> HostedChit.ACTIVE.equals(c.status())).toList();
        Function<Function<ChitView, BigDecimal>, BigDecimal> sum = f -> running.stream().map(f).reduce(Money.ZERO, BigDecimal::add);
        return new Summary(all.size(), running.size(), sum.apply(ChitView::pendingDues),
                running.stream().mapToInt(ChitView::pendingCount).sum(), sum.apply(ChitView::held),
                sum.apply(ChitView::collectedThisMonth), sum.apply(ChitView::expectedThisMonth),
                all.stream().map(ChitView::commissionEarned).reduce(Money.ZERO, BigDecimal::add),
                running.stream().map(ChitView::nextDueDate).filter(Objects::nonNull).min(Comparator.naturalOrder()).orElse(null));
    }

    // ================================================================== settings

    /** The household's chit-funds company name (new chits are named after it), and the household's name as a fallback. */
    public record ChitSettings(String companyName, String householdName, String keyFingerprint) {
    }

    public record ChitSettingsRequest(@Size(max = 60) String companyName) {
    }

    public ChitSettings chitSettings() {
        com.aditya.personalbudget.domain.entity.Organization t = tenants.findById(UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Household", UserContext.tenantId()));
        return new ChitSettings(t.getChitCompanyName(), t.getName(), null);
    }

    @Transactional
    public ChitSettings saveChitSettings(ChitSettingsRequest r) {
        com.aditya.personalbudget.domain.entity.Organization t = tenants.findById(UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Household", UserContext.tenantId()));
        String name = blank(r.companyName());
        if (name != null) {
            name = name.replaceAll("\\s+", " ");
            if (!name.matches("[\\p{L}\\p{N} .&'()-]{2,60}")) {
                throw new BusinessException("The company name can have letters, digits, spaces and . & ' ( ) - (2 to 60)");
            }
        }
        t.setChitCompanyName(name);
        tenants.save(t);
        activity.record("CHANGED", AREA, name == null ? "Cleared the chit-funds company name" : "Chit-funds company name · " + name);
        return chitSettings();
    }

    // ================================================================== create / update / delete

    @Transactional
    public Detail create(ChitRequest r) {
        if (!Objects.equals(r.memberCount(), r.months())) {
            throw new BusinessException("Members (" + r.memberCount() + ") must equal the months (" + r.months()
                    + "): each member wins exactly once");
        }
        List<MemberInput> list = cleanMembers(r.members() == null ? List.of() : r.members());
        if (list.size() != r.memberCount()) {
            throw new BusinessException("Add all " + r.memberCount() + " members (" + list.size() + " added)");
        }
        HostedChit c = new HostedChit();
        c.setTenantId(UserContext.tenantId());
        c.setStatus(HostedChit.ACTIVE);
        c.setDemo(false);
        c.setCreatedBy(UserContext.username());
        c.setCreatedAt(LocalDateTime.now());
        c.setStartMonth(r.startMonth().withDayOfMonth(1));
        c.setMemberCount(r.memberCount());
        c.setMonths(r.months());
        c.setChitType(HostedChit.TYPE_AUCTION.equalsIgnoreCase(r.chitType()) ? HostedChit.TYPE_AUCTION
                : HostedChit.TYPE_PLANNED.equalsIgnoreCase(r.chitType()) ? HostedChit.TYPE_PLANNED : HostedChit.TYPE_FIXED);
        c.setPostToBooks(true);   // a new chit is always recorded in the accounts
        apply(c, r, false);
        c = chits.save(c);
        book.claimAccounts(c);   // its new accounts were made before it had an id
        addMembersAndMonths(c, list);
        if (planned(c)) {
            writePlan(c, r.plan() == null ? List.of() : r.plan(), true);
        }
        activity.record("ADDED", AREA, "Started a hosted chit · " + c.getName() + " · " + (auction(c) ? "auction · " : planned(c) ? "planned · " : "")
                + ActivityService.money(c.getBaseValue()) + " · " + c.getMemberCount() + " members");
        return detail(c.getId());
    }

    @Transactional
    public Detail update(Long id, ChitRequest r) {
        HostedChit c = editable(id);
        if (r.version() != null && !Objects.equals(r.version(), c.getVersion())) {
            throw new ConcurrentUpdateException("hosted_chits", id);
        }
        boolean locked = structureLocked(c);
        LocalDate start = r.startMonth().withDayOfMonth(1);
        if (locked && (!start.equals(c.getStartMonth()) || !r.memberCount().equals(c.getMemberCount()) || !r.months().equals(c.getMonths()))) {
            throw new BusinessException("The start month, members and months cannot change once collections or winners are recorded");
        }
        if (!locked && (!r.memberCount().equals(c.getMemberCount()) || !r.months().equals(c.getMonths()))) {
            throw new BusinessException("To change the number of members or months, delete this chit and host it again");
        }
        boolean started = started(c);
        if (started) {
            List<String> changed = changedTerms(c, r);
            if (!changed.isEmpty()) {
                throw new BusinessException(c.getName() + " has started, so its " + String.join(", ", changed)
                        + " cannot change. Only the name, notes, UPI details and accounts can be edited");
            }
        }
        c.setStartMonth(start);
        apply(c, r, started);
        chits.save(c);
        book.claimAccounts(c);
        activity.record("CHANGED", AREA, "Edited a hosted chit · " + c.getName()
                + (Boolean.TRUE.equals(c.getPostToBooks()) ? " · posts to the books" : " · tracked here only"));
        return detail(id);
    }

    /**
     * Closes a finished chit (every month paid out): its books are final and nothing in it changes until it is
     * re-opened. Dues still owed, or members' money still held, need {@code allowDues}.
     */
    @Transactional
    public Detail close(Long id, CloseRequest r) {
        HostedChit c = require(id);
        if (closed(c)) {
            throw new BusinessException(c.getName() + " is already closed");
        }
        Calc calc = new Calc(c);
        if (calc.completedMonths < c.getMonths()) {
            int left = c.getMonths() - calc.completedMonths;
            throw new BusinessException(c.getName() + " still has " + left + " month" + (left == 1 ? "" : "s")
                    + " to pay out; a chit is closed once every winner is paid");
        }
        ChitView v = calc.view();
        List<String> open = new ArrayList<>();
        if (v.pendingDues().signum() > 0) {
            open.add(ActivityService.money(v.pendingDues()) + " still owed (" + v.pendingCount() + " payment" + (v.pendingCount() == 1 ? "" : "s") + ")");
        }
        if (v.lateFeesDue().signum() > 0) open.add(ActivityService.money(v.lateFeesDue()) + " late interest not collected");
        if (v.held().signum() != 0) open.add(ActivityService.money(v.held().abs()) + (v.held().signum() > 0 ? " of members' money still with you" : " paid out more than collected"));
        if (!open.isEmpty() && (r == null || !Boolean.TRUE.equals(r.allowDues()))) {
            throw new BusinessException(String.join("; ", open) + ". Confirm to close the chit anyway: it can be re-opened to settle them.");
        }
        c.setStatus(HostedChit.CLOSED);
        c.setClosedAt(LocalDateTime.now());
        c.setClosedBy(UserContext.get().fullName());
        c.setCloseNote(r == null ? null : blank(r.note()));
        chits.save(c);
        activity.record("CHANGED", AREA, "Closed the chit · " + c.getName() + " · commission " + ActivityService.money(v.commissionEarned())
                + (open.isEmpty() ? "" : " · closed with " + String.join(", ", open)));
        return detail(id);
    }

    /** Re-opens a closed chit, so payments, payouts and settings can change again. */
    @Transactional
    public Detail reopen(Long id) {
        HostedChit c = require(id);
        if (!closed(c)) {
            throw new BusinessException(c.getName() + " is not closed");
        }
        Calc calc = new Calc(c);
        c.setStatus(calc.completedMonths >= c.getMonths() ? HostedChit.COMPLETED : HostedChit.ACTIVE);
        c.setClosedAt(null);
        c.setClosedBy(null);
        c.setCloseNote(null);
        chits.save(c);
        activity.record("CHANGED", AREA, "Re-opened the chit · " + c.getName());
        return detail(id);
    }

    static boolean closed(HostedChit c) {
        return HostedChit.CLOSED.equals(c.getStatus());
    }

    /** Nothing in a closed chit changes: the organiser re-opens it first. */
    static void requireOpen(HostedChit c) {
        if (closed(c)) {
            throw new BusinessException(c.getName() + " is closed" + (c.getClosedAt() != null ? " (" + c.getClosedAt().toLocalDate() + ")" : "")
                    + ": its payments, payouts and settings are final. Re-open it to make a change.");
        }
    }

    /**
     * Deletes a chit. Accepted or signed agreements are legal records: a chit with any cannot be deleted. When money
     * is recorded (payments or payouts), the chit is only deleted with {@code revert} and its name typed as
     * {@code confirm}: every payment and payout is undone and its journal entries are taken out of the books first.
     */
    @Transactional
    public void delete(Long id, boolean revert, String confirm) {
        HostedChit c = editable(id);
        String name = c.getName();
        long signed = agreements.findByChitId(id).stream().filter(a -> !HostedChitAgreement.DRAFT.equals(a.getStatus())).count();
        if (signed > 0) {
            throw new BusinessException(name + " has " + signed + " accepted agreement" + (signed == 1 ? "" : "s")
                    + ", kept as a legal record, so it cannot be deleted");
        }
        List<HostedChitPayment> paid = payments.findByChitId(id);
        long payouts = months.findByChitId(id).stream().filter(m -> m.getPayoutDate() != null).count();
        int moves = book.transfersOf(id).size();
        long entries = paid.stream().filter(p -> p.getJournalEntryId() != null).count() + moves
                + months.findByChitId(id).stream().mapToLong(m -> (m.getPayoutEntryId() != null ? 1 : 0) + (m.getCommissionEntryId() != null ? 1 : 0)
                        + (m.getCommissionTransferEntryId() != null ? 1 : 0)).sum();
        boolean recorded = !paid.isEmpty() || payouts > 0 || moves > 0;
        if (recorded && !revert) {
            throw new BusinessException(name + " has " + paid.size() + " payment" + (paid.size() == 1 ? "" : "s") + ", " + payouts
                    + " payout" + (payouts == 1 ? "" : "s") + (moves > 0 ? " and " + moves + " transfer" + (moves == 1 ? "" : "s") : "")
                    + " recorded. Revert them before deleting the chit.");
        }
        if (recorded && (confirm == null || !confirm.trim().equalsIgnoreCase(name.trim()))) {
            throw new BusinessException("Type the chit's name, " + name + ", to confirm");
        }
        removeChit(c);
        activity.record("DELETED", AREA, "Deleted a hosted chit · " + name + (recorded ? " · reverted " + paid.size() + " payment(s), "
                + payouts + " payout(s) and " + entries + " journal entr" + (entries == 1 ? "y" : "ies") : ""));
    }

    /** termsLocked: the chit has started, so only the name, notes, UPI details and accounts change. */
    private void apply(HostedChit c, ChitRequest r, boolean termsLocked) {
        boolean creating = c.getId() == null;
        c.setName(r.name().trim());
        if (!termsLocked) {
            applyTerms(c, r);
        }
        c.setNotes(blank(r.notes()));
        c.setPayToAccountId(r.payToAccountId() == null ? null : requirePayTo(r.payToAccountId()).getId());
        c.setShortCode(uniqueShortCode(c, r.shortCode()));
        String upi = blank(r.upiId());
        if (upi != null && !upi.matches("[\\w.\\-]{2,}@[A-Za-z][\\w.]{1,}")) {
            throw new BusinessException("The UPI ID should look like name@bank");
        }
        c.setUpiId(upi);
        c.setPayeeName(blank(r.payeeName()));
        // once recorded in the accounts, always: turning it off would leave half the chit in the books
        c.setPostToBooks(Boolean.TRUE.equals(c.getPostToBooks()) || Boolean.TRUE.equals(r.postToBooks()));
        if (c.getPostToBooks()) {
            // the collections and the commission are always the chit's own accounts in the chit book (Chit accounts):
            // made with the chit and never changed (older chits keep the accounts they were made with)
            if (c.getAccountId() == null) {
                c.setAccountId(book.newChitAccount(c.getName(), c.getId(), Account.ROLE_COLLECTION).getId());
            }
            if (c.getCommissionAccountId() == null && creating) {
                c.setCommissionAccountId(book.newChitAccount(c.getName(), c.getId(), Account.ROLE_COMMISSION).getId());
            }
            // the commission can go on to one of my own bank accounts (older requests named it as the commission account)
            Long bank = r.commissionBankAccountId() != null ? r.commissionBankAccountId()
                    : creating && r.commissionAccountId() != null && !Boolean.TRUE.equals(r.separateCommissionAccount()) ? r.commissionAccountId() : null;
            if (bank != null) {
                Account a = book.requireMoneyAccount(bank, c.getId(), "Commission bank account");
                if (a.isChitBook()) {
                    throw new BusinessException("The commission goes on to one of your own bank accounts; " + a.getName() + " is a chit account");
                }
            }
            c.setCommissionBankAccountId(bank);
            Account lateAccount = Boolean.TRUE.equals(r.separateLateFeeAccount()) && !creating && c.getLateFeeAccountId() != null
                    && accounts.findById(c.getLateFeeAccountId()).map(a -> c.getId().equals(a.getHostedChitId())).orElse(false)
                    ? accountService.require(c.getLateFeeAccountId())
                    : Boolean.TRUE.equals(r.separateLateFeeAccount())
                    ? book.newChitAccount(c.getName(), c.getId(), Account.ROLE_LATE_FEE)
                    : r.lateFeeAccountId() != null ? book.requireMoneyAccount(r.lateFeeAccountId(), c.getId(), "Late interest") : null;
            c.setLateFeeAccountId(lateAccount == null ? null : lateAccount.getId());
            c.setCommissionCategoryId(r.commissionCategoryId() != null
                    ? categoryService.require(r.commissionCategoryId(), CategoryKind.INCOME).getId()
                    : commissionCategory(c).getId());
        } else {
            c.setAccountId(r.accountId());
            c.setCommissionAccountId(r.commissionAccountId());
            c.setCommissionCategoryId(r.commissionCategoryId());
            c.setLateFeeAccountId(r.lateFeeAccountId());
        }
    }


    /**
     * Planned chits: changes the chit table. A month already paid out keeps its figures; what members pay in a month
     * stays once payments are recorded for it.
     */
    @Transactional
    public Detail updatePlan(Long chitId, PlanRequest r) {
        HostedChit c = editable(chitId);
        if (!planned(c)) {
            throw new BusinessException("Only a planned chit has a chit table to edit");
        }
        if (started(c)) {
            throw new BusinessException(c.getName() + " has started: its chit table is what the members agreed to and cannot change");
        }
        int changed = writePlan(c, r.months(), false);
        activity.record("CHANGED", AREA, "Edited the chit table · " + c.getName() + " · " + changed + " month" + (changed == 1 ? "" : "s"));
        return detail(chitId);
    }

    /** Writes a planned chit's table; on create every month needs its payout. Returns how many months changed. */
    private int writePlan(HostedChit c, List<PlanMonth> plan, boolean creating) {
        Map<Integer, PlanMonth> byNo = new HashMap<>();
        for (PlanMonth p : plan) {
            if (p.monthNo() < 1 || p.monthNo() > c.getMonths()) {
                throw new BusinessException("Month must be between 1 and " + c.getMonths());
            }
            byNo.put(p.monthNo(), p);
        }
        Set<Integer> paidMonths = payments.findByChitId(c.getId()).stream().map(HostedChitPayment::getMonthNo).collect(Collectors.toSet());
        int changed = 0;
        List<HostedChitMonth> rows = months.findByChitId(c.getId()).stream().sorted(Comparator.comparing(HostedChitMonth::getMonthNo)).toList();
        for (HostedChitMonth m : rows) {
            PlanMonth p = byNo.get(m.getMonthNo());
            if (p == null) {
                if (creating) throw new BusinessException("Set what the winner gets in month " + m.getMonthNo());
                continue;
            }
            BigDecimal installment = p.installment() != null && p.installment().signum() > 0 ? Money.round(p.installment())
                    : c.getInstallment().add(Money.nz(c.getInstallmentIncrement()).multiply(BigDecimal.valueOf(m.getMonthNo() - 1L)));
            BigDecimal payout = Money.round(p.payout());
            boolean same = installment.compareTo(Money.nz(m.getPlannedInstallment())) == 0 && payout.compareTo(Money.nz(m.getPlannedPayout())) == 0;
            if (same) continue;
            if (m.getPayoutDate() != null) {
                throw new BusinessException("Month " + m.getMonthNo() + " is paid out; its figures cannot change");
            }
            if (m.getPlannedInstallment() != null && installment.compareTo(m.getPlannedInstallment()) != 0 && paidMonths.contains(m.getMonthNo())) {
                throw new BusinessException("Payments are recorded for month " + m.getMonthNo() + "; what members pay that month cannot change");
            }
            m.setPlannedInstallment(installment);
            m.setPlannedPayout(payout);
            months.save(m);
            changed++;
        }
        return changed;
    }

    private void addMembersAndMonths(HostedChit c, List<MemberInput> list) {
        List<HostedChitMember> rows = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            HostedChitMember m = new HostedChitMember();
            m.setTenantId(c.getTenantId());
            m.setChitId(c.getId());
            m.setSlot(i + 1);
            m.setName(ActivityService.cut(list.get(i).name().trim(), 100));
            m.setPhone(blank(list.get(i).phone()));
            m.setEmail(blank(list.get(i).email()));
            m.setPayoutAccount(blank(list.get(i).payoutAccount()));
            m.setPayToAccountId(list.get(i).payToAccountId() == null ? null : requirePayTo(list.get(i).payToAccountId()).getId());
            m.setUpiId(cleanUpi(list.get(i).upiId(), list.get(i).name()));
            rows.add(m);
        }
        members.saveAll(rows);
        List<HostedChitMonth> schedule = new ArrayList<>();
        for (int no = 1; no <= c.getMonths(); no++) {
            HostedChitMonth m = new HostedChitMonth();
            m.setTenantId(c.getTenantId());
            m.setChitId(c.getId());
            m.setMonthNo(no);
            schedule.add(m);
        }
        months.saveAll(schedule);
    }

    /**
     * Removes a chit with everything under it: the journal entries it posted, its transfers, and its own accounts
     * (an account that still has other postings stays in the chit book, without a chit).
     */
    private void removeChit(HostedChit c) {
        List<Long> journal = new ArrayList<>();
        for (HostedChitPayment p : payments.findByChitId(c.getId())) {
            if (p.getJournalEntryId() != null) journal.add(p.getJournalEntryId());
        }
        for (HostedChitMonth m : months.findByChitId(c.getId())) {
            if (m.getPayoutEntryId() != null) journal.add(m.getPayoutEntryId());
            if (m.getCommissionEntryId() != null) journal.add(m.getCommissionEntryId());
            if (m.getCommissionTransferEntryId() != null) journal.add(m.getCommissionTransferEntryId());
        }
        shares.deleteAll(shares.findByChitId(c.getId()));
        agreements.findByChitId(c.getId()).forEach(a -> files.deleteAllForAgreement(AGREEMENT_FILES, a.getId()));
        agreements.deleteAll(agreements.findByChitId(c.getId()));
        legs.deleteAll(legs.findByChitId(c.getId()));
        book.removeTransfers(c.getId());
        payments.deleteAll(payments.findByChitId(c.getId()));
        months.deleteAll(months.findByChitId(c.getId()));
        members.deleteAll(members.findByChitId(c.getId()));
        journal.forEach(ledger::delete);   // the lines carry the chit, so they go before it
        c.setAccountId(null);
        c.setCommissionAccountId(null);
        c.setLateFeeAccountId(null);
        chits.save(c);
        book.releaseAccounts(c.getId());
        chits.deleteById(c.getId());
    }

    @Transactional
    public Detail updateMember(Long chitId, Long memberId, MemberInput r) {
        HostedChit c = editable(chitId);
        HostedChitMember m = requireMember(c, memberId);
        String before = m.getName();
        String name = r.name().trim().replaceAll("\\s+", " ");
        if (members.findByChitId(chitId).stream().anyMatch(x -> !x.getId().equals(memberId) && x.getName().equalsIgnoreCase(name))) {
            throw new BusinessException("Another member is already called " + name);
        }
        m.setName(ActivityService.cut(name, 100));
        m.setPhone(cleanPhone(r.phone(), name));
        m.setEmail(blank(r.email()));
        m.setPayoutAccount(blank(r.payoutAccount()));
        m.setUpiId(cleanUpi(r.upiId(), name));
        if (r.payToAccountId() != null && r.payToMemberId() != null) {
            throw new BusinessException("Pick either an account or a fellow member for " + name + " to pay into, not both");
        }
        m.setPayToAccountId(r.payToAccountId() == null ? null : requirePayTo(r.payToAccountId()).getId());
        m.setPayToMemberId(r.payToMemberId() == null ? null : requirePayToMember(c, m, r.payToMemberId()).getId());
        members.save(m);
        activity.record("CHANGED", AREA, "Edited a member · " + c.getName() + " · " + before
                + (before.equals(m.getName()) ? "" : " → " + m.getName()));
        return detail(chitId);
    }

    @Transactional
    public Detail setReceiptSignature(Long chitId, SignatureRequest r) {
        HostedChit c = editable(chitId);
        String signature = r.signature() == null ? "" : r.signature().trim();
        if (!signature.isEmpty() && (signature.length() < 20 || !signature.matches("[MLml0-9 .\\-]+"))) {
            throw new BusinessException("Draw your signature in the box");
        }
        c.setReceiptSignature(signature.isEmpty() ? null : signature);
        c.setReceiptSigner(signature.isEmpty() ? null : blank(r.signer()));
        chits.save(c);
        activity.record("CHANGED", AREA, (signature.isEmpty() ? "Removed the receipt signature · " : "Set the receipt signature · ") + c.getName());
        return detail(chitId);
    }

    // ================================================================== collections

    @Transactional
    public Detail addPayment(Long chitId, PaymentRequest r) {
        HostedChit c = editable(chitId);
        HostedChitMember member = requireMember(c, r.memberId());
        requireMonthNo(c, r.monthNo());
        BigDecimal amount = Money.round(r.amount());
        Calc calc = new Calc(c);
        requireAuctionDone(c, calc, r.monthNo());
        checkPaidDate(c, r.paidDate());
        checkExcess(calc, member, r.monthNo(), amount, null, r.allowExcess());
        BigDecimal lateFee = Money.round(Money.nz(r.lateFee()));
        BigDecimal waived = Money.round(Money.nz(r.lateFeeWaived()));
        checkLateFee(calc, member, r.monthNo(), lateFee.add(waived), null, r.allowExcess());
        if (amount.add(lateFee).add(waived).signum() <= 0) {
            throw new BusinessException("Enter the amount received");
        }
        HostedChitMember paidTo = checkDirect(c, calc, member, r.monthNo(), r.paidToMemberId(), lateFee, amount, null);

        HostedChitPayment p = new HostedChitPayment();
        p.setTenantId(c.getTenantId());
        p.setChitId(c.getId());
        p.setMemberId(member.getId());
        p.setMonthNo(r.monthNo());
        p.setAmount(amount);
        p.setLateFee(lateFee.signum() > 0 ? lateFee : null);
        p.setLateFeeWaived(waived.signum() > 0 ? waived : null);
        p.setReference(blank(r.reference()));
        p.setPaidDate(r.paidDate() != null ? r.paidDate() : LocalDate.now());
        p.setMode(mode(r.mode()));
        p.setNote(blank(r.note()));
        p.setPaidToMemberId(paidTo == null ? null : paidTo.getId());
        p.setAccountId(paidTo != null && Boolean.TRUE.equals(c.getPostToBooks()) ? book.directAccount().getId() : receivedInto(c, r.accountId()));
        p.setCreatedBy(UserContext.username());
        p.setCreatedAt(LocalDateTime.now());
        p = payments.save(p);
        p.setReceiptNo(String.format("RC-%06d", p.getId()));
        if (Boolean.TRUE.equals(c.getPostToBooks()) && amount.add(lateFee).signum() > 0) {
            p.setJournalEntryId(ledger.post(collectionDraft(c, member, p)).getId());
        }
        payments.save(p);
        activity.record("POSTED", AREA, "Collected · " + member.getName() + " · " + c.getName() + " month " + p.getMonthNo()
                + " · " + ActivityService.money(amount) + (lateFee.signum() > 0 ? " + late interest " + ActivityService.money(lateFee) : "")
                + " · " + p.getMode() + (paidTo != null ? directWords(member, paidTo) : "") + " · " + p.getReceiptNo());
        return detail(chitId);
    }

    private static String directWords(HostedChitMember member, HostedChitMember winner) {
        return member.getId().equals(winner.getId()) ? " · set off against the payout" : " · paid directly to " + winner.getName();
    }

    /**
     * A payment made straight to the month's winner instead of to the organiser: allowed only to the month's winner,
     * before the month is paid out, without late interest (that is the organiser's), and only while the payments made
     * directly stay within what the winner gets (the commission must still reach the organiser). Returns the winner,
     * or null for an ordinary payment.
     */
    private HostedChitMember checkDirect(HostedChit c, Calc calc, HostedChitMember member, int monthNo, Long paidToMemberId,
                                         BigDecimal lateFee, BigDecimal amount, Long ignorePaymentId) {
        if (paidToMemberId == null) return null;
        HostedChitMonth month = calc.month(monthNo);
        if (month.getWinnerMemberId() == null) {
            throw new BusinessException("Choose the winner of month " + monthNo + " first: members pay the winner directly");
        }
        if (!month.getWinnerMemberId().equals(paidToMemberId)) {
            throw new BusinessException("Members can pay directly only to the winner of month " + monthNo);
        }
        if (month.getPayoutDate() != null) {
            throw new BusinessException("Month " + monthNo + " is already paid out; undo the payout to add payments made to the winner");
        }
        if (lateFee.signum() > 0) {
            throw new BusinessException("Late interest is yours: record it as a separate payment to you");
        }
        BigDecimal already = calc.paymentList.stream()
                .filter(p -> p.getMonthNo() == monthNo && paidToMemberId.equals(p.getPaidToMemberId()) && !p.getId().equals(ignorePaymentId))
                .map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal payout = payoutOf(c, calc, month);
        if (already.add(amount).compareTo(payout) > 0) {
            throw new BusinessException("Paid directly, the winner would get " + ActivityService.money(already.add(amount)) + ", more than the "
                    + ActivityService.money(payout) + " due to them; the rest (your commission) has to come to you");
        }
        return requireMember(c, paidToMemberId);
    }

    /** What the month's winner gets: planned chits, the chit table's figure. */
    private static BigDecimal payoutOf(HostedChit c, Calc calc, HostedChitMonth month) {
        if (planned(c)) return Money.nz(month.getPlannedPayout());
        BigDecimal value = calc.chitValue(month.getMonthNo());
        return auction(c) ? value.subtract(Money.nz(month.getBidAmount())) : value.subtract(c.getCommission().min(value));
    }

    /** Payments made directly to the winner cannot change once the payout that cleared them is recorded. */
    /** The money terms: payment day, amounts, commission, winner extra, bids and late interest (checked). */
    private void applyTerms(HostedChit c, ChitRequest r) {
        c.setDueDay(r.dueDay() == null ? 5 : r.dueDay());
        c.setBaseValue(Money.round(r.baseValue()));
        c.setCommission(Money.round(r.commission()));
        if (planned(c)) {
            // what is collected and paid out comes from the chit table, month by month
            if (r.installment() == null || r.installment().signum() <= 0) {
                throw new BusinessException("Enter how much each member pays a month");
            }
            c.setInstallment(Money.round(r.installment()));
            c.setInstallmentIncrement(Money.round(Money.nz(r.installmentIncrement())));
            c.setBaseValue(c.getInstallment().multiply(BigDecimal.valueOf(c.getMemberCount())));
            c.setMonthlyIncrement(Money.ZERO);
            c.setCommission(Money.ZERO);
            c.setMaxBidPercent(null);
        } else if (auction(c)) {
            // the chit value is fixed and shared equally: installment = chit value / members
            c.setInstallment(Money.round(c.getBaseValue().divide(BigDecimal.valueOf(c.getMemberCount()), 2, java.math.RoundingMode.HALF_UP)));
            c.setMonthlyIncrement(Money.ZERO);
            BigDecimal max = r.maxBidPercent() == null ? BigDecimal.valueOf(40) : r.maxBidPercent();
            if (max.signum() <= 0 || max.compareTo(BigDecimal.valueOf(40)) > 0) {
                throw new BusinessException("The highest bid must be between 1% and 40% of the chit value");
            }
            c.setMaxBidPercent(max);
            if (c.getCommission().compareTo(maxBid(c)) >= 0) {
                throw new BusinessException("The commission must be less than the highest bid (" + ActivityService.money(maxBid(c)) + ")");
            }
        } else {
            if (r.installment() == null || r.installment().signum() <= 0) {
                throw new BusinessException("Enter how much each member pays a month");
            }
            c.setInstallment(Money.round(r.installment()));
            c.setMonthlyIncrement(Money.round(r.monthlyIncrement()));
            c.setMaxBidPercent(null);
        }
        BigDecimal lastValue = c.getBaseValue().add(c.getMonthlyIncrement().multiply(BigDecimal.valueOf(c.getMonths() - 1L)));
        if (c.getCommission().compareTo(c.getBaseValue()) >= 0) {
            throw new BusinessException("The commission must be less than the chit value (" + ActivityService.money(c.getBaseValue()) + ")");
        }
        if (lastValue.signum() <= 0) {
            throw new BusinessException("The chit value must stay above zero");
        }
        String extraType = auction(c) || planned(c) || r.winnerExtraType() == null || r.winnerExtraType().isBlank() ? EXTRA_NONE
                : r.winnerExtraType().trim().toUpperCase();
        if (!Set.of(EXTRA_NONE, EXTRA_PERCENT, EXTRA_FIXED).contains(extraType)) {
            throw new BusinessException("Winner extra must be none, a percent or a fixed amount");
        }
        BigDecimal extraValue = EXTRA_NONE.equals(extraType) ? Money.ZERO : Money.nz(r.winnerExtraValue());
        if (!EXTRA_NONE.equals(extraType) && extraValue.signum() <= 0) {
            throw new BusinessException("Enter how much extra winners pay");
        }
        if (EXTRA_PERCENT.equals(extraType) && extraValue.compareTo(Money.HUNDRED) > 0) {
            throw new BusinessException("The winner extra can be at most 100% of the chit value");
        }
        c.setWinnerExtraType(extraType);
        c.setWinnerExtraValue(extraValue);
        BigDecimal late = Money.nz(r.lateFeePercent());
        if (late.compareTo(BigDecimal.TEN) > 0) {
            throw new BusinessException("Late payment interest can be at most 10% a month");
        }
        c.setLateFeePercent(late.signum() > 0 ? late : null);
        c.setLateGraceDays(r.lateGraceDays() == null ? 0 : r.lateGraceDays());
    }

    /**
     * A chit has started once its first month has come or anything is recorded (a payment or a winner): from then on
     * its terms (amounts, percentages, dates and, for planned chits, the chit table) are what the members agreed to.
     */
    boolean started(HostedChit c) {
        return !LocalDate.now().isBefore(c.getStartMonth()) || structureLocked(c);
    }

    /** The terms the request would change, in words ("the commission", "late interest" ...). */
    private List<String> changedTerms(HostedChit c, ChitRequest r) {
        List<String> out = new ArrayList<>();
        java.util.function.BiPredicate<BigDecimal, BigDecimal> differs = (a, b) -> Money.nz(a).compareTo(Money.nz(b)) != 0;
        if (!r.startMonth().withDayOfMonth(1).equals(c.getStartMonth())) out.add("start month");
        if (r.dueDay() != null && !r.dueDay().equals(c.getDueDay())) out.add("payment day");
        if (differs.test(r.lateFeePercent(), c.getLateFeePercent())) out.add("late interest");
        if ((r.lateGraceDays() == null ? 0 : r.lateGraceDays()) != (c.getLateGraceDays() == null ? 0 : c.getLateGraceDays())) out.add("grace days");
        if (auction(c)) {
            if (differs.test(r.baseValue(), c.getBaseValue())) out.add("chit value");
            if (differs.test(r.commission(), c.getCommission())) out.add("commission");
            if (differs.test(r.maxBidPercent(), c.getMaxBidPercent())) out.add("highest bid");
        } else if (!planned(c)) {
            if (differs.test(r.installment(), c.getInstallment())) out.add("monthly installment");
            if (differs.test(r.baseValue(), c.getBaseValue())) out.add("chit value");
            if (differs.test(r.monthlyIncrement(), c.getMonthlyIncrement())) out.add("monthly rise");
            if (differs.test(r.commission(), c.getCommission())) out.add("commission");
            String type = r.winnerExtraType() == null || r.winnerExtraType().isBlank() ? EXTRA_NONE : r.winnerExtraType().trim().toUpperCase();
            if (!type.equals(extraType(c)) || differs.test(EXTRA_NONE.equals(type) ? Money.ZERO : r.winnerExtraValue(), c.getWinnerExtraValue())) out.add("winner extra");
        }
        return out;
    }

    /**
     * A payment the month's payout paid out (recorded before the payout, or carried by a payout's part) cannot change:
     * the payout, its journal and the winner's agreement rest on it. Undo the payout first, or record a new payment.
     */
    private static void requireDirectOpen(Calc calc, HostedChitPayment p) {
        String why = calc.lockReason(p);
        if (why != null) {
            String receipt = p.getReceiptNo() != null ? p.getReceiptNo() : "This payment";
            throw new BusinessException(receipt + " can no longer change: " + why + ". Undo that payout first"
                    + (p.getPaidToMemberId() == null ? ", or record a separate payment for any difference" : ""));
        }
    }

    /** Reverts payments recorded together ("Everyone has paid"), with their journal entries. */
    @Transactional
    public Detail revertBatch(Long chitId, int monthNo, String batchId) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        List<HostedChitPayment> list = calc.paymentList.stream()
                .filter(p -> batchId.equals(p.getBatchId()) && p.getMonthNo() == monthNo).toList();
        if (list.isEmpty()) {
            throw new BusinessException("Those payments were already undone");
        }
        list.forEach(p -> requireDirectOpen(calc, p));
        BigDecimal total = Money.ZERO;
        for (HostedChitPayment p : list) {
            Long entryId = p.getJournalEntryId();
            shares.deleteAll(shares.findByChitId(c.getId()).stream().filter(x -> p.getId().equals(x.getPaymentId())).toList());
            payments.deleteById(p.getId());
            ledger.deleteForSource(SOURCE_COLLECTION, p.getId(), entryId);
            total = total.add(p.getAmount());
        }
        activity.record("DELETED", AREA, "Reverted \"everyone has paid\" · " + c.getName() + " month " + monthNo + " · "
                + list.size() + " payment" + (list.size() == 1 ? "" : "s") + " · " + ActivityService.money(total));
        return detail(chitId);
    }

    @Transactional
    public Detail updatePayment(Long chitId, Long paymentId, PaymentRequest r) {
        HostedChit c = editable(chitId);
        HostedChitPayment p = requirePayment(c, paymentId);
        if (r.version() != null && !Objects.equals(r.version(), p.getVersion())) {
            throw new ConcurrentUpdateException("hosted_chit_payments", paymentId);
        }
        HostedChitMember member = requireMember(c, p.getMemberId());
        BigDecimal amount = Money.round(r.amount());
        Calc calc = new Calc(c);
        checkPaidDate(c, r.paidDate());
        checkExcess(calc, member, p.getMonthNo(), amount, p.getId(), r.allowExcess());
        BigDecimal lateFee = Money.round(Money.nz(r.lateFee()));
        BigDecimal waived = Money.round(Money.nz(r.lateFeeWaived()));
        checkLateFee(calc, member, p.getMonthNo(), lateFee.add(waived), p.getId(), r.allowExcess());
        if (amount.add(lateFee).add(waived).signum() <= 0) {
            throw new BusinessException("Enter the amount received");
        }
        requireDirectOpen(calc, p);
        HostedChitMember paidTo = checkDirect(c, calc, member, p.getMonthNo(), r.paidToMemberId(), lateFee, amount, p.getId());
        BigDecimal before = p.getAmount();
        p.setAmount(amount);
        p.setLateFee(lateFee.signum() > 0 ? lateFee : null);
        p.setLateFeeWaived(waived.signum() > 0 ? waived : null);
        p.setReference(blank(r.reference()));
        if (r.paidDate() != null) p.setPaidDate(r.paidDate());
        p.setMode(mode(r.mode()));
        p.setNote(blank(r.note()));
        p.setPaidToMemberId(paidTo == null ? null : paidTo.getId());
        p.setAccountId(paidTo != null && Boolean.TRUE.equals(c.getPostToBooks()) ? book.directAccount().getId()
                : receivedInto(c, r.accountId() != null ? r.accountId() : directAccountId(p.getAccountId()) ? null : p.getAccountId()));
        boolean post = amount.add(lateFee).signum() > 0;
        if (p.getJournalEntryId() != null && post) {
            ledger.repost(p.getJournalEntryId(), collectionDraft(c, member, p));
        } else if (p.getJournalEntryId() != null) {
            Long entryId = p.getJournalEntryId();
            p.setJournalEntryId(null);
            payments.save(p);
            ledger.deleteForSource(SOURCE_COLLECTION, p.getId(), entryId);
        } else if (Boolean.TRUE.equals(c.getPostToBooks()) && post) {
            p.setJournalEntryId(ledger.post(collectionDraft(c, member, p)).getId());
        }
        if (p.getReceiptNo() == null) p.setReceiptNo(String.format("RC-%06d", p.getId()));
        payments.save(p);
        activity.record("CHANGED", AREA, "Edited a collection · " + member.getName() + " · " + c.getName() + " month "
                + p.getMonthNo() + " · " + ActivityService.money(before) + " → " + ActivityService.money(amount));
        return detail(chitId);
    }

    @Transactional
    public Detail deletePayment(Long chitId, Long paymentId) {
        HostedChit c = editable(chitId);
        HostedChitPayment p = requirePayment(c, paymentId);
        HostedChitMember member = requireMember(c, p.getMemberId());
        requireDirectOpen(new Calc(c), p);
        Long entryId = p.getJournalEntryId();
        shares.deleteAll(shares.findByChitId(c.getId()).stream().filter(x -> p.getId().equals(x.getPaymentId())).toList());
        payments.deleteById(p.getId());
        ledger.deleteForSource(SOURCE_COLLECTION, p.getId(), entryId);
        activity.record("DELETED", AREA, "Undid a collection · " + member.getName() + " · " + c.getName() + " month "
                + p.getMonthNo() + " · " + ActivityService.money(p.getAmount()));
        return detail(chitId);
    }

    /** Records whatever each member still owes for the month, in one go. */
    @Transactional
    public Detail collectAll(Long chitId, int monthNo, CollectAllRequest r) {
        HostedChit c = editable(chitId);
        requireMonthNo(c, monthNo);
        Calc calc = new Calc(c);
        requireAuctionDone(c, calc, monthNo);
        LocalDate date = r != null && r.paidDate() != null ? r.paidDate() : LocalDate.now();
        checkPaidDate(c, date);
        String mode = mode(r == null ? null : r.mode());
        boolean direct = r != null && Boolean.TRUE.equals(r.direct());
        HostedChitMonth month = calc.month(monthNo);
        Long into = direct && Boolean.TRUE.equals(c.getPostToBooks()) ? book.directAccount().getId() : receivedInto(c, r == null ? null : r.accountId());
        if (direct) {
            BigDecimal owing = calc.memberList.stream().map(m -> calc.due(m.getId(), monthNo).subtract(calc.paid(m.getId(), monthNo)).max(Money.ZERO))
                    .reduce(Money.ZERO, BigDecimal::add);
            checkDirect(c, calc, null, monthNo, month.getWinnerMemberId() == null ? -1L : month.getWinnerMemberId(), Money.ZERO, owing, null);
        }
        String batch = java.util.UUID.randomUUID().toString();
        int count = 0;
        BigDecimal total = Money.ZERO;
        for (HostedChitMember m : calc.memberList) {
            BigDecimal rest = calc.due(m.getId(), monthNo).subtract(calc.paid(m.getId(), monthNo));
            if (rest.signum() <= 0) continue;
            HostedChitPayment p = new HostedChitPayment();
            p.setTenantId(c.getTenantId());
            p.setChitId(c.getId());
            p.setMemberId(m.getId());
            p.setMonthNo(monthNo);
            p.setAmount(rest);
            p.setPaidDate(date);
            p.setMode(mode);
            p.setAccountId(into);
            p.setPaidToMemberId(direct ? month.getWinnerMemberId() : null);
            p.setBatchId(batch);
            p.setNote(direct ? "Paid the winner directly (everyone at once)" : "Marked paid for the month");
            p.setCreatedBy(UserContext.username());
            p.setCreatedAt(LocalDateTime.now());
            p = payments.save(p);
            p.setReceiptNo(String.format("RC-%06d", p.getId()));
            payments.save(p);
            if (Boolean.TRUE.equals(c.getPostToBooks())) {
                p.setJournalEntryId(ledger.post(collectionDraft(c, m, p)).getId());
                payments.save(p);
            }
            count++;
            total = total.add(rest);
        }
        if (count == 0) {
            throw new BusinessException("Everyone has already paid month " + monthNo);
        }
        activity.record("POSTED", AREA, "Marked all paid · " + c.getName() + " month " + monthNo + " · " + count
                + " member" + (count == 1 ? "" : "s") + " · " + ActivityService.money(total) + (direct ? " · paid the winner directly" : ""));
        return detail(chitId);
    }

    /**
     * Auction chits: what each member pays for a month is the installment less that month's dividend, known only once
     * the auction is recorded, so nothing is collected for a month before its auction.
     */
    private static void requireAuctionDone(HostedChit c, Calc calc, int monthNo) {
        if (!auction(c)) return;
        HostedChitMonth month = calc.month(monthNo);
        if (month.getBidAmount() == null) {
            throw new BusinessException("Record the auction for month " + monthNo + " first: what each member pays depends on the winning bid (the dividend)");
        }
    }

    /** A payment date cannot be in the future, nor before the chit starts. */
    private static void checkPaidDate(HostedChit c, LocalDate date) {
        if (date == null) return;
        if (date.isAfter(LocalDate.now())) {
            throw new BusinessException("The payment date cannot be in the future");
        }
        if (date.isBefore(c.getStartMonth().minusMonths(1))) {
            throw new BusinessException("The payment date is before the chit starts (" + c.getStartMonth() + ")");
        }
    }

    private void checkExcess(Calc calc, HostedChitMember m, int monthNo, BigDecimal amount, Long ignorePaymentId, Boolean allow) {
        BigDecimal already = calc.paymentList.stream()
                .filter(p -> p.getMemberId().equals(m.getId()) && p.getMonthNo() == monthNo && !p.getId().equals(ignorePaymentId))
                .map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal due = calc.due(m.getId(), monthNo);
        if (already.add(amount).compareTo(due) > 0 && !Boolean.TRUE.equals(allow)) {
            throw new BusinessException(m.getName() + " would pay " + ActivityService.money(already.add(amount)) + " for month "
                    + monthNo + ", more than the " + ActivityService.money(due) + " due. Confirm to record it anyway.");
        }
    }

    /**
     * The account a payment came into: the one given (checked), else the chit's collections account. Only when the
     * chit posts to the books; otherwise nothing is recorded against an account.
     */
    private Long receivedInto(HostedChit c, Long accountId) {
        if (!Boolean.TRUE.equals(c.getPostToBooks())) return null;
        if (accountId == null || accountId.equals(c.getAccountId())) return c.getAccountId();
        return book.requireMoneyAccount(accountId, c.getId(), "Received into").getId();
    }

    /**
     * The installment goes into the account it was received in (the chit's collections account unless another was
     * picked, a personal bank account included) and is owed to the members (Hosted Chit Funds); every line carries
     * the chit. Late interest is the organiser's income: kept in the chit's late interest (or commission) account, or,
     * when the member paid into a personal account, left there as the organiser's own money.
     */
    JournalDraft collectionDraft(HostedChit c, HostedChitMember m, HostedChitPayment p) {
        BigDecimal late = Money.nz(p.getLateFee());
        Long into = p.getAccountId() != null ? p.getAccountId() : c.getAccountId();
        String direct = p.getPaidToMemberId() == null ? "" : p.getPaidToMemberId().equals(m.getId()) ? " (set off against the payout)"
                : " (paid directly to " + members.findById(p.getPaidToMemberId()).map(HostedChitMember::getName).orElse("the winner") + ")";
        JournalDraft draft = JournalDraft.of(p.getPaidDate(), VoucherType.HOSTED_CHIT_COLLECTION,
                        ActivityService.cut("Chit collection - " + m.getName() + " - " + c.getName() + " month " + p.getMonthNo() + "/" + c.getMonths()
                                + direct + (late.signum() > 0 ? " (with late interest)" : ""), 255))
                .debit(into, p.getAmount(), HostedChitBookService.legMemo(p.getMode(), p.getReference())).hostedChit(c.getId())
                .credit(fundsAccount().getId(), p.getAmount()).hostedChit(c.getId());
        if (late.signum() > 0) {
            boolean intoBook = accounts.findById(into).map(Account::isChitBook).orElse(true);
            Long lateInto = !intoBook ? into
                    : c.getLateFeeAccountId() != null ? c.getLateFeeAccountId()
                    : c.getCommissionAccountId() != null ? c.getCommissionAccountId() : into;
            draft.debit(lateInto, late, "Late payment interest").hostedChit(book.tag(lateInto, c.getId(), false))
                    .credit(accountService.systemAccount(DefaultChartOfAccounts.INCOME).getId(), late, "Late payment interest")
                    .category(lateFeeCategory().getId()).hostedChit(c.getId());
        }
        return draft.party(m.getName())
                .reference(p.getReference() == null ? p.getReceiptNo() : ActivityService.cut(p.getReference(), 60))
                .source(SOURCE_COLLECTION, p.getId());
    }

    /**
     * The commission earned: two lines only (Hosted Chit Funds → income), so the journal shows the amount once. When
     * the commission has its own account, moving the money there is a separate transfer ({@link #commissionTransferDraft}).
     */
    JournalDraft commissionDraft(HostedChit c, HostedChitMonth month, LocalDate date, BigDecimal commission) {
        Long categoryId = c.getCommissionCategoryId() != null ? c.getCommissionCategoryId() : commissionCategory(c).getId();
        return JournalDraft.of(date, VoucherType.INCOME, "Chit commission - " + c.getName() + " month " + month.getMonthNo())
                .debit(fundsAccount().getId(), commission).hostedChit(c.getId())
                .credit(accountService.systemAccount(DefaultChartOfAccounts.INCOME).getId(), commission, "Organiser commission")
                .category(categoryId).hostedChit(c.getId())
                .party(c.getName())
                .source(SOURCE_COMMISSION, month.getId());
    }

    /** The month's commission entry: income when positive, a reversal of commission income when negative. */
    JournalDraft commissionEntryDraft(HostedChit c, HostedChitMonth month, LocalDate date, BigDecimal commission) {
        return commission.signum() >= 0 ? commissionDraft(c, month, date, commission) : negativeCommissionDraft(c, month, date, commission.negate());
    }

    /**
     * A planned chit's month that pays the winner more than was collected: the organiser gives back that much of the
     * commission (Dr commission income / Cr Hosted Chit Funds), so the members' funds come back to zero and the
     * commission over the chit is the true net. The money itself went to the winner as a payout part, by default
     * from the commission account.
     */
    JournalDraft negativeCommissionDraft(HostedChit c, HostedChitMonth month, LocalDate date, BigDecimal shortfall) {
        Long categoryId = c.getCommissionCategoryId() != null ? c.getCommissionCategoryId() : commissionCategory(c).getId();
        return JournalDraft.of(date, VoucherType.JOURNAL, "Chit commission given back - " + c.getName() + " month " + month.getMonthNo()
                        + " (the payout is more than the collection)")
                .debit(accountService.systemAccount(DefaultChartOfAccounts.INCOME).getId(), shortfall, "Commission paid out to the winner")
                .category(categoryId).hostedChit(c.getId())
                .credit(fundsAccount().getId(), shortfall).hostedChit(c.getId())
                .party(c.getName())
                .source(SOURCE_COMMISSION, month.getId());
    }

    /**
     * Moves the commission into its account, out of the collections account (or the account picked at the payout).
     * The money leaving is the chit's; on arrival it is the organiser's (untagged when that is a personal account).
     */
    JournalDraft commissionTransferDraft(HostedChit c, HostedChitMonth month, LocalDate date, BigDecimal commission) {
        if (Boolean.TRUE.equals(month.getCommissionRetained())) {
            // members paid into the commission account: the commission stays there; the entry only marks that much of
            // the chit's money in it as the organiser's own (the same account, without the chit)
            Long account = c.getCommissionAccountId();
            return JournalDraft.of(date, VoucherType.TRANSFER, "Chit commission kept where it was paid - " + c.getName() + " month " + month.getMonthNo())
                    .debit(account, commission, "Commission kept: now my money").hostedChit(null)
                    .credit(account, commission, "Members' money in this account").hostedChit(c.getId())
                    .party(c.getName())
                    .source(SOURCE_COMMISSION, month.getId());
        }
        Long from = month.getCommissionFromAccountId() != null ? month.getCommissionFromAccountId() : c.getAccountId();
        return JournalDraft.of(date, VoucherType.TRANSFER, "Chit commission to its account - " + c.getName() + " month " + month.getMonthNo())
                .debit(c.getCommissionAccountId(), commission, "Commission kept").hostedChit(book.tag(c.getCommissionAccountId(), c.getId(), false))
                .credit(from, commission).hostedChit(c.getId())
                .party(c.getName())
                .source(SOURCE_COMMISSION, month.getId());
    }

    /**
     * The payout: Hosted Chit Funds down by the payout, and each account it was paid from down by its part (the
     * chit's money, whichever account it is in). One entry, one credit line per account with its mode and reference.
     */
    JournalDraft payoutDraft(HostedChit c, HostedChitMonth month, HostedChitMember winner, List<HostedChitLeg> parts) {
        // short: "Chit payout AC5L-M03 · Jyothi · Aditya Chitfunds 5L" (the code names the chit and the month; the lines, the accounts)
        JournalDraft draft = JournalDraft.of(month.getPayoutDate(), VoucherType.HOSTED_CHIT_PAYOUT,
                        "Chit payout " + payCode(shortCodeOf(c), month.getMonthNo()) + " · " + winner.getName() + " · " + c.getName())
                .debit(fundsAccount().getId(), month.getPayoutAmount(), month.getPayoutTo() == null ? null : "To " + month.getPayoutTo())
                .hostedChit(c.getId());
        for (HostedChitLeg leg : parts) {
            draft.credit(leg.getAccountId(), leg.getAmount(), HostedChitBookService.legMemo(leg.getMode(), leg.getReference(), leg.getNote()))
                    .hostedChit(c.getId());
        }
        return draft.party(winner.getName())
                .reference(month.getPayoutReference())
                .source(SOURCE_PAYOUT, month.getId());
    }

    private static boolean separateCommission(HostedChit c) {
        return c.getCommissionAccountId() != null && !c.getCommissionAccountId().equals(c.getAccountId());
    }

    /**
     * Commission entries posted before the split had four lines (income and the move to the commission account in one
     * voucher), so the journal showed the amount twice. Rewrites each as the income entry plus a separate transfer.
     * Runs for the tenant in context; returns how many were repaired.
     */
    @Transactional
    public int repairCommissionEntries() {
        Long tenantId = UserContext.tenantId();
        int repaired = 0;
        for (HostedChitMonth month : months.findByTenantId(tenantId)) {
            if (month.getCommissionEntryId() == null || month.getCommissionTransferEntryId() != null) continue;
            if (lines.findByJournalEntryId(month.getCommissionEntryId()).size() <= 2) continue;
            HostedChit c = chits.findById(month.getChitId()).orElse(null);
            if (c == null || !separateCommission(c) || month.getCommissionAmount() == null) continue;
            BigDecimal commission = month.getCommissionAmount();
            LocalDate date = month.getPayoutDate() != null ? month.getPayoutDate() : LocalDate.now();
            ledger.repost(month.getCommissionEntryId(), commissionDraft(c, month, date, commission));
            month.setCommissionTransferEntryId(ledger.post(commissionTransferDraft(c, month, date, commission)).getId());
            months.save(month);
            repaired++;
        }
        return repaired;
    }

    /**
     * Brings one chit's records into the chit book (idempotent, run at startup): payments get the account they came
     * into, payouts their leg (all of it from the collections account), and the journal entries posted before lines
     * carried the chit are posted again with it (same numbers). Returns how many records changed.
     */
    @Transactional
    public int migrateChit(Long chitId) {
        HostedChit c = require(chitId);
        if (!Boolean.TRUE.equals(c.getPostToBooks())) return 0;
        int changed = 0;
        Map<Long, HostedChitMember> memberById = members.findByChitId(chitId).stream()
                .collect(Collectors.toMap(HostedChitMember::getId, Function.identity()));
        for (HostedChitPayment p : payments.findByChitId(chitId)) {
            boolean dirty = false;
            if (p.getAccountId() == null && c.getAccountId() != null && p.getJournalEntryId() != null) {
                p.setAccountId(lines.findByJournalEntryId(p.getJournalEntryId()).stream().filter(l -> l.getDebit().signum() > 0)
                        .map(com.aditya.personalbudget.domain.entity.JournalLine::getAccountId).findFirst().orElse(c.getAccountId()));
                dirty = true;
            }
            if (p.getJournalEntryId() != null && !tagged(p.getJournalEntryId())) {
                ledger.repost(p.getJournalEntryId(), collectionDraft(c, memberById.get(p.getMemberId()), p));
                dirty = true;
            }
            if (dirty) {
                payments.save(p);
                changed++;
            }
        }
        for (HostedChitMonth m : months.findByChitId(chitId)) {
            if (m.getPayoutDate() == null) continue;
            List<HostedChitLeg> parts = legs.findByMonthId(m.getId());
            if (parts.isEmpty() && Money.isPositive(m.getPayoutAmount()) && m.getPayoutEntryId() != null) {
                Long from = lines.findByJournalEntryId(m.getPayoutEntryId()).stream().filter(l -> l.getCredit().signum() > 0)
                        .map(com.aditya.personalbudget.domain.entity.JournalLine::getAccountId).findFirst().orElse(c.getAccountId());
                HostedChitLeg leg = new HostedChitLeg();
                leg.setTenantId(c.getTenantId());
                leg.setChitId(c.getId());
                leg.setMonthId(m.getId());
                leg.setAccountId(from);
                leg.setAmount(m.getPayoutAmount());
                leg.setMode(m.getPayoutMode() != null ? m.getPayoutMode() : "Bank");
                leg.setReference(m.getPayoutReference());
                leg.setPosition(1);
                parts = List.of(legs.save(leg));
                changed++;
            }
            if (m.getPayoutEntryId() != null && !tagged(m.getPayoutEntryId()) && m.getWinnerMemberId() != null) {
                ledger.repost(m.getPayoutEntryId(), payoutDraft(c, m, memberById.get(m.getWinnerMemberId()), parts));
                changed++;
            }
            if (m.getCommissionEntryId() != null && !tagged(m.getCommissionEntryId()) && Money.nz(m.getCommissionAmount()).signum() != 0) {
                ledger.repost(m.getCommissionEntryId(), commissionEntryDraft(c, m, m.getPayoutDate(), m.getCommissionAmount()));
                changed++;
            }
            if (m.getCommissionTransferEntryId() != null && !tagged(m.getCommissionTransferEntryId()) && separateCommission(c)) {
                ledger.repost(m.getCommissionTransferEntryId(), commissionTransferDraft(c, m, m.getPayoutDate(), m.getCommissionAmount()));
                changed++;
            }
        }
        return changed;
    }

    /** Ids of the tenant's hosted chits (for the startup migration). */
    public List<Long> chitIds() {
        return chits.findByTenantId(UserContext.tenantId()).stream().map(HostedChit::getId).toList();
    }

    private boolean tagged(Long entryId) {
        return lines.findByJournalEntryId(entryId).stream().anyMatch(l -> l.getHostedChitId() != null);
    }

    /** Late interest settled (collected or let off) must not exceed what has accrued, unless confirmed. */
    private static void checkLateFee(Calc calc, HostedChitMember m, int monthNo, BigDecimal settling, Long ignorePaymentId, Boolean allow) {
        if (settling.signum() <= 0) return;
        BigDecimal open = calc.lateAccrued(m.getId(), monthNo).subtract(calc.lateSettled(m.getId(), monthNo, ignorePaymentId)).max(Money.ZERO);
        if (settling.compareTo(open) > 0 && !Boolean.TRUE.equals(allow)) {
            throw new BusinessException("Only " + ActivityService.money(open) + " of late interest is due from " + m.getName()
                    + " for month " + monthNo + ". Confirm to record it anyway.");
        }
    }

    // ================================================================== winner and payout

    @Transactional
    public Detail setWinner(Long chitId, int monthNo, WinnerRequest r) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        HostedChitMonth month = calc.month(monthNo);
        if (month.getPayoutDate() != null) {
            throw new BusinessException("Month " + monthNo + " is paid out and locked");
        }
        if (monthNo != calc.currentMonth) {
            throw new BusinessException("Pick the winner of month " + calc.currentMonth + " first (months close in order)");
        }
        HostedChitMember member = requireMember(c, r.memberId());
        Integer won = calc.wonMonth(member.getId());
        if (won != null && won != monthNo) {
            throw new BusinessException(member.getName() + " already won month " + won + "; a member wins only once");
        }
        if (auction(c) && month.getBidAmount() != null && hasPayments(calc, monthNo)) {
            throw new BusinessException("Payments for month " + monthNo + " were collected with the dividend of this auction; undo them before changing the auction");
        }
        requireNoDirect(calc, month, member.getId());
        month.setWinnerMemberId(member.getId());
        if (auction(c)) {
            long left = calc.memberList.stream().filter(m -> calc.wonMonth(m.getId()) == null || calc.wonMonth(m.getId()) == monthNo).count();
            // the last member left has no one to bid against: they take the chit at the lowest bid
            BigDecimal bid = left <= 1 || r.bid() == null ? c.getCommission() : Money.round(r.bid());
            if (bid.compareTo(c.getCommission()) < 0 || bid.compareTo(maxBid(c)) > 0) {
                throw new BusinessException("The winning bid must be between " + ActivityService.money(c.getCommission())
                        + " (the commission) and " + ActivityService.money(maxBid(c)) + " (" + c.getMaxBidPercent().stripTrailingZeros().toPlainString()
                        + "% of the chit value)");
            }
            month.setBidAmount(bid);
            month.setDrawMethod("Auction");
        } else {
            month.setBidAmount(null);
            month.setDrawMethod(Boolean.TRUE.equals(r.random()) ? "Random draw" : "Picked");
        }
        months.save(month);
        activity.record("CHANGED", AREA, (auction(c) ? "Recorded the auction · " : "Chose the winner · ") + c.getName() + " month "
                + monthNo + " · " + member.getName() + " · "
                + (auction(c) ? "bid " + ActivityService.money(month.getBidAmount()) : month.getDrawMethod().toLowerCase()));
        return detail(chitId);
    }

    @Transactional
    public Detail clearWinner(Long chitId, int monthNo) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        HostedChitMonth month = calc.month(monthNo);
        if (month.getPayoutDate() != null) {
            throw new BusinessException("Month " + monthNo + " is paid out and locked; undo the payout first");
        }
        if (auction(c) && hasPayments(calc, monthNo)) {
            throw new BusinessException("Payments for month " + monthNo + " were collected with this auction's dividend; undo them before removing the auction");
        }
        requireNoDirect(calc, month, null);
        month.setWinnerMemberId(null);
        month.setDrawMethod(null);
        month.setBidAmount(null);
        months.save(month);
        activity.record("CHANGED", AREA, "Cleared the winner · " + c.getName() + " month " + monthNo);
        return detail(chitId);
    }

    @Transactional
    public Detail payout(Long chitId, int monthNo, PayoutRequest r) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        HostedChitMonth month = calc.month(monthNo);
        if (month.getPayoutDate() != null) {
            throw new BusinessException("Month " + monthNo + " is already paid out");
        }
        if (monthNo != calc.currentMonth) {
            throw new BusinessException("Close month " + calc.currentMonth + " first (months close in order)");
        }
        if (month.getWinnerMemberId() == null) {
            throw new BusinessException("Choose the winner of month " + monthNo + " first");
        }
        BigDecimal dues = Money.ZERO;
        int unpaid = 0;
        for (HostedChitMember m : calc.memberList) {
            BigDecimal rest = calc.due(m.getId(), monthNo).subtract(calc.paid(m.getId(), monthNo));
            if (rest.signum() > 0) {
                dues = dues.add(rest);
                unpaid++;
            }
        }
        if (unpaid > 0 && !Boolean.TRUE.equals(r.allowDues())) {
            throw new BusinessException(unpaid + " member" + (unpaid == 1 ? " has" : "s have") + " not paid month " + monthNo
                    + " in full (" + ActivityService.money(dues) + " due). Confirm to close the month anyway.");
        }
        HostedChitMember winner = requireMember(c, month.getWinnerMemberId());
        if (r.payoutDate() != null && r.payoutDate().isAfter(LocalDate.now())) {
            throw new BusinessException("The payout date cannot be in the future");
        }
        if (r.payoutDate() != null && r.payoutDate().isBefore(c.getStartMonth())) {
            throw new BusinessException("The payout date is before the chit starts (" + c.getStartMonth() + ")");
        }
        BigDecimal value = calc.chitValue(monthNo);
        BigDecimal payout = payoutOf(c, calc, month);
        // planned chits: what was collected less the payout, negative when the payout is more than the collection
        BigDecimal commission = planned(c) ? value.subtract(payout) : c.getCommission().min(value);
        LocalDate date = r.payoutDate() != null ? r.payoutDate() : LocalDate.now();
        List<HostedChitLeg> parts = payoutLegs(c, month, payout, r, commission, Map.of());
        if (Boolean.TRUE.equals(r.gathered())) {
            requireGathered(c, calc, month, parts, commission);
        }
        month.setPayoutAmount(payout);
        month.setCommissionAmount(commission);
        month.setPayoutDate(date);
        month.setPayoutRecordedAt(LocalDateTime.now());
        // members pointed at this winner pay into the chit again from now on
        members.findByChitId(c.getId()).stream().filter(x -> month.getWinnerMemberId() != null && month.getWinnerMemberId().equals(x.getPayToMemberId()))
                .forEach(x -> { x.setPayToMemberId(null); members.save(x); });
        describePayout(month, r, parts, winner);
        commissionSource(c, month, r, parts, commission, Map.of());
        // the organiser moves the commission as the next step of the payout (moveCommission)
        month.setCommissionDeferred(Boolean.TRUE.equals(r.deferCommissionMove()) && commission.signum() > 0 && separateCommission(c)
                && !Boolean.TRUE.equals(month.getCommissionRetained()) ? Boolean.TRUE : null);
        months.save(month);
        if (!parts.isEmpty()) {
            legs.saveAll(parts);
        }
        if (Boolean.TRUE.equals(c.getPostToBooks())) {
            JournalEntry paid = ledger.post(payoutDraft(c, month, winner, parts));
            month.setPayoutEntryId(paid.getId());
            if (commission.signum() != 0) {
                month.setCommissionEntryId(ledger.post(commissionEntryDraft(c, month, date, commission)).getId());
                if (needsCommissionTransfer(c, month)) {
                    month.setCommissionTransferEntryId(ledger.post(commissionTransferDraft(c, month, date, commission)).getId());
                }
            }
        }
        months.save(month);
        if (calc.completedMonths + 1 >= c.getMonths()) {
            c.setStatus(HostedChit.COMPLETED);
            chits.save(c);
        }
        if (Boolean.TRUE.equals(r.createAgreement())) {
            makeAgreement(c, month, winner, r.guarantorName(), r.guarantorPhone(), null);
        }
        activity.record("POSTED", AREA, "Paid out · " + winner.getName() + " · " + c.getName() + " month " + monthNo + " · "
                + ActivityService.money(payout) + (parts.size() > 1 ? " from " + parts.size() + " accounts" : "")
                + " · commission " + ActivityService.money(commission)
                + (unpaid > 0 ? " · closed with " + ActivityService.money(dues) + " due" : ""));
        return detail(chitId);
    }

    /**
     * The accounts the payout comes from (not yet saved). Without legs in the request: all of it from the chit's
     * collections account. With legs: each account once, and together exactly the payout.
     */
    /**
     * returning: what each account gets back when an existing payout is changed (its old parts), so the balance checks
     * see the money that will be there.
     */
    private List<HostedChitLeg> payoutLegs(HostedChit c, HostedChitMonth month, BigDecimal payout, PayoutRequest r, BigDecimal commission,
                                           Map<Long, BigDecimal> returning) {
        if (!Boolean.TRUE.equals(c.getPostToBooks())) return List.of();
        // what members paid the winner directly is already with the winner: that part comes out of the clearing account
        List<HostedChitPayment> direct = payments.findByChitId(c.getId()).stream()
                .filter(p -> p.getMonthNo().equals(month.getMonthNo()) && month.getWinnerMemberId().equals(p.getPaidToMemberId())).toList();
        BigDecimal directTotal = direct.stream().map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal rest = payout.subtract(directTotal);
        // a negative commission (planned chits): the part above the collection comes out of the commission account, as far
        // as it holds money; the rest from the collections
        BigDecimal shortfall = commission.signum() < 0 && c.getCommissionAccountId() != null ? commission.negate().min(rest) : Money.ZERO;
        BigDecimal inCommission = shortfall.signum() > 0
                ? book.balanceOf(c.getCommissionAccountId()).add(returning.getOrDefault(c.getCommissionAccountId(), Money.ZERO)).max(Money.ZERO)
                : Money.ZERO;
        BigDecimal fromCommission = shortfall.min(inCommission);
        List<LegInput> defaults = new ArrayList<>();
        if (rest.subtract(fromCommission).signum() > 0) defaults.add(new LegInput(c.getAccountId(), rest.subtract(fromCommission), r.mode(), r.reference()));
        if (fromCommission.signum() > 0) defaults.add(new LegInput(c.getCommissionAccountId(), fromCommission, r.mode(), null));
        List<LegInput> input = r.legs() == null || r.legs().isEmpty() ? defaults : r.legs();
        List<HostedChitLeg> out = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        BigDecimal total = Money.ZERO;
        if (directTotal.signum() > 0) {
            HostedChitLeg leg = new HostedChitLeg();
            leg.setTenantId(c.getTenantId());
            leg.setChitId(c.getId());
            leg.setMonthId(month.getId());
            leg.setAccountId(book.directAccount().getId());
            leg.setAmount(directTotal);
            leg.setMode(DIRECT_MODE);
            leg.setReference(ActivityService.cut(direct.size() + " member payment" + (direct.size() == 1 ? "" : "s") + " made to the winner", 60));
            leg.setPosition(1);
            seen.add(leg.getAccountId());
            total = total.add(directTotal);
            out.add(leg);
        }
        for (LegInput l : input) {
            Account a = book.requireMoneyAccount(l.accountId(), c.getId(), "Paid from");
            if (!seen.add(a.getId())) {
                throw new BusinessException(a.getName() + " is listed twice; put its whole part on one line");
            }
            HostedChitLeg leg = new HostedChitLeg();
            leg.setTenantId(c.getTenantId());
            leg.setChitId(c.getId());
            leg.setMonthId(month.getId());
            leg.setAccountId(a.getId());
            leg.setAmount(Money.round(l.amount()));
            leg.setMode(mode(l.mode() != null ? l.mode() : r.mode()));
            leg.setReference(blank(l.reference()));
            leg.setPaymentIds(HostedChitBookService.csv(book.linkedPayments(c.getId(), l.paymentIds(), null, month.getId())));
            leg.setNote(blank(l.note()) == null ? null : ActivityService.cut(l.note().trim(), 2000));
            leg.setPosition(out.size() + 1);
            total = total.add(leg.getAmount());
            out.add(leg);
        }
        if (total.compareTo(payout) != 0) {
            throw new BusinessException((directTotal.signum() > 0 ? "With the " + ActivityService.money(directTotal) + " members paid the winner directly, the accounts add up to "
                    : "The accounts add up to ") + ActivityService.money(total) + ", but the winner gets "
                    + ActivityService.money(payout) + (total.compareTo(payout) < 0 ? " (" + ActivityService.money(payout.subtract(total)) + " short)"
                    : " (" + ActivityService.money(total.subtract(payout)) + " too much)"));
        }
        // the commission account cannot pay more than it holds: say how much is missing and where to take it from
        if (c.getCommissionAccountId() != null && !c.getCommissionAccountId().equals(c.getAccountId())) {
            BigDecimal fromIt = out.stream().filter(l -> l.getAccountId().equals(c.getCommissionAccountId()))
                    .map(HostedChitLeg::getAmount).reduce(Money.ZERO, BigDecimal::add);
            if (fromIt.signum() > 0) {
                BigDecimal has = book.balanceOf(c.getCommissionAccountId()).add(returning.getOrDefault(c.getCommissionAccountId(), Money.ZERO));
                if (fromIt.compareTo(has) > 0) {
                    String name = accounts.findById(c.getCommissionAccountId()).map(Account::getName).orElse("The commission account");
                    String winner = members.findById(month.getWinnerMemberId()).map(HostedChitMember::getName).orElse("the winner");
                    BigDecimal missing = fromIt.subtract(has.max(Money.ZERO));
                    throw new BusinessException(name + " (your commission account) holds only " + ActivityService.money(has.max(Money.ZERO))
                            + ", not the " + ActivityService.money(fromIt) + " put on it" + (commission.signum() < 0
                            ? " to give " + winner + " the " + ActivityService.money(commission.negate()) + " this month pays out above its collections" : "")
                            + ". Take the other " + ActivityService.money(missing) + " from an account that has the money: add it as another part of the payout.");
                }
            }
        }
        return out;
    }

    /** The payout's mode (the first part paid by the organiser), reference and the winner's account it went to. */
    private void describePayout(HostedChitMonth month, PayoutRequest r, List<HostedChitLeg> parts, HostedChitMember winner) {
        month.setPayoutMode(parts.stream().map(HostedChitLeg::getMode).filter(m -> !DIRECT_MODE.equals(m)).findFirst()
                .orElse(parts.isEmpty() ? mode(r.mode()) : DIRECT_MODE));
        month.setPayoutReference(payoutReference(r.reference(), parts));
        month.setPayoutTo(blank(r.payoutTo()) != null ? ActivityService.cut(r.payoutTo().trim(), 120) : winner.getPayoutAccount());
    }

    /**
     * Where the month's commission comes from when it has its own account: the collections account (default), another
     * account holding the chit's money, or the commission account itself. The last happens when members pay into the
     * commission account: the commission simply stays there ({@code commissionRetained}), and only as much as the chit's
     * money there (after this payout) can be kept that way.
     */
    private void commissionSource(HostedChit c, HostedChitMonth month, PayoutRequest r, List<HostedChitLeg> parts, BigDecimal commission,
                                  Map<Long, BigDecimal> returning) {
        month.setCommissionFromAccountId(null);
        month.setCommissionRetained(null);
        if (!Boolean.TRUE.equals(c.getPostToBooks()) || !separateCommission(c) || commission.signum() <= 0
                || r.commissionFromAccountId() == null || r.commissionFromAccountId().equals(c.getAccountId())) {
            return;
        }
        Account from = book.requireMoneyAccount(r.commissionFromAccountId(), c.getId(), "Commission from");
        month.setCommissionFromAccountId(from.getId());
        if (!from.getId().equals(c.getCommissionAccountId())) {
            return;
        }
        month.setCommissionRetained(true);
        if (from.isChitBook()) {
            return;   // a chit-book account: the money is already where it belongs, nothing to mark
        }
        BigDecimal chitMoney = book.money(c).spots().stream().filter(s -> s.accountId().equals(from.getId()))
                .map(HostedChitBookService.Spot::amount).findFirst().orElse(Money.ZERO)
                .add(returning.getOrDefault(from.getId(), Money.ZERO));
        BigDecimal paidFromIt = parts.stream().filter(l -> l.getAccountId().equals(from.getId())).map(HostedChitLeg::getAmount)
                .reduce(Money.ZERO, BigDecimal::add);
        BigDecimal left = chitMoney.subtract(paidFromIt);
        if (left.compareTo(commission) < 0) {
            throw new BusinessException("Only " + ActivityService.money(left.max(Money.ZERO)) + " of the members' money is left in " + from.getName()
                    + " after this payout, less than your " + ActivityService.money(commission) + " commission. Pay less of the payout from "
                    + from.getName() + ", or move the commission from " + accounts.findById(c.getAccountId()).map(Account::getName).orElse("the collections account") + ".");
        }
    }

    /** Paid out, and the commission still waits in the collections account for the organiser to move it. */
    static boolean commissionPending(HostedChitMonth m) {
        return m.getPayoutDate() != null && Boolean.TRUE.equals(m.getCommissionDeferred()) && m.getCommissionTransferEntryId() == null;
    }

    /**
     * Before a payout made from gathered money: every payment of the month that came into another account has been
     * moved into the collections account, and the payout comes out of the collections (only what the month pays above
     * its collections can come from elsewhere).
     */
    private void requireGathered(HostedChit c, Calc calc, HostedChitMonth month, List<HostedChitLeg> parts, BigDecimal commission) {
        if (!Boolean.TRUE.equals(c.getPostToBooks()) || c.getAccountId() == null) return;
        Map<Long, TransferView> movedBy = new HashMap<>();
        book.transfersOf(c.getId()).forEach(t -> t.from().forEach(l -> l.paymentIds().forEach(id -> movedBy.put(id, t))));
        Map<Long, BigDecimal> outside = new java.util.LinkedHashMap<>();
        Map<Long, Integer> count = new HashMap<>();
        for (HostedChitPayment p : calc.paymentList) {
            if (!p.getMonthNo().equals(month.getMonthNo()) || p.getPaidToMemberId() != null || Money.nz(p.getAmount()).signum() <= 0) continue;
            Long where = movedBy.containsKey(p.getId()) ? movedBy.get(p.getId()).toAccountId() : calc.accountOf(p);
            if (where.equals(c.getAccountId())) continue;
            outside.merge(where, p.getAmount(), BigDecimal::add);
            count.merge(where, 1, Integer::sum);
        }
        String collections = accounts.findById(c.getAccountId()).map(Account::getName).orElse("the collections account");
        if (!outside.isEmpty()) {
            throw new BusinessException("Move month " + month.getMonthNo() + "'s payments into " + collections + " first: "
                    + outside.entrySet().stream().map(e -> ActivityService.money(e.getValue()) + " (" + count.get(e.getKey()) + " txn"
                    + (count.get(e.getKey()) == 1 ? "" : "s") + ") in " + accounts.findById(e.getKey()).map(Account::getName).orElse("?"))
                    .collect(Collectors.joining(", ")));
        }
        BigDecimal elsewhere = parts.stream().filter(l -> !DIRECT_MODE.equals(l.getMode()) && !l.getAccountId().equals(c.getAccountId()))
                .map(HostedChitLeg::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal above = commission.signum() < 0 ? commission.negate() : Money.ZERO;
        if (elsewhere.compareTo(above) > 0) {
            throw new BusinessException("With the money gathered, the winner is paid out of " + collections
                    + (above.signum() > 0 ? "; only the " + ActivityService.money(above) + " this month pays above its collections can come from other accounts"
                    : "; pay the whole of it from there"));
        }
    }

    /**
     * After the payout: the month's commission moves out of the collections account (or where the payout said) into
     * the chit's commission account and, when asked, on to the organiser's bank account (all of it or part).
     */
    @Transactional
    public Detail moveCommission(Long chitId, int monthNo, CommissionMoveRequest r) {
        HostedChit c = editable(chitId);
        HostedChitMonth month = new Calc(c).month(monthNo);
        if (month.getPayoutDate() == null) {
            throw new BusinessException("Pay the winner of month " + monthNo + " first; the commission is what is left after the payout");
        }
        BigDecimal commission = Money.nz(month.getCommissionAmount());
        if (commission.signum() <= 0) {
            throw new BusinessException("Month " + monthNo + " leaves no commission to move");
        }
        if (!separateCommission(c)) {
            throw new BusinessException(c.getName() + " keeps its commission in the collections account");
        }
        LocalDate date = r != null && r.date() != null ? r.date() : LocalDate.now();
        if (date.isAfter(LocalDate.now())) throw new BusinessException("The date cannot be in the future");
        if (date.isBefore(month.getPayoutDate())) throw new BusinessException("The commission is moved on or after the payout (" + month.getPayoutDate() + ")");
        String mode = HostedChitBookService.mode(r == null ? null : r.mode());
        String reference = r == null ? null : blank(r.reference());
        String note = r == null ? null : blank(r.note());
        String commissionAccount = accounts.findById(c.getCommissionAccountId()).map(Account::getName).orElse("the commission account");
        boolean moved = false;
        if (month.getCommissionTransferEntryId() == null) {
            Long from = month.getCommissionFromAccountId() != null ? month.getCommissionFromAccountId() : c.getAccountId();
            JournalDraft draft = JournalDraft.of(date, VoucherType.TRANSFER, ActivityService.cut("Chit commission to its account - " + c.getName()
                            + " month " + month.getMonthNo() + (note != null ? " - " + note : ""), 255))
                    .debit(c.getCommissionAccountId(), commission, HostedChitBookService.legMemo(mode, reference, "Commission kept"))
                    .hostedChit(book.tag(c.getCommissionAccountId(), c.getId(), false))
                    .credit(from, commission).hostedChit(c.getId())
                    .reference(reference)
                    .party(c.getName())
                    .source(SOURCE_COMMISSION, month.getId());
            month.setCommissionTransferEntryId(ledger.post(draft).getId());
            month.setCommissionDeferred(null);
            moved = true;
        }
        BigDecimal toBank = Money.ZERO;
        if (r != null && Boolean.TRUE.equals(r.toBank())) {
            if (c.getCommissionBankAccountId() == null) {
                throw new BusinessException("Pick the bank account your commission goes to in the chit's settings first");
            }
            if (month.getCommissionBankTransferId() != null) {
                throw new BusinessException("Month " + monthNo + "'s commission is already in your bank account");
            }
            toBank = Money.round(r.bankAmount() != null && r.bankAmount().signum() > 0 ? r.bankAmount() : commission);
            BigDecimal has = book.balanceOf(c.getCommissionAccountId());
            if (toBank.compareTo(has) > 0) {
                throw new BusinessException(commissionAccount + " holds " + ActivityService.money(has) + ", less than the "
                        + ActivityService.money(toBank) + " to move to your bank account");
            }
            TransferView t = book.transfer(new HostedChitBookService.TransferRequest(c.getId(), date, c.getCommissionBankAccountId(),
                    List.of(new LegInput(c.getCommissionAccountId(), toBank, mode, reference, null, note)), false, mode, reference,
                    note != null ? note : "Commission - " + c.getName() + " month " + monthNo, null));
            month.setCommissionBankTransferId(t.id());
        } else if (!moved) {
            throw new BusinessException("Month " + monthNo + "'s commission is already in " + commissionAccount);
        }
        months.save(month);
        activity.record("POSTED", AREA, "Moved the commission · " + c.getName() + " month " + monthNo + " · " + ActivityService.money(commission)
                + (moved ? " → " + commissionAccount : "") + (toBank.signum() > 0 ? " → my bank " + ActivityService.money(toBank) : ""));
        return detail(chitId);
    }

    /** Undoes the commission's move (and its move on to the bank): it waits in the collections account again. */
    @Transactional
    public Detail undoCommissionMove(Long chitId, int monthNo) {
        HostedChit c = editable(chitId);
        HostedChitMonth month = new Calc(c).month(monthNo);
        if (month.getPayoutDate() == null || (month.getCommissionTransferEntryId() == null && month.getCommissionBankTransferId() == null)) {
            throw new BusinessException("Month " + monthNo + "'s commission has not been moved");
        }
        if (month.getCommissionBankTransferId() != null) {
            Long t = month.getCommissionBankTransferId();
            month.setCommissionBankTransferId(null);
            months.save(month);
            book.deleteTransfer(t);
        }
        if (month.getCommissionTransferEntryId() != null && !Boolean.TRUE.equals(month.getCommissionRetained())) {
            Long entry = month.getCommissionTransferEntryId();
            month.setCommissionTransferEntryId(null);
            month.setCommissionDeferred(true);
            months.save(month);
            ledger.delete(entry);
        }
        activity.record("DELETED", AREA, "Undid the commission move · " + c.getName() + " month " + monthNo);
        return detail(chitId);
    }

    /** A transfer entry is needed when the commission has its own account, unless it stayed in a chit-book commission account. */
    private boolean needsCommissionTransfer(HostedChit c, HostedChitMonth month) {
        if (!separateCommission(c) || Money.nz(month.getCommissionAmount()).signum() <= 0) return false;
        if (commissionPending(month)) return false;   // the organiser moves it later
        if (!Boolean.TRUE.equals(month.getCommissionRetained())) return true;
        return accounts.findById(c.getCommissionAccountId()).map(a -> !a.isChitBook()).orElse(false);
    }

    /**
     * Changes a payout already made: its date, the winner's account, the accounts it was paid from (amounts, modes,
     * UTRs, narratives) and where the commission came from. The amount stays (it is the chit's figure). Not once the
     * winner has accepted or signed the agreement, which records the payout. Its journal entries are posted again.
     */
    @Transactional
    public Detail updatePayout(Long chitId, int monthNo, PayoutRequest r) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        HostedChitMonth month = calc.month(monthNo);
        if (month.getPayoutDate() == null) {
            throw new BusinessException("Month " + monthNo + " is not paid out yet");
        }
        HostedChitMember winner = requireMember(c, month.getWinnerMemberId());
        HostedChitAgreement ag = agreementOf(c, monthNo);
        if (ag != null && !HostedChitAgreement.DRAFT.equals(ag.getStatus())) {
            throw new BusinessException(winner.getName() + " has " + ag.getStatus().toLowerCase() + " the agreement " + ag.getAgreementNo()
                    + ", which records this payout (amount, date and references), so it cannot change");
        }
        if (r.payoutDate() != null && r.payoutDate().isAfter(LocalDate.now())) {
            throw new BusinessException("The payout date cannot be in the future");
        }
        if (r.payoutDate() != null && r.payoutDate().isBefore(c.getStartMonth())) {
            throw new BusinessException("The payout date is before the chit starts (" + c.getStartMonth() + ")");
        }
        BigDecimal payout = Money.nz(month.getPayoutAmount());
        BigDecimal commission = Money.nz(month.getCommissionAmount());
        LocalDate date = r.payoutDate() != null ? r.payoutDate() : month.getPayoutDate();
        List<HostedChitLeg> old = legs.findByMonthId(month.getId());
        // the old parts go back to their accounts (and the commission kept in place goes back to being the chit's)
        Map<Long, BigDecimal> returning = new HashMap<>();
        old.forEach(l -> returning.merge(l.getAccountId(), l.getAmount(), BigDecimal::add));
        if (Boolean.TRUE.equals(month.getCommissionRetained()) && c.getCommissionAccountId() != null) {
            returning.merge(c.getCommissionAccountId(), commission, BigDecimal::add);
        }
        Map<Long, BigDecimal> returningCash = new HashMap<>(returning);
        if (Boolean.TRUE.equals(month.getCommissionRetained()) && c.getCommissionAccountId() != null) {
            returningCash.merge(c.getCommissionAccountId(), commission.negate(), BigDecimal::add);   // the money itself never left
        }
        List<HostedChitLeg> parts = payoutLegs(c, month, payout, r, commission, returningCash);
        String before = month.getPayoutDate() + " " + old.stream().map(l -> l.getAccountId() + ":" + l.getAmount().toPlainString())
                .collect(Collectors.joining(","));
        month.setPayoutDate(date);
        describePayout(month, r, parts, winner);
        commissionSource(c, month, r, parts, commission, returning);
        months.save(month);
        legs.deleteAll(old);
        if (!parts.isEmpty()) {
            legs.saveAll(parts);
        }
        if (Boolean.TRUE.equals(c.getPostToBooks())) {
            if (month.getPayoutEntryId() != null) ledger.repost(month.getPayoutEntryId(), payoutDraft(c, month, winner, parts));
            else month.setPayoutEntryId(ledger.post(payoutDraft(c, month, winner, parts)).getId());
            if (commission.signum() != 0) {
                if (month.getCommissionEntryId() != null) ledger.repost(month.getCommissionEntryId(), commissionEntryDraft(c, month, date, commission));
                else month.setCommissionEntryId(ledger.post(commissionEntryDraft(c, month, date, commission)).getId());
            }
            Long transfer = month.getCommissionTransferEntryId();
            if (needsCommissionTransfer(c, month)) {
                if (transfer != null) ledger.repost(transfer, commissionTransferDraft(c, month, date, commission));
                else month.setCommissionTransferEntryId(ledger.post(commissionTransferDraft(c, month, date, commission)).getId());
            } else if (transfer != null) {
                month.setCommissionTransferEntryId(null);
                months.save(month);
                ledger.delete(transfer);
            }
        }
        months.save(month);
        if (ag != null) {
            makeAgreement(c, month, winner, ag.getGuarantorName(), ag.getGuarantorPhone(), null);   // the draft follows the payout
        }
        String after = month.getPayoutDate() + " " + parts.stream().map(l -> l.getAccountId() + ":" + l.getAmount().toPlainString())
                .collect(Collectors.joining(","));
        activity.record("CHANGED", AREA, "Changed the payout · " + winner.getName() + " · " + c.getName() + " month " + monthNo + " · "
                + ActivityService.money(payout) + (before.equals(after) ? "" : " · now from " + parts.size() + " part" + (parts.size() == 1 ? "" : "s")
                + " on " + date));
        return detail(chitId);
    }

    /** The mode of the payout part members paid the winner directly. */
    static final String DIRECT_MODE = "Direct";

    /** The payout's reference: the one given, else the parts' references ("UTR1, UTR2"). */
    private static String payoutReference(String given, List<HostedChitLeg> parts) {
        if (blank(given) != null) return ActivityService.cut(given.trim(), 60);
        String joined = parts.stream().filter(l -> !DIRECT_MODE.equals(l.getMode())).map(HostedChitLeg::getReference)
                .filter(Objects::nonNull).collect(Collectors.joining(", "));
        return joined.isEmpty() ? null : ActivityService.cut(joined, 60);
    }

    /** Undoes the payout of the last closed month (and the journal entries it posted). */
    @Transactional
    public Detail undoPayout(Long chitId, int monthNo) {
        HostedChit c = editable(chitId);
        Calc calc = new Calc(c);
        HostedChitMonth month = calc.month(monthNo);
        if (month.getPayoutDate() == null) {
            throw new BusinessException("Month " + monthNo + " is not paid out");
        }
        if (monthNo != calc.completedMonths) {
            throw new BusinessException("Undo month " + calc.completedMonths + " first (the latest payout)");
        }
        HostedChitAgreement signed = agreementOf(c, monthNo);
        if (signed != null && !HostedChitAgreement.DRAFT.equals(signed.getStatus())) {
            throw new BusinessException("The winner has accepted the agreement for this payout, so it cannot be undone");
        }
        if (month.getCommissionBankTransferId() != null) {   // the commission moved on to the bank comes back first
            Long t = month.getCommissionBankTransferId();
            month.setCommissionBankTransferId(null);
            months.save(month);
            book.deleteTransfer(t);
        }
        if (signed != null) {
            dropAgreement(c, signed);
        }
        List<Long> journal = new ArrayList<>();
        if (month.getPayoutEntryId() != null) journal.add(month.getPayoutEntryId());
        if (month.getCommissionEntryId() != null) journal.add(month.getCommissionEntryId());
        if (month.getCommissionTransferEntryId() != null) journal.add(month.getCommissionTransferEntryId());
        month.setPayoutAmount(null);
        month.setCommissionAmount(null);
        month.setPayoutDate(null);
        month.setPayoutMode(null);
        month.setPayoutReference(null);
        month.setPayoutTo(null);
        month.setCommissionFromAccountId(null);
        month.setCommissionRetained(null);
        month.setCommissionDeferred(null);
        month.setPayoutRecordedAt(null);
        month.setPayoutEntryId(null);
        month.setCommissionEntryId(null);
        month.setCommissionTransferEntryId(null);
        months.save(month);   // release the foreign keys before deleting the journal
        legs.deleteAll(legs.findByMonthId(month.getId()));
        // the payout and every commission entry of the month, linked or not: none may stay in the books
        ledger.deleteForSource(SOURCE_PAYOUT, month.getId(), journal.toArray(Long[]::new));
        ledger.deleteForSource(SOURCE_COMMISSION, month.getId());
        if (HostedChit.COMPLETED.equals(c.getStatus())) {
            c.setStatus(HostedChit.ACTIVE);
            chits.save(c);
        }
        activity.record("DELETED", AREA, "Undid a payout · " + c.getName() + " month " + monthNo);
        return detail(chitId);
    }

    // ================================================================== digital agreements

    /** Makes (or, while not yet accepted, remakes) the winner's agreement for a paid-out month. */
    @Transactional
    public Detail createAgreement(Long chitId, int monthNo, AgreementRequest r) {
        HostedChit c = editable(chitId);
        HostedChitMonth month = new Calc(c).month(monthNo);
        if (month.getPayoutDate() == null || month.getWinnerMemberId() == null) {
            throw new BusinessException("Pay the winner of month " + monthNo + " first; the agreement records that payout");
        }
        makeAgreement(c, month, requireMember(c, month.getWinnerMemberId()), r.guarantorName(), r.guarantorPhone(), blank(r.terms()));
        return detail(chitId);
    }

    @Transactional
    public Detail deleteAgreement(Long chitId, Long agreementId) {
        HostedChit c = editable(chitId);
        HostedChitAgreement a = requireAgreement(c, agreementId);
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("An accepted or signed agreement is kept as a record and cannot be deleted");
        }
        dropAgreement(c, a);
        activity.record("DELETED", AREA, "Deleted the agreement " + a.getAgreementNo() + " · " + c.getName() + " month " + a.getMonthNo());
        return detail(chitId);
    }

    /** The member signed a paper copy: recorded by the organiser. */
    @Transactional
    public Detail markAgreementSigned(Long chitId, Long agreementId, String signedBy) {
        HostedChit c = editable(chitId);
        HostedChitAgreement a = requireAgreement(c, agreementId);
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("This agreement is already " + a.getStatus().toLowerCase());
        }
        a.setStatus(HostedChitAgreement.SIGNED);
        a.setAcceptedName(blank(signedBy) != null ? ActivityService.cut(signedBy.trim(), 100) : members.findById(a.getMemberId()).map(HostedChitMember::getName).orElse(null));
        a.setAcceptedAt(LocalDateTime.now());
        a.setAcceptedFrom("Signed in person, recorded by " + UserContext.get().fullName());
        agreements.save(a);
        activity.record("CHANGED", AREA, "Agreement signed in person · " + a.getAgreementNo() + " · " + c.getName() + " month " + a.getMonthNo());
        return detail(chitId);
    }

    private void makeAgreement(HostedChit c, HostedChitMonth month, HostedChitMember winner, String guarantorName, String guarantorPhone, String terms) {
        HostedChitAgreement a = agreementOf(c, month.getMonthNo());
        if (a != null && !HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement for month " + month.getMonthNo() + " is already " + a.getStatus().toLowerCase());
        }
        boolean fresh = a == null;
        if (fresh) {
            a = new HostedChitAgreement();
            a.setTenantId(c.getTenantId());
            a.setChitId(c.getId());
            a.setMonthNo(month.getMonthNo());
            a.setAgreementNo("AG-pending");
            a.setTerms("pending");          // filled in below, once the number is known
            a.setContentHash("pending");
            a.setCreatedBy(UserContext.username());
            a.setCreatedAt(LocalDateTime.now());
            // the stamp-paper copy carries the organiser's receipt signature until another is drawn for it
            a.setOrganiserName(c.getReceiptSigner() != null ? c.getReceiptSigner() : UserContext.get().fullName());
            a.setOrganiserSignature(c.getReceiptSignature());
        }
        Calc calc = new Calc(c);
        int remaining = c.getMonths() - month.getMonthNo();
        BigDecimal remainingAmount = Money.ZERO;
        for (int no = month.getMonthNo() + 1; no <= c.getMonths(); no++) {
            // the extra a winner pays counts from the next month; auction months not yet held count in full
            remainingAmount = remainingAmount.add(planned(c) ? calc.installmentOf(no) : auction(c) ? c.getInstallment() : c.getInstallment().add(winnerExtra(c)));
        }
        a.setMemberId(winner.getId());
        a.setChitValue(calc.chitValue(month.getMonthNo()));
        a.setDeduction(auction(c) ? month.getBidAmount() : month.getCommissionAmount());
        a.setPayoutAmount(Money.nz(month.getPayoutAmount()));
        a.setPayoutDate(month.getPayoutDate());
        a.setPayoutMode(month.getPayoutMode());
        a.setPayoutReference(month.getPayoutReference());
        a.setRemainingInstallments(remaining);
        a.setRemainingAmount(remainingAmount);
        a.setGuarantorName(blank(guarantorName));
        a.setGuarantorPhone(blank(guarantorPhone));
        a.setStatus(HostedChitAgreement.DRAFT);
        a = agreements.save(a);
        if (fresh) a.setAgreementNo(String.format("AG-%06d", a.getId()));
        a.setTerms(terms != null ? terms : agreementTerms(c, a, winner));
        a.setContentHash(sha256(a.getAgreementNo() + "|" + winner.getName() + "|" + a.getPayoutAmount().toPlainString() + "|" + a.getPayoutDate()
                + "|" + a.getRemainingInstallments() + "|" + a.getRemainingAmount().toPlainString() + "|" + a.getTerms()));
        agreements.save(a);
        activity.record(fresh ? "ADDED" : "CHANGED", AREA, (fresh ? "Made the agreement " : "Updated the agreement ") + a.getAgreementNo()
                + " · " + winner.getName() + " · " + c.getName() + " month " + month.getMonthNo() + " · " + ActivityService.money(a.getPayoutAmount()));
    }

    /**
     * The standard wording, with the figures filled in: numbered clauses, each "HEADING: text" (the deed shows the
     * heading in bold), in the form of a prize-amount receipt and undertaking by a chit subscriber.
     */
    private String agreementTerms(HostedChit c, HostedChitAgreement a, HostedChitMember winner) {
        String organiser = UserContext.get().fullName();
        String household = UserContext.get().tenantName();
        String rupees = ActivityService.money(a.getPayoutAmount()) + " (Rupees " + inWords(a.getPayoutAmount()).replaceFirst("(?i)^rupees\\s+", "")
                .replaceFirst("(?i)\\s+only$", "") + " only)";
        java.time.format.DateTimeFormatter day = java.time.format.DateTimeFormatter.ofPattern("dd MMMM yyyy");
        HostedChitMonth paidMonth = months.findByChitId(c.getId()).stream().filter(m -> m.getMonthNo().equals(a.getMonthNo())).findFirst().orElse(null);
        List<HostedChitLeg> parts = paidMonth == null ? List.of() : legs.findByMonthId(paidMonth.getId()).stream()
                .sorted(Comparator.comparing(HostedChitLeg::getPosition)).toList();
        boolean guarantor = a.getGuarantorName() != null;
        List<String> t = new ArrayList<>();
        t.add("MEMBERSHIP: The Member is a subscriber of the chit known as \"" + c.getName() + "\" of " + c.getMemberCount() + " members and "
                + c.getMonths() + " monthly instalments, with a chit value of " + ActivityService.money(a.getChitValue()) + ", conducted by "
                + organiser + " (" + household + ") as its organiser (foreman).");
        t.add("PRIZE: The Member was declared the prize winner for instalment " + a.getMonthNo() + " of " + c.getMonths()
                + (auction(c) ? ", having offered the highest discount (bid) of " + ActivityService.money(a.getDeduction()) + " at the auction held for that instalment" : "") + ".");
        t.add("RECEIPT OF PRIZE AMOUNT: The Member acknowledges having received from the Organiser a sum of " + rupees
                + (a.getPayoutDate() != null ? " on " + a.getPayoutDate().format(day) : "")
                + (parts.size() > 1
                    ? ", in " + parts.size() + " parts (" + parts.stream().map(l -> DIRECT_MODE.equals(l.getMode())
                        ? ActivityService.money(l.getAmount()) + " paid directly by the other members"
                        : ActivityService.money(l.getAmount()) + " by " + l.getMode() + (l.getReference() != null ? ", reference " + l.getReference() : ""))
                        .collect(Collectors.joining("; ")) + ")"
                    : (a.getPayoutMode() != null ? ", by " + a.getPayoutMode() : "") + (a.getPayoutReference() != null ? " (reference " + a.getPayoutReference() + ")" : ""))
                + (paidMonth != null && paidMonth.getPayoutTo() != null ? ", into " + paidMonth.getPayoutTo() : "")
                + ", being the prize amount for that instalment "
                + (planned(c) ? "as set out in the chit schedule" : "(the chit value less " + (auction(c) ? "the discount bid" : "the organiser's commission") + ")")
                + ", in full and final settlement of the prize amount payable to the Member.");
        if (a.getRemainingInstallments() > 0) {
            t.add("FUTURE SUBSCRIPTIONS: In consideration of the prize amount received, the Member undertakes to pay, without default, each of the remaining "
                    + a.getRemainingInstallments() + " monthly instalment(s) up to the end of the chit, on or before the " + ordinal(c.getDueDay())
                    + " day of every month, being " + (planned(c) ? "the amount set out in the chit schedule for that month"
                        : auction(c) ? ActivityService.money(c.getInstallment()) + " less the dividend declared for that month"
                        : ActivityService.money(c.getInstallment().add(winnerExtra(c))) + (winnerExtra(c).signum() > 0
                            ? " (" + ActivityService.money(c.getInstallment()) + " plus " + ActivityService.money(winnerExtra(c)) + " payable by a prized subscriber)" : ""))
                    + ", amounting to about " + ActivityService.money(a.getRemainingAmount()) + " in all (the \"Future Subscriptions\").");
            t.add("NO WITHDRAWAL: Having drawn the prize amount, the Member shall not withdraw from or discontinue the chit until all the Future Subscriptions "
                    + "have been paid in full.");
        } else {
            t.add("FUTURE SUBSCRIPTIONS: This was the final instalment of the chit; no further subscription is payable by the Member, save any dues already outstanding.");
        }
        if (c.getLateFeePercent() != null) {
            t.add("LATE PAYMENT: Any instalment not paid by its due date shall carry interest at " + c.getLateFeePercent().stripTrailingZeros().toPlainString()
                    + "% per month on the unpaid amount" + (c.getLateGraceDays() != null && c.getLateGraceDays() > 0 ? ", after a grace period of " + c.getLateGraceDays() + " days," : "")
                    + " until it is paid.");
        }
        if (guarantor) {
            t.add("GUARANTEE: " + a.getGuarantorName() + (a.getGuarantorPhone() != null ? " (mobile " + a.getGuarantorPhone() + ")" : "")
                    + " stands as guarantor for the due payment of the Future Subscriptions and shall be liable, jointly and severally with the Member, for any sum the Member fails to pay.");
        }
        t.add("DEFAULT AND RECOVERY: If the Member fails to pay any instalment when due, the whole of the Future Subscriptions then unpaid shall, at the "
                + "option of the Organiser, become immediately due and payable, and the Organiser shall be entitled to recover the same"
                + (c.getLateFeePercent() != null ? " with late-payment interest" : "") + ", together with the reasonable costs of recovery, from the Member"
                + (guarantor ? " and the guarantor" : "") + " by all lawful means, including proceedings before a court of competent jurisdiction.");
        t.add("REPRESENTATIONS: The Member represents that he or she is a major, of sound mind and competent to contract, and that the proof of identity, "
                + "photograph and particulars furnished with this Agreement are true, correct and belong to the Member.");
        t.add("ELECTRONIC EXECUTION AND EVIDENCE: The parties agree that this Agreement may be accepted electronically. The verification of the Member's "
                + "mobile number, the Member's signature and photograph, the details of the device used and the digitally signed record of acceptance shall "
                + "constitute valid evidence of its execution, in accordance with the Information Technology Act, 2000 and the Bharatiya Sakshya Adhiniyam, 2023.");
        t.add("NOTICES: Any notice under this Agreement may be given at the address or mobile number of the party on record with the Organiser, including by "
                + "SMS, WhatsApp or e-mail, and shall be deemed received on the day it is sent.");
        t.add("GOVERNING LAW AND JURISDICTION: This Agreement shall be governed by the laws of India, including, where applicable, the Chit Funds Act, 1982 "
                + "and the rules made under it. The courts having jurisdiction over the place where the chit is conducted shall have exclusive jurisdiction "
                + "in all matters arising out of it.");
        t.add("ENTIRE AGREEMENT AND SEVERABILITY: This Agreement records the entire understanding of the parties on its subject and may be amended only in "
                + "writing signed by both parties. If any provision is held invalid, the remaining provisions shall continue in full force.");
        t.add("DECLARATION: The Member declares that he or she has read this Agreement, or has had it read over and explained in a language he or she "
                + "understands, has understood its contents, and has executed it freely and voluntarily, without any coercion, undue influence or misrepresentation.");
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < t.size(); i++) out.append(i + 1).append(". ").append(t.get(i)).append(i + 1 < t.size() ? "\n" : "");
        return out.toString();
    }

    private HostedChitAgreement agreementOf(HostedChit c, int monthNo) {
        return agreements.findByChitId(c.getId()).stream().filter(a -> a.getMonthNo() == monthNo).findFirst().orElse(null);
    }

    private HostedChitAgreement requireAgreement(HostedChit c, Long id) {
        return agreements.findById(id).filter(a -> a.getChitId().equals(c.getId())).orElseThrow(() -> new NotFoundException("Agreement", id));
    }

    private void dropAgreement(HostedChit c, HostedChitAgreement a) {
        shares.deleteAll(shares.findByChitId(c.getId()).stream().filter(x -> a.getId().equals(x.getAgreementId())).toList());
        files.deleteAllForAgreement(AGREEMENT_FILES, a.getId());
        agreements.deleteById(a.getId());
    }

    private static String ordinal(int n) {
        int v = n % 100;
        String suffix = v >= 11 && v <= 13 ? "th" : switch (n % 10) { case 1 -> "st"; case 2 -> "nd"; case 3 -> "rd"; default -> "th"; };
        return n + suffix;
    }

    static String sha256(String text) {
        try {
            byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(hash);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 475000 -> "Rupees Four Lakh Seventy Five Thousand only" (the Indian way). */
    static String inWords(BigDecimal amount) {
        long n = amount.setScale(0, java.math.RoundingMode.HALF_UP).longValue();
        if (n == 0) return "Rupees Zero only";
        String[] ones = {"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
                "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"};
        String[] tens = {"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"};
        java.util.function.IntFunction<String> two = x -> x < 20 ? ones[x] : (tens[x / 10] + (x % 10 > 0 ? " " + ones[x % 10] : ""));
        StringBuilder b = new StringBuilder();
        long crore = n / 10_000_000; n %= 10_000_000;
        long lakh = n / 100_000; n %= 100_000;
        long thousand = n / 1000; n %= 1000;
        long hundred = n / 100; n %= 100;
        if (crore > 0) b.append(crore < 100 ? two.apply((int) crore) : inWords(BigDecimal.valueOf(crore)).replace("Rupees ", "").replace(" only", "")).append(" Crore ");
        if (lakh > 0) b.append(two.apply((int) lakh)).append(" Lakh ");
        if (thousand > 0) b.append(two.apply((int) thousand)).append(" Thousand ");
        if (hundred > 0) b.append(ones[(int) hundred]).append(" Hundred ");
        if (n > 0) b.append(b.length() > 0 ? "and " : "").append(two.apply((int) n));
        return "Rupees " + b.toString().trim() + " only";
    }

    private AgreementView agreementView(HostedChitAgreement a, Map<Long, String> names) {
        return new AgreementView(a.getId(), a.getMonthNo(), a.getMemberId(), names.get(a.getMemberId()), a.getAgreementNo(), a.getChitValue(),
                a.getDeduction(), a.getPayoutAmount(), a.getPayoutDate(), a.getPayoutMode(), a.getPayoutReference(), a.getRemainingInstallments(),
                a.getRemainingAmount(), a.getGuarantorName(), a.getGuarantorPhone(), a.getTerms(), a.getContentHash(), a.getStatus(),
                a.getAcceptedName(), a.getAcceptedAt(), a.getAcceptedFrom(), a.getAcceptedPhone(), a.getPhoneMatches(), a.getAcceptedIp(),
                a.getAcceptedDevice(), a.getDeviceHash(), a.getAcceptedLocation(), a.getSignature(), a.getAcceptanceSeal(), a.getCreatedAt(),
                a.getStampDuty(), a.getStampSerial(), a.getOrganiserName(), a.getOrganiserSignature(), a.getWitnessName(), a.getWitnessPhone(),
                a.getWitnessAddress(), a.getWitnessSignature(), a.getAadhaarLast4(), a.getPanMasked(), Boolean.TRUE.equals(a.getKycFromMember()),
                files.listForAgreement(AGREEMENT_FILES, a.getId()), a.getEvidencePayload(), a.getDigitalSignature());
    }

    /** Attachment owner kind of a chit agreement's ID proof. */
    public static final String AGREEMENT_FILES = "CHIT_AGREEMENT";

    /**
     * The stamp-paper copy of an agreement: the stamp's value and serial, the organiser's signature and name, the
     * witness (name, phone, address, signature) and the member's ID numbers. These are not part of the agreement's
     * wording (its fingerprint stays), so they can be added or corrected after it is accepted; the ID numbers only
     * while it waits for the member.
     */
    @Transactional
    public Detail setBond(Long chitId, Long agreementId, BondRequest r) {
        HostedChit c = editable(chitId);
        HostedChitAgreement a = requireAgreement(c, agreementId);
        boolean draft = HostedChitAgreement.DRAFT.equals(a.getStatus());
        if (r.stampDuty() != null) a.setStampDuty(r.stampDuty().signum() > 0 ? Money.round(r.stampDuty()) : null);
        if (r.stampSerial() != null) a.setStampSerial(blank(r.stampSerial()));
        if (r.organiserName() != null) a.setOrganiserName(blank(r.organiserName()));
        if (Boolean.TRUE.equals(r.clearOrganiserSignature())) a.setOrganiserSignature(null);
        if (Boolean.TRUE.equals(r.useReceiptSignature())) {
            if (c.getReceiptSignature() == null) throw new BusinessException("Draw your receipt signature in the chit's settings first, or draw one here");
            a.setOrganiserSignature(c.getReceiptSignature());
            if (a.getOrganiserName() == null) a.setOrganiserName(c.getReceiptSigner());
        } else if (blank(r.organiserSignature()) != null) {
            a.setOrganiserSignature(drawn(r.organiserSignature(), "your signature"));
        }
        if (r.witnessName() != null) a.setWitnessName(blank(r.witnessName()));
        if (r.witnessPhone() != null) a.setWitnessPhone(blank(r.witnessPhone()) == null ? null : cleanPhone(r.witnessPhone(), "The witness"));
        if (r.witnessAddress() != null) a.setWitnessAddress(blank(r.witnessAddress()));
        if (Boolean.TRUE.equals(r.clearWitnessSignature())) a.setWitnessSignature(null);
        else if (blank(r.witnessSignature()) != null) {
            if (a.getWitnessName() == null) throw new BusinessException("Enter the witness's name with their signature");
            a.setWitnessSignature(drawn(r.witnessSignature(), "the witness's signature"));
        }
        if (blank(r.aadhaarNumber()) != null || blank(r.pan()) != null || r.kycFromMember() != null) {
            if (!draft && (blank(r.aadhaarNumber()) != null || blank(r.pan()) != null)) {
                throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase() + "; its ID numbers are part of the record");
            }
            if (blank(r.aadhaarNumber()) != null) {
                String aadhaar = Kyc.aadhaar(r.aadhaarNumber());
                a.setAadhaarLast4(aadhaar.substring(8));
                a.setAadhaarHash(Kyc.hash(a.getAgreementNo(), aadhaar));
            }
            if (blank(r.pan()) != null) {
                String pan = Kyc.pan(r.pan());
                a.setPanMasked(Kyc.maskPan(pan));
                a.setPanHash(Kyc.hash(a.getAgreementNo(), pan));
            }
            if (r.kycFromMember() != null && draft) a.setKycFromMember(r.kycFromMember());
        }
        agreements.save(a);
        activity.record("CHANGED", AREA, "Stamp-paper details of the agreement " + a.getAgreementNo() + " · " + c.getName() + " month " + a.getMonthNo()
                + (a.getWitnessSignature() != null ? " · witness signed" : "") + (a.getAadhaarLast4() != null ? " · Aadhaar ••" + a.getAadhaarLast4() : ""));
        return detail(chitId);
    }

    /** Adds the member's Aadhaar, PAN or photo to an agreement (by the organiser), while it waits for the member. */
    @Transactional
    public Detail addAgreementFile(Long chitId, Long agreementId, String docType, String fileName, byte[] bytes, String source) {
        HostedChit c = editable(chitId);
        HostedChitAgreement a = requireAgreement(c, agreementId);
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase() + "; its ID proof is part of the record");
        }
        AttachmentService.AgreementFile f = files.addToAgreement(AGREEMENT_FILES, a.getId(), docType, fileName, bytes, source, "chit agreement " + a.getAgreementNo());
        activity.record("ADDED", AREA, "Added " + f.docType().replace('_', ' ').toLowerCase() + " to the agreement " + a.getAgreementNo() + " · " + c.getName());
        return detail(chitId);
    }

    @Transactional
    public Detail deleteAgreementFile(Long chitId, Long agreementId, Long fileId) {
        HostedChit c = editable(chitId);
        HostedChitAgreement a = requireAgreement(c, agreementId);
        if (!HostedChitAgreement.DRAFT.equals(a.getStatus())) {
            throw new BusinessException("The agreement is already " + a.getStatus().toLowerCase() + "; its ID proof is part of the record");
        }
        files.deleteFromAgreement(AGREEMENT_FILES, a.getId(), fileId);
        activity.record("DELETED", AREA, "Removed a file from the agreement " + a.getAgreementNo() + " · " + c.getName());
        return detail(chitId);
    }

    /** The bytes of one of an agreement's files (to print the stamp-paper copy with its annexures). */
    public AttachmentService.FileContent agreementFile(Long chitId, Long agreementId, Long fileId, boolean thumb) {
        HostedChitAgreement a = requireAgreement(require(chitId), agreementId);
        return files.agreementFileContent(AGREEMENT_FILES, a.getId(), fileId, thumb);
    }

    /** A drawn signature (an SVG path), checked. */
    static String drawn(String path, String what) {
        String s = path == null ? "" : path.trim();
        if (s.length() < 20 || !s.matches("[MLml0-9 .\\-]+")) {
            throw new BusinessException("Draw " + what + " in the box");
        }
        return s;
    }

    // ================================================================== report

    public record ReportMonth(String month, BigDecimal collected, BigDecimal paidOut, BigDecimal commission, BigDecimal lateFees) {
    }

    public record ReportChit(Long id, String name, String chitType, String status, int memberCount, int months, int currentMonth,
                             int completedMonths, BigDecimal chitValue, BigDecimal installment, BigDecimal collected, BigDecimal paidOut,
                             BigDecimal commission, BigDecimal lateFees, BigDecimal pendingDues, BigDecimal lateFeesDue, BigDecimal held,
                             BigDecimal collectedThisMonth, BigDecimal expectedThisMonth, int agreementsAccepted, int agreementsPending,
                             int payoutsWithoutAgreement, LocalDate nextDueDate) {
    }

    /** A member who owes money now (installments past their due date, and late interest). */
    public record ReportDefaulter(Long chitId, String chitName, Long memberId, String member, String phone, int monthsOverdue,
                                  LocalDate oldestDue, int daysLate, BigDecimal overdue, BigDecimal lateFeeDue) {
    }

    public record ReportAging(String label, int count, BigDecimal amount) {
    }

    /** Hosted chits for the Reports page: totals for a period (by the date money moved) and dues as of today. */
    public record Report(LocalDate from, LocalDate to, int running, int finished, int members, BigDecimal collected, BigDecimal paidOut,
                         BigDecimal commission, BigDecimal lateFees, BigDecimal pendingDues, BigDecimal lateFeesDue, BigDecimal held,
                         BigDecimal collectedThisMonth, BigDecimal expectedThisMonth, List<ReportChit> chits, List<ReportMonth> months,
                         List<ReportAging> aging, List<ReportDefaulter> defaulters) {
    }

    public Report report(LocalDate from, LocalDate to) {
        LocalDate start = from != null ? from : LocalDate.now().withDayOfMonth(1).minusMonths(11);
        LocalDate end = to != null ? to : LocalDate.now();
        LocalDate today = LocalDate.now();
        Map<String, BigDecimal[]> byMonth = new java.util.LinkedHashMap<>();
        for (YearMonth ym = YearMonth.from(start); !ym.isAfter(YearMonth.from(end)); ym = ym.plusMonths(1)) {
            byMonth.put(ym.toString(), new BigDecimal[] {Money.ZERO, Money.ZERO, Money.ZERO, Money.ZERO});
        }
        String[] labels = {"Due, not late yet", "1–30 days late", "31–60 days late", "61–90 days late", "Over 90 days late"};
        int[] agingCount = new int[5];
        BigDecimal[] agingAmount = {Money.ZERO, Money.ZERO, Money.ZERO, Money.ZERO, Money.ZERO};
        List<ReportChit> rows = new ArrayList<>();
        List<ReportDefaulter> defaulters = new ArrayList<>();
        BigDecimal[] totals = {Money.ZERO, Money.ZERO, Money.ZERO, Money.ZERO};
        int members = 0;
        for (HostedChit c : chits.findByTenantId(UserContext.tenantId())) {
            Calc calc = new Calc(c);
            ChitView v = calc.view();
            members += calc.memberList.size();
            BigDecimal collected = Money.ZERO, late = Money.ZERO, paidOut = Money.ZERO, commission = Money.ZERO;
            for (HostedChitPayment p : calc.paymentList) {
                if (p.getPaidDate().isBefore(start) || p.getPaidDate().isAfter(end)) continue;
                collected = collected.add(p.getAmount());
                late = late.add(Money.nz(p.getLateFee()));
                BigDecimal[] m = byMonth.get(YearMonth.from(p.getPaidDate()).toString());
                if (m != null) { m[0] = m[0].add(p.getAmount()); m[3] = m[3].add(Money.nz(p.getLateFee())); }
            }
            for (HostedChitMonth m : calc.monthList) {
                if (m.getPayoutDate() == null || m.getPayoutDate().isBefore(start) || m.getPayoutDate().isAfter(end)) continue;
                paidOut = paidOut.add(Money.nz(m.getPayoutAmount()));
                commission = commission.add(Money.nz(m.getCommissionAmount()));
                BigDecimal[] x = byMonth.get(YearMonth.from(m.getPayoutDate()).toString());
                if (x != null) { x[1] = x[1].add(Money.nz(m.getPayoutAmount())); x[2] = x[2].add(Money.nz(m.getCommissionAmount())); }
            }
            totals[0] = totals[0].add(collected);
            totals[1] = totals[1].add(paidOut);
            totals[2] = totals[2].add(commission);
            totals[3] = totals[3].add(late);
            // dues as of today, by how late they are, and who owes
            for (HostedChitMember mem : calc.memberList) {
                BigDecimal overdue = Money.ZERO;
                int monthsOverdue = 0;
                LocalDate oldest = null;
                BigDecimal lateDue = Money.ZERO;
                for (int no = 1; no <= c.getMonths(); no++) {
                    if (!calc.due(no)) continue;
                    lateDue = lateDue.add(calc.lateDue(mem.getId(), no));
                    BigDecimal rest = calc.due(mem.getId(), no).subtract(calc.paid(mem.getId(), no));
                    if (rest.signum() <= 0) continue;
                    LocalDate dueOn = dueDate(c, no);
                    long days = java.time.temporal.ChronoUnit.DAYS.between(dueOn, today);
                    int bucket = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
                    agingCount[bucket]++;
                    agingAmount[bucket] = agingAmount[bucket].add(rest);
                    if (days > 0) {
                        overdue = overdue.add(rest);
                        monthsOverdue++;
                        if (oldest == null) oldest = dueOn;
                    }
                }
                if (overdue.signum() > 0 || lateDue.signum() > 0) {
                    defaulters.add(new ReportDefaulter(c.getId(), c.getName(), mem.getId(), mem.getName(), mem.getPhone(), monthsOverdue, oldest,
                            oldest == null ? 0 : (int) java.time.temporal.ChronoUnit.DAYS.between(oldest, today), overdue, lateDue));
                }
            }
            List<HostedChitAgreement> ags = agreements.findByChitId(c.getId());
            int accepted = (int) ags.stream().filter(a -> !HostedChitAgreement.DRAFT.equals(a.getStatus())).count();
            int without = (int) calc.monthList.stream().filter(m -> m.getPayoutDate() != null)
                    .filter(m -> ags.stream().noneMatch(a -> a.getMonthNo().equals(m.getMonthNo()))).count();
            rows.add(new ReportChit(c.getId(), c.getName(), v.chitType(), c.getStatus(), v.memberCount(), v.months(), v.currentMonth(),
                    v.completedMonths(), v.currentChitValue(), v.installment(), collected, paidOut, commission, late, v.pendingDues(),
                    v.lateFeesDue(), v.held(), v.collectedThisMonth(), v.expectedThisMonth(), accepted, ags.size() - accepted, without,
                    v.nextDueDate()));
        }
        rows.sort(Comparator.comparing((ReportChit r) -> HostedChit.COMPLETED.equals(r.status())).thenComparing(ReportChit::name));
        defaulters.sort(Comparator.comparing((ReportDefaulter d) -> d.overdue().add(d.lateFeeDue())).reversed());
        List<ReportMonth> monthRows = byMonth.entrySet().stream()
                .map(e -> new ReportMonth(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2], e.getValue()[3])).toList();
        List<ReportAging> aging = new ArrayList<>();
        for (int i = 0; i < 5; i++) aging.add(new ReportAging(labels[i], agingCount[i], agingAmount[i]));
        Function<Function<ReportChit, BigDecimal>, BigDecimal> sum = f -> rows.stream().filter(r -> HostedChit.ACTIVE.equals(r.status()))
                .map(f).reduce(Money.ZERO, BigDecimal::add);
        return new Report(start, end, (int) rows.stream().filter(r -> HostedChit.ACTIVE.equals(r.status())).count(),
                (int) rows.stream().filter(r -> !HostedChit.ACTIVE.equals(r.status())).count(), members,
                totals[0], totals[1], totals[2], totals[3], sum.apply(ReportChit::pendingDues), sum.apply(ReportChit::lateFeesDue),
                sum.apply(ReportChit::held), sum.apply(ReportChit::collectedThisMonth), sum.apply(ReportChit::expectedThisMonth),
                rows, monthRows, aging, defaulters.stream().limit(25).toList());
    }

    // ================================================================== helpers

    private HostedChit require(Long id) {
        return chits.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Hosted chit", id));
    }

    /** A chit to change: it must not be closed. */
    private HostedChit editable(Long id) {
        HostedChit c = require(id);
        requireOpen(c);
        return c;
    }

    private HostedChitMember requireMember(HostedChit c, Long memberId) {
        return members.findById(memberId).filter(m -> m.getChitId().equals(c.getId()))
                .orElseThrow(() -> new NotFoundException("Member", memberId));
    }

    private HostedChitPayment requirePayment(HostedChit c, Long paymentId) {
        return payments.findById(paymentId).filter(p -> p.getChitId().equals(c.getId()))
                .orElseThrow(() -> new NotFoundException("Payment", paymentId));
    }

    /** The winner cannot change while members have paid the current winner directly. */
    private static void requireNoDirect(Calc calc, HostedChitMonth month, Long keepWinner) {
        if (month.getWinnerMemberId() == null || month.getWinnerMemberId().equals(keepWinner)) return;
        long direct = calc.paymentList.stream().filter(p -> p.getMonthNo().equals(month.getMonthNo())
                && month.getWinnerMemberId().equals(p.getPaidToMemberId())).count();
        if (direct > 0) {
            throw new BusinessException(direct + " payment" + (direct == 1 ? " was" : "s were") + " made directly to the winner of month "
                    + month.getMonthNo() + "; undo " + (direct == 1 ? "it" : "them") + " before changing the winner");
        }
    }

    private boolean directAccountId(Long accountId) {
        return accountId != null && accounts.findById(accountId).map(a -> Account.ROLE_DIRECT.equals(a.getChitRole())).orElse(false);
    }

    private String payToName(Long accountId) {
        return accountId == null ? null : accounts.findById(accountId).map(Account::getName).orElse(null);
    }

    /** What a member's link shows for the account: "UPI name@bank" or "A/c ••1234 · IFSC". */
    private String payToSummary(Long accountId) {
        return accountId == null ? null : accounts.findById(accountId).map(a -> a.getUpiId() != null ? "UPI " + a.getUpiId()
                : a.getAccountNumber() != null && a.getIfsc() != null
                ? "A/c ••" + a.getAccountNumber().replace(" ", "").substring(Math.max(0, a.getAccountNumber().replace(" ", "").length() - 4)) + " · " + a.getIfsc()
                : "no bank details").orElse(null);
    }

    /**
     * An account members can be asked to pay into: a bank or wallet account, active, with a UPI ID or a bank account
     * number and IFSC (they go on the member's payment link).
     */
    Account requirePayTo(Long accountId) {
        Account a = accountService.require(accountId);
        if (!Boolean.TRUE.equals(a.getActive()) || (a.getAccountType() != AccountType.BANK && a.getAccountType() != AccountType.WALLET)) {
            throw new BusinessException("Members pay into a bank or wallet account; " + a.getName() + " is not one");
        }
        boolean bank = a.getAccountNumber() != null && !a.getAccountNumber().isBlank() && a.getIfsc() != null;
        if (a.getUpiId() == null && !bank) {
            throw new BusinessException(a.getName() + " has no UPI ID or bank details (account number and IFSC): add them to the account first");
        }
        return a;
    }

    /**
     * A fellow member another member may pay directly: of the same chit, not themselves, with a UPI ID or a mobile
     * number, and chosen as the winner of a month not yet paid out (the money is set off against their payout).
     */
    HostedChitMember requirePayToMember(HostedChit c, HostedChitMember payer, Long targetId) {
        HostedChitMember t = requireMember(c, targetId);
        if (t.getId().equals(payer.getId())) {
            throw new BusinessException(payer.getName() + " cannot pay themselves");
        }
        if (t.getUpiId() == null && t.getPhone() == null) {
            throw new BusinessException(t.getName() + " has no UPI ID or mobile number to be paid on: add one first");
        }
        boolean winning = months.findByChitId(c.getId()).stream()
                .anyMatch(x -> t.getId().equals(x.getWinnerMemberId()) && x.getPayoutDate() == null);
        if (!winning) {
            throw new BusinessException("Members can pay only a month's winner directly (it is set off against the payout): "
                    + t.getName() + " is not the winner of an open month");
        }
        return t;
    }

    /** A member's own UPI ID, checked (name@bank). */
    private static String cleanUpi(String upi, String name) {
        if (upi == null || upi.isBlank()) {
            return null;
        }
        String v = upi.trim();
        if (!v.matches("[\\w.\\-]{2,}@[A-Za-z][\\w.]{1,}")) {
            throw new BusinessException(name + "'s UPI ID should look like name@bank");
        }
        return v;
    }

    /** The chit's short code: the one kept, else made from its name (AC5L for "Aditya Chitfunds 5L (Nov26-Jun28)"). */
    public static String shortCodeOf(HostedChit c) {
        return c.getShortCode() != null && !c.getShortCode().isBlank() ? c.getShortCode() : deriveShortCode(c.getName());
    }

    /** First letters of the words, number-and-letter words whole (5L, 2L), up to 4 characters, upper case. */
    static String deriveShortCode(String name) {
        StringBuilder b = new StringBuilder();
        for (String w : (name == null ? "" : name).split("[^A-Za-z0-9]+")) {
            if (w.isEmpty()) continue;
            b.append(w.chars().anyMatch(Character::isDigit) ? w.toUpperCase() : w.substring(0, 1).toUpperCase());
            if (b.length() >= 4) break;
        }
        String s = b.length() > 4 ? b.substring(0, 4) : b.toString();
        return s.isEmpty() ? "CHIT" : s;
    }

    /** The 8-character payment note for a month: AC5L-M03 (a 100-month chit: AC5-M100). */
    public static String payCode(String shortCode, int monthNo) {
        String m = monthNo < 100 ? String.format("M%02d", monthNo) : "M" + monthNo;
        String s = shortCode.length() > 7 - m.length() ? shortCode.substring(0, 7 - m.length()) : shortCode;
        return s + "-" + m;
    }

    /**
     * Gives every chit of the household without a short code one made from its name, the oldest chit first, so two
     * chits never share a code (AC5L, then AC52 ...). Run at start-up; returns how many were given one.
     */
    @Transactional
    public int assignShortCodes() {
        List<HostedChit> all = chits.findByTenantId(UserContext.tenantId()).stream().sorted(Comparator.comparing(HostedChit::getId)).toList();
        Set<String> taken = all.stream().map(HostedChit::getShortCode).filter(x -> x != null && !x.isBlank()).collect(Collectors.toSet());
        int given = 0;
        for (HostedChit c : all) {
            if (c.getShortCode() != null && !c.getShortCode().isBlank()) continue;
            String code = deriveShortCode(c.getName());
            for (int i = 2; taken.contains(code) && i <= 9; i++) {
                code = (code.length() >= 4 ? code.substring(0, 3) : code) + i;
            }
            c.setShortCode(code);
            taken.add(code);
            chits.save(c);
            given++;
        }
        return given;
    }

    /** The code asked for (upper case), or one made from the name; another chit of the household may not use it. */
    private String uniqueShortCode(HostedChit c, String asked) {
        java.util.Set<String> taken = new java.util.HashSet<>();
        chits.findByTenantId(UserContext.tenantId()).stream().filter(x -> !x.getId().equals(c.getId()))
                .forEach(x -> taken.add(shortCodeOf(x)));
        if (asked != null && !asked.isBlank()) {
            String code = asked.trim().toUpperCase();
            if (code.equals(c.getShortCode())) {
                return code;   // unchanged
            }
            if (taken.contains(code)) {
                throw new BusinessException("Another chit already uses the short code " + code + ": pick another, so payment notes stay clear");
            }
            return code;
        }
        if (c.getShortCode() != null && !c.getShortCode().isBlank()) {
            return c.getShortCode();
        }
        String code = deriveShortCode(c.getName());
        for (int i = 2; taken.contains(code) && i <= 9; i++) {
            code = (code.length() >= 4 ? code.substring(0, 3) : code) + i;
        }
        return code;
    }

    private static boolean hasPayments(Calc calc, int monthNo) {
        return calc.paymentList.stream().anyMatch(p -> p.getMonthNo() == monthNo);
    }

    /**
     * Members: names present and different from each other, a phone that is a 10-digit Indian mobile number (a +91
     * or 0 in front is dropped), an e-mail that looks like one.
     */
    static List<MemberInput> cleanMembers(List<MemberInput> list) {
        java.util.Set<String> seen = new HashSet<>();
        List<MemberInput> out = new ArrayList<>();
        for (MemberInput m : list) {
            String name = m.name() == null ? "" : m.name().trim().replaceAll("\\s+", " ");
            if (name.isEmpty()) throw new BusinessException("Every member needs a name");
            if (!seen.add(name.toLowerCase(java.util.Locale.ROOT))) {
                throw new BusinessException("Two members are called \"" + name + "\"; add a surname or an initial");
            }
            out.add(new MemberInput(name, cleanPhone(m.phone(), name), m.email() == null || m.email().isBlank() ? null : m.email().trim(),
                    m.payoutAccount() == null || m.payoutAccount().isBlank() ? null : m.payoutAccount().trim(), m.payToAccountId(),
                    m.upiId(), null));
        }
        return out;
    }

    static String cleanPhone(String phone, String name) {
        if (phone == null || phone.isBlank()) return null;
        String digits = phone.replaceAll("\\D", "");
        if (digits.length() == 12 && digits.startsWith("91")) digits = digits.substring(2);
        if (digits.length() == 11 && digits.startsWith("0")) digits = digits.substring(1);
        if (!digits.matches("[6-9]\\d{9}")) {
            throw new BusinessException(name + ": the phone should be a 10-digit mobile number");
        }
        return digits;
    }

    private static void requireMonthNo(HostedChit c, Integer monthNo) {
        if (monthNo == null || monthNo < 1 || monthNo > c.getMonths()) {
            throw new BusinessException("Month must be between 1 and " + c.getMonths());
        }
    }

    private boolean structureLocked(HostedChit c) {
        return !payments.findByChitId(c.getId()).isEmpty()
                || months.findByChitId(c.getId()).stream().anyMatch(m -> m.getWinnerMemberId() != null);
    }

    private static String extraType(HostedChit c) {
        return c.getWinnerExtraType() == null ? EXTRA_NONE : c.getWinnerExtraType();
    }

    /** The rupees a winner pays on top of the installment in each month after winning. */
    static BigDecimal winnerExtra(HostedChit c) {
        BigDecimal value = Money.nz(c.getWinnerExtraValue());
        return switch (extraType(c)) {
            case EXTRA_PERCENT -> Money.round(c.getBaseValue().multiply(value).divide(Money.HUNDRED));
            case EXTRA_FIXED -> Money.round(value);
            default -> Money.ZERO;
        };
    }

    static LocalDate dueDate(HostedChit c, int monthNo) {
        YearMonth ym = YearMonth.from(c.getStartMonth()).plusMonths(monthNo - 1L);
        return ym.atDay(Math.min(c.getDueDay(), ym.lengthOfMonth()));
    }

    private static String mode(String mode) {
        if (mode == null || mode.isBlank()) return "Cash";
        return MODES.stream().filter(m -> m.equalsIgnoreCase(mode.trim())).findFirst()
                .orElseThrow(() -> new BusinessException("Mode must be Cash, UPI or Bank"));
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /** The liability that holds the members' money between collection and payout (created on first use). */
    private Account fundsAccount() {
        return book.fundsAccount();
    }

    /**
     * The income category for the commission (and late interest): the one chosen for the chit, otherwise a separate
     * "Chit Commission Income" category, made on first use.
     */
    private Category commissionCategory(HostedChit c) {
        if (c.getCommissionCategoryId() != null) {
            Optional<Category> chosen = categoryRepository.findByIdAndTenantId(c.getCommissionCategoryId(), UserContext.tenantId());
            if (chosen.isPresent()) return chosen.get();
        }
        return categoryRepository.findBySystemKey(UserContext.tenantId(), DefaultChartOfAccounts.CHIT_COMMISSION)
                .or(() -> categoryRepository.findByName(UserContext.tenantId(), CategoryKind.INCOME, COMMISSION_CATEGORY))
                .orElseGet(() -> categoryService.require(categoryService.create(new CategoryRequest(CategoryKind.INCOME, COMMISSION_CATEGORY,
                        null, "Commission and late payment interest from the chits I run (Host a Chit)", true, null)).id()));
    }

    /** Late payment interest is booked under its own income category, made on first use. */
    private Category lateFeeCategory() {
        return categoryRepository.findByName(UserContext.tenantId(), CategoryKind.INCOME, LATE_FEE_CATEGORY)
                .orElseGet(() -> categoryService.require(categoryService.create(new CategoryRequest(CategoryKind.INCOME, LATE_FEE_CATEGORY,
                        null, "Interest on late installments from the chits I run (Host a Chit)", true, null)).id()));
    }

    static boolean auction(HostedChit c) {
        return HostedChit.TYPE_AUCTION.equals(c.getChitType());
    }

    static boolean planned(HostedChit c) {
        return HostedChit.TYPE_PLANNED.equals(c.getChitType());
    }

    /** FIXED, AUCTION or PLANNED (older chits without a type are fixed). */
    static String typeOf(HostedChit c) {
        return auction(c) ? HostedChit.TYPE_AUCTION : planned(c) ? HostedChit.TYPE_PLANNED : HostedChit.TYPE_FIXED;
    }

    /** Auction chits: the highest bid allowed (maxBidPercent of the chit value). */
    static BigDecimal maxBid(HostedChit c) {
        BigDecimal pct = c.getMaxBidPercent() == null ? BigDecimal.valueOf(40) : c.getMaxBidPercent();
        return Money.round(c.getBaseValue().multiply(pct).divide(Money.HUNDRED));
    }

    // ================================================================== figures

    /** Everything about one chit, worked out once from its rows. */
    private final class Calc {

        final HostedChit c;
        final List<HostedChitMember> memberList;
        final List<HostedChitMonth> monthList;
        final List<HostedChitPayment> paymentList;
        final Map<Long, Map<Integer, BigDecimal>> paid = new HashMap<>();
        final Map<Long, Integer> won = new HashMap<>();
        final int completedMonths;
        /** The first month not paid out (months + 1 when all are). */
        final int currentMonth;
        final LocalDate today = LocalDate.now();

        Calc(HostedChit c) {
            this.c = c;
            this.memberList = members.findByChitId(c.getId()).stream().sorted(Comparator.comparing(HostedChitMember::getSlot)).toList();
            this.monthList = months.findByChitId(c.getId()).stream().sorted(Comparator.comparing(HostedChitMonth::getMonthNo)).toList();
            this.paymentList = payments.findByChitId(c.getId()).stream()
                    .sorted(Comparator.comparing(HostedChitPayment::getPaidDate).thenComparing(HostedChitPayment::getId)).toList();
            for (HostedChitPayment p : paymentList) {
                paid.computeIfAbsent(p.getMemberId(), k -> new HashMap<>()).merge(p.getMonthNo(), p.getAmount(), BigDecimal::add);
            }
            monthList.stream().filter(m -> m.getWinnerMemberId() != null).forEach(m -> won.put(m.getWinnerMemberId(), m.getMonthNo()));
            this.completedMonths = (int) monthList.stream().filter(m -> m.getPayoutDate() != null).count();
            this.currentMonth = monthList.stream().filter(m -> m.getPayoutDate() == null).mapToInt(HostedChitMonth::getMonthNo)
                    .min().orElse(c.getMonths() + 1);
            Map<Long, Integer> monthNoById = new HashMap<>();
            monthList.forEach(m -> monthNoById.put(m.getId(), m.getMonthNo()));
            legs.findByChitId(c.getId()).stream().filter(l -> l.getMonthId() != null)
                    .forEach(l -> HostedChitBookService.ids(l.getPaymentIds()).forEach(id -> paidOutIn.put(id, monthNoById.get(l.getMonthId()))));
        }

        /** Payment id → the month whose payout carried it (a payout part names it). */
        final Map<Long, Integer> paidOutIn = new HashMap<>();

        /**
         * Why a payment cannot change, or null: it was recorded before its month's payout (the payout paid it out), a
         * payout part carries it, or the chit is closed.
         */
        String lockReason(HostedChitPayment p) {
            if (closed(c)) return "the chit is closed";
            HostedChitMonth m = monthList.stream().filter(x -> x.getMonthNo().equals(p.getMonthNo())).findFirst().orElse(null);
            if (m != null && m.getPayoutDate() != null
                    && (m.getPayoutRecordedAt() == null || p.getCreatedAt() == null || !p.getCreatedAt().isAfter(m.getPayoutRecordedAt()))) {
                return "month " + m.getMonthNo() + " was paid out on " + m.getPayoutDate().format(java.time.format.DateTimeFormatter.ofPattern("dd MMM yyyy"))
                        + " with it" + (p.getPaidToMemberId() != null ? " (paid directly to the winner)" : "");
            }
            Integer carried = paidOutIn.get(p.getId());
            if (carried != null) return "it went out in the month " + carried + " payout";
            return null;
        }

        BigDecimal paid(Long memberId, int monthNo) {
            return paid.getOrDefault(memberId, Map.of()).getOrDefault(monthNo, Money.ZERO);
        }

        Integer wonMonth(Long memberId) {
            return won.get(memberId);
        }

        /** Planned chits: what each member pays in a month (the chit table). */
        BigDecimal installmentOf(int monthNo) {
            HostedChitMonth m = monthList.stream().filter(x -> x.getMonthNo() == monthNo).findFirst().orElse(null);
            if (m != null && m.getPlannedInstallment() != null) return m.getPlannedInstallment();
            return c.getInstallment().add(Money.nz(c.getInstallmentIncrement()).multiply(BigDecimal.valueOf(monthNo - 1L)));
        }

        /** Planned chits: the month's commission (collected less the payout; negative when it pays out more). */
        BigDecimal plannedCommission(int monthNo) {
            HostedChitMonth m = month(monthNo);
            return chitValue(monthNo).subtract(Money.nz(m.getPlannedPayout()));
        }

        /** What a member owes for a month: the installment, plus the winner extra in months after their win. */
        BigDecimal due(Long memberId, int monthNo) {
            if (planned(c)) return installmentOf(monthNo);
            if (auction(c)) return c.getInstallment().subtract(dividend(monthNo));
            Integer w = won.get(memberId);
            return w != null && w < monthNo ? c.getInstallment().add(winnerExtra(c)) : c.getInstallment();
        }

        /**
         * Late interest on a member's month: simple interest at lateFeePercent a month (by the day, 30-day month) on
         * what was still unpaid, from the due date plus the grace days until it was paid (or today).
         */
        BigDecimal lateAccrued(Long memberId, int monthNo) {
            BigDecimal rate = Money.nz(c.getLateFeePercent());
            if (rate.signum() <= 0) return Money.ZERO;
            LocalDate start = dueDate(c, monthNo).plusDays(c.getLateGraceDays() == null ? 0 : c.getLateGraceDays());
            if (!today.isAfter(start)) return Money.ZERO;
            BigDecimal outstanding = due(memberId, monthNo);
            BigDecimal dayRate = rate.divide(BigDecimal.valueOf(3000), 10, java.math.RoundingMode.HALF_UP);
            BigDecimal interest = BigDecimal.ZERO;
            LocalDate from = start;
            for (HostedChitPayment p : paymentList) {
                if (!p.getMemberId().equals(memberId) || p.getMonthNo() != monthNo || Money.nz(p.getAmount()).signum() <= 0) continue;
                if (p.getPaidDate().isAfter(from) && outstanding.signum() > 0) {
                    long days = java.time.temporal.ChronoUnit.DAYS.between(from, p.getPaidDate());
                    interest = interest.add(outstanding.multiply(dayRate).multiply(BigDecimal.valueOf(days)));
                    from = p.getPaidDate();
                }
                outstanding = outstanding.subtract(p.getAmount());
            }
            if (outstanding.signum() > 0 && today.isAfter(from)) {
                interest = interest.add(outstanding.multiply(dayRate).multiply(BigDecimal.valueOf(java.time.temporal.ChronoUnit.DAYS.between(from, today))));
            }
            return interest.setScale(0, java.math.RoundingMode.HALF_UP).setScale(2);
        }

        /** Late interest already collected or let off for a member's month. */
        BigDecimal lateSettled(Long memberId, int monthNo, Long ignorePaymentId) {
            return paymentList.stream().filter(p -> p.getMemberId().equals(memberId) && p.getMonthNo() == monthNo && !p.getId().equals(ignorePaymentId))
                    .map(p -> Money.nz(p.getLateFee()).add(Money.nz(p.getLateFeeWaived()))).reduce(Money.ZERO, BigDecimal::add);
        }

        BigDecimal lateDue(Long memberId, int monthNo) {
            return lateAccrued(memberId, monthNo).subtract(lateSettled(memberId, monthNo, null)).max(Money.ZERO);
        }

        int daysLate(Long memberId, int monthNo) {
            LocalDate start = dueDate(c, monthNo).plusDays(c.getLateGraceDays() == null ? 0 : c.getLateGraceDays());
            if (!today.isAfter(start) || paid(memberId, monthNo).compareTo(due(memberId, monthNo)) >= 0) return 0;
            return (int) java.time.temporal.ChronoUnit.DAYS.between(dueDate(c, monthNo), today);
        }

        BigDecimal expected(int monthNo) {
            return memberList.stream().map(m -> due(m.getId(), monthNo)).reduce(Money.ZERO, BigDecimal::add);
        }

        HostedChitMonth month(int monthNo) {
            return monthList.stream().filter(m -> m.getMonthNo() == monthNo).findFirst()
                    .orElseThrow(() -> new BusinessException("Month must be between 1 and " + c.getMonths()));
        }

        BigDecimal chitValue(int monthNo) {
            if (planned(c)) return installmentOf(monthNo).multiply(BigDecimal.valueOf(c.getMemberCount()));
            return auction(c) ? c.getBaseValue() : c.getBaseValue().add(c.getMonthlyIncrement().multiply(BigDecimal.valueOf(monthNo - 1L)));
        }

        /** Auction chits: each member's share of the month's bid, less the commission (whole rupees). */
        BigDecimal dividend(int monthNo) {
            if (!auction(c)) return Money.ZERO;
            BigDecimal bid = monthList.stream().filter(m -> m.getMonthNo() == monthNo).findFirst().map(HostedChitMonth::getBidAmount).orElse(null);
            if (bid == null || bid.compareTo(c.getCommission()) <= 0) return Money.ZERO;
            return Money.round(bid.subtract(c.getCommission()).divide(BigDecimal.valueOf(memberList.size()), 0, java.math.RoundingMode.DOWN));
        }

        /** Installments of this month are due: it is the current month (or earlier), or its due date has come. */
        boolean due(int monthNo) {
            return monthNo <= currentMonth || !dueDate(c, monthNo).isAfter(today);
        }

        BigDecimal collected(int monthNo) {
            return memberList.stream().map(m -> paid(m.getId(), monthNo)).reduce(Money.ZERO, BigDecimal::add);
        }

        BigDecimal dues(Long memberId) {
            BigDecimal total = Money.ZERO;
            for (int no = 1; no <= c.getMonths(); no++) {
                if (!due(no)) continue;
                BigDecimal rest = due(memberId, no).subtract(paid(memberId, no));
                if (rest.signum() > 0) total = total.add(rest);
            }
            return total;
        }

        ChitView view() {
            int shown = Math.min(currentMonth, c.getMonths());
            BigDecimal totalCollected = paymentList.stream().map(HostedChitPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal paidOut = monthList.stream().map(m -> Money.nz(m.getPayoutAmount())).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal commission = monthList.stream().map(m -> Money.nz(m.getCommissionAmount())).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal pending = Money.ZERO;
            int pendingCount = 0;
            for (HostedChitMember m : memberList) {
                for (int no = 1; no <= c.getMonths(); no++) {
                    if (!due(no)) continue;
                    BigDecimal rest = due(m.getId(), no).subtract(paid(m.getId(), no));
                    if (rest.signum() > 0) {
                        pending = pending.add(rest);
                        pendingCount++;
                    }
                }
            }
            LocalDate next = null;
            if (currentMonth <= c.getMonths()) {
                next = dueDate(c, currentMonth);
                for (int no = currentMonth; no <= c.getMonths(); no++) {
                    if (!dueDate(c, no).isBefore(today)) {
                        next = dueDate(c, no);
                        break;
                    }
                }
            }
            String accountName = c.getAccountId() == null ? null
                    : accounts.findById(c.getAccountId()).map(Account::getName).orElse(null);
            String commissionAccountName = c.getCommissionAccountId() == null ? null
                    : accounts.findById(c.getCommissionAccountId()).map(Account::getName).orElse(null);
            Category category = c.getCommissionCategoryId() == null ? null
                    : categoryRepository.findById(c.getCommissionCategoryId()).orElse(null);
            boolean locked = !paymentList.isEmpty() || !won.isEmpty();
            BigDecimal lateCollected = paymentList.stream().map(p -> Money.nz(p.getLateFee())).reduce(Money.ZERO, BigDecimal::add);
            BigDecimal lateOpen = Money.ZERO;
            if (Money.isPositive(c.getLateFeePercent())) {
                for (HostedChitMember m : memberList) {
                    for (int no = 1; no <= c.getMonths(); no++) {
                        if (due(no)) lateOpen = lateOpen.add(lateDue(m.getId(), no));
                    }
                }
            }
            return new ChitView(c.getId(), c.getName(), typeOf(c), c.getStartMonth(), c.getDueDay(), c.getMemberCount(), c.getMonths(),
                    planned(c) ? installmentOf(shown) : c.getInstallment(), c.getBaseValue(), c.getMonthlyIncrement(),
                    planned(c) ? plannedCommission(shown) : c.getCommission(),
                    extraType(c), Money.nz(c.getWinnerExtraValue()), winnerExtra(c),
                    auction(c) ? c.getMaxBidPercent() : null, auction(c) ? c.getCommission() : null, auction(c) ? maxBid(c) : null,
                    c.getLateFeePercent(), c.getLateGraceDays() == null ? 0 : c.getLateGraceDays(), c.getUpiId(), c.getPayeeName(),
                    c.getReceiptSignature(), c.getReceiptSigner(),
                    lateCollected, lateOpen,
                    Boolean.TRUE.equals(c.getPostToBooks()), c.getAccountId(), accountName, c.getCommissionAccountId(),
                    commissionAccountName, c.getCommissionCategoryId(), category == null ? null : category.getName(),
                    c.getLateFeeAccountId(), c.getLateFeeAccountId() == null ? null : accounts.findById(c.getLateFeeAccountId()).map(Account::getName).orElse(null),
                    c.getStatus(),
                    Boolean.TRUE.equals(c.getDemo()), c.getNotes(), shown, completedMonths, chitValue(shown),
                    collected(shown), expected(shown),
                    (int) memberList.stream().filter(m -> paid(m.getId(), shown).compareTo(due(m.getId(), shown)) >= 0).count(),
                    totalCollected, paidOut, commission, pending, pendingCount,
                    totalCollected.subtract(paidOut).subtract(commission), next, locked,
                    c.getCreatedBy(), c.getCreatedAt(), c.getVersion(), Money.nz(c.getInstallmentIncrement()),
                    !today.isBefore(c.getStartMonth()) || locked, c.getPayToAccountId(),
                    c.getPayToAccountId() == null ? null : accounts.findById(c.getPayToAccountId()).map(Account::getName).orElse(null),
                    shortCodeOf(c), closed(c), c.getClosedAt(), c.getClosedBy(), c.getCloseNote(), c.getCommissionBankAccountId(),
                    c.getCommissionBankAccountId() == null ? null : accounts.findById(c.getCommissionBankAccountId()).map(Account::getName).orElse(null));
        }

        Detail detail() {
            Map<Long, String> names = memberList.stream().collect(Collectors.toMap(HostedChitMember::getId, HostedChitMember::getName));
            Set<Long> entryIds = new HashSet<>();
            paymentList.forEach(p -> { if (p.getJournalEntryId() != null) entryIds.add(p.getJournalEntryId()); });
            monthList.forEach(m -> {
                if (m.getPayoutEntryId() != null) entryIds.add(m.getPayoutEntryId());
                if (m.getCommissionEntryId() != null) entryIds.add(m.getCommissionEntryId());
            });
            Map<Long, String> entryNos = new HashMap<>();   // looked up with null ids too, so not Map.of()
            entries.findAllById(entryIds).forEach(e -> entryNos.put(e.getId(), e.getEntryNo()));

            List<MemberView> memberViews = memberList.stream().map(m -> new MemberView(m.getId(), m.getSlot(), m.getName(), m.getPhone(), m.getEmail(),
                    m.getPayoutAccount(), m.getPayToAccountId(), m.getUpiId(), m.getPayToMemberId(),
                    m.getPayToMemberId() == null ? null : names.get(m.getPayToMemberId()),
                    payToName(m.getPayToAccountId()), payToSummary(m.getPayToAccountId()), wonMonth(m.getId()),
                    paid.getOrDefault(m.getId(), Map.of()).values().stream().reduce(Money.ZERO, BigDecimal::add),
                    dues(m.getId()), lateDueOf(m.getId()), m.getVersion())).toList();

            Map<Long, List<LegView>> legsByMonth = book.legsByMonth(c.getId());
            List<TransferView> moves = book.transfersOf(c.getId());
            // each payment's way on: the transfer that moved it, and the payout that paid it out
            Map<Long, TransferView> movedBy = new HashMap<>();
            moves.forEach(t -> t.from().forEach(l -> l.paymentIds().forEach(id -> movedBy.put(id, t))));
            Map<Long, Integer> paidOutIn = new HashMap<>();
            monthList.forEach(m -> legsByMonth.getOrDefault(m.getId(), List.of()).forEach(l -> l.paymentIds().forEach(id -> paidOutIn.put(id, m.getMonthNo()))));
            Map<Long, String> accountNames = new HashMap<>();
            accounts.findByTenantId(c.getTenantId()).forEach(a -> accountNames.put(a.getId(), a.getName()));
            List<MonthView> schedule = monthList.stream().map(m -> {
                int no = m.getMonthNo();
                BigDecimal value = chitValue(no);
                boolean done = m.getPayoutDate() != null;
                BigDecimal commission = done ? Money.nz(m.getCommissionAmount()) : planned(c) ? plannedCommission(no) : c.getCommission();
                boolean bidKnown = m.getBidAmount() != null;
                BigDecimal payout = done ? Money.nz(m.getPayoutAmount()) : planned(c) ? Money.nz(m.getPlannedPayout())
                        : auction(c) ? value.subtract(bidKnown ? m.getBidAmount() : c.getCommission()) : value.subtract(c.getCommission());
                boolean estimated = auction(c) && !done && !bidKnown;
                int paidCount = (int) memberList.stream().filter(x -> paid(x.getId(), no).compareTo(due(x.getId(), no)) >= 0).count();
                String status = done ? "COMPLETED" : no == currentMonth ? "ONGOING" : "UPCOMING";
                return new MonthView(m.getId(), no, dueDate(c, no), planned(c) ? installmentOf(no) : c.getInstallment(), value, payout, estimated,
                        m.getBidAmount(), dividend(no), commission,
                        m.getWinnerMemberId(), names.get(m.getWinnerMemberId()), m.getDrawMethod(), status, due(no),
                        collected(no), expected(no), paidCount, m.getPayoutDate(), m.getPayoutMode(), m.getPayoutReference(),
                        entryNos.get(m.getPayoutEntryId()), m.getPayoutEntryId(), m.getPayoutTo(),
                        legsByMonth.getOrDefault(m.getId(), List.of()), m.getVersion(), m.getCommissionFromAccountId(),
                        Boolean.TRUE.equals(m.getCommissionRetained()), commissionPending(m), m.getCommissionBankTransferId());
            }).toList();

            Map<Long, Integer> files = entryIds.isEmpty() ? Map.of() : attachments.countsByEntry(c.getTenantId());
            Map<Long, ChitTrailService.Trail> paymentTrails = trails.forEntryIds(paymentList.stream().map(HostedChitPayment::getJournalEntryId).toList());
            List<PaymentView> paymentViews = paymentList.stream().map(p -> new PaymentView(p.getId(), p.getMemberId(),
                    names.get(p.getMemberId()), p.getMonthNo(), p.getAmount(), p.getLateFee(), p.getLateFeeWaived(), p.getReference(),
                    p.getReceiptNo(), p.getPaidDate(), p.getMode(), p.getNote(), entryNos.get(p.getJournalEntryId()), p.getJournalEntryId(),
                    p.getJournalEntryId() == null ? 0 : files.getOrDefault(p.getJournalEntryId(), 0), p.getCreatedBy(), p.getCreatedAt(),
                    p.getVersion(), accountOf(p), accountNames.get(accountOf(p)), p.getPaidToMemberId(), names.get(p.getPaidToMemberId()),
                    p.getBatchId(), movedBy.containsKey(p.getId()) ? "to " + movedBy.get(p.getId()).toAccountName()
                        + (movedBy.get(p.getId()).entryNo() != null ? " · " + movedBy.get(p.getId()).entryNo() : "") : null,
                    movedBy.containsKey(p.getId()) ? movedBy.get(p.getId()).id() : null, paidOutIn.get(p.getId()),
                    lockReason(p) != null, lockReason(p), movementOf(p, movedBy.get(p.getId())),
                    movedBy.containsKey(p.getId()) ? movedBy.get(p.getId()).payoutMonthNo() : null,
                    p.getJournalEntryId() == null ? null : paymentTrails.get(p.getJournalEntryId()))).toList();
            List<LateFeeView> lateFees = new ArrayList<>();
            if (Money.isPositive(c.getLateFeePercent())) {
                for (HostedChitMember m : memberList) {
                    for (int no = 1; no <= c.getMonths(); no++) {
                        BigDecimal accrued = lateAccrued(m.getId(), no);
                        if (accrued.signum() <= 0) continue;
                        BigDecimal settled = lateSettled(m.getId(), no, null);
                        lateFees.add(new LateFeeView(m.getId(), no, daysLate(m.getId(), no), accrued, settled, accrued.subtract(settled).max(Money.ZERO)));
                    }
                }
            }
            List<AgreementView> agreementViews = agreements.findByChitId(c.getId()).stream()
                    .sorted(Comparator.comparing(HostedChitAgreement::getMonthNo)).map(a -> agreementView(a, names)).toList();

            // the ledger: every collection, payout and commission by date, with what is held after each
            record Line(LocalDate date, int order, String kind, int monthNo, String party, String mode, BigDecimal in, BigDecimal out,
                        String entryNo, String note, Long paymentId, String account) {
            }
            List<Line> lines = new ArrayList<>();
            paymentList.forEach(p -> {
                String into = accountNames.get(accountOf(p));
                if (Money.isPositive(p.getAmount())) {
                    String direct = p.getPaidToMemberId() == null ? null : p.getPaidToMemberId().equals(p.getMemberId())
                            ? "Set off against the payout" : "Paid " + names.get(p.getPaidToMemberId()) + " directly";
                    lines.add(new Line(p.getPaidDate(), 0, "COLLECTION", p.getMonthNo(), names.get(p.getMemberId()), p.getMode(), p.getAmount(),
                            Money.ZERO, entryNos.get(p.getJournalEntryId()), direct != null ? direct
                            : p.getReference() != null ? p.getReference() : p.getNote(), p.getId(), into));
                }
                if (Money.isPositive(p.getLateFee())) {
                    // late interest is the organiser's: shown, but not part of the members' money held
                    lines.add(new Line(p.getPaidDate(), 0, "LATE_FEE", p.getMonthNo(), names.get(p.getMemberId()), p.getMode(), Money.ZERO,
                            Money.ZERO, entryNos.get(p.getJournalEntryId()), "Late payment interest " + ActivityService.money(p.getLateFee()), p.getId(), into));
                }
            });
            monthList.stream().filter(m -> m.getPayoutDate() != null).forEach(m -> {
                List<LegView> parts = legsByMonth.getOrDefault(m.getId(), List.of());
                String from = parts.isEmpty() ? accountNames.get(c.getAccountId())
                        : parts.stream().map(LegView::accountName).collect(Collectors.joining(" + "));
                lines.add(new Line(m.getPayoutDate(), 1, "PAYOUT", m.getMonthNo(), names.get(m.getWinnerMemberId()), m.getPayoutMode(),
                        Money.ZERO, Money.nz(m.getPayoutAmount()), entryNos.get(m.getPayoutEntryId()), m.getDrawMethod(), null, from));
                if (Money.isPositive(m.getCommissionAmount())) {
                    lines.add(new Line(m.getPayoutDate(), 2, "COMMISSION", m.getMonthNo(), "Organiser commission", null,
                            Money.ZERO, m.getCommissionAmount(), entryNos.get(m.getCommissionEntryId()), null, null,
                            accountNames.get(c.getCommissionAccountId() != null ? c.getCommissionAccountId() : c.getAccountId())));
                }
            });
            lines.sort(Comparator.comparing(Line::date).thenComparing(Line::order).thenComparing(Line::monthNo));
            List<LedgerRow> ledgerRows = new ArrayList<>();
            BigDecimal held = Money.ZERO;
            for (Line l : lines) {
                held = held.add(l.in()).subtract(l.out());
                ledgerRows.add(new LedgerRow(l.date(), l.kind(), l.monthNo(), l.party(), l.mode(), l.in(), l.out(), held, l.entryNo(),
                        l.note(), l.paymentId(), l.account()));
            }
            return new Detail(view(), memberViews, schedule, paymentViews, ledgerRows, lateFees, agreementViews,
                    book.money(c), moves);
        }

        /** Where a payment's money stands for the payout (see PaymentView#movement). */
        String movementOf(HostedChitPayment p, TransferView moved) {
            if (p.getPaidToMemberId() != null) return "DIRECT";
            if (moved != null) return "MOVED";
            if (c.getAccountId() == null || accountOf(p).equals(c.getAccountId())) return "IN_COLLECTIONS";
            return "TO_MOVE";
        }

        /** Where a payment came into (older payments: the chit's collections account). */
        Long accountOf(HostedChitPayment p) {
            return p.getAccountId() != null ? p.getAccountId() : c.getAccountId();
        }

        BigDecimal lateDueOf(Long memberId) {
            if (!Money.isPositive(c.getLateFeePercent())) return Money.ZERO;
            BigDecimal total = Money.ZERO;
            for (int no = 1; no <= c.getMonths(); no++) {
                if (due(no)) total = total.add(lateDue(memberId, no));
            }
            return total;
        }
    }
}
