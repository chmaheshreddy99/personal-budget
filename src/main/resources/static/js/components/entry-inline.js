/**
 * Inline (expanded-row) view of a journal entry: shown directly under the clicked table row
 * instead of in a popup (its description is on the row itself). Drawn for the theme (core/theme.js):
 *   Classic  a compact strip: debit and credit pills, the balances, one line of facts with the actions
 *   Ocean    a head (the kind, entry number, amount, date, party and the actions that apply), the entry in one sentence
 *            (what happened to the money, where the accounts stand after it), then the postings, compact (From → To,
 *            a line each with its memo and share), beside the balances of the real accounts (before → after, in words)
 *            and what the books say about it (EntryInsightService): the category's month against its budget and the
 *            usual size, whether it repeats and when the next one is due, and a possible duplicate. Then who recorded it.
 *   Breeze   Classic's strip, its actions labelled and grouped by what they do; an entry of money lent or borrowed
 *            shown whole (this entry, where the item stands, its lifecycle) instead of behind "More"
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
import { kindChip } from '../core/entry-kind.js';
import { isOcean, isBreeze } from '../core/theme.js';
import { openJournalEditor, openTransferEditor, isEditableTransfer, openIncomeEditor, isEditableIncome } from './transaction-forms.js';
import { claimEntryRole, claimFiguresHtml, claimBadge, claimLifecycleHtml, claimHref, KIND_META } from './claim-panel.js';

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
    // Ocean: what the books say about it (its month, budget, the usual, repeats, a possible twin), filled in when known
    const insights = detail.querySelector('[data-ed-insights]');
    if (insights) loadInsights(insights, data.id, data.voucherType === 'INCOME').then(() => balanceHalves(detail));

    detail.addEventListener('click', async e => {
        // the folds of a lifecycle shown in the open entry (Breeze, money lent or borrowed)
        const more = e.target.closest('[data-tl-more]');
        if (more) { more.nextElementSibling.hidden = false; more.remove(); return; }
        const group = e.target.closest('[data-tl-toggle]');
        if (group) {
            const sub = group.querySelector('.tl-sub');
            sub.hidden = !sub.hidden;
            group.querySelector('.link-btn').textContent = sub.hidden ? 'show months' : 'hide months';
            return;
        }
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
    if (isBreeze()) return breezeClaimEntryHtml(e, claim, role, meta);
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
            ${isOcean() ? `${postingsHtml(e)}
            <div class="ed-foot">${icon('history')}<span><b>${esc(e.entryNo)}</b> · ${date(e.entryDate)} · recorded ${dateTime(e.createdAt)} by <b>${esc(e.createdBy)}</b></span></div>`
            : `${classicFlowHtml(e)}
            ${classicBalancesHtml(e.lines)}
            <div class="small muted">${esc(e.entryNo)} · ${date(e.entryDate)} · recorded ${dateTime(e.createdAt)} by ${esc(e.createdBy)}</div>`}
            ${claimFiguresHtml(claim)}
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

/**
 * Breeze: an entry of money lent or borrowed, all of it at once (no "More"): the head, then this entry (its lines,
 * the balances, who recorded it) beside where the item stands (how much is back, the figures), then the item's
 * lifecycle with this entry marked.
 */
