/**
 * The "Add expense" dialog. One dialog, three things you do with money going out:
 *   Expense           -> Dr Expenses [category], Cr the account you paid from
 *   Paid for someone  -> Dr Receivables (they owe you), Cr the account you paid from
 *   Lent money        -> Dr Receivables, Cr the account, optional due date and interest
 *   On EMI            -> Dr Expenses [category], Cr EMI · <what> (a loan account made for it); then each month
 *                        Dr EMI · <what> (principal) + Expenses [Loan Interest], Cr the card or the bank
 *                        (Expenses › EMIs: months, interest, the first and last EMI worked out from each other)
 *
 * Built to need as few clicks as possible: big amount field (sums such as 120+45 are added up), date chips,
 * the ten categories you use most (often and lately; everyday ones and bills due early in the month first) as tiles with Alt+1…9 to pick them, the rest one click
 * away or found by typing; the description picks the category by itself when it matches a past expense,
 * only the accounts you can actually pay from (most used first, no scrolling), optional notes,
 * a live budget check. Enter saves, Shift+Enter saves and starts the next one.
 *
 *   openExpenseDialog({ onSaved })                       new expense
 *   openExpenseDialog({ mode: 'LENT' })                  start in another mode
 *   openExpenseDialog({ expense, onSaved })              edit (expense = row from /api/expenses)
 *   openExpenseDialog({ expense, copy: true })           duplicate as a new expense
 *   openExpenseDialog({ claim, onSaved })                edit money lent / paid for someone
 */
import { api, newRequestKey } from '../core/api.js';
import { loadAccounts, categoriesOf } from '../core/store.js';
import { openModal, esc, toast, readForm, accountOptions } from '../core/ui.js';
import { interestAccountFilter } from './claim-panel.js';
import { icon, categoryIcon, accountTypeIcon } from '../core/icons.js';
import { loadSuggestions } from '../core/autocomplete.js';
import { money, moneyShort, isoDate, currencySymbol, percent, date } from '../core/format.js';
import { openJournalEditor } from './transaction-forms.js';
import { evidenceFieldHtml, bindEvidenceField } from './evidence.js';
import { addMonths, monthsBetween, emiPreviewHtml } from './emi.js';

/** Display order of payment accounts with equal use. Payables = "pay later" (expenses only). */
const typeRank = a => ({ BANK: 0, CREDIT_CARD: 1, CASH: 2, WALLET: 3, PAYABLE: 4 }[a.accountType] ?? 9);
const VISIBLE_PAYERS = 6;
/** Category tiles shown before "All categories". */
/** Category tiles shown before "All": two full rows of the five-column grid; the rest are a search away. */
const TOP_CATEGORIES = 10;
/**
 * A head start for the everyday categories, so a new household sees the right ten before it has any history (a
 * fraction of one real use: what you actually use soon takes over).
 */
const EVERYDAY = [/^groceries$/i, /milk/i, /vegetable/i, /dining|food deliver/i, /fuel|transport/i, /^shopping$/i, /mobile|internet/i,
    /utilit/i, /medic|pharma/i, /maid/i, /snack/i, /cab|auto/i];
const everydayBoost = c => { const i = EVERYDAY.findIndex(re => re.test(c.name)); return i < 0 ? 0 : 0.9 - i * 0.05; };
/** Bills that come once a month: early in the month, one used before but not yet this month moves up. */
const MONTHLY = /rent|maid|milk|gym|subscription|mobile|internet|dth|cable|newspaper|water can|utilit|insurance|school|tuition|education/i;
/** What each mode records, for the history suggestions (voucher types). */
const SUGGEST_KINDS = { EXPENSE: 'EXPENSE', PAID_FOR: 'PAID_FOR,LENDING,REPAYMENT', LENT: 'LENDING,PAID_FOR,REPAYMENT', EMI: 'EXPENSE' };
/** Months offered as chips on EMI. */
const EMI_MONTHS = [3, 6, 9, 12, 18, 24];

const MODES = {
    EXPENSE: { label: 'Expense', iconName: 'receipt', party: 'Paid to', partyHint: 'Shop / person (optional)' },
    PAID_FOR: { label: 'Paid for someone', iconName: 'users', party: 'Paid for', partyHint: 'Who will pay you back' },
    LENT: { label: 'Lent money', iconName: 'hand', party: 'Lent to', partyHint: 'Who borrowed it' },
    EMI: { label: 'On EMI', iconName: 'calendar', party: 'Bought from', partyHint: 'Shop (optional)' },
};

