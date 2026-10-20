/**
 * Brick Management forms: the set-up (brick types, raw materials, pricing models, vehicles, the business's settings
 * with the signatures for payment slips), production (a batch with its raw material count, raw material bought,
 * production expenses), the team, and the brick book's accounts.
 */
import { api } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { esc, field, readForm, openModal, toast, loadingDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money } from '../core/format.js';
import { padHtml, bindPad, signatureSvg } from '../core/bond.js';
import { noAutofill } from './brick-orders.js';
import { loadMeta, setMeta, num, count, qty, plural, today, dayLabel, moneyAccounts, moneyOptions, resourceOptions, roleName, ROLE_CHOICES, categoryOf, makesBricks, suggest, headIcon, manage } from './brick-common.js';

// ===================================================================== set-up

export function openType(type, after) {
    const t = type || { curingDays: 14, openingStock: 0, active: true, color: '#b4532a' };
    openModal({
        title: type ? `Edit ${type.name}` : 'New brick type', iconName: 'brick', sub: 'A size or kind you make and sell, e.g. 16X4X8 Dies',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', value: t.name, required: true, span: 'span-2', placeholder: '16X4X8 Dies' })}
            ${field({ label: 'MRP (₹ a brick)', name: 'mrp', type: 'number', value: t.mrp, hint: 'Filled in on new orders; a lower agreed price shows as a discount' })}
            ${field({ label: 'Lowest price without approval (₹)', name: 'minPrice', type: 'number', value: t.minPrice, hint: 'A maker’s order below it waits for a checker; empty: any price' })}
            ${field({ label: 'Curing days', name: 'curingDays', type: 'number', value: t.curingDays, hint: 'Before a new batch is ready to sell' })}
            ${field({ label: 'Opening stock', name: 'openingStock', type: 'number', value: t.openingStock, hint: 'Bricks in the yard before the first batch here' })}
            ${type ? field({ label: 'Still made and sold', name: 'active', type: 'checkbox', value: t.active !== false }) : ''}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            if (!type) d.active = true;
            after(setMeta(type ? await api.put(`/bricks/types/${type.id}`, d) : await api.post('/bricks/types', d)), 'Brick type saved');
        } }],
    });
}

export function openMaterial(mat, after) {
    const t = mat || { unit: 'Ton', openingStock: 0, active: true };
    openModal({
        title: mat ? `Edit ${mat.name}` : 'New raw material', iconName: 'box',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', value: t.name, required: true, span: 'span-2', placeholder: 'Robo Sand' })}
            <label class="field"><span>Unit *</span><input name="unit" required value="${esc(t.unit)}" list="bk-units"><datalist id="bk-units">
                ${['Ton', 'Bag', 'CFT', 'Brass', 'Unit', 'Kg', 'Litre', 'Load'].map(u => `<option value="${u}">`).join('')}</datalist></label>
            ${field({ label: 'Opening stock', name: 'openingStock', type: 'number', value: t.openingStock, hint: 'In the yard before the first batch here' })}
            ${field({ label: 'Reorder below', name: 'reorderLevel', type: 'number', value: t.reorderLevel, hint: 'Flags it as low on the dashboard' })}
            ${mat ? field({ label: 'Still used', name: 'active', type: 'checkbox', value: t.active !== false }) : ''}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            if (!mat) d.active = true;
            after(setMeta(mat ? await api.put(`/bricks/materials/${mat.id}`, d) : await api.post('/bricks/materials', d)), 'Raw material saved');
        } }],
    });
}