function breezeClaimEntryHtml(e, claim, role, meta) {
    const paidPct = Math.min(100, Number(claim.repaidPercent) || 0);
    return `
    <div class="entry-detail claim-entry bz-claim">
        <div class="ce-main">
            <span class="chip-icon sm ${meta.tone}">${icon(role.iconName)}</span>
            <div class="grow min-0">
                <div class="row"><b>${esc(role.title)}</b><b class="mono">${money(role.amount)}</b>${claimBadge(claim)}
                    <span class="small muted ellipsis">${esc(claim.party)} · ${esc(claim.narration)}</span></div>
                <div class="small muted ellipsis">${esc(role.detail)}</div>
            </div>
            <span class="bz-acts">
                <span class="bz-group">
                    <button class="btn sm bz-act bz-manage" data-claim-details="${claim.id}" data-highlight="${e.id}" title="The whole item, with the interest month by month">${icon('info')}<span>Full details</span></button>
                    ${can('POST_TRANSACTIONS') ? `<a class="btn sm bz-act bz-edit" href="${claimHref(claim)}" title="Repay, post interest or change it in Expenses">${icon('edit')}<span>Manage</span></a>` : ''}
                </span>
                <button class="btn sm ghost icon bz-close" data-entry-action="close" title="Close">${icon('x')}</button>
            </span>
        </div>
        <div class="bz-claim-grid">
            <section class="bz-claim-card bz-tone-ocean">
                <div class="bz-card-head">${icon('journal')}This entry<span class="spacer"></span><b>${esc(e.entryNo)}</b></div>
                ${classicFlowHtml(e)}
                ${classicBalancesHtml(e.lines)}
                <div class="small muted">${date(e.entryDate)} · recorded ${dateTime(e.createdAt)} by ${esc(e.createdBy)}</div>
            </section>
            <section class="bz-claim-card bz-tone-aqua">
                <div class="bz-card-head">${icon(meta.iconName)}Where it stands<span class="spacer"></span><b>${Math.round(paidPct)}% ${esc(meta.repaid.toLowerCase())}</b></div>
                <div class="split-bar"><span class="seg paid" style="width:${paidPct}%"></span></div>
                ${claimFiguresHtml(claim)}
            </section>
            ${claim.timeline?.length ? `<section class="bz-claim-card bz-tone-violet bz-wide">
                <div class="bz-card-head">${icon('history')}Lifecycle</div>
                ${claimLifecycleHtml(claim, e.id)}
            </section>` : ''}
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}

/** The open entry in the chosen theme. */
const detailHtml = e => isOcean() ? oceanDetailHtml(e) : classicDetailHtml(e);

/**
 * The buttons that apply to the entry, in order: { action, iconName, label, title, kind, iconOnly }. kind groups them
 * in Breeze: edit / copy (change it), manage / reverse (go to it, undo it), delete.
 */
function entryActions(e) {
    const manageJournals = can('MANAGE_JOURNALS') && e.editable;
    const transfer = isEditableTransfer(e) && can('POST_TRANSACTIONS');
    const income = isEditableIncome(e) && can('POST_TRANSACTIONS');
    const manage = e.manageAt && !e.claimId && !location.hash.startsWith(`#/${manageTarget(e)}`);
    return [
        manageJournals && { action: 'edit', iconName: 'edit', label: 'Edit', kind: 'edit' },
        manageJournals && { action: 'copy', iconName: 'copy', label: 'Duplicate', title: 'Duplicate', kind: 'copy', iconOnly: true },
        manageJournals && { action: 'delete', iconName: 'trash', label: 'Delete', title: 'Delete', kind: 'delete', iconOnly: true },
        transfer && { action: 'edit-transfer', iconName: 'edit', label: 'Edit', title: 'Change the accounts, amount, date or details', kind: 'edit' },
        transfer && { action: 'delete-transfer', iconName: 'trash', label: 'Delete', title: 'Delete this transfer', kind: 'delete', iconOnly: true },
        income && { action: 'edit-income', iconName: 'edit', label: 'Edit', title: 'Change the source, account, amount, date or details', kind: 'edit' },
        income && { action: 'delete-income', iconName: 'trash', label: 'Delete', title: 'Delete this income', kind: 'delete', iconOnly: true },
        manage && { action: 'manage', iconName: 'link', label: e.construction?.projectId && e.manageAt === 'construction' ? `Open ${e.construction.project}` : MANAGE_LABEL[e.manageAt] || 'Open', kind: 'manage' },
        e.reversible && can('POST_TRANSACTIONS') && { action: 'reverse', iconName: 'undo', label: 'Reverse', breezeTitle: 'Post a correcting entry dated today; both entries stay in the books', kind: 'reverse' },
    ].filter(Boolean);
}

/**
 * The buttons that apply to the entry, ending with Close: in Breeze labelled and grouped (change it · go to it or undo
 * it · delete), each kind in its own brand tone; compact in the other themes.
 */
