/**
 * Accounts: the net worth card sits over the account list (what you own against what you owe, the asset mix
 * with its largest parts), beside it the money signals as cards with a small meter each (safety net, this
 * month, debt load, interest, card usage, invested, owed, maturing, idle money); the account list on the left
 * (search, ↑ / ↓ to move; each row with its 6-month trend), and for the selected account a branded banner,
 * metrics and its statement (named for the kind of account) shown as a plain list or as a timeline.
 */
import { api } from '../core/api.js';
import { loadAccounts, can, state } from '../core/store.js';
import { panel, esc, field, readForm, openModal, toast, confirmDialog, accountChip, emptyState, loading, table } from '../core/ui.js';
import { kindChip, entryKind } from '../core/entry-kind.js';
import { exportButton, bindExport } from '../core/export.js';
import { icon, accountTypeIcon } from '../core/icons.js';
import { money, moneyShort, date, shortDate, shortDateYear, percent, firstOfMonth, isoDate, number, daysFromToday } from '../core/format.js';
import { openQuickEntry } from '../components/transaction-forms.js';
import { toggleEntryRow } from '../components/entry-inline.js';
import { claimContextHtml, claimBadge, reminderText } from '../components/claim-panel.js';
import { openExpenseDialog } from '../components/expense-dialog.js';
import { openDebtDialog } from '../components/debt-dialog.js';
import { getPref, setPref } from '../core/prefs.js';
import { setPageKeys, listNavigator, isTyping } from '../core/keys.js';
import { periodChips, bindPeriodChips } from '../components/period-chips.js';
import { sparkline } from '../core/charts.js';

const CLASS_TABS = [
    { value: 'ASSET', label: 'Assets' },
    { value: 'LIABILITY', label: 'Liabilities' },
    { value: 'EQUITY', label: 'Equity' },
];
/** Income and expenses are split by category (Settings), not by account, so they are not listed here. */
const LISTED = new Set(CLASS_TABS.map(t => t.value));

/** Card colour family per bucket (see ReportService.bucket). */
const BUCKET_TONE = {
    'Liquid money': 'ocean', 'Investments': 'violet', 'Chits': 'aqua', 'Gold & silver': 'gold',
    'Property & vehicles': 'teal', 'Money owed to you': 'teal', 'Short-term dues': 'coral', 'Loans': 'red',
};

/** Mix bar colours follow the categorical palette in a fixed order. */
const MIX_ORDER = ['Liquid money', 'Investments', 'Chits', 'Gold & silver', 'Property & vehicles', 'Money owed to you'];

/** What the list of postings is called for each kind of account. */
const STATEMENT_NAME = {
    CASH: 'Cash book', BANK: 'Bank statement', WALLET: 'Wallet statement',
    FIXED_DEPOSIT: 'Deposit passbook', RECURRING_DEPOSIT: 'Deposit passbook', SAVINGS_SCHEME: 'Passbook',
    MUTUAL_FUND: 'Investment history', STOCKS: 'Investment history', BONDS: 'Investment history',
    GOLD: 'Holding history', SILVER: 'Holding history', REAL_ESTATE: 'Asset register', VEHICLE: 'Asset register',
    INSURANCE_POLICY: 'Premium history', CHIT_FUND: 'Chit passbook', RECEIVABLE: 'Collections', LOAN_GIVEN: 'Collections',
    OTHER_ASSET: 'Asset register', CREDIT_CARD: 'Card statement', PAYABLE: 'Dues history', OTHER_LIABILITY: 'Dues history',
    EQUITY: 'Capital movements', INCOME: 'Earnings', EXPENSE: 'Spending history',
};
const statementName = a => STATEMENT_NAME[a.accountType] || (a.accountClass === 'LIABILITY' ? 'Loan statement' : 'Statement');

const view = { tab: 'ALL', selectedId: null, search: '', from: firstOfMonth(-5), to: isoDate(), flow: 'all', pane: 'ledger', q: '' };

/** Statement display preference, kept per browser: plain list or timeline grouped by month / party. */
const prefs = getPref('statement', { grouped: false, groupBy: 'month' });
/** The account list: flat by default; grouped by class and type on demand (remembered). */
const listPrefs = getPref('accountList', { grouped: false });
const savePrefs = () => setPref('statement', prefs);

const toneOf = a => BUCKET_TONE[a.bucket] || (a.accountClass === 'INCOME' ? 'green' : a.accountClass === 'EXPENSE' ? 'coral' : 'slate');

