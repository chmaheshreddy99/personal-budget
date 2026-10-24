package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickBatch;
import com.aditya.personalbudget.domain.entity.BrickBatchItem;
import com.aditya.personalbudget.domain.entity.BrickBatchMaterial;
import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.domain.entity.BrickMaterialPurchase;
import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.domain.entity.BrickOrderItem;
import com.aditya.personalbudget.domain.entity.BrickPricingModel;
import com.aditya.personalbudget.domain.entity.BrickPricingRate;
import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.domain.entity.BrickSettings;
import com.aditya.personalbudget.domain.entity.BrickTrip;
import com.aditya.personalbudget.domain.entity.BrickTripItem;
import com.aditya.personalbudget.domain.entity.BrickType;
import com.aditya.personalbudget.domain.entity.BrickVehicle;
import com.aditya.personalbudget.domain.entity.JournalEntry;
import com.aditya.personalbudget.domain.type.AccountClass;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.dto.ReportDtos.AccountLedger;
import com.aditya.personalbudget.dto.ReportDtos.LedgerRow;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.BrickAdvanceRecoveryRepository;
import com.aditya.personalbudget.repository.BrickBatchItemRepository;
import com.aditya.personalbudget.repository.BrickBatchMaterialRepository;
import com.aditya.personalbudget.repository.BrickBatchRepository;
import com.aditya.personalbudget.repository.BrickEarningRepository;
import com.aditya.personalbudget.repository.BrickExpenseRepository;
import com.aditya.personalbudget.repository.BrickMaterialPurchaseRepository;
import com.aditya.personalbudget.repository.BrickMaterialRepository;
import com.aditya.personalbudget.repository.BrickOrderItemRepository;
import com.aditya.personalbudget.repository.BrickOrderLinkRepository;
import com.aditya.personalbudget.repository.BrickOrderRepository;
import com.aditya.personalbudget.repository.BrickPaySlipRepository;
import com.aditya.personalbudget.repository.BrickPaymentRepository;
import com.aditya.personalbudget.repository.BrickPricingModelRepository;
import com.aditya.personalbudget.repository.BrickPricingRateRepository;
import com.aditya.personalbudget.repository.BrickResourceRepository;
import com.aditya.personalbudget.repository.BrickSettingsRepository;
import com.aditya.personalbudget.repository.BrickTripItemRepository;
import com.aditya.personalbudget.repository.BrickTripRepository;
import com.aditya.personalbudget.repository.BrickTypeRepository;
import com.aditya.personalbudget.repository.BrickVehicleRepository;
import com.aditya.personalbudget.security.UserContext;
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
 * Brick Management: the brick business's set-up (brick types and their MRP, raw materials, pricing models, vehicles and
 * the charges), its own book of accounts, and what the other brick services share: stock of bricks and raw material,
 * numbering and posting to the journal. Every entry it posts has a source starting with {@code BRICK_}, so it is
 * recognised (and tagged) wherever it shows.
 */
@Service
public class BrickService {

    static final String AREA = "Brick Management";
    static final String SOURCE_DELIVERY = "BRICK_DELIVERY";
    static final String SOURCE_RECEIPT = "BRICK_RECEIPT";
    static final String SOURCE_MATERIAL = "BRICK_MATERIAL";
    static final String SOURCE_EXPENSE = "BRICK_EXPENSE";
    static final String SOURCE_SLIP = "BRICK_SLIP";
    static final String SOURCE_TRANSFER = "BRICK_TRANSFER";
    static final LocalDate FOREVER = LocalDate.of(9999, 12, 31);

    /** The brick book's own accounts, by role: name, type and what it is for. CASH is made with the book; BANK ones are added. */
    static final Map<String, Object[]> ROLES = new LinkedHashMap<>();
    static {
        ROLES.put("CASH", new Object[]{"Brick · cash", AccountType.CASH, "Cash of the brick business"});
        ROLES.put("SALES", new Object[]{"Brick · sales", AccountType.INCOME, "Bricks delivered to customers, at the agreed price"});
        ROLES.put("DELIVERY", new Object[]{"Brick · delivery charges", AccountType.INCOME, "Delivery charges billed to customers"});
        ROLES.put("HANDLING", new Object[]{"Brick · loading & unloading charges", AccountType.INCOME, "Loading and unloading billed to customers"});
        ROLES.put("CUSTOMERS", new Object[]{"Brick · customers", AccountType.RECEIVABLE, "What customers owe for bricks delivered, less what they paid (negative: advances)"});
        ROLES.put("MATERIALS", new Object[]{"Brick · raw materials", AccountType.EXPENSE, "Gravel, sand, cement ... bought for production"});
        ROLES.put("PRODUCTION", new Object[]{"Brick · production expenses", AccountType.EXPENSE, "Diesel, power, repairs and other production costs"});
        ROLES.put("WAGES", new Object[]{"Brick · production wages", AccountType.EXPENSE, "What production teams are paid for the bricks they make"});
        ROLES.put("HANDLING_COST", new Object[]{"Brick · delivery & handling wages", AccountType.EXPENSE, "Driver trip incentives, loading and unloading teams"});
        ROLES.put("SALARIES", new Object[]{"Brick · salaries & wages", AccountType.EXPENSE, "Fixed weekly wages, monthly salaries and bonuses"});
        ROLES.put("ADVANCES", new Object[]{"Brick · staff advances", AccountType.RECEIVABLE, "Advances given to the team, taken back from their pay"});
    }

    static final List<String> DEFAULT_HEADS = List.of("Diesel", "Electricity", "Water", "Machine repairs", "Moulds & tools", "Transport",
            "Food & tea", "Rent", "Other");
    /** Roles offered for a resource (any other short name can be typed). */
    public static final List<String> RESOURCE_ROLES = List.of("PRODUCTION_TEAM", "PRODUCTION_WORKER", "LOADING_TEAM", "DRIVER", "SUPERVISOR", "ACCOUNTANT",
            "MACHINE_OPERATOR", "HELPER", "WATCHMAN", "MANAGER", "OTHER");

    // ------------------------------------------------------------------ requests

    public record SettingsRequest(@PositiveOrZero BigDecimal deliveryChargePerTrip, @Min(0) Integer freeDeliveryMinQty,
                                  @PositiveOrZero BigDecimal driverIncentivePerTrip, @PositiveOrZero BigDecimal loadingRate,
                                  @PositiveOrZero BigDecimal unloadingRate, Boolean billHandling, @Size(max = 60) String upiId,
                                  @Size(max = 100) String payeeName, @Size(max = 100) String companyName, @Size(max = 300) String address,
                                  @Size(max = 20) String phone, @Size(max = 100) String ownerName, @Size(max = 20000) String ownerSignature,
                                  @Size(max = 100) String accountantName, @Size(max = 20000) String accountantSignature,
                                  List<@Size(max = 40) String> expenseHeads, @Min(1) @Max(7) Integer payDay, Long receiptAccountId, Long payAccountId) {
    }

    public record TypeRequest(@NotBlank @Size(max = 60) String name, @PositiveOrZero BigDecimal mrp, @Min(0) @Max(365) Integer curingDays,
                              @Min(0) Integer openingStock, @Size(max = 10) String color, Boolean active,
                              /* the lowest price agreed without a checker's approval (empty: any) */
                              @PositiveOrZero BigDecimal minPrice) {
    }

    public record MaterialRequest(@NotBlank @Size(max = 60) String name, @NotBlank @Size(max = 15) String unit, @PositiveOrZero BigDecimal openingStock,
                                  @PositiveOrZero BigDecimal reorderLevel, Boolean active) {
    }

    public record RateInput(@NotNull Long brickTypeId, @NotNull @PositiveOrZero BigDecimal rate) {
    }

    public record ModelRequest(@NotBlank @Size(max = 60) String name, Boolean defaultModel, Boolean active, @Size(max = 200) String note,
                               List<@Valid RateInput> rates) {
    }

    public record VehicleRequest(@NotBlank @Size(max = 30) String number, @Size(max = 30) String kind, @NotNull @Positive Integer capacity,
                                 Long driverId, Boolean active, @Size(max = 200) String note, Boolean companyOwned) {
    }

