/**
 * The mobile version: a light app for phones, served at the address set in Settings (default /m/).
 * Same data and rules as the full site, fewer features:
 *   Home       net worth, cash & bank, this month's spending against the budget, income, money to collect,
 *              what is due next and the latest entries
 *   Expenses   this month / last month / today by day, a tap shows the details; + adds an expense in seconds
 *   Accounts   balances by assets and liabilities; a tap shows the recent statement
 *   Chits      each chit's progress, paid in, still to pay, next due and take-home value; a tap shows installments
 *   Budgets    the month against the budget, each budget with its pace
 *   Income     what came in this month, by source
 *   Journal, Balance sheet, Reports, Forecast, Gifts: the same sections as the full site, kept to one simple
 *              screen each (entries by day, net worth by group, the period's highlights, six months of cash ahead,
 *              the give-and-take)
 * The bar holds the first four sections and "More", which lists every shared section.
 * Only the sections an admin shared for mobile appear (the server enforces the same). The session is separate
 * from the full site's (its own sign-in, its own stored token).
 *
 * Access links: /m/?link=<token> signs in without an account for as long as the link lives, with the link's
 * sections only, view only or as a recorder of expenses; with maker-checker each expense waits for approval and
 * "Sent for approval" lists what became of them: one sent back can be fixed and sent again, or taken back. A revoked or expired link ends the session at once.
 */
import { api, session, useTokenKey, setUnauthorizedHandler, newRequestKey } from '../core/api.js';
import { icon, hydrateIcons, categoryIcon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, setCurrency, daysFromToday } from '../core/format.js';
import { kindChip } from '../core/entry-kind.js';
import { evidenceFieldHtml, bindEvidenceField, openViewer, fileUrl } from '../components/evidence.js';
import { DOC_TYPES } from '../views/documents.js';

useTokenKey('pb.mobile.token');

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TABS = [
    { key: 'home', label: 'Home', iconName: 'dashboard', feature: null, view: home },
    { key: 'expenses', label: 'Expenses', iconName: 'receipt', feature: 'EXPENSES', view: expenses },
    { key: 'accounts', label: 'Accounts', iconName: 'wallet', feature: 'ACCOUNTS', view: accounts },
    { key: 'chits', label: 'Chits', iconName: 'chit', feature: 'CHITS', view: chits },
    { key: 'budgets', label: 'Budgets', iconName: 'target', feature: 'BUDGETS', view: budgets },
    { key: 'income', label: 'Income', iconName: 'arrow-in', feature: 'INCOME', view: income },
    { key: 'documents', label: 'Documents', short: 'Docs', iconName: 'file-text', feature: 'DOCUMENTS', view: documents },
    { key: 'journal', label: 'Journal', iconName: 'journal', feature: 'JOURNAL', view: journal, note: 'every entry by day' },
    { key: 'balance', label: 'Balance sheet', short: 'Balance', iconName: 'scale', feature: 'BALANCE_SHEET', view: balanceSheet, note: 'what you own and owe' },
    { key: 'reports', label: 'Reports', iconName: 'report', feature: 'REPORTS', view: reports, note: 'the period at a glance' },
    { key: 'forecast', label: 'Forecast', iconName: 'trending', feature: 'FORECAST', view: forecast, note: 'cash for the next months' },
    { key: 'gifts', label: 'Gifts', iconName: 'gift', feature: 'GIFTS', view: gifts, note: 'given, received, to return' },
];
const NOTES = { home: 'money at a glance', expenses: 'by day, add in seconds', accounts: 'balances and statements', chits: 'progress and dues',
    budgets: 'this month against the plan', income: 'what came in', documents: 'scans, ready to share' };
TABS.forEach(t => { t.note = t.note || NOTES[t.key]; });
const MORE = { key: 'more', label: 'More', iconName: 'more', feature: null, view: more };
/** The bottom bar: every section when they fit, else the first four and More. */
const barTabs = () => (tabs().length > 5 ? [...tabs().slice(0, 4), MORE] : tabs());

let me = null;
const has = f => !f || me?.features?.includes(f);
const can = p => me?.permissions?.includes(p);
const tabs = () => TABS.filter(t => has(t.feature));

// ===================================================================== start

setUnauthorizedHandler(() => showLogin(me?.linkId ? 'Your access link has ended or was switched off. Ask for a new one.' : ''));
hydrateIcons(document);
$('m-refresh').innerHTML = icon('refresh');
$('m-fab').innerHTML = icon('plus');
$('m-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('m-login-error').textContent = '';
    const form = e.target;
    try {
        const s = await api.post('/auth/login', { username: form.username.value.trim(), password: form.password.value, client: 'mobile' });
        session.token = s.token;
        await enter();
    } catch (error) { $('m-login-error').textContent = error.message; }
});
$('m-refresh').addEventListener('click', () => route());
$('m-user').addEventListener('click', userSheet);
$('m-fab').addEventListener('click', () => addExpense());
window.addEventListener('hashchange', route);
start();

/** Opens an access link from the address (?link=…), else the stored session, else the sign-in. */
async function start() {
    const token = new URLSearchParams(location.search).get('link');
    if (token) {
        history.replaceState(null, '', location.pathname + location.hash);   // the token does not stay in the address bar
        try {
            const s = await api.post('/auth/link', { token });
            session.token = s.token;
            await enter();
        } catch (error) {
            session.token = null;
            showLogin(error.message);
        }
        return;
    }
    if (!session.token) { showLogin(); return; }
    enter().catch(() => showLogin());
}

function showLogin(message = '') {
    me = null;
    $('m-app').hidden = true;
    $('m-login').hidden = false;
    $('m-login-error').textContent = message || '';
}

async function enter() {
    me = await api.get('/auth/me');
    if (!me.mobile) {   // a desktop session must not be reused here
        session.token = null;
        throw new Error('sign in again');
    }
    if (me.mustChangePassword) {   // the default password: a new one is set on the full site first
        session.token = null;
        showLogin('You are using the default password. Open the full site once to set your own, then sign in here.');
        return;
    }
    setCurrency(me.currency);
    $('m-login').hidden = true;
    $('m-app').hidden = false;
    $('m-tenant').textContent = me.tenantName;
    $('m-user').textContent = initials(me.fullName);
    const many = barTabs().length > 4;
    $('m-tabs').innerHTML = barTabs().map(t => `<a href="#${t.key}" data-tab="${t.key}">${icon(t.iconName)}<span>${many && t.short ? t.short : t.label}</span></a>`).join('');
    $('m-tabs').classList.toggle('many', many);   // every tab fits on the bar
    $('m-tabs').hidden = tabs().length < 2;
    document.body.classList.toggle('via-link', !!me.linkId);
    $('m-fab').hidden = !(has('EXPENSES') && can('POST_TRANSACTIONS'));
    route();
}

