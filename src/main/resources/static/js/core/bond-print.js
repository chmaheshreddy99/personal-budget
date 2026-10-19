/**
 * The print view of an agreement: the deed (bondBlocks in bond.js) laid out on A4 sheets here, before printing, so
 * the browser never decides where a page breaks or how big anything is. Each block is measured at its printed size
 * and packed onto sheets of a fixed size: a clause, a table row, a signature block or an ID image is never cut in two,
 * a heading stays with what follows it, every annexure starts on a sheet of its own, and an ID image is sized from its
 * real proportions to fill the width (sharp enough to read) or, when too tall, a sheet of its own. Every sheet carries
 * the agreement number, its page number and the parties' signatures and seal.
 *
 * Adjustable: the paper (stamp-paper style on A4, or real stamp paper: a legal-size first sheet with its printed top
 * left blank), text size, line spacing, margins, the size of ID proofs, the signature strip, and page breaks by hand
 * (hover a paragraph: "New page here"). The choices other than the breaks are remembered on this device.
 *
 *   openPrintView(doc, title)    shows it over the page; Print prints the sheets exactly as shown
 */
import { esc, bondBlocks, figureHtml, signatureSvg, sealSvg } from './bond.js';

const MM = 96 / 25.4;
/** top, right, bottom, left (mm); left is wider for binding, as deeds are bound on the left */
const MARGINS = { narrow: [12, 14, 12, 18], normal: [16, 18, 14, 24], wide: [22, 22, 18, 30] };
const HEAD = 7, FOOT_STRIP = 24, FOOT_PLAIN = 6, SLACK = 2.5;
const ID_SIZES = { large: 1, medium: 0.75, small: 0.55 };
const PREF = 'pb.bondPrint';
const DEFAULTS = { pt: 12, lh: 1.5, margin: 'normal', ids: 'large', strip: true };

function loadPrefs() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function savePrefs(o) {
    try { localStorage.setItem(PREF, JSON.stringify({ pt: o.pt, lh: o.lh, margin: o.margin, ids: o.ids, strip: o.strip })); } catch { /* not kept */ }
}

/** The sheet: its size and padding (mm); the first sheet on real stamp paper is legal size with its printed top left blank. */
function geometry(o, legal) {
    const [t, r, b, l] = MARGINS[o.margin] || MARGINS.normal;
    return legal ? { w: 216, h: 356, pad: [118, r + 3, b, l + 3] } : { w: 210, h: 297, pad: [t, r, b, l] };
}
const bodyHeight = (g, o) => g.h - g.pad[0] - g.pad[2] - HEAD - (o.strip ? FOOT_STRIP : FOOT_PLAIN) - SLACK;
const contentWidth = g => g.w - g.pad[1] - g.pad[3];

/** Measures blocks at their printed size, off screen (mm). */
function measurer(o, width) {
    const box = document.createElement('div');
    box.className = 'bp-body bp-measure';
    box.style.cssText = `position:absolute;left:-30000px;top:0;width:${width}mm;height:auto;visibility:hidden;--bp-pt:${o.pt}pt;--bp-lh:${o.lh}`;
    document.body.append(box);
    return {
        height(html) {
            box.innerHTML = `<div class="bp-blk">${html}</div>`;
            return box.firstElementChild.getBoundingClientRect().height / MM;
        },
        done: () => box.remove(),
    };
}

/** An ID image sized for the sheet: full width (or the size chosen), never taller than a sheet can hold with its caption. */
function sizedImage(im, width, cap, o) {
    if (im.pdf || !im.ratio) return figureHtml(im);
    const share = im.photo ? Math.min(0.5, ID_SIZES[o.ids]) : ID_SIZES[o.ids] || 1;
    let w = width * share - 3;                 // the figure's padding and border
    let h = w * im.ratio;
    const room = cap - 30;                     // its caption, and the annexure's heading when it is the first
    if (h > room) { h = room; w = h / im.ratio; }
    return figureHtml(im, { width: w, height: h });
}

/**
 * The sheets: [{ legal, g, cap, items: [{ id, html }], over }]. breaks: ids of blocks that start a new sheet.
 */
