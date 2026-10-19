/**
 * Forecast: month-by-month projection of cash and net worth with what-if sliders
 * for income and expenses, the chit outlook (maturity runway, projected gains, wait or lift; #/forecast/chits)
 * and two planners: the chit illustrator and the interest calculator (#/forecast/chit and #/forecast/interest).
 */
import { api } from '../core/api.js';
import { panel, table, esc, kpi, emptyState } from '../core/ui.js';
import { exportButton, bindExport } from '../core/export.js';
import { renderChitOutlook } from './chit-outlook.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, monthLabel, shortDate, percent } from '../core/format.js';
import { barChart, lineChart, legend } from '../core/charts.js';
import { renderChitIllustrator, renderInterestCalculator } from './planners.js';
import { chitReturns, takeHomeNow } from './chits.js';

const MODES = [
    { value: 'projection', label: 'Projection', iconName: 'trending' },
    { value: 'chits', label: 'Chit outlook', iconName: 'timeline' },
    { value: 'chit', label: 'Chit illustrator', iconName: 'chit' },
    { value: 'interest', label: 'Interest calculator', iconName: 'calculator' },
];

const settings = { months: 12, incomeAdjust: 0, expenseAdjust: 0, sideTab: 'events' };

export async function render(container, params, isCurrent) {
    const mode = MODES.some(m => m.value === params[0]) ? params[0] : 'projection';
    container.innerHTML = `
    <div class="page forecast-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('trending')} Forecast</h2>
            <div class="seg-chips" id="fc-mode">${MODES.map(m =>
                `<a class="seg-chip ${m.value === mode ? 'active' : ''}" href="#/forecast${m.value === 'projection' ? '' : '/' + m.value}">${icon(m.iconName)}${m.label}</a>`).join('')}</div>
            <span class="spacer"></span>
            ${mode === 'projection' ? projectionControls() : ''}
        </div>
        <div class="forecast-body ${mode === 'projection' ? '' : 'planner-body'}" id="forecast-body"></div>
    </div>`;

    const body = container.querySelector('#forecast-body');
    if (mode === 'chit') { await renderChitIllustrator(body); return; }
    if (mode === 'interest') { renderInterestCalculator(body); return; }
    if (mode === 'chits') { await renderChitOutlook(body); return; }
    await renderProjection(container, body, isCurrent);
}

function projectionControls() {
    return `
            <div class="tabs sm" id="horizon">${[6, 12, 24, 36].map(m =>
                `<button class="tab ${m === settings.months ? 'active' : ''}" data-months="${m}">${m} months</button>`).join('')}</div>
            <label class="slider">What-if income <input type="range" id="income-adj" min="-50" max="50" step="5" value="${settings.incomeAdjust}">
                <b id="income-adj-val"></b></label>
            <label class="slider">What-if expenses <input type="range" id="expense-adj" min="-50" max="50" step="5" value="${settings.expenseAdjust}">
                <b id="expense-adj-val"></b></label>
            <button class="btn sm" id="reset">${icon('refresh')}Reset</button>
            ${exportButton({ label: '' })}`;
}

