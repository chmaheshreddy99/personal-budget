/**
 * Accounts › a credit card › Bills. From the card's statement day and days to pay (CardBilling on the server): what is
 * payable now, the next bill so far and how long a purchase today stays interest free; then one bill at a time, picked by
 * the month it is payable in (what made it up, the dates of its cycle, its entries) and every statement in a table. The
 * minimum due is an estimate; the card's own statement has the last word.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, emptyState, table } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, shortDate, monthLabel, isoDate } from '../core/format.js';
import { readQuery, setQuery } from '../core/route.js';
import { openQuickEntry } from '../components/transaction-forms.js';
import { toggleEntryRow } from '../components/entry-inline.js';

const STATUS = {
    RUNNING: ['info', 'clock', 'Cycle open'], NO_DUES: ['good', 'check-circle', 'No dues'], PAID: ['good', 'check-circle', 'Paid'],
    PAID_LATE: ['warn', 'clock', 'Paid late'], CARRIED: ['warn', 'history', 'Carried over'], DUE: ['info', 'calendar', 'Due'],
    DUE_SOON: ['warn', 'alert', 'Due soon'], PARTLY_PAID: ['info', 'calendar', 'Part paid'], GRACE: ['warn', 'alert', 'Past due'],
    MINIMUM_PAID: ['warn', 'alert', 'Minimum paid'], OVERDUE: ['bad', 'alert-circle', 'Overdue'],
};
const statusPill = s => { const [tone, iconName, label] = STATUS[s.status] || STATUS.DUE; return `<span class="cb-status ${tone}">${icon(iconName)}${label}</span>`; };

/** "in 5 days", "today", "3 days ago". */
const fromNow = days => (days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ago`);
const dayCount = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
const keyOf = s => s.statementDate;
const ordinal = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };

/** The bill that matters most: the latest while it is unpaid, else the cycle still open. */
const mainBill = o => (o.statements[0] && Number(o.statements[0].outstanding) > 0 ? o.statements[0] : o.running);

/** Draws the pane into `el`; `onEdit` opens the account's form, `onChanged` runs after a payment. */
export async function mountCardBills(el, account, { onEdit, onChanged }) {
    const o = await api.get(`/accounts/${account.id}/card-bills`, { count: 24 });
    if (!el.isConnected) return;
    if (!o.configured) {
        el.innerHTML = `<div class="cb-setup">${emptyState('Set the statement date to see this card\'s bills, what is payable and by when', 'calendar')}
            ${can('MANAGE_ACCOUNTS') ? `<button type="button" class="btn primary" data-cb-setup>${icon('edit')}Set the billing cycle</button>` : ''}</div>`;
        el.querySelector('[data-cb-setup]')?.addEventListener('click', onEdit);
        return;
    }
    const all = [o.running, ...o.statements];
    // #/accounts/<id>?pane=bills&bill=2026-11: the bill payable that month
    let shown = all.find(s => s.payableMonth === readQuery().get('bill')) || mainBill(o);
    const latest = o.statements[0];
    const running = o.running;

    const draw = () => {
        const index = all.indexOf(shown);
        el.innerHTML = `
        <div class="cb-cards">${summaryCards(o, latest, running)}</div>
        <div class="cb-bar">
            <span class="cb-plan">${icon('calendar')}Statement on the ${ordinal(o.billingDay)} · ${o.daysToPay} days to pay${can('MANAGE_ACCOUNTS') ? `<button type="button" class="link-btn" data-cb-setup>Change</button>` : ''}</span>
            <span class="cb-month" title="Pick the month the bill is payable in">Payable in
                <button type="button" class="btn sm icon" data-cb-step="1" ${index < all.length - 1 ? '' : 'disabled'} title="Earlier bill">${icon('chevron-left')}</button>
                <b>${monthLabel(shown.payableMonth)}</b>
                <button type="button" class="btn sm icon" data-cb-step="-1" ${index > 0 ? '' : 'disabled'} title="Later bill">${icon('chevron-right')}</button></span>
        </div>
        <section class="cb-bill">${billHtml(shown)}</section>
        <div class="cb-tables">
            <div class="cb-list"><div class="cb-head">${icon('list')}<b>Statements</b><small>${o.statements.length ? `${o.statements.length} so far` : 'the first one is still to come'}</small></div>${statementsTable(all, shown)}</div>
            <div class="cb-entries"><div class="cb-head">${icon('receipt')}<b>In this bill</b><small>${shortDate(shown.cycleFrom)} – ${shortDate(shown.statementDate)}${shown.running ? ' · so far' : ''}</small></div><div id="cb-entries"></div></div>
        </div>
        <p class="cb-note">${icon('info')}<span>Worked out from your entries: the bank's statement has the last word. Payments must reach the bank by the due date; the minimum due is about 5% (at least ₹200), and EMIs or fees on the bill add to it. Paying less than the total loses the interest-free period. A late fee or a report to the credit bureaus can only come after 3 days past due.</span></p>`;
        drawEntries();
    };

    const drawEntries = async () => {
        const host = el.querySelector('#cb-entries');
        const asked = shown;
        const ledger = await api.get(`/reports/ledger/${account.id}`, { from: shown.cycleFrom, to: shown.statementDate });
        if (asked !== shown || !host.isConnected) return;
        host.innerHTML = table([
            { label: 'Date', cls: 'nowrap', render: r => shortDate(r.date) },
            { label: 'Entry', cls: 'cb-what', render: r => `<span class="ellipsis" title="${esc(r.narration)}">${esc(r.narration)}</span>` },
            { label: 'Spent', align: 'r', render: r => (Number(r.credit) ? `<span class="cr-amt">${money(r.credit, { decimals: 2 })}</span>` : '') },
            { label: 'Paid', align: 'r', render: r => (Number(r.debit) ? `<span class="dr-amt">${money(r.debit, { decimals: 2 })}</span>` : '') },
        ], [...ledger.rows].reverse(), { dense: true, empty: 'No entries in this cycle', rowClass: () => 'clickable', rowAttrs: r => `data-entry="${r.entryId}"` });
    };

    const pick = s => {
        shown = s;
        setQuery({ bill: s === mainBill(o) ? null : s.payableMonth });
        draw();
    };

    el.addEventListener('click', e => {
        if (e.target.closest('[data-cb-setup]')) { onEdit(); return; }
        const step = e.target.closest('[data-cb-step]');
        if (step) { pick(all[all.indexOf(shown) + Number(step.dataset.cbStep)]); return; }
        const row = e.target.closest('tr[data-bill]');
        if (row) { pick(all.find(s => keyOf(s) === row.dataset.bill)); return; }
        const pay = e.target.closest('[data-cb-pay]');
        if (pay) {
            openQuickEntry({ kind: 'TRANSFER', preset: { toAccountId: account.id, amount: Number(pay.dataset.cbPay), narration: `${account.name} bill · ${monthLabel(shown.payableMonth)}` }, onSaved: onChanged });
            return;
        }
        const entry = e.target.closest('tr[data-entry]');
        if (entry) toggleEntryRow(entry, null, { onChanged });
    });
    draw();
}