function actionsHtml(e) {
    const acts = entryActions(e);
    if (isBreeze()) {
        const title = a => a.breezeTitle || a.title;
        const button = a => `<button class="btn sm bz-act bz-${a.kind}" data-entry-action="${a.action}" ${title(a) ? `title="${esc(title(a))}"` : ''}>${icon(a.iconName)}<span>${esc(a.label)}</span></button>`;
        const group = kinds => {
            const html = acts.filter(a => kinds.includes(a.kind)).map(button).join('');
            return html ? `<span class="bz-group">${html}</span>` : '';
        };
        return `<span class="bz-acts">${group(['edit', 'copy'])}${group(['manage', 'reverse'])}${group(['delete'])}
            <button class="btn sm ghost icon bz-close" data-entry-action="close" title="Close">${icon('x')}</button></span>`;
    }
    const button = a => `<button class="btn sm${a.iconOnly ? ' ghost icon' : ''}${a.iconOnly && a.kind === 'delete' ? ' danger' : ''}" data-entry-action="${a.action}"${a.title ? ` title="${esc(a.title)}"` : ''}>${icon(a.iconName)}${a.iconOnly ? '' : esc(a.label)}</button>`;
    return `
            ${acts.map(button).join('')}
            <button class="btn sm ghost icon" data-entry-action="close" title="Close">${icon('x')}</button>
`;
}

/**
 * The postings as a small ledger: a label with the total, then one line each, credits ("From") first: a Cr / Dr tag, the
 * account and the ledger it sits in (for a category or a chit), its memo (cut to one line, whole on hover), the line's
 * share of the entry when there are several, and the amount.
 */
function postingsHtml(e) {
    const total = e.lines.reduce((s, l) => s + Number(l.debit || 0), 0) || 1;
    const many = e.lines.length > 2;
    const row = (l, side) => {
        const amount = Number(side === 'dr' ? l.debit : l.credit);
        const ledger = l.ledgerAccountName && l.ledgerAccountName !== l.accountName ? l.ledgerAccountName : '';
        const share = (amount / total) * 100;
        return `<div class="ed2-line ${side}">
            <span class="ed2-tag">${side === 'dr' ? 'Dr' : 'Cr'}</span>
            <span class="ed2-what"><b>${esc(l.accountName)}</b>${ledger ? `<small>${esc(ledger)}</small>` : ''}</span>
            <span class="ed2-memo" ${l.memo ? `title="${esc(l.memo)}"` : ''}>${l.memo ? narrativeHtml(l.memo) : ''}</span>
            ${many ? `<i class="ed2-share" title="${Math.round(share)}% of the entry"><em style="width:${Math.max(4, share)}%"></em></i>` : '<i></i>'}
            <b class="ed2-amt mono">${money(amount, { decimals: 2 })}</b>
        </div>`;
    };
    const credits = e.lines.filter(l => Number(l.credit) > 0), debits = e.lines.filter(l => Number(l.debit) > 0);
    return `<div class="ed2-post">
        <div class="ed2-label"><span>Postings</span><small>${e.lines.length} lines · from → to</small><b class="mono">${money(total, { decimals: 2 })}</b></div>
        ${credits.map(l => row(l, 'cr')).join('')}
        ${debits.map(l => row(l, 'dr')).join('')}
    </div>`;
}

