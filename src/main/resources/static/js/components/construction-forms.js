/**
 * The Construction section's dialogs: starting a project (a few short steps), its settings, and recording what
 * happens: stages, extra works, money received (with its receipt), costs, partners and their capital, loans, land
 * parties, flats, transfers and the business's common accounts, and finishing or closing a project.
 *
 * Every dialog sends one change and hands the project as the server returns it to after(detail, message).
 */
import { api } from '../core/api.js';
import { state, loadAccounts } from '../core/store.js';
import { esc, toast, openModal, confirmDialog } from '../core/ui.js';
import { evidenceFieldHtml, bindEvidenceField } from './evidence.js';
import { evalAmount } from './expense-dialog.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, date, isoDate } from '../core/format.js';
import { padHtml, bindPad, signatureSvg } from '../core/bond.js';

export const num = v => Number(v || 0);
const t = (form, name) => form[name]?.value.trim() || null;
const n = (form, name) => form[name]?.value === '' || form[name]?.value == null ? null : Number(form[name].value);
const phoneOk = v => !v || /^(\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, ''));
export const AREA_UNITS = [['SQ_YD', 'sq yards'], ['SQ_FT', 'sq ft'], ['SQ_M', 'sq metres'], ['ACRE', 'acres'], ['GUNTA', 'guntas']];
export const HEAD_ICONS = { LAND: 'home', APPROVALS: 'stamp', DESIGN: 'ruler', CEMENT: 'layers', STEEL: 'layers', SAND_AGGREGATE: 'layers', BRICKS_BLOCKS: 'grid',
    LABOUR: 'users', CONTRACTOR: 'hard-hat', ELECTRICAL: 'bolt', PLUMBING: 'droplet', PAINTING: 'droplet', FLOORING: 'grid', REGISTRATION: 'stamp',
    MARKETING: 'send', EQUIPMENT: 'wrench', TRANSPORT: 'car', LIFT: 'arrow-up', OTHER: 'more', EXCAVATION: 'wrench', CONCRETE: 'layers',
    CENTERING: 'grid', DOORS_WINDOWS: 'home', FABRICATION: 'wrench', SITE_EXPENSES: 'receipt' };
