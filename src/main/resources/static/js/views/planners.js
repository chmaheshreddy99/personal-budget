/**
 * What-if planners shown on the Forecast page:
 *  - Chit illustrator: month-by-month auction model of a chit (bid discount, commission, dividend,
 *    cash paid) and what you gain or pay if you lift the prize in a given month.
 *  - Interest calculator: lump sum, monthly deposit and loan EMI, compound against simple interest,
 *    with an inflation-adjusted view.
 */
import { api } from '../core/api.js';
import { panel, table, esc, kpi } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { lineChart, legend } from '../core/charts.js';

// ===================================================================== shared

/**
 * Monthly rate r where the cash flows (index = month) are worth nothing today; null when there is none.
 * Flows of a mid-term chit lift change sign twice, so the range is scanned and the root closest to
 * zero is refined by bisection.
 */
function irr(flows) {
    const npv = r => flows.reduce((s, cf, t) => s + cf / Math.pow(1 + r, t), 0);
    let best = null;
    for (let lo = -0.3; lo < 0.6; lo += 0.005) {
        let a = lo, b = lo + 0.005, fa = npv(a);
        if (fa * npv(b) > 0) continue;
        for (let i = 0; i < 60; i++) {
            const mid = (a + b) / 2;
            const f = npv(mid);
            if (f * fa > 0) { a = mid; fa = f; } else b = mid;
        }
        const root = (a + b) / 2;
        if (best === null || Math.abs(root) < Math.abs(best)) best = root;
    }
    return best;
}

const annual = monthly => (Math.pow(1 + monthly, 12) - 1) * 100;

