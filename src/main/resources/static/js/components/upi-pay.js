/**
 * UPI payment for chit installments: a scannable QR code with the organizer's UPI ID, the amount and
 * a compact payment note. The note always ends with the installment ("Inst 7/20 Oct26"); its start is
 * the chit's own custom text, or a short label built from the chit name and ticket.
 */
import { upiLogoStrip } from '../core/upi-logos.js';
import { esc, openModal, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date } from '../core/format.js';
import { qrSvg } from '../core/qr.js';

/** UPI apps truncate long notes; 50 characters is the safe common limit. */
const NOTE_LIMIT = 50;

/** "Oct26" for an ISO date. */
function monthTag(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short' }) + String(d.getFullYear()).slice(2);
}

/** The part of the note that is always added: installment number, count and month. */
export function installmentTag(chit, installment) {
    return `Inst ${installment.installmentNo}/${chit.numberOfInstallments} ${monthTag(installment.dueDate)}`;
}

/** Default lead text: chit name plus ticket, e.g. "Shriram Gold 5L G-114/07". */
export function defaultNoteLead(chit) {
    return [chit.name, chit.ticketNo].filter(Boolean).join(' ');
}

/** Compact note: lead text (custom or default) trimmed so the installment tag always fits. */
export function upiNote(chit, installment, customLead) {
    const tag = installmentTag(chit, installment);
    const room = NOTE_LIMIT - tag.length - 1;
    let lead = (customLead ?? chit.upiNote ?? defaultNoteLead(chit)).replace(/\s+/g, ' ').trim();
    if (lead.length > room) lead = lead.slice(0, Math.max(0, room)).trimEnd();   // plain ASCII: some apps reject "…"
    return lead ? `${lead} ${tag}` : tag;
}

/** upi://pay deep link understood by every UPI app (GPay, PhonePe, Paytm, BHIM ...). */
export function upiLink({ vpa, payee, amount, note }) {
    const params = [
        ['pa', vpa],
        ['pn', payee || vpa],
        ['am', Number(amount).toFixed(2)],
        ['cu', 'INR'],
        ['tn', note],
    ].filter(([, v]) => v);
    // '@' stays literal: a few UPI apps do not decode %40 in the payee address
    return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

/**
 * QR card markup: QR, payee, amount and note. Used inside the pay dialog and the standalone UPI dialog.
 */
export function upiCardHtml(chit, installment, { amount, note }) {
    const link = upiLink({ vpa: chit.organizerUpi, payee: chit.organizer, amount, note });
    return `
    <div class="upi-card">
        <div class="upi-head">${icon('qr')}<b>Scan &amp; pay with any UPI app</b></div>
        <div class="upi-brands">${upiLogoStrip(['gpay', 'phonepe', 'paytm', 'bhim'])}</div>
        <div class="upi-qr">${qrSvg(link, { size: 168 })}</div>
        <div class="upi-amount">${money(amount, { decimals: 2 })}</div>
        <div class="upi-payee"><b>${esc(chit.organizer || 'Organizer')}</b><span class="mono">${esc(chit.organizerUpi)}</span></div>
        <div class="upi-note" title="Payment note">${icon('tag')}<span>${esc(note)}</span></div>
        <div class="upi-actions">
            <button type="button" class="btn sm" data-upi-copy="${esc(chit.organizerUpi)}">${icon('copy')}UPI ID</button>
            <button type="button" class="btn sm" data-upi-copy="${esc(link)}">${icon('link')}Link</button>
            <a class="btn sm primary" href="${esc(link)}">${icon('phone')}Open app</a>
        </div>
    </div>`;
}

/** Copy buttons inside a UPI card (delegated, so it survives re-renders). */
export function bindUpiCopy(root) {
    root.addEventListener('click', async e => {
        const btn = e.target.closest('[data-upi-copy]');
        if (!btn) return;
        e.preventDefault();
        try {
            await navigator.clipboard.writeText(btn.dataset.upiCopy);
            toast('Copied', 'info');
        } catch {
            toast('Copy is not available in this browser', 'error');
        }
    });
}

/**
 * Standalone "Pay by UPI" dialog for an installment. The custom note text can be changed for this
 * payment; the installment tag is always appended. onRecord opens the "record payment" form.
 */
export function openUpiDialog(chit, installment, { onRecord } = {}) {
    const amount = Number(installment.dueAmount);
    const lead = chit.upiNote ?? defaultNoteLead(chit);
    const draw = (m) => {
        const custom = m.el.querySelector('[name=noteLead]').value;
        const pay = Number(m.el.querySelector('[name=payAmount]').value) || amount;
        m.el.querySelector('[data-upi-card]').innerHTML = upiCardHtml(chit, installment, { amount: pay, note: upiNote(chit, installment, custom) });
    };
    openModal({
        title: `Pay installment ${installment.installmentNo} by UPI`, iconName: 'qr',
        body: `
        <div class="upi-dialog">
            <div data-upi-card></div>
            <div class="upi-side">
                <label class="field"><span>Amount</span>
                    <input type="number" step="any" name="payAmount" value="${amount}" data-plain></label>
                <small class="hint">Installment ${money(amount)} · due ${date(installment.dueDate)}. Lower it by this month's dividend.</small>
                <label class="field"><span>Note</span>
                    <input name="noteLead" maxlength="40" value="${esc(lead)}" data-plain placeholder="${esc(defaultNoteLead(chit))}"></label>
                <small class="hint">${icon('sparkles')} <b>${esc(installmentTag(chit, installment))}</b> is always added so the organizer can match it.</small>
            </div>
        </div>`,
        onOpen: m => {
            bindUpiCopy(m.el);
            m.el.querySelectorAll('[name=noteLead], [name=payAmount]').forEach(el => el.addEventListener('input', () => draw(m)));
            draw(m);
        },
        actions: [
            { label: 'Close' },
            ...(onRecord ? [{ label: 'I have paid · record it', kind: 'primary', iconName: 'check', onClick: () => { onRecord(); } }] : []),
        ],
    });
}
