/**
 * Forecast: month-by-month projection of cash and net worth with what-if sliders for income and expenses, and what
 * the money earns on top (savings, deposits, money given, chits: projection-earnings.js); wealth
 * against inflation and how to invest to beat it (#/forecast/wealth); the chit outlook (maturity runway, projected
 * gains; #/forecast/chits); the chit forecast (net worth on any day with the chits, insights; #/forecast/chitplan);
 * lift or hold for each chit by its own terms (#/forecast/lift); two planners: the chit illustrator and the interest
 * calculator (#/forecast/chit and #/forecast/interest); and the analyzer of chits the user hosts.
 */
import { api } from '../core/api.js';
import { panel, table, esc, kpi, emptyState } from '../core/ui.js';
import { exportButton, bindExport } from '../core/export.js';
import { renderChitOutlook } from './chit-outlook.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, monthLabel, shortDate, percent } from '../core/format.js';
import { barChart, lineChart, donutChart, legend } from '../core/charts.js';
import { renderChitIllustrator, renderInterestCalculator } from './planners.js';
import { renderChitAnalyzer } from './chit-analyzer.js';
import { renderWealthForecast } from './wealth-forecast.js';
import { renderChitForecast } from './chit-forecast.js';
import { renderChitLift } from './chit-lift.js';
import { projectEarnings, SOURCES, SOURCE_LABEL, SOURCE_COLOR } from './projection-earnings.js';
import { monthDetail, openMonthTable, LINE_BASIS, EVENT_ICON } from './forecast-month.js';
import { choice, asNumber, asFlag, flagText, asList, readChoices, writeChoices, readQuery } from '../core/route.js';
import { dialogOpen } from '../core/ui.js';
import { getPref, setPref } from '../core/prefs.js';

const MODES = [
    { value: 'projection', label: 'Projection', iconName: 'trending' },
    // what you hold against inflation, the years ahead two ways, and what to do
    { value: 'wealth', label: 'Wealth & inflation', iconName: 'piggy' },
    { value: 'chits', label: 'Chit outlook', iconName: 'timeline' },
    // net worth on any day with the chits, and insights on them
    { value: 'chitplan', label: 'Chit forecast', iconName: 'calendar' },
    // when (if ever) to lift each chit, by its own terms
    { value: 'lift', label: 'Lift or hold', iconName: 'arrow-in' },
    { value: 'chit', label: 'Chit illustrator', iconName: 'chit' },
    { value: 'interest', label: 'Interest calculator', iconName: 'calculator' },
    // chits the user hosts: member's interest by winning month, the host's commission and what to keep aside
    { value: 'analyzer', label: 'Host analyzer', iconName: 'scale' },
];

const settings = { months: 12, incomeAdjust: 0, expenseAdjust: 0, sideTab: 'events' };
/** What the page was reached by, for what it takes from the address. */
let arrived = [];
/** The months opened in Month by month. */
const openMonths = { list: [] };
// what the money earns, laid over the projection (projection-earnings.js)
const RATES = { savingsRate: 3, fdRate: 7, repay: true, dividends: true, expandAll: false, incomeBasis: 'REGULAR', expenseBasis: 'BUDGET',
    lines: { earn: true, base: true, buffer: true }, earnView: 'stacked', earnHide: [] };

export async function render(container, params, isCurrent) {
    const mode = MODES.some(m => m.value === params[0]) ? params[0] : 'projection';
    arrived = params;
    container.innerHTML = `
    <div class="page forecast-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('trending')} Forecast</h2>
            <div class="seg-chips" id="fc-mode">${MODES.map(m =>
                `<a class="seg-chip ${m.value === mode ? 'active' : ''}" href="#/forecast${m.value === 'projection' ? '' : '/' + m.value}">${icon(m.iconName)}${m.label}</a>`).join('')}</div>
            <span class="spacer"></span>
            ${mode === 'projection' ? projectionControls() : ''}
        </div>
        <div class="forecast-body ${mode === 'projection' ? 'fc-proj' : 'planner-body'}" id="forecast-body"></div>
    </div>`;

    const body = container.querySelector('#forecast-body');
    if (mode === 'chit') { await renderChitIllustrator(body); return; }
    if (mode === 'interest') { renderInterestCalculator(body); return; }
    if (mode === 'chits') { await renderChitOutlook(body); return; }
    if (mode === 'analyzer') { await renderChitAnalyzer(body, params[1]); return; }
    if (mode === 'wealth') { await renderWealthForecast(body); return; }
    if (mode === 'chitplan') { await renderChitForecast(body); return; }
    if (mode === 'lift') { await renderChitLift(body); return; }
    await renderProjection(container, body, isCurrent);
}

