/**
 * Budgets (#/planning): one month at a time.
 *   top     the month on one light strip: a meter of committed paid + spending + still projected against the
 *           budget (with today's pace), then projected, left, committed due, free to spend, safe per day and
 *           spending without a budget, and the budget score whose health chips filter the list
 *   left    a list like the Reports pane: find box, filters (attention, committed, spending, no budget) and the
 *           budgets in order of urgency, grouped; ↑ / ↓ moves (also from the find box), Enter edits
 * Chit Payments is budget-only: it fills itself from the chit installments paid (the cash after dividends).
 *   middle  the selected budget: its progress and details, then only its transactions this month
 *   right   the watch list (pace warnings across all budgets, each with what to do), then an analysis of
 *           the category (by weekday, where the money went), its 6-month trend and insights
 * A month without budgets offers to copy last month's. Committed budgets are payments that have to be made
 * (rent, school fees, an EMI) by a day of the month.
 */
import { api } from '../core/api.js';
import { can, categoriesOf } from '../core/store.js';
import { panel, table, esc, field, readForm, openModal, toast, confirmDialog, emptyState, loading, categoryOptions } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { money, moneyShort, shortDate, monthLabel, percent, isoDate, daysFromToday } from '../core/format.js';
import { barChart, legend } from '../core/charts.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { exportButton, bindExport } from '../core/export.js';
import { setPageKeys, listNavigator, isTyping } from '../core/keys.js';

let month = isoDate().slice(0, 7);
const budgetView = { selectedId: null, filter: 'all', q: '' };
/** This month and the five before it (budget summaries), for the insights across months. */
let budgetHistory = [];

const PACE = {
    OVER: { label: 'Over', tone: 'over', rank: 0, iconName: 'alert-circle' },
    HEADING_OVER: { label: 'Heading over', tone: 'warning', rank: 1, iconName: 'trending' },
    AHEAD_OF_PACE: { label: 'Ahead of pace', tone: 'ahead', rank: 2, iconName: 'arrow-up' },
    ON_TRACK: { label: 'On track', tone: 'good', rank: 3, iconName: 'check' },
    UNDER: { label: 'Within limit', tone: 'good', rank: 3, iconName: 'check' },
    NOT_STARTED: { label: 'Planned', tone: 'gray', rank: 4, iconName: 'calendar' },
};
const PAYMENT = {
    OVERDUE: { label: 'Overdue', tone: 'over', rank: 0, iconName: 'alert-circle' },
    DUE_SOON: { label: 'Due soon', tone: 'warning', rank: 1, iconName: 'clock' },
    PARTLY_PAID: { label: 'Part paid', tone: 'ahead', rank: 2, iconName: 'hourglass' },
    DUE: { label: 'Due', tone: 'gray', rank: 3, iconName: 'calendar' },
    PAID: { label: 'Paid', tone: 'good', rank: 4, iconName: 'check-circle' },
};
const SEVERITY_ICON = { critical: 'alert-circle', warning: 'alert', info: 'info', good: 'check-circle' };

export async function render(container, params, isCurrent) {
    if (params[0] === 'recurring') { location.hash = '#/planning'; return; }
    container.innerHTML = `<div class="page planning-page">
        <div class="page-toolbar">
            <h2 class="page-title">${icon('target')} Budgets</h2>
            <div class="month-nav">
                <button class="btn sm ghost icon" data-month-step="-1" title="Previous month (←)">${icon('chevron-left')}</button>
                <b>${monthName(month)}</b>
                <button class="btn sm ghost icon" data-month-step="1" title="Next month (→)">${icon('chevron-right')}</button>
            </div>
            ${month !== isoDate().slice(0, 7) ? `<button class="btn sm ghost" data-month-today>${icon('calendar')}This month</button>` : ''}
            <span class="spacer"></span>
            <div class="row" id="toolbar-actions"></div>
        </div>
        <div class="planning-body" id="planning-body"></div>
    </div>`;
    container.querySelectorAll('[data-month-step]').forEach(b => b.addEventListener('click', () => {
        month = shiftMonth(month, Number(b.dataset.monthStep));
        render(container, [], isCurrent);
    }));
    container.querySelector('[data-month-today]')?.addEventListener('click', () => { month = isoDate().slice(0, 7); render(container, [], isCurrent); });
    await renderBudgets(container, isCurrent);
}

// ===================================================================== page

