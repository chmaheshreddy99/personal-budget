/**
 * The Brick Management reports, from /api/bricks/report for the period:
 *   Brick business    profit and loss, cost and price a brick, sales against costs by month, insights
 *   Brick production  bricks made by type and team, damage, raw material used per 1,000 bricks, expenses by head, batches
 *   Brick sales       sales by type (discount below MRP), customers, orders, deliveries by vehicle
 *   Brick team pay    what each team and person was paid, advances given and still owed, work not paid yet
 * Each returns its table rows for Excel / PDF / CSV export.
 */
import { api } from '../core/api.js';
import { panel, table, esc, stat, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, date } from '../core/format.js';
import { barChart, donutChart, legend, foldOthers, seriesColor } from '../core/charts.js';

const n = v => Number(v || 0);
const count = v => n(v).toLocaleString('en-IN');
const qty = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const pct = v => v === null || v === undefined ? '—' : percent(v);

let cache = null;
async function load(period) {
    const key = `${period.from}|${period.to}`;
    if (cache?.key !== key) cache = { key, data: await api.get('/bricks/report', { from: period.from, to: period.to }) };
    return cache.data;
}

function insightsHtml(list) {
    return `<div class="bk-insights">${list.map(i => `<div class="bk-insight ${esc(i.tone)}"><span>${icon(i.icon)}</span>
        <div><b>${esc(i.title)}</b><small>${esc(i.text)}</small></div></div>`).join('') || emptyState('Nothing to point out yet', 'bulb')}</div>`;
}

// ===================================================================== business

