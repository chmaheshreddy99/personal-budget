package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.ConstructionAgreement;
import com.aditya.personalbudget.domain.entity.ConstructionCapital;
import com.aditya.personalbudget.domain.entity.ConstructionCost;
import com.aditya.personalbudget.domain.entity.ConstructionExtra;
import com.aditya.personalbudget.domain.entity.ConstructionInstalment;
import com.aditya.personalbudget.domain.entity.ConstructionLoan;
import com.aditya.personalbudget.domain.entity.ConstructionLoanTxn;
import com.aditya.personalbudget.domain.entity.ConstructionParty;
import com.aditya.personalbudget.domain.entity.ConstructionPartner;
import com.aditya.personalbudget.domain.entity.ConstructionProject;
import com.aditya.personalbudget.domain.entity.ConstructionReceipt;
import com.aditya.personalbudget.domain.entity.ConstructionSale;
import com.aditya.personalbudget.domain.entity.ConstructionStage;
import com.aditya.personalbudget.domain.entity.ConstructionUnit;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.ConstructionAgreementRepository;
import com.aditya.personalbudget.repository.ConstructionCapitalRepository;
import com.aditya.personalbudget.repository.ConstructionCostRepository;
import com.aditya.personalbudget.repository.ConstructionExtraRepository;
import com.aditya.personalbudget.repository.ConstructionInstalmentRepository;
import com.aditya.personalbudget.repository.ConstructionLoanRepository;
import com.aditya.personalbudget.repository.ConstructionLoanTxnRepository;
import com.aditya.personalbudget.repository.ConstructionPartyRepository;
import com.aditya.personalbudget.repository.ConstructionPartnerRepository;
import com.aditya.personalbudget.repository.ConstructionProjectRepository;
import com.aditya.personalbudget.repository.ConstructionReceiptRepository;
import com.aditya.personalbudget.repository.ConstructionSaleRepository;
import com.aditya.personalbudget.repository.ConstructionStageRepository;
import com.aditya.personalbudget.repository.ConstructionUnitRepository;
import com.aditya.personalbudget.repository.JournalLineRepository;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The construction business (the Construction section): its projects, each with a book of accounts of its own.
 * <p>
 * <b>Kinds.</b> A <i>contract work</i> is built for the owner of a site: the price is set stage by stage (each with
 * when it is paid for), extra works the owner asks for are agreed separately (a price and the days they add), and the
 * owner pays interest on late payments. A <i>development</i> is the builder's own apartment project, on a plot it buys
 * (own plot) or on land given by its owners for a share of the flats (joint development); its flats are sold to buyers
 * on payment plans (see {@link ConstructionSalesService}).
 * <p>
 * <b>Books.</b> Each project has its accounts in the construction book (off the personal accounts): a bank account
 * (or a common business account), the construction cost and the land (assets until the project closes: work in
 * progress), the advances received from the owner or buyers and the late interest received (owed until the project
 * closes), a loan account per loan and a capital account per partner (another partner's money is owed to them).
 * Closing the project settles the advances against the costs and shares the profit by the partners' shares: the
 * user's share is income, another partner's is credited to their capital account.
 */
@Service
public class ConstructionService {

    public static final String CONTRACT = "CONTRACT";
    public static final String DEVELOPMENT = "DEVELOPMENT";
    public static final String OWN_PLOT = "OWN_PLOT";
    public static final String JOINT = "JOINT";
    public static final String PLANNING = "PLANNING";
    public static final String ACTIVE = "ACTIVE";
    public static final String COMPLETED = "COMPLETED";
    public static final String CLOSED = "CLOSED";
    static final String AREA = "Construction";
    static final String SOURCE_CLOSE = "CONSTRUCTION_CLOSE";
    static final Set<String> AREA_UNITS = Set.of("SQ_YD", "SQ_FT", "SQ_M", "ACRE", "GUNTA");
    static final LocalDate FOREVER = LocalDate.of(9999, 12, 31);

    // ================================================================== requests

    public record ProjectRequest(@NotBlank @Size(max = 12) String kind, @Size(max = 12) String landMode,
                                 @NotBlank @Size(max = 100) String name, @Size(max = 6) String code,
                                 @Size(max = 200) String siteAddress, @Size(max = 60) String city, @Size(max = 60) String surveyNo,
                                 @Size(max = 40) String plotNo, @PositiveOrZero BigDecimal plotArea, @Size(max = 8) String areaUnit,
                                 @Size(max = 300) String boundaries, @PositiveOrZero BigDecimal builtUpArea, @Min(0) @Max(200) Integer floors,
                                 @Size(max = 60) String permitNo, @Size(max = 60) String reraNo, LocalDate startDate, LocalDate plannedEndDate,
                                 @Size(max = 100) String clientName, @Size(max = 20) String clientPhone, @Size(max = 200) String clientAddress,
                                 @Size(max = 100) String clientEmail, @Size(max = 100) String clientRelation,
                                 @PositiveOrZero @DecimalMax("10") BigDecimal lateInterestPercent, @Min(0) @Max(365) Integer lateGraceDays,
                                 @Min(0) @Max(120) Integer defectLiabilityMonths, @PositiveOrZero BigDecimal estimatedCost,
                                 @PositiveOrZero BigDecimal plotPrice, @PositiveOrZero @DecimalMax("100") BigDecimal landownerSharePercent,
                                 @PositiveOrZero BigDecimal refundableDeposit, @Min(0) @Max(5000) Integer flatsPlanned,
                                 @PositiveOrZero BigDecimal saleRate, @Size(max = 100) String companyName, @Size(max = 200) String companyAddress,
                                 @Size(max = 100) String signerName, @Size(max = 60) String signerDesignation, @Size(max = 1000) String notes) {
    }

    public record StageInput(Long id, @NotBlank @Size(max = 100) String name, @Size(max = 500) String description,
                             @PositiveOrZero BigDecimal amount, LocalDate plannedStart, LocalDate plannedEnd, LocalDate dueDate) {
    }

    public record PartnerInput(@NotBlank @Size(max = 100) String name, @Size(max = 20) String phone, @Size(max = 200) String address,
                               @NotNull @PositiveOrZero @DecimalMax("100") BigDecimal sharePercent, Boolean me) {
    }

    public record PartyInput(@NotBlank @Size(max = 10) String role, @NotBlank @Size(max = 100) String name, @Size(max = 100) String relation,
                             @Size(max = 20) String phone, @Size(max = 200) String address, @PositiveOrZero BigDecimal sharePercent,
                             @PositiveOrZero BigDecimal consideration) {
    }

    /**
     * Flats made in one go: blocks (comma separated, or one), floors from–to, units on each floor; the first
     * {@code landownerUnits} (by number) are allotted to the landowners.
     */
    public record UnitPlan(@Size(max = 60) String blocks, @Min(0) @Max(200) Integer floorFrom, @Min(0) @Max(200) Integer floorTo,
                           @Min(1) @Max(50) Integer perFloor, @Size(max = 20) String unitType, @PositiveOrZero BigDecimal carpetArea,
                           @PositiveOrZero BigDecimal builtUpArea, @PositiveOrZero BigDecimal superArea, @PositiveOrZero BigDecimal rate,
                           @Min(0) @Max(5000) Integer landownerUnits) {
    }

    /** bankMode NEW: the project gets a bank account of its own (bankName, institution, number); EXISTING: bankAccountId. */
    public record CreateRequest(@Valid @NotNull ProjectRequest project, List<@Valid StageInput> stages, List<@Valid PartnerInput> partners,
                                List<@Valid PartyInput> parties, @Valid UnitPlan units, @Size(max = 10) String bankMode, Long bankAccountId,
                                @Size(max = 100) String bankName, @Size(max = 100) String bankInstitution, @Size(max = 40) String bankNumber) {
    }

    public record StageProgress(@NotBlank String status, LocalDate completedOn) {
    }

    public record ExtraRequest(@NotBlank @Size(max = 120) String title, @Size(max = 1000) String description,
                               @NotNull @PositiveOrZero BigDecimal amount, @Min(0) @Max(3650) Integer extraDays, LocalDate requestedOn,
                               LocalDate dueDate) {
    }

    public record ExtraStatus(@NotBlank String status, LocalDate completedOn) {
    }

    public record StatusRequest(@NotBlank String status, LocalDate completedOn) {
    }

    public record SignatureRequest(@Size(max = 20000) String signature) {
    }

    // ================================================================== views

    /** The money of a project at a glance (contract works and developments). */
    public record Figures(BigDecimal contractValue, BigDecimal extrasValue, BigDecimal totalValue, BigDecimal received,
                          BigDecimal interestReceived, BigDecimal due, BigDecimal overdue, BigDecimal upcoming, BigDecimal interestDue,
                          BigDecimal costs, BigDecimal land, BigDecimal totalCost, BigDecimal estimatedCost, BigDecimal profit,
                          BigDecimal expectedProfit, int stagesDone, int stagesTotal, int progressPercent, LocalDate revisedEndDate,
                          int extraDays, Long daysLeft, int unitsTotal, int unitsAvailable, int unitsBooked, int unitsSold,
                          int unitsLandowner, BigDecimal salesValue, BigDecimal unsoldValue, BigDecimal loanSanctioned,
                          BigDecimal loanOutstanding, BigDecimal capitalIn, BigDecimal moneyBalance) {
    }

    public record HeadTotal(String head, BigDecimal amount, int count) {
    }

    public record PartnerView(ConstructionPartner partner, BigDecimal invested, BigDecimal withdrawn, BigDecimal profit,
                              BigDecimal balance, BigDecimal capitalSharePercent) {
    }

    public record LoanView(ConstructionLoan loan, BigDecimal disbursed, BigDecimal repaid, BigDecimal interestPaid,
                           BigDecimal charges, BigDecimal outstanding) {
    }

    public record SaleView(ConstructionSale sale, String unitLabel, List<ConstructionInstalment> plan, List<ConstructionDues.Row> dues,
                           BigDecimal received, BigDecimal interestReceived, BigDecimal bankReceived, BigDecimal balance,
                           BigDecimal due, BigDecimal overdue, BigDecimal interestDue) {
    }

    /** An agreement in the project's list (the full view is opened from it). */
    /**
     * about: what the agreement covers (the contract price and stages, the extra work, the flat, the plot share...) and
     * value its money; link: NONE, ACTIVE, EXPIRED, REVOKED or LOCKED (the online link); fingerprint: the start of the
     * SHA-256 of its text.
     */
    public record AgreementSummary(Long id, String kind, Long refId, String agreementNo, String title, String partyName, String status,
                                   LocalDate agreementDate, LocalDateTime acceptedAt, LocalDateTime createdAt,
                                   String partyPhone, String partyRelation, String place, String about, BigDecimal value,
                                   BigDecimal stampDuty, String stampSerial, String witnessName, boolean witnessSigned,
                                   boolean companySigned, String link, LocalDateTime linkExpiresAt, int views, LocalDateTime lastViewedAt,
                                   String acceptedName, boolean located, boolean aadhaar, boolean selfie, String fingerprint,
                                   String createdBy) {
    }

    public record AccountLine(Long id, String name, String role, AccountType type, BigDecimal balance, boolean own) {
    }

    public record Detail(ConstructionProject project, Figures figures, List<ConstructionStage> stages, List<ConstructionExtra> extras,
                         List<ConstructionDues.Row> schedule, List<ConstructionReceipt> receipts, List<ConstructionCost> costs,
                         List<HeadTotal> costHeads, List<PartnerView> partners, List<ConstructionCapital> capital,
                         List<LoanView> loans, List<ConstructionLoanTxn> loanTxns, List<ConstructionParty> parties,
                         List<ConstructionUnit> units, List<SaleView> sales, List<AgreementSummary> agreements,
                         List<AccountLine> accounts, Map<Long, String> accountNames) {
    }

    public record Summary(Long id, String kind, String landMode, String name, String code, String status, String city,
                          String clientName, LocalDate startDate, LocalDate revisedEndDate, Figures figures) {
    }

    /** The section's front page: every project, and the business's common accounts. */
    public record Overview(List<Summary> projects, List<AccountLine> commonAccounts, BigDecimal received, BigDecimal costs,
                           BigDecimal due, BigDecimal overdue, BigDecimal loanOutstanding, BigDecimal moneyBalance) {
    }

    // ================================================================== wiring

    final ConstructionProjectRepository projects;
    final ConstructionStageRepository stages;
    final ConstructionExtraRepository extras;
    final ConstructionReceiptRepository receipts;
    final ConstructionCostRepository costs;
    final ConstructionPartnerRepository partners;
    final ConstructionCapitalRepository capital;
    final ConstructionLoanRepository loans;
    final ConstructionLoanTxnRepository loanTxns;
    final ConstructionPartyRepository parties;
    final ConstructionUnitRepository units;
    final ConstructionSaleRepository sales;
    final ConstructionInstalmentRepository instalments;
    final ConstructionAgreementRepository agreements;
    final AccountRepository accounts;
    final AccountService accountService;
    final JournalLineRepository lines;
    final LedgerService ledger;
    final ActivityService activity;

    public ConstructionService(ConstructionProjectRepository projects, ConstructionStageRepository stages, ConstructionExtraRepository extras,
                               ConstructionReceiptRepository receipts, ConstructionCostRepository costs, ConstructionPartnerRepository partners,
                               ConstructionCapitalRepository capital, ConstructionLoanRepository loans, ConstructionLoanTxnRepository loanTxns,
                               ConstructionPartyRepository parties, ConstructionUnitRepository units, ConstructionSaleRepository sales,
                               ConstructionInstalmentRepository instalments, ConstructionAgreementRepository agreements,
                               AccountRepository accounts, AccountService accountService, JournalLineRepository lines,
                               LedgerService ledger, ActivityService activity) {
        this.projects = projects;
        this.stages = stages;
        this.extras = extras;
        this.receipts = receipts;
        this.costs = costs;
        this.partners = partners;
        this.capital = capital;
        this.loans = loans;
        this.loanTxns = loanTxns;
        this.parties = parties;
        this.units = units;
        this.sales = sales;
        this.instalments = instalments;
        this.agreements = agreements;
        this.accounts = accounts;
        this.accountService = accountService;
        this.lines = lines;
        this.ledger = ledger;
        this.activity = activity;
    }


    // the other construction services reach the repositories through these (a field of a transactional proxy is empty)
    public ConstructionProjectRepository projects() {
        return projects;
    }

    public ConstructionStageRepository stages() {
        return stages;
    }

    public ConstructionExtraRepository extras() {
        return extras;
    }

    public ConstructionReceiptRepository receipts() {
        return receipts;
    }

    public ConstructionCostRepository costs() {
        return costs;
    }

    public ConstructionPartnerRepository partners() {
        return partners;
    }

    public ConstructionCapitalRepository capital() {
        return capital;
    }

    public ConstructionLoanRepository loans() {
        return loans;
    }

    public ConstructionLoanTxnRepository loanTxns() {
        return loanTxns;
    }

    public ConstructionPartyRepository parties() {
        return parties;
    }

    public ConstructionUnitRepository units() {
        return units;
    }

    public ConstructionSaleRepository sales() {
        return sales;
    }

    public ConstructionInstalmentRepository instalments() {
        return instalments;
    }

    public ConstructionAgreementRepository agreements() {
        return agreements;
    }

    public AccountRepository accounts() {
        return accounts;
    }

    public AccountService accountService() {
        return accountService;
    }

    public JournalLineRepository lines() {
        return lines;
    }

    public LedgerService ledger() {
        return ledger;
    }

    public ActivityService activity() {
        return activity;
    }

    // ================================================================== reading

    public Overview overview() {
        Long tenant = UserContext.tenantId();
        Map<Long, BigDecimal> balances = balances();
        List<Summary> list = projects.findByTenantId(tenant).stream()
                .sorted(Comparator.comparing((ConstructionProject p) -> CLOSED.equals(p.getStatus())).thenComparing(ConstructionProject::getId, Comparator.reverseOrder()))
                .map(p -> {
                    Figures f = figures(p, balances);
                    return new Summary(p.getId(), p.getKind(), p.getLandMode(), p.getName(), code(p), p.getStatus(), p.getCity(),
                            p.getClientName(), p.getStartDate(), f.revisedEndDate(), f);
                }).toList();
        List<AccountLine> common = accounts.findByTenantId(tenant).stream()
                .filter(a -> a.isProjectBook() && a.getProjectId() == null && Boolean.TRUE.equals(a.getActive()))
                .map(a -> line(a, balances, false)).toList();
        BigDecimal received = sum(list, f -> f.received().add(f.interestReceived()));
        BigDecimal spent = sum(list, Figures::totalCost);
        BigDecimal due = sum(list, Figures::due);
        BigDecimal overdue = sum(list, Figures::overdue);
        BigDecimal loanOut = sum(list, Figures::loanOutstanding);
        BigDecimal money = list.stream().map(s -> s.figures().moneyBalance()).reduce(Money.ZERO, BigDecimal::add)
                .add(common.stream().map(AccountLine::balance).reduce(Money.ZERO, BigDecimal::add));
        return new Overview(list, common, received, spent, due, overdue, loanOut, money);
    }

    public Detail detail(Long id) {
        ConstructionProject p = require(id);
        Map<Long, BigDecimal> balances = balances();
        Figures f = figures(p, balances);
        List<ConstructionStage> st = stagesOf(p.getId());
        List<ConstructionExtra> ex = extras.findByProjectId(p.getId()).stream().sorted(Comparator.comparing(ConstructionExtra::getSeq)).toList();
        List<ConstructionReceipt> rc = receipts.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionReceipt::getReceivedOn).thenComparing(ConstructionReceipt::getId).reversed()).toList();
        List<ConstructionCost> cs = costs.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionCost::getSpentOn).thenComparing(ConstructionCost::getId).reversed()).toList();
        Map<String, List<ConstructionCost>> byHead = cs.stream().collect(Collectors.groupingBy(ConstructionCost::getHead, LinkedHashMap::new, Collectors.toList()));
        List<HeadTotal> heads = byHead.entrySet().stream()
                .map(e -> new HeadTotal(e.getKey(), e.getValue().stream().map(ConstructionCost::getAmount).reduce(Money.ZERO, BigDecimal::add), e.getValue().size()))
                .sorted(Comparator.comparing(HeadTotal::amount).reversed()).toList();
        List<ConstructionCapital> cap = capital.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionCapital::getMovedOn).thenComparing(ConstructionCapital::getId).reversed()).toList();
        List<ConstructionLoanTxn> lt = loanTxns.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionLoanTxn::getMovedOn).thenComparing(ConstructionLoanTxn::getId).reversed()).toList();
        List<ConstructionUnit> un = units.findByProjectId(p.getId()).stream().sorted(unitOrder()).toList();
        Map<Long, ConstructionUnit> unitById = un.stream().collect(Collectors.toMap(ConstructionUnit::getId, u -> u));
        List<SaleView> sv = sales.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionSale::getBookedOn).thenComparing(ConstructionSale::getId).reversed())
                .map(s -> saleView(p, s, unitById.get(s.getUnitId()), st, rc)).toList();
        List<ConstructionPartner> partnerRows = partners.findByProjectId(p.getId());
        List<ConstructionParty> partyRows = parties.findByProjectId(p.getId());
        List<AgreementSummary> ag = agreements.findByProjectId(p.getId()).stream()
                .sorted(Comparator.comparing(ConstructionAgreement::getId).reversed())
                .map(a -> agreementSummary(p, a, f, st, ex, sv, partyRows, partnerRows)).toList();
        List<Account> own = accounts.findByTenantId(p.getTenantId()).stream().filter(a -> p.getId().equals(a.getProjectId())).toList();
        List<AccountLine> acc = new ArrayList<>(own.stream().sorted(Comparator.comparing(Account::getId)).map(a -> line(a, balances, true)).toList());
        if (p.getBankAccountId() != null && own.stream().noneMatch(a -> a.getId().equals(p.getBankAccountId()))) {
            accounts.findById(p.getBankAccountId()).ifPresent(a -> acc.addFirst(line(a, balances, false)));
        }
        Map<Long, String> names = accounts.findByTenantId(p.getTenantId()).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        return new Detail(p, f, st, ex, CONTRACT.equals(p.getKind()) ? contractDues(p, st, ex, rc).rows() : List.of(), rc, cs, heads,
                partnerViews(p, cap), cap, loanViews(p, lt, balances), lt, parties.findByProjectId(p.getId()), un, sv, ag, acc, names);
    }

    private AgreementSummary agreementSummary(ConstructionProject p, ConstructionAgreement a, Figures f, List<ConstructionStage> st,
                                              List<ConstructionExtra> ex, List<SaleView> sv, List<ConstructionParty> ps, List<ConstructionPartner> partnerRows) {
        String about = null;
        BigDecimal value = null;
        Long ref = a.getRefId();
        switch (a.getKind()) {
            case "CONTRACT" -> {
                value = f.contractValue();
                long priced = st.stream().filter(s -> Money.nz(s.getAmount()).signum() > 0).count();
                about = priced + " stage" + (priced == 1 ? "" : "s") + (p.getPlannedEndDate() != null ? " · complete by " + p.getPlannedEndDate() : "");
            }
            default -> { }
        }
        if ("EXTRA".equals(a.getKind())) {
            ConstructionExtra x = ex.stream().filter(e -> e.getId().equals(ref)).findFirst().orElse(null);
            if (x != null) {
                value = x.getAmount();
                about = "EX-" + x.getSeq() + " " + x.getTitle() + (x.getExtraDays() != null && x.getExtraDays() > 0 ? " · +" + x.getExtraDays() + " days" : "");
            }
        } else if (Set.of("PLOT_PURCHASE", "JDA").contains(a.getKind())) {
            ConstructionParty x = ps.stream().filter(e -> e.getId().equals(ref)).findFirst().orElse(null);
            if (x != null) {
                value = x.getConsideration();
                about = (x.getSharePercent() != null ? x.getSharePercent().stripTrailingZeros().toPlainString() + "% " : "")
                        + ("JDA".equals(a.getKind()) ? "of the landowners' part" : "of the plot")
                        + ("JDA".equals(a.getKind()) && x.getConsideration() != null ? " · deposit" : "");
            }
        } else if (Set.of("FLAT_SALE", "TRIPARTITE", "SALE_DEED", "POSSESSION").contains(a.getKind())) {
            SaleView v = sv.stream().filter(e -> e.sale().getId().equals(ref)).findFirst().orElse(null);
            if (v != null) {
                value = "TRIPARTITE".equals(a.getKind()) && v.sale().getLoanAmount() != null ? v.sale().getLoanAmount() : v.sale().getTotalPrice();
                about = "Flat " + v.unitLabel() + ("TRIPARTITE".equals(a.getKind()) && v.sale().getLoanBank() != null ? " · loan from " + v.sale().getLoanBank() : "");
            }
        } else if ("PARTNERSHIP".equals(a.getKind())) {
            ConstructionPartner x = partnerRows.stream().filter(e -> e.getId().equals(ref)).findFirst().orElse(null);
            if (x != null) about = x.getSharePercent().stripTrailingZeros().toPlainString() + "% of the profit";
        }
        LocalDateTime now = LocalDateTime.now();
        String link = a.getTokenHash() == null ? "NONE" : a.getLinkRevokedAt() != null ? "REVOKED" : a.getLockedAt() != null ? "LOCKED"
                : a.getLinkExpiresAt() != null && a.getLinkExpiresAt().isBefore(now) ? "EXPIRED" : "ACTIVE";
        return new AgreementSummary(a.getId(), a.getKind(), a.getRefId(), a.getAgreementNo(), a.getTitle(), a.getPartyName(),
                a.getStatus(), a.getAgreementDate(), a.getAcceptedAt(), a.getCreatedAt(), a.getPartyPhone(), a.getPartyRelation(), a.getPlace(),
                about, value, a.getStampDuty(), a.getStampSerial(), a.getWitnessName(), blank(a.getWitnessSignature()) != null,
                blank(a.getCompanySignature()) != null || blank(p.getCompanySignature()) != null, link, a.getLinkExpiresAt(),
                a.getViews() == null ? 0 : a.getViews(), a.getLastViewedAt(), a.getAcceptedName(), blank(a.getAcceptedLocation()) != null,
                Boolean.TRUE.equals(a.getRequireAadhaar()), Boolean.TRUE.equals(a.getRequireSelfie()),
                a.getContentHash() == null ? null : a.getContentHash().substring(0, Math.min(12, a.getContentHash().length())), a.getCreatedBy());
    }

    // ================================================================== making a project

    @Transactional
    public Detail create(CreateRequest r) {
        ProjectRequest q = r.project();
        ConstructionProject p = new ConstructionProject();
        p.setTenantId(UserContext.tenantId());
        p.setStatus(ACTIVE);
        p.setCreatedBy(UserContext.username());
        p.setCreatedAt(LocalDateTime.now());
        apply(p, q, true);
        requireUniqueName(p);
        p = projects.save(p);

        // the project's own accounts
        p.setCostAccountId(newAccount(p, "construction cost", AccountType.OTHER_ASSET, "COST",
                "What " + p.getName() + " has cost so far (work in progress, until the project closes)").getId());
        if (DEVELOPMENT.equals(p.getKind())) {
            p.setLandAccountId(newAccount(p, "land", AccountType.OTHER_ASSET, "LAND", "The plot, its registration and the deposit to the landowners").getId());
        }
        p.setAdvancesAccountId(newAccount(p, CONTRACT.equals(p.getKind()) ? "received from the owner" : "received from buyers",
                AccountType.OTHER_LIABILITY, "ADVANCES", "Payments received for " + p.getName() + ", held until the project closes").getId());
        p.setInterestAccountId(newAccount(p, "late interest received", AccountType.OTHER_LIABILITY, "INTEREST",
                "Interest received on late payments for " + p.getName()).getId());
        if ("EXISTING".equals(r.bankMode())) {
            if (r.bankAccountId() == null) throw new BusinessException("Pick the account the project's money goes into");
            Account bank = requireMoneyAccount(r.bankAccountId(), "The project's money account");
            p.setBankAccountId(bank.getId());
        } else {
            Account bank = newAccount(p, blank(r.bankName()) != null ? null : "bank", AccountType.BANK, "BANK",
                    "The bank account of " + p.getName());
            if (blank(r.bankName()) != null) bank.setName(uniqueName(ActivityService.cut(r.bankName().trim(), 100)));
            bank.setInstitution(blank(r.bankInstitution()));
            bank.setAccountNumber(blank(r.bankNumber()));
            p.setBankAccountId(accounts.save(bank).getId());
        }
        p = projects.save(p);

        int pos = 1;
        for (StageInput s : r.stages() == null ? List.<StageInput>of() : r.stages()) {
            ConstructionStage st = new ConstructionStage();
            st.setTenantId(p.getTenantId());
            st.setProjectId(p.getId());
            st.setPosition(pos++);
            st.setStatus("PENDING");
            stageFrom(st, s);
            stages.save(st);
        }
        List<PartnerInput> pins = r.partners() == null || r.partners().isEmpty()
                ? List.of(new PartnerInput(UserContext.get().fullName(), null, null, Money.HUNDRED, true)) : r.partners();
        validateShares(pins.stream().map(PartnerInput::sharePercent).toList());
        if (pins.stream().filter(x -> Boolean.TRUE.equals(x.me())).count() > 1) throw new BusinessException("Only one partner can be you");
        for (PartnerInput x : pins) addPartner(p, x);
        for (PartyInput x : r.parties() == null ? List.<PartyInput>of() : r.parties()) addParty(p, x);
        if (r.units() != null && DEVELOPMENT.equals(p.getKind())) makeUnits(p, r.units());
        activity.record("ADDED", AREA, "Started the project " + p.getName() + " · " + (CONTRACT.equals(p.getKind())
                ? "contract work for " + Objects.toString(p.getClientName(), "an owner") : JOINT.equals(p.getLandMode()) ? "joint development" : "own plot development"));
        return detail(p.getId());
    }

    @Transactional
    public Detail update(Long id, ProjectRequest q) {
        ConstructionProject p = requireOpen(id);
        if (!p.getKind().equals(q.kind().trim().toUpperCase())) {
            throw new BusinessException("A project's kind cannot change: start a new project instead");
        }
        String old = p.getName();
        apply(p, q, false);
        requireUniqueName(p);
        projects.save(p);
        if (!old.equals(p.getName())) {
            // the project's own accounts follow its name
            accounts.findByTenantId(p.getTenantId()).stream().filter(a -> p.getId().equals(a.getProjectId()) && a.getName().startsWith(old + " · "))
                    .forEach(a -> { a.setName(uniqueName(ActivityService.cut(p.getName() + a.getName().substring(old.length()), 100))); accounts.save(a); });
        }
        activity.record("CHANGED", AREA, "Changed the details of " + p.getName());
        return detail(id);
    }

    /** The company's signature, drawn once, for the agreements and receipts. */
    @Transactional
    public Detail signature(Long id, SignatureRequest r) {
        ConstructionProject p = require(id);
        p.setCompanySignature(blank(r.signature()) == null ? null : HostedChitService.drawn(r.signature(), "the signature"));
        projects.save(p);
        return detail(id);
    }

    @Transactional
    public void delete(Long id) {
        ConstructionProject p = require(id);
        if (!receipts.findByProjectId(id).isEmpty() || !costs.findByProjectId(id).isEmpty() || !capital.findByProjectId(id).isEmpty()
                || !loanTxns.findByProjectId(id).isEmpty() || !sales.findByProjectId(id).isEmpty()
                || agreements.findByProjectId(id).stream().anyMatch(a -> !"DRAFT".equals(a.getStatus()))) {
            throw new BusinessException("The project has money, sales or signed agreements recorded; close it instead");
        }
        agreements.findByProjectId(id).forEach(a -> agreements.deleteById(a.getId()));
        instalments.findByProjectId(id).forEach(x -> instalments.deleteById(x.getId()));
        units.findByProjectId(id).forEach(x -> units.deleteById(x.getId()));
        parties.findByProjectId(id).forEach(x -> parties.deleteById(x.getId()));
        loans.findByProjectId(id).forEach(x -> loans.deleteById(x.getId()));
        extras.findByProjectId(id).forEach(x -> extras.deleteById(x.getId()));
        stages.findByProjectId(id).forEach(x -> stages.deleteById(x.getId()));
        List<ConstructionPartner> ps = partners.findByProjectId(id);
        ps.forEach(x -> partners.deleteById(x.getId()));
        List<Account> own = accounts.findByTenantId(p.getTenantId()).stream().filter(a -> id.equals(a.getProjectId())).toList();
        p.setBankAccountId(null);
        p.setCostAccountId(null);
        p.setLandAccountId(null);
        p.setAdvancesAccountId(null);
        p.setInterestAccountId(null);
        p.setProfitAccountId(null);
        projects.save(p);
        for (Account a : own) {
            if (!ledger.entryIdsTouchingAccount(a.getId()).isEmpty()) {
                throw new BusinessException("The account " + a.getName() + " has entries; close the project instead");
            }
            accounts.deleteById(a.getId());
        }
        projects.deleteById(id);
        activity.record("DELETED", AREA, "Deleted the project " + p.getName());
    }

    // ================================================================== status: running, completed, closed

    /**
     * ACTIVE (re-opens a completed project), COMPLETED (the work is done: completedOn), CLOSED (the books are final:
     * the advances are set off against the costs and the profit shared) or back from CLOSED (the closing undone).
     */
    @Transactional
    public Detail status(Long id, StatusRequest r) {
        ConstructionProject p = require(id);
        String to = r.status().trim().toUpperCase();
        switch (to) {
            case ACTIVE, PLANNING -> {
                if (CLOSED.equals(p.getStatus())) reopen(p);
                p.setStatus(to);
                p.setCompletedOn(null);
                activity.record("CHANGED", AREA, "Re-opened " + p.getName());
            }
            case COMPLETED -> {
                if (CLOSED.equals(p.getStatus())) reopen(p);
                p.setStatus(COMPLETED);
                p.setCompletedOn(r.completedOn() != null ? r.completedOn() : LocalDate.now());
                activity.record("CHANGED", AREA, "Completed " + p.getName());
            }
            case CLOSED -> close(p);
            default -> throw new BusinessException("Unknown status " + to);
        }
        projects.save(p);
        return detail(id);
    }

    private void close(ConstructionProject p) {
        if (CLOSED.equals(p.getStatus())) throw new BusinessException("The project is already closed");
        if (sales.findByProjectId(p.getId()).stream().anyMatch(s -> !Set.of("CLOSED", "CANCELLED").contains(s.getStatus()))) {
            throw new BusinessException("Close every flat's sale first (handed over and paid), or cancel it");
        }
        Map<Long, BigDecimal> bal = balances();
        BigDecimal advances = bal.getOrDefault(p.getAdvancesAccountId(), Money.ZERO);
        BigDecimal interest = bal.getOrDefault(p.getInterestAccountId(), Money.ZERO);
        BigDecimal cost = bal.getOrDefault(p.getCostAccountId(), Money.ZERO);
        BigDecimal land = p.getLandAccountId() == null ? Money.ZERO : bal.getOrDefault(p.getLandAccountId(), Money.ZERO);
        BigDecimal profit = advances.add(interest).subtract(cost).subtract(land);
        LocalDate on = p.getCompletedOn() != null ? p.getCompletedOn() : LocalDate.now();
        JournalDraft d = JournalDraft.of(on, VoucherType.JOURNAL, "Closed the books of " + p.getName() + " · " + (profit.signum() >= 0 ? "profit " : "loss ")
                + ActivityService.money(profit.abs())).source(SOURCE_CLOSE, p.getId()).party(p.getName());
        d.debit(p.getAdvancesAccountId(), advances, "Payments received set off against the project");
        d.debit(p.getInterestAccountId(), interest, "Late interest received");
        d.credit(p.getCostAccountId(), cost, "Construction cost");
        if (p.getLandAccountId() != null) d.credit(p.getLandAccountId(), land, "Land");
        List<ConstructionPartner> ps = partners.findByProjectId(p.getId());
        BigDecimal shares = ps.stream().map(ConstructionPartner::getSharePercent).reduce(Money.ZERO, BigDecimal::add);
        List<ConstructionCapital> shareRows = new ArrayList<>();
        if (profit.signum() != 0) {
            BigDecimal left = profit.abs();
            List<Object[]> split = new ArrayList<>();   // [partner or null (me without a partner row), amount]
            if (ps.isEmpty() || shares.signum() == 0) {
                split.add(new Object[]{null, left});
            } else {
                for (int i = 0; i < ps.size(); i++) {
                    BigDecimal part = i == ps.size() - 1 ? left
                            : Money.round(profit.abs().multiply(ps.get(i).getSharePercent()).divide(shares, 6, RoundingMode.HALF_UP));
                    left = left.subtract(part);
                    split.add(new Object[]{ps.get(i), part});
                }
            }
            for (Object[] s : split) {
                ConstructionPartner partner = (ConstructionPartner) s[0];
                BigDecimal amount = (BigDecimal) s[1];
                if (amount.signum() == 0) continue;
                Long target = partner == null || Boolean.TRUE.equals(partner.getMe()) ? profitAccount(p).getId() : partnerAccount(p, partner).getId();
                String memo = (partner == null ? "My" : Boolean.TRUE.equals(partner.getMe()) ? "My" : partner.getName() + "'s") + " share of the " + (profit.signum() > 0 ? "profit" : "loss");
                if (profit.signum() > 0) d.credit(target, amount, memo); else d.debit(target, amount, memo);
                if (partner != null) {
                    ConstructionCapital c = new ConstructionCapital();
                    c.setTenantId(p.getTenantId());
                    c.setProjectId(p.getId());
                    c.setPartnerId(partner.getId());
                    c.setKind("PROFIT");
                    c.setAmount(profit.signum() > 0 ? amount : amount.negate().abs());
                    c.setNote(profit.signum() > 0 ? "Share of the profit" : "Share of the loss");
                    c.setMovedOn(on);
                    c.setCreatedBy(UserContext.username());
                    c.setCreatedAt(LocalDateTime.now());
                    shareRows.add(c);
                }
            }
        }
        if (d.lines().size() >= 2) {
            JournalEntry e = ledger.post(d);
            p.setClosingEntryId(e.getId());
            for (ConstructionCapital c : shareRows) {
                c.setJournalEntryId(e.getId());
                if (profit.signum() < 0) c.setNote("Share of the loss");
                capital.save(c);
            }
        }
        p.setStatus(CLOSED);
        p.setClosedAt(LocalDateTime.now());
        if (p.getCompletedOn() == null) p.setCompletedOn(on);
        activity.record("CHANGED", AREA, "Closed the books of " + p.getName() + " · " + (profit.signum() >= 0 ? "profit " : "loss ") + ActivityService.money(profit.abs()));
    }

    private void reopen(ConstructionProject p) {
        Long entry = p.getClosingEntryId();
        capital.findByProjectId(p.getId()).stream().filter(c -> "PROFIT".equals(c.getKind())).forEach(c -> capital.deleteById(c.getId()));
        p.setClosingEntryId(null);
        p.setClosedAt(null);
        projects.save(p);
        if (entry != null) ledger.delete(entry);
    }

    // ================================================================== stages

    @Transactional
    public Detail saveStage(Long id, Long stageId, StageInput s) {
        ConstructionProject p = requireOpen(id);
        ConstructionStage st;
        if (stageId == null) {
            st = new ConstructionStage();
            st.setTenantId(p.getTenantId());
            st.setProjectId(p.getId());
            st.setPosition(stagesOf(id).stream().mapToInt(ConstructionStage::getPosition).max().orElse(0) + 1);
            st.setStatus("PENDING");
        } else {
            st = requireStage(p, stageId);
        }
        stageFrom(st, s);
        stages.save(st);
        activity.record(stageId == null ? "ADDED" : "CHANGED", AREA, (stageId == null ? "Added the stage " : "Changed the stage ") + st.getName() + " · " + p.getName());
        return detail(id);
    }

    /** All the stages in a new order (ids, first to last). */
    @Transactional
    public Detail orderStages(Long id, List<Long> order) {
        ConstructionProject p = requireOpen(id);
        Map<Long, ConstructionStage> byId = stagesOf(id).stream().collect(Collectors.toMap(ConstructionStage::getId, x -> x));
        int pos = 1;
        for (Long sid : order) {
            ConstructionStage s = byId.remove(sid);
            if (s == null) continue;
            s.setPosition(pos++);
            stages.save(s);
        }
        for (ConstructionStage s : byId.values()) { s.setPosition(pos++); stages.save(s); }
        return detail(p.getId());
    }

    @Transactional
    public Detail deleteStage(Long id, Long stageId) {
        ConstructionProject p = requireOpen(id);
        ConstructionStage st = requireStage(p, stageId);
        if (costs.findByProjectId(id).stream().anyMatch(c -> stageId.equals(c.getStageId()))
                || instalments.findByProjectId(id).stream().anyMatch(i -> stageId.equals(i.getStageId()))) {
            throw new BusinessException("Costs or buyers' payment plans are linked to " + st.getName() + "; change them first");
        }
        stages.deleteById(stageId);
        activity.record("DELETED", AREA, "Removed the stage " + st.getName() + " · " + p.getName());
        return detail(id);
    }

    /** A stage started or done (or back to not started): buyers' instalments linked to it fall due when it is done. */
    @Transactional
    public Detail progress(Long id, Long stageId, StageProgress r) {
        ConstructionProject p = requireOpen(id);
        ConstructionStage st = requireStage(p, stageId);
        String to = r.status().trim().toUpperCase();
        if (!Set.of("PENDING", "IN_PROGRESS", "DONE").contains(to)) throw new BusinessException("Unknown stage status " + to);
        st.setStatus(to);
        st.setCompletedOn("DONE".equals(to) ? (r.completedOn() != null ? r.completedOn() : LocalDate.now()) : null);
        stages.save(st);
        if (PLANNING.equals(p.getStatus()) && !"PENDING".equals(to)) {
            p.setStatus(ACTIVE);
            projects.save(p);
        }
        activity.record("CHANGED", AREA, st.getName() + (switch (to) { case "DONE" -> " done"; case "IN_PROGRESS" -> " started"; default -> " not started"; })
                + " · " + p.getName());
        return detail(id);
    }

    // ================================================================== extra works

    @Transactional
    public Detail saveExtra(Long id, Long extraId, ExtraRequest r) {
        ConstructionProject p = requireOpen(id);
        if (!CONTRACT.equals(p.getKind())) throw new BusinessException("Extra works are for contract works; a development adds a stage or a cost");
        ConstructionExtra x;
        if (extraId == null) {
            x = new ConstructionExtra();
            x.setTenantId(p.getTenantId());
            x.setProjectId(p.getId());
            x.setSeq(extras.findByProjectId(id).stream().mapToInt(ConstructionExtra::getSeq).max().orElse(0) + 1);
            x.setStatus("PROPOSED");
            x.setCreatedBy(UserContext.username());
            x.setCreatedAt(LocalDateTime.now());
        } else {
            x = requireExtra(p, extraId);
            if (signedFor(p, "EXTRA", x.getId())) {
                throw new BusinessException("The supplementary agreement for this extra work is signed; record a new extra work for any change");
            }
        }
        x.setTitle(r.title().trim());
        x.setDescription(blank(r.description()));
        x.setAmount(Money.round(r.amount()));
        x.setExtraDays(r.extraDays() == null ? 0 : r.extraDays());
        x.setRequestedOn(r.requestedOn() != null ? r.requestedOn() : LocalDate.now());
        x.setDueDate(r.dueDate());
        extras.save(x);
        activity.record(extraId == null ? "ADDED" : "CHANGED", AREA, "Extra work EX-" + x.getSeq() + " · " + x.getTitle() + " · " + ActivityService.money(x.getAmount())
                + (x.getExtraDays() > 0 ? " · +" + x.getExtraDays() + " days" : "") + " · " + p.getName());
        return detail(id);
    }

    /** PROPOSED, AGREED (adds its price and days), DONE or CANCELLED. */
    @Transactional
    public Detail extraStatus(Long id, Long extraId, ExtraStatus r) {
        ConstructionProject p = requireOpen(id);
        ConstructionExtra x = requireExtra(p, extraId);
        String to = r.status().trim().toUpperCase();
        if (!Set.of("PROPOSED", "AGREED", "DONE", "CANCELLED").contains(to)) throw new BusinessException("Unknown status " + to);
        if ("CANCELLED".equals(to) && receipts.findByProjectId(id).stream().anyMatch(rc -> rc.getTowards() != null && rc.getTowards().contains("EX-" + x.getSeq() + " "))) {
            throw new BusinessException("Money was received towards this extra work; it cannot be cancelled");
        }
        x.setStatus(to);
        x.setCompletedOn("DONE".equals(to) ? (r.completedOn() != null ? r.completedOn() : LocalDate.now()) : null);
        extras.save(x);
        activity.record("CHANGED", AREA, "Extra work EX-" + x.getSeq() + " " + to.toLowerCase() + " · " + p.getName());
        return detail(id);
    }

    @Transactional
    public Detail deleteExtra(Long id, Long extraId) {
        ConstructionProject p = requireOpen(id);
        ConstructionExtra x = requireExtra(p, extraId);
        if (!"PROPOSED".equals(x.getStatus()) && !"CANCELLED".equals(x.getStatus())) {
            throw new BusinessException("An agreed extra work is part of the contract: cancel it instead");
        }
        if (agreements.findByProjectId(id).stream().anyMatch(a -> "EXTRA".equals(a.getKind()) && extraId.equals(a.getRefId()) && !"DRAFT".equals(a.getStatus()))) {
            throw new BusinessException("Its supplementary agreement is signed; cancel the extra work instead");
        }
        agreements.findByProjectId(id).stream().filter(a -> "EXTRA".equals(a.getKind()) && extraId.equals(a.getRefId())).forEach(a -> agreements.deleteById(a.getId()));
        extras.deleteById(extraId);
        activity.record("DELETED", AREA, "Removed the extra work EX-" + x.getSeq() + " · " + p.getName());
        return detail(id);
    }

    // ================================================================== figures

    Figures figures(ConstructionProject p, Map<Long, BigDecimal> bal) {
        List<ConstructionStage> st = stagesOf(p.getId());
        List<ConstructionExtra> ex = extras.findByProjectId(p.getId());
        List<ConstructionReceipt> rc = receipts.findByProjectId(p.getId());
        List<ConstructionCost> cs = costs.findByProjectId(p.getId());
        boolean contract = CONTRACT.equals(p.getKind());
        BigDecimal contractValue = st.stream().map(s -> Money.nz(s.getAmount())).reduce(Money.ZERO, BigDecimal::add);
        List<ConstructionExtra> counted = ex.stream().filter(x -> Set.of("AGREED", "DONE").contains(x.getStatus())).toList();
        BigDecimal extrasValue = counted.stream().map(ConstructionExtra::getAmount).reduce(Money.ZERO, BigDecimal::add);
        int extraDays = counted.stream().mapToInt(x -> x.getExtraDays() == null ? 0 : x.getExtraDays()).sum();
        BigDecimal received = rc.stream().map(r -> r.getAmount().subtract(Money.nz(r.getInterestAmount()))).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal interestReceived = rc.stream().map(r -> Money.nz(r.getInterestAmount())).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal land = cs.stream().filter(c -> "LAND".equals(c.getHead())).map(ConstructionCost::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal spent = cs.stream().filter(c -> !"LAND".equals(c.getHead())).map(ConstructionCost::getAmount).reduce(Money.ZERO, BigDecimal::add);
        // loan interest and charges are costs of the project as well
        BigDecimal loanCost = loanTxns.findByProjectId(p.getId()).stream().filter(t -> Set.of("INTEREST", "CHARGES").contains(t.getKind()))
                .map(ConstructionLoanTxn::getAmount).reduce(Money.ZERO, BigDecimal::add);
        spent = spent.add(loanCost);
        BigDecimal due = Money.ZERO, overdue = Money.ZERO, upcoming = Money.ZERO, interestDue = Money.ZERO;
        int unitsTotal = 0, available = 0, booked = 0, sold = 0, landowner = 0;
        BigDecimal salesValue = Money.ZERO, unsoldValue = Money.ZERO;
        if (contract) {
            ConstructionDues.Result d = contractDues(p, st, ex, rc);
            due = d.due();
            overdue = d.overdue();
            upcoming = d.upcoming();
            interestDue = d.interest().subtract(rc.stream().filter(r -> r.getSaleId() == null).map(r -> Money.nz(r.getInterestAmount()))
                    .reduce(Money.ZERO, BigDecimal::add)).max(Money.ZERO);
        } else {
            List<ConstructionUnit> un = units.findByProjectId(p.getId());
            Map<Long, ConstructionUnit> unitById = un.stream().collect(Collectors.toMap(ConstructionUnit::getId, u -> u));
            unitsTotal = un.size();
            for (ConstructionUnit u : un) {
                switch (u.getStatus()) {
                    case "AVAILABLE" -> { available++; unsoldValue = unsoldValue.add(Money.nz(u.getPrice())); }
                    case "BOOKED" -> booked++;
                    case "LANDOWNER" -> landowner++;
                    default -> sold++;
                }
            }
            for (ConstructionSale s : sales.findByProjectId(p.getId())) {
                if ("CANCELLED".equals(s.getStatus())) continue;
                salesValue = salesValue.add(s.getTotalPrice());
                SaleView v = saleView(p, s, unitById.get(s.getUnitId()), st, rc);
                due = due.add(v.due());
                overdue = overdue.add(v.overdue());
                interestDue = interestDue.add(v.interestDue());
            }
            contractValue = salesValue;
        }
        BigDecimal totalValue = contractValue.add(extrasValue);
        BigDecimal totalCost = spent.add(land);
        int done = (int) st.stream().filter(s -> "DONE".equals(s.getStatus())).count();
        int progress = st.isEmpty() ? 0 : (int) Math.round(done * 100.0 / st.size());
        LocalDate revised = p.getPlannedEndDate() == null ? null : p.getPlannedEndDate().plusDays(extraDays);
        Long daysLeft = revised == null || CLOSED.equals(p.getStatus()) || COMPLETED.equals(p.getStatus()) ? null : ChronoUnit.DAYS.between(LocalDate.now(), revised);
        BigDecimal profit = received.add(interestReceived).subtract(totalCost);
        BigDecimal expected = contract
                ? totalValue.subtract(Money.nz(p.getEstimatedCost()).max(totalCost))
                : salesValue.add(unsoldValue).subtract(Money.nz(p.getEstimatedCost()).max(totalCost));
        List<ConstructionLoan> ln = loans.findByProjectId(p.getId());
        BigDecimal sanctioned = ln.stream().map(ConstructionLoan::getSanctioned).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal loanOut = ln.stream().map(l -> bal.getOrDefault(l.getAccountId(), Money.ZERO)).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal capIn = capital.findByProjectId(p.getId()).stream().map(c -> switch (c.getKind()) {
            case "INVEST" -> c.getAmount();
            case "WITHDRAW" -> c.getAmount().negate();
            default -> Money.ZERO;
        }).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal money = accounts.findByTenantId(p.getTenantId()).stream()
                .filter(a -> p.getId().equals(a.getProjectId()) && a.getAccountType().isLiquid())
                .map(a -> bal.getOrDefault(a.getId(), Money.ZERO)).reduce(Money.ZERO, BigDecimal::add);
        return new Figures(contractValue, extrasValue, totalValue, received, interestReceived, due, overdue, upcoming, Money.round(interestDue),
                spent, land, totalCost, p.getEstimatedCost(), profit, expected, done, st.size(), progress, revised, extraDays, daysLeft,
                unitsTotal, available, booked, sold, landowner, salesValue, unsoldValue, sanctioned, loanOut, capIn, money);
    }

    /** The owner's schedule: the stages' prices and the agreed extra works, against what the owner paid. */
    ConstructionDues.Result contractDues(ConstructionProject p, List<ConstructionStage> st, List<ConstructionExtra> ex, List<ConstructionReceipt> rc) {
        List<ConstructionDues.Item> items = new ArrayList<>();
        for (ConstructionStage s : st) {
            if (Money.nz(s.getAmount()).signum() <= 0) continue;
            LocalDate due = s.getDueDate() != null ? s.getDueDate() : "DONE".equals(s.getStatus()) && s.getCompletedOn() != null ? s.getCompletedOn().plusDays(7) : null;
            items.add(new ConstructionDues.Item("S" + s.getId(), s.getName(), due, s.getAmount()));
        }
        for (ConstructionExtra x : ex) {
            if (!Set.of("AGREED", "DONE").contains(x.getStatus())) continue;
            LocalDate due = x.getDueDate() != null ? x.getDueDate() : "DONE".equals(x.getStatus()) && x.getCompletedOn() != null ? x.getCompletedOn().plusDays(7) : null;
            items.add(new ConstructionDues.Item("X" + x.getId(), "EX-" + x.getSeq() + " " + x.getTitle(), due, x.getAmount()));
        }
        List<ConstructionDues.Payment> paid = rc.stream().filter(r -> r.getSaleId() == null)
                .map(r -> new ConstructionDues.Payment(r.getReceivedOn(), r.getAmount().subtract(Money.nz(r.getInterestAmount())))).toList();
        return ConstructionDues.compute(items, paid, p.getLateInterestPercent(), p.getLateGraceDays() == null ? 0 : p.getLateGraceDays(), LocalDate.now());
    }

    /** A buyer's plan against what they (and their bank) paid. */
    SaleView saleView(ConstructionProject p, ConstructionSale s, ConstructionUnit u, List<ConstructionStage> st, List<ConstructionReceipt> rc) {
        List<ConstructionInstalment> plan = instalments.findByProjectId(p.getId()).stream().filter(i -> s.getId().equals(i.getSaleId()))
                .sorted(Comparator.comparing(ConstructionInstalment::getPosition)).toList();
        Map<Long, ConstructionStage> stageById = st.stream().collect(Collectors.toMap(ConstructionStage::getId, x -> x));
        List<ConstructionDues.Item> items = plan.stream().map(i -> {
            LocalDate due = i.getDueDate();
            if (due == null && i.getStageId() != null) {
                ConstructionStage stage = stageById.get(i.getStageId());
                if (stage != null && "DONE".equals(stage.getStatus()) && stage.getCompletedOn() != null) {
                    due = stage.getCompletedOn().plusDays(i.getDaysAfterStage() == null ? 15 : i.getDaysAfterStage());
                }
            }
            return new ConstructionDues.Item("I" + i.getId(), i.getLabel(), due, i.getAmount());
        }).toList();
        List<ConstructionReceipt> mine = rc.stream().filter(r -> s.getId().equals(r.getSaleId())).toList();
        BigDecimal received = mine.stream().map(r -> r.getAmount().subtract(Money.nz(r.getInterestAmount()))).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal interestReceived = mine.stream().map(r -> Money.nz(r.getInterestAmount())).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal bank = mine.stream().filter(r -> "BANK".equals(r.getPayer())).map(ConstructionReceipt::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal rate = s.getLateInterestPercent() != null ? s.getLateInterestPercent() : p.getLateInterestPercent();
        ConstructionDues.Result d = ConstructionDues.compute(items,
                mine.stream().map(r -> new ConstructionDues.Payment(r.getReceivedOn(), r.getAmount().subtract(Money.nz(r.getInterestAmount())))).toList(),
                rate, p.getLateGraceDays() == null ? 0 : p.getLateGraceDays(), LocalDate.now());
        boolean active = !"CANCELLED".equals(s.getStatus());
        return new SaleView(s, unitLabel(u), plan, d.rows(), received, interestReceived, bank, s.getTotalPrice().subtract(received),
                active ? d.due() : Money.ZERO, active ? d.overdue() : Money.ZERO, active ? d.interest().subtract(interestReceived).max(Money.ZERO) : Money.ZERO);
    }

    private List<PartnerView> partnerViews(ConstructionProject p, List<ConstructionCapital> cap) {
        List<ConstructionPartner> ps = partners.findByProjectId(p.getId()).stream().sorted(Comparator.comparing(ConstructionPartner::getId)).toList();
        Map<Long, BigDecimal> invested = new HashMap<>(), withdrawn = new HashMap<>(), profit = new HashMap<>();
        for (ConstructionCapital c : cap) {
            Map<Long, BigDecimal> m = switch (c.getKind()) { case "INVEST" -> invested; case "WITHDRAW" -> withdrawn; default -> profit; };
            BigDecimal signed = "PROFIT".equals(c.getKind()) && c.getNote() != null && c.getNote().contains("loss") ? c.getAmount().negate() : c.getAmount();
            m.merge(c.getPartnerId(), signed, BigDecimal::add);
        }
        BigDecimal totalIn = invested.values().stream().reduce(Money.ZERO, BigDecimal::add);
        return ps.stream().map(x -> {
            BigDecimal in = invested.getOrDefault(x.getId(), Money.ZERO);
            BigDecimal out = withdrawn.getOrDefault(x.getId(), Money.ZERO);
            BigDecimal pr = profit.getOrDefault(x.getId(), Money.ZERO);
            return new PartnerView(x, in, out, pr, in.subtract(out).add(pr), totalIn.signum() == 0 ? Money.ZERO : Money.percent(in, totalIn));
        }).toList();
    }

    private List<LoanView> loanViews(ConstructionProject p, List<ConstructionLoanTxn> txns, Map<Long, BigDecimal> bal) {
        return loans.findByProjectId(p.getId()).stream().sorted(Comparator.comparing(ConstructionLoan::getId)).map(l -> {
            Map<String, BigDecimal> by = txns.stream().filter(t -> l.getId().equals(t.getLoanId()))
                    .collect(Collectors.groupingBy(ConstructionLoanTxn::getKind, Collectors.reducing(Money.ZERO, ConstructionLoanTxn::getAmount, BigDecimal::add)));
            return new LoanView(l, by.getOrDefault("DISBURSE", Money.ZERO), by.getOrDefault("REPAY", Money.ZERO), by.getOrDefault("INTEREST", Money.ZERO),
                    by.getOrDefault("CHARGES", Money.ZERO), bal.getOrDefault(l.getAccountId(), Money.ZERO));
        }).toList();
    }

    // ================================================================== helpers (shared by the other construction services)

    ConstructionProject require(Long id) {
        return projects.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Project", id));
    }

    /** The project, when it can still change: a closed project's books are final until it is re-opened. */
    ConstructionProject requireOpen(Long id) {
        ConstructionProject p = require(id);
        if (CLOSED.equals(p.getStatus())) {
            throw new BusinessException(p.getName() + " is closed: its books are final. Re-open it to make a change");
        }
        return p;
    }

    ConstructionStage requireStage(ConstructionProject p, Long stageId) {
        return stages.findById(stageId).filter(s -> p.getId().equals(s.getProjectId())).orElseThrow(() -> new NotFoundException("Stage", stageId));
    }

    private ConstructionExtra requireExtra(ConstructionProject p, Long extraId) {
        return extras.findById(extraId).filter(s -> p.getId().equals(s.getProjectId())).orElseThrow(() -> new NotFoundException("Extra work", extraId));
    }

    List<ConstructionStage> stagesOf(Long projectId) {
        return stages.findByProjectId(projectId).stream().sorted(Comparator.comparing(ConstructionStage::getPosition).thenComparing(ConstructionStage::getId)).toList();
    }

    boolean signedFor(ConstructionProject p, String kind, Long refId) {
        return agreements.findByProjectId(p.getId()).stream().anyMatch(a -> kind.equals(a.getKind()) && Objects.equals(refId, a.getRefId())
                && !"DRAFT".equals(a.getStatus()));
    }

    /** Natural-sign balances of every account, today and later (post-dated entries count). */
    Map<Long, BigDecimal> balances() {
        return ledger.snapshot().balancesAsOf(FOREVER);
    }

    private AccountLine line(Account a, Map<Long, BigDecimal> bal, boolean own) {
        return new AccountLine(a.getId(), a.getName(), a.getProjectRole(), a.getAccountType(), bal.getOrDefault(a.getId(), Money.ZERO), own);
    }

    /** A new account of the project in the construction book: "Green Villas · bank". */
    Account newAccount(ConstructionProject p, String suffix, AccountType type, String role, String what) {
        Account a = accountService.createInternal(uniqueName(ActivityService.cut(p.getName() + " · " + (suffix == null ? role.toLowerCase() : suffix), 100)),
                type, ActivityService.cut(what + " (Construction)", 255), false);
        a.setProjectBook(true);
        a.setProjectId(p.getId());
        a.setProjectRole(role);
        return accounts.save(a);
    }

    Account profitAccount(ConstructionProject p) {
        if (p.getProfitAccountId() != null) return accounts.findById(p.getProfitAccountId()).orElseThrow();
        Account a = newAccount(p, "my profit", AccountType.INCOME, "PROFIT", "My share of the profit of " + p.getName());
        p.setProfitAccountId(a.getId());
        projects.save(p);
        return a;
    }

    /** Another partner's capital account (what the business owes them), made on first use. */
    Account partnerAccount(ConstructionProject p, ConstructionPartner x) {
        if (x.getAccountId() != null) return accounts.findById(x.getAccountId()).orElseThrow();
        Account a = newAccount(p, "capital · " + x.getName(), AccountType.OTHER_LIABILITY, "CAPITAL",
                x.getName() + "'s money in " + p.getName() + " (invested, less taken out, plus their share of the profit)");
        x.setAccountId(a.getId());
        partners.save(x);
        return a;
    }

    /** An account money comes into or goes out of: cash, bank or wallet (the project's, a common business account or my own). */
    Account requireMoneyAccount(Long accountId, String what) {
        Account a = accountService.require(accountId);
        if (a.getAccountClass() != AccountClass.ASSET || !a.getAccountType().isLiquid()) {
            throw new BusinessException(what + ": pick a cash, bank or wallet account (" + a.getName() + " is a " + a.getAccountType().getLabel() + ")");
        }
        if (!Boolean.TRUE.equals(a.getActive())) throw new BusinessException(a.getName() + " is inactive");
        if (a.isChitBook()) throw new BusinessException(a.getName() + " holds chit members' money; pick another account");
        return a;
    }

    String uniqueName(String name) {
        Set<String> taken = accounts.findByTenantId(UserContext.tenantId()).stream().map(a -> a.getName().toLowerCase()).collect(Collectors.toSet());
        if (!taken.contains(name.toLowerCase())) return name;
        for (int i = 2; ; i++) {
            String next = ActivityService.cut(name, 95) + " (" + i + ")";
            if (!taken.contains(next.toLowerCase())) return next;
        }
    }

    /** The project's short code (receipts CA-R0001, agreements): set, or made from the name. */
    static String code(ConstructionProject p) {
        if (p.getCode() != null && !p.getCode().isBlank()) return p.getCode();
        StringBuilder b = new StringBuilder();
        for (String w : p.getName().split("[^A-Za-z0-9]+")) {
            if (w.isEmpty()) continue;
            b.append(w.chars().anyMatch(Character::isDigit) ? w.toUpperCase() : w.substring(0, 1).toUpperCase());
            if (b.length() >= 4) break;
        }
        return b.isEmpty() ? "PRJ" : b.substring(0, Math.min(4, b.length()));
    }

    static String unitLabel(ConstructionUnit u) {
        if (u == null) return "";
        return (u.getBlock() != null && !u.getBlock().isBlank() ? u.getBlock() + "-" : "") + u.getUnitNo();
    }

    static Comparator<ConstructionUnit> unitOrder() {
        return Comparator.comparing((ConstructionUnit u) -> Objects.toString(u.getBlock(), ""))
                .thenComparing(u -> u.getFloor() == null ? 0 : u.getFloor())
                .thenComparing(ConstructionUnit::getUnitNo, Comparator.comparing((String s) -> s.length()).thenComparing(Function.identity()));
    }

    static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    static String phone(String s, String who) {
        return blank(s) == null ? null : HostedChitService.cleanPhone(s, who);
    }

    private static BigDecimal sum(List<Summary> list, Function<Figures, BigDecimal> f) {
        return list.stream().map(s -> f.apply(s.figures())).filter(Objects::nonNull).reduce(Money.ZERO, BigDecimal::add);
    }

    private void apply(ConstructionProject p, ProjectRequest q, boolean fresh) {
        String kind = q.kind().trim().toUpperCase();
        if (!Set.of(CONTRACT, DEVELOPMENT).contains(kind)) throw new BusinessException("Choose a contract work or a development");
        p.setKind(kind);
        if (DEVELOPMENT.equals(kind)) {
            String mode = q.landMode() == null ? OWN_PLOT : q.landMode().trim().toUpperCase();
            if (!Set.of(OWN_PLOT, JOINT).contains(mode)) throw new BusinessException("Choose an own plot or a joint development");
            if (!fresh && !mode.equals(p.getLandMode())) throw new BusinessException("How the land is held cannot change: start a new project instead");
            p.setLandMode(mode);
        } else {
            p.setLandMode(null);
            if (blank(q.clientName()) == null) throw new BusinessException("Enter the owner of the site: the contract is with them");
        }
        p.setName(q.name().trim());
        String code = blank(q.code());
        if (code != null && !code.matches("[A-Za-z0-9]{2,6}")) throw new BusinessException("The short code is 2 to 6 letters or digits");
        p.setCode(code == null ? null : code.toUpperCase());
        p.setSiteAddress(blank(q.siteAddress()));
        p.setCity(blank(q.city()));
        p.setSurveyNo(blank(q.surveyNo()));
        p.setPlotNo(blank(q.plotNo()));
        p.setPlotArea(q.plotArea());
        String unit = blank(q.areaUnit()) == null ? "SQ_YD" : q.areaUnit().trim().toUpperCase();
        if (!AREA_UNITS.contains(unit)) throw new BusinessException("Unknown area unit " + unit);
        p.setAreaUnit(unit);
        p.setBoundaries(blank(q.boundaries()));
        p.setBuiltUpArea(q.builtUpArea());
        p.setFloors(q.floors());
        p.setPermitNo(blank(q.permitNo()));
        p.setReraNo(blank(q.reraNo()));
        if (q.startDate() != null && q.plannedEndDate() != null && q.plannedEndDate().isBefore(q.startDate())) {
            throw new BusinessException("The completion date is before the start");
        }
        p.setStartDate(q.startDate());
        p.setPlannedEndDate(q.plannedEndDate());
        p.setClientName(blank(q.clientName()));
        p.setClientPhone(phone(q.clientPhone(), "The owner"));
        p.setClientAddress(blank(q.clientAddress()));
        p.setClientEmail(blank(q.clientEmail()));
        p.setClientRelation(blank(q.clientRelation()));
        p.setLateInterestPercent(q.lateInterestPercent() == null || q.lateInterestPercent().signum() == 0 ? null : q.lateInterestPercent());
        p.setLateGraceDays(q.lateGraceDays() == null ? 0 : q.lateGraceDays());
        p.setDefectLiabilityMonths(q.defectLiabilityMonths());
        p.setEstimatedCost(q.estimatedCost());
        p.setPlotPrice(q.plotPrice());
        p.setLandownerSharePercent(q.landownerSharePercent());
        p.setRefundableDeposit(q.refundableDeposit());
        p.setFlatsPlanned(q.flatsPlanned());
        p.setSaleRate(q.saleRate());
        p.setCompanyName(blank(q.companyName()) != null ? q.companyName().trim() : UserContext.get().tenantName());
        p.setCompanyAddress(blank(q.companyAddress()));
        p.setSignerName(blank(q.signerName()) != null ? q.signerName().trim() : UserContext.get().fullName());
        p.setSignerDesignation(blank(q.signerDesignation()));
        p.setNotes(blank(q.notes()));
    }

    private void requireUniqueName(ConstructionProject p) {
        if (projects.findByTenantId(p.getTenantId()).stream().anyMatch(x -> !x.getId().equals(p.getId()) && x.getName().equalsIgnoreCase(p.getName()))) {
            throw new BusinessException("There is already a project called " + p.getName());
        }
    }

    private static void stageFrom(ConstructionStage st, StageInput s) {
        st.setName(s.name().trim());
        st.setDescription(blank(s.description()));
        st.setAmount(s.amount() == null || s.amount().signum() == 0 ? null : Money.round(s.amount()));
        if (s.plannedStart() != null && s.plannedEnd() != null && s.plannedEnd().isBefore(s.plannedStart())) {
            throw new BusinessException(s.name() + ": it ends before it starts");
        }
        st.setPlannedStart(s.plannedStart());
        st.setPlannedEnd(s.plannedEnd());
        st.setDueDate(s.dueDate());
    }

    static void validateShares(List<BigDecimal> shares) {
        BigDecimal total = shares.stream().map(Money::nz).reduce(Money.ZERO, BigDecimal::add);
        if (!shares.isEmpty() && total.compareTo(Money.HUNDRED) != 0) {
            throw new BusinessException("The partners' shares add up to " + total.stripTrailingZeros().toPlainString() + "%; they should make 100%");
        }
    }

    ConstructionPartner addPartner(ConstructionProject p, PartnerInput x) {
        ConstructionPartner c = new ConstructionPartner();
        c.setTenantId(p.getTenantId());
        c.setProjectId(p.getId());
        c.setName(x.name().trim());
        c.setPhone(phone(x.phone(), x.name()));
        c.setAddress(blank(x.address()));
        c.setSharePercent(x.sharePercent());
        c.setMe(Boolean.TRUE.equals(x.me()));
        c.setCreatedAt(LocalDateTime.now());
        return partners.save(c);
    }

    ConstructionParty addParty(ConstructionProject p, PartyInput x) {
        if (!DEVELOPMENT.equals(p.getKind())) throw new BusinessException("Sellers and landowners are for developments");
        String role = x.role().trim().toUpperCase();
        if (!Set.of("SELLER", "LANDOWNER").contains(role)) throw new BusinessException("A seller of the plot or a landowner");
        ConstructionParty c = new ConstructionParty();
        c.setTenantId(p.getTenantId());
        c.setProjectId(p.getId());
        c.setCreatedAt(LocalDateTime.now());
        partyFrom(c, role, x);
        return parties.save(c);
    }

    static void partyFrom(ConstructionParty c, String role, PartyInput x) {
        c.setRole(role);
        c.setName(x.name().trim());
        c.setRelation(blank(x.relation()));
        c.setPhone(phone(x.phone(), x.name()));
        c.setAddress(blank(x.address()));
        c.setSharePercent(x.sharePercent());
        c.setConsideration(x.consideration());
    }

    /** Flats: blocks × floors × units a floor, numbered floor first (101, 102... 201...), the landowners' share first. */
    List<ConstructionUnit> makeUnits(ConstructionProject p, UnitPlan u) {
        int from = u.floorFrom() == null ? 1 : u.floorFrom(), to = u.floorTo() == null ? from : u.floorTo();
        int per = u.perFloor() == null ? 0 : u.perFloor();
        if (per <= 0 || to < from) return List.of();
        List<String> blocks = blank(u.blocks()) == null ? List.of("") : java.util.Arrays.stream(u.blocks().split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        int count = blocks.size() * (to - from + 1) * per;
        if (count > 2000) throw new BusinessException("That makes " + count + " units; add them in parts");
        Set<String> taken = units.findByProjectId(p.getId()).stream().map(x -> Objects.toString(x.getBlock(), "") + "|" + x.getUnitNo()).collect(Collectors.toSet());
        int landowner = u.landownerUnits() == null ? 0 : u.landownerUnits();
        // the landowners' flats are shared among the landowners in turn (each can be changed later)
        List<ConstructionParty> owners = parties.findByProjectId(p.getId()).stream().filter(x -> "LANDOWNER".equals(x.getRole()))
                .sorted(Comparator.comparing(ConstructionParty::getId)).toList();
        List<ConstructionUnit> made = new ArrayList<>();
        for (String block : blocks) {
            for (int f = from; f <= to; f++) {
                for (int k = 1; k <= per; k++) {
                    String no = (f == 0 ? "G" : String.valueOf(f)) + String.format("%02d", k);
                    if (taken.contains(block + "|" + no)) continue;
                    ConstructionUnit x = new ConstructionUnit();
                    x.setTenantId(p.getTenantId());
                    x.setProjectId(p.getId());
                    x.setUnitNo(no);
                    x.setBlock(block.isEmpty() ? null : block);
                    x.setFloor(f);
                    x.setUnitType(blank(u.unitType()));
                    x.setCarpetArea(u.carpetArea());
                    x.setBuiltUpArea(u.builtUpArea());
                    x.setSuperArea(u.superArea());
                    BigDecimal area = u.superArea() != null ? u.superArea() : u.builtUpArea() != null ? u.builtUpArea() : u.carpetArea();
                    x.setPrice(u.rate() != null && area != null ? Money.round(area.multiply(u.rate())) : null);
                    boolean toOwner = made.size() < landowner;
                    x.setAllottedTo(toOwner ? "LANDOWNER" : "BUILDER");
                    x.setStatus(toOwner ? "LANDOWNER" : "AVAILABLE");
                    if (toOwner && !owners.isEmpty()) x.setPartyId(owners.get(made.size() % owners.size()).getId());
                    x.setCreatedAt(LocalDateTime.now());
                    made.add(units.save(x));
                }
            }
        }
        return made;
    }

    /** Posts an entry and returns it; the construction book's entries name the project as the party. */
    JournalEntry post(JournalDraft d) {
        return ledger.post(d);
    }
}
