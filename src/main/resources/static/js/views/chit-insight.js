/**
 * Chits › a chit › Lift or hold: what the chit's own numbers say about lifting it or holding it.
 *
 * The models, kept simple enough to explain:
 *   dividend trend   ordinary least squares of the dividend against the installment number (dividends usually
 *                    fall as a chit runs and fewer members bid): slope, intercept, R² and the residual spread σ;
 *                    the forecast of each installment still to come shrinks the slope by R² toward the average and
 *                    stays within the range seen, which makes what is still to pay truer than a flat average without
 *                    trusting a loose line far ahead
 *   lifetime return  the yearly rate (XIRR) of every installment paid and still to pay against the maturity amount;
 *                    after inflation: (1 + r) / (1 + inflation) − 1
 *   lift or hold     the chit table's payouts and after-lift installments (chit-math.js analyseLift), each month's
 *                    cost of lifting as a yearly rate; the cheapest month; the break-even rate (what your money must
 *                    earn for lifting to pay)
 *   sensitivity      the verdict and the best gain at a range of rates your money could earn
 *   Monte Carlo      3,000 runs with the future dividends drawn around the trend (σ from the regression) and the
 *                    return on the payout drawn around your rate (σ you set): how often lifting in the cheapest
 *                    month beats holding, and the 10th, 50th and 90th percentile of what it is worth
 *   value of waiting what waiting one more month earns, as a yearly rate (lifting next month against this month)
 *   at maturity      each month's lifting as wealth on the maturity date: the payout grown at your rate less the extra
 *                    paid after (each grown too), against the maturity amount
 *   heat map         lifting's worth today for each month at a range of rates your money could earn
 *   lift or borrow   getting the same money by a loan at your loan rate until maturity, against what lifting costs
 *   organizer risk   holding keeps what you have paid in at stake until maturity; at a yearly chance the organizer
 *                    fails, the expected loss lifting avoids, and the chance at which lifting would break even
 *   dividends        mean, median, spread, coefficient of variation, yield on the installment; the next installments
 *                    with their 80% range; confidence of the verdict from the odds, the margin and the data behind it
 */
import { analyseLift, irr, npv, remaining, yearsBetween } from './chit-math.js';

const num = v => Number(v || 0);

/** Least squares of dividend against installment number over the installments paid with a dividend recorded. */
export function dividendTrend(installments) {
    const pts = installments.filter(i => i.status === 'PAID' && i.dividend !== null && i.dividend !== undefined)
        .map(i => ({ x: i.installmentNo, y: num(i.dividend) }));
    const n = pts.length;
    if (n < 3) {
        const avg = n ? pts.reduce((s, p) => s + p.y, 0) / n : 0;
        return { n, slope: 0, intercept: avg, r2: null, sigma: 0, avg, pts, forecast: () => avg, band: () => 0, usable: false };
    }
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const fit = x => intercept + slope * x;
    const ssr = pts.reduce((s, p) => s + (p.y - fit(p.x)) ** 2, 0);
    const sst = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
    const r2 = sst ? 1 - ssr / sst : 1;
    const sigma = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
    // the forecast trusts the line only as far as it fits: the slope shrunk by R² toward the average (a loose trend says
    // little about months far ahead), and kept within half the lowest to one and a half times the highest dividend seen
    const lo = Math.min(...pts.map(p => p.y)) * 0.5, hi = Math.max(...pts.map(p => p.y)) * 1.5;
    const forecast = x => Math.max(0, lo, Math.min(hi, my + slope * Math.max(0, r2) * (x - mx)));
    // the 80% prediction interval of a single dividend at x: ±1.28 σ √(1 + 1/n + (x − x̄)² / Sxx)
    const band = x => 1.2816 * sigma * Math.sqrt(1 + 1 / n + (sxx ? (x - mx) ** 2 / sxx : 0));
    return { n, slope, intercept, r2, sigma, avg: my, pts, forecast, band, usable: true };
}

/** A small seeded random generator (mulberry32), so the simulation gives the same answer each time for the same inputs. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const normal = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] : 0;

/**
 * Everything the tab shows for chit c (its installments, its lift terms), at the yardsticks
 * { investRate, loanRate, inflation, fdRate, volatility, today }.
 */
