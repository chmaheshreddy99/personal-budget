package com.aditya.personalbudget.service;

import com.aditya.personalbudget.repository.CategoryRepository;
import com.aditya.personalbudget.domain.entity.Category;
import com.aditya.personalbudget.domain.entity.Account;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Tenant;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.TenantRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Creates a ready-to-use tenant: the tenant row, its first (admin) user, the default chart of accounts and the
 * default expense and income categories.
 */
@Service
public class TenantProvisioningService {

    public record NewTenant(String code, String name, String currency, String adminUsername, String adminFullName,
                            String adminEmail, String adminPassword, UserRole adminRole) {
    }

    private final TenantRepository tenants;
    private final AppUserRepository users;
    private final AccountRepository accounts;
    private final CategoryRepository categories;
    private final PasswordEncoder passwordEncoder;

    public TenantProvisioningService(TenantRepository tenants, AppUserRepository users, AccountRepository accounts,
                                     CategoryRepository categories, PasswordEncoder passwordEncoder) {
        this.tenants = tenants;
        this.users = users;
        this.accounts = accounts;
        this.categories = categories;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AppUser provision(NewTenant request) {
        if (tenants.findByCode(request.code()).isPresent()) {
            throw new BusinessException("Tenant code '" + request.code() + "' is already taken");
        }
        if (users.findByUsername(request.adminUsername()).isPresent()) {
            throw new BusinessException("Username '" + request.adminUsername() + "' is already taken");
        }
        Tenant tenant = new Tenant();
        tenant.setCode(request.code().toLowerCase());
        tenant.setName(request.name());
        tenant.setCurrency(request.currency() == null || request.currency().isBlank() ? "INR" : request.currency());
        tenant.setActive(true);
        tenant.setCreatedAt(LocalDateTime.now());
        tenant = tenants.save(tenant);

        AppUser admin = new AppUser();
        admin.setTenantId(tenant.getId());
        admin.setUsername(request.adminUsername());
        admin.setFullName(request.adminFullName());
        admin.setEmail(request.adminEmail());
        admin.setPasswordHash(passwordEncoder.encode(request.adminPassword()));
        admin.setRole(request.adminRole());
        admin.setActive(true);
        admin.setCreatedAt(LocalDateTime.now());
        admin = users.save(admin);

        seedChartOfAccounts(tenant.getId());
        return admin;
    }

    private void seedChartOfAccounts(Long tenantId) {
        LocalDateTime now = LocalDateTime.now();
        List<Account> rows = DefaultChartOfAccounts.ACCOUNTS.stream().map(t -> {
            Account a = new Account();
            a.setTenantId(tenantId);
            a.setCode(t.code());
            a.setName(t.name());
            a.setAccountType(t.type());
            a.setAccountClass(t.type().getAccountClass());
            a.setDescription(t.description());
            a.setSystemAccount(t.system());
            a.setActive(true);
            a.setCreatedAt(now);
            return a;
        }).toList();
        accounts.saveAll(rows);
        seedCategories(tenantId, false);
    }

    /**
     * Adds the default categories the tenant does not have yet (matched by name or system key);
     * {@code systemOnly} limits that to the ones the application posts to by itself.
     */
    public void seedCategories(Long tenantId, boolean systemOnly) {
        LocalDateTime now = LocalDateTime.now();
        List<Category> existing = categories.findByTenantId(tenantId);
        List<Category> rows = DefaultChartOfAccounts.CATEGORIES.stream()
                .filter(t -> !systemOnly || t.systemKey() != null)
                .filter(t -> existing.stream().noneMatch(c -> c.getKind() == t.kind()
                        && (c.getName().equalsIgnoreCase(t.name())
                        || (t.systemKey() != null && t.systemKey().equals(c.getSystemKey())))))
                .map(t -> {
                    Category c = new Category();
                    c.setTenantId(tenantId);
                    c.setKind(t.kind());
                    c.setCode(t.code());
                    c.setName(t.name());
                    c.setDescription(t.description());
                    c.setSystemKey(t.systemKey());
                    c.setActive(true);
                    c.setCreatedAt(now);
                    return c;
                }).toList();
        categories.saveAll(rows);
    }
}
