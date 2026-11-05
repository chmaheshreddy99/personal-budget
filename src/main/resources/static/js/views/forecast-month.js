/**
 * Forecast › Projection › Month by month, a month opened: one line of what its row does not say (what is kept, what the
 * earnings pay, how long the cash lasts, net worth), then a summary card for each table of the month: its figure with the
 * change from the month before, a bar of what makes it up, and its biggest lines. A card opens its table maximized
 * (openMonthTable), over one month or any range of them: the tabs go to the other tables, the presets and exact months
 * choose the range, and the arrows (or ← →) move it:
 *   Cash this month   start to end: each line and the balance after it
 *   Where it goes     each category from its budget, the chit dues and the EMIs, with their share
 *   What it earns     each bank balance, deposit and loan given: on how much at what rate, this month and so far, and
 *                     when it reaches cash; the chits as one line
 *   On the calendar   the dated items, what they bring in and take out
 *   What the chits earn  one line a chit: organizer, installment, on how much, interest, dividend, this month and so far,
 *                     when it reaches cash
 * The tables are built when opened, so a long forecast keeps only the summaries on the page.
 */
import { esc, openModal } from '../core/ui.js';
import { readQuery, setQuery, routeHash, currentPath } from '../core/route.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, monthLabel, isoDate } from '../core/format.js';
import { SOURCE_COLOR, SOURCE_LABEL } from './projection-earnings.js';

// what an expense line of a month stands on: [badge, words]
export const LINE_BASIS = { BUDGET: ['B', 'Budget for the month'], BUDGET_AVG: ['Avg', 'Average of the months budgeted'], HISTORY: ['3m', '3-month average'], RECURRING: ['Rec', 'Recurring expense'] };
const OTHER_BASIS = { Chit: ['Chit', 'Chit installment, less the expected dividend'], Emi: ['Rec', 'Recurring transfers out'] };
export const EVENT_ICON = { deposit: 'piggy', given: 'hand', savings: 'bank', chit: 'chit', 'chit-in': 'gift' };

const rupees = v => money(Math.round(v));
const signed = v => `${v >= 0 ? '+' : '−'}${money(Math.abs(Math.round(v)))}`;
const toneOf = v => (v >= 0 ? 'pos' : 'neg');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const IN_COLOR = 'var(--series-3)', OUT_COLOR = 'var(--series-2)';

/** Each opened month's figures, by month, for its tables when they are opened. */
const MONTHS = new Map();

/** What each number here adds up from: `prev` is the month before (null for the first), `open` the cash it starts with. */
export function monthDetail(r, prev, open, { basisLabel, buffer, outOf, startNetWorth, first }) {
    const net = Number(r.netCashFlow) + r.extraCash;
    // money out already has the dividends off the installments, so they are not money in as well
    const moneyIn = x => Number(x.income) + Number(x.chitPayouts) + Number(x.transfersIn) + x.extraCash - x.cash.dividends;
    const m = { r, prev, open, net, buffer, basisLabel, first, inNow: moneyIn(r), outNow: outOf(r), inBefore: prev ? moneyIn(prev) : 0, outBefore: prev ? outOf(prev) : 0 };
    MONTHS.set(r.month, m);

    const nwChange = r.netWorth - (prev ? prev.netWorth : startNetWorth);
    const cover = m.outNow > 0 ? r.liquid / m.outNow : null;
    const earnShare = m.outNow > 0 ? Math.round(r.earned / m.outNow * 100) : null;
    const fact = (html, title = '') => `<span${title ? ` title="${esc(title)}"` : ''}>${html}</span>`;
    return `<div class="fc-dwrap">
        <div class="fc-dfacts">
            ${m.inNow > 0 ? fact(net >= 0 ? `<b class="pos">${Math.round(net / m.inNow * 100)}%</b> of what comes in is kept` : `<b class="neg">${moneyShort(-net)}</b> more goes out than comes in`) : ''}
            ${earnShare === null ? '' : fact(`Earnings pay <b>${earnShare}%</b> of what goes out`, 'What your money earns this month, set against what goes out')}
            ${cover === null ? '' : fact(`Cash covers <b>${cover.toFixed(1)} months</b> of this spending`)}
            ${fact(`Net worth <b class="${toneOf(nwChange)}">${nwChange >= 0 ? '+' : '−'}${moneyShort(Math.abs(nwChange))}</b>`)}
            <a class="fc-dlink" href="#/planning" title="Change the budgets the expenses come from">${icon('target')}Budgets</a>
        </div>
        <div class="fc-dgrid">${CARDS.map(c => summaryCard(c, c.summary(m))).join('')}</div>
    </div>`;
}

