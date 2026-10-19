package com.aditya.personalbudget.domain.type;

/**
 * Lifecycle of a chit fund membership.
 * <ul>
 *   <li>ACTIVE - paying installments, prize not yet taken</li>
 *   <li>PRIZED - prize money taken early, remaining installments still payable</li>
 *   <li>MATURED - all installments paid and the maturity amount received</li>
 *   <li>CLOSED - finished and put away by the user (after the payout or maturity); can be reopened</li>
 * </ul>
 */
public enum ChitStatus {
    ACTIVE, PRIZED, MATURED, CLOSED
}
