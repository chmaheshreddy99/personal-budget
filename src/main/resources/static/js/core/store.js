/**
 * Shared client state: the signed-in user, reference options and short-lived account / category lists.
 * Nothing here is the source of truth: the lists are dropped after every change (ours, or another
 * user's, announced by the live-update stream) and fetched again on next use.
 */
import { api, onMutation } from './api.js';

export const state = {
    user: null,       // MeView from /api/auth/me
    options: null,    // drop-down data from /api/meta/options
    accounts: null,   // AccountView[] (refreshed after changes)
    categories: null, // CategoryView[] (refreshed after changes)
};

export async function loadOptions() {
    if (!state.options) state.options = await api.get('/meta/options');
    return state.options;
}

export async function loadAccounts(force = false) {
    if (!state.accounts || force) state.accounts = await api.get('/accounts');
    return state.accounts;
}

/** Expense and income categories with this / last month's figures. */
export async function loadCategories(force = false) {
    if (!state.categories || force) state.categories = await api.get('/categories');
    return state.categories;
}

/** Categories only the budget uses: Chit Payments fills itself from the installments paid on the Chits page. */
export const BUDGET_ONLY = new Set(['CHIT_PAYMENTS']);

/**
 * Active categories of one kind (EXPENSE or INCOME), keeping a given id even when inactive.
 * Budget-only categories are left out (nothing can be recorded in them) unless { budget: true }.
 */
export async function categoriesOf(kind, keepId = null, { budget = false } = {}) {
    return (await loadCategories()).filter(c => c.kind === kind && (c.active || c.id === Number(keepId))
        && (budget || !BUDGET_ONLY.has(c.systemKey)));
}

/** Forget cached lists so the next load fetches fresh balances. */
export function invalidateAccounts() {
    state.accounts = null;
    state.categories = null;
}

/**
 * True when the user's role allows an action. The server refuses anything else anyway; this only
 * keeps buttons the user cannot use off the screen (a Viewer sees no add / edit / delete at all).
 */
export function can(permission) {
    return !!state.user?.permissions.includes(permission);
}

/**
 * The app's sections an admin can share with a user (server: Feature). The server refuses calls of a section
 * that is not shared; this keeps its menu entries, shortcuts and buttons away.
 */
export const FEATURES = [
    { key: 'DASHBOARD', label: 'Dashboard', path: 'dashboard', iconName: 'dashboard', mobile: true },
    { key: 'EXPENSES', label: 'Expenses', path: 'expenses', iconName: 'receipt', mobile: true },
    { key: 'INCOME', label: 'Income', path: 'income', iconName: 'arrow-in', mobile: true },
    { key: 'JOURNAL', label: 'Journal', path: 'transactions', iconName: 'journal', mobile: true },
    { key: 'ACCOUNTS', label: 'Accounts', path: 'accounts', iconName: 'wallet', mobile: true },
    { key: 'CHITS', label: 'Chits', path: 'chits', iconName: 'chit', mobile: true },
    { key: 'BUDGETS', label: 'Budgets', path: 'planning', iconName: 'target', mobile: true },
    { key: 'BALANCE_SHEET', label: 'Balance sheet', path: 'balance-sheet', iconName: 'scale', mobile: true },
    { key: 'REPORTS', label: 'Reports', path: 'reports', iconName: 'report', mobile: true },
    { key: 'FORECAST', label: 'Forecast', path: 'forecast', iconName: 'trending', mobile: true },
    { key: 'GIFTS', label: 'Gifts', path: 'gifts', iconName: 'gift', mobile: true },
    { key: 'DOCUMENTS', label: 'Documents', path: 'documents', iconName: 'file-text', mobile: true },
];

/** True when the section is shared with the signed-in user. */
export function hasFeature(key) {
    return !state.user?.features || state.user.features.includes(key);
}

/** Read-only users: no permission beyond viewing. */
export function readOnly() {
    return !!state.user && !state.user.permissions.some(p => p !== 'VIEW');
}

export function accountTypeLabel(type) {
    return state.options?.accountTypes.find(t => t.value === type)?.label || type;
}

// Balances change after any posting, so drop the cached accounts after every change.
onMutation(path => { if (!path.startsWith('/auth')) invalidateAccounts(); });
