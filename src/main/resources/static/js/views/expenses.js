/**
 * Expenses: everything that went out in a period. Quick period and type chips up front, more filters
 * (category, paid from, amount) on demand, and a smart search box that understands
 *   >500  <2000  500-2000   amount
 *   #groceries              category
 *   @hdfc                   paid from
 *   is:lent is:paid is:open is:overdue
 * and plain words for description, person, reference or notes. The list is flat by default; grouping by
 * day is a remembered switch. Each row expands in place:
 *   - an expense shows its details, notes and journal lines, with edit / duplicate / delete
 *   - money lent or paid for someone shows its lifecycle, repayments and month-by-month interest
 * The right pane holds the period summary, where the money went, the spending trend and who owes you.
 *
 * Lent, Paid for, To collect and You owe list every item still open, whatever the period (settled ones only when
 * they started in it); an expanded item scrolls on its own inside the list.
 *
 * EMIs lists everything bought on EMI (card or loan) that is still being paid, whatever the period, plus those finished
 * in it; an expanded plan shows where it stands, the money and every instalment, with pay, undo and pay off early.
 *
 * Routes: #/expenses, #/expenses/today (opens on today), #/expenses/collect (opens on "to collect"), #/expenses/emi[/<id>],
 * #/expenses/owe (money you borrowed and bills still to pay), #/expenses/claim/<id> (opens that lent / borrowed
 * item, wherever the link came from: this is where it is managed).
 */
import { api, newRequestKey } from '../core/api.js';
import { loadAccounts, can, categoriesOf, state } from '../core/store.js';
import { esc, panel, emptyState, toast, confirmDialog, accountOptions, categoryOptions, openModal, field, readForm, listTotalRow, totalsToggle } from '../core/ui.js';
import { icon, categoryIcon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, date, dateTime, shortDate, isoDate } from '../core/format.js';
import { barChart, donutChart, foldOthers, seriesColor } from '../core/charts.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { openEntryDetail } from '../components/transaction-forms.js';
import { showRoute, showPageRoute, routeHash, queryList, fromAddress } from '../core/route.js';
import { claimPanelHtml, bindClaimPanel, claimBadge } from '../components/claim-panel.js';
import { getPref, setPref } from '../core/prefs.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { evidenceBadge, evidenceFieldHtml, bindEvidenceField } from '../components/evidence.js';
import { exportButton, bindExport } from '../core/export.js';
import { openSubmissions } from '../components/submissions.js';
import { emiPanelHtml, bindEmiPanel, emiBadge, emiSideHtml } from '../components/emi.js';