function numberField(label, name, value, { step = 'any', min = '', max = '', hint = '', suffix = '' } = {}) {
    return `<label class="field"><span>${esc(label)}</span>
        <div class="input-suffix"><input type="number" name="${name}" value="${value}" step="${step}" min="${min}" max="${max}" data-plain class="num">
        ${suffix ? `<i>${suffix}</i>` : ''}</div>${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function readNumbers(form) {
    const data = {};
    form.querySelectorAll('input[name], select[name]').forEach(el => {
        data[el.name] = el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
    });
    return data;
}

// ===================================================================== chit illustrator

const chitInputs = { value: 500000, members: 20, commission: 5, firstBid: 30, lastBid: 5, liftMonth: 10 };

/**
 * Month-by-month model. Each month the lowest bidder takes the chit value minus their bid discount.
 * The foreman keeps the commission out of that discount and the rest is shared by all members as a
 * dividend, which lowers that month's installment. Discounts fall from the first to the last month.
 */
export function illustrateChit({ value, members, commission, firstBid, lastBid }) {
    const n = Math.max(2, Math.round(members));
    const due = value / n;
    const commissionAmount = value * commission / 100;
    const rows = [];
    let paid = 0, dividends = 0;
    for (let k = 1; k <= n; k++) {
        const bidPercent = n === 1 ? firstBid : firstBid + (lastBid - firstBid) * (k - 1) / (n - 1);
        const discount = value * Math.max(bidPercent, commission) / 100;
        const dividend = Math.max(0, discount - commissionAmount) / n;
        const cash = due - dividend;
        paid += cash;
        dividends += dividend;
        rows.push({ month: k, bidPercent: Math.max(bidPercent, commission), discount, dividend, cash, paidSoFar: paid, prize: value - discount });
    }
    // what the whole chit looks like for someone who lifts in month m
    rows.forEach(row => {
        const flows = [0, ...rows.map(r => -r.cash)];   // flows[t] at month t
        flows[row.month] += row.prize;
        const rate = irr(flows);
        row.net = row.prize - paid;
        row.rate = rate === null ? null : annual(rate);
        row.borrower = rows.slice(0, row.month).reduce((s, r) => s + r.cash, 0) < row.prize / 2;
    });
    return { rows, due, totalPaid: paid, dividends, commissionAmount };
}

export async function renderChitIllustrator(el) {
    const chits = await api.get('/chits').catch(() => []);
    el.innerHTML = `
    <div class="planner chit-planner">
        ${panel({
            title: 'Chit illustrator', iconName: 'chit', cls: 'p-planner-form',
            body: `<form class="form-grid one planner-form" id="chit-ill-form">
                ${chits.length ? `<label class="field"><span>Start from my chit</span><select name="preset" data-plain>
                    <option value="">Custom</option>${chits.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>` : ''}
                ${numberField('Chit value', 'value', chitInputs.value, { step: 1000, suffix: '₹' })}
                <div class="form-grid two">
                    ${numberField('Members / months', 'members', chitInputs.members, { step: 1, min: 2, max: 120 })}
                    ${numberField('Commission', 'commission', chitInputs.commission, { step: 0.5, min: 0, max: 10, suffix: '%' })}
                    ${numberField('First month bid', 'firstBid', chitInputs.firstBid, { step: 1, min: 0, max: 40, suffix: '%', hint: 'Discount in the first auction' })}
                    ${numberField('Last month bid', 'lastBid', chitInputs.lastBid, { step: 1, min: 0, max: 40, suffix: '%', hint: 'Usually just the commission' })}
                </div>
                <label class="field"><span>Month you lift the prize <b id="lift-label"></b></span>
                    <input type="range" name="liftMonth" min="1" max="${chitInputs.members}" value="${chitInputs.liftMonth}" data-plain></label>
                <div class="planner-note">${icon('info')}<span>Each month the lowest bidder takes the chit value minus the bid discount. The foreman keeps the
                    commission from that discount and the rest is shared as a dividend, lowering everyone's installment.</span></div>
            </form>`,
        })}
        <div class="planner-out">
            <div class="kpis planner-kpis" id="chit-ill-kpis"></div>
            ${panel({ title: 'If you lift in each month', iconName: 'trending', cls: 'p-planner-chart', bodyClass: 'chart',
                      body: `<div class="chart-wrap">${legend([{ label: 'Prize received' }, { label: 'Total you pay' }, { label: 'Net gain' }])}<div class="chart" id="chit-ill-chart"></div></div>` })}
            ${panel({ title: 'Month by month', iconName: 'list', cls: 'p-planner-table', bodyClass: 'flush', body: '<div class="scroll" id="chit-ill-table"></div>' })}
        </div>
    </div>`;

    const form = el.querySelector('#chit-ill-form');
    const draw = () => {
        Object.assign(chitInputs, readNumbers(form));
        const slider = form.querySelector('[name=liftMonth]');
        slider.max = Math.max(2, Math.round(chitInputs.members));
        chitInputs.liftMonth = Math.min(Number(slider.value), Number(slider.max));
        form.querySelector('#lift-label').textContent = `· month ${chitInputs.liftMonth}`;

        const model = illustrateChit(chitInputs);
        const lift = model.rows[chitInputs.liftMonth - 1];
        const best = model.rows.reduce((m, r) => (r.net > m.net ? r : m), model.rows[0]);
        const breakEven = model.rows.find(r => r.net >= 0);
        el.querySelector('#chit-ill-kpis').innerHTML = `
            ${kpi({ label: 'You pay in total', value: money(Math.round(model.totalPaid)), iconName: 'arrow-out', tone: 'deep',
                    sub: `avg ${money(Math.round(model.totalPaid / model.rows.length))}/month · dividends ${moneyShort(model.dividends)}` })}
            ${kpi({ label: `Prize in month ${lift.month}`, value: money(Math.round(lift.prize)), iconName: 'gift', tone: 'gold',
                    sub: `${percent(lift.bidPercent, 1)} bid discount` })}
            ${kpi({ label: lift.net >= 0 ? 'You gain' : 'It costs you', value: `<span class="${lift.net >= 0 ? 'pos' : 'neg'}">${money(Math.round(Math.abs(lift.net)))}</span>`,
                    iconName: lift.net >= 0 ? 'trending' : 'trending-down', tone: lift.net >= 0 ? 'aqua' : 'coral', sub: 'Prize − everything you pay' })}
            ${kpi({ label: lift.rate === null ? 'Effective rate' : lift.borrower ? 'Like borrowing at' : 'Like saving at',
                    value: lift.rate === null ? 'Mixed' : `${percent(lift.rate, 1)} p.a.`, iconName: 'percent', tone: 'violet',
                    sub: lift.rate === null ? 'Money flows both ways; compare the net instead' : lift.borrower ? 'Money early, repaid by installments' : 'Effective annual return' })}
            ${kpi({ label: 'Smart pick', value: breakEven ? `Month ${breakEven.month}+` : '—', iconName: 'sparkles', tone: 'gold',
                    sub: breakEven ? `Lift from month ${breakEven.month} to come out ahead · best month ${best.month}` : 'Lifting never beats what you pay' })}`;

        lineChart(el.querySelector('#chit-ill-chart'), {
            labels: model.rows.map(r => String(r.month)), labelFormat: l => `M${l}`, format: moneyShort, includeZero: true,
            series: [
                { name: 'Prize received', values: model.rows.map(r => Math.round(r.prize)) },
                { name: 'Total you pay', values: model.rows.map(() => Math.round(model.totalPaid)), dashed: true },
                { name: 'Net gain', values: model.rows.map(r => Math.round(r.net)) },
            ],
        });

        el.querySelector('#chit-ill-table').innerHTML = table([
            { label: 'Month', render: r => `<b>${r.month}</b>` },
            { label: 'Bid discount', align: 'r', render: r => `${percent(r.bidPercent, 1)} <span class="muted small">${moneyShort(r.discount)}</span>` },
            { label: 'Dividend', align: 'r', render: r => `<span class="pos">${money(Math.round(r.dividend))}</span>` },
            { label: 'You pay', align: 'r', render: r => money(Math.round(r.cash)) },
            { label: 'Paid so far', align: 'r', render: r => `<span class="secondary">${money(Math.round(r.paidSoFar))}</span>` },
            { label: 'Prize if lifted', align: 'r', render: r => `<b>${money(Math.round(r.prize))}</b>` },
            { label: 'Net if lifted', align: 'r', render: r => `<b class="${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : '−'}${money(Math.round(Math.abs(r.net)))}</b>` },
            { label: 'Effective rate', align: 'r', render: r => r.rate === null ? '<span class="muted" title="No single rate: money flows in and out in both directions">mixed</span>' : `${percent(r.rate, 1)} <span class="muted small">${r.borrower ? 'cost' : 'return'}</span>` },
        ], model.rows, { dense: true, rowClass: r => (r.month === lift.month ? 'selected-row' : '') + (r.month === best.month ? ' best-row' : '') });
    };

    form.addEventListener('input', e => {
        if (e.target.name === 'preset') return;
        draw();
    });
    form.querySelector('[name=preset]')?.addEventListener('change', e => {
        const c = chits.find(x => String(x.id) === e.target.value);
        if (!c) return;
        const set = (name, v) => { form.querySelector(`[name=${name}]`).value = v; };
        set('value', c.maturityAmount);
        set('members', c.numberOfInstallments);
        if (c.commissionPercent !== null) set('commission', c.commissionPercent);
        form.querySelector('[name=liftMonth]').max = c.numberOfInstallments;
        set('liftMonth', Math.min(Math.max(1, c.installmentsPaid + 1), c.numberOfInstallments));
        draw();
    });
    draw();
}