const monthOpen = (month, rates) => rates.expandAll !== openMonths.list.includes(month);

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
    const rates = { ...RATES, ...getPref('projectionRates', {}) };
    rates.lines = { ...RATES.lines, ...(rates.lines || {}) };
    // everything this view can show differently, in the address (core/route.js)
    const lineList = { get lines() { return Object.keys(rates.lines).filter(k => rates.lines[k]); }, set lines(on) { Object.keys(rates.lines).forEach(k => { rates.lines[k] = on.includes(k); }); } };
    const asList_ = { format: v => v.join(',') };
    const spec = {
        months: choice(settings, 'months', 12, asNumber, { move: true }),
        income: choice(settings, 'incomeAdjust', 0, asNumber),
        expense: choice(settings, 'expenseAdjust', 0, asNumber),
        side: choice(settings, 'sideTab', 'events', String, { move: true }),
        earn: choice(rates, 'earnView', RATES.earnView, String, { move: true }),
        hide: choice(rates, 'earnHide', [], asList, asList_),
        lines: choice(lineList, 'lines', Object.keys(RATES.lines), asList, asList_),
        basis: choice(rates, 'incomeBasis', RATES.incomeBasis, String, { move: true }),
        spend: choice(rates, 'expenseBasis', RATES.expenseBasis, String, { move: true }),
        all: choice(rates, 'expandAll', false, asFlag, { format: flagText }),
        open: choice(openMonths, 'list', [], asList, asList_),
        sav: choice(rates, 'savingsRate', RATES.savingsRate, asNumber),
        fd: choice(rates, 'fdRate', RATES.fdRate, asNumber),
        repay: choice(rates, 'repay', RATES.repay, asFlag, { format: flagText }),
        div: choice(rates, 'dividends', RATES.dividends, asFlag, { format: flagText }),
    };
    readChoices(arrived, spec);
    container.querySelectorAll('#horizon .tab').forEach(t => t.classList.toggle('active', Number(t.dataset.months) === settings.months));
    if (incomeInput) incomeInput.value = settings.incomeAdjust;
    if (expenseInput) expenseInput.value = settings.expenseAdjust;
    const remember = () => writeChoices(spec);
    // after the panel's own handlers have changed what they change
    const page = container.querySelector('.forecast-page');   // drawn anew each time, so these do not pile up
    page.addEventListener('click', () => queueMicrotask(remember));
    page.addEventListener('change', () => queueMicrotask(remember));
    const showSliderValues = () => {
        const sign = v => (v > 0 ? '+' : '') + v + '%';
        container.querySelector('#income-adj-val').textContent = sign(settings.incomeAdjust);
        container.querySelector('#expense-adj-val').textContent = sign(settings.expenseAdjust);
    };
    showSliderValues();

    let data = null, extra = null, p = null;
    let timer = null;
    const save = () => setPref('projectionRates', rates);
    const load = async () => {
        const [f, more] = await Promise.all([api.get('/forecast', { months: settings.months, incomeAdjust: settings.incomeAdjust, expenseAdjust: settings.expenseAdjust,
            incomeBasis: rates.incomeBasis, expenseBasis: rates.expenseBasis }),
            extra ? Promise.resolve(extra) : loadExtra()]);
        data = f; extra = more;
        if (!isCurrent()) return;
        redraw();
        remember();
        // ...?card=out&from=2027-01&to=2027-03: a table of the months opened maximized
        const q = readQuery();
        if (q.get('card') && !dialogOpen()) openMonthTable({ cols: q.get('card'), from: q.get('from'), to: q.get('to'), preset: q.get('range') }, body);
    };
    const redraw = () => {
        p = projectEarnings(data, extra, rates);
        draw(body, data, p, extra, rates);
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
    // the rates and switches of the earnings, kept for next time
    body.addEventListener('change', e => {
        const t = e.target;
        if (!t.dataset.rate) return;
        rates[t.dataset.rate] = t.type === 'checkbox' ? t.checked : Math.max(0, Number(t.value) || 0);
        save();
        redraw();
    });
    body.addEventListener('click', e => {
        const basis = e.target.closest('[data-income-basis]');
        if (basis) { rates.incomeBasis = basis.dataset.incomeBasis; save(); load(); return; }
        const spend = e.target.closest('[data-expense-basis]');
        if (spend) { rates.expenseBasis = spend.dataset.expenseBasis; save(); load(); return; }
        const max = e.target.closest('[data-fm-max]');
        if (max) { openMonthTable({ cols: max.dataset.fmMax, from: max.closest('tr[data-fc-detail]').dataset.fcDetail }, body); return; }
        if (e.target.closest('.fc-detail')) return;   // a click inside an opened month stays there
        const line = e.target.closest('[data-cash-line]');
        if (line) { rates.lines[line.dataset.cashLine] = !rates.lines[line.dataset.cashLine]; save(); redraw(); return; }
        const all = e.target.closest('[data-fc-expand]');
        if (all) { rates.expandAll = !rates.expandAll; openMonths.list = []; save(); redraw(); return; }
        const row = e.target.closest('tr[data-fc-month]');
        if (row) {
            const month = row.dataset.fcMonth;
            row.classList.toggle('open');
            body.querySelector(`tr[data-fc-detail="${month}"]`)?.toggleAttribute('hidden');
            openMonths.list = openMonths.list.includes(month) ? openMonths.list.filter(m => m !== month) : [...openMonths.list, month];
        }
    });
    bindExport(container.querySelector('.page-toolbar'), () => data && p && ({
        title: `Forecast · ${data.months} months`, filename: `forecast-${data.months}m`,
        subtitle: `${settings.incomeAdjust || settings.expenseAdjust ? `What-if: income ${settings.incomeAdjust}% · expenses ${settings.expenseAdjust}% · ` : ''}income: ${BASIS[data.incomeBasis]?.[0] || data.incomeBasis} · savings ${p.savRate.toFixed(2)}% · deposits ${rates.fdRate}%`,
        summary: [['Cash & bank today', Number(data.startingLiquid)], [`Cash & bank in ${data.months} months`, Math.round(p.rows.at(-1).liquid)],
            ['Lowest cash point', Math.round(p.lowest.liquid)], [`Earnings in ${data.months} months`, Math.round(p.earned)], [`Net worth in ${data.months} months`, Math.round(p.rows.at(-1).netWorth)]],
        sheets: [{ name: 'Month by month', columns: [{ label: 'Month' }, ...['Recurring income', 'Recorded income', 'Expenses', 'Chit installments', 'Chit dividends', 'Chit payouts', 'Transfers out', 'Transfers in',
            'Savings interest', 'Deposit interest', 'Money given interest', 'Chit interest', 'Earnings', 'Maturities & repayments', 'Net cash flow', 'Cash & bank', 'Net worth'].map(label => ({ label, type: 'money' }))],
            rows: p.rows.map(r => [monthLabel(r.month), r.incomeRecurring, r.incomeRecorded, r.expenses, r.chitInstallments, r.earn.dividends, r.chitPayouts, r.transfersOut, r.transfersIn,
                r.earn.savings, r.earn.deposits, r.earn.given, r.earn.chits, r.earned, r.cash.back, Number(r.netCashFlow) + r.extraCash, r.liquid, r.netWorth]
                .map((v, i) => (i ? Math.round(Number(v || 0)) : v))) },
            { name: 'Dated events', columns: [{ label: 'Date', type: 'date' }, { label: 'What' }, { label: 'Amount', type: 'money' }, { label: 'Note' }],
                rows: p.rows.flatMap(r => r.events.map(e => [e.date, e.title, Math.round(e.amount), e.note])) },
            { name: 'Expenses by category', columns: [{ label: 'Month' }, { label: 'Category' }, { label: 'From' }, { label: 'Amount', type: 'money' }],
                rows: p.rows.flatMap(r => (r.expenseLines || []).map(l => [monthLabel(r.month), l.name, LINE_BASIS[l.basis]?.[1] || l.basis, Math.round(Number(l.amount))])) }],
    }));

    await load();
}

