/**
 * Dashboard: quick actions, KPIs, a financial health score with ranked insights, and a grid of panels
 * the user picks, orders and sizes (Customize, or Settings → Dashboard): income vs expenses, net worth,
 * spending mix, budgets, coming up, recent activity, chits to maturity, cash & cards, allocation and
 * this month's cash flow.
 */
import { api } from '../core/api.js';
import { state, can } from '../core/store.js';
import { panel, kpi, esc, statusBadge, emptyState, openModal } from '../core/ui.js';
import { kindChip, movementHtml } from '../core/entry-kind.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, shortDate, daysFromToday, isoDate } from '../core/format.js';
import { barChart, lineChart, donutChart, legend, seriesColor, foldOthers } from '../core/charts.js';
import { openEntryDetail, openQuickEntry, openJournalEditor } from '../components/transaction-forms.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { openDebtDialog } from '../components/debt-dialog.js';
import { openCustomizer } from '../components/dashboard-customizer.js';
import { DASHBOARD_WIDGETS, dashboardLayout } from '../core/prefs.js';

export async function render(container, _params, isCurrent) {
    const [d, chits] = await Promise.all([api.get('/dashboard'), api.get('/chits').catch(() => [])]);
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const k = d.kpis;
    const layout = dashboardLayout();

    const change = Number(k.netWorthChange);
    const expenseChange = Number(k.expenseChangePercent);
    const totalExpense = d.expenseBreakdown.reduce((s, p) => s + Number(p.value), 0);
    const widgets = layout.order.filter(id => !layout.hidden.includes(id));
    const label = Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w.label]));
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const nextChit = chits.filter(c => c.nextDueDate && (c.status === 'ACTIVE' || c.status === 'PRIZED')).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))[0];
    const post = can('POST_TRANSACTIONS');

    const bodies = {
        trend: () => panel({ title: label.trend, iconName: 'report', sub: 'last 12 months', cls: 'p-trend', bodyClass: 'chart',
            body: `<div class="chart-wrap">${legend([{ label: 'Income' }, { label: 'Expenses' }])}<div class="chart" id="trend-chart"></div></div>` }),
        networth: () => panel({ title: 'Net worth', iconName: 'trending', sub: 'month end', cls: 'p-networth', bodyClass: 'chart',
            body: `<div class="chart-wrap"><div class="chart" id="networth-chart"></div></div>` }),
        mix: () => panel({ title: label.mix, iconName: 'pie', sub: 'this month', cls: 'p-mix', bodyClass: 'chart',
            actions: `<a class="btn sm ghost icon" href="#/expenses" title="Expenses">${icon('chevron-right')}</a>`,
            body: d.expenseBreakdown.length ? `<div class="donut-wrap"><div class="chart" id="mix-chart"></div><div class="donut-legend scroll" id="mix-legend"></div></div>`
                : emptyState('No spending yet this month') }),
        budgets: () => panel({ title: 'Budgets', iconName: 'target', sub: 'this month', cls: 'p-budgets',
            actions: `<a class="btn sm ghost icon" href="#/planning" title="All budgets">${icon('chevron-right')}</a>`, body: budgetsHtml(d.budgets) }),
        upcoming: () => panel({ title: label.upcoming, iconName: 'calendar', sub: 'next 45 days', cls: 'p-upcoming', body: upcomingHtml(d.upcoming) }),
        recent: () => panel({ title: label.recent, iconName: 'clock', cls: 'p-recent',
            actions: `<a class="btn sm ghost icon" href="#/transactions" title="Journal">${icon('chevron-right')}</a>`, body: recentHtml(d.recent) }),
        chits: () => panel({ title: label.chits, iconName: 'chit', cls: 'p-dchits',
            actions: `<a class="btn sm ghost icon" href="#/chits" title="Chits">${icon('chevron-right')}</a>`, body: chitsHtml(chits) }),
        accounts: () => panel({ title: label.accounts, iconName: 'wallet', cls: 'p-daccts',
            actions: `<a class="btn sm ghost icon" href="#/accounts" title="Accounts">${icon('chevron-right')}</a>`, body: accountsHtml(d.accounts) }),
        alloc: () => panel({ title: label.alloc, iconName: 'layers', cls: 'p-alloc', body: allocationHtml(d.assetAllocation, d.liabilityBreakdown) }),
        cashflow: () => panel({ title: label.cashflow, iconName: 'droplet', cls: 'p-cashflow', body: cashflowHtml(k) }),
    };

    container.innerHTML = `
    <div class="page dashboard">
        <div class="dash-bar">
            <div class="dash-hello"><b>${greeting}, ${esc((state.user?.fullName || '').split(' ')[0])}</b>
                <span>${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
            <span class="spacer"></span>
            ${post ? `<div class="quick-actions" id="quick-actions">
                <button class="qa" data-qa="expense" title="Add expense (E)">${icon('arrow-out')}Expense<span class="kbd">E</span></button>
                <button class="qa" data-qa="income" title="Add income (I)">${icon('arrow-in')}Income<span class="kbd">I</span></button>
                <button class="qa" data-qa="transfer" title="Transfer between accounts (T)">${icon('transfer')}Transfer<span class="kbd">T</span></button>
                <button class="qa" data-qa="lend" title="Lent or paid for someone (L)">${icon('hand')}Lend<span class="kbd">L</span></button>
                <button class="qa" data-qa="borrow" title="Borrowed or a bill to pay (B)">${icon('card')}Owe<span class="kbd">B</span></button>
                ${nextChit ? `<a class="qa gold" href="#/chits" title="${esc(nextChit.name)} #${nextChit.installmentsPaid + 1} due ${shortDate(nextChit.nextDueDate)}">${icon('chit')}Chit ${moneyShort(nextChit.nextDueAmount)}</a>` : ''}
                ${can('MANAGE_JOURNALS') ? `<button class="qa" data-qa="journal" title="Journal voucher (V)">${icon('journal')}Voucher<span class="kbd">V</span></button>` : ''}
            </div>` : ''}
            <button class="btn sm" id="dash-customize" title="Choose, order and size the panels">${icon('settings')}Customize</button>
        </div>

        ${layout.bands.kpis ? `<div class="kpis kpi-row">
            ${kpi({ label: 'Net worth', value: money(k.netWorth), iconName: 'scale', tone: 'deep',
                    sub: `<span class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(change))}</span> this month` })}
            ${kpi({ label: 'Cash & bank', value: money(k.liquidBalance), iconName: 'bank',
                    sub: `Receivables ${moneyShort(k.receivables)} · Payables ${moneyShort(k.payables)}` })}
            ${kpi({ label: 'Income this month', value: money(k.monthIncome), iconName: 'arrow-in', tone: 'aqua', sub: `Savings ${money(k.monthSavings)}` })}
            ${kpi({ label: 'Spent this month', value: money(k.monthExpense), iconName: 'arrow-out', tone: 'coral',
                    sub: `<span class="${expenseChange <= 0 ? 'pos' : 'neg'}">${expenseChange > 0 ? '▲' : '▼'} ${percent(Math.abs(expenseChange))}</span> vs last month` })}
            ${kpi({ label: 'Savings rate', value: percent(k.savingsRate), iconName: 'piggy', tone: 'violet', sub: 'Share of income kept' })}
            ${kpi({ label: 'Chits', value: money(k.chitInvested), iconName: 'chit', tone: 'gold', sub: `${k.activeChits} running · accrued ${moneyShort(k.chitAccruedInterest)}` })}
        </div>` : ''}
        ${layout.bands.insights ? '<div class="insight-ribbon" id="insight-ribbon"></div>' : ''}
        <div class="dash-grid">${widgets.map(id => `<div class="dash-cell" style="grid-column: span ${layout.spans[id]}">${bodies[id]()}</div>`).join('')
            || emptyState('Every panel is switched off. Use Customize to add some.', 'dashboard')}</div>
    </div>`;

    if (layout.bands.insights) drawRibbon(container.querySelector('#insight-ribbon'), analyse(d));

    // ---- charts (months before the first transaction are dropped, keeping at least six)
    const firstActive = Math.min(d.monthlyTrend.length - 6,
        Math.max(0, d.monthlyTrend.findIndex(p => Number(p.income) || Number(p.expense))));
    const monthly = d.monthlyTrend.slice(firstActive);
    const worth = d.netWorthTrend.slice(firstActive);
    const el = id => container.querySelector(id);
    if (el('#trend-chart')) barChart(el('#trend-chart'), {
        labels: monthly.map(p => p.month), labelFormat: monthLabel, format: moneyShort,
        series: [
            { name: 'Income', values: monthly.map(p => Number(p.income)) },
            { name: 'Expenses', values: monthly.map(p => Number(p.expense)) },
        ],
    });
    if (el('#networth-chart')) lineChart(el('#networth-chart'), {
        labels: worth.map(p => p.label), labelFormat: monthLabel, format: moneyShort, area: true,
        series: [{ name: 'Net worth', values: worth.map(p => Number(p.value)) }],
    });
    if (el('#mix-chart')) {
        const items = foldOthers(d.expenseBreakdown.map(p => ({ label: p.label, value: Number(p.value) })));
        donutChart(el('#mix-chart'), { items, format: v => money(v), centerValue: moneyShort(totalExpense), centerLabel: 'spent' });
        el('#mix-legend').innerHTML = items.map((it, i) => `
            <div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('');
    }

    container.querySelector('.p-recent')?.addEventListener('click', e => {
        const row = e.target.closest('[data-entry]');
        if (row) openEntryDetail(row.dataset.entry, { onChanged: reload });
    });
    container.querySelector('#dash-customize').addEventListener('click', () => openCustomizer(reload));
    container.querySelector('#quick-actions')?.addEventListener('click', e => {
        const b = e.target.closest('[data-qa]');
        if (!b) return;
        ({
            expense: () => openExpenseDialog({ onSaved: reload }),
            income: () => openQuickEntry({ kind: 'INCOME', onSaved: reload }),
            transfer: () => openQuickEntry({ kind: 'TRANSFER', onSaved: reload }),
            lend: () => openExpenseDialog({ mode: 'LENT', onSaved: reload }),
            borrow: () => openDebtDialog({ onSaved: reload }),
            journal: () => openJournalEditor({ onSaved: reload }),
        })[b.dataset.qa]?.();
    });
}

// ===================================================================== panel bodies

/** Running chits: how far along, what they are worth now and at maturity. */
function chitsHtml(chits) {
    const running = chits.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && c.payoutAmount === null);
    if (!running.length) return emptyState('No running chits', 'chit');
    return `<div class="dchit-list">${running.map(c => {
        const paid = (Number(c.paidIn) / (Number(c.totalContribution) || 1)) * 100;
        return `<a class="dchit" href="#/chits">
            <div class="row"><b class="ellipsis grow">${esc(c.name)}</b><span class="small muted">${c.installmentsPaid}/${c.numberOfInstallments}</span></div>
            <i class="cr-bar"><em style="width:${paid}%"></em></i>
            <div class="row tiny"><span>paid <b>${moneyShort(c.paidIn)}</b></span><span>value <b>${moneyShort(c.currentValue)}</b></span>
                <span class="spacer"></span><span>→ <b class="gold-ink">${moneyShort(c.maturityAmount)}</b> ${shortDate(c.maturityDate)}</span></div>
        </a>`;
    }).join('')}</div>`;
}

function accountsHtml(tiles) {
    if (!tiles.length) return emptyState('No cash or card accounts', 'wallet');
    return `<div class="list">${tiles.map(a => {
        const t = accountTypeIcon(a.accountType);
        const util = a.utilizationPercent === null ? null : Number(a.utilizationPercent);
        return `<a class="list-item clickable" href="#/accounts"><span class="chip-icon sm ${t.tone}">${icon(t.name)}</span>
            <div class="grow min-0"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.typeLabel)}${util !== null ? ` · ${percent(util, 0)} of limit used` : ''}</div></div>
            <b class="mono ${Number(a.balance) < 0 ? 'neg' : ''}">${moneyShort(a.balance)}</b></a>`;
    }).join('')}</div>`;
}

/** This month in one picture: in, out, kept, and where the month is heading. */
function cashflowHtml(k) {
    const income = Number(k.monthIncome), expense = Number(k.monthExpense);
    const max = Math.max(income, expense, 1);
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projected = (expense / now.getDate()) * days;
    return `<div class="cashflow">
        <div class="cf-row"><span>Money in</span><i class="cf-bar in"><em style="width:${(income / max) * 100}%"></em></i><b class="pos">${moneyShort(income)}</b></div>
        <div class="cf-row"><span>Money out</span><i class="cf-bar out"><em style="width:${(expense / max) * 100}%"></em></i><b class="neg">${moneyShort(expense)}</b></div>
        <div class="cf-row"><span>Kept</span><i class="cf-bar kept"><em style="width:${(Math.max(0, income - expense) / max) * 100}%"></em></i><b>${moneyShort(income - expense)}</b></div>
        <div class="cf-note">${icon('trending')} At this pace spending ends the month near <b>${moneyShort(projected)}</b>; you would keep
            <b class="${income - projected >= 0 ? 'pos' : 'neg'}">${moneyShort(income - projected)}</b> (${percent(income ? ((income - projected) / income) * 100 : 0, 0)}).</div>
    </div>`;
}

function budgetsHtml(budgets) {
    if (!budgets.length) return emptyState('Set budgets on the Budgets page', 'target');
    return `<div class="list">${budgets.map(b => {
        const used = Number(b.usedPercent);
        const tone = b.health === 'OVER' ? 'over' : b.health === 'WARNING' ? 'warning' : 'good';
        return `
        <div class="budget-mini">
            <div class="row"><b class="ellipsis">${esc(b.categoryName)}</b><span class="spacer"></span>${statusBadge(b.health)}</div>
            <div class="progress ${tone}"><span style="width:${Math.min(used, 100)}%"></span></div>
            <div class="row small secondary"><span>${money(b.spent)} of ${money(b.monthlyLimit)}</span><span class="spacer"></span>
                <span>${percent(used, 0)}</span></div>
        </div>`;
    }).join('')}</div>`;
}

function allocationHtml(assets, liabilities) {
    const block = (title, items, tone) => {
        if (!items.length) return '';
        const max = Math.max(...items.map(i => Number(i.value)));
        return `<div class="section-title">${title}</div>` + items.map(i => `
            <div class="alloc-row">
                <span class="ellipsis">${esc(i.label)}</span>
                <div class="progress ${tone}"><span style="width:${(Number(i.value) / max) * 100}%"></span></div>
                <b class="mono">${moneyShort(i.value)}</b>
            </div>`).join('');
    };
    if (!assets.length && !liabilities.length) return emptyState('Add accounts to see allocation', 'layers');
    return block('Assets', assets, '') + block('Liabilities', liabilities, 'over');
}

function upcomingHtml(items) {
    if (!items.length) return emptyState('Nothing due soon', 'calendar');
    const meta = {
        CHIT: ['chit', 'gold', 'Chit installment'], INCOME: ['arrow-in', 'aqua', 'Income'], COMMITTED: ['lock', 'coral', 'Committed payment'],
        EXPENSE: ['receipt', 'coral', 'Expense'], TRANSFER: ['transfer', '', 'Transfer'], MATURITY: ['lock', 'violet', 'Maturity'],
    };
    return `<div class="list">${items.map(i => {
        const [iconName, tone, label] = meta[i.kind] || ['info', 'gray', i.kind];
        const days = daysFromToday(i.date);
        const when = i.overdue ? `<span class="badge critical">${icon('alert-circle')}Overdue</span>`
            : days === 0 ? '<span class="badge warning">Today</span>' : `<span class="muted small">in ${days}d</span>`;
        return `<div class="list-item">
            <span class="chip-icon sm ${tone}">${icon(iconName)}</span>
            <div class="grow"><div class="title">${esc(i.title)}</div><div class="meta">${label} · ${shortDate(i.date)}</div></div>
            <div style="text-align:right"><div class="strong mono">${money(i.amount)}</div>${when}</div>
        </div>`;
    }).join('')}</div>`;
}

function recentHtml(entries) {
    if (!entries.length) return emptyState('No transactions yet', 'journal');
    return `<div class="list">${entries.map(e => {
        const sign = e.voucherType === 'EXPENSE' ? 'neg' : e.voucherType === 'INCOME' ? 'pos' : '';
        return `<div class="list-item clickable" data-entry="${e.id}">
            ${kindChip(e.voucherType, 'sm', e.voucherLabel)}
            <div class="grow min-0"><div class="title ellipsis">${esc(e.narration)}${e.party && !e.narration.toLowerCase().includes(e.party.toLowerCase()) ? ` <span class="ls-person">· ${esc(e.party)}</span>` : ''}</div><div class="meta ellipsis">${shortDate(e.entryDate)} · ${movementHtml(e.lines)}</div></div>
            <b class="mono ${sign}">${money(e.amount)}</b>
        </div>`;
    }).join('')}</div>`;
}

// ===================================================================== health score & insights

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const avg = list => list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;

/**
 * Reads the dashboard data and returns a 0-100 health score (with its parts) and a list of
 * plain-language insights ranked bad, warning, good, info.
 */
function analyse(d) {
    const k = d.kpis;
    // the trend is computed before the chart code trims it, so it still holds 12 months
    const trend = d.monthlyTrend.map(p => ({ month: p.month, income: Number(p.income), expense: Number(p.expense) }));
    const past = trend.slice(0, -1).filter(p => p.income || p.expense);   // completed months only
    const last3 = past.slice(-3);
    const avgExpense = avg(last3.map(p => p.expense));
    const avgIncome = avg(last3.map(p => p.income));
    const savingsRates = past.slice(-12).filter(p => p.income > 0).map(p => ((p.income - p.expense) / p.income) * 100);
    const avgSavings = avg(savingsRates);
    const liquid = Number(k.liquidBalance);
    const assets = Number(k.totalAssets);
    const liabilities = Number(k.totalLiabilities);
    const runway = avgExpense ? liquid / avgExpense : null;
    const debtRatio = assets ? liabilities / assets : 0;

    const now = new Date();
    const day = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthExpense = Number(k.monthExpense);
    const projectedExpense = (monthExpense / day) * daysInMonth;
    const lastMonthExpense = past.length ? past[past.length - 1].expense : 0;

    const nw = d.netWorthTrend.map(p => Number(p.value));
    const nwMomentum = nw.length >= 4 ? (nw[nw.length - 1] - nw[nw.length - 4]) / 3 : 0;

    const budgets = d.budgets;
    const over = budgets.filter(b => b.health === 'OVER');
    const near = budgets.filter(b => b.health === 'WARNING');

    const cards = d.accounts.filter(a => a.accountType === 'CREDIT_CARD' && a.utilizationPercent !== null);
    const worstCard = cards.reduce((m, c) => (!m || Number(c.utilizationPercent) > Number(m.utilizationPercent) ? c : m), null);

    const in30 = d.upcoming.filter(u => daysFromToday(u.date) <= 30);
    const duesOut = in30.filter(u => u.kind !== 'INCOME').reduce((s, u) => s + Number(u.amount), 0);
    const duesIn = in30.filter(u => u.kind === 'INCOME').reduce((s, u) => s + Number(u.amount), 0);
    const overdue = d.upcoming.filter(u => u.overdue);

    // ---- score: savings 25, safety net 25, debt 20, budgets 15, growth 15
    const parts = [
        { label: 'Savings', score: clamp(avgSavings / 30) * 25, max: 25, note: `${percent(avgSavings, 0)} of income kept on average` },
        { label: 'Safety', score: runway === null ? 12 : clamp(runway / 6) * 25, max: 25,
          note: runway === null ? 'not enough history' : `cash covers ${runway.toFixed(1)} months of spending` },
        { label: 'Debt', score: (1 - clamp(debtRatio / 0.6)) * 20, max: 20, note: `liabilities are ${percent(debtRatio * 100, 0)} of assets` },
        { label: 'Budgets', score: budgets.length ? clamp((budgets.length - over.length - near.length * 0.5) / budgets.length) * 15 : 10, max: 15,
          note: budgets.length ? `${budgets.length - over.length} of ${budgets.length} within limit` : 'no budgets set' },
        { label: 'Growth', score: nwMomentum > 0 ? 15 : nwMomentum === 0 ? 8 : 3, max: 15,
          note: `net worth ${nwMomentum >= 0 ? '+' : '−'}${moneyShort(Math.abs(nwMomentum))} a month` },
    ];
    const score = Math.round(parts.reduce((s, p) => s + p.score, 0));
    const grade = score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Needs attention';

    // ---- insights
    const list = [];
    const add = (tone, iconName, title, value, text, link) => list.push({ tone, iconName, title, value, text, link });

    if (overdue.length) add('bad', 'alert-circle', 'Overdue', money(overdue.reduce((s, u) => s + Number(u.amount), 0)),
        `${overdue.length} payment(s) past due: ${overdue.slice(0, 2).map(u => esc(u.title)).join(', ')}.`, overdue[0].kind === 'CHIT' ? '#/chits' : '#/planning');
    if (runway !== null) {
        add(runway < 3 ? 'bad' : runway < 6 ? 'warn' : 'good', 'droplet', 'Safety net', `${runway.toFixed(1)} months`,
            runway < 6 ? `Cash covers ${runway.toFixed(1)} months of spending. ${moneyShort(avgExpense * 6 - liquid)} more reaches the 6-month mark.`
                       : `Cash covers ${runway.toFixed(1)} months of spending, above the 6-month mark.`, '#/accounts');
    }
    if (monthExpense && lastMonthExpense && day >= 5) {
        const diff = projectedExpense - lastMonthExpense;
        add(diff > lastMonthExpense * 0.1 ? 'warn' : 'good', 'trending', 'Spending pace', moneyShort(projectedExpense),
            `On track to spend ${moneyShort(projectedExpense)} this month, ${diff >= 0 ? `${moneyShort(diff)} more` : `${moneyShort(-diff)} less`} than last month.`, '#/expenses');
    }
    if (over.length) add('bad', 'target', 'Over budget', `${over.length} categor${over.length === 1 ? 'y' : 'ies'}`,
        `${over.map(b => esc(b.categoryName)).join(', ')} crossed the limit by ${moneyShort(over.reduce((s, b) => s + Number(b.spent) - Number(b.monthlyLimit), 0))}.`, '#/planning');
    else if (near.length) add('warn', 'target', 'Near budget', `${near.length} categor${near.length === 1 ? 'y' : 'ies'}`,
        `${near.map(b => esc(b.categoryName)).join(', ')} past the alert level.`, '#/planning');
    else if (budgets.length) add('good', 'target', 'Budgets', 'On track', `All ${budgets.length} budgets are within their limits.`, '#/planning');
    if (duesOut) add(duesOut > liquid ? 'bad' : duesOut > liquid * 0.5 ? 'warn' : 'info', 'calendar', 'Next 30 days', moneyShort(duesOut),
        `Scheduled payments of ${moneyShort(duesOut)}${duesIn ? ` against ${moneyShort(duesIn)} expected in` : ''}. Cash covers them ${(liquid / duesOut).toFixed(1)}×.`, '#/planning');
    if (worstCard && Number(worstCard.utilizationPercent) > 30) add(Number(worstCard.utilizationPercent) > 70 ? 'bad' : 'warn', 'card', 'Card usage',
        percent(worstCard.utilizationPercent, 0), `${esc(worstCard.name)} uses ${percent(worstCard.utilizationPercent, 0)} of its limit. Under 30% keeps your credit score healthy.`, '#/accounts');
    if (savingsRates.length) add(avgSavings >= 20 ? 'good' : avgSavings >= 10 ? 'warn' : 'bad', 'piggy', 'Savings rate', percent(avgSavings, 0),
        `You keep ${percent(avgSavings, 0)} of income on average.${avgSavings < 20 && avgIncome ? ` Reaching 20% means ${moneyShort(avgIncome * (0.2 - avgSavings / 100))} more a month.` : ''}`, '#/reports');
    if (d.expenseBreakdown.length && monthExpense) {
        const top = d.expenseBreakdown[0];
        const share = (Number(top.value) / monthExpense) * 100;
        if (share > 25) add('info', 'pie', 'Top category', percent(share, 0), `${esc(top.label)} takes ${percent(share, 0)} of this month's spending (${moneyShort(top.value)}).`, '#/expenses');
    }
    if (nw.length >= 4 && nwMomentum) add(nwMomentum > 0 ? 'good' : 'warn', nwMomentum > 0 ? 'trending' : 'trending-down', 'Net worth',
        `${nwMomentum > 0 ? '+' : '−'}${moneyShort(Math.abs(nwMomentum))}/mo`,
        nwMomentum > 0 ? `Growing about ${moneyShort(nwMomentum)} a month: ${moneyShort(Number(k.netWorth) + nwMomentum * 12)} in a year at this pace.`
                       : `Shrinking about ${moneyShort(-nwMomentum)} a month over the last quarter.`, '#/balance-sheet');
    if (debtRatio > 0.4) add('warn', 'scale', 'Debt load', percent(debtRatio * 100, 0), `Liabilities are ${percent(debtRatio * 100, 0)} of assets. Under 40% is comfortable.`, '#/balance-sheet');
    if (Number(k.receivables) > 0) add('info', 'hand', 'To collect', moneyShort(k.receivables), `${money(k.receivables)} is owed to you. A reminder could free up cash.`, '#/expenses/collect');
    if (Number(k.chitAccruedInterest) > 0) add('good', 'chit', 'Chit returns', moneyShort(k.chitAccruedInterest),
        `${k.activeChits} running chit(s) have earned ${money(k.chitAccruedInterest)} in interest so far.`, '#/chits');
    if (avgIncome && day > 20 && Number(k.monthIncome) < avgIncome * 0.7)
        add('warn', 'arrow-in', 'Income', moneyShort(k.monthIncome), `Income this month is ${percent((1 - Number(k.monthIncome) / avgIncome) * 100, 0)} below your 3-month average.`, '#/reports');

    const rank = { bad: 0, warn: 1, good: 2, info: 3 };
    list.sort((a, b) => rank[a.tone] - rank[b.tone]);
    return { score, grade, parts, insights: list };
}

