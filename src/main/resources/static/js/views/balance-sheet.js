/**
 * Balance sheet: a compact two-column statement (Assets | Liabilities & Equity) on any date, the date with its month
 * arrows in the top middle, with four cards on top (assets and liabilities with their parts, net worth with how it is
 * funded, liquid money with what of it is free to invest). Groups holding a single account show as one row, the asset and
 * liability mix and the liquid money over the year fill the space under equity, and a slim right-hand pane holds suggestions,
 * the net-worth trend, health ratios, dues profile and the biggest movers.
 *
 * Receivables and Payables open into the people behind them: who owes you (and whom you owe) how much, the change since
 * the comparison date, what is overdue and since when, and under each person the items (money lent, paid for them,
 * borrowed, bills to pay), each opening in Expenses. Entries not made for a person (an expense paid later, a transfer)
 * are matched oldest first with the payments; what is still open shows under the shop named on it, or in a group
 * "Not linked to a person". Anything left over (paid ahead) is a line of its own, so the parts add up to the account.
 */
import { api } from '../core/api.js';
import { showPageRoute, routeHash, fromAddress } from '../core/route.js';
import { loadAccounts } from '../core/store.js';
import { esc, printElement } from '../core/ui.js';
import { exportButton, bindExport } from '../core/export.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { lineChart, donutChart, legend } from '../core/charts.js';
import { money, moneyShort, percent, isoDate, date, shortDate } from '../core/format.js';

/** "Compare with" presets: the comparison date for a given as-of date. */
const COMPARE = {
    month: { label: 'Last month', date: asOf => isoDate(new Date(asOf.getFullYear(), asOf.getMonth(), 0)) },
    quarter: { label: '3 months', date: asOf => isoDate(new Date(asOf.getFullYear(), asOf.getMonth() - 2, 0)) },
    year: { label: 'Year start', date: asOf => isoDate(new Date(asOf.getFullYear() - 1, 11, 31)) },
    custom: { label: 'Custom', date: () => view.compareTo },
};

const view = { asOf: isoDate(), compare: 'month', compareTo: '', showPrevious: false, collapsed: new Set(),
    // receivable / payable accounts whose people are shown (folded by default), people whose items are open, accounts showing every person
    peopleOpen: new Set(), openPeople: new Set(), allPeople: new Set() };
/** The people behind each receivable / payable account of the balance sheet shown, by account id. */
let PEOPLE = new Map();
/** People listed before "Show all". */
const PEOPLE_SHOWN = 6;
const CARD_EMI = 'Credit Card EMI';
const emiShown = new Set();