export async function openModel(model, after) {
    const meta = await loadingDialog('Opening the pricing model…', () => loadMeta());
    if (!meta) return;
    const m0 = model ? model.model : { active: true, defaultModel: !meta.models.length };
    const rates = model ? model.rates : {};
    openModal({
        title: model ? `Edit ${m0.name}` : 'New pricing model', iconName: 'percent', size: 'lg',
        sub: 'What a production team earns for each good brick it makes',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', value: m0.name, required: true, placeholder: 'Standard rates' })}
            ${field({ label: 'Default for new batches', name: 'defaultModel', type: 'checkbox', value: m0.defaultModel })}
            ${field({ label: 'Note', name: 'note', value: m0.note, span: 'span-2' })}
            <div class="span-2 bk-rates">${meta.types.filter(t => t.active || rates[t.id] !== undefined).map(t => `
                <label class="bk-rate"><b>${esc(t.name)}</b>
                    <span class="bk-rate-in">₹<input type="number" step="any" min="0" data-rate="${t.id}" value="${rates[t.id] ?? ''}" placeholder="0.00"><small>a brick</small></span>
                    <small class="muted" data-per1000="${t.id}">${rates[t.id] ? `${money(num(rates[t.id]) * 1000)} per 1,000` : ''}</small></label>`).join('')}</div>
            ${model ? field({ label: 'In use', name: 'active', type: 'checkbox', value: m0.active !== false }) : ''}
        </form>`,
        onOpen: m => m.el.addEventListener('input', e => {
            const id = e.target.dataset.rate;
            if (id) m.el.querySelector(`[data-per1000="${id}"]`).textContent = e.target.value ? `${money(num(e.target.value) * 1000)} per 1,000` : '';
        }),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            Object.keys(d).forEach(k => { if (!['name', 'defaultModel', 'note', 'active'].includes(k)) delete d[k]; });
            if (!model) d.active = true;
            d.rates = [...f.querySelectorAll('[data-rate]')].filter(i => i.value !== '').map(i => ({ brickTypeId: Number(i.dataset.rate), rate: Number(i.value) }));
            after(setMeta(model ? await api.put(`/bricks/pricing-models/${m0.id}`, d) : await api.post('/bricks/pricing-models', d)), 'Pricing model saved');
        } }],
    });
}

export async function openVehicle(v0, after) {
    const meta = await loadingDialog('Opening the vehicle…', () => loadMeta());
    if (!meta) return;
    const v = v0 || { active: true, companyOwned: true };
    const own = v.companyOwned !== false;
    openModal({
        title: v0 ? `Edit ${v0.number}` : 'Enrol a vehicle', iconName: 'truck',
        sub: 'One you use again and again. A vehicle hired for one order need not be enrolled: pick “Hired vehicle” on the order',
        body: `<form class="form-grid two">
            <div class="field span-2"><span>Owned by</span><div class="seg-chips">
                <button type="button" class="seg-chip ${own ? 'active' : ''}" data-own="1">${icon('building')}Company vehicle</button>
                <button type="button" class="seg-chip ${own ? '' : 'active'}" data-own="0">${icon('key')}Hired regularly</button></div>
                <input type="hidden" name="companyOwned" value="${own}"></div>
            ${field({ label: 'Number', name: 'number', value: v.number, required: true, placeholder: 'TS 09 AB 1234' })}
            <label class="field"><span>Kind</span><input name="kind" value="${esc(v.kind || '')}" list="bk-vkinds" placeholder="Tractor"><datalist id="bk-vkinds">
                ${['Tractor', 'Mini truck', 'Lorry', 'Tipper', 'Auto'].map(k => `<option value="${k}">`).join('')}</datalist></label>
            ${field({ label: 'Bricks a trip', name: 'capacity', type: 'number', value: v.capacity, required: true, hint: 'Orders are split into trips of this size' })}
            ${field({ label: 'Usual driver', name: 'driverId', type: 'select', value: v.driverId, options: resourceOptions(meta.resources, v.driverId, { roles: ['DRIVER'], placeholder: 'None' }) })}
            ${field({ label: 'Note', name: 'note', value: v.note, span: 'span-2' })}
            ${v0 ? field({ label: 'In use', name: 'active', type: 'checkbox', value: v.active !== false }) : ''}
        </form>`,
        onOpen: m => m.el.addEventListener('click', e => {
            const o = e.target.closest('[data-own]');
            if (!o) return;
            m.el.querySelectorAll('[data-own]').forEach(x => x.classList.toggle('active', x === o));
            m.el.querySelector('[name=companyOwned]').value = o.dataset.own === '1';
        }),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.companyOwned = d.companyOwned === 'true';
            if (!v0) d.active = true;
            after(setMeta(v0 ? await api.put(`/bricks/vehicles/${v0.id}`, d) : await api.post('/bricks/vehicles', d)), 'Vehicle saved');
        } }],
    });
}

export async function openSettings(after, section = null) {
    const got = await loadingDialog('Opening the settings…', () => Promise.all([loadMeta(true), moneyAccounts()]));
    if (!got) return;
    const [meta, accounts] = got;
    const s = meta.settings;
    const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    openModal({
        title: 'Brick business settings', iconName: 'settings', size: 'lg',
        body: `<form class="form-grid two bk-settings">
            <div class="section-title span-2" data-sec="delivery">${icon('truck')} Delivery and handling</div>
            ${field({ label: 'Delivery charge a trip (₹)', name: 'deliveryChargePerTrip', type: 'number', value: s.deliveryChargePerTrip })}
            ${field({ label: 'Free delivery from (bricks)', name: 'freeDeliveryMinQty', type: 'number', value: s.freeDeliveryMinQty, hint: 'Orders this big get delivery waived; empty: never' })}
            ${field({ label: 'Driver incentive a trip (₹)', name: 'driverIncentivePerTrip', type: 'number', value: s.driverIncentivePerTrip, hint: 'A driver can have their own on their card' })}
            ${field({ label: 'Bill loading & unloading to customers', name: 'billHandling', type: 'checkbox', value: s.billHandling })}
            ${field({ label: 'Loading (₹ a brick)', name: 'loadingRate', type: 'number', value: s.loadingRate, hint: 'Earned by the loading team' })}
            ${field({ label: 'Unloading (₹ a brick)', name: 'unloadingRate', type: 'number', value: s.unloadingRate, hint: 'Earned by the unloading team' })}
            <div class="section-title span-2" data-sec="payments">${icon('qr')} Customer payments</div>
            ${field({ label: 'UPI ID', name: 'upiId', value: s.upiId, placeholder: 'name@okicici', hint: 'On the order link: pay with GPay, PhonePe, BHIM or the QR code' })}
            ${field({ label: 'Payee name', name: 'payeeName', value: s.payeeName, hint: 'The name the UPI app shows' })}
            ${field({ label: 'Customer payments go to', name: 'receiptAccountId', type: 'select', value: s.receiptAccountId, options: moneyOptions(accounts, s.receiptAccountId, 'Brick · cash') })}
            ${field({ label: 'Pay wages and bills from', name: 'payAccountId', type: 'select', value: s.payAccountId, options: moneyOptions(accounts, s.payAccountId, 'Brick · cash') })}
            <div class="section-title span-2" data-sec="slips">${icon('stamp')} Payment slips</div>
            ${field({ label: 'Company name (on the stamp)', name: 'companyName', value: s.companyName })}
            ${field({ label: 'Phone', name: 'phone', value: s.phone })}
            ${field({ label: 'Address', name: 'address', value: s.address, span: 'span-2' })}
            ${field({ label: 'Owner', name: 'ownerName', value: s.ownerName })}
            ${field({ label: 'Accountant', name: 'accountantName', value: s.accountantName })}
            <div class="bk-sign-cell">${s.ownerSignature ? `<div class="bk-sign-have">${signatureSvg(s.ownerSignature)}<button type="button" class="link-btn" data-resign="owner">Sign again</button></div>` : ''}
                <div ${s.ownerSignature ? 'hidden' : ''} data-pad-wrap="owner">${padHtml('owner', 'Owner’s signature')}</div></div>
            <div class="bk-sign-cell">${s.accountantSignature ? `<div class="bk-sign-have">${signatureSvg(s.accountantSignature)}<button type="button" class="link-btn" data-resign="accountant">Sign again</button></div>` : ''}
                <div ${s.accountantSignature ? 'hidden' : ''} data-pad-wrap="accountant">${padHtml('accountant', 'Accountant’s signature')}</div></div>
            ${field({ label: 'Weekly payday', name: 'payDay', type: 'select', value: s.payDay || 6, options: DAYS.slice(1).map((d, i) => ({ value: i + 1, label: d })) })}
            <div class="section-title span-2" data-sec="heads">${icon('receipt')} Production expense heads</div>
            ${field({ label: 'Heads (one a line)', name: 'heads', type: 'textarea', value: meta.expenseHeads.join('\n'), span: 'span-2' })}
        </form>`,
        onOpen: m => {
            // opened for one topic of the set-up: start at its part of the form
            if (section) setTimeout(() => m.el.querySelector(`[data-sec="${section}"]`)?.scrollIntoView({ block: 'start' }), 40);
            m.pads = { owner: bindPad(m.el, 'owner'), accountant: bindPad(m.el, 'accountant') };
            m.resign = {};
            m.el.addEventListener('click', e => {
                const b = e.target.closest('[data-resign]');
                if (!b) return;
                m.resign[b.dataset.resign] = true;
                b.closest('.bk-sign-have').hidden = true;
                m.el.querySelector(`[data-pad-wrap="${b.dataset.resign}"]`).hidden = false;
            });
        },
        actions: [{ label: 'Cancel' }, { label: 'Save settings', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.expenseHeads = String(d.heads || '').split('\n').map(x => x.trim()).filter(Boolean);
            delete d.heads;
            const sig = (who, had) => {
                const pad = m.pads[who];
                if (pad && !pad.empty()) return pad.path();
                return had && !m.resign[who] ? had : null;
            };
            d.ownerSignature = sig('owner', s.ownerSignature);
            d.accountantSignature = sig('accountant', s.accountantSignature);
            after(setMeta(await api.put('/bricks/settings', d)), 'Settings saved');
        } }],
    });
}

// ===================================================================== production

/**
 * A batch, laid out as the chit payout is: on the left the date, the team (the default team already picked) and the
 * pricing model in one row, then one line per brick type (made, damaged, what is good and what it earns) and one line per
 * raw material (opening, received, left now, used); on the right what the batch comes to: good bricks and damage, the
 * team's pay and the raw material used.
 */
export async function openBatch(batch, after) {
    let meta = await loadingDialog(batch ? 'Opening the batch…' : 'Getting the batch ready…', () => loadMeta());
    if (!meta) return;
    const b = batch?.batch || { producedOn: today() };
    const defaultModel = meta.models.find(m => m.model.defaultModel) || meta.models[0];
    const paid = !!batch?.paidOn;
    const had = Object.fromEntries((batch?.items || []).map(i => [i.brickTypeId, i]));
    const counted = Object.fromEntries((batch?.materials || []).filter(f => f.counted).map(f => [f.materialId, f.closing]));
    const makers = meta.resources.filter(r => (r.active && makesBricks(r)) || r.id === b.teamId);
    // other labour can make a batch now and then; staff never do
    const others = meta.resources.filter(r => r.active && !makesBricks(r) && categoryOf(r) !== 'STAFF' && r.id !== b.teamId);
    // a new batch starts with the default team, else the only production team there is
    const teamId0 = batch ? b.teamId : (makers.find(r => r.defaultTeam) || (makers.length === 1 ? makers[0] : null))?.id ?? null;
    const payText = r => r.salaryType === 'PIECE' ? 'paid by the brick' : r.salaryType === 'WEEKLY' ? 'weekly wage' : 'monthly salary';
    const teamMeta = r => [r.defaultTeam ? 'default team' : '', roleName(r.role), r.memberCount ? `${r.memberCount} people` : '', payText(r)].filter(Boolean).join(' · ');
    const teamOpts = `<option value="" data-meta="nobody earns for this batch">No team</option>
        <optgroup label="Production">${makers.map(r => `<option value="${r.id}" data-meta="${esc(teamMeta(r))}" ${String(r.id) === String(teamId0) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>
        ${others.length ? `<optgroup label="Other labour">${others.map(r => `<option value="${r.id}" data-meta="${esc(teamMeta(r))}">${esc(r.name)}</option>`).join('')}</optgroup>` : ''}`;
    const typeRow = t => `<tr class="bkb-row" data-type="${t.id}">
        <td><b>${esc(t.name)}</b><small data-rate></small></td>
        <td><div class="bkb-made"><input type="number" min="0" step="1" inputmode="numeric" class="num" data-qty value="${had[t.id]?.quantity ?? ''}" placeholder="0" ${paid ? 'disabled' : ''}>
            ${paid ? '' : `<span class="bkb-quick">${[500, 1000].map(n => `<button type="button" data-add="${n}" title="Add ${n.toLocaleString('en-IN')}">+${n >= 1000 ? `${n / 1000}k` : n}</button>`).join('')}</span>`}</div></td>
        <td><input type="number" min="0" step="1" inputmode="numeric" class="num" data-damaged value="${had[t.id]?.damaged || ''}" placeholder="0" ${paid ? 'disabled' : ''}></td>
        <td class="r" data-good>—</td><td class="r" data-amount>—</td></tr>`;
    openModal({
        title: batch ? `Batch ${b.batchNo}` : 'New production batch', iconName: 'factory', size: 'xl bk-batch-modal bk-tinted',
        sub: paid ? `The team was paid for it on slip ${batch.paidOn}${batch.paidDate ? ` (${batch.paidDate})` : ''}: only the raw material count and the note can change` : 'The bricks a team made, and the raw material left after it',
        body: `<form class="bkb bk-compact bkb-tint" autocomplete="off" onsubmit="return false"><div class="bkb-left">
            <div class="bkb-head">
                <span class="chip-icon">${icon('factory')}</span>
                <div class="grow min-0"><b data-h-team>—</b><small data-h-note></small></div>
                <div class="bkb-head-amt"><small>Good bricks</small><b data-s-good>0</b></div>
            </div>
            <section class="bko-sec s-customer"><div class="bko-sec-h">${icon('calendar')}<b>The batch</b><small>when, who made it, the rates they earn by and a note</small></div>
            <div class="bko-grid bko-cols3">
                <label class="field"><span>Made on</span><input type="date" name="producedOn" value="${esc(b.producedOn)}" max="${today()}" required ${paid ? 'readonly' : ''}></label>
                <label class="field"><span>Team</span><select name="teamId" data-search ${paid ? 'disabled' : ''}>${teamOpts}</select></label>
                <label class="field"><span>Pricing model</span><select name="pricingModelId" data-search ${paid ? 'disabled' : ''}>${meta.models.filter(m => m.model.active || m.model.id === b.pricingModelId)
                    .map(m => `<option value="${m.model.id}" data-meta="${esc([m.model.defaultModel ? 'default' : '', meta.types.filter(t => t.active && m.rates[t.id] !== undefined).map(t => `${t.name} ₹${m.rates[t.id]}`).slice(0, 3).join(', ')].filter(Boolean).join(' · '))}"
                        ${String(m.model.id) === String(b.pricingModelId || defaultModel?.model.id) ? 'selected' : ''}>${esc(m.model.name)}</option>`).join('')}</select></label>
                <label class="field bko-span3"><span>Note</span><input name="note" maxlength="300" value="${esc(b.note || '')}" placeholder="Shift, weather, machine…"></label>
            </div></section>
            <section class="bko-sec s-bricks"><div class="bko-sec-h">${icon('brick')}<b>Bricks made</b><small>type the count or add 500 / 1,000 at a time</small>
                ${paid ? '' : `<button type="button" class="link-btn" data-add-type>${icon('plus')}Another type</button>`}</div>
            <table class="grid compact bkb-table bkb-types-t"><thead><tr><th>Type</th><th>Made</th><th>Damaged</th><th class="r">Good</th><th class="r">Earns</th></tr></thead>
                <tbody data-types>${meta.types.filter(t => t.active || had[t.id]).map(typeRow).join('')}</tbody></table></section>
            <section class="bko-sec s-delivery"><div class="bko-sec-h">${icon('box')}<b>Raw material left</b><small>count what is left after the batch; leave it empty when not counted</small></div>
            <div data-mats><div class="loading"><div class="spinner"></div></div></div></section>
        </div>
        <aside class="bkb-right">
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('layers')}The batch</div>
                <div class="hc-pr-figs"><span><small>Made</small><b data-s-made>0</b></span><span><small>Damaged</small><b data-s-dmg>0</b></span><span><small>Good</small><b data-s-good2>0</b></span></div>
                <i class="hc-alloc-bar bkb-dmgbar" title="Damage (the bar fills at 10%)"><em data-s-bar></em></i>
                <small class="muted" data-s-rate></small></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('hand-coins')}The team's pay</div><div data-s-pay></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('box')}Raw material used</div><div class="bkb-used" data-s-used><small class="muted">Count what is left to see it.</small></div></div>
        </aside></form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            noAutofill(f);
            let flows = [];
            const model = () => meta.models.find(x => String(x.model.id) === String(f.pricingModelId.value)) || defaultModel;
            const recalc = () => {
                const rates = model()?.rates || {};
                let tq = 0, td = 0, ta = 0;
                f.querySelectorAll('.bkb-row[data-type]').forEach(row => {
                    const id = row.dataset.type;
                    const q = num(row.querySelector('[data-qty]').value), d = Math.min(q, num(row.querySelector('[data-damaged]').value));
                    const rate = paid && had[id] ? num(had[id].rate) : num(rates[id]);
                    const rateEl = row.querySelector('[data-rate]');
                    rateEl.textContent = rate ? `₹${rate} a brick` : 'no rate in this model';
                    rateEl.classList.toggle('warn', !rate);
                    row.querySelector('[data-good]').innerHTML = q ? `<b>${count(q - d)}</b>${d ? `<small class="${d / q > 0.03 ? 'neg' : 'muted'}">${((d / q) * 100).toFixed(1)}% lost</small>` : ''}` : '<span class="muted">—</span>';
                    row.querySelector('[data-amount]').innerHTML = q && rate ? money(rate * (q - d)) : '<span class="muted">—</span>';
                    row.classList.toggle('filled', q > 0);
                    tq += q; td += d; ta += rate * (q - d);
                });
                const good = tq - td;
                f.querySelectorAll('[data-s-good], [data-s-good2]').forEach(x => { x.textContent = count(good); });
                f.querySelector('[data-s-made]').textContent = count(tq);
                f.querySelector('[data-s-dmg]').textContent = tq ? `${count(td)} · ${((td / tq) * 100).toFixed(1)}%` : '0';
                f.querySelector('[data-s-bar]').style.width = tq ? `${Math.min(100, (td / tq) * 1000)}%` : '0';
                f.querySelector('.bkb-dmgbar').classList.toggle('over', tq > 0 && td / tq > 0.03);
                f.querySelector('[data-s-rate]').textContent = tq ? (td / tq > 0.03 ? 'Damage is above 3%: worth a look at the mix or the curing' : 'Damage within 3%') : 'Nothing entered yet';
                const team = meta.resources.find(r => String(r.id) === String(f.teamId.value));
                f.querySelector('[data-h-team]').textContent = team ? team.name : 'No team';
                f.querySelector('[data-h-note]').textContent = team ? `${roleName(team.role)} · ${payText(team)}${team.memberCount ? ` · ${team.memberCount} people` : ''}` : 'Nobody earns for this batch';
                f.querySelector('[data-s-pay]').innerHTML = !team ? '<p class="small muted">No team: nobody earns for this batch.</p>'
                    : team.salaryType === 'PIECE' ? `<div class="bkb-pay"><span>${esc(team.name)} earns</span><b>${money(ta)}</b></div>
                        <small class="muted">${good ? `₹${(ta / good).toFixed(2)} a good brick · ` : ''}paid with the next weekly slip</small>`
                    : `<div class="bkb-pay"><span>${esc(team.name)}</span><b>${money(team.salaryAmount)}<small>/${team.salaryType === 'WEEKLY' ? 'week' : 'month'}</small></b></div>
                        <small class="muted">On a ${team.salaryType === 'WEEKLY' ? 'weekly wage' : 'salary'}: the batch adds nothing to their pay.</small>`;
            };
            const drawMats = () => {
                f.querySelector('[data-mats]').innerHTML = flows.length ? `<table class="grid compact bkb-table mats"><thead><tr><th>Material</th><th class="r">Opening</th><th class="r">Received</th>
                    <th class="r">Available</th><th>Left now</th><th>Used</th></tr></thead><tbody>${flows.map(x => {
                    const avail = num(x.opening) + num(x.received);
                    return `<tr class="bkb-mat" data-mat="${x.materialId}"><td><b>${esc(x.name)}</b><small>${esc(x.unit)}</small></td>
                        <td class="r">${qty(x.opening)}</td><td class="r ${num(x.received) ? 'pos' : 'muted'}">${num(x.received) ? '+' + qty(x.received) : '—'}</td><td class="r"><b>${qty(avail)}</b></td>
                        <td><input type="number" step="any" min="0" class="num" data-close="${x.materialId}" value="${esc(counted[x.materialId] ?? '')}" placeholder="${esc(qty(avail))}"></td>
                        <td><div class="bkb-use"><i><em data-used-bar="${x.materialId}"></em></i><span data-used="${x.materialId}"></span></div></td></tr>`;
                }).join('')}</tbody></table>
                    <p class="bk-hint small muted">Available is the stock as it stands now. What is used is worked out from it and kept with the batch; purchases recorded later add to the stock, not to this batch. Once the next batch is made, this one is closed.</p>` : '<p class="small muted">No raw materials set up.</p>';
                usage();
            };
            const usage = () => {
                const used = [];
                flows.forEach(x => {
                    const v = f.querySelector(`[data-close="${x.materialId}"]`).value;
                    const avail = num(x.opening) + num(x.received);
                    const cell = f.querySelector(`[data-used="${x.materialId}"]`), bar = f.querySelector(`[data-used-bar="${x.materialId}"]`);
                    const row = f.querySelector(`[data-mat="${x.materialId}"]`);
                    if (v === '') { cell.innerHTML = '<small class="muted">not counted</small>'; bar.style.width = '0'; row.classList.remove('bad', 'set'); return; }
                    const u = avail - num(v);
                    row.classList.toggle('bad', u < 0);
                    row.classList.add('set');
                    cell.innerHTML = u < 0 ? `<b class="neg">${qty(u)}</b><small class="neg">more than there was</small>` : `<b>${qty(u)}</b>`;
                    bar.style.width = `${avail > 0 ? Math.max(0, Math.min(100, (u / avail) * 100)) : 0}%`;
                    if (u > 0) used.push(`<span>${esc(x.name)}<b>${qty(u)} ${esc(x.unit)}</b></span>`);
                });
                f.querySelector('[data-s-used]').innerHTML = used.length ? used.join('') : '<small class="muted">Count what is left to see it.</small>';
            };
            const preview = async () => {
                try { flows = await api.post(`/bricks/batches/preview?date=${f.producedOn.value}${batch ? `&batchId=${b.id}` : ''}`, {}); } catch { flows = []; }
                drawMats();
            };
            f.addEventListener('input', e => { if (e.target.dataset.close !== undefined) usage(); else recalc(); });
            f.addEventListener('change', e => { if (e.target.name === 'producedOn') preview(); recalc(); });
            f.addEventListener('click', e => {
                const add = e.target.closest('[data-add]');
                if (add) {
                    const input = add.closest('tr').querySelector('[data-qty]');
                    input.value = num(input.value) + Number(add.dataset.add);
                    recalc();
                }
                if (e.target.closest('[data-add-type]')) openType(null, fresh => {
                    meta = fresh;
                    const known = new Set([...f.querySelectorAll('.bkb-row[data-type]')].map(x => x.dataset.type));
                    const t = fresh.types.filter(x => !known.has(String(x.id))).at(-1);
                    if (t) f.querySelector('[data-types]').insertAdjacentHTML('beforeend', typeRow(t));
                    toast('Brick type added; set its rate in the pricing model', 'info');
                    recalc();
                });
            });
            recalc();
            preview();
            setTimeout(() => f.querySelector('[data-qty]:not([disabled])')?.focus(), 60);
        },
        actions: [{ label: 'Cancel' }, { label: batch ? 'Save batch' : 'Record batch', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const items = [...f.querySelectorAll('.bkb-row[data-type]')].map(x => ({ brickTypeId: Number(x.dataset.type),
                quantity: num(x.querySelector('[data-qty]').value), damaged: num(x.querySelector('[data-damaged]').value) })).filter(i => i.quantity > 0);
            if (!items.length) throw new Error('Enter how many bricks were made');
            const materials = [...f.querySelectorAll('[data-close]')].filter(i => i.value !== '').map(i => ({ materialId: Number(i.dataset.close), closing: Number(i.value) }));
            const body = { producedOn: f.producedOn.value, teamId: f.teamId.value ? Number(f.teamId.value) : null,
                pricingModelId: f.pricingModelId.value ? Number(f.pricingModelId.value) : null, note: f.note.value.trim() || null, items, materials };
            const saved = batch ? await api.put(`/bricks/batches/${b.id}`, body) : await api.post('/bricks/batches', body);
            after(saved, `Batch ${saved.batch.batchNo} ${batch ? 'saved' : 'recorded'} · ${count(saved.good)} good bricks`);
        } }],
    });
}

/**
 * Raw material bought, laid out as a production batch is: on the left the bill (day, vendor, bill no., paid from) and its
 * materials as compact lines (each picked from a list showing what is in the yard: quantity, rate, amount); on the right
 * what it comes to: the bill's total, the stock each material leaves and how long it lasts, and what was paid before.
 * Each line becomes a purchase, all in one go.
 */
export async function openPurchase(p0, after, { materialId = null } = {}) {
    const got = await loadingDialog('Getting the purchase ready…', () => Promise.all([loadMeta(), moneyAccounts(), api.get('/bricks/production').catch(() => null)]));
    if (!got) return;
    const [meta, accounts, prod] = got;
    const p = p0?.purchase || { receivedOn: today(), materialId, accountId: meta.settings.payAccountId };
    const mats = meta.materials.filter(x => x.active || x.id === p.materialId);
    const stockOf = id => (prod?.materials || []).find(x => x.materialId === Number(id));
    const matOf = id => meta.materials.find(x => String(x.id) === String(id));
    const purchases = prod?.purchases || [];
    const vendorStats = {};
    purchases.forEach(x => { if (!x.purchase.vendor) return; const v = vendorStats[x.purchase.vendor] ||= { n: 0, last: '', mats: new Set() }; v.n++; v.mats.add(x.material); if (x.purchase.receivedOn > v.last) v.last = x.purchase.receivedOn; });
    const opts = sel => `<option value="">Pick a material</option>${mats.map(x => {
        const st = stockOf(x.id);
        const meta = [st ? `${qty(st.stock)} ${x.unit} in the yard` : `no stock · ${x.unit}`, st?.low || (st && num(st.stock) <= 0) ? 'low' : '',
            st?.daysLeft !== null && st?.daysLeft !== undefined ? `${st.daysLeft} days left` : '', x.lastRate ? `last ₹${num(x.lastRate).toLocaleString('en-IN')}` : ''].filter(Boolean).join(' · ');
        return `<option value="${x.id}" data-meta="${esc(meta)}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`;
    }).join('')}`;
    const line = l => `<tr data-line>
        <td><select data-mat data-search required>${opts(l.materialId)}</select><small class="bk-free" data-now></small></td>
        <td><span class="bk-unit-in"><input type="number" step="any" min="0" class="num" data-qty required value="${esc(l.quantity ?? '')}" placeholder="0"><em data-unit>${esc(matOf(l.materialId)?.unit || '')}</em></span></td>
        <td><input type="number" step="any" min="0" class="num" data-rate value="${esc(l.rate ?? matOf(l.materialId)?.lastRate ?? '')}" placeholder="0"><small class="bk-free" data-last></small></td>
        <td><input type="number" step="any" min="0" class="num" data-amt required value="${esc(l.amount ?? '')}" placeholder="0"></td>
        <td><button type="button" class="btn sm ghost icon danger" data-rm title="Take it off">${icon('x')}</button></td></tr>`;
    openModal({
        title: p0 ? 'Raw material bought' : 'Record a purchase', iconName: 'box', size: 'xl bk-batch-modal bk-buy-modal bk-tinted',
        sub: 'One bill, one or more materials: they add to the stock and go to the books as raw material',
        body: `<form class="bkb bkp bk-compact" autocomplete="off" onsubmit="return false"><div class="bkb-left">
            <div class="bkb-head">
                <span class="chip-icon">${icon('box')}</span>
                <div class="grow min-0"><b data-h-vendor>${esc(p.vendor || 'A purchase')}</b><small data-h-note></small></div>
                <div class="bkb-head-amt"><small>Bill total</small><b data-h-total>₹0</b></div>
            </div>
            <section class="bko-sec s-customer"><div class="bko-sec-h">${icon('receipt')}<b>The bill</b><small>when it came, from whom and how it was paid</small></div>
            <div class="bko-grid bko-cols4">
                <label class="field"><span>Received on *</span><input type="date" name="receivedOn" required value="${esc(p.receivedOn)}" max="${today()}"></label>
                <label class="field"><span>Vendor</span><input name="vendor" value="${esc(p.vendor || '')}" placeholder="Who sold it"></label>
                <label class="field"><span>Bill no.</span><input name="billNo" value="${esc(p.billNo || '')}"></label>
                <label class="field"><span>Paid from</span><select name="accountId" data-search>${moneyOptions(accounts, p.accountId, 'Brick · cash')}</select></label>
            </div></section>
            <section class="bko-sec s-bricks"><div class="bko-sec-h">${icon('box')}<b>What came</b><small>a line a material: the amount fills from quantity × rate</small>
                ${p0 ? '' : `<button type="button" class="link-btn" data-add-line>${icon('plus')}Another material</button>`}</div>
            <table class="grid compact bkb-table bkp-lines bko-items"><thead><tr><th>Material</th><th>Quantity</th><th>Rate (₹)</th><th>Amount (₹)</th><th></th></tr></thead>
                <tbody data-lines>${line(p0 ? p : { materialId: p.materialId })}</tbody></table></section>
            <section class="bko-sec s-charges"><div class="bko-sec-h">${icon('truck')}<b>Transport &amp; note</b><small>the vehicle that brought it, anything to remember</small></div>
            <div class="bko-grid bko-cols4">
                <label class="field"><span>Vehicle no.</span><input name="vehicleNo" value="${esc(p.vehicleNo || '')}" placeholder="That brought it"></label>
                <label class="field bko-span3"><span>Note</span><input name="note" value="${esc(p.note || '')}" placeholder="Quality, moisture, short weight…"></label>
            </div></section>
        </div>
        <aside class="bkb-right">
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('receipt')}The bill</div><div class="bk-bill bko-bill" data-sum></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('layers')}Stock after it</div><div class="bkp-stock" data-stock><small class="muted">Pick a material to see its stock.</small></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('history')}Bought before</div><div class="bkp-hist" data-hist><small class="muted">The last purchases of the materials picked show here.</small></div></div>
        </aside></form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            noAutofill(f);
            const lines = () => [...f.querySelectorAll('[data-line]')];
            const recalc = () => {
                let total = 0;
                const stockRows = [], hist = [];
                lines().forEach(l => {
                    const id = l.querySelector('[data-mat]').value, x = matOf(id), st = stockOf(id);
                    const q = num(l.querySelector('[data-qty]').value), rate = num(l.querySelector('[data-rate]').value);
                    l.querySelector('[data-unit]').textContent = x?.unit || '';
                    l.querySelector('[data-now]').textContent = x ? (st ? `${qty(st.stock)} ${x.unit} in the yard${st.daysLeft !== null ? ` · ${st.daysLeft} days` : ''}` : 'no stock yet') : '';
                    const last = l.querySelector('[data-last]');
                    last.innerHTML = x?.lastRate ? `last ₹${num(x.lastRate).toLocaleString('en-IN')}${rate && rate > num(x.lastRate) ? ' <span class="warn">· dearer</span>' : rate && rate < num(x.lastRate) ? ' <span class="pos">· cheaper</span>' : ''}` : '';
                    total += num(l.querySelector('[data-amt]').value);
                    if (x) {
                        const now = num(st?.stock), after = Math.round((now + q) * 1000) / 1000;
                        const daily = num(st?.avgDailyUse);
                        stockRows.push(`<div><div class="bk-sr-line"><b>${esc(x.name)}</b><span>${qty(now)} → <b class="pos">${qty(after)}</b> ${esc(x.unit)}</span></div>
                            <i class="bk-meter ${after <= 0 ? 'critical' : 'good'}"><i style="width:${after <= 0 ? 0 : daily ? Math.min(100, (after / daily / 30) * 100) : 100}%"></i></i>
                            <small class="muted">${daily ? `lasts about ${Math.floor(after / daily)} days at ${qty(daily)} a day` : 'no use recorded yet'}</small></div>`);
                        purchases.filter(y => y.purchase.materialId === Number(id)).slice(0, 3)
                            .forEach(y => hist.push(`<div><span>${dayLabel(y.purchase.receivedOn)} · ${esc(x.name)}</span><b>${qty(y.purchase.quantity)} @ ₹${num(y.purchase.rate).toLocaleString('en-IN')}</b>
                                <small class="muted">${esc(y.purchase.vendor || 'no vendor')} · ${money(y.purchase.amount)}</small></div>`));
                    }
                    l.querySelectorAll('[data-mat] option').forEach(o => { o.disabled = !!o.value && o.value !== id && lines().some(y => y !== l && y.querySelector('[data-mat]').value === o.value); });
                });
                f.querySelector('[data-sum]').innerHTML = `${lines().map(l => {
                    const x = matOf(l.querySelector('[data-mat]').value);
                    return x ? `<div><span>${esc(x.name)} · ${qty(num(l.querySelector('[data-qty]').value))} ${esc(x.unit)}</span><b>${money(num(l.querySelector('[data-amt]').value))}</b></div>` : '';
                }).join('')}<div class="total"><span>Total</span><b>${money(total)}</b></div>`;
                f.querySelector('[data-stock]').innerHTML = stockRows.join('') || '<small class="muted">Pick a material to see its stock.</small>';
                f.querySelector('[data-hist]').innerHTML = hist.join('') || '<small class="muted">No earlier purchases of these.</small>';
                f.querySelector('[data-h-total]').textContent = money(total);
                f.querySelector('[data-h-vendor]').textContent = f.vendor.value.trim() || 'A purchase';
                f.querySelector('[data-h-note]').textContent = `${plural(lines().length, 'material')}${f.billNo.value ? ` · bill ${f.billNo.value}` : ''}`;
                f.querySelectorAll('[data-rm]').forEach(b => { b.hidden = lines().length < 2; });
            };
            f.addEventListener('input', e => {
                const l = e.target.closest('[data-line]');
                if (l && (e.target.matches('[data-qty]') || e.target.matches('[data-rate]'))) {
                    const q = num(l.querySelector('[data-qty]').value), r = num(l.querySelector('[data-rate]').value);
                    if (q && r) l.querySelector('[data-amt]').value = (q * r).toFixed(2);
                }
                recalc();
            });
            f.addEventListener('change', e => {
                if (e.target.matches('[data-mat]')) {
                    const l = e.target.closest('[data-line]');
                    if (e.target.value && lines().some(y => y !== l && y.querySelector('[data-mat]').value === e.target.value)) {
                        toast('That material is on the bill already: change its line instead', 'error');
                        e.target.value = '';
                        return recalc();
                    }
                    const last = matOf(e.target.value)?.lastRate;
                    const rate = l.querySelector('[data-rate]');
                    if (last && !rate.value) rate.value = last;
                    l.querySelector('[data-qty]').focus();
                }
                recalc();
            });
            f.addEventListener('click', e => {
                if (e.target.closest('[data-add-line]')) {
                    f.querySelector('[data-lines]').insertAdjacentHTML('beforeend', line({}));
                    recalc();
                    lines().at(-1).querySelector('[data-mat]').focus();
                }
                const rm = e.target.closest('[data-rm]');
                if (rm && lines().length > 1) { rm.closest('[data-line]').remove(); recalc(); }
            });
            suggest(f.vendor, Object.entries(vendorStats).sort((a, b) => b[1].last.localeCompare(a[1].last))
                .map(([name, v]) => ({ value: name, icon: 'building', sub: [...v.mats].slice(0, 3).join(', '),
                    meta: `<b>${plural(v.n, 'purchase')}</b><span>last ${dayLabel(v.last)}</span>` })), { onPick: recalc, title: 'Vendors you bought from' });
            recalc();
        },
        actions: [{ label: 'Cancel' }, { label: p0 ? 'Save' : 'Record purchase', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const shared = { receivedOn: f.receivedOn.value, vendor: f.vendor.value.trim() || null, billNo: f.billNo.value.trim() || null,
                vehicleNo: f.vehicleNo.value.trim() || null, note: f.note.value.trim() || null, accountId: f.accountId.value ? Number(f.accountId.value) : null };
            const lines = [...f.querySelectorAll('[data-line]')].map(l => ({ materialId: Number(l.querySelector('[data-mat]').value),
                quantity: num(l.querySelector('[data-qty]').value), rate: l.querySelector('[data-rate]').value === '' ? null : num(l.querySelector('[data-rate]').value),
                amount: num(l.querySelector('[data-amt]').value) }));
            if (lines.some(l => !l.materialId || !(l.quantity > 0))) throw new Error('Pick the material and its quantity on every line');
            const saved = p0 ? await api.put(`/bricks/purchases/${p.id}`, { ...shared, ...lines[0] }) : await api.post('/bricks/purchases/bill', { ...shared, lines });
            invalidateAccounts();
            after(saved, p0 ? 'Purchase saved' : `${plural(lines.length, 'material')} recorded · ${money(lines.reduce((t, l) => t + l.amount, 0))}`);
        } }],
    });
}

