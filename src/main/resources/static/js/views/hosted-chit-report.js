/**
 * Reports → Hosted chits: the chits the user runs as the organiser, together.
 *   - the period (by the date money moved): collected, paid to winners, commission and late interest earned
 *   - as of today: dues still to collect, how late they are (aging), who owes the most, money held for members
 *   - chit by chit: progress, this month's collection, dues, earnings and agreements
 *   - plain-language insights to act on
 * Reads /api/hosted-chits/report; the table rows feed the report page's Excel / PDF / CSV export.
 */
import { api } from '../core/api.js';
import { panel, esc, stat, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, date } from '../core/format.js';
import { barChart, donutChart, legend, seriesColor } from '../core/charts.js';

const num = v => Number(v || 0);

export async function hostedChitReport(el, _toolbar, period) {
    const r = await api.get('/hosted-chits/report', { from: period.from, to: period.to });
    el.className = 'report-content hosted';
    if (!r.chits.length) {
        el.innerHTML = panel({ title: 'Hosted chits', iconName: 'hand-coins', body: emptyState('You do not run any chit yet. Start one on Host a Chit.', 'hand-coins') });
        return () => [];
    }
    const income = num(r.commission) + num(r.lateFees);
    const rate = num(r.expectedThisMonth) ? (num(r.collectedThisMonth) / num(r.expectedThisMonth)) * 100 : null;
    const overdueAmount = r.aging.slice(1).reduce((s, a) => s + num(a.amount), 0);
    el.innerHTML = `
        <div class="stat-strip report-stats">
            ${stat('Collected (period)', money(r.collected), `${r.running} running chit${r.running === 1 ? '' : 's'} · ${r.members} members`)}
            ${stat('Paid to winners (period)', money(r.paidOut), 'prize money handed over')}
            ${stat('My income (period)', `<span class="pos">${money(income)}</span>`, `${moneyShort(r.commission)} commission · ${moneyShort(r.lateFees)} late interest`)}
            ${stat('This month', rate === null ? '—' : percent(rate, 0), `${moneyShort(r.collectedThisMonth)} of ${moneyShort(r.expectedThisMonth)} collected`)}
            ${stat('Still to collect', `<span class="${num(r.pendingDues) ? 'neg' : ''}">${money(r.pendingDues)}</span>`, num(r.lateFeesDue) ? `+ ${moneyShort(r.lateFeesDue)} late interest` : 'installments due so far')}
            ${stat('Money held', money(r.held), 'members’ money not yet paid out')}
        </div>
        <div class="hc-rep-row">
            ${panel({ title: 'Month by month', iconName: 'report', cls: 'hc-rep-chart', bodyClass: 'chart',
                body: `<div class="chart-wrap">${legend([{ label: 'Collected' }, { label: 'Paid to winners' }, { label: 'My income' }])}<div class="chart" id="hcr-months"></div></div>` })}
            ${panel({ title: 'How late are the dues', iconName: 'clock', cls: 'hc-rep-aging', sub: 'as of today',
                body: num(r.pendingDues) ? `<div class="donut-wrap"><div class="chart" id="hcr-aging"></div><div class="donut-legend">${r.aging.map((a, i) =>
                    `<div class="legend-row"><i class="legend-swatch" style="background:${seriesColor(i)}"></i><span class="ellipsis">${esc(a.label)} <small class="muted">${a.count}</small></span><b>${moneyShort(a.amount)}</b></div>`).join('')}</div></div>`
                    : emptyState('Nothing is due right now', 'check-circle') })}
        </div>
        ${panel({ title: 'Chit by chit', iconName: 'list', cls: 'hc-rep-table', bodyClass: 'flush', sub: `${date(r.from)} – ${date(r.to)}`,
            body: `<div class="hc-table-wrap"><table class="grid compact">
                <thead><tr><th>Chit</th><th>Progress</th><th class="r">This month</th><th class="r">Collected</th><th class="r">Paid out</th>
                    <th class="r">Commission</th><th class="r">Late int.</th><th class="r">To collect</th><th class="r">Held</th><th>Agreements</th><th>Next due</th></tr></thead>
                <tbody>${r.chits.map(c => {
                    const pct = num(c.expectedThisMonth) ? (num(c.collectedThisMonth) / num(c.expectedThisMonth)) * 100 : 0;
                    return `<tr class="clickable" data-chit="${c.id}">
                        <td><b>${esc(c.name)}</b> <span class="muted small">${c.chitType === 'AUCTION' ? 'auction' : 'fixed'} · ${c.memberCount} × ${moneyShort(c.installment)}</span>
                            ${c.status === 'COMPLETED' ? ' <span class="badge good">Finished</span>' : ''}</td>
                        <td><span class="progress-mini"><i style="width:${(c.completedMonths / c.months) * 100}%"></i></span> <span class="small muted">${c.completedMonths}/${c.months}</span></td>
                        <td class="r">${c.status === 'COMPLETED' ? '—' : `${percent(pct, 0)} <span class="muted small">${moneyShort(c.collectedThisMonth)}</span>`}</td>
                        <td class="r">${money(c.collected)}</td><td class="r">${money(c.paidOut)}</td>
                        <td class="r pos">${num(c.commission) ? money(c.commission) : '—'}</td>
                        <td class="r pos">${num(c.lateFees) ? money(c.lateFees) : '—'}</td>
                        <td class="r ${num(c.pendingDues) ? 'neg' : 'muted'}">${num(c.pendingDues) ? money(c.pendingDues) : '—'}${num(c.lateFeesDue) ? `<small class="muted"> +${moneyShort(c.lateFeesDue)}</small>` : ''}</td>
                        <td class="r">${money(c.held)}</td>
                        <td>${agreementsCell(c)}</td>
                        <td>${c.nextDueDate ? date(c.nextDueDate) : '<span class="muted">—</span>'}</td></tr>`;
                }).join('')}</tbody>
                <tfoot><tr class="total"><td colspan="3">Total</td><td class="r">${money(r.collected)}</td><td class="r">${money(r.paidOut)}</td>
                    <td class="r">${money(r.commission)}</td><td class="r">${money(r.lateFees)}</td><td class="r">${money(r.pendingDues)}</td><td class="r">${money(r.held)}</td><td colspan="2"></td></tr></tfoot>
            </table></div>` })}
        <div class="hc-rep-row two">
            ${panel({ title: 'Who owes the most', iconName: 'alert', cls: 'hc-rep-owe', bodyClass: 'flush', sub: 'past their due date',
                body: r.defaulters.length ? `<table class="grid compact"><thead><tr><th>Member</th><th>Chit</th><th class="r">Months</th><th class="r">Late by</th><th class="r">Overdue</th><th class="r">Late int.</th></tr></thead>
                    <tbody>${r.defaulters.map(x => `<tr class="clickable" data-chit="${x.chitId}"><td><b>${esc(x.member)}</b>${x.phone ? ` <span class="muted small">${esc(x.phone)}</span>` : ''}</td>
                        <td>${esc(x.chitName)}</td><td class="r">${x.monthsOverdue || '—'}</td><td class="r">${x.daysLate ? `${x.daysLate} d` : '—'}</td>
                        <td class="r neg">${num(x.overdue) ? money(x.overdue) : '—'}</td><td class="r">${num(x.lateFeeDue) ? money(x.lateFeeDue) : '—'}</td></tr>`).join('')}</tbody></table>`
                    : emptyState('Nobody is behind on payments', 'check-circle') })}
            ${panel({ title: 'What to act on', iconName: 'bulb', cls: 'hc-rep-tips', body: `<div class="insights">${insights(r, overdueAmount).join('')}</div>` })}
        </div>`;

    barChart(el.querySelector('#hcr-months'), {
        labels: r.months.map(m => m.month), labelFormat: monthLabel, format: moneyShort,
        series: [{ name: 'Collected', values: r.months.map(m => num(m.collected)) },
                 { name: 'Paid to winners', values: r.months.map(m => num(m.paidOut)) },
                 { name: 'My income', values: r.months.map(m => num(m.commission) + num(m.lateFees)) }],
    });
    const aging = el.querySelector('#hcr-aging');
    if (aging) donutChart(aging, { items: r.aging.map(a => ({ label: a.label, value: num(a.amount) })), format: v => money(v),
        centerValue: moneyShort(r.pendingDues), centerLabel: 'to collect' });
    el.addEventListener('click', e => {
        const row = e.target.closest('[data-chit]');
        if (row) location.hash = `#/host-chits/${row.dataset.chit}/dues`;
    });

    return () => [['Chit', 'Type', 'Status', 'Members', 'Months done', 'Months', 'Installment', 'Collected (period)', 'Paid out (period)', 'Commission (period)',
        'Late interest (period)', 'To collect', 'Late interest due', 'Held', 'Collected this month', 'Expected this month', 'Agreements accepted',
        'Agreements waiting', 'Payouts without agreement', 'Next due'],
        ...r.chits.map(c => [c.name, c.chitType === 'AUCTION' ? 'Auction' : 'Fixed', c.status, c.memberCount, c.completedMonths, c.months, c.installment,
            c.collected, c.paidOut, c.commission, c.lateFees, c.pendingDues, c.lateFeesDue, c.held, c.collectedThisMonth, c.expectedThisMonth,
            c.agreementsAccepted, c.agreementsPending, c.payoutsWithoutAgreement, c.nextDueDate])];
}