/** Periods, in toolbar order; the first four are always visible, the rest sit behind "More". */
const PERIODS = {
    today: { label: 'Today', range: t => [t, t] },
    week: { label: 'This week', range: t => [addDays(t, -((t.getDay() + 6) % 7)), t] },
    month: { label: 'This month', range: t => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
    lastmonth: { label: 'Last month', range: t => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
    yesterday: { label: 'Yesterday', range: t => [addDays(t, -1), addDays(t, -1)] },
    lastweek: { label: 'Last week', range: t => { const s = addDays(t, -((t.getDay() + 6) % 7) - 7); return [s, addDays(s, 6)]; } },
    d90: { label: '3 months', range: t => [new Date(t.getFullYear(), t.getMonth() - 2, 1), t] },
    year: { label: 'This year', range: t => [new Date(t.getFullYear(), 0, 1), t] },
    custom: { label: 'Custom', range: () => [new Date(view.from + 'T00:00:00'), new Date(view.to + 'T00:00:00')] },
};
const QUICK_PERIODS = ['today', 'week', 'month', 'lastmonth'];

const TYPES = [
    { key: 'all', label: 'All' },
    { key: 'EXPENSE', label: 'Expenses', iconName: 'receipt' },
    { key: 'PAID_FOR', label: 'Paid for', iconName: 'users' },
    { key: 'LENT', label: 'Lent', iconName: 'hand' },
    { key: 'collect', label: 'To collect', iconName: 'clock' },
    { key: 'owe', label: 'You owe', iconName: 'card' },
    { key: 'emi', label: 'EMIs', iconName: 'calendar' },
];

/**
 * Filters, each a set (any of its values matches) or a single choice, ANDed together. Expense filters (categories,
 * expense status) and Paid for / Lent filters (kind, person, status, due, interest) each keep the other kind of item
 * out of the list once set; account and amount apply to both.
 */
const FILTERS = { cats: [], payers: [], xstatus: [], kinds: [], people: [], cstatus: [], due: '', interest: '', min: '', max: '' };

const view = {
    period: 'month', from: isoDate(), to: isoDate(), type: 'all', q: '',
    side: 'mix', open: null, morePeriods: false, moreFilters: false, ...structuredClone(FILTERS),
    collapsed: new Set(),   // expenses whose linked charges are folded away under them
};

function clearFilters() {
    Object.assign(view, structuredClone(FILTERS));
}

// ---- the address of the page: the tab as a segment, the period, filters and opened row in the query
const SLUG_OF_TYPE = { all: 'all', EXPENSE: 'spent', PAID_FOR: 'paid-for', LENT: 'lent', collect: 'collect', owe: 'owe', emi: 'emi' };
const TYPE_OF_SLUG = Object.fromEntries(Object.entries(SLUG_OF_TYPE).map(([type, slug]) => [slug, type]));
const LIST_FILTERS = ['cats', 'payers', 'xstatus', 'kinds', 'people', 'cstatus'];
const ONE_FILTERS = ['due', 'interest', 'min', 'max'];

/** Takes the tab, and (when the address has a query) the period, filters, search and opened row from the address. */
function readRoute(type, query) {
    view.type = type;
    if (!query?.toString()) return;
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    clearFilters();
    const period = query.get('period');
    view.period = PERIODS[period] ? period : 'month';
    if (view.period === 'custom') {
        if (isDate(query.get('from')) && isDate(query.get('to'))) { view.from = query.get('from'); view.to = query.get('to'); } else view.period = 'month';
    }
    LIST_FILTERS.forEach(k => { view[k] = queryList(query, k); });
    ONE_FILTERS.forEach(k => { view[k] = query.get(k) || ''; });
    view.q = query.get('q') || '';
    view.open = query.get('open') || null;
    view.moreFilters = query.get('filters') === '1';
}

/** The address of what the page shows now. */
function routeOfView() {
    const custom = view.period === 'custom';
    return routeHash(`expenses/${SLUG_OF_TYPE[view.type] || 'all'}`, {
        period: view.period === 'month' ? '' : view.period, from: custom ? view.from : '', to: custom ? view.to : '',
        q: view.q, ...Object.fromEntries(LIST_FILTERS.map(k => [k, view[k]])), ...Object.fromEntries(ONE_FILTERS.map(k => [k, view[k]])),
        open: view.open, filters: view.moreFilters,
    });
}

/** Adds a value to a filter set, or takes it out when it is in already. */
function toggleIn(list, value) {
    const v = String(value);
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1); else list.push(v);
}

/** What an expense can be, beyond its category: refunded, reversed, linked to other charges, with or without a bill. */
const EXPENSE_STATUS = [
    { key: 'refunded', label: 'Refunded', iconName: 'arrow-in', test: r => r.status === 'REFUNDED' },
    { key: 'partly', label: 'Part refunded', iconName: 'arrow-in', test: r => r.status === 'PARTLY_REFUNDED' },
    { key: 'reversed', label: 'Reversed', iconName: 'undo', test: r => r.status === 'REVERSED' },
    { key: 'charges', label: 'Has linked charges', iconName: 'link', test: r => r.raw?.linked?.length > 0 },
    { key: 'charge', label: 'Is a linked charge', iconName: 'split', test: r => Boolean(r.raw?.parentEntryId) },
    { key: 'evidence', label: 'With bill / proof', iconName: 'paperclip', test: r => r.raw?.attachmentCount > 0 },
    { key: 'noevidence', label: 'No bill yet', iconName: 'camera', test: r => !r.raw?.attachmentCount },
];
/** Where a lent / paid-for / borrowed item stands. */
const CLAIM_STATUS = [
    { key: 'open', label: 'Open', iconName: 'clock', test: c => c.status === 'OPEN' && !c.overdue },
    { key: 'partial', label: 'Part repaid', iconName: 'hourglass', test: c => c.status === 'PARTIAL' && !c.overdue },
    { key: 'overdue', label: 'Overdue', iconName: 'alert', test: c => c.overdue },
    { key: 'settled', label: 'Settled', iconName: 'check-circle', test: c => c.status === 'SETTLED' },
    { key: 'written', label: 'Written off', iconName: 'x', test: c => c.status === 'WRITTEN_OFF' },
];
const isOpenClaim = c => ['OPEN', 'PARTIAL'].includes(c.status);
const CLAIM_DUE = [
    { key: 'overdue', label: 'Past due', test: c => c.overdue },
    { key: 'week', label: 'Due in 7 days', test: c => isOpenClaim(c) && c.dueDate && !c.overdue && c.daysToDue <= 7 },
    { key: 'month', label: 'Due in 30 days', test: c => isOpenClaim(c) && c.dueDate && !c.overdue && c.daysToDue <= 30 },
    { key: 'none', label: 'No due date', test: c => !c.dueDate },
];
const CLAIM_INTEREST = [
    { key: 'with', label: 'With interest', test: c => Number(c.interestRate) > 0 },
    { key: 'free', label: 'Interest-free', test: c => !Number(c.interestRate) },
];
const AMOUNT_PRESETS = [['', '500', 'Under ₹500'], ['500', '2000', '₹500 – 2k'], ['2000', '10000', '₹2k – 10k'], ['10000', '', 'Over ₹10k']];

/** Which filters a list takes: expense filters on expenses (and EMIs), Paid for / Lent filters on those items. */
const takesExpenseFilters = type => ['all', 'EXPENSE', 'emi'].includes(type);
const takesClaimFilters = type => type === 'all' || CLAIM_VIEWS.includes(type);

function claimFiltersOn(type) {
    return takesClaimFilters(type) && Boolean(view.kinds.length || view.people.length || view.cstatus.length || view.due || view.interest);
}

/** The row test for a list: shared filters, then those of its own kind (the other kind's filters leave it out). */
function matchesFor(type, query) {
    const catsOn = takesExpenseFilters(type) && view.cats.length > 0;
    const statusOn = (type === 'all' || type === 'EXPENSE') && view.xstatus.length > 0;
    const claimsOn = claimFiltersOn(type);
    const statuses = EXPENSE_STATUS.filter(s => view.xstatus.includes(s.key));
    return r => {
        if (view.payers.length && !view.payers.includes(String(r.paidFromId))) return false;
        if (view.min !== '' && r.amount < Number(view.min)) return false;
        if (view.max !== '' && r.amount > Number(view.max)) return false;
        if (r.claim) {
            if (catsOn || statusOn) return false;
            if (claimsOn) {
                const c = r.claim;
                if (view.kinds.length && !view.kinds.includes(r.type)) return false;
                if (view.people.length && !view.people.includes((r.party || '').trim().toLowerCase())) return false;
                if (view.cstatus.length && !CLAIM_STATUS.filter(s => view.cstatus.includes(s.key)).some(s => s.test(c))) return false;
                if (view.due && !CLAIM_DUE.find(d => d.key === view.due)?.test(c)) return false;
                if (view.interest && !CLAIM_INTEREST.find(d => d.key === view.interest)?.test(c)) return false;
            }
        } else {
            if (claimsOn) return false;
            if (catsOn && !view.cats.includes(String(r.categoryId))) return false;
            if (statusOn && !statuses.some(s => s.test(r))) return false;
        }
        return queryMatches(r, query);
    };
}

const prefs = getPref('expenses', { grouped: false, sort: { key: 'date', dir: 'desc' } });
const savePrefs = () => setPref('expenses', prefs);

/** Smart search: pulls amount, #category, @account and is: tokens out of the text. */
export function parseQuery(q) {
    const out = { text: [], min: null, max: null, category: [], payer: [], is: [] };
    for (const token of (q || '').trim().split(/\s+/).filter(Boolean)) {
        let m;
        if ((m = token.match(/^>=?(\d+(?:\.\d+)?)k?$/i))) out.min = Number(m[1]) * (/k$/i.test(token) ? 1000 : 1);
        else if ((m = token.match(/^<=?(\d+(?:\.\d+)?)k?$/i))) out.max = Number(m[1]) * (/k$/i.test(token) ? 1000 : 1);
        else if ((m = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) { out.min = Number(m[1]); out.max = Number(m[2]); }
        else if (token.startsWith('#') && token.length > 1) out.category.push(token.slice(1).toLowerCase());
        else if (token.startsWith('@') && token.length > 1) out.payer.push(token.slice(1).toLowerCase());
        else if (/^is:\w+$/i.test(token)) out.is.push(token.slice(3).toLowerCase());
        else out.text.push(token.toLowerCase());
    }
    return out;
}

function queryMatches(r, q) {
    if (q.min !== null && r.amount < q.min) return false;
    if (q.max !== null && r.amount > q.max) return false;
    if (q.category.length && !q.category.some(c => (r.category || '').toLowerCase().includes(c))) return false;
    if (q.payer.length && !q.payer.some(p => (r.paidFrom || '').toLowerCase().includes(p))) return false;
    for (const flag of q.is) {
        if (flag === 'lent' && r.type !== 'LENT') return false;
        if ((flag === 'paid' || flag === 'paidfor') && r.type !== 'PAID_FOR') return false;
        if (flag === 'expense' && r.type !== 'EXPENSE') return false;
        if (flag === 'open' && !(r.claim && Number(r.claim.outstanding) > 0)) return false;
        if (flag === 'overdue' && !r.claim?.overdue) return false;
        if (flag === 'settled' && r.claim?.status !== 'SETTLED') return false;
        if (flag === 'refunded' && !['REFUNDED', 'PARTLY_REFUNDED'].includes(r.raw?.status)) return false;
        if (flag === 'reversed' && r.raw?.status !== 'REVERSED') return false;
        if ((flag === 'linked' || flag === 'fee') && !(r.raw?.linked?.length || r.raw?.parentEntryId)) return false;
    }
    const hay = [r.description, r.party, r.reference, r.category, r.entryNo, r.notes, r.paidFrom, r.raw?.parentEntryNo].filter(Boolean).join(' ').toLowerCase();
    return q.text.every(t => hay.includes(t));
}

export async function render(container, params, isCurrent) {
    if (params[0] === 'today') { view.period = 'today'; view.type = 'all'; }
    if (params[0] === 'collect') { view.type = 'collect'; }
    if (params[0] === 'owe') { view.type = 'owe'; }
    if (params[0] === 'emi') { view.type = 'emi'; if (params[1]) view.focusEmi = Number(params[1]); }
    if (params[0] === 'claim' && params[1]) { view.focusClaim = Number(params[1]); view.q = ''; }
    if (params[0] === 'emi-entry' && params[1]) view.focusEmiEntry = Number(params[1]);
    // a category over a period (#/expenses/category/<id>/<from>/<to>, from a report): just its expenses, those dates
    if (params[0] === 'category' && /^\d+$/.test(params[1] || '')) {
        clearFilters();
        Object.assign(view, { type: 'EXPENSE', q: '', cats: [params[1]], open: null });
        const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
        if (isDate(params[2]) && isDate(params[3])) Object.assign(view, { period: 'custom', from: params[2], to: params[3] });
    }
    // the address: #/expenses/<tab>?period=…&cats=…&people=…&open=… (see readRoute / writeRoute)
    const routed = fromAddress(params);
    if (TYPE_OF_SLUG[params[0]] && !(params[0] === 'emi' && params[1])) readRoute(TYPE_OF_SLUG[params[0]], params.query);
    // opened for an expense (#/expenses/entry/<id>): the month it is in, every type, no filters, that expense open
    if (params[0] === 'entry' && /^\d+$/.test(params[1] || '')) {
        const entry = await api.get(`/transactions/${params[1]}`).catch(() => null);
        if (!isCurrent()) return;
        if (entry) {
            const month = entry.entryDate.slice(0, 7);
            const end = isoDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
            if (month === isoDate().slice(0, 7)) view.period = 'month';
            else Object.assign(view, { period: 'custom', from: `${month}-01`, to: end < isoDate() ? end : isoDate() });
            Object.assign(view, { type: 'all', q: '', focusEntry: entry.id });
            clearFilters();
        }
    }

    const today = new Date(isoDate() + 'T00:00:00');
    const [fromD, toD] = PERIODS[view.period].range(today);
    const from = isoDate(fromD), to = isoDate(toD);
    view.from = from; view.to = to;
    const days = Math.round((toD - fromD) / 86400000) + 1;
    const prevTo = addDays(fromD, -1), prevFrom = addDays(fromD, -days);

    const waitsForApproval = !!state.user?.approval && !state.user?.linkId;
    const [rows, previous, budgets, claimData, accounts, expenseCategories, mine, emiBook] = await Promise.all([
        api.get('/expenses', { from, to }),
        api.get('/expenses', { from: isoDate(prevFrom), to: isoDate(prevTo) }),
        api.get('/budgets', { month: to.slice(0, 7) }),
        api.get('/claims'),
        loadAccounts(), categoriesOf('EXPENSE'),
        waitsForApproval ? api.get('/approvals/mine').catch(() => []) : Promise.resolve([]),
        api.get('/expenses/emis', view.emiClosed ? { closed: true } : {}).catch(() => ({ summary: null, plans: [] })),
    ]);
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    Object.assign(prefs, getPref('expenses', { grouped: false, sort: { key: 'date', dir: 'desc' } }));

    // ---- one list: expenses + money lent / paid for others (+ what was bought on EMI)
    const claimRows = claimData.claims.map(claimRow);
    // an expense entry that is an EMI's purchase or one of its instalments points at its plan
    const emiByEntry = new Map();
    emiBook.plans.forEach(pl => {
        if (pl.purchaseEntryId) emiByEntry.set(pl.purchaseEntryId, { plan: pl, what: 'purchase' });
        pl.installments.forEach(i => { if (i.journalEntryId) emiByEntry.set(i.journalEntryId, { plan: pl, what: `EMI ${i.seq}/${pl.months}` }); });
    });
    const emiRows = emiBook.plans.map(emiRow);
    const inPeriod = c => c.date >= from && c.date <= to;
    const isOpen = c => ['OPEN', 'PARTIAL'].includes(c.claim.status);   // principal or posted interest still owed
    // Lent / Paid for: every item still open, whatever its date, plus those settled that started in the period
    const all = {
        EXPENSE: rows.map(r => ({ ...expenseRow(r), emiOf: emiByEntry.get(r.entryId) || null })),
        PAID_FOR: claimRows.filter(c => c.type === 'PAID_FOR' && (isOpen(c) || inPeriod(c))),
        LENT: claimRows.filter(c => c.type === 'LENT' && (isOpen(c) || inPeriod(c))),
        collect: claimRows.filter(c => (c.type === 'LENT' || c.type === 'PAID_FOR') && isOpen(c)),
        // borrowed money and bills not yet paid off, whatever the period (posted interest still owed counts too)
        owe: claimRows.filter(c => (c.type === 'BORROWED' || c.type === 'BILL_DUE') && isOpen(c)),
        // every plan still being paid, whatever the period, and those finished that were bought in it
        // every plan not closed (finished ones until they are closed), and the closed ones when asked for
        emi: emiRows,
    };
    // "All" stays the period's picture: what went out in it
    all.all = [...all.EXPENSE, ...claimRows.filter(c => (c.type === 'LENT' || c.type === 'PAID_FOR') && inPeriod(c))];
    const openTypes = ['LENT', 'PAID_FOR', 'collect', 'owe', 'emi'];
    // lent / borrowed items only: an EMI row has no claim
    const olderOpen = CLAIM_VIEWS.includes(view.type) ? all[view.type].filter(c => c.claim && isOpen(c) && !inPeriod(c)).length : 0;
    view.periodFrom = from; view.periodTo = to;
    // opened from a link (journal, statement): show the item in its own list, even outside the period, expanded
    if (view.focusClaim) {
        const focus = claimRows.find(c => c.claim.id === view.focusClaim);
        if (focus) {
            const payable = focus.type === 'BORROWED' || focus.type === 'BILL_DUE';
            const open = ['OPEN', 'PARTIAL'].includes(focus.claim.status);
            view.type = payable ? 'owe' : open ? 'collect' : focus.type;
            if (!all[view.type].includes(focus)) all[view.type].push(focus);
            view.open = focus.key;
            clearFilters();
        }
        view.focusClaim = null;
    }
    if (view.focusEmiEntry) {   // an EMI's purchase or instalment opens its plan
        view.focusEmi = emiByEntry.get(view.focusEmiEntry)?.plan.id ?? null;
        view.focusEmiEntry = null;
    }
    if (view.focusEntry) {
        const focus = all.EXPENSE.find(r => r.raw.entryId === view.focusEntry);
        if (focus) { view.open = focus.key; view.flash = focus.key; }
        else if (emiByEntry.has(view.focusEntry)) view.focusEmi = emiByEntry.get(view.focusEntry).plan.id;
        view.focusEntry = null;
    }
    if (view.focusEmi) {
        const focus = emiRows.find(r => r.emi.id === view.focusEmi);
        if (focus) { view.type = 'emi'; if (!all.emi.includes(focus)) all.emi.push(focus); view.open = focus.key; clearFilters(); }
        view.focusEmi = null;
    }
    // a person who owes you is filtered by name, however it was typed
    view.people = view.people.map(p => p.trim().toLowerCase());
    const query = parseQuery(view.q);
    const list = sortRows(all[view.type].filter(matchesFor(view.type, query)));

    // ---- figures (expenses only, so lending never inflates spending)
    const expenses = all.EXPENSE.filter(matchesFor('EXPENSE', query));
    const total = sum(expenses);
    // the previous period under the same filters, so the change compares like with like
    const previousTotal = sum(previous.map(expenseRow).filter(matchesFor('EXPENSE', query)));
    const spendFiltered = expenses.length !== all.EXPENSE.length;
    const filteredTag = on => (on ? ` <span class="filtered-tag" title="Follows the filters of the list">${icon('filter')}filtered</span>` : '');
    const change = previousTotal ? ((total - previousTotal) / previousTotal) * 100 : null;
    const elapsed = Math.max(1, Math.min(days, Math.round((today - fromD) / 86400000) + 1));
    const dailyAverage = total / elapsed;
    const byCategory = groupSum(expenses, r => r.categoryId, r => r.category);
    const byPayer = groupSum(expenses, r => r.paidFromId, r => r.paidFrom, r => r.paidFromType);
    const singleMonth = from.slice(0, 7) === to.slice(0, 7);
    // who owes you, narrowed by the same filters as the list (person, status, account, amount, search)
    const collectShown = all.collect.filter(matchesFor('collect', query));
    const collectFiltered = collectShown.length !== all.collect.length;
    const s = collectFiltered ? { ...claimData.summary, outstanding: collectShown.reduce((t, r) => t + Number(r.claim.outstanding), 0),
        openCount: collectShown.length, overdueCount: collectShown.filter(r => r.claim.overdue).length } : claimData.summary;
    const chips = activeFilterChips({ accounts, expenseCategories, claimRows });
    const advancedCount = chips.length;
    const filtered = chips.some(c => c.applies) || Boolean(view.q);
    const periodHidden = !QUICK_PERIODS.includes(view.period);
    const queryChips = [
        query.min !== null ? `≥ ${moneyShort(query.min)}` : '', query.max !== null ? `≤ ${moneyShort(query.max)}` : '',
        ...query.category.map(c => `category: ${c}`), ...query.payer.map(p => `from: ${p}`), ...query.is.map(f => `is ${f}`),
    ].filter(Boolean);

    // the last side panel: who owes you, or (a tab beside it) the EMIs; EMIs first when nobody owes anything
    const hasEmis = emiBook.plans.some(pl => pl.status === 'ACTIVE' && !pl.archived);
    const sideTab = hasEmis && (view.owedTab === 'emi' || (!view.owedTab && !all.collect.length)) ? 'emi' : 'owed';
    container.innerHTML = `
    <div class="page expenses-page">
        <div class="page-toolbar glass xp-toolbar">
            <h2 class="page-title">${icon('receipt')} Expenses</h2>
            <div class="seg-chips" id="xp-periods">
                ${QUICK_PERIODS.map(key => `<button class="seg-chip ${view.period === key ? 'active' : ''}" data-period="${key}">${PERIODS[key].label}</button>`).join('')}
                ${periodHidden && !view.morePeriods ? `<button class="seg-chip active" data-period="${view.period}">${PERIODS[view.period].label}</button>` : ''}
                ${view.morePeriods ? Object.keys(PERIODS).filter(k => !QUICK_PERIODS.includes(k)).map(key =>
                    `<button class="seg-chip ${view.period === key ? 'active' : ''}" data-period="${key}">${PERIODS[key].label}</button>`).join('') : ''}
                <button class="seg-chip more" id="xp-more-periods" title="${view.morePeriods ? 'Fewer periods' : 'More periods'}">${icon(view.morePeriods ? 'chevron-left' : 'more')}</button>
            </div>
            <span class="xp-range ${view.period === 'custom' ? 'editing' : ''}">
                ${view.period === 'custom'
                    ? `<input type="date" id="xp-from" value="${from}" max="${isoDate()}"> – <input type="date" id="xp-to" value="${to}" max="${isoDate()}">`
                    : `${icon('calendar')} ${from === to ? date(from) : `${date(from)} – ${date(to)}`}`}
            </span>
            <span class="spacer"></span>
            <div class="search-box smart-search" title="Try: >500  <2k  500-2000  #groceries  @hdfc  is:lent  is:overdue">
                ${icon('search')}<input id="xp-search" value="${esc(view.q)}" placeholder="Search… try >500, #food, @hdfc, is:overdue" data-plain>
                ${view.q ? `<button class="btn ghost icon sm" id="xp-search-clear" title="Clear search">${icon('x')}</button>` : ''}
            </div>
            ${advancedCount || view.q || view.type !== 'all' || view.period !== 'month' ? `<button class="btn sm ghost" id="xp-clear-all" title="This month, all types, no search or filters">${icon('x')}Clear filters</button>` : ''}
            <button class="btn sm ${view.moreFilters || advancedCount ? 'active-filter' : ''}" id="xp-filters" title="More filters">${icon('filter')}Filters${advancedCount ? `<span class="count-dot">${advancedCount}</span>` : ''}</button>
            ${exportButton({ label: '' })}
            ${can('POST_TRANSACTIONS') ? `
                <button class="btn sm" id="xp-lend" title="Lent money or paid for someone">${icon('hand')}Lent / paid for</button>
                <button class="btn sm" id="xp-emi" title="Bought on EMI: a credit card EMI or a loan / finance EMI">${icon('calendar')}On EMI</button>
                <button class="btn primary" id="xp-add">${icon('plus')}Add expense <span class="kbd light">E</span></button>` : ''}
        </div>

        ${panel({ title: 'Transactions', iconName: 'list', cls: 'p-xp-list', bodyClass: 'flush',
                  sub: `${list.length} · ${money(sum(list))}`,
                  actions: `<div class="seg-chips sm" id="xp-types">${TYPES.map(t => `<button class="seg-chip ${view.type === t.key ? 'active' : ''}" data-type="${t.key}">
                        ${t.iconName ? icon(t.iconName) : ''}${t.label}<span class="count">${all[t.key].filter(matchesFor(t.key, query)).length}</span></button>`).join('')}</div>
                        <label class="switch" title="Group the list by day with daily totals"><input type="checkbox" id="xp-grouped" ${prefs.grouped ? 'checked' : ''}><span></span>By day</label>
                        ${totalsToggle()}`,
                  body: `
                    ${view.moreFilters ? filterPanelHtml({ rows: all.EXPENSE, claimRows, accounts, expenseCategories, emiRows }) : ''}
                    ${chips.length ? activeFiltersHtml(chips) : ''}
                    ${queryChips.length ? `<div class="xp-query">${icon('sparkles')}${queryChips.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}
                    ${submissionsBar(mine)}
                    ${openTypes.includes(view.type) ? `<div class="xp-open-note">${icon('clock')}<span>${view.type === 'emi'
                        ? `Every EMI not closed, whatever the period${emiBook.summary ? ` · ${money(emiBook.summary.outstanding)} still owed` : ''}</span>
                            <label class="switch sm" title="Closed EMIs are put away; show them to look back or re-open one"><input type="checkbox" id="xp-emi-closed" ${view.emiClosed ? 'checked' : ''}><span></span>Show closed${emiBook.summary?.closed ? ` (${emiBook.summary.closed})` : ''}</label><span hidden>`
                        : ['collect', 'owe'].includes(view.type)
                        ? 'Every open item, whatever the period'
                        : `Every open item, whatever the period${olderOpen ? ` (${olderOpen} from before ${date(from)})` : ''}, plus those settled in this period`}</span></div>` : ''}
                    <div class="scroll xp-list" id="xp-list">${tableHtml(list, filtered)}</div>` })}

        <div class="xp-side">
            ${panel({ title: 'Summary', iconName: 'pie', cls: 'p-xp-summary', sub: PERIODS[view.period].label + filteredTag(spendFiltered || collectFiltered),
                      body: summaryHtml({ total, change, days, expenses, dailyAverage, today, budgets, singleMonth, byCategory, s, to }) })}
            ${panel({ title: view.side === 'payer' ? 'Paid from' : 'Where it went', iconName: view.side === 'payer' ? 'wallet' : 'pie', cls: 'p-xp-cat', sub: filteredTag(spendFiltered),
                      bodyClass: view.side === 'mix' ? 'chart' : '',
                      actions: `<div class="seg-chips sm" id="xp-side-tabs">
                          <button class="seg-chip ${view.side === 'mix' ? 'active' : ''}" data-side="mix" title="Category mix">${icon('pie')}</button>
                          <button class="seg-chip ${view.side === 'category' ? 'active' : ''}" data-side="category">Category</button>
                          <button class="seg-chip ${view.side === 'payer' ? 'active' : ''}" data-side="payer">Paid from</button></div>`,
                      body: view.side === 'mix' ? (byCategory.length ? '<div class="xp-donut"><div class="chart" id="xp-donut"></div><div class="xp-donut-legend scroll" id="xp-donut-legend"></div></div>' : emptyState('Nothing spent yet', 'pie'))
                          : view.side === 'category' ? categoryBars(byCategory, budgets, total, singleMonth) : payerList(byPayer, total) })}
            ${panel({ title: days > 62 ? 'Monthly spending' : 'Daily spending', iconName: 'calendar', cls: 'p-xp-daily', bodyClass: 'chart', sub: filteredTag(spendFiltered),
                      body: expenses.length ? '<div class="chart" id="xp-daily"></div>' : emptyState('No expenses') })}
            ${panel({ title: sideTab === 'emi' ? 'EMIs' : 'Owed to you', iconName: sideTab === 'emi' ? 'calendar' : 'hand', cls: 'p-xp-owed',
                      sub: sideTab === 'emi' ? (emiBook.summary ? `${moneyShort(emiBook.summary.outstanding)} owed` : '') : money(s.outstanding) + filteredTag(collectFiltered),
                      actions: hasEmis ? `<div class="seg-chips sm" id="xp-owed-tabs">
                          <button class="seg-chip ${sideTab === 'owed' ? 'active' : ''}" data-owed-tab="owed" title="Who owes you">${icon('hand')}</button>
                          <button class="seg-chip ${sideTab === 'emi' ? 'active' : ''}" data-owed-tab="emi" title="Your EMIs">${icon('calendar')}EMIs</button></div>` : '',
                      body: sideTab === 'emi' ? emiSideHtml(emiBook) : owedList(collectShown) })}
        </div>
    </div>`;

    drawTrend(container.querySelector('#xp-daily'), expenses, fromD, toD, days);
    if (view.side === 'mix' && byCategory.length) {
        const items = foldOthers(byCategory.map(c => ({ label: c.label, value: c.value, key: c.key })));
        donutChart(container.querySelector('#xp-donut'), { items, format: v => money(v), centerValue: moneyShort(total), centerLabel: 'spent' });
        container.querySelector('#xp-donut-legend').innerHTML = items.map((it, i) => `
            <button class="legend-row ${view.cats.includes(String(it.key)) ? 'active' : ''}" ${it.key ? `data-filter-category="${it.key}"` : ''} title="Filter by ${esc(it.label)}">
                <i class="legend-swatch" style="background:${seriesColor(i)}"></i><span class="ellipsis">${esc(it.label)}</span>
                <small>${percent((it.value / (total || 1)) * 100, 0)}</small><b>${moneyShort(it.value)}</b></button>`).join('');
    }

    // ---- toolbar & filters
    const on = (sel, evt, fn) => container.querySelector(sel)?.addEventListener(evt, fn);
    on('#xp-add', 'click', () => openExpenseDialog({ onSaved: reload }));
    on('[data-my-subs]', 'click', () => openSubmissions({ onChanged: reload }));
    on('#xp-lend', 'click', () => openExpenseDialog({ mode: 'PAID_FOR', onSaved: reload }));
    on('#xp-emi', 'click', () => openExpenseDialog({ mode: 'EMI', onSaved: () => { view.type = 'emi'; reload(); } }));
    on('#xp-owed-tabs', 'click', e => {
        const b = e.target.closest('[data-owed-tab]');
        if (b) { e.stopPropagation(); view.owedTab = b.dataset.owedTab; reload(); }
    });
    on('.p-xp-owed', 'click', e => {
        const plan = e.target.closest('[data-emi-plan]');
        if (plan) { view.type = 'emi'; view.open = `m${plan.dataset.emiPlan}`; reload(); return; }
        if (e.target.closest('[data-emi-open]')) { view.type = 'emi'; view.open = null; reload(); }
    });
    on('[data-summary-collect]', 'click', () => { view.type = view.type === 'collect' ? 'all' : 'collect'; reload(); });
    on('#xp-periods', 'click', e => {
        if (e.target.closest('#xp-more-periods')) { view.morePeriods = !view.morePeriods; reload(); return; }
        const b = e.target.closest('[data-period]');
        if (b) { view.period = b.dataset.period; reload(); }
    });
    on('#xp-from', 'change', e => { view.from = e.target.value; reload(); });
    on('#xp-to', 'change', e => { view.to = e.target.value; reload(); });
    on('#xp-types', 'click', e => {
        const b = e.target.closest('[data-type]');
        if (b) { view.type = b.dataset.type; view.open = null; reload(); }
    });
    on('#xp-emi-closed', 'change', e => { view.emiClosed = e.target.checked; reload(); });
    on('#xp-grouped', 'change', e => { prefs.grouped = e.target.checked; savePrefs(); reload(); });
    on('#xp-filters', 'click', () => { view.moreFilters = !view.moreFilters; reload(); });
    on('#xp-side-tabs', 'click', e => {
        const b = e.target.closest('[data-side]');
        if (b) { view.side = b.dataset.side; reload(); }
    });
    // the filter panel: a chip adds its value to a set (or picks the one choice), the amounts set a range
    on('.xp-fpanel', 'click', e => {
        const chip = e.target.closest('[data-f]');
        if (chip) {
            const { f, v } = chip.dataset;
            if (Array.isArray(view[f])) toggleIn(view[f], v); else view[f] = view[f] === v ? '' : v;
            reload();
            return;
        }
        const preset = e.target.closest('[data-amount]');
        if (preset) {
            const [min, max] = preset.dataset.amount.split('-');
            const same = view.min === min && view.max === max;
            view.min = same ? '' : min; view.max = same ? '' : max;
            reload();
            return;
        }
        const all = e.target.closest('[data-f-all]');
        if (all) { view[all.dataset.fAll] = []; reload(); return; }
        const more = e.target.closest('[data-f-more]');
        if (more) { view.allCategories = !view.allCategories; reload(); }
    });
    on('.xp-fpanel', 'input', e => {
        // narrows the chips of a group as you type, without a reload
        if (!e.target.matches('[data-f-search]')) return;
        const text = e.target.value.trim().toLowerCase();
        e.target.closest('.xf-group').querySelectorAll('.xf-chip').forEach(c => { c.hidden = text && !c.textContent.toLowerCase().includes(text); });
    });
    on('#xp-min', 'change', e => { view.min = e.target.value; reload(); });
    on('#xp-max', 'change', e => { view.max = e.target.value; reload(); });
    on('.xp-active', 'click', e => {
        const pill = e.target.closest('[data-unfilter]');
        if (pill) { chips.find(c => c.id === pill.dataset.unfilter)?.clear(); reload(); return; }
        if (e.target.closest('[data-unfilter-all]')) { clearFilters(); reload(); }
    });
    on('#xp-search-clear', 'click', () => { view.q = ''; reload(); });
    on('#xp-clear-all', 'click', () => {
        Object.assign(view, { period: 'month', type: 'all', q: '', open: null, moreFilters: false });
        clearFilters();
        reload();
    });
    let timer;
    on('#xp-search', 'input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { view.q = e.target.value.trim(); view.focusSearch = true; reload(); }, 350);
    });
    on('.p-xp-summary', 'click', e => {
        const cat = e.target.closest('[data-filter-category]');
        if (cat) { toggleIn(view.cats, cat.dataset.filterCategory); reload(); }
        if (e.target.closest('[data-summary-charges]')) { toggleIn(view.xstatus, 'charge'); reload(); }
    });
    on('.p-xp-cat', 'click', e => {
        const row = e.target.closest('[data-filter-category], [data-filter-payer]');
        if (!row) return;
        if (row.dataset.filterCategory) toggleIn(view.cats, row.dataset.filterCategory);
        if (row.dataset.filterPayer) toggleIn(view.payers, row.dataset.filterPayer);
        reload();
    });
    on('.p-xp-owed', 'click', e => {
        const row = e.target.closest('[data-person]');
        if (row) { view.type = 'collect'; view.people = [row.dataset.person.trim().toLowerCase()]; reload(); }
    });
    bindExport(container.querySelector('.xp-toolbar'), () => ({
        title: `Expenses · ${TYPES.find(t => t.key === view.type)?.label || 'All'}`,
        subtitle: `${date(from)} – ${date(to)}${view.q ? ` · search "${view.q}"` : ''}`,
        filename: `expenses-${from}-to-${to}`,
        summary: [['Spent', total], ['Items', list.length, 'number'], ['Daily average', Math.round(dailyAverage)],
            ...(byCategory[0] ? [['Top category', `${byCategory[0].label} · ${money(byCategory[0].value)}`]] : [])],
        sheets: [
            { name: 'Transactions', columns: [{ label: 'Date', type: 'date' }, { label: 'Kind' }, { label: 'Category' }, { label: 'Description' },
                { label: 'Shop / person' }, { label: 'Paid from' }, { label: 'Reference' }, { label: 'Notes' }, { label: 'Charge of' }, { label: 'Amount', type: 'money' }, { label: 'Outstanding', type: 'money' }],
              rows: list.map(r => [r.date, r.typeLabel, r.claim ? '' : r.category, r.description, r.party || '', r.paidFrom || '', r.reference || '',
                  r.notes || '', r.raw?.parentEntryNo || '', r.amount, r.claim ? Number(r.claim.outstanding) : '']),
              totals: ['Total', '', '', '', '', '', '', '', '', sum(list), ''] },
            { name: 'By category', columns: [{ label: 'Category' }, { label: 'Items', type: 'number' }, { label: 'Spent', type: 'money' }, { label: 'Share', type: 'percent' }],
              rows: byCategory.map(c => [c.label, c.count, c.value, total ? (c.value / total) * 100 : 0]),
              totals: ['Total', expenses.length, total, 100] },
        ],
    }));

    // ---- rows: click expands in place
    const listEl = container.querySelector('#xp-list');
    listEl.addEventListener('click', async e => {
        const head = e.target.closest('th[data-sort]');
        if (head) {
            const cur = prefs.sort || { key: 'date', dir: 'desc' };
            const key = head.dataset.sort;
            prefs.sort = { key, dir: cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : key === 'date' || key === 'amount' ? 'desc' : 'asc' };
            savePrefs();
            reload();
            return;
        }
        // folds an expense's charges away under it, or shows them again (no reload: the rows are there)
        const fold = e.target.closest('[data-xl-fold]');
        if (fold) {
            e.stopPropagation();
            const id = Number(fold.dataset.xlFold);
            const folded = !view.collapsed.has(id);
            if (folded) view.collapsed.add(id); else view.collapsed.delete(id);
            fold.classList.toggle('open', !folded);
            listEl.querySelectorAll(`tr[data-parent="${id}"]`).forEach(tr => {
                tr.classList.toggle('xl-folded', folded);
                if (folded && tr.nextElementSibling?.classList.contains('detail-row')) { tr.nextElementSibling.remove(); tr.classList.remove('expanded'); }
            });
            return;
        }
        const fc = e.target.closest('[data-row-filter-category]'), fp = e.target.closest('[data-row-filter-payer]');
        if (fc || fp) {
            e.stopPropagation();
            if (fc) toggleIn(view.cats, fc.dataset.rowFilterCategory);
            if (fp) toggleIn(view.payers, fp.dataset.rowFilterPayer);
            reload();
            return;
        }
        const action = e.target.closest('[data-xp-action]');
        if (action) {
            e.stopPropagation();
            const r = list.find(x => x.key === action.dataset.key);
            try {
                if (action.dataset.xpAction === 'edit') openExpenseDialog({ expense: r.raw, onSaved: reload });
                if (action.dataset.xpAction === 'copy') openExpenseDialog({ expense: r.raw, copy: true, onSaved: reload });
                if (action.dataset.xpAction === 'journal') location.hash = '#/transactions';
                if (action.dataset.xpAction === 'emi-plan') { view.type = 'emi'; view.open = `m${action.dataset.plan}`; reload(); }
                if (action.dataset.xpAction === 'refund') openRefundDialog(r, reload);
                if (action.dataset.xpAction === 'reverse') openReverseDialog(r, reload);
                if (action.dataset.xpAction === 'add-charge') openChargeDialog(r, { accounts, expenseCategories, onSaved: (saved, { keepOpen = false } = {}) => {
                    view.open = r.key;
                    view.collapsed.delete(r.raw.entryId);
                    if (!keepOpen) toast(`${saved.entryNo} linked to ${r.raw.entryNo}`);
                    reload();
                } });
                // ---- a charge, from a cost breakdown: edit, refund, unlink, delete; link existing expenses, move a charge
                const charge = action.dataset.entry ? all.EXPENSE.find(x => x.raw.entryId === Number(action.dataset.entry)) : null;
                const chargeId = Number(action.dataset.entry);
                if (action.dataset.xpAction === 'charge-edit') {
                    if (charge) openExpenseDialog({ expense: charge.raw, onSaved: reload }); else openEntryDetail(chargeId, { onChanged: reload });
                }
                if (action.dataset.xpAction === 'charge-refund') {
                    if (charge) openRefundDialog(charge, reload); else openEntryDetail(chargeId, { onChanged: reload });
                }
                if (action.dataset.xpAction === 'charge-unlink') {
                    const what = charge?.raw || (r.raw.entryId === chargeId ? r.raw : r.raw.linked?.find(l => l.entryId === chargeId));
                    if (await confirmDialog(`Unlink ${what?.entryNo || 'this charge'}? It stays as an expense on its own; nothing in the books changes.`,
                        { title: 'Unlink charge', confirmLabel: 'Unlink', danger: false })) {
                        await api.put(`/expenses/${chargeId}/link`, { parentId: null });
                        toast(`${what?.entryNo || 'Charge'} unlinked`);
                        reload();
                    }
                }
                if (action.dataset.xpAction === 'charge-delete') {
                    const what = charge?.raw || r.raw.linked?.find(l => l.entryId === chargeId);
                    if (await confirmDialog(`Delete the charge ${what?.entryNo || ''} (${money(what?.netAmount ?? what?.amount ?? 0)})? The expense it came with stays.`)) {
                        await api.del(`/expenses/${chargeId}`);
                        toast(`${what?.entryNo || 'Charge'} deleted`);
                        reload();
                    }
                }
                if (action.dataset.xpAction === 'link-existing') openLinkPicker(r, 'attach', reload);
                if (action.dataset.xpAction === 'move-charge') openLinkPicker(r, 'move', reload);
                if (action.dataset.xpAction === 'paid-for') openPaidForDialog(r, claimRows, claim => { view.focusClaim = claim.id; reload(); });
                if (action.dataset.xpAction === 'open-linked') {
                    const entryId = Number(action.dataset.entry);
                    const target = all.EXPENSE.find(x => x.raw.entryId === entryId);
                    const tr = target && listEl.querySelector(`tr[data-key="${target.key}"]`);
                    if (tr?.classList.contains('xl-folded')) listEl.querySelector(`[data-xl-fold="${tr.dataset.parent}"]`)?.click();   // unfold its group first
                    if (tr) {
                        await toggleRow(tr, list.find(x => x.key === target.key));
                        tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        tr.classList.add('flash');
                        setTimeout(() => tr.classList.remove('flash'), 2600);
                    }
                    else openEntryDetail(entryId, { onChanged: reload });   // outside this period or filtered out
                }
                if (action.dataset.xpAction === 'open-refund') openEntryDetail(Number(action.dataset.entry), { onChanged: reload });
                if (action.dataset.xpAction === 'undo-refund') {
                    const f = r.raw.refunds.find(x => String(x.entryId) === action.dataset.refund);
                    if (f && await confirmDialog(`Undo the ${f.reversal ? 'reversal' : 'refund'} of ${money(f.amount)} (${f.entryNo})? The expense counts again.`)) {
                        await api.del(`/expenses/${r.raw.entryId}/refunds/${f.entryId}`);
                        toast(`${f.entryNo} undone`);
                        reload();
                    }
                }
                if (action.dataset.xpAction === 'delete' && await confirmDialog(`Delete "${r.description}" (${money(r.amount)})?${r.raw.parentEntryId ? ` It is a charge of ${r.raw.parentEntryNo}; that expense stays.` : ''}`)) {
                    await api.del(`/expenses/${r.raw.entryId}`);
                    toast('Expense deleted');
                    reload();
                }
            } catch (error) { toast(error.message, 'error'); }
            return;
        }
        const tr = e.target.closest('tr[data-key]');
        if (!tr || e.target.closest('.detail-row')) return;
        toggleRow(tr, list.find(x => x.key === tr.dataset.key));
    });

    async function toggleRow(tr, r) {
        const next = tr.nextElementSibling;
        listEl.querySelectorAll('tr.detail-row').forEach(d => d.remove());
        listEl.querySelectorAll('tr.expanded').forEach(d => d.classList.remove('expanded'));
        if (next?.classList.contains('detail-row')) { view.open = null; showRoute(routeOfView()); return; }
        view.open = r.key;
        showRoute(routeOfView());
        tr.classList.add('expanded');
        const detail = document.createElement('tr');
        detail.className = 'detail-row';
        detail.innerHTML = `<td colspan="${tr.children.length}">${r.emi ? emiPanelHtml(r.emi) : r.claim ? claimPanelHtml(r.claim, { scroll: true }) : await expenseDetail(r, { rows: all.EXPENSE, budgets, accounts, month: to.slice(0, 7),
            monthLabel: new Date(to + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' }) })}</td>`;
        tr.after(detail);
        if (r.emi) bindEmiPanel(detail, r.emi, { onChanged: reload, onEdit: p => openExpenseDialog({ emi: p, onSaved: reload }) });
        if (r.claim) {
            bindClaimPanel(detail, r.claim, { onChanged: reload });   // Edit opens the matching lend / borrow form
            fitPanel(listEl, tr, detail);
        }
    }

    // ↑ / ↓ move through the rows, Enter expands, ← / → step through the quick periods
    const cursor = () => listEl.querySelector('tr.xp-tr.cursor') || listEl.querySelector('tr.xp-tr.expanded');
    const nav = listNavigator({
        items: () => [...listEl.querySelectorAll('tr.xp-tr')],
        selected: cursor,
        select: el => { listEl.querySelectorAll('tr.cursor').forEach(x => x.classList.remove('cursor')); el.classList.add('cursor'); },
        open: el => toggleRow(el, list.find(x => x.key === el.dataset.key)),
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) {
            const keys = Object.keys(PERIODS).filter(k => k !== 'custom');
            const i = keys.indexOf(view.period) + (e.key === 'ArrowRight' ? 1 : -1);
            if (i >= 0 && i < keys.length) { view.period = keys[i]; reload(); }
            return true;
        }
        return false;
    });

    // keep the previously opened row open after a reload (e.g. after recording a repayment)
    const reopen = view.open && listEl.querySelector(`tr[data-key="${view.open}"]`);
    if (reopen) {
        const flash = view.flash === view.open;   // opened from a link elsewhere: show where it is
        view.flash = null;
        toggleRow(reopen, list.find(x => x.key === view.open)).then(() => {
            if (!reopen.classList.contains('is-claim')) reopen.scrollIntoView({ block: flash ? 'center' : 'nearest', behavior: flash ? 'smooth' : 'auto' });
            if (flash) { reopen.classList.add('flash'); setTimeout(() => reopen.classList.remove('flash'), 2600); }
        });
    } else view.open = null;

    if (view.focusSearch) {
        const search = container.querySelector('#xp-search');
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
        view.focusSearch = false;
    }
    // another tab or period is a step in the history; a filter, the search or an opened row only updates the address
    showPageRoute('expenses', routeOfView(), `${view.type}|${view.period}|${view.from}|${view.to}`, { routed });
}

/**
 * An expanded lent / borrowed item scrolls on its own: the row goes to the top of the list and its panel gets the
 * rest of the list's height, so everything is one scroll away and the list itself does not jump around.
 */
function fitPanel(listEl, tr, detail) {
    const panelEl = detail.querySelector('.claim-panel.in-row');
    if (!panelEl) return;
    const head = listEl.querySelector('thead')?.offsetHeight || 0;
    const room = listEl.clientHeight - head - tr.offsetHeight - 14;
    panelEl.style.setProperty('--claim-max', `${Math.max(280, room)}px`);
    const below = tr.getBoundingClientRect().top - listEl.getBoundingClientRect().top - head;   // the sticky header stays on top
    listEl.scrollTo({ top: Math.max(0, listEl.scrollTop + below), behavior: 'smooth' });
}

/** For a user whose expenses wait for approval: what is waiting and what was sent back. */
function submissionsBar(mine) {
    const waiting = mine.filter(p => p.status === 'PENDING').length;
    const back = mine.filter(p => p.status === 'REJECTED').length;
    if (!waiting && !back) return '';
    return `<button type="button" class="xp-subs-bar ${back ? 'has-rejected' : ''}" data-my-subs title="What you sent for approval">
        ${icon(back ? 'alert' : 'hourglass')}<span>${back ? `<b>${back} sent back</b> to correct · ` : ''}${waiting} waiting for approval</span>
        <span class="spacer"></span><span class="link-btn">${back ? 'Correct now' : 'View'}</span></button>`;
}

// ===================================================================== filters

const fchip = (f, v, label, { on = false, count, iconHtml = '', title = '' } = {}) => `
    <button type="button" class="xf-chip ${on ? 'on' : ''}" data-f="${f}" data-v="${esc(v)}" ${title ? `title="${esc(title)}"` : ''}>
        ${iconHtml}<span class="ellipsis">${esc(label)}</span>${count !== undefined ? `<small>${count}</small>` : ''}${on ? `<i class="xf-tick">${icon('check')}</i>` : ''}</button>`;

/** How many rows and how much per key, biggest first. */
function tally(rows, keyOf) {
    const map = new Map();
    rows.forEach(r => {
        const k = keyOf(r);
        if (k === null || k === undefined || k === '') return;
        const t = map.get(k) || { count: 0, total: 0 };
        t.count++; t.total += Number(r.amount) || 0;
        map.set(k, t);
    });
    return map;
}

/**
 * The filter panel, in groups: what the money was (categories, expense status), where it came from and how much,
 * and, on its own, Paid for / Lent (kind, person, where it stands, due, interest). A list shows only the groups that
 * apply to it; each chip says how many items it would match in the period.
 */
function filterPanelHtml({ rows, claimRows, accounts, expenseCategories, emiRows }) {
    const expenseSide = takesExpenseFilters(view.type);
    const claimSide = takesClaimFilters(view.type);
    const payable = view.type === 'owe';
    const group = (title, iconName, body, { cls = '', tools = '' } = {}) => `
        <section class="xf-group ${cls}"><header>${icon(iconName)}<b>${title}</b>${tools}</header><div class="xf-chips">${body}</div></section>`;

    // categories with spend in the period first; the rest on demand; chosen ones always
    const byCat = tally(rows, r => String(r.categoryId));
    const cats = expenseCategories
        .map(c => ({ c, t: byCat.get(String(c.id)), on: view.cats.includes(String(c.id)) }))
        .filter(x => x.t || x.on || view.allCategories)
        .sort((a, b) => (b.t?.total || 0) - (a.t?.total || 0) || a.c.name.localeCompare(b.c.name));
    const catChips = cats.map(({ c, t, on }) => {
        const ci = categoryIcon(c.name);
        return fchip('cats', c.id, c.name, { on, count: t ? t.count : 0, title: t ? `${t.count} · ${money(t.total)}` : 'Nothing in this period',
            iconHtml: `<span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span>` });
    }).join('');
    const hiddenCats = expenseCategories.length - cats.length;

    // accounts that paid for something in the period (or are chosen)
    const used = tally([...rows, ...claimRows, ...emiRows], r => String(r.paidFromId));
    const payers = accounts.filter(a => used.has(String(a.id)) || view.payers.includes(String(a.id)))
        .sort((a, b) => (used.get(String(b.id))?.total || 0) - (used.get(String(a.id))?.total || 0));
    const payerChips = payers.map(a => fchip('payers', a.id, a.name, { on: view.payers.includes(String(a.id)),
        count: used.get(String(a.id))?.count || 0, iconHtml: icon(accountTypeIcon(a.accountType).name) })).join('');

    const amount = `
        <span class="xp-amounts">${icon('cash')}<input type="number" id="xp-min" placeholder="Min ₹" value="${esc(view.min)}" data-plain>–<input type="number" id="xp-max" placeholder="Max ₹" value="${esc(view.max)}" data-plain></span>
        ${AMOUNT_PRESETS.map(([min, max, label]) => `<button type="button" class="xf-chip ${view.min === min && view.max === max ? 'on' : ''}" data-amount="${min}-${max}">${label}</button>`).join('')}`;

    const statusChips = EXPENSE_STATUS.map(s => fchip('xstatus', s.key, s.label, { on: view.xstatus.includes(s.key),
        count: rows.filter(s.test).length, iconHtml: icon(s.iconName) })).join('');

    // ---- Paid for / Lent (or, in "You owe", borrowed and bills)
    const kinds = payable ? ['BORROWED', 'BILL_DUE'] : ['PAID_FOR', 'LENT'];
    const items = claimRows.filter(r => kinds.includes(r.type));
    const kindChips = kinds.map(k => fchip('kinds', k, CLAIM_KIND[k][2], { on: view.kinds.includes(k),
        count: items.filter(r => r.type === k && (isOpenClaim(r.claim) || r.date >= view.periodFrom)).length,
        iconHtml: `<span class="chip-icon xs ${CLAIM_KIND[k][0]}">${icon(CLAIM_KIND[k][1])}</span>` })).join('');
    const people = new Map();
    items.forEach(r => {
        const key = (r.party || '').trim().toLowerCase();
        if (!key) return;
        const p = people.get(key) || { name: r.party.trim(), count: 0, owed: 0 };
        p.count++; p.owed += isOpenClaim(r.claim) ? Number(r.claim.outstanding) : 0;
        people.set(key, p);
    });
    const peopleChips = [...people.entries()].sort((a, b) => b[1].owed - a[1].owed || a[1].name.localeCompare(b[1].name))
        .map(([key, p]) => fchip('people', key, p.name, { on: view.people.includes(key), count: p.count,
            title: p.owed ? `${money(p.owed)} still owed` : 'Nothing owed now', iconHtml: `<span class="avatar xs">${esc(initials(p.name))}</span>` })).join('');
    const cstatusChips = CLAIM_STATUS.map(s => fchip('cstatus', s.key, s.label, { on: view.cstatus.includes(s.key),
        count: items.filter(r => s.test(r.claim)).length, iconHtml: icon(s.iconName) })).join('');
    const dueChips = CLAIM_DUE.map(d => fchip('due', d.key, d.label, { on: view.due === d.key, count: items.filter(r => d.test(r.claim)).length })).join('');
    const interestChips = CLAIM_INTEREST.map(d => fchip('interest', d.key, d.label, { on: view.interest === d.key, count: items.filter(r => d.test(r.claim)).length })).join('');

    const search = `<input class="xf-search" data-f-search placeholder="Find…" data-plain>`;
    const clear = key => view[key].length ? `<button type="button" class="link-btn" data-f-all="${key}">Clear</button>` : '';
    return `
    <div class="xp-fpanel">
        ${expenseSide ? `<div class="xf-side">
            <div class="xf-side-head">${icon('receipt')}Expenses</div>
            ${group('Category', 'tag', catChips || '<span class="muted small">Nothing spent in this period</span>', { cls: 'wide',
                tools: `<small class="muted">${view.cats.length ? `${view.cats.length} chosen` : 'any'}</small>${search}${clear('cats')}
                    ${hiddenCats > 0 || view.allCategories ? `<button type="button" class="link-btn" data-f-more>${view.allCategories ? 'Only with spend' : `+${hiddenCats} more`}</button>` : ''}` })}
            ${view.type !== 'emi' ? group('Status', 'flag', statusChips, { tools: clear('xstatus') }) : ''}
        </div>` : ''}
        ${claimSide ? `<div class="xf-side claims">
            <div class="xf-side-head">${icon(payable ? 'card' : 'hand')}${payable ? 'Borrowed &amp; bills' : 'Paid for &amp; lent'}</div>
            ${group('Kind', 'layers', kindChips, { tools: clear('kinds') })}
            ${group(payable ? 'Lender / payee' : 'Person', 'users', peopleChips || '<span class="muted small">Nobody yet</span>', { cls: 'wide', tools: `${search}${clear('people')}` })}
            ${group('Where it stands', 'clock', cstatusChips, { tools: clear('cstatus') })}
            <div class="xf-pair">${group('Due', 'calendar', dueChips)}${group('Interest', 'percent', interestChips)}</div>
        </div>` : ''}
        <div class="xf-side shared">
            <div class="xf-side-head">${icon('wallet')}For both</div>
            ${group('Paid from / into', 'wallet', payerChips || '<span class="muted small">No account used yet</span>', { cls: 'wide', tools: clear('payers') })}
            ${group('Amount', 'cash', amount)}
        </div>
    </div>`;
}

/** Every filter in force, as a removable pill; one that does not apply to the list shown is dimmed. */
function activeFilterChips({ accounts, expenseCategories, claimRows }) {
    const chips = [];
    const expenseUse = takesExpenseFilters(view.type), claimUse = takesClaimFilters(view.type);
    const add = (id, label, iconName, applies, clear) => chips.push({ id, label, iconName, applies, clear });
    const drop = (key, v) => () => { view[key] = view[key].filter(x => x !== v); };
    view.cats.forEach(id => add(`cats:${id}`, expenseCategories.find(c => String(c.id) === id)?.name || 'Uncategorised', 'tag', expenseUse, drop('cats', id)));
    view.xstatus.forEach(k => add(`xstatus:${k}`, EXPENSE_STATUS.find(s => s.key === k)?.label || k, 'flag', ['all', 'EXPENSE'].includes(view.type), drop('xstatus', k)));
    view.kinds.forEach(k => add(`kinds:${k}`, CLAIM_KIND[k]?.[2] || k, CLAIM_KIND[k]?.[1] || 'hand', claimUse, drop('kinds', k)));
    view.people.forEach(p => add(`people:${p}`, claimRows.find(r => (r.party || '').trim().toLowerCase() === p)?.party || p, 'user', claimUse, drop('people', p)));
    view.cstatus.forEach(k => add(`cstatus:${k}`, CLAIM_STATUS.find(s => s.key === k)?.label || k, 'clock', claimUse, drop('cstatus', k)));
    if (view.due) add('due', CLAIM_DUE.find(d => d.key === view.due)?.label || view.due, 'calendar', claimUse, () => { view.due = ''; });
    if (view.interest) add('interest', CLAIM_INTEREST.find(d => d.key === view.interest)?.label || view.interest, 'percent', claimUse, () => { view.interest = ''; });
    view.payers.forEach(id => add(`payers:${id}`, accounts.find(a => String(a.id) === id)?.name || 'Account', 'wallet', true, drop('payers', id)));
    if (view.min !== '' || view.max !== '') {
        add('amount', view.min !== '' && view.max !== '' ? `${moneyShort(view.min)} – ${moneyShort(view.max)}` : view.min !== '' ? `≥ ${moneyShort(view.min)}` : `≤ ${moneyShort(view.max)}`,
            'cash', true, () => { view.min = ''; view.max = ''; });
    }
    return chips;
}

function activeFiltersHtml(chips) {
    return `<div class="xp-active">${icon('filter')}
        ${chips.map(c => `<button type="button" class="xf-pill ${c.applies ? '' : 'idle'}" data-unfilter="${esc(c.id)}"
            title="${c.applies ? 'Remove this filter' : 'Not used in this list · remove'}">${icon(c.iconName)}<span class="ellipsis">${esc(c.label)}</span>${icon('x')}</button>`).join('')}
        ${chips.length > 1 ? '<button type="button" class="link-btn" data-unfilter-all>Clear all</button>' : ''}</div>`;
}

/** The period at a glance: spend and its change, budget use, pace, top category and money to collect. */
function summaryHtml({ total, change, days, expenses, dailyAverage, today, budgets, singleMonth, byCategory, s, to }) {
    const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const budgetUsed = singleMonth && Number(budgets.totalLimit) ? Number(budgets.usedPercent) : null;
    const top = byCategory[0];
    return `
    <div class="xp-summary">
        <div class="xs-hero">
            <span class="label">Spent</span>
            <b>${money(total)}</b>
            <small>${change === null ? `${expenses.length} expenses` : `<span class="${change <= 0 ? 'pos' : 'neg'}">${change > 0 ? '▲' : '▼'} ${percent(Math.abs(change), 0)}</span> vs previous ${days === 1 ? 'day' : `${days} days`}`}</small>
        </div>
        <div class="xs-grid">
            <div><span>Daily average</span><b>${money(Math.round(dailyAverage))}</b><small>${view.period === 'month' ? `pace ${moneyShort(dailyAverage * monthDays)} / month` : `${expenses.length} expenses`}</small></div>
            ${budgetUsed !== null
                ? `<div><span>Budget used</span><b class="${budgetUsed > 100 ? 'neg' : ''}">${percent(budgetUsed, 0)}</b>
                    <i class="xs-bar ${budgetUsed > 100 ? 'over' : budgetUsed > 80 ? 'warn' : ''}"><em style="width:${Math.min(100, budgetUsed)}%"></em></i>
                    <small>${moneyShort(budgets.totalSpent)} of ${moneyShort(budgets.totalLimit)}</small></div>`
                : `<div><span>Average expense</span><b>${money(Math.round(expenses.length ? total / expenses.length : 0))}</b><small>per item</small></div>`}
            <div class="clickable" ${top ? `data-filter-category="${top.key}"` : ''} title="Filter by this category"><span>Top category</span><b class="ellipsis">${esc(top?.label || '—')}</b>
                <small>${top ? `${moneyShort(top.value)} · ${percent((top.value / (total || 1)) * 100, 0)}` : ''}</small></div>
            <div class="clickable ${view.type === 'collect' ? 'active' : ''}" data-summary-collect title="Show what others owe you"><span>To collect</span><b class="aqua-ink">${moneyShort(s.outstanding)}</b>
                <small>${s.openCount} open${s.overdueCount ? ` · <span class="neg">${s.overdueCount} overdue</span>` : ''}</small></div>
        </div>
        ${chargesLine(expenses, total)}
    </div>`;
}

/** Fees, taxes and tips paid on top of expenses in the period, and what share of the spending they are. */
function chargesLine(expenses, total) {
    const charges = expenses.filter(r => r.raw?.parentEntryId);
    if (!charges.length) return '';
    const sumCharges = charges.reduce((s, r) => s + r.amount, 0);
    const on = new Set(charges.map(r => r.raw.parentEntryId)).size;
    const active = view.xstatus.includes('charge');
    return `<button type="button" class="xs-charges ${active ? 'active' : ''}" data-summary-charges title="${active ? 'Show everything again' : 'Show only the linked charges'}">
        ${icon('link')}<span>Charges &amp; fees</span><b class="mono">${money(sumCharges)}</b>
        <small class="muted">${charges.length} on ${on} expense${on === 1 ? '' : 's'} · ${percent(total ? (sumCharges / total) * 100 : 0, 1)} of spend</small></button>`;
}

// ===================================================================== rows

function expenseRow(r) {
    return {
        key: `x${r.entryId}-${r.categoryId}`, sortId: r.entryId, type: 'EXPENSE', typeLabel: 'Expense', raw: r,
        date: r.date, entryNo: r.entryNo, category: r.categoryName, categoryId: r.categoryId,
        description: r.narration, party: r.party, reference: r.reference, notes: r.memo,
        paidFrom: r.paidFrom, paidFromId: r.paidFromId, paidFromType: r.paidFromType,
        // what the expense costs now: the original less refunds (0 once reversed)
        amount: Number(r.netAmount ?? r.amount), gross: Number(r.amount), status: r.status,
    };
}

/** Something bought on EMI, as a row of the EMIs list. */
function emiRow(p) {
    return {
        key: `m${p.id}`, sortId: p.purchaseEntryId || p.id, type: 'EMI', typeLabel: p.kind === 'CARD' ? 'Card EMI' : 'Loan EMI', emi: p,
        date: p.purchaseDate, entryNo: p.purchaseEntryNo, category: p.categoryName, categoryId: p.categoryId, description: p.narration, party: p.party,
        reference: p.reference, notes: p.notes, paidFrom: p.payAccountName, paidFromId: p.payAccountId, paidFromType: p.payAccountType,
        amount: Number(p.principal), owed: Number(p.outstanding),
    };
}

/** Refunded / reversed marker for an expense row. */
const STATUS_META = {
    REVERSED: { label: 'Reversed', tone: 'gray', iconName: 'undo' },
    REFUNDED: { label: 'Refunded', tone: 'aqua', iconName: 'arrow-in' },
    PARTLY_REFUNDED: { label: 'Part refunded', tone: 'aqua', iconName: 'arrow-in' },
};

/** What came back on an expense or a charge, as a pill: how much (or that it was reversed), each refund in its title. */
function refundPill(status, back, refunds = []) {
    const meta = status ? STATUS_META[status] : null;
    if (!meta) return '';
    const label = status === 'REVERSED' ? 'Reversed' : status === 'REFUNDED' ? 'Refunded' : `${moneyShort(back)} back`;
    const lines = (refunds || []).map(f => `${f.reversal ? 'Reversal' : 'Refund'} ${money(f.amount)} · ${date(f.date)} · ${f.entryNo}${f.accountName ? ` · ${f.reversal ? 'back to' : 'into'} ${f.accountName}` : ''}`);
    const head = status === 'REVERSED' ? 'Reversed: counts for nothing' : `${meta.label}: ${money(back)} came back`;
    return `<span class="xr-pill ${meta.tone}" title="${esc([head, ...lines].join('\n'))}">${icon(meta.iconName)}${esc(label)}</span>`;
}

function claimRow(c) {
    return {
        key: `c${c.id}`, sortId: c.journalEntryId || 0, type: c.kind, typeLabel: c.kindLabel, claim: c,
        date: c.startDate, entryNo: c.entryNo, category: c.kindLabel, categoryId: null,
        description: c.narration, party: c.party, reference: c.reference, notes: c.notes,
        paidFrom: c.paidFromAccount, paidFromId: c.paidFromAccountId, paidFromType: c.paidFromType, amount: Number(c.amount),
    };
}

/** Sortable columns: what each one sorts by. Date sorts newest first by default, the rest A–Z / smallest first. */
const STATUS_RANK = { OVERDUE: 0, OPEN: 1, PARTIAL: 2, SETTLED: 3, WRITTEN_OFF: 4 };
const SORTS = {
    date: r => r.date, category: r => (r.category || '').toLowerCase(), description: r => (r.description || '').toLowerCase(),
    paidFrom: r => (r.paidFrom || '').toLowerCase(), amount: r => r.amount,
    // lent / borrowed lists
    person: r => (r.party || '').toLowerCase(), type: r => (r.typeLabel || '').toLowerCase(),
    status: r => r.claim ? (r.claim.overdue ? 0 : STATUS_RANK[r.claim.status] ?? 9) : 9,
    owed: r => r.claim ? Number(r.claim.outstanding) : r.emi ? Number(r.emi.outstanding) : 0,
    next: r => r.emi?.next?.dueDate || '9999',
};

/** Lists of money lent, paid for someone, to collect or owed: their own columns and words. */
const CLAIM_VIEWS = ['LENT', 'PAID_FOR', 'collect', 'owe'];
const claimWords = () => view.type === 'owe'
    ? { date: 'Borrowed on', person: 'Lender / purpose', account: 'Received into', amount: 'Borrowed', owed: 'Still to pay' }
    : { date: view.type === 'PAID_FOR' ? 'Paid on' : view.type === 'LENT' ? 'Lent on' : 'Given on', person: view.type === 'PAID_FOR' ? 'Paid for / what' : 'Borrower / purpose',
        account: 'Paid from', amount: view.type === 'PAID_FOR' ? 'Paid' : 'Given', owed: 'Still owed' };

export function sortRows(rows, sort = prefs.sort) {
    const key = SORTS[sort?.key] ? sort.key : 'date';
    const dir = sort?.dir === 'asc' ? 1 : -1;
    const of = SORTS[key];
    return [...rows].sort((a, b) => {
        const x = of(a), y = of(b);
        const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        return c * dir || b.date.localeCompare(a.date) || b.sortId - a.sortId;
    });
}

function th(key, label, cls) {
    const sort = prefs.sort || { key: 'date', dir: 'desc' };
    const on = sort.key === key;
    return `<th class="${cls} sortable ${on ? 'sorted' : ''}" data-sort="${key}" title="Sort by ${label.toLowerCase()}${on ? ` (${sort.dir === 'asc' ? 'ascending' : 'descending'})` : ''}">
        <span>${label}</span>${on ? `<i class="sort-arrow">${sort.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
}

function tableHtml(rows, filtered = false) {
    if (!rows.length) return emptyState(view.type === 'collect' ? 'Nobody owes you anything right now.'
        : view.type === 'owe' ? 'You owe nobody right now. Press B to record money borrowed or a bill to pay later.'
        : view.type === 'emi' ? 'Nothing on EMI. Add an expense and pick “On EMI”: a card EMI or a loan from a finance company.'
        : 'Nothing for this selection. Press E to add an expense.', 'receipt');
    const grouped = prefs.grouped;
    if (view.type === 'emi') return emiTableHtml(rows, filtered);
    const claims = CLAIM_VIEWS.includes(view.type);
    const w = claimWords();
    const heads = claims
        ? [grouped ? '' : th('date', w.date, 'c-date'), th('person', w.person, 'c-desc'), view.type === 'owe' ? th('type', 'Type', 'c-type') : '', th('status', 'Status', 'c-status'),
            th('paidFrom', w.account, 'c-pay'), th('amount', w.amount, 'r c-amt'), th('owed', w.owed, 'r c-owed')]
        : [grouped ? '' : th('date', 'Date', 'c-date'), th('category', 'Category', 'c-cat'), th('description', 'Description', 'c-desc'),
            th('paidFrom', 'Paid from', 'c-pay'), th('amount', 'Amount', 'r c-amt')];
    const head = `<thead><tr>${heads.join('')}<th class="c-caret"></th></tr></thead>`;
    const cols = heads.filter(Boolean).length + 1;
    const cls = `grid xp-table ${claims ? 'xp-claims' : 'xp-expenses'}`;
    const line = r => (claims ? claimRowHtml(r, !grouped) : rowHtml(r, !grouped));
    // the total of what is listed, as the last line: amount (and, for lent / borrowed, what is still owed)
    const owed = rows.reduce((s, r) => s + (r.claim && isOpenClaim(r.claim) ? Number(r.claim.outstanding) : 0), 0);
    const foot = `<tfoot>${listTotalRow({ count: rows.length, span: cols - (claims ? 3 : 2), filtered,
        totals: [money(sum(rows)), ...(claims ? [owed ? `<span class="neg">${money(owed)}</span>` : '—'] : [])] })}</tfoot>`;
    if (!grouped) return `<table class="${cls}">${head}<tbody>${nestLinked(rows).map(line).join('')}</tbody>${foot}</table>`;
    const days = new Map();
    [...rows].sort((a, b) => b.date.localeCompare(a.date)).forEach(r => { if (!days.has(r.date)) days.set(r.date, []); });
    rows.forEach(r => days.get(r.date).push(r));   // days newest first, each day in the chosen order
    const body = [...days.entries()].map(([day, items]) => `
        <tr class="day-row"><td colspan="${cols}"><div class="day-head-inner">
            <span class="day-date"><b>${date(day)}</b> <span class="muted">${dayName(day)}</span></span>
            <span class="muted">${items.length} item${items.length > 1 ? 's' : ''}</span>
            <span class="spacer"></span><b class="mono">${money(sum(items))}</b></div></td></tr>
        ${nestLinked(items).map(line).join('')}`).join('');
    return `<table class="${cls}">${head}<tbody>${body}</tbody>${foot}</table>`;
}

/**
 * Puts each linked charge right under the expense it came with, whatever the sort, marked as the middle or last
 * branch so the rows draw as a small tree. A charge whose expense is not in the list stays where it is.
 */
function nestLinked(rows) {
    const shown = new Map(rows.filter(r => r.raw).map(r => [r.raw.entryId, r]));
    const children = new Map();
    rows.forEach(r => {
        const parent = r.raw?.parentEntryId;
        if (parent && shown.has(parent)) children.set(parent, [...(children.get(parent) || []), r]);
    });
    if (!children.size) return rows;
    const out = [];
    rows.forEach(r => {
        if (r.raw?.parentEntryId && shown.has(r.raw.parentEntryId)) return;   // drawn with its expense
        const kids = (children.get(r.raw?.entryId) || []).sort((a, b) => a.date.localeCompare(b.date) || a.sortId - b.sortId);
        out.push(kids.length ? { ...r, kidsShown: kids.length } : r);
        kids.forEach((k, i) => out.push({ ...k, nested: i === kids.length - 1 ? 'last' : 'mid', parentRow: r }));
    });
    return out;
}

/** What kind of charge a linked expense is, from the start of its description (as the Add charge dialog writes it). */
function chargeKind(narration) {
    const text = (narration || '').toLowerCase();
    return CHARGE_KINDS.find(k => text.startsWith(k.label.toLowerCase()) || k.words.some(w => text.includes(w)))
        || { label: 'Charge', short: 'Charge', iconName: 'link', tone: 'violet' };
}

/** A charge's description without " · <the expense it came with>": under its expense that part goes without saying. */
function chargeTitle(narration, parentNarration) {
    const suffix = ` · ${parentNarration || ''}`;
    return parentNarration && narration?.endsWith(suffix) ? narration.slice(0, -suffix.length) : narration;
}

/**
 * The link marks of an expense row. An expense with charges: a chip with how many and how much, which folds them away
 * under it (or shows them again). A charge drawn away from its expense: a chip naming the expense, which opens it.
 */
function linkFlags(r) {
    const e = r.raw;
    if (!e) return '';
    if (e.linked?.length) {
        const extra = e.linked.reduce((s, l) => s + Number(l.netAmount), 0);
        const back = e.linked.reduce((s, l) => s + Number(l.refunded || 0), 0);
        const folded = view.collapsed.has(e.entryId);
        const tip = `${e.linked.length} linked charge${e.linked.length === 1 ? '' : 's'}: ${e.linked.map(l => `${chargeTitle(l.narration, e.narration)} ${money(l.netAmount)}${Number(l.refunded) ? ` (${money(l.refunded)} refunded)` : ''}`).join(', ')} · all-in ${money(r.amount + extra)}`;
        const backMark = back ? `<i class="xl-chip-back" title="${esc(`${money(back)} came back on the charges`)}">${icon('arrow-in')}</i>` : '';
        return r.kidsShown
            ? `<button type="button" class="xl-chip ${folded ? '' : 'open'}" data-xl-fold="${e.entryId}" title="${esc(`${tip} · click to ${folded ? 'show' : 'fold'} them`)}">
                ${icon('link')}<b>${e.linked.length}</b><span>+${moneyShort(extra)}</span>${backMark}${icon('chevron-down')}</button>`
            : `<span class="xl-chip" title="${esc(`${tip} (not in this list)`)}">${icon('link')}<b>${e.linked.length}</b><span>+${moneyShort(extra)}</span>${backMark}</span>`;
    }
    if (e.parentEntryId && !r.nested) {
        return `<button type="button" class="xl-chip child" data-xp-action="open-linked" data-entry="${e.parentEntryId}" data-key="${r.key}"
            title="${esc(`A charge of ${e.parentNarration} (${e.parentEntryNo}) · open it`)}">${icon('split')}<span class="ellipsis">${esc(e.parentEntryNo)}</span></button>`;
    }
    return '';
}

/** The EMIs list: what and from where, its progress and next EMI, the instalment, the price and what is still owed. */
function emiTableHtml(rows, filtered) {
    const head = `<thead><tr>${th('date', 'Bought on', 'c-date')}${th('description', 'What / lender', 'c-desc')}<th class="c-prog">Progress</th>
        ${th('next', 'Next EMI', 'c-status')}${th('paidFrom', 'Billed to / paid from', 'c-pay')}${th('amount', 'Price', 'r c-amt')}${th('owed', 'Still owed', 'r c-owed')}<th class="c-caret"></th></tr></thead>`;
    return `<table class="grid xp-table xp-claims xp-emis">${head}<tbody>${rows.map(r => {
        const p = r.emi;
        const payer = accountTypeIcon(r.paidFromType);
        const next = p.next;
        return `<tr class="xp-tr is-claim ${p.archived ? 'emi-archived' : ''}" data-key="${r.key}">
            <td class="c-date"><b>${date(r.date)}</b></td>
            <td class="c-desc"><div class="xd-cell xd-stack"><span class="xd-text"><span class="chip-icon xs ${p.kind === 'CARD' ? 'coral' : 'violet'}" title="${esc(r.typeLabel)}">${icon(p.kind === 'CARD' ? 'card' : 'briefcase')}</span>
                <b class="ellipsis" title="${esc(r.description)}">${esc(r.description)}</b>
                ${Number(p.ratePercent) ? `<span class="xd-rate" title="${Number(p.ratePercent)}% a year">${Number(p.ratePercent)}%</span>` : '<span class="xd-rate" title="No interest">0%</span>'}
                ${p.autoPost && p.status === 'ACTIVE' ? `<span class="xp-ico" title="Each EMI books itself on its due date">${icon('repeat')}</span>` : ''}</span>
                <span class="xd-party" title="${esc(p.lender || '')}">${esc([p.lender, r.party].filter(Boolean).join(' · ') || r.category)}</span></div></td>
            <td class="c-prog"><div class="xd-prog"><span>${p.paidCount}/${p.months} · ${money(Number(p.emiAmount))}/mo</span><i class="xd-bar"><em style="width:${p.progressPercent}%"></em></i></div></td>
            <td class="c-status"><div class="xd-status">${emiBadge(p)}${next && p.status === 'ACTIVE' ? `<span class="xd-due ${next.overdue ? 'neg' : ''}" title="EMI ${next.seq}: ${money(Number(next.emi) + Number(next.gst))}">${next.overdue ? 'was ' : ''}${shortDate(next.dueDate)}</span>` : ''}</div></td>
            <td class="c-pay">${r.paidFrom ? `<span class="xd-payer">${icon(payer.name)}<span class="ellipsis">${esc(r.paidFrom)}</span></span>` : '<span class="muted">—</span>'}</td>
            <td class="r c-amt"><b class="mono claim-amt">${money(r.amount)}</b></td>
            <td class="r c-owed" title="${money(p.stillToPay)} still to pay with interest">${Number(p.outstanding) ? `<b class="mono neg">${money(p.outstanding)}</b>` : '<span class="muted">paid off</span>'}</td>
            <td class="c-caret"><span class="expand-caret">${icon('chevron-down')}</span></td></tr>`;
    }).join('')}</tbody><tfoot>${listTotalRow({ count: rows.length, span: 5, filtered, noun: 'plan',
        totals: [money(sum(rows)), `<span class="neg">${money(rows.reduce((s, r) => s + Number(r.emi.outstanding || 0), 0))}</span>`] })}</tfoot></table>`;
}

const CLAIM_KIND = { LENT: ['violet', 'hand', 'Lent'], PAID_FOR: ['aqua', 'users', 'Paid for'], BORROWED: ['coral', 'arrow-in', 'Borrowed'],
    BILL_DUE: ['gold', 'receipt', 'Bill to pay'] };

/**
 * One row, one line: date · category (or lent / borrowed) · description with the shop or person grayed on the
 * right · the account it was paid from · amount. Category and account are links that filter the list.
 */
function rowHtml(r, withDate) {
    const payer = accountTypeIcon(r.paidFromType);
    let category;
    if (r.claim) {
        const k = CLAIM_KIND[r.type] || ['aqua', 'users', r.typeLabel];
        category = `<span class="chip-icon xs ${k[0]}">${icon(k[1])}</span><span class="ellipsis">${k[2]}</span>`;
    } else {
        const cat = categoryIcon(r.category);
        category = `<span class="chip-icon xs ${cat.tone}">${icon(cat.name)}</span><button type="button" class="xd-link ellipsis" data-row-filter-category="${r.categoryId}"
            title="Show only ${esc(r.category)}">${esc(r.category)}</button>`;
    }
    const party = r.party ? (r.claim ? `${{ LENT: 'to', PAID_FOR: 'for', BORROWED: 'from', BILL_DUE: 'owed to' }[r.type] || ''} ${esc(r.party)}` : esc(r.party)) : '';
    const owed = r.claim && Number(r.claim.outstanding) > 0;
    const old = r.claim && view.periodFrom && r.date < view.periodFrom;
    const extra = r.raw?.linked?.length ? r.raw.linked.reduce((s, l) => s + Number(l.netAmount), 0) : 0;
    const chargesBack = r.raw?.linked?.length ? r.raw.linked.reduce((s, l) => s + Number(l.refunded || 0), 0) : 0;
    // a charge under its expense: its kind, a shorter title and its share of the expense instead of the shop
    const kind = r.nested ? chargeKind(r.description) : null;
    const parentAmount = r.parentRow?.amount || 0;
    const title = r.nested ? chargeTitle(r.description, r.raw.parentNarration) : r.description;
    const partyHtml = r.nested
        ? `<span class="xd-party xl-share" title="Of ${esc(r.raw.parentNarration)} (${esc(r.raw.parentEntryNo)})">${parentAmount ? `${percent(r.amount / parentAmount * 100, 1)} of ` : 'on '}${esc(r.raw.parentEntryNo)}</span>`
        : party ? `<span class="xd-party" title="${r.claim ? 'Person' : 'Paid to'}: ${esc(r.party)}">${party}</span>` : '';
    const folded = r.nested && view.collapsed.has(r.raw.parentEntryId);
    return `
    <tr class="xp-tr ${r.claim ? 'is-claim' : ''} ${r.status ? `xp-${r.status.toLowerCase().replace('_', '-')}` : ''} ${r.nested ? `xp-child nest-${r.nested}` : ''} ${r.kidsShown ? 'xp-parent' : ''} ${folded ? 'xl-folded' : ''}"
        data-key="${r.key}" ${r.nested ? `data-parent="${r.raw.parentEntryId}"` : ''}>
        ${withDate ? `<td class="c-date ${old ? 'old' : ''}" title="${old ? `Before the selected period, still open · ${ageOf(r.date)}` : dayName(r.date)}"><b>${date(r.date)}</b>${old ? icon('clock') : ''}</td>` : ''}
        <td class="c-cat"><div class="xd-cat">${category}</div></td>
        <td class="c-desc"><div class="xd-cell">
            <span class="xd-text">${kind ? `<span class="xl-kind ${kind.tone}" title="${esc(kind.label)}">${icon(kind.iconName)}${esc(kind.short)}</span>` : ''}<b class="ellipsis" title="${esc(r.description)}">${esc(title)}</b>${evidenceBadge(r.raw?.attachmentCount)}
                ${refundPill(r.status, r.gross - r.amount, r.raw?.refunds)}
                ${r.claim ? claimBadge(r.claim) : ''}
                ${linkFlags(r)}
                ${r.emiOf ?`<span class="mini-flag aqua emi" title="${esc(`${r.emiOf.what === 'purchase' ? 'Bought on EMI' : `Interest of ${r.emiOf.what}`} · ${r.emiOf.plan.narration}`)}">${icon('calendar')}${r.emiOf.what === 'purchase' ? 'EMI' : esc(r.emiOf.what.replace('EMI ', ''))}</span>` : ''}
                ${r.reference ? `<span class="xp-ico" title="Reference: ${esc(r.reference)}">${icon('tag')}</span>` : ''}
                ${r.notes ? `<span class="xp-ico" title="${esc(r.notes)}">${icon('info')}</span>` : ''}</span>
            ${partyHtml}</div></td>
        <td class="c-pay">${r.paidFrom ? `<button type="button" class="xd-link xd-payer" data-row-filter-payer="${r.paidFromId}"
            title="${r.type === 'BORROWED' ? 'Into' : 'Paid from'} ${esc(r.paidFrom)} · show only this account">${icon(payer.name)}<span class="ellipsis">${esc(r.paidFrom)}</span></button>` : '<span class="muted">—</span>'}</td>
        <td class="r c-amt" ${owed ? `title="${money(Math.round(Number(r.claim.settlementAmount)))} payable now with interest"` : ''}>${r.status ? `<s class="muted small mono" title="Original amount">${money(r.gross)}</s> ` : ''}<b class="mono ${r.claim ? 'claim-amt' : r.status === 'REVERSED' ? 'muted' : r.nested ? 'xl-amt' : 'neg'}">${r.nested ? '+' : ''}${money(r.amount)}</b>${extra
            ? `<span class="xl-allin" title="${money(r.amount)} + charges ${money(extra)}${chargesBack ? ` (after ${money(chargesBack)} refunded on them)` : ''}">all-in ${money(r.amount + extra)}</span>` : ''}</td>
        <td class="c-caret"><span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}

/**
 * A lent / paid-for / borrowed item: when, who and what for, the kind, where it stands (with the due date),
 * the account, what was given and what is still owed.
 */
function claimRowHtml(r, withDate) {
    const c = r.claim;
    const k = CLAIM_KIND[r.type] || ['aqua', 'users', r.typeLabel];
    const payer = accountTypeIcon(r.paidFromType);
    const old = view.periodFrom && r.date < view.periodFrom;
    const open = c.status === 'OPEN' || c.status === 'PARTIAL';
    const due = !open || !c.dueDate ? '' : c.overdue ? `<span class="xd-due neg" title="Was due ${date(c.dueDate)}">${Math.abs(c.daysToDue)}d late</span>`
        : `<span class="xd-due" title="Due date">due ${shortDate(c.dueDate)}</span>`;
    const interest = Number(c.interestDue);
    return `
    <tr class="xp-tr is-claim" data-key="${r.key}">
        ${withDate ? `<td class="c-date ${old ? 'old' : ''}" title="${old ? `Before the selected period, still open · ${ageOf(r.date)}` : dayName(r.date)}"><b>${date(r.date)}</b>${old ? icon('clock') : ''}</td>` : ''}
        <td class="c-desc"><div class="xd-cell">
            <span class="xd-text">${view.type === 'owe' ? '' : `<span class="chip-icon xs ${k[0]}" title="${k[2]}">${icon(k[1])}</span>`}<b class="ellipsis" title="${esc(r.party || '')}">${esc(r.party || '—')}</b>${evidenceBadge(c.attachmentCount)}
                ${c.interestRate ? `<span class="xd-rate" title="${Number(c.interestRate)}% a year, ${esc((c.interestTypeLabel || '').toLowerCase())}">${Number(c.interestRate)}%</span>` : ''}
                ${r.notes ? `<span class="xp-ico" title="${esc(r.notes)}">${icon('info')}</span>` : ''}</span>
            <span class="xd-party" title="${esc(r.description)}">${esc(r.description)}</span></div></td>
        ${view.type === 'owe' ? `<td class="c-type"><div class="xd-cat"><span class="chip-icon xs ${k[0]}">${icon(k[1])}</span><span class="ellipsis">${k[2]}</span></div></td>` : ''}
        <td class="c-status"><div class="xd-status">${claimBadge(c)}${due}</div></td>
        <td class="c-pay">${r.paidFrom ? `<button type="button" class="xd-link xd-payer" data-row-filter-payer="${r.paidFromId}"
            title="${w(r)} ${esc(r.paidFrom)} · show only this account">${icon(payer.name)}<span class="ellipsis">${esc(r.paidFrom)}</span></button>` : '<span class="muted">—</span>'}</td>
        <td class="r c-amt"><b class="mono claim-amt">${money(r.amount)}</b></td>
        <td class="r c-owed" title="${open ? `${money(c.outstanding)} principal${interest ? ` + ${money(Math.round(interest))} interest = ${money(Math.round(Number(c.settlementAmount)))} payable now` : ''}` : 'Nothing owed'}">
            ${open ? `<b class="mono neg">${money(c.outstanding)}</b>${interest >= 1 ? `<span class="xd-int">+${moneyShort(interest)}</span>` : ''}` : '<span class="muted">settled</span>'}</td>
        <td class="c-caret"><span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}
const w = r => (r.type === 'BORROWED' ? 'Into' : 'Paid from');

/**
 * An expense, opened in place and kept short: one line of facts with the actions on the right, then three
 * small cards side by side (the posting, the category against its budget, the shop / person and the account),
 * notes, refunds and evidence below only when there are any.
 */
async function expenseDetail(r, ctx = {}) {
    const e = r.raw;
    const manage = can('POST_TRANSACTIONS');
    // the entry and, for its refunds shown in full, each refund's own entry
    const [entry, ...refundEntries] = await Promise.all([api.get(`/transactions/${e.entryId}`),
        ...(e.refunds || []).map(f => api.get(`/transactions/${f.entryId}`).catch(() => null))]);
    const refundEntry = new Map((e.refunds || []).map((f, i) => [f.entryId, refundEntries[i]]));
    const rows = ctx.rows || [];
    // the category in the month of the budget shown, and this shop / person within the period
    const line = ctx.budgets?.lines?.find(l => l.categoryId === e.categoryId);
    const inBudgetMonth = ctx.budgets && e.date.slice(0, 7) === ctx.month;
    const sameCat = rows.filter(x => x.categoryId === e.categoryId);
    const party = (e.party || '').trim().toLowerCase();
    const samePlace = party ? rows.filter(x => (x.party || '').trim().toLowerCase() === party) : [];
    const account = ctx.accounts?.find(a => a.id === e.paidFromId);
    const spentCat = sameCat.reduce((s, x) => s + x.amount, 0);
    const limit = line && line.monthlyLimit !== null ? Number(line.monthlyLimit) : null;
    const used = limit && inBudgetMonth ? Number(line.spent) / limit * 100 : null;
    const fact = (ico, text, title = '') => `<span class="xd-fact" ${title ? `title="${esc(title)}"` : ''}>${icon(ico)}${text}</span>`;
    return `
    <div class="xp-detail2">
        <div class="xd-top">
            ${fact('journal', `<b>${esc(e.entryNo)}</b> ${esc(entry.voucherLabel)}`, 'Entry number')}
            ${fact('calendar', `${date(e.date)} · ${dayName(e.date)}`)}
            ${e.party ? fact('user', esc(e.party), 'Paid to') : ''}
            ${e.reference ? fact('tag', esc(e.reference), 'Bill / UPI reference') : ''}
            ${fact('history', `${dateTime(entry.createdAt)} · ${esc(e.createdBy)}`, 'Recorded')}
            ${e.viaJournal ? fact('layers', `part of a ${entry.lines.length}-line voucher`) : ''}
            <span class="spacer"></span>
            <span class="xd-actions">
                ${manage && (e.editable || e.viaJournal) ? `<button class="btn xs primary" data-xp-action="edit" data-key="${r.key}">${icon('edit')}Edit</button>` : ''}
                ${r.emiOf ? `<button class="btn xs primary" data-xp-action="emi-plan" data-plan="${r.emiOf.plan.id}" data-key="${r.key}" title="Pay, undo or pay off this EMI">${icon('calendar')}EMI plan</button>` : ''}
                ${manage && !r.emiOf ? `<button class="btn xs" data-xp-action="copy" data-key="${r.key}" title="Record it again">${icon('copy')}Again</button>` : ''}
                ${manage && e.refundable ? `<button class="btn xs" data-xp-action="refund" data-key="${r.key}" title="Money came back: a return, a cancelled order, a cashback">${icon('arrow-in')}Refund</button>
                    <button class="btn xs" data-xp-action="reverse" data-key="${r.key}" title="Recorded by mistake or never charged: cancel it with a reversing entry">${icon('undo')}Reverse</button>` : ''}
                ${manage && e.convertible && !r.emiOf ? `<button class="btn xs" data-xp-action="paid-for" data-key="${r.key}" title="You paid this for someone who will pay you back: track it under Paid for">${icon('users')}Paid for…</button>` : ''}
                ${manage && e.editable && !e.linked?.length ? `<button class="btn xs ghost icon danger" data-xp-action="delete" data-key="${r.key}" title="Delete">${icon('trash')}</button>` : ''}
            </span>
        </div>
        <div class="xd-cards">
            <div class="xd-card">
                <div class="xd-card-head">${icon('journal')}Posting</div>
                ${entry.lines.map(l => `<div class="xd-line"><span class="xd-side">${Number(l.debit) ? 'Dr' : 'Cr'}</span><span class="ellipsis">${esc(l.accountName)}${l.categoryId && l.categoryId === e.categoryId ? ` <span class="muted">· ${esc(e.categoryName)}</span>` : ''}</span>
                    <b class="mono ${Number(l.debit) ? '' : 'muted'}">${money(Number(l.debit) || Number(l.credit))}</b></div>`).join('')}
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon('tag')}${esc(e.categoryName)}</div>
                ${used !== null ? `<div class="xd-line"><span>Budget ${esc(ctx.monthLabel || '')}</span><b class="mono ${used > 100 ? 'neg' : ''}">${money(line.spent)} / ${moneyShort(limit)}</b></div>
                    <i class="xd-bar ${used > 100 ? 'over' : used > 80 ? 'warn' : ''}"><em style="width:${Math.min(used, 100)}%"></em></i>
                    <div class="xd-line small"><span class="muted">${used > 100 ? `<span class="neg">${money(Number(line.spent) - limit)} over</span>` : `${money(limit - Number(line.spent))} left`}</span><span class="muted">${percent(used, 0)}</span></div>`
                    : `<div class="xd-line"><span class="muted">${inBudgetMonth ? 'No budget set' : 'Budget'}</span><span class="muted">${inBudgetMonth ? '—' : 'other month'}</span></div>`}
                <div class="xd-line small"><span class="muted">In this list</span><span>${sameCat.length}× · <b class="mono">${moneyShort(spentCat)}</b></span></div>
                <div class="xd-line small"><span class="muted">This one</span><span>${spentCat ? percent(r.amount / spentCat * 100, 0) : '—'} of it</span></div>
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon(e.party ? 'user' : 'wallet')}${e.party ? esc(e.party) : 'Paid from'}</div>
                ${e.party ? `<div class="xd-line small"><span class="muted">Here in this list</span><span>${samePlace.length}× · <b class="mono">${moneyShort(samePlace.reduce((s, x) => s + x.amount, 0))}</b></span></div>
                    <div class="xd-line small"><span class="muted">Average</span><b class="mono">${money(Math.round(samePlace.reduce((s, x) => s + x.amount, 0) / (samePlace.length || 1)))}</b></div>` : ''}
                <div class="xd-line small"><span class="muted">${e.party ? 'Paid from' : 'Account'}</span><span class="ellipsis">${esc(e.paidFrom)}</span></div>
                ${account ? `<div class="xd-line small"><span class="muted">${account.accountType === 'CREDIT_CARD' ? 'Card owes now' : 'Balance now'}</span><b class="mono">${money(account.balance)}</b></div>` : ''}
            </div>
        </div>
        ${e.memo ? `<div class="xd-note">${icon('info')}<span>${esc(e.memo)}</span></div>` : ''}
        ${refundsHtml(e, manage, refundEntry)}
        ${await linkedHtml(r, ctx, manage)}
        <div class="xp-evidence" data-ev-entry="${e.entryId}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

/** Colours of the parts of a cost breakdown: the expense first, then each charge. */
const PART_COLORS = ['var(--ocean-600)', '#e0795f', '#e8b64a', '#2fae7a', '#7b5cd6', '#13a89a', '#d65c8f', '#5b8def'];

/**
 * How an expense and its charges hang together, as a cost breakdown: one bar split into the expense and each charge
 * (what came back on a part hatched at its end), then a line per part (kind, what, entry, refund, share of the all-in
 * cost, amount) with its actions and, under it, the refunds of that part, each opening its own entry. The foot gives
 * the all-in total: what was paid, what came back and what it costs now. An expense shows its own breakdown; a charge
 * shows the breakdown of the expense it is part of, itself highlighted, with the way to move it or to unlink it. The
 * refunds of the entry opened are listed in full above the breakdown, so here they are left out.
 */
async function linkedHtml(r, ctx, manage) {
    const e = r.raw;
    if (e.parentEntryId) {
        const parent = await parentGroup(e, ctx.rows);
        return breakdownHtml({ root: parent?.root || { entryId: e.parentEntryId, entryNo: e.parentEntryNo, narration: e.parentNarration, amount: null },
            charges: parent?.charges || [linkedOf(e)], focusId: e.entryId, manage, key: r.key });
    }
    if (!e.linked?.length) {
        return manage && e.linkable && !r.emiOf ? `<div class="xl-hint">${icon('link')}<span>Paid a fee, tax, tip or delivery with this?</span>
            <button type="button" class="link-btn" data-xp-action="add-charge" data-key="${r.key}">Add a charge</button><span class="muted">or</span>
            <button type="button" class="link-btn" data-xp-action="link-existing" data-key="${r.key}">link one already recorded</button></div>` : '';
    }
    return breakdownHtml({ root: { entryId: e.entryId, entryNo: e.entryNo, narration: e.narration, categoryName: e.categoryName, amount: r.amount, gross: r.gross,
        date: e.date, status: e.status, refunds: e.refunds }, charges: e.linked.map(chargeOf), manage, key: r.key, linkable: e.linkable && !r.emiOf });
}

/** A linked charge as a part of a breakdown: what it costs now, what was paid and what came back. */
const chargeOf = l => ({ ...l, amount: Number(l.netAmount), gross: Number(l.amount), refunds: l.refunds || [] });

/** A charge's own figures in the shape of a linked charge. */
const linkedOf = e => ({ entryId: e.entryId, entryNo: e.entryNo, date: e.date, narration: e.narration, categoryName: e.categoryName,
    amount: Number(e.netAmount ?? e.amount), gross: Number(e.amount), status: e.status, refunds: e.refunds || [] });

/** The expense a charge belongs to and all its charges: from the list when it is there, else looked up by its date. */
async function parentGroup(e, rows = []) {
    let parent = rows.find(x => x.raw?.entryId === e.parentEntryId)?.raw;
    if (!parent) {
        const entry = await api.get(`/transactions/${e.parentEntryId}`).catch(() => null);
        if (entry) parent = (await api.get('/expenses', { from: entry.entryDate, to: entry.entryDate }).catch(() => [])).find(x => x.entryId === e.parentEntryId);
    }
    if (!parent) return null;
    return { root: { entryId: parent.entryId, entryNo: parent.entryNo, narration: parent.narration, categoryName: parent.categoryName,
        amount: Number(parent.netAmount ?? parent.amount), gross: Number(parent.amount), date: parent.date, status: parent.status, refunds: parent.refunds || [] },
        charges: parent.linked.map(chargeOf) };
}

function breakdownHtml({ root, charges, focusId = null, manage, key, linkable = false }) {
    const parts = [root, ...charges];
    const openId = focusId ?? root.entryId;   // the entry opened: its refunds are shown in full above
    const known = root.amount !== null;
    const grossOf = p => p.gross ?? p.amount ?? 0;
    const extra = charges.reduce((s, c) => s + c.amount, 0);
    const total = known ? root.amount + extra : null;   // what it all costs now
    const paid = known ? parts.reduce((s, p) => s + grossOf(p), 0) : null;
    const back = known ? paid - total : 0;
    const share = v => (total ? (v / total) * 100 : 0);
    const color = i => PART_COLORS[i === 0 ? 0 : ((i - 1) % (PART_COLORS.length - 1)) + 1];
    const isChild = focusId !== null;
    const titleOf = (p, i) => (i === 0 ? p.narration : chargeTitle(p.narration, root.narration));
    const bar = paid ? `<div class="xl-bar" role="img" aria-label="Cost breakdown">${parts.map((p, i) => {
        const g = grossOf(p), partBack = g - (p.amount ?? g);
        return `<i class="${i === 0 ? 'root' : ''} ${p.entryId === focusId ? 'focus' : ''}" style="width:${(g / paid) * 100}%"
            title="${esc(`${titleOf(p, i)} · ${money(p.amount)}${partBack > 0.004 ? ` (${money(g)} paid, ${money(partBack)} back)` : ''} · ${percent(share(p.amount), i === 0 ? 0 : 1)}`)}"><em style="width:${g ? ((p.amount ?? g) / g) * 100 : 0}%;background:${color(i)}"></em></i>`;
    }).join('')}</div>` : '';
    const act = (action, iconName, title, entryId, cls = '') => `<button type="button" class="btn xs ghost icon ${cls}" data-xp-action="${action}" data-entry="${entryId}" data-key="${key}" title="${esc(title)}">${icon(iconName)}</button>`;
    const refundLines = part => (part.entryId === openId || !part.refunds?.length ? '' : `<div class="xl-refunds">${part.refunds.map(f => `
        <button type="button" class="xl-refund ${f.reversal ? 'is-reversal' : ''}" data-xp-action="open-refund" data-entry="${f.entryId}" data-key="${key}" title="Open ${esc(f.entryNo)}: its posting, evidence and history">
            ${icon(f.reversal ? 'undo' : 'arrow-in')}<b>${f.reversal ? 'Reversed' : 'Refund'}</b>
            <small class="ellipsis">${[date(f.date), f.entryNo, f.accountName ? `${f.reversal ? 'back to' : 'into'} ${f.accountName}` : '', f.note].filter(Boolean).map(esc).join(' · ')}</small>
            <b class="mono">−${money(f.amount)}</b>${icon('chevron-right')}</button>`).join('')}</div>`);
    const line = (part, i) => {
        const isRoot = i === 0;
        const kind = isRoot ? null : chargeKind(part.narration);
        const ci = categoryIcon(part.categoryName || '');
        const g = grossOf(part), partBack = part.amount === null ? 0 : g - part.amount;
        const sign = isRoot ? '' : '+';
        return `<div class="xl-part ${isRoot ? 'root' : ''} ${part.entryId === focusId ? 'focus' : ''}">
            <i class="xl-swatch" style="background:${color(i)}"></i>
            ${isRoot ? `<span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span>` : `<span class="xl-kind ${kind.tone}">${icon(kind.iconName)}${esc(kind.short)}</span>`}
            <button type="button" class="xl-what" data-xp-action="open-linked" data-entry="${part.entryId}" data-key="${key}" title="Open ${esc(part.entryNo || '')}">
                <b class="ellipsis">${esc(titleOf(part, i))}</b>
                <small class="muted ellipsis">${[part.entryNo, part.categoryName, part.date ? shortDate(part.date) : ''].filter(Boolean).map(esc).join(' · ')}${part.entryId === focusId ? ' · <b class="xl-this">this charge</b>' : ''}</small></button>
            ${refundPill(part.status, partBack, part.refunds) || '<span></span>'}
            <span class="xl-pct">${total ? percent(share(part.amount), isRoot ? 0 : 1) : ''}</span>
            <span class="xl-money">${part.amount === null ? '<b class="mono">—</b>' : `${partBack > 0.004 ? `<s class="mono" title="Paid">${sign}${money(g)}</s>` : ''}<b class="mono">${sign}${money(part.amount)}</b>`}</span>
            <span class="xl-acts">${!manage || isRoot ? '' : `${act('charge-edit', 'edit', 'Edit this charge', part.entryId)}${part.status !== 'REVERSED' && part.status !== 'REFUNDED' ? act('charge-refund', 'arrow-in', 'Refund this charge', part.entryId) : ''}
                ${act('charge-unlink', 'unlock', 'Unlink: keep it as an expense on its own', part.entryId)}${act('charge-delete', 'trash', 'Delete this charge', part.entryId, 'danger')}`}</span>
        </div>${refundLines(part)}`;
    };
    return `
    <div class="xl-card ${isChild ? 'is-child' : ''}">
        <div class="xl-head">
            <span class="chip-icon xs violet">${icon(isChild ? 'split' : 'link')}</span>
            <div class="grow min-0"><b>${isChild ? `Part of ${esc(root.narration || root.entryNo)}` : 'Cost breakdown'}</b>
                <small class="muted">${isChild ? `${esc(root.entryNo)}${root.date ? ` · ${date(root.date)}` : ''} · ${charges.length} charge${charges.length === 1 ? '' : 's'} with it`
                    : `${esc(root.entryNo)} with ${charges.length} linked charge${charges.length === 1 ? '' : 's'}`}</small></div>
            ${isChild ? `<button type="button" class="btn xs" data-xp-action="open-linked" data-entry="${root.entryId}" data-key="${key}">${icon('chevron-right')}Open expense</button>
                ${manage ? `<button type="button" class="btn xs" data-xp-action="move-charge" data-key="${key}" title="It belongs to another expense">${icon('transfer')}Move…</button>
                <button type="button" class="btn xs ghost" data-xp-action="charge-unlink" data-entry="${focusId}" data-key="${key}" title="Keep it as an expense on its own">${icon('unlock')}Unlink</button>` : ''}`
            : manage && linkable ? `<button type="button" class="btn xs" data-xp-action="add-charge" data-key="${key}">${icon('plus')}Add charge</button>
                <button type="button" class="btn xs ghost" data-xp-action="link-existing" data-key="${key}" title="A fee or tax you already recorded on its own">${icon('link')}Link existing…</button>` : ''}
        </div>
        ${bar}
        <div class="xl-parts">${parts.map(line).join('')}</div>
        ${total !== null ? `<div class="xl-foot">
            ${back > 0.004 ? `<span class="xl-flow"><span>Paid <b class="mono">${money(paid)}</b></span><span class="xr-back">${icon('arrow-in')}back <b class="mono">−${money(back)}</b></span></span>` : ''}
            <span class="xl-label">All-in${back > 0.004 ? ' now' : ''}</span><b class="mono">${money(total)}</b>
            <span class="muted">charges add <b class="${extra / (root.amount || 1) > 0.05 ? 'neg' : ''}">${percent(root.amount ? (extra / root.amount) * 100 : 0, 1)}</b> on top of ${money(root.amount)}</span></div>` : ''}
    </div>`;
}

/**
 * What came back on the expense opened, in full: paid, back and what still counts (with a bar), then each refund or
 * the reversal with its entry, date, account, note, who recorded it and when, its posting and evidence, to open or undo.
 */
function refundsHtml(e, manage, entries = new Map()) {
    if (!e.refunds?.length) return '';
    const gross = Number(e.amount), back = Number(e.refunded), net = Number(e.netAmount);
    const reversed = e.status === 'REVERSED';
    const key = `x${e.entryId}-${e.categoryId}`;
    return `
    <div class="xp-refunds">
        <div class="xr-head">
            <span class="chip-icon xs ${reversed ? 'gray' : 'aqua'}">${icon(reversed ? 'undo' : 'arrow-in')}</span>
            <b>${reversed ? 'Reversed' : e.status === 'REFUNDED' ? 'Refunded in full' : 'Part refunded'}</b>
            <span class="muted small">${e.refunds.length} entr${e.refunds.length === 1 ? 'y' : 'ies'}</span>
            <span class="spacer"></span>
            <span class="xr-sum"><span>Paid <b class="mono">${money(gross)}</b></span><span class="xr-back">Back <b class="mono">−${money(back)}</b></span>
                <span>Still counts <b class="mono">${money(net)}</b></span></span>
        </div>
        <i class="xr-bar" title="${percent(gross ? (back / gross) * 100 : 0, 0)} came back"><em style="width:${gross ? Math.min(100, (back / gross) * 100) : 0}%"></em></i>
        ${e.refunds.map(f => {
            const entry = entries.get(f.entryId);
            return `
        <div class="xp-refund ${f.reversal ? 'is-reversal' : ''}">
            <span class="chip-icon xs ${f.reversal ? 'gray' : 'aqua'}">${icon(f.reversal ? 'undo' : 'arrow-in')}</span>
            <div class="grow min-0">
                <div class="xr-title"><b>${f.reversal ? 'Reversal' : 'Refund'}</b><b class="mono xr-amt">−${money(f.amount)}</b>
                    <span class="muted small">${date(f.date)} · ${dayName(f.date)}</span></div>
                <div class="xr-facts">
                    <span class="xd-fact" title="Entry number">${icon('journal')}<b>${esc(f.entryNo)}</b>${entry ? ` ${esc(entry.voucherLabel)}` : ''}</span>
                    ${f.accountName ? `<span class="xd-fact" title="${f.reversal ? 'Back to' : 'Received into'}">${icon('wallet')}${f.reversal ? 'back to' : 'into'} ${esc(f.accountName)}</span>` : ''}
                    ${f.note ? `<span class="xd-fact" title="Note">${icon('info')}${esc(f.note)}</span>` : ''}
                    ${entry ? `<span class="xd-fact" title="Recorded">${icon('history')}${dateTime(entry.createdAt)} · ${esc(entry.createdBy || '')}</span>` : ''}
                </div>
                ${entry ? `<div class="xr-posting">${entry.lines.map(l => `<div class="xd-line"><span class="xd-side">${Number(l.debit) ? 'Dr' : 'Cr'}</span>
                    <span class="ellipsis">${esc(l.accountName)}${l.categoryId && l.categoryId === e.categoryId ? ` <span class="muted">· ${esc(e.categoryName)}</span>` : ''}</span>
                    <b class="mono ${Number(l.debit) ? '' : 'muted'}">${money(Number(l.debit) || Number(l.credit))}</b></div>`).join('')}</div>` : ''}
                <div data-ev-entry="${f.entryId}" data-ev-count="${f.attachmentCount || 0}"></div></div>
            <span class="xr-acts">
                <button class="btn xs" data-xp-action="open-refund" data-entry="${f.entryId}" data-key="${key}" title="Open ${esc(f.entryNo)}">${icon('chevron-right')}Open</button>
                ${manage ? `<button class="btn xs ghost" data-xp-action="undo-refund" data-refund="${f.entryId}" data-key="${key}" title="Undo: delete ${esc(f.entryNo)}">${icon('undo')}Undo</button>` : ''}</span>
        </div>`;
        }).join('')}
    </div>`;
}

/** Money back on an expense: how much, when, into which account (the payer by default), with the receipt. */
async function openRefundDialog(r, reload) {
    const e = r.raw;
    const accounts = await loadAccounts();
    const left = Number(e.netAmount);
    const modal = openModal({
        title: `Refund · ${e.narration}`, iconName: 'arrow-in',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.categoryName)}</b><span class="spacer"></span><b>${money(e.amount)}</b></div>
                <div class="small muted">${date(e.date)} · paid from ${esc(e.paidFrom)}${Number(e.refunded) ? ` · ${money(e.refunded)} already refunded` : ''}</div></div>
            <label class="field"><span>Amount back *</span><input name="amount" type="number" step="any" min="0.01" max="${left}" value="${left}" required data-plain>
                <span class="chips">${[1, 0.5].map(f => `<button type="button" class="date-chip" data-fill="${Math.round(left * f * 100) / 100}">${f === 1 ? 'All' : 'Half'} ${moneyShort(left * f)}</button>`).join('')}</span></label>
            ${field({ label: 'Received on', name: 'date', type: 'date', value: isoDate(), required: true, attrs: `min="${e.date}"` })}
            <label class="field span-2"><span>Back into</span><select name="accountId">${accountOptions(accounts,
                a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && a.accountType !== 'CHIT_FUND', e.paidFromId)}</select></label>
            ${field({ label: 'Note', name: 'notes', placeholder: 'e.g. Returned one pair, order cancelled, cashback', span: 'span-2' })}
            <div class="span-2">${evidenceFieldHtml({ label: 'Refund proof', hint: 'Credit note, refund SMS or screenshot' })}</div>
            <p class="span-2 hint" style="margin:0">The refund lowers ${esc(e.categoryName)} spending in the month it comes back${e.paidFromType === 'CREDIT_CARD' ? ' and what you owe on the card' : ''}.</p>
        </form>`,
        onOpen: m => m.el.querySelector('form').addEventListener('click', ev => {
            const b = ev.target.closest('[data-fill]');
            if (b) m.el.querySelector('[name=amount]').value = b.dataset.fill;
        }),
        actions: [{ label: 'Cancel' }, {
            label: 'Record refund', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const saved = await api.post(`/expenses/${e.entryId}/refunds`, { date: d.date, amount: d.amount,
                    accountId: d.accountId ? Number(d.accountId) : null, notes: d.notes });
                await proof.uploadTo(saved.id);
                toast(`${money(saved.amount)} refunded on ${e.entryNo} · ${saved.entryNo}`);
                reload();
            },
        }],
    });
    const proof = bindEvidenceField(modal.el);
}

