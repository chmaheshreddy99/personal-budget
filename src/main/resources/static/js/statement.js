/**
 * The page behind a statement link (/statement.html#<token>): no sign-in, only the token. Shows the other person
 * where a loan stands today: what was given, what was paid back and when, the interest so far and when the next
 * interest falls due, and what is payable now; the month-by-month (or year-by-year) interest when it was shared.
 * Worked out when the page is opened, so it is always current. The token stays in the address fragment.
 */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const when = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const short = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

const token = location.hash.slice(1);
let st, fmt, tableBy = 'month';

const money = (v, decimals = false) => fmt(decimals).format(Number(v || 0));

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = message('This link is incomplete.'); return; }
    try {
        const r = await fetch(`/api/public/statements/${encodeURIComponent(token)}`, { method: 'POST', headers: { Accept: 'application/json' } });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message || 'This link does not work any more.');
        st = body;
    } catch (error) { main.innerHTML = message(error.message); return; }
    const locale = st.currency === 'INR' ? 'en-IN' : 'en-US';
    const cache = {};
    fmt = decimals => (cache[decimals] ||= new Intl.NumberFormat(locale, { style: 'currency', currency: st.currency || 'INR',
        minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }));
    document.title = `Statement · ${st.party}`;
    draw();
}

function draw() {
    const main = $('sh-main');
    const viewerOwes = st.owedByViewer;
    const open = st.status === 'OPEN' || st.status === 'PARTIAL';
    const rate = st.interestRate !== null && st.interestRate !== undefined;
    const paidPct = Math.min(100, Number(st.repaidPercent || 0));
    const headline = viewerOwes ? `You owe ${esc(st.sharedBy)}` : `${esc(st.sharedBy)} owes you`;
    const status = !open ? (st.status === 'WRITTEN_OFF' ? ['done', 'Closed'] : ['done', 'Settled in full'])
        : st.overdue ? ['late', `Overdue · ${Math.abs(st.daysToDue)} days`] : st.status === 'PARTIAL' ? ['part', 'Partly paid'] : ['open', 'Open'];
    const payments = st.payments.filter(p => !p.writeOff);
    main.innerHTML = `
        <section class="sh-card st-hero">
            <div class="sh-head"><div><small>${esc(st.kindLabel)} · ${esc(st.narration)}</small><h1>${esc(st.sharedWith || st.party)}</h1></div>
                <span class="st-badge ${status[0]}">${status[1]}</span></div>
            <div class="st-total">
                <div><span>${open ? `${headline} today` : 'Nothing is owed any more'}</span>
                    <b>${open ? money(Math.round(Number(st.payableToday))) : money(0)}</b>
                    <small>${open ? `${money(st.outstanding)} principal${rate ? ` + ${money(Math.round(Number(st.interestDue)))} interest` : ''}` : st.lastPaymentDate ? `last payment on ${day(st.lastPaymentDate)}` : ''}</small></div>
                ${open && st.dueDate && st.daysToDue > 0 && rate ? `<div class="st-side"><span>If paid on ${day(st.dueDate)}</span><b>${money(Math.round(Number(st.payableAtDue)))}</b>
                    <small>${st.daysToDue} days from today</small></div>` : ''}
                ${open && st.nextInterestDate ? `<div class="st-side"><span>Next interest · ${day(st.nextInterestDate)}</span><b>${money(Math.round(Number(st.nextInterestAmount || 0)))}</b>
                    <small>${esc(st.interestCollectionLabel?.toLowerCase() || '')}</small></div>` : ''}
            </div>
            <div class="st-progress"><div class="row"><span>Principal paid back</span><b>${Math.round(paidPct)}%</b></div>
                <i><em style="width:${paidPct}%"></em></i>
                <div class="row muted"><span>${money(st.repaid)} of ${money(st.amount)}</span><span>${money(st.outstanding)} left</span></div></div>
            ${st.message ? `<p class="st-message">“${esc(st.message)}” <span>— ${esc(st.sharedBy)}</span></p>` : ''}
        </section>

        <section class="st-figs">
            ${fig(viewerOwes ? 'Given to you' : 'Lent by you', money(st.amount), `on ${day(st.startDate)} · ${st.daysOutstanding} days ago`)}
            ${fig('Paid back', money(st.repaid), payments.length ? `${payments.length} payment${payments.length === 1 ? '' : 's'} · last ${day(st.lastPaymentDate)}` : 'nothing yet', 'pos')}
            ${fig('Principal left', money(st.outstanding), open ? 'still to pay' : 'cleared', open && Number(st.outstanding) ? 'neg' : '')}
            ${rate ? fig('Interest rate', `${Number(st.interestRate)}% a year`, `${esc(st.interestTypeLabel)} · collected ${esc((st.interestCollectionLabel || '').toLowerCase())}`) : fig('Interest', 'None', 'no interest on this')}
            ${rate ? fig('Interest so far', money(st.interestAccrued, true), `paid ${money(st.interestPaid)} · ${money(Math.round(Number(st.monthlyInterest)))} a month now`) : ''}
            ${rate && open ? fig(st.interestCollection === 'ON_PAYMENT' ? 'Interest unpaid' : 'Interest due now', money(Math.round(Number(st.interestDueNow))),
                st.interestCollection === 'ON_PAYMENT' ? 'pay it whenever you pay' : st.interestCollection === 'YEARLY' ? 'for the completed years' : 'for the completed months',
                Number(st.interestDueNow) > 0 ? 'warn' : '') : ''}
            ${st.dueDate ? fig(st.overdue ? 'Was due' : 'Due by', day(st.dueDate), !open ? '—' : st.overdue ? `${Math.abs(st.daysToDue)} days late` : `in ${st.daysToDue} days`, st.overdue ? 'neg' : '') : ''}
        </section>

        <section class="sh-card st-section">
            <h2>Payments</h2>
            ${st.payments.length ? `<div class="st-scroll"><table class="st-table">
                <thead><tr><th>Date</th><th class="r">Paid</th><th class="r">Principal</th>${rate ? '<th class="r">Interest</th>' : ''}<th class="r">Principal left</th></tr></thead>
                <tbody>
                    <tr class="st-start"><td>${day(st.startDate)}</td><td colspan="${rate ? 3 : 2}">${viewerOwes ? 'Money given to you' : 'Money lent'}</td><td class="r"><b>${money(st.amount)}</b></td></tr>
                    ${st.payments.map(p => `<tr class="${p.writeOff ? 'st-waived' : ''}"><td>${day(p.date)}</td>
                        <td class="r"><b>${p.writeOff ? 'Waived' : money(p.total, true)}</b></td><td class="r">${money(p.principal, true)}</td>
                        ${rate ? `<td class="r">${Number(p.interest) ? money(p.interest, true) : '—'}</td>` : ''}
                        <td class="r">${p.finalPayment ? '<span class="st-ok">cleared</span>' : money(p.outstandingAfter)}</td></tr>`).join('')}
                </tbody>
                <tfoot><tr><td>Total</td><td class="r">${money(payments.reduce((s, p) => s + Number(p.total), 0), true)}</td>
                    <td class="r">${money(payments.reduce((s, p) => s + Number(p.principal), 0), true)}</td>
                    ${rate ? `<td class="r">${money(payments.reduce((s, p) => s + Number(p.interest), 0), true)}</td>` : ''}<td class="r">${money(st.outstanding)}</td></tr></tfoot>
            </table></div>` : `<p class="muted">No payments yet.</p>`}
        </section>

        ${st.showSchedule ? `<section class="sh-card st-section">
            <div class="st-section-head"><h2>Interest, ${tableBy === 'year' ? 'year' : 'month'} by ${tableBy === 'year' ? 'year' : 'month'}</h2>
                <span class="st-toggle"><button data-by="month" class="${tableBy === 'month' ? 'on' : ''}">Monthly</button><button data-by="year" class="${tableBy === 'year' ? 'on' : ''}">Yearly</button></span></div>
            <p class="muted small">${Number(st.interestRate)}% a year, ${esc(st.interestTypeLabel).toLowerCase()} · ${esc(st.dayCount)}. Months ahead assume nothing more is paid.</p>
            <div class="st-scroll">${scheduleTable()}</div>
        </section>` : ''}

        <section class="st-foot-card">
            <span>As of <b>${day(st.asOf)}</b>: the figures are worked out each time this page is opened.
                Shared by <b>${esc(st.sharedBy)}</b> · available until <b>${when(st.expiresAt)}</b>.</span>
            <button class="st-print" onclick="window.print()">Print / save as PDF</button>
        </section>`;
    main.querySelector('.st-toggle')?.addEventListener('click', e => {
        const b = e.target.closest('[data-by]');
        if (b) { tableBy = b.dataset.by; draw(); }
    });
}

