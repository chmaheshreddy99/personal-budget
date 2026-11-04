/**
 * Arranging a list by hand (accounts, chits, budgets). A list normally shows a small closed lock and behaves as always.
 * Opening the lock lets its rows be dragged, by mouse or by touch, within their group; each drop is saved for the
 * household (/api/list-order, the phone app follows it too). A row is still selected by a plain click. Beside the open
 * lock, the undo button goes back to the usual order.
 *
 *   await loadOrders()                       when the page loads its data
 *   ranked('accounts', items, x => x.id)     the items in the saved order (anything new after them, as it came)
 *   arrangeLockHtml()                        the micro buttons, in the list's header
 *   bindArrange({ list, tools, root, selector, ... })
 */
import { api } from './api.js';
import { can } from './store.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

let orders = {};

export async function loadOrders() {
    try { orders = await api.get('/list-order'); } catch { orders = {}; }
    return orders;
}

/** Where an id stands in a list's saved order; Infinity when it has no place yet. */
export function rankOf(list, id) {
    const i = (orders[list] || []).indexOf(id);
    return i < 0 ? Infinity : i;
}

/** The items in the saved order; those without a place follow, as they came. */
export function ranked(list, items, idOf = x => x.id) {
    const saved = orders[list];
    if (!saved?.length) return items;
    const rank = new Map(saved.map((id, i) => [id, i]));
    const at = x => rank.get(idOf(x)) ?? Infinity;
    return [...items].sort((a, b) => (at(a) === at(b) ? 0 : at(a) - at(b)));
}

const LOCKED = 'Order locked. Click to arrange this list by dragging';
const OPEN = 'Drag the rows to arrange them. Click to lock the order';

export const arrangeLockHtml = () => (can('POST_TRANSACTIONS')
    ? `<span class="arrange-tools"><button type="button" class="micro-lock" data-arrange-lock title="${LOCKED}" aria-pressed="false">${icon('lock')}</button>
        <button type="button" class="micro-lock" data-arrange-reset title="Back to the usual order" hidden>${icon('undo')}</button></span>`
    : '');

/**
 * Wires a list. tools: the element holding arrangeLockHtml(); root: the element holding the rows; selector: a row;
 * idOf: a row's id; allIds: every id of the list (also those filtered out now); sameGroup(a, b): whether a row may pass
 * another; crossHeadings: a row may pass a heading (else rows between two headings stay between them); onDrop: redraw
 * after a saved move; onReset: redraw after going back to the usual order.
 */
export function bindArrange({ list, tools, root, selector, idOf = el => Number(el.dataset.id), allIds, sameGroup = () => true, crossHeadings = false, onDrop, onReset }) {
    const lock = tools?.querySelector('[data-arrange-lock]');
    if (!lock) return;
    const reset = tools.querySelector('[data-arrange-reset]');
    let open = false;
    const setOpen = on => {
        open = on;
        root.classList.toggle('arranging', on);
        lock.classList.toggle('open', on);
        lock.setAttribute('aria-pressed', String(on));
        lock.title = on ? OPEN : LOCKED;
        lock.innerHTML = icon(on ? 'unlock' : 'lock');
        reset.hidden = !on || !orders[list]?.length;
    };
    lock.addEventListener('click', () => setOpen(!open));
    reset.addEventListener('click', async () => {
        try {
            orders = await api.put(`/list-order/${list}`, { ids: [] });
            setOpen(false);
            toast('Back to the usual order', 'info');
            onReset?.();
        } catch (error) { toast(error.message, 'error'); }
    });

    const rows = () => [...root.querySelectorAll(selector)];
    /** The rows a row can move among: its neighbours up to the next heading or another group. */
    const segment = el => {
        const out = [el];
        const walk = (step, add) => {
            for (let x = el[step]; x; x = x[step]) {
                if (!x.matches(selector)) { if (crossHeadings) continue; break; }
                if (!sameGroup(el, x)) break;
                if (!x.hidden) add(x);
            }
        };
        walk('previousElementSibling', x => out.unshift(x));
        walk('nextElementSibling', x => out.push(x));
        return out;
    };
    const scroller = () => {
        for (let x = root; x && x !== document.body; x = x.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight) return x;
        }
        return null;
    };

    root.addEventListener('pointerdown', down => {
        if (!open || down.button !== 0 || down.target.closest('button, a, input, select, label')) return;
        const el = down.target.closest(selector);
        if (!el || !root.contains(el)) return;
        const before = rows().map(idOf);
        const area = scroller();
        let y = down.clientY, dragging = false, frame = 0;
        const grab = down.clientY - el.getBoundingClientRect().top;

        const place = () => {
            const others = segment(el).filter(x => x !== el);
            const next = others.find(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
            if (next) { if (el.nextElementSibling !== next) next.before(el); }
            else if (others.length) others[others.length - 1].after(el);
            el.style.transform = 'none';
            const top = el.getBoundingClientRect().top;
            el.style.transform = `translateY(${y - grab - top}px)`;
        };
        const tick = () => {
            if (area) {
                const r = area.getBoundingClientRect();
                const edge = 34;
                const speed = y < r.top + edge ? -8 : y > r.bottom - edge ? 8 : 0;
                if (speed) { area.scrollTop += speed; place(); }
            }
            frame = requestAnimationFrame(tick);
        };
        const move = e => {
            y = e.clientY;
            if (!dragging) {
                if (Math.abs(y - down.clientY) < 5) return;
                dragging = true;
                root.setPointerCapture(down.pointerId);
                el.classList.add('arrange-dragging');
                root.classList.add('arrange-active');
                frame = requestAnimationFrame(tick);
            }
            e.preventDefault();
            place();
        };
        const finish = async () => {
            root.removeEventListener('pointermove', move);
            root.removeEventListener('pointerup', finish);
            root.removeEventListener('pointercancel', finish);
            cancelAnimationFrame(frame);
            if (!dragging) return;
            el.style.transform = '';
            el.classList.remove('arrange-dragging');
            root.classList.remove('arrange-active');
            // the click that ends a drag does not select the row
            const swallow = e => { e.stopPropagation(); e.preventDefault(); };
            root.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 60);
            const now = rows().map(idOf);
            if (now.join() === before.join()) return;
            // what is filtered out now keeps its place: only the places of the rows shown change hands
            const shown = new Set(now);
            let i = 0;
            const full = ranked(list, allIds().map(id => ({ id }))).map(x => (shown.has(x.id) ? now[i++] : x.id));
            now.slice(i).forEach(id => full.push(id));
            try {
                orders = await api.put(`/list-order/${list}`, { ids: full });
                reset.hidden = !open;
                onDrop?.();
            } catch (error) { toast(error.message, 'error'); }
        };
        root.addEventListener('pointermove', move);
        root.addEventListener('pointerup', finish);
        root.addEventListener('pointercancel', finish);
    });
}
