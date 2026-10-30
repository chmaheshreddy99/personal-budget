/**
 * The no-cost EMI analyzer (Reports › EMI analysis › No-cost EMI), built on how a credit-card "No Cost EMI" really works:
 *
 *   1. the merchant charges the card the list price LESS the interest (an instant discount equal to the interest the bank will charge);
 *   2. the bank converts that card charge into an EMI at the stated yearly rate (the rate the merchant took off), over the months chosen;
 *   3. each month's statement carries the EMI, and GST on the interest part of it; a processing fee (and GST on it) is charged once.
 *
 * So the EMIs add up to the list price, the "interest" is the discount you did not get, and what you really pay extra is the GST and the fee
 * (and any interest the discount did not cover). It is set against what matters: keeping the money in your bank, where the interest is credited
 * every month while each EMI is paid from it, and a normal card EMI at the same rate without the merchant's discount.
 *
 * Inputs (remembered in this browser): the list price, the price if paid in full today, months, the card's EMI rate, the instant discount shown on the
 * offer (blank = exactly the interest), the processing fee, GST, and what your money earns in the bank (set on the page above). "Start from" fills
 * them from one of your own EMIs. The page fills the window in three columns that each scroll inside themselves: the offer, the verdict and the
 * month-by-month statement, and the tenure table, charts and what-ifs. An offer can be pinned and compared with the next one, and the result
 * copied as a sentence.
 */
