/**
 * Money you owe: cash borrowed from someone, or a bill to pay later. Saved as a claim of kind
 * BORROWED / BILL_DUE, so it gets the same lifecycle as money lent: status, part payments, interest
 * (simple or compound), due date and the month-by-month schedule.
 *   Borrowed:  Dr the account the money came into, Cr Payables
 *   Bill:      Dr Expenses [category], Cr Payables
 */
import { api, newRequestKey } from '../core/api.js';
import { loadAccounts, categoriesOf } from '../core/store.js';
import { esc, field, readForm, openModal, toast, accountOptions, categoryOptions } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, isoDate } from '../core/format.js';
import { evidenceFieldHtml, bindEvidenceField } from './evidence.js';
import { interestAccountFilter } from './claim-panel.js';

const KINDS = {
    BORROWED: { label: 'Money borrowed', iconName: 'arrow-in', party: 'Borrowed from', counter: 'Money came into' },
    BILL_DUE: { label: 'Bill to pay later', iconName: 'receipt', party: 'Owed to (shop / person)', counter: 'Expense category' },
};

export async function openDebtDialog({ kind = 'BORROWED', claim = null, payableAccountId = null, onSaved } = {}) {
    const saveKey = newRequestKey();   // one key per dialog: a retry or a second click saves once
    const accounts = await loadAccounts();
    const categories = await categoriesOf('EXPENSE', claim?.categoryId);
    let current = claim?.kind || kind;
    const c = claim || {};
    const into = a => (a.accountClass === 'ASSET' || a.accountClass === 'LIABILITY') && !['RECEIVABLE', 'LOAN_GIVEN', 'CHIT_FUND', 'PAYABLE'].includes(a.accountType);
    // a bill names what it was for (an expense category); borrowed money names where it landed
    const counterSelect = k => k === 'BILL_DUE'
        ? `<select name="categoryId" required>${categoryOptions(categories, c.categoryId)}</select>`
        : `<select name="paidFromAccountId" required>${accountOptions(accounts, into, c.paidFromAccountId ?? accounts.find(a => a.accountType === 'BANK' && a.active)?.id)}</select>`;
    const due = days => isoDate(new Date(Date.now() + days * 86400000));
    let evidence = null;

    openModal({
        title: claim ? `Edit · ${claim.narration}` : 'Money you owe', iconName: 'card', size: 'lg',
        body: `<form class="debt-form" autocomplete="off" data-suggest-kinds="BORROWING,BILL_DUE,REPAYMENT_MADE">
            <div class="xp-modes two">${Object.entries(KINDS).map(([k, m]) => `
                <button type="button" class="xp-mode ${k === current ? 'selected' : ''}" data-kind="${k}" ${claim && claim.kind !== k ? 'disabled' : ''}>${icon(m.iconName)}${m.label}</button>`).join('')}</div>
            <div class="form-grid three">
                ${field({ label: KINDS[current].party, name: 'party', value: c.party, required: true, span: 'span-2', placeholder: 'Name' })}
                ${field({ label: 'Amount', name: 'amount', type: 'number', value: c.amount, required: true })}
                ${field({ label: 'Description', name: 'narration', value: c.narration, span: 'span-2', placeholder: 'e.g. Hand loan for school fees' })}
                ${field({ label: 'Date', name: 'startDate', type: 'date', value: c.startDate || isoDate(), required: true })}
                <label class="field"><span data-counter-label>${KINDS[current].counter} *</span><span data-counter>${counterSelect(current)}</span></label>
                ${field({ label: 'Tracked in', name: 'receivableAccountId', type: 'select',
                          options: accountOptions(accounts, a => a.accountClass === 'LIABILITY' && a.accountType !== 'CREDIT_CARD', c.receivableAccountId ?? payableAccountId, 'Payables (default)') })}
                ${field({ label: 'Pay back by', name: 'dueDate', type: 'date', value: c.dueDate, attrs: 'data-dp-base="startDate"' })}
                <div class="span-3 xp-due-chips"><span class="small muted">Due in</span>
                    ${[[30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year']].map(([d, l]) => `<button type="button" class="date-chip" data-due="${due(d)}">${l}</button>`).join('')}
                    <button type="button" class="date-chip" data-due="">No date</button></div>
                <label class="field"><span>Interest % a year</span>
                    <span class="rate-type"><input name="interestRate" type="number" step="0.1" min="0" max="60" value="${c.interestRate ?? ''}" placeholder="None" data-plain>
                    <select name="interestType"><option value="SIMPLE">Simple</option><option value="COMPOUND" ${c.interestType === 'COMPOUND' ? 'selected' : ''}>Compound</option></select></span></label>
                ${field({ label: 'Reference', name: 'reference', value: c.reference, placeholder: 'Optional' })}
                ${field({ label: 'Notes', name: 'notes', value: c.notes, placeholder: 'Optional' })}
            </div>
            <div class="form-grid two debt-interest">
            <label class="field" title="Monthly or yearly: interest falls due on each anniversary of the loan. Whenever paid: it keeps adding up until you pay.">
                <span>Interest is paid</span><select name="interestCollection" title="When the interest is expected to be paid">
                            <option value="MONTHLY" ${(claim?.interestCollection || 'MONTHLY') ==='MONTHLY' ? 'selected' : ''}>Every month</option>
                            <option value="YEARLY" ${(claim?.interestCollection || 'MONTHLY') ==='YEARLY' ? 'selected' : ''}>Every year</option>
                            <option value="ON_PAYMENT" ${(claim?.interestCollection || 'MONTHLY') ==='ON_PAYMENT' ? 'selected' : ''}>Whenever paid</option>
                        </select></label>
            <label class="field" title="Payables: the interest stays owed until paid. A bank or card: the interest is paid from it every month.">
                <span>Post interest to <small class="muted">optional</small></span>
                <select name="interestAccountId">${accountOptions(accounts, interestAccountFilter('BORROWED'),
                    claim && claim.interestAccountId !== claim.receivableAccountId ? claim.interestAccountId : null, 'Payables (default)')}</select></label>
            </div>
            <label class="check-line" title="Books the interest as an expense (and as owed) as each month (or year) ends, without waiting for the payment">
                <input type="checkbox" name="postInterestMonthly" ${claim?.postInterestMonthly ? 'checked' : ''}> Book the interest automatically as it falls due
                <b class="post-amount" data-post-amount></b></label>
            <div class="xp-claim-line" data-preview></div>
            ${claim ? `<div data-ev-entry="${claim.journalEntryId}" data-ev-count="${claim.attachmentCount || 0}"></div>` : evidenceFieldHtml({ hint: 'Bill, promissory note or transfer screenshot' })}
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            evidence = bindEvidenceField(m.el);
            const preview = () => {
                const amount = Number(form.amount.value || 0);
                const rate = Number(form.interestRate.value || 0);
                const yearly = form.interestType.value === 'COMPOUND' ? amount * (Math.pow(1 + rate / 1200, 12) - 1) : amount * rate / 100;
                form.querySelector('[data-preview]').innerHTML = !amount ? `${icon('info')} Booked to Payables as money you owe; record payments from the expanded row.`
                    : rate ? `${icon('trending')} Costs <b>${money(Math.round(amount * rate / 1200))}</b> in the first month and <b>${money(Math.round(yearly))}</b> in a year: <b>${money(Math.round(amount + yearly))}</b> to repay after 12 months.`
                    : `${icon('info')} No interest: you will repay <b>${money(amount)}</b>.`;
            };
            // what each monthly posting will book: principal x rate / 12 (30-day months)
            const postAmount = () => {
                const monthly = Number(form.amount.value || 0) * Number(form.interestRate.value || 0) / 1200;
                form.querySelector('[data-post-amount]').textContent = monthly > 0 ? `${money(Math.round(monthly))} a month` : '';
            };
            form.addEventListener('input', () => { preview(); postAmount(); });
            postAmount();
            form.addEventListener('click', e => {
                const k = e.target.closest('[data-kind]');
                if (k && !k.disabled) {
                    current = k.dataset.kind;
                    form.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('selected', b === k));
                    form.querySelector('[data-counter-label]').textContent = KINDS[current].counter + ' *';
                    form.querySelector('[data-counter]').innerHTML = counterSelect(current);
                    form.party.closest('.field').querySelector('span').textContent = KINDS[current].party + ' *';
                }
                const d = e.target.closest('[data-due]');
                if (d) { form.dueDate.value = d.dataset.due; form.querySelectorAll('[data-due]').forEach(b => b.classList.toggle('selected', b === d)); }
            });
            preview();
        },
        actions: [{ label: 'Cancel' }, {
            label: claim ? 'Save changes' : 'Save', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const payload = {
                    kind: current, party: d.party, narration: d.narration, amount: d.amount, startDate: d.startDate,
                    dueDate: d.dueDate, interestRate: d.interestRate, interestType: d.interestRate ? d.interestType : 'SIMPLE',
                    paidFromAccountId: d.paidFromAccountId ? Number(d.paidFromAccountId) : null,
                    categoryId: d.categoryId ? Number(d.categoryId) : null,
                    receivableAccountId: d.receivableAccountId ? Number(d.receivableAccountId) : null,
                    reference: d.reference, notes: d.notes, version: claim?.version ?? null,
                    postInterestMonthly: !!d.interestRate && form.postInterestMonthly.checked && form.interestCollection.value !== 'ON_PAYMENT',
                    interestCollection: d.interestRate ? form.interestCollection.value : null,
                    interestAccountId: d.interestAccountId ? Number(d.interestAccountId) : null,
                };
                const saved = claim ? await api.put(`/claims/${claim.id}`, payload, { key: saveKey }) : await api.post('/claims', payload, { key: saveKey });
                await evidence?.uploadTo(saved.journalEntryId);
                toast(`${saved.kindLabel} · you owe ${saved.party} ${money(saved.outstanding)}`);
                onSaved?.(saved);
            },
        }],
    });
}
