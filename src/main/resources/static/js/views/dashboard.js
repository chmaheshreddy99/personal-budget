/**
 * Dashboard: quick actions, KPIs, a financial health score with ranked insights, and a grid of panels
 * the user picks, orders and sizes (Customize, or Settings → Dashboard): income vs expenses, net worth,
 * spending mix, budgets, coming up, recent activity, chits to maturity, cash & cards, allocation and
 * this month's cash flow.
 */
import { api } from '../core/api.js';
import { state, can } from '../core/store.js';
import { panel, kpi, esc, statusBadge, emptyState, openModal } from '../core/ui.js';
import { kindChip, movementHtml, projectTag } from '../core/entry-kind.js';
import { shortNarration, partyAdds, chitCodeOf } from '../core/chit-trail.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, shortDate, daysFromToday, isoDate } from '../core/format.js';
import { barChart, lineChart, donutChart, legend, seriesColor, foldOthers } from '../core/charts.js';
import { openEntryDetail, openQuickEntry, openJournalEditor } from '../components/transaction-forms.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { openDebtDialog } from '../components/debt-dialog.js';
import { openCustomizer } from '../components/dashboard-customizer.js';
import { DASHBOARD_WIDGETS, dashboardLayout } from '../core/prefs.js';

export async function render(container, _params, isCurrent) {
    const shownIds = (() => { const l = dashboardLayout(); return l.order.filter(id => !l.hidden.includes(id)); })();
    // the EMI book and the category history only when their panels are shown (each section may not be shared)
    const [d, chits, hosted, emiBook, analysis] = await Promise.all([api.get('/dashboard'), api.get('/chits').catch(() => []),
        api.get('/hosted-chits/summary').catch(() => null),
        shownIds.includes('emis') ? api.get('/expenses/emis').catch(() => null) : null,
        shownIds.includes('cattrend') ? api.get('/reports/expense-analysis').catch(() => null) : null]);
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const k = d.kpis;
    const layout = dashboardLayout();

    const change = Number(k.netWorthChange);
    const expenseChange = Number(k.expenseChangePercent);
    // a second fact for each KPI: averages over the completed months of the trend
    const done = d.monthlyTrend.slice(0, -1).map(p => ({ income: Number(p.income), expense: Number(p.expense) })).filter(p => p.income || p.expense);
    const mean = list => (list.length ? list.reduce((t, v) => t + v, 0) / list.length : 0);
    const avgSpend = mean(done.slice(-3).map(p => p.expense));
    const avgEarn = mean(done.slice(-3).map(p => p.income));
    const keptYear = mean(done.slice(-12).filter(p => p.income > 0).map(p => ((p.income - p.expense) / p.income) * 100));
    const cover = avgSpend ? Number(k.liquidBalance) / avgSpend : null;
    const dayOfMonth = new Date().getDate();
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
        savings: () => panel({ title: label.savings, iconName: 'piggy', sub: 'kept each month', cls: 'p-dsave', bodyClass: 'chart',
            body: savingsHtml(d.monthlyTrend) }),
        chitflow: () => panel({ title: label.chitflow, iconName: 'chit', sub: 'next 12 months', cls: 'p-dchitflow', bodyClass: 'chart',
            actions: `<a class="btn sm ghost icon" href="#/chits" title="Chits">${icon('chevron-right')}</a>`, body: chitFlowHtml(chits) }),
        emis: () => panel({ title: label.emis, iconName: 'calendar', sub: 'what is still owed', cls: 'p-demis', bodyClass: 'chart',
            actions: `<a class="btn sm ghost icon" href="#/reports/emi" title="EMI analysis">${icon('chevron-right')}</a>`, body: emisHtml(emiBook, d) }),
        cattrend: () => panel({ title: label.cattrend, iconName: 'trending', sub: 'top categories, month by month', cls: 'p-dcattrend', bodyClass: 'chart',
            actions: `<a class="btn sm ghost icon" href="#/reports" title="Reports">${icon('chevron-right')}</a>`, body: catTrendHtml(analysis) }),
        debt: () => panel({ title: label.debt, iconName: 'scale', sub: 'what you owe', cls: 'p-ddebt', body: debtHtml(d) }),
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
                    sub: `<span class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(change))}</span> this month · own ${moneyShort(k.totalAssets)} · owe ${moneyShort(k.totalLiabilities)}` })}
            ${kpi({ label: 'Cash & bank', value: money(k.liquidBalance), iconName: 'bank',
                    sub: `${cover !== null ? `<span class="${cover < 3 ? 'neg' : 'pos'}">${cover.toFixed(1)} months</span> of spending · ` : ''}to get ${moneyShort(k.receivables)} · to pay ${moneyShort(k.payables)}` })}
            ${kpi({ label: 'Income this month', value: money(k.monthIncome), iconName: 'arrow-in', tone: 'aqua',
                    sub: `Saved ${money(k.monthSavings)}${avgEarn ? ` · usual ${moneyShort(avgEarn)}/mo` : ''}` })}
            ${kpi({ label: 'Spent this month', value: money(k.monthExpense), iconName: 'arrow-out', tone: 'coral',
                    sub: `<span class="${expenseChange <= 0 ? 'pos' : 'neg'}">${expenseChange > 0 ? '▲' : '▼'} ${percent(Math.abs(expenseChange))}</span> vs last month · ${moneyShort(Number(k.monthExpense) / dayOfMonth)}/day${avgSpend ? ` · usual ${moneyShort(avgSpend)}` : ''}` })}
            ${kpi({ label: 'Savings rate', value: percent(k.savingsRate), iconName: 'piggy', tone: 'violet',
                    sub: `Share of income kept${done.length ? ` · 12-mo avg <b>${percent(keptYear, 0)}</b>` : ''}` })}
            ${kpi({ label: 'Chits', value: money(k.chitInvested), iconName: 'chit', tone: 'gold', sub: `${k.activeChits} running · accrued ${moneyShort(k.chitAccruedInterest)}` })}
        </div>` : ''}
        ${hosted?.running ? hostedDuesHtml(hosted) : ''}
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

    drawExtraCharts(container, { d, chits, emiBook, analysis });

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

const ymOf = date => String(date).slice(0, 7);
/** The next n months as "YYYY-MM", this month first. */
function monthsAhead(n) {
    const now = new Date();
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
}
const facts = list => `<div class="dx-facts">${list.filter(Boolean).map(([l, v, cls = '']) => `<span><small>${l}</small><b class="${cls}">${v}</b></span>`).join('')}</div>`;

/** What was kept each month (income − spending), the average and the best month. */
function savingsHtml(trend) {
    const pts = trend.filter(p => Number(p.income) || Number(p.expense)).slice(-12);
    if (pts.length < 2) return emptyState('A couple of months of income and spending show here', 'piggy');
    const kept = pts.slice(0, -1).map(p => Number(p.income) - Number(p.expense));
    const rates = pts.slice(0, -1).filter(p => Number(p.income) > 0).map(p => ((Number(p.income) - Number(p.expense)) / Number(p.income)) * 100);
    const avgKept = kept.length ? kept.reduce((s, v) => s + v, 0) / kept.length : 0;
    const bestI = kept.indexOf(Math.max(...kept));
    return `${facts([
        ['Average', `${avgKept >= 0 ? '' : '−'}${moneyShort(Math.abs(avgKept))}/mo`, avgKept >= 0 ? 'pos' : 'neg'],
        ['Rate', rates.length ? percent(rates.reduce((s, v) => s + v, 0) / rates.length, 0) : '—'],
        bestI >= 0 ? ['Best', `${monthLabel(pts[bestI].month)} ${moneyShort(kept[bestI])}`, 'pos'] : null,
        ['12 months', moneyShort(kept.reduce((s, v) => s + v, 0)), kept.reduce((s, v) => s + v, 0) >= 0 ? 'pos' : 'neg'],
    ])}<div class="chart-wrap"><div class="chart" id="dx-savings"></div></div>`;
}

/** Chit installments going out and payouts coming in over the next twelve months. */
function chitFlowSeries(chits) {
    const months = monthsAhead(12);
    const out = months.map(() => 0), inflow = months.map(() => 0);
    chits.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED')).forEach(c => {
        if (c.nextDueDate && Number(c.installmentsPending) > 0) {
            const start = months.indexOf(ymOf(c.nextDueDate));
            for (let i = Math.max(0, start), n = 0; start >= 0 && i < months.length && n < c.installmentsPending; i++, n++) out[i] += Number(c.monthlyInstallment || 0);
        }
        if (c.payoutAmount === null && c.maturityDate) {
            const at = months.indexOf(ymOf(c.maturityDate));
            if (at >= 0) inflow[at] += Number(c.maturityAmount || 0);
        }
    });
    return { months, out, inflow };
}

function chitFlowHtml(chits) {
    const running = chits.filter(c => c.status === 'ACTIVE' || c.status === 'PRIZED');
    if (!running.length) return emptyState('No running chits', 'chit');
    const { out, inflow } = chitFlowSeries(chits);
    const totalOut = out.reduce((s, v) => s + v, 0), totalIn = inflow.reduce((s, v) => s + v, 0);
    const peak = Math.max(...out);
    return `${facts([
        ['Paying in', moneyShort(totalOut), 'neg'], ['Payouts', moneyShort(totalIn), 'pos'],
        ['Net', `${totalIn - totalOut >= 0 ? '+' : '−'}${moneyShort(Math.abs(totalIn - totalOut))}`, totalIn - totalOut >= 0 ? 'pos' : 'neg'],
        ['Peak month', moneyShort(peak)],
    ])}${legend([{ label: 'Installments' }, { label: 'Payouts' }])}<div class="chart-wrap"><div class="chart" id="dx-chitflow"></div></div>`;
}

/** EMI outgo by month for the year ahead, and each plan with what is left. */
function emiSeries(plans) {
    const months = monthsAhead(12);
    const due = months.map(() => 0);
    plans.forEach(p => (p.installments || []).filter(i => i.status !== 'PAID').forEach(i => {
        const at = months.indexOf(ymOf(i.dueDate));
        if (at >= 0) due[at] += Number(i.emi || 0);
    }));
    return { months, due };
}

function emisHtml(book, d) {
    const plans = (book?.plans || []).filter(p => p.status !== 'CLOSED' && !p.archived);
    if (!plans.length) return loansHtml(d, book);
    const s = book.summary;
    return `${facts([
        ['Owed', moneyShort(s.outstanding), 'neg'], ['This month', moneyShort(s.thisMonth)],
        ['Interest left', moneyShort(s.interestLeft)], ['Running', String(s.active)],
    ])}<div class="chart-wrap short"><div class="chart" id="dx-emis"></div></div>
    <div class="dx-plans">${plans.slice(0, 4).map(p => `<div class="dx-plan" title="${esc(p.narration)} · ${p.left} of ${p.months} EMIs left · ${money(p.emiAmount)} a month">
        <span class="ellipsis">${esc(p.narration)}</span><i class="cr-bar"><em style="width:${p.progressPercent}%"></em></i><b>${moneyShort(p.outstanding)}</b></div>`).join('')}</div>`;
}

/** No EMI running: the loans on the books instead (home, vehicle, personal ...), biggest first, against the total. */
function loansHtml(d, book) {
    const loans = (d.liabilityBreakdown || []).map(x => ({ label: x.label, value: Number(x.value) }))
        .filter(x => x.value > 0 && !/card|payable/i.test(x.label)).sort((a, b) => b.value - a.value);
    if (!loans.length) return emptyState(book ? 'No EMIs or loans running' : 'EMIs show here when Expenses is shared with you', 'calendar');
    const total = loans.reduce((s, x) => s + x.value, 0);
    return `${facts([['Loans owed', moneyShort(total), 'neg'], ['Loans', String(loans.length)], ['EMIs', 'none running']])}
    <div class="dx-plans dx-loans">${loans.map(l => `<div class="dx-plan" title="${esc(l.label)}: ${money(l.value)} · ${percent((l.value / total) * 100, 0)} of the loans">
        <span class="ellipsis">${esc(l.label)}</span><i class="progress over"><span style="width:${(l.value / total) * 100}%"></span></i><b>${moneyShort(l.value)}</b></div>`).join('')}</div>
    <p class="dx-note">${icon('info')} Buy something on EMI in Expenses to see its schedule here.</p>`;
}

/** The five biggest categories over the months analysed, one line each. */
function catTrendHtml(a) {
    if (!a || !a.categories?.length || (a.months || []).length < 2) return emptyState('A few months of spending show the trend here', 'trending');
    const top = a.categories.slice(0, 5);
    const first = top.map(c => Number(c.byMonth[0] || 0)), last = top.map(c => Number(c.byMonth.at(-2) ?? c.byMonth.at(-1) ?? 0));
    const riser = top.map((c, i) => ({ c, d: last[i] - first[i] })).sort((x, y) => y.d - x.d)[0];
    return `${facts([
        ['Monthly average', moneyShort(a.monthlyAverage)], ['Top', esc(top[0].name)],
        riser && riser.d > 0 ? ['Rising most', `${esc(riser.c.name)} +${moneyShort(riser.d)}`, 'neg'] : null,
    ])}${legend(top.map(c => ({ label: c.name })), 'line')}<div class="chart-wrap"><div class="chart" id="dx-cattrend"></div></div>`;
}

/** Liabilities by kind, card usage against limits, and how the debt compares to what is owned. */
function debtHtml(d) {
    const items = (d.liabilityBreakdown || []).map(x => ({ label: x.label, value: Number(x.value) })).filter(x => x.value > 0);
    const total = items.reduce((s, x) => s + x.value, 0);
    const cards = d.accounts.filter(a => a.accountType === 'CREDIT_CARD' && a.utilizationPercent !== null);
    if (!total && !cards.length) return emptyState('Nothing owed: no loans, cards or dues', 'scale');
    const assets = Number(d.kpis.totalAssets) || 1;
    return `<div class="dx-debt">
        <div class="donut-wrap"><div class="chart" id="dx-debt"></div>
            <div class="donut-legend">${items.map((it, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('')}
                <div class="dx-ratio"><small>Debt to assets</small><i class="progress ${total / assets > 0.4 ? 'over' : 'good'}"><span style="width:${Math.min(100, (total / assets) * 100)}%"></span></i>
                    <b>${percent((total / assets) * 100, 0)}</b></div></div></div>
        ${cards.length ? `<div class="dx-cards"><div class="section-title">${icon('card')} Card usage</div>${cards.map(c => {
            const u = Number(c.utilizationPercent);
            return `<div class="dx-plan"><span class="ellipsis">${esc(c.name)}</span>
                <i class="progress ${u > 70 ? 'over' : u > 30 ? 'warning' : 'good'}"><span style="width:${Math.min(100, u)}%"></span></i><b>${percent(u, 0)}</b></div>`;
        }).join('')}</div>` : ''}
    </div>`;
}

/** The charts of the panels above, once their boxes are on the page. */
function drawExtraCharts(container, { d, chits, emiBook, analysis }) {
    const el = id => container.querySelector(id);
    if (el('#dx-savings')) {
        const pts = d.monthlyTrend.filter(p => Number(p.income) || Number(p.expense)).slice(-12);
        barChart(el('#dx-savings'), { labels: pts.map(p => p.month), labelFormat: monthLabel, format: moneyShort,
            series: [{ name: 'Kept', values: pts.map(p => Number(p.income) - Number(p.expense)), color: 'var(--series-3)' }] });
    }
    if (el('#dx-chitflow')) {
        const { months, out, inflow } = chitFlowSeries(chits);
        barChart(el('#dx-chitflow'), { labels: months, labelFormat: monthLabel, format: moneyShort,
            series: [{ name: 'Installments', values: out }, { name: 'Payouts', values: inflow }] });
    }
    if (el('#dx-emis')) {
        const { months, due } = emiSeries((emiBook?.plans || []).filter(p => p.status !== 'CLOSED' && !p.archived));
        barChart(el('#dx-emis'), { labels: months, labelFormat: monthLabel, format: moneyShort, series: [{ name: 'EMIs due', values: due, color: 'var(--series-5)' }] });
    }
    if (el('#dx-cattrend')) {
        lineChart(el('#dx-cattrend'), { labels: analysis.months, labelFormat: monthLabel, format: moneyShort, includeZero: true,
            series: analysis.categories.slice(0, 5).map(c => ({ name: c.name, values: c.byMonth.map(Number) })) });
    }
    if (el('#dx-debt')) {
        const items = (d.liabilityBreakdown || []).map(x => ({ label: x.label, value: Number(x.value) })).filter(x => x.value > 0);
        const total = items.reduce((s, x) => s + x.value, 0);
        donutChart(el('#dx-debt'), { items, format: v => money(v), centerValue: moneyShort(total), centerLabel: 'owed' });
    }
}

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
            <div class="grow min-0"><div class="title ellipsis" title="${esc(e.narration)}">${projectTag(e.construction)}${esc(shortNarration(e.narration, e.chitTrail, e.party))}${partyAdds(e.party, shortNarration(e.narration, e.chitTrail, e.party), e.chitTrail) ? ` <span class="ls-person">· ${esc(e.party)}</span>` : ''}</div><div class="meta ellipsis">${shortDate(e.entryDate)} · ${movementHtml(e.lines, chitCodeOf(e.chitTrail))}</div></div>
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

    // ---- more insights, from the same figures
    const payables = Number(k.payables);
    if (payables > 0) add(payables > liquid ? 'bad' : 'info', 'card', 'You owe', moneyShort(payables),
        `${money(payables)} is still to pay to others${payables > liquid ? ', more than the cash at hand' : ''}.`, '#/expenses/collect');
    // what can be spent a day for the rest of the month and stay at the usual level
    const daysLeft = daysInMonth - day + 1;
    if (avgExpense && day >= 3) {
        const room = avgExpense - monthExpense;
        add(room < 0 ? 'warn' : 'info', 'wallet', 'Daily allowance', room > 0 ? `${moneyShort(room / daysLeft)}/day` : 'Over',
            room > 0 ? `Spend up to ${moneyShort(room / daysLeft)} a day for the next ${daysLeft} days to stay at your usual ${moneyShort(avgExpense)} a month.`
                     : `This month's spending is already ${moneyShort(-room)} above your usual ${moneyShort(avgExpense)}.`, '#/expenses');
    }
    // the biggest single expense this month, among the recent entries
    const thisMonth = isoDate().slice(0, 7);
    const bigOne = (d.recent || []).filter(e => e.voucherType === 'EXPENSE' && String(e.entryDate).startsWith(thisMonth))
        .reduce((m, e) => (!m || Number(e.amount) > Number(m.amount) ? e : m), null);
    if (bigOne && monthExpense && Number(bigOne.amount) >= monthExpense * 0.2) add('info', 'receipt', 'Biggest expense', moneyShort(bigOne.amount),
        `${esc(bigOne.narration)} on ${shortDate(bigOne.entryDate)} is ${percent((Number(bigOne.amount) / monthExpense) * 100, 0)} of this month's spending.`, '#/expenses');
    // the year so far and the best month
    const year = String(now.getFullYear());
    const ytd = trend.filter(p => p.month.startsWith(year));
    const ytdSaved = ytd.reduce((s, p) => s + p.income - p.expense, 0);
    if (ytd.length >= 2 && ytd.some(p => p.income)) add(ytdSaved >= 0 ? 'good' : 'warn', 'flag', `${year} so far`, `${ytdSaved >= 0 ? '+' : '−'}${moneyShort(Math.abs(ytdSaved))}`,
        `${ytdSaved >= 0 ? 'Saved' : 'Spent beyond income by'} ${moneyShort(Math.abs(ytdSaved))} across ${ytd.length} month${ytd.length === 1 ? '' : 's'} this year.`, '#/reports');
    const best = past.filter(p => p.income > 0).reduce((m, p) => (!m || p.income - p.expense > m.income - m.expense ? p : m), null);
    if (best && past.length >= 3 && best.income - best.expense > 0) add('good', 'crown', 'Best month', monthLabel(best.month),
        `${monthLabel(best.month)} kept the most: ${moneyShort(best.income - best.expense)} (${percent(((best.income - best.expense) / best.income) * 100, 0)} of income).`, '#/reports');
    // cash sitting idle beyond a comfortable safety net
    if (runway !== null && runway > 9 && avgExpense) add('info', 'coins', 'Idle cash', moneyShort(liquid - avgExpense * 6),
        `About ${moneyShort(liquid - avgExpense * 6)} sits above a 6-month safety net; an FD or a fund could earn on it.`, '#/accounts');
    // most of the assets in one place
    const alloc = (d.assetAllocation || []).map(x => ({ label: x.label, value: Number(x.value) })).filter(x => x.value > 0);
    const allocTotal = alloc.reduce((s, x) => s + x.value, 0);
    const biggest = alloc.reduce((m, x) => (!m || x.value > m.value ? x : m), null);
    if (biggest && allocTotal && alloc.length > 1 && biggest.value / allocTotal > 0.6) add('info', 'pie', 'Concentration', percent((biggest.value / allocTotal) * 100, 0),
        `${esc(biggest.label)} holds ${percent((biggest.value / allocTotal) * 100, 0)} of your assets; spreading them lowers the risk.`, '#/balance-sheet');
    // how steady spending is month to month
    const lastSix = past.slice(-6).map(p => p.expense).filter(v => v > 0);
    if (lastSix.length >= 4) {
        const mean = avg(lastSix);
        const spread = Math.sqrt(avg(lastSix.map(v => (v - mean) ** 2))) / mean;
        add(spread > 0.35 ? 'warn' : 'good', 'activity', 'Spending swings', `±${percent(spread * 100, 0)}`,
            spread > 0.35 ? `Monthly spending swings about ${percent(spread * 100, 0)} around ${moneyShort(mean)}; a budget for the big months smooths it.`
                          : `Monthly spending stays steady around ${moneyShort(mean)} (±${percent(spread * 100, 0)}).`, '#/reports');
    }
    // what falls due in the next seven days
    const week = d.upcoming.filter(u => !u.overdue && u.kind !== 'INCOME' && daysFromToday(u.date) >= 0 && daysFromToday(u.date) <= 7);
    if (week.length) add('info', 'calendar', 'This week', moneyShort(week.reduce((s, u) => s + Number(u.amount), 0)),
        `${week.length} payment${week.length === 1 ? '' : 's'} due in the next 7 days: ${week.slice(0, 3).map(u => esc(u.title)).join(', ')}${week.length > 3 ? '…' : ''}.`, '#/planning');
    // no income recorded yet, well into the month
    if (avgIncome && day >= 10 && !Number(k.monthIncome)) add('warn', 'arrow-in', 'No income yet', '—',
        `Nothing is recorded as income this month (usually ${moneyShort(avgIncome)}). Record your salary to keep the figures right.`, '#/income');

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

/** Chits the user hosts: dues still to collect from members (opens Host a Chit). */
function hostedDuesHtml(h) {
    const due = Number(h.pendingDues);
    return `<a class="hc-dash" href="#/host-chits" title="Chits you run as the organiser">${icon('hand-coins')}
        <b>Pending chit dues</b><span class="hc-dash-amt ${due ? '' : 'clear'}">${due ? money(due) : 'none'}</span>
        <small>${h.pendingCount} installment${h.pendingCount === 1 ? '' : 's'} to collect · ${h.running} hosted chit${h.running === 1 ? '' : 's'}
            · collected this month ${moneyShort(h.collectedThisMonth)} of ${moneyShort(h.expectedThisMonth)}${h.nextDueDate ? ` · next due ${shortDate(h.nextDueDate)}` : ''}</small>
        ${icon('chevron-right', 'chev')}</a>`;
}
