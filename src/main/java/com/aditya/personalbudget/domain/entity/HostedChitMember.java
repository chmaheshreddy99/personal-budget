package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A member of a {@link HostedChit}. Which month they won is kept on {@link HostedChitMonth#getWinnerMemberId()}.
 * Table file: {@code data/hosted_chit_members.tbl}
 */
@Entity
@Table(name = "hosted_chit_members", uniqueConstraints = @UniqueConstraint(columnNames = {"chitId", "slot"}))
@Getter
@Setter
@NoArgsConstructor
public class HostedChitMember implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(HostedChit.class)
    @Column(nullable = false)
    private Long chitId;

    /** Position in the member list (1..n). */
    @Positive
    @Column(nullable = false)
    private Integer slot;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 20)
    private String phone;

    /** For e-mailed reminders and receipts. */
    @Column(length = 120)
    private String email;

    /** The member's own UPI ID: fellow members pay them on it in the month they win. */
    @Column(length = 60)
    private String upiId;

    /** A fellow member (a month's winner, not yet paid out) this member pays directly; cleared when that month is paid out. */
    private Long payToMemberId;

    /** The organiser's account this member pays into (instead of the chit's): its UPI ID or bank details are on their link. */
    @References(Account.class)
    private Long payToAccountId;

    /** Where the member takes the payout: bank, account number and IFSC, or a UPI ID. */
    @Column(length = 120)
    private String payoutAccount;

    @Version
    private Long version;
}
