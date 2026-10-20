/**
 * Brick sales: the order form (the customer, the bricks at an agreed price against the MRP, the vehicle that decides
 * the trips, the teams, delivery charges and their waiver), and an order's page: its lifecycle, each trip moving from
 * planned to delivered (fewer delivered when some broke), the bill, payments (and those the customer reported on the
 * link) and the links shared with the customer.
 */
import { api, session } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { openOn, heldTag } from '../core/pending.js';
import { esc, field, readForm, openModal, toast, confirmDialog, loadingDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime, shortDate } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { signatureSvg, deviceName, verifyEvidence } from '../core/bond.js';
import { billDocHtml, billFromView, verifyDoc, printDoc } from '../core/brick-docs.js';
import { loadMeta, num, count, today, moneyAccounts, moneyOptions, resourceOptions, vehicleOptions, orderBadge, tripBadge, TRIP_STEPS,
    manage, confirmDelete, plural, rowsHtml, bindRows, initials, guard, suggest, factsHtml, journalPeek, bcan } from './brick-common.js';

// ===================================================================== the order form

const PAID_BY = [['CUSTOMER', 'The customer', 'pays the transporter directly; not on our bill'], ['US', 'We pay it', 'it goes on the customer’s bill']];

/**
 * An order, laid out as a production batch is: on the left the customer, the bricks (each type with what is free in the
 * yard) and the delivery (our vehicle or one hired, the trips, the teams, the charges); on the right what it comes to as
 * it is typed: the stock check, the trips planned and the bill.
 */