// ===================================================================== the summary cards

/** A change against the month before: down is good for what goes out. */
function delta(m, now, before, goodUp = true) {
    if (!m.prev || !Math.round(before) || Math.abs(now - before) < 1) return '';
    const up = now > before;
    return `<em class="fc-delta ${up === goodUp ? 'pos' : 'neg'}" title="Against ${monthLabel(m.prev.month)}">${up ? '▲' : '▼'} ${moneyShort(Math.abs(now - before))}</em>`;
}

/** A bar of what makes the figure up: [label, amount, colour]; nothing above zero, no bar but its place is kept. */
function stack(parts) {
    const shown = parts.filter(p => p[1] >= 1);
    const total = shown.reduce((t, p) => t + p[1], 0);
    return `<span class="fm-sum-bar">${shown.map(([label, v, color]) => `<i style="width:${(v / total * 100).toFixed(1)}%;background:${color}" title="${esc(`${label} ${rupees(v)} · ${Math.round(v / total * 100)}%`)}"></i>`).join('')}</span>`;
}

const sumLine = (label, value, cls = '') => `<span class="fm-sum-line"><span title="${esc(label)}">${esc(label)}</span><b class="${cls}">${value}</b></span>`;

function summaryCard({ cols, iconName, title }, { value, tone = '', change = '', note = '', bar, lines = [], more = 0, empty = '', warn = false }) {
    return `<button type="button" class="fm-sum ${warn ? 'warn' : ''}" data-fm-max="${cols}" title="Open the whole table">
        <span class="fm-sum-head">${icon(iconName)}<span>${title}</span>${icon('maximize')}</span>
        <span class="fm-sum-figure"><b class="${tone}">${value}</b>${change}</span>
        <small class="fm-sum-note">${note || '&nbsp;'}</small>
        ${bar}
        <span class="fm-sum-lines">${lines.join('') || `<span class="fm-sum-empty">${empty}</span>`}${more > 0 ? `<span class="fm-sum-more">+${more} more</span>` : ''}</span>
    </button>`;
}

function cashSummary(m) {
    const { r, open, net, inNow, outNow, buffer } = m;
    const low = r.liquid < buffer;
    return { value: rupees(r.liquid), warn: low, note: low ? `<span class="neg">${moneyShort(buffer - r.liquid)} below the buffer</span>` : `${moneyShort(r.liquid - buffer)} above the buffer`,
        bar: stack([['Money in', inNow, IN_COLOR], ['Money out', outNow, OUT_COLOR]]),
        lines: [sumLine('At the start', rupees(open)), sumLine('Money in', `+${rupees(inNow)}`, 'pos'), sumLine('Money out', `−${rupees(outNow)}`, 'neg'), sumLine('Change', signed(net), toneOf(net))] };
}

function outSummary(m) {
    const { outNow, inNow, outBefore } = m;
    const items = outItems(m);
    const sumOf = kind => items.filter(x => x.kind === kind).reduce((t, x) => t + x.amount, 0);
    return { value: rupees(outNow), change: delta(m, outNow, outBefore, false), note: inNow > 0 ? `${Math.round(outNow / inNow * 100)}% of what comes in` : 'nothing comes in',
        bar: stack([['Expenses', sumOf('expense'), 'var(--series-1)'], ['Chits', sumOf('chit'), 'var(--series-2)'], ['EMIs & SIPs', sumOf('emi'), 'var(--series-4)']]),
        lines: items.slice(0, 3).map(x => sumLine(x.name, rupees(x.amount))), more: items.length - 3, empty: 'Nothing goes out' };
}