async function renderProjection(container, body, isCurrent) {
    const incomeInput = container.querySelector('#income-adj');
    const expenseInput = container.querySelector('#expense-adj');
    const showSliderValues = () => {
        const sign = v => (v > 0 ? '+' : '') + v + '%';
        container.querySelector('#income-adj-val').textContent = sign(settings.incomeAdjust);
        container.querySelector('#expense-adj-val').textContent = sign(settings.expenseAdjust);
    };
    showSliderValues();

    let data = null;
    let chits = null;
    let timer = null;
    const load = async () => {
        [data, chits] = await Promise.all([api.get('/forecast', settings), chits ? Promise.resolve(chits) : api.get('/chits').catch(() => [])]);
        if (isCurrent()) draw(body, data, chits);
    };
    const reloadSoon = () => { clearTimeout(timer); timer = setTimeout(load, 250); };

    container.querySelector('#horizon').addEventListener('click', e => {
        const btn = e.target.closest('[data-months]');
        if (!btn) return;
        settings.months = Number(btn.dataset.months);
        container.querySelectorAll('#horizon .tab').forEach(t => t.classList.toggle('active', t === btn));
        load();
    });
    incomeInput.addEventListener('input', () => { settings.incomeAdjust = Number(incomeInput.value); showSliderValues(); reloadSoon(); });
    expenseInput.addEventListener('input', () => { settings.expenseAdjust = Number(expenseInput.value); showSliderValues(); reloadSoon(); });
    container.querySelector('#reset').addEventListener('click', () => {
        settings.incomeAdjust = 0; settings.expenseAdjust = 0;
        incomeInput.value = 0; expenseInput.value = 0;
        showSliderValues();
        load();
    });
    bindExport(container.querySelector('.page-toolbar'), () => data && ({
        title: `Forecast · ${data.months} months`, filename: `forecast-${data.months}m`,
        subtitle: settings.incomeAdjust || settings.expenseAdjust ? `What-if: income ${settings.incomeAdjust}% · expenses ${settings.expenseAdjust}%` : 'At current trends',
        summary: [['Cash & bank today', Number(data.startingLiquid)], [`Cash & bank in ${data.months} months`, Number(data.endingLiquid)],
            ['Lowest cash point', Number(data.lowestLiquid)], [`Net worth in ${data.months} months`, Number(data.endingNetWorth)]],
        sheets: [{ name: 'Month by month', columns: [{ label: 'Month' }, ...['Income', 'Expenses', 'Chit installments', 'Chit payouts', 'Transfers out', 'Transfers in',
            'Net cash flow', 'Cash & bank', 'Net worth'].map(label => ({ label, type: 'money' }))],
            rows: data.rows.map(r => [monthLabel(r.month), r.income, r.expenses, r.chitInstallments, r.chitPayouts, r.transfersOut,
                r.transfersIn, r.netCashFlow, r.liquidClosing, r.netWorth].map((v, i) => i ? Number(v) : v)) }],
    }));

    await load();
}

