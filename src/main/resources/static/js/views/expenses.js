/**
 * Expenses: everything that went out in a period. Quick period and type chips up front, more filters
 * (category, paid from, amount) on demand, and a smart search box that understands
 *   >500  <2000  500-2000   amount
 *   #groceries              category
 *   @hdfc                   paid from
 *   is:lent is:paid is:open is:overdue
 * and plain words for description, person, reference or notes. The list is flat by default; grouping by
 * day is a remembered switch. Each row expands in place:
 *   - an expense shows its details, notes and journal lines, with edit / duplicate / delete
 *   - money lent or paid for someone shows its lifecycle, repayments and month-by-month interest
 * The right pane holds the period summary, where the money went, the spending trend and who owes you.
 *
 * Lent, Paid for, To collect and You owe list every item still open, whatever the period (settled ones only when
 * they started in it); an expanded item scrolls on its own inside the list.
 *
 * Routes: #/expenses, #/expenses/today (opens on today), #/expenses/collect (opens on "to collect"),
 * #/expenses/owe (money you borrowed and bills still to pay), #/expenses/claim/<id> (opens that lent / borrowed
 * item, wherever the link came from: this is where it is managed).
 */
import { api } from '../core/api.js';
import { loadAccounts, can, categoriesOf, state } from '../core/store.js';
import { esc, panel, emptyState, toast, confirmDialog, accountOptions, categoryOptions, openModal, field, readForm } from '../core/ui.js';
import { icon, categoryIcon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, date, dateTime, shortDate, isoDate } from '../core/format.js';
import { barChart, donutChart, foldOthers, seriesColor } from '../core/charts.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { claimPanelHtml, bindClaimPanel, claimBadge } from '../components/claim-panel.js';
import { getPref, setPref } from '../core/prefs.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { evidenceBadge, evidenceFieldHtml, bindEvidenceField } from '../components/evidence.js';
import { exportButton, bindExport } from '../core/export.js';
import { openSubmissions } from '../components/submissions.js';

