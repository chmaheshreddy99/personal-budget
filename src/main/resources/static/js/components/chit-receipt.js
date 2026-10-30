/**
 * Acknowledgements of receipt for the chit installments you paid, and for the payout received in full, from the chit's page.
 *
 * You pick one or several paid installments and send the organizer one link (WhatsApp, SMS or copied). The link
 * expires, opens only with the organizer's mobile number (the one saved on the chit, or picked from the phone's
 * contacts / typed while sending) and shows what they are acknowledging; they sign with a finger. The signed record
 * (name, signature, time, IP, device, optional selfie and location, sealed and digitally signed) is kept here and the
 * installments in it can no longer be undone.
 *
 * It can also be printed (stamp-paper style, real stamp paper, or plain A4 with a box for a revenue stamp) and signed on
 * paper, then recorded here with a scan. A signed record can be withdrawn (it is kept, marked cancelled) and sent again.
 * When the payout has come in full, a payout receipt asks the organizer to confirm it and cancels the earlier
 * acknowledgements, restating the installments.
 */
import { api } from '../core/api.js';
import { state, can } from '../core/store.js';
import { esc, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { bondHtml, printBond, evidenceRows, verifyEvidence, dataUrl, signatureSvg, signaturePad, downloadEvidence } from '../core/bond.js';
import { receiptDeed } from '../core/receipt-deed.js';

const STATUS = {
    PENDING: ['warning', 'clock', 'Waiting for the organizer'], ACKNOWLEDGED: ['good', 'check-circle', 'Acknowledged'],
    SIGNED: ['good', 'edit', 'Signed on paper'], DISPUTED: ['critical', 'alert', 'Organizer says it is wrong'],
    REVOKED: ['gray', 'x', 'Stopped'], CANCELLED: ['gray', 'undo', 'Withdrawn'],
};
const LINK = { NONE: 'No link', ACTIVE: 'Link active', EXPIRED: 'Link expired', REVOKED: 'Link stopped', LOCKED: 'Link locked' };
const DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
const tenDigits = v => String(v || '').replace(/\D/g, '').slice(-10);
export const isFinal = a => a?.status === 'ACKNOWLEDGED' || a?.status === 'SIGNED';
const isPayout = a => a.kind === 'PAYOUT';
const ui = { withdrawn: false };

/** The installments an acknowledgement stands for (a payout receipt restates all that were paid). */
const coveredNos = a => a.installmentNos || [];

/** installment id → its newest request that matters (a signed one beats a waiting one), for the badges on the installments. */
export function ackByInstallment(acks, installments) {
    const byNo = new Map(installments.map(i => [i.installmentNo, i]));
    const out = new Map();
    const rank = a => isFinal(a) ? 3 : a.status === 'PENDING' ? 2 : a.status === 'DISPUTED' ? 1 : 0;
    for (const a of acks) {
        if (!rank(a)) continue;
        for (const no of coveredNos(a)) {
            const i = byNo.get(no);
            if (!i) continue;
            const old = out.get(i.id);
            if (!old || rank(a) > rank(old) || (rank(a) === rank(old) && a.id > old.id)) out.set(i.id, a);
        }
    }
    return out;
}

export function ackBadge(a) {
    if (!a) return '';
    const [tone, ico, label] = STATUS[a.status] || ['gray', 'info', a.status];
    const short = { PENDING: 'Awaiting', ACKNOWLEDGED: 'Acknowledged', SIGNED: 'Signed', DISPUTED: 'Disputed' }[a.status] || label;
    return `<button type="button" class="badge ${tone} ack-badge" data-ack-open="${a.id}" title="${esc(`${a.ackNo} · ${label}`)}">${icon(ico)}${short}</button>`;
}

// ===================================================================== sending

/** The organizer's name, mobile (with the phone's contact chooser), the payer's name, a note, how long the link lasts, selfie and location. */
function recipientHtml(chit, { noteLabel = 'How it was paid', notePlaceholder = 'e.g. UPI 4411…' } = {}) {
    const contacts = typeof navigator !== 'undefined' && 'contacts' in navigator && typeof navigator.contacts?.select === 'function';
    const hasPhone = Boolean(chit.organizerPhone);
    return `<div class="form-grid two">
            <label class="field"><span>Organizer's name</span><input name="organizerName" maxlength="100" value="${esc(chit.organizer || '')}" data-plain></label>
            <label class="field"><span>Organizer's mobile <small class="muted">${hasPhone ? 'saved on the chit' : 'the link is sent to it'}</small></span>
                <span class="rc-phone"><input name="phone" type="tel" inputmode="tel" maxlength="16" placeholder="10-digit mobile" value="${esc(chit.organizerPhone || '')}" data-plain>
                ${contacts ? `<button type="button" class="btn sm" data-rc-contact title="Choose from your phone's contacts">${icon('users')}Contacts</button>` : ''}</span>
                ${contacts ? '' : '<small class="hint muted">Type it, or open this page on your phone to pick from your contacts.</small>'}</label>
            <label class="field"><span>Your name <small class="muted">as the one who paid</small></span><input name="payerName" maxlength="100" value="${esc(state.user?.fullName || '')}" data-plain></label>
            <label class="field"><span>${noteLabel} <small class="muted">optional</small></span><input name="paymentNote" maxlength="200" data-plain placeholder="${esc(notePlaceholder)}"></label>
        </div>
        <div class="rc-opts">
            <div><b>The link works for</b><div class="seg-chips sm" data-rc-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="seg-chip ${h === 72 ? 'active' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
            <label class="cs-check"><input type="checkbox" name="rememberPhone" ${hasPhone ? '' : 'checked'}> Save this number on the chit</label>
            <label class="cs-check"><input type="checkbox" name="requireSelfie"> Ask for a live selfie with the signature</label>
            <label class="cs-check"><input type="checkbox" name="requireLocation"> Ask for their location with the signature</label>
        </div>`;
}

/** Hours chips and the phone's contact chooser inside a dialog's form. */
function bindRecipient(form) {
    form.addEventListener('click', async e => {
        const chip = e.target.closest('[data-rc-hours] [data-value]');
        if (chip) { form.querySelectorAll('[data-rc-hours] [data-value]').forEach(x => x.classList.toggle('active', x === chip)); return; }
        if (e.target.closest('[data-rc-contact]')) {
            // the phone's own contact chooser: we only get the one contact the person picks
            try {
                const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
                if (!c) return;
                const numbers = [...new Set((c.tel || []).map(tenDigits).filter(n => /^[6-9]\d{9}$/.test(n)))];
                if (!numbers.length) { toast('That contact has no mobile number', 'error'); return; }
                form.phone.value = numbers[0];
                if (c.name?.[0] && !form.organizerName.value.trim()) form.organizerName.value = c.name[0];
                if (numbers.length > 1) toast(`Using ${numbers[0]}: ${numbers.length} numbers found, edit if needed`, 'info');
            } catch { /* closed without choosing */ }
        }
    });
}

function readRecipient(form) {
    const phone = tenDigits(form.phone.value);
    if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('Enter the organizer’s 10-digit mobile number');
    if (!form.payerName.value.trim()) throw new Error('Enter your name');
    return { organizerName: form.organizerName.value.trim(), organizerPhone: phone, rememberPhone: form.rememberPhone.checked,
        payerName: form.payerName.value.trim(), paymentNote: form.paymentNote.value.trim(),
        hours: Number(form.querySelector('[data-rc-hours] .active')?.dataset.value || 72),
        requireSelfie: form.requireSelfie.checked, requireLocation: form.requireLocation.checked };
}

/**
 * The dialog that asks the organizer to acknowledge payments. preselect: installment ids ticked first (all that are
 * not acknowledged yet when empty).
 */
export function openReceiptSend(chit, installments, acks, preselect, onDone) {
    const taken = ackByInstallment(acks, installments);
    const paid = installments.filter(i => i.status === 'PAID');
    const open = paid.filter(i => !isFinal(taken.get(i.id)));
    if (!paid.length) { toast('Pay an installment first: only payments already made can be acknowledged', 'error'); return; }
    if (!open.length) { toast('Every payment already has an acknowledgement', 'info'); return; }
    const chosen = new Set((preselect?.length ? preselect : open.map(i => i.id)).filter(id => open.some(i => i.id === id)));
    const rows = open.map(i => {
        const t = taken.get(i.id);
        return `<label class="rc-row"><input type="checkbox" data-rc-i="${i.id}" ${chosen.has(i.id) ? 'checked' : ''}>
            <span class="rc-no">#${i.installmentNo}</span><span class="grow">${date(i.paidDate)}${t ? ` <small class="muted">· ${esc(STATUS[t.status][2].toLowerCase())}</small>` : ''}</span>
            <b>${money(i.paidAmount)}</b></label>`;
    }).join('');
    const modal = openModal({
        title: 'Ask for an acknowledgement', sub: `${chit.name} · ${chit.organizer || 'organizer'}`, iconName: 'shield', size: 'lg',
        body: `<form class="rc-form" data-rc-form onsubmit="return false">
            <div class="rc-style">
                <label class="rc-style-opt"><input type="radio" name="style" value="simple" checked><span>${icon('receipt')}<b>Simple receipt</b><small>Three plain lines: received ₹, for which installments, signed. Quickest for the organizer.</small></span></label>
                <label class="rc-style-opt"><input type="radio" name="style" value="full"><span>${icon('shield')}<b>Full acknowledgement</b><small>Six clauses with the chit's details, due dates and dividends. Best for large amounts or a court record.</small></span></label>
            </div>
            <div class="rc-pick"><div class="rc-pick-head"><b>Payments to acknowledge</b>
                <span class="grow"></span><button type="button" class="btn sm ghost" data-rc-all>All</button><button type="button" class="btn sm ghost" data-rc-none>None</button></div>
                <div class="rc-list">${rows}</div>
                <div class="rc-total"><span data-rc-count></span><b data-rc-sum></b></div></div>
            ${recipientHtml(chit)}
            <p class="muted small">${icon('shield')} The organizer opens the link on their phone, types their mobile number, reads the payments and signs with a finger. The time,
                IP address and phone details are recorded and sealed with a digital signature. Once they sign it cannot be changed, and those installments cannot be undone
                (you can withdraw it, which keeps it marked cancelled). You can also print it and get it signed on paper.</p>
        </form>`,
        actions: [{ label: 'Create the link', kind: 'primary', iconName: 'send', onClick: async m => {
            const form = m.el.querySelector('[data-rc-form]');
            const ids = [...form.querySelectorAll('[data-rc-i]:checked')].map(x => Number(x.dataset.rcI));
            if (!ids.length) throw new Error('Tick at least one payment');
            const made = await api.post(`/chits/${chit.id}/receipts`, { installmentIds: ids, ...readRecipient(form), simple: form.style.value === 'simple' });
            onDone?.();
            setTimeout(() => showLink(chit, made), 0);
        } }],
    });
    const form = modal.el.querySelector('[data-rc-form]');
    const recount = () => {
        const on = [...form.querySelectorAll('[data-rc-i]:checked')].map(x => open.find(i => i.id === Number(x.dataset.rcI)));
        form.querySelector('[data-rc-count]').textContent = `${on.length} payment${on.length === 1 ? '' : 's'} selected`;
        form.querySelector('[data-rc-sum]').textContent = money(on.reduce((s, i) => s + Number(i.paidAmount || 0), 0));
    };
    recount();
    bindRecipient(form);
    form.addEventListener('change', e => { if (e.target.matches('[data-rc-i]')) recount(); });
    form.addEventListener('click', e => {
        if (e.target.closest('[data-rc-all]')) { form.querySelectorAll('[data-rc-i]').forEach(x => { x.checked = true; }); recount(); }
        if (e.target.closest('[data-rc-none]')) { form.querySelectorAll('[data-rc-i]').forEach(x => { x.checked = false; }); recount(); }
    });
}

/**
 * The receipt for the payout received in full: the organizer confirms it was paid and received, nothing more is due for it,
 * and the earlier acknowledgements are cancelled and replaced (the installments are restated in it).
 */
export function openPayoutSend({ chit, installments, payoutReceipts, acks }, onDone) {
    const paid = installments.filter(i => i.status === 'PAID');
    const unpaid = installments.filter(i => i.status !== 'PAID');
    const earlier = acks.filter(a => !isPayout(a) && (isFinal(a) || a.status === 'PENDING'));
    const parts = [...payoutReceipts].sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const modal = openModal({
        title: 'Payout receipt and final settlement', sub: `${chit.name} · ${chit.organizer || 'organizer'}`, iconName: 'gift', size: 'lg',
        body: `<form class="rc-form" data-rc-form onsubmit="return false">
            <div class="rc-sum">
                <div><small>Payout received in full</small><b class="pos">${money(chit.payoutAmount)}</b>
                    <span class="muted">${parts.map(p => `${money(p.amount)} on ${date(p.date)}`).join(' · ')}</span></div>
                <div><small>Installments restated</small><b>${paid.length} of ${chit.numberOfInstallments}</b>
                    <span class="muted">${money(paid.reduce((s, i) => s + Number(i.paidAmount || 0), 0))} paid${unpaid.length ? ` · ${unpaid.length} still payable, not released` : ' · none due'}</span></div>
            </div>
            <div class="rc-cancel ${earlier.length ? '' : 'none'}">${earlier.length
                ? `<b>${icon('alert')} Cancelled when the organizer signs</b>
                    <ul>${earlier.map(a => `<li>${esc(a.ackNo)} · installments ${coveredNos(a).map(n => '#' + n).join(', ')} · ${money(a.totalAmount)} · ${esc(STATUS[a.status][2].toLowerCase())}</li>`).join('')}</ul>
                    <small class="muted">They stay on record, marked cancelled; this receipt restates every payment they covered.</small>`
                : '<small class="muted">No earlier acknowledgement was signed for this chit.</small>'}</div>
            ${recipientHtml(chit, { noteLabel: 'How the payout was paid', notePlaceholder: 'e.g. cheque no. / NEFT reference' })}
            <div class="rc-payer-sign"><div class="cs-sign-head"><b>Your signature <small class="muted">optional: it goes on the printed copy</small></b><button type="button" class="btn sm ghost" data-rc-sign-clear>Clear</button></div>
                <canvas width="1000" height="300" data-rc-sign></canvas></div>
            <p class="muted small">${icon('shield')} By sending this you declare that you received the whole payout. The organizer confirms they paid it, that nothing more is due for it,
                and that the earlier acknowledgements are cancelled. Remaining installments, if any, stay payable.</p>
        </form>`,
        actions: [{ label: 'Create the link', kind: 'primary', iconName: 'send', onClick: async m => {
            const form = m.el.querySelector('[data-rc-form]');
            const made = await api.post(`/chits/${chit.id}/receipts/payout`, { ...readRecipient(form), payerSignature: pad.empty() ? null : pad.path() });
            onDone?.();
            setTimeout(() => showLink(chit, made), 0);
        } }],
    });
    const form = modal.el.querySelector('[data-rc-form]');
    bindRecipient(form);
    const pad = signaturePad(form.querySelector('[data-rc-sign]'));
    form.querySelector('[data-rc-sign-clear]').addEventListener('click', () => pad.clear());
}

/** The link, shown once: QR, copy, and WhatsApp / SMS with a ready message to the organizer's number. */
function showLink(chit, made) {
    const a = made.receipt;
    const url = `${location.origin}/chit-receipt.html#${made.token}`;
    const phone = tenDigits(a.organizerPhone);
    const first = (a.organizerName || '').split(/\s+/)[0] || 'Sir/Madam';
    const list = a.lines.map(l => `#${l.no} ${money(l.cash)} (${date(l.paidDate)})`).join(', ');
    const text = isPayout(a)
        ? `Hi ${first}, this is ${a.payerName}. I have received the full payout of ${a.chitName}${a.ticketNo ? ` (${a.ticketNo})` : ''}, ${money(a.totalAmount)}. `
            + `Please open this link, type your mobile number and sign to confirm the final settlement. It cancels the earlier acknowledgement${a.supersedes.length === 1 ? '' : 's'}${a.supersedes.length ? ` (${a.supersedes.join(', ')})` : ''} and restates all my installments `
            + `(valid until ${dateTime(a.linkExpiresAt)}): ${url}`
        : `Hi ${first}, this is ${a.payerName}. I have paid ${a.lines.length === 1 ? 'installment' : a.lines.length + ' installments'} of ${a.chitName}${a.ticketNo ? ` (${a.ticketNo})` : ''}: ${list}, ${money(a.totalAmount)} in all. `
            + `Please open this link, type your mobile number and sign to acknowledge receipt (valid until ${dateTime(a.linkExpiresAt)}): ${url}`;
    const modal = openModal({
        title: `${a.ackNo} ready to send`, sub: `${a.organizerName} · ${money(a.totalAmount)}`, iconName: 'send',
        body: `<div class="ln-made cs-made">
            <div class="ln-qr">${qrSvg(url, { size: 130 })}</div>
            <div class="ln-made-main">
                <p class="small muted" style="margin:0">Send it now: it is shown only once and works until <b>${dateTime(a.linkExpiresAt)}</b>. It opens only with the number ending <b>${esc(phone.slice(6))}</b>.</p>
                <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-rc-copy>${icon('copy')}Copy</button></div>
                <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/91${phone}?text=${encodeURIComponent(text)}">${icon('phone')}Send on WhatsApp</a>
                    <a class="btn sm" href="sms:${phone}?body=${encodeURIComponent(text)}">${icon('mail')}SMS</a>
                    ${navigator.share ? `<button type="button" class="btn sm" data-rc-share>${icon('link')}Share…</button>` : ''}</div>
            </div></div>`,
        actions: [{ label: 'Done', kind: 'primary' }],
    });
    modal.el.querySelector('[data-rc-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { modal.el.querySelector('.ln-url input').select(); }
    });
    modal.el.querySelector('[data-rc-share]')?.addEventListener('click', () => navigator.share({ title: 'Acknowledgement of receipt', text, url }).catch(() => {}));
}