export async function openOrder(view, after) {
    const got = await loadingDialog(view ? 'Opening the order…' : 'Getting the order ready…',
        () => Promise.all([loadMeta(true), api.get('/bricks/customers').catch(() => []), api.get('/bricks/production').catch(() => null)]));
    if (!got) return;
    const [meta, customers, prod] = got;
    const o = view?.order || { orderDate: today() };
    const s = meta.settings;
    const types = meta.types.filter(t => t.active || (view?.items || []).some(i => i.brickTypeId === t.id));
    const items = view ? view.items.map(i => ({ brickTypeId: i.brickTypeId, quantity: i.quantity, price: i.price }))
        : [{ brickTypeId: types[0]?.id, quantity: '', price: types[0]?.mrp ?? '' }];
    // free in the yard now, a type: an order being changed gets back what it booked and has not taken away yet
    const freeOf = id => {
        const st = (prod?.stock || []).find(x => x.brickTypeId === Number(id));
        if (!st) return null;
        const mine = view?.items.find(i => i.brickTypeId === Number(id));
        return st.available + (mine ? (mine.pending || 0) + (mine.planned || 0) : 0);
    };
    const firstVehicle = meta.vehicles.find(v => v.active);
    const hired0 = !!o.hired || (!view && !firstVehicle);
    const paidBy0 = o.hiredPaidBy || 'CUSTOMER';
    const typeOpts = sel => types.map(t => {
        const free = freeOf(t.id);
        const meta = [free === null ? '' : free > 0 ? `${count(free)} free in the yard` : 'none free in the yard', t.mrp !== null && t.mrp !== undefined ? `MRP ₹${num(t.mrp)}` : 'no MRP'].filter(Boolean).join(' · ');
        return `<option value="${t.id}" data-meta="${esc(meta)}" ${String(t.id) === String(sel) ? 'selected' : ''}>${esc(t.name)}</option>`;
    }).join('');
    // the teams a new order starts with: the default production team loads (and unloads our own vehicle); a hired vehicle
    // is unloaded by the customer / transporter unless our team is picked
    const makers = meta.resources.filter(r => r.active && String(r.role || '').includes('PRODUCTION'));
    const maker0 = (makers.find(r => r.defaultTeam) || (makers.length === 1 ? makers[0] : null))?.id ?? null;
    const loading0 = view ? o.loadingTeamId : maker0;
    const unloading0 = view ? (o.unloadingOutside ? 'outside' : o.unloadingTeamId ?? '') : hired0 ? 'outside' : maker0 ?? '';
    const TEAM_ROLES = ['PRODUCTION_TEAM', 'LOADING_TEAM'];
    const row = it => `<tr data-row>
        <td><select data-type data-search>${typeOpts(it.brickTypeId)}</select><small class="bk-free" data-free></small></td>
        <td><input type="number" min="1" step="1" class="num" data-qty value="${esc(it.quantity ?? '')}" placeholder="0" required></td>
        <td><input type="number" min="0" step="any" class="num" data-price value="${esc(it.price ?? '')}" required><small class="bk-free" data-mrp></small></td>
        <td class="r"><b data-amt>—</b><small class="bk-free" data-disc></small></td>
        <td><button type="button" class="btn sm ghost icon danger" data-remove title="Take it off">${icon('x')}</button></td></tr>`;
    const unloadOpts = sel => resourceOptions(meta.resources, sel === 'outside' ? null : sel, { roles: TEAM_ROLES, placeholder: 'Choose who unloads',
        extra: `<option value="outside" data-meta="not ours: nothing earned or billed for it" ${sel === 'outside' ? 'selected' : ''}>Customer / transporter</option>` });
    openModal({
        title: view ? `Edit ${o.orderNo}` : 'New order', iconName: 'cart', size: 'xl bk-batch-modal bk-order-modal bk-tinted',
        sub: view ? 'Trips not on their way yet are planned again' : 'Who it is for, the bricks and how they are delivered',
        body: `<form class="bkb bko bk-compact" autocomplete="off" onsubmit="return false"><div class="bkb-left">
            <div class="bkb-head">
                <span class="chip-icon">${icon('cart')}</span>
                <div class="grow min-0"><b data-h-name>${esc(o.customerName || 'New customer')}</b><small data-h-note></small></div>
                <div class="bkb-head-amt"><small>Order total</small><b data-h-total>₹0</b></div>
            </div>

            <section class="bko-sec s-customer"><div class="bko-sec-h">${icon('user')}<b>Customer</b><small>who is buying, where and when</small></div>
            <div class="bko-grid bko-cols4">
                <label class="field"><span>Name *</span><input name="customerName" required value="${esc(o.customerName || '')}" placeholder="Who is buying"></label>
                <label class="field"><span>Mobile</span><input name="customerPhone" inputmode="tel" value="${esc(o.customerPhone || '')}" placeholder="10 digits"></label>
                <label class="field"><span>Order date *</span><input type="date" name="orderDate" required value="${esc(o.orderDate)}"></label>
                <label class="field"><span>Needed by</span><input type="date" name="requiredBy" value="${esc(o.requiredBy || '')}"></label>
                <label class="field bko-span3"><span>Deliver to (address)</span><input name="address" value="${esc(o.address || '')}" placeholder="Plot, street, area"></label>
                <label class="field"><span>Landmark</span><input name="landmark" value="${esc(o.landmark || '')}"></label>
            </div></section>

            <section class="bko-sec s-bricks"><div class="bko-sec-h">${icon('brick')}<b>Bricks</b><small>what is free in the yard shows under each type</small>
                <button type="button" class="link-btn" data-add-row>${icon('plus')}Another type</button></div>
            <table class="grid compact bkb-table bko-items"><thead><tr><th>Type</th><th>Quantity</th><th>Agreed price (₹)</th><th class="r">Amount</th><th></th></tr></thead>
                <tbody>${items.map(row).join('')}</tbody></table></section>

            <section class="bko-sec s-charges"><div class="bko-sec-h">${icon('tag')}<b>Charges &amp; note</b><small>delivery, handling and anything to remember</small></div>
            <div class="bko-charges">
                <label class="field" data-charge-wrap><span data-charge-label>Delivery charge a trip (₹)</span><input type="number" name="deliveryChargePerTrip" min="0" step="any" class="num"
                    value="${esc(o.deliveryChargePerTrip ?? s.deliveryChargePerTrip ?? '')}"></label>
                <label class="check-line bko-switch" data-waive-box><input type="checkbox" name="waiveDelivery" ${o.deliveryWaived ? 'checked' : ''}>
                    <span><b>Free delivery</b><small class="muted">shown on the bill, then taken off</small></span></label>
                <label class="check-line bko-switch"><input type="checkbox" name="handlingBilled" ${(view ? o.handlingBilled : s.billHandling) ? 'checked' : ''}>
                    <span><b>Bill loading &amp; unloading</b><small class="muted" data-handling-rate></small></span></label>
            </div>
            <label class="field" data-waive-reason ${o.deliveryWaived ? '' : 'hidden'}><span>Why is delivery free</span><input name="waiveReason" value="${esc(o.waiveReason || '')}" placeholder="Regular customer"></label>
            <label class="field"><span>Note</span><input name="note" maxlength="500" value="${esc(o.note || '')}" placeholder="Anything the driver or the yard should know"></label>
            ${bcan('APPROVE') ? '' : `<div class="bko-checker" data-checker hidden><small data-checker-why></small>
                <label class="field"><span>Note for the checker</span><input name="checkerNote" maxlength="300" placeholder="Why this price or change"></label></div>`}
            </section>
        </div>
        <aside class="bkb-right bko-right">
            <section class="bko-sec s-delivery"><div class="bko-sec-h">${icon('truck')}<b>Delivery</b><small>the vehicle, the teams and the trips</small></div>
            <div class="bk-choice two" role="radiogroup">
                <button type="button" class="${hired0 ? '' : 'on'}" data-transport="own">${icon('truck')}<b>Our vehicle</b><small>One of the vehicles enrolled</small></button>
                <button type="button" class="${hired0 ? 'on' : ''}" data-transport="hired">${icon('key')}<b>Hired from outside</b><small>Not enrolled: for this order only</small></button></div>
            <input type="hidden" name="hired" value="${hired0}">
            <div class="bko-grid bko-cols2" data-own ${hired0 ? 'hidden' : ''}>
                <label class="field bko-span2"><span>Vehicle</span><select name="vehicleId" data-search>${vehicleOptions(meta.vehicles, o.vehicleId ?? firstVehicle?.id).replace(/(<option value="(\d+)")/g, (m, all, id) => {
                    const v = meta.vehicles.find(x => String(x.id) === id);
                    return v ? `${all} data-meta="${esc(`${count(v.capacity)} bricks a trip · ${v.companyOwned === false ? 'hired regularly' : 'company'}${v.driverId ? ` · ${meta.resources.find(r => r.id === v.driverId)?.name || ''}` : ''}`)}"` : all;
                })}</select></label>
                <label class="field"><span>Driver</span><select name="driverId" data-search>${resourceOptions(meta.resources, o.driverId, { roles: ['DRIVER'], placeholder: 'The vehicle’s driver' })}</select></label>
            </div>
            <div class="bko-hired" data-hired ${hired0 ? '' : 'hidden'}>
                <div class="bko-grid bko-cols2">
                    <label class="field"><span>Vehicle no.</span><input name="hiredVehicle" value="${esc(o.hiredVehicle || '')}" placeholder="TS 07 AB 1234"></label>
                    <label class="field"><span>Transporter / driver</span><input name="hiredContact" value="${esc(o.hiredContact || '')}" placeholder="Name and mobile"></label>
                    <label class="field"><span>Bricks a trip</span><input type="number" name="hiredCapacity" min="1" class="num" value="${esc(o.hiredCapacity ?? '')}" placeholder="All in one trip"></label>
                    <label class="field"><span>Their charge a trip (₹)</span><input type="number" name="hiredCharge" min="0" step="any" class="num" value="${esc(o.hiredCharge ?? '')}" placeholder="0"></label>
                </div>
                <div class="bk-sub-label">Who pays the transporter</div>
                <div class="bk-choice two">${PAID_BY.map(([v, l, h]) => `<button type="button" class="${paidBy0 === v ? 'on' : ''}" data-paid-by="${v}">${icon(v === 'US' ? 'receipt' : 'user')}<b>${l}</b><small>${h}</small></button>`).join('')}</div>
                <input type="hidden" name="hiredPaidBy" value="${esc(paidBy0)}">
            </div>
            <div class="bko-grid bko-cols2">
                <label class="field"><span>Loading (our team)</span><select name="loadingTeamId" data-search>${resourceOptions(meta.resources, loading0, { roles: TEAM_ROLES, placeholder: 'Pick later' })}</select></label>
                <label class="field" data-unload-field><span>Unloading <em data-unload-req>*</em></span><select name="unloadingTeamId" data-search>${unloadOpts(unloading0)}</select></label>
                <label class="check-line bko-switch"><input type="checkbox" name="splitOn" ${o.plannedTrips ? 'checked' : ''}><span><b>Set the trips</b><small class="muted">a fixed count</small></span></label>
                <label class="field"><span>Number of trips</span><input type="number" name="tripCount" min="2" max="200" step="1" class="num" value="${esc(o.plannedTrips ?? '')}" placeholder="—" ${o.plannedTrips ? '' : 'disabled'}></label>
            </div></section>

            <div class="hc-pr-card"><div class="hc-pr-title">${icon('layers')}Stock check</div><div data-stock></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('truck')}Trips</div><div data-trips></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('receipt')}The bill</div><div class="bk-bill bko-bill" data-bill></div></div>
        </aside></form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const body = f.querySelector('.bko-items tbody');
            noAutofill(f);
            let waiveTouched = !!view;
            let chargeTouched = !!view;
            let shortOk = false;
            const hired = () => f.hired.value === 'true';
            const outside = () => f.unloadingTeamId.value === 'outside';
            const loadRate = num(o.loadingRate ?? s.loadingRate), unloadRate = num(o.unloadingRate ?? s.unloadingRate);
            const recalc = () => {
                let qty = 0, atMrp = 0, value = 0, belowAny = false;
                const short = [];
                body.querySelectorAll('[data-row]').forEach(tr => {
                    const t = types.find(x => String(x.id) === tr.querySelector('[data-type]').value);
                    const q = num(tr.querySelector('[data-qty]').value), p = num(tr.querySelector('[data-price]').value);
                    const mrp = t?.mrp !== null && t?.mrp !== undefined ? num(t.mrp) : null;
                    const off = mrp !== null && p < mrp ? mrp - p : 0;
                    tr.querySelector('[data-mrp]').textContent = mrp === null ? 'no MRP set' : `MRP ${money(mrp, { decimals: 2 })}`;
                    tr.querySelector('[data-amt]').textContent = q ? money(p * q) : '—';
                    const lowest = t?.minPrice !== null && t?.minPrice !== undefined ? num(t.minPrice) : null;
                    const below = lowest !== null && p && p < lowest;
                    tr.classList.toggle('bko-below', !!below);
                    tr.querySelector('[data-disc]').innerHTML = below ? `<span class="warn" title="The lowest price agreed without a checker is ${money(lowest, { decimals: 2 })}">${icon('shield')}below ${money(lowest)} · approval</span>`
                        : off && q ? `<span class="neg">${((off / mrp) * 100).toFixed(1)}% off · ${money(off * q)}</span>` : '';
                    if (below) belowAny = true;
                    const free = t ? freeOf(t.id) : null;
                    const freeEl = tr.querySelector('[data-free]');
                    freeEl.textContent = free === null ? '' : `${count(Math.max(0, free))} free in the yard`;
                    freeEl.classList.toggle('neg', free !== null && q > free);
                    tr.classList.toggle('short', free !== null && q > free);
                    if (free !== null && q > free) short.push([t.name, q, Math.max(0, free)]);
                    qty += q; atMrp += (mrp !== null ? Math.max(mrp, p) : p) * q; value += p * q;
                });
                // a maker: a price below the lowest waits for a checker (said here, with room for a word to them)
                const ck = f.querySelector('[data-checker]');
                const go = f.closest('.modal')?.querySelector('.modal-foot .btn.primary');
                if (ck && go && !view) {
                    go.dataset.label ||= go.textContent.trim();
                    go.innerHTML = `${icon(belowAny ? 'send' : 'check')}${belowAny ? 'Send for approval' : go.dataset.label}`;
                }
                if (ck) {
                    ck.hidden = !belowAny && !view;
                    ck.querySelector('[data-checker-why]').textContent = belowAny ? 'A price is below the lowest: the order waits for a checker’s approval'
                        : 'You record, a checker changes: every change to this order waits for their approval and is made when they approve it';
                }
                // the stock: in the yard, or short (taken anyway when delivered later: made by then)
                const later = f.requiredBy.value && f.requiredBy.value > today();
                f.querySelector('[data-stock]').innerHTML = !qty ? '<small class="muted">Enter the bricks to check the yard.</small>'
                    : !short.length ? `<div class="bko-ok">${icon('check-circle')}<span>All in the yard</span></div>`
                    : `<div class="bko-short">${short.map(([n, q, fr]) => `<div><b>${esc(n)}</b><span>${count(q)} ordered · ${count(fr)} free</span><em>${count(q - fr)} short</em></div>`).join('')}
                        <label class="check-line"><input type="checkbox" data-short-ok ${shortOk ? 'checked' : ''}><span>Take it anyway: they will be made before delivery</span></label>
                        ${later ? `<small class="muted">Needed by ${date(f.requiredBy.value)}</small>` : '<small class="warn">Set the “Needed by” date</small>'}</div>`;
                f.dataset.short = short.length ? '1' : '';
                const isHired = hired(), paidBy = f.hiredPaidBy.value, toTransporter = isHired && paidBy === 'CUSTOMER';
                const v = isHired ? null : meta.vehicles.find(x => String(x.id) === f.vehicleId.value);
                const set = f.splitOn.checked ? num(f.tripCount.value) : 0;
                f.querySelector('[data-unload-req]').hidden = !isHired;
                const cap = set ? Math.ceil(qty / set) : isHired ? num(f.hiredCapacity.value) : v?.capacity;
                const trips = qty ? (set ? Math.min(set, qty) : cap ? Math.ceil(qty / cap) : 1) : 0;
                const min = s.freeDeliveryMinQty;
                if (!waiveTouched && min && !toTransporter) {
                    f.waiveDelivery.checked = qty >= min;
                    f.querySelector('[data-waive-reason]').hidden = !f.waiveDelivery.checked;
                    if (f.waiveDelivery.checked && !f.waiveReason.value) f.waiveReason.value = `Free delivery on orders of ${count(min)}+ bricks`;
                }
                f.querySelector('[data-charge-wrap]').hidden = toTransporter;
                f.querySelector('[data-charge-label]').textContent = isHired ? 'Bill the customer a trip (₹)' : 'Delivery charge a trip (₹)';
                f.querySelector('[data-waive-box]').hidden = toTransporter;
                if (toTransporter) f.querySelector('[data-waive-reason]').hidden = true;
                const per = toTransporter ? 0 : num(f.deliveryChargePerTrip.value);
                const waived = !toTransporter && f.waiveDelivery.checked;
                const delivery = waived ? 0 : per * trips;
                const rate = loadRate + (outside() ? 0 : unloadRate);
                f.querySelector('[data-handling-rate]').textContent = `(₹${rate} a brick${outside() ? ', loading only' : ''})`;
                const handling = f.handlingBilled.checked ? qty * rate : 0;
                const label = isHired ? esc(f.hiredVehicle.value.trim().toUpperCase() || 'the hired vehicle') : v ? esc(v.number) : '';
                f.querySelector('[data-trips]').innerHTML = !qty ? '<small class="muted">Trips are planned from the bricks and the vehicle.</small>'
                    : !isHired && !v ? `<span class="badge warning">${icon('alert')}Pick a vehicle to plan the trips</span>`
                    : `<div class="bk-trip-dots">${Array.from({ length: Math.min(trips, 10) }, (_, i) => `<span title="Trip ${i + 1}">${icon('truck')}<small>${count(cap ? Math.min(cap, qty - i * cap) : qty)}</small></span>`).join('')}${trips > 10 ? `<b>+${trips - 10}</b>` : ''}</div>
                       <small class="muted">${plural(trips, 'trip')}${cap ? ` of up to ${count(cap)}` : ''} with ${label}${set ? ' · split as chosen' : ''}</small>
                       ${min && qty && qty < min && !isHired ? `<small class="muted">${count(min - qty)} more bricks for free delivery</small>` : ''}`;
                const hiredCost = isHired ? num(f.hiredCharge.value) * trips : 0;
                const total = value + delivery + handling;
                f.querySelector('[data-bill]').innerHTML = `
                    <div><span>${count(qty)} bricks at MRP</span><b>${money(atMrp)}</b></div>
                    ${atMrp > value ? `<div class="disc"><span>Discount (${((1 - value / atMrp) * 100).toFixed(1)}%)</span><b>− ${money(atMrp - value)}</b></div>` : ''}
                    <div><span>Bricks</span><b>${money(value)}</b></div>
                    ${toTransporter ? `<div><span>Delivery</span><b><em class="muted">to the transporter</em></b></div>`
                        : `<div><span>Delivery${trips ? ` · ${plural(trips, 'trip')} × ${money(per)}` : ''}</span><b>${money(per * trips)}</b></div>
                           ${waived && per * trips ? `<div class="free"><span>Free delivery</span><b>− ${money(per * trips)}</b></div>` : ''}`}
                    ${handling ? `<div><span>Loading${outside() ? '' : ' &amp; unloading'}</span><b>${money(handling)}</b></div>` : ''}
                    <div class="total"><span>Total</span><b>${money(total)}</b></div>
                    ${isHired && paidBy === 'US' && hiredCost ? `<small class="muted">We pay the transporter ${money(hiredCost)}: record it as a Transport expense.</small>` : ''}`;
                f.querySelector('[data-h-name]').textContent = f.customerName.value.trim() || 'New customer';
                f.querySelector('[data-h-note]').textContent = qty ? `${count(qty)} bricks · ${plural(trips, 'trip')}${isHired ? ' · hired vehicle' : v ? ` · ${v.number}` : ''}` : 'Enter the bricks';
                f.querySelector('[data-h-total]').textContent = money(total);
            };
            f.addEventListener('input', e => {
                if (e.target.name === 'deliveryChargePerTrip') chargeTouched = true;
                if (e.target.name === 'hiredCharge' && !chargeTouched && f.hiredPaidBy.value === 'US') f.deliveryChargePerTrip.value = e.target.value;
                if (e.target.matches('[data-short-ok]')) { shortOk = e.target.checked; return; }
                recalc();
            });
            f.addEventListener('change', e => {
                if (e.target.matches('[data-short-ok]')) { shortOk = e.target.checked; return; }
                if (e.target.name === 'splitOn') {
                    f.tripCount.disabled = !e.target.checked;
                    if (e.target.checked) { if (!f.tripCount.value) f.tripCount.value = 2; f.tripCount.focus(); f.tripCount.select(); } else f.tripCount.value = '';
                }
                if (e.target.dataset.type !== undefined) {
                    const t = types.find(x => String(x.id) === e.target.value);
                    const price = e.target.closest('tr').querySelector('[data-price]');
                    if (t?.mrp !== null && t?.mrp !== undefined) price.value = t.mrp;
                }
                if (e.target.name === 'waiveDelivery') { waiveTouched = true; f.querySelector('[data-waive-reason]').hidden = !e.target.checked; }
                if (e.target.name === 'vehicleId' && !f.driverId.value) {
                    const v = meta.vehicles.find(x => String(x.id) === e.target.value);
                    if (v?.driverId) f.driverId.value = v.driverId;
                }
                if (e.target.name === 'customerName') {
                    const c = customers.find(x => x.name === e.target.value);
                    if (c) {
                        if (!f.customerPhone.value) f.customerPhone.value = c.phone || '';
                        if (!f.address.value) f.address.value = c.address || '';
                        if (!f.landmark.value) f.landmark.value = c.landmark || '';
                    }
                }
                recalc();
            });
            f.addEventListener('click', e => {
                const tr = e.target.closest('[data-transport]');
                if (tr) {
                    f.hired.value = tr.dataset.transport === 'hired';
                    f.querySelectorAll('[data-transport]').forEach(x => x.classList.toggle('on', x === tr));
                    f.querySelector('[data-own]').hidden = hired();
                    f.querySelector('[data-hired]').hidden = !hired();
                    // the production team loads either way; our vehicle is unloaded by it too, a hired one by the customer / transporter
                    if (!f.loadingTeamId.value && maker0) f.loadingTeamId.value = maker0;
                    const un = f.unloadingTeamId.value;
                    if (hired()) { if (!un || un === String(maker0 ?? '')) f.unloadingTeamId.value = 'outside'; }
                    else if (!un || un === 'outside') f.unloadingTeamId.value = maker0 ?? f.loadingTeamId.value ?? '';
                    if (hired() && f.hiredPaidBy.value === 'US' && !chargeTouched && f.hiredCharge.value) f.deliveryChargePerTrip.value = f.hiredCharge.value;
                    if (!hired() && !chargeTouched) f.deliveryChargePerTrip.value = s.deliveryChargePerTrip ?? '';
                    recalc();
                }
                const pb = e.target.closest('[data-paid-by]');
                if (pb) {
                    f.hiredPaidBy.value = pb.dataset.paidBy;
                    f.querySelectorAll('[data-paid-by]').forEach(x => x.classList.toggle('on', x === pb));
                    if (pb.dataset.paidBy === 'US' && !chargeTouched) f.deliveryChargePerTrip.value = f.hiredCharge.value;
                    recalc();
                }
                if (e.target.closest('[data-add-row]')) {
                    const used = new Set([...body.querySelectorAll('[data-type]')].map(x => x.value));
                    const t = types.find(x => !used.has(String(x.id))) || types[0];
                    body.insertAdjacentHTML('beforeend', row({ brickTypeId: t?.id, quantity: '', price: t?.mrp ?? '' }));
                    recalc();
                    body.querySelector('[data-row]:last-child [data-qty]').focus();
                }
                const rm = e.target.closest('[data-remove]');
                if (rm && body.querySelectorAll('[data-row]').length > 1) { rm.closest('tr').remove(); recalc(); }
            });
            if (!view && !f.driverId.value && firstVehicle?.driverId) f.driverId.value = firstVehicle.driverId;
            suggest(f.customerName, customers.map(c => ({ value: c.name, icon: 'user', sub: [c.phone, c.address].filter(Boolean).join(' · ') || 'no details',
                meta: `<b>${plural(c.orders, 'order')}</b>${num(c.balance) > 0 ? `<span class="neg">${money(c.balance)} due</span>` : `<span>${count(c.bricks)} bricks</span>`}`, c })), { title: 'Past customers',
                onPick: ({ c }) => {
                    if (!f.customerPhone.value) f.customerPhone.value = c.phone || '';
                    if (!f.address.value) f.address.value = c.address || '';
                    if (!f.landmark.value) f.landmark.value = c.landmark || '';
                    recalc();
                } });
            recalc();
        },
        actions: [{ label: 'Cancel' }, { label: view ? 'Save order' : 'Take order', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const isHired = f.hired.value === 'true';
            // the checks a person would make before taking it
            if (!isHired && !f.vehicleId.value && meta.vehicles.some(v => v.active)) throw new Error('Pick the vehicle, or choose “Hired from outside”');
            if (isHired && !f.hiredVehicle.value.trim() && !f.hiredContact.value.trim()) throw new Error('Enter the hired vehicle’s number or the transporter (name and mobile)');
            if (isHired && f.hiredPaidBy.value === 'US' && !(num(f.hiredCharge.value) > 0)) throw new Error('Enter what the transporter charges a trip: we pay it, so it goes on the bill');
            if (isHired && !f.unloadingTeamId.value) throw new Error('Choose who unloads the hired vehicle: our team, or the customer / transporter');
            if (f.splitOn.checked && !(num(f.tripCount.value) >= 2)) throw new Error('Enter the number of trips (2 or more), or untick “Set the trips”');
            if (f.requiredBy.value && f.requiredBy.value < f.orderDate.value) throw new Error('“Needed by” is before the order date');
            const phone = f.customerPhone.value.replace(/\D/g, '');
            if (phone && phone.length < 10) throw new Error('The mobile number looks short');
            if (f.dataset.short) {
                if (!f.querySelector('[data-short-ok]')?.checked) throw new Error('More bricks than the yard has free: tick “Take it anyway” if they will be made before delivery');
                if (!f.requiredBy.value || f.requiredBy.value <= today()) throw new Error('Set the “Needed by” date for bricks still to be made');
            }
            const d = readForm(f);
            d.hired = isHired;
            d.unloadingOutside = d.unloadingTeamId === 'outside';
            if (d.unloadingOutside) d.unloadingTeamId = null;
            d.plannedTrips = f.splitOn.checked ? num(f.tripCount.value) || null : null;
            delete d.splitOn; delete d.tripCount;
            ['vehicleId', 'driverId', 'loadingTeamId', 'unloadingTeamId'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
            if (d.hired) { d.vehicleId = null; d.driverId = null; if (d.hiredPaidBy === 'CUSTOMER') { d.deliveryChargePerTrip = 0; d.waiveDelivery = false; } }
            d.items = [...f.querySelectorAll('[data-row]')].map(tr => ({ brickTypeId: Number(tr.querySelector('[data-type]').value),
                quantity: num(tr.querySelector('[data-qty]').value), price: num(tr.querySelector('[data-price]').value) }));
            Object.keys(d).filter(k => !['customerName', 'customerPhone', 'address', 'landmark', 'orderDate', 'requiredBy', 'vehicleId', 'driverId', 'loadingTeamId',
                'unloadingTeamId', 'deliveryChargePerTrip', 'waiveDelivery', 'waiveReason', 'handlingBilled', 'note', 'items',
                'hired', 'hiredVehicle', 'hiredContact', 'hiredCapacity', 'hiredCharge', 'hiredPaidBy', 'unloadingOutside', 'plannedTrips'].includes(k)).forEach(k => delete d[k]);
            const note = f.querySelector('[name=checkerNote]')?.value.trim() || null;
            delete d.checkerNote;
            const res = view ? await api.put(`/bricks/orders/${o.id}`, { order: d, note }) : await api.post('/bricks/orders', { order: d, note });
            if (res.pending) {
                // waits for a checker: nothing (or only what does not touch the money) is changed yet
                toast(`${res.pending.approvalNo}: sent for approval · ${res.pending.reasons.slice(0, 2).join(' · ')}`, 'info');
                if (view && res.order) after(res.order, '');
                else location.hash = `#/bricks/approvals/${res.pending.id}`;
                return;
            }
            const saved = res.order;
            after(saved, view ? 'Order saved' : `Order ${saved.order.orderNo} taken · ${plural(saved.trips.length, 'trip')} planned`);
        } }],
    });
}