    public record OrderInput(@NotNull Long id) {
    }

    /** A bank account, cash or a wallet of the brick business itself. */
    public record BookAccountRequest(@NotBlank @Size(max = 100) String name, @NotBlank String type, @Size(max = 100) String institution,
                                     @Size(max = 40) String accountNumber, @Size(max = 60) String upiId, @Size(max = 100) String holderName,
                                     @PositiveOrZero BigDecimal openingBalance, LocalDate openingDate) {
    }

    public record TransferRequest(@NotNull Long fromAccountId, @NotNull Long toAccountId, @NotNull @Positive BigDecimal amount,
                                  @NotNull LocalDate movedOn, @Size(max = 200) String note) {
    }

    // ------------------------------------------------------------------ views

    public record ModelView(BrickPricingModel model, Map<Long, BigDecimal> rates) {
    }

    /** Who the business's documents (bills, invoices, payment slips) are from, and who signs them. */
    public record Company(String name, String address, String phone, String upiId, String ownerName, String ownerSignature,
                          String accountantName, String accountantSignature,
                          /* the organization's logo (an address on this server; Settings → Organization), null: the drawn mark */
                          String logo) {
    }

    /** Bricks of a type: in the yard (ready or still curing), booked for orders, free to sell; produced and delivered so far. */
    public record TypeStock(Long brickTypeId, String name, String color, BigDecimal mrp, int opening, int produced, int damaged, int dispatched,
                            int delivered, int inYard, int curing, int ready, int booked, int available) {
    }

    /** A raw material's flow in one batch (or now): what there was, came in, was left and so was used. */
    public record MaterialFlow(Long materialId, String name, String unit, BigDecimal opening, BigDecimal received, BigDecimal closing,
                               BigDecimal consumed, boolean counted) {
    }

    public record MaterialStock(Long materialId, String name, String unit, BigDecimal stock, BigDecimal reorderLevel, BigDecimal lastRate,
                                BigDecimal avgDailyUse, Integer daysLeft, boolean low) {
    }

    /** A material whose kept balance differs from what its purchases and counts work out to (should never happen). */
    public record StockIssue(Long materialId, String name, String unit, BigDecimal kept, BigDecimal worked) {
    }

    public record BookAccount(Long id, String name, String role, AccountType type, AccountClass accountClass, BigDecimal balance,
                              boolean book, String institution, String accountNumber, String upiId, BigDecimal monthIn, BigDecimal monthOut, int entries) {
    }

    public record Meta(BrickSettings settings, List<BrickType> types, List<BrickMaterial> materials, List<ModelView> models,
                       List<BrickVehicle> vehicles, List<BrickResource> resources, List<String> expenseHeads, List<String> roles) {
    }

    // ------------------------------------------------------------------ wiring

    final BrickSettingsRepository settingsRepo;
    final com.aditya.personalbudget.repository.OrganizationRepository organizations;
    final BrickTypeRepository types;
    final BrickMaterialRepository materials;
    final BrickPricingModelRepository models;
    final BrickPricingRateRepository rates;
    final BrickResourceRepository resources;
    final BrickVehicleRepository vehicles;
    final BrickBatchRepository batches;
    final BrickBatchItemRepository batchItems;
    final BrickBatchMaterialRepository batchMaterials;
    final BrickMaterialPurchaseRepository purchases;
    final BrickExpenseRepository expenses;
    final BrickEarningRepository earnings;
    final BrickPaySlipRepository slips;
    final BrickAdvanceRecoveryRepository recoveries;
    final BrickOrderRepository orders;
    final BrickOrderItemRepository orderItems;
    final BrickTripRepository trips;
    final BrickTripItemRepository tripItems;
    final BrickPaymentRepository payments;
    final BrickOrderLinkRepository links;
    final AccountRepository accounts;
    final AccountService accountService;
    final LedgerService ledger;
    final ActivityService activity;
    final ReportService reports;
    final AppSettingsService appSettings;
    final com.aditya.personalbudget.repository.JournalEntryRepository entries;

    public BrickService(BrickSettingsRepository settingsRepo, BrickTypeRepository types, BrickMaterialRepository materials,
                        BrickPricingModelRepository models, BrickPricingRateRepository rates, BrickResourceRepository resources,
                        BrickVehicleRepository vehicles, BrickBatchRepository batches, BrickBatchItemRepository batchItems,
                        BrickBatchMaterialRepository batchMaterials, BrickMaterialPurchaseRepository purchases, BrickExpenseRepository expenses,
                        BrickEarningRepository earnings, BrickPaySlipRepository slips, BrickAdvanceRecoveryRepository recoveries,
                        BrickOrderRepository orders, BrickOrderItemRepository orderItems, BrickTripRepository trips,
                        BrickTripItemRepository tripItems, BrickPaymentRepository payments, BrickOrderLinkRepository links,
                        AccountRepository accounts, AccountService accountService, LedgerService ledger, ActivityService activity,
                        ReportService reports, AppSettingsService appSettings,
                        com.aditya.personalbudget.repository.JournalEntryRepository entries,
                        com.aditya.personalbudget.repository.OrganizationRepository organizations) {
        this.entries = entries;
        this.organizations = organizations;
        this.settingsRepo = settingsRepo;
        this.types = types;
        this.materials = materials;
        this.models = models;
        this.rates = rates;
        this.resources = resources;
        this.vehicles = vehicles;
        this.batches = batches;
        this.batchItems = batchItems;
        this.batchMaterials = batchMaterials;
        this.purchases = purchases;
        this.expenses = expenses;
        this.earnings = earnings;
        this.slips = slips;
        this.recoveries = recoveries;
        this.orders = orders;
        this.orderItems = orderItems;
        this.trips = trips;
        this.tripItems = tripItems;
        this.payments = payments;
        this.links = links;
        this.accounts = accounts;
        this.accountService = accountService;
        this.ledger = ledger;
        this.activity = activity;
        this.reports = reports;
        this.appSettings = appSettings;
    }


    // ------------------------------------------------------------------ for the other brick services (this bean is a proxy: its fields are read through methods)

    BrickSettingsRepository settingsRepo() {
        return settingsRepo;
    }

    BrickTypeRepository types() {
        return types;
    }

    BrickMaterialRepository materials() {
        return materials;
    }

    BrickPricingModelRepository models() {
        return models;
    }

    BrickPricingRateRepository rates() {
        return rates;
    }

    BrickResourceRepository resources() {
        return resources;
    }

    BrickVehicleRepository vehicles() {
        return vehicles;
    }

    BrickBatchRepository batches() {
        return batches;
    }

    BrickBatchItemRepository batchItems() {
        return batchItems;
    }

    BrickBatchMaterialRepository batchMaterials() {
        return batchMaterials;
    }

    BrickMaterialPurchaseRepository purchases() {
        return purchases;
    }

    BrickExpenseRepository expenses() {
        return expenses;
    }

    BrickEarningRepository earnings() {
        return earnings;
    }

    BrickPaySlipRepository slips() {
        return slips;
    }

    BrickAdvanceRecoveryRepository recoveries() {
        return recoveries;
    }

    BrickOrderRepository orders() {
        return orders;
    }

    BrickOrderItemRepository orderItems() {
        return orderItems;
    }

    BrickTripRepository trips() {
        return trips;
    }

    BrickTripItemRepository tripItems() {
        return tripItems;
    }

    BrickPaymentRepository payments() {
        return payments;
    }

    BrickOrderLinkRepository links() {
        return links;
    }

    AccountRepository accounts() {
        return accounts;
    }

    AccountService accountService() {
        return accountService;
    }

    LedgerService ledger() {
        return ledger;
    }

    ActivityService activity() {
        return activity;
    }

    ReportService reports() {
        return reports;
    }

    AppSettingsService appSettings() {
        return appSettings;
    }

    com.aditya.personalbudget.repository.JournalEntryRepository entries() {
        return entries;
    }

    // ================================================================== set-up

