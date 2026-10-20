/**
 * Brick Management notifications.
 * <ul>
 *   <li>A new order taken by someone else: an alert on the screen, whatever page is open, with a chime and the order
 *       read out (the order number, the customer, the bricks, the day needed and where); several queue in the same
 *       alert. "Open the order" opens it (and the notice is seen); "Later" keeps it in the bell.</li>
 *   <li>Other notices (a request to approve and its answer, a signed delivery, a reported payment): a card in the corner.</li>
 *   <li>The bell: what is not seen yet; a notice is seen when it, or what it is about, is opened (an order, a request),
 *       and all can be cleared at once. Seen and cleared are kept for the user, on every device.</li>
 * </ul>
 * Sound and voice are this browser's choice (the speaker button); the voice is the browser's own (an Indian English one
 * when there is one). Browsers play sound only after the page was clicked once, so the alert also flashes the title.
 */
import { api } from '../core/api.js';
import { esc } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';

const NOTE_ICON = { ORDER: 'cart', APPROVAL: 'shield', DECISION: 'check-circle', SIGNED: 'signature', PAID: 'arrow-in' };
const NOTE_TONE = { ORDER: 'aqua', APPROVAL: 'gold', DECISION: 'violet', SIGNED: 'aqua', PAID: 'gold' };
const count = n => Number(n || 0).toLocaleString('en-IN');
let notices = null;

// ===================================================================== preferences (this browser)

const pref = (key, dflt) => { try { const v = localStorage.getItem(`pb.bk.${key}`); return v === null ? dflt : v === '1'; } catch { return dflt; } };
const setPref = (key, on) => { try { localStorage.setItem(`pb.bk.${key}`, on ? '1' : '0'); } catch { /* not kept */ } };

// ===================================================================== the bell

export const bellHtml = () => `<button type="button" class="btn sm ghost icon bk-bell" data-bell title="Notifications">${icon('bell')}<i data-bell-count hidden></i></button>`;

export async function loadNotices() {
    try { notices = await api.get('/bricks/notices'); } catch { notices = notices || []; }
    paintCount();
    return notices;
}

function paintCount() {
    const n = (notices || []).length;
    document.querySelectorAll('[data-bell-count]').forEach(el => { el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n); });
}

/** A notice seen (by its id), or everything a link is about (an order opened, a request opened). Quietly; the bell follows. */
export async function markSeen({ id = null, link = null } = {}) {
    if (notices) {
        const hit = notices.filter(n => id ? n.id === id : n.link && (n.link === link || n.link.startsWith(`${link}/`)));
        if (!hit.length) return;   // nothing of it unseen
        notices = notices.filter(n => !hit.includes(n));
        paintCount();
    }
    try { id ? await api.post(`/bricks/notices/${id}/read`) : await api.post('/bricks/notices/seen', { link }); } catch { /* seen next time */ }
}

