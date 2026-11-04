/**
 * Chits: the portfolio card over the chit list (paid in against the whole commitment, interest so far, the
 * yearly return, running / closed, matured chits optionally counted), beside it cards with a meter each (net
 * gain, take home now, future value, still to pay, next due or overdue, dividends); chit rows on the left
 * (running, then matured & closed, listed with the "with matured" switch of the portfolio card; a closed chit can be reopened),
 * and for the selected chit a branded banner, key figures, its installments and month-by-month interest.
 * Installments are booked on their due date; each chit can have its own default payment account.
 */
import { api } from '../core/api.js';
import { loadAccounts, can } from '../core/store.js';
import { loadOrders, ranked, arrangeLockHtml, bindArrange } from '../core/arrange.js';
import { panel, esc, field, readForm, openModal, routeNextDialog, dialogOpen, toast, confirmDialog, emptyState, statusBadge, accountOptions, accountChip } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, percent, isoDate, daysFromToday } from '../core/format.js';
import { toggleEntryRow, focusEntryRow } from '../components/entry-inline.js';
import { openUpiDialog, upiCardHtml, upiNote, bindUpiCopy } from '../components/upi-pay.js';
import { getPref, setPref } from '../core/prefs.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { evidenceFieldHtml, bindEvidenceField } from '../components/evidence.js';
import { attachNotify } from '../components/notify-toggle.js';
import { exportButton, bindExport } from '../core/export.js';
import { showRoute, routeHash, readQuery, setQuery } from '../core/route.js';
import { openChitShareDialog } from '../components/chit-link.js';
import { openReceiptSend, openPayoutSend, receiptsTabHtml, handleReceiptClick, ackByInstallment, ackBadge, isFinal } from '../components/chit-receipt.js';
import { liftable, payoutFor, hasTerms } from './chit-math.js';
import { chitInsights } from './chit-insight.js';
import { liftTabHtml, drawLiftTabCharts } from './chit-insight-view.js';
import { mountLiftTable } from './chit-lift-table.js';

const view = { selectedId: null, pinnedId: null, tab: 'installments', interestFilter: 'all', search: '' };
const CHIT_TABS = ['installments', 'receipts', 'interest', 'lift', 'payout', 'details'];
// the yardsticks of the Lift or hold tab, the same for every chit
const YARDSTICKS = { investRate: 8, loanRate: 12, inflation: 6, fdRate: 7, volatility: 3, risk: 1, view: 'overview' };

const prefs = getPref('chits', { includeMatured: false });
const savePrefs = () => setPref('chits', prefs);

const isRunning = c => c.status === 'ACTIVE' || c.status === 'PRIZED';

export async function render(container, params, isCurrent) {
    // the address: #/chits/<chit>/<tab>; #/chits/<chit>/entry/<entry> opens that chit on the tab holding the entry,
    // the entry expanded (the address then becomes the chit and tab)
    let focusEntry = null;
    if (/^\d+$/.test(params[0] || '')) {
        view.selectedId = Number(params[0]);
        view.pinnedId = view.selectedId;   // a chit asked for by its address stays listed, even matured or closed
        view.search = '';
        if (params[1] === 'entry' && /^\d+$/.test(params[2] || '')) focusEntry = Number(params[2]);
        else if (CHIT_TABS.includes(params[1])) view.tab = params[1];
    }
    const [listed] = await Promise.all([api.get('/chits'), loadOrders()]);
    if (!isCurrent()) return;
    const chits = ranked('chits', listed);
    Object.assign(prefs, getPref('chits', { includeMatured: false }));
    // ...?matured=1&q=…&interest=earned: the address goes first
    const asked = params.query;
    if (asked?.has('matured')) prefs.includeMatured = asked.get('matured') === '1';
    if (asked?.toString()) {
        view.search = asked.get('q') || '';
        view.interestFilter = asked.get('interest') || 'all';
    }
    if (asked?.get('view')) setPref('chitInsight', { ...getPref('chitInsight', {}), view: asked.get('view') });
    const reload = () => render(container, [], isCurrent);

    container.innerHTML = `
    <div class="page chits-page">
        <section class="cp-card" id="chit-brand"></section>
        <div class="cs-cards" id="chit-cards"></div>
        <section class="panel p-chit-list headless">
            <div class="panel-body flush">
                <div class="list-tools">
                    <div class="lt-top">
                        <div class="search-box">${icon('search')}<input id="chit-search" name="q-chits" data-plain placeholder="Search chits…  ↑↓ to move" value="${esc(view.search)}">
                            <span class="lt-count" id="chit-count" title="Running chits">${chits.filter(isRunning).length} running</span></div>
                        <span id="chit-arrange">${arrangeLockHtml()}</span>
                        <a class="btn ghost icon lt-micro" href="#/reports/chit-summary" title="Chit summary: the selected chits together, printable">${icon('printer')}</a>
                        <a class="btn ghost icon lt-micro" href="#/forecast/chit" title="Chit illustrator: bids, dividends and the best month to lift">${icon('calculator')}</a>
                        ${can('MANAGE_CHITS') ? `<button class="btn primary icon lt-add" id="new-chit" title="Add chit">${icon('plus')}</button>` : ''}
                    </div>
                </div>
                <div class="chit-rows scroll" id="chit-list" tabindex="0" aria-label="Chits, use the arrow keys to move"></div>
            </div>
        </section>
        <div class="chit-detail" id="chit-detail">${chits.length ? '' : panel({ title: 'Chit', iconName: 'chit', body: emptyState('No chits yet') })}</div>
    </div>`;

    const brand = container.querySelector('#chit-brand');
    const drawStrip = () => {
        const [card, cells] = portfolioStrip(chits);
        brand.innerHTML = card;
        container.querySelector('#chit-cards').innerHTML = cells;
    };
    brand.addEventListener('change', e => {
        if (e.target.id !== 'include-matured') return;
        prefs.includeMatured = e.target.checked;
        savePrefs();
        setQuery({ matured: prefs.includeMatured ? '1' : '0' });
        drawStrip();
        view.pinnedId = null;
        openFirstListed(drawRows());
    });
    drawStrip();

    const openNew = () => { routeNextDialog('new-chit'); openChitForm(null, saved => { view.selectedId = saved.chit.id; reload(); }); };
    container.querySelector('#new-chit')?.addEventListener('click', openNew);
    if (readQuery().get('dialog') === 'new-chit' && can('MANAGE_CHITS') && !dialogOpen()) openNew();
    container.querySelector('#chit-list').addEventListener('click', e => {
        const card = e.target.closest('[data-id]');
        if (card) show(Number(card.dataset.id), { push: true });
    });

    // the search narrows the list on name, organizer, ticket, status and the account it is paid from; it looks through
    // the matured and closed chits too, listed or not. Without them the list keeps a chit with payout still to come.
    const matching = () => {
        const term = view.search.trim().toLowerCase();
        if (term) return chits.filter(c => [c.name, c.organizer, c.ticketNo, c.status, c.accountName, c.notes]
            .some(v => v && String(v).toLowerCase().includes(term)));
        return prefs.includeMatured ? chits : chits.filter(c => isRunning(c) || Number(c.payoutPending) > 0 || c.id === view.pinnedId);
    };
    bindArrange({ list: 'chits', tools: container.querySelector('#chit-arrange'), root: container.querySelector('#chit-list'), selector: '.chit-item[data-id]',
        allIds: () => chits.map(c => c.id), onReset: () => reload() });
    const drawRows = () => {
        const list = matching();
        container.querySelector('#chit-list').innerHTML = list.length ? chitRows(list)
            : emptyState(!chits.length ? 'Add your first chit' : view.search.trim() ? 'No chits match' : 'Every chit has matured or closed: switch on “with matured” above to see them', 'chit');
        container.querySelector('#chit-count').textContent = view.search.trim() ? `${list.length} of ${chits.length}` : `${chits.filter(isRunning).length} running`;
        return list;
    };
    const search = container.querySelector('#chit-search');
    search.addEventListener('input', () => {
        view.search = search.value;
        setQuery({ q: view.search });
        const list = drawRows();
        if (list.length && !list.some(c => c.id === view.selectedId)) show(list[0].id);
    });
    search.addEventListener('keydown', e => {
        if (e.key === 'Escape' && search.value) { search.value = ''; view.search = ''; drawRows(); }
    });

    // the chit selected stays open while it is listed; else the first one listed, or nothing
    function openFirstListed(list) {
        if (list.some(c => c.id === view.selectedId)) return show(view.selectedId);
        if (list.length) return show(list[0].id);
        view.selectedId = null;
        if (chits.length) container.querySelector('#chit-detail').innerHTML = panel({ title: 'Chit', iconName: 'chit', body: emptyState('No chit listed') });
    }

    async function show(id, { push = false } = {}) {
        if (push && id !== view.selectedId) view.tab = 'installments';   // another chit starts on its installments
        view.selectedId = id;
        if (id !== view.pinnedId) view.pinnedId = null;
        container.querySelectorAll('#chit-list [data-id]').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === id));
        const detail = await api.get(`/chits/${id}`);
        const entry = focusEntry;
        focusEntry = null;
        if (entry) view.tab = detail.payoutReceipts.some(p => p.entryId === entry) ? 'payout' : 'installments';
        drawDetail(container.querySelector('#chit-detail'), detail, reload);
        showRoute(routeHash(`chits/${id}/${view.tab}`, { matured: readQuery().get('matured'), q: view.search, interest: view.interestFilter === 'all' ? null : view.interestFilter, view: view.tab === 'lift' ? readQuery().get('view') : null, dialog: readQuery().get('dialog') }), { push });
        if (entry) focusEntryRow(container.querySelector('#chit-detail'), entry, { onChanged: reload });
    }

    // ↑ / ↓ move through the chits, Enter pays the next installment
    const listEl = container.querySelector('#chit-list');
    let keyTimer;
    setPageKeys(listNavigator({
        items: () => [...listEl.querySelectorAll('[data-id]')],
        selected: () => listEl.querySelector('.selected'),
        select: el => {
            listEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => show(Number(el.dataset.id)), 130);
        },
        // Enter in the search box only moves to the list; from the list it pays the next installment
        open: () => (document.activeElement === search ? listEl.focus() : container.querySelector('.p-chit-head [data-pay]')?.click()),
        allowWhileTyping: search,
    }));

    await openFirstListed(drawRows());
}

/**
 * One slim branded strip for the whole portfolio. Gains count running chits (expected gain) and,
 * when the switch is on, also chits already paid out or matured (realised gain).
 */