    /** Everything the forms offer (a read: the defaults are made by {@link #start()}). */
    public Meta meta() {
        Long t = UserContext.tenantId();
        List<BrickType> ts = sortedTypes(true);
        List<ModelView> ms = models.findByTenantId(t).stream().sorted(Comparator.comparing((BrickPricingModel m) -> !Boolean.TRUE.equals(m.getDefaultModel()))
                .thenComparing(BrickPricingModel::getId)).map(this::modelView).toList();
        BrickSettings s = settings();
        return new Meta(s, ts, materials.findByTenantId(t).stream().sorted(order(BrickMaterial::getSortOrder, BrickMaterial::getId)).toList(), ms,
                vehicles.findByTenantId(t).stream().sorted(Comparator.comparing(BrickVehicle::getId)).toList(),
                resources.findByTenantId(t).stream().sorted(Comparator.comparing((BrickResource r) -> !Boolean.TRUE.equals(r.getActive()))
                        .thenComparing(BrickResource::getName, String.CASE_INSENSITIVE_ORDER)).toList(),
                heads(s), RESOURCE_ROLES);
    }

    /** The first time the section is opened: the usual brick types, raw materials, a default pricing model, the settings, the cash. */
    @Transactional
    public Meta start() {
        ensureDefaults();
        return meta();
    }

    /** The first time: the usual brick types, raw materials, a default pricing model, the settings and the book's cash. */
    synchronized void ensureDefaults() {
        Long t = UserContext.tenantId();
        if (settingsRepo.findByTenantId(t).isEmpty()) {
            BrickSettings s = new BrickSettings();
            s.setTenantId(t);
            s.setExpenseHeads(String.join(",", DEFAULT_HEADS));
            s.setPayDay(6);
            s.setDeliveryChargePerTrip(Money.ZERO);
            s.setDriverIncentivePerTrip(Money.ZERO);
            s.setLoadingRate(Money.ZERO);
            s.setUnloadingRate(Money.ZERO);
            s.setBillHandling(false);
            settingsRepo.save(s);
        }
        if (types.findByTenantId(t).isEmpty()) {
            String[][] seed = {{"16X4X8 Dies", "#b4532a"}, {"16X4X8 Bricks", "#d9733f"}, {"12X6X8 Dies", "#7a5c3e"}, {"12X6X8 Bricks", "#a3876a"}};
            int i = 0;
            for (String[] x : seed) {
                BrickType b = new BrickType();
                b.setTenantId(t);
                b.setName(x[0]);
                b.setColor(x[1]);
                b.setCuringDays(14);
                b.setOpeningStock(0);
                b.setSortOrder(++i);
                b.setActive(true);
                b.setCreatedAt(LocalDateTime.now());
                types.save(b);
            }
        }
        if (materials.findByTenantId(t).isEmpty()) {
            String[][] seed = {{"6MM Gravel", "Ton"}, {"Robo Sand", "Ton"}, {"M-Sand", "Ton"}, {"20 MM Gravel", "Ton"}, {"Cement", "Bag"}};
            int i = 0;
            for (String[] x : seed) {
                BrickMaterial m = new BrickMaterial();
                m.setTenantId(t);
                m.setName(x[0]);
                m.setUnit(x[1]);
                m.setOpeningStock(BigDecimal.ZERO);
                m.setSortOrder(++i);
                m.setActive(true);
                m.setCreatedAt(LocalDateTime.now());
                materials.save(m);
            }
        }
        if (models.findByTenantId(t).isEmpty()) {
            BrickPricingModel m = new BrickPricingModel();
            m.setTenantId(t);
            m.setName("Standard rates");
            m.setDefaultModel(true);
            m.setActive(true);
            m.setNote("The rate a brick each production team is paid, unless a batch says otherwise");
            m.setCreatedAt(LocalDateTime.now());
            models.save(m);
        }
        account("CASH");
    }

    /** The settings; before the section was started, the defaults (not saved: reads never write). */
    BrickSettings settings() {
        return settingsRepo.findByTenantId(UserContext.tenantId()).stream().findFirst().orElseGet(() -> {
            BrickSettings s = new BrickSettings();
            s.setTenantId(UserContext.tenantId());
            s.setExpenseHeads(String.join(",", DEFAULT_HEADS));
            s.setPayDay(6);
            s.setDeliveryChargePerTrip(Money.ZERO);
            s.setDriverIncentivePerTrip(Money.ZERO);
            s.setLoadingRate(Money.ZERO);
            s.setUnloadingRate(Money.ZERO);
            s.setBillHandling(false);
            return s;
        });
    }

    /**
     * The business as its documents name it: the company name set for it (else the organization's company name, else
     * the organization's name), the organization's logo, the address and signatures.
     */
    Company company() {
        BrickSettings s = settings();
        com.aditya.personalbudget.domain.entity.Organization t = organizations.findById(s.getTenantId()).orElse(null);
        // the name set for the business, else the organization's company name (Settings → Organization), else its name
        String org = t != null && OrganizationBrandService.name(t) != null ? OrganizationBrandService.name(t)
                : UserContext.current().map(com.aditya.personalbudget.security.CurrentUser::tenantName).orElse("");
        return new Company(s.getCompanyName() != null ? s.getCompanyName() : org, s.getAddress(), s.getPhone(), s.getUpiId(), s.getOwnerName(),
                s.getOwnerSignature(), s.getAccountantName(), s.getAccountantSignature(), t == null ? null : OrganizationBrandService.logoUrl(t));
    }

    static List<String> heads(BrickSettings s) {
        if (s.getExpenseHeads() == null || s.getExpenseHeads().isBlank()) return DEFAULT_HEADS;
        return java.util.Arrays.stream(s.getExpenseHeads().split(",")).map(String::trim).filter(x -> !x.isEmpty()).toList();
    }

    /** Adds an expense head (kept for next time), when it is not there yet; gives the set-up with it. */
    @Transactional
    public Meta addExpenseHead(String name) {
        ensureDefaults();
        String head = name == null ? "" : name.trim().replace(",", " ").replaceAll("\s+", " ");
        if (head.isEmpty() || head.length() > 40) throw new BusinessException("A head of up to 40 letters");
        BrickSettings s = settings();
        List<String> hs = new ArrayList<>(heads(s));
        if (hs.stream().noneMatch(h -> h.equalsIgnoreCase(head))) {
            hs.add(head);
            s.setExpenseHeads(ActivityService.cut(String.join(",", hs), 600));
            settingsRepo.save(s);
            activity.record("ADDED", AREA, "Expense head " + head);
        }
        return meta();
    }

    @Transactional
    public Meta updateSettings(SettingsRequest r) {
        ensureDefaults();
        BrickSettings s = settings();
        s.setDeliveryChargePerTrip(Money.round(Money.nz(r.deliveryChargePerTrip())));
        s.setFreeDeliveryMinQty(r.freeDeliveryMinQty() == null || r.freeDeliveryMinQty() == 0 ? null : r.freeDeliveryMinQty());
        s.setDriverIncentivePerTrip(Money.round(Money.nz(r.driverIncentivePerTrip())));
        s.setLoadingRate(Money.nz(r.loadingRate()));
        s.setUnloadingRate(Money.nz(r.unloadingRate()));
        s.setBillHandling(Boolean.TRUE.equals(r.billHandling()));
        s.setUpiId(blank(r.upiId()));
        if (s.getUpiId() != null && !s.getUpiId().matches("[A-Za-z0-9._-]{2,}@[A-Za-z0-9.]{2,}")) {
            throw new BusinessException("That UPI ID does not look right (it is like name@okicici)");
        }
        s.setPayeeName(blank(r.payeeName()));
        s.setCompanyName(blank(r.companyName()));
        s.setAddress(blank(r.address()));
        s.setPhone(blank(r.phone()));
        s.setOwnerName(blank(r.ownerName()));
        s.setOwnerSignature(signature(r.ownerSignature()));
        s.setAccountantName(blank(r.accountantName()));
        s.setAccountantSignature(signature(r.accountantSignature()));
        if (r.expenseHeads() != null) {
            List<String> hs = r.expenseHeads().stream().map(String::trim).filter(x -> !x.isEmpty()).map(x -> x.replace(",", " ")).distinct().toList();
            if (hs.isEmpty()) throw new BusinessException("Keep at least one expense head");
            s.setExpenseHeads(ActivityService.cut(String.join(",", hs), 600));
        }
        s.setPayDay(r.payDay() == null ? 6 : r.payDay());
        s.setReceiptAccountId(r.receiptAccountId() == null ? null : requireMoneyAccount(r.receiptAccountId(), "Receive into").getId());
        s.setPayAccountId(r.payAccountId() == null ? null : requireMoneyAccount(r.payAccountId(), "Pay from").getId());
        settingsRepo.save(s);
        activity.record("CHANGED", AREA, "Changed the brick business settings");
        return meta();
    }

