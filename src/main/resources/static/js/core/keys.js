/**
 * Keyboard support.
 *
 * Global shortcuts live in app.js. A page can add its own keys (usually ↑ / ↓ through its left-pane
 * list or its table) with setPageKeys(handler); the router clears them on every navigation.
 * listNavigator() builds the common "move through a list" handler.
 */
import { esc, openModal } from './ui.js';

let pageHandler = null;

/** handler(event) returns true when it used the key. */
export function setPageKeys(handler) {
    pageHandler = handler;
}

export function clearPageKeys() {
    pageHandler = null;
}

export function runPageKeys(event) {
    return pageHandler ? pageHandler(event) === true : false;
}

/** True while the user is typing somewhere (text keys must not trigger shortcuts). */
export function isTyping(target = document.activeElement) {
    return /INPUT|SELECT|TEXTAREA/.test(target?.tagName) || target?.isContentEditable;
}

/**
 * ↑ / ↓ / PageUp / PageDown / Home / End move the selection through items(); Enter opens it.
 *   items()       the elements in display order
 *   selected()    the selected element, or null
 *   select(el)    make el the selected one (called with { keyboard: true })
 *   open(el)      optional, for Enter
 *   allowWhileTyping: element (e.g. the list's search box) from which the arrows still work
 */
export function listNavigator({ items, selected, select, open, allowWhileTyping = null }) {
    return event => {
        const typing = isTyping(event.target) && event.target !== allowWhileTyping;
        if (typing || event.altKey || event.ctrlKey || event.metaKey) return false;
        const list = items();
        if (!list.length) return false;
        const at = list.indexOf(selected());
        const steps = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
        let next = null;
        if (event.key in steps) next = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + steps[event.key]));
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = list.length - 1;
        else if (event.key === 'Enter' && open && at >= 0 && !event.target.closest?.('button, a')) {
            event.preventDefault();
            open(list[at]);
            return true;
        } else return false;
        event.preventDefault();
        if (next !== at) {
            select(list[next], { keyboard: true });
            list[next].scrollIntoView({ block: 'nearest' });
        }
        return true;
    };
}

/** Every shortcut, grouped, for the shortcut map (footer button or "?"). */
export const SHORTCUTS = [
    { group: 'Add', keys: [['E', 'Expense'], ['I', 'Income'], ['T', 'Transfer'], ['L', 'Lent / paid for someone'], ['B', 'Borrowed / bill to pay'],
        ['N', 'Any transaction'], ['V', 'Journal voucher']] },
    { group: 'Go to', keys: [['1', 'Dashboard'], ['2', 'Expenses'], ['3', 'Income'], ['4', 'Journal'], ['5', 'Accounts'], ['6', 'Chits'],
        ['7', 'Budgets'], ['8', 'Balance sheet'], ['9', 'Reports'], ['0', 'Forecast'], [',', 'Settings']] },
    { group: 'On a page', keys: [['↑ ↓', 'Move through the list'], ['Home End', 'First / last item'], ['PgUp PgDn', 'Jump 8 items'],
        ['Enter', 'Open or expand the selected item'], ['← →', 'Previous / next month or period'], ['/', 'Search on this page'],
        ['R', 'Refresh the page']] },
    { group: 'Anywhere', keys: [['?', 'This shortcut map'], ['Esc', 'Close a dialog or clear a search']] },
];

export function openShortcutMap() {
    if (document.querySelector('.modal-backdrop .shortcut-map')) return;
    openModal({
        title: 'Keyboard shortcuts', iconName: 'keyboard', size: 'lg',
        body: `<div class="shortcut-map">${SHORTCUTS.map(g => `
            <section><div class="section-title">${esc(g.group)}</div>
                ${g.keys.map(([k, label]) => `<div class="sc-row">${k.split(' ').map(x => `<span class="kbd">${esc(x)}</span>`).join('')}<span>${esc(label)}</span></div>`).join('')}
            </section>`).join('')}</div>
            <p class="hint" style="margin-top:10px">Letter and number keys work whenever you are not typing in a box.</p>`,
        actions: [{ label: 'Close', kind: 'primary' }],
    });
}
