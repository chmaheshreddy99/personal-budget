package com.aditya.personalbudget.service;

import com.aditya.personalbudget.config.BudgetProperties;
import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.domain.entity.Organization;
import com.aditya.personalbudget.domain.type.Feature;
import com.aditya.personalbudget.domain.type.UserRole;
import com.aditya.personalbudget.dto.UserDtos.TenantRequest;
import com.aditya.personalbudget.dto.UserDtos.TenantView;
import com.aditya.personalbudget.dto.UserDtos.UserRequest;
import com.aditya.personalbudget.dto.UserDtos.UserView;
import com.aditya.personalbudget.exception.BusinessException;
import com.aditya.personalbudget.exception.NotFoundException;
import com.aditya.personalbudget.repository.AccountRepository;
import com.aditya.personalbudget.repository.AppUserRepository;
import com.aditya.personalbudget.repository.OrganizationRepository;
import com.aditya.personalbudget.security.CurrentUser;
import com.aditya.personalbudget.security.FeaturePolicy;
import com.aditya.personalbudget.security.ApprovalPolicy;
import com.aditya.personalbudget.security.SessionRegistry;
import com.aditya.personalbudget.security.UserContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;

/**
 * User administration inside a tenant, and tenant administration for the platform owner.
 */
@Service
public class UserService {

    private final AppUserRepository users;
    private final OrganizationRepository tenants;
    private final AccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    private final SessionRegistry sessions;
    private final TenantProvisioningService provisioning;
    private final UserRole defaultRole;
    private final ApprovalPolicy approvals;

    public UserService(AppUserRepository users, OrganizationRepository tenants, AccountRepository accounts,
                       PasswordEncoder passwordEncoder, SessionRegistry sessions,
                       TenantProvisioningService provisioning, BudgetProperties properties, ApprovalPolicy approvals) {
        this.approvals = approvals;
        this.users = users;
        this.tenants = tenants;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.sessions = sessions;
        this.provisioning = provisioning;
        this.defaultRole = properties.security().defaultUserRole();
    }

    // ================================================================== users of the current tenant

    public List<UserView> list() {
        return users.findByTenantId(UserContext.tenantId()).stream()
                .sorted(Comparator.comparing(AppUser::getUsername))
                .map(this::toView)
                .toList();
    }

    @Transactional
    public UserView create(UserRequest request) {
        if (request.password() == null || request.password().isBlank()) {
            throw new BusinessException("Password is required for a new user");
        }
        AppUser user = new AppUser();
        user.setTenantId(UserContext.tenantId());
        user.setCreatedAt(LocalDateTime.now());
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setMustChangePassword(true);   // a password given by the admin: the user picks their own at the first sign-in
        apply(user, request);
        return toView(users.save(user));
    }

    @Transactional
    public UserView update(Long id, UserRequest request) {
        AppUser user = require(id);
        UserRole oldRole = user.getRole();
        apply(user, request);
        if (request.password() != null && !request.password().isBlank()) {
            user.setPasswordHash(passwordEncoder.encode(request.password()));
            // reset by an admin: the user sets their own at the next sign-in (not when admins change their own)
            user.setMustChangePassword(!user.getId().equals(UserContext.get().userId()));
        }
        CurrentUser me = UserContext.get();
        if (user.getId().equals(me.userId()) && (!user.getActive() || user.getRole() != oldRole)) {
            throw new BusinessException("You cannot deactivate yourself or change your own role");
        }
        if (user.getId().equals(me.userId()) && (user.getFeatures() != null || Boolean.FALSE.equals(user.getMobileAccess()))) {
            throw new BusinessException("You cannot limit your own access; another admin can");
        }
        user = users.save(user);
        if (!user.getActive() || user.getRole() != oldRole) {
            sessions.closeAllFor(user.getId());
        }
        return toView(user);
    }

    /** Who needs approval: this user always (REQUIRED), never (EXEMPT) or as the household says (TENANT). */
    @Transactional
    public UserView setApproval(Long id, String approval) {
        AppUser user = require(id);
        user.setApproval(approvalOf(approval == null ? "TENANT" : approval));
        return toView(users.save(user));
    }

    private static Boolean approvalOf(String approval) {
        return switch (approval.trim().toUpperCase(java.util.Locale.ROOT)) {
            case "REQUIRED" -> Boolean.TRUE;
            case "EXEMPT" -> Boolean.FALSE;
            case "TENANT", "" -> null;
            default -> throw new BusinessException("Approval is TENANT, REQUIRED or EXEMPT");
        };
    }

    @Transactional
    public void delete(Long id) {
        AppUser user = require(id);
        if (user.getId().equals(UserContext.get().userId())) {
            throw new BusinessException("You cannot delete yourself");
        }
        sessions.closeAllFor(user.getId());
        users.delete(user);
    }