function paginate(doc, o, breaks) {
    const { front, annexures } = bondBlocks(doc);
    const real = !!doc.realStampPaper;
    const width = contentWidth(geometry(o, false));
    const m = measurer(o, width);
    const pages = [];
    let page = null;
    const open = () => {
        const legal = real && pages.length === 0;
        const g = geometry(o, legal);
        page = { legal, g, cap: bodyHeight(g, o), used: 0, items: [] };
        pages.push(page);
    };
    const put = (id, html, h) => {
        page.items.push({ id, html });
        page.used += h;
        if (page.used > page.cap + 0.5) page.over = true;
    };
    try {
        const sections = [{ blocks: front }, ...annexures.map(x => ({ blocks: x.blocks, annex: x }))];
        for (const sec of sections) {
            if (!page || (sec.annex && page.used > 0)) open();
            const cap = page.cap;
            const blocks = sec.blocks.map(b => ({ ...b, html: b.image ? sizedImage(b.image, width, cap, o) : b.html }));
            blocks.forEach(b => { b.h = m.height(b.html); });
            for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i];
                // a block marked keep stays with the one after it (a heading with its first paragraph, the closing words
                // with the signatures): the run is moved whole when it does not fit
                let need = b.h;
                for (let j = i; blocks[j]?.keep && blocks[j + 1]; j++) need += blocks[j + 1].h;
                need = Math.min(need, page.cap);
                if (page.used > 0 && (breaks.has(b.id) || page.used + need > page.cap)) {
                    open();
                    if (sec.annex && i > 0) {
                        const html = `<h2 class="bond-annex-h cont">Annexure ${esc(sec.annex.letter)} · ${esc(sec.annex.title)} (continued)</h2>`;
                        put(`${sec.annex.letter}-cont`, html, m.height(html));
                    }
                }
                put(b.id, b.html, b.h);
            }
        }
    } finally {
        m.done();
    }
    return pages;
}

/** The signatures and seal at the foot of every sheet: the deed is signed on each page, as one executed on stamp paper. */
function stripHtml(doc) {
    const f = doc.firstParty || {}, s = doc.secondParty || {}, w = doc.witness || {};
    const cell = (p, label, seal = null) => `<div class="bp-sg"><div class="bp-sg-ink">${p.signature ? signatureSvg(p.signature) : ''}${seal
        ? `<span class="bp-seal">${sealSvg(seal, 'SEAL')}</span>` : ''}</div><small>${esc(label)}</small></div>`;
    const t = doc.thirdParty?.name ? doc.thirdParty : null;
    return `<div class="bp-strip ${t ? 'four' : ''}">${cell(f, `${f.term || f.role || 'First party'} · signature${f.seal ? ' & seal' : ''}`, f.seal)}${
        cell(s, `${s.term || s.role || 'Second party'} · ${s.signature ? 'signature' : 'signature / thumb'}`)}${t ? cell(t, `${t.term || t.role} · signature`) : ''}${cell(w, 'Witness · signature')}</div>`;
}

function sheetsHtml(pages, doc, o, { editable = false, breaks = new Set() } = {}) {
    const n = pages.length;
    const strip = o.strip ? stripHtml(doc) : '';
    return pages.map((p, i) => {
        const [t, r, b, l] = p.g.pad;
        const blocks = p.items.map((it, k) => {
            const manual = breaks.has(it.id) && k === 0;
            const tool = editable && !/-cont$/.test(it.id) && (k > 0 || manual)
                ? `<button type="button" class="bp-brk ${manual ? 'on' : ''}" data-brk="${esc(it.id)}">${manual ? '✕ Remove this page break' : '⤓ New page here'}</button>` : '';
            return `<div class="bp-blk" data-blk="${esc(it.id)}">${tool}${it.html}</div>`;
        }).join('');
        return `<section class="bp-sheet ${p.legal ? 'legal' : ''} ${p.over ? 'over' : ''}" style="width:${p.g.w}mm;height:${(p.g.h - 0.4).toFixed(1)}mm;padding:${t}mm ${r}mm ${b}mm ${l}mm;--bp-pt:${o.pt}pt;--bp-lh:${o.lh}">
            ${p.legal ? `<div class="bp-blank" style="height:${t - 4}mm"><span>Printed area of the stamp paper — left blank</span></div>` : ''}
            <header class="bp-head"><span>${esc(doc.title || 'Agreement')}${doc.number ? ` · ${esc(doc.number)}` : ''}</span><span>Page ${i + 1} of ${n}</span></header>
            <div class="bp-body" style="height:${(p.cap + SLACK).toFixed(2)}mm">${blocks}</div>
            <footer class="bp-foot ${o.strip ? '' : 'plain'}">${strip}<span class="bp-pno">${esc(doc.number || '')} · page ${i + 1} of ${n}</span></footer>
        </section>`;
    }).join('');
}

/** Proportions of the ID images (height / width), so they can be sized before anything is printed. */
async function withRatios(doc) {
    const annexures = await Promise.all((doc.annexures || []).map(async a => ({
        ...a,
        images: await Promise.all((a.images || []).map(im => new Promise(resolve => {
            if (im.pdf || !im.src) { resolve(im); return; }
            const img = new Image();
            img.onload = () => resolve({ ...im, ratio: img.naturalWidth ? img.naturalHeight / img.naturalWidth : null,
                photo: im.photo || /photograph/i.test(a.title || '') });
            img.onerror = () => resolve({ ...im, pdf: true });
            img.src = im.src;
        }))),
    })));
    return { ...doc, annexures };
}

