package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickBatch;
import com.aditya.personalbudget.domain.entity.BrickBatchItem;
import com.aditya.personalbudget.domain.entity.BrickBatchMaterial;
import com.aditya.personalbudget.domain.entity.BrickEarning;
import com.aditya.personalbudget.domain.entity.BrickExpense;
import com.aditya.personalbudget.domain.entity.BrickMaterial;
import com.aditya.personalbudget.domain.entity.BrickMaterialPurchase;
import com.aditya.personalbudget.domain.entity.BrickPaySlip;
import com.aditya.personalbudget.domain.entity.BrickPricingModel;
import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.security.UserContext;
import com.aditya.personalbudget.service.BrickService.MaterialFlow;
import jakarta.validation.Valid;
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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Production in batches: the bricks a team made (by type, less damaged ones), paid by a pricing model (the team earns
 * that much, paid with its weekly slip), and the raw material counted after the batch (its use is worked out from the
 * batch before); raw material bought and other production expenses, each posted to the brick book.
 */
@Service
public class BrickProductionService {

    public record ItemInput(@NotNull Long brickTypeId, @NotNull @Min(0) Integer quantity, @Min(0) Integer damaged) {
    }

    public record CountInput(@NotNull Long materialId, @NotNull @PositiveOrZero BigDecimal closing) {
    }

    public record BatchRequest(@NotNull LocalDate producedOn, Long teamId, Long pricingModelId, @Size(max = 500) String note,
                               @NotNull List<@Valid ItemInput> items, List<@Valid CountInput> materials) {
    }

    public record PurchaseRequest(@NotNull Long materialId, @NotNull LocalDate receivedOn, @NotNull @Positive BigDecimal quantity,
                                  @PositiveOrZero BigDecimal rate, @PositiveOrZero BigDecimal amount, @Size(max = 100) String vendor,
                                  @Size(max = 40) String billNo, @Size(max = 30) String vehicleNo, Long accountId, @Size(max = 300) String note) {
    }

    public record ExpenseRequest(@NotBlank @Size(max = 40) String head, @Size(max = 200) String description, @Size(max = 100) String vendor,
                                 @Size(max = 40) String billNo, @NotNull @Positive BigDecimal amount, @NotNull LocalDate spentOn,
                                 Long accountId, Long batchId) {
    }

    public record ItemView(Long brickTypeId, String name, String color, int quantity, int damaged, int good, BigDecimal rate, BigDecimal amount) {
    }

    public record BatchView(BrickBatch batch, String teamName, String modelName, List<ItemView> items, int total, int damaged, int good,
                            BigDecimal labour, List<MaterialFlow> materials, String paidOn, Long earningId, BigDecimal expenses,
                            /* raw material used per 1,000 good bricks, by material */
                            Map<Long, BigDecimal> usePerThousand,
                            /* paidOn is the slip's number: the slip and the day it was paid */
                            Long slipId, LocalDate paidDate,
                            /* the last batch: the only one that can still be changed or deleted (the others are closed) */
                            boolean open) {

        BatchView withoutPay() {
            return new BatchView(batch, teamName, modelName, items.stream().map(i -> new ItemView(i.brickTypeId(), i.name(), i.color(), i.quantity(), i.damaged(),
                    i.good(), null, null)).toList(), total, damaged, good, null, materials, paidOn, earningId, null, usePerThousand, slipId, paidDate, open);
        }
    }

    /** One bill of raw material: several materials bought together (each its own purchase, in one go). */
    public record PurchaseLine(@NotNull Long materialId, @NotNull @Positive BigDecimal quantity, @PositiveOrZero BigDecimal rate, @PositiveOrZero BigDecimal amount) {
    }

    public record PurchaseBill(@NotNull LocalDate receivedOn, @NotNull @Size(min = 1, max = 30) List<@jakarta.validation.Valid PurchaseLine> lines,
                               @Size(max = 100) String vendor, @Size(max = 40) String billNo, @Size(max = 30) String vehicleNo, Long accountId,
                               @Size(max = 300) String note) {
    }