export async function render(container, _params, isCurrent) {
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    if (fromAddress(_params)) {   // #/balance-sheet?asOf=2026-09-30&compare=year (&to=… for a date of your own)
        const q = _params.query;
        view.asOf = isDate(q.get('asOf')) ? q.get('asOf') : isoDate();
        view.compare = q.get('compare') in COMPARE ? q.get('compare') : 'month';
        if (isDate(q.get('to'))) view.compareTo = q.get('to');
        view.showPrevious = q.get('previous') === '1';
    }
    const asOfDate = new Date(view.asOf + 'T00:00:00');
    view.compareTo = COMPARE[view.compare].date(asOfDate) || view.compareTo;
    const [bs, accounts] = await Promise.all([
        api.get('/reports/balance-sheet', { asOf: view.asOf, compareTo: view.compareTo }),
        loadAccounts(),
    ]);
    if (!isCurrent()) return;
    view.compareTo = bs.compareDate;
    PEOPLE = new Map((bs.counterparties || []).map(c => [c.accountId, c]));
    // Payables holding card EMIs opens on them the first time: they are the bulk of it, and worth seeing as what they are
    PEOPLE.forEach(c => {
        const emi = c.parties.find(p => p.party === CARD_EMI && owing(p));
        if (!emi) return;
        if (!emiShown.has(c.accountId)) { emiShown.add(c.accountId); view.peopleOpen.add(c.accountId); view.openPeople.add(`${c.accountId}|${CARD_EMI}`); }
    });
    const query = { asOf: view.asOf === isoDate() ? null : view.asOf, compare: view.compare === 'month' ? null : view.compare, to: view.compare === 'custom' ? view.compareTo : null, previous: view.showPrevious };
    showPageRoute('balance-sheet', routeHash('balance-sheet', query), Object.values(query).join('|'), { routed: fromAddress(_params) });
    const reload = () => render(container, [], isCurrent);

    const assets = Number(bs.assets.total);
    const liabilities = Number(bs.liabilities.total);

    container.innerHTML = `
    <div class="page balance-page">
        <div class="page-toolbar glass bs-toolbar">
            <div class="bs-tb-side">
                <h2 class="page-title">${icon('scale')} Balance sheet</h2>
                ${bs.balanced ? `<span class="badge good">${icon('check-circle')}Balanced</span>`
                              : `<span class="badge critical">${icon('alert')}Out of balance</span>`}
            </div>
            <div class="bs-when" title="The date of the balance sheet">
                <button type="button" class="btn sm icon" data-asof-step="-1" title="End of the month before">${icon('chevron-left')}</button>
                <input type="date" id="asof" value="${bs.asOf}" max="${isoDate()}" aria-label="As of">
                <button type="button" class="btn sm icon" data-asof-step="1" ${bs.asOf >= isoDate() ? 'disabled' : ''} title="End of the next month">${icon('chevron-right')}</button>
            </div>
            <div class="bs-tb-side end">
                <div class="seg-chips sm" id="bs-compare" title="Compare with">${Object.entries(COMPARE).map(([k, c]) =>
                    `<button class="seg-chip ${view.compare === k ? 'active' : ''}" data-compare="${k}" ${k === view.compare ? `title="Compared with ${date(bs.compareDate)}"` : ''}>${c.label}</button>`).join('')}</div>
                ${view.compare === 'custom' ? `<input type="date" id="compare" value="${bs.compareDate}" max="${bs.asOf}">` : `<span class="small muted nowrap">${date(bs.compareDate)}</span>`}
                <label class="switch small" title="Show the comparison date's figures as a column"><input type="checkbox" id="bs-prev" ${view.showPrevious ? 'checked' : ''}><span></span>Previous</label>
                ${exportButton({ label: '' })}
                <button class="btn sm" id="print" title="Print">${icon('printer')}</button>
            </div>
        </div>

        <section class="panel bs-main">
            <div class="bs-header">
                ${headCard('Assets', 'asset', assets, Number(bs.assets.previous), bs.assetMix, assets, false)}
                ${headCard('Liabilities', 'liability', liabilities, Number(bs.liabilities.previous), [
                    { label: 'Short-term', value: bs.shortTermLiabilities }, { label: 'Loans', value: bs.longTermLiabilities }], liabilities, true,
                    `${percent(bs.debtToAssetRatio, 0)} of assets`)}
                <div class="bh-card net">
                    <div class="bh-top"><span class="bh-label">${icon('scale')}Net worth</span>
                        ${changeText(Number(bs.netWorth), Number(bs.previousNetWorth), false, bs.netWorthChangePercent)}</div>
                    <b class="bh-value">${money(bs.netWorth)}</b>
                    <div class="ef-bar" title="How your assets are funded"><span class="ef-debt" style="width:${(liabilities / (assets || 1)) * 100}%"></span><span class="ef-own" style="width:${Math.max(0, 100 - (liabilities / (assets || 1)) * 100)}%"></span></div>
                    <div class="bh-chips"><span><i class="ef-own"></i>own ${percent((Number(bs.netWorth) / (assets || 1)) * 100, 0)}</span><span><i class="ef-debt"></i>debt ${percent((liabilities / (assets || 1)) * 100, 0)}</span>
                        ${bs.emergencyFundMonths !== null ? `<span>${Number(bs.emergencyFundMonths).toFixed(1)} mo safety net</span>` : ''}</div>
                </div>
                ${liquidCard(bs)}
            </div>
            <div class="bs-body scroll">
            <div class="bs-columns">
                <div class="bs-col">
                    ${sectionHtml(bs.assets, assets, false, 'asset')}
                </div>
                <div class="bs-col">
                    ${sectionHtml(bs.liabilities, liabilities, true, 'liability')}
                    ${sectionHtml(bs.equity, Number(bs.equity.total), false, 'equity')}
                    <div class="bs-graphs">
                        ${mixCard('Asset mix', bs.assetMix, assets, 'asset')}
                        ${mixCard('Liability mix', bs.liabilityMix, liabilities, 'liability')}
                        ${liquidTrendCard(bs)}
                    </div>
                </div>
            </div>
            </div>
            <div class="bs-totals">
                <div><span>Total assets</span><b>${money(assets)}</b></div>
                <div><span>Total liabilities + equity</span><b>${money(bs.liabilitiesAndEquity)}</b>
                    ${bs.balanced ? `<span class="badge good">${icon('check')}matches</span>` : ''}</div>
            </div>
        </section>

        <aside class="bs-side scroll">
            ${suggestionsCard(bs, accounts)}
            ${trendCard(bs)}
            ${healthCard(bs)}
            ${moversCard(bs)}
        </aside>
    </div>`;

    // skip the empty months before the books start
    const firstUsed = Math.max(0, bs.netWorthTrend.findIndex(p => Number(p.value) !== 0));
    const trend = bs.netWorthTrend.slice(Math.min(firstUsed, bs.netWorthTrend.length - 2));
    lineChart(container.querySelector('#bs-trend'), {
        labels: trend.map(p => p.label), labelFormat: l => shortDate(l).split(' ')[1] || shortDate(l),
        format: moneyShort, area: true,
        series: [{ name: 'Net worth', values: trend.map(p => Number(p.value)), color: 'var(--series-1)' }],
    });

    drawGraphs(container, bs);

    // ---- events
    container.querySelector('#asof').addEventListener('change', e => { view.asOf = e.target.value; reload(); });
    container.querySelector('.bs-when').addEventListener('click', e => {
        const b = e.target.closest('[data-asof-step]');
        if (b) { view.asOf = stepMonthEnd(view.asOf, Number(b.dataset.asofStep)); reload(); }
    });
    container.querySelector('#compare')?.addEventListener('change', e => { view.compareTo = e.target.value; reload(); });
    container.querySelector('#bs-compare').addEventListener('click', e => {
        const b = e.target.closest('[data-compare]');
        if (b) { view.compare = b.dataset.compare; reload(); }
    });
    container.querySelector('#bs-prev').addEventListener('change', e => { view.showPrevious = e.target.checked; reload(); });
    container.querySelector('.bs-columns').addEventListener('click', e => {
        // the people of an account, a person's items, every person: redrawn in place
        const redraw = id => {
            const block = container.querySelector(`.bs-people[data-people="${id}"]`);
            if (block) block.outerHTML = peopleHtml(PEOPLE.get(Number(id)));
        };
        const toggle = (set, key) => (set.has(key) ? set.delete(key) : set.add(key));
        const accountToggle = e.target.closest('[data-people-toggle]');
        if (accountToggle) {
            const id = Number(accountToggle.dataset.peopleToggle);
            toggle(view.peopleOpen, id);
            accountToggle.classList.toggle('open', view.peopleOpen.has(id));
            redraw(id);
            return;
        }
        const person = e.target.closest('[data-person]');
        if (person) { toggle(view.openPeople, person.dataset.person); redraw(person.dataset.person.split('|')[0]); return; }
        const more = e.target.closest('[data-people-all]');
        if (more) { toggle(view.allPeople, Number(more.dataset.peopleAll)); redraw(more.dataset.peopleAll); return; }
        const head = e.target.closest('[data-group]');
        if (!head) return;
        const key = head.dataset.group;
        view.collapsed.has(key) ? view.collapsed.delete(key) : view.collapsed.add(key);
        head.closest('.bs-group').classList.toggle('collapsed');
    });
    container.querySelector('#print').addEventListener('click', () =>
        printElement(container.querySelector('.bs-main'), `Balance sheet as of ${date(bs.asOf)}`));
    bindExport(container, () => {
        const rows = [];
        [bs.assets, bs.liabilities, bs.equity].forEach(s => s.groups.forEach(g => g.accounts.forEach(a =>
            rows.push([s.label, g.label, a.name, a.previous ?? '', Number(a.amount), Number(a.amount) - Number(a.previous || 0)]))));
        const people = [];
        PEOPLE.forEach(c => {
            c.parties.forEach(pt => pt.items.forEach(i => people.push([c.accountName, pt.party, i.kindLabel, i.narration || '', i.startDate, i.dueDate || '',
                Number(i.previous), Number(i.amount), i.overdue ? 'Overdue' : ''])));
            if (Number(c.unlinked) || Number(c.unlinkedPrevious)) people.push([c.accountName, 'Not linked to a person', '', '', '', '', Number(c.unlinkedPrevious), Number(c.unlinked), '']);
        });
        return {
            title: `Balance sheet as of ${date(bs.asOf)}`, subtitle: `Compared with ${date(bs.compareDate)}`, filename: `balance-sheet-${bs.asOf}`,
            summary: [['Net worth', Number(bs.netWorth)], ['Change', Number(bs.netWorthChange)], ['Liquid money', Number(bs.liquidAssets)], ['Investable surplus', investableOf(bs).free]],
            sheets: [{ name: 'Balance sheet', columns: [{ label: 'Section' }, { label: 'Group' }, { label: 'Account' },
                { label: date(bs.compareDate), type: 'money' }, { label: date(bs.asOf), type: 'money' }, { label: 'Change', type: 'money' }],
                rows: rows.map(r => [r[0], r[1], r[2], r[3] === '' ? '' : Number(r[3]), r[4], r[5]]),
                totals: ['Net worth', '', '', Number(bs.previousNetWorth), Number(bs.netWorth), Number(bs.netWorthChange)] },
                ...(people.length ? [{ name: 'Receivables & payables', columns: [{ label: 'Account' }, { label: 'Person' }, { label: 'Kind' }, { label: 'What' },
                    { label: 'Since', type: 'date' }, { label: 'Due', type: 'date' }, { label: date(bs.compareDate), type: 'money' }, { label: date(bs.asOf), type: 'money' }, { label: 'Status' }],
                    rows: people }] : [])],
        };
    });
}

