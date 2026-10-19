/**
 * Forecast › Chit analyzer: a chit the user hosts, seen from both sides (#/forecast/analyzer/<chit id>).
 *
 * Member's side: for the winner of each month, everything they pay against what they get, and what that works out to
 * a year. Month by month the member either holds the others' money (they won early: they borrow) or the others hold
 * theirs (they save); the gain (or cost) over that money, on average, as simple interest a year, is their rate. It is
 * compared with a bank loan for borrowers and a deposit for savers.
 *
 * Host's side: the commission month by month (planned chits: negative where a month pays out more than it
 * collects), the commission kept so far, how much of it must be kept aside for the months ahead that pay out more
 * (and from when), what is free to use, what the money kept aside could earn meanwhile, and what to do with it.
 * Auction chits are left out: their months are decided by the bids.
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState, loading } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { barChart, lineChart } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';

const num = v => Number(v || 0);
const signed = v => `${v < 0 ? '−' : ''}${money(Math.abs(v))}`;

/** Everything the page shows, worked out from the chit's schedule. */
export function analyse(d, { savingsRate = 7 } = {}) {
    const c = d.chit;
    const n = d.schedule.length;
    const planned = c.chitType === 'PLANNED';
    const extra = planned ? 0 : num(c.winnerExtraAmount);
    const inst = k => num(d.schedule[k - 1].installment);
    const payout = m => num(d.schedule[m - 1].payout);
    /** What the winner of month m pays in month k. */
    const pay = (m, k) => inst(k) + (k > m ? extra : 0);

    const members = d.schedule.map(row => {
        const m = row.monthNo;
        let paid = 0, balance = 0, sum = 0, used = 0;
        for (let k = 1; k <= n; k++) {
            paid += pay(m, k);
            balance += (k === m ? payout(m) : 0) - pay(m, k);
            if (k < n) { sum += balance; used += Math.abs(balance); }   // month-end: + holds others' money, − others hold theirs
        }
        const net = payout(m) - paid;
        const avg = n > 1 ? sum / (n - 1) : 0;
        const inUse = n > 1 ? used / (n - 1) : 0;   // the money in play on average, either way
        const borrows = avg > 0;
        // the gain over the money in play, a year (simple interest): + the member is better off, − they pay
        const rate = inUse < 1 ? null : (net / (inUse * n / 12)) * 100;
        return { monthNo: m, winner: row.winnerName, payout: payout(m), paid, net, average: avg, borrows, rate, done: row.status === 'COMPLETED' };
    });

    const host = [];
    let cum = 0;
    for (let k = 1; k <= n; k++) {
        const collected = planned ? inst(k) * c.memberCount : inst(k) * c.memberCount + (k - 1) * extra;
        const commission = collected - payout(k);
        cum += commission;
        host.push({ monthNo: k, collected, payout: payout(k), commission, kept: cum });
    }
    // what has to stay aside after month k for later months that pay out more than they collect
    // (the lowest the commission kept falls to later: what is above it now is free, the rest must stay)
    host.forEach((h, i) => {
        let low = h.kept;
        for (let j = i + 1; j < n; j++) low = Math.min(low, host[j].kept);
        h.reserve = Math.max(0, Math.min(h.kept, h.kept - low));
        h.free = Math.max(0, h.kept - h.reserve);
    });
    const monthlyRate = savingsRate / 1200;
    const floatEarn = host.reduce((s, h) => s + Math.max(0, h.reserve) * monthlyRate, 0);
    const peak = host.reduce((best, h) => (h.reserve > best.reserve ? h : best), { reserve: 0, monthNo: null });
    const negative = host.filter(h => h.commission < 0);
    const ownMoney = Math.max(0, -Math.min(0, ...host.map(h => h.kept)));
    // from this month on, a winner gets back at least what they pay in
    const breakEven = members.find(x => x.net >= 0)?.monthNo ?? null;
    return { c, planned, members, host, total: cum, floatEarn, peak, negative, ownMoney, breakEven };
}

