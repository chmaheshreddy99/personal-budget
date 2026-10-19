/**
 * Activity (#/activity): who changed what, the entries waiting for approval and temporary access links.
 *   Activity       every change, sign-in and opened link, by day: who, what, where from (full site, mobile, link);
 *                  filters by period, person, section and text, with Clear, and Excel / PDF export
 *   Approvals      maker-checker: expenses recorded through a link (or by a user who needs approval) wait for a
 *                  checker; approve (correcting amount, date, category, account or description if needed) or reject
 *                  with a reason; the maker can correct a rejected one and send it again, and its history shows here.
 *                  "Who needs approval": the household (off / links only / links and users), each user (always,
 *                  never, as the household) and, for a super admin, the whole installation
 *   Clearing       the log can be trimmed: older than a week, a month, three months, a year, or everything
 *   Access links   temporary links for someone without an account, opening the full app (any section) or the
 *                  mobile version (its sections): for whom, how long,
 *                  which sections, view only or recorder, with or without approval; revoke one (or all) at once
 * Routes: #/activity, #/activity/approvals, #/activity/links
 */
import { api } from '../core/api.js';
import { can, FEATURES } from '../core/store.js';
import { panel, esc, emptyState, toast, confirmDialog, openModal, field, readForm } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { money, date, dateTime, isoDate } from '../core/format.js';
import { periodChips, bindPeriodChips } from '../components/period-chips.js';
import { exportButton, bindExport } from '../core/export.js';
import { qrSvg } from '../core/qr.js';
import { historyHtml } from '../components/submissions.js';

const TABS = [
    { key: 'log', label: 'Activity', iconName: 'history', permission: 'APPROVE_ENTRIES' },
    { key: 'approvals', label: 'Approvals', iconName: 'check-circle', permission: 'APPROVE_ENTRIES' },
    { key: 'links', label: 'Access links', iconName: 'link', permission: 'MANAGE_USERS' },
];

const ACTION = {
    ADDED: ['aqua', 'plus', 'Added'], CHANGED: ['', 'edit', 'Changed'], DELETED: ['red', 'trash', 'Deleted'],
    POSTED: ['aqua', 'check', 'Posted'], REVERSED: ['gray', 'undo', 'Reversed'], APPROVED: ['aqua', 'check-circle', 'Approved'],
    REJECTED: ['red', 'x', 'Rejected'], SUBMITTED: ['gold', 'hourglass', 'Sent for approval'], SIGNED_IN: ['gray', 'user', 'Signed in'],
    OPENED_LINK: ['violet', 'link', 'Opened a link'], REVOKED: ['red', 'lock', 'Revoked'],
};
const VIA = { WEB: ['dashboard', 'Full site'], MOBILE: ['phone', 'Mobile version'], LINK: ['link', 'Access link'] };

const defaults = () => ({ from: isoDate(new Date(Date.now() - 29 * 86400000)), to: isoDate(), actor: '', area: '', q: '' });
const filters = defaults();
let approvalStatus = 'PENDING';

export async function render(container, params, isCurrent) {
    const tabs = TABS.filter(t => can(t.permission));
    const active = tabs.find(t => t.key === params[0]) || tabs[0];
    const pending = can('APPROVE_ENTRIES') ? (await api.get('/approvals/count').catch(() => ({ pending: 0 }))).pending : 0;
    if (!isCurrent()) return;
    container.innerHTML = `
    <div class="page activity-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('history')} Activity</h2>
            <div class="seg-chips">${tabs.map(t => `<a class="seg-chip ${t.key === active.key ? 'active' : ''}" href="#/activity/${t.key}">${icon(t.iconName)}${t.label}
                ${t.key === 'approvals' && pending ? `<span class="count warn">${pending}</span>` : ''}</a>`).join('')}</div>
            <span class="spacer"></span>
            <div class="row" id="act-actions"></div>
        </div>
        <div class="activity-body" id="act-body"></div>
    </div>`;
    const body = container.querySelector('#act-body');
    const actions = container.querySelector('#act-actions');
    const reload = () => render(container, [active.key], isCurrent);
    await { log: drawLog, approvals: drawApprovals, links: drawLinks }[active.key](body, actions, reload, isCurrent);
}

// ===================================================================== activity log

