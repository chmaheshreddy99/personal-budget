/**
 * Forecast › Projection: what the money earns, month by month, laid over the server's projection (forecast rows).
 *
 *   savings     bank accounts earn their own rate (else the savings rate set) on the projected bank balance (the bank
 *               share of cash & bank today), accrued every month and credited at each quarter end (March, June,
 *               September, December), when it reaches cash
 *   deposits    fixed and recurring deposits earn their own rate (else the deposit rate set), compounded quarterly;
 *               on the maturity date the deposit with its interest lands in cash
 *   money given loans you gave (money lent, bills paid for someone) earn their rate, simple or compound, from what is
 *               still owed; the interest reaches cash as the loan says (every month, every year on its anniversary, or
 *               with the principal); optionally the loan is repaid on its due date (principal and unpaid interest)
 *   chits       the interest of each running chit's schedule, in the month it is reckoned (it reaches cash with the
 *               payout, already in the projection); and the expected dividend on each installment to come (the
 *               chit's average so far), which cuts the dues the projection takes at their full amount
 *
 * Cash & bank: the projection plus every rupee these bring in, month by month. Net worth: the projection plus what is
 * earned (a chit's gain is already in the projection at maturity, so its interest is not added again; its dividends are).
 *
 * Each month also lists what earned it (earnItems: the bank balance, each deposit and loan, on how much at what
 * rate, this month and so far, and when it reaches cash), chit by chit what each earns (chitItems: interest, dividend,
 * this month and so far; chitRun the chits together so far), what reaches cash (cash.interest) and the running total.
 */
import { isoDate } from '../core/format.js';

const num = v => Number(v || 0);
const daysIn = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const endOf = m => `${m}-${String(daysIn(m)).padStart(2, '0')}`;
const dayOf = iso => Number(iso.slice(8, 10));
export const SOURCES = ['savings', 'deposits', 'given', 'chits', 'dividends'];
export const SOURCE_LABEL = { savings: 'Savings interest', deposits: 'Deposit interest', given: 'Money given', chits: 'Chit interest', dividends: 'Chit dividends' };
export const SOURCE_COLOR = { savings: 'var(--series-1)', deposits: 'var(--series-5)', given: 'var(--series-4)', chits: 'var(--series-2)', dividends: 'var(--series-3)' };

/**
 * f: the server's forecast; accounts; claims (the claim list); chits: [{ c, d }] the running chits with their detail.
 * o: { savingsRate, fdRate, repay, dividends }.
 */