function earnSummary(m) {
    const { r, prev } = m;
    const parts = [['savings', r.earn.savings], ['deposits', r.earn.deposits], ['given', r.earn.given]].map(([s, v]) => [SOURCE_LABEL[s], v, SOURCE_COLOR[s]]);
    parts.push(['Chits', r.earn.chits + r.earn.dividends, SOURCE_COLOR.chits]);
    const shown = parts.filter(p => p[1] >= 1).sort((a, b) => b[1] - a[1]);
    return { value: rupees(r.earned), tone: 'pos', change: delta(m, r.earned, prev ? prev.earned : 0), note: `${rupees(r.cash.interest)} reaches cash`, bar: stack(shown),
        lines: shown.map(([label, v]) => sumLine(label, rupees(v))), empty: 'Nothing earned' };
}

function calendarSummary({ r }) {
    const cameIn = r.events.filter(e => e.amount >= 0).reduce((t, e) => t + e.amount, 0);
    const wentOut = r.events.filter(e => e.amount < 0).reduce((t, e) => t - e.amount, 0);
    return { value: r.events.length ? signed(cameIn - wentOut) : '—', tone: r.events.length ? toneOf(cameIn - wentOut) : '', note: r.events.length ? `net of ${plural(r.events.length, 'dated item')}` : '',
        bar: stack([['Comes in', cameIn, IN_COLOR], ['Goes out', wentOut, OUT_COLOR]]),
        lines: r.events.slice(0, 3).map(e => sumLine(`${e.date.slice(8, 10)} · ${e.title}`, signed(e.amount), toneOf(e.amount))), more: r.events.length - 3, empty: 'Nothing dated' };
}

function chitSummary({ r }) {
    const interest = r.chitItems.reduce((t, x) => t + x.interest, 0);
    const dividend = r.chitItems.reduce((t, x) => t + x.dividend, 0);
    return { value: r.chitItems.length ? rupees(interest + dividend) : '—', tone: r.chitItems.length ? 'pos' : '', note: r.chitItems.length ? `of ${plural(r.chitItems.length, 'chit')} · ${rupees(r.chitRun)} so far` : '',
        bar: stack([['Interest', interest, SOURCE_COLOR.chits], ['Dividend', dividend, SOURCE_COLOR.dividends]]),
        lines: r.chitItems.slice(0, 3).map(x => sumLine(x.name, rupees(x.amount))), more: r.chitItems.length - 3, empty: 'Nothing earned' };
}

// ===================================================================== the tables, maximized

/** A table of the month: its head, its rows (scrolling), its foot. `cols` names the grid of its rows (forecast-plus.css). */
const card = ({ cols, sub = '', heads = [], rows, empty, foot }) => ({ sub, html: `<section class="fc-dcard fm-${cols}">
    <div class="fm-scroll">
        ${heads.length ? `<div class="fm-row fm-head">${heads.map(h => `<span>${h}</span>`).join('')}</div>` : ''}
        ${rows || `<p class="fm-empty">${empty}</p>`}
    </div>
    <div class="fm-foot">${foot.join('')}</div>
</section>` });

/** A row at the foot: the total, or a figure that goes with it. */
const footRow = (label, cells, strong = false) => `<div class="fm-row ${strong ? 'fm-total' : 'fm-sub'}"><span>${label}</span>${cells.map(c => `<b>${c}</b>`).join('')}</div>`;

const period = m => (m.span > 1 ? 'these months' : 'this month');

function cashCard(m) {
    const { r, open, net, basisLabel, first } = m;
    // interest that reached cash (repaid principal and deposits are maturities)
    const credited = r.cash.savings + r.cash.given - (r.cash.back - r.cash.deposits);
    let balance = open;
    const line = (label, v, note = '') => {
        if (!Math.round(v)) return '';
        balance += v;
        return `<div class="fm-row"><span class="min-0" title="${esc(label)}${note ? ` · ${esc(note)}` : ''}">${label}${note ? `<small>${note}</small>` : ''}</span><b class="${toneOf(v)}">${signed(v)}</b><em>${rupees(balance)}</em></div>`;
    };
    const rows = [
        `<div class="fm-row fm-open"><span>At the start</span><b></b><em>${rupees(open)}</em></div>`,
        line('Recurring income', Number(r.incomeRecurring || 0)),
        line('Recorded income', Number(r.incomeRecorded || 0), basisLabel),
        line('Expenses', -Number(r.expenses), first ? 'budget left' : ''),
        line('Chit installments', -Number(r.chitInstallments)),
        line('Chit dividends', r.cash.dividends),
        line('Chit payouts', Number(r.chitPayouts)),
        line('EMIs & SIPs', -Number(r.transfersOut)),
        line('Transfers in', Number(r.transfersIn)),
        line('Interest credited', credited, r.cash.savings ? 'quarter end' : ''),
        line('Maturities & repayments', r.cash.back),
    ].join('');
    return card({ cols: 'cash', heads: ['', 'Amount', 'Balance'], rows,
        foot: [footRow(`Change in ${period(m)}`, [`<span class="${toneOf(net)}">${signed(net)}</span>`, '']),
            footRow('Cash & bank at the end', ['', rupees(r.liquid)], true)] });
}

