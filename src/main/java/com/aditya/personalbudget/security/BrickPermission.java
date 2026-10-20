package com.aditya.personalbudget.security;

/**
 * What a role may do in Brick Management. A {@link BrickRole} is a set of these; every brick endpoint names the ones
 * that open it ({@link BrickGuard}), and the screens show only what the role holds.
 */
public enum BrickPermission {

    STOCK("See the bricks and raw material in the yard"),
    PRODUCTION("Record production batches and the raw material left"),
    PURCHASES("Record raw material purchases and production expenses"),
    SALES("Take orders and run their delivery: trips, loading to signed delivery, customer payments and links"),
    FINANCE("See the money: profit and loss, sales volume, account balances, the team's pay, and pay the team"),
    APPROVE("Approve what waits for a checker: orders below the price limit, changes to an order, cancellations, free delivery"),
    SETUP("Set up the yard: brick types and prices, raw materials, vehicles, the team, charges and letterhead");

    private final String description;

    BrickPermission(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
