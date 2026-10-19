/**
 * Autocomplete for every box in the app.
 *
 *  1. Text inputs get suggestions from your own history (narrations, payees, references, memos,
 *     institutions, names, notes), ranked by how often and how recently they were used.
 *     Picking a past narration also fills the accounts and amount of that last transaction
 *     when the form has empty fields for them.
 *  2. Long <select>s (account pickers and other long lists) become searchable comboboxes that show
 *     account icons, types and balances.
 *
 * Nothing needs to be wired by hand: a MutationObserver enhances inputs and selects as soon as they
 * appear in the page, including those inside dialogs. Opt out with data-plain on the element.
 * A form (or input) can say which kinds of entry it records with data-suggest-kinds="EXPENSE" (voucher
 * types, comma separated): it then only suggests values used with those, so the expense form never offers
 * chit installments or repayments.
 */
import { api, onMutation } from './api.js';
import { state, loadAccounts } from './store.js';
import { icon, accountTypeIcon } from './icons.js';
import { esc } from './ui.js';
import { money, shortDate } from './format.js';

/** Which history list an input uses, by input name. */
const FIELD_BY_NAME = {
    narration: 'narration', q: 'narration', party: 'party', reference: 'reference', memo: 'memo',
    institution: 'institution', organizer: 'organizer', name: 'name', notes: 'notes', description: 'notes',
};

const MAX_ITEMS = 8;

// ===================================================================== history cache

let history = null;
let loading = null;

export function loadSuggestions() {
    if (history) return Promise.resolve(history);
    loading ??= api.get('/suggestions').then(data => { history = data; loading = null; return data; })
        .catch(() => { loading = null; return {}; });
    return loading;
}

/** Forget cached history so new values show up next time (done automatically after every change). */
export function invalidateSuggestions() {
    history = null;
}
onMutation(path => { if (!path.startsWith('/auth')) invalidateSuggestions(); });

// ===================================================================== shared popup

const popup = document.createElement('div');
popup.className = 'ac-pop';
popup.hidden = true;
document.body.appendChild(popup);

let owner = null;        // the control the popup currently belongs to
let items = [];          // rendered choices: [{ html, pick() }]
let active = -1;

function place(anchor) {
    const box = anchor.getBoundingClientRect();
    const width = Math.max(box.width, 280);
    let left = Math.min(box.left, window.innerWidth - width - 8);
    popup.style.width = width + 'px';
    popup.style.left = Math.max(8, left) + 'px';
    const below = window.innerHeight - box.bottom;
    popup.style.maxHeight = Math.max(160, Math.min(340, below > 220 ? below - 16 : box.top - 16)) + 'px';
    if (below > 220 || below > box.top) {
        popup.style.top = (box.bottom + 4) + 'px';
        popup.style.bottom = '';
    } else {
        popup.style.top = '';
        popup.style.bottom = (window.innerHeight - box.top + 4) + 'px';
    }
}

function show(anchor, header, list, footer = '') {
    owner = anchor;
    items = list;
    active = list.length ? 0 : -1;
    popup.innerHTML = `${header}<div class="ac-list">${list.map((it, i) =>
        `<div class="ac-item ${i === active ? 'active' : ''} ${it.groupStart ? 'group-start' : ''}" data-i="${i}">
            ${it.group ? `<div class="ac-group">${esc(it.group)}</div>` : ''}${it.html}</div>`).join('')
        || '<div class="ac-empty">No matches</div>'}</div>${footer}`;
    popup.hidden = false;
    place(anchor);
}

function hide() {
    popup.hidden = true;
    owner = null;
    items = [];
}

function move(step) {
    if (!items.length) return;
    active = (active + step + items.length) % items.length;
    popup.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('active', i === active));
    popup.querySelector('.ac-item.active')?.scrollIntoView({ block: 'nearest' });
}

popup.addEventListener('mousedown', e => {
    if (e.target.closest('input')) return;  // allow typing in the combobox search box
    e.preventDefault();                     // keep focus in the input
    const el = e.target.closest('.ac-item[data-i]');
    if (el) items[Number(el.dataset.i)]?.pick();
});
window.addEventListener('resize', hide);
document.addEventListener('scroll', e => { if (!popup.contains(e.target)) hide(); }, true);

/** Highlights the typed text inside a value. */
function mark(value, term) {
    if (!term) return esc(value);
    const i = value.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0) return esc(value);
    return esc(value.slice(0, i)) + '<mark>' + esc(value.slice(i, i + term.length)) + '</mark>' + esc(value.slice(i + term.length));
}

