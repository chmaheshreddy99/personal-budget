/**
 * The arithmetic behind Forecast › Lift or hold and Chit forecast, for chits the user is a member of.
 *
 * Lifting (taking the prize before maturity) is borrowing from the chit: money now, paid back by the installments
 * still to come and by giving up the maturity amount. What it costs depends on the organizer's terms (the chit's lift
 * terms):
 *   - early lifting can pay less: a cut off the maturity amount, largest in the first month lifting is allowed and
 *     falling in a straight line to the last (liftDiscountFirst → liftDiscountLast), or the organizer's own chart of
 *     payouts by month (liftChart, over the line); a one-time fee comes off (liftFeePercent);
 *   - after lifting, the installment can be more (afterLiftInstallment: often the full amount, with no dividend);
 *   - lifting may only be allowed from some month on (liftFromMonth).
 * With no terms set, the payout is estimated as the maturity amount discounted at the chit's own rate, so lifting
 * costs what the chit earns (the honest default until the real terms are known).
 *
 * For each month the chit could be lifted, the cost is worked out as a yearly rate: the rate at which the money taken
 * early equals what it costs later (the IRR of lifting against holding). Below what your money earns elsewhere,
 * lifting pays; below a loan's rate, lifting is the cheaper way to borrow; above both, hold.
 */
const DAY = 86400000;
const num = v => Number(v || 0);

/** Years between two ISO dates. */
export const yearsBetween = (a, b) => (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY / 365;

/** The yearly rate (percent) at which dated cash flows [{date, amount}] are worth nothing today; null when there is none. */
export function irr(flows, from) {
    const fs = flows.filter(f => f.amount).map(f => ({ t: Math.max(0, yearsBetween(from, f.date)), v: f.amount }));
    if (!fs.some(f => f.v > 0) || !fs.some(f => f.v < 0)) return null;
    if (Math.max(...fs.map(f => f.t)) - Math.min(...fs.map(f => f.t)) < 1 / 365) return null;
    const npv = r => fs.reduce((s, f) => s + f.v / Math.pow(1 + r, f.t), 0);
    let lo = -0.95, hi = 10;
    let flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 120; i++) {
        const mid = (lo + hi) / 2, f = npv(mid);
        if (Math.abs(f) < 1e-6) { lo = hi = mid; break; }
        if (f * flo > 0) { lo = mid; flo = f; } else { hi = mid; }
    }
    return ((lo + hi) / 2) * 100;
}

/** What dated flows are worth today at a yearly rate (percent). */
export function npv(flows, from, ratePercent) {
    const r = ratePercent / 100;
    return flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, Math.max(0, yearsBetween(from, f.date))), 0);
}

/** The dividend an installment still to come is expected to bring: the average of those so far. */
export function expectedDividend(c) {
    return c.installmentsPaid ? num(c.dividendsEarned) / c.installmentsPaid : 0;
}

/**
 * The lift table as stored: "3=82000@5000, 4=84500" → { 3: { payout: 82000, after: 5000 }, 4: { payout: 84500, after: null } }:
 * what lifting in a month pays, and what is paid each month after lifting then (empty: the chit's after-lift amount).
 */
export function parseChart(text) {
    const out = {};
    String(text || '').split(',').forEach(pair => {
        const [m, rest] = pair.split('=').map(s => s && s.trim());
        if (!m || !rest) return;
        const [p, a] = rest.split('@').map(s => s && s.trim());
        if (!Number.isNaN(Number(m)) && p && !Number.isNaN(Number(p))) out[Number(m)] = { payout: Number(p), after: a && !Number.isNaN(Number(a)) ? Number(a) : null };
    });
    return out;
}

/** The lift table back as stored text. */
export function chartText(rows) {
    return rows.filter(r => r.payout > 0).map(r => `${r.no}=${Math.round(r.payout * 100) / 100}${r.after != null ? `@${Math.round(r.after * 100) / 100}` : ''}`).join(',');
}

/** Whether a chit's lift terms say anything (else the payout is an estimate). */
export const hasTerms = t => !!t && (t.liftChart || t.liftDiscountFirst != null || t.liftDiscountLast != null || t.afterLiftInstallment != null || t.liftFeePercent != null);

/** A chit that is still running and not yet lifted: the only kind that can be lifted. */
export const liftable = c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && c.payoutAmount === null && c.installmentsPending > 0;

/**
 * The installments still to come, each with what is expected to be paid (the due amount less the expected dividend) and
 * what is paid after lifting; and the maturity date.
 */
/** regularOf(installment, dueLessAverage): what an installment to come is expected to cost (a dividend forecast); default the average. */
export function remaining(c, installments, terms, regularOf = null) {
    const div = expectedDividend(c);
    const after = terms?.afterLiftInstallment != null ? num(terms.afterLiftInstallment) : null;
    const rows = installments.filter(i => i.status !== 'PAID').sort((a, b) => a.installmentNo - b.installmentNo)
        .map(i => {
            const regular = regularOf ? Math.max(0, regularOf(i, Math.max(0, num(i.dueAmount) - div))) : Math.max(0, num(i.dueAmount) - div);
            return { no: i.installmentNo, date: i.dueDate, regular, after: after != null ? after : regular };
        });
    const maturityDate = c.maturityDate || rows[rows.length - 1]?.date || c.endDate;
    return { rows, maturityDate, dividend: div };
}