let token = 0;
async function route() {
    if (!me) return;
    const [key, ...params] = (location.hash.slice(1) || 'home').split('/');
    const tab = [...tabs(), MORE].find(t => t.key === key) || tabs()[0];
    const onBar = barTabs().some(t => t.key === tab.key);
    document.querySelectorAll('#m-tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === (onBar ? tab.key : 'more')));
    $('m-title').textContent = tab.label;
    const view = $('m-view');
    const mine = ++token;
    view.innerHTML = '<div class="m-loading"><span></span></div>';
    try {
        const html = await tab.view(params);
        if (mine !== token) return;
        view.innerHTML = html;
        view.scrollTop = 0;
        bind(tab.key, params);
    } catch (error) {
        if (mine === token) view.innerHTML = empty(error.message, 'alert');
    }
}

// ===================================================================== views

async function home() {
    if (!has('DASHBOARD') || (me.linkId && !me.features.includes('DASHBOARD'))) return linkHome();
    const [p, recent] = await Promise.all([
        api.get('/pulse'),
        api.get('/transactions', { limit: 8 }).catch(() => []),
    ]);
    const used = p.budgetUsedPercent === null ? null : Number(p.budgetUsedPercent);
    return `
    <section class="m-hero">
        <small>Net worth</small><b>${money(p.netWorth)}</b>
        <div class="m-hero-row"><span>${icon('bank')}Cash &amp; bank <b>${moneyShort(p.liquid)}</b></span>
            <span>${icon('card')}Cards &amp; dues <b>${moneyShort(p.cardAndPayables)}</b></span></div>
    </section>
    <section class="m-tiles">
        ${tile('receipt', 'Spent this month', money(p.spentThisMonth), used === null ? `today ${moneyShort(p.spentToday)}` : `${percent(used, 0)} of budget`,
            used === null ? '' : `<i class="m-bar ${used > 100 ? 'over' : used > 80 ? 'warn' : ''}"><em style="width:${Math.min(100, used)}%"></em></i>`, has('EXPENSES') ? '#expenses' : '')}
        ${tile('arrow-in', 'Income this month', money(p.incomeThisMonth), 'received', '', has('INCOME') ? '#income' : '')}
        ${tile('hand', 'To collect', money(p.toCollect), p.overdueToCollect ? `<span class="neg">${p.overdueToCollect} overdue</span>` : 'owed to you', '', has('EXPENSES') ? '#expenses/collect' : '')}
        ${tile('calendar', 'Next due', p.nextDueAmount ? money(p.nextDueAmount) : '—', p.nextDueName ? `${esc(p.nextDueName)} · ${shortDate(p.nextDueDate)}` : 'nothing due', '', '')}
    </section>
    ${recent.length ? `<section class="m-card"><div class="m-card-head">${icon('history')}<b>Latest</b></div>
        <div class="m-list">${recent.map(e => `<div class="m-row">${kindChip(e.voucherType, 'sm', e.voucherLabel)}
            <div class="m-row-main"><b>${esc(e.narration)}</b><small>${shortDate(e.entryDate)}${e.party ? ` · ${esc(e.party)}` : ''}</small></div>
            <b class="m-amt ${e.voucherType === 'EXPENSE' ? 'neg' : e.voucherType === 'INCOME' ? 'pos' : ''}">${money(e.amount)}</b></div>`).join('')}</div></section>` : ''}
    ${me.linkId ? linkBanner() : ''}
    <p class="m-foot">${esc(me.fullName)} · ${esc(me.roleLabel)}</p>`;
}

/** Who this link is for, what it allows and until when. */
function linkBanner() {
    const left = new Date(me.linkExpiresAt) - Date.now();
    const h = left / 3600000;
    const ends = h < 1 ? `${Math.max(1, Math.round(left / 60000))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
    return `<section class="m-link-banner"><span class="chip-icon sm violet">${icon('link')}</span>
        <div class="m-row-main"><b>Shared with ${esc(me.fullName)}</b>
            <small>${me.linkMode === 'RECORD' ? `Recorder${me.approval ? ' · each expense needs approval' : ''}` : 'View only'} · ends in ${ends}</small></div></section>`;
}

/** A link without the Dashboard section: a short welcome, the record button and what was sent. */
async function linkHome() {
    const recorder = has('EXPENSES') && can('POST_TRANSACTIONS');
    const mine = me.approval ? await api.get('/approvals/mine').catch(() => []) : [];
    lastMine = mine;
    return `${me.linkId ? linkBanner() : ''}
        <section class="m-total"><small>${esc(me.tenantName)}</small><b>Hello${me.linkId ? `, ${esc(me.fullName.split(/[\s(]/)[0])}` : ''}</b>
            <span>${recorder ? 'Record what you spend: it takes a few taps.' : 'Use the tabs below to see what is shared with you.'}</span></section>
        ${recorder ? `<button class="m-btn primary block m-big-add" id="m-home-add">${icon('plus')}Add an expense</button>` : ''}
        ${mine.length ? submissionsHtml(mine) : ''}`;
}

let lastMine = [];

function submissionsHtml(list) {
    const state = { PENDING: ['warn', 'hourglass', 'Waiting'], APPROVED: ['good', 'check-circle', 'Approved'], REJECTED: ['bad', 'x', 'Sent back'],
        WITHDRAWN: ['', 'undo', 'Taken back'] };
    const back = list.filter(p => p.status === 'REJECTED').length;
    return `<div class="m-day"><b>Sent for approval</b><span>${back ? `<span class="neg">${back} to fix</span> · ` : ''}${list.filter(p => p.status === 'PENDING').length} waiting</span></div>
        <div class="m-list card">${list.map(p => {
            const [tone, ico, label] = state[p.status] || ['', 'info', p.status];
            const fixable = p.editable && p.status === 'REJECTED';
            return `<div class="m-row ${fixable ? 'm-row-fix' : ''}"><span class="m-state ${tone}">${icon(ico)}</span>
                <div class="m-row-main"><b>${esc(p.narration || p.categoryName)}</b><small>${shortDate(p.entryDate)} · ${esc(p.categoryName || '')} · ${label}${p.resubmits ? ` · sent ${p.resubmits + 1}×` : ''}${p.reviewNote ? ` · “${esc(p.reviewNote)}”` : ''}</small>
                    ${fixable ? `<span class="m-fix-actions"><button class="m-btn sm primary" data-fix="${p.id}">${icon('edit')}Fix &amp; send again</button>
                        <button class="m-btn sm" data-withdraw="${p.id}">${icon('undo')}Take back</button></span>` : ''}</div>
                <b class="m-amt">${money(p.amount)}</b></div>`;
        }).join('')}</div>`;
}

const XP_PERIODS = { today: 'Today', month: 'This month', last: 'Last month', collect: 'To collect' };
let xpPeriod = 'month';

async function expenses(params) {
    if (params[0] === 'collect') xpPeriod = 'collect';
    const chips = `<div class="m-chips">${Object.entries(XP_PERIODS).map(([k, l]) => `<button class="m-chip ${xpPeriod === k ? 'on' : ''}" data-xp-period="${k}">${l}</button>`).join('')}</div>`;
    if (xpPeriod === 'collect') {
        const { claims, summary } = await api.get('/claims');
        const open = claims.filter(c => (c.kind === 'LENT' || c.kind === 'PAID_FOR') && Number(c.outstanding) > 0);
        return `${chips}<section class="m-total"><small>Owed to you</small><b>${money(summary.outstanding)}</b><span>${open.length} open${summary.overdueCount ? ` · <span class="neg">${summary.overdueCount} overdue</span>` : ''}</span></section>
            <div class="m-list card">${open.map(c => `<div class="m-row">
                <span class="m-ava">${esc(initials(c.party))}</span>
                <div class="m-row-main"><b>${esc(c.party)}</b><small>${esc(c.narration)} · ${shortDate(c.startDate)}${c.overdue ? ' · <span class="neg">overdue</span>' : c.dueDate ? ` · due ${shortDate(c.dueDate)}` : ''}</small></div>
                <b class="m-amt">${money(c.outstanding)}</b></div>`).join('') || empty('Nobody owes you anything', 'check-circle')}</div>`;
    }
    const t = new Date(isoDate() + 'T00:00:00');
    const [from, to] = xpPeriod === 'today' ? [isoDate(), isoDate()]
        : xpPeriod === 'last' ? [isoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)), isoDate(new Date(t.getFullYear(), t.getMonth(), 0))]
        : [isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), isoDate()];
    const [all, mine] = await Promise.all([api.get('/expenses', { from, to }),
        me.approval ? api.get('/approvals/mine').catch(() => []) : Promise.resolve([])]);
    lastMine = mine;
    const rows = all.sort((a, b) => b.date.localeCompare(a.date) || b.entryId - a.entryId);
    lastExpenses = rows;
    const total = rows.reduce((s, r) => s + Number(r.netAmount ?? r.amount), 0);
    const byCat = new Map();
    rows.forEach(r => byCat.set(r.categoryName, (byCat.get(r.categoryName) || 0) + Number(r.netAmount ?? r.amount)));
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const days = new Map();
    rows.forEach(r => { if (!days.has(r.date)) days.set(r.date, []); days.get(r.date).push(r); });
    return `${chips}
        ${mine.some(p => p.status === 'PENDING' || p.status === 'REJECTED') ? submissionsHtml(mine.filter(p => p.status === 'PENDING' || p.status === 'REJECTED')) : ''}
        <section class="m-total"><small>Spent · ${date(from)}${from !== to ? ` – ${date(to)}` : ''}</small><b>${money(total)}</b><span>${rows.length} expense${rows.length === 1 ? '' : 's'}</span>
            ${top.length ? `<div class="m-cats">${top.map(([n, v]) => { const ci = categoryIcon(n); return `<span><i class="chip-icon xs ${ci.tone}">${icon(ci.name)}</i>${esc(n)} <b>${moneyShort(v)}</b></span>`; }).join('')}</div>` : ''}</section>
        ${rows.length ? [...days.entries()].map(([d, items]) => `
            <div class="m-day"><b>${dayLabel(d)}</b><span>${money(items.reduce((s, r) => s + Number(r.netAmount ?? r.amount), 0))}</span></div>
            <div class="m-list card">${items.map(r => { const ci = categoryIcon(r.categoryName); return `<button class="m-row" data-expense="${r.entryId}-${r.categoryId}">
                <span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
                <div class="m-row-main"><b>${esc(r.narration)}</b><small>${esc(r.categoryName)}${r.party ? ` · ${esc(r.party)}` : ''}</small></div>
                <b class="m-amt ${r.status === 'REVERSED' ? 'muted strike' : 'neg'}">${money(r.netAmount ?? r.amount)}</b></button>`; }).join('')}</div>`).join('')
            : empty(xpPeriod === 'today' ? 'Nothing spent today' : 'No expenses in this period', 'receipt')}`;
}
let lastExpenses = [];

async function accounts(params) {
    const list = (await api.get('/accounts')).filter(a => a.active && (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY'));
    if (params[0]) return statement(list.find(a => a.id === Number(params[0])));
    const assets = list.filter(a => a.accountClass === 'ASSET'), debts = list.filter(a => a.accountClass === 'LIABILITY');
    const sum = l => l.reduce((s, a) => s + Number(a.balance), 0);
    const group = (title, items) => items.length ? `<div class="m-day"><b>${title}</b><span>${money(sum(items))}</span></div>
        <div class="m-list card">${items.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).map(a => { const t = accountTypeIcon(a.accountType); return `<a class="m-row" href="#accounts/${a.id}">
            <span class="chip-icon sm ${t.tone}">${icon(t.name)}</span>
            <div class="m-row-main"><b>${esc(a.name)}</b><small>${esc(a.typeLabel)}${a.institution ? ` · ${esc(a.institution)}` : ''}</small></div>
            <b class="m-amt">${money(a.balance)}</b>${icon('chevron-right', 'm-chev')}</a>`; }).join('')}</div>` : '';
    return `<section class="m-total"><small>Net (assets − liabilities)</small><b>${money(sum(assets) - sum(debts))}</b>
            <span>${moneyShort(sum(assets))} assets · ${moneyShort(sum(debts))} liabilities</span></section>
        ${group('Assets', assets)}${group('Liabilities', debts)}`;
}

/** Statement periods; "All" goes back to the first entry. */
const STMT_PERIODS = { m1: ['1M', 1], m3: ['3M', 3], m6: ['6M', 6], y1: ['1Y', 12], all: ['All', 0] };
let stmtPeriod = 'all';
let stmtRows = [];
let stmtAccount = null;
const STMT_PAGE = 60;

/**
 * An account's statement: any period up to everything, money in and out with clear colours, and for each entry
 * which account was debited and which credited, plus the running balance.
 */
async function statement(a) {
    if (!a) return empty('Account not found', 'wallet');
    const t = new Date(isoDate() + 'T00:00:00');
    const months = STMT_PERIODS[stmtPeriod][1];
    const from = months ? isoDate(new Date(t.getFullYear(), t.getMonth() - months + 1, 1)) : '2000-01-01';
    const ledger = await api.get(`/reports/ledger/${a.id}`, { from, to: isoDate() });
    const debitNormal = a.accountClass === 'ASSET';
    stmtAccount = { a, debitNormal };
    stmtRows = [...ledger.rows].reverse();
    const inflow = ledger.rows.reduce((s, r) => s + (debitNormal ? Number(r.debit) : Number(r.credit)), 0);
    const outflow = ledger.rows.reduce((s, r) => s + (debitNormal ? Number(r.credit) : Number(r.debit)), 0);
    const first = ledger.rows[0]?.date;
    return `<a class="m-back" href="#accounts">${icon('chevron-left')}Accounts</a>
        <section class="m-total"><small>${esc(a.name)} · ${esc(a.typeLabel)}</small><b>${money(a.balance)}</b>
            <div class="m-flow"><span class="in">${icon('arrow-in')}In <b>${money(inflow)}</b></span><span class="out">${icon('arrow-out')}Out <b>${money(outflow)}</b></span></div>
            <span>${ledger.rows.length} entr${ledger.rows.length === 1 ? 'y' : 'ies'} · ${months ? `since ${date(from)}` : first ? `since ${date(first)}` : 'none yet'} · opening ${money(ledger.openingBalance)}</span></section>
        <div class="m-chips">${Object.entries(STMT_PERIODS).map(([k, [l]]) => `<button class="m-chip ${stmtPeriod === k ? 'on' : ''}" data-stmt-period="${k}">${l}</button>`).join('')}</div>
        <div class="m-legend"><span><i class="dr"></i>Dr · debited (money goes to)</span><span><i class="cr"></i>Cr · credited (money comes from)</span></div>
        <div class="m-list card" id="m-stmt">${stmtPage(0) || empty('No entries in this period', 'list')}</div>
        ${stmtRows.length > STMT_PAGE ? `<button class="m-btn block" id="m-stmt-more" data-next="${STMT_PAGE}">Show more · ${stmtRows.length - STMT_PAGE} older</button>` : ''}`;
}

function stmtPage(start) {
    const { a, debitNormal } = stmtAccount;
    return stmtRows.slice(start, start + STMT_PAGE).map(r => {
        const debited = Number(r.debit) > 0;
        const inflow = debitNormal ? debited : !debited;
        const amount = Number(r.debit) + Number(r.credit);
        const other = r.counterAccounts || '—';
        const dr = debited ? a.name : other, cr = debited ? other : a.name;
        return `<div class="m-stmt-row ${inflow ? 'is-in' : 'is-out'}">
            <div class="m-stmt-top">${kindChip(r.voucherType, 'sm', r.voucherLabel)}
                <div class="m-row-main"><b>${esc(r.narration)}</b><small>${date(r.date)} · ${esc(r.voucherLabel)}</small></div>
                <div class="m-amt-col"><b class="m-io ${inflow ? 'in' : 'out'}">${inflow ? '+' : '−'}${money(amount)}</b><small>bal ${money(r.balance)}</small></div></div>
            <div class="m-drcr"><span class="m-pill dr"><em>Dr</em>${esc(dr)}</span>${icon('chevron-right', 'm-drcr-arrow')}<span class="m-pill cr"><em>Cr</em>${esc(cr)}</span></div>
        </div>`;
    }).join('');
}

async function chits(params) {
    if (params[0]) return chitDetail(Number(params[0]));
    const list = await api.get('/chits');
    const running = list.filter(c => (c.status === 'ACTIVE' || c.status === 'PRIZED') && c.payoutAmount === null);
    const sum = (l, k) => l.reduce((s, c) => s + Number(c[k] || 0), 0);
    return `<section class="m-total"><small>${running.length} running chit${running.length === 1 ? '' : 's'}</small><b>${money(sum(running, 'maturityAmount'))}</b>
            <span>paid ${moneyShort(sum(running, 'paidIn'))} · still ${moneyShort(sum(running, 'stillToPay'))} · gain ${moneyShort(sum(running, 'projectedNetGain'))}</span></section>
        ${list.map(c => {
            const pct = (Number(c.paidIn) / (Number(c.totalContribution) || 1)) * 100;
            const lift = c.status === 'ACTIVE' && c.payoutAmount === null ? Math.round(Number(c.paidIn) + Number(c.compoundInterestEarned || 0)) : null;
            const due = c.nextDueDate ? daysFromToday(c.nextDueDate) : null;
            return `<a class="m-chit ${c.payoutAmount !== null || c.status === 'MATURED' || c.status === 'CLOSED' ? 'done' : ''}" href="#chits/${c.id}">
                <div class="m-chit-head"><span class="chip-icon sm gold">${icon('chit')}</span><div class="m-row-main"><b>${esc(c.name)}</b><small>${esc(c.organizer || '')} · ${c.installmentsPaid}/${c.numberOfInstallments}</small></div>
                    <b class="m-amt">${moneyShort(c.maturityAmount)}</b></div>
                <i class="m-bar"><em style="width:${pct}%"></em></i>
                <div class="m-chit-figs">
                    <span><small>Paid in</small><b>${moneyShort(c.paidIn)}</b></span>
                    <span><small>Still to pay</small><b>${moneyShort(c.stillToPay)}</b></span>
                    <span><small>${lift !== null ? 'Take home now' : 'Gain'}</small><b class="${lift !== null ? 'gold' : 'pos'}">${moneyShort(lift ?? (c.realizedGain ?? c.projectedNetGain))}</b></span>
                    <span><small>Next due</small><b class="${due !== null && due < 0 ? 'neg' : ''}">${c.nextDueDate ? shortDate(c.nextDueDate) : '—'}</b></span>
                </div></a>`;
        }).join('') || empty('No chits yet', 'chit')}`;
}

async function chitDetail(id) {
    const { chit: c, installments } = await api.get(`/chits/${id}`);
    return `<a class="m-back" href="#chits">${icon('chevron-left')}Chits</a>
        <section class="m-total"><small>${esc(c.name)} · ${esc(c.organizer || '')}</small><b>${money(c.payoutAmount ?? c.maturityAmount)}</b>
            <span>${c.payoutAmount !== null ? `received ${date(c.payoutDate)}` : `matures ${date(c.maturityDate)}`} · ${c.numberOfInstallments} × ${money(c.monthlyInstallment)}</span></section>
        <section class="m-tiles">
            ${tile('arrow-up', 'Paid in', money(c.paidIn), `${c.installmentsPaid} installments`)}
            ${tile('hourglass', 'Still to pay', money(c.stillToPay), Number(c.overdueAmount) ? `<span class="neg">${money(c.overdueAmount)} overdue</span>` : `${c.installmentsPending} left`)}
            ${tile('piggy', 'Dividends', money(c.dividendsEarned), `cash paid ${moneyShort(c.cashPaid)}`)}
            ${tile('trending', 'Interest so far', money(Math.round(c.compoundInterestEarned)), `gain ${moneyShort(c.realizedGain ?? c.projectedNetGain)}`)}
        </section>
        <div class="m-day"><b>Installments</b><span>${c.installmentsPaid}/${c.numberOfInstallments}</span></div>
        <div class="m-list card">${installments.map(i => `<div class="m-row ${i.status === 'PAID' ? '' : 'pending'}">
            <span class="m-no ${i.status === 'PAID' ? 'paid' : i.overdue ? 'late' : ''}">${i.installmentNo}</span>
            <div class="m-row-main"><b>${date(i.dueDate)}</b><small>${i.status === 'PAID' ? `paid ${shortDate(i.paidDate)}${i.paidFromAccountName ? ` · ${esc(i.paidFromAccountName)}` : ''}` : i.overdue ? '<span class="neg">overdue</span>' : 'due'}${Number(i.dividend) ? ` · dividend ${moneyShort(i.dividend)}` : ''}</small></div>
            <b class="m-amt">${money(i.paidAmount ?? i.dueAmount)}</b></div>`).join('')}</div>`;
}

async function budgets() {
    const month = isoDate().slice(0, 7);
    const s = await api.get('/budgets', { month });
    const lines = s.lines.filter(l => l.budgetId).sort((a, b) => Number(b.usedPercent) - Number(a.usedPercent));
    if (!lines.length) return empty('No budgets this month. Set them on the full site.', 'target');
    const used = Number(s.totalLimit) ? (Number(s.totalSpent) / Number(s.totalLimit)) * 100 : 0;
    const pace = s.daysInMonth ? (s.daysElapsed / s.daysInMonth) * 100 : 0;
    const tone = l => l.committed ? ({ OVERDUE: 'over', DUE_SOON: 'warn', PAID: 'good' }[l.paymentStatus] || '')
        : ({ OVER: 'over', HEADING_OVER: 'warn', AHEAD_OF_PACE: 'warn' }[l.pace] || 'good');
    return `<section class="m-total"><small>${new Date(month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</small>
            <b>${money(s.totalSpent)} <em>of ${moneyShort(s.totalLimit)}</em></b>
            <i class="m-bar big ${used > 100 ? 'over' : used > pace + 10 ? 'warn' : ''}"><em style="width:${Math.min(100, used)}%"></em><u style="left:${Math.min(100, pace)}%"></u></i>
            <span>${percent(used, 0)} used · ${percent(pace, 0)} of the month gone · ${s.daysLeft} days left</span></section>
        <div class="m-list card">${lines.map(l => {
            const ci = categoryIcon(l.categoryName);
            return `<div class="m-budget">
                <div class="m-row-top"><span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span><b>${esc(l.categoryName)}</b>${l.committed ? `<span class="m-tag">${icon('lock')}due ${shortDate(l.dueDate)}</span>` : ''}
                    <span class="spacer"></span><b>${moneyShort(l.spent)}</b><small>/ ${moneyShort(l.monthlyLimit)}</small></div>
                <i class="m-bar ${tone(l)}"><em style="width:${Math.min(100, Number(l.usedPercent))}%"></em></i>
                ${l.insight ? `<small class="m-insight">${esc(l.insight)}</small>` : ''}</div>`;
        }).join('')}</div>`;
}

async function income() {
    const t = new Date(isoDate() + 'T00:00:00');
    const from = isoDate(new Date(t.getFullYear(), t.getMonth(), 1));
    const entries = await api.get('/transactions', { from, to: isoDate(), limit: 2000 });
    const rows = [];
    entries.forEach(e => {
        if (e.voucherType === 'REVERSAL') return;
        e.lines.filter(l => l.accountClass === 'INCOME' && Number(l.credit) > 0).forEach(l => rows.push({ e, source: l.accountName, amount: Number(l.credit) - Number(l.debit) }));
    });
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const bySource = new Map();
    rows.forEach(r => bySource.set(r.source, (bySource.get(r.source) || 0) + r.amount));
    return `<section class="m-total"><small>Received this month</small><b class="pos">${money(total)}</b><span>${rows.length} receipt${rows.length === 1 ? '' : 's'}</span>
            ${bySource.size ? `<div class="m-cats">${[...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `<span>${esc(n)} <b>${moneyShort(v)}</b></span>`).join('')}</div>` : ''}</section>
        <div class="m-list card">${rows.map(r => `<div class="m-row">${kindChip(r.e.voucherType, 'sm', r.e.voucherLabel)}
            <div class="m-row-main"><b>${esc(r.e.narration)}</b><small>${shortDate(r.e.entryDate)} · ${esc(r.source)}</small></div>
            <b class="m-amt pos">${money(r.amount)}</b></div>`).join('') || empty('Nothing received yet this month', 'arrow-in')}</div>`;
}

// ===================================================================== the other sections, kept simple for a phone

/** Every shared section as a grid: the bottom bar holds only the first few. */
function more() {
    const extra = tabs().filter(t => t.key !== 'more');
    return `<div class="m-more">${extra.map(t => `<a class="m-more-item" href="#${t.key}"><span class="chip-icon">${icon(t.iconName)}</span><b>${esc(t.label)}</b>
        <small>${esc(t.note || '')}</small></a>`).join('')}</div>
        ${me.linkId ? linkBanner() : ''}`;
}

const monthRange = offset => {
    const t = new Date(isoDate() + 'T00:00:00');
    const from = new Date(t.getFullYear(), t.getMonth() + offset, 1);
    const to = offset === 0 ? t : new Date(t.getFullYear(), t.getMonth() + offset + 1, 0);
    return [isoDate(from), isoDate(to)];
};
const PERIOD_CHIPS = { month: ['This month', () => monthRange(0)], last: ['Last month', () => monthRange(-1)],
    m3: ['3 months', () => [monthRange(-2)[0], isoDate()]], year: ['This year', () => [`${new Date().getFullYear()}-01-01`, isoDate()]] };
const periodChips = (current, attr) => `<div class="m-chips">${Object.entries(PERIOD_CHIPS).map(([k, [l]]) =>
    `<button class="m-chip ${current === k ? 'on' : ''}" ${attr}="${k}">${l}</button>`).join('')}</div>`;

// ---- Journal: every entry by day; a tap shows its lines
let jrPeriod = 'month';
let lastJournal = [];
async function journal() {
    const [from, to] = PERIOD_CHIPS[jrPeriod][1]();
    const entries = (await api.get('/transactions', { from, to, limit: 600 })).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id);
    lastJournal = entries;
    const days = new Map();
    entries.forEach(e => { if (!days.has(e.entryDate)) days.set(e.entryDate, []); days.get(e.entryDate).push(e); });
    return `${periodChips(jrPeriod, 'data-jr-period')}
        <section class="m-total"><small>Entries · ${date(from)} – ${date(to)}</small><b>${entries.length}</b>
            <span>${money(entries.reduce((s, e) => s + Number(e.amount || 0), 0))} moved</span></section>
        ${entries.length ? [...days.entries()].map(([d, list]) => `<div class="m-day"><b>${dayLabel(d)}</b><span>${list.length}</span></div>
            <div class="m-list card">${list.map(e => `<button class="m-row" data-entry="${e.id}">${kindChip(e.voucherType, 'sm', e.voucherLabel)}
                <div class="m-row-main"><b>${esc(e.narration)}</b><small>${esc(e.entryNo)} · ${esc(e.voucherLabel || '')}${e.party ? ` · ${esc(e.party)}` : ''}</small></div>
                <b class="m-amt ${e.voucherType === 'EXPENSE' ? 'neg' : e.voucherType === 'INCOME' ? 'pos' : ''}">${money(e.amount)}</b></button>`).join('')}</div>`).join('')
            : empty('No entries in this period', 'journal')}`;
}
function entrySheet(e) {
    sheet(`<div class="m-sheet-head">${kindChip(e.voucherType, '', e.voucherLabel)}<div class="m-row-main"><b>${esc(e.narration)}</b><small>${esc(e.entryNo)} · ${date(e.entryDate)}</small></div>
            <b class="m-amt">${money(e.amount)}</b></div>
        <div class="m-list card">${e.lines.map(l => `<div class="m-row"><span class="m-dc ${Number(l.debit) ? 'dr' : 'cr'}">${Number(l.debit) ? 'Dr' : 'Cr'}</span>
            <div class="m-row-main"><b>${esc(l.accountName)}</b>${l.memo ? `<small>${esc(l.memo)}</small>` : ''}</div>
            <b class="m-amt">${money(Number(l.debit) || Number(l.credit))}</b></div>`).join('')}</div>
        ${e.party ? `<dl class="m-facts"><dt>Party</dt><dd>${esc(e.party)}</dd></dl>` : ''}`);
}

// ---- Balance sheet: net worth, then what you own and owe by group
async function balanceSheet() {
    const b = await api.get('/reports/balance-sheet', { asOf: isoDate() });
    const change = Number(b.netWorthChange);
    const section = (sec, tone) => `<div class="m-day"><b>${esc(sec.label)}</b><span>${money(sec.total)}</span></div>
        <div class="m-list card">${sec.groups.filter(g => Number(g.total)).map(g => `<details class="m-group"><summary><b>${esc(g.label)}</b><span class="spacer"></span><b class="${tone}">${money(g.total)}</b></summary>
            ${g.accounts.filter(a => Number(a.amount)).map(a => `<div class="m-row sub"><div class="m-row-main"><span>${esc(a.name)}</span></div><span class="m-amt">${money(a.amount)}</span></div>`).join('')}</details>`).join('')
            || '<div class="m-row"><small>Nothing here</small></div>'}</div>`;
    const ratio = (label, value, note) => `<div class="m-ratio"><small>${label}</small><b>${value}</b><span>${note}</span></div>`;
    return `<section class="m-hero"><small>Net worth · ${date(b.asOf)}</small><b>${money(b.netWorth)}</b>
            <div class="m-hero-row"><span>${change >= 0 ? '▲' : '▼'} <b>${moneyShort(Math.abs(change))}</b> since ${shortDate(b.compareDate)}</span>
                <span>${icon('bank')}Liquid <b>${moneyShort(b.liquidAssets)}</b></span></div></section>
        <div class="m-ratios">
            ${ratio('Emergency fund', `${Number(b.emergencyFundMonths || 0).toFixed(1)} mo`, 'of spending in liquid money')}
            ${ratio('Debt to assets', percent(Number(b.debtToAssetRatio || 0), 0), 'lower is safer')}
        </div>
        ${section(b.assets, 'pos')}
        ${section(b.liabilities, 'neg')}`;
}

// ---- Reports: the period in one screen, highlights first
let rpPeriod = 'month';
async function reports() {
    const [from, to] = PERIOD_CHIPS[rpPeriod][1]();
    const r = await api.get('/reports/insights', { from, to });
    const s = r.summary;
    const delta = v => v === null || v === undefined ? '' : `<span class="${Number(v) > 0 ? 'up' : 'down'}">${Number(v) > 0 ? '▲' : '▼'}${percent(Math.abs(Number(v)), 0)}</span>`;
    const tone = { good: ['good', 'check-circle'], warn: ['warn', 'alert'], info: ['', 'info'] };
    const cats = r.expenseCategories.filter(c => Number(c.amount) > 0).slice(0, 6);
    const maxCat = Math.max(1, ...cats.map(c => Number(c.amount)));
    return `${periodChips(rpPeriod, 'data-rp-period')}
        <section class="m-tiles">
            ${tile('arrow-in', 'Income', money(s.income), delta(s.incomeChangePercent) + ' vs before')}
            ${tile('receipt', 'Spent', money(s.expense), delta(s.expenseChangePercent) + ' vs before')}
            ${tile('piggy', 'Saved', `<span class="${Number(s.net) >= 0 ? 'pos' : 'neg'}">${money(s.net)}</span>`, `${percent(Number(s.savingsRate || 0), 0)} of income`)}
            ${tile('calendar', 'Per day', money(s.averageDailySpend), `${s.entries} entries`)}
        </section>
        ${r.highlights.length ? `<section class="m-card"><div class="m-card-head">${icon('sparkles')}<b>What stands out</b></div>
            <div class="m-list">${r.highlights.slice(0, 5).map(h => `<div class="m-row"><span class="m-state ${tone[h.tone]?.[0] || ''}">${icon(tone[h.tone]?.[1] || 'info')}</span>
                <div class="m-row-main"><b>${esc(h.title)}</b><small>${esc(h.detail)}</small></div></div>`).join('')}</div></section>` : ''}
        ${cats.length ? `<section class="m-card"><div class="m-card-head">${icon('pie')}<b>Where the money went</b></div>
            <div class="m-list">${cats.map(c => { const ci = categoryIcon(c.name); return `<div class="m-budget">
                <div class="m-row-top"><span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span><b>${esc(c.name)}</b><span class="spacer"></span><b>${moneyShort(c.amount)}</b>
                    <small>${delta(c.changePercent)}</small></div>
                <i class="m-bar"><em style="width:${Number(c.amount) / maxCat * 100}%"></em></i></div>`; }).join('')}</div></section>` : ''}
        ${r.topPayees?.length ? `<section class="m-card"><div class="m-card-head">${icon('users')}<b>Paid most to</b></div>
            <div class="m-list">${r.topPayees.slice(0, 5).map(p => `<div class="m-row"><span class="m-ava">${esc(initials(p.label))}</span>
                <div class="m-row-main"><b>${esc(p.label)}</b></div><b class="m-amt">${money(p.value)}</b></div>`).join('')}</div></section>` : ''}`;
}

// ---- Forecast: the next six months of cash, and what is coming
async function forecast() {
    const f = await api.get('/forecast', { months: 6 });
    const max = Math.max(1, ...f.rows.map(m => Math.abs(Number(m.liquidClosing))));
    const label = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    return `<section class="m-hero"><small>Cash &amp; bank in 6 months</small><b>${money(f.endingLiquid)}</b>
            <div class="m-hero-row"><span>Now <b>${moneyShort(f.startingLiquid)}</b></span>
                <span>Lowest <b>${moneyShort(f.lowestLiquid)}</b> · ${esc(f.lowestLiquidMonth ? label(f.lowestLiquidMonth) : '—')}</span></div></section>
        <div class="m-list card">${f.rows.map(m => {
            const net = Number(m.netCashFlow);
            return `<div class="m-budget">
                <div class="m-row-top"><b>${label(m.month)}</b><span class="spacer"></span><small>in ${moneyShort(m.income)} · out ${moneyShort(Number(m.expenses) + Number(m.chitInstallments))}</small>
                    <b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${moneyShort(Math.abs(net))}</b></div>
                <i class="m-bar ${Number(m.liquidClosing) < 0 ? 'over' : ''}"><em style="width:${Math.abs(Number(m.liquidClosing)) / max * 100}%"></em></i>
                <small class="m-insight">Cash at month end ${money(m.liquidClosing)}</small></div>`;
        }).join('')}</div>
        ${f.events?.length ? `<div class="m-day"><b>Coming up</b><span>${f.events.length}</span></div>
            <div class="m-list card">${f.events.slice(0, 8).map(e => `<div class="m-row"><span class="m-when">${shortDate(e.date)}</span>
                <div class="m-row-main"><b>${esc(e.title)}</b><small>${esc(e.kind || '')}</small></div><b class="m-amt">${money(e.amount)}</b></div>`).join('')}</div>` : ''}`;
}

// ---- Gifts: the give-and-take, who to remember, the latest gifts
let gfDir = 'all';
let gfQuery = '';
async function gifts() {
    const all = await api.get('/gifts');
    if (!all.length) return empty('No gifts recorded yet', 'gift');
    const sum = f => all.filter(f).reduce((s, g) => s + Number(g.value || 0), 0);
    const people = new Map();
    all.forEach(g => {
        const k = g.person.trim().toLowerCase();
        const p = people.get(k) || { name: g.person, family: g.family, given: 0, received: 0, last: null, donation: g.donation };
        if (g.direction === 'GIVEN') p.given += Number(g.value || 0); else p.received += Number(g.value || 0);
        if (!p.last || g.giftDate > p.last.giftDate) p.last = g;
        p.family = p.family || g.family;
        people.set(k, p);
    });
    const owe = [...people.values()].filter(p => !p.donation && p.received > p.given).sort((a, b) => (b.received - b.given) - (a.received - a.given)).slice(0, 5);
    const q = gfQuery.toLowerCase();
    const list = all.filter(g => (gfDir === 'all' || g.direction === gfDir) && (!q || `${g.person} ${g.relation || ''} ${g.family || ''} ${g.occasion || ''}`.toLowerCase().includes(q)))
        .sort((a, b) => b.giftDate.localeCompare(a.giftDate)).slice(0, 60);
    return `<section class="m-tiles">
            ${tile('arrow-out', 'Given', money(sum(g => g.direction === 'GIVEN')), `${all.filter(g => g.direction === 'GIVEN').length} gifts`)}
            ${tile('arrow-in', 'Received', money(sum(g => g.direction === 'RECEIVED')), `${people.size} people`)}
        </section>
        ${owe.length ? `<section class="m-card"><div class="m-card-head">${icon('history')}<b>To return the favour</b></div>
            <div class="m-list">${owe.map(p => `<div class="m-row"><span class="m-ava">${esc(initials(p.name))}</span>
                <div class="m-row-main"><b>${esc(p.name)}</b><small>${p.family ? `${esc(p.family)} · ` : ''}last ${shortDate(p.last.giftDate)}${p.last.occasion ? ` · ${esc(p.last.occasion)}` : ''}</small></div>
                <b class="m-amt pos">+${moneyShort(p.received - p.given)}</b></div>`).join('')}</div></section>` : ''}
        <div class="m-search">${icon('search')}<input id="m-gf-q" placeholder="Person, family, occasion…" value="${esc(gfQuery)}"></div>
        <div class="m-chips">${[['all', 'All'], ['GIVEN', 'Given'], ['RECEIVED', 'Received']].map(([k, l]) => `<button class="m-chip ${gfDir === k ? 'on' : ''}" data-gf-dir="${k}">${l}</button>`).join('')}</div>
        <div class="m-list card">${list.map(g => `<div class="m-row"><span class="chip-icon sm ${g.direction === 'GIVEN' ? 'coral' : 'aqua'}">${icon(g.direction === 'GIVEN' ? 'arrow-out' : 'arrow-in')}</span>
            <div class="m-row-main"><b>${esc(g.person)}</b><small>${shortDate(g.giftDate)}${g.occasion ? ` · ${esc(g.occasion)}` : ''}${g.kind !== 'CASH' ? ` · ${esc(g.kind.toLowerCase())}` : ''}</small></div>
            <b class="m-amt ${g.direction === 'GIVEN' ? 'neg' : 'pos'}">${g.value ? money(g.value) : '—'}</b></div>`).join('') || empty('Nothing matches', 'search')}</div>`;
}

let docList = [];

/** The family's documents by person; a tap opens the scans with Share (the files themselves, or a link). */
async function documents() {
    docList = await api.get('/documents');
    if (!docList.length) return empty('No documents yet. Add them on the full site.', 'file-text');
    const byOwner = new Map();
    docList.forEach(d => { if (!byOwner.has(d.owner)) byOwner.set(d.owner, []); byOwner.get(d.owner).push(d); });
    const soon = docList.filter(d => d.expiresOn && daysFromToday(d.expiresOn) <= 180);
    return `${soon.length ? `<section class="m-link-banner warn"><span class="chip-icon sm gold">${icon('clock')}</span><div class="m-row-main"><b>${soon.length} need${soon.length === 1 ? 's' : ''} renewing soon</b>
            <small>${soon.map(d => `${esc(d.title)} (${esc(d.owner)})`).slice(0, 3).join(', ')}</small></div></section>` : ''}
        ${[...byOwner.entries()].map(([owner, docs]) => `<div class="m-day"><b>${esc(owner)}</b><span>${docs.length}</span></div>
        <div class="m-list card">${docs.map(d => {
            const [label, ico, tone] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
            const days = d.expiresOn ? daysFromToday(d.expiresOn) : null;
            return `<button class="m-row" data-doc="${d.id}"><span class="chip-icon sm ${tone}">${icon(ico)}</span>
                <div class="m-row-main"><b>${esc(d.title)}</b><small>${esc(label)}${d.docNumber ? ` · ${esc(maskNo(d.docNumber))}` : ''}${days !== null ? ` · <span class="${days < 0 ? 'neg' : days <= 180 ? 'warn-ink' : ''}">${days < 0 ? 'expired' : `till ${shortDate(d.expiresOn)}`}</span>` : ''}</small></div>
                <span class="m-files">${icon('paperclip')}${d.fileCount}</span></button>`;
        }).join('')}</div>`).join('')}`;
}

const maskNo = n => String(n).length <= 4 ? '••••' : '••••' + String(n).slice(-4);

async function documentSheet(d) {
    const files = d.fileCount ? await api.get('/attachments', { documentId: d.id }) : [];
    const el = sheet(`<div class="m-sheet-head"><span class="chip-icon">${icon((DOC_TYPES[d.docType] || DOC_TYPES.OTHER)[1])}</span>
            <div class="m-row-main"><b>${esc(d.title)}</b><small>${esc(d.owner)}${d.relation ? ` · ${esc(d.relation)}` : ''}</small></div></div>
        <dl class="m-facts">
            ${d.docNumber ? `<dt>Number</dt><dd><span class="mono" data-no>${esc(maskNo(d.docNumber))}</span> <button class="m-mini" data-reveal>${icon('eye')}</button></dd>` : ''}
            ${d.issuer ? `<dt>Issued by</dt><dd>${esc(d.issuer)}</dd>` : ''}
            ${d.issuedOn ? `<dt>Issued</dt><dd>${date(d.issuedOn)}</dd>` : ''}
            ${d.expiresOn ? `<dt>Valid until</dt><dd>${date(d.expiresOn)}</dd>` : ''}
        </dl>
        <div class="m-scans">${files.map((f, i) => `<button class="m-scan" data-scan="${i}">${f.image ? `<img data-thumb="${f.id}" alt="">` : '<span>PDF</span>'}</button>`).join('') || '<p class="m-note">No scan yet.</p>'}</div>
        ${files.length ? `<button class="m-btn primary block" data-share-files>${icon('upload')}Send the document (WhatsApp, Mail…)</button>` : ''}
        ${files.length && can('POST_TRANSACTIONS') && !me.linkId ? `<button class="m-btn block" data-share-link>${icon('link')}Share a link for 1 day</button>` : ''}
        <button class="m-btn block" data-close>Close</button>`);
    el.querySelectorAll('img[data-thumb]').forEach(img => fileUrl(img.dataset.thumb, true).then(u => { img.src = u; }).catch(() => fileUrl(img.dataset.thumb, false).then(u => { img.src = u; }).catch(() => {})));
    el.addEventListener('click', async e => {
        if (e.target.closest('[data-reveal]')) el.querySelector('[data-no]').textContent = d.docNumber;
        const scan = e.target.closest('[data-scan]');
        if (scan) openViewer(files, Number(scan.dataset.scan), { canEdit: false });
        if (e.target.closest('[data-share-files]')) {
            try {
                const blobs = await Promise.all(files.map(async f => new File([await api.blob(`/attachments/${f.id}/file`)], f.fileName, { type: f.contentType })));
                if (navigator.canShare?.({ files: blobs })) await navigator.share({ files: blobs, title: `${d.title} (${d.owner})` });
                else toast('This phone cannot share files from the browser; share a link instead');
            } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
        }
        if (e.target.closest('[data-share-link]')) {
            try {
                const made = await api.post(`/documents/${d.id}/shares`, { sharedWith: null, hours: 24, allowDownload: true });
                const url = `${location.origin}/share.html#${made.token}`;
                const text = `${d.title} (${d.owner}), available for 1 day: ${url}`;
                if (navigator.share) await navigator.share({ title: d.title, text, url }).catch(() => {});
                else location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
            } catch (error) { toast(error.message); }
        }
    });
}

