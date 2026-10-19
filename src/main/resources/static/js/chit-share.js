/**
 * The page behind a chit link (/chit-share.html#<token>): no sign-in, only the token. One page, four kinds of link:
 *   MEMBER     a member's statement: what is due now (with late interest), "Pay now" when the organiser has a UPI ID:
 *              one tap for Google Pay, PhonePe, Paytm or BHIM (or any UPI app) on a phone, a QR code on a computer;
 *              every month and every payment with its receipt number
 *   CHIT       every month with the winners and collections, optionally the organiser's earnings
 *   RECEIPT    one payment's receipt
 *   AGREEMENT  the winner's agreement, which the member accepts with their name, mobile number and a drawn signature
 *              (location if they allow it); the device's details are recorded as evidence
 * Worked out when the page is opened, so it is always current. The token stays in the address fragment.
 */
import { upiLogo } from './core/upi-logos.js';
import { qrSvg } from './core/qr.js';
import { printBond, openCamera, shrinkImage, verifyEvidence, chitRecitals } from './core/bond.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const token = location.hash.slice(1);
let ch, fmt;
const money = v => fmt.format(Math.round(Number(v || 0)));
const STATUS = { COMPLETED: ['done', 'Done'], ONGOING: ['open', 'This month'], UPCOMING: ['', 'Coming up'] };
const DUE = { PAID: ['done', 'Paid'], PARTIAL: ['part', 'Part paid'], PENDING: ['late', 'Not paid'], NOTDUE: ['', 'Not due yet'] };
const TITLES = { RECEIPT: 'Receipt', AGREEMENT: 'Agreement', MEMBER: 'Statement' };

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    if (token.startsWith('plan=')) { planPage(main, token.slice(5)); return; }
    try {
        ch = await call(`/api/public/hosted-chits/${encodeURIComponent(token)}`);
    } catch (error) { main.innerHTML = message(error.message); return; }
    fmt = new Intl.NumberFormat(ch.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: ch.currency || 'INR', maximumFractionDigits: 0 });
    document.title = TITLES[ch.kind] ? `${TITLES[ch.kind]} · ${ch.name}` : ch.name;
    useSignedDetails();
    draw();
    verifyPayTo();
}

/** The page shows the payment details exactly as the organiser's key signed them (not separate fields that could differ). */
function useSignedDetails() {
    const to = ch.payTo;
    if (!to?.payload) return;
    try {
        const p = JSON.parse(to.payload).pay;
        Object.assign(to, { upiId: p.upiId, payeeName: p.payee, holderName: p.holder, bankName: p.bank, accountNumber: p.accountNumber, ifsc: p.ifsc });
    } catch { to.payload = null; }
}

const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Shows the result of a check in every status line on the page. */
function sigStatus(state, html) {
    document.querySelectorAll('[data-sig-status]').forEach(el => { el.className = `cs-sig-status ${state}`; el.innerHTML = html; });
}

/**
 * Checks the organiser's digital signature over the payment details in this browser (ECDSA P-256, SHA-256, WebCrypto);
 * where the browser cannot (an http:// page), asks the organiser's server instead.
 */
async function verifyPayTo() {
    const to = ch.payTo;
    if (!to?.payload) return;
    if (!window.crypto?.subtle) { await verifyWithServer(); return; }
    try {
        const key = await crypto.subtle.importKey('spki', fromB64(to.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64(to.digitalSignature), new TextEncoder().encode(to.payload));
        sigStatus(ok ? 'ok' : 'bad', ok
            ? `<b>✓ Digital signature verified</b><small>Signed by ${esc(to.signer || 'the organiser')} with key <code>${esc(to.keyFingerprint)}</code>. It should match the key your organiser gave you.</small>`
            : '<b>✗ The signature does not match</b><small>These details were changed after the organiser signed them. Do not pay into them; ask the organiser.</small>');
    } catch {
        await verifyWithServer();
    }
}

/** Asks the organiser's server: is the signature theirs, and are these still the details to pay into? */
async function verifyWithServer() {
    const to = ch.payTo;
    sigStatus('wait', '<b>Checking with the organiser…</b>');
    try {
        const r = await call(`/api/public/hosted-chits/${encodeURIComponent(token)}/verify-pay-to`, { payload: to.payload, signature: to.digitalSignature });
        sigStatus(r.signatureValid && r.current ? 'ok' : 'bad', `<b>${r.signatureValid && r.current ? '✓ Confirmed by the organiser' : '✗ Not confirmed'}</b><small>${esc(r.message)} Key <code>${esc(r.keyFingerprint)}</code>.</small>`);
    } catch (e) {
        sigStatus('bad', `<b>Could not check</b><small>${esc(e.message)}</small>`);
    }
}

async function call(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'This link does not work any more.');
    return data;
}

function draw() {
    const main = $('sh-main');
    const foot = `<p class="sh-meta hc-share-note">As of ${day(ch.asOf)} · shared by ${esc(ch.sharedBy)}${ch.sharedWith ? ` with ${esc(ch.sharedWith)}` : ''} · this link works until ${when(ch.expiresAt)}</p>`;
    if (ch.kind === 'RECEIPT') { main.innerHTML = receiptHtml() + foot; return; }
    if (ch.kind === 'AGREEMENT') { main.innerHTML = agreementHtml() + foot; bindAccept(); bindKyc(); checkEvidence(); return; }
    main.innerHTML = (ch.kind === 'MEMBER' ? memberHtml() : chitHtml()) + foot;
    main.querySelectorAll('[data-desktop]').forEach(b => b.addEventListener('click', () => {
        const tip = $('cs-pay-tip');
        tip.textContent = 'These buttons open the app on a phone. On a computer, scan the code with your phone instead.';
        tip.classList.add('cs-flash');
    }));
    main.querySelector('[data-copy-upi]')?.addEventListener('click', async e => {
        try { await navigator.clipboard.writeText(payUpi()); e.target.textContent = 'Copied'; } catch { /* not allowed */ }
    });
    main.querySelectorAll('[data-verify-server]').forEach(b => b.addEventListener('click', () => verifyWithServer()));
    main.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { /* not allowed */ }
    }));
}

