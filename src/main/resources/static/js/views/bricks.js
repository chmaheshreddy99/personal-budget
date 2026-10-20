/**
 * Brick Management: the brick business from production to delivery, its sections in a menu on the left (as Reports has).
 *
 *   #/bricks/overview          today, stock, raw material cover, orders, profit; what needs attention
 *   #/bricks/production[/<id>] batches (bricks by type, the team, its pay, the raw material used), with stats beside
 *   #/bricks/materials[/<id>]  raw materials in a side list; the one picked: stock, purchases, use batch by batch
 *   #/bricks/expenses          other production expenses, by head
 *   #/bricks/sales[/<id>]      orders in a side list (search, status, dates); the order: delivery, trips, bill, payments
 *   #/bricks/team              teams, people and vehicles in a side list; the one picked: its work and pay, or its trips
 *   #/bricks/payments          weekly and monthly pay due, advances owed, every slip made
 *   #/bricks/accounts[/<id>]   the brick book's accounts (and mine that brick money went through), statements
 *   #/bricks/setup             brick types and MRP, raw materials, pricing models, vehicles, charges and documents
 * Every list is a column of one-line entries that open to their details.
 */
import { api } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { esc, toast, panel, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, dateTime, isoDate, firstOfMonth, percent, shortDate } from '../core/format.js';
import { kindChip } from '../core/entry-kind.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { sparkline } from '../core/charts.js';
import { signatureSvg, sealSvg } from '../core/bond.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { BRICK_PANELS, drawBrickCharts, stockHtml } from '../components/brick-dash.js';
import { loadMeta, setMeta, manage, num, count, qty, plural, roleName, swatch, orderBadge, confirmDelete, weekOf, monthOf, dayLabel, today,
    rowsHtml, bindRows, initials, roleLook, categoryOf } from '../components/brick-common.js';
import { openType, openMaterial, openModel, openVehicle, openSettings, openBatch, openPurchase, openExpense, openResource, openBookAccount, openTransfer } from '../components/brick-forms.js';
import { openOrder, orderHtml, bindOrder } from '../components/brick-orders.js';
import { openSlip, openAdvance, openSlipView } from '../components/brick-pay.js';

const SECTIONS = [
    { key: 'overview', label: 'Overview', iconName: 'dashboard', note: 'Today, stock, orders, profit', group: 'The yard' },
    { key: 'production', label: 'Production', iconName: 'factory', note: 'Batches, bricks made, the team’s pay' },
    { key: 'materials', label: 'Raw material', iconName: 'box', note: 'Stock, purchases, use per batch' },
    { key: 'expenses', label: 'Expenses', iconName: 'receipt', note: 'Diesel, power, repairs…' },
    { key: 'sales', label: 'Sales & delivery', iconName: 'truck', note: 'Orders, trips, bills, invoices', group: 'Customers', bare: true },
    { key: 'team', label: 'Team', iconName: 'users', note: 'Teams, labour, staff, vehicles', group: 'People & money' },
    { key: 'payments', label: 'Payments', iconName: 'hand-coins', note: 'Weekly and monthly slips, advances' },
    { key: 'accounts', label: 'Accounts', iconName: 'wallet', note: 'The brick book and statements' },
    { key: 'setup', label: 'Set-up', iconName: 'settings', note: 'Types, MRP, rates, charges, documents', group: 'Settings' },
];

const view = { orderFilter: 'open', orderQ: '', orderDates: 'any', orderBy: 'order', orderFrom: '', orderTo: '',
    cycle: 'WEEKLY', back: 0, slipFilter: '', range: '30', from: '', to: '', team: '', batchQ: '', material: null, head: null,
    teamShow: 'all', teamQ: '', teamSel: null, txFilter: 'all',
    stmt: { from: firstOfMonth(-2), to: isoDate() } };

export async function render(container, params, isCurrent) {
    const active = SECTIONS.find(s => s.key === params[0]) || SECTIONS[0];
    const meta = await loadMeta(true);
    if (!isCurrent()) return;
    container.innerHTML = `
    <div class="page reports-page bk-page">
        ${panel({
            title: meta.settings.companyName || 'Brick Management', iconName: 'brick', cls: 'p-report-nav bk-nav',
            body: `<div class="list">${SECTIONS.map(s => `
                ${s.group ? `<div class="section-title report-nav-sep">${esc(s.group)}</div>` : ''}
                <a class="list-item clickable ${s.key === active.key ? 'selected' : ''}" href="#/bricks/${s.key}" title="${esc(s.label)} · ↑ ↓ to move">
                    <span class="chip-icon sm">${icon(s.iconName)}</span>
                    <div class="grow"><div class="title">${esc(s.label)}</div><div class="meta">${esc(s.note)}</div></div></a>`).join('')}</div>
                ${manage() ? `<div class="bk-nav-quick"><button class="btn sm" data-quick="batch">${icon('factory')}New batch</button>
                    <button class="btn sm primary" data-quick="order">${icon('cart')}New order</button></div>` : ''}`,
        })}
        <div class="report-area bk-area ${active.bare ? 'bare' : ''}">
            ${active.bare ? '' : `<div class="page-toolbar glass report-toolbar bk-toolbar"><h2 class="page-title">${icon(active.iconName)} ${esc(active.label)}</h2>
                <span class="spacer"></span><div class="row wrap bk-tools" id="bk-tools"></div></div>`}
            <div class="bk-content bk-sec-${active.key}" id="bk-body"><div class="loading"><div class="spinner"></div></div></div>
        </div>
    </div>`;
    const nav = container.querySelector('.bk-nav');
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
    const body = container.querySelector('#bk-body');
    // a section without the toolbar (sales) keeps its tools in its own side list
    const tools = container.querySelector('#bk-tools') || document.createElement('div');
    bindRows(body);
    const reload = () => render(container, [active.key, ...params.slice(1)], isCurrent);
    nav.querySelector('.bk-nav-quick')?.addEventListener('click', e => {
        const q = e.target.closest('[data-quick]')?.dataset.quick;
        if (q === 'batch') openBatch(null, (b, msg) => { toast(msg); location.hash = `#/bricks/production/${b.batch.id}`; reload(); });
        if (q === 'order') openOrder(null, (o, msg) => { toast(msg); location.hash = `#/bricks/sales/${o.order.id}`; });
    });
    const draw = { overview, production, materials, expenses, sales, team, payments, accounts, setup }[active.key];
    try {
        await draw({ body, tools, params: params.slice(1), reload, meta, isCurrent });
    } catch (e) {
        body.innerHTML = emptyState(e.message, 'alert');
    }
}

const done = (reload, message) => (_, msg) => { if (msg || message) toast(msg || message); invalidateAccounts(); reload(); };
const chips = (name, list, current) => `<div class="seg-chips sm">${list.map(([k, l]) => `<button class="seg-chip ${String(current) === String(k) ? 'active' : ''}" data-${name}="${k}">${l}</button>`).join('')}</div>`;
const tile = (label, value, note = '', tone = '') => `<div class="bk-tile ${tone}"><span>${esc(label)}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
/** A thin figure: label and value on one line, a note after. */
const chip = (label, value, note = '', tone = '', ic = '') => `<div class="bk-chipfig ${tone}">${ic ? icon(ic) : ''}<span>${esc(label)}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;
const facts = list => `<dl class="bk-dl">${list.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const actions = list => `<span class="bk-acts">${list.filter(Boolean).join('')}</span>`;
const iconBtn = (data, name, title, cls = '') => `<button type="button" class="btn sm ghost icon ${cls}" ${data} title="${esc(title)}">${icon(name)}</button>`;
const sinceDays = d => d === 'all' ? null : isoDate(new Date(Date.now() - (Number(d) - 1) * 86400000));
const telOf = p => String(p || '').replace(/\D/g, '').slice(-10);
/** A card of the detail column: a small titled box (as the payout dialog's). */
const card = (title, iconName, inner, extra = '', cls = '') => `<div class="hc-pr-card bk-stat ${cls}"><div class="hc-pr-title">${icon(iconName)}${esc(title)}${extra ? `<small>${extra}</small>` : ''}</div>${inner}</div>`;
/** Bars as a small list: label, a bar and a value. */
const barList = (rows, empty = 'Nothing yet') => rows.length ? `<div class="bk-barlist">${rows.map(r => `<div title="${esc(r.title || '')}"><span class="ellipsis">${r.label}</span>
    <i><em style="width:${Math.max(2, r.pct)}%" class="${r.tone || ''}"></em></i><b>${r.value}</b></div>`).join('')}</div>` : `<p class="small muted">${esc(empty)}</p>`;
/** Inclusive date range from the range chips ('7', '30', '90', 'all') or a custom from / to. */
const rangeOf = () => view.range === 'custom' ? { from: view.from || null, to: view.to || null } : { from: sinceDays(view.range), to: null };
const inRange = (iso, r) => !!iso && (!r.from || iso >= r.from) && (!r.to || iso <= r.to);

// ===================================================================== overview

async function overview({ body, tools, meta }) {
    const b = await api.get('/bricks/dashboard');
    const k = b.kpis;
    const setupDone = meta.types.some(t => t.mrp !== null) && meta.vehicles.length && meta.resources.length;
    tools.innerHTML = `<span class="small muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>`;
    body.innerHTML = `
        ${setupDone || !manage() ? '' : `<div class="bk-getting-started">${icon('sparkles')}<div><b>Get started</b>
            <small>${[meta.types.some(t => t.mrp !== null) ? '' : '<a href="#/bricks/setup">set the MRP of your brick types</a>', meta.vehicles.length ? '' : '<a href="#/bricks/setup">add a vehicle</a>',
                meta.resources.length ? '' : '<a href="#/bricks/team">add your teams and drivers</a>'].filter(Boolean).join(' · ')}: then record batches and take orders.</small></div></div>`}
        <div class="bk-tiles">
            ${tile('Made this month', count(k.producedMonth), `today ${count(k.producedToday)} · 7 days ${count(k.producedWeek)}`)}
            ${tile('In the yard', count(k.inYard), `${count(k.ready)} ready · ${count(k.curing)} curing`, k.available < 0 ? 'warn' : '')}
            ${tile('Open orders', String(k.openOrders), `${count(k.pendingBricks)} bricks · ${k.onTheWay} on the way`)}
            ${tile('Sales this month', moneyShort(k.salesMonth), `profit <b class="${num(k.profitMonth) < 0 ? 'neg' : 'pos'}">${moneyShort(k.profitMonth)}</b>`)}
            ${tile('To collect', moneyShort(k.receivable), num(k.advancesHeld) ? `advances ${moneyShort(k.advancesHeld)}` : 'for bricks delivered', num(k.receivable) ? 'warn' : '')}
            ${tile('Wages due', moneyShort(k.wagesDue), `advances out ${moneyShort(k.advancesOutstanding)}`)}
            ${tile('Cash in the book', moneyShort(k.cashInBook), 'brick cash & bank', num(k.cashInBook) < 0 ? 'bad' : '')}
        </div>
        <div class="bk-insight-row">${b.insights.map(i => `<div class="bk-insight ${esc(i.tone)}"><span>${icon(i.icon)}</span><div><b>${esc(i.title)}</b><small>${esc(i.text)}</small></div></div>`).join('')}</div>
        <div class="dash-grid bk-grid">
            <div class="dash-cell" style="grid-column: span 6">${BRICK_PANELS.brickflow(b, 'Production & deliveries')}</div>
            <div class="dash-cell" style="grid-column: span 6">${BRICK_PANELS.brickpl(b, 'Sales & profit')}</div>
            <div class="dash-cell" style="grid-column: span 4">${BRICK_PANELS.brickstock(b, 'Stock in the yard')}</div>
            <div class="dash-cell" style="grid-column: span 4">${BRICK_PANELS.brickmat(b, 'Raw material cover')}</div>
            <div class="dash-cell" style="grid-column: span 4">${BRICK_PANELS.brickorders(b, 'Orders & trips')}</div>
        </div>`;
    drawBrickCharts(body, b);
}

// ===================================================================== production

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All'], ['custom', 'Dates…']];

