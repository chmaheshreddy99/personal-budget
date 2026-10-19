/**
 * Income: everything that came in, by source.
 *   left    a list like the Reports pane: the period total, "All sources" (chosen on every visit), then only the
 *           sources that received something in the period; the quiet ones stay behind "show more".
 *           Click or ↑ / ↓ to filter
 *   middle  what was received, newest first; a row expands to its journal
 *   right   chit gains, the 12-month trend (earned vs passive), the source mix and insights
 *
 * Chit gains are income: dividends with each installment and, at payout, whatever you receive above
 * what you paid in (e.g. paid 5,00,000, received 5,70,000: 70,000 of chit gains). Both are booked to
 * Income under the "Chit Gains" category, so they show here like any other source.
 * Sources are the income categories: every income goes to the one Income account, tagged with one.
 */
import { api } from '../core/api.js';
import { can, categoriesOf } from '../core/store.js';
import { esc, panel, table, emptyState } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, monthLabel } from '../core/format.js';
import { barChart, donutChart, foldOthers, seriesColor, legend } from '../core/charts.js';
import { openQuickEntry } from '../components/transaction-forms.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { exportButton, bindExport } from '../core/export.js';

/** Periods in toolbar order; "Range" picks exact dates. "All" reaches back to the first income. */
const PERIODS = {
    month: { label: 'This month', range: t => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
    lastmonth: { label: 'Last month', range: t => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
    quarter: { label: 'This quarter', range: t => [new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1), t] },
    year: { label: 'This year', range: t => [new Date(t.getFullYear(), 0, 1), t] },
    fy: { label: 'This FY', range: t => [new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1), t] },
    m12: { label: '12 months', range: t => [new Date(t.getFullYear(), t.getMonth() - 11, 1), t] },
    all: { label: 'All', range: t => [new Date(2000, 0, 1), t] },
    custom: { label: 'Range', range: () => [new Date(view.from + 'T00:00:00'), new Date(view.to + 'T00:00:00')] },
};
const PERIOD_KEYS = Object.keys(PERIODS).filter(k => k !== 'custom');

/** Income that keeps coming without daily work. */
const PASSIVE = /interest|dividend|capital|rental|rent|chit/i;

const view = { period: 'month', sourceId: null, q: '', from: isoDate(), to: isoDate(), showQuiet: false };