/** What goes out, biggest first; `kind`: expense, chit or emi. */
function outItems({ r, outNow }) {
    const items = (r.expenseLines || []).map(l => ({ name: l.name, amount: Number(l.amount), badge: LINE_BASIS[l.basis], kind: 'expense' }));
    r.events.filter(e => e.kind === 'chit').forEach(e => items.push({ name: e.title.replace(/ · installment .*/, ''), amount: -e.amount,
        badge: [OTHER_BASIS.Chit[0], e.title.split(' · ')[1] || OTHER_BASIS.Chit[1]], kind: 'chit' }));
    if (Number(r.transfersOut)) items.push({ name: 'EMIs & SIPs', amount: Number(r.transfersOut), badge: OTHER_BASIS.Emi, kind: 'emi' });
    // so the table comes to the month's money out, whatever the lines leave over
    const rest = outNow - items.reduce((t, x) => t + x.amount, 0);
    if (Math.abs(rest) >= 1) items.push({ name: 'Other chit dues', amount: rest, badge: OTHER_BASIS.Chit, kind: 'chit' });
    // a chit with several dues in the time shown is one line
    const lines = new Map();
    items.forEach(x => {
        const line = lines.get(x.name);
        if (line) { line.amount += x.amount; line.count += 1; line.badge = OTHER_BASIS.Chit; } else lines.set(x.name, { ...x, count: 1 });
    });
    return [...lines.values()].sort((a, b) => b.amount - a.amount);
}

function outCard(m) {
    const { outNow, inNow } = m;
    const shown = outItems(m);
    const max = Math.max(1, ...shown.map(x => x.amount));
    const rows = shown.map(x => `<div class="fm-row"><span class="min-0 ellipsis" title="${esc(x.name)}">${esc(x.name)}</span>
        <i class="fc-do-b b-${x.badge[0].toLowerCase()}" title="${esc(x.badge[1])}">${x.badge[0]}</i>
        <span class="fc-do-bar"><em style="width:${Math.max(0, x.amount / max * 100).toFixed(1)}%"></em></span>
        <b>${rupees(x.amount)}</b><em>${outNow > 0 ? Math.round(x.amount / outNow * 100) : 0}%</em></div>`).join('');
    return card({ cols: 'out', sub: plural(shown.length, 'item'),
        heads: ['', 'From', '', 'Amount', 'Share'], rows, empty: `Nothing goes out in ${period(m)}.`,
        foot: [...(m.span > 1 ? [footRow('Average a month', [rupees(outNow / m.span), ''])] : []),
            footRow('Of the money coming in', [inNow > 0 ? rupees(inNow) : '—', inNow > 0 ? `${Math.round(outNow / inNow * 100)}%` : '']),
            footRow('Total going out', [rupees(outNow), outNow > 0 ? '100%' : ''], true)] });
}

