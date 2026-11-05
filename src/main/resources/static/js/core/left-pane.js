/**
 * Left panes: the column on the left of a page (the accounts and chits lists, the settings and reports menus, the budget
 * list ...). Each page lays its own out; this finds them, so the rest works wherever one is drawn:
 *
 *   - the pane's parts get the class lp-pane, which is what Settings › Appearance styles (core/custom-theme.js, "Left panes")
 *   - its edge can be dragged to any width, which is kept for that page (preference leftPanes, in this browser);
 *     a double click puts it back to normal, the arrow keys move it and Enter puts it back
 *
 * Normal is the page's own width, times the theme's "Width" option (--lp-scale). A page narrow enough to stack its columns
 * has no left pane, so no edge either.
 */
import { getPref, setPref } from './prefs.js';

const PAGES = ['.accounts-page', '.chits-page', '.reports-page', '.settings-page', '.income-page', '.gifts-page', '.documents-page',
    '.planning-body.budgets', '.planner', '.forecast-body.lh-page', '.nc-layout'];
const MIN = 180, MAX = 720;
const FIT = 3;   // px: a child this close to the first column's edges is in it

const saved = () => getPref('leftPanes', {});
const scale = () => Number(getComputedStyle(document.documentElement).getPropertyValue('--lp-scale')) || 1;
const pageKey = el => PAGES.find(s => el.matches(s));

/** The first column as the page has it, and the rest as they should then follow: the widest track takes up the slack. */
function measure(el) {
    const before = el.style.gridTemplateColumns;
    el.style.gridTemplateColumns = '';
    const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
    el.style.gridTemplateColumns = before;
    if (tracks.length < 2) return null;
    const widest = tracks.indexOf(Math.max(...tracks.slice(1)));
    return { base: tracks[0], rest: tracks.slice(1).map((t, i) => (i + 1 === widest ? 'minmax(0, 1fr)' : `${t}px`)).join(' ') };
}

const clampWidth = (el, w) => Math.round(Math.max(MIN, Math.min(w, MAX, el.clientWidth * 0.62)));

function setWidth(el, w) {
    el.style.gridTemplateColumns = `${clampWidth(el, w)}px ${el.lpTracks.rest}`;
    placeHandle(el);
}

const normalWidth = el => el.lpTracks.base * scale();
const startWidth = el => saved()[pageKey(el)] ?? normalWidth(el);

function remember(el, width) {
    const widths = { ...saved() };
    if (width == null) delete widths[pageKey(el)]; else widths[pageKey(el)] = width;
    setPref('leftPanes', widths);
}

/** The children standing in the first column (a band across the page is not one of them), marked as the pane. */
function markPanes(el) {
    const box = el.getBoundingClientRect();
    const first = parseFloat(el.style.gridTemplateColumns) || parseFloat(getComputedStyle(el).gridTemplateColumns);
    const panes = [];
    [...el.children].forEach(child => {
        if (child.classList.contains('lp-handle')) return;
        const r = child.getBoundingClientRect();
        const inFirst = r.width > 0 && Math.abs(r.left - box.left - el.clientLeft - paddingLeft(el)) <= FIT && Math.abs(r.width - first) <= FIT;
        child.classList.toggle('lp-pane', inFirst);
        if (inFirst) panes.push(r);
    });
    return panes;
}

const paddingLeft = el => parseFloat(getComputedStyle(el).paddingLeft) || 0;

function placeHandle(el) {
    const panes = markPanes(el);
    const handle = el.querySelector(':scope > .lp-handle');
    if (!handle) return;
    if (!panes.length) { handle.hidden = true; return; }
    const box = el.getBoundingClientRect();
    const top = Math.min(...panes.map(r => r.top)), bottom = Math.max(...panes.map(r => r.bottom));
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    handle.hidden = false;
    handle.style.left = `${panes[0].right - box.left + gap / 2 + el.scrollLeft}px`;
    handle.style.top = `${top - box.top + el.scrollTop}px`;
    handle.style.height = `${bottom - top}px`;
}

function makeHandle(el) {
    const handle = document.createElement('div');
    handle.className = 'lp-handle';
    handle.title = 'Drag to change the width · double-click for the normal width';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Width of the left pane');
    const current = () => parseFloat(el.style.gridTemplateColumns) || el.lpTracks.base;
    const reset = () => { remember(el, null); setWidth(el, normalWidth(el)); };
    handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        const from = e.clientX, width = current();
        handle.setPointerCapture(e.pointerId);
        document.documentElement.classList.add('lp-dragging');
        const move = m => setWidth(el, width + m.clientX - from);
        const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
            document.documentElement.classList.remove('lp-dragging');
            if (current() !== Math.round(width)) remember(el, current());
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', reset);
    handle.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === 'Home') { e.preventDefault(); reset(); return; }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setWidth(el, current() + (e.key === 'ArrowRight' ? 16 : -16));
        remember(el, current());
    });
    el.appendChild(handle);
    return handle;
}

/** Sets up one page; fresh: measure it again (the window or the theme changed). */
function attach(el, fresh = false) {
    if (fresh || !el.lpTracks) {
        el.style.gridTemplateColumns = '';
        el.lpTracks = measure(el);
    }
    if (!el.lpTracks) {
        el.querySelector(':scope > .lp-handle')?.remove();
        [...el.children].forEach(c => c.classList.remove('lp-pane'));
        return;
    }
    el.classList.add('lp-host');
    const hadHandle = el.querySelector(':scope > .lp-handle');
    if (!hadHandle) makeHandle(el);
    if (fresh || !el.style.gridTemplateColumns) setWidth(el, startWidth(el));
    else placeHandle(el);
}

let view = null;
const scan = (fresh = false) => view?.querySelectorAll(PAGES.join(',')).forEach(el => attach(el, fresh));

/** Measures every left pane again and applies the theme's width: after a theme changed on the page. */
export const refreshLeftPanes = () => scan(true);

/** Once, at start: the pages are drawn into #view. Runs before the browser paints, so a pane never jumps. */
export function initLeftPanes() {
    if (view) return;   // signing in again finds it running
    view = document.getElementById('view') || document.body;
    new MutationObserver(() => scan()).observe(view, { childList: true, subtree: true });
    let frame = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => scan(true));
    });
    scan();
}
