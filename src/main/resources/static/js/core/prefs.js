/**
 * Per-browser preferences (localStorage, key "pb.<name>"), read safely: a blocked or empty storage
 * simply gives the defaults. Pages keep their own small preference objects here
 * (statement, expenses, chits) and Settings edits the same objects.
 */

export function getPref(name, defaults = {}) {
    try {
        const stored = JSON.parse(localStorage.getItem('pb.' + name) || 'null');
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...defaults, ...stored } : (stored ?? structuredClone(defaults));
    } catch {
        return structuredClone(defaults);
    }
}

export function setPref(name, value) {
    try { localStorage.setItem('pb.' + name, JSON.stringify(value)); } catch { /* storage unavailable: lasts for this page only */ }
}

export function clearPrefs() {
    try { Object.keys(localStorage).filter(k => k.startsWith('pb.') && k !== 'pb.token').forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
}

/** Dashboard panels: id, label, default width in 12ths and whether shown by default. */
export const DASHBOARD_WIDGETS = [
    { id: 'trend', label: 'Income vs expenses', span: 5, on: true },
    { id: 'networth', label: 'Net worth trend', span: 4, on: true },
    { id: 'mix', label: 'Spending mix', span: 3, on: true },
    { id: 'budgets', label: 'Budgets', span: 3, on: true },
    { id: 'upcoming', label: 'Coming up', span: 3, on: true },
    { id: 'recent', label: 'Recent activity', span: 3, on: true },
    { id: 'chits', label: 'Chits to maturity', span: 3, on: true },
    { id: 'accounts', label: 'Cash & cards', span: 3, on: false },
    { id: 'alloc', label: 'Where your money is', span: 3, on: false },
    { id: 'cashflow', label: 'This month cash flow', span: 3, on: false },
];
export const DASHBOARD_BANDS = [
    { id: 'kpis', label: 'Key figures (top row)', on: true },
    { id: 'insights', label: 'Health score & insights', on: true },
];

/** { order: [ids], hidden: [ids], spans: {id: n}, bands: {id: bool} } merged with the defaults. */
export function dashboardLayout() {
    const saved = getPref('dashboard', {});
    const known = DASHBOARD_WIDGETS.map(w => w.id);
    const order = [...(saved.order || []).filter(id => known.includes(id)), ...known.filter(id => !(saved.order || []).includes(id))];
    const hidden = saved.hidden || DASHBOARD_WIDGETS.filter(w => !w.on).map(w => w.id);
    const spans = { ...Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w.id, w.span])), ...(saved.spans || {}) };
    const bands = { ...Object.fromEntries(DASHBOARD_BANDS.map(b => [b.id, b.on])), ...(saved.bands || {}) };
    return { order, hidden, spans, bands };
}

export function saveDashboardLayout(layout) {
    setPref('dashboard', layout);
}