async function drawLog(body, actions, reload, isCurrent) {
    const all = await api.get('/activity', { from: filters.from, to: filters.to, limit: 5000 });
    if (!isCurrent()) return;
    const actors = [...new Set(all.map(a => a.actor))].sort();
    const areas = [...new Set(all.map(a => a.area))].sort();
    const q = filters.q.toLowerCase();
    const list = all.filter(a => (!filters.actor || a.actor === filters.actor) && (!filters.area || a.area === filters.area)
        && (!q || `${a.summary} ${a.actor} ${a.area}`.toLowerCase().includes(q)));
    const def = defaults();
    const filtered = filters.actor || filters.area || filters.q || filters.from !== def.from || filters.to !== def.to;
    const byDay = new Map();
    list.forEach(a => { const d = a.at.slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(a); });
    const people = new Map();
    list.forEach(a => people.set(a.actor, (people.get(a.actor) || 0) + 1));
    const busiest = [...people.entries()].sort((a, b) => b[1] - a[1])[0];
    const areaCount = new Map();
    list.forEach(a => areaCount.set(a.area, (areaCount.get(a.area) || 0) + 1));
    const topArea = [...areaCount.entries()].sort((a, b) => b[1] - a[1])[0];

    actions.innerHTML = `${can('MANAGE_USERS') ? `<button class="btn sm" id="act-clear-old" title="Delete older activity">${icon('trash')}Clear…</button>` : ''}${exportButton({ label: 'Export' })}`;
    actions.querySelector('#act-clear-old')?.addEventListener('click', () => clearDialog(reload));
    body.innerHTML = `
        <div class="act-filters glass">
            <span id="act-period">${periodChips(filters.from, filters.to)}</span>
            <select id="act-actor" data-plain><option value="">Everyone</option>${actors.map(a => `<option ${a === filters.actor ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
            <select id="act-area" data-plain><option value="">All sections</option>${areas.map(a => `<option ${a === filters.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
            <div class="search-box">${icon('search')}<input id="act-q" placeholder="Search what changed…" value="${esc(filters.q)}" data-plain></div>
            ${filtered ? `<button class="btn sm ghost" id="act-clear">${icon('x')}Clear filters</button>` : ''}
        </div>
        <div class="act-stats">
            ${stat('history', 'Changes', String(list.length), `${byDay.size} day${byDay.size === 1 ? '' : 's'}`)}
            ${stat('users', 'People', String(people.size), busiest ? `most: ${esc(busiest[0])} (${busiest[1]})` : '—')}
            ${stat('layers', 'Busiest section', topArea ? esc(topArea[0]) : '—', topArea ? `${topArea[1]} changes` : '')}
            ${stat('link', 'Through links', String(list.filter(a => a.via === 'LINK').length), `${list.filter(a => a.via === 'MOBILE').length} on mobile`)}
            ${stat('trash', 'Deletions', String(list.filter(a => a.action === 'DELETED').length), `${list.filter(a => a.action === 'REVERSED').length} reversals`)}
        </div>
        ${panel({ title: 'What changed', iconName: 'history', cls: 'act-log-panel', bodyClass: 'flush', sub: `${list.length} of ${all.length}`,
            body: list.length ? `<div class="act-log">${[...byDay.entries()].map(([d, items]) => `
                <div class="act-day"><b>${dayLabel(d)}</b><span>${items.length} change${items.length === 1 ? '' : 's'}</span></div>
                ${items.map(row).join('')}`).join('')}</div>`
                : emptyState(filtered ? 'Nothing matches these filters' : 'No activity in this period', 'history') })}`;

    const periodHost = body.querySelector('#act-period');
    bindPeriodChips(periodHost, (from, to) => { filters.from = from; filters.to = to; reload(); });
    body.querySelector('#act-actor').addEventListener('change', e => { filters.actor = e.target.value; reload(); });
    body.querySelector('#act-area').addEventListener('change', e => { filters.area = e.target.value; reload(); });
    let t;
    body.querySelector('#act-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filters.q = e.target.value.trim(); reload().then(() => focusEnd('#act-q')); }, 300); });
    body.querySelector('#act-clear')?.addEventListener('click', () => { Object.assign(filters, defaults()); reload(); });
    bindExport(actions, () => ({
        title: 'Activity', subtitle: `${date(filters.from)} – ${date(filters.to)}${filters.actor ? ` · ${filters.actor}` : ''}${filters.area ? ` · ${filters.area}` : ''}`,
        filename: `activity-${filters.from}-to-${filters.to}`,
        sheets: [{ name: 'Activity', columns: [{ label: 'When' }, { label: 'Who' }, { label: 'From' }, { label: 'Section' }, { label: 'Action' }, { label: 'What changed' }],
            rows: list.map(a => [dateTime(a.at), a.actor, VIA[a.via]?.[1] || a.via, a.area, ACTION[a.action]?.[2] || a.action, a.summary]) }],
    }));
}

function row(a) {
    const [tone, ico, label] = ACTION[a.action] || ['', 'info', a.action];
    const [viaIcon, viaLabel] = VIA[a.via] || ['info', a.via];
    return `<div class="act-row">
        <span class="act-time">${new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="chip-icon sm ${tone}" title="${esc(label)}">${icon(ico)}</span>
        <div class="act-main"><div class="act-what">${esc(a.summary)}</div>
            <div class="act-meta"><b>${esc(a.actor)}</b><span class="act-via" title="${esc(viaLabel)}">${icon(viaIcon)}${esc(viaLabel)}</span><span class="tag">${esc(a.area)}</span></div></div>
    </div>`;
}

// ===================================================================== approvals (maker-checker)

async function drawApprovals(body, actions, reload, isCurrent) {
    const list = await api.get('/approvals', { status: approvalStatus });
    if (!isCurrent()) return;
    actions.innerHTML = `<div class="seg-chips sm" id="ap-status">${['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map(s =>
        `<button class="seg-chip ${approvalStatus === s ? 'active' : ''}" data-status="${s}">${s.charAt(0) + s.slice(1).toLowerCase()}</button>`).join('')}</div>
        ${can('MANAGE_USERS') ? `<button class="btn sm" id="ap-who" title="Switch approval off or on for the household, for each user, or everywhere">${icon('settings')}Who needs approval</button>` : ''}`;
    actions.querySelector('#ap-who')?.addEventListener('click', () => approvalSettingsDialog(reload));
    actions.querySelector('#ap-status').addEventListener('click', e => {
        const b = e.target.closest('[data-status]');
        if (b) { approvalStatus = b.dataset.status; reload(); }
    });
    body.innerHTML = `
        <p class="hint act-hint">${icon('info')} Expenses recorded through an access link with approval (or by a user who needs approval) wait here. Nothing reaches the books until a checker approves it;
            the checker can correct the amount, date, category, account or description first. A rejected entry goes back to whoever recorded it, to correct and send again.</p>
        <div class="ap-list">${list.map(p => {
            const ci = categoryIcon(p.categoryName || '');
            const state = { PENDING: ['warning', 'hourglass', p.resubmits ? 'Sent again' : 'Waiting'], APPROVED: ['good', 'check-circle', 'Approved'],
                REJECTED: ['critical', 'x', 'Rejected'], WITHDRAWN: ['gray', 'undo', 'Taken back'] }[p.status] || ['', 'info', p.status];
            return `<div class="ap-card ${p.status.toLowerCase()}">
                <span class="chip-icon ${ci.tone}">${icon(ci.name)}</span>
                <div class="ap-main">
                    <div class="ap-top"><b>${esc(p.narration || p.categoryName)}</b><span class="badge ${state[0]}">${icon(state[1])}${state[2]}</span>
                        ${p.resubmits ? `<span class="tag warn" title="Corrected and sent again after a rejection">${icon('refresh')}${p.resubmits}× corrected</span>` : ''}</div>
                    <div class="ap-facts">
                        <span>${icon('tag')}${esc(p.categoryName || '—')}</span><span>${icon('wallet')}${esc(p.paidFromName || '—')}</span>
                        <span>${icon('calendar')}${date(p.entryDate)}</span>${p.party ? `<span>${icon('user')}${esc(p.party)}</span>` : ''}
                    </div>
                    <div class="ap-who">${icon(p.linkId ? 'link' : 'user')}Recorded by <b>${esc(p.submittedBy)}</b> · ${dateTime(p.submittedAt)}${p.notes ? ` · ${esc(p.notes)}` : ''}</div>
                    ${historyHtml(p)}
                    <div data-ev-pending="${p.id}" data-ev-count="${p.attachmentCount || 0}" data-ev-editable="${p.status === 'PENDING' ? '1' : '0'}"></div>
                    ${p.reviewedBy ? `<div class="ap-who">${icon(p.status === 'APPROVED' ? 'check' : 'x')}${p.status === 'APPROVED' ? 'Approved' : 'Rejected'} by <b>${esc(p.reviewedBy)}</b> · ${dateTime(p.reviewedAt)}${p.reviewNote ? ` · “${esc(p.reviewNote)}”` : ''}</div>` : ''}
                </div>
                <div class="ap-side"><b class="ap-amt">${money(p.amount)}</b>
                    ${p.status === 'PENDING' ? `<div class="row"><button class="btn sm" data-reject="${p.id}">${icon('x')}Reject</button>
                        <button class="btn sm primary" data-approve="${p.id}">${icon('check')}Approve</button></div>` : ''}</div>
            </div>`;
        }).join('') || emptyState(approvalStatus === 'PENDING' ? 'Nothing is waiting for approval' : 'Nothing here', 'check-circle')}</div>`;
    body.addEventListener('click', e => {
        const ap = e.target.closest('[data-approve]'), rj = e.target.closest('[data-reject]');
        if (ap) approveDialog(list.find(p => p.id === Number(ap.dataset.approve)), reload);
        if (rj) rejectDialog(list.find(p => p.id === Number(rj.dataset.reject)), reload);
    });
}

async function approveDialog(p, reload) {
    const options = await api.get('/expenses/form-options');
    openModal({
        title: `Approve · ${p.narration || p.categoryName}`, iconName: 'check-circle',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>Recorded by ${esc(p.submittedBy)}</b><span class="spacer"></span><b>${money(p.amount)}</b></div>
                <div class="small muted">${dateTime(p.submittedAt)} · correct anything below before it is posted</div></div>
            ${field({ label: 'Amount', name: 'amount', type: 'number', value: p.amount, required: true })}
            ${field({ label: 'Date', name: 'entryDate', type: 'date', value: p.entryDate, required: true })}
            <label class="field"><span>Category</span><select name="categoryId">${options.categories.map(c => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Paid from</span><select name="paidFromId">${options.payers.map(a => `<option value="${a.id}" ${a.id === p.paidFromId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
            ${field({ label: 'Description', name: 'narration', value: p.narration || '', span: 'span-2' })}
            ${field({ label: 'Note to the maker', name: 'note', span: 'span-2', placeholder: 'Optional' })}
        </form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Approve and post', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                await api.post(`/approvals/${p.id}/approve`, { amount: d.amount, entryDate: d.entryDate,
                    categoryId: Number(d.categoryId), paidFromId: Number(d.paidFromId), narration: d.narration, note: d.note });
                toast(`Approved and posted · ${money(d.amount)}`);
                window.dispatchEvent(new Event('approvals-changed'));
                reload();
            },
        }],
    });
}

function rejectDialog(p, reload) {
    openModal({
        title: `Reject · ${p.narration || p.categoryName}`, iconName: 'x',
        body: `<form class="form-grid one"><p class="small muted" style="margin:0">${money(p.amount)} recorded by ${esc(p.submittedBy)}. It stays out of the books; the maker sees the reason.</p>
            ${field({ label: 'Reason', name: 'note', placeholder: 'e.g. Duplicate, wrong amount, not ours' })}</form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Reject', kind: 'danger', iconName: 'x',
            onClick: async m => {
                await api.post(`/approvals/${p.id}/reject`, { note: m.el.querySelector('[name=note]').value });
                toast('Rejected');
                window.dispatchEvent(new Event('approvals-changed'));
                reload();
            },
        }],
    });
}

// ===================================================================== who needs approval

const APPROVERS = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];
const MODES = [
    ['OFF', 'lock', 'Off', 'Nothing waits for approval, not even access links'],
    ['LINKS', 'link', 'Access links only', 'Links made with approval wait; users post directly'],
    ['ALL', 'users', 'Links and users', 'Also every user who cannot approve, unless exempted below'],
];
const USER_SETTINGS = [['TENANT', 'As the household'], ['REQUIRED', 'Always needs approval'], ['EXEMPT', 'Never needs approval']];

/** The household's mode, each user's setting (saved as soon as it changes) and, for a super admin, the installation switch. */
async function approvalSettingsDialog(reload) {
    let [settings, users] = await Promise.all([api.get('/admin/approval'), api.get('/admin/users')]);
    let changed = false;
    const userRow = u => {
        const approver = APPROVERS.includes(u.role), viewer = u.role === 'VIEWER';
        return `<div class="ap-user" data-user="${u.id}">
            <span class="avatar sm">${esc(u.fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
            <span class="grow"><b>${esc(u.fullName)}</b><small class="muted">${esc(u.roleLabel)}${u.active ? '' : ' · inactive'} ·
                ${approver ? 'approves, never waits' : viewer ? 'cannot record' : u.needsApproval ? '<span class="warn-text">waits for approval now</span>' : 'posts directly now'}</small></span>
            ${approver || viewer ? '' : `<select data-user-approval="${u.id}" data-plain>${USER_SETTINGS.map(([k, l]) => `<option value="${k}" ${u.approval === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
        </div>`;
    };
    const draw = m => {
        m.el.querySelector('[data-ap-body]').innerHTML = `
            ${!settings.globalEnabled ? `<div class="xp-subs-bar has-rejected">${icon('alert')}<span>Approval is switched off for the whole installation: nothing waits, whatever is set below.</span></div>` : ''}
            <div><div class="ln-label">This household</div>
                <div class="ln-modes ap-mode">${MODES.map(([k, ico, l, hint]) => `<button type="button" class="mode-tile ${settings.mode === k ? 'active' : ''}" data-mode="${k}">${icon(ico)}<b>${l}</b><small>${hint}</small></button>`).join('')}</div></div>
            <div><div class="ln-label">Each user <small class="muted">· approvers (Manager, Admin) never wait; the setting is saved at once</small></div>
                <div class="ap-users">${users.map(userRow).join('')}</div></div>
            ${settings.canChangeGlobal ? `<label class="switch"><input type="checkbox" data-global ${settings.globalEnabled ? 'checked' : ''}><span></span>
                <b>Approval on the whole installation</b> <small class="muted">(every household; super admin only)</small></label>` : ''}
            ${settings.pending ? `<p class="small muted" style="margin:0">${settings.pending} entr${settings.pending === 1 ? 'y is' : 'ies are'} still waiting: switching approval off does not post them; approve or reject them as usual.</p>` : ''}`;
    };
    const modal = openModal({
        title: 'Who needs approval', iconName: 'check-circle', size: 'lg',
        body: '<div class="ap-settings" data-ap-body></div>',
        actions: [{ label: 'Done', kind: 'primary', onClick: () => { if (changed) reload(); } }],
    });
    draw(modal);
    modal.el.querySelector('[data-close]')?.addEventListener('click', () => { if (changed) reload(); });
    modal.el.addEventListener('click', async e => {
        const tile = e.target.closest('[data-mode]');
        if (!tile || tile.dataset.mode === settings.mode) return;
        try {
            settings = await api.put('/admin/approval', { mode: tile.dataset.mode });
            users = await api.get('/admin/users');
            changed = true;
            toast(`Approval: ${MODES.find(x => x[0] === settings.mode)[2].toLowerCase()}`);
            draw(modal);
        } catch (error) { toast(error.message, 'error'); }
    });
    modal.el.addEventListener('change', async e => {
        try {
            if (e.target.matches('[data-user-approval]')) {
                const saved = await api.put(`/admin/users/${e.target.dataset.userApproval}/approval`, { approval: e.target.value });
                users = users.map(u => u.id === saved.id ? saved : u);
                changed = true;
                toast(`${saved.fullName}: ${saved.needsApproval ? 'waits for approval' : 'posts directly'}`);
                draw(modal);
            }
            if (e.target.matches('[data-global]')) {
                settings = await api.put('/admin/approval/global', { enabled: e.target.checked });
                users = await api.get('/admin/users');
                changed = true;
                toast(`Approval ${settings.globalEnabled ? 'on' : 'off'} for the whole installation`);
                draw(modal);
            }
        } catch (error) { toast(error.message, 'error'); draw(modal); }
    });
}

// ===================================================================== clearing the log

const CLEAR_CHOICES = [[7, 'Older than a week'], [30, 'Older than a month'], [90, 'Older than 3 months'], [180, 'Older than 6 months'], [365, 'Older than a year'], [0, 'Everything']];

/** Deletes older activity after showing how many entries go; the clearing itself is logged. */
function clearDialog(reload) {
    let days = 30;
    const preview = async m => {
        const custom = Number(m.el.querySelector('[name=days]').value);
        const n = custom > 0 ? custom : days;
        const r = await api.post('/activity/clear', { olderThanDays: n, dryRun: true });
        m.el.querySelector('[data-clear-count]').innerHTML = r.count
            ? `<b>${r.count}</b> entr${r.count === 1 ? 'y' : 'ies'} ${r.before ? `from before <b>${date(r.before)}</b>` : '(everything)'} will be deleted. This cannot be undone.`
            : 'Nothing that old: nothing to delete.';
        return r;
    };
    openModal({
        title: 'Clear activity', iconName: 'trash',
        body: `<div class="form-grid one">
            <div class="ln-chips" data-clear-chips>${CLEAR_CHOICES.map(([d, l]) => `<button type="button" class="date-chip ${d === days ? 'selected' : ''}" data-days="${d}">${l}</button>`).join('')}</div>
            <label class="field"><span>Or older than this many days</span><input type="number" name="days" min="1" placeholder="e.g. 45" data-plain></label>
            <p class="small" data-clear-count style="margin:0">…</p>
            <p class="small muted" style="margin:0">Only the log is cleared: entries, accounts and approvals stay as they are. Export first if you want a copy.</p>
        </div>`,
        onOpen: m => {
            m.el.querySelector('[data-clear-chips]').addEventListener('click', e => {
                const b = e.target.closest('[data-days]');
                if (!b) return;
                days = Number(b.dataset.days);
                m.el.querySelector('[name=days]').value = '';
                m.el.querySelectorAll('[data-days]').forEach(x => x.classList.toggle('selected', x === b));
                preview(m).catch(error => m.setError(error.message));
            });
            let t;
            m.el.querySelector('[name=days]').addEventListener('input', () => {
                m.el.querySelectorAll('[data-days]').forEach(x => x.classList.remove('selected'));
                clearTimeout(t);
                t = setTimeout(() => preview(m).catch(error => m.setError(error.message)), 300);
            });
            preview(m).catch(error => m.setError(error.message));
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Delete', kind: 'danger', iconName: 'trash',
            onClick: async m => {
                const custom = Number(m.el.querySelector('[name=days]').value);
                const n = custom > 0 ? custom : days;
                const r = await api.post('/activity/clear', { olderThanDays: n, dryRun: false });
                toast(r.count ? `${r.count} activity entr${r.count === 1 ? 'y' : 'ies'} deleted` : 'Nothing to delete');
                reload();
            },
        }],
    });
}

// ===================================================================== access links

async function drawLinks(body, actions, reload, isCurrent) {
    const [links, app] = await Promise.all([api.get('/admin/links'), api.get('/meta/app')]);
    if (!isCurrent()) return;
    const activeCount = links.filter(l => l.status === 'ACTIVE').length;
    actions.innerHTML = `${activeCount ? `<button class="btn sm danger" id="ln-revoke-all" title="Switch off every working link now">${icon('lock')}Revoke all (${activeCount})</button>` : ''}
        <button class="btn primary" id="ln-new">${icon('plus')}New access link</button>`;
    body.innerHTML = `
        <p class="hint act-hint">${icon('info')} A link lets someone without an account see the sections you choose, for a limited time: <b>Lite</b> opens simple phone screens, <b>Rich</b> the full app with charts and details.
            <b>View only</b> lets them look; <b>Recorder</b> also lets them add expenses, and with <b>approval</b> each one waits for a checker.
            Revoking a link ends it at once, even on a phone where it is open.</p>
        ${panel({ title: 'Access links', iconName: 'link', bodyClass: 'flush', sub: `${activeCount} working · ${links.length} in all`,
            body: links.length ? `<div class="ln-list">${links.map(l => linkRow(l)).join('')}</div>` : emptyState('No access links yet', 'link') })}`;
    actions.querySelector('#ln-new').addEventListener('click', () => newLinkDialog(app, reload));
    actions.querySelector('#ln-revoke-all')?.addEventListener('click', async () => {
        if (!await confirmDialog(`Revoke all ${activeCount} working links? Anyone using them is signed out at once.`, { confirmLabel: 'Revoke all' })) return;
        const r = await api.post('/admin/links/revoke-all');
        toast(`${r.revoked} link${r.revoked === 1 ? '' : 's'} revoked`);
        reload();
    });
    body.addEventListener('click', async e => {
        const rv = e.target.closest('[data-revoke]'), del = e.target.closest('[data-delete]');
        try {
            if (rv) {
                const l = links.find(x => x.id === Number(rv.dataset.revoke));
                if (await confirmDialog(`Revoke the link for ${l.label}? It stops working immediately.`, { confirmLabel: 'Revoke' })) {
                    await api.post(`/admin/links/${l.id}/revoke`);
                    toast(`Link for ${l.label} revoked`);
                    reload();
                }
            }
            if (del) { await api.del(`/admin/links/${del.dataset.delete}`); toast('Removed from the list'); reload(); }
        } catch (error) { toast(error.message, 'error'); }
    });
}

function linkRow(l) {
    const left = new Date(l.expiresAt) - Date.now();
    const status = l.status === 'ACTIVE' ? ['good', 'check-circle', `Active · ends ${remaining(left)}`] : l.status === 'EXPIRED' ? ['gray', 'clock', 'Expired'] : ['critical', 'lock', 'Revoked'];
    return `<div class="ln-row ${l.status.toLowerCase()}">
        <span class="chip-icon ${l.mode === 'RECORD' ? 'gold' : 'violet'}">${icon(l.mode === 'RECORD' ? 'edit' : 'eye')}</span>
        <div class="ln-main">
            <div class="ln-top"><b>${esc(l.label)}</b><span class="badge ${status[0]}">${icon(status[1])}${status[2]}</span>
                <span class="tag" title="${l.client === 'DESKTOP' ? 'Opens the full app' : 'Opens the simple mobile screens'}">${l.client === 'DESKTOP' ? `${icon('dashboard')}Rich` : `${icon('phone')}Lite`}</span>
                <span class="tag">${l.mode === 'RECORD' ? 'Recorder' : 'View only'}</span>${l.approval ? `<span class="tag warn">${icon('check-circle')}needs approval</span>` : ''}</div>
            <div class="ln-sections">${l.features.map(k => { const f = FEATURES.find(x => x.key === k); return f ? `<span>${icon(f.iconName)}${esc(f.label)}</span>` : ''; }).join('')}</div>
            <div class="ln-meta">Made by ${esc(l.createdByName)} · ${dateTime(l.createdAt)} · ${l.status === 'REVOKED' ? `revoked ${dateTime(l.revokedAt)} by ${esc(l.revokedByName)}` : `until ${dateTime(l.expiresAt)}`}
                · opened ${l.useCount}×${l.lastUsedAt ? `, last ${dateTime(l.lastUsedAt)}` : ''}${l.openSessions ? ` · <b>${l.openSessions} open now</b>` : ''}${l.pending ? ` · <a href="#/activity/approvals">${l.pending} waiting for approval</a>` : ''}
                ${l.note ? ` · ${esc(l.note)}` : ''}</div>
        </div>
        <div class="ln-actions">${l.status === 'ACTIVE' ? `<button class="btn sm danger" data-revoke="${l.id}">${icon('lock')}Revoke</button>`
            : `<button class="btn sm ghost icon" data-delete="${l.id}" title="Remove from the list">${icon('trash')}</button>`}</div>
    </div>`;
}

function newLinkDialog(app, reload) {
    const picked = new Set(['EXPENSES']);
    const chips = desktop => (desktop ? FEATURES : FEATURES.filter(f => f.mobile)).map(f => `<label class="access-chip ${picked.has(f.key) ? 'on' : ''}">
        <input type="checkbox" data-feature="${f.key}" ${picked.has(f.key) ? 'checked' : ''}>${icon(f.iconName)}${esc(f.label)}</label>`).join('');
    const durations = [[1, '1 hour'], [4, '4 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
    openModal({
        title: 'New access link', iconName: 'link', size: 'lg',
        body: `<form class="form-grid two ln-form">
            ${field({ label: 'For whom', name: 'label', required: true, placeholder: 'e.g. Ravi (driver), Amma, Site supervisor', span: 'span-2', attrs: 'maxlength="60"' })}
            <div class="span-2"><div class="ln-label">Valid for</div>
                <div class="ln-chips" data-group="hours">${durations.map(([h, l]) => `<button type="button" class="date-chip ${h === 24 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}
                    <input type="number" name="customHours" min="1" max="720" placeholder="hours" data-plain class="ln-hours"></div></div>
            <div class="span-2"><div class="ln-label">Opens in</div>
                <div class="ln-modes" data-group="client">
                    <button type="button" class="mode-tile active" data-value="MOBILE">${icon('phone')}<b>Lite</b><small>simple, fast screens made for phones: the key numbers and lists</small></button>
                    <button type="button" class="mode-tile" data-value="DESKTOP">${icon('dashboard')}<b>Rich</b><small>the full app with charts, insights and details; fits phones and laptops</small></button>
                </div></div>
            <div class="span-2"><div class="ln-label">Access</div>
                <div class="ln-modes" data-group="mode">
                    <button type="button" class="mode-tile active" data-value="VIEW">${icon('eye')}<b>View only</b><small>can look, cannot change anything</small></button>
                    <button type="button" class="mode-tile" data-value="RECORD">${icon('edit')}<b>Recorder</b><small>can also add expenses</small></button>
                </div>
                <label class="check-line ln-approval" hidden><input type="checkbox" name="approval" checked> <b>Maker-checker:</b> each expense waits for approval before it is posted</label></div>
            <div class="span-2"><div class="ln-label">Sections <span class="ln-pick"><button type="button" class="link-btn" data-pick="all">All</button> · <button type="button" class="link-btn" data-pick="none">None</button></span></div>
                <div class="access-grid" data-sections>${chips(true)}</div>
                <p class="small muted" style="margin:4px 0 0">Dashboard shows the money at a glance; a recorder always gets Expenses. Users, settings and the activity log are never shared.</p></div>
            ${field({ label: 'Note', name: 'note', span: 'span-2', placeholder: 'Optional, e.g. for the Goa trip' })}
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            const sections = form.querySelector('[data-sections]');
            const remember = () => { picked.clear(); sections.querySelectorAll('[data-feature]:checked').forEach(i => picked.add(i.dataset.feature)); };
            form.addEventListener('click', e => {
                const pick = e.target.closest('[data-pick]');
                if (pick) {
                    sections.querySelectorAll('[data-feature]').forEach(i => { i.checked = pick.dataset.pick === 'all'; i.closest('.access-chip').classList.toggle('on', i.checked); });
                    remember();
                    return;
                }
                const chip = e.target.closest('[data-group] [data-value]');
                if (!chip) return;
                if (chip.closest('[data-group]').dataset.group === 'client') { remember(); sections.innerHTML = chips(true); }
                const group = chip.closest('[data-group]');
                const cls = chip.classList.contains('mode-tile') ? 'active' : 'selected';
                group.querySelectorAll('[data-value]').forEach(c => c.classList.toggle(cls, c === chip));
                if (group.dataset.group === 'hours') form.customHours.value = '';
                if (group.dataset.group === 'mode') {
                    const rec = chip.dataset.value === 'RECORD';
                    form.querySelector('.ln-approval').hidden = !rec;
                    if (rec) { const ex = form.querySelector('[data-feature="EXPENSES"]'); ex.checked = true; ex.closest('.access-chip').classList.add('on'); }
                }
            });
            form.addEventListener('change', e => { if (e.target.matches('[data-feature]')) e.target.closest('.access-chip').classList.toggle('on', e.target.checked); });
            // typed hours win over the preset chips: only one duration looks picked
            form.customHours.addEventListener('input', () => {
                const typed = !!form.customHours.value;
                form.querySelectorAll('[data-group="hours"] .date-chip').forEach(c => c.classList.toggle('selected', !typed && c.dataset.value === '24'));
            });
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Make link', kind: 'primary', iconName: 'link',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const hours = Number(form.customHours.value) || Number(form.querySelector('[data-group="hours"] .selected')?.dataset.value || 24);
                const mode = form.querySelector('[data-group="mode"] .active').dataset.value;
                const client = form.querySelector('[data-group="client"] .active').dataset.value;
                const features = [...form.querySelectorAll('[data-feature]:checked')].map(i => i.dataset.feature);
                if (!features.length) throw new Error('Pick at least one section');
                const created = await api.post('/admin/links', { label: form.label.value, hours, mode, features, client,
                    approval: mode === 'RECORD' && form.approval.checked, note: form.note.value });
                reload();
                setTimeout(() => showLink(created, app), 50);
            },
        }],
    });
}

/** The new link, shown once: copy, share or scan. */
function showLink({ link, token }, app) {
    const url = link.client === 'DESKTOP' ? `${location.origin}/?link=${token}` : `${location.origin}/${app.mobilePath}/?link=${token}`;
    const text = `Personal Budget access for ${link.label} (until ${dateTime(link.expiresAt)}): ${url}`;
    openModal({
        title: `Link for ${link.label}`, iconName: 'link',
        body: `<div class="ln-made">
            <div class="ln-qr">${qrSvg(url, { size: 176 })}</div>
            <div class="ln-made-main">
                <p class="small muted" style="margin:0">Shown only now: copy or share it. It works until <b>${dateTime(link.expiresAt)}</b>
                    (${link.client === 'DESKTOP' ? 'rich' : 'lite'}, ${link.mode === 'RECORD' ? `recorder${link.approval ? ' with approval' : ''}` : 'view only'}) and you can revoke it any time.</p>
                <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy>${icon('copy')}Copy</button></div>
                <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">${icon('phone')}Share on WhatsApp</a>
                    ${navigator.share ? `<button type="button" class="btn sm" data-share>${icon('link')}Share…</button>` : ''}</div>
            </div></div>`,
        onOpen: m => {
            m.el.querySelector('[data-copy]').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { m.el.querySelector('.ln-url input').select(); }
            });
            m.el.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ title: 'Personal Budget', text, url }).catch(() => {}));
        },
        actions: [{ label: 'Done', kind: 'primary' }],
    });
}

// ===================================================================== helpers

function stat(iconName, label, value, note) {
    return `<div class="act-stat"><span class="act-stat-icon">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><span>${note}</span></div></div>`;
}

function dayLabel(iso) {
    const diff = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : `${new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}, ${date(iso)}`;
}

function remaining(ms) {
    const h = ms / 3600000;
    return h < 1 ? `in ${Math.max(1, Math.round(ms / 60000))} min` : h < 48 ? `in ${Math.round(h)} h` : `in ${Math.round(h / 24)} days`;
}

function focusEnd(sel) {
    const el = document.querySelector(sel);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

