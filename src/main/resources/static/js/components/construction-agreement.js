/**
 * An agreement of a construction project (the construction contract, a supplementary agreement for extra work, the
 * plot purchase, the joint development agreement, a flat's agreement for sale, the tripartite agreement with the
 * buyer's bank, the sale deed, the possession certificate, a partner's agreement), from the Construction page.
 *
 * Left: the link the other party accepts it on (their mobile number opens it; they add their Aadhaar and a live selfie
 * and sign), the stamp paper, the company's signature and seal, two witnesses, the other party's signature taken in
 * person and the thumb-impression boxes, their ID proof, the signed copy, and the evidence of the online acceptance.
 * Right: the deed as it prints (stamp-paper style or for real stamp paper); Print view lays it out on A4.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { date, dateTime, isoDate } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { bondHtml, printBond, padHtml, bindPad, signatureSvg, evidenceRows, verifyEvidence } from '../core/bond.js';
import { kycTilesHtml, bindKycTiles, fileUrls, kycAnnexures, DOC_LABELS } from './agreement-ui.js';

const STATUS = { DRAFT: ['warning', 'clock', 'Waiting to be signed'], ACCEPTED: ['good', 'check-circle', 'Accepted online'], SIGNED: ['good', 'signature', 'Signed on paper'] };
const LINK = { NONE: ['gray', 'No link yet'], ACTIVE: ['good', 'Link active'], EXPIRED: ['gray', 'Link expired'], REVOKED: ['gray', 'Link stopped'], LOCKED: ['critical', 'Link locked'] };
const DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
/** What each kind is called, and who signs it on the other side. */
export const AGREEMENT_KINDS = {
    CONTRACT: ['Construction agreement', 'the owner', 'file-text'],
    EXTRA: ['Supplementary agreement (extra work)', 'the owner', 'plus'],
    PLOT_PURCHASE: ['Agreement of sale (plot purchase)', 'the seller', 'home'],
    JDA: ['Joint development agreement', 'the landowner', 'layers'],
    FLAT_SALE: ['Agreement for sale (flat)', 'the buyer', 'building'],
    TRIPARTITE: ['Tripartite agreement (buyer, bank, us)', 'the buyer', 'bank'],
    SALE_DEED: ['Sale deed (for registration)', 'the buyer', 'stamp'],
    POSSESSION: ['Possession certificate', 'the buyer', 'key'],
    PARTNERSHIP: ['Partner\'s agreement', 'the partner', 'users'],
};
const manage = () => can('MANAGE_PROJECTS');
const num = v => Number(v || 0);
const phoneOk = v => !v || /^(\+?91)?[6-9]\d{9}$/.test(v);

/**
 * Opens an agreement: an existing one by id, or the one of this kind (and subject) if made, or the form to make it.
 * defaults: what the form starts with (party name, phone...) when it is new.
 */
export async function openProjectAgreement(project, { id = null, kind, refId = null, defaults = {} }, onChanged) {
    const base = `/construction/${project.id}/agreements`;
    if (id) { openDeed(project, await api.get(`${base}/${id}`), onChanged); return; }
    openSetup(project, kind, refId, null, defaults, onChanged);
}

