/**
 * Settings: categories (add, rename, switch off), the dashboard layout, view preferences, the
 * keyboard shortcut list, the mobile version, the household's e-mail account, the organization's time zone and (super
 * admins) backups of the whole data. Routes: #/settings, #/settings/<section>.
 */
import { api } from '../core/api.js';
import { loadCategories, loadAccounts, can, state } from '../core/store.js';
import { esc, panel, emptyState, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { moneyShort, dateTime, setTimeZone, orgNow } from '../core/format.js';
import { getPref, setPref, clearPrefs } from '../core/prefs.js';
import { THEMES, currentTheme, setTheme } from '../core/theme.js';
import { SHORTCUTS, setPageKeys, listNavigator } from '../core/keys.js';
import { customizerHtml, bindCustomizer } from '../components/dashboard-customizer.js';

const SECTIONS = [
    { id: 'categories', label: 'Categories', iconName: 'tag', hint: 'Expense and income categories' },
    { id: 'dashboard', label: 'Dashboard', iconName: 'dashboard', hint: 'Panels, order and size' },
    { id: 'preferences', label: 'Preferences', iconName: 'settings', hint: 'How pages open' },
    { id: 'appearance', label: 'Appearance', iconName: 'sparkles', hint: 'Theme: Classic or Ocean' },
    { id: 'shortcuts', label: 'Keyboard', iconName: 'keyboard', hint: 'Every shortcut' },
    { id: 'mobile', label: 'Phone app', iconName: 'phone', hint: 'The Android app: who, what, privacy' },
    { id: 'email', label: 'E-mail', iconName: 'mail', hint: 'Account for reminders and receipts' },
    { id: 'statements', label: 'Statements', iconName: 'report', hint: 'Monthly PDFs by e-mail', permission: 'MANAGE_USERS' },
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
    if (section === 'appearance') renderAppearance(body);
    if (section === 'mobile') await renderMobile(body, () => render(container, params, isCurrent));
    if (section === 'email') await renderMail(body, () => render(container, params, isCurrent));
    if (section === 'statements') await renderStatements(body, () => render(container, params, isCurrent));
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
        </form>` })
        + (admin ? panel({ title: 'Data', iconName: 'database', body: `<div class="set-data">
            <p class="small muted">Every change made in the app, on the web or the phone, by any user, is in memory the moment it is saved, and open
                pages refresh by themselves. Changed something directly in the spreadsheet (or run a second server on it)? Check for it here: the app reads
                the spreadsheet once and every open page refreshes.</p>
            <div class="row"><button class="btn" type="button" id="data-check">${icon('refresh')}Check now</button><span class="small muted" id="data-check-out"></span></div></div>` }) : '');
    body.querySelector('#data-check')?.addEventListener('click', async e => {
        const btn = e.currentTarget, out = body.querySelector('#data-check-out');
        btn.disabled = true;
        out.textContent = 'Reading the spreadsheet…';
        try {
            const r = await api.post('/admin/storage/check', {});
            out.textContent = r.changed.length ? `Read in changes to ${r.changed.length} table${r.changed.length === 1 ? '' : 's'}: ${r.changed.join(', ')}` : 'Up to date: nothing was changed outside the app.';
        } catch (error) { out.textContent = ''; toast(error.message, 'error'); }
        btn.disabled = false;
    });
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

// ===================================================================== monthly statements by e-mail

/** Opens a statement's PDF (never locked) in a new tab. */
async function previewStatement(kind, month, accountIds = []) {
    const tab = window.open('', '_blank');
    try {
        const blob = await api.blob('/statements/preview', { kind, month, accounts: accountIds.length ? accountIds.join(',') : undefined });
        const url = URL.createObjectURL(blob);
        if (tab) tab.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (error) { tab?.close(); toast(error.message, 'error'); }
}

/**
 * The organization's subscriptions to monthly statements: each goes out by e-mail as a PDF laid out like a bank
 * statement, on the chosen day for the month before, locked with a password when asked. A catalogue of the statements
 * with a preview of each, and the subscriptions with when they last went out.
 */
async function renderStatements(body, reload) {
    const o = await api.get('/statements');
    const kindOf = k => o.kinds.find(x => x.key === k) || { label: k, iconName: 'report' };
    const subsOf = k => o.subscriptions.filter(x => x.kind === k).length;
    body.innerHTML = `<div class="st-page">
        <section class="panel st-hero"><span class="st-hero-ico">${icon('mail')}</span>
            <div class="grow min-0"><b>Monthly statements by e-mail</b>
                <p>Bank-style PDF statements of your books, sent on the day you pick for the month before. Lock them with a password if you like.</p></div>
            <div class="st-hero-side"><label class="small">Preview month <input type="month" id="st-month" value="${o.lastMonth}" max="${o.lastMonth}"></label></div></section>
        ${o.mailReady ? '' : `<div class="st-warn">${icon('alert')}<span><b>E-mail is not set up.</b> Statements cannot go out until you add your e-mail account in <a href="#/settings/email">Settings › E-mail</a>. You can still preview them.</span></div>`}
        <div class="st-kinds">${o.kinds.map(k => `<div class="st-kind">
            <span class="st-kind-ico">${icon(k.iconName)}</span>
            <div class="min-0 grow"><b>${esc(k.label)}</b><p>${esc(k.description)}</p></div>
            <div class="st-kind-acts">
                <button type="button" class="btn sm" data-st-preview="${k.key}">${icon('eye')}Preview</button>
                <button type="button" class="btn sm primary" data-st-add="${k.key}">${icon('plus')}${subsOf(k.key) ? 'Add another' : 'Subscribe'}</button></div>
            ${subsOf(k.key) ? `<span class="st-kind-count">${subsOf(k.key)} subscribed</span>` : ''}</div>`).join('')}</div>
        ${panel({ title: 'Subscriptions', iconName: 'repeat', bodyClass: 'flush', sub: o.subscriptions.length ? `${o.subscriptions.filter(x => x.active).length} active${o.mailFrom ? ` · sent from ${esc(o.mailFrom)}` : ''}` : '',
            body: o.subscriptions.length ? `<div class="st-subs">${o.subscriptions.map(x => {
                const k = kindOf(x.kind);
                const ok = x.lastResult && x.lastResult.startsWith('Sent');
                return `<div class="st-sub ${x.active ? '' : 'paused'}">
                    <span class="st-kind-ico sm">${icon(k.iconName)}</span>
                    <div class="min-0 grow"><b>${esc(x.kindLabel)}</b>
                        <div class="st-chips">${x.recipients.map(r => `<span class="st-chip">${icon('mail')}${esc(r)}</span>`).join('')}</div>
                        <small class="muted">Day ${x.dayOfMonth} of every month${x.kind === 'ACCOUNTS' ? ` · ${x.accountIds.length ? `${x.accountIds.length} account${x.accountIds.length === 1 ? '' : 's'}` : 'every account'}` : ''}
                            ${x.protect ? ` · <span class="st-lock">${icon('lock')}password protected</span>` : ''}${x.active ? '' : ' · <b>paused</b>'}</small>
                        ${x.lastResult ? `<small class="st-last ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check-circle' : 'alert')}${esc(x.lastResult)}${x.lastSentAt && ok ? ` · ${dateTime(x.lastSentAt)}` : ''}</small>`
                            : '<small class="muted">Not sent yet</small>'}</div>
                    <div class="st-sub-acts">
                        <button type="button" class="btn sm" data-st-send="${x.id}" ${o.mailReady ? '' : 'disabled title="Set up e-mail first"'}>${icon('send')}Send now</button>
                        <button type="button" class="btn sm ghost icon" data-st-view="${x.id}" title="Preview the PDF">${icon('eye')}</button>
                        <button type="button" class="btn sm ghost icon" data-st-edit="${x.id}" title="Edit">${icon('edit')}</button>
                        <button type="button" class="btn sm ghost icon" data-st-toggle="${x.id}" title="${x.active ? 'Pause' : 'Resume'}">${icon(x.active ? 'clock' : 'play')}</button>
                        <button type="button" class="btn sm ghost icon" data-st-delete="${x.id}" title="Stop and remove">${icon('trash')}</button></div></div>`;
            }).join('')}</div>` : `<p class="small muted ms-pad">${icon('info')} No subscription yet: pick a statement above and subscribe the addresses that should get it every month.</p>` })}
    </div>`;

    const month = () => body.querySelector('#st-month').value || o.lastMonth;
    const sub = id => o.subscriptions.find(x => x.id === Number(id));
    const payload = (x, changes = {}) => ({ kind: x.kind, recipients: x.recipients.join(', '), accountIds: x.accountIds, dayOfMonth: x.dayOfMonth, protect: x.protect, active: x.active, ...changes });
    body.addEventListener('click', async e => {
        const t = e.target.closest('button');
        if (!t) return;
        try {
            if (t.dataset.stPreview) await previewStatement(t.dataset.stPreview, month());
            else if (t.dataset.stAdd) editStatement(o, null, t.dataset.stAdd, reload);
            else if (t.dataset.stEdit) editStatement(o, sub(t.dataset.stEdit), null, reload);
            else if (t.dataset.stView) { const x = sub(t.dataset.stView); await previewStatement(x.kind, month(), x.accountIds); }
            else if (t.dataset.stToggle) {
                const x = sub(t.dataset.stToggle);
                await api.put(`/statements/subscriptions/${x.id}`, payload(x, { active: !x.active }));
                toast(x.active ? 'Paused' : 'Resumed');
                reload();
            } else if (t.dataset.stDelete) {
                const x = sub(t.dataset.stDelete);
                if (!await confirmDialog(`Stop sending the ${x.kindLabel.toLowerCase()} to ${x.recipients.join(', ')}?`, { title: 'Stop this statement?', confirmLabel: 'Stop and remove' })) return;
                await api.del(`/statements/subscriptions/${x.id}`);
                toast('Removed');
                reload();
            } else if (t.dataset.stSend) {
                const x = sub(t.dataset.stSend);
                t.disabled = true;
                const r = await api.post(`/statements/subscriptions/${x.id}/send?month=${encodeURIComponent(month())}`, {});
                toast(r.result, r.sent ? 'success' : 'error');
                reload();
            }
        } catch (error) { toast(error.message, 'error'); t.disabled = false; }
    });
}

/** Add or change a subscription: the statement, who gets it, the day, the accounts (account statement) and the password. */
async function editStatement(o, x, kind, reload) {
    const k = x ? x.kind : kind;
    const own = k === 'ACCOUNTS' ? (await loadAccounts().catch(() => [])).filter(a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && a.active !== false)
        .sort((a, b) => a.name.localeCompare(b.name)) : [];
    const chosen = new Set(x?.accountIds || []);
    const meta = o.kinds.find(y => y.key === k);
    const m = openModal({
        title: x ? 'Change the subscription' : `Subscribe: ${meta.label}`, sub: meta.label, iconName: meta.iconName, size: 'lg',
        body: `<form class="st-form" onsubmit="return false">
            <label class="field"><span>Send it to <small class="muted">e-mail addresses, separated by commas (up to 10)</small></span>
                <input name="recipients" value="${esc(x ? x.recipients.join(', ') : '')}" placeholder="me@example.com, spouse@example.com" data-plain autofocus></label>
            <div class="form-grid two">
                <label class="field"><span>On day <small class="muted">of every month, for the month before</small></span>
                    <select name="day">${Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<option value="${d}" ${(x?.dayOfMonth || 1) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
                <label class="cs-check st-active"><input type="checkbox" name="active" ${!x || x.active ? 'checked' : ''}> <span><b>Active</b><small>Paused ones are kept but not sent</small></span></label>
            </div>
            ${k === 'ACCOUNTS' ? `<div class="field"><span>Accounts <small class="muted">none ticked = every account of your own</small></span>
                <div class="st-accts">${own.map(a => `<label class="st-acct"><input type="checkbox" name="acct" value="${a.id}" ${chosen.has(a.id) ? 'checked' : ''}><span class="ellipsis">${esc(a.name)}</span><small>${esc(a.typeLabel || '')}</small></label>`).join('')}</div></div>` : ''}
            <div class="st-protect">
                <label class="cs-check"><input type="checkbox" name="protect" ${x?.protect ? 'checked' : ''}> <span><b>Lock the PDF with a password</b><small>The reader types it to open the file (AES-256). Share it separately, not in the same e-mail.</small></span></label>
                <label class="field st-pw"><span>Password <small class="muted">${x?.hasPassword ? 'leave empty to keep the one set' : '4 to 64 characters'}</small></span>
                    <span class="st-pw-row"><input name="password" type="password" minlength="4" maxlength="64" autocomplete="new-password" placeholder="${x?.hasPassword ? '•••••••• (unchanged)' : 'e.g. your PAN in capitals'}" data-plain>
                    <button type="button" class="btn sm ghost icon" data-st-eye title="Show">${icon('eye')}</button></span></label>
            </div>
        </form>`,
        actions: [
            { label: 'Preview', iconName: 'eye', left: true, onClick: m2 => { previewStatement(k, o.lastMonth, [...m2.el.querySelectorAll('[name="acct"]:checked')].map(c => Number(c.value))); return true; } },
            { label: x ? 'Save' : 'Subscribe', kind: 'primary', iconName: 'check', onClick: async m2 => {
                const f = m2.el.querySelector('.st-form');
                const body = { kind: k, recipients: f.recipients.value, dayOfMonth: Number(f.day.value), protect: f.protect.checked, active: f.active.checked,
                    accountIds: [...f.querySelectorAll('[name="acct"]:checked')].map(c => Number(c.value)) };
                if (f.password.value) body.password = f.password.value;
                if (x) await api.put(`/statements/subscriptions/${x.id}`, body); else await api.post('/statements/subscriptions', body);
                toast(x ? 'Saved' : `Subscribed: the ${meta.label.toLowerCase()} goes out on day ${body.dayOfMonth}`);
                reload();
            } }],
    });
    const f = m.el.querySelector('.st-form');
    const sync = () => f.querySelector('.st-pw').classList.toggle('off', !f.protect.checked);
    f.protect.addEventListener('change', sync);
    sync();
    m.el.querySelector('[data-st-eye]').addEventListener('click', () => { f.password.type = f.password.type === 'password' ? 'text' : 'password'; });
}

// ===================================================================== the phone app

/** Every menu of the phone app: the tabs, the parts of Expenses, and the items under More (Settings is always there). */
const APP_SECTIONS = [['ACCOUNTS', 'bank', 'Accounts'], ['EXPENSES', 'wallet', 'Expenses'], ['INCOME', 'arrow-in', 'Income'], ['TRANSFERS', 'transfer', 'Transfers'],
    ['CHITS', 'chit', 'Chits'], ['CLAIMS', 'hand', 'Money owed'], ['EMIS', 'calendar', 'EMIs'], ['GIFTS', 'gift', 'Gifts'],
    ['BUDGETS', 'target', 'Budget'], ['BALANCE_SHEET', 'scale', 'Balance sheet'], ['CATEGORIES', 'tag', 'Categories'], ['SMS', 'bell', 'Bank SMS']];
const APP_ROLE_LABELS = { SUPER_ADMIN: 'Super admin', ADMIN: 'Admin', MANAGER: 'Manager', ACCOUNTANT: 'Accountant', MEMBER: 'Member', VIEWER: 'Viewer' };

/**
 * The Android app (phones opening the web site get the mobile web version on their own): whether it can sign in at all, which roles may,
 * what each role sees and whether it may only look, accounts whose balance is never shown, the privacy screen, how long a sign-in lasts,
 * and the phones signed in now (each can be signed out).
 */
async function renderMobile(body, reload) {
    const admin = can('MANAGE_USERS');
    if (!admin) {
        body.innerHTML = panel({ title: 'Phone app', iconName: 'phone', body: `<p class="hint ms-pad">${icon('lock')} Only an admin can change what the phone app offers.</p>` });
        return;
    }
    const [cfg, sessions, accounts, users, app] = await Promise.all([api.get('/admin/mobile-config'), api.get('/admin/mobile-config/sessions').catch(() => []),
        loadAccounts().catch(() => []), api.get('/admin/users').catch(() => []), api.get('/meta/app').catch(() => ({}))]);
    const roles = Object.keys(APP_ROLE_LABELS);
    const money = accounts.filter(a => a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY').sort((a, b) => a.name.localeCompare(b.name));
    const on = (role, k) => (cfg.roleFeatures?.[role] || cfg.features).includes(k);
    const allowed = role => (cfg.roles || roles).includes(role);
    const people = role => users.filter(u => u.role === role).length;

    body.innerHTML = `<div class="ms2">
        <section class="panel ms2-hero ${cfg.enabled === false ? 'off' : ''}">
            <span class="ms2-phone">${icon('phone')}</span>
            <div class="grow min-0"><b>Personal Budget for Android</b>
                <p>The app on the phone signs in once, then opens with the phone's own lock. Here you decide who can use it and what it shows.</p></div>
            <label class="switch ms2-switch"><input type="checkbox" id="ms-enabled" ${cfg.enabled === false ? '' : 'checked'}><span></span><em>${cfg.enabled === false ? 'Switched off' : 'In use'}</em></label>
        </section>
        <form id="ms-form" class="ms2-grid">
            ${panel({ title: 'Who can use it, and what they see', iconName: 'users', cls: 'ms2-wide', bodyClass: 'flush', sub: 'per role · tick the sections; “view only” lets them look but not record',
                body: `<div class="scroll"><table class="grid compact ms2-matrix"><thead><tr><th>Role</th><th class="c">Can sign in</th>
                    ${APP_SECTIONS.map(([k, ic, t]) => `<th class="c" title="${t}">${icon(ic)}<span>${t}</span></th>`).join('')}<th class="c">View only</th></tr></thead>
                    <tbody>${roles.map(r => `<tr data-role="${r}" class="${allowed(r) ? '' : 'ms2-blocked'}"><th><b>${APP_ROLE_LABELS[r]}</b><small>${people(r)} ${people(r) === 1 ? 'person' : 'people'}</small></th>
                        <td class="c"><label class="switch sm"><input type="checkbox" name="role-${r}" ${allowed(r) ? 'checked' : ''}><span></span></label></td>
                        ${APP_SECTIONS.map(([k]) => `<td class="c"><input type="checkbox" class="ms2-cb" name="rf-${r}-${k}" ${on(r, k) ? 'checked' : ''}></td>`).join('')}
                        <td class="c"><input type="checkbox" class="ms2-cb ro" name="ro-${r}" ${(cfg.readOnlyRoles || []).includes(r) ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>
                    <p class="small muted ms-pad">${icon('info')} These are every menu of the app: its tabs (Accounts, Expenses, Chits), the parts of Expenses (Income, Money owed, EMIs) and the items under More.
                        Switched off, a menu disappears from the phone and cannot be recorded there. A person also needs the section shared with them under <a href="#/admin/users">Users</a>; the app shows the overlap.</p>` })}
            ${panel({ title: 'Balances', iconName: 'eye', body: `<div class="ms2-stack">
                <label class="cs-check"><input type="checkbox" name="hideBalances" ${cfg.hideBalances ? 'checked' : ''}> <span><b>Open with balances hidden</b><small>dots until “View balances” is tapped</small></span></label>
                <label class="cs-check"><input type="checkbox" name="maskNetWorth" ${cfg.maskNetWorth ? 'checked' : ''}> <span><b>Never show the net worth</b><small>the total stays off the phone's screens</small></span></label>
                <label class="field"><span>Keep any balance above ₹ hidden <small class="muted">tap it to see · empty = no limit</small></span>
                    <input name="hideAbove" type="number" min="0" step="1000" value="${cfg.hideAbove ?? ''}" placeholder="e.g. 100000" data-plain></label>
                <label class="field"><span>Sign-in lasts <small class="muted">then the password is asked again</small></span>
                    <select name="sessionDays">${[1, 7, 14, 30, 60, 90, 180].map(d => `<option value="${d}" ${Number(cfg.sessionDays || 30) === d ? 'selected' : ''}>${d === 1 ? '1 day' : `${d} days`}</option>`).join('')}</select></label>
                <p class="small muted">${icon('shield')} A screen against onlookers and a borrowed phone: a signed-in app still receives the figures.</p></div>` })}
            ${panel({ title: 'Accounts kept private', iconName: 'lock', bodyClass: 'flush', sub: 'their balance is always hidden in the app',
                body: money.length ? `<div class="ms2-accts scroll">${money.map(a => `<label class="ms2-acct"><input type="checkbox" name="ha-${a.id}" ${(cfg.hiddenAccounts || []).includes(a.id) ? 'checked' : ''}>
                    <span class="grow min-0"><b class="ellipsis">${esc(a.name)}</b><small>${esc(a.typeLabel || a.accountType || '')}</small></span><span class="ms2-bal">${moneyShort(a.balance)}</span></label>`).join('')}</div>`
                    : emptyState('No accounts yet.', 'bank') })}
            <div class="ms2-save ms2-wide"><span class="small muted" id="ms-dirty"></span><button class="btn primary" type="submit">${icon('check')}Save for the phone app</button></div>
        </form>
        ${panel({ title: 'Phones signed in', iconName: 'phone', bodyClass: 'flush', sub: sessions.length ? `${sessions.length} now` : '',
            body: sessions.length ? `<div class="ms2-sessions">${sessions.map(x => `<div class="ms2-sess"><span class="ms2-dev">${icon('phone')}</span>
                <div class="grow min-0"><b>${esc(x.user)}</b> <span class="badge gray">${esc(x.role || '')}</span><small class="ellipsis">${esc((x.device || 'Phone').slice(0, 80))}</small>
                    <small>Signed in ${dateTime(x.signedIn)} · until ${dateTime(x.expires)}</small></div>
                <button type="button" class="btn sm danger" data-end="${x.id}">${icon('log-out')}Sign out</button></div>`).join('')}</div>`
                : `<p class="small muted ms-pad">${icon('info')} No phone is signed in to the app.</p>` })}
        <details class="ms2-adv"><summary>${icon('settings')}Mobile web address (for phones without the app)</summary>
            <form id="mobile-path-form" class="ms-path"><label class="field"><span>Address</span>
                <span class="ms-url"><span class="muted">${esc(location.origin)}/</span><input name="mobilePath" value="${esc(app.mobilePath || 'm')}" pattern="[a-z0-9][a-z0-9-]{0,29}" maxlength="30" required data-plain><span class="muted">/</span></span></label>
                <button class="btn sm" type="submit">${icon('check')}Save address</button></form>
            <p class="small muted">Phones that open the full site are taken to the mobile web version automatically.</p></details>
    </div>`;

    const form = body.querySelector('#ms-form');
    const enabled = body.querySelector('#ms-enabled');
    // a role that cannot sign in greys out its row
    form.addEventListener('change', e => {
        const m = e.target.name?.match(/^role-(.+)$/);
        if (m) form.querySelector(`tr[data-role="${m[1]}"]`).classList.toggle('ms2-blocked', !e.target.checked);
        body.querySelector('#ms-dirty').textContent = 'Unsaved changes';
    });
    const save = async () => {
        const f = form;
        const roleFeatures = Object.fromEntries(roles.map(r => [r, APP_SECTIONS.map(([k]) => k).filter(k => f[`rf-${r}-${k}`].checked)]));
        await api.put('/admin/mobile-config', {
            features: [...new Set(Object.values(roleFeatures).flat())], roleFeatures,
            roles: roles.filter(r => f[`role-${r}`].checked), readOnlyRoles: roles.filter(r => f[`ro-${r}`].checked),
            hiddenAccounts: money.filter(a => f[`ha-${a.id}`]?.checked).map(a => a.id),
            hideBalances: f.hideBalances.checked, maskNetWorth: f.maskNetWorth.checked,
            hideAbove: f.hideAbove.value === '' ? null : Number(f.hideAbove.value), sessionDays: Number(f.sessionDays.value), enabled: enabled.checked,
        });
    };
    form.addEventListener('submit', async e => {
        e.preventDefault();
        try { await save(); body.querySelector('#ms-dirty').textContent = ''; toast('Saved: the phone app picks it up the next time it syncs'); }
        catch (error) { toast(error.message, 'error'); }
    });
    enabled.addEventListener('change', async () => {
        try {
            await save();
            toast(enabled.checked ? 'The phone app can be used again' : 'The phone app is switched off: no one can sign in to it');
            reload();
        } catch (error) { toast(error.message, 'error'); enabled.checked = !enabled.checked; }
    });
    body.querySelectorAll('[data-end]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog('The app on that phone will ask for the password again.', { title: 'Sign this phone out?', confirmLabel: 'Sign out' })) return;
        try { await api.del(`/admin/mobile-config/sessions/${b.dataset.end}`); toast('Signed out'); reload(); } catch (error) { toast(error.message, 'error'); }
    }));
    body.querySelector('#mobile-path-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const saved = await api.put('/admin/app-settings', { mobilePath: e.target.mobilePath.value });
            toast(`The mobile web version is now at /${saved.mobilePath}/`);
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

// ===================================================================== appearance

/**
 * The theme, as a choice of two cards with a small preview of each look. Saved in this browser; choosing one reloads
 * the page so everything redraws in it.
 */
function renderAppearance(body) {
    const current = currentTheme();
    const preview = id => `<div class="tp-preview ${id}" aria-hidden="true">
            <span class="tp-bar"></span>
            <span class="tp-row"></span><span class="tp-row open"></span>
            <span class="tp-panel"><i></i><i></i></span>
            <span class="tp-row"></span>
        </div>`;
    body.innerHTML = panel({ title: 'Appearance', iconName: 'sparkles', sub: 'Saved in this browser',
        body: `<div class="theme-picker">${THEMES.map(t => `
            <div class="theme-card ${t.id === current ? 'current' : ''}" data-theme-card="${t.id}">
                ${preview(t.id)}
                <div class="tc-text"><b>${esc(t.label)}${t.id === 'classic' ? ' <span class="tag">default</span>' : ''}</b><small>${esc(t.hint)}</small></div>
                ${t.id === current ? `<span class="tc-state">${icon('check-circle')}In use</span>`
                    : `<button class="btn sm primary" data-theme-pick="${t.id}">${icon('check')}Use ${esc(t.label)}</button>`}
            </div>`).join('')}</div>
            <p class="small muted tc-note">${icon('info')}Applies to this browser only; other people and devices keep their own choice. The page reloads to switch.</p>` });
    body.querySelector('.theme-picker').addEventListener('click', e => {
        const pick = e.target.closest('[data-theme-pick]');
        if (pick) setTheme(pick.dataset.themePick);
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
