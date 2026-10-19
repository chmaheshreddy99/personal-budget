/**
 * Application footer: a slim live status bar.
 *   left   brand mark and version
 *   middle today's money pulse (spent today, this month vs budget, cash, to collect, next due, net worth);
 *          every item is a shortcut to the page behind it
 *   right  data store health, last posting, keyboard hints (click for the shortcut map) and a clock
 * Refreshes after every change (api.onMutation), on navigation and once a minute.
 */
import { api, onMutation } from '../core/api.js';
import { state } from '../core/store.js';
import { esc } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { moneyShort, percent, shortDate } from '../core/format.js';
import { openShortcutMap } from '../core/keys.js';

const $ = id => document.getElementById(id);
let timer = null;
let pending = null;
let lastPulse = null;

export function startFooter() {
    if (timer) return;
    onMutation(() => refreshFooter());
    window.addEventListener('hashchange', () => refreshFooter(true));
    timer = setInterval(() => (lastPulse ? render(lastPulse) : refreshFooter()), 30000);
    setInterval(() => refreshFooter(), 120000);
    $('foot-pulse').addEventListener('click', e => {
        const item = e.target.closest('[data-go]');
        if (item) location.hash = item.dataset.go;
    });
    $('foot-status').addEventListener('click', e => {
        if (e.target.closest('[data-shortcuts]')) openShortcutMap();
    });
    refreshFooter();
}

/** Re-reads the figures (debounced so a burst of changes costs one request). */
export function refreshFooter(soft = false) {
    if (!state.user) return;
    clearTimeout(pending);
    pending = setTimeout(async () => {
        try {
            lastPulse = await api.get('/pulse');
            render(lastPulse);
        } catch {
            if (!soft) $('foot-status').innerHTML = `<span class="foot-dot down"></span><span>Server unreachable</span>`;
        }
    }, soft ? 50 : 400);
}

function render(p) {
    const month = new Date().toLocaleDateString('en-GB', { month: 'short' });
    const used = p.budgetUsedPercent === null ? null : Number(p.budgetUsedPercent);
    const items = [
        item('#/expenses/today', 'receipt', 'Today', moneyShort(p.spentToday)),
        item('#/expenses', 'arrow-out', `${month} spent`, moneyShort(p.spentThisMonth),
            used === null ? '' : `<span class="foot-meter" title="${percent(used, 0)} of budget"><i class="${used > 100 ? 'over' : ''}" style="width:${Math.min(used, 100)}%"></i></span>
             <span class="${used > 100 ? 'warn' : ''}">${percent(used, 0)}</span>`),
        item('#/accounts', 'bank', 'Cash & bank', moneyShort(p.liquid)),
        Number(p.toCollect) > 0
            ? item('#/expenses/collect', 'hand', 'To collect', moneyShort(p.toCollect),
                p.overdueToCollect ? `<span class="warn">· ${p.overdueToCollect} overdue</span>` : '')
            : '',
        Number(p.cardAndPayables) > 0 ? item('#/accounts', 'card', 'Cards & dues', moneyShort(p.cardAndPayables), '', 'foot-hide-md') : '',
        p.nextDueName ? item('#/planning', 'calendar', 'Next', esc(p.nextDueName),
            `<span>${dueLabel(p.nextDueDate)} · ${moneyShort(p.nextDueAmount)}</span>`, 'foot-hide-md') : '',
        item('#/balance-sheet', 'scale', 'Net worth', moneyShort(p.netWorth), '', 'foot-hide-md'),
    ];
    $('foot-pulse').innerHTML = items.join('');

    const now = new Date();
    $('foot-status').innerHTML = `
        <span class="foot-dot" title="Connected · data saved to disk"></span>
        <span title="Tab-separated tables in the data folder">${icon('database')} ${p.dataFiles} tables · ${size(p.dataBytes)}</span>
        <span class="foot-sep"></span>
        <span title="${p.entryCount} journal entries">${icon('history')} ${p.lastPostedAt ? `Last entry ${ago(p.lastPostedAt)} by ${esc(p.lastPostedBy)}` : 'No entries yet'}</span>
        <span class="foot-sep foot-keys"></span>
        <button class="foot-item foot-keys" data-shortcuts title="All keyboard shortcuts (?)">${icon('keyboard')}<span class="kbd">E</span>expense
            <span class="kbd">I</span>income <span class="kbd">1-0</span>pages <span class="kbd">?</span>all shortcuts</button>
        <span class="foot-sep"></span>
        <span title="${esc(state.user?.tenantName || '')}">${icon('clock')} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>`;
}

function item(go, iconName, label, value, extra = '', cls = '') {
    return `<button class="foot-item ${cls}" data-go="${go}" title="Open ${esc(label)}">${icon(iconName)}<span>${esc(label)}</span><b>${value}</b>${extra}</button>`;
}

function dueLabel(iso) {
    const days = Math.round((new Date(iso + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    if (days <= 0) return '<span class="warn">today</span>';
    if (days === 1) return 'tomorrow';
    return days < 7 ? `in ${days} days` : shortDate(iso);
}

function ago(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
}

function size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
