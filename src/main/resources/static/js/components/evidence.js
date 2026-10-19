/**
 * Evidence: photos, scans and PDFs kept with an entry (a receipt, a bill, a UPI screenshot, a chit receipt).
 *
 * In a dialog, before the entry exists:
 *     evidenceFieldHtml()                      the capture strip (camera, upload, paste, drop)
 *     const ev = bindEvidenceField(formEl)      pending files; edit / crop / remove before saving
 *     await ev.uploadTo(entryId)                after the entry is saved
 *
 * Under an expanded entry, after it exists:
 *     <div data-ev-entry="123" data-ev-count="2"></div>
 * is filled in automatically (compact thumbnails; click one for the full-screen viewer; add more in place).
 *
 * Camera: live preview (rear camera first, switchable), shutter, then the crop editor. Crop editor: drag the
 * box or its handles, rotate, "Auto" trims the background around a receipt, "Document" boosts a paper
 * scan to crisp black on white. Photos are resized to at most 2200 px and saved as JPEG before upload,
 * so a 12 MP phone photo becomes a few hundred KB. Viewer: zoom (wheel, + / −, double-click), pan,
 * rotate, previous / next (← / →), a filmstrip, caption, download and delete.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, toast, confirmDialog } from '../core/ui.js';
import { icon, hydrateIcons } from '../core/icons.js';
import { dateTime } from '../core/format.js';

const MAX_SIDE = 2200;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

// ===================================================================== helpers

const sizeLabel = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');

/** Object URLs of downloaded files, by "id" / "id:thumb". */
const urlCache = new Map();
export async function fileUrl(id, thumb) {
    const key = `${id}${thumb ? ':thumb' : ''}`;
    if (!urlCache.has(key)) {
        urlCache.set(key, api.blob(`/attachments/${id}/file`, thumb ? { thumb: true } : {}).then(b => URL.createObjectURL(b)));
    }
    try {
        return await urlCache.get(key);
    } catch (error) {
        urlCache.delete(key);
        throw error;
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('This image could not be read'));
        img.src = src;
    });
}

const canvasBlob = (canvas, type = 'image/jpeg', quality = 0.86) =>
    new Promise(resolve => canvas.toBlob(resolve, type, quality));

/**
 * A photo ready to upload: upright (EXIF orientation applied), at most MAX_SIDE px, JPEG.
 * Small PNG screenshots stay PNG (sharper text); GIFs and PDFs are left alone.
 */
async function prepare(file) {
    if (file.type === 'application/pdf' || file.type === 'image/gif') return file;
    if (file.type === 'image/png' && file.size < 1.5 * 1048576) return file;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return file;   // the server checks the type; nothing better to do here
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await canvasBlob(canvas);
    return blob && blob.size < file.size ? blob : file;
}

function renamed(name, blob) {
    const base = (name || 'evidence').replace(/\.[a-z0-9]{2,5}$/i, '');
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }[blob.type] || '';
    return base + ext;
}

/** A layer above everything (and above dialogs). Escape is handled here and does not close the dialog below. */
function overlay(cls, html, onKey) {
    const el = document.createElement('div');
    el.className = `ev-overlay ${cls}`;
    el.innerHTML = html;
    document.body.appendChild(el);
    hydrateIcons(el);
    const keys = e => {
        if (!document.body.contains(el)) return;
        // only the top-most layer reacts
        const layers = document.querySelectorAll('.ev-overlay');
        if (layers[layers.length - 1] !== el) return;
        if (e.target.closest?.('input, textarea') && e.key !== 'Escape' && e.key !== 'Enter') return;
        if (onKey(e) !== false) {
            e.stopImmediatePropagation();
        }
    };
    document.addEventListener('keydown', keys, true);
    return { el, close() { document.removeEventListener('keydown', keys, true); el.remove(); } };
}

// ===================================================================== camera

