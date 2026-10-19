/**
 * Small UI toolkit: HTML escaping, panels, tables, forms, modal dialogs, toasts and CSV export.
 * Views build markup with template strings and wire events with delegate().
 */
import { icon, hydrateIcons, accountTypeIcon } from './icons.js';

// ===================================================================== markup helpers

/** Escapes text for safe use inside HTML. */
export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** A glass panel with a titled header and a scrolling body. */
export function panel({ id = '', title, iconName, sub = '', actions = '', body = '', bodyClass = '', foot = '', cls = '' }) {
    return `
    <section class="panel ${cls}" ${id ? `id="${id}"` : ''}>
        <header class="panel-head">
            <h3>${iconName ? `<span class="ico">${icon(iconName)}</span>` : ''}${esc(title)}</h3>
            ${sub ? `<span class="sub">${sub}</span>` : ''}
            <div class="actions">${actions}</div>
        </header>
        <div class="panel-body ${bodyClass}">${body}</div>
        ${foot ? `<footer class="panel-foot">${foot}</footer>` : ''}
    </section>`;
}

export function emptyState(message, iconName = 'droplet') {
    return `<div class="empty">${icon(iconName)}<div>${esc(message)}</div></div>`;
}

export const loading = () => `<div class="loading"><div class="spinner"></div></div>`;

/** Icon chip coloured by account type. */
export function accountChip(type, small = false) {
    const { name, tone } = accountTypeIcon(type);
    return `<span class="chip-icon ${tone} ${small ? 'sm' : ''}">${icon(name)}</span>`;
}

/** KPI tile. */
export function kpi({ label, value, sub = '', iconName, tone = '' }) {
    return `
    <div class="kpi">
        <div class="kpi-icon ${tone}">${icon(iconName)}</div>
        <div class="kpi-text">
            <span class="kpi-label">${esc(label)}</span>
            <span class="kpi-value" title="${esc(stripTags(value))}">${value}</span>
            <span class="kpi-sub">${sub}</span>
        </div>
    </div>`;
}

