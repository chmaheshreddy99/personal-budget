/**
 * Forecast › Lift or hold › the chit table: a chit's lift terms as a table of every month, laid out like the chit table
 * of Host a Chit (the same fill strip, step-by-step ranges, editable cells and past months greyed), shown under the
 * chit's analysis and saved from there.
 *
 * Each month is a row: when it is paid, the installment (paid, for months gone by; expected after the usual dividend,
 * for months to come), what is paid each month after lifting in that month, and what lifting then gives (the
 * organizer's figure, before any fee). For months still to come: what lifting then costs, in rupees and as a yearly
 * rate, and the verdict against your two yardsticks; for months already paid the same sums looking back ("if lifted
 * then").
 *
 * Filling it, so nothing has to be typed month by month:
 *   evenly          from an amount in month 1 to one in the last month (Host a Chit's "Fill evenly")
 *   step by step    month 1's amount, then a rise for each range of months (Host a Chit's steps)
 *   cut %           a cut off the maturity amount, falling from the first month to the last
 *   paste           the organizer's chart as text: amounts a line, or month and amount
 *   another chit    its table, scaled to this chit
 *   then pay        one amount for every month; the full installment (no dividend); the installment and an extra
 *   helpers         ⇩ copies a cell to every month below; rounding; leaving the months already paid as they are;
 *                   back to the estimate
 * Every change shows at once in the analysis above (onPreview) and waits for Save; similar chits (the same number of
 * months; the same organizer ticked first) can take the same table, scaled to their amount and installment.
 */
import { api } from '../core/api.js';
import { esc, toast } from '../core/ui.js';
import { getPref, setPref } from '../core/prefs.js';
import { readQuery, setQuery } from '../core/route.js';
import { icon } from '../core/icons.js';
import { money, moneyShort, percent, date, shortDateYear } from '../core/format.js';
import { analyseLift, chartText, irr, npv, parseChart, payoutFor, remaining } from './chit-math.js';

const num = v => Number(v || 0);

/**
 * Draws the table for chit c (detail d) into host. opts: { terms, others: [{chit, detail, terms}], prefs: {investRate,
 * loanRate, today}, onPreview(terms|null), onSaved([terms]) }. Returns { dirty() } for the page to ask before leaving.
 * Draft mode (a chit being created, nothing to save to yet): opts.onApply(terms) takes the table instead of saving it,
 * and opts.onCancel() is called by Cancel. Inline (opts.inline, beside the chit form): no Save at all, every change goes
 * to onPreview(terms) and is kept by the form.
 */
