/**
 * The page behind a chit link (/chit-statement.html#<token>): no sign-in, only the token, made to be read on a phone.
 * Top to bottom: what the chit pays out and when (or what was received), how far it is paid (a ring and one cell per
 * installment), the next installment (or what is overdue), when the sender chose so the returns (the effective interest
 * rate, compound and simple, how the money grows day by day and month by month, against a bank deposit), the organizer
 * and the chit's terms, the money in and out, and, when chosen, every installment. The token is in the address fragment, so it is never sent to the
 * server in a page request or kept in a referrer.
 */
import { trackedFetch } from './core/busy.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = location.hash.slice(1);
let currency = 'INR';
const money = v => (v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2 }).format(Number(v)));
const short = v => {
    const n = Math.abs(Number(v || 0)), sign = Number(v) < 0 ? '−' : '';
    const sym = money(0).replace(/[\d.,\s]/g, '');
    return n >= 1e7 ? `${sign}${sym}${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${sign}${sym}${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `${sign}${sym}${(n / 1e3).toFixed(1)}K` : `${sign}${money(n)}`;
};
const day = iso => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const monthOf = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' });
const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "in 8 months", "in 12 days", "today", "3 days ago" (to a date, from today). */
function fromNow(iso, months = null) {
    const days = Math.round((new Date(String(iso).slice(0, 10) + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    if (days === 0) return 'today';
    if (days < 0) return `${plural(-days, 'day')} ago`;
    if (days < 45) return `in ${plural(days, 'day')}`;
    const m = months ?? Math.round(days / 30.4);
    return m >= 12 ? `in ${m % 12 ? `${Math.floor(m / 12)} yr ${m % 12} mo` : plural(m / 12, 'year')}` : `in ${plural(m, 'month')}`;
}

async function start() {
    const main = $('sh-main');
    if (!token) { main.innerHTML = notAvailable('This link is incomplete.'); return; }
    let s;
    try {
        const r = await trackedFetch(`/api/public/chit-statements/${encodeURIComponent(token)}`, { method: 'POST', headers: { Accept: 'application/json' } });   // POST: the view is counted
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message || 'This link does not work any more.');
        s = body;
    } catch (error) { main.innerHTML = notAvailable(error.message); return; }
    currency = s.currency || 'INR';
    document.title = `${s.chitName} · chit`;
    main.innerHTML = [hero(s), s.message ? message(s) : '', progress(s), next(s), s.returns ? returnsHtml(s) : '', organizer(s), money_(s),
        s.showInstallments ? installments(s) : '', footer(s)].join('');
    if (s.returns) bindReturns(s);
    main.addEventListener('click', e => {
        const t = e.target.closest('[data-filter]');
        if (!t) return;
        main.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b === t));
        main.querySelectorAll('.cst-inst').forEach(row => { row.hidden = t.dataset.filter !== 'all' && row.dataset.status !== t.dataset.filter; });
    });
}

/** What the chit pays out and when, as the headline; once paid out, what came in (and what is still to come). */
function hero(s) {
    const tone = { RUNNING: 'run', PRIZED: 'prized', COMPLETED: 'done', CLOSED: 'done' }[s.stage] || 'run';
    const head = s.paidOut
        ? `<small>${Number(s.payoutPending) ? 'Payout received so far' : 'Payout received'}</small>
           <b class="cst-big">${money(s.paidOut && Number(s.payoutPending) ? s.payoutReceived : s.receive)}</b>
           <span class="cst-when">${Number(s.payoutPending) ? `of ${money(s.receive)} · <b>${money(s.payoutPending)}</b> still to come` : `on ${day(s.receiveOn)}`}</span>`
        : `<small>You will get</small>
           <b class="cst-big">${money(s.receive)}</b>
           <span class="cst-when">on <b>${day(s.receiveOn)}</b> · ${esc(fromNow(s.receiveOn, s.monthsLeft))}</span>`;
    return `
    <section class="cst-hero ${tone}">
        <div class="cst-hero-top">
            <div class="cst-name"><h1>${esc(s.chitName)}</h1><span>${esc([s.organizer, s.ticketNo ? `Ticket ${s.ticketNo}` : ''].filter(Boolean).join(' · '))}</span></div>
            <span class="cst-stage ${tone}">${esc(s.stageLabel)}</span>
        </div>
        <div class="cst-hero-main">${head}</div>
        <div class="cst-hero-foot">
            <span><small>Chit value</small><b>${short(s.chitValue)}</b></span>
            <span><small>Each month</small><b>${short(s.monthlyInstallment)}</b></span>
            <span><small>Ends</small><b>${s.endDate ? day(s.endDate) : '—'}</b></span>
        </div>
    </section>`;
}

function message(s) {
    return `<p class="cst-message">“${esc(s.message)}”<span>${esc(s.sharedBy)}</span></p>`;
}

/** How far it is paid: a ring (installments) beside the money, and one cell per installment. */
function progress(s) {
    const n = s.numberOfInstallments || 1, paid = s.installmentsPaid;
    const r = 42, c = 2 * Math.PI * r;
    const paidLen = (paid / n) * c, overLen = (s.overdueCount / n) * c;
    const statuses = s.installments?.length ? s.installments.map(i => i.status)
        : Array.from({ length: n }, (_, k) => (k < paid ? 'PAID' : k < paid + s.overdueCount ? 'OVERDUE' : 'PENDING'));
    const nextIndex = statuses.findIndex(x => x !== 'PAID');
    return `
    <section class="sh-card cst-progress">
        <div class="cst-ring" role="img" aria-label="${paid} of ${n} installments paid">
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" class="track"/>
                <circle cx="50" cy="50" r="${r}" class="paid" stroke-dasharray="${paidLen} ${c}"/>
                ${s.overdueCount ? `<circle cx="50" cy="50" r="${r}" class="over" stroke-dasharray="${overLen} ${c}" stroke-dashoffset="${-paidLen}"/>` : ''}</svg>
            <div><b>${paid}<small>/${n}</small></b><span>paid</span></div>
        </div>
        <div class="cst-split">
            <div><small>Paid so far</small><b>${money(s.paidIn)}</b><span>${plural(paid, 'installment')}</span></div>
            <div><small>Still to pay</small><b class="${Number(s.overdueAmount) ? 'neg' : ''}">${money(s.stillToPay)}</b><span>${plural(s.installmentsPending, 'installment')}${s.monthsLeft ? ` · ${plural(s.monthsLeft, 'month')} left` : ''}</span></div>
        </div>
        <div class="cst-cells" aria-hidden="true">${statuses.map((st, k) => `<i class="${st.toLowerCase()} ${k === nextIndex ? 'next' : ''}" title="Installment ${k + 1}"></i>`).join('')}</div>
        <div class="cst-legend"><span><i class="paid"></i>Paid</span>${s.overdueCount ? '<span><i class="overdue"></i>Overdue</span>' : ''}<span><i class="pending"></i>To pay</span><span><i class="pending next"></i>Next</span></div>
    </section>`;
}

/** The next installment, or what is overdue; nothing once everything is paid. */
function next(s) {
    if (!s.installmentsPending) {
        return `<section class="cst-next done"><span class="cst-dot">✓</span><div><b>All ${s.numberOfInstallments} installments paid</b><small>${s.paidOut ? 'Paid out' : `The chit pays out on ${day(s.receiveOn)}`}</small></div></section>`;
    }
    if (s.overdueCount) {
        return `<section class="cst-next late"><span class="cst-dot">!</span><div><b>${money(s.overdueAmount)} overdue</b>
            <small>${plural(s.overdueCount, 'installment')} past the due date${s.nextDueDate ? ` · the oldest was due ${day(s.nextDueDate)}` : ''}</small></div></section>`;
    }
    return `<section class="cst-next"><span class="cst-dot">${s.nextDueDate ? new Date(s.nextDueDate + 'T00:00:00').getDate() : '•'}</span>
        <div><b>Next: ${money(s.nextDueAmount)}</b><small>due ${day(s.nextDueDate)} · ${esc(fromNow(s.nextDueDate))}</small></div>
        <span class="cst-next-no">#${s.installmentsPaid + 1}</span></section>`;
}