export function stat(label, value, note = '') {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${value}</div>
            ${note ? `<div class="note">${note}</div>` : ''}</div>`;
}

/** Status badge: always icon + label, never color alone. */
export function statusBadge(status) {
    const map = {
        OK: ['good', 'check-circle', 'On track'],
        WARNING: ['warning', 'alert', 'Near limit'],
        OVER: ['critical', 'alert-circle', 'Over budget'],
        UNBUDGETED: ['gray', 'info', 'No budget'],
        ACTIVE: ['', 'clock', 'Active'],
        PRIZED: ['aqua', 'gift', 'Prized'],
        MATURED: ['good', 'check-circle', 'Matured'],
        CLOSED: ['gray', 'lock', 'Closed'],
        PAID: ['good', 'check', 'Paid'],
        PENDING: ['gray', 'clock', 'Pending'],
        OVERDUE: ['critical', 'alert-circle', 'Overdue'],
    };
    const [tone, iconName, label] = map[status] || ['gray', 'info', status];
    return `<span class="badge ${tone}">${icon(iconName)}${label}</span>`;
}

function stripTags(html) {
    return String(html).replace(/<[^>]*>/g, '');
}

// ===================================================================== tables

/**
 * Renders a table.
 * columns: [{ key, label, align: 'r'|'c', render: (row) => html, cls }]
 * options: { rowClass: (row) => string, rowAttrs: (row) => string, empty, footer: html, compact, dense }
 */
export function table(columns, rows, options = {}) {
    if (!rows.length) return emptyState(options.empty || 'Nothing to show yet');
    const head = columns.map(c => `<th class="${c.align || ''} ${c.cls || ''}">${esc(c.label)}</th>`).join('');
    const body = rows.map(row => {
        const cells = columns.map(c => {
            const content = c.render ? c.render(row) : esc(row[c.key]);
            return `<td class="${c.align || ''} ${c.cls || ''}">${content ?? ''}</td>`;
        }).join('');
        const cls = options.rowClass ? options.rowClass(row) : '';
        const attrs = options.rowAttrs ? options.rowAttrs(row) : '';
        return `<tr class="${cls}" ${attrs}>${cells}</tr>`;
    }).join('');
    return `<table class="grid ${options.compact ? 'compact' : ''} ${options.dense ? 'dense' : ''}">
        <thead><tr>${head}</tr></thead><tbody>${body}</tbody>${options.footer ? `<tfoot>${options.footer}</tfoot>` : ''}
    </table>`;
}

// ===================================================================== forms

/**
 * One labelled form field.
 * type: text | number | date | select | textarea | checkbox | month | password | email
 */
export function field({ label, name, type = 'text', value = '', options = [], required = false, hint = '',
                         span = '', attrs = '', placeholder = '' }) {
    const req = required ? 'required' : '';
    let control;
    if (type === 'select') {
        control = `<select name="${name}" ${req} ${attrs}>${typeof options === 'string' ? options
            : options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (type === 'textarea') {
        control = `<textarea name="${name}" ${req} ${attrs} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
    } else if (type === 'checkbox') {
        return `<label class="field check ${span}"><input type="checkbox" name="${name}" ${value ? 'checked' : ''} ${attrs}>
                <span>${esc(label)}</span></label>`;
    } else {
        const numberAttrs = type === 'number' ? 'step="any" class="num" data-type="number"' : '';
        control = `<input type="${type}" name="${name}" value="${esc(value ?? '')}" ${req} ${numberAttrs} ${attrs}
                   placeholder="${esc(placeholder)}">`;
    }
    return `<label class="field ${span}"><span>${esc(label)}${required ? ' *' : ''}</span>${control}
            ${hint ? `<small>${hint}</small>` : ''}</label>`;
}

/** Reads a form into a plain object: numbers become numbers, empty strings become null. */
export function readForm(form) {
    const data = {};
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
        if (el.type === 'checkbox') {
            data[el.name] = el.checked;
            return;
        }
        const raw = el.value.trim();
        if (raw === '') data[el.name] = null;
        else if (el.dataset.type === 'number' || el.type === 'number') data[el.name] = Number(raw);
        else data[el.name] = raw;
    });
    return data;
}

/**
 * <option>s for account pickers, grouped by class.
 * filter: (account) => boolean
 */
export function accountOptions(accounts, filter = () => true, selected = null, placeholder = 'Select account') {
    const groups = { ASSET: 'Assets', LIABILITY: 'Liabilities', INCOME: 'Income', EXPENSE: 'Expenses', EQUITY: 'Equity' };
    let html = `<option value="">${esc(placeholder)}</option>`;
    for (const [cls, label] of Object.entries(groups)) {
        const list = accounts.filter(a => a.accountClass === cls && a.active && filter(a));
        if (!list.length) continue;
        html += `<optgroup label="${label}">` + list.map(a =>
            `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''} data-type="${a.accountType}"
                data-balance="${a.balance}" data-meta="${esc(a.typeLabel + (a.institution ? ' · ' + a.institution : ''))}">${esc(a.name)}</option>`).join('') + '</optgroup>';
    }
    return html;
}

/** <option>s for a category picker (CategoryView[] of one kind). */
export function categoryOptions(categories, selected = null, placeholder = 'Pick a category') {
    return `<option value="">${esc(placeholder)}</option>` + categories.map(c =>
        `<option value="${c.id}" ${String(c.id) === String(selected) ? 'selected' : ''}
            data-meta="${esc(c.thisMonth && Number(c.thisMonth) ? 'this month ' + Number(c.thisMonth).toLocaleString('en-IN') : (c.description || ''))}">${esc(c.name)}</option>`).join('');
}

// ===================================================================== events

/** Event delegation: handler(event, matchedElement). */
export function delegate(root, type, selector, handler) {
    const listener = event => {
        const target = event.target.closest(selector);
        if (target && root.contains(target)) handler(event, target);
    };
    root.addEventListener(type, listener);
    return () => root.removeEventListener(type, listener);
}

// ===================================================================== toasts

export function toast(message, kind = 'success') {
    const host = document.getElementById('toast-host');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const iconName = kind === 'error' ? 'alert-circle' : kind === 'info' ? 'info' : 'check-circle';
    el.innerHTML = `${icon(iconName)}<div>${esc(message)}</div>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// ===================================================================== modal

/**
 * Opens a modal dialog.
 * body: HTML string. If it contains a <form>, Enter submits via the primary action.
 * actions: [{ label, kind: 'primary'|'danger'|'', iconName, left, onClick: async (modal) => keepOpen? }]
 * Returns { el, close, setError }.
 */
export function openModal({ title, iconName = 'droplet', body, size = '', actions = [], onOpen }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
        <div class="modal ${size}" role="dialog" aria-modal="true">
            <header class="modal-head">
                <h3>${icon(iconName)}${esc(title)}</h3>
                <button class="btn ghost icon sm" data-close title="Close">${icon('x')}</button>
            </header>
            <div class="modal-body">${body}<p class="form-error" data-error></p></div>
            <footer class="modal-foot">
                ${actions.map((a, i) => `<button class="btn ${a.kind || ''} ${a.left ? 'left' : ''}" data-action-index="${i}"
                    ${a.kind && /(primary|danger)/.test(a.kind) ? 'title="Enter"' : a.left && a.onClick ? 'title="Shift + Enter"' : ''}>
                    ${a.iconName ? icon(a.iconName) : ''}${esc(a.label)}${a.kind && /(primary|danger)/.test(a.kind) && actions.length > 1 ? '<span class="kbd light enter-hint">↵</span>' : ''}</button>`).join('')}
            </footer>
        </div>`;
    document.body.appendChild(backdrop);
    hydrateIcons(backdrop);

    const modal = {
        el: backdrop.querySelector('.modal'),
        close() { backdrop.remove(); document.removeEventListener('keydown', onKey); },
        setError(message) { backdrop.querySelector('[data-error]').textContent = message || ''; },
    };

    async function run(action, button) {
        modal.setError('');
        button.disabled = true;
        try {
            const keepOpen = await action.onClick?.(modal);
            if (!keepOpen) modal.close();
        } catch (error) {
            modal.setError(error.message);
        } finally {
            button.disabled = false;
        }
    }

    function onKey(event) {
        if (event.key === 'Escape' && isTop()) modal.close();
    }
    document.addEventListener('keydown', onKey);
    // only the dialog on top reacts to the keyboard (a confirmation can open over another dialog)
    const isTop = () => [...document.querySelectorAll('.modal-backdrop')].pop() === backdrop;

    /**
     * Enter anywhere in the dialog runs the primary action (no mouse needed); Shift+Enter the left-hand
     * alternative ("Save & add another"). Inside a text area Ctrl+Enter does it. A suggestion list, a combo
     * search or a button that handles Enter itself goes first.
     */
    const primaryIndex = actions.findIndex(a => a.kind && /\b(primary|danger)\b/.test(a.kind));
    const altIndex = actions.findIndex(a => a.left && a.onClick);
    backdrop.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || !isTop()) return;
        const target = event.target;
        // a picked chip or tile (category, account, date, mode) does not hold Enter back: it saves
        const chip = target.closest('.cat-tile, .pay-chip, .date-chip, .xp-mode, .mode-tile, .seg-chip, .access-chip, .into-chip, .dp-chip');
        if (!chip && target.closest('button, a, [data-enter-self], .ac-pop, .combo-display')) return;
        if (target.tagName === 'TEXTAREA' && !(event.ctrlKey || event.metaKey)) return;
        const index = event.shiftKey && altIndex >= 0 ? altIndex : primaryIndex;
        if (index < 0) return;
        event.preventDefault();
        const button = backdrop.querySelector(`[data-action-index="${index}"]`);
        if (!button.disabled) run(actions[index], button);
    });

    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) modal.close(); });
    backdrop.querySelector('[data-close]').addEventListener('click', () => modal.close());
    backdrop.querySelectorAll('[data-action-index]').forEach(button => {
        button.addEventListener('click', () => run(actions[Number(button.dataset.actionIndex)], button));
    });
    const form = backdrop.querySelector('form');
    if (form) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            const primaryIndex = actions.findIndex(a => a.kind === 'primary');
            if (primaryIndex >= 0) run(actions[primaryIndex], backdrop.querySelector(`[data-action-index="${primaryIndex}"]`));
        });
    }
    onOpen?.(modal);
    // the first field, or (a confirmation, a list) the primary button, so Enter works straight away
    setTimeout(() => {
        const first = [...backdrop.querySelectorAll('.modal-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([readonly]), .modal-body textarea')]
            .find(el => !el.disabled && el.offsetParent !== null);
        (first || backdrop.querySelector(`[data-action-index="${primaryIndex}"]`))?.focus();
    }, 30);
    return modal;
}

/** Yes/no confirmation. Resolves true when confirmed. */
export function confirmDialog(message, { title = 'Please confirm', confirmLabel = 'Confirm', danger = true } = {}) {
    return new Promise(resolve => {
        openModal({
            title, iconName: danger ? 'alert' : 'info',
            body: `<p style="margin:0">${esc(message)}</p>`,
            actions: [
                { label: 'Cancel', onClick: () => resolve(false) },
                { label: confirmLabel, kind: danger ? 'danger solid' : 'primary', onClick: () => resolve(true) },
            ],
        });
    });
}

// ===================================================================== export

/** Downloads rows (array of arrays) as a CSV file. */
export function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(cell => {
        const text = String(cell ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Prints only the given element (e.g. a report panel). */
export function printElement(el, title) {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return;
    const styles = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title>${styles}
        <style>body{overflow:auto;background:#fff;padding:20px}.panel{box-shadow:none;border:1px solid #ddd}
        .panel-body{overflow:visible}.btn{display:none}</style></head><body><h2>${esc(title)}</h2>${el.outerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
}
