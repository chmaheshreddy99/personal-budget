/**
 * Lifecycle panel for money owed: lent / paid on behalf of someone (owed to you) or borrowed / a bill to
 * pay (owed by you; the wording flips). Rendered inside an expanded row
 * (Expenses list, journal, account ledgers) so everything happens in place:
 *   - status, progress and the key figures (repaid, outstanding, interest)
 *   - a timeline: given -> part repayments -> settled / due / overdue, each linked to its journal
 *   - an inline "record repayment" form: full or partial, with an intelligent principal / interest split
 *   - net payable (principal + interest) today and on the due date
 *   - the full month-by-month interest schedule, simple or compound, with the difference to the other way
 *   - interest posted month by month (automatically, or "Post now"), shown in the schedule and timeline
 *   - evidence: the original entry's photos / PDFs, and a capture field on every repayment
 *   - undo a repayment, write off the rest, edit or delete
 *
 *   claimPanelHtml(claim, { evidence })         markup (evidence: show the original entry's evidence strip)
 *   claimContextHtml(claim, entryId)            read-only card for other pages (journal, account statements): only
 *                                               what this entry is within the item, its current standing, and a link
 *                                               to the item in Expenses, the one place where it is changed
 *   bindClaimPanel(host, claim, { onChanged })  wires the actions inside host
 */
import { api } from '../core/api.js';
import { loadAccounts, can, categoriesOf } from '../core/store.js';
import { esc, toast, confirmDialog, openModal, accountOptions } from '../core/ui.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, percent, date, dateTime, shortDate, shortDateYear, isoDate } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { evidenceFieldHtml, bindEvidenceField } from './evidence.js';

export const CLAIM_TONE = { OPEN: 'warning', PARTIAL: 'aqua', SETTLED: 'good', WRITTEN_OFF: 'gray' };

/** Status chip; an open claim past its due date shows as overdue. */
export function claimBadge(c) {
    if (c.overdue) return `<span class="badge critical">${icon('alert')}Overdue</span>`;
    return `<span class="badge ${CLAIM_TONE[c.status] || ''}">${icon(c.status === 'SETTLED' ? 'check-circle' : c.status === 'PARTIAL' ? 'hourglass' : c.status === 'WRITTEN_OFF' ? 'x' : 'clock')}${esc(c.statusLabel)}</span>`;
}

/** Icon, tone and wording per kind; payable kinds describe money you owe. */
export const KIND_META = {
    LENT: { iconName: 'hand', tone: 'violet', given: 'Given', repaid: 'Repaid', receive: 'Record money received', into: 'Into' },
    PAID_FOR: { iconName: 'users', tone: 'aqua', given: 'Given', repaid: 'Repaid', receive: 'Record money received', into: 'Into' },
    BORROWED: { iconName: 'arrow-in', tone: 'coral', given: 'Borrowed', repaid: 'Paid back', receive: 'Record a payment you made', into: 'From', payable: true },
    BILL_DUE: { iconName: 'receipt', tone: 'gold', given: 'Bill', repaid: 'Paid', receive: 'Record a payment you made', into: 'From', payable: true },
};

/** Options of the panel being rendered (rendering is synchronous): read-only, and the entry to highlight. */
let opts = { manage: false, highlight: null };

/** Per item, while the page lives: is the interest table open, and by month or by year. */
const tableState = new Map();
const tableOf = c => tableState.get(c.id) || { open: (c.interestCollection || 'MONTHLY') === 'MONTHLY' && c.schedule.length <= 18, by: c.interestCollection === 'YEARLY' ? 'year' : 'month' };

const PLANS = [['MONTHLY', 'Monthly', 'Interest falls due every month'], ['YEARLY', 'Yearly', 'Interest falls due once a year, on the loan anniversary'],
    ['ON_PAYMENT', 'When paid', 'No fixed dates: interest keeps adding up and is paid whenever they pay']];

/**
 * {@code scroll}: inside a list row, the panel scrolls on its own (head and actions stay in view) instead of
 * stretching the list.
 */
export function claimPanelHtml(c, { evidence = true, readOnly = false, highlight = null, scroll = false } = {}) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const open = c.status === 'OPEN' || c.status === 'PARTIAL';   // principal or posted interest still owed
    const manage = !readOnly && can('POST_TRANSACTIONS');
    opts = { manage, highlight: highlight === null ? null : Number(highlight) };
    const paidPct = Math.min(100, Number(c.repaidPercent));
    const plan = c.interestCollection || 'MONTHLY';
    const dueNow = Number(c.interestDueNow ?? c.interestDue);
    return `
    <div class="claim-panel ${scroll ? 'in-row' : ''}" data-claim="${c.id}">
        <div class="claim-head">
            <span class="chip-icon ${meta.tone}">${icon(meta.iconName)}</span>
            <div class="grow">
                <div class="row"><b>${esc(c.party)}</b>${claimBadge(c)}<span class="tag">${esc(c.kindLabel)}</span>
                    ${c.activeShares ? `<span class="tag aqua" title="Statement links that still work">${icon('link')}shared</span>` : ''}</div>
                <div class="small muted">${esc(c.narration)} · ${esc(c.entryNo || '')} · tracked in ${esc(c.receivableAccount)}${meta.payable ? ' · you owe this' : ''}</div>
            </div>
            <div class="claim-progress">
                <div class="row small"><span class="muted">${meta.repaid}</span><span class="spacer"></span><b>${percent(paidPct, 0)}</b></div>
                <div class="split-bar"><span class="seg paid" style="width:${paidPct}%"></span></div>
            </div>
            ${manage ? `<div class="claim-quick">
                ${open ? `<button class="btn sm primary" data-claim-action="pay" title="Jump to the payment form">${icon(meta.payable ? 'arrow-out' : 'arrow-in')}${meta.payable ? 'Pay' : 'Receive'}</button>` : ''}
                <button class="btn sm" data-claim-action="share" title="A link ${meta.payable ? 'the lender' : 'the borrower'} can open to see payments, interest and what is pending">${icon('link')}Share</button>
                ${open && !meta.payable ? `<button class="btn sm icon" data-claim-action="remind" title="Copy a polite reminder with the amount due">${icon('copy')}</button>
                    <a class="btn sm icon" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(reminderText(c))}" title="Send the reminder on WhatsApp">${icon('phone')}</a>` : ''}
                <button class="btn sm icon" data-claim-action="edit" title="Edit">${icon('edit')}</button>
                ${open ? `<button class="btn sm icon" data-claim-action="writeoff" title="${meta.payable ? 'Mark the rest waived' : 'Write off the rest'}">${icon('x')}</button>` : ''}
                ${!c.repayments.length ? `<button class="btn sm icon danger" data-claim-action="delete" title="Delete">${icon('trash')}</button>` : ''}
            </div>` : ''}
        </div>

        <div class="claim-figures">
            ${fig(meta.given, money(c.amount), `${shortDateYear(c.startDate)} · ${esc(c.paidFromAccount)}`)}
            ${fig(meta.repaid, money(c.repaid), c.lastPaymentDate ? `last ${shortDate(c.lastPaymentDate)}` : 'nothing yet', 'pos')}
            ${fig('Principal owed', money(c.outstanding), open ? `${c.daysOutstanding} days` : 'cleared', open ? 'neg' : '')}
            ${c.interestRate ? fig('Interest', `${Number(c.interestRate)}% p.a.`, `${esc(c.interestTypeLabel)} · ${money(c.monthlyInterest)}/mo · ${esc((c.interestCollectionLabel || '').toLowerCase())}`) : ''}
            ${c.interestRate ? fig('Interest so far', money(c.accruedInterest), `${meta.payable ? 'paid' : 'received'} ${money(c.interestReceived)}${Number(c.interestPosted) ? ` · posted ${money(c.interestPosted)}` : ''}`, Number(c.interestDue) > 0 ? 'warn' : '') : ''}
            ${c.interestRate && open && plan !== 'ON_PAYMENT' ? fig(c.nextInterestDate ? `Next interest · ${shortDate(c.nextInterestDate)}` : 'Interest due now',
                c.nextInterestDate ? money(c.nextInterestAmount) : money(dueNow),
                `${dueNow > 0 ? `<span class="warn-text">${money(dueNow)} due now</span>` : 'nothing due now'}`, '') : ''}
            ${c.dueDate ? fig(c.overdue ? 'Was due' : 'Due', date(c.dueDate), c.overdue ? `${Math.abs(c.daysToDue)} days late` : open ? `in ${c.daysToDue} days` : '—', c.overdue ? 'neg' : '') : ''}
        </div>
        ${open ? payableHtml(c) : ''}

        <div class="claim-body">
            <div class="claim-timeline">
                <div class="section-title">${icon('history')} Lifecycle</div>
                ${timelineHtml(c)}
                ${c.notes ? `<div class="small muted claim-notes">${icon('info')} ${esc(c.notes)}</div>` : ''}
                ${evidence && c.journalEntryId ? `<div data-ev-entry="${c.journalEntryId}" data-ev-count="${c.attachmentCount || 0}"></div>` : ''}
            </div>
            <div class="claim-side">
                ${c.interestRate ? postingHtml(c, manage) : ''}
                ${open && manage ? repayFormHtml(c) : ''}
                ${!open ? `<div class="claim-done">${icon('check-circle')}<div><b>${c.status === 'WRITTEN_OFF' ? 'Closed with a write-off' : 'Fully settled'}</b>
                    <div class="small muted">${c.repayments.length} payment${c.repayments.length === 1 ? '' : 's'} · ${c.daysOutstanding} days from start to finish${Number(c.interestReceived) ? ` · interest earned ${money(c.interestReceived)}` : ''}</div></div></div>` : ''}
            </div>
        </div>
        ${c.schedule.length ? scheduleHtml(c) : ''}
    </div>`;
}

