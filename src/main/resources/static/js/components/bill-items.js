/**
 * The items of a bill paid at once (the supermarket run: groceries, eggs, cosmetics ...), inside the expense dialog.
 * One payment from one account; each item has its own category, so every category's spending and budget stay right.
 *
 *   Each item: what it was (optional), its category, what it cost (sums such as 2*70 work).
 *   The category tiles of the dialog pick the category of the item being edited (Alt+1…9 and the search too);
 *   typing what it was picks one by itself (eggs → Eggs, cashews → Dry Fruits, shampoo → Personal Care).
 *   The bill total follows the items, or, once typed (or when splitting an expense of a known amount), stays fixed:
 *   then the first item left without an amount takes the rest of the bill.
 *   Enter moves on: what → amount → the next item. Ctrl+Enter saves.
 *   Checked as you type: amounts take only figures (and + - * / for sums); an amount that is not a number or not above
 *   zero, or items adding up to more than a fixed bill, are marked and keep the bill from being saved (onValidity).
 *   Switching the dialog to another kind (Paid for, Lent, EMI) only puts the items aside (pause); they come back as
 *   they were on Expense (resume).
 *
 *   const bill = bindBillItems(form, { categories, onChange, onActive, onValidity });
 *   bill.enter({ items, fixed });   bill.exit();   bill.pause();   bill.resume();   bill.pick(categoryId);
 *   bill.collect() -> { total, items }
 */
import { esc } from '../core/ui.js';
import { icon, categoryIcon } from '../core/icons.js';
import { money, percent } from '../core/format.js';
import { evalAmount } from './expense-dialog.js';

/** What an item's name says about its category: a pattern on the name, and the category it points to. */
const ITEM_HINTS = [
    [/\beggs?\b|\banda\b/i, /^eggs?$/i],
    [/cashew|almond|badam|kaju|raisin|kishmish|pista|walnut|akhrot|\bdates\b|khajur|anjeer|\bfigs?\b|dry ?fruit|\bnuts?\b|makhana/i, /dry fruit/i],
    [/apple|banana|mango|orange|grape|papaya|guava|pomegranate|melon|pineapple|kiwi|fruit|chiko|sapota|\bpears?\b|strawberr|litchi|custard apple/i, /^fruits?$/i],
    [/onion|potato|tomato|carrot|\bbeans\b|brinjal|cabbage|cauliflower|spinach|palak|okra|bhindi|capsicum|cucumber|ginger|garlic|chill?i|coriander|methi|vegetable|sabzi|greens|gourd|drumstick leaves|curry leaves|lemon/i, /vegetable/i],
    [/chicken|mutton|\bfish\b|prawn|\bmeat\b|keema|seafood|crab/i, /meat|fish/i],
    [/milk|curd|paneer|butter|ghee|cheese|yogh?urt|dahi|buttermilk/i, /milk|dairy/i],
    [/shampoo|conditioner|soap|lotion|\bcream\b|lipstick|cosmetic|makeup|\bdeo\b|deodorant|perfume|toothpaste|toothbrush|razor|face ?wash|sunscreen|kajal|nail|hair oil|sanitary|pads/i, /personal care|cosmetic|beauty/i],
    [/medicine|tablet|syrup|pharma|bandage|ointment/i, /pharma|medicine/i],
    [/chips|chocolate|snack|juice|cold ?drink|\bcoke\b|pepsi|namkeen|cookies|ice ?cream|soft drink/i, /snack|beverage/i],
    [/millet|ragi|jowar|bajra|foxtail|kodo|barnyard|browntop|korra|samai|sama|arikelu|varagu|kambu|cholam|navane|saame|udalu/i, /^millets?$/i],
    [/cold.?press|wood.?press|ghani|chekku|kachi|kolhu|virgin/i, /cold.?press/i],
    [/\boils?\b|sunflower|rice bran|refined|groundnut oil|palm oil|soyabean|soybean|mustard oil|sesame oil|gingelly/i, /refined oil/i],
    [/petrol|diesel|\bcng\b|fuel/i, /^fuel$/i],
    [/\bbus\b|metro|train|railway|\bticket|travel pass|school van|school bus/i, /^transport/i],
    [/rice|\bdal\b|atta|flour|sugar|salt|masala|spice|tea powder|biscuit|grocer|wheat|rava|poha|detergent|surf|dishwash|cleaner|tissue|bread/i, /^groceries$|grocer/i],
    [/notebook|\bpens?\b|pencil|stationer|\bbooks?\b/i, /book|stationer/i],
    [/pet food|dog food|cat food|pedigree|whiskas/i, /\bpets?\b/i],
];

