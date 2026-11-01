package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Chit;
import com.aditya.personalbudget.domain.entity.ChitShare;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.InstallmentStatus;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.ChitDtos.ChitDetail;
import com.aditya.personalbudget.dto.ChitDtos.ChitView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.ChitRepository;
import com.aditya.personalbudget.repository.ChitShareRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;

/**
 * Links to where a chit stands (see {@link ChitShare}): the person opens the link on their phone, without an account,
 * and sees the chit as of that moment: who runs it, how much of it is paid and what is still to pay, the next
 * installment, what it pays out and when it ends (or what was received, once paid out), optionally every installment.
 * The household's account names, notes, the organizer's phone and UPI stay out.
 */
@Service
public class ChitShareService {

    /** Chit links live at most 90 days. */
    public static final int MAX_HOURS = 24 * 90;

    public record ShareRequest(@Size(max = 80) String sharedWith, @Min(1) @Max(MAX_HOURS) int hours,
                               boolean showInstallments, @Size(max = 300) String message, boolean showReturns) {

        public ShareRequest(String sharedWith, int hours, boolean showInstallments, String message) {
            this(sharedWith, hours, showInstallments, message, false);
        }
    }

    public record ShareView(Long id, Long chitId, String sharedWith, boolean showInstallments, boolean showReturns, String message,
                            String createdByName, LocalDateTime createdAt, LocalDateTime expiresAt, LocalDateTime revokedAt,
                            int views, LocalDateTime lastViewedAt, String status) {
    }

    /** A new link: the token is returned this once. */
    public record CreatedShare(ShareView share, String token) {
    }

    /**
     * What the person with the link sees. {@code receive}: what the chit pays out ({@code receiveOn}): the payout taken,
     * or the maturity amount at the end. {@code stage}: RUNNING (paying, prize not taken), PRIZED (prize taken, dues
     * left), COMPLETED (all paid and paid out) or CLOSED.
     */
    public record Statement(String chitName, String organizer, String ticketNo, String household, String sharedBy, String sharedWith,
                            String message, String currency, LocalDate asOf, LocalDateTime expiresAt,
                            String stage, String stageLabel,
                            BigDecimal chitValue, BigDecimal monthlyInstallment, int numberOfInstallments,
                            LocalDate startDate, LocalDate endDate, LocalDate maturityDate, long daysToEnd, int monthsLeft,
                            int installmentsPaid, int installmentsPending, int overdueCount, BigDecimal overdueAmount,
                            BigDecimal progressPercent, LocalDate nextDueDate, BigDecimal nextDueAmount,
                            BigDecimal totalContribution, BigDecimal paidIn, BigDecimal cashPaid, BigDecimal dividendsEarned,
                            BigDecimal stillToPay,
                            boolean paidOut, BigDecimal receive, LocalDate receiveOn, BigDecimal payoutReceived, BigDecimal payoutPending,
                            BigDecimal netGain, boolean showInstallments, List<Installment> installments,
                            /* the returns, when the sender chose to show them (null otherwise) */
                            Returns returns) {
    }

    /**
     * What the chit earns, for someone who is not an accountant. {@code nominalRate}: the chit's rate a year (the one you
     * set, or the one its maturity amount implies: {@code rateBasis}); {@code compoundRate}: that rate as an effective
     * annual return, interest on interest included (comparable to a bank's annual yield); {@code simpleRate}: the flat
     * rate a year that gives the same interest on the money while it sits in the chit. {@code valueToday}: paid in plus
     * the interest earned to this day (this month's part included), growing by {@code perDay} a day now. {@code growth}:
     * month by month, what was paid in and what it is worth. {@code fdInterest}: the same installments in a 7% recurring
     * deposit, to compare.
     */
    public record Returns(BigDecimal nominalRate, String rateBasis, BigDecimal compoundRate, BigDecimal simpleRate,
                          BigDecimal interestSoFar, BigDecimal simpleInterestSoFar, BigDecimal interestAtEnd, BigDecimal simpleInterestAtEnd,
                          BigDecimal valueToday, BigDecimal perDay, BigDecimal perMonth, boolean growing,
                          BigDecimal fdRate, BigDecimal fdInterest, BigDecimal vsFd, List<GrowthPoint> growth) {
    }