// ---------------------------------------------------------------- a chit table shared before the chit starts

/**
 * #plan=<data>: the chit table the organiser shared while setting up a chit. The figures travel in the link itself
 * (nothing is stored on the server), so the page works them out here.
 */
function planPage(main, encoded) {
    let p;
    try {
        p = JSON.parse(decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')))));
    } catch { main.innerHTML = message('This chit table link is damaged.'); return; }
    fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    document.title = `Chit table · ${p.n}`;
    const n = Number(p.m) || 0;
    const auction = p.t === 'AUCTION';
    const [y, mo] = String(p.s).split('-').map(Number);
    const dueOf = no => new Date(y, mo - 1 + no - 1, Math.min(Number(p.d) || 1, 28));
    const fmtDay = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    const short = v => { const a = Math.abs(v); return a >= 1e5 ? `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, '')}L` : a >= 1e3 ? `₹${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K` : money(v); };
    // links made since v2 carry each month's payout (and, for planned chits, installment) instead of the commission
    const planned = p.t === 'PLANNED';
    const lowBid = Number(p.lb ?? p.c) || 0;
    const rows = [];
    for (let no = 1; no <= n; no++) {
        const value = auction ? p.b : p.b + (no - 1) * (p.inc || 0);
        const each = p.e ? Number(p.e[no - 1]) : Number(p.i);
        rows.push({ no, due: dueOf(no), value, each, payout: p.p ? Number(p.p[no - 1]) : value - (Number(p.c) || 0) });
    }
    const maxBid = Math.round(p.b * (Number(p.mb) || 0) / 100);
    const scenario = (label, bid) => {
        const dividend = Math.floor((bid - lowBid) / Math.max(1, n));
        return `<div class="cs-ag"><small>${label}</small><b>${money(bid)}</b><span>winning bid</span>
            <dl><dt>Winner gets</dt><dd>${money(p.b - bid)}</dd><dt>Dividend each</dt><dd>${money(dividend)}</dd><dt>Everyone pays</dt><dd>${money(p.i - dividend)}</dd></dl></div>`;
    };
    const table = auction ? `<p class="cs-plan-meta">The amounts change every month with the winning bid. This is what a month looks like:</p>
        <div class="cs-ags">${scenario('Lowest bid', lowBid)}${scenario('A middle bid', Math.round((lowBid + maxBid) / 2 / 1000) * 1000)}${scenario('Highest bid allowed', maxBid)}</div>
        <p class="cs-plan-meta">The last member left takes the chit at the lowest bid: ${money(p.b - lowBid)}.</p>`
        : planned ? `<table class="st-table cs-plan"><thead><tr><th>Month</th><th>Pay by</th><th class="r">Each member pays</th><th class="r">Winner gets</th></tr></thead>
        <tbody>${rows.map(x => `<tr><td>${x.no}</td><td>${fmtDay(x.due)}</td><td class="r">${money(x.each)}</td><td class="r"><b>${money(x.payout)}</b></td></tr>`).join('')}</tbody></table>`
        : `<table class="st-table cs-plan"><thead><tr><th>Month</th><th>Pay by</th><th class="r">Members pay</th><th class="r">Past winners pay</th><th class="r">Chit value</th><th class="r">Winner gets</th></tr></thead>
        <tbody>${rows.map(x => `<tr><td>${x.no}</td><td>${fmtDay(x.due)}</td><td class="r">${money(p.i)}</td><td class="r">${x.no > 1 ? money(p.i + (p.x || 0)) : '—'}</td>
            <td class="r">${money(x.value)}</td><td class="r"><b>${money(x.payout)}</b></td></tr>`).join('')}</tbody></table>`;
    main.innerHTML = `
        <section class="sh-card st-hero">
            <div class="sh-head"><div><small>${esc(p.h || '')}${p.h ? ' · ' : ''}chit table${auction ? ' · auction chit' : planned ? ' · planned chit' : ''}</small><h1>${esc(p.n)}</h1></div></div>
            <p class="cs-plan-meta">${n} members · ${n} months · ${fmtDay(rows[0].due)} – ${fmtDay(rows.at(-1).due)}${p.o ? ` · run by ${esc(p.o)}` : ''}</p>
            <div class="st-total">
                <div><span>Each member pays</span><b>${money(p.i)}</b><small>${auction ? 'a month, less that month’s dividend' : planned ? (p.e ? 'in month 1; see each month' : 'every month') : `a month${p.x ? `; ${money(p.i + p.x)} after winning` : ''}`}</small></div>
                ${planned ? `<div class="st-side"><span>Winners get</span><b>${money(rows[0].payout)}</b><small>in month 1, up to ${money(Math.max(...rows.map(x => x.payout)))}</small></div>`
                    : `<div class="st-side"><span>Chit value</span><b>${money(p.b)}</b><small>${auction ? `bids ${money(lowBid)} – ${money(maxBid)}` : p.inc ? `rising ${money(p.inc)} a month` : 'every month'}</small></div>`}
                <div class="st-side"><span>Pay by</span><b>${Number(p.d)}${['th', 'st', 'nd', 'rd'][(Number(p.d) % 10 > 3 || Math.floor(Number(p.d) % 100 / 10) === 1) ? 0 : Number(p.d) % 10]}</b><small>of every month${Number(p.l) ? ` · ${p.l}% a month if late (after ${p.g} days)` : ''}</small></div>
            </div>
        </section>
        <section class="sh-card st-section"><h2>${auction ? 'How the auction works' : 'Every month'}</h2><div class="st-scroll">${table}</div>
            <button class="cs-print" onclick="window.print()">Print or save as PDF</button></section>
        <p class="sh-meta hc-share-note">A proposed chit table shared by the organiser before the chit starts. The final figures are those of the chit once it runs.</p>`;
}

// ---------------------------------------------------------------- member statement (with the payment link)

/** The UPI ID the member pays: the account the organiser picked for them (or the chit), else the chit's own UPI ID. */
function payUpi() {
    return ch.payTo ? ch.payTo.upiId : ch.upiId;
}

function payeeName() {
    return ch.payTo?.payeeName || ch.payeeName || payUpi();
}

/** "AC5L-M03": the chit's short code and the installment, 8 characters, so it reads whole on a bank statement. */
function payCode(short, monthNo) {
    const m = monthNo < 100 ? `M${String(monthNo).padStart(2, '0')}` : `M${monthNo}`;
    return `${String(short || 'CHIT').slice(0, 7 - m.length)}-${m}`;
}

/** The note for this payment: the earliest month still owed (else the next one). */
function payNote() {
    const m = ch.member;
    const open = (m?.dues || []).filter(x => x.status === 'PENDING' || x.status === 'PARTIAL').sort((a, b) => a.monthNo - b.monthNo)[0];
    return payCode(ch.shortCode, open?.monthNo || ch.currentMonth || 1);
}

/** The UPI payment's query string (payee, name, amount, note). */
function upiQuery(amount) {
    const params = [['pa', payUpi()], ['pn', payeeName()], ['am', Number(amount).toFixed(2)], ['cu', 'INR'],
        ['tn', payNote()]];
    return params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

function upiLink(amount) {
    return 'upi://pay?' + upiQuery(amount);
}

/**
 * One button per app. On Android an intent link opens exactly that app (or its Play Store page when it is not
 * installed); on an iPhone each app's own link; on a computer the buttons explain to scan the QR code instead.
 */
const UPI_APPS = [
    { name: 'Google Pay', short: 'G Pay', cls: 'gpay', pkg: 'com.google.android.apps.nbu.paisa.user', ios: 'gpay://upi/pay?' },
    { name: 'PhonePe', short: 'PhonePe', cls: 'phonepe', pkg: 'com.phonepe.app', ios: 'phonepe://pay?' },
    { name: 'Paytm', short: 'Paytm', cls: 'paytm', pkg: 'net.one97.paytm', ios: 'paytmmp://pay?' },
    { name: 'BHIM', short: 'BHIM', cls: 'bhim', pkg: 'in.org.npci.upiapp', ios: 'upi://pay?' },
];

function appLink(app, amount) {
    const ua = navigator.userAgent;
    const query = upiQuery(amount);
    if (/Android/i.test(ua)) {
        const store = encodeURIComponent(`https://play.google.com/store/apps/details?id=${app.pkg}`);
        return `intent://pay?${query}#Intent;scheme=upi;package=${app.pkg};S.browser_fallback_url=${store};end`;
    }
    if (/iPhone|iPad|iPod/i.test(ua)) return app.ios + query;
    return null;
}

function memberHtml() {
    const auction = ch.chitType === 'AUCTION';
    const m = ch.member;
    const today = new Date().toISOString().slice(0, 10);
    const late = m.dues.filter(x => (x.status === 'PENDING' || x.status === 'PARTIAL') && x.dueDate < today);
    const overdue = late.reduce((s, x) => s + Number(x.due) - Number(x.paid), 0) + Number(m.lateFeeDue || 0);
    const payNow = Number(m.payNow || 0);
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const to = ch.payTo;
    const bank = to && to.accountNumber ? bankHtml(to, payNow, m) : '';
    const fellow = to?.toMember ? `<div class="cs-fellow">
            <span class="cs-fellow-ico">👤</span>
            <div><b>Pay ${esc(to.toMember)} directly</b>
                <small>${esc(to.toMember)} won this month’s chit. The organiser asks you to pay them straight; it counts as your installment
                    and comes off their payout. Tell the organiser once paid.</small>
                <div class="cs-fellow-acts">
                    ${to.upiId ? `<span>UPI <b>${esc(to.upiId)}</b></span>` : ''}
                    ${to.toMemberPhone ? `<span>Mobile <a href="tel:${esc(to.toMemberPhone)}"><b>${esc(to.toMemberPhone)}</b></a> <button type="button" data-copy="${esc(to.toMemberPhone)}">Copy</button></span>` : ''}
                </div></div></div>` : '';
    const note = `<div class="cs-note-code"><span>Payment note</span><b>${esc(payNote())}</b><button type="button" data-copy="${esc(payNote())}">Copy</button>
        <small>Put this in the UPI note or transfer remarks: it shows on the bank statement and tells which chit and month you paid.</small></div>`;
    const mobileOnly = to?.toMember && !to.upiId && to.toMemberPhone && payNow > 0 ? `
        <section class="sh-card cs-pay">
            <div class="cs-pay-main"><span>Pay now</span><b>${money(payNow)}</b>
                <small>to ${esc(to.toMember)} · in any UPI app, choose “Pay to mobile number” and enter ${esc(to.toMemberPhone)}</small>
                ${fellow}${note}
                ${to.payload ? `<div class="cs-sig-status wait" data-sig-status><b>Checking the organiser’s digital signature…</b></div>` : ''}</div>
        </section>` : '';
    const pay = mobileOnly || (payUpi() && payNow > 0 ? `
        <section class="sh-card cs-pay">
            <div class="cs-pay-main">${fellow}<span>Pay now</span><b>${money(payNow)}</b>
                <small>${Number(m.lateFeeDue) ? `includes ${money(m.lateFeeDue)} late interest · ` : ''}to ${esc(payeeName())}</small>
                <div class="cs-apps">${UPI_APPS.map(app => {
                    const href = appLink(app, payNow);
                    return href ? `<a class="cs-app ${app.cls}" href="${esc(href)}" title="Pay with ${app.name}">${upiLogo(app.cls)}<span>Pay</span></a>`
                        : `<button type="button" class="cs-app ${app.cls}" data-desktop title="${app.name}">${upiLogo(app.cls)}<span>Pay</span></button>`;
                }).join('')}</div>
                <a class="cs-pay-btn cs-any-upi" href="${upiLink(payNow)}">${upiLogo('upi')}Any UPI app</a>
                <div class="cs-upi-id"><span>UPI ID <b>${esc(payUpi())}</b></span><button type="button" data-copy-upi>Copy</button></div>
                ${note}
                <small id="cs-pay-tip">${phone ? 'Tap your app: the amount and note are filled in. Check the name before you pay.'
                    : 'On a computer: scan the code with your phone’s UPI app, or open this link on your phone.'}</small>
                ${to?.payload ? `<div class="cs-sig-status wait" data-sig-status><b>Checking the organiser’s digital signature…</b></div>` : ''}</div>
            <div class="cs-qr">${qrSvg(upiLink(payNow), { size: 170 })}<small>Scan to pay ${money(payNow)}</small></div>
            ${bank ? `<details class="cs-bank-alt"><summary>Pay by bank transfer instead</summary>${bank}</details>` : ''}
        </section>` : bank ? `<section class="sh-card cs-bank-card">${bank}</section>` : '');
    return `
        <section class="sh-card st-hero">
            ${head(m.name, ch.name)}
            ${msg()}
            <div class="st-total">
                <div><span>${overdue > 0 ? 'Overdue' : m.nextDueDate ? 'Next payment' : 'All paid'}</span>
                    <b>${overdue > 0 ? money(overdue) : m.nextDueAmount ? money(m.nextDueAmount) : money(0)}</b>
                    <small>${overdue > 0 ? `for ${late.map(x => 'month ' + x.monthNo).join(', ') || 'late interest'} · please pay at the earliest`
                        : m.nextDueDate ? `due on ${day(m.nextDueDate)}` : 'nothing more is due'}</small></div>
                <div class="st-side"><span>${m.wonMonth ? `You won month ${m.wonMonth}` : 'Not won yet'}</span>
                    <b>${m.wonMonth ? money(m.received) : '—'}</b><small>${m.receivedOn ? `received ${day(m.receivedOn)}` : m.wonMonth ? 'to be paid' : auction ? 'bid in a coming auction' : 'your turn will come'}</small></div>
                <div class="st-side"><span>Paid so far</span><b>${money(m.totalPaid)}</b><small>${m.payments.length} payment${m.payments.length === 1 ? '' : 's'}</small></div>
            </div>
            ${progress()}
        </section>
        ${pay}
        <div class="st-figs">
            <div class="st-fig"><span>Each month</span><b>${money(ch.installment)}</b><small>${auction ? 'less that month’s dividend' : Number(ch.winnerExtraAmount) ? `+${money(ch.winnerExtraAmount)} after winning` : 'every month'}</small></div>
            ${auction ? `<div class="st-fig"><span>Dividends so far</span><b class="pos">${money(m.dividends)}</b><small>your share of the bids</small></div>` : ''}
            <div class="st-fig"><span>Late payments</span><b>${Number(ch.lateFeePercent) ? `${Number(ch.lateFeePercent)}% a month` : 'no interest'}</b><small>${Number(ch.lateFeePercent) ? `after ${ch.lateGraceDays} days` : 'pay on time anyway'}</small></div>
            <div class="st-fig"><span>Chit value</span><b>${money(ch.baseValue)}</b><small>${ch.memberCount} members</small></div>
        </div>
        <section class="sh-card st-section"><h2>Your months</h2>
            <div class="st-scroll"><table class="st-table"><thead><tr><th>Month</th><th>Pay by</th><th class="r">Due</th><th class="r">Paid</th><th class="r">Late int.</th><th>Status</th></tr></thead>
            <tbody>${m.dues.map(x => {
                const isLate = (x.status === 'PENDING' || x.status === 'PARTIAL') && x.dueDate < today;
                const badge = (x.status === 'PENDING' || x.status === 'PARTIAL') && !isLate ? (x.status === 'PARTIAL' ? DUE.PARTIAL : ['part', 'Due']) : DUE[x.status];
                return `<tr class="${isLate ? 'late' : ''}"><td>${x.monthNo}${m.wonMonth === x.monthNo ? ' 👑' : ''}</td><td>${day(x.dueDate)}</td>
                    <td class="r">${money(x.due)}</td><td class="r">${Number(x.paid) ? money(x.paid) : '—'}</td><td class="r">${Number(x.lateFeeDue) ? money(x.lateFeeDue) : '—'}</td>
                    <td><span class="st-badge sm ${badge[0]}">${badge[1]}</span></td></tr>`;
            }).join('')}</tbody></table></div></section>
        ${m.payments.length ? `<section class="sh-card st-section"><h2>Your payments</h2>
            <div class="st-scroll"><table class="st-table"><thead><tr><th>Receipt</th><th>Date</th><th>Month</th><th class="r">Amount</th><th>How</th></tr></thead>
            <tbody>${m.payments.map(p => `<tr><td>${esc(p.receiptNo || '')}</td><td>${day(p.paidDate)}</td><td>${p.monthNo}</td>
                <td class="r">${money(Number(p.amount) + Number(p.lateFee))}${Number(p.lateFee) ? `<small class="muted"> incl. ${money(p.lateFee)} late</small>` : ''}</td>
                <td>${esc(p.mode)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

// ---------------------------------------------------------------- whole chit

function chitHtml() {
    const auction = ch.chitType === 'AUCTION';
    return `
        <section class="sh-card st-hero">
            ${head(ch.name, '')}
            ${msg()}
            <div class="st-total">
                <div><span>Collected so far</span><b>${money(ch.totalCollected)}</b><small>${Number(ch.pendingDues) ? `${money(ch.pendingDues)} still to come` : 'nothing pending'}</small></div>
                <div class="st-side"><span>Paid to winners</span><b>${money(ch.totalPaidOut)}</b><small>${ch.completedMonths} winners</small></div>
                ${ch.showEarnings ? `<div class="st-side"><span>Organiser's commission</span><b>${money(ch.commissionEarned)}</b><small>${money(ch.commission)} a month</small></div>` : ''}
            </div>
            ${progress()}
        </section>
        <div class="st-figs">
            <div class="st-fig"><span>Each member pays</span><b>${money(ch.installment)}</b><small>${auction ? 'less the month’s dividend' : 'a month'}</small></div>
            <div class="st-fig"><span>Chit value</span><b>${money(ch.baseValue)}</b><small>${auction ? `bids up to ${money(ch.maxBid)}` : 'in month 1'}</small></div>
            <div class="st-fig"><span>Members</span><b>${ch.memberCount}</b><small>${ch.months} months</small></div>
            ${ch.showEarnings ? `<div class="st-fig"><span>Money held</span><b>${money(ch.held)}</b><small>collected, not yet paid out</small></div>` : ''}
        </div>
        <section class="sh-card st-section"><h2>${auction ? 'How the auction works' : 'Every month'}</h2>
            <div class="st-scroll"><table class="st-table"><thead><tr><th>Month</th><th>Pay by</th>${auction ? '<th class="r">Bid</th><th class="r">Dividend</th>' : '<th class="r">Chit value</th>'}
                <th class="r">Winner gets</th><th>Winner</th><th class="r">Collected</th><th>Status</th></tr></thead>
            <tbody>${ch.schedule.map(x => `<tr><td>${x.monthNo}</td><td>${day(x.dueDate)}</td>
                ${auction ? `<td class="r">${x.bid !== null ? money(x.bid) : '—'}</td><td class="r">${x.bid !== null ? money(x.dividend) : '—'}</td>` : `<td class="r">${money(x.chitValue)}</td>`}
                <td class="r">${x.estimated ? 'up to ' : ''}${money(x.payout)}</td><td>${esc(x.winner || '—')}</td>
                <td class="r">${Number(x.collected) ? money(x.collected) : '—'}</td>
                <td><span class="st-badge sm ${STATUS[x.status][0]}">${STATUS[x.status][1]}</span></td></tr>`).join('')}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- receipt

function receiptHtml() {
    const r = ch.receipt;
    const line = (label, value) => `<div class="cs-line"><span>${label}</span><b>${value}</b></div>`;
    return `
        <section class="sh-card cs-receipt">
            <div class="sh-head"><div><small>${esc(ch.household)} · payment receipt</small><h1>${esc(ch.name)}</h1></div>
                <span class="st-badge done">${esc(r.receiptNo || '')}</span></div>
            <div class="cs-amount"><span>Received from ${esc(r.memberName)}</span><b>${money(r.total)}</b><small>on ${day(r.paidDate)}</small></div>
            ${line('Towards', `month ${r.monthNo} installment (due ${day(r.monthDueDate)})`)}
            ${line('Installment paid', money(r.amount))}
            ${Number(r.lateFee) ? line('Late payment interest', money(r.lateFee)) : ''}
            ${Number(r.lateFeeWaived) ? line('Late interest let off', money(r.lateFeeWaived)) : ''}
            ${line('Paid by', `${esc(r.mode)}${r.reference ? ` · ref ${esc(r.reference)}` : ''}`)}
            ${line(`Month ${r.monthNo} so far`, `${money(r.paidForMonth)} of ${money(r.dueForMonth)}${Number(r.balanceForMonth) ? ` · ${money(r.balanceForMonth)} still due` : ' · fully paid'}`)}
            <div class="cs-rc-sign">
                <div class="cs-rc-seal"><b>✓ Digitally sealed by the organiser</b>
                    <small>This seal is worked out from every figure above with the organiser's secret key. It matches the organiser's records today; a printed copy whose seal differs has been changed.</small>
                    <code>${esc(r.seal || '')}</code></div>
                <div class="cs-rc-signer">${r.signature ? signatureSvg(r.signature) : ''}<b>${esc(r.signer || ch.sharedBy || '')}</b><small>${r.signature ? 'Digitally signed · organiser' : 'Organiser'}</small></div>
            </div>
            <div class="cs-rc-acts">
                <a class="cs-pay-btn" href="/api/public/hosted-chits/${encodeURIComponent(token)}/receipt.pdf" download="Receipt ${esc(r.receiptNo || '')}.pdf">Download signed PDF</a>
                <button class="cs-print" onclick="window.print()">Print</button>
            </div>
        </section>`;
}

/**
 * The organiser's bank details for a transfer (NEFT / IMPS / RTGS): each with a copy button, the amount and the
 * reference to write, signed by the organiser, stamped and sealed (the seal covers every detail and the signature).
 */
function bankHtml(to, payNow, m) {
    const ref = payNote();
    const row = (label, value, copy = value) => `<div class="cs-bank-row"><span>${label}</span><b>${esc(value)}</b>${copy ? `<button type="button" data-copy="${esc(copy)}">Copy</button>` : '<i></i>'}</div>`;
    return `<div class="cs-bank">
        <div class="cs-bank-head"><span>${payNow > 0 ? 'Pay by bank transfer' : 'Where to pay'}</span>
            ${payNow > 0 ? `<b>${money(payNow)}</b>` : ''}<small>NEFT, IMPS or RTGS from any bank account · add these details as a payee</small></div>
        <div class="cs-bank-rows">
            ${row('Account holder', to.holderName || to.payeeName || '')}
            ${to.bankName ? row('Bank', to.bankName, '') : ''}
            ${row('Account number', to.accountNumber, to.accountNumber.replace(/\s+/g, ''))}
            ${row('IFSC', to.ifsc)}
            ${payNow > 0 ? row('Amount', money(payNow), Number(payNow).toFixed(2)) : ''}
            ${row('Remarks / reference', ref)}
        </div>
        <div class="cs-rc-sign cs-bank-sign">
            <div class="cs-sig">
                ${to.payload ? `<div class="cs-sig-status wait" data-sig-status><b>Checking the organiser’s digital signature…</b></div>` : ''}
                <small class="cs-sig-note">These are the only details to pay this chit into, digitally signed by the organiser on ${when(to.sealedAt)}
                    (ECDSA P-256 · SHA-256). If anyone sends you different details, or this page says the signature does not match, do not pay: ask the organiser.</small>
                <div class="cs-sig-acts">
                    ${to.payload ? '<button type="button" data-verify-server>Check with the organiser</button>' : ''}
                    ${to.keyFingerprint ? `<span>Key <code>${esc(to.keyFingerprint)}</code></span>` : ''}
                </div>
                ${to.digitalSignature ? `<details class="cs-sig-raw"><summary>Signature</summary><code>${esc(to.digitalSignature)}</code></details>` : ''}
            </div>
            <div class="cs-stamp" aria-hidden="true"><span>${esc((to.stampName || ch.household || '').slice(0, 26))}</span><b>VERIFIED</b><small>${day(String(to.sealedAt).slice(0, 10))}</small></div>
            <div class="cs-rc-signer">${to.signature ? signatureSvg(to.signature) : ''}<b>${esc(to.signer || ch.sharedBy || '')}</b><small>${to.signature ? 'Digitally signed · organiser' : 'Organiser'}</small></div>
        </div>
        <div class="cs-bank-qr">${qrSvg(location.href, { size: 92 })}<small>Got these details on paper or as a photo? Scan this to open the organiser’s signed page and compare.</small></div>
    </div>`;
}

// ---------------------------------------------------------------- agreement

function agreementHtml() {
    const a = ch.agreement;
    const done = a.status !== 'DRAFT';
    return `
        <section class="sh-card cs-agreement">
            <div class="sh-head"><div><small>${esc(ch.household)} · chit prize agreement · ${esc(a.agreementNo)}</small><h1>${esc(a.memberName)}</h1>
                <small>${esc(ch.name)} · month ${a.monthNo}</small></div>
                <span class="st-badge ${done ? 'done' : 'part'}">${done ? (a.status === 'SIGNED' ? 'Signed' : 'Accepted') : 'Waiting for you'}</span></div>
            <div class="st-total">
                <div><span>Amount received</span><b>${money(a.payoutAmount)}</b><small>${esc(a.payoutInWords)}${a.payoutDate ? ` · ${day(a.payoutDate)}` : ''}${a.payoutMode ? ` · ${esc(a.payoutMode)}` : ''}${a.payoutReference ? ` · ref ${esc(a.payoutReference)}` : ''}</small></div>
                <div class="st-side"><span>Chit value</span><b>${money(a.chitValue)}</b><small>${ch.chitType === 'AUCTION' ? 'less the winning bid' : 'less the commission'} ${money(a.deduction)}</small></div>
                <div class="st-side"><span>Still to pay</span><b>${a.remainingInstallments} months</b><small>about ${money(a.remainingAmount)}</small></div>
            </div>
            <div class="cs-terms">${esc(a.terms)}</div>
            ${!done && a.kycFromMember ? `<div class="cs-kyc" data-kyc-box>${kycHtml()}</div>` : ''}
            ${done ? `<div class="cs-accepted">✓ ${a.status === 'SIGNED' ? 'Signed on paper' : 'Accepted'} by <b>${esc(a.acceptedName)}</b> on ${when(a.acceptedAt)}
                ${a.acceptedPhoneMasked ? ` · mobile ${esc(a.acceptedPhoneMasked)}` : ''}${a.locationShared ? ' · location shared' : ''}
                ${a.signature ? `<div class="cs-sign-show">${signatureSvg(a.signature)}</div>` : ''}
                ${a.acceptanceSeal ? `<small>Acceptance seal (SHA-256) <code>${esc(a.acceptanceSeal)}</code></small>` : ''}
                ${a.digitalSignature ? `<div class="cs-sig-status wait" data-ev-status><b>Checking the digital signature…</b></div>` : ''}</div>` : `
            <form class="cs-accept" id="cs-accept" onsubmit="return false">
                <label class="cs-check"><input type="checkbox" name="agree"> I have read this agreement, I received the amount above in full, and I accept it.</label>
                <div class="cs-fields">
                    <label class="cs-name"><span>Your full name <small>check it is right</small></span><input name="name" maxlength="100" autocomplete="name" value="${esc(a.memberName)}"></label>
                    ${a.kycFromMember ? `<label class="cs-name"><span>Aadhaar number <small>12 digits${a.aadhaarLast4 ? `, ending ${esc(a.aadhaarLast4)}` : ''}</small></span><input name="aadhaar" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="XXXX XXXX XXXX"></label>
                    <label class="cs-name"><span>PAN <small>as on your card</small></span><input name="pan" maxlength="10" autocomplete="off" placeholder="ABCDE1234F" style="text-transform:uppercase"></label>` : ''}
                    <label class="cs-name"><span>Your mobile number <small>your phone can fill it in</small></span>
                        <span class="cs-phone"><input name="phone" type="tel" inputmode="tel" maxlength="16" autocomplete="tel" placeholder="10 digits">
                        ${'contacts' in navigator && 'select' in navigator.contacts ? '<button type="button" id="cs-pick-phone" title="Pick your number from your contacts (your own card)">Contacts</button>' : ''}</span></label>
                </div>
                <div class="cs-sign"><div class="cs-sign-head"><span>Sign here with your finger or mouse</span><button type="button" id="cs-sign-clear">Clear</button></div>
                    <canvas id="cs-sign-pad" width="1000" height="300"></canvas></div>
                <label class="cs-check"><input type="checkbox" name="location"> Add my current location to the record (your phone will ask)</label>
                <p class="cs-error" id="cs-error"></p>
                <button type="submit" class="cs-pay-btn">Accept and sign</button>
                <small class="muted">Recorded with your acceptance: your name, mobile number and signature, the time, your IP address and this device
                    (browser, system, screen, language and time zone)${''}, and your location if you allow it. They are sealed with a fingerprint so any change shows.</small>
            </form>`}
            <p class="cs-hash">Made ${when(a.createdAt)} · fingerprint (SHA-256) <code>${esc(a.contentHash)}</code></p>
            <div class="cs-print-row"><button class="cs-print" onclick="window.print()">Print or save as PDF</button>
                <button class="cs-print" type="button" id="cs-bond">Print view (A4)</button></div>
        </section>`;
}

const KYC = { AADHAAR_FRONT: ['Aadhaar card · front', 'the side with your photo', true], AADHAAR_BACK: ['Aadhaar card · back', 'the side with your address', false],
    PAN: ['PAN card', 'the side with the number', true], SELFIE: ['Selfie', 'a live photo of you, from the front camera', false] };

/** The ID proof the organiser asked for: what is added, and a button for each (a photo, or the camera for a selfie). */
function kycHtml() {
    const have = new Set(ch.agreement.kycDocs || []);
    return `<div class="cs-kyc-head"><b>Your ID proof</b><small>The organiser asked for your Aadhaar and PAN cards. Only the last 4 digits of your Aadhaar number are kept.</small></div>
        <div class="kyc-grid">${Object.entries(KYC).map(([t, [label, hint, need]]) => `<div class="kyc-tile ${have.has(t) ? 'done' : ''} ${need ? 'need' : ''}">
            <b>${esc(label)}</b><small>${have.has(t) ? '✓ added' : esc(hint)}</small>
            <div class="kyc-acts">${t === 'SELFIE' ? `<button type="button" data-cs-cam="${t}">${have.has(t) ? 'Retake' : 'Open camera'}</button>`
                : `<label>${have.has(t) ? 'Replace' : 'Add photo'}<input type="file" accept="image/*,application/pdf" data-cs-file="${t}"></label>`}</div>
        </div>`).join('')}</div>
        <div class="kyc-cam" data-cs-camera hidden><div class="kyc-frame"><video autoplay playsinline muted></video></div>
            <div class="kyc-cam-acts"><button type="button" class="cs-print" data-cs-shoot>Take the photo</button><button type="button" class="cs-print" data-cs-stop>Cancel</button></div></div>
        <p class="cs-error" data-kyc-error></p>`;
}

function bindKyc() {
    const box = document.querySelector('[data-kyc-box]');
    $('cs-bond')?.addEventListener('click', () => printBond(bondDoc(), `Agreement ${ch.agreement.agreementNo}`));
    if (!box) return;
    let cam = null;
    const error = text => { box.querySelector('[data-kyc-error]').textContent = text || ''; };
    const send = async (type, blob, name) => {
        error('');
        const form = new FormData();
        form.append('docType', type);
        form.append('file', blob, name);
        const r = await fetch(`/api/public/hosted-chits/${encodeURIComponent(token)}/kyc`, { method: 'POST', body: form });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message || 'The photo could not be added');
        ch = data;
        box.innerHTML = kycHtml();
    };
    box.addEventListener('change', async e => {
        const input = e.target.closest('[data-cs-file]');
        if (!input?.files?.[0]) return;
        try { await send(input.dataset.csFile, await shrinkImage(input.files[0]), input.files[0].name); } catch (err) { error(err.message); }
    });
    box.addEventListener('click', async e => {
        try {
            if (e.target.closest('[data-cs-cam]')) {
                box.querySelector('[data-cs-camera]').hidden = false;
                cam = await openCamera(box.querySelector('video'), { facing: 'user' });
            }
            if (e.target.closest('[data-cs-stop]')) { cam?.stop(); cam = null; box.querySelector('[data-cs-camera]').hidden = true; }
            if (e.target.closest('[data-cs-shoot]') && cam) {
                const blob = await cam.capture(`${ch.agreement.agreementNo} · ${ch.agreement.memberName}`);
                cam.stop();
                cam = null;
                await send('SELFIE', blob, 'selfie.jpg');
            }
        } catch (err) { error(err.message); }
    });
}

/** The member's own copy: the evidence's digital signature, checked in this browser. */
async function checkEvidence() {
    const a = ch.agreement;
    const el = document.querySelector('[data-ev-status]');
    if (!el) return;
    const ok = await verifyEvidence(a.evidencePayload, a.digitalSignature, a.publicKey);
    el.className = `cs-sig-status ${ok === false ? 'bad' : ok ? 'ok' : 'wait'}`;
    el.innerHTML = ok === null ? '<b>This browser cannot check the digital signature</b><small>Open the link in Chrome or Safari over https.</small>'
        : ok ? `<b>✓ Digital signature verified</b><small>The record of your acceptance is signed with the organiser's key <code>${esc(a.keyFingerprint)}</code>; any change to it would show here.</small>`
        : '<b>✗ The signature does not match</b><small>The record was changed after it was signed. Tell the organiser.</small>';
}

/** The agreement as a stamp-paper deed, for the member to print. */
function bondDoc() {
    const a = ch.agreement;
    const done = a.status !== 'DRAFT';
    return {
        kind: 'CHIT', title: 'Chit prize amount receipt and agreement', number: a.agreementNo, date: a.payoutDate || String(a.createdAt).slice(0, 10),
        stampDuty: a.stampDuty, stampSerial: a.stampSerial,
        firstParty: { role: 'Organiser (foreman)', term: 'Organiser', name: a.organiserName || ch.sharedBy, relation: `organiser of ${ch.household}`, signature: a.organiserSignature, seal: ch.household },
        secondParty: { role: 'Member (prize winner)', term: 'Member', name: done ? a.acceptedName : a.memberName, signature: a.status === 'ACCEPTED' ? a.signature : null,
            accepted: a.status === 'ACCEPTED' ? `accepted online ${when(a.acceptedAt)}` : '' },
        witness: { name: a.witnessName, signature: a.witnessSignature },
        recitals: chitRecitals(ch.name, ch.memberCount, ch.months, money(a.chitValue), a.monthNo),
        particulars: [['Chit value', money(a.chitValue)], [ch.chitType === 'AUCTION' ? 'Winning bid' : 'Commission', money(a.deduction)],
            ['Prize amount received', `${money(a.payoutAmount)} (${a.payoutInWords})`], ['Installments still to pay', `${a.remainingInstallments} months · about ${money(a.remainingAmount)}`],
            ...(a.aadhaarLast4 ? [['Aadhaar', `XXXX XXXX ${a.aadhaarLast4}`]] : []), ...(a.panMasked ? [['PAN', a.panMasked]] : [])],
        terms: a.terms, fingerprint: a.contentHash,
        annexures: a.acceptanceSeal ? [{ title: 'Evidence of the online acceptance', rows: [['Accepted by', esc(a.acceptedName)], ['Accepted at', esc(when(a.acceptedAt))],
            ['Mobile', esc(a.acceptedPhoneMasked || '')], ['Acceptance seal (SHA-256)', `<code>${esc(a.acceptanceSeal)}</code>`],
            ...(a.digitalSignature ? [['Digital signature', `<code>${esc(a.digitalSignature.slice(0, 44))}…</code><br>key ${esc(a.keyFingerprint || '')}`]] : [])] }] : [],
    };
}


function bindAccept() {
    const form = $('cs-accept');
    if (!form) return;
    const sig = signaturePad($('cs-sign-pad'));
    $('cs-sign-clear').addEventListener('click', () => sig.clear());
    // web pages cannot read a phone's own number: the browser's autofill (autocomplete="tel") offers it as the member
    // taps the field, and on Android Chrome the contacts picker can fill it from the member's own contact card
    $('cs-pick-phone')?.addEventListener('click', async () => {
        try {
            const [picked] = await navigator.contacts.select(['tel', 'name'], { multiple: false });
            const tel = picked?.tel?.[0];
            if (tel) form.phone.value = tel.replace(/[^\d+]/g, '');
            if (picked?.name?.[0] && !form.name.value.trim()) form.name.value = picked.name[0];
        } catch { /* closed or not allowed */ }
    });
    form.phone.addEventListener('change', () => {   // autofill gives +91 98765 43210: keep the 10 digits
        const digits = form.phone.value.replace(/\D/g, '');
        if (digits.length > 10 && digits.startsWith('91')) form.phone.value = digits.slice(-10);
    });
    form.addEventListener('submit', async () => {
        const button = form.querySelector('button[type=submit]');
        const error = $('cs-error');
        error.textContent = '';
        if (!form.agree.checked) { error.textContent = 'Tick the box to confirm you agree'; return; }
        if (form.name.value.trim().length < 2) { error.textContent = 'Type your full name'; return; }
        if (!/^(\+?91)?[6-9]\d{9}$/.test(form.phone.value.replace(/[\s-]/g, ''))) { error.textContent = 'Enter your 10-digit mobile number'; return; }
        if (sig.empty()) { error.textContent = 'Sign in the box'; return; }
        if (ch.agreement.kycFromMember) {
            const have = new Set(ch.agreement.kycDocs || []);
            if (!have.has('AADHAAR_FRONT')) { error.textContent = 'Add a photo of your Aadhaar card (the side with your photo) above'; return; }
            if (!have.has('PAN')) { error.textContent = 'Add a photo of your PAN card above'; return; }
            if (!/^[2-9]\d{11}$/.test(form.aadhaar.value.replace(/[\s-]/g, ''))) { error.textContent = 'Enter your 12-digit Aadhaar number'; return; }
            if (!/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(form.pan.value.trim())) { error.textContent = 'Enter your PAN as on the card (ABCDE1234F)'; return; }
        }
        button.disabled = true;
        button.textContent = 'Recording…';
        try {
            const location = form.location.checked ? await locate() : null;
            ch = await call(`/api/public/hosted-chits/${encodeURIComponent(token)}/accept`, {
                name: form.name.value, agree: true, phone: form.phone.value, signature: sig.path(), location, device: JSON.stringify(deviceInfo()),
                aadhaarNumber: form.aadhaar ? form.aadhaar.value : null, pan: form.pan ? form.pan.value : null,
            });
            draw();
            window.scrollTo(0, 0);
        } catch (err) {
            error.textContent = err.message;
            button.disabled = false;
            button.textContent = 'Accept and sign';
        }
    });
}

/** A signature pad on a canvas; the strokes come back as an SVG path in a 1000 x 300 box. */
function signaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    const strokes = [];
    let current = null;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a2e4f';
    const point = e => {
        const box = canvas.getBoundingClientRect();
        return [Math.round(((e.clientX - box.left) / box.width) * 1000), Math.round(((e.clientY - box.top) / box.height) * 300)];
    };
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
    const end = () => { current = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return {
        empty: () => strokes.reduce((n, s) => n + s.length, 0) < 6,
        clear: () => { strokes.length = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); },
        path: () => strokes.filter(s => s.length > 1).map(s => 'M' + s.map(([x, y]) => `${x} ${y}`).join(' L')).join(' ').slice(0, 20000),
    };
}

function signatureSvg(path) {
    const safe = String(path).replace(/[^MLml0-9 .-]/g, '');
    return `<svg viewBox="0 0 1000 300" role="img" aria-label="Signature"><path d="${safe}" fill="none" stroke="#0a2e4f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** The location, when the member allows it (lat,lng,accuracy); nothing when they refuse or it takes too long. */
function locate() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            p => resolve(`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)},${Math.round(p.coords.accuracy)}`),
            () => resolve(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
}

/** What this device reports about itself: kept with the acceptance as evidence. */
function deviceInfo() {
    const n = navigator;
    return {
        userAgent: n.userAgent, platform: n.userAgentData?.platform || n.platform, mobile: n.userAgentData?.mobile ?? /Mobi|Android|iPhone/i.test(n.userAgent),
        language: n.language, languages: (n.languages || []).slice(0, 4), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeZoneOffset: new Date().getTimezoneOffset(), localTime: new Date().toString(),
        screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`, viewport: `${innerWidth}x${innerHeight}`,
        touchPoints: n.maxTouchPoints || 0, cores: n.hardwareConcurrency || null, memoryGb: n.deviceMemory || null,
        connection: n.connection?.effectiveType || null, cookies: n.cookieEnabled,
    };
}

// ---------------------------------------------------------------- parts

function head(title, sub) {
    const done = ch.status === 'COMPLETED';
    return `<div class="sh-head"><div><small>${esc(ch.household)} · ${ch.chitType === 'AUCTION' ? 'auction chit' : 'chit'} of ${money(ch.baseValue)}</small>
        <h1>${esc(title)}</h1>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
        <span class="st-badge ${done ? 'done' : 'open'}">${done ? 'Finished' : `Month ${ch.currentMonth} of ${ch.months}`}</span></div>`;
}

function msg() {
    return ch.message ? `<p class="st-message">${esc(ch.message)}<br><span>— ${esc(ch.sharedBy)}</span></p>` : '';
}

function progress() {
    return `<div class="st-progress"><div class="row"><span>Months paid out</span><b>${ch.completedMonths} of ${ch.months}</b></div>
        <i><em style="width:${(ch.completedMonths / ch.months) * 100}%"></em></i></div>`;
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Chit</h1><p>${esc(text)}</p></section>`;
}

start();
