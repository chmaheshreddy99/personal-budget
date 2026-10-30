/**
 * The page behind an acknowledgement link (/chit-receipt.html#<token>): no sign-in. The token stays in the address
 * fragment (never sent to other sites) and opens nothing on its own: the organizer types their mobile number first and
 * sends it again with every step; five wrong numbers lock the link.
 *
 * Then: read which installments they are acknowledging (one or several), take a live selfie when the payer asked for
 * one, type their name, sign with a finger and confirm they received the money, or say what is wrong. Recorded with the
 * signature: the time, IP address, this device's details and the location if allowed, sealed and digitally signed; the
 * signature is checked here once acknowledged.
 */
import { trackedFetch } from './core/busy.js';
import { printBond, signaturePad, signatureSvg, deviceInfo, locate, openCamera, verifyEvidence, bondHtml, addEvidenceButton } from './core/bond.js';
import { receiptDeed } from './core/receipt-deed.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const money = v => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;

const token = location.hash.slice(1);
const base = `/api/public/chit-receipts/${encodeURIComponent(token)}`;
let r = null;
let phone = '';
let cam = null;
let pad = null;

async function call(path, body) {
    const res = await trackedFetch(base + path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'This link does not work any more.');
    return data;
}

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    try { r = await call('', {}); } catch (e) { main.innerHTML = message(e.message); return; }
    draw();
}

function draw() {
    const main = $('sh-main');
    document.title = `${r.kind === 'PAYOUT' ? 'Payout receipt' : 'Acknowledgement of receipt'} · ${r.payerName}`;
    if (r.step === 'VERIFY') { main.innerHTML = gateHtml(); bindGate(); return; }
    main.innerHTML = r.step === 'OPEN' ? openHtml() : r.step === 'DISPUTED' ? disputedHtml() : doneHtml();
    if (r.step === 'OPEN') bindOpen(); else if (r.step === 'DONE') checkSignature();
    $('cr-print')?.addEventListener('click', () => printBond(receiptDeed(r), `Acknowledgement ${r.ackNo}`));
    $('cr-preview')?.addEventListener('click', () => {
        const box = $('cr-deed');
        box.hidden = !box.hidden;
        if (!box.hidden) box.innerHTML = bondHtml(receiptDeed(r));
    });
}

// ---------------------------------------------------------------- the gate: the organizer's mobile number

function gateHtml() {
    return `<section class="sh-card la-gate">
        <div class="la-lock">🔒</div>
        <small>${esc(r.household)} · ${esc(r.ackNo)}</small>
        <h1>${esc(r.payerName)} asks you to ${r.kind === 'PAYOUT' ? 'confirm the payout and final settlement' : 'acknowledge a payment'}</h1>
        <p>It was sent to <b>${esc(r.organizerHint || 'you')}</b>. To open it, type the mobile number it was sent to${r.phoneHint ? ` (<b>${esc(r.phoneHint)}</b>)` : ''}.</p>
        <form id="cr-gate" onsubmit="return false">
            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="Your 10-digit mobile number" autofocus>
            <button type="submit" class="cs-pay-btn">Open</button>
            <p class="cs-error" id="cr-gate-error">${esc(r.error || '')}</p>
            ${r.attemptsLeft < 5 ? `<small class="muted">${r.attemptsLeft} tr${r.attemptsLeft === 1 ? 'y' : 'ies'} left before the link locks.</small>` : ''}
        </form>
        <small class="muted">The link works until ${when(r.expiresAt)}.</small>
    </section>`;
}

function bindGate() {
    const form = $('cr-gate');
    form.addEventListener('submit', async () => {
        const digits = form.phone.value.replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(digits)) { $('cr-gate-error').textContent = 'Enter your 10-digit mobile number'; return; }
        form.querySelector('button').disabled = true;
        try {
            const next = await call('', { phone: digits });
            if (next.step !== 'VERIFY') phone = digits;
            r = next;
            draw();
        } catch (e) {
            $('cr-gate-error').textContent = e.message;
            form.querySelector('button').disabled = false;
        }
    });
}

// ---------------------------------------------------------------- reading and signing

function headHtml(badge, tone) {
    return `<div class="sh-head"><div><small>${esc(r.household)} · ${isSimple() ? 'receipt' : 'acknowledgement of receipt'} · ${esc(r.ackNo)}</small><h1>${esc(r.chitName)}${r.ticketNo ? ` · ${esc(r.ticketNo)}` : ''}</h1>
        <small>from ${esc(r.payerName)} to ${esc(r.organizerName)}</small></div><span class="st-badge ${tone}">${badge}</span></div>`;
}