async function renderBudgets(container, isCurrent) {
    const pastMonths = Array.from({ length: 5 }, (_, i) => shiftMonth(month, i - 5));
    const [summary, expenseCategories, ...past] = await Promise.all([api.get('/budgets', { month }),
        categoriesOf('EXPENSE', null, { budget: true }).catch(() => []),
        ...pastMonths.map(m => api.get('/budgets', { month: m }).catch(() => null))]);
    if (!isCurrent()) return;
    // Chit Payments fills itself from the chit installments (budget only)
    const chitPaymentsId = expenseCategories.find(c => c.systemKey === 'CHIT_PAYMENTS')?.id ?? null;
    budgetHistory = [...past.map((s, i) => s && { month: pastMonths[i], ...s }), { month, ...summary }].filter(Boolean);
    const reload = () => render(container, [], isCurrent);
    const manage = can('MANAGE_BUDGETS');
    const prev = shiftMonth(month, -1);

    const budgeted = summary.lines.filter(l => l.budgetId);
    const committed = budgeted.filter(l => l.committed);
    const ordinary = budgeted.filter(l => !l.committed);
    const unbudgeted = summary.lines.filter(l => !l.budgetId);
    const suggestions = unbudgeted.filter(l => Number(l.averageLast3Months) > 0 || Number(l.spent) > 0);
    const canCopy = manage && summary.previousMonthBudgets > 0 && budgeted.length < summary.previousMonthBudgets;

    container.querySelector('#toolbar-actions').innerHTML = `
        ${canCopy ? `<button class="btn" id="copy-budgets" title="Copy ${monthName(prev)}'s ${summary.previousMonthBudgets} budgets (${money(summary.previousMonthTotal)}) into ${monthName(month)}">${icon('copy')}Copy ${shortMonth(prev)}</button>` : ''}
        ${manage && suggestions.length ? `<button class="btn" id="suggest-budgets" title="Budgets from your 3-month average">${icon('sparkles')}Suggest</button>` : ''}
        ${budgeted.length ? exportButton({ label: '' }) : ''}
        ${manage ? `<button class="btn" id="new-committed" title="A payment that has to be made: rent, fees, EMI">${icon('lock')}Committed</button>
            <button class="btn primary" id="new-budget">${icon('plus')}Set budget</button>` : ''}`;
    container.querySelector('#new-budget')?.addEventListener('click', () => openBudgetForm(null, reload));
    container.querySelector('#new-committed')?.addEventListener('click', () => openBudgetForm(null, reload, { committed: true }));
    container.querySelector('#suggest-budgets')?.addEventListener('click', () => openSuggestions(suggestions, reload));
    container.querySelector('#copy-budgets')?.addEventListener('click', () => copyBudgets(prev, month, budgeted.length > 0, reload));
    bindExport(container.querySelector('#toolbar-actions'), () => monthReport(summary));

    const body = container.querySelector('#planning-body');
    body.className = 'planning-body budgets';

    // ---- a month with no budgets: offer last month's
    if (!budgeted.length) {
        body.innerHTML = `<div class="budget-empty">
            <span class="chip-icon lg">${icon('target')}</span>
            <h3>No budgets for ${monthName(month)} yet</h3>
            ${summary.previousMonthBudgets ? `<p>${monthName(prev)} had <b>${summary.previousMonthBudgets} budgets</b> totalling <b>${money(summary.previousMonthTotal)}</b>, committed payments included.</p>
                ${manage ? `<button class="btn primary lg" id="copy-empty">${icon('copy')}Copy ${monthName(prev)}'s budgets</button>` : ''}`
                : `<p>Set a limit per category, or mark payments that must be made (rent, fees, EMIs) as committed.</p>`}
            <div class="row">${manage && suggestions.length ? `<button class="btn" id="suggest-empty">${icon('sparkles')}Suggest from my spending</button>` : ''}
                ${manage ? `<button class="btn" id="new-empty">${icon('plus')}Set a budget</button>` : ''}</div>
            ${unbudgeted.length ? `<p class="small muted">${money(summary.unbudgetedSpent)} spent in ${monthName(month)} so far, across ${unbudgeted.length} categories.</p>` : ''}
        </div>`;
        body.querySelector('#copy-empty')?.addEventListener('click', () => copyBudgets(prev, month, false, reload));
        body.querySelector('#suggest-empty')?.addEventListener('click', () => openSuggestions(suggestions, reload));
        body.querySelector('#new-empty')?.addEventListener('click', () => openBudgetForm(null, reload));
        return;
    }

    const totalLimit = Number(summary.totalLimit);
    const totalSpent = Number(summary.totalSpent);
    const projected = Number(summary.projectedTotal);
    const used = totalLimit ? (totalSpent / totalLimit) * 100 : 0;
    const pace = summary.daysInMonth ? (summary.daysElapsed / summary.daysInMonth) * 100 : 0;
    const isCurrentMonth = month === isoDate().slice(0, 7);
    const freeToSpend = totalLimit - totalSpent - Number(summary.committedOutstanding);

    const health = {
        over: ordinary.filter(l => l.pace === 'OVER').length + committed.filter(l => l.paymentStatus === 'OVERDUE').length,
        watch: ordinary.filter(l => l.pace === 'HEADING_OVER' || l.pace === 'AHEAD_OF_PACE').length + committed.filter(l => l.paymentStatus === 'DUE_SOON').length,
    };
    health.fine = budgeted.length - health.over - health.watch;
    const committedPaid = committed.reduce((s, l) => s + Math.min(Number(l.spent), Number(l.monthlyLimit)), 0);
    const ordinarySpent = ordinary.reduce((s, l) => s + Number(l.spent), 0);
    body.innerHTML = `
        ${monthStrip({ summary, committed, unbudgeted, totalLimit, totalSpent, projected, used, pace, isCurrentMonth, freeToSpend, health, committedPaid, ordinarySpent })}
        ${panel({
            title: 'Budgets', iconName: 'target', cls: 'p-budget-nav', bodyClass: 'flush',
            sub: `${budgeted.length} · ${moneyShort(totalLimit)}`,
            body: `<div class="bn-tools">
                    <div class="search-box sm">${icon('search')}<input id="bn-q" placeholder="Find a budget…" value="${esc(budgetView.q)}" data-plain></div>
                    <div class="bn-filters" id="bn-filters">${FILTERS.map(f => {
                        const n = budgetFilterCount(f.key, summary.lines);
                        return `<button class="bn-filter ${budgetView.filter === f.key ? 'active' : ''} ${f.key === 'attention' && n ? 'hot' : ''}" data-filter="${f.key}" ${n || f.key === 'all' ? '' : 'disabled'}>${f.label}<i>${n}</i></button>`;
                    }).join('')}</div>
                </div>
                <div class="list bn-list scroll" id="budget-cards">${budgetCards(committed, ordinary, unbudgeted, isCurrentMonth)}</div>
                <div class="bn-empty" id="bn-empty" hidden>${icon('search')}Nothing matches</div>
                <div class="bn-foot"><span class="kbd">↑</span><span class="kbd">↓</span> move · <span class="kbd">Enter</span> edit · <span class="kbd">←</span><span class="kbd">→</span> month · <span class="kbd">/</span> find</div>`,
        })}
        <div class="budget-main" id="budget-main"></div>
        <aside class="budget-side" id="budget-side"></aside>`;

    const cards = body.querySelector('#budget-cards');
    const show = categoryId => {
        budgetView.selectedId = categoryId;
        cards.querySelectorAll('[data-account]').forEach(el => el.classList.toggle('selected', Number(el.dataset.account) === categoryId));
        drawBudgetDetail(body, summary.lines.find(l => l.categoryId === categoryId), summary, reload, show, chitPaymentsId);
    };
    cards.addEventListener('click', e => {
        const set = e.target.closest('[data-set]');
        if (set) { e.stopPropagation(); openBudgetForm(summary.lines.find(l => l.categoryId === Number(set.dataset.set)), reload); return; }
        const card = e.target.closest('[data-account]');
        if (card) show(Number(card.dataset.account));
    });

    // search and the filter chips only hide rows (no reload); a group heading follows its rows
    const search = body.querySelector('#bn-q');
    const lineOf = id => summary.lines.find(l => l.categoryId === id);
    const applyFilter = () => {
        const term = budgetView.q.trim().toLowerCase();
        let shown = 0;
        cards.querySelectorAll('[data-account]').forEach(el => {
            const l = lineOf(Number(el.dataset.account));
            const ok = matchesFilter(budgetView.filter, l) && (!term || l.categoryName.toLowerCase().includes(term));
            el.hidden = !ok;
            if (ok) shown++;
        });
        cards.querySelectorAll('[data-group]').forEach(h => {
            h.hidden = !cards.querySelector(`[data-account][data-in="${h.dataset.group}"]:not([hidden])`);
        });
        body.querySelector('#bn-empty').hidden = shown > 0;
        body.querySelectorAll('#bn-filters [data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === budgetView.filter));
    };
    const showFirstIfHidden = () => {
        const sel = cards.querySelector('[data-account].selected');
        if (!sel || sel.hidden) {
            const first = cards.querySelector('[data-account]:not([hidden])');
            if (first) show(Number(first.dataset.account));
        }
    };
    const setFilter = key => { budgetView.filter = key; applyFilter(); showFirstIfHidden(); };
    body.querySelector('#bn-filters').addEventListener('click', e => {
        const b = e.target.closest('[data-filter]');
        if (b && !b.disabled) setFilter(b.dataset.filter);
    });
    body.querySelector('.budget-strip').addEventListener('click', e => {
        const f = e.target.closest('[data-strip-filter]');
        if (f && !f.disabled) setFilter(f.dataset.stripFilter);
    });
    let searchTimer;
    search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { budgetView.q = search.value; applyFilter(); showFirstIfHidden(); }, 120);
    });
    search.addEventListener('keydown', e => {
        if (e.key === 'Escape' && search.value) { e.stopPropagation(); search.value = ''; budgetView.q = ''; applyFilter(); }
        if (e.key === 'Enter') { e.preventDefault(); showFirstIfHidden(); search.blur(); }
    });

    // ↑ / ↓ through the visible budgets (also from the search box), ← / → previous or next month, Enter edits
    let keyTimer;
    const nav = listNavigator({
        items: () => [...cards.querySelectorAll('[data-account]:not([hidden])')],
        selected: () => cards.querySelector('[data-account].selected'),
        select: el => {
            cards.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => show(Number(el.dataset.account)), 130);
        },
        open: () => body.querySelector('[data-budget-act="edit"]')?.click(),
        allowWhileTyping: search,
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping()) {
            container.querySelector(`[data-month-step="${e.key === 'ArrowRight' ? 1 : -1}"]`)?.click();
            return true;
        }
        return false;
    });
    applyFilter();

    // open on the most urgent budget
    const firstAlert = summary.alerts.find(a => a.categoryId)?.categoryId;
    const visible = id => !cards.querySelector(`[data-account="${id}"]`)?.hidden;
    const first = [summary.lines.find(l => l.categoryId === budgetView.selectedId), summary.lines.find(l => l.categoryId === firstAlert),
        ...budgeted, ...summary.lines].find(l => l && visible(l.categoryId));
    if (first) show(first.categoryId);
    cards.querySelector('[data-account].selected')?.scrollIntoView({ block: 'nearest' });
}

/** Order of urgency within a group. */
const urgency = l => l.committed ? (PAYMENT[l.paymentStatus]?.rank ?? 9) : (PACE[l.pace]?.rank ?? 9);

