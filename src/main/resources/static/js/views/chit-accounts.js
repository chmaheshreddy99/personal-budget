/**
 * Host a Chit › Chit accounts: the accounts that hold the money of the chits the user hosts, kept off the personal
 * Accounts page because most of that money is the members'.
 *
 * Laid out like the Chits and Accounts pages: a card with the money held for the chits (owed to the members against
 * the organiser's own) and figures on top, the accounts on the left grouped as common chit accounts, each chit's own
 * accounts, what is owed to the members and the personal accounts that hold chit money; on the right the selected
 * chit (where its money is, month by month, its transfers) or account (statement and transfers).
 *
 * Every journal line that moves a chit's money carries the chit, so the page can say where a chit's money is even
 * when members paid into the organiser's personal bank accounts, and suggest consolidating it. Transfers move money
 * from one or more accounts into one, as one journal entry: chit money (consolidation, both sides carry the chit) or
 * the organiser's own (an advance into a chit, or the commission taken out).
 */
import { api } from '../core/api.js';
import { can, loadAccounts } from '../core/store.js';
import { panel, esc, openModal, confirmDialog, toast, emptyState, loading, narrativeHtml } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, isoDate, firstOfMonth } from '../core/format.js';
import { chitStatus, chitTrailHtml, hasChitStatus, shortNarration, shortAccount, chitTag, chitCodeOf } from '../core/chit-trail.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { openEntryDetail } from '../components/transaction-forms.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { getPref, setPref } from '../core/prefs.js';

/** chit: the chit the page shows (its accounts and the shared ones holding its money), or null for all chits. */
const view = { selected: null, tab: 'where', range: '3m', chitOnly: true, chit: getPref('chitAccounts', { chit: undefined }).chit };
const MODES = ['Bank', 'UPI', 'Cash'];
const TYPES = [['BANK', 'Bank account', 'bank'], ['CASH', 'Cash', 'cash'], ['WALLET', 'Wallet', 'wallet']];
const ROLE = {
    COLLECTION: ['Collections', 'arrow-in', 'aqua'], COMMISSION: ['Commission', 'piggy', 'gold'], LATE_FEE: ['Late interest', 'clock', 'coral'],
    COMMON: ['Common', 'layers', 'ocean'], FUNDS: ['Owed to members', 'users', 'violet'],
    DIRECT: ['Paid to winners directly', 'hand', 'teal'],
};
const KIND = {
    CONSOLIDATE: ['merge', 'Consolidated', 'aqua'], MOVE: ['transfer', 'Moved', 'ocean'], ADVANCE: ['arrow-in', 'My money in', 'violet'],
    WITHDRAW: ['arrow-out', 'Taken out', 'gold'],
};
const RANGES = [['1m', 'This month', () => firstOfMonth(0)], ['3m', '3 months', () => firstOfMonth(-2)], ['12m', '12 months', () => firstOfMonth(-11)],
    ['all', 'All', () => '2000-01-01']];

const num = v => Number(v || 0);
const manage = () => can('MANAGE_CHITS');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const signed = v => `${num(v) < 0 ? '−' : ''}${money(Math.abs(num(v)))}`;
const roleOf = a => ROLE[a.role] || ROLE.COMMON;

/** Opens the page on a chit ("chit:5"), an account ("acct:12") or all transfers ("transfers"). */
export function focus(key) {
    view.tab = 'statement';
    if (key?.startsWith('chit:')) { view.chit = Number(key.slice(5)); view.selected = null; }
    else { view.chit = null; view.selected = key; }   // any account: shown among every chit's
}

/**
 * The micro switch in the top card that shows the figures (the cards beside it and a chit's key tiles); hidden by
 * default to give the chit itself the room. Shared by both halves of Host a Chit and remembered.
 */
export function statsToggleHtml() {
    const on = getPref('hostChitStats', { show: false }).show;
    return `<label class="cs-mini-switch hc-stats-switch" title="Show or hide the figures"><input type="checkbox" data-stats-toggle ${on ? 'checked' : ''}><i></i>figures</label>`;
}

export function bindStatsToggle(container) {
    if (container.dataset.hcBound) return;   // the page container is reused: bind once
    container.dataset.hcBound = '1';
    // the section switch: the thumb slides to the other side first, then the page changes
    container.addEventListener('click', e => {
        const opt = e.target.closest('.hc-switch-opt');
        if (!opt || opt.classList.contains('active')) return;
        e.preventDefault();
        const sw = opt.closest('.hc-switch');
        sw.classList.toggle('chits'); sw.classList.toggle('accounts');
        sw.querySelectorAll('.hc-switch-opt').forEach(x => x.classList.toggle('active', x === opt));
        setTimeout(() => { location.hash = opt.getAttribute('href'); }, 180);
    });
    container.addEventListener('change', e => {
        if (!e.target.matches?.('[data-stats-toggle]')) return;
        setPref('hostChitStats', { show: e.target.checked });
        container.querySelector('.hc-page')?.classList.toggle('stats-hidden', !e.target.checked);
    });
}

/** The page's two halves, as a switch in the top card: the chits themselves and their accounts. */
export function sectionSwitch(active) {
    return `<div class="hc-switch ${active}" role="tablist" aria-label="Host a Chit"><i class="hc-switch-thumb"></i>
        <a class="hc-switch-opt ${active === 'chits' ? 'active' : ''}" href="#/host-chits" role="tab" aria-selected="${active === 'chits'}">${icon('hand-coins')}Chits</a>
        <a class="hc-switch-opt ${active === 'accounts' ? 'active' : ''}" href="#/host-chits/accounts" role="tab" aria-selected="${active === 'accounts'}">${icon('wallet')}Chit accounts</a></div>`;
}

/**
 * <option>s for an account a chit's money can go into or come from, grouped: the chit's own accounts, the common chit
 * accounts, then the user's own cash / bank / wallet accounts. Other chits' own accounts are left out.
 * amounts: account id -> figure shown beside the name (default: the balance).
 */
export function moneyAccountOptions(accounts, { chitId = null, chitName = 'This chit', selected = null, placeholder = 'Pick an account', amounts = null } = {}) {
    const liquid = a => a.active && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.accountType);
    const groups = [
        [`${chitName}'s accounts`, accounts.filter(a => liquid(a) && a.chitBook && chitId && a.hostedChitId === chitId)],
        ['Common chit accounts', accounts.filter(a => liquid(a) && a.chitBook && !a.hostedChitId)],
        ['My accounts', accounts.filter(a => liquid(a) && !a.chitBook)],
    ];
    // with amounts (a chit's money by account) every option shows that chit's money in it, 0 where there is none
    const opt = a => `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''} data-type="${a.accountType}"
        data-balance="${amounts ? num(amounts[a.id]) : a.balance}" data-meta="${esc([amounts ? `${chitName}'s money` : a.typeLabel, a.institution].filter(Boolean).join(' · '))}">${esc(a.name)}</option>`;
    return `<option value="">${esc(placeholder)}</option>` + groups.filter(([, list]) => list.length)
        .map(([label, list]) => `<optgroup label="${esc(label)}">${list.map(opt).join('')}</optgroup>`).join('');
}

// ===================================================================== page

export async function render(container, _params, isCurrent) {
    // coming from Chits the page stays on screen until this one is drawn (no spinner in between)
    if (!container.querySelector('.hc-page')) container.innerHTML = loading();
    const [book, accounts] = await Promise.all([api.get('/hosted-chits/book'), loadAccounts(true, { all: true })]);
    if (!isCurrent()) return;
    bindStatsToggle(container);
    const reload = async (selected = view.selected) => {
        view.selected = selected;
        const fresh = await api.get('/hosted-chits/book');
        if (!document.body.contains(container)) return;
        draw(container, fresh, await loadAccounts(true, { all: true }), reload);
    };
    draw(container, book, accounts, reload);
}

function draw(container, book, accounts, reload) {
    // one chit at a time (the first one to start with), or every chit
    if (view.chit === undefined || (view.chit !== null && !book.chits.some(c => c.id === view.chit))) view.chit = book.chits[0]?.id ?? null;
    const chit = book.chits.find(c => c.id === view.chit) || null;
    const items = listItems(book, chit);
    if (!items.some(i => i.key && i.key === view.selected)) view.selected = items.find(i => i.key)?.key || null;
    const assets = book.accounts.filter(a => a.accountClass === 'ASSET');
    const m = chit?.money;
    const total = chit ? num(m.held) : num(book.held) + num(book.inPersonal) - num(book.advanced);
    const owed = chit ? num(m.owedToMembers) : num(book.owedToMembers);
    const owedPct = total > 0 ? Math.min(100, (owed / total) * 100) : 0;

    container.innerHTML = `
    <div class="page chits-page hc-page ca-page ${getPref('hostChitStats', { show: false }).show ? '' : 'stats-hidden'}">
        <section class="cp-card ca-brand">
            <div class="cp-head"><span class="cp-mark">${icon(chit ? (chit.chitType === 'AUCTION' ? 'gavel' : 'hand-coins') : 'wallet')}</span>
                <div class="min-0"><small>${chit ? `Money held for ${esc(chit.name)}` : 'Money held for my chits'}</small><b>${moneyShort(total)}</b></div>
                <span class="cp-rate" title="Commission and late interest earned so far">${moneyShort(chit ? m.earned : book.earned)}<small>earned</small></span></div>
            <div class="cp-progress" title="Owed to the members against your own money in the chit${chit ? '' : 's'}">
                <i class="onc-bar ca-split"><em style="width:${owedPct}%"></em></i>
                <span>${moneyShort(owed)} owed to members · ${moneyShort(chit ? m.mine : book.mine)} mine</span></div>
            <div class="cp-foot">${sectionSwitch('accounts')}${statsToggleHtml()}
                <span class="cp-pill run">${icon('wallet')}${plural(chit ? items.filter(i => i.kind === 'account' && !i.liability).length : assets.length, 'account')}</span></div>
        </section>
        <div class="cs-cards" id="ca-cards">${chit ? chitCardsHtml(book, chit) : cardsHtml(book)}</div>
        <section class="panel p-chit-list ca-list-panel">
            <header class="panel-head">
                <h3><span class="ico">${icon(chit ? chitIconOf(chit) : 'wallet')}</span><span class="ca-filter ca-head-pick"><label class="ca-filter-pick" title="Pick a chit, or every chit">
                    <select id="ca-chit" aria-label="Chit">
                        ${book.chits.map(c => `<option value="${c.id}" ${c.id === view.chit ? 'selected' : ''} data-balance="${c.money.held}"
                            data-meta="${esc(`${c.status === 'COMPLETED' ? 'finished · ' : ''}owed ${moneyShort(c.money.owedToMembers)}`)}">${esc(c.name)}</option>`).join('')}
                        <option value="all" ${view.chit === null ? 'selected' : ''} data-meta="every chit, grouped">All chits</option></select></label></span></h3>
                <div class="actions">${manage() ? `<button class="btn sm icon hc-add" id="ca-transfer" title="Move money between accounts" aria-label="Move money">${icon('transfer')}</button>
                    <button class="btn sm primary icon hc-add" id="ca-new" title="Add a chit account" aria-label="Add a chit account">${icon('plus')}</button>` : ''}</div>
            </header>
            <div class="panel-body flush"><div class="chit-rows scroll" id="ca-list" tabindex="0" aria-label="Chit accounts, use the arrow keys to move">${listHtml(book, items, chit)}</div></div>
        </section>
        <div class="chit-detail" id="ca-detail"></div>
    </div>`;
    container.querySelector('#ca-chit').addEventListener('change', e => {
        view.chit = e.target.value === 'all' ? null : Number(e.target.value);
        setPref('chitAccounts', { chit: view.chit });
        view.selected = null;
        view.tab = 'statement';
        draw(container, book, accounts, reload);
    });

    const listEl = container.querySelector('#ca-list');
    const select = key => {
        view.selected = key;
        listEl.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('selected', el.dataset.key === key));
        listEl.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest' });
        drawDetail(container, book, accounts, reload);
    };
    listEl.addEventListener('click', e => {
        const label = e.target.closest('[data-chit-filter]');
        if (label) {
            view.chit = Number(label.dataset.chitFilter);
            setPref('chitAccounts', { chit: view.chit });
            view.selected = null;
            draw(container, book, accounts, reload);
            return;
        }
        const row = e.target.closest('[data-key]');
        if (row) select(row.dataset.key);
    });
    let keyTimer;
    setPageKeys(listNavigator({
        items: () => [...listEl.querySelectorAll('[data-key]')],
        selected: () => listEl.querySelector('.selected'),
        select: el => {
            listEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => select(el.dataset.key), 130);
        },
    }));
    container.querySelector('#ca-new')?.addEventListener('click', () => openAccountForm(book, null, { reload, accounts }));
    container.querySelector('#ca-transfer')?.addEventListener('click', () => openTransfer({ book, accounts, chitId: view.chit, onDone: reload }));
    container.querySelector('#ca-cards').addEventListener('click', e => {
        const card = e.target.closest('[data-go]');
        if (card) select(card.dataset.go);
    });
    if (view.selected) select(view.selected);
    else container.querySelector('#ca-detail').innerHTML = welcomeHtml();
}