/** A line of a real account (bank, card, cash, wallet, a loan): its balance means something, unlike the Expenses total. */
const isReal = l => (l.accountClass === 'ASSET' || l.accountClass === 'LIABILITY') && !l.categoryId && !l.chitId && !l.hostedChitId;
const listOf = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** The entry in one sentence: what happened to the money, and where the accounts stand after it. */
function storyHtml(e) {
    const debits = e.lines.filter(l => Number(l.debit) > 0), credits = e.lines.filter(l => Number(l.credit) > 0);
    const named = (ls, side) => listOf(ls.map(l => `<b>${esc(l.accountName)}</b>${ls.length > 1 ? ` ${money(side === 'dr' ? l.debit : l.credit)}` : ''}`));
    const amount = `<b>${money(e.amount)}</b>`;
    const party = e.party ? ` ${esc(e.party)}` : '';
    const all = (ls, test) => ls.length && ls.every(test);
    let what;
    if (all(debits, l => l.accountClass === 'EXPENSE') && all(credits, isReal)) {
        what = `Spent ${amount}${party ? ` at <b>${party.trim()}</b>` : ''} from ${named(credits, 'cr')} on ${named(debits, 'dr')}.`;
    } else if (all(debits, isReal) && all(credits, l => l.accountClass === 'INCOME')) {
        what = `Received ${amount} into ${named(debits, 'dr')} as ${named(credits, 'cr')}${party ? ` from <b>${party.trim()}</b>` : ''}.`;
    } else if (all(debits, l => isReal(l) && l.accountClass === 'LIABILITY') && all(credits, isReal)) {
        what = `Paid ${amount} towards ${named(debits, 'dr')} from ${named(credits, 'cr')}.`;
    } else if (all(debits, isReal) && all(credits, isReal)) {
        what = `Moved ${amount} from ${named(credits, 'cr')} to ${named(debits, 'dr')}.`;
    } else if (all(debits, l => l.chitId)) {
        const dividend = credits.filter(l => l.accountClass === 'INCOME');
        const paid = credits.filter(l => l.accountClass !== 'INCOME');
        what = `Put ${amount} into the chit ${named(debits, 'dr')}: ${paid.length ? `${listOf(paid.map(l => `<b>${money(l.credit)}</b> from <b>${esc(l.accountName)}</b>`))}` : ''}${dividend.length
            ? `${paid.length ? ' plus ' : ''}<b>${money(dividend.reduce((x, l) => x + Number(l.credit), 0))}</b> dividend (${listOf(dividend.map(l => esc(l.accountName)))})` : ''}.`;
    } else {
        what = `${amount} from ${named(credits, 'cr')} to ${named(debits, 'dr')}.`;
    }
    const after = e.lines.filter(l => isReal(l) && l.balanceAfter != null).slice(0, 2).map(l => {
        const v = Number(l.balanceAfter);
        if (l.accountClass === 'LIABILITY') return v > 0 ? `${esc(l.accountName)} now owes <b>${money(v)}</b>` : `${esc(l.accountName)} is clear`;
        return v < 0 ? `<span class="neg">${esc(l.accountName)} is overdrawn by <b>${money(-v)}</b></span>` : `${esc(l.accountName)} now holds <b>${money(v)}</b>`;
    });
    return `<p class="ed2-story">${icon('sparkles')}<span>${e.reversalOf ? `Reverses <b>${esc(e.reversalOf)}</b>: ` : ''}${what}${after.length ? ` ${listOf(after)}.` : ''}</span></p>`;
}

/** Each real account the entry touches: its balance before → after and the change, a row each. */
function balancesHtml(e) {
    const lines = e.lines.filter(l => isReal(l) && l.balanceAfter != null);
    const chits = e.lines.filter(l => l.chitId && l.chitBalanceAfter != null);
    if (!lines.length && !chits.length && !e.lines.some(l => l.categoryId && l.categoryBalanceAfter != null)) return '';
    // a chit's line: the chit by itself, then the Chit Funds account that holds all the chits
    const chitRows = chits.map(l => {
        const row = (iconName, name, note, before, after) => {
            const change = after - before;
            return `<div class="ed2-row">${icon(iconName)}
                <span class="ed2-row-main"><b>${esc(name)}</b><small>${note} <span class="mono">${money(Math.abs(after), { decimals: 0 })}</span> · was ${money(Math.abs(before), { decimals: 0 })}</small></span>
                <em class="ed2-delta ${change > 0 ? 'pos' : 'neg'}">${change > 0 ? '+' : '−'}${money(Math.abs(change), { decimals: 0 })}</em></div>`;
        };
        return row('chit', l.accountName, Number(l.chitBalanceAfter) < 0 ? 'this chit · dues' : 'this chit · paid in', Number(l.chitBalanceBefore), Number(l.chitBalanceAfter))
            + row('layers', l.ledgerAccountName, 'all chits · holds', Number(l.balanceBefore), Number(l.balanceAfter));
    }).join('');
    // each category the entry posts to, once: what it stands at now, and how much this entry added
    const categories = e.lines.filter(l => l.categoryId && l.categoryBalanceAfter != null);
    const seen = new Map();
    categories.forEach(l => {
        const c = seen.get(l.categoryId) || { name: l.accountName, income: l.accountClass === 'INCOME', before: Number(l.categoryBalanceBefore) };
        c.after = Number(l.categoryBalanceAfter);
        seen.set(l.categoryId, c);
    });
    const categoryRows = [...seen.values()].map(c => {
        const change = c.after - c.before;
        return `<div class="ed2-row">${icon('tag')}
            <span class="ed2-row-main"><b>${esc(c.name)}</b><small>category · ${c.income ? 'received' : 'spent'} <span class="mono">${money(Math.abs(c.after), { decimals: 0 })}</span> · was ${money(Math.abs(c.before), { decimals: 0 })}</small></span>
            <em class="ed2-delta ${(change > 0) === c.income ? 'pos' : 'neg'}">${change > 0 ? '+' : '−'}${money(Math.abs(change), { decimals: 0 })}</em></div>`;
    }).join('');
    return `<section class="ed2-sec ed2-balances"><div class="ed2-label"><span>Balances</span><small>after this entry</small></div>${chitRows}${lines.map(l => {
        const before = Number(l.balanceBefore), after = Number(l.balanceAfter), change = after - before;
        const owed = l.accountClass === 'LIABILITY';
        const what = owed ? (after > 0 ? 'owes' : 'clear') : after < 0 ? 'overdrawn' : 'holds';
        const good = owed ? change < 0 : change > 0;
        return `<div class="ed2-row ${!owed && after < 0 ? 'bad' : ''}">
            ${icon(owed ? 'card' : 'wallet')}
            <span class="ed2-row-main"><b>${esc(l.accountName)}</b><small>${what} <span class="mono">${money(Math.abs(after), { decimals: 0 })}</span> · was ${money(Math.abs(before), { decimals: 0 })}</small></span>
            <em class="ed2-delta ${good ? 'pos' : 'neg'}">${change > 0 ? '+' : '−'}${money(Math.abs(change), { decimals: 0 })}</em>
        </div>`;
    }).join('')}${categoryRows}</section>`;
}

