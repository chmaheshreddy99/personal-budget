/**
 * Reports. The first four read /api/reports/insights: one period against the period of the same length
 * just before it, with plain-language highlights:
 *   Insights    what changed and what to act on: totals, highlights, trend, patterns, payees
 *   Categories  every expense and income category: change, share, budget use, size of a typical entry
 *   Accounts    activity per account: opening, in, out, closing, idle accounts, card utilisation
 *   Chits       each chit's contributions, dividends, value, return and what is still due
 * then the chit summary (selected chits together, printable for the organizer), followed by the statements:
 * income statement, trial balance, cash flow and expense analysis.
 * Each report has its own filters, chart(s), table and Excel / PDF / CSV export.
 */
import { api } from '../core/api.js';
import { panel, table, esc, stat, printElement, emptyState } from '../core/ui.js';
import { exportButton, bindExport } from '../core/export.js';
import { chitSummaryReport } from './chit-summary.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, isoDate, firstOfMonth, date } from '../core/format.js';
import { barChart, lineChart, donutChart, legend, seriesColor, foldOthers, sparkline } from '../core/charts.js';
import { categoryIcon, accountTypeIcon } from '../core/icons.js';
import { setPageKeys, listNavigator } from '../core/keys.js';

const REPORTS = [
    { key: 'insights', label: 'Insights', iconName: 'sparkles', note: 'What changed and what to act on' },
    { key: 'categories', label: 'Categories', iconName: 'tag', note: 'Spending and income by category' },
    { key: 'accounts', label: 'Accounts', iconName: 'wallet', note: 'Money in and out of every account' },
    { key: 'chits', label: 'Chits', iconName: 'chit', note: 'Contributions, value and returns' },
    { key: 'chit-summary', label: 'Chit summary', iconName: 'layers', note: 'Selected chits together, printable' },
    { key: 'income-statement', label: 'Income statement', iconName: 'report', note: 'Income, expenses and surplus' },
    { key: 'trial-balance', label: 'Trial balance', iconName: 'scale', note: 'Debit and credit balances' },
    { key: 'cash-flow', label: 'Cash flow', iconName: 'droplet', note: 'Money in and out of cash & bank' },
    { key: 'expense-analysis', label: 'Expense analysis', iconName: 'pie', note: 'Where the money went' },
];

/** Quick period choices for the date filters. */
const PRESETS = [
    { label: 'This month', from: () => firstOfMonth(0) },
    { label: 'Last month', from: () => firstOfMonth(-1), to: () => isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 0)) },
    { label: '3 months', from: () => firstOfMonth(-2) },
    { label: '6 months', from: () => firstOfMonth(-5) },
    { label: '12 months', from: () => firstOfMonth(-11) },
    { label: 'Year to date', from: () => `${new Date().getFullYear()}-01-01` },
];

const period = { from: firstOfMonth(-5), to: isoDate(), asOf: isoDate() };

/** The insights payload, shared by the four insight reports while the period stays the same. */
let insightCache = null;
async function insights() {
    const key = `${period.from}|${period.to}`;
    if (insightCache?.key !== key) insightCache = { key, data: await api.get('/reports/insights', { from: period.from, to: period.to }) };
    return insightCache.data;
}