function budgetCards(committed, ordinary, unbudgeted, isCurrentMonth) {
    const byUrgency = list => [...list].sort((a, b) => urgency(a) - urgency(b) || Number(b.usedPercent) - Number(a.usedPercent));
    const head = (key, iconName, label, count, amount) => `<div class="section-title bn-sep" data-group="${key}">
        <span>${icon(iconName)}${label}<i>${count}</i></span><b>${amount}</b></div>`;
    return `
        ${committed.length ? head('committed', 'lock', 'Committed', committed.length,
            `${moneyShort(committed.reduce((s, l) => s + Math.min(Number(l.spent), Number(l.monthlyLimit)), 0))} / ${moneyShort(committed.reduce((s, l) => s + Number(l.monthlyLimit), 0))}`)
            + byUrgency(committed).map(committedCard).join('') : ''}
        ${ordinary.length ? head('spending', 'target', 'Spending', ordinary.length,
            `${moneyShort(ordinary.reduce((s, l) => s + Number(l.spent), 0))} / ${moneyShort(ordinary.reduce((s, l) => s + Number(l.monthlyLimit), 0))}`)
            + byUrgency(ordinary).map(l => spendingCard(l, isCurrentMonth)).join('') : ''}
        ${unbudgeted.length ? head('none', 'alert-circle', 'Without a budget', unbudgeted.length, moneyShort(unbudgeted.reduce((s, l) => s + Number(l.spent), 0)))
            + unbudgeted.map(unbudgetedCard).join('') : ''}`;
}

/** Left-pane filters; "Attention" is everything over, heading over, ahead of pace, overdue or due soon. */
const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'attention', label: 'Attention' },
    { key: 'committed', label: 'Committed' },
    { key: 'spending', label: 'Spending' },
    { key: 'none', label: 'No budget' },
];
const needsAttention = l => !!l.budgetId && (l.committed ? ['OVERDUE', 'DUE_SOON'].includes(l.paymentStatus) : ['OVER', 'HEADING_OVER', 'AHEAD_OF_PACE'].includes(l.pace));
function matchesFilter(key, l) {
    if (!l) return false;
    return key === 'attention' ? needsAttention(l) : key === 'committed' ? !!(l.budgetId && l.committed)
        : key === 'spending' ? !!(l.budgetId && !l.committed) : key === 'none' ? !l.budgetId : true;
}
const budgetFilterCount = (key, lines) => lines.filter(l => matchesFilter(key, l)).length;

/** Tone of a row: the left accent, the status colour and the bar. */
const TONE_CLASS = { over: 'bad', warning: 'warn', ahead: 'info', good: 'good', gray: 'idle' };

/** One budget as a compact row (like the Reports list): icon, name and amount, status and what is left, a slim bar. */
function spendingCard(l, isCurrentMonth) {
    const { name: iconName, tone } = categoryIcon(l.categoryName);
    const p = PACE[l.pace] || PACE.ON_TRACK;
    const used = Number(l.usedPercent);
    const limit = Number(l.monthlyLimit);
    const proj = Number(l.projected);
    const expected = limit ? Number(l.expectedByToday) / limit * 100 : 0;
    const over = Number(l.remaining) < 0;
    const avg = Number(l.averageLast3Months);
    const vsAvg = avg ? ((Number(l.spent) - avg) / avg) * 100 : null;
    return `
    <div class="list-item clickable bn-item t-${TONE_CLASS[p.tone] || 'idle'} ${l.categoryId === budgetView.selectedId ? 'selected' : ''}" data-account="${l.categoryId}" data-in="spending"
        title="${esc(l.insight || '')}">
        <span class="chip-icon sm ${tone}">${icon(iconName)}</span>
        <div class="grow">
            <div class="bn-row"><span class="title">${esc(l.categoryName)}</span><b class="bn-amt ${over ? 'neg' : ''}">${moneyShort(l.spent)}<small> / ${moneyShort(limit)}</small></b></div>
            <div class="bn-row meta"><span class="bn-status">${icon(p.iconName)}${p.label}</span>
                ${vsAvg !== null && Math.abs(vsAvg) >= 15 ? `<span class="bn-delta ${vsAvg > 0 ? 'up' : 'down'}" title="Against the 3-month average (${money(Math.round(avg))})">${vsAvg > 0 ? '▲' : '▼'}${percent(Math.abs(vsAvg), 0)}</span>` : ''}
                <span class="bn-left ${over ? 'neg' : ''}">${over ? `${moneyShort(-l.remaining)} over` : `${moneyShort(l.remaining)} left`}</span></div>
            <i class="bn-bar"><em style="width:${Math.min(used, 100)}%"></em>${isCurrentMonth && proj > Number(l.spent)
                ? `<s style="left:${Math.min(used, 100)}%;width:${Math.max(0, Math.min(proj / limit * 100, 100) - Math.min(used, 100))}%" title="Projected ${money(proj)}"></s>` : ''}${isCurrentMonth
                ? `<u style="left:${Math.min(expected, 100)}%" title="Where the plan says you should be today"></u>` : ''}</i>
        </div>
    </div>`;
}

function committedCard(l) {
    const { name: iconName, tone } = categoryIcon(l.categoryName);
    const s = PAYMENT[l.paymentStatus] || PAYMENT.DUE;
    const paid = Math.min(Number(l.spent) / Number(l.monthlyLimit) * 100, 100);
    const due = l.dueDate ? daysFromToday(l.dueDate) : null;
    const when = l.paymentStatus === 'PAID' ? `paid ${shortDate(l.paidOn)}`
        : l.dueDate ? `due ${shortDate(l.dueDate)}${due !== null && due >= 0 ? ` · ${due === 0 ? 'today' : `in ${due}d`}` : ''}` : 'by month end';
    return `
    <div class="list-item clickable bn-item committed t-${TONE_CLASS[s.tone] || 'idle'} ${l.categoryId === budgetView.selectedId ? 'selected' : ''}" data-account="${l.categoryId}" data-in="committed"
        title="${esc(l.insight || '')}">
        <span class="chip-icon sm ${tone}">${icon(iconName)}</span>
        <div class="grow">
            <div class="bn-row"><span class="title">${esc(l.categoryName)}<span class="lock" title="Committed payment">${icon('lock')}</span></span><b class="bn-amt">${moneyShort(l.monthlyLimit)}</b></div>
            <div class="bn-row meta"><span class="bn-status">${icon(s.iconName)}${s.label}</span><span class="bn-left">${when}</span></div>
            <i class="bn-bar"><em style="width:${paid}%"></em></i>
        </div>
    </div>`;
}

function unbudgetedCard(l) {
    const { name: iconName, tone } = categoryIcon(l.categoryName);
    const avg = Number(l.averageLast3Months);
    return `
    <div class="list-item clickable bn-item unbudgeted t-idle ${l.categoryId === budgetView.selectedId ? 'selected' : ''}" data-account="${l.categoryId}" data-in="none">
        <span class="chip-icon sm ${tone}">${icon(iconName)}</span>
        <div class="grow">
            <div class="bn-row"><span class="title">${esc(l.categoryName)}</span><b class="bn-amt">${moneyShort(l.spent)}</b></div>
            <div class="bn-row meta"><span class="bn-left">no budget${avg ? ` · avg ${moneyShort(avg)}/mo` : ''}</span>
                ${can('MANAGE_BUDGETS') ? `<button class="bn-set" data-set="${l.categoryId}" title="Set a budget of ${money(suggestedLimit(l))}">${icon('plus')}${moneyShort(suggestedLimit(l))}</button>` : ''}</div>
        </div>
    </div>`;
}

/**
 * The month at a glance on a light strip: one meter (committed paid, other spending and what is still projected,
 * against the whole budget, with today's pace), the numbers that decide what can still be spent, and the score
 * with health chips that filter the list.
 */