function organizer(s) {
    const rows = [
        ['Organizer', esc(s.organizer || '—')],
        s.ticketNo ? ['Ticket / group', esc(s.ticketNo)] : null,
        ['Chit value', money(s.chitValue)],
        ['Installment', `${money(s.monthlyInstallment)} × ${s.numberOfInstallments}`],
        ['Runs', `${day(s.startDate)} → ${day(s.endDate)}`],
        ['Pays out', s.paidOut ? `${money(s.receive)} on ${day(s.receiveOn)}` : `${money(s.receive)} on ${day(s.receiveOn)}`],
    ].filter(Boolean);
    return `<section class="sh-card cst-facts"><h2>The chit</h2><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>`;
}

/** The money: what went in, what came back as dividends, and the gain. */
function money_(s) {
    const gain = Number(s.netGain || 0);
    return `
    <section class="cst-figs">
        <div><small>Paid in</small><b>${short(s.paidIn)}</b><span>of ${short(s.totalContribution)}</span></div>
        <div><small>Dividends</small><b class="pos">${short(s.dividendsEarned)}</b><span>cash paid ${short(s.cashPaid)}</span></div>
        <div><small>${s.paidOut ? 'Gain made' : 'Gain at the end'}</small><b class="${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : '−'}${short(Math.abs(gain))}</b><span>${s.paidOut ? 'payout + dividends − paid' : 'payout − paid + dividends'}</span></div>
    </section>`;
}

