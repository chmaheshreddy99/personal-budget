/**
 * Maker side of maker-checker on the full site: what a user who needs approval has sent, what became of it, and
 * for an entry sent back (rejected) a quick way to correct it and send it again, or take it back.
 *
 *   openSubmissions({ onChanged })      the list, rejected ones first, each with its history
 *   resubmitDialog(p, { onDone })       correct a rejected (or waiting) entry and send it again
 *   historyHtml(p)                      the entry's steps in one quiet line (also used by the checker)
 */
import { api } from '../core/api.js';
import { esc, toast, confirmDialog, openModal, field, readForm, emptyState } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { money, date, dateTime, isoDate } from '../core/format.js';
import './evidence.js';   // evidence strips (data-ev-pending) fill themselves

export const STATE = {
    PENDING: ['warning', 'hourglass', 'Waiting'], APPROVED: ['good', 'check-circle', 'Approved'],
    REJECTED: ['critical', 'x', 'Sent back'], WITHDRAWN: ['gray', 'undo', 'Taken back'],
};
const STEP = {
    SUBMITTED: ['link', 'Sent', ''], RESUBMITTED: ['refresh', 'Sent again', 'res'], EDITED: ['edit', 'Edited', 'res'],
    REJECTED: ['x', 'Sent back', 'rej'], APPROVED: ['check', 'Approved', ''], WITHDRAWN: ['undo', 'Taken back', ''],
};

/** "Sent 2 Oct · Sent back: wrong amount · Sent again: amount ₹500 → ₹450" */
export function historyHtml(p) {
    const steps = p.history || [];
    if (steps.length <= 1) return '';
    return `<div class="ap-history">${steps.map(s => {
        const [ico, label, tone] = STEP[s.action] || ['info', s.action, ''];
        return `<span class="${tone}" title="${esc(`${dateTime(s.at)} · ${s.by || ''}`)}">${icon(ico)}${label} ${esc(shortWhen(s.at))}${s.note ? `: ${esc(s.note)}` : ''}</span>`;
    }).join('')}</div>`;
}

const shortWhen = iso => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export async function openSubmissions({ onChanged } = {}) {
    let list = await api.get('/approvals/mine');
    const draw = m => {
        m.el.querySelector('[data-subs]').innerHTML = list.length ? list.map(p => {
            const [tone, ico, label] = STATE[p.status] || ['', 'info', p.status];
            const change = p.kind === 'CHANGE';
            const ci = change ? { name: 'edit', tone: 'violet' } : categoryIcon(p.categoryName || '');
            return `<div class="my-sub ${p.status.toLowerCase()}">
                <span class="chip-icon sm ${ci.tone}">${icon(ci.name)}</span>
                <div class="grow"><div class="row"><b class="ellipsis">${esc(p.narration || p.categoryName)}</b><span class="badge ${tone}">${icon(ico)}${label}</span>
                    <span class="spacer"></span><b class="mono">${money(p.amount)}</b></div>
                    <div class="small muted">${change ? `${esc(p.reference || '')} · asked ${date(p.entryDate)}${p.notes ? ` · ${esc(p.notes)}` : ''}`
                        : `${date(p.entryDate)} · ${esc(p.categoryName || '')} · ${esc(p.paidFromName || '')}`}${p.reviewedBy ? ` · ${p.status === 'APPROVED' ? 'approved' : 'checked'} by ${esc(p.reviewedBy)}` : ''}</div>
                    ${p.status === 'REJECTED' && p.reviewNote ? `<div class="small"><b class="neg">Why:</b> ${esc(p.reviewNote)}</div>` : ''}
                    ${historyHtml(p)}
                    ${p.editable ? `<div class="row" style="margin-top:4px">
                        ${change ? `<button class="btn sm ${p.status === 'REJECTED' ? 'primary' : ''}" data-answer="${p.id}">${icon('refresh')}${p.status === 'REJECTED' ? 'Answer and send again' : 'Add a comment'}</button>`
                            : `<button class="btn sm ${p.status === 'REJECTED' ? 'primary' : ''}" data-fix="${p.id}">${icon('edit')}${p.status === 'REJECTED' ? 'Correct and send again' : 'Edit'}</button>`}
                        <button class="btn sm ghost" data-withdraw="${p.id}">${icon('undo')}Take back</button></div>` : ''}
                </div></div>`;
        }).join('') : emptyState('Nothing sent for approval yet', 'check-circle');
    };
    const modal = openModal({
        title: 'Sent for approval', iconName: 'hourglass', size: 'lg',
        body: `<p class="hint" style="margin:0 0 8px">Your expenses wait for a checker before they reach the books, and so do your changes to what is already recorded (a checker makes them when approving). One sent back can be corrected, or answered, and sent again.</p>
            <div class="my-subs" data-subs></div>`,
        actions: [{ label: 'Close', kind: 'primary' }],
    });
    draw(modal);
    const refresh = async () => { list = await api.get('/approvals/mine'); draw(modal); onChanged?.(); };
    modal.el.addEventListener('click', async e => {
        const fix = e.target.closest('[data-fix]'), back = e.target.closest('[data-withdraw]'), ans = e.target.closest('[data-answer]');
        try {
            if (ans) answerDialog(list.find(p => p.id === Number(ans.dataset.answer)), { onDone: refresh });
            if (fix) resubmitDialog(list.find(p => p.id === Number(fix.dataset.fix)), { onDone: refresh });
            if (back) {
                const p = list.find(x => x.id === Number(back.dataset.withdraw));
                if (await confirmDialog(`Take back "${p.narration || p.categoryName}" (${money(p.amount)})? It will not be posted.`, { confirmLabel: 'Take back' })) {
                    await api.post(`/approvals/${p.id}/withdraw`);
                    toast('Taken back');
                    await refresh();
                }
            }
        } catch (error) { toast(error.message, 'error'); }
    });
}

