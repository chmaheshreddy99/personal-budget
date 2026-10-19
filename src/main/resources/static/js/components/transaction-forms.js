/**
 * Dialogs for posting money movements, shared by every page:
 *  - openQuickEntry(): expense / income / transfer (plus lend, borrow, card bill shortcuts)
 *  - openJournalEditor(): multi-line double-entry journal (create or edit)
 *  - openEntryDetail(): read-only view of a posted entry with edit / delete
 */
import { api, newRequestKey } from '../core/api.js';
import { loadAccounts, invalidateAccounts, can, categoriesOf, loadCategories } from '../core/store.js';
import { openModal, field, readForm, accountOptions, categoryOptions, esc, toast, confirmDialog, table, narrativeHtml } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, isoDate, date } from '../core/format.js';
import { evidenceFieldHtml, bindEvidenceField } from './evidence.js';

const isMoneyAccount = a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && a.accountType !== 'CHIT_FUND';

/**
 * What each quick-entry tab posts. Money always flows "from" -> "to": the journal debits "to" and
 * credits "from". An expense goes to the one Expenses account and an income comes from the one Income
 * account; the category says what it was.
 */
const KINDS = {
    EXPENSE: {
        label: 'Expense', iconName: 'arrow-out',
        fromLabel: 'Paid from', from: isMoneyAccount, category: 'EXPENSE',
    },
    INCOME: {
        label: 'Income', iconName: 'arrow-in',
        toLabel: 'Received into', to: isMoneyAccount, category: 'INCOME',
    },
    TRANSFER: {
        label: 'Transfer', iconName: 'transfer',
        fromLabel: 'From account', toLabel: 'To account',
        from: isMoneyAccount, to: isMoneyAccount,
    },
};

/** Common real-life shortcuts mapped onto a transfer with preset accounts. */
const SHORTCUTS = [
    { label: 'Lend money', open: 'lend', hint: 'Tracked under Receivables with repayments and interest' },
    { label: 'Paid for someone', open: 'paidfor', hint: 'Tracked under Receivables until they pay you back' },
    { label: 'Collect dues', open: 'collect', hint: 'Record a repayment against what someone owes you' },
    { label: 'Borrow money', kind: 'TRANSFER', from: 'PAYABLE', hint: 'Payables → Bank / cash' },
    { label: 'Repay dues', kind: 'TRANSFER', to: 'PAYABLE', hint: 'Bank / cash → Payables' },
    { label: 'Pay card bill', kind: 'TRANSFER', to: 'CREDIT_CARD', hint: 'Bank → Credit card' },
    { label: 'Bill to pay later', kind: 'EXPENSE', from: 'PAYABLE', hint: 'Expense on credit (Payables)' },
];