export async function render(container, params, isCurrent) {
    const active = REPORTS.find(r => r.key === params[0]) || REPORTS[0];
    container.innerHTML = `
    <div class="page reports-page">
        ${panel({
            title: 'Reports', iconName: 'report', cls: 'p-report-nav',
            body: `<div class="list">${REPORTS.map((r, i) => `
                ${r.key === 'income-statement' ? '<div class="section-title report-nav-sep">Statements</div>' : ''}
                <a class="list-item clickable ${r.key === active.key ? 'selected' : ''}" href="#/reports/${r.key}" title="${r.label} · ↑ ↓ to move between reports">
                    <span class="chip-icon sm">${icon(r.iconName)}</span>
                    <div class="grow"><div class="title">${r.label}</div><div class="meta">${r.note}</div></div>
                </a>`).join('')}</div>`,
        })}
        <div class="report-area" id="report-area">
            <div class="page-toolbar glass report-toolbar" id="report-toolbar"></div>
            <div class="report-content" id="report-content"></div>
        </div>
    </div>`;

    // ↑ / ↓ (Home / End, PgUp / PgDn) through the reports: the selection moves at once, the report opens a moment later
    const nav = container.querySelector('.p-report-nav');
    let navTimer;
    setPageKeys(listNavigator({
        items: () => [...nav.querySelectorAll('a.list-item')],
        selected: () => nav.querySelector('a.list-item.selected'),
        select: el => {
            nav.querySelectorAll('a.list-item.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(navTimer);
            navTimer = setTimeout(() => { if (isCurrent()) location.hash = el.getAttribute('href'); }, 220);
        },
        open: el => { clearTimeout(navTimer); location.hash = el.getAttribute('href'); },
    }));
    nav.querySelector('a.list-item.selected')?.scrollIntoView({ block: 'nearest' });

    const toolbar = container.querySelector('#report-toolbar');
    const content = container.querySelector('#report-content');
    const usesAsOf = active.key === 'trial-balance';
    const ownToolbar = active.key === 'chit-summary';   // picks chits, not a period, and brings its own export

    toolbar.innerHTML = `
        <h2 class="page-title">${icon(active.iconName)} ${active.label}</h2>
        <span class="spacer"></span>
        ${ownToolbar ? '' : usesAsOf ? `<label class="row small secondary">As of <input type="date" id="asof" value="${period.asOf}"></label>` : `
            <div class="tabs sm" id="presets">${PRESETS.map((p, i) => `<button class="tab" data-preset="${i}">${p.label}</button>`).join('')}</div>
            <input type="date" id="from" value="${period.from}"><span class="muted">→</span><input type="date" id="to" value="${period.to}">`}
        ${ownToolbar ? '' : `${exportButton({ label: 'Export' })}
        <button class="btn sm" id="print" title="Print this report as shown, charts included">${icon('printer')}Print</button>`}`;

    let exportRows = () => [];
    insightCache = null;   // a fresh visit (or a live refresh) re-reads the books
    const load = async () => {
        content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        const drawer = { insights: insightsReport, categories: categoriesReport, accounts: accountsReport, chits: chitsReport,
                         'chit-summary': chitSummaryReport, 'income-statement': incomeStatement, 'trial-balance': trialBalance,
                         'cash-flow': cashFlow, 'expense-analysis': expenseAnalysis }[active.key];
        exportRows = await drawer(content, toolbar);
    };

    toolbar.querySelector('#presets')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-preset]');
        if (!btn) return;
        const p = PRESETS[Number(btn.dataset.preset)];
        period.from = p.from();
        period.to = p.to ? p.to() : isoDate();
        toolbar.querySelector('#from').value = period.from;
        toolbar.querySelector('#to').value = period.to;
        load();
    });
    ['#from', '#to', '#asof'].forEach(sel => toolbar.querySelector(sel)?.addEventListener('change', e => {
        period[sel.slice(1) === 'asof' ? 'asOf' : sel.slice(1)] = e.target.value;
        load();
    }));
    // Excel / PDF / CSV from the report's table rows: the first row is the header; numbers become money columns
    if (!ownToolbar) bindExport(toolbar, () => {
        const [head = [], ...rows] = exportRows();
        const numeric = head.map((_, i) => rows.length > 0 && rows.every(row => row[i] === null || row[i] === '' || row[i] === undefined || !Number.isNaN(Number(row[i]))));
        const kind = (label, i) => /%/.test(label) ? 'percent' : /date|due$/i.test(label) && rows.some(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row[i] ?? ''))) ? 'date'
            : numeric[i] && rows.some(row => row[i] !== null && row[i] !== '' && row[i] !== undefined) ? 'money' : 'text';
        return {
            title: active.label, subtitle: usesAsOf ? `As of ${date(period.asOf)}` : `${date(period.from)} – ${date(period.to)}`,
            filename: `${active.key}-${usesAsOf ? period.asOf : `${period.from}-to-${period.to}`}`,
            sheets: [{ name: active.label, columns: head.map((label, i) => ({ label: String(label), type: kind(String(label), i) })),
                rows: rows.map(row => row.map((v, i) => (numeric[i] && v !== null && v !== '' && v !== undefined ? Number(v) : v ?? ''))) }],
        };
    });
    toolbar.querySelector('#print')?.addEventListener('click', () => printElement(content, active.label));

    if (isCurrent()) await load();
}

// ===================================================================== insight helpers

const TONE_ICON = { good: 'check-circle', warn: 'alert', info: 'info' };
const AREA_LINK = { Savings: '#/reports/categories', Spending: '#/expenses', Categories: '#/reports/categories',
    Budgets: '#/planning', Income: '#/income', Accounts: '#/reports/accounts', Chits: '#/reports/chits', Pattern: '#/expenses' };

/** ▲ / ▼ with the change in percent; "up is bad" for spending. */
function delta(pct, upIsGood = true) {
    if (pct === null || pct === undefined) return '<span class="muted">new</span>';
    const v = Number(pct);
    if (Math.abs(v) < 0.05) return '<span class="muted">no change</span>';
    const good = (v > 0) === upIsGood;
    return `<span class="${good ? 'pos' : 'neg'}">${v > 0 ? '▲' : '▼'} ${percent(Math.abs(v), 0)}</span>`;
}

function periodNote(p) {
    return `${date(p.from)} → ${date(p.to)} · vs ${date(p.previousFrom)} → ${date(p.previousTo)}`;
}

function highlightCards(list) {
    if (!list.length) return emptyState('Nothing stands out in this period', 'sparkles');
    return `<div class="insight-grid">${list.map(h => `
        <a class="insight-card ${h.tone}" href="${AREA_LINK[h.area] || '#/reports'}">
            <span class="ic-icon">${icon(TONE_ICON[h.tone] || 'info')}</span>
            <span class="grow min-0"><span class="ic-head"><span class="ic-title">${esc(h.area)}</span></span>
                <b class="small">${esc(h.title)}</b><span class="ic-text">${esc(h.detail)}</span></span></a>`).join('')}</div>`;
}

// ===================================================================== insights