/** What an amount box takes: figures, a decimal point, digit grouping and + - * / ( ) for sums. */
const NOT_AMOUNT = /[^0-9.,+\-*/() ]/;
const NOT_AMOUNT_ALL = /[^0-9.,+\-*/() ]/g;
/** The biggest amount one item or bill can be. */
const MAX_AMOUNT = 1e9;

/** Keeps letters and other characters out of an amount box, typed or pasted; a refused key flashes the box. */
export function amountOnly(input) {
    const refuse = el => { el.classList.remove('bad-key'); void el.offsetWidth; el.classList.add('bad-key'); };
    input.addEventListener('beforeinput', e => {
        if (e.data && NOT_AMOUNT.test(e.data)) { e.preventDefault(); refuse(input); }
    });
    input.addEventListener('input', () => cleanAmount(input, refuse));
}

function cleanAmount(input, refuse = () => {}) {
    if (!NOT_AMOUNT.test(input.value)) return;
    const at = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, at).replace(NOT_AMOUNT_ALL, '').length;
    input.value = input.value.replace(NOT_AMOUNT_ALL, '');
    try { input.setSelectionRange(before, before); } catch { /* not focused */ }
    refuse(input);
}

export function bindBillItems(form, { categories, onChange = () => {}, onActive = () => {}, onValidity = () => {} }) {
    const box = form.querySelector('[data-items]');
    let items = [];
    let active = 0;
    let fixed = false;   // the bill total was typed (or is the expense being split): it stays, the rest goes to an item
    let on = false;
    let paused = false;   // put aside while the dialog records something else (Paid for, Lent, EMI)

    const blank = () => ({ categoryId: '', name: '', amount: '', manual: false });
    const categoryOf = id => categories.find(c => String(c.id) === String(id));
    const bill = () => evalAmount(form.amount.value);
    const valueOf = it => (String(it.amount).trim() ? evalAmount(it.amount) : null);
    const isEmpty = it => !it.name.trim() && !it.categoryId && !String(it.amount).trim();
    /** The item that takes the rest of a fixed bill: the first one without an amount. */
    const restIndex = () => (fixed ? items.findIndex(it => !String(it.amount).trim() && !isEmpty(it)) : -1);
    const known = () => items.reduce((s, it) => s + (valueOf(it) || 0), 0);
    const round = v => Math.round(v * 100) / 100;

    function guess(name) {
        const text = name.trim().toLowerCase();
        if (text.length < 3) return null;
        const words = text.split(/\s+/).filter(w => w.length >= 3);
        // a category named in it ("eggs", "fruits"; the one with the most words in it), then what the words usually are
        const same = (n, w) => n.length >= 3 && (n === w || n === w.replace(/s$/, '') || n.replace(/s$/, '') === w);
        const scored = categories.filter(c => !c.systemKey)
            .map(c => ({ c, score: c.name.toLowerCase().split(/[^a-z]+/).filter(n => words.some(w => same(n, w))).length }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);
        if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].c;
        for (const [pattern, target] of ITEM_HINTS) {
            if (!pattern.test(text)) continue;
            const hit = categories.find(c => !c.systemKey && target.test(c.name));
            if (hit) return hit;
        }
        return null;
    }

    function catButton(it) {
        const c = categoryOf(it.categoryId);
        if (!c) return `${icon('tag')}<span class="ellipsis">Category</span>`;
        const ci = categoryIcon(c.name);
        return `<span class="chip-icon xs ${ci.tone}">${icon(ci.name)}</span><span class="ellipsis">${esc(c.name)}</span>`;
    }

    function rowHtml(it, i) {
        const c = categoryOf(it.categoryId);
        return `<div class="bi-row ${i === active ? 'active' : ''}" data-item="${i}">
            <span class="bi-no">${i + 1}</span>
            <input class="bi-name" data-item-name value="${esc(it.name)}" placeholder="What? e.g. eggs, shampoo" maxlength="120" autocomplete="off" data-plain data-enter-self>
            <button type="button" class="bi-cat ${c ? '' : 'empty'}" data-item-cat title="${c ? `${esc(c.name)} · pick a tile to change it` : 'Pick its category from the tiles below'}">${catButton(it)}</button>
            <input class="bi-amt num" data-item-amt value="${esc(it.amount)}" inputmode="decimal" placeholder="0" autocomplete="off" data-plain data-enter-self title="You can type a sum: 2*70">
            <button type="button" class="btn ghost icon xs bi-del" data-item-del title="Remove this item">${icon('x')}</button>
        </div>`;
    }

    function render(focus = null) {
        box.innerHTML = `<div class="bi-list">${items.map(rowHtml).join('')}</div>
            <div class="bi-tail">
                <button type="button" class="btn xs" data-item-add>${icon('plus')}Add item</button>
                <span class="bi-sum" data-item-sum></span>
            </div>
            <div class="bi-problem" data-item-problem role="alert"></div>`;
        refresh();
        if (focus) box.querySelector(`[data-item="${focus.index}"] ${focus.field}`)?.focus();
    }

    const rowEl = i => box.querySelector(`[data-item="${i}"]`);

    function setActive(i) {
        if (i === active && rowEl(i)?.classList.contains('active')) return;
        active = Math.max(0, Math.min(i, items.length - 1));
        box.querySelectorAll('.bi-row').forEach(r => r.classList.toggle('active', Number(r.dataset.item) === active));
        onActive(items[active]?.categoryId || '', active);
    }

    /** What is wrong with an item's amount as typed (null when nothing). */
    function amountProblem(it) {
        if (!String(it.amount).trim()) return null;
        const v = valueOf(it);
        if (v === null) return 'not a number or a sum';
        if (v <= 0) return 'must be more than zero';
        if (v > MAX_AMOUNT) return 'is too large';
        return null;
    }

    /**
     * What keeps the bill from being saved right now: an amount that is not a number (or not above zero), items adding
     * up to more than a fixed bill, or nothing of the bill left for the item meant to take the rest.
     */
    function blocking() {
        const bad = items.findIndex(it => amountProblem(it));
        if (bad >= 0) return `Item ${bad + 1}: the amount ${amountProblem(items[bad])}`;
        const total = bill();
        if (fixed && total !== null) {
            const over = round(known() - total);
            if (over > 0.004) return `The items add up to ${money(round(known()))}, ${money(over)} more than the bill of ${money(total)}`;
            const rest = restIndex();
            if (rest >= 0 && over > -0.005) return `Nothing of the bill is left for item ${rest + 1}`;
        }
        if (!fixed && known() > MAX_AMOUNT) return 'The bill is too large';
        return null;
    }

    /** Placeholders, the rest of the bill, the total line; and, while the total follows the items, the amount box. */
    function refresh() {
        const rest = restIndex();
        const sum = known();
        const total = bill();
        if (!fixed) form.amount.value = sum ? String(round(sum)) : '';
        const over = fixed && total !== null && round(sum - total) > 0.004;
        items.forEach((it, i) => {
            const input = rowEl(i)?.querySelector('[data-item-amt]');
            if (!input) return;
            const left = fixed && total !== null ? round(total - sum) : null;
            const problem = amountProblem(it);
            input.placeholder = i === rest && left !== null ? `rest ${money(Math.max(0, left))}` : '0';
            input.classList.toggle('is-rest', i === rest);
            input.classList.toggle('invalid', !!problem || (over && valueOf(it) > 0) || (i === rest && left !== null && left <= 0));
            input.title = problem ? `This amount ${problem}` : i === rest ? 'Left blank: it takes what is left of the bill' : 'You can type a sum: 2*70';
        });
        const problem = blocking();
        form.amount.classList.toggle('invalid', over);
        box.classList.toggle('has-problem', !!problem);
        onValidity(!problem, problem);
        const count = items.filter(it => !isEmpty(it)).length;
        const line = box.querySelector('[data-item-sum]');
        if (!line) return;
        const noun = `${count} item${count === 1 ? '' : 's'}`;
        if (!fixed) {
            line.innerHTML = `${noun} · <b>${money(round(sum))}</b> <span class="muted" title="Type a bill total in the amount box to fix it">· the total follows the items</span>`;
        } else {
            const left = total === null ? 0 : round(total - sum);
            const status = total === null ? '<span class="muted">type the bill total</span>'
                : left < -0.004 ? `<span class="neg">${icon('alert')}${money(-left)} over the bill: lower an item or correct the bill total</span>`
                : rest >= 0 ? (left > 0 ? `<span class="muted">rest ${money(left)} to item ${rest + 1}</span>` : `<span class="neg">nothing left for item ${rest + 1}</span>`)
                : left > 0.004 ? `<span class="neg">${money(left)} not split</span> <button type="button" class="link-btn" data-item-rest>add it as an item</button>`
                : `<span class="pos">${icon('check')}all split</span>`;
            // the bill total stays what was typed: following the items is offered only while they are within it
            line.innerHTML = `${noun} of <b>${money(total ?? 0)}</b> · ${status}${left < -0.004 ? ''
                : `<button type="button" class="link-btn" data-item-follow title="Let the total be what the items add up to">total = items</button>`}`;
        }
        const reason = box.querySelector('[data-item-problem]');
        if (reason) reason.textContent = problem && !/more than the bill|left for item/.test(problem) ? problem : '';
        onChange();
    }

    function add(item = blank()) {
        if (items.length >= 60) { onValidity(false, 'A bill takes at most 60 items'); return; }
        items.push(item);
        active = items.length - 1;
        render({ index: active, field: '[data-item-name]' });
        onActive(item.categoryId || '', active);
    }

    function remove(i) {
        items.splice(i, 1);
        if (!items.length) items.push(blank());
        active = Math.min(active, items.length - 1);
        render();
        onActive(items[active]?.categoryId || '', active);
    }

    // ---- typing in an item
    box.addEventListener('focusin', e => {
        const row = e.target.closest('[data-item]');
        if (row) setActive(Number(row.dataset.item));
    });
    box.addEventListener('beforeinput', e => {
        if (e.target.matches('[data-item-amt]') && e.data && NOT_AMOUNT.test(e.data)) {
            e.preventDefault();
            e.target.classList.remove('bad-key'); void e.target.offsetWidth; e.target.classList.add('bad-key');
        }
    });
    box.addEventListener('input', e => {
        const row = e.target.closest('[data-item]');
        if (!row) return;
        if (e.target.matches('[data-item-amt]')) cleanAmount(e.target, el => { el.classList.remove('bad-key'); void el.offsetWidth; el.classList.add('bad-key'); });
        const it = items[Number(row.dataset.item)];
        if (e.target.matches('[data-item-name]')) {
            it.name = e.target.value;
            const hit = !it.manual ? guess(it.name) : null;
            if (hit && String(hit.id) !== String(it.categoryId)) {
                it.categoryId = String(hit.id);
                const b = row.querySelector('[data-item-cat]');
                b.innerHTML = catButton(it);
                b.classList.remove('empty');
                b.classList.add('auto-picked');
                setTimeout(() => b.classList.remove('auto-picked'), 900);
                onActive(it.categoryId, Number(row.dataset.item));
                refresh();
            }
        }
        if (e.target.matches('[data-item-amt]')) { it.amount = e.target.value; refresh(); }
    });
    box.addEventListener('focusout', e => {
        if (!e.target.matches('[data-item-amt]')) return;
        const it = items[Number(e.target.closest('[data-item]').dataset.item)];
        const v = valueOf(it);
        if (v !== null && String(v) !== String(it.amount).trim()) { it.amount = String(v); e.target.value = it.amount; refresh(); }
    });
    box.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing) return;
        const row = e.target.closest('[data-item]');
        if (!row) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { save(); return; }
        const i = Number(row.dataset.item);
        const it = items[i];
        if (e.target.matches('[data-item-name]')) {
            // an empty last line: the bill is done
            if (isEmpty(it) && i === items.length - 1 && items.length > 1) { remove(i); save(); return; }
            row.querySelector('[data-item-amt]').focus();
            return;
        }
        if (e.target.matches('[data-item-amt]')) {
            if (i < items.length - 1) rowEl(i + 1).querySelector('[data-item-name]').focus();
            else if (valueOf(it) !== null || i === restIndex()) add();
        }
    });
    box.addEventListener('click', e => {
        const row = e.target.closest('[data-item]');
        if (e.target.closest('[data-item-del]')) { remove(Number(row.dataset.item)); return; }
        if (e.target.closest('[data-item-cat]')) {
            setActive(Number(row.dataset.item));
            form.querySelector('.xp-cat-search')?.focus();
            return;
        }
        if (e.target.closest('[data-item-add]')) { add(); return; }
        if (e.target.closest('[data-item-rest]')) {
            const left = round((bill() || 0) - known());
            add({ ...blank(), amount: String(left) });
            return;
        }
        if (e.target.closest('[data-item-follow]')) { fixed = false; refresh(); }
    });
    // a total typed in the amount box stays; cleared, the total follows the items again
    form.amount.addEventListener('input', () => {
        if (!on || paused) return;
        fixed = !!form.amount.value.trim();
        refresh();
    });

    const save = () => form.closest('.modal-backdrop')?.querySelector('.modal-actions .btn.primary, [data-action-index].primary')?.click();

    return {
        /** Items are being recorded (and not put aside). */
        get on() { return on && !paused; },
        get active() { return active; },
        /** Starts (or restarts) the items: the given ones, and whether the bill total stays as typed. */
        enter({ items: start = [], fixed: keep = false, addBlank = true } = {}) {
            on = true;
            fixed = keep && bill() !== null;
            items = start.map(it => ({ ...blank(), ...it, categoryId: it.categoryId ? String(it.categoryId) : '', manual: !!it.categoryId }));
            if (addBlank || !items.length) items.push(blank());
            active = addBlank ? items.length - 1 : 0;
            form.classList.add('itemized');
            box.hidden = false;
            render({ index: active, field: '[data-item-name]' });
            onActive(items[active]?.categoryId || '', active);
        },
        /** Puts the items aside, as they are: the dialog records something else for now. */
        pause() {
            if (!on || paused) return;
            paused = true;
            form.classList.remove('itemized');
            box.hidden = true;
            form.amount.classList.remove('invalid');
            onValidity(true, null);
        },
        /** Brings the items back as they were; a total changed meanwhile stays as typed. */
        resume() {
            if (!on || !paused) return;
            paused = false;
            const total = bill();
            if (!fixed && total !== null && Math.abs(total - known()) > 0.004) fixed = true;
            form.classList.add('itemized');
            box.hidden = false;
            render();
            onActive(items[active]?.categoryId || '', active);
        },
        exit() {
            on = false;
            paused = false;
            onValidity(true, null);
            form.amount.classList.remove('invalid');
            items = [];
            form.classList.remove('itemized');
            box.hidden = true;
            box.innerHTML = '';
        },
        /** A category tile (or Alt+n, or the search) picked for the item being edited. */
        pick(categoryId) {
            const it = items[active];
            if (!it) return;
            it.categoryId = String(categoryId);
            it.manual = true;
            const row = rowEl(active);
            const b = row?.querySelector('[data-item-cat]');
            if (b) { b.innerHTML = catButton(it); b.classList.remove('empty'); }
            onActive(it.categoryId, active);
            refresh();
            const amt = row?.querySelector('[data-item-amt]');
            if (amt && !String(it.amount).trim() && active !== restIndex()) amt.focus();
        },
        /** The categories of the bill with what this bill adds to each (for the budget check). */
        byCategory() {
            const out = new Map();
            const rest = restIndex();
            const left = fixed && bill() !== null ? Math.max(0, round(bill() - known())) : 0;
            items.forEach((it, i) => {
                if (!it.categoryId) return;
                const v = i === rest ? left : (valueOf(it) || 0);
                out.set(Number(it.categoryId), (out.get(Number(it.categoryId)) || 0) + v);
            });
            return out;
        },
        /** The bill to save: its total and items; throws (and points at the item) when something is missing. */
        collect() {
            const total = bill();
            if (form.amount.value.trim() && total === null) { form.amount.focus(); throw new Error('The bill total is not a number or a sum'); }
            if (fixed && total !== null && !(total > 0)) { form.amount.focus(); throw new Error('The bill total must be more than zero'); }
            if (total !== null && total > MAX_AMOUNT) { form.amount.focus(); throw new Error('The bill total is too large'); }
            const bad = items.findIndex(it => amountProblem(it));
            if (bad >= 0) {
                setActive(bad);
                rowEl(bad)?.querySelector('[data-item-amt]')?.focus();
                throw new Error(`What ${items[bad].name.trim() ? `“${items[bad].name.trim()}”` : `item ${bad + 1}`} cost ${amountProblem(items[bad])}`);
            }
            if (fixed && total !== null && round(known() - total) > 0.004) {
                throw new Error(`The items add up to ${money(round(known()))}, ${money(round(known() - total))} more than the bill of ${money(total)}. Lower an item or correct the bill total`);
            }
            const rest = restIndex();
            const rows = items.map((it, i) => ({ it, i })).filter(({ it }) => !isEmpty(it));
            if (!rows.length) { add(); throw new Error('Add the items of the bill'); }
            const fail = (i, field, message) => {
                setActive(i);
                rowEl(i)?.querySelector(field)?.focus();
                throw new Error(message);
            };
            const label = (it, i) => (it.name.trim() ? `“${it.name.trim()}”` : `item ${i + 1}`);
            const out = rows.map(({ it, i }) => {
                let v = valueOf(it);
                if (String(it.amount).trim() && v === null) fail(i, '[data-item-amt]', `What ${label(it, i)} cost is not a number or a sum`);
                if (v === null && i === rest) v = round(total - known());
                if (!(v > 0)) fail(i, '[data-item-amt]', i === rest ? `Nothing of the bill is left for ${label(it, i)}` : `Enter what ${label(it, i)} cost`);
                if (!it.categoryId) fail(i, '[data-item-name]', `Pick a category for ${label(it, i)}: a tile, Alt+1…9 or the search`);
                return { categoryId: Number(it.categoryId), amount: v, name: it.name.trim() || null };
            });
            const sum = round(out.reduce((s, x) => s + x.amount, 0));
            if (fixed && total !== null && Math.abs(sum - total) > 0.004) {
                throw new Error(`The items add up to ${money(sum)} but the bill is ${money(total)}: ${sum < total ? 'add what is missing' : 'correct an item'}, or click “total = items”`);
            }
            return { total: sum, items: out };
        },
    };
}