/** Where an item is managed: Expenses, with the item opened. */
export const claimHref = c => `#/expenses/claim/${c.id}`;

/**
 * What one entry is within a lent / borrowed item: the original money, a repayment (which one, its split and
 * what was left after it), a write-off, or a month of interest (period, amount, account). Read-only: changes are
 * made from the item in Expenses. Without an entry id it summarises the item.
 */
/**
 * What one entry is within an item, in one line: { iconName, title, amount, detail }, or null.
 * A repayment says partial or final, which one it was and what was left after it.
 */
export function claimEntryRole(c, entryId) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const payable = !!meta.payable;
    const id = Number(entryId);
    const repayments = c.repayments.filter(r => !r.writeOff);
    const repayment = c.repayments.find(r => r.journalEntryId === id);
    const posting = c.postings.find(p => p.journalEntryId === id);
    if (c.journalEntryId === id) {
        return { iconName: meta.iconName, title: `${c.kindLabel}${payable ? ' from ' : ' to '}${c.party}`, amount: c.amount,
            detail: `${date(c.startDate)} · ${payable ? 'into' : 'from'} ${c.paidFromAccount}${c.interestRate ? ` · ${Number(c.interestRate)}% a year` : ''}${c.dueDate ? ` · due ${date(c.dueDate)}` : ''}` };
    }
    if (repayment?.writeOff) {
        return { iconName: 'x', title: payable ? 'Waived' : 'Written off', amount: repayment.total,
            detail: `${date(repayment.paidDate)} · booked to ${repayment.accountName}` };
    }
    if (repayment) {
        const n = repayments.indexOf(repayment) + 1;
        const kind = repayment.finalPayment ? 'Final' : 'Partial';
        return { iconName: 'arrow-in', title: `${kind} ${payable ? 'payment' : 'repayment'} · ${n} of ${repayments.length}`, amount: repayment.total,
            detail: `${money(repayment.principal)} principal${Number(repayment.interest) ? ` + ${money(repayment.interest)} interest` : ''}`
                + ` · ${payable ? 'from' : 'into'} ${repayment.accountName}`
                + (repayment.finalPayment ? ' · settled' : ` · ${money(repayment.outstandingAfter)} still owed`) };
    }
    if (posting) {
        return { iconName: 'percent', title: `Interest · ${postingLabel(posting).toLowerCase()} of ${c.schedule.filter(p => p.status === 'EARNED').length}`, amount: posting.amount,
            detail: `${shortDateYear(posting.from)} – ${shortDateYear(posting.to)} · ${posting.settled ? (payable ? 'paid from ' : 'received into ') : (payable ? 'owed in ' : 'owed to you in ')}${posting.accountName}${posting.automatic ? ' · automatic' : ''}` };
    }
    return null;
}

/** Where the item stands now, as small figures. */
export function claimFiguresHtml(c) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const open = c.status === 'OPEN' || c.status === 'PARTIAL';
    return `<div class="cc-figs">
        ${mini(meta.given, money(c.amount))}
        ${mini(meta.repaid, money(c.repaid))}
        ${mini('Principal owed', money(c.outstanding), open && Number(c.outstanding) ? 'neg' : '')}
        ${c.interestRate ? mini('Interest due', money(c.interestDue), Number(c.interestDue) ? 'warn-text' : '') : ''}
        ${c.interestRate && c.postings.length ? mini('Interest posted', money(c.interestPosted)) : ''}
        ${open ? mini('Net payable', money(c.settlementAmount), 'strong') : mini('Closed', c.lastPaymentDate ? date(c.lastPaymentDate) : '—')}
    </div>`;
}

/**
 * The whole item, read-only, in an overlay over the current page: lifecycle, figures and the month-by-month
 * interest, with the entry you came from highlighted. Changes stay with the item in Expenses ("Manage").
 */
export async function openClaimDetails(claimOrId, { highlight = null } = {}) {
    const c = typeof claimOrId === 'object' ? claimOrId : await api.get(`/claims/${claimOrId}`);
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const modal = openModal({
        title: `${c.kindLabel} · ${c.party}`, iconName: meta.iconName, size: 'xl claim-details-modal',
        body: claimPanelHtml(c, { readOnly: true, highlight }),
        actions: [
            ...(can('POST_TRANSACTIONS') ? [{ label: 'Manage in Expenses', iconName: 'edit', left: true,
                onClick: () => { location.hash = claimHref(c); } }] : []),
            { label: 'Close', kind: 'primary' },
        ],
    });
    bindClaimPanel(modal.el, c, {});   // folding and unfolding the lifecycle; nothing else is clickable
    setTimeout(() => modal.el.querySelector('.tl-current, .sched-current')?.scrollIntoView({ block: 'center' }), 60);
}