/** What the earnings need beyond the forecast: the accounts, the money given, and the running chits with their detail. */
async function loadExtra() {
    const [accounts, claimList, chitList] = await Promise.all([api.get('/accounts').catch(() => []), api.get('/claims').catch(() => ({ claims: [] })), api.get('/chits').catch(() => [])]);
    const running = chitList.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && (c.payoutAmount === null || Number(c.stillToPay) > 0));
    const chits = (await Promise.all(running.map(c => api.get(`/chits/${c.id}`).catch(() => null)))).filter(Boolean).map(d => ({ c: d.chit, d }));
    return { accounts, claims: claimList.claims || [], chits };
}

// which recorded income the projection counts (the server's incomeBasis)
const BASIS = {
    REGULAR: ['Regular', 'Recurring items and income recorded as regular'],
    UNMARKED: ['+ Not marked', 'Also income recorded without saying regular or one-time'],
    ALL: ['+ One-time', 'Also one-time income, averaged over 3 months'],
    NONE: ['No income', 'Only what goes out, and what the money earns'],
};
// where the expenses come from (the server's expenseBasis)
const SPEND = {
    BUDGET: ['Budgets', 'Each month\'s own budget, else the average of the months budgeted; categories without a budget are left out'],
    BUDGET_HISTORY: ['+ Not budgeted', 'Budgets, and the 3-month average of the categories without one'],
};
// the earnings panel: how to look at it
const EARN_VIEWS = [['stacked', 'layers', 'Stacked', 'Each month, by source, stacked'], ['lines', 'activity', 'Lines', 'A line for each source'],
    ['running', 'trending', 'Running', 'Running total over the months'], ['mix', 'pie', 'Mix', 'Share of each source over the whole period'],
    ['table', 'grid', 'Table', 'Every month, every source']];
const SOURCE_SHORT = { savings: 'Sav', deposits: 'Dep', given: 'Lent', chits: 'Chit', dividends: 'Div' };