function installments(s) {
    const count = st => s.installments.filter(i => i.status === st).length;
    return `
    <section class="sh-card cst-list">
        <div class="cst-list-head"><h2>Installments</h2>
            <div class="cst-filter"><button type="button" data-filter="all" class="on">All ${s.installments.length}</button>
                <button type="button" data-filter="PAID">Paid ${count('PAID')}</button>
                <button type="button" data-filter="PENDING">To pay ${count('PENDING') + count('OVERDUE')}</button></div></div>
        ${s.installments.map(i => `
        <div class="cst-inst ${i.status.toLowerCase()}" data-status="${i.status === 'OVERDUE' ? 'PENDING' : i.status}">
            <span class="cst-no">${i.no}</span>
            <div class="cst-inst-main"><b>${monthOf(i.dueDate)} ${new Date(i.dueDate + 'T00:00:00').getFullYear()}</b>
                <small>${i.status === 'PAID' ? `paid ${day(i.paidDate)}${Number(i.dividend) ? ` · dividend ${short(i.dividend)}` : ''}` : i.status === 'OVERDUE' ? `was due ${day(i.dueDate)}` : `due ${day(i.dueDate)}`}</small></div>
            <div class="cst-inst-amt"><b>${money(i.status === 'PAID' ? i.paidAmount : i.dueAmount)}</b>
                <span class="cst-chip ${i.status.toLowerCase()}">${i.status === 'PAID' ? 'Paid' : i.status === 'OVERDUE' ? 'Overdue' : 'To pay'}</span></div>
        </div>`).join('')}
    </section>`;
}

function footer(s) {
    return `<p class="cst-foot">Shared by <b>${esc(s.sharedBy)}</b>${s.household ? ` (${esc(s.household)})` : ''}${s.sharedWith ? ` with <b>${esc(s.sharedWith)}</b>` : ''}.
        As of ${day(s.asOf)}; always up to date when opened. This link works until <b>${when(s.expiresAt)}</b>.</p>`;
}

function notAvailable(text) {
    return `<section class="sh-card sh-empty"><h1>Not available</h1><p>${esc(text)}</p><p class="sh-meta">Ask the person who shared it for a new link.</p></section>`;
}

// ===================================================================== the returns (when the sender chose to show them)

const pct = v => `${Number(v || 0).toFixed(Math.abs(Number(v)) >= 100 ? 0 : 1)}%`;
const rupees = v => money(Math.round(Number(v || 0)));
/** The chart's view: the whole value, or the interest alone (which the value's scale makes hard to see). */
let chartMode = 'value';

/**
 * What the chit earns, in plain words: the two rates side by side (compound, as a bank quotes a yield; simple, the flat
 * rate that gives the same interest), the value today ticking up as it grows, a chart of the money month by month, the
 * end of the chit against a bank deposit, and the months in a table.
 */