// a "Details" button anywhere (journal, statements, account pages) opens the overlay
document.addEventListener('click', e => {
    const b = e.target.closest('[data-claim-details]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    openClaimDetails(Number(b.dataset.claimDetails), { highlight: b.dataset.highlight ? Number(b.dataset.highlight) : null })
        .catch(error => toast(error.message, 'error'));
});

export function claimContextHtml(c, entryId = null) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const payable = !!meta.payable;
    const id = entryId === null ? null : Number(entryId);
    const repayments = c.repayments.filter(r => !r.writeOff);
    const repayment = c.repayments.find(r => r.journalEntryId === id);
    const posting = c.postings.find(p => p.journalEntryId === id);
    const isOriginal = id !== null && c.journalEntryId === id;
    let role = '';
    if (isOriginal) {
        role = row('arrow-out', `${meta.given} ${money(c.amount)}`, `${payable ? 'from' : 'to'} ${esc(c.party)} on ${date(c.startDate)} · ${payable ? 'into' : 'from'} ${esc(c.paidFromAccount)}${c.interestRate ? ` · ${Number(c.interestRate)}% a year ${c.interestType === 'COMPOUND' ? 'compound' : 'simple'}` : ''}${c.dueDate ? ` · due ${date(c.dueDate)}` : ''}`);
    } else if (repayment?.writeOff) {
        role = row('x', `${payable ? 'Waived' : 'Written off'} ${money(repayment.total)}`, `on ${date(repayment.paidDate)} · booked to ${esc(repayment.accountName)}`);
    } else if (repayment) {
        const n = repayments.indexOf(repayment) + 1;
        role = row('arrow-in', `${meta.repaid} ${money(repayment.total)} · payment ${n} of ${repayments.length}`,
            `${date(repayment.paidDate)} · ${money(repayment.principal)} principal${Number(repayment.interest) ? ` + ${money(repayment.interest)} interest` : ''} · ${payable ? 'from' : 'into'} ${esc(repayment.accountName)} · ${money(repayment.outstandingAfter)} principal left after it`);
    } else if (posting) {
        const month = c.schedule.find(p => p.period === posting.periodNo);
        role = row('percent', `Interest for ${postingLabel(posting).toLowerCase()} · ${money(posting.amount)}`,
            `${shortDateYear(posting.from)} – ${shortDateYear(posting.to)}${month ? ` on ${money(month.openingPrincipal)} principal` : ''} · ${posting.settled ? (payable ? 'paid from ' : 'received into ') : 'posted to '}${esc(posting.accountName)}${posting.automatic ? ' · automatic' : ''} · ${c.postings.length} of ${c.schedule.filter(p => p.status === 'EARNED').length} finished months posted`);
    }
    const open = c.status === 'OPEN' || c.status === 'PARTIAL';
    return `
    <div class="claim-context" data-claim-context="${c.id}">
        <div class="cc-head">
            <span class="chip-icon sm ${meta.tone}">${icon(meta.iconName)}</span>
            <div class="grow min-0"><div class="row"><b>${esc(c.party)}</b>${claimBadge(c)}<span class="tag">${esc(c.kindLabel)}</span></div>
                <div class="small muted ellipsis">${esc(c.narration)} · ${esc(c.entryNo || '')}</div></div>
            <button type="button" class="btn sm" data-claim-details="${c.id}" ${id !== null ? `data-highlight="${id}"` : ''} title="The whole lifecycle and interest, right here">${icon('info')}Details</button>
        </div>
        ${role ? `<div class="cc-role"><span class="small muted">This entry</span>${role}</div>` : ''}
        <div class="cc-figs">
            ${mini(meta.given, money(c.amount))}
            ${mini(meta.repaid, money(c.repaid))}
            ${mini('Principal owed', money(c.outstanding), open && Number(c.outstanding) ? 'neg' : '')}
            ${c.interestRate ? mini('Interest due', money(c.interestDue), Number(c.interestDue) ? 'warn-text' : '') : ''}
            ${c.interestRate && c.postings.length ? mini('Interest posted', money(c.interestPosted)) : ''}
            ${open ? mini('Net payable', money(c.settlementAmount), 'strong') : mini('Closed', c.lastPaymentDate ? date(c.lastPaymentDate) : '—')}
        </div>
    </div>`;
}

function row(iconName, title, detail) {
    return `<div class="cc-row">${icon(iconName)}<div><b>${title}</b><div class="small muted">${detail}</div></div></div>`;
}

function mini(label, value, tone = '') {
    return `<span class="cc-fig"><small>${esc(label)}</small><b class="${tone}">${value}</b></span>`;
}

function fig(label, value, sub = '', tone = '') {
    return `<div class="cfig"><span class="label">${esc(label)}</span><b class="${tone}">${value}</b><small>${sub}</small></div>`;
}

/**
 * Interest booked month by month: on / off, what is booked and unpaid, and the months waiting to be posted.
 * Every whole month counts as one month of interest (30-day months), whatever its number of days.
 */
function postingHtml(c, manage) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const last = c.postings[c.postings.length - 1];
    const plan = c.interestCollection || 'MONTHLY';
    const auto = c.postInterestMonthly && plan !== 'ON_PAYMENT';
    const every = plan === 'YEARLY' ? 'year' : 'month';
    const months = n => `${n} month${n === 1 ? '' : 's'}`;
    return `
    <div class="posting-card ${auto ? 'on' : ''}">
        <div class="row small plan-row">${icon('calendar')}<b>Interest collected</b>
            ${manage ? `<span class="seg-chips xs plan-chips">${PLANS.map(([k, l, t]) =>
                `<button type="button" class="seg-chip ${plan === k ? 'active' : ''}" data-claim-action="plan" data-plan="${k}" title="${t}">${l}</button>`).join('')}</span>`
                : `<span class="badge aqua">${esc(c.interestCollectionLabel || 'Every month')}</span>`}
            <span class="spacer"></span><span class="muted" title="How time is counted for interest">${esc(c.dayCount)}</span></div>
        ${plan !== 'ON_PAYMENT' ? `<label class="switch small plan-auto" title="Book the interest as ${meta.payable ? 'an expense you owe' : 'income owed to you'} as each ${every} ends, without waiting for the payment">
            <input type="checkbox" data-claim-action="auto-post" ${auto ? 'checked' : ''} ${manage ? '' : 'disabled'}><span></span>
            Book it automatically every ${every}${plan === 'YEARLY' ? ' (one entry per year)' : ''}</label>`
            : `<div class="small muted">No fixed dates: the interest keeps adding up and is booked when it is ${meta.payable ? 'paid' : 'received'}.</div>`}
        <div class="row small posting-figs">
            <span>Posted <b>${money(c.interestPosted)}</b>${c.postings.length ? ` in ${c.postings.length} entr${c.postings.length === 1 ? 'y' : 'ies'}` : ''}</span>
            ${Number(c.interestPostedUnpaid) ? `<span class="warn">· unpaid <b>${money(c.interestPostedUnpaid)}</b></span>` : ''}
            <span class="spacer"></span>
            ${manage && c.monthsToPost ? `<button class="btn sm primary" data-claim-action="post-interest" title="Book the finished months now${plan !== 'MONTHLY' ? ', as one entry' : ''}">${icon('check')}Post ${months(c.monthsToPost)} · ${moneyShort(c.interestToPost)}</button>`
                : c.monthsToPost === 0 && c.interestRate ? '<span class="muted">up to date</span>' : ''}
            ${manage && last ? `<button class="btn sm ghost icon" data-claim-action="undo-interest" data-posting="${last.id}" title="Undo ${postingLabel(last).toLowerCase()} (${money(last.amount)})">${icon('undo')}</button>` : ''}
        </div>
        <div class="row small posting-account">${icon('wallet')}<span class="muted">Posts to</span><b>${esc(c.interestAccountName)}</b>
            ${c.interestAccountId !== c.receivableAccountId ? '<span class="tag">custom</span>' : '<span class="muted">(default)</span>'}
            ${manage ? `<button class="link-btn" data-claim-action="interest-account">change</button>` : ''}</div>
    </div>`;
}

/** "Month 4", or "Months 1–12" for a year (or several months) booked as one entry. */
const postingLabel = p => p.firstPeriod && p.firstPeriod < p.periodNo ? `Months ${p.firstPeriod}–${p.periodNo}` : `Month ${p.periodNo}`;

