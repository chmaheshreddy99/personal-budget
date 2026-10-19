/**
 * Forecast → Chit outlook (#/forecast/chits): where every chit is headed.
 *   - the totals: expected gain on running chits, gain already realised, interest the portfolio earns per month
 *     right now, what still has to be paid and what comes back
 *   - the maturity runway: each chit as a bar from its start to its maturity, today marked, paid share filled,
 *     the distance to maturity in months and days
 *   - the portfolio value month by month (paid in vs value with interest) and dues against payouts
 *   - chit by chit: gain at maturity, gain per remaining month, and "wait or lift": the yearly return you earn by
 *     holding to maturity instead of lifting the prize today (IRR of: give up the take-home value now, pay the
 *     remaining installments, receive the maturity amount), with a plain recommendation
 *   - gains by year of maturity
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, monthLabel } from '../core/format.js';
import { lineChart, barChart, legend } from '../core/charts.js';
import { exportButton, bindExport } from '../core/export.js';
import { chitReturns, takeHomeNow } from './chits.js';

const FD_RATE = 7;   // the yardstick for "is waiting worth it"

export async function renderChitOutlook(body, toolbar) {
    const chits = await api.get('/chits');
    const running = chits.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && c.payoutAmount === null);
    if (!chits.length) { body.innerHTML = emptyState('No chits yet. Add one on the Chits page.', 'chit'); return; }
    const details = new Map((await Promise.all(chits.map(c => api.get(`/chits/${c.id}`)))).map(d => [d.chit.id, d]));
    const today = isoDate();

    const items = chits.map(c => analyse(c, details.get(c.id)));
    const open = items.filter(x => running.includes(x.c));
    const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
    const expected = sum(open, x => x.gain);
    const realised = sum(items.filter(x => x.c.realizedGain !== null), x => Number(x.c.realizedGain));
    const perMonthNow = sum(open, x => x.interestPerMonth);
    const stillToPay = sum(open, x => Number(x.c.stillToPay));
    const toReceive = sum(open, x => Number(x.c.maturityAmount));
    const nextMaturity = [...open].sort((a, b) => a.c.maturityDate.localeCompare(b.c.maturityDate))[0];
    const lastMaturity = [...open].sort((a, b) => b.c.maturityDate.localeCompare(a.c.maturityDate))[0];
    const span = runwaySpan(items);

    body.className = 'forecast-body chit-outlook';
    body.innerHTML = `
        <section class="co-kpis">
            ${kpi('sparkles', 'Expected gain', `<span class="pos">${money(Math.round(expected))}</span>`, `${open.length} running chit${open.length === 1 ? '' : 's'} at maturity`, 'hero')}
            ${kpi('check-circle', 'Realised so far', `<span class="${realised >= 0 ? 'pos' : 'neg'}">${money(Math.round(realised))}</span>`, 'payouts received')}
            ${kpi('trending', 'Earning now', `${money(Math.round(perMonthNow))}<small>/mo</small>`, 'interest the paid-in money earns')}
            ${kpi('hourglass', 'Still to pay', money(stillToPay), `${sum(open, x => x.c.installmentsPending)} installments`)}
            ${kpi('gift', 'Comes back', money(toReceive), lastMaturity ? `last on ${shortDate(lastMaturity.c.maturityDate)}` : '')}
            ${kpi('flag', 'Next maturity', nextMaturity ? distance(nextMaturity.c.maturityDate) : '—', nextMaturity ? `${esc(nextMaturity.c.name)} · ${moneyShort(nextMaturity.c.maturityAmount)}` : 'none running')}
        </section>

        ${panel({ title: 'Maturity runway', iconName: 'timeline', cls: 'co-runway-panel', bodyClass: 'flush',
            sub: `${date(span.from)} → ${date(span.to)}`, actions: exportButton({ label: '' }),
            body: runwayHtml(items, span, today) })}

        <div class="co-charts">
            ${panel({ title: 'Portfolio value', iconName: 'trending', cls: 'co-chart', bodyClass: 'chart',
                actions: legend([{ label: 'Paid in' }, { label: 'Value with interest' }]), body: '<div class="chart" id="co-value"></div>' })}
            ${panel({ title: 'Dues and payouts by month', iconName: 'calendar', cls: 'co-chart', bodyClass: 'chart',
                actions: legend([{ label: 'Installments due', color: 'var(--series-4)' }, { label: 'Maturity payouts', color: 'var(--series-3)' }]), body: '<div class="chart" id="co-flow"></div>' })}
        </div>

        ${panel({ title: 'Wait or lift · chit by chit', iconName: 'scale', cls: 'co-cards-panel', bodyClass: 'flush',
            sub: `holding is compared with a ${FD_RATE}% fixed deposit`,
            body: `<div class="co-cards">${open.map(cardHtml).join('') || emptyState('No running chits', 'chit')}</div>` })}

        <div class="co-bottom">
            ${panel({ title: 'Gains by year of maturity', iconName: 'calendar', cls: 'co-years', bodyClass: 'flush', body: yearsHtml(open) })}
            ${panel({ title: 'What the outlook says', iconName: 'bulb', cls: 'co-insights', body: insightsHtml(open, items, { expected, perMonthNow, stillToPay }) })}
        </div>`;

    drawCharts(body, items, span);
    bindExport(body.querySelector('.co-runway-panel'), () => ({
        title: 'Chit outlook', subtitle: `${open.length} running chits · expected gain ${money(Math.round(expected))}`, filename: `chit-outlook-${today}`,
        summary: [['Expected gain', Math.round(expected)], ['Realised so far', Math.round(realised)], ['Earning now / month', Math.round(perMonthNow)],
            ['Still to pay', stillToPay], ['Comes back', toReceive]],
        sheets: [{ name: 'Chits', columns: [{ label: 'Chit' }, { label: 'Maturity', type: 'date' }, { label: 'Months left', type: 'number' }, { label: 'Term passed', type: 'percent' },
            { label: 'Paid in', type: 'money' }, { label: 'Still to pay', type: 'money' }, { label: 'Maturity amount', type: 'money' }, { label: 'Expected gain', type: 'money' },
            { label: 'Take home now', type: 'money' }, { label: 'Return for waiting % / yr', type: 'percent' }, { label: 'Advice' }],
            rows: open.map(x => [x.c.name, x.c.maturityDate, Math.round(x.monthsLeft), x.termPct, Number(x.c.paidIn), Number(x.c.stillToPay), Number(x.c.maturityAmount),
                Math.round(x.gain), x.lift ? x.lift.prize : '', x.waitRate ?? '', x.advice.label]) }],
    }));
}

// ===================================================================== analysis

function analyse(c, detail) {
    const lift = takeHomeNow(c);
    const monthsLeft = c.payoutAmount === null ? Math.max(0, monthsBetween(isoDate(), c.maturityDate)) : 0;
    const termMonths = Math.max(1, monthsBetween(c.startDate, c.maturityDate));
    const termPct = Math.min(100, Math.max(0, ((termMonths - monthsLeft) / termMonths) * 100));
    const gain = c.payoutAmount !== null ? Number(c.realizedGain) : Number(c.projectedNetGain);
    const interestPerMonth = Number(c.currentValue || c.paidIn) * Number(c.rateUsed || 0) / 1200;
    const pending = detail.installments.filter(i => i.status !== 'PAID');
    // waiting instead of lifting: give up the take-home value today, pay what is still due, get the maturity amount
    let waitRate = null;
    if (lift && monthsLeft > 0.5) {
        const flows = [-lift.prize];
        const months = Math.max(1, Math.round(monthsLeft));
        for (let m = 0; m < months; m++) flows.push(0);
        pending.forEach(i => {
            const k = Math.min(months, Math.max(0, Math.round(monthsBetween(isoDate(), i.dueDate))));
            flows[k] -= Number(i.dueAmount);
        });
        flows[months] += Number(c.maturityAmount);
        const r = irr(flows);
        waitRate = r === null ? null : (Math.pow(1 + r, 12) - 1) * 100;
    }
    const advice = waitRate === null ? { tone: 'info', label: c.status === 'PRIZED' ? 'Prized: keep paying the dues' : 'Hold to maturity', iconName: 'info' }
        : waitRate >= FD_RATE + 2 ? { tone: 'good', label: 'Hold: waiting pays well', iconName: 'check-circle' }
        : waitRate >= FD_RATE ? { tone: 'info', label: 'Hold: about an FD', iconName: 'scale' }
        : { tone: 'warn', label: 'Lifting is worth a look', iconName: 'alert' };
    return { c, detail, lift, monthsLeft, termPct, gain, interestPerMonth, waitRate, advice,
        gainPerMonthLeft: monthsLeft >= 1 && lift ? lift.waitGain / monthsLeft : null };
}

/** Monthly internal rate of return of a series of monthly cash flows (bisection), or null. */
function irr(flows) {
    const npv = r => flows.reduce((s, f, k) => s + f / Math.pow(1 + r, k), 0);
    let lo = -0.9, hi = 1;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}