// ===================================================================== interactions

function bind(key) {
    const view = $('m-view');
    view.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => documentSheet(docList.find(d => d.id === Number(b.dataset.doc)))));
    view.querySelectorAll('[data-stmt-period]').forEach(b => b.addEventListener('click', () => { stmtPeriod = b.dataset.stmtPeriod; route(); }));
    view.querySelector('#m-stmt-more')?.addEventListener('click', e => {
        const next = Number(e.currentTarget.dataset.next);
        view.querySelector('#m-stmt').insertAdjacentHTML('beforeend', stmtPage(next));
        const left = stmtRows.length - next - STMT_PAGE;
        if (left > 0) { e.currentTarget.dataset.next = next + STMT_PAGE; e.currentTarget.textContent = `Show more · ${left} older`; }
        else e.currentTarget.remove();
    });
    view.querySelector('#m-home-add')?.addEventListener('click', () => addExpense());
    view.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
        const p = lastMine.find(x => x.id === Number(b.dataset.fix));
        if (p) addExpense({ resubmit: p });
    }));
    view.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
        const p = lastMine.find(x => x.id === Number(b.dataset.withdraw));
        if (!p || !confirm(`Take back "${p.narration || p.categoryName}" (${money(p.amount)})? It will not be recorded.`)) return;
        try { await api.post(`/approvals/${p.id}/withdraw`); toast('Taken back'); route(); } catch (error) { toast(error.message); }
    }));
    view.querySelectorAll('[data-jr-period]').forEach(b => b.addEventListener('click', () => { jrPeriod = b.dataset.jrPeriod; route(); }));
    view.querySelectorAll('[data-rp-period]').forEach(b => b.addEventListener('click', () => { rpPeriod = b.dataset.rpPeriod; route(); }));
    view.querySelectorAll('[data-gf-dir]').forEach(b => b.addEventListener('click', () => { gfDir = b.dataset.gfDir; route(); }));
    view.querySelectorAll('[data-entry]').forEach(b => b.addEventListener('click', () => {
        const e = lastJournal.find(x => x.id === Number(b.dataset.entry));
        if (e) entrySheet(e);
    }));
    const gq = view.querySelector('#m-gf-q');
    if (gq) {
        let t;
        gq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
            gfQuery = gq.value;
            const pos = gq.selectionStart;
            await route();
            const again = $('m-view').querySelector('#m-gf-q');
            again?.focus(); again?.setSelectionRange(pos, pos);
        }, 300); });
    }
    if (key === 'expenses') {
        view.querySelectorAll('[data-xp-period]').forEach(b => b.addEventListener('click', () => {
            xpPeriod = b.dataset.xpPeriod;
            if (location.hash !== '#expenses') location.hash = '#expenses'; else route();
        }));
        view.querySelectorAll('[data-expense]').forEach(b => b.addEventListener('click', () => {
            const r = lastExpenses.find(x => `${x.entryId}-${x.categoryId}` === b.dataset.expense);
            if (r) expenseSheet(r);
        }));
    }
}

