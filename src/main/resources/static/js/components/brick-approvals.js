/**
 * Maker-checker in Brick Management: the Approvals screen (what waits for a checker, and what was decided), and the
 * notifications: the bell beside the section's title (the last notices, the unseen counted) and a card that pops up
 * when one arrives live (a new order, a request to approve and its answer, a delivery the customer signed).
 */
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { esc, toast, openModal, field, panel, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { money, date, dateTime } from '../core/format.js';
import { loadMeta, num, count, bcan, guard, dayLabel, factsHtml } from './brick-common.js';
import './evidence.js';   // the evidence strips (data-ev-pending) fill themselves

const STATUS = { PENDING: ['Waiting', 'warning', 'clock'], APPROVED: ['Approved', 'good', 'check'], REJECTED: ['Turned down', 'bad', 'x'], WITHDRAWN: ['Withdrawn', 'gray', 'undo'] };
const KIND_ICON = { BRICK_ORDER_NEW: 'cart', BRICK_ORDER_CHANGE: 'edit', BRICK_ORDER_CANCEL: 'x', BRICK_ORDER_WAIVE: 'tag', CHANGE: 'edit' };
const STEP = { SUBMITTED: ['Asked', 'send', ''], RESUBMITTED: ['Answered and sent again', 'refresh', 'warn'], EDITED: ['Added to', 'edit', ''],
    REJECTED: ['Turned down', 'x', 'bad'], APPROVED: ['Approved', 'check', 'good'], WITHDRAWN: ['Withdrawn', 'undo', 'muted'] };
const badge = s => { const [l, c, ic] = STATUS[s] || [s, 'gray', 'info']; return `<span class="badge ${c} sm">${icon(ic)}${esc(l)}</span>`; };
let filter = 'open';

// ===================================================================== the screen

export async function approvals({ body, tools, params }) {
    const [list, meta] = await Promise.all([api.get('/bricks/approvals'), loadMeta()]);
    const checker = bcan('APPROVE');
    let sel = params[0] ? Number(params[0]) : null;
    // an approval opened by its link is shown whatever the filter
    if (sel && !list.some(a => a.id === sel)) {
        try { list.unshift(await api.get(`/bricks/approvals/${sel}`)); } catch { sel = null; }
    }
    const waiting = list.filter(a => a.status === 'PENDING');
    // a maker with something turned down and nothing waiting: what to answer first
    if (!checker && filter === 'open' && !waiting.length && list.some(a => a.status === 'REJECTED')) filter = 'back';
    const rejected = list.filter(a => a.status === 'REJECTED');
    tools.innerHTML = `<div class="seg-chips sm">${[['open', `Waiting · ${waiting.length}`], ['back', `Turned down · ${rejected.length}`], ['done', 'Decided'], ['all', 'All']].map(([k, l]) =>
        `<button class="seg-chip ${filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>`;
    const shown = list.filter(a => a.id === sel || filter === 'all' || (filter === 'open' ? a.status === 'PENDING' : filter === 'back' ? a.status === 'REJECTED'
        : a.status === 'APPROVED' || a.status === 'WITHDRAWN'));
    if (!sel && shown.length) sel = shown[0].id;
    const current = list.find(a => a.id === sel);
    if (current) markSeen({ link: `bricks/approvals/${current.id}` });
    const row = a => `<button class="bk-side-row ${a.id === sel ? 'selected' : ''}" data-ap="${a.id}">
        <span class="chip-icon sm ${a.status === 'PENDING' ? 'gold' : a.status === 'APPROVED' ? 'aqua' : 'gray'}">${icon(KIND_ICON[a.kind] || 'shield')}</span>
        <span class="grow min-0"><span class="bk-sr-line"><b class="ellipsis">${esc(a.customerName || a.summary)}</b>${a.amount ? `<b>${money(a.amount)}</b>` : ''}</span>
            <span class="bk-sr-line sub"><small class="ellipsis">${esc(a.approvalNo)} · ${esc(a.kindLabel)}</small>${badge(a.status)}</span>
            <span class="bk-sr-line sub"><small class="muted ellipsis">${esc(a.requestedBy || '')} · ${dayLabel(String(a.requestedAt).slice(0, 10))}</small></span></span></button>`;
    body.innerHTML = `<div class="bk-fill bk-twopane bk-apv">
        <section class="panel headless bk-side-list"><div class="panel-body flush"><div class="bk-side-scroll">
            ${shown.map(row).join('') || emptyState(filter === 'open' ? (checker ? 'Nothing waits for you' : 'Nothing of yours waits') : 'Nothing here', 'shield')}
        </div></div></section>
        <div class="bk-pane">${current ? detailHtml(current, meta, checker) : `<div class="bk-card">${emptyState(checker
            ? 'When a maker agrees a price below the lowest, or asks to change, cancel or give free delivery on an order, it waits here for you.'
            : 'An order below the lowest price, and changes to the bricks, prices, customer or charges of an order, wait here for a checker.', 'shield')}</div>`}</div>
    </div>`;
    const refresh = () => approvals({ body, tools, params: sel ? [sel] : [] });
    tools.onclick = guard(e => { const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; sel = null; return approvals({ body, tools, params: [] }); } });
    body.onclick = guard(async e => {
        const r = e.target.closest('[data-ap]');
        if (r) { history.replaceState(null, '', `#/bricks/approvals/${r.dataset.ap}`); sel = Number(r.dataset.ap); return approvals({ body, tools, params: [sel] }); }
        const act = e.target.closest('[data-decide]')?.dataset.decide;
        if (!act || !current) return;
        if (act === 'withdraw') {
            await api.post(`/bricks/approvals/${current.id}/withdraw`);
            toast(`${current.approvalNo} withdrawn`);
            window.dispatchEvent(new Event('brick-approvals-changed'));
            return refresh();
        }
        if (act === 'resubmit') return resubmit(current, refresh);
        decide(current, act, refresh);
    });
}