/** Live camera; resolves with a cropped photo (Blob) or null. Falls back to the phone's camera app. */
export async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return pickFiles({ capture: true }).then(files => files[0] || null);
    let stream;
    let facing = 'environment';
    const start = async () => {
        stream?.getTracks().forEach(t => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
    };
    try {
        await start();
    } catch (error) {
        toast(error.name === 'NotAllowedError' ? 'Camera permission was denied; pick a photo instead'
            : 'No camera available here; pick a photo instead', 'info');
        return pickFiles({ capture: true }).then(files => files[0] || null);
    }
    const cameras = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'videoinput');

    return new Promise(resolve => {
        const layer = overlay('ev-camera', `
            <div class="evc-stage"><video autoplay playsinline muted></video><div class="evc-guide"><i></i><i></i><i></i><i></i></div>
                <div class="evc-flash"></div></div>
            <div class="evc-bar">
                <button type="button" class="ev-round" data-cam="close" title="Close (Esc)">${icon('x')}</button>
                <button type="button" class="evc-shutter" data-cam="shoot" title="Take photo (Space)"><span></span></button>
                <button type="button" class="ev-round" data-cam="flip" title="Switch camera" ${cameras.length > 1 ? '' : 'hidden'}>${icon('refresh')}</button>
            </div>
            <div class="evc-tip">Fit the receipt inside the frame · you can crop next</div>`, e => {
            if (e.key === 'Escape') finish(null);
            else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shoot(); }
            else return false;
        });
        const video = layer.el.querySelector('video');
        video.srcObject = stream;
        const finish = blob => {
            stream?.getTracks().forEach(t => t.stop());
            layer.close();
            resolve(blob);
        };
        const shoot = async () => {
            if (!video.videoWidth) return;
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            layer.el.querySelector('.evc-flash').classList.add('on');
            const shot = await canvasBlob(canvas, 'image/jpeg', 0.92);
            video.pause();
            const cropped = await openCropper(shot, { retake: true });
            if (cropped === 'retake') { video.play(); layer.el.querySelector('.evc-flash').classList.remove('on'); return; }
            finish(cropped);
        };
        layer.el.addEventListener('click', async e => {
            const b = e.target.closest('[data-cam]');
            if (!b) return;
            if (b.dataset.cam === 'close') finish(null);
            if (b.dataset.cam === 'shoot') shoot();
            if (b.dataset.cam === 'flip') {
                facing = facing === 'environment' ? 'user' : 'environment';
                try { await start(); video.srcObject = stream; } catch { /* keep the current camera */ }
            }
        });
    });
}

/** The system file picker; with capture it opens the phone camera app directly. */
function pickFiles({ capture = false, multiple = false } = {}) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = capture ? 'image/*' : ACCEPT;
        input.multiple = multiple;
        if (capture) input.capture = 'environment';
        input.addEventListener('change', () => resolve([...input.files]));
        input.addEventListener('cancel', () => resolve([]));
        input.click();
    });
}

// ===================================================================== crop editor

/**
 * Crop, rotate and clean up a photo. Resolves with the new Blob, null when cancelled,
 * or 'retake' when opened from the camera and the user wants another shot.
 */
