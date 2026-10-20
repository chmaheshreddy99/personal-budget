package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.BrickAdvanceRecovery;
import com.aditya.personalbudget.domain.entity.BrickEarning;
import com.aditya.personalbudget.domain.entity.BrickPaySlip;
import com.aditya.personalbudget.domain.entity.BrickResource;
import com.aditya.personalbudget.domain.type.VoucherType;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.security.UserContext;
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
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The people of the brick business and their pay. A resource (a team or one person, with a role) is paid by what it
 * makes or moves (PIECE: batches, loading and unloading, delivery trips), a weekly wage or a monthly salary. What it
 * earns waits until a payment slip pays it: weekly for production teams and drivers, monthly for salaried staff. An
 * advance is a slip of its own, taken back (in parts) on later slips. A batch or trip can be paid once only: its earning
 * belongs to one slip, and a wage or salary period cannot be paid twice.
 */
@Service
public class BrickPayrollService {

    public static final String PIECE = "PIECE";
    public static final String WEEKLY = "WEEKLY";
    public static final String MONTHLY = "MONTHLY";
    public static final String ADVANCE = "ADVANCE";
    static final String PAID = "PAID";
    static final String CANCELLED = "CANCELLED";
    static final String PRODUCTION = "PRODUCTION";
    static final String LOADING = "LOADING";
    static final String UNLOADING = "UNLOADING";
    static final String TRIP = "TRIP";
    static final String WAGE = "WAGE";
    static final String SALARY = "SALARY";
    static final String BONUS = "BONUS";
    static final Set<String> MODES = Set.of("Cash", "UPI", "Bank", "Cheque");
    static final String STAFF = "STAFF";
    static final String LABOUR = "LABOUR";

    // ------------------------------------------------------------------ requests

    public record ResourceRequest(@NotBlank @Size(max = 100) String name, @NotBlank String kind, @NotBlank @Size(max = 30) String role,
                                  @NotBlank String salaryType, @PositiveOrZero BigDecimal salaryAmount, @PositiveOrZero BigDecimal tripIncentive,
                                  @Min(1) Integer memberCount, @Size(max = 500) String members, @Size(max = 20) String phone,
                                  @Size(max = 60) String upiId, LocalDate joinedOn, Boolean active, @Size(max = 300) String note,
                                  @Size(max = 10) String category, Boolean defaultTeam) {
    }

    public record BonusInput(@NotBlank @Size(max = 100) String label, @NotNull @Positive BigDecimal amount) {
    }

    public record DeductionInput(@NotNull Long advanceId, @NotNull @PositiveOrZero BigDecimal amount) {
    }

    public record SlipRequest(@NotNull Long resourceId, @NotBlank String cycle, @NotNull LocalDate periodFrom, @NotNull LocalDate periodTo,
                              List<Long> earningIds, @PositiveOrZero BigDecimal wage, List<@Valid BonusInput> bonuses,
                              List<@Valid DeductionInput> deductions, @NotNull LocalDate paidOn, Long accountId, @Size(max = 20) String mode,
                              @Size(max = 60) String reference, @Size(max = 300) String note) {
    }

    public record AdvanceRequest(@NotNull Long resourceId, @NotNull @Positive BigDecimal amount, @NotNull LocalDate givenOn, Long accountId,
                                 @Size(max = 20) String mode, @Size(max = 60) String reference, @NotBlank @Size(max = 300) String narrative,
                                 @PositiveOrZero BigDecimal recoverPerCycle) {
    }

    // ------------------------------------------------------------------ views

    public record EarningView(Long id, String kind, String label, LocalDate earnedOn, Integer quantity, BigDecimal rate, BigDecimal amount,
                              String narrative, String sourceType, Long sourceId, Long slipId, String slipNo) {
    }

    public record AdvanceView(Long advanceId, String slipNo, LocalDate givenOn, String narrative, BigDecimal amount, BigDecimal recovered,
                              BigDecimal outstanding, BigDecimal recoverPerCycle, BigDecimal suggested) {
    }

    /** monthQuantity: bricks made, loaded or unloaded this month; monthTrips: delivery trips; monthEarned: what that work earned. */
    public record ResourceView(BrickResource resource, String cycle, BigDecimal unpaid, int unpaidCount, BigDecimal advanceOutstanding,
                               LocalDate lastPaidOn, BigDecimal paidThisMonth, BigDecimal paidTotal, Long vehicles,
                               int monthQuantity, int monthTrips, BigDecimal monthEarned, BigDecimal advanceTaken) {
    }

    /** What a slip for a resource and period would pay: unpaid earnings (up to the period's end), the wage, advances to take back. */
    public record Preview(ResourceView resource, String cycle, LocalDate from, LocalDate to, List<EarningView> earnings, BigDecimal wage,
                          String wageLabel, String wageNote, List<AdvanceView> advances, BigDecimal gross) {
    }

    public record DeductionLine(Long advanceId, String advanceNo, LocalDate givenOn, String narrative, BigDecimal advanceAmount,
                                BigDecimal outstandingBefore, BigDecimal amount, BigDecimal balanceAfter) {
    }

    public record SlipView(BrickPaySlip slip, BrickResource resource, List<EarningView> lines, List<DeductionLine> deductions, String account,
                           String inWords, String entryNo, BrickService.Company company, String publicKey, String keyFingerprint,
                           /* advance slips: what was taken back so far, on which slips */
                           AdvanceView advance, List<DeductionLine> recoveredOn) {
    }