function resubmit(a, after) {
    const back = a.status === 'REJECTED';
    openModal({
        title: back ? `Answer and send ${a.approvalNo} again` : `Add to ${a.approvalNo}`, iconName: back ? 'refresh' : 'edit', sub: a.summary,
        body: `<form class="form-grid one">
            ${back ? `<div class="bk-apv-said">${icon('x')}<div><b>Turned down by ${esc(a.decidedBy || 'the checker')}</b><p>“${esc(a.decisionNote || '')}”</p></div></div>` : ''}
            ${field({ label: back ? 'Your answer' : 'What you add', name: 'note', type: 'textarea', required: true, placeholder: back ? 'e.g. The customer buys 5,000 a month; the price was agreed by the owner on the phone' : 'More about the request' })}
            <div class="field"><span>Evidence (a photo, a scan or a PDF: the customer’s message, a quote …)</span><div data-ev-pending="${a.id}" data-ev-editable="1"></div></div>
            <p class="hint">It waits for a checker again; the rejection, your answer and the evidence stay with it for them to see.</p></form>`,
        actions: [{ label: 'Back' }, { label: back ? 'Send again' : 'Add', kind: 'primary', iconName: 'send', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            await api.post(`/bricks/approvals/${a.id}/resubmit`, { note: f.note.value });
            toast(back ? `${a.approvalNo} sent again for approval` : 'Added');
            window.dispatchEvent(new Event('brick-approvals-changed'));
            after();
        } }],
    });
}

function historyHtml(a) {
    if (!a.history?.length) return '';
    return `<div class="bk-apv-hist"><h4>${icon('history')}What happened${a.resubmits ? ` <span class="badge warning sm">${a.resubmits}× sent again</span>` : ''}</h4><ol>${a.history.map(s => {
        const [l, ic, tone] = STEP[s.action] || [s.action, 'info', ''];
        return `<li class="${tone}"><i>${icon(ic)}</i><div><b>${esc(l)}</b> <small class="muted">${esc(s.by || '')} · ${dateTime(s.at)}</small>${s.note ? `<p>${esc(s.note)}</p>` : ''}</div></li>`;
    }).join('')}</ol></div>`;
}