/** Three cards: payable now, the next bill so far, and what a purchase today gets. */
function summaryCards(o, latest, running) {
    const owed = latest ? Number(latest.outstanding) : 0;
    const freeDays = running.daysToDue;
    const widest = dayCount(running.cycleFrom, running.dueDate);
    const card = (cls, iconName, label, value, note) => `<div class="cb-card ${cls}"><span class="cb-card-ico">${icon(iconName)}</span>
        <div class="min-0"><small>${label}</small><b>${value}</b><span class="cb-card-note">${note}</span></div></div>`;
    return [
        card(owed ? STATUS[latest.status]?.[0] : 'good', 'receipt', 'Payable now', money(owed, { decimals: 2 }),
            !latest ? 'No statement yet'
                : owed ? `${latest.daysToDue >= 0 ? 'by' : 'was due'} ${date(latest.dueDate)} · ${fromNow(latest.daysToDue)} · ${Number(latest.paid) >= Number(latest.minimumDue) ? 'minimum met' : `minimum ${money(Number(latest.minimumDue) - Number(latest.paid))}`}`
                    : `${esc(STATUS[latest.status]?.[2] || '')}: ${date(latest.statementDate)} statement`),
        card('', 'trending', 'Next bill so far', money(running.totalDue, { decimals: 2 }),
            `statement ${date(running.statementDate)} · due ${date(running.dueDate)}${Number(o.averageCharges) ? ` · usually ${money(o.averageCharges)} in spends` : ''}`),
        card('', 'clock', 'Spend today, pay by', date(running.dueDate),
            `${freeDays} days interest free, if the bill is paid in full · up to ${widest} right after a statement date`),
    ].join('');
}

