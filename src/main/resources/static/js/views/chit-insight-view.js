/**
 * Chits › a chit › Lift or hold tab: chit-insight.js's models, laid out to decide. Over every view, the yardsticks (what
 * your money earns, a loan, inflation, how much returns swing, the organizer's risk; saved for every chit) and four views:
 *   Overview            the verdict and how sure it is; hold against lifting side by side; the lifting window; what to do
 *   Month by month      every month that can be lifted: what it gives, costs, is worth today and at maturity; two charts
 *   Odds & risk         the Monte Carlo and its spread; lifting's worth by month and rate (heat map); lift or borrow;
 *                       the organizer's risk
 *   Dividends & returns the chit's lifetime return; the dividends, their trend with its 80% band, the next installments
 * The chit table holds the terms; its button opens it over the tab.
 */
import { icon } from '../core/icons.js';
import { esc } from '../core/ui.js';
import { money, moneyShort, percent, date, shortDate } from '../core/format.js';
import { lineChart, barChart, legend } from '../core/charts.js';

const VERDICT = {
    LIFT: ['Worth lifting', 'warn', 'arrow-in'],
    HOLD_LIFT_IF_NEEDED: ['Hold · lift only if you need money', 'info', 'clock'],
    HOLD: ['Hold to maturity', 'good', 'check-circle'],
};
const SAY = { LIFT: ['Lift', 'warn'], IF_NEEDED: ['If needed', 'info'], HOLD: ['Hold', 'good'], LATE: ['Too late', 'muted'] };
const VIEWS = [['overview', 'Overview', 'target'], ['months', 'Month by month', 'calendar'], ['odds', 'Odds & risk', 'sparkles'], ['returns', 'Dividends & returns', 'percent']];

const signed = v => `${v >= 0 ? '+' : '−'}${money(Math.abs(Math.round(v)))}`;
const signedShort = v => `${v >= 0 ? '+' : '−'}${moneyShort(Math.abs(v))}`;
const card = (title, iconName, body, cls = '', sub = '') => `<section class="ci-card ${cls}"><h4>${icon(iconName)}${title}${sub ? `<small>${sub}</small>` : ''}</h4>${body}</section>`;
const fig = (k, v, s = '', t = '') => `<div class="ci-fig ${t}"><small>${k}</small><b>${v}</b>${s ? `<em>${s}</em>` : ''}</div>`;

export function liftTabHtml(c, installments, ins, y, canEdit) {
    if (!ins) return '<div class="empty">Nothing left to decide: the chit is paid out or finished.</div>';
    const view = VIEWS.some(v => v[0] === y.view) ? y.view : 'overview';
    const body = { overview, months: monthsView, odds: oddsView, returns: returnsView }[view](c, installments, ins, y);
    return `
    <div class="ci">
        <div class="ci-bar">
            <span class="ci-bar-title">${icon('settings')}Yardsticks</span>
            <label title="What the money earns if you lift and invest it">Money earns <input type="number" data-ci="investRate" value="${y.investRate}" step="0.5" min="0" max="40">%</label>
            <label title="What borrowing the money would cost instead">A loan costs <input type="number" data-ci="loanRate" value="${y.loanRate}" step="0.5" min="0" max="60">%</label>
            <label>Inflation <input type="number" data-ci="inflation" value="${y.inflation}" step="0.5" min="0" max="20">%</label>
            <label title="How much the return on the payout can swing a year, for the simulation">Swing ± <input type="number" data-ci="volatility" value="${y.volatility}" step="0.5" min="0" max="30">%</label>
            <label title="Your guess of the yearly chance the organizer fails to pay: what holding risks">Organizer risk <input type="number" data-ci="risk" value="${y.risk}" step="0.5" min="0" max="30">%</label>
            <span class="spacer"></span>
            ${canEdit ? `<button type="button" class="btn sm ${ins.a.estimated ? 'primary' : ''}" data-act="chit-table">${icon('list')}${ins.a.estimated ? 'Fill the chit table' : 'Chit table'}</button>` : ''}
        </div>
        <div class="ci-views seg-chips sm">${VIEWS.map(([k, l, i]) => `<button type="button" class="seg-chip ${k === view ? 'active' : ''}" data-ci-view="${k}">${icon(i)}${l}</button>`).join('')}</div>
        ${ins.a.estimated ? `<div class="ci-est-bar">${icon('alert')}<span>The payouts are <b>estimated</b> from the chit’s own rate. Fill in the chit table with the organizer’s figures for an exact answer.</span></div>` : ''}
        ${body}
    </div>`;
}

