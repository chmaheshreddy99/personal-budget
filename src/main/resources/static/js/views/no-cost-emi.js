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
 * month-by-month statement, and the charts.
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
    return { price, cash, n, rate, billed, discount, emi, fee, fee0, feeGst, totalInterest, totalGst, total, extra, uncovered, trueRate, gain, earned, breakEven, stdEmi, stdInterest, stdCost, worth,
        headline, verdict, tone, rows, savings, given };
}

// ---------------------------------------------------------------- the page

const field = (name, label, value, hint = '', attrs = '') => `<label class="nc-f"><span class="nc-l">${label}</span><input name="${name}" type="number" inputmode="decimal" step="any" min="0" value="${value ?? ''}" ${attrs}>${hint ? `<span class="nc-h">${hint}</span>` : ''}</label>`;

function inputsPanel(c, savings, plans) {
    const options = plans.map(p => `<option value="${p.id}">${esc(p.narration)} · ${money(p.principal)} · ${p.months || (p.installments || []).length} months</option>`).join('');
    return panel({ title: 'The offer', iconName: 'cart', cls: 'nc-in', bodyClass: 'nc-scroll',
        body: `<form class="nc-form" onsubmit="return false" autocomplete="off">
            ${plans.length ? `<label class="nc-f"><span class="nc-l">Start from one of my EMIs</span><select name="plan"><option value="">Type an offer instead</option>${options}</select></label>` : ''}
            <div class="nc-step"><b>1</b> The purchase</div>
            ${field('price', 'List price ₹', c.price, 'the price on the product page, and what the EMIs add up to', 'autofocus')}
            ${field('cash', 'Price if paid in full today ₹', c.cash, 'UPI / debit card / cash; empty = the list price')}
            <div class="nc-step"><b>2</b> The card's EMI</div>
            <div class="nc-pair">${field('months', 'Months', c.months, '', 'min="1" max="60" step="1"')}${field('rate', 'EMI rate % a year', c.rate, 'on the offer')}</div>
            ${field('discount', 'Instant discount ₹', c.discount, 'the interest taken off at billing; empty = exactly the interest')}
            <div class="nc-pair">${field('fee', 'Processing fee ₹', c.fee, 'charged once')}${field('gstPct', 'GST %', c.gstPct, 'on interest and fee')}</div>
            <div class="nc-step"><b>3</b> Your bank</div>
            ${field('savings', 'Your money earns % a year', savings, 'credited every month', 'max="20"')}
            <p class="nc-note">${icon('info')} The merchant charges your card the price <i>less</i> the interest; the bank turns that into an EMI at the rate it took off. The EMIs add up to the list price, so the interest is the discount you did not get. GST on the interest, and the fee, are what you pay extra.</p>
        </form>` });
}

const flowStep = (n, title, big, sub) => `<div class="nc-fs"><span class="nc-fn">${n}</span><small>${title}</small><b>${big}</b><em>${sub}</em></div>`;

function resultHtml(a) {
    if (!(a.price > 0)) return `<div class="nc-empty">${icon('percent')}<b>Enter an offer</b><p>Put in the list price, the months and the card's EMI rate (or pick one of your own EMIs). You get the verdict, how the card bills it month by month and the same months against your bank.</p></div>`;
    const sign = v => `${v >= 0 ? '+' : '−'}${money(Math.round(Math.abs(v)))}`;
    const flow = `<div class="nc-flow">
        ${flowStep(1, 'List price', money(Math.round(a.price)), a.cash !== a.price ? `${money(Math.round(a.cash))} if paid today` : 'the same if paid today')}
        <span class="nc-arrow">${icon('chevron-right')}</span>
        ${flowStep(2, 'Billed to your card', money(Math.round(a.billed)), `less ${money(Math.round(a.discount))} discount`)}
        <span class="nc-arrow">${icon('chevron-right')}</span>
        ${flowStep(3, `Becomes ${a.n} EMIs`, `${money(Math.round(a.emi))} / month`, `at ${percent(a.rate, 1)} · interest ${money(Math.round(a.totalInterest))}`)}
        <span class="nc-arrow">${icon('chevron-right')}</span>
        ${flowStep(4, 'You pay in all', money(Math.round(a.total)), `incl. GST ${money(Math.round(a.totalGst))} + fee ${money(Math.round(a.fee))}`)}
    </div>`;
    const cards = [
        ['percent', 'True yearly cost', percent(a.trueRate, 1), `your bank pays ${percent(a.savings, 1)} · a normal card EMI costs ${percent(a.rate, 1)}`, a.trueRate < a.savings ? 'good' : 'warn'],
        ['cart', 'Extra over paying today', money(Math.round(Math.max(0, a.extra))), `GST ${money(Math.round(a.totalGst))} + fee ${money(Math.round(a.fee))}${a.uncovered > 0.5 ? ` + ${money(Math.round(a.uncovered))} interest not covered` : ''}`, a.extra > 0.5 ? 'warn' : 'good'],
        ['piggy', 'Your bank pays you', `+${money(Math.round(a.earned))}`, `credited monthly on the ${money(Math.round(a.cash))} you keep, at ${percent(a.savings, 1)}`, 'good'],
        [a.gain >= 0 ? 'trending' : 'trending-down', 'In the bank after the last EMI', sign(a.gain), a.gain >= 0 ? 'the EMI beats paying today' : 'paying today beats the EMI', a.gain >= 0 ? 'good' : 'warn'],
        ['scale', 'The discount saves you', sign(a.worth), `against a normal ${percent(a.rate, 1)} card EMI that would cost ${money(Math.round(a.stdCost))}`, a.worth >= 0 ? 'good' : 'warn'],
    ];
    return `${flow}
        <div class="nc-verdict ${a.tone}">${icon(a.tone === 'good' ? 'check-circle' : 'alert')}<div><b>${esc(a.headline)}</b><p>${esc(a.verdict)}</p></div></div>
        <div class="nc-cards">${cards.map(([ic, l, v, s, t]) => `<div class="nc-card ${t}"><span class="nc-ico">${icon(ic)}</span><div><small>${l}</small><b>${v}</b><em>${s}</em></div></div>`).join('')}</div>
        <p class="nc-break">${icon('flag')} <b>Break-even:</b> paying in full wins when today's price is below <b>${money(Math.round(a.breakEven))}</b>
            (${a.price ? percent((1 - a.breakEven / a.price) * 100, 1) : '0%'} under the list price); above that the EMI wins.</p>`;
}