    public record PurchaseView(BrickMaterialPurchase purchase, String material, String unit, String account, String entryNo) {
    }

    public record ExpenseView(BrickExpense expense, String account, String batchNo, String entryNo) {
    }

    public record Production(List<BatchView> batches, List<BrickService.TypeStock> stock, List<BrickService.MaterialStock> materials,
                             List<PurchaseView> purchases, List<ExpenseView> expenses,
                             /* materials whose kept balance differs from their records: shown so it can be put right */
                             List<BrickService.StockIssue> stockIssues) {

        /** The same, without what the team earns (for a role that does not see the money). */
        public Production withoutPay() {
            return new Production(batches.stream().map(BatchView::withoutPay).toList(), stock, materials, purchases, expenses, stockIssues);
        }
    }

    private final BrickService core;

    private static final java.time.format.DateTimeFormatter DAY = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy");

    public BrickProductionService(BrickService core) {
        this.core = core;
    }

    // ================================================================== reads

    public Production production() {
        // reads change nothing (a GET is read-only): a balance never kept yet is worked out from the records when shown, and kept
        // by the next purchase or batch saved (or Recalculate)
        return new Production(batches(), core.brickStock(), core.materialStock(), purchaseViews(), expenseViews(), core.stockIssues());
    }

    public List<BatchView> batches() {
        Long t = UserContext.tenantId();
        Map<Long, List<MaterialFlow>> flows = core.materialFlows(null, null, null);
        Map<Long, List<BrickBatchItem>> items = core.batchItems().findByTenantId(t).stream().collect(Collectors.groupingBy(BrickBatchItem::getBatchId));
        Map<Long, BrickEarning> earned = core.earnings().findByTenantId(t).stream().filter(e -> "BATCH".equals(e.getSourceType()))
                .collect(Collectors.toMap(BrickEarning::getSourceId, Function.identity(), (a, b) -> a));
        Map<Long, BigDecimal> spent = core.expenses().findByTenantId(t).stream().filter(e -> e.getBatchId() != null)
                .collect(Collectors.groupingBy(BrickExpense::getBatchId, Collectors.reducing(Money.ZERO, BrickExpense::getAmount, BigDecimal::add)));
        Map<Long, BrickPaySlip> slipById = core.slips().findByTenantId(t).stream().collect(Collectors.toMap(BrickPaySlip::getId, Function.identity()));
        List<BrickBatch> order = core.batchesInOrder();
        Long last = order.isEmpty() ? null : order.get(order.size() - 1).getId();
        return order.reversed().stream().map(b -> view(b, items.getOrDefault(b.getId(), List.of()), flows.getOrDefault(b.getId(), List.of()),
                earned.get(b.getId()), spent.getOrDefault(b.getId(), Money.ZERO), slipById, b.getId().equals(last))).toList();
    }

    private BatchView view(BrickBatch b, List<BrickBatchItem> items, List<MaterialFlow> flows, BrickEarning e, BigDecimal spent,
                           Map<Long, BrickPaySlip> slips, boolean open) {
        List<ItemView> iv = items.stream().map(i -> {
            var type = core.types().findById(i.getBrickTypeId()).orElse(null);
            int good = i.getQuantity() - BrickService.nz(i.getDamaged());
            BigDecimal rate = Money.nz(i.getRate());
            return new ItemView(i.getBrickTypeId(), type == null ? "Bricks" : type.getName(), type == null ? null : type.getColor(), i.getQuantity(),
                    BrickService.nz(i.getDamaged()), good, rate, Money.round(rate.multiply(BigDecimal.valueOf(good))));
        }).toList();
        int total = iv.stream().mapToInt(ItemView::quantity).sum();
        int damaged = iv.stream().mapToInt(ItemView::damaged).sum();
        BigDecimal labour = iv.stream().map(ItemView::amount).reduce(Money.ZERO, BigDecimal::add);
        Map<Long, BigDecimal> per = new HashMap<>();
        int good = total - damaged;
        if (good > 0) {
            flows.stream().filter(f -> f.counted() && f.consumed().signum() > 0).forEach(f -> per.put(f.materialId(),
                    f.consumed().multiply(BigDecimal.valueOf(1000)).divide(BigDecimal.valueOf(good), 3, RoundingMode.HALF_UP)));
        }
        String paid = null;
        LocalDate paidDate = null;
        if (e != null && e.getSlipId() != null) {
            BrickPaySlip s = slips.get(e.getSlipId());
            paid = s == null ? "paid" : s.getSlipNo();
            paidDate = s == null ? null : s.getPaidOn();
        }
        String model = b.getPricingModelId() == null ? null : core.models().findById(b.getPricingModelId()).map(BrickPricingModel::getName).orElse(null);
        return new BatchView(b, core.resourceName(b.getTeamId()), model, iv, total, damaged, good, labour, flows, paid, e == null ? null : e.getId(), spent, per,
                e == null ? null : e.getSlipId(), paidDate, open);
    }

