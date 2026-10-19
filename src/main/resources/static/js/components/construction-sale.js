/**
 * A flat's sale (Construction, a development): booking it for a buyer with the price and the payment plan, then one
 * dialog for everything after: what is due (each instalment against what came in, with late interest), the
 * receipts, the buyer's home loan and its letters, the documents, the agreements (for sale, tripartite with the bank,
 * the sale deed, possession) and the steps: agreement made, registered, handed over, closed.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, toast, openModal, confirmDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime, isoDate } from '../core/format.js';
import { openReceipt, printReceipt, num } from './construction-forms.js';
import { openProjectAgreement, AGREEMENT_KINDS } from './construction-agreement.js';

const manage = () => can('MANAGE_PROJECTS');
export const SALE_STEPS = [['BOOKED', 'Booked', 'tag'], ['AGREED', 'Agreement made', 'file-text'], ['REGISTERED', 'Registered', 'stamp'],
    ['HANDED_OVER', 'Handed over', 'key'], ['CLOSED', 'Closed', 'lock']];
export const DUE_TONE = { PAID: ['good', 'Paid'], UPCOMING: ['gray', 'Not due'], DUE: ['warning', 'Due'], OVERDUE: ['critical', 'Overdue'] };
const LOAN_STATUS = [['NONE', 'No loan'], ['APPLIED', 'Applied'], ['SANCTIONED', 'Sanctioned'], ['DISBURSING', 'Disbursing'], ['DISBURSED', 'Fully disbursed']];
const SALE_DOCS = [['SANCTION_LETTER', 'Loan sanction letter'], ['DISBURSAL_LETTER', 'Disbursement letter'], ['ALLOTMENT', 'Allotment letter'],
    ['SALE_DEED', 'Registered sale deed'], ['NOC', 'NOC'], ['SIGNED_COPY', 'Signed agreement'], ['INVOICE', 'Demand / invoice'], ['OTHER', 'Other']];
const unitLabel = u => u ? `${u.block ? `${u.block}-` : ''}${u.unitNo}` : '';
const addDays = (iso, days) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDate(d); };

/** The payment plans to start from (the rows can be changed). */
function template(kind, d, start) {
    const open = d.stages.filter(s => s.status !== 'DONE');
    const last = d.stages[d.stages.length - 1];
    if (kind === 'CLP') {
        const mid = open.slice(0, Math.max(0, open.length - 1));
        const each = mid.length ? Math.floor(7000 / mid.length) / 100 : 0;
        const rows = [{ label: 'Booking amount', percent: 10, dueDate: start }, { label: 'On the agreement for sale', percent: 10, dueDate: addDays(start, 30) }];
        mid.forEach((s, i) => rows.push({ label: `On ${s.name}`, percent: i === mid.length - 1 ? Math.round((70 - each * (mid.length - 1)) * 100) / 100 : each, stageId: s.id, daysAfterStage: 15 }));
        rows.push(last ? { label: 'On possession', percent: mid.length ? 10 : 80, stageId: last.id, daysAfterStage: 15 } : { label: 'On possession', percent: 80, dueDate: addDays(start, 540) });
        return rows;
    }
    if (kind === 'TIME') {
        const rows = [{ label: 'Booking amount', percent: 20, dueDate: start }];
        for (let i = 1; i <= 8; i++) rows.push({ label: `Instalment ${i}`, percent: 10, dueDate: addDays(start, 90 * i) });
        return rows;
    }
    if (kind === 'DOWN') return [{ label: 'Booking amount', percent: 10, dueDate: start }, { label: 'Down payment', percent: 85, dueDate: addDays(start, 45) },
        last ? { label: 'On possession', percent: 5, stageId: last.id, daysAfterStage: 15 } : { label: 'On possession', percent: 5, dueDate: addDays(start, 540) }];
    return [{ label: 'Full payment', percent: 100, dueDate: start }];
}

