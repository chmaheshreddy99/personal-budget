package com.aditya.personalbudget.security;

import com.aditya.personalbudget.domain.entity.AppUser;
import com.aditya.personalbudget.exception.ForbiddenException;
import com.aditya.personalbudget.repository.AppUserRepository;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Optional;
import java.util.Set;

/**
 * The signed-in user's role in Brick Management and what it lets them do. Without a signed-in user (the customer's
 * link, a system job) nothing is held back: those calls are checked by what they are.
 */
@Component
public class BrickAccess {

    private final AppUserRepository users;

    public BrickAccess(AppUserRepository users) {
        this.users = users;
    }

    /** The role of the current user, or null when nobody is signed in (the customer's link, a system job). */
    public BrickRole current() {
        return UserContext.current().filter(u -> u.userId() != null).map(u -> roleOf(u.userId(), u.role())).orElse(null);
    }

    public BrickRole roleOf(Long userId, com.aditya.personalbudget.domain.type.UserRole appRole) {
        Optional<AppUser> user = userId == null ? Optional.empty() : users.findById(userId);
        BrickRole kept = user.map(AppUser::getBrickRole).map(BrickRole::parse).orElse(null);
        return kept != null ? kept : BrickRole.defaultFor(appRole);
    }

    public BrickRole roleOf(AppUser u) {
        BrickRole kept = BrickRole.parse(u.getBrickRole());
        return kept != null ? kept : BrickRole.defaultFor(u.getRole());
    }

    /** The staff role chosen for this user (limits them to Brick Management in the whole application), or null. */
    public BrickRole staffRole(CurrentUser u) {
        if (u == null || u.userId() == null) return null;
        return users.findById(u.userId()).map(x -> BrickRole.staffOf(x.getBrickRole())).orElse(null);
    }

    /**
     * What staff may call besides Brick Management's own API (each call of which their role is checked for): signing in
     * and out, their own profile and password, the live updates, the options every screen needs, and evidence attached to
     * what they record. Everything else (accounts, balances, the journal, reports, the footer figures …) is refused.
     */
    public static boolean staffMay(String uri) {
        String p = uri.startsWith("/api/") ? uri.substring(4) : uri;
        return p.startsWith("/bricks/") || p.startsWith("/auth/") || p.startsWith("/meta/") || p.equals("/events") || p.startsWith("/attachments")
                || p.equals("/approvals/open");
    }

    /** May the current user do this? (Nobody signed in: yes.) */
    public boolean allows(BrickPermission p) {
        BrickRole r = current();
        return r == null || r.allows(p);
    }

    public Set<BrickPermission> permissions() {
        BrickRole r = current();
        return r == null ? java.util.EnumSet.allOf(BrickPermission.class) : r.getPermissions();
    }

    /** Refuses unless the current user's role holds one of these. */
    public void require(BrickPermission... any) {
        BrickRole r = current();
        if (r == null || Arrays.stream(any).anyMatch(r::allows)) return;
        throw new ForbiddenException("Your role in Brick Management (" + r.getLabel() + ") does not allow this: "
                + any[0].getDescription().substring(0, 1).toLowerCase() + any[0].getDescription().substring(1));
    }
}