    public BatchView batch(Long id) {
        return batches().stream().filter(b -> b.batch().getId().equals(id)).findFirst().orElseThrow(() -> new NotFoundException("Batch", id));
    }

    /** What a batch being entered would show for raw material: the opening (the batch before's closing) and what came in since. */
    public List<MaterialFlow> preview(LocalDate date, Long batchId, Map<Long, BigDecimal> closing) {
        Map<Long, List<MaterialFlow>> flows = core.materialFlows(date, batchId, closing);
        return flows.getOrDefault(batchId == null ? Long.MAX_VALUE : batchId, List.of());
    }

    // ================================================================== batches

    @Transactional
    public BatchView saveBatch(Long id, BatchRequest r) {
        core.ensureDefaults();
        Long t = UserContext.tenantId();
        BrickBatch b = id == null ? new BrickBatch() : requireBatch(id);
        BrickEarning earning = id == null ? null : batchEarning(id);
        boolean paid = earning != null && earning.getSlipId() != null;
        if (r.producedOn().isAfter(LocalDate.now())) throw new BusinessException("A batch cannot be dated in the future");
        // raw material is counted batch after batch: only the last batch can change, and a batch follows the one before it
        List<BrickBatch> order = core.batchesInOrder();
        BrickBatch last = order.isEmpty() ? null : order.get(order.size() - 1);
        if (id != null && !last.getId().equals(id)) {
            throw new BusinessException("Batch " + b.getBatchNo() + " is closed: only the last batch, " + last.getBatchNo() + ", can be changed");
        }
        BrickBatch before = id == null ? last : order.size() > 1 ? order.get(order.size() - 2) : null;
        if (before != null && r.producedOn().isBefore(before.getProducedOn())) {
            throw new BusinessException("A batch cannot be dated before " + before.getBatchNo() + " of " + before.getProducedOn().format(DAY) + ", the batch before it");
        }
        BrickResource team = r.teamId() == null ? null : core.requireResource(r.teamId());
        BrickPricingModel model = r.pricingModelId() == null ? core.defaultModel() : core.requireModel(r.pricingModelId());
        List<ItemInput> items = r.items().stream().filter(i -> i.quantity() > 0).toList();
        if (items.isEmpty()) throw new BusinessException("Enter how many bricks were made");
        if (items.stream().map(ItemInput::brickTypeId).distinct().count() < items.size()) throw new BusinessException("Each brick type once, please");
        for (ItemInput i : items) {
            core.requireType(i.brickTypeId());
            if (BrickService.nz(i.damaged()) > i.quantity()) throw new BusinessException("More damaged than made for " + core.typeName(i.brickTypeId()));
        }
        Map<Long, BigDecimal> rates = core.modelView(model).rates();
        if (paid) {
            // what the team was paid for cannot change: the same team, model and counts
            List<BrickBatchItem> was = core.batchItems().findByBatchId(id);
            boolean same = Objects.equals(b.getTeamId(), r.teamId()) && Objects.equals(b.getPricingModelId(), model.getId())
                    && was.size() == items.size() && items.stream().allMatch(i -> was.stream().anyMatch(w -> w.getBrickTypeId().equals(i.brickTypeId())
                    && w.getQuantity().equals(i.quantity()) && BrickService.nz(w.getDamaged()) == BrickService.nz(i.damaged())));
            if (!same) {
                BrickPaySlip s = core.slips().findById(earning.getSlipId()).orElse(null);
                throw new BusinessException("The team was already paid for this batch" + (s != null ? " on " + s.getSlipNo() : "")
                        + "; cancel that slip to change the bricks, team or rates");
            }
        }
        if (id == null) {
            b.setTenantId(t);
            b.setBatchNo(BrickService.nextNo("B-", core.batches().findByTenantId(t).stream().map(BrickBatch::getBatchNo)));
            b.setCreatedBy(UserContext.username());
            b.setCreatedAt(LocalDateTime.now());
        }
        b.setProducedOn(r.producedOn());
        b.setTeamId(team == null ? null : team.getId());
        b.setPricingModelId(model.getId());
        b.setNote(BrickService.blank(r.note()));
        b = core.batches().save(b);
        Long batchId = b.getId();
        if (!paid) {
            core.batchItems().findByBatchId(batchId).forEach(core.batchItems()::delete);
            for (ItemInput i : items) {
                BrickBatchItem x = new BrickBatchItem();
                x.setTenantId(t);
                x.setBatchId(batchId);
                x.setBrickTypeId(i.brickTypeId());
                x.setQuantity(i.quantity());
                x.setDamaged(BrickService.nz(i.damaged()) == 0 ? null : i.damaged());
                x.setRate(rates.get(i.brickTypeId()));
                core.batchItems().save(x);
            }
        }
        if (r.materials() != null) {
            Map<Long, BrickBatchMaterial> have = core.batchMaterials().findByBatchId(batchId).stream()
                    .collect(Collectors.toMap(BrickBatchMaterial::getMaterialId, Function.identity(), (x, y) -> x));
            Set<Long> sent = new java.util.HashSet<>();
            for (CountInput c : r.materials()) {
                core.requireMaterial(c.materialId());
                sent.add(c.materialId());
                BrickBatchMaterial m = have.getOrDefault(c.materialId(), new BrickBatchMaterial());
                m.setTenantId(t);
                m.setBatchId(batchId);
                m.setMaterialId(c.materialId());
                m.setClosing(c.closing());
                // the time of the count is kept from the first time it was taken: a correction keeps it
                if (m.getCountedAt() == null) m.setCountedAt(LocalDateTime.now());
                core.batchMaterials().save(m);
            }
            have.values().stream().filter(m -> !sent.contains(m.getMaterialId())).forEach(core.batchMaterials()::delete);
        }
        // the counts' flows brought up to date first (the last batch's worked out again), then checked
        core.refreshMaterialStock();
        checkStock();
        if (!paid) syncEarning(b, team);
        BatchView v = batch(batchId);
        core.activity().record(id == null ? "ADDED" : "CHANGED", BrickService.AREA, "Batch " + b.getBatchNo() + " · " + BrickService.bricks(v.total())
                + (team != null ? " · " + team.getName() : "") + " · " + b.getProducedOn());
        return v;
    }

