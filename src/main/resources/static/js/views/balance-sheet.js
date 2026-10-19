/**
 * Balance sheet: a classic two-column statement (Assets | Liabilities & Equity) on any date, with three
 * compact cards on top (assets and liabilities with their parts, net worth with how it is funded). Groups holding a single account show as one row,
 * the asset / liability mix fills the space under equity, and a slim right-hand pane holds suggestions,
 * the net-worth trend, health ratios, dues profile and the biggest movers.
 */
import { api } from '../core/api.js';
import { loadAccounts } from '../core/store.js';
import { esc, printElement } from '../core/ui.js';
import { exportButton, bindExport } from '../core/export.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { lineChart } from '../core/charts.js';
import { money, moneyShort, percent, isoDate, date, shortDate } from '../core/format.js';

/** "Compare with" presets: the comparison date for a given as-of date. */
const COMPARE = {
    month: { label: 'Last month', date: asOf => isoDate(new Date(asOf.getFullYear(), asOf.getMonth(), 0)) },
    quarter: { label: '3 months', date: asOf => isoDate(new Date(asOf.getFullYear(), asOf.getMonth() - 2, 0)) },
    year: { label: 'Year start', date: asOf => isoDate(new Date(asOf.getFullYear() - 1, 11, 31)) },
    custom: { label: 'Custom', date: () => view.compareTo },
};

const view = { asOf: isoDate(), compare: 'month', compareTo: '', showPrevious: false, collapsed: new Set() };

