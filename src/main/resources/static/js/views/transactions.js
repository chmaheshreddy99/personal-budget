/**
 * Journal ("Day book"): every posted entry with filters, totals by kind, quick-entry buttons and
 * Excel / PDF export. A row is just date, entry (an icon tells its kind: expense, income, transfer, chit
 * payment…), the movement (debit → credit) and the amount; the entry number and the rest show when it is
 * expanded. Search also finds an entry by its number (EX-000123) or id (#123).
 */
import { api } from '../core/api.js';
import { loadAccounts, can, state } from '../core/store.js';
import { panel, table, esc, field, accountOptions, readForm, emptyState, loading, stat } from '../core/ui.js';
import { kindChip, movementHtml, entryKind } from '../core/entry-kind.js';
import { exportButton, bindExport } from '../core/export.js';
import { icon } from '../core/icons.js';
import { money, date, firstOfMonth, isoDate } from '../core/format.js';
import { openQuickEntry, openJournalEditor } from '../components/transaction-forms.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { periodChips, bindPeriodChips } from '../components/period-chips.js';
import { setPageKeys, listNavigator } from '../core/keys.js';
import { evidenceBadge } from '../components/evidence.js';

// Filters survive navigation within the session
const DEFAULTS = () => ({ from: firstOfMonth(-2), to: isoDate(), voucherType: '', accountId: '', q: '' });
const filters = DEFAULTS();
const isFiltered = () => Object.entries(DEFAULTS()).some(([k, v]) => String(filters[k] ?? '') !== String(v));