/** Cancels an expense with a mirror entry; both stay in the books, linked, and the expense counts for nothing. */
async function openReverseDialog(r, reload) {
    const e = r.raw;
    openModal({
        title: `Reverse · ${e.narration}`, iconName: 'undo',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.categoryName)}</b><span class="spacer"></span><b>${money(e.netAmount)}</b></div>
                <div class="small muted">${money(e.netAmount)} goes back to ${esc(e.paidFrom)} and comes off ${esc(e.categoryName)}.
                    Both entries stay in the books, linked, so the history is kept; the expense shows as <b>Reversed</b>.
                    ${Number(e.refunded) ? `Refunds of ${money(e.refunded)} stay as they are.` : ''}</div></div>
            ${field({ label: 'Reversal date', name: 'date', type: 'date', value: e.date, required: true, attrs: `min="${e.date}"`,
                      hint: 'The expense date keeps that month right; use today if it was charged and then cancelled' })}
            ${field({ label: 'Reason', name: 'reason', placeholder: 'e.g. Entered twice, payment failed' })}
        </form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Reverse expense', kind: 'primary', iconName: 'undo',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const saved = await api.post(`/expenses/${e.entryId}/reverse`, { date: d.date, reason: d.reason });
                toast(`${e.entryNo} reversed by ${saved.entryNo}`);
                reload();
            },
        }],
    });
}