function welcomeHtml() {
    return panel({ title: 'Chit accounts', iconName: 'wallet', body: `
        <div class="hc-welcome">
            <span class="hc-welcome-ico">${icon('wallet')}</span>
            <h3>The money of the chits you host</h3>
            <p>Each chit gets its own accounts for collections and commission when you host it. Add <b>common</b> accounts
                (say, a bank account you keep only for chits), move money in and out, and see where every chit's money is.</p>
            <div class="row wrap"><a class="btn primary" href="#/host-chits/new">${icon('plus')}Host a chit</a></div>
        </div>` });
}

// ---------------------------------------------------------------- figures and the list

function cardsHtml(book) {
    const cell = (iconName, label, value, sub, cls = '', go = '') => `<div class="ov-card cs-card ${cls} ${go ? 'clickable' : ''}" ${go ? `data-go="${go}"` : ''}>
        <span class="ov-ico">${icon(iconName)}</span>
        <div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small></div></div>`;
    const consolidate = book.suggestions.filter(s => s.kind === 'CONSOLIDATE');
    const transfersThisMonth = book.transfers.filter(t => t.date.slice(0, 7) === isoDate().slice(0, 7)).length;
    return `
        ${cell('users', 'Owed to members', moneyShort(book.owedToMembers), 'collected, not yet paid out', '', funds(book) ? `acct:${funds(book).id}` : '')}
        ${cell('wallet', 'In chit accounts', moneyShort(book.held), plural(book.accounts.filter(a => a.accountClass === 'ASSET' && a.active).length, 'account'))}
        ${num(book.inPersonal) ? cell('alert', 'In my own accounts', `<span class="down">${moneyShort(book.inPersonal)}</span>`, `${plural(consolidate.length, 'place')} to consolidate`, 'warn',
                book.personal[0] ? `acct:${book.personal[0].accountId}` : '')
            : cell('check-circle', 'In my own accounts', moneyShort(0), 'all chit money is in chit accounts', 'good')}
        ${num(book.advanced) ? cell('arrow-in', 'Advanced by me', moneyShort(book.advanced), 'to take back from the chits', 'note') : ''}
        ${cell('piggy', 'My earnings', `<span class="gold">${moneyShort(book.earned)}</span>`, `${moneyShort(book.earnedThisMonth)} this month`, 'highlight')}
        ${cell('transfer', 'Moved this month', moneyShort(book.movedThisMonth), plural(transfersThisMonth, 'transfer'), '', book.transfers.length ? 'transfers' : '')}`;
}

const funds = book => book.accounts.find(a => a.role === 'FUNDS');

/** The figures of one chit. */
function chitCardsHtml(book, chit) {
    const m = chit.money;
    const parked = num(m.inPersonal);
    const direct = m.spots.filter(s => s.role === 'DIRECT').reduce((s, x) => s + num(x.amount), 0);
    const moves = book.transfers.filter(t => t.chitId === chit.id);
    const cell = (iconName, label, value, sub, cls = '', go = '') => `<div class="ov-card cs-card ${cls} ${go ? 'clickable' : ''}" ${go ? `data-go="${go}"` : ''}>
        <span class="ov-ico">${icon(iconName)}</span><div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small></div></div>`;
    return `
        ${cell('users', 'Owed to members', moneyShort(m.owedToMembers), 'collected, not yet paid out')}
        ${cell('wallet', 'In chit accounts', moneyShort(num(m.inChitAccounts) - direct), plural(m.spots.filter(s => s.chitBook && s.role !== 'DIRECT').length, 'account'))}
        ${parked > 0 ? cell('alert', 'In my own accounts', `<span class="down">${moneyShort(parked)}</span>`, 'to consolidate or pay out from', 'warn')
            : parked < 0 ? cell('arrow-in', 'Advanced by me', moneyShort(-parked), 'to take back', 'note')
            : cell('check-circle', 'In my own accounts', moneyShort(0), 'nothing parked', 'good')}
        ${direct ? cell('hand', 'Paid to the winner', moneyShort(direct), 'directly by members, until the payout', 'note') : ''}
        ${cell('piggy', 'Mine in the chit', `<span class="gold">${moneyShort(m.mine)}</span>`, `earned ${moneyShort(m.earned)}`, 'highlight')}
        ${cell('transfer', 'Transfers', `${moves.length}`, moves.length ? `last ${shortDate(moves[0].date)}` : 'none yet', '', moves.length ? 'transfers' : '')}`;
}

/** A chit's share of an account (its tagged balance), or null when the account holds none of its money. */
const shareOf = (a, chitId) => a.byChit?.find(s => s.chitId === chitId)?.amount ?? null;

/** A chit's accounts: its own, and the ones it collects into or keeps its commission in by default. */
function chitAccountsOf(book, c) {
    const defaults = new Set([c.collectionAccountId, c.commissionAccountId, c.lateFeeAccountId].filter(Boolean));
    return book.accounts.filter(a => a.accountClass === 'ASSET' && (a.hostedChitId === c.id || defaults.has(a.id)));
}

/**
 * Everything the list shows, in order: key ("acct:12", "transfers"), kind and the row's data. With a chit picked: only
 * that chit's accounts (and its transfers). Every chit: each chit's accounts under its name (click the name to pick
 * the chit), then the common accounts, what members paid winners directly, what is owed to the members and the
 * personal accounts holding chit money.
 */
function listItems(book, chit = null) {
    const items = [];
    if (chit) {
        chitAccountsOf(book, chit).forEach(a => items.push({ key: `acct:${a.id}`, kind: 'account', account: a, child: a.hostedChitId === chit.id }));
    } else {
        book.chits.forEach(c => {
            const own = book.accounts.filter(a => a.hostedChitId === c.id);
            if (!own.length) return;
            items.push({ kind: 'label', chit: c });
            own.forEach(a => items.push({ key: `acct:${a.id}`, kind: 'account', account: a, child: true }));
        });
        book.accounts.filter(a => a.accountClass === 'ASSET' && !a.hostedChitId && a.role !== 'DIRECT')
            .forEach(a => items.push({ key: `acct:${a.id}`, kind: 'account', account: a, common: true }));
        book.accounts.filter(a => a.role === 'DIRECT' && a.transactionCount > 0)
            .forEach(a => items.push({ key: `acct:${a.id}`, kind: 'account', account: a, direct: true }));
        if (funds(book)) items.push({ key: `acct:${funds(book).id}`, kind: 'account', account: funds(book), liability: true });
        book.personal.forEach(p => items.push({ key: `acct:${p.accountId}`, kind: 'personal', personal: p }));
    }
    const moves = chit ? book.transfers.filter(t => t.chitId === chit.id) : book.transfers;
    if (moves.length) items.push({ key: 'transfers', kind: 'transfers', count: moves.length });
    return items;
}

function listHtml(book, items, chit = null) {
    if (!items.length) return emptyState('No chit accounts yet', 'wallet');
    let html = '';
    let group = null;
    const head = (name, label, value = '') => {
        if (group === name) return;
        group = name;
        html += `<div class="group-label"><span>${label}</span>${value !== '' ? `<b>${value}</b>` : ''}</div>`;
    };
    const share = a => chit ? shareOf(a, chit.id) : null;
    for (const it of items) {
        if (it.kind === 'label') {
            group = `chit${it.chit.id}`;
            html += `<div class="group-label clickable ca-chit-label" data-chit-filter="${it.chit.id}" title="Show only ${esc(it.chit.name)}'s accounts">
                <span>${icon(it.chit.chitType === 'AUCTION' ? 'gavel' : it.chit.chitType === 'PLANNED' ? 'calendar' : 'hand-coins')}${esc(it.chit.name)}</span><b>${moneyShort(it.chit.money.held)}</b></div>`;
        }
        else if (it.kind === 'account' && it.child) html += accountRow(it.account, true, null, chit);
        else if (it.kind === 'account' && chit) html += accountRow(it.account, false, null, chit);
        else if (it.kind === 'account' && it.common) { head('common', 'Common chit accounts'); html += accountRow(it.account, false, share(it.account)); }
        else if (it.kind === 'account' && it.direct) { head('direct', 'Paid to winners directly'); html += accountRow(it.account, false, share(it.account)); }
        else if (it.kind === 'account' && it.liability) { head('owed', 'Owed to members'); html += accountRow(it.account, false, chit ? chit.money.owedToMembers : null); }
        else if (it.kind === 'personal') { head('personal', 'Chit money in my own accounts'); html += personalRow(it.personal, chit); }
        else if (it.kind === 'transfers') { head('history', 'History'); html += `<div class="acct-item rich ca-row accent-ocean ${view.selected === 'transfers' ? 'selected' : ''}" data-key="transfers">
            <span class="chip-icon sm">${icon('transfer')}</span><div class="acct-main"><div class="acct-line"><span class="acct-name">Transfers</span>
            <b class="acct-bal">${it.count}</b></div><div class="acct-line sub"><span class="acct-meta">money moved in, out and between accounts</span></div></div></div>`; }
    }
    return html;
}

