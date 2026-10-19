/**
 * A richer date picker for every <input type="date"> in the app (opt out with data-plain).
 *
 * The native input stays (typing a date, form values and validation work as before); a calendar button and a
 * click on the box open a popup with:
 *   - quick picks that fit the field: Today / Yesterday / start of the month for dates that happened,
 *     "in 1 week / 1 month / 3 months / 1 year" for due dates and expiry dates
 *   - a month grid (Monday first) with today, the chosen day, weekends and the min / max respected;
 *     the month name opens a month / year view
 *   - the chosen day spelled out with how far it is from today
 * Keyboard while open: arrows move a day / week, PageUp / PageDown a month (Shift: a year), Home today,
 * Enter picks, Esc closes. Alt+↓ (or F4) opens it from the box.
 */
import { icon } from './icons.js';

const pop = document.createElement('div');
pop.className = 'dp-pop';
pop.hidden = true;
document.body.appendChild(pop);

let owner = null;       // the input the popup belongs to
let cursor = null;      // the day under the keyboard
let monthView = false;  // showing the 12 months of a year instead of days

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(s + 'T00:00:00') : null);
const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Same day n months later, kept inside the month (31 Jan + 1 month = 28/29 Feb). */
const addMonths = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
    return x;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today", "yesterday", "in 3 days", "2 months ago" */
export function relativeDay(d) {
    const days = Math.round((d - today()) / 86400000);
    if (days === 0) return 'today';
    if (days === -1) return 'yesterday';
    if (days === 1) return 'tomorrow';
    const abs = Math.abs(days);
    const text = abs < 14 ? `${abs} days` : abs < 60 ? `${Math.round(abs / 7)} weeks` : abs < 730 ? `${Math.round(abs / 30.4)} months` : `${Math.round(abs / 365)} years`;
    return days > 0 ? `in ${text}` : `${text} ago`;
}

function bounds(input) {
    return { min: parse(input.min), max: parse(input.max) };
}

const allowed = (d, { min, max }) => (!min || d >= min) && (!max || d <= max);

/** Is the field about something that happened (past), or something ahead (a due or expiry date)? */
function kind(input) {
    const t = iso(today());
    if (input.max && input.max <= t) return 'past';
    if (input.min && input.min >= t) return 'future';
    if (/due|expir|until|valid|end|maturity|remind|next/i.test(`${input.name} ${input.id}`)) return 'future';
    if (/date|paid|start|issued|from|on$/i.test(`${input.name} ${input.id}`)) return 'past';
    return 'any';
}

function quickPicks(input) {
    const t = today();
    const k = kind(input);
    const base = parse(input.dataset.dpBase ? input.form?.querySelector(`[name="${input.dataset.dpBase}"]`)?.value : '') || t;
    const past = [['Today', t], ['Yesterday', addDays(t, -1)], ['2 days ago', addDays(t, -2)],
        ['1st of month', new Date(t.getFullYear(), t.getMonth(), 1)], ['Last month end', new Date(t.getFullYear(), t.getMonth(), 0)]];
    const ahead = [['In 1 week', addDays(base, 7)], ['In 1 month', addMonths(base, 1)], ['In 3 months', addMonths(base, 3)],
        ['In 6 months', addMonths(base, 6)], ['In 1 year', addMonths(base, 12)]];
    if (/expir|valid/i.test(input.name)) ahead.push(['In 5 years', addMonths(base, 60)], ['In 10 years', addMonths(base, 120)]);
    const list = k === 'past' ? past : k === 'future' ? [['Today', t], ...ahead] : [past[0], past[1], ahead[0], ahead[1]];
    const b = bounds(input);
    return list.filter(([, d]) => allowed(d, b));
}

