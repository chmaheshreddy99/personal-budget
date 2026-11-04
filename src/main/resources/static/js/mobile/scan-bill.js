/**
 * Scan a bill, on the mobile version: the phone reads it and suggests the expense, the person checks it and posts it,
 * the same steps as the app's scanner (mobile-app/src/screens/ScanBill.tsx) with the same reader (bill/receipt.js, generated
 * from the app's): the items, the total, the tax, the category of each item, the check against the total and the count.
 *   start    optionally, what the bill comes to and how many items it has; then photos of it (a long bill in overlapping
 *            parts, they are joined), or type the items
 *   reading  on the phone (bill-ocr.js); a read that does not match is tried again on the cleaned-up photo, twice at most
 *   review   the total and whether the items add up; the check against what was entered; what was corrected, to undo; items
 *            set aside, to put back; the items with their categories; tax and charges; the photos as evidence; what the
 *            phone read, to add a row it missed. Posted as one transaction with a line per item (or per category), or as one
 *            expense. Categories chosen are remembered in this browser for the next bill.
 */
import { api, newRequestKey } from '../core/api.js';
import { icon, hydrateIcons } from '../core/icons.js';
import { isoDate } from '../core/format.js';
import { evidenceFieldHtml, bindEvidenceField } from '../components/evidence.js';
import { getPref, setPref } from '../core/prefs.js';
import { billSum, cleanItemName, countMatches, hasStrayNumber, itemsToPost, learn, lineId, parseReads, shopKey, suggestCategory } from './bill/receipt.js';
import { READ_WAYS, addPage, openReader } from './bill-ocr.js';