    private void apply(AppUser user, UserRequest r) {
        UserRole role = r.role() != null ? r.role() : (user.getRole() != null ? user.getRole() : defaultRole);
        if (role == UserRole.SUPER_ADMIN && UserContext.get().role() != UserRole.SUPER_ADMIN) {
            throw new BusinessException("Only a super admin can grant the Super Admin role");
        }
        user.setUsername(r.username().trim());
        user.setFullName(r.fullName().trim());
        user.setEmail(r.email());
        user.setRole(role);
        user.setActive(r.active() == null || r.active());
        if (r.features() != null && r.features().isEmpty()) {
            throw new BusinessException("Share at least one section with the user");
        }
        // every section the organization has is stored as "everything", so sections it gets later come along
        java.util.Set<Feature> available = FeaturePolicy.ofTenant(tenants.findById(UserContext.tenantId()).orElse(null));
        user.setFeatures(r.features() == null || r.features().containsAll(available) ? null : Feature.format(r.features(), Feature.all()));
        user.setMobileAccess(r.mobileAccess() == null || r.mobileAccess() ? null : Boolean.FALSE);
        user.setMobileFeatures(Feature.format(r.mobileFeatures(), Feature.allMobile()));
        if (r.approval() != null) {
            user.setApproval(approvalOf(r.approval()));
        }
    }

    private AppUser require(Long id) {
        return users.findByIdAndTenantId(id, UserContext.tenantId())
                .orElseThrow(() -> new NotFoundException("User", id));
    }

    private UserView toView(AppUser u) {
        Organization tenant = tenants.findById(u.getTenantId()).orElse(null);
        return new UserView(u.getId(), u.getUsername(), u.getFullName(), u.getEmail(), u.getRole(),
                u.getRole().getLabel(), Boolean.TRUE.equals(u.getActive()), u.getCreatedAt(), u.getLastLoginAt(),
                FeaturePolicy.granted(u, tenant, false), u.getFeatures() != null, !Boolean.FALSE.equals(u.getMobileAccess()),
                Feature.parse(u.getMobileFeatures(), Feature.allMobile()),
                ApprovalPolicy.userSetting(u), tenant != null && approvals.forUser(u, tenant));
    }

    // ================================================================== tenants (platform owner)

    public List<TenantView> tenants() {
        return tenants.findAll().stream()
                .sorted(Comparator.comparing(Organization::getCode))
                .map(t -> new TenantView(t.getId(), t.getCode(), t.getName(), t.getCurrency(),
                        Boolean.TRUE.equals(t.getActive()), t.getCreatedAt(),
                        users.findByTenantId(t.getId()).size(), accounts.findByTenantId(t.getId()).size(),
                        FeaturePolicy.ofTenant(t), t.getFeatures() != null))
                .toList();
    }

    @Transactional
    public void createTenant(TenantRequest request) {
        if (request.adminUsername() == null || request.adminPassword() == null) {
            throw new BusinessException("Admin username and password are required for a new organization");
        }
        AppUser admin = provisioning.provision(new TenantProvisioningService.NewTenant(request.code(), request.name(),
                request.currency(), request.adminUsername(),
                request.adminFullName() != null ? request.adminFullName() : request.adminUsername(),
                null, request.adminPassword(), UserRole.ADMIN));
        Organization tenant = tenants.findById(admin.getTenantId()).orElseThrow();
        tenant.setFeatures(tenantFeatures(request.features()));
        tenants.save(tenant);
    }

    @Transactional
    public void updateTenant(Long id, TenantRequest request) {
        Organization tenant = tenants.findById(id).orElseThrow(() -> new NotFoundException("Organization", id));
        if (tenant.getId().equals(UserContext.tenantId()) && Boolean.FALSE.equals(request.active())) {
            throw new BusinessException("You cannot deactivate your own organization");
        }
        tenant.setName(request.name());
        if (request.currency() != null) {
            tenant.setCurrency(request.currency());
        }
        tenant.setActive(request.active() == null || request.active());
        if (request.features() != null) {
            tenant.setFeatures(tenantFeatures(request.features()));
        }
        tenants.save(tenant);
    }

    /** The sections the signed-in user's organization has. */
    public java.util.Set<Feature> organizationSections() {
        return FeaturePolicy.ofTenant(tenants.findById(UserContext.tenantId()).orElse(null));
    }

    /** The organization's sections as stored: null when it has every section. At least one is needed. */
    private static String tenantFeatures(java.util.Set<Feature> features) {
        if (features != null && features.isEmpty()) {
            throw new BusinessException("Give the organization at least one section");
        }
        return Feature.format(features, Feature.all());
    }
}