function earnCard(m) {
    const { r } = m;
    const items = r.earnItems.filter(x => x.amount >= 1);
    const at = items.filter(x => x.base > 0 && x.rate > 0);
    const work = at.reduce((t, x) => t + x.base, 0);
    const yearly = work ? at.reduce((t, x) => t + x.base * x.rate, 0) / work : 0;
    const rows = items.map(x => `<div class="fm-row fm-two"><i class="fm-dot" style="background:${SOURCE_COLOR[x.source]}" title="${SOURCE_LABEL[x.source]}"></i>
        <span class="min-0"><b class="ellipsis" title="${esc(x.name)}">${esc(x.name)}</b><small class="ellipsis" title="${esc(x.note)}">${esc(x.note)}</small></span>
        <b class="pos">${rupees(x.amount)}</b><em>${rupees(x.run)}</em></div>`).join('');
    const chits = r.earn.chits + r.earn.dividends;
    const chitLine = chits >= 1 ? `<div class="fm-row fm-two"><i class="fm-dot" style="background:${SOURCE_COLOR.chits}" title="Chits"></i>
        <span class="min-0"><b>Chits</b><small>${plural(r.chitItems.length, 'chit')} · see What the chits earn</small></span>
        <b class="pos">${rupees(chits)}</b><em>${rupees(r.chitRun)}</em></div>` : '';
    return card({ cols: 'earn', sub: work ? `${moneyShort(work)} at work · ${yearly.toFixed(1)}% a year` : '',
        heads: ['', '', m.span > 1 ? 'These months' : 'This month', 'So far'], rows: rows + chitLine, empty: `Nothing earned in ${period(m)}.`,
        foot: [...(m.span > 1 ? [footRow('Average a month', [rupees(r.earned / m.span), ''])] : []),
            footRow(`Reaches cash in ${period(m)}`, [`<span class="pos">${rupees(r.cash.interest)}</span>`, '']),
            footRow('Total earned', [`<span class="pos">${rupees(r.earned)}</span>`, rupees(r.earnedRun)], true)] });
}

/** The chits one by one, biggest earner first. */
function chitCard(m) {
    const { r } = m;
    const items = r.chitItems;
    const total = key => items.reduce((t, x) => t + x[key], 0);
    const max = Math.max(1, ...items.map(x => x.amount));
    const amount = v => (Math.round(v) ? rupees(v) : '—');
    const rows = items.map(x => {
        return `<div class="fm-row"><span class="min-0"><b class="ellipsis" title="${esc(x.name)}">${esc(x.name)}</b></span>
        <span class="min-0 fm-muted ellipsis" title="${esc(x.organizer || '')}">${esc(x.organizer || '—')}</span>
        <em ${x.installment ? `title="Installment ${x.installment} of ${x.installments}"` : ''}>${x.installment ? `${x.installment}/${x.installments}` : '—'}</em>
        <em title="Paid in so far with the interest on it">${x.base === null ? '—' : rupees(x.base)}</em><em>${amount(x.interest)}</em><em title="The average dividend so far: it cuts the installment">${amount(x.dividend)}</em>
        <b class="pos">${rupees(x.amount)}</b>
        <span class="fc-do-bar"><em style="width:${(x.amount / max * 100).toFixed(1)}%"></em></span>
        <em>${rupees(x.run)}</em>
        <em title="Dividends reach cash at once, as a smaller installment">${x.interest < 1 ? '—' : x.maturity ? monthLabel(x.maturity.slice(0, 7)) : 'With the payout'}</em></div>`;
    }).join('');
    return card({ cols: 'chits', sub: items.length ? plural(items.length, 'chit') : '', empty: `The chits earn nothing in ${period(m)}.`,
        heads: ['Chit', 'Organizer', 'Inst.', 'Earning on', 'Interest', 'Dividend', m.span > 1 ? 'These months' : 'This month', '', 'So far', 'Interest to cash'], rows,
        foot: [footRow('All chits', ['', '', '', amount(total('interest')), amount(total('dividend')), `<span class="pos">${rupees(total('amount'))}</span>`, '', rupees(r.chitRun), ''], true)] });
}

function calendarCard(m) {
    const { r } = m;
    const cameIn = r.events.filter(e => e.amount >= 0).reduce((t, e) => t + e.amount, 0);
    const wentOut = r.events.filter(e => e.amount < 0).reduce((t, e) => t + e.amount, 0);
    const rows = r.events.map(e => `<div class="fm-row fm-two fc-ev ${e.kind}">
        <span class="fc-ev-date"><b>${e.date.slice(8, 10)}</b><small>${monthLabel(e.date.slice(0, 7)).split(' ')[0]}</small></span>
        ${icon(EVENT_ICON[e.kind] || 'calendar')}
        <span class="min-0"><b class="ellipsis" title="${esc(e.title)}">${esc(e.title)}</b><small class="ellipsis" title="${esc(e.note)}">${esc(e.note)}</small></span>
        <b class="${toneOf(e.amount)}">${signed(e.amount)}</b></div>`).join('');
    return card({ cols: 'cal', sub: plural(r.events.length, 'item'), rows,
        empty: `Nothing dated in ${period(m)}: income and spending at their usual level.`,
        foot: [footRow(`In ${money(Math.round(cameIn))} · out ${money(Math.abs(Math.round(wentOut)))}`, ['&nbsp;']),
            footRow('Net of the dated items', [`<span class="${toneOf(cameIn + wentOut)}">${signed(cameIn + wentOut)}</span>`], true)] });
}