export async function render(container, _params, isCurrent) {
    const accounts = await loadAccounts(true);
    if (!isCurrent()) return;
    Object.assign(prefs, getPref('statement', { grouped: false, groupBy: 'month' }));

    const of = cls => accounts.filter(a => a.accountClass === cls);
    const total = cls => of(cls).reduce((s, a) => s + Number(a.balance), 0);
    const change = cls => of(cls).reduce((s, a) => s + Number(a.change30Days || 0), 0);
    const monthFlow = cls => of(cls).reduce((s, a) => s + Math.abs(Number(a.monthMovement || 0)), 0);
    const assets = total('ASSET');
    const liabilities = total('LIABILITY');
    const netChange = change('ASSET') - change('LIABILITY');
    const mix = MIX_ORDER.map((bucket, i) => ({
        bucket, color: `var(--series-${i + 1})`,
        value: of('ASSET').filter(a => a.bucket === bucket).reduce((s, a) => s + Math.max(0, Number(a.balance)), 0),
    })).filter(m => m.value > 0);
    const mixTotal = mix.reduce((s, m) => s + m.value, 0) || 1;
    const bucket = name => of('ASSET').filter(a => a.bucket === name).reduce((s, a) => s + Number(a.balance), 0);
    const liquid = bucket('Liquid money');
    const invested = bucket('Investments') + bucket('Chits') + bucket('Gold & silver');
    const cards = accounts.filter(a => a.accountType === 'CREDIT_CARD' && a.creditLimit);
    const cardLimit = cards.reduce((s, a) => s + Number(a.creditLimit), 0);
    const cardUsed = cards.reduce((s, a) => s + Math.max(0, Number(a.balance)), 0);
    const maturing = accounts.filter(a => a.maturityDate && a.daysToMaturity >= 0 && a.daysToMaturity <= 90);
    const idle = of('ASSET').filter(a => a.active && Number(a.balance) > 0 && a.bucket !== 'Property & vehicles'
        && (!a.lastActivity || -daysFromToday(a.lastActivity) > 90));
    // average monthly spend over the last four full months, from the expense accounts' month-end balances
    const avgSpend = of('EXPENSE').reduce((s, a) => s + (a.trend?.length >= 5 ? (Number(a.trend[4]) - Number(a.trend[0])) / 4 : 0), 0);
    const runway = avgSpend > 0 ? liquid / avgSpend : null;
    const income = monthFlow('INCOME'), spent = monthFlow('EXPENSE');
    const interestCost = of('LIABILITY').reduce((s, a) => s + (a.interestRate ? Math.max(0, Number(a.balance)) * Number(a.interestRate) / 1200 : 0), 0);
    const interestEarn = of('ASSET').reduce((s, a) => s + (a.interestRate ? Math.max(0, Number(a.balance)) * Number(a.interestRate) / 1200 : 0), 0);
    const owedToYou = accounts.filter(a => ['RECEIVABLE', 'LOAN_GIVEN'].includes(a.accountType)).reduce((s, a) => s + Number(a.balance), 0);
    const youOwe = accounts.filter(a => a.accountType === 'PAYABLE').reduce((s, a) => s + Number(a.balance), 0);

    // a signal card: icon, figure, note and (when it has one) a meter of how far along it is
    const chip = (iconName, label, value, sub, cls = '', title = '', meter = null) => `
        <div class="ov-card ${cls}" ${title ? `title="${esc(title)}"` : ''}>
            <span class="ov-ico">${icon(iconName)}</span>
            <div class="min-0"><span class="ov-label">${label}</span><b>${value}</b><small>${sub}</small>
                ${meter !== null ? `<i class="ov-meter"><em style="width:${Math.max(2, Math.min(100, meter))}%"></em></i>` : ''}</div>
        </div>`;
    const netWorth = assets - liabilities;
    const topMix = [...mix].sort((a, b) => b.value - a.value).slice(0, 3);
    // net worth at each of the last month-ends (from every account's trend), and the 6-month change
    const points = Math.max(0, ...accounts.map(a => (a.trend || []).length));
    const nwTrend = Array.from({ length: points }, (_, i) => accounts.reduce((s, a) => {
        const v = Number((a.trend || [])[i] ?? 0);
        return s + (a.accountClass === 'ASSET' ? v : a.accountClass === 'LIABILITY' ? -v : 0);
    }, 0));
    const sixChange = nwTrend.length > 1 ? netWorth - nwTrend[0] : 0;

    container.innerHTML = `
    <div class="page accounts-page">
        <section class="ov-net-card ${netWorth < 0 ? 'neg' : ''}">
            <div class="onc-head"><span class="onc-mark">${icon('scale')}</span><div class="min-0"><small>Net worth</small><b>${money(netWorth)}</b></div>
                ${nwTrend.length > 1 ? `<span class="onc-spark" title="Net worth at the last month-ends · ${sixChange >= 0 ? '+' : '−'}${money(Math.abs(sixChange))} in 6 months">${sparkline(nwTrend, { width: 70, height: 24, color: sixChange >= 0 ? '#1f9a5a' : '#c2363a' })}</span>` : ''}
                <span class="onc-change ${netChange >= 0 ? 'up' : 'down'}" title="Change in the last 30 days">${netChange >= 0 ? '▲' : '▼'} ${moneyShort(Math.abs(netChange))}<small>30 days</small></span></div>
            <div class="onc-split" title="What you own against what you owe">
                <span class="own"><small>Own</small><b>${moneyShort(assets)}</b></span>
                <i class="onc-bar"><em style="width:${assets + liabilities ? (assets / (assets + liabilities)) * 100 : 100}%"></em></i>
                <span class="owe"><small>Owe</small><b>${moneyShort(liabilities)}</b></span>
            </div>
            <div class="mix-bar" title="Asset mix">${mix.map(m =>
                `<span style="width:${(m.value / mixTotal) * 100}%;background:${m.color}" title="${esc(m.bucket)} ${money(m.value)} · ${percent((m.value / mixTotal) * 100, 0)}"></span>`).join('')}</div>
            <div class="onc-facts">
                <span title="Cash, bank and wallets">${icon('droplet')}Liquid <b>${moneyShort(liquid)}</b></span>
                <span title="Funds, chits, gold">${icon('trending')}Invested <b>${moneyShort(invested)}</b></span>
                <span title="Net worth change over the last 6 months" class="${sixChange >= 0 ? 'up' : 'down'}">${icon('history')}6 mo <b>${sixChange >= 0 ? '+' : '−'}${moneyShort(Math.abs(sixChange))}</b></span>
            </div>
        </section>
        <div class="ov-cards">
            ${chip('droplet', 'Safety net', runway === null ? moneyShort(liquid) : `${runway.toFixed(1)} months`,
                runway === null ? 'liquid cash' : `${moneyShort(liquid)} in cash & bank`, runway !== null && runway < 3 ? 'warn' : runway !== null && runway >= 6 ? 'good' : '',
                `Cash and bank cover ${runway?.toFixed(1)} months of your average spending (${moneyShort(avgSpend)}/month); 6 months is a good cushion`,
                runway === null ? null : (runway / 6) * 100)}
            ${chip('transfer', 'This month', `${income - spent >= 0 ? '+' : '−'}${moneyShort(Math.abs(income - spent))}`,
                `in ${moneyShort(income)} · out ${moneyShort(spent)}`, income - spent < 0 ? 'warn' : 'good', 'Income minus expenses so far this month',
                income ? Math.min(100, (spent / income) * 100) : null)}
            ${chip('scale', 'Debt load', percent(assets ? (liabilities / assets) * 100 : 0, 0), `${moneyShort(liabilities)} owed`,
                liabilities / (assets || 1) > 0.4 ? 'warn' : 'good', 'Liabilities as a share of assets; under 40% is comfortable', assets ? (liabilities / assets) * 100 : 0)}
            ${chip('percent', 'Interest / month', `−${moneyShort(interestCost)}`, `earning +${moneyShort(interestEarn)}`, interestCost > interestEarn ? 'warn' : 'good',
                'Interest your loans cost vs what your deposits earn each month, from the account rates',
                interestCost + interestEarn ? (interestEarn / (interestCost + interestEarn)) * 100 : null)}
            ${cardLimit ? chip('card', 'Card usage', percent((cardUsed / cardLimit) * 100, 0), `${moneyShort(cardUsed)} of ${moneyShort(cardLimit)}`,
                cardUsed / cardLimit > 0.3 ? 'warn' : 'good', 'Keep credit card use under 30% of the limit', (cardUsed / cardLimit) * 100) : ''}
            ${chip('trending', 'Invested', percent(assets ? (invested / assets) * 100 : 0, 0), `${moneyShort(invested)} in funds, chits, gold`, '', '',
                assets ? (invested / assets) * 100 : 0)}
            ${chip('hand', 'Owed to you', moneyShort(owedToYou), `you owe ${moneyShort(youOwe)}`, '', 'Money others owe you vs money you owe (payables)',
                owedToYou + youOwe ? (owedToYou / (owedToYou + youOwe)) * 100 : null)}
            ${chip('hourglass', 'Maturing 90d', `${maturing.length}`, maturing.length ? moneyShort(maturing.reduce((s, a) => s + Number(a.balance), 0)) : 'nothing due',
                maturing.length ? 'note' : '', maturing.map(a => `${a.name} · ${date(a.maturityDate)}`).join('\n'))}
            ${chip('clock', 'Idle 90d+', `${idle.length}`, idle.length ? `${moneyShort(idle.reduce((s, a) => s + Number(a.balance), 0))} untouched` : 'all active',
                idle.length ? 'warn' : 'good', idle.map(a => a.name).join(', '))}
        </div>
        ${panel({
            title: 'Accounts', iconName: 'wallet', cls: 'p-list', bodyClass: 'flush',
            sub: `<span id="acct-count"></span>`,
            actions: can('MANAGE_ACCOUNTS') ? `<button class="btn sm primary" id="new-account" title="Add account">${icon('plus')}Account</button>` : '',
            body: `
                <div class="list-tools">
                    <div class="search-box">${icon('search')}<input id="account-search" name="q-accounts" data-plain placeholder="Search accounts…  ↑↓ to move" value="${esc(view.search)}"></div>
                    <div class="class-filter" id="class-filter">${[{ value: 'ALL', label: 'All' }, ...CLASS_TABS].map(t =>
                        `<button class="cf-chip ${view.tab === t.value ? 'active' : ''}" data-tab="${t.value}">${t.value === 'ALL' ? 'All' : t.label}<i>${t.value === 'ALL' ? accounts.filter(a => LISTED.has(a.accountClass)).length : of(t.value).length}</i></button>`).join('')}
                        <label class="switch sm list-group-switch" title="Group the list by assets / liabilities and account type"><input type="checkbox" id="acct-grouped" ${listPrefs.grouped ? 'checked' : ''}><span></span>Group</label></div>
                </div>
                <div class="scroll account-list" id="account-list" tabindex="0" aria-label="Accounts, use the arrow keys to move"></div>`,
        })}
        <div class="account-detail" id="account-detail"></div>
    </div>`;

    const listEl = container.querySelector('#account-list');
    container.querySelector('#acct-grouped').addEventListener('change', e => {
        listPrefs.grouped = e.target.checked;
        setPref('accountList', listPrefs);
        drawList();
        listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    });
    const ORDER = ['ASSET', 'LIABILITY', 'EQUITY'];
    const visible = () => {
        const term = view.search.toLowerCase();
        return accounts.filter(a => LISTED.has(a.accountClass) && (view.tab === 'ALL' || a.accountClass === view.tab)
            && (!term || [a.name, a.institution, a.code, a.typeLabel, a.accountNumber].some(v => v && v.toLowerCase().includes(term))))
            .sort((a, b) => ORDER.indexOf(a.accountClass) - ORDER.indexOf(b.accountClass));
    };
    const drawList = () => {
        const list = visible();
        container.querySelector('#acct-count').textContent = `${list.length}`;
        if (!list.length) { listEl.innerHTML = emptyState('No accounts match', 'wallet'); return; }
        if (!listPrefs.grouped) {   // one plain list: assets, liabilities, equity, each by name
            listEl.innerHTML = [...list].sort((a, b) => ORDER.indexOf(a.accountClass) - ORDER.indexOf(b.accountClass)
                || a.name.localeCompare(b.name)).map(accountItem).join('');
            return;
        }
        let html = '';
        ORDER.forEach(cls => {
            const ofClass = list.filter(a => a.accountClass === cls);
            if (!ofClass.length) return;
            if (view.tab === 'ALL') html += `<div class="class-head tone-${cls.toLowerCase()}"><span>${CLASS_TABS.find(t => t.value === cls).label}</span>
                <b>${money(ofClass.reduce((s, a) => s + Number(a.balance), 0))}</b></div>`;
            const groups = new Map();
            ofClass.forEach(a => { if (!groups.has(a.typeLabel)) groups.set(a.typeLabel, []); groups.get(a.typeLabel).push(a); });
            html += [...groups.entries()].map(([label, items]) => `
                ${groups.size > 1 || view.tab !== 'ALL' ? `<div class="group-label"><span>${esc(label)} <i>${items.length}</i></span><b>${money(items.reduce((s, a) => s + Number(a.balance), 0))}</b></div>` : ''}
                ${items.map(accountItem).join('')}`).join('');
        });
        listEl.innerHTML = html;
    };

    let detailTimer;
    const select = (id, { soon = false } = {}) => {
        view.selectedId = id;
        listEl.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === id));
        listEl.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
        clearTimeout(detailTimer);
        const draw = () => drawDetail(container.querySelector('#account-detail'), accounts.find(a => a.id === id), () => render(container, [], isCurrent), accounts);
        if (soon) detailTimer = setTimeout(draw, 140);   // keyboard: wait until the arrow key settles
        else draw();
    };
    const selectFirst = () => {
        const first = visible()[0];
        if (first) select(first.id);
    };

    container.querySelector('#class-filter').addEventListener('click', e => {
        const chipEl = e.target.closest('[data-tab]');
        if (!chipEl || chipEl.dataset.tab === view.tab) return;
        view.tab = chipEl.dataset.tab;
        container.querySelectorAll('#class-filter [data-tab]').forEach(c => c.classList.toggle('active', c === chipEl));
        drawList();
        if (!visible().some(a => a.id === view.selectedId)) selectFirst();
        else select(view.selectedId);
    });
    const search = container.querySelector('#account-search');
    search.addEventListener('input', e => { view.search = e.target.value; drawList(); selectFirst(); });
    search.addEventListener('keydown', e => {
        if (e.key === 'Escape' && search.value) { search.value = ''; view.search = ''; drawList(); }
    });
    listEl.addEventListener('click', e => {
        const item = e.target.closest('[data-id]');
        if (item) { select(Number(item.dataset.id)); listEl.focus({ preventScroll: true }); }
    });

    // ↑ / ↓ (also from the search box), Home / End, PgUp / PgDn; ← / → switch the class filter
    const nav = listNavigator({
        items: () => [...listEl.querySelectorAll('[data-id]')],
        selected: () => listEl.querySelector('.selected'),
        select: el => select(Number(el.dataset.id), { soon: true }),
        allowWhileTyping: search,
    });
    setPageKeys(e => {
        if (nav(e)) return true;
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping()) {
            const tabs = [...container.querySelectorAll('#class-filter [data-tab]')];
            const at = tabs.findIndex(t => t.classList.contains('active'));
            tabs[Math.max(0, Math.min(tabs.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))]?.click();
            return true;
        }
        return false;
    });

    container.querySelector('#new-account')?.addEventListener('click', () =>
        openAccountForm(null, saved => { view.selectedId = saved.id; render(container, [], isCurrent); }));

    drawList();
    const initial = visible().find(a => a.id === view.selectedId) || visible()[0];
    if (initial) select(initial.id);
    else container.querySelector('#account-detail').innerHTML = panel({ title: 'Account', iconName: 'wallet', body: emptyState('Select an account') });
}