/** Advice for the host, from the figures. */
function advice(a, { savingsRate, loanRate }) {
    const out = [];
    const tip = (iconName, tone, html) => out.push(`<li class="${tone}">${icon(iconName)}<span>${html}</span></li>`);
    if (a.negative.length) {
        const first = a.negative[0].monthNo, last = a.negative.at(-1).monthNo;
        const owed = -a.negative.reduce((s, h) => s + h.commission, 0);
        tip('shield', 'warn', `Months <b>${first}–${last}</b> pay winners <b>${money(owed)}</b> more than they collect. Keep up to <b>${money(a.peak.reserve)}</b> of your commission aside by month ${a.peak.monthNo}; only what is above that is yours to spend.`);
        tip('piggy', '', `Park the money kept aside in a <b>sweep-in deposit or a liquid fund</b> you can draw on the day a payout is due. At ${savingsRate}% a year it earns about <b>${money(a.floatEarn)}</b> before it is paid back to the winners.`);
        tip('calendar', '', `Before each of those months, move the shortfall from the commission account into the collections account (Chit accounts › Transfer) so the payout goes out in one go, or pay it straight from the commission account as a part of the payout.`);
    } else {
        tip('check-circle', 'good', `Every month collects at least what it pays out: the commission is yours as it comes, nothing has to be kept aside.`);
    }
    if (a.ownMoney > 0) {
        tip('alert', 'bad', `The payouts run ahead of everything collected: you would put in up to <b>${money(a.ownMoney)}</b> of your own. Lower the payouts of the months before or raise the early ones' installments.`);
    }
    const borrowers = a.members.filter(x => x.borrows && x.rate !== null);
    const expensive = borrowers.filter(x => -x.rate > loanRate * 1.5);
    if (expensive.length) {
        tip('percent', 'warn', `Early winners (months ${expensive[0].monthNo}–${expensive.at(-1).monthNo}) pay more than ${percent(loanRate * 1.5, 0)} a year for the money: members may not want to win early. A smaller gap between early and late payouts makes it fairer.`);
    }
    const savers = a.members.filter(x => !x.borrows && x.rate !== null);
    const weak = savers.filter(x => x.rate < savingsRate);
    if (weak.length && savers.length) {
        tip('trending-down', '', `Late winners from month ${weak[0].monthNo} earn less than a ${savingsRate}% deposit on what they put in: raise the later payouts a little to keep them in the chit.`);
    }
    if (a.total > 0) tip('hand-coins', '', `Over the chit you keep <b>${money(a.total)}</b>${a.floatEarn ? `, plus about ${money(a.floatEarn)} on the money kept aside` : ''}.`);
    return `<ul class="an-advice">${out.join('')}</ul>`;
}