function planRowsHtml(rows, d) {
    return rows.map((r, i) => `<div class="cn-row cn-plan" data-i="${i}">
        <input name="label" value="${esc(r.label || '')}" placeholder="What for" maxlength="100" data-plain>
        <input name="percent" type="number" class="num" step="any" min="0" value="${esc(r.percent ?? '')}" placeholder="%" data-plain>
        <input name="amount" type="number" class="num" step="any" min="0" value="${esc(r.amount ?? '')}" placeholder="or ₹" data-plain>
        <select name="when"><option value="date" ${r.stageId ? '' : 'selected'}>on a date</option>${d.stages.map(s =>
            `<option value="${s.id}" ${r.stageId === s.id ? 'selected' : ''}>after ${esc(s.name)}</option>`).join('')}</select>
        <span class="cn-due" ${r.stageId ? 'hidden' : ''}><input name="dueDate" type="date" value="${esc(r.dueDate || '')}"></span>
        <span class="cn-days" ${r.stageId ? '' : 'hidden'}><input name="days" type="number" class="num" min="0" value="${esc(r.daysAfterStage ?? 15)}" data-plain>days</span>
        <button type="button" class="btn xs ghost icon" data-del-plan title="Remove">${icon('x')}</button></div>`).join('');
}

function readPlan(root) {
    return [...root.querySelectorAll('[data-plan] .cn-plan')].map(r => {
        const when = r.querySelector('[name=when]').value;
        return { label: r.querySelector('[name=label]').value.trim(), percent: r.querySelector('[name=percent]').value === '' ? null : Number(r.querySelector('[name=percent]').value),
            amount: r.querySelector('[name=amount]').value === '' ? null : Number(r.querySelector('[name=amount]').value),
            dueDate: when === 'date' ? r.querySelector('[name=dueDate]').value || null : null, stageId: when === 'date' ? null : Number(when),
            daysAfterStage: when === 'date' ? null : Number(r.querySelector('[name=days]').value || 15) };
    }).filter(r => r.label);
}

function bindPlan(root, d, total) {
    const box = root.querySelector('[data-plan]');
    const sum = () => {
        const rows = readPlan(root);
        const t = total();
        const amt = rows.reduce((s, r) => s + (r.amount || (t * num(r.percent) / 100)), 0);
        root.querySelector('[data-plan-total]').innerHTML = `Plan adds up to <b class="${Math.abs(amt - t) > rows.length ? 'neg' : 'pos'}">${money(amt)}</b> of ${money(t)}`;
    };
    root.addEventListener('click', e => {
        const tpl = e.target.closest('[data-plan-template]');
        if (tpl) { box.innerHTML = planRowsHtml(template(tpl.dataset.planTemplate, d, root.querySelector('[name=bookedOn]').value || isoDate()), d); sum(); return; }
        if (e.target.closest('[data-add-plan]')) { box.insertAdjacentHTML('beforeend', planRowsHtml([{ label: '', percent: null, dueDate: '' }], d)); return; }
        const del = e.target.closest('[data-del-plan]');
        if (del) { del.closest('.cn-plan').remove(); sum(); }
    });
    root.addEventListener('change', e => {
        if (e.target.name === 'when') {
            const r = e.target.closest('.cn-plan');
            r.querySelector('.cn-due').hidden = e.target.value !== 'date';
            r.querySelector('.cn-days').hidden = e.target.value === 'date';
        }
        sum();
    });
    root.addEventListener('input', sum);
    sum();
}