export const headName = h => { const s = String(h || '').replace(/_/g, ' ').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const MODES = ['Bank', 'UPI', 'Cash', 'Cheque', 'DD', 'Card'];

let headsCache = null;
async function heads() {
    if (!headsCache) headsCache = (await api.get('/construction/meta')).heads;
    return headsCache;
}

/** Accounts money can go in or out of: this project's, the business's common ones, then my own. */
export async function moneyAccounts() {
    return (await loadAccounts(true, { all: true })).filter(a => a.active && ['CASH', 'BANK', 'WALLET'].includes(a.accountType) && !a.chitBook);
}

export function moneyOptions(accounts, projectId, selected = null, { cards = false, placeholder = 'Pick an account' } = {}) {
    const groups = [['This project', a => a.projectBook && a.projectId === projectId], ['Common business accounts', a => a.projectBook && !a.projectId],
        ['My accounts', a => !a.projectBook]];
    const list = cards ? accounts : accounts.filter(a => a.accountType !== 'CREDIT_CARD');
    return `<option value="">${esc(placeholder)}</option>` + groups.map(([label, f]) => {
        const rows = list.filter(f);
        return rows.length ? `<optgroup label="${label}">${rows.map(a => `<option value="${a.id}" ${String(a.id) === String(selected) ? 'selected' : ''}
            data-meta="${esc(`${a.typeLabel} · ${moneyShort(a.balance)}`)}">${esc(a.name)}</option>`).join('')}</optgroup>` : '';
    }).join('');
}

const modeChips = (current = 'Bank') => `<div class="ln-chips" data-mode-chips>${MODES.map(m =>
    `<button type="button" class="date-chip ${m === current ? 'selected' : ''}" data-value="${m}">${m}</button>`).join('')}</div>`;
function bindChips(root) {
    root.querySelectorAll('[data-mode-chips], [data-chips]').forEach(group => group.addEventListener('click', e => {
        const chip = e.target.closest('[data-value]');
        if (!chip) return;
        group.querySelectorAll('[data-value]').forEach(c => c.classList.toggle('selected', c === chip));
        group.dispatchEvent(new Event('change', { bubbles: true }));
    }));
}
const chosen = (root, sel) => root.querySelector(`${sel} .selected`)?.dataset.value || null;

// ===================================================================== starting a project

const CONTRACT_STAGES = [['Foundation', 15], ['Plinth beam', 10], ['Ground floor slab', 15], ['First floor slab', 15], ['Brickwork', 10],
    ['Plastering', 10], ['Flooring and tiles', 10], ['Painting and finishing', 10], ['Handover', 5]];
function developmentStages(floors) {
    const slabs = Array.from({ length: Math.max(1, Math.min(30, floors || 2)) }, (_, i) => [`${i === 0 ? 'Ground floor' : `Floor ${i}`} roof slab`]);
    return [['Excavation and foundation'], ['Plinth'], ...slabs, ['Brickwork'], ['Plastering'], ['Flooring and tiles'], ['Electrical and plumbing'],
        ['Painting and finishing'], ['Lift, amenities and common areas'], ['Occupancy certificate and handover']];
}

/** Starting a project: what it is, where and when, the client or the land, the stages, the flats, the partners, the money. */
export function openWizard(after) {
    const me = state.user?.fullName || 'Me';
    const w = {
        step: 0, kind: 'CONTRACT', landMode: 'OWN_PLOT',
        p: { areaUnit: 'SQ_YD', startDate: isoDate(), lateGraceDays: 7, lateInterestPercent: 1.5, defectLiabilityMonths: 12, companyName: '',
            signerName: me, signerDesignation: 'Managing Partner' },
        contractValue: '', stages: CONTRACT_STAGES.map(([name, pct]) => ({ name, pct, amount: '', dueDate: '' })),
        devStages: developmentStages(2).map(([name]) => ({ name, plannedEnd: '' })),
        parties: [], units: { blocks: 'A', floorFrom: 1, floorTo: 4, perFloor: 4, unitType: '2BHK', carpetArea: '', builtUpArea: '', superArea: '', rate: '', landownerUnits: 0, skip: false },
        partners: [{ name: me, phone: '', sharePercent: 100, me: true }], bankMode: 'NEW', bankAccountId: '', bankName: '', bankInstitution: '', bankNumber: '',
    };
    const steps = () => w.kind === 'CONTRACT'
        ? [['kind', 'What'], ['site', 'Site & time'], ['client', 'Owner & terms'], ['stages', 'Stages & price'], ['partners', 'Company & partners'], ['money', 'Money']]
        : [['kind', 'What'], ['site', 'Site & time'], ['land', w.landMode === 'JOINT' ? 'Landowners' : 'Plot'], ['stages', 'Construction stages'], ['units', 'Flats'],
            ['partners', 'Company & partners'], ['money', 'Money']];
    let accounts = [];
    const modal = openModal({
        title: 'Start a construction project', sub: 'A contract work for an owner, or an apartment development of your own', iconName: 'hard-hat', size: 'xl cn-wizard-modal',
        body: `<div class="cn-wiz"><ol class="cn-steps" data-steps></ol><div class="cn-step-body" data-step></div></div>`,
        actions: [
            { label: 'Cancel' },
            { label: 'Back', left: true, iconName: 'chevron-left', onClick: () => { read(); if (w.step > 0) { w.step--; draw(); } return true; } },
            { label: 'Next', kind: 'primary', iconName: 'chevron-right', onClick: async () => {
                read();
                check();
                if (w.step < steps().length - 1) { w.step++; draw(); return true; }
                const d = await api.post('/construction', payload());
                after(d, `${d.project.name} started`);
            } },
        ],
    });
    const el = modal.el;
    const body = el.querySelector('[data-step]');
    const nextBtn = () => el.querySelector('.modal-foot [data-action-index="2"]');

    const f = (label, name, { type = 'text', value, span = '', attrs = '', hint = '', placeholder = '' } = {}) => `<label class="field ${span}"><span>${label}${hint ? ` <small class="muted">${hint}</small>` : ''}</span>
        <input name="${name}" type="${type}" ${type === 'number' ? 'class="num" step="any" min="0"' : ''} value="${esc(value ?? w.p[name] ?? '')}" ${attrs} placeholder="${esc(placeholder)}" data-plain></label>`;

    const views = {
        kind: () => `<div class="cn-kind-grid">
                ${tile('CONTRACT', 'hard-hat', 'Contract work', 'You build on an owner’s site for an agreed price: stage-wise payments, extra works, late interest and the construction agreement.', w.kind === 'CONTRACT')}
                ${tile('DEVELOPMENT', 'building', 'Apartment development', 'Your own apartment project: the land, the flats, buyers on payment plans, home loans, registration and handover.', w.kind === 'DEVELOPMENT')}
            </div>
            ${w.kind === 'DEVELOPMENT' ? `<div class="section-title">${icon('home')}The land</div><div class="cn-kind-grid two">
                ${tile('OWN_PLOT', 'home', 'Own plot', 'You buy the plot (agreement of sale with the seller) and build on it; every flat is yours to sell.', w.landMode === 'OWN_PLOT', 'land')}
                ${tile('JOINT', 'layers', 'Joint development', 'The landowners give the land for a share of the flats (JDA); you sell the rest.', w.landMode === 'JOINT', 'land')}
            </div>` : ''}
            <div class="form-grid two" data-form>
                ${f('Project name', 'name', { placeholder: w.kind === 'CONTRACT' ? 'e.g. Reddy residence, Kondapur' : 'e.g. Green Meadows', attrs: 'maxlength="100" required' })}
                ${f('Short code', 'code', { hint: 'on receipts, e.g. GM', attrs: 'maxlength="6"' })}
            </div>`,
        site: () => `<div class="form-grid two" data-form>
                ${f('Site address', 'siteAddress', { span: 'span-2', attrs: 'maxlength="200"' })}
                ${f('City / town', 'city', { hint: 'also the place of the agreements', attrs: 'maxlength="60"' })}
                ${f('Survey No.', 'surveyNo', { attrs: 'maxlength="60"' })}
                ${f('Plot No.', 'plotNo', { attrs: 'maxlength="40"' })}
                <div class="field cn-area"><span>Plot area</span><div class="row"><input name="plotArea" type="number" class="num" step="any" min="0" value="${esc(w.p.plotArea ?? '')}" data-plain>
                    <select name="areaUnit">${AREA_UNITS.map(([v, l]) => `<option value="${v}" ${w.p.areaUnit === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
                ${f('Boundaries', 'boundaries', { span: 'span-2', placeholder: 'North: …; South: …; East: …; West: …', attrs: 'maxlength="300"' })}
                ${f('Built-up area', 'builtUpArea', { type: 'number', hint: 'sq ft' })}
                ${f('Floors', 'floors', { type: 'number' })}
                ${f('Building permission No.', 'permitNo', { attrs: 'maxlength="60"' })}
                ${w.kind === 'DEVELOPMENT' ? f('RERA registration No.', 'reraNo', { attrs: 'maxlength="60"' }) : '<span></span>'}
                ${f('Start', 'startDate', { type: 'date' })}
                ${f('Completion', 'plannedEndDate', { type: 'date', hint: 'as agreed' })}
                ${f('Estimated cost', 'estimatedCost', { type: 'number', hint: 'to compare the costs with' })}
            </div>`,
        client: () => `<div class="form-grid two" data-form>
                <div class="section-title span-2">${icon('user')}The owner of the site</div>
                ${f('Name', 'clientName', { attrs: 'maxlength="100" required' })}
                ${f('S/o, D/o or W/o', 'clientRelation', { attrs: 'maxlength="100"' })}
                ${f('Mobile', 'clientPhone', { type: 'tel', attrs: 'maxlength="14" inputmode="numeric"' })}
                ${f('E-mail', 'clientEmail', { type: 'email', attrs: 'maxlength="100"' })}
                ${f('Address', 'clientAddress', { span: 'span-2', attrs: 'maxlength="200"' })}
                <div class="section-title span-2">${icon('clock')}Terms</div>
                ${f('Late payment interest', 'lateInterestPercent', { type: 'number', hint: '% a month' })}
                ${f('Grace days', 'lateGraceDays', { type: 'number', hint: 'before interest starts' })}
                ${f('Defect liability', 'defectLiabilityMonths', { type: 'number', hint: 'months after handover' })}
            </div>`,
        land: () => {
            const joint = w.landMode === 'JOINT';
            return `<div class="form-grid two" data-form>
                ${joint ? `${f('Landowners’ share', 'landownerSharePercent', { type: 'number', hint: '% of the flats / built area' })}
                    ${f('Refundable deposit to them', 'refundableDeposit', { type: 'number' })}`
                    : `${f('Plot price', 'plotPrice', { type: 'number', hint: 'all sellers together' })}<span></span>`}
                ${f('Buyers’ late interest', 'lateInterestPercent', { type: 'number', hint: '% a month' })}
                ${f('Grace days', 'lateGraceDays', { type: 'number' })}
                ${f('List rate', 'saleRate', { type: 'number', hint: '₹ a sq ft' })}
                ${f('Flats planned', 'flatsPlanned', { type: 'number' })}
            </div>
            <div class="section-title">${icon('users')}${joint ? 'Landowners' : 'Seller(s) of the plot'}</div>
            <div class="cn-rows" data-parties>${(w.parties.length ? w.parties : [{}]).map((x, i) => partyRow(x, i, joint)).join('')}</div>
            <button type="button" class="btn sm ghost" data-add-party>${icon('plus')}Add ${joint ? 'a landowner' : 'a seller'}</button>`;
        },
        stages: () => w.kind === 'CONTRACT' ? `<div class="form-grid two" data-form>
                <label class="field"><span>Contract price <small class="muted">split over the stages below</small></span>
                    <input name="contractValue" type="number" class="num" step="any" min="0" value="${esc(w.contractValue)}" data-plain></label>
                <div class="field"><span>Quick start</span><div class="row"><button type="button" class="btn sm ghost" data-template="house">${icon('home')}Typical house</button>
                    <button type="button" class="btn sm ghost" data-template="clear">${icon('x')}Clear</button></div></div>
            </div>
            <div class="cn-stage-head"><span>Stage</span><span>% of price</span><span>Price</span><span>Paid by <small>(empty: 7 days after it is done)</small></span><span></span></div>
            <div class="cn-rows" data-stages>${w.stages.map((s, i) => stageRow(s, i)).join('')}</div>
            <div class="row"><button type="button" class="btn sm ghost" data-add-stage>${icon('plus')}Add a stage</button><span class="grow"></span><small data-stage-total class="muted"></small></div>`
            : `<p class="hint">Buyers’ construction-linked instalments fall due when these stages are done. Plan dates are optional.</p>
            <div class="cn-stage-head dev"><span>Stage</span><span>Planned completion</span><span></span></div>
            <div class="cn-rows" data-stages>${w.devStages.map((s, i) => devStageRow(s, i)).join('')}</div>
            <div class="row"><button type="button" class="btn sm ghost" data-add-stage>${icon('plus')}Add a stage</button>
                <button type="button" class="btn sm ghost" data-template="floors">${icon('refresh')}Make from the floors (${num(w.p.floors) || 2})</button></div>`,
        units: () => {
            const u = w.units;
            return `<label class="check-line"><input type="checkbox" name="skipUnits" ${u.skip ? 'checked' : ''}> Add the flats later</label>
            <div class="form-grid four" data-form data-units ${u.skip ? 'hidden' : ''}>
                ${f('Blocks', 'blocks', { value: u.blocks, hint: 'comma separated; empty: one building' })}
                ${f('Floors from', 'floorFrom', { type: 'number', value: u.floorFrom, hint: '0 = ground' })}
                ${f('to', 'floorTo', { type: 'number', value: u.floorTo })}
                ${f('Flats a floor', 'perFloor', { type: 'number', value: u.perFloor })}
                ${f('Type', 'unitType', { value: u.unitType })}
                ${f('Carpet area', 'carpetArea', { type: 'number', value: u.carpetArea, hint: 'sq ft' })}
                ${f('Built-up area', 'builtUpArea', { type: 'number', value: u.builtUpArea })}
                ${f('Super area', 'superArea', { type: 'number', value: u.superArea, hint: 'saleable' })}
                ${f('Rate', 'rate', { type: 'number', value: u.rate || w.p.saleRate || '', hint: '₹ a sq ft' })}
                ${w.landMode === 'JOINT' ? f('Landowners’ flats', 'landownerUnits', { type: 'number', value: u.landownerUnits, hint: 'the first ones' }) : ''}
            </div><p class="muted small" data-unit-preview></p>`;
        },
        partners: () => `<div class="form-grid two" data-form>
                <div class="section-title span-2">${icon('building')}The construction company <small class="muted">its name goes on the seal and the agreements</small></div>
                ${f('Company / firm name', 'companyName', { attrs: 'maxlength="100" required', placeholder: 'e.g. Sri Sai Constructions' })}
                ${f('Office address', 'companyAddress', { attrs: 'maxlength="200"' })}
                ${f('Signs as', 'signerName', { attrs: 'maxlength="100"' })}
                ${f('Designation', 'signerDesignation', { attrs: 'maxlength="60"' })}
            </div>
            <div class="section-title">${icon('users')}Partners <small class="muted">their shares of the profit must make 100%</small></div>
            <div class="cn-rows" data-partners>${w.partners.map((x, i) => partnerRow(x, i)).join('')}</div>
            <div class="row"><button type="button" class="btn sm ghost" data-add-partner>${icon('plus')}Add a partner</button><span class="grow"></span><small data-share-total></small></div>`,
        money: () => `<div class="cn-kind-grid two">
                ${tile('NEW', 'bank', 'A bank account of its own', 'The project’s money is kept apart: a new account in the business’s books.', w.bankMode === 'NEW', 'bank')}
                ${tile('EXISTING', 'wallet', 'An account I have', 'A common business account, or one of my own accounts.', w.bankMode === 'EXISTING', 'bank')}
            </div>
            <div class="form-grid two" data-form>
                ${w.bankMode === 'NEW' ? `${f('Account name', 'bankName', { value: w.bankName, placeholder: `${w.p.name || 'Project'} · bank`, attrs: 'maxlength="100"' })}
                    ${f('Bank', 'bankInstitution', { value: w.bankInstitution, attrs: 'maxlength="100"' })}
                    ${f('Account No.', 'bankNumber', { value: w.bankNumber, attrs: 'maxlength="40"' })}`
                    : `<label class="field span-2"><span>Account</span><select name="bankAccountId">${moneyOptions(accounts, null, w.bankAccountId)}</select></label>`}
            </div>
            <div class="cn-made-list"><b>${icon('journal')}Its books</b><ul>
                <li>${icon('layers')}<b>${esc(w.p.name || 'Project')} · construction cost</b> — what it costs (held as work in progress until it closes)</li>
                ${w.kind === 'DEVELOPMENT' ? `<li>${icon('home')}<b>· land</b> — the plot, its registration${w.landMode === 'JOINT' ? ', the deposit to the landowners' : ''}</li>` : ''}
                <li>${icon('arrow-in')}<b>· received from ${w.kind === 'CONTRACT' ? 'the owner' : 'buyers'}</b> — held until it closes, then set off against the costs</li>
                <li>${icon('percent')}<b>· late interest received</b></li>
                ${w.partners.filter(x => !x.me).length ? `<li>${icon('users')}<b>· capital</b> — one for each other partner, what the business owes them</li>` : ''}
                <li>${icon('bank')}a loan account for each loan you add</li></ul>
                <small class="muted">These stay off your personal accounts; you see them under Construction.</small></div>`,
    };
    function tile(value, ic, title, text, on, group = 'kind') {
        return `<button type="button" class="cn-kind ${on ? 'on' : ''}" data-${group}="${value}"><span class="cn-kind-ico">${icon(ic)}</span><b>${esc(title)}</b><small>${esc(text)}</small></button>`;
    }
    function stageRow(s, i) {
        return `<div class="cn-row cn-stage" data-i="${i}"><input name="sname" value="${esc(s.name)}" placeholder="Stage" maxlength="100" data-plain>
            <input name="spct" type="number" class="num" step="any" min="0" value="${esc(s.pct ?? '')}" placeholder="%" data-plain>
            <input name="samt" type="number" class="num" step="any" min="0" value="${esc(s.amount ?? '')}" placeholder="₹" data-plain>
            <input name="sdue" type="date" value="${esc(s.dueDate || '')}">
            <button type="button" class="btn xs ghost icon" data-del-row title="Remove">${icon('x')}</button></div>`;
    }
    function devStageRow(s, i) {
        return `<div class="cn-row cn-stage dev" data-i="${i}"><input name="sname" value="${esc(s.name)}" placeholder="Stage" maxlength="100" data-plain>
            <input name="send" type="date" value="${esc(s.plannedEnd || '')}"><button type="button" class="btn xs ghost icon" data-del-row title="Remove">${icon('x')}</button></div>`;
    }
    function partyRow(x, i, joint) {
        return `<div class="cn-row cn-party" data-i="${i}"><input name="pname" value="${esc(x.name || '')}" placeholder="Name" maxlength="100" data-plain>
            <input name="prel" value="${esc(x.relation || '')}" placeholder="S/o, D/o, W/o" maxlength="100" data-plain>
            <input name="pphone" type="tel" value="${esc(x.phone || '')}" placeholder="Mobile" maxlength="14" data-plain>
            <input name="paddr" value="${esc(x.address || '')}" placeholder="Address" maxlength="200" data-plain>
            <input name="pshare" type="number" class="num" step="any" min="0" value="${esc(x.sharePercent ?? '')}" placeholder="${joint ? 'Share %' : 'Share of plot %'}" data-plain>
            <input name="pcons" type="number" class="num" step="any" min="0" value="${esc(x.consideration ?? '')}" placeholder="${joint ? 'Deposit ₹' : 'Price ₹'}" data-plain>
            <button type="button" class="btn xs ghost icon" data-del-row title="Remove">${icon('x')}</button></div>`;
    }
    function partnerRow(x, i) {
        return `<div class="cn-row cn-partner" data-i="${i}"><input name="mname" value="${esc(x.name || '')}" placeholder="Name" maxlength="100" data-plain>
            <input name="mphone" type="tel" value="${esc(x.phone || '')}" placeholder="Mobile" maxlength="14" data-plain>
            <input name="mshare" type="number" class="num" step="any" min="0" max="100" value="${esc(x.sharePercent ?? '')}" placeholder="Share %" data-plain>
            <label class="check-line"><input type="radio" name="mme" ${x.me ? 'checked' : ''}> me</label>
            <button type="button" class="btn xs ghost icon" data-del-row title="Remove" ${w.partners.length < 2 ? 'disabled' : ''}>${icon('x')}</button></div>`;
    }

    function read() {
        const form = body.querySelector('[data-form]');
        if (form) form.querySelectorAll('input[name], select[name]').forEach(i => {
            if (['contractValue'].includes(i.name)) { w.contractValue = i.value; return; }
            if (body.querySelector('[data-units]') && i.closest('[data-units]')) { w.units[i.name] = i.value; return; }
            if (['bankName', 'bankInstitution', 'bankNumber', 'bankAccountId'].includes(i.name)) { w[i.name] = i.value; return; }
            w.p[i.name] = i.value;
        });
        const skip = body.querySelector('[name="skipUnits"]');
        if (skip) w.units.skip = skip.checked;
        const rows = sel => [...body.querySelectorAll(sel)];
        if (body.querySelector('[data-stages]')) {
            if (w.kind === 'CONTRACT') w.stages = rows('[data-stages] .cn-row').map(r => ({ name: r.querySelector('[name=sname]').value, pct: r.querySelector('[name=spct]').value,
                amount: r.querySelector('[name=samt]').value, dueDate: r.querySelector('[name=sdue]').value }));
            else w.devStages = rows('[data-stages] .cn-row').map(r => ({ name: r.querySelector('[name=sname]').value, plannedEnd: r.querySelector('[name=send]').value }));
        }
        if (body.querySelector('[data-parties]')) {
            w.parties = rows('[data-parties] .cn-row').map(r => ({ name: r.querySelector('[name=pname]').value.trim(), relation: r.querySelector('[name=prel]').value.trim(),
                phone: r.querySelector('[name=pphone]').value.trim(), address: r.querySelector('[name=paddr]').value.trim(), sharePercent: r.querySelector('[name=pshare]').value,
                consideration: r.querySelector('[name=pcons]').value }));
        }
        if (body.querySelector('[data-partners]')) {
            w.partners = rows('[data-partners] .cn-row').map(r => ({ name: r.querySelector('[name=mname]').value.trim(), phone: r.querySelector('[name=mphone]').value.trim(),
                sharePercent: r.querySelector('[name=mshare]').value, me: r.querySelector('[name=mme]').checked }));
        }
    }
    function check() {
        const key = steps()[w.step][0];
        if (key === 'kind' && !String(w.p.name || '').trim()) throw new Error('Give the project a name');
        if (key === 'site' && w.p.startDate && w.p.plannedEndDate && w.p.plannedEndDate < w.p.startDate) throw new Error('The completion date is before the start');
        if (key === 'client') {
            if (!String(w.p.clientName || '').trim()) throw new Error('Enter the owner of the site');
            if (!phoneOk(w.p.clientPhone || '')) throw new Error('The owner’s mobile should have 10 digits');
        }
        if (key === 'land') {
            const named = w.parties.filter(x => x.name);
            if (!named.length) throw new Error(w.landMode === 'JOINT' ? 'Add the landowner(s)' : 'Add the seller(s) of the plot');
            if (named.some(x => !phoneOk(x.phone))) throw new Error('A mobile number should have 10 digits');
        }
        if (key === 'stages' && w.kind === 'CONTRACT') {
            const priced = w.stages.filter(s => s.name.trim() && num(s.amount) > 0);
            if (!priced.length) throw new Error('Give the stages their price (enter the contract price, or an amount on each stage)');
        }
        if (key === 'partners') {
            if (!String(w.p.companyName || '').trim()) throw new Error('Enter the construction company’s (or firm’s) name: it goes on the seal and the agreements');
            const named = w.partners.filter(x => x.name);
            const total = named.reduce((s, x) => s + num(x.sharePercent), 0);
            if (!named.length) throw new Error('Add at least one partner (you)');
            if (Math.abs(total - 100) > 0.001) throw new Error(`The shares make ${total}%; they should make 100%`);
            if (named.some(x => !phoneOk(x.phone))) throw new Error('A mobile number should have 10 digits');
        }
        if (key === 'money' && w.bankMode === 'EXISTING' && !w.bankAccountId) throw new Error('Pick the account the project’s money goes into');
    }
    function payload() {
        const p = { ...w.p, kind: w.kind, landMode: w.kind === 'DEVELOPMENT' ? w.landMode : null };
        for (const k of ['plotArea', 'builtUpArea', 'floors', 'lateInterestPercent', 'lateGraceDays', 'defectLiabilityMonths', 'estimatedCost', 'plotPrice',
            'landownerSharePercent', 'refundableDeposit', 'flatsPlanned', 'saleRate']) p[k] = p[k] === '' || p[k] == null ? null : Number(p[k]);
        for (const k of Object.keys(p)) if (p[k] === '') p[k] = null;
        if (w.kind === 'CONTRACT') {
            p.landownerSharePercent = p.refundableDeposit = p.plotPrice = p.flatsPlanned = p.saleRate = null;
        } else {
            p.clientName = p.clientPhone = p.clientAddress = p.clientEmail = p.clientRelation = null;
        }
        const stages = w.kind === 'CONTRACT'
            ? w.stages.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), amount: num(s.amount) || null, dueDate: s.dueDate || null }))
            : w.devStages.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), plannedEnd: s.plannedEnd || null }));
        const u = w.units;
        return {
            project: p, stages,
            partners: w.partners.filter(x => x.name).map(x => ({ name: x.name, phone: x.phone || null, sharePercent: num(x.sharePercent), me: !!x.me })),
            parties: w.kind === 'DEVELOPMENT' ? w.parties.filter(x => x.name).map(x => ({ role: w.landMode === 'JOINT' ? 'LANDOWNER' : 'SELLER', name: x.name,
                relation: x.relation || null, phone: x.phone || null, address: x.address || null, sharePercent: x.sharePercent === '' ? null : num(x.sharePercent),
                consideration: x.consideration === '' ? null : num(x.consideration) })) : [],
            units: w.kind === 'DEVELOPMENT' && !u.skip ? { blocks: u.blocks || null, floorFrom: num(u.floorFrom), floorTo: num(u.floorTo), perFloor: num(u.perFloor),
                unitType: u.unitType || null, carpetArea: num(u.carpetArea) || null, builtUpArea: num(u.builtUpArea) || null, superArea: num(u.superArea) || null,
                rate: num(u.rate) || null, landownerUnits: num(u.landownerUnits) } : null,
            bankMode: w.bankMode, bankAccountId: w.bankMode === 'EXISTING' ? Number(w.bankAccountId) : null,
            bankName: w.bankName || null, bankInstitution: w.bankInstitution || null, bankNumber: w.bankNumber || null,
        };
    }
    function totals() {
        const stageTotal = body.querySelector('[data-stage-total]');
        if (stageTotal) {
            const sum = [...body.querySelectorAll('[data-stages] [name=samt]')].reduce((s, i) => s + num(i.value), 0);
            const pct = [...body.querySelectorAll('[data-stages] [name=spct]')].reduce((s, i) => s + num(i.value), 0);
            stageTotal.innerHTML = `Total <b>${money(sum)}</b> · ${Math.round(pct * 100) / 100}%${num(body.querySelector('[name=contractValue]')?.value) && Math.abs(sum - num(body.querySelector('[name=contractValue]').value)) > 1 ? ' · <span class="neg">differs from the contract price</span>' : ''}`;
        }
        const shareTotal = body.querySelector('[data-share-total]');
        if (shareTotal) {
            const s = [...body.querySelectorAll('[data-partners] [name=mshare]')].reduce((a, i) => a + num(i.value), 0);
            shareTotal.innerHTML = `Shares: <b class="${Math.abs(s - 100) > 0.001 ? 'neg' : 'pos'}">${Math.round(s * 100) / 100}%</b>`;
        }
        const preview = body.querySelector('[data-unit-preview]');
        if (preview) {
            const u = Object.fromEntries([...body.querySelectorAll('[data-units] input')].map(i => [i.name, i.value]));
            const blocks = (u.blocks || '').split(',').filter(s => s.trim()).length || 1;
            const count = blocks * Math.max(0, num(u.floorTo) - num(u.floorFrom) + 1) * num(u.perFloor);
            const area = num(u.superArea) || num(u.builtUpArea) || num(u.carpetArea);
            preview.innerHTML = body.querySelector('[name=skipUnits]')?.checked ? '' : `${count} flats${area && num(u.rate) ? ` · about ${money(area * num(u.rate))} each · ${moneyShort(area * num(u.rate) * (count - num(u.landownerUnits)))} for the builder's share` : ''}`;
        }
    }
    async function draw() {
        if (steps()[w.step][0] === 'money' && !accounts.length) accounts = await moneyAccounts();
        const list = steps();
        el.querySelector('[data-steps]').innerHTML = list.map(([, label], i) => `<li class="${i === w.step ? 'on' : i < w.step ? 'done' : ''}"><span>${i < w.step ? icon('check') : i + 1}</span>${esc(label)}</li>`).join('');
        body.innerHTML = views[list[w.step][0]]();
        const next = nextBtn();
        if (next) next.innerHTML = w.step === list.length - 1 ? `${icon('check')}Start the project` : `${icon('chevron-right')}Next`;
        el.querySelector('.modal-foot [data-action-index="1"]').style.visibility = w.step ? 'visible' : 'hidden';
        totals();
        body.querySelector('input:not([type=checkbox]):not([type=radio])')?.focus();
    }
    body.addEventListener('click', e => {
        const k = e.target.closest('[data-kind]');
        if (k) { read(); w.kind = k.dataset.kind; draw(); return; }
        const land = e.target.closest('[data-land]');
        if (land) { read(); w.landMode = land.dataset.land; draw(); return; }
        const bank = e.target.closest('[data-bank]');
        if (bank) { read(); w.bankMode = bank.dataset.bank; draw(); return; }
        const tpl = e.target.closest('[data-template]');
        if (tpl) {
            read();
            if (tpl.dataset.template === 'house') w.stages = CONTRACT_STAGES.map(([name, pct]) => ({ name, pct, amount: num(w.contractValue) ? Math.round(num(w.contractValue) * pct / 100) : '', dueDate: '' }));
            if (tpl.dataset.template === 'clear') w.stages = [{ name: '', pct: '', amount: '', dueDate: '' }];
            if (tpl.dataset.template === 'floors') w.devStages = developmentStages(num(w.p.floors)).map(([name]) => ({ name, plannedEnd: '' }));
            draw();
            return;
        }
        if (e.target.closest('[data-add-stage]')) { read(); (w.kind === 'CONTRACT' ? w.stages : w.devStages).push({ name: '', pct: '', amount: '', dueDate: '', plannedEnd: '' }); draw(); return; }
        if (e.target.closest('[data-add-party]')) { read(); w.parties.push({}); draw(); return; }
        if (e.target.closest('[data-add-partner]')) { read(); w.partners.push({ name: '', sharePercent: '', me: false }); draw(); return; }
        const del = e.target.closest('[data-del-row]');
        if (del) {
            read();
            const i = Number(del.closest('[data-i]').dataset.i);
            const list = del.closest('[data-stages]') ? (w.kind === 'CONTRACT' ? w.stages : w.devStages) : del.closest('[data-parties]') ? w.parties : w.partners;
            list.splice(i, 1);
            draw();
        }
    });
    body.addEventListener('input', e => {
        // the price follows the percent (and the contract price), and the other way round
        const value = num(body.querySelector('[name=contractValue]')?.value);
        if (e.target.name === 'contractValue') {
            body.querySelectorAll('[data-stages] .cn-row').forEach(r => { const p = num(r.querySelector('[name=spct]').value); if (p) r.querySelector('[name=samt]').value = Math.round(value * p / 100); });
        } else if (e.target.name === 'spct' && value) {
            e.target.closest('.cn-row').querySelector('[name=samt]').value = Math.round(value * num(e.target.value) / 100);
        } else if (e.target.name === 'samt' && value) {
            e.target.closest('.cn-row').querySelector('[name=spct]').value = Math.round(num(e.target.value) / value * 10000) / 100;
        }
        if (e.target.name === 'skipUnits') body.querySelector('[data-units]').hidden = e.target.checked;
        totals();
    });
    body.addEventListener('change', e => {
        if (e.target.name === 'skipUnits') { body.querySelector('[data-units]').hidden = e.target.checked; totals(); }
    });
    draw();
}

// ===================================================================== the project's settings

export function openSettings(d, after) {
    const p = d.project;
    const dev = p.kind === 'DEVELOPMENT';
    const v = k => esc(p[k] ?? '');
    const f = (label, name, { type = 'text', span = '', hint = '', attrs = '' } = {}) => `<label class="field ${span}"><span>${label}${hint ? ` <small class="muted">${hint}</small>` : ''}</span>
        <input name="${name}" type="${type}" ${type === 'number' ? 'class="num" step="any" min="0"' : ''} value="${v(name)}" ${attrs} data-plain></label>`;
    openModal({
        title: `Settings · ${p.name}`, iconName: 'settings', size: 'lg',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            ${f('Project name', 'name', { attrs: 'maxlength="100" required' })}${f('Short code', 'code', { attrs: 'maxlength="6"' })}
            ${f('Site address', 'siteAddress', { span: 'span-2' })}${f('City / town', 'city')}${f('Survey No.', 'surveyNo')}${f('Plot No.', 'plotNo')}
            <div class="field"><span>Plot area</span><div class="row"><input name="plotArea" type="number" class="num" step="any" value="${v('plotArea')}" data-plain>
                <select name="areaUnit">${AREA_UNITS.map(([x, l]) => `<option value="${x}" ${p.areaUnit === x ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
            ${f('Boundaries', 'boundaries', { span: 'span-2' })}${f('Built-up area', 'builtUpArea', { type: 'number', hint: 'sq ft' })}${f('Floors', 'floors', { type: 'number' })}
            ${f('Building permission No.', 'permitNo')}${dev ? f('RERA No.', 'reraNo') : '<span></span>'}
            ${f('Start', 'startDate', { type: 'date' })}${f('Completion', 'plannedEndDate', { type: 'date' })}
            ${f('Estimated cost', 'estimatedCost', { type: 'number' })}${f('Late interest', 'lateInterestPercent', { type: 'number', hint: '% a month' })}
            ${f('Grace days', 'lateGraceDays', { type: 'number' })}${dev ? f('List rate', 'saleRate', { type: 'number', hint: '₹ a sq ft' }) : f('Defect liability', 'defectLiabilityMonths', { type: 'number', hint: 'months' })}
            ${dev ? (p.landMode === 'JOINT' ? `${f('Landowners’ share', 'landownerSharePercent', { type: 'number', hint: '%' })}${f('Refundable deposit', 'refundableDeposit', { type: 'number' })}`
                : `${f('Plot price', 'plotPrice', { type: 'number' })}<span></span>`) : ''}
            ${!dev ? `<div class="section-title span-2">${icon('user')}The owner</div>${f('Name', 'clientName', { attrs: 'required' })}${f('S/o, D/o, W/o', 'clientRelation')}
                ${f('Mobile', 'clientPhone', { type: 'tel' })}${f('E-mail', 'clientEmail', { type: 'email' })}${f('Address', 'clientAddress', { span: 'span-2' })}` : ''}
            <div class="section-title span-2">${icon('building')}The company</div>
            ${f('Company / firm', 'companyName')}${f('Office address', 'companyAddress')}${f('Signs as', 'signerName')}${f('Designation', 'signerDesignation')}
            <div class="span-2 ag-sig"><div class="ag-sig-now">${p.companySignature ? signatureSvg(p.companySignature) : '<span class="muted small">No signature yet</span>'}<small>Signature on agreements and receipts</small></div>
                <div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-draw>${icon('edit')}Sign on this device</button></div>
                <div data-pad-wrap hidden>${padHtml('company', `${p.signerName || 'Signatory'} signs here`)}</div></div>
            <label class="field span-2"><span>Notes</span><textarea name="notes" rows="2" maxlength="1000" data-plain>${v('notes')}</textarea></label>
        </form>`,
        onOpen: m => {
            m.el.querySelector('[data-draw]').addEventListener('click', () => { m.el.querySelector('[data-pad-wrap]').hidden = false; });
            m.pad = bindPad(m.el, 'company');
        },
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const form = m.el.querySelector('[data-f]');
            const body = { kind: p.kind, landMode: p.landMode };
            form.querySelectorAll('input[name], select[name], textarea[name]').forEach(i => { body[i.name] = i.value.trim() === '' ? null : i.type === 'number' ? Number(i.value) : i.value.trim(); });
            if (!phoneOk(body.clientPhone || '')) throw new Error('The owner’s mobile should have 10 digits');
            let out = await api.put(`/construction/${p.id}`, body);
            if (m.pad && !m.pad.empty()) out = await api.put(`/construction/${p.id}/signature`, { signature: m.pad.path() });
            after(out, 'Saved');
        } }],
    });
}

// ===================================================================== stages and extra works

export function openStage(d, s, after) {
    const p = d.project;
    const contract = p.kind === 'CONTRACT';
    openModal({
        title: s ? `Stage · ${s.name}` : 'Add a stage', sub: p.name, iconName: 'layers',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field span-2"><span>Stage</span><input name="name" maxlength="100" value="${esc(s?.name || '')}" required data-plain></label>
            ${contract ? `<label class="field"><span>Price</span><input name="amount" type="number" class="num" step="any" min="0" value="${esc(s?.amount ?? '')}" data-plain></label>
                <label class="field"><span>Paid by <small class="muted">empty: 7 days after it is done</small></span><input name="dueDate" type="date" value="${esc(s?.dueDate || '')}"></label>` : ''}
            <label class="field"><span>Planned start</span><input name="plannedStart" type="date" value="${esc(s?.plannedStart || '')}"></label>
            <label class="field"><span>Planned completion</span><input name="plannedEnd" type="date" value="${esc(s?.plannedEnd || '')}"></label>
            <label class="field span-2"><span>Description</span><textarea name="description" rows="2" maxlength="500" data-plain>${esc(s?.description || '')}</textarea></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { name: t(f, 'name'), amount: n(f, 'amount'), dueDate: t(f, 'dueDate'), plannedStart: t(f, 'plannedStart'), plannedEnd: t(f, 'plannedEnd'), description: t(f, 'description') };
            if (!body.name) throw new Error('Name the stage');
            after(s ? await api.put(`/construction/${p.id}/stages/${s.id}`, body) : await api.post(`/construction/${p.id}/stages`, body), 'Saved');
        } }],
    });
}

export function openStageDone(d, s, after) {
    openModal({
        title: `${s.name} done`, sub: d.project.name, iconName: 'check-circle',
        body: `<form class="form-grid two" data-f onsubmit="return false"><label class="field"><span>Done on</span><input name="on" type="date" value="${isoDate()}"></label></form>
            ${d.project.kind === 'DEVELOPMENT' ? '<p class="hint">Buyers’ instalments linked to this stage fall due the days set in their plans after this date.</p>'
                : !s.dueDate && num(s.amount) ? `<p class="hint">The owner pays ${money(s.amount)} for it within 7 days.</p>` : ''}`,
        actions: [{ label: 'Cancel' }, { label: 'Mark done', kind: 'primary', iconName: 'check', onClick: async m => {
            after(await api.post(`/construction/${d.project.id}/stages/${s.id}/progress`, { status: 'DONE', completedOn: m.el.querySelector('[name=on]').value || null }), `${s.name} done`);
        } }],
    });
}

export function openExtra(d, x, after) {
    const p = d.project;
    openModal({
        title: x ? `Extra work EX-${x.seq}` : 'Add an extra work', sub: `${p.name} · the owner asked for more`, iconName: 'plus',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field span-2"><span>What</span><input name="title" maxlength="120" value="${esc(x?.title || '')}" required placeholder="e.g. An extra bathroom on the first floor" data-plain></label>
            <label class="field span-2"><span>Details</span><textarea name="description" rows="2" maxlength="1000" data-plain>${esc(x?.description || '')}</textarea></label>
            <label class="field"><span>Price</span><input name="amount" type="number" class="num" step="any" min="0" value="${esc(x?.amount ?? '')}" required data-plain></label>
            <label class="field"><span>Adds to the timeline <small class="muted">days</small></span><input name="extraDays" type="number" class="num" min="0" value="${esc(x?.extraDays ?? 0)}" data-plain></label>
            <label class="field"><span>Asked on</span><input name="requestedOn" type="date" value="${esc(x?.requestedOn || isoDate())}"></label>
            <label class="field"><span>Paid by <small class="muted">empty: 7 days after it is done</small></span><input name="dueDate" type="date" value="${esc(x?.dueDate || '')}"></label>
        </form><p class="hint">It counts once agreed: make its supplementary agreement (the owner signs it online or on stamp paper), or mark it agreed.</p>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { title: t(f, 'title'), description: t(f, 'description'), amount: n(f, 'amount'), extraDays: n(f, 'extraDays'), requestedOn: t(f, 'requestedOn'), dueDate: t(f, 'dueDate') };
            if (!body.title || body.amount == null) throw new Error('Say what it is and its price');
            after(x ? await api.put(`/construction/${p.id}/extras/${x.id}`, body) : await api.post(`/construction/${p.id}/extras`, body), 'Saved');
        } }],
    });
}

// ===================================================================== money received

/** Money from the owner (contract work), or a buyer or their bank (a flat's sale: saleId). */
export async function openReceipt(d, { receipt = null, saleId = null } = {}, after) {
    const p = d.project;
    const accounts = await moneyAccounts();
    const sales = d.sales.filter(s => s.sale.status !== 'CANCELLED');
    const sale = id => sales.find(s => s.sale.id === Number(id));
    const r = receipt;
    const initialSale = r?.saleId ?? saleId ?? (p.kind === 'DEVELOPMENT' ? sales[0]?.sale.id : null);
    const dueText = () => {
        if (p.kind === 'CONTRACT') return `${money(d.figures.due)} due now${num(d.figures.overdue) ? ` (${money(d.figures.overdue)} overdue)` : ''}${num(d.figures.interestDue) ? ` + ${money(d.figures.interestDue)} interest` : ''} · ${money(d.figures.upcoming)} not due yet`;
        const s = sale(modalRef?.el.querySelector('[name=saleId]')?.value ?? initialSale);
        return s ? `${money(s.due)} due · ${money(s.balance)} still to pay${num(s.interestDue) ? ` · ${money(s.interestDue)} interest` : ''}` : '';
    };
    let modalRef = null;
    const suggestedInterest = () => p.kind === 'CONTRACT' ? num(d.figures.interestDue) : num(sale(modalRef?.el.querySelector('[name=saleId]')?.value)?.interestDue);
    modalRef = openModal({
        title: r ? `Receipt ${r.receiptNo}` : 'Money received', sub: p.name, iconName: 'arrow-in',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            ${p.kind === 'DEVELOPMENT' ? `<label class="field span-2"><span>For the flat</span><select name="saleId" required>${sales.map(s =>
                `<option value="${s.sale.id}" ${s.sale.id === initialSale ? 'selected' : ''}>${esc(s.unitLabel)} · ${esc(s.sale.buyerName)}</option>`).join('')}</select></label>
                <div class="field span-2"><span>From</span><div class="ln-chips" data-chips data-payer>${[['BUYER', 'The buyer'], ['BANK', 'The buyer’s bank (home loan)']].map(([v, l]) =>
                    `<button type="button" class="date-chip ${(r?.payer || 'BUYER') === v ? 'selected' : ''}" data-value="${v}">${l}</button>`).join('')}</div></div>` : ''}
            <label class="field"><span>Amount received</span><input name="amount" type="number" class="num" step="any" min="0" value="${esc(r?.amount ?? '')}" required data-plain></label>
            <label class="field"><span>Of it, late interest <button type="button" class="link-btn" data-fill-interest>fill</button></span><input name="interestAmount" type="number" class="num" step="any" min="0" value="${esc(r?.interestAmount ?? '')}" data-plain></label>
            <p class="span-2 muted small" data-due>${dueText()}</p>
            <label class="field"><span>Received on</span><input name="receivedOn" type="date" value="${esc(r?.receivedOn || isoDate())}"></label>
            <label class="field"><span>Into</span><select name="accountId" required>${moneyOptions(accounts, p.id, r?.accountId ?? p.bankAccountId)}</select></label>
            <div class="field span-2"><span>Paid by</span>${modeChips(r?.mode || 'Bank')}</div>
            <label class="field"><span>Reference <small class="muted">UTR, cheque No.</small></span><input name="reference" maxlength="60" value="${esc(r?.reference || '')}" data-plain></label>
            <label class="field"><span>Towards</span><input name="towards" maxlength="200" value="${esc(r?.towards || '')}" placeholder="e.g. Slab 2, EX-1" list="cn-towards" data-plain></label>
            <datalist id="cn-towards">${[...d.stages.map(s => s.name), ...d.extras.map(x => `EX-${x.seq} ${x.title}`)].map(v => `<option value="${esc(v)}">`).join('')}</datalist>
            <label class="field span-2"><span>Note</span><input name="note" maxlength="300" value="${esc(r?.note || '')}" data-plain></label>
        </form>`,
        onOpen: m => {
            bindChips(m.el);
            m.el.querySelector('[name=saleId]')?.addEventListener('change', () => { m.el.querySelector('[data-due]').textContent = dueText(); });
            m.el.querySelector('[data-fill-interest]').addEventListener('click', () => { m.el.querySelector('[name=interestAmount]').value = Math.round(suggestedInterest()) || ''; });
        },
        actions: [{ label: 'Cancel' }, { label: r ? 'Save' : 'Record and make the receipt', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { saleId: f.saleId ? Number(f.saleId.value) : null, payer: chosen(m.el, '[data-payer]') || (p.kind === 'CONTRACT' ? 'OWNER' : 'BUYER'),
                amount: n(f, 'amount'), interestAmount: n(f, 'interestAmount'), receivedOn: t(f, 'receivedOn'), mode: chosen(m.el, '[data-mode-chips]'),
                reference: t(f, 'reference'), accountId: Number(f.accountId.value) || null, towards: t(f, 'towards'), note: t(f, 'note') };
            if (!body.amount) throw new Error('Enter the amount received');
            if (!body.accountId) throw new Error('Pick the account it went into');
            const out = r ? await api.put(`/construction/${p.id}/receipts/${r.id}`, body) : await api.post(`/construction/${p.id}/receipts`, body);
            after(out, r ? 'Receipt saved' : `Receipt ${out.receipts[0]?.receiptNo || ''} recorded`, r ? null : out.receipts[0]);
        } }],
    });
}

/** A receipt as it prints (A5): the company, the payer, the amount in figures and words, what for, signed and sealed. */
export function printReceipt(d, r) {
    const p = d.project;
    const s = r.saleId ? d.sales.find(x => x.sale.id === r.saleId) : null;
    const words = amountInWords(r.amount);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.receiptNo)}</title>
        <link rel="stylesheet" href="${location.origin}/css/bond.css"><style>
        @page { size: A5 landscape; margin: 10mm; } body { margin: 0; font-family: "Times New Roman", serif; color: #1b2430; }
        .rc { border: 2px double #2f6b3a; padding: 8mm 10mm; position: relative; } .rc h1 { margin: 0; font-size: 20pt; letter-spacing: .08em; text-align: center; }
        .rc .co { text-align: center; font-size: 10pt; color: #4b5560; } .rc .top { display: flex; justify-content: space-between; margin: 4mm 0; font-size: 11pt; }
        .rc p { font-size: 12.5pt; line-height: 1.7; margin: 2mm 0; } .rc .amt { display: inline-block; border: 1.5px solid #1b2430; padding: 1mm 4mm; font-size: 15pt; font-weight: 700; }
        .rc .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 6mm; font-size: 10pt; }
        .rc .sg { text-align: center; min-width: 60mm; position: relative; } .rc .sg svg.bond-sign { width: 50mm; height: 15mm; } .rc .sg .seal { position: absolute; right: -6mm; top: -12mm; width: 24mm; height: 24mm; color: #5b3fb0; opacity: .85; transform: rotate(-12deg); }
        .rc small { color: #66727e; }</style></head><body><div class="rc">
        <h1>RECEIPT</h1><div class="co"><b>${esc(p.companyName || '')}</b>${p.companyAddress ? ` · ${esc(p.companyAddress)}` : ''}</div>
        <div class="top"><span>No. <b>${esc(r.receiptNo)}</b></span><span>Date <b>${esc(date(r.receivedOn))}</b></span></div>
        <p>Received with thanks from <b>${esc(r.payerName || '')}</b>${r.payer === 'BANK' && s ? ` on behalf of ${esc(s.sale.buyerName)}` : ''} the sum of
            <b>${esc(words)}</b> by ${esc(r.mode || '')}${r.reference ? ` (ref. ${esc(r.reference)})` : ''}
            towards ${s ? `flat <b>${esc(s.unitLabel)}</b> in` : ''} <b>${esc(p.name)}</b>${r.towards ? ` · ${esc(r.towards)}` : ''}${num(r.interestAmount) ? `, including ${esc(money(r.interestAmount))} of late payment interest` : ''}.</p>
        <p><span class="amt">${esc(money(r.amount))}</span>${s ? ` &nbsp;<small>Total price ${esc(money(s.sale.totalPrice))} · received so far ${esc(money(s.received))} · balance ${esc(money(s.balance))}</small>` : ''}</p>
        <div class="foot"><small>${r.mode === 'Cheque' ? 'Subject to the realisation of the cheque.<br>' : ''}This receipt is computer-generated from the books of ${esc(p.companyName || p.name)}.</small>
            <div class="sg">${p.companySignature ? signatureSvg(p.companySignature) : '<br><br>'}<span class="seal"></span><div style="border-top:1px solid #1b2430">For ${esc(p.companyName || '')}<br><small>${esc(p.signerName || '')}${p.signerDesignation ? `, ${esc(p.signerDesignation)}` : ''}</small></div></div></div>
        </div></body></html>`;
    const win = window.open('', '_blank', 'width=820,height=620');
    if (!win) { toast('Allow pop-ups to print the receipt', 'error'); return; }
    win.document.write(html);
    win.document.close();
    import('../core/bond.js').then(({ sealSvg }) => {
        const seal = win.document.querySelector('.seal');
        if (seal && p.companyName) seal.innerHTML = sealSvg(p.companyName);
        setTimeout(() => win.print(), 300);
    });
}

/** "Rupees Twelve Lakh Thirty Four Thousand only" (the Indian way). */
export function amountInWords(v) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
        'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = x => x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`;
    let rupees = Math.floor(num(v));
    const paise = Math.round((num(v) - rupees) * 100);
    const parts = [];
    for (const [size, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
        if (rupees >= size) { parts.push(`${two(Math.floor(rupees / size)) || amountInWords(Math.floor(rupees / size)).replace(/^Rupees |\s*only$/g, '')} ${name}`); rupees %= size; }
    }
    if (rupees >= 100) { parts.push(`${ones[Math.floor(rupees / 100)]} Hundred`); rupees %= 100; }
    if (rupees) parts.push(two(rupees));
    return `Rupees ${parts.join(' ') || 'Zero'}${paise ? ` and ${two(paise)} Paise` : ''} only`;
}

// ===================================================================== costs

/** The unit a head is usually bought in (filled in when the unit is empty). */
const HEAD_UNITS = { CEMENT: 'bags', STEEL: 'kg', SAND_AGGREGATE: 'loads', BRICKS_BLOCKS: 'nos', CONCRETE: 'cum', LABOUR: 'days', CONTRACTOR: 'lumpsum',
    CENTERING: 'sq ft', EXCAVATION: 'cft', FLOORING: 'sq ft', PAINTING: 'sq ft', TRANSPORT: 'trips', EQUIPMENT: 'days', ELECTRICAL: 'lumpsum',
    PLUMBING: 'lumpsum', DOORS_WINDOWS: 'nos', FABRICATION: 'kg' };
const TOP_HEADS = 10;
const VISIBLE_PAYERS = 6;

/**
 * Adding (or changing) a cost, laid out like the expense dialog: a big amount (a sum like 1200+350, or worked out from
 * quantity × rate), date chips, what and from whom on the left; on the right the head as tiles (the ones this project
 * uses most first, the rest found by typing), the account it was paid from as chips (the project's own first, then
 * the common accounts, then mine and my cards), the stage it was for and how the spending stands against the estimate.
 * Picking a head fills its usual unit and the last rate paid; a vendor picked from the list fills the last head and
 * rate bought from them. Shift+Enter saves and starts the next one; a photo of the bill goes with the entry.
 */
export async function openCost(d, c, after) {
    const p = d.project;
    const [list, accounts] = await Promise.all([heads(), loadAccounts(true, { all: true })]);
    const payFrom = accounts.filter(a => a.active && !a.chitBook && ['CASH', 'BANK', 'WALLET', 'CREDIT_CARD'].includes(a.accountType)
        && (!a.projectBook || !a.projectId || a.projectId === p.id));
    // the project's own accounts, then the common ones, then mine (the most used for this project's costs first)
    const used = {};
    d.costs.forEach(x => { used[x.accountId] = (used[x.accountId] || 0) + 1; });
    const rank = a => (a.projectBook && a.projectId === p.id) || a.id === p.bankAccountId ? 0 : a.projectBook ? 1 : 2;
    const payers = payFrom.sort((a, b) => rank(a) - rank(b) || (used[b.id] || 0) - (used[a.id] || 0) || a.name.localeCompare(b.name));
    const offered = list.filter(h => h !== 'LAND' || p.kind === 'DEVELOPMENT');
    let byHead = Object.fromEntries(d.costHeads.map(h => [h.head, h]));
    const extraHeads = d.costHeads.map(h => h.head).filter(h => !offered.includes(h));
    const tiles = [...offered, ...extraHeads].sort((a, b) => (byHead[b]?.count || 0) - (byHead[a]?.count || 0) || offered.indexOf(a) - offered.indexOf(b));
    const lastOf = pred => d.costs.find(pred);   // newest first
    const vendors = [...new Set(d.costs.map(x => x.vendor).filter(Boolean))];
    const descriptions = [...new Set(d.costs.map(x => x.description).filter(Boolean))].slice(0, 40);
    const running = d.stages.find(s => s.status === 'IN_PROGRESS') || d.stages.find(s => s.status === 'PENDING');
    const head0 = c?.head || null;
    let f0 = d.figures;
    const day = n => { const x = new Date(); x.setDate(x.getDate() - n); return isoDate(x); };

    const tile = (h, i) => `<button type="button" class="cat-tile ${h === head0 ? 'selected' : ''}" data-head="${h}" data-search="${esc(headName(h).toLowerCase())}" ${i >= TOP_HEADS && h !== head0 ? 'hidden data-extra' : ''}
        title="${esc(headName(h))}${byHead[h] ? ` · ${money(byHead[h].amount)} so far, ${byHead[h].count}×` : ''}">
        <span class="chip-icon sm ${byHead[h] ? 'gold' : ''}">${icon(HEAD_ICONS[h] || 'layers')}</span><span class="cat-name">${esc(headName(h))}</span></button>`;
    const payer = a => {
        const { name, tone } = accountTypeIcon(a.accountType);
        const where = a.projectBook && a.projectId === p.id ? 'this project' : a.projectBook ? 'common' : a.accountType === 'CREDIT_CARD' ? 'my card' : 'mine';
        return `<button type="button" class="pay-chip" data-payer="${a.id}" title="${esc(a.name)} · ${esc(where)}">
            <span class="chip-icon sm ${tone}">${icon(name)}</span><span class="pay-text"><b>${esc(a.name)}</b><small>${esc(where)} · ${moneyShort(a.balance)}</small></span></button>`;
    };

    const modal = openModal({
        title: c ? 'Change the cost' : 'Add a cost', sub: p.name, iconName: 'receipt', size: 'lg expense-modal cn-cost-modal',
        body: `<form class="cn-cost-form" data-f onsubmit="return false" autocomplete="off">
            <input type="hidden" name="head" value="${esc(head0 || '')}"><input type="hidden" name="accountId" value="${esc(c?.accountId ?? '')}">
            <div class="xp-grid">
                <section class="xp-left">
                    <label class="xp-amount"><span class="xp-currency">₹</span>
                        <input name="amount" type="text" inputmode="decimal" class="num" placeholder="0" value="${esc(c?.amount ?? '')}" title="A sum works too: 12000+3500" data-plain></label>
                    <div class="xp-amount-calc" data-calc></div>
                    <div class="xp-dates">
                        <button type="button" class="date-chip" data-date="${day(0)}">Today</button><button type="button" class="date-chip" data-date="${day(1)}">Yesterday</button>
                        <button type="button" class="date-chip" data-date="${day(2)}">2 days ago</button>
                        <input type="date" name="spentOn" value="${esc(c?.spentOn || isoDate())}" max="${isoDate()}" required></div>
                    <label class="field"><span>What was it <small class="muted">optional</small></span><input name="description" maxlength="200" value="${esc(c?.description || '')}" placeholder="e.g. OPC 53 grade, 400 bags" list="cn-cost-desc" data-plain></label>
                    <datalist id="cn-cost-desc">${descriptions.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
                    <div class="cn-qty">
                        <label class="field"><span>Quantity</span><input name="quantity" type="number" class="num" step="any" min="0" value="${esc(c?.quantity ?? '')}" data-plain></label>
                        <label class="field"><span>Unit</span><input name="unit" maxlength="12" value="${esc(c?.unit || '')}" placeholder="bags…" list="cn-units" data-plain></label>
                        <label class="field"><span>Rate <button type="button" class="link-btn" data-last-rate hidden></button></span><input name="rate" type="number" class="num" step="any" min="0" value="${esc(c?.rate ?? '')}" data-plain></label>
                    </div>
                    <datalist id="cn-units">${['bags', 'tons', 'kg', 'cft', 'cum', 'brass', 'loads', 'nos', 'sq ft', 'rft', 'days', 'trips', 'lumpsum'].map(u => `<option value="${u}">`).join('')}</datalist>
                    <div class="form-grid two">
                        <label class="field"><span>Paid to</span><input name="vendor" maxlength="100" value="${esc(c?.vendor || '')}" placeholder="Supplier, contractor…" list="cn-vendors" data-plain></label>
                        <label class="field"><span>Bill No.</span><input name="billNo" maxlength="40" value="${esc(c?.billNo || '')}" placeholder="Optional" data-plain></label>
                    </div>
                    <datalist id="cn-vendors">${vendors.map(v => `<option value="${esc(v)}">`).join('')}</datalist>
                    ${evidenceFieldHtml({ hint: 'Photo of the bill or the delivery challan' })}
                </section>
                <section class="xp-right">
                    <div>
                        <div class="xp-section-head"><span class="section-title">${icon('tag')} Spent on</span>
                            <div class="xp-cat-find">${icon('search')}<input class="xp-cat-search" placeholder="Find or type a new head… Enter" data-head-search data-plain data-enter-self>
                                ${tiles.length > TOP_HEADS ? `<button type="button" class="link-btn" data-all-heads>All ${tiles.length}</button>` : ''}</div></div>
                        <div class="cat-grid cn-head-grid" data-heads>${tiles.map(tile).join('')}</div>
                        <div class="small muted" data-new-head hidden></div>
                    </div>
                    <div>
                        <div class="xp-section-head"><span class="section-title">${icon('wallet')} Paid from</span><span class="small muted">the project’s, common, or yours</span></div>
                        <div class="pay-grid" data-payers></div>
                    </div>
                    ${d.stages.length ? `<label class="field"><span>For the stage <small class="muted">optional</small></span><select name="stageId"><option value="">—</option>${d.stages.map(s =>
                        `<option value="${s.id}" ${(c ? c.stageId === s.id : running?.id === s.id) ? 'selected' : ''}>${esc(s.name)}${s.status === 'IN_PROGRESS' ? ' · in progress' : s.status === 'DONE' ? ' · done' : ''}</option>`).join('')}</select></label>` : ''}
                    <div class="xp-budget" data-budget></div>
                </section>
            </div>
        </form>`,
        actions: [
            ...(c ? [] : [{ label: 'Save & add another', iconName: 'plus', left: true, onClick: m => save(m, true) }]),
            { label: 'Cancel' },
            { label: c ? 'Save changes' : 'Save', kind: 'primary', iconName: 'check', onClick: m => save(m, false) },
        ],
    });
    const el = modal.el;
    const f = el.querySelector('[data-f]');
    const evidence = bindEvidenceField(el);
    const grid = el.querySelector('[data-heads]');
    let showAll = false;

    const amountOf = () => evalAmount(f.amount.value) || 0;
    const renderPayers = () => {
        const sel = Number(f.accountId.value) || (payers.find(a => a.id === p.bankAccountId) || payers[0])?.id;
        f.accountId.value = sel || '';
        let shown = showAll ? payers : payers.slice(0, VISIBLE_PAYERS);
        const chosenOne = payers.find(a => a.id === sel);
        if (chosenOne && !shown.includes(chosenOne)) shown = [...shown.slice(0, VISIBLE_PAYERS - 1), chosenOne];
        const more = payers.length - shown.length;
        el.querySelector('[data-payers]').innerHTML = shown.map(payer).join('')
            + (more > 0 ? `<button type="button" class="pay-chip more" data-more-payers>${icon('more')}<span class="pay-text"><b>${more} more</b><small>show all</small></span></button>` : '');
        el.querySelectorAll('[data-payer]').forEach(b => b.classList.toggle('selected', Number(b.dataset.payer) === sel));
    };
    const setHead = (h, { fill = true } = {}) => {
        f.head.value = h || '';
        grid.querySelectorAll('[data-head]').forEach(t => {
            t.classList.toggle('selected', t.dataset.head === h);
            if (t.dataset.head === h) t.hidden = false;
        });
        const known = tiles.includes(h);
        const note = el.querySelector('[data-new-head]');
        note.hidden = !h || known;
        note.innerHTML = h && !known ? `${icon('plus')} A new head: <b>${esc(headName(h))}</b>` : '';
        if (fill && h) {
            if (!f.unit.value && HEAD_UNITS[h]) f.unit.value = HEAD_UNITS[h];
            lastRate();
        }
        budget();
    };
    const setDate = v => { f.spentOn.value = v; el.querySelectorAll('[data-date]').forEach(b => b.classList.toggle('selected', b.dataset.date === v)); };
    /** The last rate paid for this head (from this vendor when there is one), offered beside "Rate". */
    const lastRate = () => {
        const h = f.head.value;
        const vendor = f.vendor.value.trim().toLowerCase();
        const last = lastOf(x => x.head === h && x.rate != null && (!vendor || (x.vendor || '').toLowerCase() === vendor)) || lastOf(x => x.head === h && x.rate != null);
        const b = el.querySelector('[data-last-rate]');
        b.hidden = !last;
        if (last) {
            b.textContent = `last ${money(last.rate)}${last.unit ? `/${last.unit}` : ''}`;
            b.title = `${date(last.spentOn)}${last.vendor ? ` · ${last.vendor}` : ''}: ${num(last.quantity)} ${last.unit || ''} × ${money(last.rate)}`;
            b.onclick = () => { f.rate.value = last.rate; if (!f.unit.value && last.unit) f.unit.value = last.unit; calc(); };
        }
    };
    /** quantity × rate fills the amount; an amount with a quantity works out the rate. */
    const calc = (from = 'qty') => {
        const q = num(f.quantity.value), r = num(f.rate.value), amount = amountOf();
        if (from !== 'amount' && q && r) f.amount.value = Math.round(q * r * 100) / 100;
        else if (from === 'amount' && q && amount && !r) f.rate.value = Math.round(amount / q * 100) / 100;
        const isSum = /[+\-*/]/.test(f.amount.value.trim().replace(/^-/, ''));
        el.querySelector('[data-calc]').innerHTML = isSum ? (evalAmount(f.amount.value) === null ? '<span class="neg">not a sum</span>' : `= <b>${money(evalAmount(f.amount.value))}</b>`)
            : q && r ? `${num(q)} ${esc(f.unit.value || '')} × ${money(r)}` : '';
        budget();
    };
    /** Where the spending stands: the head so far, the project against its estimate, after this cost. */
    function budget() {
        const box = el.querySelector('[data-budget]');
        const amount = amountOf() - (c ? num(c.amount) : 0);
        const h = f.head.value;
        const spent = num(f0.totalCost), est = num(f0.estimatedCost);
        const afterIt = spent + amount;
        const pct = est ? afterIt / est * 100 : null;
        const headSoFar = num(byHead[h]?.amount);
        box.innerHTML = `
            ${h ? `<div class="row small"><b>${icon(HEAD_ICONS[h] || 'layers')} ${esc(headName(h))}</b><span class="spacer"></span><span class="secondary">${money(headSoFar)} so far${byHead[h] ? ` · ${byHead[h].count}×` : ''}${amount ? ` → <b>${money(headSoFar + amount)}</b>` : ''}</span></div>` : ''}
            ${est ? `<div class="row small"><b>The project</b><span class="spacer"></span><span class="${pct > 100 ? 'neg' : 'secondary'}">${money(afterIt)} of ${money(est)} estimated · ${Math.round(pct)}%</span></div>
                <div class="progress ${pct > 100 ? 'over' : pct > 85 ? 'warning' : 'good'}"><span style="width:${Math.min(100, pct)}%"></span></div>
                <div class="small ${pct > 100 ? 'neg' : 'muted'}">${pct > 100 ? `${icon('alert')} ${money(afterIt - est)} over the estimate` : `${money(est - afterIt)} of the estimate left`}</div>`
                : `<span class="muted small">${icon('info')} ${money(afterIt)} spent on the project${amount ? ' after this' : ''}. Set an estimated cost in its settings to track it.</span>`}`;
    }

    renderPayers();
    if (head0) setHead(head0, { fill: false }); else budget();
    setDate(f.spentOn.value);
    calc('init');
    f.amount.addEventListener('input', () => calc('amount'));
    f.amount.addEventListener('blur', () => { const v = evalAmount(f.amount.value); if (v !== null && String(v) !== f.amount.value.trim()) { f.amount.value = String(v); calc('amount'); } });
    f.quantity.addEventListener('input', () => calc('qty'));
    f.rate.addEventListener('input', () => calc('qty'));
    f.unit.addEventListener('input', () => calc('init'));
    f.spentOn.addEventListener('change', () => setDate(f.spentOn.value));
    // a vendor bought from before brings the head they supplied and its last rate
    f.vendor.addEventListener('change', () => {
        const v = f.vendor.value.trim().toLowerCase();
        const last = v && lastOf(x => (x.vendor || '').toLowerCase() === v);
        if (last && !f.head.value) setHead(last.head);
        else lastRate();
        if (last && !Number(f.accountId.value)) { f.accountId.value = last.accountId; renderPayers(); }
    });
    el.addEventListener('click', e => {
        const t = e.target.closest('[data-head]');
        if (t && grid.contains(t)) { setHead(t.dataset.head); return; }
        const pay = e.target.closest('[data-payer]');
        if (pay) { f.accountId.value = pay.dataset.payer; renderPayers(); return; }
        if (e.target.closest('[data-more-payers]')) { showAll = true; renderPayers(); return; }
        const dc = e.target.closest('[data-date]');
        if (dc) { setDate(dc.dataset.date); return; }
        const all = e.target.closest('[data-all-heads]');
        if (all) {
            const open = all.textContent.startsWith('All');
            grid.querySelectorAll('[data-extra]').forEach(x => { x.hidden = !open && !x.classList.contains('selected'); });
            all.textContent = open ? 'Fewer' : `All ${tiles.length}`;
        }
    });
    // find a head by typing; Enter picks the first match, or makes a new head of what was typed
    const search = el.querySelector('[data-head-search]');
    search.addEventListener('input', () => {
        const term = search.value.trim().toLowerCase();
        grid.querySelectorAll('[data-head]').forEach(x => { x.hidden = term ? !x.dataset.search.includes(term) : (x.hasAttribute('data-extra') && !x.classList.contains('selected')); });
    });
    search.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const term = search.value.trim();
        if (!term) return;
        const first = [...grid.querySelectorAll('[data-head]')].find(x => !x.hidden);
        setHead(first ? first.dataset.head : term.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30));
        search.value = '';
        search.dispatchEvent(new Event('input'));
    });
    setTimeout(() => f.amount.focus(), 40);

    async function save(m, again) {
        const amount = evalAmount(f.amount.value);
        if (f.amount.value.trim() && amount === null) { f.amount.focus(); throw new Error('The amount is not a number or a sum'); }
        const head = f.head.value;
        if (!head) { search.focus(); throw new Error('Pick what it was spent on (or type a new head and press Enter)'); }
        if (!(amount > 0)) { f.amount.focus(); throw new Error('Enter the amount'); }
        if (!Number(f.accountId.value)) throw new Error('Pick the account it was paid from');
        const body = { head, description: t(f, 'description'), vendor: t(f, 'vendor'), billNo: t(f, 'billNo'), quantity: n(f, 'quantity'), unit: t(f, 'unit'),
            rate: n(f, 'rate'), amount, spentOn: t(f, 'spentOn'), accountId: Number(f.accountId.value), stageId: f.stageId ? Number(f.stageId.value) || null : null };
        const known = new Set(d.costs.map(x => x.id));
        const out = c ? await api.put(`/construction/${p.id}/costs/${c.id}`, body) : await api.post(`/construction/${p.id}/costs`, body);
        const saved = c ? out.costs.find(x => x.id === c.id) : out.costs.filter(x => !known.has(x.id)).sort((a, b) => b.id - a.id)[0];
        if (saved?.journalEntryId) await evidence.uploadTo(saved.journalEntryId);
        after(out, `${headName(head)} · ${money(amount)} ${c ? 'saved' : 'added'}`);
        if (!again) return false;
        d = out;   // the next one counts this one in
        f0 = out.figures;
        byHead = Object.fromEntries(out.costHeads.map(h => [h.head, h]));
        ['amount', 'quantity', 'rate', 'description', 'billNo'].forEach(k => { f[k].value = ''; });
        calc('init');
        f.amount.focus();
        return true;
    }
}

// ===================================================================== partners

export function openPartner(d, x, after) {
    const p = d.project;
    const others = d.partners.length;
    openModal({
        title: x ? `Partner · ${x.name}` : 'Add a partner', sub: p.name, iconName: 'users',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>Name</span><input name="name" maxlength="100" value="${esc(x?.name || '')}" required data-plain></label>
            <label class="field"><span>Mobile</span><input name="phone" type="tel" maxlength="14" value="${esc(x?.phone || '')}" data-plain></label>
            <label class="field span-2"><span>Address</span><input name="address" maxlength="200" value="${esc(x?.address || '')}" data-plain></label>
            ${x ? '' : `<label class="field"><span>Share of the profit <small class="muted">%</small></span><input name="sharePercent" type="number" class="num" min="0" max="100" step="any" value="${others ? '' : 100}" data-plain></label>
                <p class="muted small">${others ? 'Taken from your share; set everyone’s shares on the Partners tab.' : ''}</p>`}
            <label class="field span-2"><span>Note</span><input name="note" maxlength="200" value="${esc(x?.note || '')}" data-plain></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            if (!phoneOk(f.phone.value)) throw new Error('The mobile should have 10 digits');
            const body = { name: t(f, 'name'), phone: t(f, 'phone'), address: t(f, 'address'), note: t(f, 'note'), sharePercent: x ? x.sharePercent : num(f.sharePercent.value), me: x ? x.me : false };
            if (!body.name) throw new Error('Enter the partner’s name');
            after(x ? await api.put(`/construction/${p.id}/partners/${x.id}`, body) : await api.post(`/construction/${p.id}/partners`, body), 'Saved');
        } }],
    });
}