function expenseSheet(r) {
    const ci = categoryIcon(r.categoryName);
    sheet(`<div class="m-sheet-head"><span class="chip-icon ${ci.tone}">${icon(ci.name)}</span><div class="m-row-main"><b>${esc(r.narration)}</b><small>${esc(r.categoryName)}</small></div>
            <b class="m-amt neg">${money(r.netAmount ?? r.amount)}</b></div>
        <dl class="m-facts">
            <dt>Date</dt><dd>${date(r.date)}</dd>
            <dt>Paid from</dt><dd>${esc(r.paidFrom)}</dd>
            ${r.party ? `<dt>Paid to</dt><dd>${esc(r.party)}</dd>` : ''}
            ${r.reference ? `<dt>Reference</dt><dd>${esc(r.reference)}</dd>` : ''}
            ${r.memo ? `<dt>Notes</dt><dd>${esc(r.memo)}</dd>` : ''}
            ${r.status ? `<dt>Status</dt><dd>${esc(r.status.toLowerCase().replace('_', ' '))}${Number(r.refunded) ? ` · ${money(r.refunded)} back` : ''}</dd>` : ''}
            <dt>Entry</dt><dd class="muted">${esc(r.entryNo)} · by ${esc(r.createdBy || '')}</dd>
        </dl>
        <button class="m-btn block" data-close>Close</button>`);
}

