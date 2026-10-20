package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickBatch;
import com.aditya.personalbudget.domain.entity.BrickBatchItem;
import com.aditya.personalbudget.domain.entity.BrickEarning;
import com.aditya.personalbudget.domain.entity.BrickExpense;
import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.domain.entity.BrickMaterialPurchase;
import com.aditya.personalbudget.domain.entity.BrickOrder;
import com.aditya.personalbudget.domain.entity.BrickOrderItem;
import com.aditya.personalbudget.domain.entity.BrickPaySlip;
import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.domain.entity.BrickTrip;
import com.aditya.personalbudget.domain.entity.BrickTripItem;
import com.aditya.personalbudget.domain.entity.BrickVehicle;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.BrickService.MaterialFlow;
import com.aditya.personalbudget.service.BrickService.MaterialStock;
import com.aditya.personalbudget.service.BrickService.TypeStock;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.TemporalAdjusters;
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
 * The brick business in figures: the dashboard (today, this week and month, stock, raw material cover, the order
 * pipeline, weekly production against deliveries, monthly profit) and the reports for a period (profit and loss, cost
 * a brick, production by type and team, raw material used per 1,000 bricks, sales by type and customer, deliveries
 * by vehicle and the team's pay), with plain-language insights.
 */
@Service
public class BrickInsightService {

    public record Kpis(int producedToday, int producedWeek, int producedMonth, int inYard, int ready, int curing, int booked, int available,
                       int openOrders, int pendingBricks, int tripsToday, int onTheWay, BigDecimal salesMonth, BigDecimal receiptsMonth,
                       BigDecimal profitMonth, BigDecimal receivable, BigDecimal advancesHeld, BigDecimal wagesDue, BigDecimal advancesOutstanding,
                       BigDecimal cashInBook, int lowMaterials, int overdueOrders, int awaitingConfirmation) {
    }

    public record WeekPoint(String label, LocalDate weekStart, int produced, int delivered, BigDecimal sales) {
    }

    public record MonthPoint(String month, BigDecimal revenue, BigDecimal materials, BigDecimal wages, BigDecimal expenses, BigDecimal profit,
                             BigDecimal margin, int produced, int delivered) {
    }

    public record Insight(String tone, String icon, String title, String text) {
    }

    public record UpcomingTrip(Long orderId, String orderNo, int tripNo, String customer, String status, LocalDate scheduledOn, int bricks,
                               String vehicle, boolean late) {
    }

    public record Dashboard(Kpis kpis, List<TypeStock> stock, List<MaterialStock> materials, List<WeekPoint> weeks, List<MonthPoint> months,
                            Map<String, Integer> pipeline, List<UpcomingTrip> upcoming, List<Insight> insights,
                            List<BrickSalesService.Customer> topCustomers,
                            /* customers who owe for bricks, the most first */
                            List<BrickSalesService.Customer> dues) {
    }

    public record Named(String name, BigDecimal amount, int count, BigDecimal quantity) {
    }

    public record TypeRow(Long brickTypeId, String name, String color, int produced, int damaged, int delivered, BigDecimal sales, BigDecimal discount,
                          BigDecimal avgPrice, BigDecimal mrp) {
    }

    public record TeamRow(Long resourceId, String name, int batches, int bricks, int damaged, BigDecimal labour) {
    }

    public record MaterialRow(Long materialId, String name, String unit, BigDecimal consumed, BigDecimal perThousand, BigDecimal bought,
                              BigDecimal spent, BigDecimal avgRate, BigDecimal stock) {
    }

    public record VehicleRow(String vehicle, int trips, int bricks, BigDecimal incentives) {
    }

    public record PayRow(Long resourceId, String name, String role, int slips, BigDecimal gross, BigDecimal deductions, BigDecimal net,
                         BigDecimal advancesGiven, BigDecimal outstanding, BigDecimal unpaid) {
    }

    public record Summary(int produced, int damaged, BigDecimal damagePercent, int delivered, int orders, int trips, BigDecimal revenue,
                          BigDecimal sales, BigDecimal deliveryIncome, BigDecimal handlingIncome, BigDecimal materials, BigDecimal wages,
                          BigDecimal handlingWages, BigDecimal salaries, BigDecimal expenses, BigDecimal totalCost, BigDecimal profit, BigDecimal margin,
                          BigDecimal costPerBrick, BigDecimal pricePerBrick, BigDecimal discountGiven, BigDecimal discountPercent, BigDecimal received,
                          BigDecimal receivable) {
    }

    public record Report(LocalDate from, LocalDate to, Summary summary, List<MonthPoint> months, List<TypeRow> types, List<TeamRow> teams,
                         List<MaterialRow> materials, List<Named> expenseHeads, List<BrickSalesService.OrderRow> orders,
                         List<BrickSalesService.Customer> customers, List<VehicleRow> vehicles, List<PayRow> pay, List<Insight> insights,
                         List<BrickProductionService.BatchView> batches) {
    }

    private final BrickService core;
    private final BrickSalesService sales;
    private final BrickPayrollService payroll;
    private final BrickProductionService production;

    public BrickInsightService(BrickService core, BrickSalesService sales, BrickPayrollService payroll, BrickProductionService production) {
        this.core = core;
        this.sales = sales;
        this.payroll = payroll;
        this.production = production;
    }

    // ================================================================== dashboard

    public Dashboard dashboard() {
        Long t = UserContext.tenantId();
        LocalDate today = LocalDate.now();
        Map<String, Account> book = book();
        LedgerSnapshot snap = core.ledger().snapshot();
        List<TypeStock> stock = core.brickStock();
        List<MaterialStock> mats = core.materialStock();
        Map<LocalDate, Integer> made = madeByDay();
        Map<LocalDate, Integer> delivered = deliveredByDay();
        int producedToday = made.getOrDefault(today, 0);
        int producedWeek = sumDays(made, today.minusDays(6), today);
        int producedMonth = sumDays(made, today.withDayOfMonth(1), today);

        List<BrickSalesService.OrderRow> orders = sales.orders();
        List<BrickSalesService.OrderRow> open = orders.stream().filter(o -> !Set.of(BrickSalesService.DELIVERED, BrickSalesService.CANCELLED).contains(o.status())).toList();
        Map<String, Integer> pipeline = new LinkedHashMap<>();
        for (String s : List.of(BrickSalesService.RECEIVED, BrickSalesService.LOADING, BrickSalesService.DISPATCHED, BrickSalesService.IN_TRANSIT, BrickSalesService.PART_DELIVERED)) {
            pipeline.put(s, (int) open.stream().filter(o -> o.status().equals(s)).count());
        }
        pipeline.put(BrickSalesService.DELIVERED, (int) orders.stream().filter(o -> BrickSalesService.DELIVERED.equals(o.status())
                && o.orderDate().isAfter(today.minusDays(30))).count());
        int overdue = (int) open.stream().filter(o -> o.requiredBy() != null && o.requiredBy().isBefore(today)).count();

        List<UpcomingTrip> upcoming = upcoming();
        int tripsToday = (int) upcoming.stream().filter(u -> today.equals(u.scheduledOn())).count();
        int onTheWay = (int) upcoming.stream().filter(u -> Set.of(BrickSalesService.DISPATCHED, BrickSalesService.IN_TRANSIT).contains(u.status())).count();

        YearMonth ym = YearMonth.from(today);
        MonthPoint thisMonth = month(snap, book, ym, made, delivered);
        BigDecimal receipts = credits(snap, book.get("CUSTOMERS"), ym.atDay(1), today);
        BigDecimal customers = balance(snap, book.get("CUSTOMERS"));
        BigDecimal cash = core.accounts().findByTenantId(t).stream().filter(a -> a.isBrickBook() && a.getAccountType().isLiquid())
                .map(a -> snap.balanceAsOf(a.getId(), BrickService.FOREVER)).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal wagesDue = core.earnings().findByTenantId(t).stream().filter(e -> e.getSlipId() == null).map(BrickEarning::getAmount).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal adv = payroll.advances(null).stream().map(BrickPayrollService.AdvanceView::outstanding).reduce(Money.ZERO, BigDecimal::add);
        int claimed = (int) core.payments().findByTenantId(t).stream().filter(p -> "CLAIMED".equals(p.getStatus())).count();

        int inYard = stock.stream().mapToInt(TypeStock::inYard).sum();
        int ready = stock.stream().mapToInt(TypeStock::ready).sum();
        int curing = stock.stream().mapToInt(TypeStock::curing).sum();
        int booked = stock.stream().mapToInt(TypeStock::booked).sum();
        Kpis k = new Kpis(producedToday, producedWeek, producedMonth, inYard, ready, curing, booked, inYard - booked, open.size(),
                open.stream().mapToInt(o -> o.quantity() - o.delivered()).sum(), tripsToday, onTheWay, thisMonth.revenue(), receipts, thisMonth.profit(),
                customers.max(Money.ZERO), customers.min(Money.ZERO).negate(), wagesDue, adv, cash, (int) mats.stream().filter(MaterialStock::low).count(),
                overdue, claimed);

        // twelve weeks, Monday to Sunday
        List<WeekPoint> weeks = new ArrayList<>();
        LocalDate monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Account salesAcc = book.get("SALES");
        for (int i = 11; i >= 0; i--) {
            LocalDate from = monday.minusWeeks(i), to = from.plusDays(6);
            BigDecimal value = salesAcc == null ? Money.ZERO : Money.nz(snap.movementsBetween(from, to).get(salesAcc.getId()));
            weeks.add(new WeekPoint(from.getDayOfMonth() + " " + from.getMonth().getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH),
                    from, sumDays(made, from, to), sumDays(delivered, from, to), value));
        }
        List<MonthPoint> months = new ArrayList<>();
        for (int i = 5; i >= 0; i--) months.add(month(snap, book, ym.minusMonths(i), made, delivered));

        List<Insight> insights = insights(k, stock, mats, open, upcoming, months, today);
        List<BrickSalesService.Customer> all = sales.customers();
        List<BrickSalesService.Customer> top = all.stream().sorted(Comparator.comparing(BrickSalesService.Customer::value).reversed()).limit(6).toList();
        List<BrickSalesService.Customer> dues = all.stream().filter(c -> c.balance().signum() > 0)
                .sorted(Comparator.comparing(BrickSalesService.Customer::balance).reversed()).limit(8).toList();
        return new Dashboard(k, stock, mats, weeks, months, pipeline, upcoming.stream().limit(12).toList(), insights, top, dues);
    }

    private List<UpcomingTrip> upcoming() {
        Long t = UserContext.tenantId();
        LocalDate today = LocalDate.now();
        Map<Long, BrickOrder> orders = core.orders().findByTenantId(t).stream().collect(Collectors.toMap(BrickOrder::getId, Function.identity()));
        Map<Long, String> vehicles = core.vehicles().findByTenantId(t).stream().collect(Collectors.toMap(BrickVehicle::getId, BrickVehicle::getNumber));
        Map<Long, Integer> qty = core.tripItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickTripItem::getTripId, Collectors.summingInt(BrickTripItem::getQuantity)));
        return core.trips().findByTenantId(t).stream()
                .filter(tr -> !Set.of(BrickSalesService.DELIVERED, BrickSalesService.CANCELLED).contains(tr.getStatus()))
                .filter(tr -> orders.containsKey(tr.getOrderId()) && !BrickSalesService.CANCELLED.equals(orders.get(tr.getOrderId()).getStatus()))
                .sorted(Comparator.comparing((BrickTrip tr) -> BrickSalesService.STEPS.indexOf(tr.getStatus())).reversed()
                        .thenComparing(tr -> tr.getScheduledOn() == null ? LocalDate.MAX : tr.getScheduledOn()).thenComparing(BrickTrip::getTripNo))
                .map(tr -> {
                    BrickOrder o = orders.get(tr.getOrderId());
                    return new UpcomingTrip(o.getId(), o.getOrderNo(), tr.getTripNo(), o.getCustomerName(), tr.getStatus(), tr.getScheduledOn(),
                            qty.getOrDefault(tr.getId(), 0), tr.getVehicleId() == null ? null : vehicles.get(tr.getVehicleId()),
                            tr.getScheduledOn() != null && tr.getScheduledOn().isBefore(today));
                }).toList();
    }

    private List<Insight> insights(Kpis k, List<TypeStock> stock, List<MaterialStock> mats, List<BrickSalesService.OrderRow> open,
                                   List<UpcomingTrip> upcoming, List<MonthPoint> months, LocalDate today) {
        List<Insight> out = new ArrayList<>();
        for (MaterialStock m : mats) {
            if (m.low()) {
                out.add(new Insight("critical", "alert", m.name() + " is running low", strip(m.stock()) + " " + m.unit() + " left"
                        + (m.daysLeft() != null ? ", about " + m.daysLeft() + " day" + (m.daysLeft() == 1 ? "" : "s") + " of production" : "") + ". Order more now."));
            }
        }
        for (TypeStock s : stock) {
            if (s.available() < 0) {
                out.add(new Insight("warning", "layers", "Short of " + s.name(), "Open orders need " + String.format("%,d", s.booked()) + " but the yard has "
                        + String.format("%,d", Math.max(0, s.inYard())) + ". Plan " + String.format("%,d", -s.available()) + " more in the next batches."));
            } else if (s.curing() > 0 && s.ready() < s.booked()) {
                out.add(new Insight("info", "hourglass", s.name() + ": curing", String.format("%,d", s.curing()) + " are still curing; only "
                        + String.format("%,d", s.ready()) + " are ready for the " + String.format("%,d", s.booked()) + " booked."));
            }
        }
        if (k.overdueOrders() > 0) {
            out.add(new Insight("warning", "clock", k.overdueOrders() + " order" + (k.overdueOrders() == 1 ? " is" : "s are") + " late",
                    "Past the day the customer needed them: " + open.stream().filter(o -> o.requiredBy() != null && o.requiredBy().isBefore(today))
                            .map(BrickSalesService.OrderRow::orderNo).limit(4).collect(Collectors.joining(", ")) + "."));
        }
        long lateTrips = upcoming.stream().filter(UpcomingTrip::late).count();
        if (lateTrips > 0) out.add(new Insight("warning", "calendar", lateTrips + " trip" + (lateTrips == 1 ? "" : "s") + " past the planned day", "Send them or plan them again."));
        if (k.awaitingConfirmation() > 0) {
            out.add(new Insight("info", "check-circle", k.awaitingConfirmation() + " customer payment" + (k.awaitingConfirmation() == 1 ? "" : "s") + " to confirm",
                    "Reported on the order link; check the bank and confirm them on the order."));
        }
        if (k.wagesDue().signum() > 0) {
            out.add(new Insight("info", "users", "Wages due " + ActivityService.money(k.wagesDue()), "Work done and not paid yet. Make the weekly payment slips on Payments."));
        }
        if (k.receivable().signum() > 0) {
            out.add(new Insight("warning", "hand-coins", ActivityService.money(k.receivable()) + " to collect", "Customers owe this for bricks already delivered."));
        }
        if (months.size() >= 2) {
            MonthPoint a = months.get(months.size() - 2), b = months.getLast();
            if (a.revenue().signum() > 0 && a.margin() != null && b.margin() != null && b.revenue().signum() > 0) {
                BigDecimal d = b.margin().subtract(a.margin());
                if (d.abs().compareTo(BigDecimal.valueOf(5)) >= 0) {
                    out.add(new Insight(d.signum() > 0 ? "good" : "warning", d.signum() > 0 ? "trending" : "trending-down", "Margin " + (d.signum() > 0 ? "up" : "down")
                            + " " + d.abs().setScale(1, RoundingMode.HALF_UP) + " points", "This month's profit margin is " + b.margin().setScale(1, RoundingMode.HALF_UP)
                            + "% against " + a.margin().setScale(1, RoundingMode.HALF_UP) + "% last month."));
                }
            }
        }
        if (out.isEmpty()) out.add(new Insight("good", "check-circle", "All in order", "Stock covers the open orders and nothing is overdue."));
        return out;
    }

    // ================================================================== report

    public Report report(LocalDate from, LocalDate to) {
        Long t = UserContext.tenantId();
        Map<String, Account> book = book();
        LedgerSnapshot snap = core.ledger().snapshot();
        Map<Long, BigDecimal> mv = snap.movementsBetween(from, to);
        java.util.function.Function<String, BigDecimal> by = role -> book.get(role) == null ? Money.ZERO : Money.nz(mv.get(book.get(role).getId()));

        List<BrickBatch> batches = core.batchesInOrder().stream().filter(b -> !b.getProducedOn().isBefore(from) && !b.getProducedOn().isAfter(to)).toList();
        Set<Long> batchIds = batches.stream().map(BrickBatch::getId).collect(Collectors.toSet());
        List<BrickBatchItem> items = core.batchItems().findByTenantId(t).stream().filter(i -> batchIds.contains(i.getBatchId())).toList();
        int produced = items.stream().mapToInt(BrickBatchItem::getQuantity).sum();
        int damaged = items.stream().mapToInt(i -> BrickService.nz(i.getDamaged())).sum();

        // trips delivered in the period
        Map<Long, BrickOrder> orderById = core.orders().findByTenantId(t).stream().collect(Collectors.toMap(BrickOrder::getId, Function.identity()));
        List<BrickTrip> trips = core.trips().findByTenantId(t).stream().filter(tr -> BrickSalesService.DELIVERED.equals(tr.getStatus()) && tr.getDeliveredAt() != null
                && !tr.getDeliveredAt().toLocalDate().isBefore(from) && !tr.getDeliveredAt().toLocalDate().isAfter(to)).toList();
        Map<Long, List<BrickTripItem>> tripItems = core.tripItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickTripItem::getTripId));
        Map<Long, Map<Long, BrickOrderItem>> orderItems = core.orderItems().findByTenantId(t).stream()
                .collect(Collectors.groupingBy(BrickOrderItem::getOrderId, Collectors.toMap(BrickOrderItem::getBrickTypeId, Function.identity(), (a, b) -> a)));
        Map<Long, int[]> typeMade = new HashMap<>();
        items.forEach(i -> { int[] x = typeMade.computeIfAbsent(i.getBrickTypeId(), k -> new int[3]); x[0] += i.getQuantity(); x[1] += BrickService.nz(i.getDamaged()); });
        Map<Long, BigDecimal[]> typeSold = new HashMap<>();   // value, discount
        int delivered = 0;
        Map<String, Object[]> vehicles = new LinkedHashMap<>();
        Map<Long, String> vnum = core.vehicles().findByTenantId(t).stream().collect(Collectors.toMap(BrickVehicle::getId, BrickVehicle::getNumber));
        for (BrickTrip tr : trips) {
            int q = 0;
            for (BrickTripItem i : tripItems.getOrDefault(tr.getId(), List.of())) {
                int d = i.getDelivered() == null ? i.getQuantity() : i.getDelivered();
                q += d;
                typeMade.computeIfAbsent(i.getBrickTypeId(), k -> new int[3])[2] += d;
                BrickOrderItem oi = orderItems.getOrDefault(tr.getOrderId(), Map.of()).get(i.getBrickTypeId());
                if (oi != null) {
                    BigDecimal[] x = typeSold.computeIfAbsent(i.getBrickTypeId(), k -> new BigDecimal[]{Money.ZERO, Money.ZERO});
                    x[0] = x[0].add(oi.getPrice().multiply(BigDecimal.valueOf(d)));
                    if (oi.getMrp() != null) x[1] = x[1].add(oi.getMrp().subtract(oi.getPrice()).max(Money.ZERO).multiply(BigDecimal.valueOf(d)));
                }
            }
            delivered += q;
            String v = tr.getVehicleId() == null ? "No vehicle" : vnum.getOrDefault(tr.getVehicleId(), "Vehicle");
            Object[] row = vehicles.computeIfAbsent(v, k -> new Object[]{0, 0, Money.ZERO});
            row[0] = (int) row[0] + 1;
            row[1] = (int) row[1] + q;
        }
        for (BrickEarning e : core.earnings().findByTenantId(t)) {
            if (!BrickPayrollService.TRIP.equals(e.getKind()) || !"TRIP".equals(e.getSourceType())) continue;
            BrickTrip tr = trips.stream().filter(x -> x.getId().equals(e.getSourceId())).findFirst().orElse(null);
            if (tr == null) continue;
            Object[] row = vehicles.get(tr.getVehicleId() == null ? "No vehicle" : vnum.getOrDefault(tr.getVehicleId(), "Vehicle"));
            if (row != null) row[2] = ((BigDecimal) row[2]).add(e.getAmount());
        }
        List<TypeRow> types = core.sortedTypes(true).stream().filter(x -> typeMade.containsKey(x.getId()) || typeSold.containsKey(x.getId())).map(x -> {
            int[] m = typeMade.getOrDefault(x.getId(), new int[3]);
            BigDecimal[] s = typeSold.getOrDefault(x.getId(), new BigDecimal[]{Money.ZERO, Money.ZERO});
            return new TypeRow(x.getId(), x.getName(), x.getColor(), m[0], m[1], m[2], Money.round(s[0]), Money.round(s[1]),
                    m[2] == 0 ? null : s[0].divide(BigDecimal.valueOf(m[2]), 2, RoundingMode.HALF_UP), x.getMrp());
        }).toList();

        // teams
        Map<Long, List<BrickBatch>> byTeam = batches.stream().filter(b -> b.getTeamId() != null).collect(Collectors.groupingBy(BrickBatch::getTeamId));
        List<BrickProductionService.BatchView> views = production.batches().stream().filter(v -> batchIds.contains(v.batch().getId())).toList();
        List<TeamRow> teams = byTeam.entrySet().stream().map(e -> {
            List<BrickProductionService.BatchView> mine = views.stream().filter(v -> e.getKey().equals(v.batch().getTeamId())).toList();
            return new TeamRow(e.getKey(), core.resourceName(e.getKey()), mine.size(), mine.stream().mapToInt(BrickProductionService.BatchView::total).sum(),
                    mine.stream().mapToInt(BrickProductionService.BatchView::damaged).sum(),
                    mine.stream().map(BrickProductionService.BatchView::labour).reduce(Money.ZERO, BigDecimal::add));
        }).sorted(Comparator.comparing(TeamRow::bricks).reversed()).toList();

        // raw material
        Map<Long, List<MaterialFlow>> flows = core.materialFlows(null, null, null);
        Map<Long, BigDecimal> used = new HashMap<>();
        for (Long id : batchIds) flows.getOrDefault(id, List.of()).forEach(f -> used.merge(f.materialId(), f.consumed().max(BigDecimal.ZERO), BigDecimal::add));
        List<BrickMaterialPurchase> bought = core.purchases().findByTenantId(t).stream().filter(p -> !p.getReceivedOn().isBefore(from) && !p.getReceivedOn().isAfter(to)).toList();
        Map<Long, BigDecimal> stockNow = core.materialStock().stream().collect(Collectors.toMap(MaterialStock::materialId, MaterialStock::stock));
        int good = produced - damaged;
        List<MaterialRow> materials = core.materials().findByTenantId(t).stream().sorted(BrickService.order(BrickMaterial::getSortOrder, BrickMaterial::getId)).map(m -> {
            BigDecimal u = used.getOrDefault(m.getId(), BigDecimal.ZERO);
            List<BrickMaterialPurchase> mine = bought.stream().filter(p -> p.getMaterialId().equals(m.getId())).toList();
            BigDecimal qty = mine.stream().map(BrickMaterialPurchase::getQuantity).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal amt = mine.stream().map(BrickMaterialPurchase::getAmount).reduce(Money.ZERO, BigDecimal::add);
            return new MaterialRow(m.getId(), m.getName(), m.getUnit(), u, good == 0 ? null : u.multiply(BigDecimal.valueOf(1000)).divide(BigDecimal.valueOf(good), 3, RoundingMode.HALF_UP),
                    qty, amt, qty.signum() == 0 ? null : amt.divide(qty, 2, RoundingMode.HALF_UP), stockNow.get(m.getId()));
        }).filter(r -> r.consumed().signum() != 0 || r.bought().signum() != 0 || r.stock() != null && r.stock().signum() != 0).toList();

        List<Named> heads = core.expenses().findByTenantId(t).stream().filter(e -> !e.getSpentOn().isBefore(from) && !e.getSpentOn().isAfter(to))
                .collect(Collectors.groupingBy(BrickExpense::getHead)).entrySet().stream()
                .map(e -> new Named(e.getKey(), e.getValue().stream().map(BrickExpense::getAmount).reduce(Money.ZERO, BigDecimal::add), e.getValue().size(), null))
                .sorted(Comparator.comparing(Named::amount).reversed()).toList();

        List<BrickSalesService.OrderRow> orders = sales.orders().stream().filter(o -> !o.orderDate().isBefore(from) && !o.orderDate().isAfter(to)).toList();
        List<BrickSalesService.Customer> customers = orders.stream().filter(o -> !BrickSalesService.CANCELLED.equals(o.status()))
                .collect(Collectors.groupingBy(o -> o.customerPhone() != null ? o.customerPhone() : o.customerName().toLowerCase(), LinkedHashMap::new, Collectors.toList()))
                .values().stream().map(list -> new BrickSalesService.Customer(list.getFirst().customerName(), list.getFirst().customerPhone(), list.getFirst().address(), null,
                        list.size(), list.stream().mapToInt(BrickSalesService.OrderRow::quantity).sum(),
                        list.stream().map(BrickSalesService.OrderRow::total).reduce(Money.ZERO, BigDecimal::add),
                        list.stream().map(BrickSalesService.OrderRow::balance).reduce(Money.ZERO, BigDecimal::add), list.getFirst().orderDate()))
                .sorted(Comparator.comparing(BrickSalesService.Customer::value).reversed()).toList();

        // pay
        List<BrickPaySlip> slips = core.slips().findByTenantId(t).stream().filter(s -> BrickPayrollService.PAID.equals(s.getStatus())
                && !s.getPaidOn().isBefore(from) && !s.getPaidOn().isAfter(to)).toList();
        Map<Long, BigDecimal> outstanding = payroll.advances(null).stream().collect(Collectors.groupingBy(a -> core.slips().findById(a.advanceId()).map(BrickPaySlip::getResourceId).orElse(0L),
                Collectors.reducing(Money.ZERO, BrickPayrollService.AdvanceView::outstanding, BigDecimal::add)));
        Map<Long, BigDecimal> unpaid = core.earnings().findByTenantId(t).stream().filter(e -> e.getSlipId() == null)
                .collect(Collectors.groupingBy(BrickEarning::getResourceId, Collectors.reducing(Money.ZERO, BrickEarning::getAmount, BigDecimal::add)));
        List<PayRow> pay = core.resources().findByTenantId(t).stream().map(r -> {
            List<BrickPaySlip> mine = slips.stream().filter(s -> r.getId().equals(s.getResourceId())).toList();
            List<BrickPaySlip> paid = mine.stream().filter(s -> !BrickPayrollService.ADVANCE.equals(s.getKind())).toList();
            return new PayRow(r.getId(), r.getName(), r.getRole(), paid.size(), paid.stream().map(BrickPaySlip::getGross).reduce(Money.ZERO, BigDecimal::add),
                    paid.stream().map(s -> Money.nz(s.getDeductions())).reduce(Money.ZERO, BigDecimal::add), paid.stream().map(BrickPaySlip::getNet).reduce(Money.ZERO, BigDecimal::add),
                    mine.stream().filter(s -> BrickPayrollService.ADVANCE.equals(s.getKind())).map(BrickPaySlip::getNet).reduce(Money.ZERO, BigDecimal::add),
                    outstanding.getOrDefault(r.getId(), Money.ZERO), unpaid.getOrDefault(r.getId(), Money.ZERO));
        }).filter(p -> p.slips() > 0 || p.advancesGiven().signum() > 0 || p.outstanding().signum() > 0 || p.unpaid().signum() > 0)
                .sorted(Comparator.comparing(PayRow::net).reversed()).toList();

        BigDecimal salesV = by.apply("SALES"), deliv = by.apply("DELIVERY"), handl = by.apply("HANDLING");
        BigDecimal revenue = salesV.add(deliv).add(handl);
        BigDecimal mat = by.apply("MATERIALS"), wag = by.apply("WAGES"), hw = by.apply("HANDLING_COST"), sal = by.apply("SALARIES"), exp = by.apply("PRODUCTION");
        BigDecimal cost = mat.add(wag).add(hw).add(sal).add(exp);
        BigDecimal profit = revenue.subtract(cost);
        BigDecimal discount = typeSold.values().stream().map(x -> x[1]).reduce(Money.ZERO, BigDecimal::add);
        BigDecimal soldValue = typeSold.values().stream().map(x -> x[0]).reduce(Money.ZERO, BigDecimal::add);
        Summary summary = new Summary(produced, damaged, produced == 0 ? Money.ZERO : Money.percent(BigDecimal.valueOf(damaged), BigDecimal.valueOf(produced)),
                delivered, (int) orders.stream().filter(o -> !BrickSalesService.CANCELLED.equals(o.status())).count(), trips.size(), revenue, salesV, deliv, handl,
                mat, wag, hw, sal, exp, cost, profit, revenue.signum() == 0 ? null : Money.percent(profit, revenue),
                good == 0 ? null : mat.add(wag).add(exp).add(sal).divide(BigDecimal.valueOf(good), 2, RoundingMode.HALF_UP),
                delivered == 0 ? null : soldValue.divide(BigDecimal.valueOf(delivered), 2, RoundingMode.HALF_UP), Money.round(discount),
                soldValue.add(discount).signum() == 0 ? Money.ZERO : Money.percent(discount, soldValue.add(discount)),
                credits(snap, book.get("CUSTOMERS"), from, to), balance(snap, book.get("CUSTOMERS")).max(Money.ZERO));

        Map<LocalDate, Integer> made = madeByDay(), deliveredDays = deliveredByDay();
        List<MonthPoint> months = new ArrayList<>();
        for (YearMonth m = YearMonth.from(from); !m.isAfter(YearMonth.from(to)) && months.size() < 36; m = m.plusMonths(1)) {
            months.add(month(snap, book, m, made, deliveredDays));
        }
        List<Insight> insights = reportInsights(summary, types, materials, teams, customers, heads);
        return new Report(from, to, summary, months, types, teams, materials, heads, orders, customers,
                vehicles.entrySet().stream().map(e -> new VehicleRow(e.getKey(), (int) e.getValue()[0], (int) e.getValue()[1], (BigDecimal) e.getValue()[2])).toList(),
                pay, insights, views);
    }

    private List<Insight> reportInsights(Summary s, List<TypeRow> types, List<MaterialRow> materials, List<TeamRow> teams,
                                         List<BrickSalesService.Customer> customers, List<Named> heads) {
        List<Insight> out = new ArrayList<>();
        if (s.revenue().signum() > 0) {
            out.add(new Insight(s.profit().signum() >= 0 ? "good" : "critical", s.profit().signum() >= 0 ? "trending" : "trending-down",
                    (s.profit().signum() >= 0 ? "Profit " : "Loss ") + ActivityService.money(s.profit().abs()),
                    "On " + ActivityService.money(s.revenue()) + " of sales" + (s.margin() != null ? ", a margin of " + s.margin().setScale(1, RoundingMode.HALF_UP) + "%" : "") + "."));
        }
        if (s.costPerBrick() != null && s.pricePerBrick() != null) {
            BigDecimal gap = s.pricePerBrick().subtract(s.costPerBrick());
            out.add(new Insight(gap.signum() > 0 ? "info" : "warning", "calculator", "A brick costs " + money2(s.costPerBrick()) + " to make",
                    "and sells for " + money2(s.pricePerBrick()) + " on average: " + money2(gap.abs()) + (gap.signum() >= 0 ? " earned" : " lost") + " a brick before delivery."));
        }
        if (s.damagePercent() != null && s.damagePercent().compareTo(BigDecimal.valueOf(3)) > 0) {
            out.add(new Insight("warning", "alert", "Damage at " + s.damagePercent().setScale(1, RoundingMode.HALF_UP) + "%",
                    String.format("%,d", s.damaged()) + " of " + String.format("%,d", s.produced()) + " bricks were damaged. Check moulds, mix and curing."));
        }
        if (s.discountPercent() != null && s.discountPercent().compareTo(BigDecimal.valueOf(5)) > 0) {
            out.add(new Insight("warning", "percent", "Discounts at " + s.discountPercent().setScale(1, RoundingMode.HALF_UP) + "% of MRP",
                    ActivityService.money(s.discountGiven()) + " given away below MRP in this period."));
        }
        types.stream().max(Comparator.comparing(TypeRow::sales)).filter(x -> x.sales().signum() > 0).ifPresent(x ->
                out.add(new Insight("info", "layers", "Best seller: " + x.name(), String.format("%,d", x.delivered()) + " delivered for " + ActivityService.money(x.sales()) + ".")));
        teams.stream().findFirst().ifPresent(x -> out.add(new Insight("info", "users", "Most bricks: " + x.name(),
                String.format("%,d", x.bricks()) + " in " + x.batches() + " batch" + (x.batches() == 1 ? "" : "es") + ".")));
        customers.stream().findFirst().ifPresent(c -> out.add(new Insight("info", "user", "Top customer: " + c.name(),
                c.orders() + " order" + (c.orders() == 1 ? "" : "s") + " worth " + ActivityService.money(c.value()) + ".")));
        materials.stream().filter(m -> m.perThousand() != null).max(Comparator.comparing(MaterialRow::spent)).ifPresent(m ->
                out.add(new Insight("info", "droplet", m.name() + ": " + strip(m.perThousand()) + " " + m.unit() + " per 1,000 bricks",
                        "Used " + strip(m.consumed()) + " " + m.unit() + " in this period.")));
        heads.stream().findFirst().ifPresent(h -> out.add(new Insight("info", "receipt", "Biggest expense: " + h.name(), ActivityService.money(h.amount()) + " in " + h.count() + " bill(s).")));
        return out;
    }

    // ================================================================== helpers

    private Map<String, Account> book() {
        return core.accounts().findByTenantId(UserContext.tenantId()).stream().filter(a -> a.isBrickBook() && a.getBrickRole() != null && !"BANK".equals(a.getBrickRole())
                && !("CASH".equals(a.getBrickRole()) && !Boolean.TRUE.equals(a.getSystemAccount())))
                .collect(Collectors.toMap(Account::getBrickRole, Function.identity(), (a, b) -> a.getId() < b.getId() ? a : b));
    }

    private MonthPoint month(LedgerSnapshot snap, Map<String, Account> book, YearMonth m, Map<LocalDate, Integer> made, Map<LocalDate, Integer> delivered) {
        Map<Long, BigDecimal> mv = snap.movementsBetween(m.atDay(1), m.atEndOfMonth());
        java.util.function.Function<String, BigDecimal> by = role -> book.get(role) == null ? Money.ZERO : Money.nz(mv.get(book.get(role).getId()));
        BigDecimal revenue = by.apply("SALES").add(by.apply("DELIVERY")).add(by.apply("HANDLING"));
        BigDecimal mat = by.apply("MATERIALS"), wages = by.apply("WAGES").add(by.apply("HANDLING_COST")).add(by.apply("SALARIES")), exp = by.apply("PRODUCTION");
        BigDecimal profit = revenue.subtract(mat).subtract(wages).subtract(exp);
        return new MonthPoint(m.toString(), revenue, mat, wages, exp, profit, revenue.signum() == 0 ? null : Money.percent(profit, revenue),
                sumDays(made, m.atDay(1), m.atEndOfMonth()), sumDays(delivered, m.atDay(1), m.atEndOfMonth()));
    }

    private Map<LocalDate, Integer> madeByDay() {
        Long t = UserContext.tenantId();
        Map<Long, LocalDate> on = core.batches().findByTenantId(t).stream().collect(Collectors.toMap(BrickBatch::getId, BrickBatch::getProducedOn));
        Map<LocalDate, Integer> out = new HashMap<>();
        core.batchItems().findByTenantId(t).forEach(i -> {
            LocalDate d = on.get(i.getBatchId());
            if (d != null) out.merge(d, i.getQuantity() - BrickService.nz(i.getDamaged()), Integer::sum);
        });
        return out;
    }

    private Map<LocalDate, Integer> deliveredByDay() {
        Long t = UserContext.tenantId();
        Map<Long, LocalDate> on = core.trips().findByTenantId(t).stream().filter(tr -> BrickSalesService.DELIVERED.equals(tr.getStatus()) && tr.getDeliveredAt() != null)
                .collect(Collectors.toMap(BrickTrip::getId, tr -> tr.getDeliveredAt().toLocalDate()));
        Map<LocalDate, Integer> out = new HashMap<>();
        core.tripItems().findByTenantId(t).forEach(i -> {
            LocalDate d = on.get(i.getTripId());
            if (d != null) out.merge(d, i.getDelivered() == null ? i.getQuantity() : i.getDelivered(), Integer::sum);
        });
        return out;
    }

    private static int sumDays(Map<LocalDate, Integer> m, LocalDate from, LocalDate to) {
        return m.entrySet().stream().filter(e -> !e.getKey().isBefore(from) && !e.getKey().isAfter(to)).mapToInt(Map.Entry::getValue).sum();
    }

    private static BigDecimal balance(LedgerSnapshot snap, Account a) {
        return a == null ? Money.ZERO : snap.balanceAsOf(a.getId(), BrickService.FOREVER);
    }

    /** Credits to an account between two dates (payments received, for the customers' account). */
    private static BigDecimal credits(LedgerSnapshot snap, Account a, LocalDate from, LocalDate to) {
        if (a == null) return Money.ZERO;
        return snap.lines().stream().filter(l -> l.accountId().equals(a.getId()) && !l.date().isBefore(from) && !l.date().isAfter(to)
                        && l.voucherType() == com.aditya.personalbudget.domain.type.VoucherType.BRICK_RECEIPT)
                .map(LedgerSnapshot.PostedLine::credit).reduce(Money.ZERO, BigDecimal::add);
    }

    private static String strip(BigDecimal v) {
        return v == null ? "" : v.stripTrailingZeros().toPlainString();
    }

    private static String money2(BigDecimal v) {
        return "₹" + v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
