/**
 * Reports › Investment plan: where the money that comes in should go, worked out from the income actually received and the money already in
 * the banks (InvestmentAdviceService). The page opens on a financial-fitness score out of 100 (saving, safety net, debt, investing, income
 * stability) and four tabs:
 *
 *   Plan             the steps in order, each with its monthly amount; the mix with what to move to reach it; the instruments
 *   Banks & cash     the emergency fund, the idle money above it and what it loses a year against a deposit, every account's yield
 *   Growth & risk    the mix's expected return, risk and 1-in-20 bad year; where 4,000 simulated paths end (a fan of the 10th, 50th and 90th
 *                    percentile), and what an extra amount a month would add
 *   Goal             with a target: the monthly amount that reaches it on average and to be 80% sure, and the chance at the plan's amount
 *
 * A planning aid on rules of thumb and a model, not advice from a registered adviser. Every tab fits the screen: the page does not scroll,
 * a tile whose content is longer scrolls inside itself.
 */
import { api } from '../core/api.js';
import { readQuery, setQuery } from '../core/route.js';
import { panel, table, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { donutChart, lineChart, seriesColor, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';

const num = v => Number(v || 0);
const STATUS = { now: ['warning', 'Do now'], done: ['good', 'Done'], monthly: ['good', 'Every month'], check: ['gray', 'Check'], habit: ['gray', 'Habit'] };
const TABS = [['plan', 'Plan', 'list'], ['mix', 'The mix', 'pie'], ['banks', 'Banks & cash', 'bank'], ['growth', 'Growth & risk', 'trending'], ['goal', 'Goal', 'flag'], ['notes', 'Notes', 'info']];
const ui = { tab: 'plan' };
const fv = (monthly, yearly, years) => { const i = yearly / 1200, n = years * 12; return i === 0 ? monthly * n : monthly * (Math.pow(1 + i, n) - 1) / i * (1 + i); };

export async function investmentPlan(content, toolbar) {
    const p = { age: 30, risk: 'balanced', horizon: 10, goal: '', alt: 7, ...getPref('investPlan', {}) };
    content.className = 'report-content da-page';
    const controls = `<div class="ip-controls">
        <label><span>Your age</span><input type="number" id="ip-age" min="18" max="80" value="${p.age}"></label>
        <label><span>Risk appetite</span><select id="ip-risk">${[['conservative', 'Conservative: sleep well'], ['balanced', 'Balanced'], ['growth', 'Growth: accept big swings']]
            .map(([v, l]) => `<option value="${v}" ${p.risk === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><span>Horizon (years)</span><input type="number" id="ip-horizon" min="1" max="40" value="${p.horizon}"></label>
        <label><span>A goal ₹ <small>optional</small></span><input type="number" id="ip-goal" min="0" step="10000" value="${p.goal}" placeholder="e.g. 5000000"></label>
        <label><span>Deposit rate %</span><input type="number" id="ip-alt" min="0" max="15" step="0.1" value="${p.alt}"></label></div>`;
    const bind = () => {
        const save = () => { setPref('investPlan', { age: Number(content.querySelector('#ip-age').value) || 30, risk: content.querySelector('#ip-risk').value,
            horizon: Number(content.querySelector('#ip-horizon').value) || 10, goal: content.querySelector('#ip-goal').value, alt: Number(content.querySelector('#ip-alt').value) || 7 }); investmentPlan(content, toolbar); };
        content.querySelectorAll('.ip-controls input, .ip-controls select').forEach(el => el.addEventListener('change', save));
    };
    let r;
    try {
        r = await api.get('/reports/investment-plan', { age: p.age, risk: p.risk, horizon: p.horizon, goal: p.goal || undefined, alt: p.alt });
    } catch (e) {
        content.innerHTML = controls + panel({ title: 'Investment plan', iconName: 'piggy', body: emptyState(`The plan could not be made: ${e.message}`, 'alert') });
        bind();
        return () => [];
    }
    if (!r.enough) {
        content.innerHTML = controls + panel({ title: 'Investment plan', iconName: 'piggy', body: emptyState(r.message, 'piggy') });
        bind();
        return () => [];
    }
    try {
        return draw(content, r, controls, bind, p);
    } catch (e) {
        console.error(e);
        content.innerHTML = controls + panel({ title: 'Investment plan', iconName: 'piggy', body: emptyState(`The page could not be drawn: ${e.message}`, 'alert') });
        bind();
        return () => [];
    }
}

function ring(score, grade, label, size = 104) {
    const tone = score >= 70 ? '#12a150' : score >= 55 ? '#d9a21b' : score >= 40 ? '#e07b22' : '#d23b3b';
    const rad = 52, c = 2 * Math.PI * rad, on = c * Math.max(0, Math.min(100, score)) / 100;
    return `<div class="da-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${rad}" fill="none" stroke="rgba(120,140,160,.18)" stroke-width="10"/>
        <circle cx="60" cy="60" r="${rad}" fill="none" stroke="${tone}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${on} ${c}" transform="rotate(-90 60 60)"/></svg>
        <div><b style="color:${tone}">${Math.round(score)}</b><small>${esc(label)}</small><em>Grade ${esc(grade)}</em></div></div>`;
}
const bar = score => `<i class="da-bar ${score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'weak' : 'bad'}"><em style="width:${Math.max(3, Math.min(100, score))}%"></em></i>`;
const head = (iconName, label, value, sub, cls = '') => `<div class="da-head ${cls}"><span class="da-hi">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><em>${sub}</em></div></div>`;

function draw(content, r, controls, bind, p) {
    const pr = r.profile, b = r.banks, k = r.risk, fit = r.fitness;
    const charts = [];

    const hero = `<div class="da-hero">${ring(fit.score, fit.grade, fit.label)}<div class="da-heads">
        ${head('arrow-in', 'Income a month', moneyShort(pr.income), `steady to ±${percent(pr.incomeCv * 100, 0)} · ${pr.months} full months`, pr.incomeCv < 0.15 ? 'good' : '')}
        ${head('piggy', 'Surplus', `<span class="${pr.surplus >= 0 ? 'pos' : 'neg'}">${moneyShort(pr.surplus)}</span>`, `${num(pr.savingsRate).toFixed(0)}% kept · ${moneyShort(pr.prudentSurplus)} in a poor month`, pr.savingsRate >= 20 ? 'good' : 'warn')}
        ${head('shield', 'Safety net', `${pr.spending ? (pr.liquid / pr.spending).toFixed(1) : '—'} months`, `target ${pr.emergencyMonths} · ${pr.emergencyGap > 0 ? moneyShort(pr.emergencyGap) + ' short' : 'covered'}`, pr.emergencyGap > 0 ? 'warn' : 'good')}
        ${head('bank', 'In the banks', moneyShort(b.liquid), `earning ${b.averageYield}% · ${moneyShort(b.yearlyInterest)} a year`)}
        ${head('trending', 'To invest a month', moneyShort(r.toInvest), `${moneyShort(r.toEmergency)} to the safety net · mix returns ${r.blendedReturn}%`, 'good')}
        ${num(r.movesGain) > 0 ? head('transfer', 'Moving money adds', `<span class="pos">+${moneyShort(r.movesGain)}</span>`, `a year, from ${(r.moves || []).length} transfer${(r.moves || []).length === 1 ? '' : 's'} · Banks & cash`, 'good') : ''}
    </div></div>`;
    const tabs = `<div class="da-tabs">${TABS.map(([key, l, ic]) => `<button class="da-tab ${ui.tab === key ? 'active' : ''}" data-ip-tab="${key}">${icon(ic)}${l}</button>`).join('')}</div>`;

    // ------------------------------------------------------------ Plan: how fit, and the steps
    const planTab = () => `<div class="fit-grid ip-g-plan">
        ${panel({ title: 'How fit is your money?', iconName: 'shield', cls: 'da-tile g-a', bodyClass: 'tile-scroll', sub: `${Math.round(fit.score)}/100 · ${esc(fit.label)}`, body: `<div class="da-parts one">${fit.parts.map(x => `
            <div class="da-part"><div class="da-part-head"><b>${esc(x.name)}</b><span>${Math.round(x.score)}<small>/100 · ${Math.round(x.weight * 100)}%</small></span></div>${bar(x.score)}<p>${esc(x.reading)}</p></div>`).join('')}</div>` })}
        ${panel({ title: 'Your steps, in order', iconName: 'list', cls: 'da-tile g-b', bodyClass: 'flush tile-scroll', sub: `${r.steps.filter(x => x.status === 'now').length} to do now`, body: `<div class="ip-steps">${r.steps.map(x => `
            <div class="ip-step ${x.status}"><span class="ip-no">${x.order}</span><div class="min-0 grow"><b>${esc(x.title)}</b><p>${esc(x.detail)}</p></div>
                <div class="ip-amt">${x.monthly > 0 ? `<b>${money(Math.round(x.monthly))}</b><small>a month</small>` : ''}<span class="badge ${STATUS[x.status]?.[0] || 'gray'}">${STATUS[x.status]?.[1] || x.status}</span></div></div>`).join('')}</div>` })}
    </div>`;

    // ------------------------------------------------------------ The mix: the donut, what to move, where each part goes
    const mixTab = () => {
        charts.push(() => {
            donutChart(content.querySelector('#ip-donut'), { items: r.allocation.map(x => ({ label: x.name, value: x.percent })), format: v => `${v}%`, centerValue: `${r.blendedReturn}%`, centerLabel: 'blended' });
            content.querySelector('#ip-legend').innerHTML = r.allocation.map((x, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                <span class="ellipsis">${esc(x.name)} ${x.percent}%</span><b>${moneyShort(x.monthly)}</b></div>`).join('');
        });
        return `<div class="fit-grid ip-g-mix">
            ${panel({ title: 'The mix', iconName: 'pie', cls: 'da-tile g-a', bodyClass: 'da-donut-body', sub: `${esc(pr.risk)} · age ${pr.age} · ${pr.horizonYears} years`, body: '<div class="chart" id="ip-donut"></div><div class="da-ov-legend" id="ip-legend"></div>' })}
            ${r.rebalance.length ? panel({ title: 'Bring what you hold to the mix', iconName: 'scale', cls: 'da-tile g-b', bodyClass: 'flush tile-scroll', sub: 'equity, debt and gold you hold today', body: `${table([
                { label: 'Part', render: x => `<b>${esc(x.name)}</b>` }, { label: 'Held', align: 'r', render: x => `${moneyShort(x.current)} <span class="small muted">${num(x.currentPercent).toFixed(0)}%</span>` },
                { label: 'Target', align: 'r', render: x => `${moneyShort(x.target)} <span class="small muted">${x.targetPercent}%</span>` },
                { label: 'Move', align: 'r', render: x => `<b class="${x.move >= 0 ? 'pos' : 'neg'}">${x.move >= 0 ? 'Add ' : 'Hold back '}${moneyShort(Math.abs(x.move))}</b>` },
            ], r.rebalance, { compact: true, dense: true })}<p class="small muted ip-pad">Direct new money to the parts marked "Add" rather than selling: it avoids tax and costs.</p>` })
                : panel({ title: 'Bring what you hold to the mix', iconName: 'scale', cls: 'da-tile g-b', bodyClass: 'tile-scroll', body: '<p class="small muted ip-pad">You hold no equity, debt or gold yet, so the whole monthly amount goes by the mix.</p>' })}
            ${panel({ title: 'Where each part goes', iconName: 'layers', cls: 'da-tile g-c', bodyClass: 'flush tile-scroll', sub: `${money(Math.round(r.toInvest))} a month`, body: table([
                { label: 'Part', render: x => `<b>${esc(x.name)}</b>` }, { label: 'Share', align: 'r', render: x => percent(x.percent, 0) },
                { label: 'A month', align: 'r', render: x => `<b>${money(Math.round(x.monthly))}</b>` },
                { label: 'Return · risk', align: 'r', render: x => `${x.expectedReturn}% · ±${x.volatility}%` },
                { label: 'Instruments', render: x => `<span class="small">${esc(x.instruments)}</span>` },
            ], r.allocation, { compact: true, dense: true }) })}
        </div>`;
    };

    // ------------------------------------------------------------ the move plan: each transfer, what it adds, and the year before and after
    const moves = r.moves || [];
    const movePlan = () => {
        if (!moves.length) return panel({ title: 'Move money to where it earns more', iconName: 'transfer', body: `<p class="small muted ip-pad">${icon('check-circle')} Every account already earns close to the best rate you have: nothing to move.</p>` });
        const now = num(b.yearlyInterest), after = now + num(r.movesGain), top = Math.max(1, after);
        return panel({ title: 'Move money to where it earns more', iconName: 'transfer', cls: 'ip-moves', sub: 'between your own accounts · the safety net stays liquid',
            actions: `<button type="button" class="btn xs" data-ip-copy>${icon('copy')}Copy plan</button>`,
            body: `<div class="ip-mv-sum">
                    <div><small>Interest a year now</small><b>${money(Math.round(now))}</b><i class="ip-mv-bar"><em style="width:${Math.round(now / top * 100)}%"></em></i></div>
                    <div><small>After these moves</small><b class="pos">${money(Math.round(after))}</b><i class="ip-mv-bar good"><em style="width:100%"></em></i></div>
                    <div class="ip-mv-gain"><small>You gain</small><b>+${money(Math.round(r.movesGain))}</b><em>${money(Math.round(r.movesGain / 12))} a month</em></div></div>
                <div class="ip-mv-list">${moves.map((m, i) => `<div class="ip-mv">
                    <span class="ip-no">${i + 1}</span>
                    <div class="ip-mv-from"><small>From</small><b>${esc(m.from)}</b><em>${num(m.fromRate).toFixed(2)}%</em></div>
                    <div class="ip-mv-amt"><b>${money(Math.round(m.amount))}</b>${icon('chevron-right')}</div>
                    <div class="ip-mv-to"><small>To</small><b>${esc(m.to)}</b><em class="pos">${num(m.toRate).toFixed(2)}%</em></div>
                    <div class="ip-mv-g"><b class="pos">+${money(Math.round(m.gainPerYear))}</b><small>a year</small></div>
                    <p>${esc(m.reason)}</p></div>`).join('')}</div>` });
    };

    // ------------------------------------------------------------ Banks
    const banksTab = () => {
        const pctFund = pr.emergencyTarget ? Math.min(100, pr.liquid / pr.emergencyTarget * 100) : 100;
        const maxRate = Math.max(1, ...b.accounts.map(x => num(x.rate)), num(p.alt));
        const mp = movePlan().replace('class="panel ', 'class="panel da-tile g-c ').replace('<div class="panel-body ', '<div class="panel-body tile-scroll ');
        return `<div class="fit-grid ip-g-banks">
            ${panel({ title: 'Safety net', iconName: 'shield', cls: 'da-tile g-a', body: `<div class="ip-fund"><div class="ip-fund-top"><b>${money(Math.round(pr.liquid))}</b><span>of ${money(Math.round(pr.emergencyTarget))} (${pr.emergencyMonths} months)</span></div>
                ${bar(pctFund)}<p class="small muted">${pr.emergencyGap > 0 ? `${money(Math.round(pr.emergencyGap))} short. ${pr.emergencyMonths > 6 ? `Income varies by ${percent(pr.incomeCv * 100, 0)}, so the target is above six months.` : ''}` : 'Covered: everything above it can work harder.'}</p></div>` })}
            ${panel({ title: 'Idle money', iconName: 'hourglass', cls: 'da-tile g-b', body: `<div class="ip-idle ${b.idle > 0 && b.idleLossPerYear >= 500 ? 'warn' : 'ok'}"><div class="ip-idle-top"><b>${money(Math.round(b.idle))}</b>${b.idleLossPerYear > 0 ? `<span class="ip-loss">−${money(Math.round(b.idleLossPerYear))} a year</span>` : ''}</div>
                <p title="${esc(b.reading)}">${esc(b.reading)}</p></div>` })}
            ${mp}
            ${panel({ title: 'The money in your banks', iconName: 'bank', cls: 'da-tile g-d', bodyClass: 'flush tile-scroll', sub: `yield ${b.averageYield}% · deposits ${p.alt}%`,
                body: b.accounts.length ? table([
                    { label: 'Account', render: x => `<b>${esc(x.name)}</b><div class="small muted">${esc(x.type)}</div>` },
                    { label: 'Balance', align: 'r', render: x => moneyShort(x.balance) },
                    { label: 'Rate', render: x => x.rate == null ? '<span class="muted">—</span>' : `<div class="da-share"><i style="width:${Math.round(x.rate / maxRate * 100)}%"></i><span>${x.rate}%</span></div>` },
                    { label: 'A year', align: 'r', render: x => moneyShort(x.yearlyInterest) },
                    { label: 'Lost here', align: 'r', render: x => num(x.lossPerYear) > 0 ? `<b class="neg">−${moneyShort(Math.round(x.lossPerYear))}</b>` : '<span class="badge good">ok</span>' },
                ], b.accounts, { compact: true, dense: true }) : emptyState('No bank, cash or wallet balances yet.', 'bank') })}
        </div>`;
    };

    // ------------------------------------------------------------ Growth and risk
    const growthTab = () => {
        charts.push(() => {
            if (!r.simulation.length) return;
            lineChart(content.querySelector('#ip-fan'), { labels: r.simulation.map(x => `${x.years}y`), format: moneyShort, includeZero: true,
                series: [{ name: 'You put in', values: r.simulation.map(x => Math.round(x.invested)) }, { name: 'Bad (10th)', values: r.simulation.map(x => Math.round(x.p10)) },
                    { name: 'Middle (median)', values: r.simulation.map(x => Math.round(x.p50)) }, { name: 'Good (90th)', values: r.simulation.map(x => Math.round(x.p90)) }] });
        });
        const extras = [2000, 5000, 10000];
        return `<div class="fit-grid da-g-four ip-g-growth">
            ${panel({ title: 'Risk of this mix', iconName: 'scale', cls: 'da-tile g-a', bodyClass: 'flush tile-scroll', body: `<div class="ip-risk">
                <div><small>Expected a year</small><b class="pos">${k.expectedReturn}%</b></div><div><small>Typical swing</small><b>±${k.volatility}%</b></div>
                <div><small>1 year in 20 below</small><b class="${k.var95 < 0 ? 'neg' : ''}">${k.var95}%</b></div><div><small>Sharpe</small><b>${k.sharpe}</b></div></div>
                <p class="small muted ip-pad">${esc(k.reading)}</p>
                <h4 class="ip-h4">What a little more each month adds <small>at ${r.blendedReturn}%</small></h4>${table([
                    { label: 'Extra a month', render: x => `<b>${money(x)}</b>` },
                    { label: '10 years', align: 'r', render: x => `<b class="pos">+${moneyShort(fv(x, r.blendedReturn, 10))}</b>` },
                    { label: '20 years', align: 'r', render: x => `<b class="pos">+${moneyShort(fv(x, r.blendedReturn, 20))}</b>` },
                    { label: 'Put in (20 y)', align: 'r', render: x => moneyShort(x * 240) },
                ], extras, { compact: true, dense: true })}` })}
            ${r.simulation.length ? panel({ title: `Where ${money(Math.round(r.toInvest))} a month could end`, iconName: 'trending', cls: 'da-tile g-b', bodyClass: 'da-chart-body col', sub: '4,000 simulated paths',
                body: `${legend(['You put in', 'Bad (10th)', 'Middle', 'Good (90th)'].map((label, i) => ({ label, color: seriesColor(i) })))}<div class="chart" id="ip-fan"></div>` })
                : panel({ title: 'Simulation', iconName: 'trending', cls: 'da-tile g-b', body: '<p class="small muted ip-pad">Nothing to invest a month yet, so there is nothing to simulate.</p>' })}
            ${panel({ title: 'The simulation in numbers', iconName: 'list', cls: 'da-tile g-c', bodyClass: 'flush tile-scroll', body: r.simulation.length ? table([
                { label: 'After', render: x => `<b>${x.years} y</b>` }, { label: 'Put in', align: 'r', render: x => moneyShort(x.invested) },
                { label: 'Bad', align: 'r', render: x => moneyShort(x.p10) }, { label: 'Median', align: 'r', render: x => `<b class="pos">${moneyShort(x.p50)}</b>` }, { label: 'Good', align: 'r', render: x => moneyShort(x.p90) },
                { label: 'Below put-in', align: 'r', render: x => `<span class="${x.chanceBelowInvested > 0.1 ? 'neg' : ''}">${percent(x.chanceBelowInvested * 100, 1)}</span>` },
                { label: 'Below 6% inflation', align: 'r', render: x => percent(x.chanceBelowInflation * 100, 1) },
            ], r.simulation, { compact: true, dense: true }) : '' })}
            ${panel({ title: 'Simple projection', iconName: 'calendar', cls: 'da-tile g-d', bodyClass: 'flush tile-scroll', sub: 'at the average return', body: table([
                { label: 'After', render: x => `<b>${x.years} y</b>` }, { label: 'Put in', align: 'r', render: x => moneyShort(x.invested) },
                { label: 'Cautious', align: 'r', render: x => moneyShort(x.low) }, { label: 'Expected', align: 'r', render: x => `<b class="pos">${moneyShort(x.expected)}</b>` }, { label: 'Good', align: 'r', render: x => moneyShort(x.high) },
                { label: 'Today’s money', align: 'r', render: x => moneyShort(x.expectedReal) }, { label: '+10% a year', align: 'r', render: x => moneyShort(x.stepUp) },
            ], r.projection, { compact: true, dense: true }) })}
        </div>`;
    };

    // ------------------------------------------------------------ Goal: with a target, how to reach it; without one, quick targets to try
    const goalTab = () => {
        const quick = [1000000, 2500000, 5000000, 10000000];
        const chips = `<div class="ip-goal-chips">${quick.map(v => `<button type="button" class="nc-chip" data-ip-goal="${v}">${moneyShort(v)}</button>`).join('')}</div>`;
        if (!r.goal) return `<div class="fit-grid da-g-one">${panel({ title: 'A goal', iconName: 'flag', cls: 'da-tile', bodyClass: 'tile-scroll', body: `<div class="nc-empty">${icon('flag')}<b>Set a goal</b>
            <p>A house deposit, a child's education, retirement: pick an amount (or type one in "A goal" above) and the plan works out what to put away each month, and how sure you can be.</p>${chips}</div>` })}</div>`;
        const g = r.goal, tone = g.chance >= 0.8 ? 'good' : g.chance >= 0.5 ? 'warning' : 'critical';
        const years = [5, 10, 15, 20, 25];
        charts.push(() => {
            const ys = Array.from({ length: g.years + 1 }, (_, i) => i);
            lineChart(content.querySelector('#ip-goal-chart'), { labels: ys.map(y => `${y}y`), format: moneyShort, includeZero: true, area: true,
                series: [{ name: `Your plan: ${moneyShort(r.toInvest)} a month`, values: ys.map(y => Math.round(fv(r.toInvest, r.blendedReturn, y))) },
                    { name: `Needed: ${moneyShort(g.requiredSip)} a month`, values: ys.map(y => Math.round(fv(g.requiredSip, r.blendedReturn, y))), color: 'var(--series-3)' },
                    { name: 'Goal', values: ys.map(() => Math.round(g.target)), color: 'var(--series-2)' }] });
        });
        return `<div class="fit-grid ip-g-goal">
            ${panel({ title: `A goal of ${money(g.target)} in ${g.years} years`, iconName: 'flag', cls: 'da-tile g-a', body: `<div class="ip-goal-top"><div class="ip-risk">
                <div><small>Needed a month, on average</small><b>${money(Math.round(g.requiredSip))}</b></div><div><small>To be 80% sure</small><b>${money(Math.round(g.requiredSipSafe))}</b></div>
                <div><small>Your plan: ${money(Math.round(r.toInvest))} a month</small><b class="${g.chance >= 0.8 ? 'pos' : g.chance >= 0.5 ? '' : 'neg'}">${percent(g.chance * 100, 0)} chance</b></div></div>
                <div class="nc-verdict ${tone}">${icon(tone === 'good' ? 'check-circle' : 'alert')}<div><p>${esc(g.reading)}</p></div></div></div>` })}
            ${panel({ title: 'How the money grows towards it', iconName: 'trending', cls: 'da-tile g-b', bodyClass: 'da-chart-body col', sub: `at ${r.blendedReturn}% a year`,
                body: `${legend([{ label: `Your plan: ${moneyShort(r.toInvest)} a month`, color: seriesColor(0) }, { label: `Needed: ${moneyShort(g.requiredSip)} a month`, color: 'var(--series-3)' }, { label: 'Goal', color: 'var(--series-2)' }])}<div class="chart" id="ip-goal-chart"></div>` })}
            ${panel({ title: 'The same goal over other horizons', iconName: 'calendar', cls: 'da-tile g-c', bodyClass: 'flush tile-scroll', sub: 'starting earlier needs far less', body: table([
                { label: 'Horizon', render: y => `<b>${y} years</b>` },
                { label: 'A month', align: 'r', render: y => `<b>${moneyShort(g.target / fv(1, r.blendedReturn, y))}</b>` },
                { label: 'You put in', align: 'r', render: y => moneyShort(g.target / fv(1, r.blendedReturn, y) * 12 * y) },
                { label: 'Growth does', align: 'r', render: y => `<span class="pos">${moneyShort(g.target - g.target / fv(1, r.blendedReturn, y) * 12 * y)}</span>` },
            ], years, { compact: true, dense: true, rowClass: y => (y === g.years ? 'cur' : '') }) + `<p class="small muted ip-pad">Try another target: ${chips}</p>` })}
        </div>`;
    };

    // ------------------------------------------------------------ Notes: the assumptions and the fine print
    const notesTab = () => `<div class="fit-grid ip-g-notes">
        ${panel({ title: 'Worth knowing', iconName: 'bulb', cls: 'da-tile g-a', bodyClass: 'tile-scroll', body: `<ul class="ip-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` })}
        ${panel({ title: 'How the plan is made', iconName: 'info', cls: 'da-tile g-b', bodyClass: 'tile-scroll', body: `<ul class="da-method-list">
            <li><b>Income and spending</b> are your full months of income and expenses; the surplus in a poor month is what the plan builds on.</li>
            <li><b>Safety net</b>: six months of spending, more when income varies; it is filled before anything is invested.</li>
            <li><b>The mix</b> follows your age, risk appetite and horizon; returns and swings are long-run assumptions per part.</li>
            <li><b>Growth & risk</b> simulates 4,000 paths of correlated yearly returns; the fan shows the 10th, 50th and 90th percentile.</li>
            <li><b>Moving money</b> keeps the safety net in your best-paying savings account and puts the rest in the best deposit rate you have.</li></ul>
            <p class="emi-how">${icon('alert')} ${esc(r.disclaimer)}</p>` })}
    </div>`;

    const body = { plan: planTab, mix: mixTab, banks: banksTab, growth: growthTab, goal: goalTab, notes: notesTab };
    const show = (push = false) => {
        setQuery({ tab: ui.tab === 'plan' ? null : ui.tab }, { push });
        charts.length = 0;
        content.querySelector('#ip-body').innerHTML = body[ui.tab]();
        charts.forEach(fn => fn());
        content.querySelectorAll('[data-ip-tab]').forEach(x => x.classList.toggle('active', x.dataset.ipTab === ui.tab));
    };
    const asked = readQuery().get('tab');   // #/reports/investment-plan?tab=banks
    if (asked && body[asked]) ui.tab = asked;
    else if (!asked) ui.tab = 'plan';
    if (!body[ui.tab]) ui.tab = 'plan';
    content.classList.add('da-fit', 'ip-fit');
    content.innerHTML = `${controls}${hero}${tabs}<div class="da-body" id="ip-body"></div>`;
    content.querySelector('.da-tabs').addEventListener('click', e => {
        const t = e.target.closest('[data-ip-tab]');
        if (t && t.dataset.ipTab !== ui.tab) { ui.tab = t.dataset.ipTab; show(true); }
    });
    // the move plan as plain text, to paste into a note or a message
    content.querySelector('#ip-body').addEventListener('click', async e => {
        const goal = e.target.closest('[data-ip-goal]');
        if (goal) {
            const input = content.querySelector('#ip-goal');
            input.value = goal.dataset.ipGoal;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        const btn = e.target.closest('[data-ip-copy]');
        if (!btn) return;
        const text = ['Move plan (' + money(Math.round(r.movesGain)) + ' more interest a year)',
            ...moves.map((m, i) => `${i + 1}. ${money(Math.round(m.amount))} from ${m.from} (${num(m.fromRate).toFixed(2)}%) to ${m.to} (${num(m.toRate).toFixed(2)}%): +${money(Math.round(m.gainPerYear))} a year`)].join('\n');
        try { await navigator.clipboard.writeText(text); btn.innerHTML = `${icon('check')}Copied`; } catch { btn.textContent = 'Copy failed'; }
    });
    bind();
    show();

    return () => [['Part', 'Share %', 'A month', 'Assumed return %', 'Volatility %'], ...r.allocation.map(x => [x.name, x.percent, x.monthly, x.expectedReturn, x.volatility]),
        [], ['Years', 'Put in', '10th percentile', 'Median', '90th percentile', 'Chance below invested', 'Chance below inflation'],
        ...r.simulation.map(x => [x.years, x.invested, x.p10, x.p50, x.p90, x.chanceBelowInvested, x.chanceBelowInflation])];
}
