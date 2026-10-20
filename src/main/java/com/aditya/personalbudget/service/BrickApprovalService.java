package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.domain.entity.BrickOrderItem;
import com.aditya.personalbudget.domain.entity.BrickType;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.entity.PendingEntry;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.AttachmentRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.repository.PendingEntryRepository;
import com.aditya.personalbudget.security.ApprovalPolicy;
import com.aditya.personalbudget.security.BrickAccess;
import com.aditya.personalbudget.security.BrickPermission;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.BrickSalesService.ItemInput;
import com.aditya.personalbudget.service.BrickSalesService.OrderRequest;
import com.aditya.personalbudget.service.BrickSalesService.OrderView;
import com.aditya.personalbudget.service.BrickSalesService.WaiveRequest;
import com.aditya.personalbudget.service.PendingService.Step;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Maker-checker for orders, in the application's approval process: a request is a {@link PendingEntry} (kinds
 * {@code BRICK_ORDER_*}), so it waits in the same queue as every other entry (Activity → Approvals and Brick Management →
 * Approvals), with the same history, evidence and outcome.
 * <ul>
 *   <li>a maker (who cannot approve) records orders and runs their delivery; what touches the money waits for a checker:
 *       a new order below a brick type's lowest price, a change to an order's customer, bricks, prices or charges, its
 *       cancellation, and free delivery;</li>
 *   <li>the checker approves it (it is carried out then, as it was asked) or turns it down with a reason;</li>
 *   <li>the maker answers a rejection with a comment (and evidence attached to the request) and sends it again; the
 *       checker reviews it again. Every step is kept in its history.</li>
 * </ul>
 * Changes that do not touch the money (address, phone, the day needed, vehicle, teams, the trips' life cycle) never
 * wait. A checker's own orders and changes go through at once; so does everything when approval is switched off for the
 * installation or the organization, or for a user exempted from it.
 */
@Service
public class BrickApprovalService {

    public static final String NEW = "BRICK_ORDER_NEW";
    public static final String CHANGE = "BRICK_ORDER_CHANGE";
    public static final String CANCEL = "BRICK_ORDER_CANCEL";
    public static final String WAIVE = "BRICK_ORDER_WAIVE";

    public static boolean isBrick(String kind) {
        return kind != null && kind.startsWith("BRICK_");
    }

    /** What a request carries: the order it is about, why it needs a checker, the maker's word, and what was asked (JSON). */
    public record Payload(String kind, Long orderId, String customerName, List<String> reasons, String note, String request) {
    }

    public record ApprovalView(Long id, String approvalNo, String kind, String kindLabel, String status, Long orderId, String orderNo,
                               String customerName, String summary, List<String> reasons, String note, BigDecimal amount,
                               Long requestedById, String requestedBy, LocalDateTime requestedAt, String decidedBy, LocalDateTime decidedAt,
                               String decisionNote,
                               /* what the request carries (the order as asked), to show it */
                               OrderRequest request,
                               /* sent again after a rejection, every step so far, the evidence attached */
                               int resubmits, List<Step> history, int attachmentCount,
                               /* what the signed-in user may do with it */
                               boolean canDecide, boolean canWithdraw, boolean canResubmit, boolean canAttach) {
    }

    /** What saving gave: the order (made or changed), or the request that now waits for approval. */
    public record Outcome(OrderView order, ApprovalView pending) {
    }

    public record DecideRequest(@Size(max = 255) String note) {
    }

    private final BrickService core;
    private final BrickSalesService sales;
    private final PendingEntryRepository entries;
    private final PendingService pendingService;
    private final AttachmentRepository attachments;
    private final BrickNoticeService notices;
    private final BrickAccess access;
    private final ApprovalPolicy policy;
    private final AppUserRepository users;
    private final OrganizationRepository tenants;
    private final ObjectMapper json;

    public BrickApprovalService(BrickService core, BrickSalesService sales, PendingEntryRepository entries, @org.springframework.context.annotation.Lazy PendingService pendingService,
                                AttachmentRepository attachments, BrickNoticeService notices, BrickAccess access, ApprovalPolicy policy,
                                AppUserRepository users, OrganizationRepository tenants, ObjectMapper json) {
        this.core = core;
        this.sales = sales;
        this.entries = entries;
        this.pendingService = pendingService;
        this.attachments = attachments;
        this.notices = notices;
        this.access = access;
        this.policy = policy;
        this.users = users;
        this.tenants = tenants;
        this.json = json;
    }

    // ================================================================== the gate

    /** Do the signed-in user's changes in Brick Management wait for a checker (they cannot change what is recorded)? */
    public boolean waitsForChanges() {
        return waits();
    }

    /** Does what the signed-in user records here wait for a checker? Not for a checker, nor when approval is off for them. */
    boolean waits() {
        if (access.allows(BrickPermission.APPROVE)) return false;
        CurrentUser me = UserContext.current().filter(u -> u.userId() != null).orElse(null);
        if (me == null) return false;
        if (!policy.enabledGlobally()) return false;
        Organization t = tenants.findById(me.tenantId()).orElse(null);
        if (ApprovalPolicy.OFF.equals(ApprovalPolicy.modeOf(t))) return false;
        AppUser u = users.findById(me.userId()).orElse(null);
        return u == null || !Boolean.FALSE.equals(u.getApproval());   // a user exempted from approval never waits
    }

    /** A new order: made at once, unless a maker agreed a price below the lowest one (then it waits). */
    @Transactional
    public Outcome place(OrderRequest r, String note) {
        List<String> low = belowLowest(r.items());
        if (low.isEmpty() || !waits()) return new Outcome(sales.create(r), null);
        int qty = r.items().stream().mapToInt(ItemInput::quantity).sum();
        return new Outcome(null, submit(NEW, null, r.customerName(), r, BrickService.bricks(qty) + " for " + r.customerName().trim() + " below the lowest price",
                low, note, amountOf(r.items()), r.orderDate()));
    }

    /** A change to an order: what does not touch the money is saved; the rest waits for a checker. */
    @Transactional
    public Outcome change(Long id, OrderRequest r, String note) {
        BrickOrder o = order(id);
        if (!waits()) return new Outcome(sales.update(id, r), null);
        // a maker changes nothing recorded: every change to the order waits (what touches the money said first)
        List<String> reasons = new ArrayList<>(moneyChanges(o, r));
        reasons.addAll(detailChanges(o, r));
        if (reasons.isEmpty()) return new Outcome(sales.order(id), null);   // nothing changed
        refuseTwice(id, CHANGE);
        return new Outcome(sales.order(id), submit(CHANGE, o, o.getCustomerName(), r, "Change to " + o.getOrderNo() + " · " + o.getCustomerName(),
                reasons, note, amountOf(r.items()), o.getOrderDate()));
    }

    @Transactional
    public Outcome cancel(Long id, String note) {
        BrickOrder o = order(id);
        if (!waits()) return new Outcome(sales.cancel(id), null);
        refuseTwice(id, CANCEL);
        return new Outcome(sales.order(id), submit(CANCEL, o, o.getCustomerName(), null, "Cancel " + o.getOrderNo() + " · " + o.getCustomerName(),
                List.of("Cancelling an order"), note, totalOf(id), o.getOrderDate()));
    }

    @Transactional
    public Outcome waive(Long id, WaiveRequest w) {
        BrickOrder o = order(id);
        if (!waits()) return new Outcome(sales.waive(id, w), null);
        refuseTwice(id, WAIVE);
        String what = Boolean.TRUE.equals(w.waive()) ? "Free delivery for " : "Charge delivery again on ";
        return new Outcome(sales.order(id), submit(WAIVE, o, o.getCustomerName(), w, what + o.getOrderNo() + " · " + o.getCustomerName(),
                List.of(Boolean.TRUE.equals(w.waive()) ? "Delivery charges waived" + (w.reason() != null && !w.reason().isBlank() ? ": " + w.reason().trim() : "")
                        : "Delivery charged again"), null, totalOf(id), o.getOrderDate()));
    }

    /** The prices below a type's lowest one ("16X4X8 Dies at ₹30, below the lowest ₹32"). */
    List<String> belowLowest(List<ItemInput> items) {
        Map<Long, BrickType> types = core.types().findByTenantId(UserContext.tenantId()).stream().collect(Collectors.toMap(BrickType::getId, Function.identity()));
        List<String> out = new ArrayList<>();
        for (ItemInput i : items) {
            BrickType t = types.get(i.brickTypeId());
            if (t != null && t.getMinPrice() != null && i.price().compareTo(t.getMinPrice()) < 0) {
                out.add(t.getName() + " at " + ActivityService.money(i.price()) + ", below the lowest " + ActivityService.money(t.getMinPrice()));
            }
        }
        return out;
    }

    /** What a change would do to the money: the customer, bricks, prices, charges, free delivery, who pays the transport. */
    private List<String> moneyChanges(BrickOrder o, OrderRequest r) {
        List<String> out = new ArrayList<>();
        if (!o.getCustomerName().trim().equalsIgnoreCase(r.customerName().trim())) out.add("Customer: " + o.getCustomerName() + " → " + r.customerName().trim());
        Map<Long, BrickOrderItem> had = core.orderItems().findByOrderId(o.getId()).stream()
                .collect(Collectors.toMap(BrickOrderItem::getBrickTypeId, Function.identity(), (a, b) -> a));
        for (ItemInput i : r.items()) {
            BrickOrderItem h = had.get(i.brickTypeId());
            String name = core.typeName(i.brickTypeId());
            if (h == null) out.add(name + ": added, " + String.format("%,d", i.quantity()) + " at " + ActivityService.money(i.price()));
            else {
                if (!h.getQuantity().equals(i.quantity())) out.add(name + ": " + String.format("%,d", h.getQuantity()) + " → " + String.format("%,d", i.quantity()) + " bricks");
                if (h.getPrice().compareTo(i.price()) != 0) out.add(name + ": price " + ActivityService.money(h.getPrice()) + " → " + ActivityService.money(i.price()));
            }
        }
        had.keySet().stream().filter(k -> r.items().stream().noneMatch(i -> i.brickTypeId().equals(k))).forEach(k -> out.add(core.typeName(k) + ": taken off the order"));
        if (r.deliveryChargePerTrip() != null && (o.getDeliveryChargePerTrip() == null || r.deliveryChargePerTrip().compareTo(o.getDeliveryChargePerTrip()) != 0)) {
            out.add("Delivery a trip: " + (o.getDeliveryChargePerTrip() == null ? "—" : ActivityService.money(o.getDeliveryChargePerTrip())) + " → " + ActivityService.money(r.deliveryChargePerTrip()));
        }
        if (r.waiveDelivery() != null && r.waiveDelivery() != Boolean.TRUE.equals(o.getDeliveryWaived())) out.add(r.waiveDelivery() ? "Free delivery" : "Delivery charged");
        if (r.handlingBilled() != null && r.handlingBilled() != Boolean.TRUE.equals(o.getHandlingBilled())) out.add(r.handlingBilled() ? "Loading & unloading billed" : "Loading & unloading not billed");
        boolean hired = Boolean.TRUE.equals(r.hired());
        if (hired != Boolean.TRUE.equals(o.getHired())) out.add(hired ? "Delivered by a hired vehicle" : "Delivered by our vehicle");
        else if (hired && (!Objects.equals(r.hiredPaidBy(), o.getHiredPaidBy())
                || (r.hiredCharge() == null ? o.getHiredCharge() != null : o.getHiredCharge() == null || r.hiredCharge().compareTo(o.getHiredCharge()) != 0))) {
            out.add("The hired vehicle's charge or who pays it");
        }
        out.addAll(belowLowest(r.items()));
        return out;
    }

    /** The rest of what a change does: where, when and how the order is delivered. */
    private List<String> detailChanges(BrickOrder o, OrderRequest r) {
        List<String> out = new ArrayList<>();
        java.util.function.BiConsumer<String, Object[]> diff = (what, ab) -> {
            String a = ab[0] == null ? "" : String.valueOf(ab[0]).trim(), b = ab[1] == null ? "" : String.valueOf(ab[1]).trim();
            if (!a.equalsIgnoreCase(b)) out.add(what + ": " + (a.isEmpty() ? "—" : a) + " → " + (b.isEmpty() ? "—" : b));
        };
        diff.accept("Mobile", new Object[]{o.getCustomerPhone(), r.customerPhone()});
        diff.accept("Address", new Object[]{o.getAddress(), r.address()});
        diff.accept("Landmark", new Object[]{o.getLandmark(), r.landmark()});
        diff.accept("Order date", new Object[]{o.getOrderDate(), r.orderDate()});
        diff.accept("Needed by", new Object[]{o.getRequiredBy(), r.requiredBy()});
        diff.accept("Note", new Object[]{o.getNote(), r.note()});
        if (!Boolean.TRUE.equals(r.hired())) {
            if (r.vehicleId() != null && !r.vehicleId().equals(o.getVehicleId())) out.add("Vehicle changed");
            if (r.driverId() != null && !r.driverId().equals(o.getDriverId())) out.add("Driver changed");
        }
        if (!Objects.equals(r.loadingTeamId(), o.getLoadingTeamId())) out.add("Loading team changed");
        if (!Objects.equals(r.unloadingTeamId(), o.getUnloadingTeamId()) || Boolean.TRUE.equals(r.unloadingOutside()) != Boolean.TRUE.equals(o.getUnloadingOutside())) {
            out.add("Unloading changed");
        }
        if (!Objects.equals(r.plannedTrips(), o.getPlannedTrips())) out.add("Number of trips: " + (o.getPlannedTrips() == null ? "as the vehicle carries" : o.getPlannedTrips())
                + " → " + (r.plannedTrips() == null ? "as the vehicle carries" : r.plannedTrips()));
        return out;
    }

    private void refuseTwice(Long orderId, String kind) {
        entries.findByTenantId(UserContext.tenantId()).stream()
                .filter(p -> kind.equals(p.getKind()) && (PendingEntry.PENDING.equals(p.getStatus()) || PendingEntry.REJECTED.equals(p.getStatus())))
                .filter(p -> orderId.equals(payload(p).orderId())).findFirst().ifPresent(p -> {
                    throw new BusinessException(numberOf(p) + " already asks for this (" + p.getStatus().toLowerCase()
                            + "); answer or withdraw it in Approvals before asking again");
                });
    }

    private ApprovalView submit(String kind, BrickOrder o, String customer, Object request, String summary, List<String> reasons, String note,
                                BigDecimal amount, LocalDate day) {
        CurrentUser me = UserContext.get();
        PendingEntry p = new PendingEntry();
        p.setTenantId(me.tenantId());
        p.setKind(kind);
        p.setPayload(json.writeValueAsString(new Payload(kind, o == null ? null : o.getId(), ActivityService.cut(customer.trim(), 100), reasons,
                blank(note), request == null ? null : json.writeValueAsString(request))));
        p.setSummary(ActivityService.cut(summary, 255));
        p.setAmount(Money.round(amount == null ? BigDecimal.ZERO : amount));
        p.setEntryDate(day == null ? LocalDate.now() : day);
        p.setSubmittedBy(me.fullName());
        p.setSubmittedById(me.userId());
        p.setSubmittedAt(LocalDateTime.now());
        p.setStatus(PendingEntry.PENDING);
        p.setResubmits(0);
        pendingService.step(p, "SUBMITTED", blank(note));
        PendingEntry saved = entries.save(p);
        core.note("SUBMITTED", "Approval " + numberOf(saved) + " asked: " + saved.getSummary());
        notices.post(me.tenantId(), "APPROVAL", "Waiting for approval: " + kindLabel(kind).toLowerCase(), numberOf(saved) + " · " + saved.getSummary()
                + " · asked by " + me.fullName(), "bricks/approvals/" + saved.getId(), BrickNoticeService.CHECKERS);
        return view(saved);
    }

    // ================================================================== the checker and the maker

    /** The order requests: a checker sees them all; a maker sees what they asked. */
    public List<ApprovalView> list() {
        Long me = UserContext.current().map(CurrentUser::userId).orElse(null);
        boolean checker = access.allows(BrickPermission.APPROVE);
        return entries.findByTenantId(UserContext.tenantId()).stream().filter(this::ours)
                .filter(p -> checker || Objects.equals(p.getSubmittedById(), me))
                .sorted(Comparator.comparing((PendingEntry p) -> order(p.getStatus())).thenComparing(PendingEntry::getId, Comparator.reverseOrder()))
                .map(this::view).toList();
    }

    private static int order(String status) {
        return PendingEntry.PENDING.equals(status) ? 0 : PendingEntry.REJECTED.equals(status) ? 1 : 2;
    }

    public ApprovalView get(Long id) {
        PendingEntry p = require(id);
        if (!access.allows(BrickPermission.APPROVE) && !Objects.equals(p.getSubmittedById(), UserContext.current().map(CurrentUser::userId).orElse(null))) {
            throw new NotFoundException("Approval", id);
        }
        return view(p);
    }

    /** Approves it: what was asked is carried out now, as it was asked (refused, with nothing changed, if it no longer can be). */
    @Transactional
    public ApprovalView approve(Long id, DecideRequest d) {
        access.require(BrickPermission.APPROVE);
        PendingEntry p = waiting(id);
        Payload x = payload(p);
        OrderView v = switch (p.getKind()) {
            case NEW -> {
                OrderView made = sales.create(json.readValue(x.request(), OrderRequest.class));
                // the order is the maker's: they took it
                users.findById(p.getSubmittedById()).ifPresent(u -> {
                    BrickOrder o = order(made.order().getId());
                    o.setCreatedBy(u.getUsername());
                    core.orders().save(o);
                });
                yield made;
            }
            case CHANGE -> sales.update(x.orderId(), json.readValue(x.request(), OrderRequest.class));
            case CANCEL -> sales.cancel(x.orderId());
            case WAIVE -> sales.waive(x.orderId(), json.readValue(x.request(), WaiveRequest.class));
            default -> throw new BusinessException("Unknown request " + p.getKind());
        };
        if (x.orderId() == null) {
            p.setPayload(json.writeValueAsString(new Payload(x.kind(), v.order().getId(), x.customerName(), x.reasons(), x.note(), x.request())));
        }
        decide(p, PendingEntry.APPROVED, d == null ? null : blank(d.note()));
        notices.post(p.getTenantId(), "DECISION", "Approved: " + kindLabel(p.getKind()).toLowerCase(), numberOf(p) + " · " + p.getSummary()
                + (NEW.equals(p.getKind()) ? " · order " + v.order().getOrderNo() + " made" : ""), "bricks/sales/" + v.order().getId(), BrickNoticeService.user(p.getSubmittedById()));
        return view(p);
    }

    /** Turns it down, with the reason the maker needs to answer it. */
    @Transactional
    public ApprovalView reject(Long id, DecideRequest d) {
        access.require(BrickPermission.APPROVE);
        PendingEntry p = waiting(id);
        String why = d == null ? null : blank(d.note());
        if (why == null) throw new BusinessException("Say why it is turned down, so the maker knows what to answer");
        decide(p, PendingEntry.REJECTED, why);
        notices.post(p.getTenantId(), "DECISION", "Turned down: " + kindLabel(p.getKind()).toLowerCase(), numberOf(p) + " · " + p.getSummary() + " · “" + why + "”",
                "bricks/approvals/" + p.getId(), BrickNoticeService.user(p.getSubmittedById()));
        return view(p);
    }

    /**
     * The maker answers a rejection (or adds to what waits): a comment, with any evidence attached to the request, and
     * it waits for a checker again; the rejection and the answer stay in its history.
     */
    @Transactional
    public ApprovalView resubmit(Long id, DecideRequest d) {
        PendingEntry p = own(id);
        boolean rejected = PendingEntry.REJECTED.equals(p.getStatus());
        if (!rejected && !PendingEntry.PENDING.equals(p.getStatus())) throw new BusinessException("Already " + p.getStatus().toLowerCase());
        String comment = d == null ? null : blank(d.note());
        if (comment == null) throw new BusinessException(rejected ? "Answer the reason it was turned down" : "Write what you add");
        if (rejected) {
            p.setResubmits((p.getResubmits() == null ? 0 : p.getResubmits()) + 1);
            p.setReviewedBy(null);
            p.setReviewedAt(null);
            p.setReviewNote(null);
        }
        p.setStatus(PendingEntry.PENDING);
        p.setSubmittedAt(LocalDateTime.now());
        int evidence = attachments.findByPendingEntryId(p.getId()).size();
        pendingService.step(p, rejected ? "RESUBMITTED" : "EDITED", comment + (evidence > 0 ? " · " + evidence + " attached" : ""));
        entries.save(p);
        core.note("SUBMITTED", "Approval " + numberOf(p) + (rejected ? " sent again: " : " added to: ") + comment);
        notices.post(p.getTenantId(), "APPROVAL", (rejected ? "Sent again for approval: " : "Added to a request: ") + kindLabel(p.getKind()).toLowerCase(),
                numberOf(p) + " · " + p.getSummary() + " · “" + comment + "”", "bricks/approvals/" + p.getId(), BrickNoticeService.CHECKERS);
        return view(p);
    }

    /** The maker takes back what they asked, while it waits or after a rejection. */
    @Transactional
    public ApprovalView withdraw(Long id) {
        PendingEntry p = own(id);
        if (!PendingEntry.PENDING.equals(p.getStatus()) && !PendingEntry.REJECTED.equals(p.getStatus())) {
            throw new BusinessException("Already " + p.getStatus().toLowerCase());
        }
        p.setStatus(PendingEntry.WITHDRAWN);
        pendingService.step(p, "WITHDRAWN", null);
        entries.save(p);
        core.note("DELETED", "Approval " + numberOf(p) + " withdrawn: " + p.getSummary());
        return view(p);
    }

    /** What waits for the signed-in user to act on: a checker, what waits; a maker, what was turned down. */
    public long pendingCount() {
        boolean checker = access.allows(BrickPermission.APPROVE);
        return list().stream().filter(a -> checker ? PendingEntry.PENDING.equals(a.status()) : PendingEntry.REJECTED.equals(a.status())).count();
    }

    private void decide(PendingEntry p, String status, String note) {
        p.setStatus(status);
        p.setReviewedBy(UserContext.current().map(CurrentUser::fullName).orElse(null));
        p.setReviewedAt(LocalDateTime.now());
        p.setReviewNote(note == null ? null : ActivityService.cut(note, 255));
        pendingService.step(p, status, p.getReviewNote());
        entries.save(p);
        core.note(PendingEntry.APPROVED.equals(status) ? "APPROVED" : "REJECTED", "Approval " + numberOf(p) + " " + status.toLowerCase() + ": " + p.getSummary()
                + (note != null ? " · " + note : ""));
    }

    private PendingEntry waiting(Long id) {
        PendingEntry p = require(id);
        if (!PendingEntry.PENDING.equals(p.getStatus())) {
            throw new BusinessException(numberOf(p) + " was already " + p.getStatus().toLowerCase() + (p.getReviewedBy() != null ? " by " + p.getReviewedBy() : ""));
        }
        if (Objects.equals(p.getSubmittedById(), UserContext.current().map(CurrentUser::userId).orElse(null))) {
            throw new ForbiddenException("Someone else has to approve what you asked");
        }
        return p;
    }

    private PendingEntry own(Long id) {
        PendingEntry p = require(id);
        if (!Objects.equals(p.getSubmittedById(), UserContext.current().map(CurrentUser::userId).orElse(null))) {
            throw new ForbiddenException("Only who asked can answer or withdraw it");
        }
        return p;
    }

    private PendingEntry require(Long id) {
        PendingEntry p = entries.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Approval", id));
        if (!ours(p)) throw new NotFoundException("Approval", id);
        return p;
    }

    /** An order request, or a change asked in Brick Management (a batch, a purchase, an expense, a payment). */
    boolean ours(PendingEntry p) {
        if (isBrick(p.getKind())) return true;
        if (!PendingService.CHANGE.equals(p.getKind())) return false;
        PendingService.ChangePayload c = pendingService.change(p);
        return c.uri() != null && c.uri().startsWith("/api/bricks/");
    }

    public boolean isChange(Long id) {
        return entries.findByIdAndTenantId(id, UserContext.tenantId()).map(p -> PendingService.CHANGE.equals(p.getKind())).orElse(false);
    }

    private BrickOrder order(Long id) {
        return core.orders().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Order", id));
    }

    Payload payload(PendingEntry p) {
        try {
            return json.readValue(p.getPayload(), Payload.class);
        } catch (RuntimeException e) {
            return new Payload(p.getKind(), null, null, List.of(), null, null);
        }
    }

    public static String numberOf(PendingEntry p) {
        return String.format("AP-%04d", p.getId());
    }

    /** The order's total, as it stands (what a cancellation or free delivery is about). */
    private BigDecimal totalOf(Long orderId) {
        BigDecimal t = sales.order(orderId).totals().total();
        return t == null ? BigDecimal.ZERO : t;
    }

    private static BigDecimal amountOf(List<ItemInput> items) {
        return items.stream().map(i -> i.price().multiply(BigDecimal.valueOf(i.quantity()))).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    public static String kindLabel(String kind) {
        return switch (kind) {
            case NEW -> "New order below the lowest price";
            case CHANGE -> "Change to an order";
            case CANCEL -> "Cancel an order";
            case WAIVE -> "Free delivery";
            default -> kind;
        };
    }

    public ApprovalView view(PendingEntry p) {
        Long me = UserContext.current().map(CurrentUser::userId).orElse(null);
        if (PendingService.CHANGE.equals(p.getKind())) {
            PendingService.ChangePayload c = pendingService.change(p);
            boolean pending = PendingEntry.PENDING.equals(p.getStatus()), rejected = PendingEntry.REJECTED.equals(p.getStatus());
            boolean mine = Objects.equals(p.getSubmittedById(), me);
            return new ApprovalView(p.getId(), numberOf(p), p.getKind(), "Change to what is recorded", p.getStatus(), null, null, null, c.label(),
                    c.fields() == null ? List.of() : c.fields(), null, p.getAmount(), p.getSubmittedById(), p.getSubmittedBy(), p.getSubmittedAt(),
                    p.getReviewedBy(), p.getReviewedAt(), p.getReviewNote(), null, p.getResubmits() == null ? 0 : p.getResubmits(), pendingService.historyOf(p),
                    attachments.findByPendingEntryId(p.getId()).size(), pending && !mine && access.allows(BrickPermission.APPROVE),
                    (pending || rejected) && mine, (pending || rejected) && mine, (pending || rejected) && mine);
        }
        Payload x = payload(p);
        boolean pending = PendingEntry.PENDING.equals(p.getStatus()), rejected = PendingEntry.REJECTED.equals(p.getStatus());
        boolean mine = Objects.equals(p.getSubmittedById(), me);
        String orderNo = x.orderId() == null ? null : core.orders().findById(x.orderId()).map(BrickOrder::getOrderNo).orElse(null);
        OrderRequest request = null;
        if (x.request() != null && (NEW.equals(p.getKind()) || CHANGE.equals(p.getKind()))) {
            try {
                request = json.readValue(x.request(), OrderRequest.class);
            } catch (RuntimeException e) {
                request = null;
            }
        }
        return new ApprovalView(p.getId(), numberOf(p), p.getKind(), kindLabel(p.getKind()), p.getStatus(), x.orderId(), orderNo, x.customerName(),
                p.getSummary(), x.reasons() == null ? List.of() : x.reasons(), x.note(), p.getAmount(), p.getSubmittedById(), p.getSubmittedBy(), p.getSubmittedAt(),
                p.getReviewedBy(), p.getReviewedAt(), p.getReviewNote(), request, p.getResubmits() == null ? 0 : p.getResubmits(), pendingService.historyOf(p),
                attachments.findByPendingEntryId(p.getId()).size(),
                pending && !mine && access.allows(BrickPermission.APPROVE), (pending || rejected) && mine, (pending || rejected) && mine, (pending || rejected) && mine);
    }
}