    @Transactional
    public void deleteBatch(Long id) {
        BrickBatch b = requireBatch(id);
        List<BrickBatch> order = core.batchesInOrder();
        BrickBatch last = order.get(order.size() - 1);
        if (!last.getId().equals(id)) {
            throw new BusinessException("Batch " + b.getBatchNo() + " is closed: only the last batch, " + last.getBatchNo() + ", can be deleted");
        }
        BrickEarning e = batchEarning(id);
        if (e != null && e.getSlipId() != null) {
            throw new BusinessException("The team was already paid for this batch; cancel that payment slip first");
        }
        if (e != null) core.earnings().delete(e);
        core.batchItems().findByBatchId(id).forEach(core.batchItems()::delete);
        core.batchMaterials().findByBatchId(id).forEach(core.batchMaterials()::delete);
        core.expenses().findByTenantId(b.getTenantId()).stream().filter(x -> id.equals(x.getBatchId())).forEach(x -> {
            x.setBatchId(null);
            core.expenses().save(x);
        });
        core.batches().deleteById(id);
        // the counts' flows brought up to date first (the last batch's worked out again), then checked
        core.refreshMaterialStock();
        checkStock();
        core.activity().record("DELETED", BrickService.AREA, "Batch " + b.getBatchNo() + " of " + b.getProducedOn());
    }