export async function openExpenseDialog({ expense = null, copy = false, claim = null, emi = null, mode = 'EXPENSE', onSaved } = {}) {
    let saveKey = newRequestKey();   // one key per save: a retry or a second click saves once (renewed after each save)
    if (expense && !copy && expense.viaJournal) {
        // part of a manual journal voucher: edited as a full journal
        openJournalEditor({ entry: await api.get(`/transactions/${expense.entryId}`), onSaved });
        return;
    }
    const editingExpense = expense && !copy;
    const editingClaim = !!claim;
    const editingEmi = !!emi;
    let current = claim ? claim.kind : emi ? 'EMI' : mode;
    const emiKind = emi?.kind || 'CARD';
    // once an EMI is billed or paid its terms stay as they are (undo those to change them)
    const locked = emi && !emi.editable ? 'disabled' : '';

    const [accounts, history, budgets, claimList, expenseCategories] = await Promise.all([
        loadAccounts(), loadSuggestions(), api.get('/budgets', { month: isoDate().slice(0, 7) }), api.get('/claims'),
        categoriesOf('EXPENSE', expense?.categoryId),
    ]);
    const usage = usageCounts(history);
    // most used first, recent use counting more (what you bought this week beats what you bought a lot last year);
    // system categories (chit commission ...) are booked by their features, so they come last
    // ... plus a head start for everyday categories (new users), and in the first days of a month the regular bills
    // not yet paid this month
    const earlyInMonth = new Date().getDate() <= 7;
    const dueBill = c => earlyInMonth && MONTHLY.test(c.name) && (c.entries || 0) > 0 && !Number(c.thisMonth) ? 3 : 0;
    const score = c => (usage.recent[c.id] || 0) * 3 + (usage.category[c.id] || 0) + Math.sqrt(c.entries || 0) + (Number(c.thisMonth) ? 2 : 0)
        + everydayBoost(c) + dueBill(c);
    const categories = [...expenseCategories].sort((a, b) => Number(!!a.systemKey) - Number(!!b.systemKey) || score(b) - score(a)
        || a.name.localeCompare(b.name));
    const payers = accounts.filter(a => a.active && ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'PAYABLE'].includes(a.accountType))
        .sort((a, b) => (usage.credit[b.id] || 0) - (usage.credit[a.id] || 0) || typeRank(a) - typeRank(b));
    const lastPayer = history.narration?.find(s => s.voucherType === 'EXPENSE' && s.creditAccountId)?.creditAccountId;

    const values = {
        amount: emi?.principal ?? claim?.amount ?? expense?.amount ?? '',
        entryDate: emi?.purchaseDate ?? claim?.startDate ?? (copy ? isoDate() : expense?.date ?? isoDate()),
        narration: emi?.narration ?? claim?.narration ?? expense?.narration ?? '',
        party: emi?.party ?? claim?.party ?? expense?.party ?? '',
        reference: emi?.reference ?? claim?.reference ?? (copy ? '' : expense?.reference ?? ''),
        notes: emi?.notes ?? claim?.notes ?? (copy ? '' : expense?.memo ?? ''),
        categoryId: emi?.categoryId ?? expense?.categoryId ?? '',
        paidFromId: emi?.payAccountId ?? claim?.paidFromAccountId ?? expense?.paidFromId ?? lastPayer ?? payers[0]?.id ?? '',
        dueDate: claim?.dueDate ?? '',
        interestRate: claim?.interestRate ?? '',
        interestType: claim?.interestType ?? 'SIMPLE',
        postInterestMonthly: claim ? claim.postInterestMonthly : false,   // booked when received unless asked
        interestCollection: claim?.interestCollection || 'MONTHLY',
        interestAccountId: claim && claim.interestAccountId !== claim.receivableAccountId ? claim.interestAccountId : '',
    };

    const body = `
    <form class="expense-form mode-${current} ${values.interestRate ? '' : 'no-rate'}" autocomplete="off" data-suggest-kinds="${SUGGEST_KINDS[current]}" data-emi-kind="${emiKind}" ${locked ? 'data-emi-locked' : ''}>
        <input type="hidden" name="categoryId" value="${values.categoryId}">
        <input type="hidden" name="paidFromId" value="${values.paidFromId}">
        <div class="xp-modes" role="tablist">${Object.entries(MODES).map(([key, m]) => `
            <button type="button" class="xp-mode" data-mode="${key}" ${(editingExpense && key !== 'EXPENSE') || (editingClaim && (key === 'EXPENSE' || key === 'EMI')) || (editingEmi && key !== 'EMI') ? 'disabled' : ''}>
                ${icon(m.iconName)}<span>${m.label}</span></button>`).join('')}
        </div>
        <div class="xp-grid">
            <section class="xp-left">
                <label class="xp-amount">
                    <span class="xp-currency">${esc(currencySymbol())}</span>
                    <input name="amount" type="text" inputmode="decimal" required data-plain autocomplete="off" ${locked}
                           placeholder="0" value="${values.amount}" class="num" title="You can type a sum: 120+45+30">
                </label>
                <div class="xp-amount-calc" data-amount-calc></div>
                <div class="xp-dates">
                    ${dateChip(0, 'Today')}${dateChip(1, 'Yesterday')}${dateChip(2, '2 days ago')}
                    <input type="date" name="entryDate" value="${values.entryDate}" max="${isoDate()}" required ${locked}>
                </div>
                <label class="field"><span data-narration-label>What was it for?</span>
                    <input name="narration" value="${esc(values.narration)}" placeholder="e.g. Weekly groceries, Uber to office" maxlength="255"></label>
                <div class="form-grid two">
                    <label class="field"><span data-party-label>${MODES[current].party}</span>
                        <input name="party" value="${esc(values.party)}" placeholder="${MODES[current].partyHint}" maxlength="100"></label>
                    <label class="field"><span>Bill / UPI ref</span><input name="reference" value="${esc(values.reference)}" maxlength="60" placeholder="Optional"></label>
                </div>
                <div class="claim-only form-grid two">
                    <label class="field"><span>Expect it back by</span><input type="date" name="dueDate" value="${values.dueDate}" data-dp-base="entryDate"></label>
                    <label class="field lent-only"><span>Interest <small class="muted">% a year</small></span>
                        <input name="interestRate" type="number" step="0.1" min="0" max="60" data-plain value="${values.interestRate}" placeholder="No interest"></label>
                    <div class="xp-due-chips span-2">
                        <span class="small muted">Due in</span>
                        ${dueChip(7, '1 week')}${dueChip(30, '1 month')}${dueChip(90, '3 months')}${dueChip(180, '6 months')}
                        <button type="button" class="date-chip" data-due="">No date</button>
                    </div>
                    <div class="lent-only span-2 xp-interest rate-dep ${values.interestCollection === 'ON_PAYMENT' ? 'on-payment' : ''}">
                        <input type="hidden" name="interestType" value="${values.interestType}">
                        <input type="hidden" name="interestCollection" value="${values.interestCollection}">
                        <div class="xi-row">
                            <span class="xi-label">${icon('percent')}Worked out as</span>
                            ${segPick('interestType', values.interestType, [
                                ['SIMPLE', 'Simple', 'Interest on the principal only'],
                                ['COMPOUND', 'Compound', 'Unpaid interest is added to the principal every month']])}
                        </div>
                        <div class="xi-row">
                            <span class="xi-label">${icon('calendar')}Collected</span>
                            ${segPick('interestCollection', values.interestCollection, [
                                ['MONTHLY', 'Every month', 'Interest falls due on each monthly anniversary of the loan'],
                                ['YEARLY', 'Every year', 'Interest falls due on each yearly anniversary of the loan'],
                                ['ON_PAYMENT', 'Whenever paid', 'It keeps adding up until they pay']])}
                        </div>
                        <label class="check-line xi-auto" title="Books the interest as income as each month (or year) ends, without waiting for the payment">
                            <input type="checkbox" name="postInterestMonthly" ${values.postInterestMonthly ? 'checked' : ''}>
                            <span>Book as income automatically when due</span>
                            <b class="post-amount" data-post-amount></b></label>
                        <label class="field" title="Receivables: interest is owed to you until paid. A bank account: the interest is received there every month.">
                            <span>Post interest to <small class="muted">optional</small></span>
                            <select name="interestAccountId">${accountOptions(accounts, interestAccountFilter('LENT'), values.interestAccountId, 'Receivables (default)')}</select></label>
                    </div>
                </div>
                <label class="field xp-notes"><span>Notes <small class="muted">optional</small></span>
                    <textarea name="notes" rows="2" maxlength="255" placeholder="Anything worth remembering: items, who was there, warranty…">${esc(values.notes)}</textarea></label>
                ${evidenceFieldHtml({ hint: 'Bill, receipt or UPI screenshot' })}
                <div class="xp-keys"><span><kbd>Enter</kbd> save</span>${editingExpense || editingClaim ? '' : '<span><kbd>Shift</kbd>+<kbd>Enter</kbd> save &amp; next</span>'}
                    <span class="expense-only"><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>9</kbd> category</span><span><kbd>Alt</kbd>+<kbd>↓</kbd> calendar</span></div>
            </section>
            <section class="xp-right">
                <div class="expense-only xp-cat-pick">
                    <div class="xp-section-head">
                        <span class="section-title">${icon('tag')} Category</span>
                        <span class="xp-cat-suggest" data-cat-suggest></span>
                    </div>
                    <div class="xp-cat-find">${icon('search')}<input class="xp-cat-search" placeholder="Find a category… Enter picks the first" data-plain data-enter-self>
                        ${categories.length > TOP_CATEGORIES ? `<button type="button" class="link-btn" data-all-cats>All ${categories.length}</button>` : ''}</div>
                    <div class="cat-grid" data-categories>${categories.map((c, i) => categoryTile(c, i >= TOP_CATEGORIES, i < 9 ? i + 1 : null)).join('')}</div>
                </div>
                <div class="claim-only xp-claim-info" data-claim-info></div>
                <div>
                    <div class="xp-section-head"><span class="section-title">${icon('wallet')} <span data-payer-head>Paid from</span></span>
                        <span class="small muted" data-payer-hint></span></div>
                    <div class="pay-grid" data-payers></div>
                </div>
                <div class="xp-budget expense-only" data-budget></div>
            </section>
            <section class="xp-emi-col emi-only">
                <div class="xp-section-head"><span class="section-title">${icon('calendar')} EMI terms</span>${emi && !emi.editable ? '<span class="small muted">fixed: EMIs are billed or paid</span>' : ''}</div>
                <div class="xp-emi">
                    <div class="xp-emi-kinds" data-emi-kinds>
                        <button type="button" class="date-chip ${emiKind === 'CARD' ? 'selected' : ''}" data-emi-kind="CARD" ${locked}>${icon('card')}Credit card EMI</button>
                        <button type="button" class="date-chip ${emiKind === 'LOAN' ? 'selected' : ''}" data-emi-kind="LOAN" ${locked}>${icon('briefcase')}Loan / finance EMI</button>
                    </div>
                    <div class="form-grid three">
                        <label class="field"><span>Months</span><input name="emiMonths" type="number" min="1" max="360" step="1" value="${emi?.months ?? 6}" ${locked} data-plain></label>
                        <label class="field"><span>Interest <small class="muted">% a year · 0 no-cost</small></span><input name="emiRate" type="number" min="0" max="60" step="0.01" placeholder="0" value="${emi && Number(emi.ratePercent) ? Number(emi.ratePercent) : ''}" ${locked} data-plain></label>
                        <label class="field"><span>Processing fee</span><input name="emiFee" type="number" min="0" step="any" placeholder="₹ 0" value="${emi && Number(emi.processingFee) ? Number(emi.processingFee) : ''}" ${locked} data-plain></label>
                    </div>
                    <div class="xp-due-chips"><span class="small muted">Months</span>${EMI_MONTHS.map(n => `<button type="button" class="date-chip" data-emi-months="${n}" ${locked}>${n}</button>`).join('')}</div>
                    <div class="form-grid three">
                        <label class="field"><span>First EMI on</span><input name="emiFirst" type="date" value="${emi?.firstDueDate || ''}" ${locked}></label>
                        <label class="field"><span>Last EMI <small class="muted">worked out</small></span><input name="emiLast" type="date" value="${emi?.endDate || ''}" title="Change it to set the months" ${locked}></label>
                        <label class="field"><span>GST on interest <small class="muted">%</small></span><input name="emiGst" type="number" min="0" max="50" step="any" value="${emi ? (Number(emi.gstPercent) || '') : 18}" ${locked} data-plain></label>
                    </div>
                    <div class="form-grid two">
                        <label class="field emi-loan-only"><span>Lender</span><input name="emiLender" maxlength="100" value="${esc(emi?.lender || '')}" placeholder="e.g. Bajaj Finserv, HDB Financial" data-plain></label>
                        <label class="check-line emi-auto"><input type="checkbox" name="emiAuto" ${emi ? (emi.autoPost ? 'checked' : '') : 'checked'}> <span data-emi-auto-label>Bill each EMI on the card by itself on its due date</span></label>
                    </div>
                </div>
                <div data-emi-preview></div>
            </section>
        </div>
    </form>`;

    const save = async (m, again) => {
        const form = m.el.querySelector('form');
        const total = evalAmount(form.amount.value);
        if (form.amount.value.trim() && total === null) { form.amount.focus(); throw new Error('The amount is not a number or a sum'); }
        if (total !== null) form.amount.value = String(total);
        const data = readForm(form);
        data.amount = total;
        if (!(total > 0)) { form.amount.focus(); throw new Error('Enter the amount'); }
        if (current === 'EXPENSE' && !data.categoryId) { form.querySelector('.xp-cat-search')?.focus(); throw new Error('Pick a category: type its name and press Enter, or Alt+1…9'); }
        if (!data.paidFromId) throw new Error('Pick the account you paid from');
        if (current !== 'EXPENSE' && current !== 'EMI' && !data.party) { form.party.focus(); throw new Error(`Enter who ${current === 'LENT' ? 'borrowed the money' : 'you paid for'}`); }
        if (current === 'EMI') {
            if (!data.categoryId) { form.querySelector('.xp-cat-search')?.focus(); throw new Error('Pick the category of what you bought'); }
            const months = Number(form.emiMonths.value);
            if (!(months >= 1 && months <= 360)) { form.emiMonths.focus(); throw new Error('Enter the number of months (1 to 360)'); }
            const kind = form.dataset.emiKind || 'CARD';
            const category = categories.find(c => c.id === Number(data.categoryId));
            const body = {
                kind, narration: data.narration || category.name, party: data.party || null, lender: kind === 'LOAN' ? form.emiLender.value.trim() || null : null,
                reference: data.reference || null, notes: data.notes || null, categoryId: Number(data.categoryId), principal: total,
                ratePercent: Number(form.emiRate.value) || 0, months, processingFee: Number(form.emiFee.value) || null, gstPercent: Number(form.emiGst.value) || null,
                purchaseDate: data.entryDate, firstDueDate: form.emiFirst.value || null, payAccountId: Number(data.paidFromId), autoPost: form.emiAuto.checked,
            };
            if (editingEmi && !emi.editable) {   // the terms stay as they were
                Object.assign(body, { kind: emi.kind, principal: emi.principal, ratePercent: emi.ratePercent, months: emi.months, processingFee: emi.processingFee,
                    gstPercent: emi.gstPercent, purchaseDate: emi.purchaseDate, firstDueDate: emi.firstDueDate, payAccountId: emi.payAccountId });
                if (emi.kind === 'CARD') body.lender = emi.lender;
            }
            const plan = editingEmi ? await api.put(`/expenses/emis/${emi.id}`, body, { key: saveKey }) : await api.post('/expenses/emis', body, { key: saveKey });
            saveKey = newRequestKey();
            await evidence.uploadTo(plan.purchaseEntryId);
            toast(editingEmi ? `${plan.narration} saved` : `${plan.narration} on EMI · ${plan.months} × ${money(plan.emiAmount)} from ${date(plan.firstDueDate)}`);
            onSaved?.();
            if (again) {
                ['amount', 'narration', 'party', 'reference', 'notes'].forEach(n => { form[n].value = ''; });
                form.dispatchEvent(new CustomEvent('expense-next'));
                form.amount.focus();
                form.amount.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }
        if (!form.reportValidity()) return true;

        let entryId;
        if (current === 'EXPENSE') {
            const category = categories.find(c => c.id === Number(data.categoryId));
            const payload = {
                entryDate: data.entryDate, amount: data.amount, categoryId: Number(data.categoryId),
                paidFromId: Number(data.paidFromId), narration: data.narration || category.name,
                party: data.party, reference: data.reference, notes: data.notes,
                version: editingExpense ? expense.version : null,
            };
            if (editingExpense) {
                await api.put(`/expenses/${expense.entryId}`, payload, { key: saveKey });
                entryId = expense.entryId;
                toast(`Expense updated · ${money(data.amount)}`);
            } else {
                const saved = await api.post('/expenses', payload, { key: saveKey });
                if (saved?.pending) {   // this user's expenses wait for a checker
                    await evidence.uploadTo(null, { pendingId: saved.id });
                    toast(`${money(saved.amount)} sent for approval`, 'info');
                    window.dispatchEvent(new Event('approvals-changed'));
                    onSaved?.();
                    saveKey = newRequestKey();   // the next one is a new expense
                    return again ? (form.amount.value = '', form.amount.focus(), true) : undefined;
                }
                entryId = saved.id;
                toast(`${category.name} · ${money(saved.amount)} saved as ${saved.entryNo}`);
            }
        } else {
            const payload = {
                kind: current, party: data.party, narration: data.narration, amount: data.amount,
                startDate: data.entryDate, dueDate: data.dueDate || null,
                interestRate: current === 'LENT' && data.interestRate ? data.interestRate : null,
                interestType: current === 'LENT' && data.interestRate ? data.interestType : 'SIMPLE',
                paidFromAccountId: Number(data.paidFromId), reference: data.reference, notes: data.notes,
                version: editingClaim ? claim.version : null,
                postInterestMonthly: current === 'LENT' && !!data.interestRate && form.postInterestMonthly.checked && form.interestCollection.value !== 'ON_PAYMENT',
                interestCollection: current === 'LENT' && data.interestRate ? form.interestCollection.value : null,
                interestAccountId: current === 'LENT' && form.interestAccountId.value ? Number(form.interestAccountId.value) : null,
            };
            const saved = editingClaim ? await api.put(`/claims/${claim.id}`, payload, { key: saveKey }) : await api.post('/claims', payload, { key: saveKey });
            entryId = saved.journalEntryId;
            toast(`${saved.kindLabel} · ${money(saved.amount)} to collect from ${saved.party}`);
        }
        saveKey = newRequestKey();   // saved: the next one ("add another") is a new entry
        await evidence.uploadTo(entryId);
        onSaved?.();
        if (again) {
            ['amount', 'narration', 'party', 'reference', 'notes'].forEach(n => { form[n].value = ''; });
            form.dispatchEvent(new CustomEvent('expense-next'));
            form.amount.focus();
            form.amount.dispatchEvent(new Event('input', { bubbles: true }));
            return true;   // keep the dialog open
        }
        return false;
    };

    const title = editingEmi ? `Edit EMI · ${emi.narration}` : editingExpense ? 'Edit expense' : editingClaim ? `Edit · ${claim.kindLabel}` : copy ? 'Duplicate expense' : 'Add expense';
    const modal = openModal({
        title, iconName: 'receipt', size: 'lg expense-modal', body,
        actions: [
            ...(editingExpense || editingClaim || editingEmi ? [] : [{ label: 'Save & add another', iconName: 'plus', left: true, onClick: m => save(m, true) }]),
            { label: 'Cancel' },
            { label: editingExpense || editingClaim || editingEmi ? 'Save changes' : 'Save', kind: 'primary', iconName: 'check', onClick: m => save(m, false) },
        ],
    });

    bind(modal.el.querySelector('form'), { categories, budgets, payers, claimList, history, setMode: m => { current = m; },
        allPayers: accounts.filter(a => a.active && ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET'].includes(a.accountType))
            .sort((a, b) => (usage.credit[b.id] || 0) - (usage.credit[a.id] || 0) || typeRank(a) - typeRank(b)) });
    const evidence = bindEvidenceField(modal.el);
    setTimeout(() => modal.el.querySelector('[name=amount]').focus(), 40);
}

// ===================================================================== pieces

function dateChip(daysAgo, label) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return `<button type="button" class="date-chip" data-date="${isoDate(d)}">${label}</button>`;
}