const EARN_NOTE = 'Earned is what builds up in the month; savings interest reaches cash at the quarter end, deposit interest at maturity, chit interest with the payout.';
const BASIS_NOTE = () => Object.values(LINE_BASIS).map(([b, w]) => `<i class="fc-do-b b-${b.toLowerCase()}">${b}</i>${w}`).join(' · ');

const CARDS = [
    { cols: 'cash', iconName: 'transfer', title: 'Cash this month', short: 'Cash', summary: cashSummary, table: cashCard },
    { cols: 'out', iconName: 'wallet', title: 'Where it goes', short: 'Where it goes', summary: outSummary, table: outCard, note: BASIS_NOTE },
    { cols: 'earn', iconName: 'coins', title: 'What it earns', short: 'What it earns', summary: earnSummary, table: earnCard, note: () => EARN_NOTE },
    { cols: 'cal', iconName: 'calendar', title: 'On the calendar', short: 'Calendar', summary: calendarSummary, table: calendarCard },
    { cols: 'chits', iconName: 'chit', title: 'What the chits earn', short: 'Chits', summary: chitSummary, table: chitCard, note: () => EARN_NOTE },
];

/**
 * Several months as one: what flows is added up, what stands (the cash at the end, what has built up so far) is the last
 * month's, and the lines of one name become one line. The tables read it like a single month.
 */
function mergeMonths(list) {
    if (list.length === 1) return { ...list[0], span: 1 };
    const first = list[0], last = list[list.length - 1];
    const total = key => list.reduce((t, m) => t + Number(m.r[key] || 0), 0);
    const sumOf = get => { const keys = Object.keys(get(first.r)); return Object.fromEntries(keys.map(k => [k, list.reduce((t, m) => t + Number(get(m.r)[k] || 0), 0)])); };
    // the lines of the months by a key: the first keeps its words, `add` the amounts, the latest what stands
    const byKey = (get, keyOf, add, latest = []) => {
        const out = new Map();
        list.forEach(m => get(m.r).forEach(x => {
            const k = keyOf(x);
            if (!out.has(k)) { out.set(k, { ...x }); return; }
            const line = out.get(k);
            add.forEach(f => { line[f] = Number(line[f] || 0) + Number(x[f] || 0); });
            latest.forEach(f => { if (x[f] !== null && x[f] !== undefined) line[f] = x[f]; });
        }));
        return [...out.values()];
    };
    const r = { ...last.r,
        incomeRecurring: total('incomeRecurring'), incomeRecorded: total('incomeRecorded'), expenses: total('expenses'), chitInstallments: total('chitInstallments'),
        chitPayouts: total('chitPayouts'), transfersOut: total('transfersOut'), transfersIn: total('transfersIn'), earned: total('earned'),
        cash: sumOf(x => x.cash), earn: sumOf(x => x.earn),
        expenseLines: byKey(x => x.expenseLines || [], l => l.name, ['amount']),
        events: list.flatMap(m => m.r.events),
        earnItems: byKey(x => x.earnItems, i => `${i.source}:${i.name}`, ['amount'], ['run', 'note', 'base', 'rate']),
        chitItems: byKey(x => x.chitItems, i => i.name, ['interest', 'dividend', 'amount'], ['run', 'base', 'installment']).sort((a, b) => b.amount - a.amount) };
    const sumM = key => list.reduce((t, m) => t + m[key], 0);
    return { ...last, r, open: first.open, first: first.first, net: sumM('net'), inNow: sumM('inNow'), outNow: sumM('outNow'), span: list.length };
}

