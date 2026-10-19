package com.aditya.personalbudget.repository;

import com.aditya.personalbudget.domain.entity.UserSession;
import com.aditya.personalbudget.storage.TsvDataStore;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public class UserSessionRepository extends TenantScopedRepository<UserSession> {

    public UserSessionRepository(TsvDataStore store) {
        super(store, UserSession.class);
    }

    public Optional<UserSession> findByTokenHash(String tokenHash) {
        return findFirstWhere(s -> s.getTokenHash().equals(tokenHash));
    }

    public List<UserSession> findByUserId(Long userId) {
        return findWhere(s -> s.getUserId().equals(userId));
    }

    public List<UserSession> findByLinkId(Long linkId) {
        return findWhere(s -> linkId.equals(s.getLinkId()));
    }

    public List<UserSession> findExpired(LocalDateTime now) {
        return findWhere(s -> s.getExpiresAt().isBefore(now));
    }
}
