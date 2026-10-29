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
 * A planning aid on rules of thumb and a model, not advice from a registered adviser. The report area scrolls as one column.
 */
import { api } from '../core/api.js';
import { panel, table, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { donutChart, lineChart, seriesColor } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';

const num = v => Number(v || 0);
const STATUS = { now: ['warning', 'Do now'], done: ['good', 'Done'], monthly: ['good', 'Every month'], check: ['gray', 'Check'], habit: ['gray', 'Habit'] };
const TABS = [['plan', 'Plan', 'list'], ['banks', 'Banks & cash', 'bank'], ['growth', 'Growth & risk', 'trending'], ['goal', 'Goal', 'flag']];
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

function ring(score, grade, label, size = 132) {
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
    </div></div>`;
    const tabs = `<div class="da-tabs">${TABS.map(([key, l, ic]) => `<button class="da-tab ${ui.tab === key ? 'active' : ''}" data-ip-tab="${key}">${icon(ic)}${l}</button>`).join('')}</div>`;

    // ------------------------------------------------------------ Plan
    const planTab = () => {
        charts.push(() => {
            donutChart(content.querySelector('#ip-donut'), { items: r.allocation.map(x => ({ label: x.name, value: x.percent })), format: v => `${v}%`, centerValue: `${r.blendedReturn}%`, centerLabel: 'blended' });
            content.querySelector('#ip-legend').innerHTML = r.allocation.map((x, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                <span class="ellipsis">${esc(x.name)} ${x.percent}%</span><b>${moneyShort(x.monthly)}</b></div>`).join('');
        });
        return `${panel({ title: 'How fit is your money?', iconName: 'shield', sub: 'five parts, weighted', body: `<div class="da-parts">${fit.parts.map(x => `
            <div class="da-part"><div class="da-part-head"><b>${esc(x.name)}</b><span>${Math.round(x.score)}<small>/100 · ${Math.round(x.weight * 100)}%</small></span></div>${bar(x.score)}<p>${esc(x.reading)}</p></div>`).join('')}</div>` })}
        ${panel({ title: 'Your steps, in order', iconName: 'list', bodyClass: 'flush', body: `<div class="ip-steps">${r.steps.map(s => `
            <div class="ip-step ${s.status}"><span class="ip-no">${s.order}</span><div class="min-0 grow"><b>${esc(s.title)}</b><p>${esc(s.detail)}</p></div>
                <div class="ip-amt">${s.monthly > 0 ? `<b>${money(s.monthly)}</b><small>a month</small>` : ''}<span class="badge ${STATUS[s.status]?.[0] || 'gray'}">${STATUS[s.status]?.[1] || s.status}</span></div></div>`).join('')}</div>` })}
        <div class="da-grid">
            ${panel({ title: 'The mix', iconName: 'pie', sub: `${esc(pr.risk)} · age ${pr.age} · ${pr.horizonYears} years`, bodyClass: 'chart', body: '<div class="donut-wrap"><div class="chart" id="ip-donut"></div><div class="donut-legend scroll" id="ip-legend"></div></div>' })}
            ${r.rebalance.length ? panel({ title: 'Bring what you hold to the mix', iconName: 'scale', bodyClass: 'flush', sub: 'equity, debt and gold you hold today', body: `<div class="scroll">${table([
                { label: 'Part', render: x => `<b>${esc(x.name)}</b>` }, { label: 'Held', align: 'r', render: x => `${moneyShort(x.current)}<div class="small muted">${num(x.currentPercent).toFixed(0)}%</div>` },
                { label: 'Target', align: 'r', render: x => `${moneyShort(x.target)}<div class="small muted">${x.targetPercent}%</div>` },
                { label: 'Move', align: 'r', render: x => `<b class="${x.move >= 0 ? 'pos' : 'neg'}">${x.move >= 0 ? 'Add ' : 'Hold back '}${moneyShort(Math.abs(x.move))}</b>` },
            ], r.rebalance)}</div><p class="small muted ip-pad">Direct new money to the parts marked "Add" rather than selling: it avoids tax and costs.</p>` })
                : panel({ title: 'Where each part goes', iconName: 'layers', body: '<p class="small muted ip-pad">You hold no equity, debt or gold yet, so the whole monthly amount goes by the mix.</p>' })}
        </div>
        ${panel({ title: 'Where each part goes', iconName: 'layers', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Part', render: x => `<b>${esc(x.name)}</b>` }, { label: 'Share', align: 'r', render: x => percent(x.percent, 0) },
            { label: 'A month', align: 'r', render: x => `<b>${money(x.monthly)}</b>` },
            { label: 'Return · risk', align: 'r', render: x => `${x.expectedReturn}% · ±${x.volatility}%` },
            { label: 'Instruments', render: x => `<span class="small">${esc(x.instruments)}</span>` },
        ], r.allocation)}</div>` })}`;
    };

    // ------------------------------------------------------------ Banks
    const banksTab = () => {
        const pctFund = pr.emergencyTarget ? Math.min(100, pr.liquid / pr.emergencyTarget * 100) : 100;
        const maxRate = Math.max(1, ...b.accounts.map(x => num(x.rate)), num(p.alt));
        return `<div class="da-grid">
            ${panel({ title: 'Safety net', iconName: 'shield', body: `<div class="ip-fund"><div class="ip-fund-top"><b>${money(pr.liquid)}</b><span>of ${money(pr.emergencyTarget)} (${pr.emergencyMonths} months of spending)</span></div>
                ${bar(pctFund)}<p class="small muted">${pr.emergencyGap > 0 ? `${money(pr.emergencyGap)} short. ${pr.emergencyMonths > 6 ? `Income varies by ${percent(pr.incomeCv * 100, 0)}, so the target is above the usual six months.` : ''}` : 'Covered: everything above it can work harder.'}</p></div>` })}
            ${panel({ title: 'Idle money', iconName: 'hourglass', body: `<div class="ip-idle ${b.idle > 0 && b.idleLossPerYear >= 500 ? 'warn' : 'ok'}"><small>Above the safety net and a month's spending</small><b>${money(b.idle)}</b>
                <p>${esc(b.reading)}</p>${b.idleLossPerYear > 0 ? `<span class="ip-loss">−${money(b.idleLossPerYear)} a year</span>` : ''}</div>` })}
        </div>
        ${panel({ title: 'The money in your banks', iconName: 'bank', bodyClass: 'flush', sub: `average yield ${b.averageYield}% · deposits pay about ${p.alt}%`,
            body: b.accounts.length ? `<div class="scroll">${table([
                { label: 'Account', render: x => `<b>${esc(x.name)}</b><div class="small muted">${esc(x.type)}</div>` },
                { label: 'Balance', align: 'r', render: x => money(x.balance) },
                { label: 'Rate', render: x => x.rate == null ? '<span class="muted">not set</span>' : `<div class="da-share"><i style="width:${Math.round(x.rate / maxRate * 100)}%"></i><span>${x.rate}%</span></div>` },
                { label: 'Interest a year', align: 'r', render: x => money(x.yearlyInterest) },
            ], b.accounts)}</div>` : emptyState('No bank, cash or wallet balances yet.', 'bank') })}`;
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
        return `${panel({ title: 'Risk of this mix', iconName: 'scale', body: `<div class="ip-risk">
            <div><small>Expected a year</small><b class="pos">${k.expectedReturn}%</b></div><div><small>Typical swing (σ)</small><b>±${k.volatility}%</b></div>
            <div><small>1 year in 20 worse than</small><b class="${k.var95 < 0 ? 'neg' : ''}">${k.var95}%</b></div><div><small>Sharpe ratio</small><b>${k.sharpe}</b></div></div>
            <p class="small muted ip-pad">${esc(k.reading)}</p>` })}
        ${r.simulation.length ? panel({ title: `Where ${money(r.toInvest)} a month could end`, iconName: 'trending', sub: '4,000 simulated paths: the fan shows the bad, middle and good outcomes', bodyClass: 'chart', body: '<div class="chart-wrap"><div class="chart" id="ip-fan"></div></div>' }) : ''}
        ${r.simulation.length ? panel({ title: 'The simulation in numbers', iconName: 'list', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'After', render: x => `<b>${x.years} years</b>` }, { label: 'You put in', align: 'r', render: x => money(x.invested) },
            { label: 'Bad (10th pct)', align: 'r', render: x => money(x.p10) }, { label: 'Middle (median)', align: 'r', render: x => `<b class="pos">${money(x.p50)}</b>` }, { label: 'Good (90th pct)', align: 'r', render: x => money(x.p90) },
            { label: 'Ends below what you put in', align: 'r', render: x => `<span class="${x.chanceBelowInvested > 0.1 ? 'neg' : ''}">${percent(x.chanceBelowInvested * 100, 1)}</span>` },
            { label: 'Fails to beat 6% inflation', align: 'r', render: x => percent(x.chanceBelowInflation * 100, 1) },
        ], r.simulation)}</div>` }) : ''}
        ${panel({ title: 'What a little more each month adds', iconName: 'plus', sub: `at the mix's average return of ${r.blendedReturn}%`, bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Extra a month', render: x => `<b>${money(x)}</b>` },
            { label: 'After 10 years', align: 'r', render: x => `<b class="pos">+${money(fv(x, r.blendedReturn, 10))}</b>` },
            { label: 'After 20 years', align: 'r', render: x => `<b class="pos">+${money(fv(x, r.blendedReturn, 20))}</b>` },
            { label: 'Of which you put in (20 y)', align: 'r', render: x => money(x * 240) },
        ], extras)}</div>` })}
        ${panel({ title: 'Simple projection (average return)', iconName: 'calendar', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'After', render: x => `<b>${x.years} years</b>` }, { label: 'You put in', align: 'r', render: x => money(x.invested) },
            { label: 'Cautious', align: 'r', render: x => money(x.low) }, { label: 'Expected', align: 'r', render: x => `<b class="pos">${money(x.expected)}</b>` }, { label: 'Good', align: 'r', render: x => money(x.high) },
            { label: 'Expected, in today’s money', align: 'r', render: x => money(x.expectedReal) }, { label: 'Raising it 10% a year', align: 'r', render: x => money(x.stepUp) },
        ], r.projection)}</div>` })}`;
    };

    // ------------------------------------------------------------ Goal
    const goalTab = () => {
        if (!r.goal) return panel({ title: 'A goal', iconName: 'flag', body: `<div class="nc-empty">${icon('flag')}<b>Set a goal</b><p>Type an amount in "A goal" above (a house deposit, a child's education, retirement) and the plan works out what you need to put away each month, and how sure you can be.</p></div>` });
        const g = r.goal, tone = g.chance >= 0.8 ? 'good' : g.chance >= 0.5 ? 'warning' : 'critical';
        const years = [5, 10, 15, 20, 25].filter(y => y >= 1);
        return `${panel({ title: `A goal of ${money(g.target)} in ${g.years} years`, iconName: 'flag', body: `<div class="ip-risk">
            <div><small>Needed a month, on average</small><b>${money(g.requiredSip)}</b></div><div><small>Needed to be 80% sure</small><b>${money(g.requiredSipSafe)}</b></div>
            <div><small>Your plan: ${money(r.toInvest)} a month</small><b class="${g.chance >= 0.8 ? 'pos' : g.chance >= 0.5 ? '' : 'neg'}">${percent(g.chance * 100, 0)} chance</b></div></div>
            <div class="nc-verdict ${tone}" style="margin:0 12px 12px">${icon(tone === 'good' ? 'check-circle' : 'alert')}<div><p>${esc(g.reading)}</p></div></div>` })}
        ${panel({ title: 'The same goal over other horizons', iconName: 'calendar', bodyClass: 'flush', sub: `monthly amount needed on average at ${r.blendedReturn}%`, body: `<div class="scroll">${table([
            { label: 'Horizon', render: y => `<b>${y} years</b>` },
            { label: 'Needed a month', align: 'r', render: y => `<b>${money(g.target / fv(1, r.blendedReturn, y))}</b>` },
            { label: 'You would put in', align: 'r', render: y => money(g.target / fv(1, r.blendedReturn, y) * 12 * y) },
            { label: 'Growth does', align: 'r', render: y => `<span class="pos">${money(g.target - g.target / fv(1, r.blendedReturn, y) * 12 * y)}</span>` },
        ], years)}</div><p class="small muted ip-pad">Starting earlier needs far less each month: the growth does more of the work.</p>` })}`;
    };

    const body = { plan: planTab, banks: banksTab, growth: growthTab, goal: goalTab };
    const show = () => {
        charts.length = 0;
        content.querySelector('#ip-body').innerHTML = body[ui.tab]();
        charts.forEach(fn => fn());
        content.querySelectorAll('[data-ip-tab]').forEach(x => x.classList.toggle('active', x.dataset.ipTab === ui.tab));
    };
    content.innerHTML = `${controls}${hero}${tabs}<div class="da-body" id="ip-body"></div>
        <ul class="ip-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <p class="emi-how">${icon('alert')} ${esc(r.disclaimer)}</p>`;
    content.querySelector('.da-tabs').addEventListener('click', e => {
        const t = e.target.closest('[data-ip-tab]');
        if (t) { ui.tab = t.dataset.ipTab; show(); }
    });
    bind();
    show();

    return () => [['Part', 'Share %', 'A month', 'Assumed return %', 'Volatility %'], ...r.allocation.map(x => [x.name, x.percent, x.monthly, x.expectedReturn, x.volatility]),
        [], ['Years', 'Put in', '10th percentile', 'Median', '90th percentile', 'Chance below invested', 'Chance below inflation'],
        ...r.simulation.map(x => [x.years, x.invested, x.p10, x.p50, x.p90, x.chanceBelowInvested, x.chanceBelowInflation])];
}