function portfolioStrip(chits) {
    const running = chits.filter(isRunning);
    const done = chits.filter(c => !isRunning(c));
    const pool = prefs.includeMatured ? chits : running;
    const sum = (list, key) => list.reduce((s, c) => s + Number(c[key] || 0), 0);
    const lift = running.map(takeHomeNow).filter(Boolean);
    const expected = running.filter(c => c.payoutAmount === null).reduce((s, c) => s + Number(c.projectedNetGain || 0), 0);
    const realised = (prefs.includeMatured ? chits : running).filter(c => c.realizedGain !== null).reduce((s, c) => s + Number(c.realizedGain), 0);
    const total = sum(running, 'totalContribution') || 1;
    const paid = sum(running, 'paidIn');
    const nextDue = running.filter(c => c.nextDueDate).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))[0];
    const overdue = sum(running, 'overdueCount');
    const future = running.filter(c => c.payoutAmount === null).reduce((s, c) => s + Number(c.maturityAmount), 0);
    const cell = (iconName, label, value, sub, cls = '', meter = null, title = '') => `<div class="ov-card cs-card ${cls}" ${title ? `title="${esc(title)}"` : ''}>
        <span class="ov-ico">${icon(iconName)}</span>
        <div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small>
            ${meter !== null ? `<i class="ov-meter"><em style="width:${Math.max(2, Math.min(100, meter))}%"></em></i>` : ''}</div></div>`;
    // compound return weighted by what is paid in, and what the same money would have made in a 7% FD
    const weightBase = pool.reduce((s, c) => s + Number(c.paidIn || 0), 0) || 1;
    const weighted = pool.reduce((s, c) => s + chitReturns(c).compound * Number(c.paidIn || 0), 0) / weightBase;
    const vsFd = pool.filter(isRunning).reduce((s, c) => s + chitReturns(c).vsFd, 0);
    const paidPct = (paid / total) * 100;
    const interest = sum(pool, 'compoundInterestEarned');
    const nextDays = nextDue ? daysFromToday(nextDue.nextDueDate) : null;
    const stillToPay = sum(running, 'stillToPay');
    const pending = sum(running, 'installmentsPending');
    // what the chits ask each month now (running chits with installments left), and when the last one ends
    const monthly = running.filter(c => Number(c.installmentsPending) > 0).reduce((s, c) => s + Number(c.monthlyInstallment || 0), 0);
    const lastEnd = running.map(c => c.maturityDate).filter(Boolean).sort().at(-1);
    const month = isoDate().slice(0, 7);
    const dueThisMonth = running.filter(c => c.nextDueDate && c.nextDueDate.slice(0, 7) === month);
    const dividends = sum(pool, 'dividendsEarned');
    const card = `
        <div class="cp-head"><span class="cp-mark">${icon('chit-book')}</span>
            <div class="min-0"><small>Chit portfolio · <span class="cp-count">${running.length} running${done.length ? ` · ${done.length} done` : ''}</span></small>
                <div class="cp-line"><b>${moneyShort(sum(pool, 'paidIn'))} <em>paid in</em></b>
                ${stillToPay > 0 ? `<span class="cp-still" title="${pending} installments left in the running chits">${moneyShort(stillToPay)} to pay · ${pending} left</span>` : '<span class="cp-still done">all installments paid</span>'}</div></div>
            <span class="cp-rate" title="Yearly return, weighted by what is paid in">${percent(weighted, 1)}<small>a year</small></span></div>
        <div class="cp-progress" title="${percent(paidPct, 0)} of the ${moneyShort(total)} the running chits ask for: paid in, then still to pay">
            <i class="onc-bar cp-split"><em style="width:${Math.min(100, paidPct)}%"></em></i>
            <span><b>${percent(paidPct, 0)}</b> paid of ${moneyShort(total)} · ${moneyShort(stillToPay)} to go · interest <b class="up">+${moneyShort(interest)}</b>
                ${done.length ? `<label class="cs-mini-switch" title="List the matured and closed chits and count them in the figures"><input type="checkbox" id="include-matured" ${prefs.includeMatured ? 'checked' : ''}><i></i>with matured</label>` : ''}</span></div>`;
    const cells = `
        ${cell('trending', 'Net gain', `<span class="${expected + realised >= 0 ? 'up' : 'down'}">${moneyShort(expected + realised)}</span>`,
            realised ? `${moneyShort(expected)} expected · ${moneyShort(realised)} realised` : 'expected at maturity', expected + realised >= 0 ? 'good' : 'warn')}
        ${cell('gift', 'Take home now', `<span class="gold">${lift.length ? moneyShort(lift.reduce((s, t) => s + t.prize, 0)) : '—'}</span>`,
            lift.length ? `${lift.length} chit${lift.length === 1 ? '' : 's'} · +${moneyShort(lift.reduce((s, t) => s + t.waitGain, 0))} if you wait` : 'nothing to lift', 'highlight')}
        ${cell('target', 'Future value', moneyShort(future), `+${moneyShort(sum(running, 'projectedCompoundInterest'))} interest${lastEnd ? ` · last ends ${shortDate(lastEnd)}` : ''}`, '',
            future ? (sum(running, 'paidIn') / future) * 100 : null, 'The bar: paid in so far against the maturity amounts')}
        ${cell('hourglass', 'Still to pay', moneyShort(stillToPay), `${pending} installments${monthly ? ` · ${moneyShort(monthly)}/month` : ''}`, '',
            (stillToPay / total) * 100, monthly ? `The running chits ask ${money(monthly)} a month together` : '')}
        ${overdue ? cell('alert', 'Overdue', `<span class="down">${moneyShort(sum(running, 'overdueAmount'))}</span>`, `${overdue} installment(s) · pay them first`, 'warn')
                  : cell('calendar', 'Next due', nextDue ? moneyShort(nextDue.nextDueAmount) : '—',
                      nextDue ? `${esc(nextDue.name)} · ${nextDays === 0 ? 'today' : nextDays === 1 ? 'tomorrow' : shortDate(nextDue.nextDueDate)}${dueThisMonth.length > 1 ? ` · ${dueThisMonth.length} due this month` : ''}` : 'nothing due',
                      nextDays !== null && nextDays <= 3 ? 'note' : '', null, nextDue ? `${nextDue.name}: ${money(nextDue.nextDueAmount)} on ${date(nextDue.nextDueDate)}` : '')}
        ${cell('piggy', 'Earned so far', `<span class="up">+${moneyShort(interest + dividends)}</span>`,
            dividends ? `${moneyShort(interest)} interest · ${moneyShort(dividends)} dividends` : `interest · ${percent(weighted, 1)} a year · ${vsFd >= 0 ? '+' : '−'}${moneyShort(Math.abs(vsFd))} vs FD`,
            vsFd >= 0 ? 'good' : 'warn', null,
            `Interest earned so far ${money(interest)}${dividends ? ` and dividends ${money(dividends)} (${percent((dividends / (sum(pool, 'paidIn') || 1)) * 100, 1)} of paid in)` : ', no dividends'}; against a 7% fixed deposit the chits are ${vsFd >= 0 ? 'ahead' : 'behind'} by ${money(Math.abs(vsFd))}`)}`;
    return [card, cells];
}

/** Months (fractional) from today to an ISO date, never negative. */
function monthsUntil(iso) {
    const a = new Date(isoDate() + 'T00:00:00');
    const b = new Date(iso + 'T00:00:00');
    return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30);
}

/**
 * Take home now: what the chit is worth to you today, i.e. the installments you have actually paid plus the
 * interest they have earned up to today (compound, at the chit's rate). Unpaid installments are not counted.
 * "If you wait": what maturity adds on top, after paying the installments still due
 * (maturity amount - still to pay - take home now). Only running, not yet prized chits qualify.
 */
export function takeHomeNow(c) {
    if (c.status !== 'ACTIVE' || c.payoutAmount !== null) return null;
    const paidIn = Number(c.paidIn);
    const interest = Number(c.compoundInterestEarned || 0);
    const prize = Math.round(paidIn + interest);
    return {
        prize,
        paidIn,
        interest,
        waitGain: Math.round(Number(c.maturityAmount) - Number(c.stillToPay) - prize),
        duesAfter: Number(c.stillToPay),
        vsPaidIn: Math.round(interest),
    };
}

/**
 * The chit's return both ways:
 *   compound  the effective annual rate (IRR of the installments against the maturity amount)
 *   simple    the flat annual rate that gives the same interest on money that sat in the chit:
 *             installment k sits for (n − k + 1) months, so the money-months are m × n(n+1)/2
 * plus what the same installments would earn in a 7% fixed deposit.
 */
export function chitReturns(c) {
    const m = Number(c.monthlyInstallment), n = Number(c.numberOfInstallments);
    const r = Number(c.rateUsed) / 1200;   // the monthly rate the interest schedule uses
    // full-term compound interest at that rate: installment k grows for (n − k + 1) months
    let interest = 0;
    for (let k = 1; k <= n; k++) interest += m * (Math.pow(1 + r, n - k + 1) - 1);
    const compound = (Math.pow(1 + r, 12) - 1) * 100;
    const simple = m && n ? (interest / (m * n * (n + 1) / 2 / 12)) * 100 : 0;
    let fd = 0;
    for (let k = 0; k < n; k++) fd = (fd + m) * (1 + 0.07 / 12);
    return { compound, simple, interest, fdInterest: fd - m * n, vsFd: interest - (fd - m * n) };
}

/**
 * The chit's progress in its banner: a bar of what is paid in (and what is overdue) against the whole contribution,
 * a tick where you should be by today (installments fallen due), and a line with the percent, the money and the
 * installments.
 */
function chitProgress(c, installments, total, upcoming) {
    const pct = v => Math.max(0, Math.min(100, (Number(v) / total) * 100));
    const today = isoDate();
    const due = installments.filter(i => i.dueDate <= today).length;
    const duePct = Math.min(100, (due / c.numberOfInstallments) * 100);
    const paidPct = pct(c.paidIn);
    const overdue = Number(c.overdueAmount) || 0;
    const ahead = c.installmentsPaid - due;
    return `<div class="cb-progress" title="${esc(`Paid ${money(c.paidIn)} of ${money(total)} · ${due} of ${c.numberOfInstallments} installments fallen due by today`)}">
        <div class="cb-track">
            <span class="cb-paid" style="width:${paidPct}%"></span>
            ${overdue ? `<span class="cb-overdue" style="width:${pct(overdue)}%"></span>` : ''}
            ${due && due < c.numberOfInstallments ? `<i class="cb-now" style="left:${duePct}%" title="Today: ${due} of ${c.numberOfInstallments} installments due"></i>` : ''}
        </div>
        <div class="cb-legend"><b>${percent(paidPct, 0)}</b> paid · ${money(c.paidIn)} of ${moneyShort(total)}
            <span>· ${c.installmentsPaid}/${c.numberOfInstallments} installments</span>
            ${overdue ? `<span class="cb-late">· ${moneyShort(overdue)} overdue</span>` : ahead > 0 ? `<span class="cb-ahead">· ${ahead} ahead</span>` : ''}
            ${upcoming > 0 ? `<span>· ${moneyShort(upcoming)} to go</span>` : ''}</div>
    </div>`;
}

/**
 * The dividend facts of the stat line. With dividends: what they came to, per installment on average and as a share of
 * what was paid in. Most chits pay none, so then the line says what the chit gives back instead: the payout as a
 * multiple of the contribution and the months left.
 */
function dividendFacts(c, installments) {
    const dividends = Number(c.dividendsEarned) || 0;
    if (dividends > 0) {
        const withDividend = installments.filter(i => Number(i.dividend) > 0).length || 1;
        return `<span title="Dividends cut the cash you paid">${icon('piggy')}Dividends <b class="pos">${money(dividends)}</b></span>
            <span title="Average dividend per installment that had one, and dividends as a share of what is paid in">${icon('coins')}Avg <b>${moneyShort(dividends / withDividend)}</b>
                <small>yield</small><b>${percent((dividends / (Number(c.paidIn) || 1)) * 100, 1)}</b></span>`;
    }
    const multiple = Number(c.totalContribution) ? Number(c.maturityAmount) / Number(c.totalContribution) : 0;
    const monthsLeft = Math.max(0, c.numberOfInstallments - c.installmentsPaid);
    return `<span title="What the chit pays out against all the installments together">${icon('piggy')}Payout <b class="pos">${multiple.toFixed(2)}×</b><small>of contribution</small></span>
        <span title="Installments still to pay, and the gain each month of waiting adds">${icon('hourglass')}<b>${monthsLeft}</b> months left${monthsLeft
            ? ` · <b class="pos">+${moneyShort((Number(c.maturityAmount) - Number(c.totalContribution)) / c.numberOfInstallments)}</b>/month gain` : ''}</span>`;
}

/**
 * Chit rows shaped like the account list: name and maturity value, then organizer and progress with small facts
 * (compound return, next due or overdue) and the interest earned, then a slim paid-in bar.
 */