/** What the bill does to each of its categories' budgets this month, a line each. */
export function billBudgetHtml(byCategory, { categories, budgets }) {
    if (!byCategory.size) return `<span class="muted">${icon('info')} Pick the items' categories to see their budgets</span>`;
    return `<div class="bi-budgets">${[...byCategory.entries()].map(([id, amount]) => {
        const c = categories.find(x => x.id === id);
        const line = budgets.lines.find(l => l.categoryId === id);
        const limit = line && line.monthlyLimit !== null ? Number(line.monthlyLimit) : null;
        const after = Number(line?.spent || 0) + amount;
        const used = limit ? (after / limit) * 100 : null;
        return `<div class="bi-budget" title="${limit ? `${money(after)} of ${money(limit)} this month after this bill` : 'No budget set'}">
            <span class="ellipsis">${esc(c?.name || '?')}</span><b class="mono">${money(amount)}</b>
            ${used === null ? '<span class="bi-none muted small">no budget</span>'
                : `<i class="xd-bar ${used > 100 ? 'over' : used >= (line.alertPercent || 80) ? 'warn' : ''}"><em style="width:${Math.min(used, 100)}%"></em></i>
                   <span class="bi-pct small ${used > 100 ? 'neg' : 'muted'}">${percent(used, 0)}</span>`}</div>`;
    }).join('')}</div>`;
}
