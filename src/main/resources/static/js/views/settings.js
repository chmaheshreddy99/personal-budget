/**
 * Settings: categories (add, rename, switch off), the dashboard layout, view preferences, the
 * keyboard shortcut list, the mobile version, the household's e-mail account, the organization's time zone and (super
 * admins) backups of the whole data. Routes: #/settings, #/settings/<section>.
 */
import { api } from '../core/api.js';
import { loadCategories, can, state } from '../core/store.js';
import { qrSvg } from '../core/qr.js';
import { esc, panel, emptyState, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { moneyShort, dateTime, setTimeZone, orgNow } from '../core/format.js';
import { getPref, setPref, clearPrefs } from '../core/prefs.js';
import { SHORTCUTS, setPageKeys, listNavigator } from '../core/keys.js';
import { customizerHtml, bindCustomizer } from '../components/dashboard-customizer.js';

const SECTIONS = [
    { id: 'categories', label: 'Categories', iconName: 'tag', hint: 'Expense and income categories' },
    { id: 'dashboard', label: 'Dashboard', iconName: 'dashboard', hint: 'Panels, order and size' },
    { id: 'preferences', label: 'Preferences', iconName: 'settings', hint: 'How pages open' },
    { id: 'shortcuts', label: 'Keyboard', iconName: 'keyboard', hint: 'Every shortcut' },
    { id: 'mobile', label: 'Mobile app', iconName: 'phone', hint: 'Address and who can use it' },
    { id: 'email', label: 'E-mail', iconName: 'mail', hint: 'Account for reminders and receipts' },
    { id: 'chits', label: 'Host a Chit', iconName: 'hand-coins', hint: 'Company name for new chits' },
    { id: 'organization', label: 'Organization', iconName: 'clock', hint: 'Time zone for dates and times' },
    { id: 'backup', label: 'Backup', iconName: 'database', hint: 'Save and restore all data', permission: 'MANAGE_TENANTS' },
];
const sections = () => SECTIONS.filter(s => !s.permission || can(s.permission));

export async function render(container, params, isCurrent) {
    const section = sections().some(s => s.id === params[0]) ? params[0] : 'categories';
    container.innerHTML = `
    <div class="page settings-page">
        ${panel({ title: 'Settings', iconName: 'settings', cls: 'p-set-nav', bodyClass: 'flush',
            body: `<div class="set-nav" id="set-nav">${sections().map(s => `
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
    if (section === 'email') await renderMail(body, () => render(container, params, isCurrent));
    if (section === 'chits') await renderChitSettings(body, () => render(container, params, isCurrent));
    if (section === 'organization') await renderOrganization(body, () => render(container, params, isCurrent));
    if (section === 'backup') await renderBackup(body, () => render(container, params, isCurrent));
    if (section === 'shortcuts') {
        body.innerHTML = panel({ title: 'Keyboard shortcuts', iconName: 'keyboard',
            body: `<div class="shortcut-map">${SHORTCUTS.map(g => `<section><div class="section-title">${esc(g.group)}</div>
                ${g.keys.map(([k, l]) => `<div class="sc-row">${k.split(' ').map(x => `<span class="kbd">${esc(x)}</span>`).join('')}<span>${esc(l)}</span></div>`).join('')}</section>`).join('')}</div>` });
    }
}

// ===================================================================== organization

/**
 * The organization's time zone: dates and times are recorded and shown in it, whatever zone the server runs in.
 * Everyone sees it; an admin changes it.
 */
async function renderOrganization(body, reload) {
    const admin = can('MANAGE_USERS');
    const [tz, zones] = admin
        ? await Promise.all([api.get('/admin/organization/time-zone'), api.get('/admin/time-zones')])
        : [{ effective: state.user?.timeZone, timeZone: state.user?.timeZone }, []];
    const current = tz.timeZone || '';
    const bench = await api.get('/admin/claim-benchmark').catch(() => null);
    body.innerHTML = panel({ title: 'Organization', iconName: 'clock', sub: esc(state.user?.tenantName || ''),
        body: `<form class="form-grid one" id="tz-form" style="max-width:620px">
            <label class="field"><span>Time zone</span>
                ${admin ? `<select name="timeZone" data-plain>
                    <option value="" ${current ? '' : 'selected'}>The server's time zone (${esc(tz.serverTimeZone)})</option>
                    ${zones.map(z => `<option value="${esc(z.id)}" ${z.id === current ? 'selected' : ''}>${esc(z.label)}</option>`).join('')}
                </select>` : `<input value="${esc(tz.effective || '')}" readonly data-plain>`}
                <small>Dates and times are recorded and shown in this zone: "today", when an entry was made, sign-ins, due dates.</small></label>
            ${bench ? `<label class="field"><span>Interest-free lending: compare with <small class="muted">% a year</small></span>
                <input name="benchmark" type="number" min="0" max="40" step="0.1" value="${bench.configured ?? ''}" placeholder="${bench.effective ?? 'none'}" data-plain ${admin ? '' : 'readonly'}>
                <small>Money lent or paid for someone without interest shows, greyed out, what the bank would have paid on it. Empty = the best interest rate among your bank and deposit accounts${bench.effective ? ` (now ${bench.effective}%, ${esc(bench.source)})` : ' (none of your accounts has a rate yet)'}.</small></label>` : ''}
            ${admin ? `<div class="book-note">${icon('clock')}<span>Now in <b>${esc(tz.effectiveLabel)}</b>: <b>${esc(dateTime(tz.now))}</b>.
                Times are kept in ${esc(tz.serverTimeZone)} and shown in this zone, so a change moves every time shown, those saved before it too.</span></div>
                <div class="row"><button class="btn primary" type="submit">${icon('check')}Save</button></div>`
                : `<p class="small muted">${icon('lock')} Only an admin of the organization can change it.</p>`}
        </form>` });
    body.querySelector('#tz-form').addEventListener('submit', async e => {
        e.preventDefault();
        if (!admin) return;
        try {
            if (e.target.benchmark) await api.put('/admin/claim-benchmark', { configured: e.target.benchmark.value === '' ? null : Number(e.target.benchmark.value) });
            const saved = await api.put('/admin/organization/time-zone', { timeZone: e.target.timeZone.value || null });
            if (state.user) state.user.timeZone = saved.effective;
            setTimeZone(saved.effective);
            toast(`Time zone saved: ${saved.effective}`);
            reload();
        } catch (error) { toast(error.message, 'error'); }
    });
}

// ===================================================================== backup

const fileSize = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Backups of the whole installation (every organization): a JSON file written to the server's backup folder, to
 * download and keep somewhere safe; one on the server or an uploaded one restores the data. Super admins only.
 */
async function renderBackup(body, reload) {
    const { folder, backups } = await api.get('/admin/backups');
    const kind = name => name.startsWith('before-restore') ? ['warning', 'Before a restore']
        : name.startsWith('uploaded') ? ['aqua', 'Uploaded'] : ['good', 'Backup'];
    body.innerHTML = `
        ${panel({ title: 'Backup', iconName: 'database', sub: 'Every organization, every table',
            body: `<div class="form-grid one" style="max-width:720px">
                <p class="hint" style="margin:0">A backup is one JSON file with all the data, whichever storage holds it (files or Google Sheets).
                    It is saved on the server in <code>${esc(folder)}</code> and can be downloaded. Restoring one replaces all the data with
                    the backup's, after saving the current data as a backup first, so a restore can be undone.</p>
                <label class="pref-row"><div class="grow"><b>Include evidence files</b><small>Photos and scans attached to entries (the file gets bigger)</small></div>
                    <span class="switch"><input type="checkbox" id="bk-files"><span></span></span></label>
                <div class="row">
                    <button class="btn primary" type="button" id="bk-create">${icon('database')}Back up now</button>
                    <button class="btn" type="button" id="bk-pick">${icon('upload')}Restore from a file…</button>
                    <input type="file" id="bk-upload" accept=".json,application/json" hidden>
                </div>
            </div>` })}
        ${panel({ title: 'Backups on the server', iconName: 'history', sub: `${backups.length}`, bodyClass: 'flush',
            body: backups.length ? `<div class="cat-list">${backups.map(b => {
                const [tone, label] = kind(b.name);
                return `<div class="cat-row" data-name="${esc(b.name)}">
                    <span class="chip-icon sm">${icon('database')}</span>
                    <span class="grow min-0"><b class="ellipsis">${esc(b.name)}</b><small>${esc(dateTime(b.createdAt))} · ${fileSize(b.bytes)}</small></span>
                    <span class="badge ${tone}">${label}</span>
                    <span class="cat-actions bk-actions">
                        <button class="btn sm" data-download title="Download">${icon('download')}Download</button>
                        <button class="btn sm" data-restore title="Replace all data with this backup">${icon('undo')}Restore</button>
                        <button class="btn sm ghost icon danger" data-delete title="Delete">${icon('trash')}</button></span>
                </div>`;
            }).join('')}</div>` : emptyState('No backups yet', 'database') })}`;

    const restored = r => {
        toast(`Restored ${r.restored}: ${r.tables} tables, ${r.rows} rows${r.files ? `, ${r.files} files` : ''}. The data before it is in ${r.safetyBackup}.`);
        setTimeout(() => location.reload(), 1500);   // every page and cache starts again from the restored data
    };
    const sure = what => confirmDialog(`Replace ALL the data, of every organization, with ${what}? The current data is backed up first.`,
        { title: 'Restore a backup', confirmLabel: 'Restore' });

    body.querySelector('#bk-create').addEventListener('click', async () => {
        try {
            const b = await api.post('/admin/backups', { includeFiles: body.querySelector('#bk-files').checked });
            toast(`Backup saved: ${b.name} (${fileSize(b.bytes)})`);
            reload();
        } catch (error) { toast(error.message, 'error'); }
    });
    body.querySelector('#bk-pick').addEventListener('click', () => body.querySelector('#bk-upload').click());
    body.querySelector('#bk-upload').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !await sure(`the backup "${file.name}"`)) return;
        const form = new FormData();
        form.append('file', file);
        try { restored(await api.upload('/admin/backups/upload', form)); } catch (error) { toast(error.message, 'error'); }
    });
    body.addEventListener('click', async e => {
        const btn = e.target.closest('[data-download], [data-restore], [data-delete]');
        if (!btn) return;
        const name = btn.closest('[data-name]').dataset.name;
        try {
            if (btn.hasAttribute('data-download')) {
                const url = URL.createObjectURL(await api.blob(`/admin/backups/${encodeURIComponent(name)}`));
                const a = Object.assign(document.createElement('a'), { href: url, download: name });
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            }
            if (btn.hasAttribute('data-restore') && await sure(`the backup "${name}"`)) {
                restored(await api.post(`/admin/backups/${encodeURIComponent(name)}/restore`));
            }
            if (btn.hasAttribute('data-delete') && await confirmDialog(`Delete the backup "${name}" from the server?`, { confirmLabel: 'Delete' })) {
                await api.del(`/admin/backups/${encodeURIComponent(name)}`);
                toast('Backup deleted');
                reload();
            }
        } catch (error) { toast(error.message, 'error'); }
    });
}

// ===================================================================== mobile version

/** Where the mobile version lives (admins can move it), a QR code to open it, and who may use it. */
async function renderMobile(body, reload) {
    const app = await api.get('/meta/app');
    const admin = can('MANAGE_USERS');
    const users = admin ? await api.get('/admin/users').catch(() => []) : [];
    const url = `${location.origin}/${app.mobilePath}/`;
    const cfg = admin ? await api.get('/admin/mobile-config').catch(() => null) : null;
    body.innerHTML = panel({ title: 'Mobile app', iconName: 'phone',
        actions: `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${icon('link')}Open</a>`,
        body: `<div class="mobile-settings">
            <div class="ms-qr">${qrSvg(url, { size: 168 })}<small>Scan with the phone camera</small></div>
            <div class="ms-main">
                <p class="hint">A lighter version for phones with every section: the money at a glance, expenses (add one in seconds), accounts, chits, budgets, income and a simple view of the rest. Phones that open the full site are taken to it automatically (they can still choose the full site).
                    It signs in separately and shows only the sections an admin shared for mobile.</p>
                <form id="mobile-path-form" class="ms-path">
                    <label class="field"><span>Address</span>
                        <span class="ms-url"><span class="muted">${esc(location.origin)}/</span><input name="mobilePath" value="${esc(app.mobilePath)}" ${admin ? '' : 'readonly'}
                            pattern="[a-z0-9][a-z0-9-]{0,29}" maxlength="30" required data-plain><span class="muted">/</span></span></label>
                    ${admin ? `<button class="btn primary" type="submit">${icon('check')}Save address</button>` : '<span class="small muted">Only an admin can change the address.</span>'}
                </form>
                ${cfg ? `<div class="section-title">What the phone app offers</div>
                    <form id="mobile-config-form" class="ms-config">
                        <p class="small muted">${icon('info')} Switch a section off and it disappears from the phone app, and the app can no longer record it. A user still needs the section shared under Users.</p>
                        <div class="ms-features">${[['EXPENSES', 'wallet', 'Expenses', 'Record spending, the detected SMS list'], ['INCOME', 'arrow-in', 'Income', 'Record money received'],
                            ['TRANSFERS', 'arrow-right', 'Transfers', 'Move money between your accounts'], ['ACCOUNTS', 'bank', 'Accounts', 'See accounts and statements'],
                            ['CHITS', 'chit', 'Chits', 'Pay installments'], ['CLAIMS', 'hand', 'Money owed', 'Lent and paid-for money, repayments'],
                            ['EMIS', 'calendar', 'EMIs', 'See and pay EMIs'], ['GIFTS', 'gift', 'Gifts', 'Gifts given and received']].map(([k, ic, t, d]) => `
                            <label class="ms-feature"><input type="checkbox" name="f-${k}" ${cfg.features.includes(k) ? 'checked' : ''}><span>${icon(ic)}<b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
                        <div class="section-title">Privacy on the phone</div>
                        <label class="cs-check"><input type="checkbox" name="hideBalances" ${cfg.hideBalances ? 'checked' : ''}> <span><b>Hide balances</b> until the person taps “View balances” (the phone opens with dots, not figures)</span></label>
                        <label class="cs-check"><input type="checkbox" name="maskNetWorth" ${cfg.maskNetWorth ? 'checked' : ''}> <span><b>Never show the overall net worth</b> in the app</span></label>
                        <label class="field"><span>Keep a balance hidden when it is above ₹ <small class="muted">even after “View balances”; tap that one to see it. Empty = no limit</small></span>
                            <input name="hideAbove" type="number" min="0" step="1000" value="${cfg.hideAbove ?? ''}" placeholder="e.g. 100000" data-plain></label>
                        <p class="small muted">${icon('shield')} This is a screen against onlookers and a borrowed phone, not security: the figures still travel to a signed-in app.</p>
                        <button class="btn primary" type="submit">${icon('check')}Save for the phone app</button>
                    </form>` : ''}
                ${admin ? `<div class="section-title">Who can use it</div>
                    <div class="ms-users">${users.map(u => `<div class="ms-user"><span class="avatar sm">${esc(u.fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
                        <div class="grow min-0"><b>${esc(u.fullName)}</b><small class="muted">${u.mobileAccess
                            ? esc(u.mobileFeatures.filter(k => u.features.includes(k)).map(k => k.charAt(0) + k.slice(1).toLowerCase().replace('_', ' ')).join(', ') || 'no sections')
                            : 'no mobile access'}</small></div>
                        <span class="badge ${u.mobileAccess ? 'aqua' : 'gray'}">${icon('phone')}${u.mobileAccess ? 'Allowed' : 'Off'}</span></div>`).join('')}</div>
                    <p class="small muted">${icon('info')} Change a user's sections and mobile access under <a href="#/admin/users">Users</a>.</p>` : ''}
            </div>
        </div>` });
    body.querySelector('#mobile-config-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        try {
            const features = [...f.querySelectorAll('[name^="f-"]:checked')].map(x => x.name.slice(2));
            await api.put('/admin/mobile-config', { features, hideBalances: f.hideBalances.checked, maskNetWorth: f.maskNetWorth.checked,
                hideAbove: f.hideAbove.value === '' ? null : Number(f.hideAbove.value) });
            toast('Saved: the phone app picks it up the next time it syncs');
        } catch (error) { toast(error.message, 'error'); }
    });
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

// ===================================================================== e-mail

/** Common providers: the server, port and security they need, and a tip for their password. */
const MAIL_PRESETS = [
    { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 587, security: 'STARTTLS',
        tip: 'Use an <b>app password</b>, not your Gmail password: Google account → Security → 2-Step Verification (on) → App passwords → create one for “Mail”.' },
    { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'STARTTLS',
        tip: 'Your Microsoft address and password (or an app password when two-step sign-in is on). SMTP sending must be allowed for the mailbox.' },
    { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.in', port: 465, security: 'SSL', tip: 'Your Zoho address and an application-specific password.' },
    { id: 'yahoo', label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, security: 'SSL', tip: 'Generate an app password under Yahoo account security.' },
    { id: 'other', label: 'Other', host: '', port: 587, security: 'STARTTLS', tip: 'The SMTP details from your e-mail provider or web host.' },
];

/**
 * The household's own e-mail account: Host a Chit reminders and receipts go out from it. Admins only; the password
 * is stored encrypted and never shown again.
 */
/**
 * Host a Chit: the name the household runs its chits under. New chits are named after it, with the chit's value and
 * the months it runs ("Aditya Chitfunds 5L (Oct26–May28)"); an admin sets it.
 */
async function renderChitSettings(body, reload) {
    const admin = can('MANAGE_USERS');
    const cfg = await api.get('/hosted-chits/settings').catch(() => ({}));
    const sample = name => {
        const d = orgNow();
        const tag = (plus) => { const x = new Date(d.getFullYear(), d.getMonth() + plus, 1); return x.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3) + String(x.getFullYear()).slice(2); };
        return `${(name || cfg.householdName || 'Chit').trim()} 5L (${tag(0)}–${tag(19)})`;
    };
    body.innerHTML = panel({ title: 'Host a Chit', iconName: 'hand-coins', sub: 'Naming new chits · signing payment links',
        body: `<form class="form-grid one chit-settings" id="chit-settings" onsubmit="return false" style="max-width:560px">
            <label class="field"><span>Chit-funds company name</span>
                <input type="text" name="companyName" maxlength="60" value="${esc(cfg.companyName || '')}" placeholder="${esc(cfg.householdName || 'e.g. Aditya Chitfunds')}" ${admin ? '' : 'disabled'} data-plain>
                <small>New chits are named after it; empty uses the organization's name.</small></label>
            <div class="book-note">${icon('sparkles')}<span>A new chit of ₹5L over 20 months starting this month is named <b data-sample>${esc(sample(cfg.companyName))}</b>.
                Auction and planned chits add “Auction” or “Planned”. You can always type another name.</span></div>
            ${cfg.keyFingerprint ? `<div class="book-note">${icon('shield')}<span><b>Signing key for payment links</b>: the bank details and UPI ID on members' links are digitally signed
                (ECDSA P-256) with this installation's private key. Give members this fingerprint (on the chit card or in the group):
                their page shows the same key when the details are genuine.<br><span class="hc-key-fp">${icon('lock')}<code>${esc(cfg.keyFingerprint)}</code></span></span></div>` : ''}
            ${admin ? `<div class="row"><button class="btn primary" type="submit">${icon('check')}Save</button></div>`
                : `<p class="small muted">${icon('lock')} Only an admin of the organization can change it.</p>`}
        </form>` });
    const form = body.querySelector('#chit-settings');
    form.companyName.addEventListener('input', () => { body.querySelector('[data-sample]').textContent = sample(form.companyName.value); });
    form.addEventListener('submit', async () => {
        const name = form.companyName.value.trim().replace(/\s+/g, ' ');
        if (name && !/^[\p{L}\p{N} .&'()-]{2,60}$/u.test(name)) { toast(`Use letters, digits, spaces and . & ' ( ) - (2 to 60 characters)`, 'error'); return; }
        try {
            await api.put('/admin/chit-settings', { companyName: name || null });
            toast('Saved');
            reload();
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

async function renderMail(body, reload) {
    if (!can('MANAGE_USERS')) {
        body.innerHTML = panel({ title: 'E-mail', iconName: 'mail', body: emptyState('Only an admin of the organization can set up e-mail.', 'lock') });
        return;
    }
    const s = await api.get('/admin/mail-settings');
    const preset = MAIL_PRESETS.find(p => p.host && p.host === s.host) || (s.host ? MAIL_PRESETS.at(-1) : MAIL_PRESETS[0]);
    const v = {
        host: s.host ?? preset.host, port: s.port ?? preset.port, security: s.security || preset.security,
        username: s.username || '', fromAddress: s.fromAddress || '', fromName: s.fromName || state.user?.tenantName || '', replyTo: s.replyTo || '',
    };
    const box = (label, name, value, { type = 'text', attrs = '', unit = '' } = {}) => `<label class="fl"><input type="${type}" name="${name}" value="${esc(value ?? '')}" placeholder=" " ${attrs} data-plain><span>${label}</span>${unit ? `<i class="fl-unit">${unit}</i>` : ''}</label>`;
    const status = s.enabled ? ['good', 'check-circle', `On · e-mails go out from ${esc(s.fromAddress)}`]
        : s.serverConfigured ? ['aqua', 'info', `Off · the installation's account (${esc(s.serverFrom)}) is used`]
            : ['gray', 'info', 'Off · e-mail is not available until you add an account'];
    body.innerHTML = panel({ title: 'E-mail', iconName: 'mail', sub: 'For chit reminders and receipts',
        actions: `<span class="badge ${status[0]}">${icon(status[1])}${status[2]}</span>`,
        body: `<form class="mail-settings" id="mail-form" onsubmit="return false">
            <div class="ml-main">
                <label class="pref-row ml-switch"><div class="grow"><b>Send from my own e-mail account</b>
                    <small>Reminders and receipts from Host a Chit go out from this address, all at once. Members reply to it.</small></div>
                    <span class="switch"><input type="checkbox" name="enabled" ${s.enabled || !s.saved ? 'checked' : ''}><span></span></span></label>
                <div class="section-title">${icon('mail')}Provider</div>
                <div class="seg-chips" id="ml-presets">${MAIL_PRESETS.map(p => `<button type="button" class="seg-chip ${p.id === preset.id ? 'active' : ''}" data-preset="${p.id}">${p.label}</button>`).join('')}</div>
                <p class="hc-note ml-tip" id="ml-tip">${icon('info')}<span>${preset.tip}</span></p>
                <div class="ml-grid">
                    ${box('E-mail address it comes from', 'fromAddress', v.fromAddress, { type: 'email', attrs: 'maxlength="120" autocomplete="email"' })}
                    ${box('Name members see', 'fromName', v.fromName, { attrs: 'maxlength="100"' })}
                    ${box('Sign-in name (usually the address)', 'username', v.username, { attrs: 'maxlength="120" autocomplete="username"' })}
                    <label class="fl"><input type="password" name="password" value="" placeholder=" " maxlength="200" autocomplete="new-password" data-plain>
                        <span>${s.hasPassword ? 'Password (saved · type to change)' : 'Password or app password'}</span>
                        <button type="button" class="fl-eye" id="ml-eye" title="Show or hide">${icon('eye')}</button></label>
                    <div class="ml-advanced span-2" id="ml-advanced" ${preset.id === 'other' ? '' : 'hidden'}>
                        ${box('Mail server (SMTP)', 'host', v.host, { attrs: 'maxlength="120" spellcheck="false"', unit: 'e.g. smtp.example.com' })}
                        ${box('Port', 'port', v.port, { type: 'number', attrs: 'min="1" max="65535"' })}
                        <label class="fl fixed"><select name="security" data-plain>
                            ${['STARTTLS', 'SSL', 'NONE'].map(x => `<option value="${x}" ${v.security === x ? 'selected' : ''}>${{ STARTTLS: 'STARTTLS (port 587)', SSL: 'SSL / TLS (port 465)', NONE: 'None (not recommended)' }[x]}</option>`).join('')}
                        </select><span>Security</span></label>
                        ${box('Replies go to (optional)', 'replyTo', v.replyTo, { type: 'email', attrs: 'maxlength="120"' })}
                    </div>
                </div>
                <button type="button" class="btn sm ghost ml-more" id="ml-more" ${preset.id === 'other' ? 'hidden' : ''}>${icon('settings')}Server, port and reply-to</button>
                <div class="row ml-actions">
                    <button type="button" class="btn primary" id="ml-save">${icon('check')}Save</button>
                    ${s.hasPassword ? `<button type="button" class="btn ghost" id="ml-clear">${icon('trash')}Forget the password</button>` : ''}
                </div>
            </div>
            <aside class="ml-side">
                <div class="section-title">${icon('send')}Send a test</div>
                <label class="fl"><input type="email" name="testTo" value="${esc(s.fromAddress || '')}" placeholder=" " data-plain><span>Send a test e-mail to</span></label>
                <button type="button" class="btn" id="ml-test" ${s.saved ? '' : 'disabled title="Save first"'}>${icon('send')}Send test e-mail</button>
                ${s.testedAt ? `<p class="hc-note ${s.testResult?.startsWith('OK') ? 'good' : 'warn'}">${icon(s.testResult?.startsWith('OK') ? 'check-circle' : 'alert')}<span>${esc(s.testResult)}<br><small>${new Date(s.testedAt).toLocaleString('en-GB')}</small></span></p>` : ''}
                <div class="section-title">${icon('shield')}Good to know</div>
                <ul class="ml-notes">
                    <li>The password is stored encrypted on this installation and is never shown again.</li>
                    <li>Each organization has its own account; switch it off to use the installation's account${s.serverConfigured ? ` (${esc(s.serverFrom)})` : ' (none is set up)'}.</li>
                    <li>Receipts are sent with the signed PDF attached.</li>
                    ${s.updatedAt ? `<li>Last changed by ${esc(s.updatedBy || '')} on ${new Date(s.updatedAt).toLocaleString('en-GB')}.</li>` : ''}
                </ul>
            </aside>
        </form>` });

    const form = body.querySelector('#mail-form');
    const advanced = body.querySelector('#ml-advanced');
    body.querySelector('#ml-presets').addEventListener('click', e => {
        const chip = e.target.closest('[data-preset]');
        if (!chip) return;
        const p = MAIL_PRESETS.find(x => x.id === chip.dataset.preset);
        body.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('active', x === chip));
        body.querySelector('#ml-tip span').innerHTML = p.tip;
        if (p.id !== 'other') { form.host.value = p.host; form.port.value = p.port; form.security.value = p.security; }
        advanced.hidden = p.id !== 'other';
        body.querySelector('#ml-more').hidden = p.id === 'other';
    });
    body.querySelector('#ml-more').addEventListener('click', e => { advanced.hidden = false; e.currentTarget.hidden = true; });
    body.querySelector('#ml-eye').addEventListener('click', () => { form.password.type = form.password.type === 'password' ? 'text' : 'password'; });
    form.fromAddress.addEventListener('change', () => { if (!form.username.value.trim()) form.username.value = form.fromAddress.value.trim(); });
    const payload = (extra = {}) => ({
        enabled: form.enabled.checked, host: form.host.value.trim(), port: Number(form.port.value) || null, security: form.security.value,
        username: form.username.value.trim() || null, password: form.password.value || null, fromAddress: form.fromAddress.value.trim() || null,
        fromName: form.fromName.value.trim() || null, replyTo: form.replyTo.value.trim() || null, ...extra,
    });
    const run = async (button, work) => {
        button.disabled = true;
        try { await work(); } catch (error) { toast(error.message, 'error'); button.disabled = false; }
    };
    body.querySelector('#ml-save').addEventListener('click', e => run(e.currentTarget, async () => {
        const p = payload();
        if (p.enabled && !p.fromAddress) throw new Error('Enter the e-mail address it comes from');
        await api.put('/admin/mail-settings', p);
        toast(p.enabled ? 'E-mail settings saved. Send a test to check them.' : 'Saved: your own account is off');
        reload();
    }));
    body.querySelector('#ml-clear')?.addEventListener('click', e => run(e.currentTarget, async () => {
        if (!await confirmDialog('Forget the saved password? E-mail stops working until you enter it again.', { confirmLabel: 'Forget' })) { e.target.disabled = false; return; }
        await api.put('/admin/mail-settings', payload({ clearPassword: true, enabled: false }));
        toast('Password forgotten');
        reload();
    }));
    body.querySelector('#ml-test').addEventListener('click', e => run(e.currentTarget, async () => {
        e.currentTarget.innerHTML = `${icon('send')}Sending…`;
        try {
            await api.post('/admin/mail-settings/test', { to: form.testTo.value.trim() || null });
            toast('Test e-mail sent: check the inbox');
        } finally { reload(); }
    }));
}
