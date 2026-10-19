/**
 * Application entry point: sign-in, top menu, hash router and global shortcuts.
 *
 * Every page lives in js/views/<name>.js and exports:
 *     export async function render(container, params) { ... }   // draws the page
 * Routes look like  #/accounts  or  #/admin/users  (the part after the page name is passed as params).
 */
import { api, session, setUnauthorizedHandler, setConflictHandler, lastOwnMutation, mutationsInFlight } from './core/api.js';
import { state, loadOptions, can, readOnly, invalidateAccounts, hasFeature } from './core/store.js';
import { setCurrency } from './core/format.js';
import { icon, hydrateIcons } from './core/icons.js';
import { esc, toast } from './core/ui.js';
import { openQuickEntry, openJournalEditor } from './components/transaction-forms.js';
import { openExpenseDialog } from './components/expense-dialog.js';
import { openDebtDialog } from './components/debt-dialog.js';
import { isTyping, runPageKeys, clearPageKeys, openShortcutMap } from './core/keys.js';
import { startFooter, refreshFooter } from './components/footer.js';
import './core/autocomplete.js';   // enhances every input and select with history-based autocomplete
import './core/datepicker.js';     // a calendar with quick picks for every date box
import './components/evidence.js';    // fills evidence strips under expanded entries

import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as expenses from './views/expenses.js';
import * as income from './views/income.js';
import * as settings from './views/settings.js';
import * as accounts from './views/accounts.js';
import * as chits from './views/chits.js';
import * as planning from './views/planning.js';
import * as balanceSheet from './views/balance-sheet.js';
import * as reports from './views/reports.js';
import * as forecast from './views/forecast.js';
import * as admin from './views/admin.js';
import * as activity from './views/activity.js';
import * as gifts from './views/gifts.js';
import * as documents from './views/documents.js';

/** Top menu, in display order. */
const ROUTES = [
    { path: 'dashboard', label: 'Dashboard', iconName: 'dashboard', view: dashboard, feature: 'DASHBOARD' },
    { path: 'expenses', label: 'Expenses', iconName: 'receipt', view: expenses, feature: 'EXPENSES' },
    { path: 'income', label: 'Income', iconName: 'arrow-in', view: income, feature: 'INCOME' },
    { path: 'transactions', label: 'Journal', iconName: 'journal', view: transactions, feature: 'JOURNAL' },
    { path: 'accounts', label: 'Accounts', iconName: 'wallet', view: accounts, feature: 'ACCOUNTS' },
    { path: 'chits', label: 'Chits', iconName: 'chit', view: chits, feature: 'CHITS' },
    { path: 'planning', label: 'Budgets', iconName: 'target', view: planning, feature: 'BUDGETS' },
    { path: 'balance-sheet', label: 'Balance Sheet', iconName: 'scale', view: balanceSheet, feature: 'BALANCE_SHEET' },
    { path: 'reports', label: 'Reports', iconName: 'report', view: reports, feature: 'REPORTS' },
    { path: 'forecast', label: 'Forecast', iconName: 'trending', view: forecast, feature: 'FORECAST' },
    { path: 'gifts', label: 'Gifts', iconName: 'gift', view: gifts, feature: 'GIFTS' },
    { path: 'documents', label: 'Documents', iconName: 'file-text', view: documents, feature: 'DOCUMENTS' },
    // who changed what, approvals (maker-checker) and access links: checkers and admins only
    { path: 'activity', label: 'Activity', iconName: 'history', view: activity, permission: 'APPROVE_ENTRIES' },
    // users, roles and tenants: opened from Settings and the user menu, not the top menu
    { path: 'admin', label: 'Users & roles', iconName: 'shield', view: admin, hidden: true },
    { path: 'settings', label: 'Settings', iconName: 'settings', view: settings, hidden: true },
];

/** Pages of the sections shared with the user (admin pages and settings are always there). */
const allowedRoutes = () => ROUTES.filter(r => (!r.feature || hasFeature(r.feature)) && (!r.permission || can(r.permission)));

