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
 * Insurance (medical, vehicle, life): the document also holds the policy (see InsuranceService): the premium and its due
 * date, everything needed to pay it, and e-mail reminders. What is due soon or overdue shows above the list and under
 * Needs attention; Pay shows how to pay (link, UPI QR, details) and records the premium as an expense, moving the policy
 * on to its next due date.
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { panel, esc, emptyState, toast, confirmDialog, openModal, field, readForm } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { date, dateTime, daysFromToday, isoDate, money, moneyShort } from '../core/format.js';
import { upiLink } from '../components/upi-pay.js';
import { evidenceFieldHtml, bindEvidenceField, openViewer, fileUrl } from '../components/evidence.js';
import { qrSvg } from '../core/qr.js';
import { setPageKeys, listNavigator, isTyping } from '../core/keys.js';
import { showRoute, routeHash, fromAddress, setQuery } from '../core/route.js';

export const DOC_TYPES = {
    AADHAAR: ['Aadhaar card', 'shield', 'ocean'], PAN: ['PAN card', 'card', 'violet'], PASSPORT: ['Passport', 'plane', 'aqua'],
    VOTER_ID: ['Voter ID', 'flag', 'coral'], DRIVING_LICENCE: ['Driving licence', 'car', 'gold'], RATION_CARD: ['Ration card', 'home', 'gray'],
    BIRTH_CERT: ['Birth certificate', 'heart', 'red'], MARRIAGE_CERT: ['Marriage certificate', 'heart', 'violet'],
    EDUCATION: ['Educational certificate', 'briefcase', 'ocean'], BANK_PASSBOOK: ['Bank passbook', 'bank', 'aqua'],
    PROPERTY: ['Property papers', 'building', 'gold'], VEHICLE_RC: ['Vehicle RC', 'car', 'gray'], INSURANCE_HEALTH: ['Medical insurance', 'heart', 'red'], INSURANCE_VEHICLE: ['Vehicle insurance', 'car', 'gold'],
    INSURANCE_LIFE: ['Life insurance', 'shield', 'violet'], INSURANCE: ['Insurance policy', 'shield', 'aqua'],
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
const INSURANCE_TYPES = ['INSURANCE_HEALTH', 'INSURANCE_VEHICLE', 'INSURANCE_LIFE', 'INSURANCE'];
const FREQUENCIES = [['YEARLY', 'Yearly'], ['HALF_YEARLY', 'Half-yearly'], ['QUARTERLY', 'Quarterly'], ['MONTHLY', 'Monthly'], ['SINGLE', 'One time']];
const PAY_MODES = [['ONLINE', 'Online'], ['UPI', 'UPI'], ['AUTO_DEBIT', 'Auto debit'], ['NET_BANKING', 'Net banking'], ['AGENT', 'Through the agent'], ['CHEQUE', 'Cheque'], ['CASH', 'Cash']];
const REMINDER_STEPS = [60, 30, 15, 7, 3, 1];
/** A premium that needs attention now. */
const premiumDue = d => d.policy?.nextDueDate && d.policy.status !== 'OK';
const premiumLate = d => ['OVERDUE', 'LAPSED'].includes(d.policy?.status);
/** The cover of a policy is carried on by paying the premium, so its end is not "to renew" by itself. */
const toRenew = d => d.expiresOn && !d.policy && daysFromToday(d.expiresOn) <= 180;
const inDays = n => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'due today' : `due in ${n} day${n === 1 ? '' : 's'}`);