/** Charges that commonly come with an expense, and the category each one most likely belongs to. */
const CHARGE_KINDS = [
    { label: 'Transaction fee', short: 'Fee', iconName: 'bank', tone: 'ocean', match: /bank|fee|charge/i, words: ['transaction fee', 'processing fee', 'surcharge'] },
    { label: 'Convenience fee', short: 'Conv. fee', iconName: 'card', tone: 'ocean', match: /fee|charge|bank/i, words: ['convenience', 'booking fee', 'platform fee'] },
    { label: 'GST / tax', short: 'Tax', iconName: 'percent', tone: 'gold', match: /gst|tax/i, words: ['gst', 'tax', 'cess', 'vat'] },
    { label: 'Tip', short: 'Tip', iconName: 'heart', tone: 'coral', match: /tips?|gratuity/i, words: ['tip', 'gratuity'] },
    { label: 'Delivery', short: 'Delivery', iconName: 'send', tone: 'aqua', match: /deliver|shipping|courier/i, words: ['deliver', 'shipping', 'courier', 'packing'] },
    { label: 'Late fee', short: 'Late fee', iconName: 'alert', tone: 'red', match: /penal|late|fine|fee|charge/i, words: ['late fee', 'penalty', 'fine'] },
];

/**
 * A charge that came with an expense: a fee, tax, tip or delivery. It is booked as its own expense (its own category,
 * account and date, refundable on its own), linked to the expense so the two show together.
 */
