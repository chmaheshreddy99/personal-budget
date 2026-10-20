/**
 * The businesses on the dashboard: a band with one card per business the organization runs (Host a Chit, Construction,
 * Brick Management), and the Brick Management panels (production against deliveries by week, profit by month, stock
 * by brick type, raw material cover, the order pipeline and the trips coming up). Each shows only when the section
 * is shared with the user.
 */
import { api } from '../core/api.js';
import { hasFeature } from '../core/store.js';
import { panel, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, monthLabel, shortDate, percent } from '../core/format.js';
import { barChart, legend } from '../core/charts.js';

const n = v => Number(v || 0);
const count = v => n(v).toLocaleString('en-IN');

/** What the dashboard needs of the businesses (each only when shared; a failure leaves it out). */
export async function loadBusinesses() {
    const [bricks, construction] = await Promise.all([
        hasFeature('BRICKS') ? api.get('/bricks/dashboard').catch(() => null) : null,
        hasFeature('CONSTRUCTION') ? api.get('/construction').catch(() => null) : null,
    ]);
    return { bricks, construction };
}

/** The band of business cards (nothing when the organization runs no business). */
export function businessBandHtml({ bricks, construction }, hosted) {
    const cards = [];
    if (hasFeature('HOST_CHITS') && hosted) {
        const due = n(hosted.pendingDues);
        cards.push(card('host-chits', 'hand-coins', 'Host a Chit', `${hosted.running} running`, [
            ['Dues to collect', due ? money(due) : 'none', due ? 'warn' : 'good'],
            ['Collected this month', `${moneyShort(hosted.collectedThisMonth)} of ${moneyShort(hosted.expectedThisMonth)}`],
            ['Next due', hosted.nextDueDate ? shortDate(hosted.nextDueDate) : '—'],
        ], 'hc'));
    }
    if (hasFeature('CONSTRUCTION') && construction) {
        const running = (construction.projects || []).filter(p => p.status !== 'CLOSED');
        cards.push(card('construction', 'hard-hat', 'Construction', `${running.length} project${running.length === 1 ? '' : 's'} running`, [
            ['Received', moneyShort(construction.received)],
            ['Spent', moneyShort(construction.costs)],
            ['Projects', String((construction.projects || []).length)],
        ], 'cn'));
    }
    if (hasFeature('BRICKS') && bricks) {
        const k = bricks.kpis;
        cards.push(card('bricks', 'brick', 'Brick Management', `${count(k.producedMonth)} made this month`, [
            ['Sales this month', moneyShort(k.salesMonth)],
            ['In the yard', `${count(k.inYard)} bricks`],
            ['Open orders', `${k.openOrders}${k.onTheWay ? ` · ${k.onTheWay} on the way` : ''}`],
            ['To collect', k.receivable ? moneyShort(k.receivable) : 'none', n(k.receivable) ? 'warn' : 'good'],
        ], 'bk'));
    }
    if (!cards.length) return '';
    return `<div class="biz-band">${cards.join('')}</div>`;
}