// a small segmented choice that writes into the hidden input of the same name
function segPick(name, value, options) {
    return `<span class="seg-chips xi-seg" data-seg="${name}">${options.map(([v, label, title]) =>
        `<button type="button" class="seg-chip ${v === value ? 'active' : ''}" data-seg-value="${v}" title="${title}">${label}</button>`).join('')}</span>`;
}

function dueChip(days, label) {
    return `<button type="button" class="date-chip" data-due-days="${days}">${label}</button>`;
}

function categoryTile(c, extra, key = null) {
    const { name, tone } = categoryIcon(c.name);
    return `<button type="button" class="cat-tile ${extra ? 'extra' : ''}" data-category="${c.id}" data-search="${esc(c.name.toLowerCase())}"
        title="${esc(c.name)}${c.entries ? ` · used ${c.entries}×` : ''}${key ? ` · Alt+${key}` : ''}">
        <span class="chip-icon sm ${tone}">${icon(name)}</span><span class="cat-name">${esc(c.name)}</span>${key ? `<kbd class="cat-key">${key}</kbd>` : ''}</button>`;
}

/** "120+45-10" or "3*40" -> the number (two decimals); null when it is not a plain sum. */
export function evalAmount(text) {
    const t = String(text ?? '').replace(/[,\s₹]/g, '');
    if (!t) return null;
    if (!/^[\d.+\-*/()]+$/.test(t)) return null;
    try {
        const v = Function(`"use strict"; return (${t});`)();
        return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    } catch { return null; }
}

