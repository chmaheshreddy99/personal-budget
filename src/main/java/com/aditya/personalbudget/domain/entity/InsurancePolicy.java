package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * What an insurance document (medical, vehicle, life) needs beyond its scans: the premium and when it is next due,
 * everything needed to pay it, and how to be reminded. One per document. The insurer is the document's issuer, the
 * policy number its number, the end of cover (or the maturity of a life policy) its valid-until date.
 * Table file: {@code data/insurance_policies.tbl}
 */
@Entity
@Table(name = "insurance_policies")
@Getter
@Setter
@NoArgsConstructor
public class InsurancePolicy implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @References(PersonalDocument.class)
    @Column(nullable = false, unique = true)
    private Long documentId;

    // ---- the cover

    @Column(length = 100)
    private String planName;

    /** Who is covered: the members of a medical policy, the life assured. */
    @Column(length = 200)
    private String insuredPersons;

    @Column(length = 100)
    private String nominee;

    /** A vehicle policy: the registration number. */
    @Column(length = 30)
    private String vehicleNumber;

    /** The sum insured, the sum assured or the vehicle's declared value. */
    @Column(precision = 15, scale = 2)
    private BigDecimal sumInsured;

    // ---- the premium

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal premium;

    /** MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY or SINGLE (paid once). */
    @Column(nullable = false, length = 12)
    private String frequency;

    /** Null when nothing more is to be paid. */
    private LocalDate nextDueDate;

    /** The last premium of a policy that stops asking for them before it ends. */
    private LocalDate lastPremiumDate;

    private Integer graceDays;

    // ---- how it is paid

    /** ONLINE, UPI, AUTO_DEBIT, NET_BANKING, AGENT, CHEQUE or CASH. */
    @Column(length = 12)
    private String paymentMode;

    /** The account usually paid from (no reference: it is only a suggestion, and the account can go). */
    private Long payAccountId;

    /** The expense category it is booked in. */
    private Long categoryId;

    @Column(length = 100)
    private String payeeName;

    @Column(length = 300)
    private String paymentUrl;

    @Column(length = 100)
    private String upiId;

    /** What the payer asks for: a customer ID, a biller ID. */
    @Column(length = 100)
    private String paymentReference;

    @Column(length = 100)
    private String agentName;

    @Column(length = 30)
    private String agentPhone;

    @Column(length = 40)
    private String supportPhone;

    @Column(length = 255)
    private String paymentNotes;

    // ---- reminders

    private Boolean emailReminders;

    /** Days before the due date to remind, largest first: "30,15,7,3,1". */
    @Column(length = 40)
    private String reminderDays;

    /** Who gets them; blank: the addresses of Settings › Alerts, else whoever enrolled the policy. */
    @Column(length = 300)
    private String emailTo;

    /** The due date the last reminder was for, and how far ahead it went (see InsuranceService). */
    private LocalDate lastReminderDue;

    private Integer lastReminderStage;

    private LocalDateTime lastReminderAt;

    @Column(length = 255)
    private String lastReminderResult;

    @Version
    private Long version;
}