    public record SlipRow(Long id, String slipNo, String kind, String status, Long resourceId, String resourceName, String role,
                          LocalDate periodFrom, LocalDate periodTo, LocalDate paidOn, BigDecimal gross, BigDecimal deductions, BigDecimal net,
                          String narrative, String account,
                          /* the journal entry the slip posted (its number, to show it) */
                          Long journalEntryId) {
    }

    public record Payroll(List<ResourceView> resources, List<SlipRow> slips, List<EarningView> unpaid, BigDecimal unpaidTotal,
                          BigDecimal advancesOutstanding, List<AdvanceLine> advances) {
    }

    /** An advance still owed, with whom it was given to. */
    public record AdvanceLine(Long resourceId, String resourceName, String role, AdvanceView advance) {
    }

    /** One team's or person's record: everything they earned (paid or not, newest first), their slips and advances. */
    public record History(ResourceView resource, List<EarningView> earnings, List<SlipRow> slips, List<AdvanceView> advances) {
    }

    private final BrickService core;

    public BrickPayrollService(BrickService core) {
        this.core = core;
    }

    // ================================================================== resources

    @Transactional
    public ResourceView saveResource(Long id, ResourceRequest r) {
        core.ensureDefaults();
        Long t = UserContext.tenantId();
        BrickResource x = id == null ? new BrickResource() : core.requireResource(id);
        String name = r.name().trim().replaceAll("\\s+", " ");
        if (core.resources().findByTenantId(t).stream().anyMatch(o -> !o.getId().equals(x.getId()) && o.getName().equalsIgnoreCase(name))) {
            throw new BusinessException("There is already a team or person called " + name);
        }
        String kind = r.kind().trim().toUpperCase();
        if (!Set.of("TEAM", "INDIVIDUAL").contains(kind)) throw new BusinessException("A team or an individual");
        String type = r.salaryType().trim().toUpperCase();
        if (!Set.of(PIECE, WEEKLY, MONTHLY).contains(type)) throw new BusinessException("Paid by work done, a weekly wage or a monthly salary");
        if ("TEAM".equals(kind) && MONTHLY.equals(type)) {
            throw new BusinessException("A team is paid by the work it does or a weekly wage, not a monthly salary");
        }
        if (!PIECE.equals(type) && Money.nz(r.salaryAmount()).signum() <= 0) {
            throw new BusinessException("Enter the " + (WEEKLY.equals(type) ? "weekly wage" : "monthly salary"));
        }
        if (id == null) {
            x.setTenantId(t);
            x.setCreatedAt(LocalDateTime.now());
        }
        x.setName(name);
        x.setKind(kind);
        x.setRole(r.role().trim().toUpperCase().replaceAll("[^A-Z0-9]+", "_"));
        x.setSalaryType(type);
        x.setSalaryAmount(PIECE.equals(type) ? null : Money.round(r.salaryAmount()));
        x.setTripIncentive(r.tripIncentive());
        x.setMemberCount("TEAM".equals(kind) ? r.memberCount() : null);
        x.setMembers("TEAM".equals(kind) ? BrickService.blank(r.members()) : null);
        x.setPhone(BrickService.blank(r.phone()) == null ? null : HostedChitService.cleanPhone(r.phone(), name));
        x.setUpiId(BrickService.blank(r.upiId()));
        x.setJoinedOn(r.joinedOn());
        x.setActive(r.active() == null || r.active());
        x.setNote(BrickService.blank(r.note()));
        String category = BrickService.blank(r.category()) == null ? null : r.category().trim().toUpperCase();
        if (category != null && !Set.of(STAFF, LABOUR).contains(category)) throw new BusinessException("Staff or production labour");
        x.setCategory(category);
        // the default team: the production team new batches start with, and new orders' loading (and unloading) too
        boolean isDefault = Boolean.TRUE.equals(r.defaultTeam()) && x.getRole().contains(PRODUCTION) && Boolean.TRUE.equals(x.getActive());
        x.setDefaultTeam(isDefault);
        if (isDefault) {
            // one default team: the others stop being it
            core.resources().findByTenantId(t).stream().filter(o -> !o.getId().equals(x.getId()) && Boolean.TRUE.equals(o.getDefaultTeam()))
                    .forEach(o -> { o.setDefaultTeam(false); core.resources().save(o); });
        }
        BrickResource saved = core.resources().save(x);
        core.activity().record(id == null ? "ADDED" : "CHANGED", BrickService.AREA, ("TEAM".equals(kind) ? "Team " : "") + name + " · " + saved.getRole().toLowerCase().replace('_', ' '));
        return resourceViews().stream().filter(v -> v.resource().getId().equals(saved.getId())).findFirst().orElseThrow();
    }

