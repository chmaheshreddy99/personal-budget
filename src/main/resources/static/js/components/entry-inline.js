/**
 * Inline (expanded-row) view of a journal entry: shown directly under the clicked table row
 * instead of in a popup. A compact strip: debit and credit postings as pills, then one line of
 * facts (entry, date, party, who posted it) with the actions that apply.
 *
 * Only manual journal vouchers and transfers can be edited or deleted here (a transfer with its own editor). Entries
 * posted automatically by a feature (an expense, a chit payment, money lent ...) simply offer no edit buttons;
 * they link to the screen that manages them, and offer "Reverse" where a correcting entry is the fix.
 * An entry of money lent or borrowed (the loan, a repayment, a month of interest) shows only what it is within
 * that item and a link to the item in Expenses, where it is managed.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, toast, confirmDialog, narrativeHtml } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { chitTrailChips, chitTrailHtml } from '../core/chit-trail.js';
import { openJournalEditor, openTransferEditor, isEditableTransfer, openIncomeEditor, isEditableIncome } from './transaction-forms.js';
import { claimEntryRole, claimFiguresHtml, claimBadge, KIND_META } from './claim-panel.js';

const MANAGE_LABEL = { expenses: 'Open Expenses', chits: 'Open Chits', 'host-chits': 'Open Host a Chit', 'host-chits/accounts': 'Open Chit accounts', accounts: 'Open Accounts',
    construction: 'Open Construction', 'expenses/emi': 'Open EMIs' };

/**
 * The route that opens this very entry where it is managed, not just the page: the expense (or the expense a refund
 * belongs to) in Expenses, the plan of an EMI entry, the chit and its installment or payout part, the hosted chit, the
 * account an opening balance is on, the construction project. Each page reads the id it is given and shows the entry
 * expanded and highlighted.
 */
export function entryRoute(e) {
    const line = test => e.lines?.find(test);
    switch (e.manageAt) {
        case 'expenses':
            if (e.claimId) return `expenses/claim/${e.claimId}`;
            return `expenses/entry/${e.sourceType === 'EXPENSE_REFUND' && e.sourceId ? e.sourceId : e.id}`;
        case 'expenses/emi': return `expenses/emi-entry/${e.id}`;
        case 'chits': {
            const chitId = line(l => l.chitId)?.chitId;
            return chitId ? `chits/${chitId}/entry/${e.id}` : 'chits';
        }
        case 'host-chits': {
            const hosted = line(l => l.hostedChitId)?.hostedChitId;
            return hosted ? `host-chits/${hosted}` : 'host-chits';
        }
        case 'accounts': {
            const account = line(l => l.accountClass === 'ASSET' || l.accountClass === 'LIABILITY');
            return account ? `accounts/${account.accountId}/entry/${e.id}` : 'accounts';
        }
        case 'construction': return e.construction?.projectId ? `construction/${e.construction.projectId}` : 'construction';
        case 'host-chits/accounts': return e.manageAt;
        default:
            // managed nowhere else: an income from the quick entry opens on Income, the rest in the Day book
            return e.voucherType === 'INCOME' && e.sourceType === 'QUICK' ? `income/entry/${e.id}` : `transactions/entry/${e.id}`;
    }
}

/** A link to an entry from anywhere (a report, a list, a search): #/entry/<id> opens it where it is managed. */
export const entryHref = id => `#/entry/${id}`;
/** The page an entry is managed on (the button is not shown there): a construction entry's own project. */
const manageTarget = e => e.manageAt === 'construction' && e.construction?.projectId ? `construction/${e.construction.projectId}` : e.manageAt;

/**
 * Brings an entry's row into view on a page that was opened for it: waits for the row to be drawn (lists load in
 * steps), scrolls it to the middle, expands it and highlights it for a moment. Resolves false when the row never shows
 * (the entry is outside what the page lists).
 */
export function focusEntryRow(root, entryId, { onChanged, expand = true, timeout = 5000 } = {}) {
    return new Promise(resolve => {
        const find = () => root.querySelector(`tr[data-entry="${entryId}"]`);
        const go = tr => {
            tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
            tr.classList.add('flash');
            setTimeout(() => tr.classList.remove('flash'), 2600);
            if (expand && !tr.classList.contains('expanded')) toggleEntryRow(tr, null, { onChanged });
            resolve(true);
        };
        const now = find();
        if (now) { go(now); return; }
        const watch = new MutationObserver(() => {
            const tr = find();
            if (tr) { watch.disconnect(); clearTimeout(timer); go(tr); }
        });
        watch.observe(root, { childList: true, subtree: true });
        const timer = setTimeout(() => { watch.disconnect(); resolve(false); }, timeout);
    });
}

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
            if (action === 'edit-transfer') openTransferEditor({ entry: data, onSaved: onChanged });
            if (action === 'delete-transfer' && await confirmDialog(`Delete transfer ${data.entryNo} of ${money(data.amount)}? Both account balances are recalculated.`)) {
                await api.del(`/transactions/${data.id}/transfer`);
                toast(`${data.entryNo} deleted`);
                onChanged?.();
            }
            if (action === 'copy') openJournalEditor({ entry: data, copy: true, onSaved: onChanged });
            if (action === 'close') toggleEntryRow(row, data);
            if (action === 'more') {
                const more = detail.querySelector('.ce-more');
                more.hidden = !more.hidden;
                btn.classList.toggle('active', !more.hidden);
                btn.querySelector('span').textContent = more.hidden ? 'More' : 'Less';
            }
            if (action === 'manage') location.hash = `#/${entryRoute(data)}`;
            if (action === 'edit-income') openIncomeEditor({ entry: data, onSaved: onChanged });
            if (action === 'delete-income' && await confirmDialog(`Delete income ${data.entryNo} of ${money(data.amount)}? The account balance is recalculated.`)) {
                await api.del(`/transactions/${data.id}/income`);
                toast(`${data.entryNo} deleted`);
                onChanged?.();
            }
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
            ${balancesHtml(e.lines)}
            <div class="small muted">${esc(e.entryNo)} · ${date(e.entryDate)} · recorded ${dateTime(e.createdAt)} by ${esc(e.createdBy)}</div>
            ${claimFiguresHtml(claim)}
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