// ===================================================================== text suggestions

function accountName(id) {
    return state.accounts?.find(a => a.id === id)?.name;
}

function attachSuggest(input, field) {
    input.setAttribute('autocomplete', 'off');
    input.dataset.enhanced = '1';

    const render = async () => {
        const [data] = await Promise.all([loadSuggestions(), loadAccounts()]);
        if (document.activeElement !== input) return;
        const term = input.value.trim().toLowerCase();
        const kinds = (input.dataset.suggestKinds || input.closest('[data-suggest-kinds]')?.dataset.suggestKinds || '').split(',').filter(Boolean);
        const list = (data[field] || [])
            .filter(s => !kinds.length || !s.kinds?.length || s.kinds.some(k => kinds.includes(k)))
            .filter(s => !term || s.value.toLowerCase().includes(term))
            .filter(s => s.value.toLowerCase() !== term)
            .sort((a, b) => Number(b.value.toLowerCase().startsWith(term)) - Number(a.value.toLowerCase().startsWith(term)))
            .slice(0, MAX_ITEMS);
        if (!list.length) { if (owner === input) hide(); return; }
        show(input, `<div class="ac-head">${icon('history')} From your history</div>`, list.map(s => ({
            html: `<div class="ac-main"><span class="ac-value"><span class="ac-label">${mark(s.value, term)}</span></span>
                   ${s.debitAccountId ? `<span class="ac-sub">${esc(accountName(s.debitAccountId) || '')}
                       ${s.creditAccountId ? ` ← ${esc(accountName(s.creditAccountId) || '')}` : ''}</span>` : ''}</div>
                   <div class="ac-meta">${s.amount ? `<b>${money(s.amount)}</b>` : ''}
                       <span>${s.count > 1 ? `${s.count}× · ` : ''}${s.lastUsed ? shortDate(s.lastUsed) : ''}</span></div>`,
            pick: () => {
                input.value = s.value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new CustomEvent('suggestpick', { bubbles: true, detail: s }));
                fillFromTemplate(input, s);
                hide();
            },
        })));
    };

    input.addEventListener('focus', render);
    input.addEventListener('input', () => { if (owner === input || document.activeElement === input) render(); });
    input.addEventListener('blur', () => setTimeout(() => { if (owner === input) hide(); }, 120));
    input.addEventListener('keydown', e => {
        if (owner !== input || popup.hidden) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); items[active].pick(); }
        else if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    });
}

/** Fills empty account and amount fields of the surrounding form from a narration template. */
function fillFromTemplate(input, s) {
    const form = input.closest('form');
    if (!form || !s.debitAccountId) return;
    const setIfEmpty = (name, value) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (!el || el.value || value === null || value === undefined) return;
        if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(value))) return;
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el._combo?.refresh();
    };
    setIfEmpty('toAccountId', s.debitAccountId);
    setIfEmpty('fromAccountId', s.creditAccountId);
    setIfEmpty('debitAccountId', s.debitAccountId);
    setIfEmpty('creditAccountId', s.creditAccountId);
    setIfEmpty('amount', s.amount);
}

// ===================================================================== searchable selects

function optionInfo(option) {
    const type = option.dataset.type;
    const balance = option.dataset.balance;
    const { name, tone } = type ? accountTypeIcon(type) : { name: null, tone: '' };
    return {
        value: option.value,
        label: option.textContent.trim(),
        group: option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : '',
        meta: option.dataset.meta || '',
        balance,
        chip: name ? `<span class="chip-icon sm ${tone}">${icon(name)}</span>` : '',
    };
}