    /** The team earns the batch (paid by the brick, when it is paid by what it makes): one earning, kept in step with the batch. */
    private void syncEarning(BrickBatch b, BrickResource team) {
        BrickEarning e = batchEarning(b.getId());
        List<BrickBatchItem> items = core.batchItems().findByBatchId(b.getId());
        int good = items.stream().mapToInt(i -> i.getQuantity() - BrickService.nz(i.getDamaged())).sum();
        BigDecimal amount = items.stream().map(i -> Money.nz(i.getRate()).multiply(BigDecimal.valueOf(i.getQuantity() - BrickService.nz(i.getDamaged()))))
                .reduce(Money.ZERO, BigDecimal::add);
        boolean earns = team != null && BrickPayrollService.PIECE.equals(team.getSalaryType()) && amount.signum() > 0;
        if (!earns) {
            if (e != null) core.earnings().delete(e);
            return;
        }
        if (e == null) {
            e = new BrickEarning();
            e.setTenantId(b.getTenantId());
            e.setKind(BrickPayrollService.PRODUCTION);
            e.setSourceType("BATCH");
            e.setSourceId(b.getId());
            e.setCreatedAt(LocalDateTime.now());
        }
        e.setResourceId(team.getId());
        e.setEarnedOn(b.getProducedOn());
        e.setQuantity(good);
        e.setRate(good == 0 ? null : amount.divide(BigDecimal.valueOf(good), 4, RoundingMode.HALF_UP));
        e.setAmount(Money.round(amount));
        e.setNarrative(ActivityService.cut("Batch " + b.getBatchNo() + " · " + items.stream()
                .map(i -> core.typeName(i.getBrickTypeId()) + " " + String.format("%,d", i.getQuantity() - BrickService.nz(i.getDamaged()))
                        + " × " + Money.nz(i.getRate()).stripTrailingZeros().toPlainString())
                .collect(Collectors.joining(", ")), 200));
        core.earnings().save(e);
    }

    private BrickEarning batchEarning(Long batchId) {
        return core.earnings().findByTenantId(UserContext.tenantId()).stream()
                .filter(e -> "BATCH".equals(e.getSourceType()) && batchId.equals(e.getSourceId())).findFirst().orElse(null);
    }

    /**
     * The last batch may not have used more raw material than there was (a closing count above opening plus received). The
     * batches before it are closed: what they kept is history, and can no longer be corrected.
     */
    private void checkStock() {
        List<BrickBatch> order = core.batchesInOrder();
        if (order.isEmpty()) return;
        Long last = order.get(order.size() - 1).getId();
        for (var entry : core.materialFlows(null, null, null).entrySet()) {
            if (!entry.getKey().equals(last)) continue;
            for (MaterialFlow f : entry.getValue()) {
                if (f.counted() && f.consumed().signum() < 0) {
                    String no = core.batches().findById(entry.getKey()).map(BrickBatch::getBatchNo).orElse("a batch");
                    throw new BusinessException("Batch " + no + ": " + strip(f.closing()) + " " + f.unit() + " of " + f.name() + " left is more than there was ("
                            + strip(f.opening()) + " at the start + " + strip(f.received()) + " received). Check the count or record the purchase first");
                }
            }
        }
    }

    private static String strip(BigDecimal v) {
        return v.stripTrailingZeros().toPlainString();
    }

    private BrickBatch requireBatch(Long id) {
        return core.batches().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Batch", id));
    }

    // ================================================================== raw material bought

