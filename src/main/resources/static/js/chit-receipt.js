/**
 * The page behind a chit receipt link (/chit-receipt.html#<token>): no sign-in. The chit's organizer types their
 * mobile number (the one on record must match; without one, the number typed is recorded), reads the receipt (or the
 * payout settlement) with its schedule of installments, signs with a finger and accepts. Recorded with it: the time,
 * IP address, this device's details and the location if allowed (or required), sealed and digitally signed; the
 * signature is checked here once signed. The same document prints as a stamp-paper deed.
 */
import { trackedFetch } from './core/busy.js';
import { bondHtml, printBond, signaturePad, signatureSvg, deviceInfo, locate, verifyEvidence, chitReceiptRecitals } from './core/bond.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const money = v => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;

const token = location.hash.slice(1);
const base = `/api/public/chit-receipts/${encodeURIComponent(token)}`;
let ack = null;
let phone = '';
let pad = null;
const settlement = () => ack.kind === 'SETTLEMENT';
const what = () => (settlement() ? 'payout settlement' : 'payment receipt');

async function call(path, body) {
    const r = await trackedFetch(base + path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'This link does not work any more.');
    return data;
}

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    try { ack = await call('', {}); } catch (e) { main.innerHTML = message(e.message); return; }
    draw();
}

function draw() {
    const main = $('sh-main');
    document.title = `${settlement() ? 'Payout settlement' : 'Chit receipt'} · ${ack.memberName}`;
    if (ack.step === 'VERIFY') { main.innerHTML = gateHtml(); bindGate(); return; }
    main.innerHTML = ack.step === 'DONE' ? doneHtml() : openHtml();
    if (ack.step === 'OPEN') bindOpen(); else checkSignature();
    $('cr-print')?.addEventListener('click', () => printBond(deed(), `${ack.ackNo}`));
    $('cr-preview')?.addEventListener('click', () => {
        const box = $('cr-deed');
        box.hidden = !box.hidden;
        if (!box.hidden) box.innerHTML = bondHtml(deed());
    });
}

// ---------------------------------------------------------------- the gate

function gateHtml() {
    return `<section class="sh-card la-gate">
        <div class="la-lock">🔒</div>
        <small>${esc(ack.household)} · ${esc(ack.ackNo)}</small>
        <h1>${settlement() ? 'A payout settlement' : 'A receipt to acknowledge'} from ${esc(ack.memberName)}</h1>
        <p>It was sent to <b>${esc(ack.organizerHint || 'you')}</b>. ${ack.phoneOnRecord
            ? `To open it, type the mobile number it was sent to (<b>${esc(ack.phoneHint)}</b>).` : 'To open it, type your mobile number: it is recorded with your signature.'}</p>
        <form id="cr-gate" onsubmit="return false">
            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="Your 10-digit mobile number" autofocus>
            <button type="submit" class="cs-pay-btn">Open</button>
            <p class="cs-error" id="cr-gate-error">${esc(ack.error || '')}</p>
            ${ack.phoneOnRecord && ack.attemptsLeft < 5 ? `<small class="muted">${ack.attemptsLeft} tr${ack.attemptsLeft === 1 ? 'y' : 'ies'} left before the link locks.</small>` : ''}
        </form>
        <small class="muted">The link works until ${when(ack.expiresAt)}.</small>
    </section>`;
}

function bindGate() {
    const form = $('cr-gate');
    form.addEventListener('submit', async () => {
        const digits = form.phone.value.replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(digits)) { $('cr-gate-error').textContent = 'Enter your 10-digit mobile number'; return; }
        form.querySelector('button').disabled = true;
        try {
            const r = await call('', { phone: digits });
            if (r.step !== 'VERIFY') phone = digits;
            ack = r;
            draw();
        } catch (e) {
            $('cr-gate-error').textContent = e.message;
            form.querySelector('button').disabled = false;
        }
    });
}