function returnsHtml(s) {
    const r = s.returns;
    const end = r.growth[r.growth.length - 1];
    const totalPaid = Number(s.totalContribution);
    const fromMaturity = /implied/i.test(r.rateBasis || '');
    return `
    <section class="cst-returns" id="cst-returns">
        <div class="cst-r-head"><h2>Returns</h2><span>what this chit earns</span></div>
        <div class="cst-rates">
            <div class="cst-rate compound">
                <small>Compound</small>
                <b>${pct(r.compoundRate)}<em> a year</em></b>
                <span>The effective annual return, with interest earned on interest, as a bank quotes a deposit's yield. Use this one to compare.</span>
            </div>
            <div class="cst-rate simple">
                <small>Simple</small>
                <b>${pct(r.simpleRate)}<em> a year</em></b>
                <span>The flat rate that gives the same interest on the money while it sits in the chit.</span>
            </div>
        </div>
        <p class="cst-why">${whyText(s, r)} Both come from the chit's rate of <b>${pct(r.nominalRate)} a year</b>
            (${(Number(r.nominalRate) / 12).toFixed(2)}% a month)${fromMaturity ? `, which is what the ${short(s.chitValue)} it pays out works out to` : ', as set for this chit'}.</p>

        ${r.growing ? `
        <div class="cst-live">
            <div class="cst-live-main"><small>Worth today</small><b id="cst-ticker" data-value="${Number(r.valueToday)}" data-per-day="${Number(r.perDay)}">${money(r.valueToday)}</b>
                <span>paid in ${rupees(s.paidIn)} + interest ${rupees(Number(r.valueToday) - Number(s.paidIn))}</span>
                <span class="cst-today">today so far <b id="cst-today">+${money(0)}</b></span></div>
            <div class="cst-live-side">
                <span><b>+${money(r.perDay)}</b> a day</span>
                <span><b>+${short(r.perMonth)}</b> this month</span>
                <span class="cst-pulse" aria-hidden="true"></span>
            </div>
        </div>` : ''}

        <div class="sh-card cst-chart-card">
            <div class="cst-chart-head"><div class="cst-chart-top"><h3>How the money grows</h3>
                <div class="cst-filter cst-mode"><button type="button" data-chart="value" class="on">Total value</button><button type="button" data-chart="interest">Interest only</button></div></div>
                <div class="cst-keys" id="cst-keys">${keysHtml()}</div></div>
            <div class="cst-chart" id="cst-chart" role="img" aria-label="Money paid in and its value, month by month">${chartSvg(r.growth)}</div>
            <div class="cst-tip" id="cst-tip">${tipHtml(r.growth, currentIndex(r.growth))}</div>
        </div>

        <div class="sh-card cst-end">
            <h3>${s.paidOut ? 'Over the whole chit' : 'At the end of the chit'}</h3>
            ${barsHtml([
                ['You pay in', totalPaid, 'paid', money(totalPaid)],
                ['Interest, compound', Number(r.interestAtEnd), 'value', `+${rupees(r.interestAtEnd)}`],
                ['Interest, simple', Number(r.simpleInterestAtEnd), 'simple', `+${rupees(r.simpleInterestAtEnd)}`],
                [`A ${pct(r.fdRate)} bank RD would earn`, Number(r.fdInterest), 'fd', `+${rupees(r.fdInterest)}`],
            ])}
            <p class="cst-verdict ${Number(r.vsFd) >= 0 ? 'good' : 'bad'}">${Number(r.vsFd) >= 0
                ? `The chit earns <b>${rupees(r.vsFd)} more</b> than the same installments in a ${pct(r.fdRate)} recurring deposit.`
                : `A ${pct(r.fdRate)} recurring deposit would earn <b>${rupees(-Number(r.vsFd))} more</b> than this chit.`}</p>
            <div class="cst-so-far"><span>Interest earned so far <small>(whole months)</small></span><b>${rupees(r.interestSoFar)}</b><small>simple would be ${rupees(r.simpleInterestSoFar)}</small></div>
        </div>

        <details class="sh-card cst-months"><summary>Month by month <span>${r.growth.length} months</span></summary>
            <div class="cst-mtable">${r.growth.map(g => `
                <div class="cst-mrow ${g.status.toLowerCase()}"><span class="cst-mno">${g.month}</span>
                    <div><b>${monthOf(g.date)} ${new Date(g.date + 'T00:00:00').getFullYear()}</b><small>paid in ${short(g.paidIn)}</small></div>
                    <div class="r"><b>${rupees(g.value)}</b><small>${g.status === 'AFTER_PAYOUT' ? 'paid out' : `+${rupees(g.interest)} ${g.status === 'EARNED' ? 'earned' : g.status === 'ACCRUING' ? 'this month' : 'to come'}`}</small></div></div>`).join('')}
            </div></details>

        <details class="cst-explain"><summary>What do these mean?</summary>
            <p><b>Compound</b> treats the chit like a recurring deposit: every month the interest joins your money and earns interest too. ${pct(r.compoundRate)} a year
                is directly comparable with the yearly yield a bank quotes.</p>
            <p><b>Simple</b> never adds interest to the base: it is the plain yearly rate on the installments while they are in the chit. It is higher because the
                money is in for less than the full term on average.</p>
            <p>The figures follow the chit's own rate${fromMaturity ? ' (what its payout implies)' : ''}; dividends paid back on the installments come on top, and
                tax is not taken into account.</p>
        </details>
    </section>`;
}