// ===================================================================== interest calculator

const interestInputs = { mode: 'lumpsum', amount: 100000, rate: 7.5, years: 5, compounding: 'QUARTERLY', inflation: 6 };
const COMPOUNDING = { MONTHLY: 12, QUARTERLY: 4, HALF_YEARLY: 2, YEARLY: 1 };
const MODES = [
    { value: 'lumpsum', label: 'Lump sum', iconName: 'lock', hint: 'FD, bonds, one-time investment' },
    { value: 'monthly', label: 'Monthly deposit', iconName: 'repeat', hint: 'RD, SIP, chit-like saving' },
    { value: 'loan', label: 'Loan EMI', iconName: 'briefcase', hint: 'Home, car, personal loan' },
];

/** Year-by-year schedule for the chosen mode. */
export function calculateInterest({ mode, amount, rate, years, compounding, inflation }) {
    const months = Math.max(1, Math.round(years * 12));
    const perYear = COMPOUNDING[compounding] || 4;
    // monthly rate equivalent to the nominal rate compounded perYear times a year
    const monthly = Math.pow(1 + rate / 100 / perYear, perYear / 12) - 1;
    const simpleMonthly = rate / 1200;
    const rows = [];

    if (mode === 'loan') {
        const r = rate / 1200;
        const emi = r ? amount * r / (1 - Math.pow(1 + r, -months)) : amount / months;
        let balance = amount, interestPaid = 0, principalPaid = 0;
        for (let m = 1; m <= months; m++) {
            const interest = balance * r;
            const principal = Math.min(balance, emi - interest);
            balance -= principal;
            interestPaid += interest;
            principalPaid += principal;
            if (m % 12 === 0 || m === months) rows.push({ year: Math.ceil(m / 12), paid: emi * m, interest: interestPaid, principal: principalPaid, balance: Math.max(0, balance) });
        }
        return { mode, months, emi, totalPaid: emi * months, totalInterest: emi * months - amount, rows };
    }

    let value = 0, invested = 0, simpleValue = 0;
    for (let m = 1; m <= months; m++) {
        if (mode === 'lumpsum' && m === 1) { value = amount; invested = amount; }
        if (mode === 'monthly') { value += amount; invested += amount; }
        value *= 1 + monthly;
        if (m % 12 === 0 || m === months) {
            simpleValue = mode === 'lumpsum'
                ? amount * (1 + simpleMonthly * m)
                : amount * m + amount * simpleMonthly * (m * (m + 1) / 2);   // each deposit earns simple interest for the months it stays
            rows.push({ year: Math.ceil(m / 12), invested, value, simple: simpleValue, real: value / Math.pow(1 + inflation / 100, m / 12) });
        }
    }
    const last = rows[rows.length - 1];
    const effective = (Math.pow(1 + monthly, 12) - 1) * 100;
    return {
        mode, months, invested: last.invested, value: last.value, interest: last.value - last.invested,
        simple: last.simple, real: last.real, effective,
        doubling: Math.log(2) / Math.log(1 + effective / 100), rows,
    };
}

