/**
 * Chit summary report (Reports → Chit summary): the selected chits together, written so the chit organizer
 * (or anyone) understands the whole position at a glance and can be handed a printout:
 *   - how many chits and how much they are worth, what was paid, how, and what comes back
 *   - chit by chit: value, installments paid, cash paid after dividends, still to pay, maturity, gain, return
 *   - by organizer, month-by-month payments of the last 12 months and the dues of the next 12
 *   - every installment of every selected chit (date, dividend, cash paid, from which account)
 * Chits are picked with the chips at the top (remembered); Excel and PDF / print carry the same content.
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState, statusBadge } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, monthLabel } from '../core/format.js';
import { barChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';
import { exportButton, bindExport, exportReport } from '../core/export.js';
import { chitReturns, takeHomeNow } from './chits.js';

const isRunning = c => c.status === 'ACTIVE' || c.status === 'PRIZED';

export async function chitSummaryReport(el, toolbarHost) {
    const chits = await api.get('/chits');
    el.className = 'report-content chit-summary';
    if (!chits.length) {
        el.innerHTML = panel({ title: 'Chit summary', iconName: 'chit', body: emptyState('No chits yet. Add one on the Chits page.', 'chit') });
        return () => [];
    }
    const details = new Map((await Promise.all(chits.map(c => api.get(`/chits/${c.id}`)))).map(d => [d.chit.id, d]));
    const prefs = getPref('chitSummary', { ids: null });
    let selected = new Set((prefs.ids || chits.filter(isRunning).map(c => c.id)).filter(id => details.has(id)));
    if (!selected.size) selected = new Set(chits.map(c => c.id));

    toolbarHost.insertAdjacentHTML('beforeend', `${exportButton({ label: 'Export' })}
        <button class="btn sm primary" id="cs-print">${icon('printer')}Print summary</button>`);

    const draw = () => {
        const list = chits.filter(c => selected.has(c.id));
        el.innerHTML = `
            <div class="cs-picker glass">
                <span class="cs-pick-label">${icon('filter')} Chits in this summary</span>
                <div class="cs-quick">
                    <button class="link-btn" data-pick="running">Running</button>
                    <button class="link-btn" data-pick="all">All</button>
                    <button class="link-btn" data-pick="none">None</button>
                </div>
                <div class="cs-chips">${chits.map(c => `<label class="cs-chip ${selected.has(c.id) ? 'on' : ''}">
                    <input type="checkbox" data-chit="${c.id}" ${selected.has(c.id) ? 'checked' : ''}>
                    ${icon(selected.has(c.id) ? 'check' : 'chit')}<b>${esc(c.name)}</b><small>${esc(c.organizer || '')}${isRunning(c) ? '' : ` · ${c.status.toLowerCase()}`}</small></label>`).join('')}</div>
            </div>
            ${list.length ? body(list) : emptyState('Pick at least one chit', 'chit')}`;
        if (list.length) charts(list);
    };

    function body(list) {
        const t = totals(list);
        const orgs = byOrganizer(list);
        const upcoming = dueSchedule(list);
        return `
        <section class="cs-hero">
            <div class="cs-hero-main">
                <span class="cs-hero-mark">${icon('chit')}</span>
                <div><small>Chit portfolio</small>
                    <b>${list.length} chit${list.length === 1 ? '' : 's'} · ${money(t.value)}</b>
                    <span>${t.running} running${t.closed ? ` · ${t.closed} closed` : ''} · ${orgs.length} organizer${orgs.length === 1 ? '' : 's'} · ${money(t.monthly)} a month in installments</span></div>
            </div>
            <div class="cs-hero-figs">
                ${fig('Paid in', money(t.paidIn), `${t.instPaid} of ${t.instTotal} installments`)}
                ${fig('Cash actually paid', money(t.cashPaid), `dividends saved ${money(t.dividends)}`)}
                ${fig('Still to pay', money(t.stillToPay), `${t.instTotal - t.instPaid} installments${t.overdue ? ` · <span class="neg">${money(t.overdue)} overdue</span>` : ''}`)}
                ${fig('You get back', money(t.toReceive), t.received ? `+ ${money(t.received)} already received` : 'at maturity')}
                ${fig('Gain', `<span class="${t.gain >= 0 ? 'pos' : 'neg'}">${money(Math.round(t.gain))}</span>`, `${t.realised ? `${money(Math.round(t.realised))} realised · ` : ''}${money(Math.round(t.expected))} expected`)}
                ${fig('Take home now', money(t.takeHome), 'paid in + interest so far')}
            </div>
        </section>
        <div class="cs-sentence">${icon('info')} ${esc(sentence(list, t))}</div>

        ${panel({ title: 'Chit by chit', iconName: 'list', cls: 'cs-table-panel', bodyClass: 'flush',
            body: `<div class="scroll"><table class="grid compact cs-table">
                <thead><tr><th>Chit</th><th>Organizer · ticket</th><th class="r">Value</th><th class="r">Monthly</th><th class="c">Paid</th>
                    <th class="r">Paid in</th><th class="r">Dividends</th><th class="r">Cash paid</th><th class="r">Still to pay</th>
                    <th>Next due</th><th>Maturity</th><th class="r">Gain</th><th class="r">Return</th></tr></thead>
                <tbody>${list.map(c => {
                    const gain = c.payoutAmount !== null ? Number(c.realizedGain) : Number(c.projectedNetGain);
                    return `<tr>
                        <td><b>${esc(c.name)}</b> ${statusBadge(c.status)}</td>
                        <td class="small">${esc(c.organizer || '—')}${c.ticketNo ? ` · ${esc(c.ticketNo)}` : ''}</td>
                        <td class="r">${money(c.maturityAmount)}</td>
                        <td class="r">${money(c.monthlyInstallment)}</td>
                        <td class="c"><span class="cs-frac">${c.installmentsPaid}/${c.numberOfInstallments}</span><i class="cs-mini"><em style="width:${(c.installmentsPaid / c.numberOfInstallments) * 100}%"></em></i></td>
                        <td class="r">${money(c.paidIn)}</td>
                        <td class="r pos">${money(c.dividendsEarned)}</td>
                        <td class="r">${money(c.cashPaid)}</td>
                        <td class="r">${money(c.stillToPay)}${Number(c.overdueAmount) ? `<small class="neg block">${money(c.overdueAmount)} overdue</small>` : ''}</td>
                        <td>${c.nextDueDate ? `${shortDate(c.nextDueDate)} <small class="muted">${moneyShort(c.nextDueAmount)}</small>` : '—'}</td>
                        <td>${c.payoutAmount !== null ? `<small class="muted">received</small> ${shortDate(c.payoutDate)}` : date(c.maturityDate)}</td>
                        <td class="r ${gain >= 0 ? 'pos' : 'neg'}">${money(Math.round(gain))}</td>
                        <td class="r">${percent(chitReturns(c).compound, 1)}</td></tr>`;
                }).join('')}</tbody>
                <tfoot><tr class="total"><td colspan="2">${list.length} chits</td><td class="r">${money(t.value)}</td><td class="r">${money(t.monthly)}</td>
                    <td class="c">${t.instPaid}/${t.instTotal}</td><td class="r">${money(t.paidIn)}</td><td class="r pos">${money(t.dividends)}</td><td class="r">${money(t.cashPaid)}</td>
                    <td class="r">${money(t.stillToPay)}</td><td></td><td></td><td class="r">${money(Math.round(t.gain))}</td><td></td></tr></tfoot>
            </table></div>` })}

        <div class="cs-grid">
            ${panel({ title: 'Paid, last 12 months', iconName: 'calendar', cls: 'cs-chart-panel', bodyClass: 'chart',
                actions: legend([{ label: 'Cash paid' }, { label: 'Dividends' }]), body: '<div class="chart" id="cs-paid"></div>' })}
            ${panel({ title: 'Due, next 12 months', iconName: 'hourglass', cls: 'cs-chart-panel', bodyClass: 'chart',
                sub: money(upcoming.reduce((s, m) => s + m.amount, 0)), actions: legend([{ label: 'Due', color: 'var(--series-4)' }]), body: '<div class="chart" id="cs-due"></div>' })}
            ${panel({ title: 'By organizer', iconName: 'users', cls: 'cs-org-panel', bodyClass: 'flush',
                body: `<table class="grid compact"><thead><tr><th>Organizer</th><th class="c">Chits</th><th class="r">Value</th><th class="r">Paid in</th><th class="r">Still to pay</th></tr></thead>
                    <tbody>${orgs.map(o => `<tr><td><b>${esc(o.name)}</b></td><td class="c">${o.count}</td><td class="r">${money(o.value)}</td>
                        <td class="r">${money(o.paidIn)}</td><td class="r">${money(o.stillToPay)}</td></tr>`).join('')}</tbody></table>` })}
        </div>

        ${panel({ title: 'Installment history', iconName: 'journal', cls: 'cs-history', bodyClass: 'flush',
            sub: 'every installment of the selected chits',
            body: list.map(c => {
                const inst = details.get(c.id).installments;
                const div = inst.some(i => Number(i.dividend) > 0);
                return `<details class="cs-chit-ledger" ${list.length === 1 ? 'open' : ''}>
                    <summary><b>${esc(c.name)}</b><span class="muted small">${esc(c.organizer || '')}${c.ticketNo ? ` · ticket ${esc(c.ticketNo)}` : ''}</span>
                        <span class="spacer"></span><span class="small">${c.installmentsPaid}/${c.numberOfInstallments} paid · ${money(c.cashPaid)} cash · ${money(c.dividendsEarned)} dividends</span></summary>
                    <table class="grid compact dense"><thead><tr><th>#</th><th>Due</th><th class="r">Installment</th>${div ? '<th class="r">Dividend</th><th class="r">Cash paid</th>' : '<th class="r">Paid</th>'}<th>Paid on</th><th>From</th></tr></thead>
                    <tbody>${inst.map(i => `<tr class="${i.status === 'PAID' ? '' : i.overdue ? 'overdue' : 'muted-row'}"><td>${i.installmentNo}</td><td>${date(i.dueDate)}</td>
                        <td class="r">${money(i.dueAmount)}</td>${div ? `<td class="r pos">${Number(i.dividend) ? money(i.dividend) : ''}</td>` : ''}
                        <td class="r">${i.paidAmount !== null ? money(i.paidAmount) : ''}</td>
                        <td>${i.paidDate ? date(i.paidDate) : i.overdue ? '<span class="neg">overdue</span>' : '<span class="muted">due</span>'}</td>
                        <td class="small muted">${esc(i.paidFromAccountName || '')}</td></tr>`).join('')}</tbody></table></details>`;
            }).join('') })}`;
    }

    function charts(list) {
        const today = new Date(isoDate() + 'T00:00:00');
        const past = Array.from({ length: 12 }, (_, i) => isoDate(new Date(today.getFullYear(), today.getMonth() - 11 + i, 1)).slice(0, 7));
        const paid = list.flatMap(c => details.get(c.id).installments.filter(i => i.status === 'PAID'));
        const of = (m, key) => paid.filter(i => (i.dueDate || '').startsWith(m)).reduce((s, i) => s + Number(i[key] || 0), 0);
        barChart(el.querySelector('#cs-paid'), { labels: past, labelFormat: monthLabel, format: moneyShort,
            series: [{ name: 'Cash paid', values: past.map(m => of(m, 'paidAmount')) }, { name: 'Dividends', values: past.map(m => of(m, 'dividend')) }] });
        const due = dueSchedule(list);
        barChart(el.querySelector('#cs-due'), { labels: due.map(d => d.month), labelFormat: monthLabel, format: moneyShort,
            series: [{ name: 'Due', values: due.map(d => d.amount), color: 'var(--series-4)' }] });
    }

    function dueSchedule(list) {
        const today = new Date(isoDate() + 'T00:00:00');
        const months = Array.from({ length: 12 }, (_, i) => isoDate(new Date(today.getFullYear(), today.getMonth() + i, 1)).slice(0, 7));
        const pending = list.flatMap(c => details.get(c.id).installments.filter(i => i.status !== 'PAID'));
        return months.map(m => ({ month: m, amount: pending.filter(i => i.dueDate.startsWith(m) || (m === months[0] && i.dueDate < m)).reduce((s, i) => s + Number(i.dueAmount), 0) }));
    }

    el.addEventListener('change', e => {
        const box = e.target.closest('[data-chit]');
        if (!box) return;
        const id = Number(box.dataset.chit);
        if (box.checked) selected.add(id); else selected.delete(id);
        setPref('chitSummary', { ids: [...selected] });
        draw();
    });
    el.addEventListener('click', e => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        selected = new Set(b.dataset.pick === 'all' ? chits.map(c => c.id) : b.dataset.pick === 'running' ? chits.filter(isRunning).map(c => c.id) : []);
        setPref('chitSummary', { ids: [...selected] });
        draw();
    });
    const report = () => reportOf(chits.filter(c => selected.has(c.id)));
    bindExport(toolbarHost, report);
    toolbarHost.querySelector('#cs-print').addEventListener('click', () => exportReport(report(), 'pdf'));
    draw();

    function reportOf(list) {
        const t = totals(list);
        return {
            title: 'Chit summary', subtitle: `${list.length} chit${list.length === 1 ? '' : 's'} · ${list.map(c => c.name).join(', ')}`,
            filename: `chit-summary-${isoDate()}`,
            summary: [['Chits', `${list.length} (${t.running} running)`], ['Total value', t.value], ['Monthly installments', t.monthly],
                ['Paid in', t.paidIn], ['Cash actually paid', t.cashPaid], ['Dividends', t.dividends], ['Still to pay', t.stillToPay],
                ['You get back', t.toReceive], ['Gain', Math.round(t.gain)], ['Take home now', t.takeHome]],
            html: `<p style="margin:0 0 10px;color:#3d556a">${esc(sentence(list, t))}</p>`,
            sheets: [
                { name: 'Chits', columns: [{ label: 'Chit' }, { label: 'Organizer' }, { label: 'Ticket' }, { label: 'Status' }, { label: 'Value', type: 'money' },
                    { label: 'Monthly', type: 'money' }, { label: 'Paid', type: 'text' }, { label: 'Paid in', type: 'money' }, { label: 'Dividends', type: 'money' },
                    { label: 'Cash paid', type: 'money' }, { label: 'Still to pay', type: 'money' }, { label: 'Maturity', type: 'date' }, { label: 'Gain', type: 'money' }, { label: 'Return % / yr', type: 'percent' }],
                  rows: list.map(c => [c.name, c.organizer || '', c.ticketNo || '', c.status, Number(c.maturityAmount), Number(c.monthlyInstallment),
                      `${c.installmentsPaid}/${c.numberOfInstallments}`, Number(c.paidIn), Number(c.dividendsEarned), Number(c.cashPaid), Number(c.stillToPay),
                      c.payoutDate || c.maturityDate, Math.round(c.payoutAmount !== null ? Number(c.realizedGain) : Number(c.projectedNetGain)), chitReturns(c).compound]),
                  totals: ['Total', '', '', '', t.value, t.monthly, `${t.instPaid}/${t.instTotal}`, t.paidIn, t.dividends, t.cashPaid, t.stillToPay, '', Math.round(t.gain), ''] },
                { name: 'By organizer', columns: [{ label: 'Organizer' }, { label: 'Chits', type: 'number' }, { label: 'Value', type: 'money' }, { label: 'Paid in', type: 'money' }, { label: 'Still to pay', type: 'money' }],
                  rows: byOrganizer(list).map(o => [o.name, o.count, o.value, o.paidIn, o.stillToPay]) },
                { name: 'Due next 12 months', columns: [{ label: 'Month' }, { label: 'Due', type: 'money' }],
                  rows: dueSchedule(list).filter(d => d.amount).map(d => [monthLabel(d.month), d.amount]) },
                { name: 'Installments', columns: [{ label: 'Chit' }, { label: '#', type: 'number' }, { label: 'Due', type: 'date' }, { label: 'Installment', type: 'money' },
                    { label: 'Dividend', type: 'money' }, { label: 'Cash paid', type: 'money' }, { label: 'Paid on', type: 'date' }, { label: 'From' }, { label: 'Status' }],
                  rows: list.flatMap(c => details.get(c.id).installments.map(i => [c.name, i.installmentNo, i.dueDate, Number(i.dueAmount),
                      Number(i.dividend) || '', i.paidAmount !== null ? Number(i.paidAmount) : '', i.paidDate || '', i.paidFromAccountName || '',
                      i.status === 'PAID' ? 'Paid' : i.overdue ? 'Overdue' : 'Due'])) },
            ],
        };
    }

    return () => report().sheets[0].rows.length ? [report().sheets[0].columns.map(c => c.label), ...report().sheets[0].rows] : [];
}

function fig(label, value, note) {
    return `<div class="cs-fig"><small>${esc(label)}</small><b>${value}</b><span>${note}</span></div>`;
}

function totals(list) {
    const sum = key => list.reduce((s, c) => s + Number(c[key] || 0), 0);
    const open = list.filter(c => c.payoutAmount === null);
    const lifts = list.map(takeHomeNow).filter(Boolean);
    return {
        running: list.filter(isRunning).length, closed: list.filter(c => !isRunning(c)).length,
        value: sum('maturityAmount'), monthly: list.filter(isRunning).reduce((s, c) => s + Number(c.monthlyInstallment), 0),
        paidIn: sum('paidIn'), cashPaid: sum('cashPaid'), dividends: sum('dividendsEarned'), stillToPay: sum('stillToPay'), overdue: sum('overdueAmount'),
        instPaid: list.reduce((s, c) => s + c.installmentsPaid, 0), instTotal: list.reduce((s, c) => s + c.numberOfInstallments, 0),
        toReceive: open.reduce((s, c) => s + Number(c.maturityAmount), 0), received: list.filter(c => c.payoutAmount !== null).reduce((s, c) => s + Number(c.payoutAmount), 0),
        expected: open.reduce((s, c) => s + Number(c.projectedNetGain || 0), 0), realised: list.filter(c => c.realizedGain !== null).reduce((s, c) => s + Number(c.realizedGain), 0),
        get gain() { return this.expected + this.realised; },
        takeHome: lifts.reduce((s, l) => s + l.prize, 0),
    };
}

function byOrganizer(list) {
    const map = new Map();
    list.forEach(c => {
        const key = c.organizer || '—';
        const o = map.get(key) || { name: key, count: 0, value: 0, paidIn: 0, stillToPay: 0 };
        o.count++; o.value += Number(c.maturityAmount); o.paidIn += Number(c.paidIn); o.stillToPay += Number(c.stillToPay);
        map.set(key, o);
    });
    return [...map.values()].sort((a, b) => b.value - a.value);
}

/** One plain-language paragraph of the whole position. */
function sentence(list, t) {
    const next = list.filter(c => c.nextDueDate).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))[0];
    const lastMaturity = list.filter(c => c.payoutAmount === null).sort((a, b) => b.maturityDate.localeCompare(a.maturityDate))[0];
    return `${list.length} chit${list.length === 1 ? '' : 's'} worth ${money(t.value)} in all. ${money(t.paidIn)} has been paid in over ${t.instPaid} installments `
        + `(${money(t.cashPaid)} in cash after ${money(t.dividends)} of dividends); ${money(t.stillToPay)} remains to be paid`
        + `${t.overdue ? `, of which ${money(t.overdue)} is overdue` : ''}. `
        + `${t.toReceive ? `${money(t.toReceive)} comes back at maturity${lastMaturity ? `, the last on ${date(lastMaturity.maturityDate)}` : ''}, ` : ''}`
        + `for a gain of about ${money(Math.round(t.gain))}.`
        + `${next ? ` Next installment: ${money(next.nextDueAmount)} for ${next.name} on ${date(next.nextDueDate)}.` : ''}`;
}
