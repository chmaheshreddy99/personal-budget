/**
 * Things bought on EMI (Expenses › EMIs): the schedule maths (the same as the server's), a plan opened in place
 * (where it stands, the money, every instalment) with what can be done, and the dialogs for paying.
 *
 * A card EMI is charged on the card at once (it blocks the limit); each month its EMI is billed on the card (the
 * interest and GST charged), and paying it into the card from the bank frees that part of the limit. A loan EMI owes
 * an account of its own and each EMI is paid from the bank.
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
export function emiPreviewHtml({ principal, rate, months, gst, fee, first, kind }) {
    if (!(principal > 0) || !(months > 0)) return `<div class="emi-prev empty">${icon('calendar')}<span>Enter the price and the months: the EMI and its whole schedule show here.</span></div>`;
    const rows = emiSchedule(principal, rate, months, gst, first);
    const interest = rows.reduce((s, x) => s + x.interest, 0);
    const gstTotal = rows.reduce((s, x) => s + x.gst, 0);
    const total = principal + interest + gstTotal + num(fee);
    const last = rows[rows.length - 1];
    const card = kind === 'CARD';
    return `<div class="emi-prev">
        <div class="emi-prev-hero"><div><small>${num(rate) ? 'Monthly EMI' : 'No-cost EMI'}</small><b>${money(rows[0].emi + rows[0].gst)}</b></div>
            <span>${months} months${first ? ` · ${shortDate(first)} → ${shortDate(last.dueDate)}` : ''}</span></div>
        <div class="emi-prev-figs">
            <span><small>Price</small><b>${money(principal)}</b></span>
            <span><small>Interest</small><b class="${interest ? 'neg' : ''}">${money(r2(interest))}</b></span>
            ${gstTotal ? `<span><small>GST</small><b class="neg">${money(r2(gstTotal))}</b></span>` : ''}
            ${num(fee) ? `<span><small>Fee</small><b class="neg">${money(fee)}</b></span>` : ''}
            <span class="total"><small>You pay</small><b>${money(r2(total))}</b></span>
        </div>
        <div class="emi-prev-how">${icon('info')}<span>${card
            ? `<b>${money(principal)}</b> is charged on the card today and blocks its limit. Each month the EMI is billed on the card (its interest${gstTotal ? ' and GST' : ''} added); paying it into the card frees that part of the limit.`
            : `<b>${money(principal)}</b> is spent today and owed to the lender (an EMI loan account, hidden from the accounts list). Each EMI is paid from the account picked: principal off the loan, interest under Loan Interest.`}</span></div>
        <div class="emi-table scroll"><table><thead><tr><th>#</th><th>Due</th><th class="r">EMI</th><th class="r">Principal</th><th class="r">Interest${gstTotal ? ' + GST' : ''}</th><th class="r">${card ? 'Blocked after' : 'Owed after'}</th></tr></thead>
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
            ${active ? fact(p.autoPost ? 'repeat' : 'hand', p.autoPost ? (card ? 'bills itself' : 'pays itself') : 'by hand', p.autoPost ? `Each EMI is ${card ? 'billed on the card' : 'paid'} on its due date` : 'Record each EMI yourself') : ''}
            <span class="spacer"></span>
            <span class="xd-actions">
                ${active && next ? (card
                    ? `${next.status === 'DUE' ? btn('bill', 'receipt', `Bill EMI ${next.seq}`, '', `title="Bill it on the card: its interest${num(next.gst) ? ' and GST' : ''} added, ${money(nextAmt)} to pay"`) : ''}
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
                ${card ? `<div class="xd-line"><span title="Charged with the purchase, not billed yet: the card's limit it still holds">Blocked</span><b class="mono ${num(p.blocked) ? 'neg' : ''}">${money(p.blocked)}</b></div>
                    <div class="xd-line small"><span class="muted">Billed, to pay into the card${p.toPay ? ` (${p.toPay})` : ''}</span><b class="mono ${num(p.billedToPay) ? 'neg' : ''}">${money(p.billedToPay)}</b></div>
                    <div class="xd-line small"><span class="muted">Principal still to repay</span><span class="mono">${money(p.outstanding)}</span></div>`
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
                <div class="xd-line"><span>Total</span><b class="mono">${money(p.totalPayable)}</b></div>
                <div class="xd-line small"><span class="muted">Paid so far</span><span class="mono">${money(p.paidSoFar)}</span></div>
            </div>
        </div>
        <div class="emi-sched scroll">
            <table class="grid dense"><thead><tr><th>#</th><th>Due</th><th class="r">EMI</th><th class="r">Principal</th><th class="r">Interest</th>${num(p.gstTotal) ? '<th class="r">GST</th>' : ''}<th class="r">${card ? 'Blocked after' : 'Owed after'}</th><th>Status</th><th></th></tr></thead>
            <tbody>${p.installments.map(i => {
                const [tone, label] = STATUS[i.status] || ['', i.status];
                const isNext = next && i.id === next.id;
                const status = i.status === 'PAID' ? `<span class="badge good" title="${esc([i.entryNo, i.paymentEntryNo].filter(Boolean).join(' · '))}">${icon('check')}${card ? 'paid ' : ''}${shortDate(i.paidOn)}</span>`
                    : i.status === 'BILLED' ? `<span class="badge ${i.overdue ? 'critical' : 'warning'}" title="${esc(i.entryNo || 'Billed on the card')}">${icon(i.overdue ? 'alert' : 'receipt')}billed ${shortDate(i.billedOn)}</span>`
                    : i.overdue ? `<span class="badge critical">${icon('alert')}Overdue</span>` : `<span class="badge ${tone}">${label}</span>`;
                return `<tr class="${i.status === 'PAID' ? 'emi-paid' : i.status === 'WAIVED' ? 'emi-waived' : i.overdue ? 'emi-late' : ''} ${isNext ? 'emi-next' : ''}">
                    <td>${i.seq}</td><td class="nowrap">${date(i.dueDate)}</td><td class="r"><b>${money(num(i.emi) + num(i.gst))}</b></td>
                    <td class="r">${money(i.principal)}</td><td class="r muted">${money(i.interest)}</td>${num(p.gstTotal) ? `<td class="r muted">${money(i.gst)}</td>` : ''}
                    <td class="r">${money(i.balanceAfter)}</td><td class="nowrap">${status}</td>
                    <td class="r">${isNext && manage && active ? `<button class="btn xs" data-emi="pay" data-count="1">${icon(card ? 'arrow-in' : 'check')}${card ? 'Pay into card' : 'Pay'}</button>` : ''}</td></tr>`;
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
            if (act === 'bill') {
                await api.post(`/expenses/emis/${p.id}/pay`, { count: 1, billOnly: true });
                toast(`EMI ${p.next.seq} billed on ${p.payAccountName}`);
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
                    ? `Billed on ${esc(p.payAccountName)} (interest${rows.some(i => num(i.gst)) ? ' and GST' : ''} ${money(rows.filter(i => i.status === 'DUE').reduce((s, i) => s + num(i.interest) + num(i.gst), 0))} added where not billed yet), then paid into the card: frees ${money(rows.reduce((s, i) => s + num(i.principal), 0))} of its limit.`
                    : `${money(rows.reduce((s, i) => s + num(i.principal), 0))} principal off ${esc(p.liabilityAccountName || 'the loan')} · ${money(rows.reduce((s, i) => s + num(i.interest) + num(i.gst), 0))} interest under Loan Interest`}</div></div>
            ${card ? `<label class="check-line span-2"><input type="checkbox" name="billOnly"> Only bill it on the card now (pay the card's bill later)</label>` : ''}
            <label class="field" data-from><span>${card ? 'Paid into the card from' : 'Paid from'}</span><select name="accountId">${accountSelect(accounts, card ? lastBank : p.payAccountId)}</select></label>
            <label class="field"><span>On</span><input type="date" name="date" value="${one ? (rows[0].dueDate > isoDate() ? isoDate() : rows[0].dueDate) : isoDate()}" max="${isoDate()}" min="${p.purchaseDate}"></label>
            ${one ? '' : `<label class="check-line span-2"><input type="checkbox" name="ownDates" checked> Each on its own due date (${rows.map(i => shortDate(i.dueDate)).join(', ')})</label>`}
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            f.billOnly?.addEventListener('change', () => { m.el.querySelector('[data-from]').hidden = f.billOnly.checked; });
        },
        actions: [{ label: 'Cancel' }, { label: card ? `Record ${money(total)}` : `Pay ${money(total)}`, kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            const billOnly = !!f.billOnly?.checked;
            const own = f.ownDates?.checked;
            if (!billOnly && !f.accountId.value) throw new Error(card ? 'Add a bank account to pay the card from' : 'Pick the account');
            await api.post(`/expenses/emis/${p.id}/pay`, { count: rows.length, date: own ? null : f.date.value || null, accountId: billOnly ? null : Number(f.accountId.value) || null, billOnly });
            toast(billOnly ? `${one ? `EMI ${rows[0].seq}` : `${rows.length} EMIs`} billed on ${p.payAccountName}` : `${one ? `EMI ${rows[0].seq}` : `${rows.length} EMIs`} paid · ${money(total)}`);
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
        title: `Pay off ${p.narration}`, sub: `${p.left} EMIs left · ${money(owed)} ${card ? 'blocked on the card' : 'principal'}`, iconName: 'flag',
        body: `<form class="form-grid two" onsubmit="return false">
            <label class="field"><span>On</span><input type="date" name="date" value="${isoDate()}" max="${isoDate()}" min="${p.purchaseDate}"></label>
            <label class="field"><span>${card ? 'Paid into the card from' : 'Paid from'}</span><select name="accountId">
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