function statementPanel(a) {
    if (!(a.price > 0)) return '';
    const r0 = v => money(Math.round(v));
    const last = a.rows[a.rows.length - 1];
    const body = a.rows.map(r => `<tr class="${r.k === 0 ? 'nc-start' : ''}">
        <td class="nc-m">${esc(r.label)}</td>
        <td class="r">${r0(r.dues)}</td><td class="r">${r.k ? r0(r.principal) : '—'}</td><td class="r">${r.k ? r0(r.interest) : '—'}</td><td class="r">${r.gst ? r0(r.gst) : '—'}</td><td class="r"><b>${r0(r.debit)}</b></td>
        <td class="r nc-bk">${r0(r.bankOpen)}</td><td class="r pos">${r.credit ? '+' + r0(r.credit) : '—'}</td><td class="r nc-bk"><b class="${r.bankClose < 0 ? 'neg' : ''}">${r0(r.bankClose)}</b></td></tr>`).join('');
    return panel({ title: 'Month by month: the card statement and your bank', iconName: 'list', cls: 'nc-tbl', bodyClass: 'flush', sub: `${a.n} statements`,
        body: `<div class="nc-tscroll"><table class="grid compact dense nc-grid">
            <thead><tr><th>When</th><th class="r"><small>Card</small>Dues after</th><th class="r"><small>Card</small>Principal</th><th class="r"><small>Card</small>Interest*</th><th class="r"><small>Card</small>GST</th><th class="r"><small>Card</small>Debit</th>
                <th class="r nc-bk"><small>Your bank</small>Opening</th><th class="r nc-bk"><small>Your bank</small>Interest in</th><th class="r nc-bk"><small>Your bank</small>Closing</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr><th>Total</th><td></td><td class="r">${r0(a.billed)}</td><td class="r">${r0(a.totalInterest)}</td><td class="r">${r0(a.totalGst)}</td><td class="r"><b>${r0(last.paid)}</b></td><td></td><td class="r pos"><b>+${r0(a.earned)}</b></td><td class="r"><b>${r0(a.gain)}</b></td></tr></tfoot>
        </table></div><p class="nc-fine">* The interest is taken off the price at billing (the instant discount), so it is not an extra cost; GST on it is.</p>` });
}

const SERIES = [{ label: 'Your money in the bank', color: 'var(--series-1)' }, { label: 'Card dues', color: 'var(--series-2)' }];