/** "today", "3d ago", "5w ago", "4mo ago" */
function ago(iso) {
    const days = -daysFromToday(iso);
    if (days <= 0) return 'today';
    if (days < 14) return `${days}d ago`;
    if (days < 60) return `${Math.round(days / 7)}w ago`;
    return `${Math.round(days / 30)}mo ago`;
}

/** Up to two short facts that matter for this kind of account. */
function accountFacts(a) {
    const facts = [];
    const fact = (text, cls = '', title = '') => facts.push(`<span class="fact ${cls}" ${title ? `title="${esc(title)}"` : ''}>${text}</span>`);
    if (a.accountType === 'CREDIT_CARD' && a.creditLimit) {
        const util = Number(a.utilizationPercent || 0);
        fact(`${percent(util, 0)} used`, util > 70 ? 'bad' : util > 30 ? 'warn' : 'good', 'Credit utilization');
        fact(`avail ${moneyShort(a.availableCredit)}`);
    } else if (a.creditLimit && a.accountClass === 'LIABILITY') {
        fact(`${percent(100 - Number(a.utilizationPercent || 0), 0)} repaid`, 'good', `Sanctioned ${money(a.creditLimit)}`);
    }
    if (a.interestRate) fact(`${percent(a.interestRate, 1)} p.a.`);
    if (a.maturityDate) {
        fact(a.daysToMaturity >= 0 ? `matures ${shortDate(a.maturityDate)}` : 'matured',
            a.daysToMaturity >= 0 && a.daysToMaturity < 60 ? 'warn' : '', date(a.maturityDate));
    }
    if (a.quantity) fact(`${number(a.quantity)} g/units`);
    if (a.lastActivity) {
        const idle = -daysFromToday(a.lastActivity);
        fact(idle > 90 && a.accountClass === 'ASSET' ? `idle ${Math.round(idle / 30)}mo` : ago(a.lastActivity),
            idle > 90 && a.accountClass === 'ASSET' ? 'warn' : '', `Last activity ${date(a.lastActivity)}`);
    } else {
        fact('no activity', 'muted');
    }
    return facts.slice(0, 2);
}

/** One compact row in the account list: name and balance, institution and 30-day change, key facts. */
/** Sparkline colour per family, matching the row's accent. */
const SPARK = { ocean: '#0b7cbd', violet: '#5b4fc9', aqua: '#13a89a', gold: '#c99a3b', teal: '#13808f', coral: '#d9603c', red: '#b02a2a', green: '#0b7a3b', slate: '#7b8fa3' };

function accountItem(a) {
    const change = Number(a.change30Days);
    const debt = a.accountClass === 'LIABILITY';
    const good = debt ? change <= 0 : change >= 0;
    const util = a.utilizationPercent !== null ? Number(a.utilizationPercent) : null;
    const meta = [a.institution || a.typeLabel, a.accountNumber ? maskNumber(a.accountNumber) : ''].filter(Boolean);
    const trend = (a.trend || []).map(Number);
    const moving = trend.length > 1 && trend.some(v => v !== trend[0]);
    return `
    <div class="acct-item rich accent-${toneOf(a)} ${a.id === view.selectedId ? 'selected' : ''} ${a.active ? '' : 'inactive'}" data-id="${a.id}">
        ${accountChip(a.accountType, true)}
        <div class="acct-main">
            <div class="acct-line">
                <span class="acct-name">${esc(a.name)}${a.systemAccount ? `<span class="lock" title="System account">${icon('lock')}</span>` : ''}</span>
                ${moving ? `<span class="acct-spark" title="Balance over the last 6 months">${sparkline(trend, { width: 46, height: 16, color: SPARK[toneOf(a)] || SPARK.slate })}</span>` : ''}
                <b class="acct-bal ${Number(a.balance) < 0 ? 'neg' : ''}">${money(a.balance)}</b>
            </div>
            <div class="acct-line sub">
                <span class="acct-meta">${meta.map(esc).join(' · ')}</span>
                <span class="acct-facts">${accountFacts(a).join('')}</span>
                ${change ? `<span class="acct-delta ${good ? 'pos' : 'neg'}" title="Change in the last 30 days">${change > 0 ? '▲' : '▼'}${moneyShort(Math.abs(change))}</span>`
                         : '<span class="acct-delta muted" title="No change in the last 30 days">–</span>'}
            </div>
            ${util !== null && debt ? `<div class="acct-util ${util > 70 ? 'over' : util > 40 ? 'warning' : 'good'}"><span style="width:${Math.min(util, 100)}%"></span></div>` : ''}
        </div>
    </div>`;
}