/** Keeps the browser from filling a form's boxes with its own saved values (it ignores "off" on some fields). */
export function noAutofill(form) {
    const off = el => { if (el.matches('input:not([type=hidden], [type=checkbox], [type=radio])')) el.setAttribute('autocomplete', `bk-${el.name || 'x'}-off`); };
    form.querySelectorAll('input').forEach(off);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input')) off(n); n.querySelectorAll?.('input').forEach(off); } })))
        .observe(form, { childList: true, subtree: true });
}

// ===================================================================== an order's page

const NEXT = { PLANNED: ['LOADING', 'Load', 'layers'], LOADING: ['DISPATCHED', 'Dispatch', 'send'], DISPATCHED: ['IN_TRANSIT', 'On the way', 'truck'],
    IN_TRANSIT: ['DELIVERED', 'Delivered', 'check-circle'] };
const BACK = { LOADING: 'PLANNED', DISPATCHED: 'LOADING', IN_TRANSIT: 'DISPATCHED', DELIVERED: 'IN_TRANSIT' };
const STAMP = { PLANNED: 'scheduledOn', LOADING: 'loadingAt', DISPATCHED: 'dispatchedAt', IN_TRANSIT: 'inTransitAt', DELIVERED: 'deliveredAt' };
const hhmm = iso => iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const stepOf = status => TRIP_STEPS.findIndex(x => x[0] === status);
const latest = list => list.filter(Boolean).sort().at(-1) || null;
const telOf = p => String(p || '').replace(/\D/g, '').slice(-10);

/**
 * The delivery's lifecycle, at the head of the trips: order received, then each step a trip goes through, with how many
 * of the trips reached it and when the last one did; the bar under it is the bricks delivered.
 */
function lifecycleHtml(v, trips) {
    const o = v.order, t = v.totals;
    const n = trips.length;
    const cancelled = o.status === 'CANCELLED';
    const steps = [{ key: 'RECEIVED', label: 'Order received', ic: 'file-text', reached: n || 1, when: o.orderDate ? date(o.orderDate) : '' },
        ...TRIP_STEPS.slice(1).map(([k, l, ic], i) => {
            const at = trips.filter(x => stepOf(x.trip.status) >= i + 1);
            return { key: k, label: l, ic, reached: at.length, when: hhmm(latest(at.map(x => x.trip[STAMP[k]]))) };
        })];
    const pct = t.quantity ? Math.min(100, (t.delivered / t.quantity) * 100) : 0;
    return `<div class="bk-life ${cancelled ? 'cancelled' : ''}">
        <ol>${steps.map((s, i) => {
            const done = i === 0 || (n && s.reached === n);
            const part = i > 0 && s.reached > 0 && s.reached < n;
            return `<li class="${done ? 'done' : part ? 'part' : ''}"><span class="bk-life-dot">${icon(done ? 'check' : s.ic)}</span>
                <div><b>${esc(s.label)}</b><small>${i === 0 ? esc(s.when) : n ? `${s.reached} of ${n} trip${n === 1 ? '' : 's'}${s.when ? ` · ${esc(s.when)}` : ''}` : '—'}</small></div></li>`;
        }).join('')}</ol>
        <div class="bk-life-bar" title="${count(t.delivered)} of ${count(t.quantity)} bricks delivered"><i style="width:${pct}%"></i></div>
        <div class="bk-life-foot"><span><b>${count(t.delivered)}</b> of ${count(t.quantity)} bricks delivered</span>
            ${t.pending && !cancelled ? `<span>${count(t.pending)} still to go</span>` : ''}${cancelled ? '<span class="neg">Order cancelled</span>' : ''}</div>
    </div>`;
}