const isPayout = () => r.kind === 'PAYOUT';
const isSimple = () => r.kind === 'SIMPLE';

function totalHtml() {
    const n = r.lines.length;
    return isPayout()
        ? `<div class="st-total"><div><span>Payout paid by you</span><b>${money(r.totalAmount)}</b><small>${esc(r.amountInWords)}</small></div>
            <div class="st-side"><span>Received in</span><b>${n}</b><small>${n === 1 ? 'one payment' : 'parts'} · in full</small></div></div>`
        : `<div class="st-total"><div><span>Paid to you</span><b>${money(r.totalAmount)}</b><small>${esc(r.amountInWords)}</small></div>
            <div class="st-side"><span>Installments</span><b>${n}</b><small>no. ${r.lines.map(l => l.no).join(', ')}</small></div></div>`;
}

function linesTable(lines, { first, last, installments }) {
    const dividends = lines.some(l => Number(l.dividend) > 0);
    return `<table class="cr-lines"><thead><tr><th>#</th><th>${first}</th>${installments ? `<th>Installment${dividends ? ' · dividend' : ''}</th>` : '<th></th>'}<th class="r">${last}</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.no}</td><td>${day(l.paidDate)}${installments ? `<small>due ${day(l.dueDate)}</small>` : ''}</td>
            <td>${installments ? `${money(l.dueAmount)}${Number(l.dividend) ? `<small>dividend ${money(l.dividend)}</small>` : ''}` : ''}</td><td class="r"><b>${money(l.cash)}</b></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="r">${money(lines.reduce((s, l) => s + Number(l.cash), 0))}</td></tr></tfoot></table>`;
}

function linesHtml() {
    if (isSimple()) {
        return `<div class="cr-chips">${r.lines.map(l => `<span><b>#${l.no}</b>${day(l.paidDate)}<i>${money(l.cash)}</i></span>`).join('')}</div>`;
    }
    const note = r.paymentNote ? `<p class="cr-note"><b>${isPayout() ? 'Payout' : 'Payment'} details given by ${esc(r.payerName)}:</b> ${esc(r.paymentNote)}</p>` : '';
    if (!isPayout()) return linesTable(r.lines, { first: 'Paid on', last: 'You received', installments: true }) + note;
    return `<h3 class="cr-h">The payout you paid</h3>${linesTable(r.lines, { first: 'Paid on', last: 'Paid by you', installments: false })}${note}
        <h3 class="cr-h">Installments received by you (restated)</h3>${linesTable(r.installLines, { first: 'Paid on', last: 'You received', installments: true })}
        ${(r.supersedes || []).length ? `<p class="cr-note"><b>Cancelled when you sign:</b> ${r.supersedes.map(esc).join(', ')}. This replaces ${r.supersedes.length === 1 ? 'it' : 'them'}.</p>` : ''}`;
}