export function openShares(d, after) {
    const p = d.project;
    openModal({
        title: 'Partners’ shares of the profit', sub: p.name, iconName: 'pie',
        body: `<div class="cn-rows" data-shares>${d.partners.map(v => `<div class="cn-row cn-share" data-id="${v.partner.id}"><b>${esc(v.partner.name)}${v.partner.me ? ' <small class="muted">(me)</small>' : ''}</b>
            <small class="muted">invested ${money(v.invested)} · ${num(v.capitalSharePercent)}% of the capital</small>
            <input type="number" class="num" min="0" max="100" step="any" value="${num(v.partner.sharePercent)}" data-plain><span>%</span></div>`).join('')}</div>
            <div class="row"><button type="button" class="btn sm ghost" data-by-capital>${icon('refresh')}Share as the capital put in</button><span class="grow"></span><small data-total></small></div>`,
        onOpen: m => {
            const total = () => { const s = [...m.el.querySelectorAll('[data-shares] input')].reduce((a, i) => a + num(i.value), 0);
                m.el.querySelector('[data-total]').innerHTML = `Total <b class="${Math.abs(s - 100) > 0.001 ? 'neg' : 'pos'}">${Math.round(s * 100) / 100}%</b>`; };
            m.el.addEventListener('input', total);
            m.el.querySelector('[data-by-capital]').addEventListener('click', () => {
                m.el.querySelectorAll('[data-shares] .cn-row').forEach(r => { r.querySelector('input').value = num(d.partners.find(v => v.partner.id === Number(r.dataset.id)).capitalSharePercent); });
                total();
            });
            total();
        },
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const shares = [...m.el.querySelectorAll('[data-shares] .cn-row')].map(r => ({ partnerId: Number(r.dataset.id), sharePercent: num(r.querySelector('input').value) }));
            after(await api.put(`/construction/${p.id}/shares`, { shares }), 'Shares saved');
        } }],
    });
}

