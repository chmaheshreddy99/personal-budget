package com.aditya.personalbudget.domain.entity;

import com.aditya.personalbudget.domain.TenantOwned;
import com.aditya.personalbudget.domain.type.CategoryKind;
import com.aditya.personalbudget.storage.References;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * An expense or income category (Groceries, Rent, Salary ...). Categories are not accounts: every expense
 * is posted to the one Expenses account and every income to the one Income account, and the journal line
 * carries the category. That keeps the chart of accounts short while reports still break down by category.
 * Table file: {@code data/categories.tbl}
 */
@Entity
@Table(name = "categories", uniqueConstraints = @UniqueConstraint(columnNames = {"tenantId", "kind", "name"}))
@Getter
@Setter
@NoArgsConstructor
public class Category implements TenantOwned {

    @Id
    @GeneratedValue
    private Long id;

    @References(Tenant.class)
    @Column(nullable = false)
    private Long tenantId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private CategoryKind kind;

    /** Sort order and short reference, e.g. 5010. */
    @Column(nullable = false, length = 10)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 255)
    private String description;

    /** Set on categories the application posts to by itself (interest, chit gains ...); they cannot be deleted. */
    @Column(length = 20)
    private String systemKey;

    @Column(nullable = false)
    private Boolean active;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Version
    private Long version;
}
