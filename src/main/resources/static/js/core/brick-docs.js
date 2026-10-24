/**
 * The brick business's documents, one look for all: the bill of an order (and, once it is paid in full, its invoice) and
 * the payment slip of a team or a person. Each has the company's letterhead, the round seal, the owner's and the
 * accountant's signatures and, when signed, the digital signature with a QR code to check it. Used by the app, by the
 * customer's order link and for printing; it needs nothing of the app but core/bond.js and core/qr.js.
 *
 *   billDocHtml(doc)       doc from billFromView(orderView) or billFromPublic(publicOrder)
 *   slipDocHtml(slipView)
 *   verifyDoc(root, payload, signature, publicKey)   fills the "checking…" mark with the result
 *   printDoc(html, title)  prints a document on its own page
 */
import { esc, signatureSvg, sealSvg, verifyEvidence } from './bond.js';
import { qrSvg } from './qr.js';

const rupees = v => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = v => '₹' + Math.round(Number(v || 0)).toLocaleString('en-IN');
const count = v => Number(v || 0).toLocaleString('en-IN');
const day = iso => iso ? new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const when = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const role = r => String(r || '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="11" width="40" height="26" rx="3" fill="currentColor" opacity=".18"/>
    <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="4" y="11" width="40" height="26" rx="3"/><path d="M4 24h40M17 11v13M31 11v13M24 24v13M10 24v13M38 24v13"/></g></svg>`;

/** "Rupees Twelve Thousand Five Hundred only" (Indian grouping). */
export function inWords(amount) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
        'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    const three = n => (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
    let n = Math.floor(Math.abs(Number(amount || 0)));
    const paise = Math.round((Math.abs(Number(amount || 0)) - n) * 100);
    if (!n && !paise) return 'Rupees Zero only';
    const parts = [];
    [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']].forEach(([d, w]) => { if (n >= d) { parts.push(`${two(Math.floor(n / d)) || three(Math.floor(n / d))} ${w}`); n %= d; } });
    if (n) parts.push(three(n));
    return `Rupees ${parts.join(' ')}${paise ? ` and ${two(paise)} Paise` : ''} only`;
}

function letterhead(c, title, no, date, extra = '') {
    return `<header class="bd-brand">
        ${c.logo ? `<div class="bd-logo own"><img src="${esc(c.logo)}" alt=""></div>` : `<div class="bd-logo">${LOGO}</div>`}
        <div class="bd-co"><b>${esc(c.name || '')}</b>${c.address ? `<small>${esc(c.address)}</small>` : ''}${c.phone ? `<small>Phone ${esc(c.phone)}</small>` : ''}</div>
        <div class="bd-title"><span>${esc(title)}</span><b>${esc(no)}</b><small>${esc(date)}</small>${extra}</div>
    </header>`;
}

function signatures(c, first) {
    return `<footer class="bd-sign">
        ${first}
        <div class="bd-sig">${c.accountantSignature ? signatureSvg(c.accountantSignature) : '<i class="bd-space"></i>'}<b>${esc(c.accountantName || 'Accountant')}</b><small>Accountant</small></div>
        <div class="bd-sig stamp"><span class="bd-seal">${sealSvg(c.name, 'SEAL')}</span>${c.ownerSignature ? signatureSvg(c.ownerSignature) : '<i class="bd-space"></i>'}
            <b>${esc(c.ownerName || 'Authorised signatory')}</b><small>For ${esc(c.name || '')}</small></div>
    </footer>`;
}

function digital(payload, signature, fingerprint, qrText, note) {
    if (!signature) return `<div class="bd-verify unsigned"><span>${note || ''}</span></div>`;
    return `<div class="bd-verify"><div class="bd-qr">${qrSvg(qrText, { size: 76 })}</div>
        <div><b><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
            Digitally signed</b> <span data-verify class="bd-checking">checking…</span>
            <small>ECDSA P-256 · key ${esc(fingerprint || '')}</small><small class="bd-sigtext">${esc(String(signature).slice(0, 64))}…</small>${note ? `<small>${note}</small>` : ''}</div></div>`;
}

// ===================================================================== bill and invoice

/** The order as a document from the app's order view. */
export function billFromView(v) {
    const o = v.order;
    return {
        company: v.company, orderNo: o.orderNo, orderDate: o.orderDate, requiredBy: o.requiredBy, status: o.status, statusLabel: v.statusLabel,
        customer: { name: o.customerName, phone: o.customerPhone, address: o.address, landmark: o.landmark },
        items: v.items, totals: v.totals, deliveryWaived: o.deliveryWaived, waiveReason: o.waiveReason, handlingBilled: o.handlingBilled,
        transporterPaid: o.hired && o.hiredPaidBy !== 'US',
        trips: v.trips.filter(t => t.trip.status !== 'CANCELLED').map(t => ({ tripNo: t.trip.tripNo, status: t.trip.status, vehicle: t.vehicle,
            deliveredAt: t.trip.deliveredAt, quantity: t.delivered ?? t.quantity, ackName: t.trip.ackName })),
        payments: v.payments.map(p => ({ receiptNo: p.payment.receiptNo, receivedOn: p.payment.receivedOn, mode: p.payment.mode, amount: p.payment.amount, status: p.payment.status })),
        invoice: v.invoice, publicKey: v.publicKey, fingerprint: v.keyFingerprint,
    };
}

/** The order as a document from the customer's link. */
export function billFromPublic(o) {
    return {
        company: o.seller, orderNo: o.orderNo, orderDate: o.orderDate, requiredBy: o.requiredBy, status: o.status, statusLabel: o.statusLabel,
        customer: { name: o.customerName, phone: o.customerPhone, address: o.deliverTo, landmark: o.landmark },
        items: o.items, totals: o.totals, deliveryWaived: o.deliveryWaived, waiveReason: o.waiveReason, handlingBilled: o.handlingBilled,
        transporterPaid: !!o.transporterPaid,
        trips: o.trips.map(t => ({ tripNo: t.tripNo, status: t.status, vehicle: t.vehicle, deliveredAt: t.deliveredAt, quantity: t.delivered ?? t.quantity, ackName: t.ackName })),
        payments: o.payments, invoice: o.invoice, publicKey: o.publicKey, fingerprint: o.keyFingerprint,
    };
}

/** The bill (an order not yet paid in full) or the invoice (paid): lines, discount below MRP, delivery, payments, balance. */
export function billDocHtml(d) {
    const t = d.totals, inv = d.invoice;
    const delivered = d.status === 'DELIVERED';
    const qtyOf = i => delivered ? i.delivered : i.quantity;
    const posted = (d.payments || []).filter(p => p.status !== 'CLAIMED');
    const balance = Number(t.balance);
    const stamp = d.status === 'CANCELLED' ? ['void', 'CANCELLED'] : inv ? ['paid', 'PAID'] : Number(t.paid) > 0 ? ['part', 'PART PAID'] : ['due', 'DUE'];
    const title = inv ? 'Tax invoice' : 'Bill';
    const verifyText = inv ? `${inv.invoiceNo} | ${d.orderNo} | ${whole(t.total)} | key ${d.fingerprint} | sig ${String(inv.signature).slice(0, 24)}` : '';
    return `<article class="bd-doc ${inv ? 'invoice' : 'bill'}">
        <div class="bd-watermark">${LOGO}</div>
        <div class="bd-stamp ${stamp[0]}">${stamp[1]}</div>
        ${letterhead(d.company, title, inv ? inv.invoiceNo : d.orderNo, inv ? `Issued ${day(inv.issuedAt)}` : `Order date ${day(d.orderDate)}`,
            inv ? `<small>Order ${esc(d.orderNo)}</small>` : '')}
        <section class="bd-parties">
            <div><small>Billed to</small><b>${esc(d.customer.name)}</b>${d.customer.phone ? `<span>Mobile ${esc(d.customer.phone)}</span>` : ''}
                ${d.customer.address ? `<span>${esc(d.customer.address)}${d.customer.landmark ? `, near ${esc(d.customer.landmark)}` : ''}</span>` : ''}</div>
            <div><small>Order</small><b>${esc(d.orderNo)}</b><span>${esc(d.statusLabel || '')}${d.requiredBy ? ` · needed by ${day(d.requiredBy)}` : ''}</span></div>
            <div><small>Delivery</small><b>${(d.trips || []).length} trip${(d.trips || []).length === 1 ? '' : 's'}</b>
                <span>${count(t.delivered)} of ${count(t.quantity)} bricks delivered</span></div>
        </section>
        <table class="bd-lines"><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
            <tbody>${d.items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.name)}</b>${Number(i.discount) ? `<small>${Number(i.discountPercent).toFixed(1)}% below MRP</small>` : ''}</td>
                <td class="r">${count(qtyOf(i))}</td><td class="r">${i.mrp ? rupees(i.mrp) : '—'}</td><td class="r">${rupees(i.price)}</td>
                <td class="r">${rupees(Number(i.price) * Number(qtyOf(i)))}</td></tr>`).join('')}</tbody></table>
        <section class="bd-totals">
            <div class="bd-words"><small>Amount in words</small><b>${esc(inWords(t.total))}</b>
                ${d.transporterPaid ? '<p class="bd-free">Transport by a hired vehicle: its charges are paid to the transporter directly, not on this bill.</p>' : ''}
                ${d.deliveryWaived && !d.transporterPaid ? `<p class="bd-free">Free delivery${d.waiveReason ? ` — ${esc(d.waiveReason)}` : ''}</p>` : ''}
                ${posted.length ? `<div class="bd-receipts"><small>Payments received</small>${posted.map(p => `<span>${esc(p.receiptNo || '')} · ${day(p.receivedOn)} · ${esc(p.mode || '')}<b>${rupees(p.amount)}</b></span>`).join('')}</div>` : ''}</div>
            <dl>
                ${Number(t.discount) ? `<div><dt>At MRP</dt><dd>${rupees(t.atMrp)}</dd></div><div class="disc"><dt>Discount</dt><dd>− ${rupees(t.discount)}</dd></div>` : ''}
                <div><dt>Bricks</dt><dd>${rupees(delivered ? Number(t.billed) - Number(t.delivery) - Number(t.handling) : t.bricks)}</dd></div>
                ${d.transporterPaid ? `<div><dt>Delivery (${t.trips} trip${t.trips === 1 ? '' : 's'})</dt><dd><span class="bd-free-tag">TO TRANSPORTER</span></dd></div>`
                    : d.deliveryWaived && Number(t.deliveryGross) ? `<div><dt>Delivery (${t.trips} trip${t.trips === 1 ? '' : 's'})</dt><dd>${rupees(t.deliveryGross)}</dd></div>
                        <div class="disc"><dt>Free delivery</dt><dd>− ${rupees(t.deliveryGross)}</dd></div>`
                    : `<div><dt>Delivery (${t.trips} trip${t.trips === 1 ? '' : 's'})</dt><dd>${d.deliveryWaived ? '<span class="bd-free-tag">FREE</span>' : rupees(t.delivery)}</dd></div>`}
                ${Number(t.handling) ? `<div><dt>Loading &amp; unloading</dt><dd>${rupees(t.handling)}</dd></div>` : ''}
                <div class="grand"><dt>Total</dt><dd>${rupees(t.total)}</dd></div>
                <div><dt>Paid</dt><dd>${rupees(t.paid)}</dd></div>
                <div class="${balance > 0 ? 'due' : 'clear'}"><dt>${balance >= 0 ? 'Balance due' : 'Advance with us'}</dt><dd>${rupees(Math.abs(balance))}</dd></div>
            </dl>
        </section>
        ${signatures(d.company, `<div class="bd-sig"><i class="bd-space"></i><b>${esc(d.customer.name)}</b><small>Customer</small></div>`)}
        ${digital(inv?.payload, inv?.signature, d.fingerprint, verifyText, inv ? '' : 'This is a bill. The digitally signed invoice is issued once the order is paid in full.')}
        <p class="bd-thanks">Thank you for your business${d.company.upiId ? ` · Pay by UPI to ${esc(d.company.upiId)}` : ''}</p>
    </article>`;
}