    /** One month of the chit: on {@code date}, paid in so far and the value with compound / simple interest. */
    public record GrowthPoint(int month, LocalDate date, BigDecimal paidIn, BigDecimal value, BigDecimal simpleValue,
                              BigDecimal interest, String status) {
    }

    /** The bank rate the returns are compared with (a recurring deposit, compounded monthly). */
    private static final double FD_RATE = 7.0;

    /** One installment as the shared page shows it (no accounts). */
    public record Installment(int no, LocalDate dueDate, BigDecimal dueAmount, BigDecimal dividend, BigDecimal paidAmount,
                              LocalDate paidDate, String status) {
    }

    private final ChitShareRepository shares;
    private final ChitRepository chits;
    private final OrganizationRepository tenants;
    private final ChitService chitService;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public ChitShareService(ChitShareRepository shares, ChitRepository chits, OrganizationRepository tenants,
                            ChitService chitService, ActivityService activity) {
        this.shares = shares;
        this.chits = chits;
        this.tenants = tenants;
        this.chitService = chitService;
        this.activity = activity;
    }

    public List<ShareView> list(Long chitId) {
        chit(chitId);
        return shares.findByChitId(chitId).stream()
                .sorted(Comparator.comparing(ChitShare::getCreatedAt).reversed())
                .map(ChitShareService::view)
                .toList();
    }

    @Transactional
    public CreatedShare create(Long chitId, ShareRequest r) {
        Chit c = chit(chitId);
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        LocalDateTime now = OrgClock.now();
        ChitShare s = new ChitShare();
        s.setTenantId(c.getTenantId());
        s.setChitId(c.getId());
        s.setTokenHash(AccessLinkService.hash(token));
        s.setSharedWith(blank(r.sharedWith()));
        s.setShowInstallments(r.showInstallments());
        s.setShowReturns(r.showReturns());
        s.setMessage(blank(r.message()));
        s.setCreatedByName(UserContext.get().fullName());
        s.setCreatedAt(now);
        s.setExpiresAt(now.plusHours(r.hours()));
        s.setViews(0);
        s = shares.save(s);
        activity.record("ADDED", "Chits", "Shared the chit " + c.getName()
                + (s.getSharedWith() != null ? " with " + s.getSharedWith() : "") + " · " + days(r.hours()));
        return new CreatedShare(view(s), token);
    }

    @Transactional
    public ShareView revoke(Long chitId, Long shareId) {
        Chit c = chit(chitId);
        ChitShare s = shares.findByIdAndTenantId(shareId, c.getTenantId())
                .filter(x -> x.getChitId().equals(chitId))
                .orElseThrow(() -> new NotFoundException("Chit link", shareId));
        if (s.getRevokedAt() == null) {
            s.setRevokedAt(OrgClock.now());
            s = shares.save(s);
            activity.record("REVOKED", "Chits", "Stopped the link to the chit " + c.getName()
                    + (s.getSharedWith() != null ? " for " + s.getSharedWith() : ""));
        }
        return view(s);
    }

