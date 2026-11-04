/**
 * The e-mail switch at the foot of a dialog: a small pill beside the buttons that says whether saving this will send
 * an alert by e-mail (Settings › Alerts), and lets the person turn it on or off for this one save.
 *
 * Untouched, it shows what the household's settings will do (on for a subscribed event; for an expense, once the amount
 * reaches the amount set) and sends nothing extra: the server decides. Touched, the save carries X-Notify: on|off.
 * Hidden when e-mail is not set up, or for what has no alert (income, say).
 *
 *   const mail = attachNotify(modal, { event: 'TRANSFER' });                       // or event: () => key, amount: () => number
 *   await api.post('/transactions/quick', body, { key, notify: mail.value() });
 */
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { moneyShort } from '../core/format.js';

let cached = null;
let cachedAt = 0;

/** What the dialogs need, asked once a minute at most. */
export function notifyStatus() {
    if (!cached || Date.now() - cachedAt > 60000) {
        cached = api.get('/notifications/status').catch(() => null);
        cachedAt = Date.now();
    }
    return cached;
}

/** After Settings › Alerts changes: the next dialog asks again. */
export function forgetNotifyStatus() { cached = null; }

const WHAT = {
    CHIT_CREATED: 'this chit', CHIT_PAYMENT: 'this payment', MONEY_GIVEN: 'the money given', PAID_FOR: 'this payment',
    TRANSFER: 'this transfer', LARGE_EXPENSE: 'this expense',
};

export function attachNotify(modal, { event, amount = null, organizer = null } = {}) {
    const foot = modal.el.querySelector('.modal-foot');
    const pill = document.createElement('label');
    pill.className = 'nt-pill';
    pill.hidden = true;
    pill.innerHTML = `<input type="checkbox"><span class="nt-sw" aria-hidden="true"></span>${icon('mail')}<span class="nt-label">E-mail</span><small class="nt-why"></small>`;
    foot?.prepend(pill);
    const box = pill.querySelector('input');
    const why = pill.querySelector('.nt-why');
    let touched = false;
    let status = null;
    const key = () => (typeof event === 'function' ? event() : event);

    // what the settings would do without the switch
    const auto = k => {
        if (!status?.enabled || !status.events?.[k]) return false;
        if (k !== 'LARGE_EXPENSE') return true;
        return Number(amount?.() || 0) >= Number(status.expenseThreshold || 0);
    };
    const sync = () => {
        const k = key();
        pill.hidden = !status?.mailReady || !k;
        if (pill.hidden) return;
        if (!touched) box.checked = auto(k);
        pill.classList.toggle('on', box.checked);
        pill.classList.toggle('set', touched);
        const org = typeof organizer === 'function' ? organizer() : organizer;
        why.textContent = touched ? '' : box.checked ? 'auto' : k === 'LARGE_EXPENSE' && status.enabled && status.events?.[k] ? `from ${moneyShort(status.expenseThreshold)}` : '';
        const to = (status.to || []).join(', ') || 'no address yet (Settings › Alerts)';
        pill.title = `${box.checked ? 'An e-mail about' : 'No e-mail about'} ${WHAT[k] || 'this'} ${box.checked ? `goes to ${to}` : 'will be sent'}`
            + `${box.checked && org ? `, and a copy to the organizer (${org})` : ''}. ${touched ? 'Your choice for this save.' : 'As set in Settings › Alerts: tap to change for this save.'}`;
    };
    box.addEventListener('change', () => { touched = true; sync(); });
    // the amount, or the kind of entry (tabs), can change what the settings would do
    ['input', 'change', 'click'].forEach(type => modal.el.addEventListener(type, e => { if (!pill.contains(e.target)) queueMicrotask(sync); }));
    notifyStatus().then(s => { status = s; sync(); });
    return {
        /** 'on' or 'off' when the person chose, else undefined (the settings decide). */
        value: () => (pill.hidden || !touched ? undefined : box.checked ? 'on' : 'off'),
        refresh: sync,
    };
}
