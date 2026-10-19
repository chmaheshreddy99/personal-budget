/**
 * The page behind a construction agreement link (/project-agreement.html#<token>): no sign-in. Same steps as a loan
 * agreement's (loan-agreement.js): the other party types their mobile number, reads the deed, adds their Aadhaar and a
 * live selfie, signs with a finger and accepts; the evidence is sealed and digitally signed.
 *
 * (Adapted from the loan agreement page:) the page behind a loan agreement link: no sign-in. The token stays in the address
 * fragment (never sent to other sites) and opens nothing on its own: the borrower types their mobile number first,
 * and sends it again with every step; five wrong numbers lock the link.
 *
 * Then, step by step: read the agreement (also as a stamp-paper copy to print), add a photo of the Aadhaar card,
 * take a live selfie with the front camera (time-stamped on the photo), type the Aadhaar number, sign with a finger and
 * accept. Recorded with it: the time, IP address, this device's details, the location if allowed, and each photo's
 * fingerprint, sealed and digitally signed; the signature is checked here once accepted.
 */
import { bondHtml, printBond, signaturePad, signatureSvg, deviceInfo, locate, openCamera, shrinkImage, verifyEvidence } from './core/bond.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const money = v => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;

const token = location.hash.slice(1);
const base = `/api/public/construction-agreements/${encodeURIComponent(token)}`;
let ag = null;
let phone = '';
let cam = null;
let pad = null;

async function call(path, body) {
    const r = await fetch(base + path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'This link does not work any more.');
    return data;
}

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    try {
        ag = await call('', {});
    } catch (e) { main.innerHTML = message(e.message); return; }
    draw();
}

function draw() {
    const main = $('sh-main');
    document.title = `${ag.title} · ${ag.companyName}`;
    if (ag.step === 'VERIFY') { main.innerHTML = gateHtml(); bindGate(); return; }
    main.innerHTML = ag.step === 'DONE' ? doneHtml() : openHtml();
    if (ag.step === 'OPEN') bindOpen(); else checkSignature();
    $('la-print')?.addEventListener('click', () => printBond(deed(), `Agreement ${ag.agreementNo}`));
    $('la-preview')?.addEventListener('click', () => {
        const box = $('la-deed');
        box.hidden = !box.hidden;
        if (!box.hidden) box.innerHTML = bondHtml(deed());
    });
}

// ---------------------------------------------------------------- the gate: the borrower's mobile number

function gateHtml() {
    return `<section class="sh-card la-gate">
        <div class="la-lock">🔒</div>
        <small>${esc(ag.companyName || ag.household)} · ${esc(ag.agreementNo)}</small>
        <h1>${esc(ag.title)} from ${esc(ag.companyName || ag.household)}</h1>
        <p>It was sent to <b>${esc(ag.partyHint || 'you')}</b>. To open it, type the mobile number it was sent to${ag.phoneHint ? ` (<b>${esc(ag.phoneHint)}</b>)` : ''}.</p>
        <form id="la-gate" onsubmit="return false">
            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="Your 10-digit mobile number" autofocus>
            <button type="submit" class="cs-pay-btn">Open the agreement</button>
            <p class="cs-error" id="la-gate-error">${esc(ag.error || '')}</p>
            ${ag.attemptsLeft < 5 ? `<small class="muted">${ag.attemptsLeft} tr${ag.attemptsLeft === 1 ? 'y' : 'ies'} left before the link locks.</small>` : ''}
        </form>
        <small class="muted">The link works until ${when(ag.expiresAt)}.</small>
    </section>`;
}

function bindGate() {
    const form = $('la-gate');
    form.addEventListener('submit', async () => {
        const typed = form.phone.value.replace(/[^\d+]/g, '');
        const digits = typed.replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(digits)) { $('la-gate-error').textContent = 'Enter your 10-digit mobile number'; return; }
        form.querySelector('button').disabled = true;
        try {
            const r = await call('', { phone: digits });
            if (r.step !== 'VERIFY') phone = digits;
            ag = r;
            draw();
        } catch (e) {
            $('la-gate-error').textContent = e.message;
            form.querySelector('button').disabled = false;
        }
    });
}

// ---------------------------------------------------------------- reading and accepting