function maskNumber(number) {
    const digits = number.replace(/\s/g, '');
    return digits.length > 4 ? '•• ' + digits.slice(-4) : digits;
}

// ===================================================================== detail pane

async function drawDetail(target, account, reload, all = []) {
    if (!account) return;
    const debitNormal = account.accountClass === 'ASSET' || account.accountClass === 'EXPENSE';
    const debt = account.accountClass === 'LIABILITY';
    const tone = toneOf(account);
    const { name: iconName } = accountTypeIcon(account.accountType);
    const change = Number(account.change30Days);
    const good = debt ? change <= 0 : change >= 0;
    const title = statementName(account);

    const owedAccount = account.accountType === 'RECEIVABLE' || account.accountType === 'LOAN_GIVEN';
    const oweAccount = account.accountType === 'PAYABLE';
    const peopleAccount = owedAccount || oweAccount;
    const allClaims = (await api.get('/claims')).claims;
    const claims = peopleAccount ? allClaims.filter(c => c.receivableAccountId === account.id) : [];
    // any entry that belongs to money lent / borrowed, wherever it is posted: the item and what the entry is in it
    const entryClaims = new Map();
    allClaims.forEach(c => {
        const payable = c.kind === 'BORROWED' || c.kind === 'BILL_DUE';
        if (c.journalEntryId) entryClaims.set(c.journalEntryId, { claim: c, role: payable ? (c.kind === 'BILL_DUE' ? 'bill' : 'borrowed') : c.kind === 'PAID_FOR' ? 'paid for' : 'given' });
        c.repayments.forEach((r, i) => entryClaims.set(r.journalEntryId, { claim: c,
            role: r.writeOff ? (payable ? 'waived' : 'written off') : r.finalPayment ? 'final payment' : `payment ${c.repayments.filter(x => !x.writeOff).indexOf(r) + 1}` }));
        c.postings.forEach(x => entryClaims.set(x.journalEntryId, { claim: c, role: 'interest' }));
    });
    if (!peopleAccount) view.pane = 'ledger';
    // a receivable / payable opens on its collections (dues) statement, on the items still open whatever their date
    else if (view.paneAccount !== account.id) { view.pane = 'ledger'; view.peopleFilter = 'open'; view.flow = claims.some(c => c.status === 'OPEN' || c.status === 'PARTIAL') ? 'open' : 'all'; }
    else if (view.pane !== 'ledger' && view.pane !== 'people') view.pane = 'people';
    view.paneAccount = account.id;
    if (!peopleAccount && view.flow === 'open') view.flow = 'all';
    const isOpen = c => c.status === 'OPEN' || c.status === 'PARTIAL';
    const openClaims = claims.filter(isOpen);
    // every journal entry of the open items: the money given, payments so far and posted interest
    const openEntries = new Set(openClaims.flatMap(c => [c.journalEntryId, ...c.repayments.map(r => r.journalEntryId), ...c.postings.map(x => x.journalEntryId)]).filter(Boolean));
    const openFrom = openClaims.reduce((m, c) => (c.startDate < m ? c.startDate : m), view.from);
    const actions = quickActions(account).map(([act, iconName, label, title]) =>
        `<button class="btn sm on-dark" data-act="${act}" title="${esc(title)}">${icon(iconName)}${label}</button>`).join('')
        + (can('MANAGE_ACCOUNTS') ? `<button class="btn sm on-dark icon" data-act="edit" title="Edit account">${icon('edit')}</button>` : '');
    const meta = [account.institution, account.typeLabel, account.code, account.accountNumber ? maskNumber(account.accountNumber) : '']
        .filter(Boolean).filter((v, i, list) => list.indexOf(v) === i);

    target.innerHTML = `
        <section class="panel p-account-head">
            <div class="acct-banner tone-${tone}">
                <span class="hero-icon">${icon(iconName)}</span>
                <div class="ab-id">
                    <div class="ab-name">${esc(account.name)}
                        ${account.systemAccount ? `<span class="hero-badge">${icon('lock')}System</span>` : ''}
                        ${account.active ? '' : '<span class="hero-badge">Inactive</span>'}</div>
                    <div class="ab-meta">${meta.map(esc).join('<i>·</i>')}</div>
                    ${account.description ? `<div class="ab-desc" title="${esc(account.description)}">${icon('info')}<span>${esc(account.description)}</span></div>` : ''}
                </div>
                <div class="ab-bal">
                    <small>${debt ? 'Outstanding' : 'Balance'}</small>
                    <b>${money(account.balance)}</b>
                    <span class="ab-change ${change ? (good ? 'up' : 'down') : ''}">${change ? `${change > 0 ? '▲' : '▼'} ${moneyShort(Math.abs(change))} in 30 days` : 'No change in 30 days'}</span>
                </div>
                <div class="ab-actions">${actions}</div>
            </div>
            <div class="acct-key">${metrics(account, debt, all).join('')}</div>
        </section>
        ${panel({
            title: view.pane === 'people' ? (oweAccount ? 'Who you owe' : 'Who owes you') : title,
            iconName: view.pane === 'people' ? (oweAccount ? 'card' : 'hand') : 'list', cls: 'p-ledger', bodyClass: 'flush',
            actions: (peopleAccount ? `<div class="seg-chips sm" id="pane-tabs">
                        <button class="seg-chip ${view.pane === 'people' ? 'active' : ''}" data-pane="people">${icon(oweAccount ? 'card' : 'hand')}People<span class="count">${openClaims.length}</span></button>
                        <button class="seg-chip ${view.pane === 'ledger' ? 'active' : ''}" data-pane="ledger">${icon('list')}${esc(title)}</button></div>` : '')
                + (view.pane === 'people' ? (can('POST_TRANSACTIONS') ? `<button class="btn sm primary" id="new-claim">${icon('plus')}${oweAccount ? 'Borrowed / bill' : 'Lent / paid for'}</button>` : '') : `
                      <label class="switch" title="Timeline groups the entries by month or by party, with totals per group">
                        <input type="checkbox" id="timeline-toggle" ${prefs.grouped ? 'checked' : ''}><span></span>Timeline</label>
                      <div class="seg-chips sm" id="group-by" ${prefs.grouped ? '' : 'hidden'}>
                        <button class="seg-chip ${prefs.groupBy === 'month' ? 'active' : ''}" data-group="month">Month</button>
                        <button class="seg-chip ${prefs.groupBy === 'party' ? 'active' : ''}" data-group="party">Party</button></div>
                      <div class="tabs sm" id="flow-tabs">
                        ${peopleAccount ? `<button class="tab ${view.flow === 'open' ? 'active' : ''}" data-flow="open" title="Every entry of the items still open, whatever the period">Open items</button>` : ''}
                        <button class="tab ${view.flow === 'all' ? 'active' : ''}" data-flow="all">All</button>
                        <button class="tab ${view.flow === 'in' ? 'active' : ''}" data-flow="in">${debt ? 'Increase' : 'In'}</button>
                        <button class="tab ${view.flow === 'out' ? 'active' : ''}" data-flow="out">${debt ? 'Repaid' : 'Out'}</button></div>
                      <span id="ledger-period">${periodChips(view.from, view.to)}</span>
                      <span class="search-box sm ledger-search">${icon('search')}<input id="ledger-q" placeholder="Search… entry no. or #id too" value="${esc(view.q || '')}" data-plain></span>
                      <button class="btn sm ghost icon" id="ledger-clear" title="Clear filters: all entries, last 6 months, no search" ${view.q || view.flow !== 'all' || view.from !== firstOfMonth(-5) || view.to !== isoDate() ? '' : 'hidden'}>${icon('x')}</button>
                      ${exportButton({ label: '' })}`),
            body: view.pane === 'people' ? `<div class="people-filter seg-chips sm" id="people-filter">${[['open', 'Open', openClaims.length], ['settled', 'Settled', claims.length - openClaims.length], ['all', 'All', claims.length]]
                    .map(([k, l, n]) => `<button class="seg-chip ${(view.peopleFilter || 'open') === k ? 'active' : ''}" data-people="${k}">${l}<span class="count">${n}</span></button>`).join('')}
                    <span class="small muted">${(view.peopleFilter || 'open') === 'open' ? 'whatever their date' : ''}</span></div>
                <div class="scroll" id="people-list">${peopleHtml(claims.filter(c => ({ open: isOpen(c), settled: !isOpen(c), all: true })[view.peopleFilter || 'open']), oweAccount, claims)}</div>`
                : `<div class="ledger-summary" id="ledger-summary"></div><div class="scroll" id="ledger-table">${loading()}</div>`,
        })}`;


    target.querySelector('[data-act="edit"]')?.addEventListener('click', () => openAccountForm(account, reload));
    target.querySelector('.ab-actions').addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b || b.dataset.act === 'edit') return;
        const id = account.id;
        ({
            spend: () => openQuickEntry({ kind: 'EXPENSE', preset: { fromAccountId: id }, onSaved: reload }),
            expense: () => openExpenseDialog({ onSaved: reload }),
            receive: () => openQuickEntry({ kind: 'INCOME', preset: { toAccountId: id }, onSaved: reload }),
            income: () => openQuickEntry({ kind: 'INCOME', preset: { fromAccountId: id }, onSaved: reload }),
            out: () => openQuickEntry({ kind: 'TRANSFER', preset: { fromAccountId: id }, onSaved: reload }),
            in: () => openQuickEntry({ kind: 'TRANSFER', preset: { toAccountId: id }, onSaved: reload }),
            lend: () => openExpenseDialog({ mode: 'LENT', onSaved: reload }),
            owe: () => openDebtDialog({ payableAccountId: id, onSaved: reload }),
        })[b.dataset.act]?.();
    });

    target.querySelector('#pane-tabs')?.addEventListener('click', e => {
        const b = e.target.closest('[data-pane]');
        if (b) { view.pane = b.dataset.pane; drawDetail(target, account, reload, all); }
    });
    if (view.pane === 'people') {
        target.querySelector('#people-filter')?.addEventListener('click', e => {
            const b = e.target.closest('[data-people]');
            if (b) { view.peopleFilter = b.dataset.people; drawDetail(target, account, reload, all); }
        });
        target.querySelector('#new-claim')?.addEventListener('click', () => oweAccount
            ? openDebtDialog({ payableAccountId: account.id, onSaved: reload }) : openExpenseDialog({ mode: 'LENT', onSaved: reload }));
        target.querySelector('#people-list').addEventListener('click', async e => {
            const remind = e.target.closest('[data-remind]');
            if (!remind) return;
            e.stopPropagation();
            await navigator.clipboard.writeText(reminderText(claims.find(c => String(c.id) === remind.dataset.remind)));
            toast('Reminder copied', 'info');
        });
        const peopleEl = target.querySelector('#people-list');
        peopleEl.addEventListener('click', e => {
            const row = e.target.closest('tr[data-claim-row]');
            if (!row || e.target.closest('.detail-row')) return;
            const next = row.nextElementSibling;
            peopleEl.querySelectorAll('tr.detail-row').forEach(d => d.remove());
            peopleEl.querySelectorAll('tr.expanded').forEach(d => d.classList.remove('expanded'));
            if (next?.classList.contains('detail-row')) return;
            const claim = claims.find(c => String(c.id) === row.dataset.claimRow);
            row.classList.add('expanded');
            row.insertAdjacentHTML('afterend', `<tr class="detail-row"><td colspan="${row.children.length}">${claimContextHtml(claim)}</td></tr>`);
        });
        return;
    }

    let ledger = null;
    const tableEl = target.querySelector('#ledger-table');
    const isIn = r => (debitNormal ? Number(r.debit) : Number(r.credit)) > 0;
    const amountOf = r => Number(r.debit) + Number(r.credit);
    // a Status column whenever the statement holds entries of money lent / borrowed (receivables, payables, and the
    // bank or interest accounts their payments go through)
    /** "· for Ravi" grayed after the entry: who the money lent / paid for / borrowed belongs to. */
    const personOf = r => {
        const hit = entryClaims.get(r.entryId);
        if (hit && (r.narration || '').toLowerCase().includes(hit.claim.party.toLowerCase())) return '';   // already named
        return hit ? `<span class="ls-person" title="${esc(hit.claim.kindLabel)}">${esc(personWord(hit))} ${esc(hit.claim.party)}</span>` : '';
    };
    const inlineStatus = r => {
        const hit = entryClaims.get(r.entryId);
        return hit ? `<span class="ls-inline" title="${esc(`${hit.claim.narration} · ${hit.role}`)}">${claimBadge(hit.claim)}</span>` : '';
    };
    const statusCol = { label: 'Status', cls: 'c-lstatus', render: r => {
        const hit = entryClaims.get(r.entryId);
        return hit ? `<span class="ls-cell" title="${esc(`${hit.claim.party} · ${hit.claim.narration} · ${hit.role}`)}">${claimBadge(hit.claim)}<span class="ls-role">${esc(hit.role)}</span></span>` : '';
    } };
    const baseColumns = [
        { label: 'Date', render: r => date(r.date), cls: 'nowrap c-date' },
        { label: 'Entry', cls: 'c-entry', render: r => `<div class="entry-cell">${kindChip(r.voucherType, 'sm', r.voucherLabel)}
            <span class="entry-text"><b class="ellipsis">${esc(r.narration)}</b>${personOf(r)}${peopleAccount ? '' : inlineStatus(r)}${r.counterAccounts ? `<span class="entry-party ellipsis" title="The other side">${icon(isIn(r) ? 'arrow-in' : 'arrow-out')}${esc(r.counterAccounts)}</span>` : ''}</span></div>` },
        { label: debitNormal ? 'In (Dr)' : 'Out (Dr)', align: 'r', render: r => Number(r.debit) ? `<span class="dr-amt">${money(r.debit)}</span>` : '' },
        { label: debitNormal ? 'Out (Cr)' : 'In (Cr)', align: 'r', render: r => Number(r.credit) ? `<span class="cr-amt">${money(r.credit)}</span>` : '' },
        { label: 'Balance', align: 'r', render: r => `<b>${money(r.balance)}</b>` },
        { label: '', align: 'r', render: () => `<span class="expand-caret">${icon('chevron-down')}</span>` },
    ];
    // the Status column on receivables / payables; elsewhere (bank, interest accounts) the status sits inline
    const columns = () => (peopleAccount ? [baseColumns[0], baseColumns[1], statusCol, ...baseColumns.slice(2)] : baseColumns);

    // free text: description, the other side, kind, entry number (EX-000123) or id (#123)
    const textMatch = r => {
        const q = (view.q || '').trim().toLowerCase();
        if (!q) return true;
        if (q.replace(/^#/, '') === String(r.entryId)) return true;
        return [r.narration, r.counterAccounts, r.entryNo, entryKind(r.voucherType).label].some(v => (v || '').toLowerCase().includes(q));
    };
    const visibleRows = () => [...ledger.rows].reverse()
        .filter(r => view.flow === 'all' || (view.flow === 'open' ? openEntries.has(r.entryId) : view.flow === 'in' ? isIn(r) : !isIn(r))).filter(textMatch);
    const drawLedger = () => {
        const rows = visibleRows();
        const inflow = ledger.rows.filter(isIn).reduce((s, r) => s + amountOf(r), 0);
        const outflow = ledger.rows.filter(r => !isIn(r)).reduce((s, r) => s + amountOf(r), 0);
        const biggest = ledger.rows.reduce((m, r) => (!m || amountOf(r) > amountOf(m) ? r : m), null);
        target.querySelector('#ledger-summary').innerHTML = `
            <span>Opening <b>${money(ledger.openingBalance)}</b></span>
            <span class="pos">+ ${money(inflow)}</span><span class="neg">− ${money(outflow)}</span>
            <span>Closing <b>${money(ledger.closingBalance)}</b></span>
            ${biggest ? `<span class="muted" title="${esc(biggest.narration)}">Largest ${moneyShort(amountOf(biggest))} · ${shortDate(biggest.date)}</span>` : ''}
            <span class="muted">${ledger.rows.length} entries · ${date(ledger.from)} → ${date(ledger.to)}</span>`;
        if (!prefs.grouped) {
            tableEl.innerHTML = table(columns(), rows, {
                dense: true, rowClass: () => 'clickable', rowAttrs: r => `data-entry="${r.entryId}"`, empty: 'No entries in this period',
            });
            return;
        }
        tableEl.innerHTML = groupedTable(columns(), rows, prefs.groupBy, { isIn, amountOf });
    };
    // "Open items" reaches back to the oldest open item, whatever period is picked
    const loadLedger = async () => {
        const from = view.flow === 'open' ? openFrom : view.from;
        const to = view.flow === 'open' ? isoDate() : view.to;
        ledger = await api.get(`/reports/ledger/${account.id}`, { from, to });
        drawLedger();
    };

    tableEl.addEventListener('click', e => {
        const head = e.target.closest('tr[data-group-head]');
        if (head) {
            const collapsed = head.classList.toggle('collapsed');
            tableEl.querySelectorAll('tr.detail-row').forEach(r => r.remove());
            tableEl.querySelectorAll('tr.expanded').forEach(r => r.classList.remove('expanded'));
            tableEl.querySelectorAll(`tr[data-group="${head.dataset.groupHead}"]`).forEach(r => { r.hidden = collapsed; });
            return;
        }
        const row = e.target.closest('tr[data-entry]');
        if (row) toggleEntryRow(row, null, { onChanged: reload });
    });
    target.querySelector('#flow-tabs').addEventListener('click', e => {
        const tab = e.target.closest('[data-flow]');
        if (!tab) return;
        const reach = (view.flow === 'open') !== (tab.dataset.flow === 'open');   // the open items need another date range
        view.flow = tab.dataset.flow;
        target.querySelectorAll('#flow-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
        if (reach) loadLedger(); else drawLedger();
    });
    target.querySelector('#timeline-toggle').addEventListener('change', e => {
        prefs.grouped = e.target.checked;
        savePrefs();
        target.querySelector('#group-by').hidden = !prefs.grouped;
        drawLedger();
    });
    target.querySelector('#group-by').addEventListener('click', e => {
        const b = e.target.closest('[data-group]');
        if (!b) return;
        prefs.groupBy = b.dataset.group;
        savePrefs();
        target.querySelectorAll('#group-by .seg-chip').forEach(c => c.classList.toggle('active', c === b));
        drawLedger();
    });
    const periodHost = target.querySelector('#ledger-period');
    const onPeriod = (from, to) => {
        view.from = from; view.to = to;
        periodHost.innerHTML = periodChips(from, to);
        bindPeriodChips(periodHost, onPeriod);
        loadLedger();
    };
    bindPeriodChips(periodHost, onPeriod);
    let qTimer;
    target.querySelector('#ledger-clear').addEventListener('click', () => {
        Object.assign(view, { q: '', flow: 'all', from: firstOfMonth(-5), to: isoDate() });
        drawDetail(target, account, reload, all);
    });
    target.querySelector('#ledger-q').addEventListener('input', e => {
        clearTimeout(qTimer);
        qTimer = setTimeout(() => { view.q = e.target.value; drawLedger(); }, 200);
    });
    bindExport(target.querySelector('.p-ledger'), () => {
        if (!ledger) return null;
        const rows = visibleRows().reverse();
        return {
            title: `${account.name} · ${title}`, subtitle: `${date(ledger.from)} – ${date(ledger.to)}`,
            filename: `statement-${account.code}-${ledger.from}-to-${ledger.to}`,
            summary: [['Opening', Number(ledger.openingBalance)], [debitNormal ? 'In (Dr)' : 'Out (Dr)', Number(ledger.totalDebit)],
                [debitNormal ? 'Out (Cr)' : 'In (Cr)', Number(ledger.totalCredit)], ['Closing', Number(ledger.closingBalance)]],
            sheets: [{
                name: 'Statement',
                columns: [{ label: 'Date', type: 'date' }, { label: 'Kind' }, { label: 'Entry' }, { label: 'Other side' },
                    { label: debitNormal ? 'In (Dr)' : 'Out (Dr)', type: 'money' }, { label: debitNormal ? 'Out (Cr)' : 'In (Cr)', type: 'money' }, { label: 'Balance', type: 'money' }],
                rows: rows.map(r => [r.date, entryKind(r.voucherType).label, r.narration, r.counterAccounts, Number(r.debit) || '', Number(r.credit) || '', Number(r.balance)]),
                totals: ['Total', '', '', '', rows.reduce((s, r) => s + Number(r.debit), 0), rows.reduce((s, r) => s + Number(r.credit), 0), Number(ledger.closingBalance)],
            }],
        };
    });
    await loadLedger();
}

/**
 * Timeline: the statement split into collapsible groups (calendar month, or the counter account
 * as "party"), each headed by its entry count, money in, money out and net.
 */
/** "to", "for", "from": how the person stands to this entry of a lent / borrowed item. */
function personWord({ claim, role }) {
    const payable = claim.kind === 'BORROWED' || claim.kind === 'BILL_DUE';
    if (role === 'given') return 'to';
    if (role === 'paid for') return 'for';
    if (role === 'borrowed') return 'from';
    if (role === 'bill') return 'to';
    return payable ? 'to' : 'from';   // payments, write-offs and interest
}

function groupedTable(columns, rows, groupBy, { isIn, amountOf }) {
    if (!rows.length) return emptyState('No entries in this period');
    const keyOf = r => groupBy === 'month' ? r.date.slice(0, 7) : (r.counterAccounts || '—');
    const labelOf = key => {
        if (groupBy !== 'month') return esc(key);
        const [y, m] = key.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    };
    const groups = new Map();
    rows.forEach(r => {
        const key = keyOf(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });
    let list = [...groups.entries()].map(([key, items]) => {
        const inflow = items.filter(isIn).reduce((s, r) => s + amountOf(r), 0);
        const outflow = items.filter(r => !isIn(r)).reduce((s, r) => s + amountOf(r), 0);
        return { key, items, inflow, outflow };
    });
    if (groupBy === 'party') list = list.sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
    const max = Math.max(...list.map(g => g.inflow + g.outflow)) || 1;

    const head = columns.map(c => `<th class="${c.align || ''} ${c.cls || ''}">${esc(c.label)}</th>`).join('');
    const body = list.map((g, gi) => {
        const net = g.inflow - g.outflow;
        const groupRow = `<tr class="group-row" data-group-head="${gi}"><td colspan="${columns.length}"><div class="grp-head">
            <span class="grp-caret">${icon('chevron-down')}</span><b class="ellipsis">${labelOf(g.key)}</b>
            <span class="grp-count">${g.items.length}</span>
            <span class="grp-bar"><i style="width:${((g.inflow + g.outflow) / max) * 100}%"></i></span>
            <span class="spacer"></span>
            ${g.inflow ? `<span class="pos">+${money(g.inflow)}</span>` : ''}
            ${g.outflow ? `<span class="neg">−${money(g.outflow)}</span>` : ''}
            <b class="grp-net ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${money(Math.abs(net))}</b>
        </div></td></tr>`;
        const items = g.items.map(row => `<tr class="clickable" data-entry="${row.entryId}" data-group="${gi}">${columns.map(c =>
            `<td class="${c.align || ''} ${c.cls || ''}">${c.render(row) ?? ''}</td>`).join('')}</tr>`).join('');
        return groupRow + items;
    }).join('');
    return `<table class="grid dense grouped"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Compact metric tiles that make sense for this kind of account. */
/**
 * The selected account's figures as separate tiles (like a chit's): this month in and out with the net and a
 * balance bar, the 6-month trend with its sparkline, the average monthly change, its share of all assets (or
 * debts), last activity, then what applies to the kind of account (credit, interest, maturity, holding, opening).
 */
function metrics(a, debt, all = []) {
    // every tile carries its full text as a tooltip, so a long note never has to spill out of the tile
    const plain = html => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const tile = (iconName, label, value, note = '', cls = '', extra = '', title = '') =>
        `<div class="ck-tile ${cls}" title="${esc([`${label}: ${plain(value)}`, plain(note), title].filter(Boolean).join(' · '))}"><span class="ck-icon">${icon(iconName)}</span>
            <div class="min-0 grow"><small>${esc(label)}</small><b>${value}</b>${extra}${note ? `<span class="ck-note">${note}</span>` : ''}</div></div>`;
    const bar = (pct, cls = '') => `<i class="ck-bar ${cls}"><em style="width:${Math.max(0, Math.min(100, pct))}%"></em></i>`;
    const monthIn = Number(a.monthIn), monthOut = Number(a.monthOut);
    const net = monthIn - monthOut;
    const goodNet = debt ? net <= 0 : net >= 0;
    const trend = (a.trend || []).map(Number);
    const first = trend[0] ?? Number(a.balance), last = Number(a.balance);
    const sixMonth = last - first;
    const goodSix = debt ? sixMonth <= 0 : sixMonth >= 0;
    const perMonth = trend.length > 1 ? sixMonth / (trend.length - 1) : 0;
    const peers = all.filter(x => x.accountClass === a.accountClass && x.active);
    const peerTotal = peers.reduce((s, x) => s + Math.max(0, Number(x.balance)), 0);
    const share = peerTotal ? (Math.max(0, last) / peerTotal) * 100 : 0;
    const rank = [...peers].sort((x, y) => Number(y.balance) - Number(x.balance)).findIndex(x => x.id === a.id) + 1;
    const color = SPARK[toneOf(a)] || SPARK.slate;
    const list = [
        tile('arrow-in', debt ? 'Added this month' : 'In this month', money(monthIn),
            `${a.transactionCount} entries in total`, '', bar(monthIn + monthOut ? (monthIn / (monthIn + monthOut)) * 100 : 0), 'The bar: money in against all movement this month'),
        tile('arrow-out', debt ? 'Repaid this month' : 'Out this month', money(monthOut),
            `net <span class="${goodNet ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${moneyShort(Math.abs(net))}</span>`, '',
            bar(monthIn + monthOut ? (monthOut / (monthIn + monthOut)) * 100 : 0, 'todo')),
        tile('trending', '6-month trend', `<span class="${sixMonth ? (goodSix ? 'pos' : 'neg') : ''}">${sixMonth >= 0 ? '+' : '−'}${moneyShort(Math.abs(sixMonth))}</span>`,
            `from ${moneyShort(first)} · ${first ? `${sixMonth >= 0 ? '+' : '−'}${percent(Math.abs(sixMonth / first) * 100, 0)}` : 'new'}`, '',
            trend.length > 1 ? `<span class="ck-spark">${sparkline(trend, { width: 96, height: 18, color })}</span>` : '', 'Month-end balances of the last six months'),
        tile('activity', 'Average a month', `${perMonth >= 0 ? '+' : '−'}${moneyShort(Math.abs(perMonth))}`,
            debt ? (perMonth < 0 ? 'paid down each month' : perMonth > 0 ? 'growing each month' : 'steady') : (perMonth > 0 ? 'added each month' : perMonth < 0 ? 'drawn each month' : 'steady')),
        tile('pie', debt ? 'Share of debts' : 'Share of assets', percent(share, 0),
            peers.length > 1 ? `#${rank} of ${peers.length} ${debt ? 'debts' : 'accounts'} · ${moneyShort(peerTotal)}` : 'the only one', '', bar(share)),
        tile('clock', 'Last activity', a.lastActivity ? ago(a.lastActivity) : '—', a.lastActivity ? date(a.lastActivity) : 'No activity yet',
            a.lastActivity && -daysFromToday(a.lastActivity) > 90 && last > 0 ? 'gold' : ''),
    ];
    if (a.creditLimit) {
        const util = Number(a.utilizationPercent || 0);
        list.push(tile('percent', debt && a.accountType !== 'CREDIT_CARD' ? 'Repaid of sanctioned' : 'Credit used',
            percent(a.accountType === 'CREDIT_CARD' ? util : 100 - util, 0),
            `${a.accountType === 'CREDIT_CARD' ? 'Available' : 'Sanctioned'} ${money(a.accountType === 'CREDIT_CARD' ? a.availableCredit : a.creditLimit)}`,
            util > 70 ? 'alert' : '', bar(util, util > 70 ? 'todo' : '')));
    }
    if (a.interestRate) list.push(tile('percent', 'Interest rate', percent(a.interestRate, 2) + ' p.a.',
        `${debt ? 'Costs' : 'Earns'} ≈ ${money(Math.abs(Number(a.balance)) * Number(a.interestRate) / 1200)} / month · ${moneyShort(Math.abs(Number(a.balance)) * Number(a.interestRate) / 100)} a year`));
    if (a.maturityDate) list.push(tile('hourglass', 'Matures', date(a.maturityDate),
        a.daysToMaturity >= 0 ? `in ${a.daysToMaturity} days (${(a.daysToMaturity / 365).toFixed(1)} yrs)` : 'Matured', a.daysToMaturity >= 0 && a.daysToMaturity < 60 ? 'gold' : ''));
    if (a.quantity) list.push(tile('gem', 'Holding', `${number(a.quantity)} g / units`,
        `${money(Number(a.balance) / Number(a.quantity))} per unit`));
    if (a.openingBalance) list.push(tile('flag', 'Opening balance', money(a.openingBalance),
        `${date(a.openingDate)} · ${Number(a.openingBalance) ? `${last >= Number(a.openingBalance) ? '+' : '−'}${moneyShort(Math.abs(last - Number(a.openingBalance)))} since` : ''}`));
    list.push(tile('layers', 'Category', esc(a.bucket || a.typeLabel), esc(a.typeLabel)));
    return list;
}

/**
 * Everyone in this receivable (owed to you) or payable (you owe) account: totals, how old the open
 * amounts are, and one row per item with status, interest and what is payable now.
 */
function peopleHtml(claims, owe = false, every = claims) {
    if (!every.length) return emptyState(owe ? 'Nothing borrowed or due on this account yet' : 'Nothing lent or paid for others from this account yet', owe ? 'card' : 'hand');
    if (!claims.length) return emptyState(owe ? 'Nothing open: you owe nobody on this account' : 'Nothing open: nobody owes you on this account', 'check-circle');
    const open = claims.filter(c => Number(c.outstanding) > 0);
    const owed = open.reduce((s, c) => s + Number(c.outstanding), 0);
    const interest = open.reduce((s, c) => s + Number(c.interestDue), 0);
    const overdue = open.filter(c => c.overdue);
    const monthStart = isoDate().slice(0, 8) + '01';
    const settledThisMonth = claims.flatMap(c => c.repayments).filter(r => !r.writeOff && r.paidDate >= monthStart).reduce((s, r) => s + Number(r.total), 0);
    const ages = [[0, 30, '0–30 days'], [31, 90, '31–90 days'], [91, 365, '3–12 months'], [366, 1e9, 'Over a year']].map(([lo, hi, label]) => ({
        label, value: open.filter(c => c.daysOutstanding >= lo && c.daysOutstanding <= hi).reduce((s, c) => s + Number(c.outstanding), 0),
    }));
    const people = new Map();
    open.forEach(c => people.set(c.party, (people.get(c.party) || 0) + Number(c.outstanding)));
    const top = [...people.entries()].sort((a, b) => b[1] - a[1])[0];
    return `
    <div class="people-summary ${owe ? 'owe' : ''}">
        <div class="ps-main"><span>${owe ? 'You owe' : 'Owed to you'}</span><b>${money(owed)}</b>
            <small>${open.length} open${interest ? ` · +${money(Math.round(interest))} interest` : ''}</small></div>
        <div><span>Payable now</span><b>${money(Math.round(owed + interest))}</b><small>principal + interest</small></div>
        <div><span>Overdue</span><b class="${overdue.length ? 'neg' : ''}">${overdue.length ? money(overdue.reduce((s, c) => s + Number(c.outstanding), 0)) : '—'}</b>
            <small>${overdue.length} item${overdue.length === 1 ? '' : 's'}</small></div>
        <div><span>${owe ? 'Paid this month' : 'Collected this month'}</span><b class="pos">${money(settledThisMonth)}</b><small>${top ? `largest: ${esc(top[0])}` : ''}</small></div>
        <div class="ps-ages"><span>Age of open amounts</span>
            <i class="age-bar">${ages.map((a, i) => `<em class="age-${i}" style="width:${owed ? (a.value / owed) * 100 : 0}%" title="${a.label}: ${money(a.value)}"></em>`).join('')}</i>
            <small>${ages.filter(a => a.value).map(a => `${a.label} ${moneyShort(a.value)}`).join(' · ') || 'nothing open'}</small></div>
    </div>
    <div class="people-table">${table([
        { label: 'Date', cls: 'pc-date', render: c => shortDateYear(c.startDate) },
        // who and what, with the kind and the interest grayed at the right of the same cell
        { label: 'Person', cls: 'pc-person', render: c => `<span class="pp-cell" title="${esc(`${c.party} · ${c.narration} · ${c.kindLabel}${c.interestRate ? ` · ${Number(c.interestRate)}% a year ${c.interestType === 'COMPOUND' ? 'compound' : 'simple'}` : ''}`)}">
            <span class="pp-who"><b>${esc(c.party)}</b><span class="muted"> · ${esc(c.narration)}</span></span>
            <span class="pp-meta">${esc(c.kindLabel)}${c.interestRate ? ` · ${Number(c.interestRate)}% ${c.interestType === 'COMPOUND' ? 'comp.' : 'simple'}` : ''}</span></span>` },
        { label: 'Status', cls: 'pc-status', render: c => `<span class="pp-status">${claimBadge(c)}${dueText(c)}</span>` },
        { label: owe ? 'Borrowed' : 'Given', align: 'r', cls: 'pc-amt', render: c => `<span class="${owe ? 'cr-amt' : 'dr-amt'}">${money(c.amount)}</span>` },
        { label: 'Outstanding', align: 'r', cls: 'pc-amt', render: c => `<b class="${Number(c.outstanding) > 0 ? 'neg' : 'muted'}">${money(c.outstanding)}</b>` },
        { label: 'Payable now', align: 'r', cls: 'pc-amt', render: c => Number(c.outstanding) > 0
            ? `<b title="${esc(`${money(c.outstanding)} principal${Number(c.interestDue) ? ` + ${money(Math.round(Number(c.interestDue)))} interest` : ''}`)}">${money(Math.round(Number(c.settlementAmount)))}</b>`
            : '<span class="muted">settled</span>' },
        { label: '', align: 'r', cls: 'pc-act', render: c => `${!owe && Number(c.outstanding) > 0 ? `<button class="btn sm ghost icon" data-remind="${c.id}" title="Copy a reminder">${icon('copy')}</button>` : ''}<span class="expand-caret">${icon('chevron-down')}</span>` },
    ], claims, { dense: true, rowClass: c => `clickable ${Number(c.outstanding) > 0 ? '' : 'inactive'}`, rowAttrs: c => `data-claim-row="${c.id}"` })}</div>`;
}

/** "due 10 Feb 27", "12 days late" or nothing, beside the status badge. */
function dueText(c) {
    if (!c.dueDate || !(c.status === 'OPEN' || c.status === 'PARTIAL')) return '';
    return c.overdue ? `<span class="pp-due neg" title="Was due ${shortDateYear(c.dueDate)}">${Math.abs(c.daysToDue)}d late</span>`
        : `<span class="pp-due" title="Due date">due ${shortDateYear(c.dueDate)}</span>`;
}

/** The buttons that make sense on this kind of account. */
function quickActions(a) {
    if (!can('POST_TRANSACTIONS')) return [];
    const t = a.accountType;
    if (['BANK', 'CASH', 'WALLET'].includes(t)) return [['spend', 'arrow-out', 'Spend', 'Expense paid from this account'],
        ['receive', 'arrow-in', 'Receive', 'Income into this account'], ['out', 'transfer', 'Transfer', 'Move money to another account']];
    if (t === 'CREDIT_CARD') return [['spend', 'arrow-out', 'Spend', 'Expense on this card'], ['in', 'check', 'Pay bill', 'Pay the card from a bank account']];
    if (t === 'RECEIVABLE' || t === 'LOAN_GIVEN') return [['lend', 'hand', 'Lend', 'Lent or paid for someone']];
    if (t === 'PAYABLE') return [['owe', 'card', 'Borrowed / bill', 'Money you owe someone']];
    if (a.accountClass === 'LIABILITY') return [['in', 'check', 'Pay EMI', 'Repay from a bank account']];
    if (a.accountClass === 'ASSET') return [['in', 'arrow-in', 'Add money', 'Transfer into this account'], ['out', 'arrow-out', 'Withdraw', 'Transfer out of this account']];
    if (a.accountClass === 'INCOME') return [['income', 'arrow-in', 'Add income', 'Income from this source']];
    if (a.accountClass === 'EXPENSE') return [['expense', 'arrow-out', 'Add expense', 'New expense']];
    return [];
}

// ===================================================================== create / edit form

export function openAccountForm(account, onSaved) {
    const types = state.options.accountTypes;
    // expense / income are categories and chits live on the Chits page: neither is a new account
    const classLabels = { ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity' };
    const allowed = t => (t.value !== 'CHIT_FUND' && t.group in classLabels) || t.value === account?.accountType;
    const typeOptions = Object.entries(account && !(account.accountClass in classLabels)
        ? { ...classLabels, [account.accountClass]: account.typeLabel } : classLabels).map(([cls, label]) =>
        `<optgroup label="${label}">${types.filter(t => t.group === cls && allowed(t)).map(t =>
            `<option value="${t.value}" data-type="${t.value}" ${t.value === (account?.accountType || 'BANK') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
    const a = account || { active: true };

    const actions = [];
    if (account && !account.systemAccount) {
        actions.push({
            label: 'Delete', kind: 'danger', iconName: 'trash', left: true,
            onClick: async () => {
                if (!await confirmDialog(`Delete account "${account.name}"? Accounts with transactions can only be deactivated.`)) return true;
                await api.del(`/accounts/${account.id}`);
                toast('Account deleted');
                onSaved?.(account);
            },
        });
    }
    actions.push({ label: 'Cancel' });
    actions.push({
        label: account ? 'Save changes' : 'Create account', kind: 'primary', iconName: 'check',
        onClick: async (m) => {
            const form = m.el.querySelector('form');
            if (!form.reportValidity()) return true;
            const data = { ...readForm(form), version: account?.version ?? null };
            const saved = account ? await api.put(`/accounts/${account.id}`, data) : await api.post('/accounts', data);
            toast(`Account "${saved.name}" saved`);
            onSaved?.(saved);
        },
    });

    openModal({
        title: account ? `Edit ${account.name}` : 'New account', iconName: 'wallet', size: 'lg', actions,
        body: `<form class="form-grid three">
            ${field({ label: 'Account name', name: 'name', value: a.name, required: true, span: 'span-2' })}
            ${field({ label: 'Type', name: 'accountType', type: 'select', options: typeOptions, required: true })}
            ${field({ label: 'Institution', name: 'institution', value: a.institution, placeholder: 'Bank, issuer, lender…' })}
            ${field({ label: 'Account / card no.', name: 'accountNumber', value: a.accountNumber, placeholder: 'XXXX1234' })}
            ${field({ label: 'Code', name: 'code', value: a.code, hint: 'Leave empty to auto-assign', attrs: account?.systemAccount ? 'readonly' : '' })}
            ${field({ label: 'Opening balance', name: 'openingBalance', type: 'number', value: a.openingBalance,
                      hint: 'Amount you own (assets) or owe (loans, cards)' })}
            ${field({ label: 'Opening date', name: 'openingDate', type: 'date', value: a.openingDate || isoDate() })}
            ${field({ label: 'Interest rate % p.a.', name: 'interestRate', type: 'number', value: a.interestRate })}
            ${field({ label: 'Credit limit / sanctioned', name: 'creditLimit', type: 'number', value: a.creditLimit })}
            ${field({ label: 'Maturity / end date', name: 'maturityDate', type: 'date', value: a.maturityDate })}
            ${field({ label: 'Quantity (g / units)', name: 'quantity', type: 'number', value: a.quantity, hint: 'For gold, silver, shares…' })}
            ${field({ label: 'Description', name: 'description', value: a.description, span: 'span-2' })}
            ${field({ label: 'Active', name: 'active', type: 'checkbox', value: a.active })}
        </form>`,
    });
}
