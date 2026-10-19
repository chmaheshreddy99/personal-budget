/**
 * The organiser's / lender's side of agreements, shared by Host a Chit and Money lent:
 *
 *   kycTilesHtml(files, opts)     tiles for Aadhaar (front, back), PAN and a selfie: what is attached, add or replace
 *   bindKycTiles(root, opts)      wires them: a photo or PDF from the device (shrunk), or the live camera for a selfie
 *   takeSelfie(label)             the front camera in a layer above the dialog; resolves to a JPEG or null
 *   fileUrls(files, fetchBlob)    the files as data: URLs, to show and to print with the deed
 */
import { icon } from '../core/icons.js';
import { esc, toast } from '../core/ui.js';
import { shrinkImage, openCamera, dataUrl } from '../core/bond.js';
import { dateTime } from '../core/format.js';

export const DOC_LABELS = {
    AADHAAR_FRONT: ['Aadhaar · front', 'the side with the photo', 'id-card'],
    AADHAAR_BACK: ['Aadhaar · back', 'the side with the address', 'id-card'],
    PAN: ['PAN card', 'the side with the number', 'id-card'],
    SELFIE: ['Selfie', 'a live photo from the camera', 'camera'],
};

/**
 * types: which tiles, in order; need: the ones required; urls: id → image URL; editable: add / replace / remove.
 */
/** The file given for a type (not the pages rendered from a PDF), and the pages if it is a PDF. */
function given(files, t) {
    const f = files.find(x => x.docType === t && !x.derivedFromSha);
    return { f, pages: f ? files.filter(x => x.derivedFromSha && x.derivedFromSha === f.sha256) : [] };
}

/** A small mark: the file on disk still matches the fingerprint taken when it came in. */
function sealMark(f, pages = []) {
    const ok = f.intact !== false && pages.every(p => p.intact !== false);
    return `<span class="kyc-seal ${ok ? 'ok' : 'bad'}" title="${ok ? 'Unchanged since it was added (SHA-256 checked)' : 'The stored file no longer matches its fingerprint'}">${icon(ok ? 'shield' : 'alert')}${ok ? 'Intact' : 'Changed'}</span>`;
}

