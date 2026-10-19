/**
 * Chits: the portfolio card over the chit list (paid in against the whole commitment, interest so far, the
 * yearly return, running / closed, matured chits optionally counted), beside it cards with a meter each (net
 * gain, take home now, future value, still to pay, next due or overdue, dividends); chit rows on the left
 * (running, then matured & closed; a closed chit can be reopened),
 * and for the selected chit a branded banner, key figures, its installments and month-by-month interest.
 * Installments are booked on their due date; each chit can have its own default payment account.
 */
import { api } from '../core/api.js';
import { loadAccounts, can } from '../core/store.js';
import { panel, esc, field, readForm, openModal, toast, confirmDialog, emptyState, statusBadge, accountOptions, accountChip } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, percent, isoDate, daysFromToday } from '../core/format.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { openUpiDialog, upiCardHtml, upiNote, bindUpiCopy } from '../components/upi-pay.js';
import { getPref, setPref } from '../core/prefs.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { evidenceFieldHtml, bindEvidenceField } from '../components/evidence.js';
import { exportButton, bindExport } from '../core/export.js';

const view = { selectedId: null, tab: 'installments', interestFilter: 'all' };

const prefs = getPref('chits', { includeMatured: false });
const savePrefs = () => setPref('chits', prefs);

const isRunning = c => c.status === 'ACTIVE' || c.status === 'PRIZED';