function setupHtml(project, kind, a, d) {
    const v = (k, def = '') => esc(a?.[k] ?? d[k] ?? def);
    const who = AGREEMENT_KINDS[kind]?.[1] || 'the other party';
    return `<form class="form-grid two la-form" data-cg-form onsubmit="return false">
        <div class="section-title span-2">${icon('user')}The other party · ${esc(who)}</div>
        <label class="field"><span>Name <small class="muted">as on their Aadhaar</small></span><input name="partyName" maxlength="100" value="${v('partyName')}" placeholder="from the project" data-plain></label>
        <label class="field"><span>S/o, D/o or W/o</span><input name="partyRelation" maxlength="100" value="${v('partyRelation')}" placeholder="e.g. S/o Venkat Rao" data-plain></label>
        <label class="field"><span>Mobile <small class="muted">they type it to open the link</small></span><input name="partyPhone" type="tel" maxlength="14" inputmode="numeric" value="${v('partyPhone')}" placeholder="10 digits" data-plain></label>
        <label class="field"><span>Address</span><input name="partyAddress" maxlength="200" value="${v('partyAddress')}" data-plain></label>
        <div class="section-title span-2">${icon('stamp')}Where, when, the stamp paper and the witnesses</div>
        <label class="field"><span>Place</span><input name="place" maxlength="60" value="${v('place', project.city || '')}" placeholder="e.g. Hyderabad" data-plain></label>
        <label class="field"><span>Date</span><input name="agreementDate" type="date" value="${v('agreementDate', isoDate())}"></label>
        <label class="field"><span>Stamp paper value</span><input name="stampDuty" type="number" class="num" min="0" step="10" value="${a ? num(a.stampDuty) || '' : 100}" data-plain></label>
        <label class="field"><span>Stamp paper serial no. <small class="muted">optional</small></span><input name="stampSerial" maxlength="40" value="${v('stampSerial')}" data-plain></label>
        <label class="field"><span>Witness 1</span><input name="witnessName" maxlength="100" value="${v('witnessName')}" data-plain></label>
        <label class="field"><span>Witness 1 mobile</span><input name="witnessPhone" type="tel" maxlength="14" value="${v('witnessPhone')}" data-plain></label>
        <label class="field span-2"><span>Witness 1 address</span><input name="witnessAddress" maxlength="150" value="${v('witnessAddress')}" data-plain></label>
        <label class="field"><span>Witness 2</span><input name="witness2Name" maxlength="100" value="${v('witness2Name')}" data-plain></label>
        <label class="field"><span>Witness 2 address</span><input name="witness2Address" maxlength="150" value="${v('witness2Address')}" data-plain></label>
        <div class="section-title span-2">${icon('shield')}Signing</div>
        <div class="span-2 la-req">
            <label class="check-line"><input type="checkbox" name="thumbBoxes" ${a ? (a.thumbBoxes ? 'checked' : '') : 'checked'}> Boxes for both parties' thumb impressions on the paper copy</label>
            <label class="check-line"><input type="checkbox" name="requireAadhaar" ${a ? (a.requireAadhaar ? 'checked' : '') : 'checked'}> Online: Aadhaar card photo and number <small class="muted">(checked; only the last 4 digits kept)</small></label>
            <label class="check-line"><input type="checkbox" name="requireSelfie" ${a ? (a.requireSelfie ? 'checked' : '') : 'checked'}> Online: a live selfie from the phone's camera</label>
            <label class="check-line"><input type="checkbox" name="requireLocation" ${a?.requireLocation ? 'checked' : ''}> Online: their location when accepting</label>
        </div>
        <label class="field span-2"><span>Additional terms <small class="muted">optional, one per line; they become numbered clauses</small></span>
            <textarea name="extraTerms" rows="3" maxlength="2000" placeholder="e.g. Tiles of the owner's choice up to ₹60 a sq ft" data-plain>${esc(a?.extraTerms || '')}</textarea></label>
    </form>`;
}

function readSetup(form, kind, refId) {
    const clean = v => v.replace(/[\s-]/g, '');
    const phone = clean(form.partyPhone.value), wPhone = clean(form.witnessPhone.value);
    if (!phoneOk(phone)) throw new Error('The mobile number should have 10 digits');
    if (!phoneOk(wPhone)) throw new Error('The witness’s mobile should have 10 digits');
    const t = n => form[n].value.trim() || null;
    return {
        kind, refId, partyName: t('partyName'), partyRelation: t('partyRelation'), partyPhone: phone || null, partyAddress: t('partyAddress'),
        place: t('place'), agreementDate: form.agreementDate.value || null, stampDuty: Number(form.stampDuty.value || 0), stampSerial: t('stampSerial'),
        witnessName: t('witnessName'), witnessPhone: wPhone || null, witnessAddress: t('witnessAddress'), witness2Name: t('witness2Name'),
        witness2Address: t('witness2Address'), thumbBoxes: form.thumbBoxes.checked, requireAadhaar: form.requireAadhaar.checked,
        requireSelfie: form.requireSelfie.checked, requireLocation: form.requireLocation.checked, extraTerms: t('extraTerms'),
    };
}

