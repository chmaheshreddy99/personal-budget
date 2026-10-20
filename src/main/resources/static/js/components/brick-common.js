/**
 * What the Brick Management screens share: the set-up (brick types, raw materials, pricing models, vehicles, the
 * team), number formats, pickers for accounts, teams and vehicles, status chips and the delete confirmation.
 */
import { api } from '../core/api.js';
import { can, loadAccounts } from '../core/store.js';
import { esc, confirmDialog, toast } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';

/*
 * The signed-in user's role in Brick Management (maker-checker): what it lets them do. A section says which permission
 * changes it (setWrites), and manage() answers for that section; bcan() asks for any permission.
 */
let access = null;
let writes = null;
const ALL_PERMS = ['STOCK', 'PRODUCTION', 'PURCHASES', 'SALES', 'FINANCE', 'APPROVE', 'SETUP'];
export async function loadAccess(force = false) {
    if (!access || force) {
        try { access = await api.get('/bricks/access'); } catch { access = access || { role: 'VIEWER', label: 'Stock viewer', permissions: ['STOCK'], roles: [], pendingApprovals: 0 }; }
    }
    return access;
}
export const getAccess = () => access;
export const bcan = (...perms) => !access ? can('MANAGE_BRICKS') || perms.includes('STOCK') : perms.some(p => access.permissions.includes(p));
export const setWrites = perm => { writes = perm; };
export const manage = () => writes ? bcan(writes) : bcan('PRODUCTION', 'PURCHASES', 'SALES', 'SETUP');
export const seesMoney = () => bcan('FINANCE');
export { ALL_PERMS };
export const num = v => Number(v || 0);
export const count = v => num(v).toLocaleString('en-IN');
export const qty = v => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const plural = (n, w, ws = `${w}s`) => `${count(n)} ${n === 1 ? w : ws}`;
const ROLE_NAMES = { PRODUCTION_TEAM: 'Production team', PRODUCTION_WORKER: 'Production worker', LOADING_TEAM: 'Loading & unloading', MACHINE_OPERATOR: 'Machine operator' };
export const roleName = r => ROLE_NAMES[r] || String(r || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** The roles offered for each kind of resource: [role, label, icon]. */
export const ROLE_CHOICES = {
    TEAM: [['PRODUCTION_TEAM', 'Production team', 'factory'], ['LOADING_TEAM', 'Loading & unloading', 'layers']],
    LABOUR: [['PRODUCTION_WORKER', 'Production', 'factory'], ['DRIVER', 'Driver', 'truck'], ['LOADING_TEAM', 'Loading & unloading', 'layers'],
        ['MACHINE_OPERATOR', 'Machine operator', 'settings'], ['HELPER', 'Helper', 'hand']],
    STAFF: [['SUPERVISOR', 'Supervisor', 'eye'], ['ACCOUNTANT', 'Accountant', 'calculator'], ['MANAGER', 'Manager', 'briefcase'], ['WATCHMAN', 'Watchman', 'lock']],
};
const STAFF_ROLES = new Set(['SUPERVISOR', 'ACCOUNTANT', 'MANAGER', 'WATCHMAN', 'OTHER']);
/** STAFF or LABOUR: as set, else from the role (a team is always labour). */
export const categoryOf = r => r.category || (r.kind !== 'TEAM' && STAFF_ROLES.has(r.role) ? 'STAFF' : 'LABOUR');
/** A production team or worker: who can make a batch. */
export const makesBricks = r => String(r.role || '').includes('PRODUCTION');
/** Today here (local time, not UTC). */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** The set-up, fetched once and kept until a change (the forms pass back the fresh one). */
let meta = null;
export async function loadMeta(force = false) {
    if (!meta || force) meta = await api.get('/bricks/meta');
    // the first visit sets the business up: the usual brick types, raw materials, a pricing model and its cash
    if (!meta.settings.id) meta = await api.post('/bricks/start');
    return meta;
}
export function setMeta(m) {
    meta = m;
    return m;
}

export const ORDER_STATUS = {
    RECEIVED: ['Order received', 'file-text', 'gray'], LOADING: ['Loading at yard', 'layers', 'warning'], DISPATCHED: ['Dispatched', 'send', 'aqua'],
    IN_TRANSIT: ['On the way', 'truck', 'aqua'], PART_DELIVERED: ['Partly delivered', 'split', 'warning'], DELIVERED: ['Delivered', 'check-circle', 'good'],
    CANCELLED: ['Cancelled', 'x', 'gray'],
};
export const TRIP_STEPS = [['PLANNED', 'Planned', 'calendar'], ['LOADING', 'Loading at yard', 'layers'], ['DISPATCHED', 'Dispatched', 'send'],
    ['IN_TRANSIT', 'On the way', 'truck'], ['DELIVERED', 'Delivered', 'check-circle']];

export function orderBadge(status) {
    const [label, ic, tone] = ORDER_STATUS[status] || [status, 'info', 'gray'];
    return `<span class="badge ${tone} bk-status ${esc(status)}">${icon(ic)}${esc(label)}</span>`;
}

export function tripBadge(status) {
    const s = TRIP_STEPS.find(x => x[0] === status);
    const tone = { PLANNED: 'gray', LOADING: 'warning', DISPATCHED: 'aqua', IN_TRANSIT: 'aqua', DELIVERED: 'good' }[status] || 'gray';
    return `<span class="badge ${tone}">${icon(s ? s[2] : 'x')}${esc(s ? s[1] : 'Cancelled')}</span>`;
}

/** Brick types carry no colour of their own on screen (the section keeps the app's colours); kept so callers stay simple. */
export const swatch = () => '';

/** Money accounts brick money can move through: the brick book's first, then my own (cash, bank, wallet). */
export async function moneyAccounts() {
    // the brick business's own list (names only, no balances): open to every role that records money here
    const all = await api.get('/bricks/money-accounts');
    return all.filter(a => a.active && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.accountType) && !a.chitBook && !a.projectBook);
}