export function bindBell(btn) {
    if (!btn) return;
    loadNotices();
    btn.addEventListener('click', async e => {
        e.stopPropagation();
        document.querySelector('.bk-bell-pop')?.remove();
        const list = await loadNotices();
        const pop = document.createElement('div');
        pop.className = 'bk-bell-pop';
        const draw = () => {
            pop.innerHTML = `<div class="bk-bell-h"><b>${icon('bell')}Notifications${notices.length ? ` <span class="badge sm">${notices.length}</span>` : ''}</b><span class="spacer"></span>
                    <button class="btn sm ghost icon" data-sound title="${pref('sound', true) ? 'Sound and voice on: click to mute' : 'Muted: click for sound and voice'}">${icon(pref('sound', true) ? 'volume' : 'volume-x')}</button>
                    ${notices.length ? `<button class="link-btn" data-clear>${icon('check')}Clear all</button>` : ''}</div>
                <div class="bk-bell-list">${notices.length ? notices.map(n => `<div class="bk-note new" data-go="${esc(n.link || '')}" data-id="${n.id}">
                    <span class="chip-icon sm ${NOTE_TONE[n.kind] || ''}">${icon(NOTE_ICON[n.kind] || 'bell')}</span>
                    <span class="grow min-0"><b class="ellipsis">${esc(n.title)}</b><small>${esc(n.body || '')}</small>
                    <small class="muted">${esc(n.actor || '')} · ${dateTime(n.createdAt)}</small></span>
                    <button class="btn sm ghost icon bk-note-x" data-read="${n.id}" title="Seen: clear it">${icon('x')}</button></div>`).join('')
                    : `<p class="small muted bk-bell-empty">${icon('check-circle')} All caught up: new orders, approvals and signed deliveries show here.</p>`}</div>
                ${'Notification' in window && Notification.permission === 'default' ? '<div class="bk-bell-foot"><button class="link-btn" data-desktop>Also show them on the desktop</button></div>' : ''}`;
        };
        draw();
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        Object.assign(pop.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 390))}px` });
        pop.addEventListener('click', async ev => {
            ev.stopPropagation();
            const d = ev.target.closest('[data-desktop]');
            if (d) { Notification.requestPermission().then(draw); return; }
            if (ev.target.closest('[data-sound]')) { setPref('sound', !pref('sound', true)); return draw(); }
            if (ev.target.closest('[data-clear]')) {
                notices = [];
                paintCount();
                draw();
                try { await api.post('/bricks/notices/read-all'); } catch { loadNotices(); }
                return;
            }
            const x = ev.target.closest('[data-read]');
            if (x) { await markSeen({ id: Number(x.dataset.read) }); return draw(); }
            const go = ev.target.closest('[data-go]');
            if (go?.dataset.go) { pop.remove(); markSeen({ id: Number(go.dataset.id) }); location.hash = `#/${go.dataset.go}`; }
        });
        const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', close); } };
        setTimeout(() => document.addEventListener('mousedown', close), 0);
    });
}

// ===================================================================== sound and voice

let audio = null;
/** Browsers let a page play sound only after it was used: the first click unlocks it. */
const unlock = () => {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
};
document.addEventListener('pointerdown', unlock, { once: true, capture: true });
document.addEventListener('keydown', unlock, { once: true, capture: true });

/** A short, bright two-note chime (twice for an order). */
function chime(times = 2) {
    if (!pref('sound', true)) return;
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const t0 = audio.currentTime + 0.02;
        for (let k = 0; k < times; k++) {
            [[880, 0], [1320, 0.16]].forEach(([f, dt]) => {
                const o = audio.createOscillator(), g = audio.createGain();
                o.type = 'sine';
                o.frequency.value = f;
                const at = t0 + k * 0.55 + dt;
                g.gain.setValueAtTime(0.0001, at);
                g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
                o.connect(g).connect(audio.destination);
                o.start(at);
                o.stop(at + 0.45);
            });
        }
    } catch { /* no sound here */ }
}

/** "16X4X8 Dies" read as "16 by 4 by 8 dies"; "SO-0008" as "S O 8". */
const sayable = s => String(s || '').replace(/(\d+)\s*[xX×]\s*(?=\d)/g, '$1 by ').replace(/\bSO-0*(\d+)/g, 'S O $1');

function speak(text) {
    if (!pref('sound', true) || !('speechSynthesis' in window)) return;
    try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        u.voice = voices.find(v => v.lang === 'en-IN') || voices.find(v => v.lang?.startsWith('en-GB')) || voices.find(v => v.lang?.startsWith('en')) || null;
        u.lang = u.voice?.lang || 'en-IN';
        u.rate = 0.95;
        u.pitch = 1;
        // after the chime
        setTimeout(() => speechSynthesis.speak(u), 1100);
    } catch { /* no voice here */ }
}