function printSheets(html, title) {
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
        <link rel="stylesheet" href="${location.origin}/css/bond.css">
        <style>@page { size: 210mm 297mm; margin: 0; } @page stampsheet { size: 216mm 356mm; margin: 0; }
            html, body { margin: 0; padding: 0; background: #fff; } .bp-sheet.legal { page: stampsheet; }</style>
        </head><body class="bp-print">${html}</body></html>`;
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return false;
    win.document.write(page);
    win.document.close();
    const go = () => {
        const imgs = [...win.document.images];
        Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })))
            .then(() => (win.document.fonts?.ready || Promise.resolve()))
            .then(() => setTimeout(() => win.print(), 200));
    };
    if (win.document.readyState === 'complete') go(); else win.addEventListener('load', go);
    return true;
}

export async function openPrintView(source, title) {
    const doc0 = await withRatios(source);
    const o = loadPrefs();
    let real = !!doc0.realStampPaper;
    const breaks = new Set();
    const layer = document.createElement('div');
    layer.className = 'bp-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Print view');
    const opt = (v, label, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
    layer.innerHTML = `<div class="bp-bar">
            <div class="bp-bar-title"><b>Print view</b><small data-meta></small></div>
            <label>Paper<select data-o="paper">${opt('style', 'A4 · stamp-paper style', real ? 'real' : 'style')}${opt('real', 'Real stamp paper (1st sheet legal)', real ? 'real' : 'style')}</select></label>
            <label>Text<select data-o="pt">${[11, 12, 13, 14].map(v => opt(v, `${v} pt`, o.pt)).join('')}</select></label>
            <label>Spacing<select data-o="lh">${[[1.15, 'Single'], [1.5, '1.5 lines'], [2, 'Double']].map(([v, l]) => opt(v, l, o.lh)).join('')}</select></label>
            <label>Margins<select data-o="margin">${[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']].map(([v, l]) => opt(v, l, o.margin)).join('')}</select></label>
            <label>ID proofs<select data-o="ids">${[['large', 'Large (full width)'], ['medium', 'Medium'], ['small', 'Small']].map(([v, l]) => opt(v, l, o.ids)).join('')}</select></label>
            <label class="bp-check"><input type="checkbox" data-o="strip" ${o.strip ? 'checked' : ''}>Sign & seal on every page</label>
            <div class="bp-bar-acts">
                <button type="button" data-act="auto" title="Undo the page breaks made by hand">Auto layout</button>
                <button type="button" class="primary" data-act="print">Print / Save PDF</button>
                <button type="button" data-act="close" aria-label="Close the print view">Close</button>
            </div>
        </div>
        <p class="bp-tip">The pages are fixed here and print exactly as shown: in the print dialog keep <b>Margins: Default</b> and <b>Scale: 100%</b>
            (and choose legal paper for the first sheet when printing on real stamp paper). Hover (or tap, on a phone) a paragraph for “New page here”.</p>
        <div class="bp-scroll"><div class="bp-pages"></div></div>`;
    document.body.append(layer);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const holder = layer.querySelector('.bp-pages');
    const scroller = layer.querySelector('.bp-scroll');
    let pages = [];
    const doc = () => ({ ...doc0, realStampPaper: real });
    const fit = () => {
        const avail = scroller.clientWidth - 24;
        holder.style.zoom = String(Math.min(1, avail / (216 * MM)));
    };
    const draw = () => {
        pages = paginate(doc(), o, breaks);
        holder.innerHTML = sheetsHtml(pages, doc(), o, { editable: true, breaks });
        const over = pages.filter(p => p.over).length;
        layer.querySelector('[data-meta]').textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · ${real ? 'legal + A4' : 'A4'}`
            + (breaks.size ? ` · ${breaks.size} page break${breaks.size === 1 ? '' : 's'} by hand` : '') + (over ? ' · a block is taller than a page' : '');
        fit();
    };
    const close = () => {
        layer.remove();
        document.body.style.overflow = overflow;
        removeEventListener('resize', fit);
        document.removeEventListener('keydown', onKey, true);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', fit);
    layer.addEventListener('change', e => {
        const k = e.target.dataset.o;
        if (!k) return;
        if (k === 'paper') real = e.target.value === 'real';
        else if (k === 'strip') o.strip = e.target.checked;
        else o[k] = ['pt', 'lh'].includes(k) ? Number(e.target.value) : e.target.value;
        savePrefs(o);
        draw();
    });
    layer.addEventListener('click', e => {
        const brk = e.target.closest('[data-brk]');
        if (brk) {
            const id = brk.dataset.brk;
            if (breaks.has(id)) breaks.delete(id); else breaks.add(id);
            draw();
            return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') close();
        else if (act === 'auto') { breaks.clear(); draw(); }
        else if (act === 'print') {
            const html = sheetsHtml(pages, doc(), o);
            if (!printSheets(html, title || doc0.title || 'Agreement')) {
                layer.querySelector('.bp-tip').innerHTML = '<b class="bp-warn">Allow pop-ups for this site to print the agreement, then press Print again.</b>';
            }
        }
    });
    draw();
    // the fonts may still be arriving on a first open: measure again once they are in
    document.fonts?.ready.then(() => { if (layer.isConnected) draw(); });
    return { close };
}