export function chitInsights(c, installments, terms, y) {
    const trend = dividendTrend(installments);
    const regularOf = trend.usable ? (i => num(i.dueAmount) - trend.forecast(i.installmentNo)) : null;
    const a = analyseLift(c, installments, terms, { ...y, regularOf });
    if (!a) return null;
    const M = num(c.maturityAmount);
    const { rows, maturityDate } = remaining(c, installments, terms, regularOf);

    // the whole life of the chit: what was paid, what is still to pay, the maturity amount
    const paid = installments.filter(i => i.status === 'PAID').map(i => ({ date: i.paidDate || i.dueDate, amount: -(num(i.paidAmount) || num(i.dueAmount) - num(i.dividend)) }));
    const life = [...paid, ...rows.map(r => ({ date: r.date, amount: -r.regular })), { date: maturityDate, amount: M }];
    const firstDate = installments.reduce((m, i) => (!m || i.dueDate < m ? i.dueDate : m), null) || y.today;
    const lifeRate = irr(life, firstDate);
    const realRate = lifeRate == null ? null : ((1 + lifeRate / 100) / (1 + y.inflation / 100) - 1) * 100;
    const paidSoFar = -paid.reduce((s, f) => s + f.amount, 0);
    const stillToPay = rows.reduce((s, r) => s + r.regular, 0);

    // the verdict and the best gain at other rates your money could earn
    const sensitivity = [6, 8, 10, 12, 14, 16].map(rate => {
        const b = analyseLift(c, installments, terms, { ...y, investRate: rate, regularOf });
        return { rate, verdict: b.cheapest && b.cheapest.rate < rate ? 'LIFT' : 'HOLD', month: b.bestValue?.no, gain: b.bestValue ? b.bestValue.gainAtInvest : 0 };
    });

    // Monte Carlo: the dividends to come drawn around the trend, the payout's return drawn around your rate
    let simulation = null;
    const best = a.cheapest;
    if (best && best.rate != null) {
        const r = rng(Math.round(M + best.no * 7919 + y.investRate * 101));
        const later = rows.filter(x => x.no > best.no);
        const after = best.afterEach ?? null;   // the chit table's after-lift amount for that month, else each month's own
        const gains = [];
        let wins = 0;
        const runs = 3000;
        for (let k = 0; k < runs; k++) {
            const rate = y.investRate + normal(r) * y.volatility;
            const flows = [{ date: best.date, amount: best.payout }];
            for (const x of later) {
                const regular = Math.max(0, x.regular + (trend.usable ? -normal(r) * trend.sigma : 0));
                flows.push({ date: x.date, amount: -((after ?? x.after) - regular) });
            }
            flows.push({ date: maturityDate, amount: -M });
            const g = npv(flows, y.today, Math.max(-50, rate));
            gains.push(g);
            if (g > 0) wins++;
        }
        gains.sort((p, q) => p - q);
        // a histogram of the outcomes, 12 bins between the 2nd and 98th percentile
        const lo = pct(gains, 0.02), hi = pct(gains, 0.98), w = (hi - lo) / 12 || 1;
        const counts = Array(12).fill(0);
        gains.forEach(g => { counts[Math.min(11, Math.max(0, Math.floor((g - lo) / w)))]++; });
        const hist = counts.map((count, k) => ({ from: lo + k * w, to: lo + (k + 1) * w, count }));
        simulation = { runs, chance: wins / runs, p10: pct(gains, 0.1), p50: pct(gains, 0.5), p90: pct(gains, 0.9), month: best.no,
            mean: gains.reduce((s, g) => s + g, 0) / runs, hist };
    }

    // what waiting one more month earns: lifting next month against lifting in the first month that can be lifted
    let waiting = null;
    const [m1, m2] = a.months;
    if (m1 && m2) {
        const row2 = rows.find(x => x.no === m2.no);
        const diff = [{ date: m1.date, amount: -m1.payout },
            { date: m2.date, amount: m2.payout - (row2?.regular ?? 0) + (m1.afterLift ?? row2?.regular ?? 0) },
            ...rows.filter(x => x.no > m2.no).map(x => ({ date: x.date, amount: (m1.afterEach ?? x.after) - (m2.afterEach ?? x.after) }))];
        waiting = { from: m1.no, to: m2.no, rate: irr(diff, y.today), rise: m2.payout - m1.payout };
    }

    // what to do, in plain words
    const tips = [];
    if (a.estimated) tips.push({ tone: 'warn', icon: 'edit', text: 'The payouts are estimated from the chit’s own rate. Ask the organizer for the chart of what each month pays (and what is paid after lifting) and fill in the chit table: the verdict then rests on real figures.' });
    if (trend.usable && trend.slope < -1) tips.push({ tone: 'info', icon: 'trending', text: `Dividends are falling about ₹${Math.round(-trend.slope)} a month (R² ${trend.r2.toFixed(2)}). Budget the later installments closer to the full amount: the forecast puts the last ones at about ₹${Math.round(num(installments.at(-1)?.dueAmount) - trend.forecast(c.numberOfInstallments))}.` });
    if (trend.usable && trend.r2 < 0.3) tips.push({ tone: 'info', icon: 'scale', text: 'Dividends jump around a lot from month to month (a low R²): the forecast of what is still to pay is rough; the simulation allows for it.' });
    if (lifeRate != null && lifeRate < y.inflation) tips.push({ tone: 'bad', icon: 'alert', text: `Over its whole life this chit returns about ${lifeRate.toFixed(1)}% a year, less than ${y.inflation}% inflation. Do not join another like it; if lifting is cheap (see below), taking the money early and investing it is worth weighing.` });
    else if (lifeRate != null && lifeRate < y.fdRate) tips.push({ tone: 'warn', icon: 'scale', text: `It returns about ${lifeRate.toFixed(1)}% a year over its life, less than a ${y.fdRate}% deposit. Keep paying (dropping out costs more), but compare before the next chit.` });
    else if (lifeRate != null) tips.push({ tone: 'good', icon: 'check-circle', text: `It returns about ${lifeRate.toFixed(1)}% a year over its life, ${realRate.toFixed(1)}% after inflation: better than a ${y.fdRate}% deposit.` });
    if (best) {
        if (a.verdict === 'LIFT') tips.push({ tone: 'warn', icon: 'arrow-in', text: `Lifting in month ${best.no} costs ${best.rate.toFixed(1)}% a year, under the ${y.investRate}% your money earns: lift then and invest the ₹${Math.round(best.payout).toLocaleString('en-IN')} where it earns more than ${best.rate.toFixed(1)}% (a debt fund, or clearing a loan dearer than that).` });
        else if (a.verdict === 'HOLD_LIFT_IF_NEEDED') tips.push({ tone: 'info', icon: 'clock', text: `Hold. If you need money before ${monthsTo(y.today, maturityDate)}, lifting in month ${best.no} at ${best.rate.toFixed(1)}% a year is cheaper than a loan at ${y.loanRate}%.` });
        else tips.push({ tone: 'good', icon: 'check-circle', text: `Hold: even the cheapest month costs ${best.rate.toFixed(1)}% a year, more than a loan. Lifting only makes sense in an emergency.` });
        if (simulation) tips.push({ tone: simulation.chance > 0.6 ? 'warn' : simulation.chance < 0.4 ? 'good' : 'info', icon: 'sparkles', text: `In ${simulation.runs.toLocaleString('en-IN')} simulated futures (dividends and returns varying), lifting in month ${simulation.month} came out ahead in ${Math.round(simulation.chance * 100)}% of them.` });
    }
    if (waiting?.rate != null && waiting.rate > y.investRate) tips.push({ tone: 'good', icon: 'clock', text: `Waiting from month ${waiting.from} to ${waiting.to} adds ₹${Math.round(waiting.rise).toLocaleString('en-IN')} to the payout, about ${waiting.rate.toFixed(1)}% a year for that month: more than your money earns, so do not lift in month ${waiting.from}.` });
    if (num(c.overdueAmount) > 0) tips.push({ tone: 'bad', icon: 'alert', text: `₹${num(c.overdueAmount).toLocaleString('en-IN')} is overdue: late installments draw penalty interest and can delay a prize. Pay them before deciding.` });

    // ---- each month as wealth on the maturity date, at the rate your money earns
    const i = y.investRate / 100;
    const fv = (amount, date) => amount * Math.pow(1 + i, Math.max(0, yearsBetween(date, maturityDate)));
    const flowsOf = x => [{ date: x.date, amount: x.payout },
        ...rows.filter(r => r.no > x.no).map(r => ({ date: r.date, amount: -((x.afterEach ?? r.after) - r.regular) })), { date: maturityDate, amount: -M }];
    const perMonth = a.months.map(x => {
        const edge = flowsOf(x).reduce((s, f) => s + fv(f.amount, f.date), 0);
        const toMaturity = Math.round(yearsBetween(x.date, maturityDate) * 12);
        const priced = x.rate != null && toMaturity >= 2;
        const say = !priced ? 'LATE' : x.rate < y.investRate ? 'LIFT' : x.rate < y.loanRate ? 'IF_NEEDED' : 'HOLD';
        return { ...x, edge, atMaturity: M + edge, toMaturity, say };
    });

    // ---- hold against lifting in the cheapest month and in the first month that can be lifted
    const holdOut = rows.reduce((s, r) => s + r.regular, 0);
    const column = x => x && {
        no: x.no, date: x.date, get: x.payout, getDate: x.date, still: x.paidAfter, out: rows.filter(r => r.no <= x.no).reduce((s, r) => s + r.regular, 0) + x.paidAfter,
        atMaturity: x.atMaturity, edge: x.edge, today: x.gainAtInvest, rate: x.rate, cost: x.cost, cut: x.cut,
    };
    const first = perMonth.find(x => x.say !== 'LATE');
    const cheap = perMonth.find(x => x.no === best?.no);
    const compare = { hold: { get: M, getDate: maturityDate, still: holdOut, out: holdOut, atMaturity: M, edge: 0, today: 0 },
        best: column(cheap), first: first && first.no !== cheap?.no ? column(first) : null };

    // ---- the lifting window: months worth lifting, and those cheaper than a loan
    const span = list => {
        if (!list.length) return '';
        const out = [];
        let s = list[0], p = list[0];
        for (const m of list.slice(1).concat([null])) {
            if (m === p + 1) { p = m; continue; }
            out.push(s === p ? `${s}` : `${s}–${p}`);
            if (m != null) { s = m; p = m; }
        }
        return out.join(', ');
    };
    const liftWindow = { lift: span(perMonth.filter(x => x.say === 'LIFT').map(x => x.no)), needed: span(perMonth.filter(x => x.say !== 'LATE' && x.say !== 'HOLD').map(x => x.no)) };

    // ---- lifting's worth today at each rate your money could earn, for the months that can be priced (at most 12)
    const pricedMonths = perMonth.filter(x => x.say !== 'LATE');
    const step = Math.max(1, Math.ceil(pricedMonths.length / 12));
    const heatMonths = pricedMonths.filter((_, k) => k % step === 0);
    const heatRates = [...new Set([4, 6, 8, 10, 12, 14, 16, y.investRate])].sort((p, q) => p - q);
    const heat = { months: heatMonths.map(x => x.no), rates: heatRates, cells: heatRates.map(rate => heatMonths.map(x => npv(flowsOf(x), y.today, rate))) };

    // ---- the same money by a loan at your loan rate until maturity, against lifting's cost
    const borrow = cheap ? (() => {
        const t = yearsBetween(cheap.date, maturityDate);
        const interest = cheap.payout * (Math.pow(1 + y.loanRate / 100, t) - 1);
        return { month: cheap.no, amount: cheap.payout, months: Math.round(t * 12), interest, liftCost: cheap.cost, cheaper: interest < cheap.cost ? 'BORROW' : 'LIFT', by: Math.abs(interest - cheap.cost) };
    })() : null;

    // ---- organizer risk: what stays at stake while holding, and what lifting in the best-value month avoids
    const p = (y.risk ?? 1) / 100;
    let stake = paidSoFar;
    const stakes = rows.map(r => { stake += r.regular; return { no: r.no, stake }; });
    const lossFrom = m => stakes.filter(s => s.no >= m).reduce((t, s) => t + s.stake * p / 12, 0);
    const bv = pricedMonths.length ? pricedMonths.reduce((p1, q1) => (q1.gainAtInvest > p1.gainAtInvest ? q1 : p1)) : null;   // the best-value month that can be priced
    const exposureMonths = bv ? stakes.filter(s => s.no >= bv.no).reduce((t, s) => t + s.stake / 12, 0) : 0;
    const risk = {
        rate: y.risk ?? 1, now: paidSoFar, peak: stake, expectedLoss: lossFrom(rows[0]?.no ?? 0),
        month: bv?.no ?? null, avoided: bv ? lossFrom(bv.no) : 0, gain: bv?.gainAtInvest ?? 0,
        adjusted: bv ? bv.gainAtInvest + lossFrom(bv.no) : 0,
        breakEven: bv && bv.gainAtInvest < 0 && exposureMonths ? (-bv.gainAtInvest / exposureMonths) * 100 : null,
    };

    // ---- the dividends: how they spread, and the next installments with their 80% range
    const ys = trend.pts.map(q => q.y).sort((p1, q1) => p1 - q1);
    const mean = ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : 0;
    const sd = ys.length > 1 ? Math.sqrt(ys.reduce((s, v) => s + (v - mean) ** 2, 0) / (ys.length - 1)) : 0;
    const dueOf = no => num(installments.find(x => x.installmentNo === no)?.dueAmount) || num(c.monthlyInstallment);
    const divStats = {
        n: ys.length, total: ys.reduce((s, v) => s + v, 0), mean, median: ys.length ? (ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2) : 0,
        min: ys[0] ?? 0, max: ys.at(-1) ?? 0, sd, cv: mean ? sd / mean : 0, yield: mean && num(c.monthlyInstallment) ? mean / num(c.monthlyInstallment) * 100 : 0,
        toCome: rows.reduce((s, r) => s + Math.max(0, dueOf(r.no) - r.regular), 0),
    };
    const nextUp = rows.slice(0, 6).map(r => {
        const div = trend.usable ? trend.forecast(r.no) : divStats.mean;
        const b = trend.usable ? trend.band(r.no) : 0;
        return { no: r.no, date: r.date, due: dueOf(r.no), div, pay: r.regular, low: Math.max(0, dueOf(r.no) - div - b), high: Math.max(0, dueOf(r.no) - Math.max(0, div - b)) };
    });

    // ---- how sure the verdict is: the odds, the margin between the break-even rate and your rate, the data behind it
    let confidence = null;
    if (best && simulation) {
        const margin = Math.abs(best.rate - y.investRate);
        const odds = Math.abs(simulation.chance - 0.5) * 2;   // 0 a coin toss, 1 every future agrees
        let score = (Math.min(1, margin / 6) * 0.45 + odds * 0.45 + (trend.usable && trend.n >= 6 ? 0.1 : 0.04)) * (a.estimated ? 0.7 : 1);
        score = Math.round(score * 100);
        confidence = { score, label: score >= 70 ? 'Strong' : score >= 45 ? 'Moderate' : 'Weak', margin, odds,
            why: `${margin.toFixed(1)} points between the break-even rate and your ${y.investRate}%, ${Math.round(Math.max(simulation.chance, 1 - simulation.chance) * 100)}% of simulated futures agree${a.estimated ? ', payouts estimated' : ''}${trend.usable ? `, ${trend.n} dividends behind the trend` : ''}` };
    }
    if (risk.breakEven != null && risk.breakEven < 3) tips.push({ tone: 'info', icon: 'shield', text: `Holding keeps up to ₹${Math.round(risk.peak).toLocaleString('en-IN')} with the organizer until maturity. If you think there is more than a ${risk.breakEven.toFixed(1)}% a year chance they fail, lifting in month ${risk.month} comes out ahead.` });
    if (borrow && borrow.cheaper === 'BORROW' && a.verdict !== 'LIFT') tips.push({ tone: 'info', icon: 'scale', text: `Need the money for a short while? A loan of ₹${Math.round(borrow.amount).toLocaleString('en-IN')} at ${y.loanRate}% until maturity costs about ₹${Math.round(borrow.interest).toLocaleString('en-IN')}, ₹${Math.round(borrow.by).toLocaleString('en-IN')} less than lifting.` });

    return { a, trend, lifeRate, realRate, paidSoFar, stillToPay, sensitivity, simulation, waiting, tips, maturityDate, M,
        perMonth, compare, window: liftWindow, heat, borrow, risk, divStats, nextUp, confidence };
}

const monthsTo = (from, to) => { const m = Math.round(yearsBetween(from, to) * 12); return `${m} month${m === 1 ? '' : 's'} from now`; };