    @Transactional
    public void deleteResource(Long id) {
        BrickResource x = core.requireResource(id);
        Long t = x.getTenantId();
        boolean used = core.earnings().findByResourceId(id).stream().findAny().isPresent() || !core.slips().findByResourceId(id).isEmpty()
                || core.batches().findByTenantId(t).stream().anyMatch(b -> id.equals(b.getTeamId()))
                || core.orders().findByTenantId(t).stream().anyMatch(o -> id.equals(o.getDriverId()) || id.equals(o.getLoadingTeamId()) || id.equals(o.getUnloadingTeamId()))
                || core.trips().findByTenantId(t).stream().anyMatch(o -> id.equals(o.getDriverId()) || id.equals(o.getLoadingTeamId()) || id.equals(o.getUnloadingTeamId()));
        if (used) {
            x.setActive(false);
            core.resources().save(x);
            core.activity().record("CHANGED", BrickService.AREA, x.getName() + " no longer works here (kept with their history)");
        } else {
            core.vehicles().findByTenantId(t).stream().filter(v -> id.equals(v.getDriverId())).forEach(v -> { v.setDriverId(null); core.vehicles().save(v); });
            core.resources().deleteById(id);
            core.activity().record("DELETED", BrickService.AREA, x.getName());
        }
    }

    public static String cycleOf(BrickResource r) {
        return MONTHLY.equals(r.getSalaryType()) ? MONTHLY : WEEKLY;
    }

    public List<ResourceView> resourceViews() {
        Long t = UserContext.tenantId();
        List<BrickEarning> all = core.earnings().findByTenantId(t);
        List<BrickPaySlip> slips = core.slips().findByTenantId(t).stream().filter(s -> PAID.equals(s.getStatus())).toList();
        Map<Long, BigDecimal> outstanding = advances(null).stream().collect(Collectors.groupingBy(a -> advanceResource(a.advanceId()),
                Collectors.reducing(Money.ZERO, AdvanceView::outstanding, BigDecimal::add)));
        LocalDate monthStart = LocalDate.now().withDayOfMonth(1);
        return core.resources().findByTenantId(t).stream()
                .sorted(Comparator.comparing((BrickResource r) -> !Boolean.TRUE.equals(r.getActive())).thenComparing(BrickResource::getName, String.CASE_INSENSITIVE_ORDER))
                .map(r -> {
                    List<BrickEarning> unpaid = all.stream().filter(e -> r.getId().equals(e.getResourceId()) && e.getSlipId() == null).toList();
                    List<BrickPaySlip> mine = slips.stream().filter(s -> r.getId().equals(s.getResourceId()) && !ADVANCE.equals(s.getKind())).toList();
                    List<BrickEarning> month = all.stream().filter(e -> r.getId().equals(e.getResourceId()) && !e.getEarnedOn().isBefore(monthStart)).toList();
                    int qty = month.stream().filter(e -> Set.of(PRODUCTION, LOADING, UNLOADING).contains(e.getKind())).mapToInt(e -> e.getQuantity() == null ? 0 : e.getQuantity()).sum();
                    int trips = (int) month.stream().filter(e -> TRIP.equals(e.getKind())).count();
                    BigDecimal advTaken = slips.stream().filter(s -> r.getId().equals(s.getResourceId()) && ADVANCE.equals(s.getKind())).map(BrickPaySlip::getNet)
                            .reduce(Money.ZERO, BigDecimal::add);
                    return new ResourceView(r, cycleOf(r), unpaid.stream().map(BrickEarning::getAmount).reduce(Money.ZERO, BigDecimal::add), unpaid.size(),
                            outstanding.getOrDefault(r.getId(), Money.ZERO), mine.stream().map(BrickPaySlip::getPaidOn).max(LocalDate::compareTo).orElse(null),
                            mine.stream().filter(s -> !s.getPaidOn().isBefore(monthStart)).map(BrickPaySlip::getNet).reduce(Money.ZERO, BigDecimal::add),
                            mine.stream().map(BrickPaySlip::getNet).reduce(Money.ZERO, BigDecimal::add),
                            core.vehicles().findByTenantId(t).stream().filter(v -> r.getId().equals(v.getDriverId())).count(),
                            qty, trips, month.stream().map(BrickEarning::getAmount).reduce(Money.ZERO, BigDecimal::add), advTaken);
                }).toList();
    }

    public History history(Long id) {
        core.requireResource(id);
        ResourceView rv = resourceViews().stream().filter(v -> v.resource().getId().equals(id)).findFirst().orElseThrow();
        List<EarningView> all = new ArrayList<>(earningViews(core.earnings().findByResourceId(id)));
        java.util.Collections.reverse(all);
        return new History(rv, all, slipRows(id), advances(id));
    }

    private Long advanceResource(Long advanceId) {
        return core.slips().findById(advanceId).map(BrickPaySlip::getResourceId).orElse(0L);
    }

    // ================================================================== the payroll page

    public Payroll payroll() {
        Long t = UserContext.tenantId();
        List<EarningView> unpaid = earningViews(core.earnings().findByTenantId(t).stream().filter(e -> e.getSlipId() == null).toList());
        List<AdvanceView> adv = advances(null);
        Map<Long, BrickResource> rs = core.resources().findByTenantId(t).stream().collect(Collectors.toMap(BrickResource::getId, Function.identity()));
        List<AdvanceLine> owed = adv.stream().filter(a -> a.outstanding().signum() > 0).map(a -> {
            BrickResource r = rs.get(advanceResource(a.advanceId()));
            return new AdvanceLine(r == null ? null : r.getId(), r == null ? "?" : r.getName(), r == null ? null : r.getRole(), a);
        }).toList();
        return new Payroll(resourceViews(), slipRows(null), unpaid, unpaid.stream().map(EarningView::amount).reduce(Money.ZERO, BigDecimal::add),
                adv.stream().map(AdvanceView::outstanding).reduce(Money.ZERO, BigDecimal::add), owed);
    }