// ===================================================================== Overview

function overview(c, installments, ins, y) {
    const { a, simulation: sim, compare, window: win, confidence: conf } = ins;
    const [label, tone, ico] = VERDICT[a.verdict];
    const best = a.cheapest;
    const head = a.verdict === 'LIFT' ? `Lift in month ${best.no} (${date(best.date)})` : a.verdict === 'HOLD_LIFT_IF_NEEDED' ? `Hold. If you need money, lift in month ${best.no}` : 'Hold to maturity';
    const cols = [['Hold to maturity', compare.hold, 'good'], compare.best && [`Lift in month ${compare.best.no}${compare.best.no === best?.no ? ' · cheapest' : ''}`, compare.best, 'warn'],
        compare.first && [`Lift in month ${compare.first.no} · first chance`, compare.first, 'info']].filter(Boolean);
    const row = (k, fn, hint = '') => `<tr><th ${hint ? `title="${esc(hint)}"` : ''}>${k}</th>${cols.map(([, x]) => `<td class="r">${fn(x)}</td>`).join('')}</tr>`;
    return `
        <div class="ci-hero ${tone}">
            <div class="ci-hero-main">
                <div class="ci-hero-tags"><span class="ci-verdict ${tone}">${icon(ico)}${label}</span>
                    ${conf ? `<span class="ci-conf ${conf.label.toLowerCase()}" title="${esc(conf.why)}">${icon('shield')}${conf.label} confidence <i><em style="width:${conf.score}%"></em></i></span>` : ''}</div>
                <h3>${head}</h3>
                <p>${best ? `The cheapest month to lift is ${best.no}: you get ${money(Math.round(best.payout))}, and it costs ${percent(best.rate, 1)} a year. Your money earns ${percent(y.investRate, 1)}; a loan costs ${percent(y.loanRate, 1)}.` : `Take the full ${money(ins.M)} on ${date(ins.maturityDate)}.`}</p>
                ${conf ? `<p class="ci-why">${icon('info')}${esc(conf.why)}.</p>` : ''}
            </div>
            <div class="ci-hero-figs">
                ${fig('Break-even rate', best ? percent(best.rate, 1) : '—', 'your money must earn more to lift', best && best.rate < y.investRate ? 'warn' : 'good')}
                ${fig('You would get', best ? money(Math.round(best.payout)) : '—', best ? `month ${best.no} · ${percent(best.cut, 1)} cut` : '')}
                ${fig('If you hold', money(ins.M), date(ins.maturityDate), 'good')}
                ${fig('Chance lifting wins', sim ? `${Math.round(sim.chance * 100)}%` : '—', sim ? `${sim.runs.toLocaleString('en-IN')} simulated futures` : '', sim ? (sim.chance > 0.6 ? 'warn' : sim.chance < 0.4 ? 'good' : 'info') : '')}
            </div>
        </div>
        <div class="ci-grid">
            ${card('Hold or lift, side by side', 'scale', `
                <table class="grid compact ci-compare"><thead><tr><th></th>${cols.map(([l, , t]) => `<th class="r"><span class="ci-col ${t}">${l}</span></th>`).join('')}</tr></thead><tbody>
                    ${row('You receive', x => `<b>${money(Math.round(x.get))}</b><small>${shortDate(x.getDate)}</small>`)}
                    ${row('Still to pay after', x => money(Math.round(x.still)), 'Installments after you receive the money (after lifting, at the after-lift amount)')}
                    ${row('Paid in from today', x => money(Math.round(x.out)))}
                    ${row('Lifting costs', x => (x.cost != null ? `${money(Math.round(x.cost))}<small>${percent(x.rate ?? 0, 1)} a year</small>` : '—'), 'Maturity amount + the extra paid after − the payout')}
                    ${row(`Worth at maturity at ${y.investRate}%`, x => `<b>${money(Math.round(x.atMaturity))}</b>`, 'The payout invested at your rate until maturity, less the extra paid after (each grown too)')}
                    ${row('Against holding, today', x => (x.edge ? `<span class="${x.today >= 0 ? 'pos' : 'neg'}">${signed(x.today)}</span>` : '—'), 'The difference in today’s money, at your rate')}
                </tbody></table>
                <p class="ci-note">Worth at maturity: what each choice leaves you with on ${date(ins.maturityDate)}, with any money received early invested at ${y.investRate}%.</p>`, 'ci-wide')}
            ${card('The lifting window', 'calendar', `
                <div class="ci-strip">${ins.perMonth.map(x => `<span class="ci-cell ${SAY[x.say][1]} ${x.no === best?.no ? 'best' : ''}" title="Month ${x.no} · ${shortDate(x.date)}: get ${money(Math.round(x.payout))}${x.rate != null ? `, ${percent(x.rate, 1)} a year` : ''}">${x.no}</span>`).join('')}</div>
                ${legend([{ label: `Worth lifting (< ${y.investRate}%)`, color: '#e59a1d' }, { label: `Cheaper than a loan (< ${y.loanRate}%)`, color: '#2d8fd5' }, { label: 'Better to hold', color: '#11a35a' }, { label: 'Too close to maturity', color: '#b8c4cf' }])}
                <div class="ci-figs">
                    ${fig('Worth lifting in', win.lift ? `month ${win.lift}` : 'no month', `money earns ${y.investRate}%`, win.lift ? 'warn' : 'good')}
                    ${fig('Cheaper than a loan in', win.needed ? `month ${win.needed}` : 'no month', `loan at ${y.loanRate}%`, win.needed ? 'info' : '')}
                </div>`)}
            ${card('What to do', 'bulb', `<div class="ci-tips">${ins.tips.map(t => `<div class="ci-tip ${t.tone}">${icon(t.icon)}<span>${esc(t.text)}</span></div>`).join('')}</div>`)}
        </div>`;
}