/**
 * A partner puts money in (or takes it out). The partner is picked from chips (the one whose button was pressed
 * first); the project's side is one of its own accounts, a common account or the project's bank; when the partner is
 * me, the other side is one of my own accounts (a transfer), otherwise the partner's capital account. Shows what the
 * partner will have in after it and their part of the capital.
 */
export async function openCapital(d, partnerId, kind, after) {
    const p = d.project;
    const invest = kind === 'INVEST';
    const accounts = await moneyAccounts();
    const projectSide = accounts.filter(a => (a.projectBook && (a.projectId === p.id || !a.projectId)) || a.id === p.bankAccountId);
    const mine = accounts.filter(a => !a.projectBook && a.id !== p.bankAccountId);
    const partnerOf = id => d.partners.find(v => v.partner.id === Number(id));
    let chosenId = partnerOf(partnerId) ? Number(partnerId) : d.partners[0]?.partner.id;
    const totalIn = d.partners.reduce((s, v) => s + num(v.invested), 0);
    openModal({
        title: invest ? 'Money put in' : 'Money taken out', sub: `${p.name} · partners’ capital`, iconName: invest ? 'arrow-in' : 'arrow-out',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <div class="field span-2"><span>Partner</span><div class="ln-chips cn-partner-pick" data-partners>${d.partners.map(v =>
                `<button type="button" class="date-chip ${v.partner.id === chosenId ? 'selected' : ''}" data-value="${v.partner.id}" title="Put in ${esc(money(v.invested))} · balance ${esc(money(v.balance))}">
                    ${icon(v.partner.me ? 'user' : 'users')}${esc(v.partner.name)}${v.partner.me ? ' (me)' : ''} <small class="muted">${moneyShort(v.balance)}</small></button>`).join('')}</div></div>
            <label class="field"><span>Amount</span><input name="amount" type="number" class="num" step="any" min="0" required data-plain></label>
            <label class="field"><span>Date</span><input name="movedOn" type="date" value="${isoDate()}" max="${isoDate()}"></label>
            <label class="field"><span>${invest ? 'Into the project’s account' : 'From the project’s account'}</span><select name="accountId">${moneyOptions(projectSide, p.id, p.bankAccountId)}</select></label>
            <label class="field" data-mine><span>${invest ? 'From my account' : 'Into my account'}</span><select name="fromAccountId">${moneyOptions(mine, p.id, null, { placeholder: 'Pick your account' })}</select></label>
            <label class="field span-2"><span>Note <small class="muted">optional</small></span><input name="note" maxlength="200" placeholder="${invest ? 'e.g. For the first slab · cheque 123456' : 'e.g. Advance against the profit'}" data-plain></label>
            <div class="span-2 cn-cap-preview" data-preview></div>
        </form>`,
        onOpen: m => {
            const el = m.el;
            const sync = () => {
                const v = partnerOf(chosenId);
                el.querySelector('[data-mine]').hidden = !v?.partner.me;
                const amount = num(el.querySelector('[name=amount]').value);
                if (!v) { el.querySelector('[data-preview]').innerHTML = ''; return; }
                const inAfter = num(v.invested) + (invest ? amount : 0);
                const balanceAfter = num(v.balance) + (invest ? amount : -amount);
                const share = totalIn + (invest ? amount : 0) ? inAfter / (totalIn + (invest ? amount : 0)) * 100 : 0;
                el.querySelector('[data-preview]').innerHTML = `${icon('info')}<span>${esc(v.partner.name)} has put in <b>${money(v.invested)}</b> and taken out ${money(v.withdrawn)}.
                    ${amount ? `After this: balance <b class="${balanceAfter < 0 ? 'neg' : ''}">${money(balanceAfter)}</b>${invest ? `, <b>${Math.round(share * 10) / 10}%</b> of the capital put in` : ''}.` : ''}
                    ${v.partner.me ? (invest ? ' Your money moves from your account into the project’s.' : ' The money comes back to your own account.') : ` Booked to ${esc(v.partner.name)}’s capital account (what the business owes them).`}</span>`;
            };
            el.querySelector('[data-partners]').addEventListener('click', e => {
                const c = e.target.closest('[data-value]');
                if (!c) return;
                chosenId = Number(c.dataset.value);
                el.querySelectorAll('[data-partners] [data-value]').forEach(x => x.classList.toggle('selected', x === c));
                sync();
            });
            el.querySelector('[name=amount]').addEventListener('input', sync);
            sync();
            setTimeout(() => el.querySelector('[name=amount]').focus(), 40);
        },
        actions: [{ label: 'Cancel' }, { label: invest ? 'Record money in' : 'Record money out', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const v = partnerOf(chosenId);
            if (!v) throw new Error('Pick the partner');
            const me = !!v.partner.me;
            const body = { partnerId: v.partner.id, kind, amount: n(f, 'amount'), movedOn: t(f, 'movedOn'), accountId: Number(f.accountId.value) || null,
                fromAccountId: me ? Number(f.fromAccountId.value) || null : null, note: t(f, 'note') };
            if (!body.amount) throw new Error('Enter the amount');
            if (!body.accountId) throw new Error('Pick the project’s account');
            if (me && !body.fromAccountId) throw new Error(`Pick your own account the money ${invest ? 'comes from' : 'goes to'}`);
            if (me && body.fromAccountId === body.accountId) throw new Error('Pick two different accounts');
            if (!invest && body.amount > num(v.balance)
                && !await confirmDialog(`${v.partner.name}'s balance is ${money(v.balance)}; taking out ${money(body.amount)} leaves it below zero. Record it anyway?`, { confirmLabel: 'Record', danger: false })) return true;
            after(await api.post(`/construction/${p.id}/capital`, body), `${money(body.amount)} ${invest ? 'put in by' : 'taken out by'} ${v.partner.name}`);
        } }],
    });
}