    public List<SlipRow> slipRows(Long resourceId) {
        Long t = UserContext.tenantId();
        Map<Long, BrickResource> rs = core.resources().findByTenantId(t).stream().collect(Collectors.toMap(BrickResource::getId, Function.identity()));
        Map<Long, String> acct = core.accounts().findByTenantId(t).stream().collect(Collectors.toMap(Account::getId, Account::getName));
        return core.slips().findByTenantId(t).stream().filter(s -> resourceId == null || resourceId.equals(s.getResourceId()))
                .sorted(Comparator.comparing(BrickPaySlip::getPaidOn).thenComparing(BrickPaySlip::getId).reversed())
                .map(s -> {
                    BrickResource r = rs.get(s.getResourceId());
                    return new SlipRow(s.getId(), s.getSlipNo(), s.getKind(), s.getStatus(), s.getResourceId(), r == null ? "?" : r.getName(), r == null ? null : r.getRole(),
                            s.getPeriodFrom(), s.getPeriodTo(), s.getPaidOn(), s.getGross(), Money.nz(s.getDeductions()), s.getNet(), s.getNarrative(),
                            s.getAccountId() == null ? null : acct.get(s.getAccountId()), s.getJournalEntryId());
                }).toList();
    }

    /** Previews for everyone paid on this cycle who has something due (or a wage) for the period. */
    public List<Preview> run(String cycle, LocalDate from, LocalDate to) {
        String c = cycle(cycle);
        return core.resources().findByTenantId(UserContext.tenantId()).stream()
                .filter(r -> Boolean.TRUE.equals(r.getActive()) && cycleOf(r).equals(c))
                .sorted(Comparator.comparing(BrickResource::getName, String.CASE_INSENSITIVE_ORDER))
                .map(r -> preview(r.getId(), c, from, to)).filter(p -> p.gross().signum() > 0).toList();
    }

    public Preview preview(Long resourceId, String cycle, LocalDate from, LocalDate to) {
        BrickResource r = core.requireResource(resourceId);
        String c = cycle(cycle);
        if (to.isBefore(from)) throw new BusinessException("The period ends before it starts");
        List<EarningView> due = earningViews(core.earnings().findByResourceId(resourceId).stream()
                .filter(e -> e.getSlipId() == null && !e.getEarnedOn().isAfter(to)).toList());
        BigDecimal wage = Money.ZERO;
        String label = null, note = null;
        if (!PIECE.equals(r.getSalaryType())) {
            label = (WEEKLY.equals(r.getSalaryType()) ? "Weekly wage " : "Salary ") + periodText(from, to);
            BrickPaySlip clash = wageClash(resourceId, from, to, null);
            if (clash != null) {
                note = "Already paid on " + clash.getSlipNo() + " (" + periodText(clash.getPeriodFrom(), clash.getPeriodTo()) + ")";
            } else if (cycleOf(r).equals(c)) {
                wage = Money.nz(r.getSalaryAmount());
            }
        }
        BigDecimal earned = due.stream().map(EarningView::amount).reduce(Money.ZERO, BigDecimal::add).add(wage);
        List<AdvanceView> adv = new ArrayList<>();
        BigDecimal room = earned;
        for (AdvanceView a : advances(resourceId)) {
            if (a.outstanding().signum() <= 0) continue;
            BigDecimal want = a.recoverPerCycle() != null && a.recoverPerCycle().signum() > 0 ? a.recoverPerCycle().min(a.outstanding()) : a.outstanding();
            BigDecimal take = want.min(room).max(Money.ZERO);
            room = room.subtract(take);
            adv.add(new AdvanceView(a.advanceId(), a.slipNo(), a.givenOn(), a.narrative(), a.amount(), a.recovered(), a.outstanding(), a.recoverPerCycle(), take));
        }
        ResourceView rv = resourceViews().stream().filter(v -> v.resource().getId().equals(resourceId)).findFirst().orElseThrow();
        return new Preview(rv, c, from, to, due, wage, label, note, adv, earned);
    }

    // ================================================================== slips