function openSetup(project, kind, refId, a, defaults, onChanged) {
    const [name] = AGREEMENT_KINDS[kind] || [kind];
    openModal({
        title: a ? `Update ${a.agreementNo}` : name, sub: project.name, iconName: AGREEMENT_KINDS[kind]?.[2] || 'file-text', size: 'lg',
        body: `<p class="hint" style="margin:0 0 10px">The wording, the recitals and the particulars (price, schedule, property) are made from the project,
            in the form of an Indian deed, and fixed by a fingerprint. Until it is signed you can make it again after changing the project.
            The other party can accept it online on a secret link, or it is printed on stamp paper and signed with thumb impressions before two witnesses.</p>
            ${setupHtml(project, kind, a, defaults)}`,
        actions: [
            { label: 'Cancel' },
            { label: a ? 'Make it again' : 'Make the agreement', kind: 'primary', iconName: 'check', onClick: async modal => {
                const saved = await api.post(`/construction/${project.id}/agreements`, readSetup(modal.el.querySelector('[data-cg-form]'), kind, refId));
                toast(a ? 'Agreement updated' : `Agreement ${saved.agreementNo} made`);
                onChanged?.();
                setTimeout(() => openDeed(project, saved, onChanged), 0);
            } },
        ],
    });
}

/** The agreement as a deed (see bondHtml in core/bond.js). */
export function deedOf(a, urls = {}, real = false, verified = null) {
    const accepted = a.status === 'ACCEPTED' ? `accepted online ${dateTime(a.acceptedAt)}` : a.status === 'SIGNED' ? `signed on paper ${date(String(a.acceptedAt).slice(0, 10))}` : '';
    const ev = a.status === 'ACCEPTED' ? [{ title: 'Evidence of the online acceptance', rows: evidenceRows({
        name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: true, aadhaarLast4: a.aadhaarLast4, ip: a.acceptedIp,
        device: a.acceptedDevice, userAgent: a.acceptedUserAgent, location: a.acceptedLocation, deviceHash: a.deviceHash, seal: a.acceptanceSeal,
        digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified }) }] : [];
    return {
        kind: 'CONSTRUCTION', title: a.title, number: a.agreementNo, date: a.agreementDate, place: a.place,
        stampDuty: a.stampDuty, stampSerial: a.stampSerial, realStampPaper: real, thumbBoxes: a.thumbBoxes, twoWitnesses: true,
        firstParty: { role: a.firstRole, term: a.firstRole, name: a.companyName, company: true,
            relation: `represented by its ${a.signerDesignation || 'authorised signatory'} ${a.signerName || ''}`.trim(),
            address: a.companyAddress, signature: a.companySignature, seal: a.companyName },
        secondParty: { role: a.secondRole, term: a.secondRole, name: a.status !== 'DRAFT' && a.acceptedName ? a.acceptedName : a.partyName,
            relation: a.partyRelation, address: a.partyAddress, phone: a.partyPhone, signature: a.signature || a.partyInkSignature, accepted },
        thirdParty: a.thirdName ? { role: 'Bank', term: 'Bank', name: a.thirdName, address: a.thirdAddress, company: true } : null,
        witness: { name: a.witnessName, phone: a.witnessPhone, address: a.witnessAddress, signature: a.witnessSignature },
        witness2: { name: a.witness2Name, address: a.witness2Address, signature: a.witness2Signature },
        recitals: a.recitals, particulars: a.particulars, terms: a.terms, fingerprint: a.contentHash,
        annexures: [...kycAnnexures((a.files || []).filter(f => ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'SELFIE'].includes(f.docType)), urls,
            { who: a.partyName, aadhaarLast4: a.aadhaarLast4, mark: `${a.title} ${a.agreementNo}` }), ...ev],
        footnote: a.digitalSignature ? `Digitally signed evidence · key ${a.keyFingerprint}${verified ? ' · verified' : ''}` : '',
    };
}

