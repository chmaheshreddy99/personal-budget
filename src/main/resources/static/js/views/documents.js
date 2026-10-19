/**
 * Documents (#/documents): scanned documents of the family, kept safe and ready to share.
 *   top     how many documents and people, what expires soon or has expired, open share links, missing scans
 *   left    the family: each person with their documents count and what essential ones are missing;
 *           ↑ / ↓ moves through it, Esc goes back to everyone
 *   middle  the documents in one-line rows like Expenses (type, title and whose, number masked until revealed,
 *           validity, scans); a row opens a compact detail with the actions and the scans. "Cards" shows the
 *           scans as thumbnails instead.
 *   right   what needs attention (expiring, expired, no scan) and a checklist of essentials per person
 * Sharing: a temporary link (valid for hours or days, view only or with download, revocable, views counted) that
 * can be copied, scanned or sent by WhatsApp / e-mail; or the file itself through the phone's share sheet.
 * Quick work: drop photos / PDFs on a row or card to add scans, sort by what expires first, "Renew" on an expired or
 * expiring document; the form offers the common types and the family as one-click chips, fills the relation,
 * and checks the number's format (Aadhaar, PAN, passport, voter ID, driving licence).
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { panel, esc, emptyState, toast, confirmDialog, openModal, field, readForm } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { date, dateTime, daysFromToday } from '../core/format.js';
import { evidenceFieldHtml, bindEvidenceField, openViewer, fileUrl } from '../components/evidence.js';
import { qrSvg } from '../core/qr.js';
import { setPageKeys, listNavigator, isTyping } from '../core/keys.js';

export const DOC_TYPES = {
    AADHAAR: ['Aadhaar card', 'shield', 'ocean'], PAN: ['PAN card', 'card', 'violet'], PASSPORT: ['Passport', 'plane', 'aqua'],
    VOTER_ID: ['Voter ID', 'flag', 'coral'], DRIVING_LICENCE: ['Driving licence', 'car', 'gold'], RATION_CARD: ['Ration card', 'home', 'gray'],
    BIRTH_CERT: ['Birth certificate', 'heart', 'red'], MARRIAGE_CERT: ['Marriage certificate', 'heart', 'violet'],
    EDUCATION: ['Educational certificate', 'briefcase', 'ocean'], BANK_PASSBOOK: ['Bank passbook', 'bank', 'aqua'],
    PROPERTY: ['Property papers', 'building', 'gold'], VEHICLE_RC: ['Vehicle RC', 'car', 'gray'], INSURANCE: ['Insurance policy', 'shield', 'aqua'],
    MEDICAL: ['Medical record', 'heart', 'red'], EMPLOYMENT: ['Employment / payslips', 'briefcase', 'gray'], OTHER: ['Other', 'file-text', 'gray'],
};
/** What every adult usually needs at hand. */
const ESSENTIALS = ['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID', 'DRIVING_LICENCE'];
const RELATIONS = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];

const view = { owner: null, type: '', q: '', sort: 'expiry', open: null };
const LAYOUT_KEY = 'pb.documents.layout';
let layout = (() => { try { return localStorage.getItem(LAYOUT_KEY) === 'cards' ? 'cards' : 'list'; } catch { return 'list'; } })();

/** Usual number formats; a mismatch is only a warning (old cards, typos are worth a second look). */
const NUMBER_FORMATS = {
    AADHAAR: [/^\d{4}\s?\d{4}\s?\d{4}$/, '12 digits'],
    PAN: [/^[A-Z]{5}\d{4}[A-Z]$/i, '5 letters, 4 digits, 1 letter (ABCDE1234F)'],
    PASSPORT: [/^[A-Z]\d{7}$/i, '1 letter and 7 digits (A1234567)'],
    VOTER_ID: [/^[A-Z]{3}\d{7}$/i, '3 letters and 7 digits (ABC1234567)'],
    DRIVING_LICENCE: [/^[A-Z]{2}[\s-]?\d{2}[\s-]?\d{4}\s?\d{7}$/i, 'state code, RTO, year and number (TS09 2015 0012345)'],
};
const SORTS = { expiry: 'Expiring first', person: 'By person', recent: 'Recently added' };
const revealed = new Set();

