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
import { esc, toast, panel, emptyState, downloadCsv, readForm, openModal, field, loadingDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, dateTime, isoDate, firstOfMonth, percent, shortDate } from '../core/format.js';
import { kindChip } from '../core/entry-kind.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { legend } from '../core/charts.js';
import { signatureSvg, sealSvg } from '../core/bond.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { drawBrickCharts, stockHtml, materialsHtml } from '../components/brick-dash.js';
import { loadMeta, setMeta, manage, num, count, qty, plural, roleName, orderBadge, confirmDelete, weekOf, monthOf, dayLabel, today,
    rowsHtml, bindRows, initials, roleLook, categoryOf, guard, moneyAccounts, moneyOptions, suggest, headIcon, factsHtml, journalPeek, loadAccess, getAccess, bcan, setWrites, seesMoney } from '../components/brick-common.js';
import { approvals, bellHtml, bindBell } from '../components/brick-approvals.js';
import { markSeen } from '../components/brick-alerts.js';
import { openType, openMaterial, openModel, openVehicle, openSettings, openBatch, openPurchase, openExpense, openResource, openBookAccount, openTransfer } from '../components/brick-forms.js';
import { openOrder, orderHtml, bindOrder, patchOrder, setOrderTab } from '../components/brick-orders.js';
import { openSlip, openAdvance, showSlip } from '../components/brick-pay.js';

// need: the permissions that open a section (any of them); write: the one its changes need (maker-checker roles)
const SECTIONS = [
    { key: 'overview', label: 'Overview', iconName: 'dashboard', note: 'Today, stock, orders, profit', group: 'The yard', need: ['STOCK', 'FINANCE'], write: null },
    { key: 'production', label: 'Production', iconName: 'factory', note: 'Batches, bricks made, the team’s pay', need: ['STOCK', 'PRODUCTION'], write: 'PRODUCTION' },
    { key: 'materials', label: 'Raw material', iconName: 'box', note: 'Stock, purchases, use per batch', need: ['STOCK', 'PURCHASES', 'PRODUCTION'], write: 'PURCHASES' },
    { key: 'expenses', label: 'Expenses', iconName: 'receipt', note: 'Diesel, power, repairs…', need: ['PURCHASES', 'FINANCE'], write: 'PURCHASES' },
    { key: 'sales', label: 'Sales & delivery', iconName: 'truck', note: 'Orders, trips, bills, invoices', group: 'Customers', bare: true, need: ['SALES', 'APPROVE'], write: 'SALES' },
    { key: 'approvals', label: 'Approvals', iconName: 'shield', note: 'What waits for a checker', need: ['SALES', 'APPROVE'], write: 'APPROVE' },
    { key: 'team', label: 'Team', iconName: 'users', note: 'Teams, labour, staff, vehicles', group: 'People & money', need: ['SETUP', 'FINANCE'], write: 'SETUP' },
    { key: 'payments', label: 'Payments', iconName: 'hand-coins', note: 'Weekly and monthly slips, advances', need: ['FINANCE'], write: 'FINANCE' },
    { key: 'accounts', label: 'Accounts', iconName: 'wallet', note: 'The brick book and statements', need: ['FINANCE'], write: 'FINANCE' },
    { key: 'setup', label: 'Set-up', iconName: 'settings', note: 'Types, MRP, rates, charges, people & access', group: 'Settings', need: ['SETUP'], write: 'SETUP' },
];

const view = { orderFilter: 'open', orderQ: '', orderDates: 'any', orderBy: 'order', orderFrom: '', orderTo: '',
    cycle: 'WEEKLY', back: 0, slipFilter: '', range: '30', from: '', to: '', team: '', batchQ: '', material: null, head: null,
    teamShow: 'all', teamQ: '', teamSel: null, txFilter: 'all',
    stmt: { from: firstOfMonth(-2), to: isoDate() } };

export async function render(container, params, isCurrent) {
    const acc = await loadAccess(true);
    // only the sections the role opens (set-up also for who manages users: people & access)
    const shown = SECTIONS.filter(s => bcan(...s.need) || (s.key === 'setup' && acc.manageAccess));
    if (!shown.length) {
        container.innerHTML = `<div class="page">${emptyState(`Brick Management is not open to your role (${acc.label}). Ask an admin for access.`, 'lock')}</div>`;
        return;
    }
    const active = shown.find(s => s.key === params[0]) || shown[0];
    setWrites(active.write);
    const meta = await loadMeta(true);
    if (!isCurrent()) return;
    container.innerHTML = `
    <div class="page reports-page bk-page">
        ${panel({
            title: meta.settings.companyName || 'Brick Management', iconName: 'brick', cls: 'p-report-nav bk-nav', actions: bellHtml(),
            body: `<div class="bk-role-chip" title="${esc(acc.description || '')}">${icon('shield')}<span>${esc(acc.label)}</span></div><div class="list">${shown.map(s => `
                ${s.group ? `<div class="section-title report-nav-sep">${esc(s.group)}</div>` : ''}
                <a class="list-item clickable ${s.key === active.key ? 'selected' : ''}" href="#/bricks/${s.key}" title="${esc(s.label)} · ↑ ↓ to move">
                    <span class="chip-icon sm">${icon(s.iconName)}</span>
                    <div class="grow"><div class="title">${esc(s.label)}</div><div class="meta">${esc(s.note)}</div></div>
                    ${s.key === 'approvals' && acc.pendingApprovals ? `<span class="bk-nav-count" title="Waiting">${acc.pendingApprovals}</span>` : ''}</a>`).join('')}</div>
                ${bcan('PRODUCTION') || bcan('SALES') ? `<div class="bk-nav-quick">${bcan('PRODUCTION') ? `<button class="btn sm" data-quick="batch">${icon('factory')}New batch</button>` : ''}
                    ${bcan('SALES') ? `<button class="btn sm primary" data-quick="order">${icon('cart')}New order</button>` : ''}</div>` : ''}`,
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
    bindBell(nav.querySelector('[data-bell]'));
    const draw = { overview: seesMoney() ? overview : yardOverview, production, materials, expenses, sales, approvals, team, payments, accounts, setup }[active.key];
    try {
        await draw({ body, tools, params: params.slice(1), reload, meta, isCurrent });
        if (params.length > 1) requestAnimationFrame(() => body.querySelector('.bk-row.open, .bk-side-row.selected, .bk-order-row.selected')?.scrollIntoView({ block: 'nearest' }));
    } catch (e) {
        body.innerHTML = emptyState(e.message, 'alert');
    }
}

const PERM_LABEL = { STOCK: 'See the stock', PRODUCTION: 'Batches', PURCHASES: 'Purchases & expenses', SALES: 'Orders & delivery', FINANCE: 'The money',
    APPROVE: 'Approves', SETUP: 'Set-up' };

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
/** A payment slip's lines, fetched when its row opens: the work it paid and the advances taken back. */
async function slipLines(id) {
    const v = await api.get(`/bricks/payroll/slips/${id}`);
    return `<div class="bk-slip-lines">${v.lines.length ? `<table class="grid compact dense"><thead><tr><th>Date</th><th>Paid for</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
        <tbody>${v.lines.map(l => `<tr><td class="nowrap">${dayLabel(l.earnedOn)}</td><td><b>${esc(l.label)}</b> <small class="muted">${esc(l.narrative || '')}</small></td>
            <td class="r">${l.quantity ? count(l.quantity) : ''}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Earned</td><td class="r">${money(v.slip.gross)}</td></tr></tfoot></table>` : ''}
        ${v.deductions.length ? `<div class="bk-slip-ded">${v.deductions.map(d => `<span>${icon('undo')}${esc(d.advanceNo)} taken back <b class="neg">− ${money(d.amount)}</b> <small class="muted">${money(d.balanceAfter)} still owed</small></span>`).join('')}</div>` : ''}
        <small class="muted">${esc(v.slip.mode || '')}${v.slip.reference ? ` · ${esc(v.slip.reference)}` : ''}${v.account ? ` · from ${esc(v.account)}` : ''} · by ${esc(v.slip.createdBy || '')}</small></div>
        ${await journalPeek(v.slip.journalEntryId)}`;
}

/** A payment or advance slip opened: what it paid, from where, in a neat grid (the lines and journal entry load under it). */
function slipPeek(s, who = false) {
    const adv = s.kind === 'ADVANCE';
    return `<div class="bk-peek"><div class="bk-peek-h">${icon(adv ? 'hand' : 'hand-coins')}<b>${adv ? 'Advance' : 'Payment'} ${esc(s.slipNo)}</b><span class="muted">${date(s.paidOn)}</span>
            ${s.status === 'CANCELLED' ? '<span class="badge gray sm">Cancelled</span>' : adv ? '<span class="badge violet sm">Given</span>' : '<span class="badge good sm">Paid</span>'}
            <span class="spacer"></span><b class="${s.status === 'CANCELLED' ? 'strike' : ''}">${money(s.net)}</b></div>
        ${factsHtml([
            ['To', who ? `${esc(s.resourceName)} <small>${esc(roleName(s.role))}</small>` : ''],
            ['Period', adv ? '' : `${date(s.periodFrom)} – ${date(s.periodTo)}`],
            ['Earned', adv ? '' : money(s.gross)],
            ['Advance back', adv ? '' : num(s.deductions) ? `<span class="neg">− ${money(s.deductions)}</span>` : '<span class="muted">—</span>'],
            [adv ? 'Given' : 'Net paid', `<b>${money(s.net)}</b>`],
            ['From', esc(s.account || '')],
            [adv ? 'Why' : 'Note', s.narrative ? `<span class="muted">${esc(s.narrative)}</span>` : '', 'wide']])}
        <div class="bk-peek-acts"><button class="btn sm" data-slip="${s.id}">${icon('receipt')}View &amp; print</button></div></div>`;
}

/** How many good bricks one unit of a material made ("163 bricks a Ton"), from its use per 1,000 good bricks. */
const yieldOf = (perThousand, unit) => num(perThousand) > 0 ? `${count(Math.round(1000 / num(perThousand)))} bricks a ${esc(unit)}` : '—';

/** Bars as a small list: label, a bar and a value. */
const barList = (rows, empty = 'Nothing yet') => rows.length ? `<div class="bk-barlist">${rows.map(r => `<div title="${esc(r.title || '')}"><span class="ellipsis">${r.label}</span>
    <i><em style="width:${Math.max(2, r.pct)}%" class="${r.tone || ''}"></em></i><b>${r.value}</b></div>`).join('')}</div>` : `<p class="small muted">${esc(empty)}</p>`;
/** Inclusive date range from the range chips ('7', '30', '90', 'all') or a custom from / to. */
const rangeOf = () => view.range === 'custom' ? { from: view.from || null, to: view.to || null } : { from: sinceDays(view.range), to: null };
const inRange = (iso, r) => !!iso && (!r.from || iso >= r.from) && (!r.to || iso <= r.to);

// ===================================================================== overview

/**
 * The business at a glance, fitted to the window: today's figures in a strip; what needs attention with quick actions;
 * production against deliveries; this month's money (sales, costs, profit, per brick); the deliveries coming up; stock
 * and raw material; who owes for bricks. Each panel scrolls on its own.
 */
/**
 * The overview for a role that does not see the money (maker-checker): the yard as it stands, bricks and raw material,
 * what was made lately, the deliveries to do and what waits for approval; no sales, profit or balances.
 */
async function yardOverview({ body, tools }) {
    const acc = getAccess();
    const [p, orders] = await Promise.all([api.get('/bricks/production'), bcan('SALES') ? api.get('/bricks/orders').catch(() => []) : []]);
    const weekAgo = isoDate(new Date(Date.now() - 6 * 86400000));
    const week = p.batches.filter(b => b.batch.producedOn >= weekAgo);
    const made = week.reduce((s, b) => s + b.good, 0);
    const open = orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status));
    const toDeliver = open.reduce((s, o) => s + o.quantity - o.delivered, 0);
    const low = p.materials.filter(m => m.low);
    tools.innerHTML = `<span class="small muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <span class="badge gray sm" title="${esc(acc?.description || '')}">${icon('shield')}${esc(acc?.label || '')}</span>`;
    body.innerHTML = `
        <div class="bk-chipfigs">
            ${chip('Good bricks this week', count(made), plural(week.length, 'batch', 'batches'), '', 'factory')}
            ${chip('In the yard', count(p.stock.reduce((s, x) => s + Math.max(0, x.inYard), 0)), `${count(p.stock.reduce((s, x) => s + Math.max(0, x.available), 0))} free`, '', 'layers')}
            ${bcan('SALES') ? chip('To deliver', count(toDeliver), plural(open.length, 'open order'), '', 'truck') : ''}
            ${chip('Raw material low', String(low.length), low.length ? low.map(m => m.name).slice(0, 2).join(', ') : 'all fine', low.length ? 'bad' : '', 'box')}
            ${acc?.pendingApprovals ? chip('Waiting for approval', String(acc.pendingApprovals), 'see Approvals', 'warn', 'shield') : ''}
        </div>
        <div class="bk-fill bk-yard">
            ${card('Stock in the yard', 'layers', p.stock.length ? stockHtml(p.stock) : '<p class="small muted">No brick types</p>')}
            ${card('Raw material', 'box', p.materials.length ? materialsHtml(p.materials) : '<p class="small muted">No raw materials</p>')}
            ${bcan('SALES') ? card('Deliveries to do', 'truck', open.length ? `<div class="bk-kv">${open.slice(0, 12).map(o => `<div><span><a href="#/bricks/sales/${o.id}">${esc(o.orderNo)}</a> ${esc(o.customerName)}</span>
                <b>${count(o.quantity - o.delivered)} <small>${o.nextTrip ? `next ${shortDate(o.nextTrip)}` : `${o.tripsDone}/${o.trips} trips`}</small></b></div>`).join('')}</div>`
                : '<p class="small muted">Nothing to deliver.</p>') : ''}
            ${card('Made lately', 'factory', p.batches.length ? `<div class="bk-kv">${p.batches.slice(0, 8).map(b => `<div><span><a href="#/bricks/production/${b.batch.id}">${esc(b.batch.batchNo)}</a> ${dayLabel(b.batch.producedOn)}</span>
                <b>${count(b.good)} <small>good · ${esc(b.teamName || 'no team')}</small></b></div>`).join('')}</div>` : '<p class="small muted">No batches yet.</p>')}
        </div>`;
}

