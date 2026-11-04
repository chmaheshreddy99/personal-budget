/**
 * Forecast › Chit forecast (#/forecast/chitplan): where the chits take your net worth, day by day, and what to watch.
 *
 *   - On a day: pick any date and see the net worth then, with the chits: what they are worth, the installments paid
 *     and the payouts received by then, and the cash they need up to that day.
 *   - Two ways to play them: hold every chit to maturity, or lift as the Lift or hold analyzer advises (chits worth
 *     lifting are lifted in their cheapest month). Optionally with your usual monthly savings added.
 *   - The path: net worth month by month both ways and the chits' value; dues against payouts month by month.
 *   - What happens when: each maturity and lift with its amount and the net worth after it.
 *   - Insights on the running chits: months the dues bunch up against your savings, payouts coming and where to put
 *     them to beat inflation, how each chit's return stands against inflation and a deposit, the dividends so far,
 *     too much with one organizer, overdue installments, and the chits' share of your net worth.
 *
 * A held chit is worth its book value today (its account) and grows at the one steady rate that makes it the maturity
 * amount on its day (chit-math.js valuePath); paying an installment moves money from cash into the chit, so it does not
 * change the net worth; the chit's gain does. A lifted chit turns into its payout and a debt of the installments left.
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDate, isoDate, monthLabel } from '../core/format.js';
import { lineChart, barChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';
import { readQuery, setQuery } from '../core/route.js';
import { analyseLift, liftable, remaining, valuePath, yearsBetween } from './chit-math.js';

const num = v => Number(v || 0);
const addMonths = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setMonth(d.getMonth() + n); return isoDate(d); };
const monthEnd = iso => { const d = new Date(iso + 'T00:00:00'); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

export async function renderChitForecast(body) {
    body.classList.add('fx-page');
    const prefs = getPref('chitForecast', { plan: 'hold', savings: false, on: null, inflation: 6 });
    // #/forecast/chitplan?plan=advised&savings=1&on=2028-03-31&inflation=6
    const asked = readQuery();
    if (asked.get('plan')) prefs.plan = asked.get('plan');
    if (asked.has('savings')) prefs.savings = asked.get('savings') === '1';
    if (asked.get('on')) prefs.on = asked.get('on');
    if (asked.get('inflation')) prefs.inflation = Number(asked.get('inflation')) || 0;
    const remember = () => setQuery({ plan: prefs.plan, savings: prefs.savings ? '1' : '0', on: prefs.on, inflation: prefs.inflation });
    const lift = getPref('liftAnalyzer', { investRate: 8, loanRate: 12 });
    const [chits, terms, sheet, plan] = await Promise.all([
        api.get('/chits'), api.get('/chits/lift-terms').catch(() => []), api.get('/reports/balance-sheet').catch(() => null),
        api.get('/reports/investment-plan').catch(() => null),
    ]);
    const open = chits.filter(c => c.status !== 'CLOSED' && (liftable(c) || num(c.stillToPay) > 0 || num(c.payoutPending) > 0));
    if (!open.length) { body.innerHTML = emptyState('No chit is running. Chits you are a member of show here until they finish.', 'chit'); return; }
    const details = new Map((await Promise.all(open.map(c => api.get(`/chits/${c.id}`)))).map(d => [d.chit.id, d]));
    const today = isoDate();
    const nw0 = num(sheet?.netWorth);
    const surplus = Math.max(0, num(plan?.profile?.surplus));

    // every chit's future, both ways
    const models = open.map(c => {
        const d = details.get(c.id);
        const t = terms.find(x => x.chitId === c.id) || null;
        const r = remaining(c, d.installments, t);
        const a = liftable(c) ? analyseLift(c, d.installments, t, { ...lift, today }) : null;
        const vp = liftable(c) ? valuePath(c, r.rows, r.maturityDate, today) : null;
        return { c, t, r, a, vp, liftAt: a && a.verdict === 'LIFT' ? a.cheapest : null };
    });
    const lastDay = models.reduce((m, x) => (x.r.maturityDate > m ? x.r.maturityDate : m), today);

    /** Net worth, cash in and out and the chits' value on a day, playing the chits one way. */
    const stateOn = (day, way) => {
        let gain = 0, chitValue = 0, paid = 0, received = 0;
        for (const x of models) {
            const { c, r, vp } = x;
            const lifted = way === 'advised' && x.liftAt;
            const book = num(c.accountBalance ?? c.paidIn);
            const paidRows = r.rows.filter(row => row.date <= day);
            if (!vp) {
                // already paid out (still paying), or a payout still to come in parts: cash moves, the net worth does not
                const left = num(c.payoutPending);
                if (left && c.maturityDate && c.maturityDate <= day) received += left;
                paid += paidRows.reduce((s, row) => s + row.regular, 0);
                continue;
            }
            if (lifted && x.liftAt.date <= day) {
                const before = r.rows.filter(row => row.no <= x.liftAt.no);
                const after = r.rows.filter(row => row.no > x.liftAt.no);
                // at the lift the chit becomes its payout and a debt of what is left to pay; the installments paid before it
                // only moved cash into the chit
                const owe = row => x.liftAt.afterEach ?? row.after;   // what is paid each month after this lift
                gain += x.liftAt.payout - after.reduce((s, row) => s + owe(row), 0) - book - before.reduce((s, row) => s + row.regular, 0);
                received += x.liftAt.payout;
                paid += before.reduce((s, row) => s + row.regular, 0) + after.filter(row => row.date <= day).reduce((s, row) => s + owe(row), 0);
                chitValue -= after.filter(row => row.date > day).reduce((s, row) => s + owe(row), 0);
                continue;
            }
            const contributed = paidRows.reduce((s, row) => s + row.regular, 0);
            paid += contributed;
            if (r.maturityDate <= day) {
                gain += num(c.maturityAmount) - book - contributed;
                received += num(c.maturityAmount);
            } else {
                const v = vp.value(day);
                gain += v - book - contributed;
                chitValue += v;
            }
        }
        const saved = prefs.savings ? surplus * Math.max(0, yearsBetween(today, day) * 12) : 0;
        return { netWorth: nw0 + gain + saved, gain, chitValue, paid, received, saved };
    };

    // the path, month by month, to the last maturity (at most 10 years)
    const months = [];
    for (let k = 0; k <= 120; k++) {
        const d = k === 0 ? today : monthEnd(addMonths(today.slice(0, 7) + '-01', k));
        months.push(d);
        if (d >= lastDay) break;
    }
    const pathHold = months.map(d => stateOn(d, 'hold'));
    const pathAdv = months.map(d => stateOn(d, 'advised'));
    const anyLift = models.some(x => x.liftAt);

    const draw = () => {
        const way = prefs.plan === 'advised' && anyLift ? 'advised' : 'hold';
        const on = prefs.on && prefs.on >= today ? prefs.on : addMonths(today, 6);
        const s = stateOn(on, way);
        const now = stateOn(today, way);
        const insights = insightsFor(models, { today, surplus, nw0, inflation: prefs.inflation, lift, sheet });
        const timeline = eventsList(models, way, stateOn);
        body.innerHTML = `
            <div class="fx-toolbar">
                <span class="seg-chips sm" id="cf-plan">
                    <button class="seg-chip ${way === 'hold' ? 'active' : ''}" data-plan="hold">${icon('clock')}Hold every chit</button>
                    <button class="seg-chip ${way === 'advised' ? 'active' : ''}" data-plan="advised" ${anyLift ? '' : 'disabled title="No chit is worth lifting at your rates (Lift or hold)"'}>${icon('arrow-in')}Lift as advised</button>
                </span>
                <label class="switch" title="Add your usual savings each month (${money(Math.round(surplus))}, from the last months)"><input type="checkbox" id="cf-savings" ${prefs.savings ? 'checked' : ''}><span></span>With my usual savings${surplus ? ` (${moneyShort(surplus)}/month)` : ''}</label>
                <label class="fx-rate">${icon('calendar')}Net worth on <input type="date" id="cf-on" min="${today}" max="${lastDay}" value="${on}"></label>
                <label class="fx-rate" title="For the insights: what prices rise a year">${icon('trending')}Inflation <input type="number" id="cf-infl" min="0" max="20" step="0.5" value="${prefs.inflation}"><span>%</span></label>
            </div>
            <div class="fx-answer">
                <div class="fx-answer-main"><small>On ${date(on)} your net worth would be</small><b>${money(Math.round(s.netWorth))}</b>
                    <em class="${s.netWorth >= now.netWorth ? 'pos' : 'neg'}">${s.netWorth >= now.netWorth ? '▲' : '▼'} ${money(Math.abs(Math.round(s.netWorth - now.netWorth)))} from today${s.saved ? `, ${moneyShort(s.saved)} of it your savings` : ''}</em></div>
                <div class="fx-answer-part"><small>Chits worth then</small><b>${money(Math.round(s.chitValue))}</b><em>${s.chitValue < 0 ? 'owed on lifted chits' : 'value with their gain so far'}</em></div>
                <div class="fx-answer-part"><small>Gain from the chits</small><b class="${s.gain >= 0 ? 'pos' : 'neg'}">${money(Math.round(s.gain))}</b><em>by then, over what was put in</em></div>
                <div class="fx-answer-part"><small>Installments paid by then</small><b>${money(Math.round(s.paid))}</b><em>cash going out</em></div>
                <div class="fx-answer-part"><small>Payouts by then</small><b>${money(Math.round(s.received))}</b><em>cash coming in</em></div>
                <div class="fx-answer-part"><small>Cash the chits need</small><b class="${s.paid - s.received > 0 ? 'neg' : 'pos'}">${money(Math.round(Math.abs(s.paid - s.received)))}</b><em>${s.paid - s.received > 0 ? 'out, net, until then' : 'in, net, until then'}</em></div>
            </div>
            <div class="fx-two">
                ${panel({ title: 'Net worth with your chits', iconName: 'trending', sub: `today ${moneyShort(nw0)} → ${moneyShort(pathHold[pathHold.length - 1].netWorth)} on ${shortDate(months[months.length - 1])} holding`,
                    body: `<div class="chart fx-chart" id="cf-nw"></div>${legend([{ label: 'Holding every chit', color: 'var(--series-1)' }, ...(anyLift ? [{ label: 'Lifting as advised', color: 'var(--series-2)' }] : [])], 'line')}` })}
                ${panel({ title: 'Dues and payouts', iconName: 'calendar', sub: 'cash month by month',
                    body: `<div class="chart fx-chart" id="cf-flow"></div>${legend([{ label: 'Installments', color: 'var(--series-8)' }, { label: 'Payouts', color: 'var(--series-3)' }])}` })}
            </div>
            <div class="fx-two">
                ${panel({ title: 'Insights on your chits', iconName: 'sparkles', sub: `${insights.length} things to know`, body: `<div class="fx-insights">${insights.map(insightHtml).join('')}</div>` })}
                ${panel({ title: 'What happens when', iconName: 'timeline', sub: way === 'advised' ? 'lifting as advised' : 'holding every chit', bodyClass: 'flush', body: timeline })}
            </div>`;
        const labels = months.map(d => d.slice(0, 7));
        lineChart(body.querySelector('#cf-nw'), {
            labels, labelFormat: monthLabel, format: moneyShort,
            series: [
                { name: 'Holding every chit', values: pathHold.map(p => Math.round(p.netWorth)), color: 'var(--series-1)' },
                ...(anyLift ? [{ name: 'Lifting as advised', values: pathAdv.map(p => Math.round(p.netWorth)), color: 'var(--series-2)', dashed: true }] : []),
            ],   // net worth alone, so the axis zooms to it and the chits' gain shows (their value is in the figures above)
        });
        const flow = monthlyFlows(models, way, months);
        barChart(body.querySelector('#cf-flow'), {
            labels: flow.map(f => f.month), labelFormat: monthLabel, format: moneyShort,
            series: [{ name: 'Installments', values: flow.map(f => Math.round(f.out)), color: 'var(--series-8)' }, { name: 'Payouts', values: flow.map(f => Math.round(f.in)), color: 'var(--series-3)' }],
        });
    };
    draw();

    body.addEventListener('click', e => {
        const p = e.target.closest('[data-plan]');
        if (p && !p.disabled) { prefs.plan = p.dataset.plan; remember(); setPref('chitForecast', prefs); draw(); }
    });
    body.addEventListener('change', e => {
        if (e.target.id === 'cf-savings') prefs.savings = e.target.checked;
        else if (e.target.id === 'cf-on') prefs.on = e.target.value || null;
        else if (e.target.id === 'cf-infl') prefs.inflation = Math.max(0, Number(e.target.value) || 0);
        else return;
        remember();
        setPref('chitForecast', prefs);
        draw();
    });
}