function card(path, iconName, title, sub, facts, tone) {
    return `<a class="biz-tile ${tone}" href="#/${path}">
        <span class="biz-tile-ico">${icon(iconName)}</span>
        <div class="biz-tile-head"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
        <dl>${facts.map(([l, v, t]) => `<div class="${t || ''}"><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${icon('chevron-right', 'chev')}</a>`;
}

// ===================================================================== the brick panels

/** The brick panel bodies, keyed by widget id (see prefs.js); each takes the brick dashboard. */
export const BRICK_PANELS = {
    brickflow: (b, label) => panel({ title: label, iconName: 'factory', sub: 'good bricks made and delivered, by week', cls: 'p-bkflow', bodyClass: 'chart',
        actions: link('bricks/production'),
        body: b && b.weeks.some(w => w.produced || w.delivered)
            ? `<div class="chart-wrap">${legend([{ label: 'Made' }, { label: 'Delivered' }])}<div class="chart" id="bk-flow"></div></div>
               <div class="bk-mini-kpis">${mini('Today', count(b.kpis.producedToday))}${mini('7 days', count(b.kpis.producedWeek))}${mini('This month', count(b.kpis.producedMonth))}</div>`
            : emptyState('No batches yet: record one on Brick Management', 'factory') }),
    brickpl: (b, label) => {
        const m = b?.months?.at(-1);
        return panel({ title: label, iconName: 'trending', sub: 'sales against costs, by month', cls: 'p-bkpl', bodyClass: 'chart',
            actions: `<a class="btn sm ghost icon" href="#/reports/bricks" title="Brick business report">${icon('chevron-right')}</a>`,
            body: b && b.months.some(x => n(x.revenue) || n(x.materials) || n(x.wages) || n(x.expenses))
                ? `<div class="chart-wrap">${legend([{ label: 'Sales' }, { label: 'Costs' }])}<div class="chart" id="bk-pl"></div></div>
                   <div class="bk-mini-kpis">${mini('Profit this month', money(m.profit), n(m.profit) < 0 ? 'neg' : 'pos')}${mini('Margin', m.margin === null ? '—' : percent(m.margin))}${mini('Received', moneyShort(b.kpis.receiptsMonth))}</div>`
                : emptyState('Sales and costs show here once there are deliveries', 'trending') });
    },
    brickstock: (b, label) => panel({ title: label, iconName: 'layers', sub: 'in the yard, by brick type', cls: 'p-bkstock', actions: link('bricks/production'),
        body: b && b.stock.length ? stockHtml(b.stock) : emptyState('No brick types yet', 'layers') }),
    brickmat: (b, label) => panel({ title: label, iconName: 'box', sub: 'raw material left and how long it lasts', cls: 'p-bkmat', actions: link('bricks/materials'),
        body: b && b.materials.length ? materialsHtml(b.materials) : emptyState('No raw materials yet', 'box') }),
    brickorders: (b, label) => panel({ title: label, iconName: 'truck', sub: 'orders by stage, trips coming up', cls: 'p-bkorders', actions: link('bricks/sales'),
        body: b ? ordersHtml(b) : emptyState('No orders yet', 'truck') }),
};

const link = path => `<a class="btn sm ghost icon" href="#/${path}" title="Open">${icon('chevron-right')}</a>`;
const mini = (label, value, tone = '') => `<div><span>${esc(label)}</span><b class="${tone}">${esc(value)}</b></div>`;

/** Each type: ready, curing and booked as one bar (the booked part marked over what is in the yard). */
export function stockHtml(stock) {
    const max = Math.max(1, ...stock.map(s => Math.max(s.inYard, s.booked)));
    return `<div class="bk-stock">${stock.map(s => {
        const ready = Math.max(0, s.ready), curing = Math.max(0, s.curing);
        const short = s.available < 0;
        return `<div class="bk-stock-row" title="${esc(`${s.name}: ${count(s.inYard)} in the yard (${count(ready)} ready, ${count(curing)} curing), ${count(s.booked)} booked for orders`)}">
            <div class="bk-stock-name"><b>${esc(s.name)}</b>
                <span class="${short ? 'neg' : 'muted'}">${short ? `short ${count(-s.available)}` : `${count(s.available)} free`}</span></div>
            <div class="bk-bar"><i class="ready" style="width:${(ready / max) * 100}%"></i><i class="curing" style="width:${(curing / max) * 100}%"></i>
                ${s.booked ? `<em class="booked" style="left:${Math.min(100, (s.booked / max) * 100)}%" title="Booked: ${count(s.booked)}"></em>` : ''}</div>
            <div class="bk-stock-figs"><span>${count(ready)} ready</span>${curing ? `<span>${count(curing)} curing</span>` : ''}<span>${count(s.booked)} booked</span></div>
        </div>`;
    }).join('')}
    <div class="bk-stock-key"><span><i class="ready"></i>Ready</span><span><i class="curing"></i>Curing</span><span><i class="booked"></i>Booked for orders</span></div></div>`;
}

/** Each material: what is left and the days it lasts at the recent rate, with a status label (never colour alone). */
export function materialsHtml(list) {
    return `<div class="bk-mats">${list.map(m => {
        const days = m.daysLeft;
        const state = m.low ? ['critical', 'Low'] : days !== null && days <= 7 ? ['warning', 'Order soon'] : ['good', 'OK'];
        const fill = days === null ? 100 : Math.min(100, (days / 30) * 100);
        return `<div class="bk-mat"><div class="bk-mat-head"><b>${esc(m.name)}</b><span>${esc(Number(m.stock).toLocaleString('en-IN', { maximumFractionDigits: 2 }))} ${esc(m.unit)}</span></div>
            <div class="bk-meter ${state[0]}"><i style="width:${fill}%"></i></div>
            <div class="bk-mat-foot"><span class="badge sm ${state[0] === 'good' ? 'good' : state[0]}">${icon(state[0] === 'good' ? 'check' : 'alert')}${state[1]}</span>
                <small class="muted">${days === null ? 'no use recorded yet' : `${days} day${days === 1 ? '' : 's'} left`}</small></div></div>`;
    }).join('')}</div>`;
}

const STAGES = [['RECEIVED', 'Received', 'file-text'], ['LOADING', 'Loading', 'layers'], ['DISPATCHED', 'Dispatched', 'send'], ['IN_TRANSIT', 'On the way', 'truck'],
    ['PART_DELIVERED', 'Part delivered', 'split'], ['DELIVERED', 'Delivered (30 d)', 'check-circle']];

function ordersHtml(b) {
    const p = b.pipeline || {};
    const up = b.upcoming || [];
    return `<div class="bk-pipe">${STAGES.map(([k, l, ic]) => `<div class="bk-pipe-step ${p[k] ? 'has' : ''}">${icon(ic)}<b>${p[k] || 0}</b><small>${l}</small></div>`).join('')}</div>
        ${up.length ? `<div class="list bk-up">${up.map(t => `<a class="list-item clickable" href="#/bricks/sales/${t.orderId}">
            <span class="chip-icon sm ${t.late ? 'coral' : ''}">${icon(t.status === 'PLANNED' ? 'calendar' : 'truck')}</span>
            <div class="grow min-0"><div class="title ellipsis">${esc(t.customer)} · trip ${t.tripNo}</div>
                <div class="meta">${esc(t.orderNo)} · ${count(t.bricks)} bricks${t.vehicle ? ` · ${esc(t.vehicle)}` : ''}</div></div>
            <span class="small ${t.late ? 'neg' : 'muted'}">${t.status === 'PLANNED' ? (t.scheduledOn ? shortDate(t.scheduledOn) : 'not set') : esc(t.status === 'IN_TRANSIT' ? 'on the way' : t.status.toLowerCase())}</span></a>`).join('')}</div>`
            : '<p class="small muted" style="margin:10px 2px 0">No trips waiting.</p>'}`;
}

/** Draws the charts of the brick panels that are on the page. */
export function drawBrickCharts(container, b) {
    if (!b) return;
    const el = id => container.querySelector(id);
    if (el('#bk-flow')) barChart(el('#bk-flow'), { labels: b.weeks.map(w => w.label), format: v => count(v),
        series: [{ name: 'Made', values: b.weeks.map(w => w.produced) }, { name: 'Delivered', values: b.weeks.map(w => w.delivered) }] });
    if (el('#bk-pl')) barChart(el('#bk-pl'), { labels: b.months.map(m => m.month), labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Sales', values: b.months.map(m => n(m.revenue)) },
            { name: 'Costs', values: b.months.map(m => n(m.materials) + n(m.wages) + n(m.expenses)) }] });
}

/** The brick business's insights, for the dashboard's insight ribbon. */
export function brickInsights(b) {
    return (b?.insights || []).filter(i => i.tone !== 'good' || b.insights.length === 1).slice(0, 3);
}