function draw(body, f, chits = []) {
    const endChange = Number(f.endingNetWorth) - Number(f.startingNetWorth);
    const lowestIsNegative = Number(f.lowestLiquid) < 0;
    const labels = f.rows.map(r => r.month);
    const rowLabel = (m, i) => i === 0 ? `${monthLabel(m)} (rest)` : monthLabel(m);

    body.innerHTML = `
        <div class="kpis forecast-kpis">
            ${kpi({ label: 'Cash & bank today', value: money(f.startingLiquid), iconName: 'bank' })}
            ${kpi({ label: `Cash & bank in ${f.months} months`, value: money(f.endingLiquid), iconName: 'droplet', tone: 'aqua',
                    sub: `<span class="${Number(f.endingLiquid) >= Number(f.startingLiquid) ? 'pos' : 'neg'}">${moneyShort(Number(f.endingLiquid) - Number(f.startingLiquid))}</span> change` })}
            ${kpi({ label: 'Lowest cash point', value: money(f.lowestLiquid), iconName: lowestIsNegative ? 'alert' : 'flag',
                    tone: lowestIsNegative ? 'coral' : 'violet', sub: lowestIsNegative ? `<span class="neg">Shortfall in ${monthLabel(f.lowestLiquidMonth)}</span>` : monthLabel(f.lowestLiquidMonth) })}
            ${kpi({ label: `Net worth in ${f.months} months`, value: money(f.endingNetWorth), iconName: 'scale', tone: 'deep',
                    sub: `<span class="${endChange >= 0 ? 'pos' : 'neg'}">${endChange >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(endChange))}</span>` })}
            ${kpi({ label: 'Avg monthly income', value: money(f.averageMonthlyIncome), iconName: 'arrow-in', tone: 'aqua' })}
            ${kpi({ label: 'Avg monthly expenses', value: money(f.averageMonthlyExpense), iconName: 'arrow-out', tone: 'coral' })}
        </div>

        ${panel({ title: 'Projected cash & bank', iconName: 'droplet', cls: 'p-fc-cash', bodyClass: 'chart',
                  body: `<div class="chart-wrap"><div class="chart" id="fc-cash"></div></div>` })}
        ${panel({ title: 'Money in vs out', iconName: 'transfer', cls: 'p-fc-flow', bodyClass: 'chart',
                  body: `<div class="chart-wrap">${legend([{ label: 'Money in' }, { label: 'Money out' }])}<div class="chart" id="fc-flow"></div></div>` })}
        ${panel({ title: 'Projected net worth', iconName: 'trending', cls: 'p-fc-nw', bodyClass: 'chart',
                  body: `<div class="chart-wrap"><div class="chart" id="fc-nw"></div></div>` })}

        ${panel({ title: 'Month by month', iconName: 'list', cls: 'p-fc-table', bodyClass: 'flush',
                  body: `<div class="scroll" style="height:100%">${table([
                      { label: 'Month', render: r => `<b>${rowLabel(r.month, f.rows.indexOf(r))}</b>` },
                      { label: 'Income', align: 'r', render: r => `<span class="pos">${money(r.income)}</span>` },
                      { label: 'Expenses', align: 'r', render: r => `<span class="neg">${money(r.expenses)}</span>` },
                      { label: 'Chit dues', align: 'r', render: r => Number(r.chitInstallments) ? money(r.chitInstallments) : '<span class="muted">—</span>' },
                      { label: 'Chit payouts', align: 'r', render: r => Number(r.chitPayouts) ? `<span class="pos">${money(r.chitPayouts)}</span>` : '<span class="muted">—</span>' },
                      { label: 'EMIs & SIPs', align: 'r', render: r => Number(r.transfersOut) ? money(r.transfersOut) : '<span class="muted">—</span>' },
                      { label: 'Net', align: 'r', render: r => `<b class="${Number(r.netCashFlow) >= 0 ? 'pos' : 'neg'}">${money(r.netCashFlow)}</b>` },
                      { label: 'Cash & bank', align: 'r', render: r => `<b class="${Number(r.liquidClosing) < 0 ? 'neg' : ''}">${money(r.liquidClosing)}</b>` },
                      { label: 'Net worth', align: 'r', render: r => money(r.netWorth) },
                  ], f.rows, { compact: true })}</div>` })}

        ${panel({ title: 'Chits to maturity', iconName: 'chit', cls: 'p-fc-chits', bodyClass: 'flush',
                  actions: `<a class="btn sm ghost" href="#/forecast/chits" title="Chit outlook: maturity runway, gains, wait or lift">${icon('timeline')}Outlook</a>
                      <a class="btn sm ghost icon" href="#/forecast/chit" title="Chit illustrator">${icon('calculator')}</a>`,
                  body: chitProgressHtml(chits) })}
        ${panel({ title: 'Inputs', iconName: 'info', cls: 'p-fc-side',
                  actions: `<div class="tabs sm" id="side-tabs">
                      <button class="tab ${settings.sideTab === 'events' ? 'active' : ''}" data-side="events">Events</button>
                      <button class="tab ${settings.sideTab === 'categories' ? 'active' : ''}" data-side="categories">Spending</button>
                      <button class="tab ${settings.sideTab === 'assumptions' ? 'active' : ''}" data-side="assumptions">Assumptions</button></div>`,
                  body: '<div id="side-content"></div>' })}`;

    const moneyIn = f.rows.map(r => Number(r.income) + Number(r.chitPayouts) + Number(r.transfersIn));
    const moneyOut = f.rows.map(r => Number(r.expenses) + Number(r.chitInstallments) + Number(r.transfersOut));
    const labelFormat = l => monthLabel(l);
    lineChart(body.querySelector('#fc-cash'), {
        labels, labelFormat, format: moneyShort, area: true, includeZero: lowestIsNegative,
        series: [{ name: 'Cash & bank', values: f.rows.map(r => Number(r.liquidClosing)) }],
    });
    barChart(body.querySelector('#fc-flow'), {
        labels, labelFormat, format: moneyShort,
        series: [{ name: 'Money in', values: moneyIn }, { name: 'Money out', values: moneyOut }],
    });
    lineChart(body.querySelector('#fc-nw'), {
        labels, labelFormat, format: moneyShort, area: true,
        series: [{ name: 'Net worth', values: f.rows.map(r => Number(r.netWorth)) }],
    });

    const side = body.querySelector('#side-content');
    const drawSide = () => {
        if (settings.sideTab === 'events') {
            side.innerHTML = f.events.length ? `<div class="list">${f.events.map(e => `
                <div class="list-item"><span class="chip-icon sm ${e.kind === 'CHIT' ? 'gold' : e.kind === 'INCOME' ? 'aqua' : e.kind === 'EXPENSE' ? 'coral' : ''}">
                    ${icon(e.kind === 'CHIT' ? 'gift' : e.kind === 'INCOME' ? 'arrow-in' : e.kind === 'EXPENSE' ? 'arrow-out' : 'transfer')}</span>
                    <div class="grow"><div class="title">${esc(e.title)}</div><div class="meta">${shortDate(e.date)}</div></div>
                    <b class="mono">${money(e.amount)}</b></div>`).join('')}</div>` : emptyState('No large events ahead');
        } else if (settings.sideTab === 'categories') {
            side.innerHTML = table([
                { label: 'Category', render: c => esc(c.name) },
                { label: 'Basis', render: c => `<span class="badge ${c.basis === 'Budget' ? '' : 'gray'}">${esc(c.basis)}</span>` },
                { label: 'Per month', align: 'r', render: c => money(c.monthlyAmount) },
            ], f.categories, { compact: true, empty: 'No spending history yet' });
        } else {
            side.innerHTML = `<ul class="assumptions">${f.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}
                ${Number(f.incomeAdjustPercent) || Number(f.expenseAdjustPercent)
                    ? `<li><b>What-if:</b> income ${f.incomeAdjustPercent}% · expenses ${f.expenseAdjustPercent}%</li>` : ''}</ul>`;
        }
    };
    body.querySelector('#side-tabs').addEventListener('click', e => {
        const btn = e.target.closest('[data-side]');
        if (!btn) return;
        settings.sideTab = btn.dataset.side;
        body.querySelectorAll('#side-tabs .tab').forEach(t => t.classList.toggle('active', t === btn));
        drawSide();
    });
    drawSide();
}