export async function renderChitAnalyzer(body, chitId) {
    body.innerHTML = loading();
    const prefs = getPref('chitAnalyzer', { savingsRate: 7, loanRate: 12, chit: null });
    const list = (await api.get('/hosted-chits').catch(() => [])).filter(c => c.chitType !== 'AUCTION');
    if (!list.length) {
        body.innerHTML = panel({ title: 'Chit analyzer', iconName: 'calculator', body: emptyState('Host a fixed or planned chit to analyse it here: who borrows, who saves, at what rate, and what to keep aside', 'calculator') });
        return;
    }
    const pick = list.find(c => c.id === Number(chitId)) || list.find(c => c.id === prefs.chit) || list.find(c => c.chitType === 'PLANNED') || list[0];
    const d = await api.get(`/hosted-chits/${pick.id}`);
    const a = analyse(d, prefs);
    const c = d.chit;
    const borrowers = a.members.filter(x => x.borrows && x.rate !== null);
    const savers = a.members.filter(x => !x.borrows && x.rate !== null);
    const range = (xs, f = x => x.rate) => {
        if (!xs.length) return '—';
        const lo = Math.min(...xs.map(f)), hi = Math.max(...xs.map(f));
        return Math.round(lo) === Math.round(hi) ? percent(lo, 0) : `${percent(lo, 0)} – ${percent(hi, 0)}`;
    };
    const verdict = x => x.rate === null ? '<span class="muted">—</span>'
        : x.borrows ? (x.rate >= 0 ? '<span class="badge good">gains while borrowing</span>'
            : -x.rate > prefs.loanRate ? `<span class="badge warning">costlier than a ${prefs.loanRate}% loan</span>` : `<span class="badge good">cheaper than a ${prefs.loanRate}% loan</span>`)
        : (x.rate >= prefs.savingsRate ? `<span class="badge good">beats a ${prefs.savingsRate}% deposit</span>` : x.rate >= 0 ? `<span class="badge gray">below a ${prefs.savingsRate}% deposit</span>` : '<span class="badge warning">gets back less than paid</span>');
    const kpi = (iconName, label, value, sub, cls = '') => `<div class="ov-card cs-card ${cls}"><span class="ov-ico">${icon(iconName)}</span>
        <div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small></div></div>`;

    body.innerHTML = `<div class="an-page">
        <div class="an-tools glass">
            <label class="an-pick">${icon('hand-coins')}<select id="an-chit" aria-label="Chit">${list.map(x => `<option value="${x.id}" ${x.id === pick.id ? 'selected' : ''}
                data-meta="${esc(x.chitType === 'PLANNED' ? 'planned' : 'fixed')} · ${x.memberCount} members">${esc(x.name)}</option>`).join('')}</select></label>
            <label class="slider">Deposit rate <input type="number" id="an-save" value="${prefs.savingsRate}" min="0" max="20" step="0.5" data-plain> %</label>
            <label class="slider">Loan rate <input type="number" id="an-loan" value="${prefs.loanRate}" min="0" max="40" step="0.5" data-plain> %</label>
            <span class="spacer"></span>
            <a class="btn sm" href="#/host-chits/${c.id}/months">${icon('chevron-right')}Open the chit</a>
        </div>
        <div class="cs-cards an-kpis">
            ${kpi('piggy', 'Your commission', `<span class="${a.total < 0 ? 'down' : 'gold'}">${moneyShort(a.total)}</span>`, `over ${a.members.length} months`, 'highlight')}
            ${kpi('shield', 'Keep aside', moneyShort(a.peak.reserve), a.peak.reserve ? `most by month ${a.peak.monthNo}` : 'nothing to keep', a.peak.reserve ? 'note' : 'good')}
            ${kpi('trending', 'Earns meanwhile', moneyShort(a.floatEarn), `at ${prefs.savingsRate}% a year`)}
            ${kpi('arrow-out', 'Early winners pay', range(borrowers, x => -x.rate), borrowers.length ? `a year · months ${borrowers[0].monthNo}–${borrowers.at(-1).monthNo} borrow` : 'nobody borrows', borrowers.some(x => -x.rate > prefs.loanRate) ? 'warn' : '')}
            ${kpi('arrow-in', 'Late winners earn', range(savers), savers.length ? `months ${savers[0].monthNo}–${savers.at(-1).monthNo} · a year` : 'nobody', savers.length ? 'good' : '')}
            ${kpi('scale', 'Break-even', a.breakEven ? `month ${a.breakEven}` : '—', 'from here a winner saves rather than borrows')}
        </div>
        ${panel({ title: 'For the members: what winning each month means', iconName: 'users', cls: 'an-members', bodyClass: 'chart', body: '<div class="chart" id="an-rate"></div>' })}
        ${panel({ title: 'For you: commission kept and what to keep aside', iconName: 'piggy', cls: 'an-host', bodyClass: 'chart', body: '<div class="chart" id="an-host"></div>' })}
        ${panel({ title: 'Winner of each month', iconName: 'list', cls: 'an-table', bodyClass: 'flush', body: `<div class="scroll"><table class="grid compact an-grid">
            <thead><tr><th class="c">Month</th><th>Winner</th><th class="r">Gets</th><th class="r">Pays in all</th><th class="r">Gains</th><th>Is</th>
                <th class="r" title="The gain over the money the member uses (or lends) on average, as simple interest a year">A year</th><th>Compared</th></tr></thead>
            <tbody>${a.members.map(x => `<tr class="${x.done ? 'hc-past' : ''}"><td class="c">${x.monthNo}</td><td>${esc(x.winner || '—')}</td>
                <td class="r"><b>${money(x.payout)}</b></td><td class="r">${money(x.paid)}</td>
                <td class="r ${x.net < 0 ? 'neg' : 'pos'}">${signed(x.net)}</td>
                <td>${x.borrows ? `<span class="an-role borrow">${icon('arrow-out')}borrows</span>` : `<span class="an-role save">${icon('arrow-in')}saves</span>`}</td>
                <td class="r">${x.rate === null ? '—' : x.borrows && x.rate < 0 ? `<b class="neg">${percent(-x.rate, 1)}</b><small class="muted"> cost</small>`
                    : `<b class="${x.rate < 0 ? 'neg' : 'pos'}">${percent(x.rate, 1)}</b><small class="muted"> ${x.borrows ? 'gain' : 'return'}</small>`}</td>
                <td>${verdict(x)}</td></tr>`).join('')}</tbody></table></div>` })}
        ${panel({ title: 'Your commission, month by month', iconName: 'calendar', cls: 'an-host-table', bodyClass: 'flush', body: `<div class="scroll"><table class="grid compact an-grid">
            <thead><tr><th class="c">Month</th><th class="r">Collected</th><th class="r">Paid out</th><th class="r">Commission</th><th class="r">Kept so far</th><th class="r" title="Of what is kept, the part later months need">Keep aside</th><th class="r">Free to use</th></tr></thead>
            <tbody>${a.host.map(h => `<tr><td class="c">${h.monthNo}</td><td class="r">${money(h.collected)}</td><td class="r">${money(h.payout)}</td>
                <td class="r ${h.commission < 0 ? 'neg' : 'gold-ink'}">${signed(h.commission)}</td><td class="r ${h.kept < 0 ? 'neg' : ''}">${signed(h.kept)}</td>
                <td class="r">${h.reserve ? money(h.reserve) : '<span class="muted">—</span>'}</td><td class="r pos">${money(h.free)}</td></tr>`).join('')}</tbody></table></div>` })}
        ${panel({ title: 'What to do', iconName: 'bulb', cls: 'an-advice-panel', body: advice(a, prefs) })}
    </div>`;

    const labels = a.members.map(x => `M${x.monthNo}`);
    barChart(body.querySelector('#an-rate'), {
        labels, format: v => `${Math.round(v)}%`,
        series: [
            { name: 'Winner gains (% a year)', values: a.members.map(x => (x.rate !== null && x.rate >= 0 ? x.rate : 0)), color: '#13a89a' },
            { name: 'Winner pays (% a year)', values: a.members.map(x => (x.rate !== null && x.rate < 0 ? x.rate : 0)), color: '#d9603c' },
        ],
    });
    lineChart(body.querySelector('#an-host'), {
        labels: a.host.map(h => `M${h.monthNo}`), format: moneyShort, includeZero: true,
        series: [
            { name: 'Commission kept', values: a.host.map(h => h.kept), color: '#c99a3b' },
            { name: 'Keep aside', values: a.host.map(h => h.reserve), color: '#5b4fc9', dashed: true },
            { name: 'Free to use', values: a.host.map(h => h.free), color: '#13a89a' },
        ],
    });
    const save = patch => { Object.assign(prefs, patch); setPref('chitAnalyzer', prefs); };
    body.querySelector('#an-chit').addEventListener('change', e => { save({ chit: Number(e.target.value) }); location.hash = `#/forecast/analyzer/${e.target.value}`; });
    body.querySelector('#an-save').addEventListener('change', e => { save({ savingsRate: Number(e.target.value) || 0 }); renderChitAnalyzer(body, pick.id); });
    body.querySelector('#an-loan').addEventListener('change', e => { save({ loanRate: Number(e.target.value) || 0 }); renderChitAnalyzer(body, pick.id); });
}
