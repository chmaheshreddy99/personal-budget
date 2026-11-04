/**
 * Things bought on EMI (Expenses › EMIs): the schedule maths (the same as the server's), a plan opened in place
 * (where it stands, the money, every instalment) with what can be done, and the dialogs for paying.
 *
 * A card EMI is charged on the card and converted at once, as the bank does: the price moves from the card to Payables,
 * and the limit stays held. Each month the whole EMI is billed on the card, with the statement's figures if they differ;
 * when the card is paid (from here, or by any transfer into it) its principal comes off Payables, and the plan's share is
 * nil once every EMI is paid. Plans made before this have no payable (p.payableAccountId empty): their price stays on the card. A loan EMI owes an account of its
 * own and each EMI is paid from the bank.
 *
 *   emiSchedule(principal, rate, months, gstPercent, firstDue)   the rows, reducing balance
 *   addMonths(iso, n) / monthsBetween(a, b)                        Java's plusMonths (the day clamped to the month)
 *   emiPreviewHtml(terms)                                          the dialog's preview, with the whole schedule
 *   emiPanelHtml(plan) / bindEmiPanel(el, plan, { onChanged, onEdit })   the expanded row
 *   emiSideHtml(book)                                              the side panel of the Expenses page
 */
import { api } from '../core/api.js';
import { can, loadAccounts } from '../core/store.js';
import { esc, toast, openModal, confirmDialog, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, isoDate } from '../core/format.js';

const num = v => Number(v || 0);
const r2 = v => Math.round(v * 100) / 100;

/** "2026-01-31" + 1 month → "2026-02-28" (as LocalDate.plusMonths). */
export function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(d, last));
    return first.toISOString().slice(0, 10);
}

/** Whole months from a to b (by month, the day ignored). */
export function monthsBetween(a, b) {
    const [ya, ma] = a.split('-').map(Number);
    const [yb, mb] = b.split('-').map(Number);
    return (yb - ya) * 12 + (mb - ma);
}

export function emiAmount(principal, rate, months) {
    if (!months) return 0;
    if (!num(rate)) return r2(principal / months);
    const r = rate / 1200;
    const f = Math.pow(1 + r, months);
    return r2(principal * r * f / (f - 1));
}

/** Every instalment: the interest on what is still owed, the rest principal, the last one clearing the balance. */
export function emiSchedule(principal, rate, months, gstPercent, firstDue) {
    const emi = emiAmount(principal, rate, months);
    const r = num(rate) / 1200;
    let balance = r2(principal);
    const rows = [];
    for (let k = 1; k <= months; k++) {
        const interest = r2(balance * r);
        const part = k === months ? balance : Math.max(0, Math.min(balance, r2(emi - interest)));
        balance = r2(balance - part);
        rows.push({ seq: k, dueDate: firstDue ? addMonths(firstDue, k - 1) : null, emi: r2(part + interest), principal: part, interest, gst: r2(interest * num(gstPercent) / 100), balanceAfter: balance });
    }
    return rows;
}

