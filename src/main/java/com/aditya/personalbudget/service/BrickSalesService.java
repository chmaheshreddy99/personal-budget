package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.domain.entity.BrickOrderItem;
import com.aditya.personalbudget.domain.entity.BrickOrderLink;
import com.aditya.personalbudget.domain.entity.BrickPayment;
import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.domain.entity.BrickSettings;
import com.aditya.personalbudget.domain.entity.BrickTrip;
import com.aditya.personalbudget.domain.entity.BrickTripItem;
import com.aditya.personalbudget.domain.entity.BrickType;
import com.aditya.personalbudget.domain.entity.BrickVehicle;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
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
import java.math.RoundingMode;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Sales: an order from a customer (the bricks at an agreed price against the MRP, the vehicle and its driver, the
 * loading and unloading teams), delivered in one or more trips planned from the vehicle's capacity. Each trip goes
 * Planned → Loading at the yard → Dispatched → On the way → Delivered; a delivered trip bills the customer (posted to
 * the books) and earns the driver and the teams their part. The customer follows the order on a temporary link, pays by
 * UPI from it and signs for each trip received.
 */
@Service
public class BrickSalesService {

    static final String PLANNED = "PLANNED";
    static final String LOADING = "LOADING";
    static final String DISPATCHED = "DISPATCHED";
    static final String IN_TRANSIT = "IN_TRANSIT";
    static final String DELIVERED = "DELIVERED";
    static final String CANCELLED = "CANCELLED";
    static final String RECEIVED = "RECEIVED";
    static final String PART_DELIVERED = "PART_DELIVERED";
    static final String CUSTOMER = "CUSTOMER";
    static final String US = "US";
    static final List<String> STEPS = List.of(PLANNED, LOADING, DISPATCHED, IN_TRANSIT, DELIVERED);
    static final Set<String> LEFT_YARD = Set.of(DISPATCHED, IN_TRANSIT, DELIVERED);
    static final Set<String> PAY_MODES = Set.of("Cash", "UPI", "Bank", "Cheque", "Card");
    public static final int MAX_LINK_HOURS = 24 * 90;

    // ------------------------------------------------------------------ requests

    public record ItemInput(@NotNull Long brickTypeId, @NotNull @Positive Integer quantity, @NotNull @Positive BigDecimal price) {
    }

    public record OrderRequest(@NotNull LocalDate orderDate, LocalDate requiredBy, @NotBlank @Size(max = 100) String customerName,
                               @Size(max = 20) String customerPhone, @Size(max = 300) String address, @Size(max = 150) String landmark,
                               @NotNull List<@Valid ItemInput> items, Long vehicleId, Long driverId, Long loadingTeamId, Long unloadingTeamId,
                               Boolean waiveDelivery, @Size(max = 150) String waiveReason, @PositiveOrZero BigDecimal deliveryChargePerTrip,
                               Boolean handlingBilled, @Size(max = 500) String note,
                               /* a vehicle hired from outside instead of one of ours: see BrickOrder */
                               Boolean hired, @Size(max = 30) String hiredVehicle, @Size(max = 100) String hiredContact,
                               @Positive Integer hiredCapacity, @PositiveOrZero BigDecimal hiredCharge, @Size(max = 10) String hiredPaidBy) {
    }

    public record TripItemInput(@NotNull Long brickTypeId, @NotNull @Min(0) Integer quantity) {
    }

    public record TripRequest(Long vehicleId, Long driverId, Long loadingTeamId, Long unloadingTeamId, LocalDate scheduledOn,
                              List<@Valid TripItemInput> items, @Size(max = 300) String note) {
    }

    /** Move a trip to a status (forward any number of steps, or back one). delivered: per type, when fewer arrived. */
    public record StepRequest(@NotBlank String status, List<@Valid TripItemInput> delivered, @Size(max = 300) String note) {
    }

    public record WaiveRequest(@NotNull Boolean waive, @Size(max = 150) String reason) {
    }

    public record PaymentRequest(@NotNull @Positive BigDecimal amount, @NotNull LocalDate receivedOn, @Size(max = 20) String mode,
                                 @Size(max = 60) String reference, Long accountId, @Size(max = 200) String note) {
    }

    public record ConfirmRequest(Long accountId, LocalDate receivedOn) {
    }

    public record LinkRequest(@Min(1) @Max(MAX_LINK_HOURS) int hours) {
    }

    public record AckRequest(@NotNull Long tripNo, @Size(min = 2, max = 100) String name, @Size(max = 20000) String signature,
                             @Size(max = 80) String location, @Size(max = 4000) String device, @Size(max = 300) String remarks) {
    }

    public record PaidRequest(@NotNull @Positive BigDecimal amount, @NotBlank @Size(max = 60) String reference, @Size(max = 30) String app) {
    }

    // ------------------------------------------------------------------ views

    public record ItemView(Long brickTypeId, String name, String color, int quantity, BigDecimal mrp, BigDecimal price, BigDecimal discountPerBrick,
                           BigDecimal discountPercent, BigDecimal discount, BigDecimal amount, int delivered, int onTheWay, int planned, int pending) {
    }

    public record TripItemView(Long brickTypeId, String name, String color, int quantity, Integer delivered) {
    }

    public record TripView(BrickTrip trip, List<TripItemView> items, int quantity, Integer delivered, String vehicle, String vehicleKind,
                           String driver, String driverPhone, String loadingTeam, String unloadingTeam, BigDecimal billed, String entryNo,
                           boolean acknowledged) {
    }

    public record PaymentView(BrickPayment payment, String account, String entryNo) {
    }

    public record LinkView(Long id, String createdByName, LocalDateTime createdAt, LocalDateTime expiresAt, LocalDateTime revokedAt, int views,
                           LocalDateTime lastViewedAt, String status) {
    }

    public record Totals(int quantity, BigDecimal atMrp, BigDecimal discount, BigDecimal bricks, int trips, BigDecimal deliveryPerTrip,
                         BigDecimal delivery, BigDecimal handling, BigDecimal total, int delivered, int pending, BigDecimal billed,
                         BigDecimal paid, BigDecimal claimed, BigDecimal balance, BigDecimal dueNow) {
    }

    /** The invoice of a paid order: its number, when it was made, the signed text and its signature. */
    public record Invoice(String invoiceNo, LocalDateTime issuedAt, String payload, String signature) {
    }

    public record OrderView(BrickOrder order, List<ItemView> items, Totals totals, List<TripView> trips, List<PaymentView> payments,
                            List<LinkView> links, String vehicle, Integer vehicleCapacity, String driver, String loadingTeam, String unloadingTeam,
                            String statusLabel, boolean freeDeliveryQualifies,
                            /* who the bill and invoice are from (stamp and signatures), the invoice once paid, the key that signs it */
                            BrickService.Company company, Invoice invoice, String publicKey, String keyFingerprint) {
    }

    public record OrderRow(Long id, String orderNo, LocalDate orderDate, LocalDate requiredBy, String customerName, String customerPhone,
                           String address, int quantity, int delivered, BigDecimal total, BigDecimal paid, BigDecimal balance, String status,
                           String statusLabel, int trips, int tripsDone, LocalDate nextTrip, String vehicle, boolean claimed,
                           /* each trip's day: delivered on, else planned for (for finding deliveries by date) */
                           List<LocalDate> tripDates, LocalDate lastDelivered, boolean hired) {
    }

    /** A trip a vehicle made or will make. */
    public record VehicleTrip(Long orderId, String orderNo, String customerName, String address, int tripNo, String status, LocalDate scheduledOn,
                              LocalDateTime deliveredAt, int bricks, String driver) {
    }

    public record Customer(String name, String phone, String address, String landmark, int orders, int bricks, BigDecimal value, BigDecimal balance,
                           LocalDate lastOrder) {
    }

    public record CreatedLink(LinkView link, String token) {
    }

    public record PublicTrip(int tripNo, String status, String statusLabel, LocalDate scheduledOn, LocalDateTime loadingAt,
                             LocalDateTime dispatchedAt, LocalDateTime inTransitAt, LocalDateTime deliveredAt, String vehicle, String vehicleKind,
                             String driver, String driverPhone, List<TripItemView> items, int quantity, Integer delivered, BigDecimal billed,
                             String ackName, LocalDateTime ackAt, String ackSignature, boolean canAcknowledge, String ackSeal) {
    }

    public record PublicPayment(String receiptNo, LocalDate receivedOn, BigDecimal amount, String mode, String status) {
    }

    public record PublicOrder(String organization, String company, String phone, String address, String orderNo, LocalDate orderDate,
                              LocalDate requiredBy, String customerName, String deliverTo, String landmark, String status, String statusLabel,
                              List<ItemView> items, Totals totals, boolean deliveryWaived, String waiveReason, boolean handlingBilled,
                              List<PublicTrip> trips, List<PublicPayment> payments, String upiId, String payeeName, BigDecimal payNow,
                              LocalDateTime expiresAt, String currency, String publicKey, String keyFingerprint, LocalDateTime asOf,
                              BrickService.Company seller, Invoice invoice, String customerPhone) {
    }

    private final BrickService core;
    private final BrickPayrollService payroll;
    private final OrganizationRepository tenants;
    private final SecureRandom random = new SecureRandom();