function draw(body, f, p, extra, rates) {
    const rows = p.rows;
    const last = rows.at(-1);
    const start = Number(f.startingLiquid);
    const labels = rows.map(r => r.month);
    const rowLabel = (m, i) => i === 0 ? `${monthLabel(m)}<small>rest</small>` : monthLabel(m);
    const nwChange = last.netWorth - Number(f.startingNetWorth);
    const lift = last.liquid - last.baseLiquid;
    const avgEarn = p.earned / Math.max(1, rows.length);
    const avgIncome = Number(f.averageMonthlyIncome) || 0;
    // a safety buffer: three months of what goes out
    const outOf = r => Number(r.expenses) + Number(r.chitInstallments) - r.cash.dividends + Number(r.transfersOut);
    const buffer = 3 * rows.slice(1).reduce((t, r) => t + outOf(r), 0) / Math.max(1, rows.length - 1);
    const below = rows.filter(r => r.liquid < buffer);
    const lowestIsNegative = p.lowest.liquid < 0;
    const maxCash = Math.max(1, ...rows.map(r => Math.abs(r.liquid)));
    const maxEarn = Math.max(1, ...rows.map(r => r.earned));
    const big = rows.flatMap(r => r.events).filter(e => e.kind !== 'chit' && Math.abs(e.amount) >= 1000).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 6)
        .sort((a, b) => a.date.localeCompare(b.date));
    const dash = v => (Math.round(v) ? money(Math.round(v)) : '<span class="muted">—</span>');
    const earnBar = r => `<i class="fc-ebar" title="${SOURCES.filter(s => r.earn[s] >= 1).map(s => `${SOURCE_LABEL[s]} ${money(Math.round(r.earn[s]))}`).join('\n')}">${SOURCES.map(s => r.earn[s] >= 1
        ? `<em style="width:${(r.earn[s] / maxEarn) * 100}%;background:${SOURCE_COLOR[s]}"></em>` : '').join('')}</i>`;
    const basisNote = f.incomeBasis === 'REGULAR' && Number(f.unmarkedIncome) > Number(f.regularIncome) * 2
        ? `${money(Math.round(Number(f.unmarkedIncome)))} a month of recorded income is not marked regular or one-time, so it is left out: mark your salary as Regular when you record it, or count it with “+ Not marked”.` : '';

    body.innerHTML = `
        <div class="fc-rates">
            <span class="fc-rates-title">${icon('percent')}What your money earns</span>
            <label title="Bank accounts without a rate of their own earn this">Savings bank <input type="number" data-rate="savingsRate" value="${rates.savingsRate}" step="0.25" min="0" max="15">%</label>
            <label title="Deposits without a rate of their own earn this">Fixed deposits <input type="number" data-rate="fdRate" value="${rates.fdRate}" step="0.25" min="0" max="15">%</label>
            <label class="check-line" title="Money you lent comes back, with its interest, on its due date"><input type="checkbox" data-rate="repay" ${rates.repay ? 'checked' : ''}>Money given is repaid on its due date</label>
            <label class="check-line" title="Each chit installment to come gets the chit's average dividend so far"><input type="checkbox" data-rate="dividends" ${rates.dividends ? 'checked' : ''}>Chit dividends</label>
            <span class="spacer"></span>
            <span class="fc-rates-note" title="${esc(p.notes.join('\n'))}">${icon('info')}${p.deposits.length} deposit${p.deposits.length === 1 ? '' : 's'} · ${p.given.length} loan${p.given.length === 1 ? '' : 's'} given · ${extra.chits.length} chits · savings at ${p.savRate.toFixed(2)}%</span>
        </div>
        <div class="kpis forecast-kpis">
            ${kpi({ label: 'Cash & bank today', value: money(start), iconName: 'bank' })}
            ${kpi({ label: `Cash & bank in ${f.months} months`, value: money(Math.round(last.liquid)), iconName: 'droplet', tone: 'aqua',
                    sub: `<span class="${last.liquid >= start ? 'pos' : 'neg'}">${signedShort(last.liquid - start)}</span>${lift ? ` · <span class="pos">${signedShort(lift)}</span> from earnings` : ''}` })}
            ${kpi({ label: 'Lowest cash point', value: money(Math.round(p.lowest.liquid)), iconName: lowestIsNegative ? 'alert' : 'flag',
                    tone: lowestIsNegative ? 'coral' : 'violet', sub: lowestIsNegative ? `<span class="neg">Shortfall in ${monthLabel(p.lowest.month)}</span>` : `${monthLabel(p.lowest.month)}${below.length ? ` · <span class="neg">${below.length} mo below buffer</span>` : ''}` })}
            ${kpi({ label: `Earnings in ${f.months} months`, value: `<span class="pos">${money(Math.round(p.earned))}</span>`, iconName: 'coins', tone: 'aqua',
                    sub: `${moneyShort(p.total.savings + p.total.deposits)} bank & deposits · ${moneyShort(p.total.chits + p.total.dividends)} chits${p.total.given ? ` · ${moneyShort(p.total.given)} given` : ''}` })}
            ${kpi({ label: 'Income counted a month', value: money(Math.round(avgIncome)), iconName: 'arrow-in', tone: 'violet',
                    sub: `${BASIS[f.incomeBasis]?.[0] || ''} · earnings add ${moneyShort(avgEarn)}` })}
            ${kpi({ label: `Net worth in ${f.months} months`, value: money(Math.round(last.netWorth)), iconName: 'scale', tone: 'deep',
                    sub: `<span class="${nwChange >= 0 ? 'pos' : 'neg'}">${nwChange >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(nwChange))}</span>` })}
        </div>

        ${panel({ title: 'Projected cash & bank', iconName: 'droplet', cls: 'p-fc-cash',
                  actions: `<span class="seg-chips sm fc-lines">${[['earn', 'With earnings', 'var(--series-1)'], ['base', 'Income & spending only', 'var(--series-8)'], ['buffer', 'Safety buffer', 'var(--series-4)']]
                      .map(([k, l, c]) => `<button type="button" class="seg-chip ${rates.lines[k] ? 'active' : ''}" data-cash-line="${k}"><i style="background:${c}"></i>${l}</button>`).join('')}</span>`,
                  body: `<div class="fc-cash-stats">
                          <div><small>Today</small><b>${moneyShort(start)}</b></div>
                          <div><small>In ${f.months} months</small><b class="${last.liquid >= start ? 'pos' : 'neg'}">${moneyShort(last.liquid)}</b><em>${signedShort(last.liquid - start)}</em></div>
                          <div><small>Lowest</small><b class="${lowestIsNegative ? 'neg' : ''}">${moneyShort(p.lowest.liquid)}</b><em>${monthLabel(p.lowest.month)}</em></div>
                          <div title="Three months of what goes out: expenses, chit dues and EMIs"><small>Safety buffer</small><b>${moneyShort(buffer)}</b><em class="${below.length ? 'neg' : 'pos'}">${below.length ? `below in ${below.length} month${below.length === 1 ? '' : 's'}` : 'never below'}</em></div>
                          <div><small>Earnings & maturities add</small><b class="pos">${signedShort(lift)}</b><em>by ${monthLabel(last.month)}</em></div>
                      </div>
                      <div class="chart fc-chart" id="fc-cash"></div>
                      ${big.length ? `<div class="fc-dates">${big.map(e => `<span class="fc-date ${e.kind}" title="${esc(e.note)}">${icon(EVENT_ICON[e.kind] || 'calendar')}<b>${shortDate(e.date)}</b>${esc(e.title)}<em class="${e.amount >= 0 ? 'pos' : 'neg'}">${signedShort(e.amount)}</em></span>`).join('')}</div>` : ''}` })}
        ${panel({ title: 'Earnings by month', iconName: 'coins', cls: 'p-fc-earn', sub: `${money(Math.round(p.earned))} in ${f.months} months`,
                  body: p.earned > 0.5 ? `<div class="fe-tabs" role="tablist">${EARN_VIEWS.map(([k, ic, l, h]) =>
                          `<button type="button" role="tab" class="fe-tab ${rates.earnView === k ? 'active' : ''}" data-earn-view="${k}" title="${h}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
                      <div class="fe-view" id="fc-earn"></div>
                      <div class="fe-srcs" id="fc-earn-srcs"></div>` : `<div class="fe-view">${emptyState('Nothing earns interest yet', 'coins')}</div>` })}

        ${panel({ title: 'Month by month', iconName: 'list', cls: 'p-fc-table', bodyClass: 'flush',
                  sub: `${rows.length} months · tap a month for its detail`,
                  actions: `<button type="button" class="btn sm ghost" data-fc-expand>${icon(rates.expandAll ? 'chevron-up' : 'chevron-down')}${rates.expandAll ? 'Collapse all' : 'Expand all'}</button>`,
                  body: `<div class="fc-basis-bar">
                          <span class="fc-basis-label">${icon('arrow-in')}Income counted</span><span class="seg-chips sm fc-basis">${Object.entries(BASIS).map(([k, [l, h]]) => {
                      const amt = k === 'REGULAR' ? Number(f.regularIncome) : k === 'UNMARKED' ? Number(f.regularIncome) + Number(f.unmarkedIncome) : k === 'ALL' ? Number(f.regularIncome) + Number(f.unmarkedIncome) + Number(f.oneTimeIncome) : 0;
                      return `<button type="button" class="seg-chip ${f.incomeBasis === k ? 'active' : ''}" data-income-basis="${k}" title="${esc(h)}${k !== 'NONE' ? `: recurring ${money(Math.round(Number(f.recurringIncome)))} + recorded ${money(Math.round(amt))} a month` : ''}">${l}</button>`; }).join('')}</span>
                          <span class="fc-basis-sep"></span>
                          <span class="fc-basis-label">${icon('target')}Expenses from</span><span class="seg-chips sm fc-basis">${Object.entries(SPEND).map(([k, [l, h]]) =>
                              `<button type="button" class="seg-chip ${(f.expenseBasis || 'BUDGET') === k ? 'active' : ''}" data-expense-basis="${k}" title="${esc(h)}">${l}</button>`).join('')}</span>
                          ${Number(f.unbudgetedSpend) > 0 && f.expenseBasis !== 'BUDGET_HISTORY' ? `<span class="fc-basis-hint" title="Spent a month (3-month average) in categories without a budget: not projected">${icon('info')}${moneyShort(Number(f.unbudgetedSpend))}/mo not budgeted</span>` : ''}
                      </div>
                      ${basisNote ? `<div class="fc-basis-note">${icon('info')}<span>${basisNote}</span></div>` : ''}
                      <div class="scroll fc-table-wrap"><table class="grid fc-table">
                      <colgroup><col class="c-month"><col span="5"><col class="c-earn"><col span="4"></colgroup>
                      <thead><tr><th>Month</th><th class="r">Income</th><th class="r">Expenses</th><th class="r" title="Installments, less the expected dividends">Chit dues</th><th class="r">Chit payouts</th><th class="r">EMIs & SIPs</th>
                          <th class="r fc-e g">Earnings</th><th class="r g" title="Deposits maturing and money given coming back">Maturities</th><th class="r">Net</th><th class="r">Cash & bank</th><th class="r">Net worth</th></tr></thead>
                      <tbody>${rows.map((r, i) => {
                          const net = Number(r.netCashFlow) + r.extraCash;
                          const low = r.liquid < buffer;
                          return `<tr class="fc-row ${monthOpen(r.month, rates) ? 'open' : ''} ${low ? 'low' : ''}" data-fc-month="${r.month}">
                              <td><span class="fc-caret">${icon('chevron-right')}</span><b>${rowLabel(r.month, i)}</b>${r.events.length ? `<span class="fc-n" title="${r.events.length} dated item${r.events.length === 1 ? '' : 's'}">${r.events.length}</span>` : ''}</td>
                              <td class="r pos" title="Recurring ${money(Math.round(r.incomeRecurring || 0))} · recorded ${money(Math.round(r.incomeRecorded || 0))}">${dash(r.income)}</td>
                              <td class="r neg">${dash(r.expenses)}</td>
                              <td class="r">${Number(r.chitInstallments) ? money(Math.round(Number(r.chitInstallments) - r.cash.dividends)) : '<span class="muted">—</span>'}</td>
                              <td class="r pos">${dash(r.chitPayouts)}</td><td class="r">${dash(r.transfersOut)}</td>
                              <td class="r fc-e g"><span class="fc-earn-cell">${earnBar(r)}<b class="pos">${dash(r.earned)}</b></span></td>
                              <td class="r g">${r.cash.back ? `<b class="pos">${money(Math.round(r.cash.back))}</b>` : '<span class="muted">—</span>'}</td>
                              <td class="r"><b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${money(Math.abs(Math.round(net)))}</b></td>
                              <td class="r fc-cash-cell ${low ? 'low' : ''}" style="--w:${Math.max(0, r.liquid) / maxCash * 100}%" title="${low ? 'Below the safety buffer · ' : ''}${moneyShort(r.baseLiquid)} without earnings & maturities"><b>${money(Math.round(r.liquid))}</b></td>
                              <td class="r">${money(Math.round(r.netWorth))}</td></tr>
                          <tr class="fc-detail" data-fc-detail="${r.month}" ${monthOpen(r.month, rates) ? '' : 'hidden'}><td colspan="11">${monthDetail(r, i === 0 ? null : rows[i - 1], i === 0 ? start : rows[i - 1].liquid, { basisLabel: BASIS[f.incomeBasis]?.[0] || '', buffer, outOf, startNetWorth: Number(f.startingNetWorth), first: i === 0 })}</td></tr>`;
                      }).join('')}</tbody>
                      <tfoot><tr class="total"><td>${f.months} months</td><td class="r">${money(sum(rows, r => r.income))}</td><td class="r">${money(sum(rows, r => r.expenses))}</td>
                          <td class="r">${money(sum(rows, r => Number(r.chitInstallments) - r.cash.dividends))}</td><td class="r">${money(sum(rows, r => r.chitPayouts))}</td><td class="r">${money(sum(rows, r => r.transfersOut))}</td>
                          <td class="r fc-e g"><b>${money(Math.round(p.earned))}</b></td><td class="r g">${money(sum(rows, r => r.cash.back))}</td>
                          <td class="r">${money(sum(rows, r => Number(r.netCashFlow) + r.extraCash))}</td><td class="r"><b>${money(Math.round(last.liquid))}</b></td><td class="r">${money(Math.round(last.netWorth))}</td></tr></tfoot>
                  </table></div>` })}

        ${panel({ title: 'Money in vs out', iconName: 'transfer', cls: 'p-fc-flow',
                  body: `<div class="chart fc-chart sm" id="fc-flow"></div>${legend([{ label: 'Money in' }, { label: 'Money out' }])}` })}
        ${panel({ title: 'Projected net worth', iconName: 'trending', cls: 'p-fc-nw', sub: `${nwChange >= 0 ? '+' : '−'}${moneyShort(Math.abs(nwChange))} over ${f.months} months`,
                  body: `<div class="chart fc-chart sm" id="fc-nw"></div>${legend([{ label: 'With earnings', color: 'var(--series-1)' }, { label: 'Without', color: 'var(--series-8)' }], 'line')}` })}
        ${panel({ title: 'Inputs', iconName: 'info', cls: 'p-fc-side',
                  actions: `<div class="tabs sm" id="side-tabs">
                      <button class="tab ${settings.sideTab === 'events' ? 'active' : ''}" data-side="events">Events</button>
                      <button class="tab ${settings.sideTab === 'categories' ? 'active' : ''}" data-side="categories">Spending</button>
                      <button class="tab ${settings.sideTab === 'assumptions' ? 'active' : ''}" data-side="assumptions">Assumptions</button></div>`,
                  body: '<div id="side-content" class="fc-side-body"></div>' })}`;

    const labelFormat = l => monthLabel(l);
    const cashSeries = [
        rates.lines.earn && { name: 'With earnings & maturities', values: rows.map(r => Math.round(r.liquid)), color: 'var(--series-1)' },
        rates.lines.base && { name: 'Income & spending only', values: rows.map(r => Math.round(r.baseLiquid)), color: 'var(--series-8)', dashed: true },
        rates.lines.buffer && { name: 'Safety buffer (3 months out)', values: rows.map(() => Math.round(buffer)), color: 'var(--series-4)', dashed: true },
    ].filter(Boolean);
    const cashEl = body.querySelector('#fc-cash');
    if (cashSeries.length) lineChart(cashEl, { labels, labelFormat, format: moneyShort, area: !!rates.lines.earn && cashSeries.length === 1, includeZero: lowestIsNegative, series: cashSeries });
    else cashEl.innerHTML = '<div class="empty">Pick a line to show.</div>';
    if (p.earned > 0.5) bindEarnings(body.querySelector('.p-fc-earn'), p, rates);
    barChart(body.querySelector('#fc-flow'), {
        labels, labelFormat, format: moneyShort,
        series: [{ name: 'Money in', values: rows.map(r => Number(r.income) + Number(r.chitPayouts) + Number(r.transfersIn) + r.extraCash - r.cash.dividends) },
            { name: 'Money out', values: rows.map(outOf) }],
    });
    lineChart(body.querySelector('#fc-nw'), {
        labels, labelFormat, format: moneyShort,
        series: [{ name: 'With earnings', values: rows.map(r => Math.round(r.netWorth)), color: 'var(--series-1)' },
            { name: 'Without', values: rows.map(r => Math.round(r.baseNetWorth)), color: 'var(--series-8)', dashed: true }],
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
                { label: 'Category', render: c => `<span class="${Number(c.monthlyAmount) ? '' : 'muted'}">${esc(c.name)}</span>` },
                { label: 'From', render: c => `<span class="badge ${c.basis.startsWith('Budget') ? '' : c.basis === 'Not budgeted' ? 'warning' : 'gray'}">${esc(c.basis)}</span>` },
                { label: 'Per month', align: 'r', render: c => Number(c.monthlyAmount) ? money(c.monthlyAmount) : '<span class="muted">—</span>' },
                { label: 'Spent (3 mo avg)', align: 'r', render: c => Number(c.historyAverage) ? `<span class="muted">${moneyShort(Number(c.historyAverage))}</span>` : '' },
            ], f.categories, { compact: true, empty: 'No budgets or spending yet' });
        } else {
            side.innerHTML = `<ul class="assumptions">${f.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}
                ${p.notes.map(n => `<li>${esc(n)}</li>`).join('')}
                <li>Deposits compound quarterly and land in cash on their maturity date; money given earns its own rate${rates.repay ? ' and comes back on its due date' : ''}.</li>
                <li>Safety buffer: three months of what goes out (expenses, chit dues, EMIs and SIPs), ${money(Math.round(buffer))}.</li>
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