function chitRows(chits) {
    const row = c => {
        const total = Number(c.totalContribution) || 1;
        const paidPct = (Number(c.paidIn) / total) * 100;
        const due = c.nextDueDate ? daysFromToday(c.nextDueDate) : null;
        const r = chitReturns(c);
        const accent = c.status === 'PRIZED' ? 'gold' : isRunning(c) ? 'aqua' : 'slate';
        const dueFact = c.nextDueDate
            ? `<span class="fact ${due < 0 ? 'bad' : due <= 5 ? 'warn' : ''}" title="Next installment ${money(c.nextDueAmount)} on ${date(c.nextDueDate)}">${due < 0 ? 'overdue' : shortDate(c.nextDueDate)}</span>`
            : `<span class="fact muted">${c.status === 'ACTIVE' ? 'all paid' : c.status.toLowerCase()}</span>`;
        return `
        <div class="acct-item rich chit-item accent-${accent} status-${c.status.toLowerCase()} ${c.id === view.selectedId ? 'selected' : ''}" data-id="${c.id}">
            ${accountChip('CHIT_FUND', true)}
            <div class="acct-main">
                <div class="acct-line"><span class="acct-name">${esc(c.name)}</span><b class="acct-bal" title="${c.payoutAmount !== null ? (Number(c.payoutPending) ? `Payout ${money(c.payoutAmount)}: ${money(c.payoutReceived)} received` : 'Received') : 'At maturity'}">${money(c.payoutAmount ?? c.maturityAmount)}</b></div>
                <div class="acct-line sub">
                    <span class="acct-meta">${esc(c.organizer || '—')} · ${c.installmentsPaid}/${c.numberOfInstallments}</span>
                    <span class="acct-facts"><span class="fact good" title="Compound ${percent(r.compound, 2)} · simple ${percent(r.simple, 2)} a year">${percent(r.compound, 1)}</span>${dueFact}</span>
                    <span class="acct-delta pos" title="Interest earned so far">+${moneyShort(c.compoundInterestEarned)}</span>
                </div>
                <div class="chit-prog"><div class="acct-util good" title="${percent(paidPct, 0)} paid in"><span style="width:${paidPct}%"></span></div>
                    <small>${c.status === 'CLOSED' ? `${icon('lock')}closed` : Number(c.payoutPending) ? `<span class="gold-ink">${icon('hourglass')}${moneyShort(c.payoutPending)} of payout to come</span>`
                        : c.payoutAmount !== null ? `${icon('gift')}paid out ${shortDate(c.payoutDate)}`
                        : `${percent(paidPct, 0)} · ${c.daysToMaturity >= 0 ? `matures ${shortDate(c.maturityDate)}` : 'matured'}`}</small></div>
            </div>
        </div>`;
    };
    const running = chits.filter(isRunning);
    const done = chits.filter(c => !isRunning(c));
    return running.map(row).join('')
        + (done.length ? `<div class="group-label"><span>Matured &amp; closed <i>${done.length}</i></span>
            <b>${moneyShort(done.reduce((s, c) => s + Number(c.payoutAmount ?? c.maturityAmount), 0))}</b></div>${done.map(row).join('')}` : '');
}

// ===================================================================== detail

