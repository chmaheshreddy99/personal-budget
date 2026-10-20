/**
 * The customer's page behind a brick order link (brick-order.html#<token>), made for a phone: where the order is (an
 * animated road from the yard to the site, each trip with its vehicle and driver), the bill with its breakdown, paying
 * by UPI (Google Pay, PhonePe, Paytm, BHIM, any UPI app or the QR code) and telling the business it was paid, and
 * signing for each trip received (the signature, this device and, when allowed, the location are kept as evidence).
 */
import { upiLogo } from './core/upi-logos.js';
import { qrSvg } from './core/qr.js';
import { esc, signaturePad, signatureSvg, deviceInfo, locate } from './core/bond.js';
import { billDocHtml, billFromPublic, verifyDoc, printDoc } from './core/brick-docs.js';

const token = location.hash.slice(1);
const $ = id => document.getElementById(id);
let o, fmt, refreshTimer;
const money = v => fmt.format(Number(v || 0));
const count = v => Number(v || 0).toLocaleString('en-IN');
const day = iso => iso ? new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const time = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
/** On the trip line: the time today, else the short date (room is tight on a phone). */
const stamp = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const STAGES = [['RECEIVED', 'Order received', '📝'], ['LOADING', 'Loading at yard', '🧱'], ['DISPATCHED', 'Dispatched', '🚚'],
    ['IN_TRANSIT', 'On the way', '🛣️'], ['DELIVERED', 'Delivered', '✅']];
const TRIP = { PLANNED: 0, LOADING: 1, DISPATCHED: 2, IN_TRANSIT: 3, DELIVERED: 4 };