// ===================================================================== header

/** The month end before `iso`, or after it (never past today). */
function stepMonthEnd(iso, step) {
    const d = new Date(`${iso}T00:00:00`);
    const end = isoDate(new Date(d.getFullYear(), d.getMonth() + (step > 0 ? (isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) === iso ? 2 : 1) : 0), 0));
    return end > isoDate() ? isoDate() : end;
}

/** Liquid money split into what is spoken for (short-term dues, six months of spending) and what is free to invest. */
function investableOf(bs) {
    const liquid = Number(bs.liquidAssets);
    const dues = Math.min(Math.max(0, liquid), Number(bs.shortTermLiabilities));
    const buffer = Math.min(Math.max(0, liquid - dues), Number(bs.averageMonthlyExpense || 0) * 6);
    return { liquid, dues, buffer, free: Math.max(0, liquid - dues - buffer) };
}

/** Liquid money: how much, and how much of it could be invested without touching dues or the safety net. */
function liquidCard(bs) {
    const { liquid, dues, buffer, free } = investableOf(bs);
    const part = v => (liquid > 0 ? (v / liquid) * 100 : 0);
    return `
    <div class="bh-card liquid">
        <div class="bh-top"><span class="bh-label" title="Cash, bank and wallet money you can use at once">${icon('droplet')}Liquid money</span>${changeText(liquid, Number(bs.previousLiquidAssets), false)}</div>
        <b class="bh-value">${money(liquid)}</b>
        <div class="bh-mix" title="What the money is spoken for">
            <span style="width:${part(dues)}%;background:#f3a07f" title="Short-term dues ${money(dues)}"></span>
            <span style="width:${part(buffer)}%;background:#7dd0f5" title="Six months of spending ${money(buffer)}"></span>
            <span style="width:${part(free)}%;background:#7de3b0" title="Investable surplus ${money(free)}"></span></div>
        <div class="bh-chips">
            <span class="bh-free" title="Liquid money left after short-term dues (${money(dues)}) and a safety net of six months of spending (${money(buffer)})"><i style="background:#7de3b0"></i>Investable surplus <b>${moneyShort(free)}</b></span>
            <span><i style="background:#f3a07f"></i>dues ${moneyShort(dues)}</span><span><i style="background:#7dd0f5"></i>safety net ${moneyShort(buffer)}</span></div>
    </div>`;
}

function changeText(value, previous, lowerIsBetter, pct = null) {
    const change = value - previous;
    if (Math.abs(change) < 0.5) return '<span class="bh-change muted">no change</span>';
    const good = lowerIsBetter ? change < 0 : change > 0;
    return `<span class="bh-change ${good ? 'up' : 'down'}" title="Since ${date(view.compareTo)}">${change > 0 ? '▲' : '▼'} ${moneyShort(Math.abs(change))}${pct !== null ? ` · ${percent(Math.abs(Number(pct)), 1)}` : ''}</span>`;
}

