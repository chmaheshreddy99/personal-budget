/**
 * Amounts that stand under each other line up by their decimal point. money() prints "₹60,000" and "₹89.82" (decimals only
 * when needed), which right-aligned puts the rupees of one under the paise of the other. So, wherever amounts in a panel or
 * dialog share a right edge and only some have paise, the others get ".00". A column of whole amounts stays as it is.
 *
 * It works on what is on the page, so every table and list is covered, however it is drawn. Only a text that is an amount
 * and nothing else counts (not one in a sentence, a short form like ₹1.2L, an input or a chart). It runs before the browser
 * paints, so a row never jumps; hidden rows join in when they are shown.
 */
import { currencySymbol } from './format.js';

const padded = new WeakSet();   // the texts that got their ".00" here: not paise of their own
const PADDING = '.00';
let scheduled = 0;
let symbol = null;
let amountRe = null;

function amountPattern() {
    const now = currencySymbol();
    if (now !== symbol) {
        symbol = now;
        const escaped = now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        amountRe = new RegExp(`^\\s*[+\\-−]?\\s*${escaped}\\s*\\d[\\d,]*(\\.\\d{1,2})?\\s*$`);
    }
    return amountRe;
}

const skip = el => !el || el.closest('svg, select, option, textarea, script, style');

/** Text nodes that are an amount, by the panel or dialog they are in and their right edge. */
function collect(root, pattern, groups) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!pattern.test(node.nodeValue) || skip(node.parentElement)) continue;
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (!box.width) continue;   // hidden
        const within = node.parentElement.closest('.panel, .modal') || root;
        if (!groups.has(within)) groups.set(within, new Map());
        const edges = groups.get(within);
        const edge = Math.round(box.right);
        if (!edges.has(edge)) edges.set(edge, []);
        edges.get(edge).push(node);
    }
}

const hasPaise = node => node.nodeValue.includes('.');

function settle(nodes) {
    const owns = nodes.some(n => hasPaise(n) && !padded.has(n));
    nodes.forEach(n => {
        if (owns && !hasPaise(n)) {
            const trimmed = n.nodeValue.replace(/\s+$/, '');
            n.nodeValue = trimmed + PADDING + n.nodeValue.slice(trimmed.length);
            padded.add(n);
        } else if (!owns && padded.has(n)) {   // what had paise has gone
            n.nodeValue = n.nodeValue.replace(PADDING, '');
            padded.delete(n);
        }
    });
}

export function alignAmounts() {
    scheduled = 0;
    const pattern = amountPattern();
    const groups = new Map();
    const view = document.getElementById('view');
    if (view) collect(view, pattern, groups);
    document.querySelectorAll('.modal').forEach(m => collect(m, pattern, groups));
    groups.forEach(edges => edges.forEach(settle));
}

/** Once, at start. At most once a frame, before it is painted. */
let started = false;
export function initAmountAlign() {
    if (started) return;   // signing in again finds it running
    started = true;
    new MutationObserver(() => { if (!scheduled) scheduled = requestAnimationFrame(alignAmounts); })
        .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    alignAmounts();
}
