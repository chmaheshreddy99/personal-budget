/**
 * Gifts (#/gifts): gifts given and received and donations, kept beside the books (a gift is not income).
 *   top     given, received, the balance, gold and silver in grams, donations (and how much qualifies for 80G),
 *           how many people
 *   left    the circle of people, built for a large family (100+): its own find box (name, relation, family),
 *           balance filters (to return / you gave more / even), a relation-or-family filter, sorting and
 *           grouping by family or relation; ↑ / ↓ moves through it (also from the find box), Enter edits the
 *           person (relation, family and spelling on all their gifts at once), Esc goes back to everyone
 *   middle  the selected person's give-and-take, then every gift by year in one-line rows like Expenses;
 *           a row opens a compact detail (facts, the gift, the balance with the person, the books, evidence)
 *   right   occasions, families, what you may owe back (people who gave more than they received from you),
 *           and insights
 * Cash given can also be booked as an expense (e.g. in "Gifts & Donations"), so it shows in spending too.
 *
 * The page loads the gifts once; filters and searches only redraw the part that changes.
 * The form remembers: picking a person fills their relation and family and shows what went each way before,
 * with "match what they gave" / "same as last time"; relations, occasions and the usual amounts are one click.
 */
import { api, newRequestKey } from '../core/api.js';
import { can, loadAccounts, categoriesOf } from '../core/store.js';
import { panel, esc, emptyState, toast, confirmDialog, openModal, field, readForm, accountOptions, categoryOptions } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, number, dateTime } from '../core/format.js';
import { donutChart, foldOthers, seriesColor } from '../core/charts.js';
import { evidenceFieldHtml, bindEvidenceField, evidenceBadge } from '../components/evidence.js';
import { exportButton, bindExport } from '../core/export.js';
import { setPageKeys, listNavigator, isTyping } from '../core/keys.js';

export const KINDS = {
    CASH: { label: 'Cash', iconName: 'cash', tone: 'aqua', unit: '' },
    GOLD: { label: 'Gold', iconName: 'gem', tone: 'gold', unit: 'g' },
    SILVER: { label: 'Silver', iconName: 'gem', tone: 'gray', unit: 'g' },
    ITEM: { label: 'Item', iconName: 'gift', tone: 'violet', unit: 'pcs' },
    OTHER: { label: 'Other', iconName: 'tag', tone: 'coral', unit: '' },
};
const RELATIONS = ['Father', 'Mother', 'Brother', 'Sister', 'Son', 'Daughter', 'Spouse', 'Uncle', 'Aunt', 'Cousin', 'Nephew', 'Niece',
    'Grandparent', 'In-laws', 'Relative', 'Friend', 'Colleague', 'Neighbour', 'Temple', 'Charity / trust', 'Other'];
const OCCASIONS = ['Wedding', 'Engagement', 'Birthday', 'Housewarming', 'Naming ceremony', 'Festival', 'Diwali', 'Sankranti', 'Rakhi',
    'Anniversary', 'Baby shower', 'Graduation', 'Upanayanam', 'Funeral', 'Hospital visit', 'Visit', 'Donation', 'Other'];

const SORTS = {
    total: ['Most exchanged', (a, b) => (b.given + b.received) - (a.given + a.received)],
    name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
    recent: ['Most recent', (a, b) => (b.last?.giftDate || '').localeCompare(a.last?.giftDate || '')],
    owe: ['They gave more', (a, b) => (b.received - b.given) - (a.received - a.given)],
    ahead: ['You gave more', (a, b) => (b.given - b.received) - (a.given - a.received)],
};
const GROUPS = { none: 'No grouping', family: 'By family', relation: 'By relation' };
const BALANCES = [['all', 'All'], ['owe', 'To return'], ['ahead', 'You gave more'], ['even', 'Even']];