function insightCard(i) {
    return `<a class="insight-card ${i.tone}" href="${i.link || '#/dashboard'}">
        <span class="ic-icon">${icon(i.iconName)}</span>
        <div class="min-0"><div class="ic-head"><span class="ic-title">${esc(i.title)}</span><b class="ic-value">${i.value}</b></div>
            <div class="ic-text">${i.text}</div></div></a>`;
}

function drawRibbon(el, { score, grade, parts, insights }) {
    const shown = insights.slice(0, 4);
    el.innerHTML = `
        <div class="health-card">
            <div class="hc-gauge" style="--p:${score}"><span><b>${score}</b><small>/100</small></span></div>
            <div class="hc-body">
                <div class="hc-label">${icon('sparkles')}Financial health</div>
                <div class="hc-grade">${grade}</div>
                <div class="hc-parts">${parts.map(p => `<div class="hc-part" title="${esc(p.label)}: ${esc(p.note)}">
                    <span>${esc(p.label)}</span><i><b style="width:${(p.score / p.max) * 100}%"></b></i></div>`).join('')}</div>
            </div>
        </div>
        <div class="insight-cards">${shown.map(insightCard).join('') || emptyState('Add a few transactions to see insights', 'bulb')}</div>
        <button class="insight-more" id="all-insights" title="All insights and how the score is built">${icon('bulb')}<b>${insights.length}</b><span>insights</span></button>`;
    el.querySelector('#all-insights').addEventListener('click', () => openModal({
        title: 'Smart insights', iconName: 'bulb', size: 'lg',
        body: `<div class="insight-grid">${insights.map(insightCard).join('')}</div>
            <div class="section-title" style="margin-top:12px">How the health score of ${score} is built</div>
            <div class="hc-breakdown">${parts.map(p => `<div><span>${esc(p.label)}</span><b>${Math.round(p.score)} / ${p.max}</b><small>${esc(p.note)}</small></div>`).join('')}</div>`,
        actions: [{ label: 'Close' }],
    }));
}
