/**
 * The team's pay: a payment slip for a resource and a week (or month): the work it did and was not paid for yet (batches,
 * loading, trips), its wage or salary, a bonus, less part of an advance; an advance given (a slip of its own); and the
 * slip itself, printable with the company's stamp, the owner's and accountant's signatures and the digital signature.
 */
import { api } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { esc, field, readForm, openModal, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { slipDocHtml, verifyDoc, printDoc } from '../core/brick-docs.js';
import { loadMeta, num, count, today, moneyAccounts, moneyOptions, roleName } from './brick-common.js';

const KIND_ICON = { PRODUCTION: 'factory', LOADING: 'layers', UNLOADING: 'layers', TRIP: 'truck', WAGE: 'calendar', SALARY: 'briefcase', BONUS: 'gift' };

/** The slip for one resource and period, from its preview (the work due, the wage, advances to take back). */
export async function openSlip(resourceId, cycle, from, to, after) {
    const p = await api.get('/bricks/payroll/preview', { resourceId, cycle, from, to });
    const accounts = await moneyAccounts();
    const meta = await loadMeta();
    const r = p.resource.resource;
    openModal({
        title: `Pay ${r.name}`, iconName: 'users', size: 'lg', sub: `${cycle === 'MONTHLY' ? 'Monthly' : 'Weekly'} payment · ${date(from)} – ${date(to)}`,
        body: `<form class="bk-slip-form">
            <div class="section-title">${icon('check-circle')} Work to pay <span class="muted small">not paid on any slip yet</span></div>
            ${p.earnings.length ? `<div class="bk-earn">${p.earnings.map(e => `<label class="bk-earn-row ${e.earnedOn < from ? 'old' : ''}">
                <input type="checkbox" data-earning="${e.id}" data-amount="${e.amount}" checked>
                <span class="chip-icon sm">${icon(KIND_ICON[e.kind] || 'tag')}</span>
                <span class="grow min-0"><b>${esc(e.label)}</b><small class="ellipsis">${esc(e.narrative || '')}</small></span>
                <small class="muted">${date(e.earnedOn)}${e.earnedOn < from ? ' · earlier' : ''}</small><b>${money(e.amount)}</b></label>`).join('')}</div>`
                : '<p class="small muted">No work waiting to be paid.</p>'}
            ${r.salaryType !== 'PIECE' ? `<div class="form-grid two">
                ${field({ label: p.wageLabel || 'Wage', name: 'wage', type: 'number', value: p.wageNote ? 0 : p.wage, hint: p.wageNote ? esc(p.wageNote) : '' })}</div>` : ''}
            <div class="section-title">${icon('gift')} Bonus or incentive</div>
            <div data-bonuses></div><button type="button" class="link-btn" data-add-bonus>${icon('plus')}Add a bonus</button>
            ${p.advances.length ? `<div class="section-title">${icon('hand')} Advances to take back</div>
                <div class="bk-adv">${p.advances.map(a => `<div class="bk-adv-row"><div class="grow"><b>${esc(a.slipNo)}</b> · ${date(a.givenOn)} · ${money(a.amount)}
                    <small>“${esc(a.narrative)}” · ${money(a.outstanding)} still owed${a.recoverPerCycle ? ` · ${money(a.recoverPerCycle)} a ${cycle === 'MONTHLY' ? 'month' : 'week'} agreed` : ''}</small></div>
                    <label class="bk-adv-in">₹<input type="number" min="0" max="${a.outstanding}" step="any" class="num" data-deduct="${a.advanceId}" value="${num(a.suggested)}"></label></div>`).join('')}</div>` : ''}
            <div class="form-grid three">
                ${field({ label: 'Paid on', name: 'paidOn', type: 'date', value: today(), required: true })}
                ${field({ label: 'How', name: 'mode', type: 'select', value: 'Cash', options: ['Cash', 'UPI', 'Bank', 'Cheque'].map(x => ({ value: x, label: x })) })}
                ${field({ label: 'From', name: 'accountId', type: 'select', value: meta.settings.payAccountId, options: moneyOptions(accounts, meta.settings.payAccountId, 'Brick · cash') })}
                ${field({ label: 'Reference', name: 'reference' })}
                ${field({ label: 'Note on the slip', name: 'note', span: 'span-2' })}
            </div>
            <div class="bk-net" data-net></div>
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const recalc = () => {
                const earned = [...f.querySelectorAll('[data-earning]')].filter(i => i.checked).reduce((s, i) => s + num(i.dataset.amount), 0);
                const wage = num(f.wage?.value);
                const bonus = [...f.querySelectorAll('[data-bonus-amt]')].reduce((s, i) => s + num(i.value), 0);
                const ded = [...f.querySelectorAll('[data-deduct]')].reduce((s, i) => s + num(i.value), 0);
                const gross = earned + wage + bonus;
                f.querySelector('[data-net]').innerHTML = `<div><span>Earned</span><b>${money(gross)}</b></div>${ded ? `<div><span>Advance taken back</span><b class="neg">− ${money(ded)}</b></div>` : ''}
                    <div class="total"><span>To pay</span><b class="${gross - ded < 0 ? 'neg' : ''}">${money(gross - ded)}</b></div>`;
            };
            f.addEventListener('input', recalc);
            f.addEventListener('change', recalc);
            f.querySelector('[data-add-bonus]').addEventListener('click', () => {
                f.querySelector('[data-bonuses]').insertAdjacentHTML('beforeend', `<div class="bk-bonus"><input placeholder="What for (e.g. Diwali bonus)" data-bonus-label>
                    <input type="number" min="0" step="any" class="num" placeholder="₹" data-bonus-amt><button type="button" class="btn sm ghost icon" data-rm>${icon('x')}</button></div>`);
            });
            f.addEventListener('click', e => { const rm = e.target.closest('[data-rm]'); if (rm) { rm.parentElement.remove(); recalc(); } });
            recalc();
        },
        actions: [{ label: 'Cancel' }, { label: 'Pay and make the slip', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            const body = {
                resourceId, cycle, periodFrom: from, periodTo: to,
                earningIds: [...f.querySelectorAll('[data-earning]')].filter(i => i.checked).map(i => Number(i.dataset.earning)),
                wage: f.wage ? num(f.wage.value) : null,
                bonuses: [...f.querySelectorAll('.bk-bonus')].map(b => ({ label: b.querySelector('[data-bonus-label]').value.trim(), amount: num(b.querySelector('[data-bonus-amt]').value) }))
                    .filter(b => b.amount > 0 && b.label),
                deductions: [...f.querySelectorAll('[data-deduct]')].map(i => ({ advanceId: Number(i.dataset.deduct), amount: num(i.value) })).filter(x => x.amount > 0),
                paidOn: d.paidOn, mode: d.mode, accountId: d.accountId ? Number(d.accountId) : null, reference: d.reference, note: d.note,
            };
            const slip = await api.post('/bricks/payroll/slips', body);
            invalidateAccounts();
            after(slip, `Slip ${slip.slip.slipNo} made · ${money(slip.slip.net)} paid`);
            openSlipView(slip);
        } }],
    });
}

export async function openAdvance(resource, after) {
    const accounts = await moneyAccounts();
    const meta = await loadMeta();
    openModal({
        title: `Advance to ${resource.name}`, iconName: 'hand', sub: 'Given now, taken back from their coming payments',
        body: `<form class="form-grid two">
            ${field({ label: 'Amount (₹)', name: 'amount', type: 'number', required: true })}
            ${field({ label: 'Given on', name: 'givenOn', type: 'date', value: today(), required: true })}
            ${field({ label: 'Why (shows on every slip it is taken back on)', name: 'narrative', required: true, span: 'span-2', placeholder: 'For a family function' })}
            ${field({ label: `Take back each ${resource.salaryType === 'MONTHLY' ? 'month' : 'week'} (₹)`, name: 'recoverPerCycle', type: 'number', hint: 'Empty: all of it from the next payment' })}
            ${field({ label: 'How', name: 'mode', type: 'select', value: 'Cash', options: ['Cash', 'UPI', 'Bank', 'Cheque'].map(x => ({ value: x, label: x })) })}
            ${field({ label: 'From', name: 'accountId', type: 'select', value: meta.settings.payAccountId, options: moneyOptions(accounts, meta.settings.payAccountId, 'Brick · cash') })}
            ${field({ label: 'Reference', name: 'reference' })}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Give advance', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.resourceId = resource.id;
            if (d.accountId) d.accountId = Number(d.accountId);
            const slip = await api.post('/bricks/payroll/advances', d);
            invalidateAccounts();
            after(slip, `Advance ${slip.slip.slipNo} given`);
            openSlipView(slip);
        } }],
    });
}