/** Entries waiting for approval, as a badge on the Activity menu item (refreshed with live updates). */
async function refreshApprovalBadge() {
    const link = document.querySelector('#main-menu a[data-path="activity"]');
    if (!link || !can('APPROVE_ENTRIES')) return;
    try {
        const { pending } = await api.get('/approvals/count');
        link.querySelector('.menu-badge')?.remove();
        if (pending) link.insertAdjacentHTML('beforeend', `<i class="menu-badge" title="${pending} waiting for approval">${pending}</i>`);
    } catch { /* not important */ }
}

/** Number keys jump to these pages (see the shortcut map). */
const JUMP = { 1: 'dashboard', 2: 'expenses', 3: 'income', 4: 'transactions', 5: 'accounts', 6: 'chits',
    7: 'planning', 8: 'balance-sheet', 9: 'reports', 0: 'forecast', ',': 'settings' };

const $ = (id) => document.getElementById(id);

// ===================================================================== sign-in

const LAST_USER = 'pb.lastUser';
const remembered = () => { try { return localStorage.getItem(LAST_USER) || ''; } catch { return ''; } };

function showLogin(message = '') {
    $('app').hidden = true;
    $('login-screen').hidden = false;
    $('password-form').hidden = true;
    $('login-tabs').hidden = false;
    $('signin-form').hidden = false;
    $('register-form').hidden = true;
    $('login-tabs').querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'signin'));
    $('login-error').textContent = message;
    const form = $('signin-form');
    form.password.value = '';
    if (!form.username.value) form.username.value = remembered();
    (form.username.value ? form.password : form.username).focus();
    // where the mobile version lives (set by an admin in Settings)
    api.get('/meta/app').then(app => {
        const link = $('mobile-link');
        link.href = `/${app.mobilePath}/`;
        link.hidden = false;
    }).catch(() => {});
}

async function startSession(sessionView) {
    session.token = sessionView.token;
    await enterApp();
}

