/**
 * Forecast › Wealth & inflation (#/forecast/wealth): will your money beat inflation, and how to make it.
 *
 * What you hold today (your accounts, grouped: cash, bank, deposits, debt, equity, gold, property, chits ...) with
 * what each earns a year (the account's own rate where it has one, else a usual rate you can change), the debts with
 * what they cost; from that: what your money earns on the whole, what is left after inflation, and what inflation
 * takes each year from the money that earns less than it. Then the years ahead, two ways:
 *   as you are   everything keeps earning what it does, your usual savings go into the same mix
 *   suggested    idle cash (above the emergency fund) and your savings go into a mix that beats inflation (the
 *                Investment plan's mix for your age and risk where there is one), costly debt cleared first
 * both in rupees and in today's money, with the line inflation alone would need. Milestones (doubling in today's money,
 * crores) and what to do, each with what it is worth a year.
 */
import { api } from '../core/api.js';
import { panel, esc, emptyState, openModal } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent } from '../core/format.js';
import { lineChart, legend } from '../core/charts.js';
import { getPref, setPref } from '../core/prefs.js';
import { readQuery, setQuery } from '../core/route.js';

const num = v => Number(v || 0);

/** Kinds of holding: the account types in each, and the usual yearly return when the account has no rate of its own. */
const CLASSES = [
    { key: 'cash', label: 'Cash & wallets', types: ['CASH', 'WALLET', 'MEAL_CARD'], rate: 0, iconName: 'cash' },
    { key: 'bank', label: 'Bank accounts', types: ['BANK'], rate: 3, iconName: 'bank', ownRate: true },
    { key: 'deposits', label: 'Deposits & schemes', types: ['FIXED_DEPOSIT', 'RECURRING_DEPOSIT', 'SAVINGS_SCHEME'], rate: 7, iconName: 'lock', ownRate: true },
    { key: 'debt', label: 'Bonds & debt', types: ['BONDS'], rate: 7.5, iconName: 'report', ownRate: true },
    { key: 'equity', label: 'Equity & funds', types: ['MUTUAL_FUND', 'STOCKS'], rate: 12, iconName: 'trending' },
    { key: 'gold', label: 'Gold & silver', types: ['GOLD', 'SILVER'], rate: 9, iconName: 'gem' },
    { key: 'property', label: 'Property', types: ['REAL_ESTATE'], rate: 6, iconName: 'home' },
    { key: 'chits', label: 'Chits', types: ['CHIT_FUND'], rate: 8, iconName: 'chit-book' },
    { key: 'insurance', label: 'Insurance policies', types: ['INSURANCE_POLICY'], rate: 5, iconName: 'shield' },
    { key: 'lent', label: 'Lent & receivable', types: ['RECEIVABLE', 'LOAN_GIVEN'], rate: 0, iconName: 'hand' },
    { key: 'vehicle', label: 'Vehicles', types: ['VEHICLE'], rate: -10, iconName: 'car' },
    { key: 'other', label: 'Other assets', types: ['OTHER_ASSET'], rate: 0, iconName: 'layers' },
];
const DEBT_RATE = { CREDIT_CARD: 36, HOME_LOAN: 8.5, VEHICLE_LOAN: 9.5, PERSONAL_LOAN: 13, GOLD_LOAN: 9, EDUCATION_LOAN: 10, LOAN: 11, PAYABLE: 0, OTHER_LIABILITY: 0 };
/** The mix used when the Investment plan has none: beats inflation without being all equity. */
const DEFAULT_MIX = [
    { name: 'Equity (index funds)', percent: 50, expectedReturn: 12 },
    { name: 'Debt (funds, deposits)', percent: 35, expectedReturn: 7.5 },
    { name: 'Gold', percent: 10, expectedReturn: 9 },
    { name: 'Liquid', percent: 5, expectedReturn: 6 },
];