/**
 * Earnings by month: five ways to look at it (stacked bars, a line per source, the running total, the mix, a table) and
 * the sources to show (tap a source to hide it). Only this panel redraws; the choice is kept for next time.
 */
function bindEarnings(el, p, rates) {
    const host = el.querySelector('#fc-earn');
    const srcHost = el.querySelector('#fc-earn-srcs');
    const rows = p.rows;
    const labels = rows.map(r => r.month);
    const labelFormat = l => monthLabel(l);
    const have = SOURCES.filter(s => p.total[s] > 0.5);
    const paint = () => {
        const on = have.filter(s => !rates.earnHide.includes(s));
        const view = EARN_VIEWS.some(v => v[0] === rates.earnView) ? rates.earnView : 'stacked';
        el.querySelectorAll('[data-earn-view]').forEach(b => b.classList.toggle('active', b.dataset.earnView === view));
        host._chartObserver?.disconnect();   // a chart drawn here before would redraw itself over a table on resize
        host.className = `fe-view fe-${view}`;
        srcHost.innerHTML = have.map(s => `<button type="button" class="fe-src ${on.includes(s) ? '' : 'off'}" data-earn-src="${s}" title="${on.includes(s) ? 'Hide' : 'Show'} ${SOURCE_LABEL[s]}">
            <i style="background:${SOURCE_COLOR[s]}"></i><span>${SOURCE_LABEL[s]}</span><b>${moneyShort(p.total[s])}</b><small>${p.earned ? Math.round(p.total[s] / p.earned * 100) : 0}%</small></button>`).join('');
        if (!on.length) { host.innerHTML = '<div class="empty">Pick a source below.</div>'; return; }
        const monthTotal = r => on.reduce((t, s) => t + r.earn[s], 0);
        const series = on.map(s => ({ name: SOURCE_LABEL[s], color: SOURCE_COLOR[s], values: rows.map(r => Math.round(r.earn[s])) }));
        if (view === 'lines') {
            lineChart(host, { labels, labelFormat, format: moneyShort, includeZero: true,
                series: on.length > 1 ? [...series, { name: 'All shown', color: 'var(--series-8)', dashed: true, values: rows.map(r => Math.round(monthTotal(r))) }] : series });
        } else if (view === 'running') {
            const run = values => { let c = 0; return values.map(v => Math.round(c += v)); };
            const total = run(rows.map(monthTotal));
            lineChart(host, { labels, labelFormat, format: moneyShort, includeZero: true, area: on.length === 1,
                series: on.length > 1 ? [{ name: 'All shown', color: 'var(--series-1)', values: total }, ...series.map(x => ({ ...x, values: run(x.values), dashed: true }))]
                    : [{ ...series[0], values: total }] });
        } else if (view === 'mix') {
            const total = on.reduce((t, s) => t + p.total[s], 0);
            host.innerHTML = `<div class="fe-mix"><div class="chart fe-donut"></div><div class="fe-mix-list">${on.map(s => {
                const peak = rows.reduce((m, r) => (r.earn[s] > m.earn[s] ? r : m), rows[0]);
                return `<div class="fe-mix-row"><i style="background:${SOURCE_COLOR[s]}"></i><span class="min-0"><b>${SOURCE_LABEL[s]}</b>
                    <small>${moneyShort(p.total[s] / rows.length)}/mo · peak ${monthLabel(peak.month)}</small></span><em>${total ? Math.round(p.total[s] / total * 100) : 0}%</em></div>`;
            }).join('')}</div></div>`;
            donutChart(host.querySelector('.fe-donut'), { items: on.map(s => ({ label: SOURCE_LABEL[s], value: Math.round(p.total[s]), color: SOURCE_COLOR[s] })),
                format: money, centerValue: moneyShort(total), centerLabel: `${rows.length} months` });
        } else if (view === 'table') {
            host.innerHTML = earnTable(rows, on, p);
        } else {
            barChart(host, { labels, labelFormat, format: moneyShort, stacked: true, series });
        }
    };
    el.addEventListener('click', e => {
        const v = e.target.closest('[data-earn-view]');
        const s = e.target.closest('[data-earn-src]');
        if (v) rates.earnView = v.dataset.earnView;
        else if (s) rates.earnHide = rates.earnHide.includes(s.dataset.earnSrc) ? rates.earnHide.filter(x => x !== s.dataset.earnSrc) : [...rates.earnHide, s.dataset.earnSrc];
        else return;
        setPref('projectionRates', rates);
        paint();
    });
    paint();
}