function monthsBetween(a, b) {
    const x = new Date(a + 'T00:00:00'), y = new Date(b + 'T00:00:00');
    return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) + (y.getDate() - x.getDate()) / 30;
}

function distance(iso) {
    const days = Math.round((new Date(iso + 'T00:00:00') - new Date(isoDate() + 'T00:00:00')) / 86400000);
    if (days < 0) return 'matured';
    const months = Math.floor(days / 30.44);
    return months >= 1 ? `${months} mo <small>${days % 30 ? `· ${days} days` : ''}</small>` : `${days} days`;
}

function runwaySpan(items) {
    const starts = items.map(x => x.c.startDate).sort();
    const ends = items.map(x => x.c.payoutDate && x.c.payoutDate > x.c.maturityDate ? x.c.payoutDate : x.c.maturityDate).sort();
    return { from: starts[0], to: ends[ends.length - 1] };
}

// ===================================================================== pieces

function kpi(iconName, label, value, note, cls = '') {
    return `<div class="co-kpi ${cls}"><span class="co-kpi-icon">${icon(iconName)}</span>
        <div class="min-0"><small>${label}</small><b>${value}</b><span>${note}</span></div></div>`;
}

function runwayHtml(items, span, today) {
    const t0 = new Date(span.from + 'T00:00:00').getTime(), t1 = new Date(span.to + 'T00:00:00').getTime();
    const pos = iso => ((new Date(iso + 'T00:00:00').getTime() - t0) / Math.max(1, t1 - t0)) * 100;
    const years = [];
    for (let y = Number(span.from.slice(0, 4)) + 1; y <= Number(span.to.slice(0, 4)); y++) years.push(y);
    const sorted = [...items].sort((a, b) => (a.c.payoutAmount !== null) - (b.c.payoutAmount !== null) || a.c.maturityDate.localeCompare(b.c.maturityDate));
    return `<div class="co-runway">
        <div class="co-axis">${years.map(y => `<span style="left:${pos(`${y}-01-01`)}%">${y}</span>`).join('')}
            <span class="co-today-label" style="left:${pos(today)}%">Today</span></div>
        ${sorted.map(x => {
            const c = x.c;
            const start = pos(c.startDate), end = pos(c.maturityDate);
            const done = c.payoutAmount !== null;
            return `<div class="co-lane ${done ? 'done' : ''}">
                <div class="co-name"><b class="ellipsis">${esc(c.name)}</b><small>${done ? `paid out ${shortDate(c.payoutDate)}` : x.monthsLeft < 0.5 ? 'matures now' : `${Math.round(x.monthsLeft)} mo to go`}</small></div>
                <div class="co-track">
                    ${years.map(y => `<i class="co-grid" style="left:${pos(`${y}-01-01`)}%"></i>`).join('')}
                    <i class="co-today" style="left:${pos(today)}%"></i>
                    <span class="co-bar" style="left:${start}%;width:${Math.max(1, end - start)}%" title="${esc(c.name)}: ${date(c.startDate)} → ${date(c.maturityDate)}">
                        <em style="width:${(Number(c.paidIn) / (Number(c.totalContribution) || 1)) * 100}%"></em>
                        <span class="co-bar-label">${c.installmentsPaid}/${c.numberOfInstallments}</span></span>
                    ${c.payoutDate ? `<span class="co-pin" style="left:${pos(c.payoutDate)}%" title="Payout ${money(c.payoutAmount)} on ${date(c.payoutDate)}">${icon('gift')}</span>` : ''}
                    <span class="co-end" style="left:${end}%" title="Maturity ${date(c.maturityDate)}">${icon('flag')}</span>
                </div>
                <div class="co-dist">${done ? `<b class="${x.gain >= 0 ? 'pos' : 'neg'}">${x.gain >= 0 ? '+' : '−'}${moneyShort(Math.abs(x.gain))}</b><small>realised</small>`
                    : `<b>${moneyShort(c.maturityAmount)}</b><small>${shortDate(c.maturityDate)} · <span class="pos">+${moneyShort(x.gain)}</span></small>`}</div>
            </div>`;
        }).join('')}
    </div>`;
}