async function openDeed(project, first, onChanged) {
    const base = `/construction/${project.id}/agreements/${first.id}`;
    const st = { a: first, tab: first.status === 'DRAFT' ? 'link' : 'evidence', real: false, urls: {}, verified: null, changed: false };
    const fetchBlob = (f, thumb) => api.blob(`${base}/files/${f.id}`, thumb ? { thumb: true } : {});
    st.urls = await fileUrls(first.files || [], fetchBlob);
    st.verified = await verifyEvidence(first.evidencePayload, first.digitalSignature, first.publicKey);
    const draft = () => st.a.status === 'DRAFT';
    let pads = {};
    const sig = (path, label, act, editable = manage()) => `<div class="span-2 ag-sig"><div class="ag-sig-now">${path ? signatureSvg(path) : '<span class="muted small">Not signed yet</span>'}<small>${esc(label)}</small></div>
        ${editable ? `<div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-cg="draw-${act}">${icon('edit')}Sign on this device</button>
            ${path ? `<button type="button" class="btn sm ghost" data-cg="clear-${act}">${icon('x')}Remove</button>` : ''}</div>` : ''}
        <div data-pad-${act} hidden>${padHtml(act, `${label}: sign here`)}</div></div>`;

    const panels = {
        link: () => {
            const a = st.a;
            const [tone, label] = LINK[a.linkStatus] || LINK.NONE;
            const need = [a.requireAadhaar ? 'Aadhaar' : null, a.requireSelfie ? 'a live selfie' : null, a.requireLocation ? 'their location' : null].filter(Boolean);
            return `<div class="la-panel">
                <div class="la-linkcard"><span class="badge ${tone}">${icon('link')}${label}</span>
                    ${a.linkExpiresAt && a.linkStatus === 'ACTIVE' ? `<small>until ${dateTime(a.linkExpiresAt)}</small>` : ''}
                    <small>opened ${a.views}×${a.lastViewedAt ? `, last ${dateTime(a.lastViewedAt)}` : ''}</small>
                    ${a.failedAttempts ? `<small class="${a.lockedAt ? 'neg' : 'warn-text'}">${a.failedAttempts} wrong number${a.failedAttempts === 1 ? '' : 's'} typed${a.lockedAt ? ' · locked' : ''}</small>` : ''}</div>
                <ul class="la-steps">
                    <li>${icon('phone')}<span>${esc(a.partyName)} opens the link and types <b>${a.partyPhone ? `the mobile ending ${esc(a.partyPhone.slice(-4))}` : 'their mobile number (add it in Details first)'}</b>; nothing is shown before. Five wrong numbers lock it.</span></li>
                    <li>${icon('id-card')}<span>They read the deed, add ${need.length ? need.join(', ') : 'nothing more'}, and sign with their finger.</span></li>
                    <li>${icon('shield')}<span>The time, IP address, device${a.requireLocation ? ', location' : ''} and every photo's fingerprint are sealed and digitally signed.</span></li>
                </ul>
                ${draft() && manage() ? `<div class="la-make"><span>Valid for</span><div class="ln-chips" data-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div>
                    <button type="button" class="btn primary sm" data-cg="link" ${a.partyPhone ? '' : 'disabled'}>${icon('send')}${a.linkStatus === 'NONE' ? 'Make the link' : 'Make a new link'}</button>
                    ${a.linkStatus === 'ACTIVE' ? `<button type="button" class="btn sm ghost" data-cg="revoke">${icon('lock')}Stop the link</button>` : ''}</div>` : ''}
                <div data-cg-result></div>
            </div>`;
        },
        paper: () => {
            const a = st.a;
            const others = (a.files || []).filter(f => !['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'SELFIE'].includes(f.docType) && !f.derivedFromSha);
            return `<form class="form-grid two la-panel" data-paper onsubmit="return false">
                <label class="field"><span>Stamp paper value</span><input type="number" name="stampDuty" class="num" min="0" step="10" value="${num(a.stampDuty) || ''}" data-plain></label>
                <label class="field"><span>Serial no.</span><input type="text" name="stampSerial" maxlength="40" value="${esc(a.stampSerial || '')}" data-plain></label>
                ${sig(a.companySignature, `${a.companyName || 'Company'} (${a.signerName || 'signatory'})`, 'company')}
                <label class="field"><span>Witness 1</span><input name="witnessName" maxlength="100" value="${esc(a.witnessName || '')}" data-plain></label>
                <label class="field"><span>Witness 1 mobile</span><input name="witnessPhone" type="tel" maxlength="14" value="${esc(a.witnessPhone || '')}" data-plain></label>
                <label class="field span-2"><span>Witness 1 address</span><input name="witnessAddress" maxlength="150" value="${esc(a.witnessAddress || '')}" data-plain></label>
                ${sig(a.witnessSignature, 'Witness 1', 'witness')}
                <label class="field"><span>Witness 2</span><input name="witness2Name" maxlength="100" value="${esc(a.witness2Name || '')}" data-plain></label>
                <label class="field"><span>Witness 2 address</span><input name="witness2Address" maxlength="150" value="${esc(a.witness2Address || '')}" data-plain></label>
                ${sig(a.witness2Signature, 'Witness 2', 'witness2')}
                ${a.status === 'ACCEPTED' ? `<p class="span-2 muted small">${icon('check-circle')}${esc(a.acceptedName)} signed online; that signature is on the deed.</p>`
                    : sig(a.partyInkSignature, `${a.partyName} (in person)`, 'party')}
                <label class="check-line span-2"><input type="checkbox" name="thumbBoxes" ${a.thumbBoxes ? 'checked' : ''}> Boxes for both parties' left thumb impressions</label>
                ${manage() ? `<div class="span-2 row"><span class="grow"></span><button type="button" class="btn primary sm" data-cg="save-paper">${icon('check')}Save</button></div>` : ''}
                <div class="section-title span-2">${icon('paperclip')}The signed copy <small class="muted">scan or photo of the signed stamp paper</small></div>
                <div class="span-2 cg-files">${others.length ? others.map(f => `<span class="cg-file"><a href="#" data-cg-open="${f.id}">${icon(f.pdf ? 'file-text' : 'camera')}${esc(f.caption || f.fileName)}</a>
                    <small>${dateTime(f.createdAt)}</small>${manage() ? `<button type="button" class="btn xs ghost icon" data-cg-del="${f.id}" title="Remove">${icon('trash')}</button>` : ''}</span>`).join('') : '<span class="muted small">None yet</span>'}
                    ${manage() ? `<label class="btn sm ghost">${icon('upload')}Add the signed copy<input type="file" accept="image/*,application/pdf" data-cg-signed hidden></label>` : ''}</div>
            </form>`;
        },
        kyc: () => {
            const a = st.a;
            return `<div class="la-panel">
                <p class="muted small" style="margin:0">${icon('shield')}${draft() ? `${esc(a.partyName)} adds these on the link; you can add them here too (a photo, a PDF or the camera).` : 'Part of the signed record.'}
                    ${a.aadhaarLast4 ? ` Aadhaar on record: XXXX XXXX ${esc(a.aadhaarLast4)}.` : ''}</p>
                ${kycTilesHtml(a.files || [], { need: new Set([...(a.requireAadhaar ? ['AADHAAR_FRONT'] : []), ...(a.requireSelfie ? ['SELFIE'] : [])]), urls: st.urls, editable: manage() && draft() })}
            </div>`;
        },
        evidence: () => {
            const a = st.a;
            if (a.status === 'DRAFT') return `<div class="la-panel"><p class="muted">Not signed yet. The evidence shows here once ${esc(a.partyName)} accepts online, or once you record the paper signing.</p></div>`;
            if (a.status === 'SIGNED') return `<div class="la-panel"><p>${icon('signature')}Signed on paper by <b>${esc(a.acceptedName)}</b> on ${date(String(a.acceptedAt).slice(0, 10))} · ${esc(a.acceptedUserAgent || '')}</p></div>`;
            return `<div class="la-panel">
                <div class="cs-sig-status ${st.verified === false ? 'bad' : st.verified ? 'ok' : 'wait'}"><b>${st.verified ? '✓ Digital signature verified' : st.verified === false ? '✗ The signature does not match' : 'The signature could not be checked here'}</b>
                    <small>ECDSA P-256 · key ${esc(a.keyFingerprint)}</small></div>
                <table class="bond-facts ev"><tbody>${evidenceRows({ name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: true,
                    aadhaarLast4: a.aadhaarLast4, ip: a.acceptedIp, device: a.acceptedDevice, userAgent: a.acceptedUserAgent, location: a.acceptedLocation,
                    deviceHash: a.deviceHash, seal: a.acceptanceSeal, digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified: st.verified })
                    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
            </div>`;
        },
    };
    const [tone, ic, label] = STATUS[first.status] || ['gray', 'info', first.status];
    const modal = openModal({
        title: `${first.title} · ${first.agreementNo}`, sub: `${project.name} · ${first.partyName}`, iconName: AGREEMENT_KINDS[first.kind]?.[2] || 'file-text', size: 'xl hc-ag-modal',
        body: `<div class="ag-layout">
            <div class="ag-side">
                <div class="ag-status"><span class="badge ${tone}">${icon(ic)}${label}</span><small class="muted">${esc(first.agreementNo)} · made ${dateTime(first.createdAt)}</small>
                    ${first.status === 'DRAFT' && manage() ? `<span class="grow"></span><button type="button" class="btn sm ghost" data-cg="details">${icon('edit')}Details</button>` : ''}</div>
                <div class="seg-chips sm" data-tabs>${[['link', 'Link', 'link'], ['paper', 'Stamp paper & signatures', 'signature'], ['kyc', 'ID proof', 'id-card'], ['evidence', 'Evidence', 'shield']]
                    .map(([k, l, i]) => `<button type="button" class="seg-chip ${k === st.tab ? 'active' : ''}" data-tab="${k}">${icon(i)}${l}</button>`).join('')}</div>
                <div data-panel></div>
            </div>
            <div class="ag-paper">
                <div class="ag-paper-tools"><div class="seg-chips sm" data-style>
                    <button type="button" class="seg-chip active" data-real="0">${icon('stamp')}Stamp-paper style</button>
                    <button type="button" class="seg-chip" data-real="1" title="Leaves the top of the first page blank, to print on real non-judicial stamp paper">${icon('printer')}For real stamp paper</button></div></div>
                <div class="bond-preview" data-bond></div>
            </div>
        </div>`,
        actions: [
            { label: 'Print view', left: true, iconName: 'printer', onClick: () => { printBond(deedOf(st.a, st.urls, st.real, st.verified), `${st.a.title} ${st.a.agreementNo}`); return true; } },
            ...(first.status === 'DRAFT' && manage() ? [
                { label: 'Delete', iconName: 'trash', onClick: async () => {
                    if (!await confirmDialog(`Delete ${st.a.agreementNo}? The link stops working and its files are removed.`, { confirmLabel: 'Delete' })) return true;
                    await api.del(base);
                    toast('Agreement deleted');
                    onChanged?.();
                } },
                { label: 'Signed on paper', iconName: 'signature', onClick: async () => {
                    if (!await confirmDialog(`Record that ${st.a.partyName} signed the printed agreement${st.a.witnessName ? ` before ${st.a.witnessName}` : ''}? The link stops working.`,
                        { title: 'Signed on paper', confirmLabel: 'Record the signing', danger: false })) return true;
                    await api.post(`${base}/signed`, { name: st.a.partyName, on: isoDate() });
                    toast('Signing recorded');
                    onChanged?.();
                } },
            ] : []),
            { label: 'Close', kind: 'primary', onClick: () => { if (st.changed) onChanged?.(); } },
        ],
    });
    const el = modal.el;
    const drawBond = () => { el.querySelector('[data-bond]').innerHTML = bondHtml(deedOf(st.a, st.urls, st.real, st.verified)); };
    const drawPanel = () => {
        el.querySelector('[data-panel]').innerHTML = panels[st.tab]();
        pads = Object.fromEntries(['company', 'witness', 'witness2', 'party'].map(k => [k, bindPad(el, k)]));
    };
    const refresh = async (fresh, message) => {
        st.a = fresh;
        st.changed = true;
        st.urls = await fileUrls(fresh.files || [], fetchBlob);
        drawPanel();
        drawBond();
        if (message) toast(message);
    };
    drawPanel();
    drawBond();
    el.querySelector('[data-close]')?.addEventListener('click', () => { if (st.changed) onChanged?.(); });
    el.querySelector('[data-tabs]').addEventListener('click', e => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        st.tab = b.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
        drawPanel();
    });
    el.querySelector('[data-style]').addEventListener('click', e => {
        const b = e.target.closest('[data-real]');
        if (!b) return;
        st.real = b.dataset.real === '1';
        el.querySelectorAll('[data-real]').forEach(x => x.classList.toggle('active', x === b));
        drawBond();
    });
    const panel = el.querySelector('[data-panel]');
    const upload = async (type, blob, name, source) => {
        const form = new FormData();
        form.append('file', blob, name);
        form.append('docType', type);
        if (source) form.append('source', source);
        await refresh(await api.upload(`${base}/files`, form), `${DOC_LABELS[type]?.[0] || 'File'} added`);
    };
    bindKycTiles(panel, {
        label: `${st.a.agreementNo} · ${st.a.partyName}`,
        upload,
        remove: async id => {
            if (!await confirmDialog('Remove this file from the agreement?', { confirmLabel: 'Remove' })) return;
            await refresh(await api.del(`${base}/files/${id}`), 'File removed');
        },
    });
    panel.addEventListener('change', async e => {
        const input = e.target.closest('[data-cg-signed]');
        if (!input?.files?.[0]) return;
        try { await upload('SIGNED_COPY', input.files[0], input.files[0].name, 'UPLOAD'); } catch (err) { toast(err.message, 'error'); }
    });
    panel.addEventListener('click', async e => {
        const chip = e.target.closest('[data-hours] [data-value]');
        if (chip) { panel.querySelectorAll('[data-hours] [data-value]').forEach(x => x.classList.toggle('selected', x === chip)); return; }
        const open = e.target.closest('[data-cg-open]');
        if (open) {
            e.preventDefault();
            const blob = await api.blob(`${base}/files/${open.dataset.cgOpen}`);
            window.open(URL.createObjectURL(blob), '_blank', 'noopener');
            return;
        }
        const del = e.target.closest('[data-cg-del]');
        if (del) {
            if (!await confirmDialog('Remove this file?', { confirmLabel: 'Remove' })) return;
            try { await refresh(await api.del(`${base}/files/${del.dataset.cgDel}`), 'File removed'); } catch (err) { toast(err.message, 'error'); }
            return;
        }
        const b = e.target.closest('[data-cg]');
        if (!b) return;
        try {
            const act = b.dataset.cg;
            const m = /^(draw|clear)-(\w+)$/.exec(act);
            if (m && m[1] === 'draw') { panel.querySelector(`[data-pad-${m[2]}]`).hidden = false; return; }
            if (m && m[1] === 'clear') {
                const key = { company: 'clearCompanySignature', witness: 'clearWitnessSignature', witness2: 'clearWitness2Signature', party: 'clearPartyInkSignature' }[m[2]];
                await refresh(await api.put(`${base}/paper`, { [key]: true }), 'Signature removed');
                return;
            }
            if (act === 'save-paper') {
                const f = panel.querySelector('[data-paper]');
                const phone = f.witnessPhone.value.replace(/[\s-]/g, '');
                if (!phoneOk(phone)) throw new Error('The witness’s mobile should have 10 digits');
                const drawn = k => pads[k] && !pads[k].empty() ? pads[k].path() : null;
                await refresh(await api.put(`${base}/paper`, {
                    stampDuty: Number(f.stampDuty.value || 0), stampSerial: f.stampSerial.value.trim(), witnessName: f.witnessName.value.trim(),
                    witnessPhone: phone, witnessAddress: f.witnessAddress.value.trim(), witness2Name: f.witness2Name.value.trim(), witness2Address: f.witness2Address.value.trim(),
                    thumbBoxes: f.thumbBoxes.checked, companySignature: drawn('company'), witnessSignature: drawn('witness'), witness2Signature: drawn('witness2'),
                    partyInkSignature: drawn('party'),
                }), 'Saved');
                return;
            }
            if (act === 'link') {
                const hours = Number(panel.querySelector('[data-hours] .selected')?.dataset.value || 168);
                const made = await api.post(`${base}/link`, { hours });
                await refresh(made.agreement);
                const url = `${location.origin}/project-agreement.html#${made.token}`;
                const text = `Hi ${made.agreement.partyName.split(' ')[0]}, please read and sign the ${made.agreement.title.toLowerCase()} for ${project.name}. Open the link, type your mobile number, add your Aadhaar card and a selfie, and sign: ${url}`;
                const phone = (made.agreement.partyPhone || '').replace(/\D/g, '').slice(-10);
                panel.querySelector('[data-cg-result]').innerHTML = `<div class="ln-made cs-made">
                    <div class="ln-qr">${qrSvg(url, { size: 130 })}</div>
                    <div class="ln-made-main">
                        <p class="small muted" style="margin:0">Send it now: it is shown only once and works until <b>${dateTime(made.agreement.linkExpiresAt)}</b>. It opens only with ${esc(made.agreement.partyName)}'s mobile number.</p>
                        <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy-url>${icon('copy')}Copy</button></div>
                        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}">${icon('phone')}Send on WhatsApp</a>
                            <a class="btn sm" target="_blank" rel="noopener" href="sms:${phone}?body=${encodeURIComponent(text)}">${icon('mail')}SMS</a></div>
                    </div></div>`;
                panel.querySelector('[data-copy-url]').addEventListener('click', async ev => {
                    ev.stopPropagation();
                    try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { panel.querySelector('[data-cg-result] input').select(); }
                });
                return;
            }
            if (act === 'revoke') await refresh(await api.post(`${base}/link/revoke`), 'Link stopped');
        } catch (err) { toast(err.message, 'error'); }
    });
    el.querySelector('.ag-status').addEventListener('click', e => {
        if (e.target.closest('[data-cg="details"]')) { modal.close(); if (st.changed) onChanged?.(); openSetup(project, st.a.kind, st.a.refId, st.a, {}, onChanged); }
    });
    panel.addEventListener('input', e => {
        const f = e.target.closest('[data-paper]');
        if (!f) return;
        Object.assign(st.a, { stampDuty: Number(f.stampDuty.value || 0) || null, stampSerial: f.stampSerial.value.trim() || null,
            witnessName: f.witnessName.value.trim() || null, witnessAddress: f.witnessAddress.value.trim() || null,
            witness2Name: f.witness2Name.value.trim() || null, witness2Address: f.witness2Address.value.trim() || null, thumbBoxes: f.thumbBoxes.checked });
        drawBond();
    });
}