/**
 * The ranges of the maximized view, as in Expenses: the few most used, the rest behind ⋯, and exact months. From this
 * month's place in the calendar; `months` is what the forecast covers, and a range is cut to it.
 */
function monthRanges(months) {
    const now = isoDate().slice(0, 7);
    const y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
    const ym = (year, month) => { const d = new Date(year, month - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    const fy = m >= 4 ? y : y - 1;
    return [
        { key: 'this', label: 'This month', from: now, to: now, quick: true },
        { key: 'next', label: 'Next month', from: ym(y, m + 1), to: ym(y, m + 1), quick: true },
        { key: 'next3', label: 'Next 3 months', from: now, to: ym(y, m + 2), quick: true },
        { key: 'quarter', label: 'This quarter', from: ym(y, q), to: ym(y, q + 2), quick: true },
        { key: 'next6', label: 'Next 6 months', from: now, to: ym(y, m + 5) },
        { key: 'nextQuarter', label: 'Next quarter', from: ym(y, q + 3), to: ym(y, q + 5) },
        { key: 'year', label: 'This year', from: `${y}-01`, to: `${y}-12` },
        { key: 'nextYear', label: 'Next year', from: `${y + 1}-01`, to: `${y + 1}-12` },
        { key: 'fy', label: 'This FY', title: 'This financial year, April to March', from: `${fy}-04`, to: `${fy + 1}-03` },
        { key: 'nextFy', label: 'Next FY', title: 'Next financial year', from: `${fy + 1}-04`, to: `${fy + 2}-03` },
        { key: 'all', label: 'All', title: 'Every month of the forecast', from: months[0], to: months[months.length - 1] },
    ].map(p => ({ ...p, months: months.filter(x => x >= p.from && x <= p.to) }));
}

/**
 * A table maximized, over any months of the forecast. `cols` the table; `from`, `to` the months (one month if `to` is
 * left out); `preset` the range chosen. Its address: ...?card=out&from=2027-01&to=2027-03&range=next3, and Back closes it.
 */
export function openMonthTable({ cols, from, to, preset = null }, root) {
    const months = [...root.querySelectorAll('tr[data-fc-detail]')].map(tr => tr.dataset.fcDetail).filter(m => MONTHS.has(m));
    if (!months.length) return;
    const ranges = monthRanges(months);
    let shown = CARDS.find(c => c.cols === cols) || CARDS[0];
    let start = months.includes(from) ? months.indexOf(from) : 0;
    let end = months.includes(to) ? months.indexOf(to) : start;
    let range = ranges.some(r => r.key === preset) ? preset : null;
    let custom = preset === 'custom';
    let more = Boolean(range && !ranges.find(r => r.key === range).quick) || custom;
    let onAddress = null;
    openModal({ title: shown.title, iconName: shown.iconName, size: 'fm-maximized',
        body: '<div class="fm-maxnav"></div><div class="fm-maxbody"></div><p class="fc-dnote fm-maxnote"></p>',
        onClose: () => { window.removeEventListener('hashchange', onAddress); setQuery({ card: null, from: null, to: null, range: null }); },
        onOpen: modal => {
            const part = selector => modal.el.querySelector(selector);
            const draw = () => {
                const list = months.slice(start, end + 1).map(m => MONTHS.get(m));
                const m = mergeMonths(list);
                const { sub, html } = shown.table(m);
                const count = end - start + 1;
                const nameOfRange = count === 1 ? monthLabel(months[start]) : `${monthLabel(months[start])} – ${monthLabel(months[end])}`;
                part('[data-modal-title]').innerHTML = `${esc(count > 1 && shown.cols === 'cash' ? 'Cash' : shown.title)}${sub ? `<small class="fm-titlesub">${esc(sub)}</small>` : ''}`;
                part('.modal-icon').innerHTML = icon(shown.iconName);
                const chip = r => `<button type="button" class="seg-chip ${range === r.key ? 'active' : ''}" data-fm-range="${r.key}" ${r.months.length ? '' : 'disabled'} title="${esc(r.months.length ? r.title || r.label : `${r.label} is outside this forecast`)}">${r.label}</button>`;
                const quick = ranges.filter(r => r.quick);
                const rest = ranges.filter(r => !r.quick);
                const hiddenActive = !more && rest.find(r => r.key === range);
                part('.fm-maxnav').innerHTML = `
                    <div class="fm-maxline fm-maxtop">
                        <span class="seg-chips sm">${CARDS.map(c => `<button type="button" class="seg-chip ${c === shown ? 'active' : ''}" data-fm-tab="${c.cols}">${c.short}</button>`).join('')}</span>
                        <span class="fm-maxmonths"><button type="button" class="btn sm icon" data-fm-step="-1" ${start ? '' : 'disabled'} title="Earlier">${icon('chevron-left')}</button>
                            <b>${nameOfRange}</b>
                            <button type="button" class="btn sm icon" data-fm-step="1" ${end < months.length - 1 ? '' : 'disabled'} title="Later">${icon('chevron-right')}</button>
                            ${count > 1 ? `<small>${count} months</small>` : ''}</span>
                        <span class="seg-chips sm fm-maxranges">${quick.map(chip).join('')}${hiddenActive ? chip(hiddenActive) : ''}${more ? rest.map(chip).join('') : ''}
                            <button type="button" class="seg-chip" data-fm-more title="${more ? 'Fewer ranges' : 'More ranges'}">${more ? '‹' : '⋯'}</button>
                            <button type="button" class="seg-chip ${custom ? 'active' : ''}" data-fm-custom title="Pick the months">${icon('calendar')}</button></span>
                    </div>
                    ${custom ? `<div class="fm-maxline fm-maxwhen">
                        ${custom ? `<span class="pc-custom"><input type="month" data-fm-from value="${months[start]}" min="${months[0]}" max="${months[months.length - 1]}"><span>–</span><input type="month" data-fm-to value="${months[end]}" min="${months[0]}" max="${months[months.length - 1]}"></span>` : ''}
                    </div>` : ''}`;
                part('.fm-maxbody').innerHTML = html;
                part('.fm-maxnote').innerHTML = shown.note ? shown.note() : '';
                setQuery({ card: shown.cols, from: months[start], to: count > 1 ? months[end] : null, range: custom ? 'custom' : range });
                modal.el.focus({ preventScroll: true });   // the button just pressed is gone: ← → must still reach the dialog
            };
            // the window moves by its own length; it is then no longer the range chosen
            const step = by => {
                const size = end - start + 1;
                const to2 = Math.max(0, Math.min(months.length - size, start + by * size));
                if (to2 === start) return;
                start = to2; end = to2 + size - 1; range = null; custom = false;
                draw();
            };
            part('.fm-maxnav').addEventListener('click', e => {
                const move = e.target.closest('[data-fm-step]');
                if (move) { step(Number(move.dataset.fmStep)); return; }
                const tab = e.target.closest('[data-fm-tab]');
                if (tab) { shown = CARDS.find(c => c.cols === tab.dataset.fmTab); draw(); return; }
                if (e.target.closest('[data-fm-more]')) { more = !more; draw(); return; }
                if (e.target.closest('[data-fm-custom]')) { custom = true; range = null; draw(); return; }
                const pick = e.target.closest('[data-fm-range]');
                if (pick && !pick.disabled) {
                    const r = ranges.find(x => x.key === pick.dataset.fmRange);
                    start = months.indexOf(r.months[0]); end = months.indexOf(r.months[r.months.length - 1]);
                    range = r.key; custom = false;
                    draw();
                }
            });
            part('.fm-maxnav').addEventListener('change', e => {
                if (!e.target.matches('[data-fm-from], [data-fm-to]')) return;
                const a = months.indexOf(part('[data-fm-from]').value), b = months.indexOf(part('[data-fm-to]').value);
                if (a >= 0 && b >= a) { start = a; end = b; draw(); }
            });
            modal.el.tabIndex = -1;
            modal.el.addEventListener('keydown', e => {
                if (e.target.matches('input')) return;
                if (e.key === 'ArrowLeft') step(-1);
                if (e.key === 'ArrowRight') step(1);
            });
            onAddress = () => { if (!readQuery().get('card')) modal.close(); };   // Back closes it
            window.addEventListener('hashchange', onAddress);
            if (!readQuery().get('card')) history.pushState(history.state, '', routeHash(currentPath(), { ...Object.fromEntries(readQuery()), card: shown.cols }));
            draw();
        } });
}