/** A change request turned down: answered with a comment (and evidence on it), and sent again. */
export function answerDialog(p, { onDone } = {}) {
    const back = p.status === 'REJECTED';
    openModal({
        title: back ? 'Answer and send again' : 'Add a comment', iconName: 'refresh', sub: p.narration || '',
        body: `<form class="form-grid one">${back && p.reviewNote ? `<p class="small"><b class="neg">Why it was turned down:</b> ${esc(p.reviewNote)}</p>` : ''}
            <label class="field"><span>Your answer *</span><textarea name="note" required rows="3"></textarea></label>
            <div class="field"><span>Evidence</span><div data-ev-pending="${p.id}" data-ev-editable="1"></div></div></form>`,
        actions: [{ label: 'Back' }, { label: back ? 'Send again' : 'Add', kind: 'primary', iconName: 'send', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            await api.post(`/approvals/${p.id}/answer`, { note: f.note.value });
            toast(back ? 'Sent again for approval' : 'Added');
            window.dispatchEvent(new Event('approvals-changed'));
            await onDone?.();
        } }],
    });
}

/** Correct the entry (prefilled with what was sent) and send it again; the checker sees what changed. */
export async function resubmitDialog(p, { onDone } = {}) {
    const options = await api.get('/expenses/form-options');
    openModal({
        title: `${p.status === 'REJECTED' ? 'Correct and send again' : 'Edit'} · ${p.narration || p.categoryName}`, iconName: 'edit',
        body: `<form class="form-grid two">
            ${p.status === 'REJECTED' ? `<div class="span-2 post-summary"><div class="row"><b>Sent back by ${esc(p.reviewedBy || 'the checker')}</b><span class="spacer"></span><span class="small muted">${p.reviewedAt ? dateTime(p.reviewedAt) : ''}</span></div>
                <div class="small">${p.reviewNote ? `“${esc(p.reviewNote)}”` : 'No reason given.'}</div></div>` : ''}
            ${field({ label: 'Amount', name: 'amount', type: 'number', value: p.amount, required: true, attrs: 'step="any" min="0.01"' })}
            ${field({ label: 'Date', name: 'entryDate', type: 'date', value: p.entryDate, required: true, attrs: `max="${isoDate()}"` })}
            <label class="field"><span>Category</span><select name="categoryId">${options.categories.map(c => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
            <label class="field"><span>Paid from</span><select name="paidFromId">${options.payers.map(a => `<option value="${a.id}" ${a.id === p.paidFromId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
            ${field({ label: 'What for', name: 'narration', value: p.narration || '', span: 'span-2' })}
            ${field({ label: 'Shop / person', name: 'party', value: p.party || '' })}
            ${field({ label: 'Note for the checker', name: 'notes', value: p.notes || '', placeholder: 'e.g. Fixed the amount, bill attached' })}
        </form>`,
        actions: [{ label: 'Cancel' }, {
            label: 'Send for approval', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                await api.post(`/approvals/${p.id}/resubmit`, { entryDate: d.entryDate, amount: d.amount, categoryId: Number(d.categoryId),
                    paidFromId: Number(d.paidFromId), narration: d.narration, party: d.party, reference: p.reference, notes: d.notes });
                toast(`${money(d.amount)} sent for approval again`);
                window.dispatchEvent(new Event('approvals-changed'));
                await onDone?.();
            },
        }],
    });
}