/** The dialog's preview: the EMI, what it all costs, how it is booked, and every instalment. */
export function emiPreviewHtml({ principal, rate, months, gst, fee, feeGst = 0, first, kind }) {
    if (!(principal > 0) || !(months > 0)) return `<div class="emi-prev empty">${icon('calendar')}<span>Enter the price and the months: the EMI and its whole schedule show here.</span></div>`;
    const rows = emiSchedule(principal, rate, months, gst, first);
    const interest = rows.reduce((s, x) => s + x.interest, 0);
    const gstTotal = rows.reduce((s, x) => s + x.gst, 0);
    const gstOnFee = r2(num(fee) * num(feeGst) / 100);
    const total = principal + interest + gstTotal + num(fee) + gstOnFee;
    const last = rows[rows.length - 1];
    const card = kind === 'CARD';
    return `<div class="emi-prev">
        <div class="emi-prev-hero"><div><small>${num(rate) ? 'Monthly EMI' : 'No-cost EMI'}</small><b>${money(rows[0].emi + rows[0].gst)}</b></div>
            <span>${months} months${first ? ` · ${shortDate(first)} → ${shortDate(last.dueDate)}` : ''}</span></div>
        <div class="emi-prev-figs">
            <span><small>Price</small><b>${money(principal)}</b></span>
            <span><small>Interest</small><b class="${interest ? 'neg' : ''}">${money(r2(interest))}</b></span>
            ${gstTotal ? `<span><small>GST</small><b class="neg">${money(r2(gstTotal))}</b></span>` : ''}
            ${num(fee) ? `<span title="${gstOnFee ? `${money(fee)} + GST ${money(gstOnFee)}` : 'Processing fee'}"><small>Fee${gstOnFee ? ' + GST' : ''}</small><b class="neg">${money(r2(num(fee) + gstOnFee))}</b></span>` : ''}
            <span class="total"><small>You pay</small><b>${money(r2(total))}</b></span>
        </div>
        <div class="emi-prev-how">${icon('info')}<span>${card
            ? `<b>${money(principal)}</b> is an expense on the card today, and is converted at once: it moves to Payables (as Credit Card EMI), while the bank keeps that much of the limit held. Each month the whole EMI is billed on the card, and you can change the amount to match the statement; when the card is paid, its principal comes off Payables, and the plan's share is nil after the last EMI.${gstOnFee || num(fee) ? ` The fee${gstOnFee ? ' and its GST go' : ' goes'} on the card today.` : ''}`
            : `<b>${money(principal)}</b> is spent today and owed to the lender (an EMI loan account, hidden from the accounts list). Each EMI is paid from the account picked: principal off the loan, interest under Loan Interest.`}</span></div>
        <div class="emi-table scroll"><table><thead><tr><th>#</th><th>Due</th><th class="r">EMI</th><th class="r">Principal</th><th class="r">Interest${gstTotal ? ' + GST' : ''}</th><th class="r">${card ? 'Limit held after' : 'Owed after'}</th></tr></thead>
            <tbody>${rows.map(x => `<tr><td>${x.seq}</td><td>${x.dueDate ? date(x.dueDate) : ''}</td><td class="r"><b>${money(x.emi + x.gst)}</b></td>
                <td class="r">${money(x.principal)}</td><td class="r muted">${money(r2(x.interest + x.gst))}</td><td class="r">${money(x.balanceAfter)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th colspan="2">Total</th><th class="r">${money(r2(principal + interest + gstTotal))}</th><th class="r">${money(principal)}</th><th class="r">${money(r2(interest + gstTotal))}</th><th></th></tr></tfoot></table></div>
    </div>`;
}

// ===================================================================== a plan, opened in place

const STATUS = { DUE: ['', 'Due'], BILLED: ['warning', 'Billed'], PAID: ['good', 'Paid'], WAIVED: ['gray', 'Not needed'] };

export function emiBadge(p) {
    if (p.archived) return `<span class="badge gray">${icon('lock')}Closed</span>`;
    if (p.status === 'CLOSED') return `<span class="badge good">${icon('check-circle')}Paid off</span>`;
    if (p.status === 'FORECLOSED') return `<span class="badge good">${icon('check-circle')}Paid off early</span>`;
    if (num(p.overdueAmount)) return `<span class="badge critical">${icon('alert')}${p.dueNow} due</span>`;
    if (p.dueNow) return `<span class="badge warning">${icon('clock')}${p.kind === 'CARD' && p.toPay ? `${p.toPay} to pay` : `${p.dueNow} due`}</span>`;
    return `<span class="badge aqua">${p.paidCount}/${p.months} paid</span>`;
}

export function emiPanelHtml(p) {
    const manage = can('POST_TRANSACTIONS');
    const card = p.kind === 'CARD';
    const active = p.status === 'ACTIVE' && !p.archived;
    const finished = p.status !== 'ACTIVE' && !p.archived;
    const next = p.next;
    const fact = (ic, text, title = '') => `<span class="xd-fact" ${title ? `title="${esc(title)}"` : ''}>${icon(ic)}${text}</span>`;
    const pct = p.progressPercent;
    const nextAmt = next ? num(next.emi) + num(next.gst) : 0;
    const converted = card && !!p.payableAccountId;
    const btn = (act, ic, label, cls = '', extra = '') => manage ? `<button class="btn xs ${cls}" data-emi="${act}" ${extra}>${icon(ic)}${label}</button>` : '';
    return `<div class="emi-panel">
        ${p.archived ? `<div class="emi-closed-note">${icon('lock')}<span>Closed ${p.archivedOn ? shortDate(p.archivedOn) : ''}: it no longer shows${p.liabilityAccountName ? ' and its account is hidden' : ''}. Re-open it to change something.</span>
            ${btn('reopen', 'unlock', 'Re-open', 'primary')}</div>` : ''}
        <div class="xd-top">
            ${fact(card ? 'card' : 'briefcase', `<b>${card ? 'Card EMI' : 'Loan EMI'}</b> ${esc(p.lender || '')}`, 'Who lends')}
            ${fact(card ? 'card' : 'bank', esc(p.payAccountName || ''), card ? 'Charged on' : 'Paid from')}
            ${fact('percent', num(p.ratePercent) ? `${num(p.ratePercent)}% a year` : 'no-cost', 'Interest, reducing balance')}
            ${fact('calendar', `${date(p.purchaseDate)} · ${p.months} months`, 'Bought on')}
            ${p.purchaseEntryNo ? fact('journal', esc(p.purchaseEntryNo), 'The purchase entry') : ''}
            ${p.conversionEntryNo ? fact('link', esc(p.conversionEntryNo), `Converted into EMI: taken off ${p.payAccountName} and put on ${p.payableAccountName}`) : ''}
            ${active ? fact(p.autoPost ? 'repeat' : 'hand', p.autoPost ? (card ? 'bills itself' : 'pays itself') : 'by hand', p.autoPost ? `Each EMI is ${card ? 'billed on the card' : 'paid'} on its due date` : 'Record each EMI yourself') : ''}
            <span class="spacer"></span>
            <span class="xd-actions">
                ${active && next ? (card
                    ? `${next.status === 'BILLED' && converted ? btn('settle', 'check', `EMI ${next.seq} paid with the bill`, '', `title="The card's bill is paid already, some other way: only its principal comes off ${esc(p.payableAccountName)}"`) : ''}
                        ${next.status === 'DUE' ? btn('bill', 'receipt', `Bill EMI ${next.seq}`, '',  `title="${converted ? `Bill the whole EMI on the card: ${money(nextAmt)}` : `Bill it on the card: its interest${num(next.gst) ? ' and GST' : ''} added, ${money(nextAmt)} to pay`}"`) : ''}
                        ${btn('pay', 'arrow-in', `Pay EMI ${next.seq} into card`, 'primary', `data-count="1" title="${money(nextAmt)} from the bank into the card: frees ${money(next.principal)} of the limit"`)}`
                    : btn('pay', 'check', `Pay EMI ${next.seq}`, 'primary', `data-count="1" title="${money(nextAmt)} due ${date(next.dueDate)}"`)) : ''}
                ${active && p.dueNow > 1 ? btn('pay', 'check-circle', `Pay ${p.dueNow} due`, '', `data-count="${p.dueNow}"`) : ''}
                ${active && p.left > 0 ? btn('foreclose', 'flag', 'Pay off', '', 'title="Pay off what is left at once"') : ''}
                ${!p.archived && (p.paidCount > 0 || p.toPay > 0 || p.status === 'FORECLOSED') ? btn('undo', 'undo', 'Undo', 'ghost', `title="${p.status === 'FORECLOSED' ? 'Undo paying off early' : 'Undo the last EMI billed or paid'}"`) : ''}
                ${!p.archived ? btn('edit', 'edit', 'Edit', 'ghost', `title="${p.editable ? 'Change the plan' : 'Change what it was, its category and lender (the terms are fixed once an EMI is billed or paid)'}"`) : ''}
                ${finished ? btn('close', 'lock', 'Close', '', 'title="Put it away: it no longer shows until re-opened"') : ''}
                ${manage && active ? `<label class="switch sm" title="${card ? 'Bill' : 'Pay'} each EMI by itself on its due date"><input type="checkbox" data-emi="auto" ${p.autoPost ? 'checked' : ''}><span></span>Auto</label>` : ''}
                ${manage && p.editable && !p.archived ? `<button class="btn xs ghost icon danger" data-emi="delete" title="Delete the plan and its purchase">${icon('trash')}</button>` : ''}
            </span>
        </div>
        <div class="xd-cards emi-cards">
            <div class="xd-card">
                <div class="xd-card-head">${icon('timeline')}Progress</div>
                <div class="xd-line"><span>${p.paidCount} of ${p.months} paid</span><b class="mono">${pct}%</b></div>
                <i class="xd-bar"><em style="width:${pct}%"></em></i>
                <div class="xd-line small"><span class="muted">${p.status === 'ACTIVE' ? `${p.left} left${p.monthsLeft ? ` · ${p.monthsLeft} month${p.monthsLeft === 1 ? '' : 's'}` : ''}` : p.status === 'FORECLOSED' ? 'paid off early' : 'all paid'}</span>
                    <span class="muted">${p.closedOn ? `ended ${shortDate(p.closedOn)}` : `ends ${shortDate(p.endDate)}`}</span></div>
                ${next && p.status === 'ACTIVE' ? `<div class="xd-line small"><span class="${next.overdue ? 'neg' : 'muted'}">Next: EMI ${next.seq} · ${date(next.dueDate)}${next.status === 'BILLED' ? ' · billed' : ''}${next.overdue ? ' · overdue' : ''}</span><b class="mono">${money(nextAmt)}</b></div>` : ''}
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon(card ? 'card' : 'scale')}${card ? 'On the card' : 'Still owed'}</div>
                ${converted ? `<div class="xd-line"><span title="This plan's share of ${esc(p.payableAccountName)}: what is still owed. It goes down as the card is paid, and is nil after the last EMI">On Payables</span><b class="mono ${num(p.payableBalance) ? 'neg' : ''}">${money(p.payableBalance)}</b></div>` : ''}
                ${card ? `<div class="xd-line ${converted ? 'small' : ''}"><span ${converted ? 'class="muted"' : ''} title="Not billed yet: the card's limit it still holds${converted ? '. Left out of the available credit' : ''}">${converted ? 'Limit held' : 'Blocked'}</span><b class="mono ${num(p.blocked) ? 'neg' : ''}">${money(p.blocked)}</b></div>
                    <div class="xd-line small"><span class="muted">Billed, to pay into the card${p.toPay ? ` (${p.toPay})` : ''}</span><b class="mono ${num(p.billedToPay) ? 'neg' : ''}">${money(p.billedToPay)}</b></div>
                    ${converted ? '' : `<div class="xd-line small"><span class="muted">Principal still to repay</span><span class="mono">${money(p.outstanding)}</span></div>`}`
                    : `<div class="xd-line"><span>Principal</span><b class="mono ${num(p.outstanding) ? 'neg' : ''}">${money(p.outstanding)}</b></div>
                    <div class="xd-line small"><span class="muted">Held in</span><span class="ellipsis">${esc(p.liabilityAccountName || '')}</span></div>`}
                <div class="xd-line small"><span class="muted">Still to pay (with interest)</span><b class="mono">${money(p.stillToPay)}</b></div>
                <div class="xd-line small"><span class="muted">Interest still to come</span><span class="mono">${money(p.interestLeft)}</span></div>
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon('receipt')}What it costs</div>
                <div class="xd-line small"><span class="muted">Price</span><span class="mono">${money(p.principal)}</span></div>
                <div class="xd-line small"><span class="muted">Interest${num(p.gstTotal) ? ' + GST' : ''}</span><span class="mono">${money(num(p.interestTotal) + num(p.gstTotal))}</span></div>
                ${num(p.processingFee) ? `<div class="xd-line small"><span class="muted">Processing fee</span><span class="mono">${money(p.processingFee)}</span></div>` : ''}
                ${num(p.feeGst) ? `<div class="xd-line small"><span class="muted">GST on the fee (${num(p.feeGstPercent)}%)</span><span class="mono">${money(p.feeGst)}</span></div>` : ''}
                <div class="xd-line"><span>Total</span><b class="mono">${money(p.totalPayable)}</b></div>
                <div class="xd-line small"><span class="muted">Paid so far</span><span class="mono">${money(p.paidSoFar)}</span></div>
            </div>
        </div>
        <div class="emi-sched scroll">
            <table class="grid dense"><thead><tr><th>#</th><th>Due</th><th class="r">EMI</th><th class="r">Principal</th><th class="r">Interest</th>${num(p.gstTotal) ? '<th class="r">GST</th>' : ''}<th class="r">${converted ? 'Limit held after' : card ? 'Blocked after' : 'Owed after'}</th><th>Status</th><th></th></tr></thead>
            <tbody>${p.installments.map(i => {
                const [tone, label] = STATUS[i.status] || ['', i.status];
                const isNext = next && i.id === next.id;
                const status = i.status === 'PAID' ? `<span class="badge good" title="${esc([i.entryNo, i.paymentEntryNo].filter(Boolean).join(' · '))}">${icon('check')}${card ? 'paid ' : ''}${shortDate(i.paidOn)}</span>`
                    : i.status === 'BILLED' ? `<span class="badge ${i.overdue ? 'critical' : 'warning'}" title="${esc(i.entryNo || 'Billed on the card')}">${icon(i.overdue ? 'alert' : 'receipt')}billed ${shortDate(i.billedOn)}</span>`
                    : i.overdue ? `<span class="badge critical">${icon('alert')}Overdue</span>` : `<span class="badge ${tone}">${label}</span>`;
                return `<tr class="${i.status === 'PAID' ? 'emi-paid' : i.status === 'WAIVED' ? 'emi-waived' : i.overdue ? 'emi-late' : ''} ${isNext ? 'emi-next' : ''}">
                    <td>${i.seq}</td><td class="nowrap">${date(i.dueDate)}</td><td class="r"><b>${money(num(i.emi) + num(i.gst))}</b>${i.scheduledAmount != null ? `<span class="emi-edited" title="Changed to match the statement. The schedule said ${money(i.scheduledAmount)}">${icon('edit')}</span>` : ''}</td>
                    <td class="r">${money(i.principal)}</td><td class="r muted">${money(i.interest)}</td>${num(p.gstTotal) ? `<td class="r muted">${money(i.gst)}</td>` : ''}
                    <td class="r">${money(i.balanceAfter)}</td><td class="nowrap">${status}</td>
                    <td class="r">${card && manage && active && i.status === 'BILLED' ? `<button class="btn xs ghost" data-emi="edit-bill" data-id="${i.id}" title="Change what was billed, to match the statement">${icon('edit')}Amount</button>` : ''}
                        ${isNext && manage && active ? `<button class="btn xs" data-emi="pay" data-count="1">${icon(card ? 'arrow-in' : 'check')}${card ? 'Pay into card' : 'Pay'}</button>` : ''}</td></tr>`;
            }).join('')}</tbody></table>
        </div>
        ${p.notes ? `<div class="xd-note">${icon('info')}<span>${esc(p.notes)}</span></div>` : ''}
        <div class="xp-evidence" data-ev-entry="${p.purchaseEntryId}" data-ev-count="0"></div>
    </div>`;
}

export function bindEmiPanel(el, p, { onChanged, onEdit } = {}) {
    el.addEventListener('click', async e => {
        const b = e.target.closest('[data-emi]');
        if (!b || b.matches('input')) return;
        e.stopPropagation();
        const act = b.dataset.emi;
        try {
            if (act === 'pay') await openPayDialog(p, Number(b.dataset.count) || 1, onChanged);
            if (act === 'bill') openBillDialog(p, p.next, onChanged);
            if (act === 'edit-bill') openBillDialog(p, p.installments.find(i => i.id === Number(b.dataset.id)), onChanged);
            if (act === 'settle') {
                await api.post(`/expenses/emis/${p.id}/settle`, { count: 1 });
                toast(`EMI ${p.next.seq} paid: ${money(p.next.principal)} off ${p.payableAccountName}`);
                onChanged?.();
            }
            if (act === 'foreclose') await openForecloseDialog(p, onChanged);
            if (act === 'edit') onEdit?.(p);
            if (act === 'undo' && await confirmDialog(p.status === 'FORECLOSED'
                ? `Undo paying off ${p.narration} early? Its payoff entry is removed and the EMIs left are due again.`
                : `Undo the last EMI ${p.kind === 'CARD' ? 'billed or paid into the card' : 'paid'} on ${p.narration}? Its entry is removed.`, { confirmLabel: 'Undo', danger: false })) {
                await api.post(`/expenses/emis/${p.id}/undo`);
                toast('Undone');
                onChanged?.();
            }
            if (act === 'close' && await confirmDialog(`Close ${p.narration}? It is put away${p.liabilityAccountName ? ' and its account hidden' : ''}; "Show closed" brings it back, and it can be re-opened.`, { confirmLabel: 'Close', danger: false })) {
                await api.post(`/expenses/emis/${p.id}/close`);
                toast(`${p.narration} closed`);
                onChanged?.();
            }
            if (act === 'reopen') {
                await api.post(`/expenses/emis/${p.id}/reopen`);
                toast(`${p.narration} re-opened`);
                onChanged?.();
            }
            if (act === 'delete' && await confirmDialog(`Delete the EMI plan for ${p.narration}? The purchase (${money(p.principal)})${p.liabilityAccountName ? ' and its loan account go' : ' goes'} with it.`)) {
                await api.del(`/expenses/emis/${p.id}`);
                toast('EMI plan deleted');
                onChanged?.();
            }
        } catch (err) { toast(err.message, 'error'); }
    });
    el.querySelector('input[data-emi="auto"]')?.addEventListener('change', async e => {
        try {
            const out = await api.put(`/expenses/emis/${p.id}/auto`, { autoPost: e.target.checked });
            const booked = out.paidCount + out.toPay - p.paidCount - p.toPay;
            toast(e.target.checked ? `EMIs ${p.kind === 'CARD' ? 'bill' : 'pay'} themselves${booked > 0 ? ` · ${booked} booked now` : ''}` : 'EMIs are recorded by hand now');
            onChanged?.();
        } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
    });
}

/** Accounts money is paid from: a bank, cash or wallet (a loan EMI may also be paid with a card). */
async function fromAccounts(p) {
    const all = await loadAccounts();
    return all.filter(a => a.active && (p.kind === 'CARD' ? ['BANK', 'CASH', 'WALLET'] : ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD']).includes(a.accountType)
        && a.id !== (p.kind === 'CARD' ? p.payAccountId : null));
}

const accountSelect = (list, selected) => list.map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''} data-meta="${esc(`${a.typeLabel} · ${moneyShort(a.balance)}`)}">${esc(a.name)}</option>`).join('');

/** The statement's figures for an EMI: the total, and what makes it up. Changing the total changes the interest. */
function figuresHtml(i, lockPrincipal) {
    return `<div class="span-2 emi-figures">
        <label class="field emi-fig-total"><span>Amount on the statement</span><input name="total" type="number" class="num" step="0.01" min="0" value="${r2(num(i.principal) + num(i.interest) + num(i.gst))}" data-plain></label>
        <label class="field"><span>Principal</span><input name="principal" type="number" class="num" step="0.01" min="0" value="${num(i.principal)}" ${lockPrincipal ? 'readonly title="Charged with the purchase on this older plan"' : ''} data-plain></label>
        <label class="field"><span>Interest</span><input name="interest" type="number" class="num" step="0.01" min="0" value="${num(i.interest)}" data-plain></label>
        <label class="field"><span>GST</span><input name="gst" type="number" class="num" step="0.01" min="0" value="${num(i.gst)}" data-plain></label>
        <p class="hint emi-fig-note" data-fig-note></p>
    </div>`;
}

function bindFigures(form, i, last) {
    const planned = i.scheduledAmount != null ? num(i.scheduledAmount) : r2(num(i.principal) + num(i.interest) + num(i.gst));
    const note = () => {
        const diff = r2(num(form.total.value) - planned);
        const moved = r2(num(i.principal) - num(form.principal.value));
        form.querySelector('[data-fig-note]').textContent = [
            diff ? `${diff > 0 ? `${money(diff)} more` : `${money(-diff)} less`} than the schedule's ${money(planned)}.` : `As the schedule says.`,
            moved && !last ? `The ${money(Math.abs(moved))} of principal ${moved > 0 ? 'moves to' : 'comes off'} the last EMI, so the plan still repays what was financed.` : '',
        ].filter(Boolean).join(' ');
    };
    form.total.addEventListener('input', () => {
        form.interest.value = r2(Math.max(0, num(form.total.value) - num(form.principal.value) - num(form.gst.value)));
        note();
    });
    [form.principal, form.interest, form.gst].forEach(el => el.addEventListener('input', () => {
        form.total.value = r2(num(form.principal.value) + num(form.interest.value) + num(form.gst.value));
        note();
    }));
    note();
}