/**
 * The lifecycle, kept short: consecutive "interest posted" months fold into one line (click to unfold),
 * and a long history shows its first event and the latest four, with the rest one click away.
 */
function timelineHtml(c) {
    const items = [];
    for (const e of c.timeline) {
        const last = items[items.length - 1];
        if (e.type === 'INTEREST_POSTED' && last?.group && last.events[0].title === e.title) last.events.push(e);
        else if (e.type === 'INTEREST_POSTED') items.push({ group: true, events: [e] });
        else items.push(e);
    }
    const hit = e => opts.highlight !== null && e.journalEntryId === opts.highlight;
    const html = items.map(it => {
        if (!it.group) return eventHtml(it);
        if (it.events.length === 1) return eventHtml(it.events[0]);
        const total = it.events.reduce((s, e) => s + Number(e.amount || 0), 0);
        const first = it.events[0], last = it.events[it.events.length - 1];
        const open = it.events.some(hit);   // the month being looked at: unfolded and marked
        return `<li class="tl-due tl-group ${open ? 'tl-current' : ''}" data-tl-toggle>
            <span class="tl-dot">${icon('percent')}</span>
            <div class="tl-body"><div class="row"><b>${esc(first.title)} · ${it.events.length} months</b><b class="mono">${money(total)}</b>
                <span class="spacer"></span><span class="small muted">${shortDate(first.date)} – ${shortDate(last.date)}</span></div>
                <div class="small muted">${esc(first.detail.split(' · ')[0])} to ${esc(last.detail.split(' · ')[0]).toLowerCase()} · <span class="link-btn">${open ? 'hide months' : 'show months'}</span></div>
                <ol class="tl-sub" ${open ? '' : 'hidden'}>${it.events.map(e => `<li class="${hit(e) ? 'current' : ''}"><span>${esc(e.detail)}</span><span class="small muted">${shortDate(e.date)}</span><b class="mono">${money(e.amount)}</b></li>`).join('')}</ol>
            </div></li>`;
    });
    const long = html.length > 6 && !c.timeline.some(hit);   // never hide the entry being looked at
    const hidden = long ? html.slice(1, html.length - 4) : [];
    return `<ol class="timeline ${long ? 'compact' : ''}">
        ${long ? `${html[0]}<li class="tl-more" data-tl-more><span class="tl-dot">${icon('more')}</span>
            <div class="tl-body"><span class="link-btn">${hidden.length} earlier event${hidden.length === 1 ? '' : 's'}</span></div></li>
            <div class="tl-hidden" hidden>${hidden.join('')}</div>${html.slice(-4).join('')}` : html.join('')}
    </ol>`;
}

function eventHtml(e) {
    const tone = { CREATED: 'out', REPAID: 'in', WRITTEN_OFF: 'gray', SETTLED: 'done', DUE: 'due', OVERDUE: 'late', INTEREST_POSTED: 'due' }[e.type] || '';
    const ico = { CREATED: 'arrow-out', REPAID: 'arrow-in', WRITTEN_OFF: 'x', SETTLED: 'check', DUE: 'calendar', OVERDUE: 'alert', INTEREST_POSTED: 'percent' }[e.type] || 'info';
    const current = opts.highlight !== null && e.journalEntryId === opts.highlight;
    return `<li class="tl-${tone} ${current ? 'tl-current' : ''}">
        <span class="tl-dot">${icon(ico)}</span>
        <div class="tl-body"><div class="row"><b>${esc(e.title)}</b>${e.amount !== null && e.amount !== undefined ? `<b class="mono">${money(e.amount)}</b>` : ''}
            <span class="spacer"></span><span class="small muted">${date(e.date)}</span></div>
            <div class="small muted">${esc(e.detail || '')}</div></div>
        ${opts.manage && (e.type === 'REPAID' || e.type === 'WRITTEN_OFF') ? `<button type="button" class="btn ghost icon sm" title="Undo this ${e.type === 'REPAID' ? 'repayment' : 'write-off'}"
            data-claim-action="undo" data-entry="${e.journalEntryId}">${icon('undo')}</button>` : ''}
    </li>`;
}

/** A short, polite reminder: amount, interest if any, and the due date. */
export function reminderText(c) {
    const interest = Number(c.interestDue);
    return `Hi ${c.party}, a gentle reminder about ${c.narration.toLowerCase().startsWith('lent') ? 'the money I lent you' : `"${c.narration}"`}`
        + ` on ${date(c.startDate)}. Outstanding: ${money(c.outstanding)}${interest ? ` + ${money(Math.round(interest))} interest = ${money(Math.round(Number(c.settlementAmount)))}` : ''}`
        + `${c.dueDate ? `, due ${date(c.dueDate)}` : ''}.`
        + `${c.interestRate && c.interestCollection !== 'ON_PAYMENT' && Number(c.interestDueNow) > 0 ? ` Interest due now: ${money(Math.round(Number(c.interestDueNow)))}.` : ''}`
        + ' Thank you!';
}

function repayFormHtml(c) {
    const meta = KIND_META[c.kind] || KIND_META.LENT;
    const out = Number(c.outstanding);
    const due = Number(c.interestDue);
    const half = Math.round(out / 2) + due;   // half the principal plus the interest due
    return `
    <form class="repay-form" data-repay autocomplete="off">
        <div class="section-title">${icon(meta.payable ? 'arrow-out' : 'arrow-in')} ${meta.receive}</div>
        <div class="repay-amount">
            <input name="total" type="number" step="any" min="0.01" data-plain required class="num" placeholder="Amount"
                   value="${(out + due).toFixed(2).replace(/\.00$/, '')}">
            <div class="chips">
                <button type="button" class="date-chip" data-fill="${out + due}">Full ${moneyShort(out + due)}</button>
                ${out > 1 ? `<button type="button" class="date-chip" data-fill="${half}">Half ${moneyShort(half)}</button>` : ''}
                ${due > 0 ? `<button type="button" class="date-chip" data-fill="${due}">Interest ${moneyShort(due)}</button>` : ''}
            </div>
        </div>
        <div class="row small repay-split" data-split></div>
        <div class="row wrap">
            <span class="small muted">${meta.into}</span>
            <span class="into-chips" data-into></span>
        </div>
        <div class="row">
            <input type="date" name="paidDate" value="${isoDate()}" max="${isoDate()}" min="${c.startDate}">
            <input name="notes" placeholder="Note (optional)" maxlength="255" data-plain class="grow">
            <button class="btn primary sm" type="submit">${icon('check')}Save</button>
        </div>
        ${evidenceFieldHtml({ label: 'Proof of payment', hint: 'UPI screenshot or receipt' })}
    </form>`;
}

/** Net payable today = principal still owed + interest not yet received; the due-date figure and compounding beside it, on one line. */
function payableHtml(c) {
    const interestDue = Number(c.interestDue);
    const atDue = c.dueDate && c.daysToDue > 0 && c.interestRate;
    const extra = Number(c.compoundInterestToDate) - Number(c.simpleInterestToDate);
    return `
    <div class="payable-strip">
        <span class="ps-main"><small>Net payable today</small><b>${money(c.settlementAmount)}</b>
            <em>${money(c.outstanding)}${c.interestRate ? ` + ${money(interestDue)} interest` : ' principal'}</em></span>
        ${atDue ? `<span class="ps-item" title="If nothing more is paid before then"><small>On ${shortDate(c.dueDate)}</small><b>${money(c.payableAtDue)}</b>
            <em>+${money(Number(c.payableAtDue) - Number(c.settlementAmount))}</em></span>` : ''}
        ${c.interestRate && Math.round(extra) ? `<span class="ps-item" title="${c.interestType === 'COMPOUND' ? 'Compounding has added this over simple interest so far' : 'What monthly compounding would have added so far'}">
            <small>${c.interestType === 'COMPOUND' ? 'Compounding adds' : 'If compounded'}</small><b class="${c.interestType === 'COMPOUND' ? 'pos' : ''}">+${money(extra)}</b></span>` : ''}
    </div>`;
}