    static String signature(String s) {
        String v = blank(s);
        if (v == null) return null;
        if (!v.matches("[MLml0-9 .\\-]+")) throw new BusinessException("The signature could not be read; sign again");
        return v;
    }

    // ---------------------------------------------------------------- brick types

    @Transactional
    public Meta saveType(Long id, TypeRequest r) {
        ensureDefaults();
        Long t = UserContext.tenantId();
        BrickType b = id == null ? new BrickType() : requireType(id);
        String name = r.name().trim().replaceAll("\\s+", " ");
        if (types.findByTenantId(t).stream().anyMatch(x -> !x.getId().equals(b.getId()) && x.getName().equalsIgnoreCase(name))) {
            throw new BusinessException("There is already a brick type " + name);
        }
        if (id == null) {
            b.setTenantId(t);
            b.setCreatedAt(LocalDateTime.now());
            b.setSortOrder(types.findByTenantId(t).stream().map(BrickType::getSortOrder).filter(Objects::nonNull).max(Integer::compare).orElse(0) + 1);
        }
        b.setName(name);
        b.setMrp(r.mrp() == null ? null : r.mrp());
        b.setMinPrice(r.minPrice() == null || r.minPrice().signum() == 0 ? null : r.minPrice());
        b.setCuringDays(r.curingDays() == null ? 14 : r.curingDays());
        b.setOpeningStock(r.openingStock() == null ? 0 : r.openingStock());
        b.setColor(blank(r.color()) != null && r.color().matches("#[0-9a-fA-F]{6}") ? r.color() : b.getColor() != null ? b.getColor() : "#b4532a");
        b.setActive(r.active() == null || r.active());
        types.save(b);
        activity.record(id == null ? "ADDED" : "CHANGED", AREA, "Brick type " + name + (b.getMrp() != null ? " · MRP " + ActivityService.money(b.getMrp()) : ""));
        return meta();
    }

    @Transactional
    public Meta deleteType(Long id) {
        BrickType b = requireType(id);
        boolean used = batchItems.findByTenantId(b.getTenantId()).stream().anyMatch(x -> x.getBrickTypeId().equals(id))
                || orderItems.findByTenantId(b.getTenantId()).stream().anyMatch(x -> x.getBrickTypeId().equals(id));
        if (used) {
            b.setActive(false);
            types.save(b);
            activity.record("CHANGED", AREA, "Brick type " + b.getName() + " is no longer made (kept: batches or orders have it)");
        } else {
            rates.findByTenantId(b.getTenantId()).stream().filter(x -> x.getBrickTypeId().equals(id)).forEach(rates::delete);
            types.deleteById(id);
            activity.record("DELETED", AREA, "Brick type " + b.getName());
        }
        return meta();
    }

    // ---------------------------------------------------------------- raw materials

    @Transactional
    public Meta saveMaterial(Long id, MaterialRequest r) {
        ensureDefaults();
        Long t = UserContext.tenantId();
        BrickMaterial m = id == null ? new BrickMaterial() : requireMaterial(id);
        String name = r.name().trim().replaceAll("\\s+", " ");
        if (materials.findByTenantId(t).stream().anyMatch(x -> !x.getId().equals(m.getId()) && x.getName().equalsIgnoreCase(name))) {
            throw new BusinessException("There is already a raw material " + name);
        }
        if (id == null) {
            m.setTenantId(t);
            m.setCreatedAt(LocalDateTime.now());
            m.setSortOrder(materials.findByTenantId(t).stream().map(BrickMaterial::getSortOrder).filter(Objects::nonNull).max(Integer::compare).orElse(0) + 1);
        }
        m.setName(name);
        m.setUnit(r.unit().trim());
        m.setOpeningStock(Money.nz(r.openingStock()).compareTo(BigDecimal.ZERO) == 0 ? BigDecimal.ZERO : r.openingStock());
        m.setReorderLevel(r.reorderLevel());
        m.setActive(r.active() == null || r.active());
        materials.save(m);
        refreshMaterialStock();
        activity.record(id == null ? "ADDED" : "CHANGED", AREA, "Raw material " + name + " (" + m.getUnit() + ")");
        return meta();
    }

    @Transactional
    public Meta deleteMaterial(Long id) {
        BrickMaterial m = requireMaterial(id);
        boolean used = purchases.findByTenantId(m.getTenantId()).stream().anyMatch(x -> x.getMaterialId().equals(id))
                || batchMaterials.findByTenantId(m.getTenantId()).stream().anyMatch(x -> x.getMaterialId().equals(id));
        if (used) {
            m.setActive(false);
            materials.save(m);
        } else {
            materials.deleteById(id);
        }
        activity.record(used ? "CHANGED" : "DELETED", AREA, "Raw material " + m.getName() + (used ? " is no longer used" : ""));
        return meta();
    }

    // ---------------------------------------------------------------- pricing models

    @Transactional
    public Meta saveModel(Long id, ModelRequest r) {
        ensureDefaults();
        Long t = UserContext.tenantId();
        BrickPricingModel m = id == null ? new BrickPricingModel() : requireModel(id);
        String name = r.name().trim();
        if (models.findByTenantId(t).stream().anyMatch(x -> !x.getId().equals(m.getId()) && x.getName().equalsIgnoreCase(name))) {
            throw new BusinessException("There is already a pricing model " + name);
        }
        if (id == null) {
            m.setTenantId(t);
            m.setCreatedAt(LocalDateTime.now());
        }
        m.setName(name);
        m.setNote(blank(r.note()));
        m.setActive(r.active() == null || r.active());
        boolean makeDefault = Boolean.TRUE.equals(r.defaultModel()) || models.findByTenantId(t).stream().noneMatch(x -> Boolean.TRUE.equals(x.getDefaultModel())
                && !x.getId().equals(m.getId()));
        if (makeDefault && !m.getActive()) throw new BusinessException("The default pricing model must be in use");
        m.setDefaultModel(makeDefault);
        BrickPricingModel saved = models.save(m);
        if (makeDefault) {
            models.findByTenantId(t).stream().filter(x -> !x.getId().equals(saved.getId()) && Boolean.TRUE.equals(x.getDefaultModel())).forEach(x -> {
                x.setDefaultModel(false);
                models.save(x);
            });
        }
        if (r.rates() != null) {
            Map<Long, BrickPricingRate> have = rates.findByModelId(saved.getId()).stream().collect(Collectors.toMap(BrickPricingRate::getBrickTypeId, Function.identity(), (a, b) -> a));
            for (RateInput x : r.rates()) {
                requireType(x.brickTypeId());
                BrickPricingRate rate = have.getOrDefault(x.brickTypeId(), new BrickPricingRate());
                rate.setTenantId(t);
                rate.setModelId(saved.getId());
                rate.setBrickTypeId(x.brickTypeId());
                rate.setRate(x.rate());
                rates.save(rate);
            }
        }
        activity.record(id == null ? "ADDED" : "CHANGED", AREA, "Pricing model " + name + (makeDefault ? " (default)" : ""));
        return meta();
    }