const figuresOf = f => ({ principal: num(f.principal.value), interest: num(f.interest.value), gst: num(f.gst.value) });
const sameFigures = (i, x) => r2(num(i.principal)) === r2(x.principal) && r2(num(i.interest)) === r2(x.interest) && r2(num(i.gst)) === r2(x.gst);

/** Bills the next EMI, or changes one billed: the amount as on the card's statement. */
function openBillDialog(p, i, onChanged) {
    const billed = i.status === 'BILLED';
    const today = isoDate();
    const dates = billed ? i.billedOn : (i.dueDate > today ? today : i.dueDate);
    const lastDue = p.installments.filter(x => x.status === 'DUE' && x.id !== i.id).length === 0;
    openModal({
        title: `${billed ? 'Change the bill of' : 'Bill'} EMI ${i.seq} of ${p.months}`, sub: `${p.narration} · on ${p.payAccountName}`, iconName: 'receipt',
        body: `<form class="form-grid two" onsubmit="return false">
            ${figuresHtml(i, !p.payableAccountId || lastDue)}
            <label class="field"><span>Billed on</span><input type="date" name="date" value="${dates}" min="${p.purchaseDate}"></label>
        </form>`,
        onOpen: m => bindFigures(m.el.querySelector('form'), i, lastDue),
        actions: [{ label: 'Cancel' }, { label: billed ? 'Save' : 'Bill it', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            await api.post(`/expenses/emis/${p.id}/bill`, { installmentId: i.id, date: f.date.value || null, ...figuresOf(f) });
            toast(`EMI ${i.seq} ${billed ? 'changed' : 'billed'} · ${money(num(f.total.value))} on ${p.payAccountName}`);
            onChanged?.();
        } }],
    });
}

