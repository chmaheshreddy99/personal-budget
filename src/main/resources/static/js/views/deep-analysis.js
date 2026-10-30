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
import { panel, table, esc, emptyState, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, monthLabel, date } from '../core/format.js';
import { barChart, lineChart, donutChart, sparkline, seriesColor, foldOthers, legend } from '../core/charts.js';

const num = v => Number(v || 0);
const TONE = { steady: 'good', variable: 'warning', erratic: 'critical', rising: 'critical', falling: 'good', flat: 'gray' };
const TABS = [['overview', 'Overview', 'sparkles'], ['trend', 'Trend & forecast', 'trending'], ['interest', 'Interest lost', 'piggy'], ['categories', 'Categories', 'tag'], ['unusual', 'Unusual & patterns', 'alert'], ['method', 'How it works', 'info']];
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
function ring(score, grade, label, size = 104) {
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

    // ------------------------------------------------------------ in one paragraph, for someone who reads nothing else
    const inShort = (() => {
        const parts = [];
        if (h) parts.push(`Your spending scores <b>${Math.round(h.score)}/100 (${esc(h.label)})</b>.`);
        if (series) parts.push(`A typical ${unit} costs <b>${money(Math.round(s.median))}</b> and is <b>${t.significant ? `${t.direction} by ${money(Math.round(Math.abs(t.slope)))} a ${unit}` : 'holding steady'}</b>.`);
        else parts.push(`You spent <b>${money(Math.round(s.total))}</b> in this period, about <b>${money(Math.round(s.perDay))}</b> a day.`);
        if (s.savingsRate != null) parts.push(`You kept <b>${percent(num(s.savingsRate) * 100, 0)}</b> of what came in.`);
        const o = r.opportunities[0];
        if (o) parts.push(`The easiest saving is <b>${esc(o.name)}</b>: about <b>${money(Math.round(o.excess))} a ${unit}</b> above its usual level.`);
        if (series && f) parts.push(`Plan about <b>${money(Math.round(f.p80))}</b> for next ${unit}.`);
        return `<div class="da-short">${icon('sparkles')}<p><span>In short</span>${parts.join(' ')}</p></div>`;
    })();

    // ------------------------------------------------------------ the biggest changes since the previous period
    const movers = (() => {
        if (!series || complete.length < 2) return '';
        const list = r.categories.map(cat => {
            const last = cat.series[cat.series.length - 1] || 0, prev = cat.series[cat.series.length - 2] || 0;
            return { name: cat.name, last, prev, d: last - prev };
        }).filter(x => Math.abs(x.d) >= 1);
        const up = [...list].sort((a, b) => b.d - a.d).filter(x => x.d > 0).slice(0, 4), down = [...list].sort((a, b) => a.d - b.d).filter(x => x.d < 0).slice(0, 4);
        if (!up.length && !down.length) return '';
        const lastKey = complete[complete.length - 1].key, prevKey = complete[complete.length - 2].key;
        const row = x => `<div class="da-mv"><b>${esc(x.name)}</b><span>${moneyShort(x.prev)} → ${moneyShort(x.last)}</span><em class="${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '▲ +' : '▼ −'}${money(Math.round(Math.abs(x.d)))}${x.prev ? ` (${x.d > 0 ? '+' : '−'}${percent(Math.abs(x.d / x.prev) * 100, 0)})` : ''}</em></div>`;
        return panel({ title: `What changed: ${label(lastKey)} against ${label(prevKey)}`, iconName: 'trending', body: `<div class="da-movers">
            <div><h4 class="neg">${icon('trending')}Went up</h4>${up.map(row).join('') || '<p class="muted small">Nothing went up.</p>'}</div>
            <div><h4 class="pos">${icon('trending-down')}Went down</h4>${down.map(row).join('') || '<p class="muted small">Nothing went down.</p>'}</div></div>` });
    })();

    // a finding's tone, from what it says
    const tone = x => /^(Next|Set|\d+ of \d+ categories)/.test(x) ? 'info' : /rising|above|unusual|thin|out of its normal|swings|extreme|lands all at once|pulled up/i.test(x) ? 'warn' : /strong|steady|no statistically|in control|independent|agrees/i.test(x) ? 'good' : 'info';

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

    const hasForgone = !!(r.forgone && r.forgone.rows.length);
    const tabs = `<div class="da-tabs">${TABS.filter(([k]) => (k !== 'interest' || hasForgone) && (series || k !== 'trend'))
        .map(([k, l, ic]) => `<button class="da-tab ${ui.tab === k ? 'active' : ''}" data-da-tab="${k}">${icon(ic)}${l}</button>`).join('')}</div>`;
    if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'overview';
    if ((!series && ui.tab === 'trend') || (!hasForgone && ui.tab === 'interest')) ui.tab = 'overview';

    // ------------------------------------------------------------ interest lost on money paid for others / lent, at the best rate my banks pay
    const g = r.forgone;
    const interestTab = () => {
        if (g.outstanding > 0) charts.push(() => {
            const ms = Array.from({ length: 13 }, (_, i) => i);
            lineChart(content.querySelector('#da-fg-chart'), { labels: ms.map(m => (m ? `+${m}m` : 'Now')), format: moneyShort, includeZero: true, area: true,
                series: [{ name: 'Interest lost', values: ms.map(m => Math.round(g.total + g.perYear / 12 * m)), color: '#d23b3b' }] });
        });
        const rows = [...g.rows].sort((x, y) => y.forgone - x.forgone);
        const top = Math.max(1, ...rows.map(x => x.forgone));
        const sum = k => rows.reduce((a, x) => a + num(x[k]), 0);
        const open = rows.filter(x => !x.settled);
        const byParty = [...rows.reduce((m, x) => m.set(x.party || '—', (m.get(x.party || '—') || 0) + num(x.outstanding)), new Map())].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
        const partyTop = Math.max(1, ...byParty.map(([, v]) => v));
        const oldest = open.reduce((a, x) => (!a || x.days > a.days ? x : a), null);
        const biggest = open.reduce((a, x) => (!a || x.perYear > a.perYear ? x : a), null);
        const tips = [
            biggest ? ['flag', 'warn', `Ask ${esc(biggest.party || 'them')} first`, `${money(Math.round(biggest.outstanding))} still out costs ${money(Math.round(biggest.perYear))} a year: the largest single loss.`] : null,
            oldest && oldest !== biggest ? ['clock', 'info', `Oldest: ${oldest.days} days`, `${esc(oldest.party || '—')} · ${esc(oldest.narration || oldest.kind)}. The longer it stays out, the more it costs.`] : null,
            g.outstanding > 0 ? ['bank', 'good', `Repaid today, it earns ${money(Math.round(g.perYear / 12))} a month`, `Put back at ${percent(num(g.rate), 2)}, ${money(Math.round(g.outstanding))} would earn ${money(Math.round(g.perYear))} a year.`] : null,
            ['info', 'info', 'How it is worked out', `Each amount, from the day it was paid until it was repaid (or today), at ${percent(num(g.rate), 2)} a year: ${esc(g.source)}.`],
        ].filter(Boolean);
        return `<div class="da-fg">
            <div class="da-fg-kpis">
                <div class="da-fg-big"><small>Interest lost so far</small><b>${money(Math.round(g.total))}</b><em>on ${rows.length} payment${rows.length === 1 ? '' : 's'} · ${money(Math.round(sum('amount')))} in all</em></div>
                <div class="da-fg-big warn"><small>Still with others</small><b>${money(Math.round(g.outstanding))}</b><em>${g.open} not yet repaid</em></div>
                <div class="da-fg-big bad"><small>Costing you</small><b>${money(Math.round(g.perYear))}<span>/yr</span></b><em>${money(Math.round(g.perYear / 12))} a month while it stays out</em></div>
                <div class="da-fg-big good"><small>Best rate you have</small><b>${percent(num(g.rate), 2)}</b><em>${esc(g.source)}</em></div>
            </div>
            <div class="da-fg-grid">
                ${panel({ title: 'Payments and what each has cost', iconName: 'piggy', cls: 'da-fg-tbl da-tile', bodyClass: 'flush tile-scroll', sub: esc(g.reading),
                    body: `<div class="da-fg-scroll"><table class="grid compact dense da-fg-t"><thead><tr><th>Paid for / lent to</th><th>Since</th><th class="r">Days</th><th class="r">Amount</th><th class="r">Still out</th><th class="r">Interest lost</th><th class="r">A year</th></tr></thead>
                        <tbody>${rows.map(x => `<tr><td><b>${esc(x.party || '—')}</b> <span class="muted small">${esc(x.narration || x.kind)}</span></td><td>${date(x.since)}</td><td class="r">${x.days}</td>
                            <td class="r">${money(Math.round(x.amount))}</td><td class="r">${x.settled ? '<span class="badge good">repaid</span>' : `<b>${money(Math.round(x.outstanding))}</b>`}</td>
                            <td class="r"><span class="da-fg-cell"><i style="width:${Math.max(4, Math.round(x.forgone / top * 100))}%"></i><b class="neg">${money(Math.round(x.forgone))}</b></span></td>
                            <td class="r">${x.settled ? '<span class="muted">—</span>' : money(Math.round(x.perYear))}</td></tr>`).join('')}</tbody>
                        <tfoot><tr><th>Total · ${rows.length}</th><td></td><td></td><td class="r">${money(Math.round(sum('amount')))}</td><td class="r">${money(Math.round(sum('outstanding')))}</td>
                            <td class="r neg">${money(Math.round(sum('forgone')))}</td><td class="r">${money(Math.round(open.reduce((a, x) => a + num(x.perYear), 0)))}</td></tr></tfoot></table></div>` })}
                ${g.outstanding > 0 ? panel({ title: 'If nothing more is repaid', iconName: 'trending', cls: 'da-tile da-fg-grow', bodyClass: 'da-chart-body', sub: `interest lost, the next 12 months at ${percent(num(g.rate), 2)}`, body: '<div class="chart" id="da-fg-chart"></div>' }) : ''}
                <div class="da-fg-side">
                    ${byParty.length ? panel({ title: 'Who holds your money', iconName: 'users', body: `<div class="da-fg-parties">${byParty.slice(0, 8).map(([n, v]) => `<div class="da-fg-p"><span class="ellipsis">${esc(n)}</span><i><em style="width:${Math.round(v / partyTop * 100)}%"></em></i><b>${moneyShort(v)}</b></div>`).join('')}</div>` }) : ''}
                    ${panel({ title: 'What to do', iconName: 'flag', body: `<div class="da-fg-tips">${tips.map(([ic, tone, t, d]) => `<div class="nc-in-item ${tone}"><span>${icon(ic)}</span><div class="min-0"><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>` })}
                </div>
            </div></div>`;
    };

    // ------------------------------------------------------------ the tabs
    const overview = () => {
        if (!series) {
            return `${inShort}<div class="da-ov da-ov-small">
                ${panel({ title: 'Where it goes', iconName: 'pie', cls: 'da-tile', bodyClass: 'da-donut-body', body: '<div class="chart" id="da-ov-donut"></div><div class="da-ov-legend" id="da-ov-legend"></div>' })}
                ${panel({ title: 'What the numbers say', iconName: 'sparkles', cls: 'da-tile', bodyClass: 'da-tile-body', body: `<div class="da-notes">${r.findings.slice(0, 6).map(x => `<div class="da-note ${tone(x)}">${icon('info')}<p>${esc(x)}</p></div>`).join('')}</div>` })}
                ${panel({ title: 'What to do', iconName: 'flag', cls: 'da-tile', bodyClass: 'da-tile-body', body: `<div class="da-cards-list">${r.advice.slice(0, 4).map((x, i) => `<div class="da-act"><span>${i + 1}</span><p>${esc(x)}</p></div>`).join('')}</div>` })}
            </div>`;
        }
        // the trend with the next period, the categories' shares, the health parts, the movers, the savings and the actions
        charts.push(() => {
            const labels = [...complete.map(p => p.key), f.label];
            lineChart(content.querySelector('#da-ov-trend'), { labels, labelFormat: label, format: moneyShort, includeZero: true, area: true,
                series: [{ name: 'Spent', values: [...complete.map(p => Math.round(p.expense)), Math.round(f.ols)] },
                    { name: 'Budget (P80)', values: labels.map(() => Math.round(f.p80)), color: 'var(--series-3)' }] });
        });
        const ups = (() => {
            if (complete.length < 2) return [];
            return r.categories.map(cat => ({ name: cat.name, d: (cat.series[cat.series.length - 1] || 0) - (cat.series[cat.series.length - 2] || 0), last: cat.series[cat.series.length - 1] || 0 }))
                .filter(x => Math.abs(x.d) >= 1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6);
        })();
        const moveTop = Math.max(1, ...ups.map(x => Math.abs(x.d)));
        const opps = r.opportunities.slice(0, 5), oppTop = Math.max(1, ...opps.map(o => o.excess));
        // the month in progress: on pace for what, against the plan
        const pace = (() => {
            if (!partial || r.unit !== 'month') return '';
            const now = new Date(), y = Number(partial.key.slice(0, 4)), m = Number(partial.key.slice(5, 7));
            const days = new Date(y, m, 0).getDate();
            const gone = now.getFullYear() === y && now.getMonth() + 1 === m ? Math.max(1, now.getDate()) : days;
            if (!(partial.expense > 0)) return `<div class="da-pace"><small>${label(partial.key)} so far</small><b>Nothing yet</b><em>plan ${moneyShort(f.p80)} for the ${unit}</em></div>`;
            const proj = partial.expense / gone * days;
            const tone2 = proj > f.p80 ? 'bad' : proj > s.median ? 'warn' : 'good';
            return `<div class="da-pace ${tone2}"><small>${label(partial.key)} so far</small><b>${moneyShort(partial.expense)}</b><em>on pace for ${moneyShort(proj)} · plan ${moneyShort(f.p80)}</em><i><u style="width:${Math.min(100, Math.round(proj / Math.max(1, f.p80) * 100))}%"></u></i></div>`;
        })();
        const lost = hasForgone && g.perYear > 0 ? `<button type="button" class="da-lost" data-da-go="interest">${icon('piggy')}<span><b>${money(Math.round(g.perYear))} a year</b> lost on ${money(Math.round(g.outstanding))} still with others</span>${icon('chevron-right')}</button>` : '';
        return `<div class="da-ov-top">${inShort}${pace}</div>
        <div class="da-ov">
            ${panel({ title: `Spending and next ${unit}`, iconName: 'trending', cls: 'da-tile', bodyClass: 'da-chart-body', sub: `forecast ${moneyShort(f.ols)} · 95% ${moneyShort(f.low)}–${moneyShort(f.high)}`, body: '<div class="chart" id="da-ov-trend"></div>' })}
            ${panel({ title: 'Where it goes', iconName: 'pie', cls: 'da-tile', bodyClass: 'da-donut-body', sub: `${r.concentration.paretoSet.length} make ${percent(num(r.concentration.paretoShare) * 100, 0)}`, body: '<div class="chart" id="da-ov-donut"></div><div class="da-ov-legend" id="da-ov-legend"></div>' })}
            ${panel({ title: 'Health', iconName: 'shield', cls: 'da-tile', bodyClass: 'da-tile-body', sub: `${Math.round(h.score)}/100 · ${esc(h.label)}`, body: `<div class="da-hp">${h.parts.map(p => `
                <div class="da-hp-row" title="${esc(p.reading)}"><span>${esc(p.name)}</span>${bar(p.score)}<b>${Math.round(p.score)}</b></div>`).join('')}
                <div class="da-dna sm"><i class="c" style="width:${num(r.committedShare) * 100}%"><b>${percent(num(r.committedShare) * 100, 0)}</b> committed</i><i class="f" style="width:${(1 - num(r.committedShare)) * 100}%"><b>${percent((1 - num(r.committedShare)) * 100, 0)}</b>${num(r.committedShare) < 0.7 ? ' adjustable' : ''}</i></div></div>` })}
            ${panel({ title: complete.length >= 2 ? `Biggest changes: ${label(complete[complete.length - 1].key)}` : 'Biggest changes', iconName: 'layers', cls: 'da-tile', bodyClass: 'da-tile-body', sub: complete.length >= 2 ? `against ${label(complete[complete.length - 2].key)}` : '',
                body: ups.length ? `<div class="da-chg">${ups.map(x => `<div class="da-chg-row"><span class="ellipsis" title="${esc(x.name)}">${esc(x.name)}</span>
                    <i class="${x.d > 0 ? 'up' : 'down'}"><em style="width:${Math.round(Math.abs(x.d) / moveTop * 100)}%"></em></i><b class="${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '+' : '−'}${moneyShort(Math.abs(x.d))}</b></div>`).join('')}</div>` : '<p class="muted small">Nothing moved much.</p>' })}
            ${panel({ title: 'Where to save', iconName: 'piggy', cls: 'da-tile', bodyClass: 'da-tile-body', sub: opps.length ? `${moneyShort(r.opportunities.reduce((a, o) => a + o.excess, 0))} a ${unit} · ${moneyShort(r.opportunities.reduce((a, o) => a + o.yearly, 0))} a year` : '',
                body: opps.length ? `<div class="da-chg">${opps.map(o => `<div class="da-chg-row clickable" data-cat="${esc(o.name)}" title="usual ${moneyShort(o.typical)} · average ${moneyShort(o.average)}"><span class="ellipsis">${esc(o.name)}</span>
                    <i class="save"><em style="width:${Math.round(o.excess / oppTop * 100)}%"></em></i><b class="pos">${moneyShort(o.excess)}</b></div>`).join('')}</div>`
                    : `<div class="da-none">${icon('check-circle')}<p>No category runs above its usual level often enough to trim.</p></div>` })}
            ${panel({ title: 'What to do', iconName: 'flag', cls: 'da-tile', bodyClass: 'da-tile-body', body: `${lost}<div class="da-todo">${r.advice.slice(0, lost ? 3 : 4).map((x, i) => `<div class="da-todo-i" title="${esc(x)}"><span>${i + 1}</span><p>${esc(x)}</p></div>`).join('')}</div>` })}
        </div>`;
    };
    // the categories' shares, for the overview's donut (both forms of it)
    const donut = () => {
        const el = content.querySelector('#da-ov-donut');
        if (!el) return;
        const items = foldOthers(r.categories.map(x => ({ label: x.name, value: Math.round(x.total) })), 6);
        donutChart(el, { items, format: moneyShort, centerValue: moneyShort(items.reduce((a, x) => a + x.value, 0)), centerLabel: 'spent' });
        content.querySelector('#da-ov-legend').innerHTML = items.map((x, i) => `<div class="legend-row" ${x.label !== 'Others' ? `data-cat="${esc(x.label)}"` : ''}><i class="legend-swatch" style="background:${seriesColor(i)}"></i><span class="ellipsis">${esc(x.label)}</span><b>${moneyShort(x.value)}</b></div>`).join('');
    };

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
        const tests = [
            ['Least squares', 'slope of the line through the series', `${t.slope >= 0 ? '+' : '−'}${money(Math.round(Math.abs(t.slope)))}/${unit.slice(0, 2)}`, `t = ${num(t.t).toFixed(2)} against ${num(t.tCritical).toFixed(2)}: ${t.significant ? 'significant' : 'not significant'}; R² ${num(t.r2).toFixed(2)}`],
            ['Theil–Sen', 'median of all pairwise slopes', `${t.theilSen >= 0 ? '+' : '−'}${money(Math.round(Math.abs(t.theilSen)))}/${unit.slice(0, 2)}`, 'the robust slope; far from least squares means one period distorts the fit'],
            ['Mann–Kendall', 'test for a steady rise or fall', `τ ${num(t.tau).toFixed(2)} · p ${num(t.mkP).toFixed(3)}`, t.mkSignificant ? 'a real monotonic trend (p < 0.05)' : 'no monotonic trend (p ≥ 0.05)'],
            ['Growth', 'slope of ln(spending)', `${num(t.growthPercent).toFixed(1)}% a ${unit}`, 'compound change per period'],
            ['Autocorrelation', 'does one period predict the next', num(t.lag1).toFixed(2), Math.abs(t.lag1) < 0.4 ? 'weak: periods are mostly independent' : t.lag1 > 0 ? 'a high period is followed by a high one' : 'a high period is followed by a low one'],
            ['EWMA control chart', `λ ${c.lambda}, ±3σ ${moneyShort(c.lower)} – ${moneyShort(c.upper)}`, `${money(c.lastEwma)}`, c.reading],
            ['Distribution', 'skewness · excess kurtosis', `${num(s.skew).toFixed(2)} · ${num(s.kurtosis).toFixed(2)}`, num(s.skew) > 0.8 ? 'a few very high periods pull the average up' : 'fairly symmetric'],
        ];
        const verdict = t.significant ? `${t.direction === 'rising' ? 'Rising' : 'Falling'} by ${money(Math.round(Math.abs(t.slope)))} a ${unit}` : 'No real trend: holding steady';
        return `<div class="fit-grid da-g-trend">
            ${panel({ title: `Spending by ${unit}, trend and forecast`, iconName: 'trending', cls: 'da-tile g-a', bodyClass: 'da-chart-body', sub: 'least-squares line; the last point is the forecast', body: '<div class="chart" id="da-trend"></div>' })}
            ${panel({ title: `The next ${unit}: ${label(f.label)}`, iconName: 'calendar', cls: 'da-tile g-b', bodyClass: 'tile-scroll', body: `
                <div class="da-next"><div><small>Expect</small><b>${moneyShort(f.ols)}</b></div><div><small>Budget (P80)</small><b>${moneyShort(f.p80)}</b></div><div><small>Worst likely (P95)</small><b>${moneyShort(f.p95)}</b></div></div>
                <div class="da-range"><div class="da-rail"><i style="left:0;width:100%"></i>
                <u style="left:${at(f.ols)}%" title="trend ${moneyShort(f.ols)}"></u><u class="h" style="left:${at(f.holt)}%" title="smoothing ${moneyShort(f.holt)}"></u>
                <u class="p" style="left:${at(Math.min(f.p80, f.high))}%" title="P80 ${moneyShort(f.p80)}"></u></div>
                <div class="da-rail-ends"><span>${moneyShort(f.low)}<small>95% low</small></span><span class="da-rail-key"><i></i>trend ${moneyShort(f.ols)}<i class="h"></i>smoothing ${moneyShort(f.holt)}<i class="p"></i>P80 ${moneyShort(f.p80)}</span><span>${moneyShort(f.high)}<small>95% high</small></span></div></div>
                <p class="da-verdict ${t.direction === 'rising' && t.significant ? 'warn' : 'good'}">${icon(t.significant ? 'trending' : 'check-circle')}<span><b>${verdict}.</b> ${esc(c.reading)}</span></p>
                <p class="small muted da-pad">"Trend" is the centre of the 95% interval; "smoothing" is Holt's (α ${f.alpha}, β ${f.beta}); P80 would have covered 4 ${unit}s in 5.</p>` })}
            ${panel({ title: 'Trend tests', iconName: 'scale', cls: 'da-tile g-c', bodyClass: 'flush tile-scroll', body: `<table class="grid compact dense da-tests"><thead><tr><th>Test</th><th class="r">Result</th><th>Reading</th></tr></thead>
                <tbody>${tests.map(x => `<tr><td><b>${x[0]}</b><small>${x[1]}</small></td><td class="r nowrap">${x[2]}</td><td class="small">${esc(x[3])}</td></tr>`).join('')}</tbody></table>` })}
            ${r.seasons.length ? panel({ title: 'Seasonality', iconName: 'calendar', cls: 'da-tile g-d', bodyClass: 'da-chart-body', sub: 'each month against the yearly average (1.00 = average)', body: '<div class="chart" id="da-season"></div>' })
                : panel({ title: 'Control chart', iconName: 'shield', cls: 'da-tile g-d', bodyClass: 'tile-scroll', body: `<div class="da-next"><div><small>Smoothed level</small><b>${moneyShort(c.lastEwma)}</b></div><div><small>Lower limit</small><b>${moneyShort(c.lower)}</b></div><div><small>Upper limit</small><b>${moneyShort(c.upper)}</b></div></div>
                    <p class="da-verdict info">${icon('info')}<span>${esc(c.reading)}</span></p><p class="small muted da-pad">Seasonality needs at least a year of months; it appears here once there is one.</p>` })}
        </div>`;
    };

    const categoriesTab = () => {
        const periods = complete.map(p => p.key);
        const heat = series ? panel({ title: 'Heat map: category by period', iconName: 'layers', cls: 'da-tile g-b', sub: 'darker = a high period for that category; pale = its low ones', bodyClass: 'flush tile-scroll', body: `<div class="da-heat-wrap"><table class="grid compact dense da-heat">
            <thead><tr><th>Category</th>${periods.map(k => `<th class="r">${label(k)}</th>`).join('')}</tr></thead>
            <tbody>${r.categories.slice(0, 14).map(cat => { const mx = Math.max(...cat.series), mn = Math.min(...cat.series), span = mx - mn; return `<tr><th>${esc(cat.name)}</th>${cat.series.map(v => { const k = span > 0 ? (v - mn) / span : 0.15; return `<td class="r" style="background:rgba(11,124,189,${v ? (0.06 + 0.62 * k).toFixed(2) : 0})${k > 0.6 && v ? ';color:#fff' : ''}">${v ? moneyShort(v) : ''}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>` }) : '';
        return `<div class="fit-grid ${series ? 'da-g-cat' : 'da-g-one'}">${panel({ title: 'Categories', iconName: 'tag', cls: 'da-tile g-a', bodyClass: 'flush tile-scroll', sub: `${r.concentration.paretoSet.length} categories make ${percent(num(r.concentration.paretoShare) * 100, 0)} · ${esc(r.concentration.reading)} (HHI ${r.concentration.hhi}, Gini ${r.concentration.gini})`,
            body: `<div>${table([
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
            ], r.categories, { rowAttrs: x => `data-cat="${esc(x.name)}" class="clickable" title="Open ${esc(x.name)}"` })}</div>` })}${heat}</div>`;
    };

    const openCategory = name => {
        const x = r.categories.find(c => c.name === name);
        if (!x) return;
        const reading = !series ? '' : x.committed ? 'A committed cost: present nearly every period with little change. It is not where savings come from, but a rise here lasts.'
            : x.series.filter(v => v > 0).length * 2 < x.series.length ? `Occasional: it shows up in ${x.series.filter(v => v > 0).length} of ${x.series.length} ${unit}s. Spread it out: set aside ${money(Math.round(x.suggested))} a ${unit}.`
            : x.volatility === 'erratic' ? `It swings a lot (CV ${num(x.cv).toFixed(2)}). Plan ${money(Math.round(x.suggested))} a ${unit} (its 80th percentile) rather than the average.`
            : x.trend === 'rising' ? `It is rising by ${money(Math.round(x.slope))} a ${unit} (t ${num(x.t).toFixed(1)}, Mann–Kendall p ${num(x.mkP).toFixed(3)}): worth a look.`
            : `Fairly regular. A limit of ${money(Math.round(x.suggested))} a ${unit} would have held 4 times in 5.`;
        const m = openModal({ title: x.name, sub: `${money(x.total)} · ${percent(num(x.share) * 100, 1)} of spending`, iconName: 'tag', size: 'lg', actions: [{ label: 'Close', kind: 'primary' }],
            body: `<div class="ip-risk"><div><small>Total</small><b>${money(x.total)}</b></div>${series ? `<div><small>Average a ${unit}</small><b>${money(Math.round(x.mean))}</b></div>
                <div><small>Latest ${unit}</small><b>${money(Math.round(x.latest))}</b></div><div><small>Limit (P80)</small><b>${money(Math.round(x.suggested))}</b></div>` : ''}</div>
                ${reading ? `<p class="da-cat-read">${esc(reading)}</p>` : ''}${series ? '<div class="chart-wrap"><div class="chart" id="da-cat-chart" style="height:220px"></div></div>' : ''}` });
        if (series) lineChart(m.el.querySelector('#da-cat-chart'), { labels: complete.map(p => p.key), labelFormat: label, format: moneyShort, includeZero: true, area: true,
            series: [{ name: x.name, values: x.series.map(v => Math.round(v)) }] });
    };

    const unusualTab = () => {
        charts.push(() => barChart(content.querySelector('#da-week'), { labels: r.rhythm.days.map(d => d.day), format: moneyShort,
            series: [{ name: 'Spent', values: r.rhythm.days.map(d => Math.round(d.amount)), color: 'var(--series-1)' }] }));
        const notes = panel({ title: 'What the numbers say', iconName: 'sparkles', cls: 'da-tile g-a', bodyClass: 'tile-scroll', body: `<div class="da-notes">${r.findings.map(x => { const t2 = tone(x); return `<div class="da-note ${t2}">${icon(t2 === 'warn' ? 'alert' : t2 === 'good' ? 'check-circle' : 'info')}<p>${esc(x)}</p></div>`; }).join('')}</div>` });
        const odd = panel({ title: 'Unusual items', iconName: 'alert', cls: 'da-tile g-c', bodyClass: 'flush tile-scroll', sub: `${r.outliers.length} found · modified z > 3.5 or Tukey fence`,
            body: r.outliers.length ? table([
                { label: 'What', render: o => `<b>${esc(o.label)}</b><div class="small muted">${o.kind === 'period' ? `${unit === 'week' ? 'Week' : 'Month'} total` : 'Expense'} · ${esc(o.note)}</div>` },
                { label: 'When', render: o => (o.kind === 'period' ? label(o.when) : date(o.when)) },
                { label: 'Amount', align: 'r', render: o => `<b>${money(o.amount)}</b>` },
                { label: 'Usual', align: 'r', render: o => money(o.expected) },
                { label: 'Score', align: 'r', render: o => num(o.score).toFixed(1) },
            ], r.outliers, { compact: true, dense: true }) : emptyState('Nothing stands out from the usual pattern in this period.', 'check') });
        const week = panel({ title: 'Spending by weekday', iconName: 'calendar', cls: 'da-tile g-b', bodyClass: 'da-chart-body', sub: `${r.rhythm.uneven ? 'uneven' : 'even'} · ${percent(num(r.rhythm.weekendShare) * 100, 0)} on weekends · busiest ${esc(r.rhythm.busiest)}`,
            body: '<div class="chart" id="da-week"></div>' });
        const more = `<div class="da-stack g-d">
            ${panel({ title: 'The expenses themselves', iconName: 'cart', body: `<div class="da-next six"><div><small>Expenses</small><b>${s.expenses}</b></div><div><small>Typical</small><b>${moneyShort(s.medianExpense)}</b></div>
                <div><small>Average</small><b>${moneyShort(s.averageExpense)}</b></div><div><small>Large (P90)</small><b>${moneyShort(s.p90)}</b></div><div><small>Very large (P95)</small><b>${moneyShort(s.p95)}</b></div><div><small>A day</small><b>${moneyShort(s.perDay)}</b></div></div>` })}
            ${movers}
            ${r.correlations.length ? panel({ title: 'Categories that move together', iconName: 'layers', sub: 'Pearson r, significant at 95%', bodyClass: 'flush', body: table([
                { label: 'Pair', render: x => `<b>${esc(x.a)}</b> &amp; <b>${esc(x.b)}</b>` }, { label: 'r', align: 'r', render: x => `<b class="${x.r > 0 ? 'pos' : 'neg'}">${num(x.r).toFixed(2)}</b>` },
                { label: 'Reading', render: x => `<span class="small">${esc(x.reading)}</span>` },
            ], r.correlations, { compact: true, dense: true }) }) : ''}</div>`;
        return `<div class="fit-grid da-g-four">${notes}${week}${odd}${more}</div>`;
    };

    const methodTab = () => `<div class="fit-grid da-g-one">${panel({ title: 'How these are worked out', iconName: 'info', cls: 'da-tile', bodyClass: 'tile-scroll', body: `<ul class="da-method-list">
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
        <li>With few periods, intervals are wide and trends rarely significant: that is the statistics being honest. Six to twelve months work best.</li></ul>` })}</div>`;

    const body = { overview, trend: trendTab, interest: () => interestTab(), categories: categoriesTab, unusual: unusualTab, method: methodTab };
    const show = () => {
        charts.length = 0;
        const host = content.querySelector('#da-body');
        content.classList.add('da-fit');
        host.innerHTML = body[ui.tab]();
        if (ui.tab === 'overview') charts.push(donut);
        charts.forEach(fn => fn());
        content.querySelectorAll('[data-da-tab]').forEach(b => b.classList.toggle('active', b.dataset.daTab === ui.tab));
    };
    content.innerHTML = `${hero}${tabs}<div class="da-body" id="da-body"></div>
        ${partial ? `<p class="emi-how da-partial">${icon('info')} ${label(partial.key)} is still in progress (${money(partial.expense)} so far) and is left out of the statistics.</p>` : ''}`;
    content.querySelector('.da-tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-da-tab]');
        if (b) { ui.tab = b.dataset.daTab; show(); }
    });
    content.querySelector('#da-body').addEventListener('click', e => {
        const go = e.target.closest('[data-da-go]');
        if (go) { ui.tab = go.dataset.daGo; show(); return; }
        const row = e.target.closest('[data-cat]');
        if (row) openCategory(row.dataset.cat);
    });
    show();

    return () => [['Category', 'Total', 'Share %', 'Average', 'Std dev', 'CV', 'Volatility', 'Slope per period', 't', 'Mann-Kendall p', 'Trend', 'Latest', 'z', 'Limit (P80)'],
        ...r.categories.map(x => [x.name, x.total, Math.round(num(x.share) * 10000) / 100, x.mean, x.sd, x.cv, x.volatility, x.slope, x.t, x.mkP, x.trend, x.latest, x.latestZ, x.suggested])];
}

function head(iconName, label, value, sub, cls = '') {
    return `<div class="da-head ${cls}"><span class="da-hi">${icon(iconName)}</span><div class="min-0"><small>${label}</small><b>${value}</b><em>${sub}</em></div></div>`;
}