function tripLine(v, t) {
    const tr = t.trip;
    const i = stepOf(tr.status);
    const next = NEXT[tr.status];
    const live = manage() && v.order.status !== 'CANCELLED';
    const short = t.delivered !== null && t.delivered < t.quantity;
    const day = tr.deliveredAt ? hhmm(tr.deliveredAt) : tr.scheduledOn ? shortDate(tr.scheduledOn) : '';
    return `<span class="bk-trip-no">#${tr.tripNo}</span>
        <span>${tripBadge(tr.status)}</span>
        <span class="bk-dots">${TRIP_STEPS.map(([, l], k) => `<i class="${k < i || tr.status === 'DELIVERED' ? 'done' : k === i ? 'now' : ''}" title="${esc(l)}"></i>`).join('')}</span>
        <span class="ellipsis small">${t.vehicle ? `<span class="bk-plate xs">${esc(t.vehicle)}</span>` : '<span class="warn">no vehicle</span>'}${t.driver ? ` ${esc(t.driver)}` : ''}${day ? ` <span class="muted">· ${esc(day)}</span>` : ''}</span>
        <span class="r"><b>${count(t.delivered ?? t.quantity)}</b>${short ? `<small class="neg">of ${count(t.quantity)}</small>` : '<small>bricks</small>'}</span>
        <span class="bk-acts">${tr.ackAt ? `<span class="badge good sm" title="Signed by ${esc(tr.ackName)}">${icon('signature')}signed</span>` : ''}
            ${live && next ? `<button class="btn sm primary" data-step="${next[0]}" title="${esc(next[1])}">${icon(next[2])}${next[1]}</button>` : ''}
            ${live && BACK[tr.status] && !tr.ackAt ? `<button class="btn sm ghost icon" data-step="${BACK[tr.status]}" title="Back one step">${icon('undo')}</button>` : ''}</span>`;
}

/** The proof kept when the customer signed, compact: the signature, where, the device's fingerprint, the seal, the signed receipt. */
function evidenceHtml(tr) {
    let dev = {};
    try { dev = tr.ackDevice ? JSON.parse(tr.ackDevice) : {}; } catch { dev = {}; }
    const [lat, lng, acc] = String(tr.ackLocation || '').split(',');
    const copy = (text, n) => `<span class="mono" title="${esc(text)}">${esc(String(text).slice(0, n))}…</span><button type="button" class="btn sm ghost icon bk-ev-copy" data-copy="${esc(text)}" title="Copy">${icon('copy')}</button>`;
    return `<div class="bk-ev">
        <div class="bk-ev-sig">${tr.ackSignature ? signatureSvg(tr.ackSignature) : '<span class="muted small">no signature drawn</span>'}
            <small><b>${esc(tr.ackName)}</b> · ${dateTime(tr.ackAt)}</small></div>
        <dl class="bk-ev-list">
            <div><dt>${icon('map-pin')}Location</dt><dd>${lat ? `<a href="https://maps.google.com/?q=${esc(lat)},${esc(lng)}" target="_blank" rel="noopener">${esc(Number(lat).toFixed(5))}, ${esc(Number(lng).toFixed(5))}</a>${acc ? `<small>± ${esc(acc)} m</small>` : ''}` : '<span class="muted">not shared</span>'}</dd></div>
            <div><dt>${icon('monitor')}Device</dt><dd>${dev.fingerprint ? copy(dev.fingerprint, 16) : '<span class="muted">not taken</span>'}${dev.userAgent ? `<small>${esc(deviceName(dev.userAgent))}</small>` : ''}</dd></div>
            <div><dt>${icon('stamp')}Seal</dt><dd>${tr.ackSeal ? copy(tr.ackSeal, 16) : '—'}</dd></div>
            <div><dt>${icon('shield')}Receipt</dt><dd>${tr.ackDigitalSignature ? '<span data-ack-verify class="bd-checking">checking…</span>' : '<span class="muted">not signed</span>'}</dd></div>
        </dl></div>`;
}