// ===================================================================== the list

/** The "Acknowledgements" tab: each request with its state and what can be done with it. */
export function receiptsTabHtml(acks, manage, { payoutReady = false, payoutDone = false } = {}) {
    const withdrawn = acks.filter(a => a.status === 'CANCELLED');
    const shown = acks.filter(a => ui.withdrawn || a.status !== 'CANCELLED');
    const bar = `<div class="rc-bar">${manage ? `<button class="btn sm primary" data-act="ack">${icon('shield')}Acknowledge payments</button>
        ${payoutReady ? `<button class="btn sm ${payoutDone ? '' : 'gold-btn'}" data-act="payout-ack" title="${payoutDone ? 'The payout already has a signed receipt' : 'The payout is in full: ask the organizer to confirm it'}">${icon('gift')}Payout receipt</button>` : ''}` : ''}
        <span class="grow"></span>${withdrawn.length ? `<label class="cs-check sm"><input type="checkbox" data-rc-withdrawn ${ui.withdrawn ? 'checked' : ''}> Show ${withdrawn.length} withdrawn</label>` : ''}</div>`;
    if (!shown.length) {
        return `${bar}<div class="empty-note">${icon('shield')}<b>No acknowledgements yet</b>
            <p class="muted">Pick paid installments and send the organizer a link: they sign on their phone and you keep it as proof they received the money. Or print it and get it signed on paper.</p></div>`;
    }
    const done = shown.filter(isFinal), waiting = shown.filter(a => a.status === 'PENDING'), disputed = shown.filter(a => a.status === 'DISPUTED');
    const sum = list => list.filter(a => !isPayout(a)).reduce((s, a) => s + Number(a.totalAmount || 0), 0);
    const strip = `<div class="rc-strip">
        <div class="rc-kpi good">${icon('check-circle')}<div><small>Signed</small><b>${done.length}</b><em>${money(sum(done))} acknowledged</em></div></div>
        <div class="rc-kpi wait">${icon('clock')}<div><small>Waiting</small><b>${waiting.length}</b><em>${waiting.length ? `${money(sum(waiting))} out for signing` : 'nothing pending'}</em></div></div>
        <div class="rc-kpi ${disputed.length ? 'bad' : ''}">${icon('alert')}<div><small>Disputed</small><b>${disputed.length}</b><em>${disputed.length ? 'see the reason, then send again' : 'none'}</em></div></div></div>`;
    return `${bar}${strip}<table class="grid compact dense rc-table"><thead><tr><th>Sent</th><th>For</th><th class="r">Amount</th><th>Organizer</th><th>State</th><th></th></tr></thead>
        <tbody>${shown.map(a => {
            const [tone, ico, label] = STATUS[a.status] || ['gray', 'info', a.status];
            const nos = a.lines.map(l => l.no);
            const span = isPayout(a) ? 'Payout received in full'
                : nos.length > 2 && nos[nos.length - 1] - nos[0] === nos.length - 1 ? `#${nos[0]}–#${nos[nos.length - 1]}` : nos.map(n => `#${n}`).join(', ');
            const stateText = a.status === 'ACKNOWLEDGED' || a.status === 'SIGNED' ? `${esc(a.acknowledgedName)} · ${a.status === 'SIGNED' ? date(String(a.acknowledgedAt).slice(0, 10)) : dateTime(a.acknowledgedAt)}`
                : a.status === 'DISPUTED' ? esc(a.disputeReason || '') : a.status === 'CANCELLED' ? esc(a.cancelReason || '')
                : a.status === 'PENDING' ? `${LINK[a.link]}${a.link === 'ACTIVE' ? ` until ${dateTime(a.linkExpiresAt)}` : ''}${a.views ? ` · opened ${a.views}×` : ''}` : '';
            const again = ['DISPUTED', 'REVOKED', 'CANCELLED'].includes(a.status) || (a.status === 'PENDING' && a.link !== 'ACTIVE');
            return `<tr class="clickable ${a.status === 'CANCELLED' ? 'withdrawn' : ''}" data-ack-open="${a.id}"><td>${dateTime(a.createdAt)}<small class="muted block">${esc(a.ackNo)}</small></td>
                <td>${isPayout(a) ? `${icon('gift')} ` : ''}${span}<small class="muted block">${isPayout(a) ? `${a.installCount} installments restated` : `${a.lines.length} payment${a.lines.length === 1 ? '' : 's'}`}${a.kind === 'SIMPLE' ? ' · <span class="rc-kind">simple</span>' : ''}</small></td>
                <td class="r"><b>${money(a.totalAmount)}</b></td><td>${esc(a.organizerName)}<small class="muted block">••••••${esc(String(a.organizerPhone).slice(6))}</small></td>
                <td><span class="badge ${tone}">${icon(ico)}${label}</span><small class="muted block">${stateText}</small></td>
                <td class="r nowrap"><button class="btn sm ghost icon" data-ack-print="${a.id}" title="Print: stamp paper, plain paper for a revenue stamp, or PDF">${icon('printer')}</button>${manage ? `
                    ${a.status === 'PENDING' || a.status === 'REVOKED' ? `<button class="btn sm ghost icon" data-ack-renew="${a.id}" title="New link">${icon('refresh')}</button>` : ''}
                    ${again ? `<button class="btn sm ghost icon" data-ack-again="${a.id}" title="Send again for signing">${icon('send')}</button>` : ''}
                    ${a.status === 'PENDING' && a.link === 'ACTIVE' ? `<button class="btn sm ghost icon" data-ack-stop="${a.id}" title="Stop the link">${icon('x')}</button>` : ''}
                    ${isFinal(a) ? `<button class="btn sm ghost icon" data-ack-cancel="${a.id}" title="Withdraw and send again">${icon('undo')}</button>` : ''}
                    ${['PENDING', 'REVOKED', 'DISPUTED'].includes(a.status) ? `<button class="btn sm ghost icon" data-ack-delete="${a.id}" title="Remove">${icon('trash')}</button>` : ''}` : ''}</td></tr>`;
        }).join('')}</tbody></table>`;
}

/**
 * Clicks inside the tab (and the badges on the installments): view, print, new link, send again, withdraw, stop, remove.
 * ctx: { chit, acks, installments, payoutReceipts, reload }. Returns true when handled.
 */
export async function handleReceiptClick(e, ctx) {
    const { chit, acks, installments, reload } = ctx;
    const find = id => acks.find(a => a.id === Number(id));
    const hit = sel => e.target.closest(sel);
    if (hit('[data-rc-withdrawn]')) { ui.withdrawn = hit('[data-rc-withdrawn]').checked; ctx.redraw?.(); return true; }
    let b;
    if ((b = hit('[data-ack-renew]'))) { e.stopPropagation(); renewLink(chit, find(b.dataset.ackRenew), reload); return true; }
    if ((b = hit('[data-ack-print]'))) { e.stopPropagation(); openPrintSetup(chit, find(b.dataset.ackPrint)); return true; }
    if ((b = hit('[data-ack-again]'))) { e.stopPropagation(); sendAgain(ctx, find(b.dataset.ackAgain)); return true; }
    if ((b = hit('[data-ack-cancel]'))) { e.stopPropagation(); withdraw(ctx, find(b.dataset.ackCancel)); return true; }
    if ((b = hit('[data-ack-stop]'))) {
        e.stopPropagation();
        const a = find(b.dataset.ackStop);
        if (await confirmDialog(`Stop the link of ${a.ackNo}? ${a.organizerName} will not be able to open it any more.`, { confirmLabel: 'Stop the link' })) {
            await api.post(`/chits/${chit.id}/receipts/${a.id}/revoke`);
            toast('Link stopped');
            reload();
        }
        return true;
    }
    if ((b = hit('[data-ack-delete]'))) {
        e.stopPropagation();
        const a = find(b.dataset.ackDelete);
        if (await confirmDialog(`Remove ${a.ackNo}? Its link stops working. (A signed one can only be withdrawn, never removed.)`, { confirmLabel: 'Remove' })) {
            await api.del(`/chits/${chit.id}/receipts/${a.id}`);
            toast(`${a.ackNo} removed`);
            reload();
        }
        return true;
    }
    if ((b = hit('[data-ack-open]'))) { e.stopPropagation(); const a = find(b.dataset.ackOpen); if (a) openReceiptDetail(ctx, a); return true; }
    return false;
}

/** The same request again, with a new number and link: the installments (or the payout) are picked up from the old one. */
export function sendAgain(ctx, a) {
    const { chit, installments, acks, payoutReceipts, reload } = ctx;
    if (isPayout(a)) { openPayoutSend({ chit, installments, payoutReceipts, acks }, reload); return; }
    const nos = new Set(a.lines.map(l => l.no));
    openReceiptSend(chit, installments, acks, installments.filter(i => nos.has(i.installmentNo)).map(i => i.id), reload);
}

/** Withdraws a signed record with the reason (kept as cancelled), then offers to send it again. */
function withdraw(ctx, a) {
    const { chit, reload } = ctx;
    openModal({
        title: `Withdraw ${a.ackNo}`, sub: `${a.organizerName} · ${money(a.totalAmount)}`, iconName: 'undo',
        body: `<p class="muted">The signed record is <b>kept</b> with all its evidence, marked <b>withdrawn</b> and shown with your reason. ${isPayout(a)
            ? 'The payout can then be undone, and a new payout receipt sent. The earlier acknowledgements it cancelled stay cancelled: send new ones if you need them.'
            : 'Its installments can then be undone or acknowledged again.'}</p>
            <label class="field"><span>Why is it being withdrawn?</span><input name="reason" maxlength="300" data-plain placeholder="e.g. wrong amount typed, organizer asked for a correction"></label>`,
        actions: [{ label: 'Withdraw', kind: 'danger', onClick: async m => {
            const reason = m.el.querySelector('[name=reason]').value.trim();
            if (reason.length < 3) throw new Error('Give a short reason');
            await api.post(`/chits/${chit.id}/receipts/${a.id}/cancel`, { reason });
            toast(`${a.ackNo} withdrawn`);
            await reload();
            setTimeout(async () => {
                if (await confirmDialog(`${a.ackNo} is withdrawn. Send a fresh one now for signing?`, { title: 'Send again', confirmLabel: 'Send again', danger: false })) {
                    const fresh = await api.get(`/chits/${chit.id}/receipts`);
                    const detail = await api.get(`/chits/${chit.id}`);
                    sendAgain({ ...ctx, acks: fresh, installments: detail.installments, payoutReceipts: detail.payoutReceipts }, a);
                }
            }, 0);
        } }],
    });
}

function renewLink(chit, a, reload) {
    const modal = openModal({
        title: `New link for ${a.ackNo}`, sub: `${a.organizerName} · ${money(a.totalAmount)}`, iconName: 'refresh',
        body: `<p class="muted">The old link stops working. The payments and wording stay exactly as they were.</p>
            <div class="seg-chips sm" data-rc-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="seg-chip ${h === 72 ? 'active' : ''}" data-value="${h}">${l}</button>`).join('')}</div>`,
        actions: [{ label: 'Make the link', kind: 'primary', onClick: async m => {
            const made = await api.post(`/chits/${chit.id}/receipts/${a.id}/link`, { hours: Number(m.el.querySelector('[data-rc-hours] .active')?.dataset.value || 72) });
            reload();
            setTimeout(() => showLink(chit, made), 0);
        } }],
    });
    modal.el.addEventListener('click', e => {
        const chip = e.target.closest('[data-rc-hours] [data-value]');
        if (chip) modal.el.querySelectorAll('[data-rc-hours] [data-value]').forEach(x => x.classList.toggle('active', x === chip));
    });
}