const chitIconOf = c => (c.chitType === 'AUCTION' ? 'gavel' : c.chitType === 'PLANNED' ? 'calendar' : 'hand-coins');

/**
 * An account in the list, laid out like a chit in the Chits list: the name and balance, what it is with its facts and
 * this month's change, and a bar (with a chit picked, its part of the chit's money; otherwise this month's money in
 * against out). child: one of a chit's own accounts (named by its role). share: with every chit shown, a shared
 * account's part for one chit. chit: the chit picked.
 */
function accountRow(a, child = false, share = null, chit = null) {
    const [roleLabel, roleIcon, tone] = roleOf(a);
    const meta = [child ? a.typeLabel : a.chitName ? `${a.chitName} · ${roleLabel}` : a.role === 'COMMON' ? 'Common · any chit' : a.role === 'FUNDS' ? 'all chits'
        : a.role === 'DIRECT' ? 'cleared at each payout' : `${roleLabel} · chit deleted`, a.institution].filter(Boolean);
    const net = num(a.monthIn) - num(a.monthOut);
    const held = chit ? num(chit.money.held) : 0;
    const part = chit && held > 0 ? Math.max(0, Math.min(100, (num(a.balance) / held) * 100)) : null;
    const flow = num(a.monthIn) + num(a.monthOut);
    const bar = part !== null ? part : flow ? (num(a.monthIn) / flow) * 100 : 0;
    const barText = part !== null ? `${Math.round(part)}% of the chit's money`
        : flow ? `this month +${moneyShort(a.monthIn)} −${moneyShort(a.monthOut)}` : 'no money moved this month';
    return `<div class="acct-item rich chit-item ca-row ${child && !chit ? 'ca-child' : ''} accent-${tone} ${a.active ? '' : 'inactive'} ${view.selected === `acct:${a.id}` ? 'selected' : ''}" data-key="acct:${a.id}">
        <span class="chip-icon sm ${tone}">${icon(a.role === 'FUNDS' ? 'users' : a.role === 'DIRECT' ? 'hand' : a.accountType === 'BANK' ? 'bank' : roleIcon)}</span>
        <div class="acct-main">
            <div class="acct-line"><span class="acct-name" title="${esc(a.name)}">${esc(child ? roleLabel : a.name)}${a.systemAccount ? `<span class="lock" title="Kept by the app">${icon('lock')}</span>` : ''}</span>
                <b class="acct-bal ${num(share ?? a.balance) < 0 ? 'neg' : ''}" ${share !== null ? 'title="This chit\'s money in it"' : ''}>${money(share ?? a.balance)}</b></div>
            <div class="acct-line sub"><span class="acct-meta">${meta.map(esc).join(' · ')}</span>
                <span class="acct-facts">${a.active ? '' : '<span class="fact muted">inactive</span>'}${a.usedBy?.length ? `<span class="fact good" title="${esc(a.usedBy.join('\n'))}">default</span>` : ''}</span>
                ${net ? `<span class="acct-delta ${net > 0 ? 'pos' : 'neg'}" title="This month">${net > 0 ? '+' : '−'}${moneyShort(Math.abs(net))}</span>` : ''}</div>
            <div class="chit-prog"><div class="acct-util good"><span style="width:${bar}%"></span></div><small>${barText}</small></div>
        </div></div>`;
}

function personalRow(p, chit = null) {
    const total = p.byChit.filter(x => !chit || x.chitId === chit.id).reduce((s, x) => s + num(x.amount), 0);
    const part = num(p.balance) > 0 ? Math.max(0, Math.min(100, (total / num(p.balance)) * 100)) : 0;
    return `<div class="acct-item rich chit-item ca-row accent-${total >= 0 ? 'coral' : 'violet'} ${view.selected === `acct:${p.accountId}` ? 'selected' : ''}" data-key="acct:${p.accountId}">
        <span class="chip-icon sm ${total >= 0 ? 'coral' : 'violet'}">${icon(p.accountType === 'BANK' ? 'bank' : p.accountType === 'WALLET' ? 'wallet' : 'cash')}</span>
        <div class="acct-main">
            <div class="acct-line"><span class="acct-name">${esc(p.accountName)}</span><b class="acct-bal ${total < 0 ? 'neg' : ''}" title="Chit money in it">${signed(total)}</b></div>
            <div class="acct-line sub"><span class="acct-meta">${chit ? 'your own account' : p.byChit.map(x => `${esc(x.chitName)} ${signed(x.amount)}`).join(' · ')}</span></div>
            <div class="chit-prog"><div class="acct-util good"><span style="width:${part}%"></span></div><small>${total < 0 ? 'advanced by you' : `${Math.round(part)}% of its balance is chit money`}</small></div>
        </div></div>`;
}

/** A stacked bar of where a chit's money is: its own accounts, common accounts, personal accounts. */
function spotBar(m) {
    const positive = m.spots.filter(s => num(s.amount) > 0);
    const total = positive.reduce((s, x) => s + num(x.amount), 0);
    if (!total) return '';
    return `<div class="ca-spotbar" title="${esc(positive.map(s => `${s.accountName}: ${money(s.amount)}`).join('\n'))}">${positive.map(s =>
        `<span class="${s.own ? 'own' : s.chitBook ? 'common' : 'personal'}" style="width:${(num(s.amount) / total) * 100}%"></span>`).join('')}</div>`;
}

// ---------------------------------------------------------------- the selected item

function drawDetail(container, book, accounts, reload) {
    const old = container.querySelector('#ca-detail');
    const target = old.cloneNode(false);   // no handlers left from the previous selection
    old.replaceWith(target);
    const [kind, id] = (view.selected || '').split(':');
    // what to do about an account (consolidating a chit's money is the chit's: Chits › Money)
    const suggestions = suggestionsHtml({ ...book, suggestions: book.suggestions.filter(s => s.kind === 'OVERDRAWN' || s.kind === 'UNUSED' || !view.chit) },
        null, kind === 'acct' ? Number(id) : null, view.chit);
    const chit = book.chits.find(c => c.id === view.chit) || null;
    if (kind === 'acct') drawAccount(target, book, accounts, Number(id), suggestions, reload, chit);
    else if (kind === 'transfers') drawTransfers(target, book, chit);
    else target.innerHTML = chit ? `${chitHeadHtml(chit, null, book)}<div class="hc-detail-rest">${panel({ title: 'No accounts', iconName: 'wallet',
        body: emptyState(`${chit.name} has no accounts of its own: pick one in the chit's settings`, 'wallet') })}</div>` : welcomeHtml();
    target.addEventListener('click', async e => {
        // a statement line opens under itself, as on the Accounts page
        const row = e.target.closest('tr[data-entry]');
        if (row && !e.target.closest('[data-act], button, a')) { toggleEntryRow(row, null, { onChanged: () => reload() }); return; }
        const el = e.target.closest('[data-act]');
        if (!el) return;
        try {
            await act(el, { book, accounts, reload, container });
        } catch (err) {
            toast(err.message, 'error');
        }
    });
}

/** Buttons shared by every view of the detail. */
async function act(el, { book, accounts, reload }) {
    const a = el.dataset.act;
    const n = k => (el.dataset[k] ? Number(el.dataset[k]) : null);
    if (a === 'entry') openEntryDetail(n('entry'));
    else if (a === 'go') {
        if (el.dataset.go.startsWith('chit:')) { view.chit = Number(el.dataset.go.slice(5)); setPref('chitAccounts', { chit: view.chit }); view.selected = null; }
        else view.selected = el.dataset.go;
        reload();
    }
    else if (a === 'transfer') openTransfer({ book, accounts, chitId: n('chit'), toAccountId: n('to'),
        from: el.dataset.from ? [{ accountId: n('from'), amount: num(el.dataset.amount) }] : [], chitMoney: el.dataset.money === '1' ? true : el.dataset.money === '0' ? false : null,
        onDone: reload });
    else if (a === 'consolidate') {
        const chit = book.chits.find(c => c.id === n('chit'));
        const parked = chit.money.spots.filter(s => !s.chitBook && num(s.amount) > 0);
        openTransfer({ book, accounts, chitId: chit.id, toAccountId: chit.collectionAccountId, chitMoney: true,
            from: parked.map(s => ({ accountId: s.accountId, amount: num(s.amount) })), onDone: reload });
    }
    else if (a === 'edit-account') openAccountForm(book, book.accounts.find(x => x.id === n('id')), { reload, accounts });
    else if (a === 'delete-account') {
        const acc = book.accounts.find(x => x.id === n('id'));
        if (!await confirmDialog(`Delete ${acc.name}? It has no postings.`, { confirmLabel: 'Delete' })) return;
        await api.del(`/hosted-chits/book/accounts/${acc.id}`);
        toast(`${acc.name} deleted`);
        reload(null);
    }
    else if (a === 'move-out') {
        const acc = book.accounts.find(x => x.id === n('id'));
        if (!await confirmDialog(`Move ${acc.name} back to your own accounts? It will show on the Accounts page again.`, { confirmLabel: 'Move', danger: false })) return;
        await api.post(`/hosted-chits/book/accounts/${acc.id}/move`, { chitBook: false, hostedChitId: null });
        toast(`${acc.name} is one of your accounts again`);
        reload(null);
    }
    else if (a === 'edit-transfer') openTransfer({ book, accounts, editing: book.transfers.find(t => t.id === n('id')), onDone: reload });
    else if (a === 'undo-transfer') {
        const t = book.transfers.find(x => x.id === n('id'));
        if (!await confirmDialog(`Undo moving ${money(t.amount)} into ${t.toAccountName} on ${date(t.date)}? Its journal entry ${t.entryNo || ''} is removed.`, { confirmLabel: 'Undo' })) return;
        await api.del(`/hosted-chits/book/transfers/${t.id}`);
        toast('Transfer undone');
        reload();
    }
    else if (a === 'tab') { view.tab = el.dataset.tab; reload(); }
    else if (a === 'range') { view.range = el.dataset.range; reload(); }
    else if (a === 'chit-only') { view.chitOnly = !view.chitOnly; reload(); }
}

/** What needs doing, for one chit / account or (nothing selected) all. */
function suggestionsHtml(book, chitId, accountId, scope = null) {
    const list = book.suggestions.filter(s => (scope === null || !s.chitId || s.chitId === scope) && ((chitId === null && accountId === null)
        || (chitId !== null && s.chitId === chitId) || (accountId !== null && (s.accountId === accountId || s.toAccountId === accountId))));
    if (!list.length) return '';
    const button = s => {
        if (!manage()) return '';
        if (s.kind === 'CONSOLIDATE') return `<button class="btn sm primary" data-act="transfer" data-chit="${s.chitId}" data-from="${s.accountId}" data-amount="${s.amount}"
            ${s.toAccountId ? `data-to="${s.toAccountId}"` : ''} data-money="1">${icon('merge')}Move to the chit</button>`;
        if (s.kind === 'RECOVER') return `<button class="btn sm" data-act="transfer" data-chit="${s.chitId}" data-to="${s.accountId}" data-money="1"
            ${s.toAccountId ? `data-from="${s.toAccountId}" data-amount="${s.amount}"` : ''}>${icon('undo')}Take it back</button>`;
        if (s.kind === 'OVERDRAWN') return `<button class="btn sm" data-act="transfer" data-to="${s.accountId}" ${s.chitId ? `data-chit="${s.chitId}"` : ''}>${icon('arrow-in')}Move money in</button>`;
        if (s.kind === 'UNUSED') return `<button class="btn sm ghost" data-act="delete-account" data-id="${s.accountId}">${icon('trash')}Delete</button>`;
        return '';
    };
    const ICON = { CONSOLIDATE: 'merge', RECOVER: 'undo', OVERDRAWN: 'alert', UNUSED: 'trash' };
    return `<div class="ca-tips">${list.map(s => `<div class="ca-tip ${s.tone}"><span class="ca-tip-ico">${icon(ICON[s.kind] || 'info')}</span>
        <span class="grow">${esc(s.text)}</span>${button(s)}</div>`).join('')}</div>`;
}

