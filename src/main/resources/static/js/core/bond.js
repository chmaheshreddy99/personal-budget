/**
 * Agreements, on paper and on a phone. No app state: used by Host a Chit, Money lent, and the pages behind the
 * agreement links (chit-share.js, loan-agreement.js).
 *
 *   bondHtml(doc)            the agreement laid out as a stamp-paper deed: the stamp band (or space left for real
 *                            stamp paper), the preamble and recitals, the particulars, the clauses, signatures of
 *                            both sides and the witness, the organiser's round seal, and annexures: ID proof,
 *                            photograph, the evidence of the e-acceptance with its digital signature
 *   bondBlocks(doc)          the same deed as blocks, for the print view to pack into sheets
 *   printBond(doc, title)    the print view (bond-print.js): A4 pages decided before printing, adjustable
 *   signaturePad(canvas)     a finger / mouse signature, returned as an SVG path in a 1000 x 300 box
 *   signatureSvg(path)       draws one
 *   deviceInfo(), locate()   what the device says about itself; the location when allowed
 *   openCamera(video)        the live camera (front camera for a selfie), capture() gives a JPEG stamped with the time
 *   shrinkImage(file)        a photo ready to send: upright, at most 1800 px, JPEG
 *   verifyEvidence(...)      checks the installation's ECDSA P-256 signature over the evidence, in this browser
 */

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY = iso => iso ? new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
const WHEN = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const inr = v => `₹${Math.round(Number(v || 0)).toLocaleString('en-IN')}`;

// ---------------------------------------------------------------- signatures

export function signatureSvg(path, { color = '#0a2e4f', cls = '' } = {}) {
    const safe = String(path || '').replace(/[^MLml0-9 .-]/g, '');
    return `<svg viewBox="0 0 1000 300" class="bond-sign ${cls}" role="img" aria-label="Signature"><path d="${safe}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A signature pad on a canvas; the strokes come back as an SVG path in a 1000 x 300 box. onChange: after each stroke. */
export function signaturePad(canvas, { onChange } = {}) {
    const ctx = canvas.getContext('2d');
    const strokes = [];
    let current = null;
    const pen = () => { ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a2e4f'; };
    pen();
    const point = e => {
        const box = canvas.getBoundingClientRect();
        return [Math.round(((e.clientX - box.left) / box.width) * 1000), Math.round(((e.clientY - box.top) / box.height) * 300)];
    };
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        current = [point(e)];
        strokes.push(current);
    });
    canvas.addEventListener('pointermove', e => {
        if (!current) return;
        const [x, y] = point(e);
        const [px, py] = current[current.length - 1];
        if (Math.abs(x - px) + Math.abs(y - py) < 4) return;
        current.push([x, y]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
    });
    const end = () => { if (current) { current = null; onChange?.(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return {
        empty: () => strokes.reduce((n, s) => n + s.length, 0) < 6,
        clear: () => { strokes.length = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); pen(); onChange?.(); },
        path: () => strokes.filter(s => s.length > 1).map(s => 'M' + s.map(([x, y]) => `${x} ${y}`).join(' L')).join(' ').slice(0, 20000),
    };
}

/** A pad with its label and a Clear button (markup); bind with bindPad(root, name). */
export function padHtml(name, label, { hint = '' } = {}) {
    return `<div class="bond-pad" data-pad="${esc(name)}">
        <div class="bond-pad-head"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}<button type="button" data-pad-clear>Clear</button></div>
        <canvas width="1000" height="300"></canvas></div>`;
}

export function bindPad(root, name, opts) {
    const box = root.querySelector(`[data-pad="${name}"]`);
    if (!box) return null;
    const pad = signaturePad(box.querySelector('canvas'), opts);
    box.querySelector('[data-pad-clear]').addEventListener('click', () => pad.clear());
    return pad;
}

// ---------------------------------------------------------------- device evidence

/** What this device reports about itself: kept with an acceptance as evidence. */
export function deviceInfo() {
    const n = navigator;
    return {
        userAgent: n.userAgent, platform: n.userAgentData?.platform || n.platform, mobile: n.userAgentData?.mobile ?? /Mobi|Android|iPhone/i.test(n.userAgent),
        language: n.language, languages: (n.languages || []).slice(0, 4), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeZoneOffset: new Date().getTimezoneOffset(), localTime: new Date().toString(),
        screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`, viewport: `${innerWidth}x${innerHeight}`,
        touchPoints: n.maxTouchPoints || 0, cores: n.hardwareConcurrency || null, memoryGb: n.deviceMemory || null,
        connection: n.connection?.effectiveType || null, cookies: n.cookieEnabled, webdriver: !!n.webdriver,
    };
}