// ---------------------------------------------------------------- reading and signing

function headHtml(badge, tone) {
    return `<div class="sh-head"><div><small>${esc(ack.household)} · ${what()} · ${esc(ack.ackNo)}</small><h1>${esc(ack.chitName)}${ack.ticketNo ? ` · ${esc(ack.ticketNo)}` : ''}</h1>
        <small>from ${esc(ack.memberName)} to ${esc(ack.organizerName)}${ack.place ? ` · ${esc(ack.place)}` : ''}</small></div><span class="st-badge ${tone}">${badge}</span></div>`;
}

function figuresHtml() {
    return settlement()
        ? `<div class="st-total"><div><span>Payout received</span><b>${money(ack.payoutAmount)}</b><small>${ack.payoutDate ? `from ${day(ack.payoutDate)}` : ''}</small></div>
            <div class="st-side"><span>Installments paid</span><b>${money(ack.amount)}</b><small>${ack.schedule.length} installments</small></div></div>`
        : `<div class="st-total"><div><span>You received</span><b>${money(ack.amount)}</b><small>${esc(ack.amountInWords)}</small></div>
            <div class="st-side"><span>Installments</span><b>${ack.schedule.length}</b><small>${ack.schedule.map(l => '#' + l.no).join(', ')}</small></div></div>`;
}