async function overview({ body, tools, meta }) {
    const b = await api.get('/bricks/dashboard');
    const k = b.kpis;
    const m = b.months.at(-1) || {};
    const prev = b.months.at(-2) || {};
    const costs = x => num(x.materials) + num(x.wages) + num(x.expenses);
    const setupDone = meta.types.some(t => t.mrp !== null) && meta.vehicles.length && meta.resources.length;
    const trend = (now, before) => !num(before) ? '' : `<em class="${num(now) >= num(before) ? 'pos' : 'neg'}">${num(now) >= num(before) ? '▲' : '▼'} ${percent(Math.abs((num(now) - num(before)) / num(before)) * 100, 0)}</em>`;
    tools.innerHTML = `<span class="small muted">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <button class="btn sm ghost icon" data-refresh title="Refresh">${icon('refresh')}</button>`;
    // what needs doing, the most pressing first; each opens the place to do it
    const todo = [
        k.awaitingConfirmation && ['warning', 'bell', `${plural(k.awaitingConfirmation, 'payment')} to confirm`, 'Customers reported paying on their link: check the bank', '#/bricks/sales'],
        k.overdueOrders && ['critical', 'clock', `${plural(k.overdueOrders, 'order')} past the date`, 'Needed by a day already gone', '#/bricks/sales'],
        k.lowMaterials && ['critical', 'box', `${plural(k.lowMaterials, 'raw material')} running low`, 'Below the reorder level', '#/bricks/materials'],
        ...b.stock.filter(s => s.available < 0).map(s => ['warning', 'layers', `${esc(s.name)}: ${count(-s.available)} short`, 'Booked for orders beyond what is in the yard', '#/bricks/production']),
        (k.tripsToday || k.onTheWay) && ['info', 'truck', `${plural(k.tripsToday, 'trip')} today${k.onTheWay ? ` · ${k.onTheWay} on the way` : ''}`, 'Load, dispatch and mark them delivered', '#/bricks/sales'],
        num(k.wagesDue) && ['info', 'hand-coins', `${money(k.wagesDue)} wages due`, 'Work done and not on a slip yet', '#/bricks/payments'],
        num(k.receivable) && ['info', 'arrow-in', `${money(k.receivable)} to collect`, 'For bricks already delivered', '#/bricks/sales'],
    ].filter(Boolean);
    // the server's insights, less those an item above already says (same subject)
    const subjects = [[k.awaitingConfirmation, /confirm|report/i], [k.overdueOrders, /overdue|late|past/i], [k.lowMaterials, /material|low/i],
        [k.tripsToday || k.onTheWay, /trip/i], [num(k.wagesDue), /wage/i], [num(k.receivable), /collect|owe|receivable/i]];
    const insights = b.insights.filter(i => !subjects.some(([on, re]) => on && re.test(`${i.title} ${i.text}`)));
    const maxMonth = Math.max(1, ...b.months.map(x => Math.max(num(x.revenue), costs(x))));
    const pl = [['Sales', m.revenue, 'sales'], ['Raw material', m.materials, 'cost'], ['Wages', m.wages, 'cost'], ['Expenses', m.expenses, 'cost']];
    const maxPl = Math.max(1, ...pl.map(x => num(x[1])));
    const costBrick = m.produced ? costs(m) / m.produced : null;
    const priceBrick = m.delivered ? num(m.revenue) / m.delivered : null;
    body.innerHTML = `
        ${setupDone || !manage() ? '' : `<div class="bk-getting-started">${icon('sparkles')}<div><b>Get started</b>
            <small>${[meta.types.some(t => t.mrp !== null) ? '' : '<a href="#/bricks/setup">set the MRP of your brick types</a>', meta.vehicles.length ? '' : '<a href="#/bricks/setup">add a vehicle</a>',
                meta.resources.length ? '' : '<a href="#/bricks/team">add your teams and drivers</a>'].filter(Boolean).join(' · ')}: then record batches and take orders.</small></div></div>`}
        <div class="bk-chipfigs">
            ${chip('Made', `${count(k.producedToday)}`, `today · ${count(k.producedMonth)} this month`, '', 'factory')}
            ${chip('In the yard', count(k.inYard), `${count(k.ready)} ready`, k.available < 0 ? 'warn' : '', 'stack')}
            ${chip('Open orders', String(k.openOrders), `${count(k.pendingBricks)} bricks`, k.overdueOrders ? 'warn' : '', 'cart')}
            ${chip('Sales', moneyShort(k.salesMonth), trend(m.revenue, prev.revenue) || (m.margin !== null && m.margin !== undefined ? `${percent(m.margin, 0)} margin` : 'this month'), '', 'trending')}
            ${chip('To collect', moneyShort(k.receivable), num(k.advancesHeld) ? `+${moneyShort(k.advancesHeld)} held` : 'delivered', num(k.receivable) ? 'warn' : '', 'arrow-in')}
            ${chip('Cash', moneyShort(k.cashInBook), 'in the book', num(k.cashInBook) < 0 ? 'bad' : '', 'wallet')}
        </div>
        <div class="bk-fill bk-ov">
            ${panel({ title: 'Needs attention', iconName: 'bell', cls: 'bk-ov-todo', bodyClass: 'flush', sub: todo.length ? plural(todo.length, 'item') : 'all clear',
                body: `<div class="bk-scroll"><div class="bk-todo">${todo.map(([tone, ic, title, text, href]) => `<a class="bk-todo-item ${tone}" href="${href}">
                    <span>${icon(ic)}</span><div><b>${title}</b><small>${esc(text)}</small></div>${icon('chevron-right', 'chev')}</a>`).join('')}
                    ${insights.map(i => `<div class="bk-todo-item ${esc(i.tone)}"><span>${icon(i.icon)}</span><div><b>${esc(i.title)}</b><small>${esc(i.text)}</small></div></div>`).join('')}
                    ${!todo.length && !insights.length ? `<div class="bk-todo-item good"><span>${icon('check')}</span><div><b>Nothing waiting</b><small>Orders, pay and stock are in order.</small></div></div>` : ''}</div></div>`,
                foot: manage() ? `<div class="bk-quick">
                    <button class="btn sm" data-q="batch">${icon('factory')}Batch</button><button class="btn sm" data-q="order">${icon('cart')}Order</button>
                    <button class="btn sm" data-q="purchase">${icon('box')}Purchase</button><button class="btn sm" data-q="expense">${icon('receipt')}Expense</button></div>` : '' })}
            ${panel({ title: 'Made & delivered', iconName: 'factory', cls: 'bk-ov-flow', bodyClass: 'chart', sub: 'good bricks a week, 12 weeks',
                actions: `<a class="btn sm ghost icon" href="#/bricks/production" title="Production">${icon('chevron-right')}</a>`,
                body: b.weeks.some(w => w.produced || w.delivered)
                    ? `<div class="chart-wrap">${legend([{ label: 'Made' }, { label: 'Delivered' }])}<div class="chart" id="bk-flow"></div></div>`
                    : emptyState('No batches yet', 'factory') })}
            ${panel({ title: 'This month’s money', iconName: 'pie', cls: 'bk-ov-money', bodyClass: 'flush',
                sub: m.month ? new Date(m.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long' }) : '',
                actions: `<a class="btn sm ghost icon" href="#/reports/bricks" title="Brick business report">${icon('chevron-right')}</a>`,
                body: `<div class="bk-scroll bk-money">
                    <div class="bk-pl">${pl.map(([l, v, cls]) => `<div><span>${l}</span><i><em class="${cls}" style="width:${(num(v) / maxPl) * 100}%"></em></i><b>${moneyShort(v)}</b></div>`).join('')}
                        <div class="total"><span>Profit</span><i></i><b class="${num(m.profit) < 0 ? 'neg' : 'pos'}">${money(m.profit)}</b></div></div>
                    <div class="hc-pr-figs"><span><small>Cost a brick made</small><b>${costBrick === null ? '—' : `₹${costBrick.toFixed(2)}`}</b></span>
                        <span><small>Sold at, a brick</small><b>${priceBrick === null ? '—' : `₹${priceBrick.toFixed(2)}`}</b></span>
                        <span><small>Received</small><b>${moneyShort(k.receiptsMonth)}</b></span></div>
                    <div class="bk-months6">${b.months.map(x => `<div title="${esc(x.month)}: sales ${money(x.revenue)} · costs ${money(costs(x))} · profit ${money(x.profit)}">
                        <span class="bars"><i class="s" style="height:${(num(x.revenue) / maxMonth) * 100}%"></i><i class="c" style="height:${(costs(x) / maxMonth) * 100}%"></i></span>
                        <small>${new Date(x.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}</small></div>`).join('')}
                        <div class="key"><span><i class="s"></i>Sales</span><span><i class="c"></i>Costs</span></div></div>
                    <dl class="bk-crew"><div><dt>Wages due</dt><dd class="${num(k.wagesDue) ? 'warn' : ''}">${money(k.wagesDue)}</dd></div>
                        <div><dt>Advances out</dt><dd>${money(k.advancesOutstanding)}</dd></div></dl></div>` })}
            ${panel({ title: 'Deliveries coming up', iconName: 'truck', cls: 'bk-ov-trips', bodyClass: 'flush', sub: plural(b.upcoming.length, 'trip'),
                actions: `<a class="btn sm ghost icon" href="#/bricks/sales" title="Sales & delivery">${icon('chevron-right')}</a>`,
                body: `<div class="bk-pipe">${[['RECEIVED', 'New'], ['LOADING', 'Loading'], ['DISPATCHED', 'Sent'], ['IN_TRANSIT', 'On way'], ['PART_DELIVERED', 'Part']].map(([s, l]) =>
                        `<div class="bk-pipe-step ${b.pipeline[s] ? 'has' : ''}"><b>${b.pipeline[s] || 0}</b><small>${l}</small></div>`).join('')}</div>
                    <div class="bk-scroll">${b.upcoming.length ? b.upcoming.map(t => `<a class="bk-up-row" href="#/bricks/sales/${t.orderId}">
                        <span class="chip-icon sm ${t.late ? 'coral' : t.status === 'PLANNED' ? 'gray' : 'aqua'}">${icon(t.status === 'PLANNED' ? 'calendar' : 'truck')}</span>
                        <div class="grow min-0"><b class="ellipsis">${esc(t.customer)}</b><small class="ellipsis">${esc(t.orderNo)} · trip ${t.tripNo} · ${count(t.bricks)} bricks${t.vehicle ? ` · ${esc(t.vehicle)}` : ''}</small></div>
                        <small class="${t.late ? 'neg' : 'muted'} nowrap">${t.status === 'PLANNED' ? (t.scheduledOn ? shortDate(t.scheduledOn) : 'no date') : t.status === 'IN_TRANSIT' ? 'on the way' : t.status.toLowerCase()}</small></a>`).join('')
                        : '<p class="small muted bk-pad">No trips waiting.</p>'}</div>` })}
            ${panel({ title: 'Stock & raw material', iconName: 'layers', cls: 'bk-ov-stock', bodyClass: 'flush',
                actions: `<a class="btn sm ghost icon" href="#/bricks/materials" title="Raw material">${icon('chevron-right')}</a>`,
                body: `<div class="bk-scroll bk-pad">${b.stock.length ? stockHtml(b.stock) : '<p class="small muted">No brick types</p>'}
                    <div class="section-title bk-st">Raw material cover</div>${b.materials.length ? materialsHtml(b.materials) : '<p class="small muted">No raw materials</p>'}</div>` })}
            ${panel({ title: 'Customers to collect from', iconName: 'arrow-in', cls: 'bk-ov-dues', bodyClass: 'flush', sub: moneyShort(k.receivable),
                body: `<div class="bk-scroll">${(b.dues || []).length ? b.dues.map(c => `<div class="bk-up-row">
                    <span class="bk-or-av">${esc(initials(c.name))}</span>
                    <div class="grow min-0"><b class="ellipsis">${esc(c.name)}</b><small class="ellipsis">${plural(c.orders, 'order')} · ${count(c.bricks)} bricks · last ${shortDate(c.lastOrder)}</small></div>
                    <span class="r"><b class="neg">${moneyShort(c.balance)}</b>${telOf(c.phone) ? `<a class="btn sm ghost icon" href="tel:${telOf(c.phone)}" title="Call ${esc(c.phone)}">${icon('phone')}</a>` : ''}</span></div>`).join('')
                    : `<p class="small muted bk-pad">Nobody owes for bricks.</p>`}
                    ${b.topCustomers.length ? `<div class="section-title bk-st bk-pad">Best customers</div>${b.topCustomers.map(c => `<div class="bk-up-row slim"><div class="grow min-0"><b class="ellipsis">${esc(c.name)}</b>
                        <small>${plural(c.orders, 'order')} · ${count(c.bricks)} bricks</small></div><b>${moneyShort(c.value)}</b></div>`).join('')}` : ''}</div>` })}
        </div>`;
    drawBrickCharts(body, b);
    tools.onclick = e => { if (e.target.closest('[data-refresh]')) overview({ body, tools, meta }); };
    body.onclick = guard(e => {
        const q = e.target.closest('[data-q]')?.dataset.q;
        const after = (_, msg) => { toast(msg); overview({ body, tools, meta }); };
        if (q === 'batch') return openBatch(null, after);
        if (q === 'order') return openOrder(null, (o, msg) => { toast(msg); location.hash = `#/bricks/sales/${o.order.id}`; });
        if (q === 'purchase') return openPurchase(null, after);
        if (q === 'expense') return openExpense(null, after);
    });
}

// ===================================================================== production

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All'], ['custom', 'Dates…']];