// ===================================================================== printing

const PRINT_KEY = 'pb.receipt-print';
const loadPrint = () => { try { return JSON.parse(localStorage.getItem(PRINT_KEY) || '{}'); } catch { return {}; } };
const savePrint = o => { try { localStorage.setItem(PRINT_KEY, JSON.stringify(o)); } catch { /* not kept */ } };

/**
 * What goes on the paper copy: the paper (stamp-paper style with the stamp's value and serial, real stamp paper, or plain A4
 * with a box for a revenue stamp), the place, up to two witnesses and thumb-impression boxes. Then the print view opens, where
 * the text size, spacing, margins and page breaks can still be changed.
 */
export function openPrintSetup(chit, a) {
    const o = loadPrint();
    const signed = a.status === 'ACKNOWLEDGED';
    const w = (n, v = {}) => `<fieldset class="rc-witness"><legend>Witness ${n}</legend><div class="form-grid three">
        <label class="field"><span>Name</span><input name="w${n}name" maxlength="100" data-plain value="${esc(v.name || '')}"></label>
        <label class="field"><span>Mobile</span><input name="w${n}phone" maxlength="16" data-plain value="${esc(v.phone || '')}"></label>
        <label class="field"><span>Address</span><input name="w${n}address" maxlength="150" data-plain value="${esc(v.address || '')}"></label></div></fieldset>`;
    openModal({
        title: `Print ${a.ackNo}`, sub: `${a.organizerName} · ${money(a.totalAmount)}`, iconName: 'printer', size: 'lg',
        body: `<form class="rc-form" data-rc-print onsubmit="return false">
            <p class="muted small">${signed ? 'This was signed online; the paper copy shows the signature and the evidence.' : 'Print it, get it signed by the organizer (and witnesses), stick a revenue or other stamp if you need one, then record it as signed on paper with a scan of the signed copy.'}</p>
            <div class="rc-paper">${[['style', 'stamp', 'Stamp-paper style', 'A4 with a printed stamp band: give the value and serial no.'],
                ['real', 'file-text', 'Real stamp paper', 'The top is left blank for the printed paper (first sheet legal)'],
                ['plain', 'file', 'Plain A4 document', 'For a revenue / other stamp stuck on: a box is marked beside the signature']]
                .map(([v, ic, t, d]) => `<label class="rc-paper-opt"><input type="radio" name="paper" value="${v}" ${(o.paper || 'plain') === v ? 'checked' : ''}><span>${icon(ic)}<b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
            <div class="form-grid three">
                <label class="field" data-stamp><span>Stamp value ₹</span><input name="stampDuty" type="number" min="0" step="1" data-plain value="${esc(o.stampDuty || '')}"></label>
                <label class="field" data-stamp><span>Stamp serial no.</span><input name="stampSerial" maxlength="40" data-plain></label>
                <label class="field"><span>Place</span><input name="place" maxlength="60" data-plain value="${esc(o.place || '')}"></label>
            </div>
            ${w(1, { name: o.w1name, phone: o.w1phone, address: o.w1address })}${w(2, { name: o.w2name, phone: o.w2phone, address: o.w2address })}
            <div class="rc-opts"><label class="cs-check"><input type="checkbox" name="thumb" ${o.thumb ? 'checked' : ''}> Thumb-impression boxes for both parties</label>
                <label class="cs-check"><input type="checkbox" name="revenue" ${o.revenue === false ? '' : 'checked'}> Box for a revenue stamp beside the organizer's signature</label>
                ${signed ? `<label class="cs-check"><input type="checkbox" name="evidence" checked> Include the evidence of the online acknowledgement (annexure)</label>` : ''}</div>
        </form>`,
        actions: [{ label: 'Open the print view', kind: 'primary', iconName: 'printer', onClick: async m => {
            const f = m.el.querySelector('[data-rc-print]');
            const paper = f.paper.value;
            const person = n => ({ name: f[`w${n}name`].value.trim(), phone: f[`w${n}phone`].value.trim(), address: f[`w${n}address`].value.trim() });
            const opts = { place: f.place.value.trim(), stampDuty: Number(f.stampDuty.value || 0) || null, stampSerial: f.stampSerial.value.trim(),
                witness: person(1), witness2: person(2), thumbBoxes: f.thumb.checked, revenueStamp: paper === 'plain' || f.revenue.checked,
                plain: paper === 'plain', real: paper === 'real', evidence: f.evidence ? f.evidence.checked : false, twoWitnesses: Boolean(person(2).name) };
            savePrint({ paper, stampDuty: f.stampDuty.value, place: opts.place, thumb: f.thumb.checked, revenue: f.revenue.checked,
                w1name: opts.witness.name, w1phone: opts.witness.phone, w1address: opts.witness.address,
                w2name: opts.witness2.name, w2phone: opts.witness2.phone, w2address: opts.witness2.address });
            const full = a.terms ? a : await api.get(`/chits/${chit.id}/receipts/${a.id}`);
            printBond(receiptDeed(full, opts), `Acknowledgement ${a.ackNo}`);
        } }],
        onOpen: m => {
            const f = m.el.querySelector('[data-rc-print]');
            const sync = () => m.el.querySelectorAll('[data-stamp]').forEach(x => { x.hidden = f.paper.value !== 'style'; });
            f.addEventListener('change', sync);
            sync();
        },
    });
}

// ===================================================================== signed on paper

function markSignedOnPaper(ctx, a) {
    const { chit, reload } = ctx;
    const today = new Date().toISOString().slice(0, 10);
    openModal({
        title: `${a.ackNo} signed on paper`, sub: `${a.organizerName} · ${money(a.totalAmount)}`, iconName: 'edit',
        body: `<form class="rc-form" onsubmit="return false">
            <p class="muted small">Record that the organizer signed the printed copy. Add a scan or photo of the signed paper: it is fingerprinted into the record.</p>
            <div class="form-grid two"><label class="field"><span>Signed by</span><input name="name" maxlength="100" data-plain value="${esc(a.organizerName)}"></label>
                <label class="field"><span>Signed on</span><input name="on" type="date" max="${today}" min="${String(a.createdAt).slice(0, 10)}" value="${today}"></label></div>
            <label class="field"><span>Scan or photo of the signed copy <small class="muted">image or PDF</small></span><input name="scan" type="file" accept="image/*,application/pdf"></label>
        </form>`,
        actions: [{ label: 'Record as signed', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            const file = f.scan.files?.[0];
            if (!file && !await confirmDialog('Record it without a scan of the signed paper? A scan is the best proof; you can still keep the paper itself.', { title: 'No scan', confirmLabel: 'Record anyway', danger: false })) return true;
            if (file) {
                const data = new FormData();
                data.append('file', file, file.name);
                await api.upload(`/chits/${chit.id}/receipts/${a.id}/scan`, data);
            }
            await api.post(`/chits/${chit.id}/receipts/${a.id}/signed`, { name: f.name.value.trim(), signedOn: f.on.value });
            toast(`${a.ackNo} recorded as signed`);
            reload();
        } }],
    });
}

// ===================================================================== one request, with its evidence

export async function openReceiptDetail(ctx, listed) {
    const { chit, reload } = ctx;
    // the list holds no wording, signatures or signed text: the record is read from the server's disk now
    const a = await api.get(`/chits/${chit.id}/receipts/${listed.id}`);
    const manage = can('MANAGE_CHITS');
    const verified = a.digitalSignature && (a.status === 'ACKNOWLEDGED' || a.status === 'SIGNED') ? await verifyEvidence(a.evidencePayload, a.digitalSignature, a.publicKey).catch(() => null) : null;
    const [tone, ico, label] = STATUS[a.status] || ['gray', 'info', a.status];
    const selfie = (a.files || []).find(f => f.docType === 'SELFIE' && f.image);
    const shot = selfie ? await api.blob(`/chits/${chit.id}/receipts/${a.id}/files/${selfie.id}`, {}).then(dataUrl).catch(() => null) : null;
    const scans = (a.files || []).filter(f => f.docType === 'SIGNED_COPY');
    const table = (ls, head) => `<table class="grid compact dense"><thead><tr><th>#</th><th>${head}</th><th class="r">Installment</th><th class="r">Dividend</th><th class="r">Received</th></tr></thead>
        <tbody>${ls.map(l => `<tr><td>${l.no}</td><td>${date(l.paidDate)}</td><td class="r">${isPayout(a) && ls === a.lines ? '—' : money(l.dueAmount)}</td><td class="r">${Number(l.dividend) ? money(l.dividend) : '—'}</td><td class="r"><b>${money(l.cash)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">Total</th><th class="r">${money(ls.reduce((s, l) => s + Number(l.cash), 0))}</th></tr></tfoot></table>`;
    const lines = isPayout(a)
        ? `<h4 class="rc-h">Payout received in parts</h4>${table(a.lines, 'Received on')}<h4 class="rc-h">Installments restated (${a.installLines.length})</h4>${table(a.installLines, 'Paid on')}
            ${a.supersedes.length ? `<p class="small"><b>Cancels when signed:</b> ${a.supersedes.map(esc).join(', ')}</p>` : ''}`
        : table(a.lines, 'Paid on');
    const evidence = a.status === 'ACKNOWLEDGED' ? `
        <div class="cs-sig-status ${verified === false ? 'bad' : verified ? 'ok' : 'wait'}"><b>${verified ? '✓ Digital signature verified' : verified === false ? '✗ The signature does not match' : 'The signature could not be checked here'}</b>
            <small>ECDSA P-256 · key ${esc(a.keyFingerprint)}</small></div>
        <div class="rc-sign">${signatureSvg(a.signature)}${shot ? `<img src="${shot}" alt="Selfie" class="rc-selfie">` : ''}</div>
        <table class="bond-facts ev"><tbody>${evidenceRows({ name: a.acknowledgedName, at: a.acknowledgedAt, phone: a.acknowledgedPhone, phoneMatches: true, ip: a.acknowledgedIp,
            device: a.acknowledgedDevice, userAgent: a.acknowledgedUserAgent, location: a.acknowledgedLocation, deviceHash: a.deviceHash, seal: a.acknowledgementSeal,
            digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, publicKey: a.publicKey, evidencePayload: a.evidencePayload, verified }).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
        ${a.acknowledgedLocation ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(a.acknowledgedLocation.split(',').slice(0, 2).join(','))}">${icon('flag')}Open the location on a map</a>` : ''}`
        : a.status === 'SIGNED' ? `<p>${icon('edit')} Signed on paper by <b>${esc(a.acknowledgedName)}</b> on ${date(String(a.acknowledgedAt).slice(0, 10))}, recorded by ${esc(a.createdBy)}.
            ${scans.length ? `${scans.length} scan${scans.length === 1 ? '' : 's'} attached (SHA-256 ${scans.map(s => `<code>${esc(s.sha256.slice(0, 16))}…</code>`).join(' ')}).` : '<b>No scan attached.</b>'}</p>
            <div class="cs-sig-status ${verified === false ? 'bad' : verified ? 'ok' : 'wait'}"><b>${verified ? '✓ Record signed by this installation' : verified === false ? '✗ The signature does not match' : 'The signature could not be checked here'}</b>
            <small>This attests your record of the paper copy, not the organizer's own signature · key ${esc(a.keyFingerprint)}</small></div>`
        : a.status === 'DISPUTED' ? `<p class="cr-note">${esc(a.organizerName)} said on ${dateTime(a.disputedAt)}: “${esc(a.disputeReason)}”. Check the payment, then send it again.</p>`
        : a.status === 'CANCELLED' ? `<p class="cr-note">Withdrawn on ${dateTime(a.cancelledAt)} by ${esc(a.cancelledBy)}${a.supersededBy ? ` (replaced by ${esc(a.supersededBy)})` : ''}: “${esc(a.cancelReason)}”. Kept for the record${a.acknowledgedName ? `; it had been signed by ${esc(a.acknowledgedName)} on ${dateTime(a.acknowledgedAt)}` : ''}.</p>`
        : `<p class="muted">Nothing signed yet. ${LINK[a.link]}${a.link === 'ACTIVE' ? ` until ${dateTime(a.linkExpiresAt)}` : ''}${a.views ? ` · opened ${a.views} time${a.views === 1 ? '' : 's'}, last ${dateTime(a.lastViewedAt)}` : ' · not opened yet'}${a.failedAttempts ? ` · ${a.failedAttempts} wrong number${a.failedAttempts === 1 ? '' : 's'} typed` : ''}.</p>`;
    const canSign = manage && ['PENDING', 'REVOKED', 'DISPUTED'].includes(a.status);
    const modal = openModal({
        title: `${a.ackNo} · ${a.chitName}`, sub: `${a.organizerName} · ${money(a.totalAmount)}${isPayout(a) ? ' · payout receipt' : ''}`, iconName: 'shield', size: 'lg',
        body: `<div class="rc-detail"><div class="ag-status"><span class="badge ${tone}">${icon(ico)}${label}</span><small class="muted">made ${dateTime(a.createdAt)} by ${esc(a.createdBy)}</small></div>
            ${lines}${a.paymentNote ? `<p class="small"><b>Payment details:</b> ${esc(a.paymentNote)}</p>` : ''}
            <div class="cs-terms">${esc(a.terms)}</div>
            <p class="cs-hash">Fingerprint (SHA-256) <code>${esc(a.contentHash)}</code></p>
            ${evidence}<div data-rc-deed class="bond-preview" hidden></div></div>`,
        actions: [
            { label: 'Print…', iconName: 'printer', left: true, onClick: () => { openPrintSetup(chit, a); return true; } },
            ...(a.digitalSignature && a.evidencePayload ? [{ label: 'Download the evidence', iconName: 'download', left: true, onClick: () => { downloadEvidence(isPayout(a) ? 'CHIT-PAYOUT-RECEIPT' : 'CHIT-RECEIPT', a.ackNo, a); return true; } }] : []),
            { label: 'See as a document', iconName: 'file-text', left: true, onClick: m => {
                const box = m.el.querySelector('[data-rc-deed]');
                box.hidden = !box.hidden;
                if (!box.hidden) { box.innerHTML = bondHtml(receiptDeed(a)); box.scrollIntoView({ behavior: 'smooth' }); }
                return true;
            } },
            ...(canSign ? [{ label: 'Signed on paper…', iconName: 'edit', left: true, onClick: m => { m.close(); markSignedOnPaper(ctx, a); return true; } }] : []),
            ...(manage && isFinal(a) ? [{ label: 'Withdraw…', iconName: 'undo', left: true, onClick: m => { m.close(); withdraw(ctx, a); return true; } }] : []),
            ...(manage && ['DISPUTED', 'REVOKED', 'CANCELLED'].includes(a.status) ? [{ label: 'Send again', iconName: 'send', kind: 'primary', onClick: m => { m.close(); sendAgain(ctx, a); return true; } }] : [{ label: 'Close', kind: 'primary' }]),
        ],
    });
    return modal;
}

export const canAsk = () => can('MANAGE_CHITS');