/**
 * Ocean: evens out the two halves of an open entry. The postings and the details sit on the left, the balances and
 * insights on the right; while the left is taller by more than a row, the last row of detail tiles moves to a
 * details block at the foot of the right, so both halves end at about the same height.
 */
function balanceHalves(root) {
    const grid = root.querySelector('.ed2-grid'), main = root.querySelector('.ed2-main'), aside = root.querySelector('.ed2-aside');
    const tiles = main?.querySelector('.ed2-fact-grid');
    if (!grid || !tiles || !aside || getComputedStyle(grid).gridTemplateColumns.split(' ').length < 2) return;
    const natural = el => [...el.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0) + 8 * Math.max(0, el.children.length - 1);
    let more = aside.querySelector('.ed2-facts-more');
    if (!more) {
        aside.insertAdjacentHTML('beforeend', '<section class="ed2-facts ed2-facts-more"><div class="ed2-label"><span>More details</span></div><div class="ed2-fact-grid"></div></section>');
        more = aside.querySelector('.ed2-facts-more');
    }
    const target = more.querySelector('.ed2-fact-grid');
    for (let guard = 0; guard < 12 && tiles.children.length > 1; guard++) {
        const last = tiles.lastElementChild;
        const row = last.classList.contains('wide') || tiles.children.length % 2 === 1 ? [last] : [last.previousElementSibling, last];
        const h = last.getBoundingClientRect().height + 4;
        if (natural(main) - natural(aside) < h * 1.6) break;
        row.reverse().forEach(t => target.prepend(t));
    }
    if (!target.children.length) more.remove();
}

const MANAGED_IN = { expenses: 'Expenses', chits: 'Chits', 'host-chits': 'Host a Chit', 'host-chits/accounts': 'Chit accounts', accounts: 'Accounts',
    construction: 'Construction', 'expenses/emi': 'EMIs' };

/**
 * The entry's particulars under the postings, two to a row: when (with the weekday and how long ago), what kind, who it
 * was with, its reference, where it is managed, whether it balances, its evidence and who recorded it, and any link to
 * another entry (reversed by, reverses).
 */