// ===================================================================== loans

export function openLoan(d, l, after) {
    const p = d.project;
    openModal({
        title: l ? `Loan · ${l.lender}` : 'A loan for the project', sub: p.name, iconName: 'bank',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>Lender</span><input name="lender" maxlength="100" value="${esc(l?.lender || '')}" required placeholder="e.g. HDFC Bank, or a person" data-plain></label>
            <label class="field"><span>Loan No.</span><input name="loanNo" maxlength="40" value="${esc(l?.loanNo || '')}" data-plain></label>
            <label class="field"><span>Sanctioned</span><input name="sanctioned" type="number" class="num" step="any" min="0" value="${esc(l?.sanctioned ?? '')}" required data-plain></label>
            <label class="field"><span>Interest <small class="muted">% a year</small></span><input name="ratePercent" type="number" class="num" step="any" min="0" value="${esc(l?.ratePercent ?? '')}" data-plain></label>
            <label class="field"><span>Tenure <small class="muted">months</small></span><input name="tenureMonths" type="number" class="num" min="0" value="${esc(l?.tenureMonths ?? '')}" data-plain></label>
            <label class="field"><span>Sanctioned on</span><input name="sanctionDate" type="date" value="${esc(l?.sanctionDate || '')}"></label>
            <label class="field span-2"><span>Note</span><input name="note" maxlength="300" value="${esc(l?.note || '')}" data-plain></label>
        </form><p class="hint">Disbursements, interest and repayments are recorded on the loan; its interest and charges count as costs of the project.</p>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { lender: t(f, 'lender'), loanNo: t(f, 'loanNo'), sanctioned: n(f, 'sanctioned'), ratePercent: n(f, 'ratePercent'), tenureMonths: n(f, 'tenureMonths'),
                sanctionDate: t(f, 'sanctionDate'), note: t(f, 'note') };
            if (!body.lender || !body.sanctioned) throw new Error('Enter the lender and the amount sanctioned');
            after(l ? await api.put(`/construction/${p.id}/loans/${l.id}`, body) : await api.post(`/construction/${p.id}/loans`, body), 'Saved');
        } }],
    });
}