    @Transactional
    public SlipView pay(SlipRequest r) {
        Long t = UserContext.tenantId();
        BrickResource res = core.requireResource(r.resourceId());
        String cycle = cycle(r.cycle());
        if (r.periodTo().isBefore(r.periodFrom())) throw new BusinessException("The period ends before it starts");
        // the earnings: this resource's, not paid yet (one slip pays a batch or trip once)
        List<BrickEarning> picked = new ArrayList<>();
        for (Long id : r.earningIds() == null ? List.<Long>of() : r.earningIds().stream().distinct().toList()) {
            BrickEarning e = core.earnings().findByIdAndTenantId(id, t).orElseThrow(() -> new NotFoundException("Earning", id));
            if (!res.getId().equals(e.getResourceId())) throw new BusinessException("That work was done by someone else");
            if (e.getSlipId() != null) {
                String no = core.slips().findById(e.getSlipId()).map(BrickPaySlip::getSlipNo).orElse("another slip");
                throw new BusinessException("Already paid on " + no + ": " + Objects.toString(e.getNarrative(), kindLabel(e.getKind())) + ". It cannot be paid twice");
            }
            picked.add(e);
        }
        BigDecimal wage = Money.round(Money.nz(r.wage()));
        if (wage.signum() > 0) {
            if (PIECE.equals(res.getSalaryType())) throw new BusinessException(res.getName() + " is paid by the work done, not a wage");
            BrickPaySlip clash = wageClash(res.getId(), r.periodFrom(), r.periodTo(), null);
            if (clash != null) {
                throw new BusinessException("The " + (MONTHLY.equals(res.getSalaryType()) ? "salary" : "wage") + " for " + periodText(clash.getPeriodFrom(), clash.getPeriodTo())
                        + " was already paid on " + clash.getSlipNo() + "; the periods overlap");
            }
        }
        List<BonusInput> bonuses = r.bonuses() == null ? List.of() : r.bonuses();
        BigDecimal gross = picked.stream().map(BrickEarning::getAmount).reduce(Money.ZERO, BigDecimal::add).add(wage)
                .add(bonuses.stream().map(b -> Money.round(b.amount())).reduce(Money.ZERO, BigDecimal::add));
        if (gross.signum() <= 0) throw new BusinessException("Nothing to pay: pick the work done, a wage or a bonus");
        // advances taken back
        Map<Long, AdvanceView> open = advances(res.getId()).stream().collect(Collectors.toMap(AdvanceView::advanceId, Function.identity()));
        List<DeductionInput> ded = (r.deductions() == null ? List.<DeductionInput>of() : r.deductions()).stream().filter(d -> d.amount().signum() > 0).toList();
        BigDecimal totalDed = Money.ZERO;
        for (DeductionInput d : ded) {
            AdvanceView a = open.get(d.advanceId());
            if (a == null) throw new BusinessException("That advance is not " + res.getName() + "'s");
            if (d.amount().compareTo(a.outstanding()) > 0) {
                throw new BusinessException("Only " + ActivityService.money(a.outstanding()) + " of advance " + a.slipNo() + " is still to be taken back");
            }
            totalDed = totalDed.add(Money.round(d.amount()));
        }
        if (totalDed.compareTo(gross) > 0) throw new BusinessException("The advances taken back are more than the pay");
        BigDecimal net = gross.subtract(totalDed);
        Long accountId = net.signum() > 0 ? core.moneyAccountOr(r.accountId(), false) : null;

        BrickPaySlip s = new BrickPaySlip();
        s.setTenantId(t);
        s.setSlipNo(BrickService.nextNo("PS-", core.slips().findByTenantId(t).stream().map(BrickPaySlip::getSlipNo)));
        s.setKind(cycle);
        s.setResourceId(res.getId());
        s.setPeriodFrom(r.periodFrom());
        s.setPeriodTo(r.periodTo());
        s.setGross(gross);
        s.setDeductions(totalDed.signum() == 0 ? null : totalDed);
        s.setNet(net);
        s.setPaidOn(r.paidOn());
        s.setAccountId(accountId);
        s.setMode(mode(r.mode()));
        s.setReference(BrickService.blank(r.reference()));
        s.setNarrative(BrickService.blank(r.note()));
        s.setStatus(PAID);
        s.setCreatedBy(UserContext.get().fullName());
        s.setCreatedAt(LocalDateTime.now());
        s = core.slips().save(s);
        Long slipId = s.getId();
        for (BrickEarning e : picked) {
            e.setSlipId(slipId);
            core.earnings().save(e);
        }
        if (wage.signum() > 0) {
            BrickEarning w = earning(res, MONTHLY.equals(res.getSalaryType()) ? SALARY : WAGE, r.periodTo(), wage,
                    (MONTHLY.equals(res.getSalaryType()) ? "Salary " : "Weekly wage ") + periodText(r.periodFrom(), r.periodTo()));
            w.setSlipId(slipId);
            core.earnings().save(w);
        }
        for (BonusInput b : bonuses) {
            BrickEarning x = earning(res, BONUS, r.paidOn(), Money.round(b.amount()), b.label().trim());
            x.setSlipId(slipId);
            core.earnings().save(x);
        }
        for (DeductionInput d : ded) {
            BrickAdvanceRecovery rc = new BrickAdvanceRecovery();
            rc.setTenantId(t);
            rc.setAdvanceId(d.advanceId());
            rc.setSlipId(slipId);
            rc.setAmount(Money.round(d.amount()));
            rc.setCreatedAt(LocalDateTime.now());
            core.recoveries().save(rc);
        }
        // the books: what was earned by head, less advances taken back, paid from the account
        List<BrickEarning> lines = core.earnings().findBySlipId(slipId);
        BigDecimal production = sum(lines, Set.of(PRODUCTION)), handling = sum(lines, Set.of(LOADING, UNLOADING, TRIP)), salaries = sum(lines, Set.of(WAGE, SALARY, BONUS));
        JournalDraft draft = JournalDraft.of(s.getPaidOn(), VoucherType.BRICK_WAGES, "Pay slip " + s.getSlipNo() + " · " + res.getName() + " · " + periodText(s.getPeriodFrom(), s.getPeriodTo()))
                .debit(core.account("WAGES").getId(), production, "Bricks made")
                .debit(core.account("HANDLING_COST").getId(), handling, "Trips, loading and unloading")
                .debit(core.account("SALARIES").getId(), salaries, "Wages, salary and bonus")
                .credit(core.account("ADVANCES").getId(), totalDed, "Advances taken back")
                .reference(s.getSlipNo()).party(res.getName()).source(BrickService.SOURCE_SLIP, slipId);
        if (accountId != null) draft.credit(accountId, net, s.getMode() + (s.getReference() != null ? " " + s.getReference() : ""));
        s.setJournalEntryId(core.post(draft).getId());
        sign(s, res, lines);
        core.slips().save(s);
        core.activity().record("ADDED", BrickService.AREA, "Pay slip " + s.getSlipNo() + " · " + res.getName() + " · " + ActivityService.money(net)
                + (totalDed.signum() > 0 ? " (after " + ActivityService.money(totalDed) + " advance)" : ""));
        return slip(slipId);
    }