/** Each account holding the chit's money, with what to do about it. */
export function whereHtml(book, chit) {
    const m = chit.money;
    if (!m.spots.length) return `<div class="hc-pad">${emptyState('No money recorded for this chit yet', 'wallet')}</div>`;
    const max = Math.max(...m.spots.map(s => Math.abs(num(s.amount))), 1);
    const where = s => s.role === 'DIRECT' ? ['direct', 'Members paid the winner directly · cleared when the payout is recorded']
        : s.own ? ['own', 'This chit\'s account'] : s.chitBook ? ['common', 'Common chit account'] : ['personal', 'My own account'];
    return `<div class="hc-pad">
        <p class="book-note">${icon('info')}<span>Members' payments are counted where they came in. Money in <b>your own accounts</b> is still the chit's: move it to the chit's account, or pay the next winner straight from it.</span></p>
        <div class="ca-spots">${m.spots.map(s => {
            const [cls, label] = where(s);
            const amount = num(s.amount);
            return `<div class="ca-spot ${cls}">
                <span class="chip-icon sm ${cls === 'personal' ? 'coral' : cls === 'own' ? 'aqua' : cls === 'direct' ? 'teal' : ''}">${icon(cls === 'direct' ? 'hand' : s.accountType === 'BANK' ? 'bank' : s.accountType === 'WALLET' ? 'wallet' : 'cash')}</span>
                <div class="grow min-0"><div class="ca-spot-line"><b class="ellipsis clickable" data-act="go" data-go="acct:${s.accountId}">${esc(s.accountName)}</b>
                    <b class="${amount < 0 ? 'neg' : ''}">${signed(amount)}</b></div>
                    <i class="ca-spot-meter ${amount < 0 ? 'neg' : ''}"><em style="width:${(Math.abs(amount) / max) * 100}%"></em></i>
                    <small>${label}${amount < 0 ? ' · paid more out of it than came in: you advanced it' : ''}</small></div>
                ${manage() && cls === 'personal' && amount > 0 ? `<button class="btn sm" data-act="transfer" data-chit="${chit.id}" data-from="${s.accountId}" data-amount="${amount}"
                    ${chit.collectionAccountId ? `data-to="${chit.collectionAccountId}"` : ''} data-money="1">${icon('merge')}Move</button>` : ''}
                ${manage() && amount < 0 ? `<button class="btn sm ghost" data-act="transfer" data-chit="${chit.id}" data-to="${s.accountId}" data-money="1"
                    ${chit.collectionAccountId ? `data-from="${chit.collectionAccountId}" data-amount="${-amount}"` : ''}>${icon('undo')}Take back</button>` : ''}
            </div>`;
        }).join('')}</div>
        <div class="ca-equation">
            <span><small>Held</small><b>${money(m.held)}</b></span><i>−</i>
            <span><small>Owed to members</small><b>${money(m.owedToMembers)}</b></span><i>=</i>
            <span class="mine"><small>Mine (commission, interest, advances)</small><b>${money(m.mine)}</b></span>
        </div>
    </div>`;
}

/**
 * Month by month: what came in for the month by account, what the winner was paid from which accounts, and what is
 * left in each account for that month. Shows how one payout was funded by payments that came into several accounts.
 */
export function monthTrailHtml(d) {
    const months = d.schedule.filter(m => m.status !== 'UPCOMING' || d.payments.some(p => p.monthNo === m.monthNo));
    if (!months.length) return `<div class="hc-pad">${emptyState('Nothing collected yet', 'calendar')}</div>`;
    const chip = (name, amount, cls = '') => `<span class="ca-mchip ${cls}"><span class="ellipsis">${esc(name)}</span><b>${money(amount)}</b></span>`;
    return `<div class="hc-pad"><p class="book-note">${icon('split')}<span>A month's payout can be paid from several accounts, whichever the members' money came into. Each row balances what came in against what went out.</span></p>
        <div class="ca-trail">${months.slice().reverse().map(m => {
            const into = new Map();
            d.payments.filter(p => p.monthNo === m.monthNo).forEach(p => {
                const k = p.accountName || d.chit.accountName || 'Collections';
                into.set(k, (into.get(k) || 0) + num(p.amount));
            });
            const out = new Map();
            (m.legs || []).forEach(l => out.set(l.accountName, (out.get(l.accountName) || 0) + num(l.amount)));
            const names = [...new Set([...into.keys(), ...out.keys()])];
            const inTotal = [...into.values()].reduce((s, v) => s + v, 0);
            const done = m.status === 'COMPLETED';
            return `<div class="ca-trail-row ${done ? 'done' : ''}">
                <div class="ca-trail-head"><b>Month ${m.monthNo}</b><small>${esc(m.winnerName || (done ? '' : 'winner not paid yet'))}</small>
                    ${done ? `<span class="badge good">${icon('check')}paid ${shortDate(m.payoutDate)}</span>` : `<span class="badge">${icon('clock')}open</span>`}</div>
                <div class="ca-trail-cols">
                    <div><small>${icon('arrow-in')}Came in · ${money(inTotal)}</small>${[...into].map(([k, v]) => chip(k, v, 'in')).join('') || '<span class="muted">—</span>'}</div>
                    <div><small>${icon('crown')}Paid to the winner · ${done ? money(m.payout) : '—'}</small>${[...out].map(([k, v]) => chip(k, v, 'out')).join('') || '<span class="muted">—</span>'}
                        ${m.payoutTo ? `<span class="ca-mto">${icon('arrow-out')}to ${esc(m.payoutTo)}</span>` : ''}</div>
                    <div><small>${icon('scale')}Left for the month</small>${names.map(k => {
                        const left = (into.get(k) || 0) - (out.get(k) || 0);
                        return chip(k, left, left < 0 ? 'neg' : left > 0 ? 'left' : 'zero');
                    }).join('') || '<span class="muted">—</span>'}${done && num(m.commission) ? `<span class="ca-mto gold-ink">${icon('piggy')}commission ${money(m.commission)}</span>` : ''}</div>
                </div></div>`;
        }).join('')}</div></div>`;
}

// ---------------------------------------------------------------- an account: statement

/**
 * The top of the page when a chit is picked: the chit (what it holds, owes and is mine, where the rest of its money
 * is) and, under it, the selected account (its balance, this month's money in and out, its actions).
 */
function chitHeadHtml(chit, a, book, { personal = null } = {}) {
    const m = chit.money;
    const own = new Set(chitAccountsOf(book, chit).map(x => x.id));
    const elsewhere = m.spots.filter(s => !own.has(s.accountId) && num(s.amount) !== 0);
    const liability = a?.accountClass === 'LIABILITY';
    const [roleLabel, roleIcon, tone] = a ? roleOf(a) : ['', 'wallet', 'ocean'];
    const share = a ? shareOf(a, chit.id) : null;
    return `<section class="panel p-chit-head ca-head">
        <div class="chit-banner ca-banner">
            <span class="hero-icon">${icon(chit.chitType === 'AUCTION' ? 'gavel' : chit.chitType === 'PLANNED' ? 'calendar' : 'hand-coins')}</span>
            <div class="ab-id">
                <div class="ab-name">${esc(chit.name)} <span class="badge">${chit.chitType === 'AUCTION' ? 'Auction' : chit.chitType === 'PLANNED' ? 'Planned' : 'Fixed'}</span>
                    ${chit.status === 'COMPLETED' ? '<span class="badge gray">Finished</span>' : ''}</div>
                <div class="ab-meta">owed to members <b>${money(m.owedToMembers)}</b><i>·</i>mine <b>${money(m.mine)}</b><i>·</i>earned <b>${money(m.earned)}</b></div>
                ${elsewhere.length ? (() => { const text = `Also in ${elsewhere.map(s => `${s.accountName} ${signed(s.amount)}`).join(', ')}`;
                    return `<div class="ab-desc" title="${esc(text)}">${icon('info')}<span>${esc(text)}</span></div>`; })() : ''}
                ${spotBar(m)}
            </div>
            <div class="ab-bal"><small>Chit money held</small><b>${money(m.held)}</b><span class="ab-change">in ${plural(own.size, 'account')} of its own${elsewhere.length ? ` and ${elsewhere.length} more` : ''}</span></div>
            <div class="ab-actions"><a class="btn sm on-dark" href="#/host-chits/${chit.id}/money" title="Where the money is, month by month, consolidating: on the chit">${icon('hand-coins')}The chit's money${icon('chevron-right')}</a></div>
        </div>
        ${a || personal ? `<div class="ca-acct-strip tone-${tone}">
            <span class="chip-icon ${tone}">${icon(liability ? 'users' : a?.accountType === 'BANK' ? 'bank' : a?.accountType === 'WALLET' ? 'wallet' : roleIcon)}</span>
            <div class="min-0 ca-acct-id"><b>${esc(a ? a.name : personal.accountName)}</b>
                <small>${[a ? roleLabel : 'My own account', a?.institution, a?.accountNumber ? `•• ${String(a.accountNumber).slice(-4)}` : '', a?.code,
                    a?.usedBy?.length ? `default for ${a.usedBy.join(', ')}` : ''].filter(Boolean).map(esc).join(' · ')}</small></div>
            <div class="ca-acct-fig"><small>Balance</small><b class="${num(a ? a.balance : personal.balance) < 0 ? 'neg' : ''}">${signed(a ? a.balance : personal.balance)}</b></div>
            ${a ? `<div class="ca-acct-fig"><small>This month</small><span><b class="pos">+${moneyShort(a.monthIn)}</b> <b class="neg">−${moneyShort(a.monthOut)}</b></span></div>` : ''}
            ${share !== null && a?.hostedChitId !== chit.id ? `<div class="ca-acct-fig"><small>${esc(chit.name)}'s</small><b>${signed(share)}</b></div>` : ''}
            ${a && num(a.untagged) ? `<div class="ca-acct-fig" title="Not any chit's: your own money"><small>Mine</small><b class="gold-ink">${signed(a.untagged)}</b></div>` : ''}
            <div class="ca-acct-acts">${manage() && !liability ? `
                <button class="btn sm" data-act="transfer" data-to="${a ? a.id : personal.accountId}" data-chit="${chit.id}" title="Move money into this account">${icon('arrow-in')}In</button>
                <button class="btn sm" data-act="transfer" data-from="${a ? a.id : personal.accountId}" data-amount="0" data-chit="${chit.id}" title="Move money out of this account">${icon('arrow-out')}Out</button>` : ''}
                ${manage() && a && a.role !== 'FUNDS' ? `<button class="btn sm icon" data-act="edit-account" data-id="${a.id}" title="Edit the account">${icon('edit')}</button>` : ''}</div>
        </div>` : ''}
    </section>`;
}