/**
 * Every month of the loan: principal, repayments and interest. The chosen method is the main column;
 * the other method shows as the difference only.
 */
function scheduleHtml(c) {
    const compound = c.interestType === 'COMPOUND';
    const t = tableOf(c);
    const last = c.schedule[c.schedule.length - 1];
    const soFar = Number(c.accruedInterest);
    const head = `<div class="section-title sched-head">
            <button type="button" class="link-btn sched-toggle" data-claim-action="toggle-table" title="${t.open ? 'Hide' : 'Show'} the interest table">
                ${icon(t.open ? 'chevron-down' : 'chevron-right')}Interest table</button>
            <span class="muted">· ${c.schedule.filter(p => p.status === 'EARNED').length} month${c.schedule.filter(p => p.status === 'EARNED').length === 1 ? '' : 's'} done · ${money(soFar)} so far${c.nextInterestDate ? ` · next ${money(c.nextInterestAmount)} on ${shortDate(c.nextInterestDate)}` : ''}</span>
            <span class="spacer"></span>
            ${t.open ? `<span class="seg-chips xs"><button type="button" class="seg-chip ${t.by === 'month' ? 'active' : ''}" data-claim-action="table-by" data-by="month">Monthly</button>
                <button type="button" class="seg-chip ${t.by === 'year' ? 'active' : ''}" data-claim-action="table-by" data-by="year">Yearly</button></span>` : ''}
        </div>`;
    if (!t.open) return `<div class="claim-schedule closed">${head}</div>`;
    const note = `<div class="small muted sched-note">${Number(c.interestRate)}% p.a. (${moneyShort(Number(c.amount) * Number(c.interestRate) / 1200)} a month on ${moneyShort(c.amount)}) ${compound ? 'compounded monthly' : 'simple, on the principal only'} · ${esc(c.dayCount)}${Number(c.outstanding) > 0 ? ' · later months assume no more repayments' : ''}</div>`;
    if (t.by === 'year') return `<div class="claim-schedule">${head}${note}${yearTableHtml(c, compound)}</div>`;
    const manage = opts.manage;
    const lastPosted = c.postings.length ? c.postings[c.postings.length - 1].periodNo : 0;
    // a finished whole month after the last posted one can be posted (with any earlier ones still waiting)
    const postable = p => manage && p.status === 'EARNED' && p.posted == null && p.period > lastPosted
        && p.period <= lastPosted + c.monthsToPost;
    // interest received / paid on the spot when it was posted (to a bank, cash or card) counts as paid that month
    const settledBy = new Map(c.postings.filter(x => x.settled).map(x => [x.periodNo, Number(x.amount)]));
    let paidSoFar = 0;
    const rows = c.schedule.map(p => {
        const settled = settledBy.get(p.period) || 0;
        paidSoFar += Number(p.interestPaid) + settled;
        const interest = Number(compound ? p.compoundInterest : p.simpleInterest);
        const cumulative = Number(compound ? p.cumulativeCompound : p.cumulativeSimple);
        const payable = Number(p.closingPrincipal) + Math.max(0, cumulative - paidSoFar);
        const tone = { EARNED: 'good', ACCRUING: 'warning', PROJECTED: 'gray' }[p.status];
        return `<tr class="sched-${p.status.toLowerCase()} ${opts.highlight !== null && p.postedEntryId === opts.highlight ? 'sched-current' : ''}">
            <td><b>${p.period}</b></td>
            <td class="nowrap">${shortDateYear(p.from)} – ${shortDateYear(p.to)}</td>
            <td class="r">${money(p.openingPrincipal)}</td>
            <td class="r">${Number(p.principalRepaid) || Number(p.interestPaid) || settled
                ? `<span class="pos" ${settled ? `title="${money(settled)} interest received when posted"` : ''}>${money(Number(p.principalRepaid) + Number(p.interestPaid) + settled)}</span>` : '<span class="muted">—</span>'}</td>
            <td class="r strong">${money(interest, { decimals: 2 })}</td>
            <td class="r">${money(cumulative)}</td>
            <td class="r muted">${compound ? `+${money(p.compoundExtra)}` : `+${money(p.compoundExtra)}`}</td>
            <td class="r"><b>${money(Math.round(payable))}</b></td>
            <td class="nowrap"><span class="badge ${tone}">${p.status === 'EARNED' ? 'Earned' : p.status === 'ACCRUING' ? 'This month' : 'Projected'}</span>
                ${p.posted !== null && p.posted !== undefined ? `<span class="badge aqua" title="Booked ${money(p.posted)}${postedAs(c, p.period)}">${icon('check')}Posted</span>${manage
                    ? p.period === lastPosted
                        ? `<button class="btn xs ghost" data-claim-action="undo-interest" data-posting="${c.postings[c.postings.length - 1].id}" title="Reverse month ${p.period}: its interest entry (${money(p.posted)}) is removed">${icon('undo')}Reverse</button>`
                        : `<button class="btn xs ghost" disabled title="Reverse the later months first (month ${lastPosted} is the latest)">${icon('undo')}Reverse</button>`
                    : ''}`
                    : postable(p) ? `<button class="btn xs primary" data-claim-action="post-month" data-period="${p.period}"
                        title="Book ${p.period > lastPosted + 1 ? `months ${lastPosted + 1}–${p.period}` : `month ${p.period}`}'s interest as ${KIND_META[c.kind]?.payable ? 'an expense owed' : 'income owed to you'}">${icon('check')}Post</button>` : ''}</td>
        </tr>`;
    }).join('');
    return `
    <div class="claim-schedule">
        ${head}${note}
        <div class="scroll sched-scroll">
        <table class="grid compact dense">
            <thead><tr><th>#</th><th>Month</th><th class="r">Principal</th><th class="r">Received</th>
                <th class="r">${compound ? 'Compound' : 'Simple'} interest</th><th class="r">Total interest</th>
                <th class="r" title="${compound ? 'Compound minus simple' : 'What compounding would add'}">${compound ? 'Over simple' : 'If compound'}</th>
                <th class="r">Payable</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="total"><td colspan="4">${Number(c.outstanding) > 0 ? `By ${shortDate(last.to)}` : 'Total'}</td>
                <td class="r"></td><td class="r">${money(compound ? last.cumulativeCompound : last.cumulativeSimple)}</td>
                <td class="r muted">+${money(last.compoundExtra)}</td><td class="r"></td><td></td></tr></tfoot>
        </table></div>
    </div>`;
}

/** " for months 1–12 as one entry", when this month's posting covers several months. */
function postedAs(c, period) {
    const posting = c.postings.find(x => x.periodNo === period);
    return posting && posting.firstPeriod < posting.periodNo ? ` for ${postingLabel(posting).toLowerCase()} as one entry` : '';
}