function enhanceSelect(select) {
    select.dataset.enhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    select.parentNode.insertBefore(wrap, select);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'combo-display';
    wrap.append(button, select);
    select.classList.add('combo-native');
    select.tabIndex = -1;

    const refresh = () => {
        button.disabled = select.disabled;
        wrap.classList.toggle('short', select.options.length <= 8 && !select.querySelector('optgroup'));
        const option = select.selectedOptions[0];
        const info = option && option.value !== '' ? optionInfo(option) : null;
        button.innerHTML = info
            ? `${info.chip}<span class="combo-label">${esc(info.label)}</span>
               ${info.balance !== undefined ? `<span class="combo-meta">${money(info.balance)}</span>` : ''}${icon('chevron-down')}`
            : `<span class="combo-placeholder">${esc(option?.textContent.trim() || 'Select…')}</span>${icon('chevron-down')}`;
    };
    select._combo = { refresh };
    select.addEventListener('change', refresh);
    // code that sets the value, swaps the options or disables the select is shown at once
    for (const prop of ['value', 'selectedIndex']) {
        const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
        Object.defineProperty(select, prop, {
            configurable: true,
            get() { return native.get.call(this); },
            set(v) { native.set.call(this, v); refresh(); },
        });
    }
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    refresh();

    const open = () => {
        const term = { value: '' };
        const build = () => {
            const options = [...select.options].filter(o => o.value !== '').map(optionInfo)
                .filter(o => !term.value || (o.label + ' ' + o.group + ' ' + o.meta).toLowerCase().includes(term.value));
            let lastGroup = null;
            return options.map(o => {
                const group = o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return {
                    group, groupStart: !!group,
                    html: `<div class="ac-row ${o.value === select.value ? 'selected' : ''}">${o.chip}
                        <span class="ac-value"><span class="ac-label">${mark(o.label, term.value)}</span>${o.meta ? `<span class="ac-sub">${esc(o.meta)}</span>` : ''}</span>
                        ${o.balance !== undefined ? `<span class="ac-meta"><b>${money(o.balance)}</b></span>` : ''}
                        ${o.value === select.value ? icon('check') : ''}</div>`,
                    pick: () => {
                        select.value = o.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        hide();
                        button.focus();
                    },
                };
            });
        };
        // a short list needs no search box: arrows / Enter or a click pick straight away
        const short = select.options.length <= 8 && !select.querySelector('optgroup');
        const header = `<div class="ac-search ${short ? 'ac-search-hidden' : ''}">${icon('search')}<input placeholder="Type to search…" autocomplete="off" data-plain></div>`;
        show(button, header, build());
        const search = popup.querySelector('.ac-search input');
        const selected = items.findIndex(it => it.html.includes('ac-row selected'));
        if (selected >= 0) { active = selected; move(0); }
        search.focus();
        search.addEventListener('input', () => {
            term.value = search.value.trim().toLowerCase();
            const list = build();
            items = list;
            active = list.length ? 0 : -1;
            popup.querySelector('.ac-list').innerHTML = list.map((it, i) =>
                `<div class="ac-item ${i === active ? 'active' : ''}" data-i="${i}">
                    ${it.group ? `<div class="ac-group">${esc(it.group)}</div>` : ''}${it.html}</div>`).join('')
                || '<div class="ac-empty">No matches</div>';
        });
        search.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) items[active].pick(); }
            else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); hide(); button.focus(); }
        });
        search.addEventListener('blur', () => setTimeout(() => {
            if (owner === button && !popup.contains(document.activeElement)) hide();
        }, 150));
    };

    button.addEventListener('click', () => (owner === button && !popup.hidden ? hide() : open()));
    button.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    // keep native validation messages pointing at the visible control
    select.addEventListener('invalid', () => button.classList.add('invalid'));
    select.addEventListener('change', () => button.classList.remove('invalid'));
}

// ===================================================================== automatic enhancement

/** Every single-choice dropdown gets the same look (opt out with data-plain); not multi-selects or list boxes. */
function shouldComboize(select) {
    return !select.multiple && !(select.size > 1) && !select.closest('.ac-pop');
}

/** Enhances every eligible input and select inside root. Safe to call repeatedly. */
export function enhance(root) {
    if (!(root instanceof Element)) return;
    const inputs = root.matches?.('input[name]') ? [root] : root.querySelectorAll('input[name]');
    inputs.forEach(input => {
        const field = input.dataset.suggest || FIELD_BY_NAME[input.name];
        if (field && !input.dataset.enhanced && input.dataset.plain === undefined
            && (input.type === 'text' || input.type === 'search' || !input.getAttribute('type'))) {
            attachSuggest(input, field);
        }
    });
    const selects = root.matches?.('select') ? [root] : root.querySelectorAll('select');
    selects.forEach(select => {
        if (!select.dataset.enhanced && select.dataset.plain === undefined && shouldComboize(select)) enhanceSelect(select);
    });
}

new MutationObserver(mutations => {
    for (const m of mutations) {
        m.addedNodes.forEach(node => { if (node.nodeType === 1 && node !== popup && !popup.contains(node)) enhance(node); });
    }
}).observe(document.body, { childList: true, subtree: true });