function drawDetail(container, { chit: c, installments, interestSchedule, payoutReceipts = [] }, reload) {
    // fresh element each time so handlers of a previously shown chit do not pile up
    const target = container.cloneNode(false);
    container.replaceWith(target);
    const manage = can('MANAGE_CHITS');
    const paidOut = c.payoutAmount !== null;
    const toCome = paidOut ? Number(c.payoutPending || 0) : 0;   // the organizer still owes this part of the payout
    if (view.tab === 'payout' && !paidOut) view.tab = 'installments';
    const canLift = liftable(c);
    if (view.tab === 'lift' && !canLift) view.tab = 'installments';
    let terms = null;   // the chit table (lift terms), loaded after the page is drawn
    const nextPending = installments.find(i => i.status === 'PENDING');
    const total = Number(c.totalContribution) || 1;
    const upcoming = Number(c.stillToPay) - Number(c.overdueAmount);
    const liftNow = takeHomeNow(c);
    const closed = c.status === 'CLOSED';
    target.classList.toggle('is-closed', closed);
    let acks = [];   // the organizer's acknowledgements of the payments, loaded after the page is drawn
    const anyPaid = installments.some(i => i.status === 'PAID');
    const payoutReady = paidOut && toCome === 0;   // the whole payout is in: the organizer can be asked to confirm it

    // The banner's actions, side by side: the next thing to do as a large button saying how much and by when (pay, joined to
    // its UPI QR; a payout part due, or closing, when that is what the chit is waiting for), then everything else as captioned
    // tiles, coloured by what they are about
    const step = closed ? null : toCome ? 'payout-part' : c.closable ? 'close' : !paidOut ? 'payout' : null;
    // recording the payout is a step only once nothing is left to pay; until then it waits among the tiles
    const stepShown = step === 'payout' && nextPending ? null : step;
    const tile = (act, iconName, caption, label, hint = '', { cls = '', extra = '' } = {}) => `<button type="button" class="ca-tile ${cls}" data-act="${act}" title="${esc(hint ? `${label}: ${hint}` : label)}" aria-label="${esc(label)}">
            <span class="ca-tile-ico">${icon(iconName)}${extra}</span><span class="ca-tile-cap">${esc(caption)}</span></button>`;
    const big = (cls, attr, iconName, label, note, title) => `<button type="button" class="btn ${cls} ca-big" ${attr} title="${esc(title)}">${icon(iconName)}<span class="ca-big-txt"><b>${esc(label)}</b><small>${esc(note)}</small></span></button>`;
    const left = Number(c.installmentsPending);
    const partHint = 'the organizer paid another part of the payout';
    const closeHint = 'finished: put it away (it can be reopened)';
    // one large button at a time: paying comes first, and a step waiting beside it is a gold tile
    const stepBtn = nextPending ? '' : {
        'payout-part': big('gold-btn', 'data-act="payout-part"', 'plus', 'Record part', `${moneyShort(toCome)} due`, partHint),
        close: big('gold-btn', 'data-act="close"', 'lock', 'Close chit', left ? `${left} still unpaid` : 'Nothing left to pay', closeHint),
        payout: big('gold-btn', 'data-act="payout"', 'gift', 'Record payout', `${moneyShort(c.maturityAmount)} expected`, 'The prize or maturity amount you received'),
    }[stepShown] || '';
    const stepTile = !nextPending ? '' : {
        'payout-part': tile('payout-part', 'plus', 'Record part', `Record part, ${moneyShort(toCome)} due`, partHint, { cls: 'is-step' }),
        close: tile('close', 'lock', 'Close chit', 'Close chit', closeHint, { cls: 'is-step' }),
    }[stepShown] || '';
    const payBtn = !nextPending ? '' : `<span class="ca-pay">${big('primary', `data-pay="${nextPending.id}"`, 'check', `Pay #${nextPending.installmentNo}`,
            `${money(nextPending.dueAmount)} · ${nextPending.overdue ? dueText(nextPending.dueDate, true) : `due ${shortDate(nextPending.dueDate)}`}`, `Record installment ${nextPending.installmentNo}`)}${c.organizerUpi
            ? `<button type="button" class="btn primary icon ca-big-side" data-upi="${nextPending.id}" title="Pay #${nextPending.installmentNo} by UPI QR" aria-label="Pay by UPI QR">${icon('qr')}</button>` : ''}</span>`;
    const nextUp = closed ? big('primary', 'data-act="reopen"', 'refresh', 'Reopen', 'To pay, undo or edit', 'Open the chit again to pay, undo or edit') : `${stepBtn}${payBtn}`;
    // the groups that are always there come last: the tiles are right-aligned, so they keep their place from chit to chit
    const tools = [
        ['Payout', 'gold', [
            stepTile,
            !closed && !paidOut && !stepShown && tile('payout', 'gift', 'Payout', 'Record the payout', 'the prize or maturity amount you received'),
            !closed && paidOut && tile('undo-payout', 'undo', 'Undo', 'Undo payout', 'takes the payout out of the books'),
        ]],
        ['With the organizer', 'aqua', [
            anyPaid && tile('ack', 'shield', 'Acknowledge', 'Acknowledge payments', 'ask the organizer to sign for what you paid', { extra: '<i class="ca-tile-badge" data-ack-count hidden></i>' }),
            payoutReady && tile('payout-ack', 'receipt', 'Receipt', 'Payout receipt', 'the organizer confirms the payout; earlier acknowledgements are cancelled'),
        ]],
        ['This chit', 'sky', [
            tile('edit', 'edit', 'Edit', 'Edit', 'its terms, organizer and accounts'),
            tile('share', 'share', 'Share', 'Share chit', 'a link that expires: what is paid, what is left, the payout and when'),
            tile('copy', 'copy', 'Copy', 'Copy chit', 'a new chit with these terms and chit table: change what differs'),
        ]],
        ['Delete', 'red', [!closed && tile('delete', 'trash', 'Delete', 'Delete chit')]],
    ].map(([label, tone, group]) => [label, tone, group.filter(Boolean)]).filter(([, , group]) => group.length);
    const toolTray = `<div class="ca-tools" role="toolbar" aria-label="Chit actions">${tools.map(([label, tone, group]) => `<div class="ca-tool-group ca-tone-${tone}" role="group" aria-label="${esc(label)}">${group.join('')}</div>`).join('')}</div>`;
    const actions = !manage ? '' : `${nextUp ? `<div class="ca-next">${nextUp}</div>` : ''}${toolTray}`;
    const gain = paidOut ? Number(c.realizedGain) : Number(c.projectedNetGain);

    target.innerHTML = `
        <section class="panel p-chit-head">
            <div class="chit-banner">
                <span class="hero-icon">${icon('chit-book')}</span>
                <div class="ab-id">
                    <div class="ab-name">${esc(c.name)} ${statusBadge(c.status)}${closed && c.closedAt ? `<span class="ab-closed">${icon('lock')}closed ${date(c.closedAt.slice(0, 10))}</span>` : ''}</div>
                    <div class="ab-meta">${[c.organizer, c.ticketNo ? 'Ticket ' + c.ticketNo : '', `${c.numberOfInstallments} × ${money(c.monthlyInstallment)}`]
                        .filter(Boolean).map(esc).join('<i>·</i>')}</div>
                    ${chitProgress(c, installments, total, upcoming)}
                </div>
                <div class="ab-bal">
                    <small>${!paidOut ? 'You receive' : toCome ? 'Received so far' : 'Received'}</small>
                    <b>${money(paidOut ? c.payoutReceived : c.maturityAmount)}</b>
                    <span class="ab-change">${!paidOut ? `${date(c.maturityDate)}${c.daysToMaturity >= 0 ? ` · in ${c.daysToMaturity} days` : ''}`
                        : toCome ? `of ${money(c.payoutAmount)} · <b class="ab-due">${money(toCome)} to come</b>` : date(c.payoutDate)}</span>
                    ${toCome ? `<i class="payout-meter" title="${percent(Number(c.payoutReceived) / Number(c.payoutAmount) * 100, 0)} of the payout received"><em style="width:${Number(c.payoutReceived) / Number(c.payoutAmount) * 100}%"></em></i>` : ''}
                </div>
                <div class="ab-actions chit-actions ca-grouped">${actions}</div>
            </div>
            <div class="chit-key">
                ${keyTile('arrow-up', 'Paid in', money(c.paidIn), `${c.installmentsPaid} of ${c.numberOfInstallments} installments`,
                    `<i class="ck-bar"><em style="width:${(Number(c.paidIn) / total) * 100}%"></em></i>`)}
                ${keyTile(Number(c.overdueAmount) ? 'alert' : 'hourglass', 'Still to pay', money(c.stillToPay),
                    Number(c.overdueAmount) ? `<span class="neg">${money(c.overdueAmount)} overdue</span>` : `${c.installmentsPending} left${c.nextDueDate ? ` · next ${shortDate(c.nextDueDate)}` : ''}`,
                    `<i class="ck-bar todo"><em style="width:${(Number(c.stillToPay) / total) * 100}%"></em></i>`, Number(c.overdueAmount) ? 'alert' : '')}
                ${liftNow ? keyTile('hand', 'Take home now', `<span class="gold-ink">${money(liftNow.prize)}</span>`,
                        `paid ${moneyShort(liftNow.paidIn)} + interest ${moneyShort(liftNow.interest)}`, '', 'gold',
                        `Installments paid ${money(liftNow.paidIn)} + interest earned so far ${money(liftNow.interest)}. Waiting to maturity adds ${money(liftNow.waitGain)} after the remaining ${money(liftNow.duesAfter)} is paid.`)
                    : keyTile('sparkles', paidOut ? 'Realised gain' : 'Interest so far', `<span class="pos">${money(Math.round(paidOut ? gain : c.compoundInterestEarned))}</span>`,
                        paidOut ? 'payout + dividends − paid' : `simple ${moneyShort(c.simpleInterestEarned)}`)}
                ${keyTile('gift', paidOut ? 'Received' : 'Net gain at maturity', `<span class="${gain >= 0 ? 'pos' : 'neg'}">${money(Math.round(gain))}</span>`,
                    paidOut ? `on ${date(c.payoutDate)}` : `${liftNow ? `+${moneyShort(liftNow.waitGain)} vs lifting now` : 'maturity − paid + dividends'}`)}
            </div>
            <div class="chit-statline">
                <span title="Interest earned so far at the chit's rate (compound / simple)">${icon('trending')}Interest so far <b class="pos">${money(Math.round(c.compoundInterestEarned))}</b></span>
                <span title="Effective annual return: compound / simple equivalent">${icon('percent')}Return <b>${percent(chitReturns(c).compound, 1)}</b><small>C</small> <b>${percent(chitReturns(c).simple, 1)}</b><small>S</small></span>
                ${dividendFacts(c, installments)}
                <span title="The same installments in a 7% fixed deposit">${icon('scale')}vs 7% FD <b class="${chitReturns(c).vsFd >= 0 ? 'pos' : 'neg'}">${chitReturns(c).vsFd >= 0 ? '+' : '−'}${moneyShort(Math.abs(chitReturns(c).vsFd))}</b></span>
                <span title="Cash actually paid after dividends">${icon('cash')}Cash paid <b>${moneyShort(c.cashPaid)}</b></span>
            </div>
        </section>
        ${panel({
            title: 'Chit passbook', iconName: 'calendar', cls: 'p-chit-tabs', bodyClass: 'flush',
            actions: `${exportButton({ label: '' })}<div class="tabs sm" id="chit-tabs">
                <button class="tab ${view.tab === 'installments' ? 'active' : ''}" data-tab="installments">${icon('list')}Installments</button>
                <button class="tab ${view.tab === 'receipts' ? 'active' : ''}" data-tab="receipts">${icon('shield')}Acknowledgements<span class="count warn" data-ack-count hidden></span></button>
                <button class="tab ${view.tab === 'interest' ? 'active' : ''}" data-tab="interest">${icon('trending')}Interest by month</button>
                ${canLift ? `<button class="tab ${view.tab === 'lift' ? 'active' : ''}" data-tab="lift">${icon('scale')}Lift or hold</button>` : ''}
                ${paidOut ? `<button class="tab ${view.tab === 'payout' ? 'active' : ''}" data-tab="payout">${icon('gift')}Payout${toCome ? `<span class="count warn">${payoutReceipts.length}</span>` : ''}</button>` : ''}
                <button class="tab ${view.tab === 'details' ? 'active' : ''}" data-tab="details">${icon('info')}Details</button></div>`,
            body: '<div class="scroll chit-tab-body" id="chit-tab-body"></div>',
        })}`;

    const tabBody = target.querySelector('#chit-tab-body');
    const yardsticks = () => ({ ...YARDSTICKS, ...getPref('chitInsight', {}), today: isoDate() });
    const drawTab = () => {
        if (view.tab === 'lift') {
            const y = yardsticks();
            const ins = chitInsights(c, installments, terms, y);
            tabBody.innerHTML = liftTabHtml(c, installments, ins, y, manage && !closed);
            drawLiftTabCharts(tabBody, c, installments, ins, y);
            return;
        }
        tabBody.innerHTML = view.tab === 'installments' ? installmentsHtml(installments, manage, Boolean(c.organizerUpi), ackByInstallment(acks, installments))
            : view.tab === 'receipts' ? receiptsTabHtml(acks, manage, { payoutReady, payoutDone: acks.some(a => a.kind === 'PAYOUT' && isFinal(a)) })
            : view.tab === 'interest' ? interestHtml(c, interestSchedule, canLift ? terms : undefined)
            : view.tab === 'payout' ? payoutHtml(c, payoutReceipts, manage && !closed) : detailsHtml(c, installments, interestSchedule);
    };
    drawTab();
    if (canLift) api.get('/chits/lift-terms').then(list => {
        terms = list.find(t => t.chitId === c.id) || null;
        if (view.tab === 'lift' || view.tab === 'interest') drawTab();
    }).catch(() => { /* estimated from the chit's own rate */ });
    // the yardsticks: kept for every chit, the tab redrawn as they change
    tabBody.addEventListener('change', e => {
        const input = e.target.closest('[data-ci]');
        if (!input || input.value === '' || !Number.isFinite(Number(input.value))) return;
        setPref('chitInsight', { ...getPref('chitInsight', {}), [input.dataset.ci]: Number(input.value) });
        drawTab();
    });
    // the views of Lift or hold (overview, month by month, odds & risk, dividends & returns), remembered
    tabBody.addEventListener('click', e => {
        const v = e.target.closest('[data-ci-view]');
        if (!v) return;
        e.stopPropagation();
        setPref('chitInsight', { ...getPref('chitInsight', {}), view: v.dataset.ciView });
        setQuery({ view: v.dataset.ciView });
        drawTab();
    });
    const loadAcks = () => api.get(`/chits/${c.id}/receipts`).then(list => {
        acks = list;
        const waiting = acks.filter(a => a.status === 'PENDING' || a.status === 'DISPUTED').length;
        target.querySelectorAll('[data-ack-count]').forEach(badge => { badge.hidden = !waiting; badge.textContent = waiting; });
        drawTab();
    }).catch(() => { /* the passbook works without them */ });
    loadAcks();
    const ctx = { chit: c, installments, payoutReceipts, get acks() { return acks; }, reload: () => loadAcks(), redraw: () => drawTab() };
    const showReceipts = () => { view.tab = 'receipts'; showRoute(`#/chits/${c.id}/receipts`); target.querySelectorAll('#chit-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'receipts')); return loadAcks(); };
    bindExport(target.querySelector('.p-chit-tabs'), () => ({
        title: `${c.name} · chit passbook`, subtitle: [c.organizer, c.ticketNo ? `Ticket ${c.ticketNo}` : '', `${c.numberOfInstallments} × ${money(c.monthlyInstallment)}`].filter(Boolean).join(' · '),
        filename: `chit-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        summary: [['Paid in', Number(c.paidIn)], ['Still to pay', Number(c.stillToPay)], ['Dividends', Number(c.dividendsEarned)],
            ['Interest so far', Math.round(Number(c.compoundInterestEarned))], [paidOut ? 'Received' : 'Maturity amount', Number(paidOut ? c.payoutAmount : c.maturityAmount)],
            ['Net gain', Math.round(gain)]],
        sheets: [
            { name: 'Installments', columns: [{ label: '#', type: 'number' }, { label: 'Due', type: 'date' }, { label: 'Installment', type: 'money' }, { label: 'Dividend', type: 'money' },
                { label: 'Cash paid', type: 'money' }, { label: 'Paid on', type: 'date' }, { label: 'From' }, { label: 'Status' }],
              rows: installments.map(i => [i.installmentNo, i.dueDate, Number(i.dueAmount), i.dividend !== null ? Number(i.dividend) : '', i.paidAmount !== null ? Number(i.paidAmount) : '',
                  i.paidDate || '', i.paidFromAccountName || '', i.status === 'PAID' ? 'Paid' : i.overdue ? 'Overdue' : 'Pending']),
              totals: ['Total', '', installments.reduce((s, i) => s + Number(i.dueAmount), 0), Number(c.dividendsEarned), Number(c.cashPaid), '', '', ''] },
            { name: 'Interest by month', columns: [{ label: '#', type: 'number' }, { label: 'Interest on', type: 'date' }, { label: 'Installment', type: 'money' },
                { label: 'Balance', type: 'money' }, { label: 'Compound interest', type: 'money' }, { label: 'Total compound', type: 'money' }, { label: 'Simple interest', type: 'money' },
                { label: 'Total simple', type: 'money' }, { label: 'Status' }],
              rows: interestSchedule.map(x => [x.period, x.interestDate, Number(x.installment), Number(x.openingBalance), Number(x.compoundInterest), Number(x.cumulativeCompound),
                  Number(x.simpleInterest), Number(x.cumulativeSimple), INTEREST_STATUS[x.status]?.[2] || x.status]) },
        ],
    }));

    target.addEventListener('click', async e => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
            view.tab = tab.dataset.tab;
            showRoute(`#/chits/${c.id}/${view.tab}`);
            target.querySelectorAll('#chit-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
            drawTab();
            return;
        }
        if (await handleReceiptClick(e, ctx)) return;
        const filter = e.target.closest('[data-interest-filter]');
        if (filter) { view.interestFilter = filter.dataset.interestFilter; setQuery({ interest: view.interestFilter === 'all' ? null : view.interestFilter }); drawTab(); return; }
        const entryRow = e.target.closest('tr[data-entry]');
        const btn = e.target.closest('button');
        if (entryRow && !btn) { toggleEntryRow(entryRow, null, { onChanged: reload }); return; }
        if (!btn) return;
        try {
            if (btn.dataset.ack) openReceiptSend(c, installments, acks, [Number(btn.dataset.ack)], loadAcks);
            else if (btn.dataset.act === 'share') openChitShareDialog(c);
            else if (btn.dataset.act === 'ack') openReceiptSend(c, installments, acks, [], showReceipts);
            else if (btn.dataset.act === 'payout-ack') openPayoutSend({ chit: c, installments, payoutReceipts, acks }, showReceipts);
            else if (btn.dataset.pay) openPayForm(c, installments.find(i => i.id === Number(btn.dataset.pay)), reload);
            else if (btn.dataset.upi) {
                const inst = installments.find(i => i.id === Number(btn.dataset.upi));
                openUpiDialog(c, inst, { onRecord: () => openPayForm(c, inst, reload) });
            }
            else if (btn.dataset.undo) {
                if (await confirmDialog('Undo this installment payment? Its journal entry will be deleted.')) {
                    await api.post(`/chits/${c.id}/installments/${btn.dataset.undo}/undo`);
                    toast('Installment payment undone');
                    reload();
                }
            } else if (btn.dataset.act === 'payout') openPayoutForm(c, reload);
            else if (btn.dataset.act === 'payout-part') openPayoutPartForm(c, payoutReceipts, () => { view.tab = 'payout'; reload(); });
            else if (btn.dataset.undoPart) {
                const part = payoutReceipts.find(p => p.entryId === Number(btn.dataset.undoPart));
                if (part && await confirmDialog(`Undo the part of ${money(part.amount)} received on ${date(part.date)} (${part.entryNo})? It goes back to what the organizer still owes you.`)) {
                    await api.post(`/chits/${c.id}/payout/receipts/${part.entryId}/undo`);
                    toast(`${part.entryNo} undone`);
                    reload();
                }
            }
            else if (btn.dataset.act === 'undo-payout') {
                if (await confirmDialog(payoutReceipts.length > 1
                    ? `Undo the payout? All ${payoutReceipts.length} parts received (${money(c.payoutReceived)}) are deleted and the chit becomes active again.`
                    : 'Undo the payout? The payout journal will be deleted and the chit becomes active again.')) {
                    await api.post(`/chits/${c.id}/payout/undo`);
                    toast('Payout undone');
                    reload();
                }
            } else if (btn.dataset.act === 'close') {
                const left = Number(c.installmentsPending);
                if (await confirmDialog(`Close "${c.name}"? It moves to Closed and payments are locked; you can reopen it any time.`
                    + (left ? ` ${left} installment${left === 1 ? ' is' : 's are'} still unpaid (${money(c.stillToPay)}) and stay in your dues.` : ''),
                    { title: 'Close chit', confirmLabel: 'Close chit', danger: false })) {
                    await api.post(`/chits/${c.id}/close`);
                    toast(`${c.name} closed`);
                    reload();
                }
            } else if (btn.dataset.act === 'reopen') {
                await api.post(`/chits/${c.id}/reopen`);
                toast(`${c.name} reopened`);
                reload();
            } else if (btn.dataset.act === 'edit') openChitForm(c, reload);
            else if (btn.dataset.act === 'copy') openChitForm(null, saved => { view.selectedId = saved.chit.id; reload(); }, { copyFrom: c });
            else if (btn.dataset.act === 'chit-table') {
                const lt = openModal({ title: `Chit table · ${c.name}`, sub: `${c.numberOfInstallments} months · ${moneyShort(c.maturityAmount)}`, iconName: 'list', size: 'xl lift-table-modal',
                    body: '<div data-lt-host></div>', actions: [{ label: 'Close' }] });
                mountLiftTable(lt.el.querySelector('[data-lt-host]'), c, { installments }, {
                    terms, others: [], prefs: yardsticks(),
                    onSaved: out => { terms = out[0] || null; lt.close(); toast('Chit table saved'); drawTab(); },
                });
            }
            else if (btn.dataset.act === 'delete') {
                if (await confirmDialog(`Delete chit "${c.name}" and its schedule?`)) {
                    await api.del(`/chits/${c.id}`);
                    view.selectedId = null;
                    toast('Chit deleted');
                    reload();
                }
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

/** A key figure of the selected chit: label, value, a short note and an optional bar. */
function keyTile(iconName, label, value, note, extra = '', cls = '', title = '') {
    return `<div class="ck-tile ${cls}" ${title ? `title="${esc(title)}"` : ''}><span class="ck-icon">${icon(iconName)}</span>
        <div class="min-0 grow"><small>${esc(label)}</small><div class="ck-line"><b>${value}</b><span class="ck-note">${note}</span></div>${extra}</div></div>`;
}

function tile(iconName, label, value, note, cls = '') {
    return `<div class="metric ${cls}"><span class="metric-icon">${icon(iconName)}</span>
        <div class="min-0"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="note">${note}</div></div></div>`;
}

function dueText(iso, plain = false) {
    const days = daysFromToday(iso);
    if (days < 0) return plain ? `${-days}d overdue` : `<b class="neg">${-days} days overdue</b>`;
    return days === 0 ? 'due today' : `in ${days} days`;
}

// ===================================================================== tabs

function installmentsHtml(installments, manage, upi, acked = new Map()) {
    const next = installments.find(i => i.status !== 'PAID');
    const payable = i => i.status !== 'PAID' && (i.overdue || i === next);
    const state = i => i.status === 'PAID' ? ['good', 'check-circle', 'Paid'] : i.overdue ? ['critical', 'alert', 'Overdue'] : i === next ? ['warning', 'clock', 'Next'] : ['gray', 'calendar', 'Upcoming'];
    // a chit without dividends (fixed or not yet auctioned) pays the installment as it is: one amount column then
    const withDividends = installments.some(i => Number(i.dividend) > 0);
    return `<table class="grid compact dense chit-inst ${withDividends ? '' : 'no-dividends'}">
        <thead><tr><th>#</th><th>Due</th><th class="r">Installment</th>${withDividends ? '<th class="r">Dividend</th><th class="r">Cash paid</th>' : ''}<th>Paid</th><th></th></tr></thead>
        <tbody>${installments.map(i => {
            const [tone, ico, label] = state(i);
            return `
            <tr class="${i.overdue ? 'overdue' : ''} ${i.status === 'PAID' ? 'clickable' : payable(i) ? 'due-row' : 'future-row'}" ${i.journalEntryId ? `data-entry="${i.journalEntryId}"` : ''}>
                <td><span class="inst-no ${tone}" title="${label}">${i.installmentNo}</span></td>
                <td>${date(i.dueDate)}</td>
                <td class="r">${i.paidAmount !== null && !withDividends ? `<b>${money(i.paidAmount)}</b>` : money(i.dueAmount)}</td>
                ${withDividends ? `<td class="r">${Number(i.dividend) ? `<span class="pos">${money(i.dividend)}</span>` : '<span class="muted">—</span>'}</td>
                <td class="r">${i.paidAmount !== null ? `<b>${money(i.paidAmount)}</b>` : ''}</td>` : ''}
                <td>${i.paidDate ? `<span class="paid-on" title="From ${esc(i.paidFromAccountName || '')}">${icon(ico)}${shortDate(i.paidDate)}<small>${esc(i.paidFromAccountName || '')}</small></span>${ackBadge(acked.get(i.id))}`
                    : `<span class="badge ${tone}">${icon(ico)}${label}</span>`}</td>
                <td class="r">${!manage ? '' : i.status === 'PAID'
                    ? `${isFinal(acked.get(i.id)) ? '' : `<button class="btn sm ghost icon" data-ack="${i.id}" title="Ask the organizer to acknowledge this payment">${icon('shield')}</button>`}${isFinal(acked.get(i.id))
                        ? `<span class="muted" title="Acknowledged by the organizer: it cannot be undone">${icon('lock')}</span>`
                        : `<button class="btn sm ghost icon" data-undo="${i.id}" title="Undo payment">${icon('undo')}</button>`}`
                    : payable(i) ? `${upi ? `<button class="btn sm ghost icon" data-upi="${i.id}" title="Pay by UPI QR">${icon('qr')}</button>` : ''}<button class="btn sm ${i.overdue ? 'primary' : ''}" data-pay="${i.id}">${icon('check')}Pay</button>`
                    : `<button class="btn sm ghost icon quiet" data-pay="${i.id}" title="Pay in advance">${icon('check')}</button>`}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

/**
 * The payout as it came in: agreed, received and still to come, then each part with its entry, the account it went
 * into and an undo (the first part is the payout itself: Undo payout takes it out).
 */
function payoutHtml(c, parts, manage) {
    const agreed = Number(c.payoutAmount), received = Number(c.payoutReceived), toCome = Number(c.payoutPending || 0);
    return `
    <div class="payout-tab">
        <div class="payout-sum">
            <div><small>Payout</small><b>${money(agreed)}</b><span class="muted">${date(c.payoutDate)}</span></div>
            <div><small>Received</small><b class="pos">${money(received)}</b><span class="muted">${parts.length} part${parts.length === 1 ? '' : 's'}</span></div>
            <div class="${toCome ? 'due' : ''}"><small>Still to come</small><b class="${toCome ? 'gold-ink' : 'muted'}">${toCome ? money(toCome) : 'Nothing'}</b>
                <span class="muted">${toCome ? 'owed by the organizer' : 'received in full'}</span></div>
            ${manage && toCome ? `<button class="btn sm gold-btn" data-act="payout-part">${icon('plus')}Record part</button>` : ''}
        </div>
        <i class="payout-meter wide"><em style="width:${agreed ? (received / agreed) * 100 : 0}%"></em></i>
        <table class="grid compact dense payout-parts">
            <thead><tr><th>#</th><th>Received on</th><th>Into</th><th>Note</th><th class="r">Amount</th><th></th></tr></thead>
            <tbody>${parts.map((p, i) => `
                <tr class="clickable" data-entry="${p.entryId}">
                    <td><span class="inst-no good">${i + 1}</span></td>
                    <td>${date(p.date)} <span class="muted small">${esc(p.entryNo)}</span></td>
                    <td>${esc(p.accountName || '—')}</td>
                    <td class="muted small">${p.first ? 'Payout recorded' : esc(p.notes || '')}</td>
                    <td class="r"><b class="mono">${money(p.amount)}</b></td>
                    <td class="r">${manage && !p.first ? `<button class="btn sm ghost icon" data-undo-part="${p.entryId}" title="Undo this part">${icon('undo')}</button>` : ''}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr class="total"><td colspan="4">Received</td><td class="r"><b class="mono">${money(received)}</b></td><td></td></tr></tfoot>
        </table>
    </div>`;
}

const INTEREST_STATUS = {
    EARNED: ['good', 'check-circle', 'Earned'],
    ACCRUING: ['warning', 'hourglass', 'Accruing'],
    PROJECTED: ['gray', 'clock', 'Projected'],
    AFTER_PAYOUT: ['aqua', 'gift', 'After payout'],
};

/**
 * Interest by month. With the chit's lift terms (terms !== undefined: a chit that can still be lifted) each month also
 * shows what lifting it then pays, and how far that falls short of the maturity amount.
 */
function interestHtml(c, rows, terms) {
    const earned = rows.filter(r => r.status === 'EARNED');
    const withLift = terms !== undefined;
    const lifted = r => {
        if (r.period >= c.numberOfInstallments) return '<td class="r muted">—</td>';
        const p = payoutFor(c, terms, r.period, c.maturityDate, r.installmentDate);
        const cut = Number(c.maturityAmount) - p.payout;
        return `<td class="r col-lift" title="Lifting in month ${r.period} pays ${money(Math.round(p.payout))}${p.estimated ? ' (estimated: fill in the chit table)' : ''}: ${money(Math.round(cut))} less than the ${money(c.maturityAmount)} at maturity, and the installments after it are still paid">
            ${p.estimated ? '<span class="muted">~</span>' : ''}${moneyShort(p.payout)}<small class="neg">−${moneyShort(cut)} · ${percent(cut / Number(c.maturityAmount) * 100, 0)}</small></td>`;
    };
    const last = rows[rows.length - 1];
    const visible = rows.filter(r => view.interestFilter === 'all'
        || (view.interestFilter === 'earned' ? r.status === 'EARNED' : r.status !== 'EARNED'));
    let dividerShown = false;
    const body = visible.map(r => {
        let divider = '';
        if (!dividerShown && r.status !== 'EARNED' && view.interestFilter === 'all' && earned.length) {
            dividerShown = true;
            divider = `<tr class="today-divider"><td colspan="${withLift ? 13 : 12}"><span>${icon('flag')} Today · ${date(isoDate())} — earned so far
                <b>${money(c.compoundInterestEarned)}</b> compound, <b>${money(c.simpleInterestEarned)}</b> simple</span></td></tr>`;
        }
        const [tone, ico, label] = INTEREST_STATUS[r.status];
        return `${divider}<tr class="interest-row ${r.status.toLowerCase()}">
            <td><b>${r.period}</b></td>
            <td>${date(r.installmentDate)}${r.installmentPaid ? '' : ' <span class="tiny muted">due</span>'}</td>
            <td>${date(r.interestDate)}</td>
            <td class="r">${money(r.installment)}</td>
            <td class="r">${money(r.openingBalance)}</td>
            <td class="r strong pos">${money(r.compoundInterest, { decimals: 2 })}</td>
            <td class="r">${money(r.closingBalance)}</td>
            <td class="r">${money(r.cumulativeCompound)}</td>
            <td class="r col-simple">${money(r.simpleInterest, { decimals: 2 })}</td>
            <td class="r col-simple">${money(r.cumulativeSimple)}</td>
            <td class="r ${Number(r.compoundAdvantage) > 0 ? 'pos' : 'muted'}">${Number(r.compoundAdvantage) ? '+' + money(r.compoundAdvantage) : '—'}</td>
            ${withLift ? lifted(r) : ''}
            <td><span class="badge ${tone}">${icon(ico)}${label}</span></td>
        </tr>`;
    }).join('');

    return `
    <div class="interest-summary">
        <div class="is-chip"><span>Rate used</span><b>${percent(c.rateUsed, 2)} p.a.</b><small>${esc(c.rateBasis)} · ${percent(Number(c.rateUsed) / 12, 3)} / month</small></div>
        <div class="is-chip compound"><span>Effective compound</span><b>${percent(chitReturns(c).compound, 2)} p.a.</b><small>IRR of installments vs maturity</small></div>
        <div class="is-chip simple"><span>Simple equivalent</span><b>${percent(chitReturns(c).simple, 2)} p.a.</b><small>same interest, flat on money held</small></div>
        <div class="is-chip"><span>vs 7% FD</span><b class="${chitReturns(c).vsFd >= 0 ? 'pos' : 'neg'}">${chitReturns(c).vsFd >= 0 ? '+' : '−'}${money(Math.round(Math.abs(chitReturns(c).vsFd)))}</b><small>FD would earn ${money(Math.round(chitReturns(c).fdInterest))}</small></div>
        <div class="is-chip compound"><span>Compound earned</span><b>${money(c.compoundInterestEarned, { decimals: 2 })}</b><small>at maturity ${money(c.projectedCompoundInterest)}</small></div>
        <div class="is-chip simple"><span>Simple earned</span><b>${money(c.simpleInterestEarned, { decimals: 2 })}</b><small>at maturity ${money(c.projectedSimpleInterest)}</small></div>
        <div class="is-chip"><span>Compounding adds</span><b class="pos">${money(Number(c.projectedCompoundInterest) - Number(c.projectedSimpleInterest))}</b><small>by maturity</small></div>
        <div class="is-chip"><span>Months earned</span><b>${earned.length} / ${rows.length}</b><small>${rows.length - earned.length} to go</small></div>
        <div class="tabs sm is-filter">
            <button class="tab ${view.interestFilter === 'all' ? 'active' : ''}" data-interest-filter="all">All</button>
            <button class="tab ${view.interestFilter === 'earned' ? 'active' : ''}" data-interest-filter="earned">Earned</button>
            <button class="tab ${view.interestFilter === 'future' ? 'active' : ''}" data-interest-filter="future">Upcoming</button>
        </div>
    </div>
    <p class="formula">${icon('info')} Each installment starts earning on the day it is paid. Exactly one month later the month's interest is
        calculated: <b>compound</b> = balance × monthly rate, then added to the balance before the next installment joins;
        <b>simple</b> = installments paid so far × monthly rate, never added back.</p>
    <table class="grid compact dense interest-table">
        <thead><tr><th>#</th><th>Paid in on</th><th>Interest on</th><th class="r">Installment</th><th class="r">Balance</th>
            <th class="r">Compound int.</th><th class="r">Balance + int.</th><th class="r">Total compound</th>
            <th class="r col-simple">Simple int.</th><th class="r col-simple">Total simple</th><th class="r">Compound edge</th>
            ${withLift ? `<th class="r col-lift" title="What lifting the chit in that month pays, and how much less that is than the maturity amount (Lift or hold weighs it)">If lifted then${hasTerms(terms) ? '' : ' <span class="muted">~</span>'}</th>` : ''}<th>Status</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr class="total"><td colspan="3">At maturity (${date(c.maturityDate)})</td><td class="r">${money(c.totalContribution)}</td><td></td>
            <td class="r pos">${money(c.projectedCompoundInterest)}</td><td class="r">${money(last?.closingBalance)}</td><td></td>
            <td class="r col-simple">${money(c.projectedSimpleInterest)}</td><td></td>
            <td class="r pos">+${money(Number(c.projectedCompoundInterest) - Number(c.projectedSimpleInterest))}</td>${withLift ? `<td class="r col-lift">${moneyShort(c.maturityAmount)}<small>held</small></td>` : ''}<td></td></tr></tfoot>
    </table>`;
}

function detailsHtml(c, installments = [], schedule = []) {
    const item = (label, value, hint = '') => `<div class="kv" ${hint ? `title="${esc(hint)}"` : ''}><span>${esc(label)}</span><b>${value}</b></div>`;
    const total = Number(c.totalContribution) || 1;
    const paid = installments.filter(i => i.status === 'PAID');
    const withDividend = paid.filter(i => Number(i.dividend) > 0);
    const avgDividend = withDividend.length ? withDividend.reduce((s, i) => s + Number(i.dividend), 0) / withDividend.length : 0;
    const best = withDividend.reduce((m, i) => (!m || Number(i.dividend) > Number(m.dividend) ? i : m), null);
    const onTime = paid.filter(i => i.paidDate && i.paidDate <= i.dueDate).length;
    const late = paid.filter(i => i.paidDate && i.paidDate > i.dueDate);
    const commission = c.commissionPercent !== null ? Number(c.commissionPercent) / 100 * Number(c.maturityAmount) : null;
    const returns = chitReturns(c);
    const lift = takeHomeNow(c);
    const monthsLeft = c.payoutAmount === null ? monthsUntil(c.maturityDate) : 0;
    const elapsed = installments.filter(i => i.dueDate <= isoDate()).length;
    const timePct = c.numberOfInstallments ? (elapsed / c.numberOfInstallments) * 100 : 0;
    const dividendYield = Number(c.paidIn) ? (Number(c.dividendsEarned) / Number(c.paidIn)) * 100 : 0;

    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    if (Number(c.overdueAmount)) tip('bad', 'alert', `<b>${money(c.overdueAmount)}</b> is overdue across ${c.overdueCount} installment${c.overdueCount === 1 ? '' : 's'}. Late payments can cost you the dividend and invite penalties.`);
    if (paid.length && !late.length) tip('good', 'check-circle', `Every one of the ${paid.length} installments so far was paid on or before its due date.`);
    else if (late.length) tip('warn', 'clock', `${late.length} installment${late.length === 1 ? ' was' : 's were'} paid late, by ${Math.round(late.reduce((s, i) => s + (new Date(i.paidDate) - new Date(i.dueDate)) / 86400000, 0) / late.length)} days on average.`);
    if (Number(c.dividendsEarned)) tip('good', 'piggy', `Dividends cut what you paid by <b>${money(c.dividendsEarned)}</b> (${percent(dividendYield, 1)} of the installments), about ${money(Math.round(avgDividend))} a month${best ? `; the best was #${best.installmentNo} at ${money(best.dividend)}` : ''}.`);
    tip(returns.vsFd >= 0 ? 'good' : 'warn', 'scale', returns.vsFd >= 0
        ? `At ${percent(returns.compound, 1)} a year this chit beats a 7% fixed deposit by <b>${money(Math.round(returns.vsFd))}</b> over its term.`
        : `A 7% fixed deposit would earn <b>${money(Math.round(-returns.vsFd))}</b> more than this chit over its term.`);
    if (lift) tip('info', 'hand', `Lifting the prize now is worth about <b>${money(lift.prize)}</b>. Waiting ${Math.round(monthsLeft)} more month${Math.round(monthsLeft) === 1 ? '' : 's'} and paying ${money(lift.duesAfter)} more adds <b>${money(lift.waitGain)}</b>.`);
    if (commission) tip('info', 'percent', `The organizer's commission is about <b>${money(Math.round(commission))}</b> (${percent(c.commissionPercent, 1)} of the chit value), already reflected in the maturity amount.`);
    if (timePct > 0 && Math.abs(timePct - (Number(c.paidIn) / total) * 100) > 8) tip('warn', 'activity', `${percent(timePct, 0)} of the term has passed but ${percent((Number(c.paidIn) / total) * 100, 0)} of the contribution is paid.`);

    return `<div class="chit-details rich">
        <section>
            <div class="section-title">${icon('chit')} Chit</div>
            ${item('Organizer / foreman', esc(c.organizer || '—'))}
            ${item('Ticket / group', esc(c.ticketNo || '—'))}
            ${item('Status', statusBadge(c.status))}
            ${item('Pays from', esc(c.defaultPaymentAccountName || '—'))}
            ${item('Organizer mobile', c.organizerPhone ? `<span class="mono">${esc(c.organizerPhone)}</span>` : '—')}
            ${c.organizerEmail ? item('Organizer e-mail', `<span class="mono">${esc(c.organizerEmail)}</span>`) : ''}
            ${item('Organizer UPI', c.organizerUpi ? `<span class="mono">${esc(c.organizerUpi)}</span>` : '—')}
            ${item('Commission', commission ? `${percent(c.commissionPercent, 2)} · ${money(Math.round(commission))}` : '—')}
            ${c.notes ? item('Notes', esc(c.notes)) : ''}
        </section>
        <section>
            <div class="section-title">${icon('calendar')} Timeline</div>
            ${item('Started', date(c.startDate))}
            ${item('Last installment', date(c.endDate))}
            ${item('Maturity', `${date(c.maturityDate)}${c.daysToMaturity >= 0 ? ` · in ${c.daysToMaturity} days` : ''}`)}
            <div class="cd-progress" title="Term passed vs contribution paid">
                <div><small>Term</small><i><em style="width:${Math.min(100, timePct)}%"></em></i><b>${elapsed}/${c.numberOfInstallments}</b></div>
                <div><small>Paid</small><i class="paid"><em style="width:${Math.min(100, (Number(c.paidIn) / total) * 100)}%"></em></i><b>${percent((Number(c.paidIn) / total) * 100, 0)}</b></div>
            </div>
            ${item('Next due', c.nextDueDate ? `${money(c.nextDueAmount)} · ${shortDate(c.nextDueDate)} (${dueText(c.nextDueDate, true)})` : '—')}
            ${item('On-time record', paid.length ? `${onTime} of ${paid.length}` : '—')}
        </section>
        <section>
            <div class="section-title">${icon('cash')} Money</div>
            ${item('Contribution', `${c.numberOfInstallments} × ${money(c.monthlyInstallment)} = ${money(c.totalContribution)}`)}
            ${item('Paid in', money(c.paidIn))}
            ${item('Cash actually paid', money(c.cashPaid), 'Installments less dividends')}
            ${item('Dividends', `${money(c.dividendsEarned)}${withDividend.length ? ` · avg ${money(Math.round(avgDividend))}` : ''}`)}
            ${item('Still to pay', money(c.stillToPay))}
            ${item(c.payoutAmount !== null ? 'Payout' : 'Maturity amount', c.payoutAmount !== null ? `${money(c.payoutAmount)} on ${date(c.payoutDate)}` : money(c.maturityAmount))}
        </section>
        <section>
            <div class="section-title">${icon('trending')} Returns</div>
            ${item('Rate used', `${percent(c.rateUsed, 2)} p.a. · ${esc(c.rateBasis)}`)}
            ${item('Effective (compound)', `${percent(returns.compound, 2)} p.a.`)}
            ${item('Simple equivalent', `${percent(returns.simple, 2)} p.a.`)}
            ${item('Interest so far', `${money(Math.round(c.compoundInterestEarned))} · simple ${money(Math.round(c.simpleInterestEarned))}`)}
            ${item('At maturity', `${money(Math.round(c.projectedCompoundInterest))} interest`)}
            ${item(c.realizedGain !== null ? 'Realised gain' : 'Net gain expected', money(Math.round(c.realizedGain !== null ? c.realizedGain : c.projectedNetGain)))}
        </section>
        <section class="cd-insights">
            <div class="section-title">${icon('bulb')} Insights</div>
            <div class="insights">${tips.join('')}</div>
        </section>
    </div>`;
}

// ===================================================================== forms

async function openPayForm(chit, installment, reload) {
    const accounts = await loadAccounts();
    const defaultBank = chit.defaultPaymentAccountId || accounts.find(a => a.accountType === 'BANK' && a.active)?.id;
    const due = Number(installment.dueAmount);
    const upi = Boolean(chit.organizerUpi);
    let payEvidence = null;
    let mail = null;
    openModal({
        title: `Pay installment ${installment.installmentNo} · ${chit.name}`, iconName: 'chit', size: upi ? 'lg' : '',
        body: `<div class="${upi ? 'pay-layout' : ''}">
            <form class="form-grid two">
                <div class="book-note span-2">${icon('calendar')}<span>Booked on the installment date <b>${date(installment.dueDate)}</b>, the same day its interest starts.</span></div>
                <div class="book-note span-2">${icon('target')}<span>The cash paid counts in the <b>Chit Payments</b> budget for ${new Date(installment.dueDate + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}; in the books it stays savings.</span></div>
                ${field({ label: 'Money actually paid on', name: 'paidDate', type: 'date', value: installment.dueDate, hint: 'For your records only' })}
                ${field({ label: 'Paid from', name: 'fromAccountId', type: 'select', required: true,
                          options: accountOptions(accounts, a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && a.accountType !== 'CHIT_FUND', defaultBank) })}
                ${field({ label: 'Dividend (discount share)', name: 'dividend', type: 'number', value: 0, hint: 'Reduces the cash you pay this month' })}
                <div class="stat"><div class="label">Cash to pay</div><div class="value" data-cash>${money(due)}</div>
                    <div class="note">Installment ${money(due)} · due ${date(installment.dueDate)}</div></div>
                ${field({ label: 'Bank reference', name: 'reference', placeholder: 'UTR, IMPS ref or cheque no.', span: 'span-2', attrs: 'maxlength="60" data-plain autocomplete="off"',
                          hint: chit.organizerEmail ? `Kept on the entry; shown in the organizer's copy (${esc(chit.organizerEmail)})` : 'Kept on the entry' })}
                <div class="span-2">${evidenceFieldHtml({ hint: 'Chit receipt or UPI screenshot' })}</div>
            </form>
            ${upi ? '<div data-upi-card></div>' : ''}
        </div>`,
        onOpen: m => {
            payEvidence = bindEvidenceField(m.el);
            mail = attachNotify(m, { event: 'CHIT_PAYMENT', organizer: chit.organizerEmail || null });
            const drawCash = () => {
                const cash = Math.max(0, due - Number(m.el.querySelector('[name=dividend]').value || 0));
                m.el.querySelector('[data-cash]').textContent = money(cash);
                if (upi) m.el.querySelector('[data-upi-card]').innerHTML = upiCardHtml(chit, installment, { amount: cash, note: upiNote(chit, installment) });
            };
            m.el.querySelector('[name=dividend]').addEventListener('input', drawCash);
            if (upi) bindUpiCopy(m.el);
            drawCash();
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Record payment', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const detail = await api.post(`/chits/${chit.id}/installments/${installment.id}/pay`, readForm(form), { notify: mail?.value() });
                toast(`Installment ${installment.installmentNo} paid · counted under Chit Payments in Budgets`);
                await payEvidence.uploadTo(detail.installments.find(i => i.id === installment.id)?.journalEntryId);
                reload();
            },
        }],
    });
}

async function openPayoutForm(chit, reload) {
    const accounts = await loadAccounts();
    const defaultBank = accounts.find(a => a.accountType === 'BANK' && a.active)?.id;
    let payoutEvidence = null;
    openModal({
        title: `Record payout · ${chit.name}`, iconName: 'gift',
        body: `<form class="form-grid two">
            ${field({ label: 'Received on', name: 'payoutDate', type: 'date', value: isoDate(), required: true })}
            ${field({ label: 'Total payout', name: 'amount', type: 'number', value: chit.maturityAmount, required: true, hint: 'All the organizer pays you' })}
            <label class="switch span-2 payout-parts-toggle" title="The organizer pays the payout in instalments">
                <input type="checkbox" data-in-parts><span></span>Paid in parts: only some of it came in now</label>
            <div class="span-2 payout-now" data-now hidden>
                ${field({ label: 'Received now', name: 'receivedNow', type: 'number', attrs: 'min="0.01" step="any"' })}
                <div class="payout-split" data-split></div>
            </div>
            ${field({ label: 'Deposited into', name: 'depositAccountId', type: 'select', required: true, span: 'span-2',
                      options: accountOptions(accounts, a => a.accountClass === 'ASSET' && a.accountType !== 'CHIT_FUND', defaultBank) })}
        </form>
        <p class="hint" style="margin-top:10px">If installments are still pending (prize taken early), they are recorded as a liability
        you keep paying. The difference between the total payout and your total contribution is booked as
        income under <b>Chit Gains</b> (gain) or an expense under <b>Chit Commission &amp; Discount</b> (loss).
        Paid in parts, the rest stays on the chit as money the organizer owes you until you record each part.</p>
        ${evidenceFieldHtml({ hint: 'Payout voucher, cheque or bank credit' })}`,
        onOpen: m => {
            payoutEvidence = bindEvidenceField(m.el);
            const toggle = m.el.querySelector('[data-in-parts]');
            const now = m.el.querySelector('[data-now]');
            const nowInput = m.el.querySelector('[name=receivedNow]');
            const total = m.el.querySelector('[name=amount]');
            const drawSplit = () => {
                const all = Number(total.value || 0), got = Number(nowInput.value || 0);
                const rest = Math.max(0, all - got);
                m.el.querySelector('[data-split]').innerHTML = got > all
                    ? `<span class="neg">${icon('alert')}More than the total payout</span>`
                    : `<span>${icon('check')}Now <b>${money(got)}</b></span><span>${icon('hourglass')}Still to come <b class="gold-ink">${money(rest)}</b></span>`;
            };
            toggle.addEventListener('change', () => {
                now.hidden = !toggle.checked;
                nowInput.required = toggle.checked;
                nowInput.max = total.value;
                if (toggle.checked && !nowInput.value) nowInput.value = Math.round(Number(total.value || 0) / 2);
                drawSplit();
            });
            total.addEventListener('input', () => { nowInput.max = total.value; drawSplit(); });
            nowInput.addEventListener('input', drawSplit);
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Record payout', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                if (!m.el.querySelector('[data-in-parts]').checked) delete data.receivedNow;
                const detail = await api.post(`/chits/${chit.id}/payout`, data);
                const pending = Number(detail.chit.payoutPending || 0);
                toast(pending ? `Payout recorded · ${money(pending)} still to come from ${chit.organizer || 'the organizer'}` : 'Payout recorded');
                if (pending) view.tab = 'payout';
                await payoutEvidence.uploadTo(detail.chit.payoutEntryId);
                reload();
            },
        }],
    });
}

/** Another part of a payout the organizer pays in instalments: how much, when and into which account. */
async function openPayoutPartForm(chit, parts, reload) {
    const accounts = await loadAccounts();
    const toCome = Number(chit.payoutPending);
    const lastAccount = parts.at(-1)?.accountId;
    let partEvidence = null;
    openModal({
        title: `Payout part ${parts.length + 1} · ${chit.name}`, iconName: 'gift',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><b>Payout ${money(chit.payoutAmount)}</b><span class="spacer"></span>
                <span class="muted">received ${money(chit.payoutReceived)} in ${parts.length} part${parts.length === 1 ? '' : 's'}</span></div>
                <i class="payout-meter wide"><em style="width:${Number(chit.payoutReceived) / Number(chit.payoutAmount) * 100}%"></em></i>
                <div class="small"><b class="gold-ink">${money(toCome)}</b> still to come from ${esc(chit.organizer || 'the organizer')}</div></div>
            <label class="field"><span>Amount received *</span><input name="amount" type="number" step="any" min="0.01" max="${toCome}" value="${toCome}" required data-plain>
                <span class="chips">${[1, 0.5].map(f => `<button type="button" class="date-chip" data-fill="${Math.round(toCome * f * 100) / 100}">${f === 1 ? 'All' : 'Half'} ${moneyShort(toCome * f)}</button>`).join('')}</span></label>
            ${field({ label: 'Received on', name: 'date', type: 'date', value: isoDate(), required: true, attrs: `min="${chit.payoutDate}"` })}
            ${field({ label: 'Deposited into', name: 'depositAccountId', type: 'select', required: true, span: 'span-2',
                      options: accountOptions(accounts, a => a.accountClass === 'ASSET' && a.accountType !== 'CHIT_FUND', lastAccount) })}
            ${field({ label: 'Note', name: 'notes', placeholder: 'e.g. Cheque no. 123456', span: 'span-2' })}
        </form>
        ${evidenceFieldHtml({ hint: 'Cheque, voucher or bank credit' })}`,
        onOpen: m => {
            partEvidence = bindEvidenceField(m.el);
            m.el.querySelector('form').addEventListener('click', ev => {
                const b = ev.target.closest('[data-fill]');
                if (b) m.el.querySelector('[name=amount]').value = b.dataset.fill;
            });
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Record part', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const detail = await api.post(`/chits/${chit.id}/payout/receipts`, readForm(form));
                const pending = Number(detail.chit.payoutPending || 0);
                toast(pending ? `Part recorded · ${money(pending)} still to come` : 'Payout received in full');
                await partEvidence.uploadTo(detail.payoutReceipts.at(-1)?.entryId);
                reload();
            },
        }],
    });
}

/** Effective annual return of paying m for n months and receiving `maturity` one month after the last payment. */
function impliedAnnualRate(m, n, maturity) {
    if (!(m > 0 && n > 0 && maturity > 0)) return null;
    const fv = r => { let v = 0; for (let k = 0; k < n; k++) v = (v + m) * (1 + r); return v; };
    let lo = -0.5, hi = 1;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (fv(mid) > maturity) hi = mid; else lo = mid; }
    return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

/**
 * The chit form: new, edit, or a copy of another chit (copyFrom: its terms and chit table, a new name, starting today).
 * Its fields are as they always were; beside them, optionally, the chit table (what lifting gives and what is paid after,
 * month by month; chit-lift-table.js), filled from a button and saved with the chit. A new chit can also start from any
 * existing one (Start from).
 */
async function openChitForm(chit, onSaved, { copyFrom = null } = {}) {
    const [accounts, allChits, allTerms] = await Promise.all([loadAccounts(), chit ? Promise.resolve([]) : api.get('/chits').catch(() => []),
        api.get('/chits/lift-terms').catch(() => [])]);
    const termsOf = id => allTerms.find(t => t.chitId === id) || null;
    const copyOf = src => ({ ...src, name: `${src.name} (copy)`, ticketNo: '', startDate: isoDate(), endDate: null, notes: src.notes });
    const c = chit || (copyFrom ? copyOf(copyFrom) : { numberOfInstallments: 20, startDate: isoDate(), commissionPercent: 5 });
    // the chit table: what it holds now (undefined: untouched), and the saved one it started from
    const savedTerms = chit ? termsOf(chit.id) : copyFrom ? termsOf(copyFrom.id) : null;
    let table = savedTerms && (savedTerms.liftChart || savedTerms.liftDiscountFirst != null || savedTerms.afterLiftInstallment != null) ? { ...savedTerms } : null;
    let tableTouched = !!copyFrom && !!table;
    let chitMail = null;
    openModal({
        title: chit ? `Edit ${chit.name}` : copyFrom ? `Copy of ${copyFrom.name}` : 'New chit', iconName: copyFrom ? 'copy' : 'chit', size: 'lg chf-modal',
        body: `<div class="chf-layout"><form class="form-grid three" id="chit-form">
            ${!chit && allChits.length ? `<div class="span-3 chf-from">${icon('copy')}<span>Start from an existing chit</span>
                <select data-copy-from><option value="">— a new chit —</option>${allChits.map(x => `<option value="${x.id}" ${copyFrom?.id === x.id ? 'selected' : ''}>${esc(x.name)} · ${moneyShort(x.maturityAmount)} · ${x.numberOfInstallments} months</option>`).join('')}</select>
                <small class="muted">fills the form and the chit table; change anything before saving</small></div>` : ''}
            ${field({ label: 'Chit name', name: 'name', value: c.name, required: true, span: 'span-2' })}
            ${field({ label: 'Ticket / group no.', name: 'ticketNo', value: c.ticketNo })}
            ${field({ label: 'Organizer / foreman', name: 'organizer', value: c.organizer })}
            ${field({ label: 'Organizer mobile', name: 'organizerPhone', type: 'tel', value: c.organizerPhone, placeholder: '10-digit mobile',
                      attrs: 'maxlength="16" inputmode="tel" data-plain', hint: 'To send receipts for acknowledgement' })}
            ${field({ label: 'Organizer e-mail', name: 'organizerEmail', type: 'email', value: c.organizerEmail, placeholder: 'office@chitfund.com',
                      attrs: 'maxlength="120" data-plain autocomplete="off"', hint: 'Gets a copy of each payment (Settings › Alerts)' })}
            ${field({ label: 'Organizer UPI ID', name: 'organizerUpi', value: c.organizerUpi, placeholder: 'name@bank',
                      attrs: 'pattern="[A-Za-z0-9._\\-]{2,}@[A-Za-z0-9.\\-]{2,}" data-plain', hint: 'Shows a QR code to pay installments' })}
            ${field({ label: 'UPI note', name: 'upiNote', value: c.upiNote, attrs: 'maxlength="40" data-plain', placeholder: 'Auto: chit name + ticket',
                      hint: 'Installment no. is always added' })}
            ${field({ label: 'Maturity value', name: 'maturityAmount', type: 'number', value: c.maturityAmount, required: true, hint: 'What you receive at the end' })}
            ${field({ label: 'Monthly installment', name: 'monthlyInstallment', type: 'number', value: c.monthlyInstallment, required: true })}
            ${field({ label: 'No. of installments', name: 'numberOfInstallments', type: 'number', value: c.numberOfInstallments, required: true })}
            ${field({ label: 'First installment on', name: 'startDate', type: 'date', value: c.startDate, required: true })}
            ${field({ label: 'Last installment on', name: 'endDate', type: 'date', value: c.endDate, hint: 'Empty = start + installments' })}
            ${chit ? '' : field({ label: 'Already paid installments', name: 'alreadyPaidInstallments', type: 'number', value: 0, hint: 'Paid before you started tracking' })}
            ${field({ label: 'Pay installments from', name: 'defaultPaymentAccountId', type: 'select', span: chit ? 'span-2' : '',
                      options: accountOptions(accounts, a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && !['CHIT_FUND', 'RECEIVABLE', 'LOAN_GIVEN'].includes(a.accountType),
                          c.defaultPaymentAccountId, 'No default'), hint: 'Pre-selected when you pay' })}
            ${field({ label: 'Notes', name: 'notes', value: c.notes, span: chit ? '' : 'span-2' })}
            <div class="span-3 disclosure" data-advanced>
                <button type="button" class="disclosure-btn" data-toggle-advanced>${icon('percent')}<b>Commission &amp; interest rate</b>
                    <span class="muted" data-advanced-summary></span>${icon('chevron-down')}</button>
                <div class="disclosure-body form-grid two">
                    ${field({ label: 'Commission %', name: 'commissionPercent', type: 'number', value: c.commissionPercent, hint: 'Foreman commission, % of maturity value' })}
                    ${field({ label: 'Interest rate % p.a.', name: 'interestRate', type: 'number', value: c.interestRate, hint: 'Empty = rate implied by maturity' })}
                </div>
            </div>
            <div class="span-3 stat-strip" style="grid-template-columns:repeat(4,1fr)" id="chit-preview"></div>
            <div class="span-3 chf-table" data-chf-table></div>
        </form>
        <aside class="chf-side" data-chf-side hidden><div data-lt-host></div></aside></div>`,
        onOpen: m => {
            const form = m.el.querySelector('#chit-form');
            if (!chit) chitMail = attachNotify(m, { event: 'CHIT_CREATED' });
            const preview = () => {
                const d = readForm(form);
                const n = d.numberOfInstallments || 0;
                const monthly = d.monthlyInstallment || 0;
                const maturity = d.maturityAmount || 0;
                const total = monthly * n;
                const rate = impliedAnnualRate(monthly, n, maturity);
                let end = '—';
                if (d.startDate && n) {
                    const s = new Date(d.startDate + 'T00:00:00');
                    end = date(isoDate(new Date(s.getFullYear(), s.getMonth() + n, s.getDate())));
                }
                const box = (label, value, note = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`;
                form.querySelector('[data-advanced-summary]').textContent =
                    `· ${d.commissionPercent ? percent(d.commissionPercent, 2).replace('.00', '') + ' commission' : 'no commission'} · ${d.interestRate !== null ? percent(d.interestRate, 2).replace('.00', '') + ' p.a.' : 'rate from maturity'}`;
                form.querySelector('#chit-preview').innerHTML =
                    box('Total contribution', money(total), `${n} × ${money(monthly)}`) +
                    box('Projected interest', money(maturity - total)) +
                    box('Implied return', rate === null ? '—' : percent(rate, 2) + ' p.a.', d.interestRate ? `Schedule uses ${percent(d.interestRate, 2)}` : 'Used for the interest schedule') +
                    box('Matures on', end, 'One month after the last installment');
                drawTableRow();
            };
            /** The chit as the form describes it, with its installments, for the chit table (an edited chit uses its real ones). */
            const draft = async () => {
                const d = readForm(form);
                const n = Math.max(2, Math.min(600, Number(d.numberOfInstallments) || 0));
                const monthly = Number(d.monthlyInstallment) || 0, M = Number(d.maturityAmount) || 0;
                const start = new Date((d.startDate || isoDate()) + 'T00:00:00');
                const at = k => isoDate(new Date(start.getFullYear(), start.getMonth() + k, start.getDate()));
                if (chit) {
                    const detail = await api.get(`/chits/${chit.id}`);
                    return { c: { ...detail.chit, maturityAmount: M || detail.chit.maturityAmount, monthlyInstallment: monthly || detail.chit.monthlyInstallment }, d: detail };
                }
                const paid = Math.min(n, Number(d.alreadyPaidInstallments) || 0);
                const installments = Array.from({ length: n }, (_, k) => ({ installmentNo: k + 1, dueDate: at(k), dueAmount: monthly, dividend: k < paid ? 0 : null,
                    paidAmount: k < paid ? monthly : null, paidDate: k < paid ? at(k) : null, status: k < paid ? 'PAID' : 'PENDING' }));
                const rate = impliedAnnualRate(monthly, n, M) ?? 8;
                return { c: { id: 0, name: d.name || 'New chit', organizer: d.organizer, maturityAmount: M, monthlyInstallment: monthly, numberOfInstallments: n,
                    installmentsPaid: paid, installmentsPending: n - paid, dividendsEarned: 0, rateUsed: d.interestRate ?? rate, impliedAnnualRate: rate,
                    commissionPercent: d.commissionPercent, maturityDate: at(n), status: 'ACTIVE', payoutAmount: null }, d: { installments } };
            };
            // the chit table opens beside the form, in the same dialog widened to the window; every change is kept live
            const side = m.el.querySelector('[data-chf-side]');
            let open = false;
            /** The chit table's row in the form: what it holds, and the buttons to open, hide or remove it. */
            const drawTableRow = () => {
                const box = form.querySelector('[data-chf-table]');
                const chart = table?.liftChart ? table.liftChart.split(',').length : 0;
                box.innerHTML = `<span class="chf-table-icon">${icon('calendar')}</span>
                    <div class="min-0"><b>Chit table <small class="muted">(optional)</small></b>
                        <small>${table ? `${chart ? `${chart} months filled` : 'a cut that falls'}${table.afterLiftInstallment != null ? ` · after lifting ${money(table.afterLiftInstallment)}` : ''} · saved with the chit`
                            : open ? 'Fill it on the right: what lifting gives each month and what you pay after' : 'What lifting gives each month and what you pay after: Lift or hold uses it to say when to lift'}</small></div>
                    <span class="spacer"></span>
                    ${table ? `<button type="button" class="btn sm ghost" data-cf="remove" title="Save the chit without a chit table">${icon('x')}Remove</button>` : ''}
                    <button type="button" class="btn sm ${table || open ? '' : 'primary'}" data-cf="${open ? 'hide' : 'fill'}">${icon(open ? 'chevron-left' : table ? 'edit' : 'list')}${open ? 'Hide the table' : table ? 'Open the table' : 'Fill the chit table'}</button>`;
            };
            const ready = () => {
                const d = readForm(form);
                return Number(d.maturityAmount) > 0 && Number(d.monthlyInstallment) > 0 && Number(d.numberOfInstallments) >= 2 && !!d.startDate;
            };
            const mountTable = async () => {
                const { c: dc, d: dd } = await draft();
                mountLiftTable(side.querySelector('[data-lt-host]') || side.firstElementChild, dc, dd, {
                    terms: table, others: [], prefs: { investRate: 8, loanRate: 12, today: isoDate() }, inline: true,
                    onPreview: t => { if (t) { table = t; tableTouched = true; drawTableRow(); } },
                });
            };
            const showTable = async show => {
                if (show && !ready()) { toast('Fill in the maturity value, the monthly installment, the installments and the start first', 'error'); return; }
                open = show;
                side.hidden = !show;
                m.el.classList.toggle('chf-wide', show);
                drawTableRow();
                if (show) await mountTable();
            };
            // the amount, installment, months or start changed: the table is drawn again, keeping what was typed into it
            let remountTimer = 0;
            form.addEventListener('change', e => {
                if (!open || !['maturityAmount', 'monthlyInstallment', 'numberOfInstallments', 'startDate', 'alreadyPaidInstallments'].includes(e.target.name) || !ready()) return;
                clearTimeout(remountTimer);
                remountTimer = setTimeout(() => mountTable().catch(err => toast(err.message, 'error')), 150);
            });
            form.addEventListener('input', preview);
            form.querySelector('[data-toggle-advanced]').addEventListener('click', () => form.querySelector('[data-advanced]').classList.toggle('open'));
            form.addEventListener('click', e => {
                const b = e.target.closest('[data-cf]');
                if (!b) return;
                if (b.dataset.cf === 'fill') showTable(true).catch(err => toast(err.message, 'error'));
                if (b.dataset.cf === 'hide') showTable(false);
                if (b.dataset.cf === 'remove') { table = null; tableTouched = true; showTable(false); }
            });
            // a new chit can start from an existing one: its fields and its chit table
            form.querySelector('[data-copy-from]')?.addEventListener('change', e => {
                const src = allChits.find(x => x.id === Number(e.target.value));
                if (!src) return;
                const v = copyOf(src);
                ['name', 'ticketNo', 'organizer', 'organizerPhone', 'organizerEmail', 'organizerUpi', 'upiNote', 'maturityAmount', 'monthlyInstallment', 'numberOfInstallments', 'startDate',
                    'notes', 'commissionPercent', 'interestRate'].forEach(k => { if (form[k]) form[k].value = v[k] ?? ''; });
                if (form.endDate) form.endDate.value = '';
                if (form.defaultPaymentAccountId) form.defaultPaymentAccountId.value = v.defaultPaymentAccountId ?? '';
                const t = termsOf(src.id);
                table = t && (t.liftChart || t.liftDiscountFirst != null || t.afterLiftInstallment != null) ? { ...t } : null;
                tableTouched = !!table;
                preview();
                if (open) mountTable().catch(err => toast(err.message, 'error'));
                toast(`Filled from ${src.name}: change what differs`);
            });
            preview();
        },
        actions: [{ label: 'Cancel' }, {
            label: chit ? 'Save changes' : copyFrom ? 'Create the copy' : 'Create chit', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = { ...readForm(form), version: chit?.version ?? null };
                delete data.copyFrom;
                const saved = chit ? await api.put(`/chits/${chit.id}`, data) : await api.post('/chits', data, { notify: chitMail?.value() });
                if (tableTouched) {
                    const t = table || {};
                    try {
                        await api.put(`/chits/${saved.chit.id}/lift-terms`, { afterLiftInstallment: t.afterLiftInstallment ?? null, liftDiscountFirst: t.liftDiscountFirst ?? null,
                            liftDiscountLast: t.liftDiscountLast ?? null, liftFeePercent: t.liftFeePercent ?? null, liftFromMonth: t.liftFromMonth ?? null, liftChart: t.liftChart || null });
                    } catch (error) {
                        toast(`Chit saved, but its chit table was not: ${error.message}`, 'error');
                    }
                }
                toast(`Chit "${saved.chit.name}" saved${tableTouched && table ? ' with its chit table' : ''}`);
                onSaved?.(saved);
            },
        }],
    });
}