function payerChip(a) {
    const { name, tone } = accountTypeIcon(a.accountType);
    const sub = a.accountType === 'PAYABLE' ? 'Pay later' : a.accountType === 'CREDIT_CARD'
        ? `Card · ${moneyShort(a.balance)} used` : `${esc(a.typeLabel)} · ${moneyShort(a.balance)}`;
    return `<button type="button" class="pay-chip" data-payer="${a.id}" title="${esc(a.name)}">
        <span class="chip-icon sm ${tone}">${icon(name)}</span>
        <span class="pay-text"><b>${esc(a.name)}</b><small>${sub}</small></span></button>`;
}

/** How often each category was used and each account paid (credited) in past entries. */
function usageCounts(history) {
    const category = {}, credit = {}, recent = {};
    const now = Date.now();
    (history.narration || []).forEach(s => {
        if (s.categoryId && s.voucherType === 'EXPENSE') {
            category[s.categoryId] = (category[s.categoryId] || 0) + s.count;
            // used lately counts more: full weight this week, fading over three months
            const days = s.lastUsed ? (now - new Date(s.lastUsed + (s.lastUsed.length === 10 ? 'T00:00:00' : '')).getTime()) / 86400000 : 365;
            recent[s.categoryId] = (recent[s.categoryId] || 0) + s.count * Math.max(0, 1 - days / 90);
        }
        if (s.creditAccountId) credit[s.creditAccountId] = (credit[s.creditAccountId] || 0) + s.count;
    });
    return { category, credit, recent };
}