// ===================================================================== payment slip

const KIND_ORDER = ['PRODUCTION', 'LOADING', 'UNLOADING', 'TRIP', 'WAGE', 'SALARY', 'BONUS'];

/** A payment slip (weekly / monthly) or an advance slip, from the app's slip view. */
export function slipDocHtml(v) {
    const s = v.slip, r = v.resource || {}, c = v.company;
    const advance = s.kind === 'ADVANCE';
    const cancelled = s.status === 'CANCELLED';
    // a slip worked out but not paid yet (the phone shows it before the payment is recorded)
    const draft = s.status === 'DRAFT';
    const groups = KIND_ORDER.map(k => [k, v.lines.filter(l => l.kind === k)]).filter(([, l]) => l.length);
    const verifyText = `${s.slipNo} | ${whole(s.net)} | ${s.paidOn} | key ${v.keyFingerprint} | sig ${String(s.digitalSignature || '').slice(0, 24)}`;
    const initials = String(r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<article class="bd-doc slip ${cancelled ? 'cancelled' : ''}">
        <div class="bd-watermark">${LOGO}</div>
        ${cancelled ? '<div class="bd-stamp void">CANCELLED</div>' : draft ? '<div class="bd-stamp due">DRAFT</div>' : `<div class="bd-stamp paid">${advance ? 'ADVANCE' : 'PAID'}</div>`}
        ${letterhead(c, advance ? 'Advance slip' : 'Payment slip', s.slipNo, draft ? `To be paid ${day(s.paidOn)}` : `Paid ${day(s.paidOn)}`)}
        <section class="bd-payee">
            <span class="bd-avatar">${esc(initials)}</span>
            <div class="bd-payee-main"><b>${esc(r.name || '')}</b><span>${esc(role(r.role))}${r.kind === 'TEAM' ? ` · team${r.memberCount ? ` of ${r.memberCount}` : ''}` : ''}</span>
                ${r.members ? `<small>${esc(r.members)}</small>` : ''}</div>
            <dl class="bd-facts">
                ${advance ? `<div><dt>Reason</dt><dd>${esc(s.narrative || '')}</dd></div><div><dt>Recovery</dt><dd>${s.recoverPerCycle ? `${whole(s.recoverPerCycle)} a ${r.salaryType === 'MONTHLY' ? 'month' : 'week'}` : 'from the next payment'}</dd></div>`
                    : `<div><dt>Pay period</dt><dd>${day(s.periodFrom)} – ${day(s.periodTo)}</dd></div><div><dt>Cycle</dt><dd>${s.kind === 'MONTHLY' ? 'Monthly' : 'Weekly'}</dd></div>`}
                <div><dt>Paid by</dt><dd>${esc(s.mode || '')}${s.reference ? ` · ${esc(s.reference)}` : ''}</dd></div>
                ${v.account ? `<div><dt>From</dt><dd>${esc(v.account)}</dd></div>` : ''}
            </dl>
        </section>
        ${advance ? '' : `<table class="bd-lines slip"><thead><tr><th>Earnings</th><th>Date</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
            <tbody>${groups.map(([k, list]) => `<tr class="bd-group"><td colspan="3">${esc(list[0].label)}</td><td class="r">${rupees(list.reduce((a, l) => a + Number(l.amount), 0))}</td></tr>
                ${list.map(l => `<tr><td><span class="bd-narr">${esc(l.narrative || l.label)}</span></td><td>${day(l.earnedOn)}</td><td class="r">${l.quantity ? count(l.quantity) : ''}</td><td class="r">${rupees(l.amount)}</td></tr>`).join('')}`).join('')}</tbody>
            <tfoot><tr><td colspan="3">Gross earnings</td><td class="r">${rupees(s.gross)}</td></tr></tfoot></table>`}
        ${v.deductions.length ? `<section class="bd-deduct"><h3>Deductions · advances recovered</h3>${v.deductions.map(d => `<div class="bd-ded-row">
            <div><b>${esc(d.advanceNo)}</b> given ${day(d.givenOn)} · ${whole(d.advanceAmount)}<small>“${esc(d.narrative || '')}”</small></div>
            <div class="bd-ded-bar"><i style="width:${Math.min(100, (1 - Number(d.balanceAfter) / Number(d.advanceAmount || 1)) * 100)}%"></i></div>
            <div class="r"><span>owed ${whole(d.outstandingBefore)}</span><b>− ${rupees(d.amount)}</b><small>still owed ${whole(d.balanceAfter)}</small></div></div>`).join('')}</section>` : ''}
        ${advance && v.recoveredOn.length ? `<section class="bd-deduct"><h3>Recovered so far</h3>${v.recoveredOn.map(d => `<div class="bd-ded-row"><div><b>${esc(d.advanceNo)}</b> · ${day(d.givenOn)}</div><div></div>
            <div class="r"><b>${rupees(d.amount)}</b><small>${whole(d.balanceAfter)} left</small></div></div>`).join('')}</section>` : ''}
        <section class="bd-net">
            <div class="bd-net-parts">${advance ? '' : `<span>Gross <b>${rupees(s.gross)}</b></span>${Number(s.deductions) ? `<span>Deductions <b>− ${rupees(s.deductions)}</b></span>` : ''}`}</div>
            <div class="bd-net-box"><small>${advance ? 'Advance given' : draft ? 'Net to pay' : 'Net paid'}</small><b>${rupees(s.net)}</b><em>${esc(v.inWords || inWords(s.net))}</em></div>
        </section>
        ${s.narrative && !advance ? `<p class="bd-note">${esc(s.narrative)}</p>` : ''}
        ${signatures(c, `<div class="bd-sig"><i class="bd-space"></i><b>${esc(r.name || '')}</b><small>Received by (signature / thumb)</small></div>`)}
        ${draft ? '<div class="bd-verify unsigned"><span>A draft: the slip is numbered and digitally signed when the payment is recorded.</span></div>' : digital(s.payload, s.digitalSignature, v.keyFingerprint, verifyText,
            `Issued by ${esc(s.createdBy || '')} on ${when(s.createdAt)}${v.entryNo ? ` · journal ${esc(v.entryNo)}` : ''}${cancelled ? ` · cancelled ${when(s.cancelledAt)} by ${esc(s.cancelledBy || '')}` : ''}`)}
    </article>`;
}

// ===================================================================== checking and printing

/** Checks a document's digital signature here (WebCrypto) and shows the result on it. */
export async function verifyDoc(root, payload, signature, publicKey) {
    const el = root.querySelector('[data-verify]');
    if (!el) return;
    const ok = await verifyEvidence(payload, signature, publicKey);
    el.className = ok === true ? 'bd-ok' : ok === false ? 'bd-bad' : 'bd-checking';
    el.textContent = ok === true ? '✓ verified' : ok === false ? '✗ does not match: do not trust this copy' : '(this browser cannot check it)';
}

/**
 * The printed sheet: the document laid out at the page's printable width (A4 less 10 mm margins: 190 × 277 mm), packed
 * tighter when long and scaled down just enough that all of it fits on one page (never split over two). Shared by
 * printDoc and the phone app's print (brick-doc.html), so a printed copy looks the same from either.
 */
export const PRINT_CSS = `
            @page { size: A4 portrait; margin: 10mm; }
            html, body { margin: 0; padding: 0; background: #fff; }
            /* 190 mm of printable width; the sheet's height (277 mm) is what it is fitted into */
            .bd-doc { box-shadow: none; margin: 0 auto; width: 190mm; max-width: none; box-sizing: border-box; }
            .bd-sheet { width: 190mm; margin: 0 auto; overflow: hidden; }
            @media print { .bd-doc, .bd-doc * { break-inside: avoid; page-break-inside: avoid; } .bd-sheet { height: 276mm; } }
            /* a long document first packs tighter (rows on one line, less air), and is scaled only for what is still over */
            .bd-dense.bd-doc { padding: 16px 20px 12px; line-height: 1.3; }
            .bd-dense .bd-brand { padding-bottom: 8px; margin-bottom: 8px; }
            .bd-dense .bd-parties { margin-bottom: 8px; }
            .bd-dense .bd-parties > div { padding: 4px 8px; }
            .bd-dense .bd-lines { font-size: 11px; }
            .bd-dense .bd-lines th { padding: 3px 6px; }
            .bd-dense .bd-lines td { padding: 2px 6px; }
            .bd-dense .bd-lines td small { display: inline; margin-left: 4px; }
            .bd-dense .bd-lines td:not(:first-child) { white-space: nowrap; }
            .bd-dense .bd-totals, .bd-dense .bd-net { margin-top: 8px; }
            .bd-dense .bd-sign { margin-top: 16px; }
            .bd-dense .bd-verify { margin-top: 8px; padding: 6px 0 4px; }
            .bd-dense .bd-watermark { display: none; }`;

/** Fits the document on the sheet (as source, to run in the printing window). */
export const FIT_SCRIPT = `function fit() {
                var doc = document.querySelector('.bd-doc');
                var probe = document.createElement('div');
                probe.style.cssText = 'position:absolute;visibility:hidden;height:276mm;width:1px';
                document.body.appendChild(probe);
                var room = probe.getBoundingClientRect().height;
                probe.remove();
                doc.style.zoom = 1;
                doc.classList.remove('bd-dense');
                var h = doc.getBoundingClientRect().height;
                if (h > room) { doc.classList.add('bd-dense'); h = doc.getBoundingClientRect().height; }
                if (h > room) doc.style.zoom = Math.floor((room / h) * 1000) / 1000;
            }`;

/** Prints a document on one A4 sheet (see PRINT_CSS). */
export function printDoc(html, title) {
    const win = window.open('', '_blank', 'width=860,height=1100');
    if (!win) return false;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
        <link rel="stylesheet" href="${location.origin}/css/theme.css"><link rel="stylesheet" href="${location.origin}/css/bond.css">
        <link rel="stylesheet" href="${location.origin}/css/brick-docs.css">
        <style>${PRINT_CSS}
        </style></head>
        <body class="bd-print"><div class="bd-sheet">${html.replace(/<span data-verify[^>]*>[^<]*<\/span>/, '')}</div>
        <script>
            ${FIT_SCRIPT}
            window.onload = function () {
                (document.fonts ? document.fonts.ready : Promise.resolve()).then(function () {
                    fit();
                    setTimeout(function () { fit(); window.print(); }, 300);
                });
            };
        <\/script></body></html>`);
    win.document.close();
    return true;
}