async function call(path, body) {
    const res = await fetch(`/api/public/brick-orders/${encodeURIComponent(token)}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Something went wrong');
    return data;
}

async function start() {
    const main = $('bo-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    try {
        o = await call('');
    } catch (e) { main.innerHTML = message(e.message); return; }
    fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: o.currency || 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
    draw();
    // keep it current while the bricks are on their way
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
        if (document.hidden || document.querySelector('.bo-sheet') || o.status === 'DELIVERED' || o.status === 'CANCELLED') return;
        try { o = await call(''); draw(); } catch { /* keep what is shown */ }
    }, 60000);
}

function draw() {
    document.title = `${o.orderNo} · ${o.company}`;
    $('bo-company').textContent = o.company;
    const main = $('bo-main');
    main.innerHTML = o.invoice ? `${heroHtml()}${billHtml()}${tripsHtml()}${paymentsHtml()}${aboutHtml()}`
        : `${heroHtml()}${claimedHtml()}${tripsHtml()}${payHtml()}${billHtml()}${paymentsHtml()}${aboutHtml()}`;
    requestAnimationFrame(() => main.querySelector('.bo-road')?.classList.add('go'));
    if (o.invoice) verifyDoc(main.querySelector('.bo-doc'), o.invoice.payload, o.invoice.signature, o.publicKey);
    bind(main);
}

// ---------------------------------------------------------------- the road

function progress() {
    if (o.status === 'DELIVERED') return 1;
    if (o.status === 'CANCELLED') return 0;
    const t = o.totals;
    const trips = o.trips.length ? o.trips : [];
    const live = trips.filter(x => x.status !== 'DELIVERED');
    const best = live.reduce((m, x) => Math.max(m, TRIP[x.status] ?? 0), 0);
    const delivered = t.quantity ? t.delivered / t.quantity : 0;
    return Math.max(delivered, best / 4) * 0.98;
}

function heroHtml() {
    const p = progress();
    const at = o.status === 'PART_DELIVERED' ? 3 : Math.max(0, STAGES.findIndex(s => s[0] === o.status));
    const moving = ['DISPATCHED', 'IN_TRANSIT'].includes(o.status) || o.trips.some(t => ['DISPATCHED', 'IN_TRANSIT'].includes(t.status));
    const next = o.trips.find(t => t.status !== 'DELIVERED');
    return `<section class="sh-card bo-hero">
        <div class="sh-head"><div><small>${esc(o.organization)} · order ${esc(o.orderNo)}</small><h1>${esc(o.statusLabel)}</h1>
            <small class="bo-sub">${esc(o.customerName)} · ${count(o.totals.quantity)} bricks${o.requiredBy ? ` · needed by ${day(o.requiredBy)}` : ''}</small></div>
            <span class="sh-badge ${o.status === 'DELIVERED' ? 'done' : ''}">${o.status === 'PART_DELIVERED' ? `${count(o.totals.delivered)} of ${count(o.totals.quantity)}` : esc(o.statusLabel)}</span></div>
        <div class="bo-road ${moving ? 'moving' : ''} ${o.status === 'DELIVERED' ? 'arrived' : ''}" style="--p:${p}">
            <span class="bo-yard" title="The yard">🏭</span><span class="bo-site" title="Your site">🏠</span>
            <div class="bo-lane"><i></i></div><span class="bo-truck" aria-hidden="true">🚚</span></div>
        <ol class="bo-steps">${STAGES.map(([k, l, e], i) => `<li class="${i < at || o.status === 'DELIVERED' ? 'done' : i === at ? 'now' : ''}" style="--i:${i}"><span>${e}</span><b>${l}</b></li>`).join('')}</ol>
        ${next && o.status !== 'CANCELLED' ? `<p class="bo-next">${nextText(next)}</p>` : ''}
    </section>`;
}

function nextText(t) {
    if (t.status === 'IN_TRANSIT') return `🛣️ Trip ${t.tripNo} is on its way${t.vehicle ? ` in ${esc(t.vehicle)}` : ''}${t.driver ? ` with ${esc(t.driver)}` : ''}.`;
    if (t.status === 'DISPATCHED') return `🚚 Trip ${t.tripNo} has left the yard${t.dispatchedAt ? ` at ${time(t.dispatchedAt)}` : ''}.`;
    if (t.status === 'LOADING') return `🧱 Trip ${t.tripNo} is being loaded at the yard.`;
    return `📅 Trip ${t.tripNo} is planned${t.scheduledOn ? ` for ${day(t.scheduledOn)}` : ''}.`;
}

// ---------------------------------------------------------------- trips

function tripsHtml() {
    if (!o.trips.length) return '';
    return `<section class="sh-card bo-trips"><h2>Deliveries <small>${o.trips.length} trip${o.trips.length === 1 ? '' : 's'}</small></h2>
        ${o.trips.map(t => {
            const i = TRIP[t.status] ?? 0;
            const times = [null, t.loadingAt, t.dispatchedAt, t.inTransitAt, t.deliveredAt];
            return `<article class="bo-trip ${esc(t.status)}">
                <header><b>🚚 Trip ${t.tripNo}</b><span class="bo-pill s${i}">${esc(t.statusLabel)}</span></header>
                <div class="bo-trip-line">${['Planned', 'Loading', 'Dispatched', 'On the way', 'Delivered'].map((l, k) =>
                    `<div class="${k <= i ? 'done' : ''} ${k === i ? 'now' : ''}"><i></i><small>${l}</small>${times[k] ? `<em title="${time(times[k])}">${stamp(times[k])}</em>` : k === 0 && t.scheduledOn ? `<em>${day(t.scheduledOn)}</em>` : ''}</div>`).join('')}</div>
                <div class="bo-trip-facts">
                    ${t.vehicle ? `<div><span>Vehicle</span><b>${esc(t.vehicle)}${t.vehicleKind ? ` · ${esc(t.vehicleKind)}` : ''}</b></div>` : ''}
                    ${t.driver ? `<div><span>Driver</span><b>${esc(t.driver)}</b>${t.driverPhone ? `<a class="bo-call" href="tel:${esc(t.driverPhone)}">📞 Call</a>` : ''}</div>` : ''}
                    <div><span>Bricks</span><b>${t.items.map(x => `${esc(x.name)} ${count(x.delivered ?? x.quantity)}`).join(', ')}</b></div>
                    ${t.status === 'DELIVERED' ? `<div><span>This trip</span><b>${money(t.billed)}</b></div>` : ''}
                </div>
                ${t.ackAt ? `<div class="bo-acked">${t.ackSignature ? signatureSvg(t.ackSignature) : ''}<div><b>✅ Received by ${esc(t.ackName)}</b><small>${time(t.ackAt)} · seal ${esc(String(t.ackSeal || '').slice(0, 12))}…</small></div></div>`
                    : t.canAcknowledge ? `<button class="bo-btn primary" data-ack="${t.tripNo}">✍️ Confirm I received trip ${t.tripNo}</button>` : ''}
            </article>`;
        }).join('')}</section>`;
}

// ---------------------------------------------------------------- the bill

function billHtml() {
    const inv = o.invoice;
    return `<section class="sh-card bo-doc"><h2>${inv ? `Your invoice <small>${esc(inv.invoiceNo)} · paid in full</small>` : 'Your bill <small>the invoice comes once it is paid in full</small>'}</h2>
        <div class="bo-doc-wrap">${billDocHtml(billFromPublic(o))}</div>
        <button class="bo-btn" data-print>🖨️ ${inv ? 'Print or save the invoice' : 'Print or save the bill'}</button></section>`;
}

// ---------------------------------------------------------------- paying

const UPI_APPS = [
    { name: 'Google Pay', cls: 'gpay', pkg: 'com.google.android.apps.nbu.paisa.user', ios: 'gpay://upi/pay?' },
    { name: 'PhonePe', cls: 'phonepe', pkg: 'com.phonepe.app', ios: 'phonepe://pay?' },
    { name: 'Paytm', cls: 'paytm', pkg: 'net.one97.paytm', ios: 'paytmmp://pay?' },
    { name: 'BHIM', cls: 'bhim', pkg: 'in.org.npci.upiapp', ios: 'upi://pay?' },
];
const note = () => `${o.orderNo} ${o.customerName}`.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 40);
function upiQuery(amount) {
    return [['pa', o.upiId], ['pn', o.payeeName], ['am', Number(amount).toFixed(2)], ['cu', 'INR'], ['tn', note()]]
        .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}
const upiLink = amount => 'upi://pay?' + upiQuery(amount);
function appLink(app, amount) {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) {
        const store = encodeURIComponent(`https://play.google.com/store/apps/details?id=${app.pkg}`);
        return `intent://pay?${upiQuery(amount)}#Intent;scheme=upi;package=${app.pkg};S.browser_fallback_url=${store};end`;
    }
    if (/iPhone|iPad|iPod/i.test(ua)) return app.ios + upiQuery(amount);
    return null;
}