/** The schedule folded into years from the start date: interest per year, paid, and the running total. */
function yearTableHtml(c, compound) {
    const years = [];
    c.schedule.forEach(p => {
        const y = Math.floor((p.period - 1) / 12);
        const g = years[y] ||= { year: y + 1, from: p.from, to: p.to, opening: Number(p.openingPrincipal), paid: 0, interest: 0, cumulative: 0, months: 0, statuses: new Set() };
        g.to = p.to;
        g.months++;
        g.paid += Number(p.principalRepaid) + Number(p.interestPaid);
        g.interest += Number(compound ? p.compoundInterest : p.simpleInterest);
        g.cumulative = Number(compound ? p.cumulativeCompound : p.cumulativeSimple);
        g.closing = Number(p.closingPrincipal);
        g.statuses.add(p.status);
    });
    const tone = g => g.statuses.has('ACCRUING') || (g.statuses.has('EARNED') && g.statuses.has('PROJECTED')) ? ['warning', 'Running']
        : g.statuses.has('PROJECTED') ? ['gray', 'Projected'] : ['good', 'Done'];
    return `<div class="scroll sched-scroll"><table class="grid compact dense">
        <thead><tr><th>Year</th><th>Period</th><th class="r">Principal at start</th><th class="r">${KIND_META[c.kind]?.payable ? 'Paid' : 'Received'}</th>
            <th class="r">Interest</th><th class="r">Total interest</th><th class="r">Principal at end</th><th></th></tr></thead>
        <tbody>${years.filter(Boolean).map(g => { const [t, l] = tone(g); return `<tr class="sched-${l === 'Done' ? 'earned' : l === 'Running' ? 'accruing' : 'projected'}">
            <td><b>${g.year}</b></td><td class="nowrap">${shortDateYear(g.from)} – ${shortDateYear(g.to)}${g.months < 12 ? ` <span class="muted small">(${g.months} mo)</span>` : ''}</td>
            <td class="r">${money(g.opening)}</td><td class="r">${g.paid ? `<span class="pos">${money(g.paid)}</span>` : '<span class="muted">—</span>'}</td>
            <td class="r strong">${money(g.interest, { decimals: 2 })}</td><td class="r">${money(g.cumulative)}</td><td class="r">${money(g.closing)}</td>
            <td><span class="badge ${t}">${l}</span></td></tr>`; }).join('')}</tbody>
    </table></div>`;
}

// ===================================================================== behaviour

/**
 * Edits a claim in the form it was made with: money borrowed or a bill to pay in the "money you owe" form,
 * money lent or paid for someone in the expense dialog. Opens over the current page; nothing navigates away.
 */
export async function editClaim(claim, onSaved) {
    if (KIND_META[claim.kind]?.payable) {
        const { openDebtDialog } = await import('./debt-dialog.js');
        openDebtDialog({ claim, onSaved });
    } else {
        const { openExpenseDialog } = await import('./expense-dialog.js');
        openExpenseDialog({ claim, onSaved });
    }
}