async function insightsReport(el) {
    const r = await insights();
    const s = r.summary;
    el.className = 'report-content insights';
    const topCats = r.expenseCategories.filter(c => Number(c.amount) > 0).slice(0, 8);
    const maxCat = Math.max(1, ...topCats.map(c => Number(c.amount)));
    el.innerHTML = `
        <div class="stat-strip report-stats">
            ${stat('Income', `<span class="pos">${money(s.income)}</span>`, `${delta(s.incomeChangePercent)} · was ${moneyShort(s.previousIncome)}`)}
            ${stat('Spent', `<span class="neg">${money(s.expense)}</span>`, `${delta(s.expenseChangePercent, false)} · was ${moneyShort(s.previousExpense)}`)}
            ${stat('Saved', `<span class="${Number(s.net) >= 0 ? 'pos' : 'neg'}">${money(s.net)}</span>`, `${percent(s.savingsRate, 0)} of income`)}
            ${stat('Per day', money(s.averageDailySpend), `${r.period.days} days · ${s.entries} entries`)}
            ${stat('Net worth', money(s.netWorth), `<span class="${Number(s.netWorthChange) >= 0 ? 'pos' : 'neg'}">${Number(s.netWorthChange) >= 0 ? '+' : '−'}${moneyShort(Math.abs(Number(s.netWorthChange)))}</span> in the period`)}
            ${stat('Chits running', String(r.chitTotals.active), `${moneyShort(r.chitTotals.paidInPeriod)} paid in · ${moneyShort(r.chitTotals.dividendsInPeriod)} dividends`)}
        </div>
        ${panel({ title: 'Highlights', iconName: 'sparkles', cls: 'p-ri-high', bodyClass: 'scroll', sub: periodNote(r.period),
                  body: highlightCards(r.highlights) })}
        ${panel({ title: 'Income vs spending', iconName: 'trending', cls: 'p-ri-trend', bodyClass: 'chart',
                  body: `<div class="chart-wrap">${legend([{ label: 'Income' }, { label: 'Spent' }])}<div class="chart" id="ri-trend"></div></div>` })}
        ${panel({ title: 'Where it went', iconName: 'pie', cls: 'p-ri-cats', bodyClass: 'scroll',
                  actions: `<a class="btn sm ghost" href="#/reports/categories">All ${icon('chevron-right')}</a>`,
                  body: topCats.length ? `<div class="cat-bars">${topCats.map(c => {
                      const ci = categoryIcon(c.name);
                      const budget = c.budget ? Number(c.budget) : null;
                      const over = budget && Number(c.amount) > budget;
                      return `<div class="cat-bar"><span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
                        <div class="grow min-0"><div class="row small"><span class="ellipsis">${esc(c.name)}</span><span class="tiny">${delta(c.changePercent, false)}</span>
                            <span class="spacer"></span><b class="mono ${over ? 'neg' : ''}">${money(c.amount)}</b></div>
                        <div class="bar-track"><span class="bar-fill ${over ? 'over' : ''}" style="width:${(Number(c.amount) / Math.max(maxCat, budget || 0)) * 100}%"></span>
                            ${budget ? `<i class="bar-limit" style="left:${(budget / Math.max(maxCat, budget)) * 100}%" title="Budget ${money(budget)}"></i>` : ''}</div></div></div>`;
                  }).join('')}</div>` : emptyState('Nothing spent in this period', 'pie') })}
        ${panel({ title: 'By weekday', iconName: 'calendar', cls: 'p-ri-week', bodyClass: 'chart',
                  body: `<div class="chart-wrap"><div class="chart" id="ri-week"></div></div>` })}
        ${panel({ title: 'Top payees', iconName: 'users', cls: 'p-ri-payees', bodyClass: 'scroll',
                  body: r.topPayees.length ? `<div class="list">${r.topPayees.map((p, i) => `
                    <div class="list-item"><span class="rank">${i + 1}</span><div class="grow ellipsis small">${esc(p.label)}</div>
                        <span class="tiny muted">${percent(Number(p.value) / (Number(s.expense) || 1) * 100, 0)}</span><b class="mono">${money(p.value)}</b></div>`).join('')}</div>`
                      : emptyState('No payees yet', 'users') })}
        ${panel({ title: 'Largest expenses', iconName: 'flag', cls: 'p-ri-large', bodyClass: 'scroll',
                  body: r.largestExpenses.length ? `<div class="list">${r.largestExpenses.map(t => `
                    <div class="list-item"><div class="grow ellipsis small">${esc(t.label)}</div><b class="mono">${money(t.value)}</b></div>`).join('')}</div>`
                      : emptyState('No expenses in this period', 'flag') })}`;

    barChart(el.querySelector('#ri-trend'), {
        labels: r.monthly.map(m => m.month), labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Income', values: r.monthly.map(m => Number(m.income)) },
                 { name: 'Spent', values: r.monthly.map(m => Number(m.expense)) }],
    });
    barChart(el.querySelector('#ri-week'), {
        labels: r.weekdaySpend.map(p => p.label), format: moneyShort,
        series: [{ name: 'Spent', values: r.weekdaySpend.map(p => Number(p.value)) }],
    });
    return () => [['Area', 'Tone', 'Highlight', 'Detail'], ...r.highlights.map(h => [h.area, h.tone, h.title, h.detail]),
        [], ['Month', 'Income', 'Spent', 'Net'], ...r.monthly.map(m => [m.month, m.income, m.expense, m.net]),
        [], ['Payee', 'Spent'], ...r.topPayees.map(p => [p.label, p.value])];
}

