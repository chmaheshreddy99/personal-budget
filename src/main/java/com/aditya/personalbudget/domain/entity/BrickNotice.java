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
 * A notification in Brick Management: a new order, a request waiting for approval and its answer, a delivery the
 * customer signed, a payment they reported. Shown live to the users it is for, and kept for the bell.
 * Table file: {@code data/brick_notices.tbl}
 */
@Entity
@Table(name = "brick_notices")
@Getter
@Setter
@NoArgsConstructor
public class BrickNotice implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    /** ORDER, APPROVAL, DECISION, SIGNED, PAID */
    private String kind;

    @Column(length = 200)
    private String title;

    @Column(length = 500)
    private String body;

    /** Where it opens: a hash route to the exact item ("bricks/sales/12"). */
    @Column(length = 200)
    private String link;

    /** Who it is for: ALL (anyone in Brick Management who sees sales), APPROVE (the checkers) or U:<userId>. */
    private String audience;

    /** Who did it (not told about their own doing); empty for the customer. */
    private Long actorId;
    private String actor;

    private LocalDateTime createdAt;

    /** What the notice is about, for its alert (a new order: its number, customer, bricks, address, day needed), as JSON. */
    @Column(length = 2000)
    private String data;
}
