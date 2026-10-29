/**
 * Reports › Deep analysis: what the spending history says, with the statistics behind it (DeepAnalysisService): a health score out of 100
 * built from six parts, the trend by least squares and by the robust Theil–Sen / Mann–Kendall pair, a 95% forecast interval, an EWMA control
 * chart, the distribution (skewness, kurtosis, percentiles), a category-by-period heat map with sparklines, where the money can be saved
 * (what each flexible category spends above its own median), correlations, outliers and the weekday rhythm. It uses months when there are four
 * complete ones, weeks when there are six, and otherwise describes the expenses themselves, so there is always something to read.
 *
 * The page opens on an overview (the score, what the numbers say, what to do) with the detail on four tabs, so nothing is a wall of text. The
 * report area scrolls as one column; wide tables scroll inside their own panel.
 */
import { api } from '../core/api.js';
import { panel, table, esc, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, date } from '../core/format.js';
import { barChart, lineChart, sparkline } from '../core/charts.js';

const num = v => Number(v || 0);
const TONE = { steady: 'good', variable: 'warning', erratic: 'critical', rising: 'critical', falling: 'good', flat: 'gray' };
const TABS = [['overview', 'Overview', 'sparkles'], ['trend', 'Trend & forecast', 'trending'], ['categories', 'Categories', 'tag'], ['unusual', 'Unusual & patterns', 'alert'], ['method', 'How it works', 'info']];
const ui = { tab: 'overview' };

export async function deepAnalysis(content, toolbar, period) {
    content.className = 'report-content da-page';
    content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    let r;
    try {
        r = await api.get('/reports/deep-analysis', { from: period.from, to: period.to });
    } catch (e) {
        content.innerHTML = panel({ title: 'Deep analysis', iconName: 'sparkles', body: emptyState(`The analysis could not be made: ${e.message}`, 'alert') });
        return () => [];
    }
    if (!r.enough) {
        content.innerHTML = panel({ title: 'Deep analysis', iconName: 'sparkles', body: emptyState(r.message, 'sparkles') });
        return () => [];
    }
    try {
        return draw(content, r);
    } catch (e) {
        console.error(e);
        content.innerHTML = panel({ title: 'Deep analysis', iconName: 'sparkles', body: emptyState(`The page could not be drawn: ${e.message}`, 'alert') });
        return () => [];
    }
}

/** A score ring: 0 to 100 in a circle, coloured by how good it is. */
function ring(score, grade, label, size = 132) {
    const tone = score >= 70 ? '#12a150' : score >= 55 ? '#d9a21b' : score >= 40 ? '#e07b22' : '#d23b3b';
    const r = 52, c = 2 * Math.PI * r, on = c * Math.max(0, Math.min(100, score)) / 100;
    return `<div class="da-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(120,140,160,.18)" stroke-width="10"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${tone}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${on} ${c}" transform="rotate(-90 60 60)"/></svg>
        <div><b style="color:${tone}">${Math.round(score)}</b><small>${esc(label)}</small><em>Grade ${esc(grade)}</em></div></div>`;
}

function bar(score) {
    const tone = score >= 70 ? 'good' : score >= 55 ? 'fair' : score >= 40 ? 'weak' : 'bad';
    return `<i class="da-bar ${tone}"><em style="width:${Math.max(3, Math.min(100, score))}%"></em></i>`;
}