/** What is read out: the order, the customer, the bricks, the day needed, where, who took it. */
function orderWords(o, n) {
    const items = (o.items || []).map(i => `${count(i.quantity)} ${sayable(i.name)}`);
    const bricks = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '';
    const day = o.requiredBy ? new Date(`${o.requiredBy}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    return [`New order ${sayable(o.orderNo)}`, `from ${o.customer}`, bricks && `${bricks}`, day && `needed by ${day}`, o.address && `to ${o.address}`,
        n.actor && `taken by ${n.actor}`].filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '.';
}

// ===================================================================== the new order alert

const queue = [];
let shown = 0;
let reminder = null;
const baseTitle = document.title;
let flash = null;

function dataOf(n) {
    try { return n.data ? JSON.parse(n.data) : null; } catch { return null; }
}

function closeAlert() {
    document.querySelector('.bk-alert-back')?.remove();
    clearInterval(reminder); reminder = null;
    clearInterval(flash); flash = null;
    document.title = baseTitle;
    try { speechSynthesis.cancel(); } catch { /* none */ }
}

function drawAlert() {
    if (!queue.length) return closeAlert();
    shown = Math.min(shown, queue.length - 1);
    const n = queue[shown], o = dataOf(n) || { orderNo: n.title.replace('New order ', ''), customer: n.body };
    const total = (o.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
    let back = document.querySelector('.bk-alert-back');
    if (!back) {
        back = document.createElement('div');
        back.className = 'bk-alert-back';
        document.body.appendChild(back);
        back.addEventListener('click', onAlertClick);
    }
    back.innerHTML = `<div class="bk-alert" role="alertdialog" aria-live="assertive" aria-label="New order">
        <div class="bk-alert-top">
            <span class="bk-alert-ring">${icon('cart')}</span>
            <div class="grow min-0"><small>${queue.length > 1 ? `${queue.length} new orders` : 'New order'} · ${esc(n.actor || '')} · ${dateTime(n.createdAt)}</small>
                <h2>${esc(o.orderNo || '')} <span>${esc(o.customer || '')}</span></h2></div>
            <button class="btn sm ghost icon" data-a="sound" title="${pref('sound', true) ? 'Mute sound and voice' : 'Sound and voice'}">${icon(pref('sound', true) ? 'volume' : 'volume-x')}</button>
            <button class="btn sm ghost icon" data-a="later" title="Later (it stays in the bell)">${icon('x')}</button>
        </div>
        <div class="bk-alert-body">
            <table class="bk-alert-items"><tbody>${(o.items || []).map(i => `<tr><td><b>${esc(i.name)}</b></td><td class="r">${count(i.quantity)}</td>
                <td class="r muted">${i.price !== undefined ? `at ${money(i.price, { decimals: 2 })}` : ''}</td></tr>`).join('')}</tbody>
                ${total ? `<tfoot><tr><td>${count(total)} bricks</td><td></td><td class="r">${o.amount !== undefined ? `<b>${money(o.amount)}</b>` : ''}</td></tr></tfoot>` : ''}</table>
            <div class="bk-alert-facts">
                ${o.requiredBy ? `<div>${icon('calendar')}<span><small>Needed by</small><b>${date(o.requiredBy)}</b></span></div>` : ''}
                ${o.address ? `<div>${icon('map-pin')}<span><small>Deliver to</small><b>${esc(o.address)}</b></span></div>` : ''}
                ${o.phone ? `<div>${icon('phone')}<span><small>Mobile</small><b>${esc(o.phone)}</b></span></div>` : ''}
                <div>${icon('truck')}<span><small>Transport</small><b>${o.hired ? 'Hired vehicle' : 'Our vehicle'}</b></span></div>
            </div>
        </div>
        <div class="bk-alert-foot">
            ${queue.length > 1 ? `<span class="bk-alert-nav"><button class="btn sm ghost icon" data-a="prev" ${shown ? '' : 'disabled'}>${icon('chevron-left')}</button>
                <small>${shown + 1} of ${queue.length}</small><button class="btn sm ghost icon" data-a="next" ${shown < queue.length - 1 ? '' : 'disabled'}>${icon('chevron-right')}</button></span>` : ''}
            <button class="btn ghost" data-a="say" title="Read it out again">${icon('volume')}Read out</button>
            <span class="spacer"></span>
            <button class="btn" data-a="seen" title="Seen: clear it without opening">${icon('check')}Seen</button>
            <button class="btn" data-a="later">Later</button>
            <button class="btn primary" data-a="open">${icon('external-link')}Open the order</button>
        </div></div>`;
    back.querySelector('[data-a="open"]')?.focus();
}

function onAlertClick(e) {
    const a = e.target.closest('[data-a]')?.dataset.a;
    const n = queue[shown];
    if (!a || !n) return;
    if (a === 'sound') { setPref('sound', !pref('sound', true)); if (!pref('sound', true)) try { speechSynthesis.cancel(); } catch { /* none */ } return drawAlert(); }
    if (a === 'say') { const o = dataOf(n); if (o) { chime(1); speak(orderWords(o, n)); } return; }
    if (a === 'prev') { shown--; return drawAlert(); }
    if (a === 'next') { shown++; return drawAlert(); }
    if (a === 'later') { closeAlert(); queue.length = 0; return; }   // kept in the bell
    if (a === 'seen' || a === 'open') {
        queue.splice(shown, 1);
        markSeen({ id: n.id });
        if (a === 'open') {
            closeAlert();
            location.hash = `#/${n.link}`;
            queue.length = 0;
            return;
        }
        drawAlert();
    }
}