function factsHtml(e) {
    const d = new Date(String(e.entryDate).slice(0, 10) + 'T00:00:00');
    const days = Math.round((new Date(new Date().toDateString()) - d) / 86400000);
    const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 45 ? `${days} days ago` : days < 545 ? `${Math.round(days / 30.4)} months ago` : `${(days / 365).toFixed(1)} years ago`;
    const debit = e.lines.reduce((s, l) => s + Number(l.debit || 0), 0), credit = e.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    const balanced = Math.abs(debit - credit) < 0.005;
    const managed = e.claimId ? 'Expenses · lent / borrowed' : MANAGED_IN[e.manageAt] || (e.editable ? 'Here, the day book' : 'Day book');
    const cell = (iconName, label, value, cls = '') => `<div class="ed2-fact ${cls}">${icon(iconName)}<span><small>${label}</small><b>${value}</b></span></div>`;
    const cells = [
        cell('calendar', 'Date', `${date(e.entryDate)} <span class="ed2-dim">${d.toLocaleDateString('en-GB', { weekday: 'short' })} · ${ago}</span>`),
        cell('user', 'Paid to / from', e.party ? esc(e.party) : '<span class="ed2-dim">not given</span>'),
        ...(e.reference ? [cell('tag', 'Reference', esc(e.reference))] : []),
        cell('link', 'Managed in', esc(managed)),
        cell(balanced ? 'check-circle' : 'alert', 'Balance check', balanced ? `Debits = credits <span class="ed2-dim">${money(debit)}</span>` : `<span class="neg">Off by ${money(Math.abs(debit - credit))}</span>`, balanced ? 'ok' : 'bad'),
        cell('paperclip', 'Evidence', e.attachmentCount ? `${e.attachmentCount} file${e.attachmentCount === 1 ? '' : 's'} attached` : '<span class="ed2-dim">none yet</span>'),
        cell('history', 'Recorded', `${dateTime(e.createdAt)} <span class="ed2-dim">by ${esc(e.createdBy)}</span>`),
    ];
    if (e.reversedBy) cells.push(cell('undo', 'Reversed by', esc(e.reversedBy), 'bad'));
    if (e.reversalOf) cells.push(cell('undo', 'Reverses', esc(e.reversalOf)));
    if (e.lockReason) cells.push(cell('lock', 'Why it is locked here', esc(e.lockReason), 'wide'));
    return `<section class="ed2-facts"><div class="ed2-label"><span>Details</span></div><div class="ed2-fact-grid">${cells.join('')}</div></section>`;
}

/** Ocean: a head, the entry in one sentence, the postings beside the balances and what the books say about it. */
function oceanDetailHtml(e) {
    const fact = (iconName, html, cls = '') => `<span class="ed-fact ${cls}">${icon(iconName)}${html}</span>`;
    return `
    <div class="entry-detail ed2">
        <div class="ed-head">
            ${kindChip(e.voucherType, 'sm', e.voucherLabel)}
            <span class="ed-title"><b>${esc(e.entryNo)}</b><span>${esc(e.voucherLabel)}</span></span>
            ${e.amount != null ? `<b class="ed-amount mono">${money(e.amount, { decimals: 2 })}</b>` : ''}
            <span class="ed-facts">
                ${fact('calendar', date(e.entryDate))}
                ${e.party ? fact('user', esc(e.party)) : ''}
                ${e.reference ? fact('tag', esc(e.reference)) : ''}
                ${e.construction ? fact('hard-hat', `Construction · <b>${esc(e.construction.project)}</b>${e.construction.what ? ` · ${esc(e.construction.what)}` : ''}`, 'cn-fact') : ''}
                ${e.reversedBy ? fact('undo', `Reversed by <b>${esc(e.reversedBy)}</b>`, 'warn') : ''}
            </span>
            <span class="spacer"></span>
            <span class="ed-actions">
            ${actionsHtml(e)}
            </span>
        </div>
        ${storyHtml(e)}
        <div class="ed2-grid">
            <div class="ed2-main">
                ${postingsHtml(e)}
                ${factsHtml(e)}
                ${chitTrailHtml(e.chitTrail)}
                <div class="ed2-foot"><span data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></span></div>
            </div>
            <aside class="ed2-aside">
                ${balancesHtml(e)}
                <section class="ed2-sec" data-ed-insights="${e.id}"><div class="ed2-label"><span>Insights</span></div>
                    <div class="ed2-row quiet">${icon('sparkles')}<span class="ed2-row-main"><small>Reading your books…</small></span></div></section>
            </aside>
        </div>
    </div>`;
}

const CADENCE = { WEEKLY: 'every week', MONTHLY: 'every month', QUARTERLY: 'every quarter', YEARLY: 'every year' };
const ordinal = n => `${n}${[, 'st', 'nd', 'rd'][n % 100 >> 3 ^ 1 && n % 10] || 'th'}`;
const monthName = ym => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/**
 * What the books say about the entry (EntryInsightService), a row each: a possible duplicate first, then each category's
 * month against its budget and its usual size, then whether it repeats and when the next one is due.
 */