const TYPE_ORDER = ['BANK', 'CREDIT_CARD', 'CASH', 'WALLET', 'PAYABLE'];
const MEMORY = 'billMemory';
/** How long reads go on when they do not match, and how many without what the person said to match them to. */
const READING_LIMIT_MS = 120000;
const WAYS_ON_THE_BILLS_WORD = 4;
const WAYS_WITH_NOTHING_TO_CHECK = 3;
const num = t => Number(String(t).replace(/[,₹\s]/g, '')) || 0;
const round2 = v => Math.round(v * 100) / 100;
const rupees = v => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Opens the scanner in a sheet of `sheet`. `onDone` runs after a bill is posted. */
export async function scanBill({ sheet, closeSheet, toast, me, onDone }) {
    const { categories, payers: accounts } = await api.get('/expenses/form-options');
    const payers = [...accounts].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
    const memory = { items: {}, shops: {}, ...getPref(MEMORY, {}) };
    const catName = id => categories.find(c => c.id === id)?.name || '';
    const el = sheet('<div class="sb" data-sb></div>');
    el.querySelector('.m-sheet').classList.add('sb-sheet');
    const root = el.querySelector('[data-sb]');

    const s = { expectTotal: '', expectCount: 0, photos: [], bill: null, lines: [], merchant: '', day: isoDate(), reference: '', totalText: '', account: null,
        asItems: true, oneCategory: null, combine: false, showRows: false, error: '' };
    let reader = null, closed = false;
    const stop = () => { reader?.end(); reader = null; };
    const leave = () => { closed = true; stop(); closeSheet(); };
    let cancelled = false;

    // ------------------------------------------------------------------------------- start
    const drawStart = () => {
        root.innerHTML = `<div class="sb-head"><b>${icon('camera')}Scan a bill</b><button type="button" class="sb-x" data-leave aria-label="Close">${icon('x')}</button></div>
            <p class="sb-hero">${icon('sparkles')}<span>The phone reads the bill, suggests the items with their categories and the total, and you check them before posting. Nothing leaves the phone to read it.</span></p>
            <div class="sb-card">
                <div class="m-label">Before you scan · optional</div>
                <div class="sb-expect">
                    <label class="sb-box"><span>Bill total</span><span class="sb-money">₹<input name="total" inputmode="decimal" placeholder="0" value="${esc(s.expectTotal)}" maxlength="12"></span></label>
                    <div class="sb-box"><span>Items on it</span><span class="sb-step"><button type="button" data-count="-1" aria-label="Fewer">−</button><input name="count" inputmode="numeric" placeholder="–" value="${s.expectCount || ''}" maxlength="2"><button type="button" data-count="1" aria-label="More">+</button></span></div>
                </div>
                <p class="sb-hint">The read is matched to these: another column of numbers, a decimal point missed, a digit misread or a row read twice are tried until it comes right, and each change is shown to undo. Typing the items? This many rows are ready to fill in.</p>
            </div>
            ${s.photos.length ? `<div class="sb-card"><div class="m-label">${s.photos.length === 1 ? 'The photo' : `${s.photos.length} parts of the bill, top to bottom`}</div>
                <div class="sb-thumbs">${s.photos.map((p, i) => `<span class="sb-thumb"><img src="${p.url}" alt="Part ${i + 1}"><button type="button" data-unphoto="${i}" aria-label="Remove">${icon('x')}</button></span>`).join('')}</div>
                <button type="button" class="m-btn primary block" data-read>${icon('sparkles')}Read the bill</button></div>` : ''}
            <label class="sb-option"><input type="file" accept="image/*" capture="environment" data-photo hidden><span class="chip-icon">${icon('camera')}</span><span><b>${s.photos.length ? 'Add the next part' : 'Take a photo'}</b><small>${s.photos.length ? 'A long bill: overlap the last part a little; they are joined.' : 'Flat, straight on and in good light. Best for most bills.'}</small></span></label>
            <label class="sb-option"><input type="file" accept="image/*" multiple data-photo hidden><span class="chip-icon aqua">${icon('upload')}</span><span><b>From the gallery</b><small>Photos of the bill already on the phone: one, or several parts.</small></span></label>
            <button type="button" class="sb-option" data-manual><span class="chip-icon coral">${icon('edit')}</span><span><b>Type the items</b><small>One bill, several things bought: enter each with its category, posted as one transaction.</small></span></button>
            <div class="sb-tips"><b>For a good read</b>
                <span>• Lay the bill flat on a dark surface, without shadows, and fill the picture with it.</span>
                <span>• Hold the phone straight above the bill, not at an angle.</span>
                <span>• A long roll: several photos that overlap a little read better than one from far away.</span></div>
            ${s.error ? `<p class="m-error">${esc(s.error)}</p>` : ''}`;
        hydrateIcons(root);
        root.querySelector('[name=total]').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9.,]/g, ''); s.expectTotal = e.target.value; });
        root.querySelector('[name=count]').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); s.expectCount = Math.min(99, Number(e.target.value) || 0); });
        root.querySelectorAll('[data-count]').forEach(b => b.addEventListener('click', () => {
            s.expectCount = Math.max(0, Math.min(99, s.expectCount + Number(b.dataset.count)));
            root.querySelector('[name=count]').value = s.expectCount || '';
        }));
        root.querySelectorAll('[data-photo]').forEach(input => input.addEventListener('change', () => {
            [...input.files].forEach(f => s.photos.push({ file: f, url: URL.createObjectURL(f) }));
            s.error = '';
            drawStart();
        }));
        root.querySelectorAll('[data-unphoto]').forEach(b => b.addEventListener('click', () => {
            URL.revokeObjectURL(s.photos[Number(b.dataset.unphoto)].url);
            s.photos.splice(Number(b.dataset.unphoto), 1);
            drawStart();
        }));
        root.querySelector('[data-read]')?.addEventListener('click', read);
        root.querySelector('[data-manual]').addEventListener('click', () => {
            s.photos = [];
            apply({ merchant: '', date: null, reference: null, payment: null, total: null, lines: [], rows: [], kind: 'SHOP' }, true);
        });
        root.querySelector('[data-leave]').addEventListener('click', leave);
    };

    // ------------------------------------------------------------------------------- reading
    const drawReading = (note, attempt = '', closest = null) => {
        root.innerHTML = `<div class="sb-reading"><span class="m-spin big"></span><b>Reading the bill…</b><small>${esc(note)}</small>
            <span class="sb-bar"><i style="width:0%"></i></span>
            ${attempt ? `<small class="sb-attempt">${esc(attempt)}</small>` : ''}
            ${closest ? '<button type="button" class="m-btn primary" data-enough>Use the closest so far</button>' : ''}
            <button type="button" class="m-btn" data-cancel>Cancel</button></div>`;
        root.querySelector('[data-cancel]').addEventListener('click', () => { cancelled = true; stop(); s.error = ''; drawStart(); });
        root.querySelector('[data-enough]')?.addEventListener('click', () => { cancelled = true; stop(); apply(closest); });
    };

    /**
     * Each way of reading, every page of the bill, until the reads together match what is expected. It ends: every way once
     * at most, fewer when there is less to match against, and no new way after READING_LIMIT_MS.
     */
    async function read() {
        s.error = '';
        cancelled = false;
        drawReading('Getting the reader ready (the first time it downloads about 10 MB)…');
        const expect = { total: num(s.expectTotal) || null, count: s.expectCount || null };
        let best = null;
        const reads = [];
        const show = (part = 0) => { if (!cancelled && !closed) { const bar = root.querySelector('.sb-bar i'); if (bar) bar.style.width = `${Math.round(part * 100)}%`; } };
        try {
            reader = await openReader(show);
            const started = Date.now();
            const entered = !!(expect.total || expect.count);
            for (const [n, way] of READ_WAYS.entries()) {
                if (cancelled || closed) return;
                drawReading(way.note, n ? `Try ${n + 1} of ${READ_WAYS.length}${best?.fit?.totalOk === false && best.total ? ` · closest is ${rupees(Math.abs(best.total - billSum(best.lines)))} off` : ''}` : '', best);
                let rows = [];
                for (const p of s.photos) {
                    const page = await reader.read(p.file, way);
                    if (cancelled || closed) return;
                    rows = addPage(rows, page);
                }
                if (!rows.length) continue;
                reads.push(rows);
                await new Promise(r => setTimeout(r));   // the screen first: the combinations take a moment
                best = parseReads(reads, expect);
                if (best.fit?.matched && !best.fit.guessed) break;
                if (Date.now() - started > READING_LIMIT_MS) break;
                if (!entered && reads.length >= (best.fit?.totalOk === null || !best.fit ? WAYS_WITH_NOTHING_TO_CHECK : WAYS_ON_THE_BILLS_WORD)) break;
            }
            stop();
            if (cancelled || closed) return;
            if (!best) { s.error = 'Nothing could be read from it. Try again in better light with the bill flat, or type the items.'; drawStart(); return; }
            apply(best);
        } catch (err) {
            stop();
            if (cancelled || closed) return;
            s.error = err.message || 'The bill could not be read';
            drawStart();
        }
    }

    /** The account a bill was paid from: what this shop was paid from before, else by how it was paid, else the first. */
    const guessAccount = b => {
        const remembered = memory.shops[shopKey(b.merchant)]?.accountId;
        if (remembered && payers.some(a => a.id === remembered)) return remembered;
        const want = b.payment === 'CASH' ? ['CASH', 'WALLET'] : b.payment === 'CARD' ? ['CREDIT_CARD', 'BANK'] : b.payment === 'UPI' ? ['BANK'] : [];
        return want.map(t => payers.find(a => a.type === t)).find(Boolean)?.id ?? payers[0]?.id ?? null;
    };

    function apply(b, manual = false) {
        const lines = b.lines.map(l => (l.kind === 'ITEM' ? { ...l, categoryId: suggestCategory(l.name, b.merchant, categories, memory, b.kind) } : l));
        const blanks = manual ? Math.max(1, s.expectCount) : lines.some(l => l.kind === 'ITEM') ? 0 : 1;
        for (let i = 0; i < blanks; i++) lines.push(blank());
        const items = lines.filter(l => l.kind === 'ITEM');
        const byCat = new Map();
        items.forEach(l => { if (l.categoryId) byCat.set(l.categoryId, (byCat.get(l.categoryId) || 0) + l.amount); });
        Object.assign(s, { bill: b, lines, merchant: b.merchant, day: b.date || isoDate(), reference: b.reference || '', account: guessAccount(b),
            totalText: num(s.expectTotal) ? String(num(s.expectTotal)) : b.total ? String(b.total) : '', asItems: manual || items.length > 1, combine: false, showRows: false, error: '',
            oneCategory: [...byCat.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null });
        drawReview();
    }

    const blank = (name = '', amount = 0) => ({ id: lineId(), kind: 'ITEM', name, qty: null, rate: null, amount, counted: true,
        categoryId: name ? suggestCategory(name, s.merchant, categories, memory, s.bill?.kind) : null });

    // ------------------------------------------------------------------------------- review
    const items = () => s.lines.filter(l => l.kind === 'ITEM' && !l.held);
    const total = () => num(s.totalText) || billSum(s.lines);
    const options = selected => `<option value="">Category?</option>${categories.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    let evidence = null;

    function drawReview() {
        root.innerHTML = `<div class="sb-head"><button type="button" class="sb-x" data-back aria-label="Back">${icon('chevron-left')}</button><b>Check and post</b><button type="button" class="sb-x" data-leave aria-label="Close">${icon('x')}</button></div>
            <div data-sums></div>
            <div data-body></div>
            <div class="sb-evidence">${evidenceFieldHtml({ label: 'Photos of the bill · evidence', hint: 'Camera or upload' })}</div>
            <div data-rows></div>
            <p class="m-error" data-error></p>
            <div class="sb-foot"><button type="button" class="m-btn primary block" data-post></button></div>`;
        evidence = bindEvidenceField(root.querySelector('.sb-evidence'));
        s.photos.forEach(p => evidence.add(p.file, p.file.name || 'Bill.jpg', 'CAMERA'));
        root.querySelector('[data-back]').addEventListener('click', () => { s.error = ''; drawStart(); });
        root.querySelector('[data-leave]').addEventListener('click', leave);
        root.querySelector('[data-post]').addEventListener('click', post);
        drawBody();
        drawRows();
        hydrateIcons(root);
    }

    /** The figures: redrawn as amounts are typed, without touching the box being typed in. */
    function drawSums() {
        const list = items();
        const sum = billSum(s.lines);
        const itemSum = round2(list.reduce((t, l) => t + (l.amount || 0), 0));
        const diff = round2(total() - sum);
        const want = num(s.expectTotal);
        const filled = list.filter(l => l.amount > 0).length;
        const count = s.expectCount;
        const countOk = !!count && countMatches(s.lines, count);
        const strays = list.filter(l => l.name && hasStrayNumber(l.name)).length;
        const blanks = list.filter(l => !l.name.trim() || !(l.amount > 0)).length;
        const fit = s.bill?.fit;
        // the total only came from the items: nothing has checked them
        const noTotalRead = !!s.bill?.rows.length && !want && !fit?.totalOk;
        const check = (ok, text) => `<div class="sb-check-line ${ok ? 'ok' : 'off'}">${icon(ok ? 'check-circle' : 'alert')}<span>${esc(text)}</span></div>`;
        const host = root.querySelector('[data-sums]');
        const typing = document.activeElement?.name === 'billTotal';
        if (!typing) {
            host.innerHTML = `<div class="sb-total"><label><span>Bill total</span><span class="sb-total-in">₹<input name="billTotal" inputmode="decimal" value="${esc(s.totalText)}" placeholder="${sum || 0}"></span></label><div data-total-side></div></div><div data-checks></div>`;
            host.querySelector('[name=billTotal]').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9.,]/g, ''); s.totalText = e.target.value; drawSums(); });
            host.querySelector('[name=billTotal]').addEventListener('blur', () => drawSums());
        }
        host.querySelector('[data-total-side]').innerHTML = `<small>Items ${rupees(itemSum)}</small>
            ${s.lines.some(l => l.kind !== 'ITEM' && l.counted) ? `<small>Tax & charges ${rupees(round2(sum - itemSum))}</small>` : ''}
            <em class="${Math.abs(diff) > 1 || noTotalRead || fit?.guessed ? 'off' : 'ok'}">${Math.abs(diff) <= 1 ? (noTotalRead ? 'No total read to check' : fit?.guessed ? 'Adds up with a digit guessed: check it' : 'Adds up') : `${diff > 0 ? '+' : '−'}${rupees(Math.abs(diff))} not in the items`}</em>`;
        host.querySelector('[data-checks]').innerHTML = `
            ${want || count ? `<div class="sb-card sb-check"><div class="m-label">Check against what you entered</div>
                ${want ? check(Math.abs(want - sum) <= 1, Math.abs(want - sum) <= 1 ? `The items come to the ${rupees(want)} you entered` : `The items come to ${rupees(sum)}: ${rupees(Math.abs(want - sum))} ${want > sum ? 'short of' : 'over'} the ${rupees(want)} you entered`) : ''}
                ${count ? check(countOk, countOk ? (filled === count ? `${filled} items, as you said` : `${count} pieces across ${filled} items, as you said`)
                    : filled < count ? `${filled} of the ${count} items: ${count - filled} missing${fit?.missing ? `, about ${rupees(fit.missing)} in all` : ''} (add ${count - filled === 1 ? 'it' : 'them'}, or tap a row the phone read below)`
                        : `${filled} items: ${filled - count} more than the ${count} you said`) : ''}
                ${strays || blanks ? check(false, [strays ? `${strays} name${strays === 1 ? ' has' : 's have'} a number that is not a size` : '', blanks ? `${blanks} item${blanks === 1 ? '' : 's'} without a name or an amount` : ''].filter(Boolean).join(' · ')) : ''}
                ${s.bill?.printedTotal && want && Math.abs(s.bill.printedTotal - want) > 1 ? `<button type="button" class="sb-link" data-use-printed>The bill reads ${rupees(s.bill.printedTotal)} as its total. Use it</button>` : ''}
            </div>` : ''}
            ${fit?.steps.length ? `<div class="sb-card sb-check"><div class="m-label">${fit.matched ? 'Corrected to match' : 'What was tried'} · ${fit.against === 'ENTERED' ? 'what you entered' : 'the bill\'s total'}</div>
                ${fit.steps.map(t => `<div class="sb-step-line">• ${esc(t)}</div>`).join('')}
                <p class="sb-hint">Checked in ${fit.tries.toLocaleString('en-IN')} ${fit.tries === 1 ? 'try' : 'tries'}. Check the changed amounts against the bill.</p></div>` : ''}
            ${Math.abs(diff) > 1 && list.length ? `<div class="sb-note"><span>The items come to ${rupees(sum)}. When posting, the difference is spread over the items in proportion, or add it as its own line.</span>
                <button type="button" class="m-btn block" data-diff>${diff > 0 ? `Add ${rupees(diff)} as a line` : `Add ${rupees(-diff)} discount`}</button></div>` : ''}`;
        const checks = host.querySelector('[data-checks]');
        checks.querySelector('[data-use-printed]')?.addEventListener('click', () => { s.totalText = String(s.bill.printedTotal); host.querySelector('[name=billTotal]').value = s.totalText; drawSums(); });
        checks.querySelector('[data-diff]')?.addEventListener('click', () => {
            if (diff > 0) addItem('Other charges', diff);
            else s.lines.push({ id: lineId(), kind: 'DISCOUNT', name: 'Discount', qty: null, rate: null, amount: -diff, categoryId: null, counted: true });
            drawBody();
        });
        hydrateIcons(host);
        const n = filled;
        root.querySelector('[data-post]').innerHTML = `${icon('check')}${me.approval ? 'Send for approval' : 'Post'} ${rupees(total())}${s.asItems && list.length > 1 ? ` · ${s.combine ? 'by category' : `${n} items`}` : ''}`;
        const seg = root.querySelector('[data-seg-items]');
        if (seg) seg.textContent = `Itemized · ${n} items`;
        hydrateIcons(root.querySelector('[data-post]'));
    }

    const addItem = (name = '', amount = 0) => {
        s.lines = [...s.lines.filter(l => l.kind === 'ITEM'), blank(name, amount), ...s.lines.filter(l => l.kind !== 'ITEM')];
    };
    const line = id => s.lines.find(l => l.id === id);

    function drawBody() {
        const list = items();
        const held = s.lines.filter(l => l.kind === 'ITEM' && l.held);
        const adj = s.lines.filter(l => l.kind !== 'ITEM');
        const missing = list.filter(l => l.amount > 0 && !l.categoryId).length;
        const host = root.querySelector('[data-body]');
        host.innerHTML = `
            ${held.length ? `<div class="sb-held"><div class="m-label">Set aside · ${held.length}</div>${held.map(l => `<div class="sb-held-row"><div><b>${esc(l.name || 'Unnamed')} · ${rupees(l.amount)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ''}</div><button type="button" class="sb-link" data-unhold="${l.id}">${icon('rotate-ccw')}Put back</button></div>`).join('')}</div>` : ''}
            <div class="sb-two">
                <label class="m-field"><span>Shop / paid to</span><input data-f="merchant" value="${esc(s.merchant)}" maxlength="100" placeholder="Shop"></label>
                <label class="m-field"><span>Date</span><input type="date" data-f="day" value="${esc(s.day)}" max="${isoDate()}"></label>
            </div>
            <div class="m-label">Paid from</div>
            <div class="m-pick" data-payers>${payers.map(a => `<button type="button" class="m-pick-chip ${a.id === s.account ? 'on' : ''}" data-payer="${a.id}">${esc(a.name)}</button>`).join('')}</div>
            <div class="sb-seg"><button type="button" class="${s.asItems ? 'on' : ''}" data-as="items"><span data-seg-items></span></button><button type="button" class="${s.asItems ? '' : 'on'}" data-as="one">One expense</button></div>
            ${s.asItems ? '<p class="sb-hint">One transaction, a line for each item in its own category: the budget sees groceries, household and snacks separately.</p>'
                : `<select class="m-select" data-one>${options(s.oneCategory).replace('Category?', 'Choose the category')}</select>`}
            <div class="sb-items-head"><div class="m-label">Items</div>${s.asItems && missing ? `<select class="sb-all" data-all><option value="">Category for ${missing} without…</option>${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>` : ''}</div>
            ${list.map(l => `<div class="sb-item" data-line="${l.id}">
                <div class="sb-item-top"><input class="sb-name" data-name value="${esc(l.name)}" placeholder="What was it" maxlength="120"><input class="sb-amt" data-amount inputmode="decimal" value="${l.amount || ''}" placeholder="0"><button type="button" class="sb-del" data-remove aria-label="Remove">${icon('trash')}</button></div>
                <div class="sb-item-meta">${s.asItems ? `<select class="sb-cat ${l.categoryId ? '' : 'none'}" data-cat>${options(l.categoryId)}</select>` : ''}
                    ${l.qty && l.rate ? `<small>${l.qty} × ${rupees(l.rate)}</small>` : ''}
                    ${l.readAs != null ? `<button type="button" class="sb-fixed" data-undo>${icon('rotate-ccw')}Read as ${rupees(l.readAs)}${l.fix ? `: ${esc(l.fix)}` : ''} · undo</button>` : l.fix ? `<small>Added: ${esc(l.fix)}</small>` : ''}
                    ${l.name && hasStrayNumber(l.name) ? `<button type="button" class="sb-stray" data-stray>${icon('alert')}Number in the name · tap to keep only sizes</button>` : ''}</div></div>`).join('')}
            <button type="button" class="m-btn block" data-add>${icon('plus')}Add an item</button>
            ${s.asItems && list.length > 3 ? `<label class="sb-switch"><span><b>One line per category</b><small>Items of the same category posted together (their names kept in the line).</small></span><input type="checkbox" data-combine ${s.combine ? 'checked' : ''}></label>` : ''}
            ${adj.length ? `<div class="m-label">Tax, charges & discounts</div>${adj.map(l => `<label class="sb-adj"><span><b>${esc(l.name)}</b><small>${l.counted ? 'Counted in the bill' : l.kind === 'TAX' ? 'Inside the prices (not added)' : 'Not counted'}</small></span><em class="${l.kind === 'DISCOUNT' ? 'pos' : ''}">${l.kind === 'DISCOUNT' ? '−' : ''}${rupees(l.amount)}</em><input type="checkbox" data-adj="${l.id}" ${l.counted ? 'checked' : ''}></label>`).join('')}
                <p class="sb-hint">What counts is spread over the items when posting, so each category carries its share of tax and discount.</p>` : ''}
            <label class="m-field"><span>Bill / reference no. <small>optional</small></span><input data-f="reference" value="${esc(s.reference)}" maxlength="60"></label>`;
        hydrateIcons(host);
        host.querySelectorAll('[data-f]').forEach(i => i.addEventListener('input', () => { s[i.dataset.f] = i.value; }));
        host.querySelectorAll('[data-payer]').forEach(b => b.addEventListener('click', () => {
            s.account = Number(b.dataset.payer);
            host.querySelectorAll('[data-payer]').forEach(x => x.classList.toggle('on', x === b));
        }));
        host.querySelectorAll('[data-as]').forEach(b => b.addEventListener('click', () => { s.asItems = b.dataset.as === 'items'; drawBody(); }));
        host.querySelector('[data-one]')?.addEventListener('change', e => { s.oneCategory = Number(e.target.value) || null; });
        host.querySelector('[data-all]')?.addEventListener('change', e => {
            const id = Number(e.target.value);
            if (id) s.lines.forEach(l => { if (l.kind === 'ITEM' && !l.categoryId) l.categoryId = id; });
            drawBody();
        });
        host.querySelector('[data-combine]')?.addEventListener('change', e => { s.combine = e.target.checked; drawSums(); });
        host.querySelector('[data-add]').addEventListener('click', () => { addItem(); drawBody(); });
        host.querySelectorAll('[data-unhold]').forEach(b => b.addEventListener('click', () => {
            Object.assign(line(b.dataset.unhold), { held: false, note: undefined });
            drawBody();
        }));
        host.querySelectorAll('[data-adj]').forEach(i => i.addEventListener('change', () => { line(i.dataset.adj).counted = i.checked; drawBody(); }));
        host.querySelectorAll('[data-line]').forEach(row => {
            const l = line(row.dataset.line);
            row.querySelector('[data-name]').addEventListener('input', e => { l.name = e.target.value; });
            // a name typed in takes its category, when none was chosen
            row.querySelector('[data-name]').addEventListener('change', () => {
                if (!l.categoryId && l.name.trim()) l.categoryId = suggestCategory(l.name, s.merchant, categories, memory, s.bill?.kind);
                drawBody();
            });
            row.querySelector('[data-amount]').addEventListener('input', e => { l.amount = num(e.target.value); l.readAs = undefined; l.fix = undefined; drawSums(); });
            row.querySelector('[data-cat]')?.addEventListener('change', e => { l.categoryId = Number(e.target.value) || null; e.target.classList.toggle('none', !l.categoryId); });
            row.querySelector('[data-remove]').addEventListener('click', () => { s.lines = s.lines.filter(x => x !== l); drawBody(); });
            row.querySelector('[data-undo]')?.addEventListener('click', () => { l.amount = l.readAs; l.readAs = undefined; l.fix = undefined; drawBody(); });
            row.querySelector('[data-stray]')?.addEventListener('click', () => { l.name = cleanItemName(l.name); drawBody(); });
        });
        drawSums();
    }

    function drawRows() {
        const rows = s.bill?.rows || [];
        const host = root.querySelector('[data-rows]');
        host.innerHTML = rows.length ? `<div class="sb-card sb-rows"><button type="button" class="sb-rows-head" data-toggle><b>What the phone read · ${rows.length} rows</b>${icon(s.showRows ? 'chevron-up' : 'chevron-down')}</button>
            ${s.showRows ? `<div class="sb-rows-note"><span>Tap a row to add it as an item.</span><button type="button" class="sb-link" data-share>Share rows</button></div>
                ${rows.map((r, i) => `<button type="button" class="sb-raw" data-row="${i}">${esc(r)}</button>`).join('')}` : ''}</div>` : '';
        hydrateIcons(host);
        host.querySelector('[data-toggle]')?.addEventListener('click', () => { s.showRows = !s.showRows; drawRows(); });
        host.querySelector('[data-share]')?.addEventListener('click', async () => {
            const text = rows.join('\n');
            try {
                if (navigator.share) await navigator.share({ text });
                else { await navigator.clipboard.writeText(text); toast('The rows are copied'); }
            } catch { /* the person changed their mind */ }
        });
        host.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', () => {
            const row = rows[Number(b.dataset.row)];
            const m = row.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
            addItem(cleanItemName(row.replace(/(\d[\d,]*(?:\.\d{1,2})?)\s*$/, '')), m ? num(m[1]) : 0);
            drawBody();
            toast('Added to the items');
        }));
    }

    // ------------------------------------------------------------------------------- posting
    const requestKey = newRequestKey();
    let busy = false;
    async function post() {
        if (busy) return;
        const error = root.querySelector('[data-error]');
        const fail = text => { error.textContent = text; error.scrollIntoView({ block: 'center' }); };
        error.textContent = '';
        const payer = payers.find(a => a.id === s.account);
        const amount = round2(total());
        if (!payer) return fail('Choose the account it was paid from');
        if (!(amount > 0)) return fail('Enter the bill total');
        const merchant = s.merchant.trim();
        const body = { entryDate: s.day, amount, paidFromId: payer.id, party: merchant, reference: s.reference.trim(), narration: merchant ? `${merchant} bill` : 'Bill' };
        let what = '';
        if (s.asItems) {
            const missing = items().filter(l => l.amount > 0 && !l.categoryId).length;
            if (missing) return fail(`Choose a category for ${missing === 1 ? 'the item' : `the ${missing} items`} without one (or post it as one expense)`);
            const posted = itemsToPost(s.lines, amount, catName, s.combine);
            if (!posted.length) return fail('Add the items, each with its amount');
            if (posted.length > 1) { body.items = posted.map(i => ({ categoryId: i.categoryId, amount: i.amount, name: i.name })); what = `${posted.length} items`; }
            else { body.categoryId = posted[0].categoryId; what = posted[0].categoryName; }
        } else {
            if (!s.oneCategory) return fail('Choose the category');
            body.categoryId = s.oneCategory;
            what = catName(s.oneCategory);
        }
        busy = true;
        const btn = root.querySelector('[data-post]');
        btn.disabled = true;
        btn.innerHTML = '<span class="m-spin"></span>Saving…';
        try {
            const saved = await api.post('/expenses', body, { key: requestKey });
            const files = evidence?.count || 0;
            if (files) await evidence.uploadTo(saved?.pending ? null : saved.id, { pendingId: saved?.pending ? saved.id : null });
            setPref(MEMORY, learn(memory, merchant, items().filter(l => l.categoryId && l.name).map(l => ({ name: l.name, categoryId: l.categoryId, amount: l.amount })), payer.id));
            leave();
            toast(`${saved?.pending ? `${rupees(amount)} sent for approval` : `${what} · ${rupees(amount)} saved`}${files ? ` with ${files} photo${files === 1 ? '' : 's'}` : ''}`);
            onDone?.();
        } catch (err) {
            fail(err.message);
            busy = false;
            btn.disabled = false;
            drawSums();
        }
    }

    drawStart();
}
