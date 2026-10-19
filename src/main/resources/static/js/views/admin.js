/**
 * Administration: users of this tenant, tenants of the platform, the role/permission matrix
 * and the signed-in user's profile (#/admin/users | tenants | roles | profile).
 */
import { api } from '../core/api.js';
import { state, can, FEATURES } from '../core/store.js';
import { panel, table, esc, field, readForm, openModal, toast, confirmDialog, stat } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { date } from '../core/format.js';

const TABS = [
    { key: 'users', label: 'Users', iconName: 'users', permission: 'MANAGE_USERS' },
    { key: 'tenants', label: 'Tenants', iconName: 'building', permission: 'MANAGE_TENANTS' },
    { key: 'roles', label: 'Roles & permissions', iconName: 'shield' },
    { key: 'profile', label: 'My profile', iconName: 'user' },
];

export async function render(container, params, isCurrent) {
    const visible = TABS.filter(t => !t.permission || can(t.permission));
    const active = visible.find(t => t.key === params[0]) || visible[0];

    container.innerHTML = `
    <div class="page admin-page">
        <div class="page-toolbar">
            <div class="tabs">${visible.map(t =>
                `<a class="tab ${t.key === active.key ? 'active' : ''}" href="#/admin/${t.key}">${icon(t.iconName)}${t.label}</a>`).join('')}</div>
            <span class="spacer"></span>
            <div class="row" id="admin-actions"></div>
        </div>
        <div class="admin-body" id="admin-body"></div>
    </div>`;

    const body = container.querySelector('#admin-body');
    const actions = container.querySelector('#admin-actions');
    const reload = () => render(container, [active.key], isCurrent);
    const draw = { users: drawUsers, tenants: drawTenants, roles: drawRoles, profile: drawProfile }[active.key];
    await draw(body, actions, reload);
}

// ===================================================================== users

async function drawUsers(body, actions, reload) {
    const users = await api.get('/admin/users');
    actions.innerHTML = `<button class="btn primary" id="new-user">${icon('plus')}User</button>`;
    actions.querySelector('#new-user').addEventListener('click', () => openUserForm(null, reload));

    body.innerHTML = panel({
        title: `Users of ${state.user.tenantName}`, iconName: 'users', bodyClass: 'flush', sub: `${users.length} users`,
        body: `<div class="scroll" style="height:100%">${table([
            { label: 'User', render: u => `<div class="row"><span class="avatar sm">${esc(initials(u.fullName))}</span>
                <div><b>${esc(u.fullName)}</b><div class="small muted">${esc(u.username)}${u.email ? ' · ' + esc(u.email) : ''}</div></div></div>` },
            { label: 'Role', render: u => `<span class="badge ${u.role === 'SUPER_ADMIN' || u.role === 'ADMIN' ? '' : 'gray'}">${icon('shield')}${esc(u.roleLabel)}</span>` },
            { label: 'Status', render: u => u.active ? `<span class="badge good">${icon('check')}Active</span>` : `<span class="badge gray">${icon('lock')}Inactive</span>` },
            { label: 'Shared', render: u => `<span class="access-cell" title="${esc(FEATURES.filter(f => u.features.includes(f.key)).map(f => f.label).join(', '))}">
                ${u.limited ? `<span class="badge">${icon('eye')}${u.features.length} of ${FEATURES.length}</span>` : `<span class="badge gray">${icon('eye')}Everything</span>`}
                ${u.needsApproval ? `<span class="badge warning" title="What this user records waits for a checker">${icon('hourglass')}Needs approval</span>` : ''}
                <span class="badge ${u.mobileAccess ? 'aqua' : 'gray'}" title="${u.mobileAccess ? `Mobile: ${esc(FEATURES.filter(f => f.mobile && u.mobileFeatures.includes(f.key) && u.features.includes(f.key)).map(f => f.label).join(', '))}` : 'No mobile access'}">${icon('phone')}${u.mobileAccess ? 'Mobile' : 'No mobile'}</span></span>` },
            { label: 'Last sign-in', render: u => u.lastLoginAt ? date(u.lastLoginAt) : '<span class="muted">Never</span>' },
            { label: 'Created', render: u => date(u.createdAt) },
            { label: '', align: 'r', render: u => `<div class="actions">
                <button class="btn sm ghost" data-edit="${u.id}" title="Edit">${icon('edit')}</button>
                ${u.id !== state.user.userId ? `<button class="btn sm ghost danger" data-delete="${u.id}" title="Delete">${icon('trash')}</button>` : ''}</div>` },
        ], users)}</div>`,
    });

    body.addEventListener('click', async e => {
        const edit = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-delete]');
        if (edit) openUserForm(users.find(u => u.id === Number(edit.dataset.edit)), reload);
        if (del) {
            const user = users.find(u => u.id === Number(del.dataset.delete));
            if (await confirmDialog(`Delete user "${user.username}"?`)) {
                try {
                    await api.del(`/admin/users/${user.id}`);
                    toast('User deleted');
                    reload();
                } catch (error) { toast(error.message, 'error'); }
            }
        }
    });
}