/** Why the two rates differ, for the case at hand. */
function whyText(s, r) {
    const c = Number(r.compoundRate), sr = Number(r.simpleRate);
    const sits = Number(s.monthlyInstallment) ? ` The first ${short(s.monthlyInstallment)} works ${s.numberOfInstallments} months, the last only one.` : '';
    if (Math.abs(sr - c) < 0.25) {
        return `Why are they so close? Two things pull opposite ways: each installment stays in the chit only for the months left after it is paid,
            which needs a higher flat rate, while over a long term interest on interest adds up, which needs a lower one. Here they almost cancel out.${sits}`;
    }
    return sr > c
        ? `Why is simple higher? Each installment stays in the chit only for the months left after it is paid, not the whole term, so a flat rate on that
            money has to be higher to give the same interest.${sits}`
        : `Why is simple lower? Over a long term, interest earned on interest adds up, so a flat rate gives the same interest at a lower figure.${sits}`;
}

/** The month whose interest is running now (or the last one earned). */
function currentIndex(growth) {
    const i = growth.findIndex(g => g.status === 'ACCRUING');
    if (i >= 0) return i;
    const last = growth.map(g => g.status).lastIndexOf('EARNED');
    return last >= 0 ? last : 0;
}

function tipHtml(growth, i) {
    const g = growth[i];
    if (!g) return '';
    const when = g.status === 'EARNED' ? 'earned' : g.status === 'ACCRUING' ? 'running now' : g.status === 'AFTER_PAYOUT' ? 'after the payout' : 'still to come';
    return `<b>Month ${g.month} · ${monthOf(g.date)} ${new Date(g.date + 'T00:00:00').getFullYear()}</b>
        <span>paid in <b>${rupees(g.paidIn)}</b> → worth <b>${rupees(g.value)}</b></span>
        <span>+${rupees(g.interest)} interest that month · interest so far ${rupees(Number(g.value) - Number(g.paidIn))} · ${when}</span>`;
}

function keysHtml() {
    return chartMode === 'value'
        ? '<span><i class="k-paid"></i>Paid in</span><span><i class="k-value"></i>With compound interest</span><span><i class="k-simple"></i>Simple</span>'
        : '<span><i class="k-paid"></i>Interest each month</span><span><i class="k-value"></i>Interest so far, compound</span><span><i class="k-simple"></i>Simple</span>';
}

/** The series the chart draws: the value (paid in as bars), or the interest alone (each month's as bars). */
function series(growth) {
    if (chartMode === 'value') return growth;
    return growth.map(g => ({ ...g, value: Number(g.value) - Number(g.paidIn), simpleValue: Number(g.simpleValue) - Number(g.paidIn), paidIn: g.interest }));
}