function render() {
    const input = owner;
    const b = bounds(input);
    const chosen = parse(input.value);
    const t = today();
    const view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const head = `<div class="dp-head">
        <button type="button" class="dp-nav" data-step="${monthView ? -12 : -1}" title="${monthView ? 'Previous year' : 'Previous month'}">${icon('chevron-left')}</button>
        <button type="button" class="dp-title" data-toggle-view title="${monthView ? 'Back to the days' : 'Pick a month or year'}">${monthView ? view.getFullYear() : `${view.toLocaleDateString('en-GB', { month: 'long' })} ${view.getFullYear()}`}${icon('chevron-down')}</button>
        <button type="button" class="dp-nav" data-step="${monthView ? 12 : 1}" title="${monthView ? 'Next year' : 'Next month'}">${icon('chevron-right')}</button></div>`;
    const picks = quickPicks(input);
    const quick = picks.length ? `<div class="dp-quick">${picks.map(([label, d]) =>
        `<button type="button" class="dp-chip ${chosen && iso(chosen) === iso(d) ? 'on' : ''}" data-pick="${iso(d)}" title="${d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}">${label}</button>`).join('')}</div>` : '';
    let grid;
    if (monthView) {
        grid = `<div class="dp-months">${MONTHS.map((m, i) => {
            const first = new Date(view.getFullYear(), i, 1), last = new Date(view.getFullYear(), i + 1, 0);
            const out = (b.min && last < b.min) || (b.max && first > b.max);
            return `<button type="button" class="dp-month ${i === cursor.getMonth() ? 'cursor' : ''} ${t.getFullYear() === view.getFullYear() && t.getMonth() === i ? 'today' : ''}"
                data-month="${i}" ${out ? 'disabled' : ''}>${m}</button>`;
        }).join('')}</div>`;
    } else {
        const start = addDays(view, -((view.getDay() + 6) % 7));
        const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
        grid = `<div class="dp-week">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<span>${d}</span>`).join('')}</div>
            <div class="dp-days">${cells.map(d => {
                const cls = ['dp-day', d.getMonth() !== view.getMonth() ? 'other' : '', iso(d) === iso(t) ? 'today' : '',
                    chosen && iso(d) === iso(chosen) ? 'on' : '', iso(d) === iso(cursor) ? 'cursor' : '', d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''].join(' ');
                return `<button type="button" class="${cls}" data-pick="${iso(d)}" ${allowed(d, b) ? '' : 'disabled'} tabindex="-1">${d.getDate()}</button>`;
            }).join('')}</div>`;
    }
    const foot = `<div class="dp-foot">${chosen
        ? `<b>${chosen.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b><span>${relativeDay(chosen)}</span>`
        : '<span>No date</span>'}<span class="dp-spacer"></span>
        ${!input.required && input.value ? '<button type="button" class="dp-link" data-clear>Clear</button>' : ''}
        ${allowed(t, b) && !(chosen && iso(chosen) === iso(t)) ? '<button type="button" class="dp-link" data-pick-today>Today</button>' : ''}</div>`;
    pop.innerHTML = head + quick + grid + foot;
    place(input.closest('.dp-wrap') || input);
}

function place(anchor) {
    const box = anchor.getBoundingClientRect();
    const width = 286;
    pop.style.left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) + 'px';
    const height = pop.offsetHeight || 340;
    if (window.innerHeight - box.bottom > height + 8 || box.top < height + 8) {
        pop.style.top = Math.min(box.bottom + 4, window.innerHeight - height - 8) + 'px';
    } else {
        pop.style.top = (box.top - height - 4) + 'px';
    }
}

function open(input) {
    if (input.disabled || input.readOnly) return;
    owner = input;
    monthView = false;
    const b = bounds(input);
    cursor = parse(input.value) || (b.max && today() > b.max ? b.max : b.min && today() < b.min ? b.min : today());
    pop.hidden = false;
    render();
    input.closest('.dp-wrap')?.classList.add('open');
}

function close() {
    if (!owner) return;
    owner.closest('.dp-wrap')?.classList.remove('open');
    pop.hidden = true;
    owner = null;
}

function pick(value) {
    const input = owner;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    input.focus();
}

pop.addEventListener('mousedown', e => {
    e.preventDefault();   // keep the focus in the date box
    const b = e.target.closest('button');
    if (!b || b.disabled || !owner) return;
    if (b.dataset.pick) { pick(b.dataset.pick); return; }
    if (b.dataset.clear !== undefined) { pick(''); return; }
    if (b.dataset.pickToday !== undefined) { pick(iso(today())); return; }
    if (b.dataset.step) { cursor = addMonths(cursor, Number(b.dataset.step)); render(); return; }
    if (b.dataset.toggleView !== undefined) { monthView = !monthView; render(); return; }
    if (b.dataset.month) { cursor = new Date(cursor.getFullYear(), Number(b.dataset.month), Math.min(cursor.getDate(), 28)); monthView = false; render(); }
});
document.addEventListener('mousedown', e => {
    if (owner && !pop.contains(e.target) && !e.target.closest('.dp-wrap')?.contains(owner)) close();
}, true);
document.addEventListener('scroll', e => { if (owner && !pop.contains(e.target)) close(); }, true);
window.addEventListener('resize', close);

function onKey(e) {
    const input = e.currentTarget;
    if (owner !== input) {
        if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') { e.preventDefault(); open(input); }
        return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (monthView && step) {
        e.preventDefault();
        const m = cursor.getMonth() + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key]);
        cursor = new Date(cursor.getFullYear(), m, 1);
        render();
        return;
    }
    if (step) { e.preventDefault(); cursor = addDays(cursor, step); render(); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); cursor = addMonths(cursor, (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)); render(); return; }
    if (e.key === 'Home') { e.preventDefault(); cursor = today(); render(); return; }
    if (e.key === 'Enter') {
        e.preventDefault();
        if (monthView) { monthView = false; render(); return; }
        if (allowed(cursor, bounds(input))) pick(iso(cursor));
        return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') close();
}

function enhanceDate(input) {
    input.dataset.dpEnhanced = '1';
    const wrap = document.createElement('span');
    wrap.className = 'dp-wrap';
    input.parentNode.insertBefore(wrap, input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dp-btn';
    button.tabIndex = -1;
    button.title = 'Pick a date (Alt+↓)';
    button.innerHTML = icon('calendar');
    wrap.append(input, button);
    const tip = () => { const d = parse(input.value); input.title = d ? `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${relativeDay(d)}` : ''; };
    input.addEventListener('change', tip);
    tip();
    button.addEventListener('mousedown', e => { e.preventDefault(); owner === input ? close() : (input.focus(), open(input)); });
    input.addEventListener('click', () => { if (owner !== input) open(input); });
    input.addEventListener('keydown', onKey, true);
    input.addEventListener('blur', () => setTimeout(() => { if (owner === input && document.activeElement !== input) close(); }, 150));
    input.addEventListener('input', () => {   // typed into the box: follow it in the calendar
        if (owner !== input) return;
        const d = parse(input.value);
        if (d) { cursor = d; render(); }
    });
}

export function enhanceDates(root) {
    if (!(root instanceof Element)) return;
    const inputs = root.matches?.('input[type=date]') ? [root] : root.querySelectorAll('input[type=date]');
    inputs.forEach(input => { if (!input.dataset.dpEnhanced && input.dataset.plain === undefined && !input.closest('.dp-pop')) enhanceDate(input); });
}

enhanceDates(document.body);
new MutationObserver(mutations => {
    for (const m of mutations) m.addedNodes.forEach(node => { if (node.nodeType === 1 && node !== pop) enhanceDates(node); });
}).observe(document.body, { childList: true, subtree: true });