function openHtml() {
    let no = 0;
    return `<section class="sh-card cs-agreement">
        ${headHtml('Waiting for you', 'part')}
        ${totalHtml()}
        ${linesHtml()}
        <div class="cs-terms ${isSimple() ? 'cr-short' : ''}">${esc(r.terms)}</div>
        <div class="cs-print-row" ${isSimple() ? 'hidden' : ''}><button type="button" class="cs-print" id="cr-preview">See it as a document</button><button type="button" class="cs-print" id="cr-print">Print view (A4)</button></div>
        <div id="cr-deed" class="bond-preview" hidden></div>
        ${r.requireSelfie ? `<div class="la-step"><div class="la-step-no">${++no}</div><div class="min-0 grow">
            <b>A selfie</b><small>Taken now with your phone's front camera (not from the gallery); the date and time are printed on it.</small>
            ${r.hasSelfie ? '<p class="la-ok">✓ Selfie added</p>' : ''}
            <div class="kyc-cam" id="cr-cam" hidden><div class="kyc-frame"><video autoplay playsinline muted></video></div>
                <div class="kyc-cam-acts"><button type="button" class="cs-print" id="cr-shoot">Take the photo</button><button type="button" class="cs-print" id="cr-cam-stop">Cancel</button></div></div>
            <button type="button" class="cs-print" id="cr-cam-open">${r.hasSelfie ? 'Retake the selfie' : 'Open the camera'}</button>
        </div></div>` : ''}
        <p class="cs-error" id="cr-kyc-error"></p>
        <form class="cs-accept la-step" id="cr-accept" onsubmit="return false"><div class="la-step-no">${++no}</div><div class="min-0 grow">
            <b>${isSimple() ? 'Sign and you are done' : 'Sign to acknowledge'}</b>
            <div class="cs-fields"><label class="cs-name"><span>Your full name</span><input name="name" maxlength="100" autocomplete="name" value="${esc(r.organizerName)}"></label></div>
            <div class="cs-sign"><div class="cs-sign-head"><span>Sign here with your finger</span><button type="button" id="cr-sign-clear">Clear</button></div>
                <canvas id="cr-sign" width="1000" height="300"></canvas></div>
            <label class="cs-check"><input type="checkbox" name="location" ${r.requireLocation ? 'checked disabled' : ''}> Add my current location to the record${r.requireLocation ? ` (${esc(r.payerName)} needs it)` : ''}</label>
            <label class="cs-check"><input type="checkbox" name="agree"> ${isPayout()
                ? `I have paid the whole payout of ${money(r.totalAmount)} of ${esc(r.chitName)} to ${esc(r.payerName)}, who has received it; I confirm the installments I received and that the earlier acknowledgements are cancelled, of my own free will.`
                : `I have received ${money(r.totalAmount)} from ${esc(r.payerName)} towards ${r.lines.length === 1 ? 'this installment' : `these ${r.lines.length} installments`} of ${esc(r.chitName)}, and I acknowledge it of my own free will.`}</label>
            <p class="cs-error" id="cr-error"></p>
            <button type="submit" class="cs-pay-btn">${isSimple() ? 'Sign the receipt' : 'Acknowledge and sign'}</button>
            <small class="muted" ${isSimple() ? 'hidden' : ''}>Recorded with your acknowledgement: your name, mobile number and signature, the time, your IP address, this phone's details
                ${r.requireLocation ? 'and your location' : 'and your location if you allow it'}. They are sealed together and digitally signed, so any change shows.</small>
        </div></form>
        <div class="cr-wrong"><button type="button" id="cr-wrong">Something is not right? Tell ${esc(r.payerName)} instead</button></div>
        <form class="cr-dispute" id="cr-dispute" hidden onsubmit="return false">
            <b>What is not right?</b>
            <textarea name="reason" maxlength="500" placeholder="For example: I received only ₹4,000, not ₹5,000"></textarea>
            <p class="cs-error" id="cr-dispute-error"></p>
            <div class="row"><button type="submit" class="cs-pay-btn">Send this instead of signing</button><button type="button" class="cs-print" id="cr-dispute-cancel">Cancel</button></div>
        </form>
        <p class="cs-hash">Fingerprint of this acknowledgement (SHA-256) <code>${esc(r.contentHash)}</code></p>
    </section>`;
}