    @Transactional
    public Meta deleteModel(Long id) {
        BrickPricingModel m = requireModel(id);
        if (Boolean.TRUE.equals(m.getDefaultModel())) throw new BusinessException("Make another model the default first");
        if (batches.findByTenantId(m.getTenantId()).stream().anyMatch(b -> id.equals(b.getPricingModelId()))) {
            m.setActive(false);
            models.save(m);
        } else {
            rates.findByModelId(id).forEach(rates::delete);
            models.deleteById(id);
        }
        activity.record("DELETED", AREA, "Pricing model " + m.getName());
        return meta();
    }

    ModelView modelView(BrickPricingModel m) {
        return new ModelView(m, rates.findByModelId(m.getId()).stream().collect(Collectors.toMap(BrickPricingRate::getBrickTypeId, BrickPricingRate::getRate, (a, b) -> a)));
    }

    BrickPricingModel defaultModel() {
        ensureDefaults();
        return models.findByTenantId(UserContext.tenantId()).stream().filter(m -> Boolean.TRUE.equals(m.getDefaultModel())).findFirst()
                .orElseGet(() -> models.findByTenantId(UserContext.tenantId()).getFirst());
    }

    // ---------------------------------------------------------------- vehicles

    @Transactional
    public Meta saveVehicle(Long id, VehicleRequest r) {
        ensureDefaults();
        Long t = UserContext.tenantId();
        BrickVehicle v = id == null ? new BrickVehicle() : requireVehicle(id);
        String number = r.number().trim().toUpperCase().replaceAll("\\s+", " ");
        if (vehicles.findByTenantId(t).stream().anyMatch(x -> !x.getId().equals(v.getId()) && x.getNumber().equalsIgnoreCase(number))) {
            throw new BusinessException("There is already a vehicle " + number);
        }
        if (id == null) {
            v.setTenantId(t);
            v.setCreatedAt(LocalDateTime.now());
        }
        v.setNumber(number);
        v.setKind(blank(r.kind()));
        v.setCapacity(r.capacity());
        v.setDriverId(r.driverId() == null ? null : requireResource(r.driverId()).getId());
        v.setActive(r.active() == null || r.active());
        v.setNote(blank(r.note()));
        v.setCompanyOwned(r.companyOwned() == null || r.companyOwned());
        vehicles.save(v);
        activity.record(id == null ? "ADDED" : "CHANGED", AREA, "Vehicle " + number + " · " + r.capacity() + " bricks a trip");
        return meta();
    }

    @Transactional
    public Meta deleteVehicle(Long id) {
        BrickVehicle v = requireVehicle(id);
        if (trips.findByTenantId(v.getTenantId()).stream().anyMatch(x -> id.equals(x.getVehicleId()))
                || orders.findByTenantId(v.getTenantId()).stream().anyMatch(x -> id.equals(x.getVehicleId()))) {
            v.setActive(false);
            vehicles.save(v);
        } else {
            vehicles.deleteById(id);
        }
        activity.record("DELETED", AREA, "Vehicle " + v.getNumber());
        return meta();
    }

    // ================================================================== the brick book

    /** The brick book's account for a role, made on first use. */
    Account account(String role) {
        Long t = UserContext.tenantId();
        return accounts.findByTenantId(t).stream().filter(a -> a.isBrickBook() && role.equals(a.getBrickRole())).findFirst().orElseGet(() -> {
            Object[] def = ROLES.get(role);
            if (def == null) throw new IllegalArgumentException(role);
            Account a = accountService.createInternal(uniqueName((String) def[0]), (AccountType) def[1], ActivityService.cut(def[2] + " (Brick Management)", 255), true);
            a.setBrickBook(true);
            a.setBrickRole(role);
            return accounts.save(a);
        });
    }

    /** Where money of the brick business comes in or goes out: the book's cash, bank or wallet, or one of my own. */
    Account requireMoneyAccount(Long accountId, String what) {
        Account a = accountService.require(accountId);
        if (a.getAccountClass() != AccountClass.ASSET || !a.getAccountType().isLiquid()) {
            throw new BusinessException(what + ": pick a cash, bank or wallet account (" + a.getName() + " is a " + a.getAccountType().getLabel() + ")");
        }
        if (!Boolean.TRUE.equals(a.getActive())) throw new BusinessException(a.getName() + " is inactive");
        if (a.isChitBook()) throw new BusinessException(a.getName() + " holds chit members' money; pick another account");
        if (a.isProjectBook()) throw new BusinessException(a.getName() + " is the construction business's; pick another account");
        return a;
    }

    /** The account to use when none is picked: the one set in the settings, else the book's cash. */
    Long moneyAccountOr(Long picked, boolean receipt) {
        if (picked != null) return requireMoneyAccount(picked, receipt ? "Received into" : "Paid from").getId();
        BrickSettings s = settings();
        Long set = receipt ? s.getReceiptAccountId() : s.getPayAccountId();
        return set != null ? set : account("CASH").getId();
    }

    JournalEntry post(JournalDraft d) {
        return ledger.post(d);
    }

    /** Takes an entry off the books (when it is still there). */
    void unpost(Long entryId) {
        if (entryId == null || entries.findByIdAndTenantId(entryId, UserContext.tenantId()).isEmpty()) return;
        ledger.delete(entryId);
    }

    String uniqueName(String name) {
        Set<String> taken = accounts.findByTenantId(UserContext.tenantId()).stream().map(a -> a.getName().toLowerCase()).collect(Collectors.toSet());
        if (!taken.contains(name.toLowerCase())) return name;
        for (int i = 2; ; i++) {
            String next = ActivityService.cut(name, 95) + " (" + i + ")";
            if (!taken.contains(next.toLowerCase())) return next;
        }
    }

    /** Brick › Accounts: the book's accounts and my own accounts brick money went through, with balances. */
    public List<BookAccount> book() {
        Long t = UserContext.tenantId();
        LedgerSnapshot snap = ledger.snapshot();
        Map<Long, BigDecimal> bal = snap.balancesAsOf(FOREVER);
        Set<Long> brickEntries = snap.lines().stream().map(LedgerSnapshot.PostedLine::entryId).collect(Collectors.toSet());
        Map<Long, BrickTagService.BrickTag> tags = ledger.brickTags().forEntryIds(brickEntries);
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        Map<Long, BigDecimal[]> month = new HashMap<>();
        Map<Long, Integer> count = new HashMap<>();
        for (LedgerSnapshot.PostedLine l : snap.lines()) {
            if (!tags.containsKey(l.entryId())) continue;
            count.merge(l.accountId(), 1, Integer::sum);
            if (!l.date().isBefore(monthStart)) {
                BigDecimal[] m = month.computeIfAbsent(l.accountId(), k -> new BigDecimal[]{Money.ZERO, Money.ZERO});
                m[0] = m[0].add(l.debit());
                m[1] = m[1].add(l.credit());
            }
        }
        List<String> order = new ArrayList<>(ROLES.keySet());
        order.add(1, "BANK");
        List<BookAccount> out = new ArrayList<>();
        for (Account a : accounts.findByTenantId(t)) {
            boolean own = a.isBrickBook();
            boolean personal = !own && a.isLiquid() && count.containsKey(a.getId());
            if (!own && !personal) continue;
            BigDecimal[] m = month.getOrDefault(a.getId(), new BigDecimal[]{Money.ZERO, Money.ZERO});
            boolean debitNormal = a.getAccountClass() == AccountClass.ASSET || a.getAccountClass() == AccountClass.EXPENSE;
            out.add(new BookAccount(a.getId(), a.getName(), own ? a.getBrickRole() : "PERSONAL", a.getAccountType(), a.getAccountClass(),
                    Money.nz(bal.get(a.getId())), own, a.getInstitution(), a.getAccountNumber(), a.getUpiId(),
                    debitNormal ? m[0] : m[1], debitNormal ? m[1] : m[0], count.getOrDefault(a.getId(), 0)));
        }
        out.sort(Comparator.comparing((BookAccount a) -> a.book() ? 0 : 1)
                .thenComparing(a -> { int i = order.indexOf(a.role()); return i < 0 ? 99 : i; }).thenComparing(BookAccount::id));
        return out;
    }