export function renderInterestCalculator(el) {
    el.innerHTML = `
    <div class="planner interest-planner">
        ${panel({
            title: 'Interest calculator', iconName: 'calculator', cls: 'p-planner-form',
            body: `<form class="form-grid one planner-form" id="int-form">
                <div class="mode-tiles">${MODES.map(m => `<button type="button" class="mode-tile ${m.value === interestInputs.mode ? 'active' : ''}" data-mode="${m.value}">
                    ${icon(m.iconName)}<b>${m.label}</b><small>${m.hint}</small></button>`).join('')}</div>
                <div id="int-fields"></div>
            </form>`,
        })}
        <div class="planner-out">
            <div class="kpis planner-kpis" id="int-kpis"></div>
            ${panel({ title: 'Growth over time', iconName: 'trending', cls: 'p-planner-chart', bodyClass: 'chart',
                      body: '<div class="chart-wrap"><div id="int-legend"></div><div class="chart" id="int-chart"></div></div>' })}
            ${panel({ title: 'Year by year', iconName: 'list', cls: 'p-planner-table', bodyClass: 'flush', body: '<div class="scroll" id="int-table"></div>' })}
        </div>
    </div>`;

    const form = el.querySelector('#int-form');
    const fields = () => {
        const loan = interestInputs.mode === 'loan';
        el.querySelector('#int-fields').innerHTML = `<div class="form-grid two">
            ${numberField(loan ? 'Loan amount' : interestInputs.mode === 'monthly' ? 'Monthly deposit' : 'Amount invested', 'amount', interestInputs.amount, { step: 500, suffix: '₹' })}
            ${numberField('Interest rate', 'rate', interestInputs.rate, { step: 0.05, min: 0, max: 60, suffix: '% p.a.' })}
            ${numberField(loan ? 'Tenure' : 'Duration', 'years', interestInputs.years, { step: 0.5, min: 0.5, max: 40, suffix: 'years' })}
            ${loan ? '' : `<label class="field"><span>Compounding</span><select name="compounding" data-plain>${Object.keys(COMPOUNDING).map(c =>
                `<option value="${c}" ${c === interestInputs.compounding ? 'selected' : ''}>${c.replace('_', '-').toLowerCase().replace(/^./, x => x.toUpperCase())}</option>`).join('')}</select></label>`}
            ${loan ? '' : numberField('Inflation', 'inflation', interestInputs.inflation, { step: 0.5, min: 0, max: 20, suffix: '%', hint: "Shows what the money is worth in today's prices" })}
        </div>`;
    };

    const draw = () => {
        Object.assign(interestInputs, readNumbers(form));
        const res = calculateInterest(interestInputs);
        const kpis = el.querySelector('#int-kpis');
        const labels = res.rows.map(r => String(r.year));
        if (res.mode === 'loan') {
            kpis.innerHTML = `
                ${kpi({ label: 'Monthly EMI', value: money(Math.round(res.emi)), iconName: 'calendar', tone: 'deep', sub: `${res.months} months` })}
                ${kpi({ label: 'Total interest', value: `<span class="neg">${money(Math.round(res.totalInterest))}</span>`, iconName: 'percent', tone: 'coral',
                        sub: `${percent((res.totalInterest / interestInputs.amount) * 100, 0)} of the loan` })}
                ${kpi({ label: 'Total you repay', value: money(Math.round(res.totalPaid)), iconName: 'arrow-out', tone: 'violet' })}
                ${kpi({ label: 'Smart tip', value: `${money(Math.round(res.emi * 0.1))} extra`, iconName: 'sparkles', tone: 'gold',
                        sub: `Paying 10% more each month saves about ${moneyShort(savingFromExtra(interestInputs, res.emi * 1.1, res.totalInterest))}` })}`;
            el.querySelector('#int-legend').innerHTML = legend([{ label: 'Outstanding' }, { label: 'Interest paid' }, { label: 'Principal repaid' }]);
            lineChart(el.querySelector('#int-chart'), {
                labels, labelFormat: l => `Y${l}`, format: moneyShort, area: true, includeZero: true,
                series: [
                    { name: 'Outstanding', values: res.rows.map(r => Math.round(r.balance)) },
                    { name: 'Interest paid', values: res.rows.map(r => Math.round(r.interest)) },
                    { name: 'Principal repaid', values: res.rows.map(r => Math.round(r.principal)) },
                ],
            });
            el.querySelector('#int-table').innerHTML = table([
                { label: 'Year', render: r => `<b>${r.year}</b>` },
                { label: 'Paid so far', align: 'r', render: r => money(Math.round(r.paid)) },
                { label: 'Principal repaid', align: 'r', render: r => money(Math.round(r.principal)) },
                { label: 'Interest paid', align: 'r', render: r => `<span class="neg">${money(Math.round(r.interest))}</span>` },
                { label: 'Outstanding', align: 'r', render: r => `<b>${money(Math.round(r.balance))}</b>` },
            ], res.rows, { dense: true });
            return;
        }
        kpis.innerHTML = `
            ${kpi({ label: 'Maturity value', value: money(Math.round(res.value)), iconName: 'gift', tone: 'gold', sub: `after ${interestInputs.years} years` })}
            ${kpi({ label: 'Interest earned', value: `<span class="pos">${money(Math.round(res.interest))}</span>`, iconName: 'trending', tone: 'aqua',
                    sub: `on ${money(Math.round(res.invested))} invested` })}
            ${kpi({ label: 'Compounding adds', value: money(Math.round(res.value - res.simple)), iconName: 'sparkles', tone: 'violet',
                    sub: `Simple interest gives ${moneyShort(res.simple)}` })}
            ${kpi({ label: 'Effective yield', value: `${percent(res.effective, 2)} p.a.`, iconName: 'percent', tone: 'deep',
                    sub: `Money doubles in ${res.doubling.toFixed(1)} years` })}
            ${kpi({ label: "In today's money", value: money(Math.round(res.real)), iconName: 'scale', tone: res.real < res.invested ? 'coral' : '',
                    sub: res.real < res.invested ? `<span class="neg">Below inflation at ${percent(interestInputs.inflation, 1)}</span>` : `Beats ${percent(interestInputs.inflation, 1)} inflation` })}`;
        el.querySelector('#int-legend').innerHTML = legend([{ label: 'Compound' }, { label: 'Simple' }, { label: 'Invested' }, { label: "Today's money" }]);
        lineChart(el.querySelector('#int-chart'), {
            labels, labelFormat: l => `Y${l}`, format: moneyShort, includeZero: true,
            series: [
                { name: 'Compound', values: res.rows.map(r => Math.round(r.value)) },
                { name: 'Simple', values: res.rows.map(r => Math.round(r.simple)) },
                { name: 'Invested', values: res.rows.map(r => Math.round(r.invested)), dashed: true },
                { name: "Today's money", values: res.rows.map(r => Math.round(r.real)), dashed: true },
            ],
        });
        el.querySelector('#int-table').innerHTML = table([
            { label: 'Year', render: r => `<b>${r.year}</b>` },
            { label: 'Invested', align: 'r', render: r => money(Math.round(r.invested)) },
            { label: 'Value (compound)', align: 'r', render: r => `<b>${money(Math.round(r.value))}</b>` },
            { label: 'Interest', align: 'r', render: r => `<span class="pos">${money(Math.round(r.value - r.invested))}</span>` },
            { label: 'Value (simple)', align: 'r', render: r => money(Math.round(r.simple)) },
            { label: 'Compound edge', align: 'r', render: r => `<span class="pos">+${money(Math.round(r.value - r.simple))}</span>` },
            { label: "Today's money", align: 'r', render: r => `<span class="secondary">${money(Math.round(r.real))}</span>` },
        ], res.rows, { dense: true });
    };

    form.addEventListener('click', e => {
        const tile = e.target.closest('[data-mode]');
        if (!tile) return;
        interestInputs.mode = tile.dataset.mode;
        form.querySelectorAll('.mode-tile').forEach(t => t.classList.toggle('active', t === tile));
        fields();
        draw();
    });
    form.addEventListener('input', draw);
    form.addEventListener('change', draw);
    fields();
    draw();
}

/** Interest saved by paying a higher EMI on the same loan. */
function savingFromExtra({ amount, rate }, emi, baseInterest) {
    const r = rate / 1200;
    let balance = amount, interest = 0;
    for (let m = 0; m < 1200 && balance > 0.5; m++) {
        const i = balance * r;
        interest += i;
        balance -= Math.min(balance, emi - i);
    }
    return Math.max(0, baseInterest - interest);
}

