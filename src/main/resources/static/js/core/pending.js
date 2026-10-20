/**
 * What has an approval request open on it (a change waiting for a checker, or turned down and not answered yet): every
 * screen tags it "Sent for approval" and offers no edit, delete or reverse on it meanwhile. The server refuses such a
 * change as well. Targets read like API addresses: "bricks/batches/12", "expenses/40", "transactions/7", "bricks/orders/4".
 */
import { api } from './api.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

let open = [];

export async function loadOpen() {
    try { open = await api.get('/approvals/open'); } catch { /* left as it was */ }
    return open;
}

/** The request open on any of these targets, or null. */
export function openOn(...targets) {
    return open.find(t => targets.includes(t.target)) || null;
}

/** The tag that says so (empty when nothing is open). */
export function heldTag(t, { short = false } = {}) {
    if (!t) return '';
    const back = t.status === 'REJECTED';
    return `<span class="badge ${back ? 'bad' : 'warning'} sm held-tag" title="${esc(`${t.number}: ${t.label}${t.submittedBy ? ` · asked by ${t.submittedBy}` : ''} · no further change until it is answered`)}">${icon(back ? 'x' : 'clock')}${short ? esc(t.number)
        : back ? `Turned down · ${esc(t.number)}` : `Sent for approval · ${esc(t.number)}`}</span>`;
}
