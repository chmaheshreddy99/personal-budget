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
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A team or a person who works for the brick business (production team, driver, loading team, supervisor,
 * accountant ...) and how they are paid: by what they make or move (PIECE), a weekly wage or a monthly salary.
 * Table file: {@code data/brick_resources.tbl}
 */
@Entity
@Table(name = "brick_resources")
@Getter
@Setter
@NoArgsConstructor
public class BrickResource implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Organization.class)
    @Column(name = "organizationId", nullable = false)
    private Long tenantId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 10)
    private String kind;

    @Column(nullable = false, length = 30)
    private String role;

    @Column(nullable = false, length = 10)
    private String salaryType;

    private BigDecimal salaryAmount;

    private BigDecimal tripIncentive;

    private Integer memberCount;

    @Column(length = 500)
    private String members;

    @Column(length = 20)
    private String phone;

    @Column(length = 60)
    private String upiId;

    private LocalDate joinedOn;

    @Column(nullable = false)
    private Boolean active;

    @Column(length = 300)
    private String note;

    /** STAFF (supervisor, accountant, watchman ...) or LABOUR (production, loading, drivers); empty on older rows: from the role. */
    @Column(length = 10)
    private String category;

    /** The production team a new batch starts with. */
    private Boolean defaultTeam;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