function draw(content, r) {
    const s = r.summary, t = r.trend, f = r.forecast, c = r.control, h = r.health;
    const unit = r.unit === 'week' ? 'week' : 'month';
    const label = k => (r.unit === 'month' ? monthLabel(k) : r.unit === 'week' ? date(k).replace(/ \d{4}$/, '') : k);
    const complete = r.periods.filter(p => !p.partial);
    const partial = r.periods.find(p => p.partial);
    const series = r.unit !== 'none' && t;
    const spent = complete.reduce((a, p) => a + p.expense, 0);
    const charts = [];   // drawn after the tab's HTML is in the page

    // ------------------------------------------------------------ the hero: the score and the headline numbers
    const hero = series ? `<div class="da-hero">
            ${ring(h.score, h.grade, h.label)}
            <div class="da-heads">
                ${head('wallet', `${unit === 'week' ? 'Weekly' : 'Monthly'} spending`, moneyShort(s.mean), `median ${moneyShort(s.median)} · ±${percent(num(s.cv) * 100, 0)}`, num(s.cv) < 0.3 ? 'good' : 'warn')}
                ${head(t.direction === 'rising' ? 'trending' : t.direction === 'falling' ? 'trending-down' : 'minus', 'Direction', t.significant ? `${t.direction}` : 'steady', t.significant ? `${t.slope > 0 ? '+' : '−'}${moneyShort(Math.abs(t.slope))} a ${unit}` : `no real trend (p ${num(t.mkP).toFixed(2)})`, t.direction === 'rising' ? 'warn' : t.direction === 'falling' ? 'good' : '')}
                ${head('calendar', `Expect ${label(f.label)}`, moneyShort(f.ols), `95% range ${moneyShort(f.low)} – ${moneyShort(f.high)}`)}
                ${head('shield', 'Budget it at', moneyShort(f.p80), `kept in 4 of 5 ${unit}s · P95 ${moneyShort(f.p95)}`)}
                ${s.savingsRate == null ? head('piggy', 'Kept of income', '—', 'no income recorded')
                    : head('piggy', 'Kept of income', percent(num(s.savingsRate) * 100, 0), `${money(num(s.income) - spent)} of ${moneyShort(s.income)}`, s.savingsRate >= 0.2 ? 'good' : 'warn')}
                ${r.opportunities.length ? head('flag', 'Could be saved', moneyShort(r.opportunities.reduce((a, o) => a + o.excess, 0)), `a ${unit} by trimming ${r.opportunities.length} categories`, 'good') : ''}
            </div></div>`
        : `<div class="da-hero"><div class="da-heads">
            ${head('cart', 'Spent', moneyShort(s.total), `${s.expenses} expenses · ${money(s.perDay)} a day`)}
            ${head('scale', 'Typical expense', moneyShort(s.medianExpense), `average ${moneyShort(s.averageExpense)}`)}
            ${head('alert', 'Large expenses', moneyShort(s.p95), `95th percentile · 90th ${moneyShort(s.p90)}`)}</div></div>`;

    const tabs = `<div class="da-tabs">${TABS.filter(([k]) => series || k === 'overview' || k === 'categories' || k === 'unusual' || k === 'method')
        .map(([k, l, ic]) => `<button class="da-tab ${ui.tab === k ? 'active' : ''}" data-da-tab="${k}">${icon(ic)}${l}</button>`).join('')}</div>`;
    if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'overview';
    if (!series && ui.tab === 'trend') ui.tab = 'overview';

    // ------------------------------------------------------------ the tabs
    const overview = () => `
        ${h ? panel({ title: 'Health of your spending', iconName: 'shield', sub: 'six parts, weighted', body: `<div class="da-parts">${h.parts.map(p => `
            <div class="da-part"><div class="da-part-head"><b>${esc(p.name)}</b><span>${Math.round(p.score)}<small>/100 · ${Math.round(p.weight * 100)}%</small></span></div>${bar(p.score)}<p>${esc(p.reading)}</p></div>`).join('')}</div>` }) : ''}
        ${r.advice.length ? panel({ title: 'What to do about it', iconName: 'flag', body: `<div class="da-cards-list">${r.advice.map((x, i) => `<div class="da-act"><span>${i + 1}</span><p>${esc(x)}</p></div>`).join('')}</div>` }) : ''}
        ${r.opportunities.length ? panel({ title: 'Where the money can be saved', iconName: 'piggy', bodyClass: 'flush', sub: `what each category spends above its own median, per ${unit}`, body: `<div class="scroll">${table([
            { label: 'Category', render: o => `<b>${esc(o.name)}</b>` },
            { label: 'Usual (median)', align: 'r', render: o => moneyShort(o.typical) },
            { label: 'Average', align: 'r', render: o => moneyShort(o.average) },
            { label: `Above usual, per ${unit}`, align: 'r', render: o => `<b class="pos">${money(o.excess)}</b>` },
            { label: 'A year', align: 'r', render: o => money(o.yearly) },
            { label: 'Share', render: o => `<div class="da-share"><i style="width:${Math.round(num(o.share) * 100)}%"></i><span>${percent(num(o.share) * 100, 0)}</span></div>` },
        ], r.opportunities)}</div>` }) : ''}
        ${panel({ title: 'What the numbers say', iconName: 'sparkles', body: `<div class="da-notes">${r.findings.map(x => `<div class="da-note">${icon('chevron-right')}<p>${esc(x)}</p></div>`).join('')}</div>` })}
        ${series ? panel({ title: 'Committed or adjustable?', iconName: 'layers', body: `<div class="da-dna"><i class="c" style="width:${num(r.committedShare) * 100}%"><b>${percent(num(r.committedShare) * 100, 0)}</b> committed</i><i class="f" style="width:${(1 - num(r.committedShare)) * 100}%"><b>${percent((1 - num(r.committedShare)) * 100, 0)}</b> adjustable</i></div>
            <p class="small muted da-pad">Committed spending is steady and present in nearly every ${unit} (rent, EMIs, subscriptions). The adjustable part is where a change shows.</p>` }) : ''}`;

    const trendTab = () => {
        charts.push(() => {
            const labels = [...complete.map(p => p.key), f.label];
            const spend = [...complete.map(p => Math.round(p.expense)), Math.round(f.ols)];
            const line = labels.map((_, i) => Math.round(t.intercept + t.slope * i));
            lineChart(content.querySelector('#da-trend'), { labels, labelFormat: label, format: moneyShort, includeZero: true,
                series: [{ name: 'Spending (last point: forecast)', values: spend }, { name: 'Trend line', values: line, color: 'var(--series-3)' }] });
            if (r.seasons.length) barChart(content.querySelector('#da-season'), { labels: r.seasons.map(x => x.name), format: v => v.toFixed(2), series: [{ name: 'Index', values: r.seasons.map(x => x.index), color: 'var(--series-2)' }] });
        });
        const span = Math.max(1, f.high - f.low), at = v => Math.max(0, Math.min(100, (v - f.low) / span * 100));
        return `${panel({ title: `Spending by ${unit}, trend and forecast`, iconName: 'trending', sub: 'least-squares line; the last point is the forecast', bodyClass: 'chart', body: '<div class="chart-wrap"><div class="chart" id="da-trend"></div></div>' })}
        ${panel({ title: `The next ${unit}: ${label(f.label)}`, iconName: 'calendar', body: `<div class="da-range"><div class="da-rail"><i style="left:0;width:100%"></i>
                <u style="left:${at(f.ols)}%" title="trend"><b>${moneyShort(f.ols)}</b><small>trend</small></u><u class="h" style="left:${at(f.holt)}%" title="smoothing"><b>${moneyShort(f.holt)}</b><small>smoothing</small></u>
                <u class="p" style="left:${at(Math.min(f.p80, f.high))}%" title="80th percentile"><b>${moneyShort(f.p80)}</b><small>P80</small></u></div>
                <div class="da-rail-ends"><span>${moneyShort(f.low)}<small>95% low</small></span><span>${moneyShort(f.high)}<small>95% high</small></span></div></div>
                <p class="small muted da-pad">The line is the 95% prediction interval of the least-squares fit; "trend" is its centre, "smoothing" is Holt's exponential smoothing (α ${f.alpha}, β ${f.beta}), and P80 is the amount that would have covered 4 ${unit}s in 5.</p>` })}
        ${panel({ title: 'Trend tests and control chart', iconName: 'scale', bodyClass: 'flush', body: `<div class="scroll">${table([
            { label: 'Test', render: x => `<b>${x[0]}</b><div class="small muted">${x[1]}</div>` }, { label: 'Result', align: 'r', render: x => x[2] }, { label: 'Reading', render: x => `<span class="small">${esc(x[3])}</span>` },
        ], [
            ['Least squares', 'slope of the line through the series', `${t.slope >= 0 ? '+' : '−'}${money(Math.abs(t.slope))}/${unit.slice(0, 2)}`, `t = ${num(t.t).toFixed(2)} against ${num(t.tCritical).toFixed(2)}: ${t.significant ? 'significant' : 'not significant'}; R² ${num(t.r2).toFixed(2)}`],
            ['Theil–Sen', 'median of all pairwise slopes: ignores one odd period', `${t.theilSen >= 0 ? '+' : '−'}${money(Math.abs(t.theilSen))}/${unit.slice(0, 2)}`, 'the robust slope; far from least squares means one period distorts the fit'],
            ['Mann–Kendall', 'distribution-free test for a steady rise or fall', `τ ${num(t.tau).toFixed(2)} · p ${num(t.mkP).toFixed(3)}`, t.mkSignificant ? 'a real monotonic trend (p < 0.05)' : 'no monotonic trend (p ≥ 0.05)'],
            ['Growth', 'slope of ln(spending)', `${num(t.growthPercent).toFixed(1)}% a ${unit}`, 'compound change per period'],
            ['Autocorrelation', 'does one period predict the next', num(t.lag1).toFixed(2), Math.abs(t.lag1) < 0.4 ? 'weak: periods are mostly independent' : t.lag1 > 0 ? 'a high period is followed by a high one' : 'a high period is followed by a low one'],
            ['EWMA control chart', `λ ${c.lambda}, ±3σ band ${money(c.lower)} – ${money(c.upper)}`, `${money(c.lastEwma)}`, c.reading],
            ['Distribution', 'skewness · excess kurtosis of the totals', `${num(s.skew).toFixed(2)} · ${num(s.kurtosis).toFixed(2)}`, num(s.skew) > 0.8 ? 'a few very high periods pull the average up' : 'fairly symmetric'],
        ])}</div>` })}
        ${r.seasons.length ? panel({ title: 'Seasonality', iconName: 'calendar', sub: 'each calendar month against the yearly average (1.00 = average)', bodyClass: 'chart', body: '<div class="chart-wrap"><div class="chart" id="da-season"></div></div>' }) : ''}`;
    };

    const categoriesTab = () => {
        const periods = complete.map(p => p.key);
        const heat = series ? panel({ title: 'Heat map: category by period', iconName: 'layers', sub: 'darker = more spent, within each category', bodyClass: 'flush', body: `<div class="scroll da-heat-wrap"><table class="grid compact dense da-heat">
            <thead><tr><th>Category</th>${periods.map(k => `<th class="r">${label(k)}</th>`).join('')}</tr></thead>
            <tbody>${r.categories.slice(0, 14).map(cat => { const mx = Math.max(...cat.series, 1); return `<tr><th>${esc(cat.name)}</th>${cat.series.map(v => `<td class="r" style="background:rgba(11,124,189,${(0.04 + 0.5 * (v / mx)).toFixed(2)});color:${v / mx > 0.6 ? '#fff' : 'inherit'}">${v ? moneyShort(v) : ''}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>` }) : '';
        return `${heat}${panel({ title: 'Categories', iconName: 'tag', bodyClass: 'flush', sub: `${r.concentration.paretoSet.length} categories make ${percent(num(r.concentration.paretoShare) * 100, 0)} · ${esc(r.concentration.reading)} (HHI ${r.concentration.hhi}, Gini ${r.concentration.gini})`,
            body: `<div class="scroll">${table([
                { label: 'Category', render: x => `<b>${esc(x.name)}</b>${x.committed ? ' <span class="badge gray" title="Present nearly every period with little variation">committed</span>' : ''}` },
                { label: 'Total', align: 'r', render: x => money(x.total) },
                { label: 'Share', align: 'r', render: x => `<div class="da-share"><i style="width:${Math.round(num(x.share) * 100)}%"></i><span>${percent(num(x.share) * 100, 1)}</span></div>` },
                ...(series ? [
                    { label: 'Pattern', render: x => sparkline(x.series, { width: 84, height: 24, color: x.trend === 'rising' ? '#d23b3b' : x.trend === 'falling' ? '#12a150' : 'var(--series-1)' }) },
                    { label: 'Average', align: 'r', render: x => `${moneyShort(x.mean)}<div class="small muted">sd ${moneyShort(x.sd)}</div>` },
                    { label: 'CV', align: 'r', render: x => `${num(x.cv).toFixed(2)} <span class="badge ${TONE[x.volatility] || 'gray'}">${x.volatility}</span>` },
                    { label: 'Trend', render: x => `<span class="badge ${TONE[x.trend]}">${x.trend}</span><div class="small muted">${x.trend === 'flat' ? '' : `${num(x.slope) > 0 ? '+' : '−'}${moneyShort(Math.abs(x.slope))}/${unit.slice(0, 2)} · `}t ${num(x.t).toFixed(1)} · p ${num(x.mkP).toFixed(2)}</div>` },
                    { label: 'Latest', align: 'r', render: x => `${moneyShort(x.latest)}<div class="small ${num(x.latestZ) > 2 ? 'neg' : 'muted'}">z ${num(x.latestZ).toFixed(1)}</div>` },
                    { label: 'Limit (P80)', align: 'r', render: x => moneyShort(x.suggested) },
                ] : []),
            ], r.categories)}</div>` })}`;
    };

    const unusualTab = () => {
        charts.push(() => barChart(content.querySelector('#da-week'), { labels: r.rhythm.days.map(d => d.day), format: moneyShort,
            series: [{ name: 'Spent', values: r.rhythm.days.map(d => Math.round(d.amount)), color: 'var(--series-1)' }] }));
        return `${panel({ title: 'Unusual items', iconName: 'alert', bodyClass: 'flush', sub: 'modified z-score above 3.5 for a period, Tukey fence for a single expense',
            body: r.outliers.length ? `<div class="scroll">${table([
                { label: 'Kind', render: o => o.kind === 'period' ? `${unit === 'week' ? 'Week' : 'Month'} total` : 'Expense' },
                { label: 'What', render: o => `<b>${esc(o.label)}</b><div class="small muted">${esc(o.note)}</div>` },
                { label: 'When', render: o => (o.kind === 'period' ? label(o.when) : date(o.when)) },
                { label: 'Amount', align: 'r', render: o => money(o.amount) },
                { label: 'Usual', align: 'r', render: o => money(o.expected) },
                { label: 'Score', align: 'r', render: o => num(o.score).toFixed(1) },
            ], r.outliers)}</div>` : emptyState('Nothing stands out from the usual pattern in this period.', 'check') })}
        ${r.correlations.length ? panel({ title: 'Categories that move together', iconName: 'layers', sub: 'Pearson correlation, significant at 95%', bodyClass: 'flush',
            body: `<div class="scroll">${table([
                { label: 'Pair', render: x => `<b>${esc(x.a)}</b> &amp; <b>${esc(x.b)}</b>` }, { label: 'r', align: 'r', render: x => `<b class="${x.r > 0 ? 'pos' : 'neg'}">${num(x.r).toFixed(2)}</b>` },
                { label: 'Reading', render: x => esc(x.reading) },
            ], r.correlations)}</div>` }) : ''}
        ${panel({ title: 'Spending by weekday', iconName: 'calendar', sub: `χ² ${num(r.rhythm.chi2).toFixed(1)} · ${r.rhythm.uneven ? 'uneven' : 'even'} · ${percent(num(r.rhythm.weekendShare) * 100, 0)} on weekends · busiest ${esc(r.rhythm.busiest)}`, bodyClass: 'chart',
            body: '<div class="chart-wrap"><div class="chart" id="da-week"></div></div>' })}
        ${panel({ title: 'The expenses themselves', iconName: 'cart', body: `<div class="ip-risk"><div><small>Expenses</small><b>${s.expenses}</b></div><div><small>Typical (median)</small><b>${money(s.medianExpense)}</b></div>
            <div><small>Average</small><b>${money(s.averageExpense)}</b></div><div><small>Large (90th pct)</small><b>${money(s.p90)}</b></div><div><small>Very large (95th)</small><b>${money(s.p95)}</b></div><div><small>A day</small><b>${money(s.perDay)}</b></div></div>` })}`;
    };

    const methodTab = () => `${panel({ title: 'How these are worked out', iconName: 'info', body: `<ul class="da-method-list">
        <li><b>Series</b>: complete months when there are at least four, otherwise complete weeks (six or more), otherwise the expenses are only described. The ${unit} in progress is kept out.</li>
        <li><b>Health score</b>: the weighted mean of six parts, each 0 to 100: steadiness (CV), direction (a significant rise costs points), savings rate (30% scores full), balance across categories (HHI), predictability (control-chart signals and outliers) and room to adjust (the committed share).</li>
        <li><b>Least squares</b> fits a line to the totals; its slope is significant when its t statistic passes the 95% critical value of Student's t (n − 2 degrees of freedom). The forecast adds the 95% prediction interval ŷ ± t·s·√(1 + 1/n + (x₀ − x̄)²/Sxx).</li>
        <li><b>Theil–Sen and Mann–Kendall</b> need no assumption about the shape of the data: the slope is the median of every pairwise slope, and the test counts how often later periods are higher than earlier ones.</li>
        <li><b>EWMA control chart</b>: a smoothed level (λ 0.3) against ±3σ limits, σ from the median absolute deviation × 1.4826. A signal means the usual level of spending has shifted, not just one high period.</li>
        <li><b>Limits (P80, P95)</b> are the 80th and 95th percentiles of the history: a budget at P80 would have held in 4 periods out of 5.</li>
        <li><b>Savings</b>: for each adjustable category, the average of (that period's spend − its own median) over the periods where it ran above its median.</li>
        <li><b>CV</b> is standard deviation ÷ mean: under 0.25 steady, under 0.6 variable, above that erratic. <b>Committed</b> spending is steady and present in at least 80% of the periods.</li>
        <li><b>Concentration</b>: the Pareto set makes 80% of the spending; HHI is the sum of squared shares (above 0.25 is concentrated); Gini is 0 when every category is equal.</li>
        <li><b>Unusual items</b>: a period is flagged when its modified z-score 0.6745·(x − median)/MAD passes 3.5 (the mean absolute deviation is used when a category is normally zero); an expense when it exceeds Q3 + 1.5·IQR of its category.</li>
        <li><b>Weekday</b>: Pearson's χ² of the seven daily totals against an even spread; above 12.59 (6 degrees of freedom) the difference is unlikely to be chance.</li>
        <li>With few periods, intervals are wide and trends rarely significant: that is the statistics being honest. Six to twelve months work best.</li></ul>` })}`;

    const body = { overview, trend: trendTab, categories: categoriesTab, unusual: unusualTab, method: methodTab };
    const show = () => {
        charts.length = 0;
        const host = content.querySelector('#da-body');
        host.innerHTML = body[ui.tab]();
        charts.forEach(fn => fn());
        content.querySelectorAll('[data-da-tab]').forEach(b => b.classList.toggle('active', b.dataset.daTab === ui.tab));
    };
    content.innerHTML = `${hero}${tabs}<div class="da-body" id="da-body"></div>
        ${partial ? `<p class="emi-how">${icon('info')} ${label(partial.key)} is still in progress (${money(partial.expense)} so far) and is left out of the statistics.</p>` : ''}`;
    content.querySelector('.da-tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-da-tab]');
        if (b) { ui.tab = b.dataset.daTab; show(); }
    });
    show();

    return () => [['Category', 'Total', 'Share %', 'Average', 'Std dev', 'CV', 'Volatility', 'Slope per period', 't', 'Mann-Kendall p', 'Trend', 'Latest', 'z', 'Limit (P80)'],
        ...r.categories.map(x => [x.name, x.total, Math.round(num(x.share) * 10000) / 100, x.mean, x.sd, x.cv, x.volatility, x.slope, x.t, x.mkP, x.trend, x.latest, x.latestZ, x.suggested])];
}

function head(iconName, label, value, sub, cls = '') {
    return `<div class="da-head ${cls}"><span class="da-hi">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><em>${sub}</em></div></div>`;
}