function monthStrip({ summary, committed, unbudgeted, totalLimit, totalSpent, projected, used, pace, isCurrentMonth, freeToSpend, health, committedPaid, ordinarySpent }) {
    const past = month < isoDate().slice(0, 7);
    const scale = Math.max(totalLimit, projected, totalSpent) || 1;
    const w = v => `${Math.max(0, v / scale * 100)}%`;
    const projRest = isCurrentMonth ? Math.max(0, projected - totalSpent) : 0;
    const end = isCurrentMonth ? projected : totalSpent;
    const overBy = Math.max(0, end - totalLimit);
    const score = budgetScore(summary, budgetHistory, isCurrentMonth);
    const scoreLabel = score === null ? '' : score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Needs care' : 'At risk';
    const scoreTone = score === null ? '' : score >= 65 ? 'good' : score >= 45 ? 'warn' : 'bad';
    const stat = (label, value, note, cls = '', title = '') => `<div class="bs-stat ${cls}" ${title ? `title="${esc(title)}"` : ''}><small>${label}</small><b>${value}</b><span>${note}</span></div>`;
    const status = isCurrentMonth ? `${percent(pace, 0)} of the month gone · ${summary.daysLeft} day${summary.daysLeft === 1 ? '' : 's'} left` : past ? 'Month closed' : 'Planned month';
    return `
    <section class="budget-strip ${overBy ? 'is-over' : ''}">
        <div class="bs-meter">
            <div class="bs-head">
                <span class="bs-label">Spent in ${shortMonth(month)}</span>
                <b class="bs-spent ${totalSpent > totalLimit ? 'neg' : ''}">${money(totalSpent)}</b><span class="bs-of">of ${money(totalLimit)}</span>
                <span class="bs-pct ${used > 100 ? 'bad' : isCurrentMonth && used > pace + 10 ? 'warn' : ''}">${percent(used, 0)}</span>
                <span class="spacer"></span><span class="bs-when">${icon(isCurrentMonth ? 'clock' : past ? 'check-circle' : 'calendar')}${status}</span>
            </div>
            <div class="bs-track" title="${esc(`Committed paid ${money(committedPaid)} · spending ${money(ordinarySpent)}${projRest ? ` · ${money(projRest)} more projected` : ''} · budget ${money(totalLimit)}`)}">
                ${committedPaid ? `<span class="seg c" style="width:${w(committedPaid)}"></span>` : ''}<span class="seg s" style="width:${w(ordinarySpent)}"></span>${projRest ? `<span class="seg p" style="width:${w(projRest)}"></span>` : ''}
                ${totalLimit < scale ? `<i class="bs-limit" style="left:${w(totalLimit)}" title="Budget ${money(totalLimit)}"></i>` : ''}
                ${isCurrentMonth ? `<i class="bs-pace" style="left:${Math.min(pace, 100) * totalLimit / scale}%" title="Where you should be today (${percent(pace, 0)} of the month gone)"></i>` : ''}
            </div>
            <div class="bs-legend">
                ${committed.length ? `<span><i class="sw c"></i>Committed paid <b>${moneyShort(committedPaid)}</b></span>` : ''}
                <span><i class="sw s"></i>Spending <b>${moneyShort(ordinarySpent)}</b></span>
                ${projRest ? `<span><i class="sw p"></i>Still projected <b>${moneyShort(projRest)}</b></span>` : ''}
                ${isCurrentMonth ? `<span><i class="sw pace"></i>Today's pace</span>` : ''}
                <span class="spacer"></span>
                <span class="bs-verdict ${overBy ? 'neg' : 'pos'}">${icon(overBy ? 'alert' : 'check-circle')}<b>${overBy ? `${moneyShort(overBy)} over` : `${moneyShort(totalLimit - end)} spare`}</b>${isCurrentMonth ? '&nbsp;by month end' : ''}</span>
            </div>
        </div>
        <div class="bs-stats">
            ${stat(isCurrentMonth ? 'Projected' : past ? 'Final' : 'Planned', `<span class="${projected > totalLimit ? 'neg' : ''}">${moneyShort(projected)}</span>`,
                projected > totalLimit ? `<span class="neg">${moneyShort(projected - totalLimit)} over</span>` : `${moneyShort(totalLimit - projected)} spare`)}
            ${stat('Left', `<span class="${totalLimit - totalSpent < 0 ? 'neg' : ''}">${moneyShort(totalLimit - totalSpent)}</span>`, `${percent(Math.max(0, 100 - used), 0)} of the budget`)}
            ${committed.length ? stat('Committed due', moneyShort(summary.committedOutstanding), `${committed.filter(l => l.paymentStatus !== 'PAID').length} of ${committed.length} to pay`, Number(summary.committedOutstanding) ? 'attn' : '') : ''}
            ${stat('Free to spend', `<span class="${freeToSpend < 0 ? 'neg' : 'pos'}">${moneyShort(freeToSpend)}</span>`, 'after committed')}
            ${isCurrentMonth && summary.daysLeft ? stat('Safe per day', moneyShort(Math.max(0, freeToSpend) / summary.daysLeft), `for ${summary.daysLeft} days`) : ''}
            ${stat('No budget', moneyShort(summary.unbudgetedSpent), `${unbudgeted.length} categor${unbudgeted.length === 1 ? 'y' : 'ies'}`, '', 'Spending in categories without a budget')}
        </div>
        <div class="bs-score ${scoreTone}" title="Budgets on course (40) · the month against the total budget (30) · months kept within budget (30)">
            ${score !== null ? `<span class="bs-ring" style="--p:${score}"><b>${score}</b></span>` : ''}
            <div class="min-0"><small>${score !== null ? 'Budget score' : 'Health'}</small>${score !== null ? `<b>${scoreLabel}</b>` : ''}
                <div class="bs-health">
                    <button class="h over" data-strip-filter="attention" title="Over or overdue: show them" ${health.over ? '' : 'disabled'}>${health.over}</button>
                    <button class="h watch" data-strip-filter="attention" title="To watch: show them" ${health.watch ? '' : 'disabled'}>${health.watch}</button>
                    <button class="h fine" data-strip-filter="all" title="On track">${health.fine}</button>
                </div></div>
        </div>
    </section>`;
}

/** A sensible limit: the larger of the 3-month average and this month's spend, rounded up to 500. */
function suggestedLimit(l) {
    const base = Math.max(Number(l.averageLast3Months), Number(l.spent)) * 1.05;
    return Math.max(500, Math.ceil(base / 500) * 500);
}

async function copyBudgets(from, to, someExist, reload) {
    let overwrite = false;
    if (someExist) {
        const choice = await confirmDialog(`${monthName(to)} already has some budgets. Copy the missing ones from ${monthName(from)}? Existing budgets are kept as they are.`,
            { title: 'Copy budgets', confirmLabel: 'Copy missing', danger: false });
        if (!choice) return;
    }
    try {
        const summary = await api.post('/budgets/copy', { from, to, overwrite });
        toast(`${monthName(from)}'s budgets copied into ${monthName(to)} · ${money(summary.totalLimit)} in all`);
        reload();
    } catch (error) { toast(error.message, 'error'); }
}

// ===================================================================== detail