function cardHtml(x) {
    const c = x.c, r = chitReturns(c);
    const ring = `conic-gradient(var(--ocean-500) ${x.termPct * 3.6}deg, rgba(10, 79, 128, 0.1) 0)`;
    return `<div class="co-card ${x.advice.tone}">
        <div class="co-card-head">
            <span class="co-ring" style="background:${ring}" title="${percent(x.termPct, 0)} of the term passed"><span>${Math.round(x.monthsLeft)}<small>mo</small></span></span>
            <div class="min-0 grow"><b class="ellipsis">${esc(c.name)}</b><small>${esc(c.organizer || '')} · matures ${date(c.maturityDate)}</small></div>
            <span class="co-advice ${x.advice.tone}">${icon(x.advice.iconName)}${x.advice.label}</span>
        </div>
        <div class="co-figs">
            <div><small>Gain at maturity</small><b class="pos">${money(Math.round(x.gain))}</b><span>${percent(r.compound, 1)} a year</span></div>
            <div><small>Take home now</small><b class="gold-ink">${x.lift ? money(x.lift.prize) : '—'}</b><span>${x.lift ? 'paid in + interest' : 'prize taken'}</span></div>
            <div><small>Waiting adds</small><b>${x.lift ? money(x.lift.waitGain) : '—'}</b><span>${x.gainPerMonthLeft !== null ? `${money(Math.round(x.gainPerMonthLeft))} per month left` : ''}</span></div>
            <div><small>Return for waiting</small><b class="${x.waitRate === null ? '' : x.waitRate >= FD_RATE ? 'pos' : 'neg'}">${x.waitRate === null ? '—' : `${percent(x.waitRate, 1)}`}</b><span>${x.waitRate === null ? '' : `vs ${FD_RATE}% FD`}</span></div>
        </div>
        <div class="co-why">${icon('info')}${esc(why(x))}</div>
    </div>`;
}

