/**
 * Forecast › Lift or hold (#/forecast/lift): when (if ever) to lift each chit still running, by its own terms.
 *
 * Laid out as a list and its detail:
 *   left    the chits: name, organizer, what it pays and when, how far it is paid, the verdict and the cheapest yearly
 *           cost of lifting, and whether its terms are set or still estimated; above them the two yardsticks (what
 *           your money earns, what a loan costs) and a count of each verdict
 *   right   the chosen chit: a head with its facts and verdict; the decision in one sentence; the figures that matter
 *           (best month, what it gives, what it costs a year and in rupees, what holding gives and when, what is still
 *           to pay); the yearly cost of lifting month by month against the yardsticks; holding against lifting in
 *           words; and the chit table (chit-lift-table.js) where the terms are filled in, every change previewed above
 *           before it is saved.
 *
 * Lifting is borrowing from the chit (chit-math.js): its yearly cost below what your money earns, lift; below a loan's
 * rate, the cheaper way to borrow if money is needed; above both, hold.
 */
import { api } from '../core/api.js';
import { esc, emptyState, confirmDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, isoDate } from '../core/format.js';
import { lineChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';
import { can } from '../core/store.js';
import { analyseLift, liftable } from './chit-math.js';
import { mountLiftTable } from './chit-lift-table.js';

const num = v => Number(v || 0);
const VERDICT = {
    LIFT: { label: 'Lift', long: 'Worth lifting', tone: 'warn', iconName: 'arrow-in' },
    HOLD_LIFT_IF_NEEDED: { label: 'Hold · lift if needed', long: 'Hold · lift only if you need money', tone: 'info', iconName: 'clock' },
    HOLD: { label: 'Hold', long: 'Hold to maturity', tone: 'good', iconName: 'check-circle' },
};

export async function renderChitLift(body) {
    body.classList.add('lh-page');
    const prefs = getPref('liftAnalyzer', { investRate: 8, loanRate: 12, open: null });
    const [chits, terms] = await Promise.all([api.get('/chits'), api.get('/chits/lift-terms').catch(() => [])]);
    const running = chits.filter(liftable);
    if (!running.length) { body.classList.remove('lh-page'); body.classList.add('fx-page'); body.innerHTML = emptyState('No chit is running and still to be lifted. Chits you are a member of show here until they pay out.', 'chit'); return; }
    const details = new Map((await Promise.all(running.map(c => api.get(`/chits/${c.id}`)))).map(d => [d.chit.id, d]));
    const termsOf = id => terms.find(t => t.chitId === id) || null;
    const today = isoDate();
    const rates = () => ({ investRate: prefs.investRate, loanRate: prefs.loanRate, today });
    let selected = running.some(c => c.id === prefs.open) ? prefs.open : running[0].id;
    let table = null;   // the mounted chit table ({dirty})

    body.innerHTML = `
        <aside class="panel lh-list">
            <div class="lh-list-head">
                <div class="lh-title">${icon('chit')}<b>Your chits</b><small>${running.length} to decide</small></div>
                <div class="lh-rates">
                    <label title="If you lift and invest the payout, what it earns a year">${icon('trending')}<span>Money earns</span><input type="number" id="lh-invest" min="0" max="40" step="0.5" value="${prefs.investRate}"><i>%</i></label>
                    <label title="What borrowing would cost instead">${icon('bank')}<span>A loan costs</span><input type="number" id="lh-loan" min="0" max="60" step="0.5" value="${prefs.loanRate}"><i>%</i></label>
                </div>
                <div class="lh-counts" id="lh-counts"></div>
            </div>
            <div class="lh-items" id="lh-items"></div>
            <p class="lh-help">${icon('info')}Lifting is borrowing from the chit: below what your money earns, lift; below a loan, lift only if you need money; above both, hold.</p>
        </aside>
        <section class="lh-detail" id="lh-detail">
            <div id="lh-summary"></div>
            <div id="lh-table"></div>
        </section>`;

    const analysisOf = (c, t) => analyseLift(c, details.get(c.id).installments, t === undefined ? termsOf(c.id) : t, rates());

    const drawList = () => {
        const all = running.map(c => ({ c, a: analysisOf(c) }));
        const count = v => all.filter(x => x.a?.verdict === v).length;
        body.querySelector('#lh-counts').innerHTML = ['LIFT', 'HOLD_LIFT_IF_NEEDED', 'HOLD'].map(v => `<span class="lh-count ${VERDICT[v].tone}">${icon(VERDICT[v].iconName)}<b>${count(v)}</b>${VERDICT[v].label}</span>`).join('');
        body.querySelector('#lh-items').innerHTML = all.map(({ c, a }) => {
            const v = VERDICT[a?.verdict || 'HOLD'];
            const paidPct = c.numberOfInstallments ? (c.installmentsPaid / c.numberOfInstallments) * 100 : 0;
            return `<button type="button" class="lh-item ${v.tone} ${c.id === selected ? 'selected' : ''}" data-chit="${c.id}">
                <span class="chip-icon sm gold">${icon('chit-book')}</span>
                <span class="lh-item-main">
                    <span class="lh-item-top"><b>${esc(c.name)}</b><span class="lh-verdict ${v.tone}">${icon(v.iconName)}${v.label}</span></span>
                    <small>${esc(c.organizer || 'Organizer not set')} · ${moneyShort(c.maturityAmount)} on ${date(a?.maturityDate || c.maturityDate)}</small>
                    <span class="lh-prog"><i style="width:${paidPct.toFixed(1)}%"></i></span>
                    <span class="lh-item-foot"><span>${c.installmentsPaid}/${c.numberOfInstallments} paid</span>
                        ${a?.cheapest ? `<span>cheapest ${percent(a.cheapest.rate, 1)} · M${a.cheapest.no}</span>` : '<span>—</span>'}
                        <span class="${a?.estimated ? 'lh-est' : 'lh-set'}">${icon(a?.estimated ? 'alert' : 'check')}${a?.estimated ? 'estimated' : 'terms set'}</span></span>
                </span></button>`;
        }).join('');
    };

    /** The chosen chit's analysis: with its saved terms, or (while the table is being edited) with the changes not saved yet. */
    const drawSummary = preview => {
        const c = running.find(x => x.id === selected);
        const a = analysisOf(c, preview ? preview : undefined);
        const el = body.querySelector('#lh-summary');
        if (!a) { el.innerHTML = emptyState('Nothing left to decide for this chit.', 'chit'); return; }
        const v = VERDICT[a.verdict];
        const best = a.cheapest;
        const M = num(c.maturityAmount);
        const holdPay = a.rows.reduce((s, r) => s + r.regular, 0);
        const headline = a.verdict === 'LIFT' ? `Lift in month ${best.no}, on ${date(best.date)}`
            : a.verdict === 'HOLD_LIFT_IF_NEEDED' ? `Hold. If you need money, lift in month ${best.no}`
                : 'Hold to maturity';
        const why = a.verdict === 'LIFT'
            ? `Lifting then brings ${money(Math.round(best.payout))} and costs ${percent(best.rate, 1)} a year, less than the ${percent(prefs.investRate, 1)} your money earns: about ${money(Math.round(a.bestValue.gainAtInvest))} better than holding, in today’s money.`
            : a.verdict === 'HOLD_LIFT_IF_NEEDED'
                ? `Lifting costs at least ${percent(best.rate, 1)} a year: more than your money earns (${percent(prefs.investRate, 1)}), less than a loan (${percent(prefs.loanRate, 1)}). Waiting pays; if you need money, month ${best.no} gives ${money(Math.round(best.payout))}.`
                : best ? `Even the cheapest month (${best.no}) costs ${percent(best.rate, 1)} a year, more than a loan at ${percent(prefs.loanRate, 1)}. Waiting gives the full ${money(M)} on ${date(a.maturityDate)}.`
                    : `Take the full ${money(M)} on ${date(a.maturityDate)}.`;
        const fig = (iconName, label, value, sub, tone = '') => `<div class="lh-fig ${tone}">${icon(iconName)}<small>${label}</small><b>${value}</b><em>${sub}</em></div>`;
        el.innerHTML = `
            <div class="lh-hero ${v.tone}">
                <div class="lh-hero-head">
                    <span class="lh-hero-mark">${icon('chit-book')}</span>
                    <div class="min-0"><b>${esc(c.name)}</b><small>${esc(c.organizer || '')}${c.ticketNo ? ` · ticket ${esc(c.ticketNo)}` : ''} · ${moneyShort(M)} · ${c.numberOfInstallments} months · ${money(c.monthlyInstallment)} a month</small></div>
                    <span class="spacer"></span>
                    ${preview ? `<span class="lh-preview">${icon('edit')}with your changes, not saved</span>` : ''}
                    <span class="lh-verdict big ${v.tone}">${icon(v.iconName)}${v.long}</span>
                </div>
                <div class="lh-hero-body">
                    <div class="lh-decision"><h2>${headline}</h2><p>${why}</p>
                        ${a.estimated && !preview ? `<p class="lh-warn">${icon('alert')}No chit table yet: the payouts are estimated from the chit’s own rate. Fill in the table below with what this organizer gives in each month.</p>` : ''}</div>
                    <div class="lh-figs">
                        ${fig('flag', best ? 'Cheapest month' : 'Best', best ? `Month ${best.no}` : 'Hold', best ? date(best.date) : 'to maturity')}
                        ${fig('arrow-in', 'You would get', best ? money(Math.round(best.payout)) : '—', best ? `${best.cut > 0.05 ? `−${percent(best.cut, 1)} of ${moneyShort(M)}` : 'the full amount'}` : 'if lifted', 'gold')}
                        ${fig('percent', 'Yearly cost', best ? percent(best.rate, 1) : '—', `you earn ${percent(prefs.investRate, 1)} · loan ${percent(prefs.loanRate, 1)}`, best ? (best.rate < prefs.investRate ? 'warn' : best.rate < prefs.loanRate ? 'info' : 'bad') : '')}
                        ${fig('scale', 'Lifting costs', best ? money(Math.round(best.cost)) : '—', 'maturity given up + extra paid − payout')}
                        ${fig('check-circle', 'If you hold', money(M), `on ${date(a.maturityDate)}`, 'good')}
                        ${fig('calendar', 'Still to pay', money(Math.round(holdPay)), `${c.installmentsPending} installments`)}
                    </div>
                </div>
            </div>
            <div class="lh-two">
                <section class="panel lh-chart-panel">
                    <header class="panel-head"><h3><span class="ico">${icon('trending')}</span>Yearly cost of lifting, month by month</h3></header>
                    <div class="panel-body"><div class="chart lh-chart" id="lh-chart"></div>
                        ${legend([{ label: 'Cost of lifting', color: 'var(--series-2)' }, { label: `Your money earns ${prefs.investRate}%`, color: 'var(--series-3)' }, { label: `A loan ${prefs.loanRate}%`, color: 'var(--series-8)' }], 'line')}
                        <p class="small muted lh-chart-note">Months under the green line are worth lifting; between the lines, only if you need money; above the red line, hold.</p></div>
                </section>
                <section class="panel lh-compare">
                    <header class="panel-head"><h3><span class="ico">${icon('scale')}</span>Holding or lifting</h3></header>
                    <div class="panel-body">
                        <div class="lh-way good"><b>${icon('check-circle')}If you hold</b><span>Pay ${money(Math.round(holdPay))} more over ${c.installmentsPending} months and get <b>${money(M)}</b> on ${date(a.maturityDate)}: ${money(Math.round(M - holdPay))} more than you put in from here.</span></div>
                        ${best ? `<div class="lh-way ${v.tone === 'warn' ? 'warn' : 'info'}"><b>${icon('arrow-in')}If you lift in month ${best.no}</b><span>Get <b>${money(Math.round(best.payout))}</b> on ${date(best.date)}, then pay ${money(Math.round(best.afterLift ?? best.regular))} a month${best.afterLift && best.afterLift > best.regular + 0.5 ? ` (${money(Math.round(best.afterLift - best.regular))} more than now)` : ''} until ${date(a.maturityDate)}. It costs ${money(Math.round(best.cost))} in all: ${percent(best.rate, 1)} a year.</span></div>` : ''}
                        <ul class="lh-facts">
                            ${a.dividend ? `<li>Dividend about ${money(Math.round(a.dividend))} an installment so far</li>` : ''}
                            ${a.from > (a.rows[0]?.no || 1) ? `<li>Lifting allowed from month ${a.from}</li>` : ''}
                            ${a.afterLiftMore ? '<li>After lifting the installment goes up</li>' : ''}
                            <li>${a.months.length} month${a.months.length === 1 ? '' : 's'} left to lift in</li>
                        </ul>
                    </div>
                </section>
            </div>`;
        const priced = a.months.filter(x => x.rate != null && x.no <= c.numberOfInstallments - 2);
        if (priced.length) {
            lineChart(el.querySelector('#lh-chart'), {
                labels: priced.map(x => `M${x.no}`), includeZero: true, format: x => `${Math.round(x * 10) / 10}%`,
                series: [
                    { name: 'Cost of lifting', values: priced.map(x => Math.round(x.rate * 10) / 10), color: 'var(--series-2)' },
                    { name: 'Your money earns', values: priced.map(() => prefs.investRate), color: 'var(--series-3)', dashed: true },
                    { name: 'A loan costs', values: priced.map(() => prefs.loanRate), color: 'var(--series-8)', dashed: true },
                ],
            });
        } else el.querySelector('#lh-chart').innerHTML = emptyState('Too close to maturity to price lifting.', 'trending');
    };

    const drawTable = () => {
        const c = running.find(x => x.id === selected);
        if (!can('MANAGE_CHITS')) { body.querySelector('#lh-table').innerHTML = ''; table = null; return; }
        const others = running.filter(x => x.id !== c.id).map(x => ({ chit: x, detail: details.get(x.id), terms: termsOf(x.id) }));
        table = mountLiftTable(body.querySelector('#lh-table'), c, details.get(c.id), {
            terms: termsOf(c.id), others, prefs: rates(),
            onPreview: t => drawSummary(t),
            onSaved: saved => {
                saved.forEach(st => { const i = terms.findIndex(x => x.chitId === st.chitId); if (i >= 0) terms[i] = st; else terms.push(st); });
                drawList(); drawSummary(); drawTable();
            },
        });
    };

    const select = async id => {
        if (id === selected) return;
        if (table?.dirty() && !await confirmDialog('The chit table has changes not saved. Leave them?', { confirmLabel: 'Leave', danger: false })) return;
        selected = id;
        prefs.open = id;
        setPref('liftAnalyzer', prefs);
        drawList(); drawSummary(); drawTable();
        body.querySelector('#lh-detail').scrollTop = 0;
    };

    drawList(); drawSummary(); drawTable();
    body.addEventListener('click', e => {
        const item = e.target.closest('[data-chit]');
        if (item) select(Number(item.dataset.chit));
    });
    body.addEventListener('change', e => {
        if (e.target.id !== 'lh-invest' && e.target.id !== 'lh-loan') return;
        prefs.investRate = Math.max(0, num(body.querySelector('#lh-invest').value));
        prefs.loanRate = Math.max(0, num(body.querySelector('#lh-loan').value));
        setPref('liftAnalyzer', prefs);
        drawList(); drawSummary();
        if (!table?.dirty()) drawTable();
    });
}