async function loadInsights(box, entryId, income = false) {
    const rupees = v => money(Math.round(Number(v)));
    let x;
    try { x = await api.get(`/transactions/${entryId}/insights`); } catch { box.remove(); return; }
    const rows = [];
    const row = (iconName, title, detail, extra = '', cls = '') => rows.push(`<div class="ed2-row ${cls}">${icon(iconName)}
        <span class="ed2-row-main"><b>${title}</b>${detail ? `<small>${detail}</small>` : ''}${extra}</span></div>`);
    x.duplicates.forEach(d => row('alert', `Possibly recorded twice · <a href="#/entry/${d.entryId}">${esc(d.entryNo)}</a>`,
        `${date(d.date)} · ${rupees(d.amount)} · ${esc(d.reason)}`, '', 'warn'));
    x.categories.forEach(c => {
        const pct = c.budgetPercent != null ? Number(c.budgetPercent) : null;
        const tone = pct == null ? '' : pct > 100 ? 'over' : pct >= (c.alertPercent || 80) ? 'warn' : 'ok';
        const ratio = c.ratio != null ? Number(c.ratio) : null;
        // more spent is bad news, more received good news
        const [up, down] = c.kind === 'INCOME' ? ['pos', 'neg'] : ['neg', 'pos'];
        const usual = ratio == null ? '' : ratio >= 1.3 ? `<span class="${up}">${ratio.toFixed(1)}× usual</span> (${rupees(c.usual)})`
            : ratio <= 0.7 ? `<span class="${down}">${Math.round((1 - ratio) * 100)}% under usual</span> (${rupees(c.usual)})` : `about usual (${rupees(c.usual)})`;
        const month = monthName(c.month).split(' ')[0];
        const budget = pct != null ? `${Math.round(pct)}% of ${rupees(c.budget)} budget${pct > 100 ? ` · <span class="neg">${rupees(Number(c.monthTotal) - Number(c.budget))} over</span>` : ''}` : 'no budget';
        row(c.kind === 'INCOME' ? 'arrow-in' : 'tag', `${esc(c.name)} <span class="mono">${rupees(c.monthTotal)}</span> <span class="ed2-dim">in ${month}</span>`,
            `${budget}${usual ? ` · this one ${usual}` : ''}`,
            pct != null ? `<i class="ed2-meter ${tone}"><em style="width:${Math.min(100, pct)}%"></em></i>` : '');
    });
    const p = x.pattern;
    if (p) {
        const change = p.changePercent != null ? Number(p.changePercent) : null;
        const vs = change == null ? '' : Math.abs(change) < 5 ? ' · usual amount'
            : ` · <span class="${(change > 0) !== income ? 'neg' : 'pos'}">${Math.abs(Math.round(change))}% ${change > 0 ? 'above' : 'below'} usual</span>`;
        row('repeat', `${CADENCE[p.cadence] ? `Repeats ${CADENCE[p.cadence]}` : 'Seen before'}${p.usualDay ? ` <span class="ed2-dim">around the ${ordinal(p.usualDay)}</span>` : ''}`,
            `${p.count}× since ${date(p.first)} · ${rupees(p.total)} in all${vs}${p.nextExpected ? ` · next ~<b>${date(p.nextExpected)}</b>` : ''}`);
    }
    box.innerHTML = `<div class="ed2-label"><span>Insights</span>${rows.length ? `<small>${rows.length}</small>` : ''}</div>`
        + (rows.join('') || `<div class="ed2-row quiet">${icon('check')}<span class="ed2-row-main"><small>Nothing unusual about this entry.</small></span></div>`);
}

// ===================================================================== Classic theme