async function production({ body, tools, params, reload, meta }) {
    const p = await api.get('/bricks/production');
    const r = rangeOf();
    const q = view.batchQ.trim().toLowerCase();
    const list = p.batches.filter(b => (!r.from && !r.to || inRange(b.batch.producedOn, r)) && (!view.team || String(b.batch.teamId) === view.team)
        && (!q || `${b.batch.batchNo} ${b.teamName || ''} ${b.batch.note || ''} ${b.items.map(i => i.name).join(' ')}`.toLowerCase().includes(q)));
    const made = list.reduce((s, b) => s + b.total, 0), dmg = list.reduce((s, b) => s + b.damaged, 0), labour = list.reduce((s, b) => s + num(b.labour), 0);
    const due = list.filter(b => b.earningId && !b.paidOn).reduce((s, b) => s + num(b.labour), 0);
    const teams = meta.resources.filter(x => p.batches.some(b => b.batch.teamId === x.id));
    const days = new Set(list.map(b => b.batch.producedOn)).size;
    const label = view.range === 'all' ? 'all time' : view.range === 'custom' ? `${view.from ? shortDate(view.from) : '…'} – ${view.to ? shortDate(view.to) : 'today'}` : `last ${view.range} days`;
    tools.innerHTML = manage() ? `<button class="btn sm primary" data-new>${icon('plus')}Batch</button>` : '';
    body.innerHTML = `
        <div class="bk-chipfigs">
            ${chip('Batches', String(list.length), label, '', 'factory')}
            ${chip('Made', count(made), `${count(made - dmg)} good`, '', 'layers')}
            ${chip('Damaged', count(dmg), made ? percent((dmg / made) * 100) : '—', made && dmg / made > 0.03 ? 'warn' : '', 'alert')}
            ${chip('A working day', count(days ? Math.round((made - dmg) / days) : 0), 'good bricks', '', 'calendar')}
            ${chip('Team earns', moneyShort(labour), made - dmg ? `₹${(labour / (made - dmg)).toFixed(2)}/brick` : '', '', 'hand-coins')}
            ${chip('Pay due', moneyShort(due), due ? 'on the next slip' : 'all paid', due ? 'warn' : '', 'clock')}
        </div>
        <div class="bk-fill bk-prod">
            ${panel({ title: 'Batches', iconName: 'factory', bodyClass: 'flush', cls: 'bk-list-panel bk-tall', sub: plural(list.length, 'batch', 'batches'),
                actions: `<div class="bk-filters">
                    <label class="search-box sm bk-search">${icon('search')}<input type="search" data-bq placeholder="Batch, team, note" value="${esc(view.batchQ)}"></label>
                    <select data-team class="bk-select"><option value="">Every team</option>${teams.map(t => `<option value="${t.id}" ${String(t.id) === view.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
                    ${chips('range', RANGES, view.range)}
                    ${view.range === 'custom' ? `<span class="bk-dates"><input type="date" data-from value="${esc(view.from)}" max="${today()}"><span>–</span><input type="date" data-to value="${esc(view.to)}" max="${today()}"></span>` : ''}
                </div>`,
                body: `<div class="bk-scroll">${rowsHtml(list, { key: b => b.batch.id, open: params[0] || null, cols: '132px minmax(80px,.8fr) minmax(0,2fr) 64px 58px 84px 66px 56px',
                    empty: 'No batches in this period',
                    line: b => `<span class="nowrap"><b>${esc(b.batch.batchNo)}</b> <small class="inline">${dayLabel(b.batch.producedOn)}</small></span>
                        <span class="ellipsis">${esc(b.teamName || '—')}</span>
                        <span class="ellipsis bk-types-line">${b.items.map(i => `${esc(i.name)} <b>${count(i.quantity)}</b>`).join(' · ')}</span>
                        <span class="r"><b>${count(b.good)}</b></span>
                        <span class="r ${b.total && b.damaged / b.total > 0.03 ? 'warn' : 'muted'}">${b.total ? percent((b.damaged / b.total) * 100) : '—'}</span>
                        <span class="r">${b.earningId ? money(b.labour) : '<span class="muted">—</span>'}</span>
                        <span>${b.paidOn ? `<span class="badge good sm">${icon('check')}Paid</span>` : b.earningId ? '<span class="badge warning sm">Due</span>' : ''}</span>
                        ${actions([manage() && iconBtn(`data-edit="${b.batch.id}"`, 'edit', 'Edit'), manage() && !b.paidOn && iconBtn(`data-del="${b.batch.id}"`, 'trash', 'Delete', 'danger')])}`,
                    detail: batchDetail })}</div>`,
                foot: list.length ? `<div class="bk-list-foot"><span>Good <b>${count(made - dmg)}</b></span><span>Damaged <b>${count(dmg)}</b></span><span>Team earns <b>${money(labour)}</b></span></div>` : '' })}
            <div class="bk-side-stats">${productionStats(p, list, r)}</div>
        </div>`;
    const refresh = () => production({ body, tools, params: [], reload, meta });
    tools.onclick = e => { if (e.target.closest('[data-new]')) openBatch(null, done(reload)); };
    body.onclick = async e => {
        const rg = e.target.closest('[data-range]');
        if (rg) { view.range = rg.dataset.range; return refresh(); }
        const ed = e.target.closest('[data-edit]');
        if (ed) return openBatch(p.batches.find(x => String(x.batch.id) === ed.dataset.edit), done(reload));
        const ex = e.target.closest('[data-batch-expense]');
        if (ex) return openExpense(null, (_, m) => { toast(m); refresh(); }, { batchId: Number(ex.dataset.batchExpense) });
        const del = e.target.closest('[data-del]');
        if (del && await confirmDelete('Delete this batch? Its bricks leave the stock.', () => api.del(`/bricks/batches/${del.dataset.del}`))) { toast('Batch deleted'); refresh(); }
    };
    body.onchange = e => {
        if (e.target.matches('[data-team]')) { view.team = e.target.value; refresh(); }
        if (e.target.matches('[data-from]')) { view.from = e.target.value; refresh(); }
        if (e.target.matches('[data-to]')) { view.to = e.target.value; refresh(); }
    };
    let t;
    body.querySelector('[data-bq]').addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { view.batchQ = e.target.value; refresh().then(() => { const i = body.querySelector('[data-bq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 280);
    });
}

/** The stats beside the batches: stock, output by day, by team, by brick type, the team's pay, raw material per 1,000. */
function productionStats(p, list, r) {
    // the last 14 days with production in the period (oldest first)
    const byDay = {};
    list.forEach(b => { byDay[b.batch.producedOn] = (byDay[b.batch.producedOn] || 0) + b.good; });
    const daysShown = Object.keys(byDay).sort().slice(-14);
    const maxDay = Math.max(1, ...daysShown.map(d => byDay[d]));
    const teams = {};
    list.forEach(b => {
        const k = b.teamName || 'No team';
        const x = teams[k] ||= { good: 0, earn: 0, due: 0, n: 0 };
        x.good += b.good; x.earn += num(b.labour); x.n++;
        if (b.earningId && !b.paidOn) x.due += num(b.labour);
    });
    const teamRows = Object.entries(teams).sort((a, b) => b[1].good - a[1].good);
    const maxTeam = Math.max(1, ...teamRows.map(([, x]) => x.good));
    const types = {};
    list.forEach(b => b.items.forEach(i => { const x = types[i.name] ||= { made: 0, dmg: 0 }; x.made += num(i.quantity); x.dmg += num(i.damaged); }));
    const typeRows = Object.entries(types).sort((a, b) => b[1].made - a[1].made);
    const maxType = Math.max(1, ...typeRows.map(([, x]) => x.made));
    const paid = list.filter(b => b.paidOn).reduce((s, b) => s + num(b.labour), 0);
    const owed = list.filter(b => b.earningId && !b.paidOn).reduce((s, b) => s + num(b.labour), 0);
    const mats = {};
    list.forEach(b => b.materials.forEach(f => {
        if (!f.counted) return;
        const x = mats[f.name] ||= { used: 0, good: 0, unit: f.unit };
        x.used += num(f.consumed); x.good += b.good;
    }));
    const matRows = Object.entries(mats).filter(([, x]) => x.good);
    return `
        ${card('Stock in the yard', 'layers', p.stock.length ? stockHtml(p.stock) : '<p class="small muted">No brick types</p>')}
        ${card('Good bricks a day', 'activity', daysShown.length ? `<div class="bk-daybars">${daysShown.map(d => `<span title="${esc(dayLabel(d))}: ${count(byDay[d])}">
            <i style="height:${Math.max(4, (byDay[d] / maxDay) * 100)}%"></i><small>${new Date(d + 'T00:00:00').getDate()}</small></span>`).join('')}</div>
            <small class="muted">best ${count(maxDay)} · average ${count(Math.round(daysShown.reduce((s, d) => s + byDay[d], 0) / daysShown.length))}</small>`
            : '<p class="small muted">No batches in this period</p>', daysShown.length ? `last ${daysShown.length} working days` : '')}
        ${card('By team', 'users', barList(teamRows.map(([k, x]) => ({ label: esc(k), title: `${x.n} batch${x.n === 1 ? '' : 'es'}`,
            pct: (x.good / maxTeam) * 100, value: `${count(x.good)}<small>${moneyShort(x.earn)}${x.due ? ` · <em class="warn">${moneyShort(x.due)} due</em>` : ''}</small>` })), 'No batches'))}
        ${card('By brick type', 'brick', barList(typeRows.map(([k, x]) => ({ label: esc(k), pct: (x.made / maxType) * 100, tone: x.made && x.dmg / x.made > 0.03 ? 'warn' : '',
            value: `${count(x.made)}<small class="${x.made && x.dmg / x.made > 0.03 ? 'warn' : ''}">${x.made ? percent((x.dmg / x.made) * 100) : '—'} lost</small>` })), 'No batches'))}
        ${card('The team’s pay', 'hand-coins', `<div class="hc-pr-figs two"><span><small>Paid</small><b class="pos">${money(paid)}</b></span><span><small>Due</small><b class="${owed ? 'warn' : ''}">${money(owed)}</b></span></div>
            <i class="hc-alloc-bar"><em style="width:${paid + owed ? (paid / (paid + owed)) * 100 : 0}%"></em></i>`)}
        ${matRows.length ? card('Raw material a 1,000 good bricks', 'box', `<div class="bk-kv">${matRows.map(([k, x]) => `<div><span>${esc(k)}</span><b>${qty(Math.round((x.used / x.good) * 1000 * 1000) / 1000)} <small>${esc(x.unit)}</small></b></div>`).join('')}</div>`,
            r.from || r.to ? 'in this period' : 'all time') : ''}`;
}

function batchDetail(b) {
    const share = b.total ? (b.good / b.total) * 100 : 0;
    return `<div class="bk-detail-grid three">
        <section><h4>${icon('brick')}Bricks</h4><table class="grid compact dense"><thead><tr><th>Type</th><th class="r">Made</th><th class="r">Damaged</th><th class="r">Good</th><th class="r">Rate</th><th class="r">Earns</th></tr></thead>
            <tbody>${b.items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${count(i.quantity)}</td><td class="r ${i.damaged ? 'neg' : 'muted'}">${i.damaged ? count(i.damaged) : '—'}</td>
                <td class="r"><b>${count(i.good)}</b></td><td class="r muted">${num(i.rate) ? '₹' + num(i.rate) : '—'}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}</tbody>
            ${b.items.length > 1 ? `<tfoot><tr><td>Total</td><td class="r">${count(b.total)}</td><td class="r">${count(b.damaged)}</td><td class="r">${count(b.good)}</td><td></td><td class="r">${money(b.labour)}</td></tr></tfoot>` : ''}</table>
            <div class="bk-goodbar" title="${share.toFixed(1)}% good"><i style="width:${share}%"></i></div></section>
        <section><h4>${icon('box')}Raw material</h4>${b.materials.length ? `<table class="grid compact dense"><thead><tr><th>Material</th><th class="r">Opening</th><th class="r">In</th><th class="r">Left</th><th class="r">Used</th><th class="r">/1,000</th></tr></thead>
            <tbody>${b.materials.map(f => `<tr><td>${esc(f.name)} <small class="muted">${esc(f.unit)}</small></td><td class="r">${qty(f.opening)}</td><td class="r ${num(f.received) ? 'pos' : 'muted'}">${num(f.received) ? '+' + qty(f.received) : '—'}</td>
                <td class="r">${f.counted ? qty(f.closing) : '<span class="muted" title="Not counted">—</span>'}</td><td class="r"><b>${f.counted ? qty(f.consumed) : '—'}</b></td>
                <td class="r muted">${b.usePerThousand[f.materialId] !== undefined ? qty(b.usePerThousand[f.materialId]) : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No raw material counted.</p>'}</section>
        <section class="bk-detail-side">
            <dl class="bk-crew">
                <div><dt>Team</dt><dd>${esc(b.teamName || 'none')}</dd></div><div><dt>Pricing model</dt><dd>${esc(b.modelName || '—')}</dd></div>
                <div><dt>Pay</dt><dd>${b.paidOn ? `<span class="badge good sm">${icon('check')}paid ${esc(dayLabel(b.paidOn))}</span>` : b.earningId ? '<span class="badge warning sm">due on the next weekly slip</span>' : 'not paid by the brick'}</dd></div>
                <div><dt>Team earns</dt><dd><b>${money(b.labour)}</b>${b.good && num(b.labour) ? ` <small class="muted">₹${(num(b.labour) / b.good).toFixed(2)}/brick</small>` : ''}</dd></div>
                <div><dt>Expenses for it</dt><dd>${num(b.expenses) ? money(b.expenses) : '—'}</dd></div>
                <div><dt>Recorded</dt><dd><small>${esc(b.batch.createdBy || '')} · ${dateTime(b.batch.createdAt)}</small></dd></div>
                ${b.batch.note ? `<div class="wide"><dt>Note</dt><dd>“${esc(b.batch.note)}”</dd></div>` : ''}
            </dl>
            ${manage() ? `<div class="row wrap bk-trip-acts"><button class="btn sm" data-edit="${b.batch.id}">${icon('edit')}Edit</button>
                <button class="btn sm ghost" data-batch-expense="${b.batch.id}">${icon('receipt')}Add an expense</button></div>` : ''}
        </section>
    </div>`;
}

// ===================================================================== raw material

async function materials({ body, tools, params, reload }) {
    const p = await api.get('/bricks/production');
    if (params[0]) view.material = Number(params[0]) || null;
    const sel = view.material;
    const m = p.materials.find(x => x.materialId === sel) || null;
    const batchesAsc = [...p.batches].reverse();
    const trendOf = id => batchesAsc.map(b => b.materials.find(f => f.materialId === id)?.closing).filter(x => x !== undefined && x !== null).map(Number).slice(-20);
    const stateOf = x => x.low ? ['critical', 'Low'] : x.daysLeft !== null && x.daysLeft <= 7 ? ['warning', 'Order soon'] : ['good', 'In stock'];
    const bought = id => p.purchases.filter(x => !id || x.purchase.materialId === id);
    const monthStart = firstOfMonth(0);
    tools.innerHTML = `${m && manage() ? `<button class="btn sm" data-edit-mat>${icon('edit')}Edit ${esc(m.name)}</button>` : ''}
        ${manage() ? `<button class="btn sm primary" data-new>${icon('plus')}Record purchase</button>` : ''}`;
    const purchases = bought(sel);
    const flowRows = p.batches.slice(0, 60).filter(b => b.materials.some(f => (!sel || f.materialId === sel) && (f.counted || num(f.received))));
    const sideRow = x => {
        const st = stateOf(x);
        const cover = x.daysLeft === null ? 100 : Math.min(100, (x.daysLeft / 30) * 100);
        return `<button class="bk-side-row ${sel === x.materialId ? 'selected' : ''}" data-mat="${x.materialId}">
            <span class="chip-icon sm ${st[0] === 'critical' ? 'red' : st[0] === 'warning' ? 'gold' : 'aqua'}">${icon('box')}</span>
            <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(x.name)}</b><b>${qty(x.stock)} <small>${esc(x.unit)}</small></b></span>
                <span class="bk-sr-line sub"><small>${x.daysLeft === null ? 'no use yet' : `${x.daysLeft} days left`}${num(x.avgDailyUse) ? ` · ${qty(x.avgDailyUse)}/day` : ''}</small>
                    <span class="badge sm ${st[0]}">${st[1]}</span></span>
                <i class="bk-meter ${st[0]}"><i style="width:${cover}%"></i></i></span></button>`;
    };
    const head = m ? (() => {
        const st = stateOf(m);
        const trend = trendOf(m.materialId);
        const value = num(m.stock) * num(m.lastRate);
        const monthBuy = bought(m.materialId).filter(x => x.purchase.receivedOn >= monthStart);
        return `<section class="bk-card bk-mat-head">
            <div class="bk-mh-top"><span class="chip-icon">${icon('box')}</span><div class="grow min-0"><h2>${esc(m.name)}</h2><small class="muted">${esc(m.unit)} · ${m.reorderLevel !== null ? `reorder below ${qty(m.reorderLevel)}` : 'no reorder level'}</small></div>
                <span class="badge ${st[0]}">${icon(st[0] === 'good' ? 'check' : 'alert')}${st[1]}</span>
                ${manage() ? `<button class="btn sm primary" data-buy="${m.materialId}">${icon('plus')}Buy</button>` : ''}</div>
            <div class="bk-mh-body">
                <div class="bk-mh-stock"><small>In the yard</small><b>${qty(m.stock)} <span>${esc(m.unit)}</span></b>
                    <i class="bk-meter ${st[0]}"><i style="width:${m.daysLeft === null ? 100 : Math.min(100, (m.daysLeft / 30) * 100)}%"></i></i>
                    <small class="muted">${m.daysLeft === null ? 'no use recorded yet' : `lasts about ${m.daysLeft} days`}</small></div>
                <div class="hc-pr-figs four"><span><small>Use a day</small><b>${num(m.avgDailyUse) ? qty(m.avgDailyUse) : '—'}</b></span>
                    <span><small>Last rate</small><b>${m.lastRate ? `₹${num(m.lastRate).toLocaleString('en-IN')}` : '—'}</b></span>
                    <span><small>Stock worth</small><b>${value ? moneyShort(value) : '—'}</b></span>
                    <span><small>Bought this month</small><b>${moneyShort(monthBuy.reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span></div>
                ${trend.length > 1 ? `<div class="bk-mh-trend"><small>Left after each batch</small>${sparkline(trend, { width: 260, height: 46, color: 'var(--ocean-600)' })}</div>` : ''}
            </div></section>`;
    })() : `<section class="bk-card bk-mat-head"><div class="bk-mh-top"><span class="chip-icon">${icon('box')}</span><div class="grow min-0"><h2>Every raw material</h2>
            <small class="muted">${plural(p.materials.length, 'material')} · ${plural(p.purchases.length, 'purchase')}</small></div></div>
        <div class="hc-pr-figs four"><span><small>Low</small><b class="${p.materials.some(x => x.low) ? 'neg' : ''}">${p.materials.filter(x => x.low).length}</b></span>
            <span><small>Order soon</small><b>${p.materials.filter(x => !x.low && x.daysLeft !== null && x.daysLeft <= 7).length}</b></span>
            <span><small>Bought this month</small><b>${moneyShort(p.purchases.filter(x => x.purchase.receivedOn >= monthStart).reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span>
            <span><small>Bought in all</small><b>${moneyShort(p.purchases.reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span></div></section>`;
    body.innerHTML = `<div class="bk-fill bk-twopane">
        <section class="panel headless bk-side-list"><div class="panel-body flush">
            <div class="bk-side-scroll">
                <button class="bk-side-row all ${sel ? '' : 'selected'}" data-mat=""><span class="chip-icon sm gray">${icon('stack')}</span>
                    <span class="grow min-0"><span class="bk-sr-line"><b>Every material</b><b>${plural(p.materials.length, 'item')}</b></span>
                    <span class="bk-sr-line sub"><small>${p.materials.filter(x => x.low).length} low · ${p.purchases.length} purchases</small></span></span></button>
                ${p.materials.map(sideRow).join('') || emptyState('No raw materials: add them in Set-up', 'box')}
            </div></div></section>
        <div class="bk-pane">
            ${head}
            <div class="bk-split even">
            ${panel({ title: 'Purchases', iconName: 'cart', bodyClass: 'flush', cls: 'bk-list-panel', sub: `${plural(purchases.length, 'purchase')} · ${money(purchases.reduce((s, x) => s + num(x.purchase.amount), 0))}`,
                body: rowsHtml(purchases, { key: x => x.purchase.id, cols: `76px ${sel ? '' : 'minmax(0,1fr) '}minmax(64px,auto) 84px minmax(0,1fr) 56px`, empty: 'Nothing bought yet',
                    line: x => `<span>${dayLabel(x.purchase.receivedOn)}</span>${sel ? '' : `<span class="ellipsis"><b>${esc(x.material)}</b></span>`}
                        <span class="r">${qty(x.purchase.quantity)} <small class="inline">${esc(x.unit)}</small></span><span class="r"><b>${money(x.purchase.amount)}</b></span>
                        <span class="ellipsis muted">${esc(x.purchase.vendor || '')}</span>
                        ${actions([manage() && iconBtn(`data-edit="${x.purchase.id}"`, 'edit', 'Edit'), manage() && iconBtn(`data-del="${x.purchase.id}"`, 'trash', 'Delete', 'danger')])}`,
                    detail: x => `<dl class="bk-crew">
                        <div><dt>Material</dt><dd>${esc(x.material)}</dd></div>
                        <div><dt>Quantity</dt><dd>${qty(x.purchase.quantity)} ${esc(x.unit)}</dd></div>
                        <div><dt>Rate</dt><dd>${x.purchase.rate ? `${money(x.purchase.rate, { decimals: 2 })} a ${esc(x.unit)}` : '—'}</dd></div>
                        <div><dt>Amount</dt><dd><b>${money(x.purchase.amount)}</b></dd></div>
                        <div><dt>Vendor</dt><dd>${esc(x.purchase.vendor || '—')}</dd></div><div><dt>Bill no.</dt><dd>${esc(x.purchase.billNo || '—')}</dd></div>
                        <div><dt>Vehicle</dt><dd>${x.purchase.vehicleNo ? `<span class="bk-plate xs">${esc(x.purchase.vehicleNo)}</span>` : '—'}</dd></div>
                        <div><dt>Paid from</dt><dd>${esc(x.account || '—')}</dd></div><div><dt>Journal</dt><dd>${esc(x.entryNo || '—')}</dd></div>
                        <div><dt>Recorded</dt><dd><small>${esc(x.purchase.createdBy || '')} · ${dateTime(x.purchase.createdAt)}</small></dd></div>
                        ${x.purchase.note ? `<div class="wide"><dt>Note</dt><dd>“${esc(x.purchase.note)}”</dd></div>` : ''}</dl>` }) })}
            ${panel({ title: 'Used, batch by batch', iconName: 'list', bodyClass: 'flush', cls: 'bk-list-panel', sub: 'opening = the batch before’s closing',
                body: rowsHtml(flowRows, { key: b => b.batch.id, cols: sel ? '66px 76px 70px 70px 70px' : '66px 76px minmax(0,1fr)', empty: 'Count the raw material left when recording a batch',
                    line: b => {
                        if (sel) {
                            const f = b.materials.find(x => x.materialId === sel);
                            return `<span><b>${esc(b.batch.batchNo)}</b></span><span class="muted">${dayLabel(b.batch.producedOn)}</span>
                                <span class="r">${num(f?.received) ? `<span class="pos">+${qty(f.received)}</span>` : '<span class="muted">—</span>'}<small>in</small></span>
                                <span class="r">${f?.counted ? qty(f.closing) : '—'}<small>left</small></span><span class="r"><b>${f?.counted ? qty(f.consumed) : '—'}</b><small>used</small></span>`;
                        }
                        return `<span><b>${esc(b.batch.batchNo)}</b></span><span class="muted">${dayLabel(b.batch.producedOn)}</span>
                            <span class="ellipsis">${b.materials.filter(f => f.counted).map(f => `${esc(f.name)} <b>${qty(f.consumed)}</b>`).join(' · ') || '<span class="muted">not counted</span>'}</span>`;
                    },
                    detail: b => `<div class="bk-detail-grid two"><div><table class="grid compact dense"><thead><tr><th>Material</th><th class="r">Opening</th><th class="r">Received</th><th class="r">Left</th><th class="r">Used</th><th class="r">/1,000</th></tr></thead>
                        <tbody>${b.materials.filter(f => !sel || f.materialId === sel).map(f => `<tr><td>${esc(f.name)} <small class="muted">${esc(f.unit)}</small></td><td class="r">${qty(f.opening)}</td>
                        <td class="r">${num(f.received) ? '+' + qty(f.received) : '—'}</td><td class="r">${f.counted ? qty(f.closing) : '—'}</td><td class="r"><b>${f.counted ? qty(f.consumed) : '—'}</b></td>
                        <td class="r muted">${b.usePerThousand[f.materialId] !== undefined ? qty(b.usePerThousand[f.materialId]) : ''}</td></tr>`).join('')}</tbody></table></div>
                        <dl class="bk-crew"><div><dt>Team</dt><dd>${esc(b.teamName || '—')}</dd></div><div><dt>Good bricks</dt><dd><b>${count(b.good)}</b></dd></div>
                            <div><dt>Made</dt><dd>${b.items.map(i => `${esc(i.name)} ${count(i.quantity)}`).join(', ')}</dd></div>
                            <div><dt>Batch</dt><dd><a href="#/bricks/production/${b.batch.id}">${esc(b.batch.batchNo)} ${icon('chevron-right')}</a></dd></div></dl></div>` }) })}
            </div>
        </div></div>`;
    const refresh = () => materials({ body, tools, params: [], reload });
    tools.onclick = async e => {
        if (e.target.closest('[data-new]')) openPurchase(null, (_, msg) => { toast(msg); refresh(); }, { materialId: sel });
        if (e.target.closest('[data-edit-mat]')) {
            const meta = await loadMeta();
            openMaterial(meta.materials.find(x => x.id === sel), (fresh, msg) => { setMeta(fresh); toast(msg); refresh(); });
        }
    };
    body.onclick = async e => {
        const buy = e.target.closest('[data-buy]');
        if (buy) return openPurchase(null, (_, msg) => { toast(msg); refresh(); }, { materialId: Number(buy.dataset.buy) });
        const ed = e.target.closest('[data-edit]');
        if (ed) return openPurchase(p.purchases.find(x => String(x.purchase.id) === ed.dataset.edit), (_, msg) => { toast(msg); refresh(); });
        const del = e.target.closest('[data-del]');
        if (del) { if (await confirmDelete('Delete this purchase? It leaves the stock and the books.', () => api.del(`/bricks/purchases/${del.dataset.del}`))) { invalidateAccounts(); toast('Deleted'); refresh(); } return; }
        const row = e.target.closest('[data-mat]');
        if (row) {
            view.material = row.dataset.mat ? Number(row.dataset.mat) : null;
            history.replaceState(null, '', `#/bricks/materials${view.material ? `/${view.material}` : ''}`);
            refresh();
        }
    };
}

// ===================================================================== expenses

async function expenses({ body, tools, reload }) {
    const p = await api.get('/bricks/production');
    const since = sinceDays(view.range);
    const inRange = p.expenses.filter(x => !since || x.expense.spentOn >= since);
    const byHead = {};
    inRange.forEach(x => { const h = byHead[x.expense.head] ||= { amount: 0, n: 0 }; h.amount += num(x.expense.amount); h.n++; });
    const heads = Object.entries(byHead).sort((a, b) => b[1].amount - a[1].amount);
    const list = inRange.filter(x => !view.head || x.expense.head === view.head);
    const total = inRange.reduce((s, x) => s + num(x.expense.amount), 0);
    tools.innerHTML = `${chips('range', [['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All']], view.range)}
        ${manage() ? `<button class="btn sm primary" data-new>${icon('plus')}Expense</button>` : ''}`;
    body.innerHTML = `
        <div class="bk-head-tiles">${heads.map(([h, v]) => `<button class="bk-head-tile ${view.head === h ? 'selected' : ''}" data-head="${esc(h)}">
            <span>${esc(h)}</span><b>${moneyShort(v.amount)}</b><i><em style="width:${(v.amount / heads[0][1].amount) * 100}%"></em></i><small>${v.n} bill${v.n === 1 ? '' : 's'} · ${percent((v.amount / total) * 100, 0)}</small></button>`).join('')
            || '<p class="small muted">No expenses in this period.</p>'}</div>
        ${panel({ title: view.head ? `${view.head}` : 'Every expense', iconName: 'receipt', bodyClass: 'flush', cls: 'bk-list-panel',
            sub: `${money(list.reduce((s, x) => s + num(x.expense.amount), 0))}${view.head ? ` · <a href="#" data-allheads>show all</a>` : ''}`, actions: expandAllButton(),
            body: rowsHtml(list, { key: x => x.expense.id, cols: '78px minmax(90px,.8fr) minmax(0,1.6fr) minmax(0,1fr) 92px 56px', empty: 'No expenses',
                line: x => `<span>${dayLabel(x.expense.spentOn)}</span><span><b>${esc(x.expense.head)}</b></span><span class="ellipsis">${esc(x.expense.description || '')}</span>
                    <span class="ellipsis muted">${esc(x.expense.vendor || '')}${x.batchNo ? ` · ${esc(x.batchNo)}` : ''}</span><span class="r"><b>${money(x.expense.amount)}</b></span>
                    ${actions([manage() && iconBtn(`data-edit="${x.expense.id}"`, 'edit', 'Edit'), manage() && iconBtn(`data-del="${x.expense.id}"`, 'trash', 'Delete', 'danger')])}`,
                detail: x => facts([['Bill no.', esc(x.expense.billNo || '—')], ['For batch', x.batchNo ? `<a href="#/bricks/production/${x.expense.batchId}">${esc(x.batchNo)}</a>` : '—'],
                    ['Paid from', esc(x.account || '')], ['Journal', esc(x.entryNo || '')], ['Recorded', `${esc(x.expense.createdBy || '')} · ${dateTime(x.expense.createdAt)}`]]) }) })}`;
    const refresh = () => expenses({ body, tools, reload });
    tools.onclick = e => {
        const r = e.target.closest('[data-range]');
        if (r) { view.range = r.dataset.range; refresh(); }
        if (e.target.closest('[data-new]')) openExpense(null, (_, m) => { toast(m); refresh(); });
    };
    body.onclick = async e => {
        if (e.target.closest('[data-allheads]')) { e.preventDefault(); view.head = null; return refresh(); }
        const h = e.target.closest('[data-head]');
        if (h) { view.head = view.head === h.dataset.head ? null : h.dataset.head; return refresh(); }
        const ed = e.target.closest('[data-edit]');
        if (ed) return openExpense(p.expenses.find(x => String(x.expense.id) === ed.dataset.edit), (_, m) => { toast(m); refresh(); });
        const del = e.target.closest('[data-del]');
        if (del && await confirmDelete('Delete this expense? It leaves the books.', () => api.del(`/bricks/expenses/${del.dataset.del}`))) { invalidateAccounts(); toast('Deleted'); refresh(); }
    };
}

// ===================================================================== sales & delivery

const FILTERS = [['open', 'Open'], ['moving', 'On the move'], ['due', 'To collect'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'], ['all', 'All']];
const DATES = [['any', 'Any date'], ['today', 'Today'], ['week', 'This week'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['custom', 'Pick dates…']];

const statusMatch = (o, f) => f === 'all' || (f === 'open' ? !['DELIVERED', 'CANCELLED'].includes(o.status)
    : f === 'moving' ? ['LOADING', 'DISPATCHED', 'IN_TRANSIT'].includes(o.status)
    : f === 'due' ? num(o.balance) > 0 && o.status !== 'CANCELLED' : o.status === f);

function datesOf() {
    const d = view.orderDates;
    if (d === 'any') return null;
    if (d === 'today') return { from: today(), to: today() };
    if (d === 'week') return weekOf();
    if (d === 'month') return { from: firstOfMonth(0), to: today() };
    if (d === 'custom') return { from: view.orderFrom || null, to: view.orderTo || null };
    return { from: sinceDays(d), to: today() };
}

/** The day an order is listed under: its order date, or (finding deliveries) its last delivery, else its next trip. */
const dayOf = o => view.orderBy === 'delivery' ? (o.lastDelivered || o.nextTrip || o.orderDate) : o.orderDate;

function groupLabel(iso) {
    if (!iso) return 'No date';
    const t = today();
    const y = isoDate(new Date(Date.now() - 86400000));
    if (iso === t) return 'Today';
    if (iso === y) return 'Yesterday';
    if (iso > t) return 'Coming up';
    const w = weekOf();
    if (iso >= w.from) return 'This week';
    if (iso >= firstOfMonth(0)) return 'This month';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

async function sales({ body, params, reload }) {
    const orders = await api.get('/bricks/orders');
    const q = () => view.orderQ.trim().toLowerCase();
    const match = o => {
        if (!statusMatch(o, view.orderFilter)) return false;
        const r = datesOf();
        if (r) {
            const days = view.orderBy === 'delivery' ? (o.tripDates || []) : [o.orderDate];
            if (!days.some(d => inRange(d, r))) return false;
        }
        const t = q();
        return !t || `${o.orderNo} ${o.customerName} ${o.customerPhone || ''} ${o.address || ''} ${o.vehicle || ''}`.toLowerCase().includes(t);
    };
    let selId = params[0] ? Number(params[0]) : null;
    const open = orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status));
    const toCollect = orders.filter(o => o.status !== 'CANCELLED').reduce((s, o) => s + Math.max(0, num(o.balance)), 0);
    body.innerHTML = `<div class="bk-fill bk-sales">
        <section class="panel headless bk-side-list bk-orders-list"><div class="panel-body flush">
            <div class="list-tools">
                <div class="lt-top">
                    <div class="search-box">${icon('search')}<input type="search" data-q data-plain placeholder="Search orders…" title="Customer, mobile, order no., vehicle or address" value="${esc(view.orderQ)}">
                        <span class="lt-count" data-count></span></div>
                    ${manage() ? `<button class="btn primary icon lt-add" data-new title="New order">${icon('plus')}</button>` : ''}
                </div>
                <div class="bk-of-chips">${FILTERS.map(([k, l]) => `<button class="bk-fchip ${view.orderFilter === k ? 'active' : ''}" data-filter="${k}">${l}<i>${orders.filter(o => statusMatch(o, k)).length}</i></button>`).join('')}</div>
                <div class="bk-of-dates">
                    <select data-dates>${DATES.map(([k, l]) => `<option value="${k}" ${view.orderDates === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <div class="seg-chips xs" title="Which day counts"><button class="seg-chip ${view.orderBy === 'order' ? 'active' : ''}" data-by="order">Ordered</button>
                        <button class="seg-chip ${view.orderBy === 'delivery' ? 'active' : ''}" data-by="delivery">Delivered</button></div>
                </div>
                <div class="bk-dates bk-of-custom" ${view.orderDates === 'custom' ? '' : 'hidden'}><input type="date" data-ofrom value="${esc(view.orderFrom)}"><span>–</span><input type="date" data-oto value="${esc(view.orderTo)}"></div>
            </div>
            <div class="bk-side-scroll bk-order-rows" data-rows tabindex="0"></div>
            <div class="bk-side-foot"><span><b>${open.length}</b> open</span><span><b>${count(open.reduce((s, o) => s + o.quantity - o.delivered, 0))}</b> to deliver</span>
                <span><b class="${toCollect ? 'neg' : ''}">${moneyShort(toCollect)}</b> to collect</span></div>
        </div></section>
        <div class="bk-pane bk-order-pane" id="bk-order"></div></div>`;
    const pane = body.querySelector('#bk-order');
    const rowsEl = body.querySelector('[data-rows]');
    const rowHtml = o => {
        const pct = o.quantity ? (o.delivered / o.quantity) * 100 : 0;
        const late = o.requiredBy && o.requiredBy < today() && !['DELIVERED', 'CANCELLED'].includes(o.status);
        return `<a class="bk-order-row ${o.id === selId ? 'selected' : ''} st-${esc(o.status.toLowerCase())}" data-order="${o.id}">
            <span class="bk-or-av">${esc(initials(o.customerName))}</span>
            <div class="grow min-0">
                <div class="bk-sr-line"><b class="ellipsis">${esc(o.customerName)}</b><b>${moneyShort(o.total)}</b></div>
                <div class="bk-sr-line sub"><small class="ellipsis">${esc(o.orderNo)} · ${count(o.quantity)} bricks${o.vehicle ? ` · ${esc(o.vehicle)}` : ''}</small>
                    ${o.claimed ? `<span class="badge warning sm">${icon('bell')}paid?</span>` : num(o.balance) > 0 && o.status !== 'CANCELLED' ? `<small class="neg nowrap">${moneyShort(o.balance)} due</small>` : ''}</div>
                <div class="bk-sr-line sub">${orderBadge(o.status)}<small class="${late ? 'neg' : 'muted'} nowrap">${o.status === 'DELIVERED' && o.lastDelivered ? `delivered ${shortDate(o.lastDelivered)}`
                    : o.nextTrip ? `${o.tripsDone}/${o.trips} trips · next ${shortDate(o.nextTrip)}` : late ? `due ${shortDate(o.requiredBy)}` : `${o.tripsDone}/${o.trips} trips`}</small></div>
                <i class="bk-mini-bar"><em style="width:${pct}%"></em></i>
            </div></a>`;
    };
    const drawRows = () => {
        const list = orders.filter(match);
        list.sort((a, b) => String(dayOf(b) || '').localeCompare(String(dayOf(a) || '')) || b.id - a.id);
        let last = null;
        rowsEl.innerHTML = list.map(o => {
            const g = groupLabel(dayOf(o));
            const head = g !== last ? `<div class="group-label"><span>${esc(g)}</span></div>` : '';
            last = g;
            return head + rowHtml(o);
        }).join('') || emptyState(orders.length ? 'No order matches' : 'No orders yet', 'cart');
        body.querySelector('[data-count]').textContent = list.length === orders.length ? `${orders.length}` : `${list.length} of ${orders.length}`;
        return list;
    };
    const show = async id => {
        selId = id;
        rowsEl.querySelectorAll('[data-order]').forEach(x => x.classList.toggle('selected', Number(x.dataset.order) === id));
        if (!id) {
            pane.innerHTML = `<section class="bk-card bk-empty-pane">${emptyState(orders.length ? 'Pick an order on the left' : 'Take an order to see it here', 'cart')}
                ${manage() && !orders.length ? `<button class="btn primary" data-new>${icon('plus')}New order</button>` : ''}</section>`;
            return;
        }
        pane.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        const v = await api.get(`/bricks/orders/${id}`);
        history.replaceState(null, '', `#/bricks/sales/${id}`);
        const drawOrder = (nv, msg) => {
            if (msg) toast(msg);
            pane.innerHTML = orderHtml(nv);
            bindOrder(pane, nv, (x, m) => { drawOrder(x, m); refreshRow(); });
        };
        drawOrder(v);
    };
    const refreshRow = async () => {
        const fresh = await api.get('/bricks/orders');
        const o = fresh.find(x => x.id === selId);
        const i = orders.findIndex(x => x.id === selId);
        if (o && i >= 0) orders[i] = o;
        const row = rowsEl.querySelector(`[data-order="${selId}"]`);
        if (o && row) row.outerHTML = rowHtml(o);
    };
    const again = id => sales({ body, params: id ? [String(id)] : selId ? [String(selId)] : [], reload });
    const openNew = () => openOrder(null, (o, msg) => { toast(msg); history.replaceState(null, '', `#/bricks/sales/${o.order.id}`); again(o.order.id); });
    body.onclick = e => { if (e.target.closest('[data-new]')) openNew(); };
    const side = body.querySelector('.bk-orders-list');
    side.addEventListener('click', e => {
        const f = e.target.closest('[data-filter]');
        if (f) { view.orderFilter = f.dataset.filter; side.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === f)); return drawRows(); }
        const by = e.target.closest('[data-by]');
        if (by) { view.orderBy = by.dataset.by; side.querySelectorAll('[data-by]').forEach(x => x.classList.toggle('active', x === by)); return drawRows(); }
        const r = e.target.closest('[data-order]');
        if (r) show(Number(r.dataset.order));
    });
    side.addEventListener('change', e => {
        if (e.target.matches('[data-dates]')) {
            view.orderDates = e.target.value;
            side.querySelector('.bk-of-custom').hidden = view.orderDates !== 'custom';
            if (view.orderDates === 'custom' && !view.orderFrom) view.orderFrom = firstOfMonth(0);
            side.querySelector('[data-ofrom]').value = view.orderFrom;
        }
        if (e.target.matches('[data-ofrom]')) view.orderFrom = e.target.value;
        if (e.target.matches('[data-oto]')) view.orderTo = e.target.value;
        drawRows();
    });
    const search = side.querySelector('[data-q]');
    search.addEventListener('input', () => { view.orderQ = search.value; drawRows(); });
    search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { search.value = ''; view.orderQ = ''; drawRows(); } });
    let keyTimer;
    setPageKeys(listNavigator({
        items: () => [...rowsEl.querySelectorAll('[data-order]')],
        selected: () => rowsEl.querySelector('.selected'),
        select: el => {
            rowsEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            el.scrollIntoView({ block: 'nearest' });
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => show(Number(el.dataset.order)), 160);
        },
        open: () => (document.activeElement === search ? rowsEl.focus() : null),
        allowWhileTyping: search,
    }));
    const list = drawRows();
    if (!selId || !orders.some(o => o.id === selId)) selId = list[0]?.id || null;
    await show(selId);
}

// ===================================================================== team

const PAY = { PIECE: 'Paid by work done', WEEKLY: 'Weekly wage', MONTHLY: 'Monthly salary' };
const TEAM_SHOW = [['all', 'All'], ['teams', 'Teams'], ['people', 'People'], ['vehicles', 'Vehicles']];
const KIND_ICON = { PRODUCTION: 'factory', LOADING: 'layers', UNLOADING: 'layers', TRIP: 'truck', WAGE: 'calendar', SALARY: 'briefcase', BONUS: 'gift' };

async function team({ body, tools, reload, meta }) {
    const p = await api.get('/bricks/payroll');
    const vehicles = meta.vehicles;
    tools.innerHTML = manage() ? `<button class="btn sm" data-vehicle>${icon('truck')}Enrol vehicle</button><button class="btn sm primary" data-new>${icon('plus')}Enrol team or person</button>` : '';
    const groupOf = v => !v.resource.active ? 'Left' : v.resource.kind === 'TEAM' ? 'Teams' : categoryOf(v.resource) === 'STAFF' ? 'Staff' : 'Production labour';
    const shownGroups = { all: ['Teams', 'Production labour', 'Staff', 'Vehicles', 'Left'], teams: ['Teams'], people: ['Production labour', 'Staff'], vehicles: ['Vehicles'] }[view.teamShow];
    const keyOf = x => x.vehicle ? `v${x.vehicle.id}` : `r${x.resource.id}`;
    const items = () => {
        const t = view.teamQ.trim().toLowerCase();
        const res = p.resources.filter(v => !t || `${v.resource.name} ${roleName(v.resource.role)} ${v.resource.phone || ''} ${v.resource.members || ''}`.toLowerCase().includes(t))
            .map(v => ({ ...v, group: groupOf(v) }));
        const veh = vehicles.filter(v => !t || `${v.number} ${v.kind || ''}`.toLowerCase().includes(t)).map(v => ({ vehicle: v, group: 'Vehicles' }));
        return [...res, ...veh].filter(x => shownGroups.includes(x.group));
    };
    const rowHtml = x => {
        if (x.vehicle) {
            const v = x.vehicle;
            return `<button class="bk-side-row ${view.teamSel === keyOf(x) ? 'selected' : ''} ${v.active ? '' : 'off'}" data-sel="${keyOf(x)}">
                <span class="bk-plate sm">${esc(v.number)}</span>
                <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(v.kind || 'Vehicle')}</b><b>${count(v.capacity)}<small> a trip</small></b></span>
                    <span class="bk-sr-line sub"><small class="ellipsis">${esc(meta.resources.find(r => r.id === v.driverId)?.name || 'no usual driver')}</small>
                    <span class="badge sm ${v.companyOwned === false ? 'gray' : 'aqua'}">${v.companyOwned === false ? 'hired' : 'company'}</span></span></span></button>`;
        }
        const r = x.resource, look = roleLook(r.role);
        return `<button class="bk-side-row ${view.teamSel === keyOf(x) ? 'selected' : ''} ${r.active ? '' : 'off'}" data-sel="${keyOf(x)}">
            <i class="bk-avatar sm ${look.tone}">${esc(initials(r.name))}</i>
            <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(r.name)}${r.defaultTeam ? ` <span class="badge sm good">default</span>` : ''}</b>
                    ${num(x.unpaid) ? `<b class="warn">${moneyShort(x.unpaid)}</b>` : '<b class="muted">—</b>'}</span>
                <span class="bk-sr-line sub"><small class="ellipsis">${icon(look.icon)}${esc(roleName(r.role))}${r.kind === 'TEAM' && r.memberCount ? ` · ${r.memberCount} people` : ''}</small>
                    <small class="nowrap">${r.salaryType === 'PIECE' ? 'by work' : r.salaryType === 'WEEKLY' ? 'weekly' : 'monthly'}</small></span></span></button>`;
    };
    body.innerHTML = `<div class="bk-fill bk-twopane">
        <section class="panel headless bk-side-list"><div class="panel-body flush">
            <div class="list-tools">
                <div class="lt-top"><div class="search-box">${icon('search')}<input type="search" data-tq data-plain placeholder="Name, role, mobile, vehicle…" value="${esc(view.teamQ)}"><span class="lt-count" data-count></span></div></div>
                <div class="seg-chips sm bk-show">${TEAM_SHOW.map(([k, l]) => `<button class="seg-chip ${view.teamShow === k ? 'active' : ''}" data-show="${k}">${l}</button>`).join('')}</div>
            </div>
            <div class="bk-side-scroll" data-rows></div>
            <div class="bk-side-foot"><span>Due <b class="${num(p.unpaidTotal) ? 'warn' : ''}">${moneyShort(p.unpaidTotal)}</b></span><span>Advances <b>${moneyShort(p.advancesOutstanding)}</b></span></div>
        </div></section>
        <div class="bk-pane" id="bk-team-pane"></div></div>`;
    const rowsEl = body.querySelector('[data-rows]');
    const pane = body.querySelector('#bk-team-pane');
    const drawRows = () => {
        const list = items();
        const groups = shownGroups.map(g => [g, list.filter(x => x.group === g)]).filter(([, l]) => l.length);
        rowsEl.innerHTML = groups.map(([g, l]) => `${view.teamShow === 'all' || groups.length > 1 ? `<div class="group-label"><span>${esc(g)} <i>${l.length}</i></span></div>` : ''}${l.map(rowHtml).join('')}`).join('')
            || emptyState(p.resources.length || vehicles.length ? 'Nobody matches' : 'Enrol your teams, labour, staff and vehicles', 'users');
        body.querySelector('[data-count]').textContent = String(list.length);
        return list;
    };
    const show = async key => {
        view.teamSel = key;
        rowsEl.querySelectorAll('[data-sel]').forEach(x => x.classList.toggle('selected', x.dataset.sel === key));
        if (!key) { pane.innerHTML = `<section class="bk-card bk-empty-pane">${emptyState('Pick a team, a person or a vehicle', 'users')}</section>`; return; }
        pane.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        if (key.startsWith('v')) {
            const v = vehicles.find(x => String(x.id) === key.slice(1));
            const trips = await api.get(`/bricks/vehicles/${v.id}/trips`).catch(() => []);
            pane.innerHTML = vehiclePane(v, trips, meta);
        } else {
            const h = await api.get(`/bricks/resources/${key.slice(1)}/history`);
            pane.innerHTML = resourcePane(h);
        }
    };
    const refresh = () => team({ body, tools, reload, meta });
    tools.onclick = e => {
        if (e.target.closest('[data-new]')) openResource(null, (saved, msg) => { toast(msg); view.teamSel = `r${saved.resource.id}`; reload(); });
        if (e.target.closest('[data-vehicle]')) openVehicle(null, done(reload));
    };
    const side = body.querySelector('.bk-side-list');
    side.addEventListener('click', e => {
        const s = e.target.closest('[data-show]');
        if (s) { view.teamShow = s.dataset.show; side.querySelectorAll('[data-show]').forEach(x => x.classList.toggle('active', x === s)); const l = drawRows(); if (!l.some(x => keyOf(x) === view.teamSel)) show(l[0] ? keyOf(l[0]) : null); return; }
        const r = e.target.closest('[data-sel]');
        if (r) show(r.dataset.sel);
    });
    const search = side.querySelector('[data-tq]');
    search.addEventListener('input', () => { view.teamQ = search.value; drawRows(); });
    pane.onclick = async e => {
        const find = id => p.resources.find(v => String(v.resource.id) === String(id))?.resource;
        const tx = e.target.closest('[data-tx]');
        if (tx) { view.txFilter = tx.dataset.tx; pane.querySelectorAll('[data-tx]').forEach(x => x.classList.toggle('active', x === tx));
            pane.querySelectorAll('[data-txkind]').forEach(row => { row.hidden = view.txFilter !== 'all' && row.dataset.txkind !== view.txFilter; }); return; }
        const ed = e.target.closest('[data-edit]');
        if (ed) return openResource(find(ed.dataset.edit), done(reload));
        const adv = e.target.closest('[data-advance]');
        if (adv) return openAdvance(find(adv.dataset.advance), done(reload));
        const pay = e.target.closest('[data-pay]');
        if (pay) {
            const r = find(pay.dataset.pay);
            const period = r.salaryType === 'MONTHLY' ? monthOf() : weekOf();
            return openSlip(r.id, r.salaryType === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY', period.from, period.to, done(reload));
        }
        const sl = e.target.closest('[data-slip]');
        if (sl) return openSlipView(await api.get(`/bricks/payroll/slips/${sl.dataset.slip}`), { onCancelled: manage() ? refresh : null });
        const del = e.target.closest('[data-del]');
        if (del && await confirmDelete('Remove them? Anyone with work or pay on record is kept as “left”.', () => api.del(`/bricks/resources/${del.dataset.del}`))) { await loadMeta(true); view.teamSel = null; reload(); return; }
        const ev = e.target.closest('[data-edit-vehicle]');
        if (ev) return openVehicle(vehicles.find(v => String(v.id) === ev.dataset.editVehicle), done(reload));
        const go = e.target.closest('[data-go]');
        if (go) location.hash = go.dataset.go;
    };
    const list = drawRows();
    if (!list.some(x => keyOf(x) === view.teamSel)) view.teamSel = list[0] ? keyOf(list[0]) : null;
    await show(view.teamSel);
}

/** A team or a person: who they are and how they are paid, this month's figures, then every piece of work and payment. */
function resourcePane(h) {
    const v = h.resource, r = v.resource, look = roleLook(r.role);
    const phone = telOf(r.phone);
    const members = String(r.members || '').split(',').map(x => x.trim()).filter(Boolean);
    const driver = r.role.includes('DRIVER');
    // one list, newest first: work (earnings) and slips (payments and advances)
    const tx = [...h.earnings.map(e => ({ kind: 'work', on: e.earnedOn, e })), ...h.slips.map(s => ({ kind: s.kind === 'ADVANCE' ? 'advance' : 'pay', on: s.paidOn, s }))]
        .sort((a, b) => String(b.on).localeCompare(String(a.on)));
    const months = {};
    h.earnings.forEach(e => { const k = String(e.earnedOn).slice(0, 7); (months[k] ||= { earned: 0, paid: 0, qty: 0, trips: 0 }).earned += num(e.amount);
        if (e.kind === 'TRIP') months[k].trips++; else if (['PRODUCTION', 'LOADING', 'UNLOADING'].includes(e.kind)) months[k].qty += num(e.quantity); });
    h.slips.filter(s => s.status === 'PAID' && s.kind !== 'ADVANCE').forEach(s => { const k = String(s.paidOn).slice(0, 7); (months[k] ||= { earned: 0, paid: 0, qty: 0, trips: 0 }).paid += num(s.net); });
    const monthRows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    const maxMonth = Math.max(1, ...monthRows.map(([, x]) => Math.max(x.earned, x.paid)));
    const owed = h.advances.filter(a => num(a.outstanding) > 0);
    const txLine = x => {
        if (x.kind === 'work') {
            const e = x.e;
            return `<div class="bk-row" data-key="e${e.id}" data-txkind="work"><div class="bk-line" role="button" tabindex="0">${icon('chevron-right', 'bk-chev')}
                <span class="muted">${dayLabel(e.earnedOn)}</span><span class="bk-who"><span class="chip-icon sm">${icon(KIND_ICON[e.kind] || 'tag')}</span><b>${esc(e.label)}</b></span>
                <span class="ellipsis small muted">${esc(e.narrative || '')}</span>
                <span class="r">${e.quantity ? count(e.quantity) : ''}</span><span class="r"><b>${money(e.amount)}</b></span>
                <span>${e.slipId ? `<span class="badge good sm">${icon('check')}${esc(e.slipNo || 'paid')}</span>` : '<span class="badge warning sm">Due</span>'}</span></div>
                <div class="bk-detail" hidden><dl class="bk-crew">
                    <div><dt>What</dt><dd>${esc(e.label)}</dd></div><div><dt>On</dt><dd>${date(e.earnedOn)}</dd></div>
                    ${e.quantity ? `<div><dt>${e.kind === 'TRIP' ? 'Trips' : 'Bricks'}</dt><dd>${count(e.quantity)}</dd></div>` : ''}
                    ${num(e.rate) ? `<div><dt>Rate</dt><dd>₹${num(e.rate)}${e.kind === 'TRIP' ? ' a trip' : ' a brick'}</dd></div>` : ''}
                    <div><dt>Earned</dt><dd><b>${money(e.amount)}</b></dd></div>
                    <div><dt>Paid</dt><dd>${e.slipId ? `on <button type="button" class="link-btn" data-slip="${e.slipId}">${esc(e.slipNo)}</button>` : 'not yet: on the next slip'}</dd></div>
                    ${e.narrative ? `<div class="wide"><dt>Details</dt><dd>${esc(e.narrative)}</dd></div>` : ''}
                    ${e.sourceType === 'BATCH' && e.sourceId ? `<div><dt>Batch</dt><dd><button type="button" class="link-btn" data-go="#/bricks/production/${e.sourceId}">Open the batch</button></dd></div>` : ''}
                </dl></div></div>`;
        }
        const s = x.s;
        const adv = s.kind === 'ADVANCE';
        return `<div class="bk-row" data-key="s${s.id}" data-txkind="${adv ? 'advance' : 'pay'}"><div class="bk-line" role="button" tabindex="0">${icon('chevron-right', 'bk-chev')}
            <span class="muted">${dayLabel(s.paidOn)}</span><span class="bk-who"><span class="chip-icon sm ${adv ? 'violet' : 'aqua'}">${icon(adv ? 'hand' : 'hand-coins')}</span><b>${adv ? 'Advance' : 'Payment'} ${esc(s.slipNo)}</b></span>
            <span class="ellipsis small muted">${adv ? esc(s.narrative || '') : `${dayLabel(s.periodFrom)} – ${dayLabel(s.periodTo)}`}</span>
            <span class="r ${num(s.deductions) ? 'neg' : 'muted'}">${num(s.deductions) ? `− ${moneyShort(s.deductions)}` : ''}</span>
            <span class="r"><b class="${s.status === 'CANCELLED' ? 'strike' : adv ? '' : 'pos'}">${money(s.net)}</b></span>
            <span>${s.status === 'CANCELLED' ? '<span class="badge gray sm">Cancelled</span>' : adv ? '<span class="badge violet sm">Given</span>' : '<span class="badge good sm">Paid</span>'}</span></div>
            <div class="bk-detail" hidden><div class="bk-slip-peek"><dl class="bk-crew">
                ${adv ? `<div class="wide"><dt>Why</dt><dd>${esc(s.narrative || '—')}</dd></div>` : `<div><dt>Period</dt><dd>${date(s.periodFrom)} – ${date(s.periodTo)}</dd></div>
                    <div><dt>Earned</dt><dd>${money(s.gross)}</dd></div><div><dt>Advance taken back</dt><dd>${num(s.deductions) ? `− ${money(s.deductions)}` : '—'}</dd></div>`}
                <div><dt>${adv ? 'Given' : 'Paid'}</dt><dd><b>${money(s.net)}</b></dd></div><div><dt>From</dt><dd>${esc(s.account || '—')}</dd></div>
                ${!adv && s.narrative ? `<div class="wide"><dt>Note</dt><dd>${esc(s.narrative)}</dd></div>` : ''}</dl>
                <button class="btn sm" data-slip="${s.id}">${icon('receipt')}View slip</button></div></div></div>`;
    };
    return `<section class="bk-card bk-who-head">
            <div class="bk-mh-top"><i class="bk-avatar ${look.tone}">${esc(initials(r.name))}${r.kind === 'TEAM' && r.memberCount ? `<i>${r.memberCount}</i>` : ''}</i>
                <div class="grow min-0"><h2 class="ellipsis">${esc(r.name)} ${r.active ? '' : '<span class="badge gray sm">left</span>'}${r.defaultTeam ? ' <span class="badge good sm">default team</span>' : ''}</h2>
                    <small class="muted">${icon(look.icon)}${esc(roleName(r.role))} · ${r.kind === 'TEAM' ? 'team' : categoryOf(r) === 'STAFF' ? 'staff' : 'production labour'} · ${esc(PAY[r.salaryType])}${r.salaryAmount ? ` ${money(r.salaryAmount)}/${r.salaryType === 'WEEKLY' ? 'week' : 'month'}` : ''}${r.tripIncentive ? ` · ${money(r.tripIncentive)} a trip` : ''}</small>
                    <div class="bk-meta">${phone ? `<a href="tel:${phone}">${icon('phone')}${esc(r.phone)}</a><a href="https://wa.me/91${phone}" target="_blank" rel="noopener">${icon('send')}WhatsApp</a>` : ''}
                        ${r.upiId ? `<span>${icon('qr')}${esc(r.upiId)}</span>` : ''}${r.joinedOn ? `<span>${icon('calendar')}joined ${date(r.joinedOn)}</span>` : ''}</div></div>
                <div class="bk-head-acts">${manage() && r.active ? `<button class="btn sm primary" data-pay="${r.id}" ${num(v.unpaid) || r.salaryType !== 'PIECE' ? '' : 'disabled'}>${icon('hand-coins')}Pay</button>
                    <button class="btn sm" data-advance="${r.id}">${icon('hand')}Advance</button>` : ''}
                    ${manage() ? `${iconBtn(`data-edit="${r.id}"`, 'edit', 'Edit')}${r.active ? iconBtn(`data-del="${r.id}"`, 'trash', 'Remove', 'danger') : ''}` : ''}</div></div>
            ${members.length ? `<div class="bk-members">${members.slice(0, 10).map(m => `<span title="${esc(m)}">${esc(initials(m))}</span>`).join('')}${members.length > 10 ? `<span>+${members.length - 10}</span>` : ''}
                <small class="ellipsis">${esc(members.join(', '))}</small></div>` : ''}
            <div class="bk-chipfigs in">
                ${chip('This month', driver ? plural(v.monthTrips, 'trip') : v.monthQuantity ? count(v.monthQuantity) : '—', driver ? '' : v.monthQuantity ? 'bricks' : '', '', driver ? 'truck' : 'factory')}
                ${chip('Earned', moneyShort(v.monthEarned), 'this month', '', 'trending')}
                ${chip('Due now', money(v.unpaid), plural(v.unpaidCount, 'item'), num(v.unpaid) ? 'warn' : '', 'clock')}
                ${chip('Advance owed', money(v.advanceOutstanding), num(v.advanceTaken) ? `of ${moneyShort(v.advanceTaken)}` : '', num(v.advanceOutstanding) ? 'bad' : '', 'hand')}
                ${chip('Paid in all', moneyShort(v.paidTotal), v.lastPaidOn ? `last ${shortDate(v.lastPaidOn)}` : 'never', '', 'check-circle')}
            </div>
            ${r.note ? `<p class="small muted bk-note-p">${icon('info')}${esc(r.note)}</p>` : ''}
        </section>
        <div class="bk-split">
            ${panel({ title: 'Work & payments', iconName: 'list', bodyClass: 'flush', cls: 'bk-list-panel', sub: `${plural(h.earnings.length, 'work item')} · ${plural(h.slips.length, 'slip')}`,
                actions: `<div class="seg-chips sm">${[['all', 'All'], ['work', 'Work'], ['pay', 'Payments'], ['advance', 'Advances']].map(([k, l]) => `<button class="seg-chip ${view.txFilter === k ? 'active' : ''}" data-tx="${k}">${l}</button>`).join('')}</div>`,
                body: tx.length ? `<div class="bk-rows bk-tx" style="--cols:84px minmax(140px,1fr) minmax(0,1.6fr) 64px 92px 84px">${tx.map(txLine).join('')}</div>`
                    : `<div class="empty bk-empty">${icon('droplet')}<div>No work or payments yet</div></div>` })}
            <div class="bk-aside">
                ${card('By month', 'calendar', monthRows.length ? `<div class="bk-months">${monthRows.map(([k, x]) => `<div>
                    <span>${new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</span>
                    <i title="Earned ${money(x.earned)} · paid ${money(x.paid)}"><em style="width:${(x.earned / maxMonth) * 100}%"></em><em class="paid" style="width:${(x.paid / maxMonth) * 100}%"></em></i>
                    <b>${moneyShort(x.earned)}<small>${x.trips ? plural(x.trips, 'trip') : x.qty ? `${count(x.qty)} bricks` : ''}</small></b></div>`).join('')}
                    <div class="bk-months-key"><span><i></i>Earned</span><span><i class="paid"></i>Paid</span></div></div>` : '<p class="small muted">Nothing yet</p>')}
                ${card('Advances owed', 'hand', owed.length ? owed.map(a => `<div class="bk-adv-mini"><div class="bk-sr-line"><b>${esc(a.slipNo)}</b><b class="neg">${money(a.outstanding)}</b></div>
                    <i class="bk-mini-bar violet"><em style="width:${num(a.amount) ? (num(a.recovered) / num(a.amount)) * 100 : 0}%"></em></i>
                    <small>${dayLabel(a.givenOn)} · ${money(a.amount)} given · ${money(a.recovered)} back${a.recoverPerCycle ? ` · ${money(a.recoverPerCycle)} a ${r.salaryType === 'MONTHLY' ? 'month' : 'week'}` : ''}</small>
                    <small class="muted">“${esc(a.narrative || '')}”</small></div>`).join('') : '<p class="small muted">Nothing owed.</p>')}
            </div>
        </div>`;
}

/** One of our vehicles: what it is, and its trips. */
function vehiclePane(v, trips, meta) {
    const monthStart = firstOfMonth(0);
    const dayOfTrip = t => t.deliveredAt ? String(t.deliveredAt).slice(0, 10) : t.scheduledOn;
    const month = trips.filter(t => t.status === 'DELIVERED' && dayOfTrip(t) >= monthStart);
    const coming = trips.filter(t => t.status !== 'DELIVERED');
    const driver = meta.resources.find(r => r.id === v.driverId);
    return `<section class="bk-card bk-who-head">
            <div class="bk-mh-top"><span class="bk-plate lg">${esc(v.number)}</span>
                <div class="grow min-0"><h2>${esc(v.kind || 'Vehicle')} ${v.active ? '' : '<span class="badge gray sm">not in use</span>'}</h2>
                    <small class="muted">${v.companyOwned === false ? 'Hired regularly' : 'Company vehicle'} · ${count(v.capacity)} bricks a trip · ${driver ? `usually ${esc(driver.name)}` : 'no usual driver'}</small></div>
                <div class="bk-head-acts">${manage() ? `<button class="btn sm" data-edit-vehicle="${v.id}">${icon('edit')}Edit</button>` : ''}</div></div>
            <div class="bk-chipfigs in">
                ${chip('Trips this month', String(month.length), '', '', 'truck')}
                ${chip('Bricks this month', count(month.reduce((s, t) => s + t.bricks, 0)), '', '', 'layers')}
                ${chip('Coming up', String(coming.length), coming.length ? `${count(coming.reduce((s, t) => s + t.bricks, 0))} bricks` : '', '', 'calendar')}
                ${chip('Trips in all', String(trips.filter(t => t.status === 'DELIVERED').length), '', '', 'check-circle')}
            </div>
            ${v.note ? `<p class="small muted bk-note-p">${icon('info')}${esc(v.note)}</p>` : ''}
        </section>
        ${panel({ title: 'Trips', iconName: 'truck', bodyClass: 'flush', cls: 'bk-list-panel', sub: plural(trips.length, 'trip'),
            body: trips.length ? `<div class="bk-vtrips">${trips.map(t => `<a class="bk-vtrip" data-go="#/bricks/sales/${t.orderId}" href="#/bricks/sales/${t.orderId}">
                <span class="muted">${t.deliveredAt ? dayLabel(String(t.deliveredAt).slice(0, 10)) : dayLabel(t.scheduledOn)}</span>
                <span class="ellipsis"><b>${esc(t.customerName)}</b> <small class="muted">${esc(t.orderNo)} · trip ${t.tripNo}${t.address ? ` · ${esc(t.address)}` : ''}</small></span>
                <span class="ellipsis small">${esc(t.driver || '—')}</span><span class="r"><b>${count(t.bricks)}</b></span>
                <span>${t.status === 'DELIVERED' ? `<span class="badge good sm">${icon('check')}Delivered</span>` : `<span class="badge ${t.status === 'PLANNED' ? 'gray' : 'aqua'} sm">${esc(roleName(t.status))}</span>`}</span></a>`).join('')}</div>`
                : `<div class="empty bk-empty">${icon('truck')}<div>No trips yet</div></div>` })}`;
}

// ===================================================================== payments

async function payments({ body, tools, reload }) {
    const period = view.cycle === 'WEEKLY' ? weekOf(today(), view.back) : monthOf(today(), view.back);
    const [run, p] = await Promise.all([api.get('/bricks/payroll/run', { cycle: view.cycle, from: period.from, to: period.to }), api.get('/bricks/payroll')]);
    const slips = p.slips.filter(s => !view.slipFilter || (view.slipFilter === 'CANCELLED' ? s.status === 'CANCELLED' : s.kind === view.slipFilter && s.status !== 'CANCELLED'));
    const label = view.cycle === 'WEEKLY' ? `${dayLabel(period.from)} – ${dayLabel(period.to)}` : new Date(period.from + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const ded = x => x.advances.reduce((s, a) => s + num(a.suggested), 0);
    const due = run.reduce((s, x) => s + num(x.gross), 0), back = run.reduce((s, x) => s + ded(x), 0);
    const monthStart = firstOfMonth(0);
    const paidMonth = p.slips.filter(s => s.status === 'PAID' && s.kind !== 'ADVANCE' && s.paidOn >= monthStart).reduce((s, x) => s + num(x.net), 0);
    const owed = p.advances || [];
    const people = new Set(owed.map(a => a.resourceId)).size;
    const resOf = id => p.resources.find(v => v.resource.id === id);
    tools.innerHTML = `${chips('cycle', [['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly salaries']], view.cycle)}
        <div class="bk-period"><button class="btn sm ghost icon" data-back="1" title="Earlier">${icon('chevron-left')}</button><b>${esc(label)}</b>
            <button class="btn sm ghost icon" data-back="-1" ${view.back <= 0 ? 'disabled' : ''} title="Later">${icon('chevron-right')}</button></div>`;
    const work = x => `<table class="grid compact dense"><thead><tr><th>Date</th><th>Work</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${x.earnings.map(e => `<tr>
        <td class="nowrap">${dayLabel(e.earnedOn)}${e.earnedOn < period.from ? ' <span class="badge gray sm">earlier</span>' : ''}</td><td><b>${esc(e.label)}</b> <small class="muted">${esc(e.narrative || '')}</small></td>
        <td class="r">${e.quantity ? count(e.quantity) : ''}</td><td class="r muted">${num(e.rate) ? `₹${num(e.rate)}` : ''}</td><td class="r">${money(e.amount)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">No work items</td></tr>'}${num(x.wage) ? `<tr><td></td><td><b>${esc(x.wageLabel || 'Wage')}</b></td><td></td><td></td><td class="r">${money(x.wage)}</td></tr>` : ''}</tbody>
        <tfoot><tr><td colspan="4">Earned</td><td class="r">${money(x.gross)}</td></tr></tfoot></table>${x.wageNote ? `<p class="small muted">${esc(x.wageNote)}</p>` : ''}`;
    body.innerHTML = `
        <div class="bk-chipfigs">
            ${chip(view.cycle === 'WEEKLY' ? 'Earned this week' : 'Salaries this month', moneyShort(due), `${run.length} to pay`, '', 'trending')}
            ${chip('Advances back', moneyShort(back), 'suggested', '', 'undo')}
            ${chip('To pay out', moneyShort(due - back), 'after advances', due ? 'warn' : '', 'hand-coins')}
            ${chip('Paid this month', moneyShort(paidMonth), 'on slips', '', 'check-circle')}
            ${chip('Advances out', moneyShort(p.advancesOutstanding), plural(people, 'person', 'people'), num(p.advancesOutstanding) ? 'bad' : '', 'hand')}
        </div>
        ${panel({ title: view.cycle === 'WEEKLY' ? 'To pay this week' : 'Salaries this month', iconName: 'hand-coins', bodyClass: 'flush', cls: 'bk-list-panel',
            sub: `${view.cycle === 'WEEKLY' ? 'work not paid yet, up to the week’s end' : 'staff on a monthly salary'} · ${money(due - back)}`,
            body: rowsHtml(run, { key: x => x.resource.resource.id, cols: 'minmax(0,1.1fr) minmax(0,1.8fr) 88px 84px 92px 58px',
                empty: `Nothing due for ${label}`,
                line: x => `<span class="bk-who"><i class="bk-avatar xs ${roleLook(x.resource.resource.role).tone}">${esc(initials(x.resource.resource.name))}</i><b class="ellipsis">${esc(x.resource.resource.name)}</b></span>
                    <span class="ellipsis small">${summarise(x.earnings)}${num(x.wage) ? `${x.earnings.length ? ' · ' : ''}${esc(x.resource.resource.salaryType === 'MONTHLY' ? 'Salary' : 'Wage')} <b>${moneyShort(x.wage)}</b>` : ''}</span>
                    <span class="r">${money(x.gross)}</span><span class="r ${ded(x) ? 'neg' : 'muted'}">${ded(x) ? '− ' + money(ded(x)) : '—'}</span>
                    <span class="r"><b>${money(num(x.gross) - ded(x))}</b></span>
                    ${actions([manage() && `<button class="btn sm primary" data-pay="${x.resource.resource.id}">Pay</button>`])}`,
                detail: x => {
                    const r = x.resource.resource, rv = x.resource;
                    return `<div class="bk-detail-grid pay">
                        <section><h4>${icon('check-circle')}Work to pay</h4>${work(x)}</section>
                        <section><h4>${icon('hand')}Advances to take back</h4>${x.advances.map(a => `<div class="bk-adv-mini"><div class="bk-sr-line"><b>${esc(a.slipNo)} · ${dayLabel(a.givenOn)}</b><b class="neg">− ${money(a.suggested)}</b></div>
                            <i class="bk-mini-bar violet"><em style="width:${num(a.amount) ? (num(a.recovered) / num(a.amount)) * 100 : 0}%"></em></i>
                            <small>${money(a.amount)} given · ${money(a.outstanding)} owed${a.recoverPerCycle ? ` · ${money(a.recoverPerCycle)} a ${view.cycle === 'MONTHLY' ? 'month' : 'week'} agreed` : ''}</small>
                            <small class="muted">“${esc(a.narrative)}”</small></div>`).join('') || '<p class="small muted">None owed.</p>'}</section>
                        <section class="bk-detail-side"><div class="bk-net small">
                            <div><span>Earned</span><b>${money(x.gross)}</b></div>${ded(x) ? `<div><span>Advance back</span><b class="neg">− ${money(ded(x))}</b></div>` : ''}
                            <div class="total"><span>To pay</span><b>${money(num(x.gross) - ded(x))}</b></div></div>
                            <dl class="bk-crew"><div><dt>Paid by</dt><dd>${esc(PAY[r.salaryType])}</dd></div><div><dt>Last paid</dt><dd>${rv.lastPaidOn ? dayLabel(rv.lastPaidOn) : 'never'}</dd></div>
                                ${r.upiId ? `<div><dt>UPI</dt><dd>${esc(r.upiId)}</dd></div>` : ''}${r.phone ? `<div><dt>Mobile</dt><dd><a href="tel:${telOf(r.phone)}">${esc(r.phone)}</a></dd></div>` : ''}</dl>
                            ${manage() ? `<button class="btn sm primary" data-pay="${r.id}">${icon('hand-coins')}Make the slip</button>` : ''}</section>
                    </div>`;
                } }) })}
        ${panel({ title: 'Advances owed', iconName: 'hand', bodyClass: 'flush', cls: 'bk-list-panel', sub: `${plural(owed.length, 'advance')} · ${money(p.advancesOutstanding)} to take back`,
            body: rowsHtml(owed, { key: a => a.advance.advanceId, cols: 'minmax(0,1.1fr) 82px 84px minmax(0,1.5fr) 88px 120px 88px 34px', empty: 'Nobody owes an advance',
                line: a => {
                    const x = a.advance;
                    const pct = num(x.amount) ? (num(x.recovered) / num(x.amount)) * 100 : 0;
                    return `<span class="bk-who"><i class="bk-avatar xs ${roleLook(a.role).tone}">${esc(initials(a.resourceName))}</i><b class="ellipsis">${esc(a.resourceName)}</b></span>
                        <span><b>${esc(x.slipNo)}</b></span><span class="muted">${dayLabel(x.givenOn)}</span><span class="ellipsis small muted">“${esc(x.narrative || '')}”</span>
                        <span class="r">${money(x.amount)}</span><span><i class="bk-mini-bar violet" title="${pct.toFixed(0)}% back"><em style="width:${pct}%"></em></i></span>
                        <span class="r"><b class="neg">${money(x.outstanding)}</b></span>${actions([iconBtn(`data-slip="${x.advanceId}"`, 'receipt', 'Open the advance slip')])}`;
                },
                detail: a => {
                    const x = a.advance, rv = resOf(a.resourceId);
                    return `<div class="bk-slip-peek"><dl class="bk-crew">
                        <div><dt>Given</dt><dd>${money(x.amount)} on ${date(x.givenOn)}</dd></div><div><dt>Taken back</dt><dd>${money(x.recovered)}</dd></div>
                        <div><dt>Still owed</dt><dd><b class="neg">${money(x.outstanding)}</b></dd></div>
                        <div><dt>Recovery</dt><dd>${x.recoverPerCycle ? `${money(x.recoverPerCycle)} a ${rv?.resource.salaryType === 'MONTHLY' ? 'month' : 'week'}` : 'all from the next payment'}</dd></div>
                        ${x.recoverPerCycle ? `<div><dt>Done in about</dt><dd>${Math.ceil(num(x.outstanding) / num(x.recoverPerCycle))} more ${rv?.resource.salaryType === 'MONTHLY' ? 'months' : 'weeks'}</dd></div>` : ''}
                        ${rv ? `<div><dt>Due to them now</dt><dd>${money(rv.unpaid)}</dd></div>` : ''}
                        <div class="wide"><dt>Why</dt><dd>${esc(x.narrative || '—')}</dd></div></dl>
                        <span class="row wrap"><button class="btn sm" data-slip="${x.advanceId}">${icon('receipt')}View slip</button>
                            ${manage() && rv?.resource.active ? `<button class="btn sm ghost" data-go="#/bricks/team">${icon('users')}Their record</button>` : ''}</span></div>`;
                } }) })}
        ${panel({ title: 'Payment slips', iconName: 'receipt', bodyClass: 'flush', cls: 'bk-list-panel', sub: plural(slips.length, 'slip'),
            actions: chips('slips', [['', 'All'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['ADVANCE', 'Advances'], ['CANCELLED', 'Cancelled']], view.slipFilter),
            body: rowsHtml(slips, { key: s => s.id, cols: '76px 82px minmax(0,1.1fr) minmax(0,1.3fr) 84px 80px 90px 34px', empty: 'No slips yet',
                line: s => `<span><b>${esc(s.slipNo)}</b></span><span class="muted">${dayLabel(s.paidOn)}</span>
                    <span class="bk-who"><i class="bk-avatar xs ${roleLook(s.role).tone}">${esc(initials(s.resourceName))}</i><span class="ellipsis">${esc(s.resourceName)}</span></span>
                    <span class="ellipsis small">${s.kind === 'ADVANCE' ? `<span class="badge violet sm">${icon('hand')}Advance</span> <span class="muted">${esc(s.narrative || '')}</span>` : `<span class="muted">${dayLabel(s.periodFrom)} – ${dayLabel(s.periodTo)}</span>`}</span>
                    <span class="r">${s.kind === 'ADVANCE' ? '' : money(s.gross)}</span><span class="r ${num(s.deductions) ? 'neg' : 'muted'}">${num(s.deductions) ? '− ' + money(s.deductions) : '—'}</span>
                    <span class="r"><b class="${s.status === 'CANCELLED' ? 'strike' : ''}">${money(s.net)}</b></span>
                    ${actions([iconBtn(`data-slip="${s.id}"`, 'printer', 'Open the slip')])}`,
                detail: s => `<div class="bk-slip-peek"><dl class="bk-crew">
                    <div><dt>Status</dt><dd>${s.status === 'CANCELLED' ? '<span class="badge gray sm">Cancelled</span>' : '<span class="badge good sm">Paid</span>'}</dd></div>
                    <div><dt>To</dt><dd>${esc(s.resourceName)} <small class="muted">${esc(roleName(s.role))}</small></dd></div>
                    ${s.kind === 'ADVANCE' ? `<div><dt>Advance</dt><dd>${money(s.net)}</dd></div>` : `<div><dt>Period</dt><dd>${date(s.periodFrom)} – ${date(s.periodTo)}</dd></div>
                        <div><dt>Earned</dt><dd>${money(s.gross)}</dd></div><div><dt>Advance taken back</dt><dd>${num(s.deductions) ? `− ${money(s.deductions)}` : '—'}</dd></div>
                        <div><dt>Net paid</dt><dd><b>${money(s.net)}</b></dd></div>`}
                    <div><dt>Paid on</dt><dd>${date(s.paidOn)}</dd></div><div><dt>From</dt><dd>${esc(s.account || '—')}</dd></div>
                    ${s.narrative ? `<div class="wide"><dt>Note</dt><dd>${esc(s.narrative)}</dd></div>` : ''}</dl>
                    <button class="btn sm primary" data-slip="${s.id}">${icon('receipt')}View &amp; print</button></div>` }) })}`;
    const refresh = () => payments({ body, tools, reload });
    tools.onclick = e => {
        const c = e.target.closest('[data-cycle]');
        if (c) { view.cycle = c.dataset.cycle; view.back = 0; refresh(); }
        const b = e.target.closest('[data-back]');
        if (b) { view.back = Math.max(0, view.back + Number(b.dataset.back)); refresh(); }
    };
    body.onclick = async e => {
        const f = e.target.closest('[data-slips]');
        if (f) { view.slipFilter = f.dataset.slips; return refresh(); }
        const pay = e.target.closest('[data-pay]');
        if (pay) return openSlip(Number(pay.dataset.pay), view.cycle, period.from, period.to, (_, msg) => { toast(msg); refresh(); });
        const go = e.target.closest('[data-go]');
        if (go) {
            const a = owed.find(x => go.closest('[data-key]')?.dataset.key === String(x.advance.advanceId));
            if (a) view.teamSel = `r${a.resourceId}`;
            location.hash = go.dataset.go;
            return;
        }
        const s = e.target.closest('[data-slip]');
        if (s) openSlipView(await api.get(`/bricks/payroll/slips/${s.dataset.slip}`), { onCancelled: manage() ? refresh : null });
    };
}

function summarise(earnings) {
    const by = {};
    earnings.forEach(e => { const k = e.label; by[k] = by[k] || { n: 0, q: 0, a: 0 }; by[k].n++; by[k].q += num(e.quantity); by[k].a += num(e.amount); });
    return Object.entries(by).map(([k, v]) => `${esc(k)} ${k === 'Delivery trip' ? '× ' + v.n : v.q ? count(v.q) : ''} <b>${moneyShort(v.a)}</b>`).join(' · ');
}

// ===================================================================== accounts

async function accounts({ body, tools, params, reload }) {
    const book = await api.get('/bricks/book');
    let selId = params[0] ? Number(params[0]) : book[0]?.id;
    const cash = book.filter(a => a.book && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.type));
    const groups = [['Money', cash], ['Customers & staff', book.filter(a => a.book && a.type === 'RECEIVABLE')], ['Income', book.filter(a => a.book && a.accountClass === 'INCOME')],
        ['Costs', book.filter(a => a.book && a.accountClass === 'EXPENSE')], ['My accounts used', book.filter(a => !a.book)]].filter(([, l]) => l.length);
    const iconOf = a => a.accountClass === 'INCOME' ? 'arrow-in' : a.accountClass === 'EXPENSE' ? 'arrow-out' : a.type === 'CASH' ? 'cash' : a.type === 'RECEIVABLE' ? 'hand-coins' : 'bank';
    tools.innerHTML = `<span class="bk-tool-fig">Cash &amp; bank <b>${money(cash.reduce((s, a) => s + num(a.balance), 0))}</b></span>
        ${manage() ? `<button class="btn sm" data-transfer>${icon('transfer')}Move money</button><button class="btn sm primary" data-new>${icon('plus')}Account</button>` : ''}`;
    body.innerHTML = `
        <div class="bk-acct-groups">${groups.map(([g, list]) => `<div class="bk-acct-group"><span class="bk-acct-group-name">${esc(g)}</span>
            <div class="bk-acct-strip">${list.map(a => `<button class="bk-acct ${a.id === selId ? 'selected' : ''} ${a.accountClass.toLowerCase()}" data-acct="${a.id}" title="${esc(a.name)}">
                <span class="chip-icon sm">${icon(iconOf(a))}</span><span class="grow min-0"><small class="ellipsis">${esc(a.name.replace(/^Brick · /, ''))}</small>
                <b class="${num(a.balance) < 0 ? 'neg' : ''}">${moneyShort(a.balance)}</b></span>${a.entries ? `<i>${a.entries}</i>` : ''}</button>`).join('')}</div></div>`).join('')}</div>
        <div id="bk-stmt"></div>`;
    const stmt = body.querySelector('#bk-stmt');
    const PRESET = [['m0', 'This month', () => firstOfMonth(0)], ['m2', '3 months', () => firstOfMonth(-2)], ['m5', '6 months', () => firstOfMonth(-5)], ['y', 'This year', () => `${new Date().getFullYear()}-01-01`]];
    const show = async id => {
        const a = book.find(x => x.id === id);
        if (!a) { stmt.innerHTML = ''; return; }
        const r = await api.get(`/bricks/book/accounts/${id}/statement`, view.stmt);
        stmt.innerHTML = panel({ title: a.name, iconName: 'journal', bodyClass: 'flush', cls: 'bk-stmt-panel',
            sub: `${a.book ? '' : 'only the brick business’s entries · '}opening ${money(r.openingBalance)} · in ${money(r.totalDebit)} · out ${money(r.totalCredit)} · closing <b>${money(r.closingBalance)}</b>`,
            actions: `<div class="seg-chips sm">${PRESET.map(([k, l, f]) => `<button class="seg-chip ${view.stmt.from === f() && view.stmt.to === isoDate() ? 'active' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
                <input type="date" data-from value="${view.stmt.from}"><input type="date" data-to value="${view.stmt.to}">`,
            body: r.rows.length ? `<div class="scroll"><table class="grid bk-ledger"><thead><tr><th>Date</th><th>Entry</th><th>Narration</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
                <tbody>${r.rows.map(x => `<tr data-entry="${x.entryId}" class="clickable"><td>${dayLabel(x.date)}</td>
                    <td class="nowrap">${kindChip(x.voucherType, 'xs', x.voucherLabel)}<b>${esc(x.entryNo)}</b></td>
                    <td><span class="bk-narr" title="${esc(x.narration)}${x.counterAccounts ? ` · ${esc(x.counterAccounts)}` : ''}">${x.brick?.ref ? `<em>${esc(x.brick.what)} · ${esc(x.brick.ref)}</em>` : ''}${esc(x.narration)}
                        ${x.counterAccounts ? `<small>↔ ${esc(x.counterAccounts)}</small>` : ''}</span></td>
                    <td class="r">${num(x.debit) ? money(x.debit) : ''}</td><td class="r">${num(x.credit) ? money(x.credit) : ''}</td><td class="r"><b>${money(x.balance)}</b></td></tr>`).join('')}</tbody></table></div>`
                : emptyState('No entries in this period', 'journal') });
        const range = () => { view.stmt = { from: stmt.querySelector('[data-from]').value, to: stmt.querySelector('[data-to]').value }; show(id); };
        stmt.querySelectorAll('[data-from],[data-to]').forEach(i => i.addEventListener('change', range));
        stmt.querySelector('.seg-chips').addEventListener('click', e => {
            const p = PRESET.find(x => x[0] === e.target.closest('[data-preset]')?.dataset.preset);
            if (p) { view.stmt = { from: p[2](), to: isoDate() }; show(id); }
        });
        stmt.querySelector('tbody')?.addEventListener('click', async e => {
            const row = e.target.closest('[data-entry]');
            if (!row) return;
            const entry = await api.get(`/transactions/${row.dataset.entry}`).catch(() => null);
            if (entry) toggleEntryRow(row, entry, { onChanged: () => show(id) });
        });
    };
    tools.onclick = e => {
        if (e.target.closest('[data-new]')) openBookAccount(done(reload));
        if (e.target.closest('[data-transfer]')) openTransfer(done(reload));
    };
    body.querySelector('.bk-acct-groups').addEventListener('click', e => {
        const a = e.target.closest('[data-acct]');
        if (!a) return;
        selId = Number(a.dataset.acct);
        body.querySelectorAll('[data-acct]').forEach(x => x.classList.toggle('selected', x === a));
        history.replaceState(null, '', `#/bricks/accounts/${selId}`);
        show(selId);
    });
    await show(selId);
}

// ===================================================================== set-up

async function setup({ body, tools, reload, meta }) {
    const s = meta.settings;
    const after = (m, msg) => { setMeta(m); toast(msg); reload(); };
    const add = (data, label) => manage() ? `<button class="btn sm" ${data}>${icon('plus')}${label}</button>` : '';
    const edit = data => manage() ? iconBtn(data, 'edit', 'Edit') : '';
    const del = data => manage() ? iconBtn(data, 'trash', 'Delete', 'danger') : '';
    const missingMrp = meta.types.filter(t => t.active && t.mrp === null).length;
    tools.innerHTML = manage() ? `<button class="btn sm primary" data-settings>${icon('settings')}Charges, payments &amp; documents</button>` : '';
    const card = (title, iconName, sub, actionsHtml, inner, cls = '') => `<section class="bk-set-card ${cls}"><header><span class="chip-icon sm">${icon(iconName)}</span>
        <div class="grow"><b>${esc(title)}</b><small>${sub}</small></div>${actionsHtml}</header>${inner}</section>`;
    body.innerHTML = `
        ${missingMrp ? `<div class="bk-getting-started">${icon('alert')}<div><b>${missingMrp} brick type${missingMrp === 1 ? ' has' : 's have'} no MRP</b><small>Orders fill the MRP in and show any discount against it.</small></div></div>` : ''}
        <div class="bk-set-section"><h3>${icon('brick')} What you make and sell</h3><div class="bk-set-grid">
            ${card('Brick types', 'brick', 'sizes, MRP and curing', add('data-type-new', 'Type'), `<div class="bk-set-rows">${meta.types.map(t => `<div class="${t.active ? '' : 'off'}">
                ${swatch(t.color)}<b class="grow">${esc(t.name)}</b><span>${t.mrp === null ? '<span class="badge warning sm">no MRP</span>' : `<b>${money(t.mrp, { decimals: 2 })}</b> MRP`}</span>
                <span class="muted">${t.curingDays ?? 0} d curing</span><span class="muted">${count(t.openingStock)} opening</span>${edit(`data-type="${t.id}"`)}${del(`data-type-del="${t.id}"`)}</div>`).join('')}</div>`)}
            ${card('Pricing models', 'percent', 'what production teams earn a brick', add('data-model-new', 'Model'), `<div class="scroll"><table class="grid compact dense bk-rate-matrix"><thead><tr><th>Model</th>
                ${meta.types.filter(t => t.active).map(t => `<th class="r">${swatch(t.color)}${esc(t.name)}</th>`).join('')}<th></th></tr></thead><tbody>${meta.models.map(m => `<tr class="${m.model.active ? '' : 'off'}">
                <td><b>${esc(m.model.name)}</b>${m.model.defaultModel ? ' <span class="badge good sm">default</span>' : ''}</td>
                ${meta.types.filter(t => t.active).map(t => `<td class="r">${m.rates[t.id] !== undefined ? `₹${m.rates[t.id]}` : '<span class="muted">—</span>'}</td>`).join('')}
                <td class="r nowrap">${edit(`data-model="${m.model.id}"`)}${m.model.defaultModel ? '' : del(`data-model-del="${m.model.id}"`)}</td></tr>`).join('')}</tbody></table></div>`)}
        </div></div>
        <div class="bk-set-section"><h3>${icon('factory')} Production</h3><div class="bk-set-grid">
            ${card('Raw materials', 'box', 'counted after each batch', add('data-mat-new', 'Material'), `<div class="bk-set-rows">${meta.materials.map(m => `<div class="${m.active ? '' : 'off'}">
                <b class="grow">${esc(m.name)}</b><span class="badge gray sm">${esc(m.unit)}</span><span class="muted">${qty(m.openingStock)} opening</span>
                <span class="muted">${m.reorderLevel !== null ? `reorder below ${qty(m.reorderLevel)}` : 'no reorder level'}</span>${edit(`data-mat="${m.id}"`)}${del(`data-mat-del="${m.id}"`)}</div>`).join('')}</div>`)}
            ${card('Expense heads', 'receipt', 'offered for production expenses', manage() ? `<button class="btn sm" data-settings>${icon('edit')}Edit</button>` : '',
                `<div class="bk-chips wrap">${meta.expenseHeads.map(h => `<em>${esc(h)}</em>`).join('')}</div>`)}
        </div></div>
        <div class="bk-set-section"><h3>${icon('truck')} Delivery</h3><div class="bk-set-grid">
            ${card('Vehicles', 'truck', 'their capacity plans the trips', add('data-vehicle-new', 'Vehicle'), `<div class="bk-set-rows">${meta.vehicles.map(v => `<div class="${v.active ? '' : 'off'}">
                <span class="bk-plate sm">${esc(v.number)}</span><b class="grow">${esc(v.kind || '')}</b><span><b>${count(v.capacity)}</b> a trip</span>
                <span class="muted">${esc(meta.resources.find(r => r.id === v.driverId)?.name || 'no driver')}</span>${edit(`data-vehicle="${v.id}"`)}</div>`).join('') || '<p class="small muted">No vehicles yet.</p>'}</div>`)}
            ${card('Charges', 'tag', 'delivery, incentives and handling', manage() ? `<button class="btn sm" data-settings>${icon('edit')}Edit</button>` : '', facts([
                ['Delivery charge', `${money(s.deliveryChargePerTrip)} a trip`], ['Free delivery', s.freeDeliveryMinQty ? `from ${count(s.freeDeliveryMinQty)} bricks` : 'never'],
                ['Driver incentive', `${money(s.driverIncentivePerTrip)} a trip`], ['Loading / unloading', `₹${num(s.loadingRate)} / ₹${num(s.unloadingRate)} a brick`],
                ['Billed to customers', s.billHandling ? 'loading & unloading too' : 'bricks and delivery only'], ['Weekly payday', ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][s.payDay || 6]]]))}
        </div></div>
        <div class="bk-set-section"><h3>${icon('stamp')} Payments &amp; documents</h3><div class="bk-set-grid">
            ${card('Customer payments', 'qr', 'on the order link', manage() ? `<button class="btn sm" data-settings>${icon('edit')}Edit</button>` : '', facts([
                ['UPI ID', s.upiId ? `<b>${esc(s.upiId)}</b>` : '<span class="warn">not set: the link cannot take payments</span>'], ['Payee name', esc(s.payeeName || '—')]]))}
            ${card('Letterhead, stamp & signatures', 'signature', 'on bills, invoices and payment slips', manage() ? `<button class="btn sm" data-settings>${icon('edit')}Edit</button>` : '',
                `<div class="bk-letter"><div class="bk-letter-head">${icon('brick')}<div><b>${esc(s.companyName || 'Company name not set')}</b><small>${esc(s.address || 'address')} · ${esc(s.phone || 'phone')}</small></div></div>
                <div class="bk-letter-sigs"><div>${s.accountantSignature ? signatureSvg(s.accountantSignature) : '<i></i>'}<small>${esc(s.accountantName || 'Accountant')}</small></div>
                    <div class="sealed"><span class="bk-letter-seal">${sealSvg(s.companyName || 'Company', 'SEAL')}</span>${s.ownerSignature ? signatureSvg(s.ownerSignature) : '<i></i>'}<small>${esc(s.ownerName || 'Owner')}</small></div></div></div>`)}
        </div></div>`;
    tools.onclick = e => { if (e.target.closest('[data-settings]')) openSettings(after); };
    body.onclick = async e => {
        const g = sel => e.target.closest(sel);
        if (g('[data-settings]')) return openSettings(after);
        if (g('[data-type-new]')) return openType(null, after);
        if (g('[data-type]')) return openType(meta.types.find(t => String(t.id) === g('[data-type]').dataset.type), after);
        if (g('[data-type-del]')) return confirmDelete('Delete this brick type? One with batches or orders is kept as no longer made.', async () => after(await api.del(`/bricks/types/${g('[data-type-del]').dataset.typeDel}`), 'Done'));
        if (g('[data-mat-new]')) return openMaterial(null, after);
        if (g('[data-mat]')) return openMaterial(meta.materials.find(m => String(m.id) === g('[data-mat]').dataset.mat), after);
        if (g('[data-mat-del]')) return confirmDelete('Delete this raw material? One already used is kept as no longer used.', async () => after(await api.del(`/bricks/materials/${g('[data-mat-del]').dataset.matDel}`), 'Done'));
        if (g('[data-model-new]')) return openModel(null, after);
        if (g('[data-model]')) return openModel(meta.models.find(m => String(m.model.id) === g('[data-model]').dataset.model), after);
        if (g('[data-model-del]')) return confirmDelete('Delete this pricing model?', async () => after(await api.del(`/bricks/pricing-models/${g('[data-model-del]').dataset.modelDel}`), 'Done'));
        if (g('[data-vehicle-new]')) return openVehicle(null, after);
        if (g('[data-vehicle]')) return openVehicle(meta.vehicles.find(v => String(v.id) === g('[data-vehicle]').dataset.vehicle), after);
    };
}