function picturePanel(a, savings) {
    if (!(a.price > 0)) return panel({ title: 'The picture', iconName: 'trending', cls: 'nc-charts', body: '<p class="muted nc-pad">Charts appear once there is an offer.</p>' });
    const tips = [0, 2, 5, 8].map(d => ({ d, a: analyseNoCost({ ...a.input, cash: a.price * (1 - d / 100) }, savings) }));
    const cover = [100, 75, 50, 0].map(p => ({ p, a: analyseNoCost({ ...a.input, discount: Math.max(0.0001, a.discount * p / 100), cash: a.cash }, savings) }));
    return panel({ title: 'The picture', iconName: 'trending', cls: 'nc-charts', bodyClass: 'nc-scroll',
        body: `<div class="nc-chart-box"><h4>Your money and the card dues</h4>${legend(SERIES)}<div class="chart" id="nc-paths"></div></div>
            <div class="nc-chart-box"><h4>Each statement: EMI, GST</h4>${legend([{ label: 'Principal + interest', color: 'var(--series-1)' }, { label: 'GST', color: 'var(--series-3)' }])}<div class="chart" id="nc-bars"></div></div>
            <div class="nc-chart-box"><h4>If paying today were cheaper</h4>
                <table class="grid compact dense nc-tips"><thead><tr><th>Pay-now discount</th>${tips.map(t => `<th class="r">${t.d}%</th>`).join('')}</tr></thead>
                <tbody><tr><th>Price today</th>${tips.map(t => `<td class="r">${moneyShort(Math.round(t.a.cash))}</td>`).join('')}</tr>
                <tr><th>True cost</th>${tips.map(t => `<td class="r ${t.a.trueRate < savings ? 'pos' : 'neg'}">${percent(t.a.trueRate, 1)}</td>`).join('')}</tr>
                <tr><th>Better</th>${tips.map(t => `<td class="r"><span class="badge ${t.a.gain > 0 ? 'good' : 'warning'}">${t.a.gain > 0 ? 'EMI' : 'Pay now'}</span></td>`).join('')}</tr></tbody></table></div>
            <div class="nc-chart-box"><h4>If the discount covered less of the interest</h4>
                <table class="grid compact dense nc-tips"><thead><tr><th>Discount covers</th>${cover.map(t => `<th class="r">${t.p}%</th>`).join('')}</tr></thead>
                <tbody><tr><th>Extra cost</th>${cover.map(t => `<td class="r">${moneyShort(Math.round(Math.max(0, t.a.extra)))}</td>`).join('')}</tr>
                <tr><th>True cost</th>${cover.map(t => `<td class="r ${t.a.trueRate < savings ? 'pos' : 'neg'}">${percent(t.a.trueRate, 1)}</td>`).join('')}</tr></tbody></table></div>` });
}

/** Draws the analyzer into `host` and keeps it live as the offer is typed. plans: my EMIs, to start from. */
export function mountNoCost(host, savings, onSavings, plans = []) {
    const saved = { ...DEFAULTS, ...getPref('noCostEmi', DEFAULTS) };
    delete saved.bankRate; delete saved.interest;
    host.className = 'nc-layout';
    host.innerHTML = `${inputsPanel(saved, savings, plans)}<div class="nc-mid" id="nc-mid"></div><div class="nc-right" id="nc-right"></div>`;
    const form = host.querySelector('.nc-form');
    const setField = (name, v) => { if (form[name]) form[name].value = v == null ? '' : v; };
    const run = () => {
        const v = Object.fromEntries([...new FormData(form)].filter(([k]) => k !== 'plan').map(([k, x]) => [k, x === '' ? '' : Number(x)]));
        const sv = Math.max(0, Number(v.savings) || 0);
        delete v.savings;
        setPref('noCostEmi', v);
        if (sv !== savings) { savings = sv; onSavings?.(sv); }
        const a = analyseNoCost(v, savings);
        a.input = v;
        host.querySelector('#nc-mid').innerHTML = resultHtml(a) + statementPanel(a);
        host.querySelector('#nc-right').innerHTML = picturePanel(a, savings);
        if (a.price > 0) {
            const labels = a.rows.map(r => r.k === 0 ? 'Today' : `M${r.k}`);
            lineChart(host.querySelector('#nc-paths'), { labels, format: moneyShort, includeZero: true,
                series: [{ name: SERIES[0].label, values: a.rows.map(r => Math.round(r.bankClose)) }, { name: SERIES[1].label, values: a.rows.map(r => Math.round(r.dues)) }] });
            const m = a.rows.slice(1);
            barChart(host.querySelector('#nc-bars'), { labels: m.map(r => `M${r.k}`), format: moneyShort,
                series: [{ name: 'Principal + interest', values: m.map(r => Math.round(a.emi)), color: 'var(--series-1)' }, { name: 'GST', values: m.map(r => Math.round(r.gst)), color: 'var(--series-3)' }] });
        }
    };
    form.addEventListener('input', e => {
        if (e.target.name === 'plan') {
            const p = plans.find(x => String(x.id) === e.target.value);
            if (p) {
                // one of my EMIs: its billed amount, months, rate and fee fill the offer
                const months = p.months || (p.installments || []).length || 6;
                setField('price', Math.round(Number(p.principal)));
                setField('cash', '');
                setField('months', months);
                setField('rate', Number(p.ratePercent) > 0 ? Number(p.ratePercent) : Number(form.rate.value) || 15);
                setField('fee', Number(p.processingFee) || 0);
                setField('discount', '');
            }
        }
        run();
    });
    run();
}