// ===================================================================== categories

async function categoriesReport(el) {
    const r = await insights();
    el.className = 'report-content categories';
    const months = r.monthly.map(m => m.month);
    const rows = (list, kind) => list.length ? `<table class="grid compact">
        <thead><tr><th>${kind === 'EXPENSE' ? 'Expense category' : 'Income category'}</th><th class="r">Amount</th><th class="r">Previous</th>
            <th class="r">Change</th><th class="r">Share</th>${kind === 'EXPENSE' ? '<th class="r">Budget</th>' : ''}<th class="r">Entries</th>
            <th class="r">Typical</th><th class="r">Largest</th><th>Trend</th></tr></thead>
        <tbody>${list.map(c => {
            const ci = categoryIcon(c.name);
            const used = c.budgetUsedPercent === null ? null : Number(c.budgetUsedPercent);
            return `<tr><td><span class="row"><span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span><b class="ellipsis">${esc(c.name)}</b></span></td>
                <td class="r strong">${money(c.amount)}</td><td class="r muted">${money(c.previous)}</td>
                <td class="r">${Number(c.change) ? `${Number(c.change) > 0 ? '+' : '−'}${moneyShort(Math.abs(Number(c.change)))} ${delta(c.changePercent, kind !== 'EXPENSE')}` : '<span class="muted">—</span>'}</td>
                <td class="r">${percent(c.share, 0)}</td>
                ${kind === 'EXPENSE' ? `<td class="r">${used === null ? '<span class="muted">—</span>'
                    : `<span class="${used > 100 ? 'neg' : used >= 80 ? 'warn-text' : 'pos'}" title="${money(c.amount)} of ${money(c.budget)}">${percent(used, 0)}</span>`}</td>` : ''}
                <td class="r">${c.entries}</td><td class="r">${c.entries ? money(c.averagePerEntry) : '—'}</td><td class="r">${Number(c.largest) ? money(c.largest) : '—'}</td>
                <td>${months.length > 1 ? sparkline(c.byMonth, { color: kind === 'EXPENSE' ? 'var(--series-4)' : 'var(--series-2)' }) : ''}</td></tr>`;
        }).join('')}</tbody></table>` : emptyState(`No ${kind === 'EXPENSE' ? 'spending' : 'income'} in this period`, 'tag');

    const items = foldOthers(r.expenseCategories.filter(c => Number(c.amount) > 0).map(c => ({ label: c.name, value: Number(c.amount) })));
    const movers = [...r.expenseCategories].filter(c => Number(c.change)).sort((a, b) => Math.abs(Number(b.change)) - Math.abs(Number(a.change))).slice(0, 6);
    el.innerHTML = `
        ${panel({ title: 'Spending mix', iconName: 'pie', cls: 'p-rc-donut', bodyClass: 'chart',
                  body: items.length ? `<div class="donut-wrap"><div class="chart" id="rc-donut"></div><div class="donut-legend scroll">${items.map((it, i) => `
                        <div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                        <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('')}</div></div>` : emptyState('Nothing spent', 'pie') })}
        ${panel({ title: 'Biggest moves', iconName: 'trending', cls: 'p-rc-movers', bodyClass: 'scroll', sub: 'vs the previous period',
                  body: movers.length ? `<div class="list">${movers.map(c => `
                    <div class="list-item"><span class="chip-icon sm ${Number(c.change) > 0 ? 'coral' : 'aqua'}">${icon(Number(c.change) > 0 ? 'arrow-up' : 'arrow-down')}</span>
                        <div class="grow min-0"><div class="title ellipsis">${esc(c.name)}</div><div class="meta">${money(c.previous)} → ${money(c.amount)}</div></div>
                        <b class="${Number(c.change) > 0 ? 'neg' : 'pos'}">${Number(c.change) > 0 ? '+' : '−'}${moneyShort(Math.abs(Number(c.change)))}</b></div>`).join('')}</div>`
                      : emptyState('No change from the previous period', 'trending') })}
        ${panel({ title: 'Expense categories', iconName: 'arrow-out', cls: 'p-rc-exp', bodyClass: 'flush', sub: `${money(r.summary.expense)} · ${periodNote(r.period)}`,
                  body: `<div class="scroll" style="height:100%">${rows(r.expenseCategories, 'EXPENSE')}</div>` })}
        ${panel({ title: 'Income categories', iconName: 'arrow-in', cls: 'p-rc-inc', bodyClass: 'flush', sub: money(r.summary.income),
                  body: `<div class="scroll" style="height:100%">${rows(r.incomeCategories, 'INCOME')}</div>` })}`;
    if (items.length) donutChart(el.querySelector('#rc-donut'), { items, format: v => money(v), centerValue: moneyShort(r.summary.expense), centerLabel: 'spent' });
    const csv = (kind, list) => list.map(c => [kind, c.code, c.name, c.amount, c.previous, c.change, c.changePercent, c.share, c.budget, c.budgetUsedPercent, c.entries, c.averagePerEntry, c.largest]);
    return () => [['Kind', 'Code', 'Category', 'Amount', 'Previous', 'Change', 'Change %', 'Share %', 'Budget', 'Budget used %', 'Entries', 'Typical', 'Largest'],
        ...csv('Expense', r.expenseCategories), ...csv('Income', r.incomeCategories)];
}

// ===================================================================== accounts

async function accountsReport(el) {
    const r = await insights();
    el.className = 'report-content accounts';
    const list = r.accounts.filter(a => Number(a.opening) || Number(a.closing) || a.entries);
    const assets = list.filter(a => a.accountClass === 'ASSET');
    const debts = list.filter(a => a.accountClass === 'LIABILITY');
    const sum = (xs, f) => xs.reduce((s, a) => s + Number(a[f]), 0);
    const idle = list.filter(a => a.daysIdle !== null && a.daysIdle > 90 && Number(a.closing) && ['Liquid money', 'Investments'].includes(a.bucket));
    const movers = [...list].sort((a, b) => Math.abs(Number(b.change)) - Math.abs(Number(a.change))).filter(a => Number(a.change)).slice(0, 10);
    const groups = new Map();
    list.forEach(a => { const k = `${a.accountClass}|${a.bucket}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
    const debt = a => a.accountClass === 'LIABILITY';

    el.innerHTML = `
        <div class="stat-strip report-stats">
            ${stat('Assets', money(sum(assets, 'closing')), `${Number(sum(assets, 'change')) >= 0 ? '+' : '−'}${moneyShort(Math.abs(sum(assets, 'change')))} in the period`)}
            ${stat('Debts', money(sum(debts, 'closing')), `${sum(debts, 'change') <= 0 ? '−' : '+'}${moneyShort(Math.abs(sum(debts, 'change')))} in the period`)}
            ${stat('Money in', `<span class="pos">${money(sum(assets, 'inflow'))}</span>`, 'into your assets')}
            ${stat('Money out', `<span class="neg">${money(sum(assets, 'outflow'))}</span>`, 'out of your assets')}
            ${stat('Active accounts', String(list.filter(a => a.entries).length), `of ${list.length} with a balance`)}
            ${stat('Idle', String(idle.length), idle.length ? `${moneyShort(sum(idle, 'closing'))} untouched 90+ days` : 'everything is moving')}
        </div>
        ${panel({ title: 'Account activity', iconName: 'list', cls: 'p-ra-table', bodyClass: 'flush', sub: periodNote(r.period),
                  body: `<div class="scroll" style="height:100%"><table class="grid compact">
                    <thead><tr><th>Account</th><th class="r">Opening</th><th class="r">In</th><th class="r">Out</th><th class="r">Closing</th>
                        <th class="r">Change</th><th class="r">Entries</th><th>Last activity</th></tr></thead>
                    <tbody>${[...groups.entries()].map(([k, items]) => `
                        <tr class="group-row"><td colspan="8"><b>${esc(k.split('|')[1])}</b> <span class="muted small">${items.length} · ${money(sum(items, 'closing'))}</span></td></tr>
                        ${items.map(a => {
                            const t = accountTypeIcon(a.accountType);
                            const grew = Number(a.change) > 0;
                            return `<tr class="clickable" data-ledger="${a.accountId}">
                                <td><span class="row"><span class="chip-icon xs ${t.tone}">${icon(t.name)}</span><b class="ellipsis">${esc(a.name)}</b>
                                    <span class="muted small">${esc(a.typeLabel)}</span>
                                    ${a.utilization !== null ? `<span class="badge ${Number(a.utilization) > 30 ? 'warning' : 'good'}" title="Card limit used">${percent(a.utilization, 0)} used</span>` : ''}</span></td>
                                <td class="r muted">${money(a.opening)}</td><td class="r ${debt(a) ? '' : 'pos'}">${Number(a.inflow) ? money(a.inflow) : '—'}</td>
                                <td class="r ${debt(a) ? '' : 'neg'}">${Number(a.outflow) ? money(a.outflow) : '—'}</td><td class="r strong">${money(a.closing)}</td>
                                <td class="r ${Number(a.change) === 0 ? 'muted' : (grew !== debt(a)) ? 'pos' : 'neg'}">${Number(a.change) ? `${grew ? '+' : '−'}${moneyShort(Math.abs(Number(a.change)))}` : '—'}</td>
                                <td class="r">${a.entries || '—'}</td>
                                <td>${a.lastActivity ? `${date(a.lastActivity)}${a.daysIdle > 90 ? ` <span class="badge warning">idle ${Math.round(a.daysIdle / 30)} mo</span>` : ''}` : '<span class="muted">never</span>'}</td></tr>`;
                        }).join('')}`).join('')}</tbody></table></div>` })}
        ${panel({ title: 'Biggest movers', iconName: 'trending', cls: 'p-ra-movers', bodyClass: 'scroll', sub: 'balance change in the period',
                  body: movers.length ? `<div class="cat-bars">${movers.map(a => {
                      const t = accountTypeIcon(a.accountType);
                      const good = (Number(a.change) > 0) !== debt(a);
                      const max = Math.abs(Number(movers[0].change)) || 1;
                      return `<div class="cat-bar"><span class="chip-icon sm ${t.tone}">${icon(t.name)}</span>
                        <div class="grow min-0"><div class="row small"><span class="ellipsis">${esc(a.name)}</span><span class="spacer"></span>
                            <b class="mono ${good ? 'pos' : 'neg'}">${Number(a.change) > 0 ? '+' : '−'}${moneyShort(Math.abs(Number(a.change)))}</b></div>
                        <div class="bar-track"><span class="bar-fill ${good ? '' : 'over'}" style="width:${Math.abs(Number(a.change)) / max * 100}%"></span></div>
                        <div class="tiny muted">${moneyShort(a.opening)} → ${moneyShort(a.closing)}${a.changePercent !== null ? ` · ${delta(a.changePercent, !debt(a))}` : ''}</div></div></div>`;
                  }).join('')}</div>` : emptyState('No balances moved', 'trending') })}`;
    el.querySelector('.p-ra-table').addEventListener('click', e => {
        const row = e.target.closest('[data-ledger]');
        if (row) location.hash = '#/accounts';
    });
    return () => [['Account', 'Type', 'Group', 'Opening', 'In', 'Out', 'Closing', 'Change', 'Entries', 'Last activity', 'Card used %'],
        ...list.map(a => [a.name, a.typeLabel, a.bucket, a.opening, a.inflow, a.outflow, a.closing, a.change, a.entries, a.lastActivity, a.utilization])];
}