function bindLoginScreen() {
    const tabs = $('login-tabs');
    tabs.addEventListener('click', e => {
        const tab = e.target.closest('[data-tab]');
        if (!tab) return;
        tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        $('signin-form').hidden = tab.dataset.tab !== 'signin';
        $('register-form').hidden = tab.dataset.tab !== 'register';
        $('login-error').textContent = '';
    });

    const submit = (form, path) => form.addEventListener('submit', async e => {
        e.preventDefault();
        $('login-error').textContent = '';
        const body = Object.fromEntries(new FormData(form).entries());
        sessionPassword = body.password || '';
        const button = form.querySelector('[type=submit]');
        const label = button.textContent;
        button.disabled = true;
        button.textContent = path === '/auth/login' ? 'Signing in…' : 'Creating…';
        try {
            const s = await api.post(path, body);
            try { localStorage.setItem(LAST_USER, body.username.trim()); } catch { /* private mode */ }
            await startSession(s);
        } catch (error) {
            $('login-error').textContent = error.message;
            if (form.password) { form.password.value = ''; form.password.focus(); }
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    });
    submit($('signin-form'), '/auth/login');
    submit($('register-form'), '/auth/register');

    // show / hide a password, and warn when Caps Lock is on
    $('login-screen').addEventListener('click', e => {
        const eye = e.target.closest('[data-eye]');
        if (!eye) return;
        const input = eye.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.innerHTML = icon(show ? 'lock' : 'eye');
        eye.title = show ? 'Hide the password' : 'Show the password';
        input.focus();
    });
    const caps = e => {
        if (!e.getModifierState || !e.target.matches?.('input[type=password], input[name$="assword"]')) return;
        const warn = e.target.closest('.field')?.querySelector('[data-caps]');
        if (warn) warn.hidden = !e.getModifierState('CapsLock');
    };
    $('login-screen').addEventListener('keyup', caps);
    $('login-screen').addEventListener('keydown', caps);

    bindPasswordStep();
}

// ===================================================================== a new password before anything else

/** Signed in with the default password: the only way on is to set a new one (the server allows nothing else). */
function showPasswordStep() {
    $('app').hidden = true;
    $('login-screen').hidden = false;
    $('login-tabs').hidden = true;
    $('signin-form').hidden = true;
    $('register-form').hidden = true;
    const form = $('password-form');
    form.hidden = false;
    form.reset();
    form.dataset.current = sessionPassword || '';
    form.querySelector('[data-current-field]').hidden = !!sessionPassword;   // a reload forgot it: ask again
    form.currentPassword.required = !sessionPassword;
    checkPassword(form);
    $('login-error').textContent = '';
    (sessionPassword ? form.newPassword : form.currentPassword).focus();
}

/** The password just typed on the sign-in form (kept only in memory, for the password step). */
let sessionPassword = '';

function checkPassword(form) {
    const v = form.newPassword.value;
    const username = (state.user?.username || '').toLowerCase();
    const rules = {
        len: v.length >= 8,
        mix: /[A-Za-z]/.test(v) && /\d/.test(v),
        new: !!v && v !== (form.dataset.current || form.currentPassword.value) && v.toLowerCase() !== username,
    };
    Object.entries(rules).forEach(([k, ok]) => form.querySelector(`[data-rule="${k}"]`).classList.toggle('ok', ok));
    const score = !v ? 0 : Math.min(4, (v.length >= 8) + (v.length >= 12) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + /[^A-Za-z0-9]/.test(v) + (/\d/.test(v) && /[A-Za-z]/.test(v)));
    const meter = form.querySelector('[data-meter]');
    meter.dataset.score = String(score);
    meter.title = ['', 'Weak', 'Fair', 'Good', 'Strong'][score] || '';
    const match = form.querySelector('[data-match]');
    const c = form.confirmPassword.value;
    match.textContent = !c ? '' : c === v ? '✓ matches' : 'does not match yet';
    match.className = `pw-match ${!c ? '' : c === v ? 'ok' : 'bad'}`;
    return Object.values(rules).every(Boolean) && c === v;
}

function bindPasswordStep() {
    const form = $('password-form');
    form.addEventListener('input', () => checkPassword(form));
    $('password-cancel').addEventListener('click', logout);
    form.addEventListener('submit', async e => {
        e.preventDefault();
        $('login-error').textContent = '';
        if (!checkPassword(form)) {
            $('login-error').textContent = form.newPassword.value !== form.confirmPassword.value
                ? 'The two passwords do not match' : 'The new password does not meet the rules above';
            return;
        }
        const button = form.querySelector('[type=submit]');
        button.disabled = true;
        try {
            const current = form.dataset.current || form.currentPassword.value;
            await api.post('/auth/password', { currentPassword: current, newPassword: form.newPassword.value });
            sessionPassword = '';
            form.reset();
            toast('Password saved. Welcome!');
            await enterApp();
        } catch (error) {
            $('login-error').textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
}

async function logout() {
    try { await api.post('/auth/logout'); } catch { /* already signed out */ }
    stopLiveUpdates();
    session.token = null;
    state.user = null;
    state.accounts = null;
    state.categories = null;
    sessionPassword = '';
    showLogin();
}

// ===================================================================== live updates

/*
 * The server announces every committed change on /api/events (server-sent events). When someone else
 * changes data, the current page is redrawn with fresh numbers; while a dialog is open the redraw waits
 * until it closes, so nothing being typed is lost. Saving a dialog that is based on stale data is refused
 * by the server (409) and handled by the conflict handler below.
 */
let events = null;
let pendingRefresh = null;

window.addEventListener('approvals-changed', () => refreshApprovalBadge());

function startLiveUpdates() {
    stopLiveUpdates();
    if (!session.token || typeof EventSource === 'undefined') return;
    events = new EventSource('/api/events?token=' + encodeURIComponent(session.token));
    events.addEventListener('change', e => {
        let change = {};
        try { change = JSON.parse(e.data); } catch { /* keep defaults */ }
        if (change.userId === state.user?.userId && (mutationsInFlight > 0 || Date.now() - lastOwnMutation < 3000)) return;   // our own save
        invalidateAccounts();
        refreshFooter(true);
        refreshApprovalBadge();
        const who = change.userId === state.user?.userId ? 'You (another window)' : (change.by || 'Someone');
        if (document.querySelector('.modal-backdrop, .ev-overlay')) {
            if (!pendingRefresh) toast(`${who} changed data; this page refreshes when you close the dialog`, 'info');
            pendingRefresh = who;
            return;
        }
        toast(`${who} updated the data — page refreshed`, 'info');
        route({ silent: true });
    });
    events.onerror = () => {
        if (!state.user) stopLiveUpdates();   // signed out: stop reconnecting
    };
}

function stopLiveUpdates() {
    events?.close();
    events = null;
}

// a refresh held back for an open dialog runs as soon as the last dialog closes
new MutationObserver(() => {
    if (pendingRefresh && !document.querySelector('.modal-backdrop, .ev-overlay')) {
        pendingRefresh = null;
        route({ silent: true });
    }
}).observe(document.body, { childList: true });

// ===================================================================== app shell

async function enterApp() {
    state.user = await api.get('/auth/me');
    if (state.user.mustChangePassword) { showPasswordStep(); return; }
    sessionPassword = '';
    await loadOptions();
    setCurrency(state.user.currency);

    $('login-screen').hidden = true;
    $('app').hidden = false;
    $('tenant-name').textContent = state.user.tenantName;
    $('user-name').textContent = state.user.fullName;
    $('user-role').textContent = state.user.roleLabel + (readOnly() ? ' · read only' : '');
    document.body.classList.toggle('read-only', readOnly());
    $('user-avatar').textContent = state.user.fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const viaLink = !!state.user.linkId;
    document.body.classList.toggle('via-link', viaLink);
    if (viaLink) $('user-role').textContent = `Shared link · until ${new Date(state.user.linkExpiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    $('user-dropdown').querySelectorAll('a[href^="#/admin"], a[href="#/settings"]').forEach(a => { a.hidden = viaLink; });

    const keyOf = path => Object.entries(JUMP).find(([, p]) => p === path)?.[0];
    $('main-menu').innerHTML = allowedRoutes().filter(r => !r.hidden).map(r =>
        `<a href="#/${r.path}" data-path="${r.path}" title="${esc(r.label)}${keyOf(r.path) ? ` (${keyOf(r.path)})` : ''}">${icon(r.iconName)}<span>${esc(r.label)}</span></a>`).join('');

    startFooter();
    startLiveUpdates();
    refreshApprovalBadge();
    if (!location.hash) location.hash = '#/' + allowedRoutes()[0].path;
    else route();
}

function bindShell() {
    hydrateIcons(document);
    $('logout-btn').addEventListener('click', logout);

    const dropdown = $('user-dropdown');
    $('user-btn').addEventListener('click', e => { e.stopPropagation(); dropdown.hidden = !dropdown.hidden; });
    document.addEventListener('click', () => { dropdown.hidden = true; });

    $('shortcuts-btn').addEventListener('click', openShortcutMap);

    // phones: the menu is a sheet opened from the top-left button; any choice (or a tap outside) closes it
    const toggleMenu = open => {
        document.body.classList.toggle('menu-open', open);
        $('menu-toggle').setAttribute('aria-expanded', String(open));
    };
    $('menu-toggle').addEventListener('click', e => { e.stopPropagation(); toggleMenu(!document.body.classList.contains('menu-open')); });
    $('main-menu').addEventListener('click', e => { if (e.target.closest('a')) toggleMenu(false); });
    document.addEventListener('click', e => { if (!e.target.closest('#main-menu, #menu-toggle')) toggleMenu(false); });
    window.addEventListener('hashchange', () => toggleMenu(false));

    // Keyboard: the page's own keys first (lists, tables), then the global shortcuts (see core/keys.js)
    document.addEventListener('keydown', e => {
        if (!state.user || document.querySelector('.modal-backdrop, .ev-overlay')) return;
        if (e.key === 'Escape' && isTyping() && document.activeElement.value) return;   // let the box clear itself
        if (runPageKeys(e)) return;
        if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const post = can('POST_TRANSACTIONS');
        const xp = post && hasFeature('EXPENSES');
        const actions = {
            e: () => xp && openExpenseDialog({ onSaved: route }),
            i: () => post && hasFeature('INCOME') && openQuickEntry({ kind: 'INCOME', onSaved: route }),
            t: () => post && hasFeature('ACCOUNTS') && openQuickEntry({ kind: 'TRANSFER', onSaved: route }),
            l: () => xp && openExpenseDialog({ mode: 'LENT', onSaved: route }),
            b: () => xp && openDebtDialog({ onSaved: route }),
            n: () => xp && openQuickEntry({ onSaved: route }),
            v: () => can('MANAGE_JOURNALS') && hasFeature('JOURNAL') && openJournalEditor({ onSaved: route }),
            r: () => route(),
            '?': () => openShortcutMap(),
            '/': () => document.querySelector('#view .search-box input, #view input[type=search]')?.focus(),
        };
        if (key in JUMP) { e.preventDefault(); if (allowedRoutes().some(r => r.path === JUMP[key])) location.hash = '#/' + JUMP[key]; return; }
        if (actions[key]) { e.preventDefault(); actions[key](); }
    });

    window.addEventListener('hashchange', route);

    // Scrollbars stay hidden until something scrolls, then fade out shortly after it stops
    const scrollTimers = new WeakMap();
    document.addEventListener('scroll', e => {
        const el = e.target === document ? document.documentElement : e.target;
        if (!(el instanceof Element)) return;
        el.classList.add('is-scrolling');
        clearTimeout(scrollTimers.get(el));
        scrollTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900));
    }, { capture: true, passive: true });
}

// ===================================================================== router

let renderToken = 0;

async function route({ silent = false } = {}) {
    if (!state.user) return;
    const [path, ...params] = location.hash.replace(/^#\/?/, '').split('/');
    const match = allowedRoutes().find(r => r.path === path) || allowedRoutes()[0];
    if (path !== match.path) history.replaceState(null, '', `#/${match.path}`);   // a section not shared (or unknown): show the first one

    document.querySelectorAll('#main-menu a').forEach(a => a.classList.toggle('active', a.dataset.path === match.path));
    document.title = `${match.label} · Personal Budget`;

    const container = $('view');
    const token = ++renderToken;
    clearPageKeys();
    // a silent refresh (live update) keeps the page on screen while it redraws, then restores scrolling
    const scrolls = silent ? [...container.querySelectorAll('*')].filter(el => el.scrollTop > 0)
        .map(el => [el.id || el.className, el.scrollTop]) : [];
    const pageScroll = window.scrollY;
    if (!silent) container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
        await match.view.render(container, params, () => token === renderToken);
        if (token !== renderToken) return;
        if (silent) {
            window.scrollTo(0, pageScroll);
            scrolls.forEach(([key, top]) => {
                const el = [...container.querySelectorAll('*')].find(x => (x.id || x.className) === key);
                if (el) el.scrollTop = top;
            });
        }
        hydrateIcons(container);
    } catch (error) {
        if (token !== renderToken) return;
        container.innerHTML = `<div class="empty">${icon('alert-circle')}<div>${esc(error.message)}</div></div>`;
        if (error.status !== 401) toast(error.message, 'error');
    }
}

// ===================================================================== start

setUnauthorizedHandler(() => {
    stopLiveUpdates();
    session.token = null;
    state.user = null;
    showLogin('Your session ended. Please sign in again.');
});

// Someone else saved the same record first: drop cached data and redraw once the dialog is closed,
// so the user sees the current values before trying again. The dialog shows the server's message.
setConflictHandler(() => {
    invalidateAccounts();
    if (document.querySelector('.modal-backdrop, .ev-overlay')) pendingRefresh = pendingRefresh || 'conflict';
    else route({ silent: true });
});

bindLoginScreen();
bindShell();

// an access link to the full app (?link=…): a session with only what the link shares
const linkToken = new URLSearchParams(location.search).get('link');
if (linkToken) {
    history.replaceState(null, '', location.pathname + location.hash);   // the token does not stay in the address bar
    api.post('/auth/link', { token: linkToken })
        .then(s => { session.token = s.token; return enterApp(); })
        .catch(error => { session.token = null; showLogin(error.message); });
} else if (session.token) {
    enterApp().catch(() => showLogin());
} else {
    showLogin();
}

/** Lets views re-render the current page after a change made in a dialog. */
export { route as refreshCurrentView };