/**
 * Pays the next `count` EMIs. A loan EMI from the bank; a card EMI is billed on the card (if not yet) and paid into
 * the card from the bank, or only billed (the card's bill is paid later). Each on its own due date, or on one date.
 */
async function openPayDialog(p, count, onChanged) {
    const accounts = await fromAccounts(p);
    const card = p.kind === 'CARD';
    const rows = p.installments.filter(i => i.status === 'DUE' || (card && i.status === 'BILLED')).slice(0, count);
    const total = rows.reduce((s, i) => s + num(i.emi) + num(i.gst), 0);
    const one = rows.length === 1;
    const lastBank = accounts.find(a => a.accountType === 'BANK')?.id;
    openModal({
        title: one ? `${card ? 'Pay EMI' : 'Pay EMI'} ${rows[0].seq} of ${p.months}${card ? ' into the card' : ''}` : `Pay ${rows.length} EMIs${card ? ' into the card' : ''}`, sub: p.narration, iconName: card ? 'card' : 'calendar',
        body: `<form class="form-grid two" onsubmit="return false">
            <div class="span-2 post-summary"><div class="row"><b>${rows.map(i => `EMI ${i.seq}${i.status === 'BILLED' ? ' (billed)' : ''}`).join(', ')}</b><span class="spacer"></span><b>${money(total)}</b></div>
                <div class="small muted">${card
                    ? p.payableAccountId ? `Billed in full on ${esc(p.payAccountName)} where not billed yet, then paid into it from the bank; ${money(rows.reduce((s, i) => s + num(i.principal), 0))} principal comes off ${esc(p.payableAccountName)}.`
                    : `Billed on ${esc(p.payAccountName)} (interest${rows.some(i => num(i.gst)) ? ' and GST' : ''} ${money(rows.filter(i => i.status === 'DUE').reduce((s, i) => s + num(i.interest) + num(i.gst), 0))} added where not billed yet), then paid into the card: frees ${money(rows.reduce((s, i) => s + num(i.principal), 0))} of its limit.`
                    : `${money(rows.reduce((s, i) => s + num(i.principal), 0))} principal off ${esc(p.liabilityAccountName || 'the loan')} · ${money(rows.reduce((s, i) => s + num(i.interest) + num(i.gst), 0))} interest under Loan Interest`}</div></div>
            ${card && one ? figuresHtml(rows[0], !p.payableAccountId || p.installments.filter(x => x.status === 'DUE' && x.id !== rows[0].id).length === 0) : ''}
            ${card ? `<label class="check-line span-2"><input type="checkbox" name="billOnly"> Only bill it on the card now (pay the card's bill later)</label>` : ''}
            <label class="field" data-from><span>${card ? 'Paid into the card from' : 'Paid from'}</span><select name="accountId">${accountSelect(accounts, card ? lastBank : p.payAccountId)}</select></label>
            <label class="field"><span>On</span><input type="date" name="date" value="${one ? (rows[0].dueDate > isoDate() ? isoDate() : rows[0].dueDate) : isoDate()}" max="${isoDate()}" min="${p.purchaseDate}"></label>
            ${one ? '' : `<label class="check-line span-2"><input type="checkbox" name="ownDates" checked> Each on its own due date (${rows.map(i => shortDate(i.dueDate)).join(', ')})</label>`}
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            f.billOnly?.addEventListener('change', () => { m.el.querySelector('[data-from]').hidden = f.billOnly.checked; });
            if (card && one) bindFigures(f, rows[0], p.installments.filter(x => x.status === 'DUE' && x.id !== rows[0].id).length === 0);
        },
        actions: [{ label: 'Cancel' }, { label: card ? `Record ${money(total)}` : `Pay ${money(total)}`, kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            const billOnly = !!f.billOnly?.checked;
            const own = f.ownDates?.checked;
            if (!billOnly && !f.accountId.value) throw new Error(card ? 'Add a bank account to pay the card from' : 'Pick the account');
            // the statement's figures first: this bills the EMI (or changes its bill); paying it follows
            if (card && one && !sameFigures(rows[0], figuresOf(f))) {
                await api.post(`/expenses/emis/${p.id}/bill`, { installmentId: rows[0].id, date: rows[0].status === 'DUE' && f.date.value < rows[0].dueDate ? f.date.value : null, ...figuresOf(f) });
                if (billOnly) { toast(`EMI ${rows[0].seq} billed · ${money(num(f.total.value))}`); onChanged?.(); return; }
            }
            await api.post(`/expenses/emis/${p.id}/pay`, { count: rows.length, date: own ? null : f.date.value || null, accountId: billOnly ? null : Number(f.accountId.value) || null, billOnly });
            toast(billOnly ? `${one ? `EMI ${rows[0].seq}` : `${rows.length} EMIs`} billed on ${p.payAccountName}` : `${one ? `EMI ${rows[0].seq}` : `${rows.length} EMIs`} paid · ${money(card && one ? num(f.total.value) : total)}`);
            onChanged?.();
        } }],
    });
}