export async function brickBusinessReport(el, _toolbar, period) {
    cache = null;
    const r = await load(period);
    const s = r.summary;
    el.className = 'report-content bk-report';
    const costs = [['Raw material', s.materials], ['Production wages', s.wages], ['Delivery & handling wages', s.handlingWages],
        ['Salaries & wages', s.salaries], ['Production expenses', s.expenses]].filter(([, v]) => n(v));
    const rows = [['Sales of bricks', s.sales, 'in'], ['Delivery charges', s.deliveryIncome, 'in'], ['Loading & unloading charges', s.handlingIncome, 'in'],
        ...costs.map(([l, v]) => [l, v, 'out'])];
    el.innerHTML = `
        <div class="stat-strip bk-span-all">
            ${stat('Sales', money(s.revenue), `${count(s.delivered)} bricks delivered in ${s.trips} trip${s.trips === 1 ? '' : 's'}`)}
            ${stat('Costs', money(s.totalCost), `raw material ${moneyShort(s.materials)} · wages ${moneyShort(n(s.wages) + n(s.handlingWages) + n(s.salaries))}`)}
            ${stat(n(s.profit) >= 0 ? 'Profit' : 'Loss', `<span class="${n(s.profit) >= 0 ? 'pos' : 'neg'}">${money(Math.abs(n(s.profit)))}</span>`, s.margin === null ? 'no sales yet' : `margin ${pct(s.margin)}`)}
            ${stat('Cost a brick', s.costPerBrick === null ? '—' : money(s.costPerBrick, { decimals: 2 }), `${count(s.produced - s.damaged)} good bricks made`)}
            ${stat('Price a brick', s.pricePerBrick === null ? '—' : money(s.pricePerBrick, { decimals: 2 }), `discount ${pct(s.discountPercent)} of MRP`)}
            ${stat('Received', money(s.received), s.receivable ? `${money(s.receivable)} still to collect` : 'nothing to collect')}
        </div>
        ${panel({ title: 'Sales and costs by month', iconName: 'report', cls: 'bk-span-2', bodyClass: 'chart',
            body: r.months.some(m => n(m.revenue) || n(m.materials) || n(m.wages) || n(m.expenses))
                ? `<div class="chart-wrap">${legend([{ label: 'Sales' }, { label: 'Costs' }])}<div class="chart" id="bk-r-pl"></div></div>` : emptyState('No sales or costs in this period', 'report') })}
        ${panel({ title: 'Where the money went', iconName: 'pie', bodyClass: 'chart',
            body: costs.length ? `<div class="donut-wrap"><div class="chart" id="bk-r-cost"></div><div class="donut-legend" id="bk-r-cost-legend"></div></div>` : emptyState('No costs in this period', 'pie') })}
        ${panel({ title: 'Profit and loss', iconName: 'scale', bodyClass: 'flush', body: `<table class="grid compact bk-pl">
            <tbody>${rows.map(([l, v, k]) => `<tr><td>${esc(l)}</td><td class="r ${k === 'in' ? 'pos' : 'neg'}">${k === 'out' ? '−' : ''}${money(v)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td><b>${n(s.profit) >= 0 ? 'Profit' : 'Loss'}</b></td><td class="r"><b class="${n(s.profit) >= 0 ? 'pos' : 'neg'}">${money(s.profit)}</b></td></tr></tfoot></table>` })}
        ${panel({ title: 'Month by month', iconName: 'calendar', cls: 'bk-span-2', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Month', render: m => monthLabel(m.month) },
            { label: 'Made', align: 'r', render: m => count(m.produced) },
            { label: 'Delivered', align: 'r', render: m => count(m.delivered) },
            { label: 'Sales', align: 'r', render: m => money(m.revenue) },
            { label: 'Raw material', align: 'r', render: m => money(m.materials) },
            { label: 'Wages', align: 'r', render: m => money(m.wages) },
            { label: 'Expenses', align: 'r', render: m => money(m.expenses) },
            { label: 'Profit', align: 'r', render: m => `<b class="${n(m.profit) >= 0 ? 'pos' : 'neg'}">${money(m.profit)}</b>` },
            { label: 'Margin', align: 'r', render: m => pct(m.margin) },
        ], r.months, { compact: true })}</div>` })}
        ${panel({ title: 'Insights', iconName: 'sparkles', body: insightsHtml(r.insights) })}`;
    const c = id => el.querySelector(id);
    if (c('#bk-r-pl')) barChart(c('#bk-r-pl'), { labels: r.months.map(m => m.month), labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Sales', values: r.months.map(m => n(m.revenue)) }, { name: 'Costs', values: r.months.map(m => n(m.materials) + n(m.wages) + n(m.expenses)) }] });
    if (c('#bk-r-cost')) {
        const items = costs.map(([label, v]) => ({ label, value: n(v) }));
        donutChart(c('#bk-r-cost'), { items, format: v => money(v), centerValue: moneyShort(s.totalCost), centerLabel: 'costs' });
        c('#bk-r-cost-legend').innerHTML = items.map((it, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
            <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('');
    }
    return () => [['Month', 'Made', 'Delivered', 'Sales', 'Raw material', 'Wages', 'Expenses', 'Profit', 'Margin %'],
        ...r.months.map(m => [m.month, m.produced, m.delivered, m.revenue, m.materials, m.wages, m.expenses, m.profit, m.margin])];
}

// ===================================================================== production

export async function brickProductionReport(el, _toolbar, period) {
    cache = null;
    const r = await load(period);
    const s = r.summary;
    el.className = 'report-content bk-report';
    el.innerHTML = `
        <div class="stat-strip bk-span-all">
            ${stat('Bricks made', count(s.produced), `${r.batches.length} batch${r.batches.length === 1 ? '' : 'es'}`)}
            ${stat('Damaged', count(s.damaged), `${pct(s.damagePercent)} of what was made`)}
            ${stat('Good bricks', count(s.produced - s.damaged))}
            ${stat('Raw material', money(s.materials), 'bought in the period')}
            ${stat('Production wages', money(s.wages))}
            ${stat('Cost a brick', s.costPerBrick === null ? '—' : money(s.costPerBrick, { decimals: 2 }), 'material, wages and expenses')}
        </div>
        ${panel({ title: 'Made by brick type', iconName: 'layers', cls: 'bk-span-2', bodyClass: 'chart',
            body: r.types.some(t => t.produced) ? `<div class="chart-wrap">${legend([{ label: 'Good' }, { label: 'Damaged' }])}<div class="chart" id="bk-r-types"></div></div>` : emptyState('No batches in this period', 'factory') })}
        ${panel({ title: 'By team', iconName: 'users', bodyClass: 'flush', body: table([
            { label: 'Team', render: t => `<b>${esc(t.name)}</b>` },
            { label: 'Batches', align: 'r', render: t => t.batches },
            { label: 'Bricks', align: 'r', render: t => count(t.bricks) },
            { label: 'Damage', align: 'r', render: t => t.bricks ? percent((t.damaged / t.bricks) * 100) : '—' },
            { label: 'Labour', align: 'r', render: t => money(t.labour) },
        ], r.teams, { compact: true, empty: 'No team recorded on the batches' }) })}
        ${panel({ title: 'Raw material', iconName: 'box', cls: 'bk-span-2', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Material', render: m => `<b>${esc(m.name)}</b>` },
            { label: 'Used', align: 'r', render: m => `${qty(m.consumed)} ${esc(m.unit)}` },
            { label: 'Per 1,000 bricks', align: 'r', render: m => m.perThousand === null ? '—' : `${qty(m.perThousand)} ${esc(m.unit)}` },
            { label: 'Bought', align: 'r', render: m => `${qty(m.bought)} ${esc(m.unit)}` },
            { label: 'Spent', align: 'r', render: m => money(m.spent) },
            { label: 'Average rate', align: 'r', render: m => m.avgRate === null ? '—' : money(m.avgRate, { decimals: 2 }) },
            { label: 'In stock now', align: 'r', render: m => m.stock === null ? '—' : `${qty(m.stock)} ${esc(m.unit)}` },
        ], r.materials, { compact: true, empty: 'No raw material used or bought' })}</div>` })}
        ${panel({ title: 'Expenses by head', iconName: 'receipt', bodyClass: 'flush', body: table([
            { label: 'Head', render: h => esc(h.name) },
            { label: 'Bills', align: 'r', render: h => h.count },
            { label: 'Amount', align: 'r', render: h => money(h.amount) },
        ], r.expenseHeads, { compact: true, empty: 'No production expenses' }) })}
        ${panel({ title: 'Batches', iconName: 'list', cls: 'bk-span-all', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Batch', render: b => `<a href="#/bricks/production/${b.batch.id}"><b>${esc(b.batch.batchNo)}</b></a>` },
            { label: 'Date', render: b => date(b.batch.producedOn) },
            { label: 'Team', render: b => esc(b.teamName || '—') },
            { label: 'Bricks', render: b => b.items.map(i => `${esc(i.name)} ${count(i.quantity)}`).join(', ') },
            { label: 'Damaged', align: 'r', render: b => count(b.damaged) },
            { label: 'Labour', align: 'r', render: b => money(b.labour) },
            { label: 'Paid', render: b => b.paidOn ? `<span class="badge good">${icon('check')}${esc(b.paidOn)}</span>` : b.earningId ? '<span class="badge warning">Due</span>' : '<span class="muted">—</span>' },
        ], r.batches, { compact: true })}</div>` })}`;
    const c = el.querySelector('#bk-r-types');
    const types = r.types.filter(t => t.produced);
    if (c) barChart(c, { labels: types.map(t => t.name), format: v => count(v),
        series: [{ name: 'Good', values: types.map(t => t.produced - t.damaged) }, { name: 'Damaged', values: types.map(t => t.damaged) }] });
    return () => [['Batch', 'Date', 'Team', 'Bricks', 'Damaged', 'Labour', 'Paid on slip'],
        ...r.batches.map(b => [b.batch.batchNo, b.batch.producedOn, b.teamName || '', b.total, b.damaged, b.labour, b.paidOn || ''])];
}