// ===================================================================== Month by month

function monthsView(c, installments, ins, y) {
    const best = ins.a.cheapest;
    return `
        <div class="ci-grid">
            ${card('Yearly cost of lifting', 'arrow-in', `
                <div class="chart ci-chart" data-ci-chart="rate"></div>
                ${legend([{ label: 'Yearly cost of lifting', color: 'var(--series-2)' }, { label: `Money earns ${y.investRate}%`, color: 'var(--series-3)' }, { label: `Loan ${y.loanRate}%`, color: 'var(--series-8)' }], 'line')}
                <p class="ci-note">${ins.waiting?.rate != null ? `Waiting from month ${ins.waiting.from} to ${ins.waiting.to} adds ${money(Math.round(ins.waiting.rise))} to the payout: about <b>${percent(ins.waiting.rate, 1)}</b> a year for that month. ` : ''}Under the green line lifting pays; between the lines only if you need money.</p>`)}
            ${card('Ahead or behind at maturity', 'target', `
                <div class="chart ci-chart" data-ci-chart="edge"></div>
                <p class="ci-note">For each month: lifting then and investing the payout at ${y.investRate}%, against holding, on ${date(ins.maturityDate)}. Above zero lifting leaves you with more.</p>`)}
            ${card('Every month, in detail', 'list', `
                <div class="ci-scroll"><table class="grid compact dense ci-months">
                    <thead><tr><th class="c">Month</th><th>On</th><th class="r">You get</th><th class="r">Cut</th><th class="r">Then pay</th><th class="r">Lifting costs</th>
                        <th class="r">Yearly cost</th><th class="r" title="Against holding, in today’s money at your rate">Worth today</th><th class="r" title="Against holding, on the maturity date">At maturity</th><th>Verdict</th></tr></thead>
                    <tbody>${ins.perMonth.map(x => `<tr class="${x.no === best?.no ? 'ci-best' : ''} ${x.say === 'LATE' ? 'ci-late' : ''}">
                        <td class="c"><b>${x.no}</b></td><td>${shortDate(x.date)}</td>
                        <td class="r"><b>${money(Math.round(x.payout))}</b></td><td class="r muted">${percent(x.cut, 1)}</td>
                        <td class="r">${x.afterLift != null ? money(Math.round(x.afterLift)) : '—'}</td>
                        <td class="r">${money(Math.round(x.cost))}</td>
                        <td class="r"><span class="lf-rate ${x.rate == null ? '' : x.rate < y.investRate ? 'lf-cheap' : x.rate < y.loanRate ? 'lf-mid' : 'lf-dear'}">${x.rate == null ? '—' : percent(x.rate, 1)}</span></td>
                        <td class="r ${x.gainAtInvest >= 0 ? 'pos' : 'neg'}">${signedShort(x.gainAtInvest)}</td>
                        <td class="r ${x.edge >= 0 ? 'pos' : 'neg'}">${signedShort(x.edge)}</td>
                        <td><span class="ci-say ${SAY[x.say][1]}">${x.no === best?.no ? '★ ' : ''}${SAY[x.say][0]}</span></td></tr>`).join('')}</tbody>
                </table></div>
                <p class="ci-note">Lifting costs: the maturity amount given up plus the extra paid after, less the payout. Yearly cost: that as a rate (IRR) — lift only when your money earns more.</p>`, 'ci-wide')}
        </div>`;
}