    public BrickSalesService(BrickService core, BrickPayrollService payroll, OrganizationRepository tenants) {
        this.core = core;
        this.payroll = payroll;
        this.tenants = tenants;
    }

    // ================================================================== orders

    public List<OrderRow> orders() {
        Long t = UserContext.tenantId();
        Map<Long, List<BrickOrderItem>> items = core.orderItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickOrderItem::getOrderId));
        Map<Long, List<BrickTrip>> trips = core.trips().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickTrip::getOrderId));
        Map<Long, List<BrickTripItem>> tripItems = core.tripItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickTripItem::getTripId));
        Map<Long, List<BrickPayment>> pays = core.payments().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickPayment::getOrderId));
        Map<Long, String> vehicle = core.vehicles().findByTenantId(t).stream().collect(Collectors.toMap(BrickVehicle::getId, BrickVehicle::getNumber));
        return core.orders().findByTenantId(t).stream().sorted(Comparator.comparing(BrickOrder::getOrderDate).thenComparing(BrickOrder::getId).reversed())
                .map(o -> {
                    Totals x = totals(o, items.getOrDefault(o.getId(), List.of()), trips.getOrDefault(o.getId(), List.of()), tripItems,
                            pays.getOrDefault(o.getId(), List.of()));
                    List<BrickTrip> ts = trips.getOrDefault(o.getId(), List.of()).stream().filter(tr -> !CANCELLED.equals(tr.getStatus())).toList();
                    LocalDate next = ts.stream().filter(tr -> !DELIVERED.equals(tr.getStatus())).map(BrickTrip::getScheduledOn).filter(Objects::nonNull)
                            .min(LocalDate::compareTo).orElse(null);
                    List<LocalDate> days = ts.stream().map(tr -> tr.getDeliveredAt() != null ? tr.getDeliveredAt().toLocalDate() : tr.getScheduledOn())
                            .filter(Objects::nonNull).distinct().sorted().toList();
                    LocalDate last = ts.stream().map(BrickTrip::getDeliveredAt).filter(Objects::nonNull).max(LocalDateTime::compareTo)
                            .map(LocalDateTime::toLocalDate).orElse(null);
                    return new OrderRow(o.getId(), o.getOrderNo(), o.getOrderDate(), o.getRequiredBy(), o.getCustomerName(), o.getCustomerPhone(), o.getAddress(),
                            x.quantity(), x.delivered(), x.total(), x.paid(), x.balance(), o.getStatus(), statusLabel(o.getStatus()), ts.size(),
                            (int) ts.stream().filter(tr -> DELIVERED.equals(tr.getStatus())).count(), next,
                            isHired(o) ? hiredLabel(o) : o.getVehicleId() == null ? null : vehicle.get(o.getVehicleId()),
                            pays.getOrDefault(o.getId(), List.of()).stream().anyMatch(p -> "CLAIMED".equals(p.getStatus())), days, last, isHired(o));
                }).toList();
    }

    /** Past customers (by mobile number, else name), for picking one on a new order. */
    public List<Customer> customers() {
        Map<String, List<OrderRow>> by = orders().stream().filter(o -> !CANCELLED.equals(o.status()))
                .collect(Collectors.groupingBy(o -> o.customerPhone() != null ? o.customerPhone() : o.customerName().toLowerCase(), LinkedHashMap::new, Collectors.toList()));
        Map<Long, BrickOrder> orders = core.orders().findByTenantId(UserContext.tenantId()).stream().collect(Collectors.toMap(BrickOrder::getId, Function.identity()));
        return by.values().stream().map(list -> {
            OrderRow last = list.getFirst();
            BrickOrder o = orders.get(last.id());
            return new Customer(last.customerName(), last.customerPhone(), last.address(), o == null ? null : o.getLandmark(), list.size(),
                    list.stream().mapToInt(OrderRow::quantity).sum(), list.stream().map(OrderRow::total).reduce(Money.ZERO, BigDecimal::add),
                    list.stream().map(OrderRow::balance).reduce(Money.ZERO, BigDecimal::add), last.orderDate());
        }).sorted(Comparator.comparing(Customer::lastOrder).reversed()).toList();
    }

    public OrderView order(Long id) {
        BrickOrder o = requireOrder(id);
        Long t = o.getTenantId();
        List<BrickOrderItem> items = core.orderItems().findByOrderId(id);
        List<BrickTrip> trips = core.trips().findByOrderId(id).stream().sorted(Comparator.comparing(BrickTrip::getTripNo)).toList();
        Map<Long, List<BrickTripItem>> tripItems = new HashMap<>();
        trips.forEach(tr -> tripItems.put(tr.getId(), core.tripItems().findByTripId(tr.getId())));
        List<BrickPayment> pays = core.payments().findByOrderId(id);
        Totals tot = totals(o, items, trips, tripItems, pays);
        Map<Long, int[]> flow = itemFlow(trips, tripItems);
        List<ItemView> iv = items.stream().map(i -> itemView(i, flow.getOrDefault(i.getBrickTypeId(), new int[3]))).toList();
        List<TripView> tv = trips.stream().map(tr -> tripView(o, tr, tripItems.get(tr.getId()), items)).toList();
        Map<Long, String> acct = core.accounts().findByTenantId(t).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        List<PaymentView> pv = pays.stream().sorted(Comparator.comparing(BrickPayment::getReceivedOn).thenComparing(BrickPayment::getId))
                .map(p -> new PaymentView(p, p.getAccountId() == null ? null : acct.get(p.getAccountId()), entryNo(p.getJournalEntryId()))).toList();
        List<LinkView> lv = core.links().findByOrderId(id).stream().sorted(Comparator.comparing(BrickOrderLink::getCreatedAt).reversed()).map(this::linkView).toList();
        BrickVehicle v = o.getVehicleId() == null ? null : core.vehicles().findById(o.getVehicleId()).orElse(null);
        Integer min = core.settings().getFreeDeliveryMinQty();
        return new OrderView(o, iv, tot, tv, pv, lv, isHired(o) ? hiredLabel(o) : v == null ? null : v.getNumber(),
                isHired(o) ? o.getHiredCapacity() : v == null ? null : v.getCapacity(), isHired(o) ? o.getHiredContact() : core.resourceName(o.getDriverId()),
                core.resourceName(o.getLoadingTeamId()), core.resourceName(o.getUnloadingTeamId()), statusLabel(o.getStatus()),
                min != null && tot.quantity() >= min, core.company(), invoiceOf(o), core.appSettings().payLinkPublicKey(), core.appSettings().payLinkFingerprint());
    }

    @Transactional
    public OrderView create(OrderRequest r) {
        core.ensureDefaults();
        Long t = UserContext.tenantId();
        BrickOrder o = new BrickOrder();
        o.setTenantId(t);
        o.setOrderNo(BrickService.nextNo("SO-", core.orders().findByTenantId(t).stream().map(BrickOrder::getOrderNo)));
        o.setStatus(RECEIVED);
        o.setCreatedBy(UserContext.username());
        o.setCreatedAt(LocalDateTime.now());
        BrickSettings s = core.settings();
        o.setLoadingRate(s.getLoadingRate());
        o.setUnloadingRate(s.getUnloadingRate());
        fill(o, r, s, true);
        o = core.orders().save(o);
        saveItems(o, r.items(), true);
        plan(o);
        refreshStatus(o);
        BrickOrder saved = o;
        core.activity().record("ADDED", BrickService.AREA, "Order " + o.getOrderNo() + " · " + o.getCustomerName() + " · "
                + BrickService.bricks(r.items().stream().mapToInt(ItemInput::quantity).sum()));
        return order(saved.getId());
    }

    @Transactional
    public OrderView update(Long id, OrderRequest r) {
        BrickOrder o = requireOpenOrder(id);
        fill(o, r, core.settings(), false);
        core.orders().save(o);
        saveItems(o, r.items(), false);
        replan(o);
        repostDelivered(o);
        core.activity().record("CHANGED", BrickService.AREA, "Order " + o.getOrderNo() + " · " + o.getCustomerName());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    private void fill(BrickOrder o, OrderRequest r, BrickSettings s, boolean fresh) {
        o.setOrderDate(r.orderDate());
        o.setRequiredBy(r.requiredBy());
        if (r.requiredBy() != null && r.requiredBy().isBefore(r.orderDate())) throw new BusinessException("Needed by a day before the order?");
        o.setCustomerName(r.customerName().trim());
        o.setCustomerPhone(BrickService.blank(r.customerPhone()) == null ? null : HostedChitService.cleanPhone(r.customerPhone(), r.customerName()));
        o.setAddress(BrickService.blank(r.address()));
        o.setLandmark(BrickService.blank(r.landmark()));
        boolean hired = Boolean.TRUE.equals(r.hired());
        String paidBy = BrickService.blank(r.hiredPaidBy()) == null ? CUSTOMER : r.hiredPaidBy().trim().toUpperCase();
        if (!Set.of(CUSTOMER, US).contains(paidBy)) throw new BusinessException("The hired vehicle is paid by the customer or by us");
        o.setHired(hired);
        o.setHiredVehicle(!hired || BrickService.blank(r.hiredVehicle()) == null ? null : r.hiredVehicle().trim().toUpperCase().replaceAll("\\s+", " "));
        o.setHiredContact(hired ? BrickService.blank(r.hiredContact()) : null);
        o.setHiredCapacity(hired ? r.hiredCapacity() : null);
        o.setHiredCharge(hired && r.hiredCharge() != null ? Money.round(r.hiredCharge()) : null);
        o.setHiredPaidBy(hired ? paidBy : null);
        BrickVehicle v = hired || r.vehicleId() == null ? null : core.requireVehicle(r.vehicleId());
        if (v == null && fresh && !hired) {
            v = core.vehicles().findByTenantId(o.getTenantId()).stream().filter(x -> Boolean.TRUE.equals(x.getActive()))
                    .min(Comparator.comparing(BrickVehicle::getId)).orElse(null);
        }
        o.setVehicleId(v == null ? null : v.getId());
        Long driver = hired ? null : r.driverId() != null ? core.requireResource(r.driverId()).getId() : v != null ? v.getDriverId() : null;
        o.setDriverId(driver);
        o.setLoadingTeamId(r.loadingTeamId() == null ? null : core.requireResource(r.loadingTeamId()).getId());
        o.setUnloadingTeamId(r.unloadingTeamId() == null ? null : core.requireResource(r.unloadingTeamId()).getId());
        o.setDeliveryChargePerTrip(r.deliveryChargePerTrip() != null ? Money.round(r.deliveryChargePerTrip()) : fresh ? s.getDeliveryChargePerTrip() : o.getDeliveryChargePerTrip());
        int qty = r.items().stream().mapToInt(ItemInput::quantity).sum();
        boolean qualifies = s.getFreeDeliveryMinQty() != null && qty >= s.getFreeDeliveryMinQty();
        boolean waive = r.waiveDelivery() != null ? r.waiveDelivery() : qualifies;
        if (hired) {
            // the customer pays the transporter: nothing for delivery on our bill; we pay: the bill carries it (the charge, unless set)
            boolean ours = US.equals(paidBy);
            o.setDeliveryChargePerTrip(!ours ? Money.ZERO : r.deliveryChargePerTrip() != null ? Money.round(r.deliveryChargePerTrip()) : Money.nz(o.getHiredCharge()));
            if (!ours) waive = false;
        }
        o.setDeliveryWaived(waive);
        o.setWaiveReason(!waive ? null : BrickService.blank(r.waiveReason()) != null ? r.waiveReason().trim()
                : qualifies ? "Free delivery on orders of " + String.format("%,d", s.getFreeDeliveryMinQty()) + "+ bricks" : "Waived");
        o.setHandlingBilled(r.handlingBilled() != null ? r.handlingBilled() : Boolean.TRUE.equals(s.getBillHandling()));
        o.setNote(BrickService.blank(r.note()));
    }

    private void saveItems(BrickOrder o, List<ItemInput> items, boolean fresh) {
        if (items.isEmpty()) throw new BusinessException("Add the bricks ordered");
        if (items.stream().map(ItemInput::brickTypeId).distinct().count() < items.size()) throw new BusinessException("Each brick type once, please");
        Map<Long, BrickOrderItem> have = fresh ? Map.of() : core.orderItems().findByOrderId(o.getId()).stream()
                .collect(Collectors.toMap(BrickOrderItem::getBrickTypeId, Function.identity(), (a, b) -> a));
        Map<Long, int[]> flow = fresh ? Map.of() : itemFlow(core.trips().findByOrderId(o.getId()), tripItemsOf(o.getId()));
        for (ItemInput i : items) {
            BrickType type = core.requireType(i.brickTypeId());
            int[] f = flow.getOrDefault(i.brickTypeId(), new int[3]);
            if (i.quantity() < f[0] + f[1]) {
                throw new BusinessException(String.format("%,d", f[0] + f[1]) + " " + type.getName() + " already left the yard for this order; the order cannot be smaller");
            }
            BrickOrderItem x = have.getOrDefault(i.brickTypeId(), new BrickOrderItem());
            x.setTenantId(o.getTenantId());
            x.setOrderId(o.getId());
            x.setBrickTypeId(type.getId());
            x.setQuantity(i.quantity());
            if (x.getId() == null) x.setMrp(type.getMrp());
            x.setPrice(i.price());
            core.orderItems().save(x);
        }
        Set<Long> kept = items.stream().map(ItemInput::brickTypeId).collect(Collectors.toSet());
        for (BrickOrderItem x : have.values()) {
            if (kept.contains(x.getBrickTypeId())) continue;
            int[] f = flow.getOrDefault(x.getBrickTypeId(), new int[3]);
            if (f[0] + f[1] > 0) throw new BusinessException(core.typeName(x.getBrickTypeId()) + " already left the yard for this order; keep it on the order");
            core.orderItems().delete(x);
        }
    }

    @Transactional
    public OrderView waive(Long id, WaiveRequest r) {
        BrickOrder o = requireOrder(id);
        if (CANCELLED.equals(o.getStatus())) throw new BusinessException("This order was cancelled");
        o.setDeliveryWaived(r.waive());
        o.setWaiveReason(r.waive() ? (BrickService.blank(r.reason()) != null ? r.reason().trim() : "Waived") : null);
        core.orders().save(o);
        repostDelivered(o);
        core.activity().record("CHANGED", BrickService.AREA, (r.waive() ? "Waived" : "Charged again") + " the delivery charges of " + o.getOrderNo());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    @Transactional
    public OrderView cancel(Long id) {
        BrickOrder o = requireOpenOrder(id);
        List<BrickTrip> trips = core.trips().findByOrderId(id);
        if (trips.stream().anyMatch(tr -> LEFT_YARD.contains(tr.getStatus()))) {
            throw new BusinessException("Bricks of this order already left the yard; it cannot be cancelled (a trip on the way can be taken back first)");
        }
        BigDecimal paid = core.payments().findByOrderId(id).stream().filter(p -> "POSTED".equals(p.getStatus())).map(BrickPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        if (paid.signum() > 0) throw new BusinessException(ActivityService.money(paid) + " was received for this order; delete (refund) those payments first");
        for (BrickTrip tr : trips) {
            payroll.dropTripEarnings(tr.getId(), Set.of(BrickPayrollService.LOADING, BrickPayrollService.UNLOADING, BrickPayrollService.TRIP));
            tr.setStatus(CANCELLED);
            core.trips().save(tr);
        }
        core.payments().findByOrderId(id).forEach(core.payments()::delete);
        o.setStatus(CANCELLED);
        o.setCancelledAt(LocalDateTime.now());
        core.orders().save(o);
        core.activity().record("CANCELLED", BrickService.AREA, "Order " + o.getOrderNo() + " · " + o.getCustomerName());
        return order(id);
    }

    // ================================================================== trips

    /** Plans trips for what the order still needs (not on a trip yet), filling the vehicle to its capacity. */
    private void plan(BrickOrder o) {
        List<BrickTrip> trips = core.trips().findByOrderId(o.getId());
        Map<Long, int[]> flow = itemFlow(trips, tripItemsOf(o.getId()));
        List<BrickOrderItem> items = core.orderItems().findByOrderId(o.getId());
        Map<Long, Integer> left = new LinkedHashMap<>();
        for (BrickOrderItem i : core.sortedItems(items)) {
            int[] f = flow.getOrDefault(i.getBrickTypeId(), new int[3]);
            int need = i.getQuantity() - f[0] - f[1] - f[2];
            if (need > 0) left.put(i.getBrickTypeId(), need);
        }
        int total = left.values().stream().mapToInt(Integer::intValue).sum();
        if (total == 0) return;
        BrickVehicle v = o.getVehicleId() == null ? null : core.vehicles().findById(o.getVehicleId()).orElse(null);
        Integer capacity = isHired(o) ? o.getHiredCapacity() : v == null ? null : v.getCapacity();
        int cap = capacity == null || capacity <= 0 ? total : capacity;
        int no = trips.stream().mapToInt(BrickTrip::getTripNo).max().orElse(0);
        LocalDate on = o.getRequiredBy() != null ? o.getRequiredBy() : o.getOrderDate();
        while (total > 0) {
            BrickTrip tr = new BrickTrip();
            tr.setTenantId(o.getTenantId());
            tr.setOrderId(o.getId());
            tr.setTripNo(++no);
            tr.setVehicleId(o.getVehicleId());
            tr.setDriverId(o.getDriverId());
            tr.setLoadingTeamId(o.getLoadingTeamId());
            tr.setUnloadingTeamId(o.getUnloadingTeamId());
            tr.setScheduledOn(on);
            tr.setStatus(PLANNED);
            tr.setCreatedAt(LocalDateTime.now());
            tr = core.trips().save(tr);
            int room = cap;
            for (var e : left.entrySet()) {
                if (room == 0) break;
                int take = Math.min(room, e.getValue());
                if (take == 0) continue;
                BrickTripItem ti = new BrickTripItem();
                ti.setTenantId(o.getTenantId());
                ti.setTripId(tr.getId());
                ti.setBrickTypeId(e.getKey());
                ti.setQuantity(take);
                core.tripItems().save(ti);
                e.setValue(e.getValue() - take);
                room -= take;
                total -= take;
            }
        }
    }

    /** Plans again what is not on its way: the planned trips are dropped and made afresh (for a changed order or vehicle). */
    private void replan(BrickOrder o) {
        for (BrickTrip tr : core.trips().findByOrderId(o.getId())) {
            if (!PLANNED.equals(tr.getStatus())) continue;
            core.tripItems().findByTripId(tr.getId()).forEach(core.tripItems()::delete);
            core.trips().delete(tr);
        }
        // trips still to come take the order's vehicle and teams
        renumber(o);
        plan(o);
        refreshStatus(o);
    }

    private void renumber(BrickOrder o) {
        int n = 0;
        for (BrickTrip tr : core.trips().findByOrderId(o.getId()).stream().sorted(Comparator.comparing(BrickTrip::getTripNo)).toList()) {
            if (tr.getTripNo() != ++n) {
                tr.setTripNo(n);
                core.trips().save(tr);
            }
        }
    }

    @Transactional
    public OrderView replanOrder(Long id) {
        BrickOrder o = requireOpenOrder(id);
        replan(o);
        core.activity().record("CHANGED", BrickService.AREA, "Planned the trips of " + o.getOrderNo() + " again");
        return order(id);
    }

    /** Changes a trip that has not left yet: its vehicle, driver, teams, day and load. */
    @Transactional
    public OrderView editTrip(Long id, Long tripId, TripRequest r) {
        BrickOrder o = requireOpenOrder(id);
        BrickTrip tr = requireTrip(o, tripId);
        if (LEFT_YARD.contains(tr.getStatus()) || CANCELLED.equals(tr.getStatus())) throw new BusinessException("Only a trip that has not left the yard can be changed");
        if (r.vehicleId() != null) tr.setVehicleId(core.requireVehicle(r.vehicleId()).getId());
        tr.setDriverId(r.driverId() == null ? null : core.requireResource(r.driverId()).getId());
        tr.setLoadingTeamId(r.loadingTeamId() == null ? null : core.requireResource(r.loadingTeamId()).getId());
        tr.setUnloadingTeamId(r.unloadingTeamId() == null ? null : core.requireResource(r.unloadingTeamId()).getId());
        if (r.scheduledOn() != null) tr.setScheduledOn(r.scheduledOn());
        tr.setNote(BrickService.blank(r.note()));
        core.trips().save(tr);
        if (r.items() != null) {
            Map<Long, Integer> ordered = core.orderItems().findByOrderId(id).stream().collect(Collectors.toMap(BrickOrderItem::getBrickTypeId, BrickOrderItem::getQuantity));
            core.tripItems().findByTripId(tripId).forEach(core.tripItems()::delete);
            for (TripItemInput i : r.items()) {
                if (i.quantity() == 0) continue;
                if (!ordered.containsKey(i.brickTypeId())) throw new BusinessException(core.typeName(i.brickTypeId()) + " is not on this order");
                BrickTripItem ti = new BrickTripItem();
                ti.setTenantId(o.getTenantId());
                ti.setTripId(tripId);
                ti.setBrickTypeId(i.brickTypeId());
                ti.setQuantity(i.quantity());
                core.tripItems().save(ti);
            }
            Map<Long, int[]> flow = itemFlow(core.trips().findByOrderId(id), tripItemsOf(id));
            for (var e : ordered.entrySet()) {
                int[] f = flow.getOrDefault(e.getKey(), new int[3]);
                if (f[0] + f[1] + f[2] > e.getValue()) {
                    throw new BusinessException("The trips carry more " + core.typeName(e.getKey()) + " than ordered (" + String.format("%,d", e.getValue()) + ")");
                }
            }
            if (core.tripItems().findByTripId(tripId).isEmpty()) {
                core.trips().delete(tr);
                renumber(o);
            }
        }
        // what is not on a trip now gets a new one
        plan(o);
        refreshStatus(o);
        core.activity().record("CHANGED", BrickService.AREA, "Trip " + tr.getTripNo() + " of " + o.getOrderNo());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    @Transactional
    public OrderView addTrip(Long id) {
        BrickOrder o = requireOpenOrder(id);
        int before = core.trips().findByOrderId(id).size();
        plan(o);
        if (core.trips().findByOrderId(id).size() == before) throw new BusinessException("Every brick of this order is already on a trip");
        refreshStatus(o);
        return order(id);
    }

    /** Moves a trip forward (any number of steps) or back one step; delivering bills it, taking it back unbills it. */
    @Transactional
    public OrderView step(Long id, Long tripId, StepRequest r) {
        BrickOrder o = requireOrder(id);
        if (CANCELLED.equals(o.getStatus())) throw new BusinessException("This order was cancelled");
        BrickTrip tr = requireTrip(o, tripId);
        move(o, tr, r.status().trim().toUpperCase(), r.delivered(), r.note());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    @Transactional
    public OrderView cancelTrip(Long id, Long tripId) {
        BrickOrder o = requireOpenOrder(id);
        BrickTrip tr = requireTrip(o, tripId);
        if (LEFT_YARD.contains(tr.getStatus())) throw new BusinessException("This trip already left the yard; take it back step by step first");
        payroll.dropTripEarnings(tripId, Set.of(BrickPayrollService.LOADING));
        core.tripItems().findByTripId(tripId).forEach(core.tripItems()::delete);
        core.trips().delete(tr);
        renumber(o);
        refreshStatus(o);
        core.activity().record("DELETED", BrickService.AREA, "A planned trip of " + o.getOrderNo() + " (the bricks wait for another trip)");
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    private void move(BrickOrder o, BrickTrip tr, String to, List<TripItemInput> delivered, String note) {
        int from = STEPS.indexOf(tr.getStatus());
        int target = STEPS.indexOf(to);
        if (from < 0) throw new BusinessException("This trip was cancelled");
        if (target < 0) throw new BusinessException("Unknown status " + to);
        if (target == from) {
            if (DELIVERED.equals(to) && delivered != null) {   // correcting the counts of a delivered trip
                setDelivered(tr, delivered);
                bill(o, tr);
                earnDelivered(o, tr);
            }
            return;
        }
        if (target < from - 1) throw new BusinessException("Take a trip back one step at a time");
        if (note != null && !note.isBlank()) tr.setNote(ActivityService.cut(note.trim(), 300));
        LocalDateTime now = LocalDateTime.now();
        if (target < from) {
            // back one step
            if (DELIVERED.equals(tr.getStatus())) {
                if (tr.getAckAt() != null) throw new BusinessException("The customer already signed for this trip; it cannot be taken back");
                payroll.dropTripEarnings(tr.getId(), Set.of(BrickPayrollService.UNLOADING, BrickPayrollService.TRIP));
                Long entry = tr.getJournalEntryId();
                tr.setJournalEntryId(null);
                tr.setDeliveredAt(null);
                core.trips().save(tr);
                core.unpost(entry);
                core.tripItems().findByTripId(tr.getId()).forEach(i -> { i.setDelivered(null); core.tripItems().save(i); });
            } else if (IN_TRANSIT.equals(tr.getStatus())) {
                tr.setInTransitAt(null);
            } else if (DISPATCHED.equals(tr.getStatus())) {
                payroll.dropTripEarnings(tr.getId(), Set.of(BrickPayrollService.LOADING));
                tr.setDispatchedAt(null);
            } else if (LOADING.equals(tr.getStatus())) {
                tr.setLoadingAt(null);
            }
            tr.setStatus(to);
            core.trips().save(tr);
            refreshStatus(o);
            core.activity().record("CHANGED", BrickService.AREA, "Trip " + tr.getTripNo() + " of " + o.getOrderNo() + " back to " + tripLabel(to).toLowerCase());
            return;
        }
        List<BrickTripItem> items = core.tripItems().findByTripId(tr.getId());
        if (items.isEmpty()) throw new BusinessException("This trip carries nothing");
        if (tr.getVehicleId() == null && !isHired(o) && target >= STEPS.indexOf(DISPATCHED)) throw new BusinessException("Pick the vehicle of this trip first");
        for (int s = from + 1; s <= target; s++) {
            String st = STEPS.get(s);
            switch (st) {
                case LOADING -> tr.setLoadingAt(now);
                case DISPATCHED -> {
                    checkYard(items);
                    tr.setDispatchedAt(now);
                    tr.setStatus(DISPATCHED);
                    int qty = items.stream().mapToInt(BrickTripItem::getQuantity).sum();
                    BigDecimal rate = Money.nz(o.getLoadingRate());
                    payroll.tripEarning(tr.getLoadingTeamId(), BrickPayrollService.LOADING, tr.getId(), now.toLocalDate(), qty, rate, rate.multiply(BigDecimal.valueOf(qty)),
                            "Loading " + o.getOrderNo() + " trip " + tr.getTripNo() + " · " + String.format("%,d", qty) + " × " + rate.stripTrailingZeros().toPlainString());
                }
                case IN_TRANSIT -> tr.setInTransitAt(now);
                case DELIVERED -> {
                    tr.setDeliveredAt(now);
                    tr.setStatus(DELIVERED);
                    setDelivered(tr, delivered);
                    bill(o, tr);
                    earnDelivered(o, tr);
                }
                default -> { }
            }
            tr.setStatus(st);
        }
        core.trips().save(tr);
        refreshStatus(o);
        core.activity().record("CHANGED", BrickService.AREA, "Trip " + tr.getTripNo() + " of " + o.getOrderNo() + " · " + tripLabel(to)
                + (DELIVERED.equals(to) ? " · " + o.getCustomerName() : ""));
    }

    /** Bricks cannot leave the yard when they are not there. */
    private void checkYard(List<BrickTripItem> items) {
        Map<Long, BrickService.TypeStock> stock = core.brickStock().stream().collect(Collectors.toMap(BrickService.TypeStock::brickTypeId, Function.identity()));
        for (BrickTripItem i : items) {
            BrickService.TypeStock s = stock.get(i.getBrickTypeId());
            int have = s == null ? 0 : s.inYard();
            if (have < i.getQuantity()) {
                throw new BusinessException("Only " + String.format("%,d", Math.max(0, have)) + " " + core.typeName(i.getBrickTypeId()) + " are in the yard, the trip needs "
                        + String.format("%,d", i.getQuantity()) + ". Record the batch that made them (or the brick type's opening stock) first");
            }
        }
    }

    private void setDelivered(BrickTrip tr, List<TripItemInput> delivered) {
        Map<Long, Integer> got = delivered == null ? Map.of() : delivered.stream().collect(Collectors.toMap(TripItemInput::brickTypeId, TripItemInput::quantity, (a, b) -> b));
        for (BrickTripItem i : core.tripItems().findByTripId(tr.getId())) {
            int d = got.getOrDefault(i.getBrickTypeId(), i.getQuantity());
            if (d > i.getQuantity()) throw new BusinessException("More " + core.typeName(i.getBrickTypeId()) + " delivered than loaded (" + i.getQuantity() + ")");
            i.setDelivered(d);
            core.tripItems().save(i);
        }
    }

    /** The trip's bill: bricks delivered at the agreed price, the delivery charge (unless waived) and loading & unloading when billed. */
    private void bill(BrickOrder o, BrickTrip tr) {
        BigDecimal[] b = billOf(o, core.tripItems().findByTripId(tr.getId()), core.orderItems().findByOrderId(o.getId()));
        BigDecimal total = b[0].add(b[1]).add(b[2]);
        int qty = core.tripItems().findByTripId(tr.getId()).stream().mapToInt(i -> BrickService.nz(i.getDelivered())).sum();
        JournalDraft d = JournalDraft.of(tr.getDeliveredAt() == null ? LocalDate.now() : tr.getDeliveredAt().toLocalDate(), VoucherType.BRICK_SALE,
                        "Bricks delivered · " + o.getOrderNo() + " trip " + tr.getTripNo() + " · " + String.format("%,d", qty) + " bricks · " + o.getCustomerName())
                .debit(core.account("CUSTOMERS").getId(), total, o.getCustomerName())
                .credit(core.account("SALES").getId(), b[0], String.format("%,d", qty) + " bricks")
                .credit(core.account("DELIVERY").getId(), b[1], "Delivery charge")
                .credit(core.account("HANDLING").getId(), b[2], "Loading & unloading")
                .reference(o.getOrderNo()).party(o.getCustomerName()).source(BrickService.SOURCE_DELIVERY, tr.getId());
        if (total.signum() == 0) {
            Long entry = tr.getJournalEntryId();
            tr.setJournalEntryId(null);
            core.trips().save(tr);
            core.unpost(entry);
        } else if (tr.getJournalEntryId() != null && core.entries().findById(tr.getJournalEntryId()).isPresent()) {
            core.ledger().repost(tr.getJournalEntryId(), d);
        } else {
            tr.setJournalEntryId(core.post(d).getId());
        }
        core.trips().save(tr);
    }

    private void earnDelivered(BrickOrder o, BrickTrip tr) {
        int qty = core.tripItems().findByTripId(tr.getId()).stream().mapToInt(i -> i.getDelivered() == null ? i.getQuantity() : i.getDelivered()).sum();
        LocalDate on = tr.getDeliveredAt() == null ? LocalDate.now() : tr.getDeliveredAt().toLocalDate();
        BigDecimal rate = Money.nz(o.getUnloadingRate());
        payroll.tripEarning(tr.getUnloadingTeamId(), BrickPayrollService.UNLOADING, tr.getId(), on, qty, rate, rate.multiply(BigDecimal.valueOf(qty)),
                "Unloading " + o.getOrderNo() + " trip " + tr.getTripNo() + " · " + String.format("%,d", qty) + " × " + rate.stripTrailingZeros().toPlainString());
        BrickResource driver = tr.getDriverId() == null ? null : core.resources().findById(tr.getDriverId()).orElse(null);
        BigDecimal incentive = driver == null ? Money.ZERO : driver.getTripIncentive() != null ? driver.getTripIncentive() : Money.nz(core.settings().getDriverIncentivePerTrip());
        String vehicle = tr.getVehicleId() == null ? (isHired(o) ? " · " + hiredLabel(o) : "")
                : core.vehicles().findById(tr.getVehicleId()).map(v -> " · " + v.getNumber()).orElse("");
        payroll.tripEarning(tr.getDriverId(), BrickPayrollService.TRIP, tr.getId(), on, 1, incentive, incentive,
                "Trip " + tr.getTripNo() + " of " + o.getOrderNo() + vehicle + " · " + o.getCustomerName());
    }

    /** After a change of price, the delivery charge or its waiver: every delivered trip's bill again. */
    private void repostDelivered(BrickOrder o) {
        for (BrickTrip tr : core.trips().findByOrderId(o.getId())) {
            if (DELIVERED.equals(tr.getStatus())) bill(o, tr);
        }
    }

    /** {bricks at the agreed price, delivery charge, loading & unloading} of a trip's delivered bricks. */
    private static BigDecimal[] billOf(BrickOrder o, List<BrickTripItem> items, List<BrickOrderItem> ordered) {
        Map<Long, BigDecimal> price = ordered.stream().collect(Collectors.toMap(BrickOrderItem::getBrickTypeId, BrickOrderItem::getPrice, (a, b) -> a));
        BigDecimal bricks = Money.ZERO;
        int qty = 0;
        for (BrickTripItem i : items) {
            int d = i.getDelivered() == null ? i.getQuantity() : i.getDelivered();
            qty += d;
            bricks = bricks.add(price.getOrDefault(i.getBrickTypeId(), Money.ZERO).multiply(BigDecimal.valueOf(d)));
        }
        BigDecimal delivery = Boolean.TRUE.equals(o.getDeliveryWaived()) ? Money.ZERO : Money.nz(o.getDeliveryChargePerTrip());
        BigDecimal handling = Boolean.TRUE.equals(o.getHandlingBilled())
                ? Money.nz(o.getLoadingRate()).add(Money.nz(o.getUnloadingRate())).multiply(BigDecimal.valueOf(qty)) : Money.ZERO;
        return new BigDecimal[]{Money.round(bricks), Money.round(delivery), Money.round(handling)};
    }

    /** The order's status from its trips: the furthest one on its way, else partly or fully delivered, else received. */
    private void refreshStatus(BrickOrder o) {
        if (CANCELLED.equals(o.getStatus())) return;
        List<BrickTrip> trips = core.trips().findByOrderId(o.getId()).stream().filter(t -> !CANCELLED.equals(t.getStatus())).toList();
        Map<Long, int[]> flow = itemFlow(trips, tripItemsOf(o.getId()));
        boolean all = core.orderItems().findByOrderId(o.getId()).stream().allMatch(i -> flow.getOrDefault(i.getBrickTypeId(), new int[3])[0] >= i.getQuantity())
                && trips.stream().allMatch(t -> DELIVERED.equals(t.getStatus()));
        boolean anyDelivered = trips.stream().anyMatch(t -> DELIVERED.equals(t.getStatus()));
        String status = all && anyDelivered ? DELIVERED
                : trips.stream().anyMatch(t -> IN_TRANSIT.equals(t.getStatus())) ? IN_TRANSIT
                : trips.stream().anyMatch(t -> DISPATCHED.equals(t.getStatus())) ? DISPATCHED
                : trips.stream().anyMatch(t -> LOADING.equals(t.getStatus())) ? LOADING
                : anyDelivered ? PART_DELIVERED : RECEIVED;
        if (!status.equals(o.getStatus())) {
            o.setStatus(status);
            core.orders().save(o);
        }
    }

    // ================================================================== payments

    @Transactional
    public OrderView addPayment(Long id, PaymentRequest r) {
        BrickOrder o = requireOrder(id);
        if (CANCELLED.equals(o.getStatus())) throw new BusinessException("This order was cancelled");
        BrickPayment p = new BrickPayment();
        p.setTenantId(o.getTenantId());
        p.setOrderId(id);
        p.setReceivedOn(r.receivedOn());
        p.setAmount(Money.round(r.amount()));
        p.setMode(mode(r.mode()));
        p.setReference(BrickService.blank(r.reference()));
        p.setNote(BrickService.blank(r.note()));
        p.setCreatedBy(UserContext.get().fullName());
        p.setCreatedAt(LocalDateTime.now());
        p.setStatus("POSTED");
        p.setAccountId(core.moneyAccountOr(r.accountId(), true));
        p = core.payments().save(p);
        postPayment(o, p);
        core.activity().record("ADDED", BrickService.AREA, "Received " + ActivityService.money(p.getAmount()) + " for " + o.getOrderNo() + " from " + o.getCustomerName());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    /** A payment the customer reported on the link: checked against the bank, then posted. */
    @Transactional
    public OrderView confirmPayment(Long id, Long paymentId, ConfirmRequest r) {
        BrickOrder o = requireOrder(id);
        BrickPayment p = requirePayment(o, paymentId);
        if (!"CLAIMED".equals(p.getStatus())) throw new BusinessException("This payment is already in the books");
        p.setStatus("POSTED");
        p.setAccountId(core.moneyAccountOr(r.accountId(), true));
        if (r.receivedOn() != null) p.setReceivedOn(r.receivedOn());
        core.payments().save(p);
        postPayment(o, p);
        core.activity().record("APPROVED", BrickService.AREA, "Confirmed " + ActivityService.money(p.getAmount()) + " paid by " + o.getCustomerName() + " for " + o.getOrderNo());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    private void postPayment(BrickOrder o, BrickPayment p) {
        p.setReceiptNo(BrickService.nextNo("RC-", core.payments().findByTenantId(o.getTenantId()).stream().map(BrickPayment::getReceiptNo)));
        p.setJournalEntryId(core.post(JournalDraft.of(p.getReceivedOn(), VoucherType.BRICK_RECEIPT, "Payment for " + o.getOrderNo() + " · " + o.getCustomerName()
                        + " · " + p.getMode() + (p.getReference() != null ? " " + p.getReference() : ""))
                .debit(p.getAccountId(), p.getAmount(), p.getMode() + (p.getReference() != null ? " " + p.getReference() : ""))
                .credit(core.account("CUSTOMERS").getId(), p.getAmount(), o.getCustomerName())
                .reference(p.getReceiptNo()).party(o.getCustomerName()).source(BrickService.SOURCE_RECEIPT, p.getId())).getId());
        core.payments().save(p);
    }

    @Transactional
    public OrderView deletePayment(Long id, Long paymentId) {
        BrickOrder o = requireOrder(id);
        BrickPayment p = requirePayment(o, paymentId);
        core.payments().delete(p);
        core.unpost(p.getJournalEntryId());
        core.activity().record("DELETED", BrickService.AREA, ("CLAIMED".equals(p.getStatus()) ? "Turned down a payment reported" : "Deleted the payment")
                + " of " + ActivityService.money(p.getAmount()) + " for " + o.getOrderNo());
        refreshInvoice(requireOrder(id));
        return order(id);
    }

    // ================================================================== links for the customer

    @Transactional
    public CreatedLink createLink(Long id, LinkRequest r) {
        BrickOrder o = requireOrder(id);
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        BrickOrderLink l = new BrickOrderLink();
        l.setTenantId(o.getTenantId());
        l.setOrderId(id);
        l.setTokenHash(AccessLinkService.hash(token));
        l.setCreatedByName(UserContext.get().fullName());
        l.setCreatedAt(LocalDateTime.now());
        l.setExpiresAt(LocalDateTime.now().plusHours(r.hours()));
        l.setViews(0);
        l = core.links().save(l);
        core.activity().record("ADDED", BrickService.AREA, "Shared order " + o.getOrderNo() + " with " + o.getCustomerName() + " for "
                + (r.hours() % 24 == 0 ? r.hours() / 24 + " day(s)" : r.hours() + " hours"));
        return new CreatedLink(linkView(l), token);
    }

    @Transactional
    public OrderView revokeLink(Long id, Long linkId) {
        BrickOrder o = requireOrder(id);
        BrickOrderLink l = core.links().findByIdAndTenantId(linkId, o.getTenantId()).filter(x -> x.getOrderId().equals(id))
                .orElseThrow(() -> new NotFoundException("Link", linkId));
        if (l.getRevokedAt() == null) {
            l.setRevokedAt(LocalDateTime.now());
            core.links().save(l);
            core.activity().record("REVOKED", BrickService.AREA, "Stopped a link of order " + o.getOrderNo());
        }
        return order(id);
    }

    /** The customer's page: the order as of now (counts the view). No sign-in. */
    @Transactional
    public PublicOrder open(String token) {
        BrickOrderLink l = activeLink(token);
        l.setViews(BrickService.nz(l.getViews()) + 1);
        l.setLastViewedAt(LocalDateTime.now());
        core.links().save(l);
        return asTenant(l, () -> toPublic(l));
    }

    /** The customer signs for a trip received (it is marked delivered when it was still on its way). */
    @Transactional
    public PublicOrder acknowledge(String token, AckRequest r, String ip, String userAgent) {
        BrickOrderLink l = activeLink(token);
        return asTenant(l, () -> {
            BrickOrder o = core.orders().findById(l.getOrderId()).orElseThrow(() -> new BusinessException("This order no longer exists"));
            BrickTrip tr = core.trips().findByOrderId(o.getId()).stream().filter(x -> x.getTripNo().longValue() == r.tripNo()).findFirst()
                    .orElseThrow(() -> new BusinessException("No such trip on this order"));
            if (tr.getAckAt() != null) throw new BusinessException("Trip " + tr.getTripNo() + " was already signed for by " + tr.getAckName());
            if (!LEFT_YARD.contains(tr.getStatus())) throw new BusinessException("Trip " + tr.getTripNo() + " has not been sent yet");
            String name = r.name() == null ? "" : r.name().trim();
            if (name.length() < 2) throw new BusinessException("Type your name");
            String signature = r.signature() == null ? "" : r.signature().trim();
            if (signature.length() < 20 || !signature.matches("[MLml0-9 .\\-]+")) throw new BusinessException("Sign in the box with your finger");
            String location = r.location() == null || r.location().isBlank() ? null : r.location().trim();
            if (location != null && !location.matches("-?\\d{1,3}(\\.\\d+)?,-?\\d{1,3}(\\.\\d+)?(,\\d+(\\.\\d+)?)?")) location = null;
            if (!DELIVERED.equals(tr.getStatus())) move(o, tr, DELIVERED, null, null);
            refreshInvoice(o);
            tr = core.trips().findById(tr.getId()).orElseThrow();
            LocalDateTime now = LocalDateTime.now();
            String device = r.device() == null ? null : ActivityService.cut(r.device(), 2000);
            tr.setAckName(ActivityService.cut(name, 100));
            tr.setAckAt(now);
            tr.setAckSignature(signature);
            tr.setAckLocation(location);
            tr.setAckDevice(device);
            tr.setAckIp(ActivityService.cut(ip, 64));
            tr.setAckRemarks(BrickService.blank(r.remarks()));
            int qty = core.tripItems().findByTripId(tr.getId()).stream().mapToInt(i -> i.getDelivered() == null ? i.getQuantity() : i.getDelivered()).sum();
            String seal = HostedChitService.sha256(String.join("|", o.getOrderNo(), String.valueOf(tr.getTripNo()), String.valueOf(qty), name, now.toString(),
                    String.valueOf(ip), String.valueOf(device == null ? null : HostedChitService.sha256(device)), String.valueOf(location), HostedChitService.sha256(signature)));
            tr.setAckSeal(seal);
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("v", 1);
            ev.put("kind", "BRICK_DELIVERY_RECEIPT");
            ev.put("orderNo", o.getOrderNo());
            ev.put("trip", tr.getTripNo());
            ev.put("bricks", qty);
            ev.put("receivedBy", name);
            ev.put("at", now.withNano(0).toString());
            ev.put("ip", ip);
            ev.put("userAgent", userAgent == null ? null : ActivityService.cut(userAgent, 300));
            ev.put("deviceHash", device == null ? null : HostedChitService.sha256(device));
            ev.put("location", location);
            ev.put("remarks", tr.getAckRemarks());
            ev.put("signatureHash", HostedChitService.sha256(signature));
            ev.put("seal", seal);
            tr.setAckPayload(ActivityService.cut(Kyc.json(ev), 4000));
            tr.setAckDigitalSignature(core.appSettings().signPayLink(tr.getAckPayload()));
            core.trips().save(tr);
            core.activity().record("ACCEPTED", BrickService.AREA, name + " signed for trip " + tr.getTripNo() + " of " + o.getOrderNo() + " · " + BrickService.bricks(qty));
            return toPublic(l);
        });
    }

    /** The customer reports a payment made (UPI reference): it waits for the business to confirm it. */
    @Transactional
    public PublicOrder reportPaid(String token, PaidRequest r) {
        BrickOrderLink l = activeLink(token);
        return asTenant(l, () -> {
            BrickOrder o = core.orders().findById(l.getOrderId()).orElseThrow(() -> new BusinessException("This order no longer exists"));
            if (CANCELLED.equals(o.getStatus())) throw new BusinessException("This order was cancelled");
            String ref = r.reference().trim();
            if (core.payments().findByOrderId(o.getId()).stream().anyMatch(p -> ref.equalsIgnoreCase(Objects.toString(p.getReference(), "")))) {
                throw new BusinessException("A payment with that reference is already recorded");
            }
            if (core.payments().findByOrderId(o.getId()).stream().filter(p -> "CLAIMED".equals(p.getStatus())).count() >= 5) {
                throw new BusinessException("Several payments are already waiting to be confirmed; please call us");
            }
            BrickPayment p = new BrickPayment();
            p.setTenantId(o.getTenantId());
            p.setOrderId(o.getId());
            p.setReceivedOn(LocalDate.now());
            p.setAmount(Money.round(r.amount()));
            p.setMode("UPI");
            p.setReference(ActivityService.cut(ref, 60));
            p.setNote(BrickService.blank(r.app()) == null ? "Reported by the customer" : "Reported by the customer · " + r.app().trim());
            p.setStatus("CLAIMED");
            p.setCreatedBy(o.getCustomerName());
            p.setCreatedAt(LocalDateTime.now());
            core.payments().save(p);
            core.activity().record("ADDED", BrickService.AREA, o.getCustomerName() + " reported paying " + ActivityService.money(p.getAmount()) + " for " + o.getOrderNo()
                    + " (UPI ref " + ref + ") · to confirm");
            return toPublic(l);
        });
    }

    /**
     * The invoice: made (with the next number, signed) once the order is paid in full; made again (same number) when what it
     * shows changes; taken back while the order is not paid in full (its number is kept for when it is).
     */
    void refreshInvoice(BrickOrder o) {
        OrderView v = order(o.getId());
        Totals t = v.totals();
        boolean paid = !CANCELLED.equals(o.getStatus()) && t.total().signum() > 0 && t.paid().signum() > 0 && t.balance().signum() <= 0;
        if (!paid) {
            if (o.getInvoicePayload() != null) {
                o.setInvoicePayload(null);
                o.setInvoiceSignature(null);
                core.orders().save(o);
            }
            return;
        }
        if (o.getInvoiceNo() == null) {
            o.setInvoiceNo(BrickService.nextNo("INV-", core.orders().findByTenantId(o.getTenantId()).stream().map(BrickOrder::getInvoiceNo)));
            o.setInvoicedAt(LocalDateTime.now());
            core.activity().record("ADDED", BrickService.AREA, "Invoice " + o.getInvoiceNo() + " for " + o.getOrderNo() + " · " + ActivityService.money(t.total())
                    + " · " + o.getCustomerName());
        }
        BrickService.Company c = core.company();
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("v", 1);
        p.put("kind", "BRICK_INVOICE");
        p.put("invoiceNo", o.getInvoiceNo());
        p.put("orderNo", o.getOrderNo());
        p.put("issuedAt", o.getInvoicedAt().withNano(0).toString());
        p.put("seller", c.name());
        p.put("buyer", o.getCustomerName());
        p.put("buyerPhone", o.getCustomerPhone());
        p.put("lines", v.items().stream().map(i -> i.name() + " x " + (DELIVERED.equals(o.getStatus()) ? i.delivered() : i.quantity()) + " @ " + i.price().toPlainString()).toList());
        p.put("discount", t.discount().toPlainString());
        p.put("delivery", (Boolean.TRUE.equals(o.getDeliveryWaived()) ? Money.ZERO : t.delivery()).toPlainString());
        p.put("handling", t.handling().toPlainString());
        p.put("total", t.total().toPlainString());
        p.put("paid", t.paid().toPlainString());
        p.put("receipts", v.payments().stream().filter(x -> "POSTED".equals(x.payment().getStatus())).map(x -> x.payment().getReceiptNo()).toList());
        String payload = ActivityService.cut(Kyc.json(p), 4000);
        if (!payload.equals(o.getInvoicePayload())) {
            o.setInvoicePayload(payload);
            o.setInvoiceSignature(core.appSettings().signPayLink(payload));
            core.orders().save(o);
        }
    }

    private Invoice invoiceOf(BrickOrder o) {
        return o.getInvoicePayload() == null ? null : new Invoice(o.getInvoiceNo(), o.getInvoicedAt(), o.getInvoicePayload(), o.getInvoiceSignature());
    }

    private PublicOrder toPublic(BrickOrderLink l) {
        OrderView v = order(l.getOrderId());
        BrickOrder o = v.order();
        BrickSettings s = core.settings();
        Organization org = tenants.findById(o.getTenantId()).orElseThrow();
        List<PublicTrip> trips = v.trips().stream().filter(t -> !CANCELLED.equals(t.trip().getStatus())).map(t -> {
            BrickTrip tr = t.trip();
            return new PublicTrip(tr.getTripNo(), tr.getStatus(), tripLabel(tr.getStatus()), tr.getScheduledOn(), tr.getLoadingAt(), tr.getDispatchedAt(),
                    tr.getInTransitAt(), tr.getDeliveredAt(), t.vehicle(), t.vehicleKind(), t.driver(), LEFT_YARD.contains(tr.getStatus()) ? t.driverPhone() : null,
                    t.items(), t.quantity(), t.delivered(), t.billed(), tr.getAckName(), tr.getAckAt(), tr.getAckSignature(),
                    tr.getAckAt() == null && LEFT_YARD.contains(tr.getStatus()), tr.getAckSeal());
        }).toList();
        List<PublicPayment> pays = v.payments().stream().map(p -> new PublicPayment(p.payment().getReceiptNo(), p.payment().getReceivedOn(), p.payment().getAmount(),
                p.payment().getMode(), p.payment().getStatus())).toList();
        BigDecimal payNow = v.totals().balance().subtract(v.totals().claimed()).max(Money.ZERO);
        String company = s.getCompanyName() != null ? s.getCompanyName() : org.getName();
        return new PublicOrder(org.getName(), company, s.getPhone(), s.getAddress(), o.getOrderNo(), o.getOrderDate(), o.getRequiredBy(), o.getCustomerName(),
                o.getAddress(), o.getLandmark(), o.getStatus(), statusLabel(o.getStatus()), v.items(), v.totals(), Boolean.TRUE.equals(o.getDeliveryWaived()),
                o.getWaiveReason(), Boolean.TRUE.equals(o.getHandlingBilled()), trips, pays, s.getUpiId(), s.getPayeeName() != null ? s.getPayeeName() : company,
                payNow, l.getExpiresAt(), org.getCurrency(), core.appSettings().payLinkPublicKey(), core.appSettings().payLinkFingerprint(), LocalDateTime.now(),
                v.company(), v.invoice(), o.getCustomerPhone());
    }

    private BrickOrderLink activeLink(String token) {
        BrickOrderLink l = token == null || token.isBlank() ? null : core.links().findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (l == null) throw new BusinessException("This link is not valid");
        if (l.getRevokedAt() != null) throw new BusinessException("This link was switched off");
        if (!l.getExpiresAt().isAfter(LocalDateTime.now())) throw new BusinessException("This link has expired. Ask for a new one.");
        return l;
    }

    private <T> T asTenant(BrickOrderLink l, Supplier<T> work) {
        Organization tenant = tenants.findById(l.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This order is no longer shared"));
        CurrentUser previous = UserContext.current().orElse(null);
        UserContext.set(new CurrentUser(null, "link", "Order link", UserRole.VIEWER, tenant.getId(), tenant.getCode(), tenant.getName(),
                tenant.getCurrency(), Feature.all(), false));
        try {
            return work.get();
        } finally {
            if (previous != null) UserContext.set(previous);
            else UserContext.clear();
        }
    }

    private LinkView linkView(BrickOrderLink l) {
        LocalDateTime now = LocalDateTime.now();
        String status = l.getRevokedAt() != null ? "REVOKED" : l.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new LinkView(l.getId(), l.getCreatedByName(), l.getCreatedAt(), l.getExpiresAt(), l.getRevokedAt(), BrickService.nz(l.getViews()), l.getLastViewedAt(), status);
    }

    // ================================================================== figures

    /** type -> {delivered, on its way (loaded, not delivered), planned or loading} over the order's trips. */
    private static Map<Long, int[]> itemFlow(List<BrickTrip> trips, Map<Long, List<BrickTripItem>> items) {
        Map<Long, int[]> out = new HashMap<>();
        for (BrickTrip t : trips) {
            if (CANCELLED.equals(t.getStatus())) continue;
            for (BrickTripItem i : items.getOrDefault(t.getId(), List.of())) {
                int[] x = out.computeIfAbsent(i.getBrickTypeId(), k -> new int[3]);
                if (DELIVERED.equals(t.getStatus())) x[0] += i.getDelivered() == null ? i.getQuantity() : i.getDelivered();
                else if (LEFT_YARD.contains(t.getStatus())) x[1] += i.getQuantity();
                else x[2] += i.getQuantity();
            }
        }
        return out;
    }

    private Map<Long, List<BrickTripItem>> tripItemsOf(Long orderId) {
        Map<Long, List<BrickTripItem>> out = new HashMap<>();
        core.trips().findByOrderId(orderId).forEach(t -> out.put(t.getId(), core.tripItems().findByTripId(t.getId())));
        return out;
    }

    private Totals totals(BrickOrder o, List<BrickOrderItem> items, List<BrickTrip> trips, Map<Long, List<BrickTripItem>> tripItems, List<BrickPayment> pays) {
        int qty = items.stream().mapToInt(BrickOrderItem::getQuantity).sum();
        BigDecimal atMrp = Money.ZERO, bricks = Money.ZERO;
        for (BrickOrderItem i : items) {
            BigDecimal mrp = i.getMrp() != null ? i.getMrp() : i.getPrice();
            atMrp = atMrp.add(mrp.max(i.getPrice()).multiply(BigDecimal.valueOf(i.getQuantity())));
            bricks = bricks.add(i.getPrice().multiply(BigDecimal.valueOf(i.getQuantity())));
        }
        List<BrickTrip> live = trips.stream().filter(t -> !CANCELLED.equals(t.getStatus())).toList();
        int tripCount = Math.max(live.size(), qty > 0 ? 1 : 0);
        BigDecimal perTrip = Money.nz(o.getDeliveryChargePerTrip());
        BigDecimal delivery = Boolean.TRUE.equals(o.getDeliveryWaived()) ? Money.ZERO : perTrip.multiply(BigDecimal.valueOf(tripCount));
        BigDecimal handling = Boolean.TRUE.equals(o.getHandlingBilled())
                ? Money.nz(o.getLoadingRate()).add(Money.nz(o.getUnloadingRate())).multiply(BigDecimal.valueOf(qty)) : Money.ZERO;
        int delivered = 0;
        BigDecimal billed = Money.ZERO;
        for (BrickTrip t : live) {
            if (!DELIVERED.equals(t.getStatus())) continue;
            List<BrickTripItem> ti = tripItems.getOrDefault(t.getId(), List.of());
            delivered += ti.stream().mapToInt(i -> i.getDelivered() == null ? i.getQuantity() : i.getDelivered()).sum();
            BigDecimal[] b = billOf(o, ti, items);
            billed = billed.add(b[0]).add(b[1]).add(b[2]);
        }
        boolean done = DELIVERED.equals(o.getStatus());
        BigDecimal total = Money.round(done ? billed : bricks.add(delivery).add(handling));
        BigDecimal paid = pays.stream().filter(p -> "POSTED".equals(p.getStatus())).map(BrickPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal claimed = pays.stream().filter(p -> "CLAIMED".equals(p.getStatus())).map(BrickPayment::getAmount).reduce(Money.ZERO, BigDecimal::add);
        if (CANCELLED.equals(o.getStatus())) total = Money.ZERO;
        return new Totals(qty, Money.round(atMrp), Money.round(atMrp.subtract(bricks)), Money.round(bricks), tripCount, perTrip, Money.round(delivery),
                Money.round(handling), total, delivered, Math.max(0, qty - delivered), Money.round(billed), paid, claimed, total.subtract(paid),
                Money.round(billed).subtract(paid));
    }

    private ItemView itemView(BrickOrderItem i, int[] f) {
        BrickType type = core.types().findById(i.getBrickTypeId()).orElse(null);
        BigDecimal mrp = i.getMrp();
        BigDecimal per = mrp == null ? Money.ZERO : mrp.subtract(i.getPrice()).max(Money.ZERO);
        BigDecimal pct = mrp == null || mrp.signum() == 0 ? Money.ZERO : per.multiply(Money.HUNDRED).divide(mrp, 2, RoundingMode.HALF_UP);
        return new ItemView(i.getBrickTypeId(), type == null ? "Bricks" : type.getName(), type == null ? null : type.getColor(), i.getQuantity(), mrp, i.getPrice(),
                per, pct, Money.round(per.multiply(BigDecimal.valueOf(i.getQuantity()))), Money.round(i.getPrice().multiply(BigDecimal.valueOf(i.getQuantity()))),
                f[0], f[1], f[2], Math.max(0, i.getQuantity() - f[0] - f[1] - f[2]));
    }

    private TripView tripView(BrickOrder o, BrickTrip tr, List<BrickTripItem> items, List<BrickOrderItem> ordered) {
        List<TripItemView> iv = items.stream().map(i -> {
            BrickType type = core.types().findById(i.getBrickTypeId()).orElse(null);
            return new TripItemView(i.getBrickTypeId(), type == null ? "Bricks" : type.getName(), type == null ? null : type.getColor(), i.getQuantity(), i.getDelivered());
        }).toList();
        BrickVehicle v = tr.getVehicleId() == null ? null : core.vehicles().findById(tr.getVehicleId()).orElse(null);
        BrickResource d = tr.getDriverId() == null ? null : core.resources().findById(tr.getDriverId()).orElse(null);
        boolean done = DELIVERED.equals(tr.getStatus());
        BigDecimal[] b = billOf(o, items, ordered);
        return new TripView(tr, iv, iv.stream().mapToInt(TripItemView::quantity).sum(),
                done ? iv.stream().mapToInt(x -> x.delivered() == null ? x.quantity() : x.delivered()).sum() : null,
                v == null ? (isHired(o) ? hiredLabel(o) : null) : v.getNumber(), v == null ? (isHired(o) ? "Hired" : null) : v.getKind(),
                d == null ? (isHired(o) ? o.getHiredContact() : null) : d.getName(), d == null ? null : d.getPhone(),
                core.resourceName(tr.getLoadingTeamId()), core.resourceName(tr.getUnloadingTeamId()), b[0].add(b[1]).add(b[2]),
                entryNo(tr.getJournalEntryId()), tr.getAckAt() != null);
    }

    static boolean isHired(BrickOrder o) {
        return Boolean.TRUE.equals(o.getHired());
    }

    static String hiredLabel(BrickOrder o) {
        return o.getHiredVehicle() != null ? o.getHiredVehicle() + " (hired)" : "Hired vehicle";
    }

    /** The trips of one of our vehicles, newest first. */
    public List<VehicleTrip> vehicleTrips(Long vehicleId) {
        core.requireVehicle(vehicleId);
        Long t = UserContext.tenantId();
        Map<Long, BrickOrder> orders = core.orders().findByTenantId(t).stream().collect(Collectors.toMap(BrickOrder::getId, Function.identity()));
        Map<Long, List<BrickTripItem>> items = core.tripItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickTripItem::getTripId));
        Comparator<BrickTrip> byDay = Comparator.comparing((BrickTrip tr) -> tr.getDeliveredAt() != null ? tr.getDeliveredAt().toLocalDate() : tr.getScheduledOn(),
                Comparator.nullsFirst(Comparator.naturalOrder())).thenComparing(BrickTrip::getId);
        return core.trips().findByTenantId(t).stream().filter(tr -> vehicleId.equals(tr.getVehicleId()) && !CANCELLED.equals(tr.getStatus()))
                .sorted(byDay.reversed())
                .map(tr -> {
                    BrickOrder o = orders.get(tr.getOrderId());
                    int bricks = items.getOrDefault(tr.getId(), List.of()).stream().mapToInt(i -> i.getDelivered() == null ? i.getQuantity() : i.getDelivered()).sum();
                    return new VehicleTrip(tr.getOrderId(), o == null ? "?" : o.getOrderNo(), o == null ? "?" : o.getCustomerName(), o == null ? null : o.getAddress(),
                            tr.getTripNo(), tr.getStatus(), tr.getScheduledOn(), tr.getDeliveredAt(), bricks, core.resourceName(tr.getDriverId()));
                }).toList();
    }

    static String statusLabel(String s) {
        return switch (s) {
            case RECEIVED -> "Order received";
            case LOADING -> "Loading at yard";
            case DISPATCHED -> "Dispatched";
            case IN_TRANSIT -> "On the way";
            case PART_DELIVERED -> "Partly delivered";
            case DELIVERED -> "Delivered";
            case CANCELLED -> "Cancelled";
            default -> s;
        };
    }

    static String tripLabel(String s) {
        return switch (s) {
            case PLANNED -> "Planned";
            case LOADING -> "Loading at yard";
            case DISPATCHED -> "Dispatched";
            case IN_TRANSIT -> "On the way";
            case DELIVERED -> "Delivered";
            case CANCELLED -> "Cancelled";
            default -> s;
        };
    }

    private static String mode(String m) {
        if (m == null || m.isBlank()) return "Cash";
        return PAY_MODES.stream().filter(x -> x.equalsIgnoreCase(m.trim())).findFirst().orElseThrow(() -> new BusinessException("Paid by cash, UPI, bank, cheque or card"));
    }

    private String entryNo(Long id) {
        return id == null ? null : core.entries().findById(id).map(com.aditya.personalbudget.domain.entity.JournalEntry::getEntryNo).orElse(null);
    }

    private BrickOrder requireOrder(Long id) {
        return core.orders().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Order", id));
    }

    private BrickOrder requireOpenOrder(Long id) {
        BrickOrder o = requireOrder(id);
        if (CANCELLED.equals(o.getStatus())) throw new BusinessException("This order was cancelled");
        if (DELIVERED.equals(o.getStatus())) throw new BusinessException("This order is fully delivered");
        return o;
    }

    private BrickTrip requireTrip(BrickOrder o, Long tripId) {
        return core.trips().findByIdAndTenantId(tripId, o.getTenantId()).filter(t -> t.getOrderId().equals(o.getId()))
                .orElseThrow(() -> new NotFoundException("Trip", tripId));
    }

    private BrickPayment requirePayment(BrickOrder o, Long paymentId) {
        return core.payments().findByIdAndTenantId(paymentId, o.getTenantId()).filter(p -> p.getOrderId().equals(o.getId()))
                .orElseThrow(() -> new NotFoundException("Payment", paymentId));
    }
}