/** Classic: debit and credit pills either side of the arrow. */
function classicFlowHtml(e) {
    const pill = (l, side) => `
        <span class="ed-pill ${side}" ${l.memo ? `title="${esc(l.memo)}"` : ''}>
            <small>${side === 'dr' ? 'Dr' : 'Cr'}</small><b class="ellipsis">${esc(l.accountName)}</b>
            <span class="mono">${money(side === 'dr' ? l.debit : l.credit, { decimals: 2 })}</span></span>`;
    return `<div class="ed-flow">
            <div class="ed-side">${e.lines.filter(l => Number(l.debit) > 0).map(l => pill(l, 'dr')).join('')}</div>
            <span class="ed-arrow" title="Debit ← Credit">${icon('chevron-left')}</span>
            <div class="ed-side">${e.lines.filter(l => Number(l.credit) > 0).map(l => pill(l, 'cr')).join('')}</div>
        </div>`;
}

/**
 * What an entry did to each thing it touched, once each: one thing can have several lines (the items of a bill all post
 * to Expenses), so it stands at what it was before the first of them and what it is after the last.
 */
function balanceParts(lines) {
    const ledgers = new Map();
    const note = (map, key, name, before, after) => {
        const part = map.get(key);
        if (part) part.after = after;
        else map.set(key, { name, before, after });
    };
    lines.filter(l => l.balanceAfter !== null && l.balanceAfter !== undefined).forEach(l => {
        const name = l.categoryId || l.chitId ? l.ledgerAccountName || l.accountName : l.accountName;
        const ledger = ledgers.get(l.accountId) || { name, before: l.balanceBefore, after: l.balanceAfter, chits: new Map(), categories: new Map() };
        ledger.after = l.balanceAfter;
        ledgers.set(l.accountId, ledger);
        if (l.chitId && l.chitBalanceAfter != null) note(ledger.chits, l.chitId, l.accountName, l.chitBalanceBefore, l.chitBalanceAfter);
        if (l.categoryId && l.categoryBalanceAfter != null) note(ledger.categories, l.categoryId, l.accountName, l.categoryBalanceBefore, l.categoryBalanceAfter);
    });
    return [...ledgers.values()];
}

/**
 * Classic: each account the entry touches, with its balance just before and just after this entry (the stored
 * snapshots, in ledger order) and the change, one slim line each, the amounts being in the pills above. Under Expenses
 * or Income, each category with what it stands at; a chit by itself above the account of all the chits.
 */
function classicBalancesHtml(lines) {
    const ledgers = balanceParts(lines);
    if (!ledgers.length) return '';
    const row = (name, title, before, after, cls = '') => {
        const move = Number(after) - Number(before);
        const dir = move > 0 ? 'up' : move < 0 ? 'down' : '';
        return `<span class="edb-row ${cls}"><span class="edb-name" title="${esc(title)}">${name}</span>
                <span class="edb-before">${money(before, { decimals: 2 })}</span><i>→</i><b>${money(after, { decimals: 2 })}</b>
                <em class="${dir}">${move > 0 ? '▲' : move < 0 ? '▼' : ''}</em>
                <small class="edb-move ${dir}">${move ? `${move > 0 ? '+' : '−'}${money(Math.abs(move), { decimals: 2 })}` : ''}</small></span>`;
    };
    return `<div class="ed-balances" title="Each balance just before and just after this entry">
        <span class="edb-head">Balance</span>${ledgers.map(g => {
            const chits = [...g.chits.values()];
            const categories = [...g.categories.values()];
            return chits.map(c => row(`${esc(c.name)} <small>this chit</small>`, `${c.name}: this chit only`, c.before, c.after)).join('')
                + row(chits.length ? `${esc(g.name)} <small>all chits</small>` : esc(g.name), chits.length ? `${g.name}: every chit together` : g.name, g.before, g.after)
                + categories.map(c => row(esc(c.name), `${c.name}: this category, within ${g.name}`, c.before, c.after, 'sub')).join('');
        }).join('')}</div>`;
}

/** Classic: the pills, the balances, then one line of facts with the actions. */
function classicDetailHtml(e) {
    const memos = e.lines.filter(l => l.memo).map(l => `<b>${esc(l.accountName)}:</b> ${narrativeHtml(l.memo)}`);
    const fact = (iconName, html, cls = '') => `<span class="ed-fact ${cls}">${icon(iconName)}${html}</span>`;
    return `
    <div class="entry-detail">
        ${classicFlowHtml(e)}
        ${classicBalancesHtml(e.lines)}
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
            ${actionsHtml(e)}
        </div>
        <div data-ev-entry="${e.id}" data-ev-count="${e.attachmentCount || 0}"></div>
    </div>`;
}
