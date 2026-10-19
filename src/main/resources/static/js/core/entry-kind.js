/**
 * What kind of entry a journal entry is, as an icon chip: expense, income, transfer, chit payment, money lent…
 * Lists show the chip beside the description instead of a "Type" column; the label is the tooltip.
 *   entryKind(voucherType)          { iconName, tone, label }
 *   kindChip(voucherType, size)     the chip markup ('xs' | 'sm')
 *   movementHtml(lines)             "Groceries → HDFC Card" style debit → credit summary
 */
import { icon } from './icons.js';
import { esc } from './ui.js';

const KINDS = {
    EXPENSE: { iconName: 'receipt', tone: 'coral', label: 'Expense' },
    INCOME: { iconName: 'arrow-in', tone: 'aqua', label: 'Income' },
    TRANSFER: { iconName: 'transfer', tone: '', label: 'Transfer' },
    CHIT_INSTALLMENT: { iconName: 'chit', tone: 'gold', label: 'Chit payment' },
    CHIT_PAYOUT: { iconName: 'gift', tone: 'aqua', label: 'Chit payout' },
    OPENING: { iconName: 'flag', tone: 'gray', label: 'Opening balance' },
    LENDING: { iconName: 'hand', tone: 'violet', label: 'Money lent' },
    PAID_FOR: { iconName: 'users', tone: 'violet', label: 'Paid for someone' },
    REPAYMENT: { iconName: 'arrow-in', tone: 'aqua', label: 'Repayment received' },
    BORROWING: { iconName: 'arrow-in', tone: 'coral', label: 'Money borrowed' },
    BILL_DUE: { iconName: 'receipt', tone: 'gold', label: 'Bill to pay' },
    REPAYMENT_MADE: { iconName: 'arrow-out', tone: '', label: 'Repayment paid' },
    WRITE_OFF: { iconName: 'x', tone: 'gray', label: 'Write-off' },
    INTEREST_ACCRUAL: { iconName: 'percent', tone: 'aqua', label: 'Interest' },
    REFUND: { iconName: 'arrow-in', tone: 'aqua', label: 'Refund' },
    REVERSAL: { iconName: 'undo', tone: 'gray', label: 'Reversal' },
    JOURNAL: { iconName: 'journal', tone: 'gray', label: 'Journal' },
};

export function entryKind(voucherType) {
    return KINDS[voucherType] || { iconName: 'journal', tone: 'gray', label: voucherType || 'Entry' };
}

export function kindChip(voucherType, size = 'sm', label = null) {
    const k = entryKind(voucherType);
    return `<span class="chip-icon ${size} ${k.tone} kind-chip" title="${esc(label || k.label)}">${icon(k.iconName)}</span>`;
}

/** Which accounts were debited → credited, e.g. "Groceries → HDFC Card". */
export function movementHtml(lines) {
    const names = side => [...new Set(lines.filter(l => Number(l[side]) > 0).map(l => l.accountName))];
    const debits = names('debit'), credits = names('credit');
    return `<span class="movement" title="Debit → credit"><span class="mv-dr">${esc(debits.join(', '))}</span>
        <span class="mv-arrow">→</span><span class="mv-cr">${esc(credits.join(', '))}</span></span>`;
}