function openChargeDialog(r, { accounts, expenseCategories, onSaved }) {
    const e = r.raw;
    let saveKey = newRequestKey();
    const added = [];   // charges added with "Add & another" while the dialog stays open
    const earlier = () => (e.linked || []).reduce((s, l) => s + Number(l.netAmount), 0) + added.reduce((s, a) => s + Number(a.amount), 0);
    const guess = kind => (kind.match && expenseCategories.find(c => c.active !== false && kind.match.test(c.name))?.id) || e.categoryId;
    const percentOf = p => Math.round(r.amount * p) / 100;
    const modal = openModal({
        title: `Add a charge · ${e.narration}`, iconName: 'link',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.narration)}</b><span class="spacer"></span><b>${money(r.amount)}</b></div>
                <div class="small muted">${date(e.date)} · ${esc(e.categoryName)} · paid from ${esc(e.paidFrom)}${e.linked?.length ? ` · ${e.linked.length} charge${e.linked.length === 1 ? '' : 's'} already` : ''}</div></div>
            <div class="span-2 xc-kinds">${CHARGE_KINDS.map((k, i) => `<button type="button" class="xf-chip ${i === 0 ? 'on' : ''}" data-kind="${i}">${icon(k.iconName)}${k.label}</button>`).join('')}</div>
            <label class="field"><span>Charge *</span><input name="amount" type="number" step="any" min="0.01" required data-plain placeholder="₹">
                <span class="chips" title="A share of ${money(r.amount)}">${[1, 1.5, 2, 2.5, 5, 18].map(p => `<button type="button" class="date-chip" data-pct="${p}">${p}%</button>`).join('')}</span></label>
            ${field({ label: 'Date', name: 'entryDate', type: 'date', value: e.date, required: true })}
            ${field({ label: 'Category', name: 'categoryId', type: 'select', required: true, options: categoryOptions(expenseCategories, guess(CHARGE_KINDS[0])) })}
            ${field({ label: 'Paid from', name: 'paidFromId', type: 'select', required: true,
                      options: accountOptions(accounts, a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && !['CHIT_FUND', 'RECEIVABLE'].includes(a.accountType), e.paidFromId) })}
            ${field({ label: 'Description', name: 'narration', value: `${CHARGE_KINDS[0].label} · ${e.narration}`, span: 'span-2' })}
            ${field({ label: 'Note', name: 'notes', placeholder: 'e.g. 1.8% card surcharge', span: 'span-2' })}
            <div class="span-2 xc-added" data-added hidden></div>
            <div class="span-2 xc-total" data-total></div>
            <div class="span-2">${evidenceFieldHtml({ label: 'Proof', hint: 'Bill line, SMS or screenshot showing the charge' })}</div>
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            const drawTotal = () => {
                const charge = Number(form.amount.value || 0);
                const before = earlier();
                form.querySelector('[data-total]').innerHTML = `${icon('link')}<span>${money(r.amount)}${before ? ` + earlier ${money(before)}` : ''} + this ${money(charge)}
                    <small class="muted">(${percent(r.amount ? (charge / r.amount) * 100 : 0, 1)} of the expense)</small></span>
                    <b>= ${money(r.amount + before + charge)} all-in</b>`;
            };
            form.addEventListener('click', ev => {
                const pct = ev.target.closest('[data-pct]');
                if (pct) { form.amount.value = percentOf(Number(pct.dataset.pct)); drawTotal(); return; }
                const b = ev.target.closest('[data-kind]');
                if (!b) return;
                const kind = CHARGE_KINDS[Number(b.dataset.kind)];
                form.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
                form.narration.value = `${kind.label} · ${e.narration}`;
                form.categoryId.value = guess(kind);
                form.categoryId.dispatchEvent(new Event('change', { bubbles: true }));   // a combo box shows the new pick
                form.amount.focus();
            });
            form.amount.addEventListener('input', drawTotal);
            drawTotal();
            setTimeout(() => form.amount.focus(), 50);
        },
        actions: [
            { label: 'Close' },
            {
                label: 'Add & another', iconName: 'plus', title: 'Save this charge and add the next one',
                onClick: async m => {
                    const saved = await save(m);
                    if (!saved) return true;
                    // keep the dialog: what was added is listed, the amount and note start again, the kind stays
                    added.push(saved);
                    const list = m.el.querySelector('[data-added]');
                    list.hidden = false;
                    list.innerHTML = `${icon('check-circle')}<span>Added: ${added.map(a => `<b>${esc(chargeTitle(a.narration, e.narration))}</b> ${money(a.amount)}`).join(' · ')}</span>`;
                    const form = m.el.querySelector('form');
                    form.amount.value = '';
                    form.notes.value = '';
                    form.amount.dispatchEvent(new Event('input'));
                    form.amount.focus();
                    toast(`${saved.entryNo} linked to ${e.entryNo}`);
                    onSaved(saved, { keepOpen: true });
                    return true;
                },
            },
            {
                label: 'Add charge', kind: 'primary', iconName: 'check',
                onClick: async m => {
                    const saved = await save(m);
                    if (!saved) return true;
                    onSaved(saved);
                },
            },
        ],
    });
    const proof = bindEvidenceField(modal.el);   // emptied after each upload, ready for the next charge

    async function save(m) {
        const form = m.el.querySelector('form');
        if (!form.reportValidity()) return null;
        const d = readForm(form);
        const saved = await api.post(`/expenses/${e.entryId}/linked`, { entryDate: d.entryDate, amount: d.amount, categoryId: Number(d.categoryId),
            paidFromId: Number(d.paidFromId), narration: d.narration, party: e.party, reference: e.reference, notes: d.notes }, { key: saveKey });
        saveKey = newRequestKey();   // the next one is a new charge
        await proof.uploadTo(saved.id);
        return saved;
    }
}