function decide(a, act, after) {
    const approve = act === 'approve';
    openModal({
        title: `${approve ? 'Approve' : 'Turn down'} ${a.approvalNo}`, iconName: approve ? 'check' : 'x', sub: a.summary,
        body: `<form class="form-grid one">
            ${field({ label: approve ? 'A word to the maker (optional)' : 'Why it is turned down', name: 'note', required: !approve, placeholder: approve ? 'Fine this once' : 'The price stays at the list price' })}
            <p class="hint">${approve ? (a.kind === 'BRICK_ORDER_NEW' ? 'The order is made now, as it was asked, and is theirs.' : a.kind === 'CHANGE' ? 'The change is made now, by you, exactly as it was asked; if it can no longer be made you are told and nothing changes.' : 'It is carried out now, as it was asked.') : 'Nothing is changed; they are told why, and can answer it and send it again.'}</p></form>`,
        actions: [{ label: 'Back' }, { label: approve ? 'Approve' : 'Turn down', kind: approve ? 'primary' : 'danger', iconName: approve ? 'check' : 'x', onClick: async m => {
            const f = m.el.querySelector('form');
            if (!f.reportValidity()) return true;
            const done = await api.post(`/bricks/approvals/${a.id}/${act === 'approve' ? 'approve' : 'reject'}`, { note: f.note.value });
            toast(approve ? `${a.approvalNo} approved${done.orderNo ? ` · ${done.orderNo}` : ''}` : `${a.approvalNo} turned down`);
            window.dispatchEvent(new Event('brick-approvals-changed'));
            after();
        } }],
    });
}

