/**
 * The page behind a document share link (/share.html#<token>): no sign-in, only the token. Shows who shared what,
 * until when, and the scans: images inline (tap to enlarge), PDFs to open; downloads only when allowed. The token is
 * in the address fragment, so it is never sent to the server in a page request or kept in a referrer.
 */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const token = location.hash.slice(1);
const base = `/api/public/shares/${encodeURIComponent(token)}`;

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    let doc;
    try {
        const r = await fetch(base, { method: 'POST', headers: { Accept: 'application/json' } });   // POST: the view is counted
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message || 'This link does not work any more.');
        doc = body;
    } catch (error) { main.innerHTML = message(error.message); return; }

    const files = await Promise.all(doc.files.map(async f => {
        if (!f.image) return { ...f, url: null };
        const b = await fetch(`${base}/files/${f.id}`).then(r => r.ok ? r.blob() : null).catch(() => null);
        return { ...f, url: b ? URL.createObjectURL(b) : null };
    }));
    document.title = `${doc.title} · shared document`;
    main.innerHTML = `
        <section class="sh-card">
            <div class="sh-head"><div><small>${esc(doc.owner)}</small><h1>${esc(doc.title)}</h1></div>
                <span class="sh-badge">${doc.allowDownload ? 'view & download' : 'view only'}</span></div>
            <p class="sh-meta">Shared by <b>${esc(doc.sharedBy)}</b>${doc.sharedWith ? ` with <b>${esc(doc.sharedWith)}</b>` : ''} · available until <b>${when(doc.expiresAt)}</b></p>
        </section>
        <section class="sh-files">${files.map(f => f.image
            ? `<figure class="sh-file ${doc.allowDownload ? '' : 'protect'}"><img src="${f.url || ''}" alt="${esc(f.fileName)}" data-zoom draggable="false">
                <figcaption><span>${esc(f.fileName)}</span>${doc.allowDownload ? `<a href="${base}/files/${f.id}?download=true" download>Download</a>` : ''}</figcaption>
                ${doc.allowDownload ? '' : `<span class="sh-mark">Shared with ${esc(doc.sharedWith || 'you')} · ${when(new Date().toISOString())}</span>`}</figure>`
            : `<figure class="sh-file pdf"><div class="sh-pdf">PDF</div><figcaption><span>${esc(f.fileName)}</span>
                <a href="${base}/files/${f.id}" target="_blank" rel="noopener">Open</a>${doc.allowDownload ? `<a href="${base}/files/${f.id}?download=true" download>Download</a>` : ''}</figcaption></figure>`).join('')}</section>`;
    main.addEventListener('click', e => {
        const img = e.target.closest('[data-zoom]');
        if (img) img.closest('.sh-file').classList.toggle('zoomed');
    });
    if (!doc.allowDownload) main.addEventListener('contextmenu', e => { if (e.target.closest('.protect')) e.preventDefault(); });
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Not available</h1><p>${esc(text)}</p><p class="sh-meta">Ask the person who shared it for a new link.</p></section>`;
}

start();