import { panel, esc } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { lineChart, barChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';

const DEFAULTS = { price: '', cash: '', months: 6, rate: 15, discount: '', fee: 199, gstPct: 18 };

const pmt = (principal, ratePct, n) => {
    const r = ratePct / 100 / 12;
    return r === 0 ? principal / n : principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
};

/** The offer worked through month by month. `savings` is what the bank pays on money kept, a year. */
export function analyseNoCost(i, savings) {
    const price = Number(i.price) || 0, n = Math.max(1, Math.min(60, Math.round(Number(i.months) || 0))), rate = Math.max(0, Number(i.rate) || 0);
    const cash = Number(i.cash) > 0 ? Number(i.cash) : price, fee = Number(i.fee) || 0, g = (Number(i.gstPct) || 0) / 100;
    // the card is charged the price less the discount; blank discount = exactly the interest, so that the EMIs add up to the price
    const given = Number(i.discount) > 0 ? Number(i.discount) : null;
    let billed, discount;
    if (given == null) {
        const f = pmt(1, rate, n) * n;            // total repaid per 1 borrowed
        billed = price / f;
        discount = price - billed;
    } else { discount = given; billed = Math.max(0, price - given); }
    const emi = pmt(billed, rate, n);
    const m = rate / 100 / 12, sm = savings / 100 / 12;

    // the card statement
    let dues = billed, totalInterest = 0, totalGst = 0;
    const feeGst = fee * g, fee0 = fee + feeGst;
    const rows = [];
    let bank = cash - fee0, earned = 0, paid = fee0;
    rows.push({ k: 0, label: fee0 > 0 ? 'Fee, today' : 'Today', dues, principal: 0, interest: 0, gst: feeGst, debit: fee0, bankOpen: cash, credit: 0, bankClose: bank, paid });
    for (let k = 1; k <= n; k++) {
        const interest = dues * m, principal = emi - interest, gst = interest * g, debit = emi + gst;
        const open = bank, credit = open * sm;
        bank = open + credit - debit;
        earned += credit;
        dues = Math.max(0, dues - principal);
        totalInterest += interest;
        totalGst += gst;
        paid += debit;
        rows.push({ k, label: `Month ${k}`, dues, principal, interest, gst, debit, bankOpen: open, credit, bankClose: bank, paid });
    }
    totalGst += feeGst;
    {
        let credit = 0, gstSoFar = feeGst;
        const gap = emi * n - cash;   // the EMIs against today's price (0 when the discount covers the interest and today's price is the list price)
        rows.forEach(r => {
            credit += r.credit;
            if (r.k) gstSoFar += r.gst;
            r.adv = credit - gstSoFar - fee - gap * (r.k / n);
        });
    }
    const total = emi * n + totalGst + fee;                       // everything the card charges over the plan
    const extra = total - cash;                                    // what the plan costs over paying in full today
    const uncovered = Math.max(0, totalInterest - discount);       // interest the discount did not cover
    // the yearly rate at which the payments are worth the price paid today (an IRR on monthly cash flows)
    const f = x => { let v = 0; for (let k = 1; k <= n; k++) v += (emi + rows[k].gst) / Math.pow(1 + x, k); return v - (cash - fee0); };
    let lo = -0.2, hi = 1;
    for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
    const trueRate = (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
    const gain = bank;                                             // left in the bank after the last EMI
    const breakEven = fee0 + Array.from({ length: n }, (_, k) => (emi + rows[k + 1].gst) / Math.pow(1 + sm, k + 1)).reduce((a, b) => a + b, 0);
    // the same purchase as a normal card EMI at the same rate, without the merchant's discount
    const stdEmi = pmt(cash, rate, n), stdInterest = stdEmi * n - cash, stdCost = stdInterest * (1 + g) + fee0;
    const worth = stdCost - Math.max(0, extra);                    // what the merchant's discount saves against a normal EMI
    let headline, verdict, tone;
    if (extra <= 0.5 && gain >= 0) { headline = 'Take the EMI'; verdict = 'It costs nothing over paying in full, and your money keeps earning interest while you pay.'; tone = 'good'; }
    else if (gain > 0) { headline = 'The EMI pays'; verdict = `The extras (GST and fee) cost ${percent(trueRate, 1)} a year, less than the ${percent(savings, 1)} your bank pays on the money you keep, so you finish ${money(Math.round(gain))} ahead of paying today.`; tone = 'good'; }
    else if (trueRate < rate) { headline = 'Pay in full if you can'; verdict = `The "no-cost" EMI really costs ${money(Math.round(extra))} (${percent(trueRate, 1)} a year): far cheaper than a normal ${percent(rate, 1)} card EMI, but more than your bank pays. Paying today leaves you ${money(Math.round(-gain))} better off.`; tone = 'warning'; }
    else { headline = 'Avoid it'; verdict = `The "no-cost" EMI costs ${money(Math.round(extra))} (${percent(trueRate, 1)} a year): the discount does not cover the interest. Paying today leaves you ${money(Math.round(-gain))} better off.`; tone = 'critical'; }
    const breakMonth = (rows.find(r => r.k > 0 && r.adv >= 0) || {}).k ?? null;
    return { breakMonth, price, cash, n, rate, billed, discount, emi, fee, fee0, feeGst, totalInterest, totalGst, total, extra, uncovered, trueRate, gain, earned, breakEven, stdEmi, stdInterest, stdCost, worth,
        headline, verdict, tone, rows, savings, given };
}

// ---------------------------------------------------------------- the page

const RATES = [13, 14, 15, 16, 18], FEES = [0, 99, 199, 299], MONTHS = [3, 6, 9, 12, 18, 24];
const r0 = v => money(Math.round(v));
const sign = v => `${v >= 0 ? '+' : '−'}${money(Math.round(Math.abs(v)))}`;
const chips = (name, values, current, fmt) => `<div class="nc-chips" data-chips="${name}">${values.map(v => `<button type="button" class="nc-chip ${Number(current) === v ? 'on' : ''}" data-v="${v}">${fmt(v)}</button>`).join('')}</div>`;
const field = (name, label, value, hint = '', attrs = '', extra = '') => `<label class="nc-f"><span class="nc-l">${label}<b class="nc-echo" data-echo="${name}"></b></span><input name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${value ?? ''}" ${attrs}>${extra}${hint ? `<span class="nc-h">${hint}</span>` : ''}</label>`;

function inputsPanel(c, savings, plans) {
    const options = plans.map(p => `<option value="${p.id}">${esc(p.narration)} · ${money(p.principal)}</option>`).join('');
    const more = Number(c.cash) > 0 || Number(c.discount) > 0 || (c.gstPct !== '' && Number(c.gstPct) !== 18);
    return panel({ title: 'The offer', iconName: 'cart', cls: 'nc-in', bodyClass: 'nc-scroll',
        actions: `<span class="nc-tip" title="The card is charged the price less the interest (the instant discount); the bank then takes it back as EMIs, so you pay the price, plus GST on the interest and the fee.">${icon('info')}</span>`,
        body: `<form class="nc-form nc-form2" onsubmit="return false" autocomplete="off">
            ${plans.length ? `<label class="nc-f nc-row"><span class="nc-l">From my EMIs</span><select name="plan"><option value="">New offer</option>${options}</select></label>` : ''}
            ${field('price', 'Price ₹', c.price, '', 'autofocus placeholder="60000"')}
            ${field('months', 'Months', c.months, '', 'min="1" max="60" step="1"', chips('months', MONTHS, c.months, v => `${v}`))}
            ${field('rate', 'EMI rate %', c.rate, '', '', chips('rate', RATES, c.rate, v => `${v}%`))}
            ${field('fee', 'Processing fee ₹', c.fee, '', '', chips('fee', FEES, c.fee, v => v ? `₹${v}` : 'None'))}
            ${field('savings', 'My bank pays %', savings, '', 'max="20"', chips('savings', [3, 4, 6.5, 7.25], savings, v => `${v}%`))}
            <details class="nc-more" ${more ? 'open' : ''}><summary>More options</summary>
                ${field('cash', 'Price if paid today ₹', c.cash, '', 'placeholder="same"')}
                ${field('discount', 'Instant discount ₹', c.discount, '', 'placeholder="= interest"')}
                ${field('gstPct', 'GST %', c.gstPct, '', 'placeholder="18"')}
            </details>
        </form>` });
}

/** In plain words, for the top of the page and for "Copy summary". */
function summary(a) {
    const where = a.gain >= 0 ? `you finish ${money(Math.round(a.gain))} ahead of paying today` : `paying today leaves you ${money(Math.round(-a.gain))} better off`;
    return `On ${money(Math.round(a.price))} over ${a.n} months at ${percent(a.rate, 1)}: your card is billed ${money(Math.round(a.billed))} and you pay ${a.n} × ${money(Math.round(a.emi))}`
        + ` plus ${money(Math.round(a.totalGst))} GST and a ${money(Math.round(a.fee))} fee, ${money(Math.round(a.total))} in all (${money(Math.round(Math.max(0, a.extra)))} more than ${money(Math.round(a.cash))} today).`
        + ` Keeping the money in a bank at ${percent(a.savings, 1)} earns ${money(Math.round(a.earned))} meanwhile, so ${where}.`;
}

function heroHtml(a) {
    const big = a.gain >= 0 ? `+${money(Math.round(a.gain))}` : `−${money(Math.round(-a.gain))}`;
    return `<div class="nc-hero ${a.tone}">
        <div class="nc-hero-main"><span class="nc-hero-ico">${icon(a.tone === 'good' ? 'check-circle' : 'alert')}</span>
            <div class="min-0"><small>Verdict</small><b>${esc(a.headline)}</b><p>${esc(a.verdict)}</p></div></div>
        <div class="nc-hero-num"><small>${a.gain >= 0 ? 'Ahead with the EMI' : 'Better off paying today'}</small><b>${big}</b><em>${a.breakMonth != null && a.gain >= 0 ? `break-even in month ${a.breakMonth}` : `true cost ${percent(a.trueRate, 1)} a year`}</em></div>
        <div class="nc-hero-acts"><button type="button" class="btn xs" data-nc="copy">${icon('copy')}Copy</button>
            <button type="button" class="btn xs" data-nc="pin">${icon('flag')}Pin to compare</button></div>
    </div>
    <details class="nc-plain"><summary>In plain words</summary>${esc(summary(a))}</details>`;
}

function kpis(a) {
    const cards = [
        ['cart', 'You pay extra', money(Math.round(Math.max(0, a.extra))), `GST ${r0(a.totalGst)} + fee ${r0(a.fee)}${a.uncovered > 0.5 ? ` + ${r0(a.uncovered)} interest not covered` : ''}`, a.extra > 0.5 ? 'warn' : 'good'],
        ['piggy', 'Your bank pays you', `+${r0(a.earned)}`, `on ${r0(a.cash)} kept, at ${percent(a.savings, 1)}`, 'good'],
        ['percent', 'True yearly cost', percent(a.trueRate, 1), `bank pays ${percent(a.savings, 1)} · normal card EMI ${percent(a.rate, 1)}`, a.trueRate < a.savings ? 'good' : 'warn'],
        ['scale', 'The discount saves you', sign(a.worth), `against a normal ${percent(a.rate, 1)} EMI costing ${r0(a.stdCost)}`, a.worth >= 0 ? 'good' : 'warn'],
    ];
    return `<div class="nc-cards">${cards.map(([ic, l, v, s, t]) => `<div class="nc-card ${t}"><span class="nc-ico">${icon(ic)}</span><div><small>${l}</small><b>${v}</b><em>${s}</em></div></div>`).join('')}</div>`;
}

function flowHtml(a) {
    const step = (n, title, big, sub) => `<div class="nc-fs"><span class="nc-fn">${n}</span><small>${title}</small><b>${big}</b><em>${sub}</em></div>`;
    return `<div class="nc-flow nc-flow2">
        ${step(1, 'List price', r0(a.price), a.cash !== a.price ? `${r0(a.cash)} if paid today` : 'same if paid today')}
        ${step(2, 'Billed to the card', r0(a.billed), `after ${r0(a.discount)} discount`)}
        ${step(3, `${a.n} EMIs of`, `${r0(a.emi)}`, `${percent(a.rate, 1)}: ${r0(a.totalInterest)} interest`)}
        ${step(4, 'You pay in all', r0(a.total), `${r0(a.totalGst)} GST · ${r0(a.fee)} fee`)}</div>`;
}

function pinnedHtml(a, pin, savings) {
    if (!pin) return '';
    const b = analyseNoCost(pin.input, savings);
    if (!(b.price > 0)) return '';
    const rows = [['List price', r0(b.price), r0(a.price)], ['Months · rate', `${b.n} · ${percent(b.rate, 1)}`, `${a.n} · ${percent(a.rate, 1)}`], ['Monthly EMI', r0(b.emi), r0(a.emi)],
        ['You pay in all', r0(b.total), r0(a.total)], ['Extra over today', r0(Math.max(0, b.extra)), r0(Math.max(0, a.extra))], ['True yearly cost', percent(b.trueRate, 1), percent(a.trueRate, 1)],
        ['In the bank at the end', sign(b.gain), sign(a.gain)]];
    const better = a.gain > b.gain + 0.5 ? 'this' : b.gain > a.gain + 0.5 ? 'pinned' : 'even';
    return panel({ title: 'Compared with the pinned offer', iconName: 'flag', bodyClass: 'flush', actions: '<button type="button" class="btn sm ghost" data-nc="unpin">Clear</button>',
        body: `<table class="grid compact dense nc-cmp"><thead><tr><th></th><th class="r ${better === 'pinned' ? 'win' : ''}">Pinned${better === 'pinned' ? ' ✓' : ''}</th><th class="r ${better === 'this' ? 'win' : ''}">This offer${better === 'this' ? ' ✓' : ''}</th></tr></thead>
            <tbody>${rows.map(([l, x, y]) => `<tr><th>${l}</th><td class="r">${x}</td><td class="r">${y}</td></tr>`).join('')}</tbody></table>
            <p class="nc-fine">${better === 'even' ? 'The two come out the same.' : `${better === 'this' ? 'This offer' : 'The pinned offer'} leaves you ${money(Math.round(Math.abs(a.gain - b.gain)))} better off.`}</p>` });
}

function statementPanel(a) {
    const last = a.rows[a.rows.length - 1];
    const body = a.rows.map(r => `<tr class="${r.k === 0 ? 'nc-start' : ''} ${a.breakMonth === r.k && a.gain >= 0 ? 'nc-be' : ''}">
        <td class="nc-m">${r.k === 0 ? 'Today' : `M${r.k}`}</td>
        <td class="r">${r.k ? r0(r.principal) : '—'}</td><td class="r nc-int">${r.k ? r0(r.interest) : '—'}</td><td class="r nc-gst">${r.gst ? r0(r.gst) : '—'}</td>
        <td class="r nc-deb">${r0(r.debit)}</td>
        <td class="r nc-bk pos">${r.credit ? '+' + r0(r.credit) : '—'}</td><td class="r nc-bk">${r0(r.bankClose)}</td>
        <td class="r"><b class="${r.adv >= 0 ? 'pos' : 'neg'}">${sign(r.adv)}</b></td></tr>`).join('');
    return panel({ title: 'Month by month', iconName: 'list', cls: 'nc-tbl', bodyClass: 'flush', sub: 'card statement · your bank · where you stand',
        body: `<div class="nc-tscroll"><table class="nc-st">
            <thead><tr class="nc-grp"><th></th><th colspan="4" class="c">Card statement</th><th colspan="2" class="c nc-bk">Your bank</th><th class="c">You</th></tr>
                <tr><th>Month</th><th class="r">Principal</th><th class="r">Interest*</th><th class="r">GST</th><th class="r">Debit</th><th class="r nc-bk">Interest in</th><th class="r nc-bk">Balance</th><th class="r">Ahead by</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr><th>Total</th><td class="r">${r0(a.billed)}</td><td class="r nc-int">${r0(a.totalInterest)}</td><td class="r nc-gst">${r0(a.totalGst)}</td><td class="r nc-deb">${r0(last.paid)}</td>
                <td class="r nc-bk pos">+${r0(a.earned)}</td><td class="r nc-bk">${r0(last.bankClose)}</td><td class="r"><b class="${a.gain >= 0 ? 'pos' : 'neg'}">${sign(a.gain)}</b></td></tr></tfoot>
        </table></div><p class="nc-fine">* Interest is taken off the price at billing (the instant discount), so it is not extra; the GST on it is. "Ahead by" compares with paying ${r0(a.cash)} today.</p>` });
}

function tenurePanel(a, savings) {
    const list = [...new Set([...MONTHS, a.n])].sort((x, y) => x - y).map(n => ({ n, b: analyseNoCost({ ...a.input, months: n }, savings) }));
    const best = list.reduce((x, y) => (y.b.gain > x.b.gain ? y : x), list[0]);
    return panel({ title: 'Which tenure is best?', iconName: 'calendar', bodyClass: 'flush',
        body: `<table class="grid compact dense nc-tips nc-ten"><thead><tr><th>Months</th><th class="r">EMI</th><th class="r">Extra</th><th class="r">Cost/yr</th><th class="r">Ahead</th></tr></thead>
            <tbody>${list.map(x => `<tr class="${x.n === a.n ? 'cur' : ''}"><th>${x.n}${x === best ? ' <span class="badge good">best</span>' : ''}</th><td class="r">${moneyShort(Math.round(x.b.emi))}</td>
                <td class="r">${moneyShort(Math.round(Math.max(0, x.b.extra)))}</td><td class="r ${x.b.trueRate < savings ? 'pos' : 'neg'}">${percent(x.b.trueRate, 1)}</td>
                <td class="r"><b class="${x.b.gain >= 0 ? 'pos' : 'neg'}">${x.b.gain >= 0 ? '+' : '−'}${moneyShort(Math.round(Math.abs(x.b.gain)))}</b></td></tr>`).join('')}</tbody></table>
            <p class="nc-fine">If the discount covers the interest at every tenure; shops offer no-cost only on some.</p>` });
}

function whatIfPanel(a, savings) {
    const tips = [0, 2, 5, 8].map(d => ({ d, b: analyseNoCost({ ...a.input, cash: a.price * (1 - d / 100) }, savings) }));
    const cover = [100, 75, 50, 0].map(p => ({ p, b: analyseNoCost({ ...a.input, discount: Math.max(0.0001, a.discount * p / 100), cash: a.cash }, savings) }));
    const row = (label, sub, b) => `<div class="nc-wi"><div class="min-0"><b>${label}</b><small>${sub}</small></div>
        <span class="nc-wi-v ${b.trueRate < savings ? 'pos' : 'neg'}">${percent(b.trueRate, 1)}</span>
        <span class="badge ${b.gain > 0 ? 'good' : 'warning'}">${b.gain > 0 ? `EMI +${moneyShort(Math.round(b.gain))}` : `Pay now +${moneyShort(Math.round(-b.gain))}`}</span></div>`;
    return panel({ title: 'What if…', iconName: 'sparkles', bodyClass: 'nc-scroll', body: `
        <h4 class="nc-h4">…paying today were cheaper</h4>
        ${tips.map(t => row(t.d ? `${t.d}% off for paying now` : 'No pay-now discount', `price today ${moneyShort(Math.round(t.b.cash))}`, t.b)).join('')}
        <h4 class="nc-h4">…the discount covered less of the interest</h4>
        ${cover.map(t => row(`Covers ${t.p}%`, `extra ${moneyShort(Math.round(Math.max(0, t.b.extra)))}`, t.b)).join('')}
        <p class="nc-fine">${icon('flag')} Paying in full wins when today's price is below <b>${r0(a.breakEven)}</b> (${a.price ? percent((1 - a.breakEven / a.price) * 100, 1) : '0%'} under the list price).</p>` });
}

/** The smallest bank rate at which the EMI still pays (bisection on the savings rate). */
function rateToBreakEven(a) {
    const gain = x => analyseNoCost(a.input, x).gain;
    if (gain(0) >= 0) return 0;
    if (gain(40) < 0) return null;
    let lo = 0, hi = 40;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (gain(mid) >= 0) hi = mid; else lo = mid; }
    return hi;
}

/** Plain, computed hints for the free space on the right: what to ask for, what to watch. */
function insightsPanel(a, savings, pin) {
    const list = [...new Set([...MONTHS, a.n])].map(n => ({ n, b: analyseNoCost({ ...a.input, months: n }, savings) }));
    const best = list.reduce((x, y) => (y.b.gain > x.b.gain ? y : x), list[0]);
    const noFee = a.fee > 0 ? analyseNoCost({ ...a.input, fee: 0 }, savings) : null;
    const need = rateToBreakEven(a);
    const items = [];
    if (best.n !== a.n && best.b.gain - a.gain >= 50) items.push(['calendar', 'good', `Ask for ${best.n} months`, `${sign(best.b.gain)} instead of ${sign(a.gain)}: ${money(Math.round(best.b.gain - a.gain))} more, if the shop offers no-cost for ${best.n}.`]);
    else items.push(['check-circle', 'good', `${a.n} months is the best tenure here`, 'No other common tenure leaves you further ahead.']);
    if (noFee && noFee.gain - a.gain >= 1) items.push(['cart', 'warn', `Ask them to waive the ${r0(a.fee)} fee`, `The fee and its GST cost ${money(Math.round(noFee.gain - a.gain))}: ${a.gain > 0 ? `${percent(Math.min(100, (noFee.gain - a.gain) / Math.max(1, noFee.gain) * 100), 0)} of what you gain` : 'enough to turn it in your favour' + (noFee.gain > 0 ? '' : ' (not quite)')}.`]);
    if (need != null) items.push(['piggy', need <= savings ? 'good' : 'warn', `Needs your money earning ${percent(need, 1)}+`, need <= savings ? `Your bank pays ${percent(savings, 1)}, so you are covered with ${percent(savings - need, 1)} to spare. Keep the cash in that account, not in the current account.` : `Your ${percent(savings, 1)} is not enough: move the money to a sweep FD or liquid fund, or pay today.`]);
    items.push(['card', 'info', `Card limit blocked: ${moneyShort(Math.round(a.billed))}`, `Freed by about ${moneyShort(Math.round(a.billed / a.n))} with each EMI; keep room for other spending in the first months.`]);
    items.push(['percent', 'info', `GST is the real cost: ${r0(a.totalGst)}`, `18% on ${r0(a.totalInterest)} of interest${a.fee ? ` and the ${r0(a.fee)} fee` : ''}: a "no-cost" EMI is never quite free.`]);
    if (a.breakMonth != null && a.gain >= 0) items.push(['flag', 'good', `Ahead from month ${a.breakMonth}`, 'Closing the EMI before that (foreclosure) would cost more than paying today did.']);
    else if (a.gain < 0) items.push(['alert', 'warn', 'Paying today is better', `Unless the shop gives at least ${money(Math.round(-a.gain))} more off, or your bank pays more.`]);
    const pinned = pinnedHtml(a, pin, savings);
    return `${panel({ title: 'Insights', iconName: 'bulb', cls: 'nc-ins', bodyClass: 'nc-scroll', body: `<div class="nc-ins-list">${items.map(([ic, tone, title, text]) => `<div class="nc-in-item ${tone}"><span>${icon(ic)}</span><div class="min-0"><b>${title}</b><p>${text}</p></div></div>`).join('')}</div>` })}${pinned}`;
}

function chartsPanel() {
    return panel({ title: 'The picture', iconName: 'trending', bodyClass: 'nc-scroll', body: `
        <div class="nc-chart-box"><h4>Where you stand against paying today</h4>${legend([{ label: 'Ahead by (₹)', color: 'var(--series-1)' }])}<div class="chart" id="nc-adv"></div></div>
        <div class="nc-chart-box"><h4>Each month: the bank's interest against the card's GST</h4>${legend([{ label: 'Bank interest in', color: 'var(--series-3)' }, { label: 'GST on the card', color: 'var(--series-2)' }])}<div class="chart" id="nc-bars"></div></div>` });
}

const EMPTY = `<div class="nc-empty">${icon('percent')}<b>Enter an offer</b><p>Put in the list price, the months and the card's EMI rate (or pick one of your own EMIs). You get the verdict in plain words, how the card bills it month by month, the same months against your bank, and which tenure is best.</p></div>`;

/** Draws the analyzer into `host` and keeps it live as the offer is typed. plans: my EMIs, to start from. */
export function mountNoCost(host, savings, onSavings, plans = []) {
    const saved = { ...DEFAULTS, ...getPref('noCostEmi', DEFAULTS) };
    delete saved.bankRate; delete saved.interest;
    host.className = 'nc-layout';
    host.innerHTML = `${inputsPanel(saved, savings, plans)}<div class="nc-mid" id="nc-mid"></div><div class="nc-right" id="nc-right"></div>`;
    const form = host.querySelector('.nc-form');
    const setField = (name, v) => { if (form[name]) form[name].value = v == null ? '' : v; };
    let current = null;
    let rtab = 'tenure';
    const run = () => {
        const v = Object.fromEntries([...new FormData(form)].filter(([k]) => k !== 'plan').map(([k, x]) => [k, x === '' ? '' : Number(x)]));
        const sv = Math.max(0, Number(v.savings) || 0);
        delete v.savings;
        setPref('noCostEmi', v);
        if (sv !== savings) { savings = sv; onSavings?.(sv); }
        // the chips follow what is typed, and big amounts are echoed in words-with-commas beside their label
        form.querySelectorAll('[data-chips]').forEach(box => {
            const val = box.dataset.chips === 'savings' ? sv : Number(v[box.dataset.chips]);
            box.querySelectorAll('.nc-chip').forEach(c => c.classList.toggle('on', Number(c.dataset.v) === val));
        });
        form.querySelectorAll('[data-echo]').forEach(e => {
            const x = Number(form[e.dataset.echo]?.value);
            e.textContent = ['price', 'cash', 'discount'].includes(e.dataset.echo) && x >= 1000 ? money(x) : '';
        });
        const a = analyseNoCost(v, savings);
        a.input = v;
        current = a;
        const mid = host.querySelector('#nc-mid'), right = host.querySelector('#nc-right');
        if (!(a.price > 0)) { mid.innerHTML = EMPTY; right.innerHTML = ''; return; }
        const pin = getPref('noCostPin', null);
        mid.innerHTML = heroHtml(a) + kpis(a) + flowHtml(a) + statementPanel(a);
        right.innerHTML = `<div class="nc-rtabs">${[['tenure', 'Tenures'], ['charts', 'Charts'], ['whatif', 'What if']].map(([k, l]) => `<button type="button" class="nc-rtab ${rtab === k ? 'on' : ''}" data-rtab="${k}">${l}</button>`).join('')}</div>`
            + (rtab === 'tenure' ? tenurePanel(a, savings) : rtab === 'charts' ? chartsPanel() : whatIfPanel(a, savings)) + insightsPanel(a, savings, pin);
        const labels = a.rows.map(r => (r.k === 0 ? 'Today' : `M${r.k}`));
        if (rtab === 'charts') lineChart(host.querySelector('#nc-adv'), { labels, format: moneyShort, includeZero: true, area: true, series: [{ name: 'Ahead by', values: a.rows.map(r => Math.round(r.adv)) }] });
        const m = a.rows.slice(1);
        if (rtab === 'charts') barChart(host.querySelector('#nc-bars'), { labels: m.map(r => `M${r.k}`), format: v2 => money(Math.round(v2)),
            series: [{ name: 'Bank interest in', values: m.map(r => Math.round(r.credit)), color: 'var(--series-3)' }, { name: 'GST on the card', values: m.map(r => Math.round(r.gst)), color: 'var(--series-2)' }] });
    };
    form.addEventListener('click', e => {
        const chip = e.target.closest('.nc-chip');
        if (!chip) return;
        setField(chip.closest('[data-chips]').dataset.chips, chip.dataset.v);
        run();
    });
    host.addEventListener('click', async e => {
        const tab = e.target.closest('[data-rtab]');
        if (tab) { rtab = tab.dataset.rtab; run(); return; }
        const act = e.target.closest('[data-nc]')?.dataset.nc;
        if (!act || !current) return;
        if (act === 'copy') {
            try { await navigator.clipboard.writeText(summary(current)); e.target.closest('button').textContent = 'Copied'; } catch { /* no clipboard: nothing to do */ }
        } else if (act === 'pin') { setPref('noCostPin', { input: current.input }); run(); }
        else if (act === 'unpin') { setPref('noCostPin', null); run(); }
    });
    form.addEventListener('input', e => {
        if (e.target.name === 'plan') {
            const p = plans.find(x => String(x.id) === e.target.value);
            if (p) {
                // one of my EMIs: its billed amount, months, rate and fee fill the offer
                setField('price', Math.round(Number(p.principal)));
                setField('cash', '');
                setField('months', p.months || (p.installments || []).length || 6);
                setField('rate', Number(p.ratePercent) > 0 ? Number(p.ratePercent) : Number(form.rate.value) || 15);
                setField('fee', Number(p.processingFee) || 0);
                setField('discount', '');
            }
        }
        run();
    });
    run();
}