export async function render(container, _params, isCurrent) {
    // a fresh visit starts on every source; a reload or live refresh keeps the choice
    if (!container.querySelector('.income-page')) { view.sourceId = null; view.showQuiet = false; }
    const today = new Date(isoDate() + 'T00:00:00');
    let [fromD, toD] = PERIODS[view.period].range(today);
    const from = isoDate(fromD), to = isoDate(toD);
    if (view.period !== 'custom') { view.from = from; view.to = to; }
    const spanDays = Math.round((toD - fromD) / 86400000) + 1;
    const yearStart = isoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1));
    const earliest = [yearStart, isoDate(new Date(fromD.getTime() - spanDays * 86400000))].sort()[0];

    const [entries, categories, chits] = await Promise.all([
        api.get('/transactions', { from: earliest, to: [isoDate(), to].sort().pop(), limit: 100000 }),
        categoriesOf('INCOME'),
        api.get('/chits').catch(() => []),
    ]);
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);

    // one row per entry and income category it credits (0 = income without a category)
    const rows = [];
    entries.forEach(e => {
        const incomeLines = e.lines.filter(l => l.accountClass === 'INCOME');
        if (!incomeLines.length || e.voucherType === 'REVERSAL') return;
        const into = e.lines.filter(l => l.accountClass !== 'INCOME' && Number(l.debit) > 0).map(l => l.accountName);
        const bySource = new Map();
        incomeLines.forEach(l => bySource.set(l.categoryId ?? 0, (bySource.get(l.categoryId ?? 0) || 0) + Number(l.credit) - Number(l.debit)));
        bySource.forEach((amount, accountId) => {
            if (Math.abs(amount) < 0.005) return;
            const line = incomeLines.find(l => (l.categoryId ?? 0) === accountId);
            rows.push({ entry: e, date: e.entryDate, accountId, source: line.accountName, amount, into: into.join(', ') || '—',
                passive: PASSIVE.test(line.accountName) });
        });
    });
    const inRange = (r, a, b) => r.date >= a && r.date <= b;
    const period = rows.filter(r => inRange(r, from, to));
    const prevTo = isoDate(new Date(fromD.getTime() - 86400000));
    const prevFrom = isoDate(new Date(fromD.getTime() - spanDays * 86400000));
    const previous = rows.filter(r => inRange(r, prevFrom, prevTo));
    const sum = list => list.reduce((s, r) => s + r.amount, 0);
    const total = sum(period);
    const prevTotal = sum(previous);
    const change = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : null;
    // "All": count months from the first income, not from 2000
    if (view.period === 'all' && rows.length) fromD = new Date(rows.reduce((m, r) => r.date < m ? r.date : m, to) + 'T00:00:00');
    const months = Math.max(1, (toD.getFullYear() - fromD.getFullYear()) * 12 + toD.getMonth() - fromD.getMonth() + 1);

    const sources = categories.map(a => {
        const own = period.filter(r => r.accountId === a.id);
        return { account: a, amount: sum(own), count: own.length, passive: PASSIVE.test(a.name) };
    }).sort((x, y) => y.amount - x.amount || x.account.name.localeCompare(y.account.name));
    if (view.sourceId && !sources.some(s => s.account.id === view.sourceId)) view.sourceId = null;
    // only sources with income in the period; the rest (and a selected quiet one) behind "show more"
    const active = sources.filter(s => s.amount || s.count);
    const quiet = sources.filter(s => !(s.amount || s.count));
    if (view.sourceId && quiet.some(s => s.account.id === view.sourceId)) view.showQuiet = true;
    const sourceItem = s => {
        const ci = categoryIcon(s.account.name);
        const share = total ? (s.amount / total) * 100 : 0;
        return `<div class="list-item clickable bn-item in-item ${view.sourceId === s.account.id ? 'selected' : ''} ${s.amount ? '' : 'quiet'}" data-source="${s.account.id}">
            <span class="chip-icon sm ${ci.tone}">${icon(s.account.systemKey === 'CHIT_GAINS' ? 'chit' : ci.name)}</span>
            <div class="grow"><div class="bn-row"><span class="title">${esc(s.account.name)}</span><b class="bn-amt">${moneyShort(s.amount)}</b></div>
                <div class="bn-row meta"><span>${s.count ? `${s.count}× · ${percent(share, 0)}` : 'nothing this period'}</span>${s.passive ? '<span class="bn-left in-passive">passive</span>' : ''}</div>
                <i class="bn-bar"><em style="width:${share}%"></em></i></div>
        </div>`;
    };
    const q = view.q.toLowerCase();
    const list = period.filter(r => (!view.sourceId || r.accountId === view.sourceId)
        && (!q || `${r.entry.narration} ${r.source} ${r.into} ${r.entry.party || ''}`.toLowerCase().includes(q)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.entry.id - a.entry.id);
    const passive = sum(period.filter(r => r.passive));

    container.innerHTML = `
    <div class="page income-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('arrow-in')} Income</h2>
            <div class="seg-chips" id="in-periods">${PERIOD_KEYS.map(k =>
                `<button class="seg-chip ${view.period === k ? 'active' : ''}" data-period="${k}">${PERIODS[k].label}</button>`).join('')}
                <button class="seg-chip ${view.period === 'custom' ? 'active' : ''}" data-period="custom" title="Pick a date range">${icon('calendar')}Range</button></div>
            <span class="xp-range ${view.period === 'custom' ? 'editing' : ''}">${view.period === 'custom'
                ? `<input type="date" id="in-from" value="${view.from}" max="${isoDate()}" data-plain> – <input type="date" id="in-to" value="${view.to}" data-plain>`
                : `${icon('calendar')} ${view.period === 'all' ? `since ${date(isoDate(fromD))}` : `${date(from)} – ${date(to)}`}`}</span>
            <span class="spacer"></span>
            <div class="search-box">${icon('search')}<input id="in-search" placeholder="Search received…" value="${esc(view.q)}" data-plain></div>
            ${view.q || view.sourceId || view.period !== 'month' ? `<button class="btn sm ghost" id="in-clear" title="This month, every source, no search">${icon('x')}Clear filters</button>` : ''}
            ${exportButton({ label: '' })}
            ${can('POST_TRANSACTIONS') ? `<a class="btn" href="#/chits" title="Chit payouts and dividends">${icon('chit')}Chits</a>
                <button class="btn primary" id="in-add">${icon('plus')}Add income <span class="kbd light">I</span></button>` : ''}
        </div>

        ${panel({ title: 'Sources', iconName: 'layers', cls: 'p-in-nav', bodyClass: 'flush', sub: PERIODS[view.period].label,
            body: `
            <div class="in-sum">
                <div class="bn-row"><span class="in-sum-label">Received</span><b class="in-sum-total">${money(total)}</b></div>
                <div class="bn-row meta">${change === null ? `<span>${period.length} receipts</span>` : `<span class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '▲' : '▼'} ${percent(Math.abs(change), 0)} vs previous</span>`}
                    <span class="bn-left">${moneyShort(total / months)}/month</span></div>
                <i class="in-split" title="Earned vs passive income"><span class="earned" style="width:${total ? ((total - passive) / total) * 100 : 0}%"></span><span class="passive" style="width:${total ? (passive / total) * 100 : 0}%"></span></i>
                <div class="bn-row meta"><span><i class="sw earned"></i>${percent(total ? ((total - passive) / total) * 100 : 0, 0)} earned</span><span class="bn-left"><i class="sw passive"></i>${percent(total ? (passive / total) * 100 : 0, 0)} passive</span></div>
            </div>
            <div class="list bn-list" id="in-sources">
                <div class="list-item clickable bn-item ${view.sourceId === null ? 'selected' : ''}" data-source="">
                    <span class="chip-icon sm">${icon('layers')}</span>
                    <div class="grow"><div class="bn-row"><span class="title">All sources</span><b class="bn-amt">${moneyShort(total)}</b></div>
                        <div class="bn-row meta"><span>${active.length} source${active.length === 1 ? '' : 's'} · ${period.length} receipts</span></div></div></div>
                ${active.length ? '<div class="section-title bn-sep"><span>With income</span><b>' + active.length + '</b></div>' : ''}
                ${active.map(sourceItem).join('')}
                ${quiet.length ? `<button class="in-more" id="in-more">${icon(view.showQuiet ? 'chevron-up' : 'chevron-down')}${view.showQuiet ? 'Hide' : 'Show'} ${quiet.length} without income</button>` : ''}
                ${view.showQuiet ? quiet.map(sourceItem).join('') : ''}
            </div>
            <div class="bn-foot"><span class="kbd">↑</span><span class="kbd">↓</span> source · <span class="kbd">←</span><span class="kbd">→</span> period · <span class="kbd">/</span> search</div>` })}

        ${panel({ title: view.sourceId ? categories.find(a => a.id === view.sourceId).name : 'Received', iconName: 'list', cls: 'p-in-list', bodyClass: 'flush',
            sub: `${list.length} · ${money(sum(list))}`,
            body: `<div class="scroll" id="in-list">${table([
                { label: 'Date', render: r => `<b>${shortDate(r.date)}</b> <span class="muted small">${new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</span>`, cls: 'nowrap' },
                { label: 'Source', render: r => { const ci = categoryIcon(r.source); return `<span class="cell-flex"><span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span><span class="ellipsis">${esc(r.source)}</span></span>`; } },
                { label: 'Description', render: r => `<span class="strong">${esc(r.entry.narration)}</span>${r.entry.party ? ` <span class="small muted">· ${esc(r.entry.party)}</span>` : ''}` },
                { label: 'Into', render: r => `<span class="small secondary">${esc(r.into)}</span>` },
                { label: 'Amount', align: 'r', render: r => `<b class="${r.amount >= 0 ? 'pos' : 'neg'}">${money(r.amount)}</b>` },
                { label: '', align: 'r', render: () => `<span class="expand-caret">${icon('chevron-down')}</span>` },
            ], list, { dense: true, rowClass: () => 'clickable', rowAttrs: r => `data-entry="${r.entry.id}"`, empty: 'Nothing received in this period' })}</div>` })}

        <aside class="in-side">
            ${chitGainsCard(chits, rows, from, to)}
            <section class="side-card">
                <div class="side-head">${icon('report')}<b>Last 12 months</b><span class="spacer"></span>${legend([{ label: 'Earned' }, { label: 'Passive' }])}</div>
                <div class="chart in-trend" id="in-trend"></div>
            </section>
            <section class="side-card">
                <div class="side-head">${icon('pie')}<b>Mix</b><span class="spacer"></span><span class="small muted">${PERIODS[view.period].label}</span></div>
                ${total ? '<div class="in-mix"><div class="chart" id="in-mix"></div><div class="in-mix-legend" id="in-mix-legend"></div></div>' : emptyState('Nothing received yet', 'pie')}
            </section>
            <section class="side-card">
                <div class="side-head">${icon('bulb')}<b>Insights</b></div>
                ${insightsHtml(rows, sources, total, passive, months, today)}
            </section>
        </aside>
    </div>`;

    // ---- charts
    const monthsList = Array.from({ length: 12 }, (_, i) => isoDate(new Date(today.getFullYear(), today.getMonth() - 11 + i, 1)).slice(0, 7));
    const ofMonth = (m, isPassive) => sum(rows.filter(r => r.date.startsWith(m) && r.passive === isPassive));
    barChart(container.querySelector('#in-trend'), {
        labels: monthsList, labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Earned', values: monthsList.map(m => ofMonth(m, false)) }, { name: 'Passive', values: monthsList.map(m => ofMonth(m, true)) }],
    });
    if (total) {
        const items = foldOthers(sources.filter(s => s.amount > 0).map(s => ({ label: s.account.name, value: s.amount })), 6);
        donutChart(container.querySelector('#in-mix'), { items, format: v => money(v), centerValue: moneyShort(total), centerLabel: 'received' });
        container.querySelector('#in-mix-legend').innerHTML = items.map((it, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
            <span class="ellipsis">${esc(it.label)}</span><b>${percent((it.value / total) * 100, 0)}</b></div>`).join('');
    }

    // ---- events
    const on = (sel, evt, fn) => container.querySelector(sel)?.addEventListener(evt, fn);
    on('#in-add', 'click', () => openQuickEntry({ kind: 'INCOME', onSaved: reload }));
    on('#in-periods', 'click', e => {
        const b = e.target.closest('[data-period]');
        if (b) { view.period = b.dataset.period; reload(); }
    });
    const onRange = () => {
        const a = container.querySelector('#in-from').value, b = container.querySelector('#in-to').value;
        if (a && b && a <= b) { view.from = a; view.to = b; reload(); }
    };
    on('#in-from', 'change', onRange);
    on('#in-to', 'change', onRange);
    bindExport(container.querySelector('.page-toolbar'), () => ({
        title: view.sourceId ? `Income · ${categories.find(a => a.id === view.sourceId)?.name}` : 'Income',
        subtitle: `${date(isoDate(fromD))} – ${date(to)}`, filename: `income-${isoDate(fromD)}-to-${to}`,
        summary: [['Received', total], ['Receipts', period.length, 'number'], ['Per month', Math.round(total / months)], ['Passive share', total ? (passive / total) * 100 : 0, 'percent']],
        sheets: [
            { name: 'Received', columns: [{ label: 'Date', type: 'date' }, { label: 'Source' }, { label: 'Description' }, { label: 'From' }, { label: 'Into' }, { label: 'Amount', type: 'money' }],
              rows: list.map(r => [r.date, r.source, r.entry.narration, r.entry.party || '', r.into, r.amount]),
              totals: ['Total', '', '', '', '', sum(list)] },
            { name: 'By source', columns: [{ label: 'Source' }, { label: 'Receipts', type: 'number' }, { label: 'Received', type: 'money' }, { label: 'Share', type: 'percent' }],
              rows: sources.filter(s => s.amount).map(s => [s.account.name, s.count, s.amount, total ? (s.amount / total) * 100 : 0]),
              totals: ['Total', period.length, total, 100] },
        ],
    }));
    let timer;
    on('#in-clear', 'click', () => { view.q = ''; view.sourceId = null; view.period = 'month'; reload(); });
    on('#in-search', 'input', e => { clearTimeout(timer); timer = setTimeout(() => { view.q = e.target.value.trim(); reload(); }, 300); });
    const sourcesEl = container.querySelector('#in-sources');
    const pick = el => { view.sourceId = el.dataset.source ? Number(el.dataset.source) : null; reload(); };
    sourcesEl.addEventListener('click', e => {
        if (e.target.closest('#in-more')) { view.showQuiet = !view.showQuiet; reload(); return; }
        const el = e.target.closest('[data-source]');
        if (el) pick(el);
    });
    sourcesEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    container.querySelector('#in-list').addEventListener('click', e => {
        const row = e.target.closest('tr[data-entry]');
        if (row) toggleEntryRow(row, null, { onChanged: reload });
    });

    // ↑ / ↓ through the sources, ← / → through the periods
    const nav = listNavigator({
        items: () => [...sourcesEl.querySelectorAll('[data-source]')],
        selected: () => sourcesEl.querySelector('.selected'),
        select: el => { clearTimeout(timer); timer = setTimeout(() => pick(el), 120); sourcesEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected')); el.classList.add('selected'); },
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
            const i = PERIOD_KEYS.indexOf(view.period) + (e.key === 'ArrowRight' ? 1 : -1);
            if (i >= 0 && i < PERIOD_KEYS.length) { view.period = PERIOD_KEYS[i]; reload(); }
            return true;
        }
        return false;
    });
}

/**
 * Chit gains: dividends with each installment and, at payout, what you receive above what you paid in.
 * Realised gains are already in the books as income; running chits show what they are expected to add.
 */
function chitGainsCard(chits, rows, from, to) {
    if (!chits.length) return '';
    const booked = rows.filter(r => r.source.toLowerCase().includes('chit')).reduce((s, r) => s + r.amount, 0);
    const bookedPeriod = rows.filter(r => r.source.toLowerCase().includes('chit') && r.date >= from && r.date <= to).reduce((s, r) => s + r.amount, 0);
    const done = chits.filter(c => c.payoutAmount !== null);
    const running = chits.filter(c => c.payoutAmount === null && (c.status === 'ACTIVE' || c.status === 'PRIZED'));
    const realised = done.reduce((s, c) => s + Number(c.realizedGain || 0), 0);
    const expected = running.reduce((s, c) => s + Number(c.projectedNetGain || 0), 0);
    const line = c => {
        const paidOut = c.payoutAmount !== null;
        const gain = paidOut ? Number(c.realizedGain) : Number(c.projectedNetGain);
        const base = Number(c.totalContribution) || 1;
        return `<a class="cg-row" href="#/chits" title="${esc(c.name)}">
            <span class="ellipsis"><b>${esc(c.name)}</b><small>${paidOut ? `paid ${moneyShort(c.totalContribution)} · got ${moneyShort(c.payoutAmount)}` : `${c.installmentsPaid}/${c.numberOfInstallments} paid · dividends ${moneyShort(c.dividendsEarned)}`}</small></span>
            <span class="r"><b class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : '−'}${moneyShort(Math.abs(gain))}</b><small>${paidOut ? 'realised' : 'expected'} · ${percent((gain / base) * 100, 1)}</small></span></a>`;
    };
    return `
    <section class="chit-gains">
        <div class="cg-head">${icon('chit')}<b>Chit gains</b><span class="spacer"></span><span class="cg-pill">income</span></div>
        <div class="cg-figs">
            <div><span>Booked, 12 months</span><b>${money(Math.round(booked))}</b><small>${moneyShort(bookedPeriod)} in this period</small></div>
            <div><span>Realised on payouts</span><b>${money(Math.round(realised))}</b><small>${done.length} chit${done.length === 1 ? '' : 's'} paid out</small></div>
            <div><span>Still to come</span><b>${money(Math.round(expected))}</b><small>${running.length} running</small></div>
        </div>
        <div class="cg-rows">${[...running, ...done].map(line).join('')}</div>
        <p class="cg-note">${icon('info')} Paid in 5,00,000 and received 5,70,000? The 70,000 is chit gain income, booked with the payout; dividends are booked with each installment.</p>
    </section>`;
}

function insightsHtml(rows, sources, total, passive, months, today) {
    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    const top = sources[0];
    if (top && total) {
        const share = (top.amount / total) * 100;
        tip(share > 80 ? 'warn' : 'info', 'layers', `<b>${esc(top.account.name)}</b> brings ${percent(share, 0)} of your income${share > 80 ? '; a second source would make it sturdier.' : '.'}`);
    }
    if (total) tip(passive / total >= 0.2 ? 'good' : 'info', 'piggy', `Passive income is ${percent((passive / total) * 100, 0)} of the total (${moneyShort(passive / months)} a month).`);
    const monthTotals = Array.from({ length: 6 }, (_, i) => {
        const m = isoDate(new Date(today.getFullYear(), today.getMonth() - 6 + i, 1)).slice(0, 7);
        return rows.filter(r => r.date.startsWith(m)).reduce((s, r) => s + r.amount, 0);
    }).filter(v => v > 0);
    if (monthTotals.length >= 3) {
        const avg = monthTotals.reduce((s, v) => s + v, 0) / monthTotals.length;
        const spread = Math.sqrt(monthTotals.reduce((s, v) => s + (v - avg) ** 2, 0) / monthTotals.length) / avg;
        tip(spread < 0.15 ? 'good' : 'warn', 'trending', spread < 0.15 ? `Steady: income varied only ${percent(spread * 100, 0)} over the last ${monthTotals.length} months (avg ${moneyShort(avg)}).`
            : `Income swings ${percent(spread * 100, 0)} month to month; keep a bigger cash buffer.`);
    }
    return tips.length ? `<div class="insights">${tips.join('')}</div>` : emptyState('Add some income to see insights', 'bulb');
}