/** Assets / liabilities card: total, change and the split into its main parts. */
function headCard(title, tone, value, previous, parts, total, liability, note = '') {
    const colors = liability ? ['#f3a07f', '#c2532c', '#e87ba4'] : ['#7dd0f5', '#2fd0bf', '#a99cf5', '#f0d49a', '#e87ba4', '#9fc3df'];
    const list = parts.filter(p => Number(p.value) > 0);
    return `
    <div class="bh-card ${tone}">
        <div class="bh-top"><span class="bh-label">${icon(liability ? 'card' : 'layers')}${title}</span>${changeText(value, previous, liability)}</div>
        <b class="bh-value">${money(value)}</b>
        <div class="bh-mix">${list.map((p, i) => `<span style="width:${(Number(p.value) / (total || 1)) * 100}%;background:${colors[i % colors.length]}" title="${esc(p.label)} ${money(p.value)}"></span>`).join('')}</div>
        <div class="bh-chips">${list.slice(0, 4).map((p, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${esc(p.label)} ${percent((Number(p.value) / (total || 1)) * 100, 0)}</span>`).join('')}${note ? `<span>${note}</span>` : ''}</div>
    </div>`;
}

/** Practical next steps from the balance sheet and the account details (rates, overdrafts, idle cash). */
function suggestionsCard(bs, accounts) {
    const items = [];
    const add = (rank, tone, iconName, html, href) => items.push({ rank, html: `<a class="insight ${tone} clickable" href="${href}">${icon(iconName)}<div>${html}</div></a>` });
    const spend = Number(bs.averageMonthlyExpense || 0);
    const months = bs.emergencyFundMonths === null ? null : Number(bs.emergencyFundMonths);
    const liquid = accounts.filter(a => ['CASH', 'BANK', 'WALLET', 'MEAL_CARD'].includes(a.accountType)).reduce((s, a) => s + Number(a.balance), 0);
    accounts.filter(a => ['BANK', 'WALLET', 'CASH'].includes(a.accountType) && Number(a.balance) < 0).forEach(a =>
        add(0, 'bad', 'alert-circle', `<b>${esc(a.name)}</b> is overdrawn by ${money(-Number(a.balance))}. Move money in or check for a missing entry.`, '#/accounts'));
    if (months !== null && months < 6 && spend) add(1, months < 3 ? 'bad' : 'warn', 'droplet',
        `Safety net covers ${months.toFixed(1)} months. Add <b>${moneyShort(spend * 6 - liquid)}</b> to reach 6 months of spending.`, '#/accounts');
    if (months !== null && months > 9 && spend) {
        const spare = liquid - spend * 6;
        add(4, 'info', 'trending', `About <b>${moneyShort(spare)}</b> sits in cash beyond a 6-month buffer. At 7% it could earn ${moneyShort(spare * 0.07)} a year.`, '#/forecast/interest');
    }
    const costly = accounts.filter(a => a.accountClass === 'LIABILITY' && Number(a.balance) > 0 && (Number(a.interestRate) >= 10 || a.accountType === 'CREDIT_CARD'))
        .sort((x, y) => (Number(y.interestRate) || 36) - (Number(x.interestRate) || 36));
    costly.slice(0, 2).forEach(a => {
        const rate = Number(a.interestRate) || 36;
        add(2, 'warn', 'percent', `<b>${esc(a.name)}</b> costs ${percent(rate, 0)} a year${a.accountType === 'CREDIT_CARD' && !a.interestRate ? ' if not paid in full' : ''}: about ${moneyShort(Number(a.balance) * rate / 1200)} a month. Pay it down first.`, '#/accounts');
    });
    if (Number(bs.liquidityRatio) < 1 && bs.liquidityRatio !== null) add(1, 'bad', 'alert', `Short-term dues (${moneyShort(bs.shortTermLiabilities)}) are more than your cash. Plan the next payments.`, '#/planning');
    if (Number(bs.debtToAssetRatio) > 40) add(3, 'warn', 'scale', `Debt is ${percent(bs.debtToAssetRatio, 0)} of assets; under 40% leaves room for emergencies.`, '#/accounts');
    const top = [...bs.assetMix].sort((x, y) => Number(y.value) - Number(x.value))[0];
    const assets = Number(bs.assets.total) || 1;
    if (top && Number(top.value) / assets > 0.6) add(5, 'info', 'layers', `${percent((Number(top.value) / assets) * 100, 0)} of your wealth is in <b>${esc(top.label.toLowerCase())}</b>. Spreading new savings elsewhere lowers the risk.`, '#/accounts');
    if (Number(bs.investmentShare) < 15) add(5, 'info', 'trending', `Only ${percent(bs.investmentShare, 0)} of assets is invested. 15% or more grows wealth faster than inflation.`, '#/forecast/interest');
    const owed = accounts.filter(a => ['RECEIVABLE', 'LOAN_GIVEN'].includes(a.accountType)).reduce((s, a) => s + Number(a.balance), 0);
    if (owed > assets * 0.03) add(4, 'info', 'hand', `${moneyShort(owed)} is owed to you. Collecting it would add ${percent((owed / Math.max(1, liquid)) * 100, 0)} to your cash.`, '#/expenses/collect');
    if (Number(bs.netWorth) < Number(bs.previousNetWorth)) add(3, 'warn', 'trending-down', `Net worth fell ${moneyShort(Number(bs.previousNetWorth) - Number(bs.netWorth))} since ${date(view.compareTo)}. See the biggest moves below.`, '#/balance-sheet');
    if (!items.length) add(9, 'good', 'check-circle', 'Your balance sheet looks healthy. Keep the safety net topped up and invest what is left.', '#/forecast');
    return `
    <div class="side-card suggest-card">
        <div class="side-head">${icon('bulb')}<b>Suggestions</b><span class="spacer"></span><span class="small muted">${items.length}</span></div>
        <div class="insights">${items.sort((a, b) => a.rank - b.rank).slice(0, 6).map(i => i.html).join('')}</div>
    </div>`;
}

// ===================================================================== statement

/** One side of the statement: groups (collapsible) with their accounts. */
function sectionHtml(section, total, isLiability, tone) {
    const groups = section.groups.map(g => {
        const key = `${section.label}:${g.label}`;
        const share = (Number(g.total) / (total || 1)) * 100;
        if (g.accounts.length === 1) return singleRow(g, g.accounts[0], share, isLiability);
        return `
        <div class="bs-group ${view.collapsed.has(key) ? 'collapsed' : ''}">
            <button class="bs-group-head" data-group="${esc(key)}">
                <span class="caret">${icon('chevron-down')}</span>
                <span class="g-label">${esc(g.label)}</span>
                <span class="g-count">${g.accounts.length}</span>
                <span class="g-share" title="${percent(share, 1)} of ${esc(section.label.toLowerCase())}"><i style="width:${Math.min(100, Math.abs(share))}%"></i></span>
                <span class="g-pct">${percent(share, 0)}</span>
                ${view.showPrevious ? `<span class="g-prev">${moneyShort(g.previous)}</span>` : ''}
                <b class="g-total">${money(g.total)}</b>
            </button>
            <div class="bs-accounts">${g.accounts.map(a => accountRow(a, isLiability)).join('')}</div>
        </div>`;
    }).join('');
    return `
    <div class="bs-section ${tone}">
        <div class="bs-section-head">
            <span class="chip-icon sm ${tone === 'asset' ? '' : tone === 'liability' ? 'coral' : 'violet'}">${icon(tone === 'asset' ? 'layers' : tone === 'liability' ? 'card' : 'scale')}</span>
            <b>${esc(section.label)}</b>
            ${view.showPrevious ? `<span class="spacer"></span><span class="col-h">${date(view.compareTo)}</span><span class="col-h now">${date(view.asOf)}</span>` : `<span class="spacer"></span><b class="mono">${money(section.total)}</b>`}
        </div>
        ${groups || '<div class="muted small bs-empty">Nothing here</div>'}
        ${view.showPrevious ? `<div class="bs-section-total"><span>Total ${esc(section.label.toLowerCase())}</span>
            <span class="g-prev">${money(section.previous)}</span><b>${money(section.total)}</b></div>` : ''}
    </div>`;
}

/** A group with one account: one row with the account name, its group as a tag, share and amount. */
function singleRow(g, a, share, isLiability) {
    const t = accountTypeIcon(a.accountType);
    const change = Number(a.amount) - Number(a.previous || 0);
    const good = isLiability ? change < 0 : change > 0;
    return `
    <div class="bs-group single">
        <div class="bs-single">
            <span class="chip-icon xs ${t.tone}">${icon(t.name)}</span>
            <span class="a-name ellipsis" title="${esc(a.code || '')} ${esc(a.name)}"><b>${esc(a.name)}</b> <span class="g-tag">${esc(g.label)}</span></span>
            ${peopleChip(a)}
            ${Math.abs(change) < 0.5 ? '' : `<span class="a-delta ${good ? 'pos' : 'neg'}" title="Change since the comparison date">${change > 0 ? '+' : '−'}${moneyShort(Math.abs(change))}</span>`}
            <span class="g-share" title="${percent(share, 1)}"><i style="width:${Math.min(100, Math.abs(share))}%"></i></span>
            <span class="g-pct">${percent(share, 0)}</span>
            ${view.showPrevious ? `<span class="g-prev">${moneyShort(a.previous ?? 0)}</span>` : ''}
            <b class="g-total ${Number(a.amount) < 0 ? 'neg' : ''}">${money(a.amount)}</b>
        </div>
        ${PEOPLE.has(a.accountId) ? peopleHtml(PEOPLE.get(a.accountId)) : ''}
    </div>`;
}

function accountRow(a, isLiability) {
    const t = accountTypeIcon(a.accountType);
    const change = Number(a.amount) - Number(a.previous || 0);
    const good = isLiability ? change < 0 : change > 0;
    const delta = Math.abs(change) < 0.5 ? '' :
        `<span class="a-delta ${good ? 'pos' : 'neg'}" title="Change since the comparison date">${change > 0 ? '+' : '−'}${moneyShort(Math.abs(change))}</span>`;
    return `<div class="bs-acct">
        <span class="chip-icon xs ${t.tone}">${icon(t.name)}</span>
        <span class="a-name ellipsis" title="${esc(a.code || '')} ${esc(a.name)}">${esc(a.name)}</span>
        ${peopleChip(a)}
        ${delta}
        ${view.showPrevious ? `<span class="a-prev">${money(a.previous ?? 0)}</span>` : ''}
        <span class="a-amt ${Number(a.amount) < 0 ? 'neg' : ''}">${money(a.amount)}</span>
    </div>${PEOPLE.has(a.accountId) && a.accountType !== 'CHIT_FUND' ? peopleHtml(PEOPLE.get(a.accountId)) : ''}`;
}

// ===================================================================== who owes you, whom you owe

const KIND = { EMI: ['coral', 'card', 'Credit card EMI'], LENT: ['violet', 'hand', 'Lent'], PAID_FOR: ['aqua', 'users', 'Paid for'], BORROWED: ['coral', 'arrow-in', 'Borrowed'],
    BILL_DUE: ['gold', 'receipt', 'Bill'], ENTRY: ['gray', 'journal', null] };
const owing = p => Number(p.amount) !== 0;

/** On a receivable / payable account row: how many people make it up, which folds them away or shows them. */
function peopleChip(a) {
    const c = a.accountType === 'CHIT_FUND' ? null : PEOPLE.get(a.accountId);
    if (!c) return '';
    const n = c.parties.filter(p => owing(p) && p.named).length;
    const entries = c.parties.find(p => !p.named && owing(p))?.openItems || 0;
    const overdue = c.parties.filter(p => p.overdue).length;
    // people when there are any, else the open entries without a name
    const what = n ? `${n} ${n === 1 ? 'person' : 'people'}${entries ? ` and ${entries} open entr${entries === 1 ? 'y' : 'ies'}` : ''}` : `${entries} open entr${entries === 1 ? 'y' : 'ies'}`;
    return `<button type="button" class="bp-toggle ${view.peopleOpen.has(c.accountId) ? 'open' : ''} ${overdue ? 'warn' : ''}" data-people-toggle="${c.accountId}"
        title="${what}${overdue ? `, ${overdue} overdue` : ''} · click to ${view.peopleOpen.has(c.accountId) ? 'fold' : 'show'} them">
        ${icon(n ? 'users' : 'list')}<b>${n || entries}</b>${overdue ? `<i>${icon('alert')}${overdue}</i>` : ''}${icon('chevron-down')}</button>`;
}

/**
 * The people of an account: a summary line (how many, overdue, the oldest), then each person (largest first) with the
 * kinds of items, how long it is open, the change since the comparison date, their share of the account and the
 * amount; their items under them on a click. Then what is not linked to a person, and who settled since.
 */
function peopleHtml(c) {
    if (!view.peopleOpen.has(c.accountId)) return `<div class="bs-people closed" data-people="${c.accountId}"></div>`;
    const shown = c.parties.filter(p => owing(p) || view.showPrevious);
    const settled = c.parties.filter(p => !owing(p)).length;
    const list = view.allPeople.has(c.accountId) ? shown : shown.slice(0, PEOPLE_SHOWN);
    const total = Math.abs(c.parties.reduce((s, p) => s + Number(p.amount), 0) + Number(c.unlinked)) || 1;
    const overdue = c.parties.filter(p => p.overdue);
    const oldest = c.parties.filter(owing).map(p => p.oldest).filter(Boolean).sort()[0];
    const unlinked = Number(c.unlinked), unlinkedBefore = Number(c.unlinkedPrevious);
    const n = c.parties.filter(p => owing(p) && p.named).length;
    const loose = c.parties.find(p => !p.named && owing(p));
    return `
    <div class="bs-people ${c.payable ? 'payable' : 'receivable'}" data-people="${c.accountId}">
        <div class="bp-sum">
            <span>${icon(c.payable ? 'arrow-in' : 'hand')}${n ? `<b>${n}</b> ${n === 1 ? 'person' : 'people'} ${c.payable ? 'you owe' : 'owe you'}` : ''}${loose
                ? `${n ? ' <span class="muted">+</span> ' : ''}<b>${loose.openItems}</b> open entr${loose.openItems === 1 ? 'y' : 'ies'}${n ? ' without a name' : ` ${c.payable ? 'to pay' : 'to receive'}, not linked to a person`}` : ''}</span>
            ${overdue.length ? `<span class="bp-flag" title="${esc(overdue.map(p => p.party).join(', '))}">${icon('alert')}${overdue.length} overdue · ${moneyShort(overdue.reduce((s, p) => s + Number(p.amount), 0))}</span>` : ''}
            ${oldest ? `<span class="muted" title="The oldest item still open, since ${date(oldest)}">oldest ${ageOf(oldest)}</span>` : ''}
            <span class="spacer"></span>
            <a class="link-btn" href="#/expenses/${c.payable ? 'owe' : 'collect'}" title="Record a payment, send a reminder, see the history">${c.payable ? 'Pay in Expenses' : 'Collect in Expenses'}${icon('chevron-right')}</a>
        </div>
        ${list.map(p => personHtml(c, p, total)).join('')}
        ${shown.length > list.length || view.allPeople.has(c.accountId) && shown.length > PEOPLE_SHOWN
            ? `<button type="button" class="link-btn bp-more" data-people-all="${c.accountId}">${view.allPeople.has(c.accountId) ? 'Show fewer' : `Show all ${shown.length}`}</button>` : ''}
        ${unlinked || unlinkedBefore ? `
        <a class="bp-person bp-unlinked" href="#/accounts/${c.accountId}" title="What the open items and entries do not account for on ${esc(c.accountName)}: payments made ahead, adjustments. Open the account's statement">
            <span class="bp-avatar muted">${icon('layers')}</span>
            <span class="bp-name"><b>${unlinked < 0 ? 'Paid ahead' : 'Other'}</b><small>not matched to an item · open the statement</small></span>
            ${delta(unlinked - unlinkedBefore, c.payable)}
            ${view.showPrevious ? `<span class="a-prev">${money(unlinkedBefore)}</span>` : ''}
            <b class="bp-amt ${unlinked < 0 ? 'neg' : ''}">${money(unlinked)}</b><span class="bp-caret"></span></a>` : ''}
        ${settled && !view.showPrevious ? `<div class="bp-note">${icon('check')}${settled} settled since ${date(view.compareTo)} · turn on the previous column to see them</div>` : ''}
    </div>`;
}

function personHtml(c, p, total) {
    const key = `${c.accountId}|${p.party}`;
    const open = view.openPeople.has(key);
    const kinds = [...new Set(p.items.filter(i => Number(i.amount) !== 0).map(i => (KIND[i.kind] || [])[2] || i.kindLabel))];
    const what = p.party === CARD_EMI ? 'still to repay · comes off as each EMI is paid' : p.named ? kinds.join(' · ') : (c.payable ? 'expenses paid later, transfers' : 'entries') + ' · payments settle the oldest first';
    const share = (Math.abs(Number(p.amount)) / total) * 100;
    const settledNow = !owing(p);
    return `
    <div class="bp-person-wrap ${open ? 'open' : ''}">
        <button type="button" class="bp-person ${p.overdue ? 'overdue' : ''} ${settledNow ? 'settled' : ''}" data-person="${esc(key)}" title="${open ? 'Fold' : 'Show'} the items">
            <span class="bp-avatar ${p.named ? '' : 'muted'}">${p.party === CARD_EMI ? icon('card') : p.named ? esc(initials(p.party)) : icon('layers')}</span>
            <span class="bp-name"><b class="ellipsis">${esc(p.party)}</b>
                <small class="ellipsis" title="${esc(what)}">${settledNow ? `settled · was ${money(p.previous)}` : `${esc(what)} · ${p.openItems} item${p.openItems === 1 ? '' : 's'}${p.oldest ? ` · ${ageOf(p.oldest)}` : ''}`}</small></span>
            ${p.overdue ? `<span class="bp-flag">${icon('alert')}overdue</span>` : ''}
            ${delta(Number(p.amount) - Number(p.previous), c.payable)}
            <span class="g-share" title="${percent(share, 1)} of ${esc(c.accountName)}"><i style="width:${Math.min(100, share)}%"></i></span>
            ${view.showPrevious ? `<span class="a-prev">${money(p.previous)}</span>` : ''}
            <b class="bp-amt">${money(p.amount)}</b>
            <span class="bp-caret">${icon('chevron-down')}</span>
        </button>
        ${open ? `<div class="bp-items">${p.items.map(i => itemHtml(i, c.payable)).join('')}</div>` : ''}
    </div>`;
}

function itemHtml(i, payable) {
    const k = KIND[i.kind] || ['gray', 'tag', i.kindLabel];
    const href = i.claimId ? `#/expenses/claim/${i.claimId}` : `#/entry/${i.entryId}`;
    // a card EMI: what is still owed on the plan, and when the next EMI falls
    if (i.kind === 'EMI') i = { ...i, kindLabel: 'Bought on EMI' };
    return `<a class="bp-item ${i.overdue ? 'overdue' : ''} ${Number(i.amount) === 0 ? 'settled' : ''}" href="${href}"
        title="${i.claimId ? 'Open it in Expenses: payments, interest, history' : 'Open the entry (what is still open of it, after the payments made oldest first)'}">
        <span class="chip-icon xs ${k[0]}">${icon(k[1])}</span>
        <span class="bp-name"><b class="ellipsis">${esc(i.narration || i.kindLabel)}</b>
            <small class="ellipsis">${esc(i.kindLabel)} · ${date(i.startDate)}${i.dueDate ? ` · <span class="${i.overdue ? 'neg' : ''}">${i.overdue ? 'was due' : 'due'} ${date(i.dueDate)}</span>` : ''}${Number(i.amount) === 0 ? ' · settled' : ''}</small></span>
        ${delta(Number(i.amount) - Number(i.previous), payable)}
        ${view.showPrevious ? `<span class="a-prev">${money(i.previous)}</span>` : ''}
        <b class="bp-amt">${money(i.amount)}</b><span class="bp-caret">${icon('chevron-right')}</span></a>`;
}