export async function render(container, _params, isCurrent) {
    const accounts = await loadAccounts();
    if (!isCurrent()) return;
    const voucherOptions = [{ value: '', label: 'All types' }, ...state.options.voucherTypes];

    container.innerHTML = `
    <div class="page journal-page">
        ${panel({
            title: 'Day book', iconName: 'journal', cls: 'p-register', bodyClass: 'flush',
            sub: '<span id="entry-count"></span>',
            actions: `<span id="journal-period">${periodChips(filters.from, filters.to)}</span>
                ${exportButton({ label: '' })}`,
            body: `<form class="filters register-filters" id="filter-form">
                    ${field({ label: 'From', name: 'from', type: 'date', value: filters.from })}
                    ${field({ label: 'To', name: 'to', type: 'date', value: filters.to })}
                    ${field({ label: 'Type', name: 'voucherType', type: 'select', value: filters.voucherType, options: voucherOptions })}
                    ${field({ label: 'Account', name: 'accountId', type: 'select', options: accountOptions(accounts, () => true, filters.accountId, 'All accounts') })}
                    ${field({ label: 'Search', name: 'q', value: filters.q, placeholder: 'Description, party, ref, entry no. or #id' })}
                    <button class="btn primary" type="submit">${icon('search')}Apply</button>
                    <button class="btn ghost" type="button" id="clear-filters" ${isFiltered() ? '' : 'hidden'} title="Back to the last 3 months, every type and account">${icon('x')}Clear</button>
                   </form>
                   <div class="register-table scroll" id="register"></div>`,
        })}

        <div class="journal-side">
            ${panel({
                title: 'Post', iconName: 'plus', cls: 'p-post',
                body: `<div class="post-grid">
                    ${postButton('EXPENSE', 'arrow-out', 'coral', 'Expense', 'Pay a bill or purchase')}
                    ${postButton('INCOME', 'arrow-in', 'aqua', 'Income', 'Salary, interest, gifts')}
                    ${postButton('TRANSFER', 'transfer', '', 'Transfer', 'Between your accounts')}
                    ${postButton('JOURNAL', 'journal', 'violet', 'Journal', 'Multi-line voucher')}
                </div>`,
            })}
            ${panel({ title: 'Selection summary', iconName: 'pie', cls: 'p-summary', body: '<div id="summary"></div>' })}
        </div>
    </div>`;

    const form = container.querySelector('#filter-form');
    const periodHost = container.querySelector('#journal-period');
    const onPeriod = (from, to) => {
        filters.from = from; filters.to = to;
        form.from.value = from; form.to.value = to;
        periodHost.innerHTML = periodChips(from, to);
        bindPeriodChips(periodHost, onPeriod);
        load();
    };
    bindPeriodChips(periodHost, onPeriod);
    form.addEventListener('submit', e => {
        e.preventDefault();
        Object.assign(filters, readForm(form));
        load();
    });
    form.querySelector('#clear-filters').addEventListener('click', () => {
        Object.assign(filters, DEFAULTS());
        render(container, _params, isCurrent);
    });

    container.querySelector('.p-post').addEventListener('click', e => {
        const btn = e.target.closest('[data-post]');
        if (!btn) return;
        if (btn.dataset.post === 'JOURNAL') openJournalEditor({ onSaved: load });
        else if (btn.dataset.post === 'EXPENSE') openExpenseDialog({ onSaved: load });
        else openQuickEntry({ kind: btn.dataset.post, onSaved: load });
    });

    let entries = [];
    // Clicking a row expands its lines in place (click again to collapse)
    container.querySelector('#register').addEventListener('click', e => {
        const row = e.target.closest('tr[data-entry]');
        if (row) toggleEntryRow(row, entries.find(x => String(x.id) === row.dataset.entry), { onChanged: load });
    });
    bindExport(container.querySelector('.p-register'), () => {
        const names = (e, side) => [...new Set(e.lines.filter(l => Number(l[side]) > 0).map(l => l.accountName))].join(', ');
        const total = entries.reduce((s, e) => s + Number(e.amount), 0);
        return {
            title: 'Day book', subtitle: `${date(filters.from)} – ${date(filters.to)}`, filename: `journal-${filters.from}-to-${filters.to}`,
            summary: [['Entries', entries.length, 'number'], ['Total moved', total]],
            sheets: [
                { name: 'Entries', columns: [{ label: 'Date', type: 'date' }, { label: 'Kind' }, { label: 'Entry' }, { label: 'Party' },
                    { label: 'Debit (to)' }, { label: 'Credit (from)' }, { label: 'Amount', type: 'money' }],
                  rows: entries.map(e => [e.entryDate, entryKind(e.voucherType).label, e.narration, e.party || '', names(e, 'debit'), names(e, 'credit'), Number(e.amount)]),
                  totals: ['Total', '', '', '', '', '', total] },
                { name: 'Lines', columns: [{ label: 'Date', type: 'date' }, { label: 'Entry no' }, { label: 'Entry' }, { label: 'Account' },
                    { label: 'Debit', type: 'money' }, { label: 'Credit', type: 'money' }],
                  rows: entries.flatMap(e => e.lines.map(l => [e.entryDate, e.entryNo, e.narration, l.accountName, Number(l.debit) || '', Number(l.credit) || ''])) },
            ],
        };
    });

    async function load() {
        const target = container.querySelector('#register');
        target.innerHTML = loading();
        entries = await api.get('/transactions', { ...filters, limit: 1000 });
        form.querySelector('#clear-filters').hidden = !isFiltered();
        container.querySelector('#entry-count').textContent = `${entries.length} entries`;
        target.innerHTML = table([
            { label: 'Date', render: e => date(e.entryDate), cls: 'nowrap c-date' },
            { label: 'Entry', cls: 'c-entry', render: e => entryCell(e) },
            { label: 'Movement (Dr → Cr)', cls: 'c-move', render: e => movementHtml(e.lines) },
            { label: 'Amount', align: 'r', render: e => `<b class="mono">${money(e.amount)}</b>` },
            { label: '', align: 'r', cls: 'c-caret', render: () => `<span class="expand-caret">${icon('chevron-down')}</span>` },
        ], entries, {
            dense: true,
            rowClass: e => `clickable ${e.reversedBy || e.voucherType === 'REVERSAL' ? 'is-reversed' : ''}`,
            rowAttrs: e => `data-entry="${e.id}"`,
            empty: 'No entries match these filters',
        });
        renderSummary(entries);
    }

    function renderSummary(list) {
        const byType = {};
        list.forEach(e => {
            byType[e.voucherType] ??= { count: 0, amount: 0, type: e.voucherType };
            byType[e.voucherType].count++;
            byType[e.voucherType].amount += Number(e.amount);
        });
        const income = list.filter(e => e.voucherType === 'INCOME').reduce((s, e) => s + Number(e.amount), 0);
        const expense = list.filter(e => e.voucherType === 'EXPENSE').reduce((s, e) => s + Number(e.amount), 0);
        container.querySelector('#summary').innerHTML = list.length ? `
            <div class="stat-strip" style="grid-template-columns:1fr 1fr">
                ${stat('Income', `<span class="pos">${money(income)}</span>`)}
                ${stat('Expenses', `<span class="neg">${money(expense)}</span>`)}
            </div>
            <div class="section-title" style="margin-top:12px">By kind</div>
            <div class="list">${Object.values(byType).sort((a, b) => b.amount - a.amount).map(v => `
                <div class="list-item">${kindChip(v.type)}<span>${esc(entryKind(v.type).label)}</span>
                    <span class="muted small">${v.count}×</span><span class="spacer"></span><b class="mono">${money(v.amount)}</b></div>`).join('')}
            </div>` : emptyState('No entries in this selection');
    }

    // ↑ / ↓ move through the entries, Enter expands one
    const register = container.querySelector('#register');
    setPageKeys(listNavigator({
        items: () => [...register.querySelectorAll('tr[data-entry]')],
        selected: () => register.querySelector('tr.cursor') || register.querySelector('tr.expanded'),
        select: el => { register.querySelectorAll('tr.cursor').forEach(x => x.classList.remove('cursor')); el.classList.add('cursor'); },
        open: el => el.click(),
    }));

    await load();
}

function postButton(kind, iconName, tone, title, sub) {
    if (kind === 'JOURNAL' ? !can('MANAGE_JOURNALS') : !can('POST_TRANSACTIONS')) return '';
    return `<button class="post-btn" data-post="${kind}">
        <span class="chip-icon ${tone}">${icon(iconName)}</span>
        <span><b>${title}</b><small>${sub}</small></span></button>`;
}

/** The entry: its kind as an icon, the description, the person or shop grayed beside it, and small flags. */
export function entryCell(e) {
    return `<div class="entry-cell">${kindChip(e.voucherType, 'sm', e.voucherLabel)}
        <span class="entry-text"><b class="ellipsis">${esc(e.narration)}</b>${e.party ? `<span class="entry-party ellipsis">${esc(e.party)}</span>` : ''}</span>
        ${evidenceBadge(e.attachmentCount)}${e.reversedBy ? `<span class="mini-flag" title="Reversed">${icon('undo')}</span>` : ''}</div>`;
}