/** The location, when allowed (lat,lng,accuracy); null when refused or too slow. */
export function locate() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            p => resolve(`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)},${Math.round(p.coords.accuracy)}`),
            () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
}

/** "Chrome 141 on Android 14" from a user agent. */
export function deviceName(ua = '') {
    const os = /Android ([\d.]+)/.exec(ua)?.[0] || (/iPhone|iPad/.test(ua) ? `iOS ${(/OS ([\d_]+)/.exec(ua)?.[1] || '').replace(/_/g, '.')}` : '')
        || (/Windows NT/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown system');
    const browser = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)[1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)[1]}`
        : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)[1]}` : /Safari\//.test(ua) ? 'Safari' : 'a browser';
    return `${browser} on ${os}`;
}

// ---------------------------------------------------------------- photos

/** A photo ready to upload: upright, at most `max` px, JPEG. PDFs pass as they are. */
export async function shrinkImage(file, max = 1800) {
    if (!file || file.type === 'application/pdf') return file;
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return file; }
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? blob : file;
}

/**
 * The live camera in a video element (the front camera for a selfie). capture(label) takes a frame as a JPEG with the
 * date, time and label burnt into its foot, so a selfie cannot be swapped for an old photo unnoticed.
 */
export async function openCamera(video, { facing = 'user' } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera. Open the link in Chrome or Safari on your phone.');
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    } catch (e) {
        throw new Error(e?.name === 'NotAllowedError' ? 'Allow the camera when your phone asks (or in the browser settings), then try again.'
            : 'The camera could not start. Close other apps using it and try again.');
    }
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    return {
        label: track?.label || 'camera',
        stop: () => stream.getTracks().forEach(t => t.stop()),
        capture: async (label = '') => {
            const w = video.videoWidth || 960, h = video.videoHeight || 720;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }   // as the person saw themselves
            ctx.drawImage(video, 0, 0, w, h);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const band = Math.max(28, Math.round(h * 0.06));
            ctx.fillStyle = 'rgba(10, 46, 79, 0.72)';
            ctx.fillRect(0, h - band, w, band);
            ctx.fillStyle = '#fff';
            ctx.font = `600 ${Math.round(band * 0.5)}px system-ui, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText(`${new Date().toLocaleString('en-GB')}${label ? ' · ' + label : ''}`, Math.round(band * 0.4), h - band / 2);
            return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
        },
    };
}

/** A Blob as a data: URL (images printed in another window). */
export const dataUrl = blob => new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
});

// ---------------------------------------------------------------- digital signature

const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** true / false when checked here (ECDSA P-256 with SHA-256, WebCrypto); null when this browser cannot check. */
export async function verifyEvidence(payload, signature, publicKey) {
    if (!payload || !signature || !publicKey || !window.crypto?.subtle) return null;
    try {
        const key = await crypto.subtle.importKey('spki', fromB64(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64(signature), new TextEncoder().encode(payload));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------- the stamp-paper deed

/** "One Hundred" for the stamp's value (whole rupees up to 99,999). */
function words(n) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
        'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = x => x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`;
    n = Math.round(n);
    const parts = [];
    if (n >= 1000) { parts.push(`${two(Math.floor(n / 1000))} Thousand`); n %= 1000; }
    if (n >= 100) { parts.push(`${ones[Math.floor(n / 100)]} Hundred`); n %= 100; }
    if (n) parts.push(two(n));
    return parts.join(' ') || 'Zero';
}