// ===================================================================== chits

async function chitsReport(el) {
    const r = await insights();
    const t = r.chitTotals;
    el.className = 'report-content chits';
    if (!r.chits.length) {
        el.innerHTML = panel({ title: 'Chits', iconName: 'chit', body: emptyState('No chits yet. Add one on the Chits page.', 'chit') });
        return () => [];
    }
    el.innerHTML = `
        <div class="stat-strip report-stats">
            ${stat('Paid in (period)', money(t.paidInPeriod), `${moneyShort(t.dividendsInPeriod)} dividends earned`)}
            ${stat('Paid in so far', money(t.paidIn), `${t.active} running chit${t.active === 1 ? '' : 's'}`)}
            ${stat('Still to pay', money(t.stillToPay), 'future installments')}
            ${stat('Value today', `<span class="pos">${money(t.currentValue)}</span>`, `${moneyShort(t.interestEarned)} interest earned`)}
            ${stat('Expected gain', `<span class="${Number(t.projectedNetGain) >= 0 ? 'pos' : 'neg'}">${money(t.projectedNetGain)}</span>`, 'at maturity')}
            ${stat('Average return', t.averageRate === null ? '—' : `${percent(t.averageRate, 1)} a year`, 'weighted by money paid in')}
        </div>
        ${panel({ title: 'Paid in vs value today', iconName: 'chit', cls: 'p-rch-bars', bodyClass: 'chart',
                  body: `<div class="chart-wrap">${legend([{ label: 'Paid in' }, { label: 'Value today' }])}<div class="chart" id="rch-bars"></div></div>` })}
        ${panel({ title: 'Chit by chit', iconName: 'list', cls: 'p-rch-table', bodyClass: 'flush', sub: periodNote(r.period),
                  body: `<div class="scroll" style="height:100%"><table class="grid compact">
                    <thead><tr><th>Chit</th><th>Status</th><th class="r">Paid (period)</th><th class="r">Dividends (period)</th><th class="r">Paid in</th>
                        <th class="r">Still to pay</th><th class="r">Value today</th><th class="r">Return / yr</th><th class="r">Expected gain</th><th>Progress</th><th>Next due</th></tr></thead>
                    <tbody>${r.chits.map(c => `<tr class="clickable" data-chit="${c.chitId}">
                        <td><b>${esc(c.name)}</b>${c.organizer ? ` <span class="muted small">${esc(c.organizer)}</span>` : ''}</td>
                        <td>${statusBadgeHtml(c.status)}${c.overdueCount ? ` <span class="badge critical">${c.overdueCount} overdue</span>` : ''}</td>
                        <td class="r">${Number(c.paidInPeriod) ? money(c.paidInPeriod) : '—'}</td>
                        <td class="r pos">${Number(c.dividendsInPeriod) ? money(c.dividendsInPeriod) : '—'}</td>
                        <td class="r">${money(c.paidIn)}</td><td class="r muted">${money(c.stillToPay)}</td>
                        <td class="r strong">${money(c.currentValue)}</td>
                        <td class="r">${c.annualRate === null ? '—' : percent(c.annualRate, 1)}</td>
                        <td class="r ${Number(c.projectedNetGain) >= 0 ? 'pos' : 'neg'}">${money(c.projectedNetGain)}</td>
                        <td><span class="progress-mini" title="${percent(c.progressPercent, 0)}"><i style="width:${Math.min(100, Number(c.progressPercent))}%"></i></span> <span class="small muted">${percent(c.progressPercent, 0)}</span></td>
                        <td>${c.nextDueDate ? `${date(c.nextDueDate)} <span class="muted small">${moneyShort(c.nextDueAmount)}</span>` : `<span class="muted">matures ${date(c.maturityDate)}</span>`}</td></tr>`).join('')}</tbody>
                  </table></div>` })}`;
    barChart(el.querySelector('#rch-bars'), {
        labels: r.chits.map(c => c.name), format: moneyShort,
        series: [{ name: 'Paid in', values: r.chits.map(c => Number(c.paidIn)) },
                 { name: 'Value today', values: r.chits.map(c => Number(c.currentValue)) }],
    });
    el.querySelector('.p-rch-table').addEventListener('click', e => { if (e.target.closest('[data-chit]')) location.hash = '#/chits'; });
    return () => [['Chit', 'Status', 'Paid (period)', 'Dividends (period)', 'Paid in', 'Still to pay', 'Value today', 'Interest earned', 'Return % / yr', 'Expected gain', 'Progress %', 'Next due', 'Next amount'],
        ...r.chits.map(c => [c.name, c.status, c.paidInPeriod, c.dividendsInPeriod, c.paidIn, c.stillToPay, c.currentValue, c.interestEarned, c.annualRate, c.projectedNetGain, c.progressPercent, c.nextDueDate, c.nextDueAmount])];
}

