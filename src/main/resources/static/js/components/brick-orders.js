/**
 * Brick sales: the order form (the customer, the bricks at an agreed price against the MRP, the vehicle that decides
 * the trips, the teams, delivery charges and their waiver), and an order's page: its lifecycle, each trip moving from
 * planned to delivered (fewer delivered when some broke), the bill, payments (and those the customer reported on the
 * link) and the links shared with the customer.
 */
import { api } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { esc, field, readForm, openModal, toast, confirmDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime, shortDate } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { signatureSvg } from '../core/bond.js';
import { billDocHtml, billFromView, verifyDoc, printDoc } from '../core/brick-docs.js';
import { loadMeta, num, count, today, moneyAccounts, moneyOptions, resourceOptions, vehicleOptions, orderBadge, tripBadge, TRIP_STEPS,
    manage, confirmDelete, plural, rowsHtml, bindRows, initials } from './brick-common.js';

// ===================================================================== the order form

const PAID_BY = [['CUSTOMER', 'Customer pays the transporter', 'not on our bill'], ['US', 'We pay it', 'added to the bill']];

export async function openOrder(view, after) {
    const meta = await loadMeta(true);
    const customers = await api.get('/bricks/customers').catch(() => []);
    const o = view?.order || { orderDate: today() };
    const s = meta.settings;
    const types = meta.types.filter(t => t.active || (view?.items || []).some(i => i.brickTypeId === t.id));
    const items = view ? view.items.map(i => ({ brickTypeId: i.brickTypeId, quantity: i.quantity, price: i.price }))
        : [{ brickTypeId: types[0]?.id, quantity: '', price: types[0]?.mrp ?? '' }];
    const firstVehicle = meta.vehicles.find(v => v.active);
    const hired0 = !!o.hired || (!view && !firstVehicle);
    const paidBy0 = o.hiredPaidBy || 'CUSTOMER';
    const typeOpts = sel => types.map(t => `<option value="${t.id}" ${String(t.id) === String(sel) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const row = it => `<tr data-row><td><select data-type>${typeOpts(it.brickTypeId)}</select></td>
        <td><input type="number" min="1" step="1" class="num" data-qty value="${esc(it.quantity ?? '')}" placeholder="0" required></td>
        <td class="r muted" data-mrp></td>
        <td><input type="number" min="0" step="any" class="num" data-price value="${esc(it.price ?? '')}" required></td>
        <td class="r" data-disc></td><td class="r" data-amt></td>
        <td><button type="button" class="btn sm ghost icon danger" data-remove title="Remove">${icon('x')}</button></td></tr>`;
    openModal({
        title: view ? `Edit ${o.orderNo}` : 'New order', iconName: 'cart', size: 'xl',
        sub: view ? 'Trips not on their way yet are planned again' : 'The customer, the bricks and the delivery: trips are planned from the vehicle',
        body: `<form class="bk-order-form">
            <div class="bk-of-grid">
            <section>
                <div class="section-title">${icon('user')} Customer</div>
                <div class="form-grid two">
                    <label class="field"><span>Name *</span><input name="customerName" required value="${esc(o.customerName || '')}" list="bk-customers" autocomplete="off">
                        <datalist id="bk-customers">${customers.map(c => `<option value="${esc(c.name)}">${esc(c.phone || '')} · ${c.orders} order(s)</option>`).join('')}</datalist></label>
                    ${field({ label: 'Mobile', name: 'customerPhone', value: o.customerPhone, attrs: 'inputmode="tel"' })}
                    ${field({ label: 'Deliver to (address)', name: 'address', value: o.address, span: 'span-2' })}
                    ${field({ label: 'Landmark', name: 'landmark', value: o.landmark })}
                    ${field({ label: 'Order date', name: 'orderDate', type: 'date', value: o.orderDate, required: true })}
                    ${field({ label: 'Needed by', name: 'requiredBy', type: 'date', value: o.requiredBy })}
                </div>
                <div class="section-title">${icon('brick')} Bricks</div>
                <table class="grid compact bk-of-items"><thead><tr><th>Type</th><th>Quantity</th><th class="r">MRP</th><th>Agreed price</th><th class="r">Discount</th><th class="r">Amount</th><th></th></tr></thead>
                    <tbody>${items.map(row).join('')}</tbody></table>
                <button type="button" class="link-btn" data-add-row>${icon('plus')}Another brick type</button>
                ${field({ label: 'Note', name: 'note', value: o.note })}
            </section>
            <section>
                <div class="section-title">${icon('truck')} Delivery</div>
                <div class="seg-chips bk-transport"><button type="button" class="seg-chip ${hired0 ? '' : 'active'}" data-transport="own">${icon('truck')}Our vehicle</button>
                    <button type="button" class="seg-chip ${hired0 ? 'active' : ''}" data-transport="hired">${icon('key')}Hired from outside</button></div>
                <input type="hidden" name="hired" value="${hired0}">
                <div class="form-grid two" data-own ${hired0 ? 'hidden' : ''}>
                    ${field({ label: 'Vehicle', name: 'vehicleId', type: 'select', value: o.vehicleId ?? firstVehicle?.id, options: vehicleOptions(meta.vehicles, o.vehicleId ?? firstVehicle?.id), span: 'span-2' })}
                    ${field({ label: 'Driver', name: 'driverId', type: 'select', value: o.driverId, options: resourceOptions(meta.resources, o.driverId, { roles: ['DRIVER'], placeholder: 'The vehicle’s driver' }) })}
                </div>
                <div data-hired ${hired0 ? '' : 'hidden'}>
                    <div class="form-grid two">
                        ${field({ label: 'Vehicle no.', name: 'hiredVehicle', value: o.hiredVehicle, placeholder: 'TS 07 AB 1234' })}
                        ${field({ label: 'Transporter / driver', name: 'hiredContact', value: o.hiredContact, placeholder: 'Name and mobile' })}
                        ${field({ label: 'Bricks a trip', name: 'hiredCapacity', type: 'number', value: o.hiredCapacity, hint: 'Empty: one trip' })}
                        ${field({ label: 'Their charge a trip (₹)', name: 'hiredCharge', type: 'number', value: o.hiredCharge })}
                    </div>
                    <div class="field"><span>Who pays the transporter</span><div class="seg-chips">${PAID_BY.map(([v, l, h]) =>
                        `<button type="button" class="seg-chip ${paidBy0 === v ? 'active' : ''}" data-paid-by="${v}" title="${h}">${l} <small class="muted">· ${h}</small></button>`).join('')}</div></div>
                    <input type="hidden" name="hiredPaidBy" value="${esc(paidBy0)}">
                </div>
                <div class="form-grid two">
                    <div data-charge-wrap>${field({ label: 'Delivery charge a trip (₹)', name: 'deliveryChargePerTrip', type: 'number', value: o.deliveryChargePerTrip ?? s.deliveryChargePerTrip })}</div>
                    <div></div>
                    ${field({ label: 'Loading team', name: 'loadingTeamId', type: 'select', value: o.loadingTeamId, options: resourceOptions(meta.resources, o.loadingTeamId, { roles: ['LOADING_TEAM'], kind: null, placeholder: 'Pick later' }) })}
                    ${field({ label: 'Unloading team', name: 'unloadingTeamId', type: 'select', value: o.unloadingTeamId, options: resourceOptions(meta.resources, o.unloadingTeamId, { roles: ['LOADING_TEAM'], placeholder: 'Pick later' }) })}
                </div>
                <div class="bk-trips-plan" data-trips></div>
                <div data-waive-box>
                    <label class="switch bk-waive"><input type="checkbox" name="waiveDelivery" ${o.deliveryWaived ? 'checked' : ''}><span></span>Waive the delivery charges</label>
                    <div data-waive-reason ${o.deliveryWaived ? '' : 'hidden'}>${field({ label: 'Why', name: 'waiveReason', value: o.waiveReason, placeholder: 'Regular customer' })}</div>
                </div>
                <label class="switch"><input type="checkbox" name="handlingBilled" ${(view ? o.handlingBilled : s.billHandling) ? 'checked' : ''}><span></span>Bill loading &amp; unloading
                    <small class="muted">(₹${num(o.loadingRate ?? s.loadingRate) + num(o.unloadingRate ?? s.unloadingRate)} a brick)</small></label>
                <div class="bk-bill" data-bill></div>
            </section>
            </div>
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const body = f.querySelector('.bk-of-items tbody');
            let waiveTouched = !!view;
            let chargeTouched = !!view;
            const hired = () => f.hired.value === 'true';
            const recalc = () => {
                let qty = 0, atMrp = 0, value = 0;
                body.querySelectorAll('[data-row]').forEach(tr => {
                    const t = types.find(x => String(x.id) === tr.querySelector('[data-type]').value);
                    const q = num(tr.querySelector('[data-qty]').value), p = num(tr.querySelector('[data-price]').value);
                    const mrp = t?.mrp !== null && t?.mrp !== undefined ? num(t.mrp) : null;
                    tr.querySelector('[data-mrp]').textContent = mrp === null ? 'not set' : money(mrp, { decimals: 2 });
                    const off = mrp !== null && p < mrp ? mrp - p : 0;
                    tr.querySelector('[data-disc]').innerHTML = off ? `<span class="neg">${((off / mrp) * 100).toFixed(1)}%</span><small class="muted">${money(off * q)}</small>` : '<span class="muted">—</span>';
                    tr.querySelector('[data-amt]').textContent = q ? money(p * q) : '';
                    qty += q; atMrp += (mrp !== null ? Math.max(mrp, p) : p) * q; value += p * q;
                });
                const isHired = hired(), paidBy = f.hiredPaidBy.value, toTransporter = isHired && paidBy === 'CUSTOMER';
                const v = isHired ? null : meta.vehicles.find(x => String(x.id) === f.vehicleId.value);
                const cap = isHired ? num(f.hiredCapacity.value) : v?.capacity;
                const trips = qty ? (cap ? Math.ceil(qty / cap) : 1) : 0;
                const min = s.freeDeliveryMinQty;
                if (!waiveTouched && min && !toTransporter) {
                    f.waiveDelivery.checked = qty >= min;
                    f.querySelector('[data-waive-reason]').hidden = !f.waiveDelivery.checked;
                    if (f.waiveDelivery.checked && !f.waiveReason.value) f.waiveReason.value = `Free delivery on orders of ${count(min)}+ bricks`;
                }
                f.querySelector('[data-charge-wrap]').hidden = toTransporter;
                f.querySelector('[data-charge-wrap] .field > span').textContent = isHired ? 'Bill the customer a trip (₹)' : 'Delivery charge a trip (₹)';
                f.querySelector('[data-waive-box]').hidden = toTransporter;
                const per = toTransporter ? 0 : num(f.deliveryChargePerTrip.value);
                const waived = !toTransporter && f.waiveDelivery.checked;
                const delivery = waived ? 0 : per * trips;
                const handling = f.handlingBilled.checked ? qty * (num(o.loadingRate ?? s.loadingRate) + num(o.unloadingRate ?? s.unloadingRate)) : 0;
                const label = isHired ? `${esc(f.hiredVehicle.value.trim().toUpperCase() || 'the hired vehicle')}` : v ? esc(v.number) : '';
                f.querySelector('[data-trips]').innerHTML = !qty ? '' : !isHired && !v
                    ? `<span class="badge warning">${icon('alert')}Pick a vehicle to plan the trips</span>`
                    : `<div class="bk-trip-dots">${Array.from({ length: Math.min(trips, 12) }, (_, i) => `<span title="Trip ${i + 1}">${icon('truck')}<small>${count(cap ? Math.min(cap, qty - i * cap) : qty)}</small></span>`).join('')}${trips > 12 ? `<b>+${trips - 12}</b>` : ''}</div>
                       <small class="muted">${plural(trips, 'trip')}${cap ? ` of up to ${count(cap)} bricks` : ''} with ${label}${min && qty < min && !isHired ? ` · ${count(min - qty)} more for free delivery` : ''}</small>`;
                const hiredCost = isHired ? num(f.hiredCharge.value) * trips : 0;
                f.querySelector('[data-bill]').innerHTML = `
                    <div><span>${count(qty)} bricks at MRP</span><b>${money(atMrp)}</b></div>
                    ${atMrp > value ? `<div class="disc"><span>Discount (${((1 - value / atMrp) * 100).toFixed(1)}%)</span><b>− ${money(atMrp - value)}</b></div>` : ''}
                    <div><span>Bricks</span><b>${money(value)}</b></div>
                    <div><span>Delivery${trips ? ` (${plural(trips, 'trip')}${toTransporter ? '' : ` × ${money(per)}`})` : ''}</span><b>${toTransporter ? '<em class="muted">paid to the transporter</em>'
                        : waived ? '<s>' + money(per * trips) + '</s> waived' : money(delivery)}</b></div>
                    ${handling ? `<div><span>Loading &amp; unloading</span><b>${money(handling)}</b></div>` : ''}
                    <div class="total"><span>Total</span><b>${money(value + delivery + handling)}</b></div>
                    ${isHired && paidBy === 'US' && hiredCost ? `<small class="muted">You pay the transporter ${money(hiredCost)}${delivery !== hiredCost ? ` and bill ${money(delivery)}` : ''}: record it as a Transport expense when paid.</small>` : ''}`;
            };
            f.addEventListener('input', e => {
                if (e.target.name === 'deliveryChargePerTrip') chargeTouched = true;
                if (e.target.name === 'hiredCharge' && !chargeTouched && f.hiredPaidBy.value === 'US') f.deliveryChargePerTrip.value = e.target.value;
                recalc();
            });
            f.addEventListener('change', e => {
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
                    f.querySelectorAll('[data-transport]').forEach(x => x.classList.toggle('active', x === tr));
                    f.querySelector('[data-own]').hidden = hired();
                    f.querySelector('[data-hired]').hidden = !hired();
                    if (hired() && f.hiredPaidBy.value === 'US' && !chargeTouched && f.hiredCharge.value) f.deliveryChargePerTrip.value = f.hiredCharge.value;
                    if (!hired() && !chargeTouched) f.deliveryChargePerTrip.value = s.deliveryChargePerTrip ?? '';
                    recalc();
                }
                const pb = e.target.closest('[data-paid-by]');
                if (pb) {
                    f.hiredPaidBy.value = pb.dataset.paidBy;
                    f.querySelectorAll('[data-paid-by]').forEach(x => x.classList.toggle('active', x === pb));
                    if (pb.dataset.paidBy === 'US' && !chargeTouched) f.deliveryChargePerTrip.value = f.hiredCharge.value;
                    recalc();
                }
                if (e.target.closest('[data-add-row]')) {
                    const used = new Set([...body.querySelectorAll('[data-type]')].map(x => x.value));
                    const t = types.find(x => !used.has(String(x.id))) || types[0];
                    body.insertAdjacentHTML('beforeend', row({ brickTypeId: t?.id, quantity: '', price: t?.mrp ?? '' }));
                    recalc();
                }
                const rm = e.target.closest('[data-remove]');
                if (rm && body.querySelectorAll('[data-row]').length > 1) { rm.closest('tr').remove(); recalc(); }
            });
            if (!view && !f.driverId.value && firstVehicle?.driverId) f.driverId.value = firstVehicle.driverId;
            recalc();
        },
        actions: [{ label: 'Cancel' }, { label: view ? 'Save order' : 'Take order', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.hired = f.hired.value === 'true';
            ['vehicleId', 'driverId', 'loadingTeamId', 'unloadingTeamId'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
            if (d.hired) { d.vehicleId = null; d.driverId = null; if (d.hiredPaidBy === 'CUSTOMER') { d.deliveryChargePerTrip = 0; d.waiveDelivery = false; } }
            d.items = [...f.querySelectorAll('[data-row]')].map(tr => ({ brickTypeId: Number(tr.querySelector('[data-type]').value),
                quantity: num(tr.querySelector('[data-qty]').value), price: num(tr.querySelector('[data-price]').value) }));
            Object.keys(d).filter(k => !['customerName', 'customerPhone', 'address', 'landmark', 'orderDate', 'requiredBy', 'vehicleId', 'driverId', 'loadingTeamId',
                'unloadingTeamId', 'deliveryChargePerTrip', 'waiveDelivery', 'waiveReason', 'handlingBilled', 'note', 'items',
                'hired', 'hiredVehicle', 'hiredContact', 'hiredCapacity', 'hiredCharge', 'hiredPaidBy'].includes(k)).forEach(k => delete d[k]);
            const saved = view ? await api.put(`/bricks/orders/${o.id}`, d) : await api.post('/bricks/orders', d);
            after(saved, view ? 'Order saved' : `Order ${saved.order.orderNo} taken · ${plural(saved.trips.length, 'trip')} planned`);
        } }],
    });
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
    const loc = tr.ackLocation ? tr.ackLocation.split(',').slice(0, 2).join(',') : '';
    const broke = t.items.reduce((s, x) => s + (x.delivered !== null && x.delivered < x.quantity ? x.quantity - x.delivered : 0), 0);
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
                <div><dt>Loading</dt><dd>${esc(t.loadingTeam || '—')}</dd></div><div><dt>Unloading</dt><dd>${esc(t.unloadingTeam || '—')}</dd></div>
                ${tr.status === 'DELIVERED' ? `<div><dt>Billed</dt><dd><b>${money(t.billed)}</b>${t.entryNo ? ` <small class="muted">${esc(t.entryNo)}</small>` : ''}</dd></div>` : ''}
            </dl></section>
        <section class="bk-ack-col">${tr.ackAt ? `<div class="bk-ack">
                <div class="bk-ack-head">${icon('check-circle')}<div><b>Received by ${esc(tr.ackName)}</b><small>${dateTime(tr.ackAt)}</small></div></div>
                <div class="bk-ack-sign">${tr.ackSignature ? signatureSvg(tr.ackSignature) : '<span class="muted small">no signature drawn</span>'}</div>
                <dl class="bk-crew">
                    ${loc ? `<div><dt>Where</dt><dd><a href="https://maps.google.com/?q=${esc(loc)}" target="_blank" rel="noopener">${icon('map-pin')}On the map</a></dd></div>` : ''}
                    ${tr.ackRemarks ? `<div class="wide"><dt>Remarks</dt><dd>“${esc(tr.ackRemarks)}”</dd></div>` : ''}
                    <div class="wide"><dt>Seal</dt><dd class="mono small" title="${esc(tr.ackSeal || '')}">${esc(String(tr.ackSeal || '').slice(0, 28))}…</dd></div>
                </dl>
                <small class="muted">${icon('lock')}Signed on the customer’s order link; it can no longer be taken back.</small></div>`
            : `<div class="bk-ack pending"><div class="bk-ack-head">${icon('signature')}<div><b>Not signed for yet</b>
                <small>${['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(tr.status) ? 'The customer signs for it on the order link.' : 'Once it leaves the yard the customer can sign for it on the order link.'}</small></div></div>
                ${manage() && v.order.status !== 'CANCELLED' ? `<button class="btn sm" data-act="share">${icon('share')}Share the link</button>` : ''}</div>`}
            ${live ? `<div class="row wrap bk-trip-acts">${tr.status === 'PLANNED' || tr.status === 'LOADING' ? `<button class="btn sm" data-step="DELIVERED">${icon('check-circle')}Delivered</button>
                <button class="btn sm" data-edit-trip>${icon('edit')}Edit</button><button class="btn sm ghost danger" data-drop-trip>${icon('trash')}Drop</button>` : ''}
                ${tr.status === 'DELIVERED' && !tr.ackAt ? `<button class="btn sm" data-counts>${icon('edit')}Counts</button>` : ''}</div>` : ''}</section>
    </div>`;
}

/** What the order comes to, as a short receipt: the lines, paid, the balance and how much of it is in. */
function billSummaryHtml(v) {
    const o = v.order, t = v.totals;
    const toTransporter = o.hired && o.hiredPaidBy !== 'US';
    const paidPct = num(t.total) > 0 ? Math.min(100, (num(t.paid) / num(t.total)) * 100) : 0;
    const state = o.status === 'CANCELLED' ? ['gray', 'Cancelled'] : v.invoice ? ['good', 'Paid'] : num(t.paid) > 0 ? ['warning', 'Part paid'] : ['critical', 'Due'];
    const line = (label, value, cls = '') => `<div class="${cls}"><span>${label}</span><i></i><b>${value}</b></div>`;
    return `<section class="bk-card bk-billsum">
        <div class="bk-card-head">${icon('receipt')}<b>${v.invoice ? `Invoice ${esc(v.invoice.invoiceNo)}` : 'Bill'}</b><span class="badge sm ${state[0]}">${state[1]}</span></div>
        <div class="bk-bs-lines">
            ${num(t.discount) ? line(`${count(t.quantity)} bricks at MRP`, money(t.atMrp)) + line('Discount', `− ${money(t.discount)}`, 'pos') : ''}
            ${line(`Bricks${num(t.discount) ? '' : ` · ${count(t.quantity)}`}`, money(t.bricks))}
            ${line(`Delivery · ${plural(t.trips, 'trip')}`, toTransporter ? '<em class="muted">to transporter</em>' : o.deliveryWaived ? '<em class="pos">free</em>' : money(t.delivery))}
            ${num(t.handling) ? line('Loading &amp; unloading', money(t.handling)) : ''}
            ${line(o.status === 'DELIVERED' ? 'Billed' : 'Total', money(t.total), 'total')}
            ${line('Paid', money(t.paid), 'pos')}
            ${num(t.claimed) ? line('Reported, to confirm', money(t.claimed), 'warn') : ''}
            ${line(num(t.balance) >= 0 ? 'Balance' : 'Advance held', money(Math.abs(num(t.balance))), `total ${num(t.balance) > 0 ? 'due' : 'clear'}`)}
        </div>
        <i class="bk-paid-bar" title="${paidPct.toFixed(0)}% paid"><em style="width:${paidPct}%"></em></i>
        <div class="bk-bs-foot"><small class="muted">${o.status !== 'DELIVERED' && num(t.dueNow) > 0 ? `${money(t.dueNow)} due for what was delivered` : v.invoice ? 'Paid in full · digitally signed' : `${paidPct.toFixed(0)}% paid`}</small>
            <button class="btn sm" data-act="bill">${icon('eye')}View ${v.invoice ? 'invoice' : 'bill'}</button></div>
    </section>`;
}

export function orderHtml(v) {
    const o = v.order, t = v.totals;
    const claimed = v.payments.filter(p => p.payment.status === 'CLAIMED');
    const open = !['DELIVERED', 'CANCELLED'].includes(o.status);
    const pending = v.items.reduce((s, i) => s + i.pending, 0);
    const trips = v.trips.filter(x => x.trip.status !== 'CANCELLED');
    const phone = telOf(o.customerPhone);
    const late = o.requiredBy && o.requiredBy < today() && open;
    return `<div class="bk-order">
        <header class="bk-oh">
            <span class="bk-oh-av">${esc(initials(o.customerName))}</span>
            <div class="grow min-0">
                <div class="bk-oh-title"><h2 class="ellipsis">${esc(o.customerName)}</h2><span class="bk-oh-no">${esc(o.orderNo)}</span>${orderBadge(o.status)}</div>
                <div class="bk-meta">${phone ? `<a href="tel:${phone}">${icon('phone')}${esc(o.customerPhone)}</a><a href="https://wa.me/91${phone}" target="_blank" rel="noopener">${icon('send')}WhatsApp</a>` : ''}
                    <span class="ellipsis">${icon('map-pin')}${esc(o.address || 'no address')}${o.landmark ? ` (${esc(o.landmark)})` : ''}</span>
                    <span>${icon('calendar')}${date(o.orderDate)}${o.requiredBy ? ` → <b class="${late ? 'neg' : ''}">${date(o.requiredBy)}${late ? ' · late' : ''}</b>` : ''}</span></div>
            </div>
            <div class="bk-oh-amt"><small>${num(t.balance) > 0 ? 'Balance' : 'Total'}</small><b class="${num(t.balance) > 0 ? 'neg' : ''}">${money(num(t.balance) > 0 ? t.balance : t.total)}</b>
                <small>${num(t.balance) > 0 ? `of ${money(t.total)}` : v.invoice ? 'paid in full' : ''}</small></div>
        </header>
        <div class="bk-order-acts">
            ${manage() && o.status !== 'CANCELLED' ? `<button class="btn sm primary" data-act="share">${icon('share')}Share link</button>
            <button class="btn sm" data-act="pay">${icon('arrow-in')}Payment</button>` : ''}
            <button class="btn sm" data-act="bill">${icon('receipt')}View ${v.invoice ? 'invoice' : 'bill'}</button>
            ${manage() && open ? `<button class="btn sm" data-act="edit">${icon('edit')}Edit</button>` : ''}
            <span class="spacer"></span>
            ${manage() && o.status !== 'CANCELLED' && !(o.hired && o.hiredPaidBy !== 'US') ? `<button class="btn sm ghost" data-act="waive">${icon('tag')}${o.deliveryWaived ? 'Charge delivery' : 'Waive delivery'}</button>` : ''}
            ${manage() && open ? `<button class="btn sm ghost danger" data-act="cancel">${icon('x')}Cancel order</button>` : ''}</div>
        ${claimed.length ? `<div class="bk-claim">${icon('bell')}<div><b>${claimed.length === 1 ? 'A payment' : `${claimed.length} payments`} reported by the customer</b>
            <small>Check the bank, then confirm: ${claimed.map(p => `${money(p.payment.amount)} · ref ${esc(p.payment.reference || '')}`).join(', ')}</small></div></div>` : ''}
        <div class="bk-order-grid">
            <div class="bk-order-main">
                <section class="bk-card">
                    <div class="bk-card-head">${icon('truck')}<b>Delivery</b><span class="muted small">${plural(trips.length, 'trip')}${v.vehicle ? ` · ${esc(v.vehicle)}${v.vehicleCapacity ? ` carries ${count(v.vehicleCapacity)}` : ''}` : ''}</span>
                        <span class="spacer"></span>${manage() && open ? `${pending ? `<button class="btn sm" data-act="add-trip">${icon('plus')}Plan ${count(pending)}</button>` : ''}
                        <button class="btn sm ghost" data-act="replan" title="Plan the trips not on their way again">${icon('refresh')}Replan</button>` : ''}</div>
                    ${lifecycleHtml(v, trips)}
                    ${rowsHtml(trips, { key: x => x.trip.id, cls: 'bk-trip-rows', cols: '34px 118px 62px minmax(0,1fr) 62px auto', empty: 'No trips',
                        open: trips.length === 1 ? trips[0].trip.id : null, line: x => tripLine(v, x), detail: x => tripDetail(v, x) })}
                </section>
                <section class="bk-card">
                    <div class="bk-card-head">${icon('arrow-in')}<b>Payments</b><span class="muted small">${money(t.paid)} received${v.payments.length ? ` · ${plural(v.payments.length, 'payment')}` : ''}</span>
                        <span class="spacer"></span>${manage() && o.status !== 'CANCELLED' ? `<button class="btn sm ghost" data-act="pay">${icon('plus')}Record</button>` : ''}</div>
                    ${v.payments.length ? `<div class="bk-pays">${v.payments.map(p => `<div class="bk-pay ${p.payment.status === 'CLAIMED' ? 'claimed' : ''}">
                        <span class="chip-icon sm ${p.payment.status === 'CLAIMED' ? 'gold' : 'aqua'}">${icon(p.payment.status === 'CLAIMED' ? 'bell' : 'check')}</span>
                        <div class="grow min-0"><b>${p.payment.status === 'CLAIMED' ? 'Reported by the customer' : esc(p.payment.receiptNo || 'Receipt')}</b>
                            <small class="ellipsis">${shortDate(p.payment.receivedOn)} · ${esc(p.payment.mode)}${p.payment.reference ? ` · ${esc(p.payment.reference)}` : ''}${p.account ? ` · into ${esc(p.account)}` : ''}${p.entryNo ? ` · ${esc(p.entryNo)}` : ''}</small></div>
                        <b class="bk-pay-amt">${money(p.payment.amount)}</b>
                        ${manage() ? `<span class="bk-acts">${p.payment.status === 'CLAIMED' ? `<button class="btn sm primary" data-confirm="${p.payment.id}">${icon('check')}Confirm</button>` : ''}
                            <button class="btn sm ghost icon danger" data-del-pay="${p.payment.id}" title="${p.payment.status === 'CLAIMED' ? 'Not received' : 'Delete'}">${icon('trash')}</button></span>` : ''}</div>`).join('')}</div>`
                        : '<p class="small muted bk-none">Nothing received yet.</p>'}
                </section>
                ${v.links.length ? `<section class="bk-card"><div class="bk-card-head">${icon('link')}<b>Shared with the customer</b></div><div class="bk-links">${v.links.map(l => `<div class="${esc(l.status)}">
                    <span class="badge ${l.status === 'ACTIVE' ? 'good' : 'gray'} sm">${esc(l.status.toLowerCase())}</span>
                    <small>${esc(l.createdByName)} · ${dateTime(l.createdAt)} → ${dateTime(l.expiresAt)} · ${plural(l.views, 'view')}${l.lastViewedAt ? `, last ${dateTime(l.lastViewedAt)}` : ''}</small>
                    ${l.status === 'ACTIVE' && manage() ? `<button class="btn sm ghost" data-revoke="${l.id}">Stop</button>` : ''}</div>`).join('')}</div></section>` : ''}
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
                        <div><dt>Loading</dt><dd>${esc(v.loadingTeam || '—')}</dd></div><div><dt>Unloading</dt><dd>${esc(v.unloadingTeam || '—')}</dd></div></dl>
                    ${o.note ? `<p class="small muted bk-note-p">${icon('info')}${esc(o.note)}</p>` : ''}</section>
            </aside>
        </div>
    </div>`;
}

/** The bill (or the invoice, once paid in full) as its document: checked, printed. */
export function openBillDoc(v) {
    const html = billDocHtml(billFromView(v));
    openModal({
        title: v.invoice ? `Invoice ${v.invoice.invoiceNo}` : `Bill for ${v.order.orderNo}`, iconName: 'receipt', size: 'xl',
        sub: `${v.order.customerName} · ${money(v.totals.total)}${v.invoice ? ' · paid in full, digitally signed' : ` · balance ${money(v.totals.balance)}`}`,
        body: `<div class="bd-wrap">${html}</div>`,
        onOpen: m => { if (v.invoice) verifyDoc(m.el, v.invoice.payload, v.invoice.signature, v.publicKey); },
        actions: [{ label: 'Close' }, { label: 'Print', kind: 'primary', iconName: 'printer', onClick: () => {
            if (!printDoc(html, v.invoice ? v.invoice.invoiceNo : v.order.orderNo)) toast('Allow pop-ups to print', 'error');
            return true;
        } }],
    });
}

/** Wires an order's page drawn with orderHtml; changed(view, message) after each change. */
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
    host.onclick = async e => {
        const tripEl = e.target.closest('.bk-trip-rows [data-key]');
        const trip = tripEl ? v.trips.find(x => String(x.trip.id) === tripEl.dataset.key) : null;
        const step = e.target.closest('[data-step]');
        if (step && trip) {
            const to = step.dataset.step;
            if (to === 'DELIVERED' && trip.trip.status !== 'DELIVERED') return openDelivered(v, trip, nv => changed(nv, `Trip ${trip.trip.tripNo} delivered`));
            if (BACK[trip.trip.status] === to && !await confirmDialog(`Take trip ${trip.trip.tripNo} back to “${TRIP_STEPS.find(x => x[0] === to)[1]}”?${trip.trip.status === 'DELIVERED' ? ' Its bill leaves the books.' : ''}`,
                { confirmLabel: 'Take back' })) return;
            return run(() => api.post(`/bricks/orders/${id}/trips/${trip.trip.id}/step`, { status: to }), `Trip ${trip.trip.tripNo}: ${TRIP_STEPS.find(x => x[0] === to)[1].toLowerCase()}`);
        }
        if (e.target.closest('[data-counts]') && trip) return openDelivered(v, trip, nv => changed(nv, 'Counts saved'), true);
        if (e.target.closest('[data-edit-trip]') && trip) return openTrip(v, trip, nv => changed(nv, 'Trip saved'));
        if (e.target.closest('[data-drop-trip]') && trip) {
            if (await confirmDialog(`Drop trip ${trip.trip.tripNo}? Its bricks wait for another trip.`, { confirmLabel: 'Drop' })) run(() => api.del(`/bricks/orders/${id}/trips/${trip.trip.id}`), 'Trip dropped');
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
        if (act === 'edit') return openOrder(v, nv => changed(nv, 'Order saved'));
        if (act === 'bill') return openBillDoc(v);
        if (act === 'pay') return openPayment(v, nv => changed(nv, 'Payment recorded'));
        if (act === 'share') return openShare(v, () => api.get(`/bricks/orders/${id}`).then(nv => changed(nv)));
        if (act === 'add-trip') return run(() => api.post(`/bricks/orders/${id}/trips`), 'Trip planned');
        if (act === 'replan') return run(() => api.post(`/bricks/orders/${id}/replan`), 'Trips planned again');
        if (act === 'waive') {
            if (v.order.deliveryWaived) return run(() => api.post(`/bricks/orders/${id}/waive`, { waive: false }), 'Delivery charged again');
            return openWaive(v, nv => changed(nv, 'Delivery charges waived'));
        }
        if (act === 'cancel' && await confirmDialog(`Cancel order ${v.order.orderNo}?`, { confirmLabel: 'Cancel order' })) return run(() => api.post(`/bricks/orders/${id}/cancel`), 'Order cancelled');
    };
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
    const meta = await loadMeta();
    const tr = t.trip;
    openModal({
        title: `Trip ${tr.tripNo}`, iconName: 'truck',
        body: `<form class="form-grid two">
            ${field({ label: 'Vehicle', name: 'vehicleId', type: 'select', value: tr.vehicleId, options: vehicleOptions(meta.vehicles, tr.vehicleId) })}
            ${field({ label: 'Day', name: 'scheduledOn', type: 'date', value: tr.scheduledOn })}
            ${field({ label: 'Driver', name: 'driverId', type: 'select', value: tr.driverId, options: resourceOptions(meta.resources, tr.driverId, { roles: ['DRIVER'] }) })}
            ${field({ label: 'Loading team', name: 'loadingTeamId', type: 'select', value: tr.loadingTeamId, options: resourceOptions(meta.resources, tr.loadingTeamId, { roles: ['LOADING_TEAM'] }) })}
            ${field({ label: 'Unloading team', name: 'unloadingTeamId', type: 'select', value: tr.unloadingTeamId, options: resourceOptions(meta.resources, tr.unloadingTeamId, { roles: ['LOADING_TEAM'] }) })}
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
    const accounts = await moneyAccounts();
    const meta = await loadMeta();
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
    const accounts = await moneyAccounts();
    const meta = await loadMeta();
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

function openWaive(v, after) {
    openModal({
        title: 'Waive the delivery charges', iconName: 'tag', sub: `${plural(v.totals.trips, 'trip')} × ${money(v.totals.deliveryPerTrip)}`,
        body: `<form class="form-grid one">${field({ label: 'Why', name: 'reason', required: true, placeholder: 'Regular customer' })}
            <p class="hint">Trips already delivered are billed again without the charge.</p></form>`,
        actions: [{ label: 'Cancel' }, { label: 'Waive', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            after(await api.post(`/bricks/orders/${v.order.id}/waive`, { waive: true, reason: f.reason.value }));
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