/**
 * Links expenses together after the fact, from the expenses a week either side:
 *   attach  pick the expenses recorded on their own that came with this one (a fee, the GST line, a tip): several at once
 *   move    pick the expense a charge really belongs to
 * The likeliest come first: the same account, the nearest dates, and (to attach) small amounts or words like fee or tax.
 */
async function openLinkPicker(r, mode, reload) {
    const e = r.raw;
    const around = new Date(e.date + 'T00:00:00');
    const from = isoDate(addDays(around, -7)), to = isoDate(addDays(around, 7));
    const rows = await api.get('/expenses', { from, to });
    const attach = mode === 'attach';
    const feeWords = /fee|charge|gst|tax|tip|surcharge|deliver|convenience|cess|penalty/i;
    const candidates = rows.filter(x => x.entryId !== e.entryId && x.linkable && (attach
        ? !x.linked?.length && x.status !== 'REVERSED'
        : x.entryId !== e.parentEntryId))
        .map(x => {
            const days = Math.abs((new Date(x.date + 'T00:00:00') - around) / 86400000);
            const likely = attach ? (feeWords.test(x.narration) || Number(x.netAmount) < Number(e.netAmount) * 0.2) : Number(x.netAmount) > Number(e.netAmount);
            return { x, days, likely, score: (x.paidFromId === e.paidFromId ? 0 : 3) + days + (likely ? 0 : 4) };
        })
        .filter((c, i, arr) => arr.findIndex(o => o.x.entryId === c.x.entryId) === i)   // one line per entry
        .sort((a, b) => a.score - b.score);
    const item = c => `
        <label class="xl-pick ${c.likely ? 'likely' : ''}" data-text="${esc(`${c.x.narration} ${c.x.categoryName} ${c.x.entryNo} ${c.x.paidFrom} ${c.x.party || ''}`.toLowerCase())}">
            <input type="${attach ? 'checkbox' : 'radio'}" name="pick" value="${c.x.entryId}">
            <span class="chip-icon xs ${categoryIcon(c.x.categoryName).tone}">${icon(categoryIcon(c.x.categoryName).name)}</span>
            <span class="grow min-0"><b class="ellipsis">${esc(c.x.narration)}</b>
                <small class="muted ellipsis">${esc(c.x.entryNo)} · ${shortDate(c.x.date)}${c.days ? ` (${c.days}d ${c.x.date < e.date ? 'before' : 'after'})` : ' (same day)'} · ${esc(c.x.categoryName)} · ${esc(c.x.paidFrom)}</small></span>
            ${c.likely ? `<span class="xl-likely">${icon('sparkles')}${attach ? 'likely a charge' : 'likely'}</span>` : ''}
            ${c.x.linked?.length ? `<span class="xl-chip" title="Has ${c.x.linked.length} charge(s) already">${icon('link')}<b>${c.x.linked.length}</b></span>` : ''}
            <b class="mono">${money(c.x.netAmount)}</b></label>`;
    const modal = openModal({
        title: attach ? `Link charges to ${e.narration}` : `Move ${e.entryNo} to another expense`, iconName: attach ? 'link' : 'transfer', size: 'lg',
        body: `
        <div class="xl-picker">
            <div class="post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.narration)}</b><span class="spacer"></span><b>${money(e.netAmount)}</b></div>
                <div class="small muted">${attach ? 'Pick the expenses you recorded on their own that came with this one: a fee, the tax line, a tip. They stay as they are; they are only shown together.'
                    : `Now a charge of ${esc(e.parentEntryNo)} · ${esc(e.parentNarration || '')}. Pick the expense it really came with.`}</div></div>
            <div class="search-box sm">${icon('search')}<input data-pick-search placeholder="Find by description, category, account or entry no." data-plain></div>
            <div class="xl-pick-list">${candidates.length ? candidates.map(item).join('') : emptyState(`No ${attach ? 'expenses on their own' : 'other expenses'} a week either side of ${date(e.date)}`, 'link')}</div>
            <div class="xl-pick-foot muted small" data-pick-sum></div>
        </div>`,
        actions: [{ label: 'Cancel' }, {
            label: attach ? 'Link' : 'Move', kind: 'primary', iconName: attach ? 'link' : 'transfer',
            onClick: async m => {
                const picked = [...m.el.querySelectorAll('[name=pick]:checked')].map(i => Number(i.value));
                if (!picked.length) { toast(attach ? 'Pick at least one expense' : 'Pick the expense it belongs to', 'error'); return true; }
                if (attach) {
                    for (const id of picked) await api.put(`/expenses/${id}/link`, { parentId: e.entryId });
                    view.collapsed.delete(e.entryId);
                    toast(`${picked.length} charge${picked.length === 1 ? '' : 's'} linked to ${e.entryNo}`);
                } else {
                    await api.put(`/expenses/${e.entryId}/link`, { parentId: picked[0] });
                    toast(`${e.entryNo} moved to ${rows.find(x => x.entryId === picked[0])?.entryNo || 'the expense'}`);
                }
                reload();
            },
        }],
    });
    const el = modal.el;
    const drawSum = () => {
        const picked = [...el.querySelectorAll('[name=pick]:checked')].map(i => rows.find(x => x.entryId === Number(i.value)));
        const sumPicked = picked.reduce((s, x) => s + Number(x.netAmount), 0);
        el.querySelector('[data-pick-sum]').innerHTML = !picked.length ? `${candidates.length} expense${candidates.length === 1 ? '' : 's'} from ${date(from)} to ${date(to)}`
            : attach ? `${picked.length} picked · +${money(sumPicked)} · all-in ${money(Number(e.netAmount) + sumPicked + (e.linked || []).reduce((s, l) => s + Number(l.netAmount), 0))}`
            : `Moves to ${esc(picked[0].entryNo)} · ${esc(picked[0].narration)}`;
        el.querySelectorAll('.xl-pick').forEach(p => p.classList.toggle('on', p.querySelector('input').checked));
    };
    el.addEventListener('change', drawSum);
    el.querySelector('[data-pick-search]').addEventListener('input', ev => {
        const text = ev.target.value.trim().toLowerCase();
        el.querySelectorAll('.xl-pick').forEach(p => { p.hidden = text && !p.dataset.text.includes(text); });
    });
    drawSum();
}