function agreementsCell(c) {
    const parts = [];
    if (c.agreementsAccepted) parts.push(`<span class="badge good">${c.agreementsAccepted} accepted</span>`);
    if (c.agreementsPending) parts.push(`<span class="badge warning">${c.agreementsPending} waiting</span>`);
    if (c.payoutsWithoutAgreement) parts.push(`<span class="badge gray">${c.payoutsWithoutAgreement} without</span>`);
    return parts.join(' ') || '<span class="muted">—</span>';
}

/** A few plain sentences, the most useful first. */
function insights(r, overdueAmount) {
    const out = [];
    const item = (tone, iconName, text) => `<div class="insight ${tone}">${icon(iconName)}<span>${text}</span></div>`;
    const lateMembers = r.defaulters.filter(d => d.monthsOverdue >= 2);
    if (overdueAmount > 0) out.push(item('bad', 'alert', `<b>${money(overdueAmount)}</b> is past its due date across ${r.defaulters.filter(d => num(d.overdue)).length} member(s). Send reminders with payment links from Host a Chit.`));
    if (lateMembers.length) out.push(item('bad', 'users', `${lateMembers.length} member(s) owe for two months or more: ${lateMembers.slice(0, 4).map(d => esc(d.member)).join(', ')}${lateMembers.length > 4 ? '…' : ''}.`));
    if (num(r.expectedThisMonth)) {
        const rate = (num(r.collectedThisMonth) / num(r.expectedThisMonth)) * 100;
        out.push(item(rate >= 90 ? 'good' : rate >= 60 ? 'warn' : 'bad', 'arrow-in', `This month <b>${percent(rate, 0)}</b> of the installments are in (${moneyShort(r.collectedThisMonth)} of ${moneyShort(r.expectedThisMonth)}).`));
    }
    const income = num(r.commission) + num(r.lateFees);
    if (income) out.push(item('good', 'piggy', `You earned <b>${money(income)}</b> in the period: ${money(r.commission)} commission${num(r.lateFees) ? ` and ${money(r.lateFees)} late interest` : ''}.`));
    if (num(r.lateFeesDue)) out.push(item('warn', 'clock', `<b>${money(r.lateFeesDue)}</b> of late interest is due and not yet collected.`));
    const waiting = r.chits.reduce((s, c) => s + c.agreementsPending, 0);
    const without = r.chits.reduce((s, c) => s + c.payoutsWithoutAgreement, 0);
    if (waiting) out.push(item('warn', 'file-text', `${waiting} winner agreement(s) are not accepted yet. Send the link again or record a paper signature.`));
    if (without) out.push(item('warn', 'file-text', `${without} payout(s) have no agreement. Make one from the chit's Agreements tab to keep a record.`));
    if (num(r.held) < 0) out.push(item('bad', 'wallet', `You have paid out ${money(-num(r.held))} more than you collected: chase the dues before the next payout.`));
    if (!out.length) out.push(item('good', 'check-circle', 'All chits are up to date.'));
    return out;
}