function statusBadgeHtml(status) {
    const tone = { ACTIVE: 'good', PRIZED: 'aqua', MATURED: 'gray', CLOSED: 'gray' }[status] || 'gray';
    return `<span class="badge ${tone}">${esc(status.charAt(0) + status.slice(1).toLowerCase())}</span>`;
}

// ===================================================================== income statement

async function incomeStatement(el) {
    const r = await api.get('/reports/income-statement', { from: period.from, to: period.to });
    const side = (title, rows, total, cls) => `
        <table class="grid compact">
            <thead><tr><th>${title}</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
            <tbody>${rows.map(a => `<tr><td>${esc(a.name)} <span class="muted small">${esc(a.code || '')}</span></td>
                <td class="r">${money(a.amount)}</td><td class="r muted">${percent(Number(a.amount) / (Number(total) || 1) * 100)}</td></tr>`).join('')
                || `<tr><td colspan="3" class="muted">No ${title.toLowerCase()} in this period</td></tr>`}</tbody>
            <tfoot><tr class="total"><td>Total ${title.toLowerCase()}</td><td class="r ${cls}">${money(total)}</td><td></td></tr></tfoot>
        </table>`;

    el.className = 'report-content income';
    el.innerHTML = `
        <div class="stat-strip report-stats">
            ${stat('Total income', `<span class="pos">${money(r.totalIncome)}</span>`, `${date(r.from)} → ${date(r.to)}`)}
            ${stat('Total expenses', `<span class="neg">${money(r.totalExpenses)}</span>`)}
            ${stat('Net surplus', `<span class="${Number(r.netSurplus) >= 0 ? 'pos' : 'neg'}">${money(r.netSurplus)}</span>`)}
            ${stat('Savings rate', percent(r.savingsRate))}
        </div>
        ${panel({ title: 'Income', iconName: 'arrow-in', cls: 'p-is-income', bodyClass: 'flush',
                  body: `<div class="scroll" style="height:100%">${side('Income', r.income, r.totalIncome, 'pos')}</div>` })}
        ${panel({ title: 'Expenses', iconName: 'arrow-out', cls: 'p-is-expense', bodyClass: 'flush',
                  body: `<div class="scroll" style="height:100%">${side('Expenses', r.expenses, r.totalExpenses, 'neg')}</div>` })}`;

    return () => [['Section', 'Code', 'Category', 'Amount'],
        ...r.income.map(a => ['Income', a.code, a.name, a.amount]),
        ['Income', '', 'Total income', r.totalIncome],
        ...r.expenses.map(a => ['Expense', a.code, a.name, a.amount]),
        ['Expense', '', 'Total expenses', r.totalExpenses],
        ['', '', 'Net surplus', r.netSurplus]];
}