// ===================================================================== Odds & risk

function oddsView(c, installments, ins, y) {
    const { simulation: sim, trend, heat, borrow, risk } = ins;
    const max = Math.max(1, ...heat.cells.flat().map(Math.abs));
    const shade = v => `background:${v >= 0 ? `rgba(229,154,29,${(0.12 + 0.5 * Math.abs(v) / max).toFixed(2)})` : `rgba(17,163,90,${(0.08 + 0.4 * Math.abs(v) / max).toFixed(2)})`}`;
    return `
        <div class="ci-grid">
            ${card('The odds', 'sparkles', sim ? `
                <div class="ci-meter"><i style="width:${Math.round(sim.chance * 100)}%"></i><span>${Math.round(sim.chance * 100)}% lifting wins · ${100 - Math.round(sim.chance * 100)}% holding wins</span></div>
                <div class="ci-figs four">
                    ${fig('Poor case · P10', signed(sim.p10), '', sim.p10 >= 0 ? 'good' : 'bad')}
                    ${fig('Middle · P50', signed(sim.p50), '', sim.p50 >= 0 ? 'good' : 'bad')}
                    ${fig('Good case · P90', signed(sim.p90), '', sim.p90 >= 0 ? 'good' : 'bad')}
                    ${fig('Average', signed(sim.mean), 'expected value')}
                </div>
                <div class="chart ci-chart sm" data-ci-chart="hist"></div>
                <p class="ci-note">Monte Carlo: ${sim.runs.toLocaleString('en-IN')} futures for lifting in month ${sim.month}, the dividends to come drawn around their trend (±${money(Math.round(trend.sigma))}) and the payout’s return around ${y.investRate}% (±${y.volatility}%). Each bar counts the futures by what lifting was worth over holding, in today’s money.</p>`
                : '<p class="ci-note">No month left that can be priced.</p>')}
            ${card('Lifting’s worth by month and rate', 'scale', heat.months.length ? `
                <div class="ci-scroll"><table class="grid compact dense ci-heat"><thead><tr><th>Money earns</th>${heat.months.map(m => `<th class="r">M${m}</th>`).join('')}</tr></thead>
                    <tbody>${heat.rates.map((rate, ri) => `<tr class="${rate === y.investRate ? 'ci-now' : ''}"><th>${rate}%</th>${heat.cells[ri].map(v => `<td class="r" style="${shade(v)}">${signedShort(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
                <p class="ci-note">Each cell: lifting in that month against holding, in today’s money, if your money earned that rate. <span class="ci-key warn">amber</span> lifting wins, <span class="ci-key good">green</span> holding wins. The verdict turns at the break-even rate${ins.a.cheapest ? ` (${percent(ins.a.cheapest.rate, 1)} in month ${ins.a.cheapest.no})` : ''}.</p>`
                : '<p class="ci-note">No month left that can be priced.</p>')}
            ${card('Lift, or borrow instead?', 'cash', borrow ? `
                <div class="ci-figs">
                    ${fig(`Lift in month ${borrow.month}`, money(Math.round(borrow.liftCost)), `costs, for ${money(Math.round(borrow.amount))}`, borrow.cheaper === 'LIFT' ? 'good' : '')}
                    ${fig(`Borrow at ${y.loanRate}%`, money(Math.round(borrow.interest)), `interest for ${borrow.months} months`, borrow.cheaper === 'BORROW' ? 'good' : '')}
                </div>
                <p class="ci-verdict-line ${borrow.cheaper === 'LIFT' ? 'warn' : 'info'}">${icon(borrow.cheaper === 'LIFT' ? 'arrow-in' : 'cash')}${borrow.cheaper === 'LIFT' ? `If you need ${moneyShort(borrow.amount)}, lifting is ${money(Math.round(borrow.by))} cheaper than a loan.` : `If you need ${moneyShort(borrow.amount)}, a loan repaid from the maturity amount is ${money(Math.round(borrow.by))} cheaper than lifting.`}</p>
                <p class="ci-note">The loan is taken in month ${borrow.month} and repaid with interest at maturity, out of the ${moneyShort(ins.M)} the chit pays; the chit is held as usual.</p>`
                : '<p class="ci-note">No month left that can be priced.</p>')}
            ${card('The organizer’s risk', 'shield', `
                <div class="ci-figs">
                    ${fig('With the organizer now', money(Math.round(risk.now)), 'paid in so far')}
                    ${fig('At stake before maturity', money(Math.round(risk.peak)), 'everything paid in', 'warn')}
                    ${fig('Expected loss if held', money(Math.round(risk.expectedLoss)), `at ${risk.rate}% a year`, risk.expectedLoss > 0 ? 'warn' : '')}
                    ${fig(risk.month ? `Lifting in month ${risk.month}` : 'Lifting', risk.month ? signed(risk.adjusted) : '—', risk.month ? `after the risk (${signedShort(risk.gain)} before)` : '', risk.adjusted >= 0 ? 'warn' : 'good')}
                </div>
                <p class="ci-note">Holding leaves what you have paid in with the organizer until maturity; lifting turns you from a lender into a borrower. ${risk.breakEven != null ? `Lifting in month ${risk.month} breaks even if you think the organizer has more than a <b>${risk.breakEven.toFixed(1)}%</b> a year chance of failing.` : risk.month ? `At your ${risk.rate}% the risk tips it towards lifting in month ${risk.month}.` : ''} A registered chit fund with a long record is close to 0%.</p>`)}
        </div>`;
}

// ===================================================================== Dividends & returns

function returnsView(c, installments, ins, y) {
    const { trend, divStats: d } = ins;
    return `
        <div class="ci-grid">
            ${card('What the chit earns', 'trending', `
                <div class="ci-figs">
                    ${fig('Over its whole life', ins.lifeRate == null ? '—' : `${percent(ins.lifeRate, 1)} a year`, 'XIRR: installments against the maturity amount', ins.lifeRate != null && ins.lifeRate < y.inflation ? 'bad' : ins.lifeRate != null && ins.lifeRate < y.fdRate ? 'warn' : 'good')}
                    ${fig('After inflation', ins.realRate == null ? '—' : `${ins.realRate >= 0 ? '+' : ''}${percent(ins.realRate, 1)}`, `at ${y.inflation}% inflation`, ins.realRate != null && ins.realRate < 0 ? 'bad' : 'good')}
                    ${fig('Paid so far', money(Math.round(ins.paidSoFar)), `${c.installmentsPaid} installments`)}
                    ${fig('Still to pay', money(Math.round(ins.stillToPay)), trend.usable ? 'with the dividend forecast' : 'at the average dividend')}
                    ${fig('Gain at maturity', money(Math.round(ins.M - ins.paidSoFar - ins.stillToPay)), 'maturity − everything paid', 'good')}
                    ${fig(`vs a ${y.fdRate}% deposit`, ins.lifeRate == null ? '—' : `${ins.lifeRate >= y.fdRate ? '+' : '−'}${percent(Math.abs(ins.lifeRate - y.fdRate), 1)}`, 'a year, over its life', ins.lifeRate != null && ins.lifeRate >= y.fdRate ? 'good' : 'warn')}
                </div>
                <p class="ci-note">Lifetime return: the one yearly rate (XIRR) at which everything paid and still to pay equals the ${moneyShort(ins.M)} at maturity.</p>`)}
            ${card('Dividends so far', 'coins', d.n ? `
                <div class="ci-figs three">
                    ${fig('Total', money(Math.round(d.total)), `${d.n} installments`, 'good')}
                    ${fig('Average', money(Math.round(d.mean)), `median ${money(Math.round(d.median))}`)}
                    ${fig('Yield', percent(d.yield, 1), 'of the installment')}
                    ${fig('Lowest · highest', `${moneyShort(d.min)} · ${moneyShort(d.max)}`, '')}
                    ${fig('Spread (σ)', money(Math.round(d.sd)), `CV ${percent(d.cv * 100, 0)}`, d.cv > 0.5 ? 'warn' : '')}
                    ${fig('Still to come', money(Math.round(d.toCome)), 'forecast, rest of the chit')}
                </div>
                <p class="ci-note">CV (spread ÷ average) ${d.cv < 0.25 ? 'is low: the dividends are steady' : d.cv < 0.5 ? 'is moderate: the dividends vary' : 'is high: the dividends jump around, so budget for the full installment'}.</p>`
                : '<p class="ci-note">No dividends recorded yet.</p>')}
            ${card('Dividends: the trend', 'percent', trend.n ? `
                <div class="chart ci-chart" data-ci-chart="div"></div>
                ${legend([{ label: 'Dividend paid', color: 'var(--series-3)' }, { label: 'Forecast', color: 'var(--series-2)' }, ...(trend.usable ? [{ label: '80% range', color: 'var(--series-5)' }] : [])], 'line')}
                <p class="ci-note">${trend.usable ? `Least-squares line: <b>${trend.slope >= 0 ? '+' : '−'}${money(Math.abs(Math.round(trend.slope)))}</b> a month, R² <b>${trend.r2.toFixed(2)}</b> (${trend.r2 >= 0.7 ? 'a steady trend' : trend.r2 >= 0.3 ? 'a loose trend' : 'mostly noise'}), spread ±${money(Math.round(trend.sigma))}. The forecast leans on the line as far as R² allows and stays within the range seen; 8 dividends in 10 should fall within the band.`
                    : `Only ${trend.n} dividend${trend.n === 1 ? '' : 's'} so far: the average (${money(Math.round(trend.avg))}) is used until there are three.`}</p>`
                : '<p class="ci-note">No dividends recorded yet.</p>')}
            ${card('The next installments', 'calendar', ins.nextUp.length ? `
                <table class="grid compact dense ci-next"><thead><tr><th class="c">#</th><th>Due</th><th class="r">Installment</th><th class="r">Dividend</th><th class="r">You pay</th><th class="r">80% range</th></tr></thead>
                    <tbody>${ins.nextUp.map(x => `<tr><td class="c"><b>${x.no}</b></td><td>${shortDate(x.date)}</td><td class="r muted">${money(x.due)}</td>
                        <td class="r pos">${money(Math.round(x.div))}</td><td class="r"><b>${money(Math.round(x.pay))}</b></td>
                        <td class="r muted">${x.high - x.low >= 1 ? `${moneyShort(x.low)} – ${moneyShort(x.high)}` : '—'}</td></tr>`).join('')}</tbody></table>
                <p class="ci-note">Budget for the top of the range to be safe.</p>` : '<p class="ci-note">No installments left.</p>')}
        </div>`;
}

/** The charts of the view on show, once it is on the page. */
export function drawLiftTabCharts(el, c, installments, ins, y) {
    if (!ins) return;
    const { trend } = ins;
    const div = el.querySelector('[data-ci-chart="div"]');
    if (div && trend.n) {
        const sorted = [...installments].sort((p, q) => p.installmentNo - q.installmentNo);
        const future = i => i.status !== 'PAID';
        lineChart(div, {
            labels: sorted.map(i => `M${i.installmentNo}`), format: v => moneyShort(v), includeZero: true,
            series: [
                { name: 'Dividend paid', values: sorted.map(i => (i.status === 'PAID' && i.dividend !== null ? Number(i.dividend) : null)), color: 'var(--series-3)' },
                { name: 'Forecast', values: sorted.map(i => Math.round(trend.forecast(i.installmentNo))), color: 'var(--series-2)', dashed: true },
                ...(trend.usable ? [
                    { name: 'High', values: sorted.map(i => (future(i) ? Math.round(trend.forecast(i.installmentNo) + trend.band(i.installmentNo)) : null)), color: 'var(--series-5)', dashed: true },
                    { name: 'Low', values: sorted.map(i => (future(i) ? Math.max(0, Math.round(trend.forecast(i.installmentNo) - trend.band(i.installmentNo))) : null)), color: 'var(--series-5)', dashed: true },
                ] : []),
            ],
        });
    }
    const priced = ins.perMonth.filter(x => x.say !== 'LATE');
    const rate = el.querySelector('[data-ci-chart="rate"]');
    if (rate && priced.length) {
        lineChart(rate, {
            labels: priced.map(x => `M${x.no}`), includeZero: true, format: v => `${Math.round(v * 10) / 10}%`,
            series: [
                { name: 'Yearly cost of lifting', values: priced.map(x => Math.round(x.rate * 10) / 10), color: 'var(--series-2)' },
                { name: 'Money earns', values: priced.map(() => y.investRate), color: 'var(--series-3)', dashed: true },
                { name: 'Loan', values: priced.map(() => y.loanRate), color: 'var(--series-8)', dashed: true },
            ],
        });
    } else if (rate) rate.innerHTML = '<div class="empty">Too close to maturity to price lifting.</div>';
    const edge = el.querySelector('[data-ci-chart="edge"]');
    if (edge && priced.length) {
        barChart(edge, { labels: priced.map(x => `M${x.no}`), format: v => moneyShort(v),
            series: [{ name: 'Lifting against holding, at maturity', values: priced.map(x => Math.round(x.edge)), color: priced.every(x => x.edge < 0) ? 'var(--series-3)' : 'var(--series-2)' }] });
    } else if (edge) edge.innerHTML = '<div class="empty">Too close to maturity to price lifting.</div>';
    const hist = el.querySelector('[data-ci-chart="hist"]');
    if (hist && ins.simulation) {
        const h = ins.simulation.hist;
        barChart(hist, { labels: h.map(b => signedShort((b.from + b.to) / 2)), format: v => `${Math.round(v)}`,
            series: [{ name: 'Futures', values: h.map(b => b.count), color: 'var(--series-1)' }] });
    }
}