/**
 * Add an expense in a few taps: amount, category (most used first), paid from, what for, when. With
 * {@code resubmit} (an entry sent back by the checker) the sheet opens filled in and sends the correction.
 */
async function addExpense({ resubmit = null } = {}) {
    // categories (most used first), paying accounts (no balances) and past descriptions, already ordered
    const { categories, payers: payerOptions, recent } = await api.get('/expenses/form-options');
    const payers = payerOptions.map(a => ({ ...a, accountType: a.type }));
    const past = recent.slice(0, 40);
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };
    const el = sheet(`<form class="m-form" id="m-xp-form" autocomplete="off">
        <div class="m-sheet-title">${icon(resubmit ? 'edit' : 'receipt')}<b>${resubmit ? 'Fix and send again' : 'Add expense'}</b>${me.approval || resubmit ? '<span class="m-tag">needs approval</span>' : ''}</div>
        ${resubmit?.reviewNote ? `<p class="m-note m-sent-back">${icon('x')} Sent back${resubmit.reviewedBy ? ` by ${esc(resubmit.reviewedBy)}` : ''}: “${esc(resubmit.reviewNote)}”</p>` : ''}
        <label class="m-amount"><span>₹</span><input name="amount" type="number" inputmode="decimal" step="any" min="0.01" required placeholder="0"></label>
        <div class="m-label">Category</div>
        <div class="m-pick" data-group="category">${categories.slice(0, 8).map(c => { const ci = categoryIcon(c.name); return `<button type="button" class="m-pick-chip" data-value="${c.id}"><i class="chip-icon xs ${ci.tone}">${icon(ci.name)}</i>${esc(c.name)}</button>`; }).join('')}</div>
        ${categories.length > 8 ? `<select name="moreCategory" class="m-select"><option value="">More categories…</option>${categories.slice(8).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>` : ''}
        <div class="m-label">Paid from</div>
        <div class="m-pick" data-group="payer">${payers.slice(0, 6).map((a, i) => `<button type="button" class="m-pick-chip ${i === 0 ? 'on' : ''}" data-value="${a.id}">${icon(accountTypeIcon(a.accountType).name)}${esc(a.name)}</button>`).join('')}</div>
        <label class="m-field"><span>What for</span><input name="narration" list="m-past" placeholder="e.g. Groceries, auto fare"></label>
        <datalist id="m-past">${past.map(s => `<option value="${esc(s.value)}">`).join('')}</datalist>
        <label class="m-field"><span>Shop / person <small>optional</small></span><input name="party"></label>
        ${evidenceFieldHtml({ label: 'Bill / receipt', hint: 'Camera or upload' })}
        <div class="m-label">When</div>
        <div class="m-pick" data-group="date">${[[0, 'Today'], [1, 'Yesterday'], [2, '2 days ago']].map(([n, l]) => `<button type="button" class="m-pick-chip ${n === 0 ? 'on' : ''}" data-value="${day(n)}">${l}</button>`).join('')}
            <input type="date" name="customDate" max="${isoDate()}" class="m-date"></div>
        <p class="m-error" id="m-xp-error"></p>
        <button type="submit" class="m-btn primary block">${icon('check')}${resubmit ? 'Send again' : me.approval ? 'Send for approval' : 'Save expense'}</button>
    </form>`);
    const form = el.querySelector('form');
    const evidence = bindEvidenceField(el);
    const picked = { category: '', payer: payers[0] ? String(payers[0].id) : '', date: isoDate() };
    if (resubmit) {   // what was sent, ready to correct
        form.amount.value = resubmit.amount;
        form.narration.value = resubmit.narration || '';
        form.party.value = resubmit.party || '';
        picked.category = String(resubmit.categoryId);
        const chip = form.querySelector(`[data-group="category"] [data-value="${resubmit.categoryId}"]`);
        if (chip) chip.classList.add('on'); else if (form.moreCategory) form.moreCategory.value = String(resubmit.categoryId);
        if (form.querySelector(`[data-group="payer"] [data-value="${resubmit.paidFromId}"]`)) {
            picked.payer = String(resubmit.paidFromId);
            form.querySelectorAll('[data-group="payer"] .m-pick-chip').forEach(c => c.classList.toggle('on', c.dataset.value === picked.payer));
        }
        picked.date = resubmit.entryDate;
        const dateChip = form.querySelector(`[data-group="date"] [data-value="${resubmit.entryDate}"]`);
        form.querySelectorAll('[data-group="date"] .m-pick-chip').forEach(c => c.classList.toggle('on', c === dateChip));
        if (!dateChip) form.customDate.value = resubmit.entryDate;
    }
    form.addEventListener('click', e => {
        const chip = e.target.closest('.m-pick-chip');
        if (!chip) return;
        const group = chip.closest('[data-group]').dataset.group;
        picked[group] = chip.dataset.value;
        chip.parentElement.querySelectorAll('.m-pick-chip').forEach(c => c.classList.toggle('on', c === chip));
        if (group === 'category' && form.moreCategory) form.moreCategory.value = '';
        if (group === 'date') form.customDate.value = '';
    });
    form.moreCategory?.addEventListener('change', () => {
        picked.category = form.moreCategory.value;
        form.querySelectorAll('[data-group="category"] .m-pick-chip').forEach(c => c.classList.remove('on'));
    });
    form.customDate.addEventListener('change', () => {
        if (!form.customDate.value) return;
        picked.date = form.customDate.value;
        form.querySelectorAll('[data-group="date"] .m-pick-chip').forEach(c => c.classList.remove('on'));
    });
    // a past description picks its category and account
    form.narration.addEventListener('change', () => {
        const s = past.find(x => x.value.toLowerCase() === form.narration.value.trim().toLowerCase());
        if (!s) return;
        if (s.categoryId) {
            picked.category = String(s.categoryId);
            const chip = form.querySelector(`[data-group="category"] [data-value="${s.categoryId}"]`);
            form.querySelectorAll('[data-group="category"] .m-pick-chip').forEach(c => c.classList.toggle('on', c === chip));
            if (!chip && form.moreCategory) form.moreCategory.value = String(s.categoryId);
        }
        if (s.creditAccountId && form.querySelector(`[data-group="payer"] [data-value="${s.creditAccountId}"]`)) {
            picked.payer = String(s.creditAccountId);
            form.querySelectorAll('[data-group="payer"] .m-pick-chip').forEach(c => c.classList.toggle('on', c.dataset.value === picked.payer));
        }
        if (!form.amount.value && s.amount) form.amount.value = s.amount;
    });
    // one key for this form: however often it is sent (double tap, retry), the server records it once
    const requestKey = newRequestKey();
    let busy = false;
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabel = submitBtn.innerHTML;
    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (busy) return;   // already sending: a second tap does nothing
        const error = el.querySelector('#m-xp-error');
        error.textContent = '';
        if (!picked.category) { error.textContent = 'Pick a category'; return; }
        if (!picked.payer) { error.textContent = 'Pick the account you paid from'; return; }
        const category = categories.find(c => String(c.id) === picked.category);
        busy = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="m-spin"></span>${resubmit ? 'Sending…' : me.approval ? 'Sending for approval…' : 'Saving…'}`;
        try {
            const body = { entryDate: picked.date, amount: form.amount.value, categoryId: Number(picked.category),
                paidFromId: Number(picked.payer), narration: form.narration.value.trim() || category.name, party: form.party.value.trim() };
            const saved = resubmit ? { ...(await api.post(`/approvals/${resubmit.id}/resubmit`, { ...body, reference: resubmit.reference, notes: resubmit.notes }, { key: requestKey })), pending: true }
                : await api.post('/expenses', body, { key: requestKey });
            const files = evidence.count;
            if (files) await evidence.uploadTo(saved?.pending ? null : saved.id, { pendingId: saved?.pending ? saved.id : null });
            closeSheet();
            toast(`${saved?.pending ? `${money(form.amount.value)} sent for approval${resubmit ? ' again' : ''}` : `${category.name} · ${money(form.amount.value)} saved`}${files ? ` with ${files} file${files === 1 ? '' : 's'}` : ''}`);
            route();
        } catch (err) {
            error.textContent = err.message;
            busy = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = submitLabel;
        }
    });
    setTimeout(() => form.amount.focus(), 250);
}

function userSheet() {
    sheet(`<div class="m-sheet-head"><span class="m-ava lg">${esc(initials(me.fullName))}</span><div class="m-row-main"><b>${esc(me.fullName)}</b>
            <small>${esc(me.username)} · ${esc(me.roleLabel)} · ${esc(me.tenantName)}</small></div></div>
        <p class="m-note">${icon('eye')} On mobile: ${tabs().map(t => t.label).join(', ')}</p>
        ${me.linkId ? linkBanner() : `<a class="m-btn block" href="/">${icon('dashboard')}Open the full site</a>`}
        <button class="m-btn block danger" id="m-logout">${icon('log-out')}Sign out</button>`)
        .querySelector('#m-logout').addEventListener('click', async () => {
            try { await api.post('/auth/logout'); } catch { /* already signed out */ }
            session.token = null;
            closeSheet();
            showLogin();
        });
}

// ===================================================================== small pieces

function tile(iconName, label, value, note, extra = '', href = '') {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="m-tile" ${href ? `href="${href}"` : ''}><span class="m-tile-icon">${icon(iconName)}</span><small>${label}</small><b>${value}</b>${extra}<span class="m-tile-note">${note}</span></${tag}>`;
}

function empty(text, iconName = 'droplet') {
    return `<div class="m-empty">${icon(iconName)}<p>${esc(text)}</p></div>`;
}

function initials(name) {
    const words = String(name || '?').split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w));
    return (words.length ? words : ['?']).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function dayLabel(iso) {
    const diff = Math.round((new Date(isoDate() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

function sheet(html) {
    closeSheet();
    const back = document.createElement('div');
    back.className = 'm-sheet-back';
    back.innerHTML = `<div class="m-sheet"><span class="m-grip"></span>${html}</div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('open'));
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) closeSheet(); });
    return back;
}

function closeSheet() {
    document.querySelectorAll('.m-sheet-back').forEach(s => s.remove());
}

let toastTimer;
function toast(text) {
    const el = $('m-toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