/** Share of a chit's term (start to maturity) already behind us. */
function termPassed(c) {
    const total = (new Date(c.maturityDate) - new Date(c.startDate)) / 86400000;
    return Math.min(100, Math.max(0, 100 - (c.daysToMaturity / Math.max(1, total)) * 100));
}

/** Each running chit on its way to maturity: progress, money in, value now, take home now and at maturity. */
function chitProgressHtml(chits) {
    const running = chits.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && c.payoutAmount === null);
    if (!running.length) return emptyState('No running chits', 'chit');
    const sum = key => running.reduce((s, c) => s + Number(c[key] || 0), 0);
    const lift = running.map(takeHomeNow).filter(Boolean);
    return `
    <div class="fc-chit-total">
        <div><span>Paid in</span><b>${moneyShort(sum('paidIn'))}</b></div>
        <div><span>Value now</span><b>${moneyShort(sum('currentValue'))}</b></div>
        <div><span>Take home now</span><b class="gold-ink">${lift.length ? moneyShort(lift.reduce((s, t) => s + t.prize, 0)) : '—'}</b></div>
        <div><span>At maturity</span><b>${moneyShort(sum('maturityAmount'))}</b></div>
    </div>
    <div class="fc-chits scroll">${running.map(c => {
        const pct = (Number(c.paidIn) / (Number(c.totalContribution) || 1)) * 100;
        const r = chitReturns(c);
        const t = takeHomeNow(c);
        const monthsLeft = Math.max(0, Math.round(c.daysToMaturity / 30.4));
        return `<div class="fc-chit">
            <div class="row"><b class="ellipsis grow">${esc(c.name)}</b><span class="fc-distance" title="Distance to maturity">${icon('flag')}${monthsLeft} mo · ${shortDate(c.maturityDate)}</span></div>
            <i class="cr-bar" title="${percent(pct, 0)} paid in"><em style="width:${pct}%"></em></i>
            <i class="fc-term" title="Term passed"><em style="width:${termPassed(c)}%"></em></i>
            <div class="fc-chit-figs">
                <span><small>Paid in</small>${moneyShort(c.paidIn)}<small>${percent(pct, 0)}</small></span>
                <span><small>Value now</small>${moneyShort(c.currentValue)}<small>+${moneyShort(c.compoundInterestEarned)}</small></span>
                <span><small>Take home</small><b class="gold-ink">${t ? moneyShort(t.prize) : '—'}</b><small>${t ? 'paid + interest' : 'prized'}</small></span>
                <span><small>Maturity</small><b>${moneyShort(c.maturityAmount)}</b><small>C ${percent(r.compound, 1)} · S ${percent(r.simple, 1)}</small></span>
            </div>
        </div>`;
    }).join('')}</div>`;
}