export async function render(container, _params, isCurrent) {
    if (fromAddress(_params)) {   // #/documents?owner=<key>&sort=person&layout=cards&type=…
        const q = _params.query;
        view.owner = q.get('owner') || null;
        if (SORTS[q.get('sort')]) view.sort = q.get('sort');
        if (q.get('layout') === 'cards' || q.get('layout') === 'list') { layout = q.get('layout'); }
        if (q.has('type')) view.type = q.get('type');
    }
    const docs = await api.get('/documents');
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const manage = can('POST_TRANSACTIONS');
    const owners = members(docs);
    if (view.owner && !owners.some(o => o.key === view.owner)) view.owner = null;
    showRoute(routeHash('documents', { owner: view.owner, sort: view.sort, layout, type: view.type }));
    const soon = docs.filter(d => !d.policy && d.expiresOn && daysFromToday(d.expiresOn) >= 0 && daysFromToday(d.expiresOn) <= 180);
    const premiums = docs.filter(premiumDue).sort((a, b) => a.policy.nextDueDate.localeCompare(b.policy.nextDueDate));
    const policies = docs.filter(d => d.policy);
    // a policy whose premium is due says so once, as the premium
    const expired = docs.filter(d => d.expiresOn && daysFromToday(d.expiresOn) < 0 && !premiumDue(d));
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
            ${policies.length ? tile('shield', 'Premiums due', String(premiums.length), premiums[0] ? `${moneyShort(premiums.reduce((x, d) => x + Number(d.policy.premium), 0))} · next ${date(premiums[0].policy.nextDueDate)}` : `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}, none due soon`, premiums.some(premiumLate) ? 'warn' : premiums.length ? 'attn' : '')
                : tile('users', 'People', String(owners.length), owners.map(o => o.name).slice(0, 3).join(', ') || '—')}
            ${tile('clock', 'Expiring in 6 months', String(soon.length), soon[0] ? `${esc(soon[0].title)} · ${date(soon[0].expiresOn)}` : 'nothing soon', soon.length ? 'attn' : '')}
            ${tile('alert-circle', 'Expired', String(expired.length), expired[0] ? esc(expired[0].title) : 'none', expired.length ? 'warn' : '')}
            ${tile('link', 'Shared now', String(docs.reduce((s, d) => s + d.activeShares, 0)), 'links that still work')}
            ${tile('camera', 'Without a scan', String(noScan.length), noScan.length ? 'add a photo or PDF' : 'all scanned')}
            ${premiumAlerts(premiums, manage)}
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
            <section class="side-card"><div class="side-head">${icon('alert')}<b>Needs attention</b></div>${attention(soon, expired, noScan, premiums)}</section>
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
                : (a, b) => (a.policy?.nextDueDate || a.expiresOn || '9999').localeCompare(b.policy?.nextDueDate || b.expiresOn || '9999') || a.owner.localeCompare(b.owner));
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
        if ((key || null) !== view.owner) showRoute(routeHash('documents', { owner: key || null, sort: view.sort, layout, type: view.type }), { push: true });
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
    on('#dc-type', 'change', e => { view.type = e.target.value; setQuery({ type: view.type }); drawList(); });
    on('#dc-sort', 'click', e => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        view.sort = b.dataset.sort;
        setQuery({ sort: view.sort });
        $('#dc-sort').querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('active', x === b));
        drawList();
    });
    on('#dc-layout', 'click', e => {
        const b = e.target.closest('[data-layout]');
        if (!b) return;
        layout = b.dataset.layout;
        setQuery({ layout });
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
    container.querySelector('.dc-alerts')?.addEventListener('click', e => {
        const b = e.target.closest('[data-pay-doc]');
        if (b) openPremium(docs.find(x => x.id === Number(b.dataset.payDoc)), reload);
    });
    peopleEl.addEventListener('click', e => { const o = e.target.closest('[data-owner]'); if (o) pickOwner(o.dataset.owner); });
    container.querySelector('.gift-side').addEventListener('click', e => {
        const pay = e.target.closest('[data-pay-doc]');
        if (pay) { openPremium(docs.find(x => x.id === Number(pay.dataset.payDoc)), reload); return; }
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
            if (act === 'pay') openPremium(d, reload);
            if (act === 'remind') {
                const sent = await api.post(`/documents/${d.id}/policy/remind`);
                toast(sent.result, sent.ok ? 'success' : 'error');
                reload();
            }
            if (act === 'undo-premium') {
                const last = d.policy.payments[0];
                if (await confirmDialog(`Undo the premium of ${money(last.amount)} paid on ${date(last.paidOn)}? ${last.entryGone ? 'Its expense is already gone.' : `Its expense ${last.entryNo} is deleted.`} The policy goes back to the due date ${last.dueDate ? date(last.dueDate) : 'it had'}.`, { confirmLabel: 'Undo' })) {
                    await api.del(`/documents/${d.id}/policy/payments/${last.id}`);
                    toast('Premium undone');
                    reload();
                }
            }
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
    const alerts = m.docs.filter(d => toRenew(d) || premiumDue(d)).length;
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

/** A policy's validity is its next premium. */
function premiumHtml(d) {
    const p = d.policy;
    if (!p.nextDueDate) return `<span class="doc-premium done" title="No more premiums are due">${icon('check-circle')}all premiums paid</span>`;
    const tone = premiumLate(d) ? 'late' : p.status === 'OK' ? 'ok' : 'soon';
    return `<span class="doc-premium ${tone}" title="${esc(p.frequencyLabel)} premium${p.status === 'LAPSED' ? ': past the grace period' : ''}">${icon(tone === 'ok' ? 'calendar' : 'clock')}${moneyShort(p.premium)} · ${tone === 'ok' ? date(p.nextDueDate) : inDays(p.daysToDue)}</span>`;
}

function validity(d) {
    if (d.policy) return premiumHtml(d);
    if (!d.expiresOn) return d.issuedOn ? `<span class="doc-valid">issued ${date(d.issuedOn)}</span>` : '';
    const days = daysFromToday(d.expiresOn);
    if (days < 0) return `<span class="doc-valid bad">${icon('alert-circle')}expired ${date(d.expiresOn)}</span>`;
    if (days <= 180) return `<span class="doc-valid warn">${icon('clock')}expires in ${days < 62 ? `${days} days` : `${Math.round(days / 30)} months`}</span>`;
    return `<span class="doc-valid good">${icon('check-circle')}valid till ${date(d.expiresOn)}</span>`;
}

function card(d, manage) {
    const [label, iconName, tone] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = toRenew(d);
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
            ${manage && d.policy ? `<button class="btn sm doc-pay" data-doc-act="pay" data-id="${d.id}" title="See how to pay, and record the premium">${icon('wallet')}Premium</button>` : ''}
            ${manage && renew ? `<button class="btn sm ghost doc-renew" data-doc-act="renew" data-id="${d.id}" title="Renewed? Set the new validity and add the new scan">${icon('refresh')}Renew</button>` : ''}
            ${manage ? `<button class="btn sm ghost icon" data-doc-act="edit" data-id="${d.id}" title="Edit">${icon('edit')}</button>
                <button class="btn sm ghost icon danger" data-doc-act="delete" data-id="${d.id}" title="Delete">${icon('trash')}</button>` : ''}
        </div>
    </div>`;
}

/** One document on one line, like an expense: type, title and whose, the number, validity, scans. */
function row(d, manage) {
    const [label, iconName, tone] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = toRenew(d);
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
            ${manage && d.policy ? `<button class="btn xs ghost doc-pay" data-doc-act="pay" data-id="${d.id}" title="See how to pay, and record the premium">${icon('wallet')}</button>` : ''}
            ${manage && renew ? `<button class="btn xs ghost doc-renew" data-doc-act="renew" data-id="${d.id}" title="Renewed? Set the new validity and add the new scan">${icon('refresh')}</button>` : ''}
            ${manage ? `<button class="btn xs ghost" data-doc-act="edit" data-id="${d.id}" title="Edit">${icon('edit')}</button>` : ''}</span>
            <span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}

/** A document opened in place, kept short: one line of facts and actions, then its scans. */
function detailHtml(d, manage) {
    const [label, iconName] = DOC_TYPES[d.docType] || DOC_TYPES.OTHER;
    const renew = toRenew(d);
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
                ${manage && d.policy ? `<button class="btn xs primary doc-pay-main" data-doc-act="pay" data-id="${d.id}">${icon('wallet')}Pay premium</button>` : ''}
                <button class="btn xs ${d.policy ? '' : 'primary'}" data-doc-act="share" data-id="${d.id}" ${d.fileCount ? '' : 'disabled title="Add a scan first"'}>${icon('link')}Share</button>
                <button class="btn xs" data-doc-act="view" data-id="${d.id}" ${d.fileCount ? '' : 'disabled'}>${icon('eye')}View</button>
                ${manage && renew ? `<button class="btn xs doc-renew" data-doc-act="renew" data-id="${d.id}">${icon('refresh')}Renew</button>` : ''}
                ${manage ? `<button class="btn xs" data-doc-act="edit" data-id="${d.id}">${icon('edit')}Edit</button>
                    <button class="btn xs ghost icon danger" data-doc-act="delete" data-id="${d.id}" title="Delete">${icon('trash')}</button>` : ''}
            </span>
        </div>
        ${d.notes ? `<div class="xd-note">${icon('info')}<span>${esc(d.notes)}</span></div>` : ''}
        ${d.policy ? policyHtml(d, manage) : ''}
        <div class="xp-evidence" data-ev-doc="${d.id}" data-ev-count="${d.fileCount || 0}"></div>
    </div>`;
}

/** The strip above the lists: each premium due soon or overdue, with Pay at hand. */
function premiumAlerts(premiums, manage) {
    if (!premiums.length) return '';
    return `<div class="dc-alerts" role="status">${premiums.slice(0, 3).map(d => `<div class="dc-alert ${premiumLate(d) ? 'late' : ''}">${icon(premiumLate(d) ? 'alert-circle' : 'clock')}
        <span class="grow"><b>${esc(d.title)}</b> · ${esc(d.owner)} · <b>${money(d.policy.premium)}</b> ${inDays(d.policy.daysToDue)} (${date(d.policy.nextDueDate)})${d.policy.status === 'LAPSED' ? ' · <b>past the grace period</b>' : ''}</span>
        ${manage ? `<button class="btn xs primary" data-pay-doc="${d.id}">${icon('wallet')}Pay</button>` : ''}</div>`).join('')}
        ${premiums.length > 3 ? `<span class="small muted">and ${premiums.length - 3} more under Needs attention</span>` : ''}</div>`;
}

/** The address of a payment link, only when it is a web address. */
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

/** A policy opened in place: the premium, the cover, how to pay it, the reminders, and what was paid. */
function policyHtml(d, manage) {
    const p = d.policy;
    const line = (label, value) => (value == null || value === '' ? '' : `<div class="xd-line small"><span class="muted">${label}</span><span>${value}</span></div>`);
    const url = safeUrl(p.paymentUrl);
    const history = p.payments.length ? `<div class="xd-card ins-history"><div class="xd-card-head">${icon('history')}Premiums paid<span class="spacer"></span><b class="mono">${money(p.payments.reduce((s, x) => s + Number(x.amount), 0))}</b></div>
        ${p.payments.slice(0, 12).map((x, i) => `<div class="xd-line small"><span>${date(x.paidOn)}${x.dueDate ? ` <span class="muted">for ${date(x.dueDate)}</span>` : ''} · ${esc(x.accountName || '')}</span>
            <span>${x.entryGone ? '<span class="muted">expense deleted</span>' : `<a href="#/entry/${x.entryId}">${esc(x.entryNo)}</a>`} · <b class="mono">${money(x.amount)}</b>
            ${i === 0 && manage ? `<button class="icon-mini" data-doc-act="undo-premium" data-id="${d.id}" title="Undo this premium">${icon('undo')}</button>` : ''}</span></div>`).join('')}</div>` : '';
    return `<div class="ins-cards">
        <div class="xd-card"><div class="xd-card-head">${icon('wallet')}Premium</div>
            ${line('Amount', `<b class="mono">${money(p.premium)}</b>`)}
            ${line('Paid', esc(p.frequencyLabel))}
            ${line('Next due', p.nextDueDate ? `<b>${date(p.nextDueDate)}</b>` : 'nothing more')}
            ${line('Grace', p.graceDays ? `${p.graceDays} days` : '')}
            ${line('Last premium', p.lastPremiumDate ? date(p.lastPremiumDate) : '')}
        </div>
        <div class="xd-card"><div class="xd-card-head">${icon('shield')}Cover</div>
            ${line('Plan', esc(p.planName || ''))}
            ${line('Cover', p.sumInsured != null ? money(p.sumInsured) : '')}
            ${line('Insured', esc(p.insuredPersons || ''))}
            ${line('Vehicle', esc(p.vehicleNumber || ''))}
            ${line('Nominee', esc(p.nominee || ''))}
            ${line(d.docType === 'INSURANCE_LIFE' ? 'Matures' : 'Cover until', d.expiresOn ? date(d.expiresOn) : '')}
        </div>
        <div class="xd-card"><div class="xd-card-head">${icon('card')}How to pay</div>
            ${[p.paymentMode, p.payeeName, p.upiId, p.paymentReference, p.agentName, p.agentPhone, p.supportPhone, p.paymentNotes, url].some(Boolean) ? '' : '<div class="xd-line small"><span class="muted">Not given yet: Edit adds the payment link, UPI ID, agent and customer care.</span></div>'}
            ${line('Way', esc(PAY_MODES.find(([k]) => k === p.paymentMode)?.[1] || ''))}
            ${line('Pay to', esc(p.payeeName || ''))}
            ${line('UPI ID', p.upiId ? `<span class="mono">${esc(p.upiId)}</span>` : '')}
            ${line('Customer / biller ID', esc(p.paymentReference || ''))}
            ${line('Agent', esc([p.agentName, p.agentPhone].filter(Boolean).join(' · ')))}
            ${line('Customer care', esc(p.supportPhone || ''))}
            ${p.paymentNotes ? `<div class="xd-line small"><span class="muted">${esc(p.paymentNotes)}</span></div>` : ''}
            ${url ? `<div class="ins-acts"><a class="btn xs" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link')}Pay online</a></div>` : ''}
        </div>
        <div class="xd-card"><div class="xd-card-head">${icon('clock')}Reminders</div>
            ${line('By e-mail', p.emailReminders ? `<span class="pos">on</span> · ${esc(p.reminderDays || '')} days before` : 'off')}
            ${line('Sent to', p.emailReminders ? esc(p.emailTo || 'the addresses in Settings › Alerts') : '')}
            ${p.lastReminderResult ? `<span class="ins-result">${dateTime(p.lastReminderAt)}: ${esc(p.lastReminderResult)}</span>` : ''}
            ${manage && p.nextDueDate ? `<div class="ins-acts"><button class="btn xs" data-doc-act="remind" data-id="${d.id}" title="Send the reminder with the payment details now">${icon('upload')}Send now</button></div>` : ''}
        </div>
    </div>${history}`;
}

/** See how to pay a premium and record it: booked in Expenses, and the policy moves on to its next due date. */
async function openPremium(d, reload) {
    const p = d.policy;
    const options = await api.get('/expenses/form-options').catch(() => null);
    if (!options) { toast('Expenses are not shared with you, so a premium cannot be recorded here', 'error'); return; }
    const url = safeUrl(p.paymentUrl);
    const fact = (label, value) => (value ? `<div><span>${label}</span><b>${esc(value)}</b></div>` : '');
    const premiumCategory = p.categoryId || options.categories.find(c => /insurance/i.test(c.name))?.id || '';
    const qr = p.upiId ? `<div class="ins-pay-side">${qrSvg(upiLink({ vpa: p.upiId, payee: p.payeeName || d.issuer, amount: p.premium, note: `${d.title} ${d.docNumber || ''}`.trim().slice(0, 50) }), { size: 150 })}
        <b>Scan to pay ${money(p.premium)}</b><span class="mono">${esc(p.upiId)}</span></div>` : '';
    const modal = openModal({
        title: `Premium · ${d.title} (${d.owner})`, iconName: 'wallet', size: 'lg',
        body: `<div class="ins-pay-grid ${qr ? '' : 'single'}"><div>
            <div class="ins-pay-facts">
                ${fact('Premium', money(p.premium))}
                ${fact('Due', p.nextDueDate ? `${date(p.nextDueDate)} (${inDays(p.daysToDue)})` : 'nothing more is due')}
                ${fact('Insurer', d.issuer)}${fact('Policy number', d.docNumber)}${fact('Pay to', p.payeeName)}${fact('Customer / biller ID', p.paymentReference)}
                ${fact('Agent', [p.agentName, p.agentPhone].filter(Boolean).join(' · '))}${fact('Customer care', p.supportPhone)}${fact('Note', p.paymentNotes)}
            </div>
            ${url ? `<p class="ins-acts"><a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link')}Pay online</a><span class="small muted">then record it below</span></p>` : ''}
            <form class="form-grid two" autocomplete="off">
                ${field({ label: 'Paid on', name: 'paidOn', type: 'date', value: isoDate(), required: true })}
                ${field({ label: 'Amount', name: 'amount', type: 'number', value: p.premium, required: true })}
                ${field({ label: 'Paid from', name: 'accountId', type: 'select', value: p.payAccountId || '', required: true, options: [{ value: '', label: 'Choose the account' }, ...options.payers.map(a => ({ value: a.id, label: a.name }))] })}
                ${field({ label: 'Expense category', name: 'categoryId', type: 'select', value: premiumCategory, required: true, options: [{ value: '', label: 'Choose the category' }, ...options.categories.map(c => ({ value: c.id, label: c.name }))] })}
                ${field({ label: 'Payment reference', name: 'reference', placeholder: 'UTR, receipt number', attrs: 'maxlength="60"' })}
                ${field({ label: 'Notes', name: 'notes', attrs: 'maxlength="255"' })}
                <div class="span-2">${evidenceFieldHtml({ label: 'Receipt', hint: 'Kept with the expense' })}</div>
            </form>
        </div>${qr}</div>`,
        actions: [{ label: 'Close' }, {
            label: 'Record in Expenses', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const v = readForm(form);
                const paid = await api.post(`/documents/${d.id}/policy/pay`, { paidOn: v.paidOn, amount: v.amount, accountId: Number(v.accountId), categoryId: Number(v.categoryId),
                    dueDate: p.nextDueDate, reference: v.reference, notes: v.notes });
                await evidence.uploadTo(paid.entryId);
                toast(`Recorded in Expenses as ${paid.entryNo}${paid.nextDueDate ? `. Next premium due ${date(paid.nextDueDate)}` : '. No more premiums are due'}`);
                reload();
            },
        }],
    });
    const evidence = bindEvidenceField(modal.el);
}

function attention(soon, expired, noScan, premiums = []) {
    const pay = premiums.map(d => `<div class="insight ${premiumLate(d) ? 'bad' : 'warn'} clickable" data-pay-doc="${d.id}">${icon('shield')}<div><b>${esc(d.title)}</b> · ${esc(d.owner)}<br><span class="small">premium ${money(d.policy.premium)} ${inDays(d.policy.daysToDue)}</span></div></div>`);
    const rows = [
        ...expired.map(d => ['bad', 'alert-circle', d, `expired ${date(d.expiresOn)}: renew it`]),
        ...soon.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)).map(d => ['warn', 'clock', d, `expires ${date(d.expiresOn)} (in ${daysFromToday(d.expiresOn)} days)`]),
        ...noScan.map(d => ['info', 'camera', d, 'no scan yet: add a photo or PDF']),
    ];
    if (!rows.length && !pay.length) return '<p class="small muted" style="margin:4px 0">Everything is scanned and valid.</p>';
    return `<div class="insights">${pay.join('')}${rows.slice(0, Math.max(0, 8 - pay.length)).map(([tone, ico, d, text]) => `<div class="insight ${tone} clickable" data-doc-open="${d.id}">${icon(ico)}<div><b>${esc(d.title)}</b> · ${esc(d.owner)}<br><span class="small">${text}</span></div></div>`).join('')}</div>`;
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

/** The policy's part of the form, shown for the insurance types. */
function policyFormHtml(p, options) {
    const days = new Set(String(p.reminderDays || '30,15,7,3,1').split(',').map(Number));
    const category = p.categoryId || options.categories.find(c => /insurance/i.test(c.name))?.id || '';
    return `<div class="span-3 ins-form" data-ins-form hidden>
        <div class="ins-head">${icon('shield')}Cover</div>
        <div class="form-grid three">
            ${field({ label: 'Plan', name: 'p_planName', value: p.planName || '', attrs: 'maxlength="100"' })}
            ${field({ label: 'Cover (sum insured)', name: 'p_sumInsured', type: 'number', value: p.sumInsured ?? '' })}
            ${field({ label: 'Who is insured', name: 'p_insuredPersons', value: p.insuredPersons || '', attrs: 'maxlength="200"', placeholder: 'Self, Lakshmi, Arjun' })}
            <div data-ins-only="INSURANCE_VEHICLE">${field({ label: 'Vehicle number', name: 'p_vehicleNumber', value: p.vehicleNumber || '', attrs: 'maxlength="30"', placeholder: 'TS09 AB 1234' })}</div>
            <div data-ins-only="INSURANCE_LIFE INSURANCE_HEALTH INSURANCE">${field({ label: 'Nominee', name: 'p_nominee', value: p.nominee || '', attrs: 'maxlength="100"' })}</div>
        </div>
        <div class="ins-head">${icon('wallet')}Premium</div>
        <div class="form-grid three">
            ${field({ label: 'Premium *', name: 'p_premium', type: 'number', value: p.premium ?? '' })}
            ${field({ label: 'Paid', name: 'p_frequency', type: 'select', value: p.frequency || 'YEARLY', options: FREQUENCIES.map(([value, label]) => ({ value, label })) })}
            ${field({ label: 'Next due date *', name: 'p_nextDueDate', type: 'date', value: p.nextDueDate || '' })}
            ${field({ label: 'Grace days', name: 'p_graceDays', type: 'number', value: p.graceDays ?? '', hint: 'Days the insurer allows after the due date' })}
            <div data-ins-only="INSURANCE_LIFE">${field({ label: 'Last premium on', name: 'p_lastPremiumDate', type: 'date', value: p.lastPremiumDate || '', hint: 'When premiums stop, if before maturity' })}</div>
        </div>
        <div class="ins-head">${icon('card')}How it is paid</div>
        <div class="form-grid three">
            ${field({ label: 'Way', name: 'p_paymentMode', type: 'select', value: p.paymentMode || '', options: [{ value: '', label: 'Not said' }, ...PAY_MODES.map(([value, label]) => ({ value, label }))] })}
            ${field({ label: 'Usually paid from', name: 'p_payAccountId', type: 'select', value: p.payAccountId || '', options: [{ value: '', label: 'Choose when paying' }, ...options.payers.map(a => ({ value: a.id, label: a.name }))] })}
            ${field({ label: 'Expense category', name: 'p_categoryId', type: 'select', value: category, options: [{ value: '', label: 'Choose when paying' }, ...options.categories.map(c => ({ value: c.id, label: c.name }))] })}
            ${field({ label: 'Payment link', name: 'p_paymentUrl', value: p.paymentUrl || '', placeholder: 'https://…', attrs: 'maxlength="300"' })}
            ${field({ label: 'UPI ID', name: 'p_upiId', value: p.upiId || '', placeholder: 'name@bank', attrs: 'maxlength="100"' })}
            ${field({ label: 'Pay to (name)', name: 'p_payeeName', value: p.payeeName || '', attrs: 'maxlength="100"' })}
            ${field({ label: 'Customer / biller ID', name: 'p_paymentReference', value: p.paymentReference || '', attrs: 'maxlength="100"' })}
            ${field({ label: 'Agent', name: 'p_agentName', value: p.agentName || '', attrs: 'maxlength="100"' })}
            ${field({ label: 'Agent phone', name: 'p_agentPhone', value: p.agentPhone || '', attrs: 'maxlength="30"' })}
            ${field({ label: 'Customer care', name: 'p_supportPhone', value: p.supportPhone || '', attrs: 'maxlength="40"' })}
            ${field({ label: 'Payment notes', name: 'p_paymentNotes', value: p.paymentNotes || '', span: 'span-2', attrs: 'maxlength="255"', placeholder: 'Anything else needed to pay' })}
        </div>
        <div class="ins-head">${icon('clock')}Reminders</div>
        <label class="check-line"><input type="checkbox" name="p_emailReminders" ${p.id ? (p.emailReminders ? 'checked' : '') : 'checked'}> Send e-mail reminders with the payment details</label>
        <div class="ins-days" data-ins-days><span class="small muted">Days before the due date:</span>${REMINDER_STEPS.map(n => `<button type="button" class="date-chip ${days.has(n) ? 'selected' : ''}" data-day="${n}">${n}</button>`).join('')}<span class="small muted">also on the due date, then weekly while overdue</span></div>
        ${field({ label: 'E-mail to', name: 'p_emailTo', value: p.emailTo || '', attrs: 'maxlength="300"', placeholder: 'Blank: the addresses in Settings › Alerts', hint: 'Sent through the account in Settings › E-mail' })}
    </div>`;
}

/** What the policy part of the form holds, for the server. */
function readPolicy(form, data) {
    const value = k => data[`p_${k}`];
    const id = k => (value(k) ? Number(value(k)) : null);
    return { planName: value('planName'), insuredPersons: value('insuredPersons'), nominee: value('nominee'), vehicleNumber: value('vehicleNumber'), sumInsured: value('sumInsured'),
        premium: value('premium'), frequency: value('frequency'), nextDueDate: value('nextDueDate'), lastPremiumDate: value('lastPremiumDate'), graceDays: value('graceDays'),
        paymentMode: value('paymentMode'), payAccountId: id('payAccountId'), categoryId: id('categoryId'), payeeName: value('payeeName'), paymentUrl: value('paymentUrl'),
        upiId: value('upiId'), paymentReference: value('paymentReference'), agentName: value('agentName'), agentPhone: value('agentPhone'), supportPhone: value('supportPhone'),
        paymentNotes: value('paymentNotes'), emailReminders: value('emailReminders'), emailTo: value('emailTo'),
        reminderDays: [...form.querySelectorAll('[data-day].selected')].map(b => b.dataset.day).join(',') };
}

async function openDocForm(doc, all, reload, member = null, { renew = false } = {}) {
    const formOptions = await api.get('/expenses/form-options').catch(() => ({ categories: [], payers: [] }));
    const d = doc || { owner: member?.name || '', relation: member?.relation || '', docType: 'AADHAAR' };
    const editing = doc && doc.id;
    const owners = [...new Set(all.map(x => x.owner))];
    const relationOf = name => all.find(x => x.owner.toLowerCase() === name.trim().toLowerCase() && x.relation)?.relation;
    const quickTypes = ['AADHAAR', 'PAN', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'INSURANCE_HEALTH', 'INSURANCE_VEHICLE', 'INSURANCE_LIFE', 'VEHICLE_RC', 'PROPERTY'];
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
            ${policyFormHtml(d.policy || {}, formOptions)}
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
            const labelOf = name => form.elements[name].closest('.field')?.querySelector(':scope > span');
            const plain = { docNumber: labelOf('docNumber')?.textContent, issuer: labelOf('issuer')?.textContent, expiresOn: labelOf('expiresOn')?.textContent };
            /** An insurance type: the policy's part shows, and the document's own boxes say what they hold on a policy. */
            const onInsurance = () => {
                const type = form.docType.value;
                const insured = INSURANCE_TYPES.includes(type);
                form.querySelector('[data-ins-form]').hidden = !insured;
                form.querySelectorAll('[data-ins-only]').forEach(el => { el.hidden = !el.dataset.insOnly.split(' ').includes(type); });
                form.p_premium.required = insured;
                form.p_nextDueDate.required = insured && form.p_frequency.value !== 'SINGLE' && !(d.policy && !d.policy.nextDueDate);
                const label = (name, text) => { const el = labelOf(name); if (el) el.textContent = insured ? text : plain[name]; };
                label('docNumber', 'Policy number');
                label('issuer', 'Insurer');
                label('expiresOn', type === 'INSURANCE_LIFE' ? 'Matures on' : 'Cover until');
                form.issuer.placeholder = insured ? 'e.g. Star Health, ICICI Lombard, LIC' : 'e.g. UIDAI, RTO Hyderabad, Osmania University';
                const validHint = form.expiresOn.closest('.field').querySelector(':scope > small');
                if (validHint) validHint.hidden = insured;   // a policy is reminded by its premium
            };
            form.p_frequency.addEventListener('change', onInsurance);
            form.querySelector('[data-ins-days]').addEventListener('click', e => e.target.closest('[data-day]')?.classList.toggle('selected'));
            const onType = () => {
                if (!editing && (!form.title.value || Object.values(DOC_TYPES).some(([l]) => l === form.title.value))) form.title.value = typeLabel(form.docType.value);
                form.querySelectorAll('[data-type]').forEach(c => c.classList.toggle('selected', c.dataset.type === form.docType.value));
                check();
                onInsurance();
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
            onInsurance();
            if (renew) setTimeout(() => form.expiresOn.focus(), 60);
        },
        actions: [{ label: 'Cancel' }, {
            label: renew ? 'Save renewal' : editing ? 'Save changes' : 'Save document', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const data = readForm(form);
                const own = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('p_')));
                const payload = { ...own, issuedOn: data.issuedOn || null, expiresOn: data.expiresOn || null, version: editing ? doc.version : null,
                    policy: INSURANCE_TYPES.includes(data.docType) ? readPolicy(form, data) : null };
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

