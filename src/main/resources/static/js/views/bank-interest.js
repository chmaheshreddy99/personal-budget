/**
 * Accounts › a bank account › Balance & interest. One bar: the dates (calendar presets or exact dates, remembered) and
 * the account's interest plan. Under it the dates in five figures, then two tables of one line a row with their totals in
 * sight: the interest of each period touching the dates, and each month's average of daily closing balances. What waits to
 * be posted shows whatever the dates. The plan says at what rate, how often (monthly or quarterly), from which date and
 * whether finished periods post by themselves; a finished period can also be posted by hand, with what the bank really
 * paid. The reckoning is on the server (BankInterestService).
 */
import { api } from '../core/api.js';
import { can } from '../core/store.js';
import { esc, field, readForm, openModal, routeNextDialog, dialogOpen, toast, confirmDialog, emptyState, loading } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, monthLabel, isoDate } from '../core/format.js';
import { getPref, setPref } from '../core/prefs.js';
import { readQuery, setQuery } from '../core/route.js';

const FREQUENCY = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly' };
const STATE = { RUNNING: ['aqua', 'Running'], DUE: ['gold', 'To post'], POSTED: ['good', 'Posted'], SKIPPED: ['gray', 'Undone'] };

const rupees = v => money(Math.round(Number(v)));

/** The ranges on offer, from today: from / to empty means no limit. */
function presets() {
    const t = new Date(`${isoDate()}T00:00:00`);
    const y = t.getFullYear(), m = t.getMonth();
    const q = Math.floor(m / 3) * 3;
    const fy = m >= 3 ? y : y - 1;
    const iso = (...parts) => isoDate(new Date(...parts));
    const today = iso(y, m, t.getDate());
    return [
        { key: 'month', label: 'This month', from: iso(y, m, 1), to: today },
        { key: 'lastMonth', label: 'Last month', from: iso(y, m - 1, 1), to: iso(y, m, 0) },
        { key: 'quarter', label: 'This quarter', from: iso(y, q, 1), to: today },
        { key: 'lastQuarter', label: 'Last quarter', from: iso(y, q - 3, 1), to: iso(y, q, 0) },
        { key: 'year', label: 'This year', from: iso(y, 0, 1), to: today },
        { key: 'fy', label: 'This FY', title: 'This financial year, from April', from: iso(fy, 3, 1), to: today },
        { key: 'lastFy', label: 'Last FY', title: 'Last financial year', from: iso(fy - 1, 3, 1), to: iso(fy, 2, 31) },
        { key: 'all', label: 'All', title: 'Since the first entry', from: null, to: null },
    ];
}