export async function openQuickEntry({ kind = 'EXPENSE', onSaved, preset = {} } = {}) {
    const saveKey = newRequestKey();   // one key per dialog: a retry or a second click saves once
    const accounts = await loadAccounts();
    const categories = { EXPENSE: await categoriesOf('EXPENSE'), INCOME: await categoriesOf('INCOME') };
    let current = kind;

    const formHtml = (k, values = {}) => {
        const cfg = KINDS[k];
        return `
        <div class="row wrap" style="margin-bottom:12px">
            <div class="tabs" data-kind-tabs>${Object.entries(KINDS).map(([key, c]) =>
                `<button type="button" class="tab ${key === k ? 'active' : ''}" data-kind="${key}">${icon(c.iconName)}${c.label}</button>`).join('')}
            </div>
        </div>
        <form class="form-grid two" data-quick-form data-suggest-kinds="${k}">
            ${field({ label: 'Date', name: 'entryDate', type: 'date', value: values.entryDate || isoDate(), required: true })}
            ${field({ label: 'Amount', name: 'amount', type: 'number', value: values.amount || '', required: true, attrs: 'min="0.01"' })}
            ${cfg.category === 'INCOME' ? field({ label: 'Income category', name: 'categoryId', type: 'select', required: true,
                      options: categoryOptions(categories.INCOME, values.categoryId) }) : ''}
            ${cfg.from ? field({ label: cfg.fromLabel, name: 'fromAccountId', type: 'select', required: true,
                      options: accountOptions(accounts, cfg.from, values.fromAccountId) }) : ''}
            ${cfg.to ? field({ label: cfg.toLabel, name: 'toAccountId', type: 'select', required: true,
                      options: accountOptions(accounts, cfg.to, values.toAccountId) }) : ''}
            ${cfg.category === 'EXPENSE' ? field({ label: 'Expense category', name: 'categoryId', type: 'select', required: true,
                      options: categoryOptions(categories.EXPENSE, values.categoryId) }) : ''}
            ${field({ label: 'Description', name: 'narration', value: values.narration || '', span: 'span-2',
                      placeholder: k === 'EXPENSE' ? 'e.g. Weekly groceries' : '' })}
            ${field({ label: 'Payee / payer', name: 'party', value: values.party || '' })}
            ${field({ label: 'Reference', name: 'reference', value: values.reference || '', placeholder: 'Bill / UPI ref' })}
            <div class="span-2">${evidenceFieldHtml({ hint: k === 'TRANSFER' ? 'Transfer screenshot or slip' : 'Receipt, bill or screenshot' })}</div>
            <div class="span-2">
                <div class="section-title">Shortcuts</div>
                <div class="row wrap">${SHORTCUTS.map((s, i) =>
                    `<button type="button" class="btn sm" data-shortcut="${i}" title="${esc(s.hint)}">${esc(s.label)}</button>`).join('')}</div>
            </div>
        </form>`;
    };

    const modal = openModal({
        title: 'New transaction', iconName: 'plus', size: 'lg',
        body: `<div data-quick-root>${formHtml(current, preset)}</div>`,
        actions: [
            { label: 'Journal entry…', iconName: 'journal', left: true, onClick: () => { openJournalEditor({ onSaved }); } },
            { label: 'Cancel' },
            {
                label: 'Save', kind: 'primary', iconName: 'check',
                onClick: async (m) => {
                    const form = m.el.querySelector('[data-quick-form]');
                    if (!form.reportValidity()) return true;
                    const data = readForm(form);
                    const saved = await api.post('/transactions/quick', { ...data, kind: current }, { key: saveKey });
                    await evidence?.uploadTo(saved.id);
                    invalidateAccounts();
                    toast(`${KINDS[current].label} of ${money(saved.amount)} posted as ${saved.entryNo}`);
                    onSaved?.(saved);
                },
            },
        ],
    });

    const root = modal.el.querySelector('[data-quick-root]');
    let evidence = bindEvidenceField(root);
    const rerender = (k, values) => {
        current = k;
        root.innerHTML = formHtml(k, values);
        evidence = bindEvidenceField(root);   // switching tabs starts a fresh evidence list
        bindForm(true);
    };
    const pick = (type) => accounts.find(a => a.accountType === type && a.active)?.id;
    const defaultBank = () => accounts.find(a => a.accountType === 'BANK' && a.active)?.id;

    /** rerendered: the dialog only wires Enter-to-submit on its first form, so later forms wire it here. */
    function bindForm(rerendered = false) {
        root.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
            const values = readForm(root.querySelector('form'));
            rerender(b.dataset.kind, { entryDate: values.entryDate, amount: values.amount, narration: values.narration,
                fromAccountId: values.fromAccountId, toAccountId: values.toAccountId });
        }));
        root.querySelectorAll('[data-shortcut]').forEach(b => b.addEventListener('click', () => {
            const s = SHORTCUTS[Number(b.dataset.shortcut)];
            if (s.open) {
                modal.close();
                if (s.open === 'collect') location.hash = '#/expenses/collect';
                else import('./expense-dialog.js').then(m => m.openExpenseDialog({ mode: s.open === 'lend' ? 'LENT' : 'PAID_FOR', onSaved }));
                return;
            }
            const values = readForm(root.querySelector('form'));
            rerender(s.kind, {
                entryDate: values.entryDate, amount: values.amount, narration: s.label,
                fromAccountId: s.from ? pick(s.from) : defaultBank(),
                toAccountId: s.to ? pick(s.to) : (s.kind === 'TRANSFER' ? defaultBank() : null),
                categoryId: values.categoryId,
            });
        }));
        if (rerendered) {
            root.querySelector('form').addEventListener('submit', e => {
                e.preventDefault();
                modal.el.querySelector('.btn.primary').click();
            });
        }
    }
    bindForm();
}

// ===================================================================== journal editor