    @Transactional
    public SlipView advance(AdvanceRequest r) {
        Long t = UserContext.tenantId();
        BrickResource res = core.requireResource(r.resourceId());
        Long accountId = core.moneyAccountOr(r.accountId(), false);
        BrickPaySlip s = new BrickPaySlip();
        s.setTenantId(t);
        s.setSlipNo(BrickService.nextNo("AD-", core.slips().findByTenantId(t).stream().map(BrickPaySlip::getSlipNo)));
        s.setKind(ADVANCE);
        s.setResourceId(res.getId());
        s.setGross(Money.round(r.amount()));
        s.setNet(Money.round(r.amount()));
        s.setPaidOn(r.givenOn());
        s.setAccountId(accountId);
        s.setMode(mode(r.mode()));
        s.setReference(BrickService.blank(r.reference()));
        s.setNarrative(r.narrative().trim());
        s.setRecoverPerCycle(r.recoverPerCycle() == null || r.recoverPerCycle().signum() == 0 ? null : Money.round(r.recoverPerCycle()));
        s.setStatus(PAID);
        s.setCreatedBy(UserContext.get().fullName());
        s.setCreatedAt(LocalDateTime.now());
        s = core.slips().save(s);
        s.setJournalEntryId(core.post(JournalDraft.of(s.getPaidOn(), VoucherType.BRICK_ADVANCE, "Advance " + s.getSlipNo() + " · " + res.getName() + " · " + s.getNarrative())
                .debit(core.account("ADVANCES").getId(), s.getNet(), s.getNarrative())
                .credit(accountId, s.getNet(), s.getMode() + (s.getReference() != null ? " " + s.getReference() : ""))
                .reference(s.getSlipNo()).party(res.getName()).source(BrickService.SOURCE_SLIP, s.getId())).getId());
        sign(s, res, List.of());
        core.slips().save(s);
        core.activity().record("ADDED", BrickService.AREA, "Advance " + s.getSlipNo() + " · " + ActivityService.money(s.getNet()) + " to " + res.getName() + " · " + s.getNarrative());
        return slip(s.getId());
    }

    /** Cancels a slip: its entry leaves the books, the work it paid is due again, an advance it took back is owed again. */
    @Transactional
    public SlipView cancel(Long slipId) {
        BrickPaySlip s = requireSlip(slipId);
        if (CANCELLED.equals(s.getStatus())) throw new BusinessException(s.getSlipNo() + " is already cancelled");
        if (ADVANCE.equals(s.getKind())) {
            List<String> on = core.recoveries().findByAdvanceId(slipId).stream().map(x -> core.slips().findById(x.getSlipId()).map(BrickPaySlip::getSlipNo).orElse("?")).toList();
            if (!on.isEmpty()) throw new BusinessException("Part of this advance was already taken back on " + String.join(", ", on) + "; cancel those slips first");
        }
        for (BrickEarning e : core.earnings().findBySlipId(slipId)) {
            if (Set.of(WAGE, SALARY, BONUS).contains(e.getKind()) && "SLIP".equals(e.getSourceType())) {
                core.earnings().delete(e);
            } else {
                e.setSlipId(null);
                core.earnings().save(e);
            }
        }
        core.recoveries().findBySlipId(slipId).forEach(core.recoveries()::delete);
        Long entry = s.getJournalEntryId();
        s.setJournalEntryId(null);
        s.setStatus(CANCELLED);
        s.setCancelledAt(LocalDateTime.now());
        s.setCancelledBy(UserContext.get().fullName());
        core.slips().save(s);
        core.unpost(entry);
        core.activity().record("CANCELLED", BrickService.AREA, "Cancelled " + s.getSlipNo() + " · " + core.resourceName(s.getResourceId()) + " · " + ActivityService.money(s.getNet()));
        return slip(slipId);
    }