/**
 * Each account the entry touches, with its balance just before and just after this entry (the stored snapshots,
 * in ledger order): one slim line per account, the amounts being in the pills above.
 */
function balancesHtml(lines) {
    const shown = lines.filter(l => l.balanceAfter !== null && l.balanceAfter !== undefined);
    if (!shown.length) return '';
    return `<div class="ed-balances" title="Each account's balance just before and just after this entry">
        <span class="edb-head">Balance</span>${shown.map(l => {
            const move = Number(l.balanceAfter) - Number(l.balanceBefore);
            return `<span class="edb-row"><span class="edb-name ellipsis" title="${esc(l.ledgerAccountName || l.accountName)}">${esc(l.accountName)}</span>
                <span class="edb-before">${money(l.balanceBefore, { decimals: 2 })}</span><i>→</i><b>${money(l.balanceAfter, { decimals: 2 })}</b>
                <em class="${move > 0 ? 'up' : move < 0 ? 'down' : ''}">${move > 0 ? '▲' : move < 0 ? '▼' : ''}</em></span>`;
        }).join('')}</div>`;
}

function detailHtml(e) {
    const manageJournals = can('MANAGE_JOURNALS');
    const transfer = isEditableTransfer(e) && can('POST_TRANSACTIONS');
    const income = isEditableIncome(e) && can('POST_TRANSACTIONS');
    const pill = (l, side) => `
        <span class="ed-pill ${side}" ${l.memo ? `title="${esc(l.memo)}"` : ''}>
            <small>${side === 'dr' ? 'Dr' : 'Cr'}</small><b class="ellipsis">${esc(l.accountName)}</b>
            <span class="mono">${money(side === 'dr' ? l.debit : l.credit, { decimals: 2 })}</span></span>`;
    const debits = e.lines.filter(l => Number(l.debit) > 0).map(l => pill(l, 'dr')).join('');
    const credits = e.lines.filter(l => Number(l.credit) > 0).map(l => pill(l, 'cr')).join('');
    const memos = e.lines.filter(l => l.memo).map(l => `<b>${esc(l.accountName)}:</b> ${narrativeHtml(l.memo)}`);
    const fact = (iconName, html, cls = '') => `<span class="ed-fact ${cls}">${icon(iconName)}${html}</span>`;
    return `
    <div class="entry-detail">
        <div class="ed-flow">
            <div class="ed-side">${debits}</div>
            <span class="ed-arrow" title="Debit ← Credit">${icon('chevron-left')}</span>
            <div class="ed-side">${credits}</div>
        </div>
        ${balancesHtml(e.lines)}
        ${chitTrailHtml(e.chitTrail)}
        <div class="ed-bar">
            ${fact('journal', `<b>${esc(e.entryNo)}</b> ${esc(e.voucherLabel)}`)}
            ${e.construction ? fact('hard-hat', `Construction · <b>${esc(e.construction.project)}</b>${e.construction.what ? ` · ${esc(e.construction.what)}` : ''}`, 'cn-fact') : ''}
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
            ${transfer ? `<button class="btn sm" data-entry-action="edit-transfer" title="Change the accounts, amount, date or details">${icon('edit')}Edit</button>
                <button class="btn sm ghost icon danger" data-entry-action="delete-transfer" title="Delete this transfer">${icon('trash')}</button>` : ''}
            ${income ? `<button class="btn sm" data-entry-action="edit-income" title="Change the source, account, amount, date or details">${icon('edit')}Edit</button>
                <button class="btn sm ghost icon danger" data-entry-action="delete-income" title="Delete this income">${icon('trash')}</button>` : ''}
            ${e.manageAt && !e.claimId && !location.hash.startsWith(`#/${manageTarget(e)}`) ? `<button class="btn sm" data-entry-action="manage">${icon('link')}${e.construction?.projectId && e.manageAt === 'construction' ? `Open ${esc(e.construction.project)}` : MANAGE_LABEL[e.manageAt] || 'Open'}</button>` : ''}
            ${e.reversible && can('POST_TRANSACTIONS') ? `<button class="btn sm" data-entry-action="reverse">${icon('undo')}Reverse</button>` : ''}
            <button class="btn sm ghost icon" data-entry-action="close" title="Close">${icon('x')}</button>
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}