/** Draws the pane into `el`; `onChanged` runs after anything that moved the account's balance. */
export async function mountBankInterest(el, account, onChanged) {
    const pref = getPref('bankInterest', { range: 'fy', from: null, to: null });
    // #/accounts/<id>?pane=interest&range=lastQuarter (or range=custom&rfrom=…&rto=…): the address goes first
    const address = readQuery();
    if (presets().some(p => p.key === address.get('range'))) Object.assign(pref, { range: address.get('range'), from: null, to: null });
    else if (address.get('range') === 'custom' && address.get('rfrom') && address.get('rto')) Object.assign(pref, { range: 'custom', from: address.get('rfrom'), to: address.get('rto') });
    let o = null;
    let asked = 0;

    const dates = () => {
        if (pref.range === 'custom') return { from: pref.from, to: pref.to };
        return presets().find(p => p.key === pref.range) || presets().find(p => p.key === 'fy');
    };
    const load = async () => {
        const mine = ++asked;   // a slower answer to an earlier choice does not overwrite this one
        const { from, to } = dates();
        const answer = await api.get(`/accounts/${account.id}/interest`, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
        if (mine !== asked || !el.isConnected) return;
        o = answer;
        el.innerHTML = paneHtml(o, account, pref);
        const custom = pref.range === 'custom';
        setQuery({ range: pref.range, rfrom: custom ? pref.from : null, rto: custom ? pref.to : null });
    };
    const choose = (range, from = null, to = null) => {
        Object.assign(pref, { range, from, to });
        setPref('bankInterest', pref);
        return load();
    };

    el.innerHTML = loading();
    await load();
    if (!o) return;
    // ...&dialog=interest-plan, or dialog=post-interest&period=<from>: the dialog comes back too
    const dialog = readQuery().get('dialog');
    if (dialog === 'interest-plan' && can('MANAGE_ACCOUNTS') && !dialogOpen()) openPlan(account, o, onChanged);
    if (dialog === 'post-interest' && can('POST_TRANSACTIONS') && !dialogOpen()) {
        const period = o.periods.find(p => p.from === readQuery().get('period') && (p.state === 'DUE' || p.state === 'SKIPPED'));
        if (period) openPost(account, period, onChanged); else setQuery({ dialog: null, period: null });
    }

    el.addEventListener('change', e => {
        if (!e.target.matches('[data-bi-from], [data-bi-to]')) return;
        const from = el.querySelector('[data-bi-from]').value, to = el.querySelector('[data-bi-to]').value;
        if (from && to && from <= to) choose('custom', from, to);
    });
    el.addEventListener('click', async e => {
        const chip = e.target.closest('[data-bi-range]');
        if (chip) {
            const key = chip.dataset.biRange;
            if (key === 'custom') { const d = o.range || { from: isoDate(), to: isoDate() }; choose('custom', d.from, d.to); }
            else choose(key);
            return;
        }
        const button = e.target.closest('[data-bi]');
        if (!button) return;
        const act = button.dataset.bi;
        if (act === 'plan') openPlan(account, o, onChanged);
        if (act === 'show-due') choose('all');
        if (act === 'post') openPost(account, o.periods.find(p => p.from === button.dataset.from), onChanged);
        if (act === 'undo') {
            const period = o.periods.find(p => String(p.postingId) === button.dataset.posting);
            const auto = o.autoPost ? ' The account posts by itself, so this period will then wait for you to post it by hand.' : '';
            if (await confirmDialog(`Take the ${money(period.amount)} interest of ${period.label} out of the books?${auto}`, { confirmLabel: 'Undo' })) {
                await api.del(`/accounts/${account.id}/interest/${period.postingId}`);
                toast('Interest undone');
                onChanged();
            }
        }
    });
}

function paneHtml(o, account, pref) {
    if (!o.firstEntry) return emptyState('Nothing on this account yet: its average balance starts with its first entry.', 'bank');
    const r = o.range;
    const tile = (label, value, sub = '', cls = '') => `<div class="bi-tile ${cls}"><small>${label}</small><b>${value}</b><span>${sub || '&nbsp;'}</span></div>`;
    const running = o.periods.find(p => p.state === 'RUNNING');
    return `
    <div class="bi-pane">
        <div class="bi-bar">${filterHtml(pref)}${planHtml(o)}</div>
        <div class="bi-strip">
            ${tile('Average balance', r ? rupees(r.average) : '—', r ? `${date(r.from)} – ${date(r.to)}` : 'before the first entry')}
            ${tile('Lowest · highest', r ? `${moneyShort(r.lowest)} · ${moneyShort(r.highest)}` : '—', r ? `over ${r.days} day${r.days === 1 ? '' : 's'}` : '')}
            ${tile('Interest earned', r ? money(r.earned) : '—', o.interestRate ? `at ${Number(o.interestRate)}% a year, on these days` : 'set a rate to reckon it')}
            ${tile('Interest posted', r ? money(r.posted) : '—', 'dated in these days')}
            ${o.dueCount ? `<button type="button" class="bi-tile warn" data-bi="show-due" title="Show every period, whatever the dates">
                <small>To post · all dates</small><b>${money(o.dueAmount)}</b><span>${o.dueCount} finished period${o.dueCount === 1 ? '' : 's'} · show</span></button>`
        : tile('To post · all dates', money(0), running ? `next credit ${shortDate(running.to)}` : 'nothing waiting')}
        </div>
        <div class="bi-grid">
            <section class="bi-card"><h5>${icon('percent')}Interest by period<small>periods touching these dates</small></h5>
                <div class="bi-scroll">${periodsTable(o, account)}</div></section>
            <section class="bi-card"><h5>${icon('calendar')}Average monthly balance<small>of daily closing balances</small></h5>
                <div class="bi-scroll">${monthsTable(o)}</div></section>
        </div>
    </div>`;
}

function filterHtml(pref) {
    const custom = pref.range === 'custom';
    const chips = presets().map(p => `<button type="button" class="seg-chip ${pref.range === p.key ? 'active' : ''}" data-bi-range="${p.key}" ${p.title ? `title="${esc(p.title)}"` : ''}>${p.label}</button>`).join('');
    return `<span class="bi-filter"><span class="seg-chips sm">${chips}<button type="button" class="seg-chip ${custom ? 'active' : ''}" data-bi-range="custom" title="Pick exact dates">${icon('calendar')}</button></span>
        ${custom ? `<span class="pc-custom"><input type="date" data-bi-from value="${pref.from}"><span>–</span><input type="date" data-bi-to value="${pref.to}"></span>` : ''}</span>`;
}

function planHtml(o) {
    const rate = Number(o.interestRate || 0);
    const words = `${rate ? `${rate}% a year` : 'No rate set'}, credited ${FREQUENCY[o.frequency].toLowerCase()}, ${o.autoPost ? 'posted automatically after each period ends' : 'posted by hand'}, reckoned from ${date(o.interestFrom)}`;
    return `<span class="bi-plan" title="${esc(words)}">${icon(o.autoPost ? 'repeat' : 'hand')}<span>${rate ? `<b>${rate}%</b>` : '<b class="neg">No rate</b>'} · ${FREQUENCY[o.frequency]} · ${o.autoPost ? 'Automatic' : 'By hand'}</span>
        ${can('MANAGE_ACCOUNTS') ? `<button type="button" class="btn xs" data-bi="plan">${icon('settings')}Plan</button>` : ''}</span>`;
}

function periodsTable(o, account) {
    if (!o.periods.length) return emptyState('No interest period in these dates', 'percent');
    const manage = can('POST_TRANSACTIONS');
    const row = p => {
        const [tone, word] = STATE[p.state];
        const posted = p.state === 'POSTED';
        const gap = posted ? Number(p.amount) - Number(p.calculated) : 0;
        const status = posted ? `<a class="bi-state ${tone}" href="#/accounts/${account.id}/entry/${p.entryId}" title="${esc(`${p.entryNo} · ${date(p.entryDate)}${p.automatic ? ' · posted automatically' : ' · posted by hand'}: open the entry`)}">${word}${p.automatic ? icon('repeat') : ''}</a>`
            : `<span class="bi-state ${tone}">${word}</span>`;
        const action = !manage ? '' : p.state === 'DUE' || p.state === 'SKIPPED' ? `<button type="button" class="btn xs primary" data-bi="post" data-from="${p.from}">Post</button>`
            : posted ? `<button type="button" class="btn xs ghost icon" data-bi="undo" data-posting="${p.postingId}" title="Take it out of the books">${icon('undo')}</button>` : '';
        return `<tr><td title="${date(p.from)} to ${date(p.to)}"><b>${esc(p.label)}</b><small>${p.days}d${p.state === 'RUNNING' ? ' so far' : ''}</small></td>
            <td class="r mono">${rupees(p.average)}</td>
            <td class="r mono">${money(p.calculated)}</td>
            <td class="r mono">${posted ? `${Math.abs(gap) >= 0.01 ? `<small class="bi-gap" title="${esc(`${gap > 0 ? 'More' : 'Less'} than the balances work out to now`)}">${gap > 0 ? '+' : '−'}${money(Math.abs(gap))}</small>` : ''}<b>${money(p.amount)}</b>` : '<span class="muted">—</span>'}</td>
            <td>${status}</td><td class="r bi-act">${action}</td></tr>`;
    };
    const sum = (list, f) => list.reduce((t, p) => t + Number(f(p) || 0), 0);
    const days = sum(o.periods, p => p.days);
    const due = sum(o.periods.filter(p => p.state === 'DUE'), p => p.calculated);
    return `<table class="grid compact bi-table bi-periods">
        <thead><tr><th>Period</th><th class="r">Average</th><th class="r">Works out to</th><th class="r">Posted</th><th>Status</th><th></th></tr></thead>
        <tbody>${o.periods.map(row).join('')}</tbody>
        <tfoot><tr><td title="Over ${days} days"><b>Total</b><small>${o.periods.length} period${o.periods.length === 1 ? '' : 's'}</small></td>
            <td class="r mono" title="Average over the ${days} days of these periods">${days ? rupees(sum(o.periods, p => Number(p.average) * p.days) / days) : '—'}</td>
            <td class="r mono">${money(sum(o.periods, p => p.calculated))}</td>
            <td class="r mono">${money(sum(o.periods.filter(p => p.state === 'POSTED'), p => p.amount))}</td>
            <td colspan="2" class="bi-foot-note">${due >= 0.01 ? `${money(due)} to post` : ''}</td></tr></tfoot>
    </table>`;
}

function monthsTable(o) {
    if (!o.months.length) return emptyState('No month of this account in these dates', 'calendar');
    const max = Math.max(1, ...o.months.map(m => Math.abs(Number(m.average))));
    const days = o.months.reduce((t, m) => t + m.days, 0);
    const row = m => `<tr><td><b>${monthLabel(m.month)}</b>${m.running ? '<small>so far</small>' : ''}</td>
        <td class="r mono ${Number(m.average) < 0 ? 'neg' : ''}"><b>${rupees(m.average)}</b></td>
        <td class="bi-bar-cell"><i class="bi-meter"><em style="width:${(Math.abs(Number(m.average)) / max * 100).toFixed(1)}%"></em></i></td>
        <td class="r mono ${Number(m.lowest) < 0 ? 'neg' : ''}">${rupees(m.lowest)}</td>
        <td class="r mono" ${m.running ? 'title="Today"' : ''}>${rupees(m.closing)}</td>
        <td class="r mono">${money(m.interest)}</td></tr>`;
    return `<table class="grid compact bi-table bi-months">
        <thead><tr><th>Month</th><th class="r">Average</th><th></th><th class="r">Lowest</th><th class="r">Month end</th><th class="r">Interest</th></tr></thead>
        <tbody>${o.months.map(row).join('')}</tbody>
        <tfoot><tr><td><b>Total</b><small>${o.months.length} month${o.months.length === 1 ? '' : 's'}</small></td>
            <td class="r mono" title="Average over the ${days} days of these months">${rupees(o.months.reduce((t, m) => t + Number(m.average) * m.days, 0) / days)}</td><td></td>
            <td class="r mono">${rupees(Math.min(...o.months.map(m => Number(m.lowest))))}</td><td></td>
            <td class="r mono">${money(o.months.reduce((t, m) => t + Number(m.interest), 0))}</td></tr></tfoot>
    </table>`;
}

function openPlan(account, o, onChanged) {
    routeNextDialog('interest-plan');
    openModal({
        title: 'Interest plan', sub: account.name, iconName: 'percent',
        body: `<form class="form-grid two">
            ${field({ label: 'Interest rate % a year', name: 'interestRate', type: 'number', value: o.interestRate, attrs: 'step="0.01" min="0" max="100"' })}
            ${field({ label: 'Credited', name: 'frequency', type: 'select', value: o.frequency, options: [{ value: 'QUARTERLY', label: 'Every quarter' }, { value: 'MONTHLY', label: 'Every month' }] })}
            ${field({ label: 'Reckon interest from', name: 'interestFrom', type: 'date', value: o.interestFrom, span: 'span-2', hint: 'Choose a date after the interest already in your books: anything earlier would count it twice.' })}
            ${field({ label: 'Post automatically after each period ends', name: 'autoPost', type: 'checkbox', value: o.autoPost, span: 'span-2' })}
            <p class="bi-note span-2">${icon('info')}<span>Automatic posting credits what the balances work out to. Any period that has already finished since the date above is posted as soon as you save.</span></p>
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async modal => {
            const form = readForm(modal.el.querySelector('form'));
            const saved = await api.put(`/accounts/${account.id}/interest/settings`, { ...form, version: o.version });
            toast(saved.postedNow ? `Plan saved · ${saved.postedNow} period${saved.postedNow === 1 ? '' : 's'} of interest posted` : 'Interest plan saved');
            onChanged();
        } }],
    });
}

function openPost(account, period, onChanged) {
    const calculated = Number(period.calculated);
    routeNextDialog('post-interest');
    setQuery({ period: period.from });
    openModal({
        onClose: () => setQuery({ period: null }),
        title: `Post interest · ${period.label}`, sub: account.name, iconName: 'percent',
        body: `<form class="form-grid two">
            <div class="span-2 post-summary"><div class="row"><span>Average ${rupees(period.average)} over ${period.days} days</span><span class="spacer"></span><span>works out to <b>${money(calculated)}</b></span></div></div>
            ${field({ label: 'Amount credited', name: 'amount', type: 'number', value: calculated > 0 ? calculated : '', required: true, attrs: 'step="0.01" min="0.01"', hint: 'Change it to what the bank really paid.' })}
            ${field({ label: 'Date', name: 'date', type: 'date', value: period.to, required: true, attrs: `min="${period.from}" max="${isoDate()}"` })}
        </form>`,
        actions: [{ label: 'Cancel' }, { label: 'Post interest', kind: 'primary', onClick: async modal => {
            const form = readForm(modal.el.querySelector('form'));
            await api.post(`/accounts/${account.id}/interest`, { from: period.from, to: period.to, ...form });
            toast(`${money(form.amount)} interest posted`);
            onChanged();
        } }],
    });
}