/** Pays off what is left: the principal still owed (a card's: still blocked) and a foreclosure charge. */
async function openForecloseDialog(p, onChanged) {
    const accounts = await fromAccounts(p);
    const card = p.kind === 'CARD';
    const owed = card ? num(p.blocked) : num(p.outstanding);
    const saves = num(p.interestLeft) + p.installments.filter(i => i.status === 'DUE').reduce((s, i) => s + num(i.gst), 0);
    openModal({
        title: `Pay off ${p.narration}`, sub: `${p.left} EMIs left · ${money(owed)} ${card ? (p.payableAccountId ? 'not billed yet' : 'blocked on the card') : 'principal'}`, iconName: 'flag',
        body: `<form class="form-grid two" onsubmit="return false">
            <label class="field"><span>On</span><input type="date" name="date" value="${isoDate()}" max="${isoDate()}" min="${p.purchaseDate}"></label>
            <label class="field"><span>${card ? (p.payableAccountId ? 'Paid from' : 'Paid into the card from') : 'Paid from'}</span><select name="accountId">
                ${card ? `<option value="${p.payAccountId}">Billed on the card (paid with its bill)</option>` : ''}${accountSelect(accounts, card ? accounts.find(a => a.accountType === 'BANK')?.id : p.payAccountId)}</select></label>
            <label class="field"><span>Foreclosure charges <small class="muted">with GST</small></span><input name="charges" type="number" class="num" step="any" min="0" placeholder="0" data-plain>
                <span class="chips">${[1, 2, 3].map(x => `<button type="button" class="date-chip" data-pct="${x}">${x}%</button>`).join('')}</span></label>
            <div class="field"><span>You pay</span><b class="emi-fc-total" data-total>${money(owed)}</b></div>
            <p class="span-2 hint" style="margin:0">${icon('trending-down')} Paying off now saves ${money(Math.round(saves))} of interest still to come${num(p.ratePercent) ? '' : ' (none: it is a no-cost EMI)'}; the charges go under Loan Interest.${card && num(p.billedToPay) ? ` ${money(p.billedToPay)} already billed is paid with the card's bill.` : ''}</p>
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const sync = () => { m.el.querySelector('[data-total]').textContent = money(owed + num(f.charges.value)); };
            f.charges.addEventListener('input', sync);
            f.addEventListener('click', e => { const c = e.target.closest('[data-pct]'); if (c) { f.charges.value = Math.round(owed * Number(c.dataset.pct) * 1.18) / 100; sync(); } });
        },
        actions: [{ label: 'Cancel' }, { label: 'Pay off', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            await api.post(`/expenses/emis/${p.id}/foreclose`, { date: f.date.value, accountId: Number(f.accountId.value) || null, charges: num(f.charges.value) || null });
            toast(`${p.narration} paid off`);
            onChanged?.();
        } }],
    });
}

