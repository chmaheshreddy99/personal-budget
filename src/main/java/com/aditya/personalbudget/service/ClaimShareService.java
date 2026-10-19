package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Claim;
import com.aditya.personalbudget.domain.entity.ClaimShare;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.ClaimDtos.ClaimView;
import com.aditya.personalbudget.dto.ClaimDtos.InterestPeriod;
import com.aditya.personalbudget.dto.ClaimDtos.RepaymentView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.ClaimRepository;
import com.aditya.personalbudget.repository.ClaimShareRepository;
import com.aditya.personalbudget.repository.TenantRepository;
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
 * Statement links for money lent or borrowed (see {@link ClaimShare}): the other person opens the link, without an
 * account, and sees where the item stands today: given, paid back (each payment with what was left after it), the
 * interest so far and what falls due next, and what is payable now; optionally the month-by-month interest. It is
 * worked out when the link is opened, so it is always current. Account names, notes and anything else of the
 * household stay out.
 */
@Service
public class ClaimShareService {

    /** Statement links live at most 180 days. */
    public static final int MAX_HOURS = 24 * 180;

    public record ShareRequest(@Size(max = 80) String sharedWith, @Min(1) @Max(MAX_HOURS) int hours,
                               boolean showSchedule, @Size(max = 300) String message) {
    }

    public record ShareView(Long id, Long claimId, String sharedWith, boolean showSchedule, String message,
                            String createdByName, LocalDateTime createdAt, LocalDateTime expiresAt, LocalDateTime revokedAt,
                            int views, LocalDateTime lastViewedAt, String status) {
    }

    /** A new link: the token is returned this once. */
    public record CreatedShare(ShareView share, String token) {
    }

    /** What the person with the link sees. {@code owedByViewer}: the viewer owes the money (it was lent to them). */
    public record Statement(String kind, String kindLabel, boolean owedByViewer, String party, String sharedWith,
                            String sharedBy, String household, String currency, String narration, String message,
                            LocalDate asOf, LocalDateTime expiresAt,
                            BigDecimal amount, LocalDate startDate, LocalDate dueDate, boolean overdue, Long daysToDue,
                            String status, String statusLabel, long daysOutstanding,
                            BigDecimal repaid, BigDecimal writtenOff, BigDecimal outstanding, BigDecimal repaidPercent,
                            BigDecimal interestRate, String interestTypeLabel, String interestCollection,
                            String interestCollectionLabel, String dayCount,
                            BigDecimal interestAccrued, BigDecimal interestPaid, BigDecimal interestDue,
                            BigDecimal interestDueNow, LocalDate nextInterestDate, BigDecimal nextInterestAmount,
                            BigDecimal monthlyInterest, BigDecimal payableToday, BigDecimal payableAtDue,
                            LocalDate lastPaymentDate, List<Payment> payments, boolean showSchedule,
                            List<Period> schedule) {
    }

    public record Payment(LocalDate date, BigDecimal principal, BigDecimal interest, BigDecimal total,
                          BigDecimal outstandingAfter, boolean writeOff, boolean finalPayment) {
    }

    public record Period(int period, LocalDate from, LocalDate to, BigDecimal openingPrincipal, BigDecimal paid,
                         BigDecimal interest, BigDecimal cumulative, String status) {
    }

    private final ClaimShareRepository shares;
    private final ClaimRepository claims;
    private final TenantRepository tenants;
    private final ClaimService claimService;
    private final ActivityService activity;
    private final SecureRandom random = new SecureRandom();

    public ClaimShareService(ClaimShareRepository shares, ClaimRepository claims, TenantRepository tenants,
                             ClaimService claimService, ActivityService activity) {
        this.shares = shares;
        this.claims = claims;
        this.tenants = tenants;
        this.claimService = claimService;
        this.activity = activity;
    }

    public List<ShareView> list(Long claimId) {
        claim(claimId);
        return shares.findByClaimId(claimId).stream()
                .sorted(Comparator.comparing(ClaimShare::getCreatedAt).reversed())
                .map(ClaimShareService::view)
                .toList();
    }

    @Transactional
    public CreatedShare create(Long claimId, ShareRequest r) {
        Claim c = claim(claimId);
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        LocalDateTime now = LocalDateTime.now();
        ClaimShare s = new ClaimShare();
        s.setTenantId(c.getTenantId());
        s.setClaimId(c.getId());
        s.setTokenHash(AccessLinkService.hash(token));
        s.setSharedWith(blank(r.sharedWith()));
        s.setShowSchedule(r.showSchedule());
        s.setMessage(blank(r.message()));
        s.setCreatedByName(UserContext.get().fullName());
        s.setCreatedAt(now);
        s.setExpiresAt(now.plusHours(r.hours()));
        s.setViews(0);
        s = shares.save(s);
        activity.record("ADDED", "Money owed", "Shared the statement of " + c.getNarration()
                + (s.getSharedWith() != null ? " with " + s.getSharedWith() : "") + " · " + days(r.hours()));
        return new CreatedShare(view(s), token);
    }