/** One bill: its status and figures (they add up to the total due), and its cycle's dates on a line with today marked. */
function billHtml(s) {
    const pay = Number(s.outstanding);
    const fig = (label, value, cls = '', title = '') => `<div class="cb-fig ${cls}" ${title ? `title="${esc(title)}"` : ''}><small>${label}</small><b>${value}</b></div>`;
    const op = sign => `<span class="cb-op">${sign}</span>`;
    return `
    <div class="cb-bill-head">
        <div class="min-0"><span class="cb-bill-title">${s.running ? 'Next bill, so far' : `${date(s.statementDate)} statement`}</span>${statusPill(s)}</div>
        ${!s.running && pay > 0 && can('POST_TRANSACTIONS') ? `<button type="button" class="btn sm primary" data-cb-pay="${pay}">${icon('check')}Pay ${money(pay, { decimals: 2 })}</button>` : ''}
        ${s.running && pay > 0 && can('POST_TRANSACTIONS') ? `<button type="button" class="btn sm" data-cb-pay="${pay}" title="Pay ahead of the statement">${icon('check')}Pay now</button>` : ''}
    </div>
    <div class="cb-figs">
        ${fig('Previous balance', money(s.previousBalance, { decimals: 2 }))}${op('+')}
        ${fig('Spends & charges', money(s.charges, { decimals: 2 }))}${op('−')}
        ${fig('Payments & refunds', money(s.credits, { decimals: 2 }))}${op('=')}
        ${fig(s.running ? 'Estimated bill' : 'Total due', money(s.totalDue, { decimals: 2 }), 'total', Number(s.closing) < 0 ? `The card is in credit by ${money(-Number(s.closing), { decimals: 2 })}` : '')}
        ${s.running ? '' : `<span class="cb-gap"></span>
        ${fig('Minimum due', money(s.minimumDue), '', 'An estimate: about 5%, at least ₹200; EMIs or fees on the bill add to it')}
        ${fig('Paid since', money(s.paid, { decimals: 2 }), Number(s.paid) ? 'pos' : '')}
        ${fig('Still to pay', money(s.outstanding, { decimals: 2 }), pay ? 'neg' : 'pos')}`}
    </div>
    ${timeline(s)}`;
}

function timeline(s) {
    const start = s.cycleFrom;
    const span = dayCount(start, s.graceUntil) || 1;
    const at = d => Math.max(0, Math.min(100, (dayCount(start, d) / span) * 100));
    const today = dayCount(start, isoDate()) / span * 100;
    const point = (d, label, cls = '') => `<span class="cb-point ${cls}" style="left:${at(d)}%"><i></i><b>${label}</b><small>${shortDate(d)}</small></span>`;
    return `<div class="cb-line" title="The cycle, then the time to pay">
        <i class="cb-seg cycle" style="left:0;width:${at(s.statementDate)}%"></i>
        <i class="cb-seg pay" style="left:${at(s.statementDate)}%;width:${at(s.dueDate) - at(s.statementDate)}%"></i>
        <i class="cb-seg grace" style="left:${at(s.dueDate)}%;width:${100 - at(s.dueDate)}%"></i>
        ${point(start, 'Cycle starts', 'first')}${point(s.statementDate, 'Statement')}${point(s.dueDate, 'Due date', 'due')}${point(s.graceUntil, '+3 days', 'last')}
        ${today >= 0 && today <= 100 ? `<u style="left:${today}%" title="Today"><em>Today</em></u>` : ''}
    </div>`;
}

function statementsTable(all, shown) {
    return `<div class="cb-scroll">${table([
        { label: 'Payable in', cls: 'nowrap', render: s => `<b>${monthLabel(s.payableMonth)}</b>` },
        { label: 'Statement', cls: 'nowrap', render: s => shortDate(s.statementDate) },
        { label: 'Due', cls: 'nowrap', render: s => shortDate(s.dueDate) },
        { label: 'Total due', align: 'r', render: s => `<b>${money(s.totalDue)}</b>` },
        { label: 'Still to pay', align: 'r', render: s => (s.running ? '' : money(s.outstanding)) },
        { label: '', render: statusPill },
    ], all, { dense: true, rowClass: s => `clickable ${s === shown ? 'selected' : ''} ${s.running ? 'cb-open' : ''}`, rowAttrs: s => `data-bill="${keyOf(s)}"` })}</div>`;
}