// ===================================================================== trial balance

async function trialBalance(el) {
    const r = await api.get('/reports/trial-balance', { asOf: period.asOf });
    el.className = 'report-content single';
    el.innerHTML = panel({
        title: `Trial balance as of ${date(r.asOf)}`, iconName: 'scale', bodyClass: 'flush',
        actions: r.balanced ? `<span class="badge good">${icon('check-circle')}Balanced</span>`
                            : `<span class="badge critical">${icon('alert')}Not balanced</span>`,
        body: `<div class="scroll" style="height:100%">${table([
            { label: 'Code', render: a => `<span class="mono muted">${esc(a.code)}</span>` },
            { label: 'Account', render: a => esc(a.name) },
            { label: 'Class', render: a => `<span class="badge gray">${esc(a.accountClass)}</span>` },
            { label: 'Debit', align: 'r', render: a => Number(a.debit) ? money(a.debit, { decimals: 2 }) : '' },
            { label: 'Credit', align: 'r', render: a => Number(a.credit) ? money(a.credit, { decimals: 2 }) : '' },
        ], r.rows, {
            compact: true,
            footer: `<tr class="total"><td colspan="3">Totals</td><td class="r">${money(r.totalDebit, { decimals: 2 })}</td>
                     <td class="r">${money(r.totalCredit, { decimals: 2 })}</td></tr>`,
        })}</div>`,
    });
    return () => [['Code', 'Account', 'Class', 'Debit', 'Credit'],
        ...r.rows.map(a => [a.code, a.name, a.accountClass, a.debit, a.credit]),
        ['', 'Totals', '', r.totalDebit, r.totalCredit]];
}