    /** Someone opened a chit link: the chit as of now (counts the view). No sign-in. */
    @Transactional
    public Statement open(String token) {
        ChitShare s = active(token);
        Organization tenant = tenants.findById(s.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This chit is no longer shared"));
        s.setViews((s.getViews() == null ? 0 : s.getViews()) + 1);
        s.setLastViewedAt(OrgClock.now());
        shares.save(s);
        CurrentUser previous = UserContext.current().orElse(null);
        OrgClock.showFor(tenant.getId());   // the answer is written after this: in the organization's zone
        UserContext.set(new CurrentUser(null, "chit-link", "Chit link", UserRole.VIEWER, tenant.getId(), tenant.getCode(),
                tenant.getName(), tenant.getCurrency(), Feature.all(), false));
        try {
            return statement(chitService.detail(s.getChitId()), s, tenant);
        } finally {
            if (previous != null) {
                UserContext.set(previous);
            } else {
                UserContext.clear();
            }
        }
    }

    private static Statement statement(ChitDetail d, ChitShare s, Organization t) {
        ChitView c = d.chit();
        LocalDate today = OrgClock.today();
        boolean paidOut = c.payoutAmount() != null;
        boolean done = c.installmentsPending() == 0;
        String stage = switch (c.status()) {
            case CLOSED -> "CLOSED";
            case MATURED -> "COMPLETED";
            case PRIZED -> done ? "COMPLETED" : "PRIZED";
            default -> paidOut ? (done ? "COMPLETED" : "PRIZED") : "RUNNING";
        };
        String stageLabel = switch (stage) {
            case "CLOSED" -> "Closed";
            case "COMPLETED" -> "Completed";
            case "PRIZED" -> "Prize taken · installments continue";
            default -> "Running";
        };
        LocalDate end = c.endDate() != null ? c.endDate() : c.maturityDate();
        int monthsLeft = end == null || !end.isAfter(today) ? 0
                : (int) java.time.temporal.ChronoUnit.MONTHS.between(today.withDayOfMonth(1), end.withDayOfMonth(1));
        List<Installment> list = !Boolean.TRUE.equals(s.getShowInstallments()) ? List.of() : d.installments().stream()
                .map(i -> new Installment(i.installmentNo(), i.dueDate(), i.dueAmount(), i.dividend(), i.paidAmount(), i.paidDate(),
                        i.status() == InstallmentStatus.PAID ? "PAID" : i.overdue() ? "OVERDUE" : "PENDING"))
                .toList();
        return new Statement(c.name(), c.organizer(), c.ticketNo(), t.getName(), s.getCreatedByName(), s.getSharedWith(),
                s.getMessage(), t.getCurrency(), today, s.getExpiresAt(), stage, stageLabel,
                c.maturityAmount(), c.monthlyInstallment(), c.numberOfInstallments(), c.startDate(), end, c.maturityDate(),
                end == null ? 0 : java.time.temporal.ChronoUnit.DAYS.between(today, end), monthsLeft,
                c.installmentsPaid(), c.installmentsPending(), c.overdueCount(), c.overdueAmount(), c.progressPercent(),
                c.nextDueDate(), c.nextDueAmount(), c.totalContribution(), c.paidIn(), c.cashPaid(), c.dividendsEarned(), c.stillToPay(),
                paidOut, paidOut ? c.payoutAmount() : c.maturityAmount(), paidOut ? c.payoutDate() : c.maturityDate(),
                paidOut ? c.payoutReceived() : null, paidOut ? c.payoutPending() : null,
                paidOut ? c.realizedGain() : c.projectedNetGain(), !list.isEmpty(), list,
                Boolean.TRUE.equals(s.getShowReturns()) ? returns(d, today) : null);
    }

    /** The chit's returns, worked out from its rate and its interest schedule (see ChitService#interestSchedule). */
    static Returns returns(ChitDetail d, LocalDate today) {
        ChitView c = d.chit();
        double nominal = c.rateUsed() == null ? 0 : c.rateUsed().doubleValue();
        double r = nominal / 1200;
        int n = c.numberOfInstallments();
        double m = c.monthlyInstallment().doubleValue();
        // simple equivalent: installment k sits in the chit for (n - k + 1) months, so the money-months are m * n(n+1)/2
        double fullInterest = 0;
        for (int k = 1; k <= n; k++) {
            fullInterest += m * (Math.pow(1 + r, n - k + 1) - 1);
        }
        double simpleRate = m > 0 && n > 0 ? fullInterest / (m * n * (n + 1) / 2.0 / 12) * 100 : 0;
        double compoundRate = (Math.pow(1 + r, 12) - 1) * 100;
        double fd = 0;
        for (int k = 0; k < n; k++) {
            fd = (fd + m) * (1 + FD_RATE / 1200);
        }
        double fdInterest = fd - m * n;

        // this month's interest so far: the month under way earns day by day
        double accrued = 0;
        for (var row : d.interestSchedule()) {
            if (row.status() == com.aditya.personalbudget.dto.ChitDtos.InterestStatus.ACCRUING) {
                long whole = java.time.temporal.ChronoUnit.DAYS.between(row.installmentDate(), row.interestDate());
                long gone = java.time.temporal.ChronoUnit.DAYS.between(row.installmentDate(), today);
                if (whole > 0 && gone > 0) {
                    accrued += row.compoundInterest().doubleValue() * Math.min(1, (double) gone / whole);
                }
            }
        }
        boolean paidOut = c.payoutAmount() != null;
        double valueToday = paidOut ? 0 : c.paidIn().doubleValue() + c.compoundInterestEarned().doubleValue() + accrued;
        double perMonth = paidOut ? 0 : valueToday * r;
        List<GrowthPoint> growth = d.interestSchedule().stream()
                .map(row -> new GrowthPoint(row.period(), row.interestDate(), row.principal(), row.closingBalance(),
                        Money.round(row.principal().add(row.cumulativeSimple())), row.compoundInterest(), row.status().name()))
                .toList();
        return new Returns(BigDecimal.valueOf(nominal).setScale(2, java.math.RoundingMode.HALF_UP), c.rateBasis(),
                BigDecimal.valueOf(compoundRate).setScale(2, java.math.RoundingMode.HALF_UP),
                BigDecimal.valueOf(simpleRate).setScale(2, java.math.RoundingMode.HALF_UP),
                c.compoundInterestEarned(), c.simpleInterestEarned(), c.projectedCompoundInterest(), c.projectedSimpleInterest(),
                Money.round(BigDecimal.valueOf(valueToday)), Money.round(BigDecimal.valueOf(perMonth * 12 / 365)), Money.round(BigDecimal.valueOf(perMonth)),
                !paidOut && valueToday > 0, BigDecimal.valueOf(FD_RATE).setScale(1, java.math.RoundingMode.HALF_UP),
                Money.round(BigDecimal.valueOf(fdInterest)), Money.round(c.projectedCompoundInterest().subtract(BigDecimal.valueOf(fdInterest))), growth);
    }

    private ChitShare active(String token) {
        ChitShare s = token == null || token.isBlank() ? null : shares.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (s == null) {
            throw new BusinessException("This link is not valid");
        }
        if (s.getRevokedAt() != null) {
            throw new BusinessException("This chit link was switched off");
        }
        if (!s.getExpiresAt().isAfter(OrgClock.now())) {
            throw new BusinessException("This chit link has expired. Ask for a new one.");
        }
        return s;
    }

    private Chit chit(Long id) {
        return chits.findByIdAndTenantId(id, UserContext.tenantId()).orElseThrow(() -> new NotFoundException("Chit", id));
    }

    private static ShareView view(ChitShare s) {
        LocalDateTime now = OrgClock.now();
        String status = s.getRevokedAt() != null ? "REVOKED" : s.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new ShareView(s.getId(), s.getChitId(), s.getSharedWith(), Boolean.TRUE.equals(s.getShowInstallments()),
                Boolean.TRUE.equals(s.getShowReturns()), s.getMessage(),
                s.getCreatedByName(), s.getCreatedAt(), s.getExpiresAt(), s.getRevokedAt(),
                s.getViews() == null ? 0 : s.getViews(), s.getLastViewedAt(), status);
    }

    private static String days(int hours) {
        return hours % 24 == 0 ? hours / 24 + " day" + (hours == 24 ? "" : "s") : hours + " h";
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