/**
 * Turns an expense into money paid for someone: it leaves your spending and is tracked under Paid for, with its
 * date, amount, account and bill, until they pay you back.
 */
function openPaidForDialog(r, claimRows, onDone) {
    const e = r.raw;
    const known = [...new Set(claimRows.map(c => (c.party || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const plus = days => { const d = new Date(e.date + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDate(d); };
    openModal({
        title: `Paid for someone · ${e.narration}`, iconName: 'users',
        body: `<form class="form-grid two">
            <div class="span-2 xc-convert">
                <div class="xc-from"><small>Now</small><span class="chip-icon xs coral">${icon('receipt')}</span><b>Expense</b><span class="muted small">${esc(e.categoryName)} · counts as your spending</span></div>
                <span class="xc-arrow">${icon('chevron-right')}</span>
                <div class="xc-to"><small>Becomes</small><span class="chip-icon xs aqua">${icon('users')}</span><b>Paid for</b><span class="muted small">owed back to you · not your spending</span></div>
            </div>
            <div class="span-2 post-summary"><div class="row"><b>${esc(e.entryNo)} · ${esc(e.narration)}</b><span class="spacer"></span><b>${money(e.amount)}</b></div>
                <div class="small muted">${date(e.date)} · paid from ${esc(e.paidFrom)}. The money left the account once and that stays as it is; the bill${e.attachmentCount ? ` (${e.attachmentCount})` : ''} moves with it.</div></div>
            <label class="field"><span>Paid for (person) *</span><input name="party" value="${esc(e.party || '')}" required maxlength="100" list="xp-people" placeholder="Who will pay you back?" data-plain>
                <datalist id="xp-people">${known.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
            <label class="field"><span>Pay back by</span><input name="dueDate" type="date" min="${e.date}" data-plain>
                <span class="chips">${[[7, '1 week'], [30, '1 month']].map(([d, l]) => `<button type="button" class="date-chip" data-due="${plus(d)}">${l}</button>`).join('')}</span></label>
            ${field({ label: 'Description', name: 'narration', value: e.narration, span: 'span-2' })}
            ${field({ label: 'Note', name: 'notes', value: e.memo || '', placeholder: 'e.g. Split of the dinner bill', span: 'span-2' })}
        </form>`,
        onOpen: m => m.el.querySelector('form').addEventListener('click', ev => {
            const b = ev.target.closest('[data-due]');
            if (b) m.el.querySelector('[name=dueDate]').value = b.dataset.due;
        }),
        actions: [{ label: 'Cancel' }, {
            label: 'Move to Paid for', kind: 'primary', iconName: 'users',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const claim = await api.post(`/expenses/${e.entryId}/paid-for`, { party: d.party, narration: d.narration, dueDate: d.dueDate || null, notes: d.notes });
                toast(`${e.entryNo} is now Paid for ${claim.party} · ${claim.entryNo}`);
                onDone(claim);
            },
        }],
    });
}

// ===================================================================== side panels

function categoryBars(byCategory, budgets, total, singleMonth) {
    if (!byCategory.length) return emptyState('Nothing spent yet', 'pie');
    const max = Math.max(...byCategory.map(c => c.value));
    return `<div class="cat-bars">${byCategory.map(c => {
        const line = singleMonth ? budgets.lines.find(l => l.categoryId === c.key) : null;
        const limit = line?.monthlyLimit ? Number(line.monthlyLimit) : null;
        const scale = Math.max(max, limit || 0);
        const ci = categoryIcon(c.label);
        const over = limit && c.value > limit;
        return `
        <div class="cat-bar ${view.cats.includes(String(c.key)) ? 'active' : ''}" data-filter-category="${c.key}">
            <span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
            <div class="grow">
                <div class="row small"><span class="ellipsis">${esc(c.label)}</span><span class="muted tiny">${c.count}×</span><span class="spacer"></span>
                    <b class="mono ${over ? 'neg' : ''}">${money(c.value)}</b></div>
                <div class="bar-track"><span class="bar-fill ${over ? 'over' : ''}" style="width:${(c.value / scale) * 100}%"></span>
                    ${limit ? `<i class="bar-limit" style="left:${(limit / scale) * 100}%" title="Budget ${money(limit)}"></i>` : ''}</div>
                <div class="tiny muted">${percent((c.value / (total || 1)) * 100, 0)} of spend${limit ? ` · budget ${moneyShort(limit)}${over ? ' · <span class="neg">over</span>' : ''}` : ''}</div>
            </div>
        </div>`;
    }).join('')}</div>`;
}

function payerList(byPayer, total) {
    if (!byPayer.length) return emptyState('Nothing spent yet', 'wallet');
    return `<div class="cat-bars">${byPayer.map(p => {
        const t = accountTypeIcon(p.extra);
        return `<div class="cat-bar ${view.payers.includes(String(p.key)) ? 'active' : ''}" data-filter-payer="${p.key}">
            <span class="chip-icon sm ${t.tone}">${icon(t.name)}</span>
            <div class="grow"><div class="row small"><span class="ellipsis">${esc(p.label)}</span><span class="muted tiny">${p.count}×</span><span class="spacer"></span><b class="mono">${money(p.value)}</b></div>
                <div class="bar-track"><span class="bar-fill alt" style="width:${(p.value / (total || 1)) * 100}%"></span></div>
                <div class="tiny muted">${percent((p.value / (total || 1)) * 100, 0)} of spend</div></div></div>`;
    }).join('')}</div>`;
}

/** People who owe you, biggest first, with what is overdue. */
function owedList(open) {
    if (!open.length) return emptyState('Nobody owes you anything', 'check-circle');
    const people = new Map();
    open.forEach(r => {
        const p = people.get(r.party) || { name: r.party, owed: 0, items: 0, overdue: false, interest: 0 };
        p.owed += Number(r.claim.outstanding);
        p.interest += Number(r.claim.interestDue);
        p.items++;
        p.overdue ||= r.claim.overdue;
        people.set(r.party, p);
    });
    return `<div class="owed-list">${[...people.values()].sort((a, b) => b.owed - a.owed).map(p => `
        <button class="owed-row" data-person="${esc(p.name)}">
            <span class="avatar sm">${esc(initials(p.name))}</span>
            <span class="grow"><b>${esc(p.name)}</b><small class="muted">${p.items} item${p.items > 1 ? 's' : ''}${p.interest ? ` · +${moneyShort(p.interest)} interest` : ''}</small></span>
            ${p.overdue ? `<span class="badge critical">${icon('alert')}Overdue</span>` : ''}
            <b class="mono">${money(p.owed)}</b>
        </button>`).join('')}</div>`;
}

function drawTrend(el, expenses, fromD, toD, days) {
    if (!el) return;
    if (days <= 62) {
        const labels = Array.from({ length: days }, (_, i) => isoDate(addDays(fromD, i)));
        const values = labels.map(d => expenses.filter(r => r.date === d).reduce((s, r) => s + r.amount, 0));
        barChart(el, { labels, labelFormat: l => days <= 7 ? shortDate(l) : String(Number(l.slice(8))), format: moneyShort,
            series: [{ name: 'Spent', values, color: 'var(--series-2)' }] });
        return;
    }
    const months = [];
    for (let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1); d <= toD; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(isoDate(d).slice(0, 7));
    barChart(el, { labels: months, format: moneyShort,
        labelFormat: m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' }),
        series: [{ name: 'Spent', values: months.map(m => expenses.filter(r => r.date.startsWith(m)).reduce((s, r) => s + r.amount, 0)), color: 'var(--series-2)' }] });
}

// ===================================================================== helpers

function sum(rows) {
    return rows.reduce((s, r) => s + Number(r.amount), 0);
}

function groupSum(rows, keyOf, labelOf, extraOf = () => null) {
    const map = new Map();
    rows.forEach(r => {
        const key = keyOf(r);
        const item = map.get(key) || { key, label: labelOf(r), extra: extraOf(r), value: 0, count: 0 };
        item.value += Number(r.amount);
        item.count++;
        map.set(key, item);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
}

function addDays(d, n) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
}

/** "3 months ago", "1 year ago" */
function ageOf(iso) {
    const days = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    if (days < 60) return `${days} days ago`;
    if (days < 730) return `${Math.round(days / 30.4)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

function initials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function dayName(iso) {
    const diff = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
}