    public List<PurchaseView> purchaseViews() {
        Long t = UserContext.tenantId();
        Map<Long, BrickMaterial> ms = core.materials().findByTenantId(t).stream().collect(Collectors.toMap(BrickMaterial::getId, Function.identity()));
        return core.purchases().findByTenantId(t).stream()
                .sorted(Comparator.comparing(BrickMaterialPurchase::getReceivedOn).thenComparing(BrickMaterialPurchase::getId).reversed())
                .map(p -> new PurchaseView(p, ms.containsKey(p.getMaterialId()) ? ms.get(p.getMaterialId()).getName() : "Raw material",
                        ms.containsKey(p.getMaterialId()) ? ms.get(p.getMaterialId()).getUnit() : "", accountName(p.getAccountId()), entryNo(p.getJournalEntryId())))
                .toList();
    }

    @Transactional
    /** Records a bill of several materials: one purchase each, all or none. */
    public List<PurchaseView> saveBill(PurchaseBill b) {
        if (b.lines().stream().map(PurchaseLine::materialId).distinct().count() < b.lines().size()) throw new BusinessException("Each material once on a bill, please");
        return b.lines().stream().map(l -> savePurchase(null, new PurchaseRequest(l.materialId(), b.receivedOn(), l.quantity(), l.rate(), l.amount(),
                b.vendor(), b.billNo(), b.vehicleNo(), b.accountId(), b.note()))).toList();
    }

    @Transactional
    public PurchaseView savePurchase(Long id, PurchaseRequest r) {
        core.ensureDefaults();
        Long t = UserContext.tenantId();
        BrickMaterial m = core.requireMaterial(r.materialId());
        BrickMaterialPurchase p = id == null ? new BrickMaterialPurchase() : requirePurchase(id);
        BigDecimal amount = r.amount() != null && r.amount().signum() > 0 ? r.amount()
                : r.rate() != null ? r.rate().multiply(r.quantity()) : null;
        if (amount == null || amount.signum() <= 0) throw new BusinessException("Enter the amount (or the rate)");
        if (id == null) {
            p.setTenantId(t);
            p.setCreatedBy(UserContext.username());
            p.setCreatedAt(LocalDateTime.now());
        }
        p.setMaterialId(m.getId());
        p.setReceivedOn(r.receivedOn());
        p.setQuantity(r.quantity());
        p.setAmount(Money.round(amount));
        p.setRate(r.rate() != null ? r.rate() : amount.divide(r.quantity(), 2, RoundingMode.HALF_UP));
        p.setVendor(BrickService.blank(r.vendor()));
        p.setBillNo(BrickService.blank(r.billNo()));
        p.setVehicleNo(BrickService.blank(r.vehicleNo()));
        p.setAccountId(core.moneyAccountOr(r.accountId(), false));
        p.setNote(BrickService.blank(r.note()));
        p = core.purchases().save(p);
        JournalDraft d = JournalDraft.of(p.getReceivedOn(), VoucherType.BRICK_MATERIAL, "Raw material · " + m.getName() + " " + strip(p.getQuantity()) + " " + m.getUnit()
                        + (p.getVendor() != null ? " · " + p.getVendor() : ""))
                .debit(core.account("MATERIALS").getId(), p.getAmount(), m.getName() + " " + strip(p.getQuantity()) + " " + m.getUnit() + " @ " + strip(p.getRate()))
                .credit(p.getAccountId(), p.getAmount())
                .reference(p.getBillNo()).party(p.getVendor()).source(BrickService.SOURCE_MATERIAL, p.getId());
        if (p.getJournalEntryId() != null) core.ledger().repost(p.getJournalEntryId(), d);
        else p.setJournalEntryId(core.post(d).getId());
        core.purchases().save(p);
        m.setLastRate(p.getRate());
        core.materials().save(m);
        // the counts' flows brought up to date first (the last batch's worked out again), then checked
        core.refreshMaterialStock();
        checkStock();
        core.activity().record(id == null ? "ADDED" : "CHANGED", BrickService.AREA, "Raw material " + m.getName() + " " + strip(p.getQuantity()) + " " + m.getUnit()
                + " · " + ActivityService.money(p.getAmount()));
        Long pid = p.getId();
        return purchaseViews().stream().filter(x -> x.purchase().getId().equals(pid)).findFirst().orElseThrow();
    }