export function projectEarnings(f, { accounts, claims, chits }, o) {
    const today = isoDate();
    const thisMonth = today.slice(0, 7);
    const start = num(f.startingLiquid);

    // ---- savings: the bank share of cash & bank, at the accounts' own rates
    const banks = accounts.filter(a => a.active !== false && a.accountType === 'BANK' && num(a.balance) > 0);
    const bankBal = banks.reduce((s, a) => s + num(a.balance), 0);
    const share = start > 0 ? Math.min(1, bankBal / start) : 0;
    const savRate = bankBal ? banks.reduce((s, a) => s + num(a.balance) * (num(a.interestRate) || o.savingsRate), 0) / bankBal : o.savingsRate;

    // ---- deposits
    const deposits = accounts.filter(a => a.active !== false && ['FIXED_DEPOSIT', 'RECURRING_DEPOSIT'].includes(a.accountType) && num(a.balance) > 0)
        .map(a => ({ name: a.name, value: num(a.balance), principal: num(a.balance), rate: num(a.interestRate) || o.fdRate, ownRate: !!num(a.interestRate),
            maturity: a.maturityDate || null, done: !!(a.maturityDate && a.maturityDate < today) }));

    // ---- money given
    const given = (claims || []).filter(c => ['LENT', 'PAID_FOR'].includes(c.kind) && ['OPEN', 'PARTIAL'].includes(c.status) && num(c.outstanding) > 0)
        .map(c => ({ party: c.party, principal: num(c.outstanding), unpaid: num(c.interestDue), rate: num(c.interestRate), compound: c.interestType === 'COMPOUND',
            collection: c.interestCollection || 'ON_PAYMENT', start: c.startDate, due: c.dueDate || null, overdue: !!(c.dueDate && c.dueDate < today), done: false }));

    // ---- chits: the expected dividend of each, from those paid so far
    const chitModels = chits.map(({ c, d }) => {
        const paid = d.installments.filter(i => i.status === 'PAID' && i.dividend !== null);
        return { c, d, div: paid.length ? paid.reduce((s, i) => s + num(i.dividend), 0) / paid.length : 0 };
    });

    let savPending = 0, cumCash = 0, cumEarn = 0, cumEarned = 0, cumChit = 0, prev = null;
    const runs = new Map();
    const out = f.rows.map((r, k) => {
        const m = r.month;
        const frac = m === thisMonth ? (daysIn(m) - dayOf(today) + 1) / daysIn(m) : 1;
        const e = { savings: 0, deposits: 0, given: 0, chits: 0, dividends: 0 };
        const cash = { savings: 0, deposits: 0, given: 0, dividends: 0, back: 0 };   // back: deposits maturing and money given repaid (principal)
        const events = [];
        const items = [];
        const chitItems = [];
        const earnItem = (source, name, amount, note, base = 0, rate = 0) => {
            const key = `${source}:${name}`;
            const run = (runs.get(key) || 0) + amount;
            runs.set(key, run);
            items.push({ source, name, amount, note, base, rate, run });
        };
        let interestToCash = 0;

        // deposits
        for (const d of deposits) {
            if (d.done) continue;
            const rm = Math.pow(1 + d.rate / 400, 1 / 3) - 1;
            if (d.maturity && d.maturity.slice(0, 7) === m) {
                const part = m === thisMonth ? Math.max(0, dayOf(d.maturity) - dayOf(today)) / daysIn(m) : dayOf(d.maturity) / daysIn(m);
                const accr = d.value * rm * part;
                earnItem('deposits', d.name, accr, `${moneyText(d.value)} at ${d.rate}%${d.ownRate ? '' : ' (assumed)'} · matures this month`, d.value, d.rate);
                d.value += accr; e.deposits += accr;
                interestToCash += d.value - d.principal;
                cash.deposits += d.value; cash.back += d.value; d.done = true;
                events.push({ date: d.maturity, kind: 'deposit', title: `${d.name} matures`, amount: d.value, note: `${moneyText(d.principal)} at ${d.rate}% ${d.ownRate ? '' : '(assumed) '}· interest ${moneyText(d.value - d.principal)}` });
            } else {
                const accr = d.value * rm * frac;
                earnItem('deposits', d.name, accr, `${moneyText(d.value)} at ${d.rate}%${d.ownRate ? '' : ' (assumed)'} · ${d.maturity ? `to cash at maturity, ${d.maturity}` : 'no maturity date: it only builds up'}`, d.value, d.rate);
                d.value += accr; e.deposits += accr;
            }
        }

        // money given
        for (const g of given) {
            if (g.done) continue;
            const rm = g.rate / 1200;
            const dueHere = g.due && g.due.slice(0, 7) === m && !g.overdue;
            const part = dueHere ? (m === thisMonth ? Math.max(0, dayOf(g.due) - dayOf(today)) / daysIn(m) : dayOf(g.due) / daysIn(m)) : frac;
            const accr = (g.compound ? g.principal + g.unpaid : g.principal) * rm * part;
            earnItem('given', g.party, accr, `${moneyText(g.principal)} lent at ${g.rate}% ${g.compound ? 'compound' : 'simple'} · ${g.collection === 'MONTHLY' ? 'paid every month' : g.collection === 'YEARLY' ? 'paid every year' : 'paid with the repayment'}`, g.principal, g.rate);
            g.unpaid += accr; e.given += accr;
            const anniversary = g.start && g.start.slice(5, 7) === m.slice(5, 7) && g.start.slice(0, 7) < m;
            if (g.unpaid > 0.5 && (g.collection === 'MONTHLY' || (g.collection === 'YEARLY' && anniversary))) {
                const day = g.start ? Math.min(daysIn(m), dayOf(g.start)) : daysIn(m);
                events.push({ date: `${m}-${String(day).padStart(2, '0')}`, kind: 'given', title: `Interest from ${g.party}`, amount: g.unpaid, note: `${g.rate}% ${g.compound ? 'compound' : 'simple'} on ${moneyText(g.principal)}` });
                interestToCash += g.unpaid;
                cash.given += g.unpaid; g.unpaid = 0;
            }
            if (dueHere && o.repay) {
                events.push({ date: g.due, kind: 'given', title: `${g.party} repays`, amount: g.principal + g.unpaid, note: `${moneyText(g.principal)} lent${g.unpaid > 0.5 ? ` + ${moneyText(g.unpaid)} interest` : ''} · due date` });
                interestToCash += g.unpaid;
                cash.given += g.principal + g.unpaid; cash.back += g.principal; g.unpaid = 0; g.done = true;
            }
        }

        // chits: interest reckoned this month, dividends on the dues of this month (overdue dues fall in the first row)
        for (const x of chitModels) {
            const reckoned = x.d.interestSchedule.filter(s => s.interestDate.slice(0, 7) === m && (s.status === 'ACCRUING' || s.status === 'PROJECTED'));
            reckoned.forEach(s => { e.chits += num(s.compoundInterest); });
            const dues = x.d.installments.filter(i => i.status !== 'PAID' && (i.dueDate.slice(0, 7) === m || (k === 0 && i.dueDate.slice(0, 7) < m)));
            const eachDiv = o.dividends && x.c.payoutAmount === null ? x.div : 0;
            if (dues.length && eachDiv) interestToCash += eachDiv * dues.length;
            const interest = reckoned.reduce((t, s) => t + num(s.compoundInterest), 0);
            const dividend = eachDiv * dues.length;
            if (interest || dividend) {
                x.run = (x.run || 0) + interest + dividend;
                cumChit += interest + dividend;
                chitItems.push({ name: x.c.name, organizer: x.c.organizer, interest, dividend, amount: interest + dividend, run: x.run,
                    base: reckoned.length ? num(reckoned[reckoned.length - 1].openingBalance) : null,
                    installment: dues.length ? dues[dues.length - 1].installmentNo : null, installments: x.c.numberOfInstallments,
                    maturity: x.c.payoutAmount === null ? x.c.maturityDate : null });
            }
            dues.forEach(i => {
                const div = eachDiv;
                e.dividends += div; cash.dividends += div;
                events.push({ date: i.dueDate < today ? today : i.dueDate, kind: 'chit', title: `${x.c.name} · installment ${i.installmentNo}${i.dueDate < today ? ' (overdue)' : ''}`,
                    amount: -(num(i.dueAmount) - div), note: div ? `${moneyText(num(i.dueAmount))} less a ${moneyText(div)} dividend (average)` : 'full installment' });
            });
            if (x.c.payoutAmount === null && x.c.maturityDate && x.c.maturityDate.slice(0, 7) === m)
                events.push({ date: x.c.maturityDate, kind: 'chit-in', title: `${x.c.name} matures`, amount: num(x.c.maturityAmount), note: 'the maturity amount (in the projection)' });
        }

        // savings: on the bank share of the month's average cash & bank, with what came in so far
        const open = k === 0 ? start : prev.liquid;
        const close = num(r.liquidClosing) + cumCash + cash.deposits + cash.given + cash.dividends;
        const accr = Math.max(0, (open + close) / 2) * share * savRate / 1200 * frac;
        earnItem('savings', 'Savings bank', accr, `${moneyText(Math.max(0, (open + close) / 2) * share)} at ${savRate.toFixed(2)}% · to cash at the quarter end`, Math.max(0, (open + close) / 2) * share, savRate);
        e.savings += accr; savPending += accr;
        if (['03', '06', '09', '12'].includes(m.slice(5, 7)) && savPending > 0.5) {
            cash.savings += savPending;
            interestToCash += savPending;
            events.push({ date: endOf(m), kind: 'savings', title: 'Savings interest credited', amount: savPending, note: `${savRate.toFixed(2)}% a year on the bank balance, for the quarter` });
            savPending = 0;
        }

        const extra = cash.savings + cash.deposits + cash.given + cash.dividends;
        cumCash += extra;
        const earned = e.savings + e.deposits + e.given + e.chits + e.dividends;
        cumEarn += e.savings + e.deposits + e.given + e.dividends;   // chit interest is in the projection's net worth at maturity
        cumEarned += earned;
        cash.interest = interestToCash;
        const row = { ...r, earn: e, cash, earned, earnedRun: cumEarned, earnItems: items.sort((a, b) => SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source) || b.amount - a.amount), chitItems: chitItems.sort((a, b) => b.amount - a.amount), chitRun: cumChit, extraCash: extra, baseLiquid: num(r.liquidClosing), liquid: num(r.liquidClosing) + cumCash,
            baseNetWorth: num(r.netWorth), netWorth: num(r.netWorth) + cumEarn, events: events.sort((a, b) => a.date.localeCompare(b.date)) };
        prev = row;
        return row;
    });

    const total = Object.fromEntries(SOURCES.map(s => [s, out.reduce((t, r) => t + r.earn[s], 0)]));
    const lowest = out.reduce((m, r) => (!m || r.liquid < m.liquid ? r : m), null);
    const notes = [];
    if (!banks.length) notes.push('No bank account with money in it: no savings interest.');
    else notes.push(`Savings: ${savRate.toFixed(2)}% a year on ${Math.round(share * 100)}% of cash & bank (the bank share today), credited at each quarter end.`);
    deposits.forEach(d => { if (!d.ownRate) notes.push(`${d.name}: no rate on the account, ${o.fdRate}% assumed.`); if (!d.maturity) notes.push(`${d.name}: no maturity date, interest only accrues.`); });
    given.filter(g => g.overdue).forEach(g => notes.push(`${g.party}: past its due date (${g.due}); interest keeps accruing, no repayment assumed.`));
    given.filter(g => !g.rate).forEach(g => notes.push(`${g.party}: no interest on it.`));
    return { rows: out, total, earned: SOURCES.reduce((t, s) => t + total[s], 0), lowest, savRate, share, deposits, given, notes,
        cashIn: out.reduce((t, r) => t + r.extraCash, 0) };
}

const moneyText = v => `₹${Math.round(v).toLocaleString('en-IN')}`;
