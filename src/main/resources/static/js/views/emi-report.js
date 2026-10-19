/**
 * Reports › EMI analysis: is buying on EMI worth it? For each purchase on EMI (card or loan), against paying the
 * whole price on the day of purchase:
 *   cost      what the EMI adds on top of the price: interest, GST on the interest and the processing fee
 *             (a no-cost EMI usually has only the fee, or nothing at all)
 *   earned    the price kept in a savings account instead (6.5% a year by default, compounded monthly), paying
 *             each EMI out of it as it falls due: what is left in it after the last EMI
 *   net       earned − cost: what the EMI gains (or loses) against paying at once
 *   EMI rate  the EMI's true yearly cost (the rate at which its payments are worth the price); below the savings
 *             rate the EMI pays, above it paying at once is cheaper
 * The savings rate can be changed (it is remembered in this browser). Closed EMIs can be included.
 */
import { api } from '../core/api.js';
import { panel, table, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, monthLabel } from '../core/format.js';
import { barChart, lineChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';

/** The bars of the cost chart, with their colours (shared with the legend). */
const BAR_SERIES = [{ label: 'EMI cost', color: 'var(--series-2)' }, { label: 'Savings interest', color: 'var(--series-3)' }, { label: 'Net gain', color: 'var(--series-1)' }];
const DAY = 86400000;
const MONTH_DAYS = 365 / 12;
const days = (a, b) => (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY;

/**
 * The EMI against paying at once, with the price kept at `rate` (% a year) until each EMI is paid.
 * Payments are each EMI plus its GST, on its due date; the processing fee is paid on the purchase date.
 */
export function analysePlan(p, rate) {
    const price = Number(p.principal);
    const fee = Number(p.processingFee || 0);
    const start = p.purchaseDate;
    const pays = (p.installments || []).map(i => ({ date: i.dueDate, amount: Number(i.emi || 0) + Number(i.gst || 0), paid: i.status === 'PAID' }))
        .sort((a, b) => a.date.localeCompare(b.date));
    const interest = (p.installments || []).reduce((s, i) => s + Number(i.interest || 0), 0);
    const gst = (p.installments || []).reduce((s, i) => s + Number(i.gst || 0), 0);
    const cost = interest + gst + fee;

    // the price in a savings account: grows monthly, pays the fee at once and each EMI when due
    const monthly = rate / 100 / 12;
    let balance = price - fee, at = start, earned = 0;
    const path = [{ date: start, balance }];
    for (const pay of pays) {
        const grown = balance * (Math.pow(1 + monthly, Math.max(0, days(at, pay.date)) / MONTH_DAYS) - 1);
        earned += grown;
        balance += grown - pay.amount;
        at = pay.date;
        path.push({ date: pay.date, balance });
    }
    const net = balance;   // what is left once everything is paid: the gain of the EMI against paying at once

    // the EMI's own yearly rate: the monthly rate m at which the payments (and the fee) are worth the price
    const npv = m => fee + pays.reduce((s, x) => s + x.amount / Math.pow(1 + m, days(start, x.date) / MONTH_DAYS), 0) - price;
    let lo = -0.05, hi = 0.2;
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (npv(mid) > 0) lo = mid; else hi = mid; }
    const emiRate = (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;

    const paidSoFar = pays.filter(x => x.paid).reduce((s, x) => s + x.amount, 0);
    return { price, fee, interest, gst, cost, earned, net, emiRate, path, pays, paidSoFar,
        noCost: Number(p.ratePercent || 0) === 0, months: pays.length, monthlyPayment: pays.length ? pays[0].amount : 0 };
}

export async function emiReport(content, toolbar) {
    const prefs = getPref('emiReport', { rate: 6.5, closed: false });
    const book = await api.get('/expenses/emis', { closed: prefs.closed });
    const plans = (book.plans || []).filter(p => prefs.closed || p.status !== 'CLOSED');

    // the savings rate and the closed switch sit in the toolbar, before its export / print buttons
    toolbar.querySelector('.emi-controls')?.remove();
    toolbar.querySelector('.spacer')?.insertAdjacentHTML('afterend', `<span class="emi-controls">
        <label class="row small secondary" title="What the money would earn in a savings account, a year">Savings at
            <input type="number" id="emi-rate" min="0" max="20" step="0.1" value="${prefs.rate}" style="width:64px">%</label>
        <label class="switch sm"><input type="checkbox" id="emi-closed" ${prefs.closed ? 'checked' : ''}><span></span>Closed EMIs</label></span>`);
    const redraw = () => emiReport(content, toolbar);
    toolbar.querySelector('#emi-rate').addEventListener('change', e => { setPref('emiReport', { ...prefs, rate: Math.max(0, Number(e.target.value) || 0) }); redraw(); });
    toolbar.querySelector('#emi-closed').addEventListener('change', e => { setPref('emiReport', { ...prefs, closed: e.target.checked }); redraw(); });

    if (!plans.length) {
        content.innerHTML = emptyState('Nothing bought on EMI yet. Add a purchase on EMI in Expenses to see whether it pays.', 'calendar');
        return () => [];
    }
    const rows = plans.map(p => ({ p, a: analysePlan(p, prefs.rate) }));
    const sum = key => rows.reduce((s, r) => s + r.a[key], 0);
    const totalNet = sum('net');
    const winners = rows.filter(r => r.a.net > 0).length;
    const best = [...rows].sort((x, y) => y.a.net - x.a.net)[0];

    content.innerHTML = `
    <div class="emi-report">
        <div class="stat-cards emi-cards">
            ${card('cart', 'Bought on EMI', moneyShort(sum('price')), `${rows.length} purchase${rows.length === 1 ? '' : 's'} · ${rows.filter(r => r.a.noCost).length} no-cost`)}
            ${card('percent', 'EMI cost', moneyShort(sum('cost')), `interest ${moneyShort(sum('interest'))} · GST ${moneyShort(sum('gst'))} · fees ${moneyShort(sum('fee'))}`, sum('cost') ? 'warn' : 'good')}
            ${card('piggy', `Earned at ${percent(prefs.rate, 1)}`, `+${moneyShort(sum('earned'))}`, 'the price kept in savings till each EMI', 'good')}
            ${card(totalNet >= 0 ? 'trending' : 'trending-down', 'Net gain of EMI', `<span class="${totalNet >= 0 ? 'pos' : 'neg'}">${totalNet >= 0 ? '+' : '−'}${moneyShort(Math.abs(totalNet))}</span>`,
                `${winners} of ${rows.length} beat paying at once`, totalNet >= 0 ? 'good' : 'warn')}
            ${card('scale', 'Best deal', best ? esc(best.p.narration) : '—', best ? `${best.a.net >= 0 ? '+' : '−'}${moneyShort(Math.abs(best.a.net))} · EMI rate ${percent(best.a.emiRate, 1)}` : '')}
        </div>
        <div class="emi-charts">
            ${panel({ title: 'Cost against earnings', iconName: 'report', sub: 'each purchase', bodyClass: 'chart',
                body: `<div class="chart-wrap">${legend(BAR_SERIES)}<div class="chart" id="emi-bars"></div></div>` })}
            ${panel({ title: 'The money kept in savings', iconName: 'trending', sub: esc(best?.p.narration || ''), bodyClass: 'chart',
                body: `<div class="chart-wrap"><div class="chart" id="emi-path"></div></div>` })}
        </div>
        ${panel({ title: 'Every EMI', iconName: 'list', bodyClass: 'flush',
            body: `<div class="scroll">${table([
                { label: 'Purchase', render: r => `<b>${esc(r.p.narration)}</b><div class="small muted">${esc(r.p.kind === 'CARD' ? r.p.payAccountName || 'Card' : r.p.lender || 'Loan')} · ${date(r.p.purchaseDate)}${r.a.noCost ? ' · <span class="badge good">No-cost</span>' : ''}</div>` },
                { label: 'Price', align: 'r', render: r => money(r.a.price) },
                { label: 'EMIs', align: 'r', render: r => `${r.a.months} × ${moneyShort(r.a.monthlyPayment)}<div class="small muted">${r.p.paidCount} paid · ${r.p.left} left</div>` },
                { label: 'Rate', align: 'r', render: r => `${percent(Number(r.p.ratePercent || 0), 1)}<div class="small muted">true ${percent(r.a.emiRate, 1)}</div>` },
                { label: 'EMI cost', align: 'r', render: r => `<span class="${r.a.cost ? 'neg' : ''}">${money(Math.round(r.a.cost))}</span><div class="small muted">fee ${moneyShort(r.a.fee)}</div>` },
                { label: `Savings at ${percent(prefs.rate, 1)}`, align: 'r', render: r => `<span class="pos">+${money(Math.round(r.a.earned))}</span>` },
                { label: 'Net gain', align: 'r', render: r => `<b class="${r.a.net >= 0 ? 'pos' : 'neg'}">${r.a.net >= 0 ? '+' : '−'}${money(Math.round(Math.abs(r.a.net)))}</b>` },
                { label: 'Verdict', render: r => verdict(r.a, prefs.rate) },
            ], rows)}</div>`,
        })}
        <p class="emi-how">${icon('info')} Against paying the whole price on the day of purchase: the price stays in a savings account at ${percent(prefs.rate, 1)} a year
            (compounded monthly) and pays the processing fee at once and each EMI (with its GST) when it falls due. What is left after the last EMI is the gain.
            The true rate is the EMI's own yearly cost; while it is below the savings rate the EMI pays.</p>
    </div>`;

    const labels = rows.map(r => r.p.narration);
    barChart(content.querySelector('#emi-bars'), { labels, format: moneyShort, labelFormat: l => (l.length > 14 ? l.slice(0, 13) + '…' : l),
        series: [rows.map(r => Math.round(r.a.cost)), rows.map(r => Math.round(r.a.earned)), rows.map(r => Math.round(r.a.net))]
            .map((values, k) => ({ name: BAR_SERIES[k].label, values, color: BAR_SERIES[k].color })) });
    if (best) {
        const path = best.a.path.filter((x, i, l) => i === 0 || x.date.slice(0, 7) !== l[i - 1].date.slice(0, 7));
        lineChart(content.querySelector('#emi-path'), { labels: path.map(x => x.date.slice(0, 7)), labelFormat: monthLabel, format: moneyShort, area: true, includeZero: true,
            series: [{ name: 'In savings', values: path.map(x => Math.round(x.balance)) }] });
    }

    return () => [
        ['Purchase', 'Purchase date', 'Price', 'EMIs', 'Monthly', 'Rate %', 'True rate %', 'Interest', 'GST', 'Fee', 'EMI cost', `Savings interest at ${prefs.rate}%`, 'Net gain'],
        ...rows.map(r => [r.p.narration, r.p.purchaseDate, r.a.price, r.a.months, Math.round(r.a.monthlyPayment), Number(r.p.ratePercent || 0),
            Math.round(r.a.emiRate * 100) / 100, Math.round(r.a.interest), Math.round(r.a.gst), r.a.fee, Math.round(r.a.cost),
            Math.round(r.a.earned), Math.round(r.a.net)]),
    ];
}

function card(iconName, label, value, sub, cls = '') {
    return `<div class="ov-card ${cls}"><span class="ov-ico">${icon(iconName)}</span>
        <div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small></div></div>`;
}

function verdict(a, rate) {
    if (a.net > 0 && a.emiRate < rate) return `<span class="badge good">${icon('check')}EMI pays</span><div class="small muted">${percent(rate - a.emiRate, 1)} under savings</div>`;
    if (Math.abs(a.net) < 1) return '<span class="badge gray">Even</span>';
    return `<span class="badge warning">${icon('alert')}Paying at once is cheaper</span><div class="small muted">EMI costs ${percent(a.emiRate - rate, 1)} more</div>`;
}
