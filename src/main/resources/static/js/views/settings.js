/**
 * Settings: categories (add, rename, switch off), the dashboard layout, view preferences and the
 * keyboard shortcut list. Routes: #/settings, #/settings/<section>.
 */
import { api } from '../core/api.js';
import { loadCategories, can, state } from '../core/store.js';
import { qrSvg } from '../core/qr.js';
import { esc, panel, emptyState, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { moneyShort } from '../core/format.js';
import { getPref, setPref, clearPrefs } from '../core/prefs.js';
import { SHORTCUTS, setPageKeys, listNavigator } from '../core/keys.js';
import { customizerHtml, bindCustomizer } from '../components/dashboard-customizer.js';

const SECTIONS = [
    { id: 'categories', label: 'Categories', iconName: 'tag', hint: 'Expense and income categories' },
    { id: 'dashboard', label: 'Dashboard', iconName: 'dashboard', hint: 'Panels, order and size' },
    { id: 'preferences', label: 'Preferences', iconName: 'settings', hint: 'How pages open' },
    { id: 'shortcuts', label: 'Keyboard', iconName: 'keyboard', hint: 'Every shortcut' },
    { id: 'mobile', label: 'Mobile app', iconName: 'phone', hint: 'Address and who can use it' },
];

export async function render(container, params, isCurrent) {
    const section = SECTIONS.some(s => s.id === params[0]) ? params[0] : 'categories';
    container.innerHTML = `
    <div class="page settings-page">
        ${panel({ title: 'Settings', iconName: 'settings', cls: 'p-set-nav', bodyClass: 'flush',
            body: `<div class="set-nav" id="set-nav">${SECTIONS.map(s => `
                <a class="set-item ${s.id === section ? 'selected' : ''}" href="#/settings/${s.id}" data-section="${s.id}">
                    <span class="chip-icon sm">${icon(s.iconName)}</span><span class="min-0"><b>${s.label}</b><small>${s.hint}</small></span></a>`).join('')}
                <a class="set-item" href="#/admin/profile"><span class="chip-icon sm">${icon('user')}</span><span class="min-0"><b>Profile &amp; users</b><small>Password, roles</small></span></a>
            </div>` })}
        <div class="set-body" id="set-body"></div>
    </div>`;

    const nav = container.querySelector('#set-nav');
    setPageKeys(listNavigator({
        items: () => [...nav.querySelectorAll('[data-section]')],
        selected: () => nav.querySelector('.selected'),
        select: el => { location.hash = el.getAttribute('href'); },
    }));

    const body = container.querySelector('#set-body');
    if (section === 'categories') await renderCategories(body, isCurrent, () => render(container, params, isCurrent));
    if (section === 'dashboard') {
        body.innerHTML = panel({ title: 'Dashboard layout', iconName: 'dashboard', actions: `<a class="btn sm" href="#/dashboard">${icon('eye')}View dashboard</a>`,
            body: '<div id="set-dash"></div>' });
        const host = body.querySelector('#set-dash');
        const draw = () => { host.innerHTML = customizerHtml(); };
        bindCustomizer(host, draw);
        draw();
    }
    if (section === 'preferences') renderPreferences(body);
    if (section === 'mobile') await renderMobile(body, () => render(container, params, isCurrent));
    if (section === 'shortcuts') {
        body.innerHTML = panel({ title: 'Keyboard shortcuts', iconName: 'keyboard',
            body: `<div class="shortcut-map">${SHORTCUTS.map(g => `<section><div class="section-title">${esc(g.group)}</div>
                ${g.keys.map(([k, l]) => `<div class="sc-row">${k.split(' ').map(x => `<span class="kbd">${esc(x)}</span>`).join('')}<span>${esc(l)}</span></div>`).join('')}</section>`).join('')}</div>` });
    }
}

// ===================================================================== mobile version

/** Where the mobile version lives (admins can move it), a QR code to open it, and who may use it. */
async function renderMobile(body, reload) {
    const app = await api.get('/meta/app');
    const admin = can('MANAGE_USERS');
    const users = admin ? await api.get('/admin/users').catch(() => []) : [];
    const url = `${location.origin}/${app.mobilePath}/`;
    body.innerHTML = panel({ title: 'Mobile app', iconName: 'phone',
        actions: `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${icon('link')}Open</a>`,
        body: `<div class="mobile-settings">
            <div class="ms-qr">${qrSvg(url, { size: 168 })}<small>Scan with the phone camera</small></div>
            <div class="ms-main">
                <p class="hint">A lighter version for phones: the money at a glance, expenses (add one in seconds), accounts, chits, budgets and income.
                    It signs in separately and shows only the sections an admin shared for mobile.</p>
                <form id="mobile-path-form" class="ms-path">
                    <label class="field"><span>Address</span>
                        <span class="ms-url"><span class="muted">${esc(location.origin)}/</span><input name="mobilePath" value="${esc(app.mobilePath)}" ${admin ? '' : 'readonly'}
                            pattern="[a-z0-9][a-z0-9-]{0,29}" maxlength="30" required data-plain><span class="muted">/</span></span></label>
                    ${admin ? `<button class="btn primary" type="submit">${icon('check')}Save address</button>` : '<span class="small muted">Only an admin can change the address.</span>'}
                </form>
                ${admin ? `<div class="section-title">Who can use it</div>
                    <div class="ms-users">${users.map(u => `<div class="ms-user"><span class="avatar sm">${esc(u.fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
                        <div class="grow min-0"><b>${esc(u.fullName)}</b><small class="muted">${u.mobileAccess
                            ? esc(u.mobileFeatures.filter(k => u.features.includes(k)).map(k => k.charAt(0) + k.slice(1).toLowerCase().replace('_', ' ')).join(', ') || 'no sections')
                            : 'no mobile access'}</small></div>
                        <span class="badge ${u.mobileAccess ? 'aqua' : 'gray'}">${icon('phone')}${u.mobileAccess ? 'Allowed' : 'Off'}</span></div>`).join('')}</div>
                    <p class="small muted">${icon('info')} Change a user's sections and mobile access under <a href="#/admin/users">Users</a>.</p>` : ''}
            </div>
        </div>` });
    body.querySelector('#mobile-path-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const saved = await api.put('/admin/app-settings', { mobilePath: e.target.mobilePath.value });
            toast(`The mobile version is now at /${saved.mobilePath}/`);
            reload();
        } catch (error) { toast(error.message, 'error'); }
    });
}

// ===================================================================== categories

async function renderCategories(body, isCurrent, reload) {
    const accounts = await loadCategories(true);   // categories: one Expenses / Income account, split by these
    if (!isCurrent()) return;
    const manage = can('MANAGE_ACCOUNTS');
    const list = kind => accounts.filter(a => a.kind === kind).sort((a, b) => a.code.localeCompare(b.code));
    const column = (cls, title, iconName) => panel({
        title, iconName, cls: 'p-set-cats', bodyClass: 'flush', sub: `${list(cls).length}`,
        body: `<div class="cat-list scroll">${list(cls).map(a => {
            const ci = categoryIcon(a.name);
            return `<div class="cat-row ${a.active ? '' : 'inactive'}" data-id="${a.id}">
                <span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
                <span class="grow min-0"><b class="ellipsis">${esc(a.name)}</b>${a.system ? ' <span class="tag" title="Used by automatic postings (chits, interest)">system</span>' : ''}<small>${esc(a.code)} · ${a.entries} entries${a.description ? ' · ' + esc(a.description) : ''}</small></span>
                <span class="r"><b class="mono">${moneyShort(Math.abs(Number(a.thisMonth || 0)))}</b><small>this month · avg ${moneyShort(a.averageLast3Months || 0)}</small></span>
                ${manage ? `<span class="cat-actions">
                    <button class="btn sm ghost icon" data-rename="${a.id}" title="Rename">${icon('edit')}</button>
                    ${a.system ? '' : `<button class="btn sm ghost icon" data-toggle="${a.id}" title="${a.active ? 'Hide from pickers' : 'Use again'}">${icon(a.active ? 'eye' : 'refresh')}</button>
                    <button class="btn sm ghost icon danger" data-delete="${a.id}" title="Delete (only when unused)">${icon('trash')}</button>`}</span>` : ''}
            </div>`;
        }).join('') || emptyState('None yet', 'tag')}</div>`,
    });

    body.innerHTML = `
        ${manage ? `<section class="panel p-set-add">
            <form class="cat-add" id="cat-add" autocomplete="off">
                <span class="chip-icon" id="cat-preview">${icon('tag')}</span>
                <div class="seg-chips" id="cat-kind">
                    <button type="button" class="seg-chip active" data-kind="EXPENSE">${icon('arrow-out')}Expense</button>
                    <button type="button" class="seg-chip" data-kind="INCOME">${icon('arrow-in')}Income</button></div>
                <input name="name" placeholder="New category, e.g. Pet care, Freelance design" required maxlength="100" data-plain>
                <input name="description" placeholder="Description (optional)" maxlength="255" data-plain>
                <button class="btn primary" type="submit">${icon('plus')}Add category</button>
            </form>
        </section>` : ''}
        <div class="set-cats">
            ${column('EXPENSE', 'Expense categories', 'arrow-out')}
            ${column('INCOME', 'Income sources', 'arrow-in')}
        </div>`;

    const form = body.querySelector('#cat-add');
    if (form) {
        let kind = 'EXPENSE';
        form.querySelector('#cat-kind').addEventListener('click', e => {
            const b = e.target.closest('[data-kind]');
            if (!b) return;
            kind = b.dataset.kind;
            form.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === b));
        });
        form.name.addEventListener('input', () => {
            const ci = categoryIcon(form.name.value);
            form.querySelector('#cat-preview').className = `chip-icon ${ci.tone}`;
            form.querySelector('#cat-preview').innerHTML = icon(ci.name);
        });
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const name = form.name.value.trim();
            if (accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" already exists`, 'error'); return; }
            try {
                await api.post('/categories', { name, kind, description: form.description.value.trim() || null, active: true });
                toast(`${kind === 'EXPENSE' ? 'Expense category' : 'Income source'} "${name}" added`);
                reload();
            } catch (error) { toast(error.message, 'error'); }
        });
        setTimeout(() => form.name.focus(), 50);
    }

    body.addEventListener('click', async e => {
        const btn = e.target.closest('[data-rename], [data-toggle], [data-delete]');
        if (!btn) return;
        const a = accounts.find(x => x.id === Number(btn.dataset.rename || btn.dataset.toggle || btn.dataset.delete));
        const payload = extra => ({ kind: a.kind, code: a.code, name: a.name, description: a.description, active: a.active, version: a.version, ...extra });
        try {
            if (btn.dataset.rename) {
                openModal({
                    title: `Rename ${a.name}`, iconName: 'edit',
                    body: `<form class="form-grid one"><label class="field"><span>Name</span><input name="name" value="${esc(a.name)}" required maxlength="100" data-plain></label>
                        <label class="field"><span>Description</span><input name="description" value="${esc(a.description || '')}" maxlength="255" data-plain></label></form>`,
                    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
                        const f = m.el.querySelector('form');
                        if (!f.reportValidity()) return true;
                        await api.put(`/categories/${a.id}`, payload({ name: f.name.value.trim(), description: f.description.value.trim() || null }));
                        toast('Renamed');
                        reload();
                    } }],
                });
            }
            if (btn.dataset.toggle) {
                await api.put(`/categories/${a.id}`, payload({ active: !a.active }));
                toast(a.active ? `${a.name} hidden from pickers` : `${a.name} is back`);
                reload();
            }
            if (btn.dataset.delete && await confirmDialog(`Delete "${a.name}"? Categories that have transactions can only be hidden.`)) {
                await api.del(`/categories/${a.id}`);
                toast('Deleted');
                reload();
            }
        } catch (error) { toast(error.message, 'error'); }
    });
}

