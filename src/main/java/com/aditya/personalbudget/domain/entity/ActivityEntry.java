package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * One line of the activity log: who changed what, when and from where (full site, mobile version or an access link).
 * Written after every successful change and on sign-in; never edited. Table file: {@code data/activity_log.tbl}
 */
@Entity
@Table(name = "activity_log")
@Getter
@Setter
@NoArgsConstructor
public class ActivityEntry implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Column(nullable = false)
    private LocalDateTime at;

    /** The signed-in user (for an access link: the admin who made it). */
    private Long userId;

    /** Who, as shown: the user's name, or "Ravi (driver) · link". */
    @Column(nullable = false, length = 100)
    private String actor;

    /** WEB, MOBILE or LINK. */
    @Column(nullable = false, length = 10)
    private String via;

    private Long linkId;

    /** ADDED, CHANGED, DELETED, POSTED, REVERSED, APPROVED, REJECTED, SUBMITTED, SIGNED_IN, OPENED_LINK, REVOKED ... */
    @Column(nullable = false, length = 20)
    private String action;

    /** Expenses, Chits, Accounts, Budgets, Journal, Money owed, Users, Access links ... */
    @Column(nullable = false, length = 30)
    private String area;

    /** What changed, in words: "Paid installment 7 · Shriram Gold 5L · ₹22,500". */
    @Column(nullable = false, length = 300)
    private String summary;

    @Column(length = 8)
    private String method;

    @Column(length = 200)
    private String path;
}