document.addEventListener('keydown', e => {
    if (!document.querySelector('.bk-alert-back')) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeAlert(); queue.length = 0; }
}, true);

function orderAlert(n) {
    if (queue.some(x => x.id === n.id)) return;
    queue.push(n);
    shown = queue.length - 1;
    drawAlert();
    const o = dataOf(n);
    chime(2);
    if (o) speak(orderWords(o, n));
    // not answered: a gentle reminder, twice at most
    clearInterval(reminder);
    let left = 2;
    reminder = setInterval(() => { if (!document.querySelector('.bk-alert-back') || !left--) return clearInterval(reminder); chime(1); }, 60000);
    // in another tab or window: the title says so, and the desktop when allowed
    if (document.hidden) {
        clearInterval(flash);
        let on = false;
        flash = setInterval(() => { document.title = (on = !on) ? `🔔 New order ${o?.orderNo || ''}` : baseTitle; }, 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flash); document.title = baseTitle; } }, { once: true });
        if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(n.title, { body: n.body || '', tag: `bk-${n.id}`, requireInteraction: true }).onclick = () => { window.focus(); }; } catch { /* not shown */ }
        }
    }
}

// ===================================================================== a notice arriving live

window.addEventListener('brick-notice', e => {
    const n = e.detail?.notice;
    if (!n) return;
    if (notices && !notices.some(x => x.id === n.id)) notices.unshift(n);
    paintCount();
    if (n.kind === 'APPROVAL' || n.kind === 'DECISION') window.dispatchEvent(new Event('brick-approvals-changed'));
    // a new order: the alert, with sound and voice
    if (n.kind === 'ORDER') return orderAlert(n);
    const box = document.querySelector('.bk-pop-stack') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'bk-pop-stack' }));
    const card = document.createElement('div');
    card.className = `bk-pop ${NOTE_TONE[n.kind] || ''}`;
    card.innerHTML = `<span class="chip-icon sm ${NOTE_TONE[n.kind] || ''}">${icon(NOTE_ICON[n.kind] || 'bell')}</span>
        <div class="grow min-0"><b>${esc(n.title)}</b><small>${esc(n.body || '')}</small><small class="muted">${esc(n.actor || '')}</small></div>
        <button class="btn sm ghost icon" data-x title="Close">${icon('x')}</button>`;
    card.addEventListener('click', ev => {
        if (!ev.target.closest('[data-x]') && n.link) { markSeen({ id: n.id }); location.hash = `#/${n.link}`; }
        card.remove();
    });
    box.appendChild(card);
    chime(1);
    setTimeout(() => card.classList.add('out'), 9000);
    setTimeout(() => card.remove(), 9600);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification(n.title, { body: n.body || '', tag: `bk-${n.id}` }).onclick = () => { window.focus(); if (n.link) location.hash = `#/${n.link}`; }; } catch { /* not shown */ }
    }
});

// what a notice is about, opened anywhere (an order, a request): its notices are seen
window.addEventListener('hashchange', () => {
    const m = location.hash.match(/^#\/(bricks\/(?:sales|approvals)\/\d+)/);
    if (m) markSeen({ link: m[1] });
});