export function mountLiftTable(target, c, d, opts) {
    // a fresh element each time (discard draws it again), so no listeners are left from before
    const host = target.cloneNode(false);
    target.replaceWith(host);
    const { terms, others, prefs, onPreview, onSaved, onApply, onCancel, inline = false } = opts;
    const M = num(c.maturityAmount);
    const n = c.numberOfInstallments;
    const inst = num(c.monthlyInstallment);
    const { maturityDate, dividend } = remaining(c, d.installments, terms);
    const saved = parseChart(terms?.liftChart);
    const afterDefault = terms?.afterLiftInstallment != null ? num(terms.afterLiftInstallment) : null;
    let round = 1;
    let dirty = false;
    let mode = readQuery().get('mode') || 'even';   // ...?mode=steps
    const rnd = v => Math.round(v / round) * round;

    const estimate = r => Math.round(payoutFor(c, terms, r.no, maturityDate, r.date).gross);
    const rows = [...d.installments].sort((a, b) => a.installmentNo - b.installmentNo).map(i => {
        const paid = i.status === 'PAID';
        const regular = paid ? (num(i.paidAmount) || num(i.dueAmount) - num(i.dividend)) : Math.max(0, num(i.dueAmount) - dividend);
        const r = { no: i.installmentNo, date: i.dueDate, paid, regular };
        r.payout = saved[r.no]?.payout ?? estimate(r);
        r.after = Math.round(saved[r.no]?.after ?? afterDefault ?? regular);
        return r;
    });
    const fill = { first: terms?.liftDiscountFirst ?? '', last: terms?.liftDiscountLast ?? '', fee: terms?.liftFeePercent ?? '', from: terms?.liftFromMonth ?? '' };
    const steps = { start: rows[0]?.payout || 0, rules: [{ from: 2, to: n, step: n > 1 ? Math.max(0, Math.round((rows[n - 1].payout - rows[0].payout) / (n - 1) / 100) * 100) : 0 }] };
    const org = s => String(s || '').trim().toLowerCase();
    const similar = others.filter(o => o.chit.numberOfInstallments === n);
    const withTables = others.filter(o => o.terms?.liftChart);
    const nextNo = rows.find(r => !r.paid)?.no ?? n;
    const helperPref = getPref('liftTableHelper', null);
    const helperOpen = helperPref === null ? !terms?.liftChart : helperPref;

    const liveTerms = () => ({
        afterLiftInstallment: null,
        liftDiscountFirst: fill.first === '' ? null : num(fill.first), liftDiscountLast: fill.last === '' ? null : num(fill.last),
        liftFeePercent: fill.fee === '' ? null : num(fill.fee), liftFromMonth: fill.from === '' ? null : num(fill.from),
        liftChart: chartText(rows),
    });

    const input = (r, k, step) => `<span class="lt-cell"><input type="number" class="num hc-plan-input" data-k="${k}" value="${r[k]}" step="${step}" min="0" inputmode="decimal" data-plain><button type="button" class="lt-down" data-down="${k}" title="Copy to every month below">⇩</button></span>`;
    const rowHtml = r => `<tr data-no="${r.no}" class="${r.paid ? 'hc-past lt-paid' : ''} ${r.no === nextNo ? 'lt-next' : ''}">
        <td class="c"><b>${r.no}</b></td>
        <td>${shortDateYear(r.date)}${r.no === nextNo ? ' <span class="tag info">next</span>' : r.paid ? ' <span class="lt-paid-mark">paid</span>' : ''}</td>
        <td class="r">${money(Math.round(r.regular))}</td>
        <td class="r">${input(r, 'after', 100)}</td>
        <td class="r lt-get"><span class="lt-get-in">${input(r, 'payout', 500)}<small data-out="cut"></small></span></td>
        <td class="r" data-out="cost"></td>
        <td class="r" data-out="rate"></td>
        <td data-out="say"></td></tr>`;

    host.innerHTML = `
        <section class="panel lt-panel">
            <header class="lt-head">
                <div class="section-title">${icon('calendar')}Chit table · ${n} months</div>
                <span class="lt-head-sub">what lifting gives and what you pay after, month by month</span>
                <span class="spacer"></span>
                <label class="lt-round">Round to <select data-round><option value="1">₹1</option><option value="100">₹100</option><option value="1000">₹1,000</option></select></label>
                <button type="button" class="btn sm ghost" data-act="reset" title="Fill the amounts from the saved terms or the estimate again">${icon('undo')}Estimate</button>
            </header>
            <div class="lt-body">
                <details class="lt-helper" ${helperOpen ? 'open' : ''}>
                    <summary class="lt-helper-head">${icon('sparkles')}<b>Fill the table quickly</b>
                        <span class="lt-helper-sub">evenly, step by step, by cut %, from the organizer's chart${withTables.length ? ' or another chit' : ''}; then what is paid after lifting</span>
                        <span class="spacer"></span><span class="lt-helper-toggle">${icon('chevron-down')}</span></summary>
                    <div class="lt-fills">
                        <span class="lt-fill-label">${icon('arrow-in')}You get if lifted</span>
                        <div class="lt-fill-main">
                            <span class="seg-chips sm">${[['even', 'Evenly'], ['steps', 'Step by step'], ['cut', 'Cut %'], ['paste', 'Paste the chart'], ...(withTables.length ? [['copy', 'From another chit']] : [])]
                                .map(([k, l]) => `<button type="button" class="seg-chip ${k === mode ? 'active' : ''}" data-mode="${k}">${l}</button>`).join('')}</span>
                            <div class="hc-plan-fill lt-pane" data-pane="even">
                                <span>From</span><input type="number" class="num" data-even="first" value="${rows[0]?.payout || ''}" step="1000" min="0" data-plain>
                                <span>in month 1 to</span><input type="number" class="num" data-even="last" value="${rows[n - 1]?.payout || M}" step="1000" min="0" data-plain>
                                <span>in month ${n}</span><button type="button" class="btn sm primary" data-fill="even">Fill evenly</button></div>
                            <div class="hc-ps-box lt-pane" data-pane="steps" hidden></div>
                            <div class="hc-plan-fill lt-pane" data-pane="cut" hidden>
                                <span>Cut</span><input type="number" class="num narrow" data-cut="first" value="${fill.first}" placeholder="30" step="0.5" min="0" max="90" data-plain><span>% of ${moneyShort(M)} in month 1, falling to</span>
                                <input type="number" class="num narrow" data-cut="last" value="${fill.last}" placeholder="${num(c.commissionPercent) || 5}" step="0.5" min="0" max="90" data-plain><span>% in month ${n}</span>
                                <button type="button" class="btn sm primary" data-fill="cut">Fill</button></div>
                            <div class="hc-plan-fill lt-pane" data-pane="paste" hidden>
                                <textarea data-paste rows="2" placeholder="Amounts a line from month 1 (380000, 386000 …), or month and amount (5 412000), as the organizer wrote it"></textarea>
                                <button type="button" class="btn sm primary" data-fill="paste">Fill</button></div>
                            ${withTables.length ? `<div class="hc-plan-fill lt-pane" data-pane="copy" hidden><span>The table of</span>
                                <select data-copy-from>${withTables.map(o => `<option value="${o.chit.id}">${esc(o.chit.name)} · ${moneyShort(o.chit.maturityAmount)} · ${o.chit.numberOfInstallments} months</option>`).join('')}</select>
                                <span>scaled to this chit</span><button type="button" class="btn sm primary" data-fill="copy">Fill</button></div>` : ''}
                        </div>
                        <span class="lt-fill-label">${icon('arrow-out')}Then pay</span>
                        <div class="hc-plan-fill lt-then">
                            <input type="number" class="num" data-after value="${afterDefault ?? inst}" step="100" min="0" data-plain><button type="button" class="btn sm" data-fill="after">Every month</button>
                            <span class="lt-sep">or</span><button type="button" class="btn sm" data-fill="full" title="After lifting, no dividend: the whole installment">Full ${money(inst)}</button>
                            <span class="lt-sep">or installment +</span><input type="number" class="num narrow" data-extra placeholder="1000" step="100" min="0" data-plain><button type="button" class="btn sm" data-fill="extra">Add</button>
                        </div>
                        <span class="lt-fill-label">${icon('settings')}Options</span>
                        <div class="lt-opts">
                            <label>Fee on lifting <input type="number" class="num narrow" data-opt="fee" value="${fill.fee}" placeholder="0" step="0.1" min="0" max="20" data-plain>%</label>
                            <label>Lifting allowed from month <input type="number" class="num narrow" data-opt="from" value="${fill.from}" placeholder="any" step="1" min="1" max="${n}" data-plain></label>
                            <label class="check-line"><input type="checkbox" data-future> Fills leave the months already paid as they are</label>
                            <span class="muted">· ⇩ beside a cell copies it to every month below</span>
                        </div>
                    </div>
                </details>
                <div class="hc-plan-wrap lt-wrap"><table class="grid compact hc-plan hc-plan-edit lt-table">
                    <thead><tr><th class="c">Month</th><th>Pay by</th><th class="r">You pay</th><th class="r">If lifted, then pay</th><th class="r">You get if lifted</th>
                        <th class="r">Lifting costs</th><th class="r">Yearly cost</th><th>Verdict</th></tr></thead>
                    <tbody>${rows.map(rowHtml).join('')}</tbody>
                    <tfoot><tr class="total"><td colspan="8" data-foot></td></tr></tfoot></table></div>
                ${similar.length ? `<div class="lt-similar"><b>${icon('copy')}Same table for similar chits</b>
                    <small>Same number of months (${n}); amounts scaled to each chit's maturity amount and installment.</small>
                    <div class="lt-similar-list">${similar.map(o => `<label class="check-line"><input type="checkbox" data-copy="${o.chit.id}" ${org(o.chit.organizer) && org(o.chit.organizer) === org(c.organizer) ? 'checked' : ''}>
                        <span><b>${esc(o.chit.name)}</b> <small class="muted">${esc(o.chit.organizer || '')} · ${moneyShort(o.chit.maturityAmount)} · ${money(o.chit.monthlyInstallment)}/month</small></span></label>`).join('')}</div></div>` : ''}
            </div>
            ${inline ? '' : `<footer class="lt-save" ${onApply ? '' : 'hidden'}>${icon('edit')}<span>${onApply ? 'Fill in what you know; the table is kept with the chit when it is saved.' : 'Changes not saved yet: the analysis above shows them.'}</span><span class="spacer"></span>
                <button type="button" class="btn sm ghost" data-act="discard">${onApply ? 'Cancel' : 'Discard'}</button>
                <button type="button" class="btn sm primary" data-act="save">${icon('check')}${onApply ? 'Use this table' : 'Save table'}</button></footer>`}
        </section>`;

    const q = s => host.querySelector(s);
    q('.lt-helper').addEventListener('toggle', e => setPref('liftTableHelper', e.target.open));
    const onlyFuture = () => q('[data-future]').checked;

    // ---- step by step (Host a Chit's ranges)
    const stepPayouts = () => {
        const out = [];
        for (let m = 1; m <= n; m++) {
            if (m === 1) { out.push(Math.max(0, num(steps.start))); continue; }
            const rule = [...steps.rules].reverse().find(r => m >= num(r.from) && m <= num(r.to));
            out.push(Math.max(0, out[m - 2] + (rule ? num(rule.step) : 0)));
        }
        return out;
    };
    const drawSteps = () => {
        const pays = stepPayouts();
        q('[data-pane="steps"]').innerHTML = `<div class="hc-ps-head">${icon('trending')}<b>You get, step by step</b><small>month 1, then a rise for each range of months</small></div>
            <div class="hc-ps-start"><span>Month 1 gives</span><input type="number" class="num" data-ps-start value="${num(steps.start)}" step="1000" min="0" data-plain><i>₹</i></div>
            <div class="hc-ps-rules">${steps.rules.map((r, i) => `<div class="hc-ps-rule" data-ps-i="${i}">
                <span>Months</span><input type="number" class="num" data-ps="from" value="${r.from}" min="1" max="${n}" step="1" data-plain>
                <span>to</span><input type="number" class="num" data-ps="to" value="${r.to}" min="1" max="${n}" step="1" data-plain>
                <span>rise</span><input type="number" class="num wide" data-ps="step" value="${num(r.step)}" step="500" data-plain><span class="muted">₹ a month</span>
                <button type="button" class="btn xs ghost icon" data-ps-act="remove" data-i="${i}" title="Remove this range" ${steps.rules.length < 2 ? 'disabled' : ''}>${icon('x')}</button></div>`).join('')}</div>
            <div class="hc-ps-foot"><button type="button" class="btn sm ghost" data-ps-act="add">${icon('plus')}Add a range</button>
                <button type="button" class="btn sm primary" data-fill="steps">${icon('check')}Fill the table</button></div>
            <div class="hc-ps-marks">${[...new Set([1, ...steps.rules.flatMap(r => [num(r.from), num(r.to)]), n])].filter(m => m >= 1 && m <= n).sort((a, b) => a - b)
                .map(m => `<span><small>M${m}</small><b>${moneyShort(pays[m - 1])}</b></span>`).join(`<i>${icon('chevron-right')}</i>`)}</div>`;
    };
    drawSteps();

    // ---- the figures of every row, and the foot
    const lookBack = r => {
        const fee = num(fill.fee) / 100;
        const payout = r.payout * (1 - fee);
        const later = rows.filter(x => x.no > r.no);
        const extra = later.reduce((t, x) => t + (r.after - x.regular), 0);
        const flows = [{ date: r.date, amount: payout }, ...later.map(x => ({ date: x.date, amount: -(r.after - x.regular) })), { date: maturityDate, amount: -M }];
        return { fee: r.payout * fee, cost: M + extra - payout, rate: irr(flows, r.date), gainAtInvest: npv(flows, r.date, prefs.investRate) };
    };
    const rateTag = rate => `<span class="lf-rate ${rate == null ? '' : rate < prefs.investRate ? 'lf-cheap' : rate < prefs.loanRate ? 'lf-mid' : 'lf-dear'}">${rate == null ? '—' : percent(rate, 1)}</span>`;
    const refresh = () => {
        const t = liveTerms();
        const a = analyseLift(c, d.installments, t, prefs);
        const by = new Map(a.months.map(x => [x.no, x]));
        const from = fill.from === '' ? 1 : num(fill.from);
        host.querySelectorAll('tr[data-no]').forEach(tr => {
            const r = rows.find(x => x.no === Number(tr.dataset.no));
            const x = by.get(r.no);
            const out = k => tr.querySelector(`[data-out="${k}"]`);
            const cut = M ? (1 - r.payout / M) * 100 : 0;
            out('cut').textContent = cut > 0.05 ? `−${percent(cut, 1)}` : cut < -0.05 ? `+${percent(-cut, 1)}` : 'full';
            tr.classList.toggle('lt-best', !!x && x === a.cheapest);
            tr.classList.toggle('lt-off', !r.paid && !x);
            if (r.paid && r.no >= from) {
                const y = lookBack(r);
                out('cost').innerHTML = `${money(Math.round(y.cost))}<small>if lifted then</small>`;
                out('rate').innerHTML = rateTag(y.rate);
                out('say').innerHTML = y.rate == null ? '<span class="muted">past</span>'
                    : `<span class="lt-was">${icon('history')}${y.rate < prefs.investRate ? 'Was worth lifting' : y.rate < prefs.loanRate ? 'Only if needed then' : 'Holding was better'}</span>`;
                return;
            }
            if (!x) { out('cost').textContent = ''; out('rate').textContent = ''; out('say').innerHTML = `<span class="muted">${r.paid ? 'already paid' : 'not allowed yet'}</span>`; return; }
            out('cost').innerHTML = `${money(Math.round(x.cost))}${x.fee ? `<small>fee ${moneyShort(x.fee)}</small>` : ''}`;
            out('rate').innerHTML = rateTag(x.rate);
            out('say').innerHTML = x.rate == null ? '<span class="muted">at maturity</span>'
                : x === a.cheapest ? `<span class="tag ${a.verdict === 'LIFT' ? 'warn' : a.verdict === 'HOLD' ? 'good' : 'info'}">${icon('flag')}Cheapest month</span>`
                    : x.rate < prefs.investRate ? `<span class="tag warn">${icon('arrow-in')}Worth lifting</span>`
                        : x.rate < prefs.loanRate ? `<span class="tag info">${icon('clock')}Only if needed</span>`
                            : `<span class="lt-hold">${icon('check')}Better to hold</span>`;
        });
        const holdPay = a.rows.reduce((s, r) => s + r.regular, 0);
        q('[data-foot]').innerHTML = `<span>${icon('check-circle')}<b>Holding:</b> pay ${money(Math.round(holdPay))} more and get ${money(M)} on ${date(maturityDate)}</span>
            ${a.cheapest ? `<span>${icon('flag')}<b>Cheapest to lift:</b> month ${a.cheapest.no}, ${money(Math.round(a.cheapest.payout))} at ${percent(a.cheapest.rate, 1)} a year</span>` : ''}`;
        return t;
    };
    let previewTimer = 0;
    const changed = () => {
        dirty = true;
        if (q('.lt-save')) q('.lt-save').hidden = false;
        const t = refresh();
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => onPreview?.(t), 120);
    };
    /** Sets a column for the months a fill touches (rounded), then shows it. */
    const setCol = (k, fn) => {
        rows.forEach(r => { if (onlyFuture() && r.paid) return; const v = fn(r); if (v != null && !Number.isNaN(v)) r[k] = Math.max(0, rnd(v)); });
        host.querySelectorAll('tr[data-no]').forEach(tr => { tr.querySelector(`input[data-k="${k}"]`).value = rows.find(x => x.no === Number(tr.dataset.no))[k]; });
        changed();
    };

    host.addEventListener('input', e => {
        const t = e.target;
        const tr = t.closest('tr[data-no]');
        if (tr && t.dataset.k) { rows.find(x => x.no === Number(tr.dataset.no))[t.dataset.k] = Math.max(0, num(t.value)); changed(); return; }
        if (t.dataset.opt) { fill[t.dataset.opt] = t.value; changed(); return; }
        if (t.dataset.cut) { fill[t.dataset.cut] = t.value; return; }
        if (t.hasAttribute('data-ps-start')) { steps.start = num(t.value); return; }
        if (t.dataset.ps) { const i = Number(t.closest('[data-ps-i]').dataset.psI); steps.rules[i][t.dataset.ps] = num(t.value); }
    });
    host.addEventListener('change', e => {
        if (e.target.matches('[data-round]')) round = Number(e.target.value) || 1;
        if (e.target.dataset.ps || e.target.hasAttribute('data-ps-start')) drawSteps();
    });
    host.addEventListener('click', async e => {
        const m = e.target.closest('[data-mode]');
        if (m) {
            mode = m.dataset.mode;
            setQuery({ mode: mode === 'even' ? null : mode });
            host.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === m));
            host.querySelectorAll('.lt-pane').forEach(p => { p.hidden = p.dataset.pane !== mode; });
            return;
        }
        const ps = e.target.closest('[data-ps-act]');
        if (ps) {
            if (ps.dataset.psAct === 'add') { const last = steps.rules.at(-1); steps.rules.push({ from: Math.min(n, num(last?.to) + 1), to: n, step: num(last?.step) }); }
            if (ps.dataset.psAct === 'remove') steps.rules.splice(Number(ps.dataset.i), 1);
            drawSteps();
            return;
        }
        const down = e.target.closest('[data-down]');
        if (down) {
            const k = down.dataset.down, no = Number(down.closest('tr').dataset.no);
            const v = rows.find(x => x.no === no)[k];
            rows.filter(x => x.no > no).forEach(x => { x[k] = v; });
            host.querySelectorAll('tr[data-no]').forEach(tr => { if (Number(tr.dataset.no) > no) tr.querySelector(`input[data-k="${k}"]`).value = v; });
            changed();
            return;
        }
        const f = e.target.closest('[data-fill]')?.dataset.fill;
        if (f === 'even') {
            const first = num(q('[data-even="first"]').value), last = num(q('[data-even="last"]').value);
            if (!first || !last) { toast('Enter what month 1 and the last month give', 'error'); return; }
            setCol('payout', r => first + (last - first) * ((r.no - 1) / Math.max(1, n - 1)));
        }
        if (f === 'steps') { const pays = stepPayouts(); setCol('payout', r => pays[r.no - 1]); }
        if (f === 'cut') {
            if (fill.first === '' && fill.last === '') { toast('Enter the cut in month 1 (and in the last month)', 'error'); return; }
            const first = fill.first === '' ? num(fill.last) : num(fill.first), last = fill.last === '' ? 0 : num(fill.last);
            setCol('payout', r => M * (1 - (first + (last - first) * ((r.no - 1) / Math.max(1, n - 1))) / 100));
        }
        if (f === 'paste') {
            const text = q('[data-paste]').value;
            const lines = text.split(/\n|;/).map(l => l.trim()).filter(Boolean);
            const pairs = lines.map(l => (l.match(/^\s*(\d{1,3})\s*[=:.)\-\s]\s*₹?\s*([\d,]+(?:\.\d+)?)/) || []).slice(1)).filter(p => p.length === 2);
            const map = new Map();
            if (pairs.length && pairs.length === lines.length && pairs.every(([mm]) => Number(mm) >= 1 && Number(mm) <= n)) pairs.forEach(([mm, v]) => map.set(Number(mm), Number(v.replace(/,/g, ''))));
            else (text.match(/[\d,]+(?:\.\d+)?/g) || []).map(v => Number(v.replace(/,/g, ''))).filter(v => v > 0).forEach((v, k) => map.set(k + 1, v));
            if (!map.size) { toast('No amounts found in what was pasted', 'error'); return; }
            setCol('payout', r => (map.has(r.no) ? map.get(r.no) : null));
            toast(`${map.size} month${map.size === 1 ? '' : 's'} filled from the chart`);
        }
        if (f === 'copy') {
            const o = withTables.find(x => x.chit.id === Number(q('[data-copy-from]').value));
            const chart = parseChart(o.terms.liftChart);
            const kM = M / (num(o.chit.maturityAmount) || 1), kI = inst / (num(o.chit.monthlyInstallment) || 1);
            setCol('payout', r => (chart[r.no] ? chart[r.no].payout * kM : null));
            setCol('after', r => (chart[r.no]?.after != null ? chart[r.no].after * kI : null));
        }
        if (f === 'after') { const v = num(q('[data-after]').value); setCol('after', () => v); }
        if (f === 'full') { q('[data-after]').value = inst; setCol('after', () => inst); }
        if (f === 'extra') { const x = num(q('[data-extra]').value); if (!x) { toast('Enter the extra a month', 'error'); return; } setCol('after', r => r.regular + x); }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'reset') {
            const plain = { ...terms, liftChart: null };
            setCol('payout', r => Math.round(payoutFor(c, plain, r.no, maturityDate, r.date).gross));
            setCol('after', r => afterDefault ?? r.regular);
        }
        if (act === 'discard') {
            dirty = false;
            if (onApply) { onCancel?.(); return; }
            onPreview?.(null); mountLiftTable(host, c, d, opts);
        }
        if (act === 'save' && onApply) {
            // nothing entered on a new table: the rows are only estimates, which are not kept as if they were the organizer's
            if (!dirty && !terms) { onCancel?.(); return; }
            dirty = false; onApply(liveTerms()); return;
        }
        if (act === 'save') {
            const btn = e.target.closest('[data-act]');
            btn.disabled = true;
            try {
                const mine = liveTerms();
                const out = [await api.put(`/chits/${c.id}/lift-terms`, mine)];
                const picks = [...host.querySelectorAll('[data-copy]:checked')].map(i => similar.find(o => o.chit.id === Number(i.dataset.copy))).filter(Boolean);
                for (const o of picks) {
                    const kM = num(o.chit.maturityAmount) / (M || 1), kI = num(o.chit.monthlyInstallment) / (inst || 1);
                    out.push(await api.put(`/chits/${o.chit.id}/lift-terms`, { ...mine, liftChart: chartText(rows.map(r => ({ no: r.no, payout: r.payout * kM, after: r.after * kI }))) || null }));
                }
                dirty = false;
                toast(picks.length ? `Saved for ${c.name} and ${picks.length} similar chit${picks.length === 1 ? '' : 's'}` : 'Chit table saved');
                onSaved?.(out);
            } catch (error) {
                toast(error.message, 'error');
                btn.disabled = false;
            }
        }
    });
    refresh();
    return { dirty: () => dirty };
}