function figuresHtml() {
    return (ag.particulars || []).length ? `<table class="bond-facts la-facts"><tbody>${ag.particulars.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '';
}

function headHtml(badge, tone) {
    return `<div class="sh-head"><div><small>${esc(ag.companyName || ag.household)} · ${esc(ag.title)} · ${esc(ag.agreementNo)}</small><h1>${esc(ag.partyName)}</h1>
        <small>with ${esc(ag.companyName || '')}${ag.place ? ` · ${esc(ag.place)}` : ''}</small></div><span class="st-badge ${tone}">${badge}</span></div>`;
}

function openHtml() {
    const have = new Set(ag.kycDocs || []);
    const steps = [];
    if (ag.requireAadhaar) steps.push('aadhaar');
    if (ag.requireSelfie) steps.push('selfie');
    const tile = (t, label, hint) => `<div class="kyc-tile ${have.has(t) ? 'done' : ''} need"><b>${label}</b><small>${have.has(t) ? '✓ added' : hint}</small>
        <div class="kyc-acts"><label>${have.has(t) ? 'Replace' : 'Add a photo'}<input type="file" accept="image/*,application/pdf" capture="environment" data-la-file="${t}"></label></div></div>`;
    let no = 0;
    return `<section class="sh-card cs-agreement">
        ${headHtml('Waiting for you', 'part')}
        ${figuresHtml()}
        <div class="cs-terms">${esc(ag.terms)}</div>
        <div class="cs-print-row"><button type="button" class="cs-print" id="la-preview">See it as a stamp-paper copy</button><button type="button" class="cs-print" id="la-print">Print view (A4)</button></div>
        <div id="la-deed" class="bond-preview" hidden></div>
        ${steps.includes('aadhaar') ? `<div class="la-step"><div class="la-step-no">${++no}</div><div class="min-0 grow">
            <b>Your Aadhaar card</b><small>A clear photo of the side with your photo${ag.requireAadhaar ? ' (the back is optional)' : ''}.</small>
            <div class="kyc-grid">${tile('AADHAAR_FRONT', 'Aadhaar · front', 'the side with your photo')}
                <div class="kyc-tile ${have.has('AADHAAR_BACK') ? 'done' : ''}"><b>Aadhaar · back</b><small>${have.has('AADHAAR_BACK') ? '✓ added' : 'optional'}</small>
                    <div class="kyc-acts"><label>${have.has('AADHAAR_BACK') ? 'Replace' : 'Add a photo'}<input type="file" accept="image/*,application/pdf" capture="environment" data-la-file="AADHAAR_BACK"></label></div></div></div>
        </div></div>` : ''}
        ${steps.includes('selfie') ? `<div class="la-step"><div class="la-step-no">${++no}</div><div class="min-0 grow">
            <b>A selfie</b><small>Taken now with your phone's front camera (not from the gallery); the date and time are printed on it.</small>
            ${have.has('SELFIE') ? '<p class="la-ok">✓ Selfie added</p>' : ''}
            <div class="kyc-cam" id="la-cam" hidden><div class="kyc-frame"><video autoplay playsinline muted></video></div>
                <div class="kyc-cam-acts"><button type="button" class="cs-print" id="la-shoot">Take the photo</button><button type="button" class="cs-print" id="la-cam-stop">Cancel</button></div></div>
            <button type="button" class="cs-print" id="la-cam-open">${have.has('SELFIE') ? 'Retake the selfie' : 'Open the camera'}</button>
        </div></div>` : ''}
        <p class="cs-error" id="la-kyc-error"></p>
        <form class="cs-accept la-step" id="la-accept" onsubmit="return false"><div class="la-step-no">${++no}</div><div class="min-0 grow">
            <b>Sign and accept</b>
            <div class="cs-fields">
                <label class="cs-name"><span>Your full name <small>as on your Aadhaar card</small></span><input name="name" maxlength="100" autocomplete="name" value="${esc(ag.partyName)}"></label>
                ${ag.requireAadhaar ? '<label class="cs-name"><span>Aadhaar number <small>12 digits; only the last 4 are kept</small></span><input name="aadhaar" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="XXXX XXXX XXXX"></label>' : ''}
            </div>
            <div class="cs-sign"><div class="cs-sign-head"><span>Sign here with your finger</span><button type="button" id="la-sign-clear">Clear</button></div>
                <canvas id="la-sign" width="1000" height="300"></canvas></div>
            <label class="cs-check"><input type="checkbox" name="location" ${ag.requireLocation ? 'checked disabled' : ''}> Add my current location to the record${ag.requireLocation ? ` (${esc(ag.companyName || '')} needs it)` : ''}</label>
            <label class="cs-check"><input type="checkbox" name="agree"> I have read this agreement, I understand it, and I accept it of my own free will.</label>
            <p class="cs-error" id="la-error"></p>
            <button type="submit" class="cs-pay-btn">Accept and sign</button>
            <small class="muted">Recorded with your acceptance: your name, mobile number, signature and photos, the time, your IP address, this phone's details
                ${ag.requireLocation ? 'and your location' : 'and your location if you allow it'}. They are sealed together and digitally signed, so any change shows.</small>
        </div></form>
        <p class="cs-hash">Fingerprint of the agreement (SHA-256) <code>${esc(ag.contentHash)}</code></p>
    </section>`;
}

function bindOpen() {
    pad = signaturePad($('la-sign'));
    $('la-sign-clear').addEventListener('click', () => pad.clear());
    const kycError = text => { $('la-kyc-error').textContent = text || ''; };
    // keep what was typed when the page redraws after a photo
    const keep = () => {
        const f = $('la-accept');
        return f ? { name: f.name.value, aadhaar: f.aadhaar?.value || '' } : null;
    };
    const restore = v => {
        const f = $('la-accept');
        if (!v || !f) return;
        f.name.value = v.name;
        if (f.aadhaar) f.aadhaar.value = v.aadhaar;
    };
    const send = async (type, blob, name) => {
        kycError('');
        const form = new FormData();
        form.append('phone', phone);
        form.append('docType', type);
        form.append('file', blob, name);
        const r = await fetch(`${base}/kyc`, { method: 'POST', body: form });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message || 'The photo could not be added');
        const typed = keep();
        ag = data;
        draw();
        restore(typed);
    };
    document.querySelectorAll('[data-la-file]').forEach(input => input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try { await send(input.dataset.laFile, await shrinkImage(file), file.name); } catch (e) { kycError(e.message); }
    }));
    $('la-cam-open')?.addEventListener('click', async () => {
        try {
            $('la-cam').hidden = false;
            $('la-cam-open').hidden = true;
            cam = await openCamera(document.querySelector('#la-cam video'), { facing: 'user' });
        } catch (e) { kycError(e.message); $('la-cam').hidden = true; $('la-cam-open').hidden = false; }
    });
    $('la-cam-stop')?.addEventListener('click', () => { cam?.stop(); cam = null; $('la-cam').hidden = true; $('la-cam-open').hidden = false; });
    $('la-shoot')?.addEventListener('click', async () => {
        if (!cam) return;
        try {
            const blob = await cam.capture(`${ag.agreementNo} · ${ag.partyName}`);
            cam.stop();
            cam = null;
            await send('SELFIE', blob, 'selfie.jpg');
        } catch (e) { kycError(e.message); }
    });
    const form = $('la-accept');
    form.addEventListener('submit', async () => {
        const error = $('la-error');
        const button = form.querySelector('button[type=submit]');
        error.textContent = '';
        const have = new Set(ag.kycDocs || []);
        if (ag.requireAadhaar && !have.has('AADHAAR_FRONT')) { error.textContent = 'Add a photo of your Aadhaar card first'; return; }
        if (ag.requireSelfie && !have.has('SELFIE')) { error.textContent = 'Take the selfie first'; return; }
        if (form.name.value.trim().length < 2) { error.textContent = 'Type your full name'; return; }
        if (ag.requireAadhaar && !/^[2-9]\d{11}$/.test(form.aadhaar.value.replace(/[\s-]/g, ''))) { error.textContent = 'Enter your 12-digit Aadhaar number'; return; }
        if (pad.empty()) { error.textContent = 'Sign in the box'; return; }
        if (!form.agree.checked) { error.textContent = 'Tick the box to accept'; return; }
        button.disabled = true;
        button.textContent = 'Recording…';
        try {
            const location = form.location.checked || ag.requireLocation ? await locate() : null;
            if (ag.requireLocation && !location) throw new Error('Allow your location when your phone asks (check the browser’s site settings), then try again');
            ag = await call('/accept', { phone, name: form.name.value, agree: true, aadhaarNumber: form.aadhaar ? form.aadhaar.value : null,
                signature: pad.path(), location, device: JSON.stringify(deviceInfo()) });
            draw();
            window.scrollTo(0, 0);
        } catch (e) {
            error.textContent = e.message;
            button.disabled = false;
            button.textContent = 'Accept and sign';
        }
    });
}

// ---------------------------------------------------------------- accepted

function doneHtml() {
    return `<section class="sh-card cs-agreement">
        ${headHtml(ag.status === 'SIGNED' ? 'Signed' : 'Accepted', 'done')}
        ${figuresHtml()}
        <div class="cs-accepted">✓ ${ag.status === 'SIGNED' ? 'Signed on paper' : 'Accepted'} by <b>${esc(ag.acceptedName)}</b> on ${when(ag.acceptedAt)}
            ${ag.aadhaarLast4 ? ` · Aadhaar XXXX XXXX ${esc(ag.aadhaarLast4)}` : ''}${ag.locationShared ? ' · location shared' : ''}
            ${ag.signature ? `<div class="cs-sign-show">${signatureSvg(ag.signature)}</div>` : ''}
            ${ag.acceptanceSeal ? `<small>Acceptance seal (SHA-256) <code>${esc(ag.acceptanceSeal)}</code></small>` : ''}
            ${ag.digitalSignature ? '<div class="cs-sig-status wait" id="la-sig"><b>Checking the digital signature…</b></div>' : ''}</div>
        <div class="cs-terms">${esc(ag.terms)}</div>
        <div class="cs-print-row"><button type="button" class="cs-print" id="la-preview">See it as a stamp-paper copy</button><button type="button" class="cs-print" id="la-print">Print view (A4)</button></div>
        <div id="la-deed" class="bond-preview" hidden></div>
        <p class="cs-hash">Fingerprint of the agreement (SHA-256) <code>${esc(ag.contentHash)}</code></p>
    </section>`;
}

async function checkSignature() {
    const el = $('la-sig');
    if (!el) return;
    const ok = await verifyEvidence(ag.evidencePayload, ag.digitalSignature, ag.publicKey);
    el.className = `cs-sig-status ${ok === false ? 'bad' : ok ? 'ok' : 'wait'}`;
    el.innerHTML = ok === null ? '<b>This browser cannot check the digital signature</b><small>Open the link in Chrome or Safari over https.</small>'
        : ok ? `<b>✓ Digital signature verified</b><small>The record of your acceptance is signed with key <code>${esc(ag.keyFingerprint)}</code>; any change to it would show here.</small>`
        : '<b>✗ The signature does not match</b><small>The record was changed after it was signed. Tell the company.</small>';
}

/** The agreement as a stamp-paper deed. */
function deed() {
    const done = ag.step === 'DONE';
    return {
        kind: 'CONSTRUCTION', title: ag.title, number: ag.agreementNo, date: ag.agreementDate, place: ag.place, stampDuty: ag.stampDuty, stampSerial: ag.stampSerial,
        thumbBoxes: ag.thumbBoxes, twoWitnesses: true,
        firstParty: { role: ag.firstRole, term: ag.firstRole, name: ag.companyName, company: true, address: ag.companyAddress, signature: ag.companySignature, seal: ag.companyName,
            relation: `represented by its ${ag.signerDesignation || 'authorised signatory'} ${ag.signerName || ''}`.trim() },
        secondParty: { role: ag.secondRole, term: ag.secondRole, name: done ? ag.acceptedName : ag.partyName, relation: ag.partyRelation, address: ag.partyAddress,
            signature: ag.status === 'ACCEPTED' ? ag.signature : null, accepted: ag.status === 'ACCEPTED' ? `accepted online ${when(ag.acceptedAt)}` : '' },
        thirdParty: ag.thirdName ? { role: 'Bank', term: 'Bank', name: ag.thirdName, address: ag.thirdAddress, company: true } : null,
        witness: { name: ag.witnessName, signature: ag.witnessSignature }, witness2: { name: ag.witness2Name, signature: ag.witness2Signature },
        recitals: ag.recitals, particulars: ag.particulars, terms: ag.terms, fingerprint: ag.contentHash,
        annexures: ag.acceptanceSeal ? [{ title: 'Evidence of the online acceptance', rows: [['Accepted by', esc(ag.acceptedName)], ['Accepted at', esc(when(ag.acceptedAt))],
            ['Acceptance seal (SHA-256)', `<code>${esc(ag.acceptanceSeal)}</code>`],
            ...(ag.digitalSignature ? [['Digital signature', `<code>${esc(ag.digitalSignature.slice(0, 44))}…</code><br>key ${esc(ag.keyFingerprint || '')}`]] : [])] }] : [],
    };
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Agreement</h1><p>${esc(text)}</p></section>`;
}

window.addEventListener('pagehide', () => cam?.stop());
start();