async function production({ body, tools, params, reload, meta }) {
    const p = await api.get('/bricks/production');
    const r = rangeOf();
    const q = view.batchQ.trim().toLowerCase();
    const list = p.batches.filter(b => (!r.from && !r.to || inRange(b.batch.producedOn, r)) && (!view.team || String(b.batch.teamId) === view.team)
        && (!q || `${b.batch.batchNo} ${b.teamName || ''} ${b.batch.note || ''} ${b.items.map(i => i.name).join(' ')}`.toLowerCase().includes(q)));
    const linked = params[0] ? p.batches.find(b => String(b.batch.id) === String(params[0])) : null;
    if (linked && !list.includes(linked)) list.unshift(linked);
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
            ${seesMoney() ? `${chip('Team earns', moneyShort(labour), made - dmg ? `₹${(labour / (made - dmg)).toFixed(2)}/brick` : '', '', 'hand-coins')}
            ${chip('Pay due', moneyShort(due), due ? 'on the next slip' : 'all paid', due ? 'warn' : '', 'clock')}` : ''}
        </div>
        <div class="bk-fill bk-prod">
            ${panel({ title: 'Batches', iconName: 'factory', bodyClass: 'flush', cls: 'bk-list-panel bk-tall', sub: plural(list.length, 'batch', 'batches'),
                actions: `<div class="bk-filters">
                    <label class="search-box sm bk-search">${icon('search')}<input type="search" data-bq placeholder="Batch, team, note" value="${esc(view.batchQ)}"></label>
                    <select data-team class="bk-select"><option value="">Every team</option>${teams.map(t => `<option value="${t.id}" ${String(t.id) === view.team ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
                    ${chips('range', RANGES, view.range)}
                    ${view.range === 'custom' ? `<span class="bk-dates"><input type="date" data-from value="${esc(view.from)}" max="${today()}"><span>–</span><input type="date" data-to value="${esc(view.to)}" max="${today()}"></span>` : ''}
                </div>`,
                body: `<div class="bk-scroll">${rowsHtml(list, { key: b => b.batch.id, open: params[0] || null, cols: seesMoney() ? '132px minmax(80px,.8fr) minmax(0,2fr) 64px 58px 84px 66px 56px' : '132px minmax(80px,.8fr) minmax(0,2fr) 64px 58px 56px',
                    head: ['Batch', 'Team', 'Bricks made', ['Good', 'r'], ['Damage', 'r'], ...(seesMoney() ? [['Team pay', 'r'], 'Paid'] : []), ''],
                    empty: 'No batches in this period',
                    line: b => `<span class="nowrap"><b>${esc(b.batch.batchNo)}</b> <small class="inline">${dayLabel(b.batch.producedOn)}</small></span>
                        <span class="ellipsis">${esc(b.teamName || '—')}</span>
                        <span class="ellipsis bk-types-line">${b.items.map(i => `${esc(i.name)} <b>${count(i.quantity)}</b>`).join(' · ')}</span>
                        <span class="r"><b>${count(b.good)}</b></span>
                        <span class="r ${b.total && b.damaged / b.total > 0.03 ? 'warn' : 'muted'}">${b.total ? percent((b.damaged / b.total) * 100) : '—'}</span>
                        ${seesMoney() ? `<span class="r">${b.earningId ? money(b.labour) : '<span class="muted">—</span>'}</span>
                        <span>${b.paidOn ? `<span class="badge good sm">${icon('check')}Paid</span>` : b.earningId ? '<span class="badge warning sm">Due</span>' : ''}</span>` : ''}
                        ${b.open ? actions([manage() && iconBtn(`data-edit="${b.batch.id}"`, 'edit', 'Edit'), manage() && !b.paidOn && iconBtn(`data-del="${b.batch.id}"`, 'trash', 'Delete', 'danger')])
                            : `<span class="bk-acts"><span class="muted" title="Closed: only the last batch can be changed">${icon('lock')}</span></span>`}`,
                    detail: batchDetail })}</div>`,
                foot: list.length ? `<div class="bk-list-foot"><span>Good <b>${count(made - dmg)}</b></span><span>Damaged <b>${count(dmg)}</b></span>${seesMoney() ? `<span>Team earns <b>${money(labour)}</b></span>` : ''}</div>` : '' })}
            <div class="bk-side-stats">${productionStats(p, list, r)}</div>
        </div>`;
    const refresh = () => production({ body, tools, params: [], reload, meta });
    tools.onclick = guard(e => { if (e.target.closest('[data-new]')) return openBatch(null, done(reload)); });
    body.onclick = guard(async e => {
        const rg = e.target.closest('[data-range]');
        if (rg) { view.range = rg.dataset.range; return refresh(); }
        const ed = e.target.closest('[data-edit]');
        if (ed) return openBatch(p.batches.find(x => String(x.batch.id) === ed.dataset.edit), done(reload));
        const sl = e.target.closest('[data-slip]');
        if (sl) return showSlip(sl.dataset.slip);
        const ex = e.target.closest('[data-batch-expense]');
        if (ex) return openExpense(null, (_, m) => { toast(m); refresh(); }, { batchId: Number(ex.dataset.batchExpense) });
        const del = e.target.closest('[data-del]');
        if (del && await confirmDelete('Delete this batch? Its bricks leave the stock.', () => api.del(`/bricks/batches/${del.dataset.del}`))) { toast('Batch deleted'); return refresh(); }
    });
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

/** The stats beside the batches: stock, output by day, by team, by brick type, the team's pay, bricks from each unit of raw material. */
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
            pct: (x.good / maxTeam) * 100, value: `${count(x.good)}${seesMoney() ? `<small>${moneyShort(x.earn)}${x.due ? ` · <em class="warn">${moneyShort(x.due)} due</em>` : ''}</small>` : ''}` })), 'No batches'))}
        ${card('By brick type', 'brick', barList(typeRows.map(([k, x]) => ({ label: esc(k), pct: (x.made / maxType) * 100, tone: x.made && x.dmg / x.made > 0.03 ? 'warn' : '',
            value: `${count(x.made)}<small class="${x.made && x.dmg / x.made > 0.03 ? 'warn' : ''}">${x.made ? percent((x.dmg / x.made) * 100) : '—'} lost</small>` })), 'No batches'))}
        ${!seesMoney() ? '' : card('The team’s pay', 'hand-coins', `<div class="hc-pr-figs two"><span><small>Paid</small><b class="pos">${money(paid)}</b></span><span><small>Due</small><b class="${owed ? 'warn' : ''}">${money(owed)}</b></span></div>
            <i class="hc-alloc-bar"><em style="width:${paid + owed ? (paid / (paid + owed)) * 100 : 0}%"></em></i>`)}
        ${matRows.length ? card('Bricks from the raw material', 'box', `<div class="bk-kv">${matRows.map(([k, x]) => `<div><span>${esc(k)}</span><b>${yieldOf((x.used / x.good) * 1000, x.unit)}</b></div>`).join('')}</div>`,
            r.from || r.to ? 'in this period' : 'all time') : ''}`;
}

/** A batch opened: its figures in a slim strip, then the bricks, the raw material and the team and pay, each on a tint of its own. */
function batchDetail(b) {
    const dmgPct = b.total ? (b.damaged / b.total) * 100 : 0;
    const counted = b.materials.filter(f => f.counted);
    const pay = b.paidOn
        ? `<span class="badge good sm">${icon('check')}Paid${b.paidDate ? ` ${esc(dayLabel(b.paidDate))}` : ''}</span> <button type="button" class="link-btn" data-slip="${b.slipId}">slip ${esc(b.paidOn)}</button>`
        : b.earningId ? '<span class="badge warning sm">Due</span> <small class="muted">on the next weekly slip</small>' : '<span class="muted">nothing earned by the brick</span>';
    const fig = (label, value, note = '', tone = '') => `<div class="${tone}"><span>${label}</span><b>${value}</b>${note ? `<em>${note}</em>` : ''}</div>`;
    return `<div class="bk-batch">
        <div class="bk-bfigs">
            ${fig('Made', count(b.total))}
            ${fig('Good', count(b.good), b.total ? `${(100 - dmgPct).toFixed(1)}%` : '', 'good')}
            ${fig('Damaged', count(b.damaged), `${dmgPct.toFixed(1)}%`, dmgPct > 3 ? 'warn' : '')}
            ${fig('Other costs', num(b.expenses) ? money(b.expenses) : '—')}
        </div>
        <div class="bk-batch-grid">
            <section class="bk-bsec s-bricks"><h4>${icon('brick')}Bricks by type</h4>
                <table class="grid compact dense bk-btable"><thead><tr><th>Type</th><th class="r">Made</th><th class="r">Lost</th><th class="r">Good</th><th class="r">Good %</th></tr></thead>
                <tbody>${b.items.map(i => `<tr><td><b>${esc(i.name)}</b></td><td class="r">${count(i.quantity)}</td>
                    <td class="r ${i.quantity && i.damaged / i.quantity > 0.03 ? 'neg' : 'muted'}">${i.damaged ? `${count(i.damaged)}<small>${((i.damaged / i.quantity) * 100).toFixed(1)}%</small>` : '—'}</td>
                    <td class="r"><b>${count(i.good)}</b></td><td class="r muted">${i.quantity ? `${((i.good / i.quantity) * 100).toFixed(1)}%` : '—'}</td></tr>`).join('')}</tbody>
                ${b.items.length > 1 ? `<tfoot><tr><td>Total</td><td class="r">${count(b.total)}</td><td class="r">${count(b.damaged)}</td><td class="r">${count(b.good)}</td><td class="r">${b.total ? `${((b.good / b.total) * 100).toFixed(1)}%` : ''}</td></tr></tfoot>` : ''}</table></section>
            <section class="bk-bsec s-mat"><h4>${icon('box')}Raw material</h4>${counted.length ? `<table class="grid compact dense bk-btable"><thead><tr><th>Material</th><th class="r">Had</th><th class="r">Left</th><th class="r">Used</th><th class="r">Bricks from it</th></tr></thead>
                <tbody>${counted.map(f => `<tr><td><b>${esc(f.name)}</b></td>
                    <td class="r">${qty(num(f.opening) + num(f.received))}${num(f.received) ? `<small class="pos">+${qty(f.received)} in</small>` : ''}</td>
                    <td class="r">${qty(f.closing)}</td><td class="r"><b>${qty(f.consumed)}</b> <small class="inline muted">${esc(f.unit)}</small></td>
                    <td class="r muted">${yieldOf(b.usePerThousand[f.materialId], f.unit)}</td></tr>`).join('')}</tbody></table>`
                : '<p class="small muted">Not counted after this batch: count what is left when recording a batch to see what it used.</p>'}</section>
            <section class="bk-bsec s-team"><h4>${icon('users')}${seesMoney() ? 'Team &amp; pay' : 'Team'}</h4>
                <dl class="bk-crew">
                    <div><dt>Team</dt><dd>${esc(b.teamName || 'none')}</dd></div><div><dt>Pricing model</dt><dd>${esc(b.modelName || '—')}</dd></div>
                    ${seesMoney() ? `<div class="wide"><dt>Pay</dt><dd>${pay}</dd></div>` : ''}
                    <div class="wide"><dt>Recorded</dt><dd><small>${esc(b.batch.createdBy || '')} · ${dateTime(b.batch.createdAt)}</small></dd></div>
                    ${b.batch.note ? `<div class="wide"><dt>Note</dt><dd>“${esc(b.batch.note)}”</dd></div>` : ''}
                </dl>
                ${manage() ? `<div class="row wrap bk-trip-acts">${b.open ? `<button class="btn sm" data-edit="${b.batch.id}">${icon('edit')}${b.paidOn ? 'Count & note' : 'Edit'}</button>`
                    : `<span class="badge gray sm" title="Its raw material was counted against the stock of that day and is kept as it was">${icon('lock')}Closed · only the last batch can change</span>`}
                    ${bcan('PURCHASES') ? `<button class="btn sm ghost" data-batch-expense="${b.batch.id}">${icon('receipt')}Add an expense</button>` : ''}</div>` : ''}
            </section>
        </div>
    </div>`;
}

// ===================================================================== raw material

/**
 * Raw material is never edited here: stock moves only by what is recorded, purchases in and the count after each batch
 * out. A side list of materials; the one picked shows how its stock is made up (opening + bought − used), then every
 * movement in one ledger with a running balance. A wrong purchase is reversed (and recorded again), not edited.
 */
async function materials({ body, tools, params, reload, meta }) {
    const p = await api.get('/bricks/production');
    if (params[0]) view.material = Number(params[0]) || null;
    const sel = p.materials.some(x => x.materialId === view.material) ? view.material : null;
    const m = p.materials.find(x => x.materialId === sel) || null;
    const def = meta.materials.find(x => x.id === sel);
    const stateOf = x => num(x.stock) <= 0 ? ['critical', 'Empty'] : x.low ? ['critical', 'Low'] : x.daysLeft !== null && x.daysLeft <= 7 ? ['warning', 'Order soon'] : ['good', 'In stock'];
    const monthStart = firstOfMonth(0);
    tools.innerHTML = manage() ? `<button class="btn sm primary" data-buy="${sel || ''}">${icon('plus')}Record purchase${m ? ` of ${esc(m.name)}` : ''}</button>` : '';
    // every movement: purchases in, use counted after batches out (newest first); one material gets a running balance
    const moves = [
        ...p.purchases.filter(x => !sel || x.purchase.materialId === sel).map(x => ({ kind: 'in', on: x.purchase.receivedOn, id: `p${x.purchase.id}`, qty: num(x.purchase.quantity), x })),
        ...p.batches.flatMap(b => b.materials.filter(f => (!sel || f.materialId === sel) && f.counted && num(f.consumed))
            .map(f => ({ kind: 'out', on: b.batch.producedOn, id: `b${b.batch.id}-${f.materialId}`, qty: num(f.consumed), b, f }))),
    ].sort((a, b) => String(b.on).localeCompare(String(a.on)) || (a.kind === 'out' ? -1 : 1));
    const bought = moves.filter(x => x.kind === 'in').reduce((s, x) => s + x.qty, 0);
    const used = moves.filter(x => x.kind === 'out').reduce((s, x) => s + x.qty, 0);
    if (m) {
        let bal = num(m.stock);
        moves.forEach(x => { x.after = bal; bal -= x.kind === 'in' ? x.qty : -x.qty; });
    }
    if (params[1]) view.moveFilter = 'all';   // a purchase opened by its link is shown whatever the filter
    const shown = moves.filter(x => view.moveFilter === 'all' || !view.moveFilter || x.kind === view.moveFilter);
    const unitOf = id => p.materials.find(x => x.materialId === id)?.unit || '';
    const sideRow = x => {
        const st = stateOf(x);
        const cover = num(x.stock) <= 0 ? 0 : x.daysLeft === null ? 100 : Math.min(100, (x.daysLeft / 30) * 100);
        return `<button class="bk-side-row ${sel === x.materialId ? 'selected' : ''}" data-mat="${x.materialId}">
            <span class="chip-icon sm ${st[0] === 'critical' ? 'red' : st[0] === 'warning' ? 'gold' : 'aqua'}">${icon('box')}</span>
            <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(x.name)}</b><b>${qty(x.stock)} <small>${esc(x.unit)}</small></b></span>
                <span class="bk-sr-line sub"><small>${x.daysLeft === null ? 'no use yet' : `${x.daysLeft} days left`}${num(x.avgDailyUse) ? ` · ${qty(x.avgDailyUse)}/day` : ''}</small>
                    <span class="badge sm ${st[0]}">${st[1]}</span></span>
                <i class="bk-meter ${st[0]}"><i style="width:${cover}%"></i></i></span></button>`;
    };
    const head = m ? (() => {
        const st = stateOf(m);
        const value = num(m.stock) * num(m.lastRate);
        const opening = num(m.stock) - bought + used;
        return `<section class="bk-card bk-mat-head">
            <div class="bk-mh-top"><span class="chip-icon">${icon('box')}</span><div class="grow min-0"><h2>${esc(m.name)}</h2>
                <small class="muted">${esc(m.unit)} · ${m.reorderLevel !== null ? `reorder below ${qty(m.reorderLevel)}` : 'no reorder level'}${m.lastRate ? ` · last bought at ₹${num(m.lastRate).toLocaleString('en-IN')}` : ''}</small></div>
                <span class="badge ${st[0]}">${icon(st[0] === 'good' ? 'check' : 'alert')}${st[1]}</span></div>
            <div class="bk-flow">
                <div><small>Opening</small><b>${qty(Math.round(opening * 1000) / 1000)}</b></div><i>+</i>
                <div class="in"><small>Bought</small><b>${qty(bought)}</b></div><i>−</i>
                <div class="out"><small>Used in batches</small><b>${qty(used)}</b></div><i>=</i>
                <div class="now"><small>In the yard</small><b>${qty(m.stock)} <span>${esc(m.unit)}</span></b></div>
                <div class="bk-flow-facts"><span>${m.daysLeft === null ? 'no use recorded yet' : `lasts about <b>${m.daysLeft}</b> days`}</span>
                    <span>${num(m.avgDailyUse) ? `<b>${qty(m.avgDailyUse)}</b> ${esc(m.unit)} a day` : ''}</span><span>${value && seesMoney() ? `worth <b>${moneyShort(value)}</b>` : ''}</span></div>
            </div>
            <i class="bk-meter ${st[0]}"><i style="width:${m.daysLeft === null ? 100 : Math.min(100, (m.daysLeft / 30) * 100)}%"></i></i>
            <small class="muted">${icon('lock')}The stock changes only by purchases and the count after each batch.${def && num(def.openingStock) ? ` Opening ${qty(def.openingStock)} is set in Set-up.` : ''}</small>
        </section>`;
    })() : `<section class="bk-card bk-mat-head"><div class="bk-mh-top"><span class="chip-icon">${icon('stack')}</span><div class="grow min-0"><h2>Every raw material</h2>
            <small class="muted">${plural(p.materials.length, 'material')} · ${plural(p.purchases.length, 'purchase')}</small></div></div>
        <div class="hc-pr-figs four"><span><small>Low</small><b class="${p.materials.some(x => x.low) ? 'neg' : ''}">${p.materials.filter(x => x.low).length}</b></span>
            <span><small>Order soon</small><b>${p.materials.filter(x => !x.low && x.daysLeft !== null && x.daysLeft <= 7).length}</b></span>
            ${seesMoney() ? `<span><small>Bought this month</small><b>${moneyShort(p.purchases.filter(x => x.purchase.receivedOn >= monthStart).reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span>
            <span><small>Bought in all</small><b>${moneyShort(p.purchases.reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span>`
            : `<span><small>Purchases</small><b>${p.purchases.length}</b></span><span><small>Materials</small><b>${p.materials.length}</b></span>`}</div></section>`;
    const issues = p.stockIssues || [];
    body.innerHTML = `${issues.length ? `<div class="bk-getting-started bk-stock-issue">${icon('alert')}<div><b>The balance kept for ${plural(issues.length, 'material')} does not match its purchases and counts</b>
            <small>${issues.map(x => `${esc(x.name)}: kept ${x.kept === null ? '—' : qty(x.kept)}, works out to ${qty(x.worked)} ${esc(x.unit)}`).join(' · ')}</small></div>
            ${manage() ? `<button class="btn sm primary" data-recount>${icon('refresh')}Recalculate</button>` : ''}</div>` : ''}
        <div class="bk-fill bk-twopane bk-threepane">
        <section class="panel headless bk-side-list"><div class="panel-body flush">
            <div class="bk-side-scroll">
                <button class="bk-side-row all ${sel ? '' : 'selected'}" data-mat=""><span class="chip-icon sm gray">${icon('stack')}</span>
                    <span class="grow min-0"><span class="bk-sr-line"><b>Every material</b><b>${plural(p.materials.length, 'item')}</b></span>
                    <span class="bk-sr-line sub"><small>${p.materials.filter(x => x.low).length} low · ${p.purchases.length} purchases</small></span></span></button>
                ${p.materials.map(sideRow).join('') || emptyState('No raw materials: add them in Set-up', 'box')}
            </div></div></section>
        <div class="bk-pane fixed">
            ${head}
            ${panel({ title: 'Stock movements', iconName: 'list', bodyClass: 'flush', cls: 'bk-list-panel bk-grow', sub: `${plural(shown.length, 'movement')}${sel ? '' : ' · every material'}`,
                actions: chips('moves', [['all', 'All'], ['in', 'Purchases'], ['out', 'Used']], view.moveFilter || 'all'),
                body: `<div class="bk-scroll">${rowsHtml(shown, { key: x => x.id, cls: 'bk-slim', open: params[1] || null, cols: `82px minmax(0,1.3fr) ${sel ? '' : 'minmax(0,1fr) '}minmax(70px,auto) 92px ${m ? '86px ' : ''}minmax(0,1fr)`,
                    head: ['Date', 'Movement', ...(sel ? [] : ['Material']), ['Quantity', 'r'], ['Amount', 'r'], ...(m ? [['Stock after', 'r']] : []), 'Vendor / team'],
                    load: x => x.kind === 'in' ? journalPeek(x.x.purchase.journalEntryId) : null,
                    empty: 'Nothing recorded yet: record a purchase, and count what is left when recording a batch',
                    line: x => `<span class="muted">${dayLabel(x.on)}</span>
                        <span class="bk-who"><span class="chip-icon sm ${x.kind === 'in' ? 'aqua' : 'gold'}">${icon(x.kind === 'in' ? 'arrow-in' : 'factory')}</span>
                            <b class="ellipsis">${x.kind === 'in' ? 'Bought' : `Used · ${esc(x.b.batch.batchNo)}`}</b></span>
                        ${sel ? '' : `<span class="ellipsis">${esc(x.kind === 'in' ? x.x.material : x.f.name)}</span>`}
                        <span class="r ${x.kind === 'in' ? 'pos' : 'neg'}"><b>${x.kind === 'in' ? '+' : '−'}${qty(x.qty)}</b> <small class="inline">${esc(x.kind === 'in' ? x.x.unit : x.f.unit)}</small></span>
                        <span class="r">${x.kind === 'in' ? `<b>${money(x.x.purchase.amount)}</b>` : '<span class="muted">—</span>'}</span>
                        ${m ? `<span class="r muted">${qty(Math.round(x.after * 1000) / 1000)}</span>` : ''}
                        <span class="ellipsis small muted">${x.kind === 'in' ? esc(x.x.purchase.vendor || '') : esc(x.b.teamName || '')}</span>`,
                    detail: x => x.kind === 'in' ? `<div class="bk-peek"><div class="bk-peek-h">${icon('arrow-in')}<b>Purchase of ${esc(x.x.material)}</b>
                            <span class="muted">${date(x.x.purchase.receivedOn)}</span><span class="spacer"></span><b class="pos">+${qty(x.x.purchase.quantity)} ${esc(x.x.unit)}</b></div>
                        ${factsHtml([
                            ['Quantity', `<b>${qty(x.x.purchase.quantity)}</b> ${esc(x.x.unit)}`],
                            ['Rate', x.x.purchase.rate ? `${money(x.x.purchase.rate, { decimals: 2 })} <small>a ${esc(x.x.unit)}</small>` : ''],
                            ['Amount', `<b>${money(x.x.purchase.amount)}</b>`],
                            ['Vendor', esc(x.x.purchase.vendor || '')],
                            ['Bill no.', x.x.purchase.billNo ? `<span class="mono">${esc(x.x.purchase.billNo)}</span>` : ''],
                            ['Vehicle', x.x.purchase.vehicleNo ? `<span class="bk-plate xs">${esc(x.x.purchase.vehicleNo)}</span>` : ''],
                            ['Paid from', esc(x.x.account || '')],
                            ['Stock after', m ? `${qty(Math.round(x.after * 1000) / 1000)} <small>${esc(x.x.unit)}</small>` : ''],
                            ['Recorded', `<small>${esc(x.x.purchase.createdBy || '')} · ${dateTime(x.x.purchase.createdAt)}</small>`],
                            ['Note', x.x.purchase.note ? `<span class="bk-quote">“${esc(x.x.purchase.note)}”</span>` : '', 'wide']])}
                        ${manage() ? `<div class="bk-peek-acts"><button class="btn sm ghost danger" data-reverse="${x.x.purchase.id}" title="Takes it out of the stock and the books; record it again if it was wrong">${icon('undo')}Reverse</button></div>` : ''}</div>`
                        : `<div class="bk-peek"><div class="bk-peek-h">${icon('factory')}<b>Used in ${esc(x.b.batch.batchNo)}</b><span class="muted">${date(x.b.batch.producedOn)}</span>
                            <span class="spacer"></span><b class="neg">−${qty(x.f.consumed)} ${esc(x.f.unit)}</b></div>
                        ${factsHtml([
                            ['Opening', `${qty(x.f.opening)} <small>${esc(x.f.unit)}</small>`], ['Received', num(x.f.received) ? `<span class="pos">+${qty(x.f.received)}</span>` : '<span class="muted">—</span>'],
                            ['Left after', `${qty(x.f.closing)} <small>${esc(x.f.unit)}</small>`], ['Used', `<b>${qty(x.f.consumed)}</b> <small>${esc(x.f.unit)}</small>`],
                            ['Bricks from it', yieldOf(x.b.usePerThousand[x.f.materialId], x.f.unit)],
                            ['The batch', `${count(x.b.good)} good bricks <small>· ${esc(x.b.teamName || 'no team')}</small>`]])}
                        <div class="bk-peek-acts"><a class="btn sm ghost" href="#/bricks/production/${x.b.batch.id}">${icon('factory')}Open ${esc(x.b.batch.batchNo)}</a></div></div>` })}</div>`,
                foot: shown.length ? `<div class="bk-list-foot"><span>Bought <b class="pos">+${qty(bought)}${sel ? ` ${esc(unitOf(sel))}` : ''}</b></span>
                    <span>Used <b class="neg">−${qty(used)}${sel ? ` ${esc(unitOf(sel))}` : ''}</b></span>${seesMoney() ? `<span>Spent <b>${money(p.purchases.filter(x => !sel || x.purchase.materialId === sel).reduce((s, x) => s + num(x.purchase.amount), 0))}</b></span>` : ''}</div>` : '' })}
        </div>
        <aside class="bk-side-stats">${materialStats(p, m)}</aside></div>`;
    const refresh = () => materials({ body, tools, params: [], reload, meta });
    const buy = id => openPurchase(null, (_, msg) => { toast(msg); invalidateAccounts(); refresh(); }, { materialId: id ? Number(id) : null });
    tools.onclick = guard(e => { const b = e.target.closest('[data-buy]'); if (b) return buy(b.dataset.buy); });
    body.onclick = guard(async e => {
        if (e.target.closest('[data-recount]')) {
            const r = await api.post('/bricks/materials/recount');
            toast(r.changed ? `${plural(r.changed, 'balance')} put right` : 'Every balance already matched');
            return refresh();
        }
        const b = e.target.closest('[data-buy]');
        if (b) return buy(b.dataset.buy);
        const mv = e.target.closest('[data-moves]');
        if (mv) { view.moveFilter = mv.dataset.moves; return refresh(); }
        const rv = e.target.closest('[data-reverse]');
        if (rv) {
            if (await confirmDelete('Reverse this purchase? It leaves the stock and the books; record it again with the right figures.', () => api.del(`/bricks/purchases/${rv.dataset.reverse}`))) {
                invalidateAccounts(); toast('Purchase reversed'); return refresh();
            }
            return;
        }
        const row = e.target.closest('[data-mat]');
        if (row) {
            view.material = row.dataset.mat ? Number(row.dataset.mat) : null;
            history.replaceState(null, '', `#/bricks/materials${view.material ? `/${view.material}` : ''}`);
            return refresh();
        }
    });
}