function bind(form, { categories, budgets, payers, allPayers, claimList, history, setMode }) {
    const select = (attr, value) => {
        form.querySelectorAll(`[data-${attr}]`).forEach(el => el.classList.toggle('selected', el.dataset[attr] === String(value)));
    };
    let showAllPayers = false;
    let mode = [...form.classList].find(c => c.startsWith('mode-')).slice(5);

    const grid = form.querySelector('[data-categories]');
    let autoPicked = false;   // the category came from the description, not from a click
    const amountOf = () => evalAmount(form.amount.value) || 0;
    const setCategory = (id, auto = false) => {
        autoPicked = auto;
        form.categoryId.value = id;
        select('category', id);
        // a picked category beyond the top tiles stays visible
        grid.querySelectorAll('.cat-tile.extra').forEach(t => t.classList.toggle('pinned', t.dataset.category === String(id)));
        updateBudget();
        suggestCategory();
    };
    const setPayer = id => { form.paidFromId.value = id; select('payer', id); };
    const setDate = d => { form.entryDate.value = d; select('date', d); };

    /** Only accounts you can pay this kind of thing from; the most used first, the rest behind "More". */
    function renderPayers() {
        const emiKind = form.dataset.emiKind || 'CARD';
        const allowed = mode === 'EMI' ? allPayers.filter(a => emiKind === 'CARD' ? a.accountType === 'CREDIT_CARD' : ['BANK', 'CASH', 'WALLET'].includes(a.accountType))
            : payers.filter(a => mode === 'EXPENSE' || a.accountType !== 'PAYABLE');
        const selectedId = Number(form.paidFromId.value);
        if (!allowed.some(a => a.id === selectedId)) form.paidFromId.value = allowed[0]?.id ?? '';
        let visible = showAllPayers ? allowed : allowed.slice(0, VISIBLE_PAYERS);
        const chosen = allowed.find(a => a.id === Number(form.paidFromId.value));
        if (chosen && !visible.includes(chosen)) visible = [...visible.slice(0, VISIBLE_PAYERS - 1), chosen];
        const hidden = allowed.length - visible.length;
        form.querySelector('[data-payers]').innerHTML = visible.map(payerChip).join('')
            + (hidden > 0 ? `<button type="button" class="pay-chip more" data-more-payers>${icon('more')}<span class="pay-text"><b>${hidden} more</b><small>show all</small></span></button>` : '');
        form.querySelector('[data-payer-hint]').textContent = mode === 'EXPENSE' ? 'bank, card, cash, wallet or pay later'
            : mode === 'EMI' ? (emiKind === 'CARD' ? (allowed.length ? 'the card the EMIs are billed to' : 'no credit card yet: add one in Accounts') : 'the account each EMI is paid from')
            : 'bank, card, cash or wallet';
        const head = form.querySelector('[data-payer-head]');
        if (head) head.textContent = mode === 'EMI' ? (emiKind === 'CARD' ? 'EMIs billed to' : 'EMIs paid from') : 'Paid from';
        select('payer', form.paidFromId.value);
    }

    function applyMode(next) {
        mode = next;
        setMode(next);
        form.className = `expense-form mode-${next} ${Number(form.interestRate.value) > 0 ? '' : 'no-rate'}`;
        form.closest('.modal')?.classList.toggle('emi-wide', next === 'EMI');
        form.dataset.suggestKinds = SUGGEST_KINDS[next];
        form.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('selected', b.dataset.mode === next));
        form.querySelector('[data-party-label]').textContent = MODES[next].party;
        form.party.placeholder = MODES[next].partyHint;
        form.party.required = next !== 'EXPENSE';
        form.querySelector('[data-narration-label]').textContent = next === 'EXPENSE' ? 'What was it for?' : next === 'LENT' ? 'Purpose (optional)' : next === 'EMI' ? 'What did you buy?' : 'What did you pay for?';
        form.narration.placeholder = next === 'EXPENSE' ? 'e.g. Weekly groceries, Uber to office'
            : next === 'LENT' ? 'e.g. Hand loan for bike repair' : next === 'EMI' ? 'e.g. iPhone 16, Samsung fridge, laptop' : "e.g. Movie tickets, Mom's medicines";
        const heading = form.closest('.modal')?.querySelector('[data-modal-title]');
        if (heading && /^Add /.test(heading.textContent)) {
            heading.textContent = next === 'EXPENSE' ? 'Add expense' : next === 'LENT' ? 'Add money lent' : next === 'EMI' ? 'Add a purchase on EMI' : 'Add payment for someone';
        }
        renderPayers();
        updateClaimInfo();
        updateEmi();
    }

    setCategory(form.categoryId.value);
    setDate(form.entryDate.value);
    applyMode(mode);

    form.addEventListener('click', e => {
        const cat = e.target.closest('[data-category]');
        const pay = e.target.closest('[data-payer]');
        const day = e.target.closest('[data-date]');
        const due = e.target.closest('[data-due-days], [data-due]');
        const modeBtn = e.target.closest('[data-mode]');
        if (cat) setCategory(cat.dataset.category);   // a click is a choice: the description no longer changes it
        if (pay && !form.hasAttribute('data-emi-locked')) setPayer(pay.dataset.payer);
        if (day) setDate(day.dataset.date);
        if (modeBtn && !modeBtn.disabled) applyMode(modeBtn.dataset.mode);
        const seg = e.target.closest('[data-seg-value]');
        if (seg) {
            const group = seg.closest('[data-seg]');
            const input = form.elements[group.dataset.seg];
            group.querySelectorAll('[data-seg-value]').forEach(b => b.classList.toggle('active', b === seg));
            input.value = seg.dataset.segValue;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (input.name === 'interestCollection') form.querySelector('.xp-interest').classList.toggle('on-payment', input.value === 'ON_PAYMENT');
        }
        if (e.target.closest('[data-more-payers]')) { showAllPayers = true; renderPayers(); }
        if (due) {
            if (due.dataset.dueDays) {
                const d = new Date(form.entryDate.value + 'T00:00:00');
                d.setDate(d.getDate() + Number(due.dataset.dueDays));
                form.dueDate.value = isoDate(d);
            } else {
                form.dueDate.value = '';
            }
            form.querySelectorAll('.xp-due-chips .date-chip').forEach(c => c.classList.toggle('selected', c === due));
        }
    });
    form.entryDate.addEventListener('change', () => select('date', form.entryDate.value));
    // a sum in the amount box is worked out as you type and settled on leaving it
    const calc = form.querySelector('[data-amount-calc]');
    const showCalc = () => {
        const v = evalAmount(form.amount.value);
        const isSum = /[+\-*/]/.test(form.amount.value.trim().replace(/^-/, ''));
        calc.innerHTML = isSum ? (v === null ? '<span class="neg">not a sum</span>' : `= <b>${money(v)}</b>`) : '';
    };
    form.amount.addEventListener('input', () => { showCalc(); updateBudget(); updateClaimInfo(); updateEmi(); });
    form.amount.addEventListener('blur', () => {
        const v = evalAmount(form.amount.value);
        if (v !== null && String(v) !== form.amount.value.trim()) { form.amount.value = String(v); showCalc(); updateBudget(); updateClaimInfo(); }
    });
    form.addEventListener('expense-next', () => { calc.innerHTML = ''; autoPicked = false; });
    // Alt+1…9 picks one of the top category tiles from anywhere in the dialog
    form.closest('.modal')?.addEventListener('keydown', e => {
        if (!e.altKey || mode !== 'EXPENSE' || !/^Digit[1-9]$/.test(e.code)) return;
        const tile = grid.querySelectorAll('.cat-tile:not(.extra)')[Number(e.code.slice(5)) - 1];
        if (tile) { e.preventDefault(); setCategory(tile.dataset.category); tile.classList.add('auto-picked'); setTimeout(() => tile.classList.remove('auto-picked'), 900); }
    });
    form.party.addEventListener('input', updateClaimInfo);
    form.party.addEventListener('suggestpick', () => setTimeout(updateClaimInfo, 0));
    form.interestRate.addEventListener('input', updateClaimInfo);
    // collection, automatic booking and the interest account only matter once there is a rate
    const syncRate = () => form.classList.toggle('no-rate', !(Number(form.interestRate.value) > 0));
    form.interestRate.addEventListener('input', syncRate);
    // what each monthly posting will book: principal x rate / 12 (30-day months)
    const postAmount = () => {
        const monthly = amountOf() * Number(form.interestRate.value || 0) / 1200;
        form.querySelector('[data-post-amount]').textContent = monthly > 0 ? `${money(Math.round(monthly))} a month` : '';
    };
    ['input', 'change'].forEach(t => { form.amount.addEventListener(t, postAmount); form.interestRate.addEventListener(t, postAmount); });
    postAmount();
    form.interestType.addEventListener('change', updateClaimInfo);

    // ---- on EMI: the months, the first and the last EMI follow each other; the preview follows everything
    let firstTouched = !!form.emiFirst.value;
    const emiLast = () => { const m = Number(form.emiMonths.value); if (form.emiFirst.value && m >= 1) form.emiLast.value = addMonths(form.emiFirst.value, m - 1); };
    const emiDefaults = () => { if (!firstTouched && form.entryDate.value) form.emiFirst.value = addMonths(form.entryDate.value, 1); emiLast(); };
    function updateEmi() {
        if (mode !== 'EMI') return;
        const kind = form.dataset.emiKind || 'CARD';
        form.classList.toggle('emi-loan', kind === 'LOAN');
        form.querySelector('[data-emi-auto-label]').textContent = kind === 'CARD' ? 'Bill each EMI on the card by itself on its due date' : 'Pay each EMI by itself on its due date';
        form.querySelectorAll('[data-emi-months]').forEach(c => c.classList.toggle('selected', c.dataset.emiMonths === form.emiMonths.value));
        form.querySelector('[data-emi-preview]').innerHTML = emiPreviewHtml({ principal: amountOf(), rate: Number(form.emiRate.value) || 0, months: Number(form.emiMonths.value) || 0,
            gst: Number(form.emiGst.value) || 0, fee: Number(form.emiFee.value) || 0, first: form.emiFirst.value, kind });
    }
    if (!form.dataset.emiKind) form.dataset.emiKind = 'CARD';
    emiDefaults();
    updateEmi();
    form.addEventListener('click', e => {
        const k = e.target.closest('[data-emi-kind]');
        if (k && !k.disabled) {
            form.dataset.emiKind = k.dataset.emiKind;
            form.querySelectorAll('[data-emi-kind]').forEach(b => b.classList.toggle('selected', b === k));
            // a card EMI usually carries GST on its interest and books itself; a finance company's is paid by hand
            form.emiGst.value = k.dataset.emiKind === 'CARD' ? (form.emiGst.value || 18) : '';
            form.emiAuto.checked = k.dataset.emiKind === 'CARD';
            renderPayers();
            updateEmi();
        }
        const mo = e.target.closest('[data-emi-months]');
        if (mo) { form.emiMonths.value = mo.dataset.emiMonths; emiLast(); updateEmi(); }
        if (e.target.closest('[data-date]')) { emiDefaults(); updateEmi(); }
    });
    form.entryDate.addEventListener('change', () => { emiDefaults(); updateEmi(); });
    form.emiMonths.addEventListener('input', () => { emiLast(); updateEmi(); });
    form.emiFirst.addEventListener('change', () => { firstTouched = true; emiLast(); updateEmi(); });
    // the last EMI typed in sets the months
    form.emiLast.addEventListener('change', () => {
        if (!form.emiFirst.value || !form.emiLast.value) return;
        const m = monthsBetween(form.emiFirst.value, form.emiLast.value) + 1;
        if (m >= 1) { form.emiMonths.value = m; emiLast(); }
        updateEmi();
    });
    ['emiRate', 'emiGst', 'emiFee'].forEach(n => form[n].addEventListener('input', updateEmi));
    form.addEventListener('expense-next', () => { firstTouched = false; emiDefaults(); updateEmi(); });

    // find a category: typing searches all of them, Enter picks the first match
    const catSearch = form.querySelector('.xp-cat-search');
    catSearch.addEventListener('input', () => {
        const term = catSearch.value.trim().toLowerCase();
        grid.classList.toggle('searching', !!term);
        grid.querySelectorAll('.cat-tile').forEach(t => { t.hidden = !!term && !t.dataset.search.includes(term); });
    });
    catSearch.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = [...grid.querySelectorAll('.cat-tile')].find(t => !t.hidden && (catSearch.value.trim() || !t.classList.contains('extra')));
        if (first) { setCategory(first.dataset.category); catSearch.value = ''; catSearch.dispatchEvent(new Event('input')); }
    });
    form.querySelector('[data-all-cats]')?.addEventListener('click', e => {
        const open = grid.classList.toggle('show-all');
        e.target.textContent = open ? 'Fewer' : `All ${categories.length}`;
    });

    /** The description hints the category: a past expense with the same words, or a category named in it. */
    function suggestCategory() {
        const box = form.querySelector('[data-cat-suggest]');
        const text = form.narration.value.trim().toLowerCase();
        let hit = null;
        if (text.length >= 3 && mode === 'EXPENSE') {
            const past = (history.narration || []).find(s => s.categoryId && s.kinds?.includes('EXPENSE')
                && (s.value.toLowerCase() === text || s.value.toLowerCase().startsWith(text)));
            hit = categories.find(c => c.id === past?.categoryId)
                || categories.find(c => text.split(/\s+/).some(w => w.length >= 3 && c.name.toLowerCase().includes(w)));
        }
        if (hit && String(hit.id) !== form.categoryId.value && (!form.categoryId.value || autoPicked)) {
            setCategory(String(hit.id), true);
            const tile = grid.querySelector(`[data-category="${hit.id}"]`);
            tile?.classList.add('auto-picked');
            setTimeout(() => tile?.classList.remove('auto-picked'), 900);
            box.innerHTML = `<span class="small muted" title="Picked from the description; click another tile to change it">${icon('sparkles')}from the description</span>`;
            return;
        }
        box.innerHTML = hit && String(hit.id) !== form.categoryId.value
            ? `<button type="button" class="date-chip suggest" data-category="${hit.id}" title="Suggested from the description">${icon('sparkles')}${esc(hit.name)}</button>`
            : autoPicked ? `<span class="small muted">${icon('sparkles')}from the description</span>` : '';
    }
    let suggestTimer;
    form.narration.addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer = setTimeout(suggestCategory, 250); });

    // Picking a past description fills the category, payer and usual amount
    form.narration.addEventListener('suggestpick', e => {
        const s = e.detail;
        if (s.voucherType !== 'EXPENSE' || mode !== 'EXPENSE') return;
        if (s.categoryId && categories.some(c => c.id === s.categoryId) && (!form.categoryId.value || autoPicked)) setCategory(s.categoryId, true);
        if (s.creditAccountId && payers.some(a => a.id === s.creditAccountId)) { form.paidFromId.value = s.creditAccountId; renderPayers(); }
        if (!form.amount.value && s.amount) { form.amount.value = s.amount; updateBudget(); }
    });

    /** For lent / paid-for: what this person already owes, and the interest this loan would earn. */
    function updateClaimInfo() {
        const box = form.querySelector('[data-claim-info]');
        if (mode === 'EXPENSE' || mode === 'EMI') return;
        const name = form.party.value.trim().toLowerCase();
        const open = claimList.claims.filter(c => Number(c.outstanding) > 0 && name && c.party.toLowerCase() === name);
        const owed = open.reduce((s, c) => s + Number(c.outstanding), 0);
        const amount = amountOf();
        const rate = Number(form.interestRate.value || 0);
        const people = [...new Map(claimList.claims.filter(c => Number(c.outstanding) > 0).map(c => [c.party, c])).keys()].slice(0, 6);
        box.innerHTML = `
            <div class="xp-claim-card">
                <span class="chip-icon ${mode === 'LENT' ? 'violet' : 'aqua'}">${icon(mode === 'LENT' ? 'hand' : 'users')}</span>
                <div class="grow">
                    <b>${mode === 'LENT' ? 'Tracked as money lent' : 'Tracked as paid on behalf'}</b>
                    <div class="small muted">Booked to Receivables, not to your expenses. Record repayments, even partial, from the expanded row.</div>
                </div>
            </div>
            ${name && open.length ? `<div class="xp-claim-line warn">${icon('alert')} ${esc(form.party.value)} already owes <b>${money(owed)}</b> on ${open.length} item${open.length > 1 ? 's' : ''}. After this: <b>${money(owed + amount)}</b></div>` : ''}
            ${mode === 'LENT' && rate > 0 && amount > 0 ? interestPreview(amount, rate, form.interestType.value) : ''}
            ${people.length ? `<div class="xp-people"><span class="small muted">Owes you now</span>${people.map(p => `<button type="button" class="date-chip" data-person="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}`;
        box.querySelectorAll('[data-person]').forEach(b => b.addEventListener('click', () => { form.party.value = b.dataset.person; updateClaimInfo(); }));
    }

    function updateBudget() {
        const box = form.querySelector('[data-budget]');
        const id = Number(form.categoryId.value);
        const line = budgets.lines.find(l => l.categoryId === id);
        const category = categories.find(c => c.id === id);
        if (!category) { box.innerHTML = `<span class="muted">${icon('info')} Pick a category to see its budget</span>`; return; }
        if (!line || line.monthlyLimit === null) {
            box.innerHTML = `<span class="muted">${icon('target')} No budget for ${esc(category.name)}${line ? ` · ${money(line.spent)} spent this month` : ''}</span>`;
            return;
        }
        const amount = amountOf();
        const after = Number(line.spent) + amount;
        const limit = Number(line.monthlyLimit);
        const used = (after / limit) * 100;
        const tone = used > 100 ? 'over' : used >= line.alertPercent ? 'warning' : 'good';
        box.innerHTML = `
            <div class="row small"><b>${esc(category.name)} budget</b><span class="spacer"></span>
                <span class="${used > 100 ? 'neg' : 'secondary'}">${money(after)} of ${money(limit)} · ${percent(used, 0)}</span></div>
            <div class="progress ${tone}"><span style="width:${Math.min(used, 100)}%"></span></div>
            <div class="small ${used > 100 ? 'neg' : 'muted'}">${used > 100
                ? `${icon('alert')} This takes you ${money(after - limit)} over budget`
                : `${money(limit - after)} left this month after this expense`}</div>`;
    }
}


/** One-year picture of a loan at interest: simple vs compound, and what would be payable. */
function interestPreview(amount, rate, type) {
    const simple = amount * rate / 100;
    const compound = amount * (Math.pow(1 + rate / 1200, 12) - 1);
    const chosen = type === 'COMPOUND' ? compound : simple;
    return `<div class="xp-claim-line">${icon('trending')} At ${rate}% a year (${type === 'COMPOUND' ? 'compound, monthly' : 'simple'}) this earns
        <b>${money(Math.round(amount * rate / 1200))}</b> in the first month and <b>${money(Math.round(chosen))}</b> in a year:
        payable <b>${money(Math.round(amount + chosen))}</b>.
        ${type === 'COMPOUND' ? `<span class="muted">Simple would be ${money(Math.round(simple))}.</span>`
                              : `<span class="muted">Compounding would add ${money(Math.round(compound - simple))} more.</span>`}</div>`;
}