    public SlipView slip(Long slipId) {
        BrickPaySlip s = requireSlip(slipId);
        Long t = s.getTenantId();
        BrickResource r = core.resources().findById(s.getResourceId()).orElse(null);
        List<EarningView> lines = earningViews(core.earnings().findBySlipId(slipId).stream()
                .sorted(Comparator.comparing(BrickEarning::getEarnedOn).thenComparing(BrickEarning::getId)).toList());
        List<DeductionLine> ded = new ArrayList<>();
        for (BrickAdvanceRecovery rc : core.recoveries().findBySlipId(slipId)) {
            BrickPaySlip a = core.slips().findById(rc.getAdvanceId()).orElse(null);
            if (a == null) continue;
            BigDecimal before = a.getNet().subtract(core.recoveries().findByAdvanceId(a.getId()).stream()
                    .filter(x -> x.getId() < rc.getId()).map(BrickAdvanceRecovery::getAmount).reduce(Money.ZERO, BigDecimal::add));
            ded.add(new DeductionLine(a.getId(), a.getSlipNo(), a.getPaidOn(), a.getNarrative(), a.getNet(), before, rc.getAmount(), before.subtract(rc.getAmount())));
        }
        AdvanceView adv = null;
        List<DeductionLine> recovered = List.of();
        if (ADVANCE.equals(s.getKind())) {
            adv = advances(s.getResourceId()).stream().filter(a -> a.advanceId().equals(slipId)).findFirst().orElse(null);
            BigDecimal[] run = {s.getNet()};
            recovered = core.recoveries().findByAdvanceId(slipId).stream().sorted(Comparator.comparing(BrickAdvanceRecovery::getId)).map(rc -> {
                BrickPaySlip on = core.slips().findById(rc.getSlipId()).orElse(null);
                BigDecimal before = run[0];
                run[0] = run[0].subtract(rc.getAmount());
                return new DeductionLine(rc.getSlipId(), on == null ? "?" : on.getSlipNo(), on == null ? null : on.getPaidOn(), null, s.getNet(), before, rc.getAmount(), run[0]);
            }).toList();
        }
        BrickService.Company company = core.company();
        String account = s.getAccountId() == null ? null : core.accounts().findById(s.getAccountId()).map(Account::getName).orElse(null);
        String entry = s.getJournalEntryId() == null ? null : core.entries().findById(s.getJournalEntryId()).map(com.aditya.personalbudget.domain.entity.JournalEntry::getEntryNo).orElse(null);
        return new SlipView(s, r, lines, ded, account, HostedChitService.inWords(s.getNet()), entry, company, core.appSettings().payLinkPublicKey(),
                core.appSettings().payLinkFingerprint(), adv, recovered);
    }