export function moneyOptions(accounts, selected = null, placeholder = 'The default account') {
    const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(a =>
        `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : '';
    return `<option value="">${esc(placeholder)}</option>${group('Brick business', accounts.filter(a => a.brickBook))}${group('My accounts', accounts.filter(a => !a.brickBook))}`;
}

/**
 * Production labour (teams and people) as options, those with the wanted roles first; staff (supervisors, accountants …)
 * never do this work, so they are left out. extra: options to add after the placeholder.
 */
export function resourceOptions(resources, selected = null, { roles = [], placeholder = 'None', kind = null, extra = '' } = {}) {
    const list = resources.filter(r => (r.active || String(r.id) === String(selected)) && (!kind || r.kind === kind)
        && (categoryOf(r) !== 'STAFF' || String(r.id) === String(selected)));
    const fit = list.filter(r => roles.includes(r.role)), rest = list.filter(r => !roles.includes(r.role));
    const opt = r => `<option value="${r.id}" ${String(r.id) === String(selected) ? 'selected' : ''}
        data-meta="${esc([roleName(r.role), r.kind === 'TEAM' && r.memberCount ? `${r.memberCount} people` : '', r.phone || ''].filter(Boolean).join(' · '))}">${esc(r.name)}</option>`;
    return `<option value="">${esc(placeholder)}</option>${extra}${fit.length ? `<optgroup label="${esc(roles.map(roleName).join(' / ') || 'Labour')}">${fit.map(opt).join('')}</optgroup>` : ''}${rest.length ? `<optgroup label="Other labour">${rest.map(opt).join('')}</optgroup>` : ''}`;
}

export function vehicleOptions(vehicles, selected = null, placeholder = 'No vehicle yet') {
    return `<option value="">${esc(placeholder)}</option>${vehicles.filter(v => v.active || String(v.id) === String(selected)).map(v =>
        `<option value="${v.id}" ${String(v.id) === String(selected) ? 'selected' : ''} data-capacity="${v.capacity}" data-driver="${v.driverId || ''}">${esc(v.number)}${v.kind ? ` · ${esc(v.kind)}` : ''} · ${count(v.capacity)} a trip</option>`).join('')}`;
}

export async function confirmDelete(message, run) {
    if (!await confirmDialog(message, { confirmLabel: 'Delete' })) return false;
    try {
        await run();
        return true;
    } catch (e) {
        toast(e.message, 'error');
        return false;
    }
}

/** "Mon 6 Oct" style */
export function dayLabel(iso) {
    if (!iso) return '—';
    return new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The week (Monday to Sunday) holding a date, as ISO dates. */
export function weekOf(iso = today(), back = 0) {
    const d = new Date(iso + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day - back * 7);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
    const f = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: f(from), to: f(to) };
}

export function monthOf(iso = today(), back = 0) {
    const d = new Date(iso + 'T00:00:00');
    const from = new Date(d.getFullYear(), d.getMonth() - back, 1), to = new Date(d.getFullYear(), d.getMonth() - back + 1, 0);
    const f = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { from: f(from), to: f(to) };
}

// ===================================================================== expandable entries

/** What each row opens to: drawn (and loaded) the first time it opens, so long lists stay quick. */
const DETAILS = new Map();
let detailSeq = 0;

/**
 * Entries as one-line rows that open to their details (click the line, or Enter / Space on it). cols: the line's grid
 * columns (after the chevron); line(x): its cells; detail(x): what opens; load(x): optional, an async addition to the
 * details (fetched when the row opens, a spinner meanwhile); key(x): the entry's id (data-key).
 */
export function rowsHtml(list, { key, cols, line, detail, load = null, empty = 'Nothing yet', cls = '', open = null, head = null }) {
    if (!list.length) return `<div class="empty bk-empty">${icon('droplet')}<div>${esc(empty)}</div></div>`;
    if (DETAILS.size > 4000) [...DETAILS.keys()].slice(0, 2000).forEach(k => DETAILS.delete(k));
    // the column headings, lined up with the rows (a label, or [label, 'r'] for a right-aligned figure); they stay on top
    const heading = head ? `<div class="bk-rows-head"><span></span>${head.map(h => {
        const [label, c] = Array.isArray(h) ? h : [h, ''];
        return `<span class="${c}">${esc(label)}</span>`;
    }).join('')}</div>` : '';
    return `<div class="bk-rows ${cls}" style="--cols:${cols}">${heading}${list.map(x => {
        const k = key(x);
        const isOpen = open !== null && String(open) === String(k);
        const id = `d${++detailSeq}`;
        DETAILS.set(id, { x, detail, load });
        return `<div class="bk-row ${isOpen ? 'open' : ''}" data-key="${esc(k)}" data-detail="${id}" ${isOpen && !load ? 'data-filled="1"' : ''}>
            <div class="bk-line" role="button" tabindex="0" aria-expanded="${isOpen}">${icon('chevron-right', 'bk-chev')}${line(x)}</div>
            <div class="bk-detail" ${isOpen ? '' : 'hidden'}>${isOpen && !load ? detail(x) : ''}</div></div>`;
    }).join('')}</div>`;
}

/** Draws a row's details the first time it opens; with load(), shows a spinner while the rest arrives. */
async function fillRow(row) {
    const d = DETAILS.get(row.dataset.detail);
    if (!d || row.dataset.filled) return;
    row.dataset.filled = '1';
    const box = row.querySelector(':scope > .bk-detail');
    box.innerHTML = d.detail ? d.detail(d.x) : '';
    if (!d.load) return;
    box.insertAdjacentHTML('beforeend', `<div class="inline-loading" data-loading><span class="spinner sm"></span>Loading the details…</div>`);
    try {
        const html = await d.load(d.x);
        box.querySelector('[data-loading]')?.insertAdjacentHTML('afterend', html || '');
    } catch (e) {
        box.querySelector('[data-loading]')?.insertAdjacentHTML('afterend', `<p class="small neg">${esc(e.message)}</p>`);
        delete row.dataset.filled;
    }
    box.querySelector('[data-loading]')?.remove();
}

/** Opens any rows drawn open whose details still have to load (call after drawing a list with an open row). */
export function fillOpenRows(root) {
    root.querySelectorAll('.bk-row.open:not([data-filled])').forEach(fillRow);
}

/** Wires the rows inside root (once): a click on the line (not on its buttons) opens or closes it. */
export function bindRows(root) {
    if (root._bkRows) return;
    root._bkRows = true;
    const toggle = (row, open = !row.classList.contains('open')) => {
        if (open) fillRow(row);
        row.classList.toggle('open', open);
        row.querySelector(':scope > .bk-detail').hidden = !open;
        row.querySelector(':scope > .bk-line').setAttribute('aria-expanded', open);
    };
    // a list can sit inside another wired area (an order's trips inside the section): each click is handled once
    root.addEventListener('click', e => {
        if (e._bkRows) return;
        e._bkRows = true;
        const line = e.target.closest('.bk-line');
        if (!line || e.target.closest('button, a, input, select, label')) return;
        toggle(line.parentElement);
    });
    root.addEventListener('keydown', e => {
        if (e._bkRows) return;
        e._bkRows = true;
        const line = e.target.closest?.('.bk-line');
        if (!line || e.target !== line || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        toggle(line.parentElement);
    });
}

/**
 * A click handler whose work may take a while: the button clicked spins and is locked until it is done (a second click
 * does nothing meanwhile). handler(e) may return a promise.
 */
export const guard = handler => async e => {
    const btn = e.target.closest?.('button, a.btn, .bk-side-row, .bk-order-row');
    if (btn?.classList.contains('busy') || btn?.dataset.working) return;
    const result = handler(e);
    if (!btn || !result || typeof result.then !== 'function') return result;
    btn.dataset.working = '1';
    const spin = setTimeout(() => btn.classList.add('busy'), 120);
    try {
        return await result;
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        clearTimeout(spin);
        btn.classList.remove('busy');
        delete btn.dataset.working;
    }
};


/** Initials for an avatar. */
export const initials = name => (String(name || '?').split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).map(w => w[0]).join('') || '?').slice(0, 2).toUpperCase();

/** The look of a role: icon and tone. */
export function roleLook(role) {
    const r = String(role || '');
    if (r.includes('PRODUCTION')) return { icon: 'factory', tone: 'ocean', group: 'Production' };
    if (r.includes('DRIVER')) return { icon: 'truck', tone: 'aqua', group: 'Drivers' };
    if (r.includes('LOADING')) return { icon: 'layers', tone: 'teal', group: 'Loading & unloading' };
    if (STAFF_ROLES.has(r)) return { icon: 'briefcase', tone: 'violet', group: 'Staff' };
    return { icon: 'hand', tone: 'slate', group: 'Other labour' };
}

/**
 * Suggestions under a text box (customers, vendors …) in the app's own pop-up style, small: a name, a line of detail and a
 * figure on the right; ↑ ↓ Enter Esc. items: [{ value, sub?, meta?, icon? }]; onPick(item) after one is taken.
 */
export function suggest(input, items, { onPick = null, max = 7, title = '' } = {}) {
    if (!input || !items.length) return;
    input.setAttribute('autocomplete', `bk-${input.name || 'x'}-off`);   // a token the browser does not know: no autofill
    input.dataset.plain = '1';
    input.removeAttribute('list');
    let pop = null, list = [], active = -1;
    const close = () => { pop?.remove(); pop = null; active = -1; input.removeAttribute('data-enter-self'); };
    const place = () => {
        const r = input.getBoundingClientRect();
        const below = innerHeight - r.bottom > 260;
        Object.assign(pop.style, { left: `${r.left}px`, width: `${Math.max(r.width, 260)}px`, top: below ? `${r.bottom + 4}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - r.top + 4}px` });
    };
    const mark = (text, q) => {
        const i = q ? text.toLowerCase().indexOf(q) : -1;
        return i < 0 ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
    };
    const draw = () => {
        const q = input.value.trim().toLowerCase();
        list = items.filter(it => !q || `${it.value} ${it.sub || ''}`.toLowerCase().includes(q))
            .sort((a, b) => (b.value.toLowerCase().startsWith(q) ? 1 : 0) - (a.value.toLowerCase().startsWith(q) ? 1 : 0)).slice(0, max);
        if (!list.length || (list.length === 1 && list[0].value.toLowerCase() === q)) return close();
        if (!pop) { pop = document.createElement('div'); pop.className = 'ac-pop bk-sug'; document.body.appendChild(pop); }
        active = Math.min(active, list.length - 1);
        pop.innerHTML = `${title ? `<div class="ac-head">${icon('history')}${esc(title)}</div>` : ''}<div class="ac-list">${list.map((it, i) => `<div class="ac-item ${i === active ? 'active' : ''}" data-i="${i}">
            <div class="ac-row">${it.icon ? `<span class="chip-icon sm">${icon(it.icon)}</span>` : ''}<span class="ac-value"><span class="ac-label">${mark(it.value, q)}</span>${it.sub ? `<span class="ac-sub">${esc(it.sub)}</span>` : ''}</span>
            ${it.meta ? `<span class="ac-meta">${it.meta}</span>` : ''}</div></div>`).join('')}</div>`;
        input.setAttribute('data-enter-self', '');
        place();
    };
    const pick = i => {
        const it = list[i];
        if (!it) return;
        input.value = it.value;
        close();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        onPick?.(it);
    };
    input.addEventListener('focus', draw);
    input.addEventListener('input', () => { active = -1; draw(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
        if (!pop) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; draw(); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(active); }
        else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    const onDown = e => {
        if (!input.isConnected) { close(); document.removeEventListener('mousedown', onDown); return; }
        const el = e.target.closest?.('.ac-item');
        if (el && pop?.contains(el)) { e.preventDefault(); pick(Number(el.dataset.i)); }
    };
    document.addEventListener('mousedown', onDown);
    input.closest('.modal-body, .bk-content, .bkb-left')?.addEventListener('scroll', () => pop && place(), { passive: true });
}

/** A production expense head's icon and tone: the brick yard's usual heads first, then the words in the name. */
export function headIcon(head = '') {
    const rules = [[/diesel|fuel|petrol/i, 'fuel', 'coral'], [/electric|power|current|generator/i, 'bolt', 'gold'], [/water/i, 'droplet', 'aqua'],
        [/repair|service|maint|spare/i, 'wrench', 'violet'], [/mould|mold|tool/i, 'layers', 'violet'], [/transport|freight|lorry|tractor|hire/i, 'truck', 'coral'],
        [/food|tea|meal|snack/i, 'utensils', 'gold'], [/rent|lease/i, 'home', 'aqua']];
    const hit = rules.find(([re]) => re.test(head));
    return hit ? { name: hit[1], tone: hit[2] } : categoryIcon(head);
}

/**
 * A record's details as a neat grid: a small grey label over a clear value. items: [label, html, cls?] ('wide' spans the
 * row); empty values are left out.
 */
export function factsHtml(items) {
    return `<dl class="bk-facts">${items.filter(x => x && x[1] !== null && x[1] !== undefined && x[1] !== '').map(([label, value, cls = '']) =>
        `<div class="${cls}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

const rupee = v => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = d => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * The journal entry behind a record, small: its number, type and date, each account it moved (debit, credit and the
 * account's balance after it), and who posted it when. For a row's details (rowsHtml's load).
 */
export async function journalPeek(entryId) {
    if (!entryId) return `<div class="bk-jp none">${icon('journal')}<span>Not in the books: nothing was posted for it</span></div>`;
    const e = await api.get(`/bricks/entries/${entryId}`);
    const dr = e.lines.reduce((t, l) => t + Number(l.debit || 0), 0), cr = e.lines.reduce((t, l) => t + Number(l.credit || 0), 0);
    // an account's balance is for who sees the money
    const bal = seesMoney();
    return `<div class="bk-jp">
        <div class="bk-jp-head">${icon('journal')}<b>${esc(e.entryNo)}</b><span class="bk-jp-type">${esc(e.voucherLabel || '')}</span>
            <span class="muted">${esc(day(e.entryDate))}</span>${e.reversedBy ? `<span class="badge warning sm">reversed by ${esc(e.reversedBy)}</span>` : ''}
            ${e.reversalOf ? `<span class="badge gray sm">reverses ${esc(e.reversalOf)}</span>` : ''}</div>
        <table class="bk-jp-t"><thead><tr><th>Account</th><th class="r">Debit</th><th class="r">Credit</th>${bal ? '<th class="r">Balance after</th>' : ''}</tr></thead>
            <tbody>${e.lines.map(l => `<tr><td><span class="${Number(l.debit) > 0 ? 'dr' : 'cr'}">${Number(l.debit) > 0 ? 'Dr' : 'Cr'}</span>${esc(l.accountName)}${l.memo ? `<small>${esc(l.memo)}</small>` : ''}</td>
                <td class="r">${Number(l.debit) > 0 ? rupee(l.debit) : ''}</td><td class="r">${Number(l.credit) > 0 ? rupee(l.credit) : ''}</td>
                ${bal ? `<td class="r muted">${l.balanceAfter !== null && l.balanceAfter !== undefined ? rupee(l.balanceAfter) : ''}</td>` : ''}</tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="r">${rupee(dr)}</td><td class="r">${rupee(cr)}</td>${bal ? '<td></td>' : ''}</tr></tfoot></table>
        ${e.narration ? `<p class="bk-jp-narr">${esc(e.narration)}</p>` : ''}
        <small class="bk-jp-foot">Posted by ${esc(e.createdBy || '—')}${e.createdAt ? ` · ${esc(new Date(e.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}
            ${e.reference ? ` · ref ${esc(e.reference)}` : ''}</small>
    </div>`;
}