/** Books a flat: the buyer, the price and the payment plan. sale: change an existing booking. */
export function openBook(d, unit, after, sale = null) {
    const p = d.project;
    const free = d.units.filter(u => u.status === 'AVAILABLE');
    const s = sale?.sale;
    const startPlan = sale ? sale.plan.map(i => ({ label: i.label, percent: i.percent, amount: i.percent == null ? i.amount : null, dueDate: i.dueDate, stageId: i.stageId,
        daysAfterStage: i.daysAfterStage })) : template('CLP', d, isoDate());
    const unitPrice = u => num(u?.price);
    openModal({
        title: sale ? `Sale of ${sale.unitLabel} · ${s.buyerName}` : `Book a flat${unit ? ` · ${unitLabel(unit)}` : ''}`, sub: p.name, iconName: 'tag', size: 'xl',
        body: `<form class="form-grid four" data-f onsubmit="return false">
            <label class="field"><span>Flat</span><select name="unitId" ${sale ? 'disabled' : ''}>${(sale ? d.units.filter(u => u.id === s.unitId) : free).map(u =>
                `<option value="${u.id}" ${u.id === (s?.unitId ?? unit?.id) ? 'selected' : ''} data-price="${num(u.price)}">${esc(unitLabel(u))}${u.unitType ? ` · ${esc(u.unitType)}` : ''}${u.price ? ` · ${money(u.price)}` : ''}</option>`).join('')}</select></label>
            <label class="field"><span>Booked on</span><input name="bookedOn" type="date" value="${esc(s?.bookedOn || isoDate())}"></label>
            <label class="field"><span>Price of the flat</span><input name="basePrice" type="number" class="num" step="any" min="0" value="${esc(s?.basePrice ?? unitPrice(unit || free[0]) ?? '')}" data-plain></label>
            <label class="field"><span>Other charges</span><input name="otherCharges" type="number" class="num" step="any" min="0" value="${esc(s?.otherCharges ?? '')}" data-plain></label>
            <label class="field span-2"><span>Other charges are for</span><input name="otherChargesNote" maxlength="200" value="${esc(s?.otherChargesNote || '')}" placeholder="car parking, amenities, corpus fund, GST…" data-plain></label>
            <label class="field"><span>Late interest <small class="muted">% a month</small></span><input name="lateInterestPercent" type="number" class="num" step="any" min="0" value="${esc(s?.lateInterestPercent ?? '')}" placeholder="${num(p.lateInterestPercent) || ''} (project)" data-plain></label>
            <p class="field muted small" data-total></p>
            <div class="section-title span-4">${icon('user')}Buyer</div>
            <label class="field"><span>Name</span><input name="buyerName" maxlength="100" value="${esc(s?.buyerName || '')}" required data-plain></label>
            <label class="field"><span>S/o, D/o or W/o</span><input name="buyerRelation" maxlength="100" value="${esc(s?.buyerRelation || '')}" data-plain></label>
            <label class="field"><span>Mobile</span><input name="buyerPhone" type="tel" maxlength="14" value="${esc(s?.buyerPhone || '')}" data-plain></label>
            <label class="field"><span>E-mail</span><input name="buyerEmail" type="email" maxlength="100" value="${esc(s?.buyerEmail || '')}" data-plain></label>
            <label class="field span-2"><span>Address</span><input name="buyerAddress" maxlength="200" value="${esc(s?.buyerAddress || '')}" data-plain></label>
            <label class="field"><span>PAN <small class="muted">kept masked</small></span><input name="buyerPan" maxlength="12" value="" placeholder="${esc(s?.buyerPan || '')}" data-plain></label>
            <label class="field"><span>Co-buyer</span><input name="coBuyerName" maxlength="100" value="${esc(s?.coBuyerName || '')}" data-plain></label>
        </form>
        <div class="section-title">${icon('calendar')}Payment plan
            <span class="grow"></span><span class="cn-tpls">${[['CLP', 'Construction-linked'], ['TIME', 'Time-linked'], ['DOWN', 'Down payment'], ['FULL', 'Full payment']]
                .map(([k, l]) => `<button type="button" class="btn xs ghost" data-plan-template="${k}">${l}</button>`).join('')}</span></div>
        <div class="cn-stage-head plan"><span>For</span><span>%</span><span>or ₹</span><span>Due</span><span></span><span></span></div>
        <div class="cn-rows" data-plan>${planRowsHtml(startPlan, d)}</div>
        <div class="row"><button type="button" class="btn sm ghost" data-add-plan>${icon('plus')}Add a line</button><span class="grow"></span><small data-plan-total></small></div>`,
        onOpen: m => {
            const f = m.el.querySelector('[data-f]');
            const total = () => num(f.basePrice.value) + num(f.otherCharges.value);
            const showTotal = () => { m.el.querySelector('[data-total]').innerHTML = `Total <b>${money(total())}</b>`; };
            f.unitId.addEventListener('change', () => { const price = num(f.unitId.selectedOptions[0]?.dataset.price); if (price) f.basePrice.value = price; showTotal(); });
            f.addEventListener('input', showTotal);
            showTotal();
            bindPlan(m.el, d, total);
        },
        actions: [{ label: 'Cancel' }, { label: sale ? 'Save' : 'Book the flat', kind: 'primary', iconName: 'check', onClick: async m => {
            const f = m.el.querySelector('[data-f]');
            const phone = f.buyerPhone.value.replace(/[\s-]/g, '');
            if (phone && !/^(\+?91)?[6-9]\d{9}$/.test(phone)) throw new Error('The buyer’s mobile should have 10 digits');
            const v = k => f[k].value.trim() || null;
            const body = { unitId: Number(f.unitId.value), buyerName: v('buyerName'), buyerRelation: v('buyerRelation'), buyerPhone: phone || null, buyerEmail: v('buyerEmail'),
                buyerAddress: v('buyerAddress'), buyerPan: v('buyerPan'), coBuyerName: v('coBuyerName'), bookedOn: v('bookedOn'), basePrice: num(f.basePrice.value),
                otherCharges: num(f.otherCharges.value) || null, otherChargesNote: v('otherChargesNote'),
                lateInterestPercent: f.lateInterestPercent.value === '' ? null : Number(f.lateInterestPercent.value), plan: readPlan(m.el) };
            if (!body.unitId) throw new Error('Pick the flat');
            if (!body.buyerName) throw new Error('Enter the buyer’s name');
            if (!body.plan.length) throw new Error('Add the payment plan');
            if (sale && !body.buyerPan) body.buyerPan = null;
            const out = sale ? await api.put(`/construction/${p.id}/sales/${s.id}`, body) : await api.post(`/construction/${p.id}/sales`, body);
            after(out, sale ? 'Sale saved' : `Flat booked for ${body.buyerName}`);
        } }],
    });
}