function why(x) {
    const c = x.c;
    if (!x.lift) return c.status === 'PRIZED'
        ? `The prize is taken; ${money(c.stillToPay)} of installments remain until ${shortDate(c.endDate)}.`
        : `Hold to maturity on ${date(c.maturityDate)} for ${money(c.maturityAmount)}.`;
    if (x.waitRate === null) return `Matures now: about ${money(c.maturityAmount)} is due.`;
    return `Lifting now gives about ${money(x.lift.prize)}. Holding ${Math.round(x.monthsLeft)} more months and paying ${money(c.stillToPay)} returns ${money(c.maturityAmount)}: `
        + `${percent(x.waitRate, 1)} a year on that commitment${x.waitRate >= FD_RATE ? `, better than a ${FD_RATE}% FD.` : `, below a ${FD_RATE}% FD; lift if you need the money.`}`;
}

function yearsHtml(open) {
    if (!open.length) return emptyState('Nothing maturing', 'calendar');
    const years = new Map();
    open.forEach(x => {
        const y = x.c.maturityDate.slice(0, 4);
        const v = years.get(y) || { count: 0, amount: 0, gain: 0 };
        years.set(y, { count: v.count + 1, amount: v.amount + Number(x.c.maturityAmount), gain: v.gain + x.gain });
    });
    const max = Math.max(...[...years.values()].map(v => v.amount)) || 1;
    return `<table class="grid compact"><thead><tr><th>Year</th><th class="c">Chits</th><th>Comes back</th><th class="r">Gain</th></tr></thead>
        <tbody>${[...years.entries()].sort().map(([y, v]) => `<tr><td><b>${y}</b></td><td class="c">${v.count}</td>
            <td><span class="co-ybar"><i style="width:${(v.amount / max) * 100}%"></i></span> ${money(v.amount)}</td>
            <td class="r pos">${money(Math.round(v.gain))}</td></tr>`).join('')}</tbody></table>`;
}