export async function render(container, _params, isCurrent) {
    const asOfDate = new Date(view.asOf + 'T00:00:00');
    view.compareTo = COMPARE[view.compare].date(asOfDate) || view.compareTo;
    const [bs, accounts] = await Promise.all([
        api.get('/reports/balance-sheet', { asOf: view.asOf, compareTo: view.compareTo }),
        loadAccounts(),
    ]);
    if (!isCurrent()) return;
    view.compareTo = bs.compareDate;
    const reload = () => render(container, [], isCurrent);

    const assets = Number(bs.assets.total);
    const liabilities = Number(bs.liabilities.total);

    container.innerHTML = `
    <div class="page balance-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('scale')} Balance sheet</h2>
            ${bs.balanced ? `<span class="badge good">${icon('check-circle')}Balanced</span>`
                          : `<span class="badge critical">${icon('alert')}Out of balance</span>`}
            <span class="spacer"></span>
            <label class="row small secondary">As of <input type="date" id="asof" value="${bs.asOf}" max="${isoDate()}"></label>
            <span class="small secondary">compare with</span>
            <div class="seg-chips sm" id="bs-compare">${Object.entries(COMPARE).map(([k, c]) =>
                `<button class="seg-chip ${view.compare === k ? 'active' : ''}" data-compare="${k}">${c.label}</button>`).join('')}</div>
            ${view.compare === 'custom' ? `<input type="date" id="compare" value="${bs.compareDate}" max="${bs.asOf}">` : `<span class="small muted">${date(bs.compareDate)}</span>`}
            <label class="switch small"><input type="checkbox" id="bs-prev" ${view.showPrevious ? 'checked' : ''}><span></span>Previous column</label>
            ${exportButton({ label: '' })}
            <button class="btn sm" id="print" title="Print">${icon('printer')}</button>
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
            </div>
            <div class="bs-columns scroll">
                <div class="bs-col">
                    ${sectionHtml(bs.assets, assets, false, 'asset')}
                </div>
                <div class="bs-col">
                    ${sectionHtml(bs.liabilities, liabilities, true, 'liability')}
                    ${sectionHtml(bs.equity, Number(bs.equity.total), false, 'equity')}
                    <div class="bs-mixes">
                        ${mixCard('Asset mix', bs.assetMix, assets, 'asset')}
                        ${mixCard('Liability mix', bs.liabilityMix, liabilities, 'liability')}
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

    // ---- events
    container.querySelector('#asof').addEventListener('change', e => { view.asOf = e.target.value; reload(); });
    container.querySelector('#compare')?.addEventListener('change', e => { view.compareTo = e.target.value; reload(); });
    container.querySelector('#bs-compare').addEventListener('click', e => {
        const b = e.target.closest('[data-compare]');
        if (b) { view.compare = b.dataset.compare; reload(); }
    });
    container.querySelector('#bs-prev').addEventListener('change', e => { view.showPrevious = e.target.checked; reload(); });
    container.querySelector('.bs-columns').addEventListener('click', e => {
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
        return {
            title: `Balance sheet as of ${date(bs.asOf)}`, subtitle: `Compared with ${date(bs.compareDate)}`, filename: `balance-sheet-${bs.asOf}`,
            summary: [['Net worth', Number(bs.netWorth)], ['Change', Number(bs.netWorthChange)]],
            sheets: [{ name: 'Balance sheet', columns: [{ label: 'Section' }, { label: 'Group' }, { label: 'Account' },
                { label: date(bs.compareDate), type: 'money' }, { label: date(bs.asOf), type: 'money' }, { label: 'Change', type: 'money' }],
                rows: rows.map(r => [r[0], r[1], r[2], r[3] === '' ? '' : Number(r[3]), r[4], r[5]]),
                totals: ['Net worth', '', '', Number(bs.previousNetWorth), Number(bs.netWorth), Number(bs.netWorthChange)] }],
        };
    });
}

// ===================================================================== header

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
    const liquid = accounts.filter(a => ['CASH', 'BANK', 'WALLET'].includes(a.accountType)).reduce((s, a) => s + Number(a.balance), 0);
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
        <div class="bs-section-total"><span>Total ${esc(section.label.toLowerCase())}</span>
            ${view.showPrevious ? `<span class="g-prev">${money(section.previous)}</span>` : ''}<b>${money(section.total)}</b></div>
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
            ${Math.abs(change) < 0.5 ? '' : `<span class="a-delta ${good ? 'pos' : 'neg'}" title="Change since the comparison date">${change > 0 ? '+' : '−'}${moneyShort(Math.abs(change))}</span>`}
            <span class="g-share" title="${percent(share, 1)}"><i style="width:${Math.min(100, Math.abs(share))}%"></i></span>
            <span class="g-pct">${percent(share, 0)}</span>
            ${view.showPrevious ? `<span class="g-prev">${moneyShort(a.previous ?? 0)}</span>` : ''}
            <b class="g-total ${Number(a.amount) < 0 ? 'neg' : ''}">${money(a.amount)}</b>
        </div>
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
        ${delta}
        ${view.showPrevious ? `<span class="a-prev">${money(a.previous ?? 0)}</span>` : ''}
        <span class="a-amt ${Number(a.amount) < 0 ? 'neg' : ''}">${money(a.amount)}</span>
    </div>`;
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

function mixCard(title, mix, total, kind) {
    const colors = kind === 'asset'
        ? ['--series-1', '--series-3', '--series-7', '--series-4', '--series-5', '--series-6']
        : ['--series-2', '--series-8', '--series-5'];
    if (!mix.length) return '';
    return `
    <div class="side-card">
        <div class="side-head">${icon(kind === 'asset' ? 'layers' : 'card')}<b>${title}</b><span class="spacer"></span><b class="mono small">${moneyShort(total)}</b></div>
        <div class="mix-bar tall">${mix.map((m, i) => `<span style="width:${(Number(m.value) / (total || 1)) * 100}%;background:var(${colors[i % colors.length]})"
            title="${esc(m.label)} ${money(m.value)}"></span>`).join('')}</div>
        <div class="mix-rows">${mix.map((m, i) => `<div class="mix-row"><i class="legend-swatch" style="background:var(${colors[i % colors.length]})"></i>
            <span class="ellipsis">${esc(m.label)}</span><span class="spacer"></span>
            <span class="muted">${percent((Number(m.value) / (total || 1)) * 100, 0)}</span><b class="mono">${moneyShort(m.value)}</b></div>`).join('')}</div>
    </div>`;
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