async function drawAccount(target, book, accounts, id, tips, reload, chit = null) {
    const a = book.accounts.find(x => x.id === id);
    const personal = book.personal.find(p => p.accountId === id);
    if (!a && !personal) { target.innerHTML = welcomeHtml(); return; }
    const name = a ? a.name : personal.accountName;
    const [roleLabel, roleIcon, tone] = a ? roleOf(a) : ['My own account', 'wallet', 'coral'];
    const liability = a?.accountClass === 'LIABILITY';
    const shares = a ? a.byChit : personal.byChit;
    if (!['statement', 'moves'].includes(view.tab)) view.tab = 'statement';
    const moves = book.transfers.filter(t => (t.toAccountId === id || t.from.some(l => l.accountId === id)) && (!view.chit || t.chitId === view.chit));
    const scoped = view.chit && a?.hostedChitId !== view.chit && a?.role !== 'FUNDS';
    const scopeName = book.chits.find(c => c.id === view.chit)?.name;
    const canEdit = manage() && a && a.role !== 'FUNDS';
    target.innerHTML = chit ? `${chitHeadHtml(chit, a, book, { personal })}
        <div class="hc-detail-rest">${tips}${accountTabsHtml(moves, personal, scoped, scopeName)}</div>` : `
        <section class="panel p-chit-head">
            <div class="chit-banner ca-banner tone-${tone}">
                <span class="hero-icon">${icon(liability ? 'users' : a?.accountType === 'BANK' || personal?.accountType === 'BANK' ? 'bank' : roleIcon)}</span>
                <div class="ab-id">
                    <div class="ab-name">${esc(name)} <span class="badge">${esc(roleLabel)}</span>${a && !a.active ? '<span class="badge gray">Inactive</span>' : ''}</div>
                    <div class="ab-meta">${[a?.chitName ? `Belongs to ${a.chitName}` : a?.role === 'COMMON' ? 'Shared by all chits' : liability ? 'What is owed to the members of every chit' : personal ? 'One of your own accounts, holding chit money' : 'From a deleted chit',
                        a?.institution, a?.accountNumber ? `•• ${String(a.accountNumber).slice(-4)}` : '', a?.code].filter(Boolean).map(esc).join('<i>·</i>')}</div>
                    ${a?.usedBy?.length ? `<div class="ab-desc">${icon('check-circle')}<span>Default for ${esc(a.usedBy.join(', '))}</span></div>` : ''}
                </div>
                <div class="ab-bal"><small>${liability ? 'Owed' : personal ? 'Chit money in it' : 'Balance'}</small>
                    <b>${personal ? signed(shares.reduce((s, x) => s + num(x.amount), 0)) : money(a.balance)}</b>
                    <span class="ab-change">${a ? `in ${moneyShort(a.monthIn)} · out ${moneyShort(a.monthOut)} this month` : `account balance ${money(personal.balance)}`}</span></div>
                <div class="ab-actions">${manage() && !liability ? `
                    <button class="btn sm on-dark" data-act="transfer" data-to="${id}">${icon('arrow-in')}Move in</button>
                    <button class="btn sm on-dark" data-act="transfer" data-from="${id}" data-amount="0">${icon('arrow-out')}Move out</button>` : ''}
                    ${canEdit ? `<button class="btn sm on-dark icon" data-act="edit-account" data-id="${id}" title="Edit">${icon('edit')}</button>` : ''}</div>
            </div>
            ${shares.length || (a && num(a.untagged)) ? `<div class="ca-shares">${shares.map(s => `<span class="ca-share clickable" data-act="go" data-go="chit:${s.chitId}" title="This chit's money here">
                ${icon('hand-coins')}${esc(s.chitName)} <b class="${num(s.amount) < 0 ? 'neg' : ''}">${signed(s.amount)}</b></span>`).join('')}
                ${a && num(a.untagged) ? `<span class="ca-share mine" title="Not any chit's: your own money (opening balance, commission taken here, advances)">${icon('piggy')}Mine <b>${signed(a.untagged)}</b></span>` : ''}</div>` : ''}
        </section>
        <div class="hc-detail-rest">${tips}${accountTabsHtml(moves, personal, scoped, scopeName)}</div>`;
    const body = target.querySelector('#ca-tab');
    if (view.tab === 'moves') { body.innerHTML = transfersTable(moves, 'No transfers in or out of this account'); return; }
    const from = RANGES.find(r => r[0] === view.range)?.[2]() || firstOfMonth(-2);
    try {
        const s = await api.get(`/hosted-chits/book/accounts/${id}/statement`, { from, to: isoDate() });
        body.innerHTML = statementHtml(s, view.chitOnly && (personal || scoped) ? (scoped ? view.chit : true) : false, a?.hostedChitId);
        if (canEdit) {
            body.insertAdjacentHTML('beforeend', `<div class="ca-foot-acts">
                ${a.transactionCount === 0 && !a.usedBy.length ? `<button class="btn sm ghost" data-act="delete-account" data-id="${id}">${icon('trash')}Delete account</button>` : ''}
                ${!a.usedBy.length ? `<button class="btn sm ghost" data-act="move-out" data-id="${id}" title="It shows on the Accounts page again">${icon('arrow-out')}Move to my accounts</button>` : ''}</div>`);
        }
    } catch (err) {
        body.innerHTML = emptyState(err.message, 'alert');
    }
}