export async function render(container, _params, isCurrent) {
    const chits = await api.get('/chits');
    if (!isCurrent()) return;
    Object.assign(prefs, getPref('chits', { includeMatured: false }));
    const reload = () => render(container, [], isCurrent);

    container.innerHTML = `
    <div class="page chits-page">
        <section class="cp-card" id="chit-brand"></section>
        <div class="cs-cards" id="chit-cards"></div>
        ${panel({
            title: 'My chits', iconName: 'chit', cls: 'p-chit-list', bodyClass: 'flush',
            sub: `${chits.filter(isRunning).length} running`,
            actions: `<a class="btn sm ghost icon" href="#/reports/chit-summary" title="Chit summary: the selected chits together, printable">${icon('printer')}</a>
                <a class="btn sm ghost icon" href="#/forecast/chit" title="Chit illustrator: bids, dividends and the best month to lift">${icon('calculator')}</a>`
                + (can('MANAGE_CHITS') ? `<button class="btn sm primary" id="new-chit">${icon('plus')}Chit</button>` : ''),
            body: `<div class="chit-rows scroll" id="chit-list">${chits.length ? chitRows(chits) : emptyState('Add your first chit', 'chit')}</div>`,
        })}
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
        drawStrip();
    });
    drawStrip();

    container.querySelector('#new-chit')?.addEventListener('click', () => openChitForm(null, saved => { view.selectedId = saved.chit.id; reload(); }));
    container.querySelector('#chit-list').addEventListener('click', e => {
        const card = e.target.closest('[data-id]');
        if (card) show(Number(card.dataset.id));
    });

    async function show(id) {
        view.selectedId = id;
        container.querySelectorAll('#chit-list [data-id]').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === id));
        const detail = await api.get(`/chits/${id}`);
        drawDetail(container.querySelector('#chit-detail'), detail, reload);
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
        open: () => container.querySelector('.p-chit-head [data-pay]')?.click(),
    }));

    if (chits.length) await show(chits.some(c => c.id === view.selectedId) ? view.selectedId : chits[0].id);
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
    const card = `
        <div class="cp-head"><span class="cp-mark">${icon('chit')}</span>
            <div class="min-0"><small>Chit portfolio</small><b>${moneyShort(sum(pool, 'paidIn'))} <em>paid in</em></b></div>
            <span class="cp-rate" title="Yearly return, weighted by what is paid in">${percent(weighted, 1)}<small>a year</small></span></div>
        <div class="cp-progress" title="${percent(paidPct, 0)} of the ${moneyShort(total)} the running chits ask for">
            <i class="onc-bar"><em style="width:${Math.min(100, paidPct)}%"></em></i>
            <span>${percent(paidPct, 0)} of ${moneyShort(total)} · interest <b class="up">+${moneyShort(interest)}</b></span></div>
        <div class="cp-foot">
            <span class="cp-pill run">${icon('play')}${running.length} running</span>
            ${done.length ? `<span class="cp-pill done">${icon('lock')}${done.length} matured / closed</span>` : ''}
            ${done.length ? `<label class="cs-mini-switch" title="Count chits that already matured or paid out in the figures"><input type="checkbox" id="include-matured" ${prefs.includeMatured ? 'checked' : ''}><i></i>with matured</label>` : ''}
        </div>`;
    const cells = `
        ${cell('trending', 'Net gain', `<span class="${expected + realised >= 0 ? 'up' : 'down'}">${moneyShort(expected + realised)}</span>`,
            realised ? `${moneyShort(expected)} expected · ${moneyShort(realised)} realised` : 'expected at maturity', expected + realised >= 0 ? 'good' : 'warn')}
        ${cell('gift', 'Take home now', `<span class="gold">${lift.length ? moneyShort(lift.reduce((s, t) => s + t.prize, 0)) : '—'}</span>`,
            lift.length ? `+${moneyShort(lift.reduce((s, t) => s + t.waitGain, 0))} more if you wait` : 'nothing to lift', 'highlight')}
        ${cell('target', 'Future value', moneyShort(future), `at maturity · ${moneyShort(sum(running, 'projectedCompoundInterest'))} interest`, '',
            future ? (sum(running, 'paidIn') / future) * 100 : null, 'The bar: paid in so far against the maturity amounts')}
        ${cell('hourglass', 'Still to pay', moneyShort(sum(running, 'stillToPay')), `${sum(running, 'installmentsPending')} installments`, '',
            (sum(running, 'stillToPay') / total) * 100)}
        ${overdue ? cell('alert', 'Overdue', `<span class="down">${moneyShort(sum(running, 'overdueAmount'))}</span>`, `${overdue} installment(s)`, 'warn')
                  : cell('calendar', 'Next due', nextDue ? moneyShort(nextDue.nextDueAmount) : '—',
                      nextDue ? `${esc(shortName(nextDue.name))} · ${nextDays === 0 ? 'today' : nextDays === 1 ? 'tomorrow' : shortDate(nextDue.nextDueDate)}` : 'nothing due', nextDays !== null && nextDays <= 3 ? 'note' : '')}
        ${cell('piggy', 'Dividends', moneyShort(sum(pool, 'dividendsEarned')), `${vsFd >= 0 ? '+' : '−'}${moneyShort(Math.abs(vsFd))} vs a 7% FD`, vsFd >= 0 ? 'good' : 'warn')}`;
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

function shortName(name) {
    return name.length > 14 ? name.slice(0, 13) + '…' : name;
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
                <div class="acct-line"><span class="acct-name">${esc(c.name)}</span><b class="acct-bal" title="${c.payoutAmount !== null ? 'Received' : 'At maturity'}">${money(c.payoutAmount ?? c.maturityAmount)}</b></div>
                <div class="acct-line sub">
                    <span class="acct-meta">${esc(c.organizer || '—')} · ${c.installmentsPaid}/${c.numberOfInstallments}</span>
                    <span class="acct-facts"><span class="fact good" title="Compound ${percent(r.compound, 2)} · simple ${percent(r.simple, 2)} a year">${percent(r.compound, 1)}</span>${dueFact}</span>
                    <span class="acct-delta pos" title="Interest earned so far">+${moneyShort(c.compoundInterestEarned)}</span>
                </div>
                <div class="chit-prog"><div class="acct-util good" title="${percent(paidPct, 0)} paid in"><span style="width:${paidPct}%"></span></div>
                    <small>${c.status === 'CLOSED' ? `${icon('lock')}closed` : c.payoutAmount !== null ? `${icon('gift')}paid out ${shortDate(c.payoutDate)}`
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

function drawDetail(container, { chit: c, installments, interestSchedule }, reload) {
    // fresh element each time so handlers of a previously shown chit do not pile up
    const target = container.cloneNode(false);
    container.replaceWith(target);
    const manage = can('MANAGE_CHITS');
    const paidOut = c.payoutAmount !== null;
    const nextPending = installments.find(i => i.status === 'PENDING');
    const total = Number(c.totalContribution) || 1;
    const upcoming = Number(c.stillToPay) - Number(c.overdueAmount);
    const liftNow = takeHomeNow(c);
    const closed = c.status === 'CLOSED';
    target.classList.toggle('is-closed', closed);

    const actions = manage && closed ? `
        <button class="btn sm primary" data-act="reopen" title="Open the chit again to pay, undo or edit">${icon('refresh')}Reopen</button>
        <button class="btn sm on-dark icon" data-act="edit" title="Edit">${icon('edit')}</button>` : manage ? `
        ${nextPending && c.organizerUpi ? `<button class="btn sm on-dark" data-upi="${nextPending.id}" title="Pay #${nextPending.installmentNo} by UPI QR">${icon('qr')}UPI</button>` : ''}
        ${nextPending ? `<button class="btn sm primary" data-pay="${nextPending.id}">${icon('check')}Pay #${nextPending.installmentNo}</button>` : ''}
        ${c.closable ? `<button class="btn sm gold-btn" data-act="close" title="Finished: put it away (it can be reopened)">${icon('lock')}Close chit</button>` : ''}
        ${paidOut ? `<button class="btn sm on-dark" data-act="undo-payout">${icon('undo')}Undo payout</button>`
                  : `<button class="btn sm on-dark" data-act="payout">${icon('gift')}Payout</button>`}
        <button class="btn sm on-dark icon" data-act="edit" title="Edit">${icon('edit')}</button>
        <button class="btn sm on-dark icon" data-act="delete" title="Delete chit">${icon('trash')}</button>` : '';
    const gain = paidOut ? Number(c.realizedGain) : Number(c.projectedNetGain);

    target.innerHTML = `
        <section class="panel p-chit-head">
            <div class="chit-banner">
                <span class="hero-icon">${icon('chit')}</span>
                <div class="ab-id">
                    <div class="ab-name">${esc(c.name)} ${statusBadge(c.status)}${closed && c.closedAt ? `<span class="ab-closed">${icon('lock')}closed ${date(c.closedAt.slice(0, 10))}</span>` : ''}</div>
                    <div class="ab-meta">${[c.organizer, c.ticketNo ? 'Ticket ' + c.ticketNo : '', `${c.numberOfInstallments} × ${money(c.monthlyInstallment)}`]
                        .filter(Boolean).map(esc).join('<i>·</i>')}</div>
                    <div class="cb-progress">
                        <i class="split-bar on-dark"><span class="paid" style="width:${(Number(c.paidIn) / total) * 100}%"></span>
                            <span class="overdue" style="width:${(Number(c.overdueAmount) / total) * 100}%"></span></i>
                        <small>${money(c.paidIn)} paid · ${c.installmentsPaid}/${c.numberOfInstallments}${upcoming > 0 ? ` · ${moneyShort(upcoming)} to go` : ''}</small>
                    </div>
                </div>
                <div class="ab-bal">
                    <small>${paidOut ? 'Received' : 'You receive'}</small>
                    <b>${money(paidOut ? c.payoutAmount : c.maturityAmount)}</b>
                    <span class="ab-change">${paidOut ? date(c.payoutDate) : `${date(c.maturityDate)}${c.daysToMaturity >= 0 ? ` · in ${c.daysToMaturity} days` : ''}`}</span>
                </div>
                <div class="ab-actions chit-actions">${actions}</div>
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
                <span title="Dividends cut the cash you paid">${icon('piggy')}Dividends <b class="pos">${money(c.dividendsEarned)}</b></span>
                <span title="The same installments in a 7% fixed deposit">${icon('scale')}vs 7% FD <b class="${chitReturns(c).vsFd >= 0 ? 'pos' : 'neg'}">${chitReturns(c).vsFd >= 0 ? '+' : '−'}${moneyShort(Math.abs(chitReturns(c).vsFd))}</b></span>
                <span title="Cash actually paid after dividends">${icon('cash')}Cash paid <b>${moneyShort(c.cashPaid)}</b></span>
            </div>
        </section>
        ${panel({
            title: 'Chit passbook', iconName: 'calendar', cls: 'p-chit-tabs', bodyClass: 'flush',
            actions: `${exportButton({ label: '' })}<div class="tabs sm" id="chit-tabs">
                <button class="tab ${view.tab === 'installments' ? 'active' : ''}" data-tab="installments">${icon('list')}Installments</button>
                <button class="tab ${view.tab === 'interest' ? 'active' : ''}" data-tab="interest">${icon('trending')}Interest by month</button>
                <button class="tab ${view.tab === 'details' ? 'active' : ''}" data-tab="details">${icon('info')}Details</button></div>`,
            body: '<div class="scroll chit-tab-body" id="chit-tab-body"></div>',
        })}`;

    const tabBody = target.querySelector('#chit-tab-body');
    const drawTab = () => {
        tabBody.innerHTML = view.tab === 'installments' ? installmentsHtml(installments, manage, Boolean(c.organizerUpi))
            : view.tab === 'interest' ? interestHtml(c, interestSchedule) : detailsHtml(c, installments, interestSchedule);
    };
    drawTab();
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
            target.querySelectorAll('#chit-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
            drawTab();
            return;
        }
        const filter = e.target.closest('[data-interest-filter]');
        if (filter) { view.interestFilter = filter.dataset.interestFilter; drawTab(); return; }
        const entryRow = e.target.closest('tr[data-entry]');
        const btn = e.target.closest('button');
        if (entryRow && !btn) { toggleEntryRow(entryRow, null, { onChanged: reload }); return; }
        if (!btn) return;
        try {
            if (btn.dataset.pay) openPayForm(c, installments.find(i => i.id === Number(btn.dataset.pay)), reload);
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
            else if (btn.dataset.act === 'undo-payout') {
                if (await confirmDialog('Undo the payout? The payout journal will be deleted and the chit becomes active again.')) {
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
        <div class="min-0 grow"><small>${esc(label)}</small><b>${value}</b>${extra}<span class="ck-note">${note}</span></div></div>`;
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

function installmentsHtml(installments, manage, upi) {
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
                <td>${i.paidDate ? `<span class="paid-on" title="From ${esc(i.paidFromAccountName || '')}">${icon(ico)}${shortDate(i.paidDate)}<small>${esc(i.paidFromAccountName || '')}</small></span>`
                    : `<span class="badge ${tone}">${icon(ico)}${label}</span>`}</td>
                <td class="r">${!manage ? '' : i.status === 'PAID'
                    ? `<button class="btn sm ghost icon" data-undo="${i.id}" title="Undo payment">${icon('undo')}</button>`
                    : payable(i) ? `${upi ? `<button class="btn sm ghost icon" data-upi="${i.id}" title="Pay by UPI QR">${icon('qr')}</button>` : ''}<button class="btn sm ${i.overdue ? 'primary' : ''}" data-pay="${i.id}">${icon('check')}Pay</button>`
                    : `<button class="btn sm ghost icon quiet" data-pay="${i.id}" title="Pay in advance">${icon('check')}</button>`}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

const INTEREST_STATUS = {
    EARNED: ['good', 'check-circle', 'Earned'],
    ACCRUING: ['warning', 'hourglass', 'Accruing'],
    PROJECTED: ['gray', 'clock', 'Projected'],
    AFTER_PAYOUT: ['aqua', 'gift', 'After payout'],
};

function interestHtml(c, rows) {
    const earned = rows.filter(r => r.status === 'EARNED');
    const last = rows[rows.length - 1];
    const visible = rows.filter(r => view.interestFilter === 'all'
        || (view.interestFilter === 'earned' ? r.status === 'EARNED' : r.status !== 'EARNED'));
    let dividerShown = false;
    const body = visible.map(r => {
        let divider = '';
        if (!dividerShown && r.status !== 'EARNED' && view.interestFilter === 'all' && earned.length) {
            dividerShown = true;
            divider = `<tr class="today-divider"><td colspan="12"><span>${icon('flag')} Today · ${date(isoDate())} — earned so far
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
            <th class="r col-simple">Simple int.</th><th class="r col-simple">Total simple</th><th class="r">Compound edge</th><th>Status</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr class="total"><td colspan="3">At maturity (${date(c.maturityDate)})</td><td class="r">${money(c.totalContribution)}</td><td></td>
            <td class="r pos">${money(c.projectedCompoundInterest)}</td><td class="r">${money(last?.closingBalance)}</td><td></td>
            <td class="r col-simple">${money(c.projectedSimpleInterest)}</td><td></td>
            <td class="r pos">+${money(Number(c.projectedCompoundInterest) - Number(c.projectedSimpleInterest))}</td><td></td></tr></tfoot>
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
                <div class="span-2">${evidenceFieldHtml({ hint: 'Chit receipt or UPI screenshot' })}</div>
            </form>
            ${upi ? '<div data-upi-card></div>' : ''}
        </div>`,
        onOpen: m => {
            payEvidence = bindEvidenceField(m.el);
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
                const detail = await api.post(`/chits/${chit.id}/installments/${installment.id}/pay`, readForm(form));
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
            ${field({ label: 'Amount received', name: 'amount', type: 'number', value: chit.maturityAmount, required: true })}
            ${field({ label: 'Deposited into', name: 'depositAccountId', type: 'select', required: true, span: 'span-2',
                      options: accountOptions(accounts, a => a.accountClass === 'ASSET' && a.accountType !== 'CHIT_FUND', defaultBank) })}
        </form>
        <p class="hint" style="margin-top:10px">If installments are still pending (prize taken early), they are recorded as a liability
        you keep paying. The difference between the amount received and your total contribution is booked as
        income under <b>Chit Gains</b> (gain) or an expense under <b>Chit Commission &amp; Discount</b> (loss).</p>
        ${evidenceFieldHtml({ hint: 'Payout voucher, cheque or bank credit' })}`,
        onOpen: m => { payoutEvidence = bindEvidenceField(m.el); },
        actions: [{ label: 'Cancel' }, {
            label: 'Record payout', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const detail = await api.post(`/chits/${chit.id}/payout`, readForm(form));
                toast('Payout recorded');
                await payoutEvidence.uploadTo(detail.chit.payoutEntryId);
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

async function openChitForm(chit, onSaved) {
    const accounts = await loadAccounts();
    const c = chit || { numberOfInstallments: 20, startDate: isoDate(), commissionPercent: 5 };
    openModal({
        title: chit ? `Edit ${chit.name}` : 'New chit', iconName: 'chit', size: 'lg',
        body: `<form class="form-grid three" id="chit-form">
            ${field({ label: 'Chit name', name: 'name', value: c.name, required: true, span: 'span-2' })}
            ${field({ label: 'Ticket / group no.', name: 'ticketNo', value: c.ticketNo })}
            ${field({ label: 'Organizer / foreman', name: 'organizer', value: c.organizer })}
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
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('#chit-form');
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
            };
            form.addEventListener('input', preview);
            form.querySelector('[data-toggle-advanced]').addEventListener('click', () => form.querySelector('[data-advanced]').classList.toggle('open'));
            preview();
        },
        actions: [{ label: 'Cancel' }, {
            label: chit ? 'Save changes' : 'Create chit', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = { ...readForm(form), version: chit?.version ?? null };
                const saved = chit ? await api.put(`/chits/${chit.id}`, data) : await api.post('/chits', data);
                toast(`Chit "${saved.chit.name}" saved`);
                onSaved?.(saved);
            },
        }],
    });
}