export async function openCropper(source, { retake = false } = {}) {
    let work = await toCanvas(source);   // the current (rotated) full-size image
    let doc = false;                      // document mode: grayscale, more contrast
    let box = { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };   // fractions of the image

    return new Promise(resolve => {
        const layer = overlay('ev-crop', `
            <div class="evx-head"><b>${icon('crop')} Crop &amp; adjust</b><span class="spacer"></span>
                <span class="small evx-dim" data-dim></span></div>
            <div class="evx-stage" data-stage><div class="evx-frame" data-frame><img alt="">
                <div class="evx-box" data-box>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<i data-h="${h}" class="h-${h}"></i>`).join('')}
                    <span class="evx-grid"></span></div></div></div>
            <div class="evx-tools">
                <button type="button" class="btn sm on-dark" data-x="left" title="Rotate left">${icon('rotate-ccw')}</button>
                <button type="button" class="btn sm on-dark" data-x="right" title="Rotate right (R)">${icon('rotate-cw')}</button>
                <button type="button" class="btn sm on-dark" data-x="auto" title="Trim the background around a receipt or page (A)">${icon('sparkles')}Auto</button>
                <button type="button" class="btn sm on-dark" data-x="full" title="Use the whole photo">${icon('maximize')}Full</button>
                <button type="button" class="btn sm on-dark" data-x="doc" title="Crisp black on white, like a scan (D)">${icon('file-text')}Document</button>
                <span class="spacer"></span>
                ${retake ? `<button type="button" class="btn sm on-dark" data-x="retake">${icon('camera')}Retake</button>` : `<button type="button" class="btn sm on-dark" data-x="cancel">Cancel</button>`}
                <button type="button" class="btn sm primary" data-x="apply">${icon('check')}Use photo</button>
            </div>`, e => {
            if (e.key === 'Escape') done(retake ? 'retake' : null);
            else if (e.key === 'Enter') apply();
            else if (e.key.toLowerCase() === 'r') rotate(1);
            else if (e.key.toLowerCase() === 'a') auto();
            else if (e.key.toLowerCase() === 'd') toggleDoc();
            else return false;
        });
        const el = layer.el;
        const img = el.querySelector('img');
        const frame = el.querySelector('[data-frame]');
        const boxEl = el.querySelector('[data-box]');
        const done = value => { layer.close(); resolve(value); };

        const show = async () => {
            img.src = URL.createObjectURL(await canvasBlob(work, 'image/jpeg', 0.8));
            await img.decode().catch(() => {});
            fit();
        };
        // the frame is the displayed image; the box is positioned in fractions of it
        const fit = () => {
            const stage = el.querySelector('[data-stage]').getBoundingClientRect();
            const ratio = work.width / work.height;
            let w = stage.width - 24, h = w / ratio;
            if (h > stage.height - 24) { h = stage.height - 24; w = h * ratio; }
            frame.style.width = `${w}px`;
            frame.style.height = `${h}px`;
            draw();
        };
        const draw = () => {
            Object.assign(boxEl.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
            img.style.filter = doc ? 'grayscale(1) contrast(1.6) brightness(1.1)' : '';
            el.querySelector('[data-x="doc"]').classList.toggle('active', doc);
            el.querySelector('[data-dim]').textContent =
                `${Math.round(box.w * work.width)} × ${Math.round(box.h * work.height)} px${doc ? ' · document' : ''}`;
        };
        const rotate = async dir => {
            const c = document.createElement('canvas');
            c.width = work.height;
            c.height = work.width;
            const ctx = c.getContext('2d');
            ctx.translate(c.width / 2, c.height / 2);
            ctx.rotate(dir * Math.PI / 2);
            ctx.drawImage(work, -work.width / 2, -work.height / 2);
            work = c;
            box = dir > 0 ? { x: 1 - box.y - box.h, y: box.x, w: box.h, h: box.w } : { x: box.y, y: 1 - box.x - box.w, w: box.h, h: box.w };
            await show();
        };
        const auto = () => {
            const found = detectContent(work);
            if (found) { box = found; draw(); toast('Trimmed to the receipt', 'info'); }
            else toast('No clear edges found; drag the corners instead', 'info');
        };
        const toggleDoc = () => { doc = !doc; draw(); };
        const apply = async () => {
            const sx = Math.round(box.x * work.width), sy = Math.round(box.y * work.height);
            const sw = Math.max(1, Math.round(box.w * work.width)), sh = Math.max(1, Math.round(box.h * work.height));
            const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
            const out = document.createElement('canvas');
            out.width = Math.round(sw * scale);
            out.height = Math.round(sh * scale);
            const ctx = out.getContext('2d');
            if (doc) ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.1)';
            ctx.drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
            done(await canvasBlob(out, 'image/jpeg', doc ? 0.8 : 0.86));
        };

        // ---- dragging the box (move) or a handle (resize), mouse and touch alike
        boxEl.addEventListener('pointerdown', e => {
            e.preventDefault();
            const handle = e.target.dataset.h || 'move';
            const rect = frame.getBoundingClientRect();
            const start = { ...box }, px = e.clientX, py = e.clientY;
            const min = 0.05;
            boxEl.setPointerCapture(e.pointerId);
            const move = ev => {
                const dx = (ev.clientX - px) / rect.width, dy = (ev.clientY - py) / rect.height;
                let { x, y, w, h } = start;
                if (handle === 'move') {
                    x = Math.min(Math.max(0, x + dx), 1 - w);
                    y = Math.min(Math.max(0, y + dy), 1 - h);
                } else {
                    if (handle.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
                    if (handle.includes('e')) w = Math.min(Math.max(min, w + dx), 1 - x);
                    if (handle.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
                    if (handle.includes('s')) h = Math.min(Math.max(min, h + dy), 1 - y);
                }
                box = { x, y, w, h };
                draw();
            };
            const up = () => { boxEl.removeEventListener('pointermove', move); boxEl.removeEventListener('pointerup', up); };
            boxEl.addEventListener('pointermove', move);
            boxEl.addEventListener('pointerup', up);
        });
        el.addEventListener('click', e => {
            const b = e.target.closest('[data-x]');
            if (!b) return;
            const x = b.dataset.x;
            if (x === 'left') rotate(-1);
            if (x === 'right') rotate(1);
            if (x === 'auto') auto();
            if (x === 'full') { box = { x: 0, y: 0, w: 1, h: 1 }; draw(); }
            if (x === 'doc') toggleDoc();
            if (x === 'cancel') done(null);
            if (x === 'retake') done('retake');
            if (x === 'apply') apply();
        });
        window.addEventListener('resize', fit, { once: true });
        show().then(() => setTimeout(auto, 50));   // start from a smart guess
    });
}

async function toCanvas(source) {
    const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
        bitmap = await loadImage(URL.createObjectURL(blob));
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas;
}

/**
 * Finds a receipt or page on a background: samples the border to learn the background brightness,
 * then takes the bounding box of everything that differs from it. Returns fractions, or null.
 */
function detectContent(canvas) {
    const n = 220;
    const scale = n / Math.max(canvas.width, canvas.height);
    const w = Math.max(8, Math.round(canvas.width * scale)), h = Math.max(8, Math.round(canvas.height * scale));
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const lum = (x, y) => { const i = (y * w + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    const border = [];
    for (let x = 0; x < w; x++) { border.push(lum(x, 0), lum(x, h - 1)); }
    for (let y = 0; y < h; y++) { border.push(lum(0, y), lum(w - 1, y)); }
    border.sort((a, b) => a - b);
    const bg = border[Math.floor(border.length / 2)];
    const spread = border[Math.floor(border.length * 0.9)] - border[Math.floor(border.length * 0.1)];
    const threshold = Math.max(28, spread * 0.9);
    // rows / columns where enough pixels differ from the background
    const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (Math.abs(lum(x, y) - bg) > threshold) { rows[y]++; cols[x]++; }
    }
    const first = (arr, limit) => arr.findIndex(v => v > limit);
    const last = (arr, limit) => arr.length - 1 - [...arr].reverse().findIndex(v => v > limit);
    const y0 = first(rows, w * 0.06), y1 = last(rows, w * 0.06), x0 = first(cols, h * 0.06), x1 = last(cols, h * 0.06);
    if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;
    const pad = 0.015;
    const box = { x: Math.max(0, x0 / w - pad), y: Math.max(0, y0 / h - pad) };
    box.w = Math.min(1, (x1 + 1) / w + pad) - box.x;
    box.h = Math.min(1, (y1 + 1) / h + pad) - box.y;
    // nothing to trim, or the "content" is a sliver: not a receipt on a background
    if (box.w * box.h > 0.93 || box.w < 0.15 || box.h < 0.15) return null;
    return box;
}

// ===================================================================== viewer

/**
 * Full-screen viewer for a list of attachments (AttachmentView[]).
 * options: { canEdit, onChanged(list) }
 */
export function openViewer(list, index = 0, { canEdit = false, onChanged } = {}) {
    let items = [...list];
    let i = index;
    let zoom = 1, rotation = 0, pan = { x: 0, y: 0 };
    const layer = overlay('ev-viewer', `
        <div class="evv-top">
            <div class="evv-title"><b data-name></b><small data-meta></small></div>
            <span class="spacer"></span>
            <button type="button" class="ev-round" data-v="out" title="Zoom out (−)">${icon('zoom-out')}</button>
            <span class="evv-zoom" data-zoom>100%</span>
            <button type="button" class="ev-round" data-v="in" title="Zoom in (+)">${icon('zoom-in')}</button>
            <button type="button" class="ev-round" data-v="rotate" title="Rotate (R)">${icon('rotate-cw')}</button>
            <button type="button" class="ev-round" data-v="download" title="Download">${icon('download')}</button>
            ${canEdit ? `<button type="button" class="ev-round danger" data-v="delete" title="Delete">${icon('trash')}</button>` : ''}
            <button type="button" class="ev-round" data-v="close" title="Close (Esc)">${icon('x')}</button>
        </div>
        <div class="evv-stage" data-stage></div>
        <button type="button" class="evv-nav prev" data-v="prev" title="Previous (←)">${icon('chevron-left')}</button>
        <button type="button" class="evv-nav next" data-v="next" title="Next (→)">${icon('chevron-right')}</button>
        <div class="evv-bottom">
            <input class="evv-caption" data-caption maxlength="200" placeholder="${canEdit ? 'Add a caption, e.g. “Bill for 2 shirts, warranty 1 year”' : ''}" ${canEdit ? '' : 'readonly'}>
            <div class="evv-strip" data-strip></div>
        </div>`, e => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
        else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
        else if (e.key === '-') setZoom(zoom / 1.25);
        else if (e.key === '0') { pan = { x: 0, y: 0 }; setZoom(1); }
        else if (e.key.toLowerCase() === 'r') { rotation = (rotation + 90) % 360; apply(); }
        else return false;
    });
    const el = layer.el;
    const stage = el.querySelector('[data-stage]');
    const caption = el.querySelector('[data-caption]');
    const close = () => { layer.close(); onChanged?.(items); };

    const apply = () => {
        const media = stage.querySelector('img');
        if (media) media.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`;
        el.querySelector('[data-zoom]').textContent = `${Math.round(zoom * 100)}%`;
    };
    const setZoom = z => { zoom = Math.min(8, Math.max(0.25, z)); if (zoom === 1) pan = { x: 0, y: 0 }; apply(); };
    const go = d => { if (items.length > 1) { i = (i + d + items.length) % items.length; show(); } };

    const show = async () => {
        const a = items[i];
        zoom = 1; rotation = 0; pan = { x: 0, y: 0 };
        el.querySelector('[data-name]').textContent = a.fileName;
        el.querySelector('[data-meta]').textContent = [
            `${i + 1} of ${items.length}`, sizeLabel(a.sizeBytes), a.width ? `${a.width} × ${a.height}` : null,
            { CAMERA: 'camera', PASTE: 'pasted', UPLOAD: 'uploaded' }[a.source], `${dateTime(a.createdAt)} by ${a.createdBy}`,
        ].filter(Boolean).join(' · ');
        caption.value = a.caption || '';
        el.querySelectorAll('.evv-nav').forEach(b => { b.hidden = items.length < 2; });
        el.querySelectorAll('[data-v="in"],[data-v="out"],[data-v="rotate"],[data-zoom]').forEach(b => { b.hidden = !a.image; });
        stage.innerHTML = '<div class="spinner"></div>';
        try {
            const url = await fileUrl(a.id, false);
            if (items[i] !== a) return;
            stage.innerHTML = a.image ? `<img src="${url}" alt="${esc(a.fileName)}" draggable="false">`
                : `<iframe src="${url}" title="${esc(a.fileName)}"></iframe>`;
            apply();
        } catch (error) {
            stage.innerHTML = `<div class="evv-error">${icon('alert-circle')}${esc(error.message)}</div>`;
            hydrateIcons(stage);
        }
        strip();
    };
    const strip = () => {
        const host = el.querySelector('[data-strip]');
        host.innerHTML = items.length < 2 ? '' : items.map((a, k) => `<button type="button" class="evv-thumb ${k === i ? 'active' : ''}" data-go="${k}">
            ${a.image ? `<img data-thumb="${a.id}" alt="">` : `<span class="ev-pdf">${icon('file-text')}PDF</span>`}</button>`).join('');
        hydrateIcons(host);
        host.querySelectorAll('[data-thumb]').forEach(img => fileUrl(img.dataset.thumb, true).then(u => { img.src = u; }).catch(() => {}));
    };

    // ---- zoom with the wheel, pan by dragging, double-click toggles 2x
    stage.addEventListener('wheel', e => { if (!items[i].image) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    stage.addEventListener('dblclick', () => setZoom(zoom > 1 ? 1 : 2));
    stage.addEventListener('pointerdown', e => {
        if (zoom <= 1 || !stage.querySelector('img')) return;
        const start = { ...pan }, px = e.clientX, py = e.clientY;
        stage.setPointerCapture(e.pointerId);
        stage.classList.add('panning');
        const move = ev => { pan = { x: start.x + ev.clientX - px, y: start.y + ev.clientY - py }; apply(); };
        const up = () => { stage.classList.remove('panning'); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
        stage.addEventListener('pointermove', move);
        stage.addEventListener('pointerup', up);
    });
    stage.addEventListener('click', e => { if (e.target === stage) close(); });

    caption.addEventListener('change', async () => {
        try {
            const saved = await api.put(`/attachments/${items[i].id}`, { caption: caption.value });
            items[i] = saved;
            toast('Caption saved', 'info');
        } catch (error) { toast(error.message, 'error'); }
    });
    el.addEventListener('click', async e => {
        const go2 = e.target.closest('[data-go]');
        if (go2) { i = Number(go2.dataset.go); show(); return; }
        const b = e.target.closest('[data-v]');
        if (!b) return;
        const v = b.dataset.v;
        if (v === 'close') close();
        if (v === 'prev') go(-1);
        if (v === 'next') go(1);
        if (v === 'in') setZoom(zoom * 1.25);
        if (v === 'out') setZoom(zoom / 1.25);
        if (v === 'rotate') { rotation = (rotation + 90) % 360; apply(); }
        if (v === 'download') {
            const blob = await api.blob(`/attachments/${items[i].id}/file`, { download: true });
            const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: items[i].fileName });
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        }
        if (v === 'delete' && await confirmDialog(`Delete "${items[i].fileName}"?`, { confirmLabel: 'Delete' })) {
            try {
                await api.del(`/attachments/${items[i].id}`);
                items.splice(i, 1);
                toast('Evidence deleted');
                if (!items.length) { close(); return; }
                i = Math.min(i, items.length - 1);
                show();
            } catch (error) { toast(error.message, 'error'); }
        }
    });
    show();
}

// ===================================================================== capture field (in dialogs)

export function evidenceFieldHtml({ label = 'Evidence', hint = 'Receipt, bill or screenshot' } = {}) {
    return `
    <div class="ev-field" data-ev-field>
        <div class="ev-field-head"><span class="section-title">${icon('paperclip')} ${esc(label)} <small class="muted">optional</small></span>
            <span class="small muted ev-hint">${esc(hint)} · paste or drop here</span></div>
        <div class="ev-tiles" data-ev-tiles>
            <button type="button" class="ev-add" data-ev="camera" title="Take a photo">${icon('camera')}<span>Camera</span></button>
            <button type="button" class="ev-add" data-ev="upload" title="Photos or PDFs">${icon('upload')}<span>Upload</span></button>
        </div>
    </div>`;
}

/**
 * Wires a capture field inside `root` (a form or dialog). Returns the pending files and uploadTo(entryId).
 * Paste (Ctrl+V) anywhere in the dialog and drag & drop onto it also add files.
 */
export function bindEvidenceField(root) {
    const field = root.querySelector('[data-ev-field]');
    const pending = [];   // { blob, name, source, url }
    if (!field) return { get count() { return 0; }, uploadTo: async () => 0 };
    const tiles = field.querySelector('[data-ev-tiles]');
    const dialog = field.closest('.modal') || root;

    const render = () => {
        tiles.querySelectorAll('.ev-tile').forEach(t => t.remove());
        pending.forEach((p, k) => {
            const tile = document.createElement('div');
            tile.className = 'ev-tile';
            tile.innerHTML = `${p.blob.type === 'application/pdf' ? `<span class="ev-pdf">${icon('file-text')}PDF</span>` : `<img src="${p.url}" alt="">`}
                <span class="ev-tile-name">${esc(p.name)}</span>
                <span class="ev-tile-actions">${p.blob.type.startsWith('image/') && p.blob.type !== 'image/gif'
                    ? `<button type="button" data-ev-crop="${k}" title="Crop / rotate">${icon('crop')}</button>` : ''}
                    <button type="button" data-ev-remove="${k}" title="Remove">${icon('x')}</button></span>`;
            tiles.insertBefore(tile, tiles.querySelector('[data-ev="camera"]'));
        });
        hydrateIcons(tiles);
        field.classList.toggle('has-files', pending.length > 0);
    };
    const add = async (blob, name, source) => {
        if (!blob) return;
        if (!ACCEPT.split(',').includes(blob.type)) { toast(`${name || 'That file'} is not a photo or PDF`, 'error'); return; }
        const ready = await prepare(blob);
        if (ready.size > MAX_BYTES) { toast(`${name} is larger than 10 MB`, 'error'); return; }
        pending.push({ blob: ready, name: renamed(name, ready), source, url: URL.createObjectURL(ready) });
        render();
    };
    const addFiles = async (files, source) => {
        for (const f of files) await add(f, f.name, source);
    };

    field.addEventListener('click', async e => {
        const b = e.target.closest('[data-ev], [data-ev-crop], [data-ev-remove]');
        if (!b) return;
        e.preventDefault();
        if (b.dataset.ev === 'camera') {
            const shot = await openCamera();
            if (shot) await add(shot, `Photo ${stamp()}.jpg`, 'CAMERA');
        }
        if (b.dataset.ev === 'upload') await addFiles(await pickFiles({ multiple: true }), 'UPLOAD');
        if (b.dataset.evRemove !== undefined) {
            const [p] = pending.splice(Number(b.dataset.evRemove), 1);
            URL.revokeObjectURL(p.url);
            render();
        }
        if (b.dataset.evCrop !== undefined) {
            const p = pending[Number(b.dataset.evCrop)];
            const edited = await openCropper(p.blob);
            if (edited) { URL.revokeObjectURL(p.url); Object.assign(p, { blob: edited, name: renamed(p.name, edited), url: URL.createObjectURL(edited) }); render(); }
        }
    });
    dialog.addEventListener('paste', e => {
        if (!field.isConnected) return;   // replaced (e.g. the dialog switched tabs)
        const files = [...(e.clipboardData?.files || [])];
        if (!files.length) return;
        e.preventDefault();
        addFiles(files.map((f, k) => f.name && f.name !== 'image.png' ? f : new File([f], `Pasted ${stamp()}${k ? ' ' + (k + 1) : ''}.png`, { type: f.type })), 'PASTE');
    });
    dialog.addEventListener('dragover', e => { if (field.isConnected && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); field.classList.add('drop'); } });
    dialog.addEventListener('dragleave', e => { if (!dialog.contains(e.relatedTarget)) field.classList.remove('drop'); });
    dialog.addEventListener('drop', e => {
        if (!field.isConnected || !e.dataTransfer?.files?.length) return;
        e.preventDefault();
        field.classList.remove('drop');
        addFiles([...e.dataTransfer.files], 'UPLOAD');
    });

    return {
        get count() { return pending.length; },
        /**
         * Uploads the pending files to a saved entry (or, with { pendingId }, to an entry waiting for approval);
         * failures are reported, the entry stays saved.
         */
        async uploadTo(entryId, { pendingId, giftId, documentId } = {}) {
            const target = entryId ? ['entryId', entryId] : pendingId ? ['pendingId', pendingId] : giftId ? ['giftId', giftId] : documentId ? ['documentId', documentId] : null;
            if (!pending.length || !target) return 0;
            let done = 0;
            for (const p of [...pending]) {
                const form = new FormData();
                form.append(target[0], target[1]);
                form.append('source', p.source);
                form.append('file', p.blob, p.name);
                try {
                    await api.upload('/attachments', form);
                    done++;
                    pending.splice(pending.indexOf(p), 1);
                    URL.revokeObjectURL(p.url);
                } catch (error) {
                    toast(`Saved, but ${p.name} was not attached: ${error.message}`, 'error');
                }
            }
            render();
            if (done) toast(`${done} file${done === 1 ? '' : 's'} attached as evidence`, 'info');
            return done;
        },
    };
}