// ===================================================================== sales

export async function brickSalesReport(el, _toolbar, period) {
    cache = null;
    const r = await load(period);
    const s = r.summary;
    el.className = 'report-content bk-report';
    const live = r.orders.filter(o => o.status !== 'CANCELLED');
    el.innerHTML = `
        <div class="stat-strip bk-span-all">
            ${stat('Orders', String(s.orders), `${count(live.reduce((t, o) => t + o.quantity, 0))} bricks ordered`)}
            ${stat('Delivered', count(s.delivered), `${s.trips} trip${s.trips === 1 ? '' : 's'}`)}
            ${stat('Sales', money(s.revenue), `bricks ${moneyShort(s.sales)} · delivery ${moneyShort(s.deliveryIncome)}`)}
            ${stat('Discount given', money(s.discountGiven), `${pct(s.discountPercent)} below MRP`)}
            ${stat('Received', money(s.received))}
            ${stat('To collect', money(s.receivable), 'for bricks delivered')}
        </div>
        ${panel({ title: 'Sales by brick type', iconName: 'layers', cls: 'bk-span-2', bodyClass: 'flush', body: table([
            { label: 'Type', render: t => `<i class="bk-swatch" style="background:${esc(t.color || '#b4532a')}"></i><b>${esc(t.name)}</b>` },
            { label: 'Delivered', align: 'r', render: t => count(t.delivered) },
            { label: 'Sales', align: 'r', render: t => money(t.sales) },
            { label: 'MRP', align: 'r', render: t => t.mrp === null ? '—' : money(t.mrp, { decimals: 2 }) },
            { label: 'Average price', align: 'r', render: t => t.avgPrice === null ? '—' : money(t.avgPrice, { decimals: 2 }) },
            { label: 'Discount', align: 'r', render: t => money(t.discount) },
        ], r.types.filter(t => t.delivered), { compact: true, empty: 'Nothing delivered in this period' }) })}
        ${panel({ title: 'Deliveries by vehicle', iconName: 'truck', bodyClass: 'flush', body: table([
            { label: 'Vehicle', render: v => `<b>${esc(v.vehicle)}</b>` },
            { label: 'Trips', align: 'r', render: v => v.trips },
            { label: 'Bricks', align: 'r', render: v => count(v.bricks) },
            { label: 'Driver incentives', align: 'r', render: v => money(v.incentives) },
        ], r.vehicles, { compact: true, empty: 'No deliveries' }) })}
        ${panel({ title: 'Top customers', iconName: 'users', bodyClass: 'chart',
            body: r.customers.length ? `<div class="donut-wrap"><div class="chart" id="bk-r-cust"></div><div class="donut-legend" id="bk-r-cust-legend"></div></div>` : emptyState('No orders in this period', 'users') })}
        ${panel({ title: 'Customers', iconName: 'user', cls: 'bk-span-2', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Customer', render: c => `<b>${esc(c.name)}</b><div class="small muted">${esc(c.phone || '')}</div>` },
            { label: 'Orders', align: 'r', render: c => c.orders },
            { label: 'Bricks', align: 'r', render: c => count(c.bricks) },
            { label: 'Value', align: 'r', render: c => money(c.value) },
            { label: 'Balance', align: 'r', render: c => n(c.balance) > 0 ? `<b class="neg">${money(c.balance)}</b>` : money(c.balance) },
        ], r.customers, { compact: true })}</div>` })}
        ${panel({ title: 'Orders', iconName: 'list', cls: 'bk-span-all', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Order', render: o => `<a href="#/bricks/sales/${o.id}"><b>${esc(o.orderNo)}</b></a>` },
            { label: 'Date', render: o => date(o.orderDate) },
            { label: 'Customer', render: o => esc(o.customerName) },
            { label: 'Bricks', align: 'r', render: o => count(o.quantity) },
            { label: 'Delivered', align: 'r', render: o => count(o.delivered) },
            { label: 'Total', align: 'r', render: o => money(o.total) },
            { label: 'Paid', align: 'r', render: o => money(o.paid) },
            { label: 'Balance', align: 'r', render: o => money(o.balance) },
            { label: 'Status', render: o => `<span class="bk-status ${esc(o.status)}">${esc(o.statusLabel)}</span>` },
        ], r.orders, { compact: true })}</div>` })}`;
    const c = el.querySelector('#bk-r-cust');
    if (c) {
        const items = foldOthers(r.customers.map(x => ({ label: x.name, value: n(x.value) })), 6);
        donutChart(c, { items, format: v => money(v), centerValue: moneyShort(items.reduce((t, x) => t + x.value, 0)), centerLabel: 'ordered' });
        el.querySelector('#bk-r-cust-legend').innerHTML = items.map((it, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
            <span class="ellipsis">${esc(it.label)}</span><b>${moneyShort(it.value)}</b></div>`).join('');
    }
    return () => [['Order', 'Date', 'Customer', 'Mobile', 'Bricks', 'Delivered', 'Total', 'Paid', 'Balance', 'Status'],
        ...r.orders.map(o => [o.orderNo, o.orderDate, o.customerName, o.customerPhone || '', o.quantity, o.delivered, o.total, o.paid, o.balance, o.statusLabel])];
}

// ===================================================================== team pay

export async function brickPayrollReport(el, _toolbar, period) {
    cache = null;
    const r = await load(period);
    el.className = 'report-content bk-report';
    const sum = k => r.pay.reduce((t, p) => t + n(p[k]), 0);
    el.innerHTML = `
        <div class="stat-strip bk-span-all">
            ${stat('Paid', money(sum('net')), `${r.pay.reduce((t, p) => t + p.slips, 0)} payment slips`)}
            ${stat('Earned', money(sum('gross')), 'before advances taken back')}
            ${stat('Advances taken back', money(sum('deductions')))}
            ${stat('Advances given', money(sum('advancesGiven')), 'in the period')}
            ${stat('Advances still owed', money(sum('outstanding')))}
            ${stat('Work not paid yet', money(sum('unpaid')))}
        </div>
        ${panel({ title: 'Paid by team and person', iconName: 'users', cls: 'bk-span-2', bodyClass: 'chart',
            body: r.pay.some(p => n(p.net)) ? `<div class="chart-wrap"><div class="chart" id="bk-r-pay"></div></div>` : emptyState('No payments in this period', 'users') })}
        ${panel({ title: 'Team pay', iconName: 'list', cls: 'bk-span-all', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Team / person', render: p => `<b>${esc(p.name)}</b><div class="small muted">${esc(String(p.role || '').toLowerCase().replace(/_/g, ' '))}</div>` },
            { label: 'Slips', align: 'r', render: p => p.slips },
            { label: 'Earned', align: 'r', render: p => money(p.gross) },
            { label: 'Advance taken back', align: 'r', render: p => money(p.deductions) },
            { label: 'Paid', align: 'r', render: p => `<b>${money(p.net)}</b>` },
            { label: 'Advances given', align: 'r', render: p => money(p.advancesGiven) },
            { label: 'Advance owed', align: 'r', render: p => n(p.outstanding) ? `<span class="neg">${money(p.outstanding)}</span>` : '—' },
            { label: 'Not paid yet', align: 'r', render: p => n(p.unpaid) ? `<span class="warn">${money(p.unpaid)}</span>` : '—' },
        ], r.pay, { compact: true, empty: 'No team pay yet' })}</div>` })}`;
    const c = el.querySelector('#bk-r-pay');
    const paid = r.pay.filter(p => n(p.net)).slice(0, 12);
    if (c) barChart(c, { labels: paid.map(p => p.name), format: moneyShort, series: [{ name: 'Paid', values: paid.map(p => n(p.net)) }] });
    return () => [['Team / person', 'Role', 'Slips', 'Earned', 'Advance taken back', 'Paid', 'Advances given', 'Advance owed', 'Not paid yet'],
        ...r.pay.map(p => [p.name, p.role, p.slips, p.gross, p.deductions, p.net, p.advancesGiven, p.outstanding, p.unpaid])];
}