function scheduleHtml() {
    const sum = k => ack.schedule.reduce((s, l) => s + Number(l[k] || 0), 0);
    return `<div class="cr-sched"><table class="bond-sched"><thead><tr><th>No.</th><th>Due</th><th>Paid on</th><th class="r">Cash</th><th>How</th></tr></thead>
        <tbody>${ack.schedule.map(l => `<tr><td>#${l.no}</td><td>${day(l.dueDate)}</td><td>${day(l.paidDate)}</td><td class="r">${money(l.cash)}${Number(l.dividend) ? `<br><small>+ dividend ${money(l.dividend)}</small>` : ''}</td>
            <td>${esc(l.mode)}${l.reference ? `<br><small>${esc(l.reference)}</small>` : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Total</th><th class="r">${money(sum('cash'))}</th><th></th></tr></tfoot></table>
        ${settlement() && ack.cancels.length ? `<p class="cr-cancels">Cancelled by this settlement: <b>${ack.cancels.map(c => `${esc(c.ackNo)} (${money(c.amount)})`).join(', ')}</b></p>` : ''}</div>`;
}

function openHtml() {
    return `<section class="sh-card cs-agreement">
        ${headHtml('Waiting for you', 'part')}
        ${figuresHtml()}
        ${scheduleHtml()}
        <div class="cs-terms">${esc(ack.terms)}</div>
        <div class="cs-print-row"><button type="button" class="cs-print" id="cr-preview">See it as a stamp-paper copy</button><button type="button" class="cs-print" id="cr-print">Print view (A4)</button></div>
        <div id="cr-deed" class="bond-preview" hidden></div>
        <form class="cs-accept la-step" id="cr-accept" onsubmit="return false"><div class="la-step-no">✍</div><div class="min-0 grow">
            <b>Sign and acknowledge</b>
            <div class="cs-fields">
                <label class="cs-name"><span>Your full name <small>you sign as the organizer, or for them</small></span><input name="name" maxlength="100" autocomplete="name" value="${esc(ack.organizerName)}"></label>
                <label class="cs-name"><span>Remarks <small>optional</small></span><input name="remarks" maxlength="300" placeholder="e.g. received by UPI"></label>
            </div>
            <div class="cs-sign"><div class="cs-sign-head"><span>Sign here with your finger</span><button type="button" id="cr-sign-clear">Clear</button></div>
                <canvas id="cr-sign" width="1000" height="300"></canvas></div>
            <label class="cs-check"><input type="checkbox" name="location" ${ack.requireLocation ? 'checked disabled' : ''}> Add my current location to the record${ack.requireLocation ? ' (required)' : ''}</label>
            <label class="cs-check"><input type="checkbox" name="agree"> ${settlement()
                ? `I have read this settlement. I confirm that I received every installment listed, that the payout of ${money(ack.payoutAmount)} is paid, and that the receipts listed are cancelled.`
                : `I have read this receipt and I confirm that I received ${money(ack.amount)} for the installments listed.`}</label>
            <p class="cs-error" id="cr-error"></p>
            <button type="submit" class="cs-pay-btn">Sign and acknowledge</button>
            <small class="muted">Recorded with your signature: your name, mobile number, the time, your IP address, this phone's details${ack.requireLocation ? ' and your location' : ' and your location if you allow it'}.
                They are sealed together and digitally signed, so any change shows.</small>
        </div></form>
        <p class="cs-hash">Fingerprint of the document (SHA-256) <code>${esc(ack.contentHash)}</code></p>
    </section>`;
}

function bindOpen() {
    pad = signaturePad($('cr-sign'));
    $('cr-sign-clear').addEventListener('click', () => pad.clear());
    const form = $('cr-accept');
    form.addEventListener('submit', async () => {
        const error = $('cr-error');
        const button = form.querySelector('button[type=submit]');
        error.textContent = '';
        if (form.name.value.trim().length < 2) { error.textContent = 'Type your full name'; return; }
        if (pad.empty()) { error.textContent = 'Sign in the box'; return; }
        if (!form.agree.checked) { error.textContent = 'Tick the box to confirm'; return; }
        button.disabled = true;
        button.textContent = 'Recording…';
        try {
            const location = form.location.checked || ack.requireLocation ? await locate() : null;
            if (ack.requireLocation && !location) throw new Error('Allow your location when your phone asks (check the browser’s site settings), then try again');
            ack = await call('/accept', { phone, name: form.name.value, agree: true, signature: pad.path(), location,
                remarks: form.remarks.value.trim() || null, device: JSON.stringify(deviceInfo()) });
            draw();
            window.scrollTo(0, 0);
        } catch (e) {
            error.textContent = e.message;
            button.disabled = false;
            button.textContent = 'Sign and acknowledge';
        }
    });
}

// ---------------------------------------------------------------- signed

function doneHtml() {
    const cancelled = ack.status === 'CANCELLED';
    return `<section class="sh-card cs-agreement">
        ${headHtml(cancelled ? 'Cancelled' : ack.status === 'PAPER' ? 'Signed on paper' : 'Signed', cancelled ? 'part' : 'done')}
        ${figuresHtml()}
        ${cancelled ? `<div class="cs-accepted">This receipt was cancelled by the settlement <b>${esc(ack.cancelledByAckNo)}</b> on ${when(ack.cancelledAt)}.</div>` : ''}
        ${ack.acceptedAt ? `<div class="cs-accepted">✓ Signed by <b>${esc(ack.acceptedName)}</b> on ${when(ack.acceptedAt)}${ack.locationShared ? ' · location shared' : ''}
            ${ack.acceptedRemarks ? `<br><small>${esc(ack.acceptedRemarks)}</small>` : ''}
            ${ack.signature ? `<div class="cs-sign-show">${signatureSvg(ack.signature)}</div>` : ''}
            ${ack.acceptanceSeal ? `<small>Seal (SHA-256) <code>${esc(ack.acceptanceSeal)}</code></small>` : ''}
            ${ack.digitalSignature ? '<div class="cs-sig-status wait" id="cr-sig"><b>Checking the digital signature…</b></div>' : ''}</div>` : ''}
        ${scheduleHtml()}
        <div class="cs-terms">${esc(ack.terms)}</div>
        <div class="cs-print-row"><button type="button" class="cs-print" id="cr-preview">See it as a stamp-paper copy</button><button type="button" class="cs-print" id="cr-print">Print / save a copy</button></div>
        <div id="cr-deed" class="bond-preview" hidden></div>
        <p class="cs-hash">Fingerprint of the document (SHA-256) <code>${esc(ack.contentHash)}</code></p>
    </section>`;
}

async function checkSignature() {
    const el = $('cr-sig');
    if (!el) return;
    const ok = await verifyEvidence(ack.evidencePayload, ack.digitalSignature, ack.publicKey);
    el.className = `cs-sig-status ${ok === false ? 'bad' : ok ? 'ok' : 'wait'}`;
    el.innerHTML = ok === null ? '<b>This browser cannot check the digital signature</b><small>Open the link in Chrome or Safari over https.</small>'
        : ok ? `<b>✓ Digital signature verified</b><small>The record of your signature is signed with key <code>${esc(ack.keyFingerprint)}</code>; any change would show here.</small>`
        : '<b>✗ The signature does not match</b><small>The record was changed after it was signed.</small>';
}

function deed() {
    const signed = !!ack.signature;
    const sum = k => ack.schedule.reduce((s, l) => s + Number(l[k] || 0), 0);
    return {
        kind: 'RECEIPT', docTerm: settlement() ? 'Settlement' : 'Receipt',
        title: settlement() ? 'Payout settlement and cancellation of receipts' : 'Receipt and acknowledgement of chit installments',
        number: ack.ackNo, date: (ack.acceptedAt || ack.createdAt || '').slice(0, 10), place: ack.place, stampDuty: ack.stampDuty, stampSerial: ack.stampSerial,
        firstParty: { role: 'Organizer', term: 'Organizer', name: ack.acceptedName || ack.organizerName, address: ack.organizerAddress,
            signature: signed ? ack.signature : null, accepted: signed ? `signed online ${when(ack.acceptedAt)}` : '' },
        secondParty: { role: 'Member', term: 'Member', name: ack.memberName, address: ack.memberAddress, signature: ack.memberSignature },
        witness: { name: ack.witnessName, signature: ack.witnessSignature },
        recitals: chitReceiptRecitals(ack.kind, ack.chitName, `${money(ack.amount)} (${ack.amountInWords})`, money(ack.payoutAmount)),
        particulars: [['Chit', `${ack.chitName}${ack.ticketNo ? ` · ticket ${ack.ticketNo}` : ''}`], ...(ack.chitValue ? [['Chit value', money(ack.chitValue)]] : []),
            ...(settlement() ? [['Payout received', money(ack.payoutAmount)]] : []), [settlement() ? 'Installments paid (cash)' : 'Amount received', `${money(ack.amount)} (${ack.amountInWords})`]],
        tables: [{ title: 'Schedule · the installments', head: ['No.', 'Due', 'Paid on', 'Installment', 'Dividend', 'Cash paid', 'How paid'], right: [3, 4, 5],
            rows: ack.schedule.map(l => [`#${l.no}`, day(l.dueDate), day(l.paidDate), money(l.installment), Number(l.dividend) ? money(l.dividend) : '—', money(l.cash),
                l.mode + (l.reference ? ` · ${l.reference}` : '')]),
            foot: ['Total', '', '', money(sum('installment')), sum('dividend') ? money(sum('dividend')) : '—', money(sum('cash')), ''] }],
        terms: ack.terms, fingerprint: ack.contentHash,
        annexures: ack.acceptanceSeal ? [{ title: 'Evidence of the online signature', rows: [['Signed by', esc(ack.acceptedName)], ['Signed at', esc(when(ack.acceptedAt))],
            ['Seal (SHA-256)', `<code>${esc(ack.acceptanceSeal)}</code>`],
            ...(ack.digitalSignature ? [['Digital signature', `<code>${esc(ack.digitalSignature.slice(0, 44))}…</code><br>key ${esc(ack.keyFingerprint || '')}`]] : [])] }] : [],
    };
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Chit receipt</h1><p>${esc(text)}</p></section>`;
}

start();
