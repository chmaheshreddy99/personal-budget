/**
 * The loan agreement of money lent (or paid on someone's behalf), from the item's panel.
 *
 * Left: the agreement's details (the borrower's mobile number is the key to the link), the stamp paper and the
 * signatures (the lender's and the witness's, drawn on this device), the borrower's ID proof, and the secret link
 * with what it has recorded. Right: the deed as it prints, in the stamp-paper style or for real stamp paper.
 *
 * The borrower opens the link (loan-agreement.html), types their mobile number to see it, adds a photo of their
 * Aadhaar card and a live selfie, types their Aadhaar number, signs and accepts; the evidence is sealed and digitally
 * signed. The agreement can also be printed and signed on paper.
 */
import { api } from '../core/api.js';
import { state, can } from '../core/store.js';
import { esc, toast, confirmDialog, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { qrSvg } from '../core/qr.js';
import { bondHtml, printBond, padHtml, bindPad, signatureSvg, evidenceRows, verifyEvidence, loanRecitals } from '../core/bond.js';
import { kycTilesHtml, bindKycTiles, fileUrls, kycAnnexures, DOC_LABELS } from './agreement-ui.js';

const STATUS = { DRAFT: ['warning', 'clock', 'Waiting for the borrower'], ACCEPTED: ['good', 'check-circle', 'Accepted online'], SIGNED: ['good', 'edit', 'Signed on paper'] };
const LINK = { NONE: ['gray', 'No link yet'], ACTIVE: ['good', 'Link active'], EXPIRED: ['gray', 'Link expired'], REVOKED: ['gray', 'Link stopped'], LOCKED: ['critical', 'Link locked'] };
const DURATIONS = [[24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
const manage = () => can('POST_TRANSACTIONS');
const num = v => Number(v || 0);

/** Opens the item's agreement, or the form to make one. */
export async function openLoanAgreement(claim, onChanged) {
    let a = await api.get(`/claims/${claim.id}/agreement`).catch(() => null);
    if (!a) { openSetup(claim, null, onChanged); return; }
    openDeed(claim, a, onChanged);
}

/** The details: who, where, the stamp, the witness, what the borrower must give, extra terms. */
function setupHtml(claim, a) {
    const v = (k, d = '') => esc(a?.[k] ?? d);
    return `<form class="form-grid two la-form" data-la-form onsubmit="return false">
        <div class="section-title span-2">${icon('user')}Borrower</div>
        <label class="field"><span>Name <small class="muted">as on their Aadhaar</small></span><input name="borrowerName" maxlength="100" value="${v('borrowerName', claim.party)}" data-plain></label>
        <label class="field"><span>Mobile <small class="muted">they type it to open the link</small></span><input name="borrowerPhone" type="tel" maxlength="14" inputmode="numeric" value="${v('borrowerPhone')}" placeholder="10 digits" data-plain></label>
        <label class="field span-2"><span>Address</span><input name="borrowerAddress" maxlength="150" value="${v('borrowerAddress')}" data-plain></label>
        <div class="section-title span-2">${icon('hand')}Lender</div>
        <label class="field"><span>Name</span><input name="lenderName" maxlength="100" value="${v('lenderName', state.user?.fullName || '')}" data-plain></label>
        <label class="field"><span>Place of the agreement</span><input name="place" maxlength="60" value="${v('place')}" placeholder="e.g. Hyderabad" data-plain></label>
        <label class="field span-2"><span>Address</span><input name="lenderAddress" maxlength="150" value="${v('lenderAddress')}" data-plain></label>
        <div class="section-title span-2">${icon('stamp')}Stamp paper and witness</div>
        <label class="field"><span>Stamp paper value</span><input name="stampDuty" type="number" class="num" min="0" step="10" value="${a ? num(a.stampDuty) || '' : 100}" data-plain></label>
        <label class="field"><span>Stamp paper serial no. <small class="muted">optional</small></span><input name="stampSerial" maxlength="40" value="${v('stampSerial')}" data-plain></label>
        <label class="field"><span>Witness</span><input name="witnessName" maxlength="100" value="${v('witnessName')}" data-plain></label>
        <label class="field"><span>Witness's mobile</span><input name="witnessPhone" type="tel" maxlength="14" inputmode="numeric" value="${v('witnessPhone')}" data-plain></label>
        <label class="field span-2"><span>Witness's address</span><input name="witnessAddress" maxlength="150" value="${v('witnessAddress')}" data-plain></label>
        <div class="section-title span-2">${icon('shield')}The borrower gives, on the link</div>
        <div class="span-2 la-req">
            <label class="check-line"><input type="checkbox" name="requireAadhaar" ${a ? (a.requireAadhaar ? 'checked' : '') : 'checked'}> Aadhaar card photo and number <small class="muted">(the number is checked; only its last 4 digits are kept)</small></label>
            <label class="check-line"><input type="checkbox" name="requireSelfie" ${a ? (a.requireSelfie ? 'checked' : '') : 'checked'}> A live selfie from the phone's camera <small class="muted">(time-stamped; not from the gallery)</small></label>
            <label class="check-line"><input type="checkbox" name="requireLocation" ${a?.requireLocation ? 'checked' : ''}> Their location when accepting</label>
        </div>
        <label class="field span-2"><span>Extra terms <small class="muted">optional, one per line</small></span><textarea name="extraTerms" rows="3" maxlength="1500" placeholder="e.g. Repayment in 10 monthly parts of ₹5,000 by the 5th" data-plain></textarea></label>
    </form>`;
}

function readSetup(form) {
    const phone = form.borrowerPhone.value.replace(/[\s-]/g, '');
    if (phone && !/^(\+?91)?[6-9]\d{9}$/.test(phone)) throw new Error('The borrower’s mobile should have 10 digits');
    const wPhone = form.witnessPhone.value.replace(/[\s-]/g, '');
    if (wPhone && !/^(\+?91)?[6-9]\d{9}$/.test(wPhone)) throw new Error('The witness’s mobile should have 10 digits');
    return {
        borrowerName: form.borrowerName.value.trim() || null, borrowerPhone: phone || null, borrowerAddress: form.borrowerAddress.value.trim() || null,
        lenderName: form.lenderName.value.trim() || null, lenderAddress: form.lenderAddress.value.trim() || null, place: form.place.value.trim() || null,
        stampDuty: Number(form.stampDuty.value || 0), stampSerial: form.stampSerial.value.trim() || null,
        witnessName: form.witnessName.value.trim() || null, witnessPhone: wPhone || null, witnessAddress: form.witnessAddress.value.trim() || null,
        requireAadhaar: form.requireAadhaar.checked, requireSelfie: form.requireSelfie.checked, requireLocation: form.requireLocation.checked,
        extraTerms: form.extraTerms.value.trim() || null,
    };
}

function openSetup(claim, a, onChanged) {
    openModal({
        title: a ? `Update ${a.agreementNo}` : `Loan agreement · ${claim.party}`, sub: `${claim.narration} · ${money(claim.amount)}`, iconName: 'file-text', size: 'lg',
        body: `<p class="hint" style="margin:0 0 10px">The amount, the date, the due date and the interest come from the item. ${esc(claim.party)} gets a secret link:
            they type their mobile number to open it, add their Aadhaar card and a live selfie, and sign with their finger. You can also print it on stamp paper.</p>
            ${setupHtml(claim, a)}`,
        actions: [
            { label: 'Cancel' },
            { label: a ? 'Update the agreement' : 'Make the agreement', kind: 'primary', iconName: 'check', onClick: async modal => {
                const saved = await api.post(`/claims/${claim.id}/agreement`, readSetup(modal.el.querySelector('[data-la-form]')));
                toast(a ? 'Agreement updated' : `Agreement ${saved.agreementNo} made`);
                onChanged?.();
                setTimeout(() => openDeed(claim, saved, onChanged), 0);
            } },
        ],
    });
}

/** The agreement as a deed (see bondHtml). */
function deedOf(claim, a, urls, real, verified) {
    const accepted = a.status === 'ACCEPTED' ? `accepted online ${dateTime(a.acceptedAt)}` : a.status === 'SIGNED' ? `signed on paper ${date(String(a.acceptedAt).slice(0, 10))}` : '';
    const ev = a.status === 'ACCEPTED' ? [{ title: 'Evidence of the online acceptance', rows: evidenceRows({
        name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: a.phoneMatches, aadhaarLast4: a.aadhaarLast4, ip: a.acceptedIp,
        device: a.acceptedDevice, userAgent: a.acceptedUserAgent, location: a.acceptedLocation, deviceHash: a.deviceHash, seal: a.acceptanceSeal,
        digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified }) }] : [];
    return {
        kind: claim.kind === 'PAID_FOR' ? 'DEBT' : 'LOAN',
        title: claim.kind === 'PAID_FOR' ? 'Acknowledgement of debt' : 'Loan agreement', number: a.agreementNo, date: a.loanDate, place: a.place,
        stampDuty: a.stampDuty, stampSerial: a.stampSerial, realStampPaper: real,
        firstParty: { role: 'Lender', term: 'Lender', name: a.lenderName, address: a.lenderAddress, signature: a.lenderSignature, seal: a.lenderName },
        secondParty: { role: 'Borrower', term: 'Borrower', name: a.status !== 'DRAFT' && a.acceptedName ? a.acceptedName : a.borrowerName, address: a.borrowerAddress,
            phone: a.borrowerPhone, signature: a.status === 'ACCEPTED' ? a.signature : null, accepted },
        witness: { name: a.witnessName, phone: a.witnessPhone, address: a.witnessAddress, signature: a.witnessSignature },
        recitals: loanRecitals(claim.kind, money(a.amount), a.amountInWords),
        particulars: [['Amount', `${money(a.amount)} (${a.amountInWords})`], ['Given on', date(a.loanDate)], ['Repay by', a.dueDate ? date(a.dueDate) : 'on demand'],
            ['Interest', a.interestRate ? `${Number(a.interestRate)}% a year · ${a.interestTerms || ''}` : 'none'],
            ...(a.aadhaarLast4 ? [['Borrower’s Aadhaar', `XXXX XXXX ${a.aadhaarLast4}`]] : [])],
        terms: a.terms, fingerprint: a.contentHash,
        annexures: [...kycAnnexures(a.files || [], urls, { who: a.borrowerName, aadhaarLast4: a.aadhaarLast4 }), ...ev],
        footnote: a.digitalSignature ? `Digitally signed evidence · key ${a.keyFingerprint}${verified ? ' · verified' : ''}` : '',
    };
}

async function openDeed(claim, first, onChanged) {
    const st = { a: first, tab: first.status === 'DRAFT' ? 'link' : 'evidence', real: false, urls: {}, verified: null, changed: false };
    const fetchBlob = (f, thumb) => api.blob(`/claims/${claim.id}/agreement/files/${f.id}`, thumb ? { thumb: true } : {});
    st.urls = await fileUrls(first.files || [], fetchBlob);
    st.verified = await verifyEvidence(first.evidencePayload, first.digitalSignature, first.publicKey);
    const draft = () => st.a.status === 'DRAFT';
    const editable = () => manage();
    let pads = {};

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
                    <li>${icon('phone')}<span>${esc(a.borrowerName)} opens the link and types <b>${a.borrowerPhone ? `the mobile ending ${esc(a.borrowerPhone.slice(-4))}` : 'their mobile number (add it in Details first)'}</b>; nothing is shown before. Five wrong numbers lock the link.</span></li>
                    <li>${icon('id-card')}<span>They add ${need.length ? need.join(', ') : 'nothing more'}${a.requireAadhaar ? ', type the Aadhaar number (checked, last 4 digits kept)' : ''}, and sign with their finger.</span></li>
                    <li>${icon('shield')}<span>The time, IP address, phone, device details${a.requireLocation ? ', location' : ''} and every file's fingerprint are sealed and digitally signed.</span></li>
                </ul>
                ${draft() && editable() ? `<div class="la-make"><span>Valid for</span><div class="ln-chips" data-hours>${DURATIONS.map(([h, l]) => `<button type="button" class="date-chip ${h === 168 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div>
                    <button type="button" class="btn primary sm" data-la="link" ${a.borrowerPhone ? '' : 'disabled'}>${icon('send')}${a.linkStatus === 'NONE' ? 'Make the link' : 'Make a new link'}</button>
                    ${a.linkStatus === 'ACTIVE' ? `<button type="button" class="btn sm ghost" data-la="revoke">${icon('lock')}Stop the link</button>` : ''}</div>` : ''}
                <div data-la-result></div>
            </div>`;
        },
        paper: () => {
            const a = st.a;
            return `<form class="form-grid two la-panel" data-paper onsubmit="return false">
                <label class="field"><span>Stamp paper value</span><input type="number" name="stampDuty" class="num" min="0" step="10" value="${Number(a.stampDuty) || ''}" data-plain></label>
                <label class="field"><span>Serial no.</span><input type="text" name="stampSerial" maxlength="40" value="${esc(a.stampSerial || '')}" data-plain></label>
                <div class="span-2 ag-sig"><div class="ag-sig-now">${a.lenderSignature ? signatureSvg(a.lenderSignature) : '<span class="muted small">Not signed yet</span>'}<small>Lender's signature</small></div>
                    ${editable() ? `<div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-la="draw-lender">${icon('edit')}Sign on this device</button>
                        ${a.lenderSignature ? `<button type="button" class="btn sm ghost" data-la="clear-lender">${icon('x')}Remove</button>` : ''}</div>` : ''}
                    <div data-pad-lender hidden>${padHtml('lender', 'Lender signs here')}</div></div>
                <label class="field"><span>Witness</span><input name="witnessName" maxlength="100" value="${esc(a.witnessName || '')}" data-plain></label>
                <label class="field"><span>Witness's mobile</span><input name="witnessPhone" type="tel" maxlength="14" value="${esc(a.witnessPhone || '')}" data-plain></label>
                <label class="field span-2"><span>Witness's address</span><input name="witnessAddress" maxlength="150" value="${esc(a.witnessAddress || '')}" data-plain></label>
                <div class="span-2 ag-sig"><div class="ag-sig-now">${a.witnessSignature ? signatureSvg(a.witnessSignature) : '<span class="muted small">Not signed yet</span>'}<small>Witness's signature</small></div>
                    ${editable() ? `<div class="ag-sig-acts"><button type="button" class="btn sm ghost" data-la="draw-witness">${icon('edit')}Witness signs on this device</button>
                        ${a.witnessSignature ? `<button type="button" class="btn sm ghost" data-la="clear-witness">${icon('x')}Remove</button>` : ''}</div>` : ''}
                    <div data-pad-witness hidden>${padHtml('witness', 'Witness signs here')}</div></div>
                ${editable() ? `<div class="span-2 row"><span class="grow"></span><button type="button" class="btn primary sm" data-la="save-paper">${icon('check')}Save</button></div>` : ''}
            </form>`;
        },
        kyc: () => {
            const a = st.a;
            return `<div class="la-panel">
                <p class="muted small" style="margin:0">${icon('shield')}${draft() ? `${esc(a.borrowerName)} adds these on the link; you can add them here too (a photo or the camera).` : 'Part of the accepted record.'}
                    ${a.aadhaarLast4 ? ` Aadhaar on record: XXXX XXXX ${esc(a.aadhaarLast4)}.` : ''}</p>
                ${kycTilesHtml(a.files || [], { need: new Set([...(a.requireAadhaar ? ['AADHAAR_FRONT'] : []), ...(a.requireSelfie ? ['SELFIE'] : [])]), urls: st.urls, editable: editable() && draft() })}
            </div>`;
        },
        evidence: () => {
            const a = st.a;
            if (a.status === 'DRAFT') return `<div class="la-panel"><p class="muted">Nothing accepted yet. The evidence appears here once ${esc(a.borrowerName)} accepts.</p></div>`;
            if (a.status === 'SIGNED') return `<div class="la-panel"><p>${icon('edit')}Signed on paper by <b>${esc(a.acceptedName)}</b>, recorded ${dateTime(a.acceptedAt)} · ${esc(a.acceptedUserAgent || '')}</p></div>`;
            return `<div class="la-panel">
                <div class="cs-sig-status ${st.verified === false ? 'bad' : st.verified ? 'ok' : 'wait'}"><b>${st.verified ? '✓ Digital signature verified' : st.verified === false ? '✗ The signature does not match' : 'The signature could not be checked here'}</b>
                    <small>ECDSA P-256 · key ${esc(a.keyFingerprint)}</small></div>
                <table class="bond-facts ev"><tbody>${evidenceRows({ name: a.acceptedName, at: a.acceptedAt, phone: a.acceptedPhone, phoneMatches: a.phoneMatches,
                    aadhaarLast4: a.aadhaarLast4, ip: a.acceptedIp, device: a.acceptedDevice, userAgent: a.acceptedUserAgent, location: a.acceptedLocation,
                    deviceHash: a.deviceHash, seal: a.acceptanceSeal, digitalSignature: a.digitalSignature, keyFingerprint: a.keyFingerprint, verified: st.verified })
                    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>
                ${a.acceptedLocation ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(a.acceptedLocation.split(',').slice(0, 2).join(','))}">${icon('flag')}Open the location on a map</a>` : ''}
            </div>`;
        },
    };
    const [tone, ic, label] = STATUS[first.status] || ['gray', 'info', first.status];
    const modal = openModal({
        title: `Agreement ${first.agreementNo}`, sub: `${claim.party} · ${money(first.amount)}`, iconName: 'file-text', size: 'xl hc-ag-modal',
        body: `<div class="ag-layout">
            <div class="ag-side">
                <div class="ag-status"><span class="badge ${tone}">${icon(ic)}${label}</span><small class="muted">${esc(first.agreementNo)} · made ${dateTime(first.createdAt)}</small>
                    ${first.status === 'DRAFT' && manage() ? '<span class="grow"></span><button type="button" class="btn sm ghost" data-la="details">' + icon('edit') + 'Details</button>' : ''}</div>
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
            { label: 'Print view', left: true, iconName: 'printer', onClick: () => { printBond(deedOf(claim, st.a, st.urls, st.real, st.verified), `Agreement ${st.a.agreementNo}`); return true; } },
            ...(first.status === 'DRAFT' && manage() ? [
                { label: 'Delete', iconName: 'trash', onClick: async () => {
                    if (!await confirmDialog(`Delete ${st.a.agreementNo}? The link stops working and the ID proof is removed.`, { confirmLabel: 'Delete' })) return true;
                    await api.del(`/claims/${claim.id}/agreement`);
                    toast('Agreement deleted');
                    onChanged?.();
                } },
                { label: 'Signed on paper', iconName: 'edit', onClick: async () => {
                    if (!await confirmDialog(`Record that ${st.a.borrowerName} signed the printed agreement${st.a.witnessName ? ` before ${st.a.witnessName}` : ''}? The link stops working.`, { title: 'Signed on paper', confirmLabel: 'Record signature', danger: false })) return true;
                    await api.post(`/claims/${claim.id}/agreement/signed`, { name: st.a.borrowerName });
                    toast('Signature recorded');
                    onChanged?.();
                } },
            ] : []),
            { label: 'Close', kind: 'primary', onClick: () => { if (st.changed) onChanged?.(); } },
        ],
    });
    const el = modal.el;
    const drawBond = () => { el.querySelector('[data-bond]').innerHTML = bondHtml(deedOf(claim, st.a, st.urls, st.real, st.verified)); };
    const drawPanel = () => {
        el.querySelector('[data-panel]').innerHTML = panels[st.tab]();
        pads = { lender: bindPad(el, 'lender'), witness: bindPad(el, 'witness') };
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
    bindKycTiles(panel, {
        label: `${st.a.agreementNo} · ${st.a.borrowerName}`,
        upload: async (type, blob, name, source) => {
            const form = new FormData();
            form.append('file', blob, name);
            form.append('docType', type);
            form.append('source', source);
            await refresh(await api.upload(`/claims/${claim.id}/agreement/files`, form), `${DOC_LABELS[type][0]} added`);
        },
        remove: async id => {
            if (!await confirmDialog('Remove this file from the agreement?', { confirmLabel: 'Remove' })) return;
            await refresh(await api.del(`/claims/${claim.id}/agreement/files/${id}`), 'File removed');
        },
    });
    panel.addEventListener('click', async e => {
        const chip = e.target.closest('[data-hours] [data-value]');
        if (chip) { panel.querySelectorAll('[data-hours] [data-value]').forEach(x => x.classList.toggle('selected', x === chip)); return; }
        const b = e.target.closest('[data-la]');
        if (!b) return;
        try {
            const act = b.dataset.la;
            if (act === 'draw-lender') { panel.querySelector('[data-pad-lender]').hidden = false; return; }
            if (act === 'draw-witness') { panel.querySelector('[data-pad-witness]').hidden = false; return; }
            if (act === 'clear-lender') { await refresh(await api.put(`/claims/${claim.id}/agreement/paper`, { clearLenderSignature: true }), 'Signature removed'); return; }
            if (act === 'clear-witness') { await refresh(await api.put(`/claims/${claim.id}/agreement/paper`, { clearWitnessSignature: true }), 'Signature removed'); return; }
            if (act === 'save-paper') {
                const f = panel.querySelector('[data-paper]');
                const phone = f.witnessPhone.value.replace(/[\s-]/g, '');
                if (phone && !/^(\+?91)?[6-9]\d{9}$/.test(phone)) throw new Error('The witness’s mobile should have 10 digits');
                const witness = pads.witness && !pads.witness.empty() ? pads.witness.path() : null;
                if (witness && !f.witnessName.value.trim()) throw new Error('Enter the witness’s name with their signature');
                await refresh(await api.put(`/claims/${claim.id}/agreement/paper`, {
                    stampDuty: Number(f.stampDuty.value || 0), stampSerial: f.stampSerial.value.trim(), witnessName: f.witnessName.value.trim(),
                    witnessPhone: phone, witnessAddress: f.witnessAddress.value.trim(), witnessSignature: witness,
                    lenderSignature: pads.lender && !pads.lender.empty() ? pads.lender.path() : null,
                }), 'Saved');
                return;
            }
            if (act === 'link') {
                const hours = Number(panel.querySelector('[data-hours] .selected')?.dataset.value || 168);
                const made = await api.post(`/claims/${claim.id}/agreement/link`, { hours });
                await refresh(made.agreement);
                const url = `${location.origin}/loan-agreement.html#${made.token}`;
                const text = `Hi ${made.agreement.borrowerName.split(' ')[0]}, please read and sign the agreement for the ${money(made.agreement.amount)} ${claim.kind === 'PAID_FOR' ? 'I paid for you' : 'I lent you'}. Open the link, type your mobile number, add your Aadhaar card and a selfie, and sign: ${url}`;
                const phone = (made.agreement.borrowerPhone || '').replace(/\D/g, '').slice(-10);
                panel.querySelector('[data-la-result]').innerHTML = `<div class="ln-made cs-made">
                    <div class="ln-qr">${qrSvg(url, { size: 130 })}</div>
                    <div class="ln-made-main">
                        <p class="small muted" style="margin:0">Send it now: it is shown only once and works until <b>${dateTime(made.agreement.linkExpiresAt)}</b>. It opens only with ${esc(made.agreement.borrowerName)}'s mobile number.</p>
                        <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy-url="${esc(url)}">${icon('copy')}Copy</button></div>
                        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}">${icon('phone')}Send on WhatsApp</a>
                            <a class="btn sm" target="_blank" rel="noopener" href="sms:${phone}?body=${encodeURIComponent(text)}">${icon('mail')}SMS</a></div>
                    </div></div>`;
                panel.querySelector('[data-la-result] [data-copy-url]').addEventListener('click', async ev => {
                    ev.stopPropagation();
                    try { await navigator.clipboard.writeText(url); toast('Link copied', 'info'); } catch { panel.querySelector('[data-la-result] input').select(); }
                });
                return;
            }
            if (act === 'revoke') { await refresh(await api.post(`/claims/${claim.id}/agreement/link/revoke`), 'Link stopped'); }
        } catch (err) { toast(err.message, 'error'); }
    });
    el.querySelector('.ag-status').addEventListener('click', e => {
        if (e.target.closest('[data-la="details"]')) { modal.close(); if (st.changed) onChanged?.(); openSetup(claim, st.a, onChanged); }
    });
    // the deed follows what is typed
    panel.addEventListener('input', e => {
        const f = e.target.closest('[data-paper]');
        if (!f) return;
        Object.assign(st.a, { stampDuty: Number(f.stampDuty.value || 0) || null, stampSerial: f.stampSerial.value.trim() || null,
            witnessName: f.witnessName.value.trim() || null, witnessPhone: f.witnessPhone.value.trim() || null, witnessAddress: f.witnessAddress.value.trim() || null });
        drawBond();
    });
}