/** Periods, in toolbar order; the first four are always visible, the rest sit behind "More". */
const PERIODS = {
    today: { label: 'Today', range: t => [t, t] },
    week: { label: 'This week', range: t => [addDays(t, -((t.getDay() + 6) % 7)), t] },
    month: { label: 'This month', range: t => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
    lastmonth: { label: 'Last month', range: t => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
    yesterday: { label: 'Yesterday', range: t => [addDays(t, -1), addDays(t, -1)] },
    lastweek: { label: 'Last week', range: t => { const s = addDays(t, -((t.getDay() + 6) % 7) - 7); return [s, addDays(s, 6)]; } },
    d90: { label: '3 months', range: t => [new Date(t.getFullYear(), t.getMonth() - 2, 1), t] },
    year: { label: 'This year', range: t => [new Date(t.getFullYear(), 0, 1), t] },
    custom: { label: 'Custom', range: () => [new Date(view.from + 'T00:00:00'), new Date(view.to + 'T00:00:00')] },
};
const QUICK_PERIODS = ['today', 'week', 'month', 'lastmonth'];

const TYPES = [
    { key: 'all', label: 'All' },
    { key: 'EXPENSE', label: 'Expenses', iconName: 'receipt' },
    { key: 'PAID_FOR', label: 'Paid for', iconName: 'users' },
    { key: 'LENT', label: 'Lent', iconName: 'hand' },
    { key: 'collect', label: 'To collect', iconName: 'clock' },
    { key: 'owe', label: 'You owe', iconName: 'card' },
];

const view = {
    period: 'month', from: isoDate(), to: isoDate(), type: 'all', categoryId: '', paidFromId: '', q: '',
    min: '', max: '', side: 'mix', open: null, morePeriods: false, moreFilters: false,
};

const prefs = getPref('expenses', { grouped: false, sort: { key: 'date', dir: 'desc' } });
const savePrefs = () => setPref('expenses', prefs);

/** Smart search: pulls amount, #category, @account and is: tokens out of the text. */
export function parseQuery(q) {
    const out = { text: [], min: null, max: null, category: [], payer: [], is: [] };
    for (const token of (q || '').trim().split(/\s+/).filter(Boolean)) {
        let m;
        if ((m = token.match(/^>=?(\d+(?:\.\d+)?)k?$/i))) out.min = Number(m[1]) * (/k$/i.test(token) ? 1000 : 1);
        else if ((m = token.match(/^<=?(\d+(?:\.\d+)?)k?$/i))) out.max = Number(m[1]) * (/k$/i.test(token) ? 1000 : 1);
        else if ((m = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) { out.min = Number(m[1]); out.max = Number(m[2]); }
        else if (token.startsWith('#') && token.length > 1) out.category.push(token.slice(1).toLowerCase());
        else if (token.startsWith('@') && token.length > 1) out.payer.push(token.slice(1).toLowerCase());
        else if (/^is:\w+$/i.test(token)) out.is.push(token.slice(3).toLowerCase());
        else out.text.push(token.toLowerCase());
    }
    return out;
}

function queryMatches(r, q) {
    if (q.min !== null && r.amount < q.min) return false;
    if (q.max !== null && r.amount > q.max) return false;
    if (q.category.length && !q.category.some(c => (r.category || '').toLowerCase().includes(c))) return false;
    if (q.payer.length && !q.payer.some(p => (r.paidFrom || '').toLowerCase().includes(p))) return false;
    for (const flag of q.is) {
        if (flag === 'lent' && r.type !== 'LENT') return false;
        if ((flag === 'paid' || flag === 'paidfor') && r.type !== 'PAID_FOR') return false;
        if (flag === 'expense' && r.type !== 'EXPENSE') return false;
        if (flag === 'open' && !(r.claim && Number(r.claim.outstanding) > 0)) return false;
        if (flag === 'overdue' && !r.claim?.overdue) return false;
        if (flag === 'settled' && r.claim?.status !== 'SETTLED') return false;
        if (flag === 'refunded' && !['REFUNDED', 'PARTLY_REFUNDED'].includes(r.raw?.status)) return false;
        if (flag === 'reversed' && r.raw?.status !== 'REVERSED') return false;
    }
    const hay = [r.description, r.party, r.reference, r.category, r.entryNo, r.notes, r.paidFrom].filter(Boolean).join(' ').toLowerCase();
    return q.text.every(t => hay.includes(t));
}

export async function render(container, params, isCurrent) {
    if (params[0] === 'today') { view.period = 'today'; view.type = 'all'; }
    if (params[0] === 'collect') { view.type = 'collect'; }
    if (params[0] === 'owe') { view.type = 'owe'; }
    if (params[0] === 'claim' && params[1]) { view.focusClaim = Number(params[1]); view.q = ''; }
    if (params.length) history.replaceState(null, '', '#/expenses');

    const today = new Date(isoDate() + 'T00:00:00');
    const [fromD, toD] = PERIODS[view.period].range(today);
    const from = isoDate(fromD), to = isoDate(toD);
    view.from = from; view.to = to;
    const days = Math.round((toD - fromD) / 86400000) + 1;
    const prevTo = addDays(fromD, -1), prevFrom = addDays(fromD, -days);

    const waitsForApproval = !!state.user?.approval && !state.user?.linkId;
    const [rows, previous, budgets, claimData, accounts, expenseCategories, mine] = await Promise.all([
        api.get('/expenses', { from, to }),
        api.get('/expenses', { from: isoDate(prevFrom), to: isoDate(prevTo) }),
        api.get('/budgets', { month: to.slice(0, 7) }),
        api.get('/claims'),
        loadAccounts(), categoriesOf('EXPENSE'),
        waitsForApproval ? api.get('/approvals/mine').catch(() => []) : Promise.resolve([]),
    ]);
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    Object.assign(prefs, getPref('expenses', { grouped: false, sort: { key: 'date', dir: 'desc' } }));

    // ---- one list: expenses + money lent / paid for others
    const claimRows = claimData.claims.map(claimRow);
    const inPeriod = c => c.date >= from && c.date <= to;
    const isOpen = c => ['OPEN', 'PARTIAL'].includes(c.claim.status);   // principal or posted interest still owed
    // Lent / Paid for: every item still open, whatever its date, plus those settled that started in the period
    const all = {
        EXPENSE: rows.map(expenseRow),
        PAID_FOR: claimRows.filter(c => c.type === 'PAID_FOR' && (isOpen(c) || inPeriod(c))),
        LENT: claimRows.filter(c => c.type === 'LENT' && (isOpen(c) || inPeriod(c))),
        collect: claimRows.filter(c => (c.type === 'LENT' || c.type === 'PAID_FOR') && isOpen(c)),
        // borrowed money and bills not yet paid off, whatever the period (posted interest still owed counts too)
        owe: claimRows.filter(c => (c.type === 'BORROWED' || c.type === 'BILL_DUE') && isOpen(c)),
    };
    // "All" stays the period's picture: what went out in it
    all.all = [...all.EXPENSE, ...claimRows.filter(c => (c.type === 'LENT' || c.type === 'PAID_FOR') && inPeriod(c))];
    const openTypes = ['LENT', 'PAID_FOR', 'collect', 'owe'];
    const olderOpen = openTypes.includes(view.type) ? all[view.type].filter(c => isOpen(c) && !inPeriod(c)).length : 0;
    view.periodFrom = from; view.periodTo = to;
    // opened from a link (journal, statement): show the item in its own list, even outside the period, expanded
    if (view.focusClaim) {
        const focus = claimRows.find(c => c.claim.id === view.focusClaim);
        if (focus) {
            const payable = focus.type === 'BORROWED' || focus.type === 'BILL_DUE';
            const open = ['OPEN', 'PARTIAL'].includes(focus.claim.status);
            view.type = payable ? 'owe' : open ? 'collect' : focus.type;
            if (!all[view.type].includes(focus)) all[view.type].push(focus);
            view.open = focus.key;
            view.categoryId = null; view.paidFromId = null; view.min = ''; view.max = '';
        }
        view.focusClaim = null;
    }
    const query = parseQuery(view.q);
    const matches = r => (!view.categoryId || String(r.categoryId) === String(view.categoryId))
        && (!view.paidFromId || String(r.paidFromId) === String(view.paidFromId))
        && (view.min === '' || r.amount >= Number(view.min))
        && (view.max === '' || r.amount <= Number(view.max))
        && queryMatches(r, query);
    const list = sortRows(all[view.type].filter(matches));

    // ---- figures (expenses only, so lending never inflates spending)
    const expenses = all.EXPENSE.filter(matches);
    const total = sum(expenses);
    const previousTotal = sum(previous);
    const change = previousTotal ? ((total - previousTotal) / previousTotal) * 100 : null;
    const elapsed = Math.max(1, Math.min(days, Math.round((today - fromD) / 86400000) + 1));
    const dailyAverage = total / elapsed;
    const byCategory = groupSum(expenses, r => r.categoryId, r => r.category);
    const byPayer = groupSum(expenses, r => r.paidFromId, r => r.paidFrom, r => r.paidFromType);
    const singleMonth = from.slice(0, 7) === to.slice(0, 7);
    const s = claimData.summary;
    const advancedCount = [view.categoryId, view.paidFromId, view.min, view.max].filter(v => v !== '' && v !== null).length;
    const periodHidden = !QUICK_PERIODS.includes(view.period);
    const queryChips = [
        query.min !== null ? `≥ ${moneyShort(query.min)}` : '', query.max !== null ? `≤ ${moneyShort(query.max)}` : '',
        ...query.category.map(c => `category: ${c}`), ...query.payer.map(p => `from: ${p}`), ...query.is.map(f => `is ${f}`),
    ].filter(Boolean);

    container.innerHTML = `
    <div class="page expenses-page">
        <div class="page-toolbar glass xp-toolbar">
            <h2 class="page-title">${icon('receipt')} Expenses</h2>
            <div class="seg-chips" id="xp-periods">
                ${QUICK_PERIODS.map(key => `<button class="seg-chip ${view.period === key ? 'active' : ''}" data-period="${key}">${PERIODS[key].label}</button>`).join('')}
                ${periodHidden && !view.morePeriods ? `<button class="seg-chip active" data-period="${view.period}">${PERIODS[view.period].label}</button>` : ''}
                ${view.morePeriods ? Object.keys(PERIODS).filter(k => !QUICK_PERIODS.includes(k)).map(key =>
                    `<button class="seg-chip ${view.period === key ? 'active' : ''}" data-period="${key}">${PERIODS[key].label}</button>`).join('') : ''}
                <button class="seg-chip more" id="xp-more-periods" title="${view.morePeriods ? 'Fewer periods' : 'More periods'}">${icon(view.morePeriods ? 'chevron-left' : 'more')}</button>
            </div>
            <span class="xp-range ${view.period === 'custom' ? 'editing' : ''}">
                ${view.period === 'custom'
                    ? `<input type="date" id="xp-from" value="${from}" max="${isoDate()}"> – <input type="date" id="xp-to" value="${to}" max="${isoDate()}">`
                    : `${icon('calendar')} ${from === to ? date(from) : `${date(from)} – ${date(to)}`}`}
            </span>
            <span class="spacer"></span>
            <div class="search-box smart-search" title="Try: >500  <2k  500-2000  #groceries  @hdfc  is:lent  is:overdue">
                ${icon('search')}<input id="xp-search" value="${esc(view.q)}" placeholder="Search… try >500, #food, @hdfc, is:overdue" data-plain>
                ${view.q ? `<button class="btn ghost icon sm" id="xp-search-clear" title="Clear search">${icon('x')}</button>` : ''}
            </div>
            ${advancedCount || view.q || view.type !== 'all' || view.period !== 'month' ? `<button class="btn sm ghost" id="xp-clear-all" title="This month, all types, no search or filters">${icon('x')}Clear filters</button>` : ''}
            <button class="btn sm ${view.moreFilters || advancedCount ? 'active-filter' : ''}" id="xp-filters" title="More filters">${icon('filter')}Filters${advancedCount ? `<span class="count-dot">${advancedCount}</span>` : ''}</button>
            ${exportButton({ label: '' })}
            ${can('POST_TRANSACTIONS') ? `
                <button class="btn sm" id="xp-lend" title="Lent money or paid for someone">${icon('hand')}Lent / paid for</button>
                <button class="btn primary" id="xp-add">${icon('plus')}Add expense <span class="kbd light">E</span></button>` : ''}
        </div>

        ${panel({ title: 'Transactions', iconName: 'list', cls: 'p-xp-list', bodyClass: 'flush',
                  sub: `${list.length} · ${money(sum(list))}`,
                  actions: `<div class="seg-chips sm" id="xp-types">${TYPES.map(t => `<button class="seg-chip ${view.type === t.key ? 'active' : ''}" data-type="${t.key}">
                        ${t.iconName ? icon(t.iconName) : ''}${t.label}<span class="count">${all[t.key].filter(matches).length}</span></button>`).join('')}</div>
                        <label class="switch" title="Group the list by day with daily totals"><input type="checkbox" id="xp-grouped" ${prefs.grouped ? 'checked' : ''}><span></span>By day</label>`,
                  body: `
                    ${view.moreFilters || advancedCount ? `<div class="xp-more-filters">
                        <select id="xp-category" data-combo>${categoryOptions(expenseCategories, view.categoryId, 'All categories')}</select>
                        <select id="xp-payer" data-combo>${accountOptions(accounts, a => ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD', 'PAYABLE'].includes(a.accountType), view.paidFromId, 'Any account')}</select>
                        <span class="xp-amounts">${icon('cash')}<input type="number" id="xp-min" placeholder="Min ₹" value="${esc(view.min)}" data-plain>–<input type="number" id="xp-max" placeholder="Max ₹" value="${esc(view.max)}" data-plain></span>
                        ${advancedCount ? `<button class="btn sm ghost" id="xp-clear" title="Clear filters">${icon('x')}Clear</button>` : ''}
                    </div>` : ''}
                    ${queryChips.length ? `<div class="xp-query">${icon('sparkles')}${queryChips.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
                    ${submissionsBar(mine)}
                    ${openTypes.includes(view.type) ? `<div class="xp-open-note">${icon('clock')}<span>${['collect', 'owe'].includes(view.type)
                        ? 'Every open item, whatever the period'
                        : `Every open item, whatever the period${olderOpen ? ` (${olderOpen} from before ${date(from)})` : ''}, plus those settled in this period`}</span></div>` : ''}
                    <div class="scroll xp-list" id="xp-list">${tableHtml(list)}</div>` })}

        <div class="xp-side">
            ${panel({ title: 'Summary', iconName: 'pie', cls: 'p-xp-summary', sub: PERIODS[view.period].label,
                      body: summaryHtml({ total, change, days, expenses, dailyAverage, today, budgets, singleMonth, byCategory, s, to }) })}
            ${panel({ title: view.side === 'payer' ? 'Paid from' : 'Where it went', iconName: view.side === 'payer' ? 'wallet' : 'pie', cls: 'p-xp-cat',
                      bodyClass: view.side === 'mix' ? 'chart' : '',
                      actions: `<div class="seg-chips sm" id="xp-side-tabs">
                          <button class="seg-chip ${view.side === 'mix' ? 'active' : ''}" data-side="mix" title="Category mix">${icon('pie')}</button>
                          <button class="seg-chip ${view.side === 'category' ? 'active' : ''}" data-side="category">Category</button>
                          <button class="seg-chip ${view.side === 'payer' ? 'active' : ''}" data-side="payer">Paid from</button></div>`,
                      body: view.side === 'mix' ? (byCategory.length ? '<div class="xp-donut"><div class="chart" id="xp-donut"></div><div class="xp-donut-legend scroll" id="xp-donut-legend"></div></div>' : emptyState('Nothing spent yet', 'pie'))
                          : view.side === 'category' ? categoryBars(byCategory, budgets, total, singleMonth) : payerList(byPayer, total) })}
            ${panel({ title: days > 62 ? 'Monthly spending' : 'Daily spending', iconName: 'calendar', cls: 'p-xp-daily', bodyClass: 'chart',
                      body: expenses.length ? '<div class="chart" id="xp-daily"></div>' : emptyState('No expenses') })}
            ${panel({ title: 'Owed to you', iconName: 'hand', cls: 'p-xp-owed', sub: money(s.outstanding),
                      body: owedList(all.collect) })}
        </div>
    </div>`;

    drawTrend(container.querySelector('#xp-daily'), expenses, fromD, toD, days);
    if (view.side === 'mix' && byCategory.length) {
        const items = foldOthers(byCategory.map(c => ({ label: c.label, value: c.value, key: c.key })));
        donutChart(container.querySelector('#xp-donut'), { items, format: v => money(v), centerValue: moneyShort(total), centerLabel: 'spent' });
        container.querySelector('#xp-donut-legend').innerHTML = items.map((it, i) => `
            <button class="legend-row ${String(view.categoryId) === String(it.key) ? 'active' : ''}" ${it.key ? `data-filter-category="${it.key}"` : ''} title="Filter by ${esc(it.label)}">
                <i class="legend-swatch" style="background:${seriesColor(i)}"></i><span class="ellipsis">${esc(it.label)}</span>
                <small>${percent((it.value / (total || 1)) * 100, 0)}</small><b>${moneyShort(it.value)}</b></button>`).join('');
    }

    // ---- toolbar & filters
    const on = (sel, evt, fn) => container.querySelector(sel)?.addEventListener(evt, fn);
    on('#xp-add', 'click', () => openExpenseDialog({ onSaved: reload }));
    on('[data-my-subs]', 'click', () => openSubmissions({ onChanged: reload }));
    on('#xp-lend', 'click', () => openExpenseDialog({ mode: 'PAID_FOR', onSaved: reload }));
    on('[data-summary-collect]', 'click', () => { view.type = view.type === 'collect' ? 'all' : 'collect'; reload(); });
    on('#xp-periods', 'click', e => {
        if (e.target.closest('#xp-more-periods')) { view.morePeriods = !view.morePeriods; reload(); return; }
        const b = e.target.closest('[data-period]');
        if (b) { view.period = b.dataset.period; reload(); }
    });
    on('#xp-from', 'change', e => { view.from = e.target.value; reload(); });
    on('#xp-to', 'change', e => { view.to = e.target.value; reload(); });
    on('#xp-types', 'click', e => {
        const b = e.target.closest('[data-type]');
        if (b) { view.type = b.dataset.type; view.open = null; reload(); }
    });
    on('#xp-grouped', 'change', e => { prefs.grouped = e.target.checked; savePrefs(); reload(); });
    on('#xp-filters', 'click', () => { view.moreFilters = !view.moreFilters; reload(); });
    on('#xp-side-tabs', 'click', e => {
        const b = e.target.closest('[data-side]');
        if (b) { view.side = b.dataset.side; reload(); }
    });
    on('#xp-category', 'change', e => { view.categoryId = e.target.value; reload(); });
    on('#xp-payer', 'change', e => { view.paidFromId = e.target.value; reload(); });
    on('#xp-min', 'change', e => { view.min = e.target.value; reload(); });
    on('#xp-max', 'change', e => { view.max = e.target.value; reload(); });
    on('#xp-clear', 'click', () => { view.categoryId = ''; view.paidFromId = ''; view.min = ''; view.max = ''; reload(); });
    on('#xp-search-clear', 'click', () => { view.q = ''; reload(); });
    on('#xp-clear-all', 'click', () => {
        Object.assign(view, { period: 'month', type: 'all', categoryId: '', paidFromId: '', min: '', max: '', q: '', open: null, moreFilters: false });
        reload();
    });
    let timer;
    on('#xp-search', 'input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { view.q = e.target.value.trim(); view.focusSearch = true; reload(); }, 350);
    });
    on('.p-xp-summary', 'click', e => {
        const cat = e.target.closest('[data-filter-category]');
        if (cat) { view.categoryId = String(view.categoryId) === cat.dataset.filterCategory ? '' : cat.dataset.filterCategory; reload(); }
    });
    on('.p-xp-cat', 'click', e => {
        const row = e.target.closest('[data-filter-category], [data-filter-payer]');
        if (!row) return;
        if (row.dataset.filterCategory) view.categoryId = String(view.categoryId) === row.dataset.filterCategory ? '' : row.dataset.filterCategory;
        if (row.dataset.filterPayer) view.paidFromId = String(view.paidFromId) === row.dataset.filterPayer ? '' : row.dataset.filterPayer;
        reload();
    });
    on('.p-xp-owed', 'click', e => {
        const row = e.target.closest('[data-person]');
        if (row) { view.type = 'collect'; view.q = row.dataset.person; reload(); }
    });
    bindExport(container.querySelector('.xp-toolbar'), () => ({
        title: `Expenses · ${TYPES.find(t => t.key === view.type)?.label || 'All'}`,
        subtitle: `${date(from)} – ${date(to)}${view.q ? ` · search "${view.q}"` : ''}`,
        filename: `expenses-${from}-to-${to}`,
        summary: [['Spent', total], ['Items', list.length, 'number'], ['Daily average', Math.round(dailyAverage)],
            ...(byCategory[0] ? [['Top category', `${byCategory[0].label} · ${money(byCategory[0].value)}`]] : [])],
        sheets: [
            { name: 'Transactions', columns: [{ label: 'Date', type: 'date' }, { label: 'Kind' }, { label: 'Category' }, { label: 'Description' },
                { label: 'Shop / person' }, { label: 'Paid from' }, { label: 'Reference' }, { label: 'Notes' }, { label: 'Amount', type: 'money' }, { label: 'Outstanding', type: 'money' }],
              rows: list.map(r => [r.date, r.typeLabel, r.claim ? '' : r.category, r.description, r.party || '', r.paidFrom || '', r.reference || '',
                  r.notes || '', r.amount, r.claim ? Number(r.claim.outstanding) : '']),
              totals: ['Total', '', '', '', '', '', '', '', sum(list), ''] },
            { name: 'By category', columns: [{ label: 'Category' }, { label: 'Items', type: 'number' }, { label: 'Spent', type: 'money' }, { label: 'Share', type: 'percent' }],
              rows: byCategory.map(c => [c.label, c.count, c.value, total ? (c.value / total) * 100 : 0]),
              totals: ['Total', expenses.length, total, 100] },
        ],
    }));

    // ---- rows: click expands in place
    const listEl = container.querySelector('#xp-list');
    listEl.addEventListener('click', async e => {
        const head = e.target.closest('th[data-sort]');
        if (head) {
            const cur = prefs.sort || { key: 'date', dir: 'desc' };
            const key = head.dataset.sort;
            prefs.sort = { key, dir: cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : key === 'date' || key === 'amount' ? 'desc' : 'asc' };
            savePrefs();
            reload();
            return;
        }
        const fc = e.target.closest('[data-row-filter-category]'), fp = e.target.closest('[data-row-filter-payer]');
        if (fc || fp) {
            e.stopPropagation();
            if (fc) view.categoryId = String(view.categoryId) === fc.dataset.rowFilterCategory ? '' : fc.dataset.rowFilterCategory;
            if (fp) view.paidFromId = String(view.paidFromId) === fp.dataset.rowFilterPayer ? '' : fp.dataset.rowFilterPayer;
            reload();
            return;
        }
        const action = e.target.closest('[data-xp-action]');
        if (action) {
            e.stopPropagation();
            const r = list.find(x => x.key === action.dataset.key);
            try {
                if (action.dataset.xpAction === 'edit') openExpenseDialog({ expense: r.raw, onSaved: reload });
                if (action.dataset.xpAction === 'copy') openExpenseDialog({ expense: r.raw, copy: true, onSaved: reload });
                if (action.dataset.xpAction === 'journal') location.hash = '#/transactions';
                if (action.dataset.xpAction === 'refund') openRefundDialog(r, reload);
                if (action.dataset.xpAction === 'reverse') openReverseDialog(r, reload);
                if (action.dataset.xpAction === 'undo-refund') {
                    const f = r.raw.refunds.find(x => String(x.entryId) === action.dataset.refund);
                    if (f && await confirmDialog(`Undo the ${f.reversal ? 'reversal' : 'refund'} of ${money(f.amount)} (${f.entryNo})? The expense counts again.`)) {
                        await api.del(`/expenses/${r.raw.entryId}/refunds/${f.entryId}`);
                        toast(`${f.entryNo} undone`);
                        reload();
                    }
                }
                if (action.dataset.xpAction === 'delete' && await confirmDialog(`Delete "${r.description}" (${money(r.amount)})?`)) {
                    await api.del(`/expenses/${r.raw.entryId}`);
                    toast('Expense deleted');
                    reload();
                }
            } catch (error) { toast(error.message, 'error'); }
            return;
        }
        const tr = e.target.closest('tr[data-key]');
        if (!tr || e.target.closest('.detail-row')) return;
        toggleRow(tr, list.find(x => x.key === tr.dataset.key));
    });

    async function toggleRow(tr, r) {
        const next = tr.nextElementSibling;
        listEl.querySelectorAll('tr.detail-row').forEach(d => d.remove());
        listEl.querySelectorAll('tr.expanded').forEach(d => d.classList.remove('expanded'));
        if (next?.classList.contains('detail-row')) { view.open = null; return; }
        view.open = r.key;
        tr.classList.add('expanded');
        const detail = document.createElement('tr');
        detail.className = 'detail-row';
        detail.innerHTML = `<td colspan="${tr.children.length}">${r.claim ? claimPanelHtml(r.claim, { scroll: true }) : await expenseDetail(r, { rows: all.EXPENSE, budgets, accounts, month: to.slice(0, 7),
            monthLabel: new Date(to + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) })}</td>`;
        tr.after(detail);
        if (r.claim) {
            bindClaimPanel(detail, r.claim, { onChanged: reload });   // Edit opens the matching lend / borrow form
            fitPanel(listEl, tr, detail);
        }
    }

    // ↑ / ↓ move through the rows, Enter expands, ← / → step through the quick periods
    const cursor = () => listEl.querySelector('tr.xp-tr.cursor') || listEl.querySelector('tr.xp-tr.expanded');
    const nav = listNavigator({
        items: () => [...listEl.querySelectorAll('tr.xp-tr')],
        selected: cursor,
        select: el => { listEl.querySelectorAll('tr.cursor').forEach(x => x.classList.remove('cursor')); el.classList.add('cursor'); },
        open: el => toggleRow(el, list.find(x => x.key === el.dataset.key)),
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
            const keys = Object.keys(PERIODS).filter(k => k !== 'custom');
            const i = keys.indexOf(view.period) + (e.key === 'ArrowRight' ? 1 : -1);
            if (i >= 0 && i < keys.length) { view.period = keys[i]; reload(); }
            return true;
        }
        return false;
    });

    // keep the previously opened row open after a reload (e.g. after recording a repayment)
    const reopen = view.open && listEl.querySelector(`tr[data-key="${view.open}"]`);
    if (reopen) { toggleRow(reopen, list.find(x => x.key === view.open)).then(() => { if (!reopen.classList.contains('is-claim')) reopen.scrollIntoView({ block: 'nearest' }); }); }
    else view.open = null;

    if (view.focusSearch) {
        const search = container.querySelector('#xp-search');
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
        view.focusSearch = false;
    }
}

/**
 * An expanded lent / borrowed item scrolls on its own: the row goes to the top of the list and its panel gets the
 * rest of the list's height, so everything is one scroll away and the list itself does not jump around.
 */
function fitPanel(listEl, tr, detail) {
    const panelEl = detail.querySelector('.claim-panel.in-row');
    if (!panelEl) return;
    const head = listEl.querySelector('thead')?.offsetHeight || 0;
    const room = listEl.clientHeight - head - tr.offsetHeight - 14;
    panelEl.style.setProperty('--claim-max', `${Math.max(280, room)}px`);
    const below = tr.getBoundingClientRect().top - listEl.getBoundingClientRect().top - head;   // the sticky header stays on top
    listEl.scrollTo({ top: Math.max(0, listEl.scrollTop + below), behavior: 'smooth' });
}

/** For a user whose expenses wait for approval: what is waiting and what was sent back. */
function submissionsBar(mine) {
    const waiting = mine.filter(p => p.status === 'PENDING').length;
    const back = mine.filter(p => p.status === 'REJECTED').length;
    if (!waiting && !back) return '';
    return `<button type="button" class="xp-subs-bar ${back ? 'has-rejected' : ''}" data-my-subs title="What you sent for approval">
        ${icon(back ? 'alert' : 'hourglass')}<span>${back ? `<b>${back} sent back</b> to correct · ` : ''}${waiting} waiting for approval</span>
        <span class="spacer"></span><span class="link-btn">${back ? 'Correct now' : 'View'}</span></button>`;
}

/** The period at a glance: spend and its change, budget use, pace, top category and money to collect. */
function summaryHtml({ total, change, days, expenses, dailyAverage, today, budgets, singleMonth, byCategory, s, to }) {
    const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const budgetUsed = singleMonth && Number(budgets.totalLimit) ? Number(budgets.usedPercent) : null;
    const top = byCategory[0];
    return `
    <div class="xp-summary">
        <div class="xs-hero">
            <span class="label">Spent</span>
            <b>${money(total)}</b>
            <small>${change === null ? `${expenses.length} expenses` : `<span class="${change <= 0 ? 'pos' : 'neg'}">${change > 0 ? '▲' : '▼'} ${percent(Math.abs(change), 0)}</span> vs previous ${days === 1 ? 'day' : `${days} days`}`}</small>
        </div>
        <div class="xs-grid">
            <div><span>Daily average</span><b>${money(Math.round(dailyAverage))}</b><small>${view.period === 'month' ? `pace ${moneyShort(dailyAverage * monthDays)} / month` : `${expenses.length} expenses`}</small></div>
            ${budgetUsed !== null
                ? `<div><span>Budget used</span><b class="${budgetUsed > 100 ? 'neg' : ''}">${percent(budgetUsed, 0)}</b>
                    <i class="xs-bar ${budgetUsed > 100 ? 'over' : budgetUsed > 80 ? 'warn' : ''}"><em style="width:${Math.min(100, budgetUsed)}%"></em></i>
                    <small>${moneyShort(budgets.totalSpent)} of ${moneyShort(budgets.totalLimit)}</small></div>`
                : `<div><span>Average expense</span><b>${money(Math.round(expenses.length ? total / expenses.length : 0))}</b><small>per item</small></div>`}
            <div class="clickable" ${top ? `data-filter-category="${top.key}"` : ''} title="Filter by this category"><span>Top category</span><b class="ellipsis">${esc(top?.label || '—')}</b>
                <small>${top ? `${moneyShort(top.value)} · ${percent((top.value / (total || 1)) * 100, 0)}` : ''}</small></div>
            <div class="clickable ${view.type === 'collect' ? 'active' : ''}" data-summary-collect title="Show what others owe you"><span>To collect</span><b class="aqua-ink">${moneyShort(s.outstanding)}</b>
                <small>${s.openCount} open${s.overdueCount ? ` · <span class="neg">${s.overdueCount} overdue</span>` : ''}</small></div>
        </div>
    </div>`;
}

// ===================================================================== rows

function expenseRow(r) {
    return {
        key: `x${r.entryId}-${r.categoryId}`, sortId: r.entryId, type: 'EXPENSE', typeLabel: 'Expense', raw: r,
        date: r.date, entryNo: r.entryNo, category: r.categoryName, categoryId: r.categoryId,
        description: r.narration, party: r.party, reference: r.reference, notes: r.memo,
        paidFrom: r.paidFrom, paidFromId: r.paidFromId, paidFromType: r.paidFromType,
        // what the expense costs now: the original less refunds (0 once reversed)
        amount: Number(r.netAmount ?? r.amount), gross: Number(r.amount), status: r.status,
    };
}

/** Refunded / reversed marker for an expense row. */
const STATUS_META = {
    REVERSED: { label: 'Reversed', tone: 'gray', iconName: 'undo' },
    REFUNDED: { label: 'Refunded', tone: 'aqua', iconName: 'arrow-in' },
    PARTLY_REFUNDED: { label: 'Part refunded', tone: 'aqua', iconName: 'arrow-in' },
};

function claimRow(c) {
    return {
        key: `c${c.id}`, sortId: c.journalEntryId || 0, type: c.kind, typeLabel: c.kindLabel, claim: c,
        date: c.startDate, entryNo: c.entryNo, category: c.kindLabel, categoryId: null,
        description: c.narration, party: c.party, reference: c.reference, notes: c.notes,
        paidFrom: c.paidFromAccount, paidFromId: c.paidFromAccountId, paidFromType: c.paidFromType, amount: Number(c.amount),
    };
}

/** Sortable columns: what each one sorts by. Date sorts newest first by default, the rest A–Z / smallest first. */
const STATUS_RANK = { OVERDUE: 0, OPEN: 1, PARTIAL: 2, SETTLED: 3, WRITTEN_OFF: 4 };
const SORTS = {
    date: r => r.date, category: r => (r.category || '').toLowerCase(), description: r => (r.description || '').toLowerCase(),
    paidFrom: r => (r.paidFrom || '').toLowerCase(), amount: r => r.amount,
    // lent / borrowed lists
    person: r => (r.party || '').toLowerCase(), type: r => (r.typeLabel || '').toLowerCase(),
    status: r => r.claim ? (r.claim.overdue ? 0 : STATUS_RANK[r.claim.status] ?? 9) : 9,
    owed: r => r.claim ? Number(r.claim.outstanding) : 0,
};

/** Lists of money lent, paid for someone, to collect or owed: their own columns and words. */
const CLAIM_VIEWS = ['LENT', 'PAID_FOR', 'collect', 'owe'];
const claimWords = () => view.type === 'owe'
    ? { date: 'Borrowed on', person: 'Lender / purpose', account: 'Received into', amount: 'Borrowed', owed: 'Still to pay' }
    : { date: view.type === 'PAID_FOR' ? 'Paid on' : view.type === 'LENT' ? 'Lent on' : 'Given on', person: view.type === 'PAID_FOR' ? 'Paid for / what' : 'Borrower / purpose',
        account: 'Paid from', amount: view.type === 'PAID_FOR' ? 'Paid' : 'Given', owed: 'Still owed' };

export function sortRows(rows, sort = prefs.sort) {
    const key = SORTS[sort?.key] ? sort.key : 'date';
    const dir = sort?.dir === 'asc' ? 1 : -1;
    const of = SORTS[key];
    return [...rows].sort((a, b) => {
        const x = of(a), y = of(b);
        const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        return c * dir || b.date.localeCompare(a.date) || b.sortId - a.sortId;
    });
}

function th(key, label, cls) {
    const sort = prefs.sort || { key: 'date', dir: 'desc' };
    const on = sort.key === key;
    return `<th class="${cls} sortable ${on ? 'sorted' : ''}" data-sort="${key}" title="Sort by ${label.toLowerCase()}${on ? ` (${sort.dir === 'asc' ? 'ascending' : 'descending'})` : ''}">
        <span>${label}</span>${on ? `<i class="sort-arrow">${sort.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
}

function tableHtml(rows) {
    if (!rows.length) return emptyState(view.type === 'collect' ? 'Nobody owes you anything right now.'
        : view.type === 'owe' ? 'You owe nobody right now. Press B to record money borrowed or a bill to pay later.'
        : 'Nothing for this selection. Press E to add an expense.', 'receipt');
    const grouped = prefs.grouped;
    const claims = CLAIM_VIEWS.includes(view.type);
    const w = claimWords();
    const heads = claims
        ? [grouped ? '' : th('date', w.date, 'c-date'), th('person', w.person, 'c-desc'), view.type === 'owe' ? th('type', 'Type', 'c-type') : '', th('status', 'Status', 'c-status'),
            th('paidFrom', w.account, 'c-pay'), th('amount', w.amount, 'r c-amt'), th('owed', w.owed, 'r c-owed')]
        : [grouped ? '' : th('date', 'Date', 'c-date'), th('category', 'Category', 'c-cat'), th('description', 'Description', 'c-desc'),
            th('paidFrom', 'Paid from', 'c-pay'), th('amount', 'Amount', 'r c-amt')];
    const head = `<thead><tr>${heads.join('')}<th class="c-caret"></th></tr></thead>`;
    const cols = heads.filter(Boolean).length + 1;
    const cls = `grid xp-table ${claims ? 'xp-claims' : 'xp-expenses'}`;
    const line = r => (claims ? claimRowHtml(r, !grouped) : rowHtml(r, !grouped));
    if (!grouped) return `<table class="${cls}">${head}<tbody>${rows.map(line).join('')}</tbody></table>`;
    const days = new Map();
    [...rows].sort((a, b) => b.date.localeCompare(a.date)).forEach(r => { if (!days.has(r.date)) days.set(r.date, []); });
    rows.forEach(r => days.get(r.date).push(r));   // days newest first, each day in the chosen order
    const body = [...days.entries()].map(([day, items]) => `
        <tr class="day-row"><td colspan="${cols}"><div class="day-head-inner">
            <span class="day-date"><b>${date(day)}</b> <span class="muted">${dayName(day)}</span></span>
            <span class="muted">${items.length} item${items.length > 1 ? 's' : ''}</span>
            <span class="spacer"></span><b class="mono">${money(sum(items))}</b></div></td></tr>
        ${items.map(line).join('')}`).join('');
    return `<table class="${cls}">${head}<tbody>${body}</tbody></table>`;
}

const CLAIM_KIND = { LENT: ['violet', 'hand', 'Lent'], PAID_FOR: ['aqua', 'users', 'Paid for'], BORROWED: ['coral', 'arrow-in', 'Borrowed'],
    BILL_DUE: ['gold', 'receipt', 'Bill to pay'] };

/**
 * One row, one line: date · category (or lent / borrowed) · description with the shop or person grayed on the
 * right · the account it was paid from · amount. Category and account are links that filter the list.
 */
function rowHtml(r, withDate) {
    const payer = accountTypeIcon(r.paidFromType);
    let category;
    if (r.claim) {
        const k = CLAIM_KIND[r.type] || ['aqua', 'users', r.typeLabel];
        category = `<span class="chip-icon xs ${k[0]}">${icon(k[1])}</span><span class="ellipsis">${k[2]}</span>`;
    } else {
        const cat = categoryIcon(r.category);
        category = `<span class="chip-icon xs ${cat.tone}">${icon(cat.name)}</span><button type="button" class="xd-link ellipsis" data-row-filter-category="${r.categoryId}"
            title="Show only ${esc(r.category)}">${esc(r.category)}</button>`;
    }
    const party = r.party ? (r.claim ? `${{ LENT: 'to', PAID_FOR: 'for', BORROWED: 'from', BILL_DUE: 'owed to' }[r.type] || ''} ${esc(r.party)}` : esc(r.party)) : '';
    const owed = r.claim && Number(r.claim.outstanding) > 0;
    const status = r.status ? STATUS_META[r.status] : null;
    const old = r.claim && view.periodFrom && r.date < view.periodFrom;
    return `
    <tr class="xp-tr ${r.claim ? 'is-claim' : ''} ${r.status ? `xp-${r.status.toLowerCase().replace('_', '-')}` : ''}" data-key="${r.key}">
        ${withDate ? `<td class="c-date ${old ? 'old' : ''}" title="${old ? `Before the selected period, still open · ${ageOf(r.date)}` : dayName(r.date)}"><b>${date(r.date)}</b>${old ? icon('clock') : ''}</td>` : ''}
        <td class="c-cat"><div class="xd-cat">${category}</div></td>
        <td class="c-desc"><div class="xd-cell">
            <span class="xd-text"><b class="ellipsis" title="${esc(r.description)}">${esc(r.description)}</b>${evidenceBadge(r.raw?.attachmentCount)}
                ${status ? `<span class="mini-flag ${status.tone}" title="${r.status === 'REVERSED' ? 'Reversed: counts for nothing' : `${status.label}: ${money(r.gross - r.amount)} came back`}">${icon(status.iconName)}</span>` : ''}
                ${r.claim ? claimBadge(r.claim) : ''}
                ${r.reference ? `<span class="xp-ico" title="Reference: ${esc(r.reference)}">${icon('tag')}</span>` : ''}
                ${r.notes ? `<span class="xp-ico" title="${esc(r.notes)}">${icon('info')}</span>` : ''}</span>
            ${party ? `<span class="xd-party" title="${r.claim ? 'Person' : 'Paid to'}: ${esc(r.party)}">${party}</span>` : ''}</div></td>
        <td class="c-pay">${r.paidFrom ? `<button type="button" class="xd-link xd-payer" data-row-filter-payer="${r.paidFromId}"
            title="${r.type === 'BORROWED' ? 'Into' : 'Paid from'} ${esc(r.paidFrom)} · show only this account">${icon(payer.name)}<span class="ellipsis">${esc(r.paidFrom)}</span></button>` : '<span class="muted">—</span>'}</td>
        <td class="r c-amt" ${owed ? `title="${money(Math.round(Number(r.claim.settlementAmount)))} payable now with interest"` : ''}>${r.status ? `<s class="muted small mono" title="Original amount">${money(r.gross)}</s> ` : ''}<b class="mono ${r.claim ? 'claim-amt' : r.status === 'REVERSED' ? 'muted' : 'neg'}">${money(r.amount)}</b></td>
        <td class="c-caret"><span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}

/**
 * A lent / paid-for / borrowed item: when, who and what for, the kind, where it stands (with the due date),
 * the account, what was given and what is still owed.
 */
function claimRowHtml(r, withDate) {
    const c = r.claim;
    const k = CLAIM_KIND[r.type] || ['aqua', 'users', r.typeLabel];
    const payer = accountTypeIcon(r.paidFromType);
    const old = view.periodFrom && r.date < view.periodFrom;
    const open = c.status === 'OPEN' || c.status === 'PARTIAL';
    const due = !open || !c.dueDate ? '' : c.overdue ? `<span class="xd-due neg" title="Was due ${date(c.dueDate)}">${Math.abs(c.daysToDue)}d late</span>`
        : `<span class="xd-due" title="Due date">due ${shortDate(c.dueDate)}</span>`;
    const interest = Number(c.interestDue);
    return `
    <tr class="xp-tr is-claim" data-key="${r.key}">
        ${withDate ? `<td class="c-date ${old ? 'old' : ''}" title="${old ? `Before the selected period, still open · ${ageOf(r.date)}` : dayName(r.date)}"><b>${date(r.date)}</b>${old ? icon('clock') : ''}</td>` : ''}
        <td class="c-desc"><div class="xd-cell">
            <span class="xd-text">${view.type === 'owe' ? '' : `<span class="chip-icon xs ${k[0]}" title="${k[2]}">${icon(k[1])}</span>`}<b class="ellipsis" title="${esc(r.party || '')}">${esc(r.party || '—')}</b>${evidenceBadge(c.attachmentCount)}
                ${c.interestRate ? `<span class="xd-rate" title="${Number(c.interestRate)}% a year, ${esc((c.interestTypeLabel || '').toLowerCase())}">${Number(c.interestRate)}%</span>` : ''}
                ${r.notes ? `<span class="xp-ico" title="${esc(r.notes)}">${icon('info')}</span>` : ''}</span>
            <span class="xd-party" title="${esc(r.description)}">${esc(r.description)}</span></div></td>
        ${view.type === 'owe' ? `<td class="c-type"><div class="xd-cat"><span class="chip-icon xs ${k[0]}">${icon(k[1])}</span><span class="ellipsis">${k[2]}</span></div></td>` : ''}
        <td class="c-status"><div class="xd-status">${claimBadge(c)}${due}</div></td>
        <td class="c-pay">${r.paidFrom ? `<button type="button" class="xd-link xd-payer" data-row-filter-payer="${r.paidFromId}"
            title="${w(r)} ${esc(r.paidFrom)} · show only this account">${icon(payer.name)}<span class="ellipsis">${esc(r.paidFrom)}</span></button>` : '<span class="muted">—</span>'}</td>
        <td class="r c-amt"><b class="mono claim-amt">${money(r.amount)}</b></td>
        <td class="r c-owed" title="${open ? `${money(c.outstanding)} principal${interest ? ` + ${money(Math.round(interest))} interest = ${money(Math.round(Number(c.settlementAmount)))} payable now` : ''}` : 'Nothing owed'}">
            ${open ? `<b class="mono neg">${money(c.outstanding)}</b>${interest >= 1 ? `<span class="xd-int">+${moneyShort(interest)}</span>` : ''}` : '<span class="muted">settled</span>'}</td>
        <td class="c-caret"><span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}
const w = r => (r.type === 'BORROWED' ? 'Into' : 'Paid from');

/**
 * An expense, opened in place and kept short: one line of facts with the actions on the right, then three
 * small cards side by side (the posting, the category against its budget, the shop / person and the account),
 * notes, refunds and evidence below only when there are any.
 */
async function expenseDetail(r, ctx = {}) {
    const e = r.raw;
    const manage = can('POST_TRANSACTIONS');
    const entry = await api.get(`/transactions/${e.entryId}`);
    const rows = ctx.rows || [];
    // the category in the month of the budget shown, and this shop / person within the period
    const line = ctx.budgets?.lines?.find(l => l.categoryId === e.categoryId);
    const inBudgetMonth = ctx.budgets && e.date.slice(0, 7) === ctx.month;
    const sameCat = rows.filter(x => x.categoryId === e.categoryId);
    const party = (e.party || '').trim().toLowerCase();
    const samePlace = party ? rows.filter(x => (x.party || '').trim().toLowerCase() === party) : [];
    const account = ctx.accounts?.find(a => a.id === e.paidFromId);
    const spentCat = sameCat.reduce((s, x) => s + x.amount, 0);
    const limit = line && line.monthlyLimit !== null ? Number(line.monthlyLimit) : null;
    const used = limit && inBudgetMonth ? Number(line.spent) / limit * 100 : null;
    const fact = (ico, text, title = '') => `<span class="xd-fact" ${title ? `title="${esc(title)}"` : ''}>${icon(ico)}${text}</span>`;
    return `
    <div class="xp-detail2">
        <div class="xd-top">
            ${fact('journal', `<b>${esc(e.entryNo)}</b> ${esc(entry.voucherLabel)}`, 'Entry number')}
            ${fact('calendar', `${date(e.date)} · ${dayName(e.date)}`)}
            ${e.party ? fact('user', esc(e.party), 'Paid to') : ''}
            ${e.reference ? fact('tag', esc(e.reference), 'Bill / UPI reference') : ''}
            ${fact('history', `${dateTime(entry.createdAt)} · ${esc(e.createdBy)}`, 'Recorded')}
            ${e.viaJournal ? fact('layers', `part of a ${entry.lines.length}-line voucher`) : ''}
            <span class="spacer"></span>
            <span class="xd-actions">
                ${manage && (e.editable || e.viaJournal) ? `<button class="btn xs primary" data-xp-action="edit" data-key="${r.key}">${icon('edit')}Edit</button>` : ''}
                ${manage ? `<button class="btn xs" data-xp-action="copy" data-key="${r.key}" title="Record it again">${icon('copy')}Again</button>` : ''}
                ${manage && e.refundable ? `<button class="btn xs" data-xp-action="refund" data-key="${r.key}" title="Money came back: a return, a cancelled order, a cashback">${icon('arrow-in')}Refund</button>
                    <button class="btn xs" data-xp-action="reverse" data-key="${r.key}" title="Recorded by mistake or never charged: cancel it with a reversing entry">${icon('undo')}Reverse</button>` : ''}
                ${manage && e.editable ? `<button class="btn xs ghost icon danger" data-xp-action="delete" data-key="${r.key}" title="Delete">${icon('trash')}</button>` : ''}
            </span>
        </div>
        <div class="xd-cards">
            <div class="xd-card">
                <div class="xd-card-head">${icon('journal')}Posting</div>
                ${entry.lines.map(l => `<div class="xd-line"><span class="xd-side">${Number(l.debit) ? 'Dr' : 'Cr'}</span><span class="ellipsis">${esc(l.accountName)}${l.categoryId && l.categoryId === e.categoryId ? ` <span class="muted">· ${esc(e.categoryName)}</span>` : ''}</span>
                    <b class="mono ${Number(l.debit) ? '' : 'muted'}">${money(Number(l.debit) || Number(l.credit))}</b></div>`).join('')}
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon('tag')}${esc(e.categoryName)}</div>
                ${used !== null ? `<div class="xd-line"><span>Budget ${esc(ctx.monthLabel || '')}</span><b class="mono ${used > 100 ? 'neg' : ''}">${money(line.spent)} / ${moneyShort(limit)}</b></div>
                    <i class="xd-bar ${used > 100 ? 'over' : used > 80 ? 'warn' : ''}"><em style="width:${Math.min(used, 100)}%"></em></i>
                    <div class="xd-line small"><span class="muted">${used > 100 ? `<span class="neg">${money(Number(line.spent) - limit)} over</span>` : `${money(limit - Number(line.spent))} left`}</span><span class="muted">${percent(used, 0)}</span></div>`
                    : `<div class="xd-line"><span class="muted">${inBudgetMonth ? 'No budget set' : 'Budget'}</span><span class="muted">${inBudgetMonth ? '—' : 'other month'}</span></div>`}
                <div class="xd-line small"><span class="muted">In this list</span><span>${sameCat.length}× · <b class="mono">${moneyShort(spentCat)}</b></span></div>
                <div class="xd-line small"><span class="muted">This one</span><span>${spentCat ? percent(r.amount / spentCat * 100, 0) : '—'} of it</span></div>
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon(e.party ? 'user' : 'wallet')}${e.party ? esc(e.party) : 'Paid from'}</div>
                ${e.party ? `<div class="xd-line small"><span class="muted">Here in this list</span><span>${samePlace.length}× · <b class="mono">${moneyShort(samePlace.reduce((s, x) => s + x.amount, 0))}</b></span></div>
                    <div class="xd-line small"><span class="muted">Average</span><b class="mono">${money(Math.round(samePlace.reduce((s, x) => s + x.amount, 0) / (samePlace.length || 1)))}</b></div>` : ''}
                <div class="xd-line small"><span class="muted">${e.party ? 'Paid from' : 'Account'}</span><span class="ellipsis">${esc(e.paidFrom)}</span></div>
                ${account ? `<div class="xd-line small"><span class="muted">${account.accountType === 'CREDIT_CARD' ? 'Card owes now' : 'Balance now'}</span><b class="mono">${money(account.balance)}</b></div>` : ''}
            </div>
        </div>
        ${e.memo ? `<div class="xd-note">${icon('info')}<span>${esc(e.memo)}</span></div>` : ''}
        ${refundsHtml(e, manage)}
        <div class="xp-evidence" data-ev-entry="${e.entryId}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

/** Refunds and the reversal of an expense, each with its entry, evidence and an undo. */
function refundsHtml(e, manage) {
    if (!e.refunds?.length) return '';
    return `
    <div class="xp-refunds">
        <div class="section-title">${icon('arrow-in')} ${e.status === 'REVERSED' ? 'Reversed' : 'Refunds'}
            <span class="muted">· ${money(e.refunded)} of ${money(e.amount)} back${e.status === 'PARTLY_REFUNDED' ? ` · ${money(e.netAmount)} still counts` : ''}</span></div>
        ${e.refunds.map(f => `
        <div class="xp-refund ${f.reversal ? 'is-reversal' : ''}">
            <span class="chip-icon xs ${f.reversal ? 'gray' : 'aqua'}">${icon(f.reversal ? 'undo' : 'arrow-in')}</span>
            <div class="grow min-0"><b>${f.reversal ? 'Reversal' : 'Refund'} ${money(f.amount)}</b>
                <span class="small muted">${date(f.date)} · ${esc(f.entryNo)}${f.accountName ? ` · ${f.reversal ? 'back to' : 'into'} ${esc(f.accountName)}` : ''}${f.note ? ` · ${esc(f.note)}` : ''}</span>
                <div data-ev-entry="${f.entryId}" data-ev-count="${f.attachmentCount || 0}"></div></div>
            ${manage ? `<button class="btn sm ghost" data-xp-action="undo-refund" data-refund="${f.entryId}" data-key="x${e.entryId}-${e.categoryId}" title="Undo: delete ${esc(f.entryNo)}">${icon('undo')}Undo</button>` : ''}
        </div>`).join('')}
    </div>`;
}

/** Money back on an expense: how much, when, into which account (the payer by default), with the receipt. */
async function openRefundDialog(r, reload) {
    const e = r.raw;
    const accounts = await loadAccounts();
    const left = Number(e.netAmount);
    const modal = openModal({
        title: `Refund · ${e.narration}`, iconName: 'arrow-in',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.categoryName)}</b><span class="spacer"></span><b>${money(e.amount)}</b></div>
                <div class="small muted">${date(e.date)} · paid from ${esc(e.paidFrom)}${Number(e.refunded) ? ` · ${money(e.refunded)} already refunded` : ''}</div></div>
            <label class="field"><span>Amount back *</span><input name="amount" type="number" step="any" min="0.01" max="${left}" value="${left}" required data-plain>
                <span class="chips">${[1, 0.5].map(f => `<button type="button" class="date-chip" data-fill="${Math.round(left * f * 100) / 100}">${f === 1 ? 'All' : 'Half'} ${moneyShort(left * f)}</button>`).join('')}</span></label>
            ${field({ label: 'Received on', name: 'date', type: 'date', value: isoDate(), required: true, attrs: `min="${e.date}"` })}
            <label class="field span-2"><span>Back into</span><select name="accountId">${accountOptions(accounts,
                a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && a.accountType !== 'CHIT_FUND', e.paidFromId)}</select></label>
            ${field({ label: 'Note', name: 'notes', placeholder: 'e.g. Returned one pair, order cancelled, cashback', span: 'span-2' })}
            <div class="span-2">${evidenceFieldHtml({ label: 'Refund proof', hint: 'Credit note, refund SMS or screenshot' })}</div>
            <p class="span-2 hint" style="margin:0">The refund lowers ${esc(e.categoryName)} spending in the month it comes back${e.paidFromType === 'CREDIT_CARD' ? ' and what you owe on the card' : ''}.</p>
        </form>`,
        onOpen: m => m.el.querySelector('form').addEventListener('click', ev => {
            const b = ev.target.closest('[data-fill]');
            if (b) m.el.querySelector('[name=amount]').value = b.dataset.fill;
        }),
        actions: [{ label: 'Cancel' }, {
            label: 'Record refund', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const saved = await api.post(`/expenses/${e.entryId}/refunds`, { date: d.date, amount: d.amount,
                    accountId: d.accountId ? Number(d.accountId) : null, notes: d.notes });
                await proof.uploadTo(saved.id);
                toast(`${money(saved.amount)} refunded on ${e.entryNo} · ${saved.entryNo}`);
                reload();
            },
        }],
    });
    const proof = bindEvidenceField(modal.el);
}

/** Cancels an expense with a mirror entry; both stay in the books, linked, and the expense counts for nothing. */
async function openReverseDialog(r, reload) {
    const e = r.raw;
    openModal({
        title: `Reverse · ${e.narration}`, iconName: 'undo',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.categoryName)}</b><span class="spacer"></span><b>${money(e.netAmount)}</b></div>
                <div class="small muted">${money(e.netAmount)} goes back to ${esc(e.paidFrom)} and comes off ${esc(e.categoryName)}.
                    Both entries stay in the books, linked, so the history is kept; the expense shows as <b>Reversed</b>.
                    ${Number(e.refunded) ? `Refunds of ${money(e.refunded)} stay as they are.` : ''}</div></div>
            ${field({ label: 'Reversal date', name: 'date', type: 'date', value: e.date, required: true, attrs: `min="${e.date}"`,
                      hint: 'The expense date keeps that month right; use today if it was charged and then cancelled' })}
            ${field({ label: 'Reason', name: 'reason', placeholder: 'e.g. Entered twice, payment failed' })}
        </form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Reverse expense', kind: 'primary', iconName: 'undo',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const saved = await api.post(`/expenses/${e.entryId}/reverse`, { date: d.date, reason: d.reason });
                toast(`${e.entryNo} reversed by ${saved.entryNo}`);
                reload();
            },
        }],
    });
}

// ===================================================================== side panels

function categoryBars(byCategory, budgets, total, singleMonth) {
    if (!byCategory.length) return emptyState('Nothing spent yet', 'pie');
    const max = Math.max(...byCategory.map(c => c.value));
    return `<div class="cat-bars">${byCategory.map(c => {
        const line = singleMonth ? budgets.lines.find(l => l.categoryId === c.key) : null;
        const limit = line?.monthlyLimit ? Number(line.monthlyLimit) : null;
        const scale = Math.max(max, limit || 0);
        const ci = categoryIcon(c.label);
        const over = limit && c.value > limit;
        return `
        <div class="cat-bar ${String(view.categoryId) === String(c.key) ? 'active' : ''}" data-filter-category="${c.key}">
            <span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
            <div class="grow">
                <div class="row small"><span class="ellipsis">${esc(c.label)}</span><span class="muted tiny">${c.count}×</span><span class="spacer"></span>
                    <b class="mono ${over ? 'neg' : ''}">${money(c.value)}</b></div>
                <div class="bar-track"><span class="bar-fill ${over ? 'over' : ''}" style="width:${(c.value / scale) * 100}%"></span>
                    ${limit ? `<i class="bar-limit" style="left:${(limit / scale) * 100}%" title="Budget ${money(limit)}"></i>` : ''}</div>
                <div class="tiny muted">${percent((c.value / (total || 1)) * 100, 0)} of spend${limit ? ` · budget ${moneyShort(limit)}${over ? ' · <span class="neg">over</span>' : ''}` : ''}</div>
            </div>
        </div>`;
    }).join('')}</div>`;
}

function payerList(byPayer, total) {
    if (!byPayer.length) return emptyState('Nothing spent yet', 'wallet');
    return `<div class="cat-bars">${byPayer.map(p => {
        const t = accountTypeIcon(p.extra);
        return `<div class="cat-bar ${String(view.paidFromId) === String(p.key) ? 'active' : ''}" data-filter-payer="${p.key}">
            <span class="chip-icon sm ${t.tone}">${icon(t.name)}</span>
            <div class="grow"><div class="row small"><span class="ellipsis">${esc(p.label)}</span><span class="muted tiny">${p.count}×</span><span class="spacer"></span><b class="mono">${money(p.value)}</b></div>
                <div class="bar-track"><span class="bar-fill alt" style="width:${(p.value / (total || 1)) * 100}%"></span></div>
                <div class="tiny muted">${percent((p.value / (total || 1)) * 100, 0)} of spend</div></div></div>`;
    }).join('')}</div>`;
}

/** People who owe you, biggest first, with what is overdue. */
function owedList(open) {
    if (!open.length) return emptyState('Nobody owes you anything', 'check-circle');
    const people = new Map();
    open.forEach(r => {
        const p = people.get(r.party) || { name: r.party, owed: 0, items: 0, overdue: false, interest: 0 };
        p.owed += Number(r.claim.outstanding);
        p.interest += Number(r.claim.interestDue);
        p.items++;
        p.overdue ||= r.claim.overdue;
        people.set(r.party, p);
    });
    return `<div class="owed-list">${[...people.values()].sort((a, b) => b.owed - a.owed).map(p => `
        <button class="owed-row" data-person="${esc(p.name)}">
            <span class="avatar sm">${esc(initials(p.name))}</span>
            <span class="grow"><b>${esc(p.name)}</b><small class="muted">${p.items} item${p.items > 1 ? 's' : ''}${p.interest ? ` · +${moneyShort(p.interest)} interest` : ''}</small></span>
            ${p.overdue ? `<span class="badge critical">${icon('alert')}Overdue</span>` : ''}
            <b class="mono">${money(p.owed)}</b>
        </button>`).join('')}</div>`;
}

function drawTrend(el, expenses, fromD, toD, days) {
    if (!el) return;
    if (days <= 62) {
        const labels = Array.from({ length: days }, (_, i) => isoDate(addDays(fromD, i)));
        const values = labels.map(d => expenses.filter(r => r.date === d).reduce((s, r) => s + r.amount, 0));
        barChart(el, { labels, labelFormat: l => days <= 7 ? shortDate(l) : String(Number(l.slice(8))), format: moneyShort,
            series: [{ name: 'Spent', values, color: 'var(--series-2)' }] });
        return;
    }
    const months = [];
    for (let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1); d <= toD; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(isoDate(d).slice(0, 7));
    barChart(el, { labels: months, format: moneyShort,
        labelFormat: m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' }),
        series: [{ name: 'Spent', values: months.map(m => expenses.filter(r => r.date.startsWith(m)).reduce((s, r) => s + r.amount, 0)), color: 'var(--series-2)' }] });
}

// ===================================================================== helpers

function sum(rows) {
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

function groupSum(rows, keyOf, labelOf, extraOf = () => null) {
    const map = new Map();
    rows.forEach(r => {
        const key = keyOf(r);
        const item = map.get(key) || { key, label: labelOf(r), extra: extraOf(r), value: 0, count: 0 };
        item.value += Number(r.amount);
        item.count++;
        map.set(key, item);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
}

function addDays(d, n) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
}

/** "3 months ago", "1 year ago" */
function ageOf(iso) {
    const days = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    if (days < 60) return `${days} days ago`;
    if (days < 730) return `${Math.round(days / 30.4)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

function initials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function dayName(iso) {
    const diff = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
}