/** The earnings as a dense table that fits the panel: a column per source shown, the month's total and the running total. */
function earnTable(rows, on, p) {
    const total = r => on.reduce((t, s) => t + r.earn[s], 0);
    const max = Math.max(1, ...rows.map(total));
    const cell = v => (v >= 1 ? moneyShort(v) : '<span class="fe-nil">·</span>');
    const short = m => `${new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString('en', { month: 'short' })} ’${m.slice(2, 4)}`;
    let run = 0;
    return `<div class="fe-table-wrap"><table class="fe-table">
        <colgroup><col class="fe-c-m">${on.map(() => '<col>').join('')}<col class="fe-c-t"><col class="fe-c-r"></colgroup>
        <thead><tr><th>Month</th>${on.map(s => `<th title="${SOURCE_LABEL[s]}"><i style="background:${SOURCE_COLOR[s]}"></i>${SOURCE_SHORT[s]}</th>`).join('')}
            <th title="The sources shown, this month">Total</th><th title="Running total since today">Run</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const t = total(r);
            run += t;
            return `<tr><td title="${monthLabel(r.month)}${i === 0 ? ' (rest of the month)' : ''}">${short(r.month)}${i === 0 ? '<sup>*</sup>' : ''}</td>${on.map(s => `<td title="${SOURCE_LABEL[s]} ${money(Math.round(r.earn[s]))}">${cell(r.earn[s])}</td>`).join('')}
                <td class="fe-t" style="--w:${(t / max * 100).toFixed(1)}%"><b>${cell(t)}</b></td><td class="fe-r">${moneyShort(run)}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>All</td>${on.map(s => `<td>${moneyShort(p.total[s])}</td>`).join('')}<td class="fe-t"><b>${moneyShort(run)}</b></td><td class="fe-r">${moneyShort(run / rows.length)}<small>/mo</small></td></tr></tfoot>
    </table></div>`;
}

const sum = (list, f) => Math.round(list.reduce((t, r) => t + Number(f(r) || 0), 0));
const signedShort = v => `${v >= 0 ? '+' : '−'}${moneyShort(Math.abs(v))}`;