/**
 * A production expense (diesel, power, repairs …: anything production costs other than raw material), as the purchase is
 * laid out: on the left the head picked from tiles (a new one added on the spot), the bill (amount with the usual ones a
 * tap away, the day, what for, vendor, bill no.) and how it was paid and for which batch; on the right the entry as it
 * goes to the books, the head so far and its last bills (one tap repeats one). A new one can be saved and the next
 * started at once (Shift + Enter). {@code copy}: a new expense started from {@code e0}.
 */
let lastHead = null;

export async function openExpense(e0, after, { batchId = null, copy = false } = {}) {
    const editing = !!e0 && !copy;
    const got = await loadingDialog(editing ? 'Opening the expense…' : 'Getting the expense ready…', () => Promise.all([loadMeta(), moneyAccounts(), api.get('/bricks/production')]));
    if (!got) return;
    let [meta, accounts, prod] = got;
    const all = [...(prod.expenses || [])];
    const batches = (prod.batches || []).slice(0, 40);
    const src = e0?.expense;
    const e = src ? { ...src, ...(copy ? { id: null, spentOn: today(), billNo: '' } : {}) }
        : { spentOn: today(), batchId, head: lastHead && meta.expenseHeads.includes(lastHead) ? lastHead : meta.expenseHeads[0], accountId: meta.settings.payAccountId };
    const heads = [...meta.expenseHeads];
    if (e.head && !heads.includes(e.head)) heads.push(e.head);
    const month = today().slice(0, 7);
    const prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const rupees = v => `₹${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const statOf = h => {
        const mine = all.filter(x => x.expense.head === h && x.expense.id !== e.id);
        const sum = list => list.reduce((t, x) => t + num(x.expense.amount), 0);
        return { list: mine, n: mine.length, month: sum(mine.filter(x => x.expense.spentOn.startsWith(month))), prev: sum(mine.filter(x => x.expense.spentOn.startsWith(prev))),
            avg: mine.length ? sum(mine) / mine.length : 0, last: mine[0]?.expense.spentOn || null };
    };
    const tile = h => {
        const ic = headIcon(h), st = statOf(h);
        return `<button type="button" class="bkx-head ${h === e.head ? 'on' : ''}" data-pick-head="${esc(h)}"><span class="chip-icon sm ${ic.tone}">${icon(ic.name)}</span>
            <span class="min-0"><b class="ellipsis">${esc(h)}</b><small>${st.month ? `${rupees(st.month)} this month` : st.last ? `last ${dayLabel(st.last)}` : 'not used yet'}</small></span></button>`;
    };
    // many heads: a search over them, the ones used most first ("Other" last)
    const many = heads.length > 6;
    const uses = h => all.filter(x => x.expense.head === h).length;
    const ordered = many ? [...heads].sort((a, b) => (/^other/i.test(a) - /^other/i.test(b)) || uses(b) - uses(a)) : heads;
    const batchOpts = sel => `<option value="">Not for one batch</option>${batches.map(b => `<option value="${b.batch.id}" ${String(b.batch.id) === String(sel) ? 'selected' : ''}
        data-meta="${esc([dayLabel(b.batch.producedOn), `${count(b.total)} bricks`, b.teamName || ''].filter(Boolean).join(' · '))}">${esc(b.batch.batchNo)}</option>`).join('')}`;
    openModal({
        title: editing ? 'Production expense' : copy ? 'Repeat an expense' : 'New production expense', iconName: 'receipt', size: 'xl bk-batch-modal bk-buy-modal bk-xp-modal bk-tinted',
        sub: 'Anything production costs other than raw material: it goes to the books as a production expense',
        body: `<form class="bkb bkp bkx bk-compact" autocomplete="off" onsubmit="return false"><div class="bkb-left">
            <div class="bkb-head">
                <span class="chip-icon" data-h-icon></span>
                <div class="grow min-0"><b data-h-head></b><small data-h-note></small></div>
                <div class="bkb-head-amt"><small>Amount</small><b data-h-amt>₹0</b></div>
            </div>
            <section class="bko-sec s-bricks"><div class="bko-sec-h">${icon('tag')}<b>What it was for</b><small>pick the head; add one if it is not here</small>
                    ${many ? `<label class="search-box sm bkx-hsearch">${icon('search')}<input type="search" data-head-q placeholder="Find a head (${heads.length})" autocomplete="off"></label>` : ''}</div>
                <input type="hidden" name="head" value="${esc(e.head || '')}">
                <div class="bkx-heads ${many ? 'many' : ''}" data-heads>${ordered.map(tile).join('')}
                    <p class="bkx-nohead muted small" data-no-head hidden></p>
                    ${manage() ? `<button type="button" class="bkx-head add" data-new-head><span class="chip-icon sm">${icon('plus')}</span><span class="min-0"><b>New head</b><small>e.g. Generator rent</small></span></button>` : ''}</div>
                <div class="bkx-newhead" data-new-wrap hidden><input name="newHead" maxlength="40" placeholder="The new head, e.g. Generator rent">
                    <button type="button" class="btn sm primary" data-add-head>${icon('check')}Add</button><button type="button" class="btn sm ghost icon" data-cancel-head title="Never mind">${icon('x')}</button></div>
            </section>
            <section class="bko-sec s-customer"><div class="bko-sec-h">${icon('receipt')}<b>The bill</b><small>how much, when, and from whom</small></div>
                <div class="bko-grid bko-cols4">
                    <label class="field"><span>Amount (₹) *</span><input type="number" name="amount" min="0.01" step="any" class="num" required value="${esc(e.amount ?? '')}" placeholder="0"></label>
                    <label class="field"><span>Spent on *</span><input type="date" name="spentOn" required value="${esc(e.spentOn)}" max="${today()}"></label>
                    <label class="field"><span>Vendor</span><input name="vendor" maxlength="100" value="${esc(e.vendor || '')}" placeholder="Who was paid"></label>
                    <label class="field"><span>Bill no.</span><input name="billNo" maxlength="40" value="${esc(e.billNo || '')}"></label>
                    <label class="field bko-span4"><span>What for</span><input name="description" maxlength="200" value="${esc(e.description || '')}" placeholder="200 litres of diesel for the machine"></label>
                </div>
                <div class="bkx-quick"><span class="muted small">Usual</span><span data-quick></span><span class="spacer"></span>
                    <button type="button" class="seg-chip" data-day="${today()}">Today</button><button type="button" class="seg-chip" data-day="${yesterday}">Yesterday</button></div>
            </section>
            <section class="bko-sec s-charges"><div class="bko-sec-h">${icon('wallet')}<b>Paid &amp; linked</b><small>the money it came out of, and the batch it was for</small></div>
                <div class="bko-grid bko-cols2">
                    <label class="field"><span>Paid from</span><select name="accountId" data-search>${moneyOptions(accounts, e.accountId, 'Brick · cash')}</select></label>
                    <label class="field"><span>For a batch</span><select name="batchId" data-search>${batchOpts(e.batchId)}</select></label>
                </div>
            </section>
        </div>
        <aside class="bkb-right">
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('receipt')}The entry</div><div class="bk-bill bko-bill" data-sum></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('pie')}<span data-s-title>This head so far</span></div><div class="bkx-so" data-so></div></div>
            <div class="hc-pr-card"><div class="hc-pr-title">${icon('history')}Last bills<small class="muted">tap one to repeat it</small></div><div class="bkp-hist bkx-hist" data-hist></div></div>
        </aside></form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            noAutofill(f);
            const acct = () => f.accountId.selectedOptions[0]?.textContent.trim() || 'Brick · cash';
            const sync = () => {
                const h = f.head.value, ic = headIcon(h), st = statOf(h), amt = num(f.amount.value);
                f.querySelectorAll('[data-pick-head]').forEach(b => b.classList.toggle('on', b.dataset.pickHead === h));
                const hi = f.querySelector('[data-h-icon]');
                hi.className = `chip-icon ${ic.tone}`; hi.innerHTML = icon(ic.name);
                f.querySelector('[data-h-head]').textContent = h || 'Pick a head';
                f.querySelector('[data-h-note]').textContent = [f.vendor.value.trim(), f.spentOn.value ? dayLabel(f.spentOn.value) : ''].filter(Boolean).join(' · ') || 'A production expense';
                f.querySelector('[data-h-amt]').textContent = rupees(amt);
                const usual = [...new Set(st.list.map(x => num(x.expense.amount)))].slice(0, 4);
                f.querySelector('[data-quick]').innerHTML = usual.length ? usual.map(v => `<button type="button" class="seg-chip ${v === amt ? 'active' : ''}" data-amt="${v}">${rupees(v)}</button>`).join('')
                    : '<small class="muted">the amounts paid before for this head show here</small>';
                f.querySelectorAll('[data-day]').forEach(b => b.classList.toggle('active', b.dataset.day === f.spentOn.value));
                const batch = batches.find(b => String(b.batch.id) === f.batchId.value);
                f.querySelector('[data-sum]').innerHTML = `
                    <div><span>${esc(h || 'Head')}</span><b>${rupees(amt)}</b></div>
                    <div><span>Paid from</span><b>${esc(acct())}</b></div>
                    <div><span>On</span><b>${f.spentOn.value ? esc(dayLabel(f.spentOn.value)) : '—'}</b></div>
                    ${batch ? `<div><span>For batch</span><b>${esc(batch.batch.batchNo)}</b></div>` : ''}
                    ${f.billNo.value.trim() ? `<div><span>Bill no.</span><b>${esc(f.billNo.value.trim())}</b></div>` : ''}
                    <div class="total"><span>Production expense</span><b>${rupees(amt)}</b></div>
                    <small class="muted">${esc(acct())} goes down by ${rupees(amt)}.</small>`;
                f.querySelector('[data-s-title]').textContent = h ? `${h} so far` : 'This head so far';
                const after = st.month + (f.spentOn.value.startsWith(month) ? amt : 0);
                const diff = st.avg && amt ? (amt - st.avg) / st.avg * 100 : null;
                f.querySelector('[data-so]').innerHTML = `<div class="bk-kv">
                    <div><span>This month</span><b>${rupees(st.month)}${amt && f.spentOn.value.startsWith(month) ? ` → <span class="pos">${rupees(after)}</span>` : ''}</b></div>
                    <div><span>Last month</span><b>${rupees(st.prev)}</b></div>
                    <div><span>A bill, on average</span><b>${st.n ? rupees(Math.round(st.avg)) : '—'}</b></div>
                    <div><span>Bills</span><b>${count(st.n)}${st.last ? ` <small class="muted">· last ${esc(dayLabel(st.last))}</small>` : ''}</b></div></div>
                    ${diff !== null && Math.abs(diff) >= 25 ? `<small class="${diff > 0 ? 'warn' : 'pos'}">${icon(diff > 0 ? 'alert' : 'check')}${Math.round(Math.abs(diff))}% ${diff > 0 ? 'more' : 'less'} than a usual bill</small>` : ''}`;
                f.querySelector('[data-hist]').innerHTML = st.list.slice(0, 5).map(x => `<div class="bkx-repeat" data-repeat="${x.expense.id}" title="Use this bill again">
                    <span class="ellipsis">${esc(x.expense.description || x.expense.vendor || x.expense.head)}</span><b>${rupees(x.expense.amount)}</b>
                    <small class="muted">${esc(dayLabel(x.expense.spentOn))}${x.expense.vendor ? ` · ${esc(x.expense.vendor)}` : ''}${x.batchNo ? ` · ${esc(x.batchNo)}` : ''}</small></div>`).join('')
                    || '<small class="muted">No bills for this head yet.</small>';
            };
            const pickHead = h => { f.head.value = h; descs.sort((a, b) => (b.head === h) - (a.head === h)); sync(); };
            // what was written before, this head's first
            const descs = [...new Map(all.filter(x => x.expense.description).map(x => [x.expense.description.toLowerCase(), x])).values()]
                .map(x => ({ value: x.expense.description, sub: `${x.expense.head}${x.expense.vendor ? ` · ${x.expense.vendor}` : ''}`, meta: rupees(x.expense.amount), head: x.expense.head, x }));
            suggest(f.description, descs, { title: 'Written before', onPick: it => { if (!f.vendor.value && it.x.expense.vendor) f.vendor.value = it.x.expense.vendor; if (!f.amount.value) f.amount.value = num(it.x.expense.amount); sync(); } });
            const vendors = {};
            all.forEach(x => { const v = x.expense.vendor; if (!v) return; const s = vendors[v] ||= { n: 0, amt: 0, heads: new Set(), head: x.expense.head }; s.n++; s.amt += num(x.expense.amount); s.heads.add(x.expense.head); });
            suggest(f.vendor, Object.entries(vendors).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([v, s]) => ({ value: v, sub: `${plural(s.n, 'bill')} · ${[...s.heads].slice(0, 2).join(', ')}`, meta: rupees(s.amt), head: s.head })),
                { title: 'Paid before', onPick: it => { if (!src && !headTouched && it.head) pickHead(it.head); } });
            let headTouched = !!src;
            pickHead(f.head.value);
            const newWrap = f.querySelector('[data-new-wrap]');
            // the head search: tiles narrow as you type; Enter takes the first, nothing found offers it as a new head
            const hq = f.querySelector('[data-head-q]');
            const shownHeads = () => [...f.querySelectorAll('[data-pick-head]')].filter(b => !b.hidden);
            const filterHeads = () => {
                const q = (hq?.value || '').trim().toLowerCase();
                f.querySelectorAll('[data-pick-head]').forEach(b => { b.hidden = !!q && !b.dataset.pickHead.toLowerCase().includes(q); });
                const none = !!q && !shownHeads().length;
                const msg = f.querySelector('[data-no-head]');
                msg.hidden = !none;
                msg.innerHTML = none ? `No head called “${esc(hq.value.trim())}”.${manage() ? ' <button type="button" class="link-btn" data-add-typed>Add it as a new head</button>' : ''}` : '';
            };
            if (hq) {
                hq.addEventListener('input', ev => { ev.stopPropagation(); filterHeads(); });
                hq.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault(); ev.stopPropagation();
                        const first = shownHeads()[0];
                        if (first) { headTouched = true; pickHead(first.dataset.pickHead); hq.value = ''; filterHeads(); f.amount.focus(); }
                        else if (manage() && hq.value.trim()) { newWrap.hidden = false; f.newHead.value = hq.value.trim(); f.newHead.focus(); }
                    }
                    if (ev.key === 'Escape' && hq.value) { ev.preventDefault(); ev.stopPropagation(); hq.value = ''; filterHeads(); }
                });
                // the picked head in view
                setTimeout(() => f.querySelector('[data-pick-head].on')?.scrollIntoView({ block: 'nearest' }), 80);
            }
            const addHead = async () => {
                const name = f.newHead.value.trim();
                if (!name) return f.newHead.focus();
                const btn = f.querySelector('[data-add-head]');
                btn.classList.add('busy');
                try {
                    meta = setMeta(await api.post('/bricks/expense-heads', { name }));
                    const hit = meta.expenseHeads.find(h => h.toLowerCase() === name.toLowerCase()) || name;
                    if (!heads.includes(hit)) { heads.push(hit); f.querySelector('[data-new-head]').insertAdjacentHTML('beforebegin', tile(hit)); }
                    newWrap.hidden = true; f.newHead.value = '';
                    if (hq) { hq.value = ''; filterHeads(); }
                    headTouched = true;
                    pickHead(hit);
                    toast(`Head “${hit}” added`, 'info');
                    f.amount.focus();
                } catch (err) { toast(err.message, 'error'); } finally { btn.classList.remove('busy'); }
            };
            f.newHead.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); addHead(); } if (ev.key === 'Escape') { ev.stopPropagation(); newWrap.hidden = true; } });
            f.addEventListener('click', ev => {
                const ph = ev.target.closest('[data-pick-head]');
                if (ph) { headTouched = true; pickHead(ph.dataset.pickHead); return f.amount.focus(); }
                if (ev.target.closest('[data-new-head]')) { newWrap.hidden = false; return f.newHead.focus(); }
                if (ev.target.closest('[data-add-typed]')) { newWrap.hidden = false; f.newHead.value = hq.value.trim(); return f.newHead.focus(); }
                if (ev.target.closest('[data-cancel-head]')) { newWrap.hidden = true; return; }
                if (ev.target.closest('[data-add-head]')) return addHead();
                const qa = ev.target.closest('[data-amt]');
                if (qa) { f.amount.value = qa.dataset.amt; sync(); return f.description.focus(); }
                const dy = ev.target.closest('[data-day]');
                if (dy) { f.spentOn.value = dy.dataset.day; return sync(); }
                const rp = ev.target.closest('[data-repeat]');
                if (rp) {
                    const x = all.find(y => String(y.expense.id) === rp.dataset.repeat)?.expense;
                    if (!x) return;
                    f.amount.value = num(x.amount); f.description.value = x.description || ''; f.vendor.value = x.vendor || '';
                    if (x.accountId) f.accountId.value = x.accountId;
                    sync();
                    toast('Filled from that bill: check the day and the bill no.', 'info');
                }
            });
            f.addEventListener('input', sync);
            f.addEventListener('change', sync);
            m.el._sync = sync;
            setTimeout(() => f.amount.focus(), 60);
        },
        actions: [
            ...(editing ? [] : [{ label: 'Save & add another', left: true, iconName: 'plus', onClick: m => save(m, true) }]),
            { label: 'Cancel' },
            { label: editing ? 'Save the change' : 'Record expense', kind: 'primary', iconName: 'check', onClick: m => save(m, false) }],
    });
    async function save(m, again) {
        const f = m.el.querySelector('form');
        if (!f.head.value) throw new Error('Pick what the expense was for');
        if (!m.el.querySelector('[data-new-wrap]').hidden && f.newHead.value.trim()) throw new Error('Add the new head first, or close it');
        if (!f.reportValidity()) return true;
        const d = readForm(f);
        delete d.newHead;
        ['accountId', 'batchId'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
        const saved = editing ? await api.put(`/bricks/expenses/${e.id}`, d) : await api.post('/bricks/expenses', d);
        invalidateAccounts();
        lastHead = d.head;
        const msg = editing ? 'Expense changed' : `${d.head}: ${money(d.amount)} recorded`;
        after(saved, msg);
        if (!again) return;
        // the next one: the same head, day, account and batch
        if (saved?.expense) all.unshift(saved);
        ['amount', 'description', 'billNo', 'vendor'].forEach(k => { f[k].value = ''; });
        m.el._sync();
        f.amount.focus();
        return true;
    }
}