function payHtml() {
    const due = Number(o.payNow);
    if (!o.upiId || due <= 0 || o.status === 'CANCELLED') return '';
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return `<section class="sh-card bo-pay">
        <div class="bo-pay-main"><span>Pay now</span><b data-amount-shown>${money(due)}</b><small>to ${esc(o.payeeName)}</small>
            <label class="bo-amount">Amount <input type="number" inputmode="decimal" min="1" step="any" value="${due.toFixed(2)}" data-amount></label>
            <div class="cs-apps bo-apps">${UPI_APPS.map(app => {
                const href = appLink(app, due);
                return href ? `<a class="cs-app ${app.cls}" data-app="${app.cls}" href="${esc(href)}">${upiLogo(app.cls)}<span>Pay</span></a>`
                    : `<button type="button" class="cs-app ${app.cls}" data-desktop>${upiLogo(app.cls)}<span>Pay</span></button>`;
            }).join('')}</div>
            <a class="bo-btn" data-any href="${esc(upiLink(due))}">${upiLogo('upi')} Any UPI app</a>
            <div class="cs-upi-id"><span>UPI ID <b>${esc(o.upiId)}</b></span><button type="button" data-copy="${esc(o.upiId)}">Copy</button></div>
            <small class="bo-tip">${phone ? 'Tap your app: the amount and the order number are filled in. Check the name before you pay.' : 'On a computer: scan the code with your phone’s UPI app.'}</small>
        </div>
        <div class="bo-qr"><div data-qr>${qrSvg(upiLink(due), { size: 180 })}</div><small>Scan to pay</small></div>
        <details class="bo-paid"><summary>Already paid? Tell us</summary>
            <form data-paid><label>Amount paid <input type="number" inputmode="decimal" min="1" step="any" name="amount" value="${due.toFixed(2)}" required></label>
                <label>UPI reference / UTR <input name="reference" required minlength="6" placeholder="12-digit number from your app"></label>
                <button class="bo-btn primary">Send</button><p class="bo-err" data-paid-err></p></form></details>
    </section>`;
}

function claimedHtml() {
    const c = o.payments.filter(p => p.status === 'CLAIMED');
    if (!c.length) return '';
    return `<section class="sh-card bo-claimed">⏳ <div><b>${money(c.reduce((s, p) => s + Number(p.amount), 0))} payment reported</b><small>We will confirm it once it shows in our account.</small></div></section>`;
}

function paymentsHtml() {
    const posted = o.payments.filter(p => p.status !== 'CLAIMED');
    if (!posted.length) return '';
    return `<section class="sh-card bo-payments"><h2>Payments received</h2>${posted.map(p => `<div><span>${esc(p.receiptNo || '')} · ${day(p.receivedOn)} · ${esc(p.mode)}</span><b>${money(p.amount)}</b></div>`).join('')}</section>`;
}

function aboutHtml() {
    return `<section class="sh-card bo-about"><h2>Delivery to</h2><p>${esc(o.customerName)}<br>${esc(o.deliverTo || '')}${o.landmark ? `<br><small>near ${esc(o.landmark)}</small>` : ''}</p>
        <p class="bo-from"><b>${esc(o.company)}</b>${o.address ? `<br>${esc(o.address)}` : ''}${o.phone ? `<br><a href="tel:${esc(o.phone)}">📞 ${esc(o.phone)}</a>` : ''}</p>
        <small class="muted">Updated ${time(o.asOf)} · this link works until ${time(o.expiresAt)}</small></section>`;
}