// ===================================================================== cash flow

async function cashFlow(el) {
    const r = await api.get('/reports/cash-flow', { from: period.from, to: period.to });
    el.className = 'report-content charts-and-table';
    el.innerHTML = `
        ${panel({ title: 'Money in vs out', iconName: 'transfer', cls: 'p-cf-bars', bodyClass: 'chart',
                  body: `<div class="chart-wrap">${legend([{ label: 'Inflow' }, { label: 'Outflow' }])}<div class="chart" id="cf-bars"></div></div>` })}
        ${panel({ title: 'Closing cash & bank', iconName: 'droplet', cls: 'p-cf-line', bodyClass: 'chart',
                  body: `<div class="chart-wrap"><div class="chart" id="cf-line"></div></div>` })}
        ${panel({ title: 'Monthly cash flow', iconName: 'list', cls: 'p-cf-table', bodyClass: 'flush',
                  sub: `In ${money(r.totalInflow)} · Out ${money(r.totalOutflow)}`,
                  body: `<div class="scroll" style="height:100%">${table([
                      { label: 'Month', render: m => monthLabel(m.month) },
                      { label: 'Opening', align: 'r', render: m => money(m.opening) },
                      { label: 'Inflow', align: 'r', render: m => `<span class="pos">${money(m.inflow)}</span>` },
                      { label: 'Outflow', align: 'r', render: m => `<span class="neg">${money(m.outflow)}</span>` },
                      { label: 'Net', align: 'r', render: m => `<b class="${Number(m.net) >= 0 ? 'pos' : 'neg'}">${money(m.net)}</b>` },
                      { label: 'Closing', align: 'r', render: m => `<b>${money(m.closing)}</b>` },
                  ], r.months, { compact: true })}</div>` })}`;

    const labels = r.months.map(m => m.month);
    barChart(el.querySelector('#cf-bars'), {
        labels, labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Inflow', values: r.months.map(m => Number(m.inflow)) },
                 { name: 'Outflow', values: r.months.map(m => Number(m.outflow)) }],
    });
    lineChart(el.querySelector('#cf-line'), {
        labels, labelFormat: monthLabel, format: moneyShort, area: true,
        series: [{ name: 'Closing balance', values: r.months.map(m => Number(m.closing)) }],
    });
    return () => [['Month', 'Opening', 'Inflow', 'Outflow', 'Net', 'Closing'],
        ...r.months.map(m => [m.month, m.opening, m.inflow, m.outflow, m.net, m.closing])];
}

// ===================================================================== expense analysis

async function expenseAnalysis(el) {
    const r = await api.get('/reports/expense-analysis', { from: period.from, to: period.to });
    el.className = 'report-content charts-and-table';
    if (!r.categories.length) {
        el.innerHTML = panel({ title: 'Expense analysis', iconName: 'pie', body: emptyState('No expenses in this period') });
        return () => [];
    }
    const items = foldOthers(r.categories.map(c => ({ label: c.name, value: Number(c.amount) })));
    el.innerHTML = `
        ${panel({ title: 'Share by category', iconName: 'pie', cls: 'p-ea-donut', bodyClass: 'chart',
                  body: `<div class="donut-wrap"><div class="chart" id="ea-donut"></div><div class="donut-legend scroll">${items.map((it, i) => `
                        <div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                        <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('')}</div></div>` })}
        ${panel({ title: 'Biggest expenses', iconName: 'flag', cls: 'p-ea-top', body: `<div class="list">${r.topTransactions.map(t => `
                    <div class="list-item"><div class="grow ellipsis small">${esc(t.label)}</div><b class="mono">${money(t.value)}</b></div>`).join('')}</div>` })}
        ${panel({ title: 'Category by month', iconName: 'list', cls: 'p-cf-table', bodyClass: 'flush',
                  sub: `Total ${money(r.total)} · ${money(r.monthlyAverage)}/month`,
                  body: `<div class="scroll" style="height:100%"><table class="grid compact">
                    <thead><tr><th>Category</th>${r.months.map(m => `<th class="r">${monthLabel(m)}</th>`).join('')}
                        <th class="r">Total</th><th class="r">Avg</th><th class="r">Share</th></tr></thead>
                    <tbody>${r.categories.map(c => `<tr><td>${esc(c.name)}</td>${c.byMonth.map(v =>
                        `<td class="r ${Number(v) ? '' : 'muted'}">${Number(v) ? money(v) : '—'}</td>`).join('')}
                        <td class="r strong">${money(c.amount)}</td><td class="r">${money(c.monthlyAverage)}</td>
                        <td class="r">${percent(c.percent)}</td></tr>`).join('')}</tbody>
                  </table></div>` })}`;

    donutChart(el.querySelector('#ea-donut'), { items, format: v => money(v), centerValue: moneyShort(r.total), centerLabel: 'total' });
    return () => [['Category', ...r.months, 'Total', 'Average', 'Share %'],
        ...r.categories.map(c => [c.name, ...c.byMonth, c.amount, c.monthlyAverage, c.percent])];
}