const LOAN_TXN = { DISBURSE: ['Loan disbursed', 'arrow-in', 'Into'], INTEREST: ['Interest paid', 'percent', 'Paid from'], REPAY: ['Repayment', 'arrow-out', 'Paid from'],
    CHARGES: ['Charges paid', 'receipt', 'Paid from'] };
export async function openLoanTxn(d, loan, kind, after) {
    const p = d.project;
    const accounts = await moneyAccounts();
    const [title, ic, side] = LOAN_TXN[kind];
    openModal({
        title, sub: `${loan.lender} · ${p.name}`, iconName: ic,
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>Amount</span><input name="amount" type="number" class="num" step="any" min="0" required data-plain></label>
            <label class="field"><span>Date</span><input name="movedOn" type="date" value="${isoDate()}"></label>
            <label class="field span-2"><span>${side}</span><select name="accountId">${moneyOptions(accounts, p.id, p.bankAccountId)}</select></label>
            <label class="field span-2"><span>Note</span><input name="note" maxlength="200" data-plain></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Record', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { kind, amount: n(f, 'amount'), movedOn: t(f, 'movedOn'), accountId: Number(f.accountId.value) || null, note: t(f, 'note') };
            if (!body.amount || !body.accountId) throw new Error('Enter the amount and the account');
            after(await api.post(`/construction/${p.id}/loans/${loan.id}/txns`, body), `${title} recorded`);
        } }],
    });
}