/** A guilloche rosette (as on stamp paper) with the value in its centre. */
function rosetteSvg(value) {
    const loops = Array.from({ length: 36 }, (_, i) => `<ellipse cx="60" cy="60" rx="52" ry="17" transform="rotate(${i * 5} 60 60)"/>`).join('');
    const inner = Array.from({ length: 24 }, (_, i) => `<ellipse cx="60" cy="60" rx="30" ry="11" transform="rotate(${i * 7.5} 60 60)"/>`).join('');
    return `<svg class="bond-rosette" viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="0.45">${loops}</g>
        <g fill="none" stroke="currentColor" stroke-width="0.35" opacity="0.8">${inner}</g><circle cx="60" cy="60" r="20" fill="#fff8fb" stroke="currentColor" stroke-width="1"/>
        <text x="60" y="64" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" font-family="Times New Roman, serif">${esc(value)}</text></svg>`;
}

/** The round rubber seal of the organiser / lender, in violet ink, with their name around the edge. */
export function sealSvg(name, centre = 'SEAL') {
    const text = esc(String(name || '').toUpperCase().slice(0, 34));
    const id = `seal-${Math.random().toString(36).slice(2, 8)}`;
    return `<svg class="bond-seal" viewBox="0 0 200 200" role="img" aria-label="Seal of ${text}">
        <defs><path id="${id}" d="M100,100 m-72,0 a72,72 0 1,1 144,0 a72,72 0 1,1 -144,0"/></defs>
        <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" stroke-width="5"/>
        <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="100" cy="100" r="50" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <text font-size="15" font-weight="700" letter-spacing="2" fill="currentColor"><textPath href="#${id}" startOffset="50%" text-anchor="middle">★ ${text} ★</textPath></text>
        <text x="100" y="96" text-anchor="middle" font-size="16" font-weight="800" fill="currentColor" letter-spacing="1">${esc(centre)}</text>
        <text x="100" y="116" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor">${esc(new Date().getFullYear())}</text>
    </svg>`;
}

/**
 * The deed. doc: { kind: 'LOAN' | 'DEBT' | 'CHIT' (the formal preamble; without it a plain intro), title, number, date, place,
 *   stampDuty, stampSerial, realStampPaper, firstParty: { role, term (“Lender”), name, address, phone, signature, seal,
 *   company }, secondParty: { role, term, name, address, phone, signature, accepted }, witness: { name, phone, address,
 *   signature }, recitals: [text], intro (without kind), terms (text, one clause a line: "N. HEADING: text"),
 *   particulars: [[label, value]], fingerprint, annexures: [{ title, note, images: [{ src, caption }], rows }], footnote }
 */
/** "GOVERNING LAW AND JURISDICTION" → "Governing Law and Jurisdiction" (a clause heading). */
function titleCase(s) {
    return String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\b(And|Of|The|In|On|To|For|By|With|Or)\b/g, w => w.toLowerCase())
        .replace(/^[a-z]/, c => c.toUpperCase());
}