export async function renderWealthForecast(body) {
    body.classList.add('fx-page');
    const prefs = getPref('wealthForecast', { inflation: 6, years: 10, stepUp: 5, saving: null, rates: {} });
    if (Number(readQuery().get('years')) > 0) prefs.years = Number(readQuery().get('years'));   // #/forecast/wealth?years=20
    const [accounts, plan, chits, sheet] = await Promise.all([
        api.get('/accounts'), api.get('/reports/investment-plan').catch(() => null), api.get('/chits').catch(() => []),
        api.get('/reports/balance-sheet').catch(() => null),
    ]);
    const mine = accounts.filter(a => a.active && !a.systemAccount && !a.chitBook && !a.projectBook);
    if (!mine.length) { body.innerHTML = emptyState('Add your accounts first: the forecast starts from what you hold.', 'trending'); return; }
    const runningChits = chits.filter(c => c.status === 'ACTIVE' || c.status === 'PRIZED');
    const chitRate = runningChits.length
        ? runningChits.reduce((s, c) => s + num(c.impliedAnnualRate || c.rateUsed) * num(c.paidIn), 0) / Math.max(1, runningChits.reduce((s, c) => s + num(c.paidIn), 0))
        : null;

    const draw = () => {
        const infl = prefs.inflation;
        const rateOf = (cls, a) => {
            if (prefs.rates[cls.key] != null) return prefs.rates[cls.key];
            if (cls.key === 'chits' && chitRate) return chitRate;
            if (cls.ownRate && a && a.interestRate != null) return num(a.interestRate);
            return cls.rate;
        };
        // holdings by kind, and debts
        const holdings = CLASSES.map(cls => {
            const accs = mine.filter(a => a.accountClass === 'ASSET' && cls.types.includes(a.accountType) && num(a.balance) > 0);
            const amount = accs.reduce((s, a) => s + num(a.balance), 0);
            const earns = accs.reduce((s, a) => s + num(a.balance) * rateOf(cls, a), 0);
            return { ...cls, accs, amount, rate: amount ? earns / amount : rateOf(cls, null) };
        }).filter(h => h.amount > 0);
        const debts = mine.filter(a => a.accountClass === 'LIABILITY' && Math.abs(num(a.balance)) > 0)
            .map(a => ({ name: a.name, type: a.accountType, amount: Math.abs(num(a.balance)), rate: a.interestRate != null ? num(a.interestRate) : DEBT_RATE[a.accountType] ?? 10 }));
        const A = holdings.reduce((s, h) => s + h.amount, 0);
        const L = debts.reduce((s, d) => s + d.amount, 0);
        const nw = A - L;
        const assetReturn = A ? holdings.reduce((s, h) => s + h.amount * h.rate, 0) / A : 0;
        const debtCost = L ? debts.reduce((s, d) => s + d.amount * d.rate, 0) / L : 0;
        const nwReturn = nw > 0 ? (A * assetReturn - L * debtCost) / nw : 0;
        const real = r => ((1 + r / 100) / (1 + infl / 100) - 1) * 100;
        // what inflation takes from money earning less than it (a vehicle's loss of value is wear, not inflation)
        const drag = holdings.filter(h => h.rate < infl && h.key !== 'vehicle').reduce((s, h) => s + h.amount * (infl - h.rate) / 100, 0);

        // the safety net and idle cash
        const monthlySpend = num(plan?.profile?.spending) || num(sheet?.averageMonthlyExpense);
        const target = num(plan?.profile?.emergencyTarget) || monthlySpend * 6;
        const liquid = holdings.filter(h => h.key === 'cash' || h.key === 'bank').reduce((s, h) => s + h.amount, 0);
        const idle = Math.max(0, liquid - target);
        const saving = prefs.saving != null ? prefs.saving : Math.max(0, Math.round(num(plan?.profile?.surplus)));
        const income = num(plan?.profile?.income);
        const mix = plan?.allocation?.length ? plan.allocation.filter(b => num(b.percent) > 0) : DEFAULT_MIX;
        const blended = mix.reduce((s, b) => s + num(b.percent) * num(b.expectedReturn), 0) / Math.max(1, mix.reduce((s, b) => s + num(b.percent), 0));
        const liquidRate = holdings.filter(h => h.key === 'bank' || h.key === 'cash').reduce((s, h) => s + h.amount * h.rate, 0) / Math.max(1, liquid);
        const costly = debts.filter(d => d.rate > blended && d.amount > 0).sort((a, b) => b.rate - a.rate);

        // the years ahead, two ways (monthly steps, savings stepped up each year)
        const years = prefs.years;
        const project = suggested => {
            let assets = A, debt = L, idleLeft = idle;
            const rA = assetReturn / 1200;
            const pts = [{ y: 0, value: nw }];
            // suggested: idle cash first clears debt dearer than the mix, the rest goes into the mix
            let costlyLeft = suggested ? costly.reduce((s, d) => s + d.amount, 0) : 0;
            if (suggested && costlyLeft) { const pay = Math.min(idleLeft, costlyLeft); assets -= pay; debt -= pay; costlyLeft -= pay; idleLeft -= pay; }
            let core = suggested ? assets - idleLeft : assets;   // what stays as it is
            let invested = suggested ? idleLeft : 0;               // in the suggested mix
            let monthSave = saving;
            for (let m = 1; m <= years * 12; m++) {
                core *= 1 + rA;
                if (suggested) invested = invested * (1 + blended / 1200) + monthSave;
                else core += monthSave;
                // debt: what it costs is paid from the savings; costly debt cleared first in the suggested plan
                if (suggested && costlyLeft > 0) { const pay = Math.min(costlyLeft, monthSave); costlyLeft -= pay; debt -= pay; invested -= pay; }
                if (m % 12 === 0) { monthSave *= 1 + prefs.stepUp / 100; pts.push({ y: m / 12, value: core + invested - debt }); }
            }
            return pts;
        };
        const asNow = project(false);
        const better = project(true);
        const keepPace = asNow.map(p => ({ y: p.y, value: nw * Math.pow(1 + infl / 100, p.y) }));
        const deflate = (v, y) => v / Math.pow(1 + infl / 100, y);
        const end = { now: asNow[asNow.length - 1].value, better: better[better.length - 1].value };
        const doubleYear = better.find(p => deflate(p.value, p.y) >= nw * 2 && nw > 0)?.y;
        const croreYear = better.find(p => p.value >= 1e7)?.y;
        const priceIn = Math.pow(1 + infl / 100, years);
        const recs = recommendations({ holdings, debts, idle, target, liquid, liquidRate, blended, saving, income, infl, A, nw, plan, costly, years, project: n => n });

        body.innerHTML = `
            <div class="fx-toolbar">
                <label class="fx-rate">${icon('trending')}Inflation <input type="number" id="wf-infl" min="0" max="20" step="0.5" value="${infl}"><span>% a year</span></label>
                <span class="seg-chips sm" id="wf-years">${[5, 10, 15, 20, 25].map(y => `<button class="seg-chip ${y === years ? 'active' : ''}" data-years="${y}">${y} years</button>`).join('')}</span>
                <label class="fx-rate">${icon('piggy')}Save a month <input type="number" id="wf-save" min="0" step="500" value="${saving}"><span>₹</span></label>
                <label class="fx-rate" title="How much more you save each year">${icon('arrow-up')}Step up <input type="number" id="wf-step" min="0" max="30" step="1" value="${prefs.stepUp}"><span>% a year</span></label>
                <button class="btn sm" id="wf-rates">${icon('settings')}Returns</button>
            </div>
            <div class="fx-kpis">
                ${kpi('wallet', 'Net worth', money(Math.round(nw)), `${moneyShort(A)} held · ${moneyShort(L)} owed`)}
                ${kpi('trending', 'Your money earns', percent(nwReturn, 1), `assets ${percent(assetReturn, 1)}${L ? ` · debts cost ${percent(debtCost, 1)}` : ''}`)}
                ${kpi(real(nwReturn) >= 0 ? 'check-circle' : 'alert', 'After inflation', `${real(nwReturn) >= 0 ? '+' : ''}${percent(real(nwReturn), 1)}`, real(nwReturn) >= 0 ? `beating ${infl}% inflation` : `losing to ${infl}% inflation`, real(nwReturn) >= 2 ? 'good' : real(nwReturn) >= 0 ? 'warn' : 'bad')}
                ${kpi('alert', 'Inflation takes', `${money(Math.round(drag))}/yr`, 'from money earning less than it', drag > 0 ? 'bad' : 'good')}
                ${kpi('cash', 'Idle cash', money(Math.round(idle)), target ? `above a ${moneyShort(target)} safety net` : 'set your spending to size the safety net', idle > 0 ? 'warn' : 'good')}
                ${kpi('flag', `In ${years} years`, moneyShort(end.better), `${moneyShort(deflate(end.better, years))} in today’s money, suggested`, 'good')}
            </div>
            <div class="fx-two">
                ${panel({ title: 'The years ahead', iconName: 'trending', sub: `₹1 today buys what ₹${priceIn.toFixed(2)} will in ${years} years`,
                    body: `<div class="chart fx-chart" id="wf-chart"></div>${legend([{ label: 'As you are', color: 'var(--series-8)' }, { label: 'Suggested', color: 'var(--series-3)' },
                        { label: 'Suggested, in today’s money', color: 'var(--series-1)' }, { label: 'Just keeping pace with inflation', color: 'var(--series-4)' }], 'line')}
                        <div class="fx-mile">
                            ${mile('As you are', moneyShort(end.now), `${moneyShort(deflate(end.now, years))} in today’s money`)}
                            ${mile('Suggested', moneyShort(end.better), `${moneyShort(deflate(end.better, years))} in today’s money`)}
                            ${mile('Difference', `+${moneyShort(end.better - end.now)}`, 'by following the plan')}
                            ${mile('Doubles in real terms', doubleYear ? `${doubleYear} yr` : `> ${years} yr`, 'net worth ×2 in today’s money')}
                            ${mile('₹1 crore', nw >= 1e7 ? 'already' : croreYear ? `${croreYear} yr` : `> ${years} yr`, 'suggested plan')}
                        </div>` })}
                ${panel({ title: 'What to do', iconName: 'sparkles', sub: `${recs.length} steps, biggest first`, body: `<div class="fx-insights">${recs.map(r => `<div class="fx-insight ${r.tone}">${icon(r.icon)}<div><b>${r.title}</b><p>${r.text}</p>${r.worth ? `<span class="fx-worth">${r.worth}</span>` : ''}</div></div>`).join('')}</div>` })}
            </div>
            <div class="fx-two">
                ${panel({ title: 'What you hold, against inflation', iconName: 'pie', bodyClass: 'flush', body: `<table class="grid compact fx-mix">
                    <thead><tr><th>Holding</th><th class="r">Amount</th><th>Share</th><th class="r">Earns</th><th class="r">After inflation</th><th class="r">Inflation costs a year</th></tr></thead>
                    <tbody>${holdings.sort((a, b) => b.amount - a.amount).map(h => `<tr>
                        <td><span class="chip-icon xs">${icon(h.iconName)}</span> ${esc(h.label)} <small class="muted">${h.accs.length} account${h.accs.length === 1 ? '' : 's'}</small></td>
                        <td class="r">${money(Math.round(h.amount))}</td>
                        <td><span class="fx-bar"><i style="width:${(h.amount / A * 100).toFixed(1)}%"></i></span> <small>${percent(h.amount / A * 100, 0)}</small></td>
                        <td class="r">${percent(h.rate, 1)}</td>
                        <td class="r ${real(h.rate) >= 0 ? 'pos' : 'neg'}">${real(h.rate) >= 0 ? '+' : ''}${percent(real(h.rate), 1)}</td>
                        <td class="r ${h.rate < infl && h.key !== 'vehicle' ? 'neg' : 'muted'}">${h.key === 'vehicle' ? `loses ${money(Math.round(h.amount * -h.rate / 100))} in value` : h.rate < infl ? money(Math.round(h.amount * (infl - h.rate) / 100)) : '—'}</td></tr>`).join('')}
                        ${debts.map(d => `<tr class="fx-debt"><td><span class="chip-icon xs red">${icon('arrow-out')}</span> ${esc(d.name)}</td><td class="r neg">−${money(Math.round(d.amount))}</td><td></td>
                            <td class="r neg">costs ${percent(d.rate, 1)}</td><td></td><td class="r">${money(Math.round(d.amount * d.rate / 100))} interest</td></tr>`).join('')}
                    </tbody></table>` })}
                ${panel({ title: 'A mix that beats inflation', iconName: 'scale', sub: `${percent(blended, 1)} a year · ${percent(real(blended), 1)} after inflation`, body: `
                    <div class="fx-target">${mix.map(b => `<div class="fx-target-row"><span>${esc(b.name)}</span><span class="fx-bar"><i style="width:${num(b.percent)}%"></i></span>
                        <b>${percent(num(b.percent), 0)}</b><small>${percent(num(b.expectedReturn), 1)} a year</small></div>`).join('')}</div>
                    <p class="small muted">${plan?.allocation?.length ? 'From your Investment plan (age, risk and horizon).' : 'A balanced starting mix; set your age and risk in Reports › Investment plan for your own.'}
                        New savings and idle cash go here in the suggested plan. Rates are long-run averages, not promises: equity can fall for years at a time, so keep money needed within 3 years out of it.</p>` })}
            </div>`;
        lineChart(body.querySelector('#wf-chart'), {
            labels: asNow.map(p => (p.y ? `Year ${p.y}` : 'Today')), format: moneyShort, includeZero: false,
            series: [
                { name: 'As you are', values: asNow.map(p => Math.round(p.value)), color: 'var(--series-8)' },
                { name: 'Suggested', values: better.map(p => Math.round(p.value)), color: 'var(--series-3)' },
                { name: 'Suggested, in today’s money', values: better.map(p => Math.round(deflate(p.value, p.y))), color: 'var(--series-1)', dashed: true },
                { name: 'Keeping pace with inflation', values: keepPace.map(p => Math.round(p.value)), color: 'var(--series-4)', dashed: true },
            ],
        });
    };
    draw();

    const save = () => { setPref('wealthForecast', prefs); draw(); };
    body.addEventListener('change', e => {
        const v = Number(e.target.value);
        if (e.target.id === 'wf-infl') prefs.inflation = Math.max(0, v || 0);
        else if (e.target.id === 'wf-save') prefs.saving = e.target.value === '' ? null : Math.max(0, v || 0);
        else if (e.target.id === 'wf-step') prefs.stepUp = Math.max(0, v || 0);
        else return;
        save();
    });
    body.addEventListener('click', e => {
        const y = e.target.closest('[data-years]');
        if (y) { prefs.years = Number(y.dataset.years); setQuery({ years: prefs.years }, { push: true }); save(); return; }
        if (e.target.closest('#wf-rates')) editRates(prefs, chitRate, save);
    });
}