export async function bindClaimPanel(host, claim, { onChanged, onEdit = c => editClaim(c, onChanged) } = {}) {
    const panelEl = host.querySelector(`[data-claim="${claim.id}"]`);
    if (!panelEl) return;
    const panelOpts = { ...opts };   // what this panel was rendered with (another panel may render later)
    const form = panelEl.querySelector('[data-repay]');
    if (form) await bindRepayForm(form, claim, onChanged);
    const redrawTable = () => {
        const el = panelEl.querySelector('.claim-schedule');
        if (!el) return;
        opts = panelOpts;
        el.outerHTML = scheduleHtml(claim);
    };

    panelEl.addEventListener('click', async e => {
        const more = e.target.closest('[data-tl-more]');
        if (more) { more.nextElementSibling.hidden = false; more.remove(); return; }
        const group = e.target.closest('[data-tl-toggle]');
        if (group && !e.target.closest('[data-claim-action]')) {
            const sub = group.querySelector('.tl-sub');
            sub.hidden = !sub.hidden;
            group.querySelector('.link-btn').textContent = sub.hidden ? 'show months' : 'hide months';
            return;
        }
        const btn = e.target.closest('[data-claim-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.claimAction;
        try {
            if (action === 'toggle-table' || action === 'table-by') {
                const t = tableOf(claim);
                tableState.set(claim.id, action === 'toggle-table' ? { ...t, open: !t.open } : { ...t, by: btn.dataset.by });
                redrawTable();
                if (action === 'toggle-table' && !t.open) panelEl.querySelector('.claim-schedule')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
            }
            if (action === 'pay') {
                const repay = panelEl.querySelector('[data-repay]');
                repay?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                setTimeout(() => { repay?.total.focus(); repay?.total.select(); }, 250);
                return;
            }
            if (action === 'share') await openShareDialog(claim, onChanged);
            if (action === 'plan' && btn.dataset.plan !== (claim.interestCollection || 'MONTHLY')) {
                const saved = await api.put(`/claims/${claim.id}/interest-plan`, { collection: btn.dataset.plan, autoPost: claim.postInterestMonthly });
                tableState.delete(claim.id);   // the table opens the way that suits the new plan
                toast(`Interest collected ${saved.interestCollectionLabel.toLowerCase()}`);
                onChanged?.();
            }
            if (action === 'auto-post') {
                const saved = await api.put(`/claims/${claim.id}/interest-plan`, { collection: claim.interestCollection || 'MONTHLY', autoPost: btn.checked });
                toast(saved.postInterestMonthly ? 'Interest is booked automatically' : 'Interest is booked when it is paid, or when you post it');
                onChanged?.();
            }
            if (action === 'edit') onEdit?.(claim);
            if (action === 'delete' && await confirmDialog(`Delete "${claim.narration}" (${money(claim.amount)})? Its journal is removed too.`)) {
                await api.del(`/claims/${claim.id}`);
                toast('Deleted');
                onChanged?.();
            }
            if (action === 'undo') {
                const repayment = claim.repayments.find(r => String(r.journalEntryId) === btn.dataset.entry);
                if (repayment && await confirmDialog(`Undo the ${repayment.writeOff ? 'write-off' : 'repayment'} of ${money(repayment.total)} on ${date(repayment.paidDate)}?`)) {
                    await api.del(`/claims/${claim.id}/repayments/${repayment.id}`);
                    toast('Repayment undone');
                    onChanged?.();
                }
            }
            if (action === 'writeoff') await writeOff(claim, onChanged);
            if (action === 'post-interest') await openPostInterest(claim, null, onChanged);
            if (action === 'post-month') await openPostInterest(claim, Number(btn.dataset.period), onChanged);
            if (action === 'interest-account') await openInterestAccount(claim, onChanged);
            if (action === 'undo-interest') {
                const posting = claim.postings.find(p => String(p.id) === btn.dataset.posting);
                if (posting && await confirmDialog(`Reverse the interest posted for ${postingLabel(posting).toLowerCase()} (${money(posting.amount)}, ${esc(posting.accountName)})? Its journal entry ${posting.entryNo || ''} is removed and it can be posted again.`,
                    { title: 'Reverse posted interest', confirmLabel: 'Reverse' })) {
                    await api.del(`/claims/${claim.id}/interest/${posting.id}`);
                    toast(`${postingLabel(posting)} interest reversed`);
                    onChanged?.();
                }
            }
            if (action === 'remind') {
                await navigator.clipboard.writeText(reminderText(claim));
                toast('Reminder copied', 'info');
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

/**
 * Accounts posted interest may go to. Owed to you: a receivable-type asset (interest still to collect) or a bank,
 * cash or wallet (interest received there each month). You owe: a payable / loan, or the bank, cash, wallet or card
 * it is paid from.
 */
export function interestAccountFilter(kind) {
    const liquid = a => ['BANK', 'CASH', 'WALLET'].includes(a.accountType);
    return KIND_META[kind]?.payable
        ? a => a.accountClass === 'LIABILITY' || liquid(a)
        : a => ['RECEIVABLE', 'LOAN_GIVEN', 'OTHER_ASSET'].includes(a.accountType) || liquid(a);
}

/** Interest posted to these accounts is received / paid on the spot. */
export const settlesOnPosting = (a, kind) => ['BANK', 'CASH', 'WALLET'].includes(a?.accountType)
    || (KIND_META[kind]?.payable && a?.accountType === 'CREDIT_CARD');

/** Post finished months (all waiting, or up to one month) to the default or another account. */
async function openPostInterest(claim, upToPeriod, onChanged) {
    const accounts = await loadAccounts();
    const lastPosted = claim.postings.length ? claim.postings[claim.postings.length - 1].periodNo : 0;
    const months = claim.schedule.filter(p => p.period > lastPosted && p.period <= (upToPeriod ?? lastPosted + claim.monthsToPost));
    const compound = claim.interestType === 'COMPOUND';
    const estimate = months.reduce((s, p) => s + Number(compound ? p.compoundInterest : p.simpleInterest), 0);
    const payable = KIND_META[claim.kind]?.payable;
    openModal({
        title: `Post interest · ${claim.party}`, iconName: 'percent',
        body: `<form class="form-grid one">
            <div class="post-summary">
                <div class="row"><b>${months.length === 1 ? `Month ${months[0].period}` : `Months ${months[0]?.period}–${months[months.length - 1]?.period}`}</b>
                    <span class="spacer"></span><b class="mono">${money(Math.min(estimate, Number(claim.interestToPost) || estimate))}</b></div>
                <div class="small muted">${months.map(p => `${shortDateYear(p.from)} – ${shortDateYear(p.to)}`).join(' · ')}</div>
                <div class="small muted">${payable ? 'Booked as Loan Interest (expense).' : 'Booked as Interest income.'}
                    Interest already received directly is not booked again.</div>
            </div>
            <label class="field"><span>${payable ? 'Owed in' : 'Owed to you in'}</span>
                <select name="accountId">${accountOptions(accounts, interestAccountFilter(claim.kind), claim.interestAccountId, 'Choose account')}</select></label>
            <div class="small" data-account-hint></div>
            <label class="check-line"><input type="checkbox" name="makeDefault"> Make this the default account for ${esc(claim.party)}'s interest</label>
            ${months.length > 1 ? `<label class="check-line"><input type="checkbox" name="combine" ${(claim.interestCollection || 'MONTHLY') !== 'MONTHLY' ? 'checked' : ''}> Book the ${months.length} months as one entry</label>` : ''}
        </form>`,
        onOpen: m => {
            const select = m.el.querySelector('[name=accountId]');
            const hint = () => {
                const a = accounts.find(x => x.id === Number(select.value));
                m.el.querySelector('[data-account-hint]').innerHTML = !a ? '' : settlesOnPosting(a, claim.kind)
                    ? `${icon('check-circle')} ${payable ? `Paid from <b>${esc(a.name)}</b> now: counts as interest paid` : `Received into <b>${esc(a.name)}</b> now: counts as interest received`}, nothing stays owed.`
                    : `${icon('clock')} ${payable ? 'Added to what you owe' : 'Added to what is owed to you'} in <b>${esc(a.name)}</b>, until it is paid.`;
            };
            select.addEventListener('change', hint);
            hint();
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Post interest', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                const accountId = Number(form.accountId.value) || null;
                const saved = await api.post(`/claims/${claim.id}/interest`, {
                    upToPeriod: upToPeriod, accountId, makeDefault: form.makeDefault.checked, combine: form.combine?.checked || false,
                });
                toast(`Interest posted · ${money(saved.interestPosted)} booked so far`);
                onChanged?.();
            },
        }],
    });
}

/** Choose the account this item's interest is posted to by default. */
async function openInterestAccount(claim, onChanged) {
    const accounts = await loadAccounts();
    openModal({
        title: 'Default account for posted interest', iconName: 'wallet',
        body: `<form class="form-grid one">
            <p class="hint" style="margin:0">Monthly postings (automatic and manual) go here unless you pick another account when posting.
                The default is the account the item sits in, <b>${esc(claim.receivableAccount)}</b>.</p>
            <label class="field"><span>Account</span>
                <select name="accountId">${accountOptions(accounts, interestAccountFilter(claim.kind), claim.interestAccountId, 'Choose account')}</select></label>
        </form>`,
        actions: [
            { label: `Use ${claim.receivableAccount}`, left: true, onClick: async () => {
                await api.put(`/claims/${claim.id}/interest-account`, { accountId: null });
                toast('Interest posts to ' + claim.receivableAccount);
                onChanged?.();
            } },
            { label: 'Cancel' },
            { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
                const accountId = Number(m.el.querySelector('[name=accountId]').value) || null;
                const saved = await api.put(`/claims/${claim.id}/interest-account`, { accountId });
                toast('Interest posts to ' + saved.interestAccountName);
                onChanged?.();
            } },
        ],
    });
}

async function bindRepayForm(form, claim, onChanged) {
    const accounts = await loadAccounts();
    const proof = bindEvidenceField(form);
    const into = accounts.filter(a => a.active && ['BANK', 'CASH', 'WALLET'].includes(a.accountType))
        .sort((a, b) => (a.id === claim.paidFromAccountId ? -1 : b.id === claim.paidFromAccountId ? 1 : 0)
            || ['BANK', 'CASH', 'WALLET'].indexOf(a.accountType) - ['BANK', 'CASH', 'WALLET'].indexOf(b.accountType))
        .slice(0, 4);
    let intoId = into[0]?.id;
    const host = form.querySelector('[data-into]');
    host.innerHTML = into.map(a => {
        const t = accountTypeIcon(a.accountType);
        return `<button type="button" class="into-chip" data-into-id="${a.id}">${icon(t.name)}${esc(a.name)}</button>`;
    }).join('');
    const markInto = () => host.querySelectorAll('[data-into-id]').forEach(b => b.classList.toggle('selected', Number(b.dataset.intoId) === intoId));
    markInto();

    const out = Number(claim.outstanding);
    const due = Number(claim.interestDue);
    /** Interest due is settled first, the rest reduces the principal; anything beyond both counts as extra interest. */
    const split = total => {
        const interestFirst = Math.min(total, due);
        const principal = Math.min(total - interestFirst, out);
        const interest = Math.round((total - principal) * 100) / 100;
        return { principal: Math.round(principal * 100) / 100, interest };
    };
    const preview = () => {
        const total = Number(form.total.value || 0);
        const { principal, interest } = split(total);
        const left = out - principal;
        form.querySelector('[data-split]').innerHTML = total <= 0 ? '<span class="muted">Enter the amount received</span>' : `
            <span>${money(principal)} principal${interest ? ` + ${money(interest)} interest` : ''}</span><span class="spacer"></span>
            ${left <= 0.004 ? `<span class="badge good">${icon('check')}Settles in full</span>` : `<span class="badge aqua">${money(left)} left</span>`}`;
    };
    form.addEventListener('input', preview);
    form.addEventListener('click', e => {
        const fill = e.target.closest('[data-fill]');
        const chip = e.target.closest('[data-into-id]');
        if (fill) { form.total.value = Math.round(Number(fill.dataset.fill) * 100) / 100; preview(); }
        if (chip) { intoId = Number(chip.dataset.intoId); markInto(); }
    });
    form.addEventListener('submit', async e => {
        e.preventDefault();
        e.stopPropagation();
        if (!intoId) { toast('Pick the account the money came into', 'error'); return; }
        const { principal, interest } = split(Number(form.total.value || 0));
        try {
            const saved = await api.post(`/claims/${claim.id}/repayments`, {
                paidDate: form.paidDate.value, principal, interest, accountId: intoId, notes: form.notes.value,
            });
            const newest = [...saved.repayments].sort((a, b) => b.id - a.id)[0];
            await proof.uploadTo(newest?.journalEntryId);
            const payable = KIND_META[claim.kind]?.payable;
            toast(saved.status === 'SETTLED' ? (payable ? `${claim.party} is paid off in full` : `${claim.party} has settled in full`)
                : `Recorded · ${money(saved.outstanding)} still ${payable ? 'to pay' : 'owed'}`);
            onChanged?.();
        } catch (error) {
            toast(error.message, 'error');
        }
    });
    preview();
}

async function writeOff(claim, onChanged) {
    const payable = KIND_META[claim.kind]?.payable;
    const list = await categoriesOf(payable ? 'INCOME' : 'EXPENSE');
    const target = list.find(c => /gift|donat/i.test(c.name)) || list.find(c => /misc|other/i.test(c.name)) || list[0];
    const message = payable
        ? `${claim.party} no longer wants the remaining ${money(claim.outstanding)}? It is booked as income under "${target.name}".`
        : `Forgive the remaining ${money(claim.outstanding)} from ${claim.party}? It is booked as an expense under "${target.name}".`;
    if (!await confirmDialog(message, { title: payable ? 'Mark waived' : 'Write off', confirmLabel: payable ? 'Mark waived' : 'Write off' })) return;
    await api.post(`/claims/${claim.id}/write-off`, { paidDate: isoDate(), categoryId: target.id });
    toast('Written off');
    onChanged?.();
}

// ===================================================================== statement links

const SHARE_DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '1 month'], [2160, '3 months']];

/**
 * A link the other person opens without an account: what was given, every payment, the interest so far, what
 * falls due next and what is payable now, always as of the moment they open it. Expires on its own; revoke any time.
 */
export async function openShareDialog(claim, onChanged) {
    const meta = KIND_META[claim.kind] || KIND_META.LENT;
    const payable = !!meta.payable;
    let changed = false;
    const listHtml = shares => !shares.length ? '' : `
        <div class="section-title">${icon('link')} Links made</div>
        <div class="cs-list">${shares.map(s => {
            const tone = s.status === 'ACTIVE' ? ['good', `until ${dateTime(s.expiresAt)}`] : s.status === 'EXPIRED' ? ['gray', 'expired'] : ['critical', 'revoked'];
            return `<div class="cs-row ${s.status.toLowerCase()}">
                <span class="badge ${tone[0]}">${tone[1]}</span>
                <span class="grow min-0"><b>${esc(s.sharedWith || 'Anyone with the link')}</b>
                    <small class="muted">made ${dateTime(s.createdAt)} · opened ${s.views}×${s.lastViewedAt ? `, last ${dateTime(s.lastViewedAt)}` : ''}${s.showSchedule ? ' · with interest table' : ''}</small></span>
                ${s.status === 'ACTIVE' ? `<button type="button" class="btn sm ghost" data-revoke-share="${s.id}" title="Stop this link now">${icon('lock')}Revoke</button>` : ''}
            </div>`; }).join('')}</div>`;
    const shares = await api.get(`/claims/${claim.id}/shares`);
    const modal = openModal({
        title: `Share statement · ${claim.party}`, iconName: 'link', size: 'lg',
        body: `<div class="cs-dialog">
            <p class="hint" style="margin:0">${esc(claim.party)} opens the link on any phone, no sign-in: ${payable ? 'what you borrowed' : 'what you lent'}, every payment, the interest so far,
                when the next interest falls due and what is payable today. It is always up to date, and stops working when it expires or you revoke it.
                Your account names and notes are not shown.</p>
            <form class="form-grid two" data-share-form onsubmit="return false">
                <label class="field"><span>For</span><input name="sharedWith" maxlength="80" value="${esc(claim.party)}" data-plain></label>
                <div class="field"><span>Valid for</span><div class="ln-chips" data-share-hours>${SHARE_DURATIONS.map(([h, l]) =>
                    `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
                <label class="field span-2"><span>Message on top <small class="muted">optional</small></span>
                    <input name="message" maxlength="300" placeholder="e.g. Please pay this month's interest by the 5th" data-plain></label>
                ${claim.interestRate ? `<label class="check-line span-2"><input type="checkbox" name="showSchedule" checked> Include the interest table (month by month, or by year)</label>` : ''}
            </form>
            <div data-share-result></div>
            <div data-share-list>${listHtml(shares)}</div>
        </div>`,
        onOpen: m => {
            m.el.querySelector('[data-share-hours]').addEventListener('click', e => {
                const chip = e.target.closest('[data-value]');
                if (chip) m.el.querySelectorAll('[data-share-hours] [data-value]').forEach(c => c.classList.toggle('selected', c === chip));
            });
            m.el.querySelector('[data-share-list]').addEventListener('click', async e => {
                const b = e.target.closest('[data-revoke-share]');
                if (!b) return;
                try {
                    await api.post(`/claims/${claim.id}/shares/${b.dataset.revokeShare}/revoke`);
                    toast('Link stopped');
                    changed = true;
                    m.el.querySelector('[data-share-list]').innerHTML = listHtml(await api.get(`/claims/${claim.id}/shares`));
                } catch (error) { toast(error.message, 'error'); }
            });
        },
        actions: [
            { label: 'Close', onClick: () => { if (changed) onChanged?.(); } },
            { label: 'Make link', kind: 'primary', iconName: 'link', onClick: async m => {
                const form = m.el.querySelector('[data-share-form]');
                const hours = Number(m.el.querySelector('[data-share-hours] .selected')?.dataset.value || 168);
                const created = await api.post(`/claims/${claim.id}/shares`, {
                    sharedWith: form.sharedWith.value, hours, message: form.message.value, showSchedule: !!form.showSchedule?.checked,
                });
                changed = true;
                const url = `${location.origin}/statement.html#${created.token}`;
                const text = `Hi ${claim.party}, here is the statement of ${payable ? 'what I borrowed from you' : 'the money I lent you'}: payments, interest and what is pending, up to date whenever you open it (until ${date(created.share.expiresAt.slice(0, 10))}). ${url}`;
                const result = m.el.querySelector('[data-share-result]');
                result.innerHTML = `<div class="ln-made cs-made">
                    <div class="ln-qr">${qrSvg(url, { size: 150 })}</div>
                    <div class="ln-made-main">
                        <p class="small muted" style="margin:0">Copy or send it now: the link is shown only once. It works until <b>${dateTime(created.share.expiresAt)}</b>.</p>
                        <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy>${icon('copy')}Copy</button></div>
                        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">${icon('phone')}Send on WhatsApp</a>
                            <a class="btn sm" target="_blank" rel="noopener" href="${esc(url)}">${icon('eye')}Preview</a>
                            ${navigator.share ? `<button type="button" class="btn sm" data-native-share>${icon('link')}Share…</button>` : ''}</div>
                    </div></div>`;
                result.querySelector('[data-copy]').addEventListener('click', async () => {
                    try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { result.querySelector('input').select(); }
                });
                result.querySelector('[data-native-share]')?.addEventListener('click', () => navigator.share({ title: 'Statement', text, url }).catch(() => {}));
                m.el.querySelector('[data-share-list]').innerHTML = listHtml(await api.get(`/claims/${claim.id}/shares`));
                return true;   // stay open to copy / send
            } },
        ],
    });
    modal.el.querySelector('[data-close]')?.addEventListener('click', () => { if (changed) onChanged?.(); });
}
