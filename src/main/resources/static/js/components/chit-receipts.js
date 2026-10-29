/**
 * Payment receipts from a chit's organizer, and the payout settlement (see ChitAckService on the server).
 *
 *   receiptsTabHtml(chit, acks, manage)    the chit's Receipts tab: every receipt and the settlement, with its state
 *   bindReceiptsTab(root, chit, acks, ..)  its buttons (open, resend, delete, settlement)
 *   openSendReceipt(chit, installments)    ask the organizer to acknowledge the chosen paid installments: who, their
 *                                          mobile (from the chit, a contact on the phone, or chosen in WhatsApp), how
 *                                          long the link works; then the link to send on WhatsApp / SMS, a QR, a copy
 *   openSettlement(chit)                   the full and final settlement once the payout is in (the member signs here)
 *   openAck(chit, ack)                     one of them: the deed as it prints, the link, the paper copy, the evidence
 *
 * The organizer opens chit-receipt.html#<token>, types their mobile number (when one is on record), signs with a
 * finger and accepts; the evidence is sealed and digitally signed. Every one prints too: on stamp paper, in the
 * stamp-paper style, or as a plain receipt with a revenue-stamp box to be signed by hand (original and duplicate).
 */
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { esc, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { bondHtml, printBond, padHtml, bindPad, signatureSvg, evidenceRows, verifyEvidence, chitReceiptRecitals } from '../core/bond.js';

export const ACK_STATUS = {
    PENDING: ['warning', 'clock', 'Waiting for the organizer'],
    SIGNED: ['good', 'check-circle', 'Signed online'],
    PAPER: ['good', 'edit', 'Signed on paper'],
    CANCELLED: ['gray', 'x', 'Cancelled by the settlement'],
};
const LINK = { NONE: ['gray', 'No link yet'], ACTIVE: ['good', 'Link active'], EXPIRED: ['gray', 'Link expired'], REVOKED: ['gray', 'Link stopped'], LOCKED: ['critical', 'Link locked'] };
const DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
const phoneOk = p => /^(\+?91)?[6-9]\d{9}$/.test(p);
const digits = p => String(p || '').replace(/\D/g, '').slice(-10);
const kindName = a => (a.kind === 'SETTLEMENT' ? 'Payout settlement' : 'Payment receipt');

/** A small badge for an installment's receipt (the installments table). */
export function ackBadge(i) {
    if (!i.ackNo) return '';
    const [tone, ic, label] = ACK_STATUS[i.ackStatus] || ACK_STATUS.PENDING;
    return `<span class="badge ${tone} ack-badge" data-open-ack="${i.ackId}" title="${esc(`${i.ackNo}: ${label}`)}">${icon(ic)}${esc(i.ackNo)}</span>`;
}

// ===================================================================== the tab

export function receiptsTabHtml(chit, acks, manage) {
    const paidOut = chit.payoutAmount !== null;
    const settled = acks.find(a => a.kind === 'SETTLEMENT');
    const inFull = paidOut && !Number(chit.payoutPending || 0);
    const intro = `<div class="ack-intro">${icon('shield')}<div><b>Proof that the organizer received your money.</b>
        <span>Tick paid installments on the Installments tab and choose <i>Ask for a receipt</i>, or send them all here. ${esc(chit.organizer || 'The organizer')}
        gets a link on WhatsApp that expires, signs it with a finger, and the signature is sealed and digitally signed. Each one also prints, for stamp paper or with a revenue stamp.</span></div></div>`;
    const tools = manage ? `<div class="ack-tools">
        ${!settled ? '<button type="button" class="btn sm primary" data-ack-act="all">' + icon('send') + 'Receipt for all unacknowledged</button>' : ''}
        ${paidOut && !settled ? `<button type="button" class="btn sm gold-btn" data-ack-act="settle" ${inFull ? '' : `disabled title="Record the rest of the payout first (${money(chit.payoutPending)} to come)"`}>${icon('gavel')}Payout settlement</button>` : ''}
    </div>` : '';
    if (!acks.length) return `<div class="ack-tab">${intro}${tools}<p class="muted ack-none">No receipt asked for yet.</p></div>`;
    return `<div class="ack-tab">${intro}${tools}
        <table class="grid compact dense ack-table">
            <thead><tr><th>No.</th><th>What</th><th class="r">Amount</th><th>State</th><th>Link</th><th></th></tr></thead>
            <tbody>${acks.map(a => {
                const [tone, ic, label] = ACK_STATUS[a.status] || ACK_STATUS.PENDING;
                const [lt, ll] = LINK[a.linkStatus] || LINK.NONE;
                const what = a.kind === 'SETTLEMENT' ? `Payout ${money(a.payoutAmount)} · ${a.schedule.length} installments${a.cancels.length ? ` · cancels ${a.cancels.map(c => c.ackNo).join(', ')}` : ''}`
                    : `Installment${a.schedule.length === 1 ? '' : 's'} ${a.schedule.map(l => '#' + l.no).join(', ')}`;
                return `<tr class="clickable" data-open-ack="${a.id}">
                    <td><b>${esc(a.ackNo)}</b><small class="muted block">${esc(kindName(a))}</small></td>
                    <td>${esc(what)}</td>
                    <td class="r"><b class="mono">${money(a.kind === 'SETTLEMENT' ? a.payoutAmount : a.amount)}</b></td>
                    <td><span class="badge ${tone}">${icon(ic)}${label}</span>${a.acceptedAt ? `<small class="muted block">${esc(a.acceptedName || '')} · ${dateTime(a.acceptedAt)}</small>` : ''}</td>
                    <td>${a.status === 'PENDING' ? `<span class="badge ${lt}">${ll}</span><small class="muted block">${a.views ? `opened ${a.views}×` : 'not opened'}</small>` : '<span class="muted">—</span>'}</td>
                    <td class="r nowrap">${manage && a.status !== 'CANCELLED' ? `<button type="button" class="btn sm ghost icon" data-ack-resend="${a.id}" title="${a.status === 'PENDING' ? 'Send a new link' : 'Ask to sign again'}">${icon('send')}</button>` : ''}
                        <button type="button" class="btn sm ghost icon" data-ack-print="${a.id}" title="Print">${icon('printer')}</button>
                        ${manage ? `<button type="button" class="btn sm ghost icon" data-ack-delete="${a.id}" title="Delete">${icon('trash')}</button>` : ''}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;
}

/** Wires the tab (and the receipt badges of the installments table): reload after a change. */
export function bindReceiptsTab(root, chit, getAcks, installments, reload) {
    root.addEventListener('click', async e => {
        const t = e.target;
        const find = id => getAcks().find(a => a.id === Number(id));
        try {
            const act = t.closest('[data-ack-act]')?.dataset.ackAct;
            if (act === 'all') {
                const open = installments.filter(i => i.status === 'PAID' && !i.ackNo);
                if (!open.length) { toast('Every paid installment is already on a receipt', 'info'); return; }
                openSendReceipt(chit, open, reload);
                return;
            }
            if (act === 'settle') { openSettlement(chit, reload); return; }
            const resend = t.closest('[data-ack-resend]');
            if (resend) { e.stopPropagation(); openResend(chit, find(resend.dataset.ackResend), reload); return; }
            const print = t.closest('[data-ack-print]');
            if (print) { e.stopPropagation(); const a = find(print.dataset.ackPrint); printBond(deedOf(a, { plain: a.status === 'PENDING' }), `${kindName(a)} ${a.ackNo}`); return; }
            const del = t.closest('[data-ack-delete]');
            if (del) { e.stopPropagation(); if (await deleteAck(chit, find(del.dataset.ackDelete))) reload(); return; }
            const open = t.closest('[data-open-ack]');
            if (open) {
                e.stopPropagation();
                const a = find(open.dataset.openAck) || await api.get(`/chits/${chit.id}/acks/${open.dataset.openAck}`);
                openAck(chit, a, reload);
            }
        } catch (err) { toast(err.message, 'error'); }
    });
}

async function deleteAck(chit, a) {
    const signed = a.status !== 'PENDING';
    const text = a.kind === 'SETTLEMENT'
        ? `Delete the payout settlement ${a.ackNo}?${signed ? ` It was signed by ${a.acceptedName}; ` : ' '}${a.cancels.length ? `The receipts it cancelled (${a.cancels.map(c => c.ackNo).join(', ')}) come back in force.` : ''}`
        : `Delete ${a.ackNo}?${signed ? ` It was signed by ${a.acceptedName} on ${dateTime(a.acceptedAt)}: the signed record is lost (the activity log keeps its seal).` : ' The link stops working.'} Its installments can then be sent again.`;
    if (!await confirmDialog(text, { title: `Delete ${a.ackNo}`, confirmLabel: 'Delete' })) return false;
    await api.del(`/chits/${chit.id}/acks/${a.id}`);
    toast(`${a.ackNo} deleted`);
    return true;
}

// ===================================================================== asking for one

/** The organizer: name, mobile (with a contact picker where the phone has one), address. */
function partiesHtml(chit, prefix = '') {
    const pickable = 'contacts' in navigator && 'select' in (navigator.contacts || {});
    return `
        <div class="section-title span-2">${icon('user')}Organizer</div>
        <label class="field"><span>Name</span><input name="organizerName" maxlength="100" value="${esc(chit.organizer || '')}" data-plain></label>
        <label class="field"><span>Mobile <small class="muted">${chit.organizerPhone ? 'on the chit' : 'they type it to open the link'}</small></span>
            <div class="row ack-phone"><input name="organizerPhone" type="tel" maxlength="14" inputmode="numeric" value="${esc(chit.organizerPhone || '')}" placeholder="10 digits, or leave empty" data-plain>
            ${pickable ? `<button type="button" class="btn sm ghost icon" data-pick-contact title="Choose from the phone's contacts">${icon('users')}</button>` : ''}</div></label>
        <label class="check-line span-2"><input type="checkbox" name="savePhone" ${chit.organizerPhone ? '' : 'checked'}> Keep this number on the chit</label>
        <label class="field span-2"><span>Organizer's address <small class="muted">optional</small></span><input name="organizerAddress" maxlength="150" data-plain></label>
        <div class="section-title span-2">${icon('hand')}You (the member)</div>
        <label class="field"><span>Name</span><input name="memberName" maxlength="100" value="${esc(state.user?.fullName || '')}" data-plain></label>
        <label class="field"><span>Place</span><input name="place" maxlength="60" placeholder="e.g. Hyderabad" data-plain></label>
        <label class="field span-2"><span>Your address <small class="muted">optional</small></span><input name="memberAddress" maxlength="150" data-plain></label>
        <div class="section-title span-2">${icon('link')}The link</div>
        <div class="span-2 la-make"><span>Valid for</span><div class="ln-chips" data-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
        <label class="check-line span-2"><input type="checkbox" name="requireLocation"> Ask for their location when they sign</label>
        <p class="hint span-2" style="margin:0">${icon('info')} No number? The link opens in WhatsApp and you choose the contact there; they type their number on the link and it is recorded.
            The wording is a standard template: for large sums or a dispute, have it checked by a lawyer.</p>`;
}

function bindParties(root) {
    root.addEventListener('click', async e => {
        const chip = e.target.closest('[data-hours] [data-value]');
        if (chip) { root.querySelectorAll('[data-hours] [data-value]').forEach(x => x.classList.toggle('selected', x === chip)); return; }
        if (e.target.closest('[data-pick-contact]')) {
            try {
                const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
                if (!c) return;
                const f = root.querySelector('form');
                const tel = (c.tel || []).map(digits).find(t => /^[6-9]\d{9}$/.test(t));
                if (tel) f.organizerPhone.value = tel; else toast('That contact has no Indian mobile number', 'error');
                if (c.name?.[0] && !f.organizerName.value.trim()) f.organizerName.value = c.name[0];
            } catch { /* closed */ }
        }
    });
}

function readParties(form) {
    const phone = form.organizerPhone.value.replace(/[\s-]/g, '');
    if (phone && !phoneOk(phone)) throw new Error('The organizer’s mobile should have 10 digits');
    return {
        organizerName: form.organizerName.value.trim() || null, organizerPhone: phone || null, savePhone: form.savePhone.checked,
        organizerAddress: form.organizerAddress.value.trim() || null, memberName: form.memberName.value.trim() || null,
        memberAddress: form.memberAddress.value.trim() || null, place: form.place.value.trim() || null,
        requireLocation: form.requireLocation.checked,
        hours: Number(form.closest('.modal').querySelector('[data-hours] .selected')?.dataset.value || 168),
    };
}

export function openSendReceipt(chit, installments, onDone) {
    const total = installments.reduce((s, i) => s + Number(i.paidAmount || 0), 0);
    openModal({
        title: `Ask ${chit.organizer || 'the organizer'} for a receipt`, sub: `${chit.name} · ${installments.length} installment${installments.length === 1 ? '' : 's'} · ${money(total)}`,
        iconName: 'send', size: 'lg',
        body: `<div class="ack-chosen">${installments.map(i => `<span class="chip-sm">#${i.installmentNo} · ${money(i.paidAmount)} · ${date(i.paidDate || i.dueDate)}</span>`).join('')}</div>
            <form class="form-grid two" onsubmit="return false">${partiesHtml(chit)}</form>`,
        onOpen: m => bindParties(m.el),
        actions: [{ label: 'Cancel' }, {
            label: 'Make the receipt & link', kind: 'primary', iconName: 'send', onClick: async m => {
                const body = { ...readParties(m.el.querySelector('form')), installmentIds: installments.map(i => i.id) };
                const made = await api.post(`/chits/${chit.id}/acks/receipt`, body);
                toast(`${made.ack.ackNo} made`);
                onDone?.();
                setTimeout(() => showLink(chit, made), 0);
            },
        }],
    });
}

export function openSettlement(chit, onDone) {
    let pad = null;
    openModal({
        title: 'Payout settlement', sub: `${chit.name} · payout ${money(chit.payoutAmount)}`, iconName: 'gavel', size: 'lg',
        body: `<p class="hint" style="margin:0 0 10px">A full and final settlement: you acknowledge the payout of <b>${money(chit.payoutAmount)}</b>, the organizer confirms every installment
            you paid, and the receipts they signed before are listed on it and <b>cancelled</b> once it is signed. You sign it here; they sign through the link.</p>
            <form class="form-grid two" onsubmit="return false">${partiesHtml(chit)}
                <div class="span-2">${padHtml('member', 'You sign here (the member)', { hint: 'optional now: it can be added on the paper copy' })}</div></form>`,
        onOpen: m => { bindParties(m.el); pad = bindPad(m.el, 'member'); },
        actions: [{ label: 'Cancel' }, {
            label: 'Make the settlement & link', kind: 'primary', iconName: 'send', onClick: async m => {
                const body = { ...readParties(m.el.querySelector('form')), memberSignature: pad && !pad.empty() ? pad.path() : null };
                const made = await api.post(`/chits/${chit.id}/acks/settlement`, body);
                toast(`${made.ack.ackNo} made`);
                onDone?.();
                setTimeout(() => showLink(chit, made), 0);
            },
        }],
    });
}

function openResend(chit, a, onDone) {
    const again = a.status !== 'PENDING';
    openModal({
        title: again ? `Ask to sign ${a.ackNo} again` : `New link for ${a.ackNo}`, sub: `${a.organizerName} · ${money(a.kind === 'SETTLEMENT' ? a.payoutAmount : a.amount)}`, iconName: 'send',
        body: `${again ? `<p class="hint warn-text" style="margin:0 0 10px">${icon('alert')} It was signed by <b>${esc(a.acceptedName)}</b> on ${dateTime(a.acceptedAt)}. Sending it again discards that
                signature (the activity log keeps its seal), reads the figures afresh and waits for a new one.</p>` : ''}
            <form class="form-grid two" onsubmit="return false">
                <label class="field span-2"><span>Organizer's mobile</span><input name="organizerPhone" type="tel" maxlength="14" value="${esc(a.organizerPhone || '')}" placeholder="10 digits, or leave empty" data-plain></label>
                <label class="check-line span-2"><input type="checkbox" name="savePhone"> Keep this number on the chit</label>
                <div class="span-2 la-make"><span>Valid for</span><div class="ln-chips" data-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
            </form>`,
        onOpen: m => m.el.addEventListener('click', e => {
            const chip = e.target.closest('[data-hours] [data-value]');
            if (chip) m.el.querySelectorAll('[data-hours] [data-value]').forEach(x => x.classList.toggle('selected', x === chip));
        }),
        actions: [{ label: 'Cancel' }, {
            label: again ? 'Ask again' : 'Make a new link', kind: 'primary', iconName: 'send', onClick: async m => {
                const f = m.el.querySelector('form');
                const phone = f.organizerPhone.value.replace(/[\s-]/g, '');
                if (phone && !phoneOk(phone)) throw new Error('The mobile should have 10 digits');
                const made = await api.post(`/chits/${chit.id}/acks/${a.id}/resend`, {
                    hours: Number(m.el.querySelector('[data-hours] .selected')?.dataset.value || 168), organizerPhone: phone || null, savePhone: f.savePhone.checked });
                onDone?.();
                setTimeout(() => showLink(chit, made), 0);
            },
        }],
    });
}

/** The message the organizer gets with the link. */
function messageOf(chit, a, url) {
    const first = (a.organizerName || '').split(' ')[0] || 'Sir';
    return a.kind === 'SETTLEMENT'
        ? `Hello ${first}, this is ${a.memberName} (${chit.name}${chit.ticketNo ? `, ticket ${chit.ticketNo}` : ''}). I have received the payout of ${money(a.payoutAmount)} in full, thank you. `
            + `Please open this link, check the settlement and sign it with your finger; the receipts given earlier are cancelled by it. ${url}`
        : `Hello ${first}, this is ${a.memberName} (${chit.name}${chit.ticketNo ? `, ticket ${chit.ticketNo}` : ''}). Please acknowledge the ${a.schedule.length === 1 ? 'installment' : `${a.schedule.length} installments`} `
            + `of ${money(a.amount)} I paid (${a.schedule.map(l => '#' + l.no).join(', ')}): open the link${a.organizerPhone ? ', type your mobile number' : ''} and sign with your finger. ${url}`;
}

/** The link made: shown once, with WhatsApp (to the number, or to a contact chosen in WhatsApp), SMS, a copy and a QR. */
function showLink(chit, made) {
    const a = made.ack;
    const url = `${location.origin}/chit-receipt.html#${made.token}`;
    const text = messageOf(chit, a, url);
    const phone = digits(a.organizerPhone);
    openModal({
        title: `Send ${a.ackNo} to ${a.organizerName}`, sub: `link works until ${dateTime(a.linkExpiresAt)}`, iconName: 'send',
        body: `<div class="ln-made cs-made">
            <div class="ln-qr">${qrSvg(url, { size: 150 })}</div>
            <div class="ln-made-main">
                <p class="small muted" style="margin:0">Send it now: the link is shown only once.${phone ? ` It opens only with the mobile ending ${esc(phone.slice(-4))}.` : ' WhatsApp asks which contact to send it to.'}</p>
                <a class="btn primary wa-btn" target="_blank" rel="noopener" href="https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}">${icon('phone')}${phone ? `Send on WhatsApp to ${esc(phone)}` : 'Send on WhatsApp (choose the contact)'}</a>
                <div class="row"><a class="btn sm" href="sms:${phone}?body=${encodeURIComponent(text)}">${icon('mail')}SMS</a>
                    ${navigator.share ? `<button type="button" class="btn sm" data-share>${icon('share')}Share…</button>` : ''}</div>
                <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm" data-copy>${icon('copy')}Copy</button></div>
            </div></div>`,
        onOpen: m => m.el.addEventListener('click', async e => {
            if (e.target.closest('[data-copy]')) {
                try { await navigator.clipboard.writeText(text); toast('Message and link copied', 'info'); } catch { m.el.querySelector('.ln-url input').select(); }
            }
            if (e.target.closest('[data-share]')) navigator.share({ title: `${kindName(a)} ${a.ackNo}`, text }).catch(() => {});
        }),
        actions: [{ label: 'Done', kind: 'primary' }],
    });
}

// ===================================================================== one of them

/** The deed (see bondHtml): a receipt or a settlement, with its schedule. */
export function deedOf(a, { real = false, plain = false, verified = null } = {}) {
    const settlement = a.kind === 'SETTLEMENT';
    const signedOnline = a.status === 'SIGNED' || (a.status === 'CANCELLED' && a.signature);
    const accepted = a.acceptedAt ? (a.signature ? `signed online ${dateTime(a.acceptedAt)}` : `signed on paper ${date(String(a.acceptedAt).slice(0, 10))}`) : '';
    const rows = a.schedule.map(l => [`#${l.no}`, date(l.dueDate), date(l.paidDate), money(l.installment), Number(l.dividend) ? money(l.dividend) : '—', money(l.cash),
        l.mode + (l.reference ? ` · ${l.reference}` : '')]);
    const sum = k => a.schedule.reduce((s, l) => s + Number(l[k] || 0), 0);
    const ev = signedOnline && a.acceptanceSeal ? [{ title: 'Evidence of the online signature', rows: evidenceRows({
        name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: a.phoneMatches, ip: a.acceptedIp, device: a.acceptedDevice,
        userAgent: a.acceptedUserAgent, location: a.acceptedLocation, deviceHash: a.deviceHash, seal: a.acceptanceSeal,
        digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified }).concat(a.acceptedRemarks ? [['Remarks', esc(a.acceptedRemarks)]] : []) }] : [];
    return {
        kind: 'RECEIPT', docTerm: settlement ? 'Settlement' : 'Receipt',
        title: settlement ? 'Payout settlement and cancellation of receipts' : 'Receipt and acknowledgement of chit installments',
        number: a.ackNo, date: a.acceptedAt ? String(a.acceptedAt).slice(0, 10) : String(a.createdAt).slice(0, 10), place: a.place,
        stampDuty: a.stampDuty || (settlement ? 100 : null), stampSerial: a.stampSerial, realStampPaper: real, plainPaper: plain,
        revenueStamp: !settlement && plain && Number(a.amount) > 5000,
        copyLabels: ['ORIGINAL · member’s copy', 'DUPLICATE · organizer’s copy'],
        firstParty: { role: 'Organizer', term: 'Organizer', name: a.status !== 'PENDING' && a.acceptedName ? a.acceptedName : a.organizerName, address: a.organizerAddress,
            phone: a.organizerPhone, signature: signedOnline ? a.signature : null, accepted },
        secondParty: { role: 'Member', term: 'Member', name: a.memberName, address: a.memberAddress, signature: a.memberSignature },
        witness: { name: a.witnessName, phone: a.witnessPhone, signature: a.witnessSignature },
        recitals: chitReceiptRecitals(a.kind, a.chitName, `${money(a.amount)} (${a.amountInWords})`, money(a.payoutAmount)),
        particulars: [['Chit', `${a.chitName}${a.ticketNo ? ` · ticket ${a.ticketNo}` : ''}`], ...(a.chitValue ? [['Chit value', money(a.chitValue)]] : []),
            ...(settlement ? [['Payout received', `${money(a.payoutAmount)}${a.payoutDate ? ` · from ${date(a.payoutDate)}` : ''}`]] : []),
            [settlement ? 'Installments paid (cash)' : 'Amount received', `${money(a.amount)} (${a.amountInWords})`],
            ['Installments', `${a.schedule.length}: ${a.schedule.map(l => '#' + l.no).join(', ')}`],
            ...(settlement && a.cancels.length ? [['Receipts cancelled', a.cancels.map(c => `${c.ackNo} (${money(c.amount)})`).join(', ')]] : [])],
        tables: [{ title: 'Schedule · the installments', head: ['No.', 'Due', 'Paid on', 'Installment', 'Dividend', 'Cash paid', 'How paid'], right: [3, 4, 5],
            rows, foot: ['Total', '', '', money(sum('installment')), sum('dividend') ? money(sum('dividend')) : '—', money(sum('cash')), ''] }],
        terms: a.terms, fingerprint: a.contentHash,
        annexures: ev,
        footnote: a.status === 'CANCELLED' ? `Cancelled by ${a.cancelledByAckNo} on ${dateTime(a.cancelledAt)}` : a.digitalSignature ? `Digitally signed evidence · key ${a.keyFingerprint}` : '',
    };
}

export async function openAck(chit, first, onChanged) {
    const st = { a: first, tab: first.status === 'PENDING' ? 'link' : 'evidence', paper: 'style', changed: false, verified: null };
    st.verified = await verifyEvidence(first.evidencePayload, first.digitalSignature, first.publicKey);
    const pending = () => st.a.status === 'PENDING';
    let pads = {};
    const panels = {
        link: () => {
            const a = st.a;
            const [tone, label] = LINK[a.linkStatus] || LINK.NONE;
            return `<div class="la-panel">
                <div class="la-linkcard"><span class="badge ${tone}">${icon('link')}${label}</span>
                    ${a.linkExpiresAt && a.linkStatus === 'ACTIVE' ? `<small>until ${dateTime(a.linkExpiresAt)}</small>` : ''}
                    ${a.sentAt ? `<small>sent ${dateTime(a.sentAt)}${a.sendCount > 1 ? ` · ${a.sendCount} times` : ''}</small>` : ''}
                    <small>opened ${a.views}×${a.lastViewedAt ? `, last ${dateTime(a.lastViewedAt)}` : ''}</small>
                    ${a.failedAttempts ? `<small class="${a.lockedAt ? 'neg' : 'warn-text'}">${a.failedAttempts} wrong number${a.failedAttempts === 1 ? '' : 's'}${a.lockedAt ? ' · locked' : ''}</small>` : ''}</div>
                <ul class="la-steps">
                    <li>${icon('phone')}<span>${esc(a.organizerName)} opens the link${a.organizerPhone ? ` and types the mobile ending <b>${esc(a.organizerPhone.slice(-4))}</b>` : ' and types their mobile number (recorded)'}; five wrong numbers lock it.</span></li>
                    <li>${icon('signature')}<span>They read it with the schedule, sign with a finger and accept${a.requireLocation ? ', sharing their location' : ''}.</span></li>
                    <li>${icon('shield')}<span>The time, IP address, device and signature are sealed and digitally signed: valid evidence later.</span></li>
                </ul>
                ${a.status !== 'CANCELLED' ? `<div class="row"><button type="button" class="btn sm primary" data-a="resend">${icon('send')}${pending() ? 'Send a new link' : 'Ask to sign again'}</button>
                    ${a.linkStatus === 'ACTIVE' ? `<button type="button" class="btn sm ghost" data-a="revoke">${icon('lock')}Stop the link</button>` : ''}</div>` : ''}
            </div>`;
        },
        paper: () => {
            const a = st.a;
            return `<form class="form-grid two la-panel" data-paper onsubmit="return false">
                <p class="hint span-2" style="margin:0">Print it, have ${esc(a.organizerName)} sign ${a.kind === 'RECEIPT' && Number(a.amount) > 5000 ? 'across a revenue stamp' : 'it'} (on stamp paper if you wish), then record it with <i>Signed on paper</i>.</p>
                <label class="field"><span>Stamp paper value</span><input type="number" name="stampDuty" class="num" min="0" step="10" value="${Number(a.stampDuty) || ''}" data-plain></label>
                <label class="field"><span>Serial no.</span><input type="text" name="stampSerial" maxlength="40" value="${esc(a.stampSerial || '')}" data-plain></label>
                <div class="span-2 ag-sig"><div class="ag-sig-now">${a.memberSignature ? signatureSvg(a.memberSignature) : '<span class="muted small">Not signed yet</span>'}<small>Your signature (member)</small></div>
                    <div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-a="draw-member">${icon('edit')}Sign on this device</button>
                        ${a.memberSignature ? `<button type="button" class="btn sm ghost" data-a="clear-member">${icon('x')}Remove</button>` : ''}</div>
                    <div data-pad-member hidden>${padHtml('member', 'You sign here')}</div></div>
                <label class="field"><span>Witness</span><input name="witnessName" maxlength="100" value="${esc(a.witnessName || '')}" data-plain></label>
                <label class="field"><span>Witness's mobile</span><input name="witnessPhone" type="tel" maxlength="14" value="${esc(a.witnessPhone || '')}" data-plain></label>
                <div class="span-2 ag-sig"><div class="ag-sig-now">${a.witnessSignature ? signatureSvg(a.witnessSignature) : '<span class="muted small">Not signed yet</span>'}<small>Witness's signature</small></div>
                    <div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-a="draw-witness">${icon('edit')}Witness signs here</button>
                        ${a.witnessSignature ? `<button type="button" class="btn sm ghost" data-a="clear-witness">${icon('x')}Remove</button>` : ''}</div>
                    <div data-pad-witness hidden>${padHtml('witness', 'Witness signs here')}</div></div>
                <div class="span-2 row"><span class="grow"></span><button type="button" class="btn primary sm" data-a="save-paper">${icon('check')}Save</button></div>
            </form>`;
        },
        evidence: () => {
            const a = st.a;
            if (!a.acceptedAt) return `<div class="la-panel"><p class="muted">Nothing signed yet. The evidence appears here once ${esc(a.organizerName)} signs.</p></div>`;
            if (!a.signature) return `<div class="la-panel"><p>${icon('edit')}Signed on paper by <b>${esc(a.acceptedName)}</b>, recorded ${dateTime(a.acceptedAt)} · ${esc(a.acceptedUserAgent || '')}</p></div>`;
            return `<div class="la-panel">
                ${a.status === 'CANCELLED' ? `<p class="muted">${icon('x')}Cancelled by the settlement ${esc(a.cancelledByAckNo)} on ${dateTime(a.cancelledAt)}.</p>` : ''}
                <div class="cs-sig-status ${st.verified === false ? 'bad' : st.verified ? 'ok' : 'wait'}"><b>${st.verified ? '✓ Digital signature verified' : st.verified === false ? '✗ The signature does not match' : 'The signature could not be checked here'}</b>
                    <small>ECDSA P-256 · key ${esc(a.keyFingerprint)}</small></div>
                <table class="bond-facts ev"><tbody>${evidenceRows({ name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: a.phoneMatches,
                    ip: a.acceptedIp, device: a.acceptedDevice, userAgent: a.acceptedUserAgent, location: a.acceptedLocation, deviceHash: a.deviceHash,
                    seal: a.acceptanceSeal, digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified: st.verified })
                    .concat(a.acceptedRemarks ? [['Remarks', esc(a.acceptedRemarks)]] : [])
                    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
                ${a.acceptedLocation ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(a.acceptedLocation.split(',').slice(0, 2).join(','))}">${icon('flag')}Open the location on a map</a>` : ''}
            </div>`;
        },
    };
    const [tone, ic, label] = ACK_STATUS[first.status] || ACK_STATUS.PENDING;
    const doc = () => deedOf(st.a, { real: st.paper === 'real', plain: st.paper === 'plain', verified: st.verified });
    const modal = openModal({
        title: `${kindName(first)} ${first.ackNo}`, sub: `${first.organizerName} · ${money(first.kind === 'SETTLEMENT' ? first.payoutAmount : first.amount)}`, iconName: 'file-text', size: 'xl hc-ag-modal',
        body: `<div class="ag-layout">
            <div class="ag-side">
                <div class="ag-status"><span class="badge ${tone}">${icon(ic)}${label}</span><small class="muted">${esc(first.ackNo)} · made ${dateTime(first.createdAt)}</small></div>
                <div class="seg-chips sm" data-tabs>${[['link', 'Link', 'link'], ['paper', 'Paper copy', 'signature'], ['evidence', 'Evidence', 'shield']]
                    .map(([k, l, i]) => `<button type="button" class="seg-chip ${k === st.tab ? 'active' : ''}" data-tab="${k}">${icon(i)}${l}</button>`).join('')}</div>
                <div data-panel></div>
            </div>
            <div class="ag-paper">
                <div class="ag-paper-tools"><div class="seg-chips sm" data-style>
                    <button type="button" class="seg-chip active" data-paper="style">${icon('stamp')}Stamp-paper style</button>
                    <button type="button" class="seg-chip" data-paper="real" title="Leaves the top of the first page blank for real non-judicial stamp paper">${icon('printer')}Real stamp paper</button>
                    <button type="button" class="seg-chip" data-paper="plain" title="Plain paper with a revenue stamp box, to sign by hand">${icon('file-text')}Plain + revenue stamp</button></div></div>
                <div class="bond-preview" data-bond></div>
            </div>
        </div>`,
        actions: [
            { label: 'Print view', left: true, iconName: 'printer', onClick: () => { printBond(doc(), `${kindName(st.a)} ${st.a.ackNo}`); return true; } },
            { label: 'Delete', iconName: 'trash', onClick: async () => { if (!await deleteAck(chit, st.a)) return true; onChanged?.(); } },
            ...(first.status === 'PENDING' ? [{ label: 'Signed on paper', iconName: 'edit', onClick: async () => {
                if (!await confirmDialog(`Record that ${st.a.organizerName} signed the printed ${st.a.kind === 'SETTLEMENT' ? 'settlement' : 'receipt'}? The link stops working.`,
                    { title: 'Signed on paper', confirmLabel: 'Record signature', danger: false })) return true;
                await api.post(`/chits/${chit.id}/acks/${st.a.id}/signed`, { name: st.a.organizerName });
                toast('Signature recorded');
                onChanged?.();
            } }] : []),
            { label: 'Close', kind: 'primary', onClick: () => { if (st.changed) onChanged?.(); } },
        ],
    });
    const el = modal.el;
    const panel = el.querySelector('[data-panel]');
    const drawBond = () => { el.querySelector('[data-bond]').innerHTML = bondHtml(doc()); };
    const drawPanel = () => { panel.innerHTML = panels[st.tab](); pads = { member: bindPad(el, 'member'), witness: bindPad(el, 'witness') }; };
    const refresh = (fresh, msg) => { st.a = fresh; st.changed = true; drawPanel(); drawBond(); if (msg) toast(msg); };
    drawPanel();
    drawBond();
    el.querySelector('[data-close]')?.addEventListener('click', () => { if (st.changed) onChanged?.(); });
    el.querySelector('[data-tabs]').addEventListener('click', e => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        st.tab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
        drawPanel();
    });
    el.querySelector('[data-style]').addEventListener('click', e => {
        const b = e.target.closest('[data-paper]');
        if (!b) return;
        st.paper = b.dataset.paper;
        el.querySelectorAll('[data-paper]').forEach(x => x.classList.toggle('active', x === b));
        drawBond();
    });
    panel.addEventListener('click', async e => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const base = `/chits/${chit.id}/acks/${st.a.id}`;
        try {
            const act = b.dataset.a;
            if (act === 'draw-member') { panel.querySelector('[data-pad-member]').hidden = false; return; }
            if (act === 'draw-witness') { panel.querySelector('[data-pad-witness]').hidden = false; return; }
            if (act === 'clear-member') { refresh(await api.put(`${base}/paper`, { clearMemberSignature: true }), 'Signature removed'); return; }
            if (act === 'clear-witness') { refresh(await api.put(`${base}/paper`, { clearWitnessSignature: true }), 'Signature removed'); return; }
            if (act === 'save-paper') {
                const f = panel.querySelector('[data-paper]');
                const phone = f.witnessPhone.value.replace(/[\s-]/g, '');
                if (phone && !phoneOk(phone)) throw new Error('The witness’s mobile should have 10 digits');
                refresh(await api.put(`${base}/paper`, {
                    stampDuty: Number(f.stampDuty.value || 0), stampSerial: f.stampSerial.value.trim(), witnessName: f.witnessName.value.trim(), witnessPhone: phone,
                    memberSignature: pads.member && !pads.member.empty() ? pads.member.path() : null,
                    witnessSignature: pads.witness && !pads.witness.empty() ? pads.witness.path() : null,
                }), 'Saved');
                return;
            }
            if (act === 'resend') { modal.close(); openResend(chit, st.a, onChanged); return; }
            if (act === 'revoke') refresh(await api.post(`${base}/revoke`), 'Link stopped');
        } catch (err) { toast(err.message, 'error'); }
    });
}
