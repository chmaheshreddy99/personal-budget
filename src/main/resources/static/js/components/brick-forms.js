/**
 * Brick Management forms: the set-up (brick types, raw materials, pricing models, vehicles, the business's settings
 * with the signatures for payment slips), production (a batch with its raw material count, raw material bought,
 * production expenses), the team, and the brick book's accounts.
 */
import { api } from '../core/api.js';
import { invalidateAccounts } from '../core/store.js';
import { esc, field, readForm, openModal, toast } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money } from '../core/format.js';
import { padHtml, bindPad, signatureSvg } from '../core/bond.js';
import { loadMeta, setMeta, num, count, qty, today, moneyAccounts, moneyOptions, resourceOptions, roleName, ROLE_CHOICES, categoryOf, makesBricks } from './brick-common.js';

// ===================================================================== set-up

export function openType(type, after) {
    const t = type || { curingDays: 14, openingStock: 0, active: true, color: '#b4532a' };
    openModal({
        title: type ? `Edit ${type.name}` : 'New brick type', iconName: 'brick', sub: 'A size or kind you make and sell, e.g. 16X4X8 Dies',
        body: `<form class="form-grid two">
            ${field({ label: 'Name', name: 'name', value: t.name, required: true, span: 'span-2', placeholder: '16X4X8 Dies' })}
            ${field({ label: 'MRP (₹ a brick)', name: 'mrp', type: 'number', value: t.mrp, hint: 'Filled in on new orders; a lower agreed price shows as a discount' })}
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
    const meta = await loadMeta();
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
    const meta = await loadMeta();
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

export async function openSettings(after) {
    const meta = await loadMeta(true);
    const s = meta.settings;
    const accounts = await moneyAccounts();
    const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    openModal({
        title: 'Brick business settings', iconName: 'settings', size: 'lg',
        body: `<form class="form-grid two bk-settings">
            <div class="section-title span-2">${icon('truck')} Delivery and handling</div>
            ${field({ label: 'Delivery charge a trip (₹)', name: 'deliveryChargePerTrip', type: 'number', value: s.deliveryChargePerTrip })}
            ${field({ label: 'Free delivery from (bricks)', name: 'freeDeliveryMinQty', type: 'number', value: s.freeDeliveryMinQty, hint: 'Orders this big get delivery waived; empty: never' })}
            ${field({ label: 'Driver incentive a trip (₹)', name: 'driverIncentivePerTrip', type: 'number', value: s.driverIncentivePerTrip, hint: 'A driver can have their own on their card' })}
            ${field({ label: 'Bill loading & unloading to customers', name: 'billHandling', type: 'checkbox', value: s.billHandling })}
            ${field({ label: 'Loading (₹ a brick)', name: 'loadingRate', type: 'number', value: s.loadingRate, hint: 'Earned by the loading team' })}
            ${field({ label: 'Unloading (₹ a brick)', name: 'unloadingRate', type: 'number', value: s.unloadingRate, hint: 'Earned by the unloading team' })}
            <div class="section-title span-2">${icon('qr')} Customer payments</div>
            ${field({ label: 'UPI ID', name: 'upiId', value: s.upiId, placeholder: 'name@okicici', hint: 'On the order link: pay with GPay, PhonePe, BHIM or the QR code' })}
            ${field({ label: 'Payee name', name: 'payeeName', value: s.payeeName, hint: 'The name the UPI app shows' })}
            ${field({ label: 'Customer payments go to', name: 'receiptAccountId', type: 'select', value: s.receiptAccountId, options: moneyOptions(accounts, s.receiptAccountId, 'Brick · cash') })}
            ${field({ label: 'Pay wages and bills from', name: 'payAccountId', type: 'select', value: s.payAccountId, options: moneyOptions(accounts, s.payAccountId, 'Brick · cash') })}
            <div class="section-title span-2">${icon('stamp')} Payment slips</div>
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
            <div class="section-title span-2">${icon('receipt')} Production expense heads</div>
            ${field({ label: 'Heads (one a line)', name: 'heads', type: 'textarea', value: meta.expenseHeads.join('\n'), span: 'span-2' })}
        </form>`,
        onOpen: m => {
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
    let meta = await loadMeta();
    const b = batch?.batch || { producedOn: today() };
    const defaultModel = meta.models.find(m => m.model.defaultModel) || meta.models[0];
    const paid = !!batch?.paidOn;
    const had = Object.fromEntries((batch?.items || []).map(i => [i.brickTypeId, i]));
    const counted = Object.fromEntries((batch?.materials || []).filter(f => f.counted).map(f => [f.materialId, f.closing]));
    const makers = meta.resources.filter(r => (r.active && makesBricks(r)) || r.id === b.teamId);
    const others = meta.resources.filter(r => r.active && !makesBricks(r) && r.id !== b.teamId);
    // a new batch starts with the default team, else the only production team there is
    const teamId0 = batch ? b.teamId : (makers.find(r => r.defaultTeam) || (makers.length === 1 ? makers[0] : null))?.id ?? null;
    const payText = r => r.salaryType === 'PIECE' ? 'paid by the brick' : r.salaryType === 'WEEKLY' ? 'weekly wage' : 'monthly salary';
    const teamOpts = `<option value="">No team · nobody earns</option>
        <optgroup label="Production">${makers.map(r => `<option value="${r.id}" ${String(r.id) === String(teamId0) ? 'selected' : ''}>${esc(r.name)}${r.defaultTeam ? ' (default)' : ''} · ${payText(r)}</option>`).join('')}</optgroup>
        ${others.length ? `<optgroup label="Others">${others.map(r => `<option value="${r.id}">${esc(r.name)} · ${esc(roleName(r.role))}</option>`).join('')}</optgroup>` : ''}`;
    const typeRow = t => `<tr class="bkb-row" data-type="${t.id}">
        <td><b>${esc(t.name)}</b><small data-rate></small></td>
        <td><div class="bkb-made"><input type="number" min="0" step="1" inputmode="numeric" class="num" data-qty value="${had[t.id]?.quantity ?? ''}" placeholder="0" ${paid ? 'disabled' : ''}>
            ${paid ? '' : `<span class="bkb-quick">${[500, 1000].map(n => `<button type="button" data-add="${n}" title="Add ${n.toLocaleString('en-IN')}">+${n >= 1000 ? `${n / 1000}k` : n}</button>`).join('')}</span>`}</div></td>
        <td><input type="number" min="0" step="1" inputmode="numeric" class="num" data-damaged value="${had[t.id]?.damaged || ''}" placeholder="0" ${paid ? 'disabled' : ''}></td>
        <td class="r" data-good>—</td><td class="r" data-amount>—</td></tr>`;
    openModal({
        title: batch ? `Batch ${b.batchNo}` : 'New production batch', iconName: 'factory', size: 'xl bk-batch-modal',
        sub: paid ? `The team was paid for it on ${batch.paidOn}: only the raw material count and the note can change` : 'The bricks a team made, and the raw material left after it',
        body: `<form class="bkb" onsubmit="return false"><div class="bkb-left">
            <div class="bkb-head">
                <span class="chip-icon">${icon('factory')}</span>
                <div class="grow min-0"><b data-h-team>—</b><small data-h-note></small></div>
                <div class="bkb-head-amt"><small>Good bricks</small><b data-s-good>0</b></div>
            </div>
            <div class="form-grid three bkb-fields">
                <label class="field"><span>Made on</span><input type="date" name="producedOn" value="${esc(b.producedOn)}" max="${today()}" required ${paid ? 'readonly' : ''}></label>
                <label class="field"><span>Team</span><select name="teamId" ${paid ? 'disabled' : ''}>${teamOpts}</select></label>
                <label class="field"><span>Pricing model</span><select name="pricingModelId" ${paid ? 'disabled' : ''}>${meta.models.filter(m => m.model.active || m.model.id === b.pricingModelId)
                    .map(m => `<option value="${m.model.id}" ${String(m.model.id) === String(b.pricingModelId || defaultModel?.model.id) ? 'selected' : ''}>${esc(m.model.name)}${m.model.defaultModel ? ' (default)' : ''}</option>`).join('')}</select></label>
            </div>
            <div class="section-title">${icon('brick')}Bricks made <small class="muted">type the count or add 500 / 1,000 at a time</small></div>
            <table class="grid compact bkb-table"><thead><tr><th>Type</th><th>Made</th><th>Damaged</th><th class="r">Good</th><th class="r">Earns</th></tr></thead>
                <tbody data-types>${meta.types.filter(t => t.active || had[t.id]).map(typeRow).join('')}</tbody></table>
            ${paid ? '' : `<button type="button" class="link-btn" data-add-type>${icon('plus')}Another brick type</button>`}
            <div class="section-title">${icon('box')}Raw material left after the batch <small class="muted">leave it empty when not counted</small></div>
            <div data-mats><div class="loading"><div class="spinner"></div></div></div>
            <label class="field"><span>Note</span><input name="note" maxlength="300" value="${esc(b.note || '')}" placeholder="Shift, weather, machine…"></label>
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
                }).join('')}</tbody></table>` : '<p class="small muted">No raw materials set up.</p>';
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

export async function openPurchase(p0, after, { materialId = null } = {}) {
    const meta = await loadMeta();
    const accounts = await moneyAccounts();
    const p = p0?.purchase || { receivedOn: today(), materialId };
    const unitOf = id => meta.materials.find(x => String(x.id) === String(id))?.unit || '';
    openModal({
        title: p0 ? 'Raw material bought' : 'Record raw material', iconName: 'box', sub: 'Adds to the stock and goes to the books as a raw material cost',
        body: `<form class="form-grid two">
            ${field({ label: 'Material', name: 'materialId', type: 'select', value: p.materialId, required: true,
                options: [{ value: '', label: 'Pick the material' }, ...meta.materials.filter(x => x.active || x.id === p.materialId).map(x => ({ value: x.id, label: `${x.name} (${x.unit})` }))] })}
            ${field({ label: 'Received on', name: 'receivedOn', type: 'date', value: p.receivedOn, required: true })}
            <label class="field"><span>Quantity *</span><span class="bk-unit-in"><input type="number" step="any" min="0" class="num" data-type="number" name="quantity" required value="${esc(p.quantity ?? '')}"><em data-unit>${esc(unitOf(p.materialId))}</em></span></label>
            ${field({ label: 'Rate (₹ a unit)', name: 'rate', type: 'number', value: p.rate, hint: meta.materials.find(x => x.id === p.materialId)?.lastRate ? `last ₹${meta.materials.find(x => x.id === p.materialId).lastRate}` : '' })}
            ${field({ label: 'Amount (₹)', name: 'amount', type: 'number', value: p.amount, required: true })}
            ${field({ label: 'Paid from', name: 'accountId', type: 'select', value: p.accountId, options: moneyOptions(accounts, p.accountId) })}
            ${field({ label: 'Vendor', name: 'vendor', value: p.vendor })}
            ${field({ label: 'Bill no.', name: 'billNo', value: p.billNo })}
            ${field({ label: 'Vehicle no.', name: 'vehicleNo', value: p.vehicleNo })}
            ${field({ label: 'Note', name: 'note', value: p.note })}
        </form>`,
        onOpen: m => {
            const f = m.el.querySelector('form');
            const fill = () => { if (f.quantity.value && f.rate.value) f.amount.value = (num(f.quantity.value) * num(f.rate.value)).toFixed(2); };
            f.quantity.addEventListener('input', fill);
            f.rate.addEventListener('input', fill);
            f.materialId.addEventListener('change', () => {
                f.querySelector('[data-unit]').textContent = unitOf(f.materialId.value);
                const last = meta.materials.find(x => String(x.id) === f.materialId.value)?.lastRate;
                if (last && !f.rate.value) { f.rate.value = last; fill(); }
            });
        },
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            d.materialId = Number(d.materialId);
            if (d.accountId) d.accountId = Number(d.accountId);
            const saved = p0 ? await api.put(`/bricks/purchases/${p.id}`, d) : await api.post('/bricks/purchases', d);
            invalidateAccounts();
            after(saved, 'Raw material recorded');
        } }],
    });
}

export async function openExpense(e0, after, { batchId = null } = {}) {
    const meta = await loadMeta();
    const accounts = await moneyAccounts();
    const batches = (await api.get('/bricks/production')).batches.slice(0, 40);
    const e = e0?.expense || { spentOn: today(), batchId, head: meta.expenseHeads[0] };
    openModal({
        title: e0 ? 'Production expense' : 'New production expense', iconName: 'receipt', sub: 'Anything production costs other than raw material',
        body: `<form class="form-grid two">
            <div class="field span-2"><span>Head *</span><div class="bk-heads">${meta.expenseHeads.map(h =>
                `<button type="button" class="seg-chip ${h === e.head ? 'active' : ''}" data-head="${esc(h)}">${esc(h)}</button>`).join('')}</div>
                <input name="head" required value="${esc(e.head || '')}" placeholder="Or type another"></div>
            ${field({ label: 'Amount (₹)', name: 'amount', type: 'number', value: e.amount, required: true })}
            ${field({ label: 'Spent on', name: 'spentOn', type: 'date', value: e.spentOn, required: true })}
            ${field({ label: 'Description', name: 'description', value: e.description, span: 'span-2' })}
            ${field({ label: 'Vendor', name: 'vendor', value: e.vendor })}
            ${field({ label: 'Bill no.', name: 'billNo', value: e.billNo })}
            ${field({ label: 'Paid from', name: 'accountId', type: 'select', value: e.accountId, options: moneyOptions(accounts, e.accountId) })}
            ${field({ label: 'For batch', name: 'batchId', type: 'select', value: e.batchId, options: [{ value: '', label: 'Not for one batch' },
                ...batches.map(b => ({ value: b.batch.id, label: `${b.batch.batchNo} · ${b.batch.producedOn}` }))] })}
        </form>`,
        onOpen: m => m.el.addEventListener('click', ev => {
            const h = ev.target.closest('[data-head]');
            if (!h) return;
            m.el.querySelectorAll('[data-head]').forEach(x => x.classList.toggle('active', x === h));
            m.el.querySelector('[name=head]').value = h.dataset.head;
        }),
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const d = readForm(f);
            ['accountId', 'batchId'].forEach(k => { if (d[k]) d[k] = Number(d[k]); });
            const saved = e0 ? await api.put(`/bricks/expenses/${e.id}`, d) : await api.post('/bricks/expenses', d);
            invalidateAccounts();
            after(saved, 'Expense recorded');
        } }],
    });
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
            <label class="check-line" data-default-wrap><input type="checkbox" name="defaultTeam" ${r.defaultTeam ? 'checked' : ''}> The default team for new batches</label>
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
    const accounts = await moneyAccounts();
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