const view = { dir: 'all', year: 'all', person: null, q: '', pq: '', bal: 'all', circle: '', open: null };
const PREFS_KEY = 'pb.gifts.prefs';
const prefs = (() => {
    try { return { sort: 'total', group: 'family', ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return { sort: 'total', group: 'family' }; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

export async function render(container, _params, isCurrent) {
    const gifts = await api.get('/gifts');
    if (!isCurrent()) return;
    const reload = () => render(container, [], isCurrent);
    const manage = can('POST_TRANSACTIONS');
    const years = [...new Set(gifts.map(g => g.giftDate.slice(0, 4)))].sort().reverse();
    if (view.year !== 'all' && !years.includes(view.year)) view.year = 'all';
    if (!SORTS[prefs.sort]) prefs.sort = 'total';
    if (!GROUPS[prefs.group]) prefs.group = 'family';

    container.innerHTML = `
    <div class="page gifts-page">
        <div class="page-toolbar glass">
            <h2 class="page-title">${icon('gift')} Gifts</h2>
            <div class="seg-chips" id="gf-dir">${[['all', 'All'], ['GIVEN', 'Given'], ['RECEIVED', 'Received'], ['DONATION', 'Donations']].map(([k, l]) =>
                `<button class="seg-chip ${view.dir === k ? 'active' : ''}" data-dir="${k}">${l}</button>`).join('')}</div>
            <div class="seg-chips sm" id="gf-year"><button class="seg-chip ${view.year === 'all' ? 'active' : ''}" data-year="all">All years</button>
                ${years.slice(0, 5).map(y => `<button class="seg-chip ${view.year === y ? 'active' : ''}" data-year="${y}">${y}</button>`).join('')}</div>
            <span class="spacer"></span>
            <div class="search-box">${icon('search')}<input id="gf-q" placeholder="Search gifts: person, occasion, item…" value="${esc(view.q)}" data-plain></div>
            <button class="btn sm ghost" id="gf-clear" hidden>${icon('x')}Clear filters</button>
            ${exportButton({ label: '' })}
            ${manage ? `<button class="btn" id="gf-received">${icon('arrow-in')}Received</button>
                <button class="btn primary" id="gf-given">${icon('gift')}Gift given</button>` : ''}
        </div>

        <section class="gift-overview" id="gf-overview"></section>

        ${panel({ title: 'People', iconName: 'users', cls: 'p-gift-people', bodyClass: 'flush', sub: '<span id="gf-people-count"></span>',
            body: `<div class="gp-tools">
                    <div class="search-box sm">${icon('search')}<input id="gf-pq" placeholder="Find a person, relation or family…" value="${esc(view.pq)}" data-plain></div>
                    <div class="bn-filters" id="gf-bal"></div>
                    <div class="gp-selects">
                        <select id="gf-circle" class="gp-select" data-plain title="Only one family or relation"></select>
                        <select id="gf-sort" class="gp-select" data-plain title="Sort people">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${prefs.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                        <select id="gf-group" class="gp-select" data-plain title="Group people">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${prefs.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="list gp-list scroll" id="gf-people"></div>
                <div class="bn-foot"><span class="kbd">↑</span><span class="kbd">↓</span> move · <span class="kbd">Enter</span> edit person · <span class="kbd">Esc</span> everyone · <span class="kbd">←</span><span class="kbd">→</span> year</div>` })}

        ${panel({ title: 'All gifts', iconName: 'list', cls: 'p-gift-list', bodyClass: 'flush', sub: '<span id="gf-list-count"></span>',
            body: `<div id="gf-person-head"></div><div class="scroll" id="gf-list"></div>` })}

        <aside class="gift-side" id="gf-side"></aside>
    </div>`;

    const $ = sel => container.querySelector(sel);
    const peopleEl = $('#gf-people');
    const listEl = $('#gf-list');

    // ---- the data in scope: the year picks what every part shows; direction and search only narrow the gift list
    let inYear = [], people = [];
    const scope = () => {
        inYear = gifts.filter(g => view.year === 'all' || g.giftDate.startsWith(view.year));
        people = ledger(inYear);
        if (view.person && !people.some(p => p.key === view.person)) view.person = null;
    };
    const listed = () => {
        const q = view.q.toLowerCase();
        return inYear.filter(g => (view.dir === 'all' || (view.dir === 'DONATION' ? g.donation : g.direction === view.dir && (view.dir !== 'GIVEN' || !g.donation)))
            && (!view.person || keyOf(g.person) === view.person)
            && (!q || `${g.person} ${g.relation || ''} ${g.family || ''} ${g.occasion || ''} ${g.description || ''} ${g.notes || ''} ${KINDS[g.kind]?.label || ''}`.toLowerCase().includes(q)));
    };

    const drawOverview = () => {
        const sum = f => inYear.filter(f).reduce((s, g) => s + Number(g.value || 0), 0);
        const grams = (kind, dir) => inYear.filter(g => g.kind === kind && g.direction === dir).reduce((s, g) => s + Number(g.quantity || 0), 0);
        const given = sum(g => g.direction === 'GIVEN' && !g.donation), received = sum(g => g.direction === 'RECEIVED');
        const donations = sum(g => g.donation), donations80g = sum(g => g.donation && g.taxDeductible);
        const toReturn = people.filter(p => !p.donation && p.received > p.given);
        $('#gf-overview').innerHTML = `
            ${tile('gift', 'Given', money(given), `${inYear.filter(g => g.direction === 'GIVEN' && !g.donation).length} gifts`, 'given')}
            ${tile('arrow-in', 'Received', money(received), `${inYear.filter(g => g.direction === 'RECEIVED').length} gifts`, 'received')}
            ${tile('scale', received >= given ? 'Received more' : 'Given more', money(Math.abs(received - given)), 'between gifts given and received')}
            ${tile('gem', 'Gold received', `${number(grams('GOLD', 'RECEIVED'), 1)} g`, `${number(grams('GOLD', 'GIVEN'), 1)} g given · silver ${number(grams('SILVER', 'RECEIVED'), 0)} g in, ${number(grams('SILVER', 'GIVEN'), 0)} g out`)}
            ${tile('heart', 'Donations', money(donations), donations80g ? `${money(donations80g)} with 80G receipts` : `${inYear.filter(g => g.donation).length} donations`)}
            ${tile('users', 'People', String(people.length), `${families(people).length} families · ${toReturn.length} to return`)}`;
    };

    // ---- left: people
    const circleOptions = () => {
        const fams = families(people), rels = [...new Set(people.map(p => p.relation).filter(Boolean))].sort();
        if (view.circle && !fams.some(f => `fam:${f.name}` === view.circle) && !rels.some(r => `rel:${r}` === view.circle)) view.circle = '';
        $('#gf-circle').innerHTML = `<option value="">All families &amp; relations</option>
            ${fams.length ? `<optgroup label="Family">${fams.map(f => `<option value="${esc(`fam:${f.name}`)}" ${view.circle === `fam:${f.name}` ? 'selected' : ''}>${esc(f.name)} (${f.people.length})</option>`).join('')}</optgroup>` : ''}
            ${rels.length ? `<optgroup label="Relation">${rels.map(r => `<option value="${esc(`rel:${r}`)}" ${view.circle === `rel:${r}` ? 'selected' : ''}>${esc(r)} (${people.filter(p => p.relation === r).length})</option>`).join('')}</optgroup>` : ''}`;
    };
    const balanceOf = p => (p.received > p.given ? 'owe' : p.given > p.received ? 'ahead' : 'even');
    const peopleShown = () => {
        const q = view.pq.trim().toLowerCase();
        return people.filter(p => (view.bal === 'all' || balanceOf(p) === view.bal)
            && (!view.circle || (view.circle.startsWith('fam:') ? p.family === view.circle.slice(4) : p.relation === view.circle.slice(4)))
            && (!q || `${p.name} ${p.relation || ''} ${p.family || ''}`.toLowerCase().includes(q)))
            .sort(SORTS[prefs.sort][1]);
    };
    const drawPeople = () => {
        const shown = peopleShown();
        $('#gf-bal').innerHTML = BALANCES.map(([k, l]) => {
            const n = k === 'all' ? people.length : people.filter(p => balanceOf(p) === k).length;
            return `<button class="bn-filter ${view.bal === k ? 'active' : ''} ${k === 'owe' && n ? 'hot' : ''}" data-bal="${k}" ${n || k === 'all' ? '' : 'disabled'}>${l}<i>${n}</i></button>`;
        }).join('');
        $('#gf-people-count').textContent = shown.length === people.length ? `${people.length}` : `${shown.length} of ${people.length}`;
        const everyone = `<div class="list-item clickable gp-item everyone ${view.person ? '' : 'selected'}" data-person="">
            <span class="chip-icon sm">${icon('users')}</span>
            <div class="grow"><div class="bn-row"><span class="title">Everyone</span><b class="bn-amt">${inYear.length} gifts</b></div>
                <div class="bn-row meta"><span>${people.length} people · ${families(people).length} families</span><span class="bn-left">${view.year === 'all' ? 'all years' : view.year}</span></div></div></div>`;
        if (!shown.length) {
            peopleEl.innerHTML = everyone + `<div class="bn-empty">${icon('search')}${people.length ? 'Nobody matches' : 'No people yet'}</div>`;
            return;
        }
        const groupKey = prefs.group === 'family' ? p => p.family || '' : prefs.group === 'relation' ? p => p.relation || ''
            : prefs.sort === 'name' && shown.length > 15 ? p => (p.name[0] || '#').toUpperCase() : null;
        let html = everyone;
        if (!groupKey) html += shown.map(p => personItem(p, manage)).join('');
        else {
            const groups = new Map();
            shown.forEach(p => { const k = groupKey(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
            const order = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
            const empty = prefs.group === 'family' ? 'No family set' : prefs.group === 'relation' ? 'No relation set' : '#';
            html += order.map(k => {
                const list = groups.get(k);
                const bal = list.reduce((s, p) => s + p.received - p.given, 0);
                return `<div class="section-title bn-sep gp-sep"><span>${prefs.group === 'none' ? '' : icon(prefs.group === 'family' ? 'home' : 'users')}${esc(k || empty)}<i>${list.length}</i></span>
                    ${prefs.group !== 'none' ? `<b class="${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}" title="${bal > 0 ? 'They gave more' : bal < 0 ? 'You gave more' : 'Even'}">${bal ? `${bal > 0 ? '+' : '−'}${moneyShort(Math.abs(bal))}` : 'even'}</b>` : ''}</div>
                    ${list.map(p => personItem(p, manage)).join('')}`;
            }).join('');
        }
        peopleEl.innerHTML = html;
    };
    const markPerson = () => peopleEl.querySelectorAll('[data-person]').forEach(el => el.classList.toggle('selected', (el.dataset.person || null) === view.person));

    // ---- middle: the person's give-and-take, then the gifts
    const drawList = () => {
        const list = listed();
        const p = view.person ? people.find(x => x.key === view.person) : null;
        container.querySelector('.p-gift-list .panel-head h3').innerHTML = `<span class="ico">${icon(p ? 'user' : 'list')}</span>${esc(p ? p.name : 'All gifts')}`;
        $('#gf-list-count').textContent = `${list.length} · ↑${moneyShort(list.filter(g => g.direction === 'GIVEN').reduce((s, g) => s + Number(g.value || 0), 0))} ↓${moneyShort(list.filter(g => g.direction === 'RECEIVED').reduce((s, g) => s + Number(g.value || 0), 0))}`;
        $('#gf-person-head').innerHTML = p ? personHead(p, manage) : '';
        listEl.innerHTML = listHtml(list);
        if (view.open) {
            const row = listEl.querySelector(`tr[data-gift="${view.open}"]`);
            if (row) openRow(row, false); else view.open = null;
        }
        $('#gf-clear').hidden = !(view.dir !== 'all' || view.year !== 'all' || view.person || view.q || view.pq || view.bal !== 'all' || view.circle);
    };

    const drawSide = () => {
        $('#gf-side').innerHTML = `
            <section class="side-card"><div class="side-head">${icon('pie')}<b>Occasions</b></div>
                ${inYear.length ? '<div class="gift-donut"><div class="chart" id="gf-occasions"></div><div class="gift-legend" id="gf-occasions-legend"></div></div>' : emptyState('Nothing yet', 'pie')}</section>
            ${families(people).length ? `<section class="side-card"><div class="side-head">${icon('home')}<b>Families</b><span class="spacer"></span><span class="small muted">${families(people).length}</span></div>${familiesHtml(people)}</section>` : ''}
            <section class="side-card"><div class="side-head">${icon('history')}<b>To return the favour</b></div>${owedBack(people)}</section>
            <section class="side-card"><div class="side-head">${icon('bulb')}<b>Insights</b></div>${insights(inYear, people)}</section>`;
        if (!inYear.length) return;
        const byOcc = new Map();
        inYear.forEach(g => byOcc.set(g.occasion || 'Other', (byOcc.get(g.occasion || 'Other') || 0) + Number(g.value || 0)));
        const items = foldOthers([...byOcc.entries()].map(([label, value]) => ({ label, value })).filter(i => i.value > 0).sort((a, b) => b.value - a.value), 6);
        const total = items.reduce((s, i) => s + i.value, 0);
        if (items.length) {
            donutChart($('#gf-occasions'), { items, format: v => money(v), centerValue: moneyShort(total), centerLabel: 'value' });
            $('#gf-occasions-legend').innerHTML = items.map((it, i) => `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i>
                <span class="ellipsis">${esc(it.label)}</span><b>${percent(it.value / (total || 1) * 100, 0)}</b></div>`).join('');
        }
    };

    const drawAll = () => { scope(); drawOverview(); circleOptions(); drawPeople(); drawList(); drawSide(); };
    const pickPerson = key => {
        view.person = key || null;
        view.open = null;
        markPerson();
        drawList();
    };

    // ---- events: toolbar
    const on = (sel, evt, fn) => $(sel)?.addEventListener(evt, fn);
    on('#gf-dir', 'click', e => {
        const b = e.target.closest('[data-dir]');
        if (!b) return;
        view.dir = b.dataset.dir;
        $('#gf-dir').querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('active', x === b));
        drawList();
    });
    const setYear = y => {
        view.year = y;
        $('#gf-year').querySelectorAll('[data-year]').forEach(x => x.classList.toggle('active', x.dataset.year === y));
        drawAll();
    };
    on('#gf-year', 'click', e => { const b = e.target.closest('[data-year]'); if (b) setYear(b.dataset.year); });
    on('#gf-clear', 'click', () => {
        Object.assign(view, { dir: 'all', year: 'all', person: null, q: '', pq: '', bal: 'all', circle: '', open: null });
        $('#gf-q').value = ''; $('#gf-pq').value = '';
        $('#gf-dir').querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('active', x.dataset.dir === 'all'));
        setYear('all');
    });
    let qTimer;
    on('#gf-q', 'input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { view.q = e.target.value.trim(); drawList(); }, 150); });
    on('#gf-given', 'click', () => openGiftForm(prefillFor(view.person, 'GIVEN'), 'GIVEN', gifts, reload));
    on('#gf-received', 'click', () => openGiftForm(prefillFor(view.person, 'RECEIVED'), 'RECEIVED', gifts, reload));
    const prefillFor = (key, direction) => {
        const p = key && people.find(x => x.key === key);
        return p ? { direction, donation: false, giftDate: isoDate(), kind: 'CASH', person: p.name, relation: p.relation, family: p.family } : null;
    };

    // ---- events: people pane
    const pq = $('#gf-pq');
    let pqTimer;
    pq.addEventListener('input', () => { clearTimeout(pqTimer); pqTimer = setTimeout(() => { view.pq = pq.value; drawPeople(); }, 100); });
    pq.addEventListener('keydown', e => {
        if (e.key === 'Escape' && pq.value) { e.stopPropagation(); pq.value = ''; view.pq = ''; drawPeople(); }
        if (e.key === 'Enter') {   // the first match
            e.preventDefault();
            const first = peopleEl.querySelector('[data-person]:not([data-person=""])');
            if (first) { pickPerson(first.dataset.person); first.scrollIntoView({ block: 'nearest' }); }
        }
    });
    on('#gf-bal', 'click', e => { const b = e.target.closest('[data-bal]'); if (b && !b.disabled) { view.bal = b.dataset.bal; drawPeople(); } });
    on('#gf-circle', 'change', e => { view.circle = e.target.value; drawPeople(); });
    on('#gf-sort', 'change', e => { prefs.sort = e.target.value; savePrefs(); drawPeople(); });
    on('#gf-group', 'change', e => { prefs.group = e.target.value; savePrefs(); drawPeople(); });
    const personClick = e => {
        const give = e.target.closest('[data-give]');
        if (give) {   // "To return the favour": a gift to them, at what they last gave
            e.stopPropagation();
            const p = people.find(x => x.key === give.dataset.give);
            openGiftForm({ direction: 'GIVEN', donation: false, giftDate: isoDate(), kind: 'CASH', person: p.name, relation: p.relation, family: p.family,
                value: p.lastReceived?.kind === 'CASH' ? p.lastReceived.value : null }, 'GIVEN', gifts, reload);
            return;
        }
        const edit = e.target.closest('[data-edit-person]');
        if (edit) { e.stopPropagation(); openPersonForm(people.find(x => x.key === edit.dataset.editPerson), people, reload); return; }
        const fam = e.target.closest('[data-family]');
        if (fam) { view.circle = `fam:${fam.dataset.family}`; circleOptions(); drawPeople(); return; }
        const p = e.target.closest('[data-person]');
        if (p) pickPerson(p.dataset.person);
    };
    peopleEl.addEventListener('click', personClick);
    $('#gf-side').addEventListener('click', personClick);
    $('#gf-person-head').addEventListener('click', e => {
        const act = e.target.closest('[data-head-act]');
        if (!act) return;
        const p = people.find(x => x.key === view.person);
        if (act.dataset.headAct === 'give') openGiftForm(prefillFor(p.key, 'GIVEN'), 'GIVEN', gifts, reload);
        if (act.dataset.headAct === 'received') openGiftForm(prefillFor(p.key, 'RECEIVED'), 'RECEIVED', gifts, reload);
        if (act.dataset.headAct === 'edit') openPersonForm(p, people, reload);
        if (act.dataset.headAct === 'all') pickPerson(null);
    });

    // ---- events: gift rows (open in place, one at a time)
    function openRow(row, toggle = true) {
        const next = row.nextElementSibling;
        const wasOpen = next?.classList.contains('detail-row');
        listEl.querySelectorAll('tr.detail-row').forEach(d => d.remove());
        listEl.querySelectorAll('tr.expanded').forEach(d => d.classList.remove('expanded'));
        if (wasOpen && toggle) { view.open = null; return; }
        const g = gifts.find(x => x.id === Number(row.dataset.gift));
        view.open = g.id;
        row.classList.add('expanded');
        row.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="${row.children.length}">${detailHtml(g, gifts, manage)}</td></tr>`);
    }
    listEl.addEventListener('click', async e => {
        const act = e.target.closest('[data-gift-act]');
        if (act) {
            e.stopPropagation();
            const g = gifts.find(x => x.id === Number(act.dataset.id));
            if (act.dataset.giftAct === 'edit') openGiftForm(g, g.direction, gifts, reload);
            if (act.dataset.giftAct === 'copy') openGiftForm({ ...g, id: null, giftDate: isoDate(), journalEntryId: null, attachmentCount: 0 }, g.direction, gifts, reload);
            if (act.dataset.giftAct === 'return') openGiftForm({ direction: 'GIVEN', donation: false, giftDate: isoDate(), kind: 'CASH', person: g.person,
                relation: g.relation, family: g.family, value: g.kind === 'CASH' ? g.value : null }, 'GIVEN', gifts, reload);
            if (act.dataset.giftAct === 'person') pickPerson(keyOf(g.person));
            if (act.dataset.giftAct === 'delete' && await confirmDialog(`Delete this gift${g.journalEntryId ? ' and its expense' : ''}?`)) {
                try { await api.del(`/gifts/${g.id}`); toast('Gift deleted'); view.open = null; reload(); } catch (error) { toast(error.message, 'error'); }
            }
            return;
        }
        if (e.target.closest('.detail-row')) return;
        const row = e.target.closest('tr[data-gift]');
        if (row) openRow(row);
    });

    // ---- keys: ↑ / ↓ through the people (also from their find box), Enter edits the person, Esc everyone, ← / → year
    let keyTimer;
    const nav = listNavigator({
        items: () => [...peopleEl.querySelectorAll('[data-person]')],
        selected: () => peopleEl.querySelector('[data-person].selected'),
        select: el => {
            peopleEl.querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => pickPerson(el.dataset.person), 120);
        },
        open: el => { if (manage && el.dataset.person) openPersonForm(people.find(x => x.key === el.dataset.person), people, reload); },
        allowWhileTyping: pq,
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if (isTyping()) return false;
        if (e.key === 'Escape' && view.person) { pickPerson(null); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const all = ['all', ...years.slice(0, 5)];
            const i = all.indexOf(view.year) + (e.key === 'ArrowRight' ? 1 : -1);
            if (i >= 0 && i < all.length) setYear(all[i]);
            return true;
        }
        return false;
    });

    bindExport(container.querySelector('.page-toolbar'), () => {
        const list = listed();
        const total = f => inYear.filter(f).reduce((s, g) => s + Number(g.value || 0), 0);
        return {
            title: 'Gifts', subtitle: `${view.year === 'all' ? 'All years' : view.year}${view.dir !== 'all' ? ` · ${view.dir.toLowerCase()}` : ''}`,
            filename: `gifts-${view.year}`,
            summary: [['Given', total(g => g.direction === 'GIVEN' && !g.donation)], ['Received', total(g => g.direction === 'RECEIVED')],
                ['Donations', total(g => g.donation)], ['People', people.length, 'number']],
            sheets: [
                { name: 'Gifts', columns: [{ label: 'Date', type: 'date' }, { label: 'Given / received' }, { label: 'Person' }, { label: 'Relation' }, { label: 'Family' }, { label: 'Occasion' },
                    { label: 'What' }, { label: 'Description' }, { label: 'Quantity' }, { label: 'Value', type: 'money' }, { label: 'Notes' }],
                  rows: list.map(g => [g.giftDate, g.donation ? 'Donation' : g.direction === 'GIVEN' ? 'Given' : 'Received', g.person, g.relation || '', g.family || '', g.occasion || '',
                      KINDS[g.kind].label, g.description || '', g.quantity ? `${number(g.quantity, 2)} ${g.unit || ''}${g.purity ? ` ${g.purity}` : ''}` : '', Number(g.value || 0), g.notes || '']) },
                { name: 'Give and take', columns: [{ label: 'Person' }, { label: 'Relation' }, { label: 'Family' }, { label: 'Given', type: 'money' }, { label: 'Received', type: 'money' },
                    { label: 'Balance', type: 'money' }, { label: 'Gifts', type: 'number' }, { label: 'Last', type: 'date' }],
                  rows: peopleShown().map(p => [p.name, p.relation || '', p.family || '', p.given, p.received, p.received - p.given, p.count, p.last?.giftDate || '']) },
            ],
        };
    });

    drawAll();
    peopleEl.querySelector('[data-person].selected')?.scrollIntoView({ block: 'nearest' });
}

// ===================================================================== pieces

const keyOf = name => name.trim().toLowerCase();

/** Per person (or family): given, received, the balance, the last gift each way, relation and family. */
function ledger(gifts) {
    const map = new Map();
    gifts.forEach(g => {
        const k = keyOf(g.person);
        const p = map.get(k) || { key: k, name: g.person, relation: null, family: null, given: 0, received: 0, givenCount: 0, receivedCount: 0,
            count: 0, last: null, lastReceived: null, lastGiven: null, donation: g.donation };
        if (g.direction === 'GIVEN') { p.given += Number(g.value || 0); p.givenCount++; if (!p.lastGiven || g.giftDate > p.lastGiven.giftDate) p.lastGiven = g; }
        else { p.received += Number(g.value || 0); p.receivedCount++; if (!p.lastReceived || g.giftDate > p.lastReceived.giftDate) p.lastReceived = g; }
        p.count++;
        if (!p.last || g.giftDate > p.last.giftDate) { p.last = g; p.name = g.person; }
        // the newest gift that says it wins
        if (g.relation && (!p.relationOn || g.giftDate >= p.relationOn)) { p.relation = g.relation; p.relationOn = g.giftDate; }
        if (g.family && (!p.familyOn || g.giftDate >= p.familyOn)) { p.family = g.family; p.familyOn = g.giftDate; }
        map.set(k, p);
    });
    return [...map.values()];
}

/** The families in the circle with their people and the balance, largest first. */
function families(people) {
    const map = new Map();
    people.filter(p => p.family).forEach(p => {
        const f = map.get(p.family) || { name: p.family, people: [], given: 0, received: 0 };
        f.people.push(p); f.given += p.given; f.received += p.received;
        map.set(p.family, f);
    });
    return [...map.values()].sort((a, b) => (b.given + b.received) - (a.given + a.received) || a.name.localeCompare(b.name));
}

function personItem(p, manage) {
    const balance = p.received - p.given;
    const total = p.given + p.received || 1;
    const tone = p.donation ? 'red' : balance > 0 ? 'gold' : balance < 0 ? 'aqua' : 'slate';
    return `<div class="list-item clickable gp-item t-${tone} ${view.person === p.key ? 'selected' : ''}" data-person="${esc(p.key)}"
        title="${esc(`${p.name}: you gave ${money(p.given)} (${p.givenCount}), they gave ${money(p.received)} (${p.receivedCount})`)}">
        <span class="avatar sm ${tone}">${esc(initials(p.name))}</span>
        <div class="grow">
            <div class="bn-row"><span class="title">${esc(p.name)}</span>
                <b class="gp-bal ${balance > 0 ? 'owe' : balance < 0 ? 'ahead' : ''}">${balance ? `${balance > 0 ? '+' : '−'}${moneyShort(Math.abs(balance))}` : 'even'}</b></div>
            <div class="bn-row meta"><span class="gp-who">${esc([p.relation, p.family].filter(Boolean).join(' · ') || '—')}</span>
                <span class="bn-left">${p.count}× · ${p.last ? shortDate(p.last.giftDate) : ''}</span></div>
            <i class="gp-bar" title="Given vs received"><em class="g" style="width:${p.given / total * 100}%"></em><em class="r" style="width:${p.received / total * 100}%"></em></i>
        </div>
        ${manage ? `<button class="gp-edit" data-edit-person="${esc(p.key)}" title="Relation, family or spelling of ${esc(p.name)}, on all their gifts">${icon('edit')}</button>` : ''}
    </div>`;
}

/** The selected person over the list: what went each way, the balance, the last gifts and quick actions. */
function personHead(p, manage) {
    const balance = p.received - p.given;
    return `<div class="gp-head">
        <span class="avatar">${esc(initials(p.name))}</span>
        <div class="min-0 gp-head-name"><b class="ellipsis">${esc(p.name)}</b><small class="ellipsis">${esc([p.relation, p.family].filter(Boolean).join(' · ') || 'no relation or family yet')}</small></div>
        <div class="gp-head-stat"><small>You gave</small><b class="neg">${money(p.given)}</b><span>${p.givenCount} gift${p.givenCount === 1 ? '' : 's'}${p.lastGiven ? ` · ${shortDate(p.lastGiven.giftDate)}` : ''}</span></div>
        <div class="gp-head-stat"><small>They gave</small><b class="pos">${money(p.received)}</b><span>${p.receivedCount} gift${p.receivedCount === 1 ? '' : 's'}${p.lastReceived ? ` · ${shortDate(p.lastReceived.giftDate)}` : ''}</span></div>
        <div class="gp-head-stat"><small>Balance</small><b class="${balance > 0 ? 'owe' : ''}">${balance ? money(Math.abs(balance)) : 'Even'}</b><span>${balance > 0 ? 'they gave more' : balance < 0 ? 'you gave more' : 'nothing owed'}</span></div>
        <span class="spacer"></span>
        <div class="gp-head-acts">${manage ? `<button class="btn xs primary" data-head-act="give">${icon('gift')}Give</button>
            <button class="btn xs" data-head-act="received">${icon('arrow-in')}Received</button>
            <button class="btn xs ghost icon" data-head-act="edit" title="Relation, family, spelling">${icon('edit')}</button>` : ''}
            <button class="btn xs ghost icon" data-head-act="all" title="Everyone (Esc)">${icon('x')}</button></div>
    </div>`;
}

function listHtml(list) {
    if (!list.length) return emptyState(view.q || view.dir !== 'all' ? 'No gifts match' : 'No gifts here yet. Record one with "Gift given" or "Received".', 'gift');
    const years = new Map();
    [...list].sort((a, b) => b.giftDate.localeCompare(a.giftDate) || b.id - a.id)
        .forEach(g => { const y = g.giftDate.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y).push(g); });
    return `<table class="grid xp-table gift-table"><thead><tr><th class="c-date">Date</th><th class="c-desc">To / from</th><th class="c-occ">Occasion</th>
        <th class="c-what">What</th><th class="r c-amt">Value</th><th class="c-caret"></th></tr></thead><tbody>
        ${[...years.entries()].map(([y, items]) => `<tr class="day-row"><td colspan="6"><div class="day-head-inner"><b>${y}</b><span class="muted">${items.length} gift${items.length === 1 ? '' : 's'}</span><span class="spacer"></span>
            <span class="neg">↑ ${money(items.filter(g => g.direction === 'GIVEN').reduce((s, g) => s + Number(g.value || 0), 0))}</span>
            <span class="pos">↓ ${money(items.filter(g => g.direction === 'RECEIVED').reduce((s, g) => s + Number(g.value || 0), 0))}</span></div></td></tr>
            ${items.map(row).join('')}`).join('')}</tbody></table>`;
}

const DIR = g => (g.donation ? ['heart', 'red', 'Donation'] : g.direction === 'GIVEN' ? ['arrow-out', 'coral', 'Given'] : ['arrow-in', 'aqua', 'From']);

/** One gift on one line, like an expense: date, to / from whom, occasion, what it was, the value. */
function row(g) {
    const k = KINDS[g.kind] || KINDS.OTHER;
    const dir = DIR(g);
    const qty = g.quantity ? `${number(g.quantity, 2)} ${g.unit || k.unit}${g.purity ? ` ${g.purity}` : ''}` : '';
    const what = [k.label, qty, g.description].filter(Boolean).join(' · ');
    const who = [g.relation, g.family].filter(Boolean).join(' · ');
    return `<tr class="clickable xp-tr gift-row ${g.direction.toLowerCase()} ${view.open === g.id ? 'expanded' : ''}" data-gift="${g.id}">
        <td class="c-date" title="${dayName(g.giftDate)}"><b>${date(g.giftDate)}</b></td>
        <td class="c-desc"><div class="xd-cell">
            <span class="xd-text"><span class="gift-dir ${dir[1]}" title="${dir[2]}">${icon(dir[0])}</span><b title="${esc(g.person)}">${esc(g.person)}</b>${evidenceBadge(g.attachmentCount)}
                ${g.journalEntryId ? `<span class="xp-ico" title="Booked as an expense (${esc(g.entryNo || '')})">${icon('journal')}</span>` : ''}
                ${g.notes ? `<span class="xp-ico" title="${esc(g.notes)}">${icon('info')}</span>` : ''}
                ${g.taxDeductible ? '<span class="fact good">80G</span>' : ''}</span>
            ${who ? `<span class="xd-party" title="${esc(who)}">${esc(who)}</span>` : ''}</div></td>
        <td class="c-occ"><span class="ellipsis ${g.occasion ? '' : 'muted'}">${esc(g.occasion || '—')}</span></td>
        <td class="c-what"><div class="xd-cat"><span class="chip-icon xs ${k.tone}">${icon(k.iconName)}</span><span class="ellipsis" title="${esc(what)}">${esc(what)}</span></div></td>
        <td class="r c-amt"><b class="mono ${g.direction === 'GIVEN' ? 'neg' : 'pos'}">${g.value ? money(g.value) : '—'}</b>${g.kind !== 'CASH' && g.value ? '<small class="muted">est.</small>' : ''}</td>
        <td class="c-caret">${can('POST_TRANSACTIONS') ? `<span class="gr-actions">${g.direction === 'RECEIVED'
            ? `<button class="btn xs ghost" data-gift-act="return" data-id="${g.id}" title="Give ${esc(g.person)} a gift back">${icon('gift')}</button>`
            : `<button class="btn xs ghost" data-gift-act="copy" data-id="${g.id}" title="The same again">${icon('copy')}</button>`}
            <button class="btn xs ghost" data-gift-act="edit" data-id="${g.id}" title="Edit">${icon('edit')}</button></span>` : ''}
            <span class="expand-caret">${icon('chevron-down')}</span></td>
    </tr>`;
}

/** A gift opened in place, kept short like an expense: one line of facts and actions, three small cards, notes, evidence. */
function detailHtml(g, all, manage) {
    const k = KINDS[g.kind] || KINDS.OTHER;
    const fact = (ico, text, title = '') => `<span class="xd-fact" ${title ? `title="${esc(title)}"` : ''}>${icon(ico)}${text}</span>`;
    const line = (label, value, cls = '') => value ? `<div class="xd-line small"><span class="muted">${label}</span><span class="${cls}">${value}</span></div>` : '';
    const theirs = all.filter(x => keyOf(x.person) === keyOf(g.person));
    const gave = theirs.filter(x => x.direction === 'GIVEN').reduce((s, x) => s + Number(x.value || 0), 0);
    const got = theirs.filter(x => x.direction === 'RECEIVED').reduce((s, x) => s + Number(x.value || 0), 0);
    const balance = got - gave;
    return `<div class="xp-detail2 gift-detail2">
        <div class="xd-top">
            ${fact('calendar', `${date(g.giftDate)} · ${dayName(g.giftDate)}`)}
            ${fact(DIR(g)[0], `${g.direction === 'GIVEN' ? 'To' : 'From'} <b>${esc(g.person)}</b>${g.relation ? ` · ${esc(g.relation)}` : ''}`)}
            ${g.family ? fact('home', esc(g.family), 'Family') : ''}
            ${g.occasion ? fact('tag', esc(g.occasion), 'Occasion') : ''}
            ${fact('history', `${dateTime(g.createdAt)} · ${esc(g.createdBy)}`, 'Recorded')}
            <span class="spacer"></span>
            <span class="xd-actions">
                <button class="btn xs ghost" data-gift-act="person" data-id="${g.id}" title="Only ${esc(g.person)}">${icon('user')}Only them</button>
                ${manage ? `<button class="btn xs primary" data-gift-act="edit" data-id="${g.id}">${icon('edit')}Edit</button>
                    ${g.direction === 'RECEIVED' ? `<button class="btn xs" data-gift-act="return" data-id="${g.id}">${icon('gift')}Return</button>` : ''}
                    <button class="btn xs" data-gift-act="copy" data-id="${g.id}">${icon('copy')}Again</button>
                    <button class="btn xs ghost icon danger" data-gift-act="delete" data-id="${g.id}" title="Delete">${icon('trash')}</button>` : ''}
            </span>
        </div>
        <div class="xd-cards">
            <div class="xd-card">
                <div class="xd-card-head">${icon(k.iconName)}${k.label}${g.donation ? ' · donation' : ''}</div>
                <div class="xd-line"><span class="ellipsis">${esc([g.quantity ? `${number(g.quantity, 3)} ${g.unit || k.unit}` : '', g.purity, g.description].filter(Boolean).join(' · ') || k.label)}</span>
                    <b class="mono ${g.direction === 'GIVEN' ? 'neg' : 'pos'}">${g.value ? money(g.value) : '—'}</b></div>
                ${g.kind !== 'CASH' && g.value ? line('Value', 'an estimate') : ''}
                ${line('Paid by', esc(g.mode || ''))}
                ${g.donation ? line('80G', g.taxDeductible ? 'receipt, tax deductible' : 'no receipt', g.taxDeductible ? 'pos' : '') : ''}
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon('users')}With ${esc(g.person)}</div>
                <div class="xd-line small"><span class="muted">You gave</span><span>${theirs.filter(x => x.direction === 'GIVEN').length}× · <b class="mono">${moneyShort(gave)}</b></span></div>
                <div class="xd-line small"><span class="muted">They gave</span><span>${theirs.filter(x => x.direction === 'RECEIVED').length}× · <b class="mono">${moneyShort(got)}</b></span></div>
                <div class="xd-line small"><span class="muted">Balance</span><b class="mono ${balance > 0 ? 'pos' : balance < 0 ? 'neg' : ''}">${balance ? `${moneyShort(Math.abs(balance))} ${balance > 0 ? 'they gave more' : 'you gave more'}` : 'even'}</b></div>
            </div>
            <div class="xd-card">
                <div class="xd-card-head">${icon('journal')}In the books</div>
                ${g.journalEntryId ? `<div class="xd-line small"><span class="muted">Expense</span><b>${esc(g.entryNo || '')}</b></div>${line('Paid from', esc(g.accountName || ''))}`
                    : `<div class="xd-line small"><span class="muted">${g.direction === 'RECEIVED' ? 'A gift is not income: kept beside the books' : 'Not booked as an expense'}</span></div>`}
                ${g.kind === 'GOLD' || g.kind === 'SILVER' ? '<div class="xd-line small"><span class="muted">Keep it under Gold &amp; silver in Accounts for your net worth</span></div>' : ''}
            </div>
        </div>
        ${g.notes ? `<div class="xd-note">${icon('info')}<span>${esc(g.notes)}</span></div>` : ''}
        <div class="xp-evidence" data-ev-gift="${g.id}" data-ev-count="${g.attachmentCount || 0}"></div>
    </div>`;
}

/** Families with their give-and-take; a click filters the people list to the family. */
function familiesHtml(people) {
    const list = families(people).slice(0, 8);
    return `<div class="owed-back">${list.map(f => {
        const bal = f.received - f.given;
        return `<div class="ob-row" data-family="${esc(f.name)}" title="Show only ${esc(f.name)}"><span class="chip-icon sm">${icon('home')}</span>
            <div class="min-0 grow"><b class="ellipsis">${esc(f.name)}</b><small>${f.people.length} ${f.people.length === 1 ? 'person' : 'people'} · ↑${moneyShort(f.given)} ↓${moneyShort(f.received)}</small></div>
            <b class="${bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'muted'}">${bal ? `${bal > 0 ? '+' : '−'}${moneyShort(Math.abs(bal))}` : 'even'}</b></div>`;
    }).join('')}</div>`;
}

/** People who gave you more than you have given them, newest first: the ones to remember at their next occasion. */
function owedBack(people) {
    const list = people.filter(p => !p.donation && p.received > p.given).sort((a, b) => (b.lastReceived?.giftDate || '').localeCompare(a.lastReceived?.giftDate || '')).slice(0, 6);
    if (!list.length) return '<p class="small muted" style="margin:4px 0">Nobody is ahead of you; you have returned every favour.</p>';
    return `<div class="owed-back">${list.map(p => `<div class="ob-row" data-person="${esc(p.key)}"><span class="avatar sm">${esc(initials(p.name))}</span>
        <div class="min-0 grow"><b>${esc(p.name)}</b><small>${p.lastReceived ? `gave ${money(p.lastReceived.value || 0)} · ${esc(p.lastReceived.occasion || KINDS[p.lastReceived.kind].label)} · ${date(p.lastReceived.giftDate)}` : ''}</small></div>
        <b class="pos">+${moneyShort(p.received - p.given)}</b>
        ${can('POST_TRANSACTIONS') ? `<button class="btn xs" data-give="${esc(p.key)}" title="Record a gift to ${esc(p.name)}">${icon('gift')}Give</button>` : ''}</div>`).join('')}</div>`;
}

function insights(gifts, people) {
    const tips = [];
    const tip = (tone, iconName, html) => tips.push(`<div class="insight ${tone}">${icon(iconName)}<div>${html}</div></div>`);
    if (!gifts.length) return emptyState('Record gifts to see patterns', 'bulb');
    const given = gifts.filter(g => g.direction === 'GIVEN');
    const byRel = new Map();
    given.filter(g => !g.donation && g.value).forEach(g => { const r = g.relation || 'Other'; const v = byRel.get(r) || { n: 0, s: 0 }; byRel.set(r, { n: v.n + 1, s: v.s + Number(g.value) }); });
    const topRel = [...byRel.entries()].sort((a, b) => b[1].s - a[1].s)[0];
    if (topRel) tip('info', 'users', `Most of what you give goes to <b>${esc(topRel[0])}</b>: ${money(topRel[1].s)} over ${topRel[1].n} gift${topRel[1].n === 1 ? '' : 's'} (about ${money(Math.round(topRel[1].s / topRel[1].n))} each).`);
    const weddings = given.filter(g => /wedding|marriage/i.test(g.occasion || '') && g.value);
    if (weddings.length >= 2) tip('info', 'heart', `A wedding gift from you is usually around <b>${money(Math.round(weddings.reduce((s, g) => s + Number(g.value), 0) / weddings.length))}</b> (${weddings.length} weddings).`);
    const goldIn = gifts.filter(g => g.kind === 'GOLD' && g.direction === 'RECEIVED').reduce((s, g) => s + Number(g.quantity || 0), 0);
    if (goldIn) tip('good', 'gem', `<b>${number(goldIn, 1)} g</b> of gold came as gifts. Keep it under Gold & silver in Accounts so it counts in your net worth.`);
    const donated = gifts.filter(g => g.donation);
    const no80 = donated.filter(g => !g.taxDeductible).reduce((s, g) => s + Number(g.value || 0), 0);
    if (donated.length) tip(no80 ? 'warn' : 'good', 'percent', no80 ? `${money(no80)} of donations has no 80G receipt; ask the trust for one to claim a deduction.`
        : `Every donation has an 80G receipt: ${money(donated.reduce((s, g) => s + Number(g.value || 0), 0))} may be claimed.`);
    const noProof = gifts.filter(g => !g.attachmentCount && g.value && Number(g.value) >= 5000).length;
    if (noProof) tip('info', 'camera', `${noProof} gift${noProof === 1 ? '' : 's'} of ₹5,000 or more ${noProof === 1 ? 'has' : 'have'} no photo or receipt; add one to remember it.`);
    const ahead = people.filter(p => !p.donation && p.received > p.given).length;
    if (ahead) tip('info', 'history', `${ahead} ${ahead === 1 ? 'person has' : 'people have'} given you more than you gave them; see "To return the favour".`);
    const loose = people.filter(p => !p.donation && !p.family).length;
    if (people.length >= 15 && loose >= 5) tip('info', 'home', `${loose} people have no family yet. Set it once per person (the pencil in the list) to group and find them faster.`);
    return `<div class="insights">${tips.join('')}</div>`;
}

// ===================================================================== forms

/** A person's relation, family and spelling, on all their gifts at once. */
function openPersonForm(p, people, reload) {
    if (!p) return;
    const fams = [...new Set(people.map(x => x.family).filter(Boolean))].sort();
    openModal({
        title: p.name, iconName: 'user',
        body: `<form class="form-grid two" autocomplete="off">
            <p class="span-2 hint" style="margin:0">Applies to all ${p.count} gift${p.count === 1 ? '' : 's'} with ${esc(p.name)}.</p>
            <label class="field span-2"><span>Name</span><input name="newName" value="${esc(p.name)}" maxlength="100" required data-plain></label>
            <label class="field"><span>Relation</span><input name="relation" list="gp-relations" value="${esc(p.relation || '')}" maxlength="40" data-plain></label>
            <label class="field"><span>Family / side</span><input name="family" list="gp-families" value="${esc(p.family || '')}" maxlength="60" placeholder="e.g. Reddy family, Mother's side" data-plain></label>
            <datalist id="gp-relations">${RELATIONS.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
            <datalist id="gp-families">${fams.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
            ${fams.length ? `<div class="span-2 quick-chips" data-fam-chips>${fams.slice(0, 8).map(f => `<button type="button" class="date-chip" data-value="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            form.querySelector('[data-fam-chips]')?.addEventListener('click', e => { const b = e.target.closest('[data-value]'); if (b) form.family.value = b.dataset.value; });
            setTimeout(() => (p.family ? form.relation : form.family).focus(), 40);
        },
        actions: [{ label: 'Cancel' }, {
            label: 'Save', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const { updated } = await api.put('/gifts/person', { person: p.name, relation: d.relation, family: d.family,
                    newName: d.newName && d.newName.trim() !== p.name ? d.newName.trim() : null });
                if (d.newName && view.person === p.key) view.person = keyOf(d.newName);
                toast(`${d.newName || p.name} updated on ${updated} gift${updated === 1 ? '' : 's'}`);
                reload();
            },
        }],
    });
}

async function openGiftForm(gift, direction, all, reload) {
    const saveKey = newRequestKey();   // one key per dialog: a retry or a second click saves once
    const [accounts, categories] = await Promise.all([loadAccounts(), categoriesOf('EXPENSE')]);
    const g = gift || { direction, giftDate: isoDate(), kind: 'CASH', donation: false };
    const giftCat = categories.find(c => /gift|donat/i.test(c.name));
    const persons = [...new Set(all.map(x => x.person))].sort();
    const fams = [...new Set(all.map(x => x.family).filter(Boolean))].sort();
    const editing = gift && gift.id;
    // one click for what you use most: recent people, your relations and occasions, your usual amounts
    const top = (values, n) => [...values.reduce((m, v) => (v ? m.set(v, (m.get(v) || 0) + 1) : m), new Map()).entries()]
        .sort((a, b) => b[1] - a[1]).map(([v]) => v).slice(0, n);
    const recentPeople = [...new Set([...all].sort((a, b) => b.giftDate.localeCompare(a.giftDate)).map(x => x.person))].slice(0, 6);
    const topRelations = [...new Set([...top(all.map(x => x.relation), 5), 'Friend', 'Relative', 'Colleague'])].slice(0, 6);
    const topFamilies = top(all.map(x => x.family), 4);
    const topOccasions = [...new Set([...top(all.map(x => x.occasion), 5), 'Wedding', 'Birthday', 'Housewarming', 'Festival'])].slice(0, 6);
    const usual = top(all.filter(x => x.kind === 'CASH' && x.direction === 'GIVEN' && x.value).map(x => Number(x.value)), 4);
    const amounts = [...new Set([...usual, 501, 1001, 2001, 5001])].sort((a, b) => a - b).slice(0, 6);
    const chips = (name, list) => list.length ? `<div class="quick-chips" data-quick="${name}">${list.map(v => `<button type="button" class="date-chip" data-value="${esc(v)}">${esc(name === 'value' ? moneyShort(v) : v)}</button>`).join('')}</div>` : '';
    const modal = openModal({
        title: editing ? 'Edit gift' : direction === 'GIVEN' ? 'Gift given' : 'Gift received', iconName: 'gift', size: 'lg',
        body: `<form class="form-grid three gift-form" autocomplete="off">
            <div class="span-3 xp-modes three" data-group="dir">
                <button type="button" class="xp-mode ${g.direction === 'GIVEN' && !g.donation ? 'selected' : ''}" data-dir="GIVEN">${icon('arrow-out')}<span>Gift given</span></button>
                <button type="button" class="xp-mode ${g.direction === 'RECEIVED' ? 'selected' : ''}" data-dir="RECEIVED">${icon('arrow-in')}<span>Gift received</span></button>
                <button type="button" class="xp-mode ${g.donation ? 'selected' : ''}" data-dir="DONATION">${icon('heart')}<span>Donation</span></button>
            </div>
            <label class="field span-2"><span data-person-label>${g.direction === 'RECEIVED' ? 'From' : g.donation ? 'To (temple, trust…)' : 'To'} *</span>
                <input name="person" list="gf-persons" value="${esc(g.person || '')}" required maxlength="100" data-plain placeholder="Name or family">
                ${editing || g.person ? '' : chips('person', recentPeople)}</label>
            ${field({ label: 'Date', name: 'giftDate', type: 'date', value: g.giftDate, required: true })}
            <div class="span-3 gift-hint" data-gift-hint hidden></div>
            <label class="field"><span>Relation</span><input name="relation" list="gf-relations" value="${esc(g.relation || '')}" maxlength="40" data-plain>
                ${chips('relation', topRelations)}</label>
            <label class="field"><span>Family / side</span><input name="family" list="gf-families" value="${esc(g.family || '')}" maxlength="60" placeholder="e.g. Reddy family" data-plain>
                ${chips('family', topFamilies)}</label>
            <label class="field"><span>Occasion</span><input name="occasion" list="gf-occasions" value="${esc(g.occasion || '')}" maxlength="60" data-plain>
                ${chips('occasion', topOccasions)}</label>
            <datalist id="gf-persons">${persons.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
            <datalist id="gf-relations">${RELATIONS.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
            <datalist id="gf-families">${fams.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
            <datalist id="gf-occasions">${OCCASIONS.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
            <div class="span-3"><div class="ln-label">What was it</div><div class="gift-kinds" data-group="kind">${Object.entries(KINDS).map(([key, k]) =>
                `<button type="button" class="cat-tile ${g.kind === key ? 'selected' : ''}" data-kind="${key}"><span class="chip-icon sm ${k.tone}">${icon(k.iconName)}</span><span class="cat-name">${k.label}</span></button>`).join('')}</div></div>
            <label class="field"><span data-value-label>${g.kind === 'CASH' ? 'Amount *' : 'Value (estimate)'}</span><input name="value" type="number" step="any" min="0" value="${g.value ?? ''}" data-plain>
                <span data-amount-chips>${chips('value', amounts)}</span></label>
            <label class="field" data-qty><span>Quantity</span><span class="qty-unit"><input name="quantity" type="number" step="any" min="0" value="${g.quantity ?? ''}" data-plain>
                <input name="unit" value="${esc(g.unit || KINDS[g.kind].unit)}" maxlength="10" data-plain class="unit"></span></label>
            <label class="field" data-purity><span>Purity</span><input name="purity" value="${esc(g.purity || '')}" maxlength="20" placeholder="22K / 916" data-plain></label>
            <label class="field" data-mode><span>Paid by</span><select name="mode">${['', 'Cash', 'UPI', 'Bank transfer', 'Cheque'].map(m => `<option ${m === (g.mode || '') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
            ${field({ label: 'Description', name: 'description', value: g.description || '', span: 'span-2', placeholder: 'e.g. Gold chain, silver lamp, envelope' })}
            <label class="check-line span-3" data-80g ${g.donation ? '' : 'hidden'}><input type="checkbox" name="taxDeductible" ${g.taxDeductible ? 'checked' : ''}> 80G receipt (tax deductible)</label>
            <div class="span-3 gift-book" data-book ${g.direction === 'GIVEN' && g.kind === 'CASH' ? '' : 'hidden'}>
                <label class="check-line"><input type="checkbox" name="book" ${g.journalEntryId || !editing ? 'checked' : ''}> Also record it as an expense</label>
                <div class="form-grid two">
                    <label class="field"><span>Paid from</span><select name="bookAccountId">${accountOptions(accounts, a => a.active && ['BANK', 'CASH', 'WALLET', 'CREDIT_CARD'].includes(a.accountType), g.accountId)}</select></label>
                    <label class="field"><span>Category</span><select name="bookCategoryId">${categoryOptions(categories, giftCat?.id)}</select></label>
                </div></div>
            ${field({ label: 'Notes', name: 'notes', value: g.notes || '', span: 'span-3' })}
            <div class="span-3">${evidenceFieldHtml({ label: 'Photo / receipt', hint: 'The gift, the envelope, a receipt' })}</div>
        </form>`,
        onOpen: m => {
            const form = m.el.querySelector('form');
            const state = { dir: g.donation ? 'DONATION' : g.direction, kind: g.kind };
            const sync = () => {
                const isGold = state.kind === 'GOLD' || state.kind === 'SILVER';
                form.querySelector('[data-purity]').hidden = !isGold;
                form.querySelector('[data-qty]').hidden = state.kind === 'CASH';
                form.querySelector('[data-mode]').hidden = state.kind !== 'CASH';
                form.querySelector('[data-value-label]').textContent = state.kind === 'CASH' ? 'Amount *' : 'Value (estimate)';
                form.querySelector('[data-80g]').hidden = state.dir !== 'DONATION';
                form.querySelector('[data-book]').hidden = !(state.dir !== 'RECEIVED' && state.kind === 'CASH');
                form.querySelector('[data-person-label]').textContent = state.dir === 'RECEIVED' ? 'From *' : state.dir === 'DONATION' ? 'To (temple, trust…) *' : 'To *';
                form.querySelector('[data-amount-chips]').hidden = state.kind !== 'CASH';
                form.value.required = state.kind === 'CASH';
                hint();
            };
            // what went each way with this person before, and an amount that matches it; their relation and family
            const hint = () => {
                const box = form.querySelector('[data-gift-hint]');
                const key = form.person.value.trim().toLowerCase();
                const past = key ? all.filter(x => x.person.trim().toLowerCase() === key && x.id !== g.id).sort((a, b) => b.giftDate.localeCompare(a.giftDate)) : [];
                if (!past.length) { box.hidden = true; return; }
                const rel = past.find(x => x.relation)?.relation, fam = past.find(x => x.family)?.family;
                if (!form.relation.value && rel) form.relation.value = rel;
                if (!form.family.value && fam) form.family.value = fam;
                const gave = past.filter(x => x.direction === 'GIVEN'), got = past.filter(x => x.direction === 'RECEIVED');
                const total = l => l.reduce((t, x) => t + Number(x.value || 0), 0);
                const line = x => `${x.value ? money(x.value) : KINDS[x.kind].label}${x.occasion ? ` · ${esc(x.occasion)}` : ''} · ${date(x.giftDate)}`;
                const balance = total(got) - total(gave);
                const lastGot = got.find(x => x.kind === 'CASH' && x.value), lastGave = gave.find(x => x.kind === 'CASH' && x.value);
                box.hidden = false;
                box.innerHTML = `<div class="row"><b>${esc(past[0].person)}</b><span class="muted">${past.length} gift${past.length === 1 ? '' : 's'} before${fam ? ` · ${esc(fam)}` : ''}</span>
                        <span class="spacer"></span><span class="${balance > 0 ? 'pos' : balance < 0 ? 'neg' : 'muted'}">${balance > 0 ? `they gave ${money(balance)} more` : balance < 0 ? `you gave ${money(-balance)} more` : 'even'}</span></div>
                    ${gave[0] ? `<span>${icon('arrow-out')} You gave: ${line(gave[0])}</span>` : ''}
                    ${got[0] ? `<span>${icon('arrow-in')} They gave: ${line(got[0])}</span>` : ''}
                    ${state.dir !== 'RECEIVED' && state.kind === 'CASH' && (lastGot || lastGave) ? `<div class="quick-chips">
                        ${lastGot ? `<button type="button" class="date-chip" data-set-value="${lastGot.value}">Match what they gave · ${money(lastGot.value)}</button>` : ''}
                        ${lastGave ? `<button type="button" class="date-chip" data-set-value="${lastGave.value}">Same as last time · ${money(lastGave.value)}</button>` : ''}</div>` : ''}`;
            };
            let hintTimer;
            form.person.addEventListener('input', () => { clearTimeout(hintTimer); hintTimer = setTimeout(hint, 200); });
            form.person.addEventListener('change', hint);
            form.addEventListener('click', e => {
                const q = e.target.closest('[data-quick] [data-value]');
                if (q) {
                    const name = q.closest('[data-quick]').dataset.quick;
                    form[name].value = q.dataset.value;
                    if (name === 'person') hint();
                    form[name].dispatchEvent(new Event('input', { bubbles: true }));
                    return;
                }
                const sv = e.target.closest('[data-set-value]');
                if (sv) { form.value.value = sv.dataset.setValue; return; }
                const d = e.target.closest('[data-dir]'), k = e.target.closest('[data-kind]');
                if (d) { state.dir = d.dataset.dir; form.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('selected', b === d));
                    if (state.dir === 'DONATION' && !form.relation.value) form.relation.value = 'Temple'; if (state.dir === 'DONATION' && !form.occasion.value) form.occasion.value = 'Donation'; }
                if (k) { state.kind = k.dataset.kind; form.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('selected', b === k)); form.unit.value = KINDS[state.kind].unit; }
                if (d || k) sync();
            });
            form._state = state;
            sync();
            setTimeout(() => (form.person.value ? form.value : form.person).focus(), 40);
        },
        actions: [{ label: 'Cancel' }, {
            label: editing ? 'Save changes' : 'Save gift', kind: 'primary', iconName: 'check',
            onClick: async m => {
                const form = m.el.querySelector('form');
                if (!form.reportValidity()) return true;
                const d = readForm(form);
                const s = form._state;
                const book = s.dir !== 'RECEIVED' && s.kind === 'CASH' && form.book.checked;
                const payload = { direction: s.dir === 'RECEIVED' ? 'RECEIVED' : 'GIVEN', donation: s.dir === 'DONATION', giftDate: d.giftDate, person: d.person,
                    relation: d.relation, family: d.family, occasion: d.occasion, kind: s.kind, description: d.description, value: d.value || null,
                    quantity: s.kind === 'CASH' ? null : d.quantity || null, unit: s.kind === 'CASH' ? null : d.unit, purity: d.purity, mode: s.kind === 'CASH' ? d.mode : null,
                    taxDeductible: s.dir === 'DONATION' && form.taxDeductible.checked, notes: d.notes,
                    bookAccountId: book ? Number(d.bookAccountId) || null : null, bookCategoryId: book ? Number(d.bookCategoryId) || null : null,
                    version: editing ? gift.version : null };
                const saved = editing ? await api.put(`/gifts/${gift.id}`, payload, { key: saveKey }) : await api.post('/gifts', payload, { key: saveKey });
                await evidence.uploadTo(null, { giftId: saved.id });
                toast(`${payload.direction === 'RECEIVED' ? 'Gift from' : payload.donation ? 'Donation to' : 'Gift to'} ${saved.person} saved${saved.entryNo ? ` · expense ${saved.entryNo}` : ''}`);
                view.open = saved.id;
                reload();
            },
        }],
    });
    const evidence = bindEvidenceField(modal.el);
}

// ===================================================================== helpers

function tile(iconName, label, value, note, cls = '') {
    return `<div class="bo-tile ${cls}"><span class="bo-icon">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><span class="bo-note">${note}</span></div></div>`;
}

function initials(name) {
    return name.split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w)).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function dayName(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
}