/** Paid in (bars), the value with compound interest (line, area) and with simple interest (dashed), today marked. */
function chartSvg(all) {
    const growth = series(all);
    const W = 340, H = 190, L = 6, R = 6, T = 12, B = 22;
    const max = Math.max(...growth.map(g => Number(g.value)), ...growth.map(g => Number(g.paidIn)), 1);
    const x = i => L + (growth.length === 1 ? (W - L - R) / 2 : (i / (growth.length - 1)) * (W - L - R));
    const y = v => T + (1 - Number(v) / max) * (H - T - B);
    const now = currentIndex(growth);
    const line = key => growth.map((g, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(g[key]).toFixed(1)}`).join('');
    const bw = Math.max(2, ((W - L - R) / growth.length) * 0.55);
    const area = `${line('value')}L${x(growth.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
    const ticks = [0, Math.floor((growth.length - 1) / 2), growth.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    return `<svg viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="cst-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13a89a" stop-opacity=".32"/><stop offset="1" stop-color="#13a89a" stop-opacity="0"/></linearGradient>
            <clipPath id="cst-past"><rect x="0" y="0" width="${x(now) + 1}" height="${H}"/></clipPath></defs>
        ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`).join('')}
        ${growth.map((g, i) => `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(g.paidIn).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(g.paidIn)).toFixed(1)}" class="paid ${i > now ? 'future' : ''}"/>`).join('')}
        <path d="${area}" class="area"/>
        <path d="${line('simpleValue')}" class="simple"/>
        <path d="${line('value')}" class="value future"/>
        <path d="${line('value')}" class="value" clip-path="url(#cst-past)"/>
        <line x1="${x(now)}" x2="${x(now)}" y1="${T - 4}" y2="${y(0)}" class="today"/>
        <text x="${Math.min(W - R - 2, Math.max(L + 14, x(now)))}" y="${T - 2}" class="today-t" text-anchor="middle">today</text>
        <circle cx="${x(now)}" cy="${y(growth[now].value)}" r="4" class="dot" id="cst-dot"/>
        ${ticks.map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === growth.length - 1 ? 'end' : 'middle'}" class="tick">${monthOf(growth[i].date)} ${String(new Date(growth[i].date + 'T00:00:00').getFullYear()).slice(2)}</text>`).join('')}
        <text x="${W - R}" y="${y(max) - 3}" text-anchor="end" class="tick">${short(max)}</text>
        <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="cst-hit"/>
    </svg>`;
}

function barsHtml(rows) {
    const max = Math.max(...rows.map(r => r[1]), 1);
    return `<div class="cst-bars">${rows.map(([label, v, cls, text]) => `
        <div class="cst-bar"><span>${esc(label)}</span><i class="${cls}"><em style="width:${Math.max(1.5, (v / max) * 100)}%"></em></i><b>${text}</b></div>`).join('')}</div>`;
}

/** The chart answers a tap (or a finger moving over it) with that month; the value today ticks up second by second. */
function bindReturns(s) {
    const r = s.returns;
    const chart = $('cst-chart');
    document.querySelector('.cst-mode')?.addEventListener('click', e => {
        const b = e.target.closest('[data-chart]');
        if (!b || b.dataset.chart === chartMode) return;
        chartMode = b.dataset.chart;
        document.querySelectorAll('.cst-mode [data-chart]').forEach(x => x.classList.toggle('on', x === b));
        chart.innerHTML = chartSvg(r.growth);
        $('cst-keys').innerHTML = keysHtml();
    });
    if (chart) {
        const pick = e => {
            const box = chart.getBoundingClientRect();
            const p = (e.touches ? e.touches[0].clientX : e.clientX) - box.left;
            const i = Math.max(0, Math.min(r.growth.length - 1, Math.round((p / box.width) * (r.growth.length - 1))));
            $('cst-tip').innerHTML = tipHtml(r.growth, i);
            const dot = $('cst-dot');
            const W = 340, L = 6, R = 6, T = 12, B = 22, H = 190;
            const shown = series(r.growth);
            const max = Math.max(...shown.map(g => Number(g.value)), ...shown.map(g => Number(g.paidIn)), 1);
            dot.setAttribute('cx', L + (r.growth.length === 1 ? 0 : (i / (r.growth.length - 1)) * (W - L - R)));
            dot.setAttribute('cy', T + (1 - Number(shown[i].value) / max) * (H - T - B));
        };
        chart.addEventListener('pointermove', pick);
        chart.addEventListener('pointerdown', pick);
        chart.addEventListener('touchmove', pick, { passive: true });
    }
    const ticker = $('cst-ticker');
    if (ticker && Number(ticker.dataset.perDay) > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // from midnight: what today has added so far, a little more every second
        const base = Number(ticker.dataset.value), perSecond = Number(ticker.dataset.perDay) / 86400;
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
        // what today has added, to the hundredth of a paisa: it visibly grows every second
        const fine = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 4, maximumFractionDigits: 4 });
        const today = $('cst-today');
        const tick = () => {
            const grown = ((Date.now() - midnight) / 1000) * perSecond;
            ticker.textContent = fmt.format(base + grown);
            if (today) today.textContent = `+${fine.format(grown)}`;
        };
        tick();
        setInterval(tick, 1000);
    }
}

start();