/**
 * Beside the movements. For one material: what is available and how long it lasts, what to order for a month and what it
 * costs, its use (a 1,000 bricks, batch by batch) and what it was bought at and from whom. For all: their cover, what to
 * order now and where the money went.
 */
function materialStats(p, m) {
    const monthStart = firstOfMonth(0);
    if (!m) {
        const mats = [...p.materials].sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
        const order = mats.filter(x => x.low || num(x.stock) <= 0 || (x.daysLeft !== null && x.daysLeft <= 7));
        const spend = {};
        p.purchases.forEach(x => { spend[x.material] = (spend[x.material] || 0) + num(x.purchase.amount); });
        const sp = Object.entries(spend).sort((a, b) => b[1] - a[1]);
        const month = p.purchases.filter(x => x.purchase.receivedOn >= monthStart).reduce((t, x) => t + num(x.purchase.amount), 0);
        return `
            ${card('Stock cover', 'layers', barList(mats.map(x => ({ label: esc(x.name), pct: num(x.stock) <= 0 ? 0 : x.daysLeft === null ? 100 : Math.min(100, (x.daysLeft / 30) * 100),
                tone: num(x.stock) <= 0 || x.low || (x.daysLeft !== null && x.daysLeft <= 7) ? 'warn' : '',
                value: `${qty(x.stock)} <small>${esc(x.unit)}${x.daysLeft !== null ? ` · ${x.daysLeft} d` : ''}</small>` })), 'No raw materials'), 'days it lasts')}
            ${card('To order now', 'cart', order.length ? `<div class="bk-kv">${order.map(x => {
                const need = Math.max(0, Math.ceil(num(x.avgDailyUse) * 30 - num(x.stock)));
                return `<div><span>${esc(x.name)}</span><b>${need ? `${qty(need)} ${esc(x.unit)}` : `<small class="muted">${num(x.stock) <= 0 ? 'empty · no use yet' : 'low'}</small>`}${need && x.lastRate ? ` <small>≈ ${moneyShort(need * num(x.lastRate))}</small>` : ''}</b></div>`;
            }).join('')}</div><small class="muted">enough for 30 days at the recent use</small>` : '<p class="small muted">Everything lasts more than a week.</p>')}
            ${!seesMoney() ? '' : card('Spend by material', 'pie', sp.length ? barList(sp.map(([k, v]) => ({ label: esc(k), pct: (v / sp[0][1]) * 100, value: moneyShort(v) })))
                + `<small class="muted">this month ${moneyShort(month)}</small>` : '<p class="small muted">Nothing bought yet.</p>')}`;
    }
    const buys = p.purchases.filter(x => x.purchase.materialId === m.materialId);
    const qtyAll = buys.reduce((t, x) => t + num(x.purchase.quantity), 0);
    const amtAll = buys.reduce((t, x) => t + num(x.purchase.amount), 0);
    const rates = buys.map(x => num(x.purchase.rate)).filter(Boolean);
    const daily = num(m.avgDailyUse);
    const need = Math.max(0, Math.ceil(daily * 30 - num(m.stock)));
    const uses = [...p.batches].reverse().map(b => [b, b.materials.find(f => f.materialId === m.materialId && f.counted)]).filter(([, f]) => f).slice(-12);
    const maxUse = Math.max(1, ...uses.map(([, f]) => num(f.consumed)));
    const per = p.batches.map(b => b.usePerThousand[m.materialId]).filter(v => v !== undefined).map(Number);
    const vendors = {};
    buys.forEach(x => { const v = x.purchase.vendor || 'No vendor'; vendors[v] = (vendors[v] || 0) + num(x.purchase.quantity); });
    const topV = Object.entries(vendors).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const st = num(m.stock) <= 0 ? ['critical', 'Empty'] : m.low ? ['critical', 'Low'] : m.daysLeft !== null && m.daysLeft <= 7 ? ['warning', 'Order soon'] : ['good', 'In stock'];
    return `
        ${card('Available', 'layers', `<div class="bk-avail"><b>${qty(m.stock)}</b><span>${esc(m.unit)}</span><em class="badge sm ${st[0]}">${st[1]}</em></div>
            <i class="bk-meter ${st[0]}"><i style="width:${m.daysLeft === null ? 100 : Math.min(100, (m.daysLeft / 30) * 100)}%"></i></i>
            <div class="hc-pr-figs"><span><small>Lasts</small><b>${m.daysLeft === null ? '—' : `${m.daysLeft} d`}</b></span><span><small>Use a day</small><b>${daily ? qty(daily) : '—'}</b></span>
                <span><small>Reorder below</small><b>${m.reorderLevel !== null ? qty(m.reorderLevel) : '—'}</b></span></div>`)}
        ${card('Order for a month', 'cart', daily ? `<div class="bk-kv"><div><span>Needed for 30 days</span><b>${qty(Math.ceil(daily * 30))} ${esc(m.unit)}</b></div>
            <div><span>In the yard</span><b>${qty(m.stock)}</b></div><div><span>To buy</span><b class="${need ? 'warn' : 'pos'}">${need ? `${qty(need)} ${esc(m.unit)}` : 'nothing'}</b></div>
            ${need && m.lastRate ? `<div><span>About</span><b>${money(need * num(m.lastRate))}</b></div>` : ''}</div>
            ${need && manage() ? `<button class="btn sm primary block" data-buy="${m.materialId}">${icon('plus')}Record the purchase</button>` : ''}`
            : '<p class="small muted">Count what is left after batches to work out the use.</p>')}
        ${card('Use', 'factory', uses.length ? `<div class="bk-daybars">${uses.map(([b, f]) => `<span title="${esc(b.batch.batchNo)} · ${dayLabel(b.batch.producedOn)}: ${qty(f.consumed)} ${esc(m.unit)}">
            <i style="height:${Math.max(4, (num(f.consumed) / maxUse) * 100)}%"></i><small>${new Date(b.batch.producedOn + 'T00:00:00').getDate()}</small></span>`).join('')}</div>
            <small class="muted">${per.length ? `on average ${yieldOf(per.reduce((t, v) => t + v, 0) / per.length, m.unit)}` : ''}</small>`
            : '<p class="small muted">Not counted after any batch yet.</p>', uses.length ? `last ${uses.length} batches` : '')}
        ${card('Buying', 'receipt', buys.length ? `<div class="hc-pr-figs"><span><small>Last rate</small><b>${m.lastRate ? `₹${num(m.lastRate).toLocaleString('en-IN')}` : '—'}</b></span>
            <span><small>Average</small><b>${qtyAll ? `₹${(amtAll / qtyAll).toFixed(0)}` : '—'}</b></span>
            <span><small>Lowest–highest</small><b>${!rates.length ? '—' : Math.min(...rates) === Math.max(...rates) ? `₹${Math.min(...rates).toLocaleString('en-IN')}` : `₹${Math.min(...rates).toLocaleString('en-IN')}–${Math.max(...rates).toLocaleString('en-IN')}`}</b></span></div>
            <div class="bk-kv">${topV.map(([v, q]) => `<div><span>${esc(v)}</span><b>${qty(q)} <small>${esc(m.unit)}</small></b></div>`).join('')}</div>
            <small class="muted">${plural(buys.length, 'purchase')}${seesMoney() ? ` · ${money(amtAll)} in all · ${moneyShort(buys.filter(x => x.purchase.receivedOn >= monthStart).reduce((t, x) => t + num(x.purchase.amount), 0))} this month` : ''}</small>`
            : '<p class="small muted">Not bought yet.</p>')}`;
}

// ===================================================================== expenses

/**
 * Production expenses: what each head cost in the period (tiles that filter), the bills, and a form beside them to record
 * one without a dialog: the head from the list (or a new head added on the spot and kept), the amount, the day, what for,
 * the vendor and bill, where it was paid from and the batch it was for. A bill is edited in the same form.
 */