/** Installments out and payouts in, month by month, playing the chits one way. */
function monthlyFlows(models, way, months) {
    const by = new Map(months.map(d => [d.slice(0, 7), { month: d.slice(0, 7), out: 0, in: 0 }]));
    const add = (dateIso, k, v) => { const b = by.get(dateIso.slice(0, 7)); if (b) b[k] += v; };
    for (const x of models) {
        const lifted = way === 'advised' && x.liftAt;
        x.r.rows.forEach(row => add(row.date, 'out', lifted && row.no > x.liftAt.no ? (x.liftAt.afterEach ?? row.after) : row.regular));
        if (lifted) add(x.liftAt.date, 'in', x.liftAt.payout);
        else if (x.vp) add(x.r.maturityDate, 'in', num(x.c.maturityAmount));
        else if (num(x.c.payoutPending) && x.c.maturityDate) add(x.c.maturityDate, 'in', num(x.c.payoutPending));
    }
    return [...by.values()];
}

function eventsList(models, way, stateOn) {
    const events = [];
    for (const x of models) {
        const lifted = way === 'advised' && x.liftAt;
        if (lifted) events.push({ date: x.liftAt.date, kind: 'lift', title: `Lift ${x.c.name}`, amount: x.liftAt.payout,
            detail: `month ${x.liftAt.no} · then ${money(Math.round(x.liftAt.afterLift || 0))} a month · costs ${percent(x.liftAt.rate, 1)} a year` });
        else if (x.vp) events.push({ date: x.r.maturityDate, kind: 'mature', title: `${x.c.name} matures`, amount: num(x.c.maturityAmount),
            detail: `${x.c.numberOfInstallments} months · ${moneyShort(num(x.c.maturityAmount) - num(x.c.totalContribution) + num(x.c.dividendsEarned))} over the installments` });
        const last = x.r.rows[x.r.rows.length - 1];
        if (last && !x.vp) events.push({ date: last.date, kind: 'done', title: `${x.c.name}: last installment`, amount: -last.regular, detail: 'already paid out: the dues end' });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    if (!events.length) return emptyState('Nothing ahead.', 'timeline');
    return `<div class="fx-events">${events.map(e => {
        const s = stateOn(e.date, way);
        return `<div class="fx-event ${e.kind}"><span class="fx-event-date"><b>${shortDate(e.date)}</b><small>${e.date.slice(0, 4)}</small></span>
            <span class="fx-event-dot">${icon(e.kind === 'lift' ? 'arrow-in' : e.kind === 'mature' ? 'check-circle' : 'flag')}</span>
            <span class="min-0"><b>${esc(e.title)}</b><small>${e.detail}</small></span>
            <span class="fx-event-amt"><b class="${e.amount >= 0 ? 'pos' : ''}">${e.amount >= 0 ? '+' : '−'}${money(Math.abs(Math.round(e.amount)))}</b><small>net worth ${moneyShort(s.netWorth)}</small></span></div>`;
    }).join('')}</div>`;
}

const insightHtml = i => `<div class="fx-insight ${i.tone}">${icon(i.icon)}<div><b>${i.title}</b><p>${i.text}</p></div></div>`;

/** What is worth knowing about the running chits, most pressing first. */
function insightsFor(models, { today, surplus, nw0, inflation, lift, sheet }) {
    const out = [];
    const running = models.filter(x => x.vp);
    // dues bunching up against the usual savings, in the next 12 months
    const flows = monthlyFlows(models, 'hold', Array.from({ length: 12 }, (_, k) => monthEnd(addMonths(today.slice(0, 7) + '-01', k))));
    if (surplus > 0) {
        const tight = flows.filter(f => f.out > surplus);
        if (tight.length) {
            const worst = tight.reduce((a, b) => (b.out > a.out ? b : a));
            out.push({ tone: 'bad', icon: 'alert', title: `Dues above your savings in ${tight.length} of the next 12 months`,
                text: `Chit installments come to ${money(Math.round(worst.out))} in ${monthLabel(worst.month)}, against ${money(Math.round(surplus))} you usually save a month. Keep ${money(Math.round(tight.reduce((s, f) => s + f.out - surplus, 0)))} aside in a liquid fund or sweep deposit to cover them.` });
        } else {
            const peak = flows.reduce((a, b) => (b.out > a.out ? b : a), flows[0]);
            out.push({ tone: 'good', icon: 'check-circle', title: 'Your savings cover the dues', text: `The highest month is ${monthLabel(peak.month)} at ${money(Math.round(peak.out))}, within the ${money(Math.round(surplus))} you usually save.` });
        }
    }
    // payouts coming: where to put them
    const soon = running.filter(x => yearsBetween(today, x.r.maturityDate) <= 0.5).sort((a, b) => a.r.maturityDate.localeCompare(b.r.maturityDate));
    if (soon.length) {
        const total = soon.reduce((s, x) => s + num(x.c.maturityAmount), 0);
        out.push({ tone: 'info', icon: 'calendar', title: `${money(total)} comes back in the next 6 months`,
            text: `${soon.map(x => `${esc(x.c.name)} on ${shortDate(x.r.maturityDate)}`).join(', ')}. Plan where it goes before it lands: in a savings account it earns about 3% and loses to ${inflation}% inflation; a deposit or a debt fund keeps pace, an index fund (for money not needed for 5+ years) beats it. Clearing a loan above 10% is a sure return too.` });
    }
    // each chit's return against inflation and a deposit
    for (const x of running) {
        const rate = num(x.c.impliedAnnualRate || x.c.rateUsed);
        if (!rate) continue;
        const real = ((1 + rate / 100) / (1 + inflation / 100) - 1) * 100;
        if (rate < inflation) out.push({ tone: 'bad', icon: 'trending', title: `${esc(x.c.name)} loses to inflation`,
            text: `It returns about ${percent(rate, 1)} a year, ${percent(real, 1)} after ${inflation}% inflation. ${x.a && x.a.cheapest ? `Lifting in month ${x.a.cheapest.no} costs ${percent(x.a.cheapest.rate, 1)}: see Lift or hold.` : 'Avoid joining another like it.'}` });
        else if (rate < lift.investRate) out.push({ tone: 'warn', icon: 'scale', title: `${esc(x.c.name)} earns less than your money could`,
            text: `About ${percent(rate, 1)} a year (${percent(real, 1)} real), below the ${percent(lift.investRate, 1)} you set for investing. Keep paying (dropping out costs more), but compare before the next chit.` });
    }
    const best = running.filter(x => num(x.c.impliedAnnualRate) > 0).sort((a, b) => num(b.c.impliedAnnualRate) - num(a.c.impliedAnnualRate))[0];
    if (best && num(best.c.impliedAnnualRate) >= inflation) out.push({ tone: 'good', icon: 'trending', title: `${esc(best.c.name)} is your best chit`,
        text: `About ${percent(num(best.c.impliedAnnualRate), 1)} a year, ${percent(((1 + num(best.c.impliedAnnualRate) / 100) / (1 + inflation / 100) - 1) * 100, 1)} above inflation, with ${moneyShort(num(best.c.projectedNetGain))} expected at maturity.` });
    // lifting worth it
    const liftNow = running.filter(x => x.a && x.a.verdict === 'LIFT');
    if (liftNow.length) out.push({ tone: 'warn', icon: 'arrow-in', title: `${liftNow.length === 1 ? 'A chit is' : `${liftNow.length} chits are`} worth lifting`,
        text: liftNow.map(x => `${esc(x.c.name)}: month ${x.a.cheapest.no} (${shortDate(x.a.cheapest.date)}), ${moneyShort(x.a.cheapest.payout)} at ${percent(x.a.cheapest.rate, 1)} a year`).join('; ') + `, less than your money earns at ${percent(lift.investRate, 1)}.` });
    const guessed = running.filter(x => x.a && x.a.estimated);
    if (guessed.length) out.push({ tone: 'info', icon: 'edit', title: `Set the lift terms of ${guessed.length} chit${guessed.length === 1 ? '' : 's'}`,
        text: `${guessed.map(x => esc(x.c.name)).join(', ')}: what lifting early pays and what is paid after are estimated. Ask the organizer for the chart and enter it in Lift or hold.` });
    // dividends
    const dividends = models.reduce((s, x) => s + num(x.c.dividendsEarned), 0);
    const paidIn = models.reduce((s, x) => s + num(x.c.paidIn), 0);
    if (dividends > 0) out.push({ tone: 'good', icon: 'coins', title: `${money(Math.round(dividends))} in dividends so far`,
        text: `${percent(paidIn ? dividends / (paidIn + dividends) * 100 : 0, 1)} off what the installments would have been. Dividends fall as a chit runs (fewer bidders): budget the later installments at close to the full amount.` });
    // one organizer
    const byOrg = new Map();
    running.forEach(x => { const k = (x.c.organizer || 'Unknown').trim(); byOrg.set(k, (byOrg.get(k) || 0) + num(x.c.maturityAmount)); });
    const total = [...byOrg.values()].reduce((s, v) => s + v, 0);
    const [org, amt] = [...byOrg.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (org && byOrg.size >= 1 && total && amt / total > 0.6 && running.length > 1) out.push({ tone: 'warn', icon: 'shield', title: `${percent(amt / total * 100, 0)} of your chits are with ${esc(org)}`,
        text: `${money(amt)} at maturity rests on one organizer. Check it is registered under the Chit Funds Act (a registration number, a security deposit with the Registrar) and spread new chits across organizers.` });
    // overdue
    const overdue = models.filter(x => num(x.c.overdueAmount) > 0);
    if (overdue.length) out.push({ tone: 'bad', icon: 'alert', title: `${money(overdue.reduce((s, x) => s + num(x.c.overdueAmount), 0))} overdue`,
        text: `${overdue.map(x => `${esc(x.c.name)} (${x.c.overdueCount})`).join(', ')}. Late installments draw penalty interest and can cost a prized member their payout; pay them first.` });
    // share of net worth
    const value = running.reduce((s, x) => s + x.vp.value(today), 0);
    if (nw0 > 0 && value / nw0 > 0.35) out.push({ tone: 'warn', icon: 'pie', title: `Chits are ${percent(value / nw0 * 100, 0)} of your net worth`,
        text: 'That is a lot in one kind of saving that cannot be drawn without lifting at a cut. Keep new money in deposits and funds until chits are under a third.' });
    const order = { bad: 0, warn: 1, info: 2, good: 3 };
    return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
