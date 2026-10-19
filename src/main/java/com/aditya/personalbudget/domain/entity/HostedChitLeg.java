package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

/**
 * One account's part of a hosted chit payout or transfer: a payout to the winner can be paid from several bank
 * accounts (each with its own UTR), and a transfer can gather money from several accounts. Exactly one of
 * {@code monthId} (payout) and {@code transferId} is set. Table file: {@code data/hosted_chit_legs.tbl}
 */
@Entity
@Table(name = "hosted_chit_legs")
@Getter
@Setter
@NoArgsConstructor
public class HostedChitLeg implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(HostedChit.class)
    private Long chitId;

    /** The payout this is part of. */
    @References(HostedChitMonth.class)
    private Long monthId;

    /** The transfer this is part of. */
    @References(HostedChitTransfer.class)
    private Long transferId;

    /** Paid from (or, for a transfer, taken from) this account. */
    @References(Account.class)
    @Column(nullable = false)
    private Long accountId;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    /** Cash, UPI or Bank. */
    @Column(length = 10)
    private String mode;

    /** UPI reference, cheque or bank transfer number of this part. */
    @Column(length = 60)
    private String reference;

    /** The members' payments this part carries (comma separated ids): where they came in, and on to the payout. */
    @Column(length = 1000)
    private String paymentIds;

    /** The narrative: whose payments these are, their receipts and references. */
    @Column(length = 2000)
    private String note;

    /** Order within the payout or transfer. */
    @Positive
    @Column(nullable = false)
    private Integer position;

    @Version
    private Long version;
}