// ===================================================================== land, flats

export function openParty(d, x, role, after) {
    const p = d.project;
    const joint = role === 'LANDOWNER';
    openModal({
        title: x ? x.name : joint ? 'Add a landowner' : 'Add a seller', sub: p.name, iconName: joint ? 'layers' : 'home',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>Name</span><input name="name" maxlength="100" value="${esc(x?.name || '')}" required data-plain></label>
            <label class="field"><span>S/o, D/o or W/o</span><input name="relation" maxlength="100" value="${esc(x?.relation || '')}" data-plain></label>
            <label class="field"><span>Mobile</span><input name="phone" type="tel" maxlength="14" value="${esc(x?.phone || '')}" data-plain></label>
            <label class="field"><span>${joint ? 'Share of the landowners’ part' : 'Share of the plot'} <small class="muted">%</small></span><input name="sharePercent" type="number" class="num" step="any" min="0" value="${esc(x?.sharePercent ?? '')}" data-plain></label>
            <label class="field span-2"><span>Address</span><input name="address" maxlength="200" value="${esc(x?.address || '')}" data-plain></label>
            <label class="field"><span>${joint ? 'Their part of the deposit' : 'Their part of the price'}</span><input name="consideration" type="number" class="num" step="any" min="0" value="${esc(x?.consideration ?? '')}" data-plain></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            if (!phoneOk(f.phone.value)) throw new Error('The mobile should have 10 digits');
            const body = { role, name: t(f, 'name'), relation: t(f, 'relation'), phone: t(f, 'phone'), address: t(f, 'address'), sharePercent: n(f, 'sharePercent'), consideration: n(f, 'consideration') };
            if (!body.name) throw new Error('Enter the name');
            after(x ? await api.put(`/construction/${p.id}/parties/${x.id}`, body) : await api.post(`/construction/${p.id}/parties`, body), 'Saved');
        } }],
    });
}