/** Middle: the selected category's pace and transactions. Right: the watch list, then its numbers and trend. */
async function drawBudgetDetail(body, line, summary, reload, show, chitPaymentsId = null) {
    // fresh elements each time so handlers of a previously shown budget do not pile up
    const fresh = sel => { const old = body.querySelector(sel); const el = old.cloneNode(false); old.replaceWith(el); return el; };
    const main = fresh('#budget-main');
    const side = fresh('#budget-side');
    if (!line) return;
    const { name: iconName, tone } = categoryIcon(line.categoryName);
    const [y, m] = month.split('-').map(Number);
    const from = isoDate(new Date(y, m - 6, 1));
    const to = isoDate(new Date(y, m, 0));
    const manage = can('MANAGE_BUDGETS');
    const status = line.committed ? PAYMENT[line.paymentStatus] : line.budgetId ? PACE[line.pace] : null;
    const limit = line.monthlyLimit !== null ? Number(line.monthlyLimit) : null;
    const spent = Number(line.spent);
    const used = limit ? spent / limit * 100 : null;

    const projectedLine = Number(line.projected ?? spent);
    const expectedPct = limit && line.expectedByToday != null ? Math.min(Number(line.expectedByToday) / limit * 100, 100) : null;
    main.innerHTML = panel({
        title: line.categoryName, iconName: line.committed ? 'lock' : 'receipt', cls: 'p-budget-tx', bodyClass: 'flush',
        sub: status ? `<span class="pace-chip ${status.tone}">${icon(status.iconName)}${status.label}</span>` : '<span class="muted">no budget</span>',
        actions: `${manage ? `<button class="btn sm" data-budget-act="edit">${icon(line.budgetId ? 'edit' : 'plus')}${line.budgetId ? 'Edit' : 'Set budget'}</button>` : ''}
            ${manage && line.budgetId ? `<button class="btn sm ghost icon danger" data-budget-act="delete" title="Remove budget">${icon('trash')}</button>` : ''}`,
        body: `
            <div class="budget-progress ${status ? `pace-${status.tone}` : ''}">
                <div class="bp-head"><span class="chip-icon ${tone}">${icon(iconName)}</span>
                    <div class="grow min-0"><div class="bp-amounts"><b>${money(spent)}</b><span class="muted">${limit !== null ? `of ${money(limit)}${line.committed ? ' committed' : ''}` : 'spent · no limit set'}</span>
                        ${limit !== null ? `<span class="bp-pct ${used > 100 ? 'neg' : ''}">${percent(used, 0)}</span>` : ''}</div>
                        ${limit !== null ? `<div class="bp-track ${status?.tone || ''}"><span style="width:${Math.min(used, 100)}%"></span>
                            ${!line.committed && month === isoDate().slice(0, 7) && projectedLine > spent ? `<em style="left:${Math.min(used, 100)}%;width:${Math.max(0, Math.min(projectedLine / limit * 100, 100) - Math.min(used, 100))}%" title="Projected ${money(projectedLine)}"></em>` : ''}
                            ${!line.committed && expectedPct !== null && summary.daysLeft ? `<i class="pace-tick" style="left:${expectedPct}%" title="Where the plan says you should be today"></i>` : ''}</div>` : ''}
                    </div></div>
                ${line.insight ? `<div class="bp-insight">${icon('bulb')} ${esc(line.insight)}</div>` : ''}
                ${line.categoryId === chitPaymentsId ? `<div class="bp-insight chits">${icon('chit')} Fills itself from the installments paid on <a href="#/chits">Chits</a> (the cash after dividends). In the books they stay savings, not spending.</div>` : ''}
                <div class="bp-details" id="budget-details">${loading()}</div>
            </div>
            <div class="bp-tx-head"><span class="section-title">${icon('list')} Transactions <span class="muted" id="budget-tx-count"></span></span><span class="spacer"></span>
                <div class="search-box sm">${icon('search')}<input id="budget-tx-search" placeholder="Filter…" data-plain></div>
                <button class="btn sm ghost icon" id="budget-tx-clear" title="Clear the filter" hidden>${icon('x')}</button>
                ${exportButton({ label: '' })}</div>
            <div class="scroll" id="budget-tx">${loading()}</div>`,
    });

    side.innerHTML = `
        <section class="side-card watch">
            <div class="side-head">${icon('alert')}<b>Watch list</b><span class="spacer"></span><span class="small muted">${monthName(month)}</span></div>
            ${watchList(summary)}
        </section>
        <section class="side-card across">
            <div class="side-head">${icon('history')}<b>Across months</b><span class="spacer"></span>${legend([{ label: 'Spent' }, { label: 'Budget' }])}</div>
            <div class="chart across-chart" id="budget-across"></div>
            ${acrossInsights(budgetHistory)}
        </section>
        <section class="side-card">
            <div class="side-head">${icon('pie')}<b>Analysis</b><span class="spacer"></span><span class="small muted">${esc(line.categoryName)}</span></div>
            <div id="budget-analysis">${loading()}</div>
        </section>
        <section class="side-card">
            <div class="side-head">${icon('report')}<b>Last 6 months</b><span class="spacer"></span>
                ${legend(line.budgetId ? [{ label: 'Spent' }, { label: 'Budget' }] : [{ label: 'Spent' }])}</div>
            <div class="chart budget-trend" id="budget-trend"></div>
        </section>
        <section class="side-card">
            <div class="side-head">${icon('bulb')}<b>Insights</b></div>
            <div id="budget-insights">${loading()}</div>
        </section>`;

    const onClick = async e => {
        const act = e.target.closest('[data-budget-act]');
        if (act?.dataset.budgetAct === 'edit') openBudgetForm(line, reload);
        if (act?.dataset.budgetAct === 'delete' && await confirmDialog(`Remove the ${monthName(month)} budget for ${line.categoryName}?`)) {
            await api.del(`/budgets/${line.budgetId}`);
            toast('Budget removed');
            reload();
        }
        const go = e.target.closest('[data-goto]');
        if (go && go.dataset.goto) show(Number(go.dataset.goto));
        const row = e.target.closest('tr[data-entry]');
        if (row && !act) toggleEntryRow(row, null, { onChanged: reload });
    };
    main.addEventListener('click', onClick);
    side.addEventListener('click', onClick);

    // the category's expenses, shaped like ledger rows (debit = spent); Chit Payments: the installments paid
    const isChits = line.categoryId === chitPaymentsId;
    const source = isChits
        ? (await api.get('/budgets/chit-payments', { from, to })).map(x => ({ entryId: x.entryId, date: x.date, narration: x.narration,
            party: x.chitName || x.party, debit: Number(x.amount), counterAccounts: x.paidFrom || '' }))
        : (await api.get('/expenses', { from, to })).filter(x => x.categoryId === line.categoryId)
            .map(x => ({ entryId: x.entryId, date: x.date, narration: x.narration, party: x.party, debit: Number(x.amount), counterAccounts: x.paidFrom }));
    if (!main.isConnected) return;
    const rowsAll = source.sort((a, b) => a.date.localeCompare(b.date) || a.entryId - b.entryId);
    const monthRows = rowsAll.filter(r => r.date.slice(0, 7) === month).reverse();
    const months = Array.from({ length: 6 }, (_, i) => isoDate(new Date(y, m - 6 + i, 1)).slice(0, 7));
    const byMonth = months.map(ym => rowsAll.filter(r => r.date.slice(0, 7) === ym).reduce((s, r) => s + r.debit, 0));
    const largest = monthRows.reduce((mx, r) => (!mx || r.debit > mx.debit ? r : mx), null);
    const avgTicket = monthRows.length ? monthRows.reduce((s, r) => s + r.debit, 0) / monthRows.length : 0;
    const avg = Number(line.averageLast3Months);

    main.querySelector('#budget-details').innerHTML = (line.committed ? [
        metricTile('calendar', 'Due', line.dueDate ? shortDate(line.dueDate) : '—', line.dueDay ? `every month on the ${ordinal(line.dueDay)}` : 'by month end'),
        metricTile('check-circle', 'Paid', money(spent), line.paidOn ? `on ${shortDate(line.paidOn)}` : `${money(Math.max(0, limit - spent))} to go`),
        metricTile('history', '3-month avg', money(Math.round(avg)), avg && limit ? `${avg > limit ? '+' : '−'}${percent(Math.abs(avg - limit) / limit * 100, 0)} vs committed` : 'no history'),
        metricTile('receipt', 'Payments', String(monthRows.length), monthRows.length ? `latest ${shortDate(monthRows[0].date)}` : 'none yet'),
    ] : [
        metricTile('piggy', 'Remaining', limit === null ? '—' : `<span class="${spent > limit ? 'neg' : 'pos'}">${money(limit - spent)}</span>`,
            limit === null ? 'no limit' : spent > limit ? 'over the limit' : `${percent(100 - used, 0)} of the limit`),
        metricTile('calendar', 'Safe per day', line.safePerDay == null ? '—' : money(Math.round(line.safePerDay)), summary.daysLeft ? `${summary.daysLeft} days left` : 'month closed'),
        metricTile('trending', summary.daysLeft ? 'Projected' : 'Month total', money(Math.round(Number(line.projected ?? spent))),
            limit === null ? 'at this pace' : Number(line.projected) > limit ? `<span class="neg">${moneyShort(Number(line.projected) - limit)} over</span>` : `<span class="pos">${moneyShort(limit - Number(line.projected))} spare</span>`,
            limit !== null && Number(line.projected) > limit ? 'highlight' : ''),
        metricTile('activity', 'Daily average', line.dailyAverage == null ? '—' : money(Math.round(line.dailyAverage)),
            line.expectedByToday != null ? `plan by today ${moneyShort(line.expectedByToday)}` : ''),
        metricTile('history', '3-month avg', money(Math.round(avg)),
            avg ? `this month ${spent >= avg ? '+' : '−'}${percent(Math.abs((spent - avg) / avg) * 100, 0)}` : 'no history'),
        metricTile('arrow-up', 'Largest', largest ? money(largest.debit) : '—', largest ? `${shortDate(largest.date)} · ${esc(largest.narration)}` : `${monthRows.length} transactions`),
    ]).join('');
    side.querySelector('#budget-analysis').innerHTML = analysisHtml(monthRows, spent);
    barChart(side.querySelector('#budget-across'), {
        labels: budgetHistory.map(h => h.month), labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Spent', values: budgetHistory.map(h => Number(h.totalSpent) + Number(h.unbudgetedSpent || 0)) },
                 { name: 'Budget', values: budgetHistory.map(h => Number(h.totalLimit)) }],
    });
    bindExport(main, () => ({
        title: `${line.categoryName} · ${monthName(month)}`,
        subtitle: limit !== null ? `Budget ${money(limit)} · spent ${money(spent)} · ${status?.label || ''}` : `Spent ${money(spent)} · no budget`,
        filename: `budget-${line.categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${month}`,
        summary: [['Budget', limit ?? '—'], ['Spent', spent], ['Left', limit !== null ? limit - spent : '—'], ['Projected', Math.round(projectedLine)]],
        sheets: [{ name: 'Transactions', columns: [{ label: 'Date', type: 'date' }, { label: 'Description' }, { label: 'Shop / person' }, { label: 'Paid from' },
            { label: 'Amount', type: 'money' }, { label: 'Month to date', type: 'money' }],
            rows: [...monthRows].reverse().map(r => [r.date, r.narration, r.party || '', r.counterAccounts, r.debit, runningTotal(monthRows, r)]),
            totals: ['Total', '', '', '', spent, ''] }],
    }));

    barChart(side.querySelector('#budget-trend'), {
        labels: months, labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Spent', values: byMonth }, ...(limit !== null ? [{ name: 'Budget', values: months.map(() => limit) }] : [])],
    });
    side.querySelector('#budget-insights').innerHTML = budgetInsights(line, monthRows, byMonth, avgTicket);

    const drawTx = (term = '') => {
        const rows = monthRows.filter(r => !term || `${r.narration} ${r.party || ''} ${r.counterAccounts}`.toLowerCase().includes(term));
        main.querySelector('#budget-tx-count').textContent = `· ${rows.length} · ${money(rows.reduce((s, r) => s + r.debit, 0))}`;
        main.querySelector('#budget-tx').innerHTML = table([
            { label: 'Date', render: r => `<b>${shortDate(r.date)}</b>`, cls: 'nowrap' },
            { label: 'Entry', cls: 'c-entry', render: r => `<div class="entry-cell"><span class="entry-text"><b class="ellipsis">${esc(r.narration)}</b>${!line.committed && avg && r.debit > Math.max(avg * 0.5, avgTicket * 2) && monthRows.length > 1 ? `<span class="mini-flag" title="Much larger than usual" style="color:#a06d00;background:#fdf0cc">${icon('alert')}</span>` : ''}${r.party ? `<span class="entry-party ellipsis">${esc(r.party)}</span>` : ''}</span></div>` },
            { label: 'Paid from', render: r => `<span class="small secondary ellipsis">${esc(r.counterAccounts)}</span>` },
            { label: 'Amount', align: 'r', render: r => `<b>${money(r.debit)}</b>` },
            { label: 'Month to date', align: 'r', render: r => {
                const run = runningTotal(monthRows, r);
                return `<span class="${limit !== null && run > limit ? 'neg' : 'secondary'}">${money(run)}</span>`;
            } },
            { label: '', align: 'r', render: () => `<span class="expand-caret">${icon('chevron-down')}</span>` },
        ], rows, { dense: true, rowClass: () => 'clickable', rowAttrs: r => `data-entry="${r.entryId}"`,
            empty: isChits ? `No chit installment paid in ${monthName(month)} yet. Pay it on the Chits page and it shows here.`
                : line.committed ? `Not paid yet in ${monthName(month)}. Record it as an expense in ${line.categoryName} once paid.` : `Nothing spent on ${line.categoryName} in ${monthName(month)}` });
    };
    const txSearch = main.querySelector('#budget-tx-search');
    txSearch.addEventListener('input', e => {
        drawTx(e.target.value.trim().toLowerCase());
        main.querySelector('#budget-tx-clear').hidden = !e.target.value;
    });
    main.querySelector('#budget-tx-clear').addEventListener('click', () => { txSearch.value = ''; txSearch.dispatchEvent(new Event('input')); });
    drawTx();
}