/** Change since the comparison date: owed to you going up is good, what you owe going down is. */
function delta(change, payable) {
    if (Math.abs(change) < 0.5) return '';
    const good = payable ? change < 0 : change > 0;
    return `<span class="a-delta ${good ? 'pos' : 'neg'}" title="Change since ${date(view.compareTo)}">${change > 0 ? '+' : '−'}${moneyShort(Math.abs(change))}</span>`;
}

const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** How long ago, short: "12 days", "3 months", "1.5 years" (to the balance sheet date). */
function ageOf(iso) {
    const days = Math.round((new Date(view.asOf + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    if (days < 1) return 'today';
    if (days < 45) return `${days} day${days === 1 ? '' : 's'}`;
    if (days < 545) return `${Math.round(days / 30.4)} months`;
    return `${(days / 365).toFixed(1)} years`;
}

// ===================================================================== right pane

function trendCard(bs) {
    const points = bs.netWorthTrend.map(p => Number(p.value)).filter(v => v !== 0);
    const yearChange = points.length ? points[points.length - 1] - points[0] : 0;
    return `
    <div class="side-card">
        <div class="side-head">${icon('trending')}<b>Net worth</b><span class="spacer"></span>
            <span class="small ${yearChange >= 0 ? 'pos' : 'neg'}">${yearChange >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(yearChange))} over ${points.length} months</span></div>
        <div class="chart bs-trend" id="bs-trend"></div>
    </div>`;
}

const MIX_COLORS = { asset: ['--series-1', '--series-3', '--series-7', '--series-4', '--series-5', '--series-6'], liability: ['--series-2', '--series-8', '--series-5'] };

/** A mix as a donut (drawn by drawGraphs) beside its parts. */
function mixCard(title, mix, total, kind) {
    const colors = MIX_COLORS[kind];
    const shown = mix.filter(m => Number(m.value) > 0);
    if (!shown.length) return '';
    return `
    <div class="side-card bs-graph">
        <div class="side-head">${icon(kind === 'asset' ? 'layers' : 'card')}<b>${title}</b><span class="spacer"></span><b class="mono small">${moneyShort(total)}</b></div>
        <div class="bs-graph-body"><div class="chart bs-donut" id="bs-donut-${kind}"></div>
            <div class="mix-rows">${shown.map((m, i) => `<div class="mix-row" title="${esc(m.label)} ${money(m.value)} · ${percent((Number(m.value) / (total || 1)) * 100, 0)}"><i class="legend-swatch" style="background:var(${colors[i % colors.length]})"></i>
                <span class="ellipsis">${esc(m.label)}</span><span class="spacer"></span><b class="mono">${moneyShort(m.value)}</b></div>`).join('')}</div></div>
    </div>`;
}

function liquidTrendCard(bs) {
    return `
    <div class="side-card bs-graph wide">
        <div class="side-head">${icon('droplet')}<b>Liquid money</b><span class="spacer"></span>
            ${legend([{ label: 'Liquid money', color: 'var(--series-1)' }, { label: '6 months of spending', color: 'var(--series-4)' }], 'line')}</div>
        <div class="chart bs-liquid" id="bs-liquid"></div>
    </div>`;
}

function drawGraphs(container, bs) {
    const donut = (kind, mix) => {
        const el = container.querySelector(`#bs-donut-${kind}`);
        if (el) donutChart(el, { format: moneyShort, items: mix.filter(m => Number(m.value) > 0)
            .map((m, i) => ({ label: m.label, value: Number(m.value), color: `var(${MIX_COLORS[kind][i % MIX_COLORS[kind].length]})` })) });
    };
    donut('asset', bs.assetMix);
    donut('liability', bs.liabilityMix);
    const first = Math.max(0, bs.liquidTrend.findIndex(p => Number(p.value) !== 0));
    const trend = bs.liquidTrend.slice(Math.min(first, bs.liquidTrend.length - 2));
    lineChart(container.querySelector('#bs-liquid'), {
        labels: trend.map(p => p.label), labelFormat: l => shortDate(l).split(' ')[1] || shortDate(l), format: moneyShort, area: true, includeZero: true,
        series: [{ name: 'Liquid money', values: trend.map(p => Number(p.value)), color: 'var(--series-1)' },
            { name: '6 months of spending', values: trend.map(() => Number(bs.averageMonthlyExpense || 0) * 6), color: 'var(--series-4)' }],
    });
}

function healthCard(bs) {
    const months = bs.emergencyFundMonths === null ? null : Number(bs.emergencyFundMonths);
    const liquidity = bs.liquidityRatio === null ? null : Number(bs.liquidityRatio);
    const rows = [
        metric('Debt to assets', percent(bs.debtToAssetRatio, 0), Number(bs.debtToAssetRatio), 100, Number(bs.debtToAssetRatio) < 40, 'below 40%'),
        metric('Debt to net worth', percent(bs.debtToNetWorthRatio, 0), Number(bs.debtToNetWorthRatio), 200, Number(bs.debtToNetWorthRatio) < 100, 'below 100%'),
        metric('Liquidity', liquidity === null ? '—' : `${liquidity.toFixed(2)}×`, liquidity ?? 0, 3, liquidity === null || liquidity >= 1, 'cash ÷ short-term dues ≥ 1'),
        metric('Emergency fund', months === null ? '—' : `${months.toFixed(1)} mo`, months ?? 0, 12, months !== null && months >= 6, `6+ months of ${moneyShort(bs.averageMonthlyExpense)} spend`),
        metric('Investments', percent(bs.investmentShare, 0), Number(bs.investmentShare), 100, Number(bs.investmentShare) >= 15, '15%+ of assets'),
    ];
    const short = Number(bs.shortTermLiabilities), long = Number(bs.longTermLiabilities);
    return `
    <div class="side-card">
        <div class="side-head">${icon('shield')}<b>Financial health</b><span class="spacer"></span>
            <span class="small muted">${rows.filter(r => r.ok).length}/${rows.length} healthy</span></div>
        <div class="health-rows">${rows.map(r => r.html).join('')}</div>
        <div class="dues-split">
            <div class="row small"><span>Short-term dues</span><span class="spacer"></span><b>${moneyShort(short)}</b></div>
            <div class="split-bar"><span class="seg short" style="width:${(short / ((short + long) || 1)) * 100}%"></span><span class="seg long" style="width:${(long / ((short + long) || 1)) * 100}%"></span></div>
            <div class="row small"><span class="muted">Cards, payables, chit dues</span><span class="spacer"></span><span class="muted">Loans ${moneyShort(long)}</span></div>
        </div>
    </div>`;
}

function metric(label, value, raw, max, ok, note) {
    return {
        ok,
        html: `<div class="health-row ${ok ? 'ok' : 'warn'}" title="Healthy: ${esc(note)}">
            <span class="h-icon">${icon(ok ? 'check' : 'alert')}</span>
            <span class="h-label">${esc(label)}<small>${esc(note)}</small></span>
            <span class="h-meter"><i style="width:${Math.max(3, Math.min(100, (raw / max) * 100))}%"></i></span>
            <b>${value}</b></div>`,
    };
}

/** Accounts that changed the most since the comparison date. */
function moversCard(bs) {
    const rows = [];
    [[bs.assets, false], [bs.liabilities, true]].forEach(([s, liability]) => s.groups.forEach(g => g.accounts.forEach(a => {
        const change = Number(a.amount) - Number(a.previous || 0);
        if (Math.abs(change) >= 1) rows.push({ a, change, good: liability ? change < 0 : change > 0 });
    })));
    rows.sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
    if (!rows.length) return '';
    return `
    <div class="side-card">
        <div class="side-head">${icon('transfer')}<b>Biggest moves</b><span class="spacer"></span><span class="small muted">since ${shortDate(bs.compareDate)}</span></div>
        ${rows.slice(0, 5).map(r => {
            const t = accountTypeIcon(r.a.accountType);
            return `<div class="mover"><span class="chip-icon xs ${t.tone}">${icon(t.name)}</span><span class="ellipsis">${esc(r.a.name)}</span>
                <span class="spacer"></span><b class="mono ${r.good ? 'pos' : 'neg'}">${r.change > 0 ? '+' : '−'}${moneyShort(Math.abs(r.change))}</b></div>`;
        }).join('')}
    </div>`;
}