export function kycTilesHtml(files, { types = ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'SELFIE'], need = new Set(), urls = {}, editable = true } = {}) {
    return `<div class="kyc-grid">${types.map(t => {
        const { f, pages } = given(files, t);
        const shown = f && (f.image ? f : pages[0]);
        const [label, hint, ic] = DOC_LABELS[t];
        return `<div class="kyc-tile ${f ? 'done' : ''} ${need.has(t) ? 'need' : ''}" data-kyc="${t}">
            <b>${icon(ic)} ${esc(label)}</b>
            ${f ? (shown && urls[shown.id] ? `<img src="${esc(urls[shown.id])}" alt="${esc(label)}">` : '')
                + (f.pdf ? `<small>PDF · ${esc(f.fileName)}${pages.length ? ` · ${pages.length > 1 ? `${pages.length} images` : "1 image"} taken from it` : ''}</small>` : (shown ? '' : `<small>File · ${esc(f.fileName)}</small>`))
                + `<small>${esc(f.source === 'CAMERA' ? 'camera' : 'upload')} · ${dateTime(f.createdAt)}${f.createdBy && /link/.test(f.createdBy) ? ' · by the member' : ''} ${sealMark(f, pages)}</small>`
                : `<small>${esc(hint)}</small>`}
            ${editable ? `<div class="kyc-acts">${t === 'SELFIE'
                ? `<button type="button" data-kyc-camera="${t}">${icon('camera')}${f ? 'Retake' : 'Camera'}</button>`
                : `<label>${icon('upload')}${f ? 'Replace' : 'Add'}<input type="file" accept="image/*,application/pdf" data-kyc-file="${t}"></label>
                   <button type="button" data-kyc-camera="${t}" title="Take a photo">${icon('camera')}</button>`}
                ${f ? `<button type="button" data-kyc-remove="${f.id}" title="Remove">${icon('trash')}</button>` : ''}</div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

/** upload(docType, blob, name, source): saves and returns nothing (the caller redraws); remove(id) likewise. */
export function bindKycTiles(root, { upload, remove, label = '' }) {
    root.addEventListener('change', async e => {
        const input = e.target.closest('[data-kyc-file]');
        if (!input || !input.files?.[0]) return;
        const file = input.files[0];
        try {
            const blob = await shrinkImage(file);
            await upload(input.dataset.kycFile, blob, file.name, 'UPLOAD');
        } catch (err) { toast(err.message, 'error'); }
        input.value = '';
    });
    root.addEventListener('click', async e => {
        const cam = e.target.closest('[data-kyc-camera]');
        const rm = e.target.closest('[data-kyc-remove]');
        try {
            if (cam) {
                const type = cam.dataset.kycCamera;
                const blob = await takeSelfie(label, type === 'SELFIE' ? 'user' : 'environment');
                if (blob) await upload(type, blob, `${type.toLowerCase()}.jpg`, 'CAMERA');
            }
            if (rm) await remove(Number(rm.dataset.kycRemove));
        } catch (err) { toast(err.message, 'error'); }
    });
}

/** The camera in a layer above everything; resolves to a JPEG (time and label burnt in) or null when closed. */
export function takeSelfie(label = '', facing = 'user') {
    return new Promise(resolve => {
        const layer = document.createElement('div');
        layer.className = 'ev-overlay kyc-layer';
        layer.innerHTML = `<div class="kyc-cam-card"><div class="kyc-cam">
                <div class="kyc-frame ${facing === 'user' ? 'face' : 'card'}"><video autoplay playsinline muted ${facing === 'user' ? '' : 'style="transform:none"'}></video></div>
                <p class="kyc-cam-tip">${facing === 'user' ? 'Face the camera in good light, then take the photo.' : 'Hold the card flat inside the frame, then take the photo.'}</p>
                <p class="form-error" data-cam-error></p>
                <div class="kyc-cam-acts"><button type="button" class="btn" data-cam="close">Cancel</button>
                    <button type="button" class="btn primary" data-cam="shoot" disabled>${icon('camera')}Take photo</button></div>
            </div></div>`;
        document.body.appendChild(layer);
        let cam = null;
        const done = blob => { cam?.stop(); layer.remove(); document.removeEventListener('keydown', keys, true); resolve(blob); };
        const keys = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
        document.addEventListener('keydown', keys, true);
        openCamera(layer.querySelector('video'), { facing }).then(c => {
            cam = c;
            layer.querySelector('[data-cam="shoot"]').disabled = false;
        }).catch(err => { layer.querySelector('[data-cam-error]').textContent = err.message; });
        layer.addEventListener('click', async e => {
            const b = e.target.closest('[data-cam]');
            if (!b) return;
            if (b.dataset.cam === 'close') done(null);
            if (b.dataset.cam === 'shoot' && cam) done(await cam.capture(label));
        });
    });
}

/** The agreement's image files as data: URLs (id → URL), fetched with fetchBlob(file, thumb). */
export async function fileUrls(files, fetchBlob, { thumb = false } = {}) {
    const out = {};
    await Promise.all(files.filter(f => f.image).map(async f => {
        try { out[f.id] = await dataUrl(await fetchBlob(f, thumb)); } catch { /* shown without the picture */ }
    }));
    return out;
}

/** The annexures of a deed: ID proof and the photograph, with each file's fingerprint. */
export function kycAnnexures(files, urls, { who = '', aadhaarLast4 = null, panMasked = null, mark = '' } = {}) {
    const pic = t => {
        const { f, pages } = given(files, t);
        if (!f) return [];
        const caption = DOC_LABELS[t]?.[0] || t;
        // a PDF: its pages, rendered (and watermarked) by the server, each tied to the original PDF's fingerprint
        if (f.pdf && pages.length) {
            return pages.map((p, i) => ({ src: urls[p.id] || '', pdf: !urls[p.id], caption: p.caption || (pages.length > 1 ? `${caption} · page ${i + 1}` : caption),
                hash: f.sha256, from: 'PDF', pageHash: p.sha256, fullPage: /-page-\d+\.(png|jpe?g)$/i.test(p.fileName || ''), intact: f.intact !== false && p.intact !== false, mark }));
        }
        return [{ src: urls[f.id] || '', pdf: !f.image || !urls[f.id], caption, hash: f.sha256, intact: f.intact !== false, mark }];
    };
    // the cards first (photos and close-ups, which share a page), then the full pages of the PDFs, a page each
    const all = [...pic('AADHAAR_FRONT'), ...pic('AADHAAR_BACK'), ...pic('PAN')];
    const ids = [...all.filter(x => !x.fullPage), ...all.filter(x => x.fullPage)];
    const out = [];
    if (ids.length || aadhaarLast4 || panMasked) {
        out.push({ title: 'Identity proof', note: [who, aadhaarLast4 ? `Aadhaar XXXX XXXX ${aadhaarLast4}` : '', panMasked ? `PAN ${panMasked}` : ''].filter(Boolean).join(' · '), images: ids });
    }
    const selfie = pic('SELFIE');
    if (selfie.length) out.push({ title: 'Photograph', note: `${who}: a live photo taken with the camera when the agreement was made`, images: selfie.map(x => ({ ...x, photo: true })) });
    return out;
}