function detailHtml(a, meta, checker) {
    const typeOf = id => meta.types.find(t => t.id === id);
    const r = a.request;
    const items = r?.items?.length ? `<table class="grid compact bk-apv-items"><thead><tr><th>Bricks</th><th class="r">Quantity</th><th class="r">Price</th><th class="r">Lowest</th><th class="r">MRP</th><th class="r">Amount</th></tr></thead>
        <tbody>${r.items.map(i => {
            const t = typeOf(i.brickTypeId), low = t?.minPrice !== null && t?.minPrice !== undefined && num(i.price) < num(t.minPrice);
            return `<tr class="${low ? 'bk-apv-low' : ''}"><td><b>${esc(t?.name || 'Bricks')}</b></td><td class="r">${count(i.quantity)}</td>
                <td class="r"><b class="${low ? 'warn' : ''}">${money(i.price, { decimals: 2 })}</b></td><td class="r muted">${t?.minPrice ? money(t.minPrice, { decimals: 2 }) : '—'}</td>
                <td class="r muted">${t?.mrp ? money(t.mrp, { decimals: 2 }) : '—'}</td><td class="r">${money(num(i.price) * num(i.quantity))}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${count(r.items.reduce((s, i) => s + num(i.quantity), 0))}</td><td colspan="3"></td><td class="r"><b>${money(r.items.reduce((s, i) => s + num(i.price) * num(i.quantity), 0))}</b></td></tr></tfoot></table>` : '';
    const decided = a.status !== 'PENDING';
    return `<section class="bk-card bk-apv-card">
        <div class="bk-apv-head"><span class="chip-icon ${a.status === 'PENDING' ? 'gold' : a.status === 'APPROVED' ? 'aqua' : 'gray'}">${icon(KIND_ICON[a.kind] || 'shield')}</span>
            <div class="grow min-0"><h2 class="ellipsis">${esc(a.kindLabel)}</h2><small class="muted">${esc(a.approvalNo)} · ${esc(a.summary)}</small></div>
            ${badge(a.status)}</div>
        ${factsHtml([
            ['Asked by', `<b>${esc(a.requestedBy || '—')}</b> <small>${dateTime(a.requestedAt)}</small>`],
            ['Customer', esc(a.customerName || '')],
            ['Order', a.kind === 'CHANGE' ? '' : a.orderId ? `<a href="#/bricks/sales/${a.orderId}">${esc(a.orderNo || 'Open the order')}</a>` : '<span class="muted">made when approved</span>'],
            ['Amount', a.amount ? `<b>${money(a.amount)}</b>` : ''],
        ])}
        <div class="bk-apv-why"><h4>${icon('alert')}${a.kind === 'CHANGE' ? 'What they ask to set (a maker changes nothing recorded: a checker makes it)' : 'Why it needs a checker'}</h4><ul>${a.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            ${a.note ? `<p class="bk-quote">“${esc(a.note)}” <small class="muted">— ${esc(a.requestedBy || '')}</small></p>` : ''}</div>
        ${items ? `<div class="bk-apv-req"><h4>${icon(a.kind === 'BRICK_ORDER_NEW' ? 'cart' : 'edit')}${a.kind === 'BRICK_ORDER_NEW' ? 'The order as asked' : 'The order as it would be'}</h4>${items}
            ${factsHtml([
                ['Customer', `${esc(r.customerName)}${r.customerPhone ? ` <small>${esc(r.customerPhone)}</small>` : ''}`],
                ['Deliver to', esc([r.address, r.landmark].filter(Boolean).join(', '))],
                ['Needed by', r.requiredBy ? date(r.requiredBy) : ''],
                ['Delivery a trip', r.deliveryChargePerTrip !== null && r.deliveryChargePerTrip !== undefined ? money(r.deliveryChargePerTrip) : ''],
                ['Free delivery', r.waiveDelivery ? `yes${r.waiveReason ? ` <small>${esc(r.waiveReason)}</small>` : ''}` : ''],
                ['Vehicle', r.hired ? `hired${r.hiredVehicle ? ` <small>${esc(r.hiredVehicle)}</small>` : ''}` : ''],
                ['Note', r.note ? `<span class="muted">${esc(r.note)}</span>` : '', 'wide']])}</div>` : ''}
        <div class="bk-apv-ev"><h4>${icon('paperclip')}Evidence</h4><div data-ev-pending="${a.id}" data-ev-count="${a.attachmentCount || 0}" data-ev-editable="${a.canAttach ? '1' : '0'}"></div>
            ${!a.attachmentCount && !a.canAttach ? '<small class="muted">Nothing attached.</small>' : ''}</div>
        ${historyHtml(a)}
        ${decided ? `<div class="bk-apv-decision ${a.status.toLowerCase()}">${icon(STATUS[a.status]?.[2] || 'info')}<div><b>${esc(STATUS[a.status]?.[0] || a.status)}</b>
            ${a.decidedBy ? ` by ${esc(a.decidedBy)}` : ''} <small class="muted">${dateTime(a.decidedAt)}</small>${a.decisionNote ? `<p class="bk-quote">“${esc(a.decisionNote)}”</p>` : ''}</div></div>` : ''}
        ${a.canDecide || a.canWithdraw || a.canResubmit ? `<div class="bk-apv-acts">
            ${a.canDecide ? `<button class="btn primary" data-decide="approve">${icon('check')}Approve${a.kind === 'BRICK_ORDER_NEW' ? ' & make the order' : ''}</button>
                <button class="btn danger ghost" data-decide="reject">${icon('x')}Turn down with a reason</button>` : ''}
            ${a.canResubmit ? `<button class="btn ${a.status === 'REJECTED' ? 'primary' : ''}" data-decide="resubmit">${icon(a.status === 'REJECTED' ? 'refresh' : 'edit')}${a.status === 'REJECTED' ? 'Answer & send again' : 'Add a comment'}</button>` : ''}
            ${a.canWithdraw ? `<button class="btn ghost" data-decide="withdraw">${icon('undo')}Withdraw my request</button>` : ''}</div>`
            : !decided && !checker ? '<p class="small muted">A checker decides; you are told as soon as they do.</p>' : ''}
    </section>`;
}

// ===================================================================== notifications (brick-alerts.js)

export { bellHtml, bindBell } from './brick-alerts.js';
import { markSeen } from './brick-alerts.js';

// the count of what waits, beside Approvals in the menu
window.addEventListener('brick-approvals-changed', async () => {
    const link = document.querySelector('.bk-nav a[href="#/bricks/approvals"]');
    if (!link) return;
    try {
        const a = await api.get('/bricks/access');
        let c = link.querySelector('.bk-nav-count');
        if (!a.pendingApprovals) { c?.remove(); return; }
        if (!c) { c = document.createElement('span'); c.className = 'bk-nav-count'; link.appendChild(c); }
        c.textContent = a.pendingApprovals;
    } catch { /* left as it is */ }
});