function openUserForm(user, reload) {
    const roles = state.options.roles.filter(r => r.value !== 'SUPER_ADMIN' || state.user.role === 'SUPER_ADMIN');
    const u = user || { role: 'MEMBER', active: true, features: FEATURES.map(f => f.key), mobileAccess: true, mobileFeatures: FEATURES.filter(f => f.mobile).map(f => f.key) };
    const self = user && user.id === state.user.userId;
    const box = (group, f, on, disabled = false) => `<label class="access-chip ${on ? 'on' : ''}"><input type="checkbox" data-${group}="${f.key}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${icon(f.iconName)}${esc(f.label)}</label>`;
    openModal({
        title: user ? `Edit ${user.username}` : 'New user', iconName: 'user',
        body: `<form class="form-grid two">
            ${field({ label: 'Full name', name: 'fullName', value: u.fullName, required: true, span: 'span-2' })}
            ${field({ label: 'Username', name: 'username', value: u.username, required: true })}
            ${field({ label: 'Email', name: 'email', type: 'email', value: u.email })}
            ${field({ label: user ? 'New password' : 'Password', name: 'password', type: 'password', required: !user,
                      hint: user ? 'Leave empty to keep the current password' : 'At least 6 characters' })}
            ${field({ label: 'Role', name: 'role', type: 'select', value: u.role, options: roles })}
            ${field({ label: 'Active', name: 'active', type: 'checkbox', value: u.active })}
            ${field({ label: 'Expenses need approval', name: 'approval', type: 'select', value: u.approval || 'TENANT',
                      options: [{ value: 'TENANT', label: 'As the household is set' }, { value: 'REQUIRED', label: 'Always (maker-checker)' }, { value: 'EXEMPT', label: 'Never' }],
                      hint: 'Managers and admins approve, so they never wait' })}
            <p class="hint span-2">The role decides what this user can do; a Viewer can look at everything but change nothing.</p>
            <div class="span-2 access-box">
                <div class="access-head"><b>${icon('eye')} Sections shared</b><span class="small muted">${self ? 'your own access cannot be limited' : 'what this user sees on the full site'}</span>
                    ${self ? '' : '<span class="spacer"></span><button type="button" class="link-btn" data-access-all>All</button>'}</div>
                <div class="access-grid">${FEATURES.map(f => box('feature', f, u.features.includes(f.key), self)).join('')}</div>
                <div class="access-head"><label class="switch"><input type="checkbox" name="mobileAccessToggle" ${u.mobileAccess ? 'checked' : ''} ${self ? 'disabled' : ''}><span></span>${icon('phone')} Mobile version</label>
                    <span class="small muted">a lighter app for phones, at the address set in Settings</span></div>
                <div class="access-grid mobile ${u.mobileAccess ? '' : 'off'}">${FEATURES.filter(f => f.mobile).map(f => box('mobile', f, u.mobileFeatures.includes(f.key))).join('')}</div>
            </div>
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            const sync = () => {
                form.querySelectorAll('.access-chip').forEach(c => c.classList.toggle('on', c.querySelector('input').checked));
                // a section that is not shared cannot be on the phone either
                form.querySelectorAll('[data-mobile]').forEach(i => {
                    const shared = form.querySelector(`[data-feature="${i.dataset.mobile}"]`).checked;
                    i.disabled = !shared;
                    i.closest('.access-chip').classList.toggle('disabled', !shared);
                });
                form.querySelector('.access-grid.mobile').classList.toggle('off', !form.mobileAccessToggle.checked);
            };
            form.addEventListener('change', sync);
            form.querySelector('[data-access-all]')?.addEventListener('click', () => { form.querySelectorAll('[data-feature]').forEach(i => { i.checked = true; }); sync(); });
            sync();
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Save user', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                const picked = group => [...form.querySelectorAll(`[data-${group}]`)].filter(i => i.checked).map(i => i.dataset[group]);
                const features = picked('feature');
                if (!features.length) throw new Error('Share at least one section');
                data.features = features.length === FEATURES.length ? null : features;
                data.mobileAccess = form.mobileAccessToggle.checked;
                const mobile = picked('mobile').filter(k => features.includes(k));
                data.mobileFeatures = mobile.length === FEATURES.filter(f => f.mobile).length ? null : mobile;
                delete data.mobileAccessToggle;
                if (user) await api.put(`/admin/users/${user.id}`, data);
                else await api.post('/admin/users', data);
                toast('User saved');
                reload();
            },
        }],
    });
}

// ===================================================================== tenants

async function drawTenants(body, actions, reload) {
    const tenants = await api.get('/admin/tenants');
    actions.innerHTML = `<button class="btn primary" id="new-tenant">${icon('plus')}Tenant</button>`;
    actions.querySelector('#new-tenant').addEventListener('click', () => openTenantForm(null, reload));

    body.innerHTML = panel({
        title: 'Tenants', iconName: 'building', bodyClass: 'flush', sub: 'Each tenant has its own isolated books',
        body: `<div class="scroll" style="height:100%">${table([
            { label: 'Tenant', render: t => `<b>${esc(t.name)}</b><div class="small muted mono">${esc(t.code)}</div>` },
            { label: 'Currency', render: t => esc(t.currency) },
            { label: 'Users', align: 'r', render: t => t.userCount },
            { label: 'Accounts', align: 'r', render: t => t.accountCount },
            { label: 'Status', render: t => t.active ? `<span class="badge good">${icon('check')}Active</span>` : `<span class="badge gray">${icon('lock')}Inactive</span>` },
            { label: 'Created', render: t => date(t.createdAt) },
            { label: '', align: 'r', render: t => `<button class="btn sm ghost" data-edit="${t.id}" title="Edit">${icon('edit')}</button>` },
        ], tenants)}</div>`,
    });
    body.addEventListener('click', e => {
        const edit = e.target.closest('[data-edit]');
        if (edit) openTenantForm(tenants.find(t => t.id === Number(edit.dataset.edit)), reload);
    });
}

function openTenantForm(tenant, reload) {
    const t = tenant || { currency: 'INR', active: true };
    openModal({
        title: tenant ? `Edit ${tenant.name}` : 'New tenant', iconName: 'building',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', value: t.name, required: true, span: 'span-2' })}
            ${field({ label: 'Code', name: 'code', value: t.code, required: true, attrs: tenant ? 'readonly' : 'pattern="[a-z0-9][a-z0-9-]{1,29}"' })}
            ${field({ label: 'Currency', name: 'currency', value: t.currency, attrs: 'maxlength="3"' })}
            ${tenant ? field({ label: 'Active', name: 'active', type: 'checkbox', value: t.active }) : `
                <div class="section-title span-2">First admin of the tenant</div>
                ${field({ label: 'Admin username', name: 'adminUsername', required: true })}
                ${field({ label: 'Admin full name', name: 'adminFullName' })}
                ${field({ label: 'Admin password', name: 'adminPassword', type: 'password', required: true, span: 'span-2' })}`}
        </form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Save tenant', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                if (tenant) await api.put(`/admin/tenants/${tenant.id}`, data);
                else await api.post('/admin/tenants', data);
                toast('Tenant saved');
                reload();
            },
        }],
    });
}

// ===================================================================== roles matrix

async function drawRoles(body, actions) {
    const { roles, permissions, roleMatrix } = state.options;
    actions.innerHTML = `<span class="badge good">${icon('lock')}Enforced on every request</span>`;

    body.innerHTML = panel({
        title: 'Role / permission matrix', iconName: 'shield', bodyClass: 'flush',
        sub: 'Checked by the server on every request; a refused action returns 403',
        body: `<div class="scroll" style="height:100%"><table class="grid matrix">
            <thead><tr><th>Permission</th>${roles.map(r => `<th class="c" title="${esc(r.description)}">${esc(r.label)}</th>`).join('')}</tr></thead>
            <tbody>${permissions.map(p => `<tr>
                <td><b>${esc(p.label)}</b><div class="small muted">${esc(p.description)}</div></td>
                ${roles.map(r => `<td class="c">${roleMatrix[r.value].includes(p.value)
                    ? `<span class="tick">${icon('check')}</span>` : '<span class="muted">—</span>'}</td>`).join('')}
            </tr>`).join('')}</tbody>
        </table>
        <div class="role-notes">${roles.map(r => `<div class="stat"><div class="label">${esc(r.label)}</div><div class="note">${esc(r.description)}</div></div>`).join('')}</div>
        </div>`,
    });
}

// ===================================================================== profile

async function drawProfile(body, actions) {
    const me = state.user;
    actions.innerHTML = '';
    body.innerHTML = `<div class="profile-grid">
        ${panel({
            title: 'My profile', iconName: 'user',
            body: `<div class="row" style="margin:8px 0 14px"><span class="avatar lg">${esc(initials(me.fullName))}</span>
                    <div><h3>${esc(me.fullName)}</h3><div class="muted">${esc(me.username)}${me.email ? ' · ' + esc(me.email) : ''}</div></div></div>
                   <div class="stat-strip" style="grid-template-columns:1fr 1fr">
                    ${stat('Role', esc(me.roleLabel))}
                    ${stat('Household', esc(me.tenantName), esc(me.tenantCode))}
                    ${stat('Currency', esc(me.currency))}
                    ${stat('Permissions', String(me.permissions.length), 'enforced by the server')}
                   </div>`,
        })}
        ${panel({
            title: 'Change password', iconName: 'lock',
            body: `<form class="form-grid one" id="password-form">
                ${field({ label: 'Current password', name: 'currentPassword', type: 'password', required: true })}
                ${field({ label: 'New password', name: 'newPassword', type: 'password', required: true, attrs: 'minlength="6"' })}
                <button class="btn primary" type="submit">${icon('check')}Update password</button>
            </form>`,
        })}
    </div>`;
    body.querySelector('#password-form').addEventListener('submit', async e => {
        e.preventDefault();
        try {
            await api.post('/auth/password', readForm(e.target));
            e.target.reset();
            toast('Password updated');
        } catch (error) { toast(error.message, 'error'); }
    });
}

function initials(name) {
    return (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