function tripDetail(v, t) {
    const tr = t.trip;
    const i = stepOf(tr.status);
    const live = manage() && v.order.status !== 'CANCELLED';
    const timeline = TRIP_STEPS.map(([k, l, ic], n) => {
        const when = k === 'PLANNED' ? (tr.scheduledOn ? date(tr.scheduledOn) : '') : hhmm(tr[STAMP[k]]);
        const state = n < i || tr.status === 'DELIVERED' ? 'done' : n === i ? 'now' : '';
        return `<li class="${state}"><i>${icon(state === 'done' ? 'check' : ic)}</i><b>${esc(l)}</b><small>${when || (state ? '' : 'not yet')}</small></li>`;
    }).join('');
    const phone = telOf(t.driverPhone);
    const broke = t.items.reduce((s, x) => s + (x.delivered !== null && x.delivered < x.quantity ? x.quantity - x.delivered : 0), 0);
    const atYard = tr.status === 'PLANNED' || tr.status === 'LOADING';
    return `<div class="bk-trip-detail">
        <section><h4>${icon('timeline')}Journey</h4><ol class="bk-tl">${timeline}</ol>${tr.note ? `<p class="small muted">“${esc(tr.note)}”</p>` : ''}</section>
        <section><h4>${icon('layers')}Load</h4>
            <table class="grid compact dense"><thead><tr><th>Type</th><th class="r">Loaded</th><th class="r">Delivered</th><th class="r">Broke</th></tr></thead>
                <tbody>${t.items.map(x => `<tr><td>${esc(x.name)}</td><td class="r">${count(x.quantity)}</td><td class="r"><b>${x.delivered === null ? '—' : count(x.delivered)}</b></td>
                    <td class="r ${x.delivered !== null && x.delivered < x.quantity ? 'neg' : 'muted'}">${x.delivered !== null && x.delivered < x.quantity ? count(x.quantity - x.delivered) : '—'}</td></tr>`).join('')}</tbody>
                ${t.items.length > 1 ? `<tfoot><tr><td>Total</td><td class="r">${count(t.quantity)}</td><td class="r">${t.delivered === null ? '—' : count(t.delivered)}</td><td class="r">${broke ? count(broke) : '—'}</td></tr></tfoot>` : ''}</table>
            <h4>${icon('users')}Crew</h4>
            <dl class="bk-crew">
                <div><dt>Vehicle</dt><dd>${t.vehicle ? `<span class="bk-plate xs">${esc(t.vehicle)}</span>${t.vehicleKind ? ` <small>${esc(t.vehicleKind)}</small>` : ''}` : '<span class="warn">not picked</span>'}</dd></div>
                <div><dt>Driver</dt><dd>${esc(t.driver || '—')}${phone ? ` <a href="tel:${phone}" title="Call">${icon('phone')}</a>` : ''}</dd></div>
                <div><dt>Loading</dt><dd>${esc(t.loadingTeam || '—')}</dd></div>
                <div><dt>Unloading</dt><dd>${v.order.unloadingOutside ? '<span class="muted">customer / transporter</span>' : esc(t.unloadingTeam || '—')}</dd></div>
                ${tr.status === 'DELIVERED' ? `<div><dt>Billed</dt><dd><b>${money(t.billed)}</b>${t.entryNo ? ` <small class="muted">${esc(t.entryNo)}</small>` : ''}</dd></div>` : ''}
            </dl></section>
        <section class="bk-ack-col">${tr.ackAt ? `<h4>${icon('check-circle')}Proof of delivery</h4>${evidenceHtml(tr)}`
            : `<div class="bk-ack pending"><div class="bk-ack-head">${icon('signature')}<div><b>Not signed for yet</b>
                <small>${['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(tr.status) ? 'The customer signs for it on the order link: their signature, device and location are kept as proof.' : 'Once it leaves the yard the customer can sign for it on the order link.'}</small></div></div>
                ${manage() && v.order.status !== 'CANCELLED' ? `<button class="btn sm" data-act="share">${icon('share')}Share the link</button>` : ''}</div>`}
            ${live ? `<div class="row wrap bk-trip-acts">${atYard ? `<button class="btn sm" data-step="DELIVERED">${icon('check-circle')}Delivered</button>
                <button class="btn sm" data-split-trip title="Into smaller trips, whatever the vehicle carries">${icon('split')}Split</button>
                <button class="btn sm" data-edit-trip>${icon('edit')}Edit</button><button class="btn sm ghost danger" data-drop-trip>${icon('trash')}Drop</button>` : ''}
                ${tr.status === 'DELIVERED' && !tr.ackAt ? `<button class="btn sm" data-counts>${icon('edit')}Counts</button>` : ''}</div>` : ''}</section>
    </div>`;
}

/** What the order comes to, as a short receipt: the lines, a free delivery taken off, paid, the balance. */
function billSummaryHtml(v) {
    const o = v.order, t = v.totals;
    const toTransporter = o.hired && o.hiredPaidBy !== 'US';
    const paidPct = num(t.total) > 0 ? Math.min(100, (num(t.paid) / num(t.total)) * 100) : 0;
    const state = o.status === 'CANCELLED' ? ['gray', 'Cancelled'] : v.invoice ? ['good', 'Paid'] : num(t.paid) > 0 ? ['warning', 'Part paid'] : ['critical', 'Due'];
    const line = (label, value, cls = '') => `<div class="${cls}"><span>${label}</span><i></i><b>${value}</b></div>`;
    const gross = num(t.deliveryGross);
    return `<section class="bk-card bk-billsum">
        <div class="bk-card-head">${icon('receipt')}<b>${v.invoice ? `Invoice ${esc(v.invoice.invoiceNo)}` : 'Bill'}</b><span class="badge sm ${state[0]}">${state[1]}</span></div>
        <div class="bk-bs-lines">
            ${num(t.discount) ? line(`${count(t.quantity)} bricks at MRP`, money(t.atMrp)) + line('Discount', `− ${money(t.discount)}`, 'pos') : ''}
            ${line(`Bricks${num(t.discount) ? '' : ` · ${count(t.quantity)}`}`, money(t.bricks))}
            ${toTransporter ? line(`Delivery · ${plural(t.trips, 'trip')}`, '<em class="muted">to transporter</em>')
                : line(`Delivery · ${plural(t.trips, 'trip')}`, money(o.deliveryWaived ? gross : t.delivery))
                    + (o.deliveryWaived && gross ? line('Free delivery', `− ${money(gross)}`, 'pos') : o.deliveryWaived ? line('Delivery', '<em class="pos">free</em>') : '')}
            ${num(t.handling) ? line(o.unloadingOutside ? 'Loading' : 'Loading &amp; unloading', money(t.handling)) : ''}
            ${line(o.status === 'DELIVERED' ? 'Billed' : 'Total', money(t.total), 'total')}
            ${line('Paid', money(t.paid), 'pos')}
            ${num(t.claimed) ? line('Reported, to confirm', money(t.claimed), 'warn') : ''}
            ${line(num(t.balance) >= 0 ? 'Balance' : 'Advance held', money(Math.abs(num(t.balance))), `total ${num(t.balance) > 0 ? 'due' : 'clear'}`)}
        </div>
        <i class="bk-paid-bar" title="${paidPct.toFixed(0)}% paid"><em style="width:${paidPct}%"></em></i>
        <small class="muted">${o.status !== 'DELIVERED' && num(t.dueNow) > 0 ? `${money(t.dueNow)} due for what was delivered` : v.invoice ? 'Paid in full · digitally signed' : `${paidPct.toFixed(0)}% paid`}</small>
        <div class="bk-bs-foot"><button class="btn sm" data-act="bill">${icon('eye')}View ${v.invoice ? 'invoice' : 'bill'}</button>
            ${o.status !== 'CANCELLED' ? `<button class="btn sm primary" data-act="share-bill">${icon('send')}Send as PDF</button>` : ''}</div>
    </section>`;
}

/** The payments of the order, across the middle: the figures, then each payment in full. */
function paymentsHtml(v) {
    const o = v.order, t = v.totals;
    const paidPct = num(t.total) > 0 ? Math.min(100, (num(t.paid) / num(t.total)) * 100) : 0;
    return `<div class="bk-tab-pane">
        <div class="bk-pay-sum">
            <div><small>Total</small><b>${money(t.total)}</b></div><div><small>Received</small><b class="pos">${money(t.paid)}</b></div>
            ${num(t.claimed) ? `<div><small>Reported, to confirm</small><b class="warn">${money(t.claimed)}</b></div>` : ''}
            <div><small>${num(t.balance) >= 0 ? 'Balance' : 'Advance held'}</small><b class="${num(t.balance) > 0 ? 'neg' : 'pos'}">${money(Math.abs(num(t.balance)))}</b></div>
            ${o.status !== 'DELIVERED' && num(t.dueNow) > 0 ? `<div><small>Due for what was delivered</small><b>${money(t.dueNow)}</b></div>` : ''}
            <span class="spacer"></span>
            ${manage() && o.status !== 'CANCELLED' ? `<button class="btn sm primary" data-act="pay">${icon('plus')}Record a payment</button>` : ''}
        </div>
        <i class="bk-paid-bar big" title="${paidPct.toFixed(0)}% paid"><em style="width:${paidPct}%"></em></i>
        ${v.payments.length ? `<div class="bk-scroll">${rowsHtml(v.payments, { key: p => p.payment.id, cls: 'bk-slim bk-pay-rows', cols: '108px 86px 70px minmax(0,1fr) minmax(0,1fr) 96px auto',
                head: ['Receipt', 'Received', 'How', 'Reference', 'Into', ['Amount', 'r'], ''],
                load: p => p.payment.status === 'CLAIMED' ? null : journalPeek(p.payment.journalEntryId),
                line: p => {
                    const claimed = p.payment.status === 'CLAIMED';
                    return `<span>${claimed ? `<span class="badge warning sm">${icon('bell')}to confirm</span>` : `<b>${esc(p.payment.receiptNo || '—')}</b>`}</span>
                        <span class="muted">${shortDate(p.payment.receivedOn)}</span><span>${esc(p.payment.mode || '')}</span><span class="mono small ellipsis">${esc(p.payment.reference || '—')}</span>
                        <span class="ellipsis small">${esc(p.account || (claimed ? 'reported on the link' : '—'))}</span>
                        <span class="r"><b class="${claimed ? 'warn' : 'pos'}">${money(p.payment.amount)}</b></span>
                        <span class="bk-acts">${manage() ? `${claimed ? `<button class="btn sm primary" data-confirm="${p.payment.id}">${icon('check')}Confirm</button>` : ''}
                            ${openOn(`bricks/orders/${v.order.id}/payments/${p.payment.id}`) ? heldTag(openOn(`bricks/orders/${v.order.id}/payments/${p.payment.id}`), { short: true })
                                : claimed || bcan('FINANCE', 'APPROVE') ? `<button class="btn sm ghost icon danger" data-del-pay="${p.payment.id}" title="${claimed ? 'Not received' : 'Delete'}">${icon('trash')}</button>` : ''}` : ''}</span>`;
                },
                detail: p => {
                    const x = p.payment, claimed = x.status === 'CLAIMED';
                    return `<div class="bk-peek"><div class="bk-peek-h">${icon('arrow-in')}<b>${claimed ? 'Reported by the customer' : `Receipt ${esc(x.receiptNo || '')}`}</b>
                            <span class="muted">${date(x.receivedOn)}</span><span class="spacer"></span><b class="pos">${money(x.amount)}</b></div>
                        ${factsHtml([
                            ['How', esc(x.mode || '')], ['Reference', x.reference ? `<span class="mono">${esc(x.reference)}</span>` : ''],
                            ['Into', esc(p.account || '')], ['Status', claimed ? '<span class="warn">to confirm: check the bank</span>' : '<span class="pos">in the books</span>'],
                            ['Recorded', x.createdAt ? `<small>${esc(x.createdBy || 'the customer')} · ${dateTime(x.createdAt)}</small>` : ''],
                            ['Note', x.note ? `<span class="muted">${esc(x.note)}</span>` : '', 'wide']])}</div>`;
                } })}</div>`
            : `<div class="empty bk-empty">${icon('arrow-in')}<div>Nothing received yet${manage() && o.status !== 'CANCELLED' ? ': record a payment, or share the link so the customer can pay by UPI' : ''}</div></div>`}
    </div>`;
}

/** The links shared with the customer, across the middle: an active one can be shared again as it is. */
function linksHtml(v) {
    const url = token => `${location.origin}/brick-order.html#${token}`;
    const o = v.order;
    const phone = telOf(o.customerPhone);
    const text = u => `Hello ${o.customerName}, follow your brick order ${o.orderNo} here: track the delivery, share your location, see the bill and pay by UPI. ${u}`;
    return `<div class="bk-tab-pane">
        <div class="bk-pay-sum"><div><small>Shared</small><b>${plural(v.links.length, 'link')}</b></div>
            <div><small>Active</small><b>${v.links.filter(l => l.status === 'ACTIVE').length}</b></div>
            <div><small>Opened</small><b>${plural(v.links.reduce((s, l) => s + l.views, 0), 'time')}</b></div>
            ${o.deliveryLocation ? `<div><small>Delivery location</small><b><a href="https://maps.google.com/?q=${esc(o.deliveryLocation.split(',').slice(0, 2).join(','))}" target="_blank" rel="noopener">${icon('map-pin')}shared ${o.deliveryLocationAt ? shortDate(o.deliveryLocationAt.slice(0, 10)) : ''}</a></b></div>` : ''}
            <span class="spacer"></span>${manage() && o.status !== 'CANCELLED' ? `<button class="btn sm primary" data-act="share">${icon('link')}New link</button>` : ''}</div>
        ${v.links.length ? `<div class="bk-scroll"><div class="bk-linkcards">${v.links.map(l => {
            const u = l.token ? url(l.token) : null;
            return `<div class="bk-linkcard ${esc(l.status)}">
                <div class="bk-lc-head"><span class="badge ${l.status === 'ACTIVE' ? 'good' : 'gray'} sm">${esc(l.status.toLowerCase())}</span>
                    <small>by ${esc(l.createdByName)} · ${dateTime(l.createdAt)}</small><span class="spacer"></span>
                    <small>${l.status === 'ACTIVE' ? 'until' : l.status === 'REVOKED' ? 'stopped' : 'ended'} <b>${dateTime(l.status === 'REVOKED' ? l.revokedAt : l.expiresAt)}</b></small></div>
                <div class="bk-lc-stats"><span>${icon('eye')}${plural(l.views, 'view')}</span>${l.lastViewedAt ? `<span>last ${dateTime(l.lastViewedAt)}</span>` : '<span class="muted">not opened yet</span>'}</div>
                ${u ? `<div class="bk-lc-url"><input readonly value="${esc(u)}" class="mono">
                    <button class="btn sm" data-copy="${esc(u)}">${icon('copy')}Copy</button>
                    <a class="btn sm primary" target="_blank" rel="noopener" href="https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text(u))}">${icon('send')}WhatsApp</a>
                    ${phone ? `<a class="btn sm" href="sms:+91${phone}?body=${encodeURIComponent(text(u))}">${icon('mail')}SMS</a>` : ''}
                    <a class="btn sm ghost icon" target="_blank" rel="noopener" href="${esc(u)}" title="Open">${icon('eye')}</a>
                    ${manage() ? `<button class="btn sm ghost danger" data-revoke="${l.id}">Stop</button>` : ''}</div>`
                    : l.status === 'ACTIVE' ? `<div class="bk-lc-url"><small class="muted">Made before links were kept: make a new one to share it again.</small>
                        ${manage() ? `<button class="btn sm ghost danger" data-revoke="${l.id}">Stop</button>` : ''}</div>` : ''}
            </div>`;
        }).join('')}</div></div>`
            : `<div class="empty bk-empty">${icon('link')}<div>Not shared yet: a link lets the customer follow the delivery, share the location, see the bill, pay and sign for each trip</div></div>`}
    </div>`;
}

let orderTab = 'delivery';
/** Which tab an order opens on (a link to its payments opens them). */
export const setOrderTab = t => { orderTab = t; };

export function orderHtml(v) {
    const o = v.order, t = v.totals;
    const claimed = v.payments.filter(p => p.payment.status === 'CLAIMED');
    const open = !['DELIVERED', 'CANCELLED'].includes(o.status);
    const pending = v.items.reduce((s, i) => s + i.pending, 0);
    const trips = v.trips.filter(x => x.trip.status !== 'CANCELLED');
    const phone = telOf(o.customerPhone);
    const late = o.requiredBy && o.requiredBy < today() && open;
    const loc = o.deliveryLocation ? o.deliveryLocation.split(',').slice(0, 2).join(',') : null;
    const activeLinks = v.links.filter(l => l.status === 'ACTIVE').length;
    const tab = (key, label, ic, badge = '') => `<button class="${orderTab === key ? 'active' : ''}" data-tab="${key}">${icon(ic)}${label}${badge}</button>`;
    const held = openOn(`bricks/orders/${v.order.id}`);
    return `<div class="bk-order">
        <header class="bk-oh">
            <span class="bk-oh-av">${esc(initials(o.customerName))}</span>
            <div class="grow min-0">
                <div class="bk-oh-title"><h2 class="ellipsis">${esc(o.customerName)}</h2><span class="bk-oh-no">${esc(o.orderNo)}</span>${orderBadge(o.status)}${heldTag(openOn(`bricks/orders/${o.id}`))}</div>
                <div class="bk-meta">${phone ? `<a href="tel:${phone}">${icon('phone')}${esc(o.customerPhone)}</a><a href="https://wa.me/91${phone}" target="_blank" rel="noopener">${icon('send')}WhatsApp</a>` : ''}
                    <span class="ellipsis">${icon('map-pin')}${esc(o.address || 'no address')}${o.landmark ? ` (${esc(o.landmark)})` : ''}</span>
                    ${loc ? `<a class="bk-loc" href="https://maps.google.com/?q=${esc(loc)}" target="_blank" rel="noopener" title="Shared by the customer from their phone${o.deliveryLocationAt ? ` on ${dateTime(o.deliveryLocationAt)}` : ''}">${icon('map-pin')}Location on the map</a>` : ''}
                    <span>${icon('calendar')}${date(o.orderDate)}${o.requiredBy ? ` → <b class="${late ? 'neg' : ''}">${date(o.requiredBy)}${late ? ' · late' : ''}</b>` : ''}</span></div>
            </div>
            <div class="bk-oh-amt"><small>${num(t.balance) > 0 ? 'Balance' : 'Total'}</small><b class="${num(t.balance) > 0 ? 'neg' : ''}">${money(num(t.balance) > 0 ? t.balance : t.total)}</b>
                <small>${num(t.balance) > 0 ? `of ${money(t.total)}` : v.invoice ? 'paid in full' : ''}</small></div>
        </header>
        <div class="bk-order-acts">
            ${manage() && o.status !== 'CANCELLED' ? `<button class="btn sm primary" data-act="share">${icon('share')}Share link</button>
            <button class="btn sm" data-act="pay">${icon('arrow-in')}Payment</button>` : ''}
            <button class="btn sm" data-act="bill">${icon('receipt')}View ${v.invoice ? 'invoice' : 'bill'}</button>
            ${o.status !== 'CANCELLED' ? `<button class="btn sm" data-act="share-bill">${icon('send')}Send bill</button>` : ''}
            ${manage() && open && !held ? `<button class="btn sm" data-act="edit">${icon('edit')}Edit</button>` : ''}
            <span class="spacer"></span>
            ${held ? `<span class="small muted">${icon('lock')}Changes wait for ${esc(held.number)}</span>` : ''}
            ${manage() && !held && o.status !== 'CANCELLED' && !(o.hired && o.hiredPaidBy !== 'US') ? `<button class="btn sm ghost" data-act="waive">${icon(bcan('APPROVE') ? 'tag' : 'shield')}${o.deliveryWaived ? 'Charge delivery' : bcan('APPROVE') ? 'Free delivery' : 'Ask for free delivery'}</button>` : ''}
            ${manage() && open && !held ? `<button class="btn sm ghost danger" data-act="cancel">${icon('x')}${bcan('APPROVE') ? 'Cancel order' : 'Ask to cancel'}</button>` : ''}</div>
        ${claimed.length ? `<div class="bk-claim">${icon('bell')}<div><b>${claimed.length === 1 ? 'A payment' : `${claimed.length} payments`} reported by the customer</b>
            <small>Check the bank, then confirm: ${claimed.map(p => `${money(p.payment.amount)} · ref ${esc(p.payment.reference || '')}`).join(', ')}</small></div>
            <button class="btn sm" data-tab="payments">Open payments</button></div>` : ''}
        <div class="bk-order-grid">
            <div class="bk-order-main">
                <section class="bk-card bk-delivery-card">
                    <div class="bk-card-head bk-tabbar">
                        ${tab('delivery', 'Delivery', 'truck', `<i>${trips.length}</i>`)}
                        ${tab('payments', 'Payments', 'arrow-in', `<i class="${num(t.balance) > 0 ? 'due' : ''}">${v.payments.length}</i>`)}
                        ${tab('links', 'Shared links', 'link', `<i>${activeLinks}</i>`)}
                        <span class="spacer"></span>
                        ${orderTab === 'delivery' && manage() && open ? `${pending ? `<button class="btn sm" data-act="add-trip">${icon('plus')}Plan ${count(pending)}</button>` : ''}
                            <button class="btn sm ghost" data-act="replan" title="Plan the trips not on their way again">${icon('refresh')}Replan</button>` : ''}
                    </div>
                    ${orderTab === 'payments' ? paymentsHtml(v) : orderTab === 'links' ? linksHtml(v) : `
                        <div class="bk-del-sub muted small">${plural(trips.length, 'trip')}${v.vehicle ? ` · ${esc(v.vehicle)}${v.vehicleCapacity ? ` carries ${count(v.vehicleCapacity)}` : ''}` : ''}${o.plannedTrips ? ` · split into ${o.plannedTrips} trips as chosen` : ''}</div>
                        ${lifecycleHtml(v, trips)}
                        <div class="bk-scroll bk-trips-scroll">${rowsHtml(trips, { key: x => x.trip.id, cls: 'bk-trip-rows', cols: '34px 118px 62px minmax(0,1fr) 62px auto', empty: 'No trips',
                            head: ['Trip', 'Status', 'Steps', 'Vehicle · driver · when', ['Bricks', 'r'], ''],
                            open: trips.length === 1 ? trips[0].trip.id : null, line: x => tripLine(v, x), detail: x => tripDetail(v, x) })}</div>`}
                </section>
            </div>
            <aside class="bk-order-side">
                ${billSummaryHtml(v)}
                <section class="bk-card"><div class="bk-card-head">${icon('brick')}<b>Bricks</b></div>
                    <div class="bk-items">${v.items.map(i => `<div><div class="bk-items-top"><b>${esc(i.name)}</b><span>${count(i.delivered)} / ${count(i.quantity)}</span></div>
                        <i class="bk-paid-bar"><em style="width:${i.quantity ? (i.delivered / i.quantity) * 100 : 0}%"></em><em class="way" style="width:${i.quantity ? (i.onTheWay / i.quantity) * 100 : 0}%"></em></i>
                        <small class="muted">${money(i.price, { decimals: 2 })} a brick${num(i.discount) ? ` · ${num(i.discountPercent).toFixed(1)}% off MRP` : ''}${i.onTheWay ? ` · ${count(i.onTheWay)} on the way` : ''}${i.pending ? ` · ${count(i.pending)} not planned` : ''}</small></div>`).join('')}</div></section>
                <section class="bk-card"><div class="bk-card-head">${icon(o.hired ? 'key' : 'truck')}<b>${o.hired ? 'Hired vehicle' : 'Vehicle & crew'}</b></div>
                    <dl class="bk-crew">${o.hired ? `<div><dt>Vehicle</dt><dd>${o.hiredVehicle ? `<span class="bk-plate xs">${esc(o.hiredVehicle)}</span>` : '—'}</dd></div>
                        <div><dt>Transporter</dt><dd>${esc(o.hiredContact || '—')}</dd></div>
                        <div><dt>Their charge</dt><dd>${o.hiredCharge ? `${money(o.hiredCharge)} a trip` : '—'}</dd></div>
                        <div><dt>Paid by</dt><dd>${o.hiredPaidBy === 'US' ? 'us · on the bill' : 'the customer'}</dd></div>`
                        : `<div><dt>Vehicle</dt><dd>${v.vehicle ? `<span class="bk-plate xs">${esc(v.vehicle)}</span>` : '—'}</dd></div><div><dt>Driver</dt><dd>${esc(v.driver || '—')}</dd></div>`}
                        <div><dt>Loading</dt><dd>${esc(v.loadingTeam || '—')}</dd></div>
                        <div><dt>Unloading</dt><dd>${o.unloadingOutside ? '<span class="muted">customer / transporter</span>' : esc(v.unloadingTeam || '—')}</dd></div></dl>
                    ${o.note ? `<p class="small muted bk-note-p">${icon('info')}${esc(o.note)}</p>` : ''}</section>
            </aside>
        </div>
    </div>`;
}

/** The bill (or the invoice, once paid in full) as its document: checked, printed, sent as a PDF. */
export function openBillDoc(v) {
    const html = billDocHtml(billFromView(v));
    openModal({
        title: v.invoice ? `Invoice ${v.invoice.invoiceNo}` : `Bill for ${v.order.orderNo}`, iconName: 'receipt', size: 'xl',
        sub: `${v.order.customerName} · ${money(v.totals.total)}${v.invoice ? ' · paid in full, digitally signed' : ` · balance ${money(v.totals.balance)}`}`,
        body: `<div class="bd-wrap">${html}</div>`,
        onOpen: m => { if (v.invoice) verifyDoc(m.el, v.invoice.payload, v.invoice.signature, v.publicKey); },
        actions: [{ label: 'Close' },
            { label: 'Print', iconName: 'printer', onClick: () => { if (!printDoc(html, v.invoice ? v.invoice.invoiceNo : v.order.orderNo)) toast('Allow pop-ups to print', 'error'); return true; } },
            { label: 'Send as PDF', kind: 'primary', iconName: 'send', onClick: () => { setTimeout(() => openBillShare(v), 0); } }],
    });
}

/** The bill's PDF, fetched with the session (for downloading or sharing it as a file). */
async function billPdf(v) {
    const r = await fetch(`/api/bricks/orders/${v.order.id}/bill.pdf`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (!r.ok) throw new Error('The PDF could not be made');
    const name = `${v.invoice ? `Invoice ${v.invoice.invoiceNo}` : `Bill ${v.order.orderNo}`}.pdf`;
    return new File([await r.blob()], name, { type: 'application/pdf' });
}

/**
 * Sends the bill as a PDF: on WhatsApp as a link the customer opens (the order's active link, made when there is none),
 * through the device's share sheet as the file itself (WhatsApp is there on phones and Windows), or downloaded.
 */
async function openBillShare(v, changed) {
    const o = v.order;
    const phone = telOf(o.customerPhone);
    const what = v.invoice ? `invoice ${v.invoice.invoiceNo}` : `bill for order ${o.orderNo}`;
    const fileShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
    openModal({
        title: `Send the ${v.invoice ? 'invoice' : 'bill'}`, iconName: 'send', size: 'lg', sub: `${o.customerName}${phone ? ` · ${o.customerPhone}` : ''} · ${money(v.totals.total)}`,
        body: `<div class="bk-sendbill">
            <button type="button" class="bk-send-opt" data-send="whatsapp">${icon('send')}<b>WhatsApp</b><small>A message with the PDF’s link${phone ? ` to ${esc(o.customerPhone)}` : ''}: it opens on their phone</small></button>
            <button type="button" class="bk-send-opt" data-send="file" ${fileShare ? '' : 'disabled'}>${icon('share')}<b>Share the PDF file</b><small>${fileShare ? 'Pick WhatsApp (or any app) in the share sheet' : 'This browser cannot share files: download it instead'}</small></button>
            <button type="button" class="bk-send-opt" data-send="download">${icon('download')}<b>Download the PDF</b><small>To attach it yourself or print it</small></button>
            <button type="button" class="bk-send-opt" data-send="open">${icon('eye')}<b>Open the PDF</b><small>See it as the customer will</small></button>
            <p class="small muted" data-send-note></p></div>`,
        onOpen: m => m.el.addEventListener('click', async e => {
            const b = e.target.closest('[data-send]');
            if (!b || b.classList.contains('busy')) return;
            b.classList.add('busy');
            const note = m.el.querySelector('[data-send-note]');
            try {
                if (b.dataset.send === 'whatsapp') {
                    // the customer needs a link that works without signing in: the order's active link, else a new one (30 days)
                    let token = v.links.find(l => l.status === 'ACTIVE' && l.token)?.token;
                    if (!token) {
                        token = (await api.post(`/bricks/orders/${o.id}/links`, { hours: 720 })).token;
                        changed?.();
                    }
                    const pdf = `${location.origin}/api/public/brick-orders/${token}/bill.pdf`;
                    const text = `Hello ${o.customerName}, here is your ${what} from ${v.company?.name || 'us'}: ${money(v.totals.total)}`
                        + `${num(v.totals.balance) > 0 ? `, balance ${money(v.totals.balance)}` : ', paid in full'}.\nPDF: ${pdf}\nOrder & UPI payment: ${location.origin}/brick-order.html#${token}`;
                    window.open(`https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
                    note.textContent = 'WhatsApp opened with the message: press send there.';
                } else if (b.dataset.send === 'file') {
                    const file = await billPdf(v);
                    await navigator.share({ files: [file], title: file.name, text: `Your ${what}` });
                } else {
                    const file = await billPdf(v);
                    const url = URL.createObjectURL(file);
                    if (b.dataset.send === 'open') window.open(url, '_blank', 'noopener');
                    else Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
                    setTimeout(() => URL.revokeObjectURL(url), 60000);
                }
            } catch (err) {
                if (err.name !== 'AbortError') toast(err.message, 'error');
            } finally {
                b.classList.remove('busy');
            }
        }),
        actions: [{ label: 'Close' }],
    });
}

/** Splits a trip still at the yard into smaller ones, whatever the vehicle carries: equal parts, or sizes of your own. */
function openSplit(v, t, after) {
    const total = t.quantity;
    const equal = n => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
    openModal({
        title: `Split trip ${t.trip.tripNo}`, iconName: 'split', sub: `${count(total)} bricks · ${t.items.map(i => `${i.name} ${count(i.quantity)}`).join(', ')}`,
        body: `<form class="bk-split-form" onsubmit="return false">
            <div class="field"><span>Into</span><div class="seg-chips">${[2, 3, 4, 5, 6].map(n => `<button type="button" class="seg-chip ${n === 2 ? 'active' : ''}" data-n="${n}">${n} trips</button>`).join('')}</div></div>
            <div class="bk-split-parts" data-parts></div>
            <div class="bk-split-sum" data-sum></div>
            <p class="hint">Each new trip takes this trip’s vehicle, driver, teams and day; change any of them afterwards with Edit. A special case: the vehicle’s capacity is not checked.</p>
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const draw = parts => {
                f.querySelector('[data-parts]').innerHTML = parts.map((p, i) => `<label class="bk-split-part"><span>${i === 0 ? `Trip ${t.trip.tripNo}` : `New trip ${i}`}</span>
                    <input type="number" min="1" step="1" class="num" data-part value="${p}"></label>`).join('')
                    + `<button type="button" class="link-btn" data-more>${icon('plus')}Another trip</button>`;
                sum();
            };
            const sum = () => {
                const parts = [...f.querySelectorAll('[data-part]')].map(i => num(i.value));
                const s = parts.reduce((a, b) => a + b, 0);
                f.querySelector('[data-sum]').innerHTML = `<div class="bk-split-bar">${parts.map(p => `<i style="flex:${Math.max(p, 0)}" title="${count(p)}"><small>${count(p)}</small></i>`).join('')}</div>
                    <span class="${s === total ? 'pos' : 'neg'}">${count(s)} of ${count(total)}${s === total ? ' ✓' : s < total ? ` · ${count(total - s)} left over` : ` · ${count(s - total)} too many`}</span>`;
            };
            f.addEventListener('click', e => {
                const n = e.target.closest('[data-n]');
                if (n) { f.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('active', x === n)); draw(equal(Number(n.dataset.n))); }
                if (e.target.closest('[data-more]')) { f.querySelectorAll('[data-n]').forEach(x => x.classList.remove('active')); draw([...[...f.querySelectorAll('[data-part]')].map(i => num(i.value)), 0]); }
            });
            f.addEventListener('input', sum);
            draw(equal(2));
        },
        actions: [{ label: 'Cancel' }, { label: 'Split the trip', kind: 'primary', iconName: 'split', onClick: async m => {
            const parts = [...m.el.querySelectorAll('[data-part]')].map(i => num(i.value)).filter(p => p > 0);
            if (parts.length < 2) throw new Error('At least two trips');
            if (parts.reduce((a, b) => a + b, 0) !== total) throw new Error(`The trips must carry ${count(total)} bricks in all`);
            after(await api.post(`/bricks/orders/${v.order.id}/trips/${t.trip.id}/split`, { parts }));
        } }],
    });
}

/** Checks each signed receipt's digital signature shown on the page. */
function verifyReceipts(host, v) {
    host.querySelectorAll('[data-ack-verify].bd-checking:not([data-checking])').forEach(async el => {
        el.dataset.checking = '1';
        const t = v.trips.find(x => String(x.trip.id) === el.closest('[data-key]')?.dataset.key)?.trip;
        if (!t) return;
        const ok = await verifyEvidence(t.ackPayload, t.ackDigitalSignature, v.publicKey);
        el.className = ok === true ? 'bd-ok' : ok === false ? 'bd-bad' : 'bd-checking';
        el.textContent = ok === true ? '✓ verified' : ok === false ? '✗ does not match' : 'cannot be checked here';
    });
}

/** Wires an order's page drawn with orderHtml; changed(view, message) after each change. */
/**
 * Brings an order on screen up to date in place (the customer signed, a trip moved on, a payment came): only the parts
 * that changed are replaced, and lit up for a moment; trips opened stay open, the scroll stays where it was. Returns
 * false when the order changed shape (a trip more or less, another tab): then it is drawn again.
 */
export function patchOrder(host, nv, old) {
    const tmp = document.createElement('div');
    tmp.innerHTML = orderHtml(nv);
    const parts = ['.bk-oh', '.bk-order-acts', '.bk-claim', '.bk-tabbar', '.bk-life', '.bk-del-sub', '.bk-order-side'];
    const same = parts.every(p => !!host.querySelector(p) === !!tmp.querySelector(p));
    const keys = el => [...el.querySelectorAll('.bk-trip-rows > .bk-row, .bk-trip-rows .bk-row')].map(r => r.dataset.key).join(',');
    if (!same || keys(host) !== keys(tmp) || orderTab !== 'delivery' && host.querySelector('.bk-delivery-card') === null) return false;
    const lit = el => { el.classList.remove('bk-flash'); void el.offsetWidth; el.classList.add('bk-flash'); };
    parts.forEach(p => {
        const a = host.querySelector(p), b = tmp.querySelector(p);
        if (a && b && a.innerHTML !== b.innerHTML) { a.replaceWith(b); lit(b); }
    });
    if (orderTab !== 'delivery') {
        const a = host.querySelector('.bk-delivery-card'), b = tmp.querySelector('.bk-delivery-card');
        if (a && b && a.innerHTML !== b.innerHTML) { a.replaceWith(b); }
        return true;
    }
    tmp.querySelectorAll('.bk-trip-rows .bk-row').forEach(b => {
        const a = host.querySelector(`.bk-trip-rows .bk-row[data-key="${b.dataset.key}"]`);
        if (!a) return;
        const was = old?.trips.find(x => String(x.trip.id) === b.dataset.key)?.trip, now = nv.trips.find(x => String(x.trip.id) === b.dataset.key)?.trip;
        const moved = !was || !now || was.status !== now.status || was.ackAt !== now.ackAt || a.querySelector('.bk-line').innerHTML !== b.querySelector('.bk-line').innerHTML;
        if (!moved) return;
        const open = a.classList.contains('open');
        a.replaceWith(b);
        if (open) b.querySelector('.bk-line').click();
        lit(b);
    });
    return true;
}

export function bindOrder(host, v, changed) {
    const id = v.order.id;
    const run = async (work, message) => {
        try {
            const nv = await work();
            invalidateAccounts();
            changed(nv, message);
        } catch (e) { toast(e.message, 'error'); }
    };
    bindRows(host);
    verifyReceipts(host, v);
    host.onclick = guard(async e => {
        // a trip opened shows its receipt: check its signature then
        if (e.target.closest('.bk-line')) setTimeout(() => verifyReceipts(host, v), 60);
        const tb = e.target.closest('[data-tab]');
        if (tb) { orderTab = tb.dataset.tab; return changed(v); }
        const cp = e.target.closest('[data-copy]');
        if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Link copied', 'info'); } catch { toast('Copy is not available here', 'error'); } return; }
        const tripEl = e.target.closest('.bk-trip-rows [data-key]');
        const trip = tripEl ? v.trips.find(x => String(x.trip.id) === tripEl.dataset.key) : null;
        const step = e.target.closest('[data-step]');
        if (step && trip) {
            const to = step.dataset.step;
            // a trip is not loaded before its loading and unloading teams are set: ask for them
            if (to === 'LOADING' && trip.trip.status === 'PLANNED') {
                const noLoad = !trip.trip.loadingTeamId, noUnload = !trip.trip.unloadingTeamId && !v.order.unloadingOutside;
                if (noLoad || noUnload) {
                    toast(`Set the ${noLoad && noUnload ? 'loading and unloading teams' : noLoad ? 'loading team' : 'unloading team'} of trip ${trip.trip.tripNo} before loading it`, 'error');
                    return openTrip(v, trip, nv => changed(nv, 'Trip saved'));
                }
            }
            if (to === 'DELIVERED' && trip.trip.status !== 'DELIVERED') return openDelivered(v, trip, nv => changed(nv, `Trip ${trip.trip.tripNo} delivered`));
            if (BACK[trip.trip.status] === to && !await confirmDialog(`Take trip ${trip.trip.tripNo} back to “${TRIP_STEPS.find(x => x[0] === to)[1]}”?${trip.trip.status === 'DELIVERED' ? ' Its bill leaves the books.' : ''}`,
                { confirmLabel: 'Take back' })) return;
            return run(() => api.post(`/bricks/orders/${id}/trips/${trip.trip.id}/step`, { status: to }), `Trip ${trip.trip.tripNo}: ${TRIP_STEPS.find(x => x[0] === to)[1].toLowerCase()}`);
        }
        if (e.target.closest('[data-counts]') && trip) return openDelivered(v, trip, nv => changed(nv, 'Counts saved'), true);
        if (e.target.closest('[data-edit-trip]') && trip) return openTrip(v, trip, nv => changed(nv, 'Trip saved'));
        if (e.target.closest('[data-split-trip]') && trip) return openSplit(v, trip, nv => changed(nv, `Trip ${trip.trip.tripNo} split`));
        if (e.target.closest('[data-drop-trip]') && trip) {
            if (await confirmDialog(`Drop trip ${trip.trip.tripNo}? Its bricks wait for another trip.`, { confirmLabel: 'Drop' })) return run(() => api.del(`/bricks/orders/${id}/trips/${trip.trip.id}`), 'Trip dropped');
            return;
        }
        const conf = e.target.closest('[data-confirm]');
        if (conf) return openConfirmPayment(v, Number(conf.dataset.confirm), nv => changed(nv, 'Payment confirmed and in the books'));
        const del = e.target.closest('[data-del-pay]');
        if (del) {
            const ok = await confirmDelete('Delete this payment? Its entry leaves the books.', async () => changed(await api.del(`/bricks/orders/${id}/payments/${del.dataset.delPay}`), 'Payment deleted'));
            if (ok) invalidateAccounts();
            return;
        }
        const rv = e.target.closest('[data-revoke]');
        if (rv) return run(() => api.del(`/bricks/orders/${id}/links/${rv.dataset.revoke}`), 'Link stopped');
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        const fresh = () => api.get(`/bricks/orders/${id}`).then(nv => changed(nv));
        if (act === 'edit') return openOrder(v, nv => changed(nv, 'Order saved'));
        if (act === 'bill') return openBillDoc(v);
        if (act === 'share-bill') return openBillShare(v, fresh);
        if (act === 'pay') return openPayment(v, nv => changed(nv, 'Payment recorded'));
        if (act === 'share') return openShare(v, () => { orderTab = 'links'; return fresh(); });
        if (act === 'add-trip') return run(() => api.post(`/bricks/orders/${id}/trips`), 'Trip planned');
        if (act === 'replan') return run(() => api.post(`/bricks/orders/${id}/replan`), 'Trips planned again');
        if (act === 'waive') {
            if (v.order.deliveryWaived) return run(() => api.post(`/bricks/orders/${id}/waive`, { waive: false }).then(outcome), 'Delivery charged again');
            return openWaive(v, nv => changed(nv, 'Delivery is free'));
        }
        if (act === 'cancel') {
            if (!bcan('APPROVE')) return openAskCancel(v, nv => changed(nv));
            if (await confirmDialog(`Cancel order ${v.order.orderNo}?`, { confirmLabel: 'Cancel order' })) return run(() => api.post(`/bricks/orders/${id}/cancel`).then(outcome), 'Order cancelled');
        }
    });
}

function openDelivered(v, t, after, correcting = false) {
    openModal({
        title: `Trip ${t.trip.tripNo} ${correcting ? 'counts' : 'delivered'}`, iconName: 'check-circle', sub: 'How many arrived in good shape; the customer is billed for these',
        body: `<form class="form-grid two">${t.items.map(i => `<label class="field"><span>${esc(i.name)} <small class="muted">loaded ${count(i.quantity)}</small></span>
            <input type="number" min="0" max="${i.quantity}" step="1" class="num" data-delivered="${i.brickTypeId}" value="${i.delivered ?? i.quantity}"></label>`).join('')}
            <p class="hint span-2">Fewer than loaded: the rest are counted as broken on the way, and still owed on the order (plan another trip for them, or make the order smaller).</p></form>`,
        actions: [{ label: 'Cancel' }, { label: correcting ? 'Save counts' : 'Mark delivered', kind: 'primary', iconName: 'check', onClick: async m => {
            const delivered = [...m.el.querySelectorAll('[data-delivered]')].map(i => ({ brickTypeId: Number(i.dataset.delivered), quantity: num(i.value) }));
            after(await api.post(`/bricks/orders/${v.order.id}/trips/${t.trip.id}/step`, { status: 'DELIVERED', delivered }));
            invalidateAccounts();
        } }],
    });
}

async function openTrip(v, t, after) {
    const meta = await loadingDialog('Opening the trip…', () => loadMeta());
    if (!meta) return;
    const tr = t.trip;
    openModal({
        title: `Trip ${tr.tripNo}`, iconName: 'truck',
        body: `<form class="form-grid two">
            ${field({ label: 'Vehicle', name: 'vehicleId', type: 'select', value: tr.vehicleId, options: vehicleOptions(meta.vehicles, tr.vehicleId) })}
            ${field({ label: 'Day', name: 'scheduledOn', type: 'date', value: tr.scheduledOn })}
            ${field({ label: 'Driver', name: 'driverId', type: 'select', value: tr.driverId, options: resourceOptions(meta.resources, tr.driverId, { roles: ['DRIVER'] }) })}
            ${field({ label: 'Loading team *', name: 'loadingTeamId', type: 'select', value: tr.loadingTeamId, options: resourceOptions(meta.resources, tr.loadingTeamId, { roles: ['PRODUCTION_TEAM', 'LOADING_TEAM'], placeholder: 'Choose who loads' }) })}
            ${v.order.unloadingOutside ? '<label class="field"><span>Unloading</span><input value="Customer / transporter" readonly></label>'
                : field({ label: 'Unloading team *', name: 'unloadingTeamId', type: 'select', value: tr.unloadingTeamId, options: resourceOptions(meta.resources, tr.unloadingTeamId, { roles: ['PRODUCTION_TEAM', 'LOADING_TEAM'], placeholder: 'Choose who unloads' }) })}
            <div class="span-2 section-title">Load</div>
            ${t.items.map(i => `<label class="field"><span>${esc(i.name)}</span><input type="number" min="0" step="1" class="num" data-load="${i.brickTypeId}" value="${i.quantity}"></label>`).join('')}
            ${field({ label: 'Note', name: 'note', value: tr.note, span: 'span-2' })}
            <p class="hint span-2">Bricks taken off this trip get a trip of their own.</p>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save trip', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            const d = readForm(f);
            ['vehicleId', 'driverId', 'loadingTeamId', 'unloadingTeamId'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
            d.items = [...f.querySelectorAll('[data-load]')].map(i => ({ brickTypeId: Number(i.dataset.load), quantity: num(i.value) }));
            Object.keys(d).filter(k => k.startsWith('load')).forEach(k => { if (k !== 'loadingTeamId') delete d[k]; });
            after(await api.put(`/bricks/orders/${v.order.id}/trips/${tr.id}`, d));
        } }],
    });
}

async function openPayment(v, after) {
    const got = await loadingDialog('Getting the payment ready…', () => Promise.all([moneyAccounts(), loadMeta()]));
    if (!got) return;
    const [accounts, meta] = got;
    const due = Math.max(0, num(v.totals.balance) - num(v.totals.claimed));
    openModal({
        title: `Payment for ${v.order.orderNo}`, iconName: 'arrow-in', sub: `${v.order.customerName} · balance ${money(v.totals.balance)}`,
        body: `<form class="form-grid two">
            ${field({ label: 'Amount (₹)', name: 'amount', type: 'number', value: due || '', required: true })}
            ${field({ label: 'Received on', name: 'receivedOn', type: 'date', value: today(), required: true })}
            ${field({ label: 'How', name: 'mode', type: 'select', value: 'UPI', options: ['Cash', 'UPI', 'Bank', 'Cheque', 'Card'].map(x => ({ value: x, label: x })) })}
            ${field({ label: 'Reference (UTR, cheque no.)', name: 'reference' })}
            ${field({ label: 'Into', name: 'accountId', type: 'select', value: meta.settings.receiptAccountId, options: moneyOptions(accounts, meta.settings.receiptAccountId, 'Brick · cash'), span: 'span-2' })}
            ${field({ label: 'Note', name: 'note', span: 'span-2' })}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Record payment', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            if (d.accountId) d.accountId = Number(d.accountId);
            after(await api.post(`/bricks/orders/${v.order.id}/payments`, d));
            invalidateAccounts();
        } }],
    });
}

async function openConfirmPayment(v, paymentId, after) {
    const got = await loadingDialog('Getting the accounts…', () => Promise.all([moneyAccounts(), loadMeta()]));
    if (!got) return;
    const [accounts, meta] = got;
    const p = v.payments.find(x => x.payment.id === paymentId).payment;
    openModal({
        title: 'Confirm the payment', iconName: 'check-circle', sub: `${money(p.amount)} · UPI ref ${p.reference || ''} · reported ${dateTime(p.createdAt)}`,
        body: `<form class="form-grid two">
            ${field({ label: 'Received into', name: 'accountId', type: 'select', value: meta.settings.receiptAccountId, options: moneyOptions(accounts, meta.settings.receiptAccountId, 'Brick · cash') })}
            ${field({ label: 'On', name: 'receivedOn', type: 'date', value: p.receivedOn })}
            <p class="hint span-2">Check the money is in the account (the reference matches) before confirming: it then goes to the books.</p></form>`,
        actions: [{ label: 'Cancel' }, { label: 'Confirm', kind: 'primary', iconName: 'check', onClick: async m => {
            const d = readForm(m.el.querySelector('form'));
            after(await api.post(`/bricks/orders/${v.order.id}/payments/${paymentId}/confirm`, { accountId: d.accountId ? Number(d.accountId) : null, receivedOn: d.receivedOn }));
            invalidateAccounts();
        } }],
    });
}

/** What saving gave: the order; or, waiting for a checker, a word that it was sent and the order as it stands. */
function outcome(res) {
    if (res?.pending) toast(`${res.pending.approvalNo}: sent for approval · a checker is told`, 'info');
    return res?.order ?? res;
}

/** A maker cannot cancel an order: they ask a checker, with why. */
function openAskCancel(v, after) {
    openModal({
        title: `Ask to cancel ${v.order.orderNo}`, iconName: 'shield', sub: 'Cancelling an order waits for a checker’s approval',
        body: `<form class="form-grid one">${field({ label: 'Why', name: 'note', required: true, placeholder: 'The customer called it off' })}
            <p class="hint">The order stays as it is until a checker approves; you are told when they decide.</p></form>`,
        actions: [{ label: 'Keep it' }, { label: 'Ask to cancel', kind: 'primary', iconName: 'send', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            after(outcome(await api.post(`/bricks/orders/${v.order.id}/cancel`, { note: f.note.value })));
        } }],
    });
}

function openWaive(v, after) {
    openModal({
        title: 'Waive the delivery charges', iconName: 'tag', sub: `${plural(v.totals.trips, 'trip')} × ${money(v.totals.deliveryPerTrip)}`,
        body: `<form class="form-grid one">${field({ label: 'Why', name: 'reason', required: true, placeholder: 'Regular customer' })}
            <p class="hint">Trips already delivered are billed again without the charge.</p></form>`,
        actions: [{ label: 'Cancel' }, { label: 'Waive', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            after(outcome(await api.post(`/bricks/orders/${v.order.id}/waive`, { waive: true, reason: f.reason.value })));
            invalidateAccounts();
        } }],
    });
}

/** A temporary link for the customer: the order's progress, the bill, UPI payment and signing for each trip. */
function openShare(v, after) {
    const o = v.order;
    openModal({
        title: 'Share the order with the customer', iconName: 'share', sub: 'A link that opens on their phone: progress, bill, pay by UPI, sign on receipt',
        body: `<form class="bk-share"><div class="field"><span>Works for</span><div class="seg-chips">${[[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days'], [2160, '90 days']].map(([h, l], i) =>
            `<button type="button" class="seg-chip ${i === 2 ? 'active' : ''}" data-hours="${h}">${l}</button>`).join('')}</div></div>
            <div data-out></div></form>`,
        onOpen: m => {
            let hours = 168;
            m.el.addEventListener('click', async e => {
                const h = e.target.closest('[data-hours]');
                if (h) { hours = Number(h.dataset.hours); m.el.querySelectorAll('[data-hours]').forEach(x => x.classList.toggle('active', x === h)); }
                const copy = e.target.closest('[data-copy]');
                if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link copied', 'info'); } catch { toast('Copy is not available here', 'error'); } }
            });
            m.make = async () => {
                const created = await api.post(`/bricks/orders/${o.id}/links`, { hours });
                const url = `${location.origin}/brick-order.html#${created.token}`;
                const text = `Hello ${o.customerName}, follow your brick order ${o.orderNo} here: track the delivery, see the bill and pay by UPI. ${url}`;
                const phone = String(o.customerPhone || '').replace(/\D/g, '').slice(-10);
                m.el.querySelector('[data-out]').innerHTML = `<div class="bk-share-out"><div class="bk-share-qr">${qrSvg(url, { size: 150 })}</div>
                    <div class="grow min-0"><input readonly value="${esc(url)}" class="mono">
                    <div class="row wrap"><button type="button" class="btn sm" data-copy="${esc(url)}">${icon('copy')}Copy link</button>
                        <a class="btn sm primary" target="_blank" rel="noopener" href="https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}">${icon('send')}WhatsApp</a>
                        ${phone ? `<a class="btn sm" href="sms:+91${phone}?body=${encodeURIComponent(text)}">${icon('mail')}SMS</a>` : ''}
                        <a class="btn sm ghost" target="_blank" rel="noopener" href="${esc(url)}">${icon('eye')}Open</a></div>
                    <small class="muted">Valid until ${dateTime(created.link.expiresAt)}. It can be stopped any time from the order.</small></div></div>`;
                m.el.closest('.modal').querySelector('[data-action-index="1"]').textContent = 'Make another';
                after();
            };
        },
        actions: [{ label: 'Close' }, { label: 'Make the link', kind: 'primary', iconName: 'link', onClick: async m => { await m.make(); return true; } }],
    });
}