// ===================================================================== the team

/**
 * A team or a person. A person is staff (supervisor, accountant ...) or production labour (making bricks, driving,
 * loading ...); the role is picked from chips (another one can be typed). A production team can be the default team
 * new batches start with; a driver can have a trip incentive of their own.
 */
const KNOWN_ROLES = Object.values(ROLE_CHOICES).flat().map(x => x[0]);

export async function openResource(r0, after) {
    const r = r0 ? { ...r0, category: categoryOf(r0) } : { kind: 'TEAM', category: 'LABOUR', role: 'PRODUCTION_TEAM', salaryType: 'PIECE', active: true };
    const choicesOf = (kind, category) => kind === 'TEAM' ? ROLE_CHOICES.TEAM : ROLE_CHOICES[category];
    const chip = (attr, value, label, on, ic = '') => `<button type="button" class="seg-chip ${on ? 'active' : ''}" data-${attr}="${value}">${ic ? icon(ic) : ''}${label}</button>`;
    openModal({
        title: r0 ? `Edit ${r0.name}` : 'Enrol a team or person', iconName: 'users', size: 'lg',
        sub: 'Who works for the brick business, what they do and how they are paid',
        body: `<form class="bk-res-form" onsubmit="return false">
            <div class="bk-rf-row">
                <div class="field"><span>This is</span><div class="seg-chips">${chip('kind', 'TEAM', 'A team', r.kind === 'TEAM', 'users')}${chip('kind', 'INDIVIDUAL', 'A person', r.kind !== 'TEAM', 'user')}</div></div>
                <div class="field" data-cat-wrap><span>Works as</span><div class="seg-chips">${chip('cat', 'LABOUR', 'Production labour', r.category === 'LABOUR', 'factory')}${chip('cat', 'STAFF', 'Staff', r.category === 'STAFF', 'briefcase')}</div></div>
            </div>
            <div class="field"><span>Role</span><div class="seg-chips wrap" data-roles></div></div>
            <input name="role" required value="${esc(roleName(r.role))}" class="bk-role-other" placeholder="Type the role, e.g. Cook" hidden>
            <div class="form-grid two">
                ${field({ label: 'Name', name: 'name', value: r.name, required: true, placeholder: r.kind === 'TEAM' ? 'Ramu team' : 'Ravi' })}
                ${field({ label: 'Mobile', name: 'phone', value: r.phone, attrs: 'inputmode="tel"' })}
            </div>
            <div class="field"><span>Paid by</span><div class="seg-chips">
                ${[['PIECE', 'Work done', 'bricks made, loaded or trips driven'], ['WEEKLY', 'Weekly wage', 'a fixed amount each week'], ['MONTHLY', 'Monthly salary', 'paid once a month (people, not teams)']]
                    .map(([v, l, h]) => `<button type="button" class="seg-chip ${r.salaryType === v ? 'active' : ''}" data-salary="${v}" title="${h}">${l}</button>`).join('')}</div>
                <small class="bk-hint" data-pay-hint></small></div>
            <div class="form-grid three">
                ${field({ label: 'Wage / salary (₹)', name: 'salaryAmount', type: 'number', value: r.salaryAmount })}
                ${field({ label: 'Trip incentive (₹)', name: 'tripIncentive', type: 'number', value: r.tripIncentive, hint: 'Instead of the usual one a trip' })}
                ${field({ label: 'Members', name: 'memberCount', type: 'number', value: r.memberCount })}
                ${field({ label: 'UPI ID', name: 'upiId', value: r.upiId })}
                ${field({ label: 'Joined on', name: 'joinedOn', type: 'date', value: r.joinedOn })}
            </div>
            ${field({ label: 'Member names', name: 'members', value: r.members, placeholder: 'Comma separated' })}
            <label class="check-line" data-default-wrap><input type="checkbox" name="defaultTeam" ${r.defaultTeam ? 'checked' : ''}> <span>The default team for new batches, and for loading and unloading new orders</span></label>
            ${r0 ? `<label class="check-line"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}> Still works here</label>` : ''}
            ${field({ label: 'Note', name: 'note', value: r.note })}
            <input type="hidden" name="kind" value="${esc(r.kind)}"><input type="hidden" name="category" value="${esc(r.category)}"><input type="hidden" name="salaryType" value="${esc(r.salaryType)}">
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            let role = r.role;
            const drawRoles = () => {
                const list = choicesOf(f.kind.value, f.category.value);
                // a role of the other kind gives way to this kind's first; a role typed in ("Other…") stays
                if (!list.some(([v]) => v === role) && (KNOWN_ROLES.includes(role) || f.kind.value === 'TEAM')) role = list[0][0];
                const other = !list.some(([v]) => v === role);
                f.querySelector('[data-roles]').innerHTML = list.map(([v, l, ic]) => chip('role', v, l, v === role, ic)).join('')
                    + (f.kind.value === 'TEAM' ? '' : chip('role', '', 'Other…', other, 'more'));
                f.role.hidden = !other;
                f.role.value = other ? (role && !list.some(([v]) => v === role) ? roleName(role) : '') : role;
            };
            const sync = () => {
                const team = f.kind.value === 'TEAM', type = f.salaryType.value;
                f.querySelector('[data-cat-wrap]').hidden = team;
                f.name.placeholder = team ? 'Ramu team' : 'Ravi';
                if (team) f.category.value = 'LABOUR';
                f.memberCount.closest('.field').hidden = !team;
                f.members.closest('.field').hidden = !team;
                f.salaryAmount.closest('.field').hidden = type === 'PIECE';
                f.salaryAmount.closest('.field').querySelector('span').textContent = type === 'WEEKLY' ? 'Weekly wage (₹) *' : 'Monthly salary (₹) *';
                f.tripIncentive.closest('.field').hidden = role !== 'DRIVER';
                f.querySelector('[data-default-wrap]').hidden = !String(role).includes('PRODUCTION');
                const monthly = f.querySelector('[data-salary="MONTHLY"]');
                monthly.hidden = team;
                if (team && type === 'MONTHLY') f.querySelector('[data-salary="WEEKLY"]').click();
                f.querySelector('[data-pay-hint]').textContent = type === 'PIECE'
                    ? (role === 'DRIVER' ? 'Earns the trip incentive for each delivery trip' : String(role).includes('PRODUCTION') ? 'Earns by the good bricks made, at the pricing model’s rates'
                        : role === 'LOADING_TEAM' ? 'Earns by the bricks loaded and unloaded' : 'Earns for the work recorded against them')
                    : type === 'WEEKLY' ? 'Paid on the weekly slip, whatever the work' : 'Paid on the monthly salary slip';
            };
            f.addEventListener('click', e => {
                const k = e.target.closest('[data-kind]'), c = e.target.closest('[data-cat]'), s = e.target.closest('[data-salary]'), ro = e.target.closest('[data-role]');
                if (k) { f.kind.value = k.dataset.kind; f.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === k)); drawRoles(); }
                if (c) {
                    f.category.value = c.dataset.cat;
                    f.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('active', x === c));
                    drawRoles();
                    if (!r0 && c.dataset.cat === 'STAFF') f.querySelector('[data-salary="MONTHLY"]').click();
                }
                if (s) { f.salaryType.value = s.dataset.salary; f.querySelectorAll('[data-salary]').forEach(x => x.classList.toggle('active', x === s)); }
                if (ro) {
                    role = ro.dataset.role;
                    drawRoles();
                    if (!role) f.role.focus();
                }
                if (k || c || s || ro) sync();
            });
            f.role.addEventListener('input', () => { role = f.role.value; });
            drawRoles();
            sync();
        },
        actions: [{ label: 'Cancel' }, { label: r0 ? 'Save' : 'Enrol', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.defaultTeam = !!f.defaultTeam?.checked && !f.querySelector('[data-default-wrap]').hidden;
            d.active = r0 ? !!f.active?.checked : true;
            if (f.kind.value === 'TEAM') { d.category = 'LABOUR'; } else { d.memberCount = null; d.members = null; }
            if (f.tripIncentive.closest('.field').hidden) d.tripIncentive = null;
            const saved = r0 ? await api.put(`/bricks/resources/${r0.id}`, d) : await api.post('/bricks/resources', d);
            await loadMeta(true);
            after(saved, `${saved.resource.name} saved`);
        } }],
    });
}

// ===================================================================== the brick book

export function openBookAccount(after) {
    openModal({
        title: 'New account of the brick business', iconName: 'bank', sub: 'Its own bank account, cash box or wallet; your own accounts can be used as well',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', required: true, placeholder: 'Brick · SBI current' })}
            ${field({ label: 'Kind', name: 'type', type: 'select', value: 'BANK', options: [{ value: 'BANK', label: 'Bank account' }, { value: 'CASH', label: 'Cash' }, { value: 'WALLET', label: 'Wallet' }] })}
            ${field({ label: 'Bank', name: 'institution' })}
            ${field({ label: 'Account no.', name: 'accountNumber' })}
            ${field({ label: 'UPI ID', name: 'upiId' })}
            ${field({ label: 'Held in the name of', name: 'holderName' })}
            ${field({ label: 'Opening balance (₹)', name: 'openingBalance', type: 'number' })}
            ${field({ label: 'As of', name: 'openingDate', type: 'date', value: today() })}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Add account', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const book = await api.post('/bricks/book/accounts', readForm(f));
            invalidateAccounts();
            after(book, 'Account added');
        } }],
    });
}

export async function openTransfer(after, { fromId = null, toId = null } = {}) {
    const accounts = await loadingDialog('Getting the accounts…', () => moneyAccounts());
    if (!accounts) return;
    openModal({
        title: 'Move money', iconName: 'transfer', sub: 'Between the brick business’s accounts and your own',
        body: `<form class="form-grid two">
            ${field({ label: 'From', name: 'fromAccountId', type: 'select', value: fromId, required: true, options: moneyOptions(accounts, fromId, 'Pick an account') })}
            ${field({ label: 'To', name: 'toAccountId', type: 'select', value: toId, required: true, options: moneyOptions(accounts, toId, 'Pick an account') })}
            ${field({ label: 'Amount (₹)', name: 'amount', type: 'number', required: true })}
            ${field({ label: 'On', name: 'movedOn', type: 'date', value: today(), required: true })}
            ${field({ label: 'Note', name: 'note', span: 'span-2' })}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Move', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.fromAccountId = Number(d.fromAccountId);
            d.toAccountId = Number(d.toAccountId);
            const book = await api.post('/bricks/book/transfers', d);
            invalidateAccounts();
            after(book, 'Money moved');
        } }],
    });
}