    @Transactional
    public ShareView revoke(Long claimId, Long shareId) {
        Claim c = claim(claimId);
        ClaimShare s = shares.findByIdAndTenantId(shareId, c.getTenantId())
                .filter(x -> x.getClaimId().equals(claimId))
                .orElseThrow(() -> new NotFoundException("Statement link", shareId));
        if (s.getRevokedAt() == null) {
            s.setRevokedAt(LocalDateTime.now());
            s = shares.save(s);
            activity.record("REVOKED", "Money owed", "Stopped the statement link of " + c.getNarration()
                    + (s.getSharedWith() != null ? " for " + s.getSharedWith() : ""));
        }
        return view(s);
    }

    /** Someone opened a statement link: the statement as of now (counts the view). No sign-in. */
    @Transactional
    public Statement open(String token) {
        ClaimShare s = active(token);
        Tenant tenant = tenants.findById(s.getTenantId()).filter(t -> Boolean.TRUE.equals(t.getActive()))
                .orElseThrow(() -> new BusinessException("This statement is no longer shared"));
        s.setViews((s.getViews() == null ? 0 : s.getViews()) + 1);
        s.setLastViewedAt(LocalDateTime.now());
        shares.save(s);
        CurrentUser previous = UserContext.current().orElse(null);
        UserContext.set(new CurrentUser(null, "statement", "Statement link", UserRole.VIEWER, tenant.getId(), tenant.getCode(),
                tenant.getName(), tenant.getCurrency(), Feature.all(), false));
        try {
            return statement(claimService.get(s.getClaimId()), s, tenant);
        } finally {
            if (previous != null) {
                UserContext.set(previous);
            } else {
                UserContext.clear();
            }
        }
    }

    private static Statement statement(ClaimView c, ClaimShare s, Tenant t) {
        boolean owedByViewer = !c.kind().isPayable();
        List<Payment> payments = c.repayments().stream()
                .map((RepaymentView r) -> new Payment(r.paidDate(), r.principal(), r.interest(), r.total(), r.outstandingAfter(),
                        r.writeOff(), r.finalPayment()))
                .toList();
        boolean rate = c.interestRate() != null && c.interestRate().signum() > 0;
        boolean compound = "COMPOUND".equals(c.interestType().name());
        List<Period> schedule = !Boolean.TRUE.equals(s.getShowSchedule()) || !rate ? List.of() : c.schedule().stream()
                .map((InterestPeriod p) -> new Period(p.period(), p.from(), p.to(), p.openingPrincipal(),
                        p.principalRepaid().add(p.interestPaid()), compound ? p.compoundInterest() : p.simpleInterest(),
                        compound ? p.cumulativeCompound() : p.cumulativeSimple(), p.status()))
                .toList();
        return new Statement(c.kind().name(), c.kindLabel(), owedByViewer, c.party(), s.getSharedWith(), s.getCreatedByName(),
                t.getName(), t.getCurrency(), c.narration(), s.getMessage(), LocalDate.now(), s.getExpiresAt(),
                c.amount(), c.startDate(), c.dueDate(), c.overdue(), c.daysToDue(), c.status().name(), c.statusLabel(),
                c.daysOutstanding(), c.repaid(), c.writtenOff(), c.outstanding(), c.repaidPercent(),
                rate ? c.interestRate() : null, rate ? c.interestTypeLabel() : null,
                rate ? c.interestCollection().name() : null, rate ? c.interestCollectionLabel() : null, rate ? c.dayCount() : null,
                c.accruedInterest(), c.interestReceived(), c.interestDue(), c.interestDueNow(), c.nextInterestDate(),
                c.nextInterestAmount(), c.monthlyInterest(), c.settlementAmount(), c.payableAtDue(), c.lastPaymentDate(),
                payments, !schedule.isEmpty(), schedule);
    }

    private ClaimShare active(String token) {
        ClaimShare s = token == null || token.isBlank() ? null : shares.findByTokenHash(AccessLinkService.hash(token.trim())).orElse(null);
        if (s == null) {
            throw new BusinessException("This link is not valid");
        }
        if (s.getRevokedAt() != null) {
            throw new BusinessException("This statement link was switched off");
        }
        if (!s.getExpiresAt().isAfter(LocalDateTime.now())) {
            throw new BusinessException("This statement link has expired. Ask for a new one.");
        }
        return s;
    }

    private Claim claim(Long id) {
        return claims.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("Lent / borrowed item", id));
    }

    private static ShareView view(ClaimShare s) {
        LocalDateTime now = LocalDateTime.now();
        String status = s.getRevokedAt() != null ? "REVOKED" : s.getExpiresAt().isAfter(now) ? "ACTIVE" : "EXPIRED";
        return new ShareView(s.getId(), s.getClaimId(), s.getSharedWith(), Boolean.TRUE.equals(s.getShowSchedule()), s.getMessage(),
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