/** One clause, "12. HEADING: text" (or plain "12. text", as older agreements have it), as a list item. */
function clauseLi(line, i) {
    const m = /^(\d+)\.\s*([\s\S]*)$/.exec(line.trim());
    const no = m ? Number(m[1]) : i + 1;
    const text = m ? m[2] : line.trim();
    const h = /^([A-Z][A-Z0-9 ,&'()\/-]{2,70}):\s+([\s\S]*)$/.exec(text);
    return { no, li: `<li value="${no}">${h ? `<b class="bond-cl-h">${esc(titleCase(h[1]))}.</b> ${esc(h[2])}` : esc(text)}</li>` };
}

/** How a party is described in the preamble: name, where they live, their number. */
function partyText(p) {
    return [`<b>${esc(String(p?.name || '____________________').toUpperCase())}</b>`, p?.relation ? esc(p.relation) : '',
        p?.address ? `${p.company ? 'having its office at' : 'residing at'} ${esc(p.address)}` : '', p?.phone ? `mobile ${esc(p.phone)}` : ''].filter(Boolean).join(', ');
}

/** The stamp band of the first page (stamp-paper style), or nothing on real stamp paper (its printed top is the sheet's). */
function stampHtml(doc) {
    if (doc.realStampPaper) return '';
    const duty = Number(doc.stampDuty || 0);
    const value = duty ? `₹${duty.toLocaleString('en-IN')}` : '₹ —';
    return `<div class="bond-sheet">
            <div class="bond-sheet-frame">
                <div class="bond-sheet-top"><span class="d">${value}</span><b>NON JUDICIAL</b><span class="d">${value}</span></div>
                <div class="bond-sheet-mid">
                    ${rosetteSvg(value)}
                    <div class="bond-sheet-value"><small>RUPEES</small><b>${value}</b><em>${duty ? `${words(duty).toUpperCase()} RUPEES ONLY` : 'VALUE NOT SET'}</em></div>
                    ${rosetteSvg(value)}
                </div>
                <div class="bond-sheet-micro" aria-hidden="true">${(`${value} AGREEMENT COPY · `).repeat(24)}</div>
                <div class="bond-sheet-foot"><span>Date ${esc(DAY(doc.date))}</span><span class="serial">Sl. No. <b>${esc(doc.stampSerial || '—')}</b></span></div>
            </div>
        </div>`;
}

function signBox(doc, p, label, { seal = null, thumb = false, lead = '' } = {}) {
    return `<div class="bond-signbox">
        ${lead ? `<small class="bond-sign-lead">${esc(lead)}</small>` : ''}
        <div class="bond-signspace">${p?.signature ? signatureSvg(p.signature) : ''}${seal ? `<span class="bond-seal-wrap">${sealSvg(seal, 'SEAL')}</span>` : ''}</div>
        <div class="bond-signline"><b>${esc(p?.name || '')}</b><small>${esc(label)}${p?.accepted ? ` · ${esc(p.accepted)}` : ''}</small></div>
        ${thumb ? '<div class="bond-thumb"><span>Left thumb impression</span></div>' : ''}
        ${p?.address ? `<small class="bond-signaddr">${esc(p.address)}</small>` : ''}
    </div>`;
}

/**
 * The deed as blocks, in reading order: what the screen shows as one flowing document and the print view packs into
 * A4 sheets (bond-print.js). A block: { id, html, keep (stays on the page of the block after it), li (a clause) }.
 * Returns { front: [...], annexures: [{ title, blocks: [...] }] }; an annexure's images come as
 * { id, image: { src, caption, ... } } for the print view to size.
 */
export function bondBlocks(doc) {
    const first = doc.firstParty || {}, second = doc.secondParty || {};
    const a = first.term || first.role || 'First party', b = second.term || second.role || 'Second party';
    const front = [];
    const add = (id, html, extra = {}) => front.push({ id, html, ...extra });
    const stamp = stampHtml(doc);
    if (stamp) add('stamp', stamp, { keep: true });
    add('title', `<h1 class="bond-title">${esc(doc.title)}</h1><p class="bond-no">${esc(doc.number || '')}</p>`, { keep: true });
    if (doc.kind) {
        add('pre-1', `<p class="bond-pre">This <b>${esc(String(doc.title || 'Agreement').toUpperCase())}</b> (the “Agreement”) is made and executed at
            <b>${esc(doc.place || '____________________')}</b> on this <b>${esc(DAY(doc.date) || '____________')}</b>,</p>`, { keep: true });
        add('pre-2', `<p class="bond-pre-c">BY AND BETWEEN</p>`, { keep: true });
        add('pre-3', `<p class="bond-pre">${partyText(first)}, hereinafter referred to as the “<b>${esc(a)}</b>” (which expression shall, unless repugnant to
            the context or meaning thereof, be deemed to mean and include ${first.company ? 'its successors and permitted assigns' : 'his or her heirs, executors, administrators, legal representatives and permitted assigns'})
            of the <b>FIRST PART</b>;</p>`);
        add('pre-4', `<p class="bond-pre-c">AND</p>`, { keep: true });
        const third = doc.thirdParty?.name ? doc.thirdParty : null;
        const c3 = third ? third.term || third.role || 'Third party' : null;
        add('pre-5', `<p class="bond-pre">${partyText(second)}, hereinafter referred to as the “<b>${esc(b)}</b>” (which expression shall, unless repugnant to
            the context or meaning thereof, be deemed to mean and include his or her heirs, executors, administrators and legal representatives)
            of the <b>SECOND PART</b>${third ? ';' : '.'}</p>`);
        if (third) {
            add('pre-5a', `<p class="bond-pre-c">AND</p>`, { keep: true });
            add('pre-5b', `<p class="bond-pre">${partyText(third)}, hereinafter referred to as the “<b>${esc(c3)}</b>” (which expression shall, unless repugnant to
                the context or meaning thereof, be deemed to mean and include its successors and assigns) of the <b>THIRD PART</b>.</p>`);
        }
        add('pre-6', `<p class="bond-pre">The ${esc(a)}${third ? `, the ${esc(b)} and the ${esc(c3)}` : ` and the ${esc(b)}`} are hereinafter individually referred to as a “Party” and collectively as the “Parties”.</p>`);
        (doc.recitals || []).forEach((r, i) => add(`rec-${i}`, `<p class="bond-pre"><b>${i ? 'AND WHEREAS' : 'WHEREAS'}</b> ${esc(r)}${i === doc.recitals.length - 1 ? ';' : ';'}</p>`));
    } else {
        add('intro', `<p class="bond-intro">${esc(doc.intro || '')}</p>`);
        add('parties', `<div class="bond-parties">${[first, second].map(p => `<div class="bond-party"><small>${esc(p.role || '')}</small><b>${esc(p.name || '')}</b>
            ${p.address ? `<span>${esc(p.address)}</span>` : ''}${p.phone ? `<span>Mobile ${esc(p.phone)}</span>` : ''}</div>`).join('<i>and</i>')}</div>`);
    }
    if (doc.particulars?.length) {
        add('facts-h', `<p class="bond-sub">Particulars of this Agreement</p>`, { keep: true });
        add('facts', `<table class="bond-facts"><tbody>${doc.particulars.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`);
    }
    add('witnesseth', doc.kind
        ? `<p class="bond-pre"><b>NOW, THEREFORE, THIS AGREEMENT WITNESSETH</b> and it is hereby agreed by and between the Parties as follows:</p>`
        : `<p class="bond-sub">Now it is agreed as follows:</p>`, { keep: true });
    String(doc.terms || '').split('\n').filter(l => l.trim()).forEach((l, i) => {
        const c = clauseLi(l, i);
        add(`cl-${c.no}`, `<ol class="bond-terms">${c.li}</ol>`, { li: c.li });
    });
    // the signatures never stand alone on a page: the last clause goes with them, so no page of terms can be slipped in
    // before a signature page
    const lastClause = [...front].reverse().find(x => x.li);
    if (lastClause) lastClause.keep = true;
    add('in-witness', `<p class="bond-witness-line">${doc.kind
        ? `<b>IN WITNESS WHEREOF</b> the Parties hereto have set their respective hands to this Agreement on the day, month and year first above written, in the presence of the witness named below.`
        : 'In witness whereof the parties have signed this agreement on the date and at the place written above, in the presence of the witness below.'}</p>`, { keep: true });
    // thumbBoxes: both parties' left thumb impressions are taken on the paper copy, as many deeds in India have them
    const thumbs = !!doc.thumbBoxes;
    add('signs', `<div class="bond-signs">
            ${signBox(doc, first, first.role || a, { seal: first.seal, thumb: thumbs, lead: doc.kind ? `Signed and delivered by the within-named ${a}` : '' })}
            ${signBox(doc, second, second.role || b, { thumb: thumbs || !second.signature, lead: doc.kind ? `Signed and delivered by the within-named ${b}` : '' })}
        </div>`, { keep: true });
    if (doc.thirdParty?.name) {
        add('signs-3', `<div class="bond-signs one">${signBox(doc, doc.thirdParty, doc.thirdParty.role || 'Third party',
            { lead: `Signed and delivered by the within-named ${doc.thirdParty.term || doc.thirdParty.role || 'third party'}, by its authorised signatory` })}</div>`, { keep: true });
    }
    const witnesses = [doc.witness?.name ? doc.witness : { name: '' }, ...(doc.witness2?.name || doc.twoWitnesses ? [doc.witness2 || { name: '' }] : [])];
    add('witness', `<div class="bond-signs ${witnesses.length > 1 ? '' : 'one'}">${witnesses.map((w, i) => signBox(doc, w, witnesses.length > 1 ? `Witness ${i + 1}` : 'Witness',
        { lead: doc.kind && i === 0 ? 'In the presence of' : '' })).join('')}</div>`);
    add('foot', `<p class="bond-foot">Agreement fingerprint (SHA-256): <code>${esc(doc.fingerprint || '')}</code>${doc.footnote ? `<br>${esc(doc.footnote)}` : ''}</p>`);

    const annexures = (doc.annexures || []).filter(x => x.images?.length || x.rows?.length).map((x, i) => {
        const letter = String.fromCharCode(65 + i);
        const blocks = [{ id: `ax${letter}-h`, html: `<h2 class="bond-annex-h">Annexure ${letter} · ${esc(x.title)}</h2>${x.note ? `<p class="bond-annex-note">${esc(x.note)}</p>` : ''}`, keep: true }];
        (x.images || []).forEach((im, j) => blocks.push({ id: `ax${letter}-i${j}`, image: { ...im, mark: im.mark || doc.number } }));
        (x.rows || []).forEach(([k, v], j) => blocks.push({ id: `ax${letter}-r${j}`,
            html: `<table class="bond-facts ev ${j ? 'cont' : ''}"><tbody><tr><th>${esc(k)}</th><td>${v}</td></tr></tbody></table>` }));
        blocks.push({ id: `ax${letter}-att`, html: `<div class="bond-annex-sign">${second.signature ? signatureSvg(second.signature) : ''}<small>${esc(second.name || '')} · self-attested</small></div>` });
        return { letter, title: x.title, blocks };
    });
    return { front, annexures };
}

/** The WHEREAS clauses of a loan agreement / acknowledgement of debt. */
export function loanRecitals(kind, amount, inWords) {
    const sum = `${amount}${inWords ? ` (${inWords})` : ''}`;
    return kind === 'PAID_FOR' || kind === 'DEBT'
        ? [`the Lender has, at the request of the Borrower, paid a sum of ${sum} on behalf of the Borrower, as set out below`,
            'the Borrower admits the said sum to be a debt due to the Lender and has agreed to repay it on the terms and conditions set out hereinafter']
        : [`the Borrower has requested the Lender for a loan of ${sum} for the Borrower's personal needs`,
            'the Lender has agreed to lend, and has lent, the said sum to the Borrower on the terms and conditions set out hereinafter'];
}

/** The WHEREAS clauses of a chit prize amount agreement. */
export function chitRecitals(name, members, months, chitValue, monthNo) {
    return [`the Organiser conducts a chit known as “${name}” of ${members} members and ${months} monthly instalments, with a chit value of ${chitValue}, in which the Member is a subscriber`,
        `the Member was declared the prize winner for instalment ${monthNo}, has received the prize amount, and has agreed to execute this Agreement acknowledging its receipt and undertaking to pay the remaining instalments`];
}

/** An ID image as the screen shows it (the print view sizes it to the sheet instead). */
export function figureHtml(im, { width = null, height = null } = {}) {
    const size = width ? ` style="width:${width.toFixed(1)}mm;height:${height.toFixed(1)}mm"` : '';
    return `<figure class="bond-fig ${im.from ? 'full' : ''} ${im.intact === false ? 'tampered' : ''}"${width ? ` style="width:${width.toFixed(1)}mm"` : ''}>${im.pdf
        ? `<div class="bond-annex-pdf">PDF · ${esc(im.caption)}<br><small>attached separately</small></div>`
        : `<div class="bond-annex-shot"><img src="${esc(im.src)}" alt="${esc(im.caption)}"${size}>${im.from ? '' : `<span class="bond-annex-wm" aria-hidden="true">${esc(`For ${im.mark || 'this agreement'} only`)}</span>`}</div>`}
        <figcaption>${esc(im.caption)}${im.from ? ' <small>(taken from the PDF given)</small>' : ''}${im.hash ? `<br><code>${im.from ? 'PDF ' : ''}SHA-256 ${esc(im.hash.slice(0, 32))}…</code>` : ''}${im.pageHash ? ` · <code>image ${esc(im.pageHash.slice(0, 16))}…</code>` : ''}${im.intact === false ? '<br><b class="bond-tamper">Stored file does not match its fingerprint</b>' : ''}</figcaption></figure>`;
}

/**
 * The deed on screen: one flowing document (the first page, then a page per annexure). The print view
 * (printBond) lays the same blocks out on A4 sheets.
 */
export function bondHtml(doc) {
    const { front, annexures } = bondBlocks(doc);
    // consecutive clauses read as one numbered list
    let body = '', list = '';
    for (const blk of front) {
        if (blk.li) { list += blk.li; continue; }
        if (list) { body += `<ol class="bond-terms">${list}</ol>`; list = ''; }
        body += blk.html;
    }
    if (list) body += `<ol class="bond-terms">${list}</ol>`;
    const initials = `<div class="bond-initials"><span>${esc(doc.firstParty?.role || 'First party')}</span><span>${esc(doc.secondParty?.role || 'Second party')}</span><span>Witness</span></div>`;
    return `<article class="bond ${doc.realStampPaper ? 'real' : ''}">
        <section class="bond-page first">${doc.realStampPaper ? `<div class="bond-blank-top"><span>Printed area of the stamp paper — leave blank</span></div>` : ''}${body}${initials}</section>
        ${annexures.map(x => {
            const imgs = x.blocks.filter(b => b.image).map(b => figureHtml(b.image)).join('');
            const rest = x.blocks.filter(b => !b.image);
            return `<section class="bond-page bond-annex">${rest[0].html}${imgs ? `<div class="bond-annex-imgs">${imgs}</div>` : ''}${rest.slice(1).map(b => b.html).join('')}${initials}</section>`;
        }).join('')}
    </article>`;
}

/** The evidence of an e-acceptance as rows for an annexure (values are HTML-safe). */
export function evidenceRows(e) {
    const dev = (() => { try { return JSON.parse(e.device || '{}'); } catch { return {}; } })();
    const [lat, lng, acc] = String(e.location || '').split(',');
    const rows = [
        ['Accepted by', esc(e.name || '')],
        ['Accepted at (server time)', esc(WHEN(e.at))],
        e.phone ? ['Mobile number', `${esc(e.phone)}${e.phoneMatches === true ? ' · matches the number on record' : e.phoneMatches === false ? ' · differs from the record' : ''}`] : null,
        e.aadhaarLast4 ? ['Aadhaar', `XXXX XXXX ${esc(e.aadhaarLast4)} (verified check digit)`] : null,
        e.pan ? ['PAN', esc(e.pan)] : null,
        e.ip ? ['IP address', esc(e.ip)] : null,
        ['Device', esc(deviceName(dev.userAgent || e.userAgent || ''))],
        dev.screen ? ['Screen · language · time zone', `${esc(dev.screen)} · ${esc(dev.language || '')} · ${esc(dev.timeZone || '')}`] : null,
        dev.localTime ? ['Device clock', esc(String(dev.localTime).replace(/ \(.*\)$/, ''))] : null,
        ['Location', lat ? `${esc(lat)}, ${esc(lng)} (±${esc(acc || '?')} m)` : 'not shared'],
        e.deviceHash ? ['Device fingerprint', `<code>${esc(e.deviceHash)}</code>`] : null,
        e.seal ? ['Acceptance seal (SHA-256)', `<code>${esc(e.seal)}</code>`] : null,
        e.digitalSignature ? ['Digital signature (ECDSA P-256)', `<code>${esc(e.digitalSignature.slice(0, 44))}…</code>${e.keyFingerprint ? `<br>key ${esc(e.keyFingerprint)}` : ''}${e.verified === true ? ' · <b>verified</b>' : ''}`] : null,
    ];
    return rows.filter(Boolean);
}

/**
 * Opens the print view: the deed laid out on A4 sheets before printing (pages decided here, not by the browser), with
 * adjustments, then printed exactly as shown. See bond-print.js.
 */
export function printBond(doc, title) {
    return import('./bond-print.js').then(m => m.openPrintView(doc, title));
}

export { inr as bondMoney, DAY as bondDay, WHEN as bondWhen };