/** Month by month, or folded into years (from the loan's start date). */
function scheduleTable() {
    let rows = st.schedule;
    if (tableBy === 'year') {
        const years = [];
        rows.forEach(p => {
            const y = Math.floor((p.period - 1) / 12);
            const g = years[y] ||= { period: y + 1, from: p.from, to: p.to, openingPrincipal: p.openingPrincipal, paid: 0, interest: 0, cumulative: 0, statuses: new Set() };
            g.to = p.to; g.paid += Number(p.paid); g.interest += Number(p.interest); g.cumulative = p.cumulative; g.statuses.add(p.status);
        });
        rows = years.filter(Boolean).map(g => ({ ...g, status: g.statuses.has('ACCRUING') ? 'ACCRUING' : g.statuses.has('PROJECTED') ? (g.statuses.has('EARNED') ? 'ACCRUING' : 'PROJECTED') : 'EARNED' }));
    }
    const label = { EARNED: 'done', ACCRUING: 'running', PROJECTED: 'ahead' };
    return `<table class="st-table">
        <thead><tr><th>${tableBy === 'year' ? 'Year' : '#'}</th><th>Period</th><th class="r">Principal</th><th class="r">Paid</th><th class="r">Interest</th><th class="r">Interest so far</th><th></th></tr></thead>
        <tbody>${rows.map(p => `<tr class="st-${p.status.toLowerCase()}"><td><b>${p.period}</b></td><td class="nowrap">${short(p.from)} – ${short(p.to)}</td>
            <td class="r">${money(p.openingPrincipal)}</td><td class="r">${Number(p.paid) ? money(p.paid) : '—'}</td>
            <td class="r"><b>${money(p.interest, true)}</b></td><td class="r">${money(p.cumulative)}</td><td><span class="st-pill ${p.status.toLowerCase()}">${label[p.status]}</span></td></tr>`).join('')}</tbody>
    </table>`;
}

function fig(label, value, sub = '', tone = '') {
    return `<div class="st-fig"><span>${esc(label)}</span><b class="${tone}">${value}</b><small>${sub}</small></div>`;
}

function message(text) {
    return `<section class="sh-card sh-empty"><h1>Not available</h1><p>${esc(text)}</p><p class="sh-meta">Ask the person who shared it for a new link.</p></section>`;
}

start();