    @Transactional
    public void deletePurchase(Long id) {
        BrickMaterialPurchase p = requirePurchase(id);
        core.purchases().deleteById(id);
        core.unpost(p.getJournalEntryId());
        // the counts' flows brought up to date first (the last batch's worked out again), then checked
        core.refreshMaterialStock();
        checkStock();
        core.activity().record("DELETED", BrickService.AREA, "Raw material bought on " + p.getReceivedOn() + " · " + ActivityService.money(p.getAmount()));
    }

    private BrickMaterialPurchase requirePurchase(Long id) {
        return core.purchases().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Purchase", id));
    }

    // ================================================================== other production expenses

    public List<ExpenseView> expenseViews() {
        Long t = UserContext.tenantId();
        Map<Long, String> batchNo = core.batches().findByTenantId(t).stream().collect(Collectors.toMap(BrickBatch::getId, BrickBatch::getBatchNo));
        return core.expenses().findByTenantId(t).stream()
                .sorted(Comparator.comparing(BrickExpense::getSpentOn).thenComparing(BrickExpense::getId).reversed())
                .map(e -> new ExpenseView(e, accountName(e.getAccountId()), e.getBatchId() == null ? null : batchNo.get(e.getBatchId()), entryNo(e.getJournalEntryId())))
                .toList();
    }

    @Transactional
    public ExpenseView saveExpense(Long id, ExpenseRequest r) {
        core.ensureDefaults();
        Long t = UserContext.tenantId();
        BrickExpense e = id == null ? new BrickExpense() : requireExpense(id);
        if (id == null) {
            e.setTenantId(t);
            e.setCreatedBy(UserContext.username());
            e.setCreatedAt(LocalDateTime.now());
        }
        e.setHead(r.head().trim());
        e.setDescription(BrickService.blank(r.description()));
        e.setVendor(BrickService.blank(r.vendor()));
        e.setBillNo(BrickService.blank(r.billNo()));
        e.setAmount(Money.round(r.amount()));
        e.setSpentOn(r.spentOn());
        e.setAccountId(core.moneyAccountOr(r.accountId(), false));
        e.setBatchId(r.batchId() == null ? null : requireBatch(r.batchId()).getId());
        e = core.expenses().save(e);
        JournalDraft d = JournalDraft.of(e.getSpentOn(), VoucherType.BRICK_EXPENSE, "Production expense · " + e.getHead()
                        + (e.getDescription() != null ? " · " + e.getDescription() : ""))
                .debit(core.account("PRODUCTION").getId(), e.getAmount(), e.getHead())
                .credit(e.getAccountId(), e.getAmount())
                .reference(e.getBillNo()).party(e.getVendor()).source(BrickService.SOURCE_EXPENSE, e.getId());
        if (e.getJournalEntryId() != null) core.ledger().repost(e.getJournalEntryId(), d);
        else e.setJournalEntryId(core.post(d).getId());
        core.expenses().save(e);
        core.activity().record(id == null ? "ADDED" : "CHANGED", BrickService.AREA, "Production expense " + e.getHead() + " · " + ActivityService.money(e.getAmount()));
        Long eid = e.getId();
        return expenseViews().stream().filter(x -> x.expense().getId().equals(eid)).findFirst().orElseThrow();
    }

    @Transactional
    public void deleteExpense(Long id) {
        BrickExpense e = requireExpense(id);
        core.expenses().deleteById(id);
        core.unpost(e.getJournalEntryId());
        core.activity().record("DELETED", BrickService.AREA, "Production expense " + e.getHead() + " · " + ActivityService.money(e.getAmount()));
    }

    private BrickExpense requireExpense(Long id) {
        return core.expenses().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Expense", id));
    }

    // ================================================================== helpers

    private String accountName(Long id) {
        return id == null ? null : core.accounts().findById(id).map(Account::getName).orElse(null);
    }

    private String entryNo(Long id) {
        return id == null ? null : core.entries().findById(id).map(com.aditya.personalbudget.domain.entity.JournalEntry::getEntryNo).orElse(null);
    }
}