/** Where this category's money went this month: by weekday and the top places. */
function analysisHtml(rows, spent) {
    if (!rows.length || !spent) return emptyState('Nothing spent yet this month', 'pie');
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const byDay = days.map(() => 0);
    rows.forEach(r => { byDay[(new Date(r.date + 'T00:00:00').getDay() + 6) % 7] += r.debit; });
    const maxDay = Math.max(...byDay) || 1;
    const places = new Map();
    rows.forEach(r => {
        const key = (r.party || r.narration).trim();
        const v = places.get(key) || { count: 0, total: 0 };
        places.set(key, { count: v.count + 1, total: v.total + r.debit });
    });
    const top = [...places.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 4);
    const firstHalf = rows.filter(r => Number(r.date.slice(8)) <= 15).reduce((s, r) => s + r.debit, 0);
    return `
        <div class="ba-days" title="Spent by weekday">${byDay.map((v, i) => `<div class="ba-day"><span class="ba-bar"><i style="height:${(v / maxDay) * 100}%"></i></span><small>${days[i][0]}</small></div>`).join('')}</div>
        <div class="ba-split"><span>1st–15th <b>${percent((firstHalf / spent) * 100, 0)}</b></span><i><em style="width:${(firstHalf / spent) * 100}%"></em></i><span>16th– <b>${percent(((spent - firstHalf) / spent) * 100, 0)}</b></span></div>
        <div class="ba-top">${top.map(([name, v]) => `<div class="ba-row"><span class="ellipsis">${esc(name)}</span><small>${v.count}×</small>
            <i><em style="width:${(v.total / top[0][1].total) * 100}%"></em></i><b>${moneyShort(v.total)}</b></div>`).join('')}</div>`;
}

/** The whole month for Excel / PDF: every budget with its numbers, and the categories without one. */
function monthReport(summary) {
    const lines = summary.lines.filter(l => l.budgetId);
    const status = l => (l.committed ? PAYMENT[l.paymentStatus] : PACE[l.pace])?.label || '';
    return {
        title: `Budgets · ${monthName(month)}`, subtitle: `${lines.length} budgets`, filename: `budgets-${month}`,
        summary: [['Budget', Number(summary.totalLimit)], ['Spent', Number(summary.totalSpent)], ['Projected', Number(summary.projectedTotal)],
            ['Committed due', Number(summary.committedOutstanding)], ['No budget', Number(summary.unbudgetedSpent)]],
        sheets: [
            { name: 'Budgets', columns: [{ label: 'Category' }, { label: 'Kind' }, { label: 'Status' }, { label: 'Budget', type: 'money' }, { label: 'Spent', type: 'money' },
                { label: 'Left', type: 'money' }, { label: 'Used', type: 'percent' }, { label: 'Projected', type: 'money' }, { label: '3-month avg', type: 'money' }],
              rows: lines.map(l => [l.categoryName, l.committed ? `Committed${l.dueDate ? ` · due ${shortDate(l.dueDate)}` : ''}` : 'Spending', status(l), Number(l.monthlyLimit),
                  Number(l.spent), Number(l.remaining), Number(l.usedPercent), Math.round(Number(l.projected ?? l.spent)), Math.round(Number(l.averageLast3Months))]),
              totals: ['Total', '', '', Number(summary.totalLimit), Number(summary.totalSpent), Number(summary.totalLimit) - Number(summary.totalSpent), '', Number(summary.projectedTotal), ''] },
            { name: 'Without a budget', columns: [{ label: 'Category' }, { label: 'Spent', type: 'money' }, { label: '3-month avg', type: 'money' }],
              rows: summary.lines.filter(l => !l.budgetId && Number(l.spent)).map(l => [l.categoryName, Number(l.spent), Math.round(Number(l.averageLast3Months))]) },
        ],
    };
}

