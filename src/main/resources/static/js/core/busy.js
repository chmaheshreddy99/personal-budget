/**
 * Shows that the app is waiting for the server, for every API call (api.js reports each one here):
 *   - a thin bar runs along the top of the page while any call takes longer than a moment;
 *   - the button, row or chip that started the call (the last one clicked, tapped or submitted just before it)
 *     shows a spinner and takes no more clicks until the call is answered, so a slow save cannot be sent twice
 *     and a row being expanded shows that it is loading. A change (POST / PUT / DELETE) locks its button at once,
 *     a read only after a moment, so quick answers never flicker.
 * Styles: css/busy.css (pb-busy, pb-locked, #pb-progress).
 */

/** Calls started within this long after a click belong to the clicked element. */
const TRIGGER_WINDOW_MS = 1200;
/** Spinners and the top bar appear only for calls slower than this. */
const SHOW_AFTER_MS = 250;

const TRIGGERS = 'button, a.btn, [role="button"], .seg-chip, .clickable, tr[data-id], [data-action], summary, .m-row, .m-card, .m-tile, .set-item';

let trigger = null;   // { el, at }
let pending = 0;
let barTimer = null;

if (typeof document !== 'undefined') {
    const remember = el => { if (el && el.isConnected) trigger = { el, at: Date.now() }; };
    document.addEventListener('click', e => remember(e.target.closest?.(TRIGGERS)), true);
    document.addEventListener('submit', e => {
        const form = e.target;
        remember(e.submitter || form.querySelector('button[type="submit"], button:not([type])') || form);
    }, true);
    // a click on an element busy with a call is swallowed (pointer-events stop most; keyboard clicks too)
    document.addEventListener('click', e => {
        if (e.target.closest?.('.pb-locked')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
}

function progressBar() {
    let bar = document.getElementById('pb-progress');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'pb-progress';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', 'Working');
        bar.innerHTML = '<span></span>';
        document.body.appendChild(bar);
    }
    return bar;
}

function lock(el, mutating) {
    el._pbCalls = (el._pbCalls || 0) + 1;
    if (el._pbCalls > 1) return;
    el.classList.add('pb-locked');
    el.setAttribute('aria-busy', 'true');
    // a button that was enabled is disabled while it waits (restored after); the form's own handling stays as is
    el._pbDisabled = el.tagName === 'BUTTON' && !el.disabled && mutating;
    if (el._pbDisabled) el.disabled = true;
    el._pbTimer = setTimeout(() => el.classList.add('pb-busy'), mutating ? 0 : SHOW_AFTER_MS);
}

function unlock(el) {
    el._pbCalls = Math.max(0, (el._pbCalls || 1) - 1);
    if (el._pbCalls > 0) return;
    clearTimeout(el._pbTimer);
    el.classList.remove('pb-locked', 'pb-busy');
    el.removeAttribute('aria-busy');
    if (el._pbDisabled) el.disabled = false;
    el._pbDisabled = false;
}

/**
 * A call is starting: returns the function to call when it is answered (or failed).
 * {@code mutating}: it changes data (its button is locked at once).
 */
export function callStarted(mutating) {
    if (typeof document === 'undefined') return () => {};
    pending++;
    if (pending === 1) {
        clearTimeout(barTimer);
        barTimer = setTimeout(() => {
            progressBar().classList.add('on');
            document.documentElement.classList.add('pb-waiting');
        }, SHOW_AFTER_MS);
    }
    const el = trigger && Date.now() - trigger.at < TRIGGER_WINDOW_MS && trigger.el.isConnected ? trigger.el : null;
    if (el) lock(el, mutating);
    let done = false;
    return () => {
        if (done) return;
        done = true;
        if (el) unlock(el);
        pending = Math.max(0, pending - 1);
        if (pending === 0) {
            clearTimeout(barTimer);
            document.getElementById('pb-progress')?.classList.remove('on');
            document.documentElement.classList.remove('pb-waiting');
        }
    };
}

/**
 * Shows {@code el} busy until {@code work} settles (for work not started by a click on it, e.g. Enter in a
 * dialog), and resolves with its result.
 */
export async function busyWhile(el, work) {
    if (!el) return work;
    lock(el, true);
    try {
        return await work;
    } finally {
        unlock(el);
    }
}

/** fetch() for the pages outside the app (share links, agreements): shown busy the same way. */
export async function trackedFetch(url, init = {}) {
    const finished = callStarted((init.method || 'GET') !== 'GET');
    try {
        return await fetch(url, init);
    } finally {
        finished();
    }
}
