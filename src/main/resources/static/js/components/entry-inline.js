/**
 * Inline (expanded-row) view of a journal entry: shown directly under the clicked table row
 * instead of in a popup. A compact strip: debit and credit postings as pills, then one line of
 * facts (entry, date, party, who posted it) with the actions that apply.
 *
 * Only manual journal vouchers can be edited or deleted here. Entries posted automatically by a
 * feature (an expense, a transfer, a chit payment, money lent ...) simply offer no edit buttons;
 * they link to the screen that manages them, and offer "Reverse" where a correcting entry is the fix.
 * An entry of money lent or borrowed (the loan, a repayment, a month of interest) shows only what it is within
 * that item and a link to the item in Expenses, where it is managed.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, toast, confirmDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { openJournalEditor } from './transaction-forms.js';
import { claimEntryRole, claimFiguresHtml, claimBadge, KIND_META } from './claim-panel.js';

const MANAGE_LABEL = { expenses: 'Open Expenses', chits: 'Open Chits', accounts: 'Open Accounts' };

/**
 * Toggles the detail row under `row`.
 * entry: the entry with lines, or null to fetch it by row.dataset.entry.
 * onChanged: called after any change so the caller can reload.
 */
export async function toggleEntryRow(row, entry, { onChanged } = {}) {
    const next = row.nextElementSibling;
    if (next?.classList.contains('detail-row')) {
        next.remove();
        row.classList.remove('expanded');
        return;
    }
    // only one expanded row at a time
    row.parentElement.querySelectorAll('tr.detail-row').forEach(r => r.remove());
    row.parentElement.querySelectorAll('tr.expanded').forEach(r => r.classList.remove('expanded'));

    const data = entry?.lines ? entry : await api.get(`/transactions/${entry?.id || row.dataset.entry}`);
    const claim = data.claimId ? await api.get(`/claims/${data.claimId}`) : null;
    const detail = document.createElement('tr');
    detail.className = 'detail-row';
    detail.innerHTML = `<td colspan="${row.children.length}">${claim ? claimEntryHtml(data, claim) : detailHtml(data)}</td>`;
    row.after(detail);
    row.classList.add('expanded');

    detail.addEventListener('click', async e => {
        const btn = e.target.closest('[data-entry-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.entryAction;
        try {
            if (action === 'edit') openJournalEditor({ entry: data, onSaved: onChanged });
            if (action === 'copy') openJournalEditor({ entry: data, copy: true, onSaved: onChanged });
            if (action === 'close') toggleEntryRow(row, data);
            if (action === 'more') {
                const more = detail.querySelector('.ce-more');
                more.hidden = !more.hidden;
                btn.classList.toggle('active', !more.hidden);
                btn.querySelector('span').textContent = more.hidden ? 'More' : 'Less';
            }
            if (action === 'manage') location.hash = `#/${data.manageAt}`;
            if (action === 'delete' && await confirmDialog(`Delete ${data.entryNo}? Account balances will be recalculated.`)) {
                await api.del(`/transactions/${data.id}`);
                toast(`${data.entryNo} deleted`);
                onChanged?.();
            }
            if (action === 'reverse' && await confirmDialog(
                `Post a reversal of ${data.entryNo} dated today? It undoes the effect on every account while keeping both entries in the books.`,
                { title: 'Reverse entry', confirmLabel: 'Reverse', danger: false })) {
                const reversal = await api.post(`/transactions/${data.id}/reverse`);
                toast(`${data.entryNo} reversed by ${reversal.entryNo}`);
                onChanged?.();
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

/**
 * An entry of money lent or borrowed: one line saying what it is (the loan, a partial or final repayment with its
 * split and what is still owed, a month of interest), the item's status, and Details for the whole lifecycle in an
 * overlay. "More" shows the debit / credit lines, who recorded it and where the item stands.
 */
function claimEntryHtml(e, claim) {
    const role = claimEntryRole(claim, e.id) || { iconName: 'journal', title: e.voucherLabel, amount: e.amount, detail: e.narration };
    const meta = KIND_META[claim.kind] || KIND_META.LENT;
    const pill = (l, side) => `<span class="ed-pill ${side}"><small>${side === 'dr' ? 'Dr' : 'Cr'}</small><b class="ellipsis">${esc(l.accountName)}</b>
        <span class="mono">${money(side === 'dr' ? l.debit : l.credit, { decimals: 2 })}</span></span>`;
    return `
    <div class="entry-detail claim-entry">
        <div class="ce-main">
            <span class="chip-icon sm ${meta.tone}">${icon(role.iconName)}</span>
            <div class="grow min-0">
                <div class="row"><b>${esc(role.title)}</b><b class="mono">${money(role.amount)}</b>${claimBadge(claim)}
                    <span class="small muted ellipsis">${esc(claim.party)} · ${esc(claim.narration)}</span></div>
                <div class="small muted ellipsis">${esc(role.detail)}</div>
            </div>
            <button class="btn sm" data-claim-details="${claim.id}" data-highlight="${e.id}" title="The whole lifecycle and interest, right here">${icon('info')}Details</button>
            <button class="btn sm ghost" data-entry-action="more" title="Journal lines and where the item stands">${icon('chevron-down')}<span>More</span></button>
            <button class="btn sm ghost icon" data-entry-action="close" title="Close">${icon('x')}</button>
        </div>
        <div class="ce-more" hidden>
            <div class="ed-flow">
                <div class="ed-side">${e.lines.filter(l => Number(l.debit) > 0).map(l => pill(l, 'dr')).join('')}</div>
                <span class="ed-arrow">${icon('chevron-left')}</span>
                <div class="ed-side">${e.lines.filter(l => Number(l.credit) > 0).map(l => pill(l, 'cr')).join('')}</div>
            </div>
            <div class="small muted">${esc(e.entryNo)} · ${date(e.entryDate)} · recorded ${dateTime(e.createdAt)} by ${esc(e.createdBy)}</div>
            ${claimFiguresHtml(claim)}
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

function detailHtml(e) {
    const manageJournals = can('MANAGE_JOURNALS');
    const pill = (l, side) => `
        <span class="ed-pill ${side}" ${l.memo ? `title="${esc(l.memo)}"` : ''}>
            <small>${side === 'dr' ? 'Dr' : 'Cr'}</small><b class="ellipsis">${esc(l.accountName)}</b>
            <span class="mono">${money(side === 'dr' ? l.debit : l.credit, { decimals: 2 })}</span></span>`;
    const debits = e.lines.filter(l => Number(l.debit) > 0).map(l => pill(l, 'dr')).join('');
    const credits = e.lines.filter(l => Number(l.credit) > 0).map(l => pill(l, 'cr')).join('');
    const memos = e.lines.filter(l => l.memo).map(l => `<b>${esc(l.accountName)}:</b> ${esc(l.memo)}`);
    const fact = (iconName, html, cls = '') => `<span class="ed-fact ${cls}">${icon(iconName)}${html}</span>`;
    return `
    <div class="entry-detail">
        <div class="ed-flow">
            <div class="ed-side">${debits}</div>
            <span class="ed-arrow" title="Debit ← Credit">${icon('chevron-left')}</span>
            <div class="ed-side">${credits}</div>
        </div>
        <div class="ed-bar">
            ${fact('journal', `<b>${esc(e.entryNo)}</b> ${esc(e.voucherLabel)}`)}
            ${fact('calendar', date(e.entryDate))}
            ${e.party ? fact('user', esc(e.party)) : ''}
            ${e.reference ? fact('tag', esc(e.reference)) : ''}
            ${fact('history', `recorded ${dateTime(e.createdAt)} by ${esc(e.createdBy)}`, 'muted')}
            ${e.reversedBy ? fact('undo', `reversed by ${esc(e.reversedBy)}`, 'warn') : ''}
            ${e.reversalOf ? fact('undo', `reverses ${esc(e.reversalOf)}`) : ''}
            ${memos.length ? fact('info', memos.join(' · '), 'memo') : ''}
            <span class="spacer"></span>
            ${manageJournals && e.editable ? `<button class="btn sm" data-entry-action="edit">${icon('edit')}Edit</button>` : ''}
            ${manageJournals && e.editable ? `<button class="btn sm ghost icon" data-entry-action="copy" title="Duplicate">${icon('copy')}</button>` : ''}
            ${manageJournals && e.editable ? `<button class="btn sm ghost icon danger" data-entry-action="delete" title="Delete">${icon('trash')}</button>` : ''}
            ${e.manageAt && !e.claimId && !location.hash.startsWith(`#/${e.manageAt}`) ? `<button class="btn sm" data-entry-action="manage">${icon('link')}${MANAGE_LABEL[e.manageAt] || 'Open'}</button>` : ''}
            ${e.reversible && can('POST_TRANSACTIONS') ? `<button class="btn sm" data-entry-action="reverse">${icon('undo')}Reverse</button>` : ''}
            <button class="btn sm ghost icon" data-entry-action="close" title="Close">${icon('x')}</button>
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}