/** The Expenses page's EMI panel: what is owed (and blocked on cards), this month's EMIs, the next one, what is due. */
export function emiSideHtml(book) {
    const s = book?.summary;
    const plans = (book?.plans || []).filter(p => p.status === 'ACTIVE' && !p.archived);
    if (!s || !plans.length) return emptyState('Nothing on EMI running. Add an expense and pick “On EMI”.', 'calendar');
    return `<div class="emi-side">
        <div class="xs-grid">
            <div class="clickable" data-emi-open><span>Still owed</span><b class="neg">${moneyShort(s.outstanding)}</b><small>${s.active} running${num(s.blocked) ? ` · ${moneyShort(s.blocked)} blocked on cards` : ''}</small></div>
            <div class="clickable" data-emi-open><span>This month</span><b>${moneyShort(s.thisMonth)}</b><small>${s.nextDue ? `next ${shortDate(s.nextDue)} · ${moneyShort(s.nextAmount)}` : 'nothing left'}</small></div>
        </div>
        ${s.dueNow ? `<div class="xp-claim-line ${num(s.overdue) ? 'warn' : ''}">${icon(num(s.overdue) ? 'alert' : 'clock')} ${s.dueNow} EMI${s.dueNow === 1 ? '' : 's'} to bill or pay${num(s.overdue) ? ` · ${money(s.overdue)} overdue` : ''}</div>` : ''}
        <div class="emi-side-list">${plans.slice(0, 5).map(p => `<button type="button" class="owed-row" data-emi-plan="${p.id}">
            <span class="chip-icon sm ${p.kind === 'CARD' ? 'coral' : 'violet'}">${icon(p.kind === 'CARD' ? 'card' : 'briefcase')}</span>
            <span class="grow min-0"><b class="ellipsis">${esc(p.narration)}</b><small class="muted">${p.paidCount}/${p.months} · ${money(num(p.emiAmount))}/month</small>
                <i class="xd-bar"><em style="width:${p.progressPercent}%"></em></i></span>
            <b class="mono">${moneyShort(p.outstanding)}</b></button>`).join('')}</div>
        ${num(s.interestLeft) ? `<div class="small muted">${icon('percent')} ${money(Math.round(num(s.interestLeft)))} of interest still to come</div>` : ''}
    </div>`;
}