function bindOpen() {
    pad = signaturePad($('cr-sign'));
    $('cr-sign-clear').addEventListener('click', () => pad.clear());
    const kycError = text => { $('cr-kyc-error').textContent = text || ''; };
    $('cr-cam-open')?.addEventListener('click', async () => {
        try {
            $('cr-cam').hidden = false;
            $('cr-cam-open').hidden = true;
            cam = await openCamera(document.querySelector('#cr-cam video'), { facing: 'user' });
        } catch (e) { kycError(e.message); $('cr-cam').hidden = true; $('cr-cam-open').hidden = false; }
    });
    $('cr-cam-stop')?.addEventListener('click', () => { cam?.stop(); cam = null; $('cr-cam').hidden = true; $('cr-cam-open').hidden = false; });
    $('cr-shoot')?.addEventListener('click', async () => {
        if (!cam) return;
        try {
            const blob = await cam.capture(`${r.ackNo} · ${r.organizerName}`);
            cam.stop();
            cam = null;
            kycError('');
            const form = new FormData();
            form.append('phone', phone);
            form.append('file', blob, 'selfie.jpg');
            const res = await trackedFetch(`${base}/selfie`, { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'The photo could not be added');
            const typed = $('cr-accept').name.value;
            r = data;
            draw();
            $('cr-accept').name.value = typed;
        } catch (e) { kycError(e.message); }
    });

    const form = $('cr-accept');
    form.addEventListener('submit', async () => {
        const error = $('cr-error');
        const button = form.querySelector('button[type=submit]');
        error.textContent = '';
        if (r.requireSelfie && !r.hasSelfie) { error.textContent = 'Take the selfie first'; return; }
        if (form.name.value.trim().length < 2) { error.textContent = 'Type your full name'; return; }
        if (pad.empty()) { error.textContent = 'Sign in the box'; return; }
        if (!form.agree.checked) { error.textContent = 'Tick the box to confirm'; return; }
        button.disabled = true;
        button.textContent = 'Recording…';
        try {
            const location = form.location.checked || r.requireLocation ? await locate() : null;
            if (r.requireLocation && !location) throw new Error('Allow your location when your phone asks (check the browser’s site settings), then try again');
            r = await call('/acknowledge', { phone, name: form.name.value, agree: true, signature: pad.path(), location, device: JSON.stringify(deviceInfo()) });
            draw();
            window.scrollTo(0, 0);
        } catch (e) {
            error.textContent = e.message;
            button.disabled = false;
            button.textContent = 'Acknowledge and sign';
        }
    });

    const dispute = $('cr-dispute');
    $('cr-wrong').addEventListener('click', () => { dispute.hidden = false; dispute.reason.focus(); });
    $('cr-dispute-cancel').addEventListener('click', () => { dispute.hidden = true; });
    dispute.addEventListener('submit', async () => {
        const reason = dispute.reason.value.trim();
        if (reason.length < 3) { $('cr-dispute-error').textContent = 'Say what is not right'; return; }
        dispute.querySelector('button[type=submit]').disabled = true;
        try {
            r = await call('/dispute', { phone, reason });
            draw();
            window.scrollTo(0, 0);
        } catch (e) {
            $('cr-dispute-error').textContent = e.message;
            dispute.querySelector('button[type=submit]').disabled = false;
        }
    });
}

// ---------------------------------------------------------------- answered

function doneHtml() {
    return `<section class="sh-card cs-agreement">
        ${headHtml('Acknowledged', 'done')}
        ${totalHtml()}
        ${linesHtml()}
        <div class="cs-accepted">${isPayout() ? '✓ Payout confirmed by' : '✓ Acknowledged by'} <b>${esc(r.acknowledgedName)}</b> on ${when(r.acknowledgedAt)}${r.locationShared ? ' · location shared' : ''}
            ${r.signature ? `<div class="cs-sign-show">${signatureSvg(r.signature)}</div>` : ''}
            ${r.acknowledgementSeal ? `<small>Seal (SHA-256) <code>${esc(r.acknowledgementSeal)}</code></small>` : ''}
            ${r.digitalSignature ? '<div class="cs-sig-status wait" id="cr-sig"><b>Checking the digital signature…</b></div>' : ''}</div>
        <div class="cs-terms">${esc(r.terms)}</div>
        <div class="cs-print-row"><button type="button" class="cs-print" id="cr-preview">See it as a document</button><button type="button" class="cs-print" id="cr-print">Print view (A4)</button></div>
        <div id="cr-deed" class="bond-preview" hidden></div>
        <p class="cs-hash">Fingerprint of this acknowledgement (SHA-256) <code>${esc(r.contentHash)}</code></p>
    </section>`;
}

function disputedHtml() {
    return `<section class="sh-card cs-agreement">
        ${headHtml('Sent back', 'part')}
        ${totalHtml()}
        <p class="cr-note">You told ${esc(r.payerName)} on ${when(r.disputedAt)} that this is not right: “${esc(r.disputeReason)}”. Nothing was signed.
            ${esc(r.payerName)} can check and send a corrected one.</p>
    </section>`;
}

async function checkSignature() {
    const el = $('cr-sig');
    if (!el) return;
    const ok = await verifyEvidence(r.evidencePayload, r.digitalSignature, r.publicKey);
    el.className = `cs-sig-status ${ok === false ? 'bad' : ok ? 'ok' : 'wait'}`;
    el.innerHTML = ok === null ? '<b>This browser cannot check the digital signature</b><small>Open the link in Chrome or Safari over https.</small>'
        : ok ? `<b>✓ Digital signature verified</b><small>The record of your acknowledgement is signed with key <code>${esc(r.keyFingerprint)}</code>; any change to it would show here.</small>`
        : `<b>✗ The signature does not match</b><small>The record was changed after it was signed. Tell ${esc(r.payerName)}.</small>`;
    addEvidenceButton(el, 'CHIT-RECEIPT', r.ackNo, r);
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Acknowledgement of receipt</h1><p>${esc(text)}</p></section>`;
}

window.addEventListener('pagehide', () => cam?.stop());
start();