/**
 * 0-100 for the month: how many budgets are on course (40), how the whole month is heading against the total
 * budget (30) and how many of the last months stayed within budget (30).
 */
function budgetScore(summary, history, isCurrentMonth) {
    const lines = summary.lines.filter(l => l.budgetId);
    if (!lines.length) return null;
    const fine = lines.filter(l => l.committed ? l.paymentStatus !== 'OVERDUE' : !['OVER', 'HEADING_OVER'].includes(l.pace)).length / lines.length;
    const limit = Number(summary.totalLimit), end = isCurrentMonth ? Number(summary.projectedTotal) : Number(summary.totalSpent);
    const course = !limit ? 1 : end <= limit ? 1 : Math.max(0, 1 - (end - limit) / limit * 2);
    const closed = history.filter(h => h.month < month && Number(h.totalLimit) > 0);
    const kept = closed.length ? closed.filter(h => Number(h.totalSpent) <= Number(h.totalLimit)).length / closed.length : course;
    return Math.round(fine * 40 + course * 30 + kept * 30);
}

/** Patterns across the last six months: streaks, budgets that are always over or under, unbudgeted leakage. */
function acrossInsights(history) {
    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    const closed = history.filter(h => h.month < isoDate().slice(0, 7) && Number(h.totalLimit) > 0);
    if (closed.length >= 2) {
        const kept = closed.filter(h => Number(h.totalSpent) <= Number(h.totalLimit)).length;
        let streak = 0;
        for (let i = closed.length - 1; i >= 0 && Number(closed[i].totalSpent) <= Number(closed[i].totalLimit); i--) streak++;
        tip(kept === closed.length ? 'good' : kept >= closed.length / 2 ? 'info' : 'warn', 'flag',
            `Within budget in <b>${kept} of the last ${closed.length}</b> months${streak >= 2 ? `, ${streak} in a row` : ''}.`);
    }
    // per category over the months that had a budget
    const byCat = new Map();
    history.forEach(h => h.lines.filter(l => l.budgetId && !l.committed).forEach(l => {
        const c = byCat.get(l.categoryId) || { name: l.categoryName, months: 0, over: 0, low: 0, spent: 0, limit: 0, lastLimit: Number(l.monthlyLimit) };
        c.months++; c.spent += Number(l.spent); c.limit += Number(l.monthlyLimit); c.lastLimit = Number(l.monthlyLimit);
        if (Number(l.spent) > Number(l.monthlyLimit)) c.over++;
        if (Number(l.spent) < Number(l.monthlyLimit) * 0.6) c.low++;
        byCat.set(l.categoryId, c);
    }));
    const cats = [...byCat.values()].filter(c => c.months >= 3);
    const alwaysOver = cats.filter(c => c.over >= Math.ceil(c.months / 2)).sort((a, b) => b.over - a.over)[0];
    if (alwaysOver) {
        const avg = c => c.spent / c.months;
        tip('warn', 'trending', `<b>${esc(alwaysOver.name)}</b> went over in ${alwaysOver.over} of ${alwaysOver.months} months (avg ${money(Math.round(avg(alwaysOver)))} vs ${money(alwaysOver.lastLimit)}). Either cut back or set a realistic ${money(Math.ceil(avg(alwaysOver) / 500) * 500)}.`);
    }
    const roomy = cats.filter(c => c.low >= Math.ceil(c.months * 0.66));
    if (roomy.length) {
        const free = roomy.reduce((s, c) => s + Math.max(0, c.lastLimit - Math.ceil((c.spent / c.months) * 1.1 / 500) * 500), 0);
        if (free > 0) tip('info', 'piggy', `${roomy.map(c => `<b>${esc(c.name)}</b>`).join(', ')} usually use${roomy.length === 1 ? 's' : ''} under 60% of the limit. Trimming ${roomy.length === 1 ? 'it' : 'them'} frees about <b>${money(free)}</b> a month (${moneyShort(free * 12)} a year) for savings.`);
    }
    const leak = history.filter(h => h.month < isoDate().slice(0, 7) && Number(h.totalLimit) > 0);   // months that had budgets
    if (leak.length) {
        const avgLeak = leak.reduce((s, h) => s + Number(h.unbudgetedSpent || 0), 0) / leak.length;
        const total = leak.reduce((s, h) => s + Number(h.totalSpent) + Number(h.unbudgetedSpent || 0), 0) / leak.length;
        if (avgLeak > 0 && total && avgLeak / total > 0.15) tip('warn', 'alert-circle', `About <b>${money(Math.round(avgLeak))}</b> a month (${percent(avgLeak / total * 100, 0)} of spending) goes to categories without a budget.`);
    }
    const now = history[history.length - 1];
    const before = history.slice(0, -1).filter(h => Number(h.totalSpent) > 0);
    if (now && before.length >= 2) {
        const avg = before.reduce((s, h) => s + Number(h.totalSpent), 0) / before.length;
        const proj = Number(now.projectedTotal || now.totalSpent);
        if (avg) tip(proj > avg * 1.1 ? 'warn' : proj < avg * 0.9 ? 'good' : 'info', 'activity',
            `This month is heading for <b>${money(Math.round(proj))}</b> on budgeted categories, ${proj >= avg ? `${percent((proj - avg) / avg * 100, 0)} above` : `${percent((avg - proj) / avg * 100, 0)} below`} your usual ${money(Math.round(avg))}.`);
        const committed = now.lines.filter(l => l.budgetId && l.committed).reduce((s, l) => s + Number(l.monthlyLimit), 0);
        if (committed && Number(now.totalLimit)) tip('info', 'lock', `Committed payments take <b>${percent(committed / Number(now.totalLimit) * 100, 0)}</b> of the budget (${money(committed)}); the rest is what you can steer.`);
    }
    return tips.length ? `<div class="insights">${tips.join('')}</div>` : '<p class="small muted" style="margin:6px 0 0">Insights across months appear once a few months have budgets.</p>';
}

/** The server's alerts for the month, most urgent first; a click opens the category. */
function watchList(summary) {
    if (!summary.alerts.length) return `<div class="watch-item good">${icon('check-circle')}<div><b>Nothing needs attention</b><p>Every budget is on track.</p></div></div>`;
    const shown = summary.alerts.slice(0, 6);
    const rest = summary.alerts.length - shown.length;
    return `<div class="watch-list">${shown.map(a => `
        <div class="watch-item ${a.severity} ${a.categoryId ? 'clickable' : ''}" ${a.categoryId ? `data-goto="${a.categoryId}"` : ''}>
            ${icon(SEVERITY_ICON[a.severity] || 'info')}
            <div><b>${esc(a.title)}</b><p>${esc(a.message)}</p>${a.hint ? `<p class="hint-line">${icon('bulb')}${esc(a.hint)}</p>` : ''}</div>
        </div>`).join('')}
        ${rest > 0 ? `<div class="small muted" style="padding:2px 6px">+${rest} more · ${summary.alerts.slice(6).map(a => esc(a.title)).join(' · ')}</div>` : ''}</div>`;
}

/** Month-to-date total up to and including this row (rows are newest first). */
function runningTotal(rows, row) {
    let total = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        total += rows[i].debit;
        if (rows[i] === row) break;
    }
    return total;
}

function metricTile(iconName, label, value, note = '', cls = '') {
    return `<div class="metric ${cls}"><span class="metric-icon">${icon(iconName)}</span>
        <div class="min-0"><div class="label">${esc(label)}</div><div class="value">${value}</div>${note ? `<div class="note ellipsis">${note}</div>` : ''}</div></div>`;
}

