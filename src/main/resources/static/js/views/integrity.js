/**
 * Data integrity (#/integrity, admins and super admins only): what the check of the books found, grouped by kind,
 * with what each issue means and what to do. Nothing is fixed automatically; a left-behind chit posting can be
 * taken out here, one at a time, after a confirmation. The journal entry of an issue opens inline.
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState, toast, confirmDialog, loading } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date } from '../core/format.js';
import { toggleEntryRow } from '../components/entry-inline.js';

const KINDS = {
    LEFT_BEHIND: {
        title: 'Left-behind postings', iconName: 'alert', tone: 'warn',
        about: 'Journal entries a feature posted for a record that no longer stands behind them, such as a chit installment that was undone while its entry stayed. They still move balances.',
    },
    UNBALANCED: {
        title: 'Unbalanced entries', iconName: 'scale', tone: 'bad',
        about: 'Entries whose debits and credits do not agree, or that have fewer than two lines.',
    },
    BALANCE_MISMATCH: {
        title: 'Balance mismatches', iconName: 'wallet', tone: 'bad',
        about: 'Accounts whose stored balance is not the sum of their journal lines. A restart works the balances out again from the lines.',
    },
};

const SOURCE_LABEL = {
    CHIT_INSTALLMENT: 'Chit installment', CHIT_PAYOUT: 'Chit payout', HOSTED_CHIT_COLLECTION: 'Host a Chit collection',
    HOSTED_CHIT_PAYOUT: 'Host a Chit payout', HOSTED_CHIT_COMMISSION: 'Host a Chit commission', HOSTED_CHIT_TRANSFER: 'Chit transfer',
    CLAIM: 'Money lent / borrowed', CLAIM_REPAYMENT: 'Repayment', CLAIM_INTEREST: 'Interest', ACCOUNT_OPENING: 'Opening balance',
    EXPENSE_REFUND: 'Refund', REVERSAL: 'Reversal',
};
const sourceLabel = s => SOURCE_LABEL[s] || (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : '');

export async function render(container, _params, isCurrent) {
    container.innerHTML = `<div class="page integrity-page">${loading()}</div>`;
    const issues = await api.get('/integrity');
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const groups = Object.keys(KINDS).map(kind => [kind, issues.filter(i => i.kind === kind)]);

    container.innerHTML = `
    <div class="page integrity-page">
        <section class="ig-summary ${issues.length ? 'has-issues' : 'clean'}">
            <span class="ig-mark">${icon(issues.length ? 'alert' : 'check')}</span>
            <div class="min-0">
                <b>${issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found in the books` : 'No issues found'}</b>
                <small>${issues.length ? 'Nothing is changed automatically. Review each issue; a left-behind chit posting can be removed here.'
                    : 'Every feature posting has its record, every entry balances and every stored balance agrees with its lines.'}</small>
            </div>
            <div class="ig-counts">${groups.map(([kind, list]) => `<span class="${list.length ? KINDS[kind].tone : 'ok'}" title="${esc(KINDS[kind].title)}">
                ${icon(KINDS[kind].iconName)}<b>${list.length}</b>${esc(KINDS[kind].title)}</span>`).join('')}</div>
            <button class="btn sm" id="ig-recheck">${icon('refresh')}Check again</button>
        </section>
        ${groups.filter(([, list]) => list.length).map(([kind, list]) => panel({
            title: KINDS[kind].title, iconName: KINDS[kind].iconName, cls: `ig-group ig-${kind.toLowerCase()}`, bodyClass: 'flush',
            sub: `${list.length}`,
            body: `<p class="ig-about">${esc(KINDS[kind].about)}</p>${kind === 'BALANCE_MISMATCH' ? accountTable(list) : entryTable(list)}`,
        })).join('')}
        ${issues.length ? '' : `<div class="ig-empty">${emptyState('The books are consistent', 'shield')}</div>`}
    </div>`;

    container.querySelector('#ig-recheck').addEventListener('click', reload);
    container.querySelector('.integrity-page').addEventListener('click', async e => {
        const remove = e.target.closest('[data-remove]');
        if (remove) {
            e.stopPropagation();
            const issue = issues.find(i => String(i.entryId) === remove.dataset.remove);
            if (!await confirmDialog(`Remove ${issue.entryNo} from the books? ${issue.reason}. Account balances are worked out again.`,
                { title: 'Remove left-behind entry', confirmLabel: 'Remove' })) return;
            try {
                await api.post(`/integrity/entries/${issue.entryId}/remove`);
                toast(`${issue.entryNo} removed`);
                reload();
            } catch (error) {
                toast(error.message, 'error');
            }
            return;
        }
        const row = e.target.closest('tr[data-entry]');
        if (row && !e.target.closest('button, a')) toggleEntryRow(row, null, { onChanged: reload });
    });
}

function entryTable(list) {
    return `<table class="grid ig-table">
        <thead><tr><th>Entry</th><th>Date</th><th>Narration</th><th>Posted by</th><th class="r">Amount</th><th>Issue</th><th></th></tr></thead>
        <tbody>${list.map(i => `
            <tr data-entry="${i.entryId}" class="clickable" title="Open the journal entry">
                <td class="mono"><b>${esc(i.entryNo)}</b></td>
                <td>${date(i.date)}</td>
                <td class="ellipsis">${esc(i.narration || '')}</td>
                <td>${esc(sourceLabel(i.sourceType))}${i.sourceId ? ` <span class="muted small">#${i.sourceId}</span>` : ''}</td>
                <td class="r mono">${money(i.amount)}</td>
                <td class="ig-reason">${esc(i.reason)}</td>
                <td class="r">${i.removable ? `<button class="btn sm danger" data-remove="${i.entryId}" title="Take this entry out of the books">${icon('trash')}Remove</button>`
                    : '<span class="small muted">review</span>'}</td>
            </tr>`).join('')}</tbody></table>`;
}

function accountTable(list) {
    return `<table class="grid ig-table">
        <thead><tr><th>Account</th><th class="r">Stored balance</th><th>Issue</th></tr></thead>
        <tbody>${list.map(i => `
            <tr><td><a href="#/accounts">${esc(i.accountName)}</a></td><td class="r mono">${i.amount === null ? '—' : money(i.amount)}</td>
                <td class="ig-reason">${esc(i.reason)}</td></tr>`).join('')}</tbody></table>`;
}