const kpi = (iconName, label, value, sub, tone = '') => `<div class="fx-kpi ${tone}"><span class="fx-kpi-icon">${icon(iconName)}</span>
    <div class="min-0"><small>${label}</small><b>${value}</b><em>${sub}</em></div></div>`;
const mile = (label, value, sub) => `<div class="fx-mile-item"><small>${label}</small><b>${value}</b><em>${sub}</em></div>`;

/** What to do, each with what it is worth, biggest first. */
function recommendations({ holdings, debts, idle, target, liquid, liquidRate, blended, saving, income, infl, A, nw, plan, costly, years }) {
    const out = [];
    const fv = (monthly, rate, yrs) => { let v = 0; for (let m = 0; m < yrs * 12; m++) v = v * (1 + rate / 1200) + monthly; return v; };
    if (costly.length) {
        const d = costly[0];
        out.push({ tone: 'bad', icon: 'alert', title: `Clear ${d.name} first`, worth: `saves ${money(Math.round(d.amount * d.rate / 100))} a year`,
            text: `It costs ${percent(d.rate, 1)} a year, more than investing earns (${percent(blended, 1)}). Every rupee paid into it is a sure ${percent(d.rate, 1)} return${idle ? `; ${money(Math.round(Math.min(idle, d.amount)))} of your idle cash could go to it now` : ''}.`, sort: d.amount * d.rate / 100 });
    }
    if (target && liquid < target) {
        out.push({ tone: 'bad', icon: 'shield', title: 'Build the safety net first', worth: `${money(Math.round(target - liquid))} to go`,
            text: `Keep ${money(Math.round(target))} (about six months of spending) in a savings or sweep account or a liquid fund before investing for growth; it stops a bad month from forcing you to sell or borrow.`, sort: 1e9 });
    }
    if (idle > 0) {
        const gain = idle * (blended - liquidRate) / 100;
        out.push({ tone: 'warn', icon: 'cash', title: `Put ${money(Math.round(idle))} of idle cash to work`, worth: `about ${money(Math.round(gain))} more a year`,
            text: `It earns about ${percent(liquidRate, 1)} where it is and loses ${percent(infl - liquidRate, 1)} a year to inflation. Moved into the mix it earns about ${percent(blended, 1)}: start with a debt fund or deposit, and move into equity over a few months.`, sort: gain });
    }
    for (const h of holdings.filter(x => x.rate < infl && x.amount > 20000 && !['cash', 'bank', 'vehicle', 'lent'].includes(x.key))) {
        out.push({ tone: 'warn', icon: 'trending', title: `${h.label} lose to inflation`, worth: `${money(Math.round(h.amount * (infl - h.rate) / 100))} a year lost`,
            text: `${money(Math.round(h.amount))} earning ${percent(h.rate, 1)} against ${infl}% inflation. When they come up for renewal, move them into the mix rather than rolling them over.`, sort: h.amount * (infl - h.rate) / 100 });
    }
    if (income > 0 && saving / income < 0.2) {
        const more = Math.round(income * 0.2 - saving);
        out.push({ tone: 'info', icon: 'piggy', title: 'Save a fifth of what comes in', worth: `+${moneyShort(fv(more, blended, years))} in ${years} years`,
            text: `You save about ${percent(saving / income * 100, 0)} of your income. ${money(more)} more a month, invested, grows to ${money(Math.round(fv(more, blended, years)))} in ${years} years.`, sort: fv(more, blended, years) / years });
    }
    if (saving > 0) {
        const flat = fv(saving, blended, years);
        let stepped = 0, m = saving; for (let y = 0; y < years; y++) { stepped = fv(m, blended, 1) + stepped * (1 + blended / 100); m *= 1.1; }
        out.push({ tone: 'info', icon: 'arrow-up', title: 'Step up your savings 10% a year', worth: `+${moneyShort(stepped - flat)} in ${years} years`,
            text: `Raising what you save each year with your income turns ${money(Math.round(flat))} into about ${money(Math.round(stepped))} over ${years} years. Set the SIP to step up on its own.`, sort: (stepped - flat) / years });
    }
    const equity = holdings.find(h => h.key === 'equity')?.amount || 0;
    const age = num(plan?.profile?.age) || 30;
    const wantEquity = Math.max(20, Math.min(75, 100 - age));
    if (A > 0 && equity / A * 100 < wantEquity - 15 && nw > 200000) {
        out.push({ tone: 'info', icon: 'trending', title: 'Too little in equity to beat inflation well', worth: `${percent(equity / A * 100, 0)} now · about ${wantEquity}% suits ${age}`,
            text: 'Over 7+ years, a broad index fund has been the surest way to stay well ahead of inflation. Build up to it with a monthly SIP rather than all at once.', sort: A * 0.02 });
    }
    const gold = holdings.find(h => h.key === 'gold')?.amount || 0;
    if (A > 500000 && gold / A < 0.05) out.push({ tone: 'info', icon: 'gem', title: 'Hold some gold', worth: '5–10% of what you hold',
        text: 'Gold tends to rise when shares fall and when the rupee weakens; a small share steadies the whole. Gold funds or sovereign gold bonds avoid making charges and locker worries.', sort: 1 });
    const chits = holdings.find(h => h.key === 'chits')?.amount || 0;
    if (A > 0 && chits / A > 0.3) out.push({ tone: 'warn', icon: 'chit-book', title: `Chits are ${percent(chits / A * 100, 0)} of what you hold`, worth: 'keep under a third',
        text: 'Chits are hard to get out of without a cut. As they mature, put the payouts into the mix instead of a new chit (see Chit forecast).', sort: 2 });
    if (!out.length) out.push({ tone: 'good', icon: 'check-circle', title: 'You are ahead of inflation', text: 'Keep saving into the mix and review it once a year.', sort: 0 });
    const order = { bad: 0, warn: 1, info: 2, good: 3 };
    return out.sort((a, b) => order[a.tone] - order[b.tone] || b.sort - a.sort);
}

/** The usual yearly return of each kind of holding (an account's own rate still wins for bank, deposits and bonds). */
function editRates(prefs, chitRate, onSave) {
    openModal({ title: 'Returns used', iconName: 'settings', size: 'lg',
        body: `<form class="form-grid three wf-rates">${CLASSES.map(c => `<label class="field"><span>${esc(c.label)}</span>
            <input type="number" name="${c.key}" step="0.5" min="-30" max="50" value="${prefs.rates[c.key] ?? ''}" placeholder="${c.key === 'chits' && chitRate ? chitRate.toFixed(1) : c.rate}"></label>`).join('')}
            <p class="span-3 small muted">Empty: the usual rate shown (bank accounts, deposits and bonds with a rate of their own keep it; chits use what yours return). Long-run averages, not promises.</p></form>`,
        actions: [{ label: 'Cancel' }, { label: 'Use these', kind: 'primary', iconName: 'check', onClick: m => {
            const f = m.el.querySelector('form');
            prefs.rates = Object.fromEntries(CLASSES.map(c => [c.key, f[c.key].value === '' ? null : Number(f[c.key].value)]).filter(([, v]) => v != null));
            onSave();
        } }] });
}
