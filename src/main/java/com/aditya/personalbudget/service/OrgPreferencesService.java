package com.aditya.personalbudget.service;

import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.AccountType;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.MobilePolicy;
import com.aditya.personalbudget.security.UserContext;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Two choices an admin makes for the organization:
 * <ul>
 *   <li><b>The benchmark rate</b>: what money paid for someone or lent without interest could have earned in the bank.
 *       Set by hand, or (when empty) the best yearly rate among the active bank accounts, fixed and recurring
 *       deposits. Each such item then shows, greyed out, the interest it cost.</li>
 *   <li><b>The mobile app by role</b> (see {@link MobilePolicy}): balances shown, hidden until tapped or never
 *       shown; the sections the role may use; whether it may record on the phone.</li>
 * </ul>
 */
@Service
public class OrgPreferencesService {

    private static final Set<AccountType> DEPOSITS = EnumSet.of(AccountType.BANK, AccountType.FIXED_DEPOSIT, AccountType.RECURRING_DEPOSIT);

    /** An account whose rate can be the benchmark. */
    public record Candidate(Long accountId, String name, String type, BigDecimal rate) {
    }

    /**
     * rate: the one used (null: none, nothing is shown); basis: where it comes from; configuredRate: the one set by
     * hand (null: the best bank rate is used).
     */
    public record Benchmark(BigDecimal rate, String basis, BigDecimal configuredRate, List<Candidate> candidates) {
    }

    public record BenchmarkRequest(@PositiveOrZero @DecimalMax("30") BigDecimal rate) {
    }

    public record RoleRule(UserRole role, String roleLabel, String mask, List<String> features, boolean record) {
    }

    public record FeatureOption(String name, String label) {
    }

    public record MobilePolicyView(List<RoleRule> roles, List<FeatureOption> mobileFeatures) {
    }

    public record MobilePolicyRequest(List<RoleRule> roles) {
    }

    private final OrganizationRepository organizations;
    private final AccountRepository accounts;
    private final ActivityService activity;

    public OrgPreferencesService(OrganizationRepository organizations, AccountRepository accounts, ActivityService activity) {
        this.organizations = organizations;
        this.accounts = accounts;
        this.activity = activity;
    }

    // ================================================================== the benchmark rate

    public Benchmark benchmark() {
        Long tenantId = UserContext.tenantId();
        return benchmark(organizations.findById(tenantId).orElse(null), accounts.findByTenantId(tenantId));
    }

    /** The benchmark for an organization with these accounts (no reads: for a list of items at once). */
    public static Benchmark benchmark(Organization org, Collection<Account> all) {
        List<Candidate> candidates = all.stream()
                .filter(a -> DEPOSITS.contains(a.getAccountType()) && !Boolean.FALSE.equals(a.getActive())
                        && a.getInterestRate() != null && a.getInterestRate().signum() > 0)
                .sorted(Comparator.comparing(Account::getInterestRate).reversed().thenComparing(Account::getName))
                .map(a -> new Candidate(a.getId(), a.getName(), a.getAccountType().getLabel(), a.getInterestRate()))
                .toList();
        BigDecimal configured = org == null ? null : org.getBenchmarkRate();
        if (configured != null) {
            return new Benchmark(configured, "set in Settings", configured, candidates);
        }
        if (candidates.isEmpty()) {
            return new Benchmark(null, "no bank account or deposit has an interest rate", null, candidates);
        }
        Candidate best = candidates.getFirst();
        return new Benchmark(best.rate(), "best bank rate · " + best.name(), null, candidates);
    }

    @Transactional
    public Benchmark saveBenchmark(BenchmarkRequest r) {
        Organization org = organizations.findById(UserContext.tenantId()).orElseThrow();
        org.setBenchmarkRate(r.rate() == null ? null : r.rate().setScale(2, java.math.RoundingMode.HALF_UP));
        organizations.save(org);
        activity.record("CHANGED", "Settings", r.rate() == null ? "Interest benchmark: the best bank rate"
                : "Interest benchmark set to " + org.getBenchmarkRate().stripTrailingZeros().toPlainString() + "% a year");
        return benchmark();
    }

    // ================================================================== the mobile app by role

    public MobilePolicyView mobilePolicy() {
        Organization org = organizations.findById(UserContext.tenantId()).orElse(null);
        Map<UserRole, MobilePolicy.Rule> rules = MobilePolicy.rules(org);
        return new MobilePolicyView(
                rules.entrySet().stream().filter(e -> e.getKey() != UserRole.SUPER_ADMIN)
                        .map(e -> new RoleRule(e.getKey(), e.getKey().getLabel(), e.getValue().mask(),
                                e.getValue().features().stream().sorted().map(Enum::name).toList(), e.getValue().record()))
                        .toList(),
                Feature.allMobile().stream().sorted().map(f -> new FeatureOption(f.name(), f.getLabel())).toList());
    }

    @Transactional
    public MobilePolicyView saveMobilePolicy(MobilePolicyRequest r) {
        Organization org = organizations.findById(UserContext.tenantId()).orElseThrow();
        Map<UserRole, MobilePolicy.Rule> rules = new EnumMap<>(MobilePolicy.rules(org));
        for (RoleRule rr : r.roles() == null ? List.<RoleRule>of() : r.roles()) {
            if (rr.role() == null || rr.role() == UserRole.SUPER_ADMIN) continue;
            String mask = Set.of(MobilePolicy.NONE, MobilePolicy.TAP, MobilePolicy.ALWAYS).contains(rr.mask()) ? rr.mask() : MobilePolicy.NONE;
            Set<Feature> features = EnumSet.noneOf(Feature.class);
            features.addAll(Feature.parse(rr.features() == null ? "-" : String.join(",", rr.features()) + ",", Feature.allMobile()));
            features.retainAll(Feature.allMobile());
            rules.put(rr.role(), new MobilePolicy.Rule(mask, features, rr.record()));
        }
        org.setMobilePolicy(MobilePolicy.format(rules));
        organizations.save(org);
        activity.record("CHANGED", "Settings", "Mobile app by role: " + rules.entrySet().stream().filter(e -> e.getKey() != UserRole.SUPER_ADMIN)
                .map(e -> e.getKey().getLabel() + " " + switch (e.getValue().mask()) {
                    case MobilePolicy.TAP -> "balances hidden until tapped";
                    case MobilePolicy.ALWAYS -> "balances never shown";
                    default -> "balances shown";
                } + (e.getValue().record() ? "" : ", view only")).reduce((a, b) -> a + "; " + b).orElse(""));
        return mobilePolicy();
    }
}