    @Transactional
    public List<BookAccount> addBookAccount(BookAccountRequest r) {
        ensureDefaults();
        AccountType type = switch (r.type().trim().toUpperCase()) {
            case "BANK" -> AccountType.BANK;
            case "CASH" -> AccountType.CASH;
            case "WALLET" -> AccountType.WALLET;
            default -> throw new BusinessException("A bank account, cash or a wallet");
        };
        Account a = accountService.createInternal(uniqueName(r.name().trim()), type, "An account of the brick business", false);
        a.setBrickBook(true);
        a.setBrickRole(type == AccountType.CASH ? "CASH" : "BANK");
        a.setInstitution(blank(r.institution()));
        a.setAccountNumber(blank(r.accountNumber()));
        a.setUpiId(blank(r.upiId()));
        a.setHolderName(blank(r.holderName()));
        a = accounts.save(a);
        if (Money.nz(r.openingBalance()).signum() > 0) {
            LocalDate on = r.openingDate() != null ? r.openingDate() : LocalDate.now();
            Account equity = ledger.systemAccount(DefaultChartOfAccounts.OPENING_BALANCE_EQUITY);
            post(JournalDraft.of(on, VoucherType.OPENING, "Opening balance - " + a.getName())
                    .debit(a.getId(), Money.round(r.openingBalance())).credit(equity.getId(), Money.round(r.openingBalance()))
                    .source(LedgerService.SOURCE_ACCOUNT_OPENING, a.getId()));
            a.setOpeningBalance(Money.round(r.openingBalance()));
            a.setOpeningDate(on);
            accounts.save(a);
        }
        activity.record("ADDED", AREA, "Brick business account " + a.getName());
        return book();
    }

    @Transactional
    public List<BookAccount> transfer(TransferRequest r) {
        Account from = requireMoneyAccount(r.fromAccountId(), "From");
        Account to = requireMoneyAccount(r.toAccountId(), "To");
        if (from.getId().equals(to.getId())) throw new BusinessException("Pick two different accounts");
        if (!from.isBrickBook() && !to.isBrickBook()) throw new BusinessException("One side must be an account of the brick business");
        JournalEntry e = post(JournalDraft.of(r.movedOn(), VoucherType.TRANSFER, "Moved money · " + from.getName() + " → " + to.getName()
                        + (blank(r.note()) != null ? " · " + r.note().trim() : ""))
                .debit(to.getId(), Money.round(r.amount())).credit(from.getId(), Money.round(r.amount())).source(SOURCE_TRANSFER, null));
        activity.record("ADDED", AREA, "Moved " + ActivityService.money(r.amount()) + " · " + from.getName() + " → " + to.getName() + " · " + e.getEntryNo());
        return book();
    }

    /** An account's statement: all of a brick book account; of my own account, only what the brick business moved. */
    public AccountLedger statement(Long accountId, LocalDate from, LocalDate to) {
        Account a = accountService.require(accountId);
        AccountLedger full = reports.accountLedger(accountId, from, to);
        if (a.isBrickBook()) return full;
        List<LedgerRow> mine = full.rows().stream().filter(r -> r.brick() != null).toList();
        BigDecimal running = Money.ZERO, dr = Money.ZERO, cr = Money.ZERO;
        LedgerSnapshot snap = ledger.snapshot();
        List<LedgerRow> rows = new ArrayList<>();
        for (LedgerRow r : mine) {
            running = running.add(snap.natural(accountId, r.debit().subtract(r.credit())));
            dr = dr.add(r.debit());
            cr = cr.add(r.credit());
            rows.add(new LedgerRow(r.entryId(), r.entryNo(), r.date(), r.voucherType(), r.voucherLabel(), r.narration(), r.counterAccounts(),
                    r.debit(), r.credit(), running, r.chitTrail(), r.construction(), r.brick()));
        }
        return new AccountLedger(full.accountId(), full.code(), full.name(), full.accountClass(), from, to, Money.ZERO, dr, cr, running, rows);
    }

    // ================================================================== stock

    /** Bricks by type: produced less damaged, less what left the yard; what open orders still need; what is still curing. */
    public List<TypeStock> brickStock() {
        Long t = UserContext.tenantId();
        LocalDate today = LocalDate.now();
        Map<Long, BrickBatch> batchById = batches.findByTenantId(t).stream().collect(Collectors.toMap(BrickBatch::getId, Function.identity()));
        Map<Long, BrickTrip> tripById = trips.findByTenantId(t).stream().collect(Collectors.toMap(BrickTrip::getId, Function.identity()));
        Map<Long, BrickOrder> orderById = orders.findByTenantId(t).stream().collect(Collectors.toMap(BrickOrder::getId, Function.identity()));
        Map<Long, int[]> f = new HashMap<>();   // produced, damaged, curing, dispatched, delivered, booked
        for (BrickBatchItem i : batchItems.findByTenantId(t)) {
            BrickBatch b = batchById.get(i.getBatchId());
            if (b == null) continue;
            int[] x = f.computeIfAbsent(i.getBrickTypeId(), k -> new int[6]);
            int good = i.getQuantity() - nz(i.getDamaged());
            x[0] += i.getQuantity();
            x[1] += nz(i.getDamaged());
            BrickType type = types.findById(i.getBrickTypeId()).orElse(null);
            int cure = type == null || type.getCuringDays() == null ? 0 : type.getCuringDays();
            if (b.getProducedOn().plusDays(cure).isAfter(today)) x[2] += good;
        }
        Map<Long, Map<Long, Integer>> leftByOrder = new HashMap<>();   // order -> type -> loaded so far
        for (BrickTripItem i : tripItems.findByTenantId(t)) {
            BrickTrip trip = tripById.get(i.getTripId());
            if (trip == null || !BrickSalesService.LEFT_YARD.contains(trip.getStatus())) continue;
            int[] x = f.computeIfAbsent(i.getBrickTypeId(), k -> new int[6]);
            x[3] += i.getQuantity();
            if (BrickSalesService.DELIVERED.equals(trip.getStatus())) x[4] += i.getDelivered() == null ? i.getQuantity() : i.getDelivered();
            leftByOrder.computeIfAbsent(trip.getOrderId(), k -> new HashMap<>()).merge(i.getBrickTypeId(), i.getQuantity(), Integer::sum);
        }
        for (BrickOrderItem i : orderItems.findByTenantId(t)) {
            BrickOrder o = orderById.get(i.getOrderId());
            if (o == null || BrickSalesService.CANCELLED.equals(o.getStatus()) || BrickSalesService.DELIVERED.equals(o.getStatus())) continue;
            int left = leftByOrder.getOrDefault(o.getId(), Map.of()).getOrDefault(i.getBrickTypeId(), 0);
            f.computeIfAbsent(i.getBrickTypeId(), k -> new int[6])[5] += Math.max(0, i.getQuantity() - left);
        }
        List<TypeStock> out = new ArrayList<>();
        for (BrickType b : sortedTypes(true)) {
            int[] x = f.getOrDefault(b.getId(), new int[6]);
            if (!Boolean.TRUE.equals(b.getActive()) && x[0] == 0 && x[5] == 0) continue;
            int opening = nz(b.getOpeningStock());
            int inYard = opening + x[0] - x[1] - x[3];
            int ready = Math.max(0, inYard - x[2]);
            out.add(new TypeStock(b.getId(), b.getName(), b.getColor(), b.getMrp(), opening, x[0], x[1], x[3], x[4], inYard, Math.min(x[2], Math.max(inYard, 0)),
                    ready, x[5], inYard - x[5]));
        }
        return out;
    }