/** What lifting in month m pays, after the cut and the fee; estimated: whether it comes from the terms or is a guess. */
export function payoutFor(c, terms, m, maturityDate, monthDate) {
    const M = num(c.maturityAmount), n = c.numberOfInstallments;
    const chart = parseChart(terms?.liftChart);
    const fee = num(terms?.liftFeePercent) / 100;
    let gross, estimated = false, cut;
    if (chart[m] != null) {
        gross = chart[m].payout;
        cut = M ? (1 - gross / M) * 100 : 0;
    } else if (terms && (terms.liftDiscountFirst != null || terms.liftDiscountLast != null)) {
        const from = Math.max(1, num(terms.liftFromMonth) || 1);
        const first = num(terms.liftDiscountFirst ?? terms.liftDiscountLast), last = num(terms.liftDiscountLast ?? 0);
        const share = n > from ? Math.min(1, Math.max(0, (m - from) / (n - from))) : 1;
        cut = first + (last - first) * share;
        gross = M * (1 - cut / 100);
    } else {
        // no terms: the maturity amount brought back to that month at the chit's own rate
        const r = num(c.rateUsed || c.impliedAnnualRate || 8) / 100;
        gross = M / Math.pow(1 + r, Math.max(0, yearsBetween(monthDate, maturityDate)));
        cut = M ? (1 - gross / M) * 100 : 0;
        estimated = true;
    }
    return { gross, fee: gross * fee, payout: gross * (1 - fee), cut, estimated };
}

/**
 * Lift or hold for one chit: for each month it can be lifted, the payout, what is paid after, what lifting costs in
 * rupees and as a yearly rate, and what it is worth against holding at the rate your money earns. Then the verdict.
 *   investRate  what the money would earn if lifted and invested (a deposit, a fund)
 *   loanRate    what borrowing would cost instead (a personal loan, gold loan)
 */
export function analyseLift(c, installments, terms, { investRate = 8, loanRate = 12, today, regularOf = null }) {
    const { rows, maturityDate, dividend } = remaining(c, installments, terms, regularOf);
    if (!rows.length) return null;
    const M = num(c.maturityAmount);
    const from = Math.max(rows[0].no, num(terms?.liftFromMonth) || 1);
    const hold = [...rows.map(r => ({ date: r.date, amount: -r.regular })), { date: maturityDate, amount: M }];
    const holdRate = irr(hold, today);
    const chart = parseChart(terms?.liftChart);
    const months = rows.filter(r => r.no >= from).map(r => {
        const p = payoutFor(c, terms, r.no, maturityDate, r.date);
        // after lifting in this month: the table's amount for it, else the chit's after-lift amount, else as now
        const afterEach = chart[r.no]?.after ?? null;
        const later = rows.filter(x => x.no > r.no).map(x => (afterEach != null ? { ...x, after: afterEach } : x));
        const extra = later.reduce((s, x) => s + (x.after - x.regular), 0);
        // lifting against holding: the payout now, then the extra each month and the maturity amount given up
        const flows = [{ date: r.date, amount: p.payout }, ...later.map(x => ({ date: x.date, amount: -(x.after - x.regular) })), { date: maturityDate, amount: -M }];
        const rate = irr(flows, today);
        return {
            no: r.no, date: r.date, regular: r.regular, ...p, afterLift: later[0]?.after ?? null, afterEach: afterEach ?? (terms?.afterLiftInstallment != null ? num(terms.afterLiftInstallment) : null),
            extraAfter: extra, paidAfter: later.reduce((s, x) => s + x.after, 0),
            cost: M + extra - p.payout, rate, gainAtInvest: npv(flows, today, investRate), gainAtLoan: npv(flows, today, loanRate),
        };
    });
    // the cheapest month among those at least two months before maturity: a few weeks out, a small cost reads as any yearly rate
    const priced = months.filter(x => x.rate != null && yearsBetween(x.date, maturityDate) >= 2 / 12);
    const cheapest = priced.length ? priced.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
    const bestValue = months.length ? months.reduce((a, b) => (b.gainAtInvest > a.gainAtInvest ? b : a)) : null;
    let verdict, tone;
    if (!cheapest) { verdict = 'HOLD'; tone = 'good'; }
    else if (cheapest.rate < investRate) { verdict = 'LIFT'; tone = 'warn'; }
    else if (cheapest.rate < loanRate) { verdict = 'HOLD_LIFT_IF_NEEDED'; tone = 'info'; }
    else { verdict = 'HOLD'; tone = 'good'; }
    return { chit: c, terms, estimated: !hasTerms(terms), dividend, rows, maturityDate, holdRate, months, cheapest, bestValue, verdict, tone, from,
        afterLiftMore: months.some(x => x.afterLift != null && x.afterLift > x.regular + 0.5) };
}

/**
 * A chit's value along the way when held: today it stands at its book value (what is in its account); each installment
 * adds to it and it grows at the one steady rate that makes it the maturity amount on the maturity date. Returns the
 * monthly rate and a function giving the value on a date.
 */
export function valuePath(c, rows, maturityDate, today) {
    const V0 = num(c.accountBalance ?? c.paidIn);
    const M = num(c.maturityAmount);
    const T = Math.max(1 / 30, yearsBetween(today, maturityDate) * 12);
    const at = (i, months) => V0 * Math.pow(1 + i, months) + rows.reduce((s, r) => {
        const t = yearsBetween(today, r.date) * 12;
        return t <= months ? s + r.regular * Math.pow(1 + i, months - Math.max(0, t)) : s;
    }, 0);
    let lo = -0.05, hi = 0.2;
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (at(mid, T) > M) hi = mid; else lo = mid; }
    const i = (lo + hi) / 2;
    return { monthlyRate: i, value: date => (date >= maturityDate ? 0 : at(i, Math.max(0, yearsBetween(today, date) * 12))), start: V0 };
}