/** Everything about one sale. */
export async function openSale(d0, saleId, after) {
    let d = d0;
    const p = d.project;
    const st = { tab: 'dues', files: [] };
    const view = () => d.sales.find(x => x.sale.id === saleId);
    const loadFiles = async () => { st.files = await api.get(`/construction/${p.id}/sales/${saleId}/files`).catch(() => []); };
    await loadFiles();
    const refresh = (fresh, message, receipt) => {
        if (fresh) d = fresh;
        after(d, message);
        draw();
        if (receipt && confirmPrint) confirmPrint(receipt);
    };
    let confirmPrint = null;
    const v0 = view();
    const modal = openModal({
        title: `${v0.unitLabel} · ${v0.sale.buyerName}`, sub: p.name, iconName: 'building', size: 'xl cn-sale-modal',
        body: `<div class="cn-sale"><div data-head></div><div class="seg-chips sm" data-tabs>${[['dues', 'Payments due', 'calendar'], ['receipts', 'Receipts', 'receipt'],
            ['loan', 'Home loan', 'bank'], ['docs', 'Documents', 'paperclip'], ['agreements', 'Agreements', 'file-text']]
            .map(([k, l, i]) => `<button type="button" class="seg-chip ${k === st.tab ? 'active' : ''}" data-tab="${k}">${icon(i)}${l}</button>`).join('')}</div>
            <div class="cn-sale-body" data-body></div></div>`,
        actions: [{ label: 'Close', kind: 'primary' }],
    });
    const el = modal.el;
    confirmPrint = r => { if (r) printReceipt(d, r); };

    const head = () => {
        const v = view();
        const s = v.sale;
        const at = SALE_STEPS.findIndex(([k]) => k === s.status);
        return `<div class="cn-sale-head">
            <div class="cn-sale-figs"><span><small>Price</small><b>${money(s.totalPrice)}</b></span><span><small>Received</small><b class="pos">${money(v.received)}</b></span>
                <span><small>Still to pay</small><b>${money(v.balance)}</b></span><span><small>Due now</small><b class="${num(v.overdue) ? 'neg' : ''}">${money(v.due)}</b></span>
                ${num(v.interestDue) ? `<span><small>Late interest</small><b class="neg">${money(v.interestDue)}</b></span>` : ''}</div>
            ${s.status === 'CANCELLED' ? `<div class="cn-cancelled">${icon('x')}Cancelled${s.cancelNote ? ` · ${esc(s.cancelNote)}` : ''}</div>` : `<ol class="cn-saleflow">${SALE_STEPS.map(([k, l, ic], i) =>
                `<li class="${i < at ? 'done' : i === at ? 'on' : ''}"><span>${icon(i <= at ? (i < at ? 'check' : ic) : ic)}</span><b>${l}</b><small>${esc(stepNote(s, k))}</small></li>`).join('')}</ol>`}
            ${manage() && s.status !== 'CANCELLED' ? `<div class="row wrap cn-sale-acts">
                ${s.status !== 'CLOSED' ? `<button type="button" class="btn sm primary" data-act="receive">${icon('arrow-in')}Money received</button>` : ''}
                ${nextStep(s)}
                <span class="grow"></span>
                ${s.status !== 'CLOSED' ? `<button type="button" class="btn sm ghost" data-act="edit">${icon('edit')}Buyer & plan</button>` : ''}
                ${at > 0 ? `<button type="button" class="btn sm ghost" data-act="back" title="Undo the last step">${icon('undo')}Step back</button>` : ''}
                ${!s.registeredOn ? `<button type="button" class="btn sm ghost danger" data-act="cancel">${icon('x')}Cancel the sale</button>` : ''}</div>` : ''}
        </div>`;
    };
    const stepNote = (s, k) => ({ BOOKED: date(s.bookedOn), AGREED: s.agreementOn ? date(s.agreementOn) : '', REGISTERED: s.registeredOn ? `${date(s.registeredOn)}${s.deedNo ? ` · ${s.deedNo}` : ''}` : '',
        HANDED_OVER: s.handedOverOn ? date(s.handedOverOn) : '', CLOSED: s.closedAt ? date(String(s.closedAt).slice(0, 10)) : '' }[k] || '');
    const nextStep = s => ({ BOOKED: `<button type="button" class="btn sm" data-step="AGREED">${icon('file-text')}Agreement made</button>`,
        AGREED: `<button type="button" class="btn sm" data-step="REGISTERED">${icon('stamp')}Registered</button>`,
        REGISTERED: `<button type="button" class="btn sm" data-step="HANDED_OVER">${icon('key')}Handed over</button>`,
        HANDED_OVER: `<button type="button" class="btn sm" data-step="CLOSED">${icon('lock')}Close the sale</button>` }[s.status] || '');

    const tabs = {
        dues: () => {
            const v = view();
            return `<table class="grid dense cn-dues"><thead><tr><th>For</th><th>Due</th><th class="r">Amount</th><th class="r">Paid</th><th class="r">Balance</th><th class="r">Interest</th><th></th></tr></thead>
                <tbody>${v.dues.map(r => { const [tone, label] = DUE_TONE[r.status]; return `<tr><td>${esc(r.label)}</td>
                    <td>${r.dueDate ? date(r.dueDate) : '<span class="muted">on its stage</span>'}${r.daysLate ? ` <small class="neg">${r.daysLate}d late</small>` : ''}</td>
                    <td class="r">${money(r.amount)}</td><td class="r">${num(r.paid) ? money(r.paid) : ''}</td><td class="r"><b>${num(r.balance) ? money(r.balance) : ''}</b></td>
                    <td class="r">${num(r.interest) ? money(r.interest) : ''}</td><td><span class="badge ${tone}">${label}</span></td></tr>`; }).join('')}</tbody></table>
                <p class="muted small">${icon('info')}Money received goes to the oldest instalment first. Late interest: ${num(v.sale.lateInterestPercent ?? p.lateInterestPercent) || 0}% a month
                    ${num(p.lateGraceDays) ? `after ${p.lateGraceDays} days` : ''}; ${money(v.interestReceived)} of it received.</p>`;
        },
        receipts: () => {
            const list = d.receipts.filter(r => r.saleId === saleId);
            return list.length ? `<table class="grid dense"><thead><tr><th>Receipt</th><th>Date</th><th>From</th><th>Towards</th><th class="r">Amount</th><th></th></tr></thead><tbody>
                ${list.map(r => `<tr><td><b>${esc(r.receiptNo)}</b></td><td>${date(r.receivedOn)}</td><td>${r.payer === 'BANK' ? icon('bank') : icon('user')}${esc(r.payerName || '')}<small class="muted"> · ${esc(r.mode || '')}${r.reference ? ` ${esc(r.reference)}` : ''}</small></td>
                    <td>${esc(r.towards || '')}</td><td class="r"><b>${money(r.amount)}</b>${num(r.interestAmount) ? `<br><small class="muted">incl. ${money(r.interestAmount)} interest</small>` : ''}</td>
                    <td class="r nowrap"><button type="button" class="btn xs ghost icon" data-print="${r.id}" title="Print the receipt">${icon('printer')}</button>
                        ${manage() ? `<button type="button" class="btn xs ghost icon" data-del-receipt="${r.id}" title="Delete">${icon('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
                : '<p class="muted">No money received yet.</p>';
        },
        loan: () => {
            const s = view().sale;
            const loanDocs = st.files.filter(f => ['SANCTION_LETTER', 'DISBURSAL_LETTER'].includes(f.docType));
            const bank = d.receipts.filter(r => r.saleId === saleId && r.payer === 'BANK');
            return `<form class="form-grid three" data-loan onsubmit="return false">
                <label class="field"><span>Bank</span><input name="loanBank" maxlength="100" value="${esc(s.loanBank || '')}" placeholder="e.g. SBI" data-plain></label>
                <label class="field"><span>Branch</span><input name="loanBranch" maxlength="100" value="${esc(s.loanBranch || '')}" data-plain></label>
                <label class="field"><span>Status</span><select name="loanStatus">${LOAN_STATUS.map(([k, l]) => `<option value="${k}" ${s.loanStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="field"><span>Loan amount</span><input name="loanAmount" type="number" class="num" step="any" min="0" value="${esc(s.loanAmount ?? '')}" data-plain></label>
                <label class="field"><span>Loan account No.</span><input name="loanNo" maxlength="40" value="${esc(s.loanNo || '')}" data-plain></label>
                <label class="field"><span>Sanctioned on</span><input name="loanSanctionedOn" type="date" value="${esc(s.loanSanctionedOn || '')}"></label>
                ${manage() ? `<div class="span-3 row"><span class="muted small">Disbursed so far: <b>${money(bank.reduce((a, r) => a + num(r.amount), 0))}</b> in ${bank.length} payment${bank.length === 1 ? '' : 's'}</span><span class="grow"></span>
                    <button type="button" class="btn sm primary" data-act="save-loan">${icon('check')}Save</button></div>` : ''}
            </form>
            <div class="section-title">${icon('paperclip')}Letters from the bank</div>
            ${filesHtml(loanDocs, [['SANCTION_LETTER', 'Sanction letter'], ['DISBURSAL_LETTER', 'Disbursement letter']])}
            <p class="hint">Record each disbursement as money received from the buyer’s bank; make the tripartite agreement on the Agreements tab.</p>`;
        },
        docs: () => `${filesHtml(st.files, SALE_DOCS)}`,
        agreements: () => {
            const mine = d.agreements.filter(a => a.refId === saleId && ['FLAT_SALE', 'TRIPARTITE', 'SALE_DEED', 'POSSESSION'].includes(a.kind));
            return `<div class="cn-ag-list">${['FLAT_SALE', 'TRIPARTITE', 'SALE_DEED', 'POSSESSION'].map(k => {
                const a = mine.find(x => x.kind === k);
                const [name, , ic] = AGREEMENT_KINDS[k];
                return `<div class="cn-ag ${a ? (a.status === 'DRAFT' ? 'draft' : 'done') : ''}"><span class="chip-icon sm ${a && a.status !== 'DRAFT' ? 'teal' : 'gray'}">${icon(ic)}</span>
                    <div class="min-0 grow"><b>${esc(name)}</b><small>${a ? `${esc(a.agreementNo)} · ${a.status === 'DRAFT' ? 'waiting to be signed' : a.status === 'ACCEPTED' ? `accepted online ${dateTime(a.acceptedAt)}` : `signed on paper ${date(String(a.acceptedAt).slice(0, 10))}`}` : agreementHint(k)}</small></div>
                    ${a ? `<button type="button" class="btn sm ghost" data-ag="${a.id}">${icon('eye')}Open</button>` : manage() ? `<button type="button" class="btn sm" data-make="${k}">${icon('plus')}Make</button>` : ''}</div>`;
            }).join('')}</div>`;
        },
    };
    const agreementHint = k => ({ FLAT_SALE: 'the agreement for sale: price, plan, possession and RERA terms', TRIPARTITE: 'with the buyer’s bank, for the home loan',
        SALE_DEED: 'the conveyance, drafted for registration', POSSESSION: 'the handover of the flat and its keys' }[k]);
    const filesHtml = (list, types) => `<div class="cg-files">${list.length ? list.map(f => `<span class="cg-file"><a href="#" data-open-file="${f.id}">${icon(f.pdf ? 'file-text' : 'camera')}${esc(f.caption || f.fileName)}</a>
            <small>${dateTime(f.createdAt)}</small>${manage() ? `<button type="button" class="btn xs ghost icon" data-del-file="${f.id}" title="Remove">${icon('trash')}</button>` : ''}</span>`).join('') : '<span class="muted small">None yet</span>'}</div>
        ${manage() ? `<div class="row wrap cn-upload"><select data-doc-type>${types.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
            <label class="btn sm">${icon('upload')}Add a file<input type="file" accept="image/*,application/pdf" data-upload hidden></label></div>` : ''}`;

    function draw() {
        el.querySelector('[data-head]').innerHTML = head();
        el.querySelector('[data-body]').innerHTML = tabs[st.tab]();
    }
    draw();
    el.querySelector('[data-tabs]').addEventListener('click', e => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        st.tab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
        draw();
    });
    el.addEventListener('change', async e => {
        const input = e.target.closest('[data-upload]');
        if (!input?.files?.[0]) return;
        try {
            const form = new FormData();
            form.append('file', input.files[0], input.files[0].name);
            form.append('docType', el.querySelector('[data-doc-type]').value);
            st.files = await api.upload(`/construction/${p.id}/sales/${saleId}/files`, form);
            toast('File added');
            draw();
        } catch (err) { toast(err.message, 'error'); }
    });
    el.addEventListener('click', async e => {
        const b = e.target.closest('[data-act], [data-step], [data-print], [data-del-receipt], [data-open-file], [data-del-file], [data-ag], [data-make]');
        if (!b) return;
        try {
            const s = view().sale;
            if (b.dataset.print) { printReceipt(d, d.receipts.find(r => r.id === Number(b.dataset.print))); return; }
            if (b.dataset.openFile) {
                e.preventDefault();
                window.open(URL.createObjectURL(await api.blob(`/construction/${p.id}/sales/${saleId}/files/${b.dataset.openFile}`)), '_blank', 'noopener');
                return;
            }
            if (b.dataset.delFile) {
                if (!await confirmDialog('Remove this file?', { confirmLabel: 'Remove' })) return;
                st.files = await api.del(`/construction/${p.id}/sales/${saleId}/files/${b.dataset.delFile}`);
                draw();
                return;
            }
            if (b.dataset.delReceipt) {
                const r = d.receipts.find(x => x.id === Number(b.dataset.delReceipt));
                if (!await confirmDialog(`Delete the receipt ${r.receiptNo} for ${money(r.amount)}? Its entry in the books goes with it.`, { confirmLabel: 'Delete' })) return;
                refresh(await api.del(`/construction/${p.id}/receipts/${r.id}`), 'Receipt deleted');
                return;
            }
            if (b.dataset.ag) { openProjectAgreement(p, { id: Number(b.dataset.ag) }, async () => refresh(await api.get(`/construction/${p.id}`))); return; }
            if (b.dataset.make) {
                openProjectAgreement(p, { kind: b.dataset.make, refId: saleId, defaults: { partyName: s.buyerName, partyPhone: s.buyerPhone, partyAddress: s.buyerAddress,
                    partyRelation: s.buyerRelation } }, async () => refresh(await api.get(`/construction/${p.id}`)));
                return;
            }
            if (b.dataset.step) { stepDialog(b.dataset.step); return; }
            switch (b.dataset.act) {
                case 'receive': openReceipt(d, { saleId }, (fresh, message, receipt) => refresh(fresh, message, receipt)); break;
                case 'edit': openBook(d, null, (fresh, message) => refresh(fresh, message), view()); break;
                case 'back': {
                    const at = SALE_STEPS.findIndex(([k]) => k === s.status);
                    const to = SALE_STEPS[at - 1][0];
                    if (!await confirmDialog(`Take the sale back to “${SALE_STEPS[at - 1][1]}”?`, { confirmLabel: 'Step back', danger: false })) return;
                    const on = { AGREED: s.agreementOn, REGISTERED: s.registeredOn, HANDED_OVER: s.handedOverOn }[to] || s.bookedOn;
                    refresh(await api.post(`/construction/${p.id}/sales/${saleId}/step`, { status: to, on, deedNo: s.deedNo, subRegistrar: s.subRegistrar }), 'Done');
                    break;
                }
                case 'cancel':
                    openModal({
                        title: `Cancel the sale of ${view().unitLabel}`, sub: s.buyerName, iconName: 'x',
                        body: `<p>The flat becomes available again. Money received stays recorded: refund the buyer and record it as a cost or a transfer, as agreed.</p>
                            <label class="field"><span>Why</span><input name="note" maxlength="200" data-plain></label>`,
                        actions: [{ label: 'Keep the sale' }, { label: 'Cancel the sale', kind: 'danger solid', onClick: async m => {
                            refresh(await api.post(`/construction/${p.id}/sales/${saleId}/step`, { status: 'CANCELLED', note: m.el.querySelector('[name=note]').value.trim() || null }), 'Sale cancelled');
                        } }],
                    });
                    break;
                case 'save-loan': {
                    const f = el.querySelector('[data-loan]');
                    refresh(await api.put(`/construction/${p.id}/sales/${saleId}/loan`, { loanBank: f.loanBank.value.trim() || null, loanBranch: f.loanBranch.value.trim() || null,
                        loanAmount: f.loanAmount.value === '' ? null : Number(f.loanAmount.value), loanNo: f.loanNo.value.trim() || null,
                        loanSanctionedOn: f.loanSanctionedOn.value || null, loanStatus: f.loanStatus.value }), 'Home loan saved');
                    break;
                }
                default:
            }
        } catch (err) { toast(err.message, 'error'); }
    });

    function stepDialog(to) {
        const s = view().sale;
        const label = SALE_STEPS.find(([k]) => k === to)[1];
        openModal({
            title: `${view().unitLabel} · ${label}`, sub: s.buyerName, iconName: SALE_STEPS.find(([k]) => k === to)[2],
            body: `<form class="form-grid two" data-f onsubmit="return false">
                <label class="field"><span>On</span><input name="on" type="date" value="${isoDate()}"></label>
                ${to === 'REGISTERED' ? `<label class="field"><span>Sale deed document No.</span><input name="deedNo" maxlength="40" required data-plain></label>
                    <label class="field span-2"><span>Sub-Registrar office</span><input name="subRegistrar" maxlength="100" data-plain></label>` : ''}
                ${to === 'HANDED_OVER' ? `<label class="field span-2"><span>Note <small class="muted">keys, meter readings, snags</small></span><input name="note" maxlength="300" data-plain></label>` : ''}
            </form>
            ${to === 'CLOSED' ? `<p class="hint">Closing needs the full price received (${money(view().balance)} still to pay).</p>` : ''}
            ${to === 'REGISTERED' ? '<p class="hint">Add the registered deed on the Documents tab.</p>' : ''}`,
            actions: [{ label: 'Cancel' }, { label, kind: 'primary', iconName: 'check', onClick: async m => {
                const f = m.el.querySelector('[data-f]');
                refresh(await api.post(`/construction/${p.id}/sales/${saleId}/step`, { status: to, on: f.on.value || null, deedNo: f.deedNo?.value.trim() || null,
                    subRegistrar: f.subRegistrar?.value.trim() || null, note: f.note?.value.trim() || null }), label);
            } }],
        });
    }
}