/** Create (entry = null), edit, or duplicate (copy = true) a multi-line journal. */
export async function openJournalEditor({ entry: source = null, copy = false, onSaved } = {}) {
    const saveKey = newRequestKey();   // one key per dialog: a retry or a second click saves once
    const accounts = await loadAccounts(false, { all: true });   // the pickers still hide chit-book accounts unless a line uses one
    const allCategories = await loadCategories();
    const chits = await api.get('/chits').catch(() => []);
    const accountById = new Map(accounts.map(a => [a.id, a]));
    /** The category or chit picker a line needs: Expenses / Income lines take a category, Chit Funds a chit. */
    const dimension = (accountId, l = {}) => {
        const a = accountById.get(Number(accountId));
        if (a?.accountClass === 'EXPENSE' || a?.accountClass === 'INCOME') {
            const list = allCategories.filter(c => c.kind === a.accountClass && (c.active || c.id === l.categoryId));
            return `<select name="categoryId" required title="Category">${categoryOptions(list, l.categoryId)}</select>`;
        }
        if (a?.accountType === 'CHIT_FUND') {
            return `<select name="chitId" required title="Chit"><option value="">Pick a chit</option>${chits.map(c =>
                `<option value="${c.id}" ${c.id === l.chitId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
        }
        return '<span class="muted small">—</span>';
    };
    const entry = copy ? null : source;               // the entry being edited, if any
    const template = source;                           // values to start from
    const lines = template ? template.lines.map(l => ({ ...l })) : [{}, {}];

    const lineRow = (l, i) => `
        <tr data-line="${i}">
            <td><select name="accountId" required>${accountOptions(accounts, () => true, l.ledgerAccountId ?? l.accountId, undefined, { chitBook: true })}</select></td>
            <td data-dimension>${dimension(l.ledgerAccountId ?? l.accountId, l)}</td>
            <td><input name="debit" class="num" data-type="number" type="number" step="any" min="0" value="${Number(l.debit) || ''}"></td>
            <td><input name="credit" class="num" data-type="number" type="number" step="any" min="0" value="${Number(l.credit) || ''}"></td>
            <td><input name="memo" value="${esc(l.memo || '')}"></td>
            <td><button type="button" class="btn ghost icon sm" data-remove="${i}" title="Remove line">${icon('trash')}</button></td>
        </tr>`;

    const body = `
        <form class="stack" data-journal-form>
            <div class="form-grid four">
                ${field({ label: 'Date', name: 'entryDate', type: 'date', value: entry?.entryDate || isoDate(), required: true })}
                ${field({ label: 'Narration', name: 'narration', value: template?.narration || '', required: true, span: 'span-2' })}
                ${field({ label: 'Reference', name: 'reference', value: template?.reference || '' })}
            </div>
            <table class="grid compact journal-lines">
                <thead><tr><th style="width:28%">Account</th><th style="width:20%">Category / chit</th><th class="r">Debit</th><th class="r">Credit</th><th>Memo</th><th></th></tr></thead>
                <tbody data-lines>${lines.map(lineRow).join('')}</tbody>
                <tfoot><tr class="total"><td><button type="button" class="btn sm" data-add-line>${icon('plus')}Add line</button></td>
                    <td></td><td class="r" data-total-debit></td><td class="r" data-total-credit></td><td colspan="2" data-balance></td></tr></tfoot>
            </table>
            <p class="hint">Every journal must balance: total debits = total credits. Debit increases assets &amp; expenses; credit increases liabilities, income &amp; equity.</p>
            ${entry ? `<div data-ev-entry="${entry.id}" data-ev-count="${entry.attachmentCount || 0}"></div>` : evidenceFieldHtml({ hint: 'Voucher, bill or statement' })}
        </form>`;

    const modal = openModal({
        title: entry ? `Edit ${entry.entryNo}` : copy ? `Duplicate ${source.entryNo}` : 'New journal entry',
        iconName: 'journal', size: 'xl', body,
        actions: [
            { label: 'Cancel' },
            {
                label: entry ? 'Save changes' : 'Post journal', kind: 'primary', iconName: 'check',
                onClick: async (m) => {
                    const form = m.el.querySelector('[data-journal-form]');
                    if (!form.reportValidity()) return true;
                    const header = readForm(form.querySelector('.form-grid'));
                    const payload = {
                        ...header,
                        lines: [...form.querySelectorAll('[data-line]')].map(tr => readForm(tr))
                            .map(l => ({ accountId: Number(l.accountId), categoryId: l.categoryId ? Number(l.categoryId) : null,
                                chitId: l.chitId ? Number(l.chitId) : null, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo })),
                        version: entry?.version ?? null,
                    };
                    const saved = entry
                        ? await api.put(`/transactions/${entry.id}`, payload, { key: saveKey })
                        : await api.post('/transactions/journal', payload, { key: saveKey });
                    await journalEvidence.uploadTo(saved.id);
                    invalidateAccounts();
                    toast(`Journal ${saved.entryNo} saved`);
                    onSaved?.(saved);
                },
            },
        ],
    });

    const form = modal.el.querySelector('[data-journal-form]');
    const journalEvidence = bindEvidenceField(form);
    const tbody = form.querySelector('[data-lines]');
    const updateTotals = () => {
        let dr = 0, cr = 0;
        tbody.querySelectorAll('[data-line]').forEach(tr => {
            dr += Number(tr.querySelector('[name=debit]').value || 0);
            cr += Number(tr.querySelector('[name=credit]').value || 0);
        });
        form.querySelector('[data-total-debit]').textContent = money(dr, { decimals: 2 });
        form.querySelector('[data-total-credit]').textContent = money(cr, { decimals: 2 });
        const diff = Math.round((dr - cr) * 100) / 100;
        form.querySelector('[data-balance]').innerHTML = diff === 0 && dr > 0
            ? `<span class="badge good">${icon('check')}Balanced</span>`
            : `<span class="badge critical">${icon('alert')}Difference ${money(Math.abs(diff), { decimals: 2 })}</span>`;
    };
    tbody.addEventListener('input', updateTotals);
    tbody.addEventListener('change', e => {
        if (e.target.name !== 'accountId') return;
        e.target.closest('tr').querySelector('[data-dimension]').innerHTML = dimension(e.target.value);
    });
    form.querySelector('[data-add-line]').addEventListener('click', () => {
        tbody.insertAdjacentHTML('beforeend', lineRow({}, tbody.children.length));
    });
    tbody.addEventListener('click', e => {
        const btn = e.target.closest('[data-remove]');
        if (btn && tbody.children.length > 2) { btn.closest('tr').remove(); updateTotals(); }
    });
    updateTotals();
}

// ===================================================================== entry detail

export async function openEntryDetail(entryId, { onChanged } = {}) {
    const entry = await api.get(`/transactions/${entryId}`);
    const linesTable = table([
        { label: 'Account', render: l => `<b>${esc(l.accountName)}</b> <span class="muted small">${esc(l.accountCode)}${
            l.ledgerAccountName && l.ledgerAccountName !== l.accountName ? ' · ' + esc(l.ledgerAccountName) : ''}</span>` },
        { label: 'Debit', align: 'r', render: l => Number(l.debit) ? money(l.debit, { decimals: 2 }) : '' },
        { label: 'Credit', align: 'r', render: l => Number(l.credit) ? money(l.credit, { decimals: 2 }) : '' },
        { label: 'Memo', render: l => narrativeHtml(l.memo || ''), cls: 'muted' },
    ], entry.lines, {
        footer: `<tr class="total"><td>Total</td><td class="r">${money(entry.amount, { decimals: 2 })}</td>
                 <td class="r">${money(entry.amount, { decimals: 2 })}</td><td></td></tr>`,
    });
    const actions = [];
    if (entry.editable && can('MANAGE_JOURNALS')) {
        actions.push({
            label: 'Delete', kind: 'danger', iconName: 'trash', left: true,
            onClick: async () => {
                if (!await confirmDialog(`Delete ${entry.entryNo}? Account balances will be recalculated.`)) return true;
                await api.del(`/transactions/${entry.id}`);
                invalidateAccounts();
                toast(`${entry.entryNo} deleted`);
                onChanged?.();
            },
        });
        actions.push({ label: 'Edit', iconName: 'edit', onClick: () => { openJournalEditor({ entry, onSaved: onChanged }); } });
    }
    actions.push({ label: 'Close', kind: 'primary' });

    openModal({
        title: `${entry.entryNo} · ${entry.voucherLabel}`, iconName: 'journal', size: 'lg', actions,
        body: `
            <div class="stat-strip" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">
                <div class="stat"><div class="label">Date</div><div class="value">${date(entry.entryDate)}</div></div>
                <div class="stat"><div class="label">Amount</div><div class="value">${money(entry.amount)}</div></div>
                <div class="stat"><div class="label">Party</div><div class="value">${esc(entry.party || '—')}</div></div>
                <div class="stat"><div class="label">Reference</div><div class="value">${esc(entry.reference || '—')}</div></div>
            </div>
            <p style="margin:0 0 10px"><b>${esc(entry.narration)}</b></p>
            ${linesTable}
            <p class="hint" style="margin-top:10px">Posted by ${esc(entry.createdBy)} on ${date(entry.createdAt)}</p>`,
    });
}