    /** The slip as exact text, signed with this installation's key: the slip's page (and anyone it is shown to) can check it. */
    private void sign(BrickPaySlip s, BrickResource r, List<BrickEarning> lines) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("v", 1);
        p.put("kind", ADVANCE.equals(s.getKind()) ? "BRICK_ADVANCE" : "BRICK_PAY_SLIP");
        p.put("slipNo", s.getSlipNo());
        p.put("organization", UserContext.get().tenantName());
        p.put("to", r.getName());
        p.put("role", r.getRole());
        p.put("periodFrom", s.getPeriodFrom() == null ? null : s.getPeriodFrom().toString());
        p.put("periodTo", s.getPeriodTo() == null ? null : s.getPeriodTo().toString());
        p.put("gross", s.getGross().toPlainString());
        p.put("deductions", Money.nz(s.getDeductions()).toPlainString());
        p.put("net", s.getNet().toPlainString());
        p.put("paidOn", s.getPaidOn().toString());
        p.put("mode", s.getMode());
        p.put("narrative", s.getNarrative());
        p.put("lines", HostedChitService.sha256(lines.stream().map(e -> e.getKind() + ":" + e.getSourceType() + ":" + e.getSourceId() + ":" + e.getAmount().toPlainString())
                .collect(Collectors.joining("|"))));
        p.put("issuedBy", s.getCreatedBy());
        p.put("issuedAt", s.getCreatedAt().withNano(0).toString());
        s.setPayload(ActivityService.cut(Kyc.json(p), 4000));
        s.setDigitalSignature(core.appSettings().signPayLink(s.getPayload()));
    }

    // ================================================================== earnings from deliveries

    /** A trip's earning for a resource (loading, unloading or the driver's trip): kept in step while unpaid; refused once paid. */
    void tripEarning(Long resourceId, String kind, Long tripId, LocalDate on, Integer quantity, BigDecimal rate, BigDecimal amount, String narrative) {
        Long t = UserContext.tenantId();
        BrickEarning e = core.earnings().findByTenantId(t).stream().filter(x -> "TRIP".equals(x.getSourceType()) && tripId.equals(x.getSourceId()) && kind.equals(x.getKind()))
                .findFirst().orElse(null);
        BrickResource r = resourceId == null ? null : core.resources().findById(resourceId).orElse(null);
        boolean earns = r != null && Money.nz(amount).signum() > 0;
        if (e != null && e.getSlipId() != null) {
            if (!earns || !e.getResourceId().equals(resourceId) || e.getAmount().compareTo(Money.round(amount)) != 0) {
                throw new BusinessException(kindLabel(kind) + " of this trip was already paid on "
                        + core.slips().findById(e.getSlipId()).map(BrickPaySlip::getSlipNo).orElse("a slip") + "; cancel that slip first");
            }
            return;
        }
        if (!earns) {
            if (e != null) core.earnings().delete(e);
            return;
        }
        if (e == null) {
            e = earning(r, kind, on, Money.round(amount), narrative);
            e.setSourceType("TRIP");
            e.setSourceId(tripId);
        }
        e.setResourceId(r.getId());
        e.setEarnedOn(on);
        e.setQuantity(quantity);
        e.setRate(rate);
        e.setAmount(Money.round(amount));
        e.setNarrative(ActivityService.cut(narrative, 200));
        core.earnings().save(e);
    }

    /** Takes back what a trip earned (when the trip goes back a step); refused when it was paid. */
    void dropTripEarnings(Long tripId, Set<String> kinds) {
        for (BrickEarning e : core.earnings().findByTenantId(UserContext.tenantId())) {
            if (!"TRIP".equals(e.getSourceType()) || !tripId.equals(e.getSourceId()) || !kinds.contains(e.getKind())) continue;
            if (e.getSlipId() != null) {
                throw new BusinessException(kindLabel(e.getKind()) + " of this trip was already paid on "
                        + core.slips().findById(e.getSlipId()).map(BrickPaySlip::getSlipNo).orElse("a slip") + "; cancel that slip first");
            }
            core.earnings().delete(e);
        }
    }

    // ================================================================== helpers

    /** Advances given (optionally to one resource) with what was taken back and what is still owed. */
    public List<AdvanceView> advances(Long resourceId) {
        Long t = UserContext.tenantId();
        Map<Long, BigDecimal> back = core.recoveries().findByTenantId(t).stream()
                .collect(Collectors.groupingBy(BrickAdvanceRecovery::getAdvanceId, Collectors.reducing(Money.ZERO, BrickAdvanceRecovery::getAmount, BigDecimal::add)));
        return core.slips().findByTenantId(t).stream()
                .filter(s -> ADVANCE.equals(s.getKind()) && PAID.equals(s.getStatus()) && (resourceId == null || resourceId.equals(s.getResourceId())))
                .sorted(Comparator.comparing(BrickPaySlip::getPaidOn).thenComparing(BrickPaySlip::getId))
                .map(s -> {
                    BigDecimal rec = back.getOrDefault(s.getId(), Money.ZERO);
                    BigDecimal out = s.getNet().subtract(rec);
                    return new AdvanceView(s.getId(), s.getSlipNo(), s.getPaidOn(), s.getNarrative(), s.getNet(), rec, out, s.getRecoverPerCycle(), null);
                }).toList();
    }

    private BrickPaySlip wageClash(Long resourceId, LocalDate from, LocalDate to, Long except) {
        Set<Long> withWage = new HashSet<>();
        core.earnings().findByResourceId(resourceId).stream().filter(e -> (WAGE.equals(e.getKind()) || SALARY.equals(e.getKind())) && e.getSlipId() != null)
                .forEach(e -> withWage.add(e.getSlipId()));
        return core.slips().findByResourceId(resourceId).stream()
                .filter(s -> PAID.equals(s.getStatus()) && withWage.contains(s.getId()) && !s.getId().equals(except)
                        && s.getPeriodFrom() != null && !s.getPeriodFrom().isAfter(to) && !s.getPeriodTo().isBefore(from))
                .findFirst().orElse(null);
    }

    private BrickEarning earning(BrickResource r, String kind, LocalDate on, BigDecimal amount, String narrative) {
        BrickEarning e = new BrickEarning();
        e.setTenantId(r.getTenantId());
        e.setResourceId(r.getId());
        e.setKind(kind);
        e.setSourceType("SLIP");
        e.setEarnedOn(on);
        e.setAmount(amount);
        e.setNarrative(ActivityService.cut(narrative, 200));
        e.setCreatedAt(LocalDateTime.now());
        return e;
    }

    private List<EarningView> earningViews(List<BrickEarning> list) {
        Map<Long, String> slipNo = core.slips().findByTenantId(UserContext.tenantId()).stream().collect(Collectors.toMap(BrickPaySlip::getId, BrickPaySlip::getSlipNo));
        return list.stream().sorted(Comparator.comparing(BrickEarning::getEarnedOn).thenComparing(BrickEarning::getId))
                .map(e -> new EarningView(e.getId(), e.getKind(), kindLabel(e.getKind()), e.getEarnedOn(), e.getQuantity(), e.getRate(), e.getAmount(),
                        e.getNarrative(), e.getSourceType(), e.getSourceId(), e.getSlipId(), e.getSlipId() == null ? null : slipNo.get(e.getSlipId())))
                .toList();
    }

    private static BigDecimal sum(List<BrickEarning> list, Set<String> kinds) {
        return list.stream().filter(e -> kinds.contains(e.getKind())).map(BrickEarning::getAmount).reduce(Money.ZERO, BigDecimal::add);
    }

    static String kindLabel(String kind) {
        return switch (kind) {
            case PRODUCTION -> "Bricks made";
            case LOADING -> "Loading";
            case UNLOADING -> "Unloading";
            case TRIP -> "Delivery trip";
            case WAGE -> "Weekly wage";
            case SALARY -> "Salary";
            case BONUS -> "Bonus / incentive";
            default -> kind;
        };
    }

    static String periodText(LocalDate from, LocalDate to) {
        if (from == null) return "";
        java.time.format.DateTimeFormatter d = java.time.format.DateTimeFormatter.ofPattern("d MMM");
        java.time.format.DateTimeFormatter y = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy");
        if (from.equals(to)) return from.format(y);
        if (from.getDayOfMonth() == 1 && to.equals(from.withDayOfMonth(from.lengthOfMonth()))) {
            return from.format(java.time.format.DateTimeFormatter.ofPattern("MMMM yyyy"));
        }
        return from.format(d) + " – " + to.format(y);
    }

    private static String cycle(String c) {
        String v = c == null ? WEEKLY : c.trim().toUpperCase();
        if (!Set.of(WEEKLY, MONTHLY).contains(v)) throw new BusinessException("A weekly or a monthly payment");
        return v;
    }

    static String mode(String m) {
        if (m == null || m.isBlank()) return "Cash";
        return MODES.stream().filter(x -> x.equalsIgnoreCase(m.trim())).findFirst().orElseThrow(() -> new BusinessException("Paid by cash, UPI, bank or cheque"));
    }

    private BrickPaySlip requireSlip(Long id) {
        return core.slips().findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Payment slip", id));
    }
}