/** The selected account's statement (with the period and, for shared accounts, one chit's lines only) and transfers. */
function accountTabsHtml(moves, personal, scoped, scopeName) {
    return panel({
        title: view.tab === 'moves' ? 'Transfers' : 'Statement', iconName: view.tab === 'moves' ? 'transfer' : 'list', cls: 'p-chit-tabs', bodyClass: 'flush',
        actions: `${view.tab === 'statement' ? `<div class="seg-chips sm">${RANGES.map(([k, l]) => `<button class="seg-chip ${view.range === k ? 'active' : ''}" data-act="range" data-range="${k}">${l}</button>`).join('')}</div>
            ${personal || scoped ? `<label class="switch sm" title="${scoped ? `Show only ${esc(scopeName)}'s lines` : 'Show only the lines that moved chit money'}"><input type="checkbox" data-act="chit-only" ${view.chitOnly ? 'checked' : ''}><span></span>${scoped ? `${esc(scopeName)} only` : 'Chit money only'}</label>` : ''}` : ''}
            <div class="tabs sm">${[['statement', 'Statement', 'list'], ['moves', `Transfers${moves.length ? ` (${moves.length})` : ''}`, 'transfer']].map(([k, l, i]) =>
            `<button class="tab ${view.tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${icon(i)}<span class="hc-tab-label">${l}</span></button>`).join('')}</div>`,
        body: `<div class="scroll chit-tab-body" id="ca-tab">${loading()}</div>`,
    });
}

/** only: true for the lines carrying any chit, a chit id for that chit's lines, false for all. Click a line to open it. */
function statementHtml(s, only, ownChit = null) {
    const lines = only === true ? s.lines.filter(l => l.hostedChitId) : only ? s.lines.filter(l => l.hostedChitId === only) : s.lines;
    if (!lines.length) return `<div class="hc-pad">${emptyState('Nothing in this period', 'list')}</div>`;
    return `<div class="ca-stmt-sum">
            <span><small>Opening ${date(s.from)}</small><b>${signed(s.opening)}</b></span>
            <span class="pos"><small>In</small><b>+${money(s.totalIn)}</b></span>
            <span class="neg"><small>Out</small><b>−${money(s.totalOut)}</b></span>
            <span><small>Closing</small><b>${signed(s.closing)}</b></span></div>
        <table class="grid dense ca-stmt"><thead><tr><th>Date</th><th>Entry</th><th>Details</th>${hasChitStatus(lines) ? '<th class="c-ctst"></th>' : ''}<th class="num">In</th><th class="num">Out</th><th class="num">Balance</th></tr></thead>
        <tbody>${lines.slice().reverse().map(l => {
            const sub = [l.counterpart ? `${num(l.moneyIn) ? 'from' : 'to'} ${l.counterpart}` : '', l.memo].filter(Boolean).join(' · ');
            const code = chitCodeOf(l.chitTrail) || (l.chitName ? chitTag(l.chitName) : null);
            const shortSub = [l.counterpart ? `${num(l.moneyIn) ? 'from' : 'to'} ${shortAccount(l.counterpart, code)}` : '', l.memo].filter(Boolean).join(' · ');
            return `<tr class="clickable" data-entry="${l.entryId}" title="${esc([l.narration, sub].filter(Boolean).join('\n'))}">
            <td class="hc-nowrap">${shortDate(l.date)}</td>
            <td class="hc-nowrap muted">${esc(l.entryNo)}</td>
            <td class="ca-stmt-what"><span class="ellipsis">${ownChit && l.hostedChitId === ownChit ? '' : l.chitName ? `<span class="ca-tag" title="${esc(l.chitName)}">${esc(code)}</span>` : '<span class="ca-tag mine">mine</span>'}
                <b>${esc(shortNarration(l.narration, l.chitTrail))}</b>${shortSub ? `<small class="muted"> · ${narrativeHtml(shortSub)}</small>` : ''}</span></td>
            ${hasChitStatus(lines) ? `<td class="c-ctst">${chitStatus(l.chitTrail)}</td>` : ''}
            <td class="num pos">${num(l.moneyIn) ? money(l.moneyIn) : ''}</td>
            <td class="num neg">${num(l.moneyOut) ? money(l.moneyOut) : ''}</td>
            <td class="num"><b>${signed(l.balance)}</b></td></tr>`;
        }).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------- transfers

function drawTransfers(target, book, chit = null) {
    const list = view.chit ? book.transfers.filter(t => t.chitId === view.chit) : book.transfers;
    target.innerHTML = `${chit ? chitHeadHtml(chit, null, book) : ''}<div class="hc-detail-rest">${chit ? '' : suggestionsHtml(book, null, null, view.chit)}${panel({
        title: view.chit ? `Transfers · ${book.chits.find(c => c.id === view.chit)?.name || ''}` : 'All transfers', iconName: 'transfer', cls: 'p-chit-tabs', bodyClass: 'flush', sub: `${list.length}`,
        body: `<div class="scroll chit-tab-body">${transfersTable(list, 'No transfers yet')}</div>`,
    })}</div>`;
}

export function transfersTable(list, empty, { actions = true } = {}) {
    if (!list.length) return `<div class="hc-pad">${emptyState(empty, 'transfer')}</div>`;
    return `<table class="grid ca-moves"><thead><tr><th>Date</th><th>What</th><th>From</th><th>Into</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${list.map(t => {
            const [kindIcon, kindLabel, tone] = KIND[t.kind] || KIND.MOVE;
            return `<tr>
                <td class="hc-nowrap">${shortDate(t.date)}${t.entryNo ? `<span class="hc-when muted clickable" data-act="entry" data-entry="${t.journalEntryId}">${esc(t.entryNo)}</span>` : ''}</td>
                <td><span class="ca-kind ${tone}">${icon(kindIcon)}${kindLabel}</span>${t.chitName ? `<span class="hc-sub-note muted">${esc(t.chitName)}${t.chitMoney ? ' · chit money' : ' · my money'}</span>` : ''}
                    ${t.note ? `<span class="hc-sub-note muted">${esc(t.note)}</span>` : ''}</td>
                <td>${t.from.map(l => `<span class="ca-leg">${esc(l.accountName)} <b>${money(l.amount)}</b>${l.reference ? `<small class="muted">${esc(l.mode || '')} ${esc(l.reference)}</small>` : ''}</span>`).join('')}</td>
                <td>${esc(t.toAccountName)}</td>
                <td class="num"><b>${money(t.amount)}</b></td>
                <td class="hc-nowrap r">${manage() && actions ? `<button class="btn sm ghost icon" data-act="edit-transfer" data-id="${t.id}" title="Change">${icon('edit')}</button>
                    <button class="btn sm ghost icon" data-act="undo-transfer" data-id="${t.id}" title="Undo">${icon('undo')}</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table>`;
}

// ===================================================================== dialogs

/**
 * Move money: from one or more accounts into one, as one journal entry. Pick the chit and whether it is the chit's
 * money (the members') or your own, the accounts and amounts. Consolidating chit money: each account lists the
 * members' payments that came into it and are still there; the ones ticked are linked to the transfer (so a payment
 * can be followed from its receipt to the payout) and make the amount and the narrative. The side shows the entry it
 * posts. Also edits a transfer ({ editing }). from: [{ accountId, amount }] to start with.
 */
export async function openTransfer({ book = null, accounts = null, chitId = null, toAccountId = null, from = [], chitMoney = null, editing = null, onDone } = {}) {
    [book, accounts] = await Promise.all([book || api.get('/hosted-chits/book'), accounts || loadAccounts(false, { all: true })]);
    const s = editing ? {
        chitId: editing.chitId, toAccountId: editing.toAccountId, chitMoney: editing.chitMoney, date: editing.date, mode: editing.mode,
        reference: editing.reference || '', note: editing.note || '',
        legs: editing.from.map(l => ({ accountId: l.accountId, amount: num(l.amount), reference: l.reference || '', mode: l.mode,
            paymentIds: [...(l.paymentIds || [])], note: l.note || '', auto: false })),
    } : {
        chitId, toAccountId, chitMoney, date: isoDate(), mode: 'Bank', reference: '', note: '',
        legs: (from.length ? from : [{}]).map(l => ({ accountId: l.accountId || null, amount: num(l.amount) || '', reference: '', paymentIds: null, note: '', auto: !num(l.amount) })),
    };
    const byId = id => accounts.find(a => a.id === Number(id));
    const chitOf = () => book.chits.find(c => c.id === Number(s.chitId));
    // a chit's own account says whose money it is
    if (!s.chitId) {
        const owner = [s.toAccountId, ...s.legs.map(l => l.accountId)].map(byId).find(a => a?.hostedChitId);
        if (owner) s.chitId = owner.hostedChitId;
    }
    const involvesPersonal = () => [s.toAccountId, ...s.legs.map(l => l.accountId)].filter(Boolean).map(byId).some(a => a && !a.chitBook);
    const chitAmounts = () => Object.fromEntries((chitOf()?.money.spots || []).map(x => [x.accountId, x.amount]));
    if (s.chitMoney === null) {
        // members' money parked in a personal account is chit money; otherwise it is the organiser's
        const spots = chitAmounts();
        s.chitMoney = !!chitOf() && s.legs.some(l => byId(l.accountId) && !byId(l.accountId).chitBook && num(spots[l.accountId]) > 0);
    }
    // the chit's payments, to pick the ones a consolidation carries (fetched once per chit)
    const details = new Map();
    const detailOf = async id => {
        if (!id) return null;
        if (!details.has(id)) details.set(id, await api.get(`/hosted-chits/${id}`).catch(() => null));
        return details.get(id);
    };
    /**
     * Payments that came into an account and are still there: not moved by another transfer, not paid out, and (for
     * money moved before transfers named their payments) no more than the chit money the account still holds, the
     * latest first.
     */
    const waitingIn = (d, accountId) => {
        const list = (d?.payments || []).filter(p => p.accountId === Number(accountId) && !p.paidToMemberId
            && num(p.amount) > 0 && (!p.transferId || p.transferId === editing?.id) && !p.paidOutMonth)
            .sort((a, b) => b.paidDate.localeCompare(a.paidDate) || b.id - a.id);
        const spot = (d?.money?.spots || []).find(x => x.accountId === Number(accountId));
        let room = num(spot?.amount) + (editing ? editing.from.filter(l => l.accountId === Number(accountId)).reduce((t, l) => t + num(l.amount), 0) : 0);
        return list.filter(p => (room -= num(p.amount)) >= -0.005).reverse();
    };
    /** "[Own a/c ICICI Bank] Gopal RC-000968 (UTR265) ₹25,000; ...": the payments, and the account they came into. */
    /** The payments a transfer line moves, in short: "[Own a/c ICICI Bank] 2×₹25,000: Gopal #968/UTR265, Arjun #969". */
    const narrative = (list, accountId, d) => paymentsNarrative(list, { members: d?.members, chitName: chitOf()?.name, accounts, lineAccountId: Number(accountId) });
    const flArea = (label, attrs, value = '', cls = '') => `<label class="fl fl-area ${cls}"><textarea rows="1" ${attrs} placeholder=" " data-plain>${esc(value)}</textarea><span>${label}</span></label>`;
    const fl = (label, attrs, value = '', unit = '', cls = '') => `<label class="fl ${cls}"><input ${attrs} value="${esc(value)}" placeholder=" " data-plain><span>${label}</span>${unit ? `<i class="fl-unit">${unit}</i>` : ''}</label>`;
    const options = selected => {
        const c = chitOf();
        const amounts = s.chitMoney && c ? chitAmounts() : null;
        const liquid = a => a.active && a.accountClass === 'ASSET' && ['CASH', 'BANK', 'WALLET'].includes(a.accountType);
        const groups = [[`${c?.name || 'This chit'}'s accounts`, accounts.filter(a => liquid(a) && a.chitBook && c && a.hostedChitId === c.id)],
            ['Common chit accounts', accounts.filter(a => liquid(a) && a.chitBook && !a.hostedChitId)], ['My accounts', accounts.filter(a => liquid(a) && !a.chitBook)]];
        return `<option value="">Pick an account</option>${groups.filter(([, l]) => l.length).map(([label, list]) => `<optgroup label="${esc(label)}">${list.map(a =>
            `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}>${esc(a.name)} · ${amounts ? `${moneyShort(num(amounts[a.id]))} of the chit's` : moneyShort(a.balance)}</option>`).join('')}</optgroup>`).join('')}`;
    };

    openModal({
        title: editing ? 'Change transfer' : 'Move money', iconName: 'transfer', size: 'xl ca-xfer-modal',
        body: `<div class="ca-x">
            <div class="ca-x-main">
                <div class="ca-x-top">
                    <label class="fl fixed"><select name="chitId" data-plain>
                        <option value="">No particular chit (my money)</option>
                        ${book.chits.map(c => `<option value="${c.id}" ${c.id === Number(s.chitId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><span>Chit</span></label>
                    <div class="ca-x-whose seg-chips" data-whose>
                        <button type="button" class="seg-chip ${s.chitMoney ? 'active' : ''}" data-money="1" title="Members' money: it stays the chit's wherever it goes">${icon('users')}Chit money</button>
                        <button type="button" class="seg-chip ${s.chitMoney ? '' : 'active'}" data-money="0" title="Your own: an advance into a chit, or commission taken out">${icon('piggy')}My own money</button></div>
                </div>
                <div class="ca-x-sec"><span>${icon('arrow-out')}From</span><small class="muted" data-quick-hint></small></div>
                <div class="ca-quick" data-quick></div>
                <div class="ca-x-legs" data-legs></div>
                <button type="button" class="btn sm ghost ca-x-add" data-add-leg>${icon('plus')}Another account</button>
                <div class="ca-x-sec"><span>${icon('arrow-in')}Into</span></div>
                <div class="ca-x-into">
                    <label class="fl fixed ca-x-wide"><select data-to data-plain></select><span>Account</span></label>
                    ${fl('Date', `type="date" name="date" max="${isoDate()}"`, s.date)}
                    <div class="ca-x-modes seg-chips" data-modes>${MODES.map(x => `<button type="button" class="seg-chip ${s.mode === x ? 'active' : ''}" data-mode="${x}">${x}</button>`).join('')}</div>
                    ${fl('Reference (UTR / UPI)', 'type="text" name="reference" maxlength="60"', s.reference)}
                    ${fl('Note', 'type="text" name="note" maxlength="255"', s.note, 'optional', 'ca-x-wide')}
                </div>
            </div>
            <aside class="ca-x-side">
                <div class="ca-x-total"><small data-kind>Transfer</small><b data-total>₹0</b><span data-explain class="muted"></span></div>
                <div class="ca-x-sec"><span>${icon('journal')}Journal entry</span></div>
                <div data-preview></div>
            </aside>
        </div>`,
        actions: [
            { label: 'Cancel' },
            { label: editing ? 'Save change' : 'Move money', kind: 'primary', iconName: 'check', onClick: async modal => {
                const legs = s.legs.filter(l => l.accountId || num(l.amount));
                if (!s.toAccountId) throw new Error('Pick the account the money goes into');
                const on = modal.el.querySelector('[name=date]').value;
                if (!on) throw new Error('Enter the date');
                if (on > isoDate()) throw new Error('The transfer date cannot be in the future');
                if (!legs.length) throw new Error('Pick the account the money comes from');
                if (legs.some(l => !l.accountId)) throw new Error('Pick an account on every line');
                if (legs.some(l => num(l.amount) <= 0)) throw new Error('Enter the amount on every line');
                if (legs.some(l => Number(l.accountId) === Number(s.toAccountId))) throw new Error('Money cannot move from an account into itself');
                const body = {
                    chitId: s.chitId ? Number(s.chitId) : null, date: on, toAccountId: Number(s.toAccountId),
                    from: legs.map(l => ({ accountId: Number(l.accountId), amount: num(l.amount), reference: (l.reference || '').trim() || null, mode: l.mode || null,
                        paymentIds: s.chitMoney ? (l.paymentIds || []) : [], note: (l.note || '').trim() || null })),
                    chitMoney: s.chitMoney, mode: s.mode, reference: modal.el.querySelector('[name=reference]').value.trim() || null,
                    note: modal.el.querySelector('[name=note]').value.trim() || null, version: editing?.version,
                };
                const t = editing ? await api.put(`/hosted-chits/book/transfers/${editing.id}`, body) : await api.post('/hosted-chits/book/transfers', body);
                toast(`${money(t.amount)} moved into ${t.toAccountName} · ${t.entryNo || ''}`);
                onDone?.();
            } },
        ],
        onOpen: modal => {
            const el = modal.el;
            const legsEl = el.querySelector('[data-legs]');
            const toSel = el.querySelector('[data-to]');
            const drawLegs = async () => {
                const d = s.chitMoney && chitOf() ? await detailOf(Number(s.chitId)) : null;
                legsEl.innerHTML = s.legs.map((l, i) => {
                    const waiting = d && l.accountId ? waitingIn(d, l.accountId) : [];
                    // a consolidation starts with every payment waiting in the account
                    if (waiting.length && l.paymentIds === null) {
                        l.paymentIds = waiting.map(p => p.id);
                        if (l.auto) l.amount = waiting.reduce((t, p) => t + num(p.amount), 0);
                        if (!l.note) l.note = narrative(waiting, l.accountId, d);
                    }
                    const picked = new Set(l.paymentIds || []);
                    return `<div class="ca-x-leg" data-i="${i}">
                        <div class="ca-x-leg-top">
                            <label class="fl fixed ca-x-wide"><select data-leg-account data-plain>${options(l.accountId)}</select><span>Account ${s.legs.length > 1 ? i + 1 : ''}</span></label>
                            <button type="button" class="btn sm ghost icon" data-remove title="Remove" ${s.legs.length === 1 ? 'disabled' : ''}>${icon('x')}</button></div>
                        <div class="ca-x-leg-figs">
                            ${fl('Amount', 'type="number" step="any" min="0" inputmode="decimal" data-leg-amount class="num"', l.amount, '₹')}
                            ${fl('UTR / reference', 'type="text" maxlength="60" data-leg-ref', l.reference || '')}
                        </div>
                        ${waiting.length ? `<div class="ca-x-pays">
                            <div class="ca-x-pays-head">${icon('link')}Members' payments in this account <small class="muted">tick the ones this moves: they are linked to the transfer</small></div>
                            ${waiting.map(p => `<label class="ca-x-pay"><input type="checkbox" data-pay="${p.id}" ${picked.has(p.id) ? 'checked' : ''}>
                                <span class="hc-avatar xs">${esc(initials(p.memberName || '?'))}</span><b>${esc(p.memberName)}</b>
                                <small>${esc([`month ${p.monthNo}`, p.receiptNo, shortDate(p.paidDate), p.mode, p.reference ? `ref ${p.reference}` : ''].filter(Boolean).join(' · '))}</small>
                                <b class="pos">${money(p.amount)}</b></label>`).join('')}
                            ${flArea('Narrative (on the journal line)', 'maxlength="2000" data-leg-note', l.note || '', 'ca-x-wide')}
                            ${l.note && /\[Own a\/c /.test(l.note) ? `<div class="hc-src-nv">${narrativeHtml(l.note)}</div>` : ''}
                        </div>` : s.chitMoney && l.accountId ? `<small class="muted ca-x-none">${icon('info')}No payments of this chit waiting in this account.</small>` : ''}
                    </div>`;
                }).join('');
            };
            const drawTo = () => { toSel.innerHTML = options(s.toAccountId); };
            const drawQuick = () => {
                const c = chitOf();
                const spots = (c?.money.spots || []).filter(x => num(x.amount) > 0 && x.role !== 'DIRECT' && x.accountId !== Number(s.toAccountId)
                    && !s.legs.some(l => Number(l.accountId) === x.accountId));
                el.querySelector('[data-quick]').innerHTML = s.chitMoney && spots.length ? spots.map(x => `<button type="button" class="date-chip" data-quick-add="${x.accountId}" data-amount="${x.amount}">
                    ${icon('plus')}${esc(x.accountName)} ${moneyShort(x.amount)}</button>`).join('') : '';
                el.querySelector('[data-quick-hint]').textContent = s.chitMoney && spots.length ? `where ${c.name}'s money is` : '';
            };
            const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const preview = () => {
                const legs = s.legs.filter(l => l.accountId && num(l.amount) > 0);
                const total = legs.reduce((t, l) => t + num(l.amount), 0);
                const to = byId(s.toAccountId);
                const c = chitOf();
                const tag = a => !a ? '' : a.chitBook ? (c ? `<span class="ca-tag">${esc(c.name)}</span>` : '<span class="ca-tag mine">mine</span>')
                    : s.chitMoney && c ? `<span class="ca-tag">${esc(c.name)}</span>` : '<span class="ca-tag mine">mine</span>';
                const personal = involvesPersonal();
                el.querySelector('[data-total]').textContent = money(total);
                el.querySelector('[data-kind]').textContent = s.chitMoney ? (legs.length > 1 ? 'Consolidating chit money' : 'Moving chit money')
                    : personal && to && !to.chitBook ? 'Taking my money out' : personal ? 'Putting my money in' : 'Transfer';
                el.querySelector('[data-explain]').innerHTML = !c ? 'Your own money between chit accounts; no chit is involved.'
                    : s.chitMoney ? `${esc(c.name)}'s money (the members'): it stays the chit's in every account it moves to${personal ? ', your own accounts included' : ''}.`
                    : personal ? `Your own money: ${to && !to.chitBook ? `taken out of ${esc(c.name)}'s accounts (commission, interest or an advance coming back)` : `put into ${esc(c.name)}'s accounts as an advance`}.`
                    : `Moved between ${esc(c.name)}'s chit accounts.`;
                el.querySelector('[data-preview]').innerHTML = total && to ? `<table class="ca-je ca-je-fixed"><colgroup><col><col class="amt"><col class="amt"></colgroup>
                    <thead><tr><th>Account</th><th class="num">Dr</th><th class="num">Cr</th></tr></thead><tbody>
                    <tr><td>${esc(to.name)} ${tag(to)}</td><td class="num">${money(total)}</td><td></td></tr>
                    ${legs.map(l => `<tr><td class="ca-cr">${esc(byId(l.accountId)?.name || '?')} ${tag(byId(l.accountId))}
                        ${l.note ? `<small class="ca-je-note">${esc(l.note)}</small>` : ''}${(l.paymentIds || []).length ? `<small class="ca-je-note">${icon('link')}${l.paymentIds.length} payment${l.paymentIds.length === 1 ? '' : 's'} linked</small>` : ''}</td>
                        <td></td><td class="num">${money(l.amount)}</td></tr>`).join('')}
                    </tbody><tfoot><tr><td>${legs.length > 1 ? `${legs.length} accounts` : 'Transfer'}</td><td class="num">${money(total)}</td><td class="num">${money(total)}</td></tr></tfoot></table>`
                    : `<p class="muted hc-small">Pick the accounts and amounts to see the entry.</p>`;
                el.querySelector('[data-whose]').hidden = !c;
            };
            const redraw = async () => { await drawLegs(); drawTo(); drawQuick(); preview(); };
            redraw();
            el.querySelector('[name=chitId]').addEventListener('change', e => {
                s.chitId = e.target.value ? Number(e.target.value) : null;
                if (!s.chitId) s.chitMoney = false;
                s.legs.forEach(l => { l.paymentIds = null; });
                redraw();
            });
            el.querySelector('[data-whose]').addEventListener('click', e => {
                const b = e.target.closest('[data-money]');
                if (!b) return;
                s.chitMoney = b.dataset.money === '1';
                el.querySelectorAll('[data-whose] [data-money]').forEach(x => x.classList.toggle('active', x === b));
                redraw();
            });
            el.querySelector('[data-modes]').addEventListener('click', e => {
                const b = e.target.closest('[data-mode]');
                if (!b) return;
                s.mode = b.dataset.mode;
                el.querySelectorAll('[data-modes] [data-mode]').forEach(x => x.classList.toggle('active', x === b));
            });
            el.querySelector('[data-add-leg]').addEventListener('click', () => { s.legs.push({ accountId: null, amount: '', reference: '', paymentIds: null, note: '', auto: true }); redraw(); });
            el.querySelector('[data-quick]').addEventListener('click', e => {
                const b = e.target.closest('[data-quick-add]');
                if (!b) return;
                const empty = s.legs.find(l => !l.accountId);
                const leg = { accountId: Number(b.dataset.quickAdd), amount: num(b.dataset.amount), reference: '', paymentIds: null, note: '', auto: true };
                if (empty) Object.assign(empty, leg); else s.legs.push(leg);
                redraw();
            });
            toSel.addEventListener('change', () => { s.toAccountId = toSel.value ? Number(toSel.value) : null; drawQuick(); preview(); });
            legsEl.addEventListener('change', async e => {
                const row = e.target.closest('[data-i]');
                if (!row) return;
                const leg = s.legs[Number(row.dataset.i)];
                if (e.target.matches('[data-leg-account]')) {
                    leg.accountId = e.target.value ? Number(e.target.value) : null;
                    leg.paymentIds = null; leg.note = ''; leg.auto = true;
                    // a chit's own account brings its chit along
                    const owner = byId(leg.accountId)?.hostedChitId;
                    if (owner && !s.chitId) { s.chitId = owner; el.querySelector('[name=chitId]').value = owner; }
                    if (s.chitMoney && !num(leg.amount)) leg.amount = Math.max(0, num(chitAmounts()[leg.accountId])) || '';
                    await redraw();
                    return;
                }
                if (e.target.matches('[data-pay]')) {
                    const d = await detailOf(Number(s.chitId));
                    const ids = new Set(leg.paymentIds || []);
                    if (e.target.checked) ids.add(Number(e.target.dataset.pay)); else ids.delete(Number(e.target.dataset.pay));
                    leg.paymentIds = [...ids];
                    const chosen = (d?.payments || []).filter(p => ids.has(p.id));
                    leg.amount = chosen.reduce((t, p) => t + num(p.amount), 0) || leg.amount;
                    leg.note = narrative(chosen, leg.accountId, d);
                    row.querySelector('[data-leg-amount]').value = leg.amount;
                    const noteEl = row.querySelector('[data-leg-note]');
                    if (noteEl) noteEl.value = leg.note;
                }
                preview();
            });
            legsEl.addEventListener('input', e => {
                const row = e.target.closest('[data-i]');
                if (!row) return;
                const leg = s.legs[Number(row.dataset.i)];
                if (e.target.matches('[data-leg-amount]')) { leg.amount = e.target.value; leg.auto = false; }
                if (e.target.matches('[data-leg-ref]')) leg.reference = e.target.value;
                if (e.target.matches('[data-leg-note]')) leg.note = e.target.value;
                preview();
            });
            legsEl.addEventListener('click', e => {
                const rm = e.target.closest('[data-remove]');
                if (!rm || s.legs.length === 1) return;
                s.legs.splice(Number(rm.closest('[data-i]').dataset.i), 1);
                redraw();
            });
        },
    });
}

/**
 * A short narrative for the members' payments a journal line carries, with every detail kept: who (first names; the
 * full name where two members share one), the receipt (#942 for RC-000942), the reference (/UTR265) and the amount,
 * equal amounts grouped (4×₹25,000: …). The payments are grouped by the way the money came, in tags: "[Own a/c ICICI
 * Bank → TR-000008]" for your own bank or cash account (and the transfer that moved it), "[Commission]" for another
 * of the chit's accounts; no tag when it came straight into the line's own chit account.
 * e.g. "4×₹25,000: Jyothi #942, Mahesh #943, Srinivas #944, Divya #945 | [Own a/c ICICI Bank → TR-000008] Suresh #946/UTR77 ₹1,000"
 */
export function paymentsNarrative(list, { members = [], chitName = '', accounts = [], lineAccountId = null, movedBy = () => null, fallbackAccountId = null } = {}) {
    if (!list?.length) return '';
    const firsts = {};
    (members?.length ? members.map(m => m.name) : list.map(p => p.memberName)).forEach(n => {
        const f = String(n).trim().split(/\s+/)[0].toLowerCase();
        firsts[f] = (firsts[f] || new Set()).add(String(n).trim().toLowerCase());
    });
    const who = name => {
        const f = String(name).trim().split(/\s+/)[0];
        return (firsts[f.toLowerCase()]?.size || 0) > 1 ? String(name).trim() : f;
    };
    const receipt = r => (r ? ` #${String(r).replace(/^[A-Za-z]+-?0*/, '')}` : '');
    const token = p => `${who(p.memberName)}${receipt(p.receiptNo)}${p.reference ? `/${p.reference}` : ''}`;
    const prefix = chitName ? `${chitName} - ` : '';
    const nameOf = a => (prefix && a.name.startsWith(prefix) ? a.name.slice(prefix.length).replace(/^./, ch => ch.toUpperCase()) : a.name);
    const segments = new Map();
    for (const p of list) {
        const originId = p.accountId || fallbackAccountId;
        const a = accounts.find(x => x.id === originId);
        const t = movedBy(p.id);
        const own = a && !a.chitBook;
        const label = !own && !t && (originId === lineAccountId || !a) ? ''
            : `[${own ? 'Own a/c ' : ''}${a ? nameOf(a) : 'Collections'}${t ? ` → ${t.entryNo}` : ''}] `;
        segments.set(label, [...(segments.get(label) || []), p]);
    }
    return [...segments].map(([label, ps]) => {
        const byAmount = new Map();
        ps.forEach(p => byAmount.set(num(p.amount), [...(byAmount.get(num(p.amount)) || []), p]));
        return label + [...byAmount].map(([amount, group]) => group.length > 1
            ? `${group.length}×${money(amount)}: ${group.map(token).join(', ')}`
            : `${token(group[0])} ${money(amount)}`).join('; ');
    }).join(' | ');
}

/** Add or change a chit account: a common one (any chit) or a chit's own; or move one of my accounts in. */
function openAccountForm(book, account, { reload, accounts }) {
    const editing = !!account;
    const s = {
        mode: 'NEW', name: account?.name || '', accountType: account?.accountType || 'BANK', hostedChitId: account?.hostedChitId || null,
        role: account?.role && account.role !== 'COMMON' ? account.role : 'COLLECTION', institution: account?.institution || '',
        accountNumber: account?.accountNumber || '', description: account?.description || '', active: account ? account.active : true,
    };
    openModal({
        title: editing ? `Edit ${account.name}` : 'Add a chit account', iconName: 'wallet', size: 'lg',
        body: `
        ${editing ? '' : `<div class="seg-chips" data-modes style="margin-bottom:10px">
            <button type="button" class="seg-chip active" data-mode="NEW">${icon('plus')}New account</button>
            <button type="button" class="seg-chip" data-mode="MOVE">${icon('arrow-in')}Move one of my accounts here</button></div>`}
        <form class="form-grid two" onsubmit="return false">
            <div class="field span-2" data-new><span>Kind</span><div class="seg-chips" data-types>${TYPES.map(([v, l, i]) =>
                `<button type="button" class="seg-chip ${s.accountType === v ? 'active' : ''}" data-type="${v}">${icon(i)}${l}</button>`).join('')}</div></div>
            <label class="field span-2" data-new><span>Name</span><input type="text" name="name" value="${esc(s.name)}" maxlength="100" placeholder="e.g. SBI chit account" required></label>
            <label class="field span-2" data-move hidden><span>My account</span><select name="personalId">
                <option value="">Pick one of your cash, bank or wallet accounts</option>
                ${accounts.filter(a => !a.chitBook && a.active && ['CASH', 'BANK', 'WALLET'].includes(a.accountType)).map(a =>
                    `<option value="${a.id}" data-balance="${a.balance}">${esc(a.name)}</option>`).join('')}</select>
                <small>For a bank account you keep only for chits: it leaves the Accounts page and its postings stay as they are.</small></label>
            <label class="field"><span>Belongs to</span><select name="hostedChitId" data-plain>
                <option value="">All chits (a common account)</option>
                ${book.chits.map(c => `<option value="${c.id}" ${c.id === s.hostedChitId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field" data-role ${s.hostedChitId ? '' : 'hidden'}><span>Used for</span><select name="role" data-plain>
                ${['COLLECTION', 'COMMISSION', 'LATE_FEE'].map(r => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${ROLE[r][0]}</option>`).join('')}</select></label>
            <label class="field" data-new><span>Bank / institution</span><input type="text" name="institution" value="${esc(s.institution)}" maxlength="100" data-plain></label>
            <label class="field" data-new><span>Account number</span><input type="text" name="accountNumber" value="${esc(s.accountNumber)}" maxlength="40" data-plain></label>
            <label class="field" data-new data-bankf="BANK WALLET"><span>Account holder name</span><input type="text" name="holderName" value="${esc(account?.holderName || '')}" maxlength="100" placeholder="As on the passbook" data-plain></label>
            <label class="field" data-new data-bankf="BANK"><span>IFSC</span><input type="text" name="ifsc" value="${esc(account?.ifsc || '')}" maxlength="11" placeholder="e.g. SBIN0001234" style="text-transform:uppercase" data-plain></label>
            <label class="field span-2" data-new data-bankf="BANK WALLET"><span>UPI ID <small class="muted">members pay into it from their payment links</small></span><input type="text" name="upiId" value="${esc(account?.upiId || '')}" maxlength="60" placeholder="name@bank" data-plain></label>
            ${editing ? '' : `<label class="field" data-new><span>Opening balance <small class="muted">your own money</small></span><input type="number" name="openingBalance" class="num" step="any" min="0" data-type="number"></label>
            <label class="field" data-new><span>As of</span><input type="date" name="openingDate" value="${isoDate()}"></label>`}
            <label class="field span-2" data-new><span>Note</span><input type="text" name="description" value="${esc(s.description)}" maxlength="255"></label>
            ${editing ? `<label class="check-line span-2"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Active (inactive accounts cannot be used)</label>` : ''}
        </form>`,
        actions: [
            ...(editing && account.transactionCount === 0 && !account.usedBy.length ? [{ label: 'Delete', kind: 'danger', left: true, iconName: 'trash', onClick: async () => {
                if (!await confirmDialog(`Delete ${account.name}?`, { confirmLabel: 'Delete' })) return true;
                await api.del(`/hosted-chits/book/accounts/${account.id}`);
                toast(`${account.name} deleted`);
                reload(null);
            } }] : []),
            { label: 'Cancel' },
            { label: editing ? 'Save' : 'Add', kind: 'primary', iconName: 'check', onClick: async modal => {
                const f = modal.el.querySelector('form');
                const chit = f.hostedChitId.value ? Number(f.hostedChitId.value) : null;
                if (s.mode === 'MOVE') {
                    if (!f.personalId.value) throw new Error('Pick the account to move');
                    const moved = await api.post(`/hosted-chits/book/accounts/${f.personalId.value}/move`, { chitBook: true, hostedChitId: chit });
                    toast(`${moved.name} is now a chit account`);
                    reload(`acct:${moved.id}`);
                    return;
                }
                if (!f.name.value.trim()) throw new Error('Give the account a name');
                if (f.name.value.trim().length > 100) throw new Error('The name can be at most 100 characters');
                if (f.accountNumber.value.trim() && !/^[A-Za-z0-9 \-/]{2,40}$/.test(f.accountNumber.value.trim())) throw new Error('The account number can have letters, digits, spaces and dashes (up to 40)');
                if (f.openingBalance && Number(f.openingBalance.value) < 0) throw new Error('The opening balance cannot be negative');
                if (f.openingDate?.value && f.openingDate.value > isoDate()) throw new Error('The opening date cannot be in the future');
                if (f.description.value.trim().length > 255) throw new Error('The note can be at most 255 characters');
                const bankf = ['BANK', 'WALLET'].includes(s.accountType);
                const ifsc = s.accountType === 'BANK' ? f.ifsc.value.trim().toUpperCase() : '';
                const upi = bankf ? f.upiId.value.trim() : '';
                if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error('The IFSC is 4 letters, a zero, then 6 letters or digits (e.g. SBIN0001234)');
                if (upi && !/^[\w.\-]{2,}@[A-Za-z][\w.]{1,}$/.test(upi)) throw new Error('The UPI ID looks like name@bank');
                const body = {
                    name: f.name.value.trim(), accountType: s.accountType, hostedChitId: chit, role: chit ? f.role.value : null,
                    institution: f.institution.value.trim() || null, accountNumber: f.accountNumber.value.trim() || null,
                    openingBalance: f.openingBalance ? (Number(f.openingBalance.value) || null) : null, openingDate: f.openingDate?.value || null,
                    description: f.description.value.trim() || null, active: editing ? f.active.checked : true, version: account?.version,
                    holderName: bankf ? f.holderName.value.trim() || null : null, ifsc: ifsc || null, upiId: upi || null,
                };
                const saved = editing ? await api.put(`/hosted-chits/book/accounts/${account.id}`, body) : await api.post('/hosted-chits/book/accounts', body);
                toast(editing ? 'Saved' : `${saved.name} added`);
                reload(`acct:${saved.id}`);
            } },
        ],
        onOpen: modal => {
            const el = modal.el;
            el.querySelector('[data-types]')?.addEventListener('click', e => {
                const b = e.target.closest('[data-type]');
                if (!b) return;
                s.accountType = b.dataset.type;
                el.querySelectorAll('[data-types] [data-type]').forEach(x => x.classList.toggle('active', x === b));
                syncBank();
            });
            const syncBank = () => el.querySelectorAll('[data-bankf]').forEach(x => {
                x.hidden = s.mode !== 'NEW' || !x.dataset.bankf.split(' ').includes(s.accountType);
            });
            syncBank();
            el.querySelector('[data-modes]')?.addEventListener('click', e => {
                const b = e.target.closest('[data-mode]');
                if (!b) return;
                s.mode = b.dataset.mode;
                el.querySelectorAll('[data-modes] [data-mode]').forEach(x => x.classList.toggle('active', x === b));
                el.querySelectorAll('[data-new]').forEach(x => { x.hidden = s.mode !== 'NEW'; });
                el.querySelector('[data-move]').hidden = s.mode !== 'MOVE';
                syncBank();
            });
            el.querySelector('[name=hostedChitId]').addEventListener('change', e => { el.querySelector('[data-role]').hidden = !e.target.value; });
        },
    });
}