// ---------------------------------------------------------------- actions

function bind(main) {
    main.querySelector('[data-amount]')?.addEventListener('input', e => {
        const v = Number(e.target.value);
        if (!(v > 0)) return;
        main.querySelector('[data-amount-shown]').textContent = money(v);
        main.querySelectorAll('[data-app]').forEach(a => { a.href = appLink(UPI_APPS.find(x => x.cls === a.dataset.app), v); });
        main.querySelector('[data-any]').href = upiLink(v);
        main.querySelector('[data-qr]').innerHTML = qrSvg(upiLink(v), { size: 180 });
    });
    main.addEventListener('click', async e => {
        const copy = e.target.closest('[data-copy]');
        if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copied'; } catch { /* nothing */ } }
        if (e.target.closest('[data-desktop]')) main.querySelector('.bo-tip').classList.add('flash');
        if (e.target.closest('[data-print]')) printDoc(billDocHtml(billFromPublic(o)), o.invoice ? o.invoice.invoiceNo : o.orderNo);
        const ack = e.target.closest('[data-ack]');
        if (ack) openAck(Number(ack.dataset.ack));
    });
    main.querySelector('[data-paid]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('button');
        btn.disabled = true;
        try {
            o = await call('/paid', { amount: Number(f.amount.value), reference: f.reference.value.trim(), app: 'link' });
            draw();
        } catch (err) { f.querySelector('[data-paid-err]').textContent = err.message; btn.disabled = false; }
    });
}

function openAck(tripNo) {
    const t = o.trips.find(x => x.tripNo === tripNo);
    const sheet = document.createElement('div');
    sheet.className = 'bo-sheet';
    sheet.innerHTML = `<div class="bo-sheet-card" role="dialog" aria-modal="true">
        <h2>Confirm you received trip ${tripNo}</h2>
        <p>${t.items.map(x => `${esc(x.name)} <b>${count(x.delivered ?? x.quantity)}</b>`).join(', ')}${t.vehicle ? ` · ${esc(t.vehicle)}` : ''}</p>
        <label>Your name <input name="name" value="${esc(o.customerName)}" required></label>
        <div class="bond-pad"><div class="bond-pad-head"><span>Sign here with your finger</span><button type="button" data-clear>Clear</button></div><canvas width="1000" height="300"></canvas></div>
        <label>Anything to note (broken bricks, short count)? <input name="remarks" maxlength="300"></label>
        <p class="bo-small">Your signature, the time, this phone and (if you allow) your location are kept as proof of delivery.</p>
        <p class="bo-err" data-err></p>
        <div class="bo-sheet-acts"><button class="bo-btn" data-cancel>Not now</button><button class="bo-btn primary" data-send>✍️ Confirm receipt</button></div></div>`;
    document.body.appendChild(sheet);
    const pad = signaturePad(sheet.querySelector('canvas'));
    const where = locate();
    sheet.querySelector('[data-clear]').addEventListener('click', () => pad.clear());
    sheet.querySelector('[data-cancel]').addEventListener('click', () => sheet.remove());
    sheet.addEventListener('mousedown', e => { if (e.target === sheet) sheet.remove(); });
    sheet.querySelector('[data-send]').addEventListener('click', async e => {
        const err = sheet.querySelector('[data-err]');
        const name = sheet.querySelector('[name=name]').value.trim();
        if (name.length < 2) { err.textContent = 'Type your name'; return; }
        if (pad.empty()) { err.textContent = 'Please sign in the box'; return; }
        e.target.disabled = true;
        e.target.textContent = 'Sending…';
        try {
            o = await call('/acknowledge', { tripNo, name, signature: pad.path(), location: await where, device: JSON.stringify(deviceInfo()),
                remarks: sheet.querySelector('[name=remarks]').value.trim() || null });
            sheet.remove();
            draw();
            celebrate();
        } catch (x) { err.textContent = x.message; e.target.disabled = false; e.target.textContent = '✍️ Confirm receipt'; }
    });
}

function celebrate() {
    const c = document.createElement('div');
    c.className = 'bo-confetti';
    c.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="--x:${Math.random() * 100}vw;--d:${0.6 + Math.random() * 0.9}s;--r:${Math.random() * 360}deg;--c:${['#b4532a', '#1baf7a', '#eda100', '#2a78d6'][i % 4]}"></i>`).join('')
        + '<b>Thank you! Receipt confirmed ✅</b>';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2600);
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Brick order</h1><p>${esc(text)}</p></section>`;
}

start();
window.addEventListener('hashchange', () => location.reload());
