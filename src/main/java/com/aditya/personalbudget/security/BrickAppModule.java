package com.aditya.personalbudget.security;

import java.util.EnumSet;
import java.util.Set;

import static com.aditya.personalbudget.security.BrickPermission.*;

/**
 * The screens of the Bricks phone app ({@code bricks-app/}). Which of them a user sees is set on the web app (Settings →
 * Bricks app): for each role, and for a user on their own; a screen is never shown to a role whose permissions do not
 * open it ({@link #opensFor}), and every call the app makes is checked against the screens granted
 * ({@code BrickAppService#refusal}).
 */
public enum BrickAppModule {

    DASHBOARD("Dashboard", "Today's production, stock, sales, money due and what needs attention", EnumSet.of(FINANCE)),
    APPROVALS("Approvals", "Review requests and their evidence; approve, or reject with a reason (makers: answer and send again)", EnumSet.of(APPROVE, BrickPermission.SALES)),
    ORDERS("Orders", "Orders and customers; take a new order, cancel or give free delivery", EnumSet.of(BrickPermission.SALES, APPROVE)),
    DELIVERIES("Deliveries", "Trips by day: loading, dispatched, on the way, delivered", EnumSet.of(BrickPermission.SALES)),
    PAYMENTS("Payments", "Customer payments: record one, verify what customers reported (UPI reference)", EnumSet.of(BrickPermission.SALES)),
    STOCK("Stock", "Grey blocks in the yard (ready, curing, booked, free) and raw material left", EnumSet.of(BrickPermission.STOCK)),
    PRODUCTION("Production", "Production batches; record a batch with the raw material left", EnumSet.of(BrickPermission.PRODUCTION)),
    PURCHASES("Purchases & expenses", "Raw material bills and production expenses, with a photo of the bill", EnumSet.of(BrickPermission.PURCHASES)),
    TEAM("Team & pay", "The team, unpaid wages and advances; give an advance", EnumSet.of(FINANCE)),
    CASHBOOK("Cash & bank", "The business's cash and bank balances", EnumSet.of(FINANCE)),
    REPORTS("Reports", "Profit and loss, production, sales and costs for a period", EnumSet.of(FINANCE)),
    ALERTS("Alerts", "Notices: new orders, requests and their decisions, deliveries signed", EnumSet.of(BrickPermission.STOCK, BrickPermission.SALES, APPROVE));

    private final String label;
    private final String description;
    private final Set<BrickPermission> opens;

    BrickAppModule(String label, String description, Set<BrickPermission> opens) {
        this.label = label;
        this.description = description;
        this.opens = opens;
    }

    public String getLabel() {
        return label;
    }

    public String getDescription() {
        return description;
    }

    /** The permissions of which a role needs one for this screen. */
    public Set<BrickPermission> getOpens() {
        return EnumSet.copyOf(opens);
    }

    public boolean opensFor(BrickRole role) {
        return role != null && opens.stream().anyMatch(role::allows);
    }

    /** Every screen the role's permissions open (what a role gets until set otherwise). */
    public static Set<BrickAppModule> openTo(BrickRole role) {
        Set<BrickAppModule> out = EnumSet.noneOf(BrickAppModule.class);
        for (BrickAppModule m : values()) if (m.opensFor(role)) out.add(m);
        return out;
    }

    public static BrickAppModule parse(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