/** Plain-language observations about one category's spending. */
function budgetInsights(line, rows, byMonth, avgTicket) {
    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    const spent = Number(line.spent);
    const avg = Number(line.averageLast3Months);
    const limit = line.monthlyLimit !== null ? Number(line.monthlyLimit) : null;

    if (line.committed) {
        if (avg && limit && Math.abs(avg - limit) / limit > 0.1) tip('info', 'history', `Over the last 3 months this averaged <b>${money(avg)}</b>, ${avg > limit ? 'more' : 'less'} than the committed ${money(limit)}.`);
        if (line.paymentStatus === 'PAID' && line.dueDate && line.paidOn && line.paidOn > line.dueDate) tip('warn', 'clock', `Paid ${Math.round((new Date(line.paidOn) - new Date(line.dueDate)) / 86400000)} day(s) after the due date.`);
        if (line.paymentStatus === 'PAID' && line.paidOn && line.dueDate && line.paidOn <= line.dueDate) tip('good', 'check-circle', 'Paid on time this month.');
    } else {
        if (limit === null && avg) tip('info', 'target', `No budget yet. Your 3-month average is <b>${money(avg)}</b>; a limit of <b>${money(suggestedLimit(line))}</b> would fit.`);
        if (avg && spent > avg * 1.2) tip('warn', 'arrow-up', `This month is <b>${percent(((spent - avg) / avg) * 100, 0)}</b> above your 3-month average.`);
        if (limit !== null && avg && avg < limit * 0.6) tip('info', 'piggy', `You usually spend well under this limit (avg ${money(avg)}). Lowering it to ${money(suggestedLimit({ ...line, spent: 0 }))} frees money for savings.`);
        if (line.limitReachedOn) tip('warn', 'calendar', `At the current pace the limit is reached around <b>${shortDate(line.limitReachedOn)}</b>.`);
    }
    if (rows.length >= 2 && spent > 0) {
        const byPlace = new Map();
        rows.forEach(r => {
            const key = (r.party || r.narration).trim();
            const v = byPlace.get(key) || { count: 0, total: 0 };
            byPlace.set(key, { count: v.count + 1, total: v.total + r.debit });
        });
        const [topName, top] = [...byPlace.entries()].sort((a, b) => b[1].total - a[1].total)[0];
        tip('info', 'tag', `Biggest item: <b>${esc(topName)}</b> · ${money(top.total)}${top.count > 1 ? ` over ${top.count} times` : ''} (${percent((top.total / spent) * 100, 0)} of the month).`);
        const weekend = rows.filter(r => [0, 6].includes(new Date(r.date + 'T00:00:00').getDay())).reduce((s, r) => s + r.debit, 0);
        if (weekend / spent > 0.45) tip('info', 'calendar', `${percent((weekend / spent) * 100, 0)} of this spending happened on weekends.`);
        if (avgTicket) tip('info', 'receipt', `${rows.length} transactions, ${money(Math.round(avgTicket))} on average.`);
    }
    const history = byMonth.slice(0, -1).filter(v => v > 0);
    if (history.length >= 3 && byMonth.slice(-4).every((v, i, a) => i === 0 || v >= a[i - 1])) tip('warn', 'trending', 'Spending here has risen every month for the last four months.');
    return tips.length ? `<div class="insights">${tips.join('')}</div>` : emptyState('Nothing unusual this month', 'check-circle');
}

// ===================================================================== forms

/** Create budgets for unbudgeted categories in one go, from their 3-month average. */
function openSuggestions(lines, reload) {
    openModal({
        title: `Suggested budgets · ${monthName(month)}`, iconName: 'sparkles', size: 'lg',
        body: `<p class="hint" style="margin:0 0 8px">Based on your last three months, rounded up to the nearest 500. Untick or change any amount.</p>
            <form><table class="grid compact"><thead><tr><th></th><th>Category</th><th class="r">3-mo avg</th><th class="r">This month</th><th class="r">Monthly limit</th></tr></thead>
            <tbody>${lines.map(l => `<tr>
                <td><input type="checkbox" name="pick-${l.categoryId}" checked></td>
                <td><b>${esc(l.categoryName)}</b></td>
                <td class="r">${money(l.averageLast3Months)}</td><td class="r">${money(l.spent)}</td>
                <td class="r"><input type="number" step="any" class="num" name="limit-${l.categoryId}" value="${suggestedLimit(l)}" style="width:110px" data-plain></td>
            </tr>`).join('')}</tbody></table></form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Create budgets', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const picked = lines.filter(l => m.el.querySelector(`[name="pick-${l.categoryId}"]`).checked);
                for (const l of picked) {
                    const limit = Number(m.el.querySelector(`[name="limit-${l.categoryId}"]`).value);
                    if (limit > 0) await api.post('/budgets', { categoryId: l.categoryId, monthlyLimit: limit, alertPercent: 80, month });
                }
                toast(`${picked.length} budget(s) created for ${monthName(month)}`);
                reload();
            },
        }],
    });
}

/** Set or edit a budget for the month shown; committed payments have a due day instead of an alert level. */
async function openBudgetForm(line, reload, { committed = false } = {}) {
    const categories = await categoriesOf('EXPENSE', line?.categoryId, { budget: true });
    const isCommitted = line?.budgetId ? line.committed : committed;
    openModal({
        title: line?.budgetId ? `${monthName(month)} · ${line.categoryName}` : isCommitted ? `Committed payment · ${monthName(month)}` : `Set budget · ${monthName(month)}`,
        iconName: isCommitted ? 'lock' : 'target',
        body: `<form class="form-grid two budget-form ${isCommitted ? 'is-committed' : ''}">
            <div class="span-2 seg-chips" data-kind-switch>
                <button type="button" class="seg-chip ${isCommitted ? '' : 'active'}" data-kind="spend">${icon('target')}Spending limit</button>
                <button type="button" class="seg-chip ${isCommitted ? 'active' : ''}" data-kind="committed">${icon('lock')}Committed payment</button></div>
            <p class="span-2 hint kind-hint" data-hint>${isCommitted ? 'A payment that has to be made without fail (rent, school fees, an EMI). Tracked as paid, due or overdue.'
                : 'A limit for the month; you are warned as spending runs ahead of it.'}</p>
            ${field({ label: 'Expense category', name: 'categoryId', type: 'select', required: true, span: 'span-2',
                      options: categoryOptions(categories, line?.categoryId) })}
            ${field({ label: isCommitted ? 'Amount to pay' : 'Monthly limit', name: 'monthlyLimit', type: 'number',
                      value: line?.monthlyLimit ?? (line ? suggestedLimit(line) : ''), required: true })}
            <label class="field only-spend"><span>Warn at % used</span><input name="alertPercent" type="number" min="1" max="100" value="${line?.alertPercent ?? 80}" data-plain></label>
            <label class="field only-committed"><span>Due on day</span><input name="dueDay" type="number" min="1" max="31" value="${line?.dueDay ?? ''}" placeholder="e.g. 5" data-plain></label>
            ${field({ label: 'Notes', name: 'notes', value: line?.notes, span: 'span-2' })}
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            form.querySelector('[data-kind-switch]').addEventListener('click', e => {
                const b = e.target.closest('[data-kind]');
                if (!b) return;
                const c = b.dataset.kind === 'committed';
                form.classList.toggle('is-committed', c);
                form.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === b));
                form.querySelector('[data-hint]').textContent = c ? 'A payment that has to be made without fail (rent, school fees, an EMI). Tracked as paid, due or overdue.'
                    : 'A limit for the month; you are warned as spending runs ahead of it.';
                form.monthlyLimit.closest('.field').querySelector('span').textContent = (c ? 'Amount to pay' : 'Monthly limit') + ' *';
            });
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Save', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                const isC = form.classList.contains('is-committed');
                await api.post('/budgets', { ...data, month, committed: isC, dueDay: isC ? data.dueDay : null,
                    alertPercent: data.alertPercent || 80, version: line?.version ?? null });
                toast(isC ? 'Committed payment saved' : 'Budget saved');
                reload();
            },
        }],
    });
}

// ===================================================================== helpers

function shiftMonth(ym, step) {
    const [y, m] = ym.split('-').map(Number);
    return isoDate(new Date(y, m - 1 + step, 1)).slice(0, 7);
}

function monthName(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function shortMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