export function openUnits(d, after) {
    const p = d.project;
    openModal({
        title: 'Add flats', sub: `${p.name} · numbered floor first: 101, 102 … 201 …`, iconName: 'grid',
        body: `<form class="form-grid four" data-f onsubmit="return false">
            <label class="field"><span>Blocks <small class="muted">comma separated</small></span><input name="blocks" value="A" data-plain></label>
            <label class="field"><span>Floors from <small class="muted">0 = ground</small></span><input name="floorFrom" type="number" class="num" value="1" data-plain></label>
            <label class="field"><span>to</span><input name="floorTo" type="number" class="num" value="${num(p.floors) || 4}" data-plain></label>
            <label class="field"><span>Flats a floor</span><input name="perFloor" type="number" class="num" value="4" data-plain></label>
            <label class="field"><span>Type</span><input name="unitType" value="2BHK" data-plain></label>
            <label class="field"><span>Carpet area</span><input name="carpetArea" type="number" class="num" step="any" data-plain></label>
            <label class="field"><span>Built-up</span><input name="builtUpArea" type="number" class="num" step="any" data-plain></label>
            <label class="field"><span>Super area</span><input name="superArea" type="number" class="num" step="any" data-plain></label>
            <label class="field"><span>Rate <small class="muted">₹/sq ft</small></span><input name="rate" type="number" class="num" step="any" value="${num(p.saleRate) || ''}" data-plain></label>
            ${p.landMode === 'JOINT' ? '<label class="field"><span>Landowners’ flats</span><input name="landownerUnits" type="number" class="num" value="0" data-plain></label>' : ''}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Add the flats', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { blocks: t(f, 'blocks'), floorFrom: n(f, 'floorFrom'), floorTo: n(f, 'floorTo'), perFloor: n(f, 'perFloor'), unitType: t(f, 'unitType'),
                carpetArea: n(f, 'carpetArea'), builtUpArea: n(f, 'builtUpArea'), superArea: n(f, 'superArea'), rate: n(f, 'rate'), landownerUnits: n(f, 'landownerUnits') || 0 };
            after(await api.post(`/construction/${p.id}/units/bulk`, body), 'Flats added');
        } }],
    });
}

export function openUnit(d, u, after) {
    const p = d.project;
    const owners = d.parties.filter(x => x.role === 'LANDOWNER');
    openModal({
        title: u ? `Flat ${u.block ? `${u.block}-` : ''}${u.unitNo}` : 'Add a flat', sub: p.name, iconName: 'building',
        body: `<form class="form-grid three" data-f onsubmit="return false">
            <label class="field"><span>Flat No.</span><input name="unitNo" maxlength="20" value="${esc(u?.unitNo || '')}" required data-plain></label>
            <label class="field"><span>Block</span><input name="block" maxlength="20" value="${esc(u?.block || '')}" data-plain></label>
            <label class="field"><span>Floor</span><input name="floor" type="number" class="num" value="${esc(u?.floor ?? '')}" data-plain></label>
            <label class="field"><span>Type</span><input name="unitType" maxlength="20" value="${esc(u?.unitType || '')}" data-plain></label>
            <label class="field"><span>Facing</span><input name="facing" maxlength="12" value="${esc(u?.facing || '')}" placeholder="East" data-plain></label>
            <label class="field"><span>Car parking</span><input name="parking" maxlength="40" value="${esc(u?.parking || '')}" data-plain></label>
            <label class="field"><span>Carpet area</span><input name="carpetArea" type="number" class="num" step="any" value="${esc(u?.carpetArea ?? '')}" data-plain></label>
            <label class="field"><span>Built-up</span><input name="builtUpArea" type="number" class="num" step="any" value="${esc(u?.builtUpArea ?? '')}" data-plain></label>
            <label class="field"><span>Super area</span><input name="superArea" type="number" class="num" step="any" value="${esc(u?.superArea ?? '')}" data-plain></label>
            <label class="field"><span>List price</span><input name="price" type="number" class="num" step="any" value="${esc(u?.price ?? '')}" data-plain></label>
            ${p.landMode === 'JOINT' ? `<label class="field"><span>Belongs to</span><select name="allottedTo"><option value="BUILDER">Us (to sell)</option>
                ${owners.map(o => `<option value="P${o.id}" ${u?.partyId === o.id ? 'selected' : ''}>Landowner · ${esc(o.name)}</option>`).join('')}</select></label>` : ''}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const owner = f.allottedTo?.value?.startsWith('P') ? Number(f.allottedTo.value.slice(1)) : null;
            const body = { unitNo: t(f, 'unitNo'), block: t(f, 'block'), floor: n(f, 'floor'), unitType: t(f, 'unitType'), facing: t(f, 'facing'), parking: t(f, 'parking'),
                carpetArea: n(f, 'carpetArea'), builtUpArea: n(f, 'builtUpArea'), superArea: n(f, 'superArea'), price: n(f, 'price'),
                allottedTo: owner ? 'LANDOWNER' : 'BUILDER', partyId: owner };
            if (!body.unitNo) throw new Error('Enter the flat number');
            after(u ? await api.put(`/construction/${p.id}/units/${u.id}`, body) : await api.post(`/construction/${p.id}/units`, body), 'Saved');
        } }],
    });
}

// ===================================================================== accounts

/** Money moved between accounts for the project; fromId / toId set one side (Move in / Move out on an account). */
export async function openTransfer(d, after, { fromId = null, toId = null } = {}) {
    const p = d.project;
    const accounts = await moneyAccounts();
    openModal({
        title: 'Move money', sub: p.name, iconName: 'transfer',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>From</span><select name="fromAccountId">${moneyOptions(accounts, p.id, fromId ?? (toId === p.bankAccountId ? null : p.bankAccountId))}</select></label>
            <label class="field"><span>To</span><select name="toAccountId">${moneyOptions(accounts, p.id, toId)}</select></label>
            <label class="field"><span>Amount</span><input name="amount" type="number" class="num" step="any" min="0" required data-plain></label>
            <label class="field"><span>Date</span><input name="movedOn" type="date" value="${isoDate()}"></label>
            <label class="field span-2"><span>Note</span><input name="note" maxlength="200" data-plain></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Move', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { fromAccountId: Number(f.fromAccountId.value) || null, toAccountId: Number(f.toAccountId.value) || null, amount: n(f, 'amount'), movedOn: t(f, 'movedOn'), note: t(f, 'note') };
            if (!body.fromAccountId || !body.toAccountId || !body.amount) throw new Error('Pick both accounts and the amount');
            after(await api.post(`/construction/${p.id}/transfers`, body), 'Moved');
        } }],
    });
}

export function openCommonAccount(after) {
    openModal({
        title: 'A common business account', sub: 'Shared by every project', iconName: 'bank',
        body: `<form class="form-grid two" data-f onsubmit="return false">
            <label class="field"><span>Name</span><input name="name" maxlength="100" required placeholder="e.g. Sri Builders · current account" data-plain></label>
            <label class="field"><span>Kind</span><select name="type"><option value="BANK">Bank account</option><option value="CASH">Cash</option><option value="WALLET">Wallet</option></select></label>
            <label class="field"><span>Bank</span><input name="institution" maxlength="100" data-plain></label>
            <label class="field"><span>Account No.</span><input name="accountNumber" maxlength="40" data-plain></label>
            <label class="field"><span>Balance now</span><input name="openingBalance" type="number" class="num" step="any" min="0" data-plain></label>
            <label class="field"><span>As on</span><input name="openingDate" type="date" value="${isoDate()}"></label>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const body = { name: t(f, 'name'), type: f.type.value, institution: t(f, 'institution'), accountNumber: t(f, 'accountNumber'), openingBalance: n(f, 'openingBalance'), openingDate: t(f, 'openingDate') };
            if (!body.name) throw new Error('Name the account');
            await api.post('/construction/accounts', body);
            after(null, 'Account added');
        } }],
    });
}

// ===================================================================== finishing and closing

export function openStatus(d, after) {
    const p = d.project;
    const fig = d.figures;
    const shares = d.partners;
    const total = shares.reduce((s, v) => s + num(v.partner.sharePercent), 0) || 100;
    const split = shares.map(v => `<li><b>${esc(v.partner.name)}${v.partner.me ? ' (me)' : ''}</b> · ${num(v.partner.sharePercent)}% · ${money(num(fig.profit) * num(v.partner.sharePercent) / total)}</li>`).join('');
    const closed = p.status === 'CLOSED';
    openModal({
        title: closed ? `Re-open ${p.name}` : p.status === 'COMPLETED' ? `Close the books of ${p.name}` : `${p.name}: finished?`, iconName: closed ? 'unlock' : 'lock',
        body: closed ? `<p>Re-opening undoes the closing entry and the profit shares; everything can be changed again.</p>`
            : `<form class="form-grid two" data-f onsubmit="return false"><label class="field"><span>${p.status === 'COMPLETED' ? 'Closed on' : 'Completed on'}</span><input name="on" type="date" value="${esc(p.completedOn || isoDate())}"></label></form>
            ${p.status === 'COMPLETED' ? `<div class="cn-close"><p>Closing makes the books final: what was received (${money(num(fig.received) + num(fig.interestReceived))}) is set off against the costs
                (${money(fig.totalCost)}); the ${num(fig.profit) >= 0 ? 'profit' : 'loss'} of <b>${money(Math.abs(num(fig.profit)))}</b> is shared:</p><ul>${split}</ul>
                <p class="muted small">Your share is your income; another partner's goes to their capital account (what the business owes them). Re-open it any time to change something.</p></div>`
                : `<p class="hint">Marks the work done. Close the books afterwards, when all the money is in and paid out.</p>`}`,
        actions: [{ label: 'Cancel' }, { label: closed ? 'Re-open' : p.status === 'COMPLETED' ? 'Close the books' : 'Mark completed', kind: closed ? 'primary' : 'primary', iconName: closed ? 'unlock' : 'check', onClick: async m => {
            const on = m.el.querySelector('[name=on]')?.value || null;
            const status = closed ? 'COMPLETED' : p.status === 'COMPLETED' ? 'CLOSED' : 'COMPLETED';
            after(await api.post(`/construction/${p.id}/status`, { status, completedOn: on }), closed ? 'Re-opened' : status === 'CLOSED' ? 'Books closed' : 'Completed');
        } }],
    });
}

export async function confirmDelete(message, run) {
    if (!await confirmDialog(message, { confirmLabel: 'Delete' })) return;
    try { await run(); } catch (e) { toast(e.message, 'error'); }
}