/** 📎 with the count, for list rows. */
export function evidenceBadge(count) {
    return count ? `<span class="ev-badge" title="${count} attachment${count === 1 ? '' : 's'}">${icon('paperclip')}${count > 1 ? count : ''}</span>` : '';
}

// ===================================================================== strip (expanded rows)

/**
 * Fills <div data-ev-entry="id"> with the entry's evidence: compact thumbnails, click to view, add in place.
 * Placeholders are picked up automatically as soon as they appear on the page.
 */
async function hydrate(host) {
    if (host.dataset.evReady) return;
    host.dataset.evReady = '1';
    host.classList.add('ev-strip');
    // an entry, or an entry still waiting for approval (data-ev-pending)
    const entryId = host.dataset.evEntry;
    const key = entryId ? { entryId } : host.dataset.evGift ? { giftId: host.dataset.evGift }
        : host.dataset.evDoc ? { documentId: host.dataset.evDoc } : { pendingId: host.dataset.evPending };
    const canEdit = can('POST_TRANSACTIONS') && (entryId || host.dataset.evGift || host.dataset.evDoc || host.dataset.evEditable === '1');
    let list = [];
    const draw = () => {
        if (!list.length && !canEdit) { host.innerHTML = ''; host.hidden = true; return; }
        host.hidden = false;
        if (!list.length) {
            // nothing attached: one small button; the camera / upload choices appear on click
            host.innerHTML = `<button type="button" class="ev-attach" data-ev-reveal title="Attach a photo, scan or PDF">${icon('paperclip')}Attach</button>
                <span class="ev-attach-opts" hidden>
                    <button type="button" class="ev-mini add" data-ev-add="camera" title="Take a photo">${icon('camera')}</button>
                    <button type="button" class="ev-mini add" data-ev-add="upload" title="Upload photos or PDFs">${icon('upload')}</button></span>`;
            hydrateIcons(host);
            return;
        }
        host.innerHTML = `
            <span class="ev-strip-label">${icon('paperclip')}Evidence <b>${list.length}</b></span>
            ${list.map((a, k) => `<button type="button" class="ev-mini" data-ev-open="${k}" title="${esc(a.caption || a.fileName)}">
                ${a.image && a.hasThumbnail ? `<img data-thumb="${a.id}" alt="">` : a.image ? `<img data-full="${a.id}" alt="">` : `<span class="ev-pdf">${icon('file-text')}PDF</span>`}</button>`).join('')}
            ${canEdit ? `<button type="button" class="ev-mini add" data-ev-add="camera" title="Take a photo">${icon('camera')}</button>
                <button type="button" class="ev-mini add" data-ev-add="upload" title="Upload photos or PDFs">${icon('upload')}</button>` : ''}`;
        hydrateIcons(host);
        host.querySelectorAll('[data-thumb], [data-full]').forEach(img =>
            fileUrl(img.dataset.thumb || img.dataset.full, !!img.dataset.thumb).then(u => { img.src = u; }).catch(() => {}));
    };
    const reload = async () => {
        try { list = await api.get('/attachments', key); } catch { list = []; }
        draw();
    };
    const upload = async (blob, name, source) => {
        const ready = await prepare(blob);
        const form = new FormData();
        Object.entries(key).forEach(([k, v]) => form.append(k, v));
        form.append('source', source);
        form.append('file', ready, renamed(name, ready));
        await api.upload('/attachments', form);
    };
    host.addEventListener('click', async e => {
        const reveal = e.target.closest('[data-ev-reveal]');
        if (reveal) { e.stopPropagation(); reveal.hidden = true; host.querySelector('.ev-attach-opts').hidden = false; return; }
        const open = e.target.closest('[data-ev-open]');
        const add = e.target.closest('[data-ev-add]');
        if (!open && !add) return;
        e.stopPropagation();
        if (open) openViewer(list, Number(open.dataset.evOpen), { canEdit, onChanged: items => { list = items; draw(); } });
        if (add) {
            try {
                if (add.dataset.evAdd === 'camera') {
                    const shot = await openCamera();
                    if (shot) await upload(shot, `Photo ${stamp()}.jpg`, 'CAMERA');
                } else {
                    for (const f of await pickFiles({ multiple: true })) await upload(f, f.name, 'UPLOAD');
                }
                await reload();
                toast('Evidence attached', 'info');
            } catch (error) { toast(error.message, 'error'); }
        }
    });
    // the page already knows how many files the entry has: with none there is nothing to ask the server for
    if (host.dataset.evCount === '0') { draw(); return; }
    await reload();
}

function scan(root) {
    root.querySelectorAll?.(':is([data-ev-entry], [data-ev-pending], [data-ev-gift], [data-ev-doc]):not([data-ev-ready])').forEach(hydrate);
}

new MutationObserver(records => {
    for (const r of records) r.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('[data-ev-entry], [data-ev-pending], [data-ev-gift], [data-ev-doc]')) hydrate(n); scan(n); } });
}).observe(document.body, { childList: true, subtree: true });