export async function render(container, _params, isCurrent) {
    const docs = await api.get('/documents');
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const manage = can('POST_TRANSACTIONS');
    const owners = members(docs);
    if (view.owner && !owners.some(o => o.key === view.owner)) view.owner = null;
    const soon = docs.filter(d => d.expiresOn && daysFromToday(d.expiresOn) >= 0 && daysFromToday(d.expiresOn) <= 180);
    const expired = docs.filter(d => d.expiresOn && daysFromToday(d.expiresOn) < 0);
    const noScan = docs.filter(d => !d.fileCount);

    container.innerHTML = `
    <div class="page documents-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('file-text')} Documents</h2>
            <select id="dc-type" class="dc-type"><option value="">All types</option>${Object.entries(DOC_TYPES).map(([k, [l]]) =>
                `<option value="${k}" ${view.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span class="spacer"></span>
            <div class="search-box">${icon('search')}<input id="dc-q" placeholder="Search documents…" value="${esc(view.q)}" data-plain></div>
            <button class="btn sm ghost" id="dc-clear" hidden>${icon('x')}Clear filters</button>
            ${manage ? `<button class="btn primary" id="dc-add">${icon('plus')}Add document</button>` : ''}
        </div>
        <section class="gift-overview doc-overview">
            ${tile('file-text', 'Documents', String(docs.length), `${docs.reduce((s, d) => s + d.fileCount, 0)} scans`)}
            ${tile('users', 'People', String(owners.length), owners.map(o => o.name).slice(0, 3).join(', ') || '—')}
            ${tile('clock', 'Expiring in 6 months', String(soon.length), soon[0] ? `${esc(soon[0].title)} · ${date(soon[0].expiresOn)}` : 'nothing soon', soon.length ? 'attn' : '')}
            ${tile('alert-circle', 'Expired', String(expired.length), expired[0] ? esc(expired[0].title) : 'none', expired.length ? 'warn' : '')}
            ${tile('link', 'Shared now', String(docs.reduce((s, d) => s + d.activeShares, 0)), 'links that still work')}
            ${tile('camera', 'Without a scan', String(noScan.length), noScan.length ? 'add a photo or PDF' : 'all scanned')}
        </section>
        ${panel({ title: 'Family', iconName: 'users', cls: 'p-doc-people', bodyClass: 'flush', sub: `${owners.length}`,
            body: `${owners.length > 6 ? `<div class="gp-tools"><div class="search-box sm">${icon('search')}<input id="dc-pq" placeholder="Find a person…" data-plain></div></div>` : ''}
                <div class="list gp-list scroll" id="dc-people">
                <div class="list-item clickable gp-item everyone ${view.owner ? '' : 'selected'}" data-owner=""><span class="chip-icon sm">${icon('users')}</span>
                    <div class="grow"><div class="bn-row"><span class="title">Everyone</span><b class="bn-amt">${docs.length}</b></div>
                    <div class="bn-row meta"><span>${owners.length} people · all documents</span>${expired.length + soon.length ? `<span class="bn-left warn-txt">${expired.length + soon.length} to renew</span>` : ''}</div></div></div>
                ${memberGroups(owners)}</div>
                <div class="bn-empty" id="dc-pempty" hidden>${icon('search')}Nobody matches</div>
                <div class="bn-foot"><span class="kbd">↑</span><span class="kbd">↓</span> move · <span class="kbd">Esc</span> everyone · <span class="kbd">/</span> search</div>` })}
        ${panel({ title: 'All documents', iconName: 'file-text', cls: 'p-doc-list', bodyClass: 'flush',
            sub: '<span id="dc-count"></span>', actions: `<div class="seg-chips sm doc-sort" id="dc-sort">${Object.entries(SORTS).map(([k, l]) =>
                `<button class="seg-chip ${view.sort === k ? 'active' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
                <div class="seg-chips sm" id="dc-layout" title="Rows or cards with the scans">
                    <button class="seg-chip ${layout === 'list' ? 'active' : ''}" data-layout="list" title="Rows">${icon('list')}</button>
                    <button class="seg-chip ${layout === 'cards' ? 'active' : ''}" data-layout="cards" title="Cards with the scans">${icon('layers')}</button></div>`,
            body: `<div class="scroll" id="dc-grid"></div>` })}
        <aside class="gift-side">
            <section class="side-card"><div class="side-head">${icon('alert')}<b>Needs attention</b></div>${attention(soon, expired, noScan)}</section>
            <section class="side-card"><div class="side-head">${icon('check-circle')}<b>Essentials</b></div>${checklist(owners)}</section>
        </aside>
    </div>`;

    const $ = sel => container.querySelector(sel);
    const grid = $('#dc-grid');
    const peopleEl = $('#dc-people');
    const listed = () => {
        const q = view.q.toLowerCase();
        return docs.filter(d => (!view.owner || d.owner.toLowerCase() === view.owner) && (!view.type || d.docType === view.type)
            && (!q || `${d.title} ${d.owner} ${typeLabel(d.docType)} ${d.issuer || ''} ${d.notes || ''} ${d.docNumber || ''}`.toLowerCase().includes(q)))
            .sort(view.sort === 'person' ? (a, b) => a.owner.localeCompare(b.owner) || typeLabel(a.docType).localeCompare(typeLabel(b.docType))
                : view.sort === 'recent' ? (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id - a.id
                : (a, b) => (a.expiresOn || '9999').localeCompare(b.expiresOn || '9999') || a.owner.localeCompare(b.owner));
    };
    const drawList = () => {
        const list = listed();
        const o = view.owner ? owners.find(x => x.key === view.owner) : null;
        container.querySelector('.p-doc-list .panel-head h3').innerHTML = `<span class="ico">${icon(o ? 'user' : 'file-text')}</span>${esc(o ? o.name : 'All documents')}`;
        $('#dc-count').textContent = `${list.length}`;
        const empty = emptyState(docs.length ? 'Nothing matches' : 'Add your first document: Aadhaar, PAN, passport…', 'file-text');
        grid.innerHTML = !list.length ? empty : layout === 'cards'
            ? `<div class="doc-grid">${list.map(d => card(d, manage)).join('')}</div>`
            : `<table class="grid xp-table doc-table"><thead><tr><th class="c-type">Type</th><th class="c-desc">Document · whose</th><th class="c-num">Number</th>
                <th class="c-valid">Valid</th><th class="c-files">Scans</th><th class="c-caret"></th></tr></thead>
                <tbody>${list.map(d => row(d, manage)).join('')}</tbody></table>`;
        // thumbnails of the first scan
        grid.querySelectorAll('img[data-cover]').forEach(img => fileUrl(img.dataset.cover, true).then(u => { img.src = u; })
            .catch(() => fileUrl(img.dataset.cover, false).then(u => { img.src = u; }).catch(() => {})));
        if (view.open && layout === 'list') {
            const tr = grid.querySelector(`tr[data-doc="${view.open}"]`);
            if (tr) openRow(tr, false); else view.open = null;
        }
        $('#dc-clear').hidden = !(view.owner || view.type || view.q);
    };
    const pickOwner = key => {
        view.owner = key || null;
        view.open = null;
        peopleEl.querySelectorAll('[data-owner]').forEach(el => el.classList.toggle('selected', (el.dataset.owner || null) === view.owner));
        drawList();
    };
    function openRow(tr, toggle = true) {
        const next = tr.nextElementSibling;
        const wasOpen = next?.classList.contains('detail-row');
        grid.querySelectorAll('tr.detail-row').forEach(x => x.remove());
        grid.querySelectorAll('tr.expanded').forEach(x => x.classList.remove('expanded'));
        if (wasOpen && toggle) { view.open = null; return; }
        const d = docs.find(x => x.id === Number(tr.dataset.doc));
        view.open = d.id;
        tr.classList.add('expanded');
        tr.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="${tr.children.length}">${detailHtml(d, manage)}</td></tr>`);
    }

    const on = (sel, evt, fn) => $(sel)?.addEventListener(evt, fn);
    on('#dc-type', 'change', e => { view.type = e.target.value; drawList(); });
    on('#dc-sort', 'click', e => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        view.sort = b.dataset.sort;
        $('#dc-sort').querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('active', x === b));
        drawList();
    });
    on('#dc-layout', 'click', e => {
        const b = e.target.closest('[data-layout]');
        if (!b) return;
        layout = b.dataset.layout;
        try { localStorage.setItem(LAYOUT_KEY, layout); } catch { /* private mode */ }
        $('#dc-layout').querySelectorAll('[data-layout]').forEach(x => x.classList.toggle('active', x === b));
        drawList();
    });
    // drop photos / PDFs on a row or card: they are added to that document's scans
    if (manage) {
        const target = e => e.target.closest('[data-doc]');
        grid.addEventListener('dragover', e => {
            const el = target(e);
            if (!el || !e.dataTransfer?.types?.includes('Files')) return;
            e.preventDefault();
            grid.querySelectorAll('.drop-over').forEach(c => c !== el && c.classList.remove('drop-over'));
            el.classList.add('drop-over');
        });
        grid.addEventListener('dragleave', e => { const el = target(e); if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) el.classList.remove('drop-over'); });
        grid.addEventListener('drop', async e => {
            const el = target(e);
            if (!el || !e.dataTransfer?.files?.length) return;
            e.preventDefault();
            el.classList.remove('drop-over');
            const d = docs.find(x => x.id === Number(el.dataset.doc));
            const files = [...e.dataTransfer.files].filter(f => /^image\/|application\/pdf/.test(f.type));
            if (!files.length) { toast('Drop photos or PDFs', 'error'); return; }
            let done = 0;
            for (const f of files) {
                const form = new FormData();
                form.append('documentId', d.id);
                form.append('source', 'UPLOAD');
                form.append('file', f, f.name);
                try { await api.upload('/attachments', form); done++; } catch (error) { toast(`${f.name}: ${error.message}`, 'error'); }
            }
            if (done) { toast(`${done} scan${done === 1 ? '' : 's'} added to ${d.title} (${d.owner})`); reload(); }
        });
    }
    on('#dc-clear', 'click', () => {
        Object.assign(view, { owner: null, type: '', q: '', open: null });
        $('#dc-q').value = ''; $('#dc-type').value = '';
        $('#dc-type').dispatchEvent(new Event('change'));   // the enhanced dropdown shows the reset too
        pickOwner(null);
    });
    let t;
    on('#dc-q', 'input', e => { clearTimeout(t); t = setTimeout(() => { view.q = e.target.value.trim(); drawList(); }, 150); });
    on('#dc-add', 'click', () => openDocForm(null, docs, reload, view.owner ? owners.find(o => o.key === view.owner) : null));
    peopleEl.addEventListener('click', e => { const o = e.target.closest('[data-owner]'); if (o) pickOwner(o.dataset.owner); });
    container.querySelector('.gift-side').addEventListener('click', e => {
        const d = e.target.closest('[data-doc-open]');
        if (d) openDocument(docs.find(x => x.id === Number(d.dataset.docOpen)));
        const add = e.target.closest('[data-add-type]');
        if (add) openDocForm({ docType: add.dataset.addType, owner: add.dataset.addOwner, relation: add.dataset.addRelation, title: `${typeLabel(add.dataset.addType)}` }, docs, reload);
    });
    grid.addEventListener('click', async e => {
        const b = e.target.closest('[data-doc-act]');
        if (!b) {
            if (e.target.closest('.detail-row')) return;
            const tr = e.target.closest('tr[data-doc]');
            if (tr) openRow(tr);
            return;
        }
        e.stopPropagation();
        const d = docs.find(x => x.id === Number(b.dataset.id));
        const act = b.dataset.docAct;
        try {
            if (act === 'view') openDocument(d);
            if (act === 'reveal') {
                revealed.has(d.id) ? revealed.delete(d.id) : revealed.add(d.id);
                grid.querySelectorAll(`[data-doc-number="${d.id}"]`).forEach(el => { el.outerHTML = numberHtml(d); });
            }
            if (act === 'copy-no') { await navigator.clipboard.writeText(d.docNumber); toast('Number copied', 'info'); }
            if (act === 'share') openShare(d, reload);
            if (act === 'edit') openDocForm(d, docs, reload);
            if (act === 'renew') openDocForm(d, docs, reload, null, { renew: true });
            if (act === 'delete' && await confirmDialog(`Delete "${d.title}" of ${d.owner} with its ${d.fileCount} scan${d.fileCount === 1 ? '' : 's'}? Share links stop working.`)) {
                await api.del(`/documents/${d.id}`); toast('Document deleted'); view.open = null; reload();
            }
        } catch (error) { toast(error.message, 'error'); }
    });

    // find a person: hides rows (and empty group headings) without a reload; ↑ / ↓ still work from the box
    const pq = $('#dc-pq');
    pq?.addEventListener('input', () => {
        const term = pq.value.trim().toLowerCase();
        let shown = 0;
        peopleEl.querySelectorAll('[data-owner]:not([data-owner=""])').forEach(el => {
            const m = owners.find(o => o.key === el.dataset.owner);
            el.hidden = !!term && !`${m.name} ${m.relation || ''}`.toLowerCase().includes(term);
            if (!el.hidden) shown++;
        });
        peopleEl.querySelectorAll('[data-group]').forEach(h => { h.hidden = !peopleEl.querySelector(`[data-in="${h.dataset.group}"]:not([hidden])`); });
        $('#dc-pempty').hidden = shown > 0;
    });
    pq?.addEventListener('keydown', e => {
        if (e.key === 'Escape' && pq.value) { e.stopPropagation(); pq.value = ''; pq.dispatchEvent(new Event('input')); }
        if (e.key === 'Enter') { e.preventDefault(); const first = peopleEl.querySelector('[data-owner]:not([data-owner=""]):not([hidden])'); if (first) pickOwner(first.dataset.owner); }
    });

    // ↑ / ↓ through the family, Esc back to everyone
    let keyTimer;
    const nav = listNavigator({
        allowWhileTyping: pq,
        items: () => [...peopleEl.querySelectorAll('[data-owner]:not([hidden])')],
        selected: () => peopleEl.querySelector('[data-owner].selected'),
        select: el => {
            peopleEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => pickOwner(el.dataset.owner), 110);
        },
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if (e.key === 'Escape' && !isTyping() && view.owner) { pickOwner(null); return true; }
        return false;
    });

    drawList();
}

// ===================================================================== pieces

const typeLabel = k => (DOC_TYPES[k] || DOC_TYPES.OTHER)[0];

function members(docs) {
    const map = new Map();
    docs.forEach(d => {
        const key = d.owner.toLowerCase();
        const m = map.get(key) || { key, name: d.owner, relation: d.relation, docs: [] };
        m.docs.push(d);
        m.relation = m.relation || d.relation;
        map.set(key, m);
    });
    const order = r => { const i = RELATIONS.indexOf(r || 'Other'); return i < 0 ? 99 : i; };
    return [...map.values()].sort((a, b) => order(a.relation) - order(b.relation) || a.name.localeCompare(b.name));
}

/** The family in groups like the Reports list: the household first, then parents and siblings, then everyone else. */
const GROUP_OF = r => (['Self', 'Spouse', 'Son', 'Daughter'].includes(r) ? 'home' : ['Father', 'Mother', 'Brother', 'Sister'].includes(r) ? 'family' : 'others');
const GROUP_LABEL = { home: 'Household', family: 'Parents & siblings', others: 'Others' };
function memberGroups(owners) {
    return Object.keys(GROUP_LABEL).map(g => {
        const list = owners.filter(o => GROUP_OF(o.relation) === g);
        if (!list.length) return '';
        return `<div class="section-title bn-sep" data-group="${g}"><span>${esc(GROUP_LABEL[g])}<i>${list.length}</i></span><b>${list.reduce((s, o) => s + o.docs.length, 0)} docs</b></div>
            ${list.map(o => memberItem(o, g)).join('')}`;
    }).join('');
}

function memberItem(m, group = '') {
    const have = new Set(m.docs.map(d => d.docType));
    const missing = ESSENTIALS.filter(k => !have.has(k));
    const alerts = m.docs.filter(d => d.expiresOn && daysFromToday(d.expiresOn) <= 180).length;
    const done = (ESSENTIALS.length - missing.length) / ESSENTIALS.length * 100;
    return `<div class="list-item clickable gp-item ${alerts ? 't-gold' : ''} ${view.owner === m.key ? 'selected' : ''}" data-owner="${esc(m.key)}" data-in="${group}">
        <span class="avatar sm">${esc(m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
        <div class="grow">
            <div class="bn-row"><span class="title">${esc(m.name)}</span><b class="bn-amt">${m.docs.length}</b></div>
            <div class="bn-row meta"><span>${esc(m.relation || '—')}</span>
                <span class="bn-left">${alerts ? `<span class="fact warn">${icon('clock')}${alerts}</span> ` : ''}${missing.length ? `<span title="Missing: ${esc(missing.map(typeLabel).join(', '))}">${missing.length} missing</span>` : '<span class="pos">complete</span>'}</span></div>
            <i class="bn-bar dc-ess" title="Essentials: ${ESSENTIALS.length - missing.length} of ${ESSENTIALS.length}"><em style="width:${done}%"></em></i>
        </div>
    </div>`;
}

function numberHtml(d) {
    if (!d.docNumber) return `<span class="doc-number muted" data-doc-number="${d.id}">no number</span>`;
    const shown = revealed.has(d.id) ? d.docNumber : mask(d.docNumber);
    return `<span class="doc-number" data-doc-number="${d.id}"><span class="mono">${esc(shown)}</span>
        <button class="icon-mini" data-doc-act="reveal" data-id="${d.id}" title="${revealed.has(d.id) ? 'Hide' : 'Show'} the number">${icon(revealed.has(d.id) ? 'lock' : 'eye')}</button>
        <button class="icon-mini" data-doc-act="copy-no" data-id="${d.id}" title="Copy the number">${icon('copy')}</button></span>`;
}

function mask(n) {
    const s = String(n);
    return s.length <= 4 ? '••••' : '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4);
}

function validity(d) {
    if (!d.expiresOn) return d.issuedOn ? `<span class="doc-valid">issued ${date(d.issuedOn)}</span>` : '';
    const days = daysFromToday(d.expiresOn);
    if (days < 0) return `<span class="doc-valid bad">${icon('alert-circle')}expired ${date(d.expiresOn)}</span>`;
    if (days <= 180) return `<span class="doc-valid warn">${icon('clock')}expires in ${days < 62 ? `${days} days` : `${Math.round(days / 30)} months`}</span>`;
    return `<span class="doc-valid good">${icon('check-circle')}valid till ${date(d.expiresOn)}</span>`;
}

function card(d, manage) {
    const [label, iconName, tone] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = d.expiresOn && daysFromToday(d.expiresOn) <= 180;
    return `<div class="doc-card" data-doc="${d.id}" title="${manage ? 'Drop photos or PDFs here to add scans' : ''}">
        <button class="doc-cover" data-doc-act="view" data-id="${d.id}" title="Open the scans">
            ${d.coverId && d.coverIsImage ? `<img data-cover="${d.coverId}" alt="">` : `<span class="doc-cover-icon chip-icon ${tone}">${icon(d.fileCount ? 'file-text' : iconName)}</span>`}
            <span class="doc-files">${icon('paperclip')}${d.fileCount}</span>
            ${d.activeShares ? `<span class="doc-shared" title="${d.activeShares} share link${d.activeShares === 1 ? '' : 's'} working">${icon('link')}${d.activeShares}</span>` : ''}
        </button>
        <div class="doc-body">
            <div class="doc-type"><span class="chip-icon xs ${tone}">${icon(iconName)}</span>${esc(label)}</div>
            <b class="doc-title">${esc(d.title)}</b>
            <div class="doc-owner">${icon('user')}${esc(d.owner)}${d.relation ? ` · ${esc(d.relation)}` : ''}</div>
            ${numberHtml(d)}
            ${validity(d)}
        </div>
        <div class="doc-actions">
            <button class="btn sm primary" data-doc-act="share" data-id="${d.id}" ${d.fileCount ? '' : 'disabled title="Add a scan first"'}>${icon('link')}Share</button>
            <button class="btn sm" data-doc-act="view" data-id="${d.id}">${icon('eye')}View</button>
            ${manage && renew ? `<button class="btn sm ghost doc-renew" data-doc-act="renew" data-id="${d.id}" title="Renewed? Set the new validity and add the new scan">${icon('refresh')}Renew</button>` : ''}
            ${manage ? `<button class="btn sm ghost icon" data-doc-act="edit" data-id="${d.id}" title="Edit">${icon('edit')}</button>
                <button class="btn sm ghost icon danger" data-doc-act="delete" data-id="${d.id}" title="Delete">${icon('trash')}</button>` : ''}
        </div>
    </div>`;
}

/** One document on one line, like an expense: type, title and whose, the number, validity, scans. */
function row(d, manage) {
    const [label, iconName, tone] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = d.expiresOn && daysFromToday(d.expiresOn) <= 180;
    return `<tr class="clickable xp-tr doc-row ${view.open === d.id ? 'expanded' : ''}" data-doc="${d.id}" ${manage ? 'title="Drop photos or PDFs here to add scans"' : ''}>
        <td class="c-type"><div class="xd-cat"><span class="chip-icon xs ${tone}">${icon(iconName)}</span><span class="ellipsis">${esc(label)}</span></div></td>
        <td class="c-desc"><div class="xd-cell"><span class="xd-text"><b title="${esc(d.title)}">${esc(d.title)}</b>
            ${d.activeShares ? `<span class="xp-ico" title="${d.activeShares} share link${d.activeShares === 1 ? '' : 's'} working">${icon('link')}</span>` : ''}
            ${d.notes ? `<span class="xp-ico" title="${esc(d.notes)}">${icon('info')}</span>` : ''}</span>
            <span class="xd-party">${esc(d.owner)}${d.relation ? ` · ${esc(d.relation)}` : ''}</span></div></td>
        <td class="c-num">${numberHtml(d)}</td>
        <td class="c-valid">${validity(d) || '<span class="muted">—</span>'}</td>
        <td class="c-files"><button class="doc-scans ${d.fileCount ? '' : 'none'}" data-doc-act="view" data-id="${d.id}" title="${d.fileCount ? 'Open the scans' : 'No scan yet'}">${icon('paperclip')}${d.fileCount}</button></td>
        <td class="c-caret"><span class="gr-actions">
            ${d.fileCount ? `<button class="btn xs ghost" data-doc-act="share" data-id="${d.id}" title="Share">${icon('link')}</button>` : ''}
            ${manage && renew ? `<button class="btn xs ghost doc-renew" data-doc-act="renew" data-id="${d.id}" title="Renewed? Set the new validity and add the new scan">${icon('refresh')}</button>` : ''}
            ${manage ? `<button class="btn xs ghost" data-doc-act="edit" data-id="${d.id}" title="Edit">${icon('edit')}</button>` : ''}</span>
            <span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}

/** A document opened in place, kept short: one line of facts and actions, then its scans. */
function detailHtml(d, manage) {
    const [label, iconName] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = d.expiresOn && daysFromToday(d.expiresOn) <= 180;
    const fact = (ico, text, title = '') => `<span class="xd-fact" ${title ? `title="${esc(title)}"` : ''}>${icon(ico)}${text}</span>`;
    return `<div class="xp-detail2 doc-detail2">
        <div class="xd-top">
            ${fact(iconName, `<b>${esc(label)}</b>`)}
            ${fact('user', `${esc(d.owner)}${d.relation ? ` · ${esc(d.relation)}` : ''}`, 'Whose')}
            ${d.issuer ? fact('building', esc(d.issuer), 'Issued by') : ''}
            ${d.issuedOn ? fact('calendar', `issued ${date(d.issuedOn)}`) : ''}
            ${d.expiresOn ? fact('clock', `valid till ${date(d.expiresOn)}`) : ''}
            ${d.activeShares ? fact('link', `${d.activeShares} link${d.activeShares === 1 ? '' : 's'} working`) : ''}
            ${d.createdAt ? fact('history', dateTime(d.createdAt), 'Added') : ''}
            <span class="spacer"></span>
            <span class="xd-actions">
                <button class="btn xs primary" data-doc-act="share" data-id="${d.id}" ${d.fileCount ? '' : 'disabled title="Add a scan first"'}>${icon('link')}Share</button>
                <button class="btn xs" data-doc-act="view" data-id="${d.id}" ${d.fileCount ? '' : 'disabled'}>${icon('eye')}View</button>
                ${manage && renew ? `<button class="btn xs doc-renew" data-doc-act="renew" data-id="${d.id}">${icon('refresh')}Renew</button>` : ''}
                ${manage ? `<button class="btn xs" data-doc-act="edit" data-id="${d.id}">${icon('edit')}Edit</button>
                    <button class="btn xs ghost icon danger" data-doc-act="delete" data-id="${d.id}" title="Delete">${icon('trash')}</button>` : ''}
            </span>
        </div>
        ${d.notes ? `<div class="xd-note">${icon('info')}<span>${esc(d.notes)}</span></div>` : ''}
        <div class="xp-evidence" data-ev-doc="${d.id}" data-ev-count="${d.fileCount || 0}"></div>
    </div>`;
}

function attention(soon, expired, noScan) {
    const rows = [
        ...expired.map(d => ['bad', 'alert-circle', d, `expired ${date(d.expiresOn)}: renew it`]),
        ...soon.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)).map(d => ['warn', 'clock', d, `expires ${date(d.expiresOn)} (in ${daysFromToday(d.expiresOn)} days)`]),
        ...noScan.map(d => ['info', 'camera', d, 'no scan yet: add a photo or PDF']),
    ];
    if (!rows.length) return '<p class="small muted" style="margin:4px 0">Everything is scanned and valid.</p>';
    return `<div class="insights">${rows.slice(0, 8).map(([tone, ico, d, text]) => `<div class="insight ${tone} clickable" data-doc-open="${d.id}">${icon(ico)}<div><b>${esc(d.title)}</b> · ${esc(d.owner)}<br><span class="small">${text}</span></div></div>`).join('')}</div>`;
}

function checklist(owners) {
    if (!owners.length) return '<p class="small muted" style="margin:4px 0">Add documents to see who is missing what.</p>';
    const can_ = can('POST_TRANSACTIONS');
    return `<div class="doc-checklist">${owners.map(o => {
        const have = new Set(o.docs.map(d => d.docType));
        return `<div class="dc-person"><b>${esc(o.name)}</b><div class="dc-ticks">${ESSENTIALS.map(k => have.has(k)
            ? `<span class="dc-tick on" title="${esc(typeLabel(k))}">${icon('check')}${esc(short(k))}</span>`
            : `<button class="dc-tick" ${can_ ? `data-add-type="${k}" data-add-owner="${esc(o.name)}" data-add-relation="${esc(o.relation || '')}"` : 'disabled'} title="Add ${esc(typeLabel(k))}">${icon('plus')}${esc(short(k))}</button>`).join('')}</div></div>`;
    }).join('')}</div>`;
}

const short = k => ({ AADHAAR: 'Aadhaar', PAN: 'PAN', PASSPORT: 'Passport', VOTER_ID: 'Voter ID', DRIVING_LICENCE: 'Licence' }[k] || k);

/** All scans of a document in the full-screen viewer. */
async function openDocument(d) {
    if (!d) return;
    const files = await api.get('/attachments', { documentId: d.id });
    if (!files.length) { toast('No scan yet: edit the document to add one', 'info'); return; }
    openViewer(files, 0, { canEdit: can('POST_TRANSACTIONS') });
}

// ===================================================================== sharing

/** Share a document: a temporary link (copy, QR, WhatsApp, e-mail) or the files themselves via the share sheet. */
async function openShare(d, reload) {
    const shares = await api.get(`/documents/${d.id}/shares`);
    const files = await api.get('/attachments', { documentId: d.id });
    const durations = [[1, '1 hour'], [24, '1 day'], [72, '3 days'], [168, '1 week'], [720, '30 days']];
    const canShareFiles = !!(navigator.canShare && window.File);
    const modal = openModal({
        title: `Share · ${d.title} (${d.owner})`, iconName: 'link', size: 'lg',
        body: `<div class="share-box">
            <form class="form-grid two" autocomplete="off">
                ${field({ label: 'Who asked for it', name: 'sharedWith', placeholder: 'e.g. HDFC loan desk, Ravi, school office', span: 'span-2' })}
                <div class="span-2"><div class="ln-label">Link works for</div><div class="ln-chips" data-group="hours">${durations.map(([h, l]) =>
                    `<button type="button" class="date-chip ${h === 24 ? 'selected' : ''}" data-value="${h}">${l}</button>`).join('')}</div></div>
                <label class="check-line span-2"><input type="checkbox" name="allowDownload" checked> Allow downloading (untick to let them only look)</label>
            </form>
            <div class="share-result" hidden></div>
            ${canShareFiles ? `<div class="share-files"><b>${icon('upload')} Or send the file itself</b><span class="small muted">Opens your device's share sheet (WhatsApp, Mail, Drive…) with the ${files.length} scan${files.length === 1 ? '' : 's'}.</span>
                <button type="button" class="btn sm" data-share-files>${icon('upload')}Share the files</button></div>` : ''}
            ${shares.length ? `<div class="section-title" style="margin-top:12px">${icon('history')} Links made for this document</div>
                <div class="share-list">${shares.map(s => `<div class="share-row ${s.status.toLowerCase()}">
                    <span class="badge ${s.status === 'ACTIVE' ? 'good' : s.status === 'EXPIRED' ? 'gray' : 'critical'}">${s.status === 'ACTIVE' ? 'Active' : s.status === 'EXPIRED' ? 'Expired' : 'Stopped'}</span>
                    <div class="grow min-0"><b>${esc(s.sharedWith || 'Someone')}</b><small>made ${dateTime(s.createdAt)} · ${s.status === 'ACTIVE' ? `until ${dateTime(s.expiresAt)}` : s.revokedAt ? `stopped ${dateTime(s.revokedAt)}` : `ended ${dateTime(s.expiresAt)}`}
                        · opened ${s.views}×${s.lastViewedAt ? `, last ${dateTime(s.lastViewedAt)}` : ''}${s.allowDownload ? '' : ' · view only'}</small></div>
                    ${s.status === 'ACTIVE' && can('POST_TRANSACTIONS') ? `<button type="button" class="btn sm danger" data-revoke="${s.id}">${icon('lock')}Stop</button>` : ''}</div>`).join('')}</div>` : ''}
        </div>`,
        onOpen: m => {
            m.el.addEventListener('click', async e => {
                const chip = e.target.closest('[data-group] [data-value]');
                if (chip) chip.parentElement.querySelectorAll('[data-value]').forEach(c => c.classList.toggle('selected', c === chip));
                const rv = e.target.closest('[data-revoke]');
                if (rv) { await api.post(`/documents/${d.id}/shares/${rv.dataset.revoke}/revoke`); toast('Sharing stopped; the link no longer works'); m.close(); reload(); }
                if (e.target.closest('[data-share-files]')) shareFiles(d, files);
                const copy = e.target.closest('[data-copy]');
                if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Link copied', 'info'); } catch { /* select instead */ } }
            });
        },
        actions: [{ label: 'Close' }, {
            label: 'Make share link', kind: 'primary', iconName: 'link',
            onClick: async m => {
                const form = m.el.querySelector('form');
                const hours = Number(form.querySelector('[data-group="hours"] .selected')?.dataset.value || 24);
                const made = await api.post(`/documents/${d.id}/shares`, { sharedWith: readForm(form).sharedWith, hours, allowDownload: form.allowDownload.checked });
                const url = `${location.origin}/share.html#${made.token}`;
                const text = `${d.title} (${d.owner}) — shared with you until ${dateTime(made.share.expiresAt)}: ${url}`;
                const box = m.el.querySelector('.share-result');
                box.hidden = false;
                box.innerHTML = `<div class="ln-made"><div class="ln-qr">${qrSvg(url, { size: 150 })}</div><div class="ln-made-main">
                    <p class="small muted" style="margin:0">Works until <b>${dateTime(made.share.expiresAt)}</b>${made.share.allowDownload ? '' : ', view only'}. Stop it any time here.</p>
                    <div class="ln-url"><input value="${esc(url)}" readonly data-plain><button type="button" class="btn sm primary" data-copy="${esc(url)}">${icon('copy')}Copy</button></div>
                    <div class="row wrap"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">${icon('phone')}WhatsApp</a>
                        <a class="btn sm" href="mailto:?subject=${encodeURIComponent(`${d.title} (${d.owner})`)}&body=${encodeURIComponent(text)}">${icon('file-text')}E-mail</a>
                        ${navigator.share ? `<button type="button" class="btn sm" data-native-share>${icon('link')}More…</button>` : ''}</div></div></div>`;
                box.querySelector('[data-native-share]')?.addEventListener('click', () => navigator.share({ title: d.title, text, url }).catch(() => {}));
                form.hidden = true;
                reload();
                return true;   // keep the dialog open to copy / send
            },
        }],
    });
    return modal;
}

/** The scans themselves through the device's share sheet (where the browser supports sharing files). */
async function shareFiles(d, files) {
    try {
        const blobs = await Promise.all(files.map(async f => new File([await api.blob(`/attachments/${f.id}/file`)], f.fileName, { type: f.contentType })));
        if (!navigator.canShare({ files: blobs })) { toast('This browser cannot share files; use a link instead', 'info'); return; }
        await navigator.share({ files: blobs, title: `${d.title} (${d.owner})` });
    } catch (error) {
        if (error.name !== 'AbortError') toast(error.message || 'Could not share the files', 'error');
    }
}

// ===================================================================== form

function openDocForm(doc, all, reload, member = null, { renew = false } = {}) {
    const d = doc || { owner: member?.name || '', relation: member?.relation || '', docType: 'AADHAAR' };
    const editing = doc && doc.id;
    const owners = [...new Set(all.map(x => x.owner))];
    const relationOf = name => all.find(x => x.owner.toLowerCase() === name.trim().toLowerCase() && x.relation)?.relation;
    const quickTypes = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'INSURANCE', 'VEHICLE_RC', 'PROPERTY'];
    const modal = openModal({
        title: renew ? `Renew · ${doc.title}` : editing ? `Edit · ${doc.title}` : 'Add document', iconName: renew ? 'refresh' : 'file-text', size: 'lg',
        body: `<form class="form-grid three" autocomplete="off">
            ${renew ? `<p class="span-3 hint" style="margin:0">${icon('info')} Renewed: set the new <b>valid until</b> date (and issue date), and add the new card's scan below. The old scans stay unless you remove them.</p>` : ''}
            ${editing ? '' : `<div class="span-3 doc-type-chips" data-type-chips>${quickTypes.map(k => {
                const [l, ico, tone] = DOC_TYPES[k];
                return `<button type="button" class="date-chip ${d.docType === k ? 'selected' : ''}" data-type="${k}"><span class="chip-icon xs ${tone}">${icon(ico)}</span>${esc(l)}</button>`;
            }).join('')}</div>`}
            <label class="field"><span>Type *</span><select name="docType">${Object.entries(DOC_TYPES).map(([k, [l]]) => `<option value="${k}" ${d.docType === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Whose *</span><input name="owner" list="dc-owners" value="${esc(d.owner || '')}" required maxlength="60" placeholder="Self, Lakshmi, Arjun…" data-plain>
                ${owners.length && !editing ? `<span class="quick-chips" data-owner-chips>${owners.slice(0, 6).map(o => `<button type="button" class="date-chip ${o === d.owner ? 'selected' : ''}" data-owner-pick="${esc(o)}">${esc(o)}</button>`).join('')}</span>` : ''}</label>
            <label class="field"><span>Relation</span><input name="relation" list="dc-relations" value="${esc(d.relation || '')}" maxlength="30" data-plain></label>
            <datalist id="dc-owners">${owners.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
            <datalist id="dc-relations">${RELATIONS.map(r => `<option value="${r}">`).join('')}</datalist>
            ${field({ label: 'Title', name: 'title', value: d.title || typeLabel(d.docType), required: true, span: 'span-2', attrs: 'maxlength="120"' })}
            <label class="field"><span>Number</span><input name="docNumber" value="${esc(d.docNumber || '')}" maxlength="60" data-plain autocomplete="off"><span class="doc-check" data-number-check></span></label>
            ${field({ label: 'Issued by', name: 'issuer', value: d.issuer || '', placeholder: 'e.g. UIDAI, RTO Hyderabad, Osmania University' })}
            ${field({ label: 'Issued on', name: 'issuedOn', type: 'date', value: d.issuedOn || '' })}
            ${field({ label: 'Valid until', name: 'expiresOn', type: 'date', value: renew ? '' : d.expiresOn || '', hint: 'Passports, licences, policies: you are reminded 6 months before', attrs: 'data-dp-base="issuedOn"' })}
            ${field({ label: 'Notes', name: 'notes', value: d.notes || '', span: 'span-3' })}
            <div class="span-3">${evidenceFieldHtml({ label: 'Scans', hint: 'Front and back, or a PDF' })}</div>
            ${editing ? `<div class="span-3" data-ev-doc="${doc.id}" data-ev-count="${doc.fileCount}"></div>` : ''}
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            const check = () => {
                const box = form.querySelector('[data-number-check]');
                const fmt = NUMBER_FORMATS[form.docType.value];
                const n = form.docNumber.value.trim();
                if (!fmt || !n) { box.textContent = ''; box.className = 'doc-check'; return; }
                const ok = fmt[0].test(n);
                box.className = `doc-check ${ok ? 'ok' : 'warn'}`;
                box.textContent = ok ? '✓ looks right' : `usually ${fmt[1]}`;
            };
            const onType = () => {
                if (!editing && (!form.title.value || Object.values(DOC_TYPES).some(([l]) => l === form.title.value))) form.title.value = typeLabel(form.docType.value);
                form.querySelectorAll('[data-type]').forEach(c => c.classList.toggle('selected', c.dataset.type === form.docType.value));
                check();
            };
            form.docType.addEventListener('change', onType);
            form.docNumber.addEventListener('input', check);
            form.owner.addEventListener('change', () => { const r = relationOf(form.owner.value); if (r && !form.relation.value) form.relation.value = r; });
            form.addEventListener('click', e => {
                const t = e.target.closest('[data-type]');
                if (t) { form.docType.value = t.dataset.type; onType(); form.docNumber.focus(); }
                const o = e.target.closest('[data-owner-pick]');
                if (o) {
                    form.owner.value = o.dataset.ownerPick;
                    form.relation.value = relationOf(o.dataset.ownerPick) || form.relation.value;
                    form.querySelectorAll('[data-owner-pick]').forEach(c => c.classList.toggle('selected', c === o));
                }
            });
            check();
            if (renew) setTimeout(() => form.expiresOn.focus(), 60);
        },
        actions: [{ label: 'Cancel' }, {
            label: renew ? 'Save renewal' : editing ? 'Save changes' : 'Save document', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                const payload = { ...data, issuedOn: data.issuedOn || null, expiresOn: data.expiresOn || null, version: editing ? doc.version : null };
                const saved = editing ? await api.put(`/documents/${doc.id}`, payload) : await api.post('/documents', payload);
                const n = await evidence.uploadTo(null, { documentId: saved.id });
                toast(`${saved.title} of ${saved.owner} saved${n ? ` with ${n} scan${n === 1 ? '' : 's'}` : ''}`);
                reload();
            },
        }],
    });
    const evidence = bindEvidenceField(modal.el);
}

function tile(iconName, label, value, note, cls = '') {
    return `<div class="bo-tile ${cls}"><span class="bo-icon">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><span class="bo-note">${note}</span></div></div>`;
}