    /** The batches in production order (date, then as recorded). */
    List<BrickBatch> batchesInOrder() {
        return batches.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(BrickBatch::getProducedOn).thenComparing(BrickBatch::getId)).toList();
    }

    /**
     * Raw material through the batches: each batch's opening is the batch before's closing (the first's is the material's
     * opening stock); it received the purchases that were in the yard when its count was taken (recorded before the count,
     * whatever their date), and used what is no longer there. A purchase recorded after a count was not in it: it goes to
     * the next batch counted after it, or (none yet) adds to the stock now. What a count worked out is kept with it
     * ({@link #keepCounts}) and read back as kept. {@code virtual} is a batch
     * being entered (or changed): its date, id (null: a new one) and the closing counts typed (counted now).
     * Returns batch id → flows (the virtual batch under {@code Long.MAX_VALUE} when new).
     */
    Map<Long, List<MaterialFlow>> materialFlows(LocalDate virtualDate, Long virtualId, Map<Long, BigDecimal> virtualClosing) {
        return materialLedger(virtualDate, virtualId, virtualClosing).flows();
    }

    /** The flows batch by batch, and per material what was bought and is not in any batch's count yet (it adds to the stock). */
    record MaterialLedger(Map<Long, List<MaterialFlow>> flows, Map<Long, BigDecimal> notYetCounted) {
    }

    MaterialLedger materialLedger(LocalDate virtualDate, Long virtualId, Map<Long, BigDecimal> virtualClosing) {
        return materialLedger(virtualDate, virtualId, virtualClosing, true);
    }

    /**
     * {@code kept}: a count's flow is the one kept when it was taken (the batch being entered is worked out); false: every
     * flow worked out from the records, to check the kept ones against.
     */
    private MaterialLedger materialLedger(LocalDate virtualDate, Long virtualId, Map<Long, BigDecimal> virtualClosing, boolean kept) {
        Long t = UserContext.tenantId();
        List<BrickBatch> list = new ArrayList<>(batchesInOrder());
        long vid = virtualId == null ? Long.MAX_VALUE : virtualId;
        if (virtualDate != null) {
            // a batch being changed keeps the time it was recorded; a new one is recorded now
            LocalDateTime recorded = list.stream().filter(b -> b.getId().equals(virtualId)).map(BrickBatch::getCreatedAt).findFirst().orElse(LocalDateTime.now());
            list.removeIf(b -> b.getId().equals(virtualId));
            BrickBatch v = new BrickBatch();
            v.setId(vid);
            v.setProducedOn(virtualDate);
            v.setCreatedAt(recorded);
            list.add(v);
            list.sort(Comparator.comparing(BrickBatch::getProducedOn).thenComparing(BrickBatch::getId));
        }
        Map<Long, Map<Long, BrickBatchMaterial>> counts = new HashMap<>();
        for (BrickBatchMaterial m : batchMaterials.findByTenantId(t)) {
            counts.computeIfAbsent(m.getBatchId(), k -> new HashMap<>()).put(m.getMaterialId(), m);
        }
        LocalDateTime now = LocalDateTime.now();
        if (virtualDate != null) {
            Map<Long, BrickBatchMaterial> typed = new HashMap<>();
            Map<Long, BrickBatchMaterial> before = counts.getOrDefault(vid, Map.of());
            (virtualClosing == null ? Map.<Long, BigDecimal>of() : virtualClosing).forEach((id, close) -> {
                BrickBatchMaterial x = new BrickBatchMaterial();
                x.setMaterialId(id);
                x.setClosing(close);
                // a count being corrected keeps the time it was taken; a new one is taken now
                x.setCountedAt(before.containsKey(id) && before.get(id).getCountedAt() != null ? before.get(id).getCountedAt() : now);
                typed.put(id, x);
            });
            counts.put(vid, typed);
        }
        Map<Long, LocalDateTime> batchTime = new HashMap<>();
        list.forEach(b -> batchTime.put(b.getId(), b.getCreatedAt()));
        List<BrickMaterial> ms = materials.findByTenantId(t).stream().sorted(order(BrickMaterial::getSortOrder, BrickMaterial::getId)).toList();
        // each material's purchases, earliest first; each is taken once, by the first batch whose count it was in
        Map<Long, List<BrickMaterialPurchase>> waiting = new HashMap<>();
        purchases.findByTenantId(t).stream()
                .sorted(Comparator.comparing(BrickMaterialPurchase::getReceivedOn).thenComparing(p -> p.getCreatedAt() == null ? LocalDateTime.MIN : p.getCreatedAt()))
                .forEach(p -> waiting.computeIfAbsent(p.getMaterialId(), k -> new ArrayList<>()).add(p));
        Map<Long, List<MaterialFlow>> out = new LinkedHashMap<>();
        Map<Long, BigDecimal> prevClose = new HashMap<>();
        for (BrickBatch b : list) {
            List<MaterialFlow> flows = new ArrayList<>();
            for (BrickMaterial m : ms) {
                BigDecimal opening = prevClose.getOrDefault(m.getId(), Money.nz(m.getOpeningStock()));
                BrickBatchMaterial count = counts.getOrDefault(b.getId(), Map.of()).get(m.getId());
                // the stock as it stood when the yard was counted (the count's own time, else when the batch was recorded): every
                // purchase recorded by then, whatever its date. A purchase from before times were kept goes by its date.
                LocalDateTime countedAt = count != null && count.getCountedAt() != null ? count.getCountedAt() : batchTime.get(b.getId());
                List<BrickMaterialPurchase> mine = waiting.getOrDefault(m.getId(), new ArrayList<>());
                List<BrickMaterialPurchase> in = mine.stream().filter(p -> countedAt != null && p.getCreatedAt() != null
                        ? !p.getCreatedAt().isAfter(countedAt) : !p.getReceivedOn().isAfter(b.getProducedOn())).toList();
                BigDecimal received = in.stream().map(BrickMaterialPurchase::getQuantity).reduce(BigDecimal.ZERO, BigDecimal::add);
                mine.removeAll(in);
                BigDecimal close = count != null ? count.getClosing() : opening.add(received);
                if (kept && count != null && count.getConsumed() != null && b.getId() != vid) {
                    // as it stood when counted
                    flows.add(new MaterialFlow(m.getId(), m.getName(), m.getUnit(), count.getOpening(), count.getReceived(), close, count.getConsumed(), true));
                } else {
                    flows.add(new MaterialFlow(m.getId(), m.getName(), m.getUnit(), opening, received, close, opening.add(received).subtract(close), count != null));
                }
                prevClose.put(m.getId(), close);
            }
            out.put(b.getId(), flows);
        }
        Map<Long, BigDecimal> left = new HashMap<>();
        waiting.forEach((id, ps) -> left.put(id, ps.stream().map(BrickMaterialPurchase::getQuantity).reduce(BigDecimal.ZERO, BigDecimal::add)));
        return new MaterialLedger(out, left);
    }

    /** What every material's purchases and counts work out to now: the last count, plus what was bought and not counted since. */
    Map<Long, BigDecimal> workedOutStock() {
        Long t = UserContext.tenantId();
        MaterialLedger ledger = materialLedger(null, null, null);
        Map<Long, BigDecimal> stock = new HashMap<>();
        for (BrickBatch b : batchesInOrder()) {
            for (MaterialFlow f : ledger.flows().getOrDefault(b.getId(), List.of())) stock.put(f.materialId(), f.closing());
        }
        Map<Long, BigDecimal> out = new HashMap<>();
        for (BrickMaterial m : materials.findByTenantId(t)) {
            out.put(m.getId(), stock.getOrDefault(m.getId(), Money.nz(m.getOpeningStock())).add(ledger.notYetCounted().getOrDefault(m.getId(), BigDecimal.ZERO)));
        }
        return out;
    }

    /**
     * Keeps each count's flow as the stock stood when it was taken. The last batch's (the only one that can still change) is
     * worked out again; a closed batch's must come out as it was kept: a change that would alter it (a purchase it took in
     * changed or deleted, an opening stock changed) is refused. Counts from before flows were kept get theirs now.
     */
    void keepCounts() {
        List<BrickBatch> order = batchesInOrder();
        if (order.isEmpty()) return;
        Long last = order.get(order.size() - 1).getId();
        Map<Long, List<MaterialFlow>> worked = materialLedger(null, null, null, false).flows();
        for (BrickBatchMaterial c : batchMaterials.findByTenantId(UserContext.tenantId())) {
            MaterialFlow f = worked.getOrDefault(c.getBatchId(), List.of()).stream().filter(x -> x.materialId().equals(c.getMaterialId())).findFirst().orElse(null);
            if (f == null) continue;
            boolean same = c.getConsumed() != null && c.getOpening().compareTo(f.opening()) == 0 && c.getReceived().compareTo(f.received()) == 0
                    && c.getConsumed().compareTo(f.consumed()) == 0;
            if (same) continue;
            if (c.getConsumed() != null && !c.getBatchId().equals(last)) {
                String no = batches.findById(c.getBatchId()).map(BrickBatch::getBatchNo).orElse("a batch");
                throw new BusinessException("Batch " + no + " is closed and this would change its " + f.name() + " (it took in " + plain(c.getReceived())
                        + " " + f.unit() + " and used " + plain(c.getConsumed()) + "; it would be " + plain(f.received()) + " in and " + plain(f.consumed())
                        + " used). Only the last batch and what came after it can change");
            }
            c.setOpening(f.opening());
            c.setReceived(f.received());
            c.setConsumed(f.consumed());
            batchMaterials.save(c);
        }
    }

    private static String plain(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }

    /**
     * Brings every material's kept balance up to date. Called inside the transaction of each change that moves raw material
     * (a purchase saved or deleted, a batch counted, changed or deleted, a material's opening stock changed), so the balance
     * read everywhere is always the one the records give. Returns the materials whose balance changed.
     */
    @Transactional
    public int refreshMaterialStock() {
        keepCounts();
        Map<Long, BigDecimal> worked = workedOutStock();
        int changed = 0;
        for (BrickMaterial m : materials.findByTenantId(UserContext.tenantId())) {
            BigDecimal now = worked.getOrDefault(m.getId(), BigDecimal.ZERO).stripTrailingZeros();
            if (m.getCurrentStock() == null || m.getCurrentStock().compareTo(now) != 0) {
                m.setCurrentStock(now.scale() < 0 ? now.setScale(0) : now);
                m.setStockUpdatedAt(LocalDateTime.now());
                materials.save(m);
                changed++;
            }
        }
        return changed;
    }

    /** Materials whose kept balance does not match their records (one never kept yet is shown worked out, so it is not off). */
    public List<StockIssue> stockIssues() {
        Map<Long, BigDecimal> worked = workedOutStock();
        return materials.findByTenantId(UserContext.tenantId()).stream()
                .filter(m -> m.getCurrentStock() != null && m.getCurrentStock().compareTo(worked.getOrDefault(m.getId(), BigDecimal.ZERO)) != 0)
                .map(m -> new StockIssue(m.getId(), m.getName(), m.getUnit(), m.getCurrentStock(), worked.getOrDefault(m.getId(), BigDecimal.ZERO))).toList();
    }

    /** Raw material in the yard now (the kept balance), how fast it goes (over the last 30 days of batches) and so how many days it lasts. */
    public List<MaterialStock> materialStock() {
        Long t = UserContext.tenantId();
        MaterialLedger ledger = materialLedger(null, null, null);
        Map<Long, List<MaterialFlow>> flows = ledger.flows();
        List<BrickBatch> list = batchesInOrder();
        Map<Long, BigDecimal> stock = new HashMap<>();
        Map<Long, BigDecimal> used = new HashMap<>();
        LocalDate since = LocalDate.now().minusDays(30);
        for (BrickBatch b : list) {
            for (MaterialFlow f : flows.getOrDefault(b.getId(), List.of())) {
                stock.put(f.materialId(), f.closing());
                if (!b.getProducedOn().isBefore(since)) used.merge(f.materialId(), f.consumed().max(BigDecimal.ZERO), BigDecimal::add);
            }
        }
        List<MaterialStock> out = new ArrayList<>();
        for (BrickMaterial m : materials.findByTenantId(t).stream().sorted(order(BrickMaterial::getSortOrder, BrickMaterial::getId)).toList()) {
            // the kept balance; one never kept yet (older data): the last batch's closing, plus what was bought and not counted since
            BigDecimal now = m.getCurrentStock() != null ? m.getCurrentStock()
                    : stock.getOrDefault(m.getId(), Money.nz(m.getOpeningStock())).add(ledger.notYetCounted().getOrDefault(m.getId(), BigDecimal.ZERO));
            if (!Boolean.TRUE.equals(m.getActive()) && now.signum() == 0) continue;
            BigDecimal daily = used.getOrDefault(m.getId(), BigDecimal.ZERO).divide(BigDecimal.valueOf(30), 3, java.math.RoundingMode.HALF_UP);
            Integer days = daily.signum() > 0 ? now.max(BigDecimal.ZERO).divide(daily, 0, java.math.RoundingMode.DOWN).intValue() : null;
            boolean low = m.getReorderLevel() != null && now.compareTo(m.getReorderLevel()) <= 0 || days != null && days <= 3;
            out.add(new MaterialStock(m.getId(), m.getName(), m.getUnit(), now, m.getReorderLevel(), m.getLastRate(), daily, days, low));
        }
        return out;
    }

    // ================================================================== helpers

    List<BrickType> sortedTypes(boolean all) {
        return types.findByTenantId(UserContext.tenantId()).stream().filter(x -> all || Boolean.TRUE.equals(x.getActive()))
                .sorted(order(BrickType::getSortOrder, BrickType::getId)).toList();
    }

    /** Order lines in the brick types' order. */
    List<BrickOrderItem> sortedItems(List<BrickOrderItem> items) {
        Map<Long, Integer> pos = new HashMap<>();
        List<BrickType> all = sortedTypes(true);
        for (int i = 0; i < all.size(); i++) pos.put(all.get(i).getId(), i);
        return items.stream().sorted(Comparator.comparing((BrickOrderItem i) -> pos.getOrDefault(i.getBrickTypeId(), 999))).toList();
    }

    static <T> Comparator<T> order(Function<T, Integer> sort, Function<T, Long> id) {
        return Comparator.comparing((T x) -> sort.apply(x) == null ? Integer.MAX_VALUE : sort.apply(x)).thenComparing(id);
    }

    BrickType requireType(Long id) {
        return types.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Brick type", id));
    }

    BrickMaterial requireMaterial(Long id) {
        return materials.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Raw material", id));
    }

    BrickPricingModel requireModel(Long id) {
        return models.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Pricing model", id));
    }

    BrickVehicle requireVehicle(Long id) {
        return vehicles.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Vehicle", id));
    }

    /**
     * The team a job starts with: the active team of that role marked the default, else the only one there is.
     * {@code role} is LOADING_TEAM (loads and unloads our vehicles) or PRODUCTION (makes the bricks, loads hired vehicles).
     */
    Long defaultTeam(String role) {
        List<BrickResource> teams = resources.findByTenantId(UserContext.tenantId()).stream()
                .filter(r -> Boolean.TRUE.equals(r.getActive()) && r.getRole() != null && r.getRole().contains(role)).toList();
        return teams.stream().filter(r -> Boolean.TRUE.equals(r.getDefaultTeam())).findFirst()
                .or(() -> teams.size() == 1 ? java.util.Optional.of(teams.get(0)) : java.util.Optional.empty())
                .map(BrickResource::getId).orElse(null);
    }

    /** A line in the activity log, under Brick Management. */
    public void note(String action, String text) {
        activity.record(action, AREA, text);
    }

    BrickResource requireResource(Long id) {
        return resources.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Resource", id));
    }

    String typeName(Long id) {
        return types.findById(id).map(BrickType::getName).orElse("Bricks");
    }

    String resourceName(Long id) {
        return id == null ? null : resources.findById(id).map(BrickResource::getName).orElse(null);
    }

    /** The next number after the highest one like PREFIX0007 (PREFIX0001 to start with). */
    static String nextNo(String prefix, java.util.stream.Stream<String> numbers) {
        int max = numbers.filter(n -> n != null && n.startsWith(prefix)).mapToInt(n -> {
            try { return Integer.parseInt(n.substring(prefix.length())); } catch (NumberFormatException e) { return 0; }
        }).max().orElse(0);
        return prefix + String.format("%04d", max + 1);
    }

    static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    static String bricks(long n) {
        return String.format("%,d", n) + (n == 1 ? " brick" : " bricks");
    }
}
