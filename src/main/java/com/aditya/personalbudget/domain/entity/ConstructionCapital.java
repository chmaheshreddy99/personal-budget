package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.Positive;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A partner's money put into the project or taken out, or their share of the profit when it closes.
 * Table file: {@code data/construction_capital.tbl}
 */
@Entity
@Table(name = "construction_capital")
@Getter
@Setter
@NoArgsConstructor
public class ConstructionCapital implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** The project it belongs to. */
    @References(ConstructionProject.class)
    @Column(nullable = false)
    private Long projectId;

    @References(ConstructionPartner.class)
    @Column(nullable = false)
    private Long partnerId;

    /** INVEST, WITHDRAW or PROFIT. */
    @Column(nullable = false, length = 10)
    private String kind;

    @Positive
    @Column(nullable = false)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate movedOn;

    /** The project's account the money came into (or went out of). */
    @References(Account.class)
    private Long accountId;

    /** My own money: the personal account it came from (or went to). */
    @References(Account.class)
    private Long fromAccountId;

    @Column(length = 200)
    private String note;

    @References(JournalEntry.class)
    private Long journalEntryId;

    @Column(length = 50)
    private String createdBy;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