// ===================================================================== the slip

/** The slip in a dialog, as its branded document: print it, see its digital signature checked, cancel it. */
export function openSlipView(v, { onCancelled } = {}) {
    openModal({
        title: `${v.slip.kind === 'ADVANCE' ? 'Advance' : 'Payment'} slip ${v.slip.slipNo}`, iconName: 'receipt', size: 'xl',
        sub: `${v.resource?.name || ''} · ${money(v.slip.net)} · ${date(v.slip.paidOn)}`,
        body: `<div class="bd-wrap">${slipDocHtml(v)}</div>`,
        onOpen: m => verifyDoc(m.el, v.slip.payload, v.slip.digitalSignature, v.publicKey),
        actions: [
            ...(v.slip.status === 'PAID' && onCancelled ? [{ label: 'Cancel slip', kind: 'danger', left: true, iconName: 'x', onClick: async () => {
                const nv = await api.post(`/bricks/payroll/slips/${v.slip.id}/cancel`);
                invalidateAccounts();
                toast(`Slip ${v.slip.slipNo} cancelled: its work is due again`);
                onCancelled(nv);
            } }] : []),
            { label: 'Close' },
            { label: 'Print', kind: 'primary', iconName: 'printer', onClick: () => { printSlip(v); return true; } },
        ],
    });
}

export function printSlip(v) {
    if (!printDoc(slipDocHtml(v), v.slip.slipNo)) toast('Allow pop-ups to print', 'error');
}