function insightsHtml(open, items, t) {
    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    if (!open.length) return emptyState('No running chits', 'chit');
    const best = [...open].sort((a, b) => chitReturns(b.c).compound - chitReturns(a.c).compound)[0];
    const weakest = [...open].filter(x => x.waitRate !== null).sort((a, b) => a.waitRate - b.waitRate)[0];
    tip('good', 'sparkles', `Your running chits are set to gain <b>${money(Math.round(t.expected))}</b>; right now the money paid in earns about <b>${money(Math.round(t.perMonthNow))}</b> a month.`);
    if (best) tip('info', 'trending', `<b>${esc(best.c.name)}</b> has the best return at ${percent(chitReturns(best.c).compound, 1)} a year.`);
    if (weakest && weakest.waitRate < FD_RATE) tip('warn', 'alert', `<b>${esc(weakest.c.name)}</b> returns only ${percent(weakest.waitRate, 1)} a year for waiting; lifting it early costs little if you need cash.`);
    const heavy = open.filter(x => x.monthsLeft <= 3);
    if (heavy.length) tip('info', 'gift', `${heavy.length} chit${heavy.length === 1 ? '' : 's'} mature${heavy.length === 1 ? 's' : ''} within 3 months: ${heavy.map(x => `${esc(x.c.name)} (${moneyShort(x.c.maturityAmount)})`).join(', ')}. Plan where that money goes.`);
    const monthly = open.reduce((s, x) => s + Number(x.c.monthlyInstallment), 0);
    tip('info', 'calendar', `Installments take <b>${money(monthly)}</b> a month until ${shortDate([...open].sort((a, b) => b.c.endDate.localeCompare(a.c.endDate))[0].c.endDate)}; ${money(t.stillToPay)} in all.`);
    const overdue = open.filter(x => Number(x.c.overdueAmount));
    if (overdue.length) tip('bad', 'alert', `${money(overdue.reduce((s, x) => s + Number(x.c.overdueAmount), 0))} is overdue on ${overdue.map(x => esc(x.c.name)).join(', ')}.`);
    return `<div class="insights">${tips.join('')}</div>`;
}

function drawCharts(body, items, span) {
    // month by month from the first start to the last maturity: paid in so far and the value with interest
    const months = [];
    for (let d = new Date(span.from.slice(0, 7) + '-01T00:00:00'); isoDate(d).slice(0, 7) <= span.to.slice(0, 7); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        months.push(isoDate(d).slice(0, 7));
    }
    const paid = months.map(m => items.reduce((s, x) => {
        if (x.c.payoutDate && x.c.payoutDate.slice(0, 7) < m) return s;
        return s + x.detail.installments.filter(i => i.dueDate.slice(0, 7) <= m).reduce((a, i) => a + Number(i.dueAmount), 0);
    }, 0));
    const value = months.map(m => items.reduce((s, x) => {
        if (x.c.payoutDate && x.c.payoutDate.slice(0, 7) < m) return s;
        const rows = x.detail.interestSchedule.filter(r => r.interestDate.slice(0, 7) <= m);
        return s + (rows.length ? Number(rows[rows.length - 1].closingBalance) : 0);
    }, 0));
    lineChart(body.querySelector('#co-value'), { labels: months, labelFormat: monthLabel, format: moneyShort, area: true,
        series: [{ name: 'Paid in', values: paid }, { name: 'Value with interest', values: value }] });
    const ahead = months.filter(m => m >= isoDate().slice(0, 7));
    const dues = ahead.map(m => items.reduce((s, x) => s + x.detail.installments.filter(i => i.status !== 'PAID' && i.dueDate.slice(0, 7) === m).reduce((a, i) => a + Number(i.dueAmount), 0), 0));
    const payouts = ahead.map(m => items.filter(x => x.c.payoutAmount === null && x.c.maturityDate.slice(0, 7) === m).reduce((s, x) => s + Number(x.c.maturityAmount), 0));
    barChart(body.querySelector('#co-flow'), { labels: ahead, labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Installments due', values: dues, color: 'var(--series-4)' }, { name: 'Maturity payouts', values: payouts, color: 'var(--series-3)' }] });
}