async function expenses({ body, tools, params = [], reload, meta }) {
    const p = await api.get('/bricks/production');
    // an expense opened by its link: shown whatever the period, head or search
    const linkedX = params[0] ? p.expenses.find(x => String(x.expense.id) === String(params[0])) : null;
    if (linkedX) { view.head = null; view.expQ = ''; }
    const since = sinceDays(['30', '90', '365', 'all'].includes(view.expRange) ? view.expRange : (view.expRange = '30'));
    const inPeriod = p.expenses.filter(x => !since || x.expense.spentOn >= since);
    const byHead = {};
    inPeriod.forEach(x => { const h = byHead[x.expense.head] ||= { amount: 0, n: 0 }; h.amount += num(x.expense.amount); h.n++; });
    const heads = Object.entries(byHead).sort((a, b) => b[1].amount - a[1].amount);
    const q = String(view.expQ || '').trim().toLowerCase();
    const list = inPeriod.filter(x => (!view.head || x.expense.head === view.head)
        && (!q || `${x.expense.head} ${x.expense.description || ''} ${x.expense.vendor || ''} ${x.expense.billNo || ''} ${x.batchNo || ''} ${x.account || ''}`.toLowerCase().includes(q)));
    if (linkedX && !list.includes(linkedX)) list.unshift(linkedX);
    const total = inPeriod.reduce((s, x) => s + num(x.expense.amount), 0);
    const shown = list.reduce((s, x) => s + num(x.expense.amount), 0);
    const monthStart = firstOfMonth(0), lastStart = firstOfMonth(-1);
    const month = p.expenses.filter(x => x.expense.spentOn >= monthStart).reduce((s, x) => s + num(x.expense.amount), 0);
    const lastMonth = p.expenses.filter(x => x.expense.spentOn >= lastStart && x.expense.spentOn < monthStart).reduce((s, x) => s + num(x.expense.amount), 0);
    const days = new Set(p.batches.filter(b => !since || b.batch.producedOn >= since).map(b => b.batch.producedOn)).size;
    const good = p.batches.filter(b => !since || b.batch.producedOn >= since).reduce((s, b) => s + num(b.good), 0);
    tools.innerHTML = `${chips('range', [['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All']], view.expRange)}
        ${manage() ? `<button class="btn sm primary" data-new>${icon('plus')}Expense</button>` : ''}`;
    const headCell = h => { const ic = headIcon(h); return `<span class="bkx-hc"><span class="chip-icon xs ${ic.tone}">${icon(ic.name)}</span><b class="ellipsis">${esc(h)}</b></span>`; };
    body.innerHTML = `
        <div class="bk-chipfigs" ${seesMoney() ? '' : 'hidden'}>
            ${chip('In the period', moneyShort(total), plural(inPeriod.length, 'bill'), '', 'receipt')}
            ${chip('This month', moneyShort(month), lastMonth ? `${month > lastMonth ? '▲' : '▼'} last month ${moneyShort(lastMonth)}` : '', month > lastMonth && lastMonth ? 'warn' : '', 'calendar')}
            ${chip('Biggest head', heads[0] ? esc(heads[0][0]) : '—', heads[0] ? `${moneyShort(heads[0][1].amount)} · ${percent((heads[0][1].amount / total) * 100, 0)}` : '', '', 'pie')}
            ${chip('A working day', moneyShort(days ? total / days : 0), days ? `over ${plural(days, 'day')}` : 'no batches', '', 'factory')}
            ${chip('A brick', good ? `₹${(total / good).toFixed(2)}` : '—', good ? `${count(good)} good bricks` : '', '', 'layers')}
        </div>
        <div class="bk-fill bk-xpv ${seesMoney() ? '' : 'solo'}">
            ${panel({ title: view.head || 'Every expense', iconName: view.head ? headIcon(view.head).name : 'receipt', bodyClass: 'flush', cls: 'bk-list-panel bk-tall',
                sub: `${plural(list.length, 'bill')} · ${money(shown)}${view.head ? ` · <button class="link-btn" data-head="">show every head</button>` : ''}`,
                actions: `<label class="search-box sm bk-search">${icon('search')}<input type="search" data-xq placeholder="Find a bill, vendor, batch" value="${esc(view.expQ || '')}"></label>`,
                body: `<div class="bk-scroll">${list.length ? rowsHtml(list, { key: x => x.expense.id, cls: 'bk-slim', open: linkedX ? linkedX.expense.id : null, cols: '78px minmax(120px,.9fr) minmax(0,1.6fr) minmax(0,.9fr) 96px 92px',
                    head: ['Date', 'Head', 'What for · vendor', 'Batch · paid from', ['Amount', 'r'], ''],
                    load: x => journalPeek(x.expense.journalEntryId),
                    line: x => `<span class="muted small">${dayLabel(x.expense.spentOn)}</span>${headCell(x.expense.head)}
                        <span class="min-0 bkx-what"><span class="ellipsis">${esc(x.expense.description || '—')}</span>${x.expense.vendor ? `<small class="ellipsis muted">${esc(x.expense.vendor)}${x.expense.billNo ? ` · #${esc(x.expense.billNo)}` : ''}</small>` : ''}</span>
                        <span class="min-0 bkx-tags">${x.batchNo ? `<span class="badge sm">${icon('factory')}${esc(x.batchNo)}</span>` : ''}<small class="ellipsis muted">${esc(x.account || '')}</small></span>
                        <span class="r"><b>${money(x.expense.amount)}</b></span>
                        ${actions([manage() && iconBtn(`data-repeat="${x.expense.id}"`, 'repeat', 'Record it again'), manage() && iconBtn(`data-edit="${x.expense.id}"`, 'edit', 'Change'),
                            manage() && iconBtn(`data-del="${x.expense.id}"`, 'trash', 'Delete', 'danger')])}`,
                    detail: x => `<div class="bk-peek"><div class="bk-peek-h">${headCell(x.expense.head)}<span class="muted">${date(x.expense.spentOn)}</span>
                            <span class="spacer"></span><b>${money(x.expense.amount)}</b></div>
                        ${factsHtml([
                            ['What for', x.expense.description ? esc(x.expense.description) : '', 'wide'],
                            ['Vendor', esc(x.expense.vendor || '')],
                            ['Bill no.', x.expense.billNo ? `<span class="mono">${esc(x.expense.billNo)}</span>` : ''],
                            ['For batch', x.batchNo ? `<a href="#/bricks/production/${x.expense.batchId}">${esc(x.batchNo)}</a>` : '<span class="muted">not for one batch</span>'],
                            ['Paid from', esc(x.account || '')],
                            ['Recorded', `<small>${esc(x.expense.createdBy || '')} · ${dateTime(x.expense.createdAt)}</small>`]])}
                        ${manage() ? `<div class="bk-peek-acts"><button class="btn sm ghost" data-repeat="${x.expense.id}">${icon('repeat')}Record it again</button>
                            <button class="btn sm ghost" data-edit="${x.expense.id}">${icon('edit')}Change</button></div>` : ''}</div>` })
                    : `<div class="empty bk-empty">${icon('receipt')}<div>${q || view.head ? 'No bills match.' : 'No expenses in this period.'}</div>
                        ${manage() && !q ? `<button class="btn sm primary" data-new>${icon('plus')}Record an expense</button>` : ''}</div>`}</div>` })}
            ${seesMoney() ? `<aside class="bk-side-stats">${expenseStats(p, inPeriod, heads, total)}</aside>` : ''}
        </div>`;
    const refresh = () => expenses({ body, tools, params: [], reload, meta });
    const after = (_, msg) => { toast(msg); refresh(); };
    let t;
    body.querySelector('[data-xq]').addEventListener('input', ev => {
        clearTimeout(t);
        t = setTimeout(() => { view.expQ = ev.target.value; refresh().then(() => { const i = body.querySelector('[data-xq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250);
    });
    tools.onclick = guard(ev => {
        const r = ev.target.closest('[data-range]');
        if (r) { view.expRange = r.dataset.range; return refresh(); }
        if (ev.target.closest('[data-new]')) return openExpense(null, after);
    });
    body.onclick = guard(async ev => {
        if (ev.target.closest('[data-new]')) return openExpense(null, after);
        const h = ev.target.closest('[data-head]');
        if (h) { view.head = h.dataset.head || null; return refresh(); }
        const byId = id => p.expenses.find(x => String(x.expense.id) === String(id));
        const rp = ev.target.closest('[data-repeat]');
        if (rp) return openExpense(byId(rp.dataset.repeat), after, { copy: true });
        const ed = ev.target.closest('[data-edit]');
        if (ed) return openExpense(byId(ed.dataset.edit), after);
        const del = ev.target.closest('[data-del]');
        if (del && await confirmDelete('Delete this expense? It leaves the books.', () => api.del(`/bricks/expenses/${del.dataset.del}`))) { invalidateAccounts(); toast('Deleted'); return refresh(); }
    });
}

/** Beside the bills: each head (a filter), the last six months, the vendors paid most, and the batches that cost most. */
function expenseStats(p, inPeriod, heads, total) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push([key, p.expenses.filter(x => x.expense.spentOn.startsWith(key)).reduce((t, x) => t + num(x.expense.amount), 0)]);
    }
    const maxM = Math.max(1, ...months.map(m => m[1]));
    const vendors = {};
    inPeriod.forEach(x => { if (x.expense.vendor) vendors[x.expense.vendor] = (vendors[x.expense.vendor] || 0) + num(x.expense.amount); });
    const topV = Object.entries(vendors).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const batches = {};
    inPeriod.forEach(x => { if (x.batchNo) batches[x.batchNo] = (batches[x.batchNo] || 0) + num(x.expense.amount); });
    const topB = Object.entries(batches).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return `
        ${card('By head', 'pie', heads.length ? `<div class="bk-headlist">
            <button class="${view.head ? '' : 'on'}" data-head=""><span>Every head</span><b>${moneyShort(total)}</b></button>
            ${heads.map(([h, v]) => `<button class="${view.head === h ? 'on' : ''}" data-head="${esc(h)}"><span class="ellipsis">${esc(h)}</span><b>${moneyShort(v.amount)}</b>
                <i><em style="width:${(v.amount / heads[0][1].amount) * 100}%"></em></i><small>${plural(v.n, 'bill')} · ${percent((v.amount / total) * 100, 0)}</small></button>`).join('')}</div>`
            : '<p class="small muted">No expenses in this period.</p>', 'tap to filter')}
        ${card('Six months', 'calendar', `<div class="bk-daybars">${months.map(([k, v]) => `<span title="${esc(k)}: ${money(v)}"><i style="height:${Math.max(3, (v / maxM) * 100)}%"></i>
            <small>${new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}</small></span>`).join('')}</div>
            <small class="muted">this month ${moneyShort(months.at(-1)[1])} · last month ${moneyShort(months.at(-2)[1])}</small>`)}
        ${topV.length ? card('Paid most', 'user', barList(topV.map(([v, a]) => ({ label: esc(v), pct: (a / topV[0][1]) * 100, value: moneyShort(a) })))) : ''}
        ${topB.length ? card('Batches that cost most', 'factory', `<div class="bk-kv">${topB.map(([b, a]) => `<div><span>${esc(b)}</span><b>${money(a)}</b></div>`).join('')}</div>`) : ''}`;
}

// ===================================================================== sales & delivery

const FILTERS = [['open', 'Open'], ['moving', 'Moving'], ['due', 'Due'], ['DELIVERED', 'Done'], ['all', 'All']];
const DATES = [['any', 'Any date'], ['today', 'Today'], ['week', 'This week'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['custom', 'Pick dates']];

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

/** What the dates button says: "Any date", or "Delivered · This week", "Ordered · 3 Oct – 10 Oct". */
function datesLabel() {
    if (view.orderDates === 'any') return 'Any date';
    const r = datesOf();
    const what = view.orderDates === 'custom' ? `${r.from ? shortDate(r.from) : '…'} – ${r.to ? shortDate(r.to) : 'today'}` : DATES.find(x => x[0] === view.orderDates)[1];
    return `${view.orderBy === 'delivery' ? 'Delivered' : 'Ordered'} · ${what}`;
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

let salesLive = null;

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
    if (params[1] === 'payments' || params[1] === 'links' || params[1] === 'delivery') setOrderTab(params[1]);
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
                <div class="bk-tabs" role="tablist">${FILTERS.map(([k, l]) => `<button role="tab" class="${view.orderFilter === k ? 'active' : ''}" data-filter="${k}">${l}<i>${orders.filter(o => statusMatch(o, k)).length}</i></button>`).join('')}</div>
                <div class="bk-dates-bar">
                    <button class="bk-dates-btn ${view.orderDates === 'any' ? '' : 'on'}" data-dates-open>${icon('calendar')}<span data-dates-label>${esc(datesLabel())}</span>${icon('chevron-down')}</button>
                    <button class="btn sm ghost icon" data-dates-clear title="Any date" ${view.orderDates === 'any' ? 'hidden' : ''}>${icon('x')}</button>
                    <div class="bk-dates-pop" hidden>
                        <div class="seg-chips sm"><button class="seg-chip ${view.orderBy === 'order' ? 'active' : ''}" data-by="order">Ordered on</button>
                            <button class="seg-chip ${view.orderBy === 'delivery' ? 'active' : ''}" data-by="delivery">Delivered on</button></div>
                        <div class="bk-dates-presets">${DATES.map(([k, l]) => `<button class="${view.orderDates === k ? 'active' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
                        <div class="bk-dates bk-of-custom" ${view.orderDates === 'custom' ? '' : 'hidden'}><input type="date" data-ofrom value="${esc(view.orderFrom)}"><span>–</span><input type="date" data-oto value="${esc(view.orderTo)}"></div>
                    </div>
                </div>
            </div>
            <div class="bk-side-scroll bk-order-rows" data-rows tabindex="0"></div>
            <div class="bk-side-foot"><span><b>${open.length}</b> open</span><span><b>${count(open.reduce((s, o) => s + o.quantity - o.delivered, 0))}</b> to deliver</span>
                ${seesMoney() ? `<span><b class="${toCollect ? 'neg' : ''}">${moneyShort(toCollect)}</b> to collect</span>` : ''}</div>
        </div></section>
        <div class="bk-pane fixed bk-order-pane" id="bk-order"></div></div>`;
    const pane = body.querySelector('#bk-order');
    const rowsEl = body.querySelector('[data-rows]');
    const side = body.querySelector('.bk-orders-list');
    const rowHtml = o => {
        const pct = o.quantity ? (o.delivered / o.quantity) * 100 : 0;
        const late = o.requiredBy && o.requiredBy < today() && !['DELIVERED', 'CANCELLED'].includes(o.status);
        return `<a class="bk-order-row ${o.id === selId ? 'selected' : ''} st-${esc(o.status.toLowerCase())}" data-order="${o.id}">
            <span class="bk-or-av">${esc(initials(o.customerName))}</span>
            <div class="grow min-0">
                <div class="bk-sr-line"><b class="ellipsis">${esc(o.customerName)}</b><b>${moneyShort(o.total)}</b></div>
                <div class="bk-sr-line sub"><small class="ellipsis">${esc(o.orderNo)} · ${count(o.quantity)} bricks${o.vehicle ? ` · ${esc(o.vehicle)}` : ''}</small>
                    ${o.claimed ? `<span class="badge warning sm">${icon('bell')}paid?</span>` : num(o.balance) > 0 && o.delivered > 0 && o.status !== 'CANCELLED' ? `<small class="neg nowrap">${moneyShort(o.balance)} due</small>` : ''}</div>
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
        side.querySelector('[data-dates-label]').textContent = datesLabel();
        side.querySelector('[data-dates-open]').classList.toggle('on', view.orderDates !== 'any');
        side.querySelector('[data-dates-clear]').hidden = view.orderDates === 'any';
        return list;
    };
    let showing = 0;
    const show = async id => {
        selId = id;
        const ticket = ++showing;
        rowsEl.querySelectorAll('[data-order]').forEach(x => x.classList.toggle('selected', Number(x.dataset.order) === id));
        if (!id) {
            pane.innerHTML = `<section class="bk-card bk-empty-pane">${emptyState(orders.length ? 'Pick an order on the left' : 'Take an order to see it here', 'cart')}
                ${manage() && !orders.length ? `<button class="btn primary" data-new>${icon('plus')}New order</button>` : ''}</section>`;
            return;
        }
        pane.innerHTML = `<section class="bk-card bk-empty-pane"><div class="inline-loading"><span class="spinner"></span>Opening the order…</div></section>`;
        const v = await api.get(`/bricks/orders/${id}`);
        if (ticket !== showing) return;   // another order was picked meanwhile
        history.replaceState(null, '', `#/bricks/sales/${id}`);
        markSeen({ link: `bricks/sales/${id}` });   // its notices are seen once the order is opened
        drawOrder(v);
    };
    // the order on the right: drawn whole, or brought up to date in place (live changes)
    let currentV = null;
    const drawOrder = (nv, msg) => {
        if (msg) toast(msg);
        currentV = nv;
        pane.innerHTML = orderHtml(nv);
        bindOrder(pane, nv, (x, m) => { drawOrder(x, m); refreshRow(); });
    };
    /*
     * A change somewhere else (the customer signed on their phone, another user moved a trip): the list and the open order
     * are brought up to date where they are, without redrawing the page; what changed lights up for a moment.
     */
    const onLive = async ev => {
        if (!body.isConnected) { window.removeEventListener('pb-live-change', onLive); return; }
        if (!(ev.detail?.tables || []).some(t => String(t).startsWith('brick_'))) return;
        ev.preventDefault();
        try {
            const fresh = await api.get('/bricks/orders');
            if (!body.isConnected) return;
            const before = new Map(orders.map(o => [o.id, JSON.stringify(o)]));
            orders.splice(0, orders.length, ...fresh);
            const top = rowsEl.scrollTop;
            drawRows();
            rowsEl.scrollTop = top;
            fresh.filter(o => before.get(o.id) !== JSON.stringify(o)).forEach(o => rowsEl.querySelector(`[data-order="${o.id}"]`)?.classList.add('bk-flash'));
            const openNow = orders.filter(o => !['DELIVERED', 'CANCELLED'].includes(o.status));
            const foot = side.querySelector('.bk-side-foot');
            if (foot) foot.querySelector('b').textContent = openNow.length;
            if (!selId || !currentV || document.querySelector('.modal-backdrop')) return;
            const nv = await api.get(`/bricks/orders/${selId}`);
            if (!body.isConnected || nv.order.id !== selId || JSON.stringify(nv) === JSON.stringify(currentV)) return;
            const old = currentV;
            currentV = nv;
            if (patchOrder(pane, nv, old)) bindOrder(pane, nv, (x, m) => { drawOrder(x, m); refreshRow(); });
            else drawOrder(nv);
        } catch { /* left as it is: the next change brings it */ }
    };
    if (salesLive) window.removeEventListener('pb-live-change', salesLive);
    salesLive = onLive;
    window.addEventListener('pb-live-change', onLive);
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
    body.onclick = guard(e => { if (e.target.closest('[data-new]')) return openNew(); });
    const pop = side.querySelector('.bk-dates-pop');
    side.addEventListener('click', e => {
        const f = e.target.closest('[data-filter]');
        if (f) { view.orderFilter = f.dataset.filter; side.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === f)); return drawRows(); }
        if (e.target.closest('[data-dates-open]')) { pop.hidden = !pop.hidden; return; }
        if (e.target.closest('[data-dates-clear]')) { view.orderDates = 'any'; pop.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('active', x.dataset.preset === 'any')); pop.hidden = true; return drawRows(); }
        const by = e.target.closest('[data-by]');
        if (by) { view.orderBy = by.dataset.by; pop.querySelectorAll('[data-by]').forEach(x => x.classList.toggle('active', x === by)); return drawRows(); }
        const pr = e.target.closest('[data-preset]');
        if (pr) {
            view.orderDates = pr.dataset.preset;
            pop.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('active', x === pr));
            pop.querySelector('.bk-of-custom').hidden = view.orderDates !== 'custom';
            if (view.orderDates === 'custom') { if (!view.orderFrom) view.orderFrom = firstOfMonth(0); pop.querySelector('[data-ofrom]').value = view.orderFrom; }
            else pop.hidden = true;
            return drawRows();
        }
        const r = e.target.closest('[data-order]');
        if (r) show(Number(r.dataset.order));
    });
    // the dates pop-up closes on a click anywhere else
    const outside = e => { if (!body.isConnected) return document.removeEventListener('mousedown', outside); if (!e.target.closest('.bk-dates-bar')) pop.hidden = true; };
    document.addEventListener('mousedown', outside);
    side.addEventListener('change', e => {
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
    rowsEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    await show(selId);
}

// ===================================================================== team

const PAY = { PIECE: 'Paid by work done', WEEKLY: 'Weekly wage', MONTHLY: 'Monthly salary' };
const TEAM_SHOW = [['all', 'All'], ['teams', 'Teams'], ['people', 'People'], ['vehicles', 'Vehicles']];
const KIND_ICON = { PRODUCTION: 'factory', LOADING: 'layers', UNLOADING: 'layers', TRIP: 'truck', WAGE: 'calendar', SALARY: 'briefcase', BONUS: 'gift' };

async function team({ body, tools, params = [], reload, meta }) {
    const p = await api.get('/bricks/payroll');
    if (params[0] && /^[rv]\d+$/.test(params[0])) { view.teamSel = params[0]; view.teamShow = 'all'; view.teamQ = ''; }
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
        <div class="bk-pane fixed" id="bk-team-pane"></div></div>`;
    const rowsEl = body.querySelector('[data-rows]');
    const pane = body.querySelector('#bk-team-pane');
    let current = null;
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
        pane.innerHTML = `<section class="bk-card bk-empty-pane"><div class="inline-loading"><span class="spinner"></span>Loading…</div></section>`;
        if (key.startsWith('v')) {
            const v = vehicles.find(x => String(x.id) === key.slice(1));
            const trips = await api.get(`/bricks/vehicles/${v.id}/trips`).catch(() => []);
            pane.innerHTML = vehiclePane(v, trips, meta);
        } else {
            const h = await api.get(`/bricks/resources/${key.slice(1)}/history`);
            if (view.teamSel !== key) return;
            current = h;
            pane.innerHTML = resourcePane(h);
        }
    };
    const refresh = () => team({ body, tools, reload, meta });
    tools.onclick = guard(e => {
        if (e.target.closest('[data-new]')) return openResource(null, (saved, msg) => { toast(msg); view.teamSel = `r${saved.resource.id}`; reload(); });
        if (e.target.closest('[data-vehicle]')) return openVehicle(null, done(reload));
    });
    const side = body.querySelector('.bk-side-list');
    side.addEventListener('click', e => {
        const s = e.target.closest('[data-show]');
        if (s) { view.teamShow = s.dataset.show; side.querySelectorAll('[data-show]').forEach(x => x.classList.toggle('active', x === s)); const l = drawRows(); if (!l.some(x => keyOf(x) === view.teamSel)) show(l[0] ? keyOf(l[0]) : null); return; }
        const r = e.target.closest('[data-sel]');
        if (r) show(r.dataset.sel);
    });
    const search = side.querySelector('[data-tq]');
    search.addEventListener('input', () => { view.teamQ = search.value; drawRows(); });
    pane.onclick = guard(async e => {
        const find = id => p.resources.find(v => String(v.resource.id) === String(id))?.resource;
        const tx = e.target.closest('[data-tx]');
        if (tx) { view.txFilter = tx.dataset.tx; if (current) pane.innerHTML = resourcePane(current); return; }
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
        if (sl) return showSlip(sl.dataset.slip, { onCancelled: manage() ? refresh : null });
        const del = e.target.closest('[data-del]');
        if (del && await confirmDelete('Remove them? Anyone with work or pay on record is kept as “left”.', () => api.del(`/bricks/resources/${del.dataset.del}`))) { await loadMeta(true); view.teamSel = null; reload(); return; }
        const ev = e.target.closest('[data-edit-vehicle]');
        if (ev) return openVehicle(vehicles.find(v => String(v.id) === ev.dataset.editVehicle), done(reload));
        const go = e.target.closest('[data-go]');
        if (go) location.hash = go.dataset.go;
    });
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
            return `<span class="muted">${dayLabel(e.earnedOn)}</span><span class="bk-who"><span class="chip-icon sm">${icon(KIND_ICON[e.kind] || 'tag')}</span><b>${esc(e.label)}</b></span>
                <span class="ellipsis small muted">${esc(e.narrative || '')}</span>
                <span class="r">${e.quantity ? count(e.quantity) : ''}</span><span class="r"><b>${money(e.amount)}</b></span>
                <span>${e.slipId ? `<span class="badge good sm">${icon('check')}${esc(e.slipNo || 'paid')}</span>` : '<span class="badge warning sm">Due</span>'}</span>`;
        }
        const s = x.s, adv = s.kind === 'ADVANCE';
        return `<span class="muted">${dayLabel(s.paidOn)}</span><span class="bk-who"><span class="chip-icon sm ${adv ? 'violet' : 'aqua'}">${icon(adv ? 'hand' : 'hand-coins')}</span><b>${adv ? 'Advance' : 'Payment'} ${esc(s.slipNo)}</b></span>
            <span class="ellipsis small muted">${adv ? esc(s.narrative || '') : `${dayLabel(s.periodFrom)} – ${dayLabel(s.periodTo)}`}</span>
            <span class="r ${num(s.deductions) ? 'neg' : 'muted'}">${num(s.deductions) ? `− ${moneyShort(s.deductions)}` : ''}</span>
            <span class="r"><b class="${s.status === 'CANCELLED' ? 'strike' : adv ? '' : 'pos'}">${money(s.net)}</b></span>
            <span>${s.status === 'CANCELLED' ? '<span class="badge gray sm">Cancelled</span>' : adv ? '<span class="badge violet sm">Given</span>' : '<span class="badge good sm">Paid</span>'}</span>`;
    };
    const txDetail = x => {
        if (x.kind === 'work') {
            const e = x.e;
            return `<div class="bk-peek"><div class="bk-peek-h">${icon(KIND_ICON[e.kind] || 'tag')}<b>${esc(e.label)}</b><span class="muted">${date(e.earnedOn)}</span>
                    <span class="spacer"></span><b>${money(e.amount)}</b></div>
                ${factsHtml([
                    [e.kind === 'TRIP' ? 'Trips' : 'Bricks', e.quantity ? count(e.quantity) : ''],
                    ['Rate', num(e.rate) ? `₹${num(e.rate)} <small>${e.kind === 'TRIP' ? 'a trip' : 'a brick'}</small>` : ''],
                    ['Earned', `<b>${money(e.amount)}</b>`],
                    ['Paid', e.slipId ? `on <button type="button" class="link-btn" data-slip="${e.slipId}">${esc(e.slipNo)}</button>` : '<span class="warn">not yet: on the next slip</span>'],
                    ['Batch', e.sourceType === 'BATCH' && e.sourceId ? `<button type="button" class="link-btn" data-go="#/bricks/production/${e.sourceId}">Open the batch</button>` : ''],
                    ['Details', e.narrative ? `<span class="muted">${esc(e.narrative)}</span>` : '', 'wide']])}</div>`;
        }
        const s = x.s, adv = s.kind === 'ADVANCE';
        return slipPeek(s);
    };
    const txShown = tx.filter(x => view.txFilter === 'all' || x.kind === view.txFilter);
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
        <div class="bk-split bk-grow">
            ${panel({ title: 'Work & payments', iconName: 'list', bodyClass: 'flush', cls: 'bk-list-panel bk-tall', sub: `${plural(h.earnings.length, 'work item')} · ${plural(h.slips.length, 'slip')}`,
                actions: `<div class="seg-chips sm">${[['all', 'All'], ['work', 'Work'], ['pay', 'Payments'], ['advance', 'Advances']].map(([k, l]) => `<button class="seg-chip ${view.txFilter === k ? 'active' : ''}" data-tx="${k}">${l}</button>`).join('')}</div>`,
                body: `<div class="bk-scroll" data-tx-list>${rowsHtml(txShown, { key: x => x.kind === 'work' ? `e${x.e.id}` : `s${x.s.id}`, cls: 'bk-tx', cols: '84px minmax(140px,1fr) minmax(0,1.6fr) 64px 92px 84px',
                    head: ['Date', 'What', 'Details', ['Qty · back', 'r'], ['Amount', 'r'], 'Status'],
                    empty: 'No work or payments yet', line: txLine, detail: txDetail,
                    load: x => x.kind === 'work' ? null : x.s.kind === 'ADVANCE' ? journalPeek(x.s.journalEntryId) : slipLines(x.s.id) })}</div>` })}
            <div class="bk-aside bk-scroll">
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

async function payments({ body, tools, params = [], reload, meta }) {
    const period = view.cycle === 'WEEKLY' ? weekOf(today(), view.back) : monthOf(today(), view.back);
    const [run, p] = await Promise.all([api.get('/bricks/payroll/run', { cycle: view.cycle, from: period.from, to: period.to }), api.get('/bricks/payroll')]);
    const slips = p.slips.filter(s => !view.slipFilter || (view.slipFilter === 'CANCELLED' ? s.status === 'CANCELLED' : s.kind === view.slipFilter && s.status !== 'CANCELLED'));
    const linkedS = params[0] ? p.slips.find(s => String(s.id) === String(params[0])) : null;
    if (linkedS && !slips.includes(linkedS)) slips.unshift(linkedS);
    const label = view.cycle === 'WEEKLY' ? `${dayLabel(period.from)} – ${dayLabel(period.to)}` : new Date(period.from + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const ded = x => x.advances.reduce((s, a) => s + num(a.suggested), 0);
    const due = run.reduce((s, x) => s + num(x.gross), 0), back = run.reduce((s, x) => s + ded(x), 0);
    const monthStart = firstOfMonth(0);
    const paidMonth = p.slips.filter(s => s.status === 'PAID' && s.kind !== 'ADVANCE' && s.paidOn >= monthStart).reduce((s, x) => s + num(x.net), 0);
    const owed = p.advances || [];
    const people = new Set(owed.map(a => a.resourceId)).size;
    const resOf = id => p.resources.find(v => v.resource.id === id);
    // the weekly payday, and how far off it is
    const payDay = meta.settings.payDay || 6;
    const dow = ((new Date().getDay() + 6) % 7) + 1;
    const until = (payDay - dow + 7) % 7;
    const payable = run.filter(x => num(x.gross) - ded(x) > 0);
    tools.innerHTML = `${view.cycle === 'WEEKLY' && view.back === 0 ? `<span class="bk-payday ${until === 0 ? 'today' : ''}">${icon('calendar')}${until === 0 ? 'Payday today'
            : `Payday ${['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][payDay]} · in ${plural(until, 'day')}`}</span>` : ''}
        ${chips('cycle', [['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly salaries']], view.cycle)}
        <div class="bk-period"><button class="btn sm ghost icon" data-back="1" title="Earlier">${icon('chevron-left')}</button><b>${esc(label)}</b>
            <button class="btn sm ghost icon" data-back="-1" ${view.back <= 0 ? 'disabled' : ''} title="Later">${icon('chevron-right')}</button></div>
        ${manage() && payable.length ? `<button class="btn sm primary" data-pay-all>${icon('hand-coins')}Pay everyone · ${moneyShort(payable.reduce((t, x) => t + num(x.gross) - ded(x), 0))}</button>` : ''}`;
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
        <div class="bk-fill bk-pay-grid"><div class="bk-pay-left">
        ${panel({ title: view.cycle === 'WEEKLY' ? 'To pay this week' : 'Salaries this month', iconName: 'hand-coins', bodyClass: 'flush', cls: 'bk-list-panel bk-pay-run',
            sub: `${view.cycle === 'WEEKLY' ? 'work not paid yet, up to the week’s end' : 'staff on a monthly salary'} · ${money(due - back)}`,
            body: `<div class="bk-scroll">${rowsHtml(run, { key: x => x.resource.resource.id, cols: 'minmax(0,1.1fr) minmax(0,1.8fr) 88px 84px 92px 58px',
                head: ['Who', 'Work done', ['Earned', 'r'], ['Advance back', 'r'], ['To pay', 'r'], ''],
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
                } })}</div>` })}
        ${panel({ title: 'Advances owed', iconName: 'hand', bodyClass: 'flush', cls: 'bk-list-panel bk-pay-adv', sub: `${plural(owed.length, 'advance')} · ${money(p.advancesOutstanding)} to take back`,
            body: `<div class="bk-scroll">${rowsHtml(owed, { key: a => a.advance.advanceId, cols: 'minmax(0,1.1fr) 82px 84px minmax(0,1.5fr) 88px 120px 88px 34px', empty: 'Nobody owes an advance',
                head: ['Who', 'Slip', 'Given on', 'Why', ['Given', 'r'], 'Taken back', ['Owed', 'r'], ''],
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
                            ${manage() && rv?.resource.active ? `<button class="btn sm ghost" data-go="#/bricks/team/r${a.resourceId}">${icon('users')}Their record</button>` : ''}</span></div>`;
                } })}</div>` })}
        </div>
        ${panel({ title: 'Payment slips', iconName: 'receipt', bodyClass: 'flush', cls: 'bk-list-panel bk-tall bk-pay-slips', sub: plural(slips.length, 'slip'),
            actions: chips('slips', [['', 'All'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['ADVANCE', 'Advances'], ['CANCELLED', 'Cancelled']], view.slipFilter),
            body: `<div class="bk-scroll">${rowsHtml(slips, { key: s => s.id, open: linkedS ? linkedS.id : null, load: s => s.kind === 'ADVANCE' ? journalPeek(s.journalEntryId) : slipLines(s.id), cols: '92px minmax(0,1fr) minmax(0,1fr) 88px 30px', empty: 'No slips yet',
                head: ['Slip', 'Paid to', 'For', ['Net paid', 'r'], ''],
                line: s => `<span class="nowrap"><b>${esc(s.slipNo)}</b><small>${dayLabel(s.paidOn)}</small></span>
                    <span class="bk-who"><i class="bk-avatar xs ${roleLook(s.role).tone}">${esc(initials(s.resourceName))}</i><span class="ellipsis">${esc(s.resourceName)}</span></span>
                    <span class="ellipsis small">${s.kind === 'ADVANCE' ? `<span class="badge violet sm">${icon('hand')}Advance</span>` : `<span class="muted">${dayLabel(s.periodFrom)} – ${dayLabel(s.periodTo)}</span>`}</span>
                    <span class="r"><b class="${s.status === 'CANCELLED' ? 'strike' : ''}">${money(s.net)}</b>${num(s.deductions) ? `<small class="neg">− ${moneyShort(s.deductions)} adv.</small>` : ''}</span>
                    ${actions([iconBtn(`data-slip="${s.id}"`, 'printer', 'Open the slip')])}`,
                detail: s => slipPeek(s, true) })}</div>` })}
        </div>`;
    const refresh = () => payments({ body, tools, reload, meta });
    tools.onclick = e => {
        if (e.target.closest('[data-pay-all]')) return payEveryone(payable, period, view.cycle, label, meta, refresh);
        const c = e.target.closest('[data-cycle]');
        if (c) { view.cycle = c.dataset.cycle; view.back = 0; refresh(); }
        const b = e.target.closest('[data-back]');
        if (b) { view.back = Math.max(0, view.back + Number(b.dataset.back)); refresh(); }
    };
    body.onclick = guard(async e => {
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
        if (s) return showSlip(s.dataset.slip, { onCancelled: manage() ? refresh : null });
    });
}

/**
 * Pays everyone due for the period in one go: a slip each with all their work, the wage, and the advance cut suggested
 * (it can be changed, or a person left out). The slips are made one after another, the progress shown.
 */
async function payEveryone(run, period, cycle, label, meta, done) {
    const accounts = await loadingDialog('Getting the accounts…', () => moneyAccounts());
    if (!accounts) return;
    const cut = x => x.advances.reduce((s, a) => s + num(a.suggested), 0);
    openModal({
        title: `Pay everyone · ${label}`, iconName: 'hand-coins', size: 'lg', sub: `${plural(run.length, 'person', 'people')} with pay due: a slip each, with all their work`,
        body: `<form class="bk-payall" onsubmit="return false">
            <table class="grid compact bk-payall-table"><thead><tr><th></th><th>Who</th><th>Work</th><th class="r">Earned</th><th class="r">Advance back</th><th class="r">To pay</th><th></th></tr></thead>
            <tbody>${run.map(x => {
                const r = x.resource.resource;
                return `<tr data-who="${r.id}"><td><input type="checkbox" data-on checked></td>
                    <td><span class="bk-who"><i class="bk-avatar xs ${roleLook(r.role).tone}">${esc(initials(r.name))}</i><b>${esc(r.name)}</b></span></td>
                    <td class="small muted">${summarise(x.earnings)}${num(x.wage) ? ` · ${esc(x.wageLabel || 'Wage')}` : ''}</td>
                    <td class="r">${money(x.gross)}</td>
                    <td class="r">${x.advances.length ? `<input type="number" min="0" max="${x.advances.reduce((s, a) => s + num(a.outstanding), 0)}" step="any" class="num bk-cut" data-cut value="${cut(x)}">` : '<span class="muted">—</span>'}</td>
                    <td class="r"><b data-net>${money(num(x.gross) - cut(x))}</b></td><td data-state></td></tr>`;
            }).join('')}</tbody></table>
            <div class="form-grid three">
                ${field({ label: 'Paid on', name: 'paidOn', type: 'date', value: today(), required: true })}
                ${field({ label: 'How', name: 'mode', type: 'select', value: 'Cash', options: ['Cash', 'UPI', 'Bank', 'Cheque'].map(v => ({ value: v, label: v })) })}
                ${field({ label: 'From', name: 'accountId', type: 'select', value: meta.settings.payAccountId, options: moneyOptions(accounts, meta.settings.payAccountId, 'Brick · cash') })}
            </div>
            <div class="bk-net" data-total></div>
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const recalc = () => {
                let n = 0, total = 0;
                run.forEach(x => {
                    const tr = f.querySelector(`[data-who="${x.resource.resource.id}"]`);
                    const c = num(tr.querySelector('[data-cut]')?.value);
                    tr.querySelector('[data-net]').textContent = money(num(x.gross) - c);
                    tr.classList.toggle('off', !tr.querySelector('[data-on]').checked);
                    if (tr.querySelector('[data-on]').checked) { n++; total += num(x.gross) - c; }
                });
                f.querySelector('[data-total]').innerHTML = `<div class="total"><span>${plural(n, 'slip')} to make</span><b>${money(total)}</b></div>`;
            };
            f.addEventListener('input', recalc);
            f.addEventListener('change', recalc);
            recalc();
        },
        actions: [{ label: 'Close' }, { label: 'Pay and make the slips', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const chosen = run.filter(x => f.querySelector(`[data-who="${x.resource.resource.id}"] [data-on]`).checked
                && !f.querySelector(`[data-who="${x.resource.resource.id}"]`).dataset.done);
            if (!chosen.length) throw new Error('Tick at least one person');
            let made = 0;
            for (const x of chosen) {
                const tr = f.querySelector(`[data-who="${x.resource.resource.id}"]`);
                const state = tr.querySelector('[data-state]');
                state.innerHTML = '<span class="spinner sm"></span>';
                let left = num(tr.querySelector('[data-cut]')?.value);
                const deductions = x.advances.map(a => { const take = Math.min(left, num(a.outstanding)); left -= take; return { advanceId: a.advanceId, amount: take }; }).filter(d => d.amount > 0);
                try {
                    const slip = await api.post('/bricks/payroll/slips', { resourceId: x.resource.resource.id, cycle, periodFrom: period.from, periodTo: period.to,
                        earningIds: x.earnings.map(e => e.id), wage: num(x.wage) || null, bonuses: [], deductions,
                        paidOn: f.paidOn.value, mode: f.mode.value, accountId: f.accountId.value ? Number(f.accountId.value) : null, reference: null, note: null });
                    tr.dataset.done = '1';
                    state.innerHTML = `<span class="badge good sm">${icon('check')}${esc(slip.slip.slipNo)}</span>`;
                    made++;
                } catch (err) {
                    state.innerHTML = `<span class="badge critical sm" title="${esc(err.message)}">${icon('alert')}failed</span>`;
                }
            }
            invalidateAccounts();
            toast(`${plural(made, 'slip')} made`);
            done();
            if (made < chosen.length) throw new Error(`${chosen.length - made} could not be paid: see the row (hover for why) and try again`);
        } }],
    });
}

function summarise(earnings) {
    const by = {};
    earnings.forEach(e => { const k = e.label; by[k] = by[k] || { n: 0, q: 0, a: 0 }; by[k].n++; by[k].q += num(e.quantity); by[k].a += num(e.amount); });
    return Object.entries(by).map(([k, v]) => `${esc(k)} ${k === 'Delivery trip' ? '× ' + v.n : v.q ? count(v.q) : ''} <b>${moneyShort(v.a)}</b>`).join(' · ');
}

// ===================================================================== accounts

const ACCT_GROUPS = [['Money', a => a.book && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.type), 'cash & bank of the business'],
    ['Customers & staff', a => a.book && a.type === 'RECEIVABLE', 'owed to the business'], ['Income', a => a.book && a.accountClass === 'INCOME', 'what it earns'],
    ['Costs', a => a.book && a.accountClass === 'EXPENSE', 'what it spends'], ['Other', a => a.book, ''], ['My accounts used', a => !a.book, 'only the brick entries in them']];
const PRESETS = [['m0', 'This month', () => firstOfMonth(0)], ['m2', '3 months', () => firstOfMonth(-2)], ['m5', '6 months', () => firstOfMonth(-5)],
    ['y', 'This year', () => `${new Date().getFullYear()}-01-01`], ['all', 'All', () => '2000-01-01']];

/**
 * The brick book: its accounts in a side list (grouped, searchable, with balances), and the one picked as a statement for a
 * period: opening, money in and out, closing, every entry (searchable, opening to the journal entry) and a CSV of it.
 */
async function accounts({ body, tools, params, reload }) {
    const book = await api.get('/bricks/book');
    let selId = params[0] ? Number(params[0]) : view.acct || book.find(a => a.book && a.type === 'CASH')?.id || book[0]?.id;
    const iconOf = a => a.accountClass === 'INCOME' ? 'arrow-in' : a.accountClass === 'EXPENSE' ? 'arrow-out' : a.type === 'CASH' ? 'cash' : a.type === 'RECEIVABLE' ? 'hand-coins' : a.type === 'WALLET' ? 'wallet' : 'bank';
    const toneOf = a => a.accountClass === 'INCOME' ? 'aqua' : a.accountClass === 'EXPENSE' ? 'coral' : a.type === 'RECEIVABLE' ? 'gold' : '';
    const cash = book.filter(ACCT_GROUPS[0][1]);
    const groupOf = a => ACCT_GROUPS.find(([, f]) => f(a))[0];
    tools.innerHTML = manage() ? `<button class="btn sm" data-transfer>${icon('transfer')}Move money</button><button class="btn sm primary" data-new>${icon('plus')}Account</button>` : '';
    body.innerHTML = `<div class="bk-fill bk-twopane">
        <section class="panel headless bk-side-list"><div class="panel-body flush">
            <div class="list-tools"><div class="lt-top"><div class="search-box">${icon('search')}<input type="search" data-aq data-plain placeholder="Find an account…" value="${esc(view.acctQ || '')}">
                <span class="lt-count">${book.length}</span></div></div></div>
            <div class="bk-side-scroll" data-rows></div>
            <div class="bk-side-foot"><span>Cash &amp; bank</span><b class="${cash.reduce((s, a) => s + num(a.balance), 0) < 0 ? 'neg' : ''}">${money(cash.reduce((s, a) => s + num(a.balance), 0))}</b></div>
        </div></section>
        <div class="bk-pane fixed" id="bk-stmt"></div></div>`;
    const rowsEl = body.querySelector('[data-rows]');
    const stmt = body.querySelector('#bk-stmt');
    const drawRows = () => {
        const q = String(view.acctQ || '').trim().toLowerCase();
        const list = book.filter(a => !q || a.name.toLowerCase().includes(q));
        rowsEl.innerHTML = ACCT_GROUPS.map(([g, , note]) => {
            const l = list.filter(a => groupOf(a) === g);
            if (!l.length) return '';
            return `<div class="group-label" title="${esc(note)}"><span>${esc(g)} <i>${l.length}</i></span><b>${moneyShort(l.reduce((s, a) => s + num(a.balance), 0))}</b></div>
                ${l.map(a => `<button class="bk-side-row ${a.id === selId ? 'selected' : ''}" data-acct="${a.id}">
                    <span class="chip-icon sm ${toneOf(a)}">${icon(iconOf(a))}</span>
                    <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(a.name.replace(/^Brick · /, '').replace(/^./, c => c.toUpperCase()))}</b><b class="${num(a.balance) < 0 ? 'neg' : ''}">${moneyShort(a.balance)}</b></span>
                    <span class="bk-sr-line sub"><small>${esc(roleName(a.type))}</small><small>${a.entries ? plural(a.entries, 'entry', 'entries') : 'no entries'}</small></span></span></button>`).join('')}`;
        }).join('') || emptyState('No account matches', 'wallet');
    };
    let showing = 0;
    const show = async id => {
        selId = id;
        view.acct = id;
        const ticket = ++showing;
        rowsEl.querySelectorAll('[data-acct]').forEach(x => x.classList.toggle('selected', Number(x.dataset.acct) === id));
        const a = book.find(x => x.id === id);
        if (!a) { stmt.innerHTML = `<section class="bk-card bk-empty-pane">${emptyState('Pick an account', 'wallet')}</section>`; return; }
        if (!stmt.querySelector('.bk-acct-head')) stmt.innerHTML = `<section class="bk-card bk-empty-pane"><div class="inline-loading"><span class="spinner"></span>Loading the statement…</div></section>`;
        else stmt.querySelector('[data-stmt-body]')?.insertAdjacentHTML('afterbegin', '<div class="bk-overlay-load"><span class="spinner"></span></div>');
        const r = await api.get(`/bricks/book/accounts/${id}/statement`, view.stmt);
        if (ticket !== showing) return;
        history.replaceState(null, '', `#/bricks/accounts/${id}`);
        const q = String(view.stmtQ || '').trim().toLowerCase();
        const rows = r.rows.filter(x => !q || `${x.entryNo} ${x.narration} ${x.counterAccounts || ''} ${x.brick?.ref || ''}`.toLowerCase().includes(q));
        const preset = PRESETS.find(([, , f]) => view.stmt.from === f() && view.stmt.to === isoDate())?.[0];
        stmt.innerHTML = `<section class="bk-card bk-acct-head">
                <div class="bk-mh-top"><span class="chip-icon ${toneOf(a)}">${icon(iconOf(a))}</span>
                    <div class="grow min-0"><h2 class="ellipsis">${esc(a.name)}</h2><small class="muted">${esc(roleName(a.type))} · ${esc(groupOf(a))}${a.book ? '' : ' · only the brick business’s entries'}</small></div>
                    <div class="bk-oh-amt"><small>Balance now</small><b class="${num(a.balance) < 0 ? 'neg' : ''}">${money(a.balance)}</b></div></div>
                <div class="bk-acct-bar">
                    <div class="seg-chips sm">${PRESETS.map(([k, l]) => `<button class="seg-chip ${preset === k ? 'active' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
                    <span class="bk-dates"><input type="date" data-from value="${view.stmt.from}"><span>–</span><input type="date" data-to value="${view.stmt.to}"></span>
                    <span class="spacer"></span>
                    <label class="search-box sm bk-search">${icon('search')}<input type="search" data-sq placeholder="Find an entry" value="${esc(view.stmtQ || '')}"></label>
                    <button class="btn sm ghost" data-csv title="Download the statement">${icon('download')}CSV</button>
                </div>
                <div class="bk-chipfigs in">
                    ${chip('Opening', money(r.openingBalance), shortDate(view.stmt.from), '', 'flag')}
                    ${chip('In', money(r.totalDebit), 'debits', '', 'arrow-in')}
                    ${chip('Out', money(r.totalCredit), 'credits', '', 'arrow-out')}
                    ${chip('Closing', money(r.closingBalance), shortDate(view.stmt.to), num(r.closingBalance) < 0 ? 'bad' : '', 'check-circle')}
                </div></section>
            ${panel({ title: 'Entries', iconName: 'journal', bodyClass: 'flush', cls: 'bk-list-panel bk-grow', sub: `${plural(rows.length, 'entry', 'entries')}${q ? ` of ${r.rows.length}` : ''} · click one to see the journal entry`,
                body: `<div class="bk-scroll" data-stmt-body>${rows.length ? `<table class="grid bk-ledger sticky"><thead><tr><th>Date</th><th>Entry</th><th>Narration</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
                    <tbody>${rows.map(x => `<tr data-entry="${x.entryId}" class="clickable"><td>${dayLabel(x.date)}</td>
                        <td class="nowrap">${kindChip(x.voucherType, 'xs', x.voucherLabel)}<b>${esc(x.entryNo)}</b></td>
                        <td><span class="bk-narr" title="${esc(x.narration)}${x.counterAccounts ? ` · ${esc(x.counterAccounts)}` : ''}">${x.brick?.ref ? `<em>${esc(x.brick.what)} · ${esc(x.brick.ref)}</em>` : ''}${esc(x.narration)}
                            ${x.counterAccounts ? `<small>↔ ${esc(x.counterAccounts)}</small>` : ''}</span></td>
                        <td class="r pos">${num(x.debit) ? money(x.debit) : ''}</td><td class="r neg">${num(x.credit) ? money(x.credit) : ''}</td><td class="r"><b>${money(x.balance)}</b></td></tr>`).join('')}</tbody></table>`
                    : emptyState(q ? 'No entry matches' : 'No entries in this period', 'journal')}</div>` })}`;
        const range = () => { view.stmt = { from: stmt.querySelector('[data-from]').value, to: stmt.querySelector('[data-to]').value }; show(id); };
        stmt.querySelectorAll('[data-from],[data-to]').forEach(i => i.addEventListener('change', range));
        let t;
        stmt.querySelector('[data-sq]').addEventListener('input', e => {
            clearTimeout(t);
            t = setTimeout(() => { view.stmtQ = e.target.value; show(id).then(() => { const i = stmt.querySelector('[data-sq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250);
        });
        stmt.querySelector('[data-csv]').onclick = () => downloadCsv(`${a.name.replace(/[^\w]+/g, '-')}-${view.stmt.from}-${view.stmt.to}.csv`,
            [['Date', 'Entry', 'Narration', 'Debit', 'Credit', 'Balance'], ['', '', 'Opening balance', '', '', num(r.openingBalance)],
                ...rows.map(x => [x.date, x.entryNo, x.narration, num(x.debit) || '', num(x.credit) || '', num(x.balance)])]);
    };
    stmt.onclick = guard(async e => {
        const p = PRESETS.find(x => x[0] === e.target.closest('[data-preset]')?.dataset.preset);
        if (p) { view.stmt = { from: p[2](), to: isoDate() }; return show(selId); }
        const row = e.target.closest('tbody [data-entry]');
        if (!row || row.classList.contains('busy-row')) return;
        row.classList.add('busy-row');
        try {
            const entry = await api.get(`/transactions/${row.dataset.entry}`);
            toggleEntryRow(row, entry, { onChanged: () => show(selId) });
        } catch (err) { toast(err.message, 'error'); } finally { row.classList.remove('busy-row'); }
    });
    tools.onclick = guard(e => {
        if (e.target.closest('[data-new]')) return openBookAccount(done(reload));
        if (e.target.closest('[data-transfer]')) return openTransfer(done(reload));
    });
    rowsEl.onclick = guard(e => { const a = e.target.closest('[data-acct]'); if (a) return show(Number(a.dataset.acct)); });
    body.querySelector('[data-aq]').addEventListener('input', e => { view.acctQ = e.target.value; drawRows(); });
    drawRows();
    await show(selId);
}

// ===================================================================== set-up

/**
 * The set-up as topics in a side list (each with what it holds and a warning when something is missing) and one topic at
 * a time on the right: brick types and MRP, pricing models, raw materials, vehicles, delivery and charges, customer
 * payments, pay and accounts, letterhead and signatures, expense heads.
 */
async function setup({ body, tools, params, reload, meta }) {
    const s = meta.settings;
    const after = (m, msg) => { setMeta(m); toast(msg); reload(); };
    const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const missingMrp = meta.types.filter(t => t.active && t.mrp === null).length;
    const TOPICS = [
        { key: 'types', label: 'Brick types & MRP', icon: 'brick', note: `${plural(meta.types.filter(t => t.active).length, 'type')} made`, warn: missingMrp ? `${missingMrp} without MRP` : '' },
        { key: 'models', label: 'Pricing models', icon: 'percent', note: `${plural(meta.models.length, 'model')} · what teams earn`, warn: meta.models.some(m => meta.types.some(t => t.active && m.rates[t.id] === undefined)) ? 'rates missing' : '' },
        { key: 'materials', label: 'Raw materials', icon: 'box', note: `${plural(meta.materials.filter(m => m.active).length, 'material')}`, warn: '' },
        { key: 'vehicles', label: 'Vehicles', icon: 'truck', note: `${meta.vehicles.filter(v => v.active && v.companyOwned !== false).length} company · ${meta.vehicles.filter(v => v.active && v.companyOwned === false).length} hired`, warn: meta.vehicles.length ? '' : 'none yet' },
        { key: 'charges', label: 'Delivery & charges', icon: 'tag', note: `${money(s.deliveryChargePerTrip)} a trip`, warn: '' },
        { key: 'payments', label: 'Customer payments', icon: 'qr', note: s.upiId ? esc(s.upiId) : 'UPI not set', warn: s.upiId ? '' : 'UPI not set' },
        { key: 'pay', label: 'Pay & accounts', icon: 'hand-coins', note: `payday ${days[s.payDay || 6]}`, warn: '' },
        { key: 'letter', label: 'Letterhead & signatures', icon: 'stamp', note: esc(s.companyName || 'company name not set'), warn: s.companyName ? '' : 'not set' },
        { key: 'heads', label: 'Expense heads', icon: 'receipt', note: plural(meta.expenseHeads.length, 'head'), warn: '' },
    ];
    const acc = getAccess();
    const topics = [...(bcan('SETUP') ? TOPICS : []), ...(acc?.manageAccess ? [{ key: 'access', label: 'People & access', icon: 'shield', note: 'Who may do what (maker-checker)', warn: '' }] : [])];
    const people = acc?.manageAccess && (params[0] === 'access' || (!bcan('SETUP') || view.setupTopic === 'access')) ? await api.get('/bricks/people').catch(() => []) : [];
    const topic = topics.find(t => t.key === (params[0] || view.setupTopic)) || topics[0];
    view.setupTopic = topic.key;
    const edit = data => manage() ? iconBtn(data, 'edit', 'Edit') : '';
    const del = data => manage() ? iconBtn(data, 'trash', 'Delete', 'danger') : '';
    const add = (data, label) => manage() ? `<button class="btn sm primary" ${data}>${icon('plus')}${label}</button>` : '';
    const settingsBtn = sec => manage() ? `<button class="btn sm primary" data-settings="${sec}">${icon('edit')}Change</button>` : '';
    const factList = list => `<div class="bk-setfacts">${list.map(([k, v, hint]) => `<div><span>${esc(k)}</span><b>${v}</b>${hint ? `<small>${hint}</small>` : ''}</div>`).join('')}</div>`;
    const content = {
        types: () => ({ sub: 'The sizes you make and sell. The MRP fills new orders; a lower agreed price shows as a discount.', act: add('data-type-new', 'Brick type'),
            body: `<table class="grid bk-settable"><thead><tr><th>Type</th><th class="r">MRP</th><th class="r">Lowest without approval</th><th class="r">Curing</th><th class="r">Opening stock</th><th>Status</th><th></th></tr></thead><tbody>
                ${meta.types.map(t => `<tr class="${t.active ? '' : 'off'}"><td><b>${esc(t.name)}</b></td>
                    <td class="r">${t.mrp === null ? '<span class="badge warning sm">no MRP</span>' : `<b>${money(t.mrp, { decimals: 2 })}</b>`}</td>
                    <td class="r">${t.minPrice ? money(t.minPrice, { decimals: 2 }) : '<span class="muted">any price</span>'}</td>
                    <td class="r">${t.curingDays ?? 0} days</td><td class="r">${count(t.openingStock)}</td>
                    <td>${t.active ? '<span class="badge good sm">made</span>' : '<span class="badge gray sm">stopped</span>'}</td>
                    <td class="r nowrap">${edit(`data-type="${t.id}"`)}${del(`data-type-del="${t.id}"`)}</td></tr>`).join('')}</tbody></table>` }),
        models: () => ({ sub: 'What a production team earns for each good brick. The default model fills new batches.', act: add('data-model-new', 'Pricing model'),
            body: `<table class="grid bk-settable"><thead><tr><th>Model</th>${meta.types.filter(t => t.active).map(t => `<th class="r">${esc(t.name)}</th>`).join('')}<th></th></tr></thead>
                <tbody>${meta.models.map(m => `<tr class="${m.model.active ? '' : 'off'}"><td><b>${esc(m.model.name)}</b>${m.model.defaultModel ? ' <span class="badge good sm">default</span>' : ''}
                    ${m.model.note ? `<small class="muted block">${esc(m.model.note)}</small>` : ''}</td>
                    ${meta.types.filter(t => t.active).map(t => `<td class="r">${m.rates[t.id] !== undefined ? `₹${m.rates[t.id]}<small class="muted block">${money(num(m.rates[t.id]) * 1000)}/1,000</small>` : '<span class="badge warning sm">none</span>'}</td>`).join('')}
                    <td class="r nowrap">${edit(`data-model="${m.model.id}"`)}${m.model.defaultModel ? '' : del(`data-model-del="${m.model.id}"`)}</td></tr>`).join('')}</tbody></table>` }),
        materials: () => ({ sub: 'Bought and counted after each batch. The opening stock is what was in the yard before the first batch here.', act: add('data-mat-new', 'Raw material'),
            body: `<table class="grid bk-settable"><thead><tr><th>Material</th><th>Unit</th><th class="r">Opening stock</th><th class="r">Reorder below</th><th>Status</th><th></th></tr></thead><tbody>
                ${meta.materials.map(m => `<tr class="${m.active ? '' : 'off'}"><td><b>${esc(m.name)}</b></td><td><span class="badge gray sm">${esc(m.unit)}</span></td>
                    <td class="r">${qty(m.openingStock)}</td><td class="r">${m.reorderLevel !== null ? qty(m.reorderLevel) : '<span class="muted">—</span>'}</td>
                    <td>${m.active ? '<span class="badge good sm">used</span>' : '<span class="badge gray sm">stopped</span>'}</td>
                    <td class="r nowrap">${edit(`data-mat="${m.id}"`)}${del(`data-mat-del="${m.id}"`)}</td></tr>`).join('')}</tbody></table>` }),
        vehicles: () => ({ sub: 'Vehicles you use again and again; their capacity plans the trips. A vehicle hired for one order is picked on the order itself.', act: add('data-vehicle-new', 'Vehicle'),
            body: meta.vehicles.length ? `<table class="grid bk-settable"><thead><tr><th>Number</th><th>Kind</th><th>Owned</th><th class="r">Bricks a trip</th><th>Usual driver</th><th>Status</th><th></th></tr></thead><tbody>
                ${meta.vehicles.map(v => `<tr class="${v.active ? '' : 'off'}"><td><span class="bk-plate sm">${esc(v.number)}</span></td><td>${esc(v.kind || '—')}</td>
                    <td>${v.companyOwned === false ? '<span class="badge gray sm">hired</span>' : '<span class="badge aqua sm">company</span>'}</td>
                    <td class="r"><b>${count(v.capacity)}</b></td><td>${esc(meta.resources.find(r => r.id === v.driverId)?.name || '—')}</td>
                    <td>${v.active ? '<span class="badge good sm">in use</span>' : '<span class="badge gray sm">not in use</span>'}</td><td class="r">${edit(`data-vehicle="${v.id}"`)}</td></tr>`).join('')}</tbody></table>`
                : emptyState('No vehicles yet: add one to plan delivery trips', 'truck') }),
        charges: () => ({ sub: 'What orders charge for delivery and handling, and what drivers and loaders earn for it.', act: settingsBtn('delivery'),
            body: factList([['Delivery charge', `${money(s.deliveryChargePerTrip)} a trip`, 'filled in on new orders'],
                ['Free delivery', s.freeDeliveryMinQty ? `from ${count(s.freeDeliveryMinQty)} bricks` : 'never', 'orders this big get delivery waived'],
                ['Driver incentive', `${money(s.driverIncentivePerTrip)} a trip`, 'a driver can have their own'],
                ['Loading', `₹${num(s.loadingRate)} a brick`, 'earned by the loading team'], ['Unloading', `₹${num(s.unloadingRate)} a brick`, 'earned by the unloading team'],
                ['Bill handling to customers', s.billHandling ? 'Yes' : 'No', s.billHandling ? 'loading & unloading go on the bill' : 'bricks and delivery only']]) }),
        payments: () => ({ sub: 'How customers pay on the order link they get: GPay, PhonePe, BHIM or the QR code.', act: settingsBtn('payments'),
            body: `${s.upiId ? '' : `<div class="bk-getting-started">${icon('alert')}<div><b>No UPI ID yet</b><small>The order link cannot take payments until one is set.</small></div></div>`}
                ${factList([['UPI ID', esc(s.upiId || '—')], ['Payee name', esc(s.payeeName || '—'), 'the name the UPI app shows']])}` }),
        pay: () => ({ sub: 'When the weekly slips are made, and which accounts money comes in to and goes out from.', act: settingsBtn('payments'),
            body: factList([['Weekly payday', days[s.payDay || 6]], ['Customer payments go to', esc(meta.accountsById?.[s.receiptAccountId] || (s.receiptAccountId ? 'set' : 'Brick · cash'))],
                ['Wages and bills are paid from', esc(meta.accountsById?.[s.payAccountId] || (s.payAccountId ? 'set' : 'Brick · cash'))]]) }),
        letter: () => ({ sub: 'On every bill, invoice and payment slip: the company, its stamp and the signatures.', act: settingsBtn('slips'),
            body: `<div class="bk-letter"><div class="bk-letter-head">${icon('brick')}<div><b>${esc(s.companyName || 'Company name not set')}</b><small>${esc(s.address || 'address')} · ${esc(s.phone || 'phone')}</small></div></div>
                <div class="bk-letter-sigs"><div>${s.accountantSignature ? signatureSvg(s.accountantSignature) : '<i></i>'}<small>${esc(s.accountantName || 'Accountant')}</small></div>
                    <div class="sealed"><span class="bk-letter-seal">${sealSvg(s.companyName || 'Company', 'SEAL')}</span>${s.ownerSignature ? signatureSvg(s.ownerSignature) : '<i></i>'}<small>${esc(s.ownerName || 'Owner')}</small></div></div></div>
                ${factList([['Owner', esc(s.ownerName || '—'), s.ownerSignature ? 'signature on file' : 'no signature yet'], ['Accountant', esc(s.accountantName || '—'), s.accountantSignature ? 'signature on file' : 'no signature yet']])}` }),
        access: () => ({ sub: 'Each person’s role in Brick Management. Makers record the day’s work; what touches the money waits for a checker (a manager), who alone sees profit, totals and balances. A staff role chosen here applies to the whole application: that person sees and can use Brick Management only (its screens and its API); the household’s accounts, journal, reports and figures are closed to them. Manager or No access leaves the rest of the application to their app role.',
            act: '', body: `<table class="grid bk-settable bk-access"><thead><tr><th>Person</th><th>App role</th><th>Role here</th><th>What it lets them do</th></tr></thead><tbody>
                ${people.map(u => `<tr class="${u.active ? '' : 'off'}"><td><b>${esc(u.fullName)}</b><small class="muted block">${esc(u.username)}</small></td>
                    <td><span class="badge gray sm">${esc(u.appRole || '')}</span></td>
                    <td><select data-role-of="${u.userId}" data-search>${(acc.roles || []).map(r => `<option value="${r.key}" ${r.key === u.role ? 'selected' : ''} data-meta="${esc(r.description)}">${esc(r.label)}</option>`).join('')}
                        </select>${u.chosen ? (u.role !== 'MANAGER' && u.role !== 'NONE' ? '<small class="warn block">Brick Management only, in the whole app</small>' : '') : '<small class="muted block">from their app role · the rest of the app as usual</small>'}</td>
                    <td class="small">${esc((acc.roles || []).find(r => r.key === u.role)?.description || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No users</td></tr>'}</tbody></table>
                <div class="bk-roles-key">${(acc.roles || []).filter(r => r.key !== 'NONE').map(r => `<div><b>${esc(r.label)}</b><small>${esc(r.description)}</small>
                    <span>${r.permissions.map(p => `<i>${esc(PERM_LABEL[p] || p)}</i>`).join('')}</span></div>`).join('')}</div>` }),
        heads: () => ({ sub: 'Offered when recording a production expense; any other can be typed.', act: settingsBtn('heads'),
            body: `<div class="bk-headchips">${meta.expenseHeads.map(h => `<span>${icon('tag')}${esc(h)}</span>`).join('')}</div>` }),
    };
    const c = content[topic.key]();
    tools.innerHTML = manage() ? `<button class="btn sm" data-settings="delivery">${icon('settings')}All settings</button>` : '';
    body.innerHTML = `<div class="bk-fill bk-twopane">
        <section class="panel headless bk-side-list"><div class="panel-body flush"><div class="bk-side-scroll">
            ${topics.map(t => `<button class="bk-side-row ${t.key === topic.key ? 'selected' : ''}" data-topic="${t.key}">
                <span class="chip-icon sm ${t.warn ? 'gold' : ''}">${icon(t.icon)}</span>
                <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(t.label)}</b>${t.warn ? `<span class="badge warning sm">${icon('alert')}</span>` : ''}</span>
                <span class="bk-sr-line sub"><small class="ellipsis">${t.warn ? `<span class="warn">${t.warn}</span>` : t.note}</small></span></span></button>`).join('')}
        </div></div></section>
        <div class="bk-pane fixed">
            ${panel({ title: topic.label, iconName: topic.icon, cls: 'bk-list-panel bk-grow bk-setpanel', bodyClass: 'flush', actions: c.act,
                body: `<p class="bk-set-sub">${c.sub}</p><div class="bk-scroll bk-pad">${c.body}</div>` })}
        </div></div>`;
    const open = (sec) => openSettings(after, sec);
    tools.onclick = guard(e => { const b = e.target.closest('[data-settings]'); if (b) return open(b.dataset.settings); });
    body.onchange = guard(async e => {
        const r = e.target.closest('[data-role-of]');
        if (!r) return;
        const saved = await api.put(`/bricks/people/${r.dataset.roleOf}`, { role: r.value });
        toast(`${saved.fullName}: ${saved.roleLabel}`);
        return setup({ body, tools, params: ['access'], reload, meta });
    });
    body.onclick = guard(e => {
        const g = sel => e.target.closest(sel);
        if (g('[data-topic]')) { history.replaceState(null, '', `#/bricks/setup/${g('[data-topic]').dataset.topic}`); return setup({ body, tools, params: [g('[data-topic]').dataset.topic], reload, meta }); }
        if (g('[data-settings]')) return open(g('[data-settings]').dataset.settings);
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
    });
    // the accounts' names for "Pay & accounts" (fetched once, then the topic is drawn again)
    if (topic.key === 'pay' && !meta.accountsById) {
        const accts = await moneyAccounts().catch(() => []);
        meta.accountsById = Object.fromEntries(accts.map(a => [a.id, a.name]));
        if (view.setupTopic === 'pay') setup({ body, tools, params: ['pay'], reload, meta });
    }
}
