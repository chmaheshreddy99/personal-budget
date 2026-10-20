/**
 * What the Brick Management screens share: the set-up (brick types, raw materials, pricing models, vehicles, the
 * team), number formats, pickers for accounts, teams and vehicles, status chips and the delete confirmation.
 */
import { api } from '../core/api.js';
import { can, loadAccounts } from '../core/store.js';
import { esc, confirmDialog, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';

export const manage = () => can('MANAGE_BRICKS');
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
    const all = await loadAccounts(true, { all: true });
    return all.filter(a => a.active && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.accountType) && !a.chitBook && !a.projectBook);
}

export function moneyOptions(accounts, selected = null, placeholder = 'The default account') {
    const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(a =>
        `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : '';
    return `<option value="">${esc(placeholder)}</option>${group('Brick business', accounts.filter(a => a.brickBook))}${group('My accounts', accounts.filter(a => !a.brickBook))}`;
}

/** Teams / people as options, those with the wanted roles first. */
export function resourceOptions(resources, selected = null, { roles = [], placeholder = 'None', kind = null } = {}) {
    const list = resources.filter(r => (r.active || String(r.id) === String(selected)) && (!kind || r.kind === kind));
    const fit = list.filter(r => roles.includes(r.role)), rest = list.filter(r => !roles.includes(r.role));
    const opt = r => `<option value="${r.id}" ${String(r.id) === String(selected) ? 'selected' : ''}>${esc(r.name)} · ${esc(roleName(r.role))}</option>`;
    return `<option value="">${esc(placeholder)}</option>${fit.map(opt).join('')}${rest.length && fit.length ? `<optgroup label="Others">${rest.map(opt).join('')}</optgroup>` : rest.map(opt).join('')}`;
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

/**
 * Entries as one-line rows that open to their details (click the line, or Enter / Space on it). cols: the line's grid
 * columns (after the chevron); line(x): its cells; detail(x): what opens; key(x): the entry's id (data-key).
 */
export function rowsHtml(list, { key, cols, line, detail, empty = 'Nothing yet', cls = '', open = null }) {
    if (!list.length) return `<div class="empty bk-empty">${icon('droplet')}<div>${esc(empty)}</div></div>`;
    return `<div class="bk-rows ${cls}" style="--cols:${cols}">${list.map(x => {
        const k = key(x);
        const isOpen = open !== null && String(open) === String(k);
        return `<div class="bk-row ${isOpen ? 'open' : ''}" data-key="${esc(k)}">
            <div class="bk-line" role="button" tabindex="0" aria-expanded="${isOpen}">${icon('chevron-right', 'bk-chev')}${line(x)}</div>
            <div class="bk-detail" ${isOpen ? '' : 'hidden'}>${detail(x)}</div></div>`;
    }).join('')}</div>`;
}

/** Wires the rows inside root (once): a click on the line (not on its buttons) opens or closes it. */
export function bindRows(root) {
    if (root._bkRows) return;
    root._bkRows = true;
    const toggle = (row, open = !row.classList.contains('open')) => {
        row.classList.toggle('open', open);
        row.querySelector(':scope > .bk-detail').hidden = !open;
        row.querySelector(':scope > .bk-line').setAttribute('aria-expanded', open);
    };
    // a list can sit inside another wired area (an order's trips inside the section): each click is handled once
    root.addEventListener('click', e => {
        if (e._bkRows) return;
        e._bkRows = true;
        const all = e.target.closest('[data-expand-all]');
        if (all) {
            const scope = all.closest('.panel') || root;
            const open = all.dataset.expandAll === 'open';
            scope.querySelectorAll('.bk-row').forEach(r => toggle(r, open));
            all.dataset.expandAll = open ? 'close' : 'open';
            all.innerHTML = open ? `${icon('chevron-up')}Collapse all` : `${icon('chevron-down')}Expand all`;
            return;
        }
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

export const expandAllButton = () => `<button type="button" class="btn sm ghost" data-expand-all="open">${icon('chevron-down')}Expand all</button>`;

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