// ===================================================================== preferences

function renderPreferences(body) {
    const statement = getPref('statement', { grouped: false, groupBy: 'month' });
    const expenses = getPref('expenses', { grouped: false });
    const chits = getPref('chits', { includeMatured: false });
    const toggle = (id, label, hint, checked) => `
        <div class="pref-row"><div class="grow"><b>${label}</b><small>${hint}</small></div>
            <label class="switch"><input type="checkbox" data-pref="${id}" ${checked ? 'checked' : ''}><span></span></label></div>`;
    body.innerHTML = panel({ title: 'Preferences', iconName: 'settings', sub: 'Saved in this browser',
        actions: `<button class="btn sm" id="pref-reset">${icon('refresh')}Reset all</button>`,
        body: `<div class="prefs">
            ${toggle('statement.grouped', 'Account statements as a timeline', 'Group entries by month (or party) with totals', statement.grouped)}
            <div class="pref-row"><div class="grow"><b>Timeline groups by</b><small>When the timeline is on</small></div>
                <div class="seg-chips sm" id="pref-groupby">
                    <button class="seg-chip ${statement.groupBy === 'month' ? 'active' : ''}" data-groupby="month">Month</button>
                    <button class="seg-chip ${statement.groupBy === 'party' ? 'active' : ''}" data-groupby="party">Party</button></div></div>
            ${toggle('expenses.grouped', 'Expenses grouped by day', 'Day headers with daily totals', expenses.grouped)}
            ${toggle('chits.includeMatured', 'Count matured chits in gains', 'Chit portfolio strip includes realised gains', chits.includeMatured)}
        </div>` });
    body.addEventListener('change', e => {
        const [name, key] = (e.target.dataset.pref || '').split('.');
        if (!name) return;
        const value = getPref(name, {});
        value[key] = e.target.checked;
        setPref(name, value);
        toast('Saved', 'info');
    });
    body.querySelector('#pref-groupby').addEventListener('click', e => {
        const b = e.target.closest('[data-groupby]');
        if (!b) return;
        setPref('statement', { ...getPref('statement', { grouped: false }), groupBy: b.dataset.groupby });
        body.querySelectorAll('[data-groupby]').forEach(x => x.classList.toggle('active', x === b));
    });
    body.querySelector('#pref-reset').addEventListener('click', async () => {
        if (!await confirmDialog('Reset every view preference and the dashboard layout?', { confirmLabel: 'Reset', danger: false })) return;
        clearPrefs();
        location.reload();   // modules read their preferences once, when they load
    });
}

